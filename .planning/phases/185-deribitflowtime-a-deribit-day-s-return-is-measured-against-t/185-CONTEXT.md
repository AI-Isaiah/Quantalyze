# Phase 185: DERIBITFLOWTIME — a Deribit day's return is measured against the capital that was in the account, not the overnight balance - Context

**Gathered:** 2026-11-01
**Status:** Ready for planning (replanned 2026-11-01 on re-crawl verdict B, D-04)
**Source:** the ROADMAP Phase 185 entry, which carries the founder's three booking answers of 2026-11-01 verbatim, plus the findings of the Deribit implausible-returns debug session (diagnose-only, status `diagnosed`). No discuss-phase was run; nothing below is a founder decision unless it says so.

<domain>
## Phase Boundary

A Deribit day with an external flow is measured against the capital that was in the account when the P&L was earned, not against the overnight cash wallet with the flow booked at end of day. Each Deribit flow's instant is stored and a flow day is split at its flows, so capital that arrives and leaves inside one UTC day enters the base. Until that ships, the affected allocator books say so on screen (ROADMAP Phase 185 Goal, SC-1..SC-5).

Data integrity and user-facing: an allocator book's curve on /allocations reads cumulative growth in the thousands of times, with daily returns of several hundred percent on days the market moved about 2%. After 176 LEGACYRETIRE the derived curve is the only curve, so there is no legacy series to fall back to.

The phase is gated: the read-only re-crawl (SC-1) runs first and decides between mechanism A and mechanism B. Code plans assume A. If the verdict is B, the phase replans.

⛔ **CORRECTED 2026-11-01 (D-04, replan on verdict B).** The re-crawl ran, and its verdict is B (185-01-SUMMARY, `gate: B`). The phase boundary is now this: a Deribit allocator book values open options at market. The mark-to-market and smoothed bases that strategy mode already runs also run in allocator (key) mode, so an option premium or payout is measured against equity that includes the option book, not the cash wallet. The interim caveat stays on the book until that ships. The flow-time split is dropped. The two paragraphs above are kept as lineage. The phase's short name, DERIBITFLOWTIME, is kept so its id and directory stay stable.

</domain>

<decisions>
## Implementation Decisions

- **D-01 — Investigate the root cause** Founder 2026-11-01, AskUserQuestion: "On /allocations, your book's curve has 6 days in 2025 with returns over 50% ... What should happen?" Answer: "Investigate root cause (Recommended)".
  - The extreme days are treated as a defect to trace, not as data to clip, cap or hide.

- **D-02 — Re-crawl, then fix** Founder 2026-11-01, AskUserQuestion: "... To confirm it before fixing, I'd re-read those days' Deribit transaction log through the worker ... Go ahead?" Answer: "Re-crawl, then fix (Recommended)": "Run the read-only re-crawl for the two keys' big days. If it confirms the cause, book a fix phase: store each Deribit flow's time and split the day at it, with a caveat on the book until it ships."
  - The re-crawl is read-only: Supabase reads and Deribit read endpoints only; it prints counts and ratios, never ids, amounts or logins.
  - It covers the two keys' big days (keys A and C in the ROADMAP evidence).
  - The fix is: store each Deribit flow's time, split the day at it, and caveat the book until it ships.

- **D-03 — Book the fix now; the re-crawl is the phase's first step** Founder 2026-11-01, AskUserQuestion, after Railway SSH refused connections twice: "Book the fix now (Recommended)": "Book the fix phase on the PROD evidence: store each Deribit flow's time and split the day at it, with a caveat on the book until it ships. The re-crawl moves into that phase as its first step, to run once SSH works."
  - The re-crawl is plan 01, run by the orchestrator inside the Railway worker once SSH works, never by a dispatched executor.
  - Its verdict is recorded before any code change (SC-1). If it is mechanism B, the phase replans.

- **D-04 — Replan for options; drop the flow split** Founder 2026-11-01, AskUserQuestion, after the re-crawl verdict B: "Replan 185 for options (Recommended)": "Replan 185 around valuing options at market in allocator books. The mark-to-market and smoothed bases already exist for strategies, but are switched off in allocator (key) mode. Keep the interim caveat on the book. Drop the flow-time split, which barely helps."
  - It supersedes D-02's and D-03's fix ("store each Deribit flow's time and split the day at it"). Their re-crawl half is done.
  - The fix is to value options at market in key mode, reusing the existing strategy-mode MTM and smoothed bases (`job_worker.py` gates them on `not is_key_mode`; `deribit_txn.py` `DEFAULT_PNL_BASIS` is `cash_settlement`; the smoothed basis sits behind `SMOOTHED_MTM_ENABLED`). It is not a new basis.
  - The interim caveat stays on the book until the fix ships.
  - Evidence (185-01-SUMMARY): on 20 of the 23 readable days with |r| > 0.3, splitting at the flows gives the stored return within 1%. Only key A 2025-08-04 drops (3.93 against 5.29 stored). The big days are option trade and delivery rows booked at cash value. Key C 2026-10-28, a marked day, reads −52.7% from one `negative_balance_fee` row and must be explained.

- **D-05 — F1: Smoothed** Founder 2026-11-01, AskUserQuestion, plan 185-06 Task 1: "Which options basis does an allocator book use?" Answer: "Smoothed (Recommended)": "Value the option book at daily option prices, smoothed. This basis already exists for strategies."
  - Binds plan 185-08 (the key-mode options step runs the smoothed basis). The question is recorded by its RESEARCH heading (F1); the full question text as put was not passed to this checkout.

- **D-06 — F6: No new switch** Founder 2026-11-01, AskUserQuestion, plan 185-06 Task 2: "Rollout switch." Answer: "No new switch (Recommended)": "It ships live. The cash fallback and the caveat already handle failure."
  - Binds plan 185-08: no `KEY_MODE_OPTIONS_BASIS_ENABLED` switch and no reuse of `SMOOTHED_MTM_ENABLED`; rollback is reverting the merge. The question is recorded by its RESEARCH heading (F6).

- **D-07 — F2: Cash basis + flag** Founder 2026-11-01, AskUserQuestion, plan 185-09 Task 1: "What does a day older than the option-price window show?" Answer: "Cash basis + flag (Recommended)": "Keep today's cash value for those days and flag them. The caveat stays on the book."
  - Binds plan 185-09 Task 3 (f2-a: bucketed days keep their cash-basis return, stamped and caveated). The question is recorded by its RESEARCH heading (F2).
  - Departs from ROADMAP SC-5 and SC-2; see the ⛔ CORRECTED (D-07) note in the ROADMAP Phase 185 entry.

- **D-08 — F4: Next nightly derive** Founder 2026-11-01, AskUserQuestion, plan 185-10 Task 1: "Recompute timing." Answer: "Next nightly derive (Recommended)": "No PROD write. The curves update in the next night's run."
  - Binds plan 185-10 Task 2 (f4-a: no one-off enqueue; the SC-4 reading waits for the next scheduled key-dailies fan-out). The question is recorded by its RESEARCH heading (F4).

- **D-09 — F3: Amber note, any options key** Founder 2026-11-01, AskUserQuestion, plan 185-04 Task 2: "The interim caveat's sentence, where it shows on /allocations, what raises it, and how it is removed." Answer: "Amber note, any options key (Recommended)": "Shows in the existing amber note on the /allocations Overview for any book with a Deribit key that trades options. It clears itself per key once the fix ships. Text: \"Some days on a Deribit account were measured against its cash balance, which leaves out open option positions, so their returns can be extreme.\""
  - Binds plan 185-04 Task 3 (trigger a on the writer side) and plan 185-05 (placement a, the sentence byte for byte); removal a is plan 185-08's self-clearing narrowing. f3-rec: placement=a trigger=a removal=a. The question is recorded by the plan's decision text (F3); the full question text as put was not passed to this checkout.
- **D-10 — Dry-run gate: Smoothed, cash fallback** Founder 2026-11-01, AskUserQuestion, plan 185-02 Task 3: "Phase 185 dry run: valuing options at market removes most of the extreme Deribit days, but not all, and fails on one key. Which way should the phase go?" Answer: "Smoothed, cash fallback (Recommended)". Failed condition: key C smoothed_error=LedgerValuationError (5 of 9 days remain on smoothed). Days that remain under proceed: key A 2025-07-13 and 2025-08-05 (smoothed); key C 2026-02-28, 2026-03-02 and 2026-09-06 (cash, flagged).
  - Binds plans 185-07, 185-08 and 185-09 (they may start; D-05 and D-07 stand) and plan 185-03, which also diagnoses key C's option-book replay refusal (`replay_option_positions` raises `LedgerValuationError`).
- **D-11 — F7: Book a fix phase** Founder 2026-11-01, AskUserQuestion, plan 185-03 Task 2: "Key C's −52.7% day (2026-10-28) is explained. On 10-26 the owner withdrew almost everything, leaving about 0.4% of the account, mostly a small option position. That option rose +47% of NAV on 10-27 and fell −53% on 10-28 while the rest of the account didn't move. The marks are consistent and no data defect was found. What should happen?" Answer: "Book a fix phase"
  - Binds plan 185-03 Task 3 (q7-route: phase 188 booked) and plan 185-10's SC-4 report, which cites Phase 188 TINYBASE as the owner of how such tiny-base days are treated. f7-b departs from no success criterion.
- **D-12 — F5: No, strategies stay cash** Founder 2026-11-01, AskUserQuestion, plan 185-06 Task 3: "Phase 185 F5: after the fix, allocator books value Deribit options at smoothed market prices, but a strategy's own headline return stays on the cash basis. No strategy sits on your Deribit logins today. Should strategy headlines move to the option basis too?" Answer: "No, strategies stay cash (Recommended)"
  - Binds plans 185-07 to 185-09 (key mode only; the strategy headline stays cash). f5-route: none.
- **D-13 — Frozen keys: Show the note, accept over-warning** Founder 2026-11-01, AskUserQuestion, review round 2 WR-03: "Phase 185: a Deribit options key that has left the book (or whose nightly recompute keeps failing) is never recomputed. So it never gets the new amber-note flag, and its extreme cash-value days stay on the curve with no note, permanently. How should that be handled?" Answer: "Show the note, accept over-warning (Recommended)": "The recompute stamps every Deribit key with whether it trades options. A drawn Deribit key whose row was never stamped shows the amber note. This also warns on frozen Deribit keys that never traded options (perp-only). Same 'warn rather than hide' rule as a failed read."
  - Binds the round-2 fix (writer stamp `options_activity` on every Deribit key-mode `key_inputs` payload; the reader raises the caveat for a drawn Deribit key whose row lacks it) and plan 185-10's SC-3 reading.
- **D-14 — SC-4 FAIL: Accept the named days** Founder 2026-11-03, AskUserQuestion, plan 185-10 Task 3 step 3: "Phase 185 SC-4 reads FAIL on PROD after the deploy. Days above +50% in the Deribit book fell from 6 to 2; the +529% day is gone. The two left are both key A: 2025-07-13 (+62.3%, was +333.6%) and 2025-08-05 (+64.8%, was +66.6%), now valued at smoothed market prices. Key C stays valued on cash with the amber note showing, because its option history can't be replayed. These are exactly the survivors D-10 named in advance on 2026-11-01. What should happen?" Answer: "Accept the named days (Recommended)": "SC-4 is recorded as met with these days named, matching D-10. It gets a dated correction note in the ROADMAP and a D-14 line, then 185 is verified and closed."
  - Same session, same day: the founder chose a TODOS entry, not a phase, for the book cumulative (x3836, unchanged by the fix), and moved Phase 189 OPTIONREPLAY to TODOS (open phases purely about Deribit or SFOX leave this milestone).

### Rules carried from the ROADMAP entry (not re-asked)
⛔ **CORRECTED 2026-11-01 (D-04):** the first four rules below belong to the dropped flow split and no longer bind a plan. They are kept as lineage. "Never invent data: an uncomputable day is null" and "Tests go RED on the current rule" still hold, now for the key-mode cash basis.
- A start-of-day or Modified Dietz rule is not used: it makes withdrawal days worse (SC-2).
- The day is split at the FLOW instants, using the timed-day machinery FLOWTIMING built for MT5 (SC-2).
- The caveat is the existing large-flow-day label, `flow_timing_day_level_large`, reaching key mode, not a new label (SC-3).
- Never invent data: an uncomputable day is null (SC-5). No instant is ever invented (FLOWTIMING D-07, restated in the `DayTiming` docstring).
- Tests go RED on the current day-level rule (SC-5).

### Claude's Discretion
⛔ **CORRECTED 2026-11-01 (D-04):** the three items below are about the dropped flow split and are kept as lineage. The replan's research sets the new discretion items.
- Whether the flow split reuses `DayTiming` as it stands or needs a flow-split variant. The ROADMAP leaves this open on purpose: `DayTiming` pairs each cash effect with its POSITION's open instant (FLOWTIMING D-02/D-04), which Deribit does not attribute, while SC-2 splits the day at the FLOW instants. Research must show what each choice computes on a day like the debug session's synthetic day (prior 100, deposit 900, then +300 P&L, then a 1100 withdrawal: day-level 3.0 against split-at-flows 0.30), and the plan states the choice with its evidence.
- Where the stored flow instants live (the existing `key_inputs` payload, the event-time `flows` array that already carries a `utc_day_iso`, or elsewhere), as long as the derive reads them back and the stored shape is pinned by a test.
- How a day's P&L rows are placed between flow instants. The row-embedded timestamps (`_row_utc_instant`) exist on every transaction-log row, so this is a measurement question for research, not an invented time.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` — `### Phase 185: DERIBITFLOWTIME` (goal, booking, evidence, root cause, planner warning, SC-1..SC-5)
- `analytics-service/services/deribit_txn.py` — `deribit_dated_external_flows_usd` (flows netted per UTC day and currency before anything is stored), `deribit_flow_instants` (per-row instants, built in memory for the marks seam, never stored), `DEFAULT_PNL_BASIS` (`cash_settlement`), `_row_utc_day`, `_row_utc_instant`
- `analytics-service/services/nav_twr.py` — `chain_linked_twr` (day-level arm `(NAV_t − NAV_{t−1} − F_t) / NAV_{t−1}`, D-15 `flow_timing_day_level_large` annotation), `DayTiming` and `_validate_day_timing`, the D-10 venue comment above `DayTiming` (Deribit at day level on FLOWTIMING-Q2)
- `analytics-service/services/native_nav.py` — the Deribit native NAV path; it passes no timing to `chain_linked_twr` today
- `analytics-service/services/allocator_equity_compose.py` — `portfolio_returns` (book return = Σ day P&L / Σ prior wallet)
- `analytics-service/services/job_worker.py` — the MTM and smoothed-MTM passes gated on `not is_key_mode` (mechanism B's premise: an allocator-book key is always cash basis)
- `analytics-service/services/broker_dailies.py` — `_fold_mt5_deals`, the MT5 fold that builds `DayTiming` today (the pattern SC-2 reuses)
- `src/lib/factsheet/composite-read-path.ts`, `src/app/factsheet/[id]/v2/FactsheetView.tsx` — where `flow_timing_day_level_large` is read and shown today (strategy mode only); SC-3 brings it to the allocator book
- `TODOS.md` — `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]`, the FLOWTIMING deferral this phase answers for flow days

</canonical_refs>

<specifics>
## Evidence (from the ROADMAP entry and the debug session's findings)

PROD 2026-11-01, read-only, ratios and counts only.
- One founder allocator book reads cumulative ×3539 since 2023-06, 2025 at ×1007, and still ×54 without its 11 days of |r| > 30%. Best day +529%, worst −78%. BTC moved at most ±2.2% a day on those days, which rules out ordinary perp leverage (it would need 150-350×).
- All 22 `csv_daily_returns` days with |r| > 50% sit on 5 Deribit keys across 3 books.
- Growth sits on days with a flow the same or the previous day: key A 2025 quiet days −24% against flow-adjacent ×64; key B 2025 +7% against ×29; key C 2026 ×7 against ×3855 (76 flow days, 58 of them outflow days, median prior level 5% of the key's max). Key C's key-level series is ×27306 in 2026 while the book shows ×2.07.
- No key has open options today, and no strategy sits on these logins, so there is no strategy-mode MTM twin to compare against.
- Only 2 to 3 days per key carry both flow signs across currencies. Same-currency netting is invisible to every stored read, which is why only the raw log can decide.

## Root cause (leading, mechanism A) and the alternative

- **A, intraday capital.** Same-currency deposits or transfers that arrive and leave inside a UTC day are netted per (day, currency) and booked at end of day, so they never enter the base. The day's P&L is then measured against the overnight sliver instead of the capital that earned it.
- **B, cash-basis options.** Under `cash_settlement` the level is the cash wallet, which excludes the open option book; a premium books as a loss on the buy day and the payout as a gain on the close day. The debug session reproduced one 2025 three-day shape to the third decimal with the repo's own `chain_linked_twr` under B. B is ruled out for open positions today, not for 2025.
- The debug session's first round eliminated A for two days on the reasoning that a net withdrawal larger than the prior wallet meant no deposit that day. Its second round retracted that: a morning deposit offset by a larger evening withdrawal is invisible in the stored, netted chain. Planning must not reuse the round-1 elimination.

## The re-crawl (SC-1)

- The debug session's scratch script `r11.py` (untracked, in the orchestrator's session scratchpad under `dbg/`). It runs from the analytics-service root inside the worker container, `timeout 600 python -I -u r11.py`, with a 540 s internal budget.
- Read-only by construction: Supabase SELECTs on `api_keys`, `csv_daily_returns`, `allocator_equity_derived`; Deribit `private/get_transaction_log` and public index/delivery reads. No insert, update, upsert, rpc or enqueue.
- Per day it prints the flow rows by sign and currency with their instants, the cash-bearing rows by type, the max intraday capital over the prior close, the share of the day's P&L booked after a same-day inflow, and `r_split_at_flows` against the stored return.
- **A is confirmed** when big days show a same-day in-and-out or an inflow before the first P&L, the max intraday capital is far above the prior close, and `r_split_at_flows` is far below the stored return. Offline, the synthetic day prints 3.0 stored against 0.30 split, with max intraday capital 13× the prior close.
- ⚠️ The script lives only in a session scratchpad and is not in the repo. If it is gone when plan 01 runs, it must be rebuilt from the description above before the run, and it may not be committed while it carries key tags.

## Success Criteria (copied from the ROADMAP)
⛔ **CORRECTED 2026-11-01 (D-04):** the ROADMAP's criteria 2 to 5 were rewritten for mechanism B. The live text is in the ROADMAP `### Phase 185` entry, and the copy below is the booking text, kept as lineage. Criterion 1 is met: verdict B.

1. The read-only re-crawl (the debug session's scratch script; counts and ratios only) runs in the worker for the big days of keys A and C and settles mechanism A against mechanism B. The verdict is recorded before any code change. If it is B, the phase replans.
2. Each Deribit flow's instant is stored, and a day with a flow is split at the flow, using the timed-day machinery FLOWTIMING built for MT5, so the day's return is measured against the capital in the account at the time. A start-of-day or Modified Dietz rule is not used: it makes withdrawal days worse.
3. Until it ships, the affected books carry a named caveat (the existing large-flow-day label, `flow_timing_day_level_large`, reaching key mode) rather than a silent number.
4. After deploy, a PROD reading shows the founder's book has no day with |r| > 50% that the re-crawl attributes to intraday capital, and the recomputed cumulative numbers are reported to the founder.
5. Tests go RED on the current day-level rule. Never invent data: an uncomputable day is null.

</specifics>

<deferred>
## Deferred / Related

- 164.6.6.2.3 FLOWTIMING: its deferral `[164.6.6.2.3-DERIBIT-INTRADAY-TIMING]` asks for Deribit P&L attributed to positions. This phase answers it for flow days by splitting at flow instants; position attribution itself is not in scope, and the TODOS entry is narrowed, not closed, unless research shows otherwise.
- 167.2.1.1.1 NAVMTM and 177 DERIBITFLOWS: marked days (2026-10 onward) already place a flow by its instant on the marks seam. This phase must not double-place a flow on a marked day.
- Mechanism B (cash-basis option accounting in key mode) is not fixed here. If the re-crawl shows B on any big day, the phase replans (SC-1).
- SC-1 and SC-4 are run by the orchestrator only, never by a dispatched executor.

</deferred>

<open_questions>
## Open questions for the founder
⛔ **CORRECTED 2026-11-01 (D-04):** questions 1, 4 and 5 below are about the flow split, which is dropped. Question 5 is answered by D-04: a replan. Questions 2 (caveat wording and placement) and 3 (recompute timing) still apply to the options fix. The replan's research lists its own founder questions.

None of these is decided here. Each needs a founder answer before the plan that depends on it executes.

1. **A flow day with an unpriced or untimed flow.** If a Deribit flow day has a flow whose instant or USD value cannot be resolved, does that day's return become null (never invent data), or does it keep today's day-level number with the large-flow label? A null day breaks the chain-linked curve at that point; the label keeps a number on screen that this phase says is wrong.
2. **The interim caveat's wording and placement.** SC-3 names the label, `flow_timing_day_level_large`, reaching key mode. Where it shows on /allocations (book header, the curve, per key, or all three) and what sentence it reads are product calls. So is whether it is removed per book once that book's curve is recomputed, or only when the phase ships.
3. **Recompute timing for past curves.** Once the split ships, are all past Deribit key-mode curves recomputed at once (a one-off re-derive of every affected book), or do they recompute on their next scheduled derive? This decides when the founder's book stops showing the old numbers, and whether SC-4's reading waits for the next nightly run.
4. **Scope of the recompute.** The evidence covers 5 Deribit keys across 3 books. Does the fix apply to every Deribit key (strategy mode and key mode alike), or only to key mode, where the defect was measured?
5. **If the verdict is mixed.** If the re-crawl shows A on some big days and B on others, does the phase ship the A fix and book B separately, or replan as a whole (SC-1 says replan on B; it does not say what happens on a mix)?

</open_questions>
