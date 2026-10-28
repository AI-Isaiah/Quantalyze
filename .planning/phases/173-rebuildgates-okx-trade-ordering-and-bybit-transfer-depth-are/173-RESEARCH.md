# Phase 173: REBUILDGATES - Research

**Researched:** 2026-10-28
**Domain:** the read-only allocator history probe (`analytics-service/scripts/allocator_history_probe.py`), the OKX `fills-history` ordering premise, Bybit v5 deposit/withdraw-record depth, and the post-deploy operator step that reads both gates
**Confidence:** HIGH on the code seams and the OKX ordering mechanics; MEDIUM on Bybit (the vendor docs state no retention, so depth can only be measured, never looked up)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Carried (not re-asked)
- TRADEPAGES 167.2.1.1.2.1 plan 06 gate wording: `okx-order: ok` when violations are 0, full-page stops are 0, and every account whose OKX read went past one page carries at least one ordering reading; `violated` when either count is above 0; `unmeasured` otherwise. `bybit-transfers: ok` only when every Bybit account whose window reaches 729 days back shows BOTH a deposit and a withdrawal older than 365 days.
- TRADEPAGES D-05: stored histories stay as recorded ("Accept as recorded").
- UPNLVENUES PD-H / PD-I: a forced rebuild writes only an anchored curve, otherwise refuses by name and writes nothing; no automatic re-crawl.
- OKXANCHOR 172: the forced-refusal vocabulary is a closed, pinned set; the probe's redaction contract (labels, counts, booleans, closed tokens, 3-significant-figure ratios, no id/amount/timestamp finer than the run date) stays.

#### D-01 OKX half: read the ordering without the anchor
Founder 2026-10-28, AskUserQuestion: "Read order without anchor (Recommended)".
The probe also takes its raw OKX fills-order read when the member is refused, so 173 measures OKX ordering on a4 now. Rebuilding a4 still waits on the bills-chain follow-up (OKXBILLSCHAIN).

#### D-02 Bybit depth: a 0 stays unmeasured
Founder 2026-10-28, AskUserQuestion: "0 stays unmeasured (Recommended)".
The strict rule applies: a per-kind count of 0 older than 365 days keeps that kind `unmeasured` and the gate stays shut for it. The probe records corroboration evidence (for example whether the account's oldest fill is older than its oldest deposit) for the founder to judge at the checkpoint; that evidence does not open the gate by itself. The probe carries per-kind counts (deposits and withdrawals older than 365 days) as permanent record fields; the pooled `transfers_older_365d` stays for lineage.

#### D-03 Probe mode: full probe, no transfers-only mode
Founder 2026-10-28, AskUserQuestion: "No, full probe".
This is a founder choice over the recommended transfers-only mode. The operator step re-runs the full probe; no transfers-only mode is built.

#### D-04 Rebuilds: decided in 173, none by default
Founder 2026-10-28, AskUserQuestion: "Decide in 173, none by default (Recommended)".
The post-deploy checkpoint records both gate readings (`okx-order:` and `bybit-transfers:`) and asks the founder which histories to rebuild. A forced rebuild runs in 173 only on an explicit yes; otherwise D-05 carries and the rebuild is booked as a follow-up.

### Claude's Discretion
- Exact record-field names for the per-kind counts and the corroboration evidence, within the existing emitter vocabulary and redaction contract.
- Whether the ordering read covers one instrument type (the busiest, as today) or every type that returned at least two rows, as long as each OKX member that read trades past one page carries at least one reading.
- Operator steps (Railway probe run, PROD marker query, any forced-rebuild enqueue) are checkpoint tasks for the orchestrator, never for a dispatched executor.

### Deferred Ideas (OUT OF SCOPE)
- Fixing a4's bills `chain_break` so its anchor can be checked and a4 rebuilt: the OKXBILLSCHAIN follow-up phase.
- A transfers-only probe mode: declined by the founder (D-03).
- Changing the OKX walk so it no longer relies on newest-first ordering.
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase requirement IDs: none (ROADMAP `Requirements: TBD`). The three ROADMAP success criteria are the contract.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | A multi-page OKX read records at least one ordering reading, so `okx-order:` reads `ok` or `violated`, never `unmeasured` | Q1, Q2: take the raw `fills-history` read on the refusal arm (and every other arm that holds OKX trades) from the call snapshot; add `okx_members_with_trades` so the gate is mechanical |
| SC-2 | Bybit deposit and withdrawal depth older than 365 days is measured per kind on a 730-day account | Q3: per-kind count fields, in-window totals and age buckets as corroboration, a code-derived per-account gate token |
| SC-3 | The gates' outcome decides, with the founder, which stored OKX and Bybit histories are rebuilt | Q4: operator checkpoint modeled on 172-05 and 167 plan 06 Task 1; D-04 question; the forced enqueue path if the founder says yes |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives that bind this phase (the project CLAUDE.md is large; only the ones this phase touches):

- **Which database am I on?** Run the `shobj_description(oid, 'pg_database')` marker query before ANY statement that writes. The CLI in the main checkout is linked to PRODUCTION. NULL = stop. `current_database()` proves nothing.
- **CHANGELOG discipline:** every ship writes a CHANGELOG entry in the same commit as the VERSION bump (`chore(release): vX.Y.Z.B`), grouped by theme, with the commit cross-check. `VERSION` and `package.json` stay byte-equal 4-digit strings. Never `npm version`.
- **CI skip trailer:** never write the skip tokens in a commit message or PR body, not even to deny them. Say "the skip trailer".
- **Public repo, tracked `.planning/`:** no secrets, PROD ids/uuids, home paths or account numbers in tracked text; never quote a search pattern as proof of absence. Probe output is labels, counts, booleans, closed tokens, 3-significant-figure ratios only.
- **No AI authorship attribution** in commits or PR text (founder 2026-10-20). Ship branch must change nothing under `.planning/`.
- **Completion is historical:** a VERIFICATION for this phase uses `verified_at_sha` + `drift_subjects`, never `covered_digest` / `covered_files`.
- **Analytics briefs carry CI's mypy line verbatim** (see Validation Architecture). pytest only from `analytics-service/`; always `grep -a`.
- **Never** `git checkout`/`restore`/`stash` uncommitted work; explicit `git add` paths; never add `AGENTS.md`. No `--linked`, no db push, no PROD/TEST/Railway access from a dispatched agent.
- **Data/safety:** PROD reads and writes are authorized for the ORCHESTRATOR (marker first); prefer the product's own paths (the enqueue RPC) over hand SQL writes; never invent data (an uncomputable metric is null/`field-absent`).

## Summary

The whole code change is localized to one file and its test: `analytics-service/scripts/allocator_history_probe.py` and `analytics-service/tests/test_allocator_history_probe.py`. Root cause of `okx_order_readings=0` is exactly as CONTEXT says: the raw `private_get_trade_fills_history` call lives in `_read_member` AFTER `er._fetch_and_price_window(..., require_anchor=True)`, and a refusal raises out of that function before the raw read. But the refusal is raised at the very END of `_fetch_and_price_window` (after the trade fetch, the transfer fetch, the OHLCV fetch and the anchor block), so on every refusal reason the recorder already holds the complete forced OKX pass. The busiest instrument type is therefore available from the call snapshot the refusal arm already takes.

Ordering can ONLY be measured from the raw answer: ccxt's `fetch_my_trades` for OKX parses the rows through `parse_trades_helper`, which `sort_by_2(result, 'timestamp', 'id')` ascending, so the venue's order is gone by the time the walk sees a page. One raw page per OKX member is what the carried gate wording needs ("every account whose OKX read went past one page carries at least one ordering reading"); a cross-page check is not required and is not recommended. The walk really does use `fills-history` (not `fills`).

For Bybit the rebuild reads deposits and withdrawals from 729 days back in 30-day windows through `fetch_ccxt_transfers`; Bybit's official v5 pages state NO retention period (only the 30-day interval and a 50-row page), so depth can only be measured. The probe already records every transfer as `(kind, id, timestamp)`, so the per-kind counts are a pure change of aggregation. The most probable live outcome is another pooled/per-kind 0 on a6 (the 2026-10-28 probe read a6 in full with `transfers_older_365d` 0), which under D-02 stays `unmeasured`; the corroboration fields are therefore the real deliverable for the founder checkpoint, and the plan must not promise a gate flip.

**Primary recommendation:** one code plan (same two files, so no parallel plans) that (1) factors the raw ordering read into a helper called from the success, refusal and truncated arms using the call SNAPSHOT, swallowing its failure into a closed failure-class field; (2) adds `okx_members_with_trades` and per-kind Bybit count/evidence fields plus code-derived gate tokens to the declared vocabulary; then ship, then ONE orchestrator checkpoint (the full probe, the two gate lines, the D-04 question, rebuilds only on an explicit yes).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Raw OKX fills ordering read | Analytics worker (probe script, Railway backfill worker) | Venue (OKX REST GET) | Keys are decrypted only inside the worker; the raw GET is the only way to see venue order |
| Per-kind Bybit transfer counts and corroboration | Analytics worker (probe) | Venue (Bybit REST GET via the rebuild's own `fetch_ccxt_transfers`) | The probe records the rebuild's own transfer read; no new venue call |
| Gate verdict derivation (`okx-order`, `bybit-transfers`) | Probe module (pure functions, printed as closed tokens) | Operator step (copies the tokens, never re-derives) | "If code can answer, code answers"; makes the strict D-02 rule a tested artefact |
| Output redaction / vocabulary | Probe emitter (`emit_record` whitelist) | `assert_sanitized` | Output is pasted into a tracked public file |
| Founder decision (which histories to rebuild) | Orchestrator checkpoint (AskUserQuestion) | Founder | D-04: decided in 173, none by default |
| Forced rebuild (only on an explicit yes) | Product RPC `enqueue_compute_job` -> worker `reconstruct_allocator_history` | PROD database | The product's own path; refusal writes nothing (PD-H) |
| Ledger close (TODOS, CHANGELOG, SUMMARY) | Orchestrator records PR / ship commit | - | `.planning/` never rides the ship branch |

## Standard Stack

No package is added or upgraded. All work is stdlib-only Python inside an existing module.

### Core (already in place, versions read this session)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt | 4.5.88 pinned in `analytics-service/requirements.txt` (`ccxt==4.5.88`) | OKX and Bybit client; probe wraps `fetch_my_trades`, `fetch_deposits`, `fetch_withdrawals` and calls `private_get_trade_fills_history` | The rebuild's own client (`_make_exchange_client`) |
| pytest + pytest-asyncio | repo pin (`asyncio_mode = auto` in `analytics-service/pytest.ini`) | Probe tests (84 pass at baseline) | Existing suite |
| mypy | 2.4.0 in the dev venv; config `[tool.mypy] strict = true` | Strict floor | CI gate |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New per-kind fields on the probe record | An ad hoc operator-written per-kind count (the TRADEPAGES plan 06 step 5 approach) | VERIFICATION of 167 flagged that as "more manual than the rest of the probe"; permanent record fields are D-02 |
| Code-derived gate tokens | Operator derives the gate lines from raw fields | Derivation in prose is what let 167's gate read `unmeasured` ambiguously; a pure function is testable and mutation-checkable |

**Installation:** none. **Version verification:** `ccxt==4.5.88` is the pin; the pinned wheel was downloaded to scratch and the relevant source read this session (see Q2). The dev venv in the main checkout runs ccxt 4.5.85 and an installed copy in the system interpreter is 4.5.64; the sort/endpoint facts below were read in BOTH 4.5.64 and 4.5.88 and are identical.

## Package Legitimacy Audit

No external package is installed or recommended by this phase. Nothing to audit. (`ccxt==4.5.88` is the existing pin; it was fetched from PyPI into scratch only to read source.)

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
run()  --(select api_keys, read-only wrapper)-->  per account label aN
   |
   v
_probe_account: choose job key, select members, window (OKX 89d | Bybit 729d)
   |
   v  for each OKX/Bybit member
_probe_member:  decrypt -> client -> _TradeRecorder(client)   [wraps fetch_my_trades,
   |                                                            fetch_deposits, fetch_withdrawals]
   |
   +--> er._fetch_and_price_window(require_anchor=True)
   |       1. trades   (OKX: per-instType backward walk on fills-history, params {"type": x})
   |       2. deposits, withdrawals (fetch_ccxt_transfers; Bybit 30-day windows from 729d back)
   |       3. OHLCV, replay, anchor block
   |       4. raise ForcedRebuildRefusedError(reason)   <-- AFTER 1-3, so recorder is complete
   |
   +-- success arm -------+
   +-- refusal arm  ------+--> SNAPSHOT calls/transfers  --> [NEW] raw fills-history GET on
   +-- truncated arm -----+                                  busiest type of the SNAPSHOT
   |                                                         (unwrapped: never in recorder)
   |                                   then (refusal only) _anchor_diagnostic (2nd advisory pass,
   |                                   fresh recorder; may NOT touch the snapshot)
   v
_MemberResult(order, calls, transfers, ...)
   |
   v
_probe_account aggregates:  okx_order_readings / violations / okx_members_with_trades
                            Bybit: deposits/withdrawals older 365d, in-window totals,
                                   oldest fill/deposit/withdrawal age buckets
   v
emit_record (whitelist) -> one JSON line per account + summary (+ [NEW] gate tokens)
   v
Operator (orchestrator): copies gate tokens into okx-order: / bybit-transfers: lines,
                         asks the founder (D-04), enqueues ONLY on an explicit yes
```

### Recommended Project Structure
```
analytics-service/
├── scripts/allocator_history_probe.py   # the only production file this phase edits
└── tests/test_allocator_history_probe.py  # the only test file (declared-vocabulary pins live here)
docs/runbooks/marksource-okx-history-correction.md  # P4 sentence names okx_order_readings: update wording
```

### Pattern 1: Snapshot first, then any further venue call (the separation rule)
**What:** the refusal arm snapshots `list(recorder.calls)` and `list(recorder.transfers)` BEFORE the diagnostic because the diagnostic builds `fresh = _TradeRecorder(client)` which re-wraps the same `client.fetch_my_trades`; the OLD recorder then also records the diagnostic's pass.
**When to use:** any new venue read added to a probe arm.
**Rule for the new ordering read:** pick the instrument type from the SNAPSHOT variable, never from the live `recorder.calls`, and take `elapsed_s` before the raw read so `read_elapsed_s` keeps meaning "the forced pass". The raw call goes through `client.private_get_trade_fills_history`, which the recorder does NOT wrap, so it can never enter `calls`.
**Example (shape, for the planner; not final code):**
```python
# Source: allocator_history_probe.py _probe_member refusal arm (existing snapshot lines) + _read_member (existing raw read)
calls = list(recorder.calls)            # existing
moved = list(recorder.transfers)        # existing
elapsed_s = _elapsed()                  # existing - keep BEFORE the new read
order, order_failure = await _okx_order_reading(client, venue, calls, window_start, end_date)  # NEW
diagnostic = None
if venue == "okx" and exc.reason == "anchor_skipped_implausible":
    diagnostic = await _anchor_diagnostic(client, supabase, window_start, end_date)  # existing
```

### Pattern 2: Fail-safe measurement (absence is a reading of nothing)
`okx_newest_first` returns `field-absent` when the answer cannot say. A raw read that RAISES must not change the member's outcome (a refusal stays the refusal) and must not count as a reading. Record its allow-listed class (`classify_failure`) in a new `okx_order_failure_class` field so "the GET failed" is distinguishable from "the answer could not say". The raw read has never run live (a4 was always refused or chain-broken before it), so its parameter form is unexercised against the real venue: the first live run is the test, and the failure class is how a wrong parameter shows up.

### Anti-Patterns to Avoid
- **Taking the instrument type from the live `recorder.calls` after the diagnostic.** The diagnostic's pass would be counted; a mutation test with a diagnostic pass on a different type catches it.
- **Writing `enqueue`, `.rpc(`, `withdraw(` or `transfer(` anywhere in the probe source,** even in a docstring or a helper name. `test_the_probe_source_calls_no_writer` greps the source for `enqueue` and `.rpc(`; `test_the_probe_source_calls_no_venue_write` matches `\b(create_order|cancel_order|withdraw|transfer)\(`. A helper named `withdrawals_older_than(` is fine (`withdraw` is followed by `s`); `transfer(` is not.
- **A new key whose name contains `secret`, `token`, `api_key`, `apikey` or `password`.** `assert_sanitized` removes/raises on those substrings (`_DENY_KEY_SUBSTRINGS`). Do not name a gate field `..._token`.
- **Opening the Bybit gate from corroboration.** D-02: evidence informs the founder, the gate token stays strict.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Age buckets for oldest fill / deposit / withdrawal | A new bucketing function | `window_age_bucket(since_ms, run_day)` with `_WINDOW_AGE_BUCKETS` (`none`, `0-29`, `30-89`, `90-179`, `180-364`, `365-546`, `547-729`, `730+`) | Closed edges already pinned by `test_window_age_buckets_have_closed_edges`; same redaction class as `last_window_age_bucket` |
| Distinct per-kind transfer counts | A second dedupe | `transfers_older_than(transfers, cutoff_ms)` filtered by kind (its dedupe key already includes the kind) | Same `(kind, id)` semantics as the pooled count; `flow_events_in_window` already uses `cutoff = _day_ms(end_date + 1 day)` for "all in window" |
| Ordering test of a raw answer | A new comparator | `okx_newest_first(raw)` | Pinned semantics: `True` non-increasing with first later than last, `False` if ts rises anywhere, `field-absent` when it cannot say |
| Failure class of a swallowed read | Free-text | `classify_failure(exc)` / `_FAILURE_CLASSES` | Never reads the message; a ccxt message can carry a signed URL |
| Forced rebuild enqueue | Hand SQL INSERT into `compute_jobs` | `public.enqueue_compute_job(p_strategy_id := NULL, p_kind := 'reconstruct_allocator_history', p_api_key_id := <job key>, p_metadata := jsonb_build_object('force_rebuild', true))` | The product path; PD-H guarantees a refusal writes nothing |
| Vocabulary validation | `isinstance` checks inline | `_is_count`, `_is_count_or_absent`, `_is_bool_or_absent`, `_is_one_of(...)` in `_ACCOUNT_VALIDATORS` / `_SUMMARY_VALIDATORS` | `emit_record` refuses any key or value outside them |

**Key insight:** every piece of this phase is an aggregation or an ordering of data the probe already records in memory; the only NEW venue call is one raw GET per OKX member.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted per the template, with one explicit note: the probe writes nothing, and the optional forced rebuild (D-04, only on an explicit yes) is the only state-changing act; its inventory is the existing runbook's B'1/B'2 before-picture.

## Common Pitfalls

### Pitfall 1: Ordering "measured" on the wrong page set
**What goes wrong:** the busiest type is chosen from a recorder that already includes the diagnostic's second pass.
**Why:** the diagnostic re-wraps the same client (`_TradeRecorder.__init__` replaces `client.fetch_my_trades` again), so the older recorder keeps appending.
**How to avoid:** choose from the snapshot variable; test with a diagnostic pass on a different instrument type than the forced pass.
**Warning signs:** the raw call's `instType` differs from the forced pass's busiest type.

### Pitfall 2: A swallowed raw-read failure looks like "unmeasured" forever
**What goes wrong:** `okx_order_readings` stays 0 and the operator cannot tell a wrong parameter from an answer that cannot say.
**How to avoid:** `okx_order_failure_class` (closed `_FAILURE_CLASSES`) beside the reading; a reading count below `okx_members_with_trades` with failure class `none` means "answer could not say".

### Pitfall 3: Pooled/zero transfer counts read as a verdict
**What goes wrong:** a 0 is read as "Bybit does not serve it" or "the account has none" (TRADEPAGES REVIEW-3 WR-07 and WR-05). Both are unsupported.
**Why it is worse than that:** the rebuild's transfer read is ON-CHAIN ONLY. Bybit's deposit endpoint is titled "Get Deposit Records (on-chain)" with internal deposits on a separate "Get Internal Deposit Records (off-chain)" endpoint, and the withdraw-record `withdrawType` defaults to `0` (on chain). ccxt 4.5.88 `fetch_withdrawals` sends no `withdrawType`, and `fetch_deposits` is the on-chain endpoint. An account funded by an internal or sub-account transfer has zero on-chain deposits at every age, so a 0 can come from the funding route, not from depth. See Open Question 2.
**How to avoid:** record in-window totals and oldest-bucket evidence; keep the gate strict; say plainly in the checkpoint that a 0 is not a depth finding.

### Pitfall 4: Per-kind positives are sound, zeros are not
A positive per-kind count older than 365 days is evidence that the venue serves that depth for that kind, even from a member whose later steps failed (the transfers are read before OHLCV and the anchor). Only a 0 is ambiguous. Do not make the Bybit gate token depend on `members_failed`.

### Pitfall 5: Summing across members hides a member-level pooled error
`_probe_account` sums over `results`. For an account with two Bybit members (one exchange account under several logins is intended per project memory), kind A could be served by member 1 and kind B by member 2. Acceptable for the account-level gate, but name it in the record docs.

### Pitfall 6: The a6 read is long
`read_elapsed_s` for a6 was 1048 s on 2026-10-28 against `_RECONSTRUCT_CRAWL_TIMEOUT_S` 1500.0 (read this session: `0 16 57 11 ... 100 1500.0`). The transfers are fetched AFTER the trades, so a timeout loses the transfers. Run in the background, record `read_elapsed_s`, keep the existing clock rule (a Bybit crawl that crosses UTC midnight is refused), start no later than 23:30 UTC and expect about 18 minutes.

### Pitfall 7: The two TODOS close conditions are looser than the gates
`167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED` closes "when deposits and withdrawals older than 365 days are counted separately on a real Bybit key". Counting 0 and 0 satisfies that literally while the GATE stays shut (D-02). The records PR must not read "closed" as "gate open"; book the residual explicitly if the counts are 0 (see Open Question 3).

### Pitfall 8: Existing tests that drive an OKX refusal will start making a raw call
After the change, any test whose OKX member is refused (e.g. `test_an_implausible_okx_refusal_is_measured_and_still_refused`) triggers the raw GET on the stub (`_StubVenue.private_get_trade_fills_history` returns `_order_raw`, default `None`, which `okx_newest_first` reads as `field-absent`). They keep passing, but `_OkxAnchorVenue.__init__` does not accept `order_raw`, so new tests must set the attribute or extend the constructor.

## Q1 - The ordering read on the refusal arm (D-01)

**Where the read sits today.** [VERIFIED: analytics-service/scripts/allocator_history_probe.py, `_read_member`] Quote: `rows, _hit_terminus, telemetry = await er._fetch_and_price_window(` ... `client, venue, supabase, window_start, end_date, require_anchor=True` then `inst_type = _busiest_inst_type(recorder.calls) if venue == "okx" else None` then `raw = await client.private_get_trade_fills_history(` with keys `"instType": inst_type`, `"begin": str(_day_ms(window_start))`, `"end": str(_day_ms(end_date + timedelta(days=1)))`, `"limit": str(_OKX_PAGE_ROWS)` and `order = okx_newest_first(raw)`.

**Why the refusal arm has none.** [VERIFIED: analytics-service/services/equity_reconstruction.py `_fetch_and_price_window`, order of statements] `trades, hit_terminus = await _fetch_trades_with_pagination(` precedes `deposits = await fetch_ccxt_transfers(`, which precedes the OHLCV passes, `_compute_daily_equity`, the anchor block, and finally `if require_anchor and rows:` ... `raise ForcedRebuildRefusedError(`. So every refusal reason raised from this function (`anchor_unreadable`, `anchor_skipped_okx_terminus`, `anchor_skipped_partial_ticker`, `anchor_skipped_unreliable_replay`, `anchor_skipped_implausible`) comes after a complete trade read. `positions_unreadable` is raised inside `_fetch_current_equity(..., refuse_unread_positions=True)`, also after the trade read.

**Is the busiest instrument type available from refusal-arm recorder calls?** Yes. [VERIFIED: equity_reconstruction.py `_fetch_okx_inst_type_trades`] the walk calls `exchange.fetch_my_trades(None, since_ms, _TRADE_PAGE_LIMIT, params)` with `params: dict[str, Any] = {"type": inst_type.lower()}`; [VERIFIED: allocator_history_probe.py `_describe_call`] the recorder reads `params = args[3] if len(args) > 3 else kwargs.get("params")` into `_Call.params`; `_passes` groups on `call.params.get("type")` and `_busiest_inst_type` upper-cases the winner. The refusal arm's `calls = list(recorder.calls) if recorder is not None else []` therefore carries `{"type": "swap"}`-style params.

**Do not count it as the forced pass.** The raw call is `client.private_get_trade_fills_history`, which `_TradeRecorder` does not wrap (it wraps only `fetch_my_trades`, `fetch_deposits`, `fetch_withdrawals`), so it never enters `recorder.calls` and cannot move `trade_calls`, `trades_read`, `first_page_rows`, or `okx_passes_ended_full`. The only discipline needed is to choose the type from the snapshot and to take `elapsed_s` before the read.

**Recommended structure.**
1. Extract lines "inst_type ... order = okx_newest_first(raw)" into `async def _okx_order_reading(client, venue, calls, window_start, end_date) -> tuple[bool | str | None, str]` returning `(order, failure_class)`. `None` = not attempted (non-OKX, or no inst type). Wrap the GET in `try/except Exception` -> `(None, classify_failure(exc))` and bound it with `asyncio.wait_for(..., er._RECONSTRUCT_CRAWL_TIMEOUT_S)` as `_anchor_diagnostic` does. Never reads the message.
2. Success arm: `_read_member` calls the helper with `recorder.calls` (no diagnostic has run yet). Behavior change to note: today a raising raw read inside `_read_member` flips the whole member to a failure class; with the helper it is recorded as `okx_order_failure_class` and the member stays read. That is intended (the ordering is a side measurement) but it changes an existing path, so it needs its own test.
3. Refusal arm (all refusal reasons, including the "other" out-of-vocabulary branch): call the helper after the snapshot and before `_anchor_diagnostic`; pass `order` into both `_MemberResult(...)` returns.
4. Generic exception arm: call the helper only when `venue == "okx"` and `isinstance(exc, er.TruncatedTradeRead)` (a truncated OKX member did read trades); every other class (auth, network, timeout) skips it.

**Non-refusal exception (e.g. truncated): needed?** For SC-1 and D-01 as measured on a4, no (a4 is a refusal). For the TODOS closure wording it is: "`okx_order_readings` equals the number of OKX members that read trades" quantifies over members that read trades, and a truncated OKX member read trades. Its `okx_passes_ended_full` would normally already make the gate `violated`, so the reading adds diagnosis (is the stop an ordering problem?) rather than a gate flip. Cost is one condition. Recommended, small. Planner may drop it if it prefers the strict D-01 wording; then the closure sentence must say "refused or read".

**What the TODOS closure implies for record fields.** [VERIFIED: TODOS.md heading `### 167.2.1.1.2.1-OKX-ORDER-UNMEASURED`] Quote: "Closed when `okx_order_readings` equals the number of OKX members that read trades and violations are 0, or the walk is changed to not rely on it." Today no record field counts "OKX members that read trades": `okx_members` counts SELECTED members, `members_read` counts members whose read succeeded (a refused member is not "read"), and `trades_read`/`first_page_rows` are summed over every venue in the account. For a4 (one OKX member) it is derivable by eye; for a multi-member account it is not. Add:

| Field | Where | Meaning | Validator |
|-------|-------|---------|-----------|
| `okx_members_with_trades` | account and summary | OKX members whose snapshot held at least one trade (`trades_read(calls) > 0`) | `_is_count` |
| `okx_order_readings` | summary (account already has it) | total readings | `_is_count` |
| `okx_order_failure_class` | account | first allow-listed class of a raw read that raised, else `none` | `_is_one_of(_FAILURE_CLASSES)` |

Gate (code-derived, printed on the summary as `okx_order_gate` in `("ok", "violated", "unmeasured")`):
- `violated` when `okx_order_violations > 0` or `okx_passes_ended_full > 0` (precedence first, as plan 06 wrote it);
- `ok` when `okx_members_with_trades >= 1`, `okx_order_readings == okx_members_with_trades` and neither count above is positive;
- `unmeasured` otherwise (including zero OKX members with trades: absent evidence is never `ok`).
This is stricter than the carried wording ("every account whose OKX read went past one page"): whenever it says `ok`, the carried wording is satisfied, and it matches the TODOS closure sentence. State this in the plan so the founder sees it is a tightening, not a new rule.

**Ordering read scope (Claude's discretion).** Recommend the busiest type only, one reading per member, so the closure equality holds. No next-type fallback: if the busiest type's raw page cannot say (fewer than two rows, equal timestamps) the honest outcome is `unmeasured`. A member that read past one page has a busiest pass of more than 100 rows by definition, so its raw page is full and informative.

## Q2 - ccxt, the endpoint, and one page vs more

**Does ccxt re-sort fills?** Yes, ascending. [VERIFIED: pinned wheel ccxt 4.5.88, ccxt/base/exchange.py `parse_trades_helper`] Quote: `result = self.sort_by_2(result, 'timestamp', 'id')` followed by `return self.filter_by_symbol_since_limit(result, symbol, since, limit)`; `def sort_by_2(array, key1, key2, descending=False)` defaults to ascending. [VERIFIED: same wheel, ccxt/async_support/okx.py `fetch_my_trades`] ends with `data = self.safe_list(response, 'data', [])` / `return self.parse_trades(data, market, since, limit, query)`. The same lines exist in the installed 4.5.64 (`async_support/okx.py:4782-4783`, `base/exchange.py:5343-5345`). Consequence: the walk's pages arrive ascending regardless of what OKX sent, so ordering is measurable ONLY from the raw `private_get_trade_fills_history` answer. (The existing probe tests already assume this.)

**Is `fills-history` what the walk uses?** Yes. [VERIFIED: ccxt 4.5.88 okx.py `fetch_my_trades`] Quote: `response = await self.privateGetTradeFillsHistory(self.extend(requestUntil, query))`, with `request['begin'] = since` and `handle_until_option('end', ...)`. [VERIFIED: equity_reconstruction.py] `_fetch_okx_inst_type_trades` calls only `exchange.fetch_my_trades(None, since_ms, _TRADE_PAGE_LIMIT, params)`, `params["until"] = end_ms` after the first page; the 90-day figure is `OKX_TRADE_TERMINUS_DAYS: int = 90` and the OKX window is 89 days (`_account_rebuild_window`). The `trade/fills` endpoint (3 days) is never called: `grep` of the pinned wheel shows `'trade/fills'` appears only in the endpoint table (`okx.py:360`, cost 1/3) and `'trade/fills-history'` at `okx.py:361` (cost 2).

**What the walk actually depends on.** [CITED: `_fetch_okx_inst_type_trades` docstring] "OKX's fills-history answers the NEWEST fills of its range, at most 100 per page ... each later page asks for fills up to ONE MILLISECOND past the oldest fill read so far." The premise is "each page is the newest 100 of [begin, end]". If OKX instead returned the OLDEST 100, the second request (`end = oldest + 1`, about `begin`) would return almost nothing and the pass would end on a short page without error: a silent truncation, which is why the gate exists. Within-page order is the direct, cheap proxy for that premise: a descending page of 100 rows from the full window is the newest 100; an ascending page is the oldest 100.

**One raw page per member: enough?** Yes for SC-1 and for the carried gate wording, which asks for "at least one ordering reading" per account whose read went past one page. Both the raw call's `limit` (`"100"`) and the window (`begin` = window start, `end` = end of run day) are the walk's own first-page shape. A cross-page check is available at no extra venue cost from the recorder (a later page's newest timestamp should not exceed the earlier page's oldest + 1), but it re-tests only that OKX honors `end`, adds vocabulary, and is not requested. Recommendation: do not build it (Rule 2). The a4 pass of 22 calls over a 1282-trade read already exercised multi-page `end` bounds live without a stop.

**Risk to flag.** [VERIFIED: 167 plan 06 SUMMARY and 172-05 SUMMARY: `okx_order_readings` 0 on a4 both times] The raw GET with these exact parameters has never returned an answer live. Everything else about the OKX read is proven; this one call is not. Hence the failure-class field.

## Q3 - Bybit transfer depth

**How the rebuild reads transfers.** [VERIFIED: equity_reconstruction.py `_fetch_and_price_window`] `transfers_since_ms = start_ms`; `deposits = await fetch_ccxt_transfers(exchange, "deposits", transfers_since_ms, now_ms)` and the same for `"withdrawals"`. The start is the window start: [VERIFIED: equity_reconstruction.py `_account_rebuild_window` docstring/return] a Bybit account window is `_bybit_window_start(end_date)` = `end_date - timedelta(days=BYBIT_TRADE_TERMINUS_DAYS - 1)` (729 days, `BYBIT_TRADE_TERMINUS_DAYS: int = 730`). [VERIFIED: analytics-service/services/ccxt_flow_fetch.py:77-80] Quote: `exchange_id = getattr(exchange, "id", "")` / `window_days = 30 if exchange_id == "bybit" else 90` / `window_ms = window_days * 24 * 60 * 60 * 1000` / `page_limit = 500`. So about 25 thirty-day windows per kind, each call passing `{"until": window_end}`; the loop advances `inner_cursor = max_ts + 1` and does not use Bybit's `nextPageCursor`.

**What Bybit v5 says (official pages, fetched this session).**
- Deposits: [CITED: https://bybit-exchange.github.io/docs/v5/asset/deposit/deposit-record] title "Get Deposit Records (on-chain)"; "`endTime` - `startTime` should be less than 30 days. Query last 30 days records by default."; page "Limit for data size per page. [`1`, `50`]. Default: `50`"; "Please note that data generated before Jan 1, 2024 cannot be queried using txID". The page states no general retention and no sort order. Internal deposits are a separate endpoint (the sidebar lists "Get Internal Deposit Records (off-chain)").
- Withdrawals: [CITED: https://bybit-exchange.github.io/docs/v5/asset/withdraw/withdraw-record] "`endTime` - `startTime` should be less than 30 days. Query last 30 days records by default."; "withdrawType | false | integer | Withdraw type. `0`(default): on chain. `1`: off chain. `2`: all"; page limit [1, 50]; no retention, no sort order stated.
- Changelog: [CITED: https://bybit-exchange.github.io/docs/changelog/v5, first 100000 characters only] deposit-record entries concern new fields and statuses (2025-06-12, 2026-06-10, 2026-07-10, 2026-07-16); none states a retention change. The remaining 107k characters were not read.
- No official statement of a 365-day or 2-year cap was found. Per the absent-evidence rule this is NOT a finding that no cap exists. `[ASSUMED]`: Bybit may or may not serve deposits/withdrawals past 365 days; only the live per-kind count can say, and only when positive.
- A single-user Koinly report that deposits from January 2022 could be downloaded via the API is [ASSUMED] anecdotal, unofficial, and not used as evidence.

**ccxt mapping.** [VERIFIED: ccxt 4.5.88 bybit.py `parse_transaction`] `timestamp = self.safe_integer_2(transaction, 'createTime', 'successAt')` (withdrawals carry `createTime`, deposits `successAt`) and `'id': self.safe_string_2(transaction, 'id', 'withdrawId')`. The deposit sample in the ccxt source carries no `id`, so deposit rows probably have `id` None: `transfers_older_than` then counts a no-id event once per appearance, so a deposit-kind COUNT can double-count a row returned by two overlapping windows, while "at least one" and "oldest timestamp" stay sound. `[ASSUMED]` (read from the sample comment, not observed live). Also `fetch_withdrawals` builds `request` with `coin`, `startTime`, `limit` and `endTime` only, so `withdrawType` is the API default `0`.

**Record design (within the redaction contract; labels, counts, booleans, closed tokens).** Reuse `_is_count` and `_is_one_of(_WINDOW_AGE_BUCKETS)`; no float, no timestamp.

| New account key | Meaning | Validator |
|-----------------|---------|-----------|
| `deposits_older_365d` | distinct deposit events stamped before `_day_ms(end_date - 365d)` (the cutoff the pooled field already uses) | `_is_count` |
| `withdrawals_older_365d` | same for withdrawals | `_is_count` |
| `deposits_in_window` | distinct deposit events seen anywhere in the read (cutoff `_day_ms(end_date + 1d)`, as `flow_events_in_window` does) | `_is_count` |
| `withdrawals_in_window` | same for withdrawals | `_is_count` |
| `oldest_fill_age_bucket` | `window_age_bucket(min(call.oldest_ts), end_date)` over the snapshot calls | `_is_one_of(_WINDOW_AGE_BUCKETS)` |
| `oldest_deposit_age_bucket` | bucket of the oldest deposit timestamp | same |
| `oldest_withdrawal_age_bucket` | bucket of the oldest withdrawal timestamp | same |
| `bybit_transfers_gate` | `not-applicable` / `ok` / `unmeasured` (below) | `_is_one_of(("not-applicable", "ok", "unmeasured"))` |

`transfers_older_365d` stays exactly as is (D-02 lineage); a test pins pooled = deposits + withdrawals older. Defaults in `_account_record`: counts 0, buckets `"none"`, gate `"not-applicable"`.

**Gate token (code-derived, strict).** `not-applicable` unless `bybit_members >= 1` and `window_days == 730` (the window then reaches 729 days back; `window_days` is 730 also for a no-Bybit/no-OKX account, hence the `bybit_members` condition). `ok` only when `deposits_older_365d >= 1` AND `withdrawals_older_365d >= 1`. Otherwise `unmeasured`. A pooled count can never open it (the WR-07 case: a deposit 500 days ago and no withdrawal returns `unmeasured`).

**Corroboration, how the founder reads it (record these in the SUMMARY, do not let them flip the gate).**
- Kind count > 0 older than 365: that kind is served at least that far. Evidence for the gate.
- Kind count 0 and `*_in_window` 0: the account has no on-chain transfers of that kind at all in 729 days; the read says nothing about depth (and see Pitfall 3 about internal transfers).
- Kind count 0, `*_in_window` > 0, oldest fill bucket in `365-546` / `547-729`, oldest transfer bucket `180-364` or younger: the account traded for over a year before its first served transfer of that kind. Suggestive of a depth limit or of off-chain funding; not conclusive (equal buckets are inconclusive: the 365-546 bucket is 182 days wide).
- Oldest fill bucket `180-364` or younger: no information about depth beyond a year at all.

**Which tests pin the vocabularies** (`analytics-service/tests/test_allocator_history_probe.py`):
- `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens`: asserts `set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))`. Every new key needs a default in `_account_record` AND an entry in `ACCOUNT_RECORD_KEYS` and `_ACCOUNT_VALIDATORS`, or `validate_record` raises on every record.
- `test_the_emitter_refuses_a_key_or_a_value_outside_the_vocabulary`, `test_the_emitter_refuses_an_out_of_vocabulary_site_or_bucket`, `test_the_diagnostic_keys_refuse_values_outside_their_vocabulary`: pattern to copy for the new keys.
- `test_run_end_to_end_prints_one_record_per_account_and_a_summary`: asserts the summary dict by EQUALITY (it lists exactly `record, run_date, accounts, accounts_read, accounts_comparable, accounts_trades_beyond_first_page, accounts_differing, trades_read, days_compared, okx_order_violations, okx_passes_ended_full`). Adding summary keys requires editing that expected dict.
- `test_a_truncated_bybit_read_names_the_window_ceiling_from_the_call_log`: `assert set(summary) == set(hp.SUMMARY_RECORD_KEYS)` (follows the declaration; no edit if keys are added to both).
- `test_transfer_events_older_than_365_days_are_counted_per_account`: the fixture (d1 and d3 deposits older, d1 withdrawal older under the same id, d2 exactly at the cutoff) is the natural base for the per-kind assertions (`deposits_older_365d == 2`, `withdrawals_older_365d == 1`, pooled still 3).
- `test_the_probe_source_calls_no_writer`, `test_the_probe_source_calls_no_venue_write`, `test_every_rebuild_name_the_probe_reads_is_declared`: static pins (see Anti-Patterns). New code reads no new `er.` attribute, so `DEPLOYED_ER_NAMES` does not change.

## Q4 - The operator step

**Model.** [CITED: 172-05-PLAN.md (the sibling 172 checkout, not present in this one), Task 1] preconditions with `deployed-commit:`, an import check, the probe run through a temporary start-command wrapper in the BACKGROUND with `probe-exit:` printed and the normal start exec'd, `railway redeploy --from-source`, restore at once with `worker-restored: yes`, `{"`-lines pasted into a SUMMARY section, label identification, outcome lines, `rebuilds-enqueued: 0`, scratch dir deleted, and a single automated verify string. [CITED: 167.2.1.1.2.1-06-PLAN.md Task 1 steps 4 and 5] the gate-line derivation. Operator is the ORCHESTRATOR under the standing PROD authorization; never a dispatched executor.

**Hard constraints to copy.** Never `railway ssh` (broken); no SQL from a dispatched agent; no probe run between 23:30 and 00:30 UTC; scratch dir outside the repo, deleted at the end; tracked text holds labels, counts, booleans, tokens and 3-significant-figure ratios only; uuid and ten-plus-digit grep gates on the SUMMARY.

**Preconditions.** PR merged; `gh api "repos/AI-Isaiah/Quantalyze/actions/runs?head_sha=<merge sha>" -q '.workflow_runs | length'` plus conclusions bound to the head SHA; Railway deployed that head; clock outside 23:30-00:30 UTC (and allow about 18 minutes). Record `deployed-commit: <sha>` (the commit that actually ran, as 172-05 did when a later main head ran).

**Import check (value updates).** 172-05 printed `0 16 True 0.05 True`, 16 because Phase 171 added `account_key_read_stalled`; [VERIFIED this session by running the module: `print(p.EXIT_OK, len(e.FORCED_REBUILD_REFUSAL_REASONS), len(p.ACCOUNT_RECORD_KEYS), len(p.SUMMARY_RECORD_KEYS), ...)` printed `0 16 57 11`]. New check, with the new count after the code lands: `python -c 'import scripts.allocator_history_probe as p, services.equity_reconstruction as e; print(p.EXIT_OK, len(e.FORCED_REBUILD_REFUSAL_REASONS), "okx_members_with_trades" in p.ACCOUNT_RECORD_KEYS, "deposits_older_365d" in p.ACCOUNT_RECORD_KEYS)'`, expected `0 16 True True`; write the verify regex for 16, not 15 (172-05's verify failed on exactly this).

**Probe run.** Full probe, D-03 (no transfers-only mode). It runs a1..a6 in order; a4 about 32 s, a6 about 1048 s. Exit is 1 whenever a member is refused (a4 always), so nothing may depend on exit 0. Railway's log view re-prints each record as `key=value`; rebuild the JSON lines from those attributes exactly as 172-05 did and say so.

**Gate lines the SUMMARY must hold** (derived by the probe's tokens, copied not re-derived):
- `okx-order: ok|violated|unmeasured` from the summary record's `okx_order_gate`, plus `okx-order-reading: readings=<n> members_with_trades=<n> violations=<n> passes_ended_full=<n> failure_class=<c>` from a4's record.
- `bybit-transfers: ok` when no account is `unmeasured`, else `bybit-transfers: unmeasured (<labels>)` naming each account whose `bybit_transfers_gate` is `unmeasured`.
- `bybit-transfers-kinds: <label> deposits=<n> withdrawals=<n>` from `deposits_older_365d` / `withdrawals_older_365d`.
- `bybit-transfers-evidence: <label> deposits_in_window=<n> withdrawals_in_window=<n> oldest_fill=<bucket> oldest_deposit=<bucket> oldest_withdrawal=<bucket>` (corroboration, D-02).
- `probe-exit: <n>`, `worker-restored: yes`, `a4-label:`, `a6-label:` (identified by shape: a4 = the only record with `okx_members` 1 and `window_days` 90; a6 = `bybit_members` 1 and `window_days` 730; exactly one match or STOP).

**Founder question (D-04), one AskUserQuestion carrying a recommendation.** Present both readings and ask which histories to rebuild. Recommendation: none. Reasons to state in the question: (1) a4 is the only OKX account and its forced read still refuses `anchor_skipped_implausible` (bills `chain_break`), so a forced OKX job would refuse by name and write nothing until OKXBILLSCHAIN lands; (2) the stored-row OKX rewrite is Phase 178 OKXREWRITE (ROADMAP: "Depends on: Phase 173"), which waits on this gate reading `ok`; (3) a Bybit 730-day rebuild needs `bybit-transfers: ok` for that label, and a 0 per kind stays `unmeasured` under D-02. Options: "No rebuild, book follow-ups (Recommended)"; "Rebuild <label list> now" (only offered for labels whose gate allows it, or with an explicit `*-override:` line that names the scope); "Hold, re-probe later". Record the answer verbatim: `rebuild-decision: <verbatim>`, and when it lifts a gate the plan-06 forms `okx-gate-override: <verbatim> (scope: <labels>)` / `bybit-transfers-override: <verbatim> (scope: <labels>)`, written only after the answer. On "no": `rebuilds-enqueued: 0`.

**If the founder says yes, what a forced rebuild looks like.** [CITED: docs/runbooks/marksource-okx-history-correction.md, "B'3a/B'3b/B'3c" and its `<!-- form: enqueue -->` block; the Bybit form is the ACCTREBUILD handoff in `.planning/phases/167.2.1.1.2-acctrebuild-*/167.2.1.1.2-09-PLAN.md`] Marker query first (must name PRODUCTION; NULL stops); B'1 census and prediction read-only; B'2 before-picture to scratch only; B'3a in-flight check (`reconstruct_jobs_in_flight` 0, record `t0`); B'3b exactly ONE job per account through the RPC:
`public.enqueue_compute_job(p_strategy_id := NULL, p_kind := 'reconstruct_allocator_history', p_api_key_id := <job key>, p_metadata := jsonb_build_object('force_rebuild', true))` inside a `DO $guard$` marker check, job key = earliest-created working Bybit key else earliest-created working OKX key (the probe's own `choose_job_key`); re-read the latest `enqueue_compute_job` definition across migrations and the baseline first; B'3c new-job proof (`created_at >= t0` and `metadata -> 'force_rebuild' = 'true'::jsonb`; a returned id is not proof); B'4 wait to terminal; B'5 audit per label; re-enqueue ONCE only for the re-run tokens, record-only for the structural ones; B'6 one line per label: `rebuild: <label> recomputed`, `rebuild: <label> recorded, not recomputed (<token>)`, or `rebuild: <label> not shown (<cause>)`, then `rebuilds-enqueued: <n>`. A refusal writes nothing (PD-H); a recompute replaces the account window in one transaction and is one-way through the product path (the runbook's "Rollback" section). Note the runbook's label query labels OKX accounts only (`lower(k.exchange) = 'okx'`), a different numbering from the probe's a-labels: map by shape.

## Q5 and Q6 - see the sections below (Validation Architecture) and "Other code that must move"

### Other code that must move with the new fields (Q6)

| File | What reads the probe / gate lines | Action |
|------|-----------------------------------|--------|
| `analytics-service/scripts/allocator_history_probe.py` | the declaration (`ACCOUNT_RECORD_KEYS`, `SUMMARY_RECORD_KEYS`, `_ACCOUNT_VALIDATORS`, `_SUMMARY_VALIDATORS`), `_account_record` defaults, `_probe_account`, `summarize`, module docstring items 2 and 4 | edit |
| `analytics-service/tests/test_allocator_history_probe.py` | vocabulary pins listed in Q3 | edit |
| `docs/runbooks/marksource-okx-history-correction.md` (P4) | quotes the TODOS closure sentence and says the probe "prints both" | reword to the new `okx_order_gate` / `okx_members_with_trades` fields; non-planning path so it ships in the PR |
| `TODOS.md` entries `167.2.1.1.2.1-OKX-ORDER-UNMEASURED`, `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED`, `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` | dated readings and closes | orchestrator records PR after the checkpoint (never on the ship branch's `.planning/`; TODOS itself is a non-planning path) |
| `CHANGELOG.md`, `VERSION`, `package.json` | CHANGELOG discipline | ship commit |
| `.planning/phases/167.2.1.1.2.1-*/167.2.1.1.2.1-06-PLAN.md` | the gate wording (historical) | leave; 173 supersedes the derivation |

A repo-wide search for `allocator_history_probe`, `okx_order_readings`, `transfers_older_365d` and `ACCOUNT_RECORD_KEYS` outside `.planning/` finds exactly `CHANGELOG.md`, `TODOS.md`, `docs/runbooks/marksource-okx-history-correction.md`, the probe and its test (workflow YAML and scripts do not reference the probe). Nothing else parses probe output.

## Code Examples

### Per-kind aggregation with the existing helper (shape)
```python
# Source: allocator_history_probe.py transfers_older_than (existing), flow_events_in_window idiom (existing)
def transfers_of_kind(transfers, kind):
    return [t for t in transfers if t[0] == kind]

cutoff_365 = _day_ms(end_date - timedelta(days=365))   # same cutoff as the pooled field
deposits_old = sum(transfers_older_than(transfers_of_kind(r.transfers, "deposits"), cutoff_365) for r in results)
```

### Gate verdicts as pure functions (shape)
```python
def okx_order_verdict(violations, ended_full, readings, members_with_trades) -> str:
    if violations > 0 or ended_full > 0:
        return "violated"
    if members_with_trades >= 1 and readings == members_with_trades:
        return "ok"
    return "unmeasured"

def bybit_transfers_verdict(bybit_members, window_days, deposits_old, withdrawals_old) -> str:
    if bybit_members < 1 or window_days != 730:
        return "not-applicable"
    return "ok" if deposits_old >= 1 and withdrawals_old >= 1 else "unmeasured"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ordering read only after a successful anchored read | Ordering read taken from the call snapshot on every arm that holds OKX trades | this phase (D-01) | `okx_order_readings` can be 1 on a refused a4 |
| Pooled `transfers_older_365d` | per-kind counts + corroboration + strict gate token | this phase (D-02, WR-07) | the gate cannot be opened by one kind for the other |
| Operator-written per-kind Bybit count | permanent probe fields | this phase | removes the ad hoc worker step noted in 167 VERIFICATION |

**Deprecated/outdated:** the `15` in the TRADEPAGES/172 import-check literal (now 16 refusal tokens).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bybit's per-kind counts on a6 will probably read 0 again (inference from the pooled 0 on 2026-10-28), so the gate likely stays `unmeasured` | Summary, Q3 | Low: the plan is built to work either way; only the expectation set with the founder changes |
| A2 | Bybit v5 states no deposit/withdraw retention period; whether it serves more than 365 days is unknown until measured | Q3 | If Bybit does cap at 365 days, the "shorten the window to what is served" branch of the TODOS close condition applies |
| A3 | Bybit deposit rows carry no `id` in ccxt, so deposit counts may double-count a row returned by two overlapping windows | Q3 | Counts could be inflated; gate (>= 1) and oldest-timestamp evidence are unaffected |
| A4 | OKX `fills-history` returns the newest rows of `[begin, end]` first; this is the premise being measured, previously `[CITED]` only to ccxt and repo comments | Q2 | If False: `violated`, no OKX rebuild; the deferred "change the walk" idea becomes live |
| A5 | The raw GET with `instType`, `begin`, `end`, `limit` strings is accepted by OKX as written (never run live) | Q2, Pitfall 2 | A BadRequest-class failure shows as `okx_order_failure_class`, not a reading; fix the parameter form in a follow-up |
| A6 | Bybit's deposit/withdraw record endpoints may return newest-first within a 30-day window; `fetch_ccxt_transfers` advances `inner_cursor = max_ts + 1` and ignores `nextPageCursor`, so a window with more than 50 transfers may lose older ones (docs state no order) | Open Question 2 | If true, per-kind counts are lower bounds and the replay could miss transfers on a busy account (pre-existing, outside this phase) |
| A7 | An account funded through internal/sub-account transfers shows zero on-chain deposits at every age | Pitfall 3 | If false, a 0 is more informative than stated |

## Open Questions

1. **Does the D-04 default (rebuild none) need a Bybit branch at all if the counts are 0?**
   - Known: a6 is the only Bybit 730-day account seen; pooled 0 on 2026-10-28; gate strict.
   - Unclear: whether the founder wants to supply a deliberate override on corroboration evidence.
   - Recommendation: the checkpoint asks once, with "No rebuild, book follow-ups (Recommended)" first, and records an override line only if the founder names a scope.

2. **The on-chain-only transfer read (and the possible 50-row page loss) is a pre-existing data-integrity question outside 173.**
   - Known: [CITED: Bybit v5 pages above] deposit-record is on-chain; withdraw-record defaults to on-chain; ccxt sends no `withdrawType`; `fetch_ccxt_transfers` ignores `nextPageCursor`.
   - Unclear: whether the rebuilds' flow replay is missing internal transfers and, on busy windows, rows.
   - Recommendation: do NOT widen 173 (D-03 and Deferred). Book one TODOS entry from the checkpoint's evidence (owner-less, trigger: any plan to rebuild a Bybit account) so the 730-day Bybit rebuild is not later "unblocked" by a nonzero count that proves depth while still missing off-chain flows.

3. **Close conditions vs gates.** Counting the kinds satisfies `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED` literally; the gate may still read `unmeasured`.
   - Recommendation: the records PR closes the OKX-ORDER entry only on its own equality condition, and on Bybit writes a dated reading and either closes with an explicit "gate still `unmeasured` for <label>, see <new entry>" or leaves it open. Planner/orchestrator choice; flag it, do not pick silently.

4. **Field names.** All new names above are proposals (Claude's discretion). The only hard constraints are the deny-key substrings and the static greps.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python venv with the analytics deps | pytest, mypy | yes, only in the MAIN checkout's `analytics-service/.venv` | ccxt 4.5.85 there vs pin 4.5.88; Python 3.12 per `.python-version` | run `<main-checkout>/analytics-service/.venv/bin/python -m pytest ...` with cwd = the worktree's `analytics-service/`; the worktree has no venv and the system interpreter lacks `aiohttp` |
| `uv` | recreate a venv in the worktree | yes | - | as above |
| Railway backfill worker | the live probe | orchestrator only | - | none; a dispatched executor must not touch it |
| `gh` | CI binding by head SHA | yes (orchestrator) | - | - |
| Bybit/OKX reachability | the live probe | only from the backfill worker (its egress IP is allowed) | - | none |

**Missing dependencies with no fallback:** none for the code work. **With fallback:** the worktree venv (use the main checkout's interpreter or `uv`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest with pytest-asyncio (`asyncio_mode = auto`), run from `analytics-service/` |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Quick run command | `cd analytics-service && python -m pytest tests/test_allocator_history_probe.py -q` (baseline measured this session: 84 passed in 4.78 s) |
| Full suite command | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (CI's `python` job step) |
| Type gate (CI, verbatim) | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (measured this session: `Success: no issues found in 127 source files`) |
| Probe type check (extra, not CI) | `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/allocator_history_probe.py` (measured: clean). `scripts/` is outside CI's mypy scope, but the probe is strict-clean today and should stay so |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | A refused OKX member carries an ordering reading from the raw read (violations counted too) | unit (async, fakes) | `pytest tests/test_allocator_history_probe.py -k order -q` | extend existing |
| SC-1 | The raw read takes its type from the forced pass's snapshot, not the diagnostic's pass; forced-pass counters unchanged | unit | same | new test |
| SC-1 | A raising raw read leaves the refusal intact, records `okx_order_failure_class`, counts no reading | unit | same | new test |
| SC-1 | Truncated OKX member carries a reading; a non-OKX or auth-failed member makes no raw call | unit | same | new test |
| SC-1 | `okx_members_with_trades`, summary readings/totals, `okx_order_gate` precedence (`violated` over `unmeasured`; zero members is `unmeasured`) | unit (pure) | same | new test |
| SC-2 | Per-kind counts, in-window totals, three age buckets from a fake venue with timestamped deposits/withdrawals; pooled field unchanged | unit | `pytest tests/test_allocator_history_probe.py -k transfer -q` | extend existing |
| SC-2 | `bybit_transfers_gate`: one kind zero with pooled > 0 is `unmeasured`; both positive is `ok`; non-Bybit or window != 730 is `not-applicable` | unit (pure) | same | new test |
| SC-2 | Redaction: new keys reject out-of-vocabulary values; fake transfer ids/timestamps never reach stdout | unit | `pytest tests/test_allocator_history_probe.py -k "emitter or leak" -q` | extend |
| SC-3 | Operator checkpoint lines present and well-formed (SUMMARY verify string) | scripted grep in the plan | `grep -aqE '^okx-order: (ok|violated|unmeasured)$'` etc. | new in the plan |

### Mutation checks (each new behavior must be able to FAIL; neuter, see RED, restore from a byte backup, never `git checkout`/`stash`)
1. Delete the refusal-arm helper call -> the "refused member reads an ordering" test goes RED.
2. Take the type from the live `recorder.calls` after the diagnostic instead of the snapshot -> the "diagnostic pass on another instrument type" test goes RED (needs a diagnostic pass whose busiest type differs from the forced pass's).
3. Let the helper's exception escape -> the "raw read raises, refusal stays" test goes RED.
4. Make the truncated arm skip the read, or make a non-OKX arm make the call -> the corresponding test goes RED.
5. Compute `deposits_older_365d` with the withdrawals' kind (swap the kind filter) -> the per-kind test goes RED; make the gate use the pooled count -> the WR-07 case goes RED.
6. Swap `violated`/`unmeasured` precedence in `okx_order_verdict` -> the precedence test goes RED; count a reading when `okx_newest_first` returns `field-absent` -> the "answer cannot say" test goes RED.
7. Drop a new key from `ACCOUNT_RECORD_KEYS` but keep its default -> `test_the_declared_vocabulary...` goes RED (existing pin).
8. Introduce the word `enqueue` or a `.rpc(` into the probe source -> the existing static pins go RED (confirm the new code did not).

### Sampling Rate
- **Per task commit:** the quick run command above plus the probe-file mypy line.
- **Per wave merge:** quick run + CI's mypy line verbatim + `pytest tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py -q` (neighbours of the walk; the probe imports the rebuild module but the rebuild is not edited).
- **Phase gate:** the full CI-equivalent suite green before `/gsd-verify-work`; main's CI bound to the head SHA with the expected check count before the operator checkpoint.

### Wave 0 Gaps
- [ ] None for infrastructure: the test file, stubs (`_StubVenue`, `_StubVenueWithTransfers`, `_OkxAnchorVenue`, `_Services`, `_refusing_reader`) and the emitter pins already exist.
- [ ] Small fixture extension: let `_OkxAnchorVenue` (or a new subclass) accept `order_raw`, and add a reader whose advisory pass hits a different instrument type than the forced pass (mutation 2).
- [ ] If the executor's worktree has no venv, point the commands at the main checkout's interpreter (see Environment Availability).

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (keys are decrypted inside the worker by existing code) | - |
| V3 Session Management | no | - |
| V4 Access Control | yes (read-only) | `ReadOnlySupabase` exposes `table().select()` only; static pins forbid writers; the forced rebuild goes through the existing service-role RPC with the marker guard |
| V5 Input Validation | yes | `emit_record` whitelist: declared keys, declared validators, 3-significant-figure floats, then `assert_sanitized` |
| V6 Cryptography | no (no new crypto; `decrypt_credentials`/`get_kek` unchanged) | never hand-roll |
| V7/V8 Error handling, data protection | yes | exceptions recorded by allow-listed CLASS only (`classify_failure`), never the message; `logging.disable(CRITICAL)` for the run |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A false `ok` gate opens a rebuild over a silent gap | Tampering (data integrity) | strict code-derived tokens, tests with mutation; D-02 keeps a 0 `unmeasured`; any override recorded verbatim with a scope |
| Probe output leaks an id, amount or timestamp into a public repo | Information disclosure | closed vocabulary only: counts, closed age buckets, booleans, tokens; uuid and long-digit greps on the SUMMARY |
| New venue call writes or leaks | Tampering / Disclosure | the only new call is one `private_get_trade_fills_history` GET; the static pin `test_the_probe_source_calls_no_venue_write` stays |
| Temporary start-command change takes the worker down | Denial of service | background probe, exec the normal start, restore first, `worker-restored: yes` gated |
| Forced job races a window replace | Tampering | one job per account, B'3a in-flight check, B'3c new-job proof (existing runbook) |
| Wrong database | Tampering | marker query first; NULL stops |

## Sources

### Primary (HIGH confidence)
- Repository, read this session: `analytics-service/scripts/allocator_history_probe.py` (whole file), `analytics-service/services/equity_reconstruction.py` (`_fetch_and_price_window`, `_fetch_okx_inst_type_trades`, `_account_rebuild_window`, refusal sets), `analytics-service/services/ccxt_flow_fetch.py`, `analytics-service/tests/test_allocator_history_probe.py`, `docs/runbooks/marksource-okx-history-correction.md`, TODOS entries, 167 plan 06 and SUMMARY, 172-05 PLAN and SUMMARY, `analytics-service/scripts/deribit_ground_truth.py` (`assert_sanitized`, `_DENY_KEY_SUBSTRINGS`).
- ccxt 4.5.88 wheel (the repo pin) downloaded to scratch and read: `ccxt/async_support/okx.py` (`fetch_my_trades`, endpoint table), `ccxt/base/exchange.py` (`parse_trades_helper`, `sort_by_2`), `ccxt/async_support/bybit.py` (`fetch_deposits`, `fetch_withdrawals`, `parse_transaction`); cross-checked against the installed 4.5.64.
- Commands run this session: probe tests (84 passed), CI's mypy line (clean, 127 files), the module import print (`0 16 57 11`).

### Secondary (MEDIUM confidence)
- Bybit v5 official docs, fetched: https://bybit-exchange.github.io/docs/v5/asset/deposit/deposit-record ; https://bybit-exchange.github.io/docs/v5/asset/withdraw/withdraw-record ; https://bybit-exchange.github.io/docs/changelog/v5 (first 100000 characters). These state intervals, defaults, page limits and endpoint scope; they do NOT state retention.

### Tertiary (LOW confidence)
- A single-user anecdote (Koinly feedback board) about Bybit serving 2022 deposits; unofficial, not used for any claim.
- OKX's own `fills-history` reference page could not be loaded (truncated before the endpoint), so OKX sort order remains `[CITED]` to ccxt and repo comments until the live reading.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no change; versions read from the repo pin and the wheel.
- Architecture (where the read sits, what the refusal arm holds, why ccxt hides order): HIGH - read in source and wheel.
- Bybit depth semantics: MEDIUM - vendor docs are silent; interpretation of a 0 is the open risk.
- Pitfalls: HIGH for the probe/test mechanics, MEDIUM for the Bybit data-integrity notes (A6, A7).

**Research date:** 2026-10-28
**Valid until:** 2026-11-27 for the code seams (30 days; the probe file moves with every probe phase), 7 days for anything about live venue behavior.
