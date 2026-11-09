const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/pcm-processor.js'), 'utf8');

function processorFor(inputRate, outputRate = 16000) {
  let Processor;
  const sent = [];
  class AudioWorkletProcessor { constructor() { this.port = { postMessage: buffer => sent.push(Buffer.from(buffer)) }; } }
  vm.runInNewContext(source, { AudioWorkletProcessor, sampleRate: inputRate, Int16Array, Math, registerProcessor: (_name, type) => { Processor = type; } });
  const processor = new Processor();
  processor.port.onmessage({ data: { targetSampleRate: outputRate } });
  return { processor, sent };
}

for (const inputRate of [44100, 48000]) {
  test(`preserves the output rate and 512-sample frames at ${inputRate} Hz`, () => {
    const { processor, sent } = processorFor(inputRate);
    for (let offset = 0; offset < inputRate; offset += 128) {
      const size = Math.min(128, inputRate - offset);
      processor.process([[new Float32Array(size).fill(0.5)]]);
    }
    assert.equal(sent.length, Math.floor(16000 / 512));
    assert.ok(sent.every(frame => frame.length === 1024));
    assert.equal(sent[0].readInt16LE(0), 16383);
  });
}

test('handles 8 kHz output and clamps samples', () => {
  const { processor, sent } = processorFor(48000, 8000);
  for (let i = 0; i < 375; i++) processor.process([[new Float32Array(128).fill(-2)]]);
  assert.equal(sent.length, Math.floor(8000 / 512));
  assert.equal(sent[0].readInt16LE(0), -32768);
});
