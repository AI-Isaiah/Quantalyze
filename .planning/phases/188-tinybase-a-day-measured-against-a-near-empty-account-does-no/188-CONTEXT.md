# Phase 188: TINYBASE - Context

**Gathered:** 2026-11-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix a day whose return is measured against a base that is a small fraction of the account's recent capital, as happens after a near-total withdrawal. That day no longer reads as the strategy's performance on the equity curve or in the stats. The rule applies on every venue and never invents a value.

The evidence (Deribit key C, 2026-10-27 and 2026-10-28) and SC-1..SC-5 are in the `### Phase 188` entry of `.planning/ROADMAP.md`. Read that entry first; it is the scope anchor.

</domain>

<decisions>
## Implementation Decisions

### Booking (founder 2026-11-01, Phase 185 plan 03, question F7)
- **D-01 — Book a fix phase.** "Book a fix phase", chosen over the recommendation "Accept as real (Recommended)". The returns are correct arithmetic on a tiny base. The founder does not want them read as performance.

### Decided in this discussion (founder 2026-11-03, AskUserQuestion)
- **D-02 — Leave out, show the day flagged.** Question: "Key C's +47% and -53% days are real moves on about 0.4% of the account left after a near-total withdrawal. How should a day measured against such a tiny base be treated?" Answer: "Leave out, show the day flagged (Recommended)": "The day's return is null: it is not chained into the equity curve and not counted in the stats (return, volatility, drawdown, Sharpe). The day still shows on the chart as a flagged gap with a short note that the account was nearly empty. Nothing is invented." — **Reversibility:** reversible.
- **D-03 — Threshold: under 5% of the 30-day peak.** Question: "What counts as a 'tiny base'?" Answer: "Under 5% of the 30-day peak (Recommended)": "A day whose starting NAV is under 5% of the account's highest NAV over the previous 30 days. Key C (about 0.4%) is caught. A key that stays small becomes its own new normal once the peak leaves the 30-day window, so its days count again from then on." — **Reversibility:** reversible.

### Decided after planning (founder 2026-11-03, AskUserQuestion)
- **D-04 — A-OQ1, split by era.** Question: "When a near-empty day is left out, what happens to the strategy's headline numbers (return, CAGR, volatility, Sharpe, drawdown)?" Answer: "Split by era (Recommended)". The option text: "Before a key's first daily mark (the older history): a left-out day breaks the chain, so the headline restarts from the day after the last tiny day, as an account that was emptied and refunded. From the first mark on: the day is just skipped and the history before it stays."
- **D-05 — A-OQ2, zero NAV is not in the rule.** Question: "Do days that start from a NAV of zero or below (an emptied account) fall under the rule? About 233 such key-days exist on PROD, all flat." Answer: "No, leave them as today (Recommended)". The option text: "A zero-base day has no return to compute and already stores flat; only a tiny positive base is the problem."
- **D-06 — A-OQ3, note only.** Question: "Your D-02 said the left-out day shows 'as a flagged gap with a short note'. Today the My Allocation book chart and single-key strategy charts draw no gap markers at all. What should they show?" Answer: "Note only (Recommended)". The option text: "A short muted note under the chart naming the near-empty days; the chart line itself is unchanged. Composite charts keep their existing 'no data' gap marker." This narrows D-02's "flagged gap".
- **D-07 — A-KL1, fix the scenario readers in 188.** Question: "The What-if/scenario panels on /allocations (Overview KPIs, scenario composer, KPI strip, equity/drawdown charts) compute the book live and would treat a left-out day as flat (0%). The stored book and factsheets are correct. Fix those too?" Answer: "Fix them in 188 (Recommended)". The option text: "One extra plan after plan 08 that changes every live-book scenario reader together, so all panels on the screen agree with the stored book."
- **D-08 — A-QD, quiet days are left out too.** Question: "On a near-empty account, a day with no trades, funding or flows is stored today as a filled-in 0% day. Should those quiet days also be left out (null) while the account is under 5% of its 30-day peak?" Answer: "Yes, leave them out too (Recommended)". The option text: "Every calendar day under the threshold is treated the same, active or quiet." Plan 04 stays.

- **D-09 — BTC-unit accounts follow the new rule; 164.6.6.2 D-25 is superseded for days under the threshold.** Founder 2026-11-03, AskUserQuestion, at plan 02's designed STOP. Plan 02's rule failed 4 tests in `analytics-service/tests/test_mt5_deal_reconstruction.py` that encode 164.6.6.2 D-25: "a day measured on a tiny base ... is kept exact AND flagged ... never breaks the chain and never drops the day". Question: "Phase 188 conflicts with your earlier BTC rule (164.6.6.2 D-24/D-25: a BTC-denominated account's small-balance day is measured exactly and only flagged 'small_base_measured'). 188's new rule (under 5% of the 30-day peak is left out) would now leave those same days out. Which rule wins for BTC-unit accounts?" Answer: "New rule everywhere (Recommended)". The option text: "188 is the newer decision and its success criteria say 'every venue'. BTC-unit accounts follow it too: those days are left out and named in the note. D-24/D-25 get a dated superseded note in their CONTEXT and the ROADMAP; the 4 tests are updated to the new rule." D-24's 1e-7 BTC measurement floor is unchanged. D-25 still applies to a small-balance day that is NOT under 5% of its 30-day peak.

### Decided at the SC-4 reading (founder 2026-11-05, AskUserQuestion)
- **D-10 — Substitute SC-4 reading (deviation from plan 11).** Plan 11 Task 1's pre-merge baseline was never taken: PR #1196 merged without it, and the re-derives since then overwrote the state it needed. Question: how to read SC-4 without it. Answer: "Substitute reading (Recommended)". The substitute checks (a) key C's 2026-10-27 and 2026-10-28 have no stored rows, (b) each key's `key_inputs.tiny_base_days` against the rule recomputed independently from the stored inputs, (c) no stored row on a day the rule names, (d) key C's `sc4-scenario` line. **Limit:** without the baseline it cannot prove that no other book's figures changed except on the named days, or that no key-day appeared. **Result (2026-11-05, `188-11-SUMMARY.md`):** not confirmed. Key C's two rows are still stored, 24 rows sit on named days across three keys, 233 stated days are not reproduced, and three books read untrustworthy with `key_inputs_mismatch`. Routed to the founder at a checkpoint.
- **D-11 — Gap closure, and how the emptied-stretch days are checked (founder 2026-11-05).** After the failed reading the founder chose "Gap closure in 188 (Recommended)" over routing to a follow-up phase. `188-VERIFICATION.md` (gaps_found) confirmed the cause in code: the reconcile delete covers only the span of days still measured, so tiny days at the series' edge keep the rows an earlier derive stored there. That also explains the three `key_inputs_mismatch` books. On the 191 stated days inside 167.1.2.2.1 emptied stretches (the derive judges the raw sliver, the recompute sees level 0), the answer was "Keep, re-check on derive basis (Recommended)": the derive's naming stands, and the re-reading recomputes those keys on the derive's own raw-sliver basis. The 42 MT5 days with no anchor stay unchecked, and the reading says so. The re-reading takes a baseline before the fix ships (VERIFICATION gap 5).
- **D-12 — KL-5 fixed here (founder 2026-11-05).** `188-REVIEW.md` WR-02 had left it undecided. A strategy leg in the composer or a shared scenario 0-fills a day its stored series lacks, which invents a flat day on exactly the days 188 leaves out. Answer: "Fix in 188 gap closure (Recommended)", with a RED test. **Correction 2026-11-05 (gap planning):** the KL-5 wiring had already shipped in #1196 (commits `58b228d00`, `fe05c62b1`, `83ad5065d`). `188-VERIFICATION.md` read KL-5 from the plan 09 and 10 summaries, which predate those fixes. So plan 188-14 proves the fix site by site with a neuter drill per strategy-leg site and adds a RED test wherever a drill stays green, rather than rebuilding it. D-12 stands as decided.
- **D-13 — deviation (founder 2026-11-06):** close 188 on what passed; the rest moves to the next milestone. The SC-4 re-reading against the pre-merge baseline (188-16) read NOT CONFIRMED under its strict rule.

What passed:
- no scope stores a row on a stated day (24 → 0);
- key C's 2026-10-27/28 rows are absent;
- `key_inputs_mismatch` cleared from every book (b2 and b7 are trustworthy again);
- every emptied-stretch key is explained on the derive's own basis.

What did not:
- 1214 stored values changed between the two nightlies, mostly on scopes with no stated days and outside the fix's code path, moving four books' curves by up to 6.1e-5 relative;
- book b3 stays untrustworthy for reasons it already carried (`out_of_window_flow`, `window_truncated`).

The founder first chose "Control capture first", then on the same day said "move the rest of 188 into the next milestone, and close it". So SC-4's residual goes to a follow-up phase booked in the next milestone: the unexplained value churn, measured by a control capture across a nightly with no deploy between, and b3's earlier reasons. 188 closes on the defect it owned.

### Claude's Discretion
- Where the rule lives: the per-key derive, the compose, or both. SC-2 requires that the derive and the reader both follow it on every venue.
- The flag's name, and whether an existing degrade or caveat line can carry the note (prefer reuse, as in 167.1.2.1.1 D-04 "no new copy"). Any new UI copy needs a DESIGN.md check.
- How a book with several keys weights an excluded key-day. The rule is per key's base; the planner must state what the book does on that day without inventing a return.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/ROADMAP.md` `### Phase 188`: evidence, SC-1..SC-5.
- `.planning/phases/185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t/185-03-SUMMARY.md`: the PROD reading of key C (key letters only).
- `.planning/phases/185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t/185-CONTEXT.md`: D-11 (this phase's booking question).
- Phase 172: the anchor and tolerance rules.
- `DESIGN.md`: for any chart note or flag copy.

</canonical_refs>

<code_context>
## Existing Code Insights

All paths are under `analytics-service/services/`. Cite symbols, not line numbers.
- `allocator_equity_derive.py`: `DegradeReason` and `_BLOCKING_REASONS`, the existing set of curve degrade tokens.
- `allocator_equity_compose.py`: the chaining of key dailies into the book curve.
- `job_worker.py`: `run_derive_broker_dailies_job` (per key) and the allocator compose.
- Phase 186 DERIVEGAPS is in flight on the same files (branch feat/186-derivegaps). Plan so the two branches can merge in either order.
- PROD reads run from the main checkout, which has the `supabase/.temp` link; the marker query comes first.

</code_context>

<specifics>
## Specific Ideas

- Tests go RED on today's behaviour for key C's 2026-10-27 and 2026-10-28 shape (SC-3).
- The post-deploy PROD reading names every day the rule changed across all books (SC-4).

</specifics>

<deferred>
## Deferred Ideas

None.

</deferred>

---

*Phase: 188-tinybase*
*Context gathered: 2026-11-03*
