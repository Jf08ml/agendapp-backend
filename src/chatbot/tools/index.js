import serviceTools from "./services.js";
import employeeTools from "./employees.js";
import organizationTools from "./organization.js";
import appointmentTools from "./appointments.js";
import whatsappTemplateTools from "./whatsappTemplates.js";
import clientTools from "./clients.js";
import reservationTools from "./reservations.js";
import inventoryTools from "./inventory.js";
import storeOrderTools from "./storeOrders.js";
import packageTools from "./packages.js";
import classTools from "./classes.js";
import membershipTools from "./membership.js";
import auditLogTools from "./auditLog.js";
import waStatusTools from "./waStatus.js";
import expenseTools from "./expenses.js";

export default [
  ...organizationTools,
  ...serviceTools,
  ...employeeTools,
  ...appointmentTools,
  ...whatsappTemplateTools,
  ...clientTools,
  ...reservationTools,
  ...inventoryTools,
  ...storeOrderTools,
  ...packageTools,
  ...classTools,
  ...membershipTools,
  ...auditLogTools,
  ...waStatusTools,
  ...expenseTools,
];
