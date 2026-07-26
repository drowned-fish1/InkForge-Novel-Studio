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
            onBlur={(e) => handleUpdate("premise", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <p onClick={() => setEditing("premise")}>{outline.premise || "点击编辑前提..."}</p>
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
            onBlur={(e) => handleUpdate("mainConflict", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <p onClick={() => setEditing("mainConflict")}>{outline.mainConflict || "点击编辑主线冲突..."}</p>
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
            onBlur={(e) => handleUpdate("endingDirection", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(null);
            }}
          />
        ) : (
          <p onClick={() => setEditing("endingDirection")}>{outline.endingDirection || "点击编辑结局方向..."}</p>
        )}
      </div>
    </section>
  );
};
