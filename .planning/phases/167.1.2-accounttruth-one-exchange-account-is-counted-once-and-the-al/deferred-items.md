## Deferred Items

- The two Python writers still read the pre-D-18 "working holder" rule (found by plan 11, 2026-09-29)
  status: open
  **What:** D-18 (founder, 2026-09-27) defines a working holder as `is_active` true, `disconnected_at` null and `sync_status` not in `revoked`, `sign_in_failed`, `error`. The TS reader (`equityHistoryReadiness` through `isWorkingHolder`, and the Exchanges note `accountShareNote`) follows it. Two writers do not: `analytics-service/services/job_worker.py::_holder_is_working` (plan 05, the derive job's duplicate gate) and `analytics-service/services/equity_reconstruction.py::_counted_through_holder` (plan 10, the legacy refresh) both use `disconnected_at IS NULL AND sync_status <> 'revoked'` and ignore `is_active`. CONTEXT's "D-18 home" entry says C2's plans 05 and 10 are written against the new rule, so this is a divergence, not a design.
  **Effect, measured by reading both sides:** a holder that is inactive, `error` or `sign_in_failed` is "working" to the writer and "not working" to the reader. The derive job then deletes the equity curve (account_duplicate), and the reader, seeing no series and no working-holder duplicate, shows the `awaiting_derivation` line ("recomputed ... once a day") for as long as the pair exists. No wrong curve renders; the reason line is wrong, and the account is counted by nobody instead of by the healthy key, which is what D-18 was decided to prevent.
  **Owner:** outside plan 11's files. Belongs to plans 05 and 10 in C2, before C2 lands.

- `/compare` per-holding analytics have no owning phase (D-13, decided by plan 11 on 2026-09-29)
  status: open
  **What:** plan 11 kept `HOLDING_COMPARE_HISTORY_STATE` at `"rebuilding"`. The four numbers are `value[i] / value[i-1] - 1` over `allocator_equity_snapshots.breakdown`, so a purchase reads as a gain. Plan 10 fixes the refresh from its merge on and rewrites no stored row. No per-holding flow-adjusted source exists and no ROADMAP phase owns one (grep of ROADMAP.md and TODOS.md, 2026-09-29).
  **Owner:** none yet. The orchestrator routes it with `/gsd-phase`; a chunk branch cannot.

- Nine `src/__tests__` census tests in four files fail on the C2 branch, and they predate plan 11 (measured 2026-09-29)
  status: open
  **What:** `mutation-runner-floors.test.ts` (FILES_FLOOR 53 vs 54 measured, ARMS_FLOOR 513 vs 545), `mutation-annotation-parser.test.ts` (four real-corpus counts), `lint-sql-gates.test.ts` (scanned 81 files, pinned 80), `ci-anti-skip-gate.contract.test.ts` (a 5000 ms timeout) No `supabase/` or `scripts/` file changed in plan 11's range (`git diff --stat e6bee174..HEAD -- supabase scripts` is empty), so a `supabase/tests` file added earlier on the branch moved the corpus without its pins. Two further failures in `verify-plan-anchors.test.ts` were plan 11's own pending anchor; they cleared when its SUMMARY landed (58/58).
  **Owner:** the C2 branch, before its PR. Not plan 11's scope.
