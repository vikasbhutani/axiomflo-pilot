import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> =
  | { status: 'loading'; data?: T }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error; data?: T };

/**
 * Runs an async loader whenever `deps` change and tracks loading / success / error.
 * Keeps the previous data while reloading so the page doesn't flash empty.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ status: 'loading', data: prev.data }));
    loader().then(
      (data) => !cancelled && setState({ status: 'success', data }),
      (error: unknown) => !cancelled && setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
