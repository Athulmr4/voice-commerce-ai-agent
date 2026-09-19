import { Router } from 'express';
import { z } from 'zod';
import { calculatePrice, PricingError } from '../services/pricing/pricing.js';

export const pricingRouter = Router();

const bodySchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
  discountCode: z.string().optional(),
});

pricingRouter.post('/calculate', async (req, res, next) => {
  try {
    const result = await calculatePrice(bodySchema.parse(req.body));
    res.json(result);
  } catch (e) {
    if (e instanceof PricingError) {
      const status = e.code === 'INVALID_PRODUCT' || e.code === 'ORDER_NOT_FOUND' ? 404 : 400;
      return void res.status(status).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});
