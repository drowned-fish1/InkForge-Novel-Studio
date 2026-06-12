import { createDefaultPromptTemplate } from "@inkforge/prompt-engine";
import {
  buildPrompt,
  classifyProviderError,
  type ChatCompletionRequest,
  type ChatCompletionResponse
} from "@inkforge/ai-provider";
import type { PromptTemplate } from "@inkforge/schemas";
import type { AiTaskInput, AiTaskResult, ProviderAuthMode, ProviderConfigInput } from "@/types/app";

interface RuntimeProvider extends ProviderConfigInput {
  apiKey: string;
}

const devProxyEndpoint = "/__inkforge_ai/chat-completions";

export const maskApiKey = (apiKey: string): string | undefined => {
  const normalized = apiKey.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= 10) {
    return `${normalized.slice(0, 2)}...${normalized.slice(-2)}`;
  }
  return `${normalized.slice(0, 6)}...${normalized.slice(-4)}`;
};

export const runBrowserAiTask = async (
  input: AiTaskInput,
  provider: RuntimeProvider,
  template: PromptTemplate = createDefaultPromptTemplate(input.task),
  signal?: AbortSignal
): Promise<AiTaskResult> => {
  const prompt = buildPrompt(template, input);
  const chatRequest: ChatCompletionRequest = {
    model: provider.model,
    temperature: provider.temperature,
    max_tokens: provider.maxTokens,
    stream: false,
    messages: [
      {
        role: "system",
        content: prompt.system
      },
      {
        role: "user",
        content: prompt.user
      }
    ]
  };

  const response = await fetch(devProxyEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      baseUrl: provider.baseUrl,
      authMode: provider.authMode,
      apiKey: provider.apiKey,
      payload: chatRequest
    }),
    signal
  });

  const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
  if (!response.ok) {
    throw new Error(classifyProviderError(response.status, payload));
  }

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Model returned no usable text.");
  }

  const usage = payload.usage
    ? {
        promptTokens: payload.usage.prompt_tokens,
        completionTokens: payload.usage.completion_tokens,
        totalTokens: payload.usage.total_tokens
      }
    : undefined;

  return {
    task: input.task,
    text,
    providerId: provider.providerId,
    model: provider.model,
    contextSummary: `${prompt.name}; ${prompt.contextSummary}`,
    generatedAt: prompt.generatedAt,
    usage
  };
};

export const hasAuthMaterial = (authMode: ProviderAuthMode, apiKey: string): boolean =>
  authMode === "none" || Boolean(apiKey.trim());
