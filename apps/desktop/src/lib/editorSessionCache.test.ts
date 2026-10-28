import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { history, undoDepth } from "@codemirror/commands";
import { rememberEditorState, restoreEditorState } from "./editorSessionCache";

const edited = () =>
  EditorState.create({ doc: "原文", extensions: [history()] }).update({
    changes: { from: 2, insert: "新句" },
    selection: { anchor: 4 }
  }).state;

describe("writing state across temporary detours", () => {
  it("preserves undo and cursor when extensions are rebound after remount", () => {
    rememberEditorState("preview-case", "chapter", edited());
    const state = restoreEditorState("preview-case", "chapter", "原文新句", [history()]);
    expect(undoDepth(state)).toBe(1);
    expect(state.selection.main.head).toBe(4);
  });
  it("does not reuse stale text or undo after an external revision", () => {
    rememberEditorState("external-case", "chapter", edited());
    const state = restoreEditorState("external-case", "chapter", "替换后的稿子", [history()], {
      anchor: 999,
      head: 999
    });
    expect(state.doc.toString()).toBe("替换后的稿子");
    expect(undoDepth(state)).toBe(0);
    expect(state.selection.main.head).toBe(state.doc.length);
  });
  it("isolates undo between novels with the same chapter ID", () => {
    rememberEditorState("novel-a", "ch-0001", edited());
    const state = restoreEditorState("novel-b", "ch-0001", "原文新句", [history()]);
    expect(undoDepth(state)).toBe(0);
  });
  it("bounds retained chapters so a long writing session cannot grow the cache indefinitely", () => {
    for (let index = 0; index < 9; index++) rememberEditorState("capacity", String(index), edited());
    expect(undoDepth(restoreEditorState("capacity", "0", "原文新句", [history()]))).toBe(0);
    expect(undoDepth(restoreEditorState("capacity", "8", "原文新句", [history()]))).toBe(1);
  });
});
