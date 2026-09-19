export interface Product {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  brand: string;
  color?: string | null;
}

export interface ProductFilters {
  category?: string;
  maxPrice?: number;
  minPrice?: number;
  color?: string | null;
  brand?: string;
  q?: string;
  limit?: number;
}

export interface PriceBreakup {
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
}

export interface OrderStatus {
  orderId: string;
  status: string;
  estimatedDelivery: string;
}
