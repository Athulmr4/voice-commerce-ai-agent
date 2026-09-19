import { queryAll } from '../../db/database.js';
import type { Product, ProductFilters } from '../../types/commerce.js';
import type { CommerceCustomer, CommerceDiscount, CommerceOrder, CommerceProvider } from './CommerceProvider.js';
import { CommerceError } from './CommerceProvider.js';

function toProduct(r: Record<string, unknown>): Product {
  return {
    id: String(r.id), name: String(r.name), description: String(r.description ?? ''),
    category: String(r.category), price: Number(r.price), brand: String(r.brand),
    color: r.color ? String(r.color) : null,
  };
}

export class MockCommerceProvider implements CommerceProvider {
  readonly name = 'mock';
  async searchProducts(f: ProductFilters): Promise<Product[]> {
    const conds: string[] = [];
    const params: unknown[] = [];
    if (f.category) { conds.push('LOWER(category) LIKE ?'); params.push(`%${String(f.category).toLowerCase()}%`); }
    if (f.maxPrice != null) { conds.push('price <= ?'); params.push(f.maxPrice); }
    if (f.minPrice != null) { conds.push('price >= ?'); params.push(f.minPrice); }
    if (f.color) { conds.push('LOWER(color) = ?'); params.push(String(f.color).toLowerCase()); }
    if (f.brand) { conds.push('LOWER(brand) = ?'); params.push(String(f.brand).toLowerCase()); }
    if (f.q) { conds.push('(LOWER(name) LIKE ? OR LOWER(description) LIKE ?)'); params.push(`%${f.q.toLowerCase()}%`, `%${f.q.toLowerCase()}%`); }
    const limit = Math.min(Math.max(f.limit ?? 10, 1), 50);
    const sql = `SELECT * FROM products ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''} ORDER BY price ASC LIMIT ${limit}`;
    return (await queryAll(sql, params)).map(toProduct);
  }
  async getProduct(id: string): Promise<Product | null> {
    const rows = await queryAll('SELECT * FROM products WHERE id = ?', [id]);
    return rows.length ? toProduct(rows[0] as Record<string, unknown>) : null;
  }
  async getInventory(productId: string, size?: string): Promise<{ available: boolean; quantity: number; size?: string }> {
    const rows = size
      ? await queryAll('SELECT quantity FROM inventory WHERE product_id = ? AND size = ?', [productId, size])
      : await queryAll('SELECT SUM(quantity) as q FROM inventory WHERE product_id = ?', [productId]);
    const qty = size
      ? (rows[0] ? Number((rows[0] as Record<string, unknown>).quantity ?? 0) : 0)
      : Number((rows[0] as Record<string, unknown> | undefined)?.q ?? 0);
    return { available: qty > 0, quantity: qty, size };
  }
  async getOrder(orderId: string): Promise<CommerceOrder> {
    const rows = await queryAll('SELECT id, status, estimated_delivery, total FROM orders WHERE id = ?', [orderId]);
    if (rows.length === 0) throw new CommerceError('ORDER_NOT_FOUND', `Order ${orderId} not found`, 404);
    const o = rows[0] as Record<string, unknown>;
    return {
      orderId: String(o.id), status: String(o.status),
      estimatedDelivery: String(o.estimated_delivery ?? 'Unknown'), total: Number(o.total),
    };
  }
  async getCustomer(customerId: string): Promise<CommerceCustomer | null> {
    const rows = await queryAll('SELECT id, name FROM users WHERE id = ?', [customerId]);
    if (rows.length === 0) return null;
    const u = rows[0] as Record<string, unknown>;
    return { id: String(u.id), name: String(u.name) };
  }
  async getDiscount(code: string): Promise<CommerceDiscount | null> {
    const rows = await queryAll('SELECT code, percent FROM discounts WHERE code = ?', [code.toUpperCase()]);
    if (rows.length === 0) return null;
    const d = rows[0] as Record<string, unknown>;
    return { code: String(d.code), percent: Number(d.percent) };
  }
}
