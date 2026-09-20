import { describe, it, expect, vi, afterEach } from 'vitest';
import { GroqProvider, LLMUpstreamError } from '../src/services/llm/GroqProvider.js';
import { getLLMProvider, isLLMConfigured } from '../src/services/llm/index.js';
import { toOpenAITools } from '../src/tools/openaiTools.js';
import { toolDefinitions } from '../src/tools/tools.js';

process.env.NODE_ENV = 'test';
// Isolated DB: each test file seeds a fresh in-memory database.
process.env.SQLITE_PATH = ':memory:';
// Hermetic: provider-selection tests manage keys explicitly below.
delete process.env.GROQ_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.LLM_PROVIDER;

function stubChat(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => body,
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GROQ_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LLM_PROVIDER;
});

describe('Groq provider', () => {
  it('converts canonical declarations to OpenAI function tools', () => {
    const tools = toOpenAITools();
    expect(new Set(tools.map(t => t.function.name))).toEqual(new Set(toolDefinitions.map(t => t.name)));
    for (const t of tools) {
      expect(t.type).toBe('function');
      expect((t.function.parameters as Record<string, unknown>).type).toBe('object');
    }
  });
  it('extracts intent/entities from JSON-mode reply', async () => {
    stubChat({ choices: [{ message: { content: '{"intent":"product_search","category":"running shoes","maxPrice":3000}' } }] });
    const r = await new GroqProvider('key').extract('Show me running shoes under 3000', {});
    expect(r.intent).toBe('product_search');
    expect(r.entities).toMatchObject({ category: 'running shoes', maxPrice: 3000 });
  });
  it('decideTool returns the model-chosen function call', async () => {
    stubChat({
      choices: [{ message: { tool_calls: [{ function: { name: 'checkInventory', arguments: '{"productId":"P100","size":"9"}' } }] }, finish_reason: 'tool_calls' }],
    });
    const r = await new GroqProvider('key').decideTool('Is it available in size 9?', { category: 'running shoes' });
    expect(r).toEqual({ name: 'checkInventory', args: { productId: 'P100', size: '9' } });
  });
  it('decideTool includes recent product ids for follow-ups', async () => {
    let sent = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sent = init.body;
      return {
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: 'checkInventory', arguments: '{"productId":"P107","size":"9"}' } }] } }] }),
      };
    }));
    const r = await new GroqProvider('key').decideTool('Is it available in size 9?', { lastProductIds: ['P107'] });
    expect(r).toEqual({ name: 'checkInventory', args: { productId: 'P107', size: '9' } });
    expect(sent).toContain('P107');
  });
  it('decideTool throws when the model makes no call', async () => {
    stubChat({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] });
    await expect(new GroqProvider('key').decideTool('Hi', {})).rejects.toBeInstanceOf(LLMUpstreamError);
  });
  it('reply returns trimmed content', async () => {
    stubChat({ choices: [{ message: { content: '  I found 3 options. Want details?  ' } }] });
    const r = await new GroqProvider('key').reply({ text: 'hi', extraction: { intent: 'product_search', entities: {} }, context: {}, toolSummary: 'x' });
    expect(r).toBe('I found 3 options. Want details?');
  });
  it('maps auth/quota failures to typed errors', async () => {
    stubChat({ error: { message: 'invalid key' } }, 401);
    await expect(new GroqProvider('bad').extract('hi', {})).rejects.toMatchObject({ code: 'LLM_AUTH' });
    stubChat({ error: { message: 'too fast' } }, 429);
    await expect(new GroqProvider('key').extract('hi', {})).rejects.toMatchObject({ code: 'LLM_QUOTA' });
  });
  it('factory prefers explicit LLM_PROVIDER, then Groq, then Gemini, then keyword', () => {
    expect(getLLMProvider().name).toBe('keyword-fallback');
    expect(isLLMConfigured()).toBe(false);
    process.env.GOOGLE_API_KEY = 'g';
    expect(getLLMProvider().name).toBe('gemini');
    process.env.GROQ_API_KEY = 'q';
    expect(getLLMProvider().name).toBe('groq');
    expect(isLLMConfigured()).toBe(true);
    process.env.LLM_PROVIDER = 'gemini';
    expect(getLLMProvider().name).toBe('gemini');
    process.env.LLM_PROVIDER = 'groq';
    expect(getLLMProvider().name).toBe('groq');
  });
});
