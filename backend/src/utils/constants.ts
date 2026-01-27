// WebSocket Configuration
export const WS_CONNECTION_TIMEOUT_MS = 60000; // 60 seconds
export const MAX_WS_CONNECTIONS = 100;

// Rate Limiting
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_REQUESTS = 100;

// Database
export const DB_CONNECTION_RETRY_ATTEMPTS = 5;
export const DB_CONNECTION_RETRY_DELAY_MS = 2000; // 2 seconds

// Validation
export const MAX_NAME_LENGTH = 255;
export const MAX_EMAIL_LENGTH = 255;
export const MAX_PHONE_LENGTH = 20;
