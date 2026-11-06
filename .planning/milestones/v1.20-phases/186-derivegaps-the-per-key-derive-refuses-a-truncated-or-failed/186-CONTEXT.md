# Phase 186: DERIVEGAPS - Context

**Gathered:** 2026-11-03
**Status:** Ready for planning

<domain>
## Phase Boundary

The per-key `derive_broker_dailies` path plus the allocator compose is the only curve path left; Phase 176 LEGACYRETIRE deleted the legacy engine (closed 2026-11-03, #1188). This phase gives that path the protections the legacy engine had:

1. A truncated or failed realized or funding read never publishes as complete (Gap 1).
2. The Bybit derive counts Unified internal, sub-account and universal transfers as flows (Gap 2).
3. A failing key affects only itself in the book (Gap 3).
4. A second funding leg in the same hour is not dropped (Gap 4, only if the PROD count finds any).

The four gaps, their evidence and the seven success criteria are in the `### Phase 186` entry of `.planning/ROADMAP.md`. Read that entry first. It is the scope anchor, and this file does not restate it.

</domain>

<decisions>
## Implementation Decisions

### Carried from the booking (founder 2026-11-01, ROADMAP `### Phase 186` "Booking")
- **D-01 — One fix phase for Gaps 1+2.** "Book one fix phase (Recommended)". Each gap starts with a read-only PROD count of the keys it affects (SC-1).
- **D-02 — Bybit internal transfers are flows.** This reverses BYBITFUNDING 180 D-02. Wire in the existing reader `fetch_bybit_unified_flows`; do not write a new one.
- **D-03 — A failing key affects only itself.** "Only that key (Recommended)". This reverses 167.1.2.1.1 D-03 and applies the founder rule of 2026-10-28 (a dead key affects only itself).
- **D-04 — Gap 4: count first.** "Add to 186 DERIVEGAPS (Recommended)". First run a read-only count of same-hour funding pairs per (instrument, hour) on OKX and Bybit. Fix the dedup key only if pairs exist.

### Decided in this discussion (founder 2026-11-03, AskUserQuestion)
- **D-05 — Bad read: hold last good, name it.** Question: "When a key's realized or funding read comes back truncated or failed, what should that key's curve show?" Answer: "Hold last good, name it (Recommended)": "The run writes nothing for that key. Its last good stored days stay as they are, and the key is marked 'read incomplete' by name. Same behaviour as the trade sync today. Nothing partial is ever published." — **Reversibility:** reversible.
- **D-06 — Read caps: page to the end, refuse if still short.** Question: "The derive caps how many pages it reads (OKX 100 pages per instType, Bybit 50 per week). What happens on a key that hits a cap?" Answer: "Page to the end, refuse if still short (Recommended)": "Raise the caps so a normal key reads its full history within the existing crawl time budget. Only a key that is still truncated after that is refused by name. The PROD count (SC-1) comes first and sizes the new caps." — **Reversibility:** reversible.
- **D-07 — Failing key: leaves the book that day.** Question: "A key in the book starts failing (error, sign-in failed, revoked) and its series stops. How should the book treat it?" Answer: "Leaves the book that day (Recommended)": "The key's history counts up to its last good day. From then on its capital is treated as leaving the book (a flow, not a loss or a gain). The rest of the curve draws normally and stays trustworthy, and the readers name the key. Replaces the flat r=0 carry that currently marks the whole curve untrustworthy." — **Reversibility:** costly — `FAILING_KEY_SERIES_ENDED` and the `COMPOSE_INCOMPLETE` refusal are read by the reader copy, the refusal rows and existing tests.

- **D-08 — Failing keys with inputs but no returns leave the book, named.** Founder 2026-11-03, AskUserQuestion (after planning). Question: "Some failing keys have inputs but no returns at all (today they block the whole book as 'dropped_key'). How should they be treated under your 'a failing key affects only itself' rule?" Answer: "Leave the book, named (Recommended)". The option text: "Same as other failing keys (D-07): the key is left out of the book and named, so the rest of the book draws normally. A key with no returns at all has no history to keep, so it simply isn't counted." This is plan 11's treatment.
- **D-09 — Probe runs approved.** Founder 2026-11-03, AskUserQuestion. Question: "Plan 04 runs a read-only probe of the venue APIs from the worker (OKX/Bybit page counts, Bybit Unified transfers, same-hour funding pairs) once the tooling PR is deployed. Plan 14 reruns it after the fix deploys. Approve both runs now?" Answer: "Approve both runs (Recommended)". The option text: "Read-only calls to the exchanges with the stored keys; nothing is written to the venues or to PROD data except the probe's own recorded counts. No Railway start-command change." Plans 04 and 14 do not ask again. A start-command change is not covered by this approval.

### Decided at the SC-1 gate (founder 2026-11-03, AskUserQuestion)

- **D-10 — Bybit closed-pnl limit set to 100; proceed without re-measuring.** Question: "186: the probe asked Bybit for 200 rows and for 100 rows of closed P&L on the one Bybit key; both came back with exactly 100. That almost certainly means Bybit caps a page at 100, so the derive's 'limit 200' is silently read as 100 (pagination still fetches everything). The plan's rule calls equal counts 'no evidence' and says re-measure. What should happen?" Answer: "Set 100 and proceed (Recommended)". The option text: "The derive sends limit 100, matching what Bybit actually returns; no data changes, pages are just labelled honestly. 186 continues to the fix plans now. Deviates from the plan's literal re-measure rule, recorded as your decision." Plan 186-05 sets `BYBIT_CLOSED_PNL_LIMIT` to 100 and keeps today's caps. — **Reversibility:** reversible (one module constant).

### Decided at the round-2 review (founder 2026-11-04, AskUserQuestion)

- **D-11 — A refused derive over a strategy that already has figures keeps the figures and the status.** Question: "186: when Sync now hits an incomplete exchange read on a strategy that already has figures, the worker keeps the figures and shows your approved sentence (\"…these numbers stay at the last complete read\"). The status updater that runs after it then marks the strategy 'failed', so the page reads \"Analytics computation failed: …these numbers stay…\". It should keep the figures, so which way do we fix it?" Answer: "Keep figures, fix updater (Recommended)". The option text: "A small migration makes the status updater treat this refusal as protected, the same way it already treats a ledger refresh. The strategy keeps its figures and its status, and shows your sentence. This widens an earlier rule (D-15) by one case. Reviewed by the migration and RLS checkers before merge." — **Reversibility:** costly (migration).
- **D-12 — A malformed realized row is flagged, not refused.** Question: "186: a single malformed row in an account's exchange trade history now refuses that whole key every day (the bad row is re-read daily, and OKX reads back to the account's start). No one has counted how many production keys have such a row. What should a malformed row do?" Answer: "Flag it, don't refuse (Recommended)". The option text: "The key keeps publishing, as it does today. The dropped row is recorded as a data-quality flag rather than only a log line, and a TODO books a production count. Refusing can be switched on later once the count shows it is safe." — **Reversibility:** reversible.

### Decided at the post-round-3 review (founder 2026-11-04, AskUserQuestion)

- **D-13 — One narrow fix round 4, a one-time exception to the 3-round fix cap.** Context: the post-round-3 review found PR3-01, a regression the round-3 fix (R3-02, the marker on the failing job) introduced: a marker written by a retryable refusal survives into the job's final failure and leaves a bounced `complete` row at `computing` with nothing in flight. The cap is three fix rounds. Answer: "One narrow round 4 (Recommended)". The option text: "One exception to the cap, only for the regression round 3 introduced. Write the marker only when the refusal is final, and let the bridge return the status for a marked job without its sentence. Add one SQL arm and one Python test, then re-review just that diff. Fixing it now costs less than a follow-up migration after PROD has it. The race goes to a follow-up phase; the name test is booked as a TODO." Round 4 touches PR3-01 and nothing else. The retraction read-modify-write race is booked as `[186-REFUSAL-MARKER-RMW-RACE]` for a follow-up phase to be booked after 186 ships, and the missing name-contract test as `[186-REFUSAL-MARKER-NAME-CONTRACT]`. — **Reversibility:** costly once merged (the migration auto-applies to PROD); the edit is in place because the migration has not shipped.

### Decided at the post-round-4 review (founder 2026-11-04, AskUserQuestion)

- **D-14 — One-line fix round 5, the second and last exception to the 3-round fix cap.** Context: the round-4 review found R4-01, a regression the round-4 fix (PR3-01, no marker on a retryable refusal) introduced: on a warned (`complete_with_warnings`) row a retryable refusal's "these numbers stay" sentence survives into the job's final non-refusal failure, and the bridge keeps it over `failed`. Answer: "One-line round 5 (Recommended)". The option text: "Second and last exception to the cap: only that condition plus the flipped test, then re-review only that diff. If anything else surfaces, ship and route it to the follow-up phase, with no further rounds." This is the second and last exception to the fix-round cap (the first is D-13). Round 5 touches R4-01 and nothing else: in `_refuse_incomplete_read`, a retryable refusal over published figures writes nothing to the `strategy_analytics` row (no sentence, no provenance), so the retry decides alone; a final refusal keeps today's behaviour (marker, then sentence). No SQL change. — **Reversibility:** cheap (one worker condition); the migration is untouched.

### Claude's Discretion
- The exact new page caps, sized from the SC-1 count within `_BROKER_CRAWL_TIMEOUT_S` (D-06).
- How the "read incomplete" name reaches the readers: reuse an existing reader line where one fits (167.1.2.1.1 D-04, "no new copy"). If none fits, the UI copy needs a DESIGN.md check.
- Whether the failing-key exit reuses the existing departed-key path (`departed_end_by_key`) or adds a sibling to it.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and evidence
- `.planning/ROADMAP.md` `### Phase 186` — the four gaps, the evidence, the booking answers and SC-1..SC-7.

### Decisions being reversed
- `.planning/phases/180-*/180-CONTEXT.md` D-02 (Bybit on-chain flows only), reversed by D-02.
- `.planning/phases/167.1.2.1.1-*/*-CONTEXT.md` D-03 (failing key blocks the curve), reversed by D-03/D-07. Its D-04 ("no new copy") still holds.

### Related phases
- 171 READCEILING, 172 (anchor/tolerance rules), 176 LEGACYRETIRE (closed; deleted the legacy engine), 184 (OKX refusal debug that found Gap 4).

</canonical_refs>

<code_context>
## Existing Code Insights

All paths are under `analytics-service/services/`. Cite symbols, not line numbers.

### Reusable Assets
- `bybit_unified_flows.fetch_bybit_unified_flows`: the ready Unified/sub-account/universal transfer reader (Gap 2).
- `exchange.get_and_clear_last_dq_flags`: `sync_trades` already consumes it and refuses on truncation flags, which is the model for D-05. `run_derive_broker_dailies_job` (`job_worker.py`) never calls it.
- `allocator_equity_derive.working_holder_predicate` and the departed-key handling (`departed_end_by_key` in `job_worker.py`) are the existing "key leaves the book" machinery (D-07).

### Established Patterns
- Caps: `OKX_BILLS_PAGE_CAP`, `OKX_ARCHIVE_PAGE_CAP` and `BYBIT_PNL_PAGE_CAP` are local constants in `exchange.fetch_daily_pnl`. The DQ flags are `daily_pnl_truncated_okx`, `daily_pnl_truncated_bybit` and `daily_pnl_fetch_error`.
- `DegradeReason` and `_BLOCKING_REASONS` in `allocator_equity_derive.py`. `FAILING_KEY_SERIES_ENDED` is blocking today; D-07 replaces that path.
- Gap 4: the dedup key is `funding_fetch._build_match_key` (no `posSide`, `mgnMode` or `billId`).

### Integration Points
- `job_worker.run_derive_broker_dailies_job` (per key) and the allocator compose in `job_worker.py` (the `failing_series_ended_keys` block).
- PROD reads run from the main checkout, because the worktree has no `supabase/.temp` link. Run the marker query first.

</code_context>

<specifics>
## Specific Ideas

- Order: the SC-1 counts (Gaps 1-4) come before any code change.
- Tests must go RED on today's behaviour for each gap (SC-2, SC-3, SC-4, SC-7).
- Never invent data: an uncomputable day is null (SC-6).

</specifics>

<deferred>
## Deferred Ideas

- Bybit P&L depth is 365 days in the new path against 730 in the legacy engine. That is less history, not wrong history; recorded for the founder in the booking and not in scope.
- The Bybit closed-pnl `limit: 200` against a possible venue max of 100 is a probe inside Gap 1, not a separate phase.

</deferred>

---

*Phase: 186-derivegaps*
*Context gathered: 2026-11-03*
