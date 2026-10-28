import { create } from "zustand";
import { maxAgentSelectionReferences, type AgentSelectionReference } from "../lib/agentSelection";

interface AgentSelectionState {
  references: AgentSelectionReference[];
  addReference: (reference: Omit<AgentSelectionReference, "id" | "comment">) => void;
  updateComment: (id: string, comment: string) => void;
  removeReferences: (ids: string[]) => void;
  restoreReferences: (references: AgentSelectionReference[]) => void;
}

// Composer attachments are temporary and scoped to the source chapter. Keep them
// outside the panel so collapsing or lazy-mounting the Agent cannot lose a quote.
export const useAgentSelectionStore = create<AgentSelectionState>((set, get) => ({
  references: [],
  addReference: (reference) => {
    if (!reference.quote.trim() || reference.end <= reference.start) return;
    const scoped = get().references.filter(
      (item) => item.projectPath === reference.projectPath && item.chapterId === reference.chapterId
    );
    if (
      scoped.some(
        (item) => item.start === reference.start && item.end === reference.end && item.quote === reference.quote
      )
    )
      return;
    if (scoped.length >= maxAgentSelectionReferences)
      throw new Error(`一次最多添加 ${maxAgentSelectionReferences} 条正文引用，请先发送或移除部分引用。`);
    set((state) => ({ references: [...state.references, { ...reference, id: crypto.randomUUID(), comment: "" }] }));
  },
  updateComment: (id, comment) =>
    set((state) => ({ references: state.references.map((item) => (item.id === id ? { ...item, comment } : item)) })),
  removeReferences: (ids) =>
    set((state) => ({ references: state.references.filter((item) => !ids.includes(item.id)) })),
  restoreReferences: (references) =>
    set((state) => ({
      references: [
        ...references.filter((item) => !state.references.some((existing) => existing.id === item.id)),
        ...state.references
      ]
    }))
}));
