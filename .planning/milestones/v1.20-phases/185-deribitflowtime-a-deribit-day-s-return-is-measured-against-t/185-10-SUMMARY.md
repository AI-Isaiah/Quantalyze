---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 10
status: complete
gate: founder decision (SC-4 FAIL choice)
---

# 185-10 SUMMARY: SC-3 and SC-4 read on PROD after the one-PR deploy

Run 2026-11-03, about 07Z, by the orchestrator session, never a dispatched executor. Read-only:
Supabase SELECTs (marker first, run alone, then a `marker_is_prod` column on every later read),
`gh` and Railway status reads, the analytics `/health` endpoint, and one read of /allocations in
the founder's signed-in browser (nothing entered, nothing clicked). Nothing was written to PROD.
Keys are ROADMAP letters. SQL and raw output stay in the session scratchpad.

## Task 1: F4

f4-answer: f4-a

F4 was answered on 2026-11-01 and is recorded as D-08 in `185-CONTEXT.md` ("Next nightly derive
(Recommended)"). No second D-line was written. Under f4-a nothing is enqueued, so this SUMMARY
holds no `f4-enqueue:` line.

## Task 2 step 0: SC-3 on PROD

One PR (D-13), so there was no window between a caveat-only deploy and the options-basis deploy.
Step 0 ran after the single deploy, on the rows the first post-deploy key-dailies run wrote.

marker-sc3: PRODUCTION

sc3-flag: A: options_cash_basis=absent (valued at market) options_activity=true recomputed=2026-11-03T01:25:52Z
sc3-flag: C: options_cash_basis=present recomputed=2026-11-03T01:36:26Z

sc3-screen: shown

- The first post-deploy run of `derive-allocator-key-dailies` (schedule `40 0 * * *`, read from
  `cron.job`) started 2026-11-03T00:40:00Z and succeeded. Both rows above were computed after it.
- Key A is read under the CORRECTED 2026-11-03 (D-09) step-0 rule: its row carries
  `options_activity=true` and `options_basis=smoothed_mtm`, so the derive valued its options at
  market and correctly did not raise the cash-basis flag. That counts as a pass. ⚠️ The Task 2
  `<automated>` check as written still asks for `present` on every `option_activity=true` key, so
  it exits non-zero on key A. The correction note governs; the check was not edited.
- Key C carries the flag because its smoothed build fell back to cash (D-10), as the dry run
  predicted (`smoothed_error=LedgerValuationError`).
- Key B (`option_activity=unread` in `dry-keys:`) now reads `options_activity=true`,
  `options_basis=smoothed_mtm`, flag absent.
- Screen: the /allocations Overview shows the amber paragraph with the `f3-answer:` sentence. It
  was read after the deploy window closed, so it reflects key C's written flag, not D-13's
  unstamped-row rule. The deploy-window screen (before 00:40Z) was not read.
- Frozen-key census (WR-03): every drawn key's `key_inputs` row was recomputed after the run's
  start, so no drawn Deribit key sits on a pre-deploy row. Frozen keys: none.

## Task 2 steps 1 to 7: SC-4 on PROD

sc4-deploy: pr1=099a9f1 pr2=099a9f1 worker=099a9f1 api=099a9f1 ci=5/5

- One merge commit (PR #1187). All 5 workflow runs on that commit concluded success. The backfill
  worker's latest SUCCESS deployment is at that commit, created 2026-11-02T21:49Z. `/health`
  `git_sha` is the same commit, and it is an ancestor of `origin/main`. Deploy time: 2026-11-02T21:50Z.

marker-sc4: PRODUCTION

sc4-wait: start=2026-11-03T00:40:00Z source=cron

- Every `derive_broker_dailies` row created after the wait start for the book's keys is `done`
  (A, B, C and the non-Deribit D, E, F; none `failed_final`). The book's `derive_allocator_equity`
  job created after them is `done` at 01:37:25Z.

sc4-keys: A: recomputed=2026-11-03T01:25:52Z basis=smoothed_mtm caveat=absent days_gt_0.5=2 marks_since=2026-10-26
sc4-keys: B: recomputed=2026-11-03T01:15:33Z basis=smoothed_mtm caveat=absent days_gt_0.5=0 marks_since=2026-10-26
sc4-keys: C: recomputed=2026-11-03T01:36:26Z basis=cash caveat=present days_gt_0.5=4 marks_since=2026-10-26

sc4-book: book_days_gt_0.5=2 dates=2025-07-13,2025-08-05 cum_all=x3835.9367 cum_2025=x999.0904 cum_2026=x2.0874

- The book's `equity_curve` row is payload version 2, computed 2026-11-03T01:37:25Z, after every
  key row: 899 days from 2023-06-28 to 2026-11-02.

sc4-day: day=2025-07-13 key=A r=0.6234 was=3.3360 class=B
sc4-day: day=2025-08-05 key=A r=0.6475 was=0.6663 class=B

- Both remaining book days are key A days that plan 185-01 classed B. They are now valued on the
  smoothed basis, and both values match the dry run's `smoothed_r` to 4 decimals (0.6234,
  0.6475).
- Key C's 4 key-level days above 0.5 (2026-02-28 1.6885, 2026-03-02 0.7076, 2026-09-06 0.7116 on
  cash, class B in plan 185-01; 2026-10-28 -0.5267, marked) do not reach 0.5 in the book. These
  are exactly the days D-10 listed as remaining under "Smoothed, cash fallback".

## Task 3: verdict and report

sc4-verdict: FAIL (class B days remain in the book: 2025-07-13,2025-08-05; option key on cash basis: C)

sc4-report: days_gt_0.5 6 -> 2; cum_all x3516.0746 -> x3835.9367; cum_2025 x1007.5844 -> x999.0904; cum_2026 x2.0680 -> x2.0874; remaining=2025-07-13:A:B,2025-08-05:A:B; caveat=shown on C; sc3=present on C, absent (valued at market) on A, with screen shown; c_2026_10_28=mechanism 7 (no defect: the owner withdrew most of the account on S=2026-10-26 and the 10-28 drop is the open-position P&L on the small balance left), f7-b, phase 188 booked

In plain words:
- The book's days above 50% went from 6 to 2. Four of key A's cash-basis spikes are gone, and so
  is the largest one (+529% on 2025-08-04).
- The 2 days left are key A's 2025-07-13 (+62.3%, was +333.6%) and 2025-08-05 (+64.8%, was
  +66.6%). Both are now measured at smoothed market value, not cash. They are still the
  option-driven days plan 185-01 classed B, so the rule as written fails SC-4 on them.
- Key C could not be valued at market. Its option replay refuses its history, so its curve stays
  on cash basis and carries the amber caveat, which is on screen. None of its days reaches 50% in
  the book.
- ⚠️ The cumulative did not come down. The whole history reads x3836 against x3516 before, 2025
  reads x999 against x1008, and 2026 reads x2.09 against x2.07. Market-valuing the options
  removed the single-day spikes, but the multi-year compounding is not a cash-basis artefact.
  The 185-01 debug session already said this mechanism alone does not explain it.
- Key C 2026-10-28 (-52.7%) is explained (mechanism 7, no defect) and routed to phase 188 (f7-b).

## SC-4 FAIL answer

```
sc4-fail-answer: c
```

Founder 2026-11-03 (D-14): "Accept the named days". SC-4 is met with key A's 2025-07-13 and 2025-08-05 named, and key C
on cash with the caveat shown, as D-10 pre-accepted. The ROADMAP carries the correction note against criterion 4. The
book cumulative goes to TODOS as `185-BOOK-CUMULATIVE-UNEXPLAINED`, not a phase (D-14).
