export interface Contact {
  name: string;
  email: string;
  phone: string;
}

// Discriminated union for type-safe WebSocket messages
export type WebSocketMessage =
  | { type: 'text' | 'transcription' | 'error' | 'text_delta'; data: string }
  | { type: 'contact_saved'; data: Contact }
  | { type: 'audio_delta' | 'audio_chunk'; data: string }
  | { type: 'ready' | 'listening' | 'processing' | 'ping' | 'pong' | 'start' | 'end' | 'commit' | 'cancel' | 'response_done' };

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'listening' | 'processing' | 'speaking' | 'error';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}
