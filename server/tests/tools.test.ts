import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { calculatePrice, PricingError } from '../src/services/pricing/pricing.js';
import { getOrderStatus } from '../src/services/orders/orders.js';
import { renderTemplate } from '../src/services/localization/localization.js';
import { executeTool, toolDefinitions } from '../src/tools/tools.js';
import { GEMINI_TOOL_DECLARATIONS } from '../src/tools/geminiDeclarations.js';

process.env.NODE_ENV = 'test';
// Isolated DB: each test file seeds a fresh in-memory database.
process.env.SQLITE_PATH = ':memory:';
// Hermetic: conversation tests use the deterministic keyword path, never a live LLM.
delete process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.LLM_PROVIDER;


describe('Phase 3 tools', () => {
  it('pricing: normal price, qty 1, shipping applied', async () => {
    const r = await calculatePrice({ productId: 'P100', quantity: 1 });
    expect(r).toMatchObject({ unitPrice: 2499, subtotal: 2499, discount: 0, shipping: 100, total: 2599 });
  });
  it('pricing: discount + multiple quantities (spec example)', async () => {
    // price 2999 x 2, 10% off, +100 shipping
    const r = await calculatePrice({ productId: 'P101', quantity: 2, discountCode: 'SUMMER10' });
    expect(r.subtotal).toBe(5998);
    expect(r.discount).toBeCloseTo(599.8, 1);
    expect(r.shipping).toBe(100);
    expect(r.total).toBeCloseTo(5498.2, 1);
  });
  it('pricing: free shipping over threshold', async () => {
    const r = await calculatePrice({ productId: 'P105', quantity: 1 });
    expect(r.shipping).toBe(0);
  });
  it('pricing: invalid discount / product / qty', async () => {
    await expect(calculatePrice({ productId: 'P100', quantity: 1, discountCode: 'NOPE' })).rejects.toMatchObject({ code: 'INVALID_DISCOUNT' });
    await expect(calculatePrice({ productId: 'ZZZ', quantity: 1 })).rejects.toBeInstanceOf(PricingError);
    await expect(calculatePrice({ productId: 'P100', quantity: 0 })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
  });
  it('registry executes all 5 tools with validation', async () => {
    expect((await executeTool('searchProducts', { category: 'laptop', limit: 5 }) as unknown[]).length).toBeGreaterThan(0);
    expect(await executeTool('getProductDetails', { productId: 'P100' })).toMatchObject({ id: 'P100' });
    expect(await executeTool('checkInventory', { productId: 'P100', size: '9' })).toMatchObject({ available: true });
    expect(await executeTool('calculatePrice', { productId: 'P100', quantity: 2 })).toMatchObject({ subtotal: 4998 });
    expect(await executeTool('getOrderStatus', { orderId: 'KW12345' })).toMatchObject({ status: 'SHIPPED' });
    await expect(executeTool('nope', {})).rejects.toThrow('Unknown tool');
    await expect(executeTool('calculatePrice', { productId: 'P100', quantity: 500 })).rejects.toThrow();
  });
  it('gemini declarations match registry names', () => {
    expect(new Set(GEMINI_TOOL_DECLARATIONS.map(d => d.name))).toEqual(new Set(toolDefinitions.map(t => t.name)));
  });
  it('localization renders variables, reports missing', () => {
    const { text, missing } = renderTemplate('Hi {{customer_name}}, order {{order_id}} worth {{order_total}} is {{order_status}}.', {
      customer_name: 'Athul', order_id: 'KW12345', order_total: '₹2,499', order_status: 'shipped',
    });
    expect(text).toBe('Hi Athul, order KW12345 worth ₹2,499 is shipped.');
    expect(missing).toEqual([]);
    expect(renderTemplate('Hello {{name}} {{unknown}}', { name: 'A' }).missing).toEqual(['unknown']);
  });
  it('orders service + REST', async () => {
    expect(await getOrderStatus('KW12345')).toMatchObject({ status: 'SHIPPED', estimatedDelivery: 'Tomorrow' });
    expect((await request(app).get('/api/orders/KW12345')).status).toBe(200);
    expect((await request(app).get('/api/orders/NOPE')).status).toBe(404);
  });
  it('pricing REST validates input', async () => {
    const ok = await request(app).post('/api/pricing/calculate').send({ productId: 'P101', quantity: 2, discountCode: 'SUMMER10' });
    expect(ok.status).toBe(200);
    expect(ok.body.total).toBeCloseTo(5498.2, 1);
    expect((await request(app).post('/api/pricing/calculate').send({ productId: 'P100', quantity: 1, discountCode: 'BAD' })).status).toBe(400);
    expect((await request(app).post('/api/pricing/calculate').send({ quantity: 1 })).status).toBe(400);
  });
  it('conversation answers price questions deterministically', async () => {
    const c = await request(app).post('/api/conversations');
    const r = await request(app).post(`/api/conversations/${c.body.conversationId}/messages`)
      .send({ text: 'What is the total for 2 Adidas Duramo shoes with SUMMER10?' });
    expect(r.body.meta.tool).toBe('calculatePrice');
    expect(r.body.reply).toMatch(/5,498/);
  });
});
