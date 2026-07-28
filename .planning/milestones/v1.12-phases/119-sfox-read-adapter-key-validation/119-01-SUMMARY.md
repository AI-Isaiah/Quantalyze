---
phase: 119-sfox-read-adapter-key-validation
plan: 01
subsystem: db-boundary + exchange-vocab-lockstep
tags: [sfox, constraint-widen, parity, migration, boundary-check]
requires:
  - deribit precedent migration 20260704200446 (template)
  - phase-118 SfoxClient (downstream consumer, not touched here)
provides:
  - "DB admits 'sfox' at the 4 key-save boundary CHECKs (api_keys.exchange, compute_jobs.exchange, strategies.source, strategy_verifications.source)"
  - "TS SUPPORTED_EXCHANGES / EXCHANGE_DISPLAY / STRATEGY_SOURCES admit 'sfox'"
  - "pydantic VerifyStrategyRequest.exchange / Broker / Source Literals admit 'sfox'"
  - "RED SQL guard supabase/tests/test_sfox_exchange_boundary.sql"
affects:
  - phase 119-02/03/04 (worker validate branch + key routes rely on the widened boundary)
  - phase 120 (api_verified sfox write path)
tech-stack:
  added: []
  patterns: [constraint-widen-clone-deribit, self-verifying-DO-block, parity-lockstep]
key-files:
  created:
    - supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql
    - supabase/tests/test_sfox_exchange_boundary.sql
  modified:
    - src/lib/closed-sets.ts
    - src/lib/strategy-sources.ts
    - src/components/admin/AdminTabs.tsx
    - analytics-service/models/schemas.py
    - analytics-service/routers/debug_key_flow.py
    - analytics-service/services/ingestion/adapter.py
    - analytics-service/tests/test_boundary_literals_parity.py
decisions:
  - "AdminTabs SOURCE_BADGE_LABEL gained an 'sfox' entry — a 7th lockstep site surfaced by tsc (exhaustive Record<StrategySource,string>); honest brand-lowercase 'sfox' badge (Rule 3 blocking-issue fix, in scope)"
  - "compute_jobs.exchange nullable (exchange IS NULL OR ...) form preserved with its IS-NULL RAISE guard"
  - "SKIP set untouched: funding_fees / position_snapshots / verification_requests VIEW / finalize_terminal_status_param.sql:188 (all parity-pinned or phase-120)"
metrics:
  duration: ~35m
  completed: 2026-07-18
---

# Phase 119 Plan 01: SFOX Boundary Constraint-Widen + Lockstep Allowlists Summary

Cloned the deribit boundary migration `20260704200446` for `'sfox'` — one atomic change widening the 4 key-save CHECK constraints (each with a Phase-119 self-verifying DO block) plus every code-side lockstep allowlist (TS `SUPPORTED_EXCHANGES`/`EXCHANGE_DISPLAY`/`STRATEGY_SOURCES` + AdminTabs badge map, the 3 pydantic Literals, and the pytest parity fixture), so the parity contract tests never go red between commits. A RED-guarded SQL test proves `'sfox'` is admitted at all 4 constraints while a bogus value is still rejected (widen-not-drop) and `compute_jobs.exchange` still admits NULL.

## Tasks Completed

### Task 1 — Migration + RED SQL guard (DONE)
- `supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql` — timestamp sorts after the newest existing `20260717233529`. Clones the deribit template verbatim: `BEGIN; SET lock_timeout='3s';` → for each of the 4 constraints DROP IF EXISTS → ADD CONSTRAINT (with `'sfox'` appended) → self-verifying DO block whose expected-values array includes `'sfox'` and every pre-existing value. `compute_jobs` keeps the `exchange IS NULL OR` nullable form and its `position('IS NULL' IN def)=0` RAISE guard. RAISE prefixes updated to "Phase 119 self-verify failed". `COMMIT;` then a refreshed `COMMENT ON COLUMN strategy_verifications.source` appending sfox to the vocabulary line. Forward-only, no DOWN.
- `supabase/tests/test_sfox_exchange_boundary.sql` — 4 parts (one per constraint): (a) `'sfox'` INSERT/UPDATE succeeds, (b) a bogus value (`notanexchange`/`notasource`) is rejected via `check_violation`, (c) compute_jobs still admits NULL. pgTAP-free (RAISE EXCEPTION on failure, NOTICE on pass), `gen_random_uuid()` seeds cleaned up per part.

### Task 2 — Lockstep allowlist edits (DONE, atomic with Task 1)
- `src/lib/closed-sets.ts`: `SUPPORTED_EXCHANGES += "sfox"`; `EXCHANGE_DISPLAY.sfox = "sFOX"` (brand casing).
- `src/lib/strategy-sources.ts`: `STRATEGY_SOURCES += "sfox"`.
- `src/components/admin/AdminTabs.tsx`: `SOURCE_BADGE_LABEL.sfox = "sfox"` — surfaced by tsc as a 7th exhaustive-Record lockstep site (Rule 3 blocking-issue fix, in scope per plan's "fill each with an honest sfox entry").
- `analytics-service/models/schemas.py`: `VerifyStrategyRequest.exchange` Literal += `"sfox"`.
- `analytics-service/routers/debug_key_flow.py`: `Broker` Literal += `"sfox"`.
- `analytics-service/services/ingestion/adapter.py`: `Source` Literal += `"sfox"` (did NOT touch `SUPPORTED_SOURCES`/`_FACTORIES` — phase 120).
- `analytics-service/tests/test_boundary_literals_parity.py`: `_KEY_SAVE_EXCHANGES` bumped to the 5-set incl. `"sfox"`; added sfox membership assertions for `VerifyStrategyRequest.exchange` / `Broker` / `Source`; added `TestSfoxMigrationWidensEveryKeyBoundaryCheck` asserting the NEW migration file admits sfox at all 4 constraints (mirrors the deribit migration-parity pattern).

Both tasks committed together as ONE atomic commit (parity pair never split).

### Task 3 — [BLOCKING] MCP-apply to TEST project — PENDING ORCHESTRATOR
NOT run by the executor (checkpoint:human-action, gate=blocking-human). The orchestrator has Supabase MCP access and must:
1. `apply_migration` on TEST project `qmnijlgmdhviwzwfyzlc` for **`20260718182056_sfox_exchange_boundary_checks.sql`** (the DO blocks self-verify — a silent no-op is impossible).
2. If MCP stamps `now()` in `schema_migrations`, fix that row to the file timestamp `20260718182056`.
3. Run `supabase/tests/test_sfox_exchange_boundary.sql` against TEST — must pass.
4. Verify the 4 constraint defs on TEST via MCP (`pg_get_constraintdef` contains `'sfox'`).
Only after 1–4 may the branch merge; on merge, watch the prod auto-apply run and verify objects on prod `khslejtfbuezsmvmtsdn`.

## Verification Results
- `npx tsc --noEmit` — clean (after adding the AdminTabs sfox badge entry).
- `npx vitest run check-zod-db-check-parity.test.ts strategy-sources-migration-parity.test.ts --no-file-parallelism` — 2 files / 20 tests passed.
- `.venv/bin/python -m pytest tests/test_boundary_literals_parity.py -q` — 13 passed.
- Migration SKIP-set grep (`funding_fees|position_snapshots|verification_requests`, non-comment) — 0 hits.
- Migration `'sfox'` non-comment count — 9 (≥8); 4 real ADD CONSTRAINTs (line 25 is a comment).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] AdminTabs SOURCE_BADGE_LABEL exhaustive Record**
- **Found during:** Task 2 tsc verification
- **Issue:** `Record<StrategySource, string>` at `src/components/admin/AdminTabs.tsx:26` is an exhaustive map; adding `sfox` to `STRATEGY_SOURCES` made the missing key a TS2741 compile error.
- **Fix:** Added `sfox: "sfox"` (honest brand-lowercase badge, matching the other exchange badges). This is lockstep (the plan anticipated "if OTHER exhaustive Record sites break, fill each with an honest sfox entry"), not scope creep.
- **Files modified:** src/components/admin/AdminTabs.tsx
- **Commit:** (same atomic commit)

## Threat Flags
None — this plan only ADMITS a new value at existing constrained columns (widen-not-drop, proven by the RED SQL test's reject-bogus arms). No new endpoint, auth path, or trust boundary introduced.

## Known Stubs
None.

## Self-Check: PASSED
- Migration file present: supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql
- RED SQL guard present: supabase/tests/test_sfox_exchange_boundary.sql
- Atomic commit `ca59a0ba` present (9 files, 453 insertions, 8 deletions; no file deletions)
- tsc clean; 2 vitest parity files (20 tests) + pytest boundary parity (13 tests) all green
