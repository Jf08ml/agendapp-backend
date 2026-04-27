import cron from "node-cron";
import appointmentService from "../services/appointmentService.js";

/**
 * Sistema de Recordatorios Inteligente
 * 
 * Funcionamiento:
 * - Se ejecuta cada hora para verificar citas que requieren recordatorio
 * - Cada organización configura:
 *   * hoursBefore: Cuántas horas antes de la cita enviar (ej: 24h)
 *   * sendTimeStart/End: Rango horario permitido (ej: 7:00-20:00)
 * 
 * - Los recordatorios se envían EXACTAMENTE "hoursBefore" antes de cada cita
 * - Si la hora calculada está fuera del rango, se envía al inicio del rango
 * - Los envíos son distribuidos con delays aleatorios para evitar spam
 * - Si un cliente tiene varias citas el mismo día, recibe UN solo mensaje consolidado
 * 
 * Ejemplo:
 * - Cita: 8 de dic a las 3:00 PM
 * - Config: 24h antes, rango 7:00-20:00
 * - Envío: 7 de dic a las 3:00 PM (dentro del rango)
 */
const reminderJob = () => {
  cron.schedule(
    "*/30 * * * *", // Cada 30 minutos
    () => {
      const now = new Date();
      console.log(
        `[${now.toISOString()}] 🔔 Ejecutando verificación de recordatorios (Hora Colombia)`
      );
      appointmentService.sendDailyReminders();
    },
    {
      timezone: "America/Bogota",
    }
  );

  console.log("✅ Cron job de recordatorios iniciado - Se ejecutará cada hora");
};

export default reminderJob;
