export async function organizationResolver(req, res, next) {
  // 1. Prioridad: x-tenant-domain (enviado manualmente, útil para APIs con axios/fetch)
  let tenantDomain = req.headers["x-tenant-domain"];

  // 2. Si no existe, intenta x-forwarded-host (usado en rewrites/proxy de Vercel)
  if (!tenantDomain) {
    tenantDomain = req.headers["x-forwarded-host"]?.split(":")[0];
  }

  // 3. Fallback: host
  if (!tenantDomain) {
    tenantDomain = req.headers.host?.split(":")[0];
  }

  // 4. Busca la organización por dominio en la base de datos
  const org = await organizationModel
    .findOne({ domain: tenantDomain })
    .populate("role");

  if (!org)
    return res
      .status(404)
      .json({ error: `Organización no encontrada para el dominio ${tenantDomain}` });

  req.organization = org;
  next();
}
