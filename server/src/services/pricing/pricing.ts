import { getCommerceProvider } from '../commerce/index.js';
import { priceBreakup } from './calc.js';

// Deterministic business logic. The LLM must NEVER compute prices itself —
// it calls the calculatePrice tool and describes the result.
export interface PriceInput {
  productId: string;
  quantity: number;
  discountCode?: string;
}

export interface PriceBreakup {
  productId: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  discount: number;
  discountCode: string | null;
  shipping: number;
  total: number;
}

export { FREE_SHIPPING_THRESHOLD, FLAT_SHIPPING } from './calc.js';

export class PricingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function calculatePrice(input: PriceInput): Promise<PriceBreakup> {
  const { productId, quantity } = input;
  const discountCode = input.discountCode?.toUpperCase() ?? null;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new PricingError('INVALID_QUANTITY', 'Quantity must be an integer between 1 and 99');
  }
  const product = await getCommerceProvider().getProduct(productId);
  if (!product) throw new PricingError('INVALID_PRODUCT', `Unknown product ${productId}`);
  const unitPrice = product.price;

  let discountPercent = 0;
  if (discountCode) {
    const deal = await getCommerceProvider().getDiscount(discountCode);
    if (!deal) throw new PricingError('INVALID_DISCOUNT', `Unknown discount code ${discountCode}`);
    discountPercent = deal.percent;
  }
  const { subtotal, discount, shipping, total } = priceBreakup(unitPrice, quantity, discountPercent);
  return { productId, unitPrice, quantity, subtotal, discount, discountCode, shipping, total };
}
