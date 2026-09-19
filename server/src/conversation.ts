import type { SessionContext } from './services/llm/LLMProvider.js';

// Session memory: merged entities per conversation + recent turns for LLM context.
// Persisted messages live in sqlite; this keeps the working set in memory.
const sessions = new Map<string, SessionContext>();

export function getSession(id: string): SessionContext {
  let s = sessions.get(id);
  if (!s) { s = {}; sessions.set(id, s); }
  return s;
}

export function createSession(id: string): SessionContext {
  const s: SessionContext = {};
  sessions.set(id, s);
  return s;
}

export function mergeEntities(
  prev: SessionContext,
  e: { category?: string | null; maxPrice?: number | null; minPrice?: number | null; color?: string | null; brand?: string | null; size?: string | null; productId?: string | null },
): SessionContext {
  const next: SessionContext = { ...prev };
  if (e.category) next.category = e.category;
  if (typeof e.maxPrice === 'number') next.maxPrice = e.maxPrice;
  if (typeof e.minPrice === 'number') next.minPrice = e.minPrice;
  if (e.color) next.color = e.color;
  if (e.brand) next.brand = e.brand;
  if (e.size) next.size = e.size;
  if (e.productId) next.productId = e.productId;
  return next;
}

export function pushTurn(session: SessionContext, role: 'user' | 'assistant', text: string): void {
  const h = [...(session.history ?? []), { role, text }].slice(-10);
  session.history = h;
}
