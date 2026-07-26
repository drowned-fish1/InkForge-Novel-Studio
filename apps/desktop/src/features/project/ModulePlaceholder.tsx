import {
  BookOpen,
  FileArchive,
  FileSearch,
  FileText,
  ListTree,
  MapPin,
  Shield,
  Swords,
  type LucideIcon
} from "lucide-react";
import { ExportPanel } from "@/features/project/ExportPanel";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";

interface ModuleStat {
  label: string;
  value: string;
}

interface ModuleInfo {
  title: string;
  crumb: string;
  status: string;
  description: string;
  icon: LucideIcon;
  nextModule?: string;
  nextLabel?: string;
}

const moduleInfo: Record<string, ModuleInfo> = {
  outline: {
    title: "大纲",
    crumb: "写作",
    status: "占位页已接通，结构数据来自当前项目大纲。",
    description: "这里会承接总纲、分卷目标和分章规划。完整编辑器接入前，可先通过章节树维护分卷与章节顺序。",
    icon: ListTree,
    nextModule: "chapters",
    nextLabel: "打开章节编排"
  },
  drafts: {
    title: "草稿箱",
    crumb: "写作",
    status: "占位页已接通，草稿聚合视图待实现。",
    description: "章节正文与状态仍由章节编辑器保存；后续可在这里集中筛选草稿、修订中章节和归档片段。",
    icon: FileText,
    nextModule: "chapters",
    nextLabel: "进入章节编辑"
  },
  locations: {
    title: "地点",
    crumb: "资料",
    status: "占位页已接通，地点条目复用世界观资料库。",
    description: "地点会以世界观条目的 location 类型保存。完整地点视图接入前，可在世界观模块新建或筛选地点资料。",
    icon: MapPin,
    nextModule: "world",
    nextLabel: "管理世界观"
  },
  factions: {
    title: "势力",
    crumb: "资料",
    status: "占位页已接通，势力条目复用世界观资料库。",
    description: "势力会以世界观条目的 faction 或 organization 类型保存，用于角色关系、冲突与时间线引用。",
    icon: Shield,
    nextModule: "world",
    nextLabel: "管理世界观"
  },
  conflicts: {
    title: "冲突",
    crumb: "剧情",
    status: "占位页已接通，冲突信息来自项目主冲突和章节冲突点。",
    description: "完整冲突板会汇总主线、支线、角色目标与章节冲突。当前可先在规划与章节卡片里维护这些字段。",
    icon: Swords,
    nextModule: "outline",
    nextLabel: "进入大纲"
  },
  events: {
    title: "事件",
    crumb: "剧情",
    status: "占位页已接通，事件数据来自时间线模块。",
    description: "事件会与章节、地点、参与角色关联。完整事件视图接入前，可先在时间线里维护事件顺序和摘要。",
    icon: BookOpen,
    nextModule: "timeline",
    nextLabel: "打开时间线"
  },
  backup: {
    title: "备份",
    crumb: "交付",
    status: "占位页已接通，自动备份中心待实现。",
    description: "项目内容会随编辑保存到当前项目目录；独立备份策略接入前，建议先导出交付稿并保留项目目录副本。",
    icon: FileArchive,
    nextModule: "export",
    nextLabel: "查看导出入口"
  }
};

const unknownModule: ModuleInfo = {
  title: "未接入模块",
  crumb: "项目",
  status: "当前模块 ID 没有匹配到已注册页面。",
  description: "这不会再回退显示为总览。请从左侧导航切换到已接通模块，或为该模块补充专属页面配置。",
  icon: FileSearch,
  nextModule: "overview",
  nextLabel: "返回检查"
};

export const ModulePlaceholder = () => {
  const selectedModule = useProjectStore((state) => state.selectedModule);
  const project = useProjectStore((state) => state.project);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const worldEntries = useLibraryStore((state) => state.worldEntries);
  const timeline = useLibraryStore((state) => state.timeline);

  if (selectedModule === "export") {
    return <ExportPanel />;
  }

  const module = moduleInfo[selectedModule] ?? unknownModule;
  const Icon = module.icon;
  const stats = getModuleStats(selectedModule, project, worldEntries, timeline);

  return (
    <section className="library-screen module-summary-screen">
      <header className="library-header">
        <div>
          <div className="crumb">{module.crumb}</div>
          <h2>{module.title}</h2>
        </div>
        {module.nextModule ? (
          <button className="primary-button" type="button" onClick={() => setSelectedModule(module.nextModule!)}>
            <Icon size={17} />
            {module.nextLabel}
          </button>
        ) : null}
      </header>

      <div className="module-summary-content">
        <section className="module-summary-metrics" aria-label={`${module.title}概览`}>
          {stats.map((stat) => (
            <div className="module-summary-stat" key={stat.label}>
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
        </section>

        <section className="module-summary-status">
          <header>
            <span>
              <Icon size={15} />
              模块状态
            </span>
            <small>当前版本</small>
          </header>
          <div>
            <Icon size={18} />
            <div>
              <strong>{module.status}</strong>
              <p>{module.description}</p>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
};

const getModuleStats = (
  moduleId: string,
  project: ReturnType<typeof useProjectStore.getState>["project"],
  worldEntries: ReturnType<typeof useLibraryStore.getState>["worldEntries"],
  timeline: ReturnType<typeof useLibraryStore.getState>["timeline"]
): ModuleStat[] => {
  const volumes = project?.outline.volumes ?? [];
  const chapters = volumes.flatMap((volume) => volume.chapters);
  const activeChapters = chapters.filter((chapter) => !chapter.archived);
  const archivedChapters = chapters.filter((chapter) => chapter.archived);
  const draftingChapters = activeChapters.filter(
    (chapter) => chapter.status === "drafting" || chapter.status === "revising"
  );
  const locationCount = worldEntries.filter((entry) => entry.type === "location").length;
  const factionCount = worldEntries.filter((entry) => entry.type === "faction" || entry.type === "organization").length;
  const conflictCount =
    activeChapters.filter((chapter) => chapter.conflictPoints.trim()).length + (project?.outline.mainConflict ? 1 : 0);
  const updatedAt = project?.meta.updatedAt ? new Date(project.meta.updatedAt).toLocaleDateString("zh-CN") : "未打开";

  switch (moduleId) {
    case "outline":
      return [
        { label: "分卷", value: String(volumes.length) },
        { label: "章节", value: String(activeChapters.length) },
        { label: "总目标字数", value: String(project?.meta.targetWords ?? 0) },
        { label: "主冲突", value: project?.outline.mainConflict ? "已填写" : "待补充" }
      ];
    case "drafts":
      return [
        { label: "草稿/修订中", value: String(draftingChapters.length) },
        { label: "可编辑章节", value: String(activeChapters.length) },
        { label: "归档章节", value: String(archivedChapters.length) },
        { label: "下一步", value: "章节" }
      ];
    case "locations":
      return [
        { label: "地点条目", value: String(locationCount) },
        { label: "世界观条目", value: String(worldEntries.length) },
        { label: "时间线事件", value: String(timeline.length) },
        { label: "下一步", value: "世界观" }
      ];
    case "factions":
      return [
        { label: "势力条目", value: String(factionCount) },
        { label: "世界观条目", value: String(worldEntries.length) },
        { label: "角色关联入口", value: "人物" },
        { label: "下一步", value: "世界观" }
      ];
    case "conflicts":
      return [
        { label: "已记录冲突点", value: String(conflictCount) },
        { label: "主冲突", value: project?.outline.mainConflict ? "已填写" : "待补充" },
        { label: "章节", value: String(activeChapters.length) },
        { label: "下一步", value: "规划" }
      ];
    case "events":
      return [
        { label: "时间线事件", value: String(timeline.length) },
        { label: "地点条目", value: String(locationCount) },
        { label: "章节", value: String(activeChapters.length) },
        { label: "下一步", value: "时间线" }
      ];
    case "backup":
      return [
        { label: "最近更新", value: updatedAt },
        { label: "可导出格式", value: "3" },
        { label: "项目目录", value: project ? "已打开" : "未打开" },
        { label: "下一步", value: "导出" }
      ];
    default:
      return [
        { label: "模块 ID", value: moduleId || "未知" },
        { label: "页面状态", value: "未注册" },
        { label: "回退策略", value: "不显示总览" },
        { label: "下一步", value: "检查" }
      ];
  }
};
