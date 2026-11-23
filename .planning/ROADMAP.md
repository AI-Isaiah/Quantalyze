# Roadmap: Quantalyze

## Milestones

- ✅ **v1.21 UX — trustworthy, navigable, lean** — Phases 192–206 (shipped 2026-11-13)
- ✅ **v1.20 Backlog Burndown** — Phases 158–191 (shipped 2026-11-06)
- ✅ **v1.19 JOB/RATE** — Phases 143–146, 146.1, 146.2 (shipped 2026-08-20)
- ✅ **v1.18 MT5-VERIFY & founder confirmations** — Phases 155, 155.1, 207–220 (shipped 2026-11-23; 155.2's remaining work, 157 and 221–225 moved to the next milestone 2026-11-23)
- 📋 **Next milestone (not yet started)** — Phases 155.2, 157, 221–225 (moved out of v1.18 2026-11-23, founder)
- ✅ **v1.17 MT5 — ingested, wizardable, surfaced** — Phases 147–154, 156 (shipped 2026-08-14)
- ✅ **v1.16 Production Resilience & Reliability** — Phases 140–142 (shipped 2026-08-14)
- Earlier milestones: see "Shipped Milestones" below.

## Phases

<details>
<summary>✅ v1.18 MT5-VERIFY & founder confirmations (Phases 155, 155.1, 207–220) — SHIPPED 2026-11-23</summary>

16 phases delivered and verified (155, 155.1, 207–220). Audit `passed`: 5/5 requirements (PARITY-01..04, MT5-06), 11/11 integration links, 4/4 flows. Started 2026-08-14, parked 2026-08-20, resumed 2026-11-13. Phase 155.2 LIVEPARITY's remaining work (with MT5-07..10, MT5-15, MT5-GOAL-01), Phase 157 FOUNDER-CONFIRM (with FCONF-01..04) and Phases 221–225 moved to the next milestone by founder rulings on 2026-11-23; they are listed under `## 📋 Next milestone` below, and their requirement text, with founder decisions D-A..D-E, is carried in [`milestones/v1.18-REQUIREMENTS.md`](milestones/v1.18-REQUIREMENTS.md) under "Carried to the next milestone". The pre-close `audit-open` check still refuses on archived history and was done by hand. Full detail: [`milestones/v1.18-ROADMAP.md`](milestones/v1.18-ROADMAP.md), audit: [`milestones/v1.18-MILESTONE-AUDIT.md`](milestones/v1.18-MILESTONE-AUDIT.md), phase directories: `milestones/v1.18-phases/`.

</details>

<details>
<summary>✅ v1.21 UX — trustworthy, navigable, lean (Phases 192–206) — SHIPPED 2026-11-13</summary>

18 phases delivered and verified (192–206, with 194.1, 194.2 and 201.1 inserted). Audit `tech_debt`: 32/32 requirements, 10/10 integration seams, 3/3 flows. The pre-close `audit-open` check was skipped by founder decision (it refuses on archived history). The composer range-as-dates fix is booked for the next milestone (`201.1-COMPOSER-RANGE-AS-DATES`). Full detail: [`milestones/v1.21-ROADMAP.md`](milestones/v1.21-ROADMAP.md), requirements: [`milestones/v1.21-REQUIREMENTS.md`](milestones/v1.21-REQUIREMENTS.md), audit: [`milestones/v1.21-MILESTONE-AUDIT.md`](milestones/v1.21-MILESTONE-AUDIT.md), phase directories: `milestones/v1.21-phases/`.

</details>

<details>
<summary>✅ v1.20 Backlog Burndown (Phases 158–191) — SHIPPED 2026-11-06</summary>

150 phases in the roadmap: 142 delivered and verified, 8 retired or absorbed (164.6.6.3.6, 165, 165.1, 165.2, 181, 182, 187, 189). Audit `tech_debt`: 62/64 requirements (DEPS-01 descoped, HONEST-07 deferred). Phase 188's SC-4 residual moves to a follow-up phase in the next milestone (D-13). Full detail: [`milestones/v1.20-ROADMAP.md`](milestones/v1.20-ROADMAP.md), requirements: [`milestones/v1.20-REQUIREMENTS.md`](milestones/v1.20-REQUIREMENTS.md), audit: [`milestones/v1.20-MILESTONE-AUDIT.md`](milestones/v1.20-MILESTONE-AUDIT.md), phase directories: `milestones/v1.20-phases/`.

</details>

<details>
<summary>✅ v1.19 JOB/RATE (Phases 143–146, 146.1, 146.2) — SHIPPED 2026-08-20</summary>

6/6 phases passed, 9/9 requirements (JOB-04/05/06/08, RATE-01..05), audit `tech_debt`. Full detail: [`milestones/v1.19-ROADMAP.md`](milestones/v1.19-ROADMAP.md).

</details>

<details>
<summary>✅ v1.17 MT5 — ingested, wizardable, surfaced (Phases 147–154, 156) — SHIPPED 2026-08-14</summary>

Phase 155 was carried to v1.18 and the title amended to match what was delivered. ⛔ MT5 is NOT advertised: nobody has compared our numbers to the terminal's. Full detail: [`milestones/v1.17-ROADMAP.md`](milestones/v1.17-ROADMAP.md).

</details>

<details>
<summary>✅ v1.16 Production Resilience & Reliability (Phases 140–142) — SHIPPED 2026-08-14</summary>

Full detail: [`milestones/v1.16-ROADMAP.md`](milestones/v1.16-ROADMAP.md).

</details>

---

## Shipped Milestones

> Collapsed index — one line per shipped milestone. Full per-milestone detail
> lives in `.planning/MILESTONES.md` and the `.planning/milestones/` archives.
> (Rebuilt 2026-07-25 from MILESTONES.md after a truncation accident; the prior
> inline v1.12/v1.13 detail sections were duplicative of their archives.)

- ✅ **v0.14.0.0 — Sprint 8: Bridge V2**
- ✅ **v0.15.0.0 — Sprint 9: Demo-to-Production**
- ✅ **v0.16.0.0 — Phase 11: Onboarding & Security Readiness**
- ✅ **v0.17.0.0 — Sprint 12: KPI Parity and Discovery v2**
- ✅ **v1.0.0 — API-Key Rewrite** (Diagnose → Fix → Unify → Ship to LPs)
- ✅ **v1.1.0 — Scenario Analysis** (Surface → Honesty → Persist → Read → Quant)
- ✅ **v1.2 — Allocator Cohesion** (tag `v1.2` @ `11775460`)
- ✅ **v1.2.1 — scenario-tab-hardening** (tag `v1.2.1` @ `e5e4f3d2`)
- ✅ **v1.2.2 — scenario-tab-factsheet-parity** (tag `v1.2.2` @ `43e57dd0`)
- ✅ **v1.3 — Mobile & Adaptive UI** (2026-06-28)
- ✅ **v1.4 — Frontend Excellence** (tag `v1.4` @ `4c4ca537`)
- ✅ **v1.5 — Scenario Coverage-Window Blend** (tag `v1.5` @ `f8b502e7`)
- ✅ **v1.6 — Scenario Series-Space Purification** (tag `v1.6` @ `f78f036b`)
- ✅ **v1.7 — Deribit Exchange Coverage & Carry-Forward Burn-Down** (tag `v1.7` @ `9a1e7b8e`)
- ✅ **v1.8 — Flow-Aware Time-Weighted Returns + Native-Unit NAV** (tag `v1.8` @ `eb8e357e`)
- ✅ **v1.9 — Multi-Key Composite Strategy** (tag `v1.9` @ `044bee50`). Archive: `milestones/v1.9-ROADMAP.md`.
- ✅ **v1.9.1 — Composite Onboarding Hardening** (tag `v1.9.1` @ `be215b15`). Archive: `milestones/v1.9.1-ROADMAP.md`.
- ✅ **v1.10 — Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification** (2026-07-15). Archive: `milestones/v1.10-ROADMAP.md`.
- ✅ **v1.11 — Scenario Composer v2** (tag `v1.11` @ `a42f4bcf`, Phases 109–117). Every source is a daily-series constituent under a coherent manager/allocator role model. Archive: `milestones/v1.11-ROADMAP.md`.
- ✅ **v1.12 — sFOX Verified Integration (Foundation, flag-OFF)** (tag `v1.12` @ `92be47af`, Phases 118–123). Live sFOX `api_verified` foundation shipped dormant; go-live re-homed to v1.13. Archive: `milestones/v1.12-ROADMAP.md`.
- ✅ **v1.13 — Infra: sFOX go-live foundation + worker rebuild** (tag `v1.13`, Phases 125–130, shipped FLAG-OFF 2026-07-19, closed 2026-07-22). Railway static-egress + worker rebuild + trust-tier SECDEF. Archive: `milestones/v1.13-ROADMAP.md`.
- ✅ **v1.14 — Smoothed options MTM (third factsheet basis)** (tag `v1.14` @ `0adde939`, v0.48.0.x, Phases 131–133, shipped + flipped LIVE 2026-07-23; PRs #633 + #635). Additive third `pnl_basis` `smoothed_mtm` (daily ΔMTM redistribution, total-preserving; cash/MTM byte-identical). Archive: `milestones/v1.14-ROADMAP.md`. Review: `v1.14-BIG-REVIEW.md` (SHIP).
- ✅ **v1.15 — MetaTrader 5: live api_verified account sync** (tag `v1.15`, v0.49.0.0→v0.49.4.0, Phases 134–139, shipped DARK 2026-07-24 + flipped LIVE 2026-07-25; PRs #636 + #637/#640/#641/#642). Self-hosted Wine gateway + `mt5linux` net client → deal-ledger equity reconstruction → the ONE backbone with `api_verified`; √252 traditional; 3-field creds. Prod gateway private+live, Vantage acct 26547876 soaked green, flags flipped LIVE. Archive: `milestones/v1.15-ROADMAP.md` + `v1.15-REQUIREMENTS.md`. Audit: `v1.15-MILESTONE-AUDIT.md`.
- ✅ **v1.16 — Production Resilience & Reliability** (Phases 140–142, closed 2026-08-14). Archive: `milestones/v1.16-ROADMAP.md`.
- ✅ **v1.17 — MT5: ingested, wizardable, surfaced** (Phases 147–154, 156, closed 2026-08-14, v0.62.0.0). Archive: `milestones/v1.17-ROADMAP.md`.
- ✅ **v1.19 — JOB/RATE** (tag `v1.19`, Phases 143–146, 146.1, 146.2, closed 2026-08-20, v0.68.1.0). Archive: `milestones/v1.19-ROADMAP.md`.
- ✅ **v1.20 — Backlog Burndown** (tag `v1.20`, Phases 158–191, closed 2026-11-06, v0.133.23.2, audit `tech_debt`). Archive: `milestones/v1.20-ROADMAP.md`.
- ✅ **v1.21 — UX: trustworthy, navigable, lean** (Phases 192–206, closed 2026-11-13, v0.133.39.0, audit `tech_debt`). Archive: `milestones/v1.21-ROADMAP.md`.
- ✅ **v1.18 — MT5-VERIFY & founder confirmations** (Phases 155, 155.1, 207–220, closed 2026-11-23, v0.133.61.2, audit `passed`). Archive: `milestones/v1.18-ROADMAP.md`.


## Current position

⭐ **v1.18 MT5-VERIFY & founder confirmations — CLOSED 2026-11-23** (audit `passed`, 5/5 requirements, 16/16 phases). The next milestone is not started; run `/gsd-new-milestone`. It already holds the phases below, moved out of v1.18 by founder rulings on 2026-11-23, and carries their requirements (MT5-07..10, MT5-15, MT5-GOAL-01, FCONF-01..04) and founder decisions D-A..D-E from [`milestones/v1.18-REQUIREMENTS.md`](milestones/v1.18-REQUIREMENTS.md).

⛔ **Do not advertise MT5 until Phase 155.2 passes.** Carried from v1.17 and v1.18 and unchanged by the close. No surface, copy or badge advertises MT5 or calls it verified before 155.2 passes (`milestones/v1.18-REQUIREMENTS.md` Out of Scope).

⚠️ **Public repo:** account labels only (MM2, MM3, FX-AI_V). No login, server name, amount, account number or PROD id in tracked text. Raw captures stay in the untracked capture directory.

⭐ **v1.21 UX — CLOSED 2026-11-13** and **v1.20 Backlog Burndown — CLOSED 2026-11-06.** Their position notes, and v1.18's own until this close, are in [`milestones/v1.18-ROADMAP.md`](milestones/v1.18-ROADMAP.md) as lineage.

## 📋 Next milestone (not yet started) — Phases 155.2, 157, 221–225

Moved out of v1.18 on 2026-11-23 by founder decision. 157 FOUNDER-CONFIRM: "delay 157 into next milestone. Cannot do that now". 221–225: "Move them too (Recommended)". Name, version and requirements are set when the milestone starts (`/gsd-new-milestone`); until then these phases keep their numbers, sections and plans unchanged. Requirements carried: FCONF-01..04 (157); 221–225 were booked without requirement ids. ⭐ 155.2 LIVEPARITY joined later the same day (founder, "Move to next milestone: Your broker statements for 155.2, then its Gate B run and final verification."), carrying MT5-07..10, MT5-15 and MT5-GOAL-01 and its four open plans (11–14); its 13 shipped plans stay recorded as shipped. 157's FCONF-04 rotation still waits for 155.2's last live read.

### Phases (next milestone)

- [ ] **Phase 155.2: LIVEPARITY — on a trading day, our MT5 numbers match the terminal's and the broker's within 1%** - The founder's scripted session on MM2, MM3 and FX-AI_V, Gate A and Gate B per account, every surface the same, every gap fixed at its root or ruled on; after 155, session after the 155.1 deploy
- [ ] **Phase 157: FOUNDER-CONFIRM — the observations only the founder can make are made** - Wizard resume, the amber recomputing block and the four 153.7 copy members seen in a real wizard; the spike password rotated after the live reads and gate 1 re-checked; same sitting as the 155.2 session
- [ ] **Phase 221: SENTRYSCRUB2 — no Sentry event carries PostgREST details or hint from any capture site, and browser captures actually report** - Sentry scrub at the last hop for direct capture sites, then client Sentry init; independent of the MT5 parity phases
- [ ] **Phase 222: ALERTTRUTH — Python and SQL error copy and portfolio benchmark labels name the real cause and a channel that exists** - User-facing error copy and the benchmark outage label, with a migration; independent of the MT5 parity phases
- [ ] **Phase 223: FLOWKINDS — every derive and compose path reads the same capital-flow kinds and refuses a malformed or truncated read by name** - Composite and flow-source half of the derive gaps (anchor and positions stay in TODOS); independent of the MT5 parity phases
- [ ] **Phase 224: DEADLEFTOVERS — dead SQL, retired job kinds still enqueued and inert plumbing are retired** - Dead SQL, retired job-kind enqueues and inert plumbing, with a migration; independent of the MT5 parity phases
- [ ] **Phase 225: ONEACCOUNTONCE — a user cannot connect the same exchange account more than once, and one account shared across users stays allowed** - Per-owner duplicate account refusal; shared keys across users stay allowed; founder decision 2026-11-23

### Phase 155.2: LIVEPARITY — on a trading day, our MT5 numbers match the terminal's and the broker's within 1%

**Goal:** On one trading day, with the founder at the terminal, the numbers Quantalyze renders for MM2, MM3 and FX-AI_V are compared with the terminal's and the broker's own figures, and every difference is fixed at its root or ruled on by the founder, until the parity verdict passes on every surface. This is the only phase gate 2 blocks, and the phase whose pass lifts the advertising ban. Research Phase C.
**Requirements**: MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01
**Depends on:** Phase 155 (dress rehearsal green). The founder session inside this phase also waits on 155.1's reading deployed with a weekday PROD reading row per key; that is a deploy condition, not a completion dependency (see 155.1)
**Plans:** 13/17 plans complete
**UI hint**: no

D-E amended 2026-11-22 (founder): the weekend edge is the Fri 2026-11-20 frozen close, read 2026-11-22 for all three accounts; for that edge only, the Gate B window runs past the 11-19 run day (see `milestones/v1.18-REQUIREMENTS.md` D-E; `REQUIREMENTS.md` was removed at the v1.18 close).

Carried context, not requirements: timeout findings #8 and #10 are tuned only from percentile data across several nightlies, with fresh and cached logins split, and are booked separately if the data is not in by the milestone close (`milestones/v1.18-REQUIREMENTS.md` Future). The product call on MT5 as a composite member stays out of scope.

**Success Criteria** (what must be TRUE):
1. The founder's trading-day session on the live funded accounts MM2, MM3 and FX-AI_V is recorded: real trade mode and the trading day per account, an All-History Report per account, the Summary block at an instant T, the statement figures (D-C), and the terminal-displayed time of 155.1's preselected near-midnight deal (MT5-06's last leg). A demo, the v1.15 soak account or a weekend-only run is refused as the run; the weekend reading (D-E) enters only as a Gate B edge. (MT5-08)
2. For each account the harness reports Gate A (days before `S`, closed-trade balance basis, against the All-History export; D-A) and Gate B (days from `S`, open P&L included, against the statements and the weekend reading) within `MT5_PARITY_TOLERANCE`, as a return gap in points (D-B) checked separately for cumulative return, start level and end level, over windows that end before the run day. The instant-T reading is checked on D+1 after a re-anchoring sync. (MT5-07)
3. Every surface that renders strategy performance, on the list fixed in 155 (the portfolio PDF and `scenario-blend-panels.ts` dropped, cited by symbol), shows the same numbers for these accounts in the founder's signed-in browser, bound to `computed_at`. This closes the data-layer matrix 155 measured. (MT5-09)
4. Every discrepancy, from 155's pre-verification or the live run, is fixed at its root wherever it lives, shared backbone money-math included and never scoped to `exchange === 'mt5'`, and the comparison is re-run. A difference passes only within tolerance, consistently withheld on every surface, or in a named bucket with a recorded founder ruling; an empty `unexplained` list alone is not the exit. Every data-quality flag these accounts carry is eliminated or understood and accepted in writing. (MT5-10, MT5-15)
5. The founder confirms live that an MT5 strategy he uploaded ingests, projects in a scenario and has a viewable factsheet. (MT5-GOAL-01)

Plans:
- [x] 155.2-01-PLAN.md — The Report parser reads the real MT5 build 5830 All-History Report (`td` headers, hidden `Cost` column)
- [x] 155.2-02-PLAN.md — `_native_unit_present` no longer makes every real USD account's Gate A unmeasurable
- [x] 155.2-03-PLAN.md — Gate A judged on the three real accounts from a sealed PROD capture
- [x] 155.2-04-PLAN.md — Root-cause the cross_store findings F-155-01..03 (group G1)
- [x] 155.2-05-PLAN.md — Group G2 fixed at its root in shared money-math: the per-key builder stamps each key's asset class
- [x] 155.2-06-PLAN.md — G2 wired into the scenario composer and the scenario compare panel
- [x] 155.2-07-PLAN.md — G2 finished in the server live baseline (`liveBaselineMetricsFromPerKeyDailies`)
- [x] 155.2-08-PLAN.md — Root-cause the G3 convention gaps and the G4 freshness window; founder ruling questions
- [x] 155.2-09-PLAN.md — `csv_source` classified from the code that writes it (MT5-15 machine side)
- [x] 155.2-10-PLAN.md — Full-verdict preparation: run day and instant-T settled by the founder
- [ ] 155.2-11-PLAN.md — Founder-only Gate B readings: weekend reading and broker statements (waits on the statements)
- [ ] 155.2-12-PLAN.md — Re-run after the fixes are live and produce the full parity verdict
- [ ] 155.2-13-PLAN.md — Criterion 3: every surface in the founder's signed-in browser
- [ ] 155.2-14-PLAN.md — Founder-only exits: written rulings and the live MT5-GOAL-01 confirmation
- [x] 155.2-15-PLAN.md — Gap closure G3-1 (a): the stored-curve reader includes the first-day return (TS and Python twin)
- [x] 155.2-16-PLAN.md — Gap closure G4-1 (b): a key-mode derive enqueues the analytics recompute of its linked strategy
- [x] 155.2-17-PLAN.md — Gap closure G5-1..G5-3: `oracle_account_mismatch`, the census counts the share link, Sharpe at the stored precision

### Phase 157: FOUNDER-CONFIRM — the observations only the founder can make are made

**Goal:** The observations only the founder can make about shipped wizard behaviour are made in the same sitting as the 155.2 session, and the spike investor password is rotated once no live read needs it, with gate 1 shown intact afterwards.
**Requirements**: FCONF-01, FCONF-02, FCONF-03, FCONF-04
**Depends on:** the 155.2 founder session (the same sitting, not 155.2's completion); FCONF-04's rotation comes after that session's last live read
**Plans:** 1/3 plans complete
**UI hint**: no (it observes shipped UI; a failed observation is a finding, not a new design)

**Success Criteria** (what must be TRUE):
1. With a live draft, the founder clicks `+ Strategy`, sees the resume banner, and Resume lands on the draft's step; the 2026-08-04 wizard restart does not recur. (FCONF-01)
2. The founder sees the amber `wizard-sync-recomputing` block render as specified: its heading, no red envelope, no metric numbers. (FCONF-02)
3. The founder sees the four 153.7 copy members render in a real wizard, and no Retry control appears on `SEAM_INTERNAL_FAULT`. (FCONF-03)
4. `MT5_SPIKE_INVESTOR_PASSWORD` is rotated after the last live read that needs it, and gate 1 is re-checked afterwards: all three keys sync `complete` on a sync that ran after the rotation. (FCONF-04)

Plans:
- [x] 157-01-PLAN.md — the staging kit (fail-closed fetch router with a visible marker), its smoke test and the founder script
- [ ] 157-02-PLAN.md — the founder makes the FCONF-01..03 observations under staged responses (founder checkpoint)
- [ ] 157-03-PLAN.md — the MM2 investor password rotation after 155.2's last live read, then the gate-1 re-read on the next scheduled derive (founder checkpoint)

### Phase 221: SENTRYSCRUB2 — no Sentry event carries PostgREST details or hint from any capture site, and browser captures actually report

**Goal:** No Sentry event, from any capture site, server or browser, carries a PostgREST error's `details` or `hint`, and a capture made in browser code actually reaches Sentry. The last-hop scrub in `scrubSentryEvent` (`src/instrumentation.ts`) drops `details` and `hint` from a non-Error capture's `extra.__serialized__`, so the direct `Sentry.captureException` sites that bypass `scrubCaptureInput` are covered too. Only after that scrub ships does browser code get a client `Sentry.init` running the same scrub, so turning client capture on can never send an unscrubbed event. The auth callback's GoTrue `error` / `error_code` branch logs the error code (short, never `error_description`), so failed verifies become visible. Trigger: founder decisions 2026-11-23, "Book phases: SENTRYSCRUB2, ALERTTRUTH, FLOWKINDS (composite half), DEADLEFTOVERS". Owns `TODOS.md` `[209-SENTRY-DIRECT-CAPTURE-DETAILS]`, `[167.2.1-CLIENT-SENTRY-NOOP]` and `[219-CALLBACK-VERIFY-ERROR-LOG]` (fix directions and gates as written there).
**Requirements**: TBD
**Depends on:** none (independent of the MT5 parity phases)
**Success Criteria** (what must be TRUE):
1. A real-SDK envelope test (the in-memory transport in `src/instrumentation.test.ts`) captures a plain object carrying `details` and `hint` sentinels through a direct `Sentry.captureException` call, and neither sentinel reaches the envelope; the test is shown RED before the fix.
2. The scrub lands before, or in the same change as, the browser `Sentry.init`; no build ships a client init without the `details`/`hint` scrub in its `beforeSend`.
3. A `captureToSentry` call in a `"use client"` module produces an event (proved by a test against the client init, not by reading config), and the client event passes through the same scrub as a server event.
4. The auth callback's GoTrue error branch logs the `error_code` value, sliced short, and never `error_description`; a callback test sending `error_code=otp_expired` with the email-change marker asserts it, shown RED before the fix.
5. The three TODOS entries above are deleted in the ship PR and named in its CHANGELOG entry.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 222: ALERTTRUTH — Python and SQL error copy and portfolio benchmark labels name the real cause and a channel that exists

**Goal:** Every Python and SQL error sentence a user can read names the real cause and offers only a channel that exists (the contact form, never "contact support"), and a portfolio whose benchmark sources all failed says the benchmark is unavailable, not "stale". The `computation_error_copy` arms (`supabase/schema/functions/computation_error_copy.sql`) move by migration, so migration-reviewer and rls-policy-auditor apply before merge. `run_sync_trades_job` no longer returns DONE after recording an analytics failure that the bridge then erases to `complete`. Trigger: founder decisions 2026-11-23, "Book phases: SENTRYSCRUB2, ALERTTRUTH, FLOWKINDS (composite half), DEADLEFTOVERS". Owns `TODOS.md` `[212-CONTACT-SUPPORT-SURVIVORS]`, `[166.4.1-BENCHMARK-OUTAGE-LABEL]` and `[SYNCTRADES-ENQUEUE-DONE]` (readings, cautions and fix directions as written there, including that the 161.1 F1 remedy does not transfer to the sync-trades handler as-is).
**Requirements**: TBD
**Depends on:** none (independent of the MT5 parity phases)
**Success Criteria** (what must be TRUE):
1. No string in `analytics-service` or in the `computation_error_copy` arms says "contact support"; each names the contact form or a remedy that works, and csv-finalize's `ENQUEUE_LOST_RACE_USER_COPY` is back in byte parity with the SQL ELSE arm, with the parity test reading the SQL arm instead of a hand-typed oracle.
2. A total benchmark source failure (no price source and no recent cached day) writes a note distinct from the stale-cache note, and the page shows it with its own wording; a test drives both cases and tells them apart.
3. When the follow-on analytics enqueue fails in `run_sync_trades_job`, the strategy's row does not read `complete` with no analytics; a test drives the failed enqueue through the bridge and asserts the stored status and error, shown RED before the fix.
4. The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, and every census it moves (schema snapshot, mutation floors, pins) moves in the same PR.
5. The three TODOS entries above are deleted in the ship PR and named in its CHANGELOG entry.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 223: FLOWKINDS — every derive and compose path reads the same capital-flow kinds and refuses a malformed or truncated read by name

**Goal:** The composite and flow-source half of the derive gaps: every derive and compose path reads the same capital-flow kinds for a venue, and refuses a malformed or truncated read by name instead of storing a series as complete. `run_stitch_composite_job` reads Bybit flows through the same source as `run_derive_broker_dailies_job` (`fetch_bybit_unified_flows`, Phase 186), the composite member read gets Phase 186's read refusal, and each funding caller still on `on_malformed="drop"` gets a recorded decision. Context: PROD has 6 active Bybit keys (measured 2026-11-23), so the Bybit composite path is no longer a no-exposure case. The anchor and positions entries in TODOS stay out of scope and stay open. Trigger: founder decisions 2026-11-23, "Book phases: SENTRYSCRUB2, ALERTTRUTH, FLOWKINDS (composite half), DEADLEFTOVERS". Owns `TODOS.md` `[180-BYBIT-LIVE-FLOW-KINDS]`, `[186-COMPOSITE-MEMBER-READ-GAPS]`, `[186-OTHER-FUNDING-CALLERS-DROP]` and `[186-REALIZED-MALFORMED-COUNT]` (readings and closing conditions as written there).
**Requirements**: TBD
**Depends on:** none (independent of the MT5 parity phases)
**Success Criteria** (what must be TRUE):
1. The composite path and the per-key derive read the same Bybit flow kinds; a test feeds an off-chain (sub-account or universal transfer) flow to both and both book it as a flow, not P&L, shown RED before the fix.
2. The composite member read refuses a truncated or failed realized or funding read by name, as the per-key derive does; a test drives each refusal.
3. `run_sync_funding_job`, the composite member read and `okx_archive_job` each have a recorded decision (refuse by name or keep dropping), taken with the founder wherever a published number changes, and each decision is pinned by a test.
4. The per-key count of `daily_pnl_malformed_<venue>` flags on PROD is recorded (read-only) and brought to the founder, and the founder's ruling on refusing a malformed realized row is recorded before any refusal is switched on.
5. Every TODOS entry above that the phase closes is deleted in the ship PR and named in its CHANGELOG entry; the anchor and positions entries are untouched.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 224: DEADLEFTOVERS — dead SQL, retired job kinds still enqueued and inert plumbing are retired

**Goal:** Dead SQL, retired job kinds that still carry a live enqueue, and inert plumbing are removed, so nothing in the repo looks alive that is not. The dead `get_admin_compute_jobs` function is dropped by migration (migration-reviewer and rls-policy-auditor apply before merge). The retired job kinds' daily enqueue (`enqueue_poll_positions_for_all_strategies` and the retired `compute_analytics` family) is retired, filed as dead code and never as an outage. Phase 176's inert leftovers (`managerSideKeyIds`, `excludedManagerSide`, the `"legacy"` `equityCurveSource` value) and the reconstruct cap and marker machinery are deleted or given a live caller. `src/lib/database.types.ts` stops declaring functions that no longer exist. Trigger: founder decisions 2026-11-23, "Book phases: SENTRYSCRUB2, ALERTTRUTH, FLOWKINDS (composite half), DEADLEFTOVERS". Owns `TODOS.md` `[169-DEAD-ADMIN-JOBS-RPC]`, `[176-INERT-LEFTOVERS]`, `[176-RECONSTRUCT-CAP-MARKER-INERT]`, `[164.5-STALE-GENERATED-TYPES]` and the TODOS entry headed "Retired job kinds still carry a live daily enqueue that has fired nothing since 2026-06-14".
**Requirements**: TBD
**Depends on:** none (independent of the MT5 parity phases)
**Success Criteria** (what must be TRUE):
1. `get_admin_compute_jobs` no longer exists on TEST or PROD after the migration applies, and no caller, test or census still names it.
2. No daily enqueue creates or tries to create a job of a retired kind; the retired kinds' enqueue code and the `compute_job_kinds` rows go only once no queued row of that kind can still exist, measured read-only on PROD first.
3. `managerSideKeyIds`, `excludedManagerSide` and the `"legacy"` `equityCurveSource` value are deleted together with their tests, and every cap, marker and orphaned item listed in `[176-RECONSTRUCT-CAP-MARKER-INERT]` is removed or given a live caller, with `test_the_d04_inert_helpers_stay` retired or rewritten to match.
4. `src/lib/database.types.ts` declares no function that the schema lacks, and the way it is kept current (regeneration step with a freshness gate, or a recorded decision) is written down.
5. The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding; the five TODOS entries above are deleted in the ship PR and named in its CHANGELOG entry.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 225: ONEACCOUNTONCE — a user cannot connect the same exchange account more than once, and one account shared across users stays allowed

**Goal:** A user cannot connect the same exchange account more than once: a second key or draft that reads the same account under the same owner is refused by name at connect time, and any such pair already stored is surfaced and resolved instead of publishing one account's numbers under two names. One key or account shared across several users stays allowed, and a strategy-linked key may also sit in an allocator book; that is never called "manager-only by design". Context: Phase 155.2 found on PROD a key marked as a duplicate of MM2's account under the same owner that publishes MM2's numbers under the name MM3, and MM2's login shared with a draft key for FX-AI_V with no share link between them. `analytics-service/services/account_identity.py` stamps the share link. Trigger: founder decisions 2026-11-23, "several accounts can use one key. one account should not use the same key several times".
**Requirements**: TBD
**Depends on:** none (independent of the MT5 parity phases)
**Success Criteria** (what must be TRUE):
1. Connecting a key or saving a draft whose account identity matches a key the same owner already holds is refused with a named reason, in the wizard and in the API; a test drives it for an exchange key and for an MT5 login.
2. The same account connected by two different users stays allowed and keeps its share link; a test pins that the refusal is per owner, and a strategy-linked key in an allocator book is unaffected.
3. Every same-owner duplicate already stored on PROD is counted read-only and brought to the founder, and no strategy publishes another key's numbers under its own name once the phase ships.
4. Two keys that share a login always carry a share link, so a shared login with no link cannot recur; a test drives the stamping in `account_identity.py` for that case.
5. Any migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Progress (next milestone)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155.2. LIVEPARITY | 13/17 | Deferred to next milestone | - |
| 157. FOUNDER-CONFIRM | 1/3 | Deferred to next milestone | - |
| 221. SENTRYSCRUB2 | 0/? | Deferred to next milestone | - |
| 222. ALERTTRUTH | 0/? | Deferred to next milestone | - |
| 223. FLOWKINDS | 0/? | Deferred to next milestone | - |
| 224. DEADLEFTOVERS | 0/? | Deferred to next milestone | - |
| 225. ONEACCOUNTONCE | 0/? | Deferred to next milestone | - |

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
