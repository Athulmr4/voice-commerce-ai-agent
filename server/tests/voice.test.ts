import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { optimizeForSpeech } from '../src/services/speech/optimizer.js';
import { getSTTProvider } from '../src/services/speech/stt.js';
import { getTTSProvider } from '../src/services/speech/tts.js';

process.env.NODE_ENV = 'test';

describe('Phase 4 voice', () => {
  it('optimizer speaks currency, strips markup, caps length', () => {
    expect(optimizeForSpeech('Cheapest is ₹2,499. Want details?', 'english')).toBe('Cheapest is 2,499 rupees. Want details?');
    expect(optimizeForSpeech('Sabse affordable ₹2,499 ka hai.', 'hinglish')).toBe('Sabse affordable 2,499 rupaye ka hai.');
    expect(optimizeForSpeech('**Bold** and *stars* `code` & 10% @home https://x.com/a 🎉', 'english'))
      .toBe('Bold and stars code and 10 percent at home');
  });
  it('optimizer caps at 3 sentences / 60 words', () => {
    const long = Array.from({ length: 6 }, (_, i) => `Sentence number ${i} here`).join('. ') + '.';
    const out = optimizeForSpeech(long, 'english');
    expect(out.split('.').filter(Boolean).length).toBeLessThanOrEqual(3);
    const words = Array.from({ length: 80 }, (_, i) => `w${i}`).join(' ');
    expect(optimizeForSpeech(words, 'english').split(' ').length).toBeLessThanOrEqual(60);
  });
  it('default providers are browser-first without keys', () => {
    expect(getSTTProvider().name).toBe('unavailable');
    expect(getTTSProvider().name).toBe('browser');
  });
  it('transcribe answers 501 with browser fallback when unconfigured', async () => {
    const r = await request(app).post('/api/voice/transcribe').send({ audioBase64: 'AAAA', mimeType: 'audio/webm' });
    expect(r.status).toBe(501);
    expect(r.body.fallback).toBe('browser-stt');
    expect((await request(app).post('/api/voice/transcribe').send({})).status).toBe(400);
  });
  it('respond runs full pipeline with latency breakdown', async () => {
    const r = await request(app).post('/api/voice/respond').send({ text: 'Mujhe running shoes chahiye, 3000 ke andar', sttLatencyMs: 420 });
    expect(r.status).toBe(200);
    expect(r.body.conversationId).toBeTruthy();
    expect(r.body.voiceText).toMatch(/rupaye|rupees/);
    expect(r.body.latency).toMatchObject({ sttMs: 420 });
    for (const k of ['llmMs', 'toolMs', 'ttsMs', 'totalMs']) {
      expect(typeof r.body.latency[k]).toBe('number');
    }
    // follow-up on same conversation keeps context
    const r2 = await request(app).post('/api/voice/respond').send({ text: 'Is it available in size 9?', conversationId: r.body.conversationId });
    expect(r2.body.intent).toBe('inventory_check');
  });
  it('respond rejects bad input', async () => {
    expect((await request(app).post('/api/voice/respond').send({})).status).toBe(400);
  });
  it('details follow-up resolves without repeats ("Haan batao")', async () => {
    const r1 = await request(app).post('/api/voice/respond').send({ text: 'Mujhe running shoes chahiye' });
    const cid = r1.body.conversationId;
    const r2 = await request(app).post('/api/voice/respond').send({ text: 'Haan batao', conversationId: cid });
    expect(r2.body.intent).toBe('product_details');
    expect(r2.body.meta.tool).toBe('getProductDetails');
    expect(r2.body.products[0].id).toBe(r1.body.products[0].id);
    expect(r2.body.reply).toMatch(new RegExp(r1.body.products[0].name.split(' ')[0]));
    expect(r2.body.voiceText).not.toMatch(/₹/);
  });
  it('out-of-stock turn is honest (P100 size 10)', async () => {
    const r = await request(app).post('/api/voice/respond').send({ text: 'Nike Revolution size 10, available hai?' });
    expect(r.body.meta.tool).toBe('checkInventory');
    expect(r.body.reply).toMatch(/out of stock/i);
  });
  it('stats aggregate server-side latency', async () => {
    await request(app).post('/api/voice/respond').send({ text: 'Hi' });
    const s = await request(app).get('/api/voice/stats');
    expect(s.status).toBe(200);
    expect(s.body.count).toBeGreaterThan(0);
    for (const k of ['llm', 'tool', 'total']) {
      expect(typeof s.body[k].avgMs).toBe('number');
      expect(typeof s.body[k].p95Ms).toBe('number');
    }
    expect(typeof s.body.byTool.searchProducts).toBe('number');
  });
});
