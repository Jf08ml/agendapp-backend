// «Próximo horario libre» de las landings (design system, LandingNegocio y
// LandingEsencial · Fase 3): el primer horario en que se puede reservar un
// servicio en línea, buscado día por día con las mismas reglas que la reserva
// (profesionales visibles, horario, festivos, excepciones, citas y cupos).
// Endpoint liviano: resultado en memoria 60 s por negocio y servicio.
import moment from "moment-timezone";
import organizationModel from "../models/organizationModel.js";
import employeeModel from "../models/employeeModel.js";
import appointmentModel from "../models/appointmentModel.js";
import serviceModel from "../models/serviceModel.js";
import scheduleService from "./scheduleService.js";
import { ONLINE_SELECTABLE_EMPLOYEE } from "../utils/onlineBooking.js";
import { withHolds } from "./paymentHoldService.js";

const SEARCH_DAYS = 14;
const CACHE_MS = 60 * 1000;
const cache = new Map();

/**
 * Servicio por defecto: uno que se reserva en línea (no «cotizar por WhatsApp»),
 * activo; primero los destacados y, entre ellos, el primero creado.
 */
export function pickDefaultService(services) {
  const bookable = (services || []).filter((s) => s && s.isActive !== false && s.ctaMode !== "whatsapp_quote");
  return bookable.find((s) => s.featured === true) || bookable[0] || null;
}

/** El horario disponible más temprano entre varios profesionales: { datetime, employeeId } o null. */
export function earliestSlot(slotsByEmployee, now = new Date()) {
  let best = null;
  for (const { employeeId, slots } of slotsByEmployee) {
    for (const s of slots || []) {
      if (!s.available) continue;
      const t = new Date(s.datetime);
      if (t <= now) continue;
      if (!best || t < best.datetime) best = { datetime: t, employeeId };
      break; // los slots vienen en orden: el primero libre de cada profesional basta
    }
  }
  return best;
}

const CANCELLED = ["cancelled", "cancelled_by_customer", "cancelled_by_admin"];

/**
 * @returns {Promise<null | { datetime: Date, date: string, time: string, serviceId: string, serviceName: string, employeeId: string }>}
 */
export async function findNextFreeSlot(organizationId, serviceId) {
  const key = `${organizationId}:${serviceId || ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const value = await compute(organizationId, serviceId);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function compute(organizationId, serviceId) {
  const org = await organizationModel.findById(organizationId);
  if (!org || org.enableOnlineBooking === false) return null;
  const timezone = org.timezone || "America/Bogota";

  let service = null;
  if (serviceId) {
    service = await serviceModel.findOne({ _id: serviceId, organizationId }).lean();
    if (service && (service.isActive === false || service.ctaMode === "whatsapp_quote")) service = null;
  } else {
    const all = await serviceModel.find({ organizationId }).sort({ _id: 1 }).lean();
    service = pickDefaultService(all);
  }
  if (!service) return null;

  const employees = await employeeModel.find({
    organizationId,
    isActive: true,
    ...ONLINE_SELECTABLE_EMPLOYEE,
    services: service._id,
  });
  if (employees.length === 0) return null;

  const duration = Math.max(Number(service.duration) || 30, 5);
  const maxConcurrent = service.maxConcurrentAppointments ?? 1;
  const today = moment.tz(timezone).startOf("day");

  for (let i = 0; i < SEARCH_DAYS; i++) {
    const day = today.clone().add(i, "days");
    const date = day.format("YYYY-MM-DD");
    if (scheduleService.isBlockedHoliday(date, org)) continue;

    const dayEnd = day.clone().endOf("day").toDate();
    const appointments = await withHolds(
      await appointmentModel
        .find({
          organizationId,
          employee: { $in: employees.map((e) => e._id) },
          startDate: { $gte: day.toDate(), $lte: dayEnd },
          status: { $nin: CANCELLED },
        })
        .lean(),
      { organizationId, employeeIds: employees.map((e) => e._id), from: day.toDate(), to: dayEnd } // + cupos apartados
    );

    const slotsByEmployee = employees.map((emp) => ({
      employeeId: String(emp._id),
      slots: scheduleService.generateAvailableSlots(
        date,
        org,
        emp,
        duration,
        appointments.filter((a) => String(a.employee) === String(emp._id)),
        maxConcurrent,
        service._id
      ),
    }));
    const best = earliestSlot(slotsByEmployee);
    if (best) {
      return {
        datetime: best.datetime,
        date,
        time: moment.tz(best.datetime, timezone).format("HH:mm"),
        serviceId: String(service._id),
        serviceName: service.name,
        employeeId: best.employeeId,
      };
    }
  }
  return null;
}

export default { findNextFreeSlot, pickDefaultService, earliestSlot };
