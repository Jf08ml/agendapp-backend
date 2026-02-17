// scripts/fixMissingPackageSessions.js
// Corrige sesiones no descontadas de paquetes para citas creadas desde reservas manuales aprobadas
//
// Uso: node --require @babel/register scripts/fixMissingPackageSessions.js [--dry-run]
//
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Appointment from '../src/models/appointmentModel.js';
import ClientPackage from '../src/models/clientPackageModel.js';
import '../src/models/clientModel.js';
import '../src/models/serviceModel.js';

dotenv.config({ path: '.env.development' });

const ORG_ID = '699236f8813a03ab55b8e378';
const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  try {
    await mongoose.connect(process.env.DB_URI);
    console.log('✅ Conectado a MongoDB');
    console.log(DRY_RUN ? '🔍 MODO DRY-RUN (no se harán cambios)\n' : '⚡ MODO EJECUCIÓN\n');

    // 1) Buscar todos los ClientPackage activos o exhausted de esta organización
    const packages = await ClientPackage.find({
      organizationId: new mongoose.Types.ObjectId(ORG_ID),
      status: { $in: ['active', 'exhausted'] },
    }).populate('clientId', 'name phoneNumber');

    console.log(`📦 Paquetes encontrados: ${packages.length}\n`);

    let totalFixed = 0;

    for (const pkg of packages) {
      const clientId = pkg.clientId?._id || pkg.clientId;
      const clientName = pkg.clientId?.name || 'Sin nombre';

      // IDs de citas ya registradas en el historial de consumo
      const consumedAppointmentIds = new Set(
        pkg.consumptionHistory.map(h => h.appointmentId.toString())
      );

      // Para cada servicio del paquete, buscar citas del cliente con ese servicio
      for (const svc of pkg.services) {
        const serviceId = svc.serviceId;

        // Buscar citas del cliente para este servicio que NO estén canceladas
        const appointments = await Appointment.find({
          client: clientId,
          service: serviceId,
          organizationId: new mongoose.Types.ObjectId(ORG_ID),
          status: { $nin: ['cancelled', 'cancelled_by_admin', 'cancelled_by_customer'] },
        }).populate('service', 'name').sort({ startDate: 1 });

        // Filtrar las que NO están en consumptionHistory
        const missing = appointments.filter(apt => !consumedAppointmentIds.has(apt._id.toString()));

        if (missing.length === 0) continue;

        console.log(`👤 ${clientName} | Servicio: ${missing[0].service?.name || serviceId}`);
        console.log(`   Citas totales: ${appointments.length}, Ya descontadas: ${appointments.length - missing.length}, Faltantes: ${missing.length}`);
        console.log(`   Sesiones actuales: usadas=${svc.sessionsUsed}, restantes=${svc.sessionsRemaining}, incluidas=${svc.sessionsIncluded}`);

        for (const apt of missing) {
          const dateStr = apt.startDate ? new Date(apt.startDate).toISOString().slice(0, 16) : '?';
          console.log(`   🔧 Cita ${apt._id} (${dateStr}) - falta descontar`);

          if (!DRY_RUN) {
            // Solo descontar si hay sesiones restantes
            if (svc.sessionsRemaining > 0) {
              const updated = await ClientPackage.findOneAndUpdate(
                {
                  _id: pkg._id,
                  'services.serviceId': serviceId,
                  'services.sessionsRemaining': { $gt: 0 },
                },
                {
                  $inc: {
                    'services.$.sessionsUsed': 1,
                    'services.$.sessionsRemaining': -1,
                  },
                  $push: {
                    consumptionHistory: {
                      appointmentId: apt._id,
                      serviceId: serviceId,
                      action: 'consume',
                      date: new Date(),
                    },
                  },
                },
                { new: true }
              );

              if (updated) {
                // Actualizar referencia local
                const updatedSvc = updated.services.find(s => s.serviceId.toString() === serviceId.toString());
                if (updatedSvc) {
                  svc.sessionsUsed = updatedSvc.sessionsUsed;
                  svc.sessionsRemaining = updatedSvc.sessionsRemaining;
                }
                totalFixed++;
                console.log(`   ✅ Sesión descontada (restantes: ${svc.sessionsRemaining})`);

                // Verificar si todas agotadas
                const allExhausted = updated.services.every(s => s.sessionsRemaining <= 0);
                if (allExhausted && updated.status !== 'exhausted') {
                  updated.status = 'exhausted';
                  await updated.save();
                  console.log(`   ⚠️ Paquete marcado como agotado`);
                }
              }
            } else {
              console.log(`   ⚠️ Sin sesiones restantes, no se puede descontar`);
            }
          } else {
            totalFixed++;
          }
        }
        console.log('');
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`📊 Total sesiones ${DRY_RUN ? 'por corregir' : 'corregidas'}: ${totalFixed}`);
    console.log(DRY_RUN ? '\n💡 Ejecuta sin --dry-run para aplicar los cambios' : '');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Desconectado de MongoDB');
  }
}

run();
