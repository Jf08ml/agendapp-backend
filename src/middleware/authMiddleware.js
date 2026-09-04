import jwt from "jsonwebtoken";
import Session from "../models/sessionModel.js";

// Throttle de `lastActiveAt`: evita un write en DB en cada request autenticado.
// Solo afecta qué tan "fresco" se ve el timestamp en la lista de sesiones, nunca
// la decisión de auth — en un deploy multi-instancia cada instancia tiene su
// propio mapa, lo cual es aceptable para este propósito.
const LAST_ACTIVE_THROTTLE_MS = 5 * 60 * 1000;
const lastTouchBySessionId = new Map();

function touchSessionThrottled(sessionId) {
  const now = Date.now();
  const lastTouch = lastTouchBySessionId.get(sessionId) || 0;
  if (now - lastTouch < LAST_ACTIVE_THROTTLE_MS) return;

  lastTouchBySessionId.set(sessionId, now); // actualizar antes de que resuelva el write
  Session.updateOne({ _id: sessionId }, { lastActiveAt: new Date() }).catch(() => {});
}

/**
 * Middleware de autenticación JWT
 * Verifica que el usuario tenga un token válido
 */
export const verifyToken = async (req, res, next) => {
  try {
    // Obtener token del header Authorization
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        result: "error",
        message: "Token de autenticación no proporcionado"
      });
    }

    // Verificar formato "Bearer TOKEN"
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        result: "error",
        message: "Formato de token inválido. Use: Bearer {token}"
      });
    }

    const token = parts[1];

    // Verificar y decodificar el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Si el token trae `sid` (emitido tras este cambio), validar que la sesión
    // siga viva. Tokens legacy sin `sid` se saltean este chequeo por completo
    // (siguen siendo stateless hasta que expiren naturalmente).
    if (decoded.sid) {
      const session = await Session.findById(decoded.sid).select("revokedAt").lean();
      if (!session || session.revokedAt) {
        return res.status(401).json({
          result: "error",
          message: "Sesión cerrada. Por favor, inicia sesión nuevamente",
        });
      }
      touchSessionThrottled(decoded.sid);
    }

    // Agregar información del usuario al request.
    // adminId solo existe en tokens de superadmin (userType: 'superadmin').
    req.user = {
      userId: decoded.userId,
      userType: decoded.userType,
      adminId: decoded.adminId || null,
      // Claims de impersonación (presentes cuando userType=admin e impersonated=true)
      impersonated: decoded.impersonated || false,
      impersonatedBy: decoded.impersonatedBy || null,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        result: "error",
        message: "Token expirado. Por favor, inicia sesión nuevamente"
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        result: "error",
        message: "Token inválido"
      });
    }

    return res.status(500).json({
      result: "error",
      message: "Error al verificar el token"
    });
  }
};

/**
 * Middleware opcional de autenticación
 * No bloquea si no hay token, pero lo verifica si existe
 * Útil para endpoints que pueden funcionar con o sin autenticación
 */
export const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      // No hay token, continuar sin autenticación
      return next();
    }

    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      const token = parts[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      req.user = {
        userId: decoded.userId,
        userType: decoded.userType,
      };
    }
    
    next();
  } catch (error) {
    // Si hay error en el token opcional, continuar sin autenticación
    next();
  }
};

/**
 * Middleware para verificar permisos de administrador
 * Debe usarse DESPUÉS de verifyToken
 */
export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      result: "error",
      message: "Autenticación requerida" 
    });
  }

  if (req.user.userType !== 'admin') {
    return res.status(403).json({ 
      result: "error",
      message: "Acceso denegado. Se requieren permisos de administrador" 
    });
  }

  next();
};

/**
 * Middleware para verificar que el JWT pertenece a un superadmin de plataforma.
 * Debe usarse DESPUÉS de verifyToken.
 * El token debe tener userType: 'superadmin' y adminId.
 */
export const requireSuperAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      result: "error",
      message: "Autenticación requerida",
    });
  }

  if (req.user.userType !== "superadmin" || !req.user.adminId) {
    return res.status(403).json({
      result: "error",
      message: "Acceso denegado. Solo superadmins de plataforma.",
    });
  }

  next();
};
