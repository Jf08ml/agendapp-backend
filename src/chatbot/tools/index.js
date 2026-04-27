import serviceTools from "./services.js";
import employeeTools from "./employees.js";
import organizationTools from "./organization.js";
import appointmentTools from "./appointments.js";

export default [...organizationTools, ...serviceTools, ...employeeTools, ...appointmentTools];
