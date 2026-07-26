import { useEffect, useState } from "react";
import { ArchiveRestore, Clock3, DatabaseBackup, HardDrive, Loader2, Plus, Trash2 } from "lucide-react";
import type { BackupSnapshot } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";

const reasonLabels: Record<BackupSnapshot["reason"], string> = {
  automatic: "自动快照",
  manual: "手动备份",
  "before-restore": "恢复保护点"
};

const formatSize = (size: number) =>
  size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`;

export const BackupCenter = () => {
  const project = useProjectStore((state) => state.project);
  const openProject = useProjectStore((state) => state.openProject);
  const saveCurrentChapter = useProjectStore((state) => state.saveCurrentChapter);
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    if (!project) return;
    setSnapshots(await bridge.listBackups(project.projectPath));
  };

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "读取备份失败"));
  }, [project?.projectPath]);

  const create = async () => {
    if (!project) return;
    setBusy("create");
    setError("");
    try {
      await bridge.createBackup(project.projectPath, "手动保护点");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "创建备份失败");
    } finally {
      setBusy("");
    }
  };

  const restore = async (snapshot: BackupSnapshot) => {
    if (
      !project ||
      !window.confirm(`恢复到 ${new Date(snapshot.createdAt).toLocaleString("zh-CN")}？\n当前项目会先建立保护点。`)
    ) {
      return;
    }
    setBusy(snapshot.id);
    setError("");
    try {
      await saveCurrentChapter();
      if (useProjectStore.getState().saveState === "error") {
        throw new Error(useProjectStore.getState().error || "当前章节保存失败，尚未开始恢复。");
      }
      await bridge.restoreBackup(project.projectPath, snapshot.id);
      await openProject(project.projectPath);
      await refresh();
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
  const totalSize = snapshots.reduce((total, item) => total + item.size, 0);

  return (
    <section className="library-screen backup-center">
      <header className="library-header">
        <div>
          <div className="crumb">交付</div>
          <h2>备份与恢复</h2>
          <p>自动保存会按时间间隔建立项目快照，手动保护点不参与自动清理。</p>
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
          <b>{formatSize(totalSize)}</b> 占用空间
        </span>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      <div className="backup-list">
        {snapshots.map((snapshot) => (
          <article className="backup-row" key={snapshot.id}>
            <span className={`backup-kind ${snapshot.reason}`}>
              <DatabaseBackup size={17} />
            </span>
            <div>
              <strong>{snapshot.label || reasonLabels[snapshot.reason]}</strong>
              <small>
                {new Date(snapshot.createdAt).toLocaleString("zh-CN")} · {snapshot.fileCount} 个文件 ·{" "}
                {formatSize(snapshot.size)}
              </small>
            </div>
            <em>{reasonLabels[snapshot.reason]}</em>
            <button type="button" disabled={Boolean(busy)} onClick={() => void restore(snapshot)}>
              <ArchiveRestore size={15} />
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
        ))}
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
