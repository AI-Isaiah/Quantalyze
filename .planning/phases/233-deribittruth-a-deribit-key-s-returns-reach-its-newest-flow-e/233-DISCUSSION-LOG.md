# Phase 233: DERIBITTRUTH - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-24
**Phase:** 233-deribittruth
**Areas discussed:** FRESH-01 premise, S2 sequencing, FRESH-02 home, DBOOK-01 withhold criterion

Questions were relayed to the founder by the coordinator; the phase agent could not ask directly.

## FRESH-01 premise

| Option | Description | Selected |
|--------|-------------|----------|
| Diagnosis + confirmation reading + FRESH-02 accepts stated days | No writer change, no backfill; the stored named reason already exists | ✓ |
| Writer change so the series reaches 2026-11-23 | Overturns 188 D-02 and D-08 | |

**User's choice:** the recommended option (founder 2026-11-24).

## S2 sequencing (`out_of_window_flow` on a left-out tail day)

| Option | Description | Selected |
|--------|-------------|----------|
| 233 does not touch S2; route the general case to 234 | Self-heals for this account on 2026-11-26 | ✓ |
| 233 widens the window to cover stated days; 234 re-bases | Touches S2 before its owner | |

**User's choice:** the recommended option, plus a dated note in ROADMAP adding the case to Phase 234's scope.

## FRESH-02 home

| Option | Description | Selected |
|--------|-------------|----------|
| Fifth prod-prober arm `freshness` | Outside ci.yml, pages by issue, no migration, ARMS_FLOOR 4→5 | ✓ |
| Arm of `ops_staleness_check()` (S5) | Pages by Sentry and email; serial-lane migration; 238 PR-2 queues behind it | |

**User's choice:** the recommended option, with the check rule as stated.

## DBOOK-01 withhold criterion

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Independent per-day attribution oracle; unreproducible or base-less days withheld by name; capital-outside-base days named, not nulled | No plausibility bound | ✓ |
| (b) Also null flow-adjacent days with capital outside the base | Needs a raw-log re-crawl; changes published history | |
| (c) Also null cash-basis option days before the first mark | Changes published history | |

**User's choice:** (a).

## Decided autonomously

[auto] [FRESH-02] — Q: "What is the stated bound?" → Selected: "2 calendar days, one named constant" (reversible technical — decided autonomously: a one-line constant)
[auto] [FRESH-02] — Q: "Does the arm also cover strategy-mode series?" → Selected: "planner measures; include under the same two reasons if a stated-days field exists, else record and route" (reversible technical — decided autonomously: arm logic only)
[auto] [DBOOK-01] — Q: "Where does the oracle live?" → Selected: "analytics-service script or test module with its own arithmetic" (reversible technical — decided autonomously: a file that is cheap to move)
[auto] [DBOOK-02] — Q: "Does the structural shape read instrument_name or the reason text?" → Selected: "either, capital denylist keeps precedence" (reversible technical — decided autonomously: one pure function)
[auto] [PROOF-01] — Q: "How is each gate shown RED?" → Selected: "neuter, RED, cp restore, cmp, GREEN, verbatim in SUMMARY" (reversible technical — decided autonomously: the milestone rule)
