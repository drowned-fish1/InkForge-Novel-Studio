export const defaultProviderConfig = {
  providerId: "openai-compatible",
  displayName: "OpenAI-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  authMode: "bearer",
  temperature: 0.75,
  maxTokens: 1200
} as const;
