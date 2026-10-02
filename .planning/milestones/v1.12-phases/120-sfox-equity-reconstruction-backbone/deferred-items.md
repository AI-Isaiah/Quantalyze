# Phase 120 — Deferred / Evidence-Gated Residuals

Phase 120 is CODE-COMPLETE and FAIL-LOUD everywhere ambiguous (no invented data). The red team
(Fable, 2026-07-19) surfaced defects; F1/F2/F6/F3/F4/F7 were FIXED. The following genuinely need
real sFOX-account evidence or an architectural decision — they are NOT code bugs to guess at, they
gate PRODUCTION READINESS / the SFOX-06 founder ground-truth run.

## Blockers on the SFOX-06 founder live ground-truth run (real-account evidence)

- **F3 — sFOX `charge`/`credit` transaction economics (fee vs external flow vs rotation).** Undeterminable
  from a transaction row alone. Current behavior: FAIL LOUD (deribit-`correction` precedent) — a real
  sFOX account carrying a `charge`/`credit` txn CANNOT ingest until the founder confirms the economics.
  This is the SAFE no-invented-data outcome (never a wrong displayed return), but it means the ingest
  gate is conservative. Founder: confirm from a real account ledger + sFOX docs what charge/credit mean,
  then classify (like [[project_deribit_correction_txn_type_unhandled]] / Phase 124).
- **A2 — is transactions' running `account_balance` economically INDEPENDENT of balance-history `usd_value`?**
  If they are the same underlying total-MTM number, the P115 parity oracle is weaker than intended. The
  ground-truth harness surfaces this as `requires_founder_decision`. Resolve from the live run.
- **A3 — the day-0 inception convention** for `chain_linked_twr` on a directly-supplied NAV. WR-01 fixed
  the spurious-anchor bug (inception-day flow dropped, honest 0.0 anchor), but the exact convention is
  worth a founder eyeball on the first live curve (it changes a displayed number).
- **F8 — day-attribution (bucket-end vs real-time timestamps).** If sFOX balance-history timestamps mark
  bucket END (next-UTC-midnight), the NAV series shifts one day vs transaction flows → each flow
  subtracted from the wrong day's move. Code is internally UTC-consistent; only the live run resolves it.

## Architectural — overlaps Phase 123 (FLIPRETRY)

- **F5 — the transactions crawl deterministically times out for ACTIVE accounts.** `SfoxClient` enforces
  1 req/10s on `/v1/account/transactions`; the worker wraps the crawl in `asyncio.wait_for(300s)`, so
  >~30 pages (~30k rows incl. buy/sell) ALWAYS hits TimeoutError → transient retry → failed. The
  `asyncio.wait_for` bound PREVENTS the worker WEDGE (the v1.11 FLIP lesson — recovers cleanly), but an
  active algo account (the product's target user) can't be crawled inline on the sequential worker.
  **This is the same class FLIPRETRY-02 solves: the derived-equity backfill belongs on a BATCHED /
  off-hours worker, not the sequential prod worker's loop.** Fold the sFOX reconstruction crawl into
  the Phase-123 batched-worker architecture (and/or transactions-cursor incremental sync so a resync
  isn't a full re-crawl). Until then sFOX reconstruction is viable for SMALL accounts only.

## Not blocking (accepted)

- **F4/api_verified stamp is provenance, not a validation claim.** `api_verified` at process_key.py:835
  means "from a live API, not a fabricatable CSV" (the Phase-111 tier) — TRUE for any connected sFOX key.
  It is NOT a claim the numbers passed ground-truth parity; that is the SFOX-06 founder run. With F2/F3/F6
  fixed, a DISPLAYED sfox curve is now correct-or-gated (fail-loud on anything ambiguous), so the stamp
  is not misleading. The parity gate (F4-fixed) now actually validates the reconstruction when run.
- **IN-01** (order-dependent EOD selection) — LOW, left as-is.
