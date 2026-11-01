# Phase 184: WALLETOFFSET - Research

**Researched:** 2026-11-01
**Domain:** read-only exchange-history measurement script run inside the Railway worker (OKX, Bybit; Binance and sFOX only if marked keys exist); first-mark base arithmetic of the NAVMTM marks applier
**Confidence:** HIGH on the codebase mechanics (every in-repo claim below was read this session), MEDIUM on venue retention facts (official docs, partly via the repo's own re-reads), LOW on anything tagged `[ASSUMED]`

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 - Book a measure phase** (founder 2026-11-01, AskUserQuestion on NAVMTM 167.2.1.1.1 D-27: "Book a measure phase" - "Book a phase that rebuilds the realized P&L for that window from fills and measures the offset."): the offset on OKX, Bybit, Binance and sFOX is measured from fills and trade history for the first-mark window, per key, as a ratio of NAV. Until it reports, those four venues keep the wallet base.

Founder rules carried (not re-asked):
- **NAVMTM D-25** (restated in the ROADMAP entry): MT5 and Deribit moved to the writer-chain base (G-01, PR #1166). Out of scope here.
- **NAVMTM D-27** (restated in the ROADMAP entry): OKX, Bybit, Binance and sFOX keep the wallet base, because the wallet is final on OKX (NAVMTM REVIEW CR-01). Their pre-mark levels sit off the realized chain by the first-mark offset; any material offset goes back to the founder with the numbers.
- PROD reads are authorized (founder memory). This phase still WRITES nothing anywhere: no PROD row, no TEST row, no exchange order or transfer.
- Never invent data: a key whose window cannot be rebuilt is reported as unmeasurable with its reason, never as zero.
- Public repo: the readout carries counts and ratios only, never key ids, account ids, user ids or amounts.

Shape the orchestrator set for the plans (not a founder decision):
- The measurement needs exchange reads with the stored keys, so it is a read-only script the orchestrator executes inside the Railway worker (the plan carrying it is `autonomous: false`). It prints counts and ratios only.
- A final plan is the founder readout: the numbers go to the founder, and the decision is recorded in this CONTEXT and in the ROADMAP entry (SC-2).
- Analytics plans carry CI's mypy line verbatim: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`.

### Claude's Discretion
- How the window's realized P&L is rebuilt per venue (which fills / bills / closed-P&L endpoints, and how fees and funding enter), as long as research shows each term's source and the script states which terms it summed.
- Where the mark read instant for a key's first mark comes from (stored `key_inputs` timing or the worker's own reading), as long as research names the column or log it reads.
- Whether the script lives under `analytics-service/scripts/` beside the other read-only probes (`okx_chain_record.py`, `bybit_reconcile.py`, `mt5offset_dry_run.py`), and how its arithmetic is unit-tested offline.

### Deferred Ideas (OUT OF SCOPE)
- Binance and sFOX have no keys with inputs as of 2026-11-01. If that still holds when the script runs, the readout states them as "no marked keys, not measured" and the founder decides whether they wait for a later reading.
- Any writer-chain base for a wallet-base venue is a follow-up, booked from the readout, not built here.
- NAVMTM G01-REVIEW WR-01 (MT5 credit deals) stays conditional where NAVMTM left it; not in this phase.

Open questions CONTEXT leaves to the founder (not decided here): what ratio is material; per key or per venue; unmeasurable keys; Binance and sFOX waiting; whether the P&L part and the flow part are stated separately.
</user_constraints>

<phase_requirements>
## Phase Requirements

No REQUIREMENTS.md IDs apply (phase-local success criteria).

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Per key, the first-mark offset as a ratio of NAV, rebuilt read-only from fills/trade history for the first-mark window, recorded with counts and ratios only | Sections "What the offset is", "Per-venue read sources", "Standard Stack", "Code Examples" |
| SC-2 | Founder gets the numbers and decides; decision recorded in CONTEXT and ROADMAP | "Plan shape" (readout plan), "Open Questions" |
| SC-3 | No published number changes unless the founder decides so | "Read-only enforcement", "Validation Architecture" (static pins), "Security Domain" |
</phase_requirements>

## Summary

The stored marks are NOT in the `key_inputs` rows. They live in `public.api_key_nav_marks`: one write-once row per key per UTC day, with `marked_at` (the instant the worker finished its equity read), `mark_day` (= UTC date of `marked_at` minus one), `nav_usd`, `open_pnl_usd` and `venue`. The first mark of a key is its minimum `mark_day`; its read instant is `marked_at` of that row; its wallet is `nav_usd - open_pnl_usd`. The `key_inputs:<api_key_id>` rows are `allocator_equity_derived` rows whose payload holds `realized_terminal_usd` / `realized_terminal_day`; for a marked key the derive overwrites the terminal with the last mark (`_realized_terminal = (_pandas.Timestamp(_last_mark_day), float(_last_mark_nav))` (job_worker.py:8254)), which is why `realized_terminal_usd` equals the mark NAV and cannot give the offset.

The offset is the amount the first mark's WALLET holds that the realized chain does not yet hold at the day boundary. The marks applier (`apply_marks`) takes the base of the first marked day from the mark's own wallet rolled back through day S's realized return and flow (`base0 = (wallet - flow_s) / factor`), but the wallet was read at `marked_at`, about 5.5-6.7 h into the NEXT UTC day. So the window is `[floor_to_utc_midnight(marked_at), marked_at]`, and the offset is the chain-defined realized P&L plus the flows dated in it. Flows made in that window are ALREADY moved into the mark day and removed from the base by rule 10 (`placed_flow_instants`), so the part of the offset that actually mis-states the base is the realized P&L part; the readout should state P&L and flows separately (this answers CONTEXT open question 5 with code evidence).

Rebuild the P&L with the SAME sources the chain books, so the quantity is the chain's own: OKX account bills (`pnl + fee`, funding bills `type == "8"` taken from `pnl`), Bybit closed-pnl rows reconstructed ex-funding plus `SETTLEMENT` funding rows from the transaction log, flows from the worker's own `fetch_ccxt_transfers` + `ccxt_rows_to_dated_flows(instants=...)`. Pattern the script on `scripts/allocator_history_probe.py`: a `ReadOnlySupabase` handle, `decrypt_credentials` + `_make_exchange_client`, a whitelist `emit_record` with `sig3` ratios, `logging.disable`, run on the backfill worker through a temporary start-command wrapper (`railway ssh` is known broken). Today is 2026-11-01 and the first marks were read on 2026-10-27: the OKX 7-day bills endpoint (`/account/bills`) no longer covers the window from about 2026-11-03, so read `/account/bills-archive` (last 3 months) only.

**Primary recommendation:** Build `analytics-service/scripts/walletoffset_probe.py` (pure arithmetic + I/O layer in one file, like the probes), reading `api_key_nav_marks` and `api_keys` through a select-only handle, one OKX bills-archive walk and one Bybit closed-pnl + transaction-log window per key, printing one whitelisted JSON record per key plus a summary; unit-test the arithmetic and a planted-value no-leak test offline; run it once on the worker in an `autonomous: false` plan after its PR is merged and deployed; then a readout plan.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Find each key's first mark (day, read instant, NAV, open P&L) | Database (select only via worker service role) | Worker script | `api_key_nav_marks` is the only store of marks; `service_role` holds SELECT |
| Decrypt stored credentials, build the venue client | Worker process | - | KEK exists only in the worker env; `decrypt_credentials` + `_make_exchange_client` |
| Read bills / closed-pnl / funding / transfers for the window | Worker -> venue API (GET only) | - | Keys are IP-restricted to the worker's egress; no other host can read |
| Offset arithmetic (P&L + flows, ratio to NAV) | Pure Python layer in the script | - | Unit-testable offline; no I/O |
| Redaction and printing | Script's `emit_record` whitelist | Static test pins | Output is pasted into a tracked public file |
| Founder decision (material? which venue moves?) | Founder via orchestrator readout plan | - | SC-2; nothing in code decides it |

## Standard Stack

No new packages. The script uses what the worker image already ships.

### Core
| Library / module | Version | Purpose | Why Standard |
|------------------|---------|---------|--------------|
| `ccxt` | 4.5.89 [VERIFIED: analytics-service/requirements.txt:33 `ccxt==4.5.89`] | venue clients via `services.exchange.create_exchange` | the worker's one client path |
| `pandas` | 3.0.3 [VERIFIED: requirements.txt:156] | not needed by the arithmetic; avoid importing it in the pure layer | keep the layer stdlib-only |
| `services.job_worker._make_exchange_client` | in-repo | one chokepoint building ccxt / SfoxClient | used by `allocator_history_probe._probe_member` |
| `services.encryption.get_kek`, `decrypt_credentials` | in-repo | decrypt `api_keys` rows inside the worker | same call shape as the existing probe |
| `scripts.allocator_history_probe.ReadOnlySupabase` | in-repo | handle exposing `table().select` only | closes the price-cache write hidden in shared readers |
| `scripts.bybit_upnl_probe` (`sig3`, `FIELD_ABSENT`, `FAILURE_CLASSES`, `classify_failure`) | in-repo | 3-sig-fig rounding, allow-listed failure classes | the probes' shared redaction vocabulary |
| `scripts.deribit_ground_truth.assert_sanitized` | in-repo | second-line redaction check | every probe's `emit_record` calls it |
| `services.nav_marks.read_key_marks`, `StoredMark` | in-repo | paginated read of a key's marks (works through the select-only handle) | no second marks reader |
| `services.funding_fetch.fetch_funding_bybit` | in-repo | Bybit `SETTLEMENT` funding rows (7-day windows, `since_ms`) | the chain's own funding source |
| `services.ccxt_flow_fetch.fetch_ccxt_transfers`, `services.ccxt_flows.ccxt_rows_to_dated_flows` | in-repo | the chain's own flow rows and valuation, `instants=` gives per-row instants | SC-1 flow term |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `services.okx_opening_balance._okx_bills_fetch_with_backoff` (from `services.exchange`) | in-repo | one bills page with 429 backoff | every OKX bills page |
| `services.okx_bills_chain.BudgetedExchange` | in-repo | GET-only counted view (`_GET_PREFIX = "private_get_"`, `CHAIN_CALL_CEILING = 120`) | wrap the OKX/Bybit raw GET calls; it refuses non-`private_get_` names |
| `tests/_okx_bills.py` (`okx_bill`, `OkxBillsArchive`) | in-repo | OKX bills-archive fake honouring `after`, `begin`, `end`, `limit` | extend ADDITIVELY with `pnl`/`fee` params (its docstring sets that precedent) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Chain-defined sources (bills / closed-pnl) | A venue wallet ledger delta (OKX `balChg`, Bybit transaction-log `change`) | Wallet-faithful, but needs multi-currency USD pricing and measures a different quantity than "off the realized chain"; keep as a follow-up, not this phase |
| New walker for OKX bills | `okx_opening_balance.walk_okx_bills_archive` | That walker's `_parse_bill` drops `pnl` and `fee` (reads `billId, ts, ccy, bal, balChg, type, instType, subType, mgnMode, posBalChg`), so it cannot sum P&L; copy its no-`begin`, `after`-paged, stop-on-older-bill structure instead |

**Installation:** none. **Package Legitimacy Audit:** this phase installs no external package; `npm view` / `pip index` checks are not applicable and the audit table is omitted. Nothing in `requirements.txt` or `requirements-dev.txt` changes. Banned packages in the global CLAUDE.md are untouched.

## What the offset is, in the codebase's own terms

1. **Where the marks are.** `public.api_key_nav_marks` [VERIFIED: supabase/migrations/20261029120000_api_key_nav_marks.sql]. Verbatim columns: `api_key_id UUID`, `allocator_id UUID`, `mark_day DATE`, `marked_at TIMESTAMPTZ`, `venue TEXT`, `nav_usd NUMERIC`, `open_pnl_usd NUMERIC`, `nav_native`, `open_pnl_native`, `native_unit`, `price_day`, `native_detail`, `created_at`. Unique `(api_key_id, mark_day)`; `CHECK (mark_day = (marked_at AT TIME ZONE 'UTC')::date - 1)`; `CHECK (venue IN ('okx', 'bybit', 'binance', 'deribit', 'mt5', 'sfox'))`. Column comment: "The instant OUR worker read the equity (not the venue's timestamp). A retry later the same UTC day records its real time (D-11)." The Python reader is `services/nav_marks.py` `MARKS_TABLE = "api_key_nav_marks"`, `_STORED_COLUMNS = "mark_day,marked_at,venue,nav_usd,open_pnl_usd,nav_native,open_pnl_native,native_unit"`, `read_key_marks(supabase, api_key_id) -> list[StoredMark]` ascending by `mark_day` (first element is the first mark) [VERIFIED: nav_marks.py:104-141, 467-494]. `service_role` holds SELECT and INSERT only [VERIFIED: migration header, "service_role holds SELECT and INSERT only"].
2. **First mark day and read instant.** First mark = min `mark_day` for the key (`read_key_marks(...)[0]`; key mode applies ALL stored marks, `_marks_to_apply: list[StoredMark] = _stored_marks`, job_worker.py:7870). Read instant = that row's `marked_at`. Mark NAV = `nav_usd`, wallet = `nav_usd - open_pnl_usd` (`wallet = navs[0] - open_pnls[0]`, nav_marks_apply.py:388). The mark is labelled the day that just closed: `mark_day_for(marked_at)` = UTC date of `marked_at` minus one day [VERIFIED: nav_marks.py:205-214].
3. **Why wallet base leaves an offset.** For every venue outside `WRITER_BASIS_VENUES: Final[frozenset[str]] = frozenset({"deribit", "mt5"})` (job_worker.py:355), `apply_marks` is called without `writer_terminal`, so the base is the mark's wallet rolled back one day: `base0 = (wallet - flow_s) / factor` with `factor = 1.0 + r_s` (nav_marks_apply.py:385-399; `if parsed_terminal is not None:` takes the writer branch, else the wallet branch). The wallet was read hours into day S+1 but is treated as the end-of-S level. These venues' key-mode derive reaches the final `else:` of the strategy-vs-key base selection with `_apply_writer_terminal = None` and no log line (the final `else:` of the base selection at job_worker.py:8088-8125 and the `_apply_writer_terminal: tuple[str, float] | None = None` declaration at 7916); `_warn_wallet_base_fallback` (job_worker.py:756-771) is called only where a WRITER venue has no terminal to roll (key mode at 7975, allocated twin 8045, strategy Deribit 8071, strategy MT5 8107, composite 10641 and 10863). So there is no existing log that counts OKX/Bybit wallet-base uses; the wallet base is silent by design (apply_marks docstring: "THE MARK'S WALLET (every other caller: OKX, Bybit, Binance and sFOX keys and strategies ...) ... (review CR-01)").
4. **Definition to compute.** With `R = marked_at` and `B = floor_to_utc_midnight(R)` (the boundary between day S and day S+1; ROADMAP: "mark reads land about 5.5-6.7 h after the boundary"):

   `offset_usd = pnl_window_usd + flow_window_usd`, over events with `B <= t <= R`

   `offset_over_nav = offset_usd / nav_usd` (the Goal's ratio of NAV) and, as a second printed ratio, `offset_over_wallet = offset_usd / (nav_usd - open_pnl_usd)` (the base-level error a writer-chain base would remove). Positive means the wallet at the read holds more than the end-of-S chain level, so the wallet base is too high and the first marked return is understated by about `offset / base` (derived from `ret = (nav - base - F) / base`, nav_marks_apply.py first-row loop). Compute `B` from `marked_at` itself, not from `mark_day`, so the script cannot be off by a day: `mark_day = date(marked_at) - 1`, hence `B = midnight of mark_day + 1`. The Goal text "UTC midnight of the first mark day" is ambiguous (label S would be a 24 h+ window); the ROADMAP evidence "about 5.5-6.7 h after the boundary" fixes the reading above [ASSUMED: A2, confirm in the readout].
5. **Flows are already placed.** Rule 10: a flow dated the read day (`mark_day + 1`) and made at or before `read_at` is counted in the mark day and its day-S+1 amount is removed (`placed_flow_instants`: `fi.day == read_day and fi.at_ms / 1000.0 <= read_s`, nav_marks_apply.py:246-258; `flows[md] = flows.get(md, 0.0) + amount` and `flows[md + 1 day] = ... - moves_out[md]`, 361-371). `flow_s = flows.get(start, 0.0)` therefore already includes them, and `base0` removes them. Consequence for the readout: the flow part of the window is bookkeeping the base already handles (for ccxt flows, whose `instants` are supplied: `ccxt_rows_to_dated_flows(..., instants=_event_flow_instants)`, job_worker.py:7481-7485); the part of the offset that mis-states the base is the P&L part (plus any flow that has no instant). Print `pnl_ratio` and `flow_ratio` separately, and the sum.
6. **What stored rows cannot give.** The pre-mark returns are stored per day; realized rows on or after S are dropped (apply_marks rule 6). Nothing stores the chain's level at the S/S+1 boundary, so the window must be rebuilt from the venue. [VERIFIED: nav_marks_apply.py module docstring rules 3, 5, 6, 10.]

## Per-venue read sources (what the chain books, so what the script must sum)

The key-mode chain is `fetch_all_trades(exchange, since_ms=None)` (-> `fetch_daily_pnl`) + `fetch_funding_<venue>` + flows from `fetch_ccxt_transfers` (job_worker.py:7285-7490; `services/exchange.py` `fetch_daily_pnl` from line 1421). Each term below states its source, sign and day key.

### OKX
| Term | Source | Rule the chain applies | Script reading |
|------|--------|------------------------|----------------|
| Trading P&L + fees | `GET /api/v5/account/bills*`, per bill `pnl + fee` | bills of `type != "8"`, `pnl_val = _pnl_raw + _fee_raw`, day = UTC day of `ts` (exchange.py:1595-1620; `_OKX_FUNDING_BILL_TYPE = "8"` at 1595, `pnl_val = _pnl_raw + _fee_raw` at 1614) | sum `pnl + fee` of window bills with `type != "8"` and a stablecoin `ccy` |
| Funding | same bills, `type == "8"` | amount is the bill's `pnl` (funding_fetch.py `fetch_funding_okx`: `amount_raw=item.get("pnl")`) | sum `pnl` of window bills with `type == "8"` |
| Flows | `fetch_deposits` / `fetch_withdrawals` (funding-account history, external only) | `ccxt_rows_to_dated_flows(rows, venue="okx", price_index=..., instants=...)`; OKX rows are all external | window rows only, `at_ms` in `[B, R]` |
| Diagnostic count | bills with `type == "1"` (transfers funding<->trading) | not a chain flow | count only: the wallet can move without a chain flow |

- **Endpoint choice (retention).** `/account/bills` "can retrieve data from the last 7 days"; `/account/bills-archive` "can retrieve data from the last 3 months" (both 100 rows a page, newest first, `after` paginates by bill id, `begin`/`end` filter on `ts`) [CITED: https://www.okx.com/docs-v5/en/ (Trading Account > Get bills details last 7 days / last 3 months)]. The window is about 6 days old on 2026-11-01, so the script must read ONLY `private_get_account_bills_archive` (the repo itself calls it "last 3 months", okx_opening_balance.py docstring). Do not call `fetch_funding_okx(since_ms=<recent>)`: it reads the archive only when `since_ms` is older than 90 days (funding_fetch.py `need_archive`), so a recent `since_ms` reads the 7-day endpoint and silently loses funding once the window is older than 7 days.
- **Walk shape.** Copy `walk_okx_bills_archive`'s structure (okx_opening_balance.py:256-295): no `begin` (a begin-bounded reply can be oldest-first and hide the newest bills, Phase 172 round 1, recorded in 179-RESEARCH), no `instType` or `ccy` filter (a blank-`instType` transfer must be read), page by `after = min billId`, stop only when a bill with `ts < B` is served (proof the window is complete), `reach_unproven` otherwise, a page ceiling (`BILLS_ARCHIVE_PAGE_CEILING = 500`) that returns "unmeasurable", never a partial sum. Keep `pnl`, `fee`, `ccy`, `type`, `ts`, `billId`; dedupe by `billId`. Every page through `_okx_bills_fetch_with_backoff` (retries only `RateLimitExceeded` / `DDoSProtection`; rate limit 5 requests per 2 s on the archive [CITED: OKX docs]).
- **Archive lag.** The archive can trail the 7-day store by up to a day (179 recorded `chain_archive_behind` buckets); the window must be at least a day old when read. [ASSUMED: A8; true for any run after 2026-10-29.]
- **Fills.** `private_get_trade_fills_history` exists in the codebase (`allocator_history_probe._okx_order_reading`, last 3 months) and carries `fillPnl` / `fee`, but it is not the chain's source and omits funding. Use it only if the founder insists on "fills" literally; bills' trade rows (`type == "2"`) are the same fills' P&L [ASSUMED: A1].
- **Spot.** OKX spot bills carry `pnl` as 0 for coin swaps [ASSUMED: A4]; spot trading P&L is therefore invisible to the chain's day P&L (only spot fees). Count `instType == "SPOT"` bills in the window so the readout can say how much activity the chain cannot value.

### Bybit (marked keys are Unified Trading Account 2.0, cross margin, no borrow)
UTA 2.0 is a precondition of any Bybit mark (`_read_bybit_uta_mark`: status 5 or 6, not `ISOLATED_MARGIN`, no borrow) [VERIFIED: equity_reconstruction.py:4995-5075]. So the Unified wallet/transaction log applies to every marked Bybit key.

| Term | Source | Rule the chain applies | Script reading |
|------|--------|------------------------|----------------|
| Trading P&L + fees | `private_get_v5_position_closed_pnl` (`category="linear"`, 7-day max span, cursor `nextPageCursor`) | `realized_ex_funding = position_pnl - openFee - closeFee`; `position_pnl = cumEntryValue - cumExitValue` if `side == "buy"` else `cumExitValue - cumEntryValue`; day = UTC day of `createdTime`; dedupe key `(symbol, createdTime)` (exchange.py ~1930-1960, `position_pnl = cum_entry - cum_exit` at 1950) | same formula over rows with `createdTime` in `[B, R]` |
| Funding | `private_get_v5_account_transaction_log`, `type="SETTLEMENT"`, categories `linear` then `inverse` | `fetch_funding_bybit(exchange, label, since_ms)`; amount from `funding`, else `change`, else `cashFlow`; 7-day windows; inverse permission failure is skipped | call with `since_ms=B`, filter `timestamp <= R` |
| Flows | chain: `fetch_ccxt_transfers` (on-chain deposit and withdraw records, 30-day windows, `TransferPageStalled` on a stuck cursor). Rebuild path only: `fetch_bybit_unified_flows` (Unified edge `TRANSFER_IN` / `TRANSFER_OUT`) | live derive keeps `fetch_ccxt_transfers` (bybit_unified_flows.py docstring "Scope (D-02)") | primary = chain's `fetch_ccxt_transfers`; add the Unified-edge `TRANSFER_IN`/`TRANSFER_OUT` count as a diagnostic (a deposit to FUND is not in the Unified wallet until moved) |

- **Retention and windows.** Closed PnL: "endTime - startTime <= 7 days", sidebar "2 years", `limit` 1-100 [CITED: https://bybit-exchange.github.io/docs/v5/position/close-pnl]. Transaction log: both times given -> span at most 7 days, `limit` 1-50, "up to 2 years", `change = cashFlow + funding - fee`, `cashFlow` "Excludes trading and funding fees" [CITED: https://bybit-exchange.github.io/docs/v5/account/transaction-log]. A 6 h window is one call window each; the first marks (2026-10-26 on) are far inside two years. (The chain sends `limit: 200` to closed-pnl; the docs say 1-100, so send 100.)
- **Fee timing difference.** Closed-pnl books `openFee` at close time; the wallet paid it when the position opened. The chain-defined P&L matches the chain, not the wallet, for positions opened before the window. Say so in the script docstring; do not "correct" it.
- **Non-USDT.** The chain's closed-pnl read is `linear` only and treats the figure as USD; funding rows carry a `currency` (USDT, USDC, BTC for inverse). Sum USDT/USDC (`STABLECOINS`) only and count non-stable rows; a non-zero count marks the key `partial` in the record, never silently dropped.

### Binance (no marked keys yet; build only if cheap, else record "reader not built")
Chain: futures income `fapiPrivate_get_income` with `incomeType` in `("REALIZED_PNL", "COMMISSION")`, funding via `fetch_funding_binance`, flows via `fetch_ccxt_transfers` (exchange.py:1664-1690; funding_fetch.py:347). Its mark is `MARKED_EQUITY_VENUES = frozenset({"bybit", "binance"})` [VERIFIED: nav_marks.py:88]. Binance income retention and window rules are [ASSUMED: A5] ("last 3 months", 7-day span when both times are given). If no Binance key has a mark when the script runs, print `no_marked_keys` for the venue (CONTEXT Deferred).

### sFOX (no marked keys yet; the chain differs)
sFOX's chain is not a realized-P&L chain: `combine_sfox_balance_history` chain-links the venue's own daily `usd_value` NAV series (broker_dailies.py:411-470), and its mark comes from the uniform equity read (`UNIFORM_READ_VENUES = frozenset({"okx", "deribit", "mt5", "sfox"})`, nav_marks.py:80). The wallet base vs the sampled balance-history level is a different comparison (mark NAV vs the balance-history point at the boundary) [ASSUMED: A7]. With no marked key, print `no_marked_keys`; if one appears, treat as `reader_not_built` and ask the founder how to define it. `SfoxClient` exposes `get_balances`, `get_transactions`, `get_trades`, `get_balance_history` (GET only).

## Package-free reuse: how the script reaches the venue

Reuse the worker's own path; do not write a second decrypt or client builder.

```python
# Source: scripts/allocator_history_probe.py:1695-1725 (shape), :2175-2223 (run)
from services.encryption import decrypt_credentials, get_kek
from services.exchange import aclose_exchange
from services.job_worker import _make_exchange_client
from services.db import db_execute, get_supabase, rows

supabase = ReadOnlySupabase(get_supabase())            # table().select only
key_rows = rows(await db_execute(lambda: supabase.table("api_keys").select("*")
                 .in_("exchange", ["okx", "bybit", "binance", "sfox"]).order("created_at").execute()))
kek = get_kek()
api_key, api_secret, passphrase = decrypt_credentials(dict(credentials_row), kek)
client = _make_exchange_client(venue, api_key, api_secret, passphrase)
try: ...                                               # GET-only reads under asyncio.wait_for
finally: await aclose_exchange(client)
```
- Key states: `api_keys.exchange` is CHECKed to `('binance','okx','bybit','deribit','sfox','mt5')`; `sync_status` to `idle, syncing, computing, complete, complete_with_warnings, error, revoked, rate_limited, sign_in_failed` [VERIFIED: supabase/schema/baseline.sql:13148-13189]. A key is working iff `working_holder_predicate(key_row)` (is_active, `disconnected_at` NULL, `sync_status` NULL or not in `NOT_WORKING_SYNC_STATUSES`) [VERIFIED: allocator_equity_derive.py:361-381]. A non-working key is reported `unmeasurable: key_not_working` BEFORE any decrypt (probe precedent); a revoked key affects only itself (founder memory "Revoked key scope").
- Same-account keys: `account_shared_with_api_key_id` / `account_share_kind` mark duplicates; the script reports per key but prints a `shares_account` boolean so the founder does not read two identical offsets as two independent accounts [VERIFIED: baseline.sql api_keys columns].
- Do NOT call `_allocator_key_preflight` (its breaker arm can write), `_stamp_429`, or any persist path; static-pin them as the probe test does (`_FORBIDDEN_NAMES` in tests/test_allocator_history_probe.py:2181-2218).

## Architecture Patterns

### System Architecture Diagram
```
 operator (orchestrator)                       Railway backfill worker (egress IP allowed by venues)
 ---------------------                         ---------------------------------------------------
 founder approves run  --->  temp start-command wrapper:
                              import check; python -m scripts.walletoffset_probe & ; echo probe-exit; exec python -m main_worker
                                         |
                                         v
        api_keys (select *, venue in okx|bybit|binance|sfox)  ---+
        api_key_nav_marks via read_key_marks(first row)  --------+--> per key: first mark {mark_day, marked_at R, nav, open_pnl}
                                         |                        B = floor_utc_midnight(R); window [B, R]
              not working? -> record unmeasurable(key_not_working), skip decrypt
                                         v
              decrypt (KEK) -> _make_exchange_client -> GET-only reads (asyncio.wait_for, call ceiling)
                |-- OKX: bills-archive walk (after-paged, stop on bill ts < B) -> pnl+fee, funding, transfers count
                |-- Bybit: closed-pnl [B,R] + tx-log SETTLEMENT [B,R] + fetch_ccxt_transfers + unified-edge count
                |-- flows: fetch_ccxt_transfers(since=B) -> ccxt_rows_to_dated_flows(instants=) -> window sum
                                         v
              pure layer: P (trading+funding), F (flows), offset=(P+F), ratios over nav and wallet, sig3
                                         v
              emit_record (whitelist, assert_sanitized) -> stdout JSON line per key + one summary
 service log lines ---> orchestrator pastes counts/ratios into SUMMARY ---> founder readout plan
```

### Recommended Project Structure
```
analytics-service/
├── scripts/walletoffset_probe.py        # pure layer + I/O layer + main(); no new service module
├── tests/test_walletoffset_probe.py     # offline: arithmetic, readers on fakes, redaction, read-only pins
└── tests/_okx_bills.py                  # extended additively: okx_bill(pnl=, fee=)
```
Keep the logic in `scripts/` (the probes do): `scripts/` is not in the mypy gate and not in `--cov=services`. If a helper is moved into `services/` it enters the mypy strict gate and coverage, so don't unless a shared fix needs it.

### Pattern 1: one record per key, closed vocabulary
Declare `KEY_RECORD_KEYS`, `SUMMARY_RECORD_KEYS` and a validator per key like `allocator_history_probe.validate_record` (raise on an extra or missing key, a value outside the vocabulary, or a float not already `sig3`), then `assert_sanitized`. Suggested record keys: `record, key (k1..kN by created_at), venue, run_date, first_mark_day (date only), read_hour_bucket or read_delay_hours (sig3), measured (bool), unmeasurable_reason (closed token or "none"), partial (bool), shares_account (bool), pnl_trading_ratio, pnl_funding_ratio, pnl_ratio, flow_ratio, offset_ratio, offset_over_wallet_ratio, bills_in_window, fills_or_closed_rows_in_window, funding_rows_in_window, flow_rows_in_window, transfer_bills_in_window (OKX), non_stable_rows, spot_bills_in_window (OKX), failure_class`. Ratios are `sig3` floats or `"field-absent"`; never 0 for "not measured".

### Pattern 2: closed unmeasurable tokens
`no_mark`, `key_not_working`, `AuthenticationError`/`PermissionDenied` (via `classify_failure`, the class only), `window_outside_retention`, `reach_unproven`, `page_ceiling`, `unpriced_flow` (a non-stable flow with no same-day close: `NavReconstructionError`), `nav_nonpositive`, `reader_not_built`, `timeout`, `other`. Mirrors the mark refusal vocabulary (`nonpositive`, `dust`) in `MARK_REFUSAL_TOKENS`.

### Anti-Patterns to Avoid
- **Summing funding twice or not at all.** The chain drops OKX `type == "8"` from trading P&L and takes funding from the same bills' `pnl`; Bybit closed-pnl already excludes funding. Count each exactly once.
- **Reading OKX `/account/bills` (7 days) or using `fetch_funding_okx(since_ms=recent)` for an old window.** Silent empty result reads as zero. Use the archive walk and fail `reach_unproven`.
- **Treating "no rows" as zero.** An account that traded in the window but whose read hit a ceiling, a 429 or a permission error is `unmeasurable`.
- **Printing a window time.** Print the date and a sig3 hour delta only; no timestamp finer than the run date.
- **A second price fetcher.** Use `_resolve_ccxt_flow_price_index` (OHLCV daily close -> CoinGecko -> `token_price_history`) for any non-stable flow; stable coins are 1.0 inside `ccxt_rows_to_dated_flows`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Decrypting keys, building the client | own Fernet / ccxt code | `decrypt_credentials` + `_make_exchange_client` | KEK path, sFOX/MT5 branching |
| Reading a key's marks | own SELECT paging | `services.nav_marks.read_key_marks` | keyset paging, ceiling, parsing |
| Flow rows and event-time USD valuation | own deposit/withdraw math | `fetch_ccxt_transfers` + `ccxt_rows_to_dated_flows(instants=)` | own-transfer filters, fee debit, fail-loud pricing |
| Bybit funding | own transaction-log pager | `fetch_funding_bybit` | 7-day windows, inverse skip, cursor ceiling |
| OKX 429 handling | own retry | `_okx_bills_fetch_with_backoff` | the worker's backoff |
| Redaction whitelist | ad hoc `print` | the probes' `validate_record` / `emit_record` / `sig3` / `assert_sanitized` | the public-repo contract |
| Window membership of a flow | own comparison | the same rule as `placed_flow_instants` (`day == read_day and at_ms <= read`) | cannot disagree with the applier |

**Key insight:** the only genuinely new code is (a) the OKX bills reader that keeps `pnl`/`fee`, (b) the Bybit closed-pnl window reader (the chain's formula is inline in `fetch_daily_pnl` and cannot be called for a window), and (c) the pure offset arithmetic. Guard (b) against drift with a parity test (see Validation).

## Common Pitfalls

### Pitfall 1: the 7-day OKX bills endpoint ages the window out
**What goes wrong:** first marks were read 2026-10-27; the 7-day endpoint stops covering them about 2026-11-03. **Why:** `fetch_funding_okx` and `fetch_daily_pnl` pick the archive by `since_ms` age, not by need. **Avoid:** archive only. **Warning sign:** a key reads zero bills while its `bills_in_window` for a neighbouring key is large.

### Pitfall 2: begin-bounded OKX queries can hide the newest bills
**What goes wrong:** a `begin`-bounded reply can come oldest-first and truncate the newest bills (Phase 172 round 1; fake `OkxBillsArchive` has a switch for it). **Avoid:** no-`begin`, `after`-paged walk that stops on a bill older than `B`, exactly like `walk_okx_bills_archive`; test the oldest-first switch.

### Pitfall 3: Bybit closed-pnl books the open fee at close; the wallet paid it at open
**What goes wrong:** the chain-defined P&L and the wallet disagree for positions opened before `B`. **Avoid:** do not mix a wallet ledger into the primary number; name the difference in the docstring and the readout.

### Pitfall 4: flows counted as offset when the applier already places them
**What goes wrong:** reporting `flow_ratio` inside "the offset the base carries" overstates it. **Avoid:** print P&L and flow parts separately and the sum; the readout states which part the base carries (rule 10, section 5 above).

### Pitfall 5: a chain flow that never touched the wallet
**What goes wrong:** OKX flows are funding-account deposit/withdraw history; the trading wallet moves only when the user transfers funding->trading (a `type == "1"` bill). Bybit chain flows are FUND-side records while the mark is the Unified wallet. **Avoid:** print `transfer_bills_in_window` (OKX) and the Unified-edge count (Bybit) so a flow-shaped wallet move with no chain flow is visible; do not invent a flow.

### Pitfall 6: non-stable P&L or flows
**What goes wrong:** the chain sums OKX `pnl + fee` in raw ccy units as if USD. **Avoid:** sum stablecoin ccy only, count the rest, mark the key `partial`. A non-stable FLOW with no same-day close raises `NavReconstructionError` -> `unpriced_flow` (note: a flow dated today has no daily close yet; the window days are old enough).

### Pitfall 7: writing by accident
**What goes wrong:** `_resolve_ccxt_flow_price_index` -> `_cache_coingecko_prices` upserts `token_price_history`; `_stamp_429` writes `api_keys`. **Avoid:** pass the `ReadOnlySupabase` (the write then fails inside its own caught exception, proven by `test_read_only_wrapper_turns_the_hidden_price_cache_write_into_a_caught_failure`), never call `_stamp_429`, re-raise `RateLimitExceeded` as `unmeasurable: RateLimitExceeded`.

### Pitfall 8: the marker-query and DB rules
The database is PROD through the worker's own service key; this script never writes, so the marker query is not needed for it, but the orchestrator must not run any SQL from the checkout (`supabase ... --linked` targets PROD). All DB access is the script's `select`.

### Pitfall 9: the tracked-text rules on the SUMMARY / readout
Tracked text holds labels `k1..kN`, counts, ratios, dates no finer than the run date. No uuid, key id, user id, amount, home path, and never a quoted search pattern as proof of absence. No CI skip token in commit or PR text; no AI attribution lines (founder memory); ship branch changes nothing under `.planning`; CHANGELOG entry and VERSION bump on the code ship.

## Plan shape this implies (for the planner)

1. **Plan 01 (autonomous): the script and its tests** under `analytics-service/scripts/` and `analytics-service/tests/`. Ships as a code PR (CHANGELOG + VERSION, `/gsd-ship`, `/land-and-deploy`), because the worker can only run `python -m scripts.walletoffset_probe` after Railway deploys main (it deploys only after main CI is green).
2. **Plan 02 (`autonomous: false`): the run on the worker.** Modelled on 180-08 Task 1 [VERIFIED: .planning/phases/180-bybitfunding-.../180-08-PLAN.md Task 1] and 167.2.1.1.2.1-06: ask the founder once for approval; confirm main CI green bound to the merge SHA and the deployed commit; import check in the wrapper; start the probe in the BACKGROUND in a temporary start-command wrapper, print `probe-exit: <code>`, then `exec python -m main_worker`; apply with `railway redeploy --from-source` (a plain redeploy reuses the old config and never runs the wrapper); read lines from the service log (Railway splits/reflows JSON records into `key=value`; rebuild each record with values copied exactly and say so); restore the start command at once and record `worker-restored: yes`; scratch outside the repo, deleted at the end. Never `railway ssh` (broken: 167.2.1.1.2.1-06 deviation 1; Phase 185 booking records two refusals). Run between 00:30 and 21:30 UTC (the probes' rule; this script is short, but the run date and day buckets are taken once). [ASSUMED: A9 that the same backfill worker service and wrapper still work.]
3. **Plan 03 (`autonomous: false`): founder readout.** Counts and ratios per key (labels `k1..kN`), unmeasurable keys with reasons, Binance/sFOX `no_marked_keys` if still true, then ask the founder the CONTEXT open questions with a recommendation each and record the decision verbatim in CONTEXT and in the ROADMAP Phase 184 entry (SC-2). Nothing publishes (SC-3).

## Code Examples

### Pure arithmetic (stdlib only)
```python
# Source: derived from nav_marks_apply.py:246-258 (window), :385-399 (wallet base), nav_marks.py:205-214 (label)
from datetime import datetime, timezone

def window_ms(marked_at: datetime) -> tuple[int, int]:
    """[B, R] in ms: B = UTC midnight at the start of the read's own day, R = the read instant."""
    r = marked_at.astimezone(timezone.utc)
    b = r.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(b.timestamp() * 1000), int(r.timestamp() * 1000)

def in_window(ts_ms: int, b_ms: int, r_ms: int) -> bool:
    return b_ms <= ts_ms <= r_ms          # same upper edge as placed_flow_instants (at_ms/1000 <= read_s)

def offset_terms(pnl_usd: float, flow_usd: float, nav_usd: float, open_pnl_usd: float) -> dict[str, float | None]:
    wallet = nav_usd - open_pnl_usd
    if not (nav_usd > 0.0):
        return {"unmeasurable": "nav_nonpositive"}            # mirrors the mark ladder's `nonpositive`
    off = pnl_usd + flow_usd
    return {"pnl_ratio": pnl_usd / nav_usd, "flow_ratio": flow_usd / nav_usd,
            "offset_ratio": off / nav_usd,
            "offset_over_wallet_ratio": off / wallet if wallet > 0.0 else None}
```

### OKX bill sum (chain's own rule)
```python
# Source: services/exchange.py:1595-1620 (pnl+fee, funding type "8" excluded from trading), funding_fetch.py fetch_funding_okx (pnl of type "8")
def okx_window_terms(bills, b_ms, r_ms, stable):                       # bills: de-duplicated dicts with str fields
    trading = funding = 0.0; non_stable = spot = transfers = n = 0
    for bill in bills:
        ts = int(bill["ts"])
        if not in_window(ts, b_ms, r_ms): continue
        n += 1
        if bill.get("type") == "1": transfers += 1; continue
        if bill.get("ccy") not in stable: non_stable += 1; continue
        if bill.get("instType") == "SPOT": spot += 1
        pnl = float(bill.get("pnl") or 0); fee = float(bill.get("fee") or 0)
        if bill.get("type") == "8": funding += pnl
        else: trading += pnl + fee
    return trading, funding, {"bills": n, "transfers": transfers, "non_stable": non_stable, "spot": spot}
```
(Use a finiteness guard like `_finite_float` per value; a non-finite value is `malformed`, never 0.)

### Bybit closed-pnl row (chain's own formula)
```python
# Source: services/exchange.py ~1930-1960 (the inline reconstruction in fetch_daily_pnl)
side = str(item.get("side", "")).strip().lower()
position_pnl = cum_entry - cum_exit if side == "buy" else cum_exit - cum_entry
realized_ex_funding = position_pnl - open_fee - close_fee      # day key = createdTime
```

## Runtime State Inventory

Not a rename/refactor phase; omitted. (This phase stores nothing and renames nothing.)

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python venv in `analytics-service/.venv` | pytest, mypy | yes | 3.12 interpreter in `.venv` (system `python3` is 3.14.3; use `.venv/bin/python`) | - |
| pytest | tests | yes | `.venv` (system shows pytest 9.0.2; project pin `pytest<9.2`) | - |
| mypy | CI line | yes | `mypy==2.4.0` pinned in requirements-dev.txt | - |
| Railway CLI | operator run | yes (`railway 5.71.0`) | `railway ssh` is known broken | temporary start-command wrapper + `railway redeploy --from-source` |
| Worker with venue egress and KEK | the run | not probed from this checkout (by instruction) | - | none: no other host can read the keys |

**Missing dependencies with no fallback:** none for planning. The run itself needs founder approval and a deployed code SHA.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (`pytest<9.2`), `asyncio_mode = auto`, `testpaths = tests`, `pythonpath = .` (analytics-service/pytest.ini) |
| Config file | analytics-service/pytest.ini, analytics-service/pyproject.toml |
| Quick run command | `cd analytics-service && .venv/bin/python -m pytest tests/test_walletoffset_probe.py -q -x` (a comparable probe test file ran 16 tests in about 17 s) |
| Full suite command | `cd analytics-service && .venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (Makefile `test`) |

pytest runs only from `analytics-service/` (founder memory); never `importlib.reload` in tests.

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|--------------|
| SC-1 | window `[B, R]` from `marked_at` incl. edges (`ts == B` in, `ts == R` in, `ts == R+1` out, `ts == B-1` out) | unit | `pytest tests/test_walletoffset_probe.py -k window` | Wave 0 |
| SC-1 | `offset_terms`: P + F, ratios over NAV and wallet, sign, `nav <= 0` -> unmeasurable, never 0 | unit (an independent invariant: `offset*nav_ratio` round-trips, and a hand-built case with a known answer) | `-k offset` | Wave 0 |
| SC-1 | OKX bill sum: trading `pnl+fee`, funding from `type 8` pnl, transfers counted not summed, non-stable ccy excluded and counted, duplicates by `billId` dropped | unit on `okx_bill(pnl=, fee=)` fakes | `-k okx` | Wave 0 (extend `tests/_okx_bills.py`) |
| SC-1 | OKX walker: stops only on a bill `< B`; empty page before that -> `reach_unproven`; oldest-first switch does not hide newest; page ceiling -> unmeasurable | unit on `OkxBillsArchive` | `-k okx_walk` | Wave 0 |
| SC-1 | Bybit closed-pnl formula parity: same synthetic rows through the script's function and through `exchange.fetch_daily_pnl` (fake exchange) give equal day totals | parity | `-k bybit_parity` | Wave 0 |
| SC-1 | Flow term: `ccxt_rows_to_dated_flows(instants=)` rows filtered to the window, stablecoin flow, non-stable without price -> `unpriced_flow` | unit | `-k flows` | Wave 0 |
| SC-1 | non-working / no-mark / auth / permission / timeout keys each give their closed token and never a ratio | unit | `-k unmeasurable` | Wave 0 |
| SC-3 | read-only: handle exposes `select` only; no `.insert(`/`.update(`/`.upsert(`/`.delete(`/`.rpc(`/`enqueue`; none of `_allocator_key_preflight`, `_stamp_429`, `persist_equity_snapshots`, `replace_equity_snapshots*`, `_crawl_account_key`, `_crawl_whole_account`; no `create_order|cancel_order|withdraw|transfer(`; no `private_(post|put|delete)_`; only the `api_keys` and `api_key_nav_marks` tables named | static AST/source pins (copy `test_the_probe_source_*`) | `-k read_only or source` | Wave 0 |
| SC-1/SC-3 | redaction: plant distinctive ids (fake uuids), amounts (for example 7777.25), ciphertext and a venue message in the fakes; run `run()`; assert none appears in captured stdout or stderr; `emit_record` rejects an extra key, an out-of-vocabulary value, an unrounded float and a 10+ digit run; `main()` prints the exception TYPE only | integration on fakes | `-k redaction or leaks` | Wave 0 |
| SC-1 | the pins can fail: control run on a deliberately leaky variant / the bare client writes (as the probe's `test_read_only_wrapper_turns_...` control does) | mutation-style control | in the same tests | Wave 0 |

The no-id/no-amount test must be a real negative: a leaky stub in the same test that DOES print a planted value must make the assertion fail (Rule 9: a test that cannot fail is wrong).

### Sampling Rate
- **Per task commit:** `cd analytics-service && .venv/bin/python -m pytest tests/test_walletoffset_probe.py -q -x`
- **Per wave merge:** the full suite command above plus the mypy line below.
- **Phase gate:** full suite green, mypy line green, then the worker run.

### CI mypy line (verbatim) and scope
`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (run from `analytics-service/`; ci.yml step "Type gate - mypy strict over the running-service surface"; baseline measured this session: `Success: no issues found in 131 source files`). `scripts/` is NOT in mypy scope, by CI's own comment ("scripts/ stays ungated: they are one-off operational tooling"), pinned by `src/__tests__/contracts/ci-mypy-strict-surface.contract.test.ts` (an excluded-`scripts` entry). No ruff, flake8 or black runs on `analytics-service` in CI or in the Makefile (greps found none), so the script is type- and lint-ungated: type-annotate anyway and optionally run `.venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/walletoffset_probe.py` locally. The mypy line only turns red if the plan also edits `services/` (for example an extracted helper); the plan still carries it verbatim.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_walletoffset_probe.py` - all rows above
- [ ] `analytics-service/tests/_okx_bills.py` - additive `pnl` / `fee` parameters on `okx_bill` (default-off, per the module's own precedent) so Phase 172/179 tests are untouched
- [ ] a Bybit closed-pnl + transaction-log fake (reuse `tests/_bybit_evidence.py` if it already models `private_get_v5_*`; otherwise a small local fake)
- Framework install: none.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no new auth) | existing KEK decrypt path; never print a key |
| V3 Session Management | no | - |
| V4 Access Control | yes | service-role reads confined to `api_keys` and `api_key_nav_marks` (static table-name pin); `ReadOnlySupabase`; GET-only venue calls |
| V5 Input Validation | yes | finite-number guards on every venue field; closed vocabulary on output; no free text from venues ever printed |
| V6 Cryptography | yes | `decrypt_credentials` / `get_kek` only; never hand-roll |
| V7 Error handling / logging | yes | `logging.disable(logging.CRITICAL)`; failures by exception CLASS only (a ccxt message can carry a signed URL) |
| V8 Data protection | yes | public-repo redaction contract; ratios and counts only |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential or signed URL in stdout/log | Information disclosure | class-only failures, logging disabled, `assert_sanitized` |
| Id / amount in the pasted record (tracked file, public repo) | Information disclosure | whitelist `emit_record`, ordinal labels `k1..kN`, `sig3` ratios, date-only |
| Accidental venue write (order, transfer, withdraw) | Tampering | no write names in source; static pins; GET-only wrapper over raw calls |
| Accidental DB write (price cache, 429 stamp, enqueue) | Tampering | select-only handle; forbidden-name pins |
| Start-command wrapper left in place on the worker | Denial of service / Tampering | explicit restore step, `worker-restored: yes`, verified by the worker's normal startup line |
| Rate-limiting a live worker's keys | DoS | call ceiling (`BudgetedExchange`, `CHAIN_CALL_CEILING = 120` precedent), bounded `asyncio.wait_for` |

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Wallet base for every venue | Writer-chain base for MT5 and Deribit (G-01, D-25, commit 8c8edc452, v0.133.13.0, PR #1166 [VERIFIED: git log]) | 2026-11-01 | OKX/Bybit/Binance/sFOX keep wallet base (D-27) pending this measurement |
| Day-level flow placement | Rule 10: flows made before a mark's read are counted in the mark day | NAVMTM D-23 | the flow part of the offset is already handled by the applier |
| Bybit flows = on-chain records | Rebuild path uses Unified-edge transaction log; live derive still on-chain records | Phase 180 (D-01, D-02) | the two can disagree on timing; print the edge count |

**Deprecated/outdated:** OKX `/account/bills` for anything older than 7 days.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The founder's "from fills and trade history" is satisfied by the venue trade-history endpoints the chain already books from (OKX bills, Bybit closed-pnl), not by a fills-first rebuild | Per-venue read sources | The number measures the chain's definition, not raw fills; the readout must say which |
| A2 | The window is `[midnight at the start of the read's own UTC day, marked_at]` (equivalently day `mark_day + 1`), per the ROADMAP's "5.5-6.7 h after the boundary" | What the offset is | If the founder meant the whole mark day, the window is 24 h longer; cheap to add a second ratio |
| A3 | The backfill worker's egress IP is allowed for OKX keys as it is for Bybit (167.2.1.1.2.1-06) | Plan shape | An OKX key may read `PermissionDenied`/auth from the worker; recorded as unmeasurable |
| A4 | OKX spot bills carry `pnl` 0 for coin swaps, so spot P&L is invisible to the chain | Per-venue read sources (OKX) | Offset understated for spot-heavy accounts; the `spot_bills_in_window` count exposes it |
| A5 | Binance income: about 3 months retention, 7-day span when both times are sent | Per-venue (Binance) | Only matters if a Binance key gets a mark |
| A6 | Bybit transaction-log type names `TRANSFER_IN` / `TRANSFER_OUT` and `SETTLEMENT` | Per-venue (Bybit) | Source: this repo's `UNIFIED_FLOW_TYPES = ("TRANSFER_IN", "TRANSFER_OUT")` and `"type": "SETTLEMENT"` (cited, not re-read at the enum page) |
| A7 | sFOX's first-mark offset must be defined against its balance-history sample, not realized P&L | Per-venue (sFOX) | Wrong definition if a sFOX key is marked before the run |
| A8 | OKX bills-archive can trail the 7-day store by up to a day | Per-venue (OKX) | A too-fresh window reads short; the windows here are over a day old |
| A9 | The same Railway service and start-command wrapper used for the 171/172/173/180 probes still works | Plan shape | The run plan needs a different vehicle; founder step |
| A10 | The PROD counts (5 OKX keys, 1 Bybit key marked) still hold at run time and the first marks are on or after 2026-10-26 | Summary | None: the script reads the first mark per key from the table, it does not hard-code days or counts |

## Open Questions (RESOLVED)

*Resolved 2026-11-01 at plan revision (checker iteration 1). Each question keeps its original text; the RESOLVED line names the plan that carries the resolution.*

1. **Should the wallet-faithful ledger (OKX `balChg`, Bybit transaction-log `change`) be a second reading?**
   - Known: it measures the real wallet movement in the window, independent of how the chain books it; it needs multi-currency USD pricing.
   - Unclear: whether the founder wants it. CONTEXT asks for the chain-defined rebuild.
   - Recommendation: not in this phase; keep `transfer_bills_in_window`, `spot_bills_in_window`, `non_stable_rows` and the Unified-edge count as cheap flags that say when the chain definition may be incomplete. Offer the ledger as a follow-up if the readout shows a material or ambiguous number.
   - **RESOLVED:** out of scope for this phase. The flags stay in the probe (plans 184-01 and 184-03), and plan 184-05 Task 1 offers the ledger reading to the founder as a follow-up when the readout is material (a measured key at or above the founder's Q1 threshold) or ambiguous (a chain-incompleteness caveat names a label, or a reading objection was recorded). The answer, or its moot line, is recorded on `ledger-offer-answer:`.
2. **Which Bybit flow source is "the" flow term?** The chain uses on-chain records (`fetch_ccxt_transfers`); the wallet sees Unified-edge moves. Recommendation: the chain's source is primary (it defines the offset), the edge count is a diagnostic.
   - **RESOLVED:** the chain's `fetch_ccxt_transfers` is the flow term, and the Unified-edge count is printed as a diagnostic only (`unified_edge_rows_in_window`, plan 184-03 Task 1; the caveat line in plan 184-04 Task 2).
3. **Window reading (A2).** Confirm in the readout; the script computes it from `marked_at`.
   - **RESOLVED:** the script computes B and R from `marked_at` (`window_ms`, plan 184-01). Plan 184-05 Task 1 states the reading to the founder, and an objection is recorded on `reading-objection:` and routed as a follow-up, never as a silent re-definition.
4. **Unmeasurable-key policy** is the founder's (CONTEXT Q3); the script supplies the closed reasons.
   - **RESOLVED:** the probe prints a closed reason per key (plans 184-01 and 184-02), and plan 184-05 Task 1 asks the founder CONTEXT Q3 with those reasons, or records it moot when every marked key was measured.

## Sources

### Primary (HIGH confidence - read this session)
- `analytics-service/services/nav_marks_apply.py` (module docstring rules 1-14; `placed_flow_instants` 246-258; `_writer_level_before`; `apply_marks` 297-470)
- `analytics-service/services/nav_marks.py` (`MARKS_TABLE`, `UNIFORM_READ_VENUES`, `MARKED_EQUITY_VENUES`, `StoredMark`, `mark_day_for`, `read_key_marks`)
- `analytics-service/services/job_worker.py` (`WRITER_BASIS_VENUES` 355; `_warn_wallet_base_fallback` 756-771; apply selection 7870-8135; key-mode terminal overwrite ~8254; ccxt equity/trades/funding/flows crawl 7285-7440; `_make_exchange_client` 1656-1683; `_resolve_ccxt_flow_price_index` 3018-3090)
- `supabase/migrations/20261029120000_api_key_nav_marks.sql`; `supabase/schema/baseline.sql:13148-13189` (api_keys)
- `analytics-service/services/exchange.py` (`fetch_daily_pnl` 1421-2070), `funding_fetch.py` (`fetch_funding_okx`, `fetch_funding_bybit`), `ccxt_flow_fetch.py`, `ccxt_flows.py`, `bybit_unified_flows.py`, `okx_opening_balance.py`, `okx_bills_chain.py` (`BudgetedExchange`), `equity_reconstruction.py` (`_bybit_uta2_status`, `_read_bybit_uta_mark`), `allocator_equity_derive.py` (`working_holder_predicate`, `realized_terminal_payload`), `broker_dailies.py` (`combine_sfox_balance_history`)
- `analytics-service/scripts/allocator_history_probe.py` (docstring, `ReadOnlySupabase`, `emit_record`, `_probe_member`, `run`, `main`), `navbreach_anchor_probe.py`, `mt5offset_dry_run.py`, `flowtiming_dry_run.py`, `bybit_reconcile.py`, `okx_chain_record.py`, `bybit_upnl_probe.py` (`FAILURE_CLASSES`, `sig3`, `classify_failure`), `deribit_ground_truth.py` (`assert_sanitized`)
- `analytics-service/tests/test_allocator_history_probe.py` (read-only and source pins 2148-2290), `tests/_okx_bills.py`
- `.github/workflows/ci.yml:5570-5606` (mypy step and comments), `analytics-service/Makefile`, `pytest.ini`, `pyproject.toml`
- `.planning/phases/167.2.1.1.2.1-.../167.2.1.1.2.1-06-SUMMARY.md` and `.planning/phases/180-.../180-08-PLAN.md` (run mechanics)
- Local runs: mypy baseline green (131 files); `tests/test_mt5offset_dry_run.py` 16 passed

### Secondary (MEDIUM confidence)
- OKX V5 docs: Get bills details last 7 days / last 3 months (retention, 100 rows, `begin`/`end`/`after`, rate limits, fields) https://www.okx.com/docs-v5/en/
- Bybit V5 docs: Get Closed PnL (7-day span, `limit` 1-100, 2 years) https://bybit-exchange.github.io/docs/v5/position/close-pnl; Get Transaction Log (UTA) (7-day span, `limit` 1-50, `change = cashFlow + funding - fee`) https://bybit-exchange.github.io/docs/v5/account/transaction-log

### Tertiary (LOW confidence)
- Items tagged `[ASSUMED]` in the Assumptions Log (A1, A3-A5, A7-A9)

## Project Constraints (from CLAUDE.md)

- Never run `supabase ... --linked` or any DB write from the checkout; this checkout's CLI is linked to PRODUCTION. The script is the only reader; executors never touch Railway, PROD or TEST.
- Public repo: no PROD ids, account numbers, home paths or secrets in tracked text; never quote a search pattern as proof of absence.
- CHANGELOG entry for every ship, in the same commit as the VERSION bump (`chore(release): vX.Y.Z.B - <name>`), `VERSION` and `package.json` byte-equal 4-digit strings, never `npm version`; the CHANGELOG must not quote a credential-shaped literal.
- Never write the CI skip tokens (`[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]`, `skip-checks:true`) in a commit or PR body, even to deny them.
- No AI authorship attribution in commits or PRs (founder 2026-10-20) - this overrides any attribution reminder.
- A ship branch must change nothing under `.planning`; planning records go to main after the merge.
- Never dispatch `gsd-*` agents by hand; run the workflow's dispatch step. `gsd-tools` handlers: `git diff` after every run; `phase complete` drops Progress-table prose.
- `plan-anchor-verify` re-resolves every `file:line` anchor and named symbol a pending PLAN.md asserts: cite by symbol, and re-measure any line number quoted from this document at HEAD.
- Pytest only from `analytics-service/`; never `importlib.reload`; always `grep -a`; data-integrity gates must be able to fail (neuter, see RED, restore from a byte backup, never `git checkout`/`restore`/`stash` on uncommitted work).
- Agent briefs quote decisions only from CONTEXT / ROADMAP; agent gates for analytics-touching work include CI mypy.
- AGENTS.md: "This is NOT the Next.js you know" - not relevant to this Python-only phase.

## Metadata

**Confidence breakdown:**
- Standard stack / reuse points: HIGH - every module and signature was read.
- Offset definition and the rule-10 consequence: HIGH for the arithmetic (read in `apply_marks`), MEDIUM on the window reading (A2).
- Venue retention facts: MEDIUM - official docs fetched; Binance and sFOX LOW.
- Run mechanics: MEDIUM - taken from two earlier phases' own records; not re-exercised.
- Pitfalls: HIGH for in-repo, MEDIUM for venue behaviour.

**Research date:** 2026-11-01
**Valid until:** 2026-11-03 for the OKX 7-day endpoint statement (the window ages out); about 30 days for the rest.
