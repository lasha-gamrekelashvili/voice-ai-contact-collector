export function validateEnvironmentVariables(): void {
  const requiredEnvVars = [
    'OPENAI_API_KEY',
    'MONGODB_URI'
  ];

  const missing: string[] = [];

  requiredEnvVars.forEach(varName => {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file and ensure all required variables are set.'
    );
  }
}
