---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 11
status: checkpoint
---

# 188-11 SUMMARY — SC-4 post-deploy reading (no pre-merge baseline; substitute reading not confirmed)

The plan's Task 1 baseline was to be taken while the phase PR was open and unmerged. It was never taken: PR #1196 merged at 2026-11-04T07:39Z with no `sc4-baseline:` record, and no baseline file exists in any scratch directory. Every key has been re-derived since, so the pre-merge state cannot be read back. The plan's own rule: "A reading with no pre-merge baseline is not a reading: it stops." Task 2 (the wait) was taken; Task 3 was not run as planned.

sc4-baseline: absent (Task 1 not run before the merge of #1196; not recoverable read-only)
sc4-deploy: merge=cdb9061435a79a3f9e12360479050c6c2823c468 worker=d37e5e56927882848f5a9cfeac7708e450de2f57 deployed=2026-11-05T00:05Z
deploy-note: the running analytics `/health` `git_sha` is d37e5e56 (main head, a descendant of the merge); both Railway services reached SUCCESS on it, at 23:52Z on 2026-11-04 and at 00:05Z on 2026-11-05. Every CI workflow run on the merge commit concluded success (5 runs).
marker-sc4: PRODUCTION
sc4-wait: start=2026-11-05T00:10Z derive_done=31/31 composed_after_deploy=7/7 at=2026-11-05T08:30Z
wait-note: the latest `derive_broker_dailies` job of each of the 31 subjects created after the deploy is `done`; all 7 `equity_curve` books carry `inputs.composed_at` after the deploy, the first at 01:36Z.
scratch-note: SQL and outputs live in a scratch directory under the operator's cache, not `/tmp/tinybase-11` as the plan names, by the orchestrator's instruction; nothing in it is tracked.

## CHECKPOINT REACHED

SC-4 cannot be read as planned. Options for the founder:

1. **Substitute reading without a baseline (recommended).** Run the checks that need no pre-merge state: (a) key C's 2026-10-27 and 2026-10-28 have no row in `csv_daily_returns`; (b) checks 2 and 3 of the plan, the derive's own `key_inputs.tiny_base_days` against the rule restated and replayed with `replay_key_equity`, must agree for every key; (c) every stored key-day absent now is a day in that key's `tiny_base_days` (a stored day the rule names must have no row); (d) the `sc4-scenario:` line for key C. What it cannot prove: "no other book changed except on days the rule names" (book `returns` and `curve` diffs) and "no key-day appeared", which both need the baseline. Record that limit as a deviation in CONTEXT and ROADMAP.
2. **Accept SC-4 on the synthetic proof only** (plans 01 to 10) and record the PROD reading as not taken, a deviation in CONTEXT and ROADMAP.
3. **Route SC-4 to a follow-up phase** that takes a baseline before the next change to the derive and reads after it.

## Substitute reading (founder 2026-11-05)

sc4-founder: "Substitute reading (Recommended)" (answer to the checkpoint above, option 1)
marker-sc4: PRODUCTION
sc4-substitute: taken=2026-11-05T08:45Z keys=30 with_stated=9 stated=354 recomputed=121 agree=121 basis=post-deploy key_inputs, csv_daily_returns and the repo's replay_key_equity; the rule restated as 0.05, 30 days, window t-30..t-1 with carry, 0 < base
sc4-sub-a: key=C 2026-10-27 stored=yes was=+0.4698 2026-10-28 stored=yes was=-0.5267 — NOT handled: both rows are still in `csv_daily_returns`, last written 2026-11-04T01:18Z, before the deploy
sc4-sub-b: agree=no — every recomputed day is a stated day (121 of 121), but 233 stated days are not reproduced or not checkable:
sc4-sub-b-key: key=C stated=64 recomputed=9 only_stated=55 (2024-01-21..2026-05-15, realized era) only_recomputed=0
sc4-sub-b-key: key=k1 stated=64 recomputed=9 only_stated=55 (2024-01-21..2026-05-15, realized era) only_recomputed=0
sc4-sub-b-key: key=k2 stated=64 recomputed=9 only_stated=55 (2024-01-21..2026-05-15, realized era) only_recomputed=0
sc4-sub-b-key: key=k3 stated=29 recomputed=29 agree
sc4-sub-b-key: key=k4 stated=31 recomputed=18 only_stated=13 (2025-09-06..2025-10-07) only_recomputed=0
sc4-sub-b-key: key=k5 stated=31 recomputed=18 only_stated=13 (2025-09-06..2025-10-07) only_recomputed=0
sc4-sub-b-key: key=k6 stated=21 recomputed=none (no anchor: the replay returns no series) 2026-07-31..2026-08-20
sc4-sub-b-key: key=k7 stated=21 recomputed=none (no anchor: the replay returns no series) 2026-07-31..2026-08-20
sc4-sub-b-key: key=k8 stated=29 recomputed=29 agree
sc4-sub-b-note: unexplained. Candidate explanations not yet tested: the derive judges a realized-era day on its own NAV in the key's native unit while the replay judges USD levels, and D-08 quiet days on a sparse NAV index. Recorded as not confirmed, not explained away.
sc4-sub-c: stored_on_named_days=24 (keys C, k1, k2: 2026-10-27..2026-11-03, 8 each); 0 on every other key
sc4-sub-c-cause: likely, not verified: the derive's reconcile delete only names days inside the span [returns.index.min(), returns.index.max()]; when the days after the last measured day are all left out, the span ends at 2026-10-26 and the older rows after it are never deleted. Effect: the 3 books holding these keys are now untrustworthy with `key_inputs_mismatch` (3 of 7 books read `is_trustworthy: false`).
sc4-scenario: key=C listed=2 rows_absent=0 engine=188-09+188-10-tests
sc4-verdict: FAIL (substitute reading, not confirmed: sub-a, sub-b, sub-c and the scenario input fail). Limit of this reading: without a pre-merge baseline it cannot prove that no other book's figures changed except on the named days, or that no key-day appeared.

## CHECKPOINT REACHED

The substitute reading does not confirm SC-4. Options for the founder:

1. **Fix in this phase (recommended).** A gap-closure plan: the reconcile delete also removes stored rows on days the derive names as tiny (or the span runs to the last day the derive judged); a test RED on a tail of tiny days; explain or fix the 233 stated-but-not-reproduced days; re-derive and re-read. Key C's two days and three untrustworthy books stay as they are until it ships.
2. **Route to a follow-up phase** with the same scope, and close 188 with SC-4 recorded as not met.
