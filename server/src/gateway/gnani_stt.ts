import WebSocket from 'ws';
import { config } from '../config.js';
import { EventEmitter } from 'events';

// Map generic language code to Gnani Prisma STT BCP-47 codes
const GNANI_STT_LANG_MAP: Record<string, string> = {
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  bn: 'bn-IN',
  mr: 'mr-IN',
  gu: 'gu-IN',
  pa: 'pa-IN',
  as: 'as-IN',
  auto: 'indic-auto',
};

export class GnaniSTTGateway extends EventEmitter {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private langCode: string;
  private sampleRate: number;

  constructor(langCode: string = 'en', sampleRate: number = 16000) {
    super();
    this.langCode = langCode;
    this.sampleRate = sampleRate;
  }

  public connect(): Promise<void> {
    if (config.gnani.isMock) {
      console.log(`[Gnani STT] Initialized in MOCK mode for language: ${this.langCode}`);
      this.isConnected = true;
      this.emit('connected');
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      try {
        const mappedLang = GNANI_STT_LANG_MAP[this.langCode] || `${this.langCode}-IN`;
        const headers: Record<string, string> = {
          'x-api-key-id': config.gnani.apiKey,
          'lang_code': mappedLang,
          'x-sample-rate': this.sampleRate.toString(),
        };

        console.log(`[Gnani STT] Connecting to ${config.gnani.sttWsUrl} with lang: ${mappedLang}, rate: ${this.sampleRate}`);
        this.ws = new WebSocket(config.gnani.sttWsUrl, { headers });

        this.ws.on('open', () => {
          this.isConnected = true;
          console.log(`[Gnani STT] WebSocket connected successfully!`);
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
          try {
            const parsed = JSON.parse(data.toString());
            // Gnani STT sends transcript segments when end-of-speech is detected
            if (parsed.transcript || parsed.text) {
              const text = parsed.transcript || parsed.text;
              const isFinal = parsed.is_final ?? true;
              this.emit('transcript', { text, isFinal });
            } else if (parsed.type === 'connected') {
              console.log(`[Gnani STT] VAD service ready: ${parsed.message}`);
            } else if (parsed.type === 'error') {
              console.error(`[Gnani STT] Server error:`, parsed.message);
              this.emit('error', new Error(parsed.message));
            }
          } catch (e) {
            this.emit('raw_message', data);
          }
        });

        this.ws.on('error', (err) => {
          console.error('[Gnani STT] WebSocket error:', err.message);
          this.emit('error', err);
          reject(err);
        });

        this.ws.on('close', (code, reason) => {
          this.isConnected = false;
          console.log(`[Gnani STT] Connection closed (${code}): ${reason.toString()}`);
          this.emit('close');
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public sendAudioChunk(chunk: Buffer) {
    if (config.gnani.isMock) {
      return;
    }

    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  public close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
