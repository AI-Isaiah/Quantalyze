---
phase: 131-smoothed-mtm-options-daily-mtm
fixed_at: 2026-07-22T00:00:00Z
review_path: .planning/phases/131-smoothed-mtm-options-daily-mtm/131-REVIEW.md
iteration: 2
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 131: Code Review Fix Report

**Fixed at:** 2026-07-22
**Source review:** 131-REVIEW.md (2 critical, 5 warning, 3 info — BLOCK for phase goal) + re-review NF-01
**Iteration:** 2 (iter-1 fixed CR/WR/IN; re-review surfaced NF-01 as a residual of the CR-02 fix)
**Scope:** ALL findings (coordinator directive upgraded MEDIUM/LOW from conditional to mandatory) + NF-01

**Summary:**
- Findings in scope: 11 (CR-01, CR-02, WR-01..05, IN-01..03, NF-01)
- Fixed: 11 — every fix TEST-FIRST (RED proven before each code change)
- Skipped: 0

**Gates (all green):**
- Full suite: **4183 passed, 96 skipped, 3 pre-existing OKX failures** (baseline 4182 → +1 new NF-01 test, zero NEW failures)
- `mypy --strict --follow-imports=silent services/ routers/ models/` → **Success, 0 issues (84 files)**
- AST purity (`test_option_enters_via_cash_delta_not_perp`) → green (`deribit_txn.py` stays pandas/async-free; all additions stdlib-only)
- SC-4: `cash_settlement` / `mark_to_market` byte-identity matrix + zero-fetch pins green; every production hunk stays inside the smoothed-gated path or the option-marks fetch infra. NF-01's `option_mtm_daily` param defaults `None` → byte-identical for the pure-core direct callers.

## Fixed Issues

### NF-01 (CRITICAL, re-review — residual of CR-02): sibling crawl-day event holes a healthy open instrument
**Commit:** 023a1b0a
**Files:** services/deribit_txn.py, services/deribit_ingest.py, tests/test_smoothed_mtm_core.py
The CR-02 grid extension fetched an OPEN instrument A only through `last_settled` (yesterday), but a sibling B with ANY crawl-day event (a nonzero-EOD trade/settlement today) pushed `option_mtm_daily`'s `global_last` to TODAY via `candidate_lasts` — a day on which A still carried a nonzero position with no settled mark → a spurious D-07 `LedgerValuationError` naming the healthy A (reproduced: `instrument=BTC-26MAR27-100000-C carries a nonzero position on 2026-07-22 but has NO daily mark`). **Fix:** `option_mtm_daily` gains an optional `last_settled_day` kwarg; when set, `global_last = min(max(candidate_lasts), last_settled_day)`. `_build_smoothed_option_mtm` threads the `last_settled` it already computes. Capping at the settled boundary is coherent with the book channel (the anchor's settled book `options_value − options_session_upl` also excludes post-boundary positions) and SUBSUMES documented residual #1 (crawl-day-open partial bar): the crawl-day cash books on the cash channel; that day is simply never MTM-marked (it accrues from the next settlement). Default `None` = no cap → the pure-core direct callers in `test_deribit_txn.py` stay byte-identical (SC-4). The `test_smoothed_merge_wiring_guard` stub signature was widened (`**_kw`) to accept the new kwarg. **New today-RELATIVE regression** (dates derived from the real crawl reference — historical 2026-01 fixtures never exercise this because `_last_settled_option_mark_day` never constrains their grid): A held open across a sibling B opened-and-still-open TODAY; proven RED (the exact NF-01 hole naming A on today) with the source fix stashed, GREEN after. Economics hand-derived from M5 (B opened this session ⇒ its whole value is `options_session_upl` ⇒ settled anchor 0.10 == terminal_book).

### CR-01: Marks fetch end-bound excludes the newest day's 08:00 bar
**Commit:** 25748d3a
**Files:** services/deribit_ingest.py, tests/test_deribit_ingest.py, tests/test_smoothed_mtm_core.py
`fetch_deribit_option_daily_marks` end bound is now `newest_day 00:00 + 24h`, covering the bar Deribit stamps at `newest_day 08:00` (M7 evidence) while still excluding the NEXT day's bar (expiry cap preserved). The sibling perp fetcher achieves the same by ending at `now()`; `+24h` keeps the explicit expiry-capped bound. **Test infra fixed (the masking half):** the `_OptionsAdapterStub` chart endpoint and a new `_RangeRespectingChartStub` now RESPECT `start_timestamp`/`end_timestamp` and stamp bars at 08:00 UTC; the old bounds-pin test that blessed the midnight bound now pins `+24h`. New regression: a single-day window `[T, T]` returns day T's bar (was: zero bars → spurious D-07 hole).

### CR-02: Marks window/grid stopped at last EVENT day, not last SETTLEMENT
**Commit:** b0c7279f
**Files:** services/deribit_ingest.py, tests/test_smoothed_mtm_core.py
New `_last_settled_option_mark_day()`: bar stamped `D 08:00` completes at `D+1 08:00`, so the last COMPLETED (settled) bar day = `day(most recent 08:00 boundary) − 1`; the current PARTIAL bar (whose live close still carries `options_session_upl`) is never ingested. `_build_smoothed_option_mtm` now fetches an OPEN instrument (final replayed position ≠ 0) through `min(max(last_event_day, last_settled), expiry)`; closed instruments unchanged. The grid extends via the fetched marks (`option_mtm_daily`'s `candidate_lasts` already honors them), so the ΔMTM series no longer truncates at the last trade and interleaved instruments no longer trip spurious holes. New tests: open position with ≥2 settled days after the last trade and a MOVED mark (was: book-channel breach 2400x); two-instrument interleave (was: spurious hole naming the healthy instrument); future-expiry cap at last_settled with the end-bound param pinned (a bar past the settled day is scripted and proven excluded).

### WR-01 (HIGH): H1 wedge double-counted the settled book under smoothed
**Commit:** f0aac0f6
**Files:** services/deribit_ingest.py, tests/test_smoothed_mtm_core.py
`smoothed_mtm` joins the `mark_to_market` wedge arm: `terminal_upnl_native = state.native_upnl` (the COMBINED futures+options session uPnL) — never `+ options_value`. Derivation from the M5 anchor identity (`equity − combined_upl == cash + options_value − options_session_upl`): under smoothed `Σnative_pnl = cash′ + options_value − options_session_upl` (book-channel-guarded), so the required wedge is exactly the combined session uPnL — the two legs the settled daily marks exclude. Empirically confirmed the reviewer's claim before fixing: §5 raised `InceptionReconciliationError` (breach_ratio 1.08e4) on the open-book fixture under the old wedge. New §5-THROUGH test on an economics-consistent open-book fixture with BOTH session legs nonzero (equity 0.09 = cash −0.10 + futures_upl 0.01 + options_value 0.18): wedge pinned 0.03 (old arm produced 0.21), reconstruction closes.

### WR-02 (HIGH): Q3-3 ΔBook slice disagreed with the ms cash filter at the 08:00 boundary
**Commit:** 95fa75be
**Files:** services/deribit_txn.py, tests/test_smoothed_mtm_core.py
Marks are keyed by BAR-STAMP day (M4); the bar stamped `D 08:00` completes at `D+1 08:00`, so Book at a boundary instant `X 08:00` is the day-keyed `Book[X−1]`. ΔBook slice corrected from `(start_day, end_day]` to `[start_day, end_day)` — now agreeing with the inclusive ms cash filter at both boundaries: a coverage-era first trade after 08:00 has its opening book entry IN (its cash is in), a trailing crawl-day trade after the last summary has its book entry OUT (its cash is out). **Oracle re-derived from Deribit economics** (not the code's formula): bought 1.0 intra-session at trade price 0.04 (change −0.05 = premium + fee; E3: rpl+upl gross of fees), session settles at mark 0.05 → `rpl=0, upl=0.01` (old self-referential fixture said 0.06). New tests: the corrected fixture (breaches the old slice by the position's full book value), the trailing-trade class-2 scenario, and a Phase-82 E3 flat-flat closure pin (ΔBook 0, Σ(rpl+upl) == Σ(change+commission) exactly).

### WR-03 (MED): Currency casing not normalized in the replay path
**Commit:** 59c44b33
**Files:** services/deribit_txn.py, tests/test_deribit_txn.py
`replay_option_positions` now uppercases `currency` like the ~20 other read sites (and the adapter's pre-retention path), so a venue `"btc"` can no longer fork a phantom per-currency series bucket beside `"BTC"` at the ΔMTM merge. Test pins replay output AND the pure `option_mtm_daily` keys.

### WR-04 (MED): `price <= 0` skip turned a worthless close into a "structural hole"
**Commit:** 76b90923
**Files:** services/deribit_ingest.py, tests/test_deribit_ingest.py, tests/test_smoothed_mtm_core.py
The option fetcher keeps a 0.0 close (a deep-OTM worthless mark is data — the premium collapse is real ΔMTM) and drops only negatives; the perp-INDEX sibling is untouched (non-positive is genuinely nonsense there). The old pin test (0.0 dropped) corrected; new adapter wiring test: a held option marked 0.0 books the −Book collapse instead of hard-failing with a misleading "missing bar" message.

### WR-05 (MED): Activity gate vs replay disagreement / `since_ms` unpinned
**Commit:** 35695732
**Files:** services/deribit_ingest.py, tests/test_smoothed_mtm_core.py
`build_deribit_native_ledger` fails loud (`LedgerValuationError`, before crawling) on `smoothed_mtm` + `since_ms is not None` — the absolute-position replay is only correct over full history (the reviewer's offered option (2)). With full history pinned, the residual gate-vs-replay case (summary-only / correction-only option evidence with a NONZERO settled anchor) is a genuine reconstruction impossibility, and the existing book-channel `{}`-vs-anchor breach is the CORRECT fail-loud, not a spurious one — kept. Test pins the smoothed raise AND that `cash_settlement` still accepts the same `since_ms` (SC-4).

### IN-01: Lexicographic id tie-break on same-ms multi-fills
**Commit:** 93852ff1
**Files:** services/deribit_txn.py, tests/test_deribit_txn.py
Replay sort key is now shortlex on the id string (`(instant, len(sid), sid)`): numeric ids of different digit length order numerically ("999" < "1000"), so the true last fill is the EOD position; non-numeric ids stay deterministic. Test proves both concat orders resolve to the final fill (old key picked the intermediate fill).

### IN-02: Locale-dependent `strptime(%d%b%y)`
**Commit:** e20b0447
**Files:** services/deribit_ingest.py, tests/test_deribit_ingest.py
`_option_expiry_iso` uses an explicit English month map + `date()` construction — no `%b`. RED proven under `de_DE` `LC_TIME` (MAR/OCT/DEC failed → expiry None → pre-retention partition dead). Tests: locale-independence (skips only if no de_DE locale installed) + an everywhere-running all-12-months / impossible-date / unknown-token / non-dated pin.

### IN-03: Intraday-scalped old instruments bucketed as pre-retention
**Commit:** 7ed1da0e
**Files:** services/deribit_ingest.py, tests/test_smoothed_mtm_core.py
An instrument with NO nonzero end-of-day position (opened and closed intraday) needs no marks — `_build_smoothed_option_mtm` now skips its fetch entirely and never buckets it into `pre_mark_retention_option_days` (its cash legs carry the full P&L; the old path stamped a spurious `complete_with_warnings`). Test: no bucket, zero chart calls, cash-only series intact.

## Skipped Issues

None.

## Documented residuals (not regressions — fail-loud, never silent)

- ~~A position OPENED on the crawl day can pull its window onto the current PARTIAL bar~~ — **RESOLVED by NF-01**: the ΔMTM grid is now capped at `last_settled`, so a crawl-day (unsettled) day is never MTM-marked; its cash books on the cash channel and its MTM accrues from the next settlement. NF-01's grid cap subsumes this residual.
- The CASH-basis H1 wedge (`session_upl + options_value`, with `session_upl` combined) over-covers by `options_session_upl` on an open book — pre-existing, SC-4-frozen, and exactly the M5 "first live open-book anchor is the watched follow-up". Not touched (SC-4).

---

_Fixed: 2026-07-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
