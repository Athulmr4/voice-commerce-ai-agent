import { z } from 'zod';
import { getCommerceProvider } from '../services/commerce/index.js';
import { calculatePrice } from '../services/pricing/pricing.js';
import { getOrderStatus } from '../services/orders/orders.js';
import { searchKnowledge } from '../services/knowledge/retriever.js';

export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  execute: (args: unknown) => Promise<T>;
}

const searchSchema = z.object({
  category: z.string().optional(),
  maxPrice: z.number().positive().optional(),
  minPrice: z.number().nonnegative().optional(),
  color: z.string().optional(),
  brand: z.string().optional(),
  q: z.string().optional(),
  limit: z.number().int().min(1).max(10).default(3),
});

const productDetailsSchema = z.object({ productId: z.string().min(1) });

const inventorySchema = z.object({ productId: z.string().min(1), size: z.string().optional() });

const pricingSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
  discountCode: z.string().optional(),
});

const orderStatusSchema = z.object({ orderId: z.string().min(1) });

const placeOrderSchema = z.object({
  productId: z.string().min(1),
  size: z.string().optional(),
  quantity: z.number().int().min(1).max(99).default(1),
  discountCode: z.string().optional(),
});

const knowledgeSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(3).default(2),
});

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'searchProducts',
    description: 'Search the product catalog by category, price range, color, or brand. Returns cheapest-first products.',
    schema: searchSchema,
    execute: async (args: unknown) => getCommerceProvider().searchProducts(searchSchema.parse(args)),
  },
  {
    name: 'getProductDetails',
    description: 'Get full details for a single product by id.',
    schema: productDetailsSchema,
    execute: async (args: unknown) => {
      const { productId } = productDetailsSchema.parse(args);
      const p = await getCommerceProvider().getProduct(productId);
      if (!p) throw new Error(`Product ${productId} not found`);
      return p;
    },
  },
  {
    name: 'checkInventory',
    description: 'Check stock availability and quantity for a product, optionally a size.',
    schema: inventorySchema,
    execute: async (args: unknown) => {
      const { productId, size } = inventorySchema.parse(args);
      return { productId, ...(await getCommerceProvider().getInventory(productId, size)) };
    },
  },
  {
    name: 'calculatePrice',
    description: 'Deterministically compute subtotal, discount, shipping, and total for a product and quantity.',
    schema: pricingSchema,
    execute: async (args: unknown) => calculatePrice(pricingSchema.parse(args) as { productId: string; quantity: number; discountCode?: string }),
  },
  {
    name: 'getOrderStatus',
    description: 'Look up an order by id. Returns status, estimated delivery, and total.',
    schema: orderStatusSchema,
    execute: async (args: unknown) => getOrderStatus(orderStatusSchema.parse(args).orderId),
  },
  {
    name: 'placeOrder',
    description: 'Place an order for a product and quantity. Only call after the customer confirmed; prices and stock are checked deterministically.',
    schema: placeOrderSchema,
    execute: async (args: unknown) => {
      const parsed = placeOrderSchema.parse(args) as { productId: string; size?: string; quantity: number; discountCode?: string };
      return getCommerceProvider().createOrder(parsed);
    },
  },
  {
    name: 'searchKnowledge',
    description: 'Look up store policies and FAQs (shipping, returns, refunds, discounts, support). Use for policy questions, never for products/prices/stock.',
    schema: knowledgeSchema,
    execute: async (args: unknown) => {
      const { query, limit } = knowledgeSchema.parse(args);
      return searchKnowledge(query, limit);
    },
  },
];

export async function executeTool(name: string, args: unknown): Promise<unknown> {
  const tool = toolDefinitions.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown tool ${name}`);
  return tool.execute(args);
}
