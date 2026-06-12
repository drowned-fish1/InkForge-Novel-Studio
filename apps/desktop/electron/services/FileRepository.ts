import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export class FileRepository {
  async ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }

  async readJson<T>(filePath: string): Promise<T> {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  }

  async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await this.writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  async readText(filePath: string): Promise<string> {
    return readFile(filePath, "utf8");
  }

  async writeTextAtomic(filePath: string, value: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, value, "utf8");
    await rename(tempPath, filePath);
  }

  assertInsideProject(projectPath: string, relativeFile: string): string {
    const resolvedProject = path.resolve(projectPath);
    const resolvedFile = path.resolve(projectPath, relativeFile);
    if (resolvedFile !== resolvedProject && !resolvedFile.startsWith(`${resolvedProject}${path.sep}`)) {
      throw new Error("Blocked path outside the current novel project.");
    }
    return resolvedFile;
  }
}
