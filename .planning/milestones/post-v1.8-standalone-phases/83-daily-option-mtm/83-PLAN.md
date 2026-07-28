# Phase 83 — daily option-MTM attribution (money-correctness)

**Status**: PLAN v1 (design + task breakdown + test strategy). No production code in this phase doc.
**Milestone**: v1.9 follow-on to Phase 82 (branch `v1.8-native-unit-reconstruction`, HEAD 9d356076).
**Bug class**: silent P&L misattribution — a per-SESSION delta spanning MANY days lumped onto the
single settlement day. Confirmed live on strategy `c225840c` "Phoenix Protocol", key `95089958`:
max |daily| 94%/day, Aug-2025 month +3305% — the TOTAL is right (Phase 82 closed BTC 6.479224 /
USDC −97752.858490, <$1), the DAILY shape is insane. The founder confirms the P&L is REAL but must
be SPREAD across the days it accrued.
**Doctrine**: TDD (every task's failing test first), fail-loud (D-07), SC-4 byte-identity for
perp-only / USD-native accounts, `mypy --strict --follow-imports=silent services/ routers/ models/`
stays 0. The feasibility evidence is SETTLED — the executor ENCODES it, never re-derives it.

---

## 1. Root cause recap + the corrected P&L model

Phase 82 fixed the TOTAL: inside a currency's summary coverage window, option `trade`/`delivery`
contribute `−commission` and `options_settlement_summary` contributes `realized_pl + unrealized_pl`
(`deribit_txn.py:1222-1401`). That is balance-exact but attributes each summary's
`realized_pl + unrealized_pl` — a per-SESSION delta that can span WEEKS of accrual on a
long-dated option book — to the ONE day the summary lands. The daily series is therefore a
sequence of session lumps, not daily P&L.

### The corrected model — daily mark-to-market of the open option book

Daily-marking is a **REDISTRIBUTION that PRESERVES the total** — the closure gates stay green by
construction:

```
For currency c, UTC day d:

native_pnl[c][d] = Σ change(r)                 over cash-bearing rows r of (c,d)
                                               (option trade/delivery now contribute FULL change —
                                                premium/payout cash back in, Phase-82 fee-only
                                                reclass REMOVED)
                 + ΔMTM[c][d]                  (NEW: day-over-day delta of the open option book,
                                                Book[c][d] − Book[c][d−1], where
                                                Book[c][d] = Σ_instr position[instr][d] × mark[instr][d])

options_settlement_summary                     → contributes NOTHING to daily attribution
                                                (kept classified: change==0 enforced; retained
                                                 ONLY as a reconciliation cross-check channel)
```

**Total preservation (telescoping)**: Σ_d native_pnl[c][d] = Σchange + Book[c][last_marked_day]
(Book[c][pre-inception] = 0, full-history venue). Terminal-flat book → Book(T)=0 → total = Σchange
EXACTLY (the Phoenix targets hold verbatim). Non-flat terminal book → total = Σchange + open-book
MTM at the last settlement — the SAME settled-equity basis the §5 gate anchors to (see §2 Q3), so
§5 closes by construction with the Phase-82 combined wedge (KEPT).

### The mark source (SETTLED by the live feasibility probe — encode, don't re-derive)

`public/get_tradingview_chart_data resolution=1D` returns daily marks for OPTION instruments at
~100% coverage within each instrument's listed life, INCLUDING long-expired instruments (2.5+ yr
retention). Bars are stamped **08:00 UTC = Deribit's settlement boundary** (session-aligned with
the summaries). All other candidates (`get_mark_price_history`, `get_last_settlements_by_instrument`,
public trades) REFUSE expired instruments — dead ends, do not revisit.

### The position source (SETTLED — verified live)

The signed post-trade `position` field on option `trade`/`delivery` rows reconstructs the per-day
open book per instrument: shorts negative, deliveries zero the position. Pure replay, no fills-axis
dependency, no hand-rolled Greeks/settlement math (D-08 stays in force).

### Sparse marks = fail-loud (D-07), NO interpolation

A missing bar inside an instrument's listed life essentially never happens (probe evidence); a hole
is therefore STRUCTURAL → `LedgerValuationError` naming instrument + day. **No session-lump
fallback — that IS the bug being removed.** The only cash-basis era that remains is
pre-retention/pre-listing (an instrument whose entire life predates the venue's chart retention):
those days keep cash-basis `change` + the `complete_with_warnings` channel (§2 Q4).

---

## 2. Resolved design decisions

### Q1 — Day-grid convention: **bar-tick UTC-day = native-grid day** (PINNED)

Option 1D bars are 08:00-UTC session bars; the native grid (`_row_utc_day`) is UTC-midnight.
**Pinned convention**: `mark[instr][D]` = close of the 1D bar whose tick timestamp falls on UTC day
`D` (i.e. the bar stamped `D 08:00`), exactly the tick→`strftime("%Y-%m-%d")` mapping the existing
perp-close usage (`fetch_deribit_perp_daily_index`, deribit_ingest.py:593-686) already pins — the
SAME one-day-basis class, no new convention enters the codebase. `position[instr][D]` = the signed
post-trade position after the LAST option row with `utc_day ≤ D` (end-of-day replay on the same
`_row_utc_day` grid). The ≤8h skew between a bar boundary and midnight is intraday attribution
noise WITHIN the one-day class; the telescoped TOTAL is exact regardless (the skew cancels
day-over-day). Document this in the `option_mtm_daily` docstring AND the D-pin (Task 9); pin with
`test_day_grid_convention_bar_tick_day`.

### Q2 — Where the MTM channel is computed: adapter fetches, pure module attributes

`deribit_txn.py` stays pandas-free/async-free (AST purity guard). Split:
- `replay_option_positions(rows)` (pure, deribit_txn.py) — per-instrument end-of-day signed
  positions + first/last held day + the instrument's currency binding.
- `fetch_deribit_option_daily_marks(exchange, instrument, oldest_day, newest_day)` (async,
  deribit_ingest.py) — one request per held instrument; results immutable → cacheable.
- `option_mtm_daily(positions, marks)` (pure, deribit_txn.py) — per-(day, ccy) ΔMTM with the
  fail-loud hole check.
- `build_deribit_native_ledger` (adapter) orchestrates: replay → fetch → attribute → MERGE the
  ΔMTM dict into the `txn_rows_to_native_daily` output before the pd.Series conversion.
`txn_rows_to_native_daily`'s signature is UNCHANGED (no marks parameter) — its option arms simply
revert to full `change`.

### Q3 — Terminal book value & the reworked identity guard: settled-book basis

The pnl series' book channel telescopes to `Book[c][last_marked_day]` — the book at the **last
08:00 settlement**, NOT the crawl instant. This is deliberate and load-bearing for §5:
`terminal_native − upnl_native` (native_nav.py:458, with the Phase-82 COMBINED
futures+options wedge, `_combined_session_upl`) IS settled equity = cash + settled book value, so
`Σpnl = Σchange + Book(last settlement) = settled_equity − Σflows` and the §5 residual → 0 by
construction. Trades AFTER the last settlement bar are the trailing edge: their cash `change` is
counted, their MTM lands next crawl — per-compute movement on the most recent day is convergence,
not nondeterminism (same posture as Phase 82 §6).

`assert_balance_identity` (deribit_txn.py:1058) is REWORKED into two channels:

1. **Cash channel (strict, exact, ALL currencies — the CR-01 exemption is REMOVED)**: Σ(cash
   contributions) == Σchange over `_NATIVE_CASH_BEARING_TYPES` rows. With option rows back on full
   `change` this is an arithmetic identity — any breach is a dropped/mis-classified row. The
   `open_option_ccys` parameter, `_option_activity_after_coverage`, the CR-01 comment block, and
   `CompletenessReport.balance_identity_open_option_ccys` are all DELETED (the open book is now
   VALUED, so the strict guard applies to open books too). This also RESOLVES the deferred CR-01
   §5-envelope follow-up (F1, commit 610bf47c): no exempted currency ⇒ no widened silent envelope.
2. **Book channel (anchor cross-check, fail-loud)**: computed `Book[c](last settlement)` (replay ×
   marks) reconciles against the anchor's settled book =
   `state.native_options_value[c] − state.native_options_session_upl[c]` (both read off the SAME
   `get_account_summaries` response; the second is a NEW field on `DeribitNativeAccountState`,
   absent → 0.0, SC-4 byte-safe). Tolerance: `max($1-equiv native floor, 1e-4·throughput_c)` — the
   residual terms are the 1D-bar-close vs venue-mark basis (same instrument, same venue, tiny) and
   current-session position moves (excluded from BOTH sides by the settled basis). On breach →
   `LedgerValuationError` naming currency + magnitude class only (leak discipline). ⚠️ This
   decomposition (`equity − session_upl` splits cleanly into cash + options_value −
   options_session_upl) is probe-consistent but NOT verifiable at a flat terminal — first live
   open-book anchor is watched (§6 risk, same class as the Phase-82 wedge follow-up).
3. **Summary channel (retained cross-check)**: over each currency's summary coverage window,
   `Σ(realized_pl + unrealized_pl)` == `Σ(option change + commission) inside the window` +
   `[Book(window end) − Book(window start)]` (the E3 closure, 9.222194 vs 9.222190, generalized to
   non-flat window ends by the MTM series). Fail-loud on material breach — the summaries stop
   driving attribution but keep policing it. `_summary_coverage_windows`, `_required_summary_field`,
   `_option_commission` survive ONLY in service of this check.

### Q4 — Pre-retention / pre-listing era: cash-basis + `complete_with_warnings` (bounded fallback)

Per instrument, marks are fetched over `[first_held_day, min(last_held_day, expiry_day)]`:
- **Hole inside a NONEMPTY series** within that span → `LedgerValuationError` naming instrument +
  day (structural — the probe showed this essentially never happens; if it fires, STOP and
  investigate, never interpolate, never fall back to the session lump).
- **Wholly EMPTY response** for an instrument whose expiry predates the venue's chart-retention
  horizon (~2.5 yr, pinned as a constant from the probe evidence; expiry parsed from the instrument
  name via the existing classification machinery — never guessed) → that instrument contributes NO
  MTM; its days stay cash-basis (`change` is already counted) → stamp
  `pre_mark_retention_option_dailies` on the account meta (the existing warning-key →
  `complete_with_warnings` pattern; supersedes Phase 82's `pre_summary_rollout_option_dailies`,
  which dissolves — marks cover the pre-2025-01-12 summary-rollout era, so the old era boundary is
  no longer meaningful).
- **Wholly EMPTY response** for an instrument INSIDE the retention horizon → fail loud (a listed,
  traded instrument with zero bars in retention is structural, not benign).
Neither Phoenix nor Zav2 has pre-retention history — the fallback ships tested but cold.

### Q5 — What Phase-82 code is KEPT / REWORKED / REMOVED

| Phase-82 artifact | Disposition |
|---|---|
| Coverage-gated fee-only reclass (option trade/delivery → `−commission` inside coverage) | **REMOVED** — option rows contribute full `change` everywhere |
| `_summary_contribution` driving native_pnl (summary → `rpl+upl` in attribution) | **REMOVED from attribution**; summary type stays classified (change==0 enforced), fields feed the Q3-3 cross-check only |
| CR-01 open-book exemption (`open_option_ccys`, `_option_activity_after_coverage`, report field, F1 §5-envelope doc) | **REMOVED** — strict guard now applies to open books; CR-01 follow-up resolved |
| F2 pre-rollout-straddle pinned fail-loud (`test_pre_rollout_straddle_fails_loud_intentional`) | **REWRITTEN, assertion INVERTED** — the straddle fixture now RECONCILES (daily marks carry V₀); the flagship regression of this phase |
| `pre_summary_rollout_option_dailies` warning | **SUPERSEDED** by `pre_mark_retention_option_dailies` (Q4) |
| `_summary_coverage_windows`, `_required_summary_field`, `_option_commission` | **KEPT (repurposed)** — cross-check plumbing only |
| `assert_balance_identity` | **REWORKED** — Q3 two-channel + summary cross-check |
| Task-2b combined session-uPnL wedge (`_combined_session_upl`), `native_options_value` read, D5 one-read, verbatim change guards, unknown-type guard, swap reclass, `txn_rows_to_daily_records` (USD sibling), `native_nav.py` core | **KEPT untouched** |

`native_nav.py` is expected UNCHANGED (it still consumes a per-ccy daily `native_pnl` series);
`_build_dense_native_marks` needs no change (required days derive from the `native_pnl` series,
which now includes ΔMTM days — covered automatically by the dense span).

---

## 3. Task breakdown (ordered; TDD — every task names a test that FAILS pre-fix)

### Task 0 — Evidence record (encode the feasibility probe; small, no live run gates the code)
Commit the probe outputs as
`analytics-service/docs/evidence/drb-option-daily-marks-2026-07.json`: 1D-chart coverage ~100%
within listed life incl. expired instruments (2.5+ yr retention), 08:00-UTC bar stamping, the
rejected alternatives (`get_mark_price_history` / `get_last_settlements_by_instrument` / public
trades refuse expired instruments), signed post-trade `position` semantics (shorts negative,
deliveries zero), and the telescoping total-preservation check (AFTER total = Σchange + terminal
MTM). Cross-reference `drb-options-semantics-2026-07.json` (E1–E5 stay valid facts; their
ATTRIBUTION consequences are superseded by this phase).

### Task 1 — `fetch_deribit_option_daily_marks` (deribit_ingest.py)
~60-line clone of `fetch_deribit_perp_daily_index` (:593-686 — read it first; SAME
`public_get_get_tradingview_chart_data` endpoint, SAME transient-retry →
`DeribitTransientReadError` on budget exhaustion, SAME scrubbed structural-no-data `{}` return, SAME
tick→UTC-day mapping/dedupe). Signature:
`fetch_deribit_option_daily_marks(exchange, instrument, *, oldest_day, newest_day, sleep, max_retries)`
— takes the INSTRUMENT name verbatim (no suffix synthesis) and an explicit `newest_day` (expiry-
capped span; never fetch past expiry). Returns `dict[utc_day, close]`. The structural-gap /
fail-loud decision belongs to the CALLER (Task 3/5) — this function stays an honest fetch, exactly
like its sibling. **Tests first** (`tests/test_deribit_ingest*`): happy-path tick/close mapping on a
stubbed exchange; transient exhaustion raises `DeribitTransientReadError`; `BadSymbol`/`status!=ok`
→ `{}`; non-positive closes skipped; params carry the exact instrument + ms bounds.

### Task 2 — `replay_option_positions(rows)` (pure, deribit_txn.py)
Reconstruct per-day end-of-day open option positions per instrument from the signed post-trade
`position` field on option `trade`/`delivery` rows (classification via the existing
`classify_instrument` — option arm only). Returns per-instrument
`{currency, first_day, last_day, positions: {day: signed_size}}` (plain data, sorted, pandas-free).
Rows are ordered by `(timestamp, id)` within each instrument before replay (crawl concat order is
NOT trusted). Fail-loud (`LedgerValuationError`, id/type-only messages): option trade/delivery row
with absent/null/non-numeric `position` (schema drift — the field is the ONLY position source;
fabricating a book mis-states MTM); undatable timestamp (verbatim guard class). A `delivery` row
whose post-trade `position` is nonzero is accepted as data (partial delivery is Deribit's call) —
NOT asserted zero, the probe fact "deliveries zero the position" is encoded in the fixtures, not as
a runtime rejection. **Tests first** (`tests/test_deribit_txn.py`): long build/reduce/close;
shorts negative; delivery zeroes; multi-instrument + multi-currency separation; out-of-order rows;
missing-`position` fail-loud (parametrized absent/None/""/"x"); perp/future/spot rows IGNORED
(classification-gated); AST purity guard stays green.

### Task 3 — `option_mtm_daily(positions, marks)` (pure, deribit_txn.py)
Per-(day, ccy) ΔMTM from the Task-2 replay + Task-1 mark maps:
`Book[c][d] = Σ_instr pos[instr][d] × mark[instr][d]` over the union day grid (positions
carry forward between events — a balance is constant between ledger events by definition; marks are
NEVER filled), `ΔMTM[c][d] = Book[c][d] − Book[c][d−1]`. Day-grid convention per §2 Q1 (bar-tick
day). Fail-loud: a day inside `[first_held, min(last_held, expiry)]` where the instrument's
position is nonzero and its mark map has NO bar → `LedgerValuationError` naming instrument + day
(D-07, NO interpolation, NO session-lump fallback). Instruments flagged pre-retention (Task 5)
are excluded before this function sees them. Returns
`(delta_mtm: dict[ccy, dict[day, float]], terminal_book: dict[ccy, float])` — the terminal book
feeds the Q3-2 guard channel. **Tests first**: single long option held N days → ΔMTM equals
hand-computed mark deltas and telescopes to `Book(T) − 0` exactly (float-exact fixture); short
position signs invert; carry-forward across no-trade days; the HOLE case raises naming
instrument+day; the pinned `test_day_grid_convention_bar_tick_day`; mutation-honesty: dropping one
bar reddens (proves the hole guard is load-bearing).

### Task 4 — Rework `txn_rows_to_native_daily` (deribit_txn.py:1222-1401)
Option `trade`/`delivery` rows contribute their FULL native `change` — DELETE the coverage-gated
`−commission` arm (:1360-1366) and the `_ts_in_coverage` consultation in the aggregation loop;
`options_settlement_summary` contributes NOTHING — the `_summary_contribution` accumulation
(:1295-1318) becomes: enforce `change == 0.0` (nonzero → fail loud, kept verbatim) then `continue`
(the WR-03 blank-currency and required-field guards move with the fields into the Q3-3 cross-check
path). The unknown-instrument delivery fail-loud, verbatim change guards, swap reclass, and the
zero-change-no-entry rule are byte-untouched. Update the Phase-82 comment blocks in place (:424-445
type-set commentary — summary is now classified-but-inert on the native path). **Tests first**:
`test_option_trade_full_change_restored` — the 2025-07-13 fixture now contributes `+2.736` cash on
its day (the REDISTRIBUTION happens in the merged ΔMTM channel, asserted at Task 5/8 — this test
pins that the cash channel alone is Σchange-exact again); `test_summary_contributes_nothing` —
summary row with `realized_pl=0.03, unrealized_pl=-0.01` creates NO entry (fails pre-fix: +0.02);
`test_summary_nonzero_change_still_fails_loud`; the existing SC-4 unit pin
`test_perp_only_ledger_byte_identical` stays green UNMODIFIED; Phase-82 tests asserting the fee-only
reclass (`test_option_trade_premium_excluded_fee_kept_inside_coverage`,
`test_option_delivery_fee_only_inside_coverage`, `test_coverage_window_bounds`'s attribution arm,
`test_option_trade_missing_commission_fails_loud`'s inside-coverage arm) are DELETED WITH the code
they pin (their protection is superseded by the Task 3/6/8 suite — enumerate the deletions in the
commit message, never silently).

### Task 5 — Adapter integration (`build_deribit_native_ledger`, deribit_ingest.py:1719-1836)
After `txn_rows_to_native_daily`: (a) `replay_option_positions(raw_rows)`; (b) per held instrument,
`fetch_deribit_option_daily_marks` over its expiry-capped span (existing public-read pacing; one
request per instrument; results are immutable → per-job memoization at minimum, persistent caching
is a follow-up knob, NOT built now); (c) partition instruments: pre-retention-empty → collect into
`report.pre_mark_retention_option_days` (day buckets, the Q4 warning; worker stamps
`complete_with_warnings` exactly like the retired `pre_summary_rollout_option_dailies` site in
`job_worker.py`); in-retention-empty or holed → the Task-3 fail-loud fires; (d)
`option_mtm_daily(...)` → MERGE `delta_mtm` into `native_daily` (dict-add per (day, ccy)) BEFORE
`_native_daily_to_series`; (e) thread `terminal_book` into the reworked `assert_balance_identity`
(Q3). Remove the `open_opt` exemption plumbing (:1805-1822) and the
`balance_identity_open_option_ccys` report field + its consumers (grep `transforms.py`,
`nav_twr.py`, `job_worker.py`, the acceptance harness — delete or repoint each, never leave a dead
field). Add `native_options_session_upl` to `DeribitNativeAccountState` (read off the same
summaries; absent → 0.0). **Tests first** (`tests/test_deribit_ingest*`, stubbed-exchange
real-adapter pattern of `test_native_nav_sc4_identity._real_adapter_ledger`): options fixture →
ledger `native_pnl` == cash channel + hand-computed ΔMTM (proves the merge is INVOKED at the call
site — wiring-guard discipline: neuter the merge, test reddens); one marks request per held
instrument with expiry-capped bounds; perp-only fixture → marks fetcher NEVER called (assert on the
stub) and ledger byte-identical; pre-retention fixture stamps the warning key; in-retention hole
fixture raises at ledger build.

### Task 6 — Rework `assert_balance_identity` (deribit_txn.py:1058-1164) + cross-checks
Implement §2 Q3: (1) strict cash-channel identity for ALL currencies — DELETE `open_option_ccys`,
`_option_activity_after_coverage` (:1014-1055), the CR-01/F1/F2 docstring blocks; signature gains
`terminal_book` + `anchor_settled_book` mappings for channel (2); (3) the summary-channel
cross-check helper (`_summary_channel_cross_check` or folded in — executor's call, pure either
way). All raises `LedgerValuationError`, currency + magnitude-class only. **Tests first**:
`test_cash_identity_strict_on_open_book` — an open-book fixture that Phase 82 EXEMPTED now passes
the strict cash channel (fails pre-fix: pre-fix code with the exemption removed would false-fire,
because pre-fix contributions ≠ Σchange inside coverage — this is the test that proves the
exemption can only be removed TOGETHER with Task 4); `test_book_channel_reconciles_anchor` + breach
sibling (perturbed anchor `options_value` → raises); `test_pre_rollout_straddle_now_reconciles` —
the F2 fixture (deribit_txn tests :1883-1918), assertion INVERTED: with daily marks carrying V₀ the
straddle closes (the flagship regression — fails without the whole phase);
`test_summary_cross_check_breach_fails_loud` — a covered-era summary whose `rpl+upl` diverges
materially from the cash+ΔBook reconstruction raises (the summaries still police);
`test_dropped_cash_row_fails_loud` — deleting one option trade row from the fixture breaches the
cash channel (mutation-honesty for channel 1).

### Task 7 — SC-4 identity gates
(a) The existing `tests/test_native_nav_sc4_identity.py` matrix + real-adapter tier passes
UNMODIFIED (its fixtures carry no option rows). (b) The Task-4 unit pin
`test_perp_only_ledger_byte_identical` unchanged. (c) NEW real-adapter perp-only fixture asserting
bit-exact (`check_exact=True`) output AND zero option-marks fetches (the stub assert from Task 5).
Mechanism (document in the code): all new arms are classification-gated — a perp-only ledger has
no option rows → empty replay → no fetches → empty ΔMTM merge (no-op) → identical float ops in the
same order; `native_options_session_upl` absent → 0.0. (d) USD-native/linear-only fixture likewise.

### Task 8 — End-to-end + §5 on synthetic options accounts
Test-only (`tests/test_deribit_options_pnl.py` or extend): (i) synthetic options+perps account with
a MULTI-DAY option position and daily marks → `reconstruct_native_nav_and_twr` yields the P&L
SPREAD across held days (each day ≈ its mark delta / NAV; assert the old single-day lump shape is
GONE: no day carries the whole session delta), §5 closes, no `InceptionReconciliationError`;
(ii) **non-flat terminal book** fixture (open position at anchor): terminal
`equity = cash + options_value`, `options_session_upl` nonzero, combined wedge → §5 closes with the
settled-book pnl total (THE new case Phase 82 could not close — fails pre-fix via the old
exemption/lump path); (iii) pre-retention-era fixture: cash-basis days + warning key, covered days
marked, TOTAL identical either way; (iv) mutation-honesty: perturb one daily mark materially → the
book-channel guard or §5 breaches (proves the marks are load-bearing, not decorative).

### Task 9 — Docs / pins
Update `analytics-service/docs/deribit-ingestion-design.md`: retire the Phase-82 coverage-gated
attribution pin, add the next free D-pin: "option daily attribution = full cash `change` + per-day
ΔMTM of the replayed open book marked at 1D chart closes (bar-tick-day grid, §2 Q1); summaries are
reconciliation-only; sparse marks fail loud (no interpolation, no session-lump fallback);
pre-retention era cash-basis + `pre_mark_retention_option_dailies` warning; identity = strict cash
channel (no open-book exemption — CR-01 resolved) + settled-book anchor cross-check". Amend the
`deribit_txn.py` module docstring (the Phase-82 semantic-shift sentence updates: native option P&L
is now cash + daily-MTM), the :424-445 type-set comments, and the `job_worker.py` warning-key docs.
CHANGELOG + VERSION + package.json in the SAME commit (version-bump-both-files rule).
`mypy --strict` 0; full pytest; AST purity guard; `npm run lint` untouched surface.

### Task 10 — Live acceptance (§5 below) — ⚠️ BLOCKED until Phoenix is re-onboarded
Key `95089958` is currently DELETED from the test DB. Re-onboard via the fresh ledger path (NOT the
poisoned retry-after-failure path — mig-038 `failed_final→failed` caveat), recompute, verify.
Secondary: validate on Zav2 / Alpha Centauri (strategy `3ca43b1f`, key #2 — an intraday options
day-trader: positions mostly open+close same day → ΔMTM small, cash channel dominant — a useful
orthogonal shape). Re-run the perp-only acceptance keys + the P72 harness (native basis from
Phase-82 Task 5 — the harness needs NO further basis change; nonzero-day sets shift with the new
attribution, which the fresh-basis derivation absorbs by construction).

---

## 4. SC-4 gating — how correct accounts stay byte-identical

Classification-gated, not account-flag-gated (the Phase-82 mechanism, extended): every new branch
keys on option rows / option instruments. Perp-only or USD-native ledger ⇒ zero option rows ⇒
`replay_option_positions` returns empty ⇒ NO marks fetched (assert on the stub, Task 7c) ⇒ ΔMTM
merge is a no-op ⇒ `txn_rows_to_native_daily` runs the same rows through the same float ops
(the option arms it LOSES were themselves option-classification-gated — removing them cannot touch
a ledger that never entered them) ⇒ bit-identical output. `assert_balance_identity`'s cash channel
degenerates to the Phase-82 trivial pass (contributions ARE the changes, residual exactly 0.0); the
book channel compares 0.0 == 0.0. `native_options_session_upl` absent → 0.0. `native_nav.py`,
`nav_twr.py`, `external_flows.py`, and the USD-space sibling are not modified at all.

---

## 5. Acceptance criteria (Task 10, all must hold — hard numbers)

1. **Phoenix Protocol** (`c225840c`, key `95089958`) re-onboarded + recomputed: the
   **2025-07-14** and **2025-08-28** spike days drop to `|daily| < 10%`; **Aug-2025** monthly
   return is sane (no longer +3305%; plausible band for a ~$150k options book); `|daily| < 10%`
   across the ENTIRE covered era (max |daily| was 94%). Pre-retention days (none expected for
   Phoenix) would be exempt + flagged.
2. **Closure preserved (the redistribution proof)**: full-history totals still close on the flat
   terminal — **BTC +6.479224**, **USDC −97752.858490**, residual < $1 each; §5 inception gate
   green; strict cash-channel identity green on every currency (NO exemptions in the run log);
   book-channel anchor cross-check green.
3. **Straddle regression**: the pre-rollout straddle fixture class (F2) reconciles — no permanent
   FAILED on pre-2025 option history (unblocks live keys #2/#3 with pre-rollout history).
4. **Zav2 / Alpha Centauri** (`3ca43b1f`): recompute green end-to-end (identity + §5 + finite sane
   dailies); no fail-loud fires — if one fires, STOP and investigate (never loosen).
5. **Perp-only keys byte-identical** (SC-4 live): factsheets unchanged pre/post; zero option-marks
   requests in their run logs; P72 harness green on all keys.
6. Full CI green: pytest (incl. UNMODIFIED SC-4 suite + AST purity), vitest untouched,
   `mypy --strict` 0, coverage thresholds hold.

---

## 6. Risks / unknowns (for the plan-checker — scrutinize these)

- **Total preservation on a NON-flat terminal book** (⭐ the one to scrutinize): the telescoped
  total is `Σchange + Book(last settlement)`, and §5 closure rests on the decomposition
  `equity − combined_session_upl == cash + options_value − options_session_upl` — probe-consistent
  but NOT verifiable at Phoenix's flat terminal (`session_upl == 0`, `options_value == 0`). The
  Task-8(ii) synthetic fixture encodes the claimed algebra; the FIRST live open-book anchor is the
  real test — a §5 or book-channel breach there is a loud stop (never a tolerance loosening). Same
  follow-up class as Phase-82's wedge (§6), now with two coupled reads.
- **08:00-bar vs midnight-grid skew**: per-day attribution can shift by up to one session's mark
  move between adjacent days (trades between 08:00 and midnight are booked to day D while the
  mark basis rolls at 08:00). Bounded, sign-alternating, total-exact; same one-day-basis class the
  perp-close fill already ships. If a reviewer proposes re-bucketing rows to the 08:00 grid
  instead: that forks `_row_utc_day` platform semantics — REJECTED here, revisit only as its own
  phase.
- **Fetch fan-out**: one public request per held instrument, ever. An intraday options day-trader
  (Zav2) can hold hundreds–thousands of distinct instruments lifetime → minutes of paced public
  reads per full recompute. Mitigations in-phase: expiry-capped spans, per-job memoization,
  existing pacing/retry discipline. Persistent caching (results are immutable) is a named follow-up
  knob, not built now — flag if Zav2's recompute time is operationally painful.
- **`position`-field trust**: the replay leans entirely on the signed post-trade `position`
  (verified live: shorts negative, deliveries zero). Cross-scope safety is settled (single-scope:
  key = its own subaccount). The book-channel anchor cross-check (Q3-2) is the independent backstop
  — a replay drift surfaces as a book-channel breach, never a silent wrong MTM.
- **Mark-basis residual**: 1D-bar close vs Deribit's own settlement mark price may differ by
  microstructure dust; absorbed by the guard tolerance. If it ever exceeds
  `max($1-equiv, 1e-4·throughput)` on a real account → investigate the bar source, don't widen.
- **Pre-retention fallback ships cold**: neither live key exercises Q4's cash-basis branch; it
  lands tested (fixtures) but unproven live. The warning key keeps it honest.
- **Deleted Phase-82 tests**: Task 4 removes tests WITH the code they pin — the commit must
  enumerate each deletion and name its superseding test (fail-loud discipline applies to the test
  suite itself).
- **Task 10 is BLOCKED** on re-onboarding Phoenix (key deleted from the test DB) — the code tasks
  (0–9) are NOT blocked; ship gates are the fixture suites, live acceptance follows re-onboard.

---

## 7. Execution order & gating summary

```
0 (evidence record — encode the probe, no live run)
  → 1 (marks fetch, TDD)  → 2 (position replay, TDD)  → 3 (ΔMTM core, TDD)
  → 4 (aggregator rework: full change back, summary inert — WITH test deletions enumerated)
  → 5 (adapter merge + pre-retention flag + exemption-plumbing removal)
  → 6 (identity guard rework: strict cash + anchor book + summary cross-check; straddle inverted)
  → 7 (SC-4 pins)  → 8 (E2E incl. non-flat terminal)  → 9 (docs/pins + version bump)
→ ship gates: full pytest + SC-4 suite + AST purity + mypy --strict 0
  → 10 (live acceptance — BLOCKED on Phoenix re-onboard; Zav2 secondary; perp-only byte-identity)
```
Tasks 4–6 land as ONE reviewable unit if intermediate states cannot keep the suite green (removing
the exemption before restoring full change false-fires the strict guard — Task 6's
`test_cash_identity_strict_on_open_book` documents the coupling); otherwise each task lands with
its failing-first test. If the executor hits evidence contradicting §1/§2 (e.g. a marks hole inside
listed life on a real instrument, or the book-channel guard fires on the probe account), that is a
STOP-and-report, not a license to redesign inline.
