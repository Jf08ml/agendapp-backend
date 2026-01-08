import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV}` });

import webPush from "web-push";
import dbConnection from "./config/db.js";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import routes from "./routes/indexRoutes.js";
import membershipCheckJob from "./cron/membershipCheckJob.js";
import reminderJob from "./cron/reminderJob.js";

const app = express();

// Configura web-push con las claves VAPID
webPush.setVapidDetails(
  "mailto:lassojuanfe@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

app.use(cors({ origin: "*" }));
app.use(morgan("dev"));
// Evitar respuestas 304 en desarrollo para que el frontend siempre reciba datos frescos
if (process.env.NODE_ENV !== "production") {
  app.disable("etag");
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
}
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Rutas principales
app.use("/api", routes);

// Ruta de prueba
app.get("/", (req, res) => {
  res.send("API galaxia glamour");
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  const statusCode = err.statusCode || 500;
  let message = err.message;

  if (process.env.NODE_ENV === "production" && !err.statusCode) {
    message = "Ocurrió un error en el servidor";
  }

  res.status(statusCode).json({ result: "error", message: message });
});

// Conectar a la base de datos y luego arrancar el servidor
dbConnection()
  .then(() => {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(
        `✨ Server listening on port ${PORT}, ${process.env.NODE_ENV} ✨`
      );
    });
    
    // Los cron jobs ahora se ejecutan desde Vercel Cron
    // No es necesario iniciarlos manualmente aquí
    console.log("⏰ Cron jobs configurados en Vercel:");
    console.log("  - Verificación de membresías: Diario a las 9 AM (hora Colombia)");
    console.log("  - Recordatorios: Configurados en servidor Vultr (cada hora)");
  })
  .catch((err) => {
    console.error("Failed to connect to the database", err);
    process.exit(1);
  });
