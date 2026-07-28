---
phase: 19
plan: 05
subsystem: frontend
tags: [BACKBONE-01, BACKBONE-04, BACKBONE-05, BACKBONE-10, phase-19-shim-step-a]
dependency_graph:
  requires:
    - 19-02-migrations-103-107
    - 19-03-ingestion-adapter-protocol
    - 19-04-process-key-router
    - 19-06-idempotency-and-process-key-long
  provides:
    - "Next.js thin-adapter infrastructure (P5-1 + P5-2)"
    - "phase-19-shim-step-a (PR-A) — verify-strategy upsert + status read repoint"
    - "H-8 CI gate scaffolding (verify-no-legacy-writes.sh + .github/workflows/phase-19-stability.yml)"
  affects:
    - "5 entry routes: verify-strategy, keys/validate-and-encrypt, strategies/finalize-wizard, keys/sync, strategies/csv-validate, strategies/csv-finalize"
    - "1 status route: verify-strategy/[id]/status (H-1 read repoint)"
tech_stack:
  added:
    - "src/lib/feature-flags.ts (TS read seam mirroring analytics-service/services/feature_flags.py)"
    - "tests/integration/ pattern (added to vitest.config.ts include glob)"
  patterns:
    - "Thin-adapter pattern: each entry route gates on isUnifiedBackboneActive(); flag=on delegates to /process-key, flag=off runs legacy verbatim"
    - "Stability-window dual-write on PR-A: keep legacy verification_requests UPDATE alongside new strategy_verifications upsert until migration 107 lands"
    - "Status-read fallback chain: query strategy_verifications first, fall back to verification_requests"
key_files:
  created:
    - src/lib/feature-flags.ts
    - tests/lib/feature-flags.test.ts
    - tests/integration/process-key-thin-adapters.test.ts
    - tests/integration/phase-19-pra-write.test.ts
    - tests/integration/phase-19-pra-status-roundtrip.test.ts
    - scripts/verify-no-legacy-writes.sh
    - .github/workflows/phase-19-stability.yml
  modified:
    - src/app/api/verify-strategy/route.ts
    - src/app/api/verify-strategy/[id]/status/route.ts
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/keys/sync/route.ts
    - src/app/api/strategies/csv-validate/route.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - vitest.config.ts
    - VERSION
    - package.json
key_decisions:
  - "PR-A ships in stability-window dual-write form: the new strategy_verifications upsert is the canonical write target post-PR-D, but the legacy verification_requests UPDATE stays alive in parallel until migration 107 ships (PR-D), at which point the VIEW + INSTEAD OF UPDATE trigger short-circuits the legacy write."
  - "PR-A's strategy_id FK is satisfied via 'most-recent strategies row' anchor (mirrors migration 107 STEP 2 backfill). When no strategies row exists yet (cold-start production), the upsert is skipped with a warn log; legacy UPDATE preserves correctness."
  - "Status-read repoint queries strategy_verifications first, falls back to legacy verification_requests for pre-PR-A rows. The fallback also covers PR-A skip cases (no anchor strategies row) and the 90-day public-token retention window after PR-D rename."
  - "factsheet/[id]/pdf/route.ts intentionally NOT modified — Open Question 2 resolution: GET-only PDF reader stays out of scope; reads strategies + strategy_analytics directly."
  - "finalize-wizard force-refresh permissions probe (route.ts:60-86 in legacy code) RETAINED at thin-adapter layer per Open Question 1 — runs BEFORE both unified delegation and legacy RPC, covering both code paths."
  - "csv-validate / csv-finalize re-target their internal upstream from /csv/validate + /csv/finalize to /process-key with flow_type='csv' when flag=on; legacy direct calls stay as fallback."
  - "PR-B (flag flip), PR-C (168h verification), and PR-D (migration 107 rename + VIEW) deferred — the ≥168h calendar window between commit (b) and commit (d) cannot collapse into a single execution session."
metrics:
  duration: "47m 46s"
  completed_date: "2026-05-08"
  tasks_completed: 3
  commits: 3
  files_created: 7
  files_modified: 10
---

# Phase 19 Plan 05: Next.js Thin Adapters + 4-PR VIEW-Shim Sequence (Stage A) Summary

**One-liner:** Shipped the TS feature-flag read seam, converted 6 entry routes to dual-path thin adapters that delegate to `/process-key` when `process_key_unified_backbone` is on, and landed PR-A (`phase-19-shim-step-a`) — the verify-strategy write repoint to `strategy_verifications` plus the H-1 status-read repoint plus the H-8 stability-window CI gate. PR-B, PR-C, and PR-D are intentionally deferred to honor the ≥168h calendar window mandate.

## Tasks Completed

| Task | Name | Commit | Key Files |
| --- | --- | --- | --- |
| P5-1 | Write `src/lib/feature-flags.ts` (TS read seam, BACKBONE-05) | `67ca552` | `src/lib/feature-flags.ts`, `tests/lib/feature-flags.test.ts` |
| P5-2 | Convert 6 entry routes to thin adapters (BACKBONE-10) | `e309c9f` | `verify-strategy/route.ts`, `keys/validate-and-encrypt/route.ts`, `strategies/finalize-wizard/route.ts`, `keys/sync/route.ts`, `strategies/csv-validate/route.ts`, `strategies/csv-finalize/route.ts`, `tests/integration/process-key-thin-adapters.test.ts`, `vitest.config.ts` |
| PR-A | `phase-19-shim-step-a` — repoint verify-strategy upsert + status read + H-8 CI gate | `81a00df` | `verify-strategy/route.ts`, `verify-strategy/[id]/status/route.ts`, `scripts/verify-no-legacy-writes.sh`, `.github/workflows/phase-19-stability.yml`, `tests/integration/phase-19-pra-write.test.ts`, `tests/integration/phase-19-pra-status-roundtrip.test.ts` |

## What Shipped (P5-1 + P5-2 + PR-A)

### P5-1 — `src/lib/feature-flags.ts` (BACKBONE-05)

40-LOC TS read seam mirroring `analytics-service/services/feature_flags.py`:

- 30-second in-process cache (`CACHE_TTL_MS = 30_000`).
- Reads Supabase `feature_flags` table for `flag_key='process_key_unified_backbone'`; if `value='off'`, force off (kill-switch wins).
- Falls back to `PROCESS_KEY_UNIFIED_BACKBONE` env var.
- Fail-soft on Supabase outage (env decides) — sustained outage surfaces in Sentry via `console.warn`.
- `_resetCacheForTests()` exported for vitest.

6 vitest cases lock the contract: kill-switch wins, env-on alone, env-off, Supabase outage fail-soft, 30s cache hit count, cache reset.

### P5-2 — 6 thin adapters (BACKBONE-10)

Pattern applied to each route: at handler entry, branch on `await isUnifiedBackboneActive()`. If false, the legacy code path runs verbatim. If true, fetch `${ANALYTICS_SERVICE_URL}/process-key` with `Authorization: Bearer ${INTERNAL_API_TOKEN}` and `X-Correlation-Id: ${getCorrelationId()}`, body shape `{flow_type, source, context}`.

Per-route mapping:

| Route | flow_type | source | Notes |
|-------|-----------|--------|-------|
| `verify-strategy/route.ts` | `teaser` | `body.exchange` | Public unauthenticated; CSRF + IP rate-limit + payload validation precede flag check. |
| `keys/validate-and-encrypt/route.ts` | `onboard` | `body.exchange` | `withAuth` wrapper preserved. |
| `strategies/finalize-wizard/route.ts` | `onboard` | `"okx"` placeholder; worker resolves | Open Question 1 — force-refresh permissions probe RUNS BEFORE both code paths. |
| `keys/sync/route.ts` | `resync` | `"okx"` placeholder; worker resolves | Legacy `USE_COMPUTE_JOBS_QUEUE` queue + `after()` paths preserved. |
| `strategies/csv-validate/route.ts` | `csv` | `"csv"` | Re-targets internal /csv/validate → /process-key; passes raw_bytes_base64 + fmt + wizard_session_id in context. |
| `strategies/csv-finalize/route.ts` | `csv` | `"csv"` | Re-targets internal /csv/finalize → /process-key. |

`factsheet/[id]/pdf/route.ts` is intentionally **not modified** per Open Question 2 — GET-only PDF reader, reads `strategies + strategy_analytics` directly, no `/process-key` call needed.

7 vitest integration cases lock the contract: 6 flag=on cases assert outbound `/process-key` URL + Authorization header + X-Correlation-Id header + canonical body shape per flow_type; 1 flag=off case asserts the legacy `keys/sync` `after()` path runs (no `/process-key` call). Added `tests/integration/**/*.test.ts` to `vitest.config.ts` include glob; the file uses `// @vitest-environment node` for FormData parsing fidelity (mirrors `src/__tests__/csv-validate-route.test.ts`).

### PR-A — `phase-19-shim-step-a` (BACKBONE-04 step a)

**C-5 — strategy_verifications upsert with all 5 NOT NULL fields populated:**
After `verifyStrategy()` returns a `verification_id`, the route now upserts a complete `strategy_verifications` row keyed on that id. Every NOT NULL column from migration 093 (`strategy_id`, `wizard_session_id`, `trust_tier`, `flow_type`, `source`) is set; the `strategy_id` FK is resolved via the same "most-recent strategies row" anchor migration 107 STEP 2 uses for its C-7 backfill. If no strategies row exists at all (cold-start production), the upsert is skipped with a `console.warn` and the legacy `verification_requests` UPDATE preserves runtime correctness. Both mutations carry `@audit-skip` pragmas with the same ADR-0023 §3 reasoning (unauthenticated public endpoint, audit_log requires user_id which the teaser flow lacks; landing-page-lead audit lands in PostHog).

**Stability-window dual-write:** the legacy `verification_requests` UPDATE stays in place until migration 107 (PR-D) renames the table and installs the read-only VIEW + INSTEAD OF triggers. After PR-D, the legacy UPDATE becomes a no-op via the trigger and the upsert is the canonical write path. The H-8 audit-log trigger (added in PR-B's migration sub-step, see §"Deferred to PR-B") flags any direct write to the legacy table for the stability-window CI gate to surface.

**H-1 — status read repoint:** GET `/api/verify-strategy/[id]/status` now queries `strategy_verifications` first (with `metrics_snapshot → results` column mapping); falls back to `verification_requests` for any historical row not yet mirrored OR for rows that PR-A's upsert skipped (no anchor strategies row). Without H-1, status checks would 404 for the entire PR-A → PR-D window.

**H-8 CI gate:**
- `scripts/verify-no-legacy-writes.sh` — reads `flag_flipped_at` from `.planning/phase-19/stability-log.md` (only set in PR-B); prints the audit_log query the operator (or hourly cron) runs via Supabase MCP. Exits 2 cleanly until PR-B records the flip timestamp.
- `.github/workflows/phase-19-stability.yml` — hourly cron (`0 * * * *`) + `workflow_dispatch`. Until PR-B ships, the workflow is a no-op gate. PR-D candidates require 168 contiguous clean hourly runs since `flag_flipped_at` (the script greps `audit_log` for `entity_type='verification_requests_legacy_write'` rows since the timestamp).
- The Postgres trigger `verification_requests_post_phase19_audit` is the missing piece — ships in PR-B's migration sub-step (slot 108 reserved). Without it, the script will see zero rows simply because nothing is logging legacy writes; the trigger is what makes the gate active.

9 vitest acceptance cases lock the contract:
- 4 C-5 cases on the upsert shape (every NOT NULL populated, source from body.exchange, dual-write preserved, graceful-degrade on no-anchor).
- 5 H-1 cases on the round-trip read order (sv-first, legacy fallback, 404 path, token mismatch, expiry).

## Deviations from Plan

### Auto-Fixed Issues

**1. [Rule 1 — Bug] Audit-coverage test failure on new mutations in verify-strategy/route.ts**
- **Found during:** PR-A — `src/__tests__/audit-coverage.test.ts` failed because the new `.upsert(` and the existing `.update(` were no longer within the 8-line lookback window of the original `@audit-skip` pragma after the dual-write refactor.
- **Fix:** Added an explicit `@audit-skip` pragma directly above each mutation chain, both citing ADR-0023 §3 (unauthenticated teaser flow → PostHog landing-page-lead audit, not audit_log). Pragma reasoning is identical for both mutations (same flow, same row).
- **Files modified:** `src/app/api/verify-strategy/route.ts`.
- **Commit:** included in `81a00df` (PR-A).

**2. [Rule 3 — Blocking] vitest.config.ts include glob did not cover `tests/integration/**`**
- **Found during:** P5-2 — first integration test attempt was not picked up by the runner.
- **Fix:** Added `tests/integration/**/*.test.ts` to the `include` array.
- **Files modified:** `vitest.config.ts`.
- **Commit:** included in `e309c9f` (P5-2).

**3. [Rule 3 — Blocking] Multipart parsing failure under jsdom for csv-validate integration test**
- **Found during:** P5-2 — `req.formData()` returned null under the default jsdom environment, dropping the test into the 400 "Invalid multipart body" branch before reaching the flag-on delegation logic.
- **Fix:** Added `// @vitest-environment node` pragma at top of the integration test file, mirroring `src/__tests__/csv-validate-route.test.ts`.
- **Files modified:** `tests/integration/process-key-thin-adapters.test.ts`.
- **Commit:** included in `e309c9f` (P5-2).

### Deferred Items

**1. PR-B (flag flip), PR-C (168h verification), PR-D (migration 107 rename + VIEW + INSTEAD OF triggers).**
- **Why deferred:** the orchestration prompt explicitly directs only PR-A in this session — the ≥168h calendar window between commit (b) and commit (d) is mandated by H-7 and enforced by `scripts/check-phase-19-shim-commits.sh`. Collapsing the window into a single execution would defeat the soak-test purpose.
- **Operational runbook for landing the remaining steps:**
  1. **PR-B (`phase-19-shim-step-b:`):** flip `PROCESS_KEY_UNIFIED_BACKBONE=on` on Vercel + Railway production. Update `.planning/phase-19/stability-log.md` with the exact `flag_flipped_at` ISO-8601 UTC timestamp. Apply the H-8 Postgres trigger (`verification_requests_post_phase19_audit`) as a SQL migration sub-step (or new slot 108) so audit_log captures any direct write to the legacy table. Bump VERSION + package.json. Commit subject: `phase-19-shim-step-b: flip PROCESS_KEY_UNIFIED_BACKBONE=on production + audit trigger`.
  2. **PR-C (`phase-19-shim-step-c:`):** wait ≥168h calendar from PR-B's `flag_flipped_at`. Each day, append a row to `.planning/phase-19/stability-log.md` with the Sentry error-envelope rate (must stay <0.5% per BACKBONE-04 exit criteria) + run `scripts/repro-key-flow.sh` against OKX + Bybit cassettes. Run `scripts/verify-no-legacy-writes.sh` daily; assert zero `audit_log` rows with `entity_type='verification_requests_legacy_write'` since `flag_flipped_at`. Bump VERSION + package.json (the bump itself is the deliverable). Commit subject: `phase-19-shim-step-c: verify zero legacy writes over 168h stability window`.
  3. **PR-D (`phase-19-shim-step-d:`):** apply migration 107 via Supabase MCP `mcp__supabase__apply_migration` against project `qmnijlgmdhviwzwfyzlc`. Verify via `mcp__supabase__execute_sql`: `SELECT count(*) FROM information_schema.views WHERE table_name='verification_requests'` returns 1; `SELECT count(*) FROM information_schema.tables WHERE table_name='verification_requests_legacy'` returns 1. Bump VERSION + package.json. Commit subject: `phase-19-shim-step-d: rename + VIEW + INSTEAD OF triggers (migration 107)`.
  4. **After all 4 PRs:** `bash scripts/check-phase-19-shim-commits.sh` exits 0 (with the SIGPIPE bug below fixed, see deferred-items.md).

**2. `scripts/check-phase-19-shim-commits.sh` SIGPIPE bug (cross-plan finding from P1).**
- **Why deferred:** the script ships from Phase 19 P1 (Wave 1) and was discovered during P5 validation; per executor scope rules, only directly-task-caused issues are auto-fixed. CI does not currently invoke the script (verified via `grep -rn .github/workflows/`), so the bug is non-blocking for PR-A.
- **Tracking:** `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/deferred-items.md`.

## Threat Flags

None. The 7 modified routes already carry the route-inventory disposition (5 `flow_type=...` + factsheet `out of scope`). The new feature-flags read seam is server-only (`import "server-only"` enforced) and the H-8 GitHub Actions workflow takes no event-payload inputs (only the static `SUPABASE_PROJECT_ID` env literal).

## Verification Run

- `npx vitest run` → **3039 passed | 159 skipped (3198)**. Includes the 22 new tests this plan adds: 6 feature-flags + 7 thin-adapters + 4 PR-A C-5 + 5 PR-A H-1.
- `npx tsc --noEmit` → clean.
- `npx eslint --cache ...` on all touched files → clean (only the .sh file shows the expected "no matching configuration" warning).
- `bash scripts/check-route-inventory.sh` → `OK: route inventory complete + every non-GET row mapped + method-label parity verified (C-6).`
- Acceptance grep checks (P5-1 + P5-2):
  - 6 routes import `isUnifiedBackboneActive` ✓
  - `flow_type: "resync"` in keys/sync ✓
  - `flow_type: "teaser"` in verify-strategy ✓
  - `flow_type: "onboard"` in finalize-wizard + validate-and-encrypt ✓
  - `flow_type: "csv"` in csv-validate + csv-finalize ✓
  - `Phase 19 / Open Question 1` sentinel comment present in finalize-wizard ✓
  - `factsheet/[id]/pdf/route.ts` untouched ✓
- Acceptance grep check (PR-A):
  - First commit with `^phase-19-shim-step-a:` prefix present in branch history ✓

## Self-Check: PASSED

All claimed files exist:
- `src/lib/feature-flags.ts` ✓
- `tests/lib/feature-flags.test.ts` ✓
- `tests/integration/process-key-thin-adapters.test.ts` ✓
- `tests/integration/phase-19-pra-write.test.ts` ✓
- `tests/integration/phase-19-pra-status-roundtrip.test.ts` ✓
- `scripts/verify-no-legacy-writes.sh` (executable) ✓
- `.github/workflows/phase-19-stability.yml` ✓
- All 7 modified routes carry their expected changes ✓

All claimed commits exist in branch history:
- `67ca552` — `feat(19-05): add src/lib/feature-flags.ts (BACKBONE-05 TS read seam)` ✓
- `e309c9f` — `feat(19-05): convert 6 entry routes to thin adapters (BACKBONE-10)` ✓
- `81a00df` — `phase-19-shim-step-a: repoint verify-strategy upsert + status read + H-8 CI gate` ✓
