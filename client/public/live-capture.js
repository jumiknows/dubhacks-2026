// Microphone capture for Gemini Live: resample to 16 kHz mono Int16 in the audio
// thread and post ~64 ms frames with their loudness, so the page can decide
// what counts as speech without touching raw audio on the main thread.
class LiveCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.pos = 0;
    this.frame = new Int16Array(1024);
    this.fill = 0;
    this.energy = 0;
    this.last = 0; // final sample of the previous block, for interpolation across blocks
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    // Linear interpolation from the context rate (44.1 or 48 kHz) down to 16 kHz.
    // pos can start just below 0: that point sits between the last block and this one.
    while (this.pos < input.length - 1) {
      const i = Math.floor(this.pos);
      const t = this.pos - i;
      const a = i < 0 ? this.last : input[i];
      const sample = Math.max(-1, Math.min(1, a * (1 - t) + input[i + 1] * t));
      this.frame[this.fill++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      this.energy += sample * sample;
      if (this.fill === this.frame.length) {
        const rms = Math.sqrt(this.energy / this.fill);
        this.port.postMessage({ pcm: this.frame.buffer, rms }, [this.frame.buffer]);
        this.frame = new Int16Array(1024);
        this.fill = 0;
        this.energy = 0;
      }
      this.pos += this.step;
    }
    this.pos -= input.length;
    this.last = input[input.length - 1];
    return true;
  }
}

registerProcessor("live-capture", LiveCapture);
