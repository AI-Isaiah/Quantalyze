# Phase 173: REBUILDGATES - Pattern Map

**Mapped:** 2026-10-28
**Files analyzed:** 8 (2 code, 1 doc, 3 ship-ledger, 1 operator plan shape, 1 post-checkpoint ledger)
**Analogs found:** 8 / 8 (the production code is its own best analog: every new piece extends an existing seam in the same module)

All paths are repo-relative and git-tracked in this worktree, with one exception stated below (the Phase 172 plan 05 file lives on the `feat/172-okxanchor` branch only; it is read from that branch, and the planner should cite it as an analog, never as a file to edit). Line numbers were read at the 173 worktree HEAD; the probe module moves with every probe phase, so re-grep by symbol before editing.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/scripts/allocator_history_probe.py` (helper `_okx_order_reading`, three `_probe_member` arms, `_read_member`) | probe / service | request-response (one raw venue GET) | same file: `_read_member` raw read (L1012-1024) + `_anchor_diagnostic` (L1102-1119) | exact (extend in place) |
| `analytics-service/scripts/allocator_history_probe.py` (vocabulary: `ACCOUNT_RECORD_KEYS`, `SUMMARY_RECORD_KEYS`, validators, `_account_record`, `_probe_account`, `summarize`, two pure verdict functions) | emitter / transform | transform (aggregate in-memory records into closed tokens) | same file: `transfers_older_than` (L599), `window_age_bucket` (L650), `okx_newest_first` (L728), `summarize` (L1401) | exact |
| `analytics-service/tests/test_allocator_history_probe.py` | test | request-response with fakes | same file: `test_one_raw_order_read_per_okx_member_on_its_busiest_inst_type` (L509), `test_an_implausible_okx_refusal_is_measured_and_still_refused` (L1759), `test_transfer_events_older_than_365_days_are_counted_per_account` (L644) | exact |
| `docs/runbooks/marksource-okx-history-correction.md` (pre-flight P4 wording) | runbook doc | n/a | same file, P4 (L281-292) | exact |
| `CHANGELOG.md`, `VERSION`, `package.json` | release ledger | n/a | v0.133.6.0 entry (`CHANGELOG.md` L3) and the `chore(release): vX.Y.Z.B` convention in CLAUDE.md | role-match |
| `TODOS.md` (dated readings, closes, new routed entries; records PR, not the ship branch) | ledger | n/a | `167.2.1.1.2.1-OKX-ORDER-UNMEASURED` (L13286), `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED` (L13292), Phase 172 plan 05 Task 2 | exact |
| `173-0N-PLAN.md` operator checkpoint task (probe re-run, two gate lines, D-04 question) | plan / checkpoint | event-driven (operator step) | Phase 172 plan 05 Task 1 (branch `feat/172-okxanchor`), TRADEPAGES plan 06 Task 1 | exact |
| `173-0N-SUMMARY.md` operator output (written by the orchestrator, not an executor) | summary | n/a | `172-05-SUMMARY.md` section layout (see "Operator checkpoint" below) | exact |

## Pattern Assignments

### `analytics-service/scripts/allocator_history_probe.py` — ordering read on every arm (probe, request-response)

**Analog:** the same module. The raw read exists once today, inside `_read_member`, after `_fetch_and_price_window`; the refusal arm raises before it. The refusal arm already takes a call SNAPSHOT, which is all the new helper needs.

**Imports pattern** (L88-120, already present, no new import needed):
```python
import asyncio
...
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from scripts.bybit_upnl_probe import FAILURE_CLASSES, FIELD_ABSENT, classify_failure, sig3
from scripts.deribit_ground_truth import assert_sanitized
from services import equity_reconstruction as er
```
New code reads no new `er.` attribute, so `DEPLOYED_ER_NAMES` (L212) does not change; `er._RECONSTRUCT_CRAWL_TIMEOUT_S` is already declared there.

**The raw read to factor out** (`_read_member`, L1012-1024) — move verbatim into the helper, choosing the type from the passed `calls`:
```python
    order: bool | str | None = None
    inst_type = _busiest_inst_type(recorder.calls) if venue == "okx" else None
    if inst_type is not None:
        raw = await client.private_get_trade_fills_history(
            {
                "instType": inst_type,
                "begin": str(_day_ms(window_start)),
                "end": str(_day_ms(end_date + timedelta(days=1))),
                "limit": str(_OKX_PAGE_ROWS),
            }
        )
        order = okx_newest_first(raw)
```
Keep the literal text `private_get_trade_fills_history(` in the source: `test_the_probe_source_calls_no_venue_write` (test L795) asserts it is present.

**Fail-safe, bounded, class-only pattern to copy** (`_anchor_diagnostic`, L1102-1119):
```python
    try:
        return await asyncio.wait_for(
            _measure_anchor(client, supabase, window_start, end_date),
            er._RECONSTRUCT_CRAWL_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001 - recorded by CLASS; the message is never read
        return {
            "anchor_diagnostic": "failed",
            "diagnostic_failure_class": (
                "truncated" if isinstance(exc, er.TruncatedTradeRead) else classify_failure(exc)
            ),
        }
```
The new helper returns `(order, failure_class)`: `(None, "none")` when not OKX or no inst type, `(okx_newest_first(raw), "none")` on success, `(None, classify_failure(exc))` on a raise. Never read the exception message (a ccxt message can carry a signed URL).

**Snapshot-first separation rule — refusal arm** (`_probe_member`, L1172-1190). The new call goes AFTER the three snapshot lines and BEFORE `_anchor_diagnostic`, and the type comes from the `calls` snapshot variable, never from the live `recorder.calls`:
```python
    except er.ForcedRebuildRefusedError as exc:
        # Snapshot BEFORE the diagnostic: its second pass runs through the same wrapped
        # client, so the live lists would otherwise count it ...
        calls = list(recorder.calls) if recorder is not None else []
        moved = list(recorder.transfers) if recorder is not None else []
        elapsed_s = _elapsed()
        if exc.reason in er.FORCED_REBUILD_REFUSAL_REASONS:
            diagnostic = None
            if venue == "okx" and client is not None and exc.reason == "anchor_skipped_implausible":
                diagnostic = await _anchor_diagnostic(client, supabase, window_start, end_date)
            return _MemberResult(
                read=False, refusal=exc.reason, calls=calls, transfers=moved,
                elapsed_s=elapsed_s, diagnostic=diagnostic,
            )
        return _MemberResult(
            read=False, failure_class="other", calls=calls, transfers=moved, elapsed_s=elapsed_s
        )
```
Add `order=` to BOTH `_MemberResult(...)` returns (the in-vocabulary refusal and the out-of-vocabulary `other` branch). `elapsed_s` stays taken before the raw read so `read_elapsed_s` keeps meaning "the forced pass".

**Success arm** (`_probe_member`, L1150-1171): today `_read_member` returns `order` as the middle tuple value and a raising raw read flips the whole member to a failure class. After the change the helper is called from the success arm (use the snapshot `calls`, no diagnostic has run yet) and a raising raw read becomes `okx_order_failure_class`, leaving the member read. That is a behaviour change on an existing path and needs its own test (RESEARCH Q1 step 2).

**Truncated arm** (`except Exception as exc`, L1194-1209): this arm uses the LIVE list (`calls = recorder.calls`, no copy, L1195). Call the helper only when `venue == "okx"` and `isinstance(exc, er.TruncatedTradeRead)`; every auth, network or timeout class skips it. Take a `list(...)` copy before the helper call if the helper is awaited while anything else could still append (no diagnostic runs on this arm, so a copy is cheap insurance, not a required fix).

**Existing `_MemberResult` already carries the field** (L991): `order: bool | str | None = None  # None: no raw ordering read was made`. Add one sibling field for the failure class (default `"none"`), same dataclass style.

**Error handling:** class tokens only, via `classify_failure` / `_FAILURE_CLASSES` (L139) — `_FAILURE_CLASSES = (*FAILURE_CLASSES, "truncated")`.

---

### `analytics-service/scripts/allocator_history_probe.py` — new record fields and code-derived gate tokens (emitter, transform)

**Analog:** the same module's declared vocabulary. Every new key must appear in FIVE places or `validate_record` raises on every record: `ACCOUNT_RECORD_KEYS` (L230), `_ACCOUNT_VALIDATORS` (L343), the defaults in `_account_record` (L1244), `_probe_account`'s `_account_record(...)` call (L1349), and, for summary keys, `SUMMARY_RECORD_KEYS` (L289) + `_SUMMARY_VALIDATORS` (L407) + `summarize` (L1401).

**Validator conventions to copy** (L309-340, L343-405):
```python
def _is_count(x: Any) -> bool:
    return isinstance(x, int) and not isinstance(x, bool) and x >= 0

def _is_one_of(allowed: Sequence[str]) -> Callable[[Any], bool]:
    return lambda x: isinstance(x, str) and x in allowed
...
    "okx_order_readings": _is_count,
    "transfers_older_365d": _is_count,
    "last_window_age_bucket": _is_one_of(_WINDOW_AGE_BUCKETS),
    "diagnostic_failure_class": _is_one_of(_FAILURE_CLASSES),
```
Proposed (RESEARCH Q1/Q3, names are Claude's discretion): account `okx_members_with_trades` `_is_count`, `okx_order_failure_class` `_is_one_of(_FAILURE_CLASSES)`, `deposits_older_365d`, `withdrawals_older_365d`, `deposits_in_window`, `withdrawals_in_window` `_is_count`, `oldest_fill_age_bucket`, `oldest_deposit_age_bucket`, `oldest_withdrawal_age_bucket` `_is_one_of(_WINDOW_AGE_BUCKETS)`, `bybit_transfers_gate` `_is_one_of(("not-applicable","ok","unmeasured"))`; summary adds `okx_order_readings`, `okx_members_with_trades` (`_is_count`) and `okx_order_gate` (`_is_one_of(("ok","violated","unmeasured"))`). Keep `transfers_older_365d` untouched (D-02 lineage).

**Deny-key trap:** `assert_sanitized` (imported from `scripts.deribit_ground_truth`) rejects any key containing `secret`, `token`, `api_key`, `apikey` or `password`. Do NOT name a gate field `..._token`.

**Per-kind aggregation: reuse the existing counter, filter by kind** (`transfers_older_than`, L599-611; its dedupe key already includes the kind):
```python
def transfers_older_than(transfers: Sequence[tuple[str, Any, int | None]], cutoff_ms: int) -> int:
    seen: set[tuple[str, str]] = set()
    no_id = 0
    for kind, transfer_id, stamp in transfers:
        if stamp is None or stamp >= cutoff_ms:
            continue
        if transfer_id is None:
            no_id += 1
        else:
            seen.add((kind, str(transfer_id)))
    return len(seen) + no_id
```
Pooled call site to extend (`_probe_account`, L1369-1372):
```python
        transfers_older_365d=sum(
            transfers_older_than(r.transfers, _day_ms(end_date - timedelta(days=365)))
            for r in results
        ),
```
"All in window" cutoff idiom, already used for `flow_events_in_window` (L1064-1066): `transfers_older_than(fresh.transfers, _day_ms(end_date + timedelta(days=1)))`.

**Age buckets: do not hand-roll, reuse `window_age_bucket(since_ms, run_day)`** (L650-661, closed edges `_WINDOW_AGE_BUCKETS` L199, `"none"` when no start). Oldest fill = minimum of `_Call.oldest_ts` over the snapshot calls (the `_Call` dataclass, L498-508, already holds `oldest_ts`); oldest deposit/withdrawal = minimum stamp of that kind in `r.transfers` (tuples are `(kind, id, timestamp)`, built by `_TradeRecorder._recording_transfers`, L577-585).

**Gate verdicts as pure module-level functions** (shape from RESEARCH "Code Examples"; place beside `okx_newest_first`/`transfers_older_than` so they are testable without a run):
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
Type them for `mypy --strict` (`int` params, `-> str`). `window_days` is `_is_count_or_absent` (may be the string `field-absent`): compare with `!= 730` as written, which is safe for the string.

**Static source pins the new code must not trip** (test L786-800): the probe source may contain none of `.insert(`, `.update(`, `.upsert(`, `.delete(`, `.rpc(`, `enqueue`, and nothing matching `\b(create_order|cancel_order|withdraw|transfer)\(`. `transfers_older_than(` and a helper named `withdrawals_older_than(` are fine (`withdraw` is followed by `s`); a bare `transfer(` is not. Docstrings and comments count: do not write the word `enqueue` anywhere in the module.

**Summary construction pattern** (`summarize`, L1401-1423): a dict of sums over `records`; the new `okx_order_gate` is computed from the same summed fields via `okx_order_verdict`, never by reading booleans out of free text.

**Redaction contract (unchanged):** labels, counts, booleans, closed tokens, 3-significant-figure ratios only. No id, amount or timestamp finer than the run date reaches stdout.

**Module docstring:** items 2 and 4 of the module docstring (top of file, L1-99) describe the ordering read and the transfer count; update them to the new behaviour in the same commit.

---

### `analytics-service/tests/test_allocator_history_probe.py` (test, request-response with fakes)

**Analog:** the same test file. Fixtures already exist; do not build new infrastructure.

**Venue stub already accepts `order_raw`** (L193-226):
```python
class _StubVenue:
    def __init__(self, pages=None, *, order_raw: Any = None, fetch_effect=None, hang=False) -> None:
        ...
        self._order_raw = order_raw
        self.raw_calls: list[dict[str, Any]] = []

    async def private_get_trade_fills_history(self, params: dict[str, Any]) -> Any:
        self.raw_calls.append(dict(params))
        return self._order_raw
```
`_OkxAnchorVenue.__init__` (L1657-1671) does NOT take `order_raw`, so a new refusal-arm ordering test either sets `okx._order_raw = _fills(...)` after construction or extends the constructor with a keyword (pitfall 8 in RESEARCH). Existing refusal tests keep passing: the stub returns `None`, which `okx_newest_first` reads as `field-absent`, so no reading and no failure.

**Raw-answer builder** (L463-465): `_fills("300", "200", "100")` builds an OKX answer in the given order; `_fills("100","200","300")` is the violation case; `_fills("300")` is "answer cannot say".

**Pattern for the refused-member ordering test: copy `test_an_implausible_okx_refusal_is_measured_and_still_refused`** (L1759-1804):
```python
    okx = _OkxAnchorVenue(pages, balance=_anchor_balance(), bills=_opening_bills())
    services = _Services(_okx_only_book(), [okx], window=_ANCHOR_WINDOW)
    services.reader = _refusing_reader(pages_per_pass=2)
    services.install(monkeypatch)

    assert await hp.run() == 1  # the member stays refused, so the run still fails
    ...
    # Pitfall 8: the counters are the forced pass's, not doubled by the second pass.
    assert account["trade_calls"] == 2
    assert account["trades_read"] == 5
    assert [a.require_anchor for a in services.read_args] == [True, None]
    ...
    for leak in (_ANCHOR_TOTAL_EQ, _ANCHOR_OPENING_USDT, "19987", _KEY_OKX, "fake-trade"):
        assert leak not in everything, leak
```
Extend it (or add a sibling) to assert `okx.raw_calls` holds exactly one call with `instType` of the forced pass's busiest type, `okx_order_readings == 1`, and that the forced-pass counters stay 2 / 5. `_refusing_reader` (L1723-1756) drives the venue with `{"type": "swap"}` params in the forced pass; for the mutation-2 test (type must come from the SNAPSHOT, not the diagnostic's pass) add a reader variant whose advisory pass (called without `require_anchor`) hits a DIFFERENT instrument type with more rows than the forced pass.

**Pattern for the success-arm ordering reading: copy `test_one_raw_order_read_per_okx_member_on_its_busiest_inst_type`** (L509-554): three variants on one body (descending => `(1, 0)`, ascending => `(1, 1)`, one-row answer => `(0, 0)`), with `_okx_two_pass_reader` (L487-499) making `swap` the busiest pass. Extend the assertions to cover `okx_members_with_trades` and the new summary fields.

**Pattern for "no raw call": copy `test_no_raw_order_read_for_a_bybit_member_or_an_okx_member_that_read_nothing`** (L557-576): `assert bybit.raw_calls == [] and quiet_okx.raw_calls == []`. Add the auth-failed / non-truncated-exception OKX member case here.

**Pattern for per-kind counts: copy `test_transfer_events_older_than_365_days_are_counted_per_account`** (L644-682), which is already the natural base:
```python
    cutoff = _ms(_TODAY) - 365 * 24 * 60 * 60 * 1000
    deposits = [
        {"id": "fake-transfer-d1", "timestamp": cutoff - 1},
        {"id": "fake-transfer-d2", "timestamp": cutoff},  # exactly 365 days: not older
        {"id": "fake-transfer-d3", "timestamp": cutoff - 10**9},
    ]
    withdrawals = [{"id": "fake-transfer-d1", "timestamp": cutoff - 5}]  # same id, other kind
    bybit = _StubVenueWithTransfers([...], deposits=deposits, withdrawals=withdrawals)
    services = _Services(book, [bybit], window=(_TODAY - timedelta(days=729), 730))
    ...
    assert account["transfers_older_365d"] == 3
    assert "fake-transfer" not in captured.out + captured.err
```
New assertions: `deposits_older_365d == 2`, `withdrawals_older_365d == 1`, pooled still 3, in-window totals, three age buckets, and the WR-07 case (a deposit older than 365 days and NO older withdrawal gives `bybit_transfers_gate == "unmeasured"` although pooled > 0). `_StubVenueWithTransfers` (L625-641) takes `deposits=`/`withdrawals=` lists.

**Vocabulary pins that must be edited when keys are added:**
- `test_the_declared_vocabulary_is_the_rebuilds_own_refusal_tokens` (L936-941): `assert set(hp.ACCOUNT_RECORD_KEYS) == set(hp._account_record("a1", "2026-10-23"))` — fails if a key lacks a default.
- `test_run_end_to_end_prints_one_record_per_account_and_a_summary` (L353 on): compares the summary dict by EQUALITY; add each new summary key to the expected dict.
- `test_a_truncated_bybit_read_names_the_window_ceiling_from_the_call_log`: `assert set(summary) == set(hp.SUMMARY_RECORD_KEYS)` follows the declaration, no edit if both lists move together.
- `test_the_emitter_refuses_a_key_or_a_value_outside_the_vocabulary` (L882-933), `test_the_emitter_refuses_an_out_of_vocabulary_site_or_bucket` (L1483), `test_the_diagnostic_keys_refuse_values_outside_their_vocabulary` (L2289): copy their `with pytest.raises(ValueError): hp.emit_record(dict(rec, <key>=<bad value>))` shape for every new key.

**Static pins that must stay green (read, do not edit):** `test_the_probe_source_calls_no_writer` (L786), `test_the_probe_source_calls_no_venue_write` (L795), `test_every_rebuild_name_the_probe_reads_is_declared` (L809).

**Mutation checks (neuter, see RED, restore from a byte backup; never `git checkout`/`restore`/`stash` on uncommitted work):** the eight in RESEARCH "Validation Architecture" (drop the refusal-arm helper call; take the type from the live `recorder.calls`; let the helper's exception escape; skip the truncated arm / call from a non-OKX arm; swap the kind filter or use the pooled count in the gate; swap `violated`/`unmeasured` precedence or count a `field-absent` as a reading; drop a key from `ACCOUNT_RECORD_KEYS` but keep its default; introduce `enqueue` or `.rpc(` into the probe source).

**Run commands** (the worktree has no venv; use the main checkout's interpreter with cwd = this worktree's `analytics-service/`):
```
python -m pytest tests/test_allocator_history_probe.py -q        # baseline 84 passed
mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py
mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/allocator_history_probe.py    # extra, not CI; clean today, keep it clean
```
Per wave also run `pytest tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py -q`. Always `grep -a`; pytest only from `analytics-service/`.

---

### `docs/runbooks/marksource-okx-history-correction.md` (runbook doc, P4)

**Analog:** the same file, P4 (L281-292). It quotes the TODOS closure sentence and says the probe "prints both" `okx_order_readings` and the count of OKX members that read trades:
```
  - `167.2.1.1.2.1-OKX-ORDER-UNMEASURED`: "Until it is measured, no OKX-holding account may be
    rebuilt." It closes when `okx_order_readings` equals the number of OKX members that read
    trades and violations are 0 (the allocator history probe,
    `analytics-service/scripts/allocator_history_probe.py`, prints both). While it is open,
```
Reword to the new code-derived fields (`okx_order_gate` on the summary record, `okx_members_with_trades` on the account record). This is a non-planning path, so it ships in the code PR. Do not touch the `<!-- form: enqueue -->` SQL block (L374 on): a forced rebuild, if the founder says yes at the checkpoint, runs that block through the product RPC, never from a dispatched agent.

---

### `CHANGELOG.md`, `VERSION`, `package.json` (ship commit)

**Analog:** the newest entry, `CHANGELOG.md` L3 (`## [0.133.6.0] - 2026-10-28 — MARKSOURCE: ...`). Header shape: `## [X.Y.Z.B] - YYYY-MM-DD — NAME: one-sentence summary`, then `### Root cause`, `### Added`, `### Changed` (this repo's vocabulary, not keep-a-changelog's four; also `### Tests`, `### Notes`). Bullets name the plan number and decision (`(plan 01, D-02)`) and the file paths in backticks. Written in the same commit as the `VERSION` bump, subject `chore(release): vX.Y.Z.B — <name>`; `VERSION` and `package.json` must be BYTE-EQUAL 4-digit strings (`src/__tests__/critical-regressions.test.ts` asserts it). Never `npm version`. Current `VERSION` is `0.133.6.0`; re-pick the next digit from `origin/main` right before the single CI run. Run the CLAUDE.md commit-by-commit cross-check (every commit maps to a bullet). No CI skip token anywhere, not even to deny it. Gitleaks rule: never quote a credential-shaped fixture literal in CHANGELOG prose.

---

### `TODOS.md` (records PR on main, never the ship branch's `.planning/`)

**Analog:** the two open entries this phase reads (L13286 and L13292) and Phase 172 plan 05 Task 2 for the edit shape (scoped `Edit` replacements: append a dated `**Measured <date> (Phase 173 ...).**` paragraph under each entry, append routed follow-ups as a new `## Phase 173 (REBUILDGATES) — routed items (logged <date>)` section with `### <id> — <title> (booked <date>, ..., DATA INTEGRITY)` entries each followed by `**Reading.**` and `**Owner / Trigger:**`). Entry close conditions to honour exactly:

- `167.2.1.1.2.1-OKX-ORDER-UNMEASURED`: "Closed when `okx_order_readings` equals the number of OKX members that read trades and violations are 0, or the walk is changed to not rely on it." Close only on that equality.
- `167.2.1.1.2.1-BYBIT-TRANSFER-DEPTH-UNMEASURED`: "Closed when deposits and withdrawals older than 365 days are counted separately on a real Bybit key, or the window is shortened to what is served." Counting 0 and 0 satisfies this literally while the gate stays `unmeasured` (D-02): the dated reading must say "gate still `unmeasured` for <label>" and book the residual, not read "closed" as "gate open" (RESEARCH Pitfall 7, Open Question 3).
- Do not edit `167.2.1.1.2.1-OKX-ANCHOR-IMPLAUSIBLE` beyond a dated reading; the chain_break fix is Phase 179 OKXBILLSCHAIN.
- Public repo: labels, counts, booleans, tokens only; no uuid, key id, amount, bill id or home path; never quote a search pattern as proof of absence.

---

### `173-0N-PLAN.md` operator checkpoint (plan, event-driven operator step)

**Primary analog:** Phase 172 plan 05, `.planning/phases/172-okxanchor-an-okx-account-s-history-rebuild-gets-a-plausible/172-05-PLAN.md`, Task 1. **Tracked-source note:** this file exists on branch `feat/172-okxanchor` (the sibling worktree), not on this branch; read it with `git show feat/172-okxanchor:<path>` or from that worktree. It is a plan-shape analog only.
**Secondary analog (tracked here):** `.planning/phases/167.2.1.1.2.1-tradepages-the-allocator-history-rebuild-reads-every-trade-t/167.2.1.1.2.1-06-PLAN.md`, Task 1 (L119-145) for the gate wording and the override line forms.

**Frontmatter and task header** (172-05): `type: execute`, `autonomous: false`, `<task type="checkpoint:human-action" gate="blocking-human">` with `<name>`, `<action>`, `<instructions>` (numbered), `<verification>`, one `<verify><automated>` string that ends in a single success word, `<fails_when>`, and `<resume-signal>`. Objective paragraph names the operator: "the orchestrator session, under the founder's standing PROD authorization. NEVER a dispatched executor agent." Add a `<threat_model>` table with the same rows (T-DoS start command, T-Tampering rebuild against the gate, T-deploy-mismatch, T-info-disclosure) and a trailing "Artifacts this phase produces" list.

**Hard constraints block to copy** (172-05 `<context>`): never `railway ssh`; no SQL from a dispatched agent; no probe run between 23:30 and 00:30 UTC (a Bybit crawl crossing UTC midnight is refused; expect about 18 minutes, a6 read in 1048 s against a 1500 s crawl bound, so start no later than 23:30); scratch dir outside the repo, deleted at the end of the task; tracked text holds labels, counts, booleans, tokens and 3-significant-figure ratios only; a STOP means AskUserQuestion with a recommendation, answer recorded verbatim; marker query before ANY statement that writes.

**Instruction steps to copy, with 173's values** (172-05 steps 1-5, 11):
1. Preconditions: PR merged; `gh api "repos/AI-Isaiah/Quantalyze/actions/runs?head_sha=<merge sha>" -q '.workflow_runs | length'` plus conclusions bound to the head SHA (expected check count); Railway deployed that head; UTC clock outside 23:30-00:30. Record `deployed-commit: <sha>` (the commit that actually ran, as 172-05 did when a later main head ran).
2. Import check through the temporary start-command wrapper, no payload. 172-05 printed `import-check: 0 16 True 0.05 True`; its own verify regex said `0 15` and failed on exactly this (the count is 16 since Phase 171). Write the 173 verify for 16. RESEARCH proposes: `python -c 'import scripts.allocator_history_probe as p, services.equity_reconstruction as e; print(p.EXIT_OK, len(e.FORCED_REBUILD_REFUSAL_REASONS), "okx_members_with_trades" in p.ACCOUNT_RECORD_KEYS, "deposits_older_365d" in p.ACCOUNT_RECORD_KEYS)'`, expected `0 16 True True`.
3. Run `python -m scripts.allocator_history_probe` in the BACKGROUND from the wrapper, print `probe-exit: <code>` whatever the code, exec the normal start; apply with `railway redeploy --from-source`. Full probe (D-03), no payload, no transfers-only mode. Exit is 1 whenever a member is refused (a4 always), so nothing may depend on exit 0.
4. Restore at once; `worker-restored: yes` is gated, and a worker that does not return outranks everything.
5. Paste the `{"` lines under a `## Probe` heading. Railway's log view prints each record as `key=value`; rebuild the JSON lines from those attributes exactly as 172-05 did and say so in a log-format note.
6. Identify labels by shape (172-05 step 6): a4 = the only record with `okx_members` 1 and `window_days` 90; a6 = `bybit_members` 1 and `window_days` 730; exactly one match or STOP. Record `a4-label:` / `a6-label:`.
7. Delete the scratch dir and check it is gone.

**Gate lines the checkpoint records** (RESEARCH Q4; copied from the probe's code-derived tokens, never re-derived in prose):
```
okx-order: ok|violated|unmeasured                       # = summary record okx_order_gate
okx-order-reading: readings=<n> members_with_trades=<n> violations=<n> passes_ended_full=<n> failure_class=<c>
bybit-transfers: ok | unmeasured (<labels>)             # labels whose bybit_transfers_gate is unmeasured
bybit-transfers-kinds: <label> deposits=<n> withdrawals=<n>
bybit-transfers-evidence: <label> deposits_in_window=<n> withdrawals_in_window=<n> oldest_fill=<bucket> oldest_deposit=<bucket> oldest_withdrawal=<bucket>
```
The gate wording and the override line forms come from TRADEPAGES plan 06 Task 1 (L128-137):
```
       - `okx-order: ok` when violations are 0, full-page stops are 0, and every account whose OKX read went past one page carries at least one ordering reading;
       - `okx-order: violated` when either count is above 0;
       - `okx-order: unmeasured` otherwise.
       ... one line `okx-gate-override: <the founder's answer, verbatim> (scope: <which labels may be rebuilt>)`, written after the answer and never before.
       ... one line `bybit-transfers-override: <the founder's answer, verbatim> (scope: <labels>)`, written after the answer and never before.
```
The code-derived `okx_order_gate` is stricter than this wording (requires readings == members that read trades), so whenever it says `ok` the carried wording is satisfied; state that in the plan so the founder sees a tightening, not a new rule.

**D-04 decision step** (one AskUserQuestion with a recommendation; 172-05 step 8 is the STOP/answer-recording pattern: "ask the founder, recommendation '...', and record the answer as `sc3-founder-decision: <verbatim>`"). 173 form: recommendation first "No rebuild, book follow-ups (Recommended)"; other options "Rebuild <labels> now" (only for labels whose gate allows it, or with an explicit `*-override:` line naming scope) and "Hold, re-probe later". Record `rebuild-decision: <verbatim>`; on "no" write `rebuilds-enqueued: 0` (172-05 step 10). A forced rebuild runs in 173 only on an explicit yes, through the runbook's guarded enqueue block (marker first, B'3a in-flight check, ONE job per account, B'3c new-job proof, B'6 one line per label `rebuild: <label> recomputed|recorded, not recomputed (<token>)|not shown (<cause>)`, then `rebuilds-enqueued: <n>`), by the orchestrator only.

**Verify string shape to copy** (172-05 `<verify>`; one `&&` chain ending in a success word, all greps `-a`):
```
S=<SUMMARY path>; test -s "$S" && grep -aqE '^deployed-commit: [0-9a-f]{40}$' "$S" && grep -aqE '^import-check: 0 16 True True$' "$S" \
 && grep -aq '^## Probe' "$S" && grep -aqF '"record":"summary"' "$S" && grep -aqE '^probe-exit: [0-9]+$' "$S" \
 && grep -aqE '^worker-restored: yes$' "$S" && grep -aqE '^a4-label: a[0-9]{1,2}$' "$S" \
 && grep -aqE '^okx-order: (ok|violated|unmeasured)$' "$S" \
 && grep -aqE '^bybit-transfers: (ok|unmeasured \(.+\))$' "$S" \
 && grep -aqE '^rebuild-decision: .+' "$S" && grep -aqE '^rebuilds-enqueued: [0-9]+$' "$S" \
 && test "$(grep -acE '[0-9a-f]{8}-[0-9a-f]{4}-' "$S")" = 0 \
 && test "$(grep -avE '^deployed-commit: ' "$S" | grep -acE '[0-9]{10,}')" = 0 \
 && test ! -e "$SCRATCH" && echo <SUCCESS_WORD>
```
(Both the uuid gate and the ten-plus-digit gate are in 172-05's verify; the `deployed-commit:` line is excluded from the digit gate because a 40-hex sha can hold long digit runs.)

**SUMMARY section layout to copy** (`172-05-SUMMARY.md`): frontmatter `phase`/`plan`/`status`; `## Preconditions` with `deployed-commit:` and an explicit "Deviation on `deployed-commit:`" sentence when a later main head ran; `## Delivery` with `import-check:` and any deviation; `## Probe` with the log-format note, the `{"` lines and `probe-exit:`; `## Worker restored` with `worker-restored: yes`; an outcome section (labels, gate lines, evidence, plus a plain sentence that a per-kind 0 is not a depth finding, see Pitfall 3); `## For follow-ups` / decision section with `rebuild-decision:`; `rebuilds-enqueued:`. This file is written by the orchestrator in the records PR, never by an executor.

---

## Shared Patterns

### Snapshot first, then any further venue call
**Source:** `analytics-service/scripts/allocator_history_probe.py` `_probe_member` L1154-1162 and L1172-1182
**Apply to:** every new venue read added to any probe arm (the ordering read on the success, refusal and truncated arms)
```python
        # Snapshot BEFORE the diagnostic, as in the refusal arm below. ...
        calls = list(recorder.calls)
        moved = list(recorder.transfers)
        elapsed_s = _elapsed()
        diagnostic: dict[str, Any] | None = None
        if venue == "okx" and agreed:
            diagnostic = await _anchor_diagnostic(client, supabase, window_start, end_date)
```
`_TradeRecorder` wraps only `fetch_my_trades`, `fetch_deposits`, `fetch_withdrawals` (L551-585); the raw `private_get_trade_fills_history` call is NOT wrapped and can never enter `recorder.calls`. The diagnostic re-wraps the same client, so the live list afterwards also holds the diagnostic pass.

### Class-only error recording (never the message)
**Source:** `analytics-service/scripts/allocator_history_probe.py` L1113-1119 (`_anchor_diagnostic`) and L1079-1084 (`_measure_anchor`)
**Apply to:** the new ordering helper and any other swallowed read
Record `classify_failure(exc)` from `_FAILURE_CLASSES`, with `truncated` for `er.TruncatedTradeRead`; a ccxt message can carry a signed URL, an amount or an id.

### Absence is a reading of nothing
**Source:** `okx_newest_first` L728-751, `ratio_or_absent`, the `FIELD_ABSENT` defaults in `_account_record`
**Apply to:** the new ordering reading and every gate token
`field-absent`/`None` never counts as a reading and never turns a gate `ok`; zero OKX members with trades is `unmeasured`; an uncomputable value is absent, never 0. Do not make the Bybit gate depend on `members_failed` (a positive per-kind count is sound evidence even from a member that failed later, since transfers are read before OHLCV and the anchor).

### Whitelist emitter is the only path to stdout
**Source:** `emit_record` L450-453 and `validate_record` L429-447, `assert_sanitized`
**Apply to:** every new key (declare in the key tuple, the validator dict and the default record or `validate_record` raises on every line)
The refusal message names the PATH of the offending key and never its value.

### Strict gate, evidence informs the founder
**Source:** CONTEXT D-02, TRADEPAGES plan 06 Task 1 step 5
**Apply to:** `bybit_transfers_gate` and the checkpoint text
A per-kind 0 older than 365 days keeps that kind `unmeasured`. Corroboration fields (in-window totals, three age buckets) are recorded for the founder's judgment at the checkpoint and never open the gate by themselves. The rebuild's transfer read is on-chain only (RESEARCH Pitfall 3), so a 0 can come from the funding route, not from depth.

### Operator vs executor boundary
**Source:** 172-05 plan objective; CONTEXT "Claude's Discretion"
**Apply to:** the whole plan set
Railway probe run, PROD marker query and any forced-rebuild enqueue are checkpoint tasks for the orchestrator, never a dispatched executor. The ship branch changes nothing under `.planning/`; SUMMARY and TODOS edits reach main in a records PR.

### Standing rules for every brief
- Analytics briefs carry CI's mypy line verbatim: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`.
- No AI authorship attribution of any kind in commits or PR text (founder 2026-10-20); never write a CI skip token anywhere (commit, PR body, CHANGELOG, plan text).
- No secrets, PROD ids/uuids, home paths or account numbers in tracked text.
- Never `git checkout`/`restore`/`stash` uncommitted work; explicit `git add` paths; never add `AGENTS.md`.
- No `--linked`, no db push, no PROD, TEST or Railway access from a dispatched agent. Always `grep -a`.

## No Analog Found

None in the production code. Two items have no tracked exact twin and need RESEARCH shapes:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| the two pure verdict functions (`okx_order_verdict`, `bybit_transfers_verdict`) | utility | transform | No existing gate-verdict function in the probe; gates were derived in operator prose (the defect this phase removes). Use RESEARCH "Code Examples" and the placement/typing conventions of `okx_newest_first` and `transfers_older_than`. |
| a test whose advisory pass hits a different instrument type than the forced pass | test fixture | request-response | `_refusing_reader` (L1723) always uses `{"type": "swap"}` for both passes; add a variant (mutation check 2). |

## Metadata

**Analog search scope:** `analytics-service/scripts/`, `analytics-service/tests/`, `docs/runbooks/marksource-okx-history-correction.md`, `TODOS.md`, `CHANGELOG.md`, `.planning/phases/167.2.1.1.2.1-*/`, `.planning/phases/172-*/` (sibling branch).
**Files scanned:** about 10 read in part (probe 1491 lines, test 2362 lines, read by targeted ranges; no range read twice).
**Tracked-source gate (#3645):** `git ls-files` confirms the probe, its test, the runbook, `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` and the TRADEPAGES plan 06 are tracked in this worktree; no gitignored runtime mirror is named. Phase 172 plan 05 is tracked on `feat/172-okxanchor` only (stated above).
**Pattern extraction date:** 2026-10-28
