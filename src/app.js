import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV}` });

import webPush from "web-push";
import dbConnection from "./config/db.js";
import express from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import routes from "./routes/indexRoutes.js";
import membershipCheckJob from "./cron/membershipCheckJob.js";
import reminderJob from "./cron/reminderJob.js";
import { dynamicCorsOptions } from "./middleware/corsMiddleware.js";

const app = express();

// Confiar en el primer proxy (Vercel) para que express-rate-limit
// use correctamente X-Forwarded-For para identificar IPs de clientes
app.set('trust proxy', 1);

// Configura web-push con las claves VAPID
webPush.setVapidDetails(
  "mailto:lassojuanfe@gmail.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// 🔒 Seguridad: Helmet para headers HTTP seguros
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "https://ik.imagekit.io"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Para permitir ImageKit
}));

// 🔒 CORS dinámico para plataforma multitenant
// Valida contra los dominios registrados en la base de datos
app.use(cors(dynamicCorsOptions));

// 🔒 Rate limiting general (100 requests por 15 minutos)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // Límite de 100 requests por IP
  message: {
    result: 'error',
    message: 'Demasiadas solicitudes desde esta IP, por favor intenta más tarde'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Excluir cron jobs del rate limiting
  skip: (req) => {
    return req.path.startsWith('/api/cron/');
  }
});

// 🔒 Rate limiting estricto para login (5 intentos por 15 minutos)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    result: 'error',
    message: 'Demasiados intentos de inicio de sesión, espera 15 minutos'
  },
  skipSuccessfulRequests: true, // No contar logins exitosos
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(morgan("dev"));
// Evitar respuestas 304 en desarrollo para que el frontend siempre reciba datos frescos
if (process.env.NODE_ENV !== "production") {
  app.disable("etag");
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
}
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// 🔒 Aplicar rate limiting general a todas las rutas de API
app.use("/api", generalLimiter);

// 🔒 Aplicar rate limiting estricto a login
app.use("/api/login", loginLimiter);

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
