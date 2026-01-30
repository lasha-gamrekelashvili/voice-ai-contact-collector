# Voice AI Contact Collector — Step-by-Step Flow & Interview Q&A

This document walks through the flow in plain language and answers common questions so you can explain the system clearly.

---

## High-level flow (one paragraph)

The user clicks **Start Call** in the browser. The frontend opens a WebSocket to the backend. The backend opens a second WebSocket to **OpenAI’s Realtime API** and configures a voice session (instructions, tools, 24 kHz audio). Once the session is ready, the backend sends a **ready** message to the frontend. After a short delay (500 ms), the frontend starts capturing the microphone, resampling to 24 kHz, buffering ~50 ms chunks (low latency), encoding to base64, and sending them over the WebSocket as **audio_chunk** messages. The backend forwards these to OpenAI via **input_audio_buffer.append**. OpenAI transcribes with Whisper, runs the conversation with GPT, and streams back audio and text. When the AI has name, email, and phone, it calls the **save_contact** tool; the backend saves the contact in MongoDB and sends **contact_saved** to the frontend so the UI can show the saved contact. The user can end the call anytime; the frontend stops the mic and closes the WebSocket, and the backend closes the OpenAI connection.

---

## Step-by-step flow

### 1. User starts the call

- User clicks **Start Call** in `CallButton`.
- `App` calls `connect()` from `useWebSocket`.
- `useWebSocket` creates a new `WebSocket(WS_URL)` (e.g. `ws://localhost:3001/ws`).
- Status becomes **connecting**; when the socket opens, status becomes **connected** (and `useWebSocket` also waits for **ready** from the backend before treating the session as fully ready).

### 2. Backend accepts the WebSocket

- Express HTTP server has a `WebSocketServer` on path `/ws`.
- On connection, `handleWebSocketConnection(ws)` runs.
- A 60-second timeout is started; if the OpenAI connection doesn’t complete in time, the client WebSocket is closed.
- `RealtimeService` is created with the client `ws` and an optional `onContactSaved` callback.
- `realtimeService.connect()` is called (async).

### 3. Backend connects to OpenAI Realtime API

- `RealtimeService` opens a WebSocket to `wss://api.openai.com/v1/realtime?model=gpt-realtime` with `Authorization: Bearer OPENAI_API_KEY`.
- On open, it sends **session.update** with:
  - System instructions (personality, flow: name → email → phone, tools usage).
  - Audio: input/output PCM, 24 kHz, Whisper transcription, semantic VAD for turn detection.
  - Tools: `save_contact` (name, email, phone) and `update_contact` (optional name/email/phone).
- OpenAI responds with **session.created** and **session.updated**.

### 4. Backend sends initial greeting and “ready”

- On **session.updated**, the backend calls `sendInitialGreeting()` (only once per session).
- It sends **response.create** to OpenAI with instructions to greet and ask for the user’s name.
- It sends **{ type: 'ready' }** to the frontend over the client WebSocket.
- The connection timeout is cleared.

### 5. Frontend starts capturing microphone

- When status is **connected** and the frontend has received **ready**, after `CONNECTION_READY_DELAY` (500 ms) the app calls `startListening()` from `useRealtimeAudio`.
- `useRealtimeAudio`:
  - Requests microphone via `navigator.mediaDevices.getUserMedia({ audio })`.
  - Creates an `AudioContext`, loads the **AudioWorklet** from `public/audio-processor.worklet.js` via `addModule()`, and creates an `AudioWorkletNode` (worklet buffers 2400 samples at device rate, ~50 ms, and posts to the main thread).
  - On each `port.onmessage`: resamples the 2400-sample chunk from the device sample rate to **24 kHz** (OpenAI’s rate), buffers until **1200 samples** (~50 ms at 24 kHz), encodes to base64, and calls `onAudioChunk(base64)`.
- In `App`, `handleAudioChunk` only forwards chunks when the call is active; it calls `sendAudioChunk(base64)` from `useWebSocket`.
- `useWebSocket` sends **{ type: 'audio_chunk', data: base64 }** over the WebSocket.

### 6. Backend forwards audio to OpenAI

- `handleWebSocketConnection` receives the message and, for `type === 'audio_chunk'`, calls `realtimeService.appendAudio(data.data)`.
- `RealtimeService.appendAudio()` sends **input_audio_buffer.append** with the base64 audio to the OpenAI WebSocket.
- OpenAI buffers the audio, runs **semantic VAD** (voice activity detection), and can transcribe with Whisper.

### 7. Speech and processing states

- When OpenAI detects **speech start**: it emits **input_audio_buffer.speech_started**. The backend sends **{ type: 'listening' }** to the frontend. The frontend stops any AI playback (`stopAudio`) and sets status to **listening**.
- When the user stops speaking: OpenAI sends **input_audio_buffer.speech_stopped**. The backend sends **{ type: 'processing' }** and the frontend shows **processing**.

### 8. AI response (audio + text)

- OpenAI generates a response (text → TTS) and streams **response.output_audio.delta** (base64 PCM).
- Backend forwards each delta as **{ type: 'audio_delta', data: base64 }**.
- Frontend `useWebSocket` decodes base64, resamples to the device sample rate if needed, and plays chunks via `AudioContext` (scheduled one after another). It sets **isAISpeaking** and status **speaking**.
- When the transcript is ready, OpenAI sends **response.output_audio_transcript.done**. Backend sends **{ type: 'text', data: transcript }**. Frontend sets **latestAIText** and shows it in **AICaption**.
- When the response finishes, OpenAI sends **response.done**. After the last audio chunk plus a short delay (150 ms), the frontend sets **isAISpeaking** to false.

### 9. Saving a contact (tool call)

- When the model has collected name, email, and phone, it calls the **save_contact** tool.
- OpenAI sends **response.output_item.done** with `item.type === 'function_call'` and the tool name/arguments.
- `RealtimeService.handleFunctionCall()`:
  - Parses arguments (name, email, phone).
  - Normalizes email (e.g. “john gmail.com” → “john@gmail.com”) and phone (e.g. words → digits).
  - Creates a **Contact** (Mongoose model) and saves to **MongoDB**.
  - Stores **lastSavedContactId** for possible **update_contact** later.
  - Sends **conversation.item.create** with **function_call_output** (success) back to OpenAI.
  - Sends **{ type: 'contact_saved', data: contact }** to the frontend.
- Frontend sets **savedContact** and shows the **ContactSaved** component.

### 10. Updating a contact (corrections)

- If the user says “wait, my email is X”, the AI can call **update_contact** with only the changed fields.
- Backend uses **lastSavedContactId** to run **Contact.findByIdAndUpdate** with the new name/email/phone (normalized).
- Backend sends **function_call_output** to OpenAI and **{ type: 'contact_updated', data: contact }** to the frontend.
- Frontend updates **savedContact** and the UI.

### 11. Interrupting the AI (optional)

- If the user speaks while the AI is talking, the frontend can call **cancelResponse()** (or at least **stopAudio()**).
- **cancelResponse** sends **{ type: 'cancel' }** to the backend. Backend calls **realtimeService.cancelResponse()**, which sends **response.cancel** (and optionally **conversation.item.truncate**) to OpenAI so the current response stops.

### 12. Ending the call

- User clicks **End Call**. App calls `stopListening()`, `stopAudio()`, `disconnect()`.
- **stopListening** releases the microphone and cleans up `AudioContext` and the AudioWorklet node.
- **disconnect** closes the client WebSocket.
- Backend’s `ws.on('close')` runs: it clears the connection timeout and calls **realtimeService.disconnect()**, which closes the OpenAI WebSocket and resets session state (e.g. **lastSavedContactId**, **hasGreeted**).

---

## Interview-style Q&A

**Q: What happens when the user clicks “Start Call”?**  
They trigger `connect()` in `useWebSocket`, which opens a WebSocket to the backend. The backend creates a `RealtimeService`, connects to the OpenAI Realtime API, configures the session (instructions + tools + 24 kHz audio), sends an initial greeting to the model, and sends **ready** to the frontend. After 500 ms, the frontend starts the microphone and begins sending base64 audio chunks over the WebSocket.

**Q: How does user audio get from the browser to OpenAI?**  
The frontend uses `useRealtimeAudio`: it captures mic input with `getUserMedia`, runs an **AudioWorklet** (in `public/audio-processor.worklet.js`) that buffers 2400 samples at device rate (~50 ms) and posts to the main thread; the main thread resamples to 24 kHz, buffers ~50 ms (1200 samples), encodes to base64, and passes chunks to `useWebSocket`, which sends **audio_chunk** messages. The backend’s `RealtimeService` receives these and forwards them to OpenAI via **input_audio_buffer.append**.

**Q: Why 24 kHz?**  
OpenAI’s Realtime API expects PCM audio at 24 kHz. The frontend resamples from the device rate to 24 kHz before sending; the backend passes the base64 through. AI output is also 24 kHz; the frontend resamples to the device rate for playback.

**Q: How does the AI “hear” and “speak”?**  
It “hears” via the audio we send with **input_audio_buffer.append**. It “speaks” by streaming **response.output_audio.delta** (base64 PCM). The backend forwards these deltas to the frontend as **audio_delta**; the frontend decodes, resamples if needed, and plays them with the Web Audio API.

**Q: Where is the conversation logic (name, email, phone)?**  
In the **system instructions** and **tools** sent in **session.update**. The instructions tell the model to collect full name, then email, then phone, and to call **save_contact** only when all three are collected (and to say out loud that it’s saving). The tools are `save_contact` and `update_contact`; the backend executes them and returns results to the model.

**Q: How is a contact actually saved?**  
When the model calls **save_contact**, the backend receives **response.output_item.done** with a function_call. It parses the arguments, normalizes email and phone, creates a Mongoose **Contact** document, and calls **contact.save()**. It then sends **function_call_output** to OpenAI and **contact_saved** (with the contact payload) to the frontend.

**Q: What if the user corrects their info?**  
The model can call **update_contact** with only the changed fields. The backend uses **lastSavedContactId** (set when saving) to run **Contact.findByIdAndUpdate**, then sends **contact_updated** to the frontend so the UI updates.

**Q: What’s the role of the backend? Why not connect the browser directly to OpenAI?**  
The backend (1) keeps **OPENAI_API_KEY** on the server, (2) runs tool logic (save/update contact, database access), (3) can enforce limits (e.g. max WebSocket connections, timeouts), and (4) provides a single client-facing WebSocket while managing the separate OpenAI WebSocket and session lifecycle.

**Q: How is “user is speaking” vs “AI is speaking” handled?**  
OpenAI sends **input_audio_buffer.speech_started** / **speech_stopped** (semantic VAD). The backend forwards these as **listening** / **processing**. The frontend also has local VAD in `useRealtimeAudio` (RMS + hysteresis) for UI (e.g. “Your turn” / “Interrupting”). When **listening** is received, the frontend calls **stopAudio()** so the user doesn’t hear the AI while they talk.

**Q: What happens on “End Call”?**  
The frontend stops the mic (`stopListening`), stops playback (`stopAudio`), and closes the WebSocket (`disconnect`). The backend’s `close` handler runs, clearing the connection timeout and calling **realtimeService.disconnect()**, which closes the OpenAI WebSocket and resets session state.

**Q: What’s the 500 ms delay before starting the mic?**  
`CONNECTION_READY_DELAY` (500 ms) gives the backend time to finish configuring the OpenAI session and sending the first greeting before the user’s audio starts flowing, so the first words aren’t lost and the session is fully ready.

**Q: How are errors surfaced?**  
Backend sends **{ type: 'error', data: message }** (e.g. “Failed to connect to AI service”, “Connection to AI failed”). Frontend sets status to **error** and shows “Connection error. Please try again.” next to the call button. OpenAI API errors are also forwarded as **error** messages to the client.

---

## File reference (where things live)

| What | Where |
|------|--------|
| Call button, start/end handlers | `frontend/src/App.tsx`, `frontend/src/components/CallButton.tsx` |
| WebSocket connect, send audio, handle messages, play AI audio | `frontend/src/hooks/useWebSocket.ts` |
| Microphone capture (AudioWorklet + resample, buffer, base64) | `frontend/src/hooks/useRealtimeAudio.ts` |
| AudioWorklet processor (buffer 2400 samples, ~50 ms, post to main thread) | `frontend/public/audio-processor.worklet.js` |
| Audio encode/decode, resample, constants | `frontend/src/utils/audioUtils.ts`, `frontend/src/utils/constants.ts` |
| HTTP server, WebSocket server, routes | `backend/src/index.ts` |
| Per-client WS handler, route audio_chunk/cancel | `backend/src/services/websocketService.ts` |
| OpenAI Realtime connection, session config, tools, DB | `backend/src/services/realtimeService.ts` |
| Contact schema and validation | `backend/src/models/Contact.ts` |

Use this together with `docs/SEQUENCE_DIAGRAM.md` for diagrams and `docs/FLOW_EXPLANATION.md` for narrative and Q&A.
