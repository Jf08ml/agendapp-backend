import { Router } from "express";

// Importa tus routers
import clientRoutes from "./client";
import appointmentRoutes from "./appointments";
import serviceRoutes from "./services";
import imagesRoutes from "./images";
import employeeRoutes from "./employee";
import advanceRoutes from "./advance";
import roleRoutes from "./role";
import organizationRoutes from "./organizationRoutes";
import organizationRoutesPublic from "./organizationRoutesPublic";
import authRoutes from "./authRoutes";
import subscriptionRoutes from "./subscriptionRoutes";
import whatsappTemplateRoutes from "./whatsappTemplateRoutes";
import cronRoutes from "./cronRoutes";
import reservationRoutes from "./reservation";
import notificationRoutes from "./notification";
import planRoutes from "./planRoutes";

import waRoutes from "./waRoutes";
import reminderRoutes from "./reminderRoutes";
import membershipRoutes from "./membershipRoutes";
import scheduleRoutes from "./scheduleRoutes.js";
import debugRoutes from "./debugRoutes.js";
import publicRoutes from "./publicRoutes.js";

import campaignRoutes from "./campaignRoutes.js";
import packageRoutes from "./packageRoutes.js";
import paymentRoutes from "./paymentRoutes.js";
import registrationRoutes from "./registrationRoutes.js";
import membershipService from "../services/membershipService.js";
import { organizationResolver } from "../middleware/organizationResolver";
import { verifyToken } from "../middleware/authMiddleware.js";
import { requireActiveMembership } from "../middleware/membershipMiddleware.js";

const router = Router();

// ─── Config visual público según dominio ───
router.get("/organization-config", organizationResolver, async (req, res) => {
  const { organization } = req;
  if (!organization) {
    return res.status(404).json({ error: "Organización no encontrada" });
  }
  const orgObj = organization.toObject();
  delete orgObj.password;
  delete orgObj.__v;

  try {
    orgObj.planLimits = await membershipService.getPlanLimits(organization._id);
  } catch (e) {
    console.error("[organization-config] Error al obtener planLimits:", e.message);
    orgObj.planLimits = null;
  }

  res.json(orgObj);
});

router.get("/manifest.webmanifest", organizationResolver, (req, res) => {
  const org = req.organization;
  res.setHeader("Content-Type", "application/manifest+json");
  res.send(
    JSON.stringify({
      name: org.branding?.pwaName || org.name,
      short_name: org.branding?.pwaShortName || org.name,
      description: org.branding?.pwaDescription || "Agenda y tienda Zybizo",
      display: "standalone",
      start_url: "/",
      background_color: org.branding?.backgroundColor || "#fff",
      theme_color: org.branding?.themeColor || "#fff",
      icons: [
        {
          src: org.branding?.pwaIcon || "/logo_default.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: org.branding?.pwaIcon || "/logo_default.png",
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: org.branding?.pwaIcon || "/logo_default.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable",
        },
      ],
    })
  );
});

router.get("/favicon.ico", organizationResolver, (req, res) => {
  const org = req.organization;
  res.redirect(org.branding?.faviconUrl || "/logo_default.png");
});

// ═══════════════════════════════════════════════════
// 1. RUTAS PÚBLICAS (sin auth, sin membership check)
// ═══════════════════════════════════════════════════
router.use(organizationRoutesPublic);
router.use(authRoutes);
router.use(subscriptionRoutes);
router.use("/cron", cronRoutes);
router.use("/plans", planRoutes);
router.use("/debug", debugRoutes);
router.use("/public", publicRoutes);
router.use("/roles", roleRoutes);

// Pagos: webhook público, checkout/confirm protegido internamente
router.use("/payments", paymentRoutes);

// Registro público: signup, exchange code, check slug
router.use(registrationRoutes);

// ═══════════════════════════════════════════════════
// 2. SEMI-PÚBLICAS (manejan auth internamente)
//    Registrar ANTES del grupo protegido
// ═══════════════════════════════════════════════════
router.use("/memberships", membershipRoutes);
router.use("/services", serviceRoutes);
router.use("/employees", employeeRoutes);
router.use("/schedule", scheduleRoutes);
router.use("/clients", clientRoutes);
router.use("/reservations", reservationRoutes);
router.use("/packages", packageRoutes);

// ═══════════════════════════════════════════════════
// 3. EXCEPCIONES: auth requerido pero SIN membership check
//    (admin necesita ver su org/notificaciones aunque esté vencido)
// ═══════════════════════════════════════════════════
router.use("/organizations", organizationResolver, verifyToken, organizationRoutes);
router.use("/notifications", verifyToken, notificationRoutes);

// ═══════════════════════════════════════════════════
// 4. GRUPO PROTEGIDO: auth + membership enforcement
//    Cualquier ruta nueva que agregues aquí hereda protección
// ═══════════════════════════════════════════════════
router.use("/appointments", organizationResolver, verifyToken, requireActiveMembership, appointmentRoutes);
router.use("/images", organizationResolver, verifyToken, requireActiveMembership, imagesRoutes);
router.use("/advances", organizationResolver, verifyToken, requireActiveMembership, advanceRoutes);
router.use("/whatsapp-templates", verifyToken, requireActiveMembership, whatsappTemplateRoutes);
router.use("/wa", verifyToken, requireActiveMembership, waRoutes);
router.use("/reminders", verifyToken, requireActiveMembership, reminderRoutes);
router.use("/campaigns", verifyToken, requireActiveMembership, campaignRoutes);

export default router;
