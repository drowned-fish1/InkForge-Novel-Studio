import { describe, expect, it } from "vitest";
import { formatAgentError } from "./agentError";

describe("formatAgentError", () => {
  it("removes Electron IPC wrappers", () => {
    expect(
      formatAgentError(new Error("Error invoking remote method 'agent:chat:run': Error: Provider request timed out."))
    ).toBe("Provider request timed out.");
  });

  it("turns empty model responses into an actionable Chinese message", () => {
    expect(formatAgentError(new Error("Model returned neither text nor tool calls."))).toContain("没有返回有效内容");
  });
});
