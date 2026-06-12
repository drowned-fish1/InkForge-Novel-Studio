import { Plus } from "lucide-react";
import { OutlineOverview } from "./OutlineOverview";
import { VolumeColumn } from "./VolumeColumn";
import { useProjectStore } from "@/stores/useProjectStore";

export const OutlineEditor = () => {
  const project = useProjectStore((state) => state.project);
  const createVolume = useProjectStore((state) => state.createVolume);

  if (!project) {
    return (
      <section className="outline-editor empty">
        <p>请先打开一个项目</p>
      </section>
    );
  }

  const { outline } = project;

  return (
    <section className="outline-editor">
      <header className="outline-header">
        <div>
          <div className="crumb">写作</div>
          <h2>大纲</h2>
        </div>
      </header>

      <OutlineOverview />

      <div className="kanban-board">
        {outline.volumes.map((volume) => (
          <VolumeColumn key={volume.id} volume={volume} />
        ))}

        <div className="add-volume-column">
          <button className="add-volume-btn" onClick={() => void createVolume()}>
            <Plus size={16} />
            新分卷
          </button>
        </div>
      </div>
    </section>
  );
};
