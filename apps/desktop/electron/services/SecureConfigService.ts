import { app, safeStorage } from "electron";
import { defaultProviderConfig } from "@inkforge/schemas";
import path from "node:path";
import type { ProviderAuthMode, ProviderConfigInput, ProviderStatus } from "../types.js";
import { FileRepository } from "./FileRepository.js";

interface StoredProviderConfig {
  providerId: string;
  displayName: string;
  baseUrl: string;
  model: string;
  editorModel?: string;
  authMode: ProviderAuthMode;
  encryptedApiKey?: string;
  temperature: number;
  maxTokens: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  updatedAt: string;
}

export interface DecryptedProviderConfig extends Omit<StoredProviderConfig, "encryptedApiKey"> {
  apiKey?: string;
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

  constructor(private readonly files = new FileRepository()) {
    this.filePath = path.join(app.getPath("userData"), "provider-config.secure.json");
    this.legacyFilePaths = [
      path.join(app.getPath("appData"), "@inkforge", "desktop", "provider-config.secure.json"),
      path.join(app.getPath("appData"), "InkForge", "provider-config.secure.json")
    ].filter((candidate) => path.resolve(candidate) !== path.resolve(this.filePath));
  }

  async getStatus(): Promise<ProviderStatus> {
    const stored = await this.readStored();
    const apiKey = this.decrypt(stored.encryptedApiKey);
    return {
      configured: stored.authMode === "none" || Boolean(apiKey),
      providerId: stored.providerId,
      displayName: stored.displayName,
      baseUrl: stored.baseUrl,
      model: stored.model,
      editorModel: stored.editorModel,
      authMode: stored.authMode,
      maskedKey: maskSecret(apiKey),
      updatedAt: stored.updatedAt || undefined,
      maxTokens: stored.maxTokens,
      inputPricePerMillion: stored.inputPricePerMillion,
      outputPricePerMillion: stored.outputPricePerMillion
    };
  }

  async getProvider(): Promise<DecryptedProviderConfig> {
    const stored = await this.readStored();
    const { encryptedApiKey: _encryptedApiKey, ...rest } = stored;
    return {
      ...rest,
      apiKey: this.decrypt(stored.encryptedApiKey)
    };
  }

  async saveProvider(input: ProviderConfigInput): Promise<ProviderStatus> {
    const trimmedKey = input.apiKey?.trim();
    const existing = await this.readStored();
    const encryptedApiKey =
      input.authMode === "none" ? undefined : trimmedKey ? this.encrypt(trimmedKey) : existing.encryptedApiKey;

    if (input.authMode !== "none" && !encryptedApiKey) {
      throw new Error("请填写 API Key，或将认证方式改为“无 Key”。");
    }

    const stored: StoredProviderConfig = {
      providerId: input.providerId.trim() || defaultProviderConfig.providerId,
      displayName: input.displayName.trim() || defaultProviderConfig.displayName,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      model: input.model.trim(),
      editorModel: input.editorModel?.trim() || undefined,
      authMode: input.authMode,
      encryptedApiKey,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      inputPricePerMillion:
        typeof input.inputPricePerMillion === "number" && input.inputPricePerMillion >= 0
          ? input.inputPricePerMillion
          : undefined,
      outputPricePerMillion:
        typeof input.outputPricePerMillion === "number" && input.outputPricePerMillion >= 0
          ? input.outputPricePerMillion
          : undefined,
      updatedAt: new Date().toISOString()
    };

    await this.files.writeJsonAtomic(this.filePath, stored);
    return this.getStatus();
  }

  private async readStored(): Promise<StoredProviderConfig> {
    try {
      return { ...defaultProvider, ...(await this.files.readJson<StoredProviderConfig>(this.filePath)) };
    } catch {
      for (const legacyFilePath of this.legacyFilePaths) {
        try {
          const stored = {
            ...defaultProvider,
            ...(await this.files.readJson<StoredProviderConfig>(legacyFilePath))
          };
          await this.files.writeJsonAtomic(this.filePath, stored);
          return stored;
        } catch {
          // Try the next known pre-rename configuration location.
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
