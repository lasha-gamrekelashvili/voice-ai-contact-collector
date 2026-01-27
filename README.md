# Voice AI Contact Collector

A real-time voice-powered contact collection app using OpenAI's Realtime API. Users can speak to an AI assistant that naturally collects their name, email, and phone number.

## Tech Stack

**Frontend:**
- React 18 + TypeScript
- Vite
- Web Audio API for real-time audio

**Backend:**
- Node.js + Express + TypeScript
- OpenAI Realtime API (WebSocket)
- MongoDB + Mongoose
- WebSocket (ws)

## Prerequisites

- Node.js 18+
- Docker (for MongoDB) or MongoDB installed locally
- OpenAI API key with Realtime API access

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/lasha-gamrekelashvili/voice-ai-contact-collector.git
cd voice-ai-contact-collector
```

### 2. Start MongoDB

Using Docker:
```bash
docker-compose up -d
```

Or if you have MongoDB installed locally, make sure it's running on port 27017.

### 3. Setup Backend

```bash
cd backend
npm install
```

Create a `.env` file in the `backend` folder:
```env
PORT=3001
MONGODB_URI=mongodb://localhost:27017/voice-ai-contacts
OPENAI_API_KEY=your-openai-api-key-here
FRONTEND_URL=http://localhost:5173
```

Start the backend:
```bash
npm run dev
```

The backend will run on `http://localhost:3001`.

### 4. Setup Frontend

Open a new terminal:
```bash
cd frontend
npm install
npm run dev
```

The frontend will run on `http://localhost:5173`.

### 5. Use the App

1. Open `http://localhost:5173` in your browser
2. Click the call button to start
3. Allow microphone access when prompted
4. Speak to the AI and provide your contact information
5. The AI will save your contact when all info is collected

## Project Structure

```
voice-ai-contact-collector/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Entry point
│   │   ├── models/
│   │   │   └── Contact.ts        # MongoDB model
│   │   ├── services/
│   │   │   ├── realtimeService.ts    # OpenAI Realtime API
│   │   │   └── websocketService.ts   # Client WebSocket handler
│   │   └── utils/
│   │       ├── constants.ts
│   │       ├── database.ts
│   │       ├── logger.ts
│   │       └── validateEnv.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx               # Main app component
│   │   ├── components/
│   │   │   ├── AICaption.tsx     # AI response display
│   │   │   ├── CallButton.tsx    # Call control button
│   │   │   ├── ContactSaved.tsx  # Success confirmation
│   │   │   └── ErrorBoundary.tsx
│   │   ├── hooks/
│   │   │   ├── useRealtimeAudio.ts   # Mic capture
│   │   │   └── useWebSocket.ts       # WebSocket + audio playback
│   │   ├── utils/
│   │   │   ├── audioUtils.ts
│   │   │   └── constants.ts
│   │   └── types/
│   │       └── index.ts
│   ├── package.json
│   └── vite.config.ts
├── docker-compose.yml            # MongoDB container
├── .gitignore
└── README.md
```
