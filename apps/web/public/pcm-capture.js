/* global AudioWorkletProcessor, registerProcessor */
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      const bytes = new ArrayBuffer(channel.length * 2);
      const view = new DataView(bytes);
      for (let i = 0; i < channel.length; i += 1) view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, channel[i])) * 32767), true);
      this.port.postMessage(bytes, [bytes]);
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
