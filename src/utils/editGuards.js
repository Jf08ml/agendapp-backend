// Reglas para editar empleados y clientes (seguridad · roles a medida).
// Puras (sin DB) para `node --test`.
//
// Antes:
//   - PUT /employees/:id: cualquier sesión, de cualquier negocio, podía editar a
//     cualquier empleado (contraseña, correo, negocio, permisos de agenda).
//   - PUT /clients/:id era pública: sin sesión se podía cambiar nombre,
//     teléfono, correo o negocio de cualquier cliente conociendo su id.

const isSuperadmin = (user) => user?.userType === "superadmin" && !!user?.adminId;

/**
 * Qué puede cambiar quien edita a un empleado.
 * @returns {"all" | "order" | null}  null = nada (403)
 */
export function employeeEditScope({ user, permissions = [] }) {
  if (!user) return null;
  if (isSuperadmin(user) || user.userType === "admin") return "all";
  if (user.userType !== "employee") return null;
  if (permissions.includes("employees:update")) return "all";
  // Reordenar profesionales en la agenda manda el empleado completo: solo vale el orden
  if (permissions.includes("appointments:reorderemployees")) return "order";
  return null;
}

/** Campos que se aplican según el alcance; el negocio nunca cambia por esta ruta. */
export function filterEmployeeUpdate(body = {}, scope) {
  if (scope === "order") return body.order !== undefined ? { order: body.order } : {};
  if (scope !== "all") return {};
  const { organizationId, role, _id, ...rest } = body; // eslint-disable-line no-unused-vars
  return rest;
}

const digits = (v) => String(v ?? "").replace(/\D/g, "");
const norm = (v) => String(v ?? "").trim().toLowerCase();

/**
 * Edición pública de un cliente durante la reserva en línea: el cliente ya se
 * identificó con su teléfono, documento o correo (identifierField del
 * negocio) y la petición debe traer ese mismo dato. Solo cambia sus datos de
 * contacto; nunca el negocio ni el dato con el que se identificó.
 * @param {{ client, body, identifierField }} q
 * @returns {{ error: string } | { updates: object }}
 */
export function publicClientUpdate({ client, body = {}, identifierField = "phone" }) {
  const proof = body.identifier;
  if (!client || !proof || proof.field !== identifierField || !proof.value) {
    return { error: "No pudimos verificar tus datos. Vuelve a escribir tu identificación." };
  }
  const matches =
    identifierField === "phone"
      ? digits(proof.value) !== "" && digits(proof.value) === digits(client.phone_e164 || client.phoneNumber)
      : identifierField === "documentId"
        ? norm(proof.value) !== "" && norm(proof.value) === norm(client.documentId)
        : norm(proof.value) !== "" && norm(proof.value) === norm(client.email);
  if (!matches) return { error: "No pudimos verificar tus datos. Vuelve a escribir tu identificación." };

  const allowed = ["name", "email", "birthDate", "documentId", "notes", "customFieldValues", "phoneNumber", "phone_country"];
  const locked = identifierField === "phone" ? ["phoneNumber", "phone_country"] : [identifierField];
  const updates = {};
  for (const k of allowed) {
    if (locked.includes(k)) continue;
    if (body[k] !== undefined) updates[k] = body[k];
  }
  return { updates };
}
