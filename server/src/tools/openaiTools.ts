import { GEMINI_TOOL_DECLARATIONS } from './geminiDeclarations.js';

// Convert the canonical tool declarations (Gemini SchemaType enums) to
// OpenAI-compatible function tools for Groq's chat completions API:
// { type: 'function', function: { name, description, parameters } }.
export interface OpenAIFunctionTool {
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

function toJsonSchema(node: unknown): Record<string, unknown> {
  if (Array.isArray(node)) return node.map(toJsonSchema) as unknown as Record<string, unknown>;
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : toJsonSchema(v);
    }
    return out;
  }
  return node as Record<string, unknown>;
}

export function toOpenAITools(): OpenAIFunctionTool[] {
  return GEMINI_TOOL_DECLARATIONS.map(d => ({
    type: 'function',
    function: {
      name: d.name!,
      description: d.description,
      parameters: toJsonSchema(d.parameters),
    },
  }));
}
