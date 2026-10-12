export const providerRoles = ["writer", "planner", "reviewer", "agent"] as const;
export type ProviderRole = (typeof providerRoles)[number];
export function completionBudget(status: ProviderStatus, role: ProviderRole, requested?: number) {
  const override = status.taskProviders?.[role];
  const endpoint = override ?? status;
  const outputTokens = override
    ? Math.min(endpoint.maxTokens, requested ?? endpoint.maxTokens)
    : Math.min(32768, Math.max(4096, requested ?? endpoint.maxTokens));
  return {
    outputTokens,
    inputTokens: endpoint.contextWindow === undefined ? undefined : endpoint.contextWindow - outputTokens
  };
}
export type ProviderAuthMode = "bearer" | "x-api-key" | "raw-authorization" | "none";

export interface ProviderEndpointConfig {
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  authMode: ProviderAuthMode;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  supportsTools?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  contextWindow?: number;
  stop?: string[];
  modelRevision?: string;
  tokenizerRevision?: string;
  chatTemplateRevision?: string;
}

export interface ProviderEndpointStatus extends Omit<ProviderEndpointConfig, "apiKey"> {
  configured: boolean;
  maskedKey?: string;
}

export interface ProviderConfigInput extends ProviderEndpointConfig {
  editorModel?: string;
  taskProviders?: Partial<Record<ProviderRole, ProviderEndpointConfig>>;
}

export interface ProviderStatus extends ProviderEndpointStatus {
  editorModel?: string;
  updatedAt?: string;
  taskProviders?: Partial<Record<ProviderRole, ProviderEndpointStatus>>;
}

export const assertProviderRole = (role: unknown): ProviderRole | undefined => {
  if (role === undefined) return undefined;
  if (!providerRoles.includes(role as ProviderRole)) throw new Error("未知的模型用途。");
  return role as ProviderRole;
};

export const providerRoleForTask = (task: string): ProviderRole => {
  if (["continue", "expand", "rewrite", "dialogue", "action", "polish"].includes(task)) return "writer";
  if (["summary", "next-goal", "character-state", "character-generate", "character-names", "plan-scene"].includes(task))
    return "planner";
  return "reviewer";
};

/** A role override is a complete endpoint: never inherit another endpoint's credentials. */
export const resolveProvider = <T extends ProviderConfigInput>(config: T, role?: ProviderRole) => {
  assertProviderRole(role);
  const endpoint = role ? config.taskProviders?.[role] : undefined;
  return {
    ...config,
    ...endpoint,
    supportsTools: endpoint ? endpoint.supportsTools : config.supportsTools,
    inputPricePerMillion: endpoint ? endpoint.inputPricePerMillion : config.inputPricePerMillion,
    outputPricePerMillion: endpoint ? endpoint.outputPricePerMillion : config.outputPricePerMillion,
    contextWindow: endpoint ? endpoint.contextWindow : config.contextWindow,
    stop: endpoint ? endpoint.stop : config.stop,
    modelRevision: endpoint ? endpoint.modelRevision : config.modelRevision,
    tokenizerRevision: endpoint ? endpoint.tokenizerRevision : config.tokenizerRevision,
    chatTemplateRevision: endpoint ? endpoint.chatTemplateRevision : config.chatTemplateRevision,
    apiKey: endpoint ? endpoint.apiKey : config.apiKey,
    editorModel: endpoint ? undefined : config.editorModel,
    roleConfigured: Boolean(endpoint)
  };
};

export const normalizeProviderEndpoint = (input: ProviderEndpointConfig): ProviderEndpointConfig => {
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("模型地址必须是完整的 HTTP 或 HTTPS 地址。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("模型地址只支持 HTTP/HTTPS，且不能包含凭据、查询参数或片段。");
  }
  if (!input.model?.trim()) throw new Error("请填写模型名称。");
  if (!["bearer", "x-api-key", "raw-authorization", "none"].includes(input.authMode))
    throw new Error("未知的鉴权方式。");
  if (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2) {
    throw new Error("Temperature 必须在 0 到 2 之间。");
  }
  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 32768) {
    throw new Error("最大输出 Token 必须是 1 到 32768 之间的整数。");
  }
  if (input.supportsTools !== undefined && typeof input.supportsTools !== "boolean")
    throw new Error("工具能力配置无效。");
  for (const price of [input.inputPricePerMillion, input.outputPricePerMillion]) {
    if (price !== undefined && (!Number.isFinite(price) || price < 0)) throw new Error("Token 价格必须是非负数。");
  }
  if (
    input.contextWindow !== undefined &&
    (!Number.isInteger(input.contextWindow) || input.contextWindow < 256 || input.contextWindow > 2_000_000)
  )
    throw new Error("上下文窗口须为 256 到 2000000 的整数。");
  if (
    input.stop !== undefined &&
    (!Array.isArray(input.stop) ||
      input.stop.length > 4 ||
      input.stop.some((item) => typeof item !== "string" || !item.length || item.length > 256))
  )
    throw new Error("最多支持四个非空停止字符串。");
  for (const value of [input.modelRevision, input.tokenizerRevision, input.chatTemplateRevision])
    if (value !== undefined && (typeof value !== "string" || value.length > 256))
      throw new Error("模型协议版本信息过长或无效。");
  return {
    providerId: input.providerId?.trim() || "custom",
    displayName: input.displayName?.trim() || "自定义连接",
    baseUrl,
    model: input.model.trim(),
    authMode: input.authMode,
    apiKey: input.authMode === "none" ? undefined : input.apiKey?.trim() || undefined,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    supportsTools: input.supportsTools,
    inputPricePerMillion: input.inputPricePerMillion,
    outputPricePerMillion: input.outputPricePerMillion,
    contextWindow: input.contextWindow,
    stop: input.stop,
    modelRevision: input.modelRevision?.trim(),
    tokenizerRevision: input.tokenizerRevision?.trim(),
    chatTemplateRevision: input.chatTemplateRevision?.trim()
  };
};
