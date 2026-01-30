import { useCallback, useEffect, useRef, useState } from 'react';
import { 
  encodeAudioToBase64, 
  resampleAudio, 
  REALTIME_SAMPLE_RATE 
} from '../utils/audioUtils';

interface UseRealtimeAudioOptions {
  onAudioChunk?: (base64Audio: string) => void;
  enabled?: boolean;
}


export function useRealtimeAudio(options: UseRealtimeAudioOptions = {}) {
  const { onAudioChunk, enabled = false } = options;

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const onAudioChunkRef = useRef(onAudioChunk);
  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  
  const audioBufferRef = useRef<Float32Array[]>([]);
  const bufferSizeRef = useRef(0);
  const TARGET_BUFFER_SIZE = 1200; 

  const silenceThreshold = 0.025;
  const silenceFrames = useRef(0);
  const SILENCE_FRAMES_THRESHOLD = 8;
  
  const speechFrames = useRef(0);
  const SPEECH_FRAMES_THRESHOLD = 2;
  const lastSpeechAtRef = useRef(0);
  const SPEAKING_HOLD_MS = 350;

  const chunkCountRef = useRef(0);

  const cleanupResources = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    if (silentGainRef.current) {
      silentGainRef.current.disconnect();
      silentGainRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    audioBufferRef.current = [];
    bufferSizeRef.current = 0;
    silenceFrames.current = 0;
    speechFrames.current = 0;
    isSpeakingRef.current = false;
    isListeningRef.current = false;
    chunkCountRef.current = 0;
  }, []);

  const startListening = useCallback(async () => {
    if (isListeningRef.current) {
      console.log('Already listening, skipping start');
      return;
    }

    try {
      cleanupResources();

      console.log('Requesting microphone access...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: 48000 }
        }
      });

      console.log('Microphone access granted');
      streamRef.current = stream;

      const context = new AudioContext();
      audioContextRef.current = context;
      console.log('AudioContext created, sample rate:', context.sampleRate);

      const workletUrl = new URL('/audio-processor.worklet.js', window.location.origin).href;
      await context.audioWorklet.addModule(workletUrl);

      sourceRef.current = context.createMediaStreamSource(stream);
      workletNodeRef.current = new AudioWorkletNode(context, 'audio-processor');
      silentGainRef.current = context.createGain();
      silentGainRef.current.gain.value = 0;

      const sampleRate = context.sampleRate;

      workletNodeRef.current.port.onmessage = (event: MessageEvent<{ type: string; data: Float32Array }>) => {
        if (!isListeningRef.current || event.data.type !== 'audio') return;

        const inputData = event.data.data;

        // Resample from device rate to OpenAI's 24kHz
        const resampled = resampleAudio(new Float32Array(inputData), sampleRate, REALTIME_SAMPLE_RATE);

        // Calculate volume (RMS) to detect speech
        let sum = 0;
        for (let i = 0; i < resampled.length; i++) {
          sum += resampled[i] * resampled[i];
        }
        const rms = Math.sqrt(sum / resampled.length);

        const isSpeakingNow = rms > silenceThreshold;
        const now = performance.now();

        // Track speech start/stop with hysteresis to avoid flickering
        if (isSpeakingNow) {
          silenceFrames.current = 0;
          speechFrames.current++;
          lastSpeechAtRef.current = now;

          if (!isSpeakingRef.current && speechFrames.current >= SPEECH_FRAMES_THRESHOLD) {
            isSpeakingRef.current = true;
            setIsSpeaking(true);
          }
        } else {
          speechFrames.current = 0;
          silenceFrames.current++;
          if (isSpeakingRef.current) {
            const holdElapsed = now - lastSpeechAtRef.current;
            if (holdElapsed >= SPEAKING_HOLD_MS && silenceFrames.current > SILENCE_FRAMES_THRESHOLD) {
              isSpeakingRef.current = false;
              setIsSpeaking(false);
            }
          }
        }

        // Buffer audio until we have enough to send (1200 samples = 50ms at 24kHz, low latency)
        audioBufferRef.current.push(resampled);
        bufferSizeRef.current += resampled.length;

        while (bufferSizeRef.current >= TARGET_BUFFER_SIZE) {
          const totalLength = audioBufferRef.current.reduce((s, arr) => s + arr.length, 0);
          const combined = new Float32Array(totalLength);
          let offset = 0;
          for (const buffer of audioBufferRef.current) {
            combined.set(buffer, offset);
            offset += buffer.length;
          }

          const toSend = combined.subarray(0, TARGET_BUFFER_SIZE);
          const base64 = encodeAudioToBase64(toSend);
          chunkCountRef.current++;

          if (chunkCountRef.current <= 3 || chunkCountRef.current % 50 === 0) {
            console.log(`Audio chunk #${chunkCountRef.current}, size: ${base64.length}, rms: ${rms.toFixed(4)}`);
          }

          onAudioChunkRef.current?.(base64);

          const remainder = totalLength - TARGET_BUFFER_SIZE;
          if (remainder > 0) {
            audioBufferRef.current = [combined.subarray(TARGET_BUFFER_SIZE)];
            bufferSizeRef.current = remainder;
          } else {
            audioBufferRef.current = [];
            bufferSizeRef.current = 0;
          }
        }
      };

      sourceRef.current.connect(workletNodeRef.current);
      workletNodeRef.current.connect(silentGainRef.current);
      silentGainRef.current.connect(context.destination);

      isListeningRef.current = true;
      setIsListening(true);
      console.log('Audio capture started successfully');

    } catch (error) {
      console.error('Error starting audio capture:', error);
      cleanupResources();
      throw error;
    }
  }, [cleanupResources]);

  const stopListening = useCallback(() => {
    console.log('Stopping audio capture');
    cleanupResources();
    setIsListening(false);
    setIsSpeaking(false);
  }, [cleanupResources]);

  useEffect(() => {
    if (enabled && !isListeningRef.current) {
      startListening().catch(console.error);
    } else if (!enabled && isListeningRef.current) {
      stopListening();
    }
  }, [enabled, startListening, stopListening]);

  useEffect(() => {
    return () => {
      cleanupResources();
    };
  }, [cleanupResources]);

  return {
    isListening,
    isSpeaking,
    startListening,
    stopListening
  };
}
