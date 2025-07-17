import organizationModel from "../models/organizationModel.js";

export async function organizationResolver(req, res, next) {
  // 1. Lee el header x-tenant-domain (usado por el frontend)
  let tenantDomain = req.headers["x-tenant-domain"];

  // 2. Si no viene (ejemplo: en Postman, o pruebas), toma el host del request HTTP
  if (!tenantDomain) {
    tenantDomain = req.headers.host?.split(":")[0];
  }

  // 3. Busca la organización por dominio en la base de datos
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
