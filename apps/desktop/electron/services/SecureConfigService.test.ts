import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { defaultProviderConfig } from "@inkforge/schemas";
import type { ProviderConfigInput } from "@inkforge/ai-provider";
import { SecureConfigService } from "./SecureConfigService.js";

vi.mock("electron", () => ({
  app: { getPath: (name: string) => path.join("provider-test", name) },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, "")
  }
}));

let stored: Record<string, unknown>;
const configPath = path.join("provider-test", "userData", "provider-config.secure.json");
const makeService = () =>
  new SecureConfigService({
    readJson: async (file: string) => {
      if (!(file in stored)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return structuredClone(stored[file]);
    },
    writeJsonAtomic: async (file: string, value: unknown) => {
      stored[file] = JSON.parse(JSON.stringify(value));
    }
  } as never);
const input = (): ProviderConfigInput => ({
  ...defaultProviderConfig,
  apiKey: "default-secret-123",
  taskProviders: {
    writer: {
      ...defaultProviderConfig,
      providerId: "local",
      displayName: "9B",
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "novelist",
      authMode: "none",
      maxTokens: 1024,
      supportsTools: false
    },
    reviewer: {
      ...defaultProviderConfig,
      baseUrl: "https://review.test/v1",
      model: "review-model",
      apiKey: "review-secret-456"
    }
  }
});
beforeEach(() => {
  stored = {};
});

describe("secure provider routing", () => {
  it("can configure a local writer before adding a default cloud key", async () => {
    const service = makeService();
    const config = input();
    config.apiKey = "";
    delete config.taskProviders!.reviewer;
    const status = await service.saveProvider(config);
    expect(status.configured).toBe(false);
    expect(status.taskProviders?.writer?.configured).toBe(true);
    expect((await service.getProvider("writer")).model).toBe("novelist");
  });

  it("encrypts all keys, exposes only masked status and isolates a keyless writer", async () => {
    const service = makeService();
    const status = await service.saveProvider(input());
    expect(JSON.stringify(stored)).not.toContain("default-secret-123");
    expect(JSON.stringify(stored)).not.toContain("review-secret-456");
    expect(JSON.stringify(status)).not.toContain("encryptedApiKey");
    expect(JSON.stringify(status)).not.toContain("apiKey");
    expect(status.taskProviders?.writer.configured).toBe(true);
    expect(await service.getProvider("writer")).toMatchObject({
      model: "novelist",
      authMode: "none",
      roleConfigured: true
    });
    expect((await service.getProvider("writer")).apiKey).toBeUndefined();
    expect((await service.getProvider("reviewer")).apiKey).toBe("review-secret-456");
    expect((await service.getProvider("planner")).apiKey).toBe("default-secret-123");
  });

  it("retains keys on same-endpoint edits and refuses to carry keys across addresses", async () => {
    const service = makeService();
    await service.saveProvider(input());
    const update = input();
    update.apiKey = "";
    update.taskProviders!.reviewer!.apiKey = "";
    await service.saveProvider(update);
    expect((await service.getProvider("reviewer")).apiKey).toBe("review-secret-456");
    update.taskProviders!.reviewer!.baseUrl = "https://another.test/v1";
    await expect(service.saveProvider(update)).rejects.toThrow("重新填写");
    expect((await service.getProvider("reviewer")).baseUrl).toBe("https://review.test/v1");
  });

  it("preserves overrides for old callers and clears them when explicitly removed", async () => {
    const service = makeService();
    await service.saveProvider(input());
    const legacy = { ...defaultProviderConfig, apiKey: "", editorModel: "old-editor" };
    await service.saveProvider(legacy);
    expect((await service.getProvider("writer")).model).toBe("novelist");
    await service.saveProvider({ ...legacy, taskProviders: {} });
    expect(await service.getProvider("reviewer")).toMatchObject({
      model: defaultProviderConfig.model,
      editorModel: "old-editor",
      roleConfigured: false
    });
  });

  it("loads a legacy single connection and does not overwrite corrupt configuration", async () => {
    stored[configPath] = { ...defaultProviderConfig, authMode: "none", editorModel: "legacy-editor" };
    expect(await makeService().getProvider("reviewer")).toMatchObject({
      editorModel: "legacy-editor",
      roleConfigured: false
    });
    const corrupt = new SecureConfigService({
      readJson: async () => {
        throw new SyntaxError("broken");
      },
      writeJsonAtomic: vi.fn()
    } as never);
    await expect(corrupt.saveProvider(input())).rejects.toThrow("原配置已保留");
  });
});
