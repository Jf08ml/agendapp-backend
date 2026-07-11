import allTools from "./tools/index.js";
import { confirmReservation } from "./tools/reservation.js";

// confirm_reservation solo existe en el canal WhatsApp (en la web la reserva
// la crea el frontend con el botón de confirmación).
const whatsappTools = [...allTools, confirmReservation];

const buildInputSchema = (parameters) => {
  if (!parameters || Object.keys(parameters).length === 0) {
    return { type: "object", properties: {}, required: [] };
  }

  const properties = {};
  const required = [];

  for (const [key, def] of Object.entries(parameters)) {
    const prop = { type: def.type, description: def.description };
    if (def.items) prop.items = def.items;
    properties[key] = prop;
    if (def.required) required.push(key);
  }

  return { type: "object", properties, required };
};

const toClaudeTool = (tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: buildInputSchema(tool.parameters),
});

export const bookingClaudeTools = allTools.map(toClaudeTool);
export const bookingClaudeToolsWhatsapp = whatsappTools.map(toClaudeTool);

export const executeBookingTool = async (name, params, context) => {
  const tool = whatsappTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool desconocida: ${name}`);
  return tool.handler(params, context);
};
