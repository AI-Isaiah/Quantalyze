/**
 * Monte-Carlo Web Worker (Plan 27-01, SIM-01.3 — off the main thread).
 *
 * Thin glue ONLY: it imports the pure, golden-tested `handleMonteCarloMessage`
 * (== `runMonteCarlo`) and wires the worker message contract. ALL math lives in
 * `scenario-montecarlo.ts` (vitest-testable without a worker runtime) — this
 * file owns no arithmetic.
 *
 * Typing note: we do NOT add `/// <reference lib="webworker" />` (it clashes with
 * the project's DOM lib on shared globals like `self`/`postMessage`). Instead we
 * cast `self` to a minimal local worker-scope shape. The wiring is GUARDED so
 * importing this module in a non-worker environment (the contract test, SSR)
 * never throws — it only attaches inside a real worker scope that exposes
 * `postMessage`. The worker creation itself lives in `montecarlo-runner.ts`.
 */

import {
  handleMonteCarloMessage,
  type MonteCarloRequest,
  type MonteCarloResult,
} from "./scenario-montecarlo";

// Re-export so the contract test references the worker module's entry point.
export { handleMonteCarloMessage } from "./scenario-montecarlo";

interface MonteCarloWorkerScope {
  onmessage: ((e: { data: MonteCarloRequest }) => void) | null;
  postMessage: (message: MonteCarloResult) => void;
}

const scope: MonteCarloWorkerScope | null =
  typeof self !== "undefined"
    ? (self as unknown as MonteCarloWorkerScope)
    : null;

if (scope && typeof scope.postMessage === "function") {
  scope.onmessage = (e) => {
    scope.postMessage(handleMonteCarloMessage(e.data));
  };
}
