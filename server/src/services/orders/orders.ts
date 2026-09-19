import { getCommerceProvider } from '../commerce/index.js';
import { CommerceError } from '../commerce/CommerceProvider.js';

export interface OrderStatus {
  orderId: string;
  status: string;
  estimatedDelivery: string;
  total: number;
}

export class OrderError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function getOrderStatus(orderId: string): Promise<OrderStatus> {
  try {
    const o = await getCommerceProvider().getOrder(orderId);
    return { orderId: o.orderId, status: o.status, estimatedDelivery: o.estimatedDelivery, total: o.total };
  } catch (e) {
    if (e instanceof CommerceError && e.code === 'ORDER_NOT_FOUND') {
      throw new OrderError('ORDER_NOT_FOUND', `Order ${orderId} not found`);
    }
    throw e;
  }
}
