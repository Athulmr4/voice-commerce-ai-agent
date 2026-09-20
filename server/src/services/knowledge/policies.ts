// Store policies — retrieved by the searchKnowledge tool (RAG-lite).
// Each ## section is one retrievable chunk. Kept in TS (not .md) so it ships
// inside dist/ with zero asset plumbing. Keep answers grounded in this file.
export const POLICIES_MD = `
# Store policies — retrieved by the searchKnowledge tool (RAG-lite).
# Each ## section is one retrievable chunk. Keep answers grounded in this file.

## Shipping policy
Orders ship within 24 hours and arrive in about 3 days. Shipping costs a flat ₹100, and is free on orders of ₹20,000 or more after discount.

## Returns and exchange
Unused items in original packaging can be returned or exchanged within 7 days of delivery. Start a return from your orders page; pickup is free.

## Refunds
Refunds go back to the original payment method within 5 to 7 working days after we receive the returned item.

## Discount codes
Only one discount code can be applied per order. Codes cannot be combined. Invalid or expired codes are rejected at checkout.

## Contact and support
Support is available 9am to 9pm IST on chat and email at care@example.com. For order issues, keep your order id (for example KW12345) ready.
`;
