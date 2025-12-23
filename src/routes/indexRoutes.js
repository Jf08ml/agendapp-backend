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
import cronRoutes from "./cronRoutes";
import reservationRoutes from "./reservation";
import notificationRoutes from "./notification";
import planRoutes from "./planRoutes";
import waRoutes from "./waRoutes";
import reminderRoutes from "./reminderRoutes";
import membershipRoutes from "./membershipRoutes";
import scheduleRoutes from "./scheduleRoutes.js";
import { organizationResolver } from "../middleware/organizationResolver";

const router = Router();

// *** NUEVO ENDPOINT: config visual público según dominio ***
router.get("/organization-config", organizationResolver, (req, res) => {
  const { organization } = req;
  if (!organization) {
    return res.status(404).json({ error: "Organización no encontrada" });
  }
  // Conviertes a objeto plano y omites campos sensibles
  const orgObj = organization.toObject();

  // Elimina campos peligrosos/sensibles del objeto antes de enviar
  delete orgObj.password;
  delete orgObj.__v;

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

// Rutas que requieren organizaciónResolver (ejemplo)
router.use(organizationResolver, clientRoutes);
router.use(organizationResolver, appointmentRoutes);
router.use(organizationResolver, serviceRoutes);
router.use(organizationResolver, imagesRoutes);
router.use(organizationResolver, employeeRoutes);
router.use(organizationResolver, advanceRoutes);
router.use(organizationResolver, reservationRoutes);

// organization-config (config visual) también depende del middleware
router.use(organizationResolver, organizationRoutes);

// Rutas que NO dependen de tenant/organización
router.use(organizationRoutesPublic);
router.use(roleRoutes);
router.use(authRoutes);
router.use(subscriptionRoutes);
router.use(whatsappRoutes);
router.use(cronRoutes);
router.use(notificationRoutes);
router.use("/plans", planRoutes);
router.use("/memberships", membershipRoutes);
router.use(waRoutes);
router.use(reminderRoutes);
router.use("/schedule", scheduleRoutes);

export default router;
