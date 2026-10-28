import { describe, expect, it } from "vitest";
import { normalizeProviderEndpoint, providerRoleForTask, resolveProvider } from "../src/index";
import { defaultProviderConfig } from "@inkforge/schemas";

describe("provider configuration", () => {
  it("selects a full role endpoint without default credentials, editor model or prices", () => {
    const selected = resolveProvider(
      {
        ...defaultProviderConfig,
        apiKey: "default-key",
        editorModel: "editor",
        inputPricePerMillion: 9,
        taskProviders: {
          writer: {
            ...defaultProviderConfig,
            baseUrl: "http://localhost:8000/v1",
            model: "9b",
            authMode: "none" as const
          }
        }
      },
      "writer"
    );
    expect(selected.apiKey).toBeUndefined();
    expect(selected.editorModel).toBeUndefined();
    expect(selected.inputPricePerMillion).toBeUndefined();
    expect(selected.model).toBe("9b");
  });
  it("maps prose, planning and review tasks", () => {
    expect(providerRoleForTask("continue")).toBe("writer");
    expect(providerRoleForTask("summary")).toBe("planner");
    expect(providerRoleForTask("character-names")).toBe("planner");
    expect(providerRoleForTask("character-generate")).toBe("planner");
    expect(providerRoleForTask("clue-check")).toBe("reviewer");
  });
  it("rejects invalid addresses and numeric settings before saving", () => {
    for (const baseUrl of [
      "file:///etc/passwd",
      "https://key:secret@example.test/v1",
      "https://example.test/v1?key=secret"
    ]) {
      expect(() => normalizeProviderEndpoint({ ...defaultProviderConfig, baseUrl })).toThrow();
    }
    for (const maxTokens of [NaN, 0, 1.5, 32769])
      expect(() => normalizeProviderEndpoint({ ...defaultProviderConfig, maxTokens })).toThrow();
    expect(() => normalizeProviderEndpoint({ ...defaultProviderConfig, temperature: Infinity })).toThrow();
  });
});
