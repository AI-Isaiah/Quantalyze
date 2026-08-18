---
phase: 146-rate
plan: 03
subsystem: rate-limit value audit / phase close
tags: [ratelimit, value-audit, parity, todos, closure]
requires: [146-01, 146-02]
provides:
  - "146-AUDIT.md §3: RATE-04/TS-22 value-parity table fresh at HEAD, 13 flows, 5 explicit hypothesis verdicts"
  - "TODOS.md: 5 value-change candidates with measured numbers (D-146-4)"
  - "146-AUDIT.md §4: phase close, SC1-SC5 evidence pointers, ship-gate reversal points"
  - "ROADMAP SC4 annotated inline with D-146-4 disposition (W2 plan-check fix)"
affects: [verification, ship-gate]
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - .planning/phases/146-rate/146-AUDIT.md
    - TODOS.md
    - .planning/ROADMAP.md
decisions:
  - "D-146-4 honored: ZERO live limit values changed; all 5 remediation candidates founder-queued to TODOS with both measured numbers each"
  - "H-5 (retry double-spend, TODOS 'H1' row): RECORD-ACCEPT — exemption is a new mechanism, out of LIGHT-depth character; reversal = ship gate"
  - "Cron surfaces (warm-analytics, /cron-recompute) recorded out of scope per requirements decision #7 + A2"
  - "Full 14-route surface audited, not the requirement's stale 'seven' (research Open Question 4)"
metrics:
  duration: "~25m"
  completed: "2026-08-18"
actuals:
  tokens: 5838   # chars/4 over git diff 828a881e~1..HEAD (23,351 chars, realized diff)
  tasks: 2
  commits: 2
status: complete
---

# Phase 146 Plan 03: RATE-04/TS-22 value-parity audit + phase close Summary

**One-liner:** Both rate-limit value tables rebuilt fresh from source at HEAD
`e912e38b`, 13 user-visible flows compared (4 MISMATCH / 9 CONSISTENT), all
five pre-identified hypotheses explicitly adjudicated (4 CONFIRMED, H-2
confirmed-as-mechanism/flow-consistent, H-5 RECORD-ACCEPT), five value-change
candidates founder-queued to TODOS with measured numbers per D-146-4, and the
phase closed in §4 with green gates and checkbox discipline.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | `828a881e` | 146-AUDIT.md §3 (tables A/B fresh, 13-flow parity, hypothesis verdicts, decisions) + 5 TODOS candidates |
| 2 | `85acca81` | 146-AUDIT.md §4 phase close + ROADMAP SC4 D-146-4 annotation (W2 plan-check fix) |

## Hypothesis verdicts (146-AUDIT.md §3)

| # | Hypothesis | Verdict |
|---|---|---|
| H-1 | bridge/portfolio-optimizer 30× (Vercel 300/h vs Python 10/h) | **CONFIRMED** — Vercel side wrong; remedy: mint new named limiter (~10/3600s), never resize userActionLimiter → 2 TODOS bullets |
| H-2 | validate-and-encrypt dual buckets (2 tokens, two separate 100/h) | **CONFIRMED as mechanism; flow CONSISTENT** (lockstep depletion = 100 connects/h binding, deliberate burst-vs-sustained layering) — no TODOS bullet |
| H-3 | verify-strategy: per-IP 600/h front vs 30/h ONE shared platform anon bucket | **CONFIRMED** — structural blindness + growth ceiling; anti-abuse docblock cited (T-146-09) → TODOS bullet |
| H-4 | L-9 /optimize-weights 20/min/tenant post-TS-04 | **CONFIRMED as out of pattern** (4× headroom vs siblings' 1.5×; no UX harm, Vercel gates first) → TODOS bullet (10/min candidate, literal pin same commit) |
| H-5 | retry double-spend of Python tokens (TODOS "H1" row) | **CONFIRMED as live mechanism; RECORD-ACCEPT** — reversal point = ship gate |

Additional finding beyond the five: csv-validate rides `/process-key` (1200/h
Vercel vs shared tenant 100/h, 12×) and `csvValidateLimiter`'s docblock cites
the wrong upstream cap (`csv.py` 30/h has no TS caller) → 5th TODOS bullet.

## TODOS candidates filed (TODOS.md § "Phase 146 — RATE-04 value-parity candidates")

1. Bridge: 300/h vs 10/h — mint `bridgeComputeLimiter` ~10/3600s.
2. Portfolio-optimizer: 300/h vs 10/h — same new limiter, second adopter.
3. L-9 `/optimize-weights`: 1200/h/tenant floor vs 300/h forwarded — 10/min
   candidate; `test_limiter_identity.py` literal pin moves same commit.
4. verify-strategy anon: 600/h/IP vs 30/h shared platform bucket — per-IP anon
   keying or raised tier (founder call; anti-abuse rationale cited).
5. csv-validate: 1200/h vs shared `/process-key` tenant 100/h + stale docblock
   citation — tier decision + docblock fix same commit.

**Zero live values changed** — Task-1 git-diff gate over `src/lib/ratelimit.ts`
+ `analytics-service/routers/` returned 0 files → `audit-clean`.

## Phase-gate suite tails (all EXIT codes captured unpiped)

**vitest trio** (`npx vitest run src/lib/seam-ratelimit-posture.invariant.test.ts
src/lib/api/limiter-ordering.test.ts src/app/api/admin/match/eval/route.test.ts
--no-file-parallelism`):
```
 Test Files  3 passed (3)
      Tests  62 passed (62)
VITEST_EXIT=0
```

**Full pytest** (from `analytics-service/`, `python3 -m pytest -q`):
```
5178 passed, 89 skipped, 1431 warnings in 112.47s (0:01:52)
PYTEST_EXIT=0
```

**mypy** (`python3 -m mypy --strict --follow-imports=silent services/ routers/ models/`,
the CI invocation from ci.yml:1192):
```
Success: no issues found in 91 source files
MYPY_EXIT=0
```

## Closure discipline (recorded outputs)

```
RATE_UNTICKED=5          # grep -c "^- \[ \] \*\*RATE-0" .planning/REQUIREMENTS.md
MERGE_BASE=8432a0b6e29ef563fef4479b9d77415704557c3e
MIGRATIONS_IN_DIFF=0     # git diff --name-only 8432a0b6...HEAD -- supabase/migrations/
close-clean              # Task-2 automated verify gate
```

REQUIREMENTS.md RATE-01..05 remain unticked — verification owns ticks.

## Deviations from Plan

None - plan executed exactly as written. (Verdict-semantics definition added to
§3's header — MISMATCH reserved for flows where a value/bucket change is
recommended — is within the plan's "verdict CONSISTENT or MISMATCH" mandate,
not a deviation.)

## Known Stubs

None — docs-only plan; no code created or modified.

## Threat Flags

None — no new security surface. T-146-07/08/09 mitigations applied as planned
(fresh citations throughout §3; zero value diffs; scenarioPeerLimiter and the
anon-bucket docblocks cited before/instead of change proposals).

## Self-Check: PASSED

- 146-03-SUMMARY.md exists (131 lines pre-check); 146-AUDIT.md 446 lines.
- Commits `828a881e`, `85acca81` present on `feat/v1.19-phase-146`.
- Task-1 gate `audit-clean` and Task-2 gate `close-clean` both observed.
