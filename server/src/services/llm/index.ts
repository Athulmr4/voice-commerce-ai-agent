import type { LLMProvider } from './LLMProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { GroqProvider } from './GroqProvider.js';
import { KeywordProvider } from './keywordExtractor.js';

export function isLLMConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY ?? process.env.GOOGLE_API_KEY);
}

// Ordered fallback chain. Explicit LLM_PROVIDER pins a single cloud provider;
// otherwise Groq → Gemini → keyword, first success per stage wins.
// Callers try each stage in order so voice degrades gracefully, never hard-fails.
export function getLLMProviders(): LLMProvider[] {
  const which = (process.env.LLM_PROVIDER ?? '').toLowerCase();
  const keyword = () => new KeywordProvider();
  if (which === 'groq') return [new GroqProvider(), keyword()];
  if (which === 'gemini') return [new GeminiProvider(), keyword()];
  const chain: LLMProvider[] = [];
  if (process.env.GROQ_API_KEY) chain.push(new GroqProvider());
  if (process.env.GOOGLE_API_KEY) chain.push(new GeminiProvider());
  chain.push(keyword());
  return chain;
}

// Primary provider (first in chain). Used for health reporting.
export function getLLMProvider(): LLMProvider {
  return getLLMProviders()[0];
}
