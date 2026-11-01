import WebSocket from 'ws';
import { config } from '../config.js';
import { EventEmitter } from 'events';

// Static phrase cache map: key = `${langCode}:${textHash}`
const audioPhraseCache = new Map<string, string[]>();

export class GnaniTTSGateway extends EventEmitter {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private langCode: string;

  constructor(langCode: string = 'en') {
    super();
    this.langCode = langCode;
  }

  public async synthesizeSentence(sentence: string): Promise<void> {
    const trimmed = sentence.trim();
    if (!trimmed) return;

    // 1. Check local audio cache to conserve Gnani credits
    const cacheKey = `${this.langCode}:${trimmed}`;
    if (audioPhraseCache.has(cacheKey)) {
      const cachedChunks = audioPhraseCache.get(cacheKey)!;
      for (const chunk of cachedChunks) {
        this.emit('audio_chunk', chunk);
      }
      this.emit('complete');
      return;
    }

    // 2. Mock mode fallback
    if (config.gnani.isMock) {
      console.log(`[Gnani TTS] Mock synthesizing: "${trimmed}" (${this.langCode})`);
      // Emit a brief mock audio event so client knows speech happened
      this.emit('audio_chunk', 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='); // Empty 44-byte wav
      this.emit('complete');
      return;
    }

    // 3. Connect to Gnani Timbre Streaming TTS
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(config.gnani.ttsWsUrl, {
          headers: {
            'X-API-Key-ID': config.gnani.apiKey,
          },
        });

        const accumulatedChunks: string[] = [];

        ws.on('open', () => {
          // Payload specification for Timbre streaming
          const payload = {
            text: trimmed,
            model: 'timbre-v3', // or timbre-v2.5
            language: this.langCode,
            audio_config: {
              audio_encoding: 'LINEAR16',
              sample_rate_hertz: 16000,
            },
          };
          ws.send(JSON.stringify(payload));
        });

        ws.on('message', (data: WebSocket.RawData) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.audio) {
              accumulatedChunks.push(parsed.audio);
              this.emit('audio_chunk', parsed.audio);
            }
            if (parsed.status === 'complete' || parsed.type === 'complete') {
              audioPhraseCache.set(cacheKey, accumulatedChunks);
              this.emit('complete');
              ws.close();
              resolve();
            }
          } catch (e) {
            // Raw binary audio chunk
            const base64 = Buffer.from(data as any).toString('base64');
            accumulatedChunks.push(base64);
            this.emit('audio_chunk', base64);
          }
        });

        ws.on('error', (err) => {
          console.error('[Gnani TTS] WebSocket error:', err);
          this.emit('error', err);
          reject(err);
        });

        ws.on('close', () => {
          if (accumulatedChunks.length > 0) {
            audioPhraseCache.set(cacheKey, accumulatedChunks);
          }
          this.emit('complete');
          resolve();
        });
      } catch (err) {
        reject(err);
      }
    });
  }
}
