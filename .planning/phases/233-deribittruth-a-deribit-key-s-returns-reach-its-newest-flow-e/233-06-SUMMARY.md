---
phase: 233-deribittruth-a-deribit-key-s-returns-reach-its-newest-flow-e
plan: 06
subsystem: analytics
tags: [deribit, fresh-01, fresh-02, prod-reading, freshness]
requires:
  - phase: 233-02
    provides: the freshness prober arm
  - phase: 233-04
    provides: the freshness arm's day-by-day and boundary rules
provides:
  - the 2026-11-26 PROD confirmation reading for FRESH-01 (CONFIRMED)
  - A5 proven by a narrowed prober run of the freshness arm against PROD
affects: [.planning/debug/deribit-stale-returns.md, Phase 234 (book B's out_of_window_flow)]
key-files:
  created: []
  modified:
    - .planning/debug/deribit-stale-returns.md
key-decisions:
  - "Step 6 used a narrowed prober dispatch on the pushed ship ref (plan step 6 allows it), so A5 is proven by the prober's own session, not by an MCP read."
  - "Book B still carries out_of_window_flow after the compose. Recorded and handed to Phase 234; it does not reopen FRESH-01 (CONTEXT Q2)."
metrics:
  duration: "not measured (date-gated wait for the 2026-11-26 derive)"
  completed: 2026-11-26
status: complete
---

# Phase 233 Plan 06: the 2026-11-26 PROD confirmation reading Summary

The orchestrator read PROD through the Supabase MCP path on 2026-11-26 between 01:15Z and 02:12Z, one statement per call, marker query first. Every statement was a SELECT, and nothing was written or backfilled. Keys and books are lettered here. D1, D2 and D3 are the three logins of the one account whose stored returns had ended on 2026-10-26. D4 is a key of a sibling Deribit account, used as the control. Books A, B and C are the three books that hold D1 to D3 (`allocator_holdings`). The letter-to-id mapping is held privately and is not in the repo.

The nightly derive fired at 00:40Z. The three logins' jobs finished at 01:10Z, 01:22Z and 01:34Z, and the books composed at 01:37Z.

## Reading

fresh01-marker: names PRODUCTION
fresh01-rows: D1 row_2026-11-25=present gap_rows=0 newest=2026-11-25
fresh01-rows: D2 row_2026-11-25=present gap_rows=0 newest=2026-11-25
fresh01-rows: D3 row_2026-11-25=present gap_rows=0 newest=2026-11-25
fresh01-control: D4 newest=2026-11-25
fresh01-derive: D1 created=2026-11-26 status=done attempts=1 last_error=null
fresh01-derive: D2 created=2026-11-26 status=done attempts=1 last_error=null
fresh01-derive: D3 created=2026-11-26 status=done attempts=1 last_error=null
fresh01-inputs: D1 terminal=2026-11-25 tiny_gap_listed=yes tiny_lists_2026-11-25=no dropped_gap_listed=yes flow_2026-11-09=unchanged
fresh01-inputs: D2 terminal=2026-11-25 tiny_gap_listed=yes tiny_lists_2026-11-25=no dropped_gap_listed=yes flow_2026-11-09=unchanged
fresh01-inputs: D3 terminal=2026-11-25 tiny_gap_listed=yes tiny_lists_2026-11-25=no dropped_gap_listed=yes flow_2026-11-09=unchanged
fresh01-books: A computed_after_derive=yes out_of_window_flow=absent is_trustworthy=true
fresh01-books: B computed_after_derive=yes out_of_window_flow=present is_trustworthy=false
fresh01-books: C computed_after_derive=yes out_of_window_flow=absent is_trustworthy=true
fresh01-arm: uncovered_keys=0 source=prober-run
fresh02-a5: proven source=prober-run run=45736879079 derived=25 with_inputs=25 with_terminal=24
fresh01-verdict: CONFIRMED

## Notes on the reading

- **flow_2026-11-09=unchanged.** On every login, `key_inputs.flows` still holds exactly one flow dated 2026-11-09 and no flow after it, so no new deposit landed before the reading. The amount was not compared, because tracked text carries no amounts.
- **Books.** Before the derive, A and B read `out_of_window_flow` with `is_trustworthy=false`. After the 01:37Z compose, A reads `classified_rotation, window_truncated` and is trustworthy. B still reads `classified_rotation, out_of_window_flow, window_truncated` and is not trustworthy. C read benign reasons before and after. **B's remaining `out_of_window_flow` goes to Phase 234 and must be told to the founder**, because the CONTEXT Q2 ruling assumed it would clear. As the plan says, it does not reopen FRESH-01.
- **The prober run.** It was a narrowed `prod-prober.yml` dispatch (`mode=probe`, `arm=freshness`) on the pushed ship ref `gsd/phase-233-deribittruth-pr` at `b0b5b8b3`. It exited 2 by design, because a narrowed run never returns success, and it filed no issue. Its log printed:
  - `freshness: scope derived=25 with_inputs=25 with_terminal=24`
  - `freshness: judged=20 fresh=20 covered_stated=0 covered_anchor=5 no_inputs=0 no_returns=0 no_reference=0 stale=0 venues bybit=1 deribit=8 mt5=11 okx=5`
  - `No defects in the narrowed scope.`

  The run had no `measure-fail`, no `freshness-no-scope` and no `freshness-stale`.
- **The D3 login** already showed its 2026-11-25 row at the first read (01:15Z). D1 and D2 were then still running and pending. Both were re-read after their jobs were `done`.
