import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { getMerchant, listMerchants } from '../src/services/merchants/merchants.js';
import { say } from '../src/services/localization/languagePacks.js';
import { searchKnowledge } from '../src/services/knowledge/retriever.js';
import { executeTool, toolDefinitions } from '../src/tools/tools.js';

process.env.NODE_ENV = 'test';
// Isolated DB: each test file seeds a fresh in-memory database.
process.env.SQLITE_PATH = ':memory:';
// Hermetic: deterministic keyword path, never a live LLM.
delete process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.LLM_PROVIDER;

describe('Merchants + language packs (JD: per-merchant prompts)', () => {
  it('resolves profiles with English default', () => {
    expect(getMerchant().id).toBe('default');
    expect(getMerchant().language).toBe('en');
    expect(getMerchant('nope').id).toBe('default');
    expect(getMerchant('demo_hinglish').language).toBe('hinglish');
    expect(listMerchants().length).toBeGreaterThanOrEqual(2);
  });
  it('renders both language packs', () => {
    expect(say('en', 'searchSummary', { count: 3, plural: 's', cheapest: '₹1,799' })).toMatch(/I found 3 options/);
    expect(say('hinglish', 'searchSummary', { count: 3, plural: 's', cheapest: '₹1,799' })).toMatch(/teen|3 option/);
    expect(say('hinglish', 'orderCancelled')).toMatch(/cancel/);
  });
  it('retrieves grounded policy chunks, empty on gibberish', () => {
    const hits = searchKnowledge('What are the delivery charges?');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].title).toMatch(/Shipping/i);
    expect(searchKnowledge('xqzv blorpt wibble')).toEqual([]);
  });
  it('searchKnowledge tool validates input', async () => {
    const r = (await executeTool('searchKnowledge', { query: 'return policy' })) as { title: string }[];
    expect(r[0].title).toMatch(/Return/i);
    await expect(executeTool('searchKnowledge', { query: '' })).rejects.toThrow();
  });
  it('Hinglish merchant gets Hinglish replies', async () => {
    const c = await request(app).post('/api/conversations');
    const r = await request(app).post(`/api/conversations/${c.body.conversationId}/messages`)
      .send({ text: 'Mujhe running shoes chahiye, 3000 ke andar', merchantId: 'demo_hinglish' });
    expect(r.status).toBe(200);
    expect(r.body.meta.language).toBe('hinglish');
    expect(r.body.meta.merchantId).toBe('demo_hinglish');
    expect(r.body.reply).toMatch(/mile hain/);
  });
  it('default merchant stays English', async () => {
    const c = await request(app).post('/api/conversations');
    const r = await request(app).post(`/api/conversations/${c.body.conversationId}/messages`)
      .send({ text: 'Show me running shoes under 3000' });
    expect(r.body.meta.language).toBe('en');
    expect(r.body.reply).toMatch(/I found/);
  });
  it('policy questions answered from the knowledge base', async () => {
    const c = await request(app).post('/api/conversations');
    const r = await request(app).post(`/api/conversations/${c.body.conversationId}/messages`)
      .send({ text: 'What is your return policy?' });
    expect(r.body.meta.tool).toBe('searchKnowledge');
    expect(r.body.reply).toMatch(/7 days/i);
  });
});
