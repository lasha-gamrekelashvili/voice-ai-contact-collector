import { useCallback, useEffect, useRef } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useRealtimeAudio } from './hooks/useRealtimeAudio';
import { CallButton } from './components/CallButton';
import { AICaption } from './components/AICaption';
import { ContactSaved } from './components/ContactSaved';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CONNECTION_READY_DELAY } from './utils/constants';
import './App.css';

function App() {
  const { 
    status, 
    latestAIText, 
    savedContact, 
    isAISpeaking,
    connect, 
    disconnect, 
    sendAudioChunk,
    cancelResponse,
    stopAudio
  } = useWebSocket();

  const isCallActive = status !== 'idle' && status !== 'error';
  
  const isAISpeakingRef = useRef(isAISpeaking);
  const isCallActiveRef = useRef(isCallActive);
  const sendAudioChunkRef = useRef(sendAudioChunk);
  const cancelResponseRef = useRef(cancelResponse);
  const stopAudioRef = useRef(stopAudio);

  useEffect(() => {
    isAISpeakingRef.current = isAISpeaking;
  }, [isAISpeaking]);

  useEffect(() => {
    isCallActiveRef.current = isCallActive;
  }, [isCallActive]);

  useEffect(() => {
    sendAudioChunkRef.current = sendAudioChunk;
  }, [sendAudioChunk]);

  useEffect(() => {
    cancelResponseRef.current = cancelResponse;
  }, [cancelResponse]);

  useEffect(() => {
    stopAudioRef.current = stopAudio;
  }, [stopAudio]);

  const handleAudioChunk = useCallback((base64Audio: string) => {
    if (isCallActiveRef.current) {
      sendAudioChunkRef.current(base64Audio);
    }
  }, []);

  const handleSpeechStart = useCallback(() => {
    if (isAISpeakingRef.current) {
      console.log('User interrupted AI - canceling response');
      cancelResponseRef.current();
      stopAudioRef.current();
    }
  }, []);

  const { 
    isListening, 
    isSpeaking, 
    startListening, 
    stopListening
  } = useRealtimeAudio({
    onAudioChunk: handleAudioChunk,
    onSpeechStart: handleSpeechStart,
    enabled: false
  });

  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (status === 'connected' && !hasStartedRef.current) {
      console.log('Connected - will start audio capture after delay...');
      hasStartedRef.current = true;
      
      startTimerRef.current = setTimeout(() => {
        console.log('Starting audio capture now');
        startListening()
          .then(() => console.log('Audio capture started successfully'))
          .catch(err => console.error('Failed to start listening:', err));
      }, CONNECTION_READY_DELAY);
    }
    
  }, [status, startListening]);

  useEffect(() => {
    if (status === 'idle') {
      hasStartedRef.current = false;
      if (startTimerRef.current) {
        clearTimeout(startTimerRef.current);
        startTimerRef.current = null;
      }
    }
  }, [status]);

  useEffect(() => {
    return () => {
      if (startTimerRef.current) {
        clearTimeout(startTimerRef.current);
      }
    };
  }, []);

  const handleStartCall = useCallback(() => {
    connect();
  }, [connect]);

  const handleEndCall = useCallback(() => {
    hasStartedRef.current = false;
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    stopListening();
    stopAudio();
    disconnect();
  }, [stopListening, stopAudio, disconnect]);

  const hasAISpokenRef = useRef(false);

  useEffect(() => {
    if (isAISpeaking) {
      hasAISpokenRef.current = true;
    }
    if (status === 'idle') {
      hasAISpokenRef.current = false;
    }
  }, [isAISpeaking, status]);

  const getStatusText = () => {
    if (status === 'connecting') return 'Connecting...';
    if (isAISpeaking && isSpeaking) return 'Interrupting...';
    if (isAISpeaking) return 'AI speaking...';
    if (isSpeaking) return 'Listening...';
    if (!hasAISpokenRef.current && status === 'connected') return 'Starting...';
    if (status === 'connected' && isListening) return 'Your turn...';
    return 'Ready';
  };

  return (
    <ErrorBoundary>
      <div className="app">
        <div className="container">
          <main className="main-content">
            {savedContact && <ContactSaved contact={savedContact} />}
            
            <AICaption text={latestAIText} isVisible={isCallActive} />

            {isCallActive && (
              <div className="status-indicator">
                <div className={`status-dot ${
                  isSpeaking ? 'user-speaking' : 
                  isAISpeaking ? 'speaking' : 
                  !hasAISpokenRef.current ? 'connecting' :
                  isListening ? 'listening' : 
                  status
                }`}></div>
                <span>{getStatusText()}</span>
              </div>
            )}
            
            <CallButton
              status={status}
              isListening={isListening}
              isSpeaking={isSpeaking}
              isAISpeaking={isAISpeaking}
              onStartCall={handleStartCall}
              onEndCall={handleEndCall}
            />
          </main>

        </div>
      </div>
    </ErrorBoundary>
  );
}

export default App;
