// src/config/db.js
import mongoose from "mongoose";
import dotenv from "dotenv";

// Usa NODE_ENV o por defecto "development"
const env = process.env.NODE_ENV || "development";
dotenv.config({ path: `.env.${env}` });

const dbConnection = async () => {
  try {
    const dbURI = process.env.DB_URI;

    if (!dbURI) {
      throw new Error("La variable de entorno DB_URI no está definida");
    }

    await mongoose.connect(dbURI);
    console.log("📡 Established connection to the database");
  } catch (error) {
    console.error("Error al conectar a la base de datos", error);
    process.exit(1);
  }
};

// Si en algún momento necesitas la conexión en otro lado:
const { connection } = mongoose;

export default dbConnection;
export { connection };
