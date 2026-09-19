import { getCommerceProvider } from '../commerce/index.js';

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

export const FREE_SHIPPING_THRESHOLD = 20000;
export const FLAT_SHIPPING = 100;

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
  const subtotal = round2(unitPrice * quantity);

  let discount = 0;
  if (discountCode) {
    const deal = await getCommerceProvider().getDiscount(discountCode);
    if (!deal) throw new PricingError('INVALID_DISCOUNT', `Unknown discount code ${discountCode}`);
    discount = round2((subtotal * deal.percent) / 100);
  }
  // Flat ₹100 shipping; free on orders (after discount) over ₹20,000.
  // Matches the spec example: 5998 − 599.8 + 100 = 5498.2.
  const shipping = subtotal - discount >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  const total = round2(subtotal - discount + shipping);
  return { productId, unitPrice, quantity, subtotal, discount, discountCode, shipping, total };
}
