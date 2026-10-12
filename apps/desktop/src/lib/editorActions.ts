export const editorLeaveEvent = "inkforge:before-editor-leave";
export const editorSaveEvent = "inkforge:save-active-editor";

export const requestEditorLeave = (): boolean =>
  typeof window === "undefined" || window.dispatchEvent(new Event(editorLeaveEvent, { cancelable: true }));

export const requestActiveEditorSave = (): boolean =>
  typeof window !== "undefined" && !window.dispatchEvent(new Event(editorSaveEvent, { cancelable: true }));
