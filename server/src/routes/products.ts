import { Router } from 'express';
import { z } from 'zod';
import { getCommerceProvider } from '../services/commerce/index.js';

export const productsRouter = Router();

const searchSchema = z.object({
  category: z.string().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  color: z.string().optional(),
  brand: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

productsRouter.get('/', async (req, res, next) => {
  try {
    const f = searchSchema.parse(req.query);
    const products = await getCommerceProvider().searchProducts(f);
    res.json({ products });
  } catch (e) { next(e); }
});

productsRouter.get('/:id', async (req, res, next) => {
  try {
    const p = await getCommerceProvider().getProduct(req.params.id);
    if (!p) return void res.status(404).json({ error: 'Product not found' });
    res.json({ product: p });
  } catch (e) { next(e); }
});

productsRouter.get('/:id/inventory', async (req, res, next) => {
  try {
    const size = typeof req.query.size === 'string' ? req.query.size : undefined;
    const inv = await getCommerceProvider().getInventory(req.params.id, size);
    res.json({ productId: req.params.id, ...inv });
  } catch (e) { next(e); }
});
