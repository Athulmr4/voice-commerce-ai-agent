import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

process.env.NODE_ENV = 'test';
// Hermetic: conversation tests use the deterministic keyword path, never live Gemini.
delete process.env.GOOGLE_API_KEY;


describe('Phase 1 API', () => {
  it('health ok', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
  it('search running shoes under 3000', async () => {
    const r = await request(app).get('/api/products').query({ category: 'running shoes', maxPrice: 3000 });
    expect(r.status).toBe(200);
    expect(r.body.products.length).toBeGreaterThan(0);
    for (const p of r.body.products) expect(p.price).toBeLessThanOrEqual(3000);
  });
  it('rejects invalid maxPrice', async () => {
    const r = await request(app).get('/api/products').query({ maxPrice: 'abc' });
    expect(r.status).toBe(400);
  });
  it('inventory returns availability shape', async () => {
    const r = await request(app).get('/api/products/P100/inventory').query({ size: '9' });
    expect(r.status).toBe(200);
    expect(r.body.available).toBe(true);
    expect(r.body.quantity).toBe(8);
  });
  it('conversation handles order status intent', async () => {
    const c = await request(app).post('/api/conversations');
    const r = await request(app).post(`/api/conversations/${c.body.conversationId}/messages`).send({ text: 'Where is my order KW12345?' });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe('order_status');
    expect(r.body.meta.tool).toBe('getOrderStatus');
    expect(r.body.reply).toMatch(/shipped/i);
  });
  it('conversation handles inventory intent with context', async () => {
    const c = await request(app).post('/api/conversations');
    const id = c.body.conversationId;
    await request(app).post(`/api/conversations/${id}/messages`).send({ text: 'I need running shoes' });
    const r = await request(app).post(`/api/conversations/${id}/messages`).send({ text: 'Is it available in size 9?' });
    expect(r.status).toBe(200);
    expect(r.body.intent).toBe('inventory_check');
    expect(r.body.meta.tool).toBe('checkInventory');
    expect(r.body.reply).toMatch(/available/i);
  });
  it('meta reports llm + tool latency', async () => {
    const c = await request(app).post('/api/conversations');
    const r = await request(app).post(`/api/conversations/${c.body.conversationId}/messages`).send({ text: 'Hi' });
    expect(r.body.meta.llm).toBeTruthy();
    expect(typeof r.body.meta.toolLatencyMs).toBe('number');
    expect(typeof r.body.meta.llmLatencyMs).toBe('number');
  });
  it('conversation keeps context across turns', async () => {
    const c = await request(app).post('/api/conversations');
    const id = c.body.conversationId;
    expect(id).toBeTruthy();
    await request(app).post(`/api/conversations/${id}/messages`).send({ text: 'I need running shoes' });
    const r2 = await request(app).post(`/api/conversations/${id}/messages`).send({ text: 'Under 3000, black ones' });
    expect(r2.status).toBe(200);
    expect(r2.body.filters.category).toBe('running shoes');
    expect(r2.body.filters.maxPrice).toBe(3000);
    expect(r2.body.filters.color).toBe('black');
  });
});
