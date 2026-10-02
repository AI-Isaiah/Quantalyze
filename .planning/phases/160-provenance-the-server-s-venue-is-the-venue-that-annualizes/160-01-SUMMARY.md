---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
plan: 01
status: complete
completed: 2026-08-23
requirements: [RANK-03, RANK-04]
---

# Plan 160-01 Summary — B-M1 PROD census

## What was done

Task 1 (executor, worktree): authored the `160-CENSUS.md` scaffold with Q1/Q1b/Q2 copied
byte-for-byte from `160-RESEARCH.md` §Code Examples (verified by md5 — `67d3960b…` on both
sides), the mechanical B-D1 threshold, and the pins-table template. Commit `bf505b67`.

Task 2 (orchestrator checkpoint — Supabase MCP is stripped from subagents): executed the
three blocks read-only against PROD, added two control probes, filled every RESULTS section
and pin, and wrote the B-D1 decision. Commit `11717b55`.

## Confirmed PROD ref

`khslejtfbuezsmvmtsdn` (name `quantalyze`, ACTIVE_HEALTHY) — confirmed against the project
list BEFORE the first query ran. The TEST ref `qmnijlgmdhviwzwfyzlc` was not used.

## Headline counts

| Measure | Value |
| --- | --- |
| Q1 — un-attested rows since the 2026-08-11 cutoff | **0** (query returned no rows) |
| Q1b — pre-cutoff residual | **0** |
| Q2 — golden-parity candidates (`stamped <> venue_derived`) | **0** (query returned no rows) |
| Control — total `api_keys` rows | 31 (2026-04-05 → 2026-08-21) |
| Control — rows with `attested_venue IS NOT NULL` | 31 / 31 |
| Control — rows satisfying `attested_venue = exchange` | 31 / 31 |
| Rows created since the cutoff | 2 (both `mt5`, both attested, both wizard-carried) |

Per-exchange split of the full population: bybit 5, deribit 13, mt5 4, okx 9 — zero
un-attested in every bucket.

## Anti-vacuity

An empty Q1/Q2 could mean "nothing to fix" or "the query matched nothing because the table
is empty". The control probe distinguishes them: 31 real rows spanning four months, all
attested. The zero is **measured**, not vacuous.

## The finding that matters

`anon` and `authenticated` still hold `INSERT` on `public.api_keys` (read-only
`information_schema.role_table_grants` probe). The hole is **open with zero accumulated
contamination** — no key has been minted through the browser-INSERT path since the backfill,
because the only two post-cutoff keys are MT5, whose venue is already derived server-side
(`create-with-key:1089`, the explicit non-change).

## B-D1 outcome

> **zero candidates — plan 160-06 is a recorded no-op.**

Scope is the FULL B-1..B-4 cut (not the minimal B-4-alone cut): threshold clause (a) makes
the writer + REVOKE arc proceed regardless, and the grant probe confirms the hole is live.
The null-attestation guard (D-07) still ships — a NULL attestation stays *reachable* while
the scrub trigger is live and the browser grant is open.

## Out-of-scope adjacency recorded

`anon`/`authenticated` also hold **TRUNCATE** on `api_keys`, which bypasses RLS entirely
(RLS filters rows; TRUNCATE does not consult row policies). Logged to `TODOS.md` §Security
with a class-audit next step; deliberately NOT widened into this phase, whose D-05 decision
withdraws INSERT only.

## Downstream effect

- Plans 160-02 / 160-04 are unblocked (D-01 ordering gate satisfied — census committed first).
- Plan 160-05's guard constants are pinned: `c_pin_unattested = 0`, `c_pin_unattested_pre = 0`,
  `c_pin_exchanges` = empty set, `c_pin_total = 31` (REPORTED, never enforced).
- Plan 160-06 is a recorded no-op with the census line to cite.
