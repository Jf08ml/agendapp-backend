import jwt from "jsonwebtoken";

/**
 * Middleware de autenticación JWT
 * Verifica que el usuario tenga un token válido
 */
export const verifyToken = (req, res, next) => {
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
    
    // Agregar información del usuario al request
    req.user = {
      userId: decoded.userId,
      userType: decoded.userType,
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
 * Middleware para verificar que el usuario pertenece a la organización
 * Debe usarse DESPUÉS de verifyToken y organizationResolver
 */
export const requireOrganizationAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ 
      result: "error",
      message: "Autenticación requerida" 
    });
  }

  // Si hay un organizationId en el request, verificar que coincida
  const requestOrgId = req.organization?._id?.toString() || req.params.organizationId;
  
  if (requestOrgId && req.user.organizationId && 
      requestOrgId !== req.user.organizationId.toString()) {
    return res.status(403).json({ 
      result: "error",
      message: "No tienes acceso a esta organización" 
    });
  }

  next();
};
