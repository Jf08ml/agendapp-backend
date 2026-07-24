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
      "services.serviceId": new mongoose.Types.ObjectId(serviceId),
      "services.sessionsRemaining": { $gt: 0 },
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

    // Operación atómica: decrementar sessionsRemaining solo si > 0
    const updated = await ClientPackage.findOneAndUpdate(
      {
        _id: clientPackageId,
        status: { $in: ["active", "exhausted"] },
        "services.serviceId": serviceObjId,
        "services.sessionsRemaining": { $gt: 0 },
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
