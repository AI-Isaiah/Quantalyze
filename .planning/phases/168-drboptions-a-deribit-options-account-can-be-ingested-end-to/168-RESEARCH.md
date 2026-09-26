# Phase 168: DRBOPTIONS — a Deribit options account ingests end to end - Research

**Researched:** 2026-09-26
**Measured at:** worktree HEAD `096671f2d` (same sha CONTEXT.md was decided at)
**Domain:** Deribit transaction-log type classification (pure Python, `analytics-service/services/deribit_txn.py` + `deribit_ingest.py`)
**Confidence:** HIGH on code structure and batch scope (read this session); MEDIUM on Deribit semantics (current official docs, cited); LOW on the row fields `assignment` carries (no repo evidence can answer it — see Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: `assignment` is classified CASH-BEARING (summed as realized cash) on both twins, and
  only in the shape the census measured.** The evidence is the 2026-09-23 census
  (`delivery=0 settlement=0 trade=1`). When no `delivery` or `settlement` row exists for the
  assigned instrument, the `assignment` row is the only cash event of the expiry. Skipping it would
  silently drop realized cash, and the native balance roll would not close. **Whether n=1 is
  enough: it is enough for THIS shape and no other.** One observation can show what Deribit
  emitted when it emitted no sibling. It cannot show that Deribit never emits both. D-02 therefore
  keeps the unobserved shape refused instead of assuming it. The row's magnitude is never cited
  as justification, in code comments, tests or docs.
  — **Reversibility:** reversible. It is a Python type-set edit with no persisted schema, and
  recompute re-derives the series.

- **D-02: The unobserved shape stays loud (fail-closed co-occurrence guard).** If an `assignment`
  row shares its `instrument_name` with a `delivery` or `settlement` row in the batch being
  classified, ingestion refuses with a `LedgerValuationError`. The message names the
  double-count hypothesis and carries the `describe_unclassified_row` evidence. It must neither
  sum nor skip. **The guard must be sound against the batch's actual scope.** The researcher
  establishes what "this batch" is at each call site: the USD twin runs per currency/scope inside
  `_crawl_deribit_ledger`, and the native twin runs over the full `raw_rows` crawl. If a site's
  batch can be a window that does not cover the instrument's expiry, the guard on that site must
  also refuse, or the classification must be decided on the full-history rows. It must never
  pass silently.
  — **Reversibility:** reversible.

- **D-03: The census is committed as a dated evidence file, counts only.** Add
  `analytics-service/docs/evidence/drb-assignment-census-2026-09.json`, following the repo's
  `docs/evidence/*.json` convention. It holds the type, the currency, the option kind (put), the
  side, and the sibling counts. It holds no job id, correlation id, account, instrument
  strike/expiry string, strategy name or `change` value. The tests and the classification comment
  cite this file, not a ROADMAP paragraph.
  — **Reversibility:** reversible.

- **D-04: Every consumer of the Deribit type vocabulary treats `assignment` consistently.**
  Adding to `CASH_BEARING_TYPES` flows automatically into `_NATIVE_CASH_BEARING_TYPES` and into
  `services/deribit_ingest.py`. The researcher must also enumerate every place that lists option
  event types by name, and the plan must decide each one explicitly. That includes the
  smoothed-MTM option-book replay, which reconstructs positions from `trade`/`delivery` rows (an
  `assignment` with side `close buy` closes a short position); the option-activity gate; and
  `_NATIVE_OPTIONS_SUMMARY_TYPES`. Each disjointness assert at import (the USD pair, the native
  pair, and the options-summary asserts) must still hold. The type-table comment above
  `CASH_BEARING_TYPES` is updated to list `assignment` with its evidence citation. Cite by symbol.
  — **Reversibility:** reversible.

- **D-05: Tests encode why, and each is proven able to fail.**
  `tests/test_deribit_unclassified_evidence.py` currently asserts that `assignment` is NOT
  classified. It is re-pointed, not deleted: the refusal-evidence tests keep a still-unknown
  type, and new tests pin D-01 (the census shape is summed on both twins) and D-02 (the co-occurring
  shape refuses). The fixture reproduces the census shape from D-03 with synthetic identifiers.
  Every new data-integrity assertion goes through neuter → observe RED → restore.
  — **Reversibility:** reversible.

- **D-06: No migration, no live broker read by any agent, and the end-to-end observation is
  founder-owned.** This is a pure Python change under `analytics-service/`. If a plan finds it
  needs SQL, the migration timestamp must sort after everything on origin/main and after
  `20260925120000`, and migration-reviewer, rls-policy-auditor and silent-failure-hunter must run
  before merge (merging auto-applies to PROD). No agent reads Deribit, reads, logs or echoes a
  Deribit credential, or writes to PROD. The close condition ("a deribit options account is
  observed to ingest end to end") is a **founder-owned post-deploy checkpoint**. After the fix is
  deployed, the founder retries the Deribit options strategy that failed on 2026-09-23. They
  report counts and statuses only: job terminal status, return-point count, and whether any
  `assignment` refusal recurred. A live census read is NOT planned. D-01/D-02 make n=1 safe
  without one, so it is not needed.
  — **Reversibility:** reversible.

### Claude's Discretion
- Exact wording of the D-02 refusal message and the evidence-file field names.
- Whether the co-occurrence guard is a helper shared by both twins or inlined at each site.
  Prefer one helper, matching how `describe_unclassified_row` is shared.
- Test file layout: extend the existing Deribit test files, or add one new file.
- The CHANGELOG entry and VERSION bump happen at ship time (`/gsd-ship`), not in these plans.

### Deferred Ideas (OUT OF SCOPE)
- A zero-`change` unknown Deribit type passes the classifier silently (only nonzero is loud).
  Noted in the TODOS entry. Not fixed here, per the scope fence.

**Scope fences (CONTEXT `<domain>`):** the native_nav inception reconciliation breach (Phase
161.1's blocker), the "still computing" copy (Phase 167.2), and the zero-change silent pass are
out of scope. This phase is not a prerequisite for 161.1's go-live step.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TODOS `[DERIBIT-ASSIGNMENT-UNCLASSIFIED]` | Deribit's `assignment` type is in neither `CASH_BEARING_TYPES` nor `INFORMATIONAL_TYPES`, so every options account carrying a nonzero-`change` `assignment` row fails ingestion. Classify it against the census, never from magnitude, and neither drop nor double-count realized cash. | Q1 (batch scope → guard design), Q2 (the 6 name-listing sites + 5 automatic consumers), Q3 (the 4 tests that flip + the 2 that would go vacuous), Q4 (fixture/evidence conventions), Q5 (census of repo-captured `assignment` rows = 0), and the Deribit-docs finding in Conflicts. |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md / MEMORY)

- **pytest ONLY from `analytics-service/`**, with the main checkout's venv and the four TEST env vars unset (a run from the repo root misses cassettes and makes LIVE broker calls). Never start `uvicorn` (a local worker claims real prod compute jobs).
- **No live broker read, no credential read/log/echo, no remote DB.** No agent writes to PROD. Merging a `supabase/migrations/**` file auto-applies to PROD (no human gate) — this phase needs no migration.
- **Repo is PUBLIC and `.planning/` is tracked.** No job ids, correlation ids, account/key ids, strategy names, home paths or usernames in any planning artifact or the D-03 evidence file. Run `npm run check:planning-hygiene` after any `.planning/` write.
- **Tests must be able to fail** (data-integrity gates): neuter → observe RED → restore for every new assertion. A test that cannot fail is worse than none.
- **Fail loud; root-cause; no bandaids.** Never loosen a tolerance. Never fabricate a missing field.
- **Cite by symbol, not line number** (line numbers below are a convenience at `096671f2d` and will drift).
- **Every ship writes a CHANGELOG entry** with the VERSION bump (at `/gsd-ship`, not in these plans). `VERSION` and `package.json` stay byte-equal 4-digit strings.
- **Surface conflicts, don't average them** (see `## Conflicts with CONTEXT`).

## Summary

The fix is small in lines and wide in reach. Adding `"assignment"` to `CASH_BEARING_TYPES` flows by construction into `_NATIVE_CASH_BEARING_TYPES`, `_row_is_cash_bearing`, `_row_is_native_cash_bearing`, `inverse_days_needing_index`, `assert_balance_identity`'s reference set, and the `total_return_rows` floor count in `_crawl_deribit_ledger`. But **six other places list option event types by literal name, `("trade", "delivery")`**, and they don't read the type sets. Each of those six must be decided explicitly, or `assignment` gets summed as cash while the mark-to-market arm, the summary cross-check and the option-book replay treat it as invisible. Under `mark_to_market`, invisible means a double count against Deribit's `options_settlement_summary`. Under `smoothed_mtm` it means an un-zeroed short position.

**Batch scope is settled by the code, not by inference.** Every production path goes through `build_deribit_native_ledger` with `since_ms=None`: four `job_worker.py` sites, including `run_stitch_composite_job._reconstruct_deribit`, plus both acceptance scripts. The crawl therefore starts at `DEFAULT_START_MS` (2015-01-01). The USD twin `txn_rows_to_daily_records` runs **first**, once per `(scope, currency)` full-history batch inside `_crawl_deribit_ledger`, before the native twin ever sees the rows. So the 2026-09-23 refusal was raised by the USD twin over one `(scope, BTC)` full-history batch, and its `delivery=0 settlement=0 trade=1` census covers that instrument's whole history in that scope and currency. An `assignment` and an expiry `delivery` for the same instrument cannot fall into different production batches, except through a hypothetical future `since_ms` caller. Refuse that case structurally, mirroring the existing `smoothed_mtm requires a full-history crawl` refusal.

**New external evidence (current Deribit docs) corroborates D-01 but widens the risk surface.** The official `private/get_transaction_log` page now lists `expiry`, `assignment` and `exercise` among the common `type` values. It says an OTM expiry's `expiry` entry "remains the only entry" and that "in-the-money expiries use `assignment` or `exercise`". That is consistent with the census: no sibling `delivery`. It also means **`exercise` (the long-ITM twin) has the identical refusal shape**, so the founder's end-to-end retry could fail on `exercise` next. D-01 scope is locked to `assignment`, so this is flagged, not acted on (see Conflicts).

**Primary recommendation:** Add `assignment` to `CASH_BEARING_TYPES`, cited to the D-03 evidence file. Introduce one module constant for option book/expiry event types and replace all six `("trade","delivery")` literals with it, so `assignment` behaves exactly like `delivery` on every basis. Add one shared pure co-occurrence guard, called at both twins before the cash-bearing branch, whose message carries a discriminator phrase the unknown-type refusal lacks. Add a `since_ms is not None` + `assignment`-present structural refusal in `build_deribit_native_ledger`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Type classification (`CASH_BEARING_TYPES` etc.) | API / Backend (pure core `services/deribit_txn.py`) | — | Pure, pandas/async-free module (an AST purity guard in `test_deribit_txn.py` forbids pandas) |
| Co-occurrence guard (D-02) | API / Backend (pure core, `deribit_txn.py`) | — | Must run inside both twins over the batch they already hold |
| Full-history precondition (since_ms refusal) | API / Backend (I/O adapter `services/deribit_ingest.py` `build_deribit_native_ledger`) | — | Only the adapter knows whether the crawl was windowed |
| Option-book replay / MTM / coverage | API / Backend (pure core) | adapter `_build_smoothed_option_mtm` | Replay is pure; the marks fetch is I/O |
| Evidence file (D-03) | Repo docs (`analytics-service/docs/evidence/`) | tests cite it | Counts only, dated |
| End-to-end observation | Founder (post-deploy) | — | D-06: no agent reads Deribit |

## Standard Stack

No new dependencies. Everything is stdlib plus existing modules.

| Component | Where | Purpose |
|---|---|---|
| `pytest` (existing, main-checkout venv) | `analytics-service/` | Unit tests; the baseline run of the three Deribit suites was **333 passed** this session |
| `services.deribit_txn` | existing | Classifier, twins, replay, identity |
| `services.deribit_ingest` | existing | Crawl + native-ledger adapter |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed by this phase. Nothing to audit.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Q1 — Batch scope at every call site, and the guard design

### Verified call graph (production)

`[VERIFIED: grep of analytics-service excluding tests/.venv this session]`: production callers of the twins:

| Caller | Calls | `since_ms` passed | Batch the twin sees |
|---|---|---|---|
| `_crawl_deribit_ledger` (deribit_ingest.py) | `txn_rows_to_daily_records(rows, supplemental_index=…, indexable_currencies=…)` inside `for scope … for currency …` | inherits caller | **one `(scope, currency)` batch**, from `start_ms = since_ms if since_ms is not None else DEFAULT_START_MS` to `_now_ms()` |
| `build_deribit_native_ledger` (deribit_ingest.py) | `txn_rows_to_native_daily(raw_rows, …)` **after** `_crawl_deribit_ledger` returns | param, default `None` | **all scopes × all currencies**, concatenated (`raw_rows_all.extend(...)`) |
| `run_derive_broker_dailies_job` (job_worker.py, 3 sites: cash, MTM 2nd pass, smoothed 3rd pass) | `build_deribit_native_ledger(ctx.exchange, account_state=…, pnl_basis=…, exclude_spot_extraction=…)` | **not passed → `None`** | full history |
| `run_stitch_composite_job._reconstruct_deribit` (job_worker.py) | `build_deribit_native_ledger(ctx.exchange, account_state=…, pnl_basis=basis, exclude_spot_extraction=exclude_spot)` | **not passed → `None`** | full history |
| `scripts/deribit_acceptance.py`, `scripts/zavara_acceptance.py` | `_crawl_deribit_ledger(exchange, None)` / `build_deribit_native_ledger(exchange, None)` / `(exchange, pnl_basis=…)` | `None` | full history |
| `fetch_deribit_ledger_daily_records` | delegate to `_crawl_deribit_ledger` | param | **no production caller** (tests only) |

`[VERIFIED: analytics-service/services/deribit_ingest.py:142-144]` verbatim:
```
# 2015-01-01 UTC in ms — full Deribit history default (txn-log spans 2023→2026).
DEFAULT_START_MS: int = 1_420_070_400_000
```

`[VERIFIED: deribit_ingest.py build_deribit_native_ledger]` existing full-history precedent, verbatim:
```
    if pnl_basis == PNL_BASIS_SMOOTHED_MTM and since_ms is not None:
        raise LedgerValuationError(
            "smoothed_mtm requires a full-history crawl (since_ms=None): the "
```

### Which site produced the 2026-09-23 refusal

**The USD twin, inside `_crawl_deribit_ledger`, on the stitch composite's cash pass.** `[VERIFIED: code order read this session]` `_crawl_deribit_ledger` calls `txn_rows_to_daily_records` per `(scope, currency)` batch *during* the crawl loop. The native twin only runs after the whole crawl returns, so on every production path the USD twin sees an unknown row first and raises first. The two raises are byte-identical, so the message alone can't tell them apart; code order settles it. In `run_stitch_composite_job` the cash pass is `_reconstruct_all(cash_pnl_basis, report_progress=True)` → `_reconstruct_deribit` → `build_deribit_native_ledger` → `_crawl_deribit_ledger`. A `LedgerValuationError` there is in `_PERMANENT_LEDGER_ERRORS`, and with `structural_degrade` False it is stamped with "Composite member reconstruction failed structurally". That matches the ROADMAP record.

**Consequence:** the census `delivery=0 settlement=0 trade=1` was counted over the full-history `(scope, BTC)` batch for that scope, not over a window.

### Can an `assignment` and its expiry `delivery` fall into different batches?

- **Across `since_ms` windows:** not on any production path, because all pass `None`. A future caller could window. Both rows would be stamped at the same expiry event, so only an exact straddle could split them. Close it structurally anyway (see design).
- **Across `end_ms = _now_ms()`:** a crawl running at the expiry instant could, in principle, see the `assignment` before a later-written sibling. The next recompute sees both and D-02 refuses. That is loud on recompute, and the first run's sum was correct for the rows that existed. Acceptable; document it in the guard's comment.
- **Across currencies (USD twin):** a Deribit instrument settles in one currency (inverse `BTC-…` in BTC, linear `BTC_USDC-…` in USDC), so its rows share `currency`. `[ASSUMED]` It isn't proven by repo evidence. The native twin's guard runs over **all** currencies concatenated, so it backstops this assumption at no cost.
- **Across scopes:** the native twin's all-scope batch can see a sibling from a *different subaccount* on the same instrument. That is a false-positive refusal: loud, never silent. Deribit's docs now say ITM expiries emit `assignment`/`exercise` and OTM expiries emit `expiry`, so a same-instrument `delivery` in another scope should not arise under the new labels. Accept the false-positive risk. Rows carry `user_id` per the docs, so keying the guard on it is possible, but it is a synthetic-fixture field only in this repo (see Q4). Do not key on it without evidence.

### Recommended guard design (prescriptive)

1. **One pure helper in `deribit_txn.py`**, shared by both twins (matching how `describe_unclassified_row` is shared). For example, `assert_assignment_uncontested(row, rows)`: if `row` is `assignment` and any *other* row in `rows` has the same non-empty `instrument_name` and `type` in `{"delivery", "settlement"}`, raise `LedgerValuationError`. The message must:
   - carry a **discriminator phrase absent from the unknown-type refusal**, e.g. `"shares instrument_name with a delivery/settlement row"`. The unknown-type message already contains the words "double-count" (`"never silently drop nor double-count realized cash"`), so "double-count" alone cannot distinguish the two refusals. See Pitfall 1.
   - append `describe_unclassified_row(row, rows)` (D-02).
   - avoid "classify it against fresh evidence" wording that would make it read as the unknown-type refusal.
2. **Call it in both twins** before the cash-bearing branch, for `row_type == "assignment"` (after the INFORMATIONAL skip and spot-extraction skip, so ordering matches the `correction` gate). In the USD twin it fires first per `(scope, currency)`. The native twin re-checks across all scopes and currencies.
3. **An `assignment` with an empty or missing `instrument_name`:** the census can't be computed. Refuse (fail-closed), since D-01 is licensed only for the measured shape, which named an option instrument. `describe_unclassified_row` already renders `"instrument_name absent — no sibling census possible"`.
4. **Full-history precondition:** in `build_deribit_native_ledger`, after the crawl, if `since_ms is not None` and any raw row has `type == "assignment"` with nonzero change, raise `LedgerValuationError` ("assignment classification requires a full-history crawl…"). This mirrors the `smoothed_mtm` precedent. It is inert on every production path, which all pass `None`. `fetch_deribit_ledger_daily_records(exchange, since_ms)` is test-only but also windowable. Either place the check in `_crawl_deribit_ledger` (covers both entry points) or document why the tests-only entry is exempt. **Prefer `_crawl_deribit_ledger`**: it is the single shared crawl, and the USD twin runs inside it, so the refusal must come before or with the USD twin call for windowed crawls.
5. **Zero-change `assignment` in a co-occurring batch:** decide explicitly. Recommend the guard fires only on nonzero `change`. A zero-change row carries no cash to double-count, and this matches the existing unknown-type discipline. Pin whichever choice is made with a test.

## Q2 — Every consumer of the Deribit type vocabulary

### Verbatim type-set definitions

`[VERIFIED: analytics-service/services/deribit_txn.py:533-535]`
```
CASH_BEARING_TYPES: frozenset[str] = frozenset(
    {"trade", "settlement", "delivery", "liquidation", "negative_balance_fee"}
)
```
`[VERIFIED: deribit_txn.py:541-549]` `INFORMATIONAL_TYPES` = `"transfer", "deposit", "withdrawal", "usdc_reward", "swap"`.
`[VERIFIED: deribit_txn.py:591]` `_SIBLING_TYPES: tuple[str, ...] = ("delivery", "settlement", "trade")`
`[VERIFIED: deribit_txn.py:579-586]` `_SHAPE_FIELDS` = `"type", "currency", "change", "instrument_name", "timestamp", "side"` (**no `position`, no `commission`**).
`[VERIFIED: deribit_txn.py:673-681]` `_NATIVE_INTERNAL_REBALANCE_TYPES = frozenset({"swap"})`; `_NATIVE_INFORMATIONAL_TYPES = INFORMATIONAL_TYPES - _NATIVE_INTERNAL_REBALANCE_TYPES`; `_NATIVE_CASH_BEARING_TYPES = CASH_BEARING_TYPES | _NATIVE_INTERNAL_REBALANCE_TYPES`.
`[VERIFIED: deribit_txn.py:903-905]` `_NATIVE_OPTIONS_SUMMARY_TYPES = frozenset({"options_settlement_summary"})`.

Import-time asserts (all still hold with `assignment` added to `CASH_BEARING_TYPES`, which I checked by simulation; see Q3): USD pair disjoint; `_NATIVE_INTERNAL_REBALANCE_TYPES <= INFORMATIONAL_TYPES - _EXTERNAL_FLOW_TYPES`; native pair disjoint; summary set disjoint from both native sets.

### A. Consumers that pick up `assignment` automatically (no edit; verify by test)

| Symbol | File | Why automatic | Decision |
|---|---|---|---|
| `_NATIVE_CASH_BEARING_TYPES` | deribit_txn.py | `CASH_BEARING_TYPES \| {"swap"}` | automatic ✓ |
| `_row_is_cash_bearing` / `_row_is_native_cash_bearing` | deribit_txn.py | read the sets | automatic ✓ |
| `inverse_days_needing_index` | deribit_txn.py | filters on `_row_is_cash_bearing` → an inverse BTC `assignment` without its own `index_price` triggers the same-day `get_delivery_prices` supplemental fetch | automatic ✓ (fail-loud D-07 if no same-day index exists) |
| `assert_balance_identity` reference Σchange | deribit_txn.py | filters on `_row_is_native_cash_bearing` | automatic ✓. Under `cash_settlement` the strict identity closes, because the aggregator and the reference both include it |
| `_crawl_deribit_ledger` `total_return_rows` | deribit_ingest.py | `_row_is_cash_bearing` | automatic ✓ |
| `deribit_raw_rows_have_option_activity` | deribit_ingest.py | keys on `classify_instrument(...) == "option"` for **any** type | automatic ✓ (an `assignment` on an option name already counts as option activity) |
| `_NATIVE_OPTIONS_SUMMARY_TYPES` | deribit_txn.py | unrelated type | **no change**. `assignment` must NOT be added (it would break the summary/cash-bearing disjointness assert) |
| `_EXTERNAL_FLOW_TYPES` | deribit_txn.py | capital flows | **no change** |
| `exclude_spot_extraction` / `spot_net_extraction_day_pairs` | deribit_txn.py | spot `BTC_USDC` legs only | **no change** (an option `assignment` is never spot) |
| `services/ingestion/fingerprint.py` `"delivery"` | — | ccxt `order_type`, not a txn-log type | **unrelated**, no change |

### B. The six literal `("trade", "delivery")` sites that do NOT read the sets (must be decided)

`[VERIFIED: grep + read this session]` (deribit_txn.py):

| # | Symbol | Literal | Effect if `assignment` is left out | Recommendation |
|---|---|---|---|---|
| 1 | `_pre_coverage_option_days` | `not in ("trade", "delivery")` | An `assignment` outside mark_to_market coverage books full cash but is not flagged `pre_summary_rollout_option_dailies` (the honesty caveat is missed) | **include** |
| 2 | `_option_activity_after_coverage` | `not in ("trade", "delivery")` | A trailing-edge `assignment` after the last summary does not mark the currency open-book → false strict-identity breach possible under mark_to_market | **include** |
| 3 | `_assert_smoothed_summary_cross_check` | `row_type in ("trade", "delivery")` | Σ(option change+commission) inside the window omits the `assignment` → the smoothed cross-check breaches if the summary carries the assignment economics | **include** |
| 4 | `replay_option_positions` | `not in ("trade", "delivery")` | The short put's position from its opening `trade` is never zeroed → carried past expiry → `option_mtm_daily` raises the D-07 "no daily mark" hole on the first grid day after expiry (and `_build_smoothed_option_mtm` caps marks at expiry), and the terminal book is wrong | **include**. Needs `position` on the row; absent → existing fail-loud `LedgerValuationError` (never fabricate) |
| 5 | `txn_rows_to_native_daily` option arm | `if row_type == "trade" or row_type == "delivery":` | Under **mark_to_market**, inside coverage, trade/delivery contribute `−commission` because the summary carries premium/payout (E2/E3 evidence). An `assignment` left out contributes its **full** `change` **and** the summary carries it → **double count** | **include** (contributes `−_option_commission(row)` inside coverage; full change outside and under cash_settlement/smoothed) |
| 6 | same arm, delivery-names-non-derivative guard | `row_type == "delivery" and cls in ("unknown", "spot") and change != 0.0` | An `assignment` naming a spot/unclassifiable instrument would be booked silently | **include** (an assignment always names an option; anything else fails loud) |

**Prescription:** define one module constant, for example
`_OPTION_EXPIRY_TYPES: frozenset[str] = frozenset({"delivery", "assignment"})` and
`_OPTION_BOOK_EVENT_TYPES: frozenset[str] = frozenset({"trade"}) | _OPTION_EXPIRY_TYPES`.
Use it at all six sites so the vocabulary can never fork again. Add an import-time assert: `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES`. It holds by construction, and it catches a future expiry-type addition that forgets the cash set. Also update the docstrings that name "trade/delivery" (`replay_option_positions`, `_pre_coverage_option_days`, `_option_activity_after_coverage`, `_option_commission`, `txn_rows_to_native_daily`) and `analytics-service/docs/deribit-ingestion-design.md` (it describes option `trade`/`delivery` rows by name, for example in the basis descriptions).

**Is "assignment behaves like delivery" justified?** Two pieces of evidence, both short of proof:
- `[VERIFIED: docs/evidence/drb02-deribit-field-semantics-2026-07-05.json, drb01-deribit-ground-truth-2026-07-04.json, read this session]`: the 2026-07 probes captured option `delivery` rows (expiries in 2023–2024), side `close buy`, negative `change`. The drb01 sample carries a `position` field. That is the same shape as the 2026-09-23 `assignment` (side `close buy`, option instrument, no sibling delivery).
- `[CITED: docs.deribit.com/api-reference/account-management/private-get_transaction_log.md]`: "When an option expires out of the money, the transaction log type is `expiry` … this remains the only entry in the transaction log for that expiration. In-the-money expiries use `assignment` or `exercise`, and may be followed by a `future creation` entry." And for `side`: "deliveries / exercise: `close buy` or `close sell`".
- The inference that `assignment` is Deribit's newer label for the short-ITM expiry event formerly logged as `delivery` is `[ASSUMED]`. The planner should say so in the code comment and cite the D-03 file, not assert it as fact.

**Does the replay need to treat `assignment` as position-changing, and does the row carry `position`?** Yes, it must be position-changing. It closes the short, and without it the replay is provably wrong (D-07 hole or stale terminal book). Whether the row carries `position` (and `commission`) is **not knowable from repo evidence**: the refusal's whitelist `_SHAPE_FIELDS` never renders those fields, and no repo fixture, cassette or evidence file contains an `assignment` row. The docs describe `position` generically as "Updated position size after the transaction" and `commission` as "Commission paid so far (in base currency)", without per-type presence. **Fail-closed treatment:** include `assignment` in the replay and the option arm, and rely on the existing guards: `replay_option_positions` raises on absent/null/blank/non-numeric `position`, and `_option_commission` raises on absent `commission` inside coverage. Never default either field.

### C. Where each basis runs, and what a residual failure costs

`[VERIFIED: job_worker.py read this session]`

| Path | cash_settlement (primary) | mark_to_market | smoothed_mtm |
|---|---|---|---|
| `run_derive_broker_dailies_job` | load-bearing | 2nd pass when `has_option_activity` → structural error **degrades** (cash ships) | 3rd pass only if `is_smoothed_mtm_enabled()` → degrades |
| `run_stitch_composite_job` | load-bearing (`_PERMANENT_LEDGER_ERRORS` → `_stamp_failed`, permanent) | `_reconstruct_all(PNL_BASIS_MARK_TO_MARKET)` when `mark_to_market_available(member_signals)`, with **no** `structural_degrade` → **a LedgerValuationError fails the whole composite permanently** | only if the flag is on and `smoothed_mtm_available` → `structural_degrade=True` → degrades |

**Planning consequence:** on the stitch composite path (the one that failed on 2026-09-23), the mark_to_market pass is load-bearing for an options member. If the site-5 treatment raises on a well-formed `assignment`, for example because the row lacks `commission`, the composite still fails after the fix. That failure is loud, and it is the right disposition under this repo's never-fabricate rule, but it would leave the close condition unmet. Record it as a known risk for the founder checkpoint (Open Question 2). Whether `SMOOTHED_MTM_ENABLED` is on in PROD is `[ASSUMED]` unknown. It was not read this session, and the smoothed pass degrades either way.

## Q3 — Existing tests that flip

`[VERIFIED: measured this session]` Baseline: `tests/test_deribit_unclassified_evidence.py tests/test_deribit_txn.py tests/test_deribit_ingest.py` → **333 passed**. Simulating D-01 alone in-process (both `CASH_BEARING_TYPES` and `_NATIVE_CASH_BEARING_TYPES` patched to include `assignment`, no file edits) → **4 failed, 329 passed**:

| Test | Why it flips under D-01 | Under D-01 + D-02 | Action |
|---|---|---|---|
| `test_deribit_txn.py::test_type_sets_pinned_to_evidence` | `assert CASH_BEARING_TYPES == {…}` exact set pin | still RED | Update the pin to include `assignment`, with the D-03 citation in the comment. Keep `"mystery_new_type", "rebate_v2"` unknown |
| `test_deribit_unclassified_evidence.py::test_a_zero_change_unknown_type_still_passes_silently` | zero-change `assignment` now cash-bearing → the USD twin `by_day.setdefault(day, 0.0)` emits one record with `price: 0.0` (measured: `Left contains one more item … 'price': 0.0`) | still RED | Re-point to a still-unknown type (D-05) |
| `test_deribit_unclassified_evidence.py::test_refusal_carries_the_shape_and_the_sibling_census` | USD twin now sums the `assignment`; the fixture row has no `index_price` → raises the D-07 "no event-time index_price" error instead, which lacks `OBSERVED SHAPE:` | **goes GREEN AGAIN if the D-02 message appends `describe_unclassified_row`**: the fixture pairs `assignment` with a same-instrument `delivery`, so D-02 fires with `assignment`, `OBSERVED SHAPE:`, the instrument and `delivery=1` all in the message | **Vacuity trap.** Re-point to a still-unknown type, and assert the D-02 discriminator phrase is **absent** |
| `test_deribit_unclassified_evidence.py::test_the_native_sibling_refusal_carries_it_too` | native twin sums both rows → `DID NOT RAISE` (this is the silent double-count D-02 exists to stop, observed directly) | same vacuity as above | Same re-point |

Unaffected: `test_the_census_DISTINGUISHES_the_two_worlds`, `test_identifiers_are_REDACTED_by_whitelist`, `test_the_renderer_never_raises_on_a_hostile_row` (they call `describe_unclassified_row` directly). `test_deribit_ingest.py` passed unchanged under the simulation. After the six-site edits, re-run the whole Deribit-adjacent set (Validation Architecture), including `test_smoothed_mtm_core.py`, `test_mtm_single_key.py`, `test_stitch_composite_job.py` and `test_job_worker_deribit.py`. None of them contains an `assignment` literal (Q5), so they should stay green, but that is a measurement to take, not an assumption to ship.

## Q4 — Fixture, test and evidence conventions to reuse

- **Deribit tests use in-process synthetic rows, not cassettes.** `tests/fixtures/deribit_flow_fixtures.py` says so explicitly ("These are IN-PROCESS stubs, NOT vcrpy cassettes"). `tests/cassettes/` holds only `bybit/` and `okx/`.
- **Row helpers to reuse:** `test_deribit_txn.py` `_ms(iso)`, `_DAY_A`, `_option_trade(ts, *, ccy, change, commission, instrument, rid)` (the mark_to_market coverage tests), `_summary_row(...)`, `_opt_row(*, instrument, ccy, day, position, id, type="trade")` (replay tests; `type=` already parameterised, so `type="assignment"` drops in). The existing `test_deribit_unclassified_evidence.py` `ASSIGNMENT_ROW`/`DELIVERY_ROW` shape (synthetic `user_id`/`order_id`/`username` to prove redaction).
- **USD-twin fixture caveat (measured):** an inverse BTC `assignment` needs an own `index_price`, a same-day index-bearing row in the batch, or `supplemental_index=`. Otherwise the USD twin raises the D-07 index error, not the behaviour under test. Or use a linear (`USDC`) currency to isolate the type logic, as `test_unknown_change_type_fails_loud` does.
- **Crawl-level stubs:** `test_deribit_ingest.py` `_patch_pipeline(monkeypatch, scopes=…, currencies=…, paginate=…)`. Use it for the `since_ms` full-history refusal test and for a crawl-level "census shape ingests" test.
- **Evidence JSON convention** (`[VERIFIED: docs/evidence/drb-options-semantics-2026-07.json, drb02-…json` top-level keys read this session]): underscore-prefixed metadata keys `_evidence` (title), `_generated` (ISO date), `_subject`, `_sources` / `_method`, then finding keys (for example `E1_…`, `classification`, `settled_do_not_reopen`). ⚠️ The existing files' `_subject` fields carry key ids and strategy names. **D-03's file must not copy that habit.** Suggested fields: `_evidence`, `_generated: "2026-09-23"` (observation date) plus a recorded-on date, `_subject` (generic), `_method` ("read-only from the production analytics log; the refusal's own `describe_unclassified_row` output"), `observation: {type, currency, option_kind: "put", instrument_expired_before_observation: true, side: "close buy", change_nonzero: true, same_instrument_sibling_census: {delivery: 0, settlement: 0, trade: 1}, n: 1}`, `deribit_docs_corroboration` (the cited sentence), `limits` (n=1; `position`/`commission` presence not observable through `_SHAPE_FIELDS`). **No `change` value, no strike/expiry string, no ids.**
- **D-01 fixture:** reproduce the census shape with synthetic identifiers: one option `trade` opening a short put, then one `assignment`, side `close buy`, nonzero change, same instrument, no delivery or settlement. Assert it is summed on both twins, per day and per currency, and that `assert_balance_identity` closes under `cash_settlement`.
- **Neuter-RED-restore:** for every new assertion, neuter the production line (for example drop `assignment` from the set, bypass the guard, revert one of the six literals) and observe RED before restoring. ⛔ Do not use `git checkout --` to restore; it destroys uncommitted work. Take a byte backup and restore from it.

## Q5 — Repo-captured `assignment` rows (census)

`[VERIFIED: grep for the quoted literal "assignment" / 'assignment' across analytics-service excluding .venv, this session]`: **3 hits, all non-data**. 2 are in `tests/test_deribit_unclassified_evidence.py` (the synthetic PR #783 fixture and its assertion), and 1 is the quoted production message in a comment in `deribit_txn.py`. **0** `assignment` rows in `docs/evidence/*.json`, **0** in `tests/cassettes/`, and **0** in `tests/fixtures/`. The evidence files also contain **0** `exercise` and **0** `future creation` mentions, and 1 prose mention of `expiry` (drb-options-semantics). The repo's only real observation of `assignment` is the 2026-09-23 refusal recorded in ROADMAP `### Phase 168` (n=1).

## Architecture Patterns

### Data flow (production, per Deribit member)

```
job_worker (derive | stitch cash/MTM/smoothed pass)
   │  build_deribit_native_ledger(since_ms=None, pnl_basis=B)
   ▼
_crawl_deribit_ledger ── for scope × currency ──► paginate_txn_log (full history, 2015→now)
   │                                                  │ rows (one scope, one currency)
   │                                                  ▼
   │                              txn_rows_to_daily_records  ◄── [NEW] co-occurrence guard (batch = scope×ccy)
   │                                                  │ USD daily records (+ supplemental index if needed)
   │  raw_rows_all = concat(all batches)              ▼
   ▼                                            (discarded by native path)
[NEW] since_ms guard (refuse assignment on a windowed crawl)
   ▼
txn_rows_to_native_daily(raw_rows_all, B) ◄── [NEW] co-occurrence guard (batch = all scopes × ccys)
   │   option arm (site 5/6): trade|delivery|assignment → −commission inside MTM coverage
   ▼
B == smoothed? → replay_option_positions (site 4) → marks → option_mtm_daily
   ▼
assert_balance_identity (ref set = _NATIVE_CASH_BEARING_TYPES; sites 2/3 feed exemptions + cross-check)
   ▼
NativeLedger → native_nav §5 inception gate → returns
```

### Anti-Patterns to Avoid
- **Classifying from magnitude.** Never cite the `change` size in code, comments, tests or the evidence file (ROADMAP forbidden remedy).
- **Editing the set only.** Adding `assignment` to `CASH_BEARING_TYPES` without the six literal sites creates a mark_to_market double count and a smoothed replay hole.
- **Adding `assignment` to `_NATIVE_OPTIONS_SUMMARY_TYPES`.** That breaks disjointness and is semantically wrong.
- **Defaulting a missing `position`/`commission`** on an `assignment` row. Fail loud through the existing guards.
- **Deleting the PR #783 evidence tests.** D-05 says re-point, not delete.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sibling census text | a second renderer | `describe_unclassified_row(row, rows)` | Whitelist redaction + never-raises contract already tested |
| Missing-index valuation | a new index lookup | `inverse_days_needing_index` + `supplemental_index` (automatic via `_row_is_cash_bearing`) | D-07 same-day discipline already enforced |
| Missing position / commission handling | new checks | existing raises in `replay_option_positions` / `_option_commission` | Leak-safe messages already pinned |
| Windowed-crawl refusal | ad-hoc flag | mirror the `smoothed_mtm requires a full-history crawl` raise | Same shape, same error class |
| Crawl stubs | new fakes | `_patch_pipeline` in `test_deribit_ingest.py` | Stubs all four I/O primitives |

## Common Pitfalls

### Pitfall 1: The D-02 refusal makes the old evidence tests pass for the wrong reason
**What goes wrong:** the PR #783 fixtures pair `assignment` with a same-instrument `delivery`. After D-02, both twins raise the co-occurrence refusal, and if its message appends `describe_unclassified_row` the old assertions (`"assignment"`, `"OBSERVED SHAPE:"`, `"delivery=1"`) go green again. They are then testing D-02, not the unknown-type channel.
**How to avoid:** re-point those tests to a still-unknown type. Give the D-02 message a discriminator phrase (for example "shares instrument_name with a delivery/settlement row"), and assert it is **absent** in unknown-type tests and **present** in D-02 tests. "double-count" is NOT a discriminator: the unknown-type message already contains "double-count realized cash".
**Warning sign:** a re-pointed test still uses `type: "assignment"`.

### Pitfall 2: mark_to_market double count on the stitch path
**What goes wrong:** `assignment` summed at full `change` inside coverage while the `options_settlement_summary` also carries expiry economics (E2: "Option expiry economics live in the options_settlement_summary channel"). The balance identity would likely catch a material breach, but only if the currency is not in `open_option_ccys`; otherwise it defers to the §5 gate with wider tolerances.
**How to avoid:** include `assignment` at site 5 (the `−commission` inside coverage). Test with a summary-covered `assignment` under `PNL_BASIS_MARK_TO_MARKET`.

### Pitfall 3: Smoothed replay leaves the assigned short open
**What goes wrong:** the short put's last replayed position stays nonzero past expiry → `option_mtm_daily` D-07 hole (the smoothed pass degrades or the job fails) or a wrong terminal book.
**How to avoid:** include `assignment` at site 4. Test: trade (position −1) → assignment (position 0) gives replay positions `{d1: -1.0, d2: 0.0}`, and a missing `position` on the assignment raises.

### Pitfall 4: Inverse-currency fixture raises the wrong error
**What goes wrong:** a BTC `assignment` with no index anywhere raises D-07 "no event-time index_price" (measured this session), masking the behaviour under test.
**How to avoid:** give the row `index_price`, add a same-day index-bearing row, pass `supplemental_index`, or use a linear currency.

### Pitfall 5: `exercise` refuses next
**What goes wrong:** the founder retry clears `assignment` and then fails on `exercise` (docs: ITM expiries use `assignment` or `exercise`). That is still loud and self-evidencing, not corrupt.
**How to avoid:** out of scope under D-01. Add "did an `exercise` (or any other unknown-type) refusal occur" to the D-06 founder report, and pre-name the follow-up (Conflicts #1).

### Pitfall 6: Hygiene leaks in the evidence file
**What goes wrong:** copying the existing evidence files' `_subject` style (key ids, strategy names) or the instrument's strike/expiry string into the D-03 file.
**How to avoid:** counts and categories only. Run `npm run check:planning-hygiene` (it covers `.planning/`). The evidence file lives under `analytics-service/docs/`, so review it by eye as well.

## Code Examples

Guard sketch (the names are discretionary; `LedgerValuationError` and `describe_unclassified_row` are `[VERIFIED: deribit_txn.py]` symbols):
```python
# deribit_txn.py — shared by both twins, called only for row_type == "assignment"
_ASSIGNMENT_CONTESTING_TYPES: frozenset[str] = frozenset({"delivery", "settlement"})

def assert_assignment_uncontested(row, rows) -> None:
    instrument = row.get("instrument_name")
    if instrument in (None, ""):
        raise LedgerValuationError(
            "Deribit assignment row has no instrument_name — the classification is "
            "licensed only for the census shape (docs/evidence/drb-assignment-census-2026-09.json); "
            "refusing. " + describe_unclassified_row(row, rows)
        )
    if any(
        other is not row
        and other.get("instrument_name") == instrument
        and str(other.get("type", "")).strip().lower() in _ASSIGNMENT_CONTESTING_TYPES
        for other in rows if isinstance(other, Mapping)
    ):
        raise LedgerValuationError(
            "Deribit assignment row shares instrument_name with a delivery/settlement row "
            "in this batch — an UNOBSERVED shape: summing both may double-count realized "
            "expiry cash; refusing to sum or skip. " + describe_unclassified_row(row, rows)
        )
```
Shared option-event vocabulary:
```python
_OPTION_EXPIRY_TYPES: frozenset[str] = frozenset({"delivery", "assignment"})
_OPTION_BOOK_EVENT_TYPES: frozenset[str] = frozenset({"trade"}) | _OPTION_EXPIRY_TYPES
assert _OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES
```

## State of the Art

| Old understanding (ROADMAP/TODOS, 2026-09-12) | Current (this session) | Impact |
|---|---|---|
| "Deribit does not enumerate the `type` enum in its published docs" | The docs list common values including `expiry`, `assignment`, `exercise`, `future creation`, and describe ITM vs OTM expiry entries `[CITED]` | Corroborates D-01/D-02; names `exercise` as the next likely refusal |
| Option expiry = `delivery` (2023–2024 evidence) | Newer expiries appear as `assignment` (n=1) / per docs `exercise`/`expiry` | `[ASSUMED]` relabel. If true, `expiry` rows (likely zero-change) pass silently and never zero the replayed position, which is a smoothed-basis hole outside this phase's scope |

## Conflicts with CONTEXT

1. **ROADMAP/TODOS premise "Deribit does not enumerate the type enum" is stale.** `[CITED: docs.deribit.com/api-reference/account-management/private-get_transaction_log.md, fetched 2026-09-26]` The page lists `trade, deposit, withdrawal, settlement, delivery, transfer, swap, correction, expiry, assignment, exercise, future creation, …` as common values. It states that OTM expiry → `expiry` "remains the only entry", and that ITM expiries "use `assignment` or `exercise`". This **supports** D-01 and D-02: no sibling `delivery` is expected. It does **not** contradict any decision. It does mean the phase goal ("an options account ingests end to end") can still be blocked by `exercise`, the long-ITM twin with an identical refusal shape, which D-01 leaves refusing. **Not widened here.** Recommendation for the orchestrator: keep D-01 as locked. Add "did any `exercise` or other unknown-type refusal occur" to the D-06 founder report, and pre-name a follow-up owner for `exercise`/`expiry` classification. A docs-only classification of `exercise` would be the guess the ROADMAP forbids.
2. **D-01/D-04 refinement: "summed as realized cash" is basis-dependent for option expiry events.** Under `mark_to_market` inside summary coverage, `delivery` contributes only `−commission` (E2/E3, `drb-options-semantics-2026-07.json`). `assignment` must follow the same arm, or it double-counts. It is still in `CASH_BEARING_TYPES`, so it still enters the balance-identity reference set, which keeps D-01's membership. The phrase "summed" must not be read as "full `change` on every basis". The plan should state this explicitly.
3. **D-06's founder report is too narrow for the stitch path.** The mark_to_market pass is load-bearing in `run_stitch_composite_job`. If the `assignment` row lacks `commission` (or `position` under smoothed with the flag on), the composite fails loud with a different `LedgerValuationError`, not an "assignment refusal". The founder report should record **any** terminal error kind and message class, not only whether an `assignment` refusal recurred.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `assignment` is Deribit's newer label for the short-ITM expiry event formerly logged as `delivery` (same side `close buy`, same shape) | Q2-B | If `assignment` means something else, the delivery-like treatment at sites 1–6 is wrong; the balance identity / cross-check would be the backstop |
| A2 | `options_settlement_summary` realized_pl includes the `assignment` expiry economics (as E2 shows for `delivery`) | Q2-B site 5, Pitfall 2 | If not, the `−commission` treatment drops the assignment cash under mark_to_market; the strict identity / §5 gate would fire (loud) |
| A3 | `assignment` rows carry `commission` and `position` | Q2-B sites 4/5 | If absent, the stitch MTM pass fails loud (permanent) and the smoothed pass degrades; the close condition is not met |
| A4 | All rows of one instrument share one `currency` | Q1 | The USD-twin guard could miss a cross-currency sibling; the native twin's all-currency guard backstops it |
| A5 | `SMOOTHED_MTM_ENABLED` state in PROD is unknown | Q2-C | Only affects whether a replay failure is exercised; it degrades either way |

## Open Questions (RESOLVED)

1. **Does `exercise` (or `expiry`) appear with nonzero change on the failing account?** — RESOLVED (routed, not answered here)
   - Known: the docs name both, the repo has 0 observations, and only the first unknown row raises.
   - Recommendation: founder report (D-06) captures it. Do not classify here.
   - RESOLVED: `168-03-PLAN.md` (D-08) — the founder's post-deploy report names any refusal class by type, and an `exercise`/`expiry` refusal is routed to its own phase; `168-01-PLAN.md` pins both as unclassified.
2. **Does an `assignment` row carry `commission` / `position`?**
   - Known: `_SHAPE_FIELDS` never renders them, and there is no repo evidence.
   - Recommendation: fail-closed through the existing guards. **Discretion:** add `position` and `commission` to `_SHAPE_FIELDS` (sizes/fees, not identifiers) so any future refusal answers it. Update `test_identifiers_are_REDACTED_by_whitelist` expectations only if needed.
   - RESOLVED: `168-02-PLAN.md` Task 2 adds `commission` and `position` to `_SHAPE_FIELDS`; `168-02-PLAN.md` Task 1 SITE4-MISSING-POSITION and SITE5-MISSING-COMMISSION pin the fail-closed raises (never defaulted).
3. **Should the D-02 guard key on `user_id` to avoid cross-subaccount false positives?**
   - Recommendation: no. `user_id` presence on real rows is docs-only here, and a false positive is loud.
   - RESOLVED: `168-01-PLAN.md` must_haves record the cross-subaccount false positive as an accepted backstop truth (loud, never silent; not keyed on `user_id`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| main-checkout analytics venv python | all tests | ✓ (baseline 333 passed this session) | — | none needed |
| node / `tsx` for the hygiene gate | hygiene gate | MEASURED: `npm run check:planning-hygiene` in the worktree fails (`tsx: command not found`); invoking the main checkout's `node_modules/.bin/tsx scripts/check-planning-hygiene.ts` from the worktree root works (`OK`). It scans TRACKED files only, so run it after `git add` | — | review by eye |
| Deribit API | — | NOT used (D-06) | — | — |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service venv) |
| Config file | `analytics-service/` pytest config (existing) |
| Quick run command | `cd <worktree>/analytics-service && env -u TEST_SUPABASE_DB_URL -u SUPABASE_TEST_DB_URL -u SUPABASE_TEST_URL -u SUPABASE_TEST_SERVICE_KEY <main-checkout>/analytics-service/.venv/bin/python -m pytest tests/test_deribit_unclassified_evidence.py tests/test_deribit_txn.py tests/test_deribit_ingest.py -q -p no:cacheprovider` |
| Full Deribit-adjacent command | same prefix, `-m pytest tests/test_deribit_unclassified_evidence.py tests/test_deribit_txn.py tests/test_deribit_ingest.py tests/test_smoothed_mtm_core.py tests/test_mtm_single_key.py tests/test_stitch_composite_job.py tests/test_job_worker_deribit.py tests/test_deribit_acceptance.py tests/test_native_nav_sc4_identity.py tests/test_broker_dailies.py -q -p no:cacheprovider` |
| Full suite | same prefix, `-m pytest -q -p no:cacheprovider` (from `analytics-service/` only) |

### Phase Requirements → Test Map
| Req | Behavior | Type | File Exists? |
|-----|----------|------|-------------|
| D-01 | census shape (trade + assignment, no sibling) summed on USD twin (per day) and native twin (per day, ccy); `assert_balance_identity` closes under cash_settlement | unit | ❌ Wave 0 (new tests) |
| D-02 | assignment + same-instrument delivery → refuse on both twins, discriminator phrase present, census appended; same with settlement; empty instrument_name → refuse | unit | ❌ Wave 0 |
| D-02 scope | `_crawl_deribit_ledger`/`build_deribit_native_ledger` with `since_ms` set and an assignment row → refuse; `since_ms=None` → ingests | unit (stubbed crawl via `_patch_pipeline`) | ❌ Wave 0 |
| D-04 | sites 1–6: MTM inside coverage → `−commission`; replay zeroes position; trailing-edge activity marks ccy; cross-check includes it; spot-named assignment refuses; `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES` | unit | ❌ Wave 0 |
| D-05 | re-pointed evidence tests use a still-unknown type; discriminator absent | unit | ✅ edit `test_deribit_unclassified_evidence.py` |
| set pin | `test_type_sets_pinned_to_evidence` includes `assignment` | unit | ✅ edit |
| D-03 | evidence file parses, has the census counts, and contains no forbidden fields (a test can assert key absence: no `change`, no ids) | unit | ❌ Wave 0 |
| D-06 | founder retry: terminal status, return-point count, any refusal class | manual (founder) | n/a |

### Sampling Rate
- **Per task commit:** quick run command.
- **Per wave merge:** full Deribit-adjacent command.
- **Phase gate:** full suite green from `analytics-service/`, plus neuter → RED → restore recorded for each new data-integrity assertion.

### Wave 0 Gaps
- [ ] `analytics-service/docs/evidence/drb-assignment-census-2026-09.json` (D-03)
- [ ] new tests for D-01/D-02/D-04 (new file, for example `tests/test_deribit_assignment.py`, or extend `test_deribit_txn.py`)
- [ ] re-point 3 tests in `test_deribit_unclassified_evidence.py`; update `test_type_sets_pinned_to_evidence`

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2/V3/V4 | no | — |
| V5 Input Validation | yes | Untrusted exchange rows: fail-closed type allow-list; existing `_coerce_float`, absent/null guards |
| V6 Cryptography | no | — |
| V7 Error handling / logging | yes | Refusal text reaches `compute_jobs.last_error` and a customer-facing panel: keep the `describe_unclassified_row` **whitelist** (never blacklist); the new message adds no raw fields |

| Pattern | STRIDE | Mitigation |
|---------|--------|-----------|
| Identifier leak in refusal text | Information disclosure | Whitelist renderer; redaction test stays green; the new message renders only via `describe_unclassified_row` |
| Silent P&L corruption (double count / drop) | Tampering (integrity) | D-02 guard, balance identity, six-site vocabulary constant |
| Public-repo planning leak | Information disclosure | Counts-only evidence file; `npm run check:planning-hygiene` |

## Sources

### Primary (HIGH)
- `analytics-service/services/deribit_txn.py` (read this session): type sets, `describe_unclassified_row`, both twins, `replay_option_positions`, `option_mtm_daily`, `assert_balance_identity`, `_assert_smoothed_summary_cross_check`, coverage helpers
- `analytics-service/services/deribit_ingest.py`: `_crawl_deribit_ledger`, `build_deribit_native_ledger`, `_build_smoothed_option_mtm`, `DEFAULT_START_MS`
- `analytics-service/services/job_worker.py`: `run_derive_broker_dailies_job`, `run_stitch_composite_job` (`_reconstruct_deribit`, pass sequencing)
- Test runs this session: baseline 333 passed; D-01 simulation 4 failed / 329 passed
- `analytics-service/docs/evidence/drb-options-semantics-2026-07.json` (E2, E3), `drb01-…`, `drb02-…` (delivery-row shapes)

### Secondary (MEDIUM)
- Deribit official docs, `private/get_transaction_log`: https://docs.deribit.com/api-reference/account-management/private-get_transaction_log.md (type values, `side`, `position`, `commission`, expiry/assignment/exercise semantics)

### Tertiary (LOW)
- Relabel hypothesis (A1), summary coverage of assignment (A2), field presence (A3)

## Metadata

**Confidence breakdown:**
- Batch scope / call graph: HIGH (every production call site read)
- Consumer enumeration: HIGH (grep + read of all six literal sites and the set consumers)
- Deribit semantics of `assignment`: MEDIUM (n=1 census + official docs), LOW on row fields

**Research date:** 2026-09-26
**Valid until:** ~2026-10-26 (code), or sooner if Deribit's docs change again
