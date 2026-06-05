import { getServices } from "./services.js";
import { getEmployeesForService } from "./employees.js";
import { getAvailableDates, getAvailableSlots } from "./availability.js";
import { prepareReservation } from "./reservation.js";
import { getMyAppointments } from "./appointments.js";

export default [
  getServices,
  getEmployeesForService,
  getAvailableDates,
  getAvailableSlots,
  prepareReservation,
  getMyAppointments,
];
