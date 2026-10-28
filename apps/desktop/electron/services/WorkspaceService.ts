import { createHash } from "node:crypto";
import { copyFile, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  AgentExtensionConfigSchema,
  migrateProjectDataTools,
  BackupDiffSummarySchema,
  BackupInspectionSchema,
  BackupSettingsSchema,
  BackupSnapshotSchema,
  BackupVerificationSchema,
  WritingWorkspaceSchema,
  type AgentExtensionConfig,
  type BackupDiffSummary,
  type BackupInspection,
  type BackupSettings,
  type BackupSnapshot,
  type BackupVerification,
  type WritingWorkspace
} from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";

const backupMetaFiles = [
  "project.novel.json",
  "outline.json",
  "timeline.json",
  "clues.json",
  "terms.json",
  "project-data.json"
];

const safeStamp = (): string => new Date().toISOString().replace(/[:.]/gu, "-");

const sha256 = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

export class WorkspaceService {
  private readonly automaticBackups = new Map<string, Promise<BackupSnapshot | undefined>>();

  constructor(private readonly files = new FileRepository()) {}

  async loadBackupSettings(projectPath: string): Promise<BackupSettings> {
    try {
      return BackupSettingsSchema.parse(await this.files.readJson(this.backupSettingsPath(projectPath)));
    } catch {
      return BackupSettingsSchema.parse({});
    }
  }

  async saveBackupSettings(projectPath: string, settings: BackupSettings): Promise<BackupSettings> {
    const parsed = BackupSettingsSchema.parse(settings);
    if (parsed.backupDirectory) {
      if (!path.isAbsolute(parsed.backupDirectory)) {
        throw new Error("备份目录必须是绝对路径。");
      }
      const resolvedCustom = path.resolve(parsed.backupDirectory);
      const resolvedProject = path.resolve(projectPath);
      if (resolvedCustom === resolvedProject || resolvedCustom.startsWith(`${resolvedProject}${path.sep}`)) {
        throw new Error("备份目录不能位于项目文件夹内部，请选择项目之外的位置。");
      }
    }
    await this.files.writeJsonAtomic(this.backupSettingsPath(projectPath), parsed);
    return parsed;
  }

  async listBackups(projectPath: string): Promise<BackupSnapshot[]> {
    return (await this.inspectBackups(projectPath)).snapshots;
  }

  async inspectBackups(projectPath: string): Promise<BackupInspection> {
    const root = await this.backupRoot(projectPath);
    const names = await readdir(root).catch(() => []);
    const snapshots: BackupSnapshot[] = [];
    const corrupted: string[] = [];
    for (const name of names) {
      const manifestPath = path.join(root, name, "manifest.json");
      try {
        snapshots.push(BackupSnapshotSchema.parse(await this.files.readJson(manifestPath)));
      } catch {
        const entry = await stat(path.join(root, name)).catch(() => undefined);
        if (entry?.isDirectory()) {
          corrupted.push(name);
        }
      }
    }
    snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return BackupInspectionSchema.parse({
      snapshots,
      corrupted,
      totalSize: snapshots.reduce((total, item) => total + item.size, 0),
      backupRoot: root
    });
  }

  async createBackup(
    projectPath: string,
    reason: BackupSnapshot["reason"] = "manual",
    label = ""
  ): Promise<BackupSnapshot> {
    const settings = await this.loadBackupSettings(projectPath);
    const root = await this.backupRoot(projectPath, settings);
    const previous = (await this.inspectBackups(projectPath)).snapshots[0];
    const id = `${safeStamp()}-${Math.random().toString(36).slice(2, 8)}`;
    const snapshotDir = path.join(root, id);
    const contentDir = path.join(snapshotDir, "project");
    try {
      await this.files.ensureDir(snapshotDir);
      await this.copyDirectory(projectPath, contentDir, this.excludedRoots(projectPath, root));
      const totals = await this.measureDirectory(contentDir);
      const chapterHashes = await this.hashChapters(contentDir);
      const changedChapterFiles = diffHashKeys(previous?.chapterHashes ?? {}, chapterHashes);
      const snapshot = BackupSnapshotSchema.parse({
        id,
        createdAt: new Date().toISOString(),
        reason,
        label: label.trim(),
        chapterHashes,
        changedChapterFiles,
        ...totals
      });
      await this.files.writeJsonAtomic(path.join(snapshotDir, "manifest.json"), snapshot);
      if (reason === "automatic") {
        await this.pruneAutomaticBackups(projectPath, settings);
      }
      await this.enforceDiskCap(projectPath, settings, snapshot.id);
      return snapshot;
    } catch (error) {
      // A failed copy must not leave a corrupt snapshot that appears in the
      // recovery UI. Atomic writer temp files can also disappear mid-scan.
      await rm(snapshotDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async ensureAutomaticBackup(projectPath: string): Promise<BackupSnapshot | undefined> {
    const key = path.resolve(projectPath);
    const pending = this.automaticBackups.get(key);
    if (pending) {
      return pending;
    }
    const operation = (async () => {
      const settings = await this.loadBackupSettings(projectPath);
      const intervalMs = settings.automaticIntervalMinutes * 60 * 1000;
      const latest = (await this.listBackups(projectPath)).find((item) => item.reason === "automatic");
      if (latest && Date.now() - new Date(latest.createdAt).getTime() < intervalMs) {
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

  async verifyBackup(projectPath: string, snapshotId: string): Promise<BackupVerification> {
    const snapshot = await this.readBackup(projectPath, snapshotId);
    const contentDir = path.join(await this.backupRoot(projectPath), snapshotId, "project");
    const issues: string[] = [];
    let checkedFiles = 0;
    const totals = await this.measureDirectory(contentDir).catch(() => undefined);
    if (!totals) {
      issues.push("快照内容目录缺失或不可读取。");
    } else {
      if (totals.fileCount !== snapshot.fileCount) {
        issues.push(`文件数量不一致：清单记录 ${snapshot.fileCount}，实际 ${totals.fileCount}。`);
      }
      if (totals.size !== snapshot.size) {
        issues.push(`总大小不一致：清单记录 ${snapshot.size} 字节，实际 ${totals.size} 字节。`);
      }
    }
    for (const [file, expected] of Object.entries(snapshot.chapterHashes)) {
      checkedFiles += 1;
      const absolute = this.resolveSnapshotFile(contentDir, file);
      try {
        const actual = sha256(await readFile(absolute));
        if (actual !== expected) {
          issues.push(`章节内容被改动或损坏：${file}`);
        }
      } catch {
        issues.push(`章节文件缺失：${file}`);
      }
    }
    if (!Object.keys(snapshot.chapterHashes).length) {
      issues.push("此快照创建于旧版本，没有章节校验信息，仅完成结构检查。");
    }
    return BackupVerificationSchema.parse({
      snapshotId,
      ok: issues.every((issue) => issue.startsWith("此快照创建于旧版本")),
      checkedFiles,
      issues
    });
  }

  async diffBackup(projectPath: string, snapshotId: string): Promise<BackupDiffSummary> {
    await this.readBackup(projectPath, snapshotId);
    const contentDir = path.join(await this.backupRoot(projectPath), snapshotId, "project");
    const snapshotHashes = await this.hashChapters(contentDir);
    const currentHashes = await this.hashChapters(path.resolve(projectPath));
    const addedChapters: string[] = [];
    const removedChapters: string[] = [];
    const modifiedChapters: string[] = [];
    for (const file of Object.keys(currentHashes)) {
      if (!(file in snapshotHashes)) {
        addedChapters.push(file);
      } else if (snapshotHashes[file] !== currentHashes[file]) {
        modifiedChapters.push(file);
      }
    }
    for (const file of Object.keys(snapshotHashes)) {
      if (!(file in currentHashes)) {
        removedChapters.push(file);
      }
    }
    const changedMetaFiles: string[] = [];
    for (const file of backupMetaFiles) {
      const snapshotContent = await readFile(path.join(contentDir, file), "utf8").catch(() => undefined);
      const currentContent = await readFile(path.join(path.resolve(projectPath), file), "utf8").catch(() => undefined);
      if (snapshotContent !== currentContent) {
        changedMetaFiles.push(file);
      }
    }
    return BackupDiffSummarySchema.parse({
      snapshotId,
      addedChapters: addedChapters.sort(),
      removedChapters: removedChapters.sort(),
      modifiedChapters: modifiedChapters.sort(),
      changedMetaFiles
    });
  }

  async readBackupFile(projectPath: string, snapshotId: string, relativeFile: string): Promise<string> {
    await this.readBackup(projectPath, snapshotId);
    const contentDir = path.join(await this.backupRoot(projectPath), snapshotId, "project");
    return readFile(this.resolveSnapshotFile(contentDir, relativeFile), "utf8");
  }

  async restoreBackup(projectPath: string, snapshotId: string): Promise<void> {
    const snapshot = await this.readBackup(projectPath, snapshotId);
    await this.createBackup(projectPath, "before-restore", `恢复 ${snapshot.createdAt} 前`);
    const root = await this.backupRoot(projectPath);
    const source = path.join(root, snapshotId, "project");
    await this.restoreDirectory(source, path.resolve(projectPath), this.preservedRestorePaths(projectPath, root));
  }

  async deleteBackup(projectPath: string, snapshotId: string): Promise<void> {
    if (!isSafeSnapshotId(snapshotId)) {
      throw new Error("Invalid backup id.");
    }
    const root = await this.backupRoot(projectPath);
    await rm(path.join(root, snapshotId), { recursive: true, force: true });
  }

  async loadWritingWorkspace(projectPath: string): Promise<WritingWorkspace> {
    try {
      return WritingWorkspaceSchema.parse(await this.files.readJson(this.writingWorkspacePath(projectPath)));
    } catch (cause) {
      if (isMissingFile(cause)) return WritingWorkspaceSchema.parse({});
      throw new Error(
        `写作记录文件无法读取，请检查 .inkforge/writing-workspace.json：${cause instanceof Error ? cause.message : String(cause)}`
      );
    }
  }

  async saveWritingWorkspace(projectPath: string, workspace: WritingWorkspace): Promise<WritingWorkspace> {
    const parsed = WritingWorkspaceSchema.parse(workspace);
    await this.files.writeJsonAtomic(this.writingWorkspacePath(projectPath), parsed);
    return parsed;
  }

  async loadAgentExtensions(projectPath: string): Promise<AgentExtensionConfig> {
    try {
      const config = AgentExtensionConfigSchema.parse(await this.files.readJson(this.agentExtensionsPath(projectPath)));
      const migrated = migrateProjectDataTools(config);
      if (config.projectDataToolsVersion !== 1)
        await this.files.writeJsonAtomic(this.agentExtensionsPath(projectPath), migrated);
      return migrated;
    } catch {
      return AgentExtensionConfigSchema.parse({});
    }
  }

  async saveAgentExtensions(projectPath: string, config: AgentExtensionConfig): Promise<AgentExtensionConfig> {
    const parsed = AgentExtensionConfigSchema.parse({ ...config, projectDataToolsVersion: 1 });
    await this.files.writeJsonAtomic(this.agentExtensionsPath(projectPath), parsed);
    return parsed;
  }

  private async readBackup(projectPath: string, snapshotId: string): Promise<BackupSnapshot> {
    if (!isSafeSnapshotId(snapshotId)) {
      throw new Error("Invalid backup id.");
    }
    const root = await this.backupRoot(projectPath);
    return BackupSnapshotSchema.parse(await this.files.readJson(path.join(root, snapshotId, "manifest.json")));
  }

  private async backupRoot(projectPath: string, presetSettings?: BackupSettings): Promise<string> {
    const settings = presetSettings ?? (await this.loadBackupSettings(projectPath));
    if (settings.backupDirectory && path.isAbsolute(settings.backupDirectory)) {
      const resolvedProject = path.resolve(projectPath);
      const resolvedCustom = path.resolve(settings.backupDirectory);
      if (resolvedCustom !== resolvedProject && !resolvedCustom.startsWith(`${resolvedProject}${path.sep}`)) {
        const folder = `${path.basename(resolvedProject)}-${sha256(resolvedProject).slice(0, 8)}`;
        return path.join(resolvedCustom, folder);
      }
    }
    return this.defaultBackupRoot(projectPath);
  }

  private defaultBackupRoot(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "backups"));
  }

  private excludedRoots(projectPath: string, activeRoot: string): string[] {
    const roots = new Set([path.resolve(this.defaultBackupRoot(projectPath)), path.resolve(activeRoot)]);
    return [...roots];
  }

  private preservedRestorePaths(projectPath: string, activeRoot: string): string[] {
    return [
      path.resolve(this.defaultBackupRoot(projectPath)),
      path.resolve(activeRoot),
      path.resolve(this.backupSettingsPath(projectPath))
    ];
  }

  private backupSettingsPath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "backup-settings.json"));
  }

  private writingWorkspacePath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "writing-workspace.json"));
  }

  private agentExtensionsPath(projectPath: string): string {
    return this.files.assertInsideProject(projectPath, path.posix.join(".inkforge", "agent-extensions.json"));
  }

  private resolveSnapshotFile(contentDir: string, relativeFile: string): string {
    const resolvedRoot = path.resolve(contentDir);
    const resolved = path.resolve(contentDir, relativeFile);
    if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("Blocked path outside the backup snapshot.");
    }
    return resolved;
  }

  private async hashChapters(rootDir: string): Promise<Record<string, string>> {
    const chaptersDir = path.join(rootDir, "chapters");
    const hashes: Record<string, string> = {};
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const entryPath = path.join(dir, entry.name);
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(entryPath, relative);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          hashes[`chapters/${relative}`] = sha256(await readFile(entryPath));
        }
      }
    };
    await walk(chaptersDir, "");
    return hashes;
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

  private async copyDirectory(source: string, destination: string, excludedRoots: string[] = []): Promise<void> {
    await this.files.ensureDir(destination);
    for (const entry of await readdir(source, { withFileTypes: true })) {
      // FileRepository writes through <name>.<pid>.<timestamp>.tmp and then
      // renames. Such a file is both disposable and liable to vanish between
      // readdir() and copyFile().
      if (entry.isFile() && isAtomicTempFile(entry.name)) {
        continue;
      }
      const sourcePath = path.join(source, entry.name);
      const resolved = path.resolve(sourcePath);
      if (excludedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
        continue;
      }
      const destinationPath = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destinationPath, excludedRoots);
      } else if (entry.isFile()) {
        await this.files.ensureDir(path.dirname(destinationPath));
        try {
          await copyFile(sourcePath, destinationPath);
        } catch (error) {
          if (!isMissingFile(error)) {
            throw error;
          }
          // A concurrently removed cache/export file is not part of the
          // completed point-in-time snapshot. Canonical project writes use an
          // atomic rename, so their final path remains readable.
        }
      }
    }
  }

  private async restoreDirectory(source: string, destination: string, preservedPaths: string[]): Promise<void> {
    await this.files.ensureDir(destination);
    const sourceEntries = await readdir(source, { withFileTypes: true });
    const destinationEntries = await readdir(destination, { withFileTypes: true });
    const sourceNames = new Set(sourceEntries.map((entry) => entry.name));

    for (const entry of destinationEntries) {
      const destinationPath = path.join(destination, entry.name);
      if (!sourceNames.has(entry.name) && !preservedPaths.some((preserved) => samePath(destinationPath, preserved))) {
        await rm(destinationPath, { recursive: true, force: true });
      }
    }

    const destinationByName = new Map(destinationEntries.map((entry) => [entry.name, entry]));
    for (const entry of sourceEntries) {
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      if (preservedPaths.some((preserved) => samePath(destinationPath, preserved))) {
        continue;
      }
      const destinationEntry = destinationByName.get(entry.name);
      if (entry.isDirectory()) {
        if (destinationEntry && !destinationEntry.isDirectory()) {
          await rm(destinationPath, { recursive: true, force: true });
        }
        await this.restoreDirectory(sourcePath, destinationPath, preservedPaths);
      } else if (entry.isFile()) {
        if (destinationEntry?.isDirectory()) {
          await rm(destinationPath, { recursive: true, force: true });
        }
        await this.files.ensureDir(path.dirname(destinationPath));
        await copyFile(sourcePath, destinationPath);
      }
    }
  }

  private async pruneAutomaticBackups(projectPath: string, settings: BackupSettings): Promise<void> {
    const automatic = (await this.listBackups(projectPath)).filter((item) => item.reason === "automatic");
    for (const snapshot of automatic.slice(settings.maxAutomaticSnapshots)) {
      await this.deleteBackup(projectPath, snapshot.id);
    }
  }

  private async enforceDiskCap(projectPath: string, settings: BackupSettings, keepId: string): Promise<void> {
    const capBytes = settings.maxTotalSizeMb * 1024 * 1024;
    const snapshots = (await this.listBackups(projectPath)).sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt)
    );
    let total = snapshots.reduce((sum, item) => sum + item.size, 0);
    for (const snapshot of snapshots) {
      if (total <= capBytes) {
        break;
      }
      if (snapshot.id === keepId || snapshot.reason !== "automatic") {
        continue;
      }
      await this.deleteBackup(projectPath, snapshot.id);
      total -= snapshot.size;
    }
  }
}

const isSafeSnapshotId = (snapshotId: string): boolean => /^(?!\.{1,2}$)[\w.-]+$/u.test(snapshotId);
const isAtomicTempFile = (name: string): boolean => /\.\d+\.\d+\.tmp$/u.test(name);
const isMissingFile = (error: unknown): boolean =>
  Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");

const samePath = (left: string, right: string): boolean =>
  process.platform === "win32"
    ? path.resolve(left).toLocaleLowerCase() === path.resolve(right).toLocaleLowerCase()
    : path.resolve(left) === path.resolve(right);

const diffHashKeys = (previous: Record<string, string>, next: Record<string, string>): string[] => {
  const changed = new Set<string>();
  for (const [file, hash] of Object.entries(next)) {
    if (previous[file] !== hash) {
      changed.add(file);
    }
  }
  for (const file of Object.keys(previous)) {
    if (!(file in next)) {
      changed.add(file);
    }
  }
  return [...changed].sort();
};
