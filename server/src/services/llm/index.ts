import type { LLMProvider } from './LLMProvider.js';
import { GeminiProvider } from './GeminiProvider.js';
import { KeywordProvider } from './keywordExtractor.js';

export function isLLMConfigured(): boolean {
  return Boolean(process.env.GOOGLE_API_KEY);
}

// Gemini when a key is present, deterministic keyword fallback otherwise.
// Callers must catch LLM errors and fall back so voice never hard-fails.
export function getLLMProvider(): LLMProvider {
  if (isLLMConfigured()) return new GeminiProvider();
  return new KeywordProvider();
}
