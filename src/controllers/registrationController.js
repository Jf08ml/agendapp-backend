import crypto from "crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Organization from "../models/organizationModel.js";
import Role from "../models/roleModel.js";
import ExchangeCode from "../models/exchangeCodeModel.js";
import Plan from "../models/planModel.js";
import membershipService from "../services/membershipService.js";
import sendResponse from "../utils/sendResponse.js";
import { isValidSlug, isSlugAvailable, suggestSlugs } from "../utils/reservedSlugs.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Valida token de Cloudflare Turnstile.
 * En dev sin secret configurado, se salta la validación.
 */
async function verifyTurnstile(token) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // En dev sin Turnstile configurado, permitir
    if (process.env.NODE_ENV !== "production") return true;
    throw new Error("Turnstile no configurado");
  }

  const response = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });

  const data = await response.json();
  return data.success === true;
}

const registrationController = {
  /**
   * POST /api/register
   * Crear organización + rol admin + trial de 7 días + exchange code
   */
  register: async (req, res) => {
    try {
      const { slug, businessName, ownerName, email, password, phone, turnstileToken } = req.body;

      // 1. Validar campos requeridos
      if (!slug || !businessName || !email || !password || !phone) {
        return sendResponse(res, 400, null, "Todos los campos son requeridos");
      }

      // 2. Validar Turnstile
      if (process.env.NODE_ENV === "production" || turnstileToken) {
        const isTurnstileValid = await verifyTurnstile(turnstileToken);
        if (!isTurnstileValid) {
          return sendResponse(res, 400, null, "Verificación de captcha fallida");
        }
      }

      // 3. Validar slug
      const slugResult = await isSlugAvailable(slug);
      if (!slugResult.available) {
        const suggestions = slugResult.reason === "taken" ? await suggestSlugs(slug) : [];
        return sendResponse(res, 400, { reason: slugResult.reason, suggestions }, "Slug no disponible");
      }

      // 4. Verificar email no duplicado
      const existingOrg = await Organization.findOne({ email: email.toLowerCase().trim() }).select("_id").lean();
      if (existingOrg) {
        return sendResponse(res, 409, null, "Ya existe una organización con ese email");
      }

      // 5. Buscar rol admin existente (reutilizar el mismo para todas las orgs)
      const adminRole = await Role.findOne({ name: "admin" });
      if (!adminRole) {
        return sendResponse(res, 500, null, "No se encontró el rol admin. Contacta soporte.");
      }

      // 6. Crear organización
      const hashedPassword = await bcrypt.hash(password, 10);
      const newOrg = new Organization({
        name: businessName,
        ownerName: ownerName || businessName,
        slug: slug.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        phoneNumber: phone,
        role: adminRole._id,
        location: { lat: 0, lng: 0 }, // Default, editable después
        isActive: true,
        hasAccessBlocked: false,
        membershipStatus: "trial",
        // domains[] queda vacío — solo para custom domains
      });

      const savedOrg = await newOrg.save();

      // 7. Crear trial automático de 7 días con plan-demo (acceso completo)
      const trialPlan = await Plan.findOne({ slug: "plan-demo", isActive: true });
      if (!trialPlan) {
        console.error("[register] No se encontró plan-demo para trial. Org:", savedOrg.slug);
      } else {
        await membershipService.createMembership({
          organizationId: savedOrg._id,
          planId: trialPlan._id,
          trialDays: 7,
        });
      }

      // 8. Generar exchange code (1 uso, TTL 2 min)
      const code = crypto.randomBytes(32).toString("hex");
      await new ExchangeCode({
        code,
        userId: savedOrg._id, // Organization IS the admin user
        organizationId: savedOrg._id,
        role: "admin",
        expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutos
      }).save();

      sendResponse(res, 201, {
        exchangeCode: code,
        subdomain: `${savedOrg.slug}.agenditapp.com`,
        organizationId: savedOrg._id,
      }, "Organización creada exitosamente");
    } catch (error) {
      // Manejar duplicate key error de MongoDB (race condition en slug)
      if (error.code === 11000 && error.keyPattern?.slug) {
        return sendResponse(res, 409, null, "Ese slug ya está en uso");
      }
      console.error("[register] Error:", error);
      sendResponse(res, 500, null, "Error al crear la organización");
    }
  },

  /**
   * POST /api/exchange
   * Intercambiar código por JWT (consumo atómico con findOneAndDelete)
   */
  exchange: async (req, res) => {
    try {
      const { code } = req.body;

      if (!code) {
        return sendResponse(res, 400, null, "Código requerido");
      }

      // Consumo atómico: buscar y eliminar en una operación
      const exchangeDoc = await ExchangeCode.findOneAndDelete({
        code,
        expiresAt: { $gt: new Date() },
      });

      if (!exchangeDoc) {
        return sendResponse(res, 400, null, "Código inválido, expirado o ya utilizado");
      }

      // Generar JWT
      const token = jwt.sign(
        { userId: exchangeDoc.userId, userType: exchangeDoc.role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      const expiresIn = 7 * 24 * 60 * 60 * 1000;
      const expiresAt = new Date(Date.now() + expiresIn).toISOString();

      // Obtener permisos del usuario
      const org = await Organization.findById(exchangeDoc.organizationId).populate("role");
      const userPermissions = org?.role?.permissions || [];

      sendResponse(res, 200, {
        token,
        userId: exchangeDoc.userId,
        userType: exchangeDoc.role,
        organizationId: exchangeDoc.organizationId,
        userPermissions,
        expiresAt,
      }, "Login exitoso");
    } catch (error) {
      console.error("[exchange] Error:", error);
      sendResponse(res, 500, null, "Error al intercambiar código");
    }
  },

  /**
   * GET /api/check-slug/:slug
   * Verificar disponibilidad de slug
   */
  checkSlug: async (req, res) => {
    try {
      const { slug } = req.params;

      if (!slug || !isValidSlug(slug.toLowerCase().trim())) {
        return sendResponse(res, 200, {
          available: false,
          reason: "invalid_format",
        });
      }

      const result = await isSlugAvailable(slug);

      const response = { available: result.available };
      if (!result.available && result.reason === "taken") {
        response.suggestions = await suggestSlugs(slug, 3);
      }
      if (!result.available) {
        response.reason = result.reason;
      }

      sendResponse(res, 200, response);
    } catch (error) {
      console.error("[checkSlug] Error:", error);
      sendResponse(res, 500, null, "Error al verificar slug");
    }
  },
};

export default registrationController;
