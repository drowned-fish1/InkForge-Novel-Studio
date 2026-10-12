import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FileRepository } from "./FileRepository.js";
import { ContinuationRunStore } from "./ContinuationRunStore.js";

const record = (id: string) => ({
  id,
  chapterId: "chapter",
  updatedAt: "2026-10-11",
  status: "blocked",
  draft: "长正文".repeat(1000),
  branchId: `branch-${id}`,
  validation: { hardFailures: 1 }
});
describe("continuation records", () => {
  it("migrates without changing legacy data, updates only one body, and survives restart", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "inkforge-run-store-"));
    try {
      const files = new FileRepository();
      const legacy = files.assertInsideProject(project, ".inkforge/continuation/runs.json");
      await files.writeJsonAtomic(legacy, [record("a"), record("b")]);
      const original = await readFile(legacy, "utf8");
      const store = new ContinuationRunStore(files, (raw) => raw as ReturnType<typeof record>);
      expect(await store.list(project)).toHaveLength(2);
      const writes = vi.spyOn(files, "writeJsonAtomic");
      await store.save(project, { ...record("a"), status: "completed", validation: { hardFailures: 0 } });
      expect(writes).toHaveBeenCalledTimes(2);
      const index = writes.mock.calls.find(([file]) => file.endsWith("index.json"))![1];
      expect(JSON.stringify(index)).not.toContain("长正文");
      expect(await readFile(legacy, "utf8")).toBe(original);
      const reopened = new ContinuationRunStore(files, (raw) => raw as ReturnType<typeof record>);
      expect(await reopened.get(project, "a")).toMatchObject({ status: "completed" });
      expect(await reopened.summaries(project)).toContainEqual(
        expect.objectContaining({ branchId: "branch-b", status: "blocked", validation: { hardFailures: 1 } })
      );
      await Promise.all([store.save(project, record("c")), reopened.save(project, record("d"))]);
      expect(await reopened.list(project)).toHaveLength(4);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
  it("keeps legacy authoritative after an interrupted migration", async () => {
    const project = await mkdtemp(path.join(os.tmpdir(), "inkforge-run-migration-"));
    try {
      const files = new FileRepository();
      await files.writeJsonAtomic(files.assertInsideProject(project, ".inkforge/continuation/runs.json"), [
        record("a")
      ]);
      const write = files.writeJsonAtomic.bind(files);
      vi.spyOn(files, "writeJsonAtomic").mockImplementation(async (file, value) => {
        if (file.endsWith("index.json")) throw new Error("disk full");
        await write(file, value);
      });
      const store = new ContinuationRunStore(files, (raw) => raw as ReturnType<typeof record>);
      await expect(store.list(project)).rejects.toThrow("disk full");
      expect(await store.summaries(project)).toEqual([record("a")]);
      vi.restoreAllMocks();
      expect(await store.list(project)).toEqual([record("a")]);
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
