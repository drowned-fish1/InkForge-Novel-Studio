import {
  renderTaskPrompt,
  estimateMessageInputTokens,
  type PromptTaskInput,
  type RenderedPrompt
} from "@inkforge/prompt-engine";
import type { PromptTemplate } from "@inkforge/schemas";

import type { ProviderAuthMode } from "./config.js";
export * from "./config.js";

export type ChatCompletionRole = "system" | "user" | "assistant" | "tool";

export interface ChatCompletionToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionMessage {
  role: ChatCompletionRole;
  content: string | null;
  reasoning_content?: string | null;
  tool_call_id?: string;
  tool_calls?: ChatCompletionToolCall[];
}

export interface ChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  stop?: string[];
  model: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  messages: ChatCompletionMessage[];
  tools?: ChatCompletionTool[];
  tool_choice?: "auto" | "none";
}

/** Conservative estimate; exact tokenizer/template validation still belongs to deployment. */
export function assertCompletionFits(request: ChatCompletionRequest, contextWindow?: number) {
  const estimatedInputTokens = estimateMessageInputTokens(request.messages, request.tools);
  if (contextWindow && estimatedInputTokens + (request.max_tokens ?? 0) > contextWindow)
    throw new Error(
      `完整消息预估 ${estimatedInputTokens} Token，加输出预留 ${request.max_tokens ?? 0} 超过上下文窗口 ${contextWindow}；请减少资料或拆分场景。`
    );
  return estimatedInputTokens;
}

export interface ChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ChatCompletionToolCall[];
    };
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
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
