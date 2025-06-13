import Employee from "../models/employeeModel.js";
import Organization from "../models/organizationModel.js";
import bcrypt from "bcryptjs";

const authService = {
  authenticateUser: async (email, password, organizationId) => {
    // Buscar en la colección de empleados dentro de la organización correcta
    let user = await Employee.findOne({ email, organizationId }).populate(
      "role"
    );
    console.log(user);
    console.log(email, password, organizationId)
    if (user && (await bcrypt.compare(password, user.password))) {
      return {
        ...user.toObject(),
        userType: "employee",
        organizationId: user.organizationId,
        userPermissions: [...user.role.permissions, ...user.customPermissions],
      };
    }

    // Buscar en la colección de organizaciones (admin)
    if (email && organizationId) {
      user = await Organization.findOne({
        _id: organizationId,
        email,
      }).populate("role");
      if (user && (await bcrypt.compare(password, user.password))) {
        return {
          ...user.toObject(),
          userType: "admin",
          organizationId: user._id,
          userPermissions: user.role.permissions,
        };
      }
    }

    // Si no se encuentra el usuario o la contraseña no coincide
    throw new Error("Correo o contraseña incorrectos");
  },
};

export default authService;
