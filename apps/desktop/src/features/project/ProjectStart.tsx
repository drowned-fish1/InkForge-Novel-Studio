import { FormEvent, useState } from "react";
import {
  ArchiveRestore,
  BookOpen,
  DatabaseBackup,
  FolderInput,
  FolderOpen,
  Sparkles,
  TriangleAlert,
  X
} from "lucide-react";
import type { BackupSnapshot } from "@inkforge/schemas";
import { ImportPanel } from "@/features/project/ImportPanel";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";

interface RecoveryState {
  path: string;
  issues: string[];
  backups: BackupSnapshot[];
}

export const ProjectStart = () => {
  const createProject = useProjectStore((state) => state.createProject);
  const openProject = useProjectStore((state) => state.openProject);
  const importProjectFolder = useProjectStore((state) => state.importProjectFolder);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryState | undefined>();

  const runProjectAction = async (action: () => Promise<void>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "项目操作失败。");
    } finally {
      setBusy(false);
    }
  };

  const offerRecovery = async (path: string, issues: string[]) => {
    const backups = await bridge.listBackups(path).catch(() => [] as BackupSnapshot[]);
    setRecovery({ path, issues, backups });
  };

  const openWithRecovery = async (projectPath?: string) => {
    setRecovery(undefined);
    let path = projectPath;
    if (!path) {
      path = await bridge.chooseProjectFolder();
      if (!path) {
        if (!window.inkforge) {
          await openProject();
        }
        return;
      }
    }
    const issues = await bridge.inspectProjectFolder(path).catch(() => [] as string[]);
    if (issues.length) {
      await offerRecovery(path, issues);
      return;
    }
    try {
      await openProject(path);
    } catch (error) {
      const inspected = await bridge.inspectProjectFolder(path).catch(() => [] as string[]);
      if (inspected.length) {
        await offerRecovery(path, inspected);
        return;
      }
      throw error;
    }
  };

  const restoreFromBackup = async (snapshot: BackupSnapshot) => {
    if (!recovery) return;
    await bridge.restoreBackup(recovery.path, snapshot.id);
    const issues = await bridge.inspectProjectFolder(recovery.path).catch(() => [] as string[]);
    if (issues.length) {
      await offerRecovery(recovery.path, issues);
      throw new Error(`恢复后项目仍不完整：${issues.join("、")}。可尝试更早的快照。`);
    }
    setRecovery(undefined);
    await openProject(recovery.path);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runProjectAction(() =>
      createProject({
        title,
        author: "local-user",
        genre: genre
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        targetWords: 1200000,
        style: "",
        protagonist: "",
        premise: ""
      })
    );
  };

  return (
    <main className="start-screen">
      <section className="start-panel">
        <div className="brand-mark large">IF</div>
        <h1>InkForge 小说工坊</h1>
        <p>本地优先的 AI 网文创作驾驶舱。章节、设定、人物和导出都保存在你自己的项目里。</p>

        <form className="start-form" onSubmit={submit}>
          <label>
            小说名
            <input
              required
              placeholder="输入你的小说名"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            题材标签
            <input placeholder="可选，用逗号分隔" value={genre} onChange={(event) => setGenre(event.target.value)} />
          </label>
          {actionError ? <div className="error-banner">{actionError}</div> : null}
          <div className="start-actions">
            <button className="primary-button" type="submit" disabled={busy}>
              <Sparkles size={17} />
              创建小说
            </button>
          </div>
        </form>

        {recovery ? (
          <section className="project-recovery-panel">
            <header>
              <strong>
                <TriangleAlert size={16} />
                项目文件不完整
              </strong>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭恢复面板"
                onClick={() => setRecovery(undefined)}
              >
                <X size={15} />
              </button>
            </header>
            <p className="project-recovery-path" title={recovery.path}>
              {recovery.path}
            </p>
            <ul>
              {recovery.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
            {recovery.backups.length ? (
              <div className="project-recovery-backups">
                <strong>
                  <DatabaseBackup size={15} />
                  从项目备份恢复（{recovery.backups.length} 个快照）
                </strong>
                {recovery.backups.slice(0, 6).map((snapshot) => (
                  <button
                    key={snapshot.id}
                    type="button"
                    disabled={busy}
                    onClick={() => void runProjectAction(() => restoreFromBackup(snapshot))}
                  >
                    <ArchiveRestore size={14} />
                    <span>
                      {new Date(snapshot.createdAt).toLocaleString("zh-CN")} · {snapshot.fileCount} 个文件
                    </span>
                    <small>{snapshot.label || snapshot.reason}</small>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">该文件夹内没有可用的 InkForge 备份快照，无法自动恢复。</p>
            )}
          </section>
        ) : null}
      </section>

      <aside className="start-brief">
        <div className="start-brief-heading">
          <BookOpen size={22} />
          <div>
            <strong>继续写作</strong>
            <span>打开最近项目，或选择已有的 InkForge 项目。</span>
          </div>
        </div>
        {recentProjects.length ? (
          <div className="recent-projects">
            <strong>最近项目</strong>
            {recentProjects.map((item) => (
              <button
                key={item.projectPath}
                type="button"
                disabled={busy}
                onClick={() => void runProjectAction(() => openWithRecovery(item.projectPath))}
              >
                <span>{item.title}</span>
                <small>
                  {item.chapterCount} 章 / {new Date(item.updatedAt).toLocaleString()}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="start-empty-recent">还没有最近项目。</div>
        )}
        <div className="start-existing-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void runProjectAction(() => openWithRecovery())}
          >
            <FolderOpen size={17} />
            打开 InkForge 项目
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void runProjectAction(importProjectFolder)}
          >
            <FolderInput size={17} />
            导入项目文件夹
          </button>
        </div>
        <ImportPanel />
      </aside>
    </main>
  );
};
