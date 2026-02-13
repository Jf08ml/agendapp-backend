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
import whatsappRoutes from "./whatsappRoutes";
import whatsappTemplateRoutes from "./whatsappTemplateRoutes";
import cronRoutes from "./cronRoutes";
import reservationRoutes from "./reservation";
import notificationRoutes from "./notification";
import planRoutes from "./planRoutes";
import paymentRoutes from "./paymentRoutes.js";
import waRoutes from "./waRoutes";
import reminderRoutes from "./reminderRoutes";
import membershipRoutes from "./membershipRoutes";
import scheduleRoutes from "./scheduleRoutes.js";
import debugRoutes from "./debugRoutes.js";
import publicRoutes from "./publicRoutes.js";
import membershipBillingRoutes from "./membershipBillingRoutes.js";
import campaignRoutes from "./campaignRoutes.js";
import packageRoutes from "./packageRoutes.js";
import membershipService from "../services/membershipService.js";
import { organizationResolver } from "../middleware/organizationResolver";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = Router();

// *** NUEVO ENDPOINT: config visual público según dominio ***
router.get("/organization-config", organizationResolver, async (req, res) => {
  const { organization } = req;
  if (!organization) {
    return res.status(404).json({ error: "Organización no encontrada" });
  }
  // Conviertes a objeto plano y omites campos sensibles
  const orgObj = organization.toObject();

  // Elimina campos peligrosos/sensibles del objeto antes de enviar
  delete orgObj.password;
  delete orgObj.__v;

  // Adjuntar límites del plan activo
  try {
    orgObj.planLimits = await membershipService.getPlanLimits(organization._id);
  } catch (e) {
    console.error("[organization-config] Error al obtener planLimits:", e.message);
    orgObj.planLimits = null;
  }

  res.json(orgObj);
});

// organizationResolver ya te inyecta req.organization según el dominio.
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
  // Puedes servir la imagen desde tu storage o redirigir
  res.redirect(org.branding?.faviconUrl || "/logo_default.png");
});

// 🌐 Rutas PÚBLICAS que necesitan registrarse PRIMERO (sin middlewares)
router.use("/memberships", membershipRoutes); // Maneja auth internamente (algunas públicas)
router.use("/services", serviceRoutes); // Maneja auth internamente (consulta pública)
router.use("/employees", employeeRoutes); // Maneja auth internamente (consulta pública por organización)
router.use("/schedule", scheduleRoutes); // Maneja auth internamente (consulta de disponibilidad pública)
router.use("/clients", clientRoutes); // Maneja auth internamente (búsqueda por teléfono pública)
router.use("/reservations", reservationRoutes); // Maneja auth internamente (creación de reserva pública)
router.use("/packages", packageRoutes); // Maneja auth internamente (consulta pública para reservas)

// 🔒 Rutas que requieren organizaciónResolver y autenticación
router.use("/appointments", organizationResolver, verifyToken, appointmentRoutes);
router.use("/images", organizationResolver, verifyToken, imagesRoutes);
router.use("/advances", organizationResolver, verifyToken, advanceRoutes);

// organization-config (config visual) también depende del middleware
router.use("/organizations", organizationResolver, verifyToken, organizationRoutes);

// Rutas que NO dependen de tenant/organización pero SÍ requieren autenticación
router.use("/whatsapp-templates", verifyToken, whatsappTemplateRoutes);
router.use("/notifications", verifyToken, notificationRoutes);
router.use("/wa", verifyToken, waRoutes);
router.use("/reminders", verifyToken, reminderRoutes);
router.use("/campaigns", verifyToken, campaignRoutes);

// Rutas públicas (SIN autenticación)
router.use(organizationRoutesPublic);
router.use("/roles", roleRoutes); // Roles - considerar proteger luego
router.use(authRoutes); // Login - debe ser público
router.use(subscriptionRoutes); // Push notifications - considerar
router.use(whatsappRoutes); // Webhooks - debe ser público
router.use("/cron", cronRoutes); // Cron jobs - debe ser público
router.use("/plans", planRoutes); // Planes - considerar según uso
router.use("/payments", paymentRoutes); // Webhooks de pago - debe ser público
router.use("/debug", debugRoutes); // Debug - considerar proteger en producción
router.use("/public", publicRoutes); // Rutas públicas - debe ser público
router.use("/billing", membershipBillingRoutes); // Billing público

export default router;
