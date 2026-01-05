import Employee from "../models/employeeModel.js";
import Appointment from "../models/appointmentModel.js";
import bcrypt from "bcryptjs";

const employeeService = {
  // Crear un nuevo empleado
  createEmployee: async (employeeData) => {
    const {
      names,
      position,
      email,
      phoneNumber,
      services,
      organizationId,
      password,
      isActive,
      profileImage,
      commissionPercentage,
    } = employeeData;

    // Encriptar la contraseña antes de guardarla
    const hashedPassword = await bcrypt.hash(password, 10);

    const newEmployee = new Employee({
      names,
      position,
      email,
      phoneNumber,
      services,
      organizationId,
      password: hashedPassword,
      isActive,
      profileImage,
      commissionPercentage,
    });

    const savedEmployee = await newEmployee.save();

    // Ocultar el campo password antes de devolver el empleado creado
    savedEmployee.password = undefined;
    return savedEmployee;
  },

  // Obtener todos los empleados
  getEmployees: async () => {
    return await Employee.find()
      .select("-password")
      .populate("services")
      .exec();
  },

  // Obtener empleados por organizationId
  getEmployeesByOrganizationId: async (organizationId) => {
    return await Employee.find({ organizationId })
      .select("-password")
      .populate("services")
      .sort({ order: 1, _id: 1 }) // Ordenar primero por 'order' ascendente, luego por '_id' como respaldo
      .exec();
  },

  // Obtener un empleado por ID
  getEmployeeById: async (id) => {
    const employee = await Employee.findById(id)
      .select("-password")
      .populate("role");
    if (!employee) {
      throw new Error("Empleado no encontrado");
    }
    return employee;
  },

  // Obtener un empleado por número de teléfono
  getEmployeeByPhoneNumber: async (phoneNumber) => {
    const employee = await Employee.findOne({ phoneNumber })
      .select("-password")
      .populate("role");
    if (!employee) {
      throw new Error("Empleado no encontrado");
    }
    return employee;
  },

  // Actualizar un empleado
  updateEmployee: async (id, employeeData) => {
    const {
      names,
      position,
      email,
      phoneNumber,
      services,
      organizationId,
      password,
      isActive,
      profileImage,
      color,
      order,
      commissionPercentage,
    } = employeeData;
    const employee = await Employee.findById(id);

    if (!employee) {
      throw new Error("Empleado no encontrado");
    }

    employee.names = names !== undefined ? names : employee.names;
    employee.position = position !== undefined ? position : employee.position;
    employee.email = email !== undefined ? email : employee.email;
    employee.phoneNumber =
      phoneNumber !== undefined ? phoneNumber : employee.phoneNumber;
    employee.services = services !== undefined ? services : employee.services;
    employee.organizationId =
      organizationId !== undefined ? organizationId : employee.organizationId;
    employee.isActive = isActive !== undefined ? isActive : employee.isActive;
    employee.profileImage =
      profileImage !== undefined ? profileImage : employee.profileImage;
    employee.color = color !== undefined ? color : employee.color;
    employee.order = order !== undefined ? order : employee.order;
    employee.commissionPercentage =
      commissionPercentage !== undefined
        ? commissionPercentage
        : employee.commissionPercentage;

    // Encriptar la contraseña solo si se ha proporcionado una nueva
    if (password) {
      employee.password = await bcrypt.hash(password, 10);
    }

    const updatedEmployee = await employee.save();

    // Ocultar el campo password antes de devolver el empleado actualizado
    updatedEmployee.password = undefined;
    return updatedEmployee;
  },

  // Eliminar un empleado
  deleteEmployee: async (id) => {
    const employee = await Employee.findById(id);
    if (!employee) {
      throw new Error("Empleado no encontrado");
    }

    const appointments = await Appointment.find({ employee: id });
    if (appointments.length > 0) {
      throw new Error("No puedes eliminar un empleado con citas asignadas");
    }

    await Employee.deleteOne({ _id: id });
    return { message: "Empleado eliminado correctamente" };
  },
};

export default employeeService;
