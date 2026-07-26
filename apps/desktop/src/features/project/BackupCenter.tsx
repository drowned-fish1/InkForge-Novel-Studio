import { useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  Clock3,
  DatabaseBackup,
  FileDiff,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import type { BackupDiffSummary, BackupSettings, BackupSnapshot, BackupVerification } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { diffTextLines, type TextDiffLine } from "@/lib/textDiffLines";
import { useProjectStore } from "@/stores/useProjectStore";

const reasonLabels: Record<BackupSnapshot["reason"], string> = {
  automatic: "自动快照",
  manual: "手动备份",
  "before-restore": "恢复保护点"
};

const formatSize = (size: number) =>
  size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`;

interface RestorePreview {
  snapshot: BackupSnapshot;
  diff: BackupDiffSummary;
}

export const BackupCenter = () => {
  const project = useProjectStore((state) => state.project);
  const openProject = useProjectStore((state) => state.openProject);
  const saveCurrentChapter = useProjectStore((state) => state.saveCurrentChapter);
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [corrupted, setCorrupted] = useState<string[]>([]);
  const [backupRoot, setBackupRoot] = useState("");
  const [totalSize, setTotalSize] = useState(0);
  const [settings, setSettings] = useState<BackupSettings | undefined>();
  const [settingsDraft, setSettingsDraft] = useState({ interval: "10", retention: "20", cap: "512" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verifications, setVerifications] = useState<Record<string, BackupVerification>>({});
  const [restorePreview, setRestorePreview] = useState<RestorePreview | undefined>();
  const [diffFile, setDiffFile] = useState<string | undefined>();
  const [diffLines, setDiffLines] = useState<TextDiffLine[] | undefined>();
  const [diffError, setDiffError] = useState("");

  const chapterTitleByFile = useMemo(() => {
    const map = new Map<string, string>();
    for (const volume of project?.outline.volumes ?? []) {
      for (const chapter of volume.chapters) {
        map.set(chapter.file, chapter.title);
      }
    }
    return map;
  }, [project?.outline.volumes]);

  const chapterLabel = (file: string) => chapterTitleByFile.get(file) ?? file;

  const refresh = async () => {
    if (!project) return;
    const inspection = await bridge.inspectBackups(project.projectPath);
    setSnapshots(inspection.snapshots);
    setCorrupted(inspection.corrupted);
    setBackupRoot(inspection.backupRoot);
    setTotalSize(inspection.totalSize);
  };

  useEffect(() => {
    if (!project) return;
    setVerifications({});
    setRestorePreview(undefined);
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "读取备份失败"));
    void bridge
      .loadBackupSettings(project.projectPath)
      .then((loaded) => {
        setSettings(loaded);
        setSettingsDraft({
          interval: String(loaded.automaticIntervalMinutes),
          retention: String(loaded.maxAutomaticSnapshots),
          cap: String(loaded.maxTotalSizeMb)
        });
      })
      .catch(() => undefined);
  }, [project?.projectPath]);

  const persistSettings = async (patch: Partial<BackupSettings>) => {
    if (!project || !settings) return;
    setError("");
    try {
      const next = await bridge.saveBackupSettings(project.projectPath, { ...settings, ...patch });
      setSettings(next);
      setSettingsDraft({
        interval: String(next.automaticIntervalMinutes),
        retention: String(next.maxAutomaticSnapshots),
        cap: String(next.maxTotalSizeMb)
      });
      setNotice("备份设置已保存。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存备份设置失败");
    }
  };

  const saveSettingsDraft = () => {
    const interval = Number.parseInt(settingsDraft.interval, 10);
    const retention = Number.parseInt(settingsDraft.retention, 10);
    const cap = Number.parseInt(settingsDraft.cap, 10);
    void persistSettings({
      automaticIntervalMinutes: Number.isFinite(interval) ? Math.min(1440, Math.max(1, interval)) : 10,
      maxAutomaticSnapshots: Number.isFinite(retention) ? Math.min(200, Math.max(1, retention)) : 20,
      maxTotalSizeMb: Number.isFinite(cap) ? Math.min(102400, Math.max(10, cap)) : 512
    });
  };

  const chooseDirectory = async () => {
    const directory = await bridge.chooseBackupDirectory();
    if (directory === undefined) {
      if (!window.inkforge) {
        setError("浏览器预览无法选择备份目录，请在桌面版设置。");
      }
      return;
    }
    await persistSettings({ backupDirectory: directory });
  };

  const create = async () => {
    if (!project) return;
    setBusy("create");
    setError("");
    setNotice("");
    try {
      await bridge.createBackup(project.projectPath, "手动保护点");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建备份失败");
    } finally {
      setBusy("");
    }
  };

  const verify = async (snapshot: BackupSnapshot) => {
    if (!project) return;
    setBusy(`verify-${snapshot.id}`);
    setError("");
    try {
      const result = await bridge.verifyBackup(project.projectPath, snapshot.id);
      setVerifications((state) => ({ ...state, [snapshot.id]: result }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "完整性检查失败");
    } finally {
      setBusy("");
    }
  };

  const openRestorePreview = async (snapshot: BackupSnapshot) => {
    if (!project) return;
    setBusy(`diff-${snapshot.id}`);
    setError("");
    setDiffFile(undefined);
    setDiffLines(undefined);
    setDiffError("");
    try {
      const diff = await bridge.diffBackup(project.projectPath, snapshot.id);
      setRestorePreview({ snapshot, diff });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "读取快照差异失败");
    } finally {
      setBusy("");
    }
  };

  const showFileDiff = async (file: string, kind: "added" | "removed" | "modified") => {
    if (!project || !restorePreview) return;
    setDiffFile(file);
    setDiffLines(undefined);
    setDiffError("");
    try {
      const snapshotContent =
        kind === "added" ? "" : await bridge.readBackupFile(project.projectPath, restorePreview.snapshot.id, file);
      const currentContent = kind === "removed" ? "" : await bridge.readChapter(project.projectPath, file);
      setDiffLines(diffTextLines(snapshotContent, currentContent));
    } catch (cause) {
      setDiffError(cause instanceof Error ? cause.message : "读取文件内容失败");
    }
  };

  const restore = async () => {
    if (!project || !restorePreview) return;
    const snapshot = restorePreview.snapshot;
    setBusy(snapshot.id);
    setError("");
    try {
      await saveCurrentChapter();
      if (useProjectStore.getState().saveState === "error") {
        throw new Error(useProjectStore.getState().error || "当前章节保存失败，尚未开始恢复。");
      }
      await bridge.restoreBackup(project.projectPath, snapshot.id);
      setRestorePreview(undefined);
      await openProject(project.projectPath);
      await refresh();
      setNotice("已恢复到所选快照，恢复前的状态保存在“恢复保护点”。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "恢复失败");
    } finally {
      setBusy("");
    }
  };

  const remove = async (snapshot: BackupSnapshot) => {
    if (!project || !window.confirm("确定删除这个备份？删除后无法恢复。")) return;
    setBusy(snapshot.id);
    try {
      await bridge.deleteBackup(project.projectPath, snapshot.id);
      await refresh();
    } finally {
      setBusy("");
    }
  };

  const automaticCount = snapshots.filter((item) => item.reason === "automatic").length;
  const capBytes = (settings?.maxTotalSizeMb ?? 512) * 1024 * 1024;
  const capRatio = Math.min(100, Math.round((totalSize / Math.max(1, capBytes)) * 100));

  return (
    <section className="library-screen backup-center">
      <header className="library-header">
        <div>
          <div className="crumb">交付</div>
          <h2>备份与恢复</h2>
          <p>自动快照按设置的时间间隔生成；恢复前会展示差异并自动建立回滚保护点。</p>
        </div>
        <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void create()}>
          {busy === "create" ? <Loader2 className="spinning" size={16} /> : <Plus size={16} />}
          新建保护点
        </button>
      </header>

      <div className="backup-summary">
        <span>
          <DatabaseBackup size={17} />
          <b>{snapshots.length}</b> 个快照
        </span>
        <span>
          <Clock3 size={17} />
          <b>{automaticCount}</b> 个自动备份
        </span>
        <span>
          <HardDrive size={17} />
          <b>{formatSize(totalSize)}</b> / {settings?.maxTotalSizeMb ?? 512} MB
          <i className="backup-cap-track" aria-hidden="true">
            <b style={{ width: `${capRatio}%` }} />
          </i>
        </span>
      </div>

      <details className="backup-settings">
        <summary>
          <Settings2 size={15} />
          备份设置
          <small>{settings?.backupDirectory ? "自定义目录" : "项目内 .inkforge/backups"}</small>
        </summary>
        <div className="backup-settings-grid">
          <label>
            自动备份间隔（分钟）
            <input
              type="number"
              min={1}
              max={1440}
              value={settingsDraft.interval}
              onChange={(event) => setSettingsDraft((draft) => ({ ...draft, interval: event.target.value }))}
            />
          </label>
          <label>
            自动快照保留数量
            <input
              type="number"
              min={1}
              max={200}
              value={settingsDraft.retention}
              onChange={(event) => setSettingsDraft((draft) => ({ ...draft, retention: event.target.value }))}
            />
          </label>
          <label>
            磁盘占用上限（MB）
            <input
              type="number"
              min={10}
              max={102400}
              value={settingsDraft.cap}
              onChange={(event) => setSettingsDraft((draft) => ({ ...draft, cap: event.target.value }))}
            />
          </label>
          <div className="backup-directory-row">
            <span className="backup-directory-label">备份目录</span>
            <code title={backupRoot}>{backupRoot || "读取中…"}</code>
            <div className="inline-actions">
              <button className="secondary-button compact" type="button" onClick={() => void chooseDirectory()}>
                <FolderOpen size={14} />
                选择目录
              </button>
              {settings?.backupDirectory ? (
                <button
                  className="secondary-button compact"
                  type="button"
                  onClick={() => void persistSettings({ backupDirectory: "" })}
                >
                  恢复默认
                </button>
              ) : null}
            </div>
          </div>
          <p className="muted">超过磁盘上限时会优先清理最旧的自动快照；手动保护点和恢复保护点不参与自动清理。</p>
          <button className="secondary-button compact backup-settings-save" type="button" onClick={saveSettingsDraft}>
            保存设置
          </button>
        </div>
      </details>

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="notice-banner">{notice}</div> : null}
      {corrupted.length ? (
        <div className="backup-corrupted-banner">
          <TriangleAlert size={15} />
          发现 {corrupted.length} 个损坏或不完整的快照目录（{corrupted.join("、")}
          ）。它们不会参与恢复，可在备份目录中手动清理。
        </div>
      ) : null}

      {restorePreview ? (
        <section className="backup-restore-preview">
          <header>
            <strong>
              <FileDiff size={15} />
              恢复预览 · {new Date(restorePreview.snapshot.createdAt).toLocaleString("zh-CN")}
            </strong>
            <button
              className="icon-button"
              type="button"
              aria-label="关闭恢复预览"
              onClick={() => setRestorePreview(undefined)}
            >
              <X size={15} />
            </button>
          </header>
          {restorePreview.diff.addedChapters.length ||
          restorePreview.diff.removedChapters.length ||
          restorePreview.diff.modifiedChapters.length ||
          restorePreview.diff.changedMetaFiles.length ? (
            <div className="backup-diff-columns">
              <div>
                {restorePreview.diff.modifiedChapters.length ? (
                  <div className="backup-diff-group">
                    <strong>恢复将回退这些章节（{restorePreview.diff.modifiedChapters.length}）</strong>
                    {restorePreview.diff.modifiedChapters.map((file) => (
                      <button key={file} type="button" onClick={() => void showFileDiff(file, "modified")}>
                        {chapterLabel(file)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {restorePreview.diff.addedChapters.length ? (
                  <div className="backup-diff-group">
                    <strong>恢复将删除这些新章节（{restorePreview.diff.addedChapters.length}）</strong>
                    {restorePreview.diff.addedChapters.map((file) => (
                      <button key={file} type="button" onClick={() => void showFileDiff(file, "added")}>
                        {chapterLabel(file)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {restorePreview.diff.removedChapters.length ? (
                  <div className="backup-diff-group">
                    <strong>恢复将找回这些章节（{restorePreview.diff.removedChapters.length}）</strong>
                    {restorePreview.diff.removedChapters.map((file) => (
                      <button key={file} type="button" onClick={() => void showFileDiff(file, "removed")}>
                        {chapterLabel(file)}
                      </button>
                    ))}
                  </div>
                ) : null}
                {restorePreview.diff.changedMetaFiles.length ? (
                  <div className="backup-diff-group">
                    <strong>大纲/资料文件变化</strong>
                    {restorePreview.diff.changedMetaFiles.map((file) => (
                      <span key={file}>{file}</span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="backup-diff-view">
                {diffFile ? (
                  diffError ? (
                    <p className="muted">{diffError}</p>
                  ) : diffLines ? (
                    <pre>
                      {diffLines
                        .filter((line, index, all) => {
                          if (line.kind !== "context") return true;
                          const near = all
                            .slice(Math.max(0, index - 2), index + 3)
                            .some((item) => item.kind !== "context");
                          return near;
                        })
                        .slice(0, 400)
                        .map((line, index) => (
                          <span key={index} className={`diff-line diff-${line.kind}`}>
                            {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
                            {line.text || " "}
                          </span>
                        ))}
                    </pre>
                  ) : (
                    <p className="muted">
                      <Loader2 className="spinning" size={14} /> 正在加载差异…
                    </p>
                  )
                ) : (
                  <p className="muted">
                    点击左侧章节查看恢复前后的内容差异（- 为当前将被回退的内容，+ 为恢复后的内容）。
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="muted">当前项目与该快照内容一致，恢复不会改变章节内容。</p>
          )}
          <footer>
            <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void restore()}>
              {busy === restorePreview.snapshot.id ? (
                <Loader2 className="spinning" size={15} />
              ) : (
                <ArchiveRestore size={15} />
              )}
              确认恢复到此快照
            </button>
            <span className="muted">恢复前会自动创建“恢复保护点”，可随时回滚。</span>
          </footer>
        </section>
      ) : null}

      <div className="backup-list">
        {snapshots.map((snapshot) => {
          const verification = verifications[snapshot.id];
          return (
            <article className="backup-row" key={snapshot.id}>
              <span className={`backup-kind ${snapshot.reason}`}>
                <DatabaseBackup size={17} />
              </span>
              <div>
                <strong>{snapshot.label || reasonLabels[snapshot.reason]}</strong>
                <small>
                  {new Date(snapshot.createdAt).toLocaleString("zh-CN")} · {snapshot.fileCount} 个文件 ·{" "}
                  {formatSize(snapshot.size)}
                  {snapshot.changedChapterFiles.length
                    ? ` · 较上个快照变更 ${snapshot.changedChapterFiles.length} 章`
                    : ""}
                </small>
                {snapshot.changedChapterFiles.length ? (
                  <small className="backup-changed-list">
                    {snapshot.changedChapterFiles
                      .slice(0, 4)
                      .map((file) => chapterLabel(file))
                      .join("、")}
                    {snapshot.changedChapterFiles.length > 4 ? " 等" : ""}
                  </small>
                ) : null}
                {verification ? (
                  <small className={verification.ok ? "backup-verify-ok" : "backup-verify-bad"}>
                    {verification.ok
                      ? `完整性检查通过（校验 ${verification.checkedFiles} 个章节文件）`
                      : `完整性检查发现问题：${verification.issues.join("；")}`}
                    {verification.ok && verification.issues.length ? ` · ${verification.issues.join("；")}` : ""}
                  </small>
                ) : null}
              </div>
              <em>{reasonLabels[snapshot.reason]}</em>
              <button type="button" disabled={Boolean(busy)} title="完整性检查" onClick={() => void verify(snapshot)}>
                {busy === `verify-${snapshot.id}` ? (
                  <Loader2 className="spinning" size={15} />
                ) : (
                  <ShieldCheck size={15} />
                )}
                校验
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => void openRestorePreview(snapshot)}>
                {busy === `diff-${snapshot.id}` ? (
                  <Loader2 className="spinning" size={15} />
                ) : (
                  <ArchiveRestore size={15} />
                )}
                恢复
              </button>
              <button
                className="icon-button danger"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void remove(snapshot)}
                aria-label="删除备份"
              >
                {busy === snapshot.id ? <Loader2 className="spinning" size={15} /> : <Trash2 size={15} />}
              </button>
            </article>
          );
        })}
        {!snapshots.length ? (
          <div className="module-empty-state">
            <DatabaseBackup size={26} />
            <strong>还没有项目快照</strong>
            <span>点击“新建保护点”，或继续写作等待第一次自动备份。</span>
          </div>
        ) : null}
      </div>
    </section>
  );
};
