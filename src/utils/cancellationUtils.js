const MAIN_DOMAIN = "agenditapp.com";

/**
 * Genera el link de cancelación pública para enviar al cliente
 * @param {string} token - Token de cancelación
 * @param {Object} organization - Objeto de organización con domains y slug
 * @param {string} source - Origen del enlace ('confirmation' o 'reminder')
 * @returns {string} URL completa de cancelación
 */
export const generateCancellationLink = (token, organization, source = 'confirmation') => {
  let baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (organization) {
    // 1. Dominio custom configurado → usarlo
    if (organization.domains && organization.domains.length > 0) {
      const domain = organization.domains[0];
      const protocol = domain.includes('localhost') ? 'http' : 'https';
      baseUrl = `${protocol}://${domain}`;
    }
    // 2. Slug → subdominio wildcard {slug}.agenditapp.com
    else if (organization.slug) {
      baseUrl = `https://${organization.slug}.${MAIN_DOMAIN}`;
    }
  }

  return `${baseUrl}/cancel?token=${token}&source=${source}`;
};

export default {
  generateCancellationLink,
};
