/**
 * Seed de anuncios del sistema.
 * Uso: NODE_ENV=development node scripts/seedAnnouncements.js
 * Elimina todos los anuncios existentes y los recrea desde cero.
 */
import { config } from "dotenv";
config({ path: `.env.${process.env.NODE_ENV}` });

import dbConnection from "../src/config/db.js";
import SystemAnnouncement from "../src/models/systemAnnouncementModel.js";

const ANNOUNCEMENTS = [
  {
    version: "2.6",
    date: "18 Jun 2026",
    isoDate: "2026-06-18",
    published: true,
    items: [
      {
        type: "new",
        text: "Cobros en línea con Mercado Pago",
        detail:
          "Ya puedes recibir pagos de tus clientes directamente en tu cuenta de Mercado Pago. Desde Configuración → Pagos encontrarás la tarjeta 'Cobros con Mercado Pago': conecta tu cuenta con un par de clics (te llevamos al sitio de Mercado Pago para autorizar) y el dinero llega directo a ti, nosotros no lo retenemos. Mercado Pago cobra su propia comisión por procesar cada pago; AgenditApp no cobra comisión adicional.",
      },
      {
        type: "new",
        text: "Abono en línea para confirmar reservas y clases",
        detail:
          "Puedes pedir un abono (depósito) para confirmar las reservas de servicios y las inscripciones a clases. Configura el porcentaje en Configuración → Pagos ('Depósito para Reservas' y 'Depósito para Clases', cada uno independiente). Cuando está activo, el cliente ve cuánto se le cobrará antes de pagar y, al completar el abono por Mercado Pago, la cita o el cupo quedan confirmados automáticamente. Si la inscripción se cubre con un paquete, no se cobra abono.",
      },
      {
        type: "new",
        text: "Compra de paquetes en línea desde el portal público",
        detail:
          "Tus clientes ahora pueden comprar paquetes de sesiones por su cuenta y pagarlos en línea, sin que tengas que asignarlos manualmente. Aparece un acceso 'Comprar paquetes' en el inicio y en el menú del portal (cuando tienes Mercado Pago conectado). Al confirmarse el pago, el paquete queda activo de inmediato y el cliente puede empezar a reservar descontando sus sesiones.",
      },
      {
        type: "improvement",
        text: "Detección de paquetes por tu identificador de cliente",
        detail:
          "Al reservar, el sistema reconoce los paquetes activos del cliente usando el identificador que tu negocio tenga configurado (teléfono, correo o documento), no solo el teléfono. Así, quien compró un paquete identificándose con su correo o documento también ve sus sesiones disponibles al reservar un servicio o una clase, siempre que use el mismo dato.",
      },
    ],
  },
  {
    version: "2.5",
    date: "5 Jun 2026",
    isoDate: "2026-06-05",
    published: true,
    items: [
      {
        type: "new",
        text: "Módulo de clases grupales con salones, sesiones y control de aforo",
        detail:
          "Ya puedes crear clases como 'Yoga matutino' o 'Clase de spinning' con un cupo máximo de participantes. Cada clase tiene un instructor asignado, un salón físico y sesiones programadas con fecha y hora. Los clientes se inscriben desde el portal público y el sistema controla automáticamente que no se supere el aforo. Desde el menú lateral ve a Gestión → Módulo de Clases.",
      },
      {
        type: "new",
        text: "Asistente IA en el portal público de reservas",
        detail:
          "Los clientes ahora pueden reservar a través de un chat conversacional en lugar del wizard manual. El asistente les pregunta qué servicio quieren, qué profesional prefieren y qué horario les viene bien, y les muestra una tarjeta de confirmación antes de crear la cita. Está disponible en la pantalla de reserva online junto al botón 'Reservar manualmente'.",
      },
      {
        type: "new",
        text: "Wizard de configuración inicial guiado por IA",
        detail:
          "Los negocios nuevos ya no tienen que configurar servicios, profesionales y horarios uno por uno. Al registrarse pueden elegir 'Configurar con asistente IA' y el chat les guía paso a paso: nombre del negocio, servicios, precios, horarios y colores de marca. Todo queda guardado automáticamente al terminar la conversación.",
      },
      {
        type: "improvement",
        text: "Menú lateral reorganizado por secciones funcionales",
        detail:
          "El menú ahora agrupa las opciones por función: Operaciones (agenda, reservas, caja), Gestión (clientes, servicios, profesionales), Comunicación (WhatsApp, mensajes, campañas), Reportes y Configuración. Esto reduce el tiempo de navegación y hace más claro qué sección corresponde a cada tarea del día a día.",
      },
      {
        type: "improvement",
        text: "Paquetes de sesiones prepagadas por servicio",
        detail:
          "Los clientes pueden comprar un paquete de sesiones por adelantado (ej: '10 clases de pilates'). Cada vez que asisten a una sesión, el sistema descuenta automáticamente una sesión del paquete. Puedes ver el saldo de cada cliente desde su perfil. Los paquetes se configuran en Gestión → Paquetes / Planes.",
      },
    ],
  },
  {
    version: "2.4",
    date: "2 Mar 2026",
    isoDate: "2026-03-02",
    published: true,
    items: [
      {
        type: "new",
        text: "Sistema de fidelidad con umbrales dinámicos configurables",
        detail:
          "Puedes premiar a tus clientes frecuentes configurando cuántos servicios necesitan para ganar una recompensa (ej: 'Al completar 8 servicios, gana un descuento del 20%'). Los umbrales y la recompensa se definen en la configuración del negocio y puedes cambiarlos en cualquier momento sin afectar el historial ya acumulado.",
      },
      {
        type: "new",
        text: "Historial de recompensas y canje manual desde el perfil del cliente",
        detail:
          "En cada perfil de cliente encontrarás el botón 'Ver premios', que muestra todas las recompensas ganadas con su fecha, tipo (servicio o referido) y si ya fueron canjeadas. El equipo puede marcar una recompensa como canjeada directamente desde ahí, lo que queda registrado con la fecha de canje.",
      },
      {
        type: "new",
        text: "Notificación automática por WhatsApp al ganar una recompensa",
        detail:
          "Cuando un cliente alcanza el umbral y gana su recompensa, el sistema le envía automáticamente un mensaje de WhatsApp con el texto del premio y el nombre del negocio. Puedes personalizar el mensaje desde Comunicación → Mensajes de WhatsApp, buscando el template 'Premio por servicios' o 'Premio por referidos'. Si WhatsApp no está configurado, el sistema simplemente no envía nada (no genera error).",
      },
      {
        type: "new",
        text: "Plan de referidos con contador y recompensas independientes",
        detail:
          "Los clientes pueden referir nuevos clientes al negocio. Cuando el nuevo cliente completa su primer servicio, el referidor acumula un punto de referido. Al llegar al umbral configurado (ej: '5 referidos'), gana una recompensa distinta a la de servicios. Ambos contadores (servicios y referidos) funcionan de forma independiente y se resetean a cero al ganar.",
      },
    ],
  },
  {
    version: "2.3",
    date: "Ene 2026",
    isoDate: "2026-01-01",
    published: true,
    items: [
      {
        type: "new",
        text: "Campañas masivas de WhatsApp con modo simulacro previo",
        detail:
          "Desde Comunicación → Campañas WhatsApp puedes enviar mensajes personalizados a todos tus clientes o a un segmento filtrado. Antes de enviar el mensaje real, puedes hacer un 'Simulacro' que te muestra exactamente a quién se le enviaría y con qué texto, sin gastar mensajes. Una vez revisado, confirmas y se envía al grupo seleccionado.",
      },
      {
        type: "new",
        text: "Integración Meta WhatsApp con registro guiado (Embedded Signup)",
        detail:
          "Ya no es necesario configurar manualmente la API de WhatsApp. Desde Comunicación → Gestionar WhatsApp encontrarás el botón 'Conectar con Meta', que abre una ventana guiada del mismo Facebook para vincular tu número de teléfono empresarial. El proceso tarda menos de 5 minutos y no requiere conocimientos técnicos.",
      },
      {
        type: "new",
        text: "Analíticas avanzadas con gráficas interactivas",
        detail:
          "En Reportes → Analíticas del negocio encontrarás gráficas de ingresos por período, citas por servicio, rendimiento de empleados y tasa de asistencia. Las gráficas son interactivas: puedes hacer hover para ver el valor exacto de cada punto y usar los filtros de fecha para comparar períodos. Disponible en planes con analíticas avanzadas.",
      },
      {
        type: "improvement",
        text: "Nuevos filtros de fecha en reportes de ingresos",
        detail:
          "Los reportes ahora incluyen presets rápidos: 'Esta semana', 'Este mes', 'Últimos 30 días', 'Este año', además del selector de fechas personalizado. También se añadió un desglose por método de pago (efectivo, transferencia, tarjeta) en el resumen de caja.",
      },
    ],
  },
  {
    version: "2.2",
    date: "Nov 2025",
    isoDate: "2025-11-01",
    published: true,
    items: [
      {
        type: "new",
        text: "Gestión de caja diaria con resumen de cierre",
        detail:
          "Desde el menú Operaciones → Gestión de caja puedes registrar los ingresos del día, agregar gastos y abonos por cita, y cerrar la caja al final de la jornada. El cierre genera un resumen con total de ingresos, egresos y saldo neto. Solo los usuarios con permiso de caja pueden ver esta sección.",
      },
      {
        type: "new",
        text: "Suscripciones con PayPal: mensual, trimestral, semestral y anual",
        detail:
          "El pago de la membresía de la plataforma ahora se puede hacer directamente con PayPal desde Configuración → Mi Membresía. Puedes elegir el ciclo de facturación que más te convenga. Una vez activa la suscripción, los cobros se hacen automáticamente sin necesidad de renovar manualmente.",
      },
      {
        type: "new",
        text: "Asistente IA de configuración y soporte del negocio",
        detail:
          "El ícono de chat en la esquina inferior de la pantalla abre el asistente IA. En modo onboarding te guía para crear tus primeros servicios, profesionales y horarios. En modo soporte puedes preguntarle cómo usar cualquier funcionalidad, navegar a una sección o consultar estadísticas rápidas como 'cuántas citas tengo este mes'. Siempre está disponible para usuarios administradores.",
      },
      {
        type: "new",
        text: "Registro de auditoría con historial de eliminaciones",
        detail:
          "Desde Sistema → Historial de eliminaciones los administradores pueden ver un registro cronológico de todo lo que se ha eliminado en la plataforma: clientes, citas, servicios, empleados. Cada entrada muestra qué se eliminó, quién lo hizo y cuándo. Esto permite detectar eliminaciones accidentales y tener trazabilidad completa.",
      },
    ],
  },
];

async function seed() {
  await dbConnection();
  console.log("Conectado a MongoDB");

  const deleted = await SystemAnnouncement.deleteMany({});
  console.log(`✓ ${deleted.deletedCount} anuncio(s) eliminados`);

  await SystemAnnouncement.insertMany(ANNOUNCEMENTS);
  console.log(`✓ ${ANNOUNCEMENTS.length} anuncios insertados con detalles completos`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
