// Validación de horarios "HH:mm" (24 h). Se compara como string: con el formato
// "HH:mm" estricto, el orden alfabético coincide con el cronológico.

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Error legible si el rango no es válido (horas mal formadas o fin <= inicio), o null.
 * No hay horarios que crucen la medianoche: un cierre "07:00" con apertura "09:00"
 * casi siempre es un 19:00 al que se le pasó el AM/PM, y deja el día sin cupos.
 */
export const validateTimeRange = (start, end, label) => {
  if (!TIME_RE.test(start ?? "") || !TIME_RE.test(end ?? "")) {
    return `${label}: la hora de inicio y la de fin deben tener formato "HH:mm".`;
  }
  if (start >= end) {
    return `${label}: la hora de fin (${end}) debe ser posterior a la de inicio (${start}). Revisa si es AM o PM.`;
  }
  return null;
};

/**
 * Valida weeklySchedule.schedule. `openKey` es "isOpen" (organización) o
 * "isAvailable" (empleado); un día solo se valida si está abierto.
 */
export const validateWeeklyScheduleDays = (days, openKey = "isOpen") => {
  for (const d of days || []) {
    if (d?.[openKey] === false) continue;
    const dayName = DAY_NAMES[d?.day] ?? `día ${d?.day}`;
    const error = validateTimeRange(d?.start, d?.end, `Horario del ${dayName}`);
    if (error) return error;
    for (const b of d?.breaks || []) {
      const breakError = validateTimeRange(b?.start, b?.end, `Descanso del ${dayName}`);
      if (breakError) return breakError;
    }
  }
  return null;
};
