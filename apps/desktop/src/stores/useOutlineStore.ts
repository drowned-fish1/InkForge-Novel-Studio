import { create } from "zustand";

interface OutlineUIState {
  selectedVolumeId: string | null;
  selectedChapterId: string | null;
  expandedChapterId: string | null;
  dragData: {
    type: "chapter" | "volume";
    id: string;
    sourceVolumeId?: string;
  } | null;
  setSelectedVolume: (id: string | null) => void;
  setSelectedChapter: (id: string | null) => void;
  setExpandedChapter: (id: string | null) => void;
  setDragData: (data: OutlineUIState["dragData"]) => void;
  clearSelection: () => void;
}

export const useOutlineStore = create<OutlineUIState>((set) => ({
  selectedVolumeId: null,
  selectedChapterId: null,
  expandedChapterId: null,
  dragData: null,
  setSelectedVolume: (id) => set({ selectedVolumeId: id }),
  setSelectedChapter: (id) => set({ selectedChapterId: id }),
  setExpandedChapter: (id) => set({ expandedChapterId: id }),
  setDragData: (data) => set({ dragData: data }),
  clearSelection: () =>
    set({
      selectedVolumeId: null,
      selectedChapterId: null,
      expandedChapterId: null
    })
}));
