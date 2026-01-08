// controllers/paymentController.js
import planModel from "../models/planModel.js";
import organizationModel from "../models/organizationModel.js";
import membershipService from "../services/membershipService.js";
import polarService from "../services/polarService.js";
import sendResponse from "../utils/sendResponse.js";
import PaymentSession from "../models/paymentSessionModel.js";

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "http://localhost:5173";
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.VERCEL_URL || "http://localhost:3000";

/**
 * MODELO DE NEGOCIO: PAGOS ÚNICOS
 * 
 * Este sistema usa SOLO checkouts de pago único en Polar (no suscripciones automáticas).
 * 
 * Razón: Los clientes pueden pagar por diferentes métodos:
 * - Polar (tarjeta de crédito)
 * - Transferencia bancaria directa
 * - Otros métodos manuales
 * 
 * Flujo de renovación:
 * 1. Cuando un plan expira, el sistema NO renueva automáticamente
 * 2. El cliente debe hacer un nuevo pago (manual o por Polar)
 * 3. El webhook de Polar detecta order.paid/checkout.completed y extiende la membresía
 * 4. Para transferencias directas, se registra manualmente en el sistema
 * 
 * Esto evita conflictos entre métodos de pago y da total flexibilidad al cliente.
 */

const paymentController = {
  // POST /api/payments/checkout
  // body: { organizationId, planSlug|planId, currency: 'USD'|'COP', returnPath?: string }
  createCheckout: async (req, res) => {
    try {
      const { organizationId, planSlug, planId, currency: currencyInput, returnPath } = req.body || {};
      if (!organizationId) return sendResponse(res, 400, null, "organizationId es requerido");
      if (!planSlug && !planId) return sendResponse(res, 400, null, "planSlug o planId es requerido");

      const plan = planId
        ? await planModel.findById(planId)
        : await planModel.findOne({ slug: planSlug });
      if (!plan) return sendResponse(res, 404, null, "Plan no encontrado");

      const org = await organizationModel.findById(organizationId).lean();
      if (!org) return sendResponse(res, 404, null, "Organización no encontrada");

      // Polar procesa en USD; forzamos/validamos USD
      const currency = "USD";
      if (currencyInput && currencyInput.toUpperCase() !== "USD") {
        return sendResponse(
          res,
          400,
          null,
          "Polar solo procesa pagos en USD. Usa métodos manuales para COP."
        );
      }

      // Construir base de retorno según dominio/subdominio de la organización.
      // En desarrollo forzamos FRONTEND_BASE_URL para evitar redirigir a dominios de producción.
      const primaryDomain = Array.isArray(org.domains) && org.domains.length > 0 ? org.domains[0] : null;
      const returnBase = process.env.NODE_ENV === "production"
        ? (primaryDomain ? `https://${primaryDomain}` : FRONTEND_BASE_URL)
        : FRONTEND_BASE_URL;

      const returnUrl = `${returnBase}${returnPath || "/payment/success"}` +
        `?org=${encodeURIComponent(organizationId)}&plan=${encodeURIComponent(plan.slug)}&currency=${currency}`;

      // Obtener membresía activa (si existe) para adjuntar en metadata
      const activeMembership = await membershipService.getActiveMembership(organizationId);

      const checkout = await polarService.createCheckoutLink({
        plan,
        currency,
        organizationId,
        returnUrl,
        metadata: {
          membershipId: activeMembership?._id ? String(activeMembership._id) : undefined,
        },
      });

      // Persistir la sesión para correlacionar en el webhook
      try {
        await PaymentSession.create({
          provider: "polar",
          sessionId: checkout.sessionId,
          checkoutUrl: checkout.checkoutUrl,
          organizationId,
          planId: plan._id,
          membershipId: activeMembership?._id,
          currency,
          rawCreateResponse: checkout.raw || null,
        });
      } catch (e) {
        console.warn("No se pudo guardar PaymentSession:", e?.message || e);
      }

      return sendResponse(res, 200, { ...checkout, currency }, "Link de pago creado");
    } catch (err) {
      console.error("Error creando checkout:", err);
      return sendResponse(res, 500, null, err.message);
    }
  },

  // POST /api/payments/webhook (Polar -> Backend)
  webhook: async (req, res) => {
    try {
      // Polar/Svix envía estos headers: webhook-signature, webhook-timestamp, webhook-id.
      // OJO: en Vercel hay headers internos como x-vercel-proxy-signature-ts que NO son la firma del webhook.
      const headerKeys = Object.keys(req.headers || {});
      const signature = req.headers["webhook-signature"] || req.headers["svix-signature"] || null;

      // Usar body crudo preservado por express.json verify (ver app.js)
      // y como fallback soportar Buffer por express.raw si aplica.
      const payloadRaw = req.rawBody || req.body;
      const payloadStr = Buffer.isBuffer(payloadRaw)
        ? payloadRaw.toString("utf8")
        : (typeof payloadRaw === "string" ? payloadRaw : JSON.stringify(payloadRaw));

      const timestampHeader = req.headers["webhook-timestamp"] || req.headers["svix-timestamp"] || null;
      const webhookId = req.headers["webhook-id"] || req.headers["svix-id"] || null;
      const valid = polarService.verifyWebhookSignature(signature, timestampHeader, webhookId, payloadStr);
      if (!valid) {
        console.warn("[polar webhook] Invalid signature", {
          header: signature || null,
          timestamp: timestampHeader || null,
          webhookId: webhookId || null,
          headersAvailable: headerKeys,
          contentType: req.headers["content-type"] || null,
          bodyPreview: typeof payloadStr === "string" ? payloadStr.slice(0, 200) : null,
        });
        return res.status(400).send("Invalid signature");
      }

      let event;
      try {
        event = JSON.parse(payloadStr);
      } catch (e) {
        console.error("[polar webhook] JSON parse error:", e?.message || e);
        return res.status(200).send("ok");
      }
      const type = event?.type || event?.event || "";
      const data = event?.data || event?.object || {};
      console.log("[polar webhook] type=", type);
      
      // Intentar extraer un sessionId compatible
      const idCandidates = [
        event?.id,
        data?.id,
        data?.checkout_id,
        data?.checkoutId,
        data?.checkout?.id,
        event?.object?.id,
        event?.data?.object?.id,
      ].filter(Boolean);
      
      let storedSession = null;
      for (const sid of idCandidates) {
        storedSession = await PaymentSession.findOne({ sessionId: sid });
        if (storedSession) break;
      }

      // Extraer metadata enviada en checkout
      const meta = data?.metadata || {};
      const organizationId = meta.organizationId || storedSession?.organizationId?.toString();
      const planId = meta.planId || storedSession?.planId?.toString();
      const membershipId = meta.membershipId || storedSession?.membershipId?.toString();

        // Si no se pudo correlacionar por sessionId, intentar por organización/plan más reciente
        if (!storedSession && organizationId && planId) {
          storedSession = await PaymentSession.findOne({
            organizationId,
            planId,
          }).sort({ createdAt: -1 });
        }

        // Si ya está marcada como procesada, evitar duplicados
        if (storedSession?.processed) {
          console.log("[polar webhook] session already processed, skipping:", storedSession.sessionId);
          return res.status(200).send("ok");
        }

      // Extraer eventId para tracking de duplicados
      const eventId = event?.id || data?.id || `${type}-${Date.now()}`;

      // Procesar solo eventos de pagos únicos (no suscripciones automáticas)
      // Los planes ahora se renuevan manualmente: el cliente paga cada mes vía Polar o transferencia
      const shouldProcess = (
        type.includes("checkout.completed") ||
        type.includes("payment.succeeded") ||
        type.includes("order.paid") ||
        type.includes("completed") ||
        type.includes("succeeded")
      );

      if (shouldProcess) {
        // Verificar si ya procesamos este evento
        if (storedSession && storedSession.processedEventIds?.includes(eventId)) {
          console.log("[polar webhook] evento ya procesado, skipping:", eventId);
          return res.status(200).send("ok");
        }

        // Si la sesión ya fue procesada, no volver a renovar
        if (storedSession?.processed) {
          console.log("[polar webhook] session already processed (flag), skipping:", storedSession.sessionId);
          return res.status(200).send("ok");
        }

        // Monto si está disponible (diferentes esquemas posibles)
        // Polar envía montos en centavos, dividir por 100 para obtener dólares
        let amount = 
          Number(data?.amount) ||
          Number(data?.total_amount) ||
          Number(data?.total) ||
          Number(data?.price) || undefined;
        
        if (amount) amount = amount / 100; // Convertir centavos a dólares
        
        // Guardar raw event y marcar como procesado
        try {
          if (storedSession) {
            storedSession.rawWebhookEvent = event;
            storedSession.status = "succeeded";
            storedSession.amount = amount;
            if (!storedSession.processedEventIds) storedSession.processedEventIds = [];
            storedSession.processedEventIds.push(eventId);
            storedSession.processed = true;
            storedSession.processedAt = new Date();
            await storedSession.save();
          }
        } catch {}
        console.log("[polar webhook] resolved org=", organizationId, "plan=", planId, "membership=", membershipId, "amount=", amount);

        if (membershipId) {
          try {
            await membershipService.renewMembership(membershipId, amount);
            console.log("[polar webhook] renewed membership", membershipId);
          } catch (e) {
            console.error("Error renovando membresía desde webhook:", e?.message || e);
          }
        } else if (organizationId) {
          try {
            // Fallback: buscar la membresía activa de la organización y renovarla
            const active = await membershipService.getActiveMembership(organizationId);
            if (active) {
              await membershipService.renewMembership(active._id, amount);
              console.log("[polar webhook] renewed active membership", active._id.toString());
            } else if (planId) {
              // Si no hay activa, crear una nueva si tenemos planId
              await membershipService.createMembership({ organizationId, planId });
              console.log("[polar webhook] created new membership for org", organizationId);
            } else {
              console.warn("[polar webhook] no membershipId, no active membership, no planId. Skipping.");
            }
          } catch (e) {
            console.error("Error creando membresía desde webhook:", e?.message || e);
          }
        }
      }

      return res.status(200).send("ok");
    } catch (err) {
      console.error("Error en webhook:", err);
      return res.status(500).send("error");
    }
  },

  // GET /api/payments/verify?sessionId=...
  verify: async (req, res) => {
    try {
      const { sessionId } = req.query;
      if (!sessionId) return sendResponse(res, 400, null, "sessionId es requerido");

      const session = await polarService.getCheckout(sessionId);
      return sendResponse(res, 200, session, "Estado de pago");
    } catch (err) {
      console.error("Error verificando pago:", err);
      return sendResponse(res, 500, null, err.message);
    }
  },

  // GET /api/payments/history?organizationId=...&planId=...&limit=50
  listHistory: async (req, res) => {
    try {
      const { organizationId, planId, limit = 50 } = req.query;
      const q = {};
      if (organizationId) q.organizationId = organizationId;
      if (planId) q.planId = planId;
      const sessions = await PaymentSession.find(q)
        .populate('planId', 'name displayName slug price')
        .sort({ createdAt: -1 })
        .limit(Number(limit));
      return sendResponse(res, 200, sessions, "Historial de pagos");
    } catch (err) {
      console.error("Error listando historial:", err);
      return sendResponse(res, 500, null, err.message);
    }
  },

  // GET /api/payments/sessions?organizationId=...&planId=...&limit=50
  listSessions: async (req, res) => {
    try {
      const { organizationId, planId, limit = 50 } = req.query;
      const q = {};
      if (organizationId) q.organizationId = organizationId;
      if (planId) q.planId = planId;
      const sessions = await PaymentSession.find(q).sort({ createdAt: -1 }).limit(Number(limit));
      return sendResponse(res, 200, sessions, "Sesiones de pago");
    } catch (err) {
      console.error("Error listando sesiones:", err);
      return sendResponse(res, 500, null, err.message);
    }
  },
};

export default paymentController;
