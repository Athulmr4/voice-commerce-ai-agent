import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { queryAll, runStmt } from '../db/database.js';
import { createSession } from '../conversation.js';
import { processMessage } from '../services/conversationService.js';
import { logVoiceTurn } from '../services/logger.js';

export const conversationsRouter = Router();

conversationsRouter.post('/', (_req, res) => {
  const id = randomUUID();
  runStmt('INSERT INTO conversations (id,created_at) VALUES (?,?)', [id, new Date().toISOString()]);
  createSession(id);
  res.status(201).json({ conversationId: id });
});

const msgSchema = z.object({ text: z.string().min(1).max(2000) });

conversationsRouter.post('/:id/messages', async (req, res, next) => {
  try {
    const { text } = msgSchema.parse(req.body);
    const result = await processMessage(req.params.id, text);
    logVoiceTurn({
      conversation_id: req.params.id, intent: result.intent, tool_called: result.meta.tool,
      llm: result.meta.llm, llm_latency_ms: result.meta.llmLatencyMs,
      tool_latency_ms: result.meta.toolLatencyMs, language: result.meta.language,
      success: result.meta.success,
    });
    res.json(result);
  } catch (e) { next(e); }
});

conversationsRouter.get('/:id/messages', async (req, res, next) => {
  try {
    const rows = await queryAll('SELECT role,text,created_at FROM conversation_messages WHERE conversation_id=? ORDER BY created_at ASC', [req.params.id]);
    res.json({ messages: rows });
  } catch (e) { next(e); }
});
