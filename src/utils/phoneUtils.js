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
    console.log(`[normalizePhoneNumber] Input: "${phone}", País: ${defaultCountry}`);
    
    // Limpiar caracteres no numéricos excepto + al inicio
    let cleanPhone = String(phone).replace(/[^\d+]/g, '');
    
    console.log(`[normalizePhoneNumber] Limpiado: "${cleanPhone}"`);
    
    // 🇸🇻 VALIDACIÓN TEMPRANA para El Salvador (7-8 dígitos)
    if (defaultCountry === 'SV') {
      const digitsOnly = cleanPhone.replace(/[^\d]/g, '');
      // Si tiene exactamente 7 u 8 dígitos (sin código de país)
      if (digitsOnly.length === 7 || digitsOnly.length === 8) {
        const phoneE164 = `+503${digitsOnly}`;
        console.log('[normalizePhoneNumber] Número SV de 7-8 dígitos aceptado:', phoneE164);
        return {
          phone_e164: phoneE164,
          phone_country: 'SV',
          phone_national: digitsOnly,
          phone_national_clean: digitsOnly,
          calling_code: '503',
          isValid: true,
          error: null
        };
      }
      // Si tiene +503 seguido de 7-8 dígitos
      if (digitsOnly.length >= 10 && digitsOnly.length <= 11 && digitsOnly.startsWith('503')) {
        const nationalNumber = digitsOnly.slice(3);
        if (nationalNumber.length === 7 || nationalNumber.length === 8) {
          const phoneE164 = `+${digitsOnly}`;
          console.log('[normalizePhoneNumber] Número SV con código aceptado:', phoneE164);
          return {
            phone_e164: phoneE164,
            phone_country: 'SV',
            phone_national: nationalNumber,
            phone_national_clean: nationalNumber,
            calling_code: '503',
            isValid: true,
            error: null
          };
        }
      }
    }
    
    // Si empieza con 00, reemplazar por +
    if (cleanPhone.startsWith('00')) {
      cleanPhone = '+' + cleanPhone.slice(2);
    }
    
    // Si no tiene + y no parece internacional, añadir país por defecto
    if (!cleanPhone.startsWith('+') && !looksLikeInternational(cleanPhone)) {
      const countryCode = getCountryCode(defaultCountry);
      cleanPhone = `+${countryCode}${cleanPhone}`;
      console.log(`[normalizePhoneNumber] Agregado código país +${countryCode}: "${cleanPhone}"`);
    }

    console.log(`[normalizePhoneNumber] Validando: "${cleanPhone}" con país ${defaultCountry}`);

    // Validar con libphonenumber-js
    const isValid = isValidPhoneNumber(cleanPhone, defaultCountry);
    
    console.log(`[normalizePhoneNumber] Validación resultado: ${isValid}`);
    
    if (!isValid) {
      // Intentar parsear de todas formas para obtener más información
      try {
        const parsed = parsePhoneNumber(cleanPhone, defaultCountry);
        console.log('[normalizePhoneNumber] Parseado (aunque inválido):', parsed);
      } catch (e) {
        console.log('[normalizePhoneNumber] No se pudo parsear:', e.message);
      }
      
      return { 
        phone_e164: null, 
        phone_country: null, 
        isValid: false, 
        error: `Número de teléfono inválido para ${defaultCountry}. Verifica el prefijo y la longitud.` 
      };
    }

    const phoneNumber = parsePhoneNumber(cleanPhone, defaultCountry);
    
    // Obtener el número nacional sin formato (solo dígitos)
    const nationalNumberClean = phoneNumber.nationalNumber;
    
    const result = {
      phone_e164: phoneNumber.format('E.164'),
      phone_country: phoneNumber.country,
      phone_national: phoneNumber.formatNational(),
      phone_national_clean: nationalNumberClean, // 🆕 Solo dígitos, sin espacios ni guiones
      calling_code: phoneNumber.countryCallingCode,
      isValid: true,
      error: null
    };
    
    console.log('[normalizePhoneNumber] Éxito:', result);
    return result;

  } catch (error) {
    console.error('[normalizePhoneNumber] Error:', error.message, 'Input:', phone);
    
    // 🇸🇻 FALLBACK para El Salvador
    if (defaultCountry === 'SV') {
      const digitsOnly = phone.replace(/\D/g, '');
      if (digitsOnly.length === 7 || digitsOnly.length === 8) {
        const phoneE164 = `+503${digitsOnly}`;
        console.log('[normalizePhoneNumber] Usando fallback SV:', phoneE164);
        return {
          phone_e164: phoneE164,
          phone_country: 'SV',
          phone_national: digitsOnly,
          phone_national_clean: digitsOnly,
          calling_code: '503',
          isValid: true,
          error: null
        };
      }
      if (digitsOnly.length >= 10 && digitsOnly.length <= 11 && digitsOnly.startsWith('503')) {
        const nationalNumber = digitsOnly.slice(3);
        const phoneE164 = `+${digitsOnly}`;
        console.log('[normalizePhoneNumber] Usando fallback SV con código:', phoneE164);
        return {
          phone_e164: phoneE164,
          phone_country: 'SV',
          phone_national: nationalNumber,
          phone_national_clean: nationalNumber,
          calling_code: '503',
          isValid: true,
          error: null
        };
      }
    }
    
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
 * Convierte un número E.164 al formato que WhatsApp/Baileys requiere (solo dígitos).
 * Maneja el caso especial de México: +52 → 521 (móviles necesitan el "1" extra).
 * @param {string} phoneE164 - Número en formato E.164 (ej. "+525512345678") o solo dígitos
 * @returns {string} Número en formato WhatsApp sin "+" (ej. "5215512345678")
 */
export function toWhatsappFormat(phoneE164) {
  if (!phoneE164) return '';

  // Quitar el + si viene
  let digits = String(phoneE164).replace(/[^\d]/g, '');

  // 🇲🇽 México: si empieza con 52 y NO tiene el "1" extra, insertarlo
  // Formato correcto para WhatsApp: 521 + 10 dígitos nacionales
  // E.164 estándar de libphonenumber-js: 52 + 10 dígitos = 12 dígitos
  if (digits.startsWith('52') && !digits.startsWith('521') && digits.length === 12) {
    digits = '521' + digits.slice(2);
    console.log(`[toWhatsappFormat] México: insertado "1" → ${digits}`);
  }

  return digits;
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