import Service from "../models/serviceModel.js";
import { bulkServiceRow } from "../utils/bulkServices.js";
import Appointment from "../models/appointmentModel.js";
import ServicePackage from "../models/servicePackageModel.js";

const serviceService = {
  // Crear un nuevo servicio
  createService: async (serviceData) => {
    const { images, name, description, price, duration, type, organizationId, icon, featured, deposit } =
      serviceData;
    const newService = new Service({
      images,
      name,
      description,
      price,
      duration,
      type,
      organizationId,
      icon,
      featured: featured === true,
      ...(deposit ? { deposit } : {}),
    });
    return await newService.save();
  },

  // Obtener todos los servicios
  getServices: async () => {
    return await Service.find();
  },

  // Obtener servicios por organizationId
  // ⭐ Destacados primero. El sort es en JS (estable) y no en Mongo porque en BSON
  // el campo ausente (docs legacy) ordena distinto que false explícito.
  getServicesByOrganizationId: async (organizationId) => {
    const services = await Service.find({ organizationId }).sort({ _id: 1 });
    return services.sort(
      (a, b) => (b.featured === true ? 1 : 0) - (a.featured === true ? 1 : 0)
    );
  },

  // Obtener un servicio por ID
  getServiceById: async (id) => {
    const service = await Service.findById(id);
    if (!service) {
      throw new Error("Servicio no encontrado");
    }
    return service;
  },

  // Obtener un servicio por ID — versión pública (landing/vista de detalle
  // compartible). Exige organizationId explícito para no filtrar datos de
  // otro tenant, y excluye servicios inactivos/eliminados de la vista pública.
  getPublicServiceById: async (id, organizationId) => {
    if (!organizationId) {
      throw new Error("Falta organizationId");
    }
    const service = await Service.findOne({
      _id: id,
      organizationId,
      isActive: { $ne: false },
    });
    if (!service) {
      throw new Error("Servicio no encontrado");
    }
    return service;
  },

  // Actualizar un servicio
  updateService: async (id, updatedData) => {
    const service = await Service.findById(id);
    if (!service) {
      throw new Error("Servicio no encontrado");
    }
    service.set(updatedData);
    return await service.save();
  },

  // Eliminar un servicio
  deleteService: async (id) => {
    const service = await Service.findById(id);
    if (!service) {
      throw new Error("Servicio no encontrado");
    }

    const appointmentCount = await Appointment.countDocuments({ service: id });
    if (appointmentCount > 0) {
      throw new Error(
        `No se puede eliminar: este servicio ya tiene ${appointmentCount} cita(s) asociada(s) (pasadas o futuras). Puedes desactivarlo en su lugar para que deje de ofrecerse sin romper el historial ni las citas agendadas.`
      );
    }

    const packageCount = await ServicePackage.countDocuments({ "services.serviceId": id });
    if (packageCount > 0) {
      throw new Error(
        `No se puede eliminar: este servicio está incluido en ${packageCount} paquete(s). Quítalo de los paquetes primero o desactívalo en su lugar.`
      );
    }

    await service.deleteOne();
    return { message: "Servicio eliminado correctamente" };
  },

  // Carga masiva de servicios desde Excel
  bulkCreateServices: async (servicesData, organizationId) => {
    const results = {
      success: [],
      errors: [],
      totalProcessed: 0,
      totalSuccess: 0,
      totalErrors: 0,
      created: 0,
      updated: 0
    };

    console.log(`[bulkCreateServices] Procesando ${servicesData.length} servicios para organización ${organizationId}`);

    for (let i = 0; i < servicesData.length; i++) {
      const row = servicesData[i];
      results.totalProcessed++;

      try {
        // Validación y campos a guardar (utils/bulkServices.js): al actualizar
        // solo se tocan los campos que vienen en la fila.
        const parsed = bulkServiceRow(row);
        if (parsed.error) {
          throw new Error(parsed.error);
        }

        let savedService;
        let action = "CREADO";

        if (parsed.action === "update") {
          console.log(`[bulkCreateServices] Fila ${i + 2}: Actualizando servicio ${parsed.id}`);
          // Solo servicios de este negocio, y solo los campos que vienen
          savedService = await Service.findOneAndUpdate(
            { _id: parsed.id, organizationId },
            { $set: parsed.data },
            { new: true, runValidators: true }
          );
          if (!savedService) {
            throw new Error("Ese ID no es de uno de tus servicios");
          }
          results.updated++;
          action = "ACTUALIZADO";
        } else {
          console.log(`[bulkCreateServices] Fila ${i + 2}: Creando nuevo servicio ${parsed.data.name}`);
          savedService = await new Service({ ...parsed.data, organizationId }).save();
          results.created++;
        }

        results.success.push({
          row: i + 2, // +2 porque la primera fila es encabezado y Excel empieza en 1
          name: savedService.name,
          price: savedService.price,
          duration: savedService.duration,
          action: action
        });
        results.totalSuccess++;

      } catch (error) {
        let errorMessage = error.message;

        console.error(`[bulkCreateServices] Fila ${i + 2}: Error - ${errorMessage}`);

        results.errors.push({
          row: i + 2,
          name: row.name || 'Sin nombre',
          error: errorMessage
        });
        results.totalErrors++;
      }
    }

    console.log(`[bulkCreateServices] Completado: ${results.totalSuccess} éxitos, ${results.totalErrors} errores (${results.created} creados, ${results.updated} actualizados)`);
    return results;
  },
};

export default serviceService;
