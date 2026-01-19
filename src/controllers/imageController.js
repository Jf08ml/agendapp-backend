import imagekit from "../config/imageKit.js";

export const uploadImage = async (req, res) => {
  try {
    // `req.file` contiene el archivo subido por `multer`
    const { originalname, buffer } = req.file;
    const { folder } = req.params;

    if (!buffer || !originalname) {
      return res.status(400).json({ message: "El archivo es necesario" });
    }

    const response = await imagekit.upload({
      file: buffer.toString("base64"),
      fileName: originalname,
      folder: `/${folder}`,
    });

    res.status(200).json({ imageUrl: response.url });
  } catch (error) {
    console.error("Error al subir la imagen:", error);
    res.status(500).json({ message: "Error al subir la imagen" });
  }
};

export const getAuthParams = async (req, res) => {
  try {
    const authParams = imagekit.getAuthenticationParameters();
    res.status(200).json({
      ok: true,
      ...authParams,
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
    });
  } catch (error) {
    console.error("Error al obtener parámetros de autenticación:", error);
    res.status(500).json({
      ok: false,
      message: "Error al obtener parámetros de autenticación"
    });
  }
};
