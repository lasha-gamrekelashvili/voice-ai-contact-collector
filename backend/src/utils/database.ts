import mongoose from 'mongoose';
import { logger } from './logger';
import { 
  DB_CONNECTION_RETRY_ATTEMPTS, 
  DB_CONNECTION_RETRY_DELAY_MS 
} from './constants';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function connectDatabase(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/voice-ai-contacts';
  
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= DB_CONNECTION_RETRY_ATTEMPTS; attempt++) {
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      
      logger.info('✅ Connected to MongoDB', { 
        uri: mongoUri.replace(/\/\/.*@/, '//***:***@'), 
        attempt 
      });
      
      mongoose.connection.on('error', (error) => {
        logger.error('MongoDB connection error', { error: error.message });
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
      });

      return; 
    } catch (error: any) {
      lastError = error;
      logger.warn(`MongoDB connection attempt ${attempt} failed`, { 
        error: error.message,
        attempt,
        maxAttempts: DB_CONNECTION_RETRY_ATTEMPTS
      });
      
      if (attempt < DB_CONNECTION_RETRY_ATTEMPTS) {
        const delay = DB_CONNECTION_RETRY_DELAY_MS * attempt; 
        logger.info(`Retrying MongoDB connection in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  logger.error('❌ Failed to connect to MongoDB after all retry attempts', {
    attempts: DB_CONNECTION_RETRY_ATTEMPTS,
    error: lastError?.message
  });
  throw lastError || new Error('Failed to connect to MongoDB');
}
