import { renderTaskPrompt, type PromptTaskInput, type RenderedPrompt } from "@inkforge/prompt-engine";
import type { PromptTemplate } from "@inkforge/schemas";

export type ProviderAuthMode = "bearer" | "x-api-key" | "raw-authorization" | "none";

export type ChatCompletionRole = "system" | "user" | "assistant";

export interface ChatCompletionMessage {
  role: ChatCompletionRole;
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  messages: ChatCompletionMessage[];
}

export interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
    delta?: {
      content?: string;
    };
  }>;
  usage?: ChatCompletionUsage;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

export type AiPromptInput = PromptTaskInput;
export type AiRenderedPrompt = RenderedPrompt;

export const completionsUrl = (baseUrl: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
};

export const authHeaders = (authMode: ProviderAuthMode, apiKey?: string): Record<string, string> => {
  const normalized = apiKey?.trim();
  if (authMode === "none" || !normalized) {
    return {};
  }
  if (authMode === "x-api-key") {
    return { "x-api-key": normalized };
  }
  if (authMode === "raw-authorization") {
    return { authorization: normalized };
  }
  return { authorization: normalized.toLowerCase().startsWith("bearer ") ? normalized : `Bearer ${normalized}` };
};

export const classifyProviderError = (status: number, payload: ChatCompletionResponse): string => {
  const message = payload.error?.message;
  if (status === 0) {
    return "Browser preview cannot connect to the local AI proxy. Confirm the Vite dev server is still running.";
  }
  if (status === 401 || status === 403) {
    return `Authentication failed. Check API key, key format, and baseURL.${message ? ` Provider said: ${message}` : ""}`;
  }
  if (status === 404) {
    return `Endpoint or model not found. Check that baseURL points to /v1 and that the model name is valid.${message ? ` Provider said: ${message}` : ""}`;
  }
  if (status === 429) {
    return `Rate limit or quota problem. Retry later or check account quota.${message ? ` Provider said: ${message}` : ""}`;
  }
  if (status >= 500) {
    return `Model service is temporarily unavailable.${message ? ` Provider said: ${message}` : ""}`;
  }
  return message || `AI request failed with HTTP ${status}.`;
};

export const buildPrompt = (template: PromptTemplate, input: AiPromptInput, now = new Date()): AiRenderedPrompt =>
  renderTaskPrompt(template, input, now);
