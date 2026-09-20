import type { Product, ProductFilters } from '../../types/commerce.js';

export interface CommerceOrder {
  orderId: string;
  status: string;
  estimatedDelivery: string;
  total: number;
}

export interface CommerceCustomer {
  id: string;
  name: string;
}

export interface CommerceDiscount {
  code: string;
  percent: number;
}

export interface CreateOrderInput {
  productId: string;
  size?: string;
  quantity: number;
  discountCode?: string;
  customerId?: string;
}

export interface OrderConfirmation {
  orderId: string;
  status: string;
  productId: string;
  productName: string;
  size?: string;
  quantity: number;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

export class CommerceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface CommerceProvider {
  readonly name: string;
  searchProducts(filters: ProductFilters): Promise<Product[]>;
  getProduct(id: string): Promise<Product | null>;
  getInventory(productId: string, size?: string): Promise<{ available: boolean; quantity: number; size?: string }>;
  getOrder(orderId: string): Promise<CommerceOrder>;
  getCustomer(customerId: string): Promise<CommerceCustomer | null>;
  /** Returns null when the code does not exist (pricing service turns this into INVALID_DISCOUNT). */
  getDiscount(code: string): Promise<CommerceDiscount | null>;
  /** Prices deterministically, decrements stock, persists the order. Throws on unknown product / bad code / insufficient stock. */
  createOrder(input: CreateOrderInput): Promise<OrderConfirmation>;
}
