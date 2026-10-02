# Phase 67: Deribit Live Harness & Exchange Ground-Truth - Research

**Researched:** 2026-07-04
**Domain:** Live crypto-exchange evidence harness (ccxt 4.5.59 Deribit raw endpoints from the Railway worker) + Bybit ingestion ground-truth reconciliation
**Confidence:** HIGH on codebase seams and ccxt call shapes (verified against the installed 4.5.59); MEDIUM on Deribit transaction-log runtime semantics (the funding-netting question is exactly what the harness EXISTS to answer empirically — do not treat any pre-answer here as fact)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Harness shape & transport**
- Committed one-off scripts under `analytics-service/scripts/` (run via `railway ssh "cd /app && python -m scripts.X"`; env key convention is `SUPABASE_SERVICE_KEY`, NOT `_ROLE_KEY`). Scripts stay in-repo — they become fixture generators for Phase 70.
- ccxt 4.5.59 (venv freshly synced 2026-07-04 — STATE blocker cleared) with raw-endpoint fallthrough for `private/get_transaction_log` and `private/get_user_trades_by_currency_and_time`; exact call shapes researched at plan time.
- Output: structured JSON to stdout, captured through `railway ssh` redirect, committed SANITIZED — no key material, account identifiers masked.
- The same authed run records any Deribit geo-block block-body marker for `geo_block.py` (#415 classifier fail-safe). Dynamic egress caveat: re-probe is cheap, classifier is the fail-safe.

**Credentials & recorded answers**
- Deribit key provisioning is a `checkpoint:human-action` — the founder provides ONE read-only LTP Deribit key via Railway env vars (LTP secrets: env/Keychain only, NEVER tracked files; rotation after onboarding per ONB-02). Harness fails loudly if the key's scopes exceed read-only.
- Recorded answers live TRACKED in-repo at `analytics-service/docs/deribit-ground-truth.md` + sanitized raw JSON evidence alongside — not in the gitignored `.planning/` ledger, because Phases 68/70 design against them.
- The 3 mandated answers (funding-netting shape: netted into realized PnL vs separate rows; inverse/linear/options mix per account; block-body marker) are each recorded WITH the raw evidence excerpt proving them.
- Bonus observation, non-blocking: whatever the one key reveals about LTP account structure (distinct login vs subaccount) is noted for Phase 72; resolving all 3 accounts is NOT this phase.

**Bybit ground-truth reconciliation (BYB-01)**
- Subject: the founder's live Bybit key already ingested in prod (the #563 investigation subject).
- "Reconciled" means: exchange-fetched fills + funding (fresh, from the worker) vs DB trades/funding rows via native-id set equality over a fixed window; AND per-key realized+funding dailies recomputed from exchange data vs stored CSV dailies within 1e-9.
- Explicit #563 under-fetch class re-check with the now-clean Amsterdam egress; count deltas recorded even if zero.
- Any discrepancy: root-cause + fix + regression test that fails without the fix. Zero discrepancies: the clean reconciliation itself is the BYB-01 evidence.

### Claude's Discretion
- Script file names/structure, JSON schema of the evidence artifacts, masking scheme for account identifiers.
- Whether Deribit + Bybit probes share helper code (only if it stays trivially simple).
- Exact reconciliation window (long enough to cover the #563 class; bounded for runtime).

### Deferred Ideas (OUT OF SCOPE)
- Resolving the full LTP 3-account structure (Phase 72 concern; noted-if-observed only).
- No Deribit boundary wiring (Phase 68), no Deribit ingestion/dailies (Phase 70), no egress/region work (disproven — worker already egresses Amsterdam NL, all four exchanges reachable/authed).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DRB-01 | Live harness proof from the Railway worker — authed trades + transaction-log fetch for one LTP key; record funding-netting shape, inverse/linear/options mix, block-body marker | ccxt 4.5.59 Deribit call shapes verified below (Code Examples); transaction-log field semantics + the 3-answer capture plan (Deribit Transaction-Log Semantics); scope-read via `public_get_auth`; geo-block marker capture reuses `probe_exchange_egress.py` + `geo_block.py` seam |
| BYB-01 | Bybit ingestion verified end-to-end vs exchange ground truth — fills completeness (#563 under-fetch re-check), funding rows, per-key realized+funding dailies reconciled for ≥1 live key; any discrepancy root-caused + fixed with a failing-without-fix regression test | Reuse `services.reconciliation.diff_strategy_fills` (two-stage native-id + tuple diff) for fills; reuse `run_derive_broker_dailies_job` / `combine_realized_and_funding` for dailies recompute; `_fetch_raw_trades_bybit` + `fetch_funding_bybit` pagination limits mapped (Don't Hand-Roll, Pitfalls); native-id column is `trades.exchange_fill_id` = Bybit `execId` |
</phase_requirements>

## Summary

This is an **evidence/runtime-ops phase, not a feature phase**. The deliverables are two committed one-off scripts under `analytics-service/scripts/`, a tracked answers doc at `analytics-service/docs/deribit-ground-truth.md` with sanitized raw-JSON evidence, and (if BYB-01 surfaces a discrepancy) a root-cause fix plus a regression test. Nothing here wires Deribit into any product boundary.

The good news from codebase reconnaissance: **almost every mechanism already exists and should be reused, not rebuilt.** The Bybit reconciliation has a ready-made pure-function diff engine (`services.reconciliation.diff_strategy_fills`, two-stage: PRIMARY on `(exchange, exchange_fill_id)` then SECONDARY tuple match with `id_drift` classification) driven today by `run_reconcile_strategy_job` over a 24h window. The per-key realized+funding dailies pipeline exists end-to-end (`run_derive_broker_dailies_job` → `fetch_all_trades` + `fetch_funding_bybit` + `fetch_account_equity_usd` → `combine_realized_and_funding` → `csv_daily_returns` keyed by `api_key_id`). Credential decryption is a single call (`decrypt_credentials(key_row, get_kek())`, envelope Fernet). The Bybit fetchers already encode every pagination limit that the #563 under-fetch class turns on (execution-list cursor `PAGE_CAP=100`; funding/closed-pnl 7-day windows; `MAX_PAGES=200`). The BYB-01 harness is therefore mostly *orchestration of existing seams over a wider, fixed window* plus a fresh-vs-stored comparison — not new ingestion code.

For Deribit (DRB-01): ccxt 4.5.59 is confirmed installed (venv synced) and ships every needed raw endpoint. Deribit is **HMAC-authenticated** in ccxt (`deri-hmac-sha256`), not OAuth-token — so scope introspection for the read-only gate must go through `public_get_auth` (`grant_type=client_credentials`) whose response carries the `scope` string (the grounding fact's `trade:read account:read wallet:read custody:read block_trade:read` came from exactly this field). `fetchLedger` and `fetchFundingHistory` are `None` for Deribit — funding/settlement data MUST come from the raw `private/get_transaction_log`. The single most consequential unknown — **is Deribit funding already netted into realized PnL, or does it appear as separate transaction-log rows?** — is not answerable from training data and is the reason this phase exists; the harness captures the raw transaction-log rows (with their `type` field) so Phase 70's dailies/funding design is built on observed fact, not a guess.

**Primary recommendation:** Write two scripts — `scripts/deribit_ground_truth.py` (auth + scope read + per-currency trade counts + transaction-log sample with full `type`/`side`/`instrument_name`/`amount`/`balance`/`equity` fields + geo-block body capture) and `scripts/bybit_reconcile.py` (reuse `diff_strategy_fills` for fills over a fixed window, reuse `fetch_funding_bybit` + `combine_realized_and_funding` for the dailies recompute, diff against stored `csv_daily_returns` within 1e-9). Both run via `railway ssh` as `checkpoint:human-action` (executor subagents have no railway auth or Supabase MCP). Emit sanitized JSON to stdout; the orchestrator captures and commits it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deribit authed fetch (trades, transaction log, scopes) | Analytics worker (Python, Railway) | ccxt 4.5.59 raw endpoints | Only the worker has non-US egress + KEK/env; Deribit is derivative-only, no browser/API-tier involvement |
| Deribit scope read-only enforcement | Analytics worker | `public_get_auth` scope field | Fail-loud gate lives where the key is used; no product boundary in this phase |
| Geo-block body-marker capture | Analytics worker | `geo_block.py` / `probe_exchange_egress.py` | Classifier is worker-side; body signature only observable from the egressing host |
| Bybit fills reconciliation | Analytics worker | `services.reconciliation.diff_strategy_fills` (pure fn) | Native-id set diff needs both fresh ccxt fills (worker) and DB `trades` rows (Supabase); the diff itself is a pure function, unit-testable off-worker |
| Bybit dailies recompute + compare | Analytics worker | `broker_dailies.combine_realized_and_funding` + `csv_daily_returns` | Recompute path already exists (`run_derive_broker_dailies_job`); compare against stored per-key rows |
| Evidence artifact (JSON + answers doc) | Repo (`analytics-service/docs/`, `scripts/`) | git (tracked) | Phases 68/70 design against these; must NOT be in gitignored `.planning/` |
| Any Bybit bug fix + regression test | Analytics worker code + pytest | — | Root-cause standard; regression test fails without the fix |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ccxt` (async_support) | 4.5.59 (pinned, **installed & verified** in `.venv` 2026-07-04) | Deribit + Bybit REST clients; raw JSON-RPC fallthrough | Already the project's exchange client; zero new deps; ships every Deribit raw endpoint needed |
| `supabase` (python) | as pinned in `requirements.txt` | Read `trades` / `csv_daily_returns` / `funding_fees` / `api_keys` from prod | Existing DB access seam; worker uses `SUPABASE_SERVICE_KEY` |
| `cryptography` (Fernet) | 49.x (transitive, present) | Envelope-decrypt the founder's stored Bybit key (`decrypt_credentials`) | Existing KEK envelope scheme; reuse, do not reimplement |
| `pandas` | present | `combine_realized_and_funding` dailies series | Already in the dailies path |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest` + `pytest-asyncio` (`asyncio_mode=auto`) | present | Regression test for any BYB-01 bug; pure-function diff tests | Any discrepancy found → failing-without-fix test |
| `vcrpy` | 8.2.1 (present) | Optional cassette capture of Deribit responses for later Phase 70 fixtures | Only if trivially cheap; not required for DRB-01 evidence |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ccxt raw `private_get_get_transaction_log` | Hand-rolled `aiohttp` + `deri-hmac-sha256` signing | Reinvents ccxt's proven Deribit auth (HMAC header construction, nonce/ts); no benefit, adds risk. Use ccxt. |
| Reusing `diff_strategy_fills` | New bespoke set-equality diff in the script | The existing two-stage diff already handles `id_drift` vs true-discrepancy (Bybit rotates order ids); reuse it |

**Installation:** No new packages. Confirm venv is synced (already done 2026-07-04):
```bash
uv pip sync analytics-service/requirements.txt   # ccxt 4.5.59 — verified installed
```

**Version verification (done this session):**
```
$ .venv/bin/python -c "import ccxt; print(ccxt.__version__)"
4.5.59
```

## Package Legitimacy Audit

> No external packages are installed by this phase — it uses only the already-pinned, already-installed dependency set (`ccxt==4.5.59`, `supabase`, `cryptography`, `pandas`, `pytest`). Slopcheck / registry verification is **not applicable**: nothing new is added to `requirements.txt` / `requirements.in`.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none added) | — | N/A — phase adds zero dependencies |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                    checkpoint:human-action (orchestrator runs via railway ssh)
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        │                                                        │
   DRB-01 harness                                          BYB-01 reconcile
scripts/deribit_ground_truth.py                       scripts/bybit_reconcile.py
        │                                                        │
   Deribit key from Railway env                          founder's Bybit key row
   (checkpoint:human-action)                             (already in prod api_keys)
        │                                                        │
   read-only scope gate ──► public_get_auth                decrypt_credentials(key_row, get_kek())
   (fail loud if write scope)   → result.scope                     │
        │                                              ┌──────────┴───────────┐
   create_exchange("deribit",…)  [HMAC auth]           │                      │
        │                                        FRESH from exchange     STORED in prod
   ┌────┴─────────────────────────┐              (worker, wide window)    (Supabase reads)
   │ public_get_get_currencies    │                     │                      │
   │  → enumerate settlement ccys │              _fetch_raw_trades_bybit   trades (exchange_fill_id,
   │ per ccy:                     │              fetch_funding_bybit        strategy_id, is_fill)
   │  private_get_get_user_trades │              fetch_account_equity_usd  funding_fees (match_key)
   │    _by_currency_and_time     │              combine_realized_and_     csv_daily_returns
   │    → count, has_more, sample │                _funding                 (api_key_id axis)
   │  private_get_get_transaction │                     │                      │
   │    _log → type/amount/balance│              ┌──────┴──────────────────────┤
   │    /equity/instrument_name   │              │ diff_strategy_fills (PRIMARY │
   │  private_get_get_account_    │              │  execId set-equality +       │
   │    summary → balances, equity│              │  SECONDARY tuple/id_drift)   │
   │  private_get_get_subaccounts │              │ dailies diff (recompute vs   │
   │    → LTP structure (bonus)   │              │  stored, |Δ| < 1e-9)         │
   └──────────────┬───────────────┘              └──────────────┬───────────────┘
                  │                                             │
        geo-block body capture                          discrepancy? ──► root-cause + fix
        (probe on block; feed geo_block.py)                       │        + regression test
                  │                                             │
                  ▼                                             ▼
   SANITIZED JSON stdout ──► docs/deribit-       SANITIZED JSON stdout ──► evidence
   ground-truth.md + raw evidence (TRACKED)      (clean reconciliation = BYB-01 proof)
```

### Recommended Project Structure
```
analytics-service/
├── scripts/
│   ├── deribit_ground_truth.py   # DRB-01 harness (auth+scope+trades+txn-log+geo capture)
│   └── bybit_reconcile.py        # BYB-01 fills+funding+dailies reconciliation
└── docs/
    ├── deribit-ground-truth.md   # TRACKED answers doc (3 mandated answers + evidence)
    └── evidence/                 # sanitized raw JSON alongside (e.g. deribit-txnlog-sample.json,
                                  #   bybit-reconcile-report.json)
```
Note: `analytics-service/docs/` does **not exist yet** — the phase creates it (tracked). It is distinct from `.planning/research/` (gitignored ledger).

### Pattern 1: Reuse the existing pure-function diff for fills
**What:** `services.reconciliation.diff_strategy_fills(strategy_id, date_range, exchange_fills, db_fills)` — Stage 1 PRIMARY exact match on `(exchange, exchange_fill_id)`; Stage 2 SECONDARY tuple match `(exchange, symbol, time-bucket, side, qty, price±1bp)` emitting `id_drift` (informational) vs true discrepancy.
**When to use:** BYB-01 fills completeness — feed it fresh ccxt fills and DB `trades` rows over the fixed window.
**Example:** see `run_reconcile_strategy_job` (job_worker.py:2171) for the exact call/load shape; the script mirrors it but over a fixed (not 24h) window and without writing `reconciliation_reports`.

### Pattern 2: Reuse the dailies recompute path, compare against stored
**What:** `fetch_all_trades` + `fetch_funding_bybit` + `fetch_account_equity_usd` → `broker_dailies.combine_realized_and_funding(realized, funding, account_balance=equity)` → a gap-filled daily-return `pd.Series`.
**When to use:** BYB-01 dailies reconciliation — recompute from fresh exchange data and diff each `(date, daily_return)` against the stored `csv_daily_returns` rows for that `api_key_id` within `1e-9`.
**Caveat:** the anchor is `current_equity - total_pnl` (anchor-to-today); a fresh run's "today" equity may differ from the stored run's if time passed. Reconcile on the **overlapping historical tail** (dates present in both), and note that the most-recent day / anchor may legitimately move. Prefer comparing the realized+funding *daily deltas* over the shared window rather than absolute reconstructed equity.

### Anti-Patterns to Avoid
- **Hand-rolling Deribit HMAC signing** — ccxt already does `deri-hmac-sha256` header construction. Call raw `private_get_*` methods on a `create_exchange("deribit", …)` instance.
- **Using `fetchFundingRate*` for realized funding** — that's the market rate, not the account's funding. Deribit account funding lives in the transaction log.
- **Reconciling Bybit funding by native id** — Bybit **rotates transaction ids** across responses (documented in `funding_fetch.py` and `encryption`/upsert comments); funding dedup is by `match_key` (8h bucket), NOT raw id. Fills reconcile by native `execId`; funding reconciles by `match_key` bucket or by daily-sum. Do not attempt native-id set equality on funding rows.
- **Writing `reconciliation_reports` / `strategy_analytics` from the harness** — this is a read-only evidence run; don't mutate prod analytics tables. (Recompute in-memory only.)
- **Printing secrets** — never log `api_key`/`api_secret`/`access_token`; mask account/subaccount ids and any `email` in `get_subaccounts`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fills set-equality with id-drift tolerance | New diff loop | `services.reconciliation.diff_strategy_fills` | Already two-stage, classifies `id_drift` vs true discrepancy; Bybit rotates order ids |
| Bybit fills fetch + pagination | New execution-list loop | `services.exchange._fetch_raw_trades_bybit` | Encodes cursor `PAGE_CAP=100`, stuck-cursor guard, `sync_truncated_bybit` DQ flag — the #563 surface |
| Bybit funding fetch | New transaction-log loop | `services.funding_fetch.fetch_funding_bybit` | 7-day window walk, linear+inverse fan-out, `MAX_PAGES` ceiling raise |
| Per-key realized+funding dailies | New series math | `broker_dailies.combine_realized_and_funding` + `fetch_all_trades` + `fetch_account_equity_usd` | The exact production recompute; guarantees identical anchoring/gap-fill |
| Credential decryption | Re-implement Fernet | `services.encryption.decrypt_credentials(key_row, get_kek())` | Envelope KEK/DEK scheme; fail-loud on NULL columns |
| Deribit auth/signing | aiohttp + HMAC | `create_exchange("deribit", key, secret)` then raw `private_get_*` | ccxt handles nonce/ts/HMAC header |
| Geo-block detection | New string match | `services.geo_block.is_geo_blocked` + `probe_exchange_egress.py` | Signature-based classifier; add the Deribit marker to the existing tuple |

**Key insight:** BYB-01 is a *composition of existing seams over a fixed window plus a comparison*, and DRB-01 is a *thin authed read harness over ccxt raw endpoints*. The correctness risk is in reusing the exact production fetchers (so the reconciliation actually exercises the #563 code paths) — not in writing clever new code.

## Runtime State Inventory

> This phase FETCHES and RECORDS; it does not rename or migrate. Inventory is near-empty by design.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Reads prod `trades`, `funding_fees`, `csv_daily_returns`, `api_keys` (founder's Bybit key row). No writes to these. | Read-only; none |
| Live service config | Deribit read-only key arrives via **Railway env var** (`checkpoint:human-action`), never a tracked file. | Founder sets env var; harness reads it; rotate after (ONB-02) |
| OS-registered state | None — one-off `railway ssh` invocation, no scheduled task, no pm2/systemd registration. | None — verified: scripts are manual one-offs like `probe_exchange_egress.py` |
| Secrets/env vars | `KEK` (decrypt Bybit key), `SUPABASE_SERVICE_KEY`, and the new Deribit `DERIBIT_CLIENT_ID`/`DERIBIT_CLIENT_SECRET` (naming = Claude's discretion) — all env-only. | Confirm KEK + SUPABASE_SERVICE_KEY present on worker (they are — production worker uses them); founder adds Deribit pair |
| Build artifacts | New `analytics-service/docs/` dir (tracked); two new `scripts/*.py` (tracked). | Create dir; ensure NOT gitignored |

**Nothing found in category (OS-registered state):** None — verified the established idiom (`probe_exchange_egress.py`) is a manual `railway ssh` one-off with no OS registration.

## Common Pitfalls

### Pitfall 1: Deribit funding-netting assumption baked into the harness
**What goes wrong:** The harness is written assuming funding is netted into realized PnL (or assuming it's separate), and only captures fields that fit that assumption — so it can't actually answer the question.
**Why it happens:** Training data cannot resolve this; it's the reason the phase exists.
**How to avoid:** Capture the **raw transaction-log rows verbatim** (whitelisted fields: `type`, `amount`, `balance`, `equity`, `cashflow`, `instrument_name`, `side`, `timestamp`, `position`, `total_interest_pl`/`interest_pl` if present, `username`/`user_id` MASKED). Record the **distinct set of `type` values observed** (e.g. `settlement`, `delivery`, `trade`, `deposit`, `transfer`) with counts. The answer falls out of whether a `settlement`/`funding`-typed row carries funding separately from `trade` rows.
**Warning signs:** Answers doc asserts netting without a raw excerpt showing the `type` field.

### Pitfall 2: Deribit transaction-log / trades require per-currency enumeration + manual pagination
**What goes wrong:** Calling `get_user_trades_by_currency_and_time` for BTC only, or not following `has_more` / `continuation`, silently under-counts (the exact class that DRB-04 must later beat 18,778 / 21,014 / 61,248).
**Why it happens:** Deribit is currency-scoped; ccxt does not auto-loop currencies or auto-follow the continuation token.
**How to avoid:** Enumerate settlement currencies from the account (`private_get_get_account_summary` per currency, or the currency list from `public_get_get_currencies` intersected with what the account holds), loop each, and follow `has_more` (trades) / `continuation` (transaction log). Record per-currency counts so Phase 70 can verify pagination completeness against the known totals.
**Warning signs:** A single-currency count; no `has_more`/`continuation` handling in the sample.

### Pitfall 3: Reading Deribit scopes from the wrong place
**What goes wrong:** `private_get_get_account_summary` does NOT return scopes; the harness can't enforce read-only.
**Why it happens:** ccxt Deribit uses HMAC per-call auth, not an OAuth token exchange, so there's no token `scope` sitting around.
**How to avoid:** Call `public_get_auth({"grant_type":"client_credentials","client_id":KEY,"client_secret":SECRET})` and read `result.scope` (the space-separated string, e.g. `account:read trade:read wallet:read …`). Fail loud if any scope contains `:read_write` or `:read_trade` (write) rather than `:read`. (This is exactly where the grounding fact's scope string came from.)
**Warning signs:** Scope gate references `get_account_summary`.

### Pitfall 4: Bybit funding reconciliation attempted by native id
**What goes wrong:** Set-equality on funding transaction ids reports huge spurious diffs.
**Why it happens:** Bybit rotates transaction ids across responses (documented root cause of the client-side `match_key` dedup).
**How to avoid:** Reconcile **fills** by native `execId` (`trades.exchange_fill_id`); reconcile **funding** by `match_key` bucket set or by per-day funding sum; reconcile **dailies** by `(date, daily_return)` within `1e-9`.
**Warning signs:** A single set-equality over all row types.

### Pitfall 5: #563 was NOT a P&L bug — don't manufacture a fix
**What goes wrong:** Treating any fills count delta as a bug and "fixing" it, when #563 concluded the Bybit fills under-fetch was **not** a P&L correctness bug (funding dominates returns; realized fills feed a funding-excluded series).
**Why it happens:** Misremembering #563.
**How to avoid:** Record count deltas **even if zero**. A delta only becomes a BYB-01 bug if it changes reconciled P&L/dailies beyond `1e-9` OR drops funding rows. Clean reconciliation IS the evidence; don't invent a discrepancy.
**Warning signs:** A "fix" with no accompanying dailies/P&L delta.

### Pitfall 6: Executor subagents cannot run the worker steps
**What goes wrong:** A plan assigns the `railway ssh` run to an executor subagent, which has no railway auth and no Supabase MCP.
**Why it happens:** Worker/prod access is orchestrator-only (per CONTEXT integration points).
**How to avoid:** Every worker/prod fetch is a `checkpoint:human-action` for the orchestrator. Also verify `railway deployment list` is green before ssh (flaky-main silently skips deploys).
**Warning signs:** Plan task with `agent: executor` that shells `railway ssh`.

### Pitfall 7: Committing unsanitized evidence
**What goes wrong:** Raw JSON with account ids / usernames / a leaked token gets committed to a tracked file → gitleaks trips or a real leak lands.
**How to avoid:** Mask account/subaccount ids and `username`/`email`; never include `access_token`/secrets; scrub before write. Consider the existing `services.redact.scrub_freeform_string` helper for defense-in-depth.
**Warning signs:** Evidence file contains a 32+ char opaque token or an unmasked email.

## Code Examples

Verified against the **installed ccxt 4.5.59** (introspected this session).

### Deribit: authenticate + read scopes (read-only gate)
```python
# Source: ccxt 4.5.59 installed introspection (public_get_auth present);
# Deribit API v2.1.1 public/auth client_credentials grant.
import ccxt.async_support as ccxt
from services.exchange import create_exchange, aclose_exchange

ex = create_exchange("deribit", client_id, client_secret)   # HMAC deri-hmac-sha256 auth
try:
    auth = await ex.public_get_auth({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    })
    scope = auth["result"]["scope"]        # e.g. "account:read trade:read wallet:read ..."
    if any(tok.endswith(":read_write") or tok.endswith(":read_trade") for tok in scope.split()):
        raise SystemExit("FAIL-LOUD: Deribit key is not read-only (scope has write): " + scope)
finally:
    await aclose_exchange(ex)
```

### Deribit: enumerate currencies, per-currency trade counts + transaction log
```python
# Source: ccxt 4.5.59 installed introspection — these implicit methods exist verbatim:
#   public_get_get_currencies, private_get_get_account_summary,
#   private_get_get_user_trades_by_currency_and_time, private_get_get_transaction_log
# Param names per Deribit API v2.1.1 docs [CITED: docs.deribit.com]; VERIFY empirically in the run.
currencies = [c["currency"] for c in (await ex.public_get_get_currencies())["result"]]
# ^ public list includes BTC ETH USDC USDT EURR (+ others); intersect with account holdings.

for ccy in ("BTC", "ETH", "USDC", "USDT", "EURR"):   # settlement ccys; confirm per account
    # Trades (has_more pagination)
    trades = await ex.private_get_get_user_trades_by_currency_and_time({
        "currency": ccy, "kind": "any",
        "start_timestamp": start_ms, "end_timestamp": end_ms,
        "count": 1000, "include_old": "true", "sorting": "asc",
    })
    # result.trades[], result.has_more  -> loop until has_more is False (advance start_timestamp)

    # Transaction log (continuation pagination) — funding/settlement/delivery live HERE
    txnlog = await ex.private_get_get_transaction_log({
        "currency": ccy,
        "start_timestamp": start_ms, "end_timestamp": end_ms,
        "count": 1000,
    })
    # result.logs[] each row has: type, amount, balance, equity, cashflow,
    #   instrument_name, side, position, timestamp, username (MASK), ...
    # result.continuation -> pass back as `continuation` param until null.
```
> `count`/`continuation`/`has_more` field names are [CITED: docs.deribit.com/#private-get_transaction_log] and MUST be confirmed against the live response in the run (the harness IS the verification). ccxt method existence is [VERIFIED: installed ccxt 4.5.59 introspection].

### Deribit: LTP account structure (bonus, non-blocking)
```python
# Source: ccxt 4.5.59 introspection — private_get_get_subaccounts present.
subs = await ex.private_get_get_subaccounts({"with_portfolio": "true"})
# MASK usernames/ids; record only WHETHER the key sees subaccounts (distinct login vs subaccount)
```

### Bybit: reuse the production fetchers + pure diff (BYB-01)
```python
# Source: services/job_worker.py:2171 run_reconcile_strategy_job (mirror the shape).
from services.encryption import decrypt_credentials, get_kek
from services.exchange import create_exchange, fetch_raw_trades, aclose_exchange
from services.reconciliation import diff_strategy_fills

api_key, api_secret, passphrase = decrypt_credentials(bybit_key_row, get_kek())
ex = create_exchange("bybit", api_key, api_secret, passphrase)  # inherits currency-meta patch
try:
    exchange_fills = await fetch_raw_trades(ex, strategy_id, supabase, since_ms=window_start_ms)
finally:
    await aclose_exchange(ex)

# db_fills: SELECT exchange, exchange_fill_id, symbol, side, price, quantity, timestamp
#   FROM trades WHERE strategy_id = ? AND is_fill = true AND timestamp >= window_start
report = diff_strategy_fills(strategy_id=strategy_id, date_range=(start, end),
                             exchange_fills=exchange_fills, db_fills=db_fills)
# report.status / report.discrepancies / id_drift classification
```

### Bybit: dailies recompute + 1e-9 compare
```python
# Source: services/job_worker.py:1716 run_derive_broker_dailies_job + services/broker_dailies.py
from services.broker_dailies import combine_realized_and_funding
from services.exchange import fetch_account_equity_usd
from services.funding_fetch import fetch_funding_bybit
# fetch_all_trades == the realized daily_pnl records used by derive_broker_dailies

equity, balance_error = await fetch_account_equity_usd(ex, "bybit")
realized = await fetch_all_trades(ex, since_ms=None)          # full history (funding-excluded)
funding  = await fetch_funding_bybit(ex, api_key_id, None)
returns, meta = combine_realized_and_funding(realized, funding, account_balance=equity,
                                             balance_error=balance_error)
# Compare `returns[date]` vs stored csv_daily_returns.daily_return for this api_key_id
# over the overlapping window; assert abs(delta) < 1e-9 per date.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Railway worker egresses US; Deribit/Bybit ASN-blocked" (research SUMMARY "Phase 67 Egress Prerequisite") | Worker egresses **Amsterdam NL** (`152.55.184.110`); all four exchanges reachable/authed | Verified 2026-07-04 | No egress/proxy/region work; DRB-01 harness runs directly from the current worker |
| ccxt local venv 4.5.46 | ccxt 4.5.59 synced & installed | 2026-07-04 | STATE blocker cleared; call shapes verified against 4.5.59 |
| Bybit daily_pnl included funding | `fetch_daily_pnl` excludes funding (C-0319); funding is the single source via `funding_fetch` | prior milestone | Dailies = realized (funding-excluded) + funding rows, combined in `broker_dailies` |

**Deprecated/outdated:**
- The research SUMMARY's Phase 67 = "Egress Prerequisite" framing is superseded — this phase is a live *evidence* harness, not infra.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Deribit `public/auth` `result.scope` is the authoritative read-only signal and includes `account:read`/`trade:read`-style tokens | Pitfall 3, Code Examples | If scope isn't exposed this way, read-only gate needs a different source; grounding fact strongly supports it (scope string already observed) — LOW risk |
| A2 | `private/get_transaction_log` param/response fields (`count`, `continuation`, `logs[].type/amount/balance/equity`) match Deribit API v2.1.1 docs | Code Examples, Transaction-Log Semantics | Field names may differ slightly in 4.5.59 raw passthrough; the harness run itself verifies — LOW risk, self-correcting |
| A3 | Funding-netting shape is genuinely unknown until observed (hypotheses: separate `settlement`/`delivery`-typed rows) | Summary, Pitfall 1 | This is the phase's core question by design — capturing raw `type` values resolves it |
| A4 | Settlement currencies for the LTP key are within {BTC, ETH, USDC, USDT, EURR} | Code Examples, Pitfall 2 | If the account trades other ccys, the enumeration-from-account (not hard-coded) approach still catches them — LOW risk |
| A5 | The founder's Bybit key row is loadable/decryptable with the current KEK on the worker (key already ingested in prod) | BYB-01 patterns | If KEK rotated or row malformed, `decrypt_credentials` fails loud with the key id — surfaced, not silent |
| A6 | `csv_daily_returns` holds a per-`api_key_id` series for the founder's Bybit key to diff against | Pattern 2 | If only a strategy-keyed series exists, diff against `(strategy_id, date)` rows instead — both axes exist in the table |

**If this table is empty:** it is not — all six are flagged for the discuss/plan step. A1–A4 are self-verifying during the live run.

## Open Questions (RESOLVED)

> Plan-check resolution 2026-07-04: Q1-Q3 are the phase's empirical deliverables by design —
> each is RESOLVED by the adopted capture strategy the plans implement (Q1: txn-log distinct
> `type` summary, 67-01 T2; Q2: `classify_instrument` mix tally, 67-01 T2; Q3: honest
> "not observable from Amsterdam" deferral permitted, fabrication prohibited, 67-03 T3).
> Q4 RESOLVED: 180-day reconciliation window (`--window-days 180`, 67-02 T2).


1. **Is Deribit funding netted into realized PnL or a separate transaction-log row? (THE phase question)**
   - What we know: `fetchFundingHistory` is `None` in ccxt; funding must come from the transaction log; Deribit settles continuously into a daily 08:00 UTC settlement.
   - What's unclear: whether a `settlement`/`funding`-typed row carries funding distinctly from `trade` rows, or whether realized PnL already includes it.
   - Recommendation: harness captures the **distinct `type` values + counts + a per-type sample row**; the answers doc states the observed shape with the raw excerpt. Drives Phase 70 (DRB-07).

2. **Instrument mix (inverse/linear/options/combo) for the LTP key**
   - What we know: LTP accounts are expected inverse-first + options-inclusive.
   - What's unclear: exact proportions for *this* key.
   - Recommendation: classify sampled trades by `instrument_name` pattern (`-PERPETUAL` inverse vs USDC linear; `-C`/`-P` options; combos) and record counts per kind. Drives Phase 70 (DRB-05/06).

3. **Deribit geo-block body marker**
   - What we know: worker currently egresses Amsterdam (NOT blocked), so a *live* block body may not be observable from the worker.
   - What's unclear: whether we can capture the real Deribit US-block body without a US egress.
   - Recommendation: capture whatever the worker sees; if no block occurs (expected), record "no block from Amsterdam egress — marker deferred to observed-on-block; classifier is the fail-safe" (matches CONTEXT's dynamic-egress caveat). Do NOT fabricate a marker string.

4. **Reconciliation window for BYB-01**
   - What we know: must cover the #563 under-fetch class; bounded for runtime. Bybit fetchers default to 365-day lookback; execution-list `PAGE_CAP=100` × 100/page = 10k fills ceiling.
   - Recommendation (Claude's discretion): a window that exercises multi-page cursor pagination on the founder's key (whichever is smaller of full history or ~90–180 days if the key is high-volume), recorded explicitly in the evidence.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Railway worker (Amsterdam egress) | DRB-01 + BYB-01 live fetch | ✓ (verified 2026-07-04) | — | none — hard requirement; verify `railway deployment list` green before ssh |
| ccxt | both | ✓ installed | 4.5.59 | none |
| KEK env on worker | decrypt founder's Bybit key | ✓ (prod worker uses it) | — | none — `decrypt_credentials` fails loud if absent/rotated |
| SUPABASE_SERVICE_KEY on worker | read prod `trades`/`csv_daily_returns` | ✓ | — | Supabase MCP from orchestrator session as alternate read path |
| Deribit read-only LTP key | DRB-01 auth | ✗ (arrives via founder, `checkpoint:human-action`) | — | none — phase is blocked on provisioning until the env var is set |
| Supabase MCP (orchestrator) | DB-side reconciliation reads | ✓ (main session only) | prod `khslejtfbuezsmvmtsdn` | executor subagents have NONE — all worker/prod steps are checkpoint:human-action |

**Missing dependencies with no fallback:**
- Deribit read-only LTP key (founder-provided via Railway env; the DRB-01 half cannot run until set — this is the phase's single human gate).

**Missing dependencies with fallback:**
- DB reads: worker `SUPABASE_SERVICE_KEY` OR orchestrator Supabase MCP.

## Validation Architecture

> nyquist_validation is enabled (config has `nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio (`asyncio_mode = auto`) |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Quick run command | `cd analytics-service && .venv/bin/python -m pytest tests/test_reconciliation.py tests/test_broker_dailies.py -x -q` |
| Full suite command | `cd analytics-service && .venv/bin/python -m pytest -q` (Python gate `--cov-fail-under=80`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DRB-01 | Read-only scope gate fails loud on a write scope | unit (pure logic over a captured scope string) | `pytest tests/test_deribit_ground_truth.py::test_scope_gate_rejects_write -x` | ❌ Wave 0 |
| DRB-01 | Per-currency trade-count + txn-log `type` aggregation from a fixture response | unit | `pytest tests/test_deribit_ground_truth.py::test_txnlog_type_summary -x` | ❌ Wave 0 |
| DRB-01 | Evidence JSON is sanitized (no secrets / masked ids) | unit | `pytest tests/test_deribit_ground_truth.py::test_evidence_is_masked -x` | ❌ Wave 0 |
| BYB-01 | Fills diff reuses `diff_strategy_fills`; clean set → status clean | unit | `pytest tests/test_bybit_reconcile.py::test_fills_set_equality -x` | ❌ Wave 0 (diff engine covered by existing `tests/test_reconciliation.py`) |
| BYB-01 | Dailies recompute matches stored within 1e-9 on a fixture | unit | `pytest tests/test_bybit_reconcile.py::test_dailies_within_1e9 -x` | ❌ Wave 0 |
| BYB-01 | **Any discovered bug** — regression test fails without the fix | unit/integration | (bug-specific) | ❌ (only if a discrepancy is found) |

The **live** DRB-01/BYB-01 runs themselves are `checkpoint:human-action` (manual-only — real exchange + prod DB); they cannot be automated in CI. The automated tests above cover the *pure logic* of the scripts against captured/fixture responses.

### Sampling Rate
- **Per task commit:** the quick run command above (script-logic unit tests).
- **Per wave merge:** full pytest suite (coverage gate 80%).
- **Phase gate:** full suite green + the two live evidence artifacts committed (sanitized) + answers doc populated before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/test_deribit_ground_truth.py` — scope gate, txn-log `type` summary, masking (covers DRB-01 pure logic)
- [ ] `tests/test_bybit_reconcile.py` — fills diff wiring + dailies-within-1e-9 (covers BYB-01 pure logic)
- [ ] Fixture capture: a sanitized Deribit transaction-log sample + Bybit fills/funding sample to drive the above (can be a trimmed real response from the live run, masked)
- Framework install: none — pytest infra exists.

## Security Domain

> `security_enforcement` not disabled in config → enabled. This phase handles live credentials, so secrets-handling is the dominant control.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Deribit HMAC via ccxt; read-only scope gate via `public_get_auth` `scope` — fail loud on write scope |
| V3 Session Management | no | one-off script, no session |
| V4 Access Control | yes | read-only key enforcement (no `:read_write`); worker/prod steps orchestrator-only |
| V5 Input Validation | yes | exchange responses are untrusted — reuse existing `_finite_decimal`/`normalize_symbol` guards; mask before persist |
| V6 Cryptography | yes | reuse `services.encryption` Fernet envelope (`decrypt_credentials`) — never hand-roll; never persist plaintext key |
| V7 Logging (secrets) | yes | `services.redact.scrub_freeform_string`; never log `api_key`/`secret`/`access_token`; ccxt embeds `&signature=` in error URLs — scrub |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leak into committed evidence (token/id/email) | Information Disclosure | Mask ids/usernames; strip tokens; scrub; gitleaks allowlist only if a redacted fixture trips it (per Gitleaks-redaction-fixtures memory) |
| Secret leak into logs via ccxt error URLs (`&signature=<HMAC>`) | Information Disclosure | `scrub_freeform_string(str(exc))` on every logged exception (existing pattern) |
| Write-scoped Deribit key accepted | Elevation of Privilege | Fail-loud scope gate BEFORE any fetch; refuse to proceed |
| Tracked-file credential | Information Disclosure | Deribit key via Railway env only; ONB-02; repo scan clean |

## Sources

### Primary (HIGH confidence)
- **Installed `ccxt` 4.5.59** — direct introspection this session: confirmed `private_get_get_transaction_log`, `private_get_get_user_trades_by_currency_and_time`, `private_get_get_user_trades_by_currency`, `private_get_get_account_summary`, `private_get_get_subaccounts`, `public_get_get_currencies`, `public_get_auth`; `fetchLedger`/`fetchFundingHistory` = `None`; Deribit auth = `deri-hmac-sha256` (not OAuth); `requiredCredentials` = apiKey+secret (no passphrase); public currency list includes BTC/ETH/USDC/USDT/EURR.
- **Codebase file:line** — `services/exchange.py` (`create_exchange`, `_fetch_raw_trades_bybit`, `fetch_daily_pnl` Bybit branch, `validate_key_permissions`, `normalize_symbol`, `EXCHANGE_CLASSES` incl. `deribit`), `services/funding_fetch.py` (`fetch_funding_bybit`, `_FUNDING_BUCKET_HOURS`, `_build_match_key`), `services/reconciliation.py` (`diff_strategy_fills` two-stage), `services/job_worker.py` (`run_reconcile_strategy_job`, `run_derive_broker_dailies_job`, `_exchange_preflight`/`_allocator_key_preflight`, `decrypt_credentials` usage), `services/broker_dailies.py` (`combine_realized_and_funding`), `services/encryption.py` (Fernet envelope), `services/geo_block.py` (`_GEO_BLOCK_MARKERS`, `is_geo_blocked`), `scripts/probe_exchange_egress.py`, migrations `csv_daily_returns` (per-key axis) + `trades_dedup_fill` (`exchange_fill_id` unique).
- **CONTEXT.md / REQUIREMENTS.md / ROADMAP.md / STATE.md** — locked decisions, DRB-01/BYB-01, grounding facts (Amsterdam egress verified, ccxt 4.5.59 pinned).

### Secondary (MEDIUM confidence)
- **`.planning/research/SUMMARY.md` + STACK/FEATURES/PITFALLS/ARCHITECTURE** (2026-07-04) — Deribit integration research; note its "Phase 67 = Egress Prerequisite" framing is superseded by the verified Amsterdam egress.
- Deribit API v2.1.1 docs (`docs.deribit.com`) — transaction-log / user-trades param + response field names [CITED; confirm empirically in the run].

### Tertiary (LOW confidence)
- Deribit funding/settlement semantics (support articles) — the netting shape is explicitly deferred to the live run; do NOT treat as settled.

## Metadata

**Confidence breakdown:**
- Standard stack / call shapes: HIGH — introspected against the installed 4.5.59; zero new deps.
- Architecture / reuse seams: HIGH — every reconciliation and dailies seam read at file:line and is directly reusable.
- Deribit runtime semantics (funding netting, instrument mix): MEDIUM — by design; the harness is the instrument that resolves them.
- Pitfalls: HIGH — grounded in the actual Bybit/funding code and #563 history.

**Research date:** 2026-07-04
**Valid until:** ~2026-08-04 for codebase seams (stable); the Deribit runtime answers are produced by this phase itself and supersede all hypotheses here.
