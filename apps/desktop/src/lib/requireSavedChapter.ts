interface ChapterSaveState {
  project?: { projectPath: string } | null;
  current?: { plan: { id: string }; content: string } | null;
  saveState: string;
  error?: string;
  saveCurrentChapter: () => Promise<void>;
}

export async function requireSavedChapter(projectPath: string, chapterId: string, getState: () => ChapterSaveState) {
  const before = getState();
  const matches = (state: ReturnType<typeof getState>) =>
    state.project?.projectPath === projectPath && state.current?.plan.id === chapterId;
  if (!matches(before)) throw new Error("当前项目或章节已变化，请重新执行。");
  const content = before.current!.content;
  await before.saveCurrentChapter();
  const after = getState();
  if (!matches(after) || after.current!.content !== content) throw new Error("保存期间章节或正文已变化，请重新执行。");
  if (["error", "dirty", "saving"].includes(after.saveState))
    throw new Error(after.error || "章节未成功保存，本次操作已停止。");
}
