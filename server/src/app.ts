import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { productsRouter } from './routes/products.js';
import { conversationsRouter } from './routes/conversations.js';
import { pricingRouter } from './routes/pricing.js';
import { ordersRouter } from './routes/orders.js';
import { voiceRouter } from './routes/voice.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getLLMProvider } from './services/llm/index.js';
import { getCommerceProviderName } from './services/commerce/index.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
export const app = express();

// Behind nginx/docker proxy in production; keeps rate-limit client IPs accurate.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(',') }));
app.use(express.json({ limit: '2mb' })); // voice transcripts (base64 audio) need headroom; message text still capped by zod
app.use(pinoHttp({ logger: log, customProps: () => ({}) }));
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', (_req, res) => res.json({ ok: true, phase: 7, provider: getCommerceProviderName(), llm: getLLMProvider().name }));
app.use('/api/products', productsRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/conversations', conversationsRouter);
app.use(errorHandler);

const port = Number(process.env.PORT ?? 3001);
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => log.info({ port }, 'server listening'));
}
