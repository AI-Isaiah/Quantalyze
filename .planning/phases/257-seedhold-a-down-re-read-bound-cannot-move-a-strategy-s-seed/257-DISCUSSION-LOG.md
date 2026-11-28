# Phase 257: SEEDHOLD - Discussion Log

**Mode:** autonomous smart discuss (`/gsd-autonomous --only 257`), run by a phase agent that cannot ask the founder.
**Date:** 2026-11-27

The founder ruling that booked the phase is quoted from the ROADMAP: "Fix both in a follow-up (Recommended)".

## Pre-discuss re-check of the ROADMAP draft (not founder-reviewed)

Checked against `TODOS.md` `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`, `[255-BYBIT-DEADLINE-NO-PROGRESS]`, `255-RESEARCH.md` and the code at origin/main `da98acd39`. Wording fixed in the ROADMAP before planning:
- Goal bullet 1 prescribed a writer-side fix ("The cron must not move a strategy's seed"); the TODOS entry allows either side. Reworded to the outcome SC-1 tests.
- The trigger is any failed provisional write (`except Exception`), not only an outage or a rollback.
- SC-1 named no column state; Phase 255 measured the residual on a set column with no stored fill and on a first sync, not on a NULL column with a seed. SC-1 now names the states and keeps GREEN arms as pins.
- SC-2's "walk start past the windows it completed" is not what the seed arithmetic gives (seed minus the 1 h overlap). Reworded, and a deadline-inside-the-first-window arm added (the bound must hold, not creep).

## Decided autonomously

All recorded in `257-CONTEXT.md` `### Decided autonomously`: the span's home is left to research against criteria (a) to (e) with an escalation trigger (a new anon-readable flags key, a migration, or cron and `/fetch-trades` holding their store is a founder question); the writer census; measurement first; the Bybit read-through shape; the Bybit stall stays visible; the shared driver changes additively at most; the persist timing margin; the test module; no migration expected.

## Questions for the founder

None at discuss time. The escalation trigger may produce one after research.
