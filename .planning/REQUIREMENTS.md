# Requirements: Quantalyze, milestone v1.18 MT5-VERIFY & founder confirmations

**Defined:** 2026-11-13 (resumed from the 2026-08-14 parked milestone; MT5-06..10, MT5-15 and MT5-GOAL-01 carried verbatim in intent from `milestones/v1.16-REQUIREMENTS.md` and `milestones/v1.17-REQUIREMENTS.md`, restated where research at HEAD proved the August wording stale)
**Core Value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked, and can model the impact of composition changes before they make them.

**Accounts in scope (founder 2026-11-13):** MM2, MM3, FX-AI_V. Labels only; no login, server or amount appears in this public repo.

**Founder decisions taken 2026-11-13 (AskUserQuestion), binding on every requirement below:**
- D-A **Pre-mark history: "Accept, judge closed P&L".** Days before a key's first stored NAV mark `S` are realized (closed-balance) basis by design (NAVMTM D-09, no backfill). They are judged against the terminal's closed-trade balance history (Gate A). The open-P&L-included 1% applies to days from `S` on (Gate B). The harness measures and reports the gap; it never invents marks.
- D-B **The 1% is "return gap, in points":** `|ΔE_ours − ΔE_oracle| / E(window start)`, checked separately for cumulative return, start level and end level, held in ONE named constant `MT5_PARITY_TOLERANCE = 0.01`.
- D-C **Statements: the founder gets broker statements** for these accounts and provides them in the session. They are the historical-equity oracle (month-end and/or daily).
- D-D **Clock read: "Allow narrow read".** One named, tick-time-only `Mt5Client` method is admitted; the forbidden list in the contract test stays, and the exception is pinned by a test (precedent `terminal_info`, 153.3/D-31).
- D-E **Weekend reading: "Yes, this weekend".** The founder reads frozen terminal Balance/Equity for each account on Sat 2026-11-14 or Sun 2026-11-15 (the Friday 2026-11-13 close), as one Gate B edge.
- Settled 2026-08-14 and unchanged: the measurement window ends before the run day.

## v1.18 Requirements

### Parity harness (agent-built, no founder needed)

- [ ] **PARITY-01**: Every expected value the harness compares carries a provenance of exactly `terminal_reading`, `terminal_report_export` or `broker_statement`, and the harness refuses any other source, including our own gateway or `mt5_soak.reconcile_parity`.
- [ ] **PARITY-02**: The harness goes RED on each deliberately broken input (a reclassified BALANCE deal, a one-hour clock shift, a dropped oldest deal) and GREEN again after a byte-backup restore, proven in the phase record.
- [ ] **PARITY-03**: Our side is captured read-only from persisted PROD rows through versioned SELECT-only SQL behind a write-keyword test; raw figures stay in an untracked directory and only ratios, ordinals and verdicts are tracked.
- [ ] **PARITY-04**: A pre-flight census records, per account: first mark day `S`, open P&L at the candidate Friday edges, stored `data_quality_flags`, account unit, published status, record length and `computed_at`, plus an inception identity check (the ledger rolled back past the first deal comes to about 0).

### MT5 verification (carried requirements)

- [ ] **MT5-06**: The MT5 server-UTC offset is measured live inside the worker's leased derive (D-D), asserted against the configured `Mt5ServerClock` rule (Phase 175's `MT5_SERVER_TIME_RULE` is the carrier; the reading asserts it and is never written back as config), and persisted write-once; a near-midnight real deal from a DST divergence week lands on the UTC day of (terminal-displayed server time − the offset in force). ⚠️ Restated 2026-11-13: the August text named `MT5_SOAK_SERVER_OFFSET_MIN` (superseded by Phase 175) and "the day the terminal shows" (the terminal shows server days; our series buckets by UTC day).
- [ ] **MT5-07**: Rendered performance matches an external oracle within `MT5_PARITY_TOLERANCE` as defined in D-B: Gate A (pre-`S`, closed-trade balance basis) against the terminal's All-History export, and Gate B (from `S`, open P&L included) against broker statements and the weekend reading (D-C, D-E), over windows that end before the run day.
- [ ] **MT5-08**: The verification runs against the live funded accounts MM2, MM3 and FX-AI_V, with the founder at the terminal on a trading day; a demo, the v1.15 soak account or a weekend-only run does not satisfy it (the weekend reading is an edge input, not the run).
- [ ] **MT5-09**: Every surface that renders strategy performance shows the same, correct MT5 numbers for these accounts. ⚠️ Re-mapped 2026-11-13: the portfolio PDF (retired in Phase 195 TRIM) and `scenario-blend-panels.ts` (deleted) are dropped; the current surface list is fixed at discuss-phase, cited by symbol.
- [ ] **MT5-10**: Every surfaced discrepancy is fixed within the milestone at its root, wherever it lives, including shared backbone money-math (uncapped, founder decision 2026-08-14); a difference passes only if within tolerance, consistently withheld on every surface, or in a named bucket with a recorded founder ruling.
- [ ] **MT5-15**: The `complete_with_warnings` / data-quality flags carried by these accounts are read from stored data and each is eliminated, or understood and accepted in writing.
- [ ] **MT5-GOAL-01** *(umbrella acceptance, no implementation of its own)*: An MT5 strategy is usable end-to-end by the allocator who uploaded it (ingests, projects in a scenario, factsheet viewable), confirmed live by the founder.

### Founder confirmations (Phase 157)

- [ ] **FCONF-01**: The founder confirms the 2026-08-04 wizard restart is gone: with a live draft, `+ Strategy` shows the resume banner and Resume lands on the draft's step.
- [ ] **FCONF-02**: The founder sees the amber `wizard-sync-recomputing` block render as specified (heading, no red envelope, no metric numbers).
- [ ] **FCONF-03**: The founder sees the four 153.7 copy members render in a real wizard, with NO Retry control on `SEAM_INTERNAL_FAULT`.
- [ ] **FCONF-04**: `MT5_SPIKE_INVESTOR_PASSWORD` is rotated after the session's live reads, and gate 1 (all three keys sync `complete`) is re-checked afterwards.

## Future Requirements

- **Timeout findings #8 and #10** (TODOS, 153.5): tune from percentile data across several nightlies; carried as context into the fix loop, booked separately if the data is not in by the milestone close.
- **MT5 as a composite member** (TODOS, 153.6 OUT): product decision, natural neighbour of this milestone; not scoped here.
- **Per-server clock** (parked MT5SERVERLEARN, 164.6.6.3.6): only if the three accounts turn out to sit on servers with different DST rules.
- **Composer range as dates** (`201.1-COMPOSER-RANGE-AS-DATES`): carried from v1.21, not v1.18 scope.

## Out of Scope

| Feature | Reason |
|---------|--------|
| A public "verified" badge or advertising MT5 | MT5 is not advertised until Phase 155 passes; a claim is a later product decision |
| Using our own gateway read as an oracle | Self-referential (research C1, Pitfall 1) |
| Spreading today's open P&L back over pre-mark history | Invents data (D-A) |
| Widening the 1% to pass | Settled tolerance; a gap is a finding |
| Hardcoding a server offset | Breaks at DST and per broker (MT5-06) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|

**Coverage:**
- v1.18 requirements: 15 total
- Mapped to phases: 0 (filled by the roadmapper)

---
*Requirements defined: 2026-11-13*
*Last updated: 2026-11-13 at v1.18 resume*
