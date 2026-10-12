import { useMemo } from "react";
import { useLibraryStore } from "@/stores/useLibraryStore";
import { useProjectStore } from "@/stores/useProjectStore";

export const useReferenceOptions = () => {
  const characters = useLibraryStore((state) => state.characters);
  const world = useLibraryStore((state) => state.worldEntries);
  const project = useProjectStore((state) => state.project);
  return useMemo(() => {
    const characterOptions = characters.map((item) => ({
      value: item.id,
      label: item.name,
      keywords: item.aliases,
      description: item.profile.identity || item.id
    }));
    const worldOptions = world.map((item) => ({
      value: item.id,
      label: item.title,
      description: item.summary || item.id,
      type: item.type
    }));
    return {
      characters: characterOptions,
      locations: worldOptions.filter((item) => item.type === "location"),
      factions: worldOptions.filter((item) => ["faction", "organization"].includes(item.type)),
      parties: [...characterOptions, ...worldOptions],
      chapters:
        project?.outline.volumes.flatMap((volume) =>
          volume.chapters.map((chapter) => ({
            value: chapter.id,
            label: chapter.title,
            description: `${volume.title}${chapter.archived ? " · 已归档" : ""}`
          }))
        ) ?? []
    };
  }, [characters, world, project?.outline.volumes]);
};
