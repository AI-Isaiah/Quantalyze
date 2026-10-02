# Phase 160 — B-M1 PROD census (RANK-03 / RANK-04 provenance gate)

**Artifact:** `160-CENSUS.md` (D-01 / B-D1 decision gate)
**Authored:** 2026-08-23 (scaffold, plan 160-01 Task 1)
**Executed against PROD:** 2026-08-23 (plan 160-01 Task 2, orchestrator, read-only)
**PROD project ref (confirmed at execution):** `khslejtfbuezsmvmtsdn` — confirmed ACTIVE_HEALTHY in the project list before the first query ran — the expected ref is `khslejtfbuezsmvmtsdn` (name `quantalyze`), confirmed against the project list **before any query runs**; the TEST ref `qmnijlgmdhviwzwfyzlc` (`quantalyze-test`) is NOT used. If only TEST is reachable, HALT and surface — never substitute TEST numbers for a census that gates PROD money-math.

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

**Q1 returned ZERO ROWS.** There is no un-attested `api_keys` population since the
2026-08-11 cutoff — the split by exchange × linkage × wizard carriage is empty because the
filtered set itself is empty.

| exchange | unattested | linked_single | linked_composite | wizard_carriage |
| --- | --- | --- | --- | --- |
| _(no rows)_ | 0 | 0 | 0 | 0 |

**Anti-vacuity control (added at Task 2 — an empty result must be a MEASURED zero, not an
empty table).** A separate read-only control query over the whole table:

| total_rows | attested_null | attested_set | since_cutoff | attested_matches_exchange | oldest_row | newest_row |
| --- | --- | --- | --- | --- | --- | --- |
| 31 | 0 | 31 | 2 | 31 | 2026-04-05 | 2026-08-21 |

The table holds 31 rows spanning 2026-04-05 → 2026-08-21; **all 31 carry a non-NULL
`attested_venue`, and all 31 satisfy `attested_venue = exchange`**. Q1's emptiness is
therefore a real measurement of a real population, not a query that matched nothing because
nothing exists.

**The two post-cutoff rows, characterised** (both are attested — the interesting finding):

| api_key_id | exchange | attested_venue | created_on | linked_single | linked_composite | wizard_carriage |
| --- | --- | --- | --- | --- | --- | --- |
| fe3057e5-e284-4b8f-92f1-2d1a6a9a7bfc | mt5 | mt5 | 2026-08-13 | true | false | true |
| 136ad336-c145-4c52-9130-7409e40f1540 | mt5 | mt5 | 2026-08-21 | true | false | true |

Both are MT5 and both arrived attested. ⚠️ **This does NOT mean the hole is closed** — see
the grant evidence below. It means no key has been minted through the browser-INSERT path
since the backfill; the MT5 flow derives its venue server-side already
(`create-with-key:1089`, the explicit non-change). The trigger has had nothing to scrub.

**Grant evidence — the hole is open (read-only `information_schema` probe, added at Task 2).**
The census would be misread as "nothing to fix" without this:

| grantee | privileges held on `public.api_keys` |
| --- | --- |
| anon | DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE |
| authenticated | DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE |

`INSERT` is still held by the browser roles. The phase's writer + REVOKE arc is measuring an
**open** hole with **zero accumulated contamination** — the best possible time to close it.

> ⚠️ **Out-of-scope adjacency, recorded not acted on:** `anon` and `authenticated` also hold
> **TRUNCATE**, which bypasses RLS entirely (RLS filters rows; TRUNCATE does not consult it).
> This is almost certainly Supabase's default public-schema `GRANT ALL` and is NOT part of
> RANK-03/RANK-04. It is logged to `TODOS.md` rather than widened into this phase.

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

| count |
| --- |
| 0 |

Zero, as post-verify (a) of `20260811210000` predicted. The dated backfill boundary still
describes PROD accurately: nothing older than the cutoff was left un-attested.

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

**Q2 returned ZERO ROWS.** No strategy is linked to an un-attested key, so no strategy
can carry a stamp that disagrees with its venue-derived expectation.

| strategy_id | api_key_id | exchange | stamped | venue_derived | wizard_carriage | status |
| --- | --- | --- | --- | --- | --- | --- |
| _(no rows)_ | | | | | | |

This follows necessarily from the control above: the candidate predicate is
`attested_venue IS NULL`, and `attested_null = 0` across the entire table — so the JOIN has
no left side, for any linkage. **There are zero `stamped <> venue_derived` rows because
there are zero un-attested keys**, not because the comparison was skipped.

Per-exchange shape of the full (fully-attested) population, for reference:

| exchange | rows_total | unattested |
| --- | --- | --- |
| bybit | 5 | 0 |
| deribit | 13 | 0 |
| mt5 | 4 | 0 |
| okx | 9 | 0 |

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

> **zero candidates — plan 160-06 is a recorded no-op.**
>
> Applied mechanically to the numbers measured above: the candidate list is exactly the Q2
> rows where `stamped <> venue_derived`; Q2 returned zero rows (necessarily — `attested_null`
> is 0 across all 31 rows). No strategy needs re-annualization; no blanket backfill is
> licensed by this result.
>
> Per threshold clause (a), **the writer + REVOKE arc (B-1..B-3) proceeds regardless** — and
> the grant probe above confirms `anon`/`authenticated` still hold `INSERT`, so the hole this
> phase closes is open right now. Scope is the FULL B-1..B-4 cut, not the minimal
> B-4-alone-with-null-guard cut: there is no accumulated contamination to constrain it, and
> the null-attestation guard (D-07) still ships because a NULL attestation remains
> *reachable* (the scrub trigger is live and the browser grant is open until PR-2 lands).

---

## Pins for the PR-2 guard (D-03)

The `REVOKE INSERT` migration (plan 160-05) re-runs this census in a `DO` block and aborts on
drift, copying the `20260811210000` §5 shape: hand-typed `CONSTANT` literals, a two-sided
PROD-signature discriminator so a PROD apply can never silently take the lenient branch, and
an abort message that reports the pin it actually used (one declaration, three uses).

**Fill these by hand at Task 2 — a count compared against its own derivation cannot fail.**

| Pin | Source | Value (hand-typed at Task 2) | Teeth |
| --- | --- | --- | --- |
| `c_pin_unattested` — un-attested rows since the 2026-08-11 cutoff | Q1, sum of the `unattested` column | **0** | **ENFORCED** — this is the population whose drift changes the B-D1 decision |
| `c_pin_unattested_pre` — pre-cutoff residual | Q1b | **0** | **ENFORCED** — a non-zero residual that moves means the backfill's dated boundary no longer describes PROD |
| `c_pin_exchanges` — per-exchange split | Q1, one literal per exchange row | **(empty set — Q1 returned no rows; the guard asserts the un-attested split is empty, not a list of literals)** | **ENFORCED** — re-cut TOGETHER with `c_pin_unattested`; the two must move as one |
| `c_pin_total` — TOTAL `api_keys` row count | interpretive, counts only | 31 (2026-08-23) | **REPORTED, NEVER ENFORCED** |

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

## Pre-REVOKE re-measure addendum (plan 160-05 Task 1)

**Measured:** 2026-08-23 17:59 UTC, read-only against PROD `khslejtfbuezsmvmtsdn`.
**Purpose:** the same-day re-measure the PR-2 migration's guard constants are cut from, taken
AFTER PR-1 deployed and soaked — so the one-way door is guarded by a number that describes
the database at the moment it is opened, not one from before the writer existed.

### Deploy provenance (the soak this addendum closes)

| Fact | Value |
| --- | --- |
| PR-1 | #703, merged as `1911a5d5` (v0.71.0.0) |
| Vercel deployment | `dpl_2TjqCXPdM4B85fn4wUHZLC9PxP52`, target `production`, state `READY` |
| Aliases held | `quantalyze.xyz`, `quantalyze-rho.vercel.app` (+ project/branch aliases), `aliasError: null` |
| Deploy ready at | 2026-08-23 **17:12:02 UTC** |
| Soak elapsed before this measurement | **47 minutes** |

Alias binding was read from the Vercel deployment API, not inferred from "newest production
deployment"; the live domain was independently confirmed serving HTTP 200.

### Re-measured population

| Measure | Value | vs original census |
| --- | --- | --- |
| Total `api_keys` rows | 31 | unchanged (`c_pin_total` = 31) |
| **Un-attested, created before the 2026-08-23 cutoff — the ENFORCED pin** | **0** | unchanged (`c_pin_unattested` = 0) |
| Un-attested in the soak window (REPORTED, never enforced) | 0 | — |
| Rows created since the deploy went live | 0 | — |
| PROD signature rows (mt5 on the three pinned dates) | 4 | unchanged (`c_pin_dates`) |
| Rows satisfying `attested_venue = exchange` | 31 / 31 | unchanged |
| Newest row | 2026-08-21 | unchanged |

### Decision

> **No re-cut required.** Every guard constant in
> `supabase/migrations/20260823120000_revoke_api_keys_insert.sql` — `c_pin_unattested = 0`,
> `c_pin_total = 31`, `c_pin_dates` — still matches PROD exactly. The strict (PROD-signature)
> branch will engage on apply, and the enforced comparison will pass on the measured value
> rather than on a softened one.

### ⚠️ Honest limit of this soak

Zero keys were connected on PROD during the soak window, so the window produced **no positive
evidence that the persist arm works in production** — it produced only the absence of
un-attested inflow. Those are different claims, and the weaker one is what was actually
measured. The stale-tab risk this soak targets is correspondingly low (PROD took 2 new keys in
the preceding 12 days), and the migration's own guards do not depend on this window: the
enforced pin is bounded to the pre-cutoff population precisely so soak-window rows cannot
abort it. Recorded here rather than presented as a successful exercise of the new writer.

---

*Phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes*
*Plan: 160-01 (scaffold Task 1; PROD results Task 2 — orchestrator-executed, Supabase MCP is stripped from subagents)*
*Addendum: plan 160-05 Task 1 (pre-REVOKE re-measure, post-soak)*
