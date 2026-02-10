import ServicePackage from "../models/servicePackageModel.js";
import ClientPackage from "../models/clientPackageModel.js";
import serviceService from "./serviceService.js";
import mongoose from "mongoose";

const packageService = {
  // =============================================
  // CRUD - ServicePackage (plantillas de paquetes)
  // =============================================

  createServicePackage: async (data, organizationId) => {
    // Validar que todos los servicios existan en la organización
    for (const svc of data.services) {
      const service = await serviceService.getServiceById(svc.serviceId);
      if (!service) {
        throw new Error(`Servicio no encontrado: ${svc.serviceId}`);
      }
      if (service.organizationId.toString() !== organizationId.toString()) {
        throw new Error(`El servicio ${service.name} no pertenece a esta organización`);
      }
    }

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
      .sort({ createdAt: -1 });
  },

  getServicePackageById: async (id) => {
    return await ServicePackage.findById(id)
      .populate("services.serviceId", "name price duration");
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

    return await ServicePackage.findOneAndUpdate(
      { _id: id, organizationId },
      { $set: data },
      { new: true }
    ).populate("services.serviceId", "name price duration");
  },

  deleteServicePackage: async (id, organizationId) => {
    return await ServicePackage.findOneAndUpdate(
      { _id: id, organizationId },
      { $set: { isActive: false } },
      { new: true }
    );
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

    const purchaseDate = paymentInfo.purchaseDate
      ? new Date(paymentInfo.purchaseDate)
      : new Date();

    const expirationDate = new Date(purchaseDate);
    expirationDate.setDate(expirationDate.getDate() + servicePackage.validityDays);

    const clientPackage = new ClientPackage({
      clientId,
      servicePackageId,
      organizationId,
      services: servicePackage.services.map((svc) => ({
        serviceId: svc.serviceId,
        sessionsIncluded: svc.sessionsIncluded,
        sessionsUsed: 0,
        sessionsRemaining: svc.sessionsIncluded,
      })),
      purchaseDate,
      expirationDate,
      status: "active",
      totalPrice: servicePackage.price,
      paymentMethod: paymentInfo.paymentMethod || "",
      paymentNotes: paymentInfo.paymentNotes || "",
    });

    return await clientPackage.save();
  },

  getClientPackages: async (clientId, organizationId) => {
    return await ClientPackage.find({ clientId, organizationId })
      .populate("servicePackageId", "name description")
      .populate("services.serviceId", "name price duration")
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
      .sort({ expirationDate: 1 });
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
      .populate("services.serviceId", "name price duration");

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

    // Verificar si todas las sesiones se agotaron
    const allExhausted = updated.services.every((svc) => svc.sessionsRemaining <= 0);
    if (allExhausted) {
      updated.status = "exhausted";
      await updated.save({ session: dbSession });
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
      const hasRemaining = updated.services.some((svc) => svc.sessionsRemaining > 0);
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
};

export default packageService;
