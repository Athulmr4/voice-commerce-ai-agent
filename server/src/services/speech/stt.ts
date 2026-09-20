import type { STTProvider, TranscribeInput, Transcription } from './providers.js';
import { SpeechError } from './providers.js';

// Used when no cloud STT key is configured. The client falls back to browser
// SpeechRecognition; /api/voice/transcribe answers 501 so the UI can switch.
export class UnavailableSTTProvider implements STTProvider {
  readonly name = 'unavailable';
  async transcribe(_input: TranscribeInput): Promise<Transcription> {
    throw new SpeechError(
      'STT_NOT_CONFIGURED',
      'Server STT is not configured. Use browser speech recognition instead.',
      501,
    );
  }
}

// Deepgram Nova transcription via plain HTTPS (no SDK dependency).
// Requires DEEPGRAM_API_KEY. Untested live without a key — see README.
export class DeepgramSTTProvider implements STTProvider {
  readonly name = 'deepgram';
  constructor(private apiKey = process.env.DEEPGRAM_API_KEY ?? '') {}
  async transcribe(input: TranscribeInput): Promise<Transcription> {
    if (!this.apiKey) throw new SpeechError('STT_NOT_CONFIGURED', 'Missing DEEPGRAM_API_KEY', 501);
    const audio = Buffer.from(input.audioBase64, 'base64');
    const res = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=multi', {
      method: 'POST',
      headers: { Authorization: `Token ${this.apiKey}`, 'Content-Type': input.mimeType ?? 'audio/webm' },
      body: new Uint8Array(audio),
    });
    if (!res.ok) throw new SpeechError('STT_UPSTREAM', `Deepgram error ${res.status}`, 502);
    const data = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string; confidence?: number; languages?: string[] }[] }[] } };
    const alt = data.results?.channels?.[0]?.alternatives?.[0];
    const text = alt?.transcript?.trim() ?? '';
    if (!text) throw new SpeechError('STT_EMPTY', 'No speech recognized', 502);
    return { text, confidence: alt?.confidence };
  }
}

// OpenAI Whisper transcription via plain HTTPS (no SDK dependency).
// Requires OPENAI_API_KEY. Untested live without a key — see README.
export class WhisperSTTProvider implements STTProvider {
  readonly name = 'whisper';
  constructor(private apiKey = process.env.OPENAI_API_KEY ?? '') {}
  async transcribe(input: TranscribeInput): Promise<Transcription> {
    if (!this.apiKey) throw new SpeechError('STT_NOT_CONFIGURED', 'Missing OPENAI_API_KEY', 501);
    const audio = Buffer.from(input.audioBase64, 'base64');
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: input.mimeType ?? 'audio/webm' }), 'audio.webm');
    form.append('model', 'whisper-1');
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new SpeechError('STT_UPSTREAM', `Whisper error ${res.status}`, 502);
    const data = (await res.json()) as { text?: string };
    const text = data.text?.trim() ?? '';
    if (!text) throw new SpeechError('STT_EMPTY', 'No speech recognized', 502);
    return { text };
  }
}

export function getSTTProvider(): STTProvider {
  const which = (process.env.STT_PROVIDER ?? '').toLowerCase();
  if (which === 'deepgram') return new DeepgramSTTProvider();
  if (which === 'whisper') return new WhisperSTTProvider();
  return new UnavailableSTTProvider();
}
