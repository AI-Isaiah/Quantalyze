---
phase: 226-mt5soak-the-mt5-soak-checks-what-it-claims-independently-of
reviewed: 2026-11-23T22:31:41Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - analytics-service/scripts/mt5_soak.py
  - analytics-service/tests/test_mt5_soak.py
findings:
  critical: 1
  warning: 2
  info: 11
  total: 14
  necessity: 0
status: issues_found
---

# Phase 226: Code Review Report (round 3, final)

**Reviewed:** 2026-11-23T22:31:41Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found
**Head:** `1b5453bde` (fix range `f7755ed10..1b5453bde`, phase range `4f0e9edc1..1b5453bde`)

## Summary

Round 3 re-checks round 2's two open findings, hunts the fix diff (`mt5_soak.py` +139/-30,
`test_mt5_soak.py` +508) for new defects, and re-probes the phase. The test file passes:
**147 passed**. Every probe below ran against a scratch copy of `analytics-service/`. The
worktree was never edited.

**CR-03 and WR-03 are resolved as specified.**
- **CR-03, the four rows with no checked day.** Each now reads `vacuous=True` and `ok=False`,
  and `main()` exits 1.
- **CR-03, the fifth row** (5 guarded + 1 real P&L day + 5 open-only days). It reads
  `checked 1 / guarded 5 / flow_only 6`, share 1/6 and exit 1. It has a checked day, so it is
  not vacuous; it is simply not green.
- **WR-03, probes.** The $100 probe has 0 mismatches (197 green of 300). The drain probe is
  green on all 300.
- **WR-03, honest fuzz.** 2,008 ledgers over seeds 7 and 11 gave **zero** mismatches. Green
  went from 1,371 to 1,379 on seed 7 and to 567 on seed 11.
- **Mutation.** 17 of 18 mutants of the fix lines were killed (table below).

**But the fix range opened one HIGH and left two MEDIUM.**
- **CR-04 (HIGH):** an `indeterminate` day is certified by nothing, yet it also leaves the
  share's denominator. So knife-edge days lift a run to green just as flow-only days did
  before CR-01. Two ledgers reach it:
  - On a zero base the band catches days whose guard reads NaN on both sides of the edge,
    which round 2 counted as guarded.
  - On a dust-floor base the days are genuinely indeterminate.

  Both repros certify 1 of 11 trading days and exit 0. The band's design came from round 2's
  prescription, so that miss is the review's, not the fixer's.
- **WR-04 (MEDIUM):** no test pins the band's width. With `_LEVEL_NOISE_REL` widened from
  1e-12 to 1e-5, all 147 tests pass, and at that width a finite return on a base genuinely
  under dust is accepted.
- **WR-05 (MEDIUM):** the CR-03 criterion `pnl != 0.0` was also round 2's prescription. It
  still certifies a day whose deals net to float residue. One breakeven close
  (0.30 / -0.10 / -0.20) leaves -2.8e-17, and such a run exits 0.

**Answers to the three questions in the brief.**
- **(a) Can the band pass a finite wrong value on a near-threshold day?** No, not at the
  shipped width. It accepts only NaN, the strict walk value, or the lowered-floor walk value,
  each to 1e-9. Mutants Mn and Mo (accept anything) are killed. The width itself is unpinned
  (WR-04).
- **(b) Can indeterminate days carry a run to green?** **Yes** (CR-04).
- **(c) Does `_walk_cohorts` keep the D-17 rule and the independence rule?** Yes on both.
  - **D-17.** Its predicate `not ((k > 0 or inception) and pnl == 0.0)` is the old `continue`
    condition negated, with telescoping unchanged. Mutants Mq (no inception skip) and Mr (no
    telescoping) are killed.
  - **Independence.** It falls under the `_walk_` prefix scan, so the checker sees it, and
    the checker passes.

**Scope read this round.**
- **Script:** the fix diff in full; `_walk_day_guard`, `_walk_cohorts`, `_walk_timed_return`
  and `_walk_tiny_base_days`; all of `_reconcile_published_returns` (`:747-1021`); and the
  attribution check.
- **Tests:** every test added in the fix range (`:1966-2475`) and the independence checker
  (`:1172-1277`).
- **Necessity:** I read the rubric. No finding meets its evidence rule. CR-04 is a
  correctness defect, not a guard that defends against nothing.

Project tiers: CR = HIGH, WR = MEDIUM, IN = LOW.

## Dispositions (all rounds)

| ID | Tier | Disposition | Evidence (round 3) |
|---|---|---|---|
| CR-01 | HIGH | **Resolved** | Flow-only days stay outside the share, and the CR-03 change extends that to zero-P&L trading days. The round-1 repros stay not green. The same class of hole comes back through `indeterminate` days, which is CR-04. |
| CR-02 | HIGH | **Resolved** | Coverage code is unchanged in the fix range. Its pins pass. Fuzz: zero `ledger_day_not_published` and zero `published_day_outside_ledger`. |
| CR-03 | HIGH | **Resolved as specified.** The criterion's residual is WR-05 | The four rows with no checked day read `vacuous=True` and exit 1. Row 5 reads share 1/6 and exit 1. The untimed (Ma) and timed (Mb) `has_trade` reverts are both killed. |
| WR-01 | MEDIUM | **Resolved** | Survives the `_walk_cohorts` refactor: Mq and Mr are killed, and the hand-derived cohort cases pass. |
| WR-02 | MEDIUM | **Resolved** | The independence test passes, and the prefix scan covers `_walk_cohorts`. Naming it in the minimum set is LOW (IN-11). |
| WR-03 | MEDIUM | **Resolved as specified.** The band introduced CR-04, and its width is unpinned (WR-04) | $100 probe: 0 mismatches. Drain probe: 300 of 300 green. Fuzz over 2,008 ledgers: 0 mismatches. 13 band mutants killed (Mc to Mk, Mm to Mp). |
| SFH-01 | MEDIUM | **Resolved** (duplicate of CR-02) | Pins pass. |
| SFH-02 | MEDIUM | **Resolved** | Pins pass; the wedge code is unchanged in the fix range. |
| SFH-03 | MEDIUM | **Resolved** | Pins pass. The fix range reworked the timed branch around the not-walked path; `timed_day_not_walked` still counts and fires. The inception cohort-0 skip now also feeds the band; `test_a_healthy_inception_day_is_not_indeterminate` pins it. |
| SFH-04 | MEDIUM | **Resolved** | Pins pass; the attribution code is unchanged in the fix range. |
| IN-01..IN-09 | LOW | Open, unchanged | Carried under Info. |

**Mutation run, 18 mutants of the fix lines** (each run on a scratch copy and restored
byte-exact afterwards):

| Killed | Mutants |
|---|---|
| Yes (17) | Ma, Mb (CR-03 reverts) · Mc, Md, Me (each band off) · Mf, Mg (measured value at the strict floor) · Mh, Mi (`_near` without the zero edge / without the dust edge) · Mj, Mk (tiny day given a measured value) · Mm (band covers inception) · Mn, Mo (band accepts any value) · Mp (noise from `initial` only) · Mq, Mr (D-17) |
| **No (1)** | **Ml: `_LEVEL_NOISE_REL = 1e-5` survives, 147 passed (WR-04)** |

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-04 [HIGH]: Indeterminate days certify nothing yet leave the share's denominator, so a run that certified 1 of 11 trading days exits 0

**File:** `analytics-service/scripts/mt5_soak.py:1003` (`denominator = checked + timed + guarded`), with the days counted at `:903` (timed) and `:955` (untimed); the band entry is `_near` at `:847-848`, used at `:891` and `:947`

**Issue.** The WR-03 band turns knife-edge days into `indeterminate` days. That is right for
the mismatch verdict, but those days are then dropped from the share's denominator.
`_MIN_CHECKED_SHARE` exists to keep "a run that certified too little" from going green. CR-01
closed that hole for flow-only days, and the band reopens it for every day it catches. Two
ledger shapes reach it.

**(1) Zero base: days the guard always breaks, now caught by the band.** `_walk_day_guard`
(`:580`) is `base <= 0 or base < dust_nav`. The dust floor is many orders above the noise
(100 USD against about 1e-9), so a base within noise of zero reads `base_guard` on **both**
sides of zero. The soak, production and `measured` all read NaN. On a day that trades, zero is
no edge.
- Zero decides an outcome only through the tiny-base reading (`0 < base`), and that changes a
  published value only on flat days, which have their own band (`:924-928`).
- `_near`'s zero arm catches these days anyway. Round 2 counted them `timed` or `guarded`.
- These day shapes put a judged base at zero:
  - the re-deposit day after a full withdrawal (a non-inception day judges its cohort 0 even
    when it is empty);
  - a trade opened before the inception deposit;
  - every day of an account funded each morning and swept to zero each evening.

**(2) Dust-floor base: genuinely indeterminate days.** In the same sweep, if each evening
leaves exactly 100.0, every day opens on the USD dust floor, and its reading truly depends on
which way the residue falls. Round 2 happened to verify those days. The band rightly stops
certifying them, but it also stops counting them.

**Repro (the test file's helpers).** Every row has 0 mismatches.
- **Ledger:**
  - Day 1: a deposit.
  - Day 2: +50, the one checked day.
  - Day 3: a withdrawal down to the evening level, either 0 or 100.
  - N sweep days, each: deposit 1,000 at 08:00, open at 09:00, close at 15:00 for `+p`, then
    withdraw `1,000 + p` at 20:00.
  - Last: a final deposit of 1,000.
- **Variants:** the zero-base variant deposits 10,000 on day 1; the dust-floor variant
  deposits 1,000.

| ledger, N | `f7755ed10` (round 2) | HEAD `1b5453bde` |
|---|---|---|
| zero base, N=5 | timed 5, share 0.17, **exit 1** | indeterminate 6, share **1.0**, **exit 0** |
| zero base, N=10 | timed 10, share 0.09, **exit 1** | indeterminate 11, share **1.0**, **exit 0** |
| dust base, N=10 | timed_verified 10, share 1.0, exit 0 (honestly verified) | indeterminate 11, share **1.0**, **exit 0** with **1** day certified |

**The fuzz shows the same reclassification.**
- Seed-7 run 40 is a trade opened before its inception deposit, with a cohort-0 base of
  -1.1e-13. It moved from `timed 1` at share 0.5 to `indeterminate 1` at share 1.0.
- Measured against the narrowed band below, HEAD's share is **higher** in 285 of the 2,008
  fuzz runs (206 on seed 7, 79 on seed 11), and 275 of those read exactly 1.0.
- None crossed the floor on that ledger mix, because the random ledgers rarely string
  together several such days. The sweep repro shows they can cross it.

**Fix (minimal, one line).** Count indeterminate days the way guarded days are counted: in
the denominator, never in the numerator.
```python
denominator = counts["checked"] + counts["timed"] + counts["guarded"] + counts["indeterminate"]
```
Update the docstrings at `:798-809` and `:817-819`, which say indeterminate days sit outside
the denominator.

**Run in a scratch copy:**

| check | result |
|---|---|
| zero-base sweep | N=5 share 0.14, N=10 share 0.08, both exit 1 |
| dust-base sweep | N=5 share 0.14, N=10 share 0.08, both exit 1 |
| CR-03 repros | still not green, exit 1 |
| $100 probe | 196 green, 0 mismatches |
| drain probe | 300 of 300 green |
| fuzz, both seeds (2,008 ledgers) | 0 mismatches; green 1,379 and 566 |
| test file | 146 of 147 pass |

- **Fuzz cost.** The one run that left green is seed-11 run 329. Its share moves from 0.5 to
  0.46, and it was red at round 2 too.
- **Test-file failure.** It is `test_a_100_dollar_minimum_deposit_account_is_not_false_red`'s
  `certified_share == 1.0` pin, which becomes 5/6 because its knife-edge first day now counts
  against the share. Update the pin. `mismatch_count == 0` and `parity_ok` still hold.

**Optional (accurate classification, not needed for the verdict).** Enter the band only when
the edge can flip the reading: the walk read just under and just over the dust floor must
disagree. Then a zero-base day goes back to `timed`/`guarded`/`flow_only` and is no longer
`indeterminate`. Leave the flat branch unchanged.
```python
# timed branch, replacing `if any(_near(b) for b, _ in cohorts):` and its `measured`:
lo = _walk_timed_return(base, day_timing, dust_nav=floors.dust_nav - 2 * noise, inception=inception)[0]
hi = _walk_timed_return(base, day_timing, dust_nav=floors.dust_nav + 2 * noise, inception=inception)[0]
if day not in tiny and math.isnan(lo) != math.isnan(hi):
    measured = lo
    ...  # accept NaN, `value` or `measured` exactly as now
# untimed branch, replacing `if not inception and _near(base):` and its `measured`:
if not inception and day not in tiny and (
    _walk_day_guard(base, pnl, dust_nav=floors.dust_nav - 2 * noise) is None
) != (_walk_day_guard(base, pnl, dust_nav=floors.dust_nav + 2 * noise) is None):
    measured = pnl / base
    ...  # accept NaN or `measured` exactly as now
```
- **Run on its own:** the zero-base sweep goes red, but the dust-base sweep stays green at
  share 1.0. So this change does **not** replace the denominator line.
- **Run together with the denominator line and WR-05's fix:**
  - all three repros go red;
  - the fuzz has 0 mismatches, with green at 1,379 and 566;
  - the $100 probe has 196 green and the drain probe 300.
  - In the test file, 144 of 147 pass. The failures are the $100 share pin and the drain
    parametrization's `indeterminate == 1` (it becomes 0, because its re-deposit day is a
    flow on a zero base and correctly goes back to `flow_only`).

**Regression tests.** Pin both sweep fixtures at N=5: share under the floor, `parity_ok is not
True`, and `main()` exit != 0.

## Warnings

### WR-04 [MEDIUM]: The band's width is unpinned. Widening it 10^7-fold passes every test and accepts a finite return on a base under dust

**File:** `analytics-service/scripts/mt5_soak.py:259` (`_LEVEL_NOISE_REL = 1e-12`); `analytics-service/tests/test_mt5_soak.py:2392-2408`

**Issue.** The band is safe only because it is narrow. Mutant Ml (`_LEVEL_NOISE_REL = 1e-5`)
survives the whole file, 147 passed.

The one test that claims to bound the width uses a BTC base of 5e-8 on an account whose
largest level is about 1e-7. At that scale even 1e-5 gives a noise of 1e-12, so the test
cannot see a widening.

**Measured with a direct call:**
- The account drops from 1,000 to 99.995, half a cent under the USD dust floor. The base is
  not tiny, since 5% of 1,000 is 50.
- The next day books +1.0, and the series publishes `1.0 / 99.995`.

| width | result |
|---|---|
| 1e-12 (shipped) | refused, `guarded_day_not_nan` |
| 1e-5 (mutant) | `indeterminate 1`, **0 mismatches**: the missing dust guard is accepted |

The probe tells the two widths apart on HEAD and on the CR-04-fixed copy alike.

There is also no ceiling relative to the floor. `noise` scales with the account's largest
level, and the band is only safe while `noise` is much smaller than `dust_nav`.

**Fix.**
1. Add the 99.995 fixture above as a test. It must read `indeterminate == 0` and
   `guarded_day_not_nan`.
2. Pin the constant the way the other walk constants are pinned:
   `assert _soak._LEVEL_NOISE_REL == 1e-12`.

A cap relative to `dust_nav` is a possible extra, but it was **not run**. Any cap must stay
above real float residue on large BTC accounts, or it brings back WR-03's false REDs.

### WR-05 [MEDIUM]: `pnl != 0.0` certifies a day whose deals net to float residue, so a run with no measurable P&L day still exits 0 (CR-03 residual)

**File:** `analytics-service/scripts/mt5_soak.py:941` (untimed `has_trade = pnl != 0.0`) and `:884` (timed `any(pnl != 0.0 ...)`)

**Issue.** CR-03's rule is that a day certifies only when its P&L can test a base. `!= 0.0` is
not that test: cent amounts that net to zero can leave a float residue.
- A breakeven-after-costs close, where profit equals commission plus swap, is a natural MT5
  shape. Through `_walk_deal_ledger`:
  - one close of profit 0.30, commission -0.10 and swap -0.20 books **-2.78e-17**;
  - one close of 0.70 / -0.35 / -0.35 books exactly 0.0.

  Which one a day gets depends only on the decimals.
- Such a day counts `checked`, yet its expected return is about 1e-21. Any published value
  within 1e-9 passes, whatever base the combiner used.
- The 1e-9 floor also gives a more general version: a cent of P&L on an account of $10M or
  more tests no base either.

**Repro.**
- **Ledger:**
  - Deposit 10,000.
  - +150,000 the next day: P&L-dominated, so guarded.
  - On the third day, three closes: +0.1, +0.2 and -0.3.
- **Result:** `checked 1 / guarded 1`, share 0.5, `vacuous False`, `parity_ok True`, and
  **`main()` exits 0**. As with CR-03, every day whose P&L can test a base was guarded.

The rule came from round 2's own CR-03 prescription. The miss is the review's, not the
fixer's.

**Fix.** Certify on a measurable expected return, per cohort on timed days:
```python
# untimed
has_trade = abs(pnl) > _RETURN_CHECK_TOL * max(abs(base), floors.dust_nav)
# timed
has_trade = any(abs(p) > _RETURN_CHECK_TOL * max(abs(b), floors.dust_nav) for b, p in cohorts)
```
Run in a scratch copy, together with the CR-04 changes:
- The repro reads `vacuous True` and exits 1.
- The sweep, $100 and drain probes are unchanged.
- The fuzz has 0 mismatches, with green unchanged at 1,379 and 566.
- The test file adds no failure beyond those listed under CR-04.

Add the repro, and the single 0.30 / -0.10 / -0.20 close, as regression tests:
`vacuous is True`, not green, no exit 0.

## Info

These are recorded here only. Under the project rule, LOW and Info findings are not booked in
`TODOS.md`.

### IN-10 [LOW]: Two knife edges outside the band still false-RED, on engineered shapes

**File:** `analytics-service/scripts/mt5_soak.py:672` (tiny: `base < 0.05 * peak`) and `:582` (`abs(pnl) >= 10 * base`)
- **Tiny edge.** A withdrawal that leaves exactly 5% of the peak (base 200.0 on a 4,000 peak)
  false-REDs 10 of 400 probes, as `guarded_day_not_nan` and `checked_day_not_finite`.
- **P&L-dominance edge.** A P&L of exactly 10x the base false-REDs 11 of 400. The soak's base
  is `200.0000000000005`, so it expects `9.999999999999977`, while production reads
  P&L-dominated.
- **Impact.** Both are fail-closed. Round 2 wrote "no second root cause", which holds for the
  random fuzz only.
- **Fix:** if either shape shows up live, apply the "readings disagree" test from CR-04's
  optional fix to these two comparisons.

### IN-11 [LOW]: `_walk_cohorts` is missing from the independence test's named minimum walk set

**File:** `analytics-service/tests/test_mt5_soak.py:1232-1237`. The prefix scan covers it
today. If it were renamed without the `_walk_` prefix, it would leave the scan, and the
named-set assertion would not notice. **Fix:** add `"_walk_cohorts"` to the set.

### IN-07..IN-09 (round 2, carried, unchanged code)

- **IN-07:** coverage mismatches can fall outside the 10 listed (`:978-999`, `:1018`).
- **IN-08:** only the first out-of-span published day is named (`:988-999`).
- **IN-09:** the independence checker does not see `__import__` or `importlib`.

### IN-01..IN-06 (round 1, carried, unchanged code)

- **IN-01:** the zero-flow filter and the instant-day check have not been re-mutated.
- **IN-02:** the attribution check re-calls the fold instead of reading the fold the combiner
  consumed.
- **IN-03:** `_parity_tolerance` and `_reconcile_published_returns` default to
  `floors=USD_FLOORS`.
- **IN-04:** `timed_day_not_walked` is unreachable from `reconcile_parity` and is pinned by a
  direct call.
- **IN-05:** the soak buckets on the fixed offset, while production runs a DST clock.
- **IN-06:** the walk docstring at `:499` still says "calls no other soak helper", but
  `_walk_timed_return` now calls `_walk_cohorts` and `_walk_day_guard`.

---

_Reviewed: 2026-11-23T22:31:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
