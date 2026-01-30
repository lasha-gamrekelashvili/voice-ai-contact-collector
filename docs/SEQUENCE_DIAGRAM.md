# Voice AI Contact Collector — Sequence Diagram

This document describes the end-to-end flow using Mermaid sequence diagrams. You can render them in GitHub, VS Code (Mermaid extension), or [mermaid.live](https://mermaid.live).

---

## 1. Call setup (user clicks "Start Call")

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant App as App (React)
    participant useWS as useWebSocket
    participant useAudio as useRealtimeAudio
    participant Backend as Backend (Express)
    participant WSS as WebSocket Server
    participant Realtime as RealtimeService
    participant OpenAI as OpenAI Realtime API

    User->>App: Click "Start Call"
    App->>useWS: connect()
    useWS->>WSS: new WebSocket(ws://host:3001/ws)
    WSS->>Backend: connection event
    Backend->>Realtime: new RealtimeService(ws, onContactSaved)
    Backend->>Realtime: connect()
    Realtime->>OpenAI: WebSocket open (Bearer API key)
    OpenAI-->>Realtime: connection open
    Realtime->>OpenAI: session.update (instructions, tools, audio 24kHz)
    OpenAI-->>Realtime: session.created
    OpenAI-->>Realtime: session.updated
    Realtime->>Realtime: sendInitialGreeting()
    Realtime->>OpenAI: response.create (greeting instructions)
    Realtime->>useWS: send { type: 'ready' }
    useWS->>App: setStatus('connected')
    WSS-->>useWS: onopen
    useWS->>App: setStatus('connected')
    Note over App: After CONNECTION_READY_DELAY (500ms)
    App->>useAudio: startListening()
    useAudio->>User: getUserMedia({ audio })
    User-->>useAudio: grant microphone
    useAudio->>useAudio: AudioContext + addModule(worklet) + AudioWorkletNode (2400)
    useAudio-->>App: setIsListening(true)
```

---

## 2. User speaks → audio to backend → OpenAI

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant useAudio as useRealtimeAudio
    participant App as App
    participant useWS as useWebSocket
    participant Backend as Backend
    participant Realtime as RealtimeService
    participant OpenAI as OpenAI Realtime API

    loop Every ~50ms (1200 samples @ 24kHz, low latency)
        User->>useAudio: Microphone input
        useAudio->>useAudio: Worklet port.onmessage(2400) → resample to 24kHz, buffer
        useAudio->>useAudio: buffer >= 1200 → encodeBase64
        useAudio->>App: onAudioChunk(base64)
        App->>useWS: sendAudioChunk(base64)
        useWS->>Backend: { type: 'audio_chunk', data: base64 }
        Backend->>Realtime: appendAudio(base64)
        Realtime->>OpenAI: input_audio_buffer.append { audio: base64 }
    end
```

---

## 3. OpenAI detects speech and sends "listening" / "processing"

```mermaid
sequenceDiagram
    participant OpenAI as OpenAI Realtime API
    participant Realtime as RealtimeService
    participant useWS as useWebSocket
    participant App as App

    Note over OpenAI: Semantic VAD detects user speech
    OpenAI->>Realtime: input_audio_buffer.speech_started
    Realtime->>useWS: { type: 'listening' }
    useWS->>useWS: stopAudio() (stop AI playback)
    useWS->>App: setStatus('listening')

    Note over OpenAI: User stops speaking
    OpenAI->>Realtime: input_audio_buffer.speech_stopped
    Realtime->>useWS: { type: 'processing' }
    useWS->>App: setStatus('processing')
```

---

## 4. AI responds with audio and text

```mermaid
sequenceDiagram
    autonumber
    participant OpenAI as OpenAI Realtime API
    participant Realtime as RealtimeService
    participant useWS as useWebSocket
    participant App as App

    OpenAI->>Realtime: response.created
    Realtime->>Realtime: isResponseActive = true

    loop Audio stream
        OpenAI->>Realtime: response.output_audio.delta (base64)
        Realtime->>useWS: { type: 'audio_delta', data: base64 }
        useWS->>useWS: playAudioChunk(base64) → decode, resample, schedule
        useWS->>App: setIsAISpeaking(true), setStatus('speaking')
    end

    OpenAI->>Realtime: response.output_audio_transcript.done
    Realtime->>useWS: { type: 'text', data: transcript }
    useWS->>App: setLatestAIText(transcript) → AICaption

    OpenAI->>Realtime: response.done
    Realtime->>useWS: { type: 'response_done' }
    Note over useWS: After last chunk + 150ms → setIsAISpeaking(false)
```

---

## 5. AI calls save_contact → database → notify frontend

```mermaid
sequenceDiagram
    autonumber
    participant OpenAI as OpenAI Realtime API
    participant Realtime as RealtimeService
    participant DB as MongoDB
    participant useWS as useWebSocket
    participant App as App

    OpenAI->>Realtime: response.output_item.done (item.type === 'function_call')
    Realtime->>Realtime: handleFunctionCall(item) → save_contact

    Realtime->>Realtime: normalizeEmail(), convertWordsToDigits()
    Realtime->>DB: new Contact({ name, email, phone }).save()
    DB-->>Realtime: saved (store lastSavedContactId)

    Realtime->>OpenAI: conversation.item.create (function_call_output: success)
    Realtime->>useWS: { type: 'contact_saved', data: contact }
    useWS->>App: setSavedContact(contact)
    App->>App: Show ContactSaved component
```

---

## 6. Optional: AI calls update_contact (user corrects info)

```mermaid
sequenceDiagram
    participant OpenAI as OpenAI Realtime API
    participant Realtime as RealtimeService
    participant DB as MongoDB
    participant useWS as useWebSocket
    participant App as App

    OpenAI->>Realtime: response.output_item.done (function_call: update_contact)
    Realtime->>Realtime: handleFunctionCall → update_contact(args)
    Realtime->>DB: Contact.findByIdAndUpdate(lastSavedContactId, updateData)
    DB-->>Realtime: updated contact
    Realtime->>OpenAI: function_call_output (success)
    Realtime->>useWS: { type: 'contact_updated', data: contact }
    useWS->>App: setSavedContact(contact)
```

---

## 7. User interrupts AI (optional)

```mermaid
sequenceDiagram
    participant App as App
    participant useWS as useWebSocket
    participant Backend as Backend
    participant Realtime as RealtimeService
    participant OpenAI as OpenAI Realtime API

    Note over App: User starts speaking while AI is talking
    useAudio->>useWS: isSpeaking = true (VAD)
    App->>useWS: cancelResponse() (or stopAudio only)
    useWS->>useWS: stopAudio()
    useWS->>Backend: { type: 'cancel' }
    Backend->>Realtime: cancelResponse()
    Realtime->>OpenAI: response.cancel
    Realtime->>OpenAI: conversation.item.truncate (optional)
```

---

## 8. End call

```mermaid
sequenceDiagram
    participant User
    participant App as App
    participant useWS as useWebSocket
    participant useAudio as useRealtimeAudio
    participant Backend as Backend
    participant Realtime as RealtimeService
    participant OpenAI as OpenAI Realtime API

    User->>App: Click "End Call"
    App->>App: hasStartedRef = false, clear timer
    App->>useAudio: stopListening()
    useAudio->>useAudio: cleanupResources (mic, AudioContext, worklet)
    App->>useWS: stopAudio()
    App->>useWS: disconnect()
    useWS->>Backend: ws.close()
    Backend->>Realtime: disconnect()
    Realtime->>OpenAI: openaiWs.close()
    useWS->>useWS: setStatus('idle'), clear state
```

---

## Component summary

| Layer | Components | Role |
|-------|------------|------|
| **Frontend** | `App`, `CallButton`, `AICaption`, `ContactSaved` | UI and orchestration |
| **Frontend** | `useWebSocket` | WS to backend, send audio chunks, receive events, play AI audio |
| **Frontend** | `useRealtimeAudio` | Mic capture via AudioWorklet (2400→24kHz, buffer ~50ms), emit base64 chunks (low latency) |
| **Frontend** | `public/audio-processor.worklet.js` | AudioWorklet processor: buffers 2400 samples (~50ms at device rate), posts to main thread |
| **Backend** | Express + `createServer`, `WebSocketServer` on `/ws` | HTTP + WS server |
| **Backend** | `handleWebSocketConnection` | Per-client handler, creates RealtimeService, routes messages |
| **Backend** | `RealtimeService` | Bridge: client WS ↔ OpenAI Realtime API, tools → DB |
| **External** | OpenAI Realtime API | Voice model (gpt-realtime), Whisper transcription, tools |
| **External** | MongoDB | Contact persistence |
