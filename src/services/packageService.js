import ServicePackage from "../models/servicePackageModel.js";
import ClientPackage from "../models/clientPackageModel.js";
import Class from "../models/classModel.js";
import Order from "../models/orderModel.js";
import Appointment from "../models/appointmentModel.js";
import Enrollment from "../models/enrollmentModel.js";
import Reservation from "../models/reservationModel.js";
import serviceService from "./serviceService.js";
import mongoose from "mongoose";

/**
 * Valida que todas las clases del paquete existan y pertenezcan a la organización.
 */
async function validatePackageClasses(classes = [], organizationId) {
  for (const cls of classes) {
    const classDoc = await Class.findById(cls.classId);
    if (!classDoc) {
      throw new Error(`Clase no encontrada: ${cls.classId}`);
    }
    if (classDoc.organizationId.toString() !== organizationId.toString()) {
      throw new Error(`La clase ${classDoc.name} no pertenece a esta organización`);
    }
  }
}

const packageService = {
  // =============================================
  // CRUD - ServicePackage (plantillas de paquetes)
  // =============================================

  createServicePackage: async (data, organizationId) => {
    // Validar que todos los servicios existan en la organización
    for (const svc of (data.services || [])) {
      const service = await serviceService.getServiceById(svc.serviceId);
      if (!service) {
        throw new Error(`Servicio no encontrado: ${svc.serviceId}`);
      }
      if (service.organizationId.toString() !== organizationId.toString()) {
        throw new Error(`El servicio ${service.name} no pertenece a esta organización`);
      }
    }
    // Validar clases
    await validatePackageClasses(data.classes, organizationId);

    const servicePackage = new ServicePackage({
      ...data,
      organizationId,
    });

    return await servicePackage.save();
  },

  getServicePackages: async (organizationId, { activeOnly = false } = {}) => {
    const filter = { organizationId };
    if (activeOnly) {
      filter.isActive = true;
    }
    return await ServicePackage.find(filter)
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration")
      .sort({ createdAt: -1 });
  },

  getServicePackageById: async (id) => {
    return await ServicePackage.findById(id)
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration");
  },

  updateServicePackage: async (id, data, organizationId) => {
    // Validar servicios si se actualizan
    if (data.services) {
      for (const svc of data.services) {
        const service = await serviceService.getServiceById(svc.serviceId);
        if (!service) {
          throw new Error(`Servicio no encontrado: ${svc.serviceId}`);
        }
        if (service.organizationId.toString() !== organizationId.toString()) {
          throw new Error(`El servicio ${service.name} no pertenece a esta organización`);
        }
      }
    }
    // Validar clases si se actualizan
    if (data.classes) {
      await validatePackageClasses(data.classes, organizationId);
    }

    return await ServicePackage.findOneAndUpdate(
      { _id: id, organizationId },
      { $set: data },
      { new: true, runValidators: true }
    )
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration");
  },

  deleteServicePackage: async (id, organizationId) => {
    return await ServicePackage.findOneAndUpdate(
      { _id: id, organizationId },
      { $set: { isActive: false } },
      { new: true }
    );
  },

  // Borrado permanente. Solo se permite si el paquete nunca se vendió (sin
  // ClientPackage ni Order pagada asociada) — en ese caso también limpia en
  // cascada los checkouts abandonados/pendientes/expirados ligados a él.
  permanentlyDeleteServicePackage: async (id, organizationId) => {
    const servicePackage = await ServicePackage.findOne({ _id: id, organizationId });
    if (!servicePackage) {
      throw new Error("Paquete no encontrado");
    }

    const soldCount = await ClientPackage.countDocuments({
      servicePackageId: id,
      organizationId,
    });
    if (soldCount > 0) {
      throw new Error(
        `No se puede eliminar: este paquete ya fue vendido/asignado a ${soldCount} cliente(s). Puedes desactivarlo en su lugar.`
      );
    }

    const paidOrders = await Order.countDocuments({
      organizationId,
      type: "package",
      refId: id,
      status: "paid",
    });
    if (paidOrders > 0) {
      throw new Error(
        "No se puede eliminar: este paquete tiene pagos registrados. Puedes desactivarlo en su lugar."
      );
    }

    await Order.deleteMany({ organizationId, type: "package", refId: id });
    await ServicePackage.deleteOne({ _id: id, organizationId });

    return { message: "Paquete eliminado permanentemente" };
  },

  // Borrado forzado: ignora las ventas/asignaciones existentes y elimina en
  // cascada TODO lo relacionado con el paquete — incluye las citas y
  // clases (Appointment/Enrollment/Reservation) pagadas con esas sesiones,
  // no solo el registro de compra. Irreversible, uso explícito ("force").
  forceDeleteServicePackage: async (id, organizationId) => {
    const servicePackage = await ServicePackage.findOne({ _id: id, organizationId });
    if (!servicePackage) {
      throw new Error("Paquete no encontrado");
    }

    const clientPackages = await ClientPackage.find({
      servicePackageId: id,
      organizationId,
    }).select("_id");
    const clientPackageIds = clientPackages.map((cp) => cp._id);

    const deleted = {
      clientPackages: 0,
      appointments: 0,
      enrollments: 0,
      reservations: 0,
      orders: 0,
    };

    if (clientPackageIds.length > 0) {
      const [apptResult, enrollResult, reservationResult] = await Promise.all([
        Appointment.deleteMany({ organizationId, clientPackageId: { $in: clientPackageIds } }),
        Enrollment.deleteMany({ organizationId, clientPackageId: { $in: clientPackageIds } }),
        Reservation.deleteMany({ organizationId, clientPackageId: { $in: clientPackageIds } }),
      ]);
      deleted.appointments = apptResult.deletedCount;
      deleted.enrollments = enrollResult.deletedCount;
      deleted.reservations = reservationResult.deletedCount;

      const cpResult = await ClientPackage.deleteMany({ _id: { $in: clientPackageIds } });
      deleted.clientPackages = cpResult.deletedCount;
    }

    const orderResult = await Order.deleteMany({ organizationId, type: "package", refId: id });
    deleted.orders = orderResult.deletedCount;

    await ServicePackage.deleteOne({ _id: id, organizationId });

    return { message: "Paquete eliminado permanentemente (forzado)", deleted };
  },

  // =============================================
  // Gestión de ClientPackage (paquetes del cliente)
  // =============================================

  assignPackageToClient: async (servicePackageId, clientId, organizationId, paymentInfo = {}) => {
    const servicePackage = await ServicePackage.findOne({
      _id: servicePackageId,
      organizationId,
      isActive: true,
    });

    if (!servicePackage) {
      throw new Error("Paquete no encontrado o inactivo");
    }

    // Paquete con niveles (ej: x4/x8/x12): las sesiones y el precio salen
    // del nivel elegido, no de la raíz del ServicePackage. Aplican de forma
    // uniforme a todos los servicios/clases incluidos.
    const isTiered = (servicePackage.tiers || []).length > 0;
    let sessionsPerItem = null;
    let courtesyPerItem = 0;
    let totalPrice = servicePackage.price;
    let tierLabel = null;

    if (isTiered) {
      const tier = servicePackage.tiers.id(paymentInfo.tierId);
      if (!tier) {
        throw new Error("Este paquete tiene niveles — indica cuál (ej: x4, x8, x12).");
      }
      sessionsPerItem = tier.sessionsIncluded;
      courtesyPerItem = tier.courtesySessions || 0;
      totalPrice = tier.price;
      tierLabel = tier.label;
    }

    const purchaseDate = paymentInfo.purchaseDate
      ? new Date(paymentInfo.purchaseDate)
      : new Date();

    const expirationDate = new Date(purchaseDate);
    expirationDate.setDate(expirationDate.getDate() + servicePackage.validityDays);

    const clientPackage = new ClientPackage({
      clientId,
      servicePackageId,
      organizationId,
      services: servicePackage.services.map((svc) => {
        const total = isTiered ? sessionsPerItem + courtesyPerItem : svc.sessionsIncluded;
        return {
          serviceId: svc.serviceId,
          sessionsIncluded: total,
          sessionsUsed: 0,
          sessionsRemaining: total,
          courtesySessions: isTiered ? courtesyPerItem : 0,
        };
      }),
      classes: (servicePackage.classes || []).map((cls) => {
        const total = isTiered ? sessionsPerItem + courtesyPerItem : cls.sessionsIncluded;
        return {
          classId: cls.classId,
          sessionsIncluded: total,
          sessionsUsed: 0,
          sessionsRemaining: total,
          courtesySessions: isTiered ? courtesyPerItem : 0,
        };
      }),
      tierLabel,
      purchaseDate,
      expirationDate,
      status: "active",
      totalPrice,
      paymentMethod: paymentInfo.paymentMethod || "",
      paymentNotes: paymentInfo.paymentNotes || "",
    });

    return await clientPackage.save();
  },

  getClientPackages: async (clientId, organizationId) => {
    return await ClientPackage.find({ clientId, organizationId })
      .populate("servicePackageId", "name description")
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration")
      .sort({ createdAt: -1 });
  },

  getActiveClientPackages: async (clientId, organizationId) => {
    const now = new Date();
    return await ClientPackage.find({
      clientId,
      organizationId,
      status: "active",
      expirationDate: { $gt: now },
    })
      .populate("servicePackageId", "name description")
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration")
      .sort({ expirationDate: 1 });
  },

  getActivePackagesForService: async (clientId, serviceId, organizationId) => {
    const now = new Date();
    return await ClientPackage.find({
      clientId,
      organizationId,
      status: "active",
      expirationDate: { $gt: now },
      // $elemMatch: el saldo > 0 tiene que ser de ESTE servicio, no de otro del paquete
      services: {
        $elemMatch: {
          serviceId: new mongoose.Types.ObjectId(serviceId),
          sessionsRemaining: { $gt: 0 },
        },
      },
    })
      .populate("servicePackageId", "name description")
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration")
      .sort({ expirationDate: 1 });
  },

  // 📚 Paquetes activos del cliente con créditos para una clase específica
  getActivePackagesForClass: async (clientId, classId, organizationId) => {
    const now = new Date();
    return await ClientPackage.find({
      clientId,
      organizationId,
      status: "active",
      expirationDate: { $gt: now },
      "classes.classId": new mongoose.Types.ObjectId(classId),
      "classes.sessionsRemaining": { $gt: 0 },
    })
      .populate("servicePackageId", "name description")
      .populate("classes.classId", "name color pricePerPerson duration")
      .sort({ expirationDate: 1 });
  },

  // 📚 Buscar paquetes con créditos de clase por el identificador configurado (reserva pública)
  checkClientClassPackagesByIdentifier: async (field, value, classIds, organizationId) => {
    const Client = mongoose.model("Client");
    const v = (value || "").trim();
    if (!v) return { client: null, packages: [] };

    let query = { organizationId };
    if (field === "email") {
      query.email = v.toLowerCase();
    } else if (field === "documentId") {
      query.documentId = v;
    } else {
      // phone: el frontend envía E.164; aceptamos también el nacional como respaldo
      query.$or = [{ phone_e164: v }, { phoneNumber: v }];
    }

    const client = await Client.findOne(query);
    if (!client) return { client: null, packages: [] };

    const now = new Date();
    const classObjectIds = classIds.map((id) => new mongoose.Types.ObjectId(id));

    const packages = await ClientPackage.find({
      clientId: client._id,
      organizationId,
      status: "active",
      expirationDate: { $gt: now },
      "classes.classId": { $in: classObjectIds },
    })
      .populate("servicePackageId", "name description")
      .populate("classes.classId", "name color pricePerPerson duration");

    const packagesWithAvailability = packages.filter((pkg) =>
      (pkg.classes || []).some(
        (cls) =>
          classObjectIds.some((id) => id.equals(cls.classId._id || cls.classId)) &&
          cls.sessionsRemaining > 0
      )
    );

    return { client, packages: packagesWithAvailability };
  },

  // 📚 Buscar paquetes con créditos de clase por teléfono (reserva pública)
  checkClientClassPackagesByPhone: async (phone_e164, classIds, organizationId) => {
    const Client = mongoose.model("Client");
    const client = await Client.findOne({ phone_e164, organizationId });
    if (!client) return { client: null, packages: [] };

    const now = new Date();
    const classObjectIds = classIds.map((id) => new mongoose.Types.ObjectId(id));

    const packages = await ClientPackage.find({
      clientId: client._id,
      organizationId,
      status: "active",
      expirationDate: { $gt: now },
      "classes.classId": { $in: classObjectIds },
    })
      .populate("servicePackageId", "name description")
      .populate("classes.classId", "name color pricePerPerson duration");

    const packagesWithAvailability = packages.filter((pkg) =>
      (pkg.classes || []).some(
        (cls) =>
          classObjectIds.some((id) => id.equals(cls.classId._id || cls.classId)) &&
          cls.sessionsRemaining > 0
      )
    );

    return { client, packages: packagesWithAvailability };
  },

  // Buscar paquetes de SERVICIO por el identificador configurado (reserva pública)
  checkClientPackagesByIdentifier: async (field, value, serviceIds, organizationId) => {
    const Client = mongoose.model("Client");
    const v = (value || "").trim();
    if (!v) return { client: null, packages: [] };

    let query = { organizationId };
    if (field === "email") {
      query.email = v.toLowerCase();
    } else if (field === "documentId") {
      query.documentId = v;
    } else {
      // phone: el frontend envía E.164; aceptamos también el nacional como respaldo
      query.$or = [{ phone_e164: v }, { phoneNumber: v }];
    }

    const client = await Client.findOne(query);
    if (!client) return { client: null, packages: [] };

    const now = new Date();
    const serviceObjectIds = serviceIds.map((id) => new mongoose.Types.ObjectId(id));

    const packages = await ClientPackage.find({
      clientId: client._id,
      organizationId,
      status: "active",
      expirationDate: { $gt: now },
      "services.serviceId": { $in: serviceObjectIds },
    })
      .populate("servicePackageId", "name description")
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration");

    const packagesWithAvailability = packages.filter((pkg) =>
      pkg.services.some(
        (svc) =>
          serviceObjectIds.some((id) => id.equals(svc.serviceId._id || svc.serviceId)) &&
          svc.sessionsRemaining > 0
      )
    );

    return { client, packages: packagesWithAvailability };
  },

  // Buscar paquetes por teléfono (para reserva online pública)
  checkClientPackagesByPhone: async (phone_e164, serviceIds, organizationId) => {
    // Buscar cliente por teléfono
    const Client = mongoose.model("Client");
    const client = await Client.findOne({
      phone_e164,
      organizationId,
    });

    if (!client) return { client: null, packages: [] };

    const now = new Date();
    const serviceObjectIds = serviceIds.map((id) => new mongoose.Types.ObjectId(id));

    const packages = await ClientPackage.find({
      clientId: client._id,
      organizationId,
      status: "active",
      expirationDate: { $gt: now },
      "services.serviceId": { $in: serviceObjectIds },
    })
      .populate("servicePackageId", "name description")
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration");

    // Filtrar solo servicios con sesiones restantes
    const packagesWithAvailability = packages.filter((pkg) =>
      pkg.services.some(
        (svc) =>
          serviceObjectIds.some((id) => id.equals(svc.serviceId._id || svc.serviceId)) &&
          svc.sessionsRemaining > 0
      )
    );

    return { client, packages: packagesWithAvailability };
  },

  // =============================================
  // Consumo y reembolso de sesiones
  // =============================================

  consumeSession: async (clientPackageId, serviceId, appointmentId, { session: dbSession } = {}) => {
    const serviceObjId = new mongoose.Types.ObjectId(serviceId);

    // Operación atómica: decrementar sessionsRemaining solo si > 0.
    // $elemMatch es obligatorio: con dos condiciones sueltas sobre `services`, el
    // saldo > 0 podía ser de OTRO servicio y el `$` posicional apuntar a ese otro.
    const updated = await ClientPackage.findOneAndUpdate(
      {
        _id: clientPackageId,
        status: { $in: ["active", "exhausted"] },
        services: { $elemMatch: { serviceId: serviceObjId, sessionsRemaining: { $gt: 0 } } },
      },
      {
        $inc: {
          "services.$.sessionsUsed": 1,
          "services.$.sessionsRemaining": -1,
        },
        $push: {
          consumptionHistory: {
            appointmentId,
            serviceId: serviceObjId,
            action: "consume",
            date: new Date(),
          },
        },
      },
      { new: true, session: dbSession }
    );

    if (!updated) {
      throw new Error("No hay sesiones disponibles en este paquete para el servicio seleccionado");
    }

    // Verificar si todas las sesiones (servicios + clases) se agotaron
    const allExhausted =
      updated.services.every((svc) => svc.sessionsRemaining <= 0) &&
      (updated.classes || []).every((cls) => cls.sessionsRemaining <= 0);
    if (allExhausted) {
      updated.status = "exhausted";
      await updated.save({ session: dbSession });
    }

    return updated;
  },

  // 📚 Consumir 1 crédito de clase (al inscribirse a una sesión)
  consumeClassSession: async (clientPackageId, classId, enrollmentId, { session: dbSession } = {}) => {
    const classObjId = new mongoose.Types.ObjectId(classId);

    const updated = await ClientPackage.findOneAndUpdate(
      {
        _id: clientPackageId,
        status: { $in: ["active", "exhausted"] },
        "classes.classId": classObjId,
        "classes.sessionsRemaining": { $gt: 0 },
      },
      {
        $inc: {
          "classes.$.sessionsUsed": 1,
          "classes.$.sessionsRemaining": -1,
        },
        $push: {
          consumptionHistory: {
            enrollmentId,
            classId: classObjId,
            itemType: "class",
            action: "consume",
            date: new Date(),
          },
        },
      },
      { new: true, session: dbSession }
    );

    if (!updated) {
      throw new Error("No hay créditos disponibles en este paquete para la clase seleccionada");
    }

    const allExhausted =
      updated.services.every((svc) => svc.sessionsRemaining <= 0) &&
      (updated.classes || []).every((cls) => cls.sessionsRemaining <= 0);
    if (allExhausted) {
      updated.status = "exhausted";
      await updated.save({ session: dbSession });
    }

    return updated;
  },

  // 📚 Reembolsar 1 crédito de clase (al cancelar la inscripción)
  refundClassSession: async (clientPackageId, classId, enrollmentId) => {
    const classObjId = new mongoose.Types.ObjectId(classId);

    const updated = await ClientPackage.findOneAndUpdate(
      {
        _id: clientPackageId,
        "classes.classId": classObjId,
      },
      {
        $inc: {
          "classes.$.sessionsUsed": -1,
          "classes.$.sessionsRemaining": 1,
        },
        $push: {
          consumptionHistory: {
            enrollmentId,
            classId: classObjId,
            itemType: "class",
            action: "refund",
            date: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      throw new Error("No se pudo reembolsar el crédito de clase del paquete");
    }

    if (updated.status === "exhausted") {
      const hasRemaining =
        updated.services.some((svc) => svc.sessionsRemaining > 0) ||
        (updated.classes || []).some((cls) => cls.sessionsRemaining > 0);
      if (hasRemaining && updated.expirationDate > new Date()) {
        updated.status = "active";
        await updated.save();
      }
    }

    return updated;
  },

  refundSession: async (clientPackageId, serviceId, appointmentId) => {
    const serviceObjId = new mongoose.Types.ObjectId(serviceId);

    // Idempotente por cita: solo se devuelve lo que esa cita consumió y no se le
    // devolvió ya (ej. el admin cancela la cita y después la elimina).
    if (appointmentId) {
      const pkg = await ClientPackage.findById(clientPackageId).select("consumptionHistory").lean();
      if (!pkg) {
        throw new Error("No se pudo reembolsar la sesión del paquete");
      }
      const net = (pkg.consumptionHistory || [])
        .filter((h) => String(h.appointmentId) === String(appointmentId))
        .reduce((acc, h) => acc + (h.action === "consume" ? 1 : -1), 0);
      if (net <= 0) return null;
    }

    const updated = await ClientPackage.findOneAndUpdate(
      {
        _id: clientPackageId,
        "services.serviceId": serviceObjId,
      },
      {
        $inc: {
          "services.$.sessionsUsed": -1,
          "services.$.sessionsRemaining": 1,
        },
        $push: {
          consumptionHistory: {
            appointmentId,
            serviceId: serviceObjId,
            action: "refund",
            date: new Date(),
          },
        },
      },
      { new: true }
    );

    if (!updated) {
      throw new Error("No se pudo reembolsar la sesión del paquete");
    }

    // Si estaba exhausted y ahora tiene sesiones, reactivar
    if (updated.status === "exhausted") {
      const hasRemaining =
        updated.services.some((svc) => svc.sessionsRemaining > 0) ||
        (updated.classes || []).some((cls) => cls.sessionsRemaining > 0);
      if (hasRemaining && updated.expirationDate > new Date()) {
        updated.status = "active";
        await updated.save();
      }
    }

    return updated;
  },

  // 🔁 Saldo de sesiones para una serie recurrente. `usePackageForServices` es el
  // mapeo { serviceId: clientPackageId } que manda el modal de citas. Solo se
  // aceptan paquetes activos y vigentes de ESE cliente y organización.
  // Devuelve { [serviceId]: { clientPackageId, included, used, remaining } }.
  getSeriesPackageBudget: async (usePackageForServices, { clientId, organizationId }) => {
    const budget = {};
    const entries = Object.entries(usePackageForServices || {}).filter(([, pkgId]) => pkgId);
    for (const [serviceId, clientPackageId] of entries) {
      const pkg = await ClientPackage.findOne({
        _id: clientPackageId,
        clientId,
        organizationId,
        status: "active",
        expirationDate: { $gt: new Date() },
      }).select("services").lean();
      const svc = pkg?.services?.find((s) => String(s.serviceId) === String(serviceId));
      if (!svc) continue;
      budget[serviceId] = {
        clientPackageId: String(clientPackageId),
        included: svc.sessionsIncluded,
        used: svc.sessionsIncluded - svc.sessionsRemaining,
        remaining: svc.sessionsRemaining,
      };
    }
    return budget;
  },

  // 🔢 "Sesión N de M" para citas cubiertas por paquete. N sale del orden
  // cronológico de las citas activas de ese paquete+servicio, desplazado por el
  // consumo que no tiene cita detrás (ajustes manuales del paquete). Solo se
  // etiqueta cuando el servicio trae más de 1 sesión en el paquete.
  // Devuelve Map<appointmentId, { number, total }>.
  getPackageSessionLabels: async (appointments) => {
    const labels = new Map();
    const pkgIds = [
      ...new Set(
        (appointments || [])
          .map((a) => a?.clientPackageId?._id || a?.clientPackageId)
          .filter(Boolean)
          .map(String)
      ),
    ];
    if (pkgIds.length === 0) return labels;

    const [pkgs, linked] = await Promise.all([
      ClientPackage.find({ _id: { $in: pkgIds } }).select("services").lean(),
      Appointment.find({
        clientPackageId: { $in: pkgIds },
        status: { $nin: ["cancelled", "cancelled_by_customer", "cancelled_by_admin"] },
      })
        .select("_id clientPackageId service startDate")
        .sort({ startDate: 1, _id: 1 })
        .lean(),
    ]);

    const svcInfo = new Map();
    for (const p of pkgs) {
      for (const s of p.services || []) {
        svcInfo.set(`${p._id}:${s.serviceId}`, {
          total: s.sessionsIncluded,
          used: s.sessionsIncluded - s.sessionsRemaining,
        });
      }
    }

    const byKey = new Map();
    for (const a of linked) {
      const key = `${a.clientPackageId}:${a.service}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(a);
    }

    for (const [key, appts] of byKey) {
      const info = svcInfo.get(key);
      if (!info || info.total <= 1) continue;
      const offset = Math.max(0, info.used - appts.length);
      appts.forEach((a, i) => {
        labels.set(String(a._id), { number: offset + i + 1, total: info.total });
      });
    }
    return labels;
  },

  // =============================================
  // Cancelar paquete de cliente
  // =============================================

  cancelClientPackage: async (clientPackageId, organizationId) => {
    const pkg = await ClientPackage.findOne({
      _id: clientPackageId,
      organizationId,
    });

    if (!pkg) {
      throw new Error("Paquete no encontrado");
    }

    if (pkg.status === "cancelled") {
      throw new Error("El paquete ya está cancelado");
    }

    pkg.status = "cancelled";
    await pkg.save();

    return pkg;
  },

  // ✏️ Editar paquete de cliente: extender fecha de vencimiento y/o corregir
  // manualmente, por servicio/clase, el total de sesiones incluidas
  // (sessionsIncluded) y/o cuántas ya se usaron (sessionsUsed) — ambos como
  // valores absolutos, subibles o bajables. Existe para cargar/corregir
  // paquetes que un admin manejaba fuera del sistema (ej. en papel/Excel) y
  // que ya tenían sesiones descontadas o un total distinto al registrarlos —
  // no hay citas/consumptionHistory reales detrás de este tipo de ajuste.
  editClientPackage: async (clientPackageId, organizationId, {
    expirationDate,
    serviceAdjustments = [],
    classAdjustments = [],
  } = {}) => {
    const pkg = await ClientPackage.findOne({ _id: clientPackageId, organizationId });
    if (!pkg) {
      throw new Error("Paquete no encontrado");
    }
    if (pkg.status === "cancelled") {
      throw new Error("No se puede editar un paquete cancelado");
    }

    if (expirationDate) {
      const newDate = new Date(expirationDate);
      if (isNaN(newDate.getTime())) {
        throw new Error("Fecha de vencimiento inválida");
      }
      pkg.expirationDate = newDate;
    }

    // Aplica un ajuste absoluto de sessionsIncluded/sessionsUsed a un item
    // (service o class embebido). Ambos son opcionales e independientes;
    // el que no se envíe conserva su valor actual.
    const applySessionAdjustment = (item, adj, itemLabel) => {
      const nextIncluded = adj.sessionsIncluded !== undefined && adj.sessionsIncluded !== null
        ? Number(adj.sessionsIncluded)
        : item.sessionsIncluded;
      const nextUsed = adj.sessionsUsed !== undefined && adj.sessionsUsed !== null
        ? Number(adj.sessionsUsed)
        : item.sessionsUsed;

      if (!Number.isInteger(nextIncluded) || nextIncluded < 0) {
        throw new Error(`Las sesiones incluidas de ${itemLabel} deben ser un número entero mayor o igual a 0`);
      }
      if (!Number.isInteger(nextUsed) || nextUsed < 0) {
        throw new Error(`Las sesiones usadas de ${itemLabel} deben ser un número entero mayor o igual a 0`);
      }
      if (nextUsed > nextIncluded) {
        throw new Error(`Las sesiones usadas de ${itemLabel} no pueden superar el total incluido`);
      }

      item.sessionsIncluded = nextIncluded;
      item.sessionsUsed = nextUsed;
      item.sessionsRemaining = nextIncluded - nextUsed;
    };

    for (const adj of serviceAdjustments) {
      const svc = pkg.services.find((s) => s.serviceId.toString() === adj.serviceId);
      if (!svc) {
        throw new Error("Servicio no encontrado en este paquete");
      }
      applySessionAdjustment(svc, adj, "el servicio");
    }

    for (const adj of classAdjustments) {
      const cls = pkg.classes.find((c) => c.classId.toString() === adj.classId);
      if (!cls) {
        throw new Error("Clase no encontrada en este paquete");
      }
      applySessionAdjustment(cls, adj, "la clase");
    }

    // Recalcular status según el estado resultante (independiente de cuál
    // combinación de cambios se aplicó).
    const hasRemaining =
      pkg.services.some((s) => s.sessionsRemaining > 0) ||
      (pkg.classes || []).some((c) => c.sessionsRemaining > 0);
    pkg.status = !hasRemaining ? "exhausted" : pkg.expirationDate <= new Date() ? "expired" : "active";

    await pkg.save();
    return ClientPackage.findById(pkg._id)
      .populate("clientId", "name phoneNumber")
      .populate("servicePackageId", "name description")
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration");
  },

  deleteClientPackage: async (clientPackageId, organizationId) => {
    const pkg = await ClientPackage.findOneAndDelete({
      _id: clientPackageId,
      organizationId,
    });

    if (!pkg) {
      throw new Error("Paquete no encontrado");
    }

    return pkg;
  },

  // =============================================
  // Listado global de paquetes asignados (para la vista admin)
  // =============================================

  getAllOrgClientPackages: async (organizationId, { status = "" } = {}) => {
    const filter = { organizationId };
    if (status && status !== "all") {
      filter.status = status;
    }
    return await ClientPackage.find(filter)
      .populate("clientId", "name phoneNumber")
      .populate("servicePackageId", "name description")
      .populate("services.serviceId", "name price duration")
      .populate("classes.classId", "name color pricePerPerson duration")
      .sort({ createdAt: -1 });
  },

  // =============================================
  // Expiración
  // =============================================

  expirePackages: async (organizationId) => {
    const now = new Date();
    const result = await ClientPackage.updateMany(
      {
        organizationId,
        status: "active",
        expirationDate: { $lte: now },
      },
      { $set: { status: "expired" } }
    );
    return result.modifiedCount;
  },

  // 💰 Registrar un pago para un paquete de cliente
  addPaymentToPackage: async (packageId, { amount, method, date, note, registeredBy }) => {
    const pkg = await ClientPackage.findById(packageId);
    if (!pkg) throw new Error('Paquete no encontrado');
    pkg.payments.push({ amount, method: method || 'cash', date: date || new Date(), note: note || '', registeredBy: registeredBy || undefined });
    // paymentStatus se recalcula en el pre-save middleware
    await pkg.save();
    return ClientPackage.findById(pkg._id)
      .populate('clientId', 'name phoneNumber')
      .populate('servicePackageId', 'name description')
      .populate('services.serviceId', 'name price duration')
      .populate('classes.classId', 'name color pricePerPerson duration');
  },

  // 💰 Eliminar un pago de un paquete de cliente
  removePaymentFromPackage: async (packageId, paymentId) => {
    const pkg = await ClientPackage.findById(packageId);
    if (!pkg) throw new Error('Paquete no encontrado');
    const before = pkg.payments.length;
    pkg.payments = pkg.payments.filter(p => p._id.toString() !== paymentId);
    if (pkg.payments.length === before) throw new Error('Pago no encontrado');
    await pkg.save();
    return ClientPackage.findById(pkg._id)
      .populate('clientId', 'name phoneNumber')
      .populate('servicePackageId', 'name description')
      .populate('services.serviceId', 'name price duration')
      .populate('classes.classId', 'name color pricePerPerson duration');
  },
};

export default packageService;
