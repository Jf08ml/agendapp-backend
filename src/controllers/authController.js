import authService from "../services/authService.js";
import sendResponse from "../utils/sendResponse.js";
import getClientIp from "../utils/getClientIp.js";
import Session from "../models/sessionModel.js";
import Organization from "../models/organizationModel.js";
import Employee from "../models/employeeModel.js";
import jwt from "jsonwebtoken";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días, igual que el JWT

/** Nombre a mostrar en la lista de sesiones activas, snapshot al momento del login. */
function getDisplayName(user) {
  return user.userType === "admin" ? user.ownerName || user.name : user.names;
}

const authController = {
  login: async (req, res) => {
    const { email, password, organizationId } = req.body;
    const normalizedEmail = typeof email === "string" ? email.replace(/\s+/g, "").toLowerCase() : email;

    try {
      // Autenticar al usuario
      const user = await authService.authenticateUser(normalizedEmail, password, organizationId);

      // Registrar la sesión (dispositivo) para poder listarla/revocarla luego
      const session = await Session.create({
        organizationId: user.organizationId,
        userId: user._id,
        userType: user.userType,
        displayName: getDisplayName(user),
        ip: getClientIp(req),
        userAgent: req.headers["user-agent"] || "unknown",
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      });

      // Generar el token JWT
      const token = jwt.sign(
        { userId: user._id, userType: user.userType, sid: session._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: "7d" } // 7 días de validez
      );

      // Calcular tiempo de expiración
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

      sendResponse(
        res,
        200,
        {
          token,
          sessionId: session._id,
          userId: user._id,
          userType: user.userType,
          organizationId: user.organizationId,
          userPermissions: user.userPermissions,
          expiresAt, // Timestamp de expiración
        },
        "Inicio de sesión exitoso"
      );
    } catch (error) {
      sendResponse(res, 401, null, error.message);
    }
  },

  /**
   * Endpoint para renovar el token JWT
   * Acepta un token expirado pero válido y genera uno nuevo
   */
  refresh: async (req, res) => {
    try {
      // Obtener token del header Authorization
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        return sendResponse(res, 401, null, "Token no proporcionado");
      }

      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return sendResponse(res, 401, null, "Formato de token inválido");
      }

      const token = parts[1];

      // Decodificar el token ignorando la expiración
      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET, {
          ignoreExpiration: true // Permitir tokens expirados
        });
      } catch (error) {
        return sendResponse(res, 401, null, "Token inválido o corrupto");
      }

      // Los tokens de impersonación no son renovables (deben expirar naturalmente)
      if (decoded.impersonated) {
        return sendResponse(res, 403, null, "Los tokens de impersonación no se pueden renovar");
      }

      // Verificar que el token no sea muy antiguo (máx 30 días)
      const tokenPayload = jwt.decode(token);
      const issuedAt = tokenPayload.iat * 1000; // Convertir a ms
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 días

      if (Date.now() - issuedAt > maxAge) {
        return sendResponse(res, 401, null, "Token muy antiguo. Por favor, inicia sesión nuevamente");
      }

      // Si el token trae `sid`, validar que la sesión siga viva. Sin esto, un
      // dispositivo revocado se re-emitiría un token nuevo en el próximo refresh
      // (el interceptor del frontend refresca automáticamente antes de expirar
      // y ante cualquier 401), anulando en la práctica la revocación.
      let sessionId = decoded.sid || null;
      if (sessionId) {
        const session = await Session.findById(sessionId);
        if (!session || session.revokedAt) {
          return sendResponse(res, 401, null, "Sesión cerrada. Por favor, inicia sesión nuevamente");
        }
        session.expiresAt = new Date(Date.now() + SESSION_TTL_MS);
        session.lastActiveAt = new Date();
        await session.save();
      } else if (decoded.userType === "admin" || decoded.userType === "employee") {
        // Token legacy emitido antes de este cambio: arranca el tracking recién ahora.
        // (Los tokens de superadmin nunca llevan `sid` — quedan fuera a propósito.)
        try {
          const user =
            decoded.userType === "admin"
              ? await Organization.findById(decoded.userId)
              : await Employee.findById(decoded.userId);
          if (user) {
            const session = await Session.create({
              organizationId: decoded.userType === "admin" ? user._id : user.organizationId,
              userId: user._id,
              userType: decoded.userType,
              displayName: decoded.userType === "admin" ? user.ownerName || user.name : user.names,
              ip: getClientIp(req),
              userAgent: req.headers["user-agent"] || "unknown",
              expiresAt: new Date(Date.now() + SESSION_TTL_MS),
            });
            sessionId = session._id.toString();
          }
        } catch (bootstrapError) {
          // No bloquear el refresh por esto — el tracking es best-effort para tokens legacy.
          console.error("[refresh] No se pudo iniciar tracking de sesión legacy:", bootstrapError.message);
        }
      }

      // Generar nuevo token (mismo `sid` si ya existía, para que sea la misma sesión)
      const newToken = jwt.sign(
        { userId: decoded.userId, userType: decoded.userType, ...(sessionId && { sid: sessionId }) },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Calcular tiempo de expiración
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

      sendResponse(
        res,
        200,
        {
          token: newToken,
          sessionId,
          userId: decoded.userId,
          userType: decoded.userType,
          expiresAt,
        },
        "Token renovado exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, "Error al renovar el token: " + error.message);
    }
  },
};

export default authController;
