import { WebSocket } from 'ws';
import { RealtimeService } from './realtimeService';
import { logger } from '../utils/logger';
import { WS_CONNECTION_TIMEOUT_MS } from '../utils/constants';

interface WebSocketMessage {
  type: 'audio_chunk' | 'cancel' | 'ping';
  data?: string;
}

function safeSend(ws: WebSocket, message: any): boolean {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  } catch (error: any) {
    logger.error('Error sending WebSocket message', { error: error.message });
    return false;
  }
}

export function handleWebSocketConnection(ws: WebSocket): void {
  let realtimeService: RealtimeService | null = null;
  let connectionTimeout: NodeJS.Timeout | null = null;

  // Timeout if OpenAI connection takes too long
  connectionTimeout = setTimeout(() => {
    logger.warn('WebSocket connection timeout', { timeout: WS_CONNECTION_TIMEOUT_MS });
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1008, 'Connection timeout');
    }
  }, WS_CONNECTION_TIMEOUT_MS);

  logger.info('WebSocket client connected');

  // Initialize connection to OpenAI Realtime API
  (async () => {
    try {
      realtimeService = new RealtimeService(ws, (contact) => {
        logger.info('Contact saved via Realtime API', { contact });
      });

      await realtimeService.connect();

      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }

    } catch (error: any) {
      logger.error('Error initializing Realtime service', { error: error.message });
      safeSend(ws, { type: 'error', data: 'Failed to connect to AI service' });
    }
  })();

  // Handle messages from frontend
  ws.on('message', (message: Buffer) => {
    try {
      const data: WebSocketMessage = JSON.parse(message.toString());

      switch (data.type) {
        case 'ping':
          // Keepalive heartbeat
          safeSend(ws, { type: 'pong' });
          break;

        case 'audio_chunk':
          // Forward user audio to OpenAI
          if (data.data && realtimeService) {
            realtimeService.appendAudio(data.data);
          } else {
            logger.debug('Received audio_chunk but cannot forward', { 
              hasData: !!data.data, 
              hasService: !!realtimeService 
            });
          }
          break;

        case 'cancel':
          // User interrupted AI - cancel current response
          if (realtimeService) {
            realtimeService.cancelResponse();
          }
          break;
      }
    } catch (error: any) {
      logger.error('Error processing WebSocket message', {
        error: error.message,
        stack: error.stack
      });
      safeSend(ws, {
        type: 'error',
        data: 'Failed to process message'
      });
    }
  });

  ws.on('close', () => {
    if (connectionTimeout) {
      clearTimeout(connectionTimeout);
    }
    if (realtimeService) {
      realtimeService.disconnect();
    }
    logger.info('WebSocket client disconnected');
  });

  ws.on('error', (error: Error) => {
    logger.error('WebSocket error', {
      error: error.message,
      stack: error.stack
    });
  });
}
