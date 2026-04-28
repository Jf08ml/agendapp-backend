import { getServices } from "./services.js";
import { getEmployeesForService } from "./employees.js";
import { getAvailableDates, getAvailableSlots } from "./availability.js";
import { prepareReservation } from "./reservation.js";

export default [
  getServices,
  getEmployeesForService,
  getAvailableDates,
  getAvailableSlots,
  prepareReservation,
];
