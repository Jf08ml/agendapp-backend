import cron from "node-cron";
import appointmentService from "../services/appointmentService.js";

// Ejecutar todos los días a las 7:00 AM y 10:00 PM hora de Colombia
const reminderJob = () => {
  cron.schedule(
    "16 21 * * *",
    () => {
      console.log(
        "Ejecutando recordatorio a las 7:00 AM o 10:00 PM (Hora Colombia)"
      );
      appointmentService.sendDailyReminders();
    },
    {
      timezone: "America/Bogota",
    }
  );
};

export default reminderJob;
