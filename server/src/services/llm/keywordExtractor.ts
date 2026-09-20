import type { LLMExtraction, LLMProvider, SessionContext } from './LLMProvider.js';

// Deterministic fallback used when no LLM key is configured or the LLM call fails.
// Also serves as the baseline for tests. Keeps the app runnable offline.
// English-only: all requests are treated as English, all replies are English.
export function extractFilters(
  text: string,
  prev: SessionContext,
): { category?: string; maxPrice?: number; color?: string; brand?: string; size?: string } {
  const t = text.toLowerCase();
  const next: Record<string, string | number> = { ...prev } as Record<string, string | number>;
  if (/running|run\b/.test(t)) next.category = 'running shoes';
  else if (/sneaker/.test(t)) next.category = 'sneakers';
  else if (/laptop/.test(t)) next.category = 'laptop';
  else if (/shoe/.test(t) && !next.category) next.category = 'running shoes';
  const m =
    t.match(/(?:under|below|within|around)\D{0,10}(\d[\d,]*)/) ??
    t.match(/(\d[\d,]*)\s*(?:rupees|rs|inr)/);
  if (m) next.maxPrice = Number(m[1].replace(/,/g, ''));
  for (const c of ['black', 'white', 'red', 'blue', 'silver', 'grey', 'gray']) {
    if (t.includes(c)) { next.color = c === 'gray' ? 'grey' : c; break; }
  }
  for (const b of ['nike', 'adidas', 'puma', 'campus', 'hp', 'lenovo', 'asics']) {
    if (t.includes(b)) { next.brand = b[0].toUpperCase() + b.slice(1); break; }
  }
  const size = t.match(/size\s?(\d+)/);
  if (size) next.size = size[1];
  return next as { category?: string; maxPrice?: number; color?: string; brand?: string; size?: string };
}

export class KeywordProvider implements LLMProvider {
  readonly name = 'keyword-fallback';
  async extract(text: string, context: SessionContext): Promise<LLMExtraction> {
    const t = text.toLowerCase();
    const order = text.match(/\b([A-Z]{2}\d{4,})\b/);
    const merged = extractFilters(text, context);
    let intent: LLMExtraction['intent'] = 'product_search';
    if (order || /order|status|where.*(order|package)|deliver/.test(t)) intent = 'order_status';
    else if (/detail|specification|about (this|that|it)|tell me more/.test(t)) intent = 'product_details';
    else if (/^(yes|yeah|yep|ok|sure)\b/.test(t) && context.lastProductIds?.length) intent = 'product_details';
    else if (/available|stock|size/.test(t) && (merged.category || merged.size)) intent = 'inventory_check';
    else if (/price|total|cost|discount|cheap/.test(t)) intent = 'price_check';
    else if (/^(hi|hello|hey|thanks|thank you|bye)\b/.test(t)) intent = 'chitchat';
    else if (!merged.category && merged.maxPrice == null) intent = 'unclear';
    return {
      intent,
      entities: {
        category: merged.category ?? null,
        maxPrice: merged.maxPrice ?? null,
        minPrice: null,
        color: merged.color ?? null,
        brand: merged.brand ?? null,
        size: merged.size ?? null,
        productId: null,
        orderId: order?.[1] ?? null,
        quantity: null,
      },
    };
  }
  async reply(): Promise<string> {
    throw new Error('KeywordProvider does not generate replies; use deterministic templates');
  }
}
