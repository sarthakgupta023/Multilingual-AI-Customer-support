// Produce provider-sized 512-sample PCM frames at the requested sample rate.
// Keep the resampling phase across AudioWorklet blocks (which may be 44.1 kHz).
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.phase = 0;
    this.frame = new Int16Array(512);
    this.frameLength = 0;
    this.port.onmessage = (event) => {
      const rate = event.data?.targetSampleRate;
      if ((rate === 8000 || rate === 16000) && rate !== this.targetSampleRate) {
        this.targetSampleRate = rate;
        this.phase = 0;
        this.frame = new Int16Array(512);
        this.frameLength = 0;
      }
    };
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    for (const sample of samples) {
      this.phase += this.targetSampleRate;
      if (this.phase < sampleRate) continue;
      this.phase -= sampleRate;
      const value = Math.max(-1, Math.min(1, sample));
      this.frame[this.frameLength++] = value < 0 ? value * 0x8000 : value * 0x7fff;
      if (this.frameLength === this.frame.length) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(512);
        this.frameLength = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
