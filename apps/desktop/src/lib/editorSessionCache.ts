import { EditorState, StateEffect, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type ScrollSnapshot = ReturnType<EditorView["scrollSnapshot"]>;
const sessions = new Map<string, { state: EditorState; scrollSnapshot?: ScrollSnapshot }>();
const keyOf = (projectPath: string, chapterId: string) => JSON.stringify([projectPath, chapterId]);

export const rememberEditorState = (
  projectPath: string,
  chapterId: string,
  state: EditorState,
  scrollSnapshot?: ScrollSnapshot
) => {
  const key = keyOf(projectPath, chapterId);
  sessions.delete(key);
  sessions.set(key, { state, scrollSnapshot });
  while (sessions.size > 8) sessions.delete(sessions.keys().next().value!);
};

export const readEditorScrollSnapshot = (projectPath: string, chapterId: string, content: string) => {
  const cached = sessions.get(keyOf(projectPath, chapterId));
  return cached?.state.doc.toString() === content ? cached.scrollSnapshot : undefined;
};

export const restoreEditorState = (
  projectPath: string,
  chapterId: string,
  content: string,
  extensions: Extension[],
  selection?: { anchor: number; head: number }
): EditorState => {
  const key = keyOf(projectPath, chapterId);
  const cached = sessions.get(key)?.state;
  sessions.delete(key);
  if (cached?.doc.toString() === content) {
    // Rebind listeners to the newly mounted component while retaining history and selection fields.
    return cached.update({ effects: StateEffect.reconfigure.of(extensions) }).state;
  }
  return EditorState.create({
    doc: content,
    extensions,
    selection: selection
      ? {
          anchor: Math.min(selection.anchor, content.length),
          head: Math.min(selection.head, content.length)
        }
      : undefined
  });
};
