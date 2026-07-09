import clientService from "../../services/clientService.js";

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
];
