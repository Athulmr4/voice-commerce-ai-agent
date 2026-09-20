// Merchant profiles: per-merchant variables (language, tone, greeting) that
// tune prompts and replies without code changes — one profile per merchant.
export type MerchantLanguage = 'en' | 'hinglish';

export interface MerchantProfile {
  id: string;
  name: string;
  language: MerchantLanguage;
  tone: string;
  greeting: string;
  sttLang: string;
}

const MERCHANTS: Record<string, MerchantProfile> = {
  default: {
    id: 'default',
    name: 'Voice Store',
    language: 'en',
    tone: 'warm and concise',
    greeting: "Hi! I'm your shopping assistant. What are you looking for today?",
    sttLang: 'en-IN',
  },
  demo_hinglish: {
    id: 'demo_hinglish',
    name: 'Voice Store',
    language: 'hinglish',
    tone: 'warm and conversational, natural Hinglish',
    greeting: 'Namaste! Main aapka shopping assistant hoon. Aap kya dhoondh rahe hain?',
    sttLang: 'hi-IN',
  },
};

export function getMerchant(id?: string | null): MerchantProfile {
  if (id && MERCHANTS[id]) return MERCHANTS[id];
  return MERCHANTS.default;
}

export function listMerchants(): MerchantProfile[] {
  return Object.values(MERCHANTS);
}
