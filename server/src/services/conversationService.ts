// Conversation pipeline shared by POST /api/conversations/:id/messages and
// POST /api/voice/respond. Keeps route handlers thin; business logic lives here.
import { randomUUID } from 'node:crypto';
import { getSqlite, runStmt } from '../db/database.js';
import { getCommerceProvider } from './commerce/index.js';
import { executeTool } from '../tools/tools.js';
import { PricingError } from './pricing/pricing.js';
import { OrderError } from './orders/orders.js';
import { renderTemplate, formatINR } from './localization/localization.js';
import { recordTurn } from './speech/latencyStats.js';
import { spokenProductSummary } from './speech/optimizer.js';
import { getLLMProvider, isLLMConfigured } from './llm/index.js';
import { KeywordProvider, detectHinglish } from './llm/keywordExtractor.js';
import type { LLMExtraction, SessionContext } from './llm/LLMProvider.js';
import { getSession, mergeEntities, pushTurn } from '../conversation.js';

export interface MessageResult {
  reply: string;
  products: unknown;
  filters: Record<string, string | number | undefined>;
  intent: string;
  meta: { tool: string; toolLatencyMs: number; llmLatencyMs: number; llm: string; language: string; success: boolean };
}

export async function processMessage(conversationId: string, text: string): Promise<MessageResult> {
  const tStart = Date.now();
  const session = getSession(conversationId);
  getSqlite(); // ensure migrated + seeded
  runStmt('INSERT INTO conversation_messages (id,conversation_id,role,text,created_at) VALUES (?,?,?,?,?)',
    [randomUUID(), conversationId, 'user', text, new Date().toISOString()]);
  pushTurn(session, 'user', text);

  const llm = getLLMProvider();
  let extraction: LLMExtraction | null = null;
  let tool = 'searchProducts';
  let toolResult: unknown = null;
  let llmLatencyMs = 0;
  let toolLatencyMs = 0;
  let llmUsed = llm.name;

  // Path A — Gemini function-calling: model picks tool + args, registry executes.
  if (isLLMConfigured() && llm.decideTool) {
    const t0 = Date.now();
    try {
      const decision = await llm.decideTool(text, session);
      llmLatencyMs = Date.now() - t0;
      const tTool = Date.now();
      toolResult = await executeTool(decision.name, decision.args);
      toolLatencyMs = Date.now() - tTool;
      tool = decision.name;
      extraction = await llm.extract(text, session).catch(() => null);
    } catch {
      llmLatencyMs = Date.now() - t0;
      llmUsed = 'keyword-fallback (llm-error)';
    }
  }

  // Path B — intent extraction + deterministic routing (offline default, or Gemini fallback).
  if (!toolResult) {
    const t0 = Date.now();
    try {
      extraction = await llm.extract(text, session);
    } catch {
      extraction = await new KeywordProvider().extract(text, session);
      llmUsed = 'keyword-fallback (llm-error)';
    }
    llmLatencyMs = Date.now() - t0;
    const tTool = Date.now();
    const routed = await routeIntent(text, extraction, session);
    toolLatencyMs = Date.now() - tTool;
    tool = routed.tool;
    toolResult = routed.result;
  }

  if (extraction) {
    Object.assign(session, mergeEntities(session, extraction.entities));
  }
  // Remember top results so follow-ups ("haan batao", "size 9?") resolve without repeats.
  if (tool === 'searchProducts' && Array.isArray(toolResult) && toolResult.length > 0) {
    session.lastProductIds = (toolResult as { id: string }[]).slice(0, 3).map(p => p.id);
  } else if (tool === 'getProductDetails' && (toolResult as { id?: string })?.id) {
    session.lastProductIds = [(toolResult as { id: string }).id];
  }
  const hinglish = extraction?.language === 'hinglish' || detectHinglish(text);
  const toolSummary = summarizeTool(tool, toolResult);

  // Voice reply: LLM phrasing when available, localized deterministic templates otherwise.
  let reply: string;
  if (llmUsed === 'gemini' && extraction) {
    try {
      reply = await llm.reply({ text, extraction, context: session, toolSummary });
    } catch {
      reply = fallbackReply(tool, toolResult, hinglish, text);
    }
  } else {
    reply = fallbackReply(tool, toolResult, hinglish, text);
  }

  runStmt('INSERT INTO conversation_messages (id,conversation_id,role,text,created_at) VALUES (?,?,?,?,?)',
    [randomUUID(), conversationId, 'assistant', reply, new Date().toISOString()]);
  pushTurn(session, 'assistant', reply);

  const totalMs = Date.now() - tStart;
  const intent = extraction?.intent ?? toolToIntent(tool);
  const success = !(toolResult as { error?: string } | null)?.error;
  recordTurn({ llmMs: llmLatencyMs, toolMs: toolLatencyMs, totalMs, tool, intent, success });

  return {
    reply,
    products: tool === 'searchProducts' ? toolResult : tool === 'getProductDetails' ? [toolResult] : [],
    filters: {
      category: session.category, maxPrice: session.maxPrice, minPrice: session.minPrice,
      color: session.color, brand: session.brand, size: session.size, productId: session.productId,
    },
    intent,
    meta: { tool, toolLatencyMs, llmLatencyMs, llm: llmUsed, language: hinglish ? 'hinglish' : 'english', success },
  };
}

function toolToIntent(tool: string): string {
  return { searchProducts: 'product_search', getProductDetails: 'product_details', checkInventory: 'inventory_check', calculatePrice: 'price_check', getOrderStatus: 'order_status' }[tool] ?? 'unclear';
}

interface Routed { tool: string; args: Record<string, unknown>; result: unknown }

async function routeIntent(text: string, extraction: LLMExtraction, session: SessionContext): Promise<Routed> {
  const s = session;
  const entities = extraction.entities;

  if (extraction.intent === 'order_status') {
    const orderId = entities.orderId ?? [...text.matchAll(/\b([A-Z]{2}\d{4,})\b/g)].map(m => m[1])[0] ?? 'KW12345';
    try {
      return { tool: 'getOrderStatus', args: { orderId }, result: await executeTool('getOrderStatus', { orderId }) };
    } catch (e) {
      if (e instanceof OrderError) return { tool: 'getOrderStatus', args: { orderId }, result: { error: e.code, orderId } };
      throw e;
    }
  }

  if (extraction.intent === 'product_details') {
    const productId = entities.productId ?? s.productId ?? s.lastProductIds?.[0];
    if (productId) {
      try {
        const result = await executeTool('getProductDetails', { productId });
        return { tool: 'getProductDetails', args: { productId }, result };
      } catch {
        // fall through to a fresh search below
      }
    }
    const found = (await executeTool('searchProducts', {
      category: entities.category ?? s.category, maxPrice: entities.maxPrice ?? s.maxPrice,
      color: entities.color ?? s.color, brand: entities.brand ?? s.brand, limit: 1,
    })) as { id: string }[];
    if (found.length === 0) return { tool: 'searchProducts', args: {}, result: [] };
    const result = await executeTool('getProductDetails', { productId: found[0].id });
    return { tool: 'getProductDetails', args: { productId: found[0].id }, result };
  }

  // Stale-product guard: only reuse the remembered product when the user did
  // not switch category this turn.
  const categoryChanged = !!entities.category && entities.category !== s.category;
  const remembered = categoryChanged ? undefined : (s.productId ?? s.lastProductIds?.[0]);

  if (extraction.intent === 'price_check') {
    let productId = entities.productId ?? remembered;
    if (!productId) {
      const found = (await executeTool('searchProducts', {
        category: entities.category ?? s.category, maxPrice: entities.maxPrice ?? s.maxPrice,
        color: entities.color ?? s.color, brand: entities.brand ?? s.brand, limit: 1,
      })) as { id: string }[];
      if (found.length > 0) productId = found[0].id;
    }
    if (!productId) return { tool: 'searchProducts', args: {}, result: [] };
    const qty = parseQuantity(text);
    const discountCode = await matchDiscountCode(text);
    try {
      const result = await executeTool('calculatePrice', { productId, quantity: qty, ...(discountCode ? { discountCode } : {}) });
      return { tool: 'calculatePrice', args: { productId, quantity: qty, discountCode }, result };
    } catch (e) {
      if (e instanceof PricingError) return { tool: 'calculatePrice', args: { productId }, result: { error: e.code, message: e.message } };
      throw e;
    }
  }

  if (extraction.intent === 'inventory_check') {
    let productId = entities.productId ?? remembered;
    if (!productId) {
      const found = (await executeTool('searchProducts', {
        category: entities.category ?? s.category, brand: entities.brand ?? s.brand, limit: 1,
      })) as { id: string }[];
      if (found.length === 0) return { tool: 'searchProducts', args: {}, result: [] };
      productId = found[0].id;
    }
    const size = entities.size ?? s.size;
    const result = await executeTool('checkInventory', { productId, ...(size ? { size } : {}) });
    return { tool: 'checkInventory', args: { productId, size }, result };
  }

  // product_search / chitchat / unclear: search with merged context
  const args = {
    category: entities.category ?? s.category, maxPrice: entities.maxPrice ?? s.maxPrice,
    minPrice: entities.minPrice ?? s.minPrice, color: entities.color ?? s.color,
    brand: entities.brand ?? s.brand, limit: 3,
  };
  return { tool: 'searchProducts', args, result: await executeTool('searchProducts', args) };
}

function parseQuantity(text: string): number {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const d = text.match(/(\d+)\s?(?:piece|pieces|pair|pairs|qty|quantity|nos)?/i);
  if (d) return Math.min(Math.max(Number(d[1]), 1), 99);
  for (const [w, n] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(text)) return n;
  }
  return 1;
}

async function matchDiscountCode(text: string): Promise<string | null> {
  const upper = text.toUpperCase();
  // Check candidate-like tokens against the commerce provider (mock DB or Shopify).
  for (const m of upper.matchAll(/\b([A-Z]{2,}[A-Z0-9]*\d[A-Z0-9]*|[A-Z]{4,})\b/g)) {
    const deal = await getCommerceProvider().getDiscount(m[1]).catch(() => null);
    if (deal) return deal.code;
  }
  return null;
}

function summarizeTool(tool: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (tool === 'calculatePrice') {
    if (r.error) return `calculatePrice failed: ${r.error}.`;
    return `Price breakup: unit ${r.unitPrice} x ${r.quantity} = subtotal ${r.subtotal}, discount ${r.discount}, shipping ${r.shipping}, total ${r.total}.`;
  }
  if (tool === 'getOrderStatus') {
    if (r.error) return `Order ${r.orderId} not found.`;
    return `Order ${r.orderId} status ${r.status}, estimated delivery ${r.estimatedDelivery}, total ${r.total}.`;
  }
  if (tool === 'checkInventory') {
    return `Inventory for ${r.productId} size ${(r.size as string) ?? 'all'}: available=${r.available}, quantity=${r.quantity}.`;
  }
  if (tool === 'getProductDetails') {
    const p = r as { name?: string; brand?: string; price?: number };
    return p.name ? `Product ${p.name} by ${p.brand}, price ${p.price}.` : 'Product details lookup returned nothing.';
  }
  const list = (result as { name: string; price: number }[]).map(p => `${p.name} at ${p.price}`).join('; ') || 'none';
  return `searchProducts returned ${(result as unknown[]).length} items: ${list}.`;
}

function fallbackReply(tool: string, result: unknown, hinglish: boolean, text: string): string {
  const r = (result ?? {}) as Record<string, unknown>;
  const t = (template: string, vars: Record<string, string | number>): string =>
    renderTemplate(template, vars).text;

  if (tool === 'getOrderStatus') {
    if (r.error) return hinglish
      ? 'Sorry, is order id ka koi order nahi mila. Id check karke dobara batayein?'
      : "Sorry, I couldn't find that order. Could you check the id?";
    return hinglish
      ? t('Aapka order {{order_id}} {{order_status}} hai, {{order_total}} ka. {{estimated_delivery}} tak pahunchna chahiye.', {
        order_id: String(r.orderId), order_status: String(r.status).toLowerCase(),
        order_total: formatINR(Number(r.total)), estimated_delivery: 'Kal',
      })
      : t('Your order {{order_id}} is {{order_status}}, worth {{order_total}}. Expected {{estimated_delivery}}.', {
        order_id: String(r.orderId), order_status: String(r.status).toLowerCase(),
        order_total: formatINR(Number(r.total)), estimated_delivery: String(r.estimatedDelivery).toLowerCase(),
      });
  }

  if (tool === 'checkInventory') {
    if (r.available) return hinglish
      ? t('Haan, available hai — {{quantity}} piece stock mein hain. Order karna chahenge?', { quantity: Number(r.quantity) })
      : t("Yes, it's available — {{quantity}} in stock. Want to order?", { quantity: Number(r.quantity) });
    return hinglish ? 'Sorry, ye size abhi out of stock hai. Koi aur size dekhun?' : 'Sorry, that size is currently out of stock. Want to try another size?';
  }

  if (tool === 'calculatePrice') {
    if (r.error === 'INVALID_DISCOUNT') return hinglish
      ? 'Sorry, ye discount code valid nahi hai. Bina discount ke total bataun?'
      : 'Sorry, that discount code is not valid. Want the total without it?';
    if (r.error) return hinglish ? 'Sorry, price calculate nahi ho paya. Product confirm karein?' : "Sorry, I couldn't calculate the price. Which product did you mean?";
    return hinglish
      ? t('Total {{total}} hoga — {{quantity}} piece, discount {{discount}}, delivery {{shipping}}. Order karun?', {
        total: formatINR(Number(r.total)), quantity: Number(r.quantity),
        discount: formatINR(Number(r.discount)), shipping: formatINR(Number(r.shipping)),
      })
      : t('Your total is {{total}} — {{quantity}} items, discount {{discount}}, shipping {{shipping}}. Shall I place the order?', {
        total: formatINR(Number(r.total)), quantity: Number(r.quantity),
        discount: formatINR(Number(r.discount)), shipping: formatINR(Number(r.shipping)),
      });
  }

  if (tool === 'getProductDetails') {
    if (!r.name) return hinglish ? 'Sorry, us product ki details nahi mil payi.' : "Sorry, I couldn't pull up those details.";
    return spokenProductSummary(
      {
        name: String(r.name), price: Number(r.price), brand: String(r.brand ?? ''),
        color: (r.color as string | null) ?? null, description: String(r.description ?? ''),
      },
      hinglish ? 'hinglish' : 'english',
    );
  }

  const list = (result ?? []) as { price: number }[];
  if (list.length === 0) {
    return detectHinglish(text) || hinglish
      ? 'Namaste! Main aapka shopping assistant hoon. Aap kya dhoondh rahe hain?'
      : "Hi! I'm your shopping assistant. What are you looking for today?";
  }
  const cheapest = list[0]?.price ?? null;
  if (hinglish) return `Haan, ${list.length} option${list.length > 1 ? 's' : ''} mile hain. Sabse affordable ${cheapest != null ? formatINR(cheapest) : ''} ka hai. Kya main uske details bataun?`;
  return `I found ${list.length} option${list.length > 1 ? 's' : ''}. Cheapest is ${cheapest != null ? formatINR(cheapest) : 'unavailable'}. Want details?`;
}
