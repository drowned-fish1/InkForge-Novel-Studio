import { useEffect, useRef, useState } from "react";
import type { WritingWorkspace } from "@inkforge/schemas";
import { loadLatestWritingWorkspace, mutateWritingWorkspace, subscribeWritingWorkspace } from "./writingWorkspaceStore";

export const useWritingWorkspace = (projectPath: string) => {
  const [loaded, setLoaded] = useState<{ path: string; workspace: WritingWorkspace }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scope = useRef(projectPath);
  scope.current = projectPath;
  const inFlight = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let revision = 0;
    setError("");
    const unsubscribe = subscribeWritingWorkspace((path, workspace) => {
      if (path !== projectPath || cancelled) return;
      revision++;
      setLoaded({ path, workspace });
    });
    const initialRevision = revision;
    void loadLatestWritingWorkspace(projectPath)
      .then((workspace) => {
        if (!cancelled && revision === initialRevision) setLoaded({ path: projectPath, workspace });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "读取写作计划失败。");
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectPath]);
  const mutate = async (update: (workspace: WritingWorkspace) => WritingWorkspace) => {
    if (inFlight.current) throw new Error("正在保存，请稍候。");
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      return await mutateWritingWorkspace(projectPath, update);
    } catch (cause) {
      if (scope.current === projectPath) setError(cause instanceof Error ? cause.message : "保存失败，修改仍保留。");
      throw cause;
    } finally {
      inFlight.current = false;
      if (scope.current === projectPath) setBusy(false);
    }
  };
  return { workspace: loaded?.path === projectPath ? loaded.workspace : undefined, error, busy, mutate };
};
