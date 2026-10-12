import {
  Archive as ArchiveIcon,
  BookMarked,
  BookOpen,
  BrainCircuit,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  FolderPen,
  FolderPlus,
  FileText,
  GripVertical,
  Grid3X3,
  ListTree,
  MapPin,
  Milestone,
  Network,
  PenLine,
  Plus,
  Shield,
  Swords,
  Tags,
  Trash2,
  Waypoints
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectSearchResult } from "@/types/app";
import { SearchHighlight } from "@/components/SearchHighlight";
import { bridge } from "@/lib/browserBridge";
import { useProjectStore } from "@/stores/useProjectStore";

const searchKindLabels: Record<ProjectSearchResult["kind"], string> = {
  chapter: "章节",
  character: "人物",
  world: "世界观",
  location: "地点",
  faction: "势力",
  conflict: "冲突",
  clue: "伏笔",
  term: "术语",
  event: "事件"
};

const moduleGroups = [
  {
    title: "写作",
    items: [
      ["outline", "大纲", ListTree],
      ["chapters", "章节写作台", PenLine],
      ["drafts", "草稿箱", FileText],
      ["revision", "修订工作台", ClipboardCheck],
      ["continuation", "续写工程", BrainCircuit]
    ]
  },
  {
    title: "资料",
    items: [
      ["characters", "人物", BookMarked],
      ["relationships", "关系", Network],
      ["world", "世界观", Boxes],
      ["terms", "术语", Tags],
      ["locations", "地点", MapPin],
      ["factions", "势力", Shield]
    ]
  },
  {
    title: "剧情",
    items: [
      ["narrative", "叙事板", Waypoints],
      ["matrix", "整书矩阵", Grid3X3],
      ["simulation", "推演", FlaskConical],
      ["timeline", "时间线", Clock3],
      ["clues", "伏笔", Milestone],
      ["conflicts", "冲突", Swords],
      ["events", "事件", BookOpen]
    ]
  },
  {
    title: "交付",
    items: [
      ["overview", "检查", BookOpen],
      ["export", "导出", ArchiveIcon],
      ["backup", "备份", ArchiveIcon]
    ]
  }
] as const;
const plannedModuleIds = new Set<string>();

const statusLabels: Record<string, string> = {
  unplanned: "未规划",
  planned: "已规划",
  drafting: "草稿中",
  revising: "待修改",
  done: "完成"
};

interface ProjectNavProps {
  onNavigate?: () => void;
}

export const ProjectNav = ({ onNavigate }: ProjectNavProps) => {
  const project = useProjectStore((state) => state.project);
  const current = useProjectStore((state) => state.current);
  const selectedModule = useProjectStore((state) => state.selectedModule);
  const recentChapterIds = useProjectStore((state) => state.recentChapterIds);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const selectChapter = useProjectStore((state) => state.selectChapter);
  const createChapter = useProjectStore((state) => state.createChapter);
  const createVolume = useProjectStore((state) => state.createVolume);
  const renameVolume = useProjectStore((state) => state.renameVolume);
  const deleteVolume = useProjectStore((state) => state.deleteVolume);
  const moveChapter = useProjectStore((state) => state.moveChapter);
  const archiveChapter = useProjectStore((state) => state.archiveChapter);
  const deleteChapterPlan = useProjectStore((state) => state.deleteChapterPlan);
  const jumpToChapterOffset = useProjectStore((state) => state.jumpToChapterOffset);
  const [chapterQuery, setChapterQuery] = useState("");
  const openEntitySearchResult = useProjectStore((state) => state.openEntitySearchResult);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [openingResult, setOpeningResult] = useState(false);
  const [searchState, setSearchState] = useState<{
    query: string;
    projectPath: string;
    results?: ProjectSearchResult[];
    error?: string;
  }>({ query: "", projectPath: "" });
  const searching = Boolean(searchQuery.trim());
  const currentSearch = searchState.query === searchQuery.trim() && searchState.projectPath === project?.projectPath;
  const searchResults = currentSearch ? searchState.results : undefined;
  const [collapsedVolumes, setCollapsedVolumes] = useState<Record<string, boolean>>({});
  const [collapsedModuleGroups, setCollapsedModuleGroups] = useState<Record<string, boolean>>({
    资料: true,
    剧情: true
  });
  const collapsedStorageKey = project ? `inkforge.nav.collapsedVolumes.${project.projectPath}` : "";
  const recentChapters = recentChapterIds
    .map((id) => project?.outline.volumes.flatMap((volume) => volume.chapters).find((chapter) => chapter.id === id))
    .filter((chapter): chapter is NonNullable<typeof chapter> => Boolean(chapter && !chapter.archived));
  const visibleVolumes = useMemo(() => {
    const keyword = chapterQuery.trim().toLowerCase();
    return (
      project?.outline.volumes
        .map((volume) => {
          const activeChapters = volume.chapters.filter((chapter) => !chapter.archived);
          const volumeMatches = volume.title.toLowerCase().includes(keyword);
          const chapters =
            keyword && !volumeMatches
              ? activeChapters.filter((chapter) => chapter.title.toLowerCase().includes(keyword))
              : activeChapters;
          return { volume, chapters };
        })
        .filter(
          ({ chapters, volume }) => !keyword || volume.title.toLowerCase().includes(keyword) || chapters.length > 0
        ) ?? []
    );
  }, [chapterQuery, project?.outline.volumes]);
  const allVisibleCollapsed =
    visibleVolumes.length > 0 && visibleVolumes.every(({ volume }) => collapsedVolumes[volume.id]);

  useEffect(() => {
    if (!collapsedStorageKey) {
      setCollapsedVolumes({});
      return;
    }
    try {
      setCollapsedVolumes(JSON.parse(sessionStorage.getItem(collapsedStorageKey) ?? "{}"));
    } catch {
      setCollapsedVolumes({});
    }
  }, [collapsedStorageKey]);

  useEffect(() => {
    if (collapsedStorageKey) {
      sessionStorage.setItem(collapsedStorageKey, JSON.stringify(collapsedVolumes));
    }
  }, [collapsedStorageKey, collapsedVolumes]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!project || !query) return;
    const projectPath = project.projectPath;
    let cancelled = false;
    setSearchState({ query, projectPath });
    const timer = window.setTimeout(() => {
      void bridge
        .searchProject(projectPath, query)
        .then((results) => {
          if (!cancelled && useProjectStore.getState().project?.projectPath === projectPath)
            setSearchState({ query, projectPath, results });
        })
        .catch((cause) => {
          if (!cancelled)
            setSearchState({
              query,
              projectPath,
              error: cause instanceof Error ? cause.message : "搜索失败，请重试。"
            });
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery, searchRevision, project?.projectPath]);

  const openSearchResult = async (result: ProjectSearchResult) => {
    if (openingResult) return;
    setOpeningResult(true);
    try {
      if (result.kind === "chapter") {
        const chapter = project?.outline.volumes
          .flatMap((volume) => volume.chapters)
          .find((item) => item.id === result.id);
        if (
          chapter &&
          (await jumpToChapterOffset(chapter, result.offset, result.offset + result.matchLength, searchQuery.trim()))
        )
          onNavigate?.();
      } else if (openEntitySearchResult(result, searchQuery.trim())) onNavigate?.();
    } catch (cause) {
      setSearchState((state) => ({
        ...state,
        error: cause instanceof Error ? cause.message : "打开搜索结果失败，请重试。"
      }));
    } finally {
      setOpeningResult(false);
    }
  };

  const toggleVolume = (volumeId: string) => {
    setCollapsedVolumes((state) => ({ ...state, [volumeId]: !state[volumeId] }));
  };

  const toggleAllVolumes = () => {
    if (allVisibleCollapsed) {
      setCollapsedVolumes((state) => {
        const next = { ...state };
        for (const { volume } of visibleVolumes) {
          delete next[volume.id];
        }
        return next;
      });
      return;
    }
    setCollapsedVolumes((state) => ({
      ...state,
      ...Object.fromEntries(visibleVolumes.map(({ volume }) => [volume.id, true]))
    }));
  };

  const toggleModuleGroup = (title: (typeof moduleGroups)[number]["title"]) => {
    setCollapsedModuleGroups((state) => {
      const opening = Boolean(state[title]);
      const next = { ...state, [title]: !state[title] };
      if (opening && (title === "资料" || title === "剧情")) {
        next[title === "资料" ? "剧情" : "资料"] = true;
      }
      return next;
    });
  };

  return (
    <aside className="project-nav" id="project-navigation-pane">
      <div className="project-nav-search">
        <input
          aria-label="搜索章节与设定"
          placeholder="全文搜索章节与设定"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape" && searchQuery) {
              event.preventDefault();
              event.stopPropagation();
              setSearchQuery("");
            }
            if (event.key === "ArrowDown" && searchResults?.length) {
              event.preventDefault();
              event.currentTarget.closest("aside")?.querySelector<HTMLButtonElement>(".nav-search-result")?.focus();
            }
          }}
        />
        {searchQuery ? (
          <button
            type="button"
            className="tiny-text-button"
            aria-label="清除全文搜索"
            onClick={() => setSearchQuery("")}
          >
            清除
          </button>
        ) : null}
      </div>
      {searching ? (
        <section className="nav-global-search" aria-label="全文搜索结果">
          <div className="section-heading">
            <span>全文搜索{searchResults ? ` · ${searchResults.length} 条` : ""}</span>
          </div>
          {currentSearch && searchState.error ? (
            <div className="nav-search-error" role="alert">
              {searchState.error}
              <button
                type="button"
                className="tiny-text-button"
                onClick={() => setSearchRevision((value) => value + 1)}
              >
                重试
              </button>
            </div>
          ) : null}
          {!searchResults && !(currentSearch && searchState.error) ? <p role="status">正在搜索…</p> : null}
          {searchResults?.map((result, index) => (
            <button
              key={`${result.kind}-${result.id}-${result.offset}-${index}`}
              type="button"
              className="nav-search-result"
              disabled={openingResult}
              onClick={() => void openSearchResult(result)}
            >
              <em>{searchKindLabels[result.kind]}</em>
              <span>
                <strong>
                  <SearchHighlight text={result.title} query={searchQuery} />
                </strong>
                {result.volumeTitle ? <small>{result.volumeTitle}</small> : null}
                {result.snippet ? (
                  <small>
                    <SearchHighlight text={result.snippet} query={searchQuery} />
                  </small>
                ) : null}
              </span>
            </button>
          ))}
          {searchResults?.length === 0 ? (
            <div className="empty-list-hint" role="status">
              没有匹配内容。
            </div>
          ) : null}
        </section>
      ) : null}
      <nav className="module-list">
        {moduleGroups.map((group) => {
          const collapsed = Boolean(collapsedModuleGroups[group.title]);
          return (
            <div className="module-group" key={group.title}>
              <button
                className="module-group-title"
                type="button"
                aria-expanded={!collapsed}
                onClick={() => toggleModuleGroup(group.title)}
              >
                <span>{group.title}</span>
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              {!collapsed ? (
                <div className="module-group-items">
                  {group.items.map(([id, label, Icon]) => {
                    const planned = plannedModuleIds.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        className={`${selectedModule === id ? "active" : ""} ${planned ? "planned" : ""}`}
                        aria-current={selectedModule === id ? "page" : undefined}
                        title={planned ? "功能建设中，点击查看当前替代入口" : undefined}
                        onClick={() => {
                          setSelectedModule(id);
                          if (useProjectStore.getState().selectedModule === id) onNavigate?.();
                        }}
                      >
                        <Icon size={16} />
                        <span>{label}</span>
                        {planned ? <small className="module-status-badge">规划中</small> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {recentChapters.length ? (
        <section className="nav-section compact-nav-section">
          <div className="section-heading">
            <span>最近使用</span>
          </div>
          {recentChapters.slice(0, 4).map((chapter) => (
            <button
              key={chapter.id}
              type="button"
              className={`chapter-row recent ${current?.plan.id === chapter.id ? "selected" : ""}`}
              onClick={() =>
                void selectChapter(chapter).then(() => {
                  const state = useProjectStore.getState();
                  if (state.selectedModule === "chapters" && state.current?.plan.id === chapter.id) onNavigate?.();
                })
              }
            >
              <FileText size={14} />
              <span>{chapter.title}</span>
            </button>
          ))}
        </section>
      ) : null}

      <section className="nav-section">
        <div className="section-heading">
          <span>章节树</span>
          <div className="inline-actions">
            <button className="tiny-button" type="button" onClick={() => void createVolume()} title="新增卷">
              <FolderPlus size={15} />
            </button>
            <button className="tiny-button" type="button" onClick={() => void createChapter()} title="新增章节">
              <Plus size={15} />
            </button>
          </div>
        </div>
        <div className="chapter-tree-controls">
          <input
            aria-label="搜索章节标题"
            placeholder="搜索章节标题"
            value={chapterQuery}
            onChange={(event) => setChapterQuery(event.target.value)}
          />
          <button
            className="tiny-text-button"
            type="button"
            onClick={toggleAllVolumes}
            disabled={!visibleVolumes.length}
          >
            {allVisibleCollapsed ? "展开全部" : "折叠全部"}
          </button>
        </div>
        {visibleVolumes.map(({ volume, chapters }) => {
          const isCollapsed = Boolean(collapsedVolumes[volume.id]);
          const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown;
          return (
            <div className="volume-group" key={volume.id}>
              <div className="volume-title">
                <button
                  className="volume-title-button"
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleVolume(volume.id)}
                >
                  <ChevronIcon size={14} />
                  <span>{volume.title}</span>
                </button>
                <div className="inline-actions">
                  <button
                    className="micro-button"
                    type="button"
                    title="在本卷新增章节"
                    onClick={() => void createChapter(volume.id)}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    className="micro-button"
                    type="button"
                    title="重命名卷"
                    onClick={() => {
                      const title = window.prompt("卷名称", volume.title);
                      if (title) void renameVolume(volume.id, title);
                    }}
                  >
                    <FolderPen size={13} />
                  </button>
                  <button
                    className="micro-button"
                    type="button"
                    title="删除卷"
                    disabled={(project?.outline.volumes.length ?? 0) <= 1}
                    onClick={() => {
                      if (window.confirm(`删除「${volume.title}」及其章节索引？正文文件会保留在项目文件夹中。`)) {
                        void deleteVolume(volume.id);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {!isCollapsed
                ? chapters.map((chapter) => {
                    const dropIndex = volume.chapters
                      .filter((item) => !item.archived)
                      .findIndex((item) => item.id === chapter.id);
                    return (
                      <div
                        key={chapter.id}
                        className="chapter-row-shell"
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", chapter.id);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const draggedChapterId = event.dataTransfer.getData("text/plain");
                          if (draggedChapterId && draggedChapterId !== chapter.id) {
                            void moveChapter(draggedChapterId, volume.id, Math.max(dropIndex, 0));
                          }
                        }}
                      >
                        <button
                          type="button"
                          className={`chapter-row ${current?.plan.id === chapter.id ? "selected" : ""}`}
                          onClick={() =>
                            void selectChapter(chapter).then(() => {
                              const state = useProjectStore.getState();
                              if (state.selectedModule === "chapters" && state.current?.plan.id === chapter.id)
                                onNavigate?.();
                            })
                          }
                        >
                          <GripVertical size={13} className="drag-handle" />
                          <FileText size={14} />
                          <span>{chapter.title}</span>
                          <small>
                            {statusLabels[chapter.status]} · {chapter.actualWords ?? 0}/{chapter.targetWords ?? 3000}
                          </small>
                        </button>
                        {current?.plan.id === chapter.id ? (
                          <div className="chapter-row-actions">
                            <button
                              className="micro-button"
                              type="button"
                              title="归档章节"
                              onClick={() => {
                                if (window.confirm(`归档「${chapter.title}」？`)) void archiveChapter(chapter.id);
                              }}
                            >
                              <ArchiveIcon size={13} />
                            </button>
                            <button
                              className="micro-button"
                              type="button"
                              title="删除章节"
                              onClick={() => {
                                if (
                                  window.confirm(`删除「${chapter.title}」的章节索引？正文文件会保留在项目文件夹中。`)
                                ) {
                                  void deleteChapterPlan(chapter.id);
                                }
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                : null}
            </div>
          );
        })}
        {!visibleVolumes.length ? <div className="empty-list-hint">没有匹配的章节。</div> : null}
      </section>
    </aside>
  );
};
