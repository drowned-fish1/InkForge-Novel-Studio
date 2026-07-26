import { FileSearch } from "lucide-react";
import { ExportPanel } from "@/features/project/ExportPanel";
import { useProjectStore } from "@/stores/useProjectStore";

/**
 * Fallback screen: routes the export module to its panel and shows a
 * diagnostic card for unknown module ids (should not happen in normal use).
 */
export const ModulePlaceholder = () => {
  const selectedModule = useProjectStore((state) => state.selectedModule);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);

  if (selectedModule === "export") {
    return <ExportPanel />;
  }

  return (
    <section className="library-screen module-summary-screen">
      <header className="library-header">
        <div>
          <div className="crumb">项目</div>
          <h2>未接入模块</h2>
        </div>
        <button className="primary-button" type="button" onClick={() => setSelectedModule("chapters")}>
          <FileSearch size={17} />
          返回章节写作台
        </button>
      </header>
      <div className="module-summary-content">
        <section className="module-summary-status">
          <header>
            <span>
              <FileSearch size={15} />
              模块状态
            </span>
            <small>当前版本</small>
          </header>
          <div>
            <FileSearch size={18} />
            <div>
              <strong>模块 ID「{selectedModule}」没有匹配到已注册页面。</strong>
              <p>请从左侧导航切换到已接通模块。如果你是在开发新模块，请在 AppShell 中注册它的页面。</p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
};
