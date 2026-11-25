# Phase 233: DERIBITTRUTH — a Deribit key's returns reach its newest flow, every book day is explained or withheld, and stale series page on every venue - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Requirements: FRESH-01, FRESH-02, DBOOK-01, DBOOK-02. TODOS entries this phase closes: `[185-BOOK-CUMULATIVE-UNEXPLAINED]` (DBOOK-01) and the `Deribit correction residual` bullet under "Money-path correctness" (DBOOK-02, the `L2219` item).

The wave-0 Deribit diagnosis ran inside this phase, read-only, on 2026-11-24: `.planning/debug/deribit-stale-returns.md`. Its verdict: the account whose stored returns end 2026-10-26 is Phase 188's key C. A withdrawal of about 99.6% on 2026-10-26 put every later day under the tiny-base rule (188 D-02, D-03, D-08). The derive states each left-out day in `key_inputs.tiny_base_days` and its P&L in `dropped_day_pnl`. The series is held by a founder decision and is not stale. What is missing is a reader that treats a stated leave-out as a named reason. An independent recompute in SQL names exactly 2026-10-27..2026-11-23, and the first countable day is 2026-11-25.

In scope:
- FRESH-01: the diagnosis, plus the 2026-11-26 PROD confirmation reading, plus FRESH-02 accepting the derive's stated left-out days.
- FRESH-02: a fifth prod-prober arm, `freshness`.
- DBOOK-01: an independent per-day attribution oracle for the founder's Deribit book.
- DBOOK-02: the Deribit correction classifier, with one fixture per correction shape.

Out of scope:
- Any change to the derive writer (`run_derive_broker_dailies_job`, seam S1).
- Any change to the compose (`allocator_equity_derive.py`, seam S2).
- Any change to `ops_staleness_check()` (seam S5).
- Any backfill.
- Any migration. None is expected. If one appears, stop and tell the coordinator before opening a PR.

</domain>

<decisions>
## Implementation Decisions

### FRESH-01: the diagnosis verdict (founder ruling 2026-11-24, Q1, "recommended")
- No writer change and no backfill. FRESH-01 is three things together:
  - the diagnosis record `.planning/debug/deribit-stale-returns.md`;
  - the 2026-11-26 PROD confirmation reading: 2026-11-25 is the first counted day on the three logins, and no rows exist for 2026-10-27..2026-11-24;
  - FRESH-02 accepting the derive's stated left-out days as a named reason.
- **Reversibility:** costly. Making the series reach its newest flow would overturn Phase 188 D-02 and D-08, which are founder decisions.
- The 155.2 freeze condition does not apply. No shared key-mode exit changes, so no MM2, MM3 or FX-AI_V figure moves. Candidate cause (a), the `<2-day` key-mode exit, is eliminated: each key stores 1155 rows, so the derive takes the `>=2` path.
- The ROADMAP's success criterion 1 wording ("The diagnosis names the cause, and the fix lands at it") is read through this ruling. The cause is the missing reader, and the fix lands in FRESH-02's arm. A dated deviation note records this in ROADMAP.

### Compose `out_of_window_flow` on a left-out tail day (founder ruling 2026-11-24, Q2, "recommended")
- 233 does not touch S2. For this account the flag clears by itself once 2026-11-25 has a stored return, because the 2026-11-09 flow is then inside the window.
- The general case goes to Phase 234 NOCAPITAL's scope, with a dated note in the ROADMAP: a flow dated on a stated left-out tail day, after the key's last stored return, is counted as `out_of_window_flow`.
- **Reversibility:** costly, because S2 is owned by 234, and touching it out of order breaks the seam rule.

### FRESH-02: where the check lives and what it accepts (founder ruling 2026-11-24, Q3, "recommended")
- **Where it lives.** A fifth arm, `freshness`, in `scripts/prod-prober/`.
  - It runs in the prober's own workflow, `.github/workflows/prod-prober.yml`. That workflow is outside `ci.yml` and outside the `frontend` aggregator, so the check never blocks CI.
  - It reads PROD read-only.
  - It pages through the prober's existing incident path (`incident.mjs`: a new GitHub issue per incident, which emails a human).
  - It has a RED held-back fixture in the prober's self-test.
  - `ARMS_FLOOR` goes from 4 to 5.
  - **Reversibility:** costly. The census pins, the floor and the workflow header all move together. This choice keeps S5 untouched, so v1.23's 242 and 246 do not re-base on 233, and Phase 238 PR-2 is not held behind a 233 migration.
- **The check rule, as stated to the founder and accepted.**
  - Scope: a "daily-derived key" is one with a `derive_broker_dailies` job in recent nights. Revoked keys that are no longer derived drop out.
  - The comparison is the key's newest stored return day (`csv_daily_returns`, key mode) against max(newest flow day, realized terminal or NAV-mark day) from its `key_inputs`.
  - A key pages when that gap exceeds the stated bound, unless one of two named reasons covers it:
    - (1) every day of the gap is in `key_inputs.tiny_base_days`; or
    - (2) the key carries `anchor_null_reason`.
  - No other reason is accepted. A reason that exists but does not cover the gap day by day does not count.
- Today's PROD reading under this rule is clean: 0 uncovered days on every key, as recorded in the diagnosis census. So the check is GREEN on PROD and RED only on the held-back fixture.

### DBOOK-01: the attribution oracle (founder ruling 2026-11-24, Q4, option (a))
- **What it is.** An independent per-day attribution oracle that imports no production helper. It recomputes each stored book return for the founder's Deribit book from the stored per-key booked P&L, flows and levels in `key_inputs`.
- **Which days are withheld.** A day the oracle cannot reproduce, or a day with no stored base level, is withheld under a reason name. The reason names are a closed set, and the book's existing flags (`missing_return_inside_coverage`, `skipped_nonpositive_denominator`, `emptied_stretch`) are candidates.
- **Capital outside the base.** Days whose base is known to exclude capital at work (open options on a cash basis, flow-adjacent days) are named in the reading but not nulled. The published history does not change on that basis.
- **No plausibility bound** (Phase 194 D-05). The close is an attribution reading, not a tolerance.
- **Reversibility:** costly. The oracle and its withhold names become the book's published explanation.
- **Measured 2026-11-24, for scale.** Book A compounds x3270 over its whole history, and x298 without its 6 days above 30%. 2025 dominates: key B gives x44 over its 255 days as the dominant key (x5.9 without its 5 big days), and key D gives x31 over 56 days with no day above 30%.

### DBOOK-02: the correction classifier (decided by the phase agent, accepted by the founder 2026-11-24)
- A correction is trading only when its reason has a structural trading shape that names an instrument, as the one observed reason does (`<date> BTC-PERPETUAL funding calculation correction`). Matching a trading word is not enough. Every other correction fails loud through `assert_correction_classifiable`.
- One fixture per correction shape, including a capital reason that carries a trading token and no capital word (for example "funding account correction").

### Decided autonomously
- [FRESH-02] Q: "What is the stated bound?" → Selected: "2 calendar days, declared once as a named constant in the arm" — the nightly derive marks the previous UTC day, so a healthy key trails by at most 1; the constant is one line to change.
- [FRESH-02] Q: "Does the arm also cover strategy-mode series?" → Selected: "The planner measures whether strategy-mode series carry an equivalent stated-days field. If they do, include them under the same two reasons; if not, record the gap and route it" — reversible arm logic, no stored contract.
- [DBOOK-01] Q: "Where does the oracle live?" → Selected: "an analytics-service script or test module with its own arithmetic, run against a PROD reading for the SUMMARY and against fixtures in pytest" — a file that is cheap to move.
- [DBOOK-02] Q: "Does the structural shape read `instrument_name` or the reason text?" → Selected: "either an instrument token in the reason or a non-null row `instrument_name`; the capital denylist keeps precedence" — local to one pure function.
- [PROOF-01] Q: "How is each gate shown RED?" → Selected: "neuter the named arm, record the RED line, restore from a byte backup (`cp`, then `cmp`), record the GREEN line, all verbatim in the plan SUMMARY" — the milestone rule, no choice involved.

### Decided at the plan 233-07 checkpoint
- [DBOOK-01] (founder, AskUserQuestion 2026-11-25, verbatim answer "Accept (Recommended)") The plan 233-07 PROD re-reading of book A read STOP with 114 published days withheld, every one structural: `no_stored_base_level` 110 days (2026-08-03 to 2026-11-22, k5 with no stored basis), `key_set_not_reproducible` 3 days on declared departure boundaries, `key_basis_not_reproducible` 1 day. Decision: accept. The 114 days stay published and are named withheld in the reading, and DBOOK-01 closes as a reading. No seam S2 change is booked. The ship PR deletes `TODOS.md` `[185-BOOK-CUMULATIVE-UNEXPLAINED]`.
  - **Reversibility:** cheap. Stopping publication of those days would be a seam S2 change for Phase 234, and nothing in this decision blocks it.

### Claude's Discretion
- How the prober arm reads PROD. Match the existing arms (`cron-obs`, `cron-drift`), so no new credential is introduced.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/prod-prober/run.mjs`: the arm registry, `ARMS_FLOOR` and the self-test with fixtures; `scripts/prod-prober/arms/*.mjs` (four arms); `scripts/prod-prober/fixtures/<arm>/`; `incident.mjs`.
- `analytics-service/services/deribit_txn.py`: `correction_is_trading`, `assert_correction_classifiable`, `_CORRECTION_CAPITAL_REASON_KEYWORDS`, `_CORRECTION_TRADING_REASON_KEYWORDS`; tests in `analytics-service/tests/test_deribit_txn.py`.
- `analytics-service/services/tiny_base.py`: the rule's constants (`TINY_BASE_FRACTION`, `TINY_BASE_WINDOW_DAYS`). The freshness arm reads the stored day list and does not recompute the rule.
- `allocator_equity_derived` rows: kind `key_inputs:<key>` (flows, composed_flows, composed_day_pnl, dropped_day_pnl, tiny_base_days, realized_terminal_day/usd, nav_mark, anchor_null_reason) and kind `equity_curve` (returns, flags, degrade_reasons).

### Established Patterns
- Prober: every arm runs every time; an absent credential is a hard failure, never a skip; it never prints a value; the exit code is decided once at the end.
- Money-math oracles import no production helper (PROOF-01).
- Census pins are exact sets, run in both directions and derived from their source of truth.

### Integration Points
- `.github/workflows/prod-prober.yml` header and its arm list; `ARMS_FLOOR` and its pin test; the critical-regressions and invariant suites that read the prober registry.

</code_context>

<specifics>
## Specific Ideas

- The diagnosis's per-key census query (in `.planning/debug/deribit-stale-returns.md`, Evidence) is the shape of the freshness arm's reading.
- The 2026-11-26 reading must use letters for keys and books in tracked text, never PROD ids.

</specifics>

<deferred>
## Deferred Ideas

- The compose counting a flow on a stated left-out tail day as `out_of_window_flow` goes to Phase 234 NOCAPITAL (seam S2), per the founder ruling on Q2.
- Nulling capital-outside-base days (options on a cash basis, flow-adjacent days): not chosen (DBOOK-01 options (b) and (c)). They are named in the reading only.

</deferred>
