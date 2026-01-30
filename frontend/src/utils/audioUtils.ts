export const REALTIME_SAMPLE_RATE = 24000;

export function floatTo16BitPCM(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16Array;
}

export function pcm16ToFloat32(int16Array: Int16Array): Float32Array {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 0x8000 : 0x7FFF);
  }
  return float32Array;
}

export function encodeAudioToBase64(float32Array: Float32Array): string {
  const int16Array = floatTo16BitPCM(float32Array);
  const uint8Array = new Uint8Array(int16Array.buffer);
  
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binary);
}

export function decodeBase64ToAudio(base64: string): Float32Array {
  const binaryString = atob(base64);
  const evenLength = binaryString.length - (binaryString.length % 2);
  const bytes = new Uint8Array(evenLength);
  for (let i = 0; i < evenLength; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const int16Array = new Int16Array(bytes.buffer);
  return pcm16ToFloat32(int16Array);
}

export function resampleAudio(
  audioData: Float32Array,
  fromSampleRate: number,
  toSampleRate: number
): Float32Array {
  if (fromSampleRate === toSampleRate) {
    return audioData;
  }

  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.round(audioData.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;

    if (index + 1 < audioData.length) {
      result[i] = audioData[index] * (1 - fraction) + audioData[index + 1] * fraction;
    } else {
      result[i] = audioData[index] || 0;
    }
  }

  return result;
}

export function createPlaybackContext(): AudioContext {
  return new AudioContext({ sampleRate: REALTIME_SAMPLE_RATE });
}

export async function playPCM16Audio(
  audioContext: AudioContext,
  base64Audio: string
): Promise<AudioBufferSourceNode> {
  const float32Data = decodeBase64ToAudio(base64Audio);
  
  const audioBuffer = audioContext.createBuffer(
    1,
    float32Data.length,
    REALTIME_SAMPLE_RATE
  );
  
  audioBuffer.getChannelData(0).set(float32Data);
  
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  source.start(0);
  
  return source;
}

