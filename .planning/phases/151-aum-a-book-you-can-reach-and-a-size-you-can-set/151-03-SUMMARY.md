---
phase: 151-aum-a-book-you-can-reach-and-a-size-you-can-set
plan: 03
subsystem: analytics-worker
tags: [mt5, aum-02, venue-dispatch, holdings, error-ux, concurrency]
requires:
  - services/mt5_concurrency.py (the ONE terminal-lock registry, plan 151-01)
  - services/mt5_client.py (Mt5Session, Mt5Client.account_info, Mt5AccountMismatchError)
  - services/closed_sets.py (mt5_enabled_server, MT5_DISABLED_DETAIL)
provides:
  - closed_sets.NON_CCXT_VENUES — the mirror of _make_exchange_client's non-ccxt branches
  - allocator_positions._NON_CCXT_HOLDINGS_FETCHERS — the venue → fetcher dispatch table
  - allocator_positions._fetch_mt5_account_rows — the MT5 account-equity holdings row
  - allocator_positions.AllocatorHoldingsSyncTransientError — str(self) IS end-user copy
  - UNSUPPORTED_VENUE_NOTE / MT5_NON_USD_NOTE / MT5_UNREACHABLE_NOTE / MT5_MISSING_ACCOUNT_REF_NOTE
affects:
  - services/job_worker.py (dedicated except arm + api_key_id threaded to the chokepoint)
  - plan 151-04 (registers "sfox" on this scaffolding)
tech-stack:
  added: []
  patterns:
    - "venue-STRING dispatch table mirroring the construction chokepoint (never hasattr/isinstance)"
    - "honest skip via the EXISTING warning channel (zero new plumbing, no new sync_status)"
    - "purpose-built exception whose str() IS the user-facing copy"
    - "contention oracle: hold the shared lock, assert the read BLOCKS"
key-files:
  created:
    - analytics-service/tests/test_allocator_positions_non_ccxt.py
  modified:
    - analytics-service/services/allocator_positions.py
    - analytics-service/services/closed_sets.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_mt5_sync_path.py
    - analytics-service/tests/test_mt5_concurrency.py
    - analytics-service/tests/test_allocator_positions.py
    - analytics-service/tests/test_job_worker_first_sync_marker.py
decisions:
  - "PRE login bracket only, no POST re-read — one economic read, and the login assertion is made on the very payload that supplies the equity"
  - "MT5 symbol = ACCOUNT-{api_key_id[:8]} — opaque, stable, never the broker login (decided before the first PROD write)"
  - "The terminal currency is VALIDATED against [A-Za-z]{2,10} before entering user-visible copy, not scrubbed"
  - "_MT5_DERIVE_READ_TIMEOUT_S is reused, deliberately — no new env knob for a strictly shorter read"
  - "A missing/blank currency skips as 'unknown'; never defaulted to USD (that is a fabricated 1.0 FX rate)"
metrics:
  duration: ~55 min
  completed: 2026-08-07
requirements: [AUM-02]
---

# Phase 151 Plan 03: Venue Dispatch + the MT5 Account-Equity Branch Summary

`fetch_allocator_holdings` now dispatches on the venue STRING at the one holdings
chokepoint, and an MT5 key contributes one `account_info().equity` row read under
the SAME terminal lock the derive job uses — so `api_keys.sync_error` carries
end-user copy instead of `"'Mt5Session' object has no attribute 'fetch_balance'"`.

## What Was Built

**The chokepoint (Task 1).** `fetch_allocator_holdings(exchange_name, exchange,
api_key_id=None)` opens with a dispatch table keyed on the venue string —
mirroring `job_worker._make_exchange_client`, the construction chokepoint this is
the consumer half of. Three outcomes, in order:

| Venue state | Result |
|---|---|
| registered in `_NON_CCXT_HOLDINGS_FETCHERS` | that fetcher runs |
| in `NON_CCXT_VENUES`, no fetcher yet | `([], UNSUPPORTED_VENUE_NOTE)` — honest skip |
| anything else | the existing ccxt dual-path body, **byte-unchanged** |

`AllocatorHoldingsSyncTransientError` carries end-user copy as its `str()`, and
`run_poll_allocator_positions_job` gained a dedicated `except` arm for it
positioned BEFORE the generic `except Exception` — the arm whose
`classify_exception` `str(exc)` fall-through stamped the PROD AttributeError.
It stamps `sync_status='error'` + the human copy and returns
`error_kind='transient'`, so the job retries instead of burning to permanent.

**The MT5 branch (Task 2).** `_fetch_mt5_account_rows` mirrors the derive arm's
terminal discipline minus the deal ledger: kill switch first → shared
per-terminal lock → `wait_for(to_thread(login → account_info))` → login bracket →
currency gate → fail-loud extraction → ONE row.

Economics: the row carries **`equity`**, not `balance`. MT5 equity is balance
plus the floating uPnL of open positions — the account's mark-to-market value,
which is the only honest AUM contribution. `quantity == value_usd == equity`,
`mark_price = 1.0` (USD cash-equivalent, the same convention the ccxt spot path
uses for stablecoins), and `entry_price` / `unrealized_pnl_usd` /
`cost_basis_usd` are `None` rather than a fabricated `0.0`.

## Why It Matters

`allocator_holdings` is UNIQUE on `(allocator_id, venue, symbol, asof)` with
**no `api_key_id` in the key**. A per-venue constant symbol would make the
founder's three MT5 accounts upsert over each other — AUM would report one of
them and the surviving row's attribution would flip between syncs. The
account-scoped `ACCOUNT-{api_key_id[:8]}` token is what makes three accounts three
rows. It is deliberately *not* the broker login: the symbol is user-visible in
the Holdings tab and rides inside commit scope-refs (T-151-06).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — missing critical functionality] The terminal's currency string was going to be echoed raw into a user-visible column**
- **Found during:** Task 2
- **Issue:** `MT5_NON_USD_NOTE.format(ccy=info.get("currency"))` interpolates
  BROKER-CONTROLLED text into `api_keys.sync_error`, which `AllocatorSyncStatus`
  renders verbatim. The plan said to apply `scrub_freeform_string` only "if any
  dynamic text is ever included (currently none)" — but the currency IS dynamic
  text from the terminal, so that premise did not hold.
- **Fix:** validate rather than scrub. Only a bare `[A-Za-z]{2,10}` code is
  echoed; anything else (including a missing/blank field) renders `"unknown"`.
  Validation is the stronger control here — scrubbing removes known secret
  shapes, whereas an allow-list rejects everything unanticipated. Pinned by
  `test_mt5_currency_is_never_echoed_raw_into_user_copy` (T-151-05 / ASVS V7).
- **Files modified:** `analytics-service/services/allocator_positions.py`
- **Commit:** `96279521`

**2. [Rule 2 — missing critical functionality] The symbol token was written unvalidated**
- **Found during:** Task 2
- **Issue:** `ACCOUNT-{api_key_id[:8]}` is HOLDING_REF_RE-safe for a UUID, but
  nothing enforced that. A malformed key id would write a token the commit
  route's ref parser rejects far downstream, long after the row landed.
- **Fix:** the built symbol is checked against `[A-Za-z0-9_-]+` before the row is
  returned; a failure raises the transient rather than writing a poisoned token.
- **Files modified:** `analytics-service/services/allocator_positions.py`
- **Commit:** `96279521`

**3. [Rule 1 — bug] A prose comment formed a literal `type: ignore` token**
- **Found during:** Task 2 mypy gate
- **Issue:** a comment explaining *why there is no silencing directive* wrapped
  such that the directive text began a line — mypy parsed it as a real one and
  failed with `Invalid "type: ignore" comment`.
- **Fix:** reworded so the token never appears at a comment position.
- **Files modified:** `analytics-service/services/allocator_positions.py`
- **Commit:** `96279521`

### Deviations Driven by Drift (hotfix PR #667 landed after the plan was written)

**The `isinstance(Mt5Session)` no-op is GONE, and its premises are recorded as
superseded.** #667's comment claimed holdings ingestion has "NO meaningful MT5
analog" and that "a live read HERE would sit outside that lock discipline". Both
are now false: `account_info().equity` IS the analog (and without it three funded
accounts contribute zero), and the lock is importable from
`services.mt5_concurrency` since 151-01. The replacement comment credits
MT5SYNC-01 and states what survives from it — never let raw Python reach
`sync_error` — which this plan generalizes from one venue to the whole class.

**The three `#667` wiring pins were updated deliberately, not deleted.**
`tests/test_mt5_sync_path.py` pinned the no-op (`mt5` → `([], None)` →
`sync_status='complete'`). Rewritten to the new contract:
- the fetch test SPLIT into a dark arm (kill-switch skip, zero terminal IPC) and
  a live arm proving the real equity row via `login` + `account_info`;
- the handler test now runs with `MT5_ENABLED=true`, so it pins a REAL sync
  reaching `complete` rather than a no-op completion.

**All anchors were located by symbol name.** Line numbers after `~:410` had
shifted ~+72. `_fetch_mt5_account_balance` (#667's `sync_trades` balance arm) is a
different read path and was left untouched.

### Deviation — plan gate command

The plan's `cd analytics-service && mypy .` is not this project's gate (it
reports ~5565 pre-existing errors in `tests/`). Ran the CI gate per the wave-1
handoff: `mypy --strict --follow-imports=silent services/ routers/ models/` →
**Success, 90 source files**.

### Deviation — call-shape updates in three existing test files

Three doubles for `fetch_allocator_holdings` had two-arg signatures and broke on
the new `api_key_id` kwarg. Each gained `api_key_id=None`; no assertion changed.
This is the exact exception the plan's acceptance criteria permitted.

## Design Decisions Taken (documented in code)

**PRE login bracket only, no POST re-read.** The derive arm brackets pre AND post
because it performs a second economic read (`history_deals_get`) after the first
assertion. Here there is exactly ONE economic read and the login assertion is
made on the very `account_info` payload that supplies the equity, so a mid-read
account switch cannot produce a wrong-account figure. A POST re-read would add a
round-trip and a failure mode for no additional guarantee. (RESEARCH Pattern 2
explicitly left this to the planner; taken and commented in place.)

**`stamp_first_sync_success` fires for an honest skip.** Accepted, and commented
at the skip return: the RPC gates a one-shot PostHog onboarding event only, and
treating an honest skip as a failure would be worse UX than an early ping.

**`_MT5_DERIVE_READ_TIMEOUT_S` reused, no new env knob.** The holdings read is
strictly shorter than the derive read the bound was sized for; a second knob is a
second thing to retune when the rpyc bound moves. `git diff | grep MT5_HOLDINGS`
→ 0.

## Falsifiers Observed (not merely asserted)

Every one of these was RUN, the failure output read, and the mutation reverted
from a file copy (never `git checkout`, which would have discarded uncommitted
work — as it did once mid-session; see Notes).

| Mutation | Test | Observed failure |
|---|---|---|
| dedicated `except` arm removed | Test 3 | `assert 'unknown' == 'transient'` — the job would NOT retry |
| `"mutantvenue"` added to `NON_CCXT_VENUES` only | Test 4b | `Extra items in the right set: 'mutantvenue'` |
| row built from `balance` instead of `equity` | Test 6 | `assert 120000.0 == 123456.78` — the economic oracle bites |
| private `_MT5_TERMINAL_LOCKS` declared locally | Test 10 | `DID NOT RAISE TimeoutError` — the read sailed through a HELD lock |

The last one is the point of the phase's concurrency work: the duplicate registry
handed out a perfectly functional `Lock`, so an "it acquired a lock" assertion
would have been GREEN under the exact defect. Only holding the shared lock and
asserting the read BLOCKS bites. The 151-01 identity test (extended here with an
`allocator_positions` arm, as its summary requested) caught the same mutation via
`is`.

## Verification

| Gate | Result |
|------|--------|
| `pytest tests/test_allocator_positions_non_ccxt.py -q` | 21 passed |
| Plan-final gate (non_ccxt + allocator_positions + mt5_client_contract + mt5_derive_branch + mt5_sync_path + mt5_concurrency + first_sync_marker) | 116 passed |
| **Full `pytest -q` from `analytics-service/`** | **4919 passed, 96 skipped, 0 failed** |
| **`mypy --strict --follow-imports=silent services/ routers/ models/`** | **Success, 90 source files** |
| New `# type: ignore` in the diff | 0 |
| `grep -rn "MUTANT" services/ tests/` | 0 |

Acceptance criteria, as specified:

| Criterion | Want | Got |
|---|---|---|
| `NON_CCXT_VENUES` in closed_sets | ≥1, exactly {mt5, sfox} | 1, exact |
| `hasattr` / `isinstance(exchange` in new dispatch code | 0 | 0 (2 hits, both prose in docstrings) |
| pre-existing `getattr(exchange, "id"...)` lines changed | 0 | 0 (absent from `git diff`) |
| `except AllocatorHoldingsSyncTransientError` in job_worker | 1, before the generic arm | 1 (`:7159` vs generic `:7197`) |
| `positions_get` in allocator_positions | 0 | 0 (facade pin untouched, contract suite green) |
| `ACCOUNT-` symbol format present | ≥1 | 1 |
| broker `login` used in the symbol | 0 | 0 |
| `MT5_HOLDINGS` env var in the diff | 0 | 0 |

Artifact minimums: `test_allocator_positions_non_ccxt.py` 714 lines (min 120);
`allocator_positions.py` provides `_NON_CCXT_HOLDINGS_FETCHERS`,
`_fetch_mt5_account_rows`, `AllocatorHoldingsSyncTransientError` and the four copy
constants; `closed_sets.py` provides `NON_CCXT_VENUES`. Key link
`allocator_positions → mt5_concurrency` present via
`from services.mt5_concurrency import`.

## Known Stubs

None. `_NON_CCXT_HOLDINGS_FETCHERS` has one live entry (`"mt5"`); `"sfox"` is
absent BY DESIGN and reaches the honest-skip arm — that is the shipped behaviour
for a venue whose fetcher plan 151-04 adds, not a placeholder. No hardcoded empty
values, no unwired data path.

## Threat Flags

None. No new network endpoint, auth path, file access pattern, or schema change —
the MT5 read reuses the existing gateway facade and the existing
`allocator_holdings` DDL. Dispositions from the plan's register:

- **T-151-05** (sync_error disclosure) — mitigated: fixed copy constants, the
  dedicated except arm preempting `classify_exception`, banned-substring
  assertions, and the added currency allow-list.
- **T-151-06** (symbol token) — mitigated: `ACCOUNT-{api_key_id[:8]}`, asserted
  not to contain the broker login.
- **T-151-07** (multi-account upsert) — mitigated: distinct-symbol assertion for
  two key ids; the full non-collapse oracle lands in 151-04.
- **T-151-08** (worker/terminal DoS) — mitigated: `wait_for` + `to_thread` +
  bounded restart INSIDE the shared lock; contention proven by a blocking test.
- **T-151-09** (wrong account) — mitigated: strict login equality on the payload
  that supplies the equity; a missing `login` field fails loud.
- **T-151-SC** — zero package installs.

## Notes for the Orchestrator / Plan 151-04

1. **The worktree spawned at the wrong base** (`e0493913`, missing wave 1). The
   `<worktree_branch_check>` reset block corrected it to `a213591a` before any
   work — recorded because it is the measured failure mode, not a hypothetical.
2. **`git checkout -- <file>` destroyed uncommitted work once** during a
   falsifier revert (the file's plan edits were staged nowhere). Recovered by
   re-applying. Subsequent falsifiers used a scratchpad file copy to revert.
   Worth adding to the executor's falsifier guidance: copy first, never
   `git checkout` a file with uncommitted plan edits in it.
3. **151-04 scaffolding is ready**: add `"sfox"` to
   `_NON_CCXT_HOLDINGS_FETCHERS` and the parametrized class-closure proof can
   iterate `NON_CCXT_VENUES` directly. Test 4b already gates factory drift.
4. **PROD UAT is still owed** (not in-phase, per the plan): after deploy, trigger
   "Sync now" on an MT5 key and confirm `sync_status` leaves `error` and
   `sync_error` contains no `AttributeError`. Note MT5 is gated by
   `MT5_ENABLED` on the worker — with it off, the honest skip stamps
   `complete_with_warnings` + "MT5 integration is not yet available."

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (RED) | `87ec5b93` | `test(151-03)`: failing tests for the non-ccxt dispatch |
| 1 (GREEN) | `d02d63dc` | `feat(151-03)`: dispatch non-ccxt venues at the ONE chokepoint |
| 2 (RED) | `c00561d5` | `test(151-03)`: failing tests for the MT5 account-equity branch |
| 2 (GREEN) | `96279521` | `feat(151-03)`: MT5 accounts contribute their equity |
