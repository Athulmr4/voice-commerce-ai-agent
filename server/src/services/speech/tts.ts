import type { SpokenLanguage, Synthesis, SynthesizeInput, TTSProvider } from './providers.js';
import { SpeechError } from './providers.js';
import { optimizeForSpeech } from './optimizer.js';

// Default: optimize text server-side; the browser speaks it via speechSynthesis.
// No audio bytes are produced in this mode — voiceText IS the product.
export class BrowserTTSProvider implements TTSProvider {
  readonly name = 'browser';
  async synthesize(input: SynthesizeInput): Promise<Synthesis> {
    return { voiceText: optimizeForSpeech(input.text, input.language) };
  }
}

// ElevenLabs TTS via plain HTTPS (no SDK dependency).
// Requires ELEVENLABS_API_KEY. Untested live without a key — see README.
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly name = 'elevenlabs';
  constructor(
    private apiKey = process.env.ELEVENLABS_API_KEY ?? '',
    private voiceId = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM',
  ) {}
  async synthesize(input: SynthesizeInput): Promise<Synthesis> {
    if (!this.apiKey) throw new SpeechError('TTS_NOT_CONFIGURED', 'Missing ELEVENLABS_API_KEY', 501);
    const voiceText = optimizeForSpeech(input.text, input.language);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${input.voice ?? this.voiceId}`, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: voiceText, model_id: 'eleven_multilingual_v2' }),
    });
    if (!res.ok) throw new SpeechError('TTS_UPSTREAM', `ElevenLabs error ${res.status}`, 502);
    const buf = Buffer.from(await res.arrayBuffer());
    return { voiceText, audioBase64: buf.toString('base64'), contentType: 'audio/mpeg' };
  }
}

export function getTTSProvider(): TTSProvider {
  const which = (process.env.TTS_PROVIDER ?? 'browser').toLowerCase();
  if (which === 'elevenlabs') return new ElevenLabsTTSProvider();
  return new BrowserTTSProvider();
}

export type { SpokenLanguage };
