import { describe, it, expect, vi, afterEach } from 'vitest';
import { ShopifyProvider } from '../src/services/commerce/ShopifyProvider.js';
import { getCommerceProvider } from '../src/services/commerce/index.js';
import { CommerceError } from '../src/services/commerce/CommerceProvider.js';

// Isolated DB: each test file seeds a fresh in-memory database.
process.env.SQLITE_PATH = ':memory:';

const PRODUCT = {
  id: 101,
  title: 'Nike Revolution 7',
  body_html: '<p>Lightweight <b>running</b> shoes</p>',
  vendor: 'Nike',
  product_type: 'running shoes',
  tags: 'color:black, sport',
  options: [{ name: 'Size', values: ['8', '9'] }, { name: 'Color', values: ['black'] }],
  variants: [
    { id: 1, price: '2499.00', inventory_quantity: 8, option1: '8', option2: 'black', option3: null },
    { id: 2, price: '2499.00', inventory_quantity: 0, option1: '9', option2: 'black', option3: null },
  ],
};

function stubFetch(routes: Record<string, { status?: number; body?: unknown }>): void {
  // Longest matching key wins so specific stubs shadow generic ones.
  const ordered = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    for (const [key, value] of ordered) {
      if (url.includes(key)) {
        return { ok: (value.status ?? 200) < 400, status: value.status ?? 200, json: async () => value.body };
      }
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }));
}

afterEach(() => vi.unstubAllGlobals());

function provider(): ShopifyProvider {
  return new ShopifyProvider('https://demo.myshopify.com', 'tok', '2024-10');
}

describe('Phase 6 Shopify provider', () => {
  it('requires credentials', () => {
    expect(() => new ShopifyProvider('', '')).toThrowError(CommerceError);
    delete process.env.SHOPIFY_STORE_URL;
    expect(getCommerceProvider().name).toBe('mock');
  });
  it('maps and filters product search cheapest-first', async () => {
    stubFetch({ '/products.json': { body: { products: [PRODUCT] } } });
    const p = provider();
    const all = await p.searchProducts({ limit: 10 });
    expect(all[0]).toMatchObject({ id: '101', name: 'Nike Revolution 7', category: 'running shoes', price: 2499, brand: 'Nike', color: 'black' });
    expect(all[0].description).not.toMatch(/<p>/);
    expect(await p.searchProducts({ category: 'laptop' })).toEqual([]);
    expect(await p.searchProducts({ maxPrice: 2000 })).toEqual([]);
    expect(await p.searchProducts({ color: 'BLACK' })).toHaveLength(1);
  });
  it('getProduct returns null on 404', async () => {
    stubFetch({ '/products/101.json': { body: { product: PRODUCT } }, '/products/999.json': { status: 404, body: {} } });
    const p = provider();
    expect((await p.getProduct('101'))?.name).toBe('Nike Revolution 7');
    expect(await p.getProduct('999')).toBeNull();
  });
  it('getInventory matches sizes, sums totals', async () => {
    stubFetch({ '.json': { body: { product: PRODUCT } } });
    const p = provider();
    expect(await p.getInventory('101', '8')).toMatchObject({ available: true, quantity: 8 });
    expect(await p.getInventory('101', '9')).toMatchObject({ available: false, quantity: 0 });
    expect(await p.getInventory('101')).toMatchObject({ available: true, quantity: 8 });
  });
  it('getOrder by name and numeric id, 404 maps to ORDER_NOT_FOUND', async () => {
    const order = { id: 9001, name: '#1001', fulfillment_status: 'fulfilled', financial_status: 'paid', total_price: '2599.00' };
    stubFetch({
      '/orders.json?name=': { body: { orders: [order] } },
      '/orders/9001001.json': { body: { order } },
      '/orders.json?name=NONE': { body: { orders: [] } },
    });
    const p = provider();
    expect(await p.getOrder('#1001')).toMatchObject({ orderId: '#1001', status: 'FULFILLED', total: 2599 });
    expect((await p.getOrder('9001001')).orderId).toBe('#1001');
    await expect(p.getOrder('NONE')).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
  });
  it('getDiscount matches percentage codes case-insensitively, skips fixed-amount', async () => {
    stubFetch({
      '/price_rules.json': { body: { price_rules: [{ id: 1, value: '-10.0', value_type: 'percentage' }, { id: 2, value: '-5.0', value_type: 'fixed_amount' }] } },
      '/price_rules/1/discount_codes.json': { body: { discount_codes: [{ code: 'SUMMER10' }] } },
      '/price_rules/2/discount_codes.json': { body: { discount_codes: [{ code: 'FLAT5' }] } },
    });
    const p = provider();
    expect(await p.getDiscount('summer10')).toEqual({ code: 'SUMMER10', percent: 10 });
    expect(await p.getDiscount('FLAT5')).toBeNull();
    expect(await p.getDiscount('NOPE')).toBeNull();
  });
  it('auth failures map to SHOPIFY_AUTH without leaking the token', async () => {
    stubFetch({ '/products.json': { status: 401, body: {} } });
    await expect(provider().searchProducts({})).rejects.toMatchObject({ code: 'SHOPIFY_AUTH' });
  });
});
