import { EXTRACTION_PROMPT, VOICE_PROMPT } from '../../prompts/voice.prompt.js';
import { toOpenAITools } from '../../tools/openaiTools.js';
import type { LLMExtraction, LLMProvider, SessionContext } from './LLMProvider.js';

// Groq via its OpenAI-compatible chat completions API (plain fetch, no SDK).
// Fast inference suits voice turns; supports JSON mode + function calling.
// Docs: console.groq.com/docs (chat completions, tool use, JSON mode).
const BASE_URL = 'https://api.groq.com/openai/v1/chat/completions';
const TIMEOUT_MS = 12_000;

export class LLMUpstreamError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string;
  }[];
  error?: { message?: string; code?: string };
}

function safeParse(json: string): LLMExtraction | null {
  try {
    const start = json.indexOf('{');
    const end = json.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    const o = JSON.parse(json.slice(start, end + 1)) as Record<string, unknown>;
    const intent = String(o.intent ?? 'unclear');
    const valid = ['product_search', 'product_details', 'inventory_check', 'price_check', 'order_status', 'place_order', 'chitchat', 'unclear'];
    return {
      intent: (valid.includes(intent) ? intent : 'unclear') as LLMExtraction['intent'],
      entities: {
        category: (o.category as string) ?? null,
        maxPrice: typeof o.maxPrice === 'number' ? o.maxPrice : null,
        minPrice: typeof o.minPrice === 'number' ? o.minPrice : null,
        color: (o.color as string) ?? null,
        brand: (o.brand as string) ?? null,
        size: o.size != null ? String(o.size) : null,
        productId: (o.productId as string) ?? null,
        orderId: (o.orderId as string) ?? null,
        quantity: typeof o.quantity === 'number' ? o.quantity : null,
      },
    };
  } catch {
    return null;
  }
}

export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  private model: string;
  private apiKey: string;
  constructor(apiKey = process.env.GROQ_API_KEY ?? '', model = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b') {
    this.apiKey = apiKey;
    this.model = model;
  }

  private async chat(body: Record<string, unknown>): Promise<ChatResponse> {
    if (!this.apiKey) throw new LLMUpstreamError('LLM_NOT_CONFIGURED', 'Missing GROQ_API_KEY', 501);
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, temperature: 0.2, ...body }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) throw new LLMUpstreamError('LLM_AUTH', 'Groq rejected the API key', 502);
    if (res.status === 429) {
      throw new LLMUpstreamError('LLM_QUOTA', 'Groq rate limit exceeded — slow down or check plan usage', 502);
    }
    if (!res.ok) throw new LLMUpstreamError('LLM_UPSTREAM', `Groq error ${res.status}`, 502);
    return res.json() as Promise<ChatResponse>;
  }

  private contextBlock(context: SessionContext): string {
    const history = (context.history ?? []).slice(-6).map(h => `${h.role}: ${h.text}`).join('\n');
    const pending = context.pendingOrder
      ? `\nThere is an UNCONFIRMED order awaiting explicit confirmation: ${JSON.stringify(context.pendingOrder)}. If the customer confirms (yes/confirm/place it), call placeOrder with exactly these details. If they decline or change topic, do not call placeOrder.`
      : '';
    return `Prior conversation context (merged entities so far): ${JSON.stringify({
      category: context.category ?? null, maxPrice: context.maxPrice ?? null,
      color: context.color ?? null, brand: context.brand ?? null,
      productId: context.productId ?? null, recentProductIds: context.lastProductIds ?? [],
    })}${pending}\nWhen the customer refers to a previously shown item ("it", "these", "that one"), use its id from recentProductIds as productId.\nRecent turns:\n${history || '(none)'}`;
  }

  async extract(text: string, context: SessionContext): Promise<LLMExtraction> {
    const messages: ChatMessage[] = [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: `${this.contextBlock(context)}\n\nCustomer: ${text}` },
    ];
    const res = await this.chat({ messages, response_format: { type: 'json_object' } });
    const content = res.choices?.[0]?.message?.content ?? '';
    const parsed = safeParse(content);
    if (!parsed) throw new LLMUpstreamError('LLM_UNPARSEABLE', 'LLM returned unparseable extraction', 502);
    return parsed;
  }

  async decideTool(text: string, context: SessionContext): Promise<{ name: string; args: Record<string, unknown> }> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a shopping assistant router. Call exactly one backend tool for the customer request below. Only call placeOrder to confirm the UNCONFIRMED order above; for any new buy request call calculatePrice instead and the application will ask for confirmation. A number after the word "size" is the SIZE, never the quantity.',
      },
      { role: 'user', content: `${this.contextBlock(context)}\n\nCustomer: ${text}` },
    ];
    const res = await this.chat({ messages, tools: toOpenAITools(), tool_choice: 'auto' });
    const call = res.choices?.[0]?.message?.tool_calls?.[0]?.function;
    if (!call?.name) throw new LLMUpstreamError('LLM_NO_TOOL_CALL', 'LLM returned no function call', 502);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.arguments ?? '{}') as Record<string, unknown>;
    } catch {
      throw new LLMUpstreamError('LLM_UNPARSEABLE', 'LLM returned invalid tool arguments', 502);
    }
    return { name: call.name, args };
  }

  async reply(args: { text: string; extraction: LLMExtraction; context: SessionContext; toolSummary: string }): Promise<string> {
    const messages: ChatMessage[] = [
      { role: 'system', content: VOICE_PROMPT },
      {
        role: 'user',
        content: `Respond in English.\nCustomer said: "${args.text}"\nBackend result (authoritative, describe only this): ${args.toolSummary}\nReply in 1-3 short spoken sentences with at most one question.`,
      },
    ];
    const res = await this.chat({ messages });
    const content = res.choices?.[0]?.message?.content?.trim() ?? '';
    if (!content) throw new LLMUpstreamError('LLM_EMPTY', 'LLM returned an empty reply', 502);
    return content.slice(0, 500);
  }
}
