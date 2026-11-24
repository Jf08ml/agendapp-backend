// Carga masiva de servicios (POST /api/services/bulk-upload): reglas puras,
// sin DB, para probarlas con `node --test`.
//
// Antes:
//   - el organizationId venía del body y una fila con _id actualizaba ese
//     servicio aunque fuera de otro negocio (findByIdAndUpdate sin filtro);
//   - al actualizar, una columna vacía o ausente del Excel borraba el dato
//     (descripción, categoría) o lo dejaba en false (destacado, ocultar precio)
//     y una fila sin «Activo» reactivaba el servicio.
// Ahora el negocio sale de la sesión y al actualizar solo se tocan los campos
// que vienen en la fila.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PLACEHOLDER_ID = "(dejar vacío para crear nuevo)";

const isSuperadmin = (user) => user?.userType === "superadmin" && !!user?.adminId;

/**
 * Negocio sobre el que se carga. `userOrgId` es el negocio del usuario
 * (admin: su id; empleado: el de su ficha). Devuelve { orgId } o { error, status }.
 */
export function bulkOrganization({ user, userOrgId, bodyOrgId }) {
  const body = bodyOrgId ? String(bodyOrgId) : "";
  if (isSuperadmin(user)) {
    return body && OBJECT_ID.test(body)
      ? { orgId: body }
      : { error: "Se requiere el ID de la organización", status: 400 };
  }
  if (!userOrgId) return { error: "No tienes acceso a esta organización", status: 403 };
  if (body && body !== String(userOrgId)) return { error: "No tienes acceso a esta organización", status: 403 };
  return { orgId: String(userOrgId) };
}

const present = (v) => v !== undefined && v !== null && v !== "";

function yesNo(v) {
  if (v === true || v === false) return v;
  const t = String(v).trim().toLowerCase();
  if (["true", "sí", "si", "1"].includes(t)) return true;
  if (["false", "no", "0"].includes(t)) return false;
  return undefined;
}

/**
 * Valida una fila y arma lo que se guarda.
 * - Crear: todos los campos con sus valores por defecto (activo si no dice «No»).
 * - Actualizar: solo los campos que vienen en la fila (`$set`).
 * Devuelve { error } o { action: "create" | "update", id?, data }.
 */
export function bulkServiceRow(row = {}) {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name || !present(row.price) || !present(row.duration)) {
    return { error: "Nombre, precio y duración son obligatorios" };
  }
  const price = parseFloat(row.price);
  const duration = parseInt(row.duration, 10);
  if (Number.isNaN(price) || price < 0) return { error: "El precio debe ser un número válido mayor o igual a 0" };
  if (Number.isNaN(duration) || duration <= 0) return { error: "La duración debe ser un número válido mayor a 0" };

  let maxConcurrentAppointments;
  if (present(row.maxConcurrentAppointments)) {
    maxConcurrentAppointments = parseInt(row.maxConcurrentAppointments, 10);
    if (Number.isNaN(maxConcurrentAppointments) || maxConcurrentAppointments < 1) {
      return { error: "Las citas concurrentes deben ser un número válido mayor o igual a 1" };
    }
  }

  const id = present(row._id) ? String(row._id).trim() : "";
  const isUpdate = !!id && id !== PLACEHOLDER_ID;
  if (isUpdate && !OBJECT_ID.test(id)) return { error: "Ese ID no es de uno de tus servicios" };

  const hidePrice = yesNo(row.hidePrice);
  const featured = yesNo(row.featured);
  const isActive = present(row.isActive) ? yesNo(row.isActive) : undefined;

  if (!isUpdate) {
    return {
      action: "create",
      data: {
        name,
        type: present(row.type) ? String(row.type).trim() : "",
        description: present(row.description) ? String(row.description).trim() : "",
        price,
        duration,
        hidePrice: hidePrice === true,
        featured: featured === true,
        maxConcurrentAppointments: maxConcurrentAppointments ?? 1,
        isActive: isActive !== false,
      },
    };
  }

  const data = { name, price, duration };
  if (present(row.type)) data.type = String(row.type).trim();
  if (present(row.description)) data.description = String(row.description).trim();
  if (hidePrice !== undefined) data.hidePrice = hidePrice;
  if (featured !== undefined) data.featured = featured;
  if (maxConcurrentAppointments !== undefined) data.maxConcurrentAppointments = maxConcurrentAppointments;
  if (isActive !== undefined) data.isActive = isActive;
  return { action: "update", id, data };
}
