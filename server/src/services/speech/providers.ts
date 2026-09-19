export type SpokenLanguage = 'hinglish' | 'english';

export interface TranscribeInput {
  audioBase64: string;
  mimeType?: string;
  language?: string;
}

export interface Transcription {
  text: string;
  language: SpokenLanguage;
  confidence?: number;
}

export class SpeechError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 500) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface STTProvider {
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<Transcription>;
}

export interface SynthesizeInput {
  text: string;
  language: SpokenLanguage;
  voice?: string;
}

export interface Synthesis {
  /** Spoken-ready text. Always present; browser clients speak this via speechSynthesis. */
  voiceText: string;
  /** Cloud audio when a TTS provider with audio output is configured. Absent for browser TTS. */
  audioBase64?: string;
  contentType?: string;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(input: SynthesizeInput): Promise<Synthesis>;
}
