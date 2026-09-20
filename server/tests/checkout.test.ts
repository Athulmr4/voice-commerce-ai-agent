import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { executeTool } from '../src/tools/tools.js';
import { parseQuantity } from '../src/services/conversationService.js';
import { queryAll } from '../src/db/database.js';
import { getLLMProviders } from '../src/services/llm/index.js';

process.env.NODE_ENV = 'test';
// Isolated DB: each test file seeds a fresh in-memory database.
process.env.SQLITE_PATH = ':memory:';
// Hermetic: deterministic keyword path, never a live LLM.
delete process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.LLM_PROVIDER;

describe('Checkout (placeOrder with confirmation)', () => {
  it('parseQuantity never mistakes a size for a quantity', () => {
    expect(parseQuantity('Buy the Nike Revolution in size 9')).toBe(1);
    expect(parseQuantity('2 pairs in size 9')).toBe(2);
    expect(parseQuantity('What is the total for 2 with SUMMER10?')).toBe(2);
  });
  it('placeOrder prices, decrements stock, and persists order + items', async () => {
    const before = await queryAll('SELECT quantity FROM inventory WHERE product_id=? AND size=?', ['P100', '9']);
    const qtyBefore = Number((before[0] as Record<string, unknown>).quantity);
    const r = (await executeTool('placeOrder', { productId: 'P100', size: '9', quantity: 1 })) as Record<string, unknown>;
    expect(r.status).toBe('CONFIRMED');
    expect(String(r.orderId)).toMatch(/^KW/);
    expect(r).toMatchObject({ subtotal: 2499, discount: 0, shipping: 100, total: 2599 });
    const after = await queryAll('SELECT quantity FROM inventory WHERE product_id=? AND size=?', ['P100', '9']);
    expect(Number((after[0] as Record<string, unknown>).quantity)).toBe(qtyBefore - 1);
    const items = await queryAll('SELECT * FROM order_items WHERE order_id=?', [r.orderId]);
    expect(items).toHaveLength(1);
  });
  it('placeOrder rejects bad input and empty stock', async () => {
    await expect(executeTool('placeOrder', { productId: 'ZZZ', quantity: 1 })).rejects.toMatchObject({ code: 'INVALID_PRODUCT' });
    await expect(executeTool('placeOrder', { productId: 'P100', quantity: 1, discountCode: 'BAD' })).rejects.toMatchObject({ code: 'INVALID_DISCOUNT' });
    await expect(executeTool('placeOrder', { productId: 'P100', size: '10', quantity: 1 })).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
  });
  it('POST /api/orders validates and confirms', async () => {
    const ok = await request(app).post('/api/orders').send({ productId: 'P107', quantity: 2 });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('CONFIRMED');
    expect(ok.body.subtotal).toBe(3598);
    expect((await request(app).post('/api/orders').send({ quantity: 1 })).status).toBe(400);
    expect((await request(app).post('/api/orders').send({ productId: 'P100', size: '10', quantity: 1 })).status).toBe(409);
  });
  it('conversation stages an order and places it only after yes', async () => {
    const c = await request(app).post('/api/conversations');
    const id = c.body.conversationId;
    const stage = await request(app).post(`/api/conversations/${id}/messages`).send({ text: 'I want to buy the Campus North Plus in size 9' });
    expect(stage.body.intent).toBe('place_order');
    expect(stage.body.reply).toMatch(/say yes to confirm/i);
    expect(stage.body.reply).toMatch(/Campus North Plus/);
    // size 9 is the SIZE, not a quantity of 9: 1799 + 100 shipping
    expect(stage.body.reply).toMatch(/1,899/);
    const done = await request(app).post(`/api/conversations/${id}/messages`).send({ text: 'Yes, place it' });
    expect(done.body.reply).toMatch(/confirmed/i);
    expect(done.body.reply).toMatch(/KW\w+/);
  });
  it('conversation cancels a pending order on no', async () => {
    const c = await request(app).post('/api/conversations');
    const id = c.body.conversationId;
    await request(app).post(`/api/conversations/${id}/messages`).send({ text: 'Buy the Nike Revolution in size 9' });
    const cancelled = await request(app).post(`/api/conversations/${id}/messages`).send({ text: 'No, cancel it' });
    expect(cancelled.body.reply).toMatch(/cancelled/i);
  });
});

describe('LLM fallback chain', () => {
  it('orders providers Groq → Gemini → keyword', () => {
    expect(getLLMProviders().map(p => p.name)).toEqual(['keyword-fallback']);
    process.env.GOOGLE_API_KEY = 'g';
    process.env.GROQ_API_KEY = 'q';
    try {
      expect(getLLMProviders().map(p => p.name)).toEqual(['groq', 'gemini', 'keyword-fallback']);
      process.env.LLM_PROVIDER = 'gemini';
      expect(getLLMProviders().map(p => p.name)).toEqual(['gemini', 'keyword-fallback']);
    } finally {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.LLM_PROVIDER;
    }
  });
});
