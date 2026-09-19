import pino from 'pino';

// Shared logger. Silent under tests so vitest output stays readable;
// override with LOG_LEVEL=debug for troubleshooting.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
});

export interface VoiceTurnLog {
  conversation_id: string;
  intent: string;
  tool_called: string;
  llm: string;
  llm_latency_ms: number;
  tool_latency_ms: number;
  tts_latency_ms?: number;
  stt_latency_ms?: number;
  total_latency_ms?: number;
  language: string;
  success: boolean;
}

// Structured, PII-free turn log (spec: observability). Never logs message text.
export function logVoiceTurn(fields: VoiceTurnLog): void {
  logger.info(fields, 'voice_turn');
}
