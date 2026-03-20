import employeeService from "../services/employeeService.js";
import sendResponse from "../utils/sendResponse.js";
import { auditLogService } from "../services/auditLogService.js";

const employeeController = {
  // Controlador para crear un nuevo empleado
  createEmployee: async (req, res) => {
    try {
      const newEmployee = await employeeService.createEmployee(req.body);
      sendResponse(res, 201, newEmployee, "Empleado creado exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener todos los empleados
  getEmployees: async (req, res) => {
    try {
      const employees = await employeeService.getEmployees();
      sendResponse(res, 200, employees, "Empleados obtenidos exitosamente");
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener empleados por organizationId
  getEmployeesByOrganizationId: async (req, res) => {
    const { organizationId } = req.params;
    try {
      const employees = await employeeService.getEmployeesByOrganizationId(
        organizationId
      );
      sendResponse(
        res,
        200,
        employees,
        "Empleados de la organización obtenidos exitosamente"
      );
    } catch (error) {
      sendResponse(res, 500, null, error.message);
    }
  },

  // Controlador para obtener un empleado por ID
  getEmployeeById: async (req, res) => {
    const { id } = req.params;
    try {
      const employee = await employeeService.getEmployeeById(id);
      sendResponse(res, 200, employee, "Empleado encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para obtener un empleado por número de teléfono
  getEmployeeByPhoneNumber: async (req, res) => {
    const { phoneNumber } = req.params;
    try {
      const employee = await employeeService.getEmployeeByPhoneNumber(
        phoneNumber
      );
      sendResponse(res, 200, employee, "Empleado encontrado");
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para actualizar un empleado
  updateEmployee: async (req, res) => {
    const { id } = req.params;
    try {
      const updatedEmployee = await employeeService.updateEmployee(
        id,
        req.body
      );
      sendResponse(
        res,
        200,
        updatedEmployee,
        "Empleado actualizado exitosamente"
      );
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },

  // Controlador para eliminar un empleado
  deleteEmployee: async (req, res) => {
    const { id } = req.params;
    try {
      const employeeData = await employeeService.getEmployeeById(id);
      const result = await employeeService.deleteEmployee(id);

      // 📋 Audit log
      await auditLogService.log({
        organizationId: employeeData.organizationId,
        action: "delete_employee",
        entityType: "employee",
        entityId: id,
        entitySnapshot: auditLogService.snapshotEmployee(employeeData),
        performedById: req.user?._id || req.user?.id || null,
        performedByName: req.user?.name || req.user?.email || "Admin",
        performedByRole: req.user?.role || null,
      });

      sendResponse(res, 200, null, result.message);
    } catch (error) {
      sendResponse(res, 404, null, error.message);
    }
  },
};

export default employeeController;
