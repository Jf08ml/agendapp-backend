// Catálogos típicos por rubro de negocio, usados para pre-cargar servicios de
// ejemplo realistas en el onboarding ("Explorar primero" / seedDemoData).
//
// Los precios son BASE en unidades pequeñas (ej: 25). seedDemoData aplica el
// multiplicador de moneda (×1000 para COP/CLP/etc.), así "25" → "$25.000" o "$25".

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
