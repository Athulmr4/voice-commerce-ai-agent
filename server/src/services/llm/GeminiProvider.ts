import { GoogleGenerativeAI } from '@google/generative-ai';
import { EXTRACTION_PROMPT, VOICE_PROMPT } from '../../prompts/voice.prompt.js';
import { GEMINI_TOOL_DECLARATIONS } from '../../tools/geminiDeclarations.js';
import type { LLMExtraction, LLMProvider, SessionContext } from './LLMProvider.js';

const TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('LLM timeout')), ms)),
  ]);
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

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  private model: string;
  private apiKey: string;
  constructor(apiKey = process.env.GOOGLE_API_KEY ?? '', model = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash') {
    this.apiKey = apiKey;
    this.model = model;
  }

  private client() {
    return new GoogleGenerativeAI(this.apiKey).getGenerativeModel({
      model: this.model,
      generationConfig: { responseMimeType: 'application/json' },
    });
  }

  async extract(text: string, context: SessionContext): Promise<LLMExtraction> {    const history = (context.history ?? []).slice(-6).map(h => `${h.role}: ${h.text}`).join('\n');
    const prompt = `${EXTRACTION_PROMPT}\n\nPrior conversation context (merged entities so far): ${JSON.stringify({
      category: context.category ?? null, maxPrice: context.maxPrice ?? null,
      color: context.color ?? null, brand: context.brand ?? null,
    })}\nRecent turns:\n${history || '(none)'}\n\nCustomer: ${text}`;
    const res = await withTimeout(this.client().generateContent(prompt));
    const parsed = safeParse(res.response.text());
    if (!parsed) throw new Error('LLM returned unparseable extraction');
    return parsed;
  }

  async reply(args: { text: string; extraction: LLMExtraction; context: SessionContext; toolSummary: string }): Promise<string> {
    const textModel = new GoogleGenerativeAI(this.apiKey).getGenerativeModel({ model: this.model });
    const prompt = `${VOICE_PROMPT}\n\nRespond in English.\nCustomer said: "${args.text}"\nBackend result (authoritative, describe only this): ${args.toolSummary}\nReply in 1-3 short spoken sentences with at most one question.`;
    const res = await withTimeout(textModel.generateContent(prompt));
    return res.response.text().trim().slice(0, 500);
  }

  // True function-calling: the model picks the tool + arguments. The caller
  // executes via the validated registry and feeds results back for phrasing.
  async decideTool(text: string, context: SessionContext): Promise<{ name: string; args: Record<string, unknown> }> {
    const model = new GoogleGenerativeAI(this.apiKey).getGenerativeModel({
      model: this.model,
      tools: [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }],
    });
    const history = (context.history ?? []).slice(-6).map(h => `${h.role}: ${h.text}`).join('\n');
    const pending = context.pendingOrder
      ? ` There is an UNCONFIRMED order awaiting explicit confirmation: ${JSON.stringify(context.pendingOrder)}. If the customer confirms (yes/confirm/place it), call placeOrder with exactly these details. If they decline or change topic, do not call placeOrder.`
      : '';
    const prompt = `You are a shopping assistant router. Call exactly one backend tool for the customer request below. Only call placeOrder to confirm the UNCONFIRMED order above; for any new buy request call calculatePrice instead and the application will ask for confirmation. A number after the word "size" is the SIZE, never the quantity. Context: ${JSON.stringify({
      category: context.category ?? null, maxPrice: context.maxPrice ?? null,
      color: context.color ?? null, brand: context.brand ?? null, size: context.size ?? null,
      productId: context.productId ?? null, recentProductIds: context.lastProductIds ?? [],
    })}.${pending} When the customer refers to a previously shown item ("it", "these", "that one"), pass its id from recentProductIds as productId. Recent turns:\n${history || '(none)'}\n\nCustomer: ${text}`;
    const res = await withTimeout(model.generateContent(prompt));
    const calls = res.response.functionCalls();
    if (!calls || calls.length === 0) throw new Error('LLM returned no function call');
    return { name: calls[0].name, args: (calls[0].args ?? {}) as Record<string, unknown> };
  }
}
