---
phase: 243-dbbackstop-anon-reads-only-named-metric-keys-an-api-keys-wri
plan: 04
subsystem: OG share-card route (anon-reachable read path)
tags: [postgrest, jsonb-alias, privacy, og-card, admin-client, DBACC-01]
requires: ["243-03"]
provides:
  - "OG route session read free of metrics_json_by_basis in any form"
  - "id-scoped, published-only admin read of BY_BASIS_ALIASES, rebuilt before computeOgHeadline"
affects: [243-09 column revoke (PR-B; its precondition is that PR-A, this plan included, is merged AND deployed)]
actuals:
  tokens: 6950
  tasks: 2
  commits: 2
plan_head_before: aff46a74f6ed6d8677b54f70c9a80d75bece250d
plan_head_after: 2fd4fcefb51200f1d58fa450ac32ec9e90863312
tech-stack:
  added: []
  patterns: ["named jsonb -> aliases read through the one role that keeps the column grant", "admin read behind a published-only session read"]
key-files:
  created: []
  modified:
    - src/app/api/og/factsheet/[id]/route.tsx
    - src/app/api/og/factsheet/[id]/route.test.tsx
    - src/app/api/og/factsheet/[id]/route.public-access.test.tsx
    - src/app/api/og/factsheet/[id]/route.figure-gate.test.tsx
    - src/app/api/og/factsheet/[id]/route.stored-parity.test.tsx
    - src/app/api/og/factsheet/[id]/route.cache-ttl.test.tsx
    - src/app/api/og/factsheet/[id]/route.page-agreement.test.tsx
    - src/app/api/og/factsheet/[id]/route.stale-analytics.test.tsx
key-decisions:
  - "Mechanism corrected per the plan objective: a column privilege covers every -> expression, so the anon session read drops the column and a second read through the admin client selects exactly BY_BASIS_ALIASES"
  - "A failed admin read sets failed=true, reports reportOgFailure('read'), and nulls data so the card is the generic one (not a figure card with the cash basis silently absent); a throw takes the same path through the existing catch"
  - "computeOgHeadline gets { ...analytics, metrics_json_by_basis: byBasis } only when analytics is non-null, so storedCashHeadlineGate's no_row verdict (persistedRow == null) is unchanged"
requirements-completed: [DBACC-01]
coverage:
  - id: D1
    description: "The OG session select names no form of metrics_json_by_basis; the admin read projects exactly the 21 pinned aliases"
    requirement: DBACC-01
    verification:
      - kind: unit
        ref: "src/app/api/og/factsheet/[id]/route.test.tsx#O1g"
        status: pass
      - kind: unit
        ref: "src/app/api/og/factsheet/[id]/route.figure-gate.test.tsx#the embed projection (T-194.1-12)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An unpublished, unknown or malformed id never reaches the admin client; a published id reaches it once, keyed by the row id and published-only"
    requirement: DBACC-01
    verification:
      - kind: unit
        ref: "src/app/api/og/factsheet/[id]/route.public-access.test.tsx#P8 / P8b"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed admin read fails closed (reported, no-store, generic card, no headline computed)"
    requirement: DBACC-01
    verification:
      - kind: unit
        ref: "src/app/api/og/factsheet/[id]/route.test.tsx#F1b"
        status: pass
    human_judgment: false
  - id: D4
    description: "The aliases and the admin read resolve against a real PostgREST"
    requirement: DBACC-01
    verification: []
    human_judgment: true
    rationale: "No local PostgREST was run; the live proof is CI's frontend-live-db-lane (src/lib/anon-strategies-live-probe.test.ts arm (j) runs this route's real GET as a signed-out visitor)."
duration: ~1h45m (wall clock, includes a 13 min full vitest run)
completed: 2026-11-27
status: complete
---

# Phase 243 Plan 04: DBACC-01 OG side Summary

**The OG share-card route no longer references `metrics_json_by_basis` in its anon session read; the card's one by-basis question (is there a stored `cash_settlement` object?) is answered by a second, id-scoped, published-only admin read of the 21 pinned aliases (plan 03's `BY_BASIS_ALIASES`), rebuilt with `rebuildMetricsJsonByBasis` before `computeOgHeadline`, so plan 09's anon column revoke cannot 42501 the card.**

## Accomplishments

- `route.tsx`: session select and `AnalyticsEmbed` lose the column; the select comment now says why (a column privilege covers every `->`). After the published-only session read returned a row whose analytics embed holds a row, `createAdminClient()` reads `strategy_analytics ( BY_BASIS_ALIASES )` for `strategies.id = <session row id>` wrapped in `withPublishedOnly`. Comment block states why it exists, why it runs only after the session row, why it is still published-only, and why it fails closed.
- Fail-closed: an admin `error` sets `failed = true`, calls `reportOgFailure("read", id, error)` and nulls `data` (generic card, no-store). A throw lands in the existing `catch`, which now also nulls `data`.
- Tests: `route.test.tsx` gets a recording admin fake, the session-select ban, an exact-set pin of the admin projection against hand-typed `PINNED_BY_BASIS_ALIAS_NAMES` (plus a total-entry-count check so a differently-shaped extra entry also fails), the `.eq` pair (`id`, `status=published`), and arm F1b (admin read error). `route.public-access.test.tsx` gets arm P8 (never reached for unpublished, unknown, malformed) and P8b (published reaches it once). The other five files mock the admin read (default no row, no error); their `metrics_json_by_basis: null` session seeds are removed, and `figure-gate` bans the column from the session select.

## Task commits

| Task | Commit | What |
| ---- | ------ | ---- |
| 1 (tracer) | `a34f67ddc` | route.tsx + route.test.tsx + route.public-access.test.tsx |
| 2 | `2fd4fcefb` | the other five OG route test files |

Tracer gate (auto/end-of-phase mode, automated verify only): re-ran the tracer verify (`vitest` on the two files, `tsc --noEmit`) end to end, green, then expanded.

## Verification

- `npx vitest run "src/app/api/og/factsheet/"`: 7 files, 98 tests passed.
- `npx tsc --noEmit`: clean. `npm run lint`: exit 0.
- Acceptance greps: non-comment, non-doc lines of `route.tsx` mentioning `metrics_json_by_basis` = 1 (the computed `metrics_json_by_basis: byBasis` property); `BY_BASIS_ALIASES` = 3; `createAdminClient` = 2; `PINNED_BY_BASIS_ALIAS_NAMES` in `route.test.tsx` = 3; files mocking the admin module = 7 of 7; `metrics_json_by_basis:` seeds in figure-gate and stored-parity = 0.
- Full `npx vitest run` (at HEAD `2fd4fcefb` plus plan 02's uncommitted edits in the shared tree): `Test Files 9 failed | 1284 passed | 20 skipped (1313)`, `Tests 19 failed | 28224 passed | 306 skipped (28549)`. **None touch this plan's files.** Classification of the 9 failed files:
  - Pre-existing red named in the brief: `compute.conventions.test.ts` (2), `return-stats.single-source.test.ts` (3), `mutation-annotation-parser.test.ts` (3), `FactsheetBody.advanced.test.tsx` (1).
  - Plan 02 in-flight census churn (that executor modified `scripts/mutation-floors.mjs`, `lint-sql-gates.test.ts`, `mutation-annotation-parser.test.ts`, `mutation-runner-floors.test.ts`, `gate-family-meta.test.ts` and adds a supabase/tests gate while this ran): `ci-anti-skip-gate.contract.test.ts` (2), `drift-check-scripts.test.ts` (1, `SENTINEL_FLOOR=38 / ARMS_FLOOR=589`), `lint-sql-gates.test.ts` (1), `mutation-runner-floors.test.ts` (5). Out of scope; plan 02 owns them.
  - Load-sensitive timeout, passes on its own: `scripts/factsheet-census/count.test.tsx` (profile A, "Test timed out in 5000ms"; re-run alone: pass).
- Source-text censuses that read `route.tsx`: `computed-at-reader-census.test.ts` and `options-cash-wallet-withhold.census.test.ts` passed in the full run and again in isolation, no census entry edited. (The new admin read adds no `computed_at` or recompute-verdict reference.)

## PROOF-01 (byte backups only; `cp` back and `cmp`, no git checkout/restore/stash)

Backup: `cp "src/app/api/og/factsheet/[id]/route.tsx" <scratchpad>/243-04-route.tsx.bak`.

**A. Session-select ban.** Put `metrics_json_by_basis, ` back into the session select (`... data_quality_flags, computed_at, metrics_json_by_basis, " +`), then `npx vitest run "src/app/api/og/factsheet/[id]/route.test.tsx"`:

```
 FAIL  |jsdom| src/app/api/og/factsheet/[id]/route.test.tsx > GET /api/og/factsheet/[id] > O1g — SFH-R2-01: a chain-broken Dated row whose stored headline is NOT applicable (a raw cash_settlement object) prints three dashes, as the page withholds it
AssertionError: expected 'id, name, codename, description, asse…' not to match /metrics_json_by_basis/
 Test Files  1 failed (1)
      Tests  1 failed | 22 passed (23)
```

Restore: `cp <backup> route.tsx; cmp <backup> route.tsx` printed nothing (byte-identical, "cmp silent"); re-run: `Test Files 1 passed (1) / Tests 23 passed (23)`.

**B. IDOR arm.** Neutered the condition `if (data && embedOf(data.strategy_analytics)) {` to `if (true) {` (and `data.id ?? id` to `data?.id ?? id` so it would not throw), then `npx vitest run "src/app/api/og/factsheet/[id]/route.public-access.test.tsx"`:

```
 FAIL  ... route.public-access.test.tsx > ... P8 - T-243-10: the admin alias read is never reached for a unpublished id (no row from the published-only session read)
 FAIL  ... route.public-access.test.tsx > ... P8 - T-243-10: the admin alias read is never reached for a unknown id (no row from the published-only session read)
AssertionError: expected 1 to be +0 // Object.is equality
 Test Files  1 failed (1)
      Tests  2 failed | 12 passed (14)
```

(The malformed-id arm stays green by construction: the whole read block is behind `isUuid(id)`.) Restore: `cmp` silent; re-run `Test Files 1 passed (1) / Tests 14 passed (14)`. `git status` for `src/app/api/og` is clean after both restores.

## Deviations from Plan

None - plan executed as written. Judgment calls inside the plan's latitude, recorded for the reviewer:

- On an admin read `error`, `data` is also nulled so the failure card is the generic one ("the same assertions the existing session-read-error arm makes"); without that a figure card would render with the cash basis silently absent.
- The admin fake's default (`{ data: null, error: null }`, per the plan) makes a null admin row mean "no stored basis". A real PostgREST returns a null admin row with no error only if the row was unpublished or deleted between the two reads (a sub-second race); the card then renders what the session read returned, which was true a moment earlier. Not guarded further.
- `computeOgHeadline`'s persisted argument is built only when `analytics` is non-null, so `storedCashHeadlineGate`'s `persistedRow == null` (`no_row`) verdict is unchanged.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-243-10, T-243-11, T-243-12 all mitigated and test-pinned). The new surface is exactly the one the model names: a BYPASSRLS read inside the public OG endpoint.

## Notes for plan 09 and the orchestrator

- `TODOS.md` `RANK-SPLAT-01` kept, as instructed; plan 09 deletes it when half (b) lands.
- Plan 09's precondition stands: this change must be merged AND deployed before the column revoke applies. Live proof is `frontend-live-db-lane` arm (j), not run locally.
- Out-of-scope reds listed above are not logged to `deferred-items.md`; the plan-02 ones are that executor's in-flight work.
- `commits: 2` is counted by commits touching this plan's files. The raw `aff46a74f..HEAD` range also holds plan 02's commit `3603f3c48` because both executors share the worktree.

## Self-Check: PASSED

- Files modified exist (8 route files under `src/app/api/og/factsheet/[id]/`): FOUND.
- Commits `a34f67ddc` and `2fd4fcefb`: FOUND as ancestors of HEAD.
