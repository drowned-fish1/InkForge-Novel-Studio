import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useEditorGuard } from "@/lib/useEditorGuard";
import { useProjectStore } from "@/stores/useProjectStore";
import { findSearchSelection } from "@/lib/searchNavigation";

const serializeEntity = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item
  );

export const useEntityEditor = <T extends { id: string; name?: string; title?: string }>(
  initial: T | undefined,
  entries: T[],
  persist: (draft: T) => Promise<void>,
  search?: { module: string; resetFilters: () => void }
) => {
  const [draft, updateDraft] = useState<T | undefined>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const savedSnapshot = useRef<T | undefined>(undefined);
  const searchRef = useRef(search);
  searchRef.current = search;
  const searchTarget = useProjectStore((state) => state.pendingEntitySelection);
  const persisted = entries.find((entry) => entry.id === draft?.id);
  const dirty = Boolean(draft && serializeEntity(draft) !== serializeEntity(persisted));

  useEffect(() => {
    if (!draft && initial) updateDraft(initial);
  }, [draft, initial]);

  useEffect(() => {
    if (
      !searchTarget ||
      searchTarget.module !== searchRef.current?.module ||
      searchTarget.projectPath !== useProjectStore.getState().project?.projectPath
    )
      return;
    const target = entries.find((entry) => entry.id === searchTarget.id);
    if (!target) {
      setError("该搜索条目已不存在，请重新搜索。");
      useProjectStore.getState().clearPendingEntitySelection();
      return;
    }
    if (draft?.id !== target.id) {
      updateDraft(target);
      setError("");
      setSaved(false);
      return;
    }
    searchRef.current.resetFilters();
    const frame = window.requestAnimationFrame(() => {
      const fields = Array.from(
        formRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input:not([type=checkbox]), textarea"
        ) ?? []
      );
      const field = fields.find((item) => findSearchSelection(item.value, searchTarget.query)) ?? fields[0];
      if (field) {
        field.focus({ preventScroll: true });
        const selection = findSearchSelection(field.value, searchTarget.query);
        if (selection && ["text", "search", "textarea"].includes(field.type))
          field.setSelectionRange(selection.start, selection.end);
        field.scrollIntoView({ block: "center" });
      }
      formRef.current
        ?.closest(".library-layout")
        ?.querySelector(".library-list button.selected")
        ?.scrollIntoView({ block: "nearest" });
      useProjectStore.getState().clearPendingEntitySelection();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchTarget, entries, draft?.id]);

  useEffect(() => {
    // Stores may add schema defaults. Adopt those only if the user has not edited during the save.
    if (
      saved &&
      persisted &&
      serializeEntity(draft) === serializeEntity(savedSnapshot.current) &&
      serializeEntity(draft) !== serializeEntity(persisted)
    ) {
      savedSnapshot.current = persisted;
      updateDraft(persisted);
    }
  }, [draft, persisted, saved]);

  const setDraft: Dispatch<SetStateAction<T | undefined>> = (value) => {
    setSaved(false);
    setError("");
    updateDraft(value);
  };

  const canLeave = useEditorGuard(dirty, busy, () => {
    if (!inFlight.current) formRef.current?.requestSubmit();
  });

  const save = async () => {
    if (!draft || inFlight.current) return;
    if (!(draft.name ?? draft.title ?? "").trim()) {
      setError("名称或标题不能为空，请填写后再保存。");
      formRef.current?.querySelector<HTMLInputElement>("input[required]")?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await persist(draft);
      savedSnapshot.current = draft;
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试。未保存内容仍保留在表单中。");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { draft, setDraft, formRef, busy, dirty, error, saved, save, canLeave };
};
