// ESM
// src/utils/timeAndPhones.js

/** Pequeña pausa async */
export const sleep = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * Valida si un número es utilizable para WhatsApp.
 * Acepta números de Colombia (+57) y México (+52) en varios formatos.
 */
export function hasUsablePhone(input) {
  if (!input) return null;

  const digits = String(input).replace(/\D+/g, ""); // quita todo lo que no es dígito

  // Colombia: +57XXXXXXXXXX -> 57XXXXXXXXXX (12 dígitos)
  if (/^57\d{10}$/.test(digits)) {
    return digits;
  }

  // Colombia: 0057XXXXXXXXXX -> 57XXXXXXXXXX
  if (/^0057\d{10}$/.test(digits)) {
    return digits.slice(2);
  }

  // Colombia: 10 dígitos móviles (inicia por 3)
  if (/^\d{10}$/.test(digits) && digits.startsWith("3")) {
    return "57" + digits;
  }

  // México: +521XXXXXXXXXX -> 521XXXXXXXXXX (13 dígitos - formato WhatsApp correcto)
  if (/^521\d{10}$/.test(digits)) {
    return digits;
  }

  // México: +52XXXXXXXXXX -> 521XXXXXXXXXX (agregar el "1" para WhatsApp)
  if (/^52\d{10}$/.test(digits)) {
    return "521" + digits.slice(2); // Inserta "1" después del 52
  }

  // México: 00521XXXXXXXXXX -> 521XXXXXXXXXX
  if (/^00521\d{10}$/.test(digits)) {
    return digits.slice(2);
  }

  // México: 0052XXXXXXXXXX -> 521XXXXXXXXXX (agregar el "1")
  if (/^0052\d{10}$/.test(digits)) {
    return "521" + digits.slice(4);
  }

  // Formato E.164 genérico: +[código país][número] (11-15 dígitos totales)
  // Esto cubre otros países sin validación específica
  if (/^\d{11,15}$/.test(digits)) {
    return digits;
  }

  return null; // inválido
}

/**
 * Normaliza a formato E.164 para WhatsApp: +[código][número]
 * Si no se puede normalizar, devuelve null.
 */
export function normalizeToCOE164(input) {
  const usable = hasUsablePhone(input);
  if (!usable) return null;

  // Si ya tiene formato válido, agregar +
  if (/^\d{11,15}$/.test(usable)) {
    return `+${usable}`;
  }

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
/**
 * Ventana de un día específico en cualquier timezone, expresada en UTC [start, end).
 * @param {string|Date} targetDate - Fecha objetivo
 * @param {string} timezone - IANA timezone (ej: "America/Mexico_City", "America/Bogota")
 * @returns {{dayStartUTC: Date, dayEndUTC: Date}}
 */
export function getDayWindowUTC(targetDate, timezone = "America/Bogota") {
  const base = targetDate ? new Date(targetDate) : new Date();
  
  // Obtenemos año/mes/día "vistos" en la timezone especificada
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt
    .format(base)
    .split("-")
    .map((v) => parseInt(v, 10));

  // Obtenemos el offset de la timezone para ese día específico
  // Creamos una fecha a medianoche en esa timezone
  const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00`;
  const fmtWithOffset = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  
  // Crear fecha en UTC que representa medianoche en la timezone objetivo
  const parts = fmtWithOffset.formatToParts(new Date(dateStr));
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  
  // Calcular offset en horas (aproximado, funciona para zonas fijas sin DST)
  const testDate = new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00Z`);
  const tzDate = new Date(testDate.toLocaleString('en-US', { timeZone: timezone }));
  const offsetMs = testDate.getTime() - tzDate.getTime();
  const offsetHours = Math.round(offsetMs / (1000 * 60 * 60));
  
  // Medianoche en la timezone objetivo, expresada en UTC
  const dayStartUTC = new Date(Date.UTC(y, m - 1, d, offsetHours, 0, 0, 0));
  const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

  return { dayStartUTC, dayEndUTC };
}