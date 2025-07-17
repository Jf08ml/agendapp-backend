import organizationModel from "../models/organizationModel.js";

export async function organizationResolver(req, res, next) {
  const host = req.headers.host.split(":")[0];

  // .populate('role') para traer el documento de rol referenciado
  const org = await organizationModel
    .findOne({ domain: host })
    .populate("role");

  if (!org)
    return res
      .status(404)
      .json({ error: "Organización no encontrada por dominio" });

  req.organization = org;
  next();
}
