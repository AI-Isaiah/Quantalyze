# Roadmap: Quantalyze

## Milestones

- ✅ **v1.21 UX — trustworthy, navigable, lean** — Phases 192–206 (shipped 2026-11-13)
- ✅ **v1.20 Backlog Burndown** — Phases 158–191 (shipped 2026-11-06)
- ✅ **v1.19 JOB/RATE** — Phases 143–146, 146.1, 146.2 (shipped 2026-08-20)
- 🚧 **v1.18 MT5-VERIFY & founder confirmations** — Phases 155, 155.1, 155.2, 157 (resumed 2026-11-13)
- ✅ **v1.17 MT5 — ingested, wizardable, surfaced** — Phases 147–154, 156 (shipped 2026-08-14)
- ✅ **v1.16 Production Resilience & Reliability** — Phases 140–142 (shipped 2026-08-14)
- Earlier milestones: see "Shipped Milestones" below.

## Phases

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

## Current Milestone: v1.18 MT5-VERIFY & founder confirmations (Phases 155, 155.1, 155.2, 157)

**Goal:** The numbers Quantalyze renders for the live funded MT5 accounts MM2, MM3 and FX-AI_V are
proven true against the terminal's and the broker's own figures, and the handful of observations
only the founder can make are made.

**Scope:** 15 requirements — PARITY-01..04, MT5-06..10, MT5-15, MT5-GOAL-01 (umbrella acceptance),
FCONF-01..04 — per `.planning/REQUIREMENTS.md`. Started 2026-08-14, parked 2026-08-20, resumed
2026-11-13. Research: `.planning/research/SUMMARY.md` (2026-11-13); its Phases A, B and C are 155,
155.1 and 155.2 here. Phase numbers 155 and 157 were reserved for this milestone; 155.1 and 155.2
were written by the roadmapper at creation, not inserted later, so they carry no INSERTED tag.

**Founder decisions D-A..D-E (2026-11-13) are binding on every phase.** They are stated once, in
`.planning/REQUIREMENTS.md`, and cited here by id only: D-A "Pre-mark history: Accept, judge closed
P&L", D-B "The 1% is return gap, in points", D-C "Statements: the founder gets broker statements",
D-D "Clock read: Allow narrow read", D-E "Weekend reading: Yes, this weekend". Settled 2026-08-14
and unchanged: the measurement window ends before the run day.

**Open founder decisions, deliberately NOT settled by any criterion below** (research SUMMARY,
"Founder Decisions Needed", items 7–10): the clock-mismatch behaviour (refuse the key's persist
with an `ops_alert`, or alert only); whether the three accounts share one server; the MT5-09
surface list, including the surfaces that show only published strategies while MT5 is not
advertised; and the smaller rulings that surface during the session (a non-zero Credit, a
swap-free account's admin fee, BALANCE-typed deals that are not capital, a truncated ledger).
Each is asked at the discuss-phase of the phase that needs it.

**Gates:**

- ⭐ **Gate 1 cleared on PROD 2026-11-13.** All three keys show `sync_status='complete'` with
  `last_sync_at` 01:02–01:09 UTC that day, so the new investor passwords are in. The 2026-08-14
  blocker "new MT5 investor passwords" is closed. It comes back only as FCONF-04's re-check after
  the rotation.
- ⛔ **Gate 2 still stands: the founder at the MT5 terminal on a trading day.** It blocks the
  founder session inside 155.2, and 157, which rides in that sitting. 155 and 155.1 need no
  trading day.
- ⏰ **The weekend reading (D-E) is time-critical and waits for no phase.** The founder reads the
  frozen terminal Balance and Equity for each account on Sat 2026-11-14 or Sun 2026-11-15 (the
  Friday 2026-11-13 close). It is recorded with provenance `terminal_reading` in the untracked
  capture directory and enters 155.2 as one Gate B edge. Missing it costs a week (research
  decision 3).

⛔ **Do not advertise MT5 until Phase 155.2 passes.** Carried from v1.17, where it read "until
Phase 155 passes". Re-pointed 2026-11-13: Phase 155 is now the parity harness, which proves
nothing about our numbers by passing, so the old wording would lift the ban one phase too early.
No surface, copy or badge advertises MT5 or calls it verified before 155.2 passes
(`REQUIREMENTS.md` Out of Scope, corrected the same day).

**Ordering (dependencies, not preferences):**

- **155 PARITYHARNESS and 155.1 SERVERCLOCK start together.** Neither needs the founder at the
  terminal. 155.1 has the longest lead time: a contract re-cut, a migration that needs
  migration-reviewer and rls-policy-auditor clean before merge and then auto-applies to TEST and
  PROD with no human stop, a Railway deploy, and a weekday PROD reading row per key.
- **155.2 LIVEPARITY starts after 155 passes.** Its discuss, planning and the fixes for 155's
  pre-verification findings need no founder, so they can run while 155.1's deploy lands. Its
  founder session waits on 155.1's reading deployed with a weekday PROD reading row per key. It
  does not wait on 155.1's completion: MT5-06's last leg, the terminal-displayed time of a
  near-midnight deal, is read in that session, so 155.1 closes after it. That is why 155.2's
  **Depends on** names only 155, the one completion dependency it has.
- **157 FOUNDER-CONFIRM rides in the same sitting as the 155.2 session.** The
  `MT5_SPIKE_INVESTOR_PASSWORD` rotation comes after the last live read that needs it (any 155.1
  tick-read spike run with the spike scripts, and the 155.2 session), and gate 1 is re-checked
  after it.

**Evidence at HEAD** (spot-checked 2026-11-13 at `40ff7161`):
- Confirmed: `test_read_only_surface_no_trade_methods` in
  `analytics-service/tests/test_mt5_client_contract.py` lists `symbol_info_tick` as forbidden.
  `analytics-service/services/mt5_server_clock.py` reads `MT5_SERVER_TIME_RULE` and accepts only
  `eu` or `us`. `reconcile_parity` lives in `analytics-service/scripts/mt5_soak.py`.
  `src/app/portfolio-pdf/[id]/page.tsx` is the Phase 195 retirement landing and renders no
  figures. `scenario-blend-panels.ts` is not in the tree. `MT5_PARITY_TOLERANCE` does not exist
  yet. `MT5_SPIKE_INVESTOR_PASSWORD` is read by `analytics-service/scripts/mt5_spike.py` and
  `analytics-service/scripts/mt5_soak.py`.
- Not confirmed: every PROD figure (each key's first mark day `S`, open P&L at the candidate
  Fridays, stored flags, Credit, the server per account, record length). 155's pre-flight census
  measures them. The terminal Report format and the tick read through `mt5linux` on Wine are
  unmeasured; they are research flags for 155 and 155.1.

⚠️ **Public repo:** account labels only (MM2, MM3, FX-AI_V). No login, server name, amount,
account number or PROD id in tracked text. Raw captures stay in the untracked capture directory.

### Phases (v1.18)

- [x] **Phase 155: PARITYHARNESS — an agent-built harness can prove our MT5 numbers wrong before the founder sits down** - A PROD census per account, a read-only capture of our side, provenance-locked oracle intake, a compare engine shown RED on broken inputs, and the agent-checkable halves of MT5-09 and MT5-15 measured; no founder needed (completed 2026-11-14)
- [ ] **Phase 155.1: SERVERCLOCK — the worker reads the MT5 server clock live and keeps every reading** - One narrow tick-time read, asserted against the configured rule inside the leased derive and persisted write-once by a pure-DDL migration; parallel with 155, no trading day needed
- [ ] **Phase 155.2: LIVEPARITY — on a trading day, our MT5 numbers match the terminal's and the broker's within 1%** - The founder's scripted session on MM2, MM3 and FX-AI_V, Gate A and Gate B per account, every surface the same, every gap fixed at its root or ruled on; after 155, session after the 155.1 deploy
- [ ] **Phase 157: FOUNDER-CONFIRM — the observations only the founder can make are made** - Wizard resume, the amber recomputing block and the four 153.7 copy members seen in a real wizard; the spike password rotated after the live reads and gate 1 re-checked; same sitting as the 155.2 session
- [x] **Phase 207: RETRYPROP — every error page's Try again button works** - Boundaries use Next's real `retry` prop; independent of the MT5 phases (completed 2026-11-14)
- [x] **Phase 208: UIQUICK — alert-digest link, browse error state and share-link failures tell the truth** - Quick UI fixes; independent of the MT5 phases (completed 2026-11-14)
- [x] **Phase 209: SCRUBLEAKS — error reports carry no raw database details and never get lost** - Error-report leaks; independent of the MT5 phases (completed 2026-11-14)
- [x] **Phase 210: PUBLICTRUTH — public factsheet cues come from real data only** - Public factsheet truth; independent of the MT5 phases (completed 2026-11-14)
- [x] **Phase 211: SYNCJOBS — trade fetches skip nothing and failed jobs keep their real status** - Sync and jobs correctness; independent of the MT5 phases (completed 2026-11-14)
- [ ] **Phase 212: WIZTRUTH — the wizard and key screens name the real cause, and every remedy they offer can work** - Wizard and key-screen truth; independent of the MT5 phases
- [ ] **Phase 213: KEYFLOW — a key and its draft can never be silently mixed up, and every key state has a way out** - Key and draft flow, four founder decisions; independent of the MT5 phases
- [ ] **Phase 214: FRESHTRUTH — refresh work and freshness readings match what can actually change** - Refresh and freshness truth; independent of the MT5 phases
- [ ] **Phase 215: TESTREACH — every test that guards money math or error contracts actually runs, and test apps match production** - CI-only test reach; independent of the MT5 phases

### Phase 155: PARITYHARNESS — an agent-built harness can prove our MT5 numbers wrong before the founder sits down

**Goal:** Before the founder sits at the terminal, an agent-built harness captures our side from PROD read-only, accepts only external oracle inputs, and returns a per-account verdict it has been shown able to fail. Every check that needs no founder (the PROD census, the MT5-09 data layer, the MT5-15 flags) is already measured, so its findings reach the fix loop early. Research Phase A.
**Requirements**: PARITY-01, PARITY-02, PARITY-03, PARITY-04
**Depends on:** Nothing (first of the milestone; runs in parallel with 155.1)
**Plans:** 11/11 plans complete
**UI hint**: no

Research flags (`/gsd-plan-phase --research-phase`): the Report parser slice (the export's encoding, separators, column headers and whether a per-deal Balance column exists are undocumented, so the parser is written against one real export and fails loud on an unknown header) and the surface slice (re-locate "strategy detail", confirm the factsheet loader). The engine and taxonomy, the capture SQL and its write-keyword gate follow existing precedents (`parity_diff.py`, the marksource census) and need no research.

**Success Criteria** (what must be TRUE):
1. A pre-flight census, read from PROD by SELECT only with the marker query first, records for MM2, MM3 and FX-AI_V: first mark day `S`, open P&L at the candidate Friday edges, stored `data_quality_flags`, account unit, published status, record length and `computed_at`, plus an inception identity check (the ledger rolled back past the first deal comes to about 0). (PARITY-04)
2. Our side is captured from persisted PROD rows by versioned SELECT-only SQL behind a write-keyword test that has been shown able to fail. Raw figures stay in the untracked capture directory; the tracked record holds only ratios, ordinals and verdicts. (PARITY-03)
3. Every expected value the harness compares carries provenance `terminal_reading`, `terminal_report_export` or `broker_statement`, and the harness refuses any other source by name, including our own gateway and `mt5_soak.reconcile_parity`. The oracle intake reads the founder's worksheet and an All-History Report (a synthetic fixture until a real export exists) by column header, never by index, and fails loud on an unknown header or on a worksheet missing any reading the founder-session script asks for. (PARITY-01)
4. The harness goes RED on each deliberately broken input (a reclassified BALANCE deal, a one-hour clock shift, a dropped oldest deal) and GREEN again after a byte-backup restore, proven in the phase record. A dress rehearsal on synthetic oracle files plus a real PROD capture produces a per-account verdict against the one named constant `MT5_PARITY_TOLERANCE = 0.01` (D-B). (PARITY-02)
5. Pre-verification for 155.2, which closes both requirements: the MT5-09 surface matrix, on the surface list fixed at this phase's discuss-phase and cited by symbol, compares each account's numbers at the data layer, and every data-quality flag these accounts carry (MT5-15) is read from stored data and classified. Each discrepancy is recorded as a named finding with its root-cause lead for MT5-10's fix loop in 155.2; nothing is fixed silently here.

Plans:
**Wave 1**
- [x] 155-01-PLAN.md — tracer: synthetic capture sealed, provenance-gated worksheet and a Gate B verdict end to end, plus the one synthetic account (Wave 1)
- [x] 155-02-PLAN.md — census SQL (marker, bind, census-accounts, census-edges), write-keyword gate shown able to fail, `.mt5-parity/` gitignore pin (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 155-03-PLAN.md — the ten SELECT-only capture files under the gate, run order and truncation fallback in the runbook (Wave 2)
- [x] 155-05-PLAN.md — All-History Report parser by header (UTF-8 and UTF-16) and the complete founder worksheet intake (Wave 2)
- [x] 155-09-PLAN.md — MT5-09 data-layer surface matrix over all live surfaces, cited by symbol (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 155-04-PLAN.md — every census and capture file executed on a throwaway cluster against the capture contract (Wave 3)
- [x] 155-06-PLAN.md — Gate A legs, window validation and picker, and the clock, flow and pre-mark explainers (Wave 3)
- [x] 155-08-PLAN.md — MT5-15 flag classes, surface-matrix findings, census and findings renderers, tracked-text scanner (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 155-07-PLAN.md — three RED proofs with byte-backup restore, rehearsal flag, verdict and red-proof CLI, purity gate (Wave 4)
- [x] 155-10-PLAN.md — orchestrator-only PROD census and capture through the MCP, sealed, and the census record (Wave 4; not autonomous)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 155-11-PLAN.md — dress rehearsal, RED-proof record and findings ledger from the real capture (Wave 5)

### Phase 155.1: SERVERCLOCK — the worker reads the MT5 server clock live and keeps every reading

**Goal:** The worker measures the MT5 server's UTC offset live inside every leased derive, checks it against the configured `Mt5ServerClock` rule, and keeps each reading write-once, so a wrong or changed offset is caught by the system, not by a person reading a chart. It is a data-integrity product change, not harness code: the harness itself never touches the gateway. Research Phase B.
**Requirements**: MT5-06
**Depends on:** Nothing (first of the milestone; runs in parallel with 155)
**Plans:** TBD
**UI hint**: no

Research flag (`/gsd-plan-phase --research-phase`): a live spike on whether the tick read answers through `mt5linux` on Wine for visible Market Watch symbols, whether its time uses the same encoding as a deal's `time`, what an investor session's Market Watch holds, and how fresh ticks are during session breaks. Check what the parked MT5SERVERLEARN branch (164.6.6.3.6) holds first. Any spike run with `MT5_SPIKE_INVESTOR_PASSWORD` comes before 157's rotation.

⚠️ **This phase closes after the 155.2 founder session, by design.** MT5-06's near-midnight clause is judged against the terminal-displayed time of a real deal, and the founder reads that time in the one scripted session (founder 2026-11-13: one short session on the next trading day). Everything else here closes before that session, and 155.2's session waits only on the deploy and the PROD reading rows (criteria 1–4).

**Success Criteria** (what must be TRUE):
1. One named, tick-time-only `Mt5Client` method is admitted (D-D). The contract test's forbidden list stays, and a test pins the one exception, after the `terminal_info` precedent (153.3/D-31).
2. Each leased derive takes a server-clock reading inside its session and asserts it against the configured `Mt5ServerClock` rule; Phase 175's `MT5_SERVER_TIME_RULE` stays the carrier, and the reading is never written back as configuration. A mismatch is never silent; it follows the behaviour the founder chooses at discuss-phase.
3. Readings persist write-once through a pure-DDL migration with RLS and no data-reading DO block, because it auto-applies to TEST and then to PROD with no human gate. migration-reviewer and rls-policy-auditor are clean before merge. After the Railway deploy, at least one weekday PROD reading row exists for each of the three keys before the 155.2 session.
4. The readings show, per key, whether MM2, MM3 and FX-AI_V share one server rule, without a server name in tracked text. A split is reported to the founder before the 155.2 session, because the single worker-wide rule would then be wrong for at least one account (the per-server clock is a Future requirement this would bring forward).
5. At least one real near-midnight deal from the DST divergence week (2026-10-25..11-01) is preselected, and a test pins its UTC day and goes RED under the wrong rule (`eu` against `us`). Last leg, read in the 155.2 session: the founder's terminal-displayed time for that deal lands on the UTC day of (terminal-displayed server time − the offset in force).

Plans:
- [ ] TBD — plans not listed yet

### Phase 155.2: LIVEPARITY — on a trading day, our MT5 numbers match the terminal's and the broker's within 1%

**Goal:** On one trading day, with the founder at the terminal, the numbers Quantalyze renders for MM2, MM3 and FX-AI_V are compared with the terminal's and the broker's own figures, and every difference is fixed at its root or ruled on by the founder, until the parity verdict passes on every surface. This is the only phase gate 2 blocks, and the phase whose pass lifts the advertising ban. Research Phase C.
**Requirements**: MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01
**Depends on:** Phase 155 (dress rehearsal green). The founder session inside this phase also waits on 155.1's reading deployed with a weekday PROD reading row per key; that is a deploy condition, not a completion dependency (see 155.1)
**Plans:** TBD
**UI hint**: no

Carried context, not requirements: timeout findings #8 and #10 are tuned only from percentile data across several nightlies, with fresh and cached logins split, and are booked separately if the data is not in by the milestone close (`REQUIREMENTS.md` Future). The product call on MT5 as a composite member stays out of scope.

**Success Criteria** (what must be TRUE):
1. The founder's trading-day session on the live funded accounts MM2, MM3 and FX-AI_V is recorded: real trade mode and the trading day per account, an All-History Report per account, the Summary block at an instant T, the statement figures (D-C), and the terminal-displayed time of 155.1's preselected near-midnight deal (MT5-06's last leg). A demo, the v1.15 soak account or a weekend-only run is refused as the run; the weekend reading (D-E) enters only as a Gate B edge. (MT5-08)
2. For each account the harness reports Gate A (days before `S`, closed-trade balance basis, against the All-History export; D-A) and Gate B (days from `S`, open P&L included, against the statements and the weekend reading) within `MT5_PARITY_TOLERANCE`, as a return gap in points (D-B) checked separately for cumulative return, start level and end level, over windows that end before the run day. The instant-T reading is checked on D+1 after a re-anchoring sync. (MT5-07)
3. Every surface that renders strategy performance, on the list fixed in 155 (the portfolio PDF and `scenario-blend-panels.ts` dropped, cited by symbol), shows the same numbers for these accounts in the founder's signed-in browser, bound to `computed_at`. This closes the data-layer matrix 155 measured. (MT5-09)
4. Every discrepancy, from 155's pre-verification or the live run, is fixed at its root wherever it lives, shared backbone money-math included and never scoped to `exchange === 'mt5'`, and the comparison is re-run. A difference passes only within tolerance, consistently withheld on every surface, or in a named bucket with a recorded founder ruling; an empty `unexplained` list alone is not the exit. Every data-quality flag these accounts carry is eliminated or understood and accepted in writing. (MT5-10, MT5-15)
5. The founder confirms live that an MT5 strategy he uploaded ingests, projects in a scenario and has a viewable factsheet. (MT5-GOAL-01)

Plans:
- [ ] TBD — plans not listed yet

### Phase 157: FOUNDER-CONFIRM — the observations only the founder can make are made

**Goal:** The observations only the founder can make about shipped wizard behaviour are made in the same sitting as the 155.2 session, and the spike investor password is rotated once no live read needs it, with gate 1 shown intact afterwards.
**Requirements**: FCONF-01, FCONF-02, FCONF-03, FCONF-04
**Depends on:** the 155.2 founder session (the same sitting, not 155.2's completion); FCONF-04's rotation comes after that session's last live read
**Plans:** TBD
**UI hint**: no (it observes shipped UI; a failed observation is a finding, not a new design)

**Success Criteria** (what must be TRUE):
1. With a live draft, the founder clicks `+ Strategy`, sees the resume banner, and Resume lands on the draft's step; the 2026-08-04 wizard restart does not recur. (FCONF-01)
2. The founder sees the amber `wizard-sync-recomputing` block render as specified: its heading, no red envelope, no metric numbers. (FCONF-02)
3. The founder sees the four 153.7 copy members render in a real wizard, and no Retry control appears on `SEAM_INTERNAL_FAULT`. (FCONF-03)
4. `MT5_SPIKE_INVESTOR_PASSWORD` is rotated after the last live read that needs it, and gate 1 is re-checked afterwards: all three keys sync `complete` on a sync that ran after the rotation. (FCONF-04)

Plans:
- [ ] TBD — plans not listed yet

### Progress (v1.18)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155. PARITYHARNESS | 11/11 | Complete | 2026-11-14 |
| 155.1. SERVERCLOCK | 0/? | Not started | - |
| 155.2. LIVEPARITY | 0/? | Not started | - |
| 157. FOUNDER-CONFIRM | 0/? | Not started | - |
| 207. RETRYPROP | 1/1 | Complete | 2026-11-14 |
| 208. UIQUICK | 5/5 | Complete | 2026-11-14 |
| 209. SCRUBLEAKS | 5/5 | Complete | 2026-11-14 |
| 210. PUBLICTRUTH | 5/5 | Complete | 2026-11-14 |
| 211. SYNCJOBS | 7/7 | Complete | 2026-11-14 |
| 212. WIZTRUTH | 0/? | Not started | - |
| 213. KEYFLOW | 0/? | Not started | - |
| 214. FRESHTRUTH | 0/? | Not started | - |
| 215. TESTREACH | 0/? | Not started | - |

### Requirement Coverage (v1.18)

| Phase | Requirements |
|-------|--------------|
| 155 | PARITY-01, PARITY-02, PARITY-03, PARITY-04 |
| 155.1 | MT5-06 |
| 155.2 | MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 |
| 157 | FCONF-01, FCONF-02, FCONF-03, FCONF-04 |

15/15 mapped, each to exactly one phase. Two requirements have an earlier part in another phase, named in that phase's criteria: MT5-09 and MT5-15 are pre-verified at the data layer in 155 (criterion 5) and close in 155.2. MT5-06 is mapped to 155.1 and its near-midnight last leg is read in the 155.2 session (155.1 criterion 5, 155.2 criterion 1).

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


## Current position

⭐ **v1.21 UX — trustworthy, navigable, lean — CLOSED 2026-11-13** (audit `tech_debt`, 32/32). ⛔ Corrected 2026-11-13: the next milestone is v1.18, resumed the same day (below). The composer range-as-dates fix is a Future item in v1.18's `REQUIREMENTS.md`, not v1.18 scope, and TERMS-01/02 stay carried for a later milestone. The sentence this replaced said the next milestone was not started and carried both.

⭐ **v1.20 Backlog Burndown — CLOSED 2026-11-06.** Its Phase 188 SC-4 residual (D-13) was closed by 202 RESIDCHURN and 203 B3TRUNC in v1.21.

🚧 **v1.18 MT5-VERIFY & founder confirmations (Phases 155, 155.1, 155.2, 157)** — RESUMED 2026-11-13 and roadmapped; nothing started. Gate 1 (new investor passwords) cleared on PROD 2026-11-13. Gate 2 (the founder at the terminal on a trading day) blocks only the 155.2 session and 157. 155 and 155.1 start first, in parallel. Parked from 2026-08-20 to 2026-11-13; the parked text is in [`milestones/v1.21-ROADMAP.md`](milestones/v1.21-ROADMAP.md) as lineage.

### Phase 207: RETRYPROP — every error page's Try again button works

**Goal:** Every error boundary's Try again button calls the `retry` prop Next 16.4.2 actually passes (`{ error, reset, retry }`), not `unstable_retry`, which is undefined at runtime. Closes TODOS `196-ERROR-BOUNDARY-UNSTABLE-RETRY-01` (booked by founder 2026-11-13 from the TODOS prune, PR #1259).
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases; runs in parallel with them.
**Plans:** 1/1 plans complete
**Success Criteria** (what must be TRUE):
1. No error boundary under `src/app` reads `unstable_retry`.
2. A test renders every boundary through the props Next's own `error-boundary.js` passes and proves Try again calls `retry`; it goes RED when one boundary is reverted.

Plans:
- [x] 207-01-PLAN.md — every error boundary's Try again calls `retry`, proven through Next's real ErrorBoundary

### Phase 208: UIQUICK — alert-digest link, browse error state and share-link failures tell the truth

**Goal:** Three user-facing lies are fixed: the alert digest email stops claiming the dashboard shows its alerts (founder decision D-01, 2026-11-14; booked as "the link lands where alerts are shown"), the browse page tells a failed read apart from an empty one, and share-link failures are logged and tell the user what happened. Closes TODOS `195-ALERT-DIGEST-LINK-TARGET`, `195-BROWSE-EMPTY-VS-ERROR`, `170.6.1-SFH2-SHARE-FAILURES-UNLOGGED`, the R2 ShareableLink dialog-copy entries and `SHARE-HOST-01` (added 2026-11-14 from the FIX NOW triage). Booked by the founder 2026-11-13 ("Quick UI fixes") from the TODOS prune, PR #1259.
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases and of each other.
**Plans:** 5/5 plans complete
**Success Criteria** (what must be TRUE):
1. The digest email (`src/lib/email.ts`) no longer claims the dashboard shows the alerts it lists: its link reads "Open your allocation →" and still targets `/allocations`. ⛔ CORRECTED 2026-11-14 by founder decision D-01 (`208-CONTEXT.md`, "Fix the email wording"); the original criterion, "targets a page that renders the alerts it announces", is kept here as lineage.
2. `getPopulatedCategorySlugs` distinguishes error from empty, and browse renders each state distinctly.
3. Every `ShareableLink.tsx` catch logs, a 401/403 says what it is, and the manual-copy fallback shows the URL.
4. Each fix carries a test that goes RED when it is reverted. ⭐ Carve-out (2026-11-14, `208-CONTEXT.md` D-11): `170.6.2-SHAREABLELINK-D05-RED` is test hardening for a CI-only flake that does not reproduce locally. It closes by the cited mechanism, an explicit per-await timeout and repeated green runs both quiet and under load, and no neuter-RED is claimed for it.
5. Both share routes (`strategies/[id]/share`, `allocator/scenario/share`) build the URL from the CSRF-validated request origin ahead of `NEXT_PUBLIC_APP_URL`; a test minting on a non-production host gets that host back. (added 2026-11-14, `SHARE-HOST-01`) ⭐ Accepted consequence (founder decision 2026-11-14, WR-01 "Accept and record", `208-CONTEXT.md` D-16): a link minted on production's own per-deployment `NEXT_PUBLIC_VERCEL_URL` host, or on an extra `NEXT_PUBLIC_ALLOWED_ORIGINS` host, comes back on that host. The D-09 WebKit check stands on the recorded Playwright WebKit iPhone simulation (founder, "Accept the simulation").

Plans:
**Wave 1**
- [x] 208-01-PLAN.md — /browse tells a failed category read from an empty one; the alert digest link reads "Open your allocation →"
- [x] 208-02-PLAN.md — share-link mint failures are logged, say what happened (401, 403/404, signed-out redirect) and are announced
- [x] 208-05-PLAN.md — both share routes build the link on the CSRF-validated request host, so a link minted on a preview host comes back on that host (D-16)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 208-03-PLAN.md — the copy-failed dialog has its own Copy link and shows the URL on both lanes; hanging copies end visibly failed

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 208-04-PLAN.md — one WebKit iPhone check of the copy-failed dialog and the binding loaded-run reading of the private-link test

### Phase 209: SCRUBLEAKS — error reports carry no raw database details and never get lost

**Goal:** Error reports never carry raw PostgREST `details`/`hint` and are never lost: scrub at the capture boundary, a `beforeSend` that cannot throw, a UUID guard on the signed-out OG route, and a coded 400 for malformed JSON on validate-and-encrypt. Closes TODOS `204-SENTRY-RAW-SUPABASE-ERRORS`, `SHARE-QA-07`, `170.3-OG-MALFORMED-ID` and the validate-and-encrypt bare `req.json()` entry; `SHARE-D-164-C` (`create_scenario_share` in the audit RPC list) rides along. Booked by the founder 2026-11-13 ("Error-report leaks") from the TODOS prune, PR #1259.
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases and of each other.
**Plans:** 5/5 plans complete
**Success Criteria** (what must be TRUE):
1. `scrubCaptureInput` scrubs non-Error objects, so no capture site can forward `details`/`hint`.
2. `scrubRecordStrings` survives frozen and getter-only objects without losing the report.
3. A malformed id on the OG route returns early without spending the Sentry slot.
4. Malformed JSON on validate-and-encrypt returns a coded 400.
5. Each fix has a test that goes RED when it is reverted.

Plans:
- [x] 209-01-PLAN.md — Wave 1: capture-mode renderer, so `captureToSentry` never forwards PostgREST `details`/`hint` (SC1, D-01..D-05)
- [x] 209-02-PLAN.md — Wave 1: guarded `scrubSentryEvent` that withholds at the nearest writable parent and never throws or returns null (SC2, D-06..D-09a)
- [x] 209-03-PLAN.md — Wave 1: `isUuid` guard on the OG route; P3 rewritten with a real status check; slot-not-spent test (SC3, D-10..D-12)
- [x] 209-04-PLAN.md — Wave 1: coded 400 for a malformed, null or non-object body on validate-and-encrypt; two censuses moved (SC4, D-13, D-14)
- [x] 209-05-PLAN.md — Wave 1: `create_scenario_share` under the audit law, with a literal typed call and a positive-control pin (SHARE-D-164-C, D-15, D-16)

### Phase 210: PUBLICTRUTH — public factsheet cues come from real data only

**Goal:** Public factsheet cues come only from real data: the published-venues read ignores closed key windows, demo producers no longer ship made-up `peerPercentile`/`allocatorPortfolios` to the client, and a malformed gap record is reported, not shown as "no gaps". Closes TODOS `170.6.1-VENUES-CLOSED-KEY-WINDOWS`, `193-DEMO-PAYLOAD-PRODUCERS` and `167.1.2.2.2-GAP-RECORD-SILENT-PARSE`. Booked by the founder 2026-11-13 ("Public factsheet truth") from the TODOS prune, PR #1259.
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases and of each other.
**Plans:** 5/5 plans complete
**Success Criteria** (what must be TRUE):
1. `get_published_trade_venues` filters closed key windows, so a key rotation does not raise a false venue-mismatch cue (migration reviewed by migration-reviewer and rls-policy-auditor).
2. No public payload carries invented peer or allocator data.
3. A malformed gap record reaches Sentry and the tear sheet withholds instead of claiming no gaps.
4. Each fix has a test that goes RED when it is reverted.

Plans:
**Wave 1**
- [x] 210-01-PLAN.md — venues: `get_published_trade_venues` ignores closed `strategy_keys` windows (new migration, rollback, gate arms, mutation census, badge and reader pins) (wave 1)
- [x] 210-02-PLAN.md — demo payload: the api arm stops shipping `peerPercentile` and `allocatorPortfolios` (wave 1)
- [x] 210-03-PLAN.md — the no-op `hideAllocatorSection` prop and its callers removed (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 210-04-PLAN.md — dead producers `peer-cohort.ts` and `allocator.ts` deleted, census rows dropped (wave 2)
- [x] 210-05-PLAN.md — gap record: a malformed `unrecovered_gaps` reaches Sentry and the page says unavailable; the phase's one cache-key bump (wave 2)

### Phase 211: SYNCJOBS — trade fetches skip nothing and failed jobs keep their real status

**Goal:** Sync and job bookkeeping are correct on every path: a user-triggered trade fetch no longer seeds from the poll-overwritten `last_sync_at`, the enqueue dedup no longer drops the caller's metadata, and composite `_stamp_failed` stops reading status live. Closes TODOS `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED`, `161.1-D11` and `161.1-D5`; the design for D11 is settled at discuss-phase. Booked by the founder 2026-11-13 ("Sync and jobs correctness") from the TODOS prune, PR #1259.
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases and of each other.
**Plans:** 7/7 plans complete
**Success Criteria** (what must be TRUE):
1. A user-triggered fetch cannot skip trades that the daily poll's `last_sync_at` write would otherwise hide.
2. An enqueue that dedups onto an existing job keeps or merges the caller's metadata by a recorded rule.
3. Composite failure stamping uses the status captured at job start, like Phase 161.1's other paths.
4. Each fix has a test that goes RED when it is reverted.

Plans:
**Wave 1**
- [x] 211-01-PLAN.md — tracer: the fetch-trades route seeds from the stored daily high-water (shared helper `services/trade_resume.py`, moved out of the cron router), never from `last_sync_at` (Wave 1)
- [x] 211-02-PLAN.md — composite `_stamp_failed` reads the status captured at job start (D5), the failed-row read narrowed to its flags (Wave 1)
- [x] 211-03-PLAN.md — D11 migration: side table `compute_job_dedup_events` and helper `_record_enqueue_dedup` at both return sites of both overloads, SITE-A gate arm, snapshots, rollback, proven on the throwaway lanes (no `db push`) (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 211-04-PLAN.md — the queued sync job seeds both reads from the stored high-water; the fills cursor governs the fills read only (Wave 2)
- [x] 211-05-PLAN.md — D11 gate breadth: SITE-B forced race, the predicate matrix, guards, ACLs and the 7-arg body pin, 15 arms each with a biting twin (Wave 2; the review fix WR-01 later added the DPC-SKIP arm, so the shipped gate has 16)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 211-06-PLAN.md — mutation-runner and anti-skip censuses moved once on the measured corpus, each guard shown able to fail (Wave 3)
- [x] 211-07-PLAN.md — marker-set parity of the new helper in Python and TS, and the D-02 comments brought up to date (Wave 3)

### Phase 212: WIZTRUTH — the wizard and key screens name the real cause, and every remedy they offer can work

**Goal:** Every refusal the wizard and the key screens show names the cause that was actually established, and every remedy it offers can succeed. The composite arm of `SyncPreviewStep` branches on the real verdict instead of hardcoding `GATE_SERIES_PROVENANCE_UNVERIFIED`. `MT5_GATEWAY_MISCONFIGURED_DETAIL` (`mt5_probe.py`), the "cause unknown" fallback, stops asserting arm 2's "Disable automatic trading through the external Python API" option. The three `keys/validate-and-encrypt` consumers (`ApiKeyManager`, `StrategyForm`, `AllocatorExchangeManager`) render from `code`, not prose. An MT5 connect that meets a running derive either waits it out or says it is busy (`_MT5_LEASE_WAIT_S` is 20 s against a 40 s derive read plus a 10 s restart, `mt5_concurrency.py`). An orphaned MT5 key is refused before the 120 s validate where its identity is known first. Closes TODOS `0.07` (`D-161-07-A`), `0.09`, `D-161-05-B`, Phase 153.5 finding #10, the WIZFORM-02 §D entry, `WIZFORM-02-VE-CODECHANNEL`, `164.2-WIZARD-BARE401` and `CONTACT-SUPPORT-POINTERS-01`. Booked by the founder 2026-11-14 from the FIX NOW triage.
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases and of the other FIX NOW phases.
**Plans:** 0 plans
**Success Criteria** (what must be TRUE):
1. A composite gated `sampled_gapped` or `fill_derived_unproven` renders `GATE_SERIES_EXAMINED_REFUSED`, not the provenance sentence.
2. `MT5_GATEWAY_MISCONFIGURED_DETAIL` names no cause, and the founder approves its copy (the `161-UI-SPEC.md` arm 3 contract moves with it).
3. The three validate-and-encrypt consumers render from `code`, and a bare upstream 401/403 with no seam envelope answers a named code.
4. An MT5 connect during a running derive waits long enough, or says it is busy and when to retry. The wait is sized from measured hold times, not guessed.
5. An orphaned MT5 key is refused without waiting out validation wherever its identity is known before validation.
6. Every remaining "contact support" pointer names a real next step.
7. No migration.
8. Each fix has a test that goes RED when it is reverted.

Plans:
- [ ] TBD (run /gsd-plan-phase 212 to break down)

### Phase 213: KEYFLOW — a key and its draft can never be silently mixed up, and every key state has a way out

**Goal:** A wizard draft is never resumed onto a different key without the user seeing it, and every key state the product can reach has a control that gets the user out. Four founder decisions, taken 2026-11-14 through AskUserQuestion:
- (a) **Refuse when unknown.** Today `sessionKeyMatches` (`src/lib/wizard/localStorage.ts`) returns true for an incoming `null`. That `null` means two things: the CSV branch, which provably has no key, and the API branch, where `initialDraft` was nulled (a read fault, or a draft from the other branch) and no preselect exists. In the second case the stored key-A `wizardSessionId` is restored. The create-with-key F6 fence then returns key A's strategy and `api_key_id` for a key-B submit, without comparing keys and without a `deduped` flag. The decision: an unknown incoming key meeting a stored key does not resume the draft, and create-with-key returns a `deduped` flag. This supersedes founder-locked Phase 164.2.1 decisions D-01 (the 4th positional parameter contract) and D-02 (that boundary) as far as the unknown case goes. The CSV branch's literal `null` stays load-bearing.
- (b) **Add Disconnect.** An orphaned key (no strategy, no draft) has no release surface: `ApiKeyManager` mounts only on a strategy's edit page, Profile → Exchanges is allocator-only, and `cleanup_abandoned_wizard_drafts()` never picks a draftless key up again. The decision: a Disconnect control (disconnect, never delete) on the manager's "No strategy yet" row, with the `KEY_ORPHANED` copy pointing at it.
- (c) **Block it.** `run_stitch_composite_job` has no `mt5` arm, so an MT5 composite member permanently fails its job. Yet `composite/add-key` accepts `mt5`, and the wizard offers an MT5 composite card under `MT5_UI_ENABLED` (`MultiKeyConnectStep`). The decision: MT5 cannot be a composite member. The card is removed and `composite/add-key` refuses `mt5` with a named code.
- (d) **Hold and show pending.** A drawer-added leg has no asset class until its `/returns` probe settles, so the scenario composer's blend basis flips √365 → √252 mid-render, and vol, Sharpe and Sortino change with no user action. The decision: basis-dependent metrics show as pending until every leg's asset class resolves.

Closes TODOS `164.2.1-INCOMING-NULL-CONFLATION`, `0.08` (`D-161-05-A`), the Phase 153.6 "MT5 as a composite member" OUT line, and `0e` (`159-BASIS-FLIP`). Booked by the founder 2026-11-14 from the FIX NOW triage.
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases and of the other FIX NOW phases.
**Plans:** 0 plans
**Success Criteria** (what must be TRUE):
1. When the incoming key cannot be determined and a stored draft carries a key, the wizard does not resume that draft; create-with-key's response carries a `deduped` flag whenever it returns an existing draft. (decision a)
2. A manager can disconnect an orphaned key from its "No strategy yet" row; the key row is kept (disconnected, never deleted), and the `KEY_ORPHANED` copy names that control. (decision b)
3. The wizard offers no MT5 composite card, and `composite/add-key` refuses `mt5` with a named code. (decision c)
4. The scenario composer shows basis-dependent metrics as pending until every leg's asset class has resolved, and never shows a number computed on the interim basis. (decision d)
5. No migration is expected; if one turns out to be needed, migration-reviewer and rls-policy-auditor must both be clean before merge.
6. Each fix has a test that goes RED when it is reverted.

Plans:
- [ ] TBD (run /gsd-plan-phase 213 to break down)

### Phase 214: FRESHTRUTH — refresh work and freshness readings match what can actually change

**Goal:** Refresh work goes only where data can actually advance, and every freshness reading tells the truth about why a series has stopped. One live MT5 strategy has had its series stuck at 36 days while its key syncs daily and its derive finishes `publish_warned` every day. The fan-out re-derives it daily for nothing. The two Deribit composites read stale in `ledger_refresh_staleness`, although every member window ended by 2026-04-30. Founder decision 2026-11-14 (0.3, "Yes, closed records"): they read as closed records, not stale, and the composite fan-out stays unscheduled. The freshness chip's `TRACK RECORD · FUTURE — CHECK DATA` label overflows its masthead column at 1485px (297.9px in 204.2px). Closes TODOS `0.1`, `0.12`, `0.3` and `211-D11-RESIDUAL-UNCORRELATED-SENDERS` (added by founder decision 2026-11-14: the Phase 211 D11-9 residual, where the finalize-wizard `stitch_composite` and csv-finalize `compute_analytics_from_csv` enqueues send no `correlation_id`, so the SQL enqueue dedup cannot retract an inherited `ledger-refresh` marker for them). Booked by the founder 2026-11-14 from the FIX NOW triage.
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases and of the other FIX NOW phases.
**Plans:** 0 plans
**Success Criteria** (what must be TRUE):
1. The 36-day MT5 case is diagnosed and its cause is recorded.
2. The fan-out excludes or caps a strategy whose derive leaves `last_return_date` unmoved, and counts each skip with a reason.
3. A composite whose member windows have all closed reads as closed in `ledger_refresh_staleness`, not stale; the composite fan-out stays unscheduled.
4. After deploy, a PROD read through the Supabase MCP (marker query first) shows the stale count drained, or names each remaining row and why.
5. The freshness chip's "future" label fits at 1485px, measured in a real browser.
6. It touches migrations, so migration-reviewer and rls-policy-auditor are both clean before merge.
7. Each fix has a test that goes RED when it is reverted.
8. The finalize-wizard `stitch_composite` and csv-finalize `compute_analytics_from_csv` enqueues send a `correlation_id`, or a founder decision widens `_record_enqueue_dedup`'s predicate, so an enqueue from either that dedups onto a marked refresh job no longer stays on the quiet refresh path. A SQL gate arm that is RED on the Phase 211 code (an uncorrelated csv-finalize dedup onto a marked job leaves the marker) proves it. (added 2026-11-14, founder decision, TODOS `211-D11-RESIDUAL-UNCORRELATED-SENDERS`)

Plans:
- [ ] TBD (run /gsd-plan-phase 214 to break down)

### Phase 215: TESTREACH — every test that guards money math or error contracts actually runs, and test apps match production

**Goal:** CI-only phase: no product behaviour changes. Every test guarding money math or an error contract runs in some environment, and test apps are built the way production builds them. Today the `HAS_PY_ENV` money-math KPI parity cases never run. Pytest cases gated on `TEST_SUPABASE_DB_URL` skip in the `python` job, which exports `LANE_DB_URL`. The binance cassettes are missing. Test modules mount a bare `FastAPI()` that never sees the app-global 422/429 handlers. The worker raises `HTTPException`, which can never render. The two key-step code rosters are hand-typed. Closes TODOS "Tests that run in NO environment", the bare-`FastAPI()` entry, "Worker raises an HTTP exception", `ROSTER-DERIVE-01`, `D-161-01`, the 403-vs-422 split and the teaser-bucket saturation alert. Booked by the founder 2026-11-14 from the FIX NOW triage.
**Requirements**: TBD
**Depends on:** Nothing. Independent of the v1.18 MT5 phases and of the other FIX NOW phases.
**Plans:** 0 plans
**Success Criteria** (what must be TRUE):
1. The `HAS_PY_ENV` parity tests run in CI, or are removed with a recorded reason.
2. Tests gated on `TEST_SUPABASE_DB_URL` run on `LANE_DB_URL`, or each is listed with why it cannot.
3. A shared app-factory fixture replaces every bare `FastAPI()` in the test suite.
4. The worker raises a domain exception that `classify_exception` maps, never `HTTPException`.
5. `KNOWN_CREATE_WITH_KEY_CODES` and `KNOWN_ADD_KEY_CODES` are derived from each route's contract, still per route (not merged).
6. The binance cassettes are recorded or retired.
7. The `first_rule.upper()` CSV code family is visible to the derived vocabulary (`D-161-01`), the 403-vs-422 split in `_scope_rejected` is decided and pinned, and the anonymous teaser bucket's saturation raises an alert.
8. No migration.
9. Each fix has a test that goes RED when it is reverted.

Plans:
- [ ] TBD (run /gsd-plan-phase 215 to break down)

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
