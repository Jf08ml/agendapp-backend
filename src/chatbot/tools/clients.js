import moment from "moment-timezone";
import mongoose from "mongoose";
import clientService from "../../services/clientService.js";
import Client from "../../models/clientModel.js";
import Appointment from "../../models/appointmentModel.js";
import { findClientsByName, findClientsByPhone } from "./appointments.js";

const CANCELLED_STATUSES = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

const formatClient = (c, timezone) => ({
  id: c._id.toString(),
  name: c.name,
  phone: c.phone_e164 || c.phoneNumber || null,
  email: c.email || null,
  documentId: c.documentId || null,
  registeredAt: c.createdAt ? moment(c.createdAt).tz(timezone).format("YYYY-MM-DD HH:mm") : null,
});

// Resuelve UN cliente a partir de nombre/teléfono/email/documento. Devuelve
// { client } o { response } con el objeto que el handler debe devolver tal cual.
async function resolveSingleClient(organizationId, { clientId, clientName, clientPhone }) {
  if (clientId && mongoose.Types.ObjectId.isValid(clientId)) {
    const c = await Client.findOne({ _id: clientId, organizationId });
    if (c) return { client: c };
  }
  let matches = [];
  if (clientPhone) matches = await findClientsByPhone(organizationId, clientPhone);
  if (matches.length === 0 && clientName) matches = await findClientsByName(organizationId, clientName);
  if (matches.length === 0) {
    return { response: { success: false, error: "No encontré ningún cliente con esos datos." } };
  }
  if (matches.length > 1) {
    return {
      response: {
        success: false,
        multipleFound: true,
        candidates: matches.slice(0, 10).map((c) => ({ id: c._id.toString(), name: c.name, phone: c.phone_e164 || c.phoneNumber || null })),
        _instruction: "Hay varios clientes que coinciden. Muéstraselos al usuario y vuelve a llamar con el clientId del correcto.",
      },
    };
  }
  return { client: matches[0] };
}

// Debe reflejar DEFAULT_CLIENT_FORM_CONFIG del frontend
// (agendapp-frontend/src/services/organizationService.ts) — si esos defaults
// cambian allá, hay que actualizarlos aquí también.
const DEFAULT_CLIENT_FIELDS = [
  { key: "name", enabled: true, required: true },
  { key: "phone", enabled: true, required: true },
  { key: "email", enabled: true, required: false },
  { key: "birthDate", enabled: true, required: false },
  { key: "documentId", enabled: false, required: false },
  { key: "notes", enabled: false, required: false },
];

const FIELD_LABELS = {
  name: "nombre",
  phone: "teléfono",
  email: "correo electrónico",
  birthDate: "fecha de nacimiento",
  documentId: "número de documento",
  notes: "notas",
};

const getFieldConfig = (configFields, key) =>
  configFields.find((f) => f.key === key) ||
  DEFAULT_CLIENT_FIELDS.find((f) => f.key === key);

// Determina qué campos son obligatorios según el formulario de cliente configurado
// por la organización (Configuración del negocio → Formulario cliente), replicando
// exactamente las reglas de ClientFormModal.tsx: el nombre y el teléfono siempre son
// obligatorios (el teléfono lo exige la plataforma para WhatsApp, sin importar el
// identificador elegido); además, el campo elegido como identificador (phone/email/
// documentId) es obligatorio como tal; y cualquier campo marcado required:true en el
// formulario (email, fecha de nacimiento, documento, notas) también se exige.
function getMissingRequiredFields(organization, params) {
  const identifierField = organization?.clientFormConfig?.identifierField || "phone";
  const configFields = organization?.clientFormConfig?.fields?.length
    ? organization.clientFormConfig.fields
    : DEFAULT_CLIENT_FIELDS;
  const fieldCfg = (key) => getFieldConfig(configFields, key);

  const missing = [];

  if (!params.name?.trim()) missing.push(FIELD_LABELS.name);
  if (!params.phone) missing.push(FIELD_LABELS.phone);

  if (identifierField === "email" && !params.email) {
    missing.push(`${fieldCfg("email").label || FIELD_LABELS.email} (identificador configurado por el negocio)`);
  }
  if (identifierField === "documentId" && !params.documentId) {
    missing.push(`${fieldCfg("documentId").label || FIELD_LABELS.documentId} (identificador configurado por el negocio)`);
  }

  if (identifierField !== "email" && fieldCfg("email").required && !params.email) {
    missing.push(fieldCfg("email").label || FIELD_LABELS.email);
  }
  if (identifierField !== "documentId" && fieldCfg("documentId").required && !params.documentId) {
    missing.push(fieldCfg("documentId").label || FIELD_LABELS.documentId);
  }
  if (fieldCfg("birthDate").required && !params.birthDate) {
    missing.push(fieldCfg("birthDate").label || FIELD_LABELS.birthDate);
  }
  if (fieldCfg("notes").required && !params.notes) {
    missing.push(fieldCfg("notes").label || FIELD_LABELS.notes);
  }

  return [...new Set(missing)];
}

export default [
  {
    name: "create_client",
    description:
      "Crea un cliente nuevo directamente, SIN agendar ninguna cita. Úsala cuando el usuario pida registrar/dar de alta un cliente por su cuenta (ej: 'crea ese cliente', 'registra a Juan con este número', 'agrégalo a la base de datos') — no la confundas con create_appointments, que crea el cliente solo como efecto secundario de una cita. Los campos obligatorios dependen del formulario de cliente configurado por cada negocio (Configuración del negocio → Formulario cliente) — si falta algo, la tool te dirá exactamente qué pedir.",
    parameters: {
      name: { type: "string", description: "Nombre completo del cliente", required: true },
      phone: {
        type: "string",
        description: "Teléfono del cliente (cualquier formato; se normaliza automáticamente con el país por defecto de la organización). Casi siempre obligatorio.",
        required: false,
      },
      email: { type: "string", description: "Correo electrónico del cliente (obligatorio si el negocio lo configuró como identificador o como campo requerido)", required: false },
      documentId: { type: "string", description: "Número de documento o cédula (obligatorio si el negocio lo configuró como identificador o como campo requerido)", required: false },
      birthDate: { type: "string", description: "Fecha de nacimiento en formato YYYY-MM-DD (opcional salvo que el negocio la marque requerida). Conviértela si el usuario la da en otro formato.", required: false },
      notes: { type: "string", description: "Notas adicionales sobre el cliente (opcional salvo que el negocio las marque requeridas)", required: false },
    },
    handler: async (params, context) => {
      const missing = getMissingRequiredFields(context.organization, params);
      if (missing.length > 0) {
        return {
          success: false,
          missingFields: missing,
          error: `Faltan datos obligatorios según el formulario de cliente de este negocio: ${missing.join(", ")}.`,
          _instruction: "Pide al usuario exactamente estos datos faltantes (en un solo mensaje) y reintenta create_client con todos los campos completos.",
        };
      }

      const client = await clientService.createClient({
        name: params.name.trim(),
        phoneNumber: params.phone || undefined,
        email: params.email || undefined,
        documentId: params.documentId || undefined,
        birthDate: params.birthDate || undefined,
        notes: params.notes || undefined,
        organizationId: context.organizationId,
      });

      return {
        success: true,
        client: {
          id: client._id,
          name: client.name,
          phone: client.phone_e164 || client.phoneNumber || null,
          email: client.email || null,
        },
      };
    },
  },
  {
    name: "find_clients",
    description:
      "Busca clientes registrados del negocio por nombre, teléfono, correo o documento, o lista los registrados recientemente. Úsala para VERIFICAR si un cliente existe o quedó registrado (ej: 'no me aparece la clienta', '¿ya quedaron registradas?') y para ver sus datos de contacto. Nunca digas que no puedes consultar clientes.",
    parameters: {
      query: { type: "string", description: "Nombre, teléfono, correo o documento a buscar. Omítelo para listar los registrados recientemente.", required: false },
      registeredSince: { type: "string", description: "Solo clientes registrados desde esta fecha (YYYY-MM-DD). Útil para '¿cuántas clientas se registraron hoy?'.", required: false },
      limit: { type: "number", description: "Máximo de resultados (por defecto 20, máximo 50).", required: false },
    },
    handler: async (params, context) => {
      const { organizationId, organization } = context;
      const timezone = organization?.timezone || "America/Bogota";
      const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50);

      let clients = [];
      const filter = { organizationId };
      if (params.registeredSince) {
        const since = moment.tz(params.registeredSince, "YYYY-MM-DD", timezone);
        if (since.isValid()) filter.createdAt = { $gte: since.startOf("day").toDate() };
      }

      if (params.query?.trim()) {
        const q = params.query.trim();
        const digits = q.replace(/\D/g, "");
        if (digits.length >= 7 && digits.length >= q.replace(/\s/g, "").length - 2) {
          clients = await findClientsByPhone(organizationId, q);
        } else if (q.includes("@")) {
          clients = await Client.find({ organizationId, email: q.toLowerCase() });
        } else {
          clients = await findClientsByName(organizationId, q);
          if (clients.length === 0) clients = await Client.find({ organizationId, documentId: q });
        }
        if (filter.createdAt) clients = clients.filter((c) => c.createdAt >= filter.createdAt.$gte);
      } else {
        clients = await Client.find(filter).sort({ createdAt: -1 }).limit(limit);
      }

      const total = await Client.countDocuments(filter);
      return {
        success: true,
        found: clients.length,
        totalClientsMatchingDateFilter: total,
        clients: clients.slice(0, limit).map((c) => formatClient(c, timezone)),
      };
    },
  },
  {
    name: "get_inactive_clients",
    description:
      "Lista los clientes cuya ÚLTIMA cita (pasada, no cancelada) fue hace N días o más — ej: 'clientas que llevan 14 días o más sin venir'. Calcula la última visita real de cada cliente sobre TODO su historial (no solo un rango de fechas). Indica también si ya tienen una cita futura agendada.",
    parameters: {
      minDays: { type: "number", description: "Días mínimos desde la última cita (ej: 14).", required: true },
      maxDays: { type: "number", description: "Opcional: días máximos (para excluir clientes muy antiguos, ej: 180).", required: false },
      excludeWithUpcoming: { type: "boolean", description: "Si es true, excluye a quienes ya tienen una cita futura agendada. Por defecto true.", required: false },
    },
    handler: async (params, context) => {
      const { organizationId, organization } = context;
      const timezone = organization?.timezone || "America/Bogota";
      const now = new Date();
      const minDays = Math.max(Number(params.minDays) || 0, 0);
      const cutoff = moment(now).subtract(minDays, "days").toDate();
      const lowerBound = params.maxDays ? moment(now).subtract(Number(params.maxDays), "days").toDate() : null;
      const orgObjectId = new mongoose.Types.ObjectId(String(organizationId));

      const lastVisits = await Appointment.aggregate([
        { $match: { organizationId: orgObjectId, startDate: { $lt: now }, status: { $nin: CANCELLED_STATUSES } } },
        { $group: { _id: "$client", lastVisit: { $max: "$startDate" } } },
        {
          $match: {
            lastVisit: { $lte: cutoff, ...(lowerBound ? { $gte: lowerBound } : {}) },
          },
        },
        { $sort: { lastVisit: -1 } },
        { $limit: 200 },
      ]);

      const clientIds = lastVisits.map((v) => v._id).filter(Boolean);
      const upcoming = await Appointment.distinct("client", {
        organizationId: orgObjectId,
        client: { $in: clientIds },
        startDate: { $gte: now },
        status: { $nin: CANCELLED_STATUSES },
      });
      const upcomingSet = new Set(upcoming.map((id) => id.toString()));
      const clients = await Client.find({ _id: { $in: clientIds } }).select("name phone_e164 phoneNumber").lean();
      const clientMap = new Map(clients.map((c) => [c._id.toString(), c]));

      const excludeUpcoming = params.excludeWithUpcoming !== false;
      const rows = lastVisits
        .filter((v) => clientMap.has(String(v._id)))
        .filter((v) => !(excludeUpcoming && upcomingSet.has(String(v._id))))
        .map((v) => {
          const c = clientMap.get(String(v._id));
          return {
            name: c.name,
            phone: c.phone_e164 || c.phoneNumber || null,
            lastVisit: moment(v.lastVisit).tz(timezone).format("YYYY-MM-DD"),
            daysSince: moment(now).diff(moment(v.lastVisit), "days"),
            hasUpcomingAppointment: upcomingSet.has(String(v._id)),
          };
        });

      return {
        success: true,
        count: rows.length,
        clients: rows.slice(0, 100),
        _instruction:
          "Estas fechas son la última cita REGISTRADA en la agenda. Si el usuario dice que una clienta vino más recientemente, esa visita no está registrada como cita — explícaselo; no digas que vas a 'actualizar' la fecha.",
      };
    },
  },
  {
    name: "update_client",
    description:
      "Edita los datos de un cliente que YA existe: nombre, teléfono, correo, documento, fecha de nacimiento o notas. Identifica al cliente por nombre, teléfono o clientId. Solo envía los campos que cambian.",
    parameters: {
      clientId: { type: "string", description: "id del cliente (de find_clients), si lo tienes", required: false },
      clientName: { type: "string", description: "Nombre actual del cliente para buscarlo", required: false },
      clientPhone: { type: "string", description: "Teléfono actual del cliente para buscarlo", required: false },
      newName: { type: "string", description: "Nuevo nombre", required: false },
      newPhone: { type: "string", description: "Nuevo teléfono (cualquier formato)", required: false },
      newEmail: { type: "string", description: "Nuevo correo", required: false },
      newDocumentId: { type: "string", description: "Nuevo número de documento", required: false },
      newBirthDate: { type: "string", description: "Nueva fecha de nacimiento YYYY-MM-DD", required: false },
      newNotes: { type: "string", description: "Nuevas notas (reemplazan las anteriores)", required: false },
    },
    handler: async (params, context) => {
      const { organizationId } = context;
      const resolved = await resolveSingleClient(organizationId, params);
      if (resolved.response) return resolved.response;

      const changes = {};
      if (params.newName) changes.name = params.newName.trim();
      if (params.newPhone) changes.phoneNumber = params.newPhone;
      if (params.newEmail) changes.email = params.newEmail.trim().toLowerCase();
      if (params.newDocumentId) changes.documentId = params.newDocumentId;
      if (params.newBirthDate) changes.birthDate = params.newBirthDate;
      if (params.newNotes !== undefined) changes.notes = params.newNotes;
      if (Object.keys(changes).length === 0) {
        return { success: false, error: "No indicaste ningún dato para cambiar." };
      }

      try {
        const updated = await clientService.updateClient(resolved.client._id, changes);
        return {
          success: true,
          client: {
            id: updated._id.toString(),
            name: updated.name,
            phone: updated.phone_e164 || updated.phoneNumber || null,
            email: updated.email || null,
            documentId: updated.documentId || null,
          },
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },
];
