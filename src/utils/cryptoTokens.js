/**
 * cryptoTokens.js
 *
 * Cifrado simétrico de secretos en reposo (AES-256-GCM). Se usa para los tokens
 * de Mercado Pago (`mpCollect.accessToken`/`refreshToken`), que son credenciales
 * con valor de robo (permiten crear cobros a nombre del vendedor).
 *
 * Formato del texto cifrado:  enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * Retrocompatibilidad: `decryptSecret` devuelve el valor tal cual si NO empieza
 * por el prefijo `enc:v1:` → los tokens legados guardados en texto plano siguen
 * funcionando y se cifran de forma perezosa en el siguiente refresh/reconexión.
 *
 * Clave: variable de entorno `TOKEN_ENC_KEY` (32 bytes en hex = 64 chars, o
 * base64). Si no está configurada, `encryptSecret` devuelve el texto plano con
 * una advertencia (solo válido en dev) — en producción DEBE configurarse.
 */

import crypto from "crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

let cachedKey;
let warnedNoKey = false;

/**
 * Resuelve la clave de cifrado de 32 bytes desde TOKEN_ENC_KEY (hex o base64).
 * Devuelve null si no está configurada (modo dev: sin cifrado).
 */
function getKey() {
  if (cachedKey !== undefined) return cachedKey;

  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw) {
    cachedKey = null;
    return cachedKey;
  }

  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, "hex");
  } else {
    buf = Buffer.from(raw, "base64");
  }

  if (buf.length !== 32) {
    throw new Error(
      "TOKEN_ENC_KEY debe ser de 32 bytes (64 chars hex o base64 de 32 bytes)."
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/**
 * ¿El valor ya está cifrado con nuestro formato?
 */
export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Cifra un secreto. Si no hay clave configurada, devuelve el texto plano (dev).
 * Si el valor ya está cifrado, lo devuelve tal cual (idempotente).
 */
export function encryptSecret(plain) {
  if (plain == null || plain === "") return plain;
  if (isEncrypted(plain)) return plain;

  const key = getKey();
  if (!key) {
    if (!warnedNoKey) {
      console.warn(
        "[cryptoTokens] TOKEN_ENC_KEY no configurada; los secretos se guardan en texto plano (solo dev)."
      );
      warnedNoKey = true;
    }
    return plain;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Descifra un secreto. Si no tiene el prefijo (legado en texto plano) lo devuelve
 * tal cual. Lanza si está cifrado pero no hay clave / el formato es inválido.
 */
export function decryptSecret(value) {
  if (value == null || value === "") return value;
  if (!isEncrypted(value)) return value; // legado en texto plano

  const key = getKey();
  if (!key) {
    throw new Error(
      "[cryptoTokens] Hay un secreto cifrado pero TOKEN_ENC_KEY no está configurada."
    );
  }

  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("[cryptoTokens] Formato de secreto cifrado inválido.");

  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}

export default { isEncrypted, encryptSecret, decryptSecret };
