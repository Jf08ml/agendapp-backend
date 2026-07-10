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
import classRoutes from "./classRoutes.js";
import enrollmentRoutes from "./enrollmentRoutes.js";
import expenseRoutes from "./expenseRoutes.js";
import productRoutes from "./productRoutes.js";
import registrationRoutes from "./registrationRoutes.js";
import adminRoutes from "./adminRoutes.js";
import agentRoutes from "./agentRoutes.js";
import auditLogRoutes from "./auditLog.js";
import announcementRoutes from "./announcementRoutes.js";
import announcementAdminRoutes from "./announcementAdminRoutes.js";
import chatRoutes from "./chatRoutes.js";
import bookingChatRoutes from "./bookingChatRoutes.js";
import waAgentRoutes from "./waAgentRoutes.js";
import metaRoutes from "./metaRoutes.js";
import collectionRoutes from "./collectionRoutes.js";
import collectionPublicRoutes from "./collectionPublicRoutes.js";
import receiptPublicRoutes from "./receiptPublicRoutes.js";
import receiptAdminRoutes from "./receiptAdminRoutes.js";
import storePublicRoutes from "./storePublicRoutes.js";
import storeAdminRoutes from "./storeAdminRoutes.js";
import impactSurveyRoutes from "./impactSurveyRoutes.js";
import metaConversionsRoutes from "./metaConversionsRoutes.js";
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

  // 🔐 No exponer credenciales de cobro (tokens del vendedor). Solo el flag de
  // conexión, que el flujo de depósito público necesita.
  if (orgObj.mpCollect) {
    orgObj.mpCollect = { connected: !!orgObj.mpCollect.connected };
  }

  // 🛍️ Flags públicos de la tienda (normalizados por si el doc es legacy y no
  // tiene los campos: storeEnabled default false, storeCodEnabled default true).
  orgObj.storeEnabled = !!orgObj.storeEnabled;
  orgObj.storeCodEnabled = orgObj.storeCodEnabled !== false;

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
  // Preferir el ícono PWA dedicado; si el negocio no lo subió pero sí tiene un
  // logo general, usar ese antes de caer al genérico de AgenditApp — evita que
  // instale con un ícono ajeno al negocio solo porque no llenaron ese campo puntual.
  const iconSrc = org.branding?.pwaIcon || org.branding?.logoUrl || "/logo_default.png";
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
          src: iconSrc,
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: iconSrc,
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: iconSrc,
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
router.use("/booking-chat", organizationResolver, bookingChatRoutes);

// Agente WA: webhook de Meta (GET verify + POST mensajes) + endpoint de Baileys
// Va en grupo público — Meta y Baileys tienen su propia autenticación interna
router.use("/wa-agent", waAgentRoutes);
router.use("/roles", roleRoutes);

// Pagos: webhook público, checkout/confirm protegido internamente
router.use("/payments", paymentRoutes);

// Cobros cliente→org (Mercado Pago): callback OAuth público (la org va en el state)
router.use("/mp", collectionPublicRoutes);

// Cobros por transferencia + comprobante con IA: checkouts y subida (públicos)
router.use("/collection", receiptPublicRoutes);

// 🛍️ Tienda pública de productos: catálogo + checkouts (MP / contraentrega).
// El pago por comprobante de la tienda vive en /collection/receipt/store.
router.use("/store", storePublicRoutes);

// Registro público: signup, exchange code, check slug
router.use(registrationRoutes);

// Meta Pixel + Conversions API: CompleteRegistration server-side (dedup con el Pixel)
router.use("/meta-capi", metaConversionsRoutes);

// Superadmin de plataforma: login + impersonation (endpoints propios manejan auth)
router.use(adminRoutes);

// Gestión de agentes/referidores externos (superadmin only)
router.use("/admin/agents", agentRoutes);

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
router.use("/organizations", organizationResolver, verifyToken, metaRoutes);
router.use("/organizations", organizationResolver, verifyToken, collectionRoutes);
router.use("/receipts", organizationResolver, verifyToken, receiptAdminRoutes);
router.use("/notifications", verifyToken, notificationRoutes);
router.use("/chat", organizationResolver, verifyToken, chatRoutes);

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
router.use("/expenses", organizationResolver, verifyToken, requireActiveMembership, expenseRoutes);
router.use("/products", organizationResolver, verifyToken, requireActiveMembership, productRoutes);
// Hook futuro para límite por plan: checkPlanLimit("maxProducts") — NO activar ahora
// 🛍️ Bandeja admin de pedidos de la tienda pública
router.use("/store-orders", organizationResolver, verifyToken, requireActiveMembership, storeAdminRoutes);
router.use("/audit-logs", organizationResolver, verifyToken, auditLogRoutes);
router.use("/impact-survey", organizationResolver, verifyToken, impactSurveyRoutes);
router.use("/announcements", verifyToken, announcementRoutes);
router.use("/admin/announcements", announcementAdminRoutes);

// ═══════════════════════════════════════════════════
// 5. MÓDULO DE CLASES
//    Semi-públicas (sesiones disponibles, clases por org) + protegidas (CRUD admin)
//    Las rutas públicas internas manejan su propio auth
// ═══════════════════════════════════════════════════
router.use("/classes", classRoutes);
router.use("/enrollments", enrollmentRoutes);

export default router;
