import { useEffect } from "react";
import { AiCockpit } from "@/features/ai/AiCockpit";
import { ChapterEditor } from "@/features/chapters/ChapterEditor";
import { CharacterLibrary } from "@/features/library/CharacterLibrary";
import { WorldLibrary } from "@/features/library/WorldLibrary";
import { ModulePlaceholder } from "@/features/project/ModulePlaceholder";
import { PlanningPanel } from "@/features/planning/PlanningPanel";
import { ProjectNav } from "@/features/project/ProjectNav";
import { OutlineEditor } from "@/features/outline/OutlineEditor";
import { CluePanel } from "@/features/story/CluePanel";
import { OverviewPanel } from "@/features/story/OverviewPanel";
import { TermPanel } from "@/features/story/TermPanel";
import { TimelinePanel } from "@/features/story/TimelinePanel";
import { StatusBar } from "@/components/StatusBar";
import { TopBar } from "@/components/TopBar";
import { createKeybindingHandler } from "@/lib/keybindings";
import { useProjectStore } from "@/stores/useProjectStore";

const implementedModules = ["chapters", "characters", "world", "overview", "planning", "timeline", "clues", "terms", "outline"];
const placeholderModules = ["drafts", "locations", "factions", "conflicts", "events", "export", "backup"];

export const AppShell = () => {
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
      <TopBar />
      <main className={`studio-main ${focusMode ? "focus-writing" : ""}`}>
        {focusMode ? null : <ProjectNav />}
        {selectedModule === "chapters" ? <ChapterEditor /> : null}
        {selectedModule === "characters" ? <CharacterLibrary /> : null}
        {selectedModule === "world" ? <WorldLibrary /> : null}
        {selectedModule === "overview" ? <OverviewPanel /> : null}
        {selectedModule === "planning" ? <PlanningPanel /> : null}
        {selectedModule === "timeline" ? <TimelinePanel /> : null}
        {selectedModule === "clues" ? <CluePanel /> : null}
        {selectedModule === "terms" ? <TermPanel /> : null}
        {selectedModule === "outline" ? <OutlineEditor /> : null}
        {placeholderModules.includes(selectedModule) || !implementedModules.includes(selectedModule) ? (
          <ModulePlaceholder />
        ) : null}
        {focusMode ? null : <AiCockpit />}
      </main>
      {focusMode ? null : <StatusBar />}
    </div>
  );
};
