import Service from "../models/serviceModel.js";

const serviceService = {
  // Crear un nuevo servicio
  createService: async (serviceData) => {
    const { images, name, description, price, duration, type, organizationId, icon } =
      serviceData;
    const newService = new Service({
      images,
      name,
      description,
      price,
      duration,
      type,
      organizationId,
      icon
    });
    return await newService.save();
  },

  // Obtener todos los servicios
  getServices: async () => {
    return await Service.find();
  },

  // Obtener servicios por organizationId
  getServicesByOrganizationId: async (organizationId) => {
    return await Service.find({ organizationId });
  },

  // Obtener un servicio por ID
  getServiceById: async (id) => {
    const service = await Service.findById(id);
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
      totalErrors: 0
    };

    console.log(`[bulkCreateServices] Procesando ${servicesData.length} servicios para organización ${organizationId}`);

    for (let i = 0; i < servicesData.length; i++) {
      const row = servicesData[i];
      results.totalProcessed++;

      try {
        // Validar datos requeridos
        if (!row.name || row.price === undefined || row.duration === undefined) {
          throw new Error('Nombre, precio y duración son obligatorios');
        }

        // Validar que precio y duración sean números válidos
        const price = parseFloat(row.price);
        const duration = parseInt(row.duration);

        if (isNaN(price) || price < 0) {
          throw new Error('El precio debe ser un número válido mayor o igual a 0');
        }

        if (isNaN(duration) || duration <= 0) {
          throw new Error('La duración debe ser un número válido mayor a 0');
        }

        // Validar maxConcurrentAppointments si existe
        let maxConcurrentAppointments = 1;
        if (row.maxConcurrentAppointments !== undefined && row.maxConcurrentAppointments !== null && row.maxConcurrentAppointments !== '') {
          maxConcurrentAppointments = parseInt(row.maxConcurrentAppointments);
          if (isNaN(maxConcurrentAppointments) || maxConcurrentAppointments < 1) {
            throw new Error('Las citas concurrentes deben ser un número válido mayor o igual a 1');
          }
        }

        console.log(`[bulkCreateServices] Fila ${i + 2}: Procesando ${row.name}, precio: ${price}, duración: ${duration}`);

        // Crear servicio
        const newService = new Service({
          name: row.name.trim(),
          type: row.type ? row.type.trim() : '',
          description: row.description ? row.description.trim() : '',
          price: price,
          duration: duration,
          hidePrice: row.hidePrice === true || row.hidePrice === 'true' || row.hidePrice === 'Sí' || row.hidePrice === 'Si',
          maxConcurrentAppointments: maxConcurrentAppointments,
          organizationId,
          isActive: true,
        });

        const savedService = await newService.save();
        results.success.push({
          row: i + 2, // +2 porque la primera fila es encabezado y Excel empieza en 1
          name: savedService.name,
          price: savedService.price,
          duration: savedService.duration
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

    console.log(`[bulkCreateServices] Completado: ${results.totalSuccess} éxitos, ${results.totalErrors} errores`);
    return results;
  },
};

export default serviceService;
