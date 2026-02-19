import authService from "../services/authService.js";
import sendResponse from "../utils/sendResponse.js";
import jwt from "jsonwebtoken";

const authController = {
  login: async (req, res) => {
    const { email, password, organizationId } = req.body;

    try {
      // Autenticar al usuario
      const user = await authService.authenticateUser(email, password, organizationId);

      // Generar el token JWT
      const token = jwt.sign(
        { userId: user._id, userType: user.userType },
        process.env.JWT_SECRET,
        { expiresIn: "7d" } // 7 días de validez
      );

      // Calcular tiempo de expiración
      const expiresIn = 7 * 24 * 60 * 60 * 1000; // 7 días en ms
      const expiresAt = new Date(Date.now() + expiresIn).toISOString();

      sendResponse(
        res,
        200,
        {
          token,
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

      // Generar nuevo token
      const newToken = jwt.sign(
        { userId: decoded.userId, userType: decoded.userType },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      // Calcular tiempo de expiración
      const expiresIn = 7 * 24 * 60 * 60 * 1000; // 7 días en ms
      const expiresAt = new Date(Date.now() + expiresIn).toISOString();

      sendResponse(
        res,
        200,
        {
          token: newToken,
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
