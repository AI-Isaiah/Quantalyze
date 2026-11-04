---
phase: 190-factsheetqueued
plan: 08
subsystem: post-deploy-verification
tags: [SC-5, SC-2, SC-3, SC-4, post-deploy, prod-reading, void, todos-booking]

requires:
  - phase: 190-factsheetqueued
    provides: plans 02 to 07 and 09 shipped (PR #1194, merge b588bbb14bf97491f914077293c1b96b4595468f)
provides:
  - the TODOS.md entry [190-RERUN-SURFACES-NOT-HOLDING]
  - 190-MEASUREMENT-postdeploy.sql, the saved read-only post-deploy reading
  - SC-5 readings: SC-2 VOID, SC-3 pre-derive and post-derive PASS, SC-4 VOID, 390 px not measured
affects: [190-VERIFICATION]

actuals:
  tasks: 4
  commits: 2

key-files:
  created:
    - .planning/phases/190-factsheetqueued-finishing-the-wizard-does-not-queue-a-redund/190-MEASUREMENT-postdeploy.sql
  modified:
    - TODOS.md

key-decisions:
  - "Founder 2026-11-03 (AskUserQuestion, 'Read it from real use later'): close 190 with the SC-2 finalize check recorded as VOID. The saved post-deploy query is re-run after the next real contribution and the result is added."
  - "The TODOS.md booking rides the records PR, not the ship PR: PR #1194 merged without it."

requirements-completed: [SC-3]
requirements-void: [SC-2, SC-4]

completed: 2026-11-04
status: complete-with-void-readings
---

# Phase 190 Plan 08: SC-5 post-deploy readings and the D-05 booking Summary

**SC-3 is confirmed on PROD for the whole re-run window, both before and after the derive hop's prestamp, with the figures and the updating line present on the owner lane at each capture. SC-2 and SC-4 could not be exercised: the controlled contribution run needs a pasted key and secret, which the session may not type, so both are recorded VOID by founder decision. SC-2's organic reading is VOID too, because no wizard finalize happened in the window. Nothing here is a pass for SC-2 or SC-4.**

## What changed

- `02c3bdbd8` docs(190): book 190-RERUN-SURFACES-NOT-HOLDING. One section appended to the end of `TODOS.md`, 8 insertions, 0 deletions.
- `0059e6971` docs(190): post-deploy SC-5 reading query. `190-MEASUREMENT-postdeploy.sql`: one read-only SELECT, one row, no id column.

## Task 1 - the D-05 booking (deviation recorded)

The plan had Task 1 ship in the phase's own PR. **PR #1194 merged without it**, so the entry rides the records PR instead. The CHANGELOG 0.133.19.0 entry names the out-of-scope surfaces only as known limits. The entry lists the six D-05 surfaces, `getStrategyDetailV2`, PUB-01 and the three detail reads plan 07 records as still withholding (`getPublicStrategyDetail`, `getFactsheetDetail`, `getStrategyDetail`), with an Owner / Trigger line. The plan's automated verify and the no-removed-lines diff check both passed. `TODOS.md` must never appear in any VERIFICATION's `drift_subjects`.

## Task 2 - ship gate (satisfied, ship not re-run)

| Check | Reading |
|---|---|
| PR #1194 merge commit | b588bbb14bf97491f914077293c1b96b4595468f, about 2026-11-03T21:43Z |
| Main CI on that commit | green (CI, Contracts) |
| Vercel Production deployment | `success` at 2026-11-03T21:46:23Z (only status on it) |
| Railway quantalyze-analytics | `success` at about 21:59:45Z to 21:59:49Z (two sources, a few seconds apart) |
| Railway quantalyze-analytics-backfill | `success` at 21:44:04Z (taken from the coordinator, not re-read) |
| Analytics `/health` | status ok, `config_ok` true, `git_sha` equal to the merge commit |

T_DEPLOY in the SQL file is 2026-11-03T21:59:49Z, the later of the two confirmed times (Railway analytics success).

## SC-5 organic reading

- Marker query, run first and alone from the main checkout: named PRODUCTION.
- Reading taken 2026-11-03T22:11:16Z with `190-MEASUREMENT-postdeploy.sql`.

| Column | Value |
|---|---|
| `finalize_jobs_after_deploy` | 0 |
| `finalize_jobs_after_deploy_after_first_compute_done` | 0 |
| `wizard_contributions_finalized_after_deploy` | 0 |
| `wizard_manager_submissions_after_deploy` | 0 |

**Verdict: VOID.** No wizard finalize happened after the deploy, so the zero in the SC-2 column proves nothing. There is no regression signal, and there is no pass.

## SC-5 controlled readings

Run in the founder's signed-in admin browser against PROD, with PROD reads bracketing each capture (marker first). The strategy was a single-key broker strategy, private, plain `complete`, with a top-level `cumulative_method` marker. Identifiers, figures and screenshots stay out of the repo.

### 4A - SC-2 and SC-4, controlled contribution run: VOID (not run)

The wizard has no reuse-existing-key path: it requires pasting a key and secret, and the session may not type credentials. The founder decided (AskUserQuestion 2026-11-03, "Read it from real use later") to close 190 with the finalize check recorded VOID. The post-deploy query is saved. It is re-run after the next real contribution, and the result is added. SC-4's PROD check (the KCS-09 line and no updating line on a new draft before its first computation) was part of 4A and is VOID with it. SC-4 stays covered by the unit and route tests only.

**Follow-up:** the founder's decision text says a TODO already tracks the re-run. At the phase branch's HEAD, `TODOS.md` carries no entry for it: the only phase-190 entry is `[190-RERUN-SURFACES-NOT-HOLDING]`, which covers surfaces, not this reading. Either an entry is needed, or the VERIFICATION carries it as a human-needed item. See "Left open".

### 4B - SC-3 across the whole re-run: PASS

**B1, pre-derive capture (first resync, pressed 22:13:45Z): valid, PASS.**

- The row went `computing` at 22:14:45Z.
- Bracketing reads at 22:15:02Z and 22:15:17Z both showed `computing`, top_marker `string`, snapshot null.
- Owner lane: the figures rendered, the FreshnessChip showed the last good date, the track record ran through the last computed day, and the line "Updating with the latest data. These figures are from the last completed computation." sat under the track-record line.
- Public lane: not applicable, the strategy is not published.

**First resync, B2 attempt: VOID (retry 1).** The prestamp window ran from 22:27:23Z (snapshot `object`, top_marker null) to completion at 22:27:41Z. The navigation capture landed about 22:28Z, after completion.

**After completion (first run): PASS.** Reload showed no updating line, the chip's date had moved, and the read showed `complete`, top_marker `string`, snapshot null (the success write dropped the key).

**B2, post-derive capture (second resync, pressed about 22:28:55Z): valid, PASS.**

- The row went `computing` at 22:29:56Z.
- The DB read at 22:40:47.196Z showed `computing`, snapshot `object`, top_marker null: the derive hop's prestamp had landed.
- The success write set `computed_at` to 22:40:54.617Z.
- The browser fetched the owner factsheet HTML about every 4 s. The fetch at 22:40:50Z to 22:40:51Z, inside the window, carried the `factsheet-analytics-updating` line and the figures. Fetches at rest before (22:28:58Z) and after (22:40:58Z) had no line.
- **Honest caveat on the bracket:** the "after" bound is the success write's `computed_at` (22:40:54.617Z), not a second read. The next read, at 22:40:54.70Z, already showed `complete`. The capture sits strictly between the two bounds, so it meets the plan's condition, but it is bracketed by one read and one write timestamp.

The post-derive page showed the figures and the updating line, not the placeholder, so plan 09's snapshot works on PROD through the window the phase exists for.

### 4C - 390 px overflow: NOT MEASURED

The browser window would not resize below the desktop viewport, and an iframe probe failed to load. The UI-SPEC overflow row (the updating line wraps inside the header, no sideways scroll) has no PROD reading. It is covered by the component test only.

## VERIFICATION hand-off

### Surfaces NOT yet holding during a re-run

D-05 (founder 2026-11-03) kept these out, their own terminal-success gates were not changed, and they are booked in `TODOS.md` as `[190-RERUN-SURFACES-NOT-HOLDING]` (booked in this plan's records PR, not in PR #1194):

- the share card image (`/api/og/factsheet/[id]`, og-metrics);
- the tear sheet and `tearsheet.pdf`, and the factsheet PDF route;
- the returns API (`/api/strategies/[id]/returns`);
- recommendations;
- portfolios with `StrategyBreakdownTable`, and the portfolio PDF;
- the scenario composer reads;
- the strategy page's own panels (`getStrategyDetailV2`, which keeps a terminal-status gate and live data-quality chips), plus the three detail reads plan 07 records as still withholding: `getPublicStrategyDetail`, `getFactsheetDetail`, `getStrategyDetail`;
- composite approval during a re-stitch (PUB-01, plan 06): still answers 409.

`TODOS.md` is never listed in the VERIFICATION's `drift_subjects`.

### RESEARCH Open Question 3

The unified manager single-key `onboard` re-run after the preview is unchanged (0 in the SC-1 window). The founder decides whether to book it.

### Premise correction (RESEARCH Open Question 5)

A re-compute never changes `strategies.status`. The "UNPUBLISHED" the founder saw is the owner-lane notice of a private contribution, present before the rename too. What changed was the factsheet body, which this phase fixes. The VERIFICATION must not claim a status flip was fixed.

### Known limits, per surface, for a single-key re-run's derive-to-success window

The window runs from the derive hop's prestamp, which replaces `data_quality_flags`, to the compute hop's success write. In it the row reads pending or computing for a user-initiated re-run of a plain `complete` row. The status bridge holds `complete_with_warnings` (and a row carrying computation_warned) through the derive hop, and holds `complete` through a ledger refresh's derive hop (`v_refresh_keep`). Both turn computing only at the compute hop's `_mark_computing`.

- **(a) A snapshot is bound to the row's computed_at** (plan 09's normal case).
  - The factsheet, on every lane through the resolve stage (public, owner, share link, discovery detail, the composite joint), shows the last success's figures and every flag from the snapshot. The MTM and smoothed toggles show the new derive's by-basis figures, series and gated reason together. The day basis follows the new derive's frozen conventions, read by `readCashConventions` from the derive-rewritten cash_settlement series row; they differ only when the day-basis setting changed in that run (plans 05 and 09). The updating line shows while the status reads pending or computing. A row held at a terminal-success status shows the same figures and flags with no updating line until `_mark_computing`.
  - The joint reads the snapshot's flags (plan 07).
  - The lists show the stored figures and `#n`, with the unit from the snapshot on every arm (plan 07). A pending or computing row leaves the percentile cohort, and a terminal-held row keeps its percentile.
  - /compare takes the chain-broken flag, the curve method and the covered-from date from the last-success aliases (plan 07).
  - The strategy page's own panels (outside D-05's reach) show today's not-computed panels while pending or computing. A terminal-held row shows its stored panels beside the new derive's live data-quality chips.
- **(b) No snapshot is bound.** Either plan 09 wrote the key as null (the row was a legacy row without the marker; a failed pre-read no longer yields a null key, because review fix `fec11b291` fails the derive on a failed last-success read, which plan 09's own SUMMARY predates), or another success raced the derive and left the snapshot unbound.
  - The factsheet and the joint withhold the row on every lane: a pending or computing row by the evidence rule, and a terminal-success row (`complete_with_warnings` or `complete`) by D-04 (plans 03 and 07). The body is today's placeholder, the owner lane shows the existing KCS-09 line for the jobs' state, and the probe answers not_computed (plan 05).
  - The public cached lane can keep serving an entry cached before the prestamp, for up to its 1 h TTL, because a terminal status and an unmoved computed_at keep the same key. That entry holds the last success's figures with its own flags.
  - The strategy page shows its stored panels and live chips beside a not-computed joint for a terminal-held row, and not-computed panels for a pending or computing one.
  - The lists blank a pending or computing row as today. A terminal-success row keeps its stored figures, `#n` and percentile, with the unit from its live alias, which differs only when the account's unit changed in that run. The lists do not apply D-04 (plan 07), because a scalar alias cannot see the null key and keying on the missing marker alias alone would blank every legacy row at rest.
  - /compare draws the row from its live aliases, as (f) describes.
  - The approval gate passes a terminal-success row as today and refuses a pending or computing one (plan 06).
  - A protected ledger refresh that fails or aborts after its prestamp restores the terminal status and keeps the prestamp flags. A row it leaves in this state stays withheld on the factsheet and the joint until its next success. A row it leaves with a bound snapshot stays in state (a).
- **(c) Deploy skew.** A derive that ran on code from before plan 09 writes no key. In its window a pending or computing row is withheld, because it has no marker. A terminal-success row is not detected by D-04, so every surface draws it from the new derive's flags beside the last success's figures until that chain's success. PROD analytics now serves the merge commit (`/health` `git_sha` confirmed), so this applies only to a chain whose derive ran before the deploy.
- **(d) The composite stitch's seconds-long csv_daily_returns window** (plan 05).
- **(e) Rows without the cumulative_method marker.** At rest, a legacy row computed before the marker existed carries no key, and every surface shows it as today, D-04 included. During a re-run, or after a csv_source-only failure write (which drops the snapshot too), such a row is in state (b). Plan 01's evidence coverage sizes them.
- **(f) /compare has no status gate and no placeholder, and this phase adds none.** A row whose flags are not proven to be a success's is drawn from its live flag aliases: the rows of (b), (c) and (e), with no top-level marker and no bound snapshot. In the window after the prestamp, such a row whose last success was chain-broken and whose new derive is clean is drawn as a whole curve beside its suffix headline. When the new derive is chain-broken, the prestamp carries no headline_since, so the row reads "cannot be dated" and draws no curve, which fails closed (plan 07).
- **(g) Surfaces outside D-05's reach show in every state what they show today.** The factsheet PDF route checks the status alone and then screenshots the factsheet page, so for a terminal-success row in state (b) it captures the placeholder.

### Readers of derive-rewritten series rows (audited at plan-check round 2; plan 07's SUMMARY carries the grep)

The cash-series covered-from reader no longer has a production caller after plan 07 (/compare takes the effective headline_since instead). Its JSDoc in `src/lib/factsheet/composite-read-path.ts` still names /compare as its caller, so it needs a follow-up cleanup. `readMtmSeries` and `readSmoothedSeries` are paired with the live derive's by-basis object and gated reason by plan 05's `basisDqf` on purpose. `readCashConventions` is known limit (a).

### Founder decisions applied (2026-11-03, CONTEXT.md)

D-04: the factsheet and the joint fail closed for a terminal-success row whose derive prestamp left no bound snapshot (plans 03 and 07). Plan 09 writes the key on every strategy-mode prestamp, so the state is detected by the key and a legacy row at rest is untouched. D-05: the reach is the factsheet, the approval gate, the lists and /compare, and the rest is booked as `[190-RERUN-SURFACES-NOT-HOLDING]`. D-06: the updating-line wording.

### Defaults still taken, which the founder can flip

OQ-2 (ranking stays terminal); OQ-4 (failed-then-retried rows under the evidence rule); plan 09's design (the last-success snapshot carried inside `data_quality_flags` and bound to computed_at, with no migration; the rejected staging-column and success-snapshot-column alternatives are in plan 09's SUMMARY); plan 07's /compare choice, which dates a chain-broken row by its effective headline_since for every row and not only during a re-run. A chain-broken row with no valid headline_since now draws no curve, matching the factsheet's Withheld verdict. A chain-broken row whose series row echoes another densify convention but whose flags carry headline_since now draws its dated curve. How many published rows each case covers on PROD is unmeasured.

## SC-5 against the plan's pass conditions

| Condition | Result |
|---|---|
| Task 3 or 4A: SC-2 column 0 with at least 1 wizard contribution finalized | VOID. Organic window had 0 finalizes, 4A not run (founder decision). Not a pass. |
| Task 4B: B1 and B2 both valid, figures and updating line on the owner lane | PASS. Public lane not applicable (strategy not published). |
| Task 4A: KCS-09 line on a new draft before its first compute (SC-4) | VOID with 4A. |
| Task 4C: 390 px wrap | NOT MEASURED. |
| Task 1: TODOS.md entry exists | Done, but rides the records PR, not the ship PR (deviation above). |

## Left open

1. SC-2 on PROD: re-run `190-MEASUREMENT-postdeploy.sql` after the next real contribution finalize and add the result. The run only counts if `wizard_contributions_finalized_after_deploy` is at least 1. No TODOS.md entry tracks this at the phase branch HEAD (see 4A follow-up).
2. SC-4 on PROD: unmeasured, unit and route tests only.
3. 390 px overflow on PROD: unmeasured, component test only.
4. The `composite-read-path.ts` JSDoc cleanup, and RESEARCH Open Question 3, both noted above.

## Deviations from Plan

1. Task 1 (the TODOS booking) rides the records PR because PR #1194 merged without it.
2. Task 4A not run, by founder decision; SC-2 and SC-4 recorded VOID.
3. Task 4C not measured (browser could not resize below the desktop viewport).
4. B2's closing bracket is the success write's timestamp, not a second read.

## Self-Check: PASSED

- FOUND: `190-MEASUREMENT-postdeploy.sql`, commits `02c3bdbd8` and `0059e6971`.
- No strategy id, uuid, name, figure, screenshot, marker text or home path is written in this file.
