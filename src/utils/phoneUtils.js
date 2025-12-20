// utils/phoneUtils.js
import { parsePhoneNumber, isValidPhoneNumber, getCountryCallingCode } from 'libphonenumber-js';

/**
 * Normaliza un número de teléfono a formato E.164
 * @param {string} phone - Número de teléfono raw
 * @param {string} defaultCountry - Código país por defecto (ISO2: CO, MX, PE, etc.)
 * @returns {object} { phone_e164, phone_country, isValid, error }
 */
export function normalizePhoneNumber(phone, defaultCountry = 'CO') {
  if (!phone) {
    return { phone_e164: null, phone_country: null, isValid: false, error: 'Teléfono requerido' };
  }

  try {
    // Limpiar caracteres no numéricos excepto + al inicio
    let cleanPhone = phone.replace(/[^\d+]/g, '');
    
    // Si empieza con 00, reemplazar por +
    if (cleanPhone.startsWith('00')) {
      cleanPhone = '+' + cleanPhone.slice(2);
    }
    
    // Si no tiene + y no parece internacional, añadir país por defecto
    if (!cleanPhone.startsWith('+') && !looksLikeInternational(cleanPhone)) {
      cleanPhone = `+${getCountryCode(defaultCountry)}${cleanPhone}`;
    }

    // Validar con libphonenumber-js
    const isValid = isValidPhoneNumber(cleanPhone, defaultCountry);
    
    if (!isValid) {
      return { 
        phone_e164: null, 
        phone_country: null, 
        isValid: false, 
        error: 'Número de teléfono inválido. Verifica el prefijo y la longitud.' 
      };
    }

    const phoneNumber = parsePhoneNumber(cleanPhone, defaultCountry);
    
    return {
      phone_e164: phoneNumber.format('E.164'),
      phone_country: phoneNumber.country,
      phone_national: phoneNumber.formatNational(),
      calling_code: phoneNumber.countryCallingCode,
      isValid: true,
      error: null
    };

  } catch (error) {
    console.error('[normalizePhoneNumber] Error:', error.message, 'Input:', phone);
    return { 
      phone_e164: null, 
      phone_country: null, 
      isValid: false, 
      error: 'Formato de teléfono inválido' 
    };
  }
}

/**
 * Detecta si un número parece internacional
 */
function looksLikeInternational(phone) {
  // Si es muy largo (>11 dígitos) probablemente ya incluye código país
  return phone.length > 11;
}

/**
 * Obtiene el código de llamada para un país usando libphonenumber-js
 * Soporta TODOS los países (~240) automáticamente
 */
function getCountryCode(countryISO) {
  try {
    // Usar la función nativa de libphonenumber-js que soporta todos los países
    return getCountryCallingCode(countryISO);
  } catch (error) {
    // Fallback a Colombia si el código no es válido
    console.warn(`[getCountryCode] País no reconocido: ${countryISO}, usando CO por defecto`);
    return '57';
  }
}

/**
 * Retrocompatibilidad: reemplaza la función formatPhone antigua
 * @deprecated Usar normalizePhoneNumber en su lugar
 */
export function formatPhone(phone, countryCode = "57", localLength = 10) {
  console.warn('[formatPhone] DEPRECATED: Usar normalizePhoneNumber en su lugar');
  
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");

  while (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);

  if (
    digits.startsWith(countryCode) &&
    digits.length === countryCode.length + localLength
  ) {
    return digits;
  }
  if (digits.length === localLength) {
    return countryCode + digits;
  }
  if (digits.length > localLength && !digits.startsWith(countryCode)) {
    return countryCode + digits;
  }

  console.warn("[formatPhone] Formato inesperado:", phone, "=>", digits);
  return digits;
}