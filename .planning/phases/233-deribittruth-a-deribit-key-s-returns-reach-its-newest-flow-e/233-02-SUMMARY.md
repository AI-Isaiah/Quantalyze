---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
plan: 02
subsystem: prod-prober
tags: [prober, freshness, FRESH-02, FRESH-01, PROOF-01, deribit]
requires: []
provides:
  - "fifth prober arm `freshness` (two PROD reads, pure judge, held-back fixture pages)"
  - "scope log line `freshness: scope derived=<n> with_inputs=<n> with_terminal=<n>` (A5 evidence for plan 233-06)"
affects: [233-04, 233-06]
tech-stack:
  added: []
  patterns: ["cron-obs arm shape: header, constants, exported *_SQL, REMEDIES, pure parsers, pure judge, run, ARM"]
key-files:
  created:
    - scripts/prod-prober/arms/freshness.mjs
    - scripts/prod-prober/fixtures/freshness/ok.json
    - scripts/prod-prober/fixtures/freshness/stale.json
  modified:
    - scripts/prod-prober/run.mjs
    - src/__tests__/prod-prober-wiring.test.ts
    - .github/workflows/prod-prober.yml
key-decisions:
  - "FRESHNESS_BOUND_DAYS = 2 (one named constant), subject `<venue>#<tag>` with tag = first 8 hex of md5 of the key id"
  - "judgeFreshness takes an optional third `tally` argument so the outcome log line can carry per-state counts while the return shape stays an array of defects"
metrics:
  duration: "about 25 min wall clock (machine under heavy load)"
  completed: 2026-11-25
status: complete
commits: 1
plan_head_before: 1b4725bf5dc5de6fe7516938227a6b4d7fcfbe72
plan_head_after: 506dd9e6db80dfdd2f028c556add8aec20d80e5b
actuals:
  tokens: 8200
  tasks: 2
  commits: 1
---

# Phase 233 Plan 02: Freshness prober arm Summary

A fifth prober arm, `freshness`, compares every derived key's newest stored return day with its newest flow, terminal or NAV-mark day and pages a gap over 2 days that has no day-by-day stated reason and no anchor reason. The held-back fixture pages exactly once and the diagnosed account's shape (28-day gap, every day stated) is in the GREEN control.

## What shipped

- `scripts/prod-prober/arms/freshness.mjs`: `FRESHNESS_BOUND_DAYS = 2`, `FRESHNESS_SCOPE_SQL`, `FRESHNESS_KEYS_SQL`, `REMEDIES` (`freshness-stale`), `parseFreshnessScope`, `parseFreshnessRows` (static error text naming record ordinal and column, never a value), `judgeFreshness` (pure, integer UTC days, never reads the clock), `run` (scope read first, the fixed scope log line, keys read, outcome line), `ARM` with the two existing credential names.
- Fixtures `ok.json` (healthy gap 1; gap equal to the bound; diagnosed shape with 28 stated days; anchor-reason key with a far-past reference day; no-returns key; no-inputs key; scope counts agree with the rows) and `stale.json` (one key, gap 13, no reason).
- `run.mjs`: import, `SQL_ARM_MODULES`, `ARMS_FLOOR` 5, kind `freshness-stale`, `ARMS`, two `fixtureSql` branches (GREEN default when a bundle names no freshness data), `ARM_FIXTURE_TABLE` entry, `allGreenSeams`, `KIND_ASSERTIONS`, and the FULL GREEN, CROSS-ARM and contact-write scenario counts (read off the failing self-test: 12 credential slots across 8 names, `arms: 5/5/0`, `armsExecuted` 5, `armsBlocked` 5).
- Wiring test: roster, floor (5, sorted names), scenario literal.
- Workflow: prose only (name, header entry, dispatch descriptions, timeout comment, probe step name). No softening token added; both status-capture lines and the posture block untouched.

Scenario count: **91 to 93** (the green fixture and the one red fixture; read from the self-test header, set in `run.mjs` and the wiring literal).

Scope, terminal and row-count guards, the `freshness-no-scope` kind, the measure-fail fixture modes, partial-cover and bound-plus-one fixtures, and the field-binding describe are plan 233-04's.

## PROOF-01

Backups were written to the session scratchpad, restored with `cp` and compared with `cmp` (no output, exit 0). The fresh-a-bound RED cell is the first failing line; the failing scenario header was `=== SELF-TEST 33/93: freshness-stale fires on stale.json, and NOTHING else does ===`. The fresh-c-anchor RED line is cut after the subject (the remainder is the defect detail and remedy text); its scenario header was `=== SELF-TEST 32/93: freshness GREEN fixture (ok.json) — the control ===`.

| arm | neuter edit | command | RED | cmp | GREEN |
|-----|-------------|---------|-----|-----|-------|
| fresh-a-bound | freshness.mjs: `FRESHNESS_BOUND_DAYS = 2;` to `FRESHNESS_BOUND_DAYS = 9999;` | node scripts/prod-prober/run.mjs --self-test | RED: SELF-TEST FAIL: stale.json exits 1 (got 0) | cmp: exit 0, no output | GREEN: === SELF-TEST PASSED: 93/93 scenarios, every arm's kinds fired on their own fixtures and nowhere else === |
| fresh-c-anchor | freshness.mjs `judgeFreshness`: the `if (r.anchorNullReason !== "") { ... count("coveredAnchor"); continue; }` block deleted | node scripts/prod-prober/run.mjs --self-test | RED: SELF-TEST FAIL: ok.json exits 0 (got 1; defects [{"kind":"freshness-stale","arm":"freshness","subject":"okx#aaaa0004", ... | cmp: exit 0, no output | GREEN: === SELF-TEST PASSED: 93/93 scenarios, every arm's kinds fired on their own fixtures and nowhere else === |
| fresh-d-unregistered | run.mjs `ARMS`: `, FRESHNESS_MOD.ARM` removed from the array | node scripts/prod-prober/run.mjs --self-test; npx vitest run src/__tests__/prod-prober-wiring.test.ts | RED: SELF-TEST FAIL: the registry equals the pinned floor (4 arms, floor 5); wiring: × the arm floor is FIVE and the registry meets it 8ms (and × SELF_TEST_SCENARIOS is 93, and the runner PRINTS exactly 93 headers numbered 1..93 78ms), Tests  2 failed \| 116 passed (118) | cmp: exit 0, no output | GREEN: === SELF-TEST PASSED: 93/93 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===; wiring: Tests  118 passed (118) |

## Gate results (tail lines)

- `node scripts/prod-prober/run.mjs --self-test`: `=== SELF-TEST PASSED: 93/93 scenarios, every arm's kinds fired on their own fixtures and nowhere else ===`.
- Wiring test alone: `Tests  118 passed (118)`.
- Reader list (the twelve files named in Task 2): first run under heavy machine load `Tests  5 failed | 1887 passed | 17 skipped (1909)`; all five failures were `Test timed out in 5000ms` or the 55 s spawn cap (accounttruth-census (e), ci-apt-bounded R4, ci-docs-path-filter "not vacuous", two local-stack-lane-wiring tests), none touching the prober. Re-run of those four files with `--testTimeout=400000 --maxWorkers=1`: `Test Files  4 passed (4)`, `Tests  263 passed (263)`. Treated as load timeouts, not pre-existing failures, so no base-commit scratch worktree was needed.
- Whole-tree invariants (`src/lib/*invariant*`, `src/__tests__/*invariant*`, `seam-log-coverage`, `critical-regressions`): `Test Files  17 passed (17)`, `Tests  660 passed (660)`.
- `npm run lint`: exit 0, 0 errors, 4 warnings, all in files this plan did not touch (`composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`); the planning-hygiene checks print OK.
- `gitleaks dir` over `freshness.mjs`, the fixtures directory, `run.mjs`, the wiring test and the workflow: `no leaks found` for each.
- `node scripts/verify-plan-anchors.mjs` on the plan: exit 0 (precondition).

## Known limits

- O2: `anchor_null_reason = balance_error` covers a gap for as long as the read keeps failing. That is the locked rule as written.
- O3: a key with no returns, or with no `key_inputs` row, is counted and logged by the arm and never paged.
- O6: strategy-mode series are outside the arm (they store `tiny_base_days` but no flow, anchor or terminal day, so there is no comparison side); recorded and routed, not built. The TODOS entry text is in plan 233-06's ship handoff.
- A5: the prober role's read of `allocator_equity_derived` (FORCE RLS) and `compute_jobs` is proven only by a run of the prober itself. An RLS denial returns zero rows rather than an error, so the evidence is `derived` and `with_inputs` at least 1 on the scope line; plan 233-06 records it as proven (with a run id) or unproven with a post-merge owner.
- A7: the subject tag is the first 8 hex characters of an md5 of the key id, printed into a public GitHub issue; it cannot be reversed to the id without database access; rated reversible (venue plus ordinal is the fallback).
- The diagnosis census was measured on a weekday. If a weekend run pages an MT5 key, that is a finding to read, not a reason to widen the locked rule.
- Until plan 233-04 lands the scope, terminal and row-count guards, the arm is not shipped; the phase ships as one PR.

## Deviations from Plan

None - plan executed exactly as written.

Two small choices inside the plan's latitude: the outcome line's per-state counts come from an optional third `tally` argument on `judgeFreshness` (return shape unchanged), and the workflow's timeout comment says "the freshness arm adds two" short SQL reads instead of restating a total (the cron arms' read count was already loosely stated there).

## Known Stubs

None.

## Threat Flags

None. The two statements are SELECT/WITH only (the self-test read-only scenario now ranges over this module), return no key id, allocator id or amount, and the arm reads no `process.env`.

## Self-Check: PASSED

- FOUND: scripts/prod-prober/arms/freshness.mjs, scripts/prod-prober/fixtures/freshness/ok.json, scripts/prod-prober/fixtures/freshness/stale.json
- FOUND: commit 506dd9e6d (feat(233-02)), ancestor of HEAD
