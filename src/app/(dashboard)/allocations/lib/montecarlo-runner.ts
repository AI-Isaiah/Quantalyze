/**
 * Off-main-thread Monte-Carlo runner (Plan 27-02, SIM-01.3).
 *
 * The single impure seam between `MonteCarloSection` and the Web Worker. The
 * section imports `runMonteCarloOffThread` and never touches `Worker` directly;
 * the section's unit test mocks THIS module, so the worker plumbing (and the
 * bundler-specific `new Worker(new URL(...))` instantiation) stays out of the
 * jsdom test entirely. That ~15-line plumbing is the irreducible integration
 * surface — it is exercised by the prod canary (the section actually computing
 * bands in a real browser), not a unit test.
 *
 * Next 16 + Turbopack bundle `new Worker(new URL("./x.worker.ts", import.meta.url))`
 * into a same-origin module-worker chunk (docs: lazy-loading / turbopack guides).
 */

import type { MonteCarloRequest, MonteCarloResult } from "./scenario-montecarlo";

export interface MonteCarloRun {
  /** Resolves with the bands result, or rejects if the worker errors / times out. */
  promise: Promise<MonteCarloResult>;
  /** Terminate the worker and abandon the run (a late result is ignored). */
  cancel: () => void;
}

/**
 * Watchdog: a worker that constructs but never posts (a module-load hang, a
 * pathological loop) must NOT pin the section on the computing state forever
 * (SIM-01.3 "without freezing the UI"). A real sim is sub-100ms, so 15s is a
 * generous hang detector that rejects → the section's honest error state.
 */
export const MC_WORKER_TIMEOUT_MS = 15_000;

/**
 * Spawn a one-shot worker for `req`, returning its promise + a `cancel()` that
 * terminates the worker (for unmount / superseded re-runs). The worker is always
 * terminated once it settles, so there is no leak on the happy path either.
 *
 * Failure is ALWAYS surfaced as a rejected promise, never an escaping throw or a
 * silent hang: a `new Worker` construction failure (no module-worker support, a
 * post-deploy chunk 404, a CSP block) returns a rejected run, and the watchdog
 * rejects a worker that never posts. Both route to the section's error state.
 */
export function runMonteCarloOffThread(req: MonteCarloRequest): MonteCarloRun {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./montecarlo.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch (e) {
    // Construction threw synchronously — surface as a rejected run (no spinner-
    // forever), with a no-op cancel.
    return {
      promise: Promise.reject(e instanceof Error ? e : new Error("monte-carlo worker construction failed")),
      cancel: () => {},
    };
  }

  let settled = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    settled = true;
    if (watchdog !== undefined) clearTimeout(watchdog);
    worker.terminate();
  };

  const promise = new Promise<MonteCarloResult>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<MonteCarloResult>) => {
      if (settled) return;
      finish();
      resolve(e.data);
    };
    worker.onerror = (err: ErrorEvent) => {
      if (settled) return;
      finish();
      reject(new Error(err.message || "monte-carlo worker error"));
    };
    watchdog = setTimeout(() => {
      if (settled) return;
      finish();
      reject(new Error("monte-carlo worker timed out"));
    }, MC_WORKER_TIMEOUT_MS);
  });

  worker.postMessage(req);

  return {
    promise,
    cancel: () => {
      if (!settled) finish();
    },
  };
}
