// Pure pricing math — no I/O, no imports. Shared by the pricing service and
// the mock commerce provider's createOrder (avoids a circular dependency).
export const FREE_SHIPPING_THRESHOLD = 20000;
export const FLAT_SHIPPING = 100;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function priceBreakup(
  unitPrice: number,
  quantity: number,
  discountPercent: number,
): { subtotal: number; discount: number; shipping: number; total: number } {
  const subtotal = round2(unitPrice * quantity);
  const discount = round2((subtotal * discountPercent) / 100);
  // Flat ₹100 shipping; free on orders (after discount) over ₹20,000.
  // Matches the spec example: 5998 − 599.8 + 100 = 5498.2.
  const shipping = subtotal - discount >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  return { subtotal, discount, shipping, total: round2(subtotal - discount + shipping) };
}
