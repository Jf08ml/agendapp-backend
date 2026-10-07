import { getAvailableSlots, getAvailableDates } from "../../booking-chatbot/tools/availability.js";

// Reutiliza exactamente el cálculo de disponibilidad del bot de reservas (mismos
// horarios, bloqueos y citas que ve el cliente en la reserva en línea). Antes el
// asistente admin respondía "no tengo acceso a disponibilidad en tiempo real".
export default [
  {
    ...getAvailableSlots,
    description:
      "Consulta los horarios libres de un día para un servicio (y opcionalmente un profesional) — los mismos que vería un cliente en la reserva en línea. Úsala cuando el usuario pregunte '¿qué horas tiene libres X el viernes?' o para proponer horario antes de crear una cita. serviceId y employeeId aceptan el id o el nombre.",
  },
  {
    ...getAvailableDates,
    description:
      "Busca los próximos días (hasta 10) con disponibilidad para un servicio (y opcionalmente un profesional). serviceId y employeeId aceptan el id o el nombre. Cada fecha trae su label con el día de la semana — úsalo tal cual.",
  },
];
