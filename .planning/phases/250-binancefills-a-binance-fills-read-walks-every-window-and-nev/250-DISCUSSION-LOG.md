# Phase 250: BINANCEFILLS - Discussion Log

> Audit trail only. Decisions are captured in 250-CONTEXT.md.

**Date:** 2026-11-25
**Phase:** 250-binancefills
**Mode:** smart discuss (autonomous, run by a phase agent that cannot ask the founder)
**Areas analyzed:** window walk (R2-02), unlisted symbols (R2-01), page cap stop, budget, write scope, SC-4 record, tests

No question met the hard-to-reverse or preference class (no migration, no schema, no public contract, no new dependency; the sync path is dormant in PROD). All were decided autonomously.

## Decided autonomously

[auto] [Window walk] — Q: "Shape of the fix?" → Selected: "explicit until on every request, windows of at most 7 days from seed to now, oldest-first paging per window" (reversible technical — code inside _fetch_raw_trades_binance)
[auto] [Window walk] — Q: "Seed when since_ms is None?" → Selected: "walk from the venue reach, never a startTime-less request" (reversible technical — one branch)
[auto] [Window walk] — Q: "Seed older than the 3-month reach?" → Selected: "clamp to reach, named non-holding flag" (reversible technical — constant and flag key)
[auto] [Window walk] — Q: "SC-1 on a fully empty tail?" → Selected: "keep the 232 stored-fill stamp rule; every run walks C to now" (reversible technical — reading recorded)
[auto] [Unlisted symbols] — Q: "Healthy symbols advance while a dead symbol is named?" → Selected: "BadSymbol named in a new non-holding flag; other failures keep the binance_partial_symbols hold" (reversible technical — classification in the gather loop)
[auto] [Unlisted symbols] — Q: "Is BadSymbol the same as nothing to read?" → Selected: "no; research measures the symbol map at ccxt 4.5.89 and the map is fixed here if it misroutes" (reversible technical — local dict build)
[auto] [Page cap] — Q: "Flag and resume?" → Selected: "cap per window, stays 20; named non-holding flag; gate stamps min(newest persisted fill, capped symbols' newest read fill)" (reversible technical — gate arithmetic)
[auto] [Page cap] — Q: "Holds versus the cap stamp?" → Selected: "every existing hold still wins" (reversible technical)
[auto] [Budget] — Q: "Can the walk exceed the handler budget?" → Selected: "research bounds it against 900 s sync and 5 min reconcile; a deadline stop behaves like the cap stop if needed" (reversible technical)
[auto] [Write scope] — Q: "Which symbols may plans edit?" → Selected: "_fetch_raw_trades_binance plus constants; run_sync_trades_job cursor gate block only; _RAW_TRADE_INGESTION_ENABLED comment" (reversible technical)
[auto] [SC-4] — Q: "Where is the precondition recorded?" → Selected: "flag declaration comment and CHANGELOG" (reversible technical)
[auto] [Tests] — Q: "How are gates made able to fail?" → Selected: "fake fetch_my_trades models the venue's 7-day and 1000-row limits" (reversible technical — tests only)

## Deferred Ideas

- Read-through cursor stamp on an empty tail (founder decision if wanted).
- Per-symbol persisted cursors (migration).
- Clearing resolved flags from data_quality_flags (Phase 251 class).

## Open founder decision (recorded 2026-11-25, plan-phase revision iteration 1)

The plan checker (iteration 1: 0 blockers, 3 warnings) flagged that a deadline-stopped read does not let the cursor advance across a quiet prefix. Its property accepted either "the cursor advances on repeated runs" OR "the inability is a recorded known limit". The orchestrator's revision note ruled out the known-limit route, reading the goal ("its cursor never stalls") as forbidding it. The planner then returned REVISION_CONFLICT:

- Mechanism: a deadline-stopped run whose covered prefix holds no stored fill after C cannot stamp (Phase 232 rule: stamp a stored fill only), and the next seed is min(cursor, newest stored fill) - 1 h (Phase 232 VREAD-08 seed rule), so run N+1 re-covers the same prefix. Ordering and deadline size only move where the common frontier sits. CONTEXT's empty-tail decision ("every run walks C to now") is false under a deadline and needs correcting with the answer.
- Region (DERIVED, not measured: the 229 ms per weight-5 request throttle was measured without network latency; the venue's out-of-reach behaviour is unmeasured; the "3 months" doc line was read through a summarising fetch; PROD held 0 Binance keys on 2026-11-25): a 240 s run makes about 1,048 requests. Up to about 80 symbols a cold 85-day walk finishes in one run. At 100 symbols one run covers about 70 days, at 150 about 49, at 300 about 21. A stall needs a strategy-wide quiet stretch longer than that. It is loud (`binance_deadline_symbols` every run), and the delay is bounded by the reach clamp, so a fill lands within roughly the uncovered tail (derived).
- Alternatives:
  - (A) Record the limit as known. SC-1 is NOT met in that region, and the SC-4 precondition comment at the flag declaration must name the exception.
  - (B) A read-through stamp for a cleanly walked deadline frontier. This relaxes TWO Phase 232 rules (stored-fill stamp and the VREAD-08 seed); CONTEXT already names it a founder decision.
  - (C) A persisted per-symbol cursor or read-frontier column. Needs a migration.
  - (D) fromId paging to jump a quiet stretch. Contradicts the explicit-endTime decision; the venue forbids fromId with startTime or endTime.
- Rider for any option: a per-caller deadline. The sync path gets about 840 s of its 900 s; reconcile keeps 240 s, and its request count does not grow with the walk. The call-site edit at `fetch_raw_trades` in `run_sync_trades_job` sits outside Phase 222's hunks. Only this phase's own CONTEXT write-scope fence excluded it, and that fence is reversible. This shrinks the region about 3.5x (derived) but does not close it.
- 250-07's Task 1 precondition greps the token for that decision in 250-CONTEXT.md. The token is deliberately NOT written to CONTEXT until the founder answers. The answer goes in CONTEXT.md and in the ROADMAP Phase 250 section.
- Resume point: plan-phase step 12 (revision loop) at iteration 1 with one conflict returned. Apply the answer to CONTEXT and to 250-07, run the checker on all 7 plans, then do steps 13 to 13e. A plain plan-phase re-entry hits the existing-plans prompt instead. Stale until then: 250-VALIDATION.md (quick-run command and per-task map predate the re-slice) and the ROADMAP "0 plans" stub.
