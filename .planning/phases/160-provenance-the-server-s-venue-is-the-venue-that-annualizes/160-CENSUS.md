# Phase 160 — B-M1 PROD census (RANK-03 / RANK-04 provenance gate)

**Artifact:** `160-CENSUS.md` (D-01 / B-D1 decision gate)
**Authored:** 2026-08-23 (scaffold, plan 160-01 Task 1)
**Executed against PROD:** _(blank until plan 160-01 Task 2 — orchestrator, read-only)_
**PROD project ref (confirmed at execution):** _(to be recorded at Task 2)_ — the expected ref is `khslejtfbuezsmvmtsdn` (name `quantalyze`), confirmed against the project list **before any query runs**; the TEST ref `qmnijlgmdhviwzwfyzlc` (`quantalyze-test`) is NOT used. If only TEST is reachable, HALT and surface — never substitute TEST numbers for a census that gates PROD money-math.

## Purpose

This file is the decided gate for the phase-160 provenance work. Per D-01
(160-CONTEXT.md §B-M1 census & B-D1 scope gating), it must exist **as a committed artifact
with real PROD numbers before** the RANK-04 `asset_class` stamp swap (plan 160-04) or any
writer / `REVOKE INSERT` code lands. It records:

- the **un-attested `api_keys` population since the `20260811210000` cutoff** (Q1), split by
  exchange × strategy linkage (single AND composite) × `wizard_session_id` carriage — the
  population the scrub trigger has been minting on every client INSERT since 2026-08-11;
- the **pre-cutoff residual** (Q1b) — rows the dated backfill did not reach (it is bounded by
  `SET LOCAL quantalyze.attest_backfill_cutoff = '2026-08-11 00:00:00+00'`, explicitly not a
  fill-forever rule);
- the **golden-parity candidate list** (Q2) — per-strategy `stamped` vs `venue_derived`, keyed
  on strategy/key ids only;
- **hand-typed pins** in the `20260811210000` count-pinned discipline, which the PR-2 `REVOKE`
  migration re-runs and aborts on drift (D-03);
- the **B-D1 decision**, applied mechanically from the threshold documented below (D-02).

## Rule of this file: no PII, ever

**This repository is PUBLIC and `.planning/` is tracked — everything pasted below is
world-readable on push.** The census therefore carries **counts, dates, and strategy/key
ids ONLY**. Never an email address, never an auth uid, never a user name, never a
credential, never a project URL. Strategy ids are non-secret per SHARE-01; nothing else
about a user is. Before pasting any result table, strip every email- or uid-shaped value
and every column not named in the query's own output list.

**All three queries below are read-only `SELECT`s.** No statement in this file mutates
PROD. The orchestrator executes exactly the blocks on this page — nothing improvised.

---

## Query 1 / Q1b — the un-attested population since the 20260811210000 cutoff

Copied verbatim from `160-RESEARCH.md` §Code Examples.

**Linkage is measured with `EXISTS`, never a JOIN** (Pitfall 9a): a key can be BOTH a
composite member and a single-strategy link, and joining `strategies` + `strategy_keys`
would double-count it. The three `FILTER (WHERE EXISTS …)` arms each count keys, not pairs.

**Assumption A4 (160-RESEARCH.md:422) — read before running:** the composite arm assumes
`strategy_keys.api_key_id` is the linkage column (observed in the `queries.ts:619`
projection). If that column name is wrong the query **errors loudly** at execution. Fix it
from the LIVE schema and record the correction here — never by guessing a plausible name.

```sql
-- 160-CENSUS Q1 — un-attested api_keys since the 20260811210000 cutoff,
-- split by exchange × strategy linkage × wizard_session_id carriage.
-- READ-ONLY. EXISTS (not JOIN) to avoid fan-out double counting.
SELECT
  k.exchange,
  count(*)                                                          AS unattested,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM strategies s WHERE s.api_key_id = k.id))          AS linked_single,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM strategy_keys sk WHERE sk.api_key_id = k.id))     AS linked_composite,
  count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM strategies s
     WHERE s.api_key_id = k.id AND s.wizard_session_id IS NOT NULL)) AS wizard_carriage
FROM api_keys k
WHERE k.attested_venue IS NULL
  AND k.created_at >= TIMESTAMPTZ '2026-08-11 00:00:00+00'
GROUP BY 1 ORDER BY 1;
```

### Results — Q1

RESULTS: PENDING

---

### Q1b — the pre-cutoff residual

Copied verbatim from `160-RESEARCH.md` §Code Examples (same fenced block as Q1; split here
so each query carries its own results section).

```sql
-- Q1b — the pre-cutoff residual (should be 0 by post-verify (a); measure anyway):
SELECT count(*) FROM api_keys
 WHERE attested_venue IS NULL
   AND created_at < TIMESTAMPTZ '2026-08-11 00:00:00+00';
```

### Results — Q1b

RESULTS: PENDING

---

## Query 2 — affected strategies (the golden-parity candidate list)

Copied verbatim from `160-RESEARCH.md` §Code Examples.

The `CASE` list mirrors `CRYPTO_EXCHANGES = ["binance", "okx", "bybit", "deribit", "sfox"]`
(`src/lib/closed-sets.ts:553-559`) — `mt5` is deliberately excluded and therefore derives
`traditional` (√252). This query joins `strategies` deliberately: its unit of output is the
**strategy row**, not the key, so there is no fan-out to avoid — Pitfall 9a governs Q1's
per-key counts only.

```sql
-- Strategies linked to un-attested keys: current stamp vs the venue-derived
-- expectation. asset_class_expected mirrors CRYPTO_EXCHANGES
-- ('binance','okx','bybit','deribit','sfox') = closed-sets.ts:553-559.
SELECT
  s.id                                             AS strategy_id,
  k.id                                             AS api_key_id,
  k.exchange,
  s.asset_class                                    AS stamped,
  CASE WHEN k.exchange IN ('binance','okx','bybit','deribit','sfox')
       THEN 'crypto' ELSE 'traditional' END        AS venue_derived,
  s.wizard_session_id IS NOT NULL                  AS wizard_carriage,
  s.status
FROM api_keys k
JOIN strategies s ON s.api_key_id = k.id
WHERE k.attested_venue IS NULL
ORDER BY k.exchange, s.id;
-- A row where stamped <> venue_derived is a re-annualization candidate
-- (golden-parity treatment, per-strategy, no blanket backfill).
```

### Results — Q2

RESULTS: PENDING

---

## The B-D1 threshold (mechanical — D-02)

**(a) The writer + REVOKE arc (B-1..B-3) proceeds REGARDLESS of what this census finds.**
It is locked in `160-CONTEXT.md`, and the census cannot veto it: until the `REVOKE` lands,
the browser keeps holding `INSERT` on `api_keys` and every client-minted row keeps being
scrubbed to `attested_venue = NULL`. An ongoing un-attested inflow makes the full
B-1..B-3 arc the only correct cut, whatever today's count happens to be. Nothing measured
below can turn the writer or the revoke into a no-op.

**(b) What this census DOES decide, mechanically, is the golden-parity population.** The
re-annualization candidate list is **exactly the Q2 rows where `stamped <> venue_derived`** —
no wider (D-09: per-strategy golden parity, never a blanket backfill) and no narrower. Zero
such rows means plan `160-06` records a **no-op**, and that recorded no-op is the complete
discharge of the B-D1 obligation. There is **no separate user gate**: the threshold is
written here, and Task 2 applies it to the numbers it measured.

**The decision (filled at Task 2 — never left blank):**

> _(Task 2 writes either the explicit candidate strategy ids from Q2 where
> `stamped <> venue_derived`, or the exact sentence "zero candidates — plan 160-06 is a
> recorded no-op".)_

---

## Pins for the PR-2 guard (D-03)

The `REVOKE INSERT` migration (plan 160-05) re-runs this census in a `DO` block and aborts on
drift, copying the `20260811210000` §5 shape: hand-typed `CONSTANT` literals, a two-sided
PROD-signature discriminator so a PROD apply can never silently take the lenient branch, and
an abort message that reports the pin it actually used (one declaration, three uses).

**Fill these by hand at Task 2 — a count compared against its own derivation cannot fail.**

| Pin | Source | Value (hand-typed at Task 2) | Teeth |
| --- | --- | --- | --- |
| `c_pin_unattested` — un-attested rows since the 2026-08-11 cutoff | Q1, sum of the `unattested` column | _pending_ | **ENFORCED** — this is the population whose drift changes the B-D1 decision |
| `c_pin_unattested_pre` — pre-cutoff residual | Q1b | _pending_ | **ENFORCED** — a non-zero residual that moves means the backfill's dated boundary no longer describes PROD |
| `c_pin_exchanges` — per-exchange split | Q1, one literal per exchange row | _pending_ | **ENFORCED** — re-cut TOGETHER with `c_pin_unattested`; the two must move as one |
| `c_pin_total` — TOTAL `api_keys` row count | interpretive, counts only | _pending_ | **REPORTED, NEVER ENFORCED** |

### Why the total is reported and never enforced

Verbatim discipline from `20260811210000:660-666`: the total was strict-equality once, and
that was a latent outage — `api_keys` is **live and user-mutable**, so ONE key connected or
deleted between the census and the merge would abort the PROD auto-apply of a security fix,
for a number carrying no security value. The delta is surfaced in the apply log so drift stays
VISIBLE without being fatal. Phase 160 copies that split exactly: the un-attested population
carries the teeth; the table's size is a reference point printed as a delta.

### On drift at REVOKE time

Re-measure against PROD and **re-cut the constants together** — the enforced pins move as one
set, in one edit, with the abort message's numbers moving with them. **Never soften the
comparison to make an apply pass.** A guard that was relaxed to go green is a guard that
proves nothing, and the population it was protecting is money-math annualization.

---

*Phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes*
*Plan: 160-01 (scaffold Task 1; PROD results Task 2 — orchestrator-executed, Supabase MCP is stripped from subagents)*
