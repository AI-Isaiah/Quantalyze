# Phase 175 MT5OFFSET - Context

**Gathered:** 2026-10-27
**Status:** Ready for planning

<domain>
## Phase Boundary

MT5 deal days and deal instants (FLOWTIMING D-08 seam, NAVMTM D-23 flow placement) use the broker's real UTC offset in force on each deal's date, including daylight-saving changes, instead of the fixed `MT5_SERVER_UTC_OFFSET_S`. Marks themselves are offset-independent (NAVMTM D-06) and need no repair; only flow placement and day bucketing depend on the offset.

</domain>

<decisions>
## Implementation Decisions

### Carried (not re-asked)
- FLOWTIMING 164.6.6.2.3 D-08: one seam, one offset; days are UTC days. D-07: an untrustworthy instant means no instant (day-level rule), never a default.
- NAVMTM 167.2.1.1.1 D-23 (founder 2026-10-26, "Use the deposit's exact time"): a flow is placed by its own instant against the mark's `marked_at`. D-03: the chain moves to ~00:10Z.
- 142.2 RESEARCH: a live tick is the only reliable server clock; the last-deal estimator was tried and rejected; the MT5 client read surface is locked (`test_mt5_client_contract.py`), any widening is one purpose-named method.

### D-01 Offset model: a DST rule, measured once
Founder 2026-10-27, AskUserQuestion: "DST rule, measured once (Recommended)". The broker's rule (EU, US or fixed) is measured live and recorded with its date (SC-1). A pure function gives the offset in force at a broker-clock instant; every MT5 deal day and instant uses it (SC-2). The rule is chosen by a worker setting (a rule id, not a committed broker-server-name table: the server name is secret-grade, T-134-01); an unknown or unset rule fails loud; a fixed-integer form stays for a no-DST broker. One resolver replaces the scattered `int(os.getenv("MT5_SERVER_UTC_OFFSET_S","0"))` reads. No live server-clock check in this phase: it stays with Phase 155 / MT5-06, which 175 does not close.

### D-02 Interim: measure now, set by hand
Founder 2026-10-27: "Measure now, set by hand (Recommended)". The founder reads the broker's server clock in the MT5 terminal today; `MT5_SERVER_UTC_OFFSET_S` is set to match on the worker, re-checked after 2026-11-01 (US DST end), and the measurement step is added to the NAVMTM chain-move runbook preflight (SC-3). Two readings on trading days, one before and one after 2026-11-01, separate the US rule from a fixed +3 (a +2 reading today already means the EU rule).

### D-03 History when the rule ships (Claude's call, analyzer recommendation)
The nightly derive re-reads the whole MT5 ledger, so strategy and key series re-bucket by themselves. Before deploy, a read-only before/after on the live ledger (counts and ordinals only, `scripts/flowtiming_dry_run.py` precedent) records which days move; allocator-history snapshots (written once, `ON CONFLICT DO NOTHING`) are rebuilt by a named forced rebuild only for keys whose days actually moved.

**Reading recorded 2026-10-27 (plan-check):** "before deploy" is read as "before the rule takes effect". The 175 code deploys with only the existing integer set, so the deploy alone changes no derived number; the live capture and the before/after run happen after that deploy and before the rule id is switched on in Railway. D-03 was Claude's call, so this reading is recorded here and in the ROADMAP rather than escalated.

### D-04 A derive clock configuration fault is transient (founder 2026-10-27, "Transient, like backfill (Recommended)")
Review WR-01 found that a derive clock configuration fault classified `permanent` is still stamped on the strategy by the status bridge, with a "Contact support" sentence that is false for an operator fault. Neither disposition is stamp-free without new machinery: the backfill's `transient` has no stamp only because its job carries no strategy id. Founder decision (AskUserQuestion, 2026-10-27): "Transient, like backfill (Recommended)". The derive arm returns `transient`, so the job retries (about 2.5 minutes over three attempts) and, if the fault persists, is stamped with the true "automatic retries exhausted" sentence. This supersedes RESEARCH A8's `permanent` for the derive and plan 175-03's "config fault permanent, no stamp" (T-175-10), which stay as lineage.

### D-05 Plan 06 after LEGACYRETIRE: count, then switch (founder 2026-11-03)
Founder 2026-11-03, AskUserQuestion: "175 MT5OFFSET: ... Phase 176 has since dropped that legacy table and retired the rebuild job, so step 3's rebuild can no longer run. The marked curve re-derives on its own at the next nightly run. How should plan 06 run?" Answer: "Count, then switch (Recommended)": "Keep step 1's read-only capture and day count so you see what moves, then switch both workers, prove the first derive is clean, and record the dropped rebuild as a dated correction. You approve the switch after seeing the counts."
- D-03's forced rebuild of `allocator_equity_snapshots` is void: Phase 176 dropped the table (#1185) and the `reconstruct_allocator_history` kind is retired (a `force_rebuild` row fails permanent). The allocator curve is the derived one, recomposed from the per-key dailies the nightly derive re-buckets.

### D-06 Plan 06: switch without the count (founder 2026-11-03)
Founder 2026-11-03, AskUserQuestion, after the Railway SSH capture path failed on both analytics services: "The home-directory fix didn't solve SSH ... How do you want to continue?" Answer: "Switch 175 without the count": "Stop waiting on SSH: set the US rule on both workers now and judge from the first nightly derive."
- This replaces D-05's count. Task 1's live capture and before/after did not run. D-03's "before" is not met, by founder decision. The fallback is the one Task 1 step 0 names: the evidence is the first derive after the switch.
- Railway SSH into both analytics services fails after authentication ("An error occurred connecting to your service"), and Railway's container file tools fail the same way. mt5-gateway works with the same key. Giving the container user a home directory (#1190, v0.133.18.3) did not fix it, so the cause is on Railway's side.

### Claude's Discretion
- The deterministic tie-break for the repeated or missing broker-local hour at a transition.
- The signature change from an int offset to a resolver across the fold functions and tests.
- Rewriting the `mt5_deals.py` note that says order within the broker clock is exact (REVIEW-3 WR-02).

</decisions>

<code_context>
## Evidence and starting points
- `analytics-service/services/mt5_deals.py` (seam, int-only validation), `broker_dailies.py` (fold functions), `job_worker.py` (six offset env reads), `equity_reconstruction.py` (one), `nav_marks_apply.py` (D-23 placement), `mt5_read.py` (full ledger read each derive).
- Calendar: EU DST ended 2026-10-25, US ends 2026-11-01; spring US 2027-03-14, EU 2027-03-28.
- Plan 11 dry run (NAVMTM): mt5-offset unmeasurable from the worker; configured 10800.
</code_context>

<canonical_refs>
## Canonical References
- NAVMTM `167.2.1.1.1-REVIEW-3.md` WR-02 (branch feat/167.2.1.1.1-navmtm), and its CONTEXT D-03, D-23.
- `.planning/milestones/v1.16-phases/142.2-*/142.2-RESEARCH.md` Pattern 6, Pitfall 4, Open Question 1.
- `.planning/phases/164.6.6.2.3-*/164.6.6.2.3-CONTEXT.md` D-07, D-08.
- `docs/runbooks/navmtm-chain-move-go-live.md`, `docs/runbooks/mt5-go-live.md`.
</canonical_refs>

<deferred>
## Deferred Ideas
- Live server-clock tripwire asserting `measured == rule(now)`: Phase 155 / REQUIREMENTS MT5-06.
</deferred>
