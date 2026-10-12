import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ProjectDataSchema } from "@inkforge/schemas";
import { SourceEvidenceValidator } from "./SourceEvidenceValidator.js";

const original = "余额五枚。";
const ref = {
  chapterId: "c1",
  startOffset: 0,
  endOffset: 4,
  excerpt: "余额五枚",
  contentHash: createHash("sha256").update(original).digest("hex")
};
describe("current source evidence", () => {
  it("preserves exact quotes after appending and reads each chapter once", async () => {
    const files = {
      assertInsideProject: (_project: string, file: string) => file,
      readText: vi.fn(async () => original + "后来离店。")
    };
    const validator = new SourceEvidenceValidator(files as never, "project", [{ id: "c1", file: "c1.md" }]);
    const document = ProjectDataSchema.parse({ entries: [{ key: "余额", content: 5, sources: [ref] }] });
    expect((await validator.filterData(document)).entries).toHaveLength(1);
    expect(await validator.filter([ref, ref])).toHaveLength(2);
    expect(files.readText).toHaveBeenCalledTimes(1);
    expect(validator.warnings.join(" ")).toContain("语义状态需核对");
  });
  it("omits changed quotes and deleted chapters without mutating saved records", async () => {
    const files = {
      assertInsideProject: (_project: string, file: string) => file,
      readText: vi.fn(async () => "余额十枚。")
    };
    const validator = new SourceEvidenceValidator(files as never, "project", [{ id: "c1", file: "c1.md" }]);
    const document = ProjectDataSchema.parse({ entries: [{ key: "余额", content: 5, sources: [ref] }] });
    expect((await validator.filterData(document)).entries).toEqual([]);
    expect(await validator.valid({ ...ref, chapterId: "deleted" })).toBe(false);
    expect(document.entries).toHaveLength(1);
  });
  it("does not conceal filesystem failures", async () => {
    const files = {
      assertInsideProject: () => "c1.md",
      readText: vi.fn(async () => {
        throw new Error("permission denied");
      })
    };
    await expect(
      new SourceEvidenceValidator(files as never, "project", [{ id: "c1", file: "c1.md" }]).valid(ref)
    ).rejects.toThrow("permission denied");
  });
});
