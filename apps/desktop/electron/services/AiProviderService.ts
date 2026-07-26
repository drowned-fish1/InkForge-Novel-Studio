import path from "node:path";
import { createDefaultPromptTemplate, parsePromptTemplate, promptTemplateFileName } from "@inkforge/prompt-engine";
import {
  authHeaders,
  buildPrompt,
  classifyProviderError,
  completionsUrl,
  type ChatCompletionMessage,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ChatCompletionTool
} from "@inkforge/ai-provider";
import type {
  AiTaskInput,
  AiTaskResult,
  ProviderConfigInput,
  ProviderPreset,
  ProviderProbeResult,
  ProviderStatus
} from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { SecureConfigService } from "./SecureConfigService.js";

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";

type AiDeltaHandler = (chunk: string) => void;
const providerResponseTimeoutMs = 10 * 60_000;
export const minimumAgentOutputTokens = 4_096;

export class EmptyAgentResponseError extends Error {
  constructor(readonly finishReason?: string | null) {
    super(
      finishReason === "length"
        ? "模型输出达到长度上限，但没有返回可显示的文字或完整工具调用。"
        : "模型本次没有返回可显示的文字或工具调用。"
    );
    this.name = "EmptyAgentResponseError";
  }
}

export interface AgentCompletionInput {
  requestId?: string;
  messages: ChatCompletionMessage[];
  tools?: ChatCompletionTool[];
  toolChoice?: "auto" | "none";
  modelOverride?: string;
  useEditorModel?: boolean;
  maxOutputTokens?: number;
}

export interface AgentCompletionResult {
  message: ChatCompletionMessage;
  model: string;
  usage?: ChatCompletionResponse["usage"];
}

export interface AgentCompletionDelta {
  type: "text" | "reasoning";
  content: string;
}

type AgentCompletionDeltaHandler = (delta: AgentCompletionDelta) => void;

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

  listPresets(): ProviderPreset[] {
    return providerPresets.map((preset) => ({ ...preset, expectedCapabilities: { ...preset.expectedCapabilities } }));
  }

  async probeProvider(): Promise<ProviderProbeResult> {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      const provider = await this.secureConfig.getProvider();
      if (provider.authMode !== "none" && !provider.apiKey) {
        throw new Error("Provider has no API key configured.");
      }
      const response = await fetch(completionsUrl(provider.baseUrl), {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: {
          "content-type": "application/json",
          ...authHeaders(provider.authMode, provider.apiKey)
        },
        body: JSON.stringify({
          model: provider.model,
          temperature: 0,
          max_tokens: 8,
          stream: false,
          messages: [{ role: "user", content: "Call the capability_probe tool." }],
          tools: [
            {
              type: "function",
              function: {
                name: "capability_probe",
                description: "Return a provider compatibility probe.",
                parameters: { type: "object", properties: {} }
              }
            }
          ],
          tool_choice: "auto"
        } satisfies ChatCompletionRequest)
      });
      const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
      if (!response.ok) {
        throw new Error(classifyProviderError(response.status, payload));
      }
      const toolCapable = Boolean(payload.choices?.[0]?.message?.tool_calls?.length);
      return {
        ok: true,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        modelReachable: true,
        capabilities: {
          streaming: true,
          tools: toolCapable
        },
        message: toolCapable
          ? "模型连通，工具调用协议可用。流式能力将在实际生成时验证。"
          : "模型连通，但本次未返回工具调用；聊天可用，Agent 工具能力需谨慎验证。"
      };
    } catch (error) {
      return {
        ok: false,
        checkedAt,
        latencyMs: Date.now() - startedAt,
        modelReachable: false,
        capabilities: { streaming: false, tools: false },
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }

  cancelTask(requestId: string): void {
    this.activeRequests.get(requestId)?.abort();
  }

  async runTask(input: AiTaskInput, onDelta?: AiDeltaHandler): Promise<AiTaskResult> {
    const abortController = new AbortController();
    if (input.requestId) {
      this.activeRequests.set(input.requestId, abortController);
    }
    try {
      const provider = await this.secureConfig.getProvider();
      if (provider.authMode !== "none" && !provider.apiKey) {
        throw new Error("Provider has no API key configured.");
      }

      const prompt = await this.loadPrompt(input);
      const selectedModel =
        input.useEditorModel && provider.editorModel?.trim() ? provider.editorModel.trim() : provider.model;
      const body: ChatCompletionRequest = {
        model: selectedModel,
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

      const response = await fetchWithResponseTimeout(abortController, () =>
        fetchWithRetry(completionsUrl(provider.baseUrl), {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "content-type": "application/json",
            ...authHeaders(provider.authMode, provider.apiKey)
          },
          body: JSON.stringify(body)
        })
      );

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
        model: selectedModel,
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

  async runAgentCompletion(
    input: AgentCompletionInput,
    onDelta?: AgentCompletionDeltaHandler
  ): Promise<AgentCompletionResult> {
    const abortController = new AbortController();
    if (input.requestId) {
      this.activeRequests.set(input.requestId, abortController);
    }
    try {
      const provider = await this.secureConfig.getProvider();
      if (provider.authMode !== "none" && !provider.apiKey) {
        throw new Error("Provider has no API key configured.");
      }
      const selectedModel =
        input.modelOverride?.trim() ||
        (input.useEditorModel && provider.editorModel?.trim() ? provider.editorModel.trim() : provider.model);
      const maxOutputTokens = input.maxOutputTokens
        ? Math.min(32_768, Math.max(minimumAgentOutputTokens, Math.trunc(input.maxOutputTokens)))
        : Math.max(provider.maxTokens, minimumAgentOutputTokens);
      const body: ChatCompletionRequest = {
        model: selectedModel,
        temperature: provider.temperature,
        max_tokens: maxOutputTokens,
        stream: Boolean(onDelta),
        messages: input.messages,
        tools: input.tools?.length ? input.tools : undefined,
        tool_choice: input.toolChoice ?? (input.tools?.length ? "auto" : "none")
      };
      let lastEmptyResponse: EmptyAgentResponseError | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetchWithResponseTimeout(abortController, () =>
          fetchWithRetry(completionsUrl(provider.baseUrl), {
            method: "POST",
            signal: abortController.signal,
            headers: {
              "content-type": "application/json",
              ...authHeaders(provider.authMode, provider.apiKey)
            },
            body: JSON.stringify(body)
          })
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
          throw new Error(classifyProviderError(response.status, payload));
        }
        const isEventStream =
          response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;
        const payload =
          body.stream && response.body && isEventStream
            ? await readStreamingAgentCompletion(response.body, onDelta)
            : ((await response.json().catch(() => ({}))) as ChatCompletionResponse);
        const choice = payload.choices?.[0];
        const message = choice?.message;
        if (!message || (!message.content?.trim() && !message.tool_calls?.length)) {
          lastEmptyResponse = new EmptyAgentResponseError(choice?.finish_reason);
          continue;
        }
        return {
          message: {
            role: "assistant",
            content: message.content ?? null,
            reasoning_content: message.reasoning_content ?? null,
            tool_calls: message.tool_calls
          },
          model: selectedModel,
          usage: payload.usage
        };
      }
      throw lastEmptyResponse ?? new EmptyAgentResponseError();
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

const providerPresets: ProviderPreset[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    category: "cloud",
    description: "官方 OpenAI 兼容端点，适合流式写作与 Agent 工具调用。",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    authMode: "bearer",
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    category: "cloud",
    description: "DeepSeek 官方端点，支持流式写作与 Agent 工具调用。",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    authMode: "bearer",
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "gemini-openai",
    displayName: "Gemini · OpenAI 兼容",
    category: "cloud",
    description: "通过 Gemini 的 OpenAI 兼容端点接入；模型名称按账号可用列表填写。",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
    authMode: "bearer",
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "ollama",
    displayName: "Ollama",
    category: "local",
    description: "本机模型服务；请先在 Ollama 中拉取支持工具调用的模型。",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen3",
    authMode: "none",
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "lm-studio",
    displayName: "LM Studio",
    category: "local",
    description: "连接 LM Studio 本地服务器；模型名应与已加载模型一致。",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    authMode: "none",
    expectedCapabilities: { streaming: true, tools: false }
  },
  {
    id: "claude-gateway",
    displayName: "Claude · 兼容网关",
    category: "gateway",
    description: "连接提供 OpenAI 协议的 Claude 网关；需自行填写网关地址与模型。",
    baseUrl: "https://your-claude-gateway.example/v1",
    model: "claude-model",
    authMode: "bearer",
    expectedCapabilities: { streaming: true, tools: true }
  },
  {
    id: "custom",
    displayName: "自定义兼容端点",
    category: "gateway",
    description: "适用于 DeepSeek、企业网关或其他 OpenAI 兼容服务。",
    baseUrl: "https://api.example.com/v1",
    model: "model-name",
    authMode: "bearer",
    expectedCapabilities: { streaming: true, tools: false }
  }
];

// A single malformed or non-JSON SSE frame (provider keep-alive, error payload, or a
// chunk boundary the decoder has not yet reunified) must not abort the whole stream and
// discard already-accumulated text/tool calls. Skip frames that fail to parse.
const parseStreamData = (data: string): ChatCompletionResponse | undefined => {
  try {
    return JSON.parse(data) as ChatCompletionResponse;
  } catch {
    return undefined;
  }
};

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
    const payload = parseStreamData(data);
    if (!payload) {
      return;
    }
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

export const readStreamingAgentCompletion = async (
  body: ReadableStream<Uint8Array>,
  onDelta?: AgentCompletionDeltaHandler
): Promise<ChatCompletionResponse> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const toolCalls = new Map<
    number,
    {
      id: string;
      name: string;
      arguments: string;
    }
  >();
  const indexById = new Map<string, number>();
  let lastToolCallIndex = -1;
  let buffer = "";
  let text = "";
  let reasoning = "";
  let usage: ChatCompletionResponse["usage"];
  let finishReason: string | null | undefined;

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      return;
    }
    const payload = parseStreamData(data);
    if (!payload) {
      return;
    }
    usage = payload.usage ?? usage;
    const choice = payload.choices?.[0];
    const delta = choice?.delta;
    finishReason = choice?.finish_reason ?? finishReason;
    if (delta?.reasoning_content) {
      reasoning += delta.reasoning_content;
      onDelta?.({ type: "reasoning", content: delta.reasoning_content });
    }
    if (delta?.content) {
      text += delta.content;
      onDelta?.({ type: "text", content: delta.content });
    }
    for (const partial of delta?.tool_calls ?? []) {
      // Some OpenAI-compatible providers omit `index` on streamed tool-call fragments.
      // Resolve the slot from the fragment id (or fall back to the last active call) so
      // continuation chunks append to the same call instead of fragmenting one call into
      // many entries (which corrupts the assembled arguments JSON).
      let index: number;
      if (typeof partial.index === "number") {
        index = partial.index;
      } else if (partial.id && indexById.has(partial.id)) {
        index = indexById.get(partial.id)!;
      } else if (partial.id) {
        index = toolCalls.size;
      } else {
        index = lastToolCallIndex >= 0 ? lastToolCallIndex : toolCalls.size;
      }
      if (partial.id) {
        indexById.set(partial.id, index);
      }
      const current = toolCalls.get(index) ?? {
        id: partial.id ?? `tool_call_${index}`,
        name: "",
        arguments: ""
      };
      current.id = partial.id ?? current.id;
      current.name += partial.function?.name ?? "";
      current.arguments += partial.function?.arguments ?? "";
      toolCalls.set(index, current);
      lastToolCallIndex = index;
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
    choices: [
      {
        message: {
          content: text || null,
          reasoning_content: reasoning || null,
          tool_calls: [...toolCalls.entries()]
            .sort(([left], [right]) => left - right)
            .map(([, call]) => ({
              id: call.id,
              type: "function" as const,
              function: {
                name: call.name,
                arguments: call.arguments || "{}"
              }
            }))
        },
        finish_reason: finishReason
      }
    ],
    usage
  };
};

const fetchWithResponseTimeout = async (
  controller: AbortController,
  request: () => Promise<Response>
): Promise<Response> => {
  const timeoutId = setTimeout(
    () => controller.abort(new Error("Provider did not start responding in time.")),
    providerResponseTimeoutMs
  );
  try {
    return await request();
  } finally {
    clearTimeout(timeoutId);
  }
};

const fetchWithRetry = async (url: string, init: RequestInit, maxAttempts = 2): Promise<Response> => {
  let lastResponse: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, init);
    lastResponse = response;
    if (![429, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
      return response;
    }
    await response.body?.cancel().catch(() => undefined);
    await abortableDelay(350 * attempt, init.signal);
  }
  return lastResponse!;
};

const abortableDelay = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Request cancelled."));
      return;
    }
    const timeoutId = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        reject(signal.reason ?? new Error("Request cancelled."));
      },
      { once: true }
    );
  });
