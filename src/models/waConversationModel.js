import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["client", "org"], required: true },
    body: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const DetectedIntentSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["book", "cancel", "reschedule"], default: "book" }, // qué quiere hacer el cliente
    serviceHint: { type: String },    // "press on", "manicure", etc.
    dateHint: { type: String },        // "lunes a las 8am"
    employeeHint: { type: String },    // "Natalia"
    confirmedByOrg: { type: Boolean, default: false }, // org confirmó disponibilidad en la conv
    confidence: { type: Number, min: 0, max: 1 },
    summaryText: { type: String },     // texto exacto que se le envió a la org por Meta
  },
  { _id: false }
);

const waConversationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    // Número WA de la org (E.164) — identifica qué instancia de Baileys originó esto
    orgPhone: { type: String, required: true, index: true },
    // Número del cliente (E.164)
    clientPhone: { type: String, required: true },

    // Mensajes leídos por Baileys de la conversación org ↔ cliente
    messages: { type: [MessageSchema], default: [] },

    // Lo que el agente detectó en la conversación
    detectedIntent: { type: DetectedIntentSchema, default: null },

    // ID del mensaje de Meta que el agente le envió a la org (para tracking de thread)
    metaMessageId: { type: String },

    // Diálogo entre el agente y el admin de la org (conv B — vía Meta)
    adminConversation: {
      type: [
        new mongoose.Schema(
          { role: { type: String, enum: ["agent", "admin"] }, body: String, timestamp: { type: Date, default: Date.now } },
          { _id: false }
        ),
      ],
      default: [],
    },

    status: {
      type: String,
      enum: [
        "monitoring",         // acumulando mensajes, sin intención clara aún
        "intent_detected",    // intención detectada, esperando más contexto
        "summary_sent",       // resumen enviado a la org por Meta, esperando respuesta
        "confirmed",          // org confirmó, cita creada
        "rejected",           // org rechazó
        "expired",            // TTL alcanzado sin resolverse
      ],
      default: "monitoring",
    },

    // Cita creada (poblado solo cuando status = "confirmed")
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
    },

    lastActivityAt: { type: Date, default: Date.now },

    // Última vez que el admin respondió vía Meta (para validar ventana de 24h)
    adminLastContactAt: { type: Date, default: null },

    // true mientras esperamos que el admin responda la plantilla re_activacion_ia
    awaitingWindowReopen: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Índice compuesto para lookup rápido por org + cliente
waConversationSchema.index({ orgPhone: 1, clientPhone: 1, status: 1 });

// TTL: conversaciones inactivas por más de 24h se eliminan automáticamente
waConversationSchema.index(
  { lastActivityAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60 }
);

export default mongoose.model("WaConversation", waConversationSchema);
