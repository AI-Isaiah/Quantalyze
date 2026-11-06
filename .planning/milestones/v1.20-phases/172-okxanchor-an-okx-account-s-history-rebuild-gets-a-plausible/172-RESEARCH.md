# Phase 172: OKXANCHOR - Research

**Researched:** 2026-10-27
**Domain:** OKX allocator-account history rebuild (analytics-service, Python); forced-path balance anchor; OKX v5 bills as an opening-balance oracle; read-only worker probe
**Confidence:** MEDIUM-HIGH (gate mechanics, probe contract, test strategy: HIGH, read from source this session. OKX endpoint semantics: HIGH for documented fields and reach, MEDIUM for the oracle's behaviour on a4, which only the probe can measure. Tolerance: LOW until a4 is measured.)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Carried (not re-asked)
- UPNLVENUES 167.2.1.1 PD-H: a forced rebuild writes only a curve anchored to today's venue equity including open profit; otherwise it fails permanent with a named reason and writes nothing. PD-I: no automatic re-crawl.
- ACCTREBUILD 167.2.1.1.2: OKX window 89 days back; each member anchored to its own `totalEq`; D-01..D-03.
- TRADEPAGES D-05: stored histories stay as recorded.
- NAVMTM D-06, D-09: marks are write-once, start at deploy, never back-filled.
- The forced-refusal vocabulary is a closed, pinned set.

### D-01 Diagnose, then check independently
Founder 2026-10-27, AskUserQuestion: "Diagnose, then check independently (Recommended)".
1. A read-only diagnostic run on a4 on the backfill worker (probe pattern, counts, booleans and 3-significant-figure ratios only: `totalEq / replay_final`, replay sign, non-stable share, `upl / totalEq`, flip-from-flat closes, negative-quantity assets, in-window flows, skipped symbols) measures the cause (SC-1).
2. If the cause is money held before the 89-day window, the implied opening balance (`anchor - replay_final`) is checked against an independent source (OKX bill balances); the rebuild anchors when they agree within a stated tolerance and refuses `anchor_skipped_implausible` when they do not.
3. If OKX cannot supply that independent source, a4 is recorded as a correct refusal with the measured reason.

### Measured 2026-10-27 (PROD, counts only)
`audit_log` `allocator.equity.reconstruct_complete` rows carrying `anchor_offset_implausible`: OKX 2 rows / 2 keys, both false (2026-10-02..10-15); 35 older OKX rows predate the flag. No evidence the refusal is common across OKX accounts, so a4 needs its own reading.

### Claude's Discretion
- The new rule applies to the forced path; whether it also replaces the unforced path's unanchored zero-cash curve is a planner call to state explicitly.
- Anchor stays the live `totalEq` read; stored NAV marks are a later out-of-sample check, not the anchor.
- Tolerance value, chosen from the measurement.

### Deferred Ideas (OUT OF SCOPE)
- Validating rebuilt day shapes against accumulated NAV marks (needs about a week of marks).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were assigned (phase-local success criteria, ROADMAP `### Phase 172`).

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Root cause of a4's `anchor_skipped_implausible` named from a read-only measurement | "How the gate works" (the refusal is exactly `totalEq / replay_final > 6`), "Probe diagnostic design", decision table |
| SC-2 | An OKX account with a correct balance anchors and rebuilds; a truly implausible anchor still refuses by name; tests RED on the old behaviour | "OKX bills as the oracle", "Tolerance", "Validation Architecture" |
| SC-3 | After deploy the probe re-reads a4 and the outcome is recorded | "Sequencing", "Operator step" |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from the root `CLAUDE.md`, the global `CLAUDE.md` and `AGENTS.md` (read this session). Treated as locked.

- Analytics briefs carry CI's mypy line verbatim, run from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. pytest only from `analytics-service/`; never `importlib.reload` in tests (MEMORY).
- No secrets, PROD ids, home paths or account numbers in tracked text (public repo, `.planning/` tracked). Probe output is pasted into tracked files: labels, counts, booleans, tokens and 3-significant-figure ratios only.
- Never run anything against a database from this checkout (the Supabase CLI link is PRODUCTION). The probe reads PROD only through the deployed worker; a phase plan must not run `supabase db query --linked`. Marker query first before any write (this phase has none).
- Tests verify intent: a gate must be able to fail. Neuter, see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). `test_c01_03_implausible_offset_skips_anchor` is exactly the counter-example (see Pitfall 9).
- Data-integrity and user-facing gates: money-math oracles are independent invariants (the bills oracle must not be derived from the code under test).
- Always `grep -a`. A new test file or arm can move several censuses: grep them all (the 15-token pin, the probe's key whitelist, the probe's source pins).
- Never write the CI-skip trailer tokens in a commit message or PR body, even to deny them. No AI-authorship trailers (founder 2026-10-20). Ship writes a CHANGELOG entry and bumps `VERSION`/`package.json` as byte-equal 4-digit strings.
- Agent gates include mypy strict in every analytics-touching brief and pre-push check.
- A ship branch must change nothing under `.planning`; completion is historical (`verified_at_sha` + `drift_subjects`, never `covered_digest`).
- Next.js: AGENTS.md warns about breaking Next.js changes. Not applicable here (no frontend change in this phase).

## Summary

The refusal is a property of the gate, not (yet) of a4's data. `_implausible_anchor = last_value > 0 and abs(offset) > 5.0 * abs(last_value)` where `last_value` is the replay's FINAL value and the replay starts from zero cash at the window start. For a positive anchor (`totalEq` is only returned when `> 0`), the gate fires exactly when `totalEq / replay_final > 6`. So a4's refusal already proves two things without any measurement: the replay ended positive, and `totalEq` is more than six times the replay's result. The gate compares the missing opening balance with the account's in-window profit, not with anything about the account's size, so every funded OKX account whose 89-day replay result is under a sixth of its balance is refused, including one whose anchor is perfectly right. The gate cannot tell "large balance held before the window" (a correct anchor) from "replay lost value" (a wrong one). That is what the independent oracle is for. [VERIFIED: `analytics-service/services/equity_reconstruction.py:3590-3593`]

The "35 + 2 audit rows, both false" evidence is vacuous for OKX. The unforced path starts 730 days back, so on OKX the terminus arm (`hit_terminus`) runs first and the implausible arm is never evaluated; `anchor_offset_implausible` is false by construction. The forced 89-day window (ACCTREBUILD) is the first path on which the 5x gate can execute for OKX at all, so a4 is the first OKX data point, not one of many. [VERIFIED: `equity_reconstruction.py:5506`, `:3607`, `:2373-2374`]

OKX can supply the oracle. `GET /api/v5/account/bills-archive` ("last 3 months") returns, per bill, `bal` ("Balance at the account level") and `balChg` in the bill's own currency, so the oldest bill at or after the window start gives each currency's balance at the window start as `bal - balChg`. Its chain (`bal == previous bal + balChg`) held exactly over 1605 pairs on a real OKX account's archive files in Phase 167.1.2.2.2.1. Limits that make "unavailable" a first-class outcome: the reach is a calendar three months (89..92 days) while the window start is 89..90 days old; the bills cover the trading account only (not the funding account, not strategy-bot equity, not position uPnL at the window start); the oracle excludes the replay's blind spots (perp fees, funding, funding-to-trading transfers). [CITED: okx.com/docs-v5/en (fetched 2026-10-27)] [VERIFIED: `.planning/phases/167.1.2.2.2.1-*/167.1.2.2.2.1-VERIFICATION.md:92`]

**Primary recommendation:** Ship in two steps. Step 1 is a probe-only PR (zero production-path change): a4's gate arithmetic, the replay's shape and the bills oracle reading, as whitelisted counts/ratios, run once on the backfill worker (SC-1). Step 2, conditional on the reading, adds one OKX-only forced-path rule inside the existing anchor block: when the 5x trigger fires, read the bills oracle and anchor only if `|implied_opening - oracle_opening| <= max(1.0, REL * totalEq)`; any other outcome (disagree, unproven reach, unpriced currency, broken chain) refuses with the EXISTING token `anchor_skipped_implausible`. No new token (the vocabulary is closed). Tolerance REL is a named constant chosen from a4's measured residual (SC-2), then the probe re-reads a4 (SC-3).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Anchor decision (anchor / refuse, token choice) | Analytics worker (`services/equity_reconstruction.py`, forced path) | - | Closed-vocabulary refusal lives in `_fetch_and_price_window`; the handler only converts the raised reason |
| Opening-balance oracle read (bills walk, USD conversion) | Analytics worker (new helper beside `fetch_okx_total_equity_and_upl_usd` in `services/exchange.py`, or a new module) | OKX REST (read-only GET) | Venue I/O belongs with the existing OKX readers and `_okx_bills_fetch_with_backoff` |
| Agreement test (tolerance) | Analytics worker, PURE function | - | Pure comparator so the boundary is unit-testable without a venue |
| Read-only diagnostic and its redaction | Worker-side script (`scripts/allocator_history_probe.py`) | Railway backfill worker (egress IP, deployed commit) | Keys are decrypted only in the worker; output is pasted into a public repo |
| Persisted history (replace window write) | Database via the existing `replace_equity_snapshots_window` | - | Unchanged; this phase only changes WHEN rows are produced |
| Operator run of the probe | Founder/orchestrator step on Railway | - | `railway ssh` is broken (TRADEPAGES plan 06); start-command change needs founder approval |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt (async) | `ccxt==4.5.88` pinned [VERIFIED: `analytics-service/requirements.txt:33`] | OKX implicit methods `private_get_account_balance`, `private_get_account_bills_archive` | Already the only OKX client; the repo calls these two implicit methods today [VERIFIED: `services/exchange.py:1527`, `:3040`] |
| pytest + pytest-asyncio | `asyncio_mode = auto` [VERIFIED: `analytics-service/pytest.ini`] | Tests | Existing suite |
| mypy | `mypy==2.4.0` pinned [VERIFIED: `requirements-dev.txt:44`] | CI strict typing | CI gate |

### Supporting (all existing, no install)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `services.exchange._okx_bills_fetch_with_backoff` | Page fetch with 429 backoff for bills calls | The oracle walk (do not re-implement) |
| `services.equity_reconstruction._fetch_ohlcv_daily`, `_read_cached_prices`, `_fetch_coingecko_daily_closes` | Daily close for non-stable currencies | USD conversion at the window start |
| `services.closed_sets.STABLECOINS` = `frozenset({"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"})` [VERIFIED: `services/closed_sets.py:237-239`] | Currencies worth $1 | Same set the replay uses |
| `scripts.bybit_upnl_probe.sig3` / `FIELD_ABSENT` | 3-significant-figure rounding, absent marker | Probe ratios |
| `scripts.allocator_history_probe.emit_record` / `validate_record` | The only path to stdout | Probe record |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `bills-archive` (JSON, 3 months) | `bills-history-archive` quarter files (since Feb 2021, except the current quarter) | Async apply (POST, ccxt cost 72000, about 2 h generation, link is a bearer token), cannot cover the current quarter, unified accounts only. Wrong tool for an 89-day window ending today. Use only if the JSON reach proves too short |
| `bills` (7 days) | - | 7 days of reach cannot reach day 89 |
| Check-only oracle (D-01) | Seed the replay's opening quantities from bills | Seeding changes the curve itself and is the "full fix" the code comment deferred (NEW-C01-11). D-01 chose check-only; seeding is a different phase |

**Installation:** none. **Version verification:** no new package is recommended; ccxt and mypy versions above are the repo's own pins. Local environment differs from CI (local ccxt 4.5.64, mypy 2.0.0, Python 3.14.3 vs CI 3.12 [VERIFIED: `.github/workflows/ci.yml:5481`]); a ccxt cost or behaviour claim made from the local source is tagged local.

## Package Legitimacy Audit

No external package is added by this phase, so no `package-legitimacy check` was needed. The two repo-banned packages (global CLAUDE.md) are irrelevant.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
FORCED REBUILD (job metadata force_rebuild) for an OKX member, 89-day window
  _crawl_account_key ──> _fetch_and_price_window(require_anchor=True)
        │
        ├─ trades (fills-history, 5 instTypes, backward walk) + deposits/withdrawals (asset history = FUNDING account)
        ├─ OHLCV closes ──> _compute_daily_equity  (starts from ZERO cash; replay_final = L)
        ├─ anchor A = totalEq (private_get_account_balance, trading account only)
        │
        ▼ anchor block, elif chain, in THIS order
   terminus? ─yes─> refuse anchor_skipped_okx_terminus
   partial ticker? ─> refuse anchor_skipped_partial_ticker
   unknown/inverse perp? ─> refuse anchor_skipped_unreliable_replay
   L > 0 and |A-L| > 5L  (i.e. A/L > 6) ?
        │ no  ──> spread offset = A - L over every row ──> anchored rows ──> replace window write
        │ yes ──> TODAY: refuse anchor_skipped_implausible
        │         PROPOSED (OKX + require_anchor only):
        │            read bills oracle O  (walk bills-archive, per-ccy opening bal-balChg, USD at close(T0-1d))
        │            implied = A - L ;  agree iff |implied - O| <= max(1.0, REL*A)
        │              agree        ──> spread offset (same code path as "no")
        │              disagree / unavailable ──> refuse anchor_skipped_implausible (existing token)
        │              transient venue error ──> propagate (existing 429 stamp + retry), not a refusal
UNFORCED path: window 730 days ──> OKX terminus arm fires first ──> unanchored, flag pre_terminus_balance_unknown (UNCHANGED)

PROBE (operator step, backfill worker)            reads only; prints whitelisted JSON lines
  _read_member ──> forced read ──raises anchor_skipped_implausible──> [NEW] advisory pass (fresh recorder)
                                                                      + raw balance GET + oracle read
                                                                      ──> ratios/counts/tokens ──> emit_record
```

### Recommended Project Structure
```
analytics-service/
├── services/equity_reconstruction.py   # anchor block: OKX-only branch calls the helpers below (step 2)
├── services/exchange.py                # (or new services/okx_opening_balance.py) bills walk + raw balance details reader
├── scripts/allocator_history_probe.py  # new whitelisted diagnostic keys (step 1)
└── tests/
    ├── test_okx_anchor_oracle.py       # NEW: OKX-shaped tests through _fetch_and_price_window (step 2)
    ├── test_allocator_history_probe.py # extended: new keys, redaction, static pins
    └── test_ana_recon_audit.py         # test_c01_03: rewrite through production or delete
```

### Pattern 1: How the gate works (Q2)

**What (read this session):**
- The trigger, verbatim: `_implausible_anchor = (` / `last_value > 0` / `and abs(offset) > 5.0 * abs(last_value)` / `)` with `last_value = float(rows[-1].get("value_usd") or 0.0)` and `offset = anchor - last_value` [VERIFIED: `equity_reconstruction.py:3582-3593`]. Only `rows and anchor is not None` enters the block (`:3581`).
- The refusal arm order is the `elif` chain at `:3607-3660`: `if hit_terminus:` then `elif anchor_partial_symbols:` then `elif _unreliable_replay:` then `elif _implausible_anchor:` then the anchoring `else`. The forced-path mapping reads the variables the block set, in this order: `anchor is None` -> `anchor_unreadable`; `hit_terminus` -> `anchor_skipped_okx_terminus`; `_anchor_skipped_partial_ticker` -> `anchor_skipped_partial_ticker`; `_anchor_skipped_unreliable_replay` -> `anchor_skipped_unreliable_replay`; `_anchor_skipped_implausible` -> `anchor_skipped_implausible` (`:3675-3688`, spelled `_refusal = "anchor_skipped_implausible"` at `:3686`). So a4 passed the terminus, partial-ticker and unreliable-replay arms.
- Forced vs unforced: `require_anchor=True` additionally (a) reads the anchor with `refuse_unread_positions=True` (a no-op for OKX, whose anchor is the raw `totalEq`, `:3877-3882`) and (b) raises `ForcedRebuildRefusedError(_refusal)` instead of returning rows unanchored (`:3675`). Unforced shipping an unanchored series for any skip arm is the advisory contract.
- The unforced path never reaches the implausible arm for OKX: its `start_date` is `end_date - timedelta(days=BACKFILL_CAP_DAYS)` (`:5506`, `BACKFILL_CAP_DAYS: int = 730`), so `hit_okx_terminus = since_ms < okx_terminus_ms` is true (`:770`, `OKX_TRADE_TERMINUS_DAYS: int = 90`). The forced window is `end_date - timedelta(days=OKX_TRADE_TERMINUS_DAYS - 1)` (89 days, `:2374`), which does not hit the terminus [VERIFIED: `tests/test_reconstruct_force_rebuild.py:652-690`].
- The closed set: `FORCED_REBUILD_ANCHOR_REASONS` = `positions_unreadable`, `anchor_unreadable`, `anchor_skipped_okx_terminus`, `anchor_skipped_partial_ticker`, `anchor_skipped_unreliable_replay`, `anchor_skipped_implausible`; `FORCED_REBUILD_ACCOUNT_REASONS` = `account_state_unreadable`, `account_identity_pending`, `account_key_venue_unsupported`, `account_key_not_working`, `account_key_read_failed`, `account_key_no_rows`, `account_sum_empty`, `account_keys_changed`, `history_days_unreproduced` (`:2188-2210`). 6 + 9 = 15. Pinned by `test_forced_rebuild_refusal_reasons_are_a_closed_set` in BOTH halves plus a raise-site scan: the double-quoted literals passed to `ForcedRebuildRefusedError(` or assigned to `_refusal =` must EQUAL the set [VERIFIED: `tests/test_reconstruct_force_rebuild.py:727-790`]. The probe derives its own vocabulary from the same set (`_SELECTION_TOKENS`, `_REFUSAL_TOKENS`, `scripts/allocator_history_probe.py:123-124`), so adding a token silently widens the probe too. **Recommendation: add no token.**

**Consequences (derived, not measured):**
- Refusal for a positive anchor is exactly `A / L > 6` with `L > 0`. A negative anchor is impossible (`fetch_okx_total_equity_and_upl_usd` returns `eq if eq > 0 else None`, `exchange.py:3061`).
- The gate is blind in two directions: (1) a large, correct pre-window balance beside a small in-window result is refused; (2) `last_value <= 0` is not gated at all, so a negative or zero replay is anchored with any offset. Direction (2) cannot explain a4 (its refusal proves `L > 0`), but it is a hole for "truly implausible still refuses" (Open Question 2).
- The replay is a poor level estimate by construction: it ignores perp fees and funding, models only on-chain FUNDING-account deposits/withdrawals (`ccxt okx fetch_deposits` calls `privateGetAssetDepositHistory` [VERIFIED: ccxt 4.5.64 local source]), never funding-to-trading transfers, nets `side` per symbol (hedge-mode fills mis-net), and treats a closing fill of a position opened before the window as the opening of the opposite position ("flip from flat").

### Pattern 2: OKX bills as the opening-balance oracle (Q1)

**What the docs say** [CITED: https://www.okx.com/docs-v5/en/ , fetched with curl 2026-10-27]:
- `GET /api/v5/account/bills`: "This endpoint can retrieve data from the last 7 days." Rate limit "5 requests per second".
- `GET /api/v5/account/bills-archive`: "This endpoint can retrieve data from the last 3 months." Rate limit "5 requests per 2 seconds". Same request parameters as `bills`: `instType` (optional: `SPOT MARGIN SWAP FUTURES OPTION EVENTS`), `instId`, `ccy` ("Bill currency"), `type`, `subType`, `after` ("records earlier than the requested bill ID"), `before`, `begin`/`end` ("Filter with a begin timestamp `ts`"), `limit` ("maximum is 100"). Response is "sorted with most recent first".
- Response fields used: `bal` "Balance at the account level"; `balChg` "Change in balance amount at the account level" (the 7-day page: "Signed change in account balance for this event, in the currency specified by the ccy field"); `ccy` "Account balance currency"; `billId`; `ts` "The time when the balance complete update"; `from`/`to` for transfers ("6 : Funding account 18 : Trading account"); `posBal` "Balance at the position level"; `pnl`, `fee`.
- `POST /api/v5/account/bills-history-archive` / `GET`: "Apply for bill data since 1 February, 2021 except for the current quarter." Applies POST at 1 request per 10 seconds, file link "expiration of every link is 5 and a half hours", generation about 2 hours, "It is only applicable to the data from the unified account."
- `GET /api/v5/account/balance` "Retrieve a list of assets (with non-zero balance), remaining balance, and available amount in the trading account." `totalEq`: "Total account assets denominated in USD". `details[]`: `ccy`, `eq` ("Equity of currency"), `cashBal` ("Cash balance"), `eqUsd` ("Equity in USD of currency"), `upl`, `stgyEq` ("Total equity allocated to trading bots for the currency. Covers Spot Grid, Futures Grid, Signal Bot, ..."). The docs' own example satisfies `eq = cashBal + upl + stgyEq` (4992.890093622894 = 4850.435693622894 - 7.545600000000006 + 150). Account-level `upl` "Returns empty string in Simple mode and Single-currency margin mode".

**What the repo already parses** (fields kept / dropped): the live bills loop keeps `billId` (pagination and dedupe), `type` (drops funding `"8"`), `pnl`, `fee`, `ts`, and logs `billType`; it DROPS `bal`, `balChg`, `ccy`, `instType` and filters by `instType in [SWAP, FUTURES, SPOT, MARGIN]` on every call, which also excludes bills with a blank `instType` such as transfers [VERIFIED: `services/exchange.py:1449-1475`, `:1597-1614`]. The archive-file reader (`okx_archive_files.py`/`okx_archive_classify.py`) keeps `bal`, `balChg`, `ccy`, per-ccy chain verification, and the USD family `ARCHIVE_USD_FAMILY = frozenset({"USDT", "USDC", "USD"})` (`okx_archive_classify.py:70`); it is quarter-file machinery and is NOT reusable for a live JSON walk without adaptation.

**Measured precedent:** on a real OKX account the archive `bal` chain held across 1605 pairs, 2026-03-31..2026-09-30, and the archive USD-family balance differed from the rolled NAV by 132.22 on 100000 (archive 100000 against rolled NAV 99867.78), about 0.13% [VERIFIED: `.planning/phases/167.1.2.2.2.1-*/167.1.2.2.2.1-VERIFICATION.md:92`]. That is one account, quarter files, a realized-basis NAV; it supports that `bal` is a usable running balance and gives the order of magnitude of agreement, not a tolerance.

**Recommended oracle algorithm (JSON `bills-archive`, GET only):**
1. `T0` = the window start 00:00 UTC in ms (`start_ms` in `_fetch_and_price_window`). The replay's first row is the END of day `window_start`, so the replay's opening instant is `T0` and its price basis is the close of `window_start - 1 day`.
2. Walk `private_get_account_bills_archive` with `{"begin": T0, "limit": "100"}` and NO `instType` and NO `ccy`, paging with `after = oldest billId of the page` until an empty page, through `_okx_bills_fetch_with_backoff`. Bound it with a page ceiling (use the `_TRADE_PASS_PAGE_CEILING` idiom: hit the ceiling -> unavailable, never a partial answer). Omitting `instType` returning every type is [ASSUMED] (docs mark it optional; the probe measures it as a blank-`instType` count).
3. Per `ccy`, take the oldest in-window bill by `(ts, int(billId))`; the ccy's balance at the first such bill's moment is `bal - balChg`. A currency with NO in-window bill held its balance at `T0` unchanged, so its opening is the current `cashBal` from `details[]` (every balance change creates a bill, by the docs' own definition "all transaction records that result in changing the balance").
4. Prove completeness before using the numbers: per ccy `bal == previous bal + balChg` in `(ts, billId)` order (the check `verify_bal_chain` does, `okx_archive_classify.py:353-358`); any break -> unavailable.
5. Prove REACH, the borderline: the window start is 89..90 days old and a calendar "3 months" is 89..92 days (the repo's own reading: `LIVE_REACH_ASSUMED_DAYS: Final[int] = 88`, `okx_archive_job.py:229`). Accept the oracle only if (a) one extra call `{"end": T0, "limit": "1"}` returns a bill (a bill older than `T0` is served, so the reach covers `T0`), or (b) every currency's oldest in-window bill has `bal - balChg == 0` (the account's first-ever bill, so nothing precedes it). Otherwise unavailable (`reach_unproven`).
6. Convert to USD at `T0`: `STABLECOINS` x 1.0; every other ccy x close of `{ccy}/USDT` on `window_start - 1 day` via the replay's own price helpers; a currency that cannot be priced -> unavailable (never a guess, never a 0).
7. `oracle_opening_usd = sum(opening_ccy x px)`.

**What it does NOT cover (so a disagreement can be a model gap, not a wrong anchor):**
- Funding account balances (the balance endpoint and bills are the TRADING account; funding is `/asset/*`). [CITED]
- Strategy-bot equity: `stgyEq` is inside `eq`/`totalEq` but moving money into a bot is a balance change out of the cash balance, so `bal` excludes it. [ASSUMED]
- Open-position unrealized PnL at `T0` (`bal` is a cash balance). [ASSUMED]
- Earn products held outside the trading account; option mark value; borrow (a liability makes a ccy `bal` negative and `totalEq` nets it). [ASSUMED]
- The replay's own blind spots, which are inside `implied = A - L` and are not bills-visible unless corrected: perp fees, funding, funding-to-trading transfers, hedge-mode netting, positions open before `T0`.

### Pattern 3: Probe diagnostic design (Q3)

Constraints read from the probe: the only stdout path is `emit_record` -> `validate_record`, which requires the record keys to EQUAL `ACCOUNT_RECORD_KEYS`, every value to pass its validator in `_ACCOUNT_VALIDATORS`, and `assert_sanitized` (`allocator_history_probe.py:126-153`, `:205-285`). Floats must already be 3 significant figures (`_is_sig3_float`); `sig3` returns the STRING `"non-finite"` for inf/NaN, which `_is_ratio` rejects, so every ratio needs a guarded denominator that yields `FIELD_ABSENT` instead. Logging is switched off for the run (`main`, `logging.disable`).

Static pins in `tests/test_allocator_history_probe.py` that the new code must satisfy: no `.insert(` `.update(` `.upsert(` `.delete(` `.rpc(` `enqueue`; none of `_allocator_key_preflight`, `_crawl_account_key`, `_crawl_whole_account`, `_stamp_429`, `replace_equity_snapshots`, `replace_equity_snapshots_window`, `persist_equity_snapshots` referenced even as an alias; `re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", ...)` must not match (a helper named `net_transfer(` would trip it; `transfers_older_than(` does not); `private_get_trade_fills_history(` must still appear; no `private_(post|put|delete)_`; only the two tables `allocator_equity_snapshots` and `api_keys` named; every `supabase` parameter annotated `ReadOnlySupabase` [VERIFIED: `tests/test_allocator_history_probe.py:760-830`]. New venue calls must therefore be `private_get_*` only.

Recommended mechanics (step 1, zero production-path change): in `_read_member`, catch `ForcedRebuildRefusedError` whose `reason == "anchor_skipped_implausible"`, then run a SECOND advisory pass `er._fetch_and_price_window(client, venue, supabase, window_start, end_date)` (no `require_anchor`) with a FRESH `_TradeRecorder`, plus one raw `private_get_account_balance()` GET and the oracle read. The advisory pass returns the unanchored rows (`rows[-1]["value_usd"]` is `L` because the implausible arm skipped the anchor) and telemetry with `skipped_symbols` and `anchor_offset_implausible`. Pitfall: the existing recorder feeds `trade_calls`/`trades_read`/`first_page_rows`; do not let the second pass double them.

Proposed new account-record keys (all counts, booleans, tokens or sig3 ratios; names are a proposal):

| Reading asked by D-01 | Key | Type | Source |
|---|---|---|---|
| `totalEq / replay_final` | `anchor_over_replay` | ratio or `field-absent` | `A / L`, guarded when `L <= 0` |
| replay sign | `replay_final_sign` | token `positive/zero/negative/absent` | `L` (a4 must read `positive`) |
| non-stable share | `non_stable_share` | ratio | `sum(eqUsd of non-STABLECOINS) / totalEq` from `details[]` |
| `upl / totalEq` | `upl_over_anchor` | ratio (signed) or `field-absent` | account `upl` (empty string in simple/single-ccy mode) |
| flip-from-flat closes | `flip_from_flat_closes` | count | fills with `info.fillPnl != 0` while the replay position for that symbol is flat. The docs: "Returns 0 for opening trades" (`fillPnl`). Needs the in-memory trade list; `info` passthrough is [ASSUMED] |
| negative-quantity assets | `negative_qty_assets` + `breakdown_truncated` | count + bool | negative non-`:PERP` entries of `rows[-1]["breakdown"]`; `_cap_breakdown` can truncate (`__truncated__`) so a lower bound must say so |
| in-window flows | `flow_events_in_window` | count | the recorder's deposits + withdrawals (already collected for `transfers_older_365d`) |
| skipped symbols | `skipped_symbols_count` | count | `telemetry["skipped_symbols"]` |
| implied opening vs bills | `implied_opening_over_anchor`, `bills_opening_over_anchor`, `opening_residual_over_anchor` | ratios | `(A-L)/A`, `O/A`, `(A-L-O)/A` |
| oracle outcome | `opening_check` (`agree/disagree/unavailable`) + `opening_unavailable_reason` (`none/reach_unproven/chain_break/unpriced_ccy/page_ceiling/read_failed`) | tokens | the helper |
| oracle self-check | `bal_over_cashbal` | ratio | newest USDT bill `bal` over `details[].cashBal` (validates the assumption `bal` is cash balance) |
| blind-spot sizes | `bot_equity_share`, `bills_transfer_net_over_anchor`, `hedge_mode_fills` | ratio, ratio, count | `stgyEq` USD share; bills type-1 `balChg` net in window; fills with `info.posSide` in long/short |

The last three rows are optional extras: they size the replay's known blind spots so the tolerance (Tolerance section) is a decision made from a4's own numbers.

**Decision table (SC-1 root cause from the reading):**

| Reading on a4 | Named cause | Next |
|---|---|---|
| `anchor_over_replay > 6` (guaranteed) and `opening_check = agree` | Money held before the window; the 5x gate compares with the in-window result, not the balance | Step 2 anchors a4 |
| `opening_check = unavailable` | Oracle cannot be proven (reach / chain / unpriced) | D-01 step 3: record a4 as a correct refusal with the reason token |
| `disagree` with large `bot_equity_share` or `non_stable_share` | Equity held outside the replay's model (bots, untraded holdings) | Correct refusal, reason recorded |
| `disagree` with `flip_from_flat_closes > 0` or `negative_qty_assets > 0` | Positions open before the window break the replay | Correct refusal; seeding the replay is a separate phase |
| `disagree` with large `bills_transfer_net_over_anchor` | Funding-to-trading transfers the replay cannot see | Planner decides the transfer correction (Tolerance, Tier B) or refuses |

### Pattern 4: Sequencing and the operator step

The tolerance is "chosen from the measurement" (CONTEXT), so measurement precedes the rule. Recommended: PR 1 = probe only (new keys, pure helpers, oracle reader used by the probe only); deploy; operator run on a4; checkpoint where the reading decides D-01 branch 2 or 3. PR 2 (only if branch 2) = the OKX anchor rule + tests; deploy; operator re-run (SC-3). If the reading is branch 3, PR 2 is documentation of a correct refusal plus the booked-entry update.

Operator step: Railway SSH is broken. TRADEPAGES plan 06 ran the probe by temporarily changing the production backfill worker's start command with founder approval and restoring it afterwards; Railway's log view parsed the JSON lines into fields so key order in the pasted record is not the emitter's [VERIFIED: `.planning/phases/167.2.1.1.2.1-*/167.2.1.1.2.1-06-SUMMARY.md:32`]. Plans must model this as a founder-approval checkpoint (the exact start-command string and its restore are the founder's/orchestrator's, not a script in this repo; none is committed). The probe prints JSON lines and exits 0/1/2 (`EXIT_OK/EXIT_FAILED/EXIT_REFUSED`); a4's refusal currently exits 1, so a start command must not depend on exit 0 to restore the service.

### Anti-Patterns to Avoid
- **A new refusal token** for "oracle unavailable": breaks the 15-token pin, the handoff matching and widens the probe vocabulary. Use the existing token and put the reason in the probe record.
- **Running the oracle on every forced OKX crawl:** it would add venue calls and a new failure mode to accounts that anchor today. Keep the 5x gate as the cheap trigger, the oracle as the second opinion.
- **Reading `bills` or the `instType`-filtered loops** for the oracle: 7-day reach, and the filter drops transfers.
- **Changing the unforced path** in this phase (see Open Question 1).
- **Treating a transient venue error as "unavailable":** a 429 after the helper's retries is a transient fault; let it propagate to the existing classification and `_stamp_429`, so the job retries instead of failing permanent.
- **Restating the gate formula in a test** (Pitfall 9).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 429 backoff on bills pages | A new retry loop | `_okx_bills_fetch_with_backoff` (`exchange.py:1378`) | Retries `RateLimitExceeded`/`DDoSProtection` with jitter, re-raises the rest |
| Finite-number parsing of venue strings | `float(x)` | `_finite_float(value, label=...)` (`exchange.py:373`) / `Decimal` | NaN/inf strings and bools are rejected; money values must not be invented |
| Probe output redaction | `print(json.dumps(...))` | `emit_record` + `sig3` | The emitter is the only audited path to stdout |
| USD-family set | A literal `{"USDT",...}` | `STABLECOINS` (replay's set) | One definition; the replay and the oracle must agree on what is cash |
| Daily close prices | A new price fetcher | `_fetch_ohlcv_daily`, `_read_cached_prices`, `_fetch_coingecko_daily_closes` | Same series the replay marks with (the Bybit-only cache write is already neutralised by `ReadOnlySupabase`) |
| Balance-chain completeness | Trusting the walk | The `bal == previous bal + balChg` check idea from `verify_bal_chain` | Proven on real files; a missing bill breaks the next bill of its ccy |
| Fake exchanges for OKX paging | A bespoke trade-page fake | `tests/_trade_pages.VenueTradeBook` | Already models OKX's `until` backward walk |

**Key insight:** every piece except the comparator and the bills-to-opening reducer already exists. The new code is a small pure reducer, a thin I/O wrapper around an existing page-fetcher, and one branch in the anchor block.

## Common Pitfalls

### Pitfall 1: Reading the "2 rows, both false" audit counts as evidence
**What goes wrong:** concluding the refusal is rare for OKX. **Why:** the unforced 730-day OKX path hits the terminus arm first, so the flag is false by construction (`:5506`, `:770`, `:3607`). **Avoid:** treat a4 as the first OKX execution of the 5x arm; do not cite the audit counts as a rate. **Sign:** a plan task that sizes the problem from those rows.

### Pitfall 2: `AsyncMock()` exchanges answer every unset method
**What goes wrong:** a test exchange built from `AsyncMock()` returns a `MagicMock` for `private_get_account_bills_archive`/`private_get_account_balance`, so the anchor reads as unreadable or the oracle "works" on a mock. **Avoid:** set both methods explicitly with dict payloads in every OKX test; the oracle must treat a non-dict reply, a missing `data`, or a non-list as unavailable, never as zero. [VERIFIED: `tests/test_reconstruct_marker_writer.py:155-163` builds `exchange = AsyncMock()`]

### Pitfall 3: The oracle's 429 must not be swallowed or mis-stamped
**What goes wrong:** converting `RateLimitExceeded` into "unavailable" turns a transient fault into a permanent refusal that PD-I forbids retrying. **Avoid:** let `RateLimitExceeded`/network errors propagate (the crawl already stamps and classifies them, `:5257-5259`); only structural gaps (no bill, broken chain, unproven reach, unpriced ccy, ceiling) are "unavailable". Contrast: the archive-file job must NOT stamp (it would open the exchange-wide breaker), but that job is a separate call path.

### Pitfall 4: Window-start instant vs price day
**What goes wrong:** pricing at the close of `window_start` instead of `window_start - 1 day`, or starting the bills walk at the start of the next day. **Avoid:** `T0` = 00:00 UTC of `window_start`; price = close of the previous day; fetch OHLCV one day earlier than the replay does. The replay applies a day's events before that day's close (`_compute_daily_equity`, rows end-of-day).

### Pitfall 5: `last_value <= 0` skips the gate
**What goes wrong:** a "truly implausible" anchor with a non-positive replay is anchored today. **Avoid:** state the scope explicitly (Open Question 2); at minimum add a RED test pinning whichever behaviour the plan chooses.

### Pitfall 6: Reach is borderline at exactly the wrong age
**What goes wrong:** the oracle silently starts at the first served bill, later than `T0`, and reports an opening that is not the opening at `T0`. **Avoid:** the reach proof in the algorithm step 5 (a bill at or before `T0` exists, or the account's first bill has a zero opening); otherwise `reach_unproven`.

### Pitfall 7: Probe record whitelist is a three-place edit plus pins
`ACCOUNT_RECORD_KEYS`, `_ACCOUNT_VALIDATORS` and `_account_record` defaults must change together or `_check_keys`/`validate_record` raise; the existing end-to-end test compares key sets. A `sig3` of an infinite ratio is the string `"non-finite"` and fails `_is_ratio`; guard denominators. A new closed token set needs `_is_one_of`.

### Pitfall 8: Double-counting the recorder on the second pass
The probe derives `trade_calls`, `trades_read`, `first_page_rows`, `okx_passes_ended_full`, `transfers_older_365d` from the recorder. Use a fresh recorder for the advisory pass and compute the new diagnostics from it; keep the account-level counters from the first pass.

### Pitfall 9: The existing "implausible" unit test cannot fail
`tests/test_ana_recon_audit.py::test_c01_03_implausible_offset_skips_anchor` monkeypatches `services.equity_reconstruction._fetch_and_price_window` (the function under test) with a fake whose signature does not even match the real one, monkeypatches `_fetch_current_equity`, then asserts a locally restated copy of the formula (`implausible = last_value > 0 and abs(offset) > 5.0 * abs(last_value)`) on literals 1000 and 50000. No production line executes, so any change to the gate leaves it green [VERIFIED: `tests/test_ana_recon_audit.py:65-101`]. The Bybit-shaped `test_forced_rebuild_refuses_an_implausible_anchor_offset` does exercise the real arm (`tests/test_reconstruct_force_rebuild.py:711-725`) and must stay green as the cross-venue regression pin.

### Pitfall 10: Probe source pin on the word `transfer(`
Any new probe helper whose name ends in `transfer` followed by `(` (for example `net_transfer(`) matches the forbidden-venue-write regex. Name it `transfers_net_...`.

### Pitfall 11: Local tool versions differ from CI
Local ccxt 4.5.64 / mypy 2.0.0 / Python 3.14.3 against CI's 4.5.88 / 2.4.0 / 3.12. Run the mypy line verbatim in the executor brief and treat a local pass as provisional.

## Code Examples

### The pure comparator (step 2; unit-testable at the boundary)
```python
# Skeleton. Names are proposals; REL is a named constant chosen from a4's measured residual.
from typing import Final

OPENING_TOLERANCE_USD: Final[float] = 1.0   # mirrors _BYBIT_UPNL_TOLERANCE_USD (equity_reconstruction.py:3774)
OPENING_TOLERANCE_REL: Final[float] = ...   # SET FROM THE a4 MEASUREMENT, see Tolerance

def opening_agrees(anchor: float, replay_final: float, oracle_opening: float) -> bool:
    implied = anchor - replay_final
    return abs(implied - oracle_opening) <= max(OPENING_TOLERANCE_USD, OPENING_TOLERANCE_REL * abs(anchor))
```

### The bills reducer (pure; operates on already-fetched bill dicts)
```python
# Source of fields: OKX v5 "Get bills details (last 3 months)" response: billId, ts, ccy, bal, balChg.
def per_ccy_opening(bills: list[dict[str, str]]) -> dict[str, Decimal] | None:
    """bal - balChg of each currency's oldest bill by (ts, int(billId)); None when the
    chain (bal == previous bal + balChg, per ccy) breaks or a field is not a finite decimal."""
```

### OKX-shaped test through the real window call (SC-2; RED on the old gate)
```python
# Reuse: tests/test_reconstruct_force_rebuild.py::_okx_exchange / _freeze_now_at / _first_call_trades,
# tests/_trade_pages.VenueTradeBook. Set RAW OKX methods explicitly (Pitfall 2) and do NOT patch
# services.exchange.fetch_okx_total_equity_usd, so the real raw-balance reader runs:
exchange.private_get_account_balance = AsyncMock(return_value={"data": [{"totalEq": "50000", "upl": "0", "details": [...]}]})
exchange.private_get_account_bills_archive = AsyncMock(side_effect=pages)   # bal/balChg consistent with 49000 at T0
rows, hit_terminus, telemetry = await er._fetch_and_price_window(
    exchange, "okx", fake, end - timedelta(days=89), end, require_anchor=True)
assert rows[-1]["value_usd"] == pytest.approx(50000.0)          # anchored; old code raises anchor_skipped_implausible
```
Agreement, disagreement (token `anchor_skipped_implausible`, nothing written), unavailable (empty bills, unproven reach, broken chain, unpriced currency) and a boundary case at exactly the tolerance are separate tests. Replay result must be small and positive (a BTC buy marked up a little, as in the existing Bybit test) so `A / L > 6` holds.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OKX forced rebuild over 730 days | 89-day window, `totalEq` anchor per member | ACCTREBUILD 167.2.1.1.2 | Makes the 5x arm reachable for OKX for the first time |
| Page-length stop on trade reads | Backward `until` walk, empty-page stop | TRADEPAGES 167.2.1.1.2.1 | a4 reads 1282 trades in 22 calls |
| 5x gate as plausibility test | Independent oracle as second opinion (this phase) | proposed | Distinguishes a large correct opening balance from a model error |

**Deprecated/outdated:** the booked TODO line "OKX is rebuilt over 90 days and is not a blocker" (ACCOUNT-REBUILD-BLOCKERS) is superseded for accounts whose balance exceeds six times their in-window result.

## Tolerance (Q6)

Precedents in the repo:
- `_BYBIT_UPNL_TOLERANCE_USD: Final[float] = 1.0` and `_BYBIT_UPNL_TOLERANCE_REL: Final[float] = 0.005`, used as `max(USD, REL * abs(wallet))` for two sequential REST reads of the same quantity [VERIFIED: `equity_reconstruction.py:3774-3775`, `:3977-3979`]. Same shape recommended here.
- `okx_archive_reconcile.TOLERANCE_USD = Decimal("0.01")`: a per-day per-leg cent for two readings of one ledger. Not applicable to a level that carries model error.
- The measured bills-vs-rolled-NAV reading of about 0.13% (above). A reading, never a gate (D-13 there).
- The 5x ratio itself (500% of the replay's final value).

Why 0.5% is likely too tight here: `implied = A - L` carries every replay blind spot (perp fees, funding, position MTM at `T0`, funding-to-trading transfers), none of which is a rounding artifact. Why a ceiling is needed: a level error of fraction `e` of the opening balance shifts every anchored day by about `e` x balance, so each daily return and drawdown is wrong by about the same fraction at first order [ASSUMED reasoning]. Recommendation: `max(1.0, REL x A)` with `REL` set to the smallest round value at least twice a4's measured `|opening_residual_over_anchor|`, and not above 5%; the constant, its measurement date and the a4 residual go in the constant's comment. A single account is a thin basis: the plan should say so and record that a second OKX account is unmeasured. Tier B (only if a4 shows transfers dominating the residual): correct `implied` by the bills' type-1 funding-to-trading net and the replay's own USD-valued in-window deposits/withdrawals before comparing.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `bills-archive` `bal` is the trading-account cash balance of the bill's ccy and its chain is exact (measured exact on quarter FILES, not on the JSON endpoint) | Oracle | Oracle disagrees spuriously; the probe's `bal_over_cashbal` and chain check measure it |
| A2 | Omitting `instType` returns every bill type including transfers | Oracle | Walk misses bills; chain breaks -> unavailable (fail closed) |
| A3 | `bills-archive` reach covers a window start 89..90 days old | Oracle | Oracle unavailable for every account; D-01 branch 3 |
| A4 | `begin`/`end` filters are inclusive on `ts` | Oracle | Off-by-one bill at `T0`; chain check would catch a missing bill |
| A5 | Strategy-bot equity and position uPnL at `T0` are not in `bal` | Oracle limits | Wrong cause named for a disagreement |
| A6 | ccxt trade `info` passes `fillPnl` and `posSide` through | Probe | Flip-from-flat and hedge-mode counts unavailable (report `field-absent`) |
| A7 | A level error of fraction `e` distorts returns by about `e` | Tolerance | Ceiling too loose or too tight |
| A8 | Hedge-mode netting is a real replay hazard on OKX | Pattern 1 | Extra probe key unused |
| A9 | The likeliest cause of a4's refusal is large pre-window money (H1) | Summary | Decision table covers the alternatives; unmeasured until the probe runs |
| A10 | ccxt 4.5.88 costs for `account/bills-archive` match local 4.5.64 (4; `bills` 2; `balance` 2) | Rate | Longer walk time only |

## Open Questions

1. **Does the OKX forced rule also replace the unforced path's unanchored zero-cash curve?** (CONTEXT: planner call, state explicitly.) What we know: the unforced path always clamps at the terminus and ships an unanchored series flagged `pre_terminus_balance_unknown`; its window is 730 days, beyond bills reach. Recommendation: NO. Leave it unchanged and say so (PD-B, TRADEPAGES D-05, history depth 3 months stays a stamped fact).
2. **Should an OKX forced crawl with `last_value <= 0` also run the oracle?** What we know: the gate skips it; a4 is not that case. Recommendation: out of scope for the a4 fix, but pin current behaviour with a test and book a follow-up if the plan leaves it.
3. **Tier B transfer correction?** Decide at the checkpoint from a4's `bills_transfer_net_over_anchor`.
4. **Which instant reads the oracle's "current" balances** (for ccys with no in-window bill)? The anchor's `totalEq` and `details[].cashBal` should come from ONE `private_get_account_balance` response to avoid two reads seconds apart; the existing reader discards `details`, so add a sibling reader that returns the row and keep `fetch_okx_total_equity_usd` a thin delegate (the pattern `fetch_okx_total_equity_and_upl_usd` already follows).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 | tests, mypy | yes | 3.14.3 (CI 3.12) | - |
| pytest suite | all tests | yes | `3 passed` on `-k "implausible or closed_set or terminus"` this session | - |
| mypy | CI line | yes | 2.0.0 (pin 2.4.0) | CI is authoritative |
| ccxt | OKX methods | yes | 4.5.64 local (pin 4.5.88) | - |
| Railway CLI | operator step | present (`railway` on PATH) but `railway ssh` is known broken | - | Backfill-worker start-command change with founder approval (TRADEPAGES precedent) |
| Database / PROD access | none from this checkout | not used | - | Probe reads PROD only inside the worker |

**Missing dependencies with no fallback:** none. The operator run needs the founder's approval (a PROD service setting).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest, `asyncio_mode = auto` (`analytics-service/pytest.ini`) |
| Config file | `analytics-service/pytest.ini` |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_reconstruct_force_rebuild.py tests/test_allocator_history_probe.py tests/test_okx_anchor_oracle.py -x -q` |
| Full suite command | `cd analytics-service && python3 -m pytest -q` (duration unmeasured here; CI shards) plus the verbatim mypy line from the constraints |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | Probe record carries the new keys; amounts and ids cannot reach stdout; ratios are 3 s.f.; infinite ratios become `field-absent`; second pass does not double the counters | unit + end-to-end through `hp.run()` | `python3 -m pytest tests/test_allocator_history_probe.py -x -q` | extend (file exists) |
| SC-1 | Static pins still hold (no writer, GET only, two tables, wrapper-typed handles) | unit | same | exists |
| SC-2 | OKX member with a correct opening balance anchors through the REAL `_fetch_and_price_window` (raw `private_get_account_balance` + bills fakes); RED on the old gate | unit | `python3 -m pytest tests/test_okx_anchor_oracle.py -x -q` | Wave 0 |
| SC-2 | Oracle disagreement refuses `anchor_skipped_implausible`; boundary at exactly the tolerance; unavailable variants (empty, unproven reach, chain break, unpriced ccy, ceiling, non-dict reply) each refuse; transient `RateLimitExceeded` propagates | unit | same | Wave 0 |
| SC-2 | Unforced OKX path makes NO bills call and is unchanged; Bybit forced implausible arm unchanged | unit | `python3 -m pytest tests/test_reconstruct_force_rebuild.py -k "implausible or okx" -q` | exists |
| SC-2 | Closed 15-token pin and raise-site scan still equal | unit | `python3 -m pytest tests/test_reconstruct_force_rebuild.py -k closed_set -q` | exists |
| SC-2 | `test_c01_03` replaced by a test that calls production, or deleted | unit | `python3 -m pytest tests/test_ana_recon_audit.py -k c01_03 -q` | rewrite |
| SC-2 | Mutation proof: each rule arm can fail | neuter-and-restore | by hand per plan | per plan |
| SC-3 | Probe re-read of a4 recorded | operator checkpoint | n/a | n/a |

Mutations the plan should run (neuter, see RED, restore from a byte backup): (N1) oracle verdict forced to `agree` -> the disagree/unavailable tests go RED; (N2) oracle skipped (old behaviour) -> the anchors-when-correct test goes RED; (N3) tolerance widened to infinity -> the boundary test goes RED; (N4) unavailable mapped to `agree` -> each unavailable variant goes RED; (N5) `RateLimitExceeded` swallowed -> the propagation test goes RED; (N6) probe emitter accepts an unrounded float -> the redaction test goes RED.

### Sampling Rate
- **Per task commit:** the quick run command above.
- **Per wave merge:** the full suite and the mypy line.
- **Phase gate:** full suite green, the probe output pasted from the worker, and the SC-3 outcome recorded before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_okx_anchor_oracle.py` - SC-2 (new)
- [ ] OKX raw-balance and bills-archive fakes (a small helper beside `_okx_exchange`, reusing `VenueTradeBook`)
- [ ] Extend `tests/test_allocator_history_probe.py` for the new keys (its `_Services` fake already supplies the venue stub)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Keys are decrypted only in the worker (`decrypt_credentials`); no new auth |
| V4 Access Control | yes (operator) | Read-only exchange keys, GET-only calls, `ReadOnlySupabase`; start-command change is a founder-approved checkpoint |
| V5 Input Validation | yes | Venue JSON is untrusted: `_finite_float`/`Decimal`, reject bool/NaN/inf, non-dict/non-list replies are unavailable |
| V7 Error handling and logging | yes | Static refusal text, `scrub_freeform_string` on any logged exception text, no amount in a log line or a probe record |
| V8 Data protection | yes | Probe output is pasted into a public repo: closed vocabulary, 3-significant-figure ratios, no id/amount/date finer than the run date |
| V13 API | yes | Respect `bills-archive` 5 requests / 2 s; page ceiling; never POST `bills-history-archive` from the probe (static pin) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account size leaked through the probe output | Information disclosure | `emit_record` whitelist, `assert_sanitized`, ratios only; guard divisions so no raw figure is the only representation |
| Poisoned/garbled venue number becomes a published level | Tampering | Finite-decimal parse, chain check, fail closed to the existing refusal |
| Unbounded bills walk | Denial of service | Page ceiling, per-crawl wall-clock bound already wraps the crawl (`_RECONSTRUCT_CRAWL_TIMEOUT_S`) |
| 429 on the oracle opens a breaker for normal syncs | Denial of service | Propagate through the existing classification; do not add a second stamp path |
| Signed URL / HMAC in exception text | Information disclosure | Log class + scrubbed text only; the probe prints the exception TYPE only |

## Sources

### Primary (HIGH confidence)
- Repo source read this session: `analytics-service/services/equity_reconstruction.py` (anchor block `:3564-3740`, refusal set `:2174-2213`, windows `:2357-2377`, `_fetch_current_equity` `:3838-3988`, `_compute_daily_equity` `:1116-1547`, unforced start `:5495-5510`, forced crawl `:5219-5262`), `services/exchange.py` (`:1368-1650`, `:2993-3139`), `scripts/allocator_history_probe.py` (whole), `tests/test_allocator_history_probe.py`, `tests/test_reconstruct_force_rebuild.py`, `tests/test_ana_recon_audit.py:65-101`, `services/okx_archive_classify.py`, `services/okx_archive_job.py`.
- `.planning/phases/167.1.2.2.2.1-*/167.1.2.2.2.1-VERIFICATION.md:92` and `167.1.2.2.2.1-14-SUMMARY.md:36,40` (real `bal` chain and the 0.13% reading); `.planning/phases/167.2.1.1.2.1-*/167.2.1.1.2.1-06-SUMMARY.md` (a4 probe record, operator path); `TODOS.md` entries `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE`, `...-OKX-ORDER-UNMEASURED`.

### Secondary (MEDIUM confidence)
- [CITED: https://www.okx.com/docs-v5/en/] OKX API v5 docs fetched with curl on 2026-10-27 and read from the saved text: Trading Account > Get balance; Get bills details (last 7 days); Get bills details (last 3 months); Apply/Get bills details (since 2021); Get account configuration. Quotes in Pattern 2 are verbatim.
- ccxt 4.5.64 local source: `okx.py` cost table and `fetch_deposits` endpoint (local, pin is 4.5.88).

### Tertiary (LOW confidence)
- Reasoning marked [ASSUMED] in the Assumptions Log (tolerance scaling, hedge-mode hazard, bot equity outside `bal`).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new package; every helper named was read in the repo.
- Architecture (gate mechanics, refusal order, probe contract): HIGH - read from source with line ranges.
- OKX oracle behaviour on a4: MEDIUM - documented fields and a real-file precedent, but the JSON endpoint's reach and `bal` semantics for a4 are unmeasured.
- Tolerance: LOW - a single account is the basis; value is deferred to the measurement.
- Pitfalls: HIGH for 1-3, 5, 7-10 (code-verified); MEDIUM for 4, 6.

**Research date:** 2026-10-27
**Valid until:** 2026-11-03 for line numbers (re-measure `grep -n` anchors at plan time; the file moves with every phase), 30 days for the OKX doc quotes.
