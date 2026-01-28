import { useCallback, useEffect, useRef, useState } from 'react';
import { 
  encodeAudioToBase64, 
  resampleAudio, 
  REALTIME_SAMPLE_RATE 
} from '../utils/audioUtils';

interface UseRealtimeAudioOptions {
  onAudioChunk?: (base64Audio: string) => void;
  onSpeechStart?: () => void;
  enabled?: boolean;
}


export function useRealtimeAudio(options: UseRealtimeAudioOptions = {}) {
  const { onAudioChunk, onSpeechStart, enabled = false } = options;

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const onAudioChunkRef = useRef(onAudioChunk);
  const onSpeechStartRef = useRef(onSpeechStart);
  
  useEffect(() => {
    onAudioChunkRef.current = onAudioChunk;
  }, [onAudioChunk]);
  
  useEffect(() => {
    onSpeechStartRef.current = onSpeechStart;
  }, [onSpeechStart]);

  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isSpeakingRef = useRef(false);
  const isListeningRef = useRef(false);
  
  const audioBufferRef = useRef<Float32Array[]>([]);
  const bufferSizeRef = useRef(0);
  const TARGET_BUFFER_SIZE = 2400; 

  const silenceThreshold = 0.025;
  const silenceFrames = useRef(0);
  const SILENCE_FRAMES_THRESHOLD = 5;
  
  const speechFrames = useRef(0);
  const SPEECH_FRAMES_THRESHOLD = 3;

  const chunkCountRef = useRef(0);

  const cleanupResources = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
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

      audioContextRef.current = new AudioContext();
      console.log('AudioContext created, sample rate:', audioContextRef.current.sampleRate);
      
      sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);

      processorRef.current = audioContextRef.current.createScriptProcessor(4096, 1, 1);

      // Process audio in real-time from microphone
      processorRef.current.onaudioprocess = (event) => {
        if (!isListeningRef.current) return;
        
        const inputData = event.inputBuffer.getChannelData(0);
        
        // Resample from device rate to OpenAI's 24kHz
        const sampleRate = audioContextRef.current?.sampleRate || 44100;
        const resampled = resampleAudio(new Float32Array(inputData), sampleRate, REALTIME_SAMPLE_RATE);
        
        // Calculate volume (RMS) to detect speech
        let sum = 0;
        for (let i = 0; i < resampled.length; i++) {
          sum += resampled[i] * resampled[i];
        }
        const rms = Math.sqrt(sum / resampled.length);
        
        const isSpeakingNow = rms > silenceThreshold;
        
        // Track speech start/stop with hysteresis to avoid flickering
        if (isSpeakingNow) {
          silenceFrames.current = 0;
          speechFrames.current++;
          
          if (!isSpeakingRef.current && speechFrames.current >= SPEECH_FRAMES_THRESHOLD) {
            isSpeakingRef.current = true;
            setIsSpeaking(true);
            onSpeechStartRef.current?.();
          }
        } else {
          speechFrames.current = 0;
          silenceFrames.current++;
          if (isSpeakingRef.current && silenceFrames.current > SILENCE_FRAMES_THRESHOLD) {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
          }
        }

        // Buffer audio until we have enough to send (2400 samples = 100ms at 24kHz)
        audioBufferRef.current.push(resampled);
        bufferSizeRef.current += resampled.length;

        if (bufferSizeRef.current >= TARGET_BUFFER_SIZE) {
          // Combine buffered chunks
          const totalLength = audioBufferRef.current.reduce((s, arr) => s + arr.length, 0);
          const combined = new Float32Array(totalLength);
          let offset = 0;
          for (const buffer of audioBufferRef.current) {
            combined.set(buffer, offset);
            offset += buffer.length;
          }

          // Encode to base64 and send to backend
          const base64 = encodeAudioToBase64(combined);
          chunkCountRef.current++;
          
          if (chunkCountRef.current <= 3 || chunkCountRef.current % 50 === 0) {
            console.log(`Audio chunk #${chunkCountRef.current}, size: ${base64.length}, rms: ${rms.toFixed(4)}`);
          }
          
          onAudioChunkRef.current?.(base64);

          audioBufferRef.current = [];
          bufferSizeRef.current = 0;
        }
      };

      sourceRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

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
