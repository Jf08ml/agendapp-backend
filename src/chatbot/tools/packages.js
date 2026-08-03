import Client from "../../models/clientModel.js";
import packageService from "../../services/packageService.js";

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeForSearch = (str) =>
  String(str || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Búsqueda difusa de cliente por nombre o teléfono (mismo patrón que chatbot/tools/appointments.js)
async function findClient(organizationId, { clientName, clientPhone }) {
  if (clientPhone) {
    const digits = clientPhone.replace(/\D/g, "");
    const last10 = digits.slice(-10);
    const byPhone = await Client.find({
      organizationId,
      $or: [{ phone_e164: { $regex: `${last10}$` } }, { phoneNumber: { $regex: `${last10}$` } }],
    });
    if (byPhone.length > 0) return byPhone;
  }
  if (clientName) {
    const direct = await Client.find({ organizationId, name: { $regex: escapeRegex(clientName), $options: "i" } });
    if (direct.length > 0) return direct;

    const queryWords = normalizeForSearch(clientName).split(" ").filter(Boolean);
    if (queryWords.length === 0) return [];
    const clients = await Client.find({ organizationId });
    const scored = clients
      .map((c) => {
        const nameWords = normalizeForSearch(c.name).split(" ").filter(Boolean);
        const overlap = queryWords.filter((w) => nameWords.includes(w)).length;
        return { client: c, overlap };
      })
      .filter((s) => s.overlap >= Math.min(2, queryWords.length));
    if (scored.length === 0) return [];
    const maxOverlap = Math.max(...scored.map((s) => s.overlap));
    return scored.filter((s) => s.overlap === maxOverlap).map((s) => s.client);
  }
  return [];
}

export default [
  {
    name: "get_client_packages",
    description:
      "Consulta los paquetes de sesiones prepagadas de un cliente (plantilla comprada, sesiones usadas/restantes por servicio o clase, vigencia). Úsala cuando el usuario pregunte cuántas sesiones le quedan a un cliente o qué paquetes tiene.",
    parameters: {
      clientName: { type: "string", description: "Nombre parcial del cliente.", required: false },
      clientPhone: { type: "string", description: "Teléfono del cliente (con código de país). Prioridad sobre clientName.", required: false },
      onlyActive: { type: "boolean", description: "Si true, muestra solo paquetes activos y vigentes. Por defecto true.", required: false },
    },
    handler: async (params, context) => {
      if (!params.clientName && !params.clientPhone) {
        return { success: false, error: "Indica el nombre o teléfono del cliente." };
      }
      const clients = await findClient(context.organizationId, params);
      if (clients.length === 0) {
        return { success: false, error: `No se encontró ningún cliente con "${params.clientPhone || params.clientName}".` };
      }
      if (clients.length > 1) {
        return {
          success: false,
          multipleFound: true,
          message: `Encontré ${clients.length} clientes. ¿A cuál te refieres?`,
          clientes: clients.map((c) => ({ id: c._id, nombre: c.name, telefono: c.phone_e164 || c.phoneNumber || null })),
        };
      }

      const client = clients[0];
      const onlyActive = params.onlyActive !== false;
      const packages = onlyActive
        ? await packageService.getActiveClientPackages(client._id.toString(), context.organizationId)
        : await packageService.getClientPackages(client._id.toString(), context.organizationId);

      if (packages.length === 0) {
        return { success: true, found: false, cliente: client.name, message: onlyActive ? "Este cliente no tiene paquetes activos." : "Este cliente no tiene paquetes registrados." };
      }

      return {
        success: true,
        cliente: client.name,
        paquetes: packages.map((p) => ({
          id: p._id,
          nombre: p.servicePackageId?.name || "Paquete",
          nivel: p.tierLabel || null,
          estado: p.status,
          vigenciaHasta: p.expirationDate,
          servicios: (p.services || []).map((s) => ({
            servicio: s.serviceId?.name || "?",
            sesionesRestantes: s.sessionsRemaining,
            sesionesUsadas: s.sessionsUsed,
          })),
          clases: (p.classes || []).map((c) => ({
            clase: c.classId?.name || "?",
            sesionesRestantes: c.sessionsRemaining,
            sesionesUsadas: c.sessionsUsed,
          })),
        })),
      };
    },
  },
];
