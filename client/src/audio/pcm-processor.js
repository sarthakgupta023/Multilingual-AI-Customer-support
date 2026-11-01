// AudioWorklet processor for downsampling and converting to 16-bit PCM (16kHz or 8kHz Mono)
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.port.onmessage = (e) => {
      if (e.data && e.data.targetSampleRate) {
        this.targetSampleRate = e.data.targetSampleRate;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // mono float32 channel [-1.0, 1.0]

    // Convert Float32 to 16-bit signed PCM with downsampling if required
    const step = sampleRate / this.targetSampleRate;
    const outputLength = Math.floor(channelData.length / step);
    const pcm16 = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIdx = Math.floor(i * step);
      let s = Math.max(-1, Math.min(1, channelData[srcIdx]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Post raw PCM buffer to main thread
    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
