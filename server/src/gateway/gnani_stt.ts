import WebSocket from 'ws';
import { config } from '../config.js';
import { EventEmitter } from 'events';

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
        const headers: Record<string, string> = {
          'x-api-key-id': config.gnani.apiKey,
          'lang_code': this.langCode,
          'x-sample-rate': this.sampleRate.toString(),
        };

        this.ws = new WebSocket(config.gnani.sttWsUrl, { headers });

        this.ws.on('open', () => {
          this.isConnected = true;
          console.log(`[Gnani STT] WebSocket connected to ${config.gnani.sttWsUrl}`);
          this.emit('connected');
          resolve();
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
          try {
            const parsed = JSON.parse(data.toString());
            // Gnani sends messages like: { type: 'transcript', text: '...', is_final: true }
            if (parsed.transcript || parsed.text) {
              const text = parsed.transcript || parsed.text;
              const isFinal = parsed.is_final ?? true;
              this.emit('transcript', { text, isFinal });
            }
          } catch (e) {
            // Raw binary or unparsed text
            this.emit('raw_message', data);
          }
        });

        this.ws.on('error', (err) => {
          console.error('[Gnani STT] WebSocket error:', err);
          this.emit('error', err);
          reject(err);
        });

        this.ws.on('close', (code, reason) => {
          this.isConnected = false;
          console.log(`[Gnani STT] Connection closed (${code}): ${reason}`);
          this.emit('close');
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public sendAudioChunk(chunk: Buffer) {
    if (config.gnani.isMock) {
      // In mock mode, speech is simulated via typed input or test harness
      return;
    }

    if (this.ws && this.isConnected && this.ws.readyState === WebSocket.OPEN) {
      // Gnani expects 1024-byte frames
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
