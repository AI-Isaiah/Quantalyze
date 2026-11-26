---
status: resolved
trigger: "One Deribit account's stored returns end 2026-10-26 while its inputs carry a 2026-11-09 flow and its daily derive_broker_dailies jobs are all done (v1.22 wave-0 diagnosis, owned by Phase 233 DERIBITTRUTH, FRESH-01). Read-only."
created: 2026-11-24T00:00:00Z
updated: 2026-11-26T02:12:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: The series end is the Phase 188 tiny-base rule (D-02 leave out, D-03 under 5% of the 30-day peak, D-08 quiet days too) working as decided, after a near-total withdrawal on 2026-10-26. It is not a derive exit and not a writer defect.
test: Recompute the rule independently (SQL, no production helper) from the stored writer chain and compare it with the stored `tiny_base_days`; check the derive path taken; predict when rows resume.
expecting: The independent recompute names exactly 2026-10-27 through 2026-11-23, and the first countable day is 2026-11-25.
next_action: none. The 2026-11-26 reading confirmed the prediction, and FRESH-02's freshness prober arm now watches the account.
bug_class: not a bug in the writer. The defect is that no reader treats a stated leave-out as a named reason, so a correct held tail reads as stale.

## Symptoms

expected: A daily-derived key's newest stored return day is no older than its newest flow day and its anchor day, or the gap carries a stored, named reason.
actual: Three logins of one Deribit account (keys D1, D2, D3 below) store returns up to 2026-10-26 only. Their `key_inputs` carry a flow on 2026-11-09 and a realized terminal and NAV mark on 2026-11-23. Every nightly derive since then is `done`, attempts 1, no error.
errors: none.
reproduction: PROD reads below (marker query first in each batch; it named PRODUCTION every time).

## Eliminated

- Candidate (a), the `<2-day` key-mode exit (`run_derive_broker_dailies_job`, the `int(returns.notna().sum()) < 2` branch). Each key stores 1155 rows from 2023-06-28, so the derive takes the `>=2` path. The tail days are NaN inside a long series, not a short series.
- A derive that stopped running or failed. The `derive_broker_dailies` jobs for D1 on 2026-10-25 through 2026-10-28 and every night through 2026-11-24 are `done`, attempts 1, reclaim 0, null `last_error`.
- A writer that stopped writing `key_inputs`. Each key's `key_inputs` row was recomputed on 2026-11-24 with `realized_terminal_day` 2026-11-23 and a NAV mark for 2026-11-23.

## Evidence

- timestamp: 2026-11-24
  checked: `csv_daily_returns` per key (key-mode rows), newest day and newest write
  found: "D1, D2, D3: newest day 2026-10-26, newest write 2026-10-26 05:38-06:00Z, 0 rows written in the last 2 days. A sibling Deribit account's key (D4) has newest day 2026-11-23 and was written on 2026-11-24."
- timestamp: 2026-11-24
  checked: D1 `key_inputs` (`allocator_equity_derived`, kind `key_inputs:<key>`)
  found: "a composed withdrawal on 2026-10-26 of about 99.6% of the level (the level after it is about 0.4% of the level before); a realized terminal and anchor on 2026-11-23 at about half of the post-withdrawal level; a small deposit on 2026-11-09 (under 1% of the post-withdrawal level). `tiny_base_days` holds every day 2026-10-27 through 2026-11-23 (plus 2024-01-21..2024-02-18 and 2026-04-18..2026-05-15, the gaps inside the stored history). `dropped_day_pnl` (D-15) carries the stated P&L for each of those days."
- timestamp: 2026-11-24
  checked: independent recompute of the tiny-base rule in SQL, no production helper. The level is rolled back from `realized_terminal_usd` through `composed_day_pnl` and `composed_flows` on a gap-free calendar; base(t) = level(t-1); peak(t) = max level over t-30..t-1; tiny when 0 < base < 0.05 * peak.
  found: "tiny is true on exactly 2026-10-27 through 2026-11-23 and false on 2026-10-26 and every day before it in the window read. Base/peak ratio on the tail is 0.0019 to 0.0052. On 2026-11-24 the window (2026-10-25..2026-11-23) still holds the pre-withdrawal level, so it is tiny. On 2026-11-25 the window (2026-10-26..2026-11-24) peaks at its post-withdrawal high, against which the base has a ratio of about 0.35, so 2026-11-25 is the first countable day."
- timestamp: 2026-11-24
  checked: Phase 188 records (`.planning/milestones/v1.20-phases/188-.../188-CONTEXT.md` D-02, D-03, D-08, D-10, D-13)
  found: "This account is 188's key C. D-10 and D-13 record that key C's 2026-10-27 and 2026-10-28 rows were removed on purpose. The +42% and -45% moves on those days are the moves on about 0.4% of the account that 188 was booked to stop reading as performance."
- timestamp: 2026-11-24
  checked: the three allocator books that hold these keys, `equity_curve` payload
  found: "All three books are `is_trustworthy=false`, each with `out_of_window_flow` among its `degrade_reasons`. `_reconstruct_key_equity` (allocator_equity_derive.py) counts a flow dated after the key's last return day as out of window. The key's 2026-11-09 flow sits on a stated-out tail day, past the last stored return, so it counts. The books carry other reasons too (`window_truncated`, and `classified_rotation` on two)."
- timestamp: 2026-11-24
  checked: per-key freshness census over every key with a `key_inputs` row (all venues)
  found: "Measured against max(newest flow day, realized terminal day), every key's gap after its newest return day is covered day by day by `tiny_base_days`, or the key carries `anchor_null_reason` (two MT5 logins of a closed account: newest return, flow and terminal all on 2026-10-09, reason `nonpositive`; one OKX key: reason `dust`, no returns). Uncovered days: 0 on every key. Two revoked Bybit keys keep a stale `key_inputs` row from 2026-07-20 and are no longer derived."

## Resolution

root_cause: "No writer defect. After a near-total withdrawal on 2026-10-26 (about 99.6% of the account), every later day's base is under 5% of the 30-day peak, so the Phase 188 rule leaves it out (D-02), quiet days included (D-08). The derive states each left-out day in `key_inputs.tiny_base_days` and its P&L in `dropped_day_pnl`. The series is held, not stale. What is missing is a reader: no freshness check exists, and nothing treats a stated leave-out as a named reason, so a correct held tail is indistinguishable from a stranded one. The same missing reader makes the compose count the 2026-11-09 flow as `out_of_window_flow`."
fix: "not applied (diagnose only). For Phase 233: FRESH-01 needs no writer change; the stored, named reason already exists. FRESH-02's check must accept a gap that is covered day by day by stated leave-out days (`tiny_base_days`) or carries `anchor_null_reason`, and page on anything else. The compose-side `out_of_window_flow` on a stated-out tail day is a seam S2 change (owner Phase 234)."
prediction: "The 2026-11-26 nightly derive (mark day 2026-11-25) writes a row for 2026-11-25 on D1, D2 and D3, and none for 2026-10-27..2026-11-24. Once a return exists after 2026-11-09, that flow is inside the window and `out_of_window_flow` stops counting it."
verification: "2026-11-26 PROD reading (233-06-SUMMARY.md): D1, D2 and D3 each store a key-mode return for 2026-11-25 and none for 2026-10-27..2026-11-24; their 2026-11-26 derives are done at attempts 1; key_inputs still lists every gap day in tiny_base_days and dropped_day_pnl, does not list 2026-11-25, and keeps the one 2026-11-09 flow; the freshness arm reports 0 uncovered keys (prober run, A5 proven). Verdict CONFIRMED. Of the three books, A and C read no out_of_window_flow after the compose. Book B still reads out_of_window_flow, which went to Phase 234."
files_changed: []
