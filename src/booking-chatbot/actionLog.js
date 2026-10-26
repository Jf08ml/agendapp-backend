import moment from "moment-timezone";

// Registro de acciones verificadas de una conversación de reservas.
//
// El historial que llega en cada turno es solo texto (sin los bloques de tools),
// así que el modelo no tenía cómo saber que lo que dijo antes sí pasó. Caso real
// (Centro de belleza angel's, 2026-10-24): canceló 4 citas de verdad y en el turno
// siguiente, al no verlas con get_my_appointments, le dijo a la clienta que la
// cancelación "no era real". Cada tool relevante deja aquí una línea con el
// resultado real; el prompt las recibe como hechos ya hechos.

export const MAX_ACTION_LOG = 30;

const compact = (s, max = 400) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Línea de registro para una tool ejecutada, o null si no aporta.
 * @returns {string|null}
 */
export function describeToolAction(name, input, result, organization) {
  if (!result) return null;
  const tz = organization?.timezone || "America/Bogota";

  switch (name) {
    case "get_my_appointments": {
      if (!result.found) return "Consultaste las citas del cliente: no está registrado con ese dato.";
      const list = (result.appointments || [])
        .map((a) => `${a.date} ${a.time} — ${a.service} con ${a.professional} (${a.status})`)
        .join("; ");
      return list
        ? `Consultaste las citas futuras de ${result.clientName}: ${compact(list, 600)}.`
        : `Consultaste las citas de ${result.clientName}: no tenía citas futuras activas en ese momento.`;
    }
    case "cancel_appointment":
      return result.success
        ? `CANCELASTE (confirmado por el sistema) la cita ${result.service} con ${result.professional} del ${result.fecha}. Ya no aparece entre sus citas futuras.`
        : null;
    case "reschedule_appointment":
      return result.success
        ? `REPROGRAMASTE (confirmado por el sistema) la cita ${result.service} con ${result.professional}: del ${result.de} al ${result.a}.`
        : null;
    case "get_available_slots": {
      if (!result.dateLabel) return null;
      const labels = (result.slots || []).map((s) => s.label);
      return labels.length
        ? `Horarios libres consultados para el ${result.dateLabel}${input?.employeeId ? " (con el profesional pedido)" : ""}: ${compact(labels.join(", "), 300).replace(/\.$/, "")}.`
        : `Horarios consultados para el ${result.dateLabel}: no había ninguno libre.`;
    }
    case "prepare_reservation": {
      if (!result.success) return null;
      if (result.summaryText) return `Mostraste el resumen de la reserva: ${compact(result.summaryText)}.`;
      const start = result.payload?.startDate
        ? moment(result.payload.startDate).tz(tz).format("dddd D [de] MMMM, h:mm A")
        : "";
      return `Preparaste la reserva (${start}); el cliente ve el botón para confirmarla. Aún no está creada hasta que lo toque.`;
    }
    case "confirm_reservation":
      if (!result.success) return null;
      return result.paymentUrl
        ? `La reserva quedó APARTADA y enviaste el enlace del abono (${result.depositAmount}, ${result.holdMinutes} min para pagar).`
        : "La reserva quedó CREADA (confirmado por el sistema).";
    default:
      return null;
  }
}

/**
 * Asistente del panel (src/chatbot): una línea por cada tool de escritura que
 * terminó bien. Mismo síntoma que en reservas: "Tienes razón — no ejecuté nada aún"
 * justo después de haber creado servicios, profesional y horario (Dentist clinic,
 * 2026-10-23). Las de lectura (get_/query_/find_) no se registran.
 */
export function describeAdminToolAction(name, input, result) {
  if (/^(get|query|find)_/.test(name)) return null;
  if (!result || result.success === false || result.error) return null;
  return `Ejecutaste ${name} con éxito (${compact(JSON.stringify(input || {}), 250)}).`;
}

/** Bloque de sistema con las acciones previas (no se cachea: cambia cada turno). */
export function actionLogPrompt(entries) {
  if (!entries?.length) return null;
  return (
    "ACCIONES YA REALIZADAS EN ESTA CONVERSACIÓN (registro del sistema, son hechos reales — " +
    "el historial solo muestra texto, pero esto sí pasó):\n" +
    entries.map((e) => `- ${e}`).join("\n") +
    "\n\nNunca digas que algo de esta lista no ocurrió ni te disculpes por ello. Si una cita cancelada " +
    "o reprogramada ya no aparece al consultar, es porque el cambio se hizo. Para disponibilidad usa " +
    "siempre los horarios consultados; si necesitas otra fecha u hora, consúltala antes de afirmar nada."
  );
}
