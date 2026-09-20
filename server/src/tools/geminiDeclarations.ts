import { SchemaType, type FunctionDeclaration } from '@google/generative-ai';

// Hand-written Gemini declarations mirroring tools.ts schemas 1:1.
// tools.test.ts asserts the name sets match so they cannot drift.
export const GEMINI_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'searchProducts',
    description: 'Search the product catalog by category, price range, color, or brand. Keep limit at 10 or below (default 3).',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        category: { type: SchemaType.STRING },
        maxPrice: { type: SchemaType.NUMBER },
        minPrice: { type: SchemaType.NUMBER },
        color: { type: SchemaType.STRING },
        brand: { type: SchemaType.STRING },
        q: { type: SchemaType.STRING },
        limit: { type: SchemaType.NUMBER },
      },
    },
  },
  {
    name: 'getProductDetails',
    description: 'Get full details for a single product by id.',
    parameters: { type: SchemaType.OBJECT, properties: { productId: { type: SchemaType.STRING } }, required: ['productId'] },
  },
  {
    name: 'checkInventory',
    description: 'Check stock availability and quantity for a product, optionally a size.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: { productId: { type: SchemaType.STRING }, size: { type: SchemaType.STRING } },
      required: ['productId'],
    },
  },
  {
    name: 'calculatePrice',
    description: 'Deterministically compute subtotal, discount, shipping, and total.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        productId: { type: SchemaType.STRING },
        quantity: { type: SchemaType.NUMBER },
        discountCode: { type: SchemaType.STRING },
      },
      required: ['productId'],
    },
  },
  {
    name: 'getOrderStatus',
    description: 'Look up an order by id.',
    parameters: { type: SchemaType.OBJECT, properties: { orderId: { type: SchemaType.STRING } }, required: ['orderId'] },
  },
  {
    name: 'placeOrder',
    description: 'Place an order for a product and quantity. Only call after the customer confirmed.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        productId: { type: SchemaType.STRING },
        size: { type: SchemaType.STRING },
        quantity: { type: SchemaType.NUMBER },
        discountCode: { type: SchemaType.STRING },
      },
      required: ['productId'],
    },
  },
];
