/**
 * Genera el link de cancelación pública para enviar al cliente
 * @param {string} token - Token de cancelación
 * @returns {string} URL completa de cancelación
 */
export const generateCancellationLink = (token, organizationId) => {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${baseUrl}/cancel?token=${token}`;
};

export default {
  generateCancellationLink,
};
