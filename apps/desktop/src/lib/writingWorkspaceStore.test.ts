import { describe, expect, it, vi } from "vitest";
import { WritingWorkspaceSchema } from "@inkforge/schemas";

const storage = vi.hoisted(() => ({
  workspace: { annotations: [], bookmarks: [], fragments: [], sessions: [] } as unknown,
  fail: false
}));
vi.mock("@/lib/browserBridge", () => ({
  bridge: {
    loadWritingWorkspace: async () => structuredClone(storage.workspace),
    saveWritingWorkspace: async (_path: string, workspace: unknown) => {
      if (storage.fail) {
        storage.fail = false;
        throw new Error("disk full");
      }
      storage.workspace = structuredClone(workspace);
      return structuredClone(workspace);
    }
  }
}));
import { loadLatestWritingWorkspace, mutateWritingWorkspace, subscribeWritingWorkspace } from "./writingWorkspaceStore";

describe("shared writing workspace persistence", () => {
  it("serializes concurrent notes, daily plans and release writes without dropping either", async () => {
    storage.workspace = WritingWorkspaceSchema.parse({});
    const notifications: string[] = [];
    const unsubscribe = subscribeWritingWorkspace((path) => notifications.push(path));
    const writes = [
      mutateWritingWorkspace("test-project", (state) => ({
        ...state,
        dailyWriting: { templates: [], activeTemplateId: "daily-standard", plans: [] }
      })),
      mutateWritingWorkspace("test-project", (state) => ({
        ...state,
        releases: [{ chapterId: "c", status: "ready", updatedAt: "now" }]
      }))
    ];
    const loaded = await loadLatestWritingWorkspace("test-project");
    await Promise.all(writes);
    expect(loaded.dailyWriting).toBeDefined();
    expect(loaded.releases).toHaveLength(1);
    expect(notifications).toEqual(["test-project", "test-project"]);
    unsubscribe();
  });
  it("recovers after a failed save and publishes only successful changes", async () => {
    storage.workspace = WritingWorkspaceSchema.parse({});
    storage.fail = true;
    await expect(mutateWritingWorkspace("test-project", (state) => ({ ...state, releases: [] }))).rejects.toThrow(
      "disk full"
    );
    const next = await mutateWritingWorkspace("test-project", (state) => ({
      ...state,
      dailyWriting: { templates: [], activeTemplateId: "daily-light", plans: [] }
    }));
    expect(next.dailyWriting?.activeTemplateId).toBe("daily-light");
  });
});
