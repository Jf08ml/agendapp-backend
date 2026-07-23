import { getServices } from "./services.js";
import { getEmployeesForService } from "./employees.js";
import { getAvailableDates, getAvailableSlots } from "./availability.js";
import { prepareReservation } from "./reservation.js";
import { getMyAppointments, rescheduleAppointment } from "./appointments.js";
import { getOrganizationInfo } from "./organization.js";

export default [
  getServices,
  getEmployeesForService,
  getAvailableDates,
  getAvailableSlots,
  prepareReservation,
  getMyAppointments,
  rescheduleAppointment,
  getOrganizationInfo,
];
