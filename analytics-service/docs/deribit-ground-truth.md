# Deribit Ground-Truth Answers (DRB-01)

**Provenance:** To be recorded from a live read-only LTP Deribit key via
`scripts/deribit_ground_truth.py`, run on the Railway worker (Amsterdam egress).
The live capture run is Plan 67-03; until it lands, every answer below is
`PENDING LIVE RUN`:

```
railway ssh "cd /app && python -m scripts.deribit_ground_truth"
```

Phases 68 (DRB-02 boundary) and 70 (DRB-04..07 dailies/funding) design against
this file. It is TRACKED in-repo (not the gitignored `.planning/` ledger) because
those phases depend on the recorded answers. Every answer is backed by a raw,
sanitized evidence excerpt captured by the harness — assertions without an
evidence excerpt are not acceptable (RESEARCH Pitfall 1). All evidence is passed
through `sanitize_evidence` + `assert_sanitized` before commit: no key material,
account identifiers masked (`***<last4>`), secret/token keys stripped.

Sanitized raw JSON artifacts live alongside in `docs/evidence/`.

---

## Funding-netting shape

THE phase question: is Deribit funding netted into realized PnL, or does it
appear as separate transaction-log rows? Deribit exposes no `fetchFundingHistory`
in ccxt — funding/settlement lives ONLY in `private/get_transaction_log`. The
answer falls out of whether a `settlement`/`delivery`/`funding`-typed row carries
funding distinctly from `trade` rows.

**Answer:** _(to be recorded)_

**Evidence:** distinct transaction-log `type` values with counts + one
whitelisted sample row per type (from `per_currency[*].txn_log_type_summary`).

```json
// PENDING LIVE RUN (Plan 67-03) — paste sanitized txn_log_type_summary excerpt here
```

**Status: PENDING LIVE RUN (Plan 67-03)**

---

## Instrument mix (inverse / linear / options)

Per-kind trade counts for the LTP account, classified by `instrument_name`
(`classify_instrument`): `inverse_perpetual`, `linear_perpetual`, `option`,
`future`. Drives Phase 70 (DRB-05/06) inverse-vs-linear P&L handling.

**Answer:** _(to be recorded)_

**Evidence:** `instrument_mix.counts` tally + sampled instruments per kind.

```json
// PENDING LIVE RUN (Plan 67-03) — paste sanitized instrument_mix excerpt here
```

**Status: PENDING LIVE RUN (Plan 67-03)**

---

## Geo-block body marker

The block-body substring for `services/geo_block.py` `_GEO_BLOCK_MARKERS`, OR
the honest record that no block is observable from the current Amsterdam egress.
Locked decision: do NOT fabricate a marker — record only what the worker sees.
The `#415` classifier is the fail-safe; a marker is added to `geo_block.py` only
if a real block body is observed (Plan 67-03, not this plan).

**Answer:** _(to be recorded)_

**Evidence:** `geo_block_observation` from the run (expected: `blocked: false`
from Amsterdam egress).

```json
// PENDING LIVE RUN (Plan 67-03) — paste sanitized geo_block_observation excerpt here
```

**Status: PENDING LIVE RUN (Plan 67-03)**

---

## Bonus observations (non-blocking)

- **LTP account structure (Phase 72):** whether the read-only key sees any
  subaccounts (distinct login vs subaccount of one main). Count-only, masked;
  resolving all 3 LTP accounts is out of scope for Phase 67.

  ```json
  // PENDING LIVE RUN (Plan 67-03) — paste sanitized subaccounts_observation excerpt here
  ```

- **Per-currency trade counts (Phase 70 pagination verification):** recorded
  per settlement currency (`per_currency[*].trade_count`, `trade_pages_used`,
  `trade_max_pages_hit`). Phase 70 verifies pagination completeness against the
  known totals **18,778 / 21,014 / 61,248**.

  ```json
  // PENDING LIVE RUN (Plan 67-03) — paste sanitized per_currency counts excerpt here
  ```

---

## Run metadata

Captured in `run_meta`: UTC timestamp, ccxt version, egress country (via ipinfo),
and the harness args (`start_ms` / `end_ms` / `max_pages` / `count`).

```json
// PENDING LIVE RUN (Plan 67-03) — paste sanitized run_meta excerpt here
```
