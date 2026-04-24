/**
 * Phase 09.1 V3 accepted: module-scope QA mode constant.
 *
 * Derives once at import time from `process.env.NEXT_PUBLIC_QA_MODE`.
 * Consumers import `{ QA_MODE }` and branch on it; tests mock this module
 * via `vi.mock("@/lib/qa-mode", () => ({ QA_MODE: true }))` (or false) — no
 * `vi.stubEnv` required, no brittle env-var mutation between tests.
 *
 * This module is the single source of truth for the env read; do NOT
 * inline `process.env.NEXT_PUBLIC_QA_MODE === "true"` elsewhere — route
 * through `QA_MODE` so production audit + test mocking only have one
 * surface to consider.
 */
export const QA_MODE = process.env.NEXT_PUBLIC_QA_MODE === "true";
