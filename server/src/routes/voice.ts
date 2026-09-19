import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { runStmt } from '../db/database.js';
import { createSession } from '../conversation.js';
import { processMessage } from '../services/conversationService.js';
import { getSTTProvider } from '../services/speech/stt.js';
import { getTTSProvider } from '../services/speech/tts.js';
import { getLatencyStats } from '../services/speech/latencyStats.js';
import { SpeechError } from '../services/speech/providers.js';
import { logVoiceTurn } from '../services/logger.js';
import { requireApiKey } from '../middleware/requireApiKey.js';

export const voiceRouter = Router();

// Audio + LLM turns are the most expensive operations: tighter quota than the global limiter.
voiceRouter.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false }));

// Rolling server-side latency aggregates (see services/speech/latencyStats.ts).
// Gated by API key when API_KEY is set (ops endpoint).
voiceRouter.get('/stats', requireApiKey, (_req, res) => {
  res.json(getLatencyStats());
});

// Cloud STT entry point. Without STT_PROVIDER + key this answers 501 so the
// client uses browser SpeechRecognition instead (default Phase 4 mode).
const transcribeSchema = z.object({
  audioBase64: z.string().min(1).max(2_500_000),
  mimeType: z.string().max(100).optional(),
  language: z.string().max(20).optional(),
});

voiceRouter.post('/transcribe', async (req, res, next) => {
  try {
    const input = transcribeSchema.parse(req.body);
    const t0 = Date.now();
    const result = await getSTTProvider().transcribe(input);
    res.json({ ...result, sttLatencyMs: Date.now() - t0 });
  } catch (e) {
    if (e instanceof SpeechError) {
      const status = e.status === 501 ? 501 : e.status;
      return void res.status(status).json({ error: e.message, code: e.code, fallback: e.code === 'STT_NOT_CONFIGURED' ? 'browser-stt' : undefined });
    }
    next(e);
  }
});

// Full voice turn: text (from browser STT or typed) -> pipeline -> TTS-ready text.
// Returns the latency breakdown the client renders per turn.
const respondSchema = z.object({
  text: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  voice: z.string().max(100).optional(),
  sttLatencyMs: z.number().nonnegative().optional(),
});

voiceRouter.post('/respond', async (req, res, next) => {
  try {
    const { text, conversationId, voice, sttLatencyMs } = respondSchema.parse(req.body);
    const t0 = Date.now();
    let cid = conversationId;
    if (!cid) {
      cid = randomUUID();
      runStmt('INSERT INTO conversations (id,created_at) VALUES (?,?)', [cid, new Date().toISOString()]);
      createSession(cid);
    }
    const result = await processMessage(cid, text);

    const tTts = Date.now();
    const language = result.meta.language === 'hinglish' ? 'hinglish' as const : 'english' as const;
    const synth = await getTTSProvider().synthesize({ text: result.reply, language, voice });
    const ttsLatencyMs = Date.now() - tTts;
    const totalMs = Date.now() - t0;

    logVoiceTurn({
      conversation_id: cid, intent: result.intent, tool_called: result.meta.tool,
      llm: result.meta.llm, llm_latency_ms: result.meta.llmLatencyMs,
      tool_latency_ms: result.meta.toolLatencyMs, tts_latency_ms: ttsLatencyMs,
      stt_latency_ms: sttLatencyMs ?? 0, total_latency_ms: totalMs,
      language: result.meta.language, success: result.meta.success,
    });

    res.json({
      conversationId: cid,
      reply: result.reply,
      voiceText: synth.voiceText,
      audioBase64: synth.audioBase64,
      contentType: synth.contentType,
      products: result.products,
      filters: result.filters,
      intent: result.intent,
      latency: {
        sttMs: sttLatencyMs ?? 0,
        llmMs: result.meta.llmLatencyMs,
        toolMs: result.meta.toolLatencyMs,
        ttsMs: ttsLatencyMs,
        totalMs,
      },
      meta: result.meta,
    });
  } catch (e) {
    if (e instanceof SpeechError) return void res.status(e.status).json({ error: e.message, code: e.code });
    next(e);
  }
});
