---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
status: secured
threats_total: 23
threats_closed: 22
threats_open: 0
threats_owed_from_ci: 1
audited_at_head: ca6d7ff64
diff_base: 21b9ad929c9176b4e80d95fe369df14ce39d7858
audit_type: retroactive (gsd-secure-phase)
---

# Phase 250 BINANCEFILLS: security verification

Method: every threat in the `<threat_model>` of 250-01 .. 250-08 PLAN.md was checked against the code at
`ca6d7ff64` (read from the committed blob, `git show HEAD:...`, line numbers below are that blob's), or against
the record for `accept` / `transfer`. Code changed since the base is `analytics-service/` only
(`services/exchange.py`, `services/job_worker.py`, seven test files, one cassette); no dependency file changed.

Note on the worktree (the edit was gone from `git status` by the end of the audit): while this audit ran, `analytics-service/services/exchange.py` carried an UNCOMMITTED
one-line edit not made by the auditor (`if False and isinstance(item, ccxt.BadSymbol):` at line 2927, a neuter
probe from another process that was running pytest in the same worktree). It is not part of HEAD and was left
untouched. All evidence below is from the HEAD blob. A walk-file run taken while it was in place showed 14 failures,
consistent with that edit and not with HEAD; HEAD itself was last measured green by round 3 (see Test evidence).

## Per-threat table

| Threat | Category | Sev | Disposition | Status | Evidence |
|---|---|---|---|---|---|
| T-250-01 | Tampering: out-of-window rows | high | mitigate | CLOSED | `exchange.py:2808-2813` every numeric-timestamp row is checked `row_ts < window_start or row_ts > window_end` and raises `BinanceFillsOutOfWindow` (class `exchange.py:873-883`, static text) BEFORE `all_trades.extend(batch)` (2817), so none of the symbol's rows are returned; the exception reaches the holding `failed_symbols` / `binance_partial_symbols` branch (2943-2953, 2995). Pins: `test_a_row_outside_its_window_is_refused_by_name` (`test_binancefills_walk.py:261`), N18. |
| T-250-02 | Info disclosure: new WARNING lines | medium | mitigate | CLOSED | New lines: clamp WARNING names strategy id and two ints only (`exchange.py:2749-2753`); deadline WARNING counts and seconds only (3018-3022); BadSymbol WARNING passes exception text through `scrub_freeform_string` (2937-2941); cold-start fetch already scrubbed (2680); gate WARNINGs in `job_worker.py` name strategy id and `type(...).__name__` only (hold on missing bound, hold on unusable timestamp, stop-below-cursor names strategy, the key's own column and an int). Observation, pre-existing and not a new line: `exchange.py:2950-2952` logs `str(item)` unscrubbed for non-BadSymbol per-symbol failures (a `git diff` context line, unchanged by this phase). |
| T-250-03 | DoS: walk length vs 900 s / 300 s | medium | transfer | CLOSED | Transferred inside the phase to T-250-10 (plan 04 register row). Reconcile stays one request per symbol: pinned by `test_a_reconcile_window_is_one_request_per_symbol_ending_now` (`test_binancefills_walk.py:298`, asserts `len(requests) == 1` and explicit `endTime`); sync walk is bounded by the read deadline (T-250-10). |
| T-250-04 | Tampering: cassette | low | accept | CLOSED | Accepted in 250-01 register. `tests/cassettes/binance/markets.json` holds public market metadata; case-insensitive grep for `apikey`, `secret`, `signature` returns 0; helper asserts the twelve expected symbols (`tests/_binance_fills.py:78-97`). |
| T-250-05 | Tampering: lost stop bound | high | mitigate | CLOSED | `job_worker.py` gate: `_read_through` is set only when `type(_read_through_raw) is int and >= 0` (excludes bool, negatives) with `OverflowError` guarded (~2625-2636); `_fills_stopped` is true if the bound key OR any of `binance_page_cap_symbols` / `binance_untimed_page_symbols` / `binance_deadline_symbols` is present (~2640-2647); `_fills_stopped and _read_through is None` sets `_fills_incomplete = True` with one WARNING (~2648-2658), which holds the cursor and (NULL column) anchors at the read start via the `elif (phase2_failed or _fills_incomplete) and fills_anchor_iso` arm. Pins: `test_a_stop_record_without_a_usable_bound_holds` (`test_binancefills_cursor.py:391`), N20. |
| T-250-06 | Tampering: bound conversion | medium | mitigate | CLOSED | Epoch plus `timedelta(milliseconds=...)`, never float division; `type(...) is int` excludes bool; `OverflowError` leaves the bound unusable, which holds (T-250-05). Pin: `test_the_bound_is_inclusive_to_the_millisecond` (`test_binancefills_cursor.py:133`). |
| T-250-07 | Repudiation: raw-ingestion switch | medium | mitigate | CLOSED (CHANGELOG half owed at ship) | Precondition and the quiet-prefix exception are written where the flag is read, `job_worker.py` comment above `_RAW_TRADE_INGESTION_ENABLED` (diff hunk at ~334-366), including the recorded open gap and the T-250-19 gap; no code gate was added, as the plan requires. The matching CHANGELOG sentence is handed over in `250-08-SUMMARY.md` ("For the ship CHANGELOG", line 135 onward); `CHANGELOG.md` at HEAD has no Phase 250 entry because the ship has not happened. The ship step must write it. Residual risk (operator action) accepted per plan. |
| T-250-08 | Tampering: stop stamp under a hold | high | mitigate | CLOSED | The bound filter `ts <= _read_through` lives only inside `if advance_fetched_cursor:` (`job_worker.py` ~2677-2690), and `advance_fetched_cursor` conjuncts `raw_fills`, `phase2_complete`, `not phase2_failed`, `not phase1_failed`, `not _fills_incomplete` (~2659-2665). Pin: `test_a_hold_beats_a_stop` (`test_binancefills_cursor.py:164`), N11. |
| T-250-09 | Tampering: BadSymbol classification | high | mitigate | CLOSED | `exchange.py:2927` only `isinstance(item, ccxt.BadSymbol)` takes the non-holding `unlisted_symbols` branch (2933-2942); every other `BaseException` goes to the holding branch (2943-2953). Total failure still raises (`unlisted` counted with `failed`, 3030-3031). Named every run with `binance_unlisted_symbols` (3003-3004). Assumption A8 recorded in `250-RESEARCH.md:529`. Pins: `test_a_transient_failure_keeps_the_hold` (`test_binancefills_walk.py:467`), `test_every_symbol_unlisted_still_raises` (453), N23. |
| T-250-10 | DoS: walk length vs handler timeouts | high | mitigate | CLOSED | `BINANCE_FILLS_READ_DEADLINE_S = 240.0` (`exchange.py:717`) is the default of `fetch_raw_trades` (2540), `_fetch_raw_trades_binance` (2603); `BINANCE_SYNC_FILLS_READ_DEADLINE_S = 840.0` (736) is passed only by the sync job (`job_worker.py:2327-2330`); the reconcile (`job_worker.py:15618`) and the onboarding adapter (`services/ingestion/binance.py:105`) pass nothing and read with 240 s. The deadline is taken once (`exchange.py:2761`) and checked inside the semaphore before EVERY request (2790), exempt overlap pages included; a stop keeps its rows and records a bound (2795-2799, 2962-2965, 3015-3024). Pins: `test_a_deadline_stops_every_symbol_with_a_read_through_bound` (`test_binancefills_walk.py:957`), `test_the_read_deadlines_are_pinned` (1035: each budget below its handler timeout, keyword-only, default 240). |
| T-250-11 | Tampering: `binance_read_through_ms` | high | mitigate | CLOSED | Recorded once as `min(stop_bounds)` after the gather (`exchange.py:3023-3024`); per-symbol bounds travel in `_BinanceSymbolRead` (a flag recorded inside a gathered task is lost), collected at 2958-2965. Pin: `test_two_stopped_symbols_record_the_smaller_bound_once` (`test_binancefills_walk.py:713`), N16. |
| T-250-12 | Spoofing: reverse map, markets not loaded | medium | mitigate | CLOSED | `load_markets()` before the map when markets are empty (`exchange.py:2716-2717`); derivative-over-spot precedence (2727-2737, `_binance_market_is_spot` 761-763). Pins: `test_unloaded_markets_are_loaded_before_the_map` (`test_binancefills_walk.py:490`), `test_a_strip_collision_resolves_to_the_derivative_whatever_the_order` (519), N14/N15. |
| T-250-13 | Info disclosure: BadSymbol and deadline lines | medium | mitigate | CLOSED | BadSymbol text scrubbed (`exchange.py:2940`); deadline line is counts and seconds only (3018-3022). Same evidence as T-250-02. |
| T-250-14 | DoS: list growth in `data_quality_flags` | low | accept | CLOSED | New list flags go through `_record_dq_flag`, capped at `_DQ_LIST_MERGE_CAP = 64` on both the first-insert and merge paths (`exchange.py:111`, 300-337). |
| T-250-15 | DoS: full overlap hour below a cap stamp | low | mitigate | CLOSED | Overlap pages (`current_since <= last_ts < pre_overlap_seed_ms`) are not counted toward `BINANCE_PAGE_CAP` (`exchange.py:2877-2881`); `pre_overlap_seed_ms` passed from `fetch_raw_trades` (2567-2570); bounded by one hour of fills and by the per-request deadline check (2790). Pin: `test_a_cap_stamp_whose_overlap_hour_is_full_resumes_past_the_cap` (`test_binancefills_e2e.py:502`), N29. |
| T-250-16 | Tampering: untimed stop | medium | mitigate | CLOSED | Full page with a non-numeric last timestamp sets `stop="untimed"` with `read_through_ms = window_newest` (a row the walk read) else `window_start - 1` (`exchange.py:2820-2834`); named in `binance_untimed_page_symbols` and folded into the one minimum (2960-2965, 3013-3014, 3023). Pin: `test_a_page_it_cannot_page_past_is_named_with_a_bound` (`test_binancefills_walk.py:775`), N25. |
| T-250-17 | DoS: symbol order under the deadline | high | mitigate | CLOSED | Semaphore held per request, inside the page loop (`exchange.py:2789`, deadline check inside it at 2790), so symbol tasks interleave and every symbol starts each run; no depth-first holding. Pin: `test_repeated_deadline_stops_advance_the_frontier_every_run` (`test_binancefills_e2e.py:589`), N24. |
| T-250-18 | DoS: quiet-prefix deadline case | medium | accept | CLOSED (accepted, founder ruling 2026-11-25 UTC) | Recorded in 250-07 PLAN register row, `250-07-SUMMARY.md` Known limit bullet, `250-08-SUMMARY.md:140`, and at the switch (`job_worker.py` comment). Loud: `binance_deadline_symbols` and a WARNING per run (`exchange.py:3015-3022`); bounded by the reach clamp (2744-2754, `binance_fills_reach_clamped` non-holding). Caveat recorded by round 3 (WR-02): sync-time `binance_*` flags do not survive the chained derive / CSV analytics writes, so the WARNING log is the lasting signal; booked in TODOS.md. |
| T-250-19 | DoS: sync handler tail | medium | accept | CLOSED (accepted known limit, corrected in round 1 WR-03) | The constant's comment states the tail ledger and the corrected repeating-stall reading, with the DB round-trip term named UNMEASURED (`exchange.py:719-735`); the switch comment states the same (`job_worker.py` comment, "A third known gap"); call-site comment at `job_worker.py:2324-2326`; hand-over line `250-08-SUMMARY.md:140`-area. Budget pinned below the 900 s handler by `test_the_read_deadlines_are_pinned`. The CHANGELOG line is owed at ship. |
| T-250-20 | Tampering: full-suite run reaching a shared DB | high | mitigate | CLOSED (by record, replaced scope) | `250-08-SUMMARY.md:166`: `env -i` used for every pytest and mypy run, no `supabase` CLI, no Docker. The full-suite run was replaced by targeted credential-free runs under the coordinator load limit. Auditor's own runs used the same `env -i` form. |
| T-250-21 | Repudiation: base-vs-head failure comparison | medium | mitigate | OWED FROM CI (not an open threat) | `250-08-SUMMARY.md:28,166` and Deviation 1 record that the full-suite run, coverage TOTAL and base-vs-head failure-list comparison were not run locally and are owed from the CI `python` job. Not counted as open, per the coordinator's instruction and the record. |
| T-250-22 | DoS: live onboarding read walks the 85-day reach | medium | mitigate | CLOSED | `BinanceAdapter.fetch_raw` calls `_fetch_raw_trades_binance` with the default 240 s deadline (`services/ingestion/binance.py:105-109`, no `read_deadline_s` passed; file unmodified); no seed walks from `read_now - 85 d` (`exchange.py:2745-2746`); inside the 30-minute `process_key_long` timeout. Pin: `test_onboarding_without_a_since_walks_from_the_reach_and_returns_a_fill_older_than_seven_days` (`test_binancefills_adapter.py:63`, N30). The adapter drains none of the read's flags: recorded known limit. CHANGELOG line owed at ship. |
| T-250-SC | Tampering: package installs | high | accept | CLOSED | `git diff 21b9ad929 HEAD --name-only` outside `.planning/` lists no `requirements*`, `pyproject`, `package*.json` or lockfile; ccxt untouched. |

## Test evidence

- Auditor, HEAD blob content, `env -i`: `tests/test_binancefills_cursor.py` 21 passed.
- Auditor, `tests/test_binancefills_walk.py`: 14 failed / 20 passed, but taken with another process's uncommitted
  BadSymbol neuter on the worktree file (see note above); it is not a reading of HEAD and is not used as evidence.
  Not re-run, because a concurrent pytest was already loading the machine and the load limit forbids a second.
- `analytics-service/` at HEAD is identical to `6eaaa5b13` (the two later commits are docs only), and round 3
  (`250-REVIEW-R3.md` Summary, "Tests") recorded green at `6eaaa5b13` from a clean `git archive` copy: cursor 21, walk 34,
  e2e 11, `test_okxtrades_cursor.py` 20, `test_job_worker.py -k` 19 passed, mypy clean on both source files.

## Unregistered flags and recorded open gaps

| Item | Status |
|---|---|
| SC-3 gap: a stopped or failed Binance read on a cursor column ahead of the strategy's stored fills is never re-read (`advance_sync_cursor` only moves forward). Not in any plan's threat register; found in review rounds 1-3 (R1 WR-01, R2 WR-01, R3 WR-01/WR-02). | Recorded and owned: `TODOS.md:235` `[250-BINANCE-STOP-BELOW-CURSOR]` (MEDIUM, data-integrity, owner unassigned, book a phase before `USE_RAW_TRADE_INGESTION` is turned on for Binance); named at the switch comment; run-time signal is the `binance_stop_below_cursor` flag plus WARNING (`job_worker.py` ~2713-2735), which has a known false negative (stop plus failed symbol) and does not survive the derive chain. Not a blocker for this phase (Binance raw ingestion is switched off and PROD held 0 Binance keys on 2026-11-25), but it must be closed before the switch. |
| `exchange.py:2950-2952` unscrubbed `str(item)` in the per-symbol failure log; `BinancePerSymbolFetchError` message embeds `{first_error!r}` (`exchange.py:~866`). | Pre-existing, outside this phase's diff; informational only. |

## Verdict

SECURED. 23 threats: 22 closed (15 mitigations verified in code, 5 accepted risks documented, 1 transfer documented,
T-250-20 closed by record), 1 owed from CI (T-250-21), 0 open. Ship-time obligations that are not code gaps: write the
CHANGELOG lines handed over in `250-08-SUMMARY.md` (T-250-07, T-250-18, T-250-19, T-250-22), and read the full-suite
base-vs-head comparison from CI (T-250-21).

**threats_open: 0**
