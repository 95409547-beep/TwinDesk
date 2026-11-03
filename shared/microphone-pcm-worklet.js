// TwinDesk microphone fork. GPL-3.0, see LICENSE.
// 48 kHz mono s16le, 20 ms frames. The output remains silent; only the native adapter plays PCM.
class MicrophonePCM extends AudioWorkletProcessor {
  constructor() { super(); this.samples = new Int16Array(960); this.count = 0; this.port.onmessage = (e) => { if (e.data === 'flush') { this.flush(); this.port.postMessage({ flushed: true }); } }; }
  flush() {
    if (!this.count) return;
    const buffer = new ArrayBuffer(this.count * 2), data = new DataView(buffer);
    for (let i = 0; i < this.count; i++) data.setInt16(i * 2, this.samples[i], true);
    this.port.postMessage({ pcm: buffer }, [buffer]); this.count = 0;
  }
  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) for (let i = 0; i < channels[0].length; i++) {
      let v = 0; for (const channel of channels) v += channel[i] || 0;
      v = Math.max(-1, Math.min(1, v / channels.length));
      this.samples[this.count++] = Math.round(v * (v < 0 ? 32768 : 32767));
      if (this.count === this.samples.length) this.flush();
    }
    return true;
  }
}
registerProcessor('microphone-pcm', MicrophonePCM);
