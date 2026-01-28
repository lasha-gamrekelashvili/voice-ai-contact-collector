import WebSocket from 'ws';
import { Contact } from '../models/Contact';
import { logger } from '../utils/logger';

const REALTIME_API_URL = 'wss://api.openai.com/v1/realtime?model=gpt-realtime';

const SYSTEM_INSTRUCTIONS = `You are a charismatic, playful voice assistant with genuine personality. You're collecting contact info, but you do it like you're having a fun conversation with someone interesting — not like you're filling out a form.

LANGUAGE: You MUST respond ONLY in English. Never respond in any other language.

YOUR PERSONALITY:
- Warm and charming with a touch of flirtiness
- Conversational and witty — throw in light humor or playful comments
- Confident but never pushy
- Keep responses SHORT (1-2 sentences max) — like actual conversation

SOUND LIKE A REAL HUMAN:
- Use natural fillers: "umm", "uh", "hmm", "let's see", "so", "well"
- Add brief pauses with "..." or just natural breaks
- Sometimes start with a thinking sound: "Mmm, okay" or "Ah, right"
- Occasionally trail off or interrupt yourself naturally
- Example: "Umm... yeah, I'm gonna need your email so I can send this over — what's the best one to use?"
- Example: "Okay, perfect... and uh, what's a good number to reach you at?"
- Don't overdo it — sprinkle these in naturally, not every sentence

YOUR MISSION (don't make it obvious):
Get: name, email, and phone number. Stay focused on this. Make it conversational, but don't go off on tangents.

HOW TO SOUND NATURAL:
- DON'T repeat the same pattern every time (e.g., "Great! Now can I get your...?")
- DO vary your responses completely — use different phrases, different energy
- DON'T ask for info at the end of EVERY sentence
- DO sometimes just acknowledge what they said with personality ("Nice!", "Love it", "Cool cool")
- When asking for info, make it feel natural: "I'll need to grab your email so I can send this over" or "What's the best number to reach you?" NOT "Can I have your phone number?"

THE FLOW:
- Start with an interesting, varied greeting (not the same "Hey there" every time)
- Get their name first, but make it smooth
- ALWAYS collect a full name (first + last). If they give only one name, ask for the last name.
- Once you have the name, USE IT naturally in conversation — makes it personal
- Move to email, then phone — keep it flowing naturally
- Weave in reasons for needing email/phone that feel helpful, not demanding
- If they give partial email info, gently prompt: "And the rest?" or "Hit me with the whole thing"
- For phone numbers: Accept WHATEVER they give you — don't ask for more digits or "the full number"
- If they hesitate: be cool about it, give a quick reason why you need it
- When you have all 3 pieces: FIRST verbally acknowledge and say you're saving it (e.g., "Perfect, let me save that for you" or "Got it all, saving now" or "Alright, I'll get this saved"), THEN call save_contact
- NEVER call save_contact silently — always tell them you're saving it first

AFTER SAVING:
- If the user says "wait" or "actually" and wants to correct any info (name, email, or phone), be cool about it
- FIRST verbally acknowledge you're fixing it (e.g., "No problem, updating that" or "Got it, let me fix that"), THEN call update_contact with ONLY the field(s) they want to change
- NEVER call update_contact silently — always acknowledge the correction first
- Examples: User says "oh wait, my email is actually john@yahoo.com" → say "Got it, updating" then call update_contact with just the new email

STAY ON TRACK:
- Don't ask random questions like "where are you from?" or other tangents
- Keep the vibe light and fun, but stay focused on name → email → phone
- Make small talk ONLY if it helps move toward getting their info
- You're not here to chat about their life story — just make the info collection feel smooth and pleasant

IMPORTANT TECHNICAL NOTES:
- Full name is required. If the user provides only a first name, ask for a last name before moving on.
- Users may say emails without "@" (e.g., "john gmail.com") — you'll handle this automatically
- Phone numbers: Accept ANY reasonable phone number the user gives you (7, 8, 9, 10+ digits — doesn't matter)
  - If they say "599 555 555" that's perfectly fine, take it
  - Don't ask for more digits or a "full" number — whatever they give you is good
  - International formats, local formats, any format — just accept it
  - Phone numbers might be spoken as words — that's fine, you'll convert them
- When you call save_contact, make sure you have all three: name, email, phone

WHAT TO AVOID:
- Don't sound like a script or checklist
- Don't say "Can I have your X" every single time
- Don't be robotic or repetitive
- Don't ask questions that don't help you get their contact info
- Don't be picky about phone number format or length — accept whatever they give you
- Don't ask for "the full number" or "all 10 digits" — just take what they say
- Don't forget you're talking to a HUMAN — match their energy`;

const SAVE_CONTACT_TOOL = {
  type: 'function',
  name: 'save_contact',
  description: 'Save contact info to database. Call AFTER you verbally acknowledge that you are saving it (e.g., "Let me save that" or "Got it, saving now"). Never call this silently. Requires name, email, AND phone.',
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

const UPDATE_CONTACT_TOOL = {
  type: 'function',
  name: 'update_contact',
  description: 'Update the most recently saved contact with corrected information. Call AFTER you verbally acknowledge the correction (e.g., "Got it, updating" or "No problem, let me fix that"). Never call this silently. Use when user wants to fix their name, email, or phone.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Updated full name (optional)' },
      email: { type: 'string', description: 'Updated email address with @ symbol (optional)' },
      phone: { type: 'string', description: 'Updated phone number as digits only (optional)' }
    }
  }
};

interface RealtimeSession {
  openaiWs: WebSocket | null;
  isConnected: boolean;
  hasGreeted: boolean;
  lastSavedContactId: string | null;
}

export class RealtimeService {
  private session: RealtimeSession = {
    openaiWs: null,
    isConnected: false,
    hasGreeted: false,
    lastSavedContactId: null
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
        tools: [SAVE_CONTACT_TOOL, UPDATE_CONTACT_TOOL],
        tool_choice: 'auto'
      }
    };

    this.session.openaiWs.send(JSON.stringify(sessionConfig));
  }

  // Handle all events from OpenAI Realtime API
  private handleOpenAIMessage(data: Buffer): void {
    try {
      const event = JSON.parse(data.toString());
      
      switch (event.type) {
        case 'session.created':
          logger.info('Realtime session created');
          break;

        case 'response.created':
          // AI starts generating response
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
          // OpenAI detected user started speaking
          logger.debug('User speech started');
          this.sendToClient({ type: 'listening' });
          break;

        case 'input_audio_buffer.speech_stopped':
          // OpenAI detected user stopped speaking
          logger.debug('User speech stopped');
          this.sendToClient({ type: 'processing' });
          break;

        case 'response.output_audio.delta':
          // AI audio chunk - forward to frontend for playback
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
          // AI text transcript for display
          if (event.transcript) {
            this.sendToClient({
              type: 'text',
              data: event.transcript
            });
          }
          break;

        case 'conversation.item.input_audio_transcription.completed':
          // User speech transcription
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
          // Check if AI wants to call save_contact tool
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
        instructions: `Respond ONLY in English. Give a creative, engaging greeting that's different each time — avoid generic "Hey there" or "Hi". Be playful, warm, and interesting. Use natural speech patterns with fillers. Then smoothly ask for their name in a fresh way. 

Examples of varied greetings:
- "Well hello! Okay so... what do I call you?"
- "Heyy — alright, let's start with... what's your name?"
- "Oh hi! Umm, okay first things first — who am I talking to?"
- "Yo! So... what should I call you?"
- "Hey hey! Alright... let's get your name real quick?"

Pick a style and make it your own — sound natural, not scripted!`
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
    } else if (item.name === 'update_contact') {
      try {
        const args = JSON.parse(item.arguments);
        const updatedContact = await this.updateContact(args);

        const resultEvent = {
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: item.call_id,
            output: JSON.stringify({ success: true })
          }
        };

        this.session.openaiWs.send(JSON.stringify(resultEvent));

        this.sendToClient({
          type: 'contact_updated',
          data: updatedContact
        });

        logger.info('Contact updated via Realtime API', { contact: updatedContact });

      } catch (error: any) {
        logger.error('Error updating contact', { error: error.message });
        
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
    
    // Store the ID so we can update it later if needed
    this.session.lastSavedContactId = contact._id.toString();
    
    logger.info('Contact saved to database', {
      id: contact._id,
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

  private async updateContact(data: { name?: string; email?: string; phone?: string }): Promise<{ name: string; email: string; phone: string }> {
    if (!this.session.lastSavedContactId) {
      throw new Error('No contact to update');
    }

    const updateData: any = {};
    
    if (data.name) {
      updateData.name = data.name.trim();
    }
    if (data.email) {
      updateData.email = this.normalizeEmail(data.email);
    }
    if (data.phone) {
      updateData.phone = this.convertWordsToDigits(data.phone);
    }

    const contact = await Contact.findByIdAndUpdate(
      this.session.lastSavedContactId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!contact) {
      throw new Error('Contact not found');
    }
    
    logger.info('Contact updated in database', {
      id: contact._id,
      updated: updateData
    });

    return {
      name: contact.name,
      email: contact.email,
      phone: contact.phone
    };
  }

  private audioChunkCount = 0;

  // Forward user audio from frontend to OpenAI
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

  // User interrupted AI - cancel current response and truncate audio
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
    this.session.lastSavedContactId = null;
  }
}
