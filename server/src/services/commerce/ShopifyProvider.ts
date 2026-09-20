import type { Product, ProductFilters } from '../../types/commerce.js';
import type {
  CommerceCustomer, CommerceDiscount, CommerceOrder, CommerceProvider,
  CreateOrderInput, OrderConfirmation,
} from './CommerceProvider.js';
import { CommerceError } from './CommerceProvider.js';
import { priceBreakup } from '../pricing/calc.js';

// Real Shopify integration via the Admin REST API.
// Enabled only when SHOPIFY_STORE_URL + SHOPIFY_ACCESS_TOKEN are set;
// otherwise the mock provider is used (see services/commerce/index.ts).
//
// Shopify APIs used (all Admin REST, api-version configurable):
//   GET /products.json                  -> searchProducts / getProduct
//   GET /products/{id}.json             -> getProduct
//   variants[].inventory_quantity       -> getInventory (per-size via variant option matching)
//   GET /orders.json?name=... /orders/{id}.json -> getOrder
//   GET /customers/{id}.json            -> getCustomer
//   GET /price_rules.json + discount_codes.json -> getDiscount
//
//   POST /draft_orders.json            -> createOrder (draft; stock decrements on completion, not creation)
//
// Mapping notes / limitations (also in README):
// - Our Product.category <- Shopify product_type; color <- first "Color" option value or tag.
// - Price filters are applied client-side after fetching (Shopify has no price-range
//   query param on products.json); max 250 products per fetch.
// - Size inventory matches variant option values case-insensitively (e.g. option "Size" = "9").
// - Order lookup accepts a numeric Shopify id or an order name (e.g. "#1001" / "1001").
// - Discounts map Shopify value="-10.0", value_type="percentage" to percent; fixed-amount
//   codes are converted using once_per_customer... (not supported -> returns null).

interface ShopifyVariant {
  id: number;
  price: string;
  inventory_quantity: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
}

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string;
  options: { name: string; values: string[] }[];
  variants: ShopifyVariant[];
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function toProduct(p: ShopifyProduct): Product {
  const prices = p.variants.map(v => Number(v.price)).filter(n => !Number.isNaN(n));
  const colorOpt = p.options.find(o => o.name.toLowerCase() === 'color');
  const tagColor = p.tags.split(',').map(t => t.trim()).find(t => /^color:/i.test(t))?.split(':')[1];
  return {
    id: String(p.id),
    name: p.title,
    description: stripHtml(p.body_html ?? ''),
    category: p.product_type || 'general',
    price: prices.length ? Math.min(...prices) : 0,
    brand: p.vendor || 'Unknown',
    color: colorOpt?.values[0] ?? tagColor ?? null,
  };
}

export class ShopifyProvider implements CommerceProvider {
  readonly name = 'shopify';
  private base: string;
  private token: string;
  private version: string;

  constructor(
    storeUrl = process.env.SHOPIFY_STORE_URL ?? '',
    token = process.env.SHOPIFY_ACCESS_TOKEN ?? '',
    version = process.env.SHOPIFY_API_VERSION ?? '2024-10',
  ) {
    if (!storeUrl || !token) {
      throw new CommerceError('SHOPIFY_NOT_CONFIGURED', 'Missing SHOPIFY_STORE_URL / SHOPIFY_ACCESS_TOKEN', 501);
    }
    this.base = `${storeUrl.replace(/\/$/, '')}/admin/api/${version}`;
    this.token = token;
    this.version = version;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { 'X-Shopify-Access-Token': this.token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      throw new CommerceError('SHOPIFY_AUTH', 'Shopify rejected the access token', 502);
    }
    if (res.status === 404) throw new CommerceError('NOT_FOUND', `Shopify resource not found: ${path}`, 404);
    if (!res.ok) throw new CommerceError('SHOPIFY_UPSTREAM', `Shopify error ${res.status}`, 502);
    return res.json() as Promise<T>;
  }

  async searchProducts(f: ProductFilters): Promise<Product[]> {
    const data = await this.get<{ products: ShopifyProduct[] }>('/products.json?limit=250');
    let products = data.products.map(toProduct);
    if (f.category) {
      const c = f.category.toLowerCase();
      products = products.filter(p => p.category.toLowerCase().includes(c) || p.name.toLowerCase().includes(c));
    }
    if (f.maxPrice != null) products = products.filter(p => p.price <= f.maxPrice!);
    if (f.minPrice != null) products = products.filter(p => p.price >= f.minPrice!);
    if (f.color) products = products.filter(p => p.color?.toLowerCase() === f.color!.toLowerCase());
    if (f.brand) products = products.filter(p => p.brand.toLowerCase() === f.brand!.toLowerCase());
    if (f.q) {
      const q = f.q.toLowerCase();
      products = products.filter(p => (p.name + ' ' + p.description).toLowerCase().includes(q));
    }
    products.sort((a, b) => a.price - b.price);
    return products.slice(0, Math.min(Math.max(f.limit ?? 10, 1), 50));
  }

  async getProduct(id: string): Promise<Product | null> {
    try {
      const data = await this.get<{ product: ShopifyProduct }>(`/products/${id}.json`);
      return toProduct(data.product);
    } catch (e) {
      if (e instanceof CommerceError && e.code === 'NOT_FOUND') return null;
      throw e;
    }
  }

  async getInventory(productId: string, size?: string): Promise<{ available: boolean; quantity: number; size?: string }> {
    const product = await this.getProduct(productId);
    if (!product) return { available: false, quantity: 0, size };
    const data = await this.get<{ product: ShopifyProduct }>(`/products/${productId}.json`);
    const variants = data.product.variants;
    const match = size
      ? variants.filter(v => [v.option1, v.option2, v.option3].some(o => o?.toLowerCase() === size.toLowerCase()))
      : variants;
    const qty = match.reduce((sum, v) => sum + Math.max(0, v.inventory_quantity), 0);
    return { available: qty > 0, quantity: qty, size };
  }

  async getOrder(orderId: string): Promise<CommerceOrder> {
    const clean = orderId.replace(/^#/, '');
    // Numeric id -> direct lookup; otherwise treat as order name.
    const data = /^\d+$/.test(clean) && clean.length > 6
      ? await this.get<{ order: ShopifyOrder }>(`/orders/${clean}.json`).then(d => ({ orders: [d.order] }))
      : await this.get<{ orders: ShopifyOrder[] }>(`/orders.json?name=${encodeURIComponent(clean)}&status=any&limit=1`);
    const o = data.orders[0];
    if (!o) throw new CommerceError('ORDER_NOT_FOUND', `Order ${orderId} not found`, 404);
    return {
      orderId: o.name ?? String(o.id),
      status: (o.fulfillment_status ?? o.financial_status ?? 'unknown').toUpperCase(),
      estimatedDelivery: 'Unknown',
      total: Number(o.total_price ?? 0),
    };
  }

  async getCustomer(customerId: string): Promise<CommerceCustomer | null> {
    try {
      const data = await this.get<{ customer: { id: number; first_name: string; last_name: string } }>(
        `/customers/${customerId}.json`,
      );
      const c = data.customer;
      return { id: String(c.id), name: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || String(c.id) };
    } catch (e) {
      if (e instanceof CommerceError && e.code === 'NOT_FOUND') return null;
      throw e;
    }
  }

  async getDiscount(code: string): Promise<CommerceDiscount | null> {
    const rules = await this.get<{ price_rules: { id: number; value: string; value_type: string }[] }>(
      '/price_rules.json?limit=250',
    );
    for (const rule of rules.price_rules) {
      if (rule.value_type !== 'percentage') continue;
      const codes = await this.get<{ discount_codes: { code: string }[] }>(
        `/price_rules/${rule.id}/discount_codes.json`,
      );
      if (codes.discount_codes.some(d => d.code.toUpperCase() === code.toUpperCase())) {
        return { code: code.toUpperCase(), percent: Math.abs(Number(rule.value)) };
      }
    }
    return null;
  }
  async createOrder(input: CreateOrderInput): Promise<OrderConfirmation> {
    const { productId, size, quantity } = input;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new CommerceError('INVALID_QUANTITY', 'Quantity must be an integer between 1 and 99', 400);
    }
    const product = await this.getProduct(productId);
    if (!product) throw new CommerceError('INVALID_PRODUCT', `Unknown product ${productId}`, 404);
    const data = await this.get<{ product: ShopifyProduct }>(`/products/${productId}.json`);
    const variant = size
      ? data.product.variants.find(v => [v.option1, v.option2, v.option3].some(o => o?.toLowerCase() === size.toLowerCase()))
      : data.product.variants[0];
    if (!variant) throw new CommerceError('OUT_OF_STOCK', 'Requested size is unavailable', 409);
    if (variant.inventory_quantity < quantity) {
      throw new CommerceError('OUT_OF_STOCK', `Only ${variant.inventory_quantity} left in stock`, 409);
    }
    let discountPercent = 0;
    const discountCode = input.discountCode?.toUpperCase();
    if (discountCode) {
      const deal = await this.getDiscount(discountCode);
      if (!deal) throw new CommerceError('INVALID_DISCOUNT', `Unknown discount code ${discountCode}`, 400);
      discountPercent = deal.percent;
    }
    const { subtotal, discount, shipping, total } = priceBreakup(Number(variant.price), quantity, discountPercent);
    const payload: Record<string, unknown> = {
      draft_order: {
        line_items: [{ variant_id: variant.id, quantity }],
        ...(discountPercent > 0
          ? { applied_discount: { value_type: 'percentage', value: String(discountPercent) } }
          : {}),
      },
    };
    const res = await fetch(`${this.base}/draft_orders.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new CommerceError('SHOPIFY_UPSTREAM', `Shopify draft order failed (${res.status})`, 502);
    const created = (await res.json()) as { draft_order: { id: number; name: string } };
    return {
      orderId: created.draft_order.name ?? String(created.draft_order.id),
      status: 'DRAFT', productId, productName: product.name, size, quantity, subtotal, discount, shipping, total,
    };
  }
}

interface ShopifyOrder {
  id: number;
  name: string;
  fulfillment_status: string | null;
  financial_status: string;
  total_price: string;
}
