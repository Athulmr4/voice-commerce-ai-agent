import { Router } from 'express';
import { z } from 'zod';
import { getOrderStatus, OrderError } from '../services/orders/orders.js';
import { getCommerceProvider } from '../services/commerce/index.js';
import { CommerceError } from '../services/commerce/CommerceProvider.js';

export const ordersRouter = Router();

ordersRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getOrderStatus(req.params.id));
  } catch (e) {
    if (e instanceof OrderError) return void res.status(404).json({ error: e.message, code: e.code });
    next(e);
  }
});

const createSchema = z.object({
  productId: z.string().min(1),
  size: z.string().optional(),
  quantity: z.number().int().min(1).max(99).default(1),
  discountCode: z.string().optional(),
  customerId: z.string().optional(),
});

ordersRouter.post('/', async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    res.status(201).json(await getCommerceProvider().createOrder(input));
  } catch (e) {
    if (e instanceof CommerceError) {
      return void res.status(e.status).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});
