import { CallStatus } from '../types';
import './CallButton.css';

interface CallButtonProps {
  status: CallStatus;
  isListening: boolean;
  isSpeaking: boolean;
  isAISpeaking: boolean;
  onStartCall: () => void;
  onEndCall: () => void;
}

export function CallButton({
  status,
  isListening,
  isSpeaking,
  isAISpeaking,
  onStartCall,
  onEndCall
}: CallButtonProps) {
  const isConnected = status !== 'idle' && status !== 'connecting' && status !== 'error';

  const handleClick = () => {
    if (status === 'idle' || status === 'error') {
      onStartCall();
    } else {
      onEndCall();
    }
  };

  const getButtonClass = () => {
    if (status === 'connecting') return 'connecting';
    if (isAISpeaking) return 'speaking';
    if (isSpeaking) return 'user-speaking';
    if (isConnected && isListening) return 'listening';
    if (isConnected) return 'connected';
    return '';
  };

  const getButtonText = () => {
    if (status === 'connecting') return 'Connecting...';
    if (status === 'idle' || status === 'error') return 'Start Call';
    return 'End Call';
  };

  const isLoading = status === 'connecting';

  const getIcon = () => {
    if (isConnected) {
      // End call icon
      return (
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.68-1.36-2.66-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
        </svg>
      );
    }
    // Start call icon
    return (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
      </svg>
    );
  };

  return (
    <div className="call-controls">
      <button 
        className={`call-button ${isConnected ? 'active' : ''} ${getButtonClass()}`}
        onClick={handleClick}
        disabled={isLoading}
        aria-label={getButtonText()}
        aria-busy={isLoading}
      >
        {isLoading && (
          <div className="loading-spinner" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="50" strokeDashoffset="25" opacity="0.5">
                <animate attributeName="stroke-dasharray" values="0 50;50 0;0 50" dur="1s" repeatCount="indefinite" />
                <animate attributeName="stroke-dashoffset" values="0;-25;-50" dur="1s" repeatCount="indefinite" />
              </circle>
            </svg>
          </div>
        )}
        <div className="button-icon">
          {getIcon()}
        </div>
        <span className="button-text">{getButtonText()}</span>
        
        {/* Animated rings for visual feedback */}
        {isConnected && !isLoading && (
          <div className="pulse-rings">
            <div className="ring ring-1"></div>
            <div className="ring ring-2"></div>
            <div className="ring ring-3"></div>
          </div>
        )}
      </button>
      {status === 'error' && (
        <div className="error-message" role="alert">
          Connection error. Please try again.
        </div>
      )}
    </div>
  );
}
