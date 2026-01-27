import { useCallback, useEffect, useRef, useState } from 'react';
import { CallStatus, Contact } from '../types';
import { 
  decodeBase64ToAudio, 
  REALTIME_SAMPLE_RATE,
  createPlaybackContext,
  resampleAudio
} from '../utils/audioUtils';

interface WebSocketMessage {
  type: string;
  data?: string | Contact;
}

const getWebSocketUrl = (): string => {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = import.meta.env.VITE_WS_PORT || (protocol === 'wss:' ? '' : ':3001');
  
  return `${protocol}//${host}${port}/ws`;
};

const WS_URL = getWebSocketUrl();

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<CallStatus>('idle');
  const [latestAIText, setLatestAIText] = useState<string | null>(null);
  const [savedContact, setSavedContact] = useState<Contact | null>(null);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Float32Array[]>([]);
  const isPlayingRef = useRef(false);
  const nextPlayTimeRef = useRef(0);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const audioChunkPlayCountRef = useRef(0);
  const gainNodeRef = useRef<GainNode | null>(null);
  const stopSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const GAP_RESET_THRESHOLD_SEC = 0.05;
  const FADE_SAMPLES = 128;
  const STOP_SPEAKING_DELAY_MS = 150;
  

  const initAudioContext = useCallback(async () => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = createPlaybackContext();
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
      gainNodeRef.current.gain.value = 1.0;
    }
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  const stopAudio = useCallback(() => {
    if (stopSpeakingTimerRef.current) {
      clearTimeout(stopSpeakingTimerRef.current);
      stopSpeakingTimerRef.current = null;
    }
    scheduledSourcesRef.current.forEach(source => {
      try {
        source.onended = null;
        source.stop();
      } catch (e) {}
    });
    scheduledSourcesRef.current = [];
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;
    audioChunkPlayCountRef.current = 0;
    setIsAISpeaking(false);
  }, []);

  const playAudioChunk = useCallback(async (base64Audio: string) => {
    try {
      const audioContext = await initAudioContext();
      const decodedData = decodeBase64ToAudio(base64Audio);
      
      if (decodedData.length === 0) return;

      const targetRate = audioContext.sampleRate;
      const float32Data = targetRate === REALTIME_SAMPLE_RATE
        ? decodedData
        : resampleAudio(decodedData, REALTIME_SAMPLE_RATE, targetRate);

      const currentTime = audioContext.currentTime;
      if (currentTime > nextPlayTimeRef.current + GAP_RESET_THRESHOLD_SEC) {
        nextPlayTimeRef.current = currentTime;
        audioChunkPlayCountRef.current = 0;
      }

      audioChunkPlayCountRef.current++;

      const isFirstChunk = audioChunkPlayCountRef.current === 1;
      if (isFirstChunk) {
        const fadeSamples = Math.min(FADE_SAMPLES, float32Data.length);
        for (let i = 0; i < fadeSamples; i++) {
          float32Data[i] *= i / fadeSamples;
        }
      }

      const audioBuffer = audioContext.createBuffer(
        1,
        float32Data.length,
        audioContext.sampleRate
      );
      audioBuffer.getChannelData(0).set(float32Data);

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      if (gainNodeRef.current) {
        source.connect(gainNodeRef.current);
      } else {
        source.connect(audioContext.destination);
      }

      const startTime = Math.max(currentTime, nextPlayTimeRef.current);
      
      source.start(startTime);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;
      
      scheduledSourcesRef.current.push(source);
      
      if (stopSpeakingTimerRef.current) {
        clearTimeout(stopSpeakingTimerRef.current);
        stopSpeakingTimerRef.current = null;
      }
      
      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsAISpeaking(true);
      }

      source.onended = () => {
        const index = scheduledSourcesRef.current.indexOf(source);
        if (index > -1) {
          scheduledSourcesRef.current.splice(index, 1);
        }
        
        if (scheduledSourcesRef.current.length === 0) {
          stopSpeakingTimerRef.current = setTimeout(() => {
            if (scheduledSourcesRef.current.length === 0) {
              isPlayingRef.current = false;
              setIsAISpeaking(false);
              setStatus('connected');
            }
          }, STOP_SPEAKING_DELAY_MS);
        }
      };

    } catch (error) {
      console.error('Error playing audio chunk:', error);
    }
  }, [initAudioContext]);

  const handleMessage = useCallback(async (event: MessageEvent) => {
    try {
      const message: WebSocketMessage = JSON.parse(event.data);
      
      switch (message.type) {
        case 'ready':
          setStatus('connected');
          break;
          
        case 'listening':
          stopAudio();
          setStatus('listening');
          break;
          
        case 'processing':
          setStatus('processing');
          break;

        case 'audio_delta':
          if (typeof message.data === 'string') {
            setStatus('speaking');
            await playAudioChunk(message.data);
          }
          break;
          
        case 'text':
          if (typeof message.data === 'string') {
            setLatestAIText(message.data as string);
          }
          break;
          
        case 'transcription':
          break;

        case 'response_done':
          break;
          
        case 'contact_saved':
          if (message.data && typeof message.data === 'object') {
            setSavedContact(message.data as Contact);
          }
          break;
          
        case 'error':
          if (typeof message.data === 'string') {
            console.error('Server error:', message.data);
          }
          setStatus('error');
          setIsAISpeaking(false);
          break;
          
        case 'pong':
          break;
          
        default:
          console.debug('Unhandled message type:', message.type);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  }, [playAudioChunk, stopAudio]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    stopAudio();
    setLatestAIText(null);
    setSavedContact(null);

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = async () => {
      console.log('WebSocket connected');
      await initAudioContext();
      setStatus('connected');
    };

    ws.onmessage = handleMessage;

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setStatus('idle');
      setLatestAIText(null);
      setSavedContact(null);
      setIsAISpeaking(false);
      wsRef.current = null;
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setStatus('error');
      setIsAISpeaking(false);
    };
  }, [handleMessage, initAudioContext, stopAudio]);

  const disconnect = useCallback(() => {
    stopAudio();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setStatus('idle');
      setLatestAIText(null);
      setSavedContact(null);
      setIsAISpeaking(false);
    }
  }, [stopAudio]);

  const sendMessage = useCallback((message: { type: string; data?: string }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const audioChunkCountRef = useRef(0);
  const sendAudioChunk = useCallback((base64Audio: string) => {
    audioChunkCountRef.current++;
    if (audioChunkCountRef.current % 20 === 1) {
      console.log(`Sending audio chunk #${audioChunkCountRef.current}, size: ${base64Audio.length}`);
    }
    sendMessage({ type: 'audio_chunk', data: base64Audio });
  }, [sendMessage]);

  const cancelResponse = useCallback(() => {
    stopAudio();
    sendMessage({ type: 'cancel' });
  }, [sendMessage, stopAudio]);

  useEffect(() => {
    return () => {
      disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    };
  }, [disconnect]);

  return {
    status,
    latestAIText,
    savedContact,
    isAISpeaking,
    connect,
    disconnect,
    sendMessage,
    sendAudioChunk,
    cancelResponse,
    stopAudio
  };
}
