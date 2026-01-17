// scripts/fixMembershipPeriod.js
// Script para corregir membresías con currentPeriodEnd anterior a currentPeriodStart

import mongoose from "mongoose";
import membershipModel from "../src/models/membershipModel.js";

// Conectar a la base de datos de producción
const MONGO_URI = "mongodb+srv://jfmosquera:0608@cluster0.nxpfanv.mongodb.net/galaxia_glamour?retryWrites=true&w=majority";

async function fixMembershipPeriod() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Conectado a MongoDB");

    const membershipId = "6940f65d1878c8d6015fddde";
    
    const membership = await membershipModel.findById(membershipId);
    
    if (!membership) {
      console.log("❌ Membresía no encontrada");
      return;
    }

    console.log("\n📋 Estado ANTES de la corrección:");
    console.log("Status:", membership.status);
    console.log("currentPeriodStart:", membership.currentPeriodStart);
    console.log("currentPeriodEnd:", membership.currentPeriodEnd);
    console.log("nextPaymentDue:", membership.nextPaymentDue);
    
    // Verificar si hay problema
    if (membership.currentPeriodEnd < membership.currentPeriodStart) {
      console.log("\n⚠️ PROBLEMA DETECTADO: currentPeriodEnd es anterior a currentPeriodStart");
      
      // Corregir: el período debe ser de 30 días desde currentPeriodStart
      const newPeriodEnd = new Date(membership.currentPeriodStart);
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
      
      membership.currentPeriodEnd = newPeriodEnd;
      membership.nextPaymentDue = newPeriodEnd;
      
      await membership.save();
      
      console.log("\n✅ Membresía CORREGIDA:");
      console.log("Status:", membership.status);
      console.log("currentPeriodStart:", membership.currentPeriodStart);
      console.log("currentPeriodEnd:", membership.currentPeriodEnd);
      console.log("nextPaymentDue:", membership.nextPaymentDue);
      console.log("\n✨ La membresía ahora está válida por 30 días desde la renovación");
    } else {
      console.log("\n✅ La membresía está correcta, no requiere corrección");
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await mongoose.disconnect();
    console.log("\n🔌 Desconectado de MongoDB");
  }
}

fixMembershipPeriod();
