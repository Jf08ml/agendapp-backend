import organizationModel from "../models/organizationModel.js";

export async function organizationResolver(req, res, next) {
  let tenantDomain =
    req.headers["x-tenant-domain"] ||
    req.headers["x-forwarded-host"]?.split(":")[0] ||
    req.headers.host?.split(":")[0];

  if (!tenantDomain) {
    return res.status(400).json({ error: "No se pudo determinar el dominio del cliente" });
  }

  const org = await organizationModel
    .findOne({ domains: tenantDomain }) // ahora usamos el array
    .populate("role");

  if (!org) {
    return res
      .status(404)
      .json({ error: `Organización no encontrada para el dominio ${tenantDomain}` });
  }

  req.organization = org;
  next();
}
