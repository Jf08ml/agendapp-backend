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
};

export default serviceService;
