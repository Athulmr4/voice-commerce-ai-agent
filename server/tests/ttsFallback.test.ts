import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { SpeechError } from '../src/services/speech/providers.js';

vi.mock('../src/services/speech/tts.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/services/speech/tts.js')>();
  return {
    ...orig,
    getTTSProvider: () => ({
      name: 'broken-cloud',
      synthesize: async () => {
        throw new SpeechError('TTS_UPSTREAM', 'upstream down', 502);
      },
    }),
  };
});

const { app } = await import('../src/app.js');

process.env.NODE_ENV = 'test';
// Hermetic: conversation tests use the deterministic keyword path, never a live LLM.
delete process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.LLM_PROVIDER;


describe('TTS cloud fallback', () => {
  it('a failing cloud TTS still returns 200 with browser-spoken voiceText', async () => {
    const r = await request(app).post('/api/voice/respond').send({ text: 'Show me running shoes under 3000' });
    expect(r.status).toBe(200);
    expect(r.body.ttsFallback).toBe(true);
    expect(r.body.audioBase64).toBeUndefined();
    expect(r.body.voiceText).toMatch(/rupees/);
  });
});
