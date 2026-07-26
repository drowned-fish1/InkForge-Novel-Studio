const createAbortError = (): Error => {
  const error = new Error("Request cancelled.");
  error.name = "AbortError";
  return error;
};

const createRequestId = (prefix: string): string => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

interface RendererAbortOptions<T, Input> {
  input: Input;
  signal?: AbortSignal;
  requestPrefix: string;
  invoke: (input: Input & { requestId: string }) => Promise<T>;
  cancel: (requestId: string) => Promise<void>;
}

/**
 * AbortSignal cannot be cloned through Electron's contextBridge. Keep it in the
 * renderer and forward only the serializable request id to preload/main.
 */
export const invokeWithRendererAbort = async <T, Input>({
  input,
  signal,
  requestPrefix,
  invoke,
  cancel
}: RendererAbortOptions<T, Input>): Promise<T> => {
  const requestId = (input as Input & { requestId?: string }).requestId ?? createRequestId(requestPrefix);
  if (signal?.aborted) {
    throw createAbortError();
  }

  let settled = false;
  const handleAbort = () => {
    if (!settled) {
      void cancel(requestId).catch(() => undefined);
    }
  };
  signal?.addEventListener("abort", handleAbort, { once: true });

  try {
    const result = await invoke({ ...input, requestId });
    if (signal?.aborted) {
      throw createAbortError();
    }
    return result;
  } catch (error) {
    if (signal?.aborted) {
      throw createAbortError();
    }
    throw error;
  } finally {
    settled = true;
    signal?.removeEventListener("abort", handleAbort);
  }
};
