import { app, safeStorage } from "electron";
import { defaultProviderConfig } from "@inkforge/schemas";
import path from "node:path";
import {
  normalizeProviderEndpoint,
  providerRoles,
  assertProviderRole,
  type ProviderEndpointConfig,
  type ProviderEndpointStatus,
  type ProviderConfigInput,
  type ProviderStatus,
  type ProviderRole
} from "@inkforge/ai-provider";
import { FileRepository } from "./FileRepository.js";

interface StoredEndpoint extends Omit<ProviderEndpointConfig, "apiKey"> {
  encryptedApiKey?: string;
}
interface StoredProviderConfig extends StoredEndpoint {
  editorModel?: string;
  taskProviders?: Partial<Record<ProviderRole, StoredEndpoint>>;
  updatedAt: string;
}
export interface DecryptedProviderConfig extends ProviderConfigInput {
  updatedAt: string;
  roleConfigured?: boolean;
}

const defaultProvider: StoredProviderConfig = {
  ...defaultProviderConfig,
  updatedAt: ""
};

const maskSecret = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  if (value.length <= 10) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

export class SecureConfigService {
  private readonly filePath: string;
  private readonly legacyFilePaths: string[];
  private saveQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly files = new FileRepository()) {
    this.filePath = path.join(app.getPath("userData"), "provider-config.secure.json");
    this.legacyFilePaths = [
      path.join(app.getPath("appData"), "@inkforge", "desktop", "provider-config.secure.json"),
      path.join(app.getPath("appData"), "InkForge", "provider-config.secure.json")
    ].filter((candidate) => path.resolve(candidate) !== path.resolve(this.filePath));
  }

  async getStatus(): Promise<ProviderStatus> {
    const stored = await this.readStored();
    const status = (endpoint: StoredEndpoint): ProviderEndpointStatus => {
      const { encryptedApiKey, ...publicFields } = endpoint;
      const apiKey = this.decrypt(encryptedApiKey);
      return {
        ...publicFields,
        configured: endpoint.authMode === "none" || Boolean(apiKey),
        maskedKey: maskSecret(apiKey)
      };
    };
    const { taskProviders, updatedAt, editorModel, ...endpoint } = stored;
    const roleStatuses: ProviderStatus["taskProviders"] = {};
    for (const role of providerRoles) {
      if (taskProviders?.[role]) roleStatuses[role] = status(taskProviders[role]);
    }
    return { ...status(endpoint), editorModel, updatedAt: updatedAt || undefined, taskProviders: roleStatuses };
  }

  async getProvider(role?: ProviderRole): Promise<DecryptedProviderConfig> {
    assertProviderRole(role);
    const stored = await this.readStored();
    // Decrypt only the selected endpoint, never unrelated credentials.
    const endpoint = role ? stored.taskProviders?.[role] : undefined;
    const selected = {
      ...(endpoint ?? stored),
      updatedAt: stored.updatedAt,
      editorModel: endpoint ? undefined : stored.editorModel,
      taskProviders: undefined,
      roleConfigured: Boolean(endpoint)
    };
    const { encryptedApiKey, taskProviders: _taskProviders, ...rest } = selected;
    return { ...rest, apiKey: this.decrypt(encryptedApiKey) };
  }

  saveProvider(input: ProviderConfigInput): Promise<ProviderStatus> {
    const next = this.saveQueue.then(() => this.save(input));
    this.saveQueue = next.catch(() => undefined);
    return next;
  }

  private async save(input: ProviderConfigInput): Promise<ProviderStatus> {
    const existing = await this.readStored();
    const store = (
      raw: ProviderEndpointConfig,
      previous?: StoredEndpoint,
      allowUnconfigured = false
    ): StoredEndpoint => {
      const { apiKey, ...endpoint } = normalizeProviderEndpoint(raw);
      const canRetain =
        previous?.baseUrl?.trim().replace(/\/+$/, "") === endpoint.baseUrl && previous.authMode === endpoint.authMode;
      const encryptedApiKey =
        endpoint.authMode === "none"
          ? undefined
          : apiKey
            ? this.encrypt(apiKey)
            : canRetain
              ? previous?.encryptedApiKey
              : undefined;
      if (endpoint.authMode !== "none" && !encryptedApiKey && (!allowUnconfigured || previous?.encryptedApiKey)) {
        throw new Error(`${endpoint.displayName}：请填写 API Key；更换地址或鉴权方式后需重新填写。`);
      }
      return { ...endpoint, encryptedApiKey };
    };
    const endpoint = store(input, existing, true);
    let taskProviders = existing.taskProviders;
    if (input.taskProviders !== undefined) {
      for (const role of Object.keys(input.taskProviders)) assertProviderRole(role);
      taskProviders = {};
      for (const role of providerRoles) {
        const override = input.taskProviders[role];
        if (override) taskProviders[role] = store(override, existing.taskProviders?.[role]);
      }
    }
    await this.files.writeJsonAtomic(this.filePath, {
      ...endpoint,
      editorModel: input.editorModel?.trim() || undefined,
      taskProviders,
      updatedAt: new Date().toISOString()
    } satisfies StoredProviderConfig);
    return this.getStatus();
  }

  private async readStored(): Promise<StoredProviderConfig> {
    try {
      return { ...defaultProvider, ...(await this.files.readJson<StoredProviderConfig>(this.filePath)) };
    } catch (error) {
      if (!isMissingFile(error)) throw new Error("模型配置读取失败，请检查配置文件；原配置已保留。");
      for (const legacyFilePath of this.legacyFilePaths) {
        try {
          const stored = {
            ...defaultProvider,
            ...(await this.files.readJson<StoredProviderConfig>(legacyFilePath))
          };
          await this.files.writeJsonAtomic(this.filePath, stored);
          return stored;
        } catch (legacyError) {
          if (!isMissingFile(legacyError)) throw legacyError;
        }
      }
      return defaultProvider;
    }
  }

  private encrypt(value: string): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统安全存储不可用，无法保存 API Key。");
    }
    return safeStorage.encryptString(value).toString("base64");
  }

  private decrypt(value?: string): string | undefined {
    if (!value) {
      return undefined;
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统安全存储不可用，无法读取 API Key。");
    }
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  }
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
