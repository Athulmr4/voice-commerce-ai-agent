// Conversation pipeline shared by POST /api/conversations/:id/messages and
// POST /api/voice/respond. Keeps route handlers thin; business logic lives here.
import { randomUUID } from 'node:crypto';
import { getSqlite, runStmt } from '../db/database.js';
import { getCommerceProvider } from './commerce/index.js';
import { executeTool } from '../tools/tools.js';
import { PricingError } from './pricing/pricing.js';
import { OrderError } from './orders/orders.js';
import { formatINR } from './localization/localization.js';
import { say } from './localization/languagePacks.js';
import type { MerchantLanguage } from './merchants/merchants.js';
import { getMerchant } from './merchants/merchants.js';
import { recordTurn } from './speech/latencyStats.js';
import { spokenProductSummary } from './speech/optimizer.js';
import { logger } from './logger.js';
import { getLLMProviders } from './llm/index.js';
import type { LLMExtraction, LLMProvider, SessionContext } from './llm/LLMProvider.js';
import { getSession, mergeEntities, pushTurn } from '../conversation.js';

export interface MessageResult {
  reply: string;
  products: unknown;
  filters: Record<string, string | number | undefined>;
  intent: string;
  meta: { tool: string; toolLatencyMs: number; llmLatencyMs: number; llm: string; language: string; merchantId: string; success: boolean };
}

export async function processMessage(
  conversationId: string,
  text: string,
  opts: { merchantId?: string } = {},
): Promise<MessageResult> {
  const tStart = Date.now();
  const session = getSession(conversationId);
  if (opts.merchantId) session.merchantId = opts.merchantId;
  const merchant = getMerchant(session.merchantId);
  const lang: MerchantLanguage = merchant.language;
  getSqlite(); // ensure migrated + seeded
  runStmt('INSERT INTO conversation_messages (id,conversation_id,role,text,created_at) VALUES (?,?,?,?,?)',
    [randomUUID(), conversationId, 'user', text, new Date().toISOString()]);
  pushTurn(session, 'user', text);

  const chain = getLLMProviders();
  let serving: LLMProvider | null = null;
  let extraction: LLMExtraction | null = null;
  let tool = 'searchProducts';
  let toolResult: unknown = null;
  let llmLatencyMs = 0;
  let toolLatencyMs = 0;

  // Path A — function-calling: first cloud provider whose decideTool succeeds
  // picks tool + args; the registry executes. Intent/entities derive from the
  // decision, so this costs exactly one LLM call.
  // Safety: placeOrder executes ONLY against a matching pending confirmation.
  // A model that jumps straight to placeOrder is downgraded to staging.
  for (const candidate of chain) {
    if (!candidate.decideTool) continue;
    const t0 = Date.now();
    try {
      const decision = await candidate.decideTool(text, session);
      llmLatencyMs = Date.now() - t0;
      const tTool = Date.now();
      const emptyEntities = {
        category: null, maxPrice: null, minPrice: null, color: null,
        brand: null, size: null, productId: null, orderId: null, quantity: null,
      };
      if (decision.name === 'placeOrder' && !pendingMatches(session, decision.args)) {
        const staged = await stagePendingOrder(decision.args, text, session, emptyEntities);
        toolResult = staged.result;
      } else {
        toolResult = await executeTool(decision.name, decision.args);
        // A buy request priced by the model still needs an explicit yes:
        // stage the pending order so the reply asks for confirmation.
        if (decision.name === 'calculatePrice' && isBuyRequest(text) && !session.pendingOrder) {
          const staged = await stagePendingOrder(decision.args, text, session, emptyEntities);
          if ((staged.result as { pending?: boolean })?.pending) {
            toolResult = staged.result;
            decision.name = 'placeOrder';
          }
        }
      }
      toolLatencyMs = Date.now() - tTool;
      tool = decision.name;
      serving = candidate;
      extraction = extractionFromDecision(decision.name, decision.args);
      break;
    } catch (e) {
      llmLatencyMs = Date.now() - t0;
      logger.warn({ provider: candidate.name, err: (e as Error).message?.slice(0, 200) }, 'llm decideTool failed, trying next');
    }
  }

  // Path B — intent extraction + deterministic routing, first success wins.
  // The trailing keyword provider never throws, so extraction is always set.
  if (!toolResult) {
    for (const candidate of chain) {
      const t0 = Date.now();
      try {
        extraction = await candidate.extract(text, session);
        llmLatencyMs = Date.now() - t0;
        if (candidate.name !== 'keyword-fallback') serving = candidate;
        break;
      } catch (e) {
        llmLatencyMs = Date.now() - t0;
        logger.warn({ provider: candidate.name, err: (e as Error).message?.slice(0, 200) }, 'llm extract failed, trying next');
      }
    }
    if (!extraction) throw new Error('All LLM providers failed');
    const tTool = Date.now();
    const routed = await routeIntent(text, extraction, session);
    toolLatencyMs = Date.now() - tTool;
    tool = routed.tool;
    toolResult = routed.result;
  }
  const llmUsed = serving ? serving.name : 'keyword-fallback';

  if (extraction) {
    Object.assign(session, mergeEntities(session, extraction.entities));
  }
  // Remember top results so follow-ups ("tell me more", "size 9?") resolve without repeats.
  if (tool === 'searchProducts' && Array.isArray(toolResult) && toolResult.length > 0) {
    session.lastProductIds = (toolResult as { id: string }[]).slice(0, 3).map(p => p.id);
  } else if (tool === 'getProductDetails' && (toolResult as { id?: string })?.id) {
    session.lastProductIds = [(toolResult as { id: string }).id];
  }
  const toolSummary = summarizeTool(tool, toolResult);

  // Voice reply: LLM phrasing when a cloud provider served the turn,
  // deterministic merchant-language templates otherwise.
  let reply: string;
  if (serving && extraction) {
    try {
      reply = await serving.reply({ text, extraction, context: session, toolSummary });
    } catch {
      reply = fallbackReply(tool, toolResult, lang);
    }
  } else {
    reply = fallbackReply(tool, toolResult, lang);
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
    meta: { tool, toolLatencyMs, llmLatencyMs, llm: llmUsed, language: lang, merchantId: merchant.id, success },
  };
}

function toolToIntent(tool: string): string {
  return { searchProducts: 'product_search', getProductDetails: 'product_details', checkInventory: 'inventory_check', calculatePrice: 'price_check', getOrderStatus: 'order_status', placeOrder: 'place_order', searchKnowledge: 'knowledge' }[tool] ?? 'unclear';
}

// Derive the session update from a function-calling decision so Path A costs
// exactly one LLM call (no follow-up extraction needed).
function extractionFromDecision(tool: string, args: Record<string, unknown>): LLMExtraction {
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return {
    intent: toolToIntent(tool) as LLMExtraction['intent'],
    entities: {
      category: str(args.category),
      maxPrice: num(args.maxPrice),
      minPrice: num(args.minPrice),
      color: str(args.color),
      brand: str(args.brand),
      size: args.size != null ? String(args.size) : null,
      productId: str(args.productId),
      orderId: str(args.orderId),
      quantity: num(args.quantity),
    },
  };
}

interface Routed { tool: string; args: Record<string, unknown>; result: unknown }

// Explicit purchase wording (shared with the keyword extractor's intent rules).
function isBuyRequest(text: string): boolean {
  return /buy|place (the|my) order|order it|checkout|book it|confirm (the|my) order|proceed to (buy|pay)/i.test(text);
}

// True when the pending confirmation covers exactly what the model wants to order.
function pendingMatches(session: SessionContext, args: Record<string, unknown>): boolean {
  const p = session.pendingOrder;
  if (!p) return false;
  if (typeof args.productId === 'string' && args.productId !== p.productId) return false;
  if (typeof args.quantity === 'number' && args.quantity !== p.quantity) return false;
  if (typeof args.size === 'string' && (args.size !== p.size)) return false;
  return true;
}

// Resolve a product, price it deterministically, and stage it as pendingOrder.
// Shared by Path A (model jumped straight to placeOrder) and Path B (new request).
async function stagePendingOrder(
  hints: { productId?: string | null; size?: string; quantity?: number; discountCode?: string },
  text: string,
  s: SessionContext,
  entities: LLMExtraction['entities'],
): Promise<Routed> {
  let productId = hints.productId ?? s.productId ?? s.lastProductIds?.[0];
  if (!productId) {
    const found = (await executeTool('searchProducts', {
      category: entities.category ?? s.category, brand: entities.brand ?? s.brand, limit: 1,
    })) as { id: string }[];
    if (found.length === 0) return { tool: 'searchProducts', args: {}, result: [] };
    productId = found[0].id;
  }
  const size = hints.size ?? s.size;
  const qty = (typeof hints.quantity === 'number' && hints.quantity >= 1 && hints.quantity <= 99)
    ? Math.floor(hints.quantity)
    : (parseQuantity(text) || 1);
  const discountCode = hints.discountCode ?? (await matchDiscountCode(text));
  try {
    const breakup = (await executeTool('calculatePrice', {
      productId, quantity: qty, ...(discountCode ? { discountCode } : {}),
    })) as { total: number };
    const details = (await executeTool('getProductDetails', { productId }).catch(() => null)) as { name?: string } | null;
    const productName = details?.name ?? productId;
    s.pendingOrder = { productId, ...(size ? { size } : {}), quantity: qty, ...(discountCode ? { discountCode } : {}), total: breakup.total };
    return { tool: 'placeOrder', args: { productId }, result: { pending: true, productId, productName, size, quantity: qty, discountCode, total: breakup.total } };
  } catch (e) {
    if (e instanceof PricingError) return { tool: 'placeOrder', args: { productId }, result: { error: e.code } };
    throw e;
  }
}

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

  if (extraction.intent === 'knowledge') {
    const result = await executeTool('searchKnowledge', { query: text, limit: 2 });
    return { tool: 'searchKnowledge', args: { query: text }, result };
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

  if (extraction.intent === 'place_order') {
    const t = text.toLowerCase();
    // Cancel a pending order. Scoped to turns where one exists (see extractor).
    if (/^(no|nope|cancel|don't|dont|stop)\b/.test(t) && s.pendingOrder) {
      s.pendingOrder = undefined;
      return { tool: 'placeOrder', args: {}, result: { cancelled: true } };
    }
    // Confirm a pending order: re-price fresh, then execute. Never trust a stale total.
    if (/^(yes|yeah|yep|ok|sure|confirm|do it|place it|go ahead|buy|order)\b/.test(t) && s.pendingOrder) {
      const p = s.pendingOrder;
      s.pendingOrder = undefined;
      try {
        const result = await executeTool('placeOrder', {
          productId: p.productId, ...(p.size ? { size: p.size } : {}),
          quantity: p.quantity, ...(p.discountCode ? { discountCode: p.discountCode } : {}),
        });
        return { tool: 'placeOrder', args: { productId: p.productId }, result };
      } catch (e) {
        const code = (e as { code?: string })?.code ?? 'ORDER_FAILED';
        return { tool: 'placeOrder', args: { productId: p.productId }, result: { error: code } };
      }
    }
    // New order request: resolve product, price it, and stage for confirmation.
    // Nothing is ordered here — execution requires a later explicit yes.
    return stagePendingOrder(
      { productId: entities.productId, size: entities.size ?? s.size },
      text, s, entities,
    );
  }

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

  // product_search / chitchat / unclear: search with merged context.
  // A topic switch voids any unconfirmed order (prevents stale "yes" buys).
  if (categoryChanged) s.pendingOrder = undefined;
  const args = {
    category: entities.category ?? s.category, maxPrice: entities.maxPrice ?? s.maxPrice,
    minPrice: entities.minPrice ?? s.minPrice, color: entities.color ?? s.color,
    brand: entities.brand ?? s.brand, limit: 3,
  };
  return { tool: 'searchProducts', args, result: await executeTool('searchProducts', args) };
}

export function parseQuantity(text: string): number {
  // A number after "size" is the SIZE, never the quantity. Same for order ids.
  const cleaned = text.replace(/size\s?\d+/gi, ' ').replace(/\b[A-Z]{2}\d{4,}\b/g, ' ');
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const d = cleaned.match(/(\d+)\s?(?:piece|pieces|pair|pairs|qty|quantity|nos)?/i);
  if (d) return Math.min(Math.max(Number(d[1]), 1), 99);
  for (const [w, n] of Object.entries(words)) {
    if (new RegExp(`\\b${w}\\b`, 'i').test(cleaned)) return n;
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
  if (tool === 'searchKnowledge') {
    const hits = (result ?? []) as { title?: string; text?: string; score?: number }[];
    if (hits.length === 0) return 'Knowledge lookup returned nothing.';
    return `Policy ${hits[0].title}: ${hits[0].text}`;
  }
  if (tool === 'placeOrder') {
    if (r.cancelled) return 'Order cancelled.';
    if (r.pending) return `Order pending confirmation: ${r.quantity}x ${r.productName ?? r.productId} total ${r.total}.`;
    if (r.error) return `placeOrder failed: ${r.error}.`;
    return `Order ${r.orderId} placed: ${r.quantity}x ${r.productName ?? r.productId}, total ${r.total}.`;
  }
  const list = (result as { name: string; price: number }[]).map(p => `${p.name} at ${p.price}`).join('; ') || 'none';
  return `searchProducts returned ${(result as unknown[]).length} items: ${list}.`;
}

function fallbackReply(tool: string, result: unknown, lang: MerchantLanguage): string {
  const r = (result ?? {}) as Record<string, unknown>;

  if (tool === 'getOrderStatus') {
    if (r.error) return say(lang, 'orderNotFound');
    return say(lang, 'orderStatus', {
      order_id: String(r.orderId), order_status: String(r.status).toLowerCase(),
      order_total: formatINR(Number(r.total)), estimated_delivery: String(r.estimatedDelivery).toLowerCase(),
    });
  }

  if (tool === 'checkInventory') {
    if (!('available' in r)) return say(lang, 'invUnknown');
    if (r.available) return say(lang, 'invAvailable', { quantity: Number(r.quantity) });
    return say(lang, 'invOutOfStock');
  }

  if (tool === 'calculatePrice') {
    if (r.error === 'INVALID_DISCOUNT') return say(lang, 'priceBadDiscount');
    if (r.error) return say(lang, 'priceError');
    return say(lang, 'priceTotal', {
      total: formatINR(Number(r.total)), quantity: Number(r.quantity),
      discount: formatINR(Number(r.discount)), shipping: formatINR(Number(r.shipping)),
    });
  }

  if (tool === 'getProductDetails') {
    if (!r.name) return say(lang, 'detailsMissing');
    return spokenProductSummary({
      name: String(r.name), price: Number(r.price), brand: String(r.brand ?? ''),
      color: (r.color as string | null) ?? null, description: String(r.description ?? ''),
    }, lang);
  }

  if (tool === 'placeOrder') {
    if (r.cancelled) return say(lang, 'orderCancelled');
    if (r.pending) {
      return say(lang, 'orderStage', {
        quantity: Number(r.quantity), product: String(r.productName ?? r.productId), total: formatINR(Number(r.total)),
      });
    }
    if (r.error === 'OUT_OF_STOCK') return say(lang, 'orderStockout');
    if (r.error) return say(lang, 'orderFailed');
    return say(lang, 'orderPlaced', {
      order_id: String(r.orderId), total: formatINR(Number(r.total)),
    });
  }

  if (tool === 'searchKnowledge') {
    const hits = (result ?? []) as { text?: string }[];
    if (hits.length === 0 || !hits[0].text) return say(lang, 'knowledgeMissing');
    const snippet = hits[0].text!.split('. ').slice(0, 2).join('. ').slice(0, 220);
    return `${say(lang, 'knowledgeLead')}: ${snippet}`;
  }

  const list = (result ?? []) as { price: number }[];
  if (list.length === 0) {
    return say(lang, 'greeting');
  }
  const cheapest = list[0]?.price ?? null;
  return say(lang, 'searchSummary', {
    count: list.length, plural: list.length > 1 ? 's' : '',
    cheapest: cheapest != null ? formatINR(cheapest) : '',
  });
}
