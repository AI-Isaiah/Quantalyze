---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 15
subsystem: analytics
tags: [gap-closure, ship, prod-rederive]
completed: 2026-11-05
---

# Phase 188 Plan 15: review, ship, freshness gate, deploy and PROD re-derive Summary

gc-review: reviewers=code-reviewer+silent-failure-hunter rounds=3 open_medium_plus=0 at=2026-11-05T09:20:00Z
gc-freshness: baseline=b0 taken=2026-11-05T08:32:31Z last_job_done=2026-11-05T01:39:00Z fresh=yes

gc-ship: pr=#1205 head=ab9750399d8ea83b42fc2e46de314d95be2d9584 runs=2 ref_runs=2 merged=50594c75034a2bf61f4fff7cbc5bf27252220fed at=2026-11-05T09:36:12Z
gc-main-ci: merged=50594c75034a2bf61f4fff7cbc5bf27252220fed runs=2 ref_runs=2 drift_red_tolerated=no
gc-deploy: health_sha=50594c75034a2bf61f4fff7cbc5bf27252220fed descendant_of_merge=yes deployed=2026-11-05T09:49:36Z
gc-rederive: nightly_started=2026-11-06T00:40:00Z keys_done=9/9 strategies_enqueued=0 strategies_done=0/0 books_composed_after=7/7 at=2026-11-06T07:05:00Z

## Review

- Round 1: GC1-01 (a stale row on the first mark day, and a dust-base last mark day, survived) and GC1-02 / SFH-188-01 (the key-mode under-two-days branch kept stale rows) — both MEDIUM, data integrity. Fixed in `632cfff91` and `7f2ab02a8`.
- Round 2: GC2-01 (the widened delete in the under-two-days branch also removed the day the derive measured) and GC2-02 (its test asserted that state) — both MEDIUM. Fixed in `ba09218dc`. The silent-failure hunter was clean.
- Round 3: clean at MEDIUM and above from both reviewers (`188-REVIEW.md`).

## Freshness gate

Run immediately before the merge, with the marker alone first: no derive or compose job pending, running or awaiting retry, and the latest finished one (01:39Z) is before the baseline's capture time (08:32Z). The baseline was not re-taken.

## Re-derive

Read on 2026-11-06 in a session that started with the marker alone (PRODUCTION). Keys C, k1 and k2 were eligible. No enqueue was needed. The nightly run at 00:40Z, the first scheduled run after the deploy, derived all 9 eligible keys, and all 9 finished `done` (C at 01:31Z, k1 at 01:23Z, k2 at 01:15Z). The baseline shows no strategy holding a stored row on a stated day, so nothing was enqueued for strategies. Each of the 7 books was composed between 01:36Z and 01:37Z, after the deploy and after the latest derive of every key it lists. Four keys that appear in books' key inputs have never had a derive job and are not on the fan-out's eligibility list. The set is the same in the b0 baseline. The nightly cannot derive them, so they place no ordering condition on a compose. No book now carries `key_inputs_mismatch`. No SQL file run holds a DELETE, UPDATE, INSERT or TRUNCATE.
