import { GripVertical, Trash2 } from "lucide-react";
import type { ChapterPlan } from "@inkforge/schemas";
import { useOutlineStore } from "@/stores/useOutlineStore";
import { useProjectStore } from "@/stores/useProjectStore";

const statusLabels: Record<ChapterPlan["status"], string> = {
  unplanned: "未规划",
  planned: "已规划",
  drafting: "草稿中",
  revising: "修改中",
  done: "完成"
};

interface ChapterCardProps {
  chapter: ChapterPlan;
  volumeId: string;
}

export const ChapterCard = ({ chapter, volumeId }: ChapterCardProps) => {
  const expandedChapterId = useOutlineStore((state) => state.expandedChapterId);
  const setExpandedChapter = useOutlineStore((state) => state.setExpandedChapter);
  const setDragData = useOutlineStore((state) => state.setDragData);
  const deleteChapterPlan = useProjectStore((state) => state.deleteChapterPlan);
  const updateChapterPlan = useProjectStore((state) => state.updateChapterPlan);

  const isExpanded = expandedChapterId === chapter.id;
  const completion = Math.min(100, Math.round((chapter.actualWords / chapter.targetWords) * 100));

  const handleDragStart = (e: React.DragEvent) => {
    setDragData({ type: "chapter", id: chapter.id, sourceVolumeId: volumeId });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDragData(null);
  };

  const handleDelete = () => {
    if (window.confirm(`确定删除章节"${chapter.title}"？`)) {
      void deleteChapterPlan(chapter.id);
    }
  };

  return (
    <div
      className={`chapter-card ${isExpanded ? "expanded" : ""}`}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <button
        className="card-header"
        type="button"
        aria-expanded={isExpanded}
        onClick={() => setExpandedChapter(isExpanded ? null : chapter.id)}
      >
        <GripVertical size={14} className="drag-handle" />
        <span className="chapter-number">#{chapter.number}</span>
        <span className="chapter-title">{chapter.title}</span>
        <span className={`status-badge ${chapter.status}`}>{statusLabels[chapter.status]}</span>
      </button>

      <div className="card-body">
        <div className="word-count">
          <span>
            {chapter.actualWords.toLocaleString()} / {chapter.targetWords.toLocaleString()} 字
          </span>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${completion}%` }} />
          </div>
        </div>
        {chapter.goal && <p className="outline-chapter-goal">{chapter.goal}</p>}
      </div>

      {isExpanded && (
        <div className="card-detail">
          <label>
            目标
            <textarea
              value={chapter.goal}
              onChange={(e) => void updateChapterPlan(chapter.id, { goal: e.target.value })}
            />
          </label>
          <label>
            冲突点
            <textarea
              value={chapter.conflictPoints}
              onChange={(e) => void updateChapterPlan(chapter.id, { conflictPoints: e.target.value })}
            />
          </label>
          <label>
            备注
            <textarea
              value={chapter.notes}
              onChange={(e) => void updateChapterPlan(chapter.id, { notes: e.target.value })}
            />
          </label>
          <button className="delete-btn" onClick={handleDelete}>
            <Trash2 size={14} />
            删除章节
          </button>
        </div>
      )}
    </div>
  );
};
