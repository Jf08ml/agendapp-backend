// ESM
// src/utils/timeAndPhones.js

/** Pequeña pausa async */
export const sleep = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * Valida si un número es utilizable para WhatsApp en CO.
 * Acepta: 10 dígitos móviles (empieza en 3), o +57XXXXXXXXXX, o 57XXXXXXXXXX.
 */
export function hasUsablePhone(input) {
  if (!input) return null;

  const digits = String(input).replace(/\D+/g, ""); // quita todo lo que no es dígito

  // +57XXXXXXXXXX  -> 57XXXXXXXXXX
  if (/^57\d{10}$/.test(digits)) {
    return digits;
  }

  // 003573001234567  -> 573001234567
  if (/^0057\d{10}$/.test(digits)) {
    return digits.slice(2);
  }

  // 10 dígitos colombianos (móvil inicia por 3)
  if (/^\d{10}$/.test(digits) && digits.startsWith("3")) {
    return "57" + digits;
  }

  return null; // inválido
}

/**
 * Normaliza a formato E.164/co-friendly para WA: +57XXXXXXXXXX
 * Si no se puede normalizar, devuelve null.
 */
export function normalizeToCOE164(input) {
  if (!hasUsablePhone(input)) return null;
  let digits = String(input).replace(/[^\d]/g, "");

  if (digits.length === 12 && digits.startsWith("57")) {
    return `+${digits}`;
  }
  if (digits.length === 10 && digits.startsWith("3")) {
    return `+57${digits}`;
  }
  // (fijos regionales no se incluyen aquí a propósito)
  return null;
}

/**
 * Ventana de "hoy" en Bogotá expresada en UTC [start, end).
 * Para Colombia (sin DST) usamos UTC-5.
 */
export function getBogotaTodayWindowUTC(now = new Date()) {
  // Obtenemos año/mes/día "vistos" en Bogotá
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt
    .format(now)
    .split("-")
    .map((v) => parseInt(v, 10));

  // Medianoche Bogotá -> 05:00 UTC (UTC-5). Usamos el inicio y sumamos 24h.
  const dayStartUTC = new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0));
  const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

  return { dayStartUTC, dayEndUTC };
}

/**
 * Igual que getBogotaTodayWindowUTC, pero permitiendo pasar una fecha objetivo.
 * Si no se pasa targetDate, se comporta igual que "hoy".
 */
export function getBogotaDayWindowUTC(targetDate) {
  const base = targetDate ? new Date(targetDate) : new Date();
  return getBogotaTodayWindowUTC(base);
}
