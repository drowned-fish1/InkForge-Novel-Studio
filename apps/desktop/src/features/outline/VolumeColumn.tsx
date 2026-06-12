import { Plus, Trash2 } from "lucide-react";
import type { VolumePlan } from "@inkforge/schemas";
import { ChapterCard } from "./ChapterCard";
import { useOutlineStore } from "@/stores/useOutlineStore";
import { useProjectStore } from "@/stores/useProjectStore";

interface VolumeColumnProps {
  volume: VolumePlan;
}

export const VolumeColumn = ({ volume }: VolumeColumnProps) => {
  const dragData = useOutlineStore((state) => state.dragData);
  const setDragData = useOutlineStore((state) => state.setDragData);
  const createChapter = useProjectStore((state) => state.createChapter);
  const deleteVolume = useProjectStore((state) => state.deleteVolume);
  const renameVolume = useProjectStore((state) => state.renameVolume);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragData || dragData.type !== "chapter") return;

    const chapterId = dragData.id;
    const sourceVolumeId = dragData.sourceVolumeId;

    if (sourceVolumeId === volume.id) {
      setDragData(null);
      return;
    }

    const moveChapter = useProjectStore.getState().moveChapter;
    void moveChapter(chapterId, volume.id);
    setDragData(null);
  };

  const handleAddChapter = () => {
    void createChapter(volume.id);
  };

  const handleDelete = () => {
    if (window.confirm(`确定删除分卷"${volume.title}"及其所有章节？`)) {
      void deleteVolume(volume.id);
    }
  };

  const handleRename = () => {
    const newTitle = window.prompt("输入分卷标题", volume.title);
    if (newTitle && newTitle.trim()) {
      void renameVolume(volume.id, newTitle.trim());
    }
  };

  return (
    <div
      className="volume-column"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="volume-header">
        <h3 onClick={handleRename}>{volume.title}</h3>
        <span className="chapter-count">{volume.chapters.length} 章</span>
        <button className="icon-btn" onClick={handleDelete} title="删除分卷">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="chapter-list">
        {volume.chapters.map((chapter) => (
          <ChapterCard key={chapter.id} chapter={chapter} volumeId={volume.id} />
        ))}
      </div>

      <button className="add-chapter-btn" onClick={handleAddChapter}>
        <Plus size={14} />
        新章节
      </button>
    </div>
  );
};
