/**
 * Genera el link de cancelación pública para enviar al cliente
 * @param {string} token - Token de cancelación
 * @param {Object} organization - Objeto de organización con domains
 * @returns {string} URL completa de cancelación
 */
export const generateCancellationLink = (token, organization) => {
  // Usar el dominio de la organización si existe, o el default del environment
  let baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  // Si la organización tiene dominios configurados, usar el primero
  if (organization && organization.domains && organization.domains.length > 0) {
    const domain = organization.domains[0];
    // Determinar si usar http o https
    const protocol = domain.includes('localhost') ? 'http' : 'https';
    baseUrl = `${protocol}://${domain}`;
  }
  
  return `${baseUrl}/cancel?token=${token}`;
};

export default {
  generateCancellationLink,
};
