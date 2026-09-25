import * as React from "react";
import { ApiError } from "@/lib/api";

/**
 * One request, one state. A reload replaces the data rather than merging it, so
 * a value on screen is always exactly what the API said on the last read: after
 * a checkout the cart and the stock numbers are re-read together, never mixed.
 */
export interface Remote<T> {
  readonly data: T | undefined;
  readonly error: string | undefined;
  readonly loading: boolean;
  reload(): void;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "The API could not be reached";
}

type RemoteState<T> = { data: T | undefined; error: string | undefined; loading: boolean };

export function useRemote<T>(load: () => Promise<T>): Remote<T> {
  const [state, setState] = React.useState<RemoteState<T>>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    setState({ data: undefined, error: undefined, loading: true });
    load().then(
      (data) => {
        if (live) setState({ data, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (live) setState({ data: undefined, error: describeError(error), loading: false });
      },
    );
    // A response that arrives after the route changed is dropped rather than set.
    return () => {
      live = false;
    };
  }, [load, attempt]);

  return React.useMemo(
    () => ({ ...state, reload: () => setAttempt((n) => n + 1) }),
    [state],
  );
}
