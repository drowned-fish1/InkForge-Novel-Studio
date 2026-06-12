# Outline Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a Kanban-style outline editor for visual novel structure management

**Architecture:** React components with Zustand store, HTML5 Drag & Drop for reordering, integrating with existing useProjectStore for data persistence

**Tech Stack:** React, TypeScript, Zustand, lucide-react, HTML5 Drag & Drop API

---

### Task 1: Create useOutlineStore

**Covers:** [S4]

**Files:**
- Create: `apps/desktop/src/stores/useOutlineStore.ts`
- Test: `apps/desktop/src/stores/__tests__/useOutlineStore.test.ts`

- [ ] **Step 1: Create store file with initial structure**

```typescript
// apps/desktop/src/stores/useOutlineStore.ts
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
      expandedChapterId: null,
    }),
}));
```

- [ ] **Step 2: Run typecheck to verify**

Run: `npm run typecheck`
Expected: PASS (no errors in new file)

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/stores/useOutlineStore.ts
git commit -m "feat(outline): add outline UI state store"
```

---

### Task 2: Create OutlineOverview Component

**Covers:** [S2, S4]

**Files:**
- Create: `apps/desktop/src/features/outline/OutlineOverview.tsx`

- [ ] **Step 1: Create component with premise/mainConflict/endingDirection editing**

```tsx
// apps/desktop/src/features/outline/OutlineOverview.tsx
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
          <p onClick={() => setEditing("premise")}>
            {outline.premise || "点击编辑前提..."}
          </p>
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
          <p onClick={() => setEditing("mainConflict")}>
            {outline.mainConflict || "点击编辑主线冲突..."}
          </p>
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
          <p onClick={() => setEditing("endingDirection")}>
            {outline.endingDirection || "点击编辑结局方向..."}
          </p>
        )}
      </div>
    </section>
  );
};
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/outline/OutlineOverview.tsx
git commit -m "feat(outline): add outline overview component"
```

---

### Task 3: Create ChapterCard Component

**Covers:** [S3]

**Files:**
- Create: `apps/desktop/src/features/outline/ChapterCard.tsx`

- [ ] **Step 1: Create chapter card with status, word count, and drag support**

```tsx
// apps/desktop/src/features/outline/ChapterCard.tsx
import { GripVertical, Trash2 } from "lucide-react";
import type { ChapterPlan } from "@inkforge/schemas";
import { useOutlineStore } from "@/stores/useOutlineStore";
import { useProjectStore } from "@/stores/useProjectStore";

const statusColors: Record<ChapterPlan["status"], string> = {
  unplanned: "#94a3b8",
  planned: "#3b82f6",
  drafting: "#f59e0b",
  revising: "#f97316",
  done: "#22c55e",
};

const statusLabels: Record<ChapterPlan["status"], string> = {
  unplanned: "未规划",
  planned: "已规划",
  drafting: "草稿中",
  revising: "修改中",
  done: "完成",
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
      <div className="card-header" onClick={() => setExpandedChapter(isExpanded ? null : chapter.id)}>
        <GripVertical size={14} className="drag-handle" />
        <span className="chapter-number">#{chapter.number}</span>
        <span className="chapter-title">{chapter.title}</span>
        <span className="status-badge" style={{ backgroundColor: statusColors[chapter.status] }}>
          {statusLabels[chapter.status]}
        </span>
      </div>

      <div className="card-body">
        <div className="word-count">
          <span>{chapter.actualWords.toLocaleString()} / {chapter.targetWords.toLocaleString()} 字</span>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${completion}%` }} />
          </div>
        </div>
        {chapter.goal && <p className="chapter-goal">{chapter.goal}</p>}
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/outline/ChapterCard.tsx
git commit -m "feat(outline): add chapter card component with drag support"
```

---

### Task 4: Create VolumeColumn Component

**Covers:** [S2, S4]

**Files:**
- Create: `apps/desktop/src/features/outline/VolumeColumn.tsx`

- [ ] **Step 1: Create volume column with drag-drop zone and add chapter button**

```tsx
// apps/desktop/src/features/outline/VolumeColumn.tsx
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/outline/VolumeColumn.tsx
git commit -m "feat(outline): add volume column with drag-drop support"
```

---

### Task 5: Create OutlineEditor Main Component

**Covers:** [S2]

**Files:**
- Create: `apps/desktop/src/features/outline/OutlineEditor.tsx`

- [ ] **Step 1: Create main editor combining all components**

```tsx
// apps/desktop/src/features/outline/OutlineEditor.tsx
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/features/outline/OutlineEditor.tsx
git commit -m "feat(outline): add main outline editor component"
```

---

### Task 6: Register OutlineEditor in AppShell

**Covers:** [S2]

**Files:**
- Modify: `apps/desktop/src/components/AppShell.tsx:18-19,85-95`

- [ ] **Step 1: Import OutlineEditor and add to implementedModules**

```tsx
// Add import at top
import { OutlineEditor } from "@/features/outline/OutlineEditor";

// Update line 18
const implementedModules = ["chapters", "characters", "world", "overview", "planning", "timeline", "clues", "terms", "outline"];

// Update line 85-95 to add outline case
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/AppShell.tsx
git commit -m "feat(outline): register outline editor in app shell"
```

---

### Task 7: Add Outline Editor Styles

**Covers:** [S3]

**Files:**
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Add CSS styles for outline editor components**

```css
/* Add to styles.css */

/* Outline Editor */
.outline-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
}

.outline-header h2 {
  margin: 0;
  font-size: 18px;
}

/* Outline Overview */
.outline-overview {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
}

.overview-field {
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 12px;
}

.field-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: var(--text-secondary);
}

.field-header strong {
  font-size: 12px;
  text-transform: uppercase;
}

.overview-field p {
  margin: 0;
  cursor: pointer;
  min-height: 40px;
}

.overview-field textarea {
  width: 100%;
  min-height: 80px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  font-size: 14px;
  resize: vertical;
}

/* Kanban Board */
.kanban-board {
  display: flex;
  gap: 16px;
  padding: 16px 24px;
  overflow-x: auto;
  flex: 1;
}

/* Volume Column */
.volume-column {
  min-width: 280px;
  max-width: 320px;
  background: var(--bg-secondary);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
}

.volume-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}

.volume-header h3 {
  margin: 0;
  font-size: 14px;
  cursor: pointer;
  flex: 1;
}

.chapter-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.icon-btn {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  border-radius: 4px;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--danger);
}

.chapter-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-chapter-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  margin: 8px;
  background: none;
  border: 1px dashed var(--border);
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
}

.add-chapter-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Chapter Card */
.chapter-card {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: grab;
}

.chapter-card:active {
  cursor: grabbing;
}

.chapter-card.expanded {
  border-color: var(--primary);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  cursor: pointer;
}

.drag-handle {
  color: var(--text-secondary);
  cursor: grab;
}

.chapter-number {
  font-size: 12px;
  color: var(--text-secondary);
}

.chapter-title {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
}

.status-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  color: white;
}

.card-body {
  padding: 0 8px 8px;
}

.word-count {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.progress-bar {
  height: 3px;
  background: var(--border);
  border-radius: 2px;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 2px;
}

.chapter-goal {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-detail {
  padding: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.card-detail label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.card-detail textarea {
  width: 100%;
  min-height: 60px;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 6px;
  font-size: 12px;
  resize: vertical;
}

.delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px;
  background: none;
  border: 1px solid var(--danger);
  border-radius: 4px;
  color: var(--danger);
  cursor: pointer;
  font-size: 12px;
}

.delete-btn:hover {
  background: var(--danger);
  color: white;
}

/* Add Volume Column */
.add-volume-column {
  min-width: 200px;
  display: flex;
  align-items: flex-start;
  padding-top: 16px;
}

.add-volume-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 24px;
  background: none;
  border: 2px dashed var(--border);
  border-radius: 8px;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 14px;
}

.add-volume-btn:hover {
  background: var(--bg-hover);
  border-color: var(--primary);
  color: var(--primary);
}
```

- [ ] **Step 2: Run lint to verify CSS**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/styles.css
git commit -m "feat(outline): add outline editor styles"
```

---

### Task 8: Run Full Verification

**Covers:** [S5]

**Files:** None

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 4: Start dev server and verify manually**

Run: `npm run dev`
Expected: Dev server starts, navigate to outline module and verify:
- Overview section displays and is editable
- Volume columns render
- Chapter cards render with correct data
- Drag and drop works between volumes
- Add/delete volume and chapter works

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "feat(outline): complete outline editor implementation"
```
