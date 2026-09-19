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
}
