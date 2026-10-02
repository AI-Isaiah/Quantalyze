---
phase: 146-rate
plan: 01
subsystem: api-rate-limiting
tags: [ratelimit, upstash, seam, invariant-tests, census]
requires: []
provides:
  - "admin/match/eval rate-limited (adminActionLimiter 20/min per user.id, chokepoint-routed deny)"
  - "146-AUDIT.md §1 RATE-01 fresh census + §2 RATE-05 VERIFIED-EXISTING receipt"
  - "NO_LIMITER_QUARANTINE = [] (posture invariant)"
affects: [146-02, 146-03, ship-gate]
tech-stack:
  added: []
  patterns:
    - "neuter-RED via generated scratch variants + temp vitest alias config (145-03/04 register, TS edition)"
key-files:
  created:
    - .planning/phases/146-rate/146-AUDIT.md
  modified:
    - src/app/api/admin/match/eval/route.ts
    - src/app/api/admin/match/eval/route.test.ts
    - src/lib/seam-ratelimit-posture.invariant.test.ts
    - src/lib/api/limiter-ordering.test.ts
    - TODOS.md
decisions:
  - "D-146-1 honored: RATE-05 closed as VERIFIED-EXISTING; no withRateLimit symbol minted (0 repo-wide incl. tests); reversal point = ship human gate"
  - "D-146-2 honored: only the eval gap closed; all 3 TS rosters moved in the SAME commit as the route change"
  - "D-146-4 honored: reused adminActionLimiter (20/min) — no limiter value minted or retuned"
metrics:
  duration: "~11m"
  completed: "2026-08-18"
actuals:
  tokens: 6185   # chars/4 over git diff 8432a0b6..HEAD (realized diff, plan scale)
  tasks: 3
  commits: 2
status: complete
---

# Phase 146 Plan 01: RATE-02 eval limiter + RATE-01 census + RATE-05 receipt Summary

`admin/match/eval` now enforces 20/min per admin user.id via the sibling
recompute's `adminActionLimiter` with chokepoint-routed 429/503 denies, all
three TS test rosters moved in the same commit, and `146-AUDIT.md` carries the
twice-derived fresh census (14 seam routes, quarantine empty) plus the RATE-05
VERIFIED-EXISTING receipt.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer) | `70a8918d` | eval route.ts + route.test.ts + posture invariant + limiter-ordering (exactly 4, one commit; `git show --stat` verified) |
| 2+3 | `f583572c` | 146-AUDIT.md (§1+§2+§3-PENDING) + TODOS.md retirement |

## Task outcomes

1. **Task 1 (tracer)** — eval GET: `checkLimit(adminActionLimiter,
   `match-eval:${user.id}`)` after the isAdminUser gate, deny via
   `rateLimitDenyJson` with recompute's exact body/header shapes (429
   RATE_LIMITED + Retry-After + Cache-Control private,no-store / 503
   SEAM_MISCONFIGURED). Rosters same-commit: posture invariant
   (EXPECTED_LIMITER_ROUTES +eval, NO_LIMITER_QUARANTINE → `[]`, stale
   docblocks at :94-100 and the quarantine rewritten), limiter-ordering
   (NO_INPUT bucket). Two deny-arm behavioural cases added through the REAL
   chokepoint (`vi.spyOn` on the post-resetModules registry instance; no
   `vi.stubGlobal`). Three suites green: 62 tests, EXIT=0 unpiped. Tracer
   feedback gate re-run green post-commit.
2. **Task 2** — census derived twice fresh at HEAD `70a8918d`: the posture
   invariant (living, from-disk) + an independent one-off comment-stripped
   three-module import-edge scan. Route-for-route agreement (14 routes / 15
   sites); zero rows inherited from 146-RESEARCH.md. Table + verbatim outputs
   in 146-AUDIT.md §1. TODOS.md stale "6 routes unlimited" bullet retired in
   place with pointer + fresh receipts for the three non-seam routes it named.
3. **Task 3** — RATE-05 legs (a)-(e) re-proven with verbatim command+output
   pairs in §2; disposition VERIFIED-EXISTING per D-146-1; honest residual
   (quarantine = forcing function, not prohibition; no wrapper fits an admin
   GET) and ship-gate reversal point recorded. `withRateLimit` count: 0
   repo-wide including tests.

## Neuter-RED records (each on a generated scratch VARIANT via temp vitest alias config — production files never edited; harness deleted before commit)

| # | Case | Neuter (named in plan) | Observed RED (verbatim head) | Restored |
|---|---|---|---|---|
| a | 429 deny-arm | route variant: limit check stubbed always-success (`const rl = await checkLimit(…)` → `{ success: true }`) | `AssertionError: expected 200 to be 429 // Object.is equality` (503 case also red: `expected 200 to be 503`) | GREEN (62/62) |
| b | 503 misconfig-arm | ratelimit variant: `isRateLimitMisconfigured` body → `return false;` | `AssertionError: expected 429 to be 503 // Object.is equality` (only the misconfig case red — correct selectivity, 31 others green) | GREEN (62/62) |

Exit codes captured unpiped throughout (NEUTER_A_EXIT=1, NEUTER_B_EXIT=1,
FINAL_EXIT=0, TRACER_GATE_EXIT=0, tsc EXIT=0).

## Deviations from Plan

**1. [Rule 3 - Blocking] Neuter harness alias miss for mode (b), fixed in-harness** —
first run of neuter (b) stayed GREEN (32/32): Vite's built-in alias plugin
rewrites `@/lib/ratelimit` to the resolved absolute path BEFORE enforce-pre
user plugins see it, so the harness's specifier match never fired. Fixed by
also matching the post-alias resolved path (with/without `.ts`); RED then
observed. Production code untouched; harness deleted before commit. (A neuter
that cannot redden is the vacuity failure the founder rule names — caught
because the RED was observed, not assumed.)

**2. [Note] Commits on `feat/v1.19-phase-146`** — the branch the orchestrator
explicitly designated for this worktree (not a protected ref); supersedes the
generic per-agent-branch namespace check, same as the recorded 145-03/04 note.

No other deviations — plan executed as written. No packages installed; no
migration (git diff origin/main...HEAD under supabase/migrations/ = 0 files);
no secrets printed; REQUIREMENTS.md checkboxes for RATE-01/02/05 left
UNTICKED (verification owns ticks).

## Known Stubs

None. §3 of 146-AUDIT.md is a MARKED PENDING section owned by Plan 146-03
(documented in the artifact itself, per the plan's own output spec — not a
stub of this plan's goal).

## Verification

- Three suites green with roster moves same-commit: `npx vitest run
  src/app/api/admin/match/eval/route.test.ts
  src/lib/seam-ratelimit-posture.invariant.test.ts
  src/lib/api/limiter-ordering.test.ts --no-file-parallelism` → 3 files /
  62 tests passed, EXIT=0 (unpiped)
- `npx tsc --noEmit` → EXIT=0
- Task 2 verify → `census-committed`; Task 3 verify → `receipt-committed`
- `git show --stat 70a8918d` → exactly the 4 Task-1 files; no ratelimit.ts
  value changed (file untouched in the diff)

## Self-Check: PASSED

All created files exist on disk; commits `70a8918d` + `f583572c` in log; zero
neuter-harness files remaining in the tree.
