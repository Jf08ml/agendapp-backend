import appointmentService from "../services/appointmentService.js";
import Organization from "../models/organizationModel.js";

const cronController = {
  runDailyReminder: async (req, res) => {
    try {
      // Llama al servicio de recordatorios
      await appointmentService.sendDailyReminders();
      res.status(200).json({ message: "Recordatorios enviados correctamente" });
    } catch (error) {
      console.error("Error al ejecutar el recordatorio:", error);
      res.status(500).json({ message: "Error interno del servidor" });
    }
  },

  // Auto-confirmar citas del día (todas las organizaciones activas)
  runAutoConfirmAppointments: async (req, res) => {
    try {
      const activeOrgs = await Organization.find({
        membershipStatus: { $ne: "suspended" }
      }).select("_id name timezone");

      let totalConfirmed = 0;
      let totalFailed = 0;
      const details = [];

      for (const org of activeOrgs) {
        try {
          const result = await appointmentService.autoConfirmTodayAppointments(org._id);
          totalConfirmed += result.confirmed.length;
          totalFailed += result.failed.length;
          details.push({
            organization: org.name,
            timezone: org.timezone,
            confirmed: result.confirmed.length,
            failed: result.failed.length,
          });
        } catch (err) {
          details.push({
            organization: org.name,
            error: err.message,
          });
        }
      }

      return res.status(200).json({
        code: 200,
        status: "success",
        data: {
          totalConfirmed,
          totalFailed,
          organizationsProcessed: activeOrgs.length,
          details,
        },
        message: "Auto-confirmación ejecutada",
      });
    } catch (error) {
      console.error("Error en auto-confirmación:", error);
      return res.status(500).json({ code: 500, status: "error", message: error.message });
    }
  },
};

export default cronController;
