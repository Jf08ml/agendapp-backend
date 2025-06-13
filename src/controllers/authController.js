import authService from "../services/authService.js";
import sendResponse from "../utils/sendResponse.js";
import jwt from "jsonwebtoken";

const authController = {
  login: async (req, res) => {
    const { email, password, organizationId } = req.body;

    try {
      // Autenticar al usuario
      const user = await authService.authenticateUser(email, password, organizationId);

      // Generar el token JWT
      const token = jwt.sign(
        { userId: user._id, userType: user.userType },
        process.env.JWT_SECRET,
        { expiresIn: "1h" }
      );

      sendResponse(
        res,
        200,
        {
          token,
          userId: user._id,
          userType: user.userType,
          organizationId: user.organizationId,
          userPermissions: user.userPermissions,
        },
        "Inicio de sesión exitoso"
      );
    } catch (error) {
      sendResponse(res, 401, null, error.message);
    }
  },
};

export default authController;
