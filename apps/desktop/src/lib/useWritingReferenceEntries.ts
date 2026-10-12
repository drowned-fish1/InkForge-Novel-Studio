import { useMemo } from "react";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { writingReferenceEntries } from "./writingReferences";

export const useWritingReferenceEntries = () => {
  const projectPath = useProjectStore((state) => state.project?.projectPath);
  const libraryPath = useLibraryStore((state) => state.libraryProjectPath);
  const characters = useLibraryStore((state) => state.characters);
  const terms = useLibraryStore((state) => state.terms);
  const world = useLibraryStore((state) => state.worldEntries);
  const ready = Boolean(projectPath && projectPath === libraryPath);
  return {
    ready,
    entries: useMemo(
      () => (ready ? writingReferenceEntries(characters, terms, world) : []),
      [ready, characters, terms, world]
    )
  };
};
