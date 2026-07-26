import { copyFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  AgentExtensionConfigSchema,
  BackupSnapshotSchema,
  WritingWorkspaceSchema,
  type AgentExtensionConfig,
  type BackupSnapshot,
  type WritingWorkspace
} from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";

const automaticIntervalMs = 10 * 60 * 1000;
const maxAutomaticSnapshots = 20;

const safeStamp = (): string => new Date().toISOString().replace(/[:.]/gu, "-");

export class WorkspaceService {
  private readonly automaticBackups = new Map<string, Promise<BackupSnapshot | undefined>>();

  constructor(private readonly files = new FileRepository()) {}

  async listBackups(projectPath: string): Promise<BackupSnapshot[]> {
    const root = this.backupRoot(projectPath);
    const names = await readdir(root).catch(() => []);
    const snapshots: BackupSnapshot[] = [];
    for (const name of names) {
      try {
        snapshots.push(BackupSnapshotSchema.parse(await this.files.readJson(path.join(root, name, "manifest.json"))));
      } catch {
        // Ignore incomplete snapshots left by an interrupted copy.
      }
    }
    return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createBackup(
    projectPath: string,
    reason: BackupSnapshot["reason"] = "manual",
    label = ""
  ): Promise<BackupSnapshot> {
    const id = `${safeStamp()}-${Math.random().toString(36).slice(2, 8)}`;
    const snapshotDir = path.join(this.backupRoot(projectPath), id);
    const contentDir = path.join(snapshotDir, "project");
    const backupRoot = path.resolve(this.backupRoot(projectPath));
    await this.files.ensureDir(snapshotDir);
    await this.copyDirectory(projectPath, contentDir, backupRoot);
    const totals = await this.measureDirectory(contentDir);
    const snapshot = BackupSnapshotSchema.parse({
      id,
      createdAt: new Date().toISOString(),
      reason,
      label: label.trim(),
      ...totals
    });
    await this.files.writeJsonAtomic(path.join(snapshotDir, "manifest.json"), snapshot);
    if (reason === "automatic") {
      await this.pruneAutomaticBackups(projectPath);
    }
    return snapshot;
  }

  async ensureAutomaticBackup(projectPath: string): Promise<BackupSnapshot | undefined> {
    const key = path.resolve(projectPath);
    const pending = this.automaticBackups.get(key);
    if (pending) {
      return pending;
    }
    const operation = (async () => {
      const latest = (await this.listBackups(projectPath)).find((item) => item.reason === "automatic");
      if (latest && Date.now() - new Date(latest.createdAt).getTime() < automaticIntervalMs) {
        return undefined;
      }
      return this.createBackup(projectPath, "automatic", "自动保存快照");
    })();
    this.automaticBackups.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.automaticBackups.get(key) === operation) {
        this.automaticBackups.delete(key);
      }
    }
  }

  async restoreBackup(projectPath: string, snapshotId: string): Promise<void> {
    const snapshot = await this.readBackup(projectPath, snapshotId);
    await this.createBackup(projectPath, "before-restore", `恢复 ${snapshot.createdAt} 前`);
    const source = path.join(this.backupRoot(projectPath), snapshotId, "project");
    await this.restoreDirectory(source, projectPath, path.resolve(this.backupRoot(projectPath)));
  }

  async deleteBackup(projectPath: string, snapshotId: string): Promise<void> {
    await this.readBackup(projectPath, snapshotId);
    const target = this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "backups", snapshotId));
    await rm(target, { recursive: true, force: true });
  }

  async loadWritingWorkspace(projectPath: string): Promise<WritingWorkspace> {
    try {
      return WritingWorkspaceSchema.parse(await this.files.readJson(this.writingWorkspacePath(projectPath)));
    } catch {
      return WritingWorkspaceSchema.parse({});
    }
  }

  async saveWritingWorkspace(projectPath: string, workspace: WritingWorkspace): Promise<WritingWorkspace> {
    const parsed = WritingWorkspaceSchema.parse(workspace);
    await this.files.writeJsonAtomic(this.writingWorkspacePath(projectPath), parsed);
    return parsed;
  }

  async loadAgentExtensions(projectPath: string): Promise<AgentExtensionConfig> {
    try {
      return AgentExtensionConfigSchema.parse(await this.files.readJson(this.agentExtensionsPath(projectPath)));
    } catch {
      return AgentExtensionConfigSchema.parse({});
    }
  }

  async saveAgentExtensions(projectPath: string, config: AgentExtensionConfig): Promise<AgentExtensionConfig> {
    const parsed = AgentExtensionConfigSchema.parse(config);
    await this.files.writeJsonAtomic(this.agentExtensionsPath(projectPath), parsed);
    return parsed;
  }

  private async readBackup(projectPath: string, snapshotId: string): Promise<BackupSnapshot> {
    if (!/^(?!\.{1,2}$)[\w.-]+$/u.test(snapshotId)) {
      throw new Error("Invalid backup id.");
    }
    return BackupSnapshotSchema.parse(
      await this.files.readJson(path.join(this.backupRoot(projectPath), snapshotId, "manifest.json"))
    );
  }

  private backupRoot(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "backups"));
  }

  private writingWorkspacePath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "writing-workspace.json"));
  }

  private agentExtensionsPath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "agent-extensions.json"));
  }

  private async measureDirectory(dir: string): Promise<{ fileCount: number; size: number }> {
    let fileCount = 0;
    let size = 0;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.measureDirectory(entryPath);
        fileCount += nested.fileCount;
        size += nested.size;
      } else if (entry.isFile()) {
        fileCount += 1;
        size += (await stat(entryPath)).size;
      }
    }
    return { fileCount, size };
  }

  private async copyDirectory(source: string, destination: string, excludedRoot?: string): Promise<void> {
    await this.files.ensureDir(destination);
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const sourcePath = path.join(source, entry.name);
      const resolved = path.resolve(sourcePath);
      if (excludedRoot && (resolved === excludedRoot || resolved.startsWith(`${excludedRoot}${path.sep}`))) {
        continue;
      }
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destinationPath, excludedRoot);
      } else if (entry.isFile()) {
        await this.files.ensureDir(path.dirname(destinationPath));
        await copyFile(sourcePath, destinationPath);
      }
    }
  }

  private async restoreDirectory(source: string, destination: string, preservedPath: string): Promise<void> {
    await this.files.ensureDir(destination);
    const sourceEntries = await readdir(source, { withFileTypes: true });
    const destinationEntries = await readdir(destination, { withFileTypes: true });
    const sourceNames = new Set(sourceEntries.map((entry) => entry.name));

    for (const entry of destinationEntries) {
      const destinationPath = path.join(destination, entry.name);
      if (!sourceNames.has(entry.name) && !samePath(destinationPath, preservedPath)) {
        await rm(destinationPath, { recursive: true, force: true });
      }
    }

    const destinationByName = new Map(destinationEntries.map((entry) => [entry.name, entry]));
    for (const entry of sourceEntries) {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      const destinationEntry = destinationByName.get(entry.name);
      if (entry.isDirectory()) {
        if (destinationEntry && !destinationEntry.isDirectory()) {
          await rm(destinationPath, { recursive: true, force: true });
        }
        await this.restoreDirectory(sourcePath, destinationPath, preservedPath);
      } else if (entry.isFile()) {
        if (destinationEntry?.isDirectory()) {
          await rm(destinationPath, { recursive: true, force: true });
        }
        await this.files.ensureDir(path.dirname(destinationPath));
        await copyFile(sourcePath, destinationPath);
      }
    }
  }

  private async pruneAutomaticBackups(projectPath: string): Promise<void> {
    const automatic = (await this.listBackups(projectPath)).filter((item) => item.reason === "automatic");
    for (const snapshot of automatic.slice(maxAutomaticSnapshots)) {
      await this.deleteBackup(projectPath, snapshot.id);
    }
  }
}

const samePath = (left: string, right: string): boolean =>
  process.platform === "win32"
    ? path.resolve(left).toLocaleLowerCase() === path.resolve(right).toLocaleLowerCase()
    : path.resolve(left) === path.resolve(right);
