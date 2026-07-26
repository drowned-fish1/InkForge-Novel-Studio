import { FormEvent, useState } from "react";
import { BookOpen, FolderInput, FolderOpen, Sparkles } from "lucide-react";
import { ImportPanel } from "@/features/project/ImportPanel";
import { useProjectStore } from "@/stores/useProjectStore";

export const ProjectStart = () => {
  const createProject = useProjectStore((state) => state.createProject);
  const openProject = useProjectStore((state) => state.openProject);
  const importProjectFolder = useProjectStore((state) => state.importProjectFolder);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

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
                onClick={() => void runProjectAction(() => openProject(item.projectPath))}
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
            onClick={() => void runProjectAction(() => openProject())}
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
