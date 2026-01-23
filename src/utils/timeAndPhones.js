// ESM
// src/utils/timeAndPhones.js

/** Pequeña pausa async */
export const sleep = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/**
 * Valida si un número es utilizable para WhatsApp.
 * Acepta números de Colombia (+57), México (+52), España (+34), Costa Rica (+506) y otros en varios formatos.
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

  // España: +34XXXXXXXXX -> 34XXXXXXXXX (11 dígitos: 34 + 9 dígitos)
  // Los móviles españoles empiezan por 6 o 7, los fijos por 9
  if (/^34[679]\d{8}$/.test(digits)) {
    return digits;
  }

  // España: 0034XXXXXXXXX -> 34XXXXXXXXX
  if (/^0034[679]\d{8}$/.test(digits)) {
    return digits.slice(2);
  }

  // España: 9 dígitos locales (empiezan por 6, 7 o 9)
  if (/^[679]\d{8}$/.test(digits)) {
    return "34" + digits;
  }

  // Costa Rica: +506XXXXXXXX -> 506XXXXXXXX (11 dígitos: 506 + 8 dígitos)
  // Los móviles costarricenses empiezan por 5, 6, 7 u 8
  if (/^506[5-8]\d{7}$/.test(digits)) {
    return digits;
  }

  // Costa Rica: 00506XXXXXXXX -> 506XXXXXXXX
  if (/^00506[5-8]\d{7}$/.test(digits)) {
    return digits.slice(2);
  }

  // Costa Rica: 8 dígitos locales (empiezan por 5, 6, 7 u 8)
  if (/^[5-8]\d{7}$/.test(digits)) {
    return "506" + digits;
  }

  // México: 10 dígitos locales -> 521XXXXXXXXXX (formato WhatsApp)
  // Los números mexicanos pueden empezar con: 33, 55, 81, 442, 656, etc.
  if (/^\d{10}$/.test(digits) && !digits.startsWith("3")) {
    // Si no empieza con 3 (Colombia), asumimos que es México u otro país
    // Para México, agregamos 521
    return "521" + digits;
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
  
  // 🔧 FIX: Extraer solo la fecha (YYYY-MM-DD) de la entrada
  // Si viene "2026-01-15T05:00:00.000Z", queremos interpretar como día 15
  let dateStr;
  if (typeof targetDate === 'string' && targetDate.includes('T')) {
    // Tiene hora, extraer solo la parte de fecha
    dateStr = targetDate.split('T')[0];
  } else {
    // Usar formatter para obtener la fecha
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateStr = fmt.format(base);
  }
  
  const [y, m, d] = dateStr.split("-").map((v) => parseInt(v, 10));

  // Construir las fechas de inicio y fin del día en la timezone objetivo
  // Usamos un enfoque más directo: crear una fecha en esa timezone y obtener su equivalente UTC
  
  // Para obtener medianoche en la timezone objetivo como UTC:
  // Creamos una fecha ISO con la timezone, luego la parseamos
  const startLocalStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00`;
  const endLocalStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T23:59:59.999`;
  
  // Convertir a UTC considerando la timezone
  // Truco: crear una fecha interpretada como local, luego ajustar el offset
  const tempStart = new Date(startLocalStr);
  const tempEnd = new Date(endLocalStr);
  
  // Obtener qué hora es en la timezone objetivo cuando es esa hora "local"
  const startInTz = new Date(tempStart.toLocaleString('en-US', { timeZone: timezone }));
  const endInTz = new Date(tempEnd.toLocaleString('en-US', { timeZone: timezone }));
  
  // El offset es la diferencia entre la hora "local" y la hora en timezone
  const offsetStart = tempStart.getTime() - startInTz.getTime();
  const offsetEnd = tempEnd.getTime() - endInTz.getTime();
  
  // Aplicar offset para obtener la hora UTC que corresponde a medianoche en timezone
  const dayStartUTC = new Date(tempStart.getTime() + offsetStart);
  const dayEndUTC = new Date(tempEnd.getTime() + offsetEnd);

  console.log(`[getDayWindowUTC] targetDate=${targetDate}, timezone=${timezone}`);
  console.log(`[getDayWindowUTC] Fecha extraída: ${dateStr} -> Día interpretado: ${y}-${m}-${d}`);
  console.log(`[getDayWindowUTC] dayStartUTC=${dayStartUTC.toISOString()}, dayEndUTC=${dayEndUTC.toISOString()}`);

  return { dayStartUTC, dayEndUTC };
}