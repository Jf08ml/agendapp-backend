import allTools from "./tools/index.js";

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

export const bookingClaudeTools = allTools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: buildInputSchema(tool.parameters),
}));

export const executeBookingTool = async (name, params, context) => {
  const tool = allTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool desconocida: ${name}`);
  return tool.handler(params, context);
};
