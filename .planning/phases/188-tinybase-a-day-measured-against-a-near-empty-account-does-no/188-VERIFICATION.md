---
status: passed
verified_at_sha: 5abdaacfc6f67ed4a5889d8c6145c4f67af87f01
drift_subjects:
  - analytics-service/services/job_worker.py
  - analytics-service/services/tiny_base.py
  - analytics-service/services/nav_marks_apply.py
  - analytics-service/services/nav_twr.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/tests/test_tiny_base_reconcile.py
  - src/lib/scenario.ts
---

# Phase 188: TINYBASE Verification Report

**Phase Goal:** A day whose return is measured against a base that is a small fraction of the account's recent capital (after a near-total withdrawal) no longer reads as the strategy's performance on the book's equity curve and stats. The rule is decided with the founder, applies on every venue, and never invents a value.
**Verified:** 2026-11-06 at HEAD `5abdaacfc6f67ed4a5889d8c6145c4f67af87f01` (branch `feat/188-tinybase`)
**Status:** passed, with SC-4's residual carried as a founder-accepted deviation (D-13), not as an open gap
**Re-verification:** Yes, after gap-closure plans 188-12 to 188-16

## Result in one paragraph

The defect the phase owned is gone on PROD. The derive's reconcile delete now covers every day the derive states as left out, at both edges and in both modes; no scope stores a row on a stated day (24 in the pre-fix baseline, 0 after the nightly that followed the deploy); key C's 2026-10-27 and 2026-10-28 rows are absent; `key_inputs_mismatch` is gone from every book. SC-4's strict wording ("no other book's curve changed except on days the rule names") was NOT proven: the 188-16 reading ended `gc-verdict: NOT CONFIRMED`. The founder accepted that residual under D-13. This report records it as a deviation under that decision. It does not call it proven.

D-13 (founder 2026-11-06), quoted from `188-CONTEXT.md` and the ROADMAP: "close 188 on what passed; the rest moves to the next milestone. The SC-4 re-reading against the pre-merge baseline (188-16) read NOT CONFIRMED under its strict rule." And: "The founder first chose "Control capture first", then on the same day said "move the rest of 188 into the next milestone, and close it". So SC-4's residual goes to a follow-up phase booked in the next milestone: the unexplained value churn, measured by a control capture across a nightly with no deploy between, and b3's earlier reasons. 188 closes on the defect it owned."

## Code at HEAD (read, not taken from SUMMARYs)

`analytics-service/services/job_worker.py`, `tiny_base.py`, `nav_marks_apply.py`, `tests/test_tiny_base_reconcile.py` and `src/lib/scenario.ts` are byte-identical between this HEAD and the commit that merged the gap-closure PR to main (`git diff --quiet` against that merge commit, exit 0 for each). So the branch holds what shipped.

- `_tiny_base_days_stored` (job_worker.py:3828) is the one stated list of a run; `_reconcile_hull` (3861) returns the smallest and largest ISO day over the payload series' days and the stated days.
- Main path (10051-10058): `_span_named` is the stated list, widened by the marked era's first covered day and last mark day; `_span_start/_span_end = _reconcile_hull(returns index days, _span_named)`. The upsert runs first, the delete names `_calendar_days_absent_from(span)` in batches with the `gte`/`lte` bound and the per-axis `eq` scope (`api_key_id` in key mode, `strategy_id` otherwise). Ordering and scope are unchanged from before the fix.
- Under-two-days key branch (9732-9765): the stated days plus the marked-era hull are deleted; the one measured day is upserted first and kept (GC2-01), so a short key no longer keeps stale rows.

## Success criteria

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| SC-1 | The discuss step decides the rule with the founder and records it | VERIFIED | `188-CONTEXT.md` D-01 to D-09 record each founder answer; unchanged since the first verification. |
| SC-2 | The derive and the reader follow the rule on every venue | VERIFIED | Derive: one definition in `services/tiny_base.py`, used by `nav_twr.py`, `nav_marks_apply.py` and the combiners; the reconcile now removes rows an earlier derive left on stated days (gap 1). Reader and scenario: KL-5 (a strategy leg 0-filling a left-out day) is closed at HEAD. 188-14 drilled nine sites (S1, S2, E, A, C, P, Q, R, K) and each named test went RED when its one wiring line was removed (`kl5-verdict: closed-at-HEAD`); `computeCompositeCurve` has no production caller (`kl5-census`). I re-ran the scenario files at HEAD, one path at a time: `scenario.test.ts` plus `scenario.tiny-base.test.ts` 63 passed; `share-resolve.test.ts` 41; share `page.test.tsx` 28; `scenario-strategy-tiny-base.test.ts` 2; `ScenarioComparePanel.test.tsx` 11; `ScenarioComposer.test.tsx` 458; `queries.my-allocation.test.ts` 220; the `/returns` route test 48. All passed. The nine drills are 188-14's recorded readings; I did not repeat them. |
| SC-3 | Tests go RED on today's behaviour for the shape of key C's two days | VERIFIED | `tests/test_tiny_base_reconcile.py` (9 tests) seeds stored rows on stated days before the derive, which the earlier tests never did. My neuter drill: with the hull given no stated days (`[]` in place of `_span_named`) the module goes 7 failed, 2 passed, naming the key tail, key book-trustworthy, key and strategy leading edge, strategy tail, scope-guard and dust-last-mark arms; restored from a byte backup, `cmp` equal, worktree clean. Fresh-derive tests still pass: `test_tiny_base*.py` plus `test_nav_marks_composite.py`, 152 passed. |
| SC-4 | After deploy, PROD shows key C's two days handled by the rule, and no other book's curve changed except on named days | DEFECT GONE; RESIDUAL ACCEPTED UNDER D-13 | See "SC-4" below. |
| SC-5 | Never invent data: an uncomputable day is null | VERIFIED | A tiny day gets no row and no 0.0 (fresh-derive tests); on PROD the stale rows that served a +47% / -53% are gone (`gc-r-a: key=C 2026-10-27=absent 2026-10-28=absent`); KL-5 sites carry the days as left out, not as a flat 0%. |

### SC-4

Read on PROD on 2026-11-06 (188-16), after the 00:40Z nightly that derived all 9 eligible keys (`done` 9/9) and recomposed all 7 books after their keys, against the baseline taken before the fix shipped (188-12; freshness gate `fresh=yes`; merged and deployed, `descendant_of_merge=yes`). The marker query read PRODUCTION before and after the capture.

What the readings show, as recorded in `188-16-SUMMARY.md`:

- Defect gone: `gc-r-c: stored_on_stated_total=0 key_scopes_with_rows=0 strategy_scopes_with_rows=0`, from 24 in the baseline. `gc-r-a`: key C's two days absent. Every vanished row (50: 7 each on C, k1, k2 and 29 on s9) is a stated day; none vanished for another reason.
- Books: `key_inputs_mismatch` is gone from every book; b2 and b7 recovered to trustworthy (`recovered=yes`); b1, b4, b5, b6 stayed trustworthy.
- Stated days on the derive's own basis (D-11): keys C, k1, k2, k3, k4, k5, k8 all `explained=yes`, `only_stated=0`; the 3 recompute-only days on each of C, k1, k2, k4, k5 are left out by another guard (`listed_in_dropped_day_pnl, flow_day`). For C, k1, k2 the question why only 55 of the 755 emptied-stretch days are named stays `reason=not established` (`gc-r-b-why`). The 42 MT5 days of k6 and k7 are unchecked, as D-11 decided (`gc-r-mt5`).
- Not proven: `gc-r-diff-total: scopes=54 compared=15013 vanished_stated=50 vanished_hull=0 unexplained=1214` (changed values, none vanished, on 16 scopes, most with no stated day; median absolute change 4.0e-8, max 0.094). `gc-r-curve` reads `curve_rule=broken` on b1, b4, b5, b6 (max relative curve difference 6.09e-05, latest moved day 2026-10-25, no vanished stated day on them). Book b3 stays untrustworthy for `out_of_window_flow, window_truncated`, reasons it already carried in the baseline. `gc-verdict: NOT CONFIRMED`.
- The 188-16 author's reading of the fix's diff does not attribute the churn to the fix (it changes which days a derive deletes and states, not how a day's return is computed), but nothing in the reading measures the cause. I make no stronger claim either way.

Judgement: the defect SC-4 names (key C's two days, and every other stated day, still stored and served) is gone, which is what the phase owned. The literal clause "no other book's curve changed except on days the rule names" is not shown to hold, and the evidence does not say it fails because of this phase. Deviation: the founder accepted this under D-13 and moved the residual to a follow-up phase in the next milestone.

Note: `188-16-SUMMARY.md` ends with the founder's earlier "Control capture first" decision. D-13 (ROADMAP and CONTEXT) supersedes it the same day; the SUMMARY was not updated, and D-13 is the current decision.

## Previous verification (2026-11-05, `gaps_found`, 5 gaps) and how each closed

| # | Gap | Closed by | Status now |
|---|-----|-----------|------------|
| 1 | Reconcile delete bounded by the measured span: 24 stale rows on named days (keys C, k1, k2), including key C's two days | 188-13: `_reconcile_hull` and `_tiny_base_days_stored`; review rounds added the first-mark and dust-last-mark days (GC1-01), the under-two-days branch (GC1-02), and kept the one measured day (GC2-01); shipped, deployed, re-derived by the nightly | CLOSED: 24 to 0 on PROD; code read at HEAD |
| 2 | Three books `key_inputs_mismatch` (stale rows beside `dropped_day_pnl`) | Consequence of gap 1; no separate code change by decision (no new degrade reason) | CLOSED: gone from every book after recompose; b2 and b7 trustworthy |
| 3 | No test seeded a stored row on a stated day | 188-13 `test_tiny_base_reconcile.py`, RED against the pre-fix file, neuter drills | CLOSED: my neuter drill reproduces the RED (above) |
| 4 | 233 stated days not reproduced by the recompute (191 inside emptied stretches, 42 MT5 with no anchor) | D-11 (keep the naming, re-check on the derive's raw-sliver basis), 188-16 Task 3 | CLOSED as decided: all emptied-stretch keys explained; the 42 MT5 days stay unchecked by decision; "why only 55 of 755" stays not established |
| 5 | No pre-merge baseline for SC-4 | 188-12 took it before the fix shipped; 188-15 gated the merge on its freshness | CLOSED in process; the comparison it enabled returned NOT CONFIRMED, carried under D-13 |

## Verification commands run at HEAD

| Check | Result |
|-------|--------|
| `pytest tests/test_tiny_base_reconcile.py` (from `analytics-service/`) | 9 passed |
| `pytest tests/test_tiny_base*.py tests/test_nav_marks_composite.py` | 152 passed |
| Neuter of the hull's stated-days argument, then restore | 7 failed, 2 passed; restored byte-equal |
| CI's mypy line (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) | `Success: no issues found in 132 source files` |
| vitest, one file at a time, the scenario and tiny-base readers listed under SC-2 | all passed |

No PROD or shared TEST access by me; PROD figures are the recorded readings in the SUMMARYs.

## Open items (not gaps against 188)

- SC-4's residual (value churn on scopes outside the fix's path, four books' curves up to 6.1e-5 relative, b3's earlier reasons) is the follow-up D-13 names. At this HEAD the ROADMAP holds no such follow-up phase yet; booking it in the next milestone is still to be done through `/gsd-phase`.
- ROADMAP still shows `Plans: 10/16` and the plan 11 to 16 boxes unchecked; plan 11 (the failed substitute reading) is superseded by D-10 and the gap-closure plans. Bookkeeping for the close step.
- `188-REVIEW.md` WR-02 text still describes the earlier KL-5 state and was not rewritten; KL-5 is closed at HEAD per D-12 and 188-14.

## Human verification

None required.

---

_Verified: 2026-11-06_
_Verifier: Claude (gsd-verifier)_
