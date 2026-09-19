import { Router } from 'express';
import { getOrderStatus, OrderError } from '../services/orders/orders.js';

export const ordersRouter = Router();

ordersRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await getOrderStatus(req.params.id));
  } catch (e) {
    if (e instanceof OrderError) return void res.status(404).json({ error: e.message, code: e.code });
    next(e);
  }
});
