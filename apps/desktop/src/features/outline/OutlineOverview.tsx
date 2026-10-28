import { BookOpen, Target, Zap } from "lucide-react";
import { useState } from "react";
import { useProjectStore } from "@/stores/useProjectStore";

export const OutlineOverview = () => {
  const project = useProjectStore((state) => state.project);
  const updateOutline = useProjectStore((state) => state.updateOutline);
  const [editing, setEditing] = useState<string | null>(null);

  if (!project) {
    return null;
  }

  const { outline } = project;

  const handleUpdate = (field: "premise" | "mainConflict" | "endingDirection", value: string) => {
    void updateOutline({ ...outline, [field]: value });
    setEditing(null);
  };

  return (
    <section className="outline-overview">
      <div className="overview-field">
        <div className="field-header">
          <BookOpen size={16} />
          <strong>前提</strong>
        </div>
        {editing === "premise" ? (
          <textarea
            autoFocus
            defaultValue={outline.premise}
            aria-label="编辑故事前提"
            onBlur={(e) => handleUpdate("premise", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <button className="overview-edit" type="button" onClick={() => setEditing("premise")}>
            {outline.premise || "点击编辑前提…"}
          </button>
        )}
      </div>

      <div className="overview-field">
        <div className="field-header">
          <Zap size={16} />
          <strong>主线冲突</strong>
        </div>
        {editing === "mainConflict" ? (
          <textarea
            autoFocus
            defaultValue={outline.mainConflict}
            aria-label="编辑主线冲突"
            onBlur={(e) => handleUpdate("mainConflict", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <button className="overview-edit" type="button" onClick={() => setEditing("mainConflict")}>
            {outline.mainConflict || "点击编辑主线冲突…"}
          </button>
        )}
      </div>

      <div className="overview-field">
        <div className="field-header">
          <Target size={16} />
          <strong>结局方向</strong>
        </div>
        {editing === "endingDirection" ? (
          <textarea
            autoFocus
            defaultValue={outline.endingDirection}
            aria-label="编辑结局方向"
            onBlur={(e) => handleUpdate("endingDirection", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <button className="overview-edit" type="button" onClick={() => setEditing("endingDirection")}>
            {outline.endingDirection || "点击编辑结局方向…"}
          </button>
        )}
      </div>
    </section>
  );
};
