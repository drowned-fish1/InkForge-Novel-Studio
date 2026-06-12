import path from "node:path";
import { createDefaultPromptTemplate, parsePromptTemplate, promptTemplateFileName } from "@inkforge/prompt-engine";
import {
  authHeaders,
  buildPrompt,
  classifyProviderError,
  completionsUrl,
  type ChatCompletionRequest,
  type ChatCompletionResponse
} from "@inkforge/ai-provider";
import type { AiTaskInput, AiTaskResult, ProviderConfigInput, ProviderStatus } from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { SecureConfigService } from "./SecureConfigService.js";

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";

type AiDeltaHandler = (chunk: string) => void;

export class AiProviderService {
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(
    private readonly secureConfig = new SecureConfigService(),
    private readonly files = new FileRepository()
  ) {}

  async getStatus(): Promise<ProviderStatus> {
    return this.secureConfig.getStatus();
  }

  async saveProvider(input: ProviderConfigInput): Promise<ProviderStatus> {
    return this.secureConfig.saveProvider(input);
  }

  cancelTask(requestId: string): void {
    this.activeRequests.get(requestId)?.abort();
  }

  async runTask(input: AiTaskInput, onDelta?: AiDeltaHandler): Promise<AiTaskResult> {
    const abortController = input.requestId ? new AbortController() : undefined;
    if (input.requestId && abortController) {
      this.activeRequests.set(input.requestId, abortController);
    }
    try {
      const provider = await this.secureConfig.getProvider();
      if (provider.authMode !== "none" && !provider.apiKey) {
        throw new Error("Provider has no API key configured.");
      }

      const prompt = await this.loadPrompt(input);
      const body: ChatCompletionRequest = {
        model: provider.model,
        temperature: provider.temperature,
        max_tokens: provider.maxTokens,
        stream: Boolean(onDelta),
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

      const response = await fetch(completionsUrl(provider.baseUrl), {
        method: "POST",
        signal: abortController?.signal,
        headers: {
          "content-type": "application/json",
          ...authHeaders(provider.authMode, provider.apiKey)
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
        throw new Error(classifyProviderError(response.status, payload));
      }

      const isEventStream = response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;
      const payload =
        body.stream && response.body && isEventStream
          ? await readStreamingCompletion(response.body, onDelta)
          : ((await response.json().catch(() => ({}))) as ChatCompletionResponse);

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
    } finally {
      if (input.requestId) {
        this.activeRequests.delete(input.requestId);
      }
    }
  }

  private async loadPrompt(input: AiTaskInput) {
    const relativeFile = path.posix.join("prompts", promptTemplateFileName(input.task));
    try {
      const template = parsePromptTemplate(
        await this.files.readJson(this.files.assertInsideProject(input.projectPath, relativeFile))
      );
      return buildPrompt(template, input);
    } catch (error) {
      if (isMissingFile(error)) {
        return buildPrompt(createDefaultPromptTemplate(input.task), input);
      }
      throw new Error(
        `Prompt template ${relativeFile} is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

const readStreamingCompletion = async (
  body: ReadableStream<Uint8Array>,
  onDelta?: AiDeltaHandler
): Promise<ChatCompletionResponse> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage: ChatCompletionResponse["usage"];

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      return;
    }
    const payload = JSON.parse(data) as ChatCompletionResponse;
    usage = payload.usage ?? usage;
    const chunk = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content ?? "";
    if (chunk) {
      text += chunk;
      onDelta?.(chunk);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      consumeLine(line);
    }
  }
  buffer += decoder.decode();
  for (const line of buffer.split(/\r?\n/)) {
    if (line.trim()) {
      consumeLine(line);
    }
  }

  return {
    choices: [{ message: { content: text } }],
    usage
  };
};
