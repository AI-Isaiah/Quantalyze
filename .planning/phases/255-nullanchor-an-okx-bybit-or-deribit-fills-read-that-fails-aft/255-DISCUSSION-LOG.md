# Phase 255: NULLANCHOR - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-26
**Phase:** 255-nullanchor
**Areas discussed:** none asked (run by a phase agent that cannot ask; every question classified reversible technical)

---

## Fix direction

| Option | Description | Selected |
|--------|-------------|----------|
| Extend the 253 re-read bound to OKX, Bybit, Deribit | Provisional bound at the seed before the daily store; store held when the bound cannot be recorded. Covers NULL and set columns; independent of cron daily stores. Python only. | ✓ |
| Hold the daily store until the fills read has run | Changes Phase 251 ordering; cron_sync and /fetch-trades still move the daily high-water. | |
| advance_sync_cursor anchor | Cannot lower a set column; NULL column only. | |

**Choice:** decided autonomously (one option wins on every axis; reversible because no migration is needed).

## Decided autonomously

[auto] [Fix direction] — Q: "Extend the 253 bound, hold the daily store, or anchor through advance_sync_cursor?" → Selected: "Extend the 253 bound to OKX, Bybit and Deribit" (reversible technical — decided autonomously: Python only, the SQL table and RPC are venue-agnostic)
[auto] [Database surface] — Q: "Ship a migration to reword the table comments?" → Selected: "No migration" (reversible technical — decided autonomously: nothing persisted changes shape)
[auto] [Failure variants] — Q: "Which failure variants does the gate cover?" → Selected: "429, cancel, plain raise x NULL / set-no-fill column x OKX, Bybit, Deribit (18 arms)" (reversible technical — decided autonomously: test scope)
[auto] [Failure variants] — Q: "Do truncated or partial non-Binance reads join the bound?" → Selected: "Research measures; include if same class, else record and book" (reversible technical — decided autonomously: scope)
[auto] [Seed with no anchor] — Q: "What does the provisional bound hold when the seed is None?" → Selected: "A per-venue reach anchor from the venue docs and existing constants" (reversible technical — decided autonomously: internal constant)
[auto] [Flags] — Q: "Which data_quality_flags does a non-Binance bound failure write?" → Selected: "No new public key; phase2_fill_ingestion_failed only" (reversible technical — decided autonomously: avoids widening anon-readable flags)
[auto] [Code shape] — Q: "How is the gating generalised?" → Selected: "Gate the bound on a ccxt raw fills read; keep Binance-only predicates on Binance" (reversible technical — decided autonomously: internal naming)
[auto] [Tests] — Q: "Where do the gate arms live?" → Selected: "A new parametrised pytest module modelled on the 253 harnesses" (reversible technical — decided autonomously: test files only)
[auto] [Residual pointer] — Q: "What happens to [253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]?" → Selected: "Not fixed; scope text widened in the ship PR" (reversible technical — decided autonomously: ledger edit)
