import organizationModel from "../models/organizationModel.js";

// Cache de dominios válidos para mejorar performance
let validDomainsCache = new Set();
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Actualiza el cache de dominios válidos desde la base de datos
 */
async function updateValidDomainsCache() {
  const now = Date.now();
  
  // Si el cache es reciente, no actualizar
  if (now - lastCacheUpdate < CACHE_TTL) {
    return;
  }

  try {
    // Obtener todos los dominios de todas las organizaciones
    const organizations = await organizationModel.find({}, 'domains').lean();
    
    validDomainsCache = new Set();
    
    organizations.forEach(org => {
      if (org.domains && Array.isArray(org.domains)) {
        org.domains.forEach(domain => {
          validDomainsCache.add(domain);
          // También agregar con https://
          validDomainsCache.add(`https://${domain}`);
          validDomainsCache.add(`http://${domain}`);
        });
      }
    });
    
    lastCacheUpdate = now;
    console.log(`✅ CORS cache actualizado: ${validDomainsCache.size} dominios válidos`);
  } catch (error) {
    console.error('❌ Error actualizando cache de dominios CORS:', error);
  }
}

/**
 * Verifica si un origin es válido para CORS
 */
function isValidOrigin(origin) {
  if (!origin) return true; // Permitir requests sin origin (mobile apps, Postman, webhooks)
  
  // Extraer solo el hostname del origin
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    
    // Verificar si el hostname está en el cache
    if (validDomainsCache.has(hostname)) {
      return true;
    }
    
    // Verificar si el origin completo está en el cache
    if (validDomainsCache.has(origin)) {
      return true;
    }
    
    // En desarrollo, permitir localhost
    if (process.env.NODE_ENV === 'development') {
      if (hostname.includes('localhost') || hostname.includes('127.0.0.1')) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error parseando origin:', origin, error);
    return false;
  }
}

/**
 * Middleware de CORS dinámico para plataforma multitenant
 */
export const dynamicCorsOptions = {
  origin: async (origin, callback) => {
    // Actualizar cache si es necesario
    await updateValidDomainsCache();
    
    // Verificar si el origin es válido
    if (isValidOrigin(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ CORS bloqueado para origin: ${origin}`);
      callback(new Error(`Origin ${origin} no permitido por CORS`));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Domain'],
};

/**
 * Función para forzar actualización del cache (útil cuando se agregan organizaciones)
 */
export async function refreshCorsCache() {
  lastCacheUpdate = 0;
  await updateValidDomainsCache();
}
