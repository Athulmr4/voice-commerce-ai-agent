import { describe, it, expect } from 'vitest';
import { KeywordProvider, extractFilters } from '../src/services/llm/keywordExtractor.js';
import { mergeEntities } from '../src/conversation.js';
import { SYSTEM_PROMPT } from '../src/prompts/system.prompt.js';
import { VOICE_PROMPT } from '../src/prompts/voice.prompt.js';

// Isolated DB: each test file seeds a fresh in-memory database.
process.env.SQLITE_PATH = ':memory:';

describe('Phase 2 LLM layer', () => {
  it('extracts category + budget + color with context merge', () => {
    const step1 = extractFilters('I need running shoes', {});
    expect(step1.category).toBe('running shoes');
    const step2 = extractFilters('Under 3000, black ones', step1);
    expect(step2).toMatchObject({ category: 'running shoes', maxPrice: 3000, color: 'black' });
  });
  it('keyword provider detects intents', async () => {
    const p = new KeywordProvider();
    expect((await p.extract('Where is my order KW12345?', {})).intent).toBe('order_status');
    expect((await p.extract('Where is my order KW12345?', {})).entities.orderId).toBe('KW12345');
    expect((await p.extract('Is Nike shoe available in size 9?', { category: 'running shoes' })).intent).toBe('inventory_check');
    expect((await p.extract('Hello', {})).intent).toBe('chitchat');
    expect((await p.extract('Show me running shoes under 3000', {})).intent).toBe('product_search');
    expect((await p.extract('Yes, tell me more', { lastProductIds: ['P100'] })).intent).toBe('product_details');
    expect((await p.extract('Which of these is the cheapest?', { lastProductIds: ['P100'] })).intent).toBe('product_details');
    expect((await p.extract('Tell me more about this one', { category: 'running shoes' })).intent).toBe('product_details');
  });
  it('mergeEntities never drops context unless replaced', () => {
    const m = mergeEntities({ category: 'running shoes', maxPrice: 3000 }, { color: 'black' });
    expect(m).toMatchObject({ category: 'running shoes', maxPrice: 3000, color: 'black' });
  });
  it('prompts encode voice rules', () => {
    for (const rule of ['Never invent', 'Never calculate prices', 'one question', 'English-only']) {
      expect(SYSTEM_PROMPT + VOICE_PROMPT).toMatch(new RegExp(rule, 'i'));
    }
  });
});
