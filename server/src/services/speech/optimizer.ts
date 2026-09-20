import type { MerchantLanguage } from '../merchants/merchants.js';

// Deterministic TTS text optimization. Turns LLM/backend strings into
// speakable text: spoken currency, no markup or symbols, capped length.
// Language-aware: Hinglish speaks "rupaye", English "rupees".
export function optimizeForSpeech(text: string, lang: MerchantLanguage = 'en'): string {
  const moneyWord = lang === 'hinglish' ? 'rupaye' : 'rupees';
  let out = text;

  // Currency: ₹2,499 / Rs. 2499 / INR 2499 -> "2,499 rupees"
  out = out.replace(/(?:₹|Rs\.?|INR)\s?([\d,]+(?:\.\d+)?)/gi, `$1 ${moneyWord}`);
  // Trailing-code prices like "2499/-" -> "2499 rupees"
  out = out.replace(/\b([\d,]+)\s?\/-/g, `$1 ${moneyWord}`);

  // Never read markup, links, or handles aloud
  out = out.replace(/https?:\/\/\S+/g, '');
  out = out.replace(/[*_#`>|~]/g, '');
  // Common symbols -> words
  out = out.replace(/&/g, ' and ').replace(/%/g, ' percent ').replace(/@/g, ' at ');
  // Strip emojis / pictographs
  out = out.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, '');
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').trim();

  // Cap: first 3 sentences, max 60 words — spoken replies must stay short.
  // Decimal points inside numbers (3,338.2) are not sentence boundaries.
  const DEC = '<DECIMAL>';
  const guarded = out.replace(/(\d)\.(\d)/g, `$1${DEC}$2`);
  const sentences = guarded.match(/[^.!?]+[.!?]+/g) ?? [guarded];
  out = sentences.map(s => s.trim()).filter(Boolean).slice(0, 3).join(' ').split(DEC).join('.');
  const words = out.split(/\s+/).filter(Boolean);
  if (words.length > 60) out = words.slice(0, 60).join(' ');
  return out.replace(/\s+([,.!?])/g, '$1').trim();
}

export interface SpokenProduct {
  name: string;
  price: number;
  brand: string;
  color?: string | null;
  description?: string;
}

// Two-sentence spoken product summary for the "tell me more" details turn.
// Currency stays numeric here; optimizeForSpeech() speaks it downstream.
export function spokenProductSummary(p: SpokenProduct, lang: MerchantLanguage = 'en'): string {
  const desc = (p.description ?? '').split(/\s+/).slice(0, 15).join(' ');
  if (lang === 'hinglish') {
    const attrs = [p.brand, p.color].filter(Boolean).join(', ');
    return `${p.name} — ${attrs}, ₹${p.price.toLocaleString('en-IN')} ka hai. ${desc}. Size ya order ke baare mein pooch sakte hain.`;
  }
  return `${p.name} by ${p.brand}${p.color ? ` in ${p.color}` : ''}, priced at ₹${p.price.toLocaleString('en-IN')}. ${desc}. Want to check a size?`;
}
