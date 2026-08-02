import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { AgentChatPanel } from "@/features/agent/AgentChatPanel";
import { ChapterEditor } from "@/features/chapters/ChapterEditor";
import { CharacterLibrary } from "@/features/library/CharacterLibrary";
import { WorldLibrary } from "@/features/library/WorldLibrary";
import { ModulePlaceholder } from "@/features/project/ModulePlaceholder";
import { BackupCenter } from "@/features/project/BackupCenter";
import { DraftCenter } from "@/features/project/DraftCenter";
import { ProjectNav } from "@/features/project/ProjectNav";
import { NarrativeBoard } from "@/features/narrative/NarrativeBoard";
import { SimulationLab } from "@/features/simulation/SimulationLab";
import { OutlineEditor } from "@/features/outline/OutlineEditor";
import { FactionLibrary, LocationLibrary } from "@/features/library/WorldSubsetLibrary";
import { RevisionWorkbench } from "@/features/revision/RevisionWorkbench";
import { ContinuationWorkbench } from "@/features/continuation/ContinuationWorkbench";
import { CluePanel } from "@/features/story/CluePanel";
import { ConflictBoard } from "@/features/story/ConflictBoard";
import { EventBoard } from "@/features/story/EventBoard";
import { ProductionWorkbench } from "@/features/production/ProductionWorkbench";
import { TermPanel } from "@/features/story/TermPanel";
import { TimelinePanel } from "@/features/story/TimelinePanel";
import { RelationshipCenter } from "@/features/story/RelationshipCenter";
import { StatusBar } from "@/components/StatusBar";
import { TopBar } from "@/components/TopBar";
import { createKeybindingHandler } from "@/lib/keybindings";
import {
  DEFAULT_PANE_WIDTHS,
  fitPaneWidths,
  PANE_LIMITS,
  resizePaneFromPointer,
  type PaneWidths,
  type ResizablePane
} from "@/lib/paneLayout";
import { useProjectStore } from "@/stores/useProjectStore";

const implementedModules = [
  "chapters",
  "characters",
  "world",
  "overview",
  "timeline",
  "clues",
  "terms",
  "outline",
  "drafts",
  "backup",
  "relationships",
  "narrative",
  "simulation",
  "locations",
  "factions",
  "conflicts",
  "events",
  "revision",
  "continuation"
];
const placeholderModules = ["export"];
const paneStorageKey = "inkforge:pane-widths:v2";
const agentCollapsedStorageKey = "inkforge:agent-collapsed:v1";
const compactLayoutQuery = "(max-width: 1179px)";

const readCompactLayout = () => typeof window !== "undefined" && window.matchMedia(compactLayoutQuery).matches;

const readPaneWidths = (): PaneWidths => {
  if (typeof window === "undefined") {
    return DEFAULT_PANE_WIDTHS;
  }

  try {
    const stored = JSON.parse(window.localStorage.getItem(paneStorageKey) ?? "null") as Partial<PaneWidths> | null;
    if (typeof stored?.navigation === "number" && typeof stored.agent === "number") {
      return {
        navigation: stored.navigation,
        agent: stored.agent
      };
    }
  } catch {
    // Ignore malformed local preferences and use the stable defaults.
  }

  return DEFAULT_PANE_WIDTHS;
};

export const AppShell = () => {
  const mainRef = useRef<HTMLElement>(null);
  const [paneWidths, setPaneWidths] = useState<PaneWidths>(readPaneWidths);
  const [compactLayout, setCompactLayout] = useState(readCompactLayout);
  const [compactPane, setCompactPane] = useState<"navigation" | "agent" | null>(null);
  const [agentCollapsed, setAgentCollapsed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(agentCollapsedStorageKey) === "true"
  );
  const current = useProjectStore((state) => state.current);
  const project = useProjectStore((state) => state.project);
  const saveState = useProjectStore((state) => state.saveState);
  const selectedModule = useProjectStore((state) => state.selectedModule);
  const focusMode = useProjectStore((state) => state.focusMode);
  const saveCurrentChapter = useProjectStore((state) => state.saveCurrentChapter);
  const setFocusMode = useProjectStore((state) => state.setFocusMode);
  const setSelectedModule = useProjectStore((state) => state.setSelectedModule);
  const createChapter = useProjectStore((state) => state.createChapter);
  const createVolume = useProjectStore((state) => state.createVolume);
  const exportManuscript = useProjectStore((state) => state.exportManuscript);

  useEffect(() => {
    const media = window.matchMedia(compactLayoutQuery);
    const updateLayout = () => {
      setCompactLayout(media.matches);
      if (!media.matches) {
        setCompactPane(null);
      }
    };
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    if (focusMode) {
      setCompactPane(null);
    }
  }, [focusMode]);

  useEffect(() => {
    window.localStorage.setItem(agentCollapsedStorageKey, String(agentCollapsed));
  }, [agentCollapsed]);

  useEffect(() => {
    const openAgentForTask = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; scope?: "chapter" | "project" }>).detail;
      setAgentCollapsed(false);
      if (compactLayout) {
        setCompactPane("agent");
      }
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("inkforge:agent-task-ready", { detail }));
      }, 0);
    };
    window.addEventListener("inkforge:agent-task", openAgentForTask);
    return () => window.removeEventListener("inkforge:agent-task", openAgentForTask);
  }, [compactLayout]);

  useEffect(() => {
    if (!compactPane) {
      return;
    }

    const closeCompactPane = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCompactPane(null);
      }
    };

    window.addEventListener("keydown", closeCompactPane);
    return () => window.removeEventListener("keydown", closeCompactPane);
  }, [compactPane]);

  const getContainerWidth = useCallback(() => mainRef.current?.getBoundingClientRect().width ?? window.innerWidth, []);

  const applyPaneWidths = useCallback((widths: PaneWidths) => {
    mainRef.current?.style.setProperty("--project-nav-width", `${widths.navigation}px`);
    mainRef.current?.style.setProperty("--agent-panel-width", `${widths.agent}px`);
  }, []);

  useEffect(() => {
    if (focusMode) {
      return;
    }

    const fitToWindow = () => {
      applyPaneWidths(fitPaneWidths(paneWidths, getContainerWidth()));
    };
    fitToWindow();
    window.localStorage.setItem(paneStorageKey, JSON.stringify(paneWidths));
    window.addEventListener("resize", fitToWindow);
    return () => window.removeEventListener("resize", fitToWindow);
  }, [applyPaneWidths, focusMode, getContainerWidth, paneWidths]);

  const startPaneResize = useCallback(
    (pane: ResizablePane, event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !mainRef.current) {
        return;
      }

      event.preventDefault();
      const bounds = mainRef.current.getBoundingClientRect();
      let draft = paneWidths;

      const update = (clientX: number) => {
        draft = resizePaneFromPointer(pane, paneWidths, bounds.width, clientX - bounds.left);
        applyPaneWidths(draft);
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        document.body.classList.remove("resizing-panes");
        setPaneWidths(draft);
      };
      const move = (pointerEvent: PointerEvent) => update(pointerEvent.clientX);

      document.body.classList.add("resizing-panes");
      update(event.clientX);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish, { once: true });
      window.addEventListener("pointercancel", finish, { once: true });
    },
    [applyPaneWidths, paneWidths]
  );

  const handlePaneKeyDown = useCallback(
    (pane: ResizablePane, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Home") {
        event.preventDefault();
        setPaneWidths((current) =>
          fitPaneWidths(
            {
              ...current,
              [pane]: DEFAULT_PANE_WIDTHS[pane]
            },
            getContainerWidth()
          )
        );
        return;
      }

      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      event.preventDefault();
      const step = event.shiftKey ? 48 : 16;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      setPaneWidths((current) =>
        fitPaneWidths(
          {
            ...current,
            [pane]: current[pane] + direction * step * (pane === "agent" ? -1 : 1)
          },
          getContainerWidth()
        )
      );
    },
    [getContainerWidth]
  );

  const resetPaneWidth = useCallback(
    (pane: ResizablePane) => {
      setPaneWidths((current) =>
        fitPaneWidths(
          {
            ...current,
            [pane]: DEFAULT_PANE_WIDTHS[pane]
          },
          getContainerWidth()
        )
      );
    },
    [getContainerWidth]
  );

  const layoutStyle = {
    "--project-nav-width": `${paneWidths.navigation}px`,
    "--agent-panel-width": `${paneWidths.agent}px`
  } as CSSProperties;

  const renderResizeHandle = (pane: ResizablePane) => {
    const value = paneWidths[pane];
    const limits = PANE_LIMITS[pane];
    const label = pane === "navigation" ? "调整项目导航宽度" : "调整 Agent 面板宽度";

    return (
      <div
        className={`pane-resize-handle pane-resize-handle-${pane}`}
        role="separator"
        aria-label={label}
        aria-controls={pane === "navigation" ? "project-navigation-pane" : "agent-chat-pane"}
        aria-orientation="vertical"
        aria-valuemax={limits.max}
        aria-valuemin={limits.min}
        aria-valuenow={value}
        tabIndex={0}
        title={`${label}，双击恢复默认宽度`}
        onDoubleClick={() => resetPaneWidth(pane)}
        onKeyDown={(event) => handlePaneKeyDown(pane, event)}
        onPointerDown={(event) => startPaneResize(pane, event)}
      />
    );
  };

  useEffect(() => {
    if (saveState !== "dirty") {
      return;
    }
    const id = window.setTimeout(() => {
      void saveCurrentChapter();
    }, 900);
    return () => window.clearTimeout(id);
  }, [saveCurrentChapter, saveState, current?.content]);

  useEffect(() => {
    const closeSettings = () => {
      const event = new Event("inkforge:close-settings", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const currentVolumeId = () =>
      project?.outline.volumes.find((volume) => volume.chapters.some((chapter) => chapter.id === current?.plan.id))?.id;
    const handler = createKeybindingHandler({
      save: () => void saveCurrentChapter(),
      createChapter: () => void createChapter(currentVolumeId()),
      createVolume: () => void createVolume(),
      exportMarkdown: () => void exportManuscript("markdown"),
      toggleFocusMode: () => setFocusMode(!focusMode),
      exitFocusMode: () => {
        if (focusMode) {
          setFocusMode(false);
        }
      },
      closeSettings,
      switchModule: setSelectedModule
    });
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    createChapter,
    createVolume,
    current?.plan.id,
    exportManuscript,
    focusMode,
    project?.outline.volumes,
    saveCurrentChapter,
    setFocusMode,
    setSelectedModule
  ]);

  return (
    <div className={`studio-shell ${focusMode ? "studio-shell-focus" : ""}`}>
      <TopBar
        compactLayout={compactLayout && !focusMode}
        navigationOpen={compactPane === "navigation"}
        agentOpen={compactPane === "agent"}
        agentCollapsed={agentCollapsed}
        onToggleNavigation={() => setCompactPane((pane) => (pane === "navigation" ? null : "navigation"))}
        onToggleAgent={() => setCompactPane((pane) => (pane === "agent" ? null : "agent"))}
        onToggleAgentCollapsed={() => setAgentCollapsed((value) => !value)}
      />
      {compactLayout && compactPane && !focusMode ? (
        <button
          className="compact-pane-backdrop"
          type="button"
          aria-label="关闭侧栏"
          onClick={() => setCompactPane(null)}
        />
      ) : null}
      <main
        className={`studio-main ${focusMode ? "focus-writing" : ""} ${compactLayout ? "compact-layout" : ""} ${
          agentCollapsed && !compactLayout && !focusMode ? "agent-collapsed" : ""
        }`}
        ref={mainRef}
        style={focusMode ? undefined : layoutStyle}
      >
        {focusMode ? null : compactLayout ? (
          <div
            className={`compact-pane compact-pane-navigation ${compactPane === "navigation" ? "open" : ""}`}
            aria-hidden={compactPane !== "navigation"}
            inert={compactPane !== "navigation"}
          >
            <ProjectNav onNavigate={() => setCompactPane(null)} />
          </div>
        ) : (
          <ProjectNav />
        )}
        {focusMode || compactLayout ? null : renderResizeHandle("navigation")}
        {selectedModule === "chapters" ? <ChapterEditor /> : null}
        {selectedModule === "characters" ? <CharacterLibrary /> : null}
        {selectedModule === "world" ? <WorldLibrary /> : null}
        {selectedModule === "overview" ? <ProductionWorkbench /> : null}
        {selectedModule === "timeline" ? <TimelinePanel /> : null}
        {selectedModule === "clues" ? <CluePanel /> : null}
        {selectedModule === "terms" ? <TermPanel /> : null}
        {selectedModule === "outline" ? <OutlineEditor /> : null}
        {selectedModule === "narrative" ? <NarrativeBoard /> : null}
        {selectedModule === "simulation" ? <SimulationLab /> : null}
        {selectedModule === "drafts" ? <DraftCenter /> : null}
        {selectedModule === "backup" ? <BackupCenter /> : null}
        {selectedModule === "relationships" ? <RelationshipCenter /> : null}
        {selectedModule === "locations" ? <LocationLibrary /> : null}
        {selectedModule === "factions" ? <FactionLibrary /> : null}
        {selectedModule === "conflicts" ? <ConflictBoard /> : null}
        {selectedModule === "events" ? <EventBoard /> : null}
        {selectedModule === "revision" ? <RevisionWorkbench /> : null}
        {selectedModule === "continuation" ? <ContinuationWorkbench /> : null}
        {placeholderModules.includes(selectedModule) || !implementedModules.includes(selectedModule) ? (
          <ModulePlaceholder />
        ) : null}
        {focusMode || compactLayout || agentCollapsed ? null : renderResizeHandle("agent")}
        {focusMode ? null : compactLayout ? (
          <div
            className={`compact-pane compact-pane-agent ${compactPane === "agent" ? "open" : ""}`}
            aria-hidden={compactPane !== "agent"}
            inert={compactPane !== "agent"}
          >
            <AgentChatPanel />
          </div>
        ) : agentCollapsed ? null : (
          <AgentChatPanel />
        )}
      </main>
      {focusMode ? null : <StatusBar />}
    </div>
  );
};
