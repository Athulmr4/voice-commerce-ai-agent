import type { NextFunction, Request, Response } from 'express';
import { logger } from '../services/logger.js';

let warned = false;

// Optional API-key gate for ops/protected endpoints (e.g. GET /api/voice/stats).
// - API_KEY unset  -> open, one warn log (local demo default; documented in README).
// - API_KEY set    -> requires matching `x-api-key` header, else 401.
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.API_KEY;
  if (!expected) {
    if (!warned) {
      warned = true;
      logger.warn('API_KEY unset — protected endpoints are open (fine for local demo)');
    }
    next();
    return;
  }
  const got = req.header('x-api-key');
  if (got && got === expected) {
    next();
    return;
  }
  res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
}
