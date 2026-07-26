import { describe, expect, it, vi } from "vitest";
import { invokeWithRendererAbort } from "./rendererAbort";

describe("invokeWithRendererAbort", () => {
  it("adds a request id without forwarding the signal", async () => {
    const invoke = vi.fn(async (input: { requestId: string; value: string }) => input.requestId);
    const cancel = vi.fn(async () => undefined);

    const requestId = await invokeWithRendererAbort({
      input: { value: "draft" },
      requestPrefix: "ai",
      invoke,
      cancel
    });

    expect(requestId).toMatch(/^ai_/u);
    expect(invoke).toHaveBeenCalledWith({ value: "draft", requestId });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels by request id and reports AbortError", async () => {
    const controller = new AbortController();
    let resolveRequest: ((value: string) => void) | undefined;
    const invoke = vi.fn(
      (input: { requestId: string }) =>
        new Promise<string>((resolve) => {
          resolveRequest = resolve;
          expect(input.requestId).toBe("agent-fixed");
        })
    );
    const cancel = vi.fn(async () => {
      resolveRequest?.("cancelled");
    });

    const request = invokeWithRendererAbort({
      input: { requestId: "agent-fixed" },
      signal: controller.signal,
      requestPrefix: "agent",
      invoke,
      cancel
    });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("agent-fixed");
  });

  it("does not invoke an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const invoke = vi.fn(async () => "unused");

    await expect(
      invokeWithRendererAbort({
        input: {},
        signal: controller.signal,
        requestPrefix: "planning",
        invoke,
        cancel: async () => undefined
      })
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
