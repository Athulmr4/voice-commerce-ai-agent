import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { queryAll } from '../src/db/database.js';

process.env.NODE_ENV = 'test';
// Isolated DB: each test file seeds a fresh in-memory database.
process.env.SQLITE_PATH = ':memory:';
// Hermetic: deterministic keyword path, never a live LLM.
delete process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.LLM_PROVIDER;

// A cloud model that jumps straight to placeOrder without confirmation.
// The pipeline must downgrade this to staging, never execute it.
vi.mock('../src/services/llm/index.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/services/llm/index.js')>();
  return {
    ...orig,
    getLLMProviders: () => [{
      name: 'reckless-stub',
      decideTool: async () => ({ name: 'placeOrder', args: { productId: 'P100', quantity: 1 } }),
      extract: async () => ({ intent: 'place_order', entities: {} }),
      reply: async () => 'Model phrasing of the staged summary: say yes to confirm',
    }],
  };
});

const { app } = await import('../src/app.js');

describe('placeOrder confirmation guard', () => {
  it('downgrades an unconfirmed model placeOrder to staging', async () => {
    const before = await queryAll('SELECT COUNT(*) as c FROM orders', []);
    const c = await request(app).post('/api/conversations');
    const r = await request(app).post(`/api/conversations/${c.body.conversationId}/messages`).send({ text: 'Buy it now' });
    expect(r.status).toBe(200);
    expect(r.body.meta.tool).toBe('placeOrder');
    expect(r.body.reply).toMatch(/say yes to confirm/i);
    const after = await queryAll('SELECT COUNT(*) as c FROM orders', []);
    expect(Number((after[0] as Record<string, unknown>).c)).toBe(Number((before[0] as Record<string, unknown>).c));
  });
});
