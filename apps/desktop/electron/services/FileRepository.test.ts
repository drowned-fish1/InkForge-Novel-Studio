import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileRepository } from "./FileRepository.js";

const temporaryRoots: string[] = [];

const createRoot = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-files-"));
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("FileRepository.assertInsideProject", () => {
  it("allows paths inside the project and the project root itself", async () => {
    const root = await createRoot();
    const files = new FileRepository();
    expect(files.assertInsideProject(root, "chapters/ch-0001.md")).toBe(path.resolve(root, "chapters/ch-0001.md"));
    expect(files.assertInsideProject(root, ".")).toBe(path.resolve(root));
  });

  it("blocks traversal, absolute escapes and sibling-prefix tricks", async () => {
    const root = await createRoot();
    const files = new FileRepository();
    expect(() => files.assertInsideProject(root, "../outside.txt")).toThrow("Blocked path");
    expect(() => files.assertInsideProject(root, "chapters/../../outside.txt")).toThrow("Blocked path");
    expect(() => files.assertInsideProject(root, path.join(os.tmpdir(), "abs.txt"))).toThrow("Blocked path");
    // A sibling directory that shares the project path as a string prefix.
    expect(() => files.assertInsideProject(root, `${root}-evil/x.txt`)).toThrow("Blocked path");
  });

  it("writes atomically without leaving temp files behind", async () => {
    const root = await createRoot();
    const files = new FileRepository();
    const target = path.join(root, "nested", "value.json");
    await files.writeJsonAtomic(target, { ok: true });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ ok: true });
    const siblings = await import("node:fs/promises").then((fs) => fs.readdir(path.dirname(target)));
    expect(siblings.filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("readJson surfaces malformed JSON as an error instead of silent data", async () => {
    const root = await createRoot();
    const files = new FileRepository();
    const target = path.join(root, "broken.json");
    await writeFile(target, "{not json", "utf8");
    await expect(files.readJson(target)).rejects.toThrow();
  });
});