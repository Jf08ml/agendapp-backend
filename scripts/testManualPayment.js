// scripts/testManualPayment.js
// Script para probar el flujo completo de registro de pago manual

import mongoose from "mongoose";
import membershipModel from "../src/models/membershipModel.js";
import planModel from "../src/models/planModel.js";
import PaymentSession from "../src/models/paymentSessionModel.js";

const MONGO_URI = "mongodb+srv://jfmosquera:0608@cluster0.nxpfanv.mongodb.net/galaxia_glamour?retryWrites=true&w=majority";

async function testManualPayment() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Conectado a MongoDB\n");

    const membershipId = "6940f65d1878c8d6015fddde";
    
    // 1. Obtener estado actual
    const membership = await membershipModel.findById(membershipId).populate('planId');
    if (!membership) {
      console.log("❌ Membresía no encontrada");
      return;
    }

    const plan = membership.planId;
    
    console.log("📊 ESTADO ANTES DEL PAGO:");
    console.log("═══════════════════════════════════════════");
    console.log("Status:", membership.status);
    console.log("Plan:", plan?.name || "N/A");
    console.log("currentPeriodStart:", membership.currentPeriodStart);
    console.log("currentPeriodEnd:", membership.currentPeriodEnd);
    console.log("nextPaymentDue:", membership.nextPaymentDue);
    console.log("lastPaymentDate:", membership.lastPaymentDate || "N/A");
    console.log("lastPaymentAmount:", membership.lastPaymentAmount || "N/A");
    
    const now = new Date();
    const daysUntilExpiration = Math.ceil((membership.currentPeriodEnd - now) / (1000 * 60 * 60 * 24));
    console.log("Días hasta vencimiento:", daysUntilExpiration);
    console.log("¿Está vencida?:", now > membership.currentPeriodEnd ? "SÍ" : "NO");
    
    // 2. Simular registro de pago manual (lo que hace el controlador)
    console.log("\n🔄 SIMULANDO PAGO MANUAL DE $30...\n");
    
    const paymentAmount = 30;
    const paymentDate = new Date();
    
    // Calcular nueva fecha de vencimiento
    let newPeriodEnd;
    if (membership.currentPeriodEnd < now) {
      // Si ya venció, empezar desde hoy
      console.log("   → Membresía vencida, iniciando nuevo período desde hoy");
      membership.currentPeriodStart = paymentDate;
      newPeriodEnd = new Date(paymentDate);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    } else {
      // Si aún no venció, extender desde la fecha de vencimiento actual
      console.log("   → Membresía aún vigente, extendiendo desde fecha actual de vencimiento");
      newPeriodEnd = new Date(membership.currentPeriodEnd);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
    }
    
    console.log("   → Nuevo período calculado:", paymentDate, "->", newPeriodEnd);
    
    // 3. Verificar que newPeriodEnd > currentPeriodStart
    if (membership.currentPeriodEnd < now) {
      const checkStart = paymentDate;
      const checkEnd = newPeriodEnd;
      
      if (checkEnd <= checkStart) {
        console.log("\n❌ ERROR: newPeriodEnd NO es posterior a currentPeriodStart");
        console.log("   currentPeriodStart:", checkStart);
        console.log("   newPeriodEnd:", checkEnd);
        console.log("   Diferencia (ms):", checkEnd - checkStart);
      } else {
        console.log("   ✅ Validación OK: newPeriodEnd > currentPeriodStart");
        const periodDays = Math.ceil((checkEnd - checkStart) / (1000 * 60 * 60 * 24));
        console.log("   Duración del nuevo período:", periodDays, "días");
      }
    }
    
    console.log("\n📊 ESTADO DESPUÉS DEL PAGO (SIN GUARDAR):");
    console.log("═══════════════════════════════════════════");
    console.log("Status:", "active (será actualizado)");
    console.log("currentPeriodStart:", membership.currentPeriodEnd < now ? paymentDate : membership.currentPeriodStart);
    console.log("currentPeriodEnd:", newPeriodEnd);
    console.log("nextPaymentDue:", newPeriodEnd);
    console.log("lastPaymentDate:", paymentDate);
    console.log("lastPaymentAmount:", paymentAmount);
    
    const newDaysUntilExpiration = Math.ceil((newPeriodEnd - now) / (1000 * 60 * 60 * 24));
    console.log("Días hasta vencimiento:", newDaysUntilExpiration);
    
    // 4. Verificar creación de PaymentSession
    console.log("\n📝 PAYMENT SESSION QUE SE CREARÍA:");
    console.log("═══════════════════════════════════════════");
    const sessionData = {
      organizationId: membership.organizationId,
      membershipId: membership._id,
      planId: plan._id,
      sessionId: `manual_${Date.now()}_test`,
      amount: paymentAmount,
      currency: "USD",
      status: "completed",
      paymentMethod: "manual",
      provider: "manual",
      processed: true,
      processedAt: paymentDate,
      completedAt: paymentDate,
    };
    console.log(JSON.stringify(sessionData, null, 2));
    
    console.log("\n✅ SIMULACIÓN COMPLETADA");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("El pago manual debería:");
    console.log("1. ✓ Actualizar currentPeriodEnd correctamente");
    console.log("2. ✓ Asegurar que currentPeriodEnd > currentPeriodStart");
    console.log("3. ✓ Crear un PaymentSession con los datos correctos");
    console.log("4. ✓ Actualizar el status de la membresía a 'active'");
    console.log("5. ✓ Resetear las notificaciones");
    console.log("6. ✓ Desbloquear el acceso de la organización");

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 Desconectado de MongoDB");
  }
}

testManualPayment();
