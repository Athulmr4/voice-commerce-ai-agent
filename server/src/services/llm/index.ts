import type { LLMProvider } from './LLMProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { GroqProvider } from './GroqProvider.js';
import { KeywordProvider } from './keywordExtractor.js';

export function isLLMConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY ?? process.env.GOOGLE_API_KEY);
}

// Selection: explicit LLM_PROVIDER wins (groq|gemini); otherwise Groq when
// GROQ_API_KEY is set, Gemini when GOOGLE_API_KEY is set, else deterministic
// keyword fallback. Callers must catch LLM errors and fall back so voice never hard-fails.
export function getLLMProvider(): LLMProvider {
  const which = (process.env.LLM_PROVIDER ?? '').toLowerCase();
  if (which === 'groq') return new GroqProvider();
  if (which === 'gemini') return new GeminiProvider();
  if (process.env.GROQ_API_KEY) return new GroqProvider();
  if (process.env.GOOGLE_API_KEY) return new GeminiProvider();
  return new KeywordProvider();
}
