// Catálogos típicos por rubro de negocio, usados para pre-cargar servicios de
// ejemplo realistas en el onboarding ("Explorar primero" / seedDemoData).
//
// Los precios son BASE en unidades pequeñas (ej: 25). seedDemoData aplica el
// multiplicador de moneda (×1000 para COP/CLP/etc.), así "25" → "$25.000" o "$25".

// Monedas de denominación grande: los precios base del catálogo se multiplican ×1000
// ("25" → $25.000 COP). Compartido con seedDemoData y el chequeo de precio del chatbot.
export const LARGE_DENOMINATION_CURRENCIES = new Set([
  "COP", "CLP", "CRC", "PYG", "ARS", "HUF", "KRW", "IDR", "VND", "UYU", "NIO",
]);

export const BUSINESS_VERTICALS = [
  "barberia",
  "unas",
  "salon",
  "spa",
  "estetica",
  "consultorio",
  "clases",
  "mascotas",
  "otro",
];

// Etiquetas legibles para el selector del registro
export const VERTICAL_LABELS = {
  barberia: "Barbería",
  unas: "Uñas / Manicure",
  salon: "Salón de belleza / Peluquería",
  spa: "Spa / Masajes",
  estetica: "Estética / Skincare",
  consultorio: "Consultorio / Salud",
  clases: "Clases / Academia",
  mascotas: "Peluquería de mascotas",
  otro: "Otro",
};

// position = cargo del profesional demo. services = catálogo típico.
const CATALOGS = {
  barberia: {
    position: "Barbero",
    services: [
      { name: "Corte de cabello", type: "Corte", duration: 30, price: 25 },
      { name: "Corte y barba", type: "Corte", duration: 45, price: 35 },
      { name: "Arreglo de barba", type: "Barba", duration: 20, price: 15 },
    ],
  },
  unas: {
    position: "Manicurista",
    services: [
      { name: "Manicure semipermanente", type: "Manicure", duration: 60, price: 30 },
      { name: "Pedicure semipermanente", type: "Pedicure", duration: 60, price: 35 },
      { name: "Uñas acrílicas", type: "Uñas", duration: 120, price: 50 },
    ],
  },
  salon: {
    position: "Estilista",
    services: [
      { name: "Corte y peinado", type: "Cabello", duration: 60, price: 30 },
      { name: "Tinte", type: "Color", duration: 120, price: 60 },
      { name: "Cepillado / Brushing", type: "Cabello", duration: 45, price: 20 },
    ],
  },
  spa: {
    position: "Terapeuta",
    services: [
      { name: "Masaje relajante", type: "Masaje", duration: 60, price: 50 },
      { name: "Limpieza facial", type: "Facial", duration: 60, price: 40 },
      { name: "Exfoliación corporal", type: "Corporal", duration: 90, price: 55 },
    ],
  },
  estetica: {
    position: "Esteticista",
    services: [
      { name: "Limpieza facial profunda", type: "Facial", duration: 60, price: 40 },
      { name: "Depilación", type: "Depilación", duration: 30, price: 20 },
      { name: "Tratamiento facial", type: "Facial", duration: 75, price: 50 },
    ],
  },
  consultorio: {
    position: "Profesional",
    services: [
      { name: "Consulta general", type: "Consulta", duration: 30, price: 40 },
      { name: "Consulta de control", type: "Consulta", duration: 20, price: 30 },
    ],
  },
  clases: {
    position: "Instructor",
    services: [
      { name: "Clase individual", type: "Clase", duration: 60, price: 25 },
      { name: "Clase grupal", type: "Clase", duration: 60, price: 15, maxConcurrentAppointments: 5 },
    ],
  },
  mascotas: {
    position: "Groomer",
    services: [
      { name: "Baño y peluquería", type: "Grooming", duration: 60, price: 30 },
      { name: "Corte de uñas", type: "Grooming", duration: 15, price: 10 },
    ],
  },
  otro: {
    position: "Profesional",
    services: [
      { name: "Servicio básico (ejemplo)", type: "Ejemplo", duration: 30, price: 25 },
      { name: "Servicio premium (ejemplo)", type: "Ejemplo", duration: 60, price: 50 },
    ],
  },
};

/** Devuelve el catálogo del rubro, con fallback a "otro". */
export function getVerticalCatalog(vertical) {
  return CATALOGS[vertical] || CATALOGS.otro;
}

// Servicios sugeridos por rubro para el onboarding con IA: el chat los muestra
// como una lista para marcar y ponerles precio (ServicePickerWidget), en vez de
// pedir que tecleen su catálogo. Separado de CATALOGS[].services a propósito:
// esos son los que siembra "Explorar primero" y la base del chequeo de precio.
// typicalPrice = precio base de referencia (solo se muestra como pista; el
// usuario escribe el suyo).
const SUGGESTIONS = {
  barberia: [
    { name: "Corte de cabello", type: "Corte", duration: 30, typicalPrice: 25 },
    { name: "Corte y barba", type: "Corte", duration: 45, typicalPrice: 35 },
    { name: "Arreglo de barba", type: "Barba", duration: 20, typicalPrice: 15 },
    { name: "Corte infantil", type: "Corte", duration: 30, typicalPrice: 20 },
    { name: "Cejas", type: "Cejas", duration: 10, typicalPrice: 8 },
    { name: "Tinte / Mechas", type: "Color", duration: 60, typicalPrice: 45 },
  ],
  unas: [
    { name: "Manicure tradicional", type: "Manicure", duration: 45, typicalPrice: 20 },
    { name: "Manicure semipermanente", type: "Manicure", duration: 60, typicalPrice: 30 },
    { name: "Pedicure tradicional", type: "Pedicure", duration: 45, typicalPrice: 25 },
    { name: "Pedicure semipermanente", type: "Pedicure", duration: 60, typicalPrice: 35 },
    { name: "Uñas acrílicas", type: "Uñas", duration: 120, typicalPrice: 50 },
    { name: "Uñas en gel / Soft gel", type: "Uñas", duration: 120, typicalPrice: 60 },
    { name: "Retiro de esmalte o acrílico", type: "Uñas", duration: 30, typicalPrice: 15 },
  ],
  salon: [
    { name: "Corte de cabello", type: "Cabello", duration: 45, typicalPrice: 30 },
    { name: "Cepillado / Brushing", type: "Cabello", duration: 45, typicalPrice: 20 },
    { name: "Tinte", type: "Color", duration: 120, typicalPrice: 60 },
    { name: "Mechas / Balayage", type: "Color", duration: 180, typicalPrice: 150 },
    { name: "Keratina / Alisado", type: "Tratamiento", duration: 180, typicalPrice: 120 },
    { name: "Peinado", type: "Cabello", duration: 60, typicalPrice: 40 },
    { name: "Maquillaje", type: "Maquillaje", duration: 60, typicalPrice: 60 },
  ],
  spa: [
    { name: "Masaje relajante", type: "Masaje", duration: 60, typicalPrice: 50 },
    { name: "Masaje descontracturante", type: "Masaje", duration: 60, typicalPrice: 60 },
    { name: "Limpieza facial", type: "Facial", duration: 60, typicalPrice: 40 },
    { name: "Exfoliación corporal", type: "Corporal", duration: 90, typicalPrice: 55 },
    { name: "Drenaje linfático", type: "Corporal", duration: 60, typicalPrice: 60 },
    { name: "Masaje con piedras calientes", type: "Masaje", duration: 90, typicalPrice: 70 },
  ],
  estetica: [
    { name: "Limpieza facial profunda", type: "Facial", duration: 60, typicalPrice: 40 },
    { name: "Diseño de cejas", type: "Cejas", duration: 30, typicalPrice: 20 },
    { name: "Lifting de pestañas", type: "Pestañas", duration: 60, typicalPrice: 50 },
    { name: "Extensiones de pestañas", type: "Pestañas", duration: 120, typicalPrice: 80 },
    { name: "Depilación con cera", type: "Depilación", duration: 30, typicalPrice: 20 },
    { name: "Laminado de cejas", type: "Cejas", duration: 45, typicalPrice: 45 },
  ],
  consultorio: [
    { name: "Consulta de primera vez", type: "Consulta", duration: 45, typicalPrice: 50 },
    { name: "Consulta de control", type: "Consulta", duration: 30, typicalPrice: 35 },
    { name: "Consulta virtual", type: "Consulta", duration: 30, typicalPrice: 35 },
  ],
  clases: [
    { name: "Clase individual", type: "Clase", duration: 60, typicalPrice: 25 },
    { name: "Clase grupal", type: "Clase", duration: 60, typicalPrice: 15 },
    { name: "Clase de prueba", type: "Clase", duration: 60, typicalPrice: 10 },
  ],
  mascotas: [
    { name: "Baño", type: "Grooming", duration: 45, typicalPrice: 20 },
    { name: "Baño y peluquería", type: "Grooming", duration: 90, typicalPrice: 35 },
    { name: "Corte de uñas", type: "Grooming", duration: 15, typicalPrice: 10 },
    { name: "Limpieza de oídos", type: "Grooming", duration: 15, typicalPrice: 10 },
  ],
};

/**
 * Sugerencias de servicios del rubro con el precio de referencia ya en la moneda
 * de la org. Rubro "otro" o desconocido → [] (no hay nada útil que sugerir).
 */
export function getServiceSuggestions(vertical, currency) {
  const list = SUGGESTIONS[vertical];
  if (!list) return [];
  const mult = LARGE_DENOMINATION_CURRENCIES.has(String(currency || "").toUpperCase()) ? 1000 : 1;
  return list.map((s) => ({ ...s, typicalPrice: s.typicalPrice * mult }));
}
