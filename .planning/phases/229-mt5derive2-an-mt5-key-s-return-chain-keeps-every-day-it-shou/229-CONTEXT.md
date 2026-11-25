# Phase 229: MT5DERIVE2 — an MT5 key's return chain keeps every day it should, and a key with no writer basis never composes silently - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning (founder rulings recorded 2026-11-24)

<domain>
## Phase Boundary

Seam S1 money-math gaps in the derive writer, fixed at their root, which moves published MT5 returns:
- `services/nav_twr.py` `_judged_cohorts`: a timed re-funding day into an emptied account (empty cohort 0) keeps the return chain (MT5D-04, `[164.6.6.2.3-EMPTY-COHORT0-REFUND]`).
- `services/nav_twr.py` `chain_linked_twr`: an inception day's P&L is booked or flagged by name, never dropped as NaN silently (MT5D-05, `[164.6.6.2.3-INCEPTION-DAY0-PNL]`).
- `services/nav_twr.py` `FLOW_TIMING_LARGE_RATIO`: the D-15 band is either annotated or recorded as accepted, by founder ruling (MT5D-06, `[164.6.6.2.3-D15-THRESHOLD-BAND]`).
- `services/job_worker.py` `_native_key_usd_writer_basis` and its store gate: a timed MT5 key with no writer basis is counted or blocked with a named signal (MT5D-07, `[164.6.6.2.3-MT5-BASIS-SILENT-NONE]`).
- `services/allocator_equity_derive.py` `read_writer_basis` and the writer-basis gate in `replay_key_equity`: per-day values compared as well as the calendar; a same-day re-derive pair whose P&L does not match is refused (HOLD-03, `167.1.2.2.1-WRITER-BASIS-VALUES`).

Out of scope (ROADMAP Phase 230 owns them): the 175 nightly second-attempt cause, `202-MT5-CLOCK-LEAD-01` replay, attempt history. No migration expected.

</domain>

<decisions>
## Implementation Decisions

### D-15 band (MT5D-06)
- RULED (founder 2026-11-24, AskUserQuestion): "Keep 1.0, accept band (Recommended)". The D-15 band is ACCEPTED: `FLOW_TIMING_LARGE_RATIO` stays 1.0, no code change to the ratio, and the factsheet copy is unchanged. This acceptance with its reason closes MT5D-06 and `[164.6.6.2.3-D15-THRESHOLD-BAND]` (ROADMAP SC-3 second arm). Reason: the root fix for a day-level venue is intraday timing (`[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]`), not a broader note, and a lower ratio had no measured fleet rationale. — **Reversibility:** costly — lowering it later changes the factsheet copy and the payload cache version. Lineage of the question: asked 2026-11-24 through the orchestrator (ROADMAP: "a founder ruling at plan time, and `FLOW_TIMING_LARGE_RATIO` is never widened to make a check pass"). Facts put to the founder: the flag is an annotation only (no published number, status or golden/spine fixture moves on it); it drives the factsheet copy "Some days carried a deposit or withdrawal at least as large as the balance before it, with no time of day, so their returns can be extreme." (`src/app/factsheet/[id]/v2/FactsheetView.tsx`), so any lower ratio also changes that copy (DESIGN.md check) and the payload cache version. Recommendation given: accept the band as recorded, keeping 1.0, because the root fix for a day-level venue is intraday timing (`[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]`), not a broader note, and a lower ratio has no measured fleet rationale yet.

### Timed MT5 key with no writer basis (MT5D-07)
- RULED (founder 2026-11-24, AskUserQuestion): "Block it (Recommended)". A timed MT5 key with no writer basis raises the blocking `key_inputs_mismatch`, like the holed-key precedent, with a log line carrying counts only that names the branch that returned no basis. — **Reversibility:** costly — changes what an allocator book shows for such a key. Lineage: measured on PROD 2026-11-24 (marker query first): all 11 MT5 `key_inputs` rows (9 USD, 2 native-unit) carry a writer basis today, so either answer moves no live key now. Recommendation given: block as the holed-key case already does (the compose raises the blocking `key_inputs_mismatch`), with a counts-only log naming the branch that returned no basis; it self-heals on the next derive once the missing close lands (PITFALLS 14: a transient miss must not read as proof, so the block names the cause rather than deleting anything). ⭐ SCOPE NOTE 2026-11-24 (founder ruling on review MR-01 / SFH-229-01, relayed by the coordinator): "Exempt departed keys". Live keys still block. A departed key whose last `key_inputs` row carries `writer_basis_withheld` or a stale returns stamp stays out of `withheld_by_key` and `stamp_mismatch_days_by_key`; it is counted into a non-blocking benign flag with a counts-only log, in the spirit of D-22, because a departed key never re-derives and the block could never self-heal.

### Decided autonomously
- [Empty cohort 0] Q: "Which cohort-0 rule closes MT5D-04?" → Selected: "An empty cohort 0 (no P&L) is skipped whenever a later cohort on the same timed day is judged, on every day, not only inception; a cohort 0 with P&L is always judged; a day with no judged cohort keeps today's behaviour. Phase 188's tiny-base rule keeps precedence: it is still judged on the day's starting NAV after the cohort guards (188 D-02/D-03, T-A1), so a re-fund into an account left on a positive sliver under 5% of its 30-day peak stays left out by founder decision; a re-fund from zero or below (188 D-05 keeps those out of the tiny rule) or from a dust level that is not tiny is now measured" — the TODOS entry's own done-when, bounded by the later founder rule. Probed 2026-11-24 on today's code: prev 0 and -0.5 drop as negative_nav_guard, prev 5 as dust_nav_guard, prev 150 and 400 (peak 10,100) as tiny_base_guard.
- [Inception day-0 P&L] Q: "Book or flag?" → Selected: "Flag by name: a day-0 that carries P&L and is skipped as the inception day with no DayTiming is counted under a named annotation key (count of days), not a status-promoting warning, matching D-12's 'no return, no warning' for the deposit-only case" — with no timing the day has no base to book a return against (pre-history capital is zero), so a flag is the only honest outcome; the annotation-vs-warning class is a one-line change.
- [Writer-basis values] Q: "What does the HOLD-03 check guarantee?" → Selected: "The invariant only: a `key_inputs` row and a returns set from two different derives that share the calendar are refused as the blocking `key_inputs_mismatch`, and a healthy pair is never refused, including a timed MT5 flow day (its stored return is a product of cohort returns and cannot be inverted, see the `segment terminals withheld` comment in job_worker.py) and a guard-NaN day (P&L with no return). The comparison itself (a per-day value cross-check on the days where it is exact, a shared derive stamp on both rows, or both) is chosen by research with a stated tolerance" — the 2026-10-10 TODOS formula `abs(r[d] * L - w_pnl[d]) <= tol` predates FLOWTIMING and would falsely refuse timed days, so it is not pinned here.
- [Writer-basis values, where] Q: "Where does the HOLD-03 check run?" → Selected: "Each derive writes a per-day returns_stamp (the rows it wrote) into its key_inputs jsonb; the compose compares it per raw key in its read loop before stitch_shared_account and refuses a differing pair as the blocking key_inputs_mismatch; a row with no stamp (written before this change) is counted at info level, not refused; read_writer_basis stays byte-unchanged" — decided 2026-11-24 at planning from RESEARCH Open Question 5: editing read_writer_basis fires the open entry 167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY, and a check after the stitch would read the stitched series, not the key own returns; ROADMAP SC-4 outcome (a mismatched same-terminal pair is refused by name, a healthy pair never) is kept, its location differs from the SC wording.
- [Proof] Q: "How is each gate proved?" → Selected: "PROOF-01 per ROADMAP SC-5: RED on pre-fix code or a neutered copy with its named arm first, restored by `cp` from a byte backup and `cmp`, GREEN, recorded verbatim in the plan SUMMARY; money-math oracles import no production helper; the frozen spine is never re-baselined by `regen_golden.py`" — ROADMAP-mandated.
- [Soak] Q: "How is 226's soak recorded?" → Selected: "Run `analytics-service/scripts/mt5_soak.py` against the changed derive before ship and record its verbatim verdict in the phase records beside the merge" — ROADMAP SC-5.

### Claude's Discretion
- Plan split, test file placement, the exact annotation key names and the HOLD-03 tolerance value, provided they are stated and pinned.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `nav_twr._judged_cohorts` / `_timed_day_return` (telescoping base, D-17) and `chain_linked_twr` (inception predicate, D-07/D-12/D-15 annotations).
- `nav_twr.level_day_pnl`, `_flows_to_daily_usd` (writer basis builder).
- The holed-key precedent in `job_worker.py` (search `segment terminals withheld`): withholds terminals so the compose raises blocking `key_inputs_mismatch`, with a counts-only warning.
- `allocator_equity_derive.read_writer_basis` / `_read_basis_rows`, `KEY_INPUTS_MISMATCH`.
- `analytics-service/scripts/mt5_soak.py` (Phase 226, independent oracle).

### Established Patterns
- Annotations (not in `NAV_TWR_GUARD_KEYS`) never promote status; guards NaN-break and flag.
- Logs carry counts only, never amounts (T-73-02, T-164.6.6.2.3-16).
- Every analytics change passes CI mypy strict; pytest only from `analytics-service/`.

### Integration Points
- `_native_key_usd` call of `_native_key_usd_writer_basis` (job_worker) and the `_composed_day_pnl_usd` store path.
- The compose's writer-basis gate in `replay_key_equity`.

</code_context>

<specifics>
## Specific Ideas

- 155.2 freeze: merge before 155.2 plan 12's recapture or after plan 14 (ROADMAP Depends on). Checked 2026-11-24: `155.2-12-SUMMARY.md` absent on origin/main.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>
