import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { config } from '../config';

// Static phrase cache map: key = `${langCode}:${textHash}`
const audioPhraseCache = new Map<string, string[]>();

export class GnaniTTSGateway extends EventEmitter {
  private langCode: string;

  constructor(langCode: string = 'en') {
    super();
    this.langCode = langCode.split('-')[0]; // Ensure 'en', 'hi', 'ta', etc.
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
      this.emit('audio_chunk', 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
      this.emit('complete');
      return;
    }

    // 3. Connect to Gnani Timbre Streaming TTS WebSocket
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(config.gnani.ttsWsUrl, {
          headers: {
            'X-API-Key-ID': config.gnani.apiKey,
          },
        });

        const accumulatedChunks: string[] = [];

        ws.on('open', () => {
          const payload = {
            text: trimmed,
            model: config.gnani.defaultModel || 'timbre-v3.0',
            voice: config.gnani.defaultVoice || 'Shivani',
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
            const base64Audio = parsed.data?.audio || parsed.audio;

            if (base64Audio && base64Audio.length > 0) {
              accumulatedChunks.push(base64Audio);
              this.emit('audio_chunk', base64Audio);
            }

            if (parsed.type === 'complete' || (parsed.data && parsed.data.is_final)) {
              if (accumulatedChunks.length > 0) {
                audioPhraseCache.set(cacheKey, accumulatedChunks);
              }
              this.emit('complete');
              ws.close();
              resolve();
            } else if (parsed.type === 'error') {
              console.error('[Gnani TTS] WebSocket error response:', parsed.message);
              this.emit('error', new Error(parsed.message));
              ws.close();
              reject(new Error(parsed.message));
            }
          } catch (e) {
            // Raw binary audio fallback
            const base64 = Buffer.from(data as any).toString('base64');
            accumulatedChunks.push(base64);
            this.emit('audio_chunk', base64);
          }
        });

        ws.on('error', (err) => {
          console.error('[Gnani TTS] WebSocket error:', err.message);
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
