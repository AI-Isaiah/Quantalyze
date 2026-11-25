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
