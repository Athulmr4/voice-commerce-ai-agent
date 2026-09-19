import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Invalid request', details: err.errors.map(e => e.message) });
    return;
  }
  // Never leak stack traces to voice clients
  res.status(500).json({ error: "I'm having trouble checking that right now. Please try again." });
}
