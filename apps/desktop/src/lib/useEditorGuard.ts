import { useEffect, useRef } from "react";
import { editorLeaveEvent, editorSaveEvent } from "@/lib/editorActions";

export const useEditorGuard = (dirty: boolean, busy: boolean, save?: () => void) => {
  const state = useRef({ dirty, busy, save });
  state.current = { dirty, busy, save };
  const canLeave = () =>
    !state.current.busy &&
    (!state.current.dirty || window.confirm("当前表单有未保存的修改。离开会放弃这些修改，确定离开？"));

  useEffect(() => {
    const beforeLeave = (event: Event) => {
      if (!event.defaultPrevented && !canLeave()) event.preventDefault();
    };
    const saveActive = (event: Event) => {
      if (event.defaultPrevented || !state.current.save) return;
      event.preventDefault();
      if (!state.current.busy) state.current.save();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!state.current.dirty && !state.current.busy) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener(editorLeaveEvent, beforeLeave);
    window.addEventListener(editorSaveEvent, saveActive);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener(editorLeaveEvent, beforeLeave);
      window.removeEventListener(editorSaveEvent, saveActive);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  return canLeave;
};
