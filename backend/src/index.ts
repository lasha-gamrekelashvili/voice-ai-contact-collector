import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import mongoose from 'mongoose';
import { connectDatabase } from './utils/database';
import { handleWebSocketConnection } from './services/websocketService';
import { validateEnvironmentVariables } from './utils/validateEnv';
import { logger } from './utils/logger';
import { MAX_WS_CONNECTIONS } from './utils/constants';

try {
  validateEnvironmentVariables();
} catch (error: any) {
  console.error('❌ Environment validation failed:', error.message);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

app.get('/health', async (req, res) => {
  const checks = {
    database: mongoose.connection.readyState === 1,
    timestamp: new Date().toISOString()
  };
  
  const healthy = Object.values(checks).every(v => v === true || typeof v === 'string');
  const status = healthy ? 'ok' : 'degraded';
  
  res.status(healthy ? 200 : 503).json({ 
    status, 
    checks 
  });
});

app.get('/api/contacts', async (req, res) => {
  try {
    const Contact = mongoose.models.Contact || mongoose.model('Contact');
    const contacts = await Contact.find().sort({ createdAt: -1 }).limit(50);
    res.json({
      count: contacts.length,
      contacts: contacts
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const server = createServer(app);

const wss = new WebSocketServer({ 
  server, 
  path: '/ws',
  perMessageDeflate: false 
});

let activeConnections = 0;

wss.on('connection', (ws, req) => {
  if (activeConnections >= MAX_WS_CONNECTIONS) {
    logger.warn('WebSocket connection rejected - max connections reached', {
      current: activeConnections,
      max: MAX_WS_CONNECTIONS
    });
    ws.close(1008, 'Server at capacity');
    return;
  }

  activeConnections++;
  logger.info('New WebSocket connection established', {
    totalConnections: activeConnections,
    remoteAddress: req.socket.remoteAddress
  });

  ws.on('close', () => {
    activeConnections--;
    logger.info('WebSocket connection closed', {
      remainingConnections: activeConnections
    });
  });

  handleWebSocketConnection(ws);
});

async function startServer() {
  try {
    await connectDatabase();
    
    server.listen(PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${PORT}`);
      logger.info(`🔌 WebSocket server running on ws://localhost:${PORT}/ws`);
    });
  } catch (error: any) {
    logger.error('Failed to start server', { 
      error: error.message, 
      stack: error.stack 
    });
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Rejection', { 
    reason: reason?.message || reason,
    stack: reason?.stack 
  });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception', { 
    error: error.message, 
    stack: error.stack 
  });
  process.exit(1);
});

startServer();
