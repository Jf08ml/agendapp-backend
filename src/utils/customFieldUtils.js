// utils/customFieldUtils.js
// Campos personalizados por organización (Organization.clientFormConfig / storeFormConfig).
// Los 6 campos built-in (name/phone/email/birthDate/documentId/notes) siguen su propio
// manejo hardcodeado sin cambios — este módulo solo se ocupa de los campos que el admin
// agrega (key fuera de BUILT_IN_FIELD_KEYS).

export const BUILT_IN_FIELD_KEYS = ['name', 'phone', 'email', 'birthDate', 'documentId', 'notes'];

/**
 * Filtra un array de field configs (clientFormConfig.fields / storeFormConfig.fields)
 * a solo los campos personalizados habilitados.
 * @param {Array} fields
 * @returns {Array}
 */
export function getCustomFieldDefinitions(fields = []) {
  return (fields || []).filter((f) => f?.enabled && !BUILT_IN_FIELD_KEYS.includes(f.key));
}

/**
 * Valida los valores entrantes contra las definiciones de campos personalizados
 * (requerido/tipo/opciones) y los separa por scope.
 * @param {Array} fieldDefs - resultado de getCustomFieldDefinitions()
 * @param {Object} rawValues - { [key]: valor } enviado por el cliente
 * @param {Object} [opts]
 * @param {'client'|'booking'} [opts.forceScope] - ignora el scope guardado (usado por la
 *   tienda, que nunca crea Client y por lo tanto siempre trata sus campos como "booking")
 * @returns {{ clientValues: Object, bookingValues: Object }}
 * @throws {Error} con mensaje en español si falta un campo requerido o el valor es inválido
 */
export function validateAndSplitCustomFieldValues(fieldDefs = [], rawValues = {}, opts = {}) {
  const { forceScope } = opts;
  const clientValues = {};
  const bookingValues = {};

  for (const def of fieldDefs) {
    const raw = rawValues?.[def.key];
    const isEmpty = raw === undefined || raw === null || raw === '';

    if (def.required && isEmpty) {
      throw new Error(`El campo "${def.label || def.key}" es obligatorio.`);
    }
    if (isEmpty) continue;

    let value = raw;
    if (def.type === 'number') {
      value = Number(raw);
      if (Number.isNaN(value)) {
        throw new Error(`El campo "${def.label || def.key}" debe ser un número.`);
      }
    } else if (def.type === 'date') {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`El campo "${def.label || def.key}" debe ser una fecha válida.`);
      }
      value = d;
    } else if (def.type === 'select') {
      if (Array.isArray(def.options) && def.options.length > 0 && !def.options.includes(raw)) {
        throw new Error(`El campo "${def.label || def.key}" tiene un valor no permitido.`);
      }
    } else {
      value = String(raw).trim();
    }

    const scope = forceScope || def.scope || 'booking';
    if (scope === 'client') {
      clientValues[def.key] = value;
    } else {
      bookingValues[def.key] = value;
    }
  }

  return { clientValues, bookingValues };
}
