export class StreamingAudioPlayer {
  private ctx: AudioContext | null = null;
  private nextPlayTime = 0;
  private isPlaying = false;
  private activeSourceNodes: AudioBufferSourceNode[] = [];

  constructor() {
    // AudioContext will be initialized on first user interaction
  }

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx({ sampleRate: 16000 });
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public async playChunk(base64Audio: string) {
    this.initContext();
    if (!this.ctx) return;

    try {
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Check if it's a WAV header (starts with 'RIFF')
      let audioBuffer: AudioBuffer;
      if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF') {
        audioBuffer = await this.ctx.decodeAudioData(bytes.buffer.slice(0));
      } else {
        // Raw Linear16 PCM (16kHz mono)
        const int16Array = new Int16Array(bytes.buffer);
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
          float32Array[i] = int16Array[i] / 32768.0;
        }

        audioBuffer = this.ctx.createBuffer(1, float32Array.length, 16000);
        audioBuffer.copyToChannel(float32Array, 0);
      }

      // Schedule playback seamlessly
      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.ctx.destination);

      const currentTime = this.ctx.currentTime;
      const scheduledTime = Math.max(currentTime, this.nextPlayTime);
      source.start(scheduledTime);

      this.nextPlayTime = scheduledTime + audioBuffer.duration;
      this.isPlaying = true;
      this.activeSourceNodes.push(source);

      source.onended = () => {
        const idx = this.activeSourceNodes.indexOf(source);
        if (idx !== -1) this.activeSourceNodes.splice(idx, 1);
        if (this.activeSourceNodes.length === 0) {
          this.isPlaying = false;
        }
      };
    } catch (err) {
      console.warn('[AudioPlayer] Error decoding audio chunk:', err);
    }
  }

  /**
   * Stop all playback immediately (Barge-in support)
   */
  public stop() {
    for (const source of this.activeSourceNodes) {
      try {
        source.stop();
      } catch (e) {}
    }
    this.activeSourceNodes = [];
    this.isPlaying = false;
    if (this.ctx) {
      this.nextPlayTime = this.ctx.currentTime;
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }
}
