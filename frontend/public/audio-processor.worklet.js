class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.index = 0;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];
    const len = channel.length;

    for (let i = 0; i < len; i++) {
      this.buffer[this.index++] = channel[i];
    }

    while (this.index >= this.bufferSize) {
      this.port.postMessage({ type: 'audio', data: this.buffer.slice(0, this.bufferSize) });
      if (this.index > this.bufferSize) {
        this.buffer.copyWithin(0, this.bufferSize, this.index);
        this.index -= this.bufferSize;
      } else {
        this.index = 0;
        break;
      }
    }

    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
