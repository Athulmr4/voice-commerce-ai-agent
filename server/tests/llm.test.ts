import { describe, it, expect } from 'vitest';
import { KeywordProvider, detectHinglish, extractFilters } from '../src/services/llm/keywordExtractor.js';
import { mergeEntities } from '../src/conversation.js';
import { SYSTEM_PROMPT } from '../src/prompts/system.prompt.js';
import { VOICE_PROMPT } from '../src/prompts/voice.prompt.js';

describe('Phase 2 LLM layer', () => {
  it('detects Hinglish', () => {
    expect(detectHinglish('Mujhe running shoes chahiye')).toBe(true);
    expect(detectHinglish('Show me running shoes')).toBe(false);
  });
  it('extracts category + budget + color with context merge', () => {
    const step1 = extractFilters('Mujhe running shoes chahiye', {});
    expect(step1.category).toBe('running shoes');
    const step2 = extractFilters('3000 ke andar, black ones', step1);
    expect(step2).toMatchObject({ category: 'running shoes', maxPrice: 3000, color: 'black' });
  });
  it('keyword provider detects intents', async () => {
    const p = new KeywordProvider();
    expect((await p.extract('Where is my order KW12345?', {})).intent).toBe('order_status');
    expect((await p.extract('Where is my order KW12345?', {})).entities.orderId).toBe('KW12345');
    expect((await p.extract('Is Nike shoe available in size 9?', { category: 'running shoes' })).intent).toBe('inventory_check');
    expect((await p.extract('Namaste', {})).intent).toBe('chitchat');
    expect((await p.extract('Mujhe running shoes chahiye, 3000 ke andar', {})).intent).toBe('product_search');
    expect((await p.extract('Haan batao', { lastProductIds: ['P100'] })).intent).toBe('product_details');
    expect((await p.extract('Tell me more about this one', { category: 'running shoes' })).intent).toBe('product_details');
  });
  it('mergeEntities never drops context unless replaced', () => {
    const m = mergeEntities({ category: 'running shoes', maxPrice: 3000 }, { color: 'black' });
    expect(m).toMatchObject({ category: 'running shoes', maxPrice: 3000, color: 'black' });
  });
  it('prompts encode voice rules', () => {
    for (const rule of ['Never invent', 'Never calculate prices', 'one question', 'Hinglish']) {
      expect(SYSTEM_PROMPT + VOICE_PROMPT).toMatch(new RegExp(rule, 'i'));
    }
  });
});
