import type { WritingWorkspace } from "@inkforge/schemas";
import { bridge } from "@/lib/browserBridge";

const writingWorkspaceMutations = new Map<string, Promise<void>>();
const listeners = new Set<(path: string, workspace: WritingWorkspace) => void>();

export const subscribeWritingWorkspace = (listener: (path: string, workspace: WritingWorkspace) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const loadLatestWritingWorkspace = async (projectPath: string) => {
  await writingWorkspaceMutations.get(projectPath);
  return bridge.loadWritingWorkspace(projectPath);
};

/**
 * Serializes read-modify-write mutations of .inkforge/writing-workspace.json per
 * project so concurrent panels (editor, draft center) do not clobber each other.
 */
export const mutateWritingWorkspace = (
  projectPath: string,
  update: (workspace: WritingWorkspace) => WritingWorkspace
): Promise<WritingWorkspace> => {
  const previous = writingWorkspaceMutations.get(projectPath) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const latest = await bridge.loadWritingWorkspace(projectPath);
      const workspace = await bridge.saveWritingWorkspace(projectPath, update(latest));
      listeners.forEach((listener) => listener(projectPath, workspace));
      return workspace;
    });
  const settled = operation.then(
    () => undefined,
    () => undefined
  );
  writingWorkspaceMutations.set(projectPath, settled);
  void settled.finally(() => {
    if (writingWorkspaceMutations.get(projectPath) === settled) {
      writingWorkspaceMutations.delete(projectPath);
    }
  });
  return operation;
};
