import WebSocket from 'ws';
import { Contact } from '../models/Contact';
import { logger } from '../utils/logger';

const REALTIME_API_URL = 'wss://api.openai.com/v1/realtime?model=gpt-realtime';

const SYSTEM_INSTRUCTIONS = `You are a warm, confident voice assistant that collects contact information.

YOUR GOAL: Get these 3 pieces of info from the user:
1. Full name
2. Email address
3. Phone number

STYLE:
- Sound human, not robotic: vary wording, avoid repeating the same sentence.
- Be concise and friendly (1–2 sentences).
- Use natural acknowledgements (e.g., "Thanks!" "Got it." "Perfect.").
- Always respond in English unless the user explicitly asks for another language.

FLOW:
- Ask for ONE piece of info at a time.
- Confirm each piece naturally ("Thanks, I got John Smith.").
- If the user refuses or hesitates, acknowledge it and offer a reason ("Totally okay — it helps me send your confirmation.") then ask a different way once.
- If they still refuse, move on to the next required field and circle back once at the end.
- If they ask why, explain briefly and reassure privacy.
- After saving, thank them and confirm completion.
- Start by greeting and asking for their name.

IMPORTANT FOR EMAIL ADDRESSES:
- Users may say emails without "@" symbol (e.g., "john gmail.com" or "john at gmail.com")
- ALWAYS add "@" symbol automatically when users say emails without it
- Convert "at" word to "@" symbol (e.g., "john at gmail.com" → "john@gmail.com")

IMPORTANT FOR PHONE NUMBERS:
- Users may say phone numbers in words (e.g., "five five five one two three")
- ALWAYS convert spoken number words to digits before saving
- Accept phone numbers in ANY format and convert to digits only`;

const SAVE_CONTACT_TOOL = {
  type: 'function',
  name: 'save_contact',
  description: 'Save contact info to database. Call when you have name, email, AND phone.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Full name' },
      email: { type: 'string', description: 'Email address with @ symbol' },
      phone: { type: 'string', description: 'Phone number as digits only' }
    },
    required: ['name', 'email', 'phone']
  }
};

interface RealtimeSession {
  openaiWs: WebSocket | null;
  isConnected: boolean;
  hasGreeted: boolean;
}

export class RealtimeService {
  private session: RealtimeSession = {
    openaiWs: null,
    isConnected: false,
    hasGreeted: false
  };

  private clientWs: WebSocket;
  private onContactSaved?: (contact: { name: string; email: string; phone: string }) => void;

  constructor(
    clientWs: WebSocket, 
    onContactSaved?: (contact: { name: string; email: string; phone: string }) => void
  ) {
    this.clientWs = clientWs;
    this.onContactSaved = onContactSaved;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        reject(new Error('OPENAI_API_KEY is required'));
        return;
      }

      logger.info('Connecting to OpenAI Realtime API...');

      this.session.openaiWs = new WebSocket(REALTIME_API_URL, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        }
      });

      this.session.openaiWs.on('open', () => {
        logger.info('Connected to OpenAI Realtime API');
        this.session.isConnected = true;
        this.configureSession();
        resolve();
      });

      this.session.openaiWs.on('message', (data: Buffer) => {
        this.handleOpenAIMessage(data);
      });

      this.session.openaiWs.on('error', (error) => {
        logger.error('OpenAI WebSocket error', { error: error.message });
        this.sendToClient({ type: 'error', data: 'Connection to AI failed' });
        reject(error);
      });

      this.session.openaiWs.on('close', () => {
        logger.info('OpenAI WebSocket closed');
        this.session.isConnected = false;
      });
    });
  }

  private configureSession(): void {
    if (!this.session.openaiWs) return;

    const sessionConfig = {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: SYSTEM_INSTRUCTIONS,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: 24000
            },
            transcription: {
              model: 'whisper-1'
            },
            turn_detection: {
              type: 'semantic_vad'
            }
          },
          output: {
            format: {
              type: 'audio/pcm',
              rate: 24000
            },
            voice: 'marin'
          }
        },
        tools: [SAVE_CONTACT_TOOL],
        tool_choice: 'auto'
      }
    };

    this.session.openaiWs.send(JSON.stringify(sessionConfig));
  }

  private handleOpenAIMessage(data: Buffer): void {
    try {
      const event = JSON.parse(data.toString());
      
      switch (event.type) {
        case 'session.created':
          logger.info('Realtime session created');
          break;

        case 'response.created':
          logger.debug('Response started');
          this.isResponseActive = true;
          this.lastResponseItemId = null;
          break;

        case 'session.updated':
          logger.info('Realtime session configured');
          if (!this.session.hasGreeted) {
            this.sendInitialGreeting();
          }
          break;

        case 'input_audio_buffer.speech_started':
          logger.debug('User speech started');
          this.sendToClient({ type: 'listening' });
          break;

        case 'input_audio_buffer.speech_stopped':
          logger.debug('User speech stopped');
          this.sendToClient({ type: 'processing' });
          break;

        case 'response.output_audio.delta':
          if (event.delta) {
            if (event.item_id && !this.lastResponseItemId) {
              this.lastResponseItemId = event.item_id;
            }
            this.sendToClient({
              type: 'audio_delta',
              data: event.delta
            });
          }
          break;

        case 'response.output_audio.done':
          logger.debug('Audio response complete');
          break;

        case 'response.output_audio_transcript.done':
          if (event.transcript) {
            this.sendToClient({
              type: 'text',
              data: event.transcript
            });
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          if (event.transcript) {
            this.sendToClient({
              type: 'transcription',
              data: event.transcript
            });
          }
          break;

        case 'response.done':
          logger.debug('Response complete');
          this.isResponseActive = false;
          this.sendToClient({ type: 'response_done' });
          break;

        case 'response.output_item.done':
          if (event.item?.type === 'function_call') {
            this.handleFunctionCall(event.item);
          }
          break;

        case 'error':
          logger.error('OpenAI Realtime error', { error: event.error });
          this.sendToClient({ type: 'error', data: event.error?.message || 'AI error' });
          break;

        default:
          if (event.type && !event.type.includes('delta')) {
            logger.debug('Unhandled event type', { type: event.type });
          }
      }
    } catch (error: any) {
      logger.error('Error parsing OpenAI message', { error: error.message });
    }
  }

  private async sendInitialGreeting(): Promise<void> {
    if (!this.session.openaiWs || this.session.hasGreeted) return;

    this.session.hasGreeted = true;

    const responseCreate = {
      type: 'response.create',
      response: {
        input: [],
        instructions: `Greet warmly in one short sentence, then ask for their name in a second short sentence. Sound natural and upbeat, avoid robotic phrasing. Example: "Hey there — thanks for calling! What name should I put this under?"`
      }
    };

    this.session.openaiWs.send(JSON.stringify(responseCreate));
    
    this.sendToClient({ type: 'ready' });
  }

  private async handleFunctionCall(item: any): Promise<void> {
    if (!this.session.openaiWs) return;

    if (item.name === 'save_contact') {
      try {
        const args = JSON.parse(item.arguments);
        const savedContact = await this.saveContact(args);

        const resultEvent = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: item.call_id,
            output: JSON.stringify({ success: true })
          }
        };

        this.session.openaiWs.send(JSON.stringify(resultEvent));

        this.session.openaiWs.send(JSON.stringify({ type: 'response.create' }));

        this.sendToClient({
          type: 'contact_saved',
          data: savedContact
        });

        if (this.onContactSaved) {
          this.onContactSaved(savedContact);
        }

      } catch (error: any) {
        logger.error('Error handling function call', { error: error.message });
        
        const errorEvent = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: item.call_id,
            output: JSON.stringify({ success: false, error: error.message })
          }
        };

        this.session.openaiWs.send(JSON.stringify(errorEvent));
        this.session.openaiWs.send(JSON.stringify({ type: 'response.create' }));
      }
    }
  }

  private normalizeEmail(email: string): string {
    let normalized = email.trim().toLowerCase();
    normalized = normalized.replace(/\bat\b/gi, '@');
    
    if (!normalized.includes('@')) {
      const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
      for (const domain of domains) {
        if (normalized.includes(domain)) {
          normalized = normalized.replace(domain, `@${domain}`);
          break;
        }
      }
      
      if (!normalized.includes('@')) {
        const parts = normalized.split(/\s+/);
        if (parts.length >= 2) {
          normalized = parts.slice(0, -1).join('') + '@' + parts[parts.length - 1];
        }
      }
    }
    
    return normalized;
  }

  private convertWordsToDigits(text: string): string {
    const wordToDigit: { [key: string]: string } = {
      'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
      'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'
    };

    let result = text.toLowerCase();
    for (const [word, digit] of Object.entries(wordToDigit)) {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      result = result.replace(regex, digit);
    }
    
    return result.replace(/\D/g, '');
  }

  private async saveContact(data: { name: string; email: string; phone: string }): Promise<{ name: string; email: string; phone: string }> {
    const normalizedEmail = this.normalizeEmail(data.email);
    const cleanedPhone = this.convertWordsToDigits(data.phone);

    const contact = new Contact({
      name: data.name.trim(),
      email: normalizedEmail,
      phone: cleanedPhone
    });

    await contact.save();
    
    logger.info('Contact saved to database', {
      name: data.name,
      email: normalizedEmail,
      phone: cleanedPhone
    });

    return {
      name: data.name.trim(),
      email: normalizedEmail,
      phone: cleanedPhone
    };
  }

  private audioChunkCount = 0;

  appendAudio(base64Audio: string): void {
    if (!this.session.openaiWs || !this.session.isConnected) {
      logger.debug('Cannot append audio - not connected');
      return;
    }

    this.audioChunkCount++;
    if (this.audioChunkCount % 10 === 1) {
      logger.debug('Sending audio chunk to OpenAI', { 
        chunkNumber: this.audioChunkCount,
        dataLength: base64Audio.length 
      });
    }

    const event = {
      type: 'input_audio_buffer.append',
      audio: base64Audio
    };

    this.session.openaiWs.send(JSON.stringify(event));
  }

  private isResponseActive = false;
  private lastResponseItemId: string | null = null;

  cancelResponse(): void {
    if (!this.session.openaiWs || !this.session.isConnected) return;
    
    if (this.isResponseActive) {
      logger.debug('Canceling active response');
      this.session.openaiWs.send(JSON.stringify({ 
        type: 'response.cancel' 
      }));
      
      if (this.lastResponseItemId) {
        this.session.openaiWs.send(JSON.stringify({
          type: 'conversation.item.truncate',
          item_id: this.lastResponseItemId,
          content_index: 0,
          audio_end_ms: 0
        }));
      }
    }
  }

  private sendToClient(message: any): void {
    try {
      if (this.clientWs.readyState === WebSocket.OPEN) {
        this.clientWs.send(JSON.stringify(message));
      }
    } catch (error: any) {
      logger.error('Error sending to client', { error: error.message });
    }
  }

  disconnect(): void {
    if (this.session.openaiWs) {
      this.session.openaiWs.close();
      this.session.openaiWs = null;
    }
    this.session.isConnected = false;
    this.session.hasGreeted = false;
  }
}
