import { FormEvent, useState } from "react";
import { BookOpen, FolderInput, FolderOpen, Sparkles } from "lucide-react";
import { ImportPanel } from "@/features/project/ImportPanel";
import { useProjectStore } from "@/stores/useProjectStore";

export const ProjectStart = () => {
  const createProject = useProjectStore((state) => state.createProject);
  const openProject = useProjectStore((state) => state.openProject);
  const importProjectFolder = useProjectStore((state) => state.importProjectFolder);
  const recentProjects = useProjectStore((state) => state.recentProjects);
  const [title, setTitle] = useState("逆星长夜");
  const [genre, setGenre] = useState("玄幻,升级流,网文");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createProject({
      title,
      author: "local-user",
      genre: genre
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      targetWords: 1200000,
      style: "节奏快，冲突强，少解释，多行动",
      protagonist: "林烬，边城少年，寻找失踪父亲",
      premise: "边城少年得到父亲留下的黑匣，发现自身血脉与失落星火有关。"
    });
  };

  return (
    <main className="start-screen">
      <section className="start-panel">
        <div className="brand-mark large">IF</div>
        <h1>InkForge Local Novel Studio</h1>
        <p>本地优先的 AI 网文创作驾驶舱。章节、设定、人物和导出都保存在你自己的项目里。</p>

        <form className="start-form" onSubmit={submit}>
          <label>
            小说名
            <input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label>
            题材标签
            <input value={genre} onChange={(event) => setGenre(event.target.value)} />
          </label>
          <div className="start-actions">
            <button className="primary-button" type="submit">
              <Sparkles size={17} />
              新建项目
            </button>
            <button className="secondary-button" type="button" onClick={() => void openProject()}>
              <FolderOpen size={17} />
              打开项目
            </button>
            <button className="secondary-button" type="button" onClick={() => void importProjectFolder()}>
              <FolderInput size={17} />
              导入项目文件夹
            </button>
          </div>
        </form>
      </section>

      <aside className="start-brief">
        <BookOpen size={22} />
        <strong>项目入口</strong>
        <span>
          可以新建多个项目，也可以从最近项目继续写作。浏览器预览会保存到本机浏览器存储，桌面版会保存到你选择的项目文件夹。
        </span>
        <ImportPanel />
        {recentProjects.length ? (
          <div className="recent-projects">
            <strong>最近项目</strong>
            {recentProjects.map((item) => (
              <button key={item.projectPath} type="button" onClick={() => void openProject(item.projectPath)}>
                <span>{item.title}</span>
                <small>
                  {item.chapterCount} 章 / {new Date(item.updatedAt).toLocaleString()}
                </small>
              </button>
            ))}
          </div>
        ) : null}
      </aside>
    </main>
  );
};
