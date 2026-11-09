/** Plays streamed mono LINEAR16 at the rate reported by the server. */
export class StreamingAudioPlayer {
  private ctx: AudioContext | null = null;
  private nextPlayTime = 0;
  private activeSourceNodes: AudioBufferSourceNode[] = [];
  private generation = 0;
  private pendingByte: number | null = null;
  private started = false;
  public onIdle?: () => void;

  public prepare() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  public async playChunk(base64Audio: string, sampleRate: number) {
    this.prepare();
    const ctx = this.ctx;
    if (!ctx) return;
    const generation = this.generation;
    try {
      const binary = atob(base64Audio);
      let bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      if (this.pendingByte !== null) {
        const joined = new Uint8Array(bytes.length + 1);
        joined[0] = this.pendingByte; joined.set(bytes, 1); bytes = joined;
        this.pendingByte = null;
      }
      let buffer: AudioBuffer;
      if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF') {
        buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      } else {
        if (bytes.length % 2) { this.pendingByte = bytes[bytes.length - 1]; bytes = bytes.slice(0, -1); }
        if (!bytes.length) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const samples = new Float32Array(bytes.length / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
        buffer = ctx.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
      }
      if (generation !== this.generation) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer; source.connect(ctx.destination);
      const start = Math.max(ctx.currentTime + (this.started ? 0 : 0.15), this.nextPlayTime);
      this.started = true;
      this.nextPlayTime = start + buffer.duration;
      this.activeSourceNodes.push(source);
      source.onended = () => {
        const index = this.activeSourceNodes.indexOf(source);
        if (index >= 0) this.activeSourceNodes.splice(index, 1);
        if (!this.activeSourceNodes.length) this.onIdle?.();
      };
      source.start(start);
    } catch (error) { console.warn('Unable to play speech audio:', error); }
  }

  public stop() {
    this.generation++;
    for (const source of this.activeSourceNodes) { try { source.stop(); } catch {} }
    this.activeSourceNodes = []; this.pendingByte = null; this.started = false;
    if (this.ctx) this.nextPlayTime = this.ctx.currentTime;
  }

  public getIsPlaying() { return this.activeSourceNodes.length > 0; }
}
