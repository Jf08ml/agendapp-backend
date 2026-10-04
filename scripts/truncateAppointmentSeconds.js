/**
 * Script de migración: truncar segundos/milisegundos de startDate y endDate en citas.
 *
 * Problema: algunas citas fueron guardadas con segundos en sus timestamps
 * (ej: 14:00:54 en vez de 14:00:00), causando solapamientos falsos en la
 * validación de citas simultáneas al comparar con nuevas citas a horas exactas.
 *
 * Uso: node scripts/truncateAppointmentSeconds.js
 * Agregar --dry-run para ver cuántas citas afectadas sin modificar datos.
 */

import dbConnection from "../src/config/db.js";
import appointmentModel from "../src/models/appointmentModel.js";

const isDryRun = process.argv.includes('--dry-run');

function truncateToMinute(date) {
  return new Date(Math.floor(date.getTime() / 60000) * 60000);
}

async function truncateAppointmentSeconds() {
  console.log(`🔧 Truncando segundos de citas... (modo: ${isDryRun ? 'DRY-RUN' : 'REAL'})`);

  await dbConnection();

  // Encontrar citas con segundos o milisegundos en startDate o endDate
  const appointments = await appointmentModel.find({
    $or: [
      { $expr: { $ne: [{ $second: "$startDate" }, 0] } },
      { $expr: { $ne: [{ $millisecond: "$startDate" }, 0] } },
      { $expr: { $ne: [{ $second: "$endDate" }, 0] } },
      { $expr: { $ne: [{ $millisecond: "$endDate" }, 0] } },
    ]
  }, { _id: 1, startDate: 1, endDate: 1, organizationId: 1 });

  console.log(`📋 Citas con segundos encontradas: ${appointments.length}`);

  if (appointments.length === 0) {
    console.log('✅ No hay citas con desfase de segundos.');
    process.exit(0);
  }

  if (isDryRun) {
    appointments.slice(0, 10).forEach(a => {
      console.log(`  ID: ${a._id} | start: ${a.startDate.toISOString()} → ${truncateToMinute(a.startDate).toISOString()} | end: ${a.endDate.toISOString()} → ${truncateToMinute(a.endDate).toISOString()}`);
    });
    if (appointments.length > 10) console.log(`  ... y ${appointments.length - 10} más`);
    console.log('\n⚠️  Ejecuta sin --dry-run para aplicar los cambios.');
    process.exit(0);
  }

  let updated = 0;
  let errors = 0;

  for (const appt of appointments) {
    const newStart = truncateToMinute(appt.startDate);
    const newEnd = truncateToMinute(appt.endDate);

    try {
      await appointmentModel.updateOne(
        { _id: appt._id },
        { $set: { startDate: newStart, endDate: newEnd } }
      );
      updated++;
    } catch (err) {
      console.error(`❌ Error actualizando ${appt._id}:`, err.message);
      errors++;
    }
  }

  console.log(`✅ Actualizadas: ${updated} | Errores: ${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

truncateAppointmentSeconds().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
