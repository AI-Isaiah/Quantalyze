# Phase 159: RANK — Public-ranking integrity - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-21
**Phase:** 159-RANK — Public-ranking integrity
**Areas discussed:** Census & C-D1 gate, Splat-class closure, Gate-helper placement, RANK-05 mechanism, RANK-08 fingerprint, RANK-09 uid validation
**Mode:** `--auto` (gsd-autonomous run; recommended option selected per area, no user prompts)

---

## Census & the C-D1 decision gate

| Option | Description | Selected |
|--------|-------------|----------|
| Committed census artifact + UAT surfacing; filter proceeds | ROADMAP pre-decides disappearing ranks are the honest outcome; the census makes it a decided one | ✓ |
| Block the filter until a human reviews the census | Turns C-D1 into a hard human gate | |

**Notes:** ROADMAP criterion 2 already decides the honesty call; the artifact + UAT surfacing satisfies "decided, never a surprise" without a mid-run block.

---

## Splat-class closure (RANK-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Whole class — classify every splat site | 4 sites found at HEAD vs 2 named in the requirement; anon-reachable get projections, owner-only get exemption comments | ✓ |
| Only the two sites the requirement names | Point-fix; leaves unclassified splats | |

**Notes:** Requirement's `queries.ts:218` already drifted to `:210` — line refs rot, classes don't. House rule: close the whole class.

---

## Gate-helper placement (RANK-01)

| Option | Description | Selected |
|--------|-------------|----------|
| `src/lib/closed-sets.ts` next to `isComputedAnalytics` (MD-01) | The single-source module exists for exactly this | ✓ |
| New helper module near queries.ts | Second home for closed-set logic; invites drift | |

---

## RANK-05 quantstats mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit returns at call site, mirror the previously-closed path | Root-cause: never let quantstats guess; reuse existing pattern | ✓ |
| Patch/pin/wrap quantstats | Treats the guesser, keeps the guess | |

---

## RANK-08 re-mint fingerprint

| Option | Description | Selected |
|--------|-------------|----------|
| Include classification; evidence-gated fallback to documented exclusion | Real fix preferred; requirement's own either/or preserved | ✓ |
| Document the exclusion only | Cheaper, but leaves the 409 remedy broken | |

---

## RANK-09 uid shape validation

| Option | Description | Selected |
|--------|-------------|----------|
| Strict UUID validation, fail closed to published-only | House style: fail safe, closed, loud | ✓ |
| Escape/sanitize and continue | Permissive; keeps interpolation risk surface | |

---

## Claude's Discretion

Projection column lists, census SQL, CAS race-test shape, RANK-06 blend detail
(respecting `closed_sets.py` MD-01), test placement. Money-math tests use
economic-invariant oracles.

## Deferred Ideas

- `StrategyTable` ungated KPI cells (C-D2 — ROADMAP-logged, out of scope)
- RANK-03/RANK-04 → Phase 160

## Conflict surfaced (Rule 7)

ROADMAP research note says "skip a research phase"; standing user directive
(feedback memory, post-P140) says ALWAYS run pattern-mapper + researcher.
The user directive wins — planning will run the full default flow. The ROADMAP
note is honored in spirit: research scope is narrow (census + fix-site confirmation).
