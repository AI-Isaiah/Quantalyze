# Roadmap: Quantalyze

## Milestones

- ✅ **v1.21 UX — trustworthy, navigable, lean** — Phases 192–206 (shipped 2026-11-13)
- ✅ **v1.20 Backlog Burndown** — Phases 158–191 (shipped 2026-11-06)
- ✅ **v1.19 JOB/RATE** — Phases 143–146, 146.1, 146.2 (shipped 2026-08-20)
- ✅ **v1.18 MT5-VERIFY & founder confirmations** — Phases 155, 155.1, 207–220 (shipped 2026-11-23; 155.2's remaining work, 157 and 221–225 moved to v1.22 2026-11-23, then 221 and 224 to v1.23 by F-10)
- 🚧 **v1.22 TRUTH — data you can trust** — Phases 155.2, 157, 222, 223, 225, 226–241 (started 2026-11-23)
- 📋 **v1.23 HARDEN — security, alerting, tooling** — Phases 221, 224, 242–249 (planned; starts after v1.22, founder 2026-11-23)
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

🚧 **v1.22 TRUTH — data you can trust — STARTED 2026-11-23, roadmapped, no new phase started.** 21 phases: the carried 155.2, 157, 222, 223 and 225, and the new 226–241. The first phase to plan is 226 MT5SOAK (wave 0), with the read-only Deribit diagnosis run beside it as a `/gsd-debug` session. 155.2 plan 11 waits on the founder's broker statements. The order, the seam owners, the 155.2 freeze window and the milestone-wide rules are in the v1.22 section below.

📋 **v1.23 HARDEN — security, alerting, tooling** is planned and starts after v1.22 closes (founder ruling 2026-11-23, "Yes, split into two milestones"). It holds the carried 221 and 224 and the new 242–249. Its section follows v1.22's.

⛔ **Do not advertise MT5 until Phase 155.2 passes.** Carried from v1.17 and v1.18 and unchanged by the close. No surface, copy or badge advertises MT5 or calls it verified before 155.2 passes (`milestones/v1.18-REQUIREMENTS.md` Out of Scope).

⚠️ **Public repo:** account labels only (MM2, MM3, FX-AI_V). No login, server name, amount, account number or PROD id in tracked text. Raw captures stay in the untracked capture directory.

⭐ **v1.18 MT5-VERIFY & founder confirmations — CLOSED 2026-11-23** (audit `passed`, 5/5 requirements, 16/16 phases), **v1.21 UX — CLOSED 2026-11-13** and **v1.20 Backlog Burndown — CLOSED 2026-11-06.** Their position notes are in [`milestones/v1.18-ROADMAP.md`](milestones/v1.18-ROADMAP.md) as lineage.

## 🚧 Current Milestone: v1.22 TRUTH — data you can trust

**Goal:** Every number, label and alert we show is correct, or it fails loudly. Started 2026-11-23. Requirements: [`REQUIREMENTS.md`](REQUIREMENTS.md), 81 for v1.22 and 35 planned for v1.23 (116 in all), bound by founder decisions F-1..F-10 and the D-A..D-E carry. Research: [`research/v1.22/`](research/v1.22/SUMMARY.md). The top-level `research/SUMMARY.md` is v1.18's and stale.

**Founder ruling 2026-11-23, "Yes, split into two milestones" (F-10).** v1.22 keeps the data-integrity and user-facing tiers. v1.23 HARDEN takes security, alerting and tooling, in the section after this one. ⭐ **One exception:** SECR-01 and SECR-02 stay in v1.22 as Phase 241 DEMOCREDS: deleting the two demo accounts and removing their committed passwords (`158-OPS-03`). They stay because `158-OPS-03` is the only HIGH item in scope. SECR-03/04 go to v1.23. The carried 221 SENTRYSCRUB2 and 224 DEADLEFTOVERS moved to v1.23 with their tiers. 155.2 and 157 came from v1.18 by founder rulings on 2026-11-23 ("Move to next milestone: Your broker statements for 155.2, then its Gate B run and final verification."; "delay 157 into next milestone. Cannot do that now"), and 221–225 were moved the same day ("Move them too (Recommended)").

**Order** (founder F-1: data integrity, then user-facing, then security). Within a tier, the order follows the research's seams and waves (`research/v1.22/ARCHITECTURE.md` § Suggested build order). Real dependencies are in each phase's Depends-on line. The rest is priority, and phases without a shared seam may run in parallel.

1. **Wave 0, now and in parallel:** 226 MT5SOAK, the independent MT5 oracle, which lands before any `nav_twr.py` edit. Beside it runs the read-only Deribit diagnosis, a `/gsd-debug` session and not a phase: it owns no requirement and writes nothing. Its verdict is what 233 DERIBITTRUTH plans FRESH-01 from.
2. **Data integrity:** 227 JOBLEDGER (S3) → 225 ONEACCOUNTONCE (S4) → 228 KEYANSWERS (its sibling, right after it) → 229 MT5DERIVE2 → 230 MT5NIGHTLY (once 227's records hold real nights) → the venue reads 231 BYBITREADS ‖ 232 OKXTRADES ‖ 223 FLOWKINDS → 233 DERIBITTRUTH (after 229) → 234 NOCAPITAL ‖ 235 HOLDINGSTRUTH (after 225) → 236 FIGUREMATH.
3. **User-facing:** 237 FACTSHEETHONEST → 238 NEVERCOMPUTED ‖ 239 SURFACECACHE ‖ 240 CONNECTTRUTH ‖ 222 ALERTTRUTH.
4. **Security, by exception:** 241 DEMOCREDS. It shares no seam with any phase, so the founder may pull it forward without a conflict.
5. **Outside the order:** 155.2, which runs statements → plan 11 → plan 12's recapture → plans 13 and 14, under the freeze window below. 157 runs in the same founder sitting, and its password rotation comes after 155.2's last live read.

**Seam owners.** Each seam has one owning phase. Another phase on the same seam works strictly after the owner and re-bases on its merged bodies, never in parallel. The unit of contention is a (file, top-level symbol) pair, so every plan lists its write scope by symbol. `run_derive_broker_dailies_job` is not refactored in this milestone.

| Seam | Owner | Also touched, strictly after the owner |
|---|---|---|
| S1 Derive writer: `run_derive_broker_dailies_job` and its key-mode exits, `_native_key_usd_writer_basis`, `nav_twr.py` | 229 MT5DERIVE2 | 230 (if its fix lands here), 233 (the key-mode exits), 155.2's fixes |
| S2 Compose reader: `run_derive_allocator_equity_job`'s no-capital machinery, `allocator_equity_derive.py`, `equity_reconstruction.py` | 234 NOCAPITAL | 229 edits `read_writer_basis` first, because the writer and reader of one contract change together (HOLD-03); 233 if `out_of_window_flow` gets a named reason |
| S3 Job lifecycle: the claim, reset, reclaim and mark-failed RPCs, the dropped-enqueue sweep, `enqueue_poll_positions_for_all_strategies`, `main_worker.py` | 227 JOBLEDGER | 230 (if the second-attempt cause lands here); v1.23's 224 |
| S4 Account identity: `create-with-key/route.ts`, `account_identity.py`, `api_keys.venue_account_id` | 225 ONEACCOUNTONCE | 228 (right after 225), 235 (reads); v1.23's 243 (DBACC-02) |
| S5 Ops-alert SQL: `ops_staleness_check()`, `cron_sync_tick()` | none in v1.22, unless 233 puts FRESH-02 there | v1.23's 242, then 246, each re-based on whichever S5 migration merged last |

**Milestone-wide rules** (every phase's criteria rely on them):

- **PROOF-01, gate proof.** Every phase carries it as its last criterion. Every gate a requirement relies on goes RED on pre-fix code, or on a neutered copy, with the expected named arm as the first failure. The file is then restored from a byte backup (`cp` back, `cmp` against the backup; never `git checkout`, `restore` or `stash`) and goes GREEN. The neuter edit, the command, the RED line and the GREEN line are recorded verbatim in the plan SUMMARY.
  - A new SQL gate arm carries `RED-UNDER:` and `RED-UNDER-M:` twins, lists its migration in `RED-UNDER-SETUP`, and moves the censuses it touches in the same PR. `WAIVED_CEILING` stays 0.
  - Money-math oracles import no production helper.
  - Census pins are exact-set, run in both directions and are derived from their source of truth.
  - Alert and freshness tests run on a fake clock across several ticks, or on a held-back lane fixture.
  - None of these is a close: a loosened tolerance, re-pinned values, a new `skipIf` or ledger line, `rpc` put back on the retried side, an edit to an applied migration, a loosened `apply-test` refusal or a `supabase-migrate.yml` edit, a data-dependence linter opt-out, a mutation waiver, or drift made blocking.
  - Green is bound to the head SHA with the expected check count.
- **Migration lane.** Migrations auto-apply to PROD once `apply-test` succeeds, with no human stop, so every migration-bearing phase follows these rules:
  - Each migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding before merge.
  - Migrations run in **one serial lane**: one migration-bearing PR open at a time, re-picked from `origin/main`, each `CREATE OR REPLACE` re-based on the latest body in `supabase/schema/functions/` and `supabase/migrations/`.
  - No migration uses a data-reading `DO` guard, and no migration edits an applied one.
  - A refusal on TEST is answered by reverting the merge.
- **155.2 freeze window.** A change that moves MT5 numbers for MM2, MM3 or FX-AI_V merges before 155.2 plan 12's recapture or after plan 14, never in between, because a merge in between voids plan 13's `computed_at` binding. 155.2's open plans are 11–14; 13 of 17 are shipped (01–10 and 15–17).
  - The rule binds 225, 229, 234 and 236, and binds 230 and 233 if their fix moves those numbers.
  - Each of these phases records which side of the window it merged on.
  - Research schedules plan 12's recapture after 225 and 229 deploy, so their fixes are inside the verdict.
- **TODOS closure.** Each phase deletes the `TODOS.md` entries its requirements close (the `(covers: …)` ids in `REQUIREMENTS.md`) in its ship PR, and names them in the CHANGELOG entry (CLAUDE.md, rule b).
- **Founder rulings at plan time** are taken in discuss-phase. Each requirement that needs one says so, and is written so that it can be met either way.
- ⛔ **MT5 stays unadvertised until 155.2 passes.** The repo is public: account labels only.

### Phases (this milestone)

- [ ] **Phase 155.2: LIVEPARITY — on a trading day, our MT5 numbers match the terminal's and the broker's within 1%** - The founder's scripted session on MM2, MM3 and FX-AI_V, Gate A and Gate B per account, every surface the same, every gap fixed at its root or ruled on; after 155, session after the 155.1 deploy
- [ ] **Phase 157: FOUNDER-CONFIRM — the observations only the founder can make are made** - Wizard resume, the amber recomputing block and the four 153.7 copy members seen in a real wizard; the spike password rotated after the live reads and gate 1 re-checked; same sitting as the 155.2 session
- [ ] **Phase 222: ALERTTRUTH — Python and SQL error copy and portfolio benchmark labels name the real cause and a channel that exists** - User-facing error copy and the benchmark outage label, with a migration; independent of the MT5 parity phases
- [x] **Phase 223: FLOWKINDS — each funding caller treats a malformed row by a recorded, tested decision, and the malformed count is on record first** - Flow-source half only (F-2, no composites): the funding callers' malformed-row decisions and the PROD malformed count; FLOWK-01 dropped (completed 2026-11-24)
- [ ] **Phase 225: ONEACCOUNTONCE — a user cannot connect the same exchange account more than once, and one account shared across users stays allowed** - Per-owner duplicate account refusal; shared keys across users stay allowed; founder decision 2026-11-23; also the seam S4 owner: server-qualified MT5 identity, the draft-clash answer, the failing-holder rule
- [x] **Phase 226: MT5SOAK — the MT5 soak checks what it claims, independently of the code it checks** - Wave 0: BTC-unit floors, NaN and implausible timed days, an independent per-day attribution walk; lands before any nav_twr.py edit (completed 2026-11-24)
- [x] **Phase 227: JOBLEDGER — a failed job attempt keeps its cause, and no strategy is stranded by a dropped, reset or reclaimed job** - Seam S3 owner: per-attempt failure record, first-hop drop, batch-mate reset, readmit ceiling signal, reclaim provenance, private strategies polled; migrations (completed 2026-11-24)
- [ ] **Phase 228: KEYANSWERS — a reconnect with a changed password and an orphaned key each get an answer that names the key** - Sibling of 225 on seam S4, right after it: the rotated MT5 password reconnect and the KEY_ORPHANED copy for allocators
- [ ] **Phase 229: MT5DERIVE2 — an MT5 key's return chain keeps every day it should, and a key with no writer basis never composes silently** - nav_twr.py empty-cohort refund, day-0 P&L and the D-15 band, basis-silent keys, writer-basis values; moves MT5 numbers (155.2 freeze)
- [ ] **Phase 230: MT5NIGHTLY — every MT5 nightly derive ends done on its first attempt, for a named reason** - Data-gated on the JOBLEDGER records: the second-attempt cause fixed at its root, seven clean nights, the clock-switch replay
- [x] **Phase 231: BYBITREADS — a Bybit read covers every coin, settle type, window and deposit exactly once, or refuses by name** - Census first; all-coin anchor, USDC and inverse positions, full trade window, on-chain deposit verdict; the static egress IP is a founder action (completed 2026-11-25)
- [x] **Phase 232: OKXTRADES — an OKX read converts or refuses a non-USDT bill, completes a long window and never runs ahead of stored trades** - Mixed-currency daily bills, page-cap truncation, the trade cursor (completed 2026-11-24)
- [ ] **Phase 233: DERIBITTRUTH — a Deribit key's returns reach its newest flow, every book day is explained or withheld, and stale series page on every venue** - From the wave-0 diagnosis: stale-returns root fix, per-venue freshness check, correction classifier, book cumulative
- [ ] **Phase 234: NOCAPITAL — a no-capital key takes one named path, and a transient read never drops a funded key** - Seam S2 owner: transient-zero MT5 keys, any exception reverts, counted fallback flag, no residue reason
- [ ] **Phase 235: HOLDINGSTRUTH — one account counts once on Holdings, match scoring and the dashboard, and every failing key is named** - Reads the identity value 225 settles: identity misses fail loud, per-account unpriced marker, dashboard marker read, shared-account keys named
- [ ] **Phase 236: FIGUREMATH — every engine annualizes one way, CVaR is historical, and moved figures are re-derived and announced** - F-5 "365, ddof 1 everywhere", F-6 historical CVaR, quantstats 0.0.86, one CAGR span rule, fleet re-derive; moves published figures
- [ ] **Phase 237: FACTSHEETHONEST — every surface shows a strategy's true state, and no cache re-serves a stale or failed one** - Owner of the OG route and payload builder: withheld residue, re-run holding on every surface, OG not-found cache, BTC price failure cache, owner data source
- [ ] **Phase 238: NEVERCOMPUTED — a strategy that never computed, failed or stalled never claims a compute time or tells its owner to wait** - computed_at on never-computed rows (founder ruling) and the /strategies note wording
- [x] **Phase 239: SURFACECACHE — the composer range and the Discovery ranking reflect the current truth** - Composer range stored as dates; BTC-unit and USD returns ranked together as pure performance (founder ruling 2026-11-24) (completed 2026-11-24)
- [x] **Phase 240: CONNECTTRUTH — validating a key or a CSV gets a true answer, and anonymous limits are fair** - One error code on every venue, CSV month-name cells, anonymous bucket fairness, edge and upstream CSV limits agree (completed 2026-11-25)
- [ ] **Phase 241: DEMOCREDS — the two demo accounts are gone, and their passwords are out of the tree behind a guard that still bites** - The only HIGH item (158-OPS-03), kept in v1.22 by founder exception: accounts deleted on TEST and PROD, digest absence guard
- [ ] **Phase 250: BINANCEFILLS — a Binance fills read walks every window and never stalls its cursor** - Routed from 232 review (R2-01, R2-02, the BINANCE_PAGE_CAP stop); lands before `USE_RAW_TRADE_INGESTION` is turned on for Binance

### Phase 155.2: LIVEPARITY — on a trading day, our MT5 numbers match the terminal's and the broker's within 1%

**Goal:** On one trading day, with the founder at the terminal, the numbers Quantalyze renders for MM2, MM3 and FX-AI_V are compared with the terminal's and the broker's own figures, and every difference is fixed at its root or ruled on by the founder, until the parity verdict passes on every surface. This is the only phase gate 2 blocks, and the phase whose pass lifts the advertising ban. Research Phase C.
**Requirements**: MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01
**Depends on:** Phase 155 (dress rehearsal green). The founder session inside this phase also waits on 155.1's reading deployed with a weekday PROD reading row per key; that is a deploy condition, not a completion dependency (see 155.1)
**Plans:** 13/17 plans complete
**UI hint**: no

D-E amended 2026-11-22 (founder): the weekend edge is the Fri 2026-11-20 frozen close, read 2026-11-22 for all three accounts; for that edge only, the Gate B window runs past the 11-19 run day (see `milestones/v1.18-REQUIREMENTS.md` D-E; `REQUIREMENTS.md` was removed at the v1.18 close). ⛔ CORRECTED 2026-11-23: `REQUIREMENTS.md` exists again for v1.22 TRUTH; it carries D-A..D-E again, D-E's 2026-11-22 amendment included, beside the archived copy in `milestones/v1.18-REQUIREMENTS.md`.

**Freeze window (v1.22, roadmap 2026-11-23):** a change that moves MT5 numbers for MM2, MM3 or FX-AI_V merges before plan 12's recapture or after plan 14, never in between, because a merge in between voids plan 13's `computed_at` binding. It binds 225, 229, 234 and 236, and binds 230 and 233 if their fix moves these numbers. The research schedules plan 12's recapture after 225 and 229 deploy, so that their fixes (MM3 no longer publishing MM2's numbers, the `nav_twr.py` gaps) are inside the verdict. Plan 11 waits on the founder's broker statements.

⭐ **Run day 2026-12-01, monthly statements only (founder ruling 2026-11-23; also in `155.2-CONTEXT.md` and `155.2-RULINGS.md`).** Founder (2026-11-23): "I would suggest, we do 155.2 on 1st of december with the new monthly statments only". Gate B's statement oracle is the November 2026 monthly statement per account; plan 12's recapture runs on or after 2026-12-01; plans 11 to 14 are re-planned from the actual statements. The freeze window opens only at plan 12's recapture, so until then number-moving phases (225, 229 and the others it binds) merge freely.

Carried context, not requirements: timeout findings #8 and #10 are tuned only from percentile data across several nightlies, with fresh and cached logins split, and are booked separately if the data is not in by the milestone close (`milestones/v1.18-REQUIREMENTS.md` Future). The product call on MT5 as a composite member stays out of scope.

**Success Criteria** (what must be TRUE):
1. The founder's trading-day session on the live funded accounts MM2, MM3 and FX-AI_V is recorded: real trade mode and the trading day per account, an All-History Report per account, the Summary block at an instant T, the statement figures (D-C), and the terminal-displayed time of 155.1's preselected near-midnight deal (MT5-06's last leg). A demo, the v1.15 soak account or a weekend-only run is refused as the run; the weekend reading (D-E) enters only as a Gate B edge. (MT5-08)
2. For each account the harness reports Gate A (days before `S`, closed-trade balance basis, against the All-History export; D-A) and Gate B (days from `S`, open P&L included, against the statements and the weekend reading) within `MT5_PARITY_TOLERANCE`, as a return gap in points (D-B) checked separately for cumulative return, start level and end level, over windows that end before the run day. The instant-T reading is checked on D+1 after a re-anchoring sync. (MT5-07)
3. Every surface that renders strategy performance, on the list fixed in 155 (the portfolio PDF and `scenario-blend-panels.ts` dropped, cited by symbol), shows the same numbers for these accounts in the founder's signed-in browser, bound to `computed_at`. This closes the data-layer matrix 155 measured. (MT5-09)
4. Every discrepancy, from 155's pre-verification or the live run, is fixed at its root wherever it lives, shared backbone money-math included and never scoped to `exchange === 'mt5'`, and the comparison is re-run. A difference passes only within tolerance, consistently withheld on every surface, or in a named bucket with a recorded founder ruling; an empty `unexplained` list alone is not the exit. Every data-quality flag these accounts carry is eliminated or understood and accepted in writing. (MT5-10, MT5-15)
5. The founder confirms live that an MT5 strategy he uploaded ingests, projects in a scenario and has a viewable factsheet. (MT5-GOAL-01)
6. PROOF-01: every gate the remaining plans add or change, and every fix they land, goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. The Gate A and Gate B verdict proofs recorded in v1.18's Phase 155 are cited, and re-run only if the harness code under them moved.

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
5. PROOF-01: every gate this phase relies on (plan 01's fail-closed staging router among them) has a recorded neuter, RED on its named arm, byte restore and GREEN before the founder sitting. A founder observation is recorded verbatim with its date, and is not itself a gate.

Plans:
- [x] 157-01-PLAN.md — the staging kit (fail-closed fetch router with a visible marker), its smoke test and the founder script
- [ ] 157-02-PLAN.md — the founder makes the FCONF-01..03 observations under staged responses (founder checkpoint)
- [ ] 157-03-PLAN.md — the MM2 investor password rotation after 155.2's last live read, then the gate-1 re-read on the next scheduled derive (founder checkpoint)

### Phase 222: ALERTTRUTH — Python and SQL error copy and portfolio benchmark labels name the real cause and a channel that exists

**Goal:** Every Python and SQL error sentence a user can read names the real cause and offers only a channel that exists (the contact form, never "contact support"), and a portfolio whose benchmark sources all failed says the benchmark is unavailable, not "stale". The `computation_error_copy` arms (`supabase/schema/functions/computation_error_copy.sql`) move by migration, so migration-reviewer and rls-policy-auditor apply before merge. `run_sync_trades_job` no longer returns DONE after recording an analytics failure that the bridge then erases to `complete`. Trigger: founder decisions 2026-11-23, "Book phases: SENTRYSCRUB2, ALERTTRUTH, FLOWKINDS (composite half), DEADLEFTOVERS". Owns `TODOS.md` `[212-CONTACT-SUPPORT-SURVIVORS]`, `[166.4.1-BENCHMARK-OUTAGE-LABEL]` and `[SYNCTRADES-ENQUEUE-DONE]` (readings, cautions and fix directions as written there, including that the 161.1 F1 remedy does not transfer to the sync-trades handler as-is).
**Requirements**: ERRC-01, ERRC-02, ERRC-03
**Depends on:** none (independent of the MT5 parity phases). It shares files, not symbols, with three v1.22 phases, so each plan lists its write scope by symbol: `run_sync_trades_job` with 232 OKXTRADES (VREAD-08), `csv_validator.py` with 240 CONNECTTRUTH (CONN-06), and `routers/portfolio.py` with 236 FIGUREMATH (FIG-01/02). By tier order 232 and 236 merge first, and this phase re-bases on them. Its `computation_error_copy` migration runs in the one serial migration lane.
**Success Criteria** (what must be TRUE):
1. No string in `analytics-service` or in the `computation_error_copy` arms says "contact support"; each names the contact form or a remedy that works, and csv-finalize's `ENQUEUE_LOST_RACE_USER_COPY` is back in byte parity with the SQL ELSE arm, with the parity test reading the SQL arm instead of a hand-typed oracle.
2. A total benchmark source failure (no price source and no recent cached day) writes a note distinct from the stale-cache note, and the page shows it with its own wording; a test drives both cases and tells them apart.
3. When the follow-on analytics enqueue fails in `run_sync_trades_job`, the strategy's row does not read `complete` with no analytics; a test drives the failed enqueue through the bridge and asserts the stored status and error, shown RED before the fix.
4. The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, and every census it moves (schema snapshot, mutation floors, pins) moves in the same PR.
5. The three TODOS entries above are deleted in the ship PR and named in its CHANGELOG entry.
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. The parity test reads the SQL arm, never a hand-typed oracle.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 223: FLOWKINDS — each funding caller treats a malformed row by a recorded, tested decision, and the malformed count is on record first

**Goal:** Each funding caller outside the composite path refuses a malformed funding row by name or keeps dropping it, by a recorded decision a test pins, and no refusal of a malformed realized row is switched on before the PROD malformed count and the founder's ruling are on record.
- The callers are `run_sync_funding_job` (`job_worker.py`) and `services/okx_archive_job.py`. Each calls a `services/funding_fetch.py` fetcher whose default is `on_malformed="drop"`. Each decision is taken with the founder wherever a published number changes.
- The count is the per-key count of `daily_pnl_malformed_<venue>` flags on PROD (read in `services/analytics_runner.py`), recorded read-only.

⛔ **Founder ruling F-2, 2026-11-23: "Forget about conposites".** The composite half this phase was booked with is dropped:
- dropped with it: `run_stitch_composite_job`'s Bybit flow read, the composite member read and its refusal, and requirement FLOWK-01 (dropped by the founder 2026-11-23);
- out of v1.22 and not owned here: `180-BYBIT-LIVE-FLOW-KINDS` and `186-COMPOSITE-MEMBER-READ-GAPS` (`REQUIREMENTS.md` Out of Scope);
- moved to 231 BYBITREADS: the Bybit anchor and positions entries the booked text kept out of this phase (VREAD-01, VREAD-02), and the Bybit on-chain deposit (VREAD-04).

⭐ **Founder rulings, 2026-11-24 (AskUserQuestion, labels verbatim; recorded in `223-CONTEXT.md` too):**
- `okx_archive_job`, a malformed live funding row: "Stop by name (Recommended)", `_Stop("live_anchor_unusable", "live_funding=malformed")` before any write.
- FLOWK-03, a malformed realized row: "Keep flagging (Recommended)". 186 D-12 stays, so no realized-row refusal is switched on.
- **Scope change.** C27, the Bybit `sync_funding` walk over its 180 s budget (231 census): "Yes, 223 fixes it". This adds `services/funding_fetch.py::fetch_funding_bybit` to the write list, as far as C27 needs it. `run_sync_funding_job` keeps dropping a malformed row, pinned by a test, because no published number reads `funding_fees`.

The composite-worded goal and criteria booked on 2026-11-23 are superseded. Read them in `git show 46e703742:.planning/ROADMAP.md` as lineage only, never as scope. Owns `TODOS.md` `[186-OTHER-FUNDING-CALLERS-DROP]` (its non-composite callers) and `[186-REALIZED-MALFORMED-COUNT]`, with readings and closing conditions as written there.
**Requirements**: FLOWK-02, FLOWK-03
**Depends on:** none; it is independent of the MT5 parity phases. It runs in the venue-reads wave beside 231 and 232, with plan write scopes listed by symbol: `run_sync_funding_job`, `okx_archive_job.py` and the `funding_fetch.py` callers. 232 owns the OKX bills reader in `exchange.py`.
**Success Criteria** (what must be TRUE):
1. `run_sync_funding_job` and `okx_archive_job` each have a recorded decision, refuse a malformed funding row by name or keep dropping it, taken with the founder wherever a published number changes. Each decision is pinned by a test that fails if the caller's malformed-row behaviour changes. (FLOWK-02)
2. The per-key count of `daily_pnl_malformed_<venue>` flags on PROD is recorded read-only with its date and brought to the founder. The founder's ruling on refusing a malformed realized row is recorded before any such refusal is switched on. (FLOWK-03)
3. Every `TODOS.md` entry the phase closes is deleted in the ship PR and named in its CHANGELOG entry. `[186-OTHER-FUNDING-CALLERS-DROP]`'s composite caller is recorded there as out of scope by F-2, not as fixed.
4. PROOF-01: each decision test goes RED on a neutered copy of its caller, with the malformed-row arm flipped and failing first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN. The neuter edit, command, RED line and GREEN line are recorded verbatim in the plan SUMMARY.
5. C27 (added by founder ruling 2026-11-24): a Bybit `sync_funding` walk that runs past its handler budget keeps every window it finished, so the next attempt resumes from where it stopped and a first walk fills `funding_fees`. A timeout still fails the job and is never turned into a quiet DONE. A test pins that a cancelled walk keeps its finished windows, under PROOF-01.
**Plans:** 5/5 plans complete

Plans:
- [x] 223-01-PLAN.md — FLOWK-02, `okx_archive_job`: a malformed live funding row stops calibrate and apply as `live_anchor_unusable live_funding=malformed` before any write (ruling 1)
- [x] 223-02-PLAN.md — FLOWK-03: the dated PROD reading and ruling 2 replace the TODOS pointer in code, and the D-12 pin is proven able to fail
- [x] 223-03-PLAN.md — C27 fetcher half: `fetch_funding_bybit` gains an `until_ms` end bound and `bybit_funding_windows` returns the exact windows a full walk uses (ruling 3)
- [x] 223-04-PLAN.md — C27 handler half: the Bybit funding walk stores each 7-day window, oldest first, before reading the next, so a budget-cut walk keeps what it stored (ruling 3)
- [x] 223-05-PLAN.md — FLOWK-02, `run_sync_funding_job`: the drop decision recorded and pinned for all three venues, then the phase gate

### Phase 225: ONEACCOUNTONCE — a user cannot connect the same exchange account more than once, and one account shared across users stays allowed

**Goal:** A user cannot connect the same exchange account more than once: a second key or draft that reads the same account under the same owner is refused by name at connect time, and any such pair already stored is surfaced and resolved instead of publishing one account's numbers under two names. One key or account shared across several users stays allowed, and a strategy-linked key may also sit in an allocator book; that is never called "manager-only by design". Context: Phase 155.2 found on PROD a key marked as a duplicate of MM2's account under the same owner that publishes MM2's numbers under the name MM3, and MM2's login shared with a draft key for FX-AI_V with no share link between them. `analytics-service/services/account_identity.py` stamps the share link. Trigger: founder decisions 2026-11-23, "several accounts can use one key. one account should not use the same key several times". ⭐ **v1.22 scope (roadmap 2026-11-23):** 225 owns seam S4 and takes the identity members that must ship with its refusal. CONN-01 is a connect that matches the user's own draft: it names what was stored instead of a silent `200 deduped`, in the same `venueMatch.kind === "draft"` arm ONCE-01 rewrites. CONN-03 makes MT5 account identity include the broker server, by migration with a backfill that uses no data-reading `DO` guard; it defines the identity ONCE-01 compares. MT5D-08 bars an MT5 key whose sign-in keeps failing from claiming an account's holder slot, and is settled before the refusal ships (PITFALLS §E). CONN-02 and CONN-04, the other two answers in `create-with-key/route.ts`, go to the sibling 228 KEYANSWERS, ordered right after this phase. Nine requirements would not fit five criteria without compound ones.
**Requirements**: ONCE-01, ONCE-02, ONCE-03, ONCE-04, CONN-01, CONN-03, MT5D-08
**Depends on:** nothing hard. It shares no seam with 227 and follows it in the data-integrity order. 155.2 freeze: resolving the MM3-publishes-MM2 duplicate (ONCE-03) moves MT5 numbers, so this phase merges before 155.2 plan 12's recapture or after plan 14, never in between. Research schedules it before plan 12. Research first: the read-only PROD same-owner duplicate count, and the CONN-03 backfill design.
**Deviation (founder override, 2026-11-23):** the standing rule "keep data; disconnect, never delete" and the never-deletes half of 167.1.2 D-01 are overridden for SAME-OWNER duplicate keys only. Founder, verbatim: "Delete all duplicate keys. So same key in one accused twice. Delete also all associated factsheet, data etc. One key can be used over several accounts. Imagine one team sharing the key if their master account with several allocator. Of course each allocator should be able to generate a factsheet". Same-owner duplicate keys and their strategies, factsheets and derived data are deleted once, from a read-only PROD manifest the founder confirms first; cross-user sharing stays and each user keeps their own factsheet. Recorded in `225-CONTEXT.md` too.
**Success Criteria** (what must be TRUE):
1. Connecting a key or saving a draft whose account identity matches a key the same owner already holds is refused with a named reason, in the wizard and in the API; a test drives it for an exchange key and for an MT5 login. A connect that matches the user's own draft answers with what was stored, never a silent `200 deduped`. (ONCE-01, CONN-01)
2. The same account connected by two different users stays allowed and keeps its share link; a test pins that the refusal is per owner, and a strategy-linked key in an allocator book is unaffected. (ONCE-02)
3. Every same-owner duplicate already stored on PROD is counted read-only and brought to the founder, and no strategy publishes another key's numbers under its own name once the phase ships. (ONCE-03)
4. Two keys that share a login always carry a share link, so a shared login with no link cannot recur; a test drives the stamping in `account_identity.py` for that case. MT5 account identity includes the broker server, so the same login on two servers never collides, and the backfill uses no data-reading `DO` guard. (ONCE-04, CONN-03)
5. An MT5 key whose sign-in keeps failing cannot claim an account's holder slot. A test drives a failing key beside a working one for the same account, and the working key holds the slot. (MT5D-08)
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Any migration (the CONN-03 identity change and backfill, any per-owner refusal constraint) passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 12 plans

Plans:
**Wave 1**
- [x] 225-01-PLAN.md — migration A1: `api_keys.venue_server` column and the 13-parameter `create_wizard_strategy` (PR-1)
- [x] 225-02-PLAN.md — the same-owner duplicate census and the one-time delete, run by the orchestrator on PROD (PR-1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 225-03-PLAN.md — move every SQL gate pin to the 13-parameter signature (PR-1)
- [x] 225-04-PLAN.md — migration A2: `swap_account_slot`, the one place a holder slot moves; the orchestrator ships PR-1 and confirms both migrations on PROD before wave 3 (PR-1)

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 225-05-PLAN.md — an own-draft match is refused by name, `VENUE_DRAFT_IN_PROGRESS` (PR-2)
- [ ] 225-06-PLAN.md — the shared server rule, holder pick and swap helper, TS and Python held equal by one fixture (PR-2)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 225-07-PLAN.md — the wizard connect, MT5 path: server-aware resolver, server write, failing-holder swap (PR-2)
- [ ] 225-08-PLAN.md — the Exchanges-page connect gets the same rule, and the demoted key's card names its holder (PR-2)
- [ ] 225-09-PLAN.md — the poll stamper: a working key takes a failing holder's slot through the swap (PR-2)

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 225-11-PLAN.md — the wizard connect, every venue: post-validation refusal, interim race arm, per-owner pins (PR-2)
- [ ] 225-12-PLAN.md — the poll stamper: MT5 server capture and backfill, cross-owner stamping, the backfill census (PR-2)

**Wave 6** *(blocked on Wave 5 completion)*
- [ ] 225-10-PLAN.md — migration B: the index gains the server member and reconnect agrees, after the backfill census passes (PR-3)

### Phase 226: MT5SOAK — the MT5 soak checks what it claims, independently of the code it checks

**Goal:** The MT5 derive soak (`analytics-service/scripts/mt5_soak.py`) becomes an oracle that cannot agree with the derive by construction (PITFALLS Pitfall 12). It judges a BTC-unit account on floors in its own unit. It rejects NaN and implausible timed-day returns, not only infinity. It checks each deal's day against its own per-day walk that imports no production helper. It is wave 0, so 229's `nav_twr.py` edits are judged by a soak built independently of them. One file; no migration; no published number moves.
**Requirements**: SOAK-01, SOAK-02, SOAK-03
**Depends on:** nothing (wave 0). It must merge before 229 MT5DERIVE2's first `nav_twr.py` change.
**Success Criteria** (what must be TRUE):
1. A BTC-unit account is judged on floors in BTC, not on `USD_FLOORS`; a test feeds a BTC account that the USD floors would pass and its own floors fail. (SOAK-01)
2. The timed-day check rejects NaN and implausible returns as well as infinity, and goes RED when one timed day is nudged by 1e-3. (SOAK-02)
3. Day attribution is checked against an independent per-day walk that imports no production helper, and goes RED when one deal is moved by one UTC day. (SOAK-03)
4. PROOF-01: each check goes RED on a neutered copy of `mt5_soak.py` with its own arm first (the BTC-floor arm, the timed-day arm, the attribution arm). It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN. The neuter edit, command, RED line and GREEN line are recorded verbatim in the plan SUMMARY.
**Plans:** 5/5 plans complete

Plans:
**Wave 1**
- [x] 226-01-PLAN.md — SOAK-01: the unit is resolved once and its floors reach the combiner, the guard and inception reads, the level tolerance and the wedge gate; an unresolvable currency is INCONCLUSIVE (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 226-02-PLAN.md — SOAK-03: a soak-owned per-day walk from the raw deals, a day and flow attribution compare against the fold, and an AST test that the walk imports no production helper (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 226-03-PLAN.md — SOAK-02: the soak's own timed-day set from raw instants and positions; a flow day the fold and the walk time differently is a named mismatch (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 226-04-PLAN.md — SOAK-02: the soak's own D-17 cohort walk; each timed day is compared exactly, so a 1e-3 nudge, NaN, inf, 7.0 and -0.99 are named mismatches (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 226-05-PLAN.md — SOAK-02: the minimum checked share (0.5), the soak-owned tiny-base reading, the untimed guards on the soak-owned predicate, the phase gates and the ship note (wave 5)

### Phase 227: JOBLEDGER — a failed job attempt keeps its cause, and no strategy is stranded by a dropped, reset or reclaimed job

**Goal:** A failed job attempt keeps its cause, and no strategy is stranded by a dropped, reset or reclaimed job; the job lifecycle (seam S3, owned here) stops hiding failures:
- Every failed compute-job attempt leaves an append-only record of its cause. The record is written before the re-claim's deliberate `last_error` clear (M-1137, which stays and stays pinned), and tells a stall or watchdog reset apart from a real error. This deploy starts the clock for 230 MT5NIGHTLY, which reads real nights of these records.
- A finalize-wizard strategy whose first `sync_trades` enqueue dropped is re-enqueued, or shown in a named state. This uses a mechanism of its own, not a second predicate on the reconcile sweep.
- A `derive_allocator_equity` job queued behind slow batch-mates is never reset and run twice.
- A readmit that hits its ceiling emits a readable signal. Audit row or external alert is a founder ruling at plan time.
- A job reclaimed after a crash keeps its curated error sentence, and its strategy's analytics status follows the reclaim.
- The daily positions poll also covers private strategies. The `poll_positions` enqueue stays live (F-8, measured on PROD 2026-11-23); this widens its cohort, the direction of `FANOUT-COHORT-SIBLING-POLL-01`.
**Requirements**: MT5D-01, HEAL-01, HEAL-02, HEAL-03, HEAL-04, HEAL-05
**Depends on:** nothing (first in the data-integrity order). Its migrations re-base on the latest bodies at HEAD, read before re-basing: the claim pair in `20260927120000_claim_pair_pre_rank_exclusion.sql` (keeping every clause its self-verify pins, and carrying that self-verify forward), `reclaim_stuck_compute_jobs`, the sweep command in `20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql`, and `enqueue_poll_positions_for_all_strategies`. Research first: the lease or heartbeat design (HEAL-02), and the false-positive analysis for the first-hop signal (HEAL-01).
**Success Criteria** (what must be TRUE):
1. When attempt 1 of a job fails and attempt 2 succeeds, attempt 1's cause is still readable, and a stall or watchdog reset leaves a reason distinct from a real error. A lane test drives both, and the M-1137 `last_error` clear on re-claim still holds. (MT5D-01)
2. A finalize-wizard strategy whose first `sync_trades` enqueue dropped is re-enqueued or shown in a named state, by its own mechanism (key present, no job ever, a longer grace). A healthy new strategy is not caught by it. (HEAL-01)
3. A `derive_allocator_equity` job behind a long-running batch-mate runs once, never reset and run twice. A readmit that reaches its ceiling emits the signal the founder chose, and the signal outlives the job rows' retention. (HEAL-02, HEAL-03)
4. A job reclaimed after a crash keeps its curated error sentence, and its strategy's analytics status follows the reclaim. The lane arm that re-stamps a different sentence under the same job id shows the reclaimed one surviving. (HEAL-04)
5. The daily positions poll enqueues private strategies too, so they get position snapshots, and the `poll_positions` enqueue stays live. (HEAL-05)
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy, with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. New SQL arms carry `RED-UNDER` twins and list their migration in `RED-UNDER-SETUP`. Raising retries or a watchdog threshold is not a close. Each migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding before merge, and runs in the one serial migration lane (they auto-apply to PROD).
**Plans:** 11/11 plans complete

Plans:
**Wave 1**
- [x] 227-01-PLAN.md — The per-attempt failure ledger: a real error keeps its cause through the re-claim (MT5D-01)
- [x] 227-03-PLAN.md — Token-fenced claim renewal RPC: a renewed waiting job survives the watchdog (HEAL-02, SQL half)
- [x] 227-04-PLAN.md — The readmit-ceiling exhaustion row, written by a SQL detector pinned to the PROD sweep predicate (HEAL-03, durable half)
- [x] 227-05-PLAN.md — The first-hop sweep: a dropped first `sync_trades` enqueue is re-enqueued once, or shown in a named state; runbook registration (HEAL-01)
- [x] 227-06-PLAN.md — The daily positions poll covers private strategies and stays live, measured fresh on PROD (HEAL-05)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 227-02-PLAN.md — The watchdog reset and reclaim record their cause and bridge the strategy's status, so the curated sentence survives (MT5D-01, HEAL-04)
- [x] 227-07-PLAN.md — A reaped orphan keeps its cause, through a trigger on the terminalizer's transition (MT5D-01)
- [x] 227-08-PLAN.md — Worker: the pre-dispatch claim fence, the heartbeat renewal and the lost-mark error record (HEAL-02, MT5D-01)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 227-09-PLAN.md — Worker: the readmit-ceiling page through ops_alert, stamped on delivery (HEAL-03, page half)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 227-10-PLAN.md — Every phase migration applies on the local-stack lane, the corpus passes, and the censuses are measured (SC-6)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 227-11-PLAN.md — The migrations-schedule-nothing census, the operator runbook, the validation map and the ship records

### Phase 228: KEYANSWERS — a reconnect with a changed password and an orphaned key each get an answer that names the key

**Goal:** A reconnect with a rotated or mistyped MT5 password and an orphaned key each get an answer that names the key and matches what was stored; these are the two remaining answers of `create-with-key/route.ts`.
- **Rotated or mistyped password.** Reconnecting an MT5 account with a rotated or mistyped password gets a named answer that matches what was stored. Today `resolveByVenueIdentity` short-circuits on `venue_account_id` before `validateKey`, so the reconnect reports success and stores nothing. Validating and storing the new password, or refusing by name, is a founder ruling at plan time.
- **Orphaned key.** The `KEY_ORPHANED` copy tells an allocator-role owner which key to Disconnect; `keyOrphanedResponse()` takes no parameters today. The archived-composite case is out (F-2).

This phase is 225's sibling on seam S4, ordered right after it. 225 kept the identity members that must ship with its refusal; nine requirements would not fit one phase's criteria (see 225).
**Requirements**: CONN-02, CONN-04
**Depends on:** Phase 225 merged. The same file and seam are involved: `resolveByVenueIdentity` and `keyOrphanedResponse`. Founder ruling at plan time on CONN-02.
**Success Criteria** (what must be TRUE):
1. Reconnecting an MT5 account with a rotated password gets a named answer, and what the answer says matches what `api_keys` holds afterwards. A mistyped password is never reported as success. (CONN-02)
2. An allocator-role owner who hits `KEY_ORPHANED` is told, by name, which key to Disconnect; a test drives the allocator and manager roles. (CONN-04)
3. PROOF-01: each test goes RED on a neutered copy of the route arm it guards, with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans
**UI hint**: yes

Plans:
- [ ] TBD — plans not listed yet

### Phase 229: MT5DERIVE2 — an MT5 key's return chain keeps every day it should, and a key with no writer basis never composes silently

**Goal:** An MT5 key's return chain keeps every day it should, and a timed key with no writer basis never composes silently: the seam-S1 money-math gaps are fixed at their root, which moves published MT5 returns.
- A timed re-funding day with an empty cohort 0 keeps the return chain intact (`nav_twr.py` `_judged_cohorts`).
- An inception day's P&L is booked or flagged by name, never dropped as NaN (`chain_linked_twr`).
- A day-level flow just under the previous day's NAV carries the large-flow annotation, or the D-15 band is recorded as accepted. This is a founder ruling at plan time, and `FLOW_TIMING_LARGE_RATIO` is never widened to make a check pass.
- A timed MT5 key with no writer basis is counted or blocked with a named signal (`_native_key_usd_writer_basis`).
- The writer-basis gate (`read_writer_basis`, in S2) compares per-day values as well as the calendar, and refuses a same-day re-derive pair whose P&L does not match. It is here because the writer and the reader of one contract change together (Pattern 3).
**Requirements**: MT5D-04, MT5D-05, MT5D-06, MT5D-07, HOLD-03
**Depends on:** Phase 226 merged, so the soak judges these edits independently. 155.2 freeze: merges before 155.2 plan 12's recapture or after plan 14, never in between; research schedules it before plan 12, so its fixes are inside the parity verdict. No migration expected.
**Success Criteria** (what must be TRUE):
1. A timed re-funding day into an emptied account (empty cohort 0) keeps the return chain intact; a test that is RED on today's code drives it. (MT5D-04)
2. An inception day's P&L is booked, or carries a named flag; no day-0 P&L is dropped as NaN without one. (MT5D-05)
3. A day-level flow just under the previous day's NAV carries the large-flow annotation, or the founder's acceptance of the D-15 band is recorded with its reason. `FLOW_TIMING_LARGE_RATIO` is not widened to make a check pass. (MT5D-06)
4. A timed MT5 key with no writer basis is counted or blocked with a named signal, never composed silently on the legacy roll. The writer-basis gate refuses a same-day re-derive pair whose per-day P&L does not match, as well as a calendar mismatch. (MT5D-07, HOLD-03) ⭐ NOTE 2026-11-24 (planning, recorded in 229-CONTEXT.md): the per-day comparison is a compose-side `returns_stamp` (each derive stores the per-day returns it wrote in its `key_inputs` row; the compose compares it per raw key before the stitch and refuses a differing pair as the blocking `key_inputs_mismatch`). `read_writer_basis` stays byte-unchanged, because editing it fires the open entry `167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY` and a post-stitch check reads the stitched series. Known limit: a correction confined to a day with no stored return that moves no other return leaves the pair content-consistent and is not refused; a row written before this change carries no stamp and is counted, not refused. ⭐ SCOPE NOTE 2026-11-24 (founder ruling on review MR-01 / SFH-229-01, recorded in 229-CONTEXT.md): "Exempt departed keys". Live keys still block. A departed key whose last `key_inputs` row carries `writer_basis_withheld` or a stale returns stamp stays out of `withheld_by_key` and `stamp_mismatch_days_by_key`; it is counted into a non-blocking benign flag with a counts-only log, in the spirit of D-22, because a departed key never re-derives and the block could never self-heal.
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy of `nav_twr.py` / the writer-basis symbols, with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Money-math oracles import no production helper. The frozen spine is never re-baselined by re-running `regen_golden.py`. 226's soak, run against the changed derive, is recorded beside the merge.
**Plans:** 5/6 plans executed

Plans:
**Wave 1**
- [x] 229-01-PLAN.md — An empty cohort 0 is skipped when a later cohort is judged, so a re-fund day into an emptied account is published; 188's tiny-base precedence kept; the D-15 band acceptance recorded (MT5D-04, MT5D-06)
- [x] 229-03-PLAN.md — A timed MT5 key with no writer basis stores a closed `writer_basis_withheld` token and the compose blocks the book as `key_inputs_mismatch` (MT5D-07)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 229-02-PLAN.md — An inception day-0 P&L without timing is counted as the `inception_day_pnl_dropped` annotation and carried as a bool to the strategy's flags (MT5D-05)
- [x] 229-04-PLAN.md — 226's soak oracle re-derived from the ruled cohort rule, with a judged knife-edge fixture for its CR-04 family (MT5D-04)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 229-05-PLAN.md — A per-day `returns_stamp` in key_inputs; the compose refuses a same-terminal re-derive pair whose returns differ, never a healthy pair (HOLD-03)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 229-06-PLAN.md — Phase gate on the merged head, PROOF-01 ledger, and the founder's live soak recorded as verdict lines (closing)

### Phase 230: MT5NIGHTLY — every MT5 nightly derive ends done on its first attempt, for a named reason

**Goal:** Once 227's per-attempt record holds real nightly runs, the named cause of MT5 `derive_broker_dailies` second attempts is fixed at its root. Then, over seven consecutive nights, every MT5 derive ends `done` with `attempts=1`. Raising retries or a watchdog threshold is not a close. The MT5 derive values that moved without explanation are replayed under both server-clock settings, and each moved value is attributed to the clock switch or to another named cause (`202-MT5-CLOCK-LEAD-01`). This phase is data-gated: its fix cannot be planned before the records exist. The suspected cause is a lease heartbeat shared with HEAL-02, a hypothesis and not a finding. It may land in S3 or S1, and wherever it lands it re-bases on that seam owner's merged bodies.
**Requirements**: MT5D-02, MT5D-03
**Depends on:** Phase 227 deployed, with its per-attempt record holding real nightly MT5 runs (the number of nights is set at plan time from the data); 229 must be merged first if the fix lands in S1. 155.2 freeze, conditional: if the fix or the replay's outcome changes stored values for MM2, MM3 or FX-AI_V, it merges before 155.2 plan 12's recapture or after plan 14, never in between. Research first: read the records.
**Success Criteria** (what must be TRUE):
1. The cause of MT5 second attempts is named from 227's per-attempt records over real nights before any fix is planned, and the fix lands at that cause.
2. After the fix, seven consecutive nights show every MT5 derive `done` with `attempts=1`, read from stored job rows and recorded with their dates. No retry budget or watchdog threshold was raised. (MT5D-02)
3. Each MT5 derive value that moved without explanation is replayed under both server-clock settings and attributed to the clock switch or to another named cause. The repo's record of the setting alone is not a replay. (MT5D-03)
4. PROOF-01: a test that drives the named cause goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Any migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 231: BYBITREADS — a Bybit read covers every coin, settle type, window and deposit exactly once, or refuses by name

**Goal:** Every Bybit read covers every coin, settle type, window and deposit exactly once, or refuses by name, and the owner's static egress IP is allow-listed by the founder (VREAD-05). Before any fix, a venue-by-path census (coin, settle type, window, flow source) is written, and every row is fixed or decided with a test (PITFALLS Pitfall 3). Then:
- The derive anchor sums the same stable coins as the current-equity read, through one shared coin-set constant. Flipping the narrow pin `test_coin_coverage_bybit_derive_reads_usdt_only_while_reconstruct_sums_every_stable_coin` is the intended RED-first test; it is flipped, not deleted.
- The holdings poll includes USDC-settled and inverse positions and their uPnL.
- A strategy trade sync that starts more than seven days back returns every execution in its window, or refuses by name.
- An on-chain deposit is counted exactly once. Replace or union is decided on probe evidence, and recorded as undecided if the probe cannot tell the two apart.

**VREAD-05 is a founder action inside this phase.** The founder allow-lists the Bybit owner's static egress IP, recorded with its date, and that key's daily derive no longer errors for that reason. Until then, live verification of any Bybit fix is partly blind.
**Requirements**: VREAD-01, VREAD-02, VREAD-03, VREAD-04, VREAD-05
**Depends on:** nothing hard. It runs in the venue-reads wave beside 232 and 223, with plan write scopes listed by symbol (`exchange.py`, `positions.py`, `bybit_unified_flows.py`). The anchor feeds `key_inputs.anchor_usd` (S1 to S2), so if 229 is still open, the anchor plan waits for it.
- Research first: the census, a counts-only trade-window probe, and the on-chain deposit probe.
- Founder action: VREAD-05.
- 2026-11-23, plan 05 checkpoint. VREAD-05 is answered: "Allow-listed worker IP" (founder). Its date has an upper bound of 2026-10-24, derived from the derive record (31 of 31 done since that date, 0 IP errors). VREAD-04 is undecided (0 on-chain rows), so `replace` stays.
**Success Criteria** (what must be TRUE):
1. A census of every Bybit read path by coin, settle type, window and flow source is recorded in the phase, and every row is fixed or decided with a test built from a real payload shape.
2. The derive anchor and the current-equity read sum the same stable coins through one shared constant. The holdings poll returns USDC-settled and inverse positions with their uPnL. (VREAD-01, VREAD-02)
3. A strategy trade sync starting more than seven days back returns every execution in the requested window, or refuses by name. An on-chain deposit is counted exactly once, with replace or union decided on probe evidence or recorded as undecided. (VREAD-03, VREAD-04)
4. The founder has allow-listed the owner's static egress IP, recorded with its date, and that key's daily derive no longer errors for that reason. (VREAD-05)
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Mocks mirror recorded real payloads, not our parser's field names.
**Plans:** 6/6 plans complete

Plans:
**Wave 1**
- [x] 231-01-PLAN.md — the 27-row Bybit read census and the VREAD-05 founder doc
- [x] 231-02-PLAN.md — the read-only counts-only probe, shipped v0.133.61.6 (#1314), run once on the backfill worker 2026-11-23

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 231-03-PLAN.md — VREAD-02: the holdings poll reads linear USDT, linear USDC and inverse, inverse in USD at the mark
- [x] 231-04-PLAN.md — VREAD-03: the strategy trade read walks seven-day windows with both bounds, or refuses by name

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 231-05-PLAN.md — VREAD-04 verdict undecided (replace stays), census closure, VREAD-05 founder record and derive check

**Wave 4** *(blocked on Phase 229 merged)*
- [x] 231-06-PLAN.md — VREAD-01: the derive anchor sums the current-equity read's stable coins through one shared rule

### Phase 232: OKXTRADES — an OKX read converts or refuses a non-USDT bill, completes a long window and never runs ahead of stored trades

**Goal:** An OKX read converts or refuses a non-USDT daily bill, completes a first window longer than the page cap, and never lets the trade cursor run ahead of stored trades:
- An OKX daily P&L bill in a currency other than USDT is converted at a stated rate or refused by name, never summed at face value.
- A first window longer than the page cap completes across ticks instead of truncating every day. Raising `OKX_BILLS_PAGE_CAP` is not a close. If the earlier OKXHISTORY work (167.1.2.2.2.1) already closed this, the closing evidence is recorded instead.
- `api_keys.last_fetched_trade_timestamp` never reads ahead of the newest stored trade, and a key found ahead has its skipped days re-read.
**Requirements**: VREAD-06, VREAD-07, VREAD-08
**Depends on:** nothing hard. It runs in the venue-reads wave beside 231 and 223, with plan write scopes listed by symbol. It shares `run_sync_trades_job` with 222 ALERTTRUTH (ERRC-03), so this phase edits only the cursor read and the `advance_fetched_cursor` path, and 222, later in the order, re-bases on it. Research first: check whether OKXHISTORY already closed the truncation.
**Success Criteria** (what must be TRUE):
1. A non-USDT OKX daily P&L bill is converted at a stated rate or refused by name; a test that is RED on today's code feeds a mixed-currency day. (VREAD-06)
2. An OKX first window longer than the page cap completes across ticks with no daily `error`, with `OKX_BILLS_PAGE_CAP` unchanged. Alternatively, the evidence that OKXHISTORY already closed it is recorded. (VREAD-07)
3. A key whose cursor is ahead of its newest stored trade reads from the stored high-water mark and re-reads its skipped days, and the cursor never advances past stored data. (VREAD-08)
4. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 4/4 plans complete

Plans:
**Wave 1**
- [x] 232-01-PLAN.md — VREAD-08: the fills cursor stamps the newest stored fill or nothing, holds on a refused read, and an ahead key re-reads from stored data
- [x] 232-02-PLAN.md — VREAD-07 read: the OKX bills walk reads day-aligned 7-day windows oldest first, caps unchanged, every stop a contiguous oldest prefix

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 232-03-PLAN.md — VREAD-06: a non-USD OKX bill refuses the read by `daily_pnl_non_usd_okx`, named by every reader

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 232-04-PLAN.md — VREAD-07 cron: the cron stores a deadline prefix, holds every cursor, and completes a long first window across ticks

**Cross-cutting constraints:** <!-- gsd:generated -->
- PROOF-01: each named arm goes RED on pre-fix code or a neutered copy first, is restored by `cp` from a byte backup and checked with `cmp`, then goes GREEN; each record is pasted verbatim in the SUMMARY.

### Phase 233: DERIBITTRUTH — a Deribit key's returns reach its newest flow, every book day is explained or withheld, and stale series page on every venue

**Goal:** A Deribit key's returns reach its newest flow and anchor day or carry a named reason, every day of the founder's Deribit book is explained or withheld, a capital correction is never trading P&L, and a stale series pages on every venue:
- **Stale returns (F-9).** One Deribit account's stored returns end 2026-10-26, while its inputs carry a 2026-11-09 flow and its derives report `done`. It is fixed at its root, from the wave-0 read-only diagnosis. Its return series then reaches its newest flow and anchor day, or the gap carries a stored, named reason. Missing days are never backfilled.
- **Freshness check, every venue.** A check that runs outside the derive job compares each daily-derived key's newest stored return day with its newest flow and anchor day. It reports and pages any key behind by more than a stated bound without a named reason. It never blocks CI.
- **Book cumulative.** Every day of the founder's Deribit book cumulative return is explained by booked P&L and flows, or withheld by name. No plausibility bound is applied.
- **Correction rows.** A Deribit correction row carrying a capital reason never classifies as trading P&L, with a fixture per correction shape.
**Requirements**: DBOOK-01, DBOOK-02, FRESH-01, FRESH-02
**Depends on:** Phase 229 merged, because candidate cause (a), the `<2-day` key-mode exit, is shared with MT5; and the wave-0 Deribit diagnosis, which names which keys write the account's returns and which the compose reads. 155.2 freeze, conditional: if the fix changes a shared key-mode exit so that MM2, MM3 or FX-AI_V numbers move, it merges before 155.2 plan 12's recapture or after plan 14, never in between. FRESH-02's home is decided at plan time; as an arm of `ops_staleness_check()` (S5) it is a migration in the serial lane, and v1.23's 242 and 246 re-base on it.
**Success Criteria** (what must be TRUE):
1. The diagnosis names the cause, and the fix lands at it. The account's return series reaches its newest flow and anchor day, or the gap carries a stored, named reason, and no day is backfilled. (FRESH-01)
2. A check outside the derive job reports and pages every daily-derived key, on every venue, whose newest return day trails its newest flow or anchor day by more than the stated bound without a named reason. It goes RED on a lane fixture whose series end is held back, and it never blocks CI. (FRESH-02)
3. Every day of the founder's Deribit book cumulative return is explained by booked P&L and flows, or withheld by name, with no plausibility bound. The close is an attribution reading, not a tolerance. (DBOOK-01)
4. A correction row carrying a capital reason never classifies as trading P&L, including one with a trading token and no capital word; each correction shape has its own fixture. (DBOOK-02)
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Any migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 234: NOCAPITAL — a no-capital key takes one named path, and a transient read never drops a funded key

**Goal:** A no-capital key takes one named path, and a transient read never drops a funded key, in the compose reader's no-capital machinery (seam S2, owned here):
- An MT5 key whose stored terminal reads zero for one tick is never dropped as no-capital while it is funded.
- Any exception raised by a no-capital candidate, not only `NavReconstructionError`, leaves the previous row intact.
- A fallback to `dropped_key` stores a payload flag naming why, and is counted per run.
- A refused candidate leaves no residue reason (such as `key_inputs_mismatch`) in the stored payload.

Python only, no migration. This is the allocator book path, not composite work.
**Requirements**: NOCAP-01, NOCAP-02, NOCAP-03, NOCAP-04
**Depends on:** Phase 229 merged (its `read_writer_basis` edit in S2 lands first); it runs in parallel with 235. 155.2 freeze: NOCAP-01 touches an MT5 key, so it merges before 155.2 plan 12's recapture or after plan 14, never in between.
**Success Criteria** (what must be TRUE):
1. A funded MT5 key whose stored terminal reads zero for one tick keeps its capital; a test drives the transient zero. (NOCAP-01)
2. Any exception raised by a no-capital candidate leaves the previous row intact across retries; a test raises an exception that is not a `NavReconstructionError`. (NOCAP-02)
3. A fallback to `dropped_key` stores a payload flag naming why and is counted per run, not only logged. A refused candidate leaves no residue reason in the stored payload. (NOCAP-03, NOCAP-04)
4. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 235: HOLDINGSTRUTH — one account counts once on Holdings, match scoring and the dashboard, and every failing key is named

**Goal:** Once 225 has settled what the account identity holds, every reader counts one account once:
- A Holdings row whose key is missing from the identity read fails loud, instead of counting as an account of its own (`keyAccountOf`, `fetchHoldings`, `fetchLatestHoldingsPerKey`).
- Match scoring applies the native-unpriced marker per account. For a multi-key account, match AUM and unpriced days then equal what Holdings reports.
- When the dashboard's unpriced-marker read fails, the page shows a note and a Sentry event fires.
- Every failing key of a shared account is named in the missing-data message: the producer `key-data-gaps.ts` first, then `MissingDataMessage.tsx`.
**Requirements**: HOLD-01, HOLD-02, HOLD-04, HOLD-05
**Depends on:** Phase 225 merged, because these readers read the S4 identity value it settles. It runs in parallel with 234.
**Success Criteria** (what must be TRUE):
1. A Holdings row whose key is missing from the identity read fails loud, with a test per reader. (HOLD-01)
2. For a multi-key account, match AUM and unpriced days equal what Holdings reports. (HOLD-02)
3. When the dashboard's unpriced-marker read fails, the page shows a note and a Sentry event fires; stale rows are never shown silently. (HOLD-04)
4. Every failing key of a shared account is named in the missing-data message, including a second key whose cause another key already printed. (HOLD-05)
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans
**UI hint**: yes

Plans:
- [ ] TBD — plans not listed yet

### Phase 236: FIGUREMATH — every engine annualizes one way, CVaR is historical, and moved figures are re-derived and announced

**Goal:** Every engine that annualizes follows F-5, "365, ddof 1 everywhere": the stored Python metrics, the factsheet and Scenario TypeScript engines, portfolio analytics and matching. F-5 sits inside the existing annualization rule: risk by frequency (crypto 365, traditional 252), returns by calendar, and a blend uses 365 if any leg is crypto. The TypeScript engines move to match Python.
- Each language holds the convention in one named constant set, and a cross-language pin enforces it.
- Every engine reports the same CAGR, Sharpe and TWR within a pinned tolerance. The composite half of `L2214` is out (F-2).
- CVaR is historical and null below a minimum observation count held in one named constant (F-6). quantstats moves to 0.0.86 in the same PR as a per-metric decision record.
- CAGR uses one span rule in every engine. Whether emptied stretches count toward the span is a founder ruling at plan time.
- The figures that move are re-derived for the whole fleet. The frozen spine is re-baselined as a reviewed act, and the CHANGELOG names the figures that moved.

This moves published figures on every surface, MT5 included.
**Requirements**: FIG-01, FIG-02, FIG-03, FIG-04, FIG-05
**Depends on:** Phases 229, 233 and 234 merged, so one fleet re-derive covers the stored inputs they change. 155.2 freeze: merges before 155.2 plan 12's recapture or after plan 14, never in between; with F-5 and F-6 ruled either side is open, and the side is recorded. The SCENARIO-05 / BODY-02 regression pins move in the same PR. Research first: the per-metric quantstats decisions.
**Success Criteria** (what must be TRUE):
1. A cross-language pin test fails if any engine's year length or ddof changes. Each language holds both in one named constant set, and a census lists every annualizing site. (FIG-01)
2. For the same strategy and period, every engine reports the same CAGR, Sharpe and TWR within a pinned tolerance, proven by a parity test across all engines whose oracle imports no production helper. (FIG-02)
3. CVaR is historical and reads null below the named minimum observation count. quantstats is 0.0.86, with a per-metric decision record in the same PR, and no moved value is re-pinned without a decision. CAGR uses one span rule in every engine, pinned by a test, per the founder's ruling. (FIG-03, FIG-04)
4. The moved figures are re-derived for the whole fleet. The frozen spine is re-baselined as a reviewed act, never by re-running `regen_golden.py` in a constants PR. The CHANGELOG entry names the figures that moved. (FIG-05)
5. PROOF-01: each gate above goes RED on a one-sided constant change or a neutered copy, with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. A loosened tolerance or re-pinned values is not a close.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 237: FACTSHEETHONEST — every surface shows a strategy's true state, and no cache re-serves a stale or failed one

**Goal:** Every surface shows a strategy's true state, withheld, re-running or owner-private, and no cache re-serves a stale or failed one. This phase is the one owner of the factsheet seam: the OG route `src/app/api/og/factsheet/[id]/route.tsx`, `src/lib/factsheet/fetch-and-build-payload.ts` and `src/app/factsheet/[id]/v2/page.tsx`.
- A withheld factsheet prints no whole-record reading beside rail figures that read as dashes. The three deferred D6 items are a founder ruling at plan time.
- During a re-run, every surface that shows a strategy's figures stays published with a quiet Updating line (Phase 190), the same state as the factsheet: share card, tear sheet, PDFs, returns API, recommendations, portfolios and composer. A census test lists every reader of the recompute verdict.
- A strategy published after its OG card was first requested shows its real card on the next request, and a not-found card is never long-cached.
- A failed BTC price read is never cached as a normal payload.
- The owner's private factsheet shows the data source of their own key-backed strategy.

DBACC-01 (v1.23) edits this seam's whole-column select later and re-bases on it.
**Requirements**: FACT-01, FACT-02, FACT-04, CACHE-01, CACHE-03
**Depends on:** nothing hard (first in the user-facing order). Degraded builds throw inside the `unstable_cache` callback, the house pattern; `use cache` is not adopted.
**Success Criteria** (what must be TRUE):
1. A withheld factsheet prints no whole-record reading beside rail figures that read as dashes, per the founder's ruling on the three D6 items. (FACT-01)
2. During a re-run, every surface on the census stays published with the Updating line. The census test fails when a new reader of the recompute verdict is added unclassified. (FACT-02)
3. A strategy published after its OG card was first requested shows its real card on the next request, and a not-found card is never long-cached. A failed BTC price read is not cached as a normal payload, and the next view retries it. Each case is driven by a good-after-bad-within-TTL test on the real cache wrapper. (CACHE-01, CACHE-03)
4. The owner's private factsheet shows the data source of their own key-backed strategy, never "Data source —", while anon still reads only the published tier; owner and anon are tested per surface. (FACT-04)
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 13 plans
**UI hint**: yes

Plans:
- [x] 237-01-PLAN.md — The shared held-re-run verdict `analyticsHold` and the returns API's held series with `analytics_updating` (FACT-02 S6)
- [x] 237-02-PLAN.md — OG not-found and figure-less cards go out `no-store` keyed on `figuresRendered`; good-after-bad on the real GET (CACHE-01)
- [x] 237-03-PLAN.md — The panel note slot and component, and Worst 10 Drawdowns shows the Withheld note (FACT-01)
- [x] 237-04-PLAN.md — A failed BTC price read throws inside the payload cache callback, key v27, the reload sentence (CACHE-03)
- [x] 237-05-PLAN.md — The share card holds during a re-run with the Updating line and the 60 s held cache; `OG_CARD_VERSION` 3 (FACT-02 S5, CACHE-01)
- [x] 237-06-PLAN.md — Both PDF routes hold with a held ETag and the 60 s cache; tear sheet seam T5b (FACT-02 S2-S4)
- [x] 237-07-PLAN.md — Recommendation cards hold with the Updating line through the full verdict (FACT-02 S7)
- [x] 237-08-PLAN.md — Composer drawer-added rows show the Updating line from the returns field; registry entry (FACT-02 S8)
- [x] 237-09-PLAN.md — The EOY bar chart, heatmap YTD, Worst 10 chart and rolling hover value are withheld too (FACT-01 follow-on)
- [x] 237-10-PLAN.md — The owner's unpublished factsheet reads its own trust tier on Lane B through RLS (FACT-04)
- [x] 237-11-PLAN.md — The recompute-verdict census, the retired surfaces asserted, pins reconciled, full suite green (FACT-02 SC-2)
- [x] 237-12-PLAN.md — EOY Returns, Calmar by Year and Style Drift with KS show the Withheld note (FACT-01)
- [x] 237-13-PLAN.md — Composer book-strategy rows show the Updating line from a new book-payload field, book wins (FACT-02 S8b)

### Phase 238: NEVERCOMPUTED — a strategy that never computed, failed or stalled never claims a compute time or tells its owner to wait

**Goal:** A strategy that never computed, failed or stalled never claims a compute time or tells its owner to wait:
- **Never-computed rows.** A never-computed analytics row never reads "Analytics last computed", and freshness checks never take its insert time as a compute time. Today the column is `strategy_analytics.computed_at DEFAULT now() NOT NULL`. A founder ruling at plan time chooses between a nullable `computed_at`, which reverses CONTEXT R-04 and needs a migration, and a separate marker.
- **The /strategies note.** For a failed, stalled or never-started row, the /strategies note never tells the owner to wait (`MINT_TOKEN_NOTES.not_available`).
**Requirements**: FACT-03, FACT-05
**Depends on:** nothing hard. If the founder picks the nullable `computed_at`, every reader keyed on it is censused and moved in the same PR. FRESH-02's check is among those readers, so this phase then comes after 233.
**Success Criteria** (what must be TRUE):
1. A never-computed row shows no compute date on any surface, and no freshness check reads its insert time as a compute time. A census of `computed_at` readers fails on an unclassified new one. (FACT-03)
2. For a failed, stalled or never-started row, the /strategies note names an action and never says to wait. (FACT-05)
3. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. A migration, if the founder picks one, passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 0 plans
**UI hint**: yes

Plans:
- [ ] TBD — plans not listed yet

### Phase 239: SURFACECACHE — the composer range and the Discovery ranking reflect the current truth

**Goal:** The composer range and the Discovery ranking reflect the current truth:
- **Composer range.** The composer stores its selected range as dates, so a 12M preset always ends on the latest day and keeps the same dates when the series grows at the front (founder: "book a fix", `201.1-COMPOSER-RANGE-AS-DATES`; `factsheet-context.tsx` `userRange` holds axis indices today).
- **Discovery ranking.** Discovery never ranks a BTC-unit return beside USD returns as if the two were comparable (`queries.ts` ranking and the `StrategyTable.tsx` chip).
  ⛔ **CORRECTED 2026-11-24 (founder ruling, recorded in `239-CONTEXT.md`; the line above is kept as lineage).** A BTC-unit strategy's returns are its pure performance on a different collateral. Discovery ranks BTC-unit and USD returns together as pure performance, with no BTC price conversion and no separate group; the "in BTC" chip stays. Founder, Q1: "That is correct, As BTC Strategies usually just have a different collateral." Q2: "Dont include BTC Price conversion. Just compare pure Performance". Composer presets roll to the latest day and span calendar months; a manual range keeps its dates (Q4, Q5).
**Requirements**: CACHE-02, CACHE-04
**Depends on:** nothing hard. CACHE-04's trigger reading, the count of published native-unit strategies, is taken read-only at plan time.
**Success Criteria** (what must be TRUE):
1. A 12M composer preset ends on the latest day, and the selected dates stay the same when the series grows at the front; a test grows the series. (CACHE-02)
2. Discovery never ranks a BTC-unit return beside USD returns as comparable; a test with one BTC strategy and one USD strategy pins it. (CACHE-04)
   ⛔ CORRECTED 2026-11-24 (founder ruling): BTC-unit and USD returns are ranked together as pure performance, with no BTC price conversion at list build; a pin test is added only if it encodes that. (CACHE-04)
3. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 3/3 plans complete
**UI hint**: yes

Plans:
- [x] 239-01-PLAN.md — CACHE-02: a manual range keeps its dates on growth at either end (date store, resolver, active-basis axis)
- [x] 239-02-PLAN.md — CACHE-02: 3M/6M/12M presets span calendar months, end on the latest day and roll
- [x] 239-03-PLAN.md — CACHE-04: pin that BTC-unit and USD rows rank together unconverted

### Phase 240: CONNECTTRUTH — validating a key or a CSV gets a true answer, and anonymous limits are fair

**Goal:** Validating a key or a CSV gets a true answer, and the anonymous and CSV rate limits match the buckets behind them:
- **Error code.** Every validate-key 400 body carries the same machine-readable code field on every venue. The entry's other two findings, permanence plumbing with one consumer and coordinate drift, are fixed or recorded with a reason.
- **CSV date cells.** A month-name date cell in a numeric-date CSV column is parsed, or rejected with a message naming the cell and the expected format. This is a founder ruling at plan time.
- **Anonymous bucket.** A few anonymous visitors from different IPs cannot exhaust the shared anonymous verify-strategy bucket, and no limit is keyed on the proxy's IP. A per-IP anonymous tier through the signed claim, or a raised shared tier, is a founder ruling at plan time.
- **CSV limits.** A signed-in user validating a CSV within the edge limit never gets an upstream 429, because the edge limit and the shared `/process-key` tenant tier agree. The limiter's docblock cites the current upstream cap. ⛔ CORRECTED 2026-11-24 (founder ruling, Phase 240 CONTEXT): agreement is met by a CSV-scoped per-tenant `/process-key` tier (60/minute, exempt from the 500/hour ceiling), not by retuning the shared tenant tier, which stays 100/hour.

No migration.
**Requirements**: CONN-05, CONN-06, RLIM-01, RLIM-02
**Depends on:** nothing hard. `csv_validator.py` is shared with 222 ALERTTRUTH (its "contact support" string), so the two work with symbol-scoped write lists or one after the other.
- `publicIpLimiter` also serves the factsheet-share, scenario-share, BTC benchmark and tearsheet PDF routes, so retuning it moves those too.
- Research: the analytics-service replica count on Railway, because the `memory://` limiter is per replica.
**Success Criteria** (what must be TRUE):
1. Every validate-key 400 body carries the same machine-readable code field on every venue; a test per venue reads it. (CONN-05)
2. A month-name date cell in a numeric-date CSV column is parsed, or rejected with a message naming the cell and the expected format, per the founder's ruling. (CONN-06)
3. Several anonymous visitors from different IPs cannot exhaust the shared anonymous verify-strategy bucket, and no limit is keyed on the proxy's IP. (RLIM-01)
4. A signed-in user validating a CSV within the edge limit never gets an upstream 429; the edge limit and the shared `/process-key` tenant tier agree, and the limiter docblock cites the current upstream cap. (RLIM-02) ⛔ CORRECTED 2026-11-24 (founder ruling, Phase 240 CONTEXT): agreement is met by a CSV-scoped per-tenant `/process-key` tier (60/minute, exempt from the 500/hour ceiling), not by retuning the shared tenant tier, which stays 100/hour.
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 8/8 plans complete
**UI hint**: yes

Plans:
**Wave 1**
- [x] 240-01-PLAN.md — CONN-06: a month-name date cell in a numeric-date CSV column parses and the date-normalization info flag says so (wave 1)
- [x] 240-02-PLAN.md — RLIM-01 Python: per-IP anonymous buckets, a 200/hour anonymous aggregate, and the limit stack evaluated per-identity first (wave 1)
- [x] 240-03-PLAN.md — CONN-05 part 1: the rostered-code validate-key 400 arms answer the flat code-bearing body (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 240-04-PLAN.md — RLIM-02 Python: a csv-scoped tier of 60/minute, exempt from the 500/hour ceiling (wave 2)
- [x] 240-05-PLAN.md — CONN-05 part 2: VENUE_DISABLED and INVALID_REQUEST, the rotate-secret go-dark gate, and a raw-400 census (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 240-06-PLAN.md — RLIM-01/02 TS: the per-IP anonymous claim and the csv scope minted in postProcessKey (wave 3)
- [x] 240-07-PLAN.md — RLIM-02 edge: csv-finalize gets its own limiter, the docblock cites the real cap, and a cross-language agreement test (wave 3)
- [x] 240-08-PLAN.md — CONN-05 part 3: process-key honours a stated permanent verdict, STATUS_CONTRACT coordinates re-anchored by symbol (wave 3)

**Cross-cutting constraints:** <!-- gsd:generated -->
- PROOF-01: each new gate goes RED on a neutered byte copy with its named test, restored with cp, cmp exits 0, GREEN; outputs pasted verbatim into the SUMMARY

### Phase 241: DEMOCREDS — the two demo accounts are gone, and their passwords are out of the tree behind a guard that still bites

**Goal:** The two demo accounts no longer exist, and their passwords are out of the tree behind a guard that still bites, closing the only HIGH item in scope, `158-OPS-03` (F-3).
- **Accounts deleted.** The two unused demo accounts are deleted on TEST and on PROD, and the deletion is recorded with its date. This is an auth write by the founder or by an agent under the standing PROD-write rules, marker query first. With the accounts gone, the copies in public history are dead.
- **Literals removed.** No tracked file contains either demo password literal. The absence guard is redesigned to check a digest instead of the literal, and is shown RED by planting a matching literal.
- **Seed and drain coupling.** The coupling to those accounts is retired or redirected, decided explicitly in the plan.

Removing the text alone does not close the item, and history is not rewritten. The literals are never quoted in a CHANGELOG, PR body or TODOS entry. The phase is in v1.22 by founder exception (F-10); the rest of the security tier is v1.23.
⛔ **CORRECTED 2026-11-24 (founder ruling, deviation policy; also in `241-CONTEXT.md`): SC-1 is narrowed.** PROD measurement disproved the premise that both accounts are unused. The shared e2e login (pair A) holds the admin role, owns 1 of PROD's 2 published strategies and has a key that syncs daily. Ruling: keep pair A, and the founder resets its password himself, so the leaked credential is dead and scrubbed from the tree while the account stays. The seed allocator (pair B) is deleted on TEST (done 2026-11-24) and on PROD as originally planned. The SC-1 text below is kept as lineage.
**Requirements**: SECR-01, SECR-02
**Depends on:** nothing; it shares no seam. By tier order it follows the user-facing phases, and the founder may pull it forward.
**Success Criteria** (what must be TRUE):
1. Neither demo account exists on TEST or PROD. The deletion is recorded with its date, and no credential literal appears in the record. (SECR-01)
2. No tracked file contains either demo password literal. The absence guard checks a digest, not the literal, and goes RED when a matching literal is planted in a byte copy. (SECR-02)
3. The seed and drain paths that used the accounts are retired or redirected as the plan decides, and the suites that read them run green without the accounts.
4. PROOF-01: the absence guard and any changed seed pin go RED on a neutered copy with the named arm first. Each is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY without quoting a literal.
**Plans:** 4 plans

Plans:
**Wave 1**
- [x] 241-01-PLAN.md — Records scrub: the 12 archived planning files lose every demo login and password literal, placeholders by role (SECR-02; ships first as a records PR)
- [x] 241-03-PLAN.md — Pair B's delete chain and admin-API delete rehearsed on the local-stack lane, abort arms and PROOF-01 (SECR-01)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 241-02-PLAN.md — The whole-tree digest guard in `npm run lint`, the e2e test without literals, and PROOF-01 for every guard arm (SECR-02, PROOF-01)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 241-04-PLAN.md — Pair B deleted on PROD behind the founder's go, TEST absence re-verified, Pair A kept, closed TODOS entry deleted (SECR-01)

### Phase 250: BINANCEFILLS — a Binance fills read walks every window and never stalls its cursor

**Goal:** A Binance raw fills read covers every window from its cursor to now, and its cursor never stalls, silently or because one symbol fails. This phase must land before `USE_RAW_TRADE_INGESTION` is turned on for Binance. It closes the three Binance survivors that Phase 232's review routed (`232-REVIEW.md`, round 2):
- **R2-02 (silent stall).** A Binance linear key with a set cursor and more than 7 quiet days reads an empty `[C, C+7d]` window, never stamps, and its cursor never moves again. The fix is a window-walking Binance fills read in `exchange.py`, not a wall-clock advance on an empty read (Phase 232 removed that advance because it ran the cursor ahead, VREAD-08).
- **R2-01 (loud stall).** A symbol that raises `ccxt.BadSymbol` on every run (delisted or unmapped) sets `binance_partial_symbols` every run, so the Phase 232 CR-02 hold keeps the fills cursor at C and healthy symbols stop past C+7d. The fix lets healthy symbols advance while a venue-unlisted symbol is still named, with no silent skip of a transiently failed symbol's span.
- **BINANCE_PAGE_CAP stop.** The per-symbol `BINANCE_PAGE_CAP` stop records no flag, so a capped symbol loses its newest fills and the max over the other symbols stamps past them silently. The stop is flagged and resumes past the cap, rather than stalling on the same oldest pages every run.
**Requirements**: none mapped (routed review survivors from Phase 232: R2-01, R2-02 and the `BINANCE_PAGE_CAP` stop)
**Depends on:** Phase 232 (shipped, #1330), whose fills-cursor rules (stamp the newest stored fill or nothing; hold on `sync_truncated_*` and `binance_partial_symbols`) this phase keeps. Founder ruling 2026-11-24: "R2-02: book a follow-up phase with /gsd-phase (plain add) for a windowed Binance fills read. It must land before USE_RAW_TRADE_INGESTION is turned on for Binance. Fold R2-01 and the BINANCE_PAGE_CAP no-flag item into the same phase's scope." It shares `run_sync_trades_job` with 222 ALERTTRUTH, so plans list their write scope by symbol.
**Success Criteria** (what must be TRUE):
1. A Binance linear key whose cursor is followed by more than 7 days with no fills keeps reading forward window by window and reaches fills newer than those days; its cursor never stays at C on a quiet stretch and never advances past stored data. A test that is RED on today's code feeds the quiet stretch. (R2-02)
2. A symbol that fails on every run is named on every run, the healthy symbols' fills past C+7d are still read and stored, and a transiently failed symbol's span is re-read on the next clean run, never skipped silently. (R2-01)
3. A symbol that hits `BINANCE_PAGE_CAP` records a named flag, the cursor never stamps past that symbol's unread fills, and a later run resumes past the cap instead of re-reading the same oldest pages. (`BINANCE_PAGE_CAP` stop)
4. `USE_RAW_TRADE_INGESTION` is not turned on for Binance before criteria 1 to 3 are met on `main`; the phase records this as an explicit precondition of that switch.
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Progress (this milestone)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155.2. LIVEPARITY | 13/17 | In progress | - |
| 157. FOUNDER-CONFIRM | 1/3 | In progress | - |
| 222. ALERTTRUTH | 0/? | Not started | - |
| 223. FLOWKINDS | 5/5 | Complete (shipped v0.133.68.0, #1327) | 2026-11-24 |
| 225. ONEACCOUNTONCE | 4/12 | In progress (PR-1 shipped as #1315) | - |
| 226. MT5SOAK | 5/5 | Complete (shipped v0.133.64.0, #1319) | 2026-11-24 |
| 227. JOBLEDGER | 11/11 | Complete (shipped v0.133.67.0, #1325; HEAL-01 sweep registered on PROD) | 2026-11-24 |
| 228. KEYANSWERS | 0/? | Not started | - |
| 229. MT5DERIVE2 | 5/6 | Shipped v0.133.69.0 (#1328); human verification pending (229-06 Task 2, the founder's live soak) | - |
| 230. MT5NIGHTLY | 0/? | Not started | - |
| 231. BYBITREADS | 6/6 | Complete (plans 01-05 shipped v0.133.61.6 #1314 and v0.133.65.0 #1321; plan 06 shipped v0.133.73.0 #1333 after Phase 229) | 2026-11-25 |
| 232. OKXTRADES | 4/4 | Complete (shipped v0.133.70.0, #1330) | 2026-11-24 |
| 233. DERIBITTRUTH | 0/? | Not started | - |
| 234. NOCAPITAL | 0/? | Not started | - |
| 235. HOLDINGSTRUTH | 0/? | Not started | - |
| 236. FIGUREMATH | 0/? | Not started | - |
| 237. FACTSHEETHONEST | 13/13 | Shipped v0.133.63.0 (#1316); human verification pending (2 visual checks) | - |
| 238. NEVERCOMPUTED | 0/? | Not started | - |
| 239. SURFACECACHE | 3/3 | Complete (shipped v0.133.72.0, #1332) | 2026-11-24 |
| 240. CONNECTTRUTH | 8/8 | Complete (shipped v0.133.74.0, #1334) | 2026-11-25 |
| 241. DEMOCREDS | 4/4 | Verified human_needed (Pair A reset is the founder's); code PR pending | - |
| 250. BINANCEFILLS | 0/? | Not started | - |

## 📋 v1.23 HARDEN — security, alerting, tooling (planned; starts after TRUTH closes)

Planned by founder ruling 2026-11-23, "Yes, split into two milestones" (F-10 in `REQUIREMENTS.md`). This milestone takes the security tier and the rest: alerting, held Sentry captures, SQL gates, test lanes and dead leftovers. The one exception is SECR-01/02, which stay in v1.22 as 241 DEMOCREDS because `158-OPS-03` is the only HIGH item. Its 35 requirements are listed under "Planned for v1.23" in `REQUIREMENTS.md`. The carried 221 SENTRYSCRUB2 and 224 DEADLEFTOVERS moved here with their tiers. The milestone starts with `/gsd-new-milestone` after v1.22 closes, when its requirements and these sections are re-read. PROOF-01, the migration lane and the TODOS closure rule from v1.22 apply unchanged.

**Order** (founder F-1, then the research's waves):
1. **Security:** 242 SECRETSHYGIENE (its S5 narrowing is the first S5 migration), 243 DBBACKSTOP, 244 ACCESSGUARDS and 221 SENTRYSCRUB2.
2. **The rest:** 245 ALERTPAGE; 246 ALERTREADERS, after 242's S5 migration; 247 SENTRYHELD, after 221; 224 DEADLEFTOVERS; 248 SQLGATES2; 249 TESTLANES.

### Phases (HARDEN)

- [ ] **Phase 221: SENTRYSCRUB2 — no Sentry event carries PostgREST details or hint from any capture site, and browser captures actually report** - Sentry scrub at the last hop for direct capture sites, then client Sentry init; independent of the MT5 parity phases
- [ ] **Phase 224: DEADLEFTOVERS — dead SQL, retired job kinds still enqueued and inert plumbing are retired** - Dead SQL, the retired compute_analytics enqueue and kind rows, and inert plumbing, with a migration; the poll_positions enqueue stays live (F-8)
- [ ] **Phase 242: SECRETSHYGIENE — the full history is scanned on a schedule, and the cron service key goes only to named hosts** - Scheduled full-history scan; the S5 wildcard closed in both cron functions, first of the S5 migrations
- [ ] **Phase 243: DBBACKSTOP — anon reads only named metric keys, an api_keys write must belong to its caller, and a client role cannot hold a table lock** - Database-level backstops by migration; the lock timeout measured on TEST first
- [ ] **Phase 244: ACCESSGUARDS — an owner read without its key id fails to compile, every route writes its audit row, and the watchlist RLS runs in CI** - Application and CI guards, no migration expected
- [ ] **Phase 245: ALERTPAGE — an MT5 outage pages once, recovers once and closes once, and every paging failure is loud** - Python paging path: episode lifecycle on a fake clock, honest Sentry credit, inline close budget, ERROR-level failures
- [ ] **Phase 246: ALERTREADERS — every alert reader sees every row, reports its own delivery failure and pages per account** - S5 readers re-based on the narrowed body: pg_net delivery, scrub reader, per-account sync paging, match-engine cron signal
- [ ] **Phase 247: SENTRYHELD — a failing anonymous read reports exactly once, and the landing page at most once per window** - Caller-only; ordered after SENTRYSCRUB2
- [ ] **Phase 248: SQLGATES2 — SQL gate censuses fail when an axis drifts, and apply-test tells a seeded ledger row from an applied migration** - Derived census axes, enforced exemptions, provenance gate twins, the apply-test fix before the forward comment correction
- [ ] **Phase 249: TESTLANES — every live-DB lane test executes, a fence timeout fails, lint agrees cold and warm, and the PROD image crash risk is measured** - Ledger to zero with no assertion weakened, no green skips, cache-proof lint, supautils measured locally on the PROD image version

### Phase 221: SENTRYSCRUB2 — no Sentry event carries PostgREST details or hint from any capture site, and browser captures actually report

**Goal:** No Sentry event, from any capture site, server or browser, carries a PostgREST error's `details` or `hint`, and a capture made in browser code actually reaches Sentry. The last-hop scrub in `scrubSentryEvent` (`src/instrumentation.ts`) drops `details` and `hint` from a non-Error capture's `extra.__serialized__`, so the direct `Sentry.captureException` sites that bypass `scrubCaptureInput` are covered too. Only after that scrub ships does browser code get a client `Sentry.init` running the same scrub, so turning client capture on can never send an unscrubbed event. The auth callback's GoTrue `error` / `error_code` branch logs the error code (short, never `error_description`), so failed verifies become visible. Trigger: founder decisions 2026-11-23, "Book phases: SENTRYSCRUB2, ALERTTRUTH, FLOWKINDS (composite half), DEADLEFTOVERS". Owns `TODOS.md` `[209-SENTRY-DIRECT-CAPTURE-DETAILS]`, `[167.2.1-CLIENT-SENTRY-NOOP]` and `[219-CALLBACK-VERIFY-ERROR-LOG]` (fix directions and gates as written there).
**Requirements**: SCRB-01, SCRB-02, SCRB-03
**Depends on:** none (independent of the MT5 parity phases)
**Success Criteria** (what must be TRUE):
1. A real-SDK envelope test (the in-memory transport in `src/instrumentation.test.ts`) captures a plain object carrying `details` and `hint` sentinels through a direct `Sentry.captureException` call, and neither sentinel reaches the envelope; the test is shown RED before the fix.
2. The scrub lands before, or in the same change as, the browser `Sentry.init`; no build ships a client init without the `details`/`hint` scrub in its `beforeSend`.
3. A `captureToSentry` call in a `"use client"` module produces an event (proved by a test against the client init, not by reading config), and the client event passes through the same scrub as a server event.
4. The auth callback's GoTrue error branch logs the `error_code` value, sliced short, and never `error_description`; a callback test sending `error_code=otp_expired` with the email-change marker asserts it, shown RED before the fix.
5. The three TODOS entries above are deleted in the ship PR and named in its CHANGELOG entry.
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 224: DEADLEFTOVERS — dead SQL, retired job kinds still enqueued and inert plumbing are retired

**Goal:** Dead SQL, the retired `compute_analytics` job family's leftover enqueue and kind rows, and inert plumbing are removed, so nothing in the repo looks alive that is not.
- The dead `get_admin_compute_jobs` function is dropped by migration (migration-reviewer and rls-policy-auditor apply before merge).
- The retired `compute_analytics` family's daily enqueue and its `compute_job_kinds` rows are retired, filed as dead code and never as an outage. They go only after a read-only PROD count of jobs created per day for those kinds shows none.
- Phase 176's inert leftovers (`managerSideKeyIds`, `excludedManagerSide`, the `"legacy"` `equityCurveSource` value) and the reconstruct cap and marker machinery are deleted or given a live caller.
- `src/lib/database.types.ts` stops declaring functions that no longer exist.

⛔ **The `poll_positions` enqueue is NOT retired (founder ruling F-8, 2026-11-23).** PROD measured 2026-11-23: `poll_positions` jobs ran on 21 days between 2026-10-24 and 2026-11-23, for one strategy only. So `enqueue_poll_positions_for_all_strategies` and its `daily_enqueue_tick` caller are live. Widening their cohort is HEAL-05 in v1.22's 227 JOBLEDGER (`FANOUT-COHORT-SIBLING-POLL-01`). This overrides two things that named that enqueue for retirement: the goal and SC-2 as booked, and the `poll_positions` half of the `TODOS.md` entry headed "Retired job kinds still carry a live daily enqueue that has fired nothing since 2026-06-14" (`L2925`).

Trigger: founder decisions 2026-11-23, "Book phases: SENTRYSCRUB2, ALERTTRUTH, FLOWKINDS (composite half), DEADLEFTOVERS". The phase moved to v1.23 by the founder's split ruling the same day. Owns `TODOS.md` `[169-DEAD-ADMIN-JOBS-RPC]`, `[176-INERT-LEFTOVERS]`, `[176-RECONSTRUCT-CAP-MARKER-INERT]`, `[164.5-STALE-GENERATED-TYPES]`, and the `compute_analytics` half of the entry headed "Retired job kinds still carry a live daily enqueue that has fired nothing since 2026-06-14".
**Requirements**: DEAD-01, DEAD-02, DEAD-03, DEAD-04, DEAD-05
**Depends on:** Phase 227 merged (v1.22's JOBLEDGER). 227 owns seam S3 and widens `enqueue_poll_positions_for_all_strategies` (HEAL-05), which this phase must not touch; DEAD-02's migration re-bases on 227's merged bodies. Otherwise the phase is independent of the MT5 parity phases.
**Success Criteria** (what must be TRUE):
1. `get_admin_compute_jobs` no longer exists on TEST or PROD after the migration applies, and no caller, test or census still names it.
2. No daily enqueue creates or tries to create a job of the retired `compute_analytics` family. Its enqueue code and its `compute_job_kinds` rows go only once two conditions hold: a read-only PROD count of jobs created per day for those kinds (the measurement behind F-8) shows none, and no queued row of those kinds can still exist. `enqueue_poll_positions_for_all_strategies` and its `daily_enqueue_tick` caller are untouched (F-8).
3. `managerSideKeyIds`, `excludedManagerSide` and the `"legacy"` `equityCurveSource` value are deleted together with their tests, and every cap, marker and orphaned item listed in `[176-RECONSTRUCT-CAP-MARKER-INERT]` is removed or given a live caller, with `test_the_d04_inert_helpers_stay` retired or rewritten to match.
4. `src/lib/database.types.ts` declares no function that the schema lacks, and the way it is kept current (regeneration step with a freshness gate, or a recorded decision) is written down.
5. The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane. These four entries are deleted in the ship PR and named in its CHANGELOG entry: `[169-DEAD-ADMIN-JOBS-RPC]`, `[176-INERT-LEFTOVERS]`, `[176-RECONSTRUCT-CAP-MARKER-INERT]` and `[164.5-STALE-GENERATED-TYPES]`. The retired-kinds entry is deleted once its `compute_analytics` half closes, and the CHANGELOG names F-8 as the reason its `poll_positions` half is not acted on.
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. The drop is preceded by a census of `cron.job` commands and RPC callers.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 242: SECRETSHYGIENE — the full history is scanned on a schedule, and the cron service key goes only to named hosts

**Goal:** The full history is scanned for secrets on a schedule, and the cron functions post the service key only to exact named hosts:
- **Full-history scan.** A full-history secret scan runs on a schedule, on the gitleaks 8.30.1 binary already pinned. Two questions are decided at plan time, after the `.planning/WINDOWS.md` entry 61 findings are re-measured: how historical findings are suppressed (commit-scoped `.gitleaksignore` fingerprints, or literals made obviously fake; never a committed `--baseline-path` report), and whether a red scheduled scan may block a redeploy.
- **Cron destinations.** `cron_sync_tick` and `ops_staleness_check` post the service key only to exact named hosts, never through a `.up.railway.app` suffix wildcard. One migration narrows both functions. It is the first S5 migration of v1.23, and 246 re-bases on it. The entry's gate-arm and tab-key guard gaps are closed in the same change.
**Requirements**: SECR-03, SECR-04
**Depends on:** v1.22 closed. If v1.22's 233 put FRESH-02 in `ops_staleness_check()`, this migration re-bases on that body. `scripts/prod-prober/cron-manifest.json` moves with it.
**Success Criteria** (what must be TRUE):
1. A scheduled workflow scans the full history and is green on its first run. Historical findings are suppressed by the method chosen at plan time, and no credential-shaped literal is re-published. (SECR-03)
2. `cron_sync_tick` and `ops_staleness_check` post the service key only to exact named hosts; a SQL gate arm goes RED on a wildcard host. The entry's gate-arm and tab-key guard gaps are closed, each with an arm that goes RED. (SECR-04)
3. PROOF-01: each gate above goes RED on a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. The new SQL arms carry `RED-UNDER` twins. The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 243: DBBACKSTOP — anon reads only named metric keys, an api_keys write must belong to its caller, and a client role cannot hold a table lock

**Goal:** An anonymous request reads only named metric keys, an `api_keys` write must belong to its caller, and a client role cannot hold a table lock past a timeout:
- **Anon factsheet read.** An anonymous request reads only the named metric keys a factsheet needs, never the whole `metrics_json_by_basis` column.
- **`api_keys` ownership.** A database-level backstop refuses an `api_keys` write whose `user_id` is not the caller's, including an insert through the admin client. Its design gets architecture sign-off at plan time, and `FORCE RLS` on `api_keys` is not the mechanism: it breaks every connect.
- **Lock hold.** A client role holding UPDATE or DELETE cannot keep a table-wide lock past a set timeout. The timeout mechanism is first proven on TEST to be honoured through PostgREST.
**Requirements**: DBACC-01, DBACC-02, DBACC-03
**Depends on:** Phases 237, 225 and 235 merged (all v1.22): DBACC-01 edits 237's payload-builder select, and DBACC-02's trigger is on `api_keys`, the table 225 changes and 235 reads. DBACC-03's timeout is measured on TEST as a client role before any migration.
**Success Criteria** (what must be TRUE):
1. An anonymous request reads only the named metric keys a factsheet needs; a test fails on a key outside the pinned alias set. (DBACC-01)
2. A database-level backstop refuses an `api_keys` write whose `user_id` is not the caller's, including an insert through the admin client, without `FORCE RLS` on `api_keys`. (DBACC-02)
3. A client role holding UPDATE or DELETE cannot keep a table-wide lock past a set timeout. A recorded TEST measurement comes first, showing that PostgREST honours the timeout and that no legitimate request needs longer. (DBACC-03)
4. PROOF-01: each gate above goes RED on a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Each migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 244: ACCESSGUARDS — an owner read without its key id fails to compile, every route writes its audit row, and the watchlist RLS runs in CI

**Goal:** An owner read without its key id fails to compile, every route writes its audit row or carries an exemption, and the watchlist RLS assertions run in CI:
- **Compile guard.** An owner-surface read that lacks `api_key_id` fails to compile (`src/lib/types.ts`).
- **Audit rows.** Each of the six routes outside the audit-log law writes an audit row, or carries a recorded founder exemption. The exact-set allowlist only shrinks.
- **Watchlist in CI.** The `discovery-watchlist` RLS and auth assertions (the MEDIUM half of `158-OPS-03`) run in CI and can fail there.
**Requirements**: DBACC-04, DBACC-05, DBACC-06
**Depends on:** nothing hard.
**Success Criteria** (what must be TRUE):
1. An owner-surface read that lacks `api_key_id` fails to compile, shown by a type-level test. (DBACC-04)
2. Each of the six routes writes an audit row or carries a recorded founder exemption, and the exact-set allowlist only shrinks. (DBACC-05)
3. The `discovery-watchlist` RLS and auth assertions run in a CI job, and a neutered policy turns that job red. (DBACC-06)
4. PROOF-01: each gate above goes RED on a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 245: ALERTPAGE — an MT5 outage pages once, recovers once and closes once, and every paging failure is loud

**Goal:** The Python paging path follows an episode lifecycle: open once, recover once, close once. The files are `services/ops_alert.py`, `mt5_outage_alert.py`, `mt5_relogin.py`, `ops_alert_open.py` and `mt5_validation_liveness.py`.
- **Episodes.** An MT5 outage episode produces exactly one open, one recovered and one close. This holds through a relapse within the hour, through a second healthy reading during the held recovery wait, and when relaunch debt is paid outside the heal tick's check.
- **Sentry credit.** An outage is credited to Sentry only when a notification can actually go out.
- **Close budget.** A Sentry-credited recovery closes the open page within the probe tick's time budget.
- **Loud failures.** Every failure on the paging path logs at ERROR or as a Sentry event, never at WARNING.

`sentry-sdk` stays on 2.x, because 3.0 removes a hook the redaction depends on.
**Requirements**: ALRT-01, ALRT-02, ALRT-03, ALRT-04
**Depends on:** nothing hard (first in the alerting order). It shares `ops_alert.py` with 246, which edits `_admit_through_window` while this phase edits the Sentry credit, so plan write scopes are listed by symbol.
**Success Criteria** (what must be TRUE):
1. An MT5 outage episode produces exactly one open, one recovered and one close. Each case runs as a test on a fake clock across several ticks: a relapse within the hour, a second healthy reading during the held wait (no duplicate RECOVERED, no false "restarted"), and relaunch debt paid outside the heal tick's check. (ALRT-01)
2. An outage is credited to Sentry only when a notification can go out. A capture with no event id, or one inside the rule's action interval, is not credited, and the alert path signals that. (ALRT-02)
3. A Sentry-credited recovery closes the open page within the probe tick's time budget. (ALRT-03)
4. Every failure on the paging path, including a failed open-record write and the path's own handlers, logs at ERROR or as a Sentry event, never at WARNING. (ALRT-04)
5. PROOF-01: each gate above goes RED on a neutered copy with its named arm first (for example "paged 2 times, expected 1"). It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Real delivery is PROD-only and gets a dated drill reading.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 246: ALERTREADERS — every alert reader sees every row, reports its own delivery failure and pages per account

**Goal:** Every alert reader sees every row and reports its own failures:
- **Delivery.** `ops_staleness_check` reads its own delivery outcome from `net._http_response`; a queued pg_net request is never taken as delivered.
- **Scrub reader.** The scrub reader reads every row since its last tick, and a second same-cause failure within an hour is paged.
- **Paging level.** One key failing two syncs in a row does not page every hour. Paging happens at account or cohort level, followed by one recovered notice.
- **Match-engine cron.** A failed match-engine cron run produces a readable signal outside the cron. Whether a tick that processes nothing counts as a failure is a founder ruling at plan time.

The SQL members re-base on 242's narrowed S5 body. Every new check appears in `scripts/prod-prober/cron-manifest.json`.
**Requirements**: ALRT-05, ALRT-06, ALRT-07, ALRT-08
**Depends on:** Phase 242 merged. This phase re-bases `ops_staleness_check()` on 242's narrowed body, and two open PRs never each carry a full copy of the function.
**Success Criteria** (what must be TRUE):
1. `ops_staleness_check` reads its own delivery outcome from `net._http_response` and reports a failed delivery; a test drives a pg_net 401. (ALRT-05)
2. The scrub reader reads every row since its last tick. A second same-cause scrub failure within an hour is paged, not marked paged and dropped. (ALRT-06)
3. One key failing two syncs in a row does not page every hour. Paging happens at account or cohort level, followed by one recovered notice. (ALRT-07)
4. A failed match-engine cron run produces a readable signal outside the cron, and the check is in the prober cadence manifest, so its absence pages. (ALRT-08)
5. PROOF-01: each gate above goes RED on a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. New SQL arms carry `RED-UNDER` twins. The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 247: SENTRYHELD — a failing anonymous read reports exactly once, and the landing page at most once per window

**Goal:** A failing anonymous read produces exactly one tagged Sentry event that arrives, because the capture is held before the throw. A landing page view with failing social-proof stats produces at most one Sentry event per throttle window. The change is caller-only (`failAnonRead` in `src/lib/queries.ts`, `getSocialProofStats` on the landing page). `captureToSentry` keeps its signature, and `after()` lives at the call site, because client components import `sentry-capture.ts`. The phase runs after 221: research left the order open (FEATURES and ARCHITECTURE found no file conflict, PITFALLS said land after 221), and the roadmap takes PITFALLS's order so the capture path changes one phase at a time.
**Requirements**: HELD-01, HELD-02
**Depends on:** Phase 221 merged.
**Success Criteria** (what must be TRUE):
1. A failing anonymous read produces exactly one tagged Sentry event that arrives, because the capture is held before the throw. (HELD-01)
2. A landing page view with failing social-proof stats produces at most one Sentry event per throttle window, and the first one is always sent. (HELD-02)
3. PROOF-01: each gate above goes RED on a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 248: SQLGATES2 — SQL gate censuses fail when an axis drifts, and apply-test tells a seeded ledger row from an applied migration

**Goal:** Census and gate pins fail when an axis drifts, and `apply-test` tells a seeded ledger row from an applied migration:
- The anon strategies-projection census derives every axis from its source of truth, the route list from `PUBLIC_ROUTES`.
- Every hidden-column exemption in the anon grants gate is asserted to be denied to anon.
- The trade-fetch provenance gate gets its `RED-UNDER` twins, a CHECK-definition check, a rollback backup, and read and write denial arms.
- `apply-test` tells a seeded ledger row apart from an applied migration without loosening its refusal.
- The contradictory comments in applied migration `20260907130000` are corrected forward, never in place. This comes after the CLI plan reading and after the `apply-test` fix.
**Requirements**: SQLG-01, SQLG-02, SQLG-03, SQLG-04, SQLG-05
**Depends on:** nothing hard. The internal order is SQLG-04 before SQLG-05.
**Success Criteria** (what must be TRUE):
1. Adding a public route without the anon strategies-projection census fails CI by name, because every axis is derived from its source of truth. Every hidden-column exemption in the anon grants gate is asserted denied to anon. (SQLG-01, SQLG-02)
2. The trade-fetch provenance gate carries `RED-UNDER` twins, a CHECK-definition check, a rollback backup, and read and write denial arms. (SQLG-03)
3. `apply-test` tells a seeded ledger row apart from an applied migration, proven on both states, without loosening its refusal. Its documented remedy never sends a migration to PROD without crossing TEST. (SQLG-04)
4. The contradictory VAC-04 acknowledgement blocks and the inverted check-6 note in `20260907130000` are corrected forward, and the applied file is unchanged. (SQLG-05)
5. PROOF-01: each gate above goes RED on a neutered copy, or on a fake member added to its source of truth, with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. The mutation floors and gate-family registries move in the same PR. The forward correction passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 249: TESTLANES — every live-DB lane test executes, a fence timeout fails, lint agrees cold and warm, and the PROD image crash risk is measured

**Goal:** Every test lane runs what it claims:
- **Live-DB ledger.** The live-DB execution ledger reads `ENTRY_COUNT = 0` with no assertion weakened. The wizard RPC role-gate failure (42501) is resolved by a migration or by an invariant, a founder ruling at plan time.
- **Fence timeouts.** A sustained read timeout on a fence RPC fails the test and never skips it green, and `rpc` is not put back on the retried side.
- **Lint cache.** The lint gate reports the same warnings with a cold cache and a warm one.
- **PROD image.** Whether PROD's Postgres image crashes a backend on a function EXECUTE denial after `SET ROLE` is measured locally on that image version, never against PROD. The verdict is recorded, and if the image crashes, the exposure is fixed.
**Requirements**: LANE-01, LANE-02, LANE-03, LANE-04
**Depends on:** nothing hard. The lane pin stays at `17.6.1.113` or above.
**Success Criteria** (what must be TRUE):
1. The live-DB execution ledger reads `ENTRY_COUNT = 0` with no assertion weakened, and the wizard RPC role-gate failure is resolved per the founder's ruling. (LANE-01)
2. A sustained read timeout on a fence RPC fails the test, never skips it green, and `rpc` stays off the retried side. (LANE-02)
3. The lint gate reports the same warnings with a cold cache and a warm one. (LANE-03)
4. The function-denial crash is measured on PROD's image version in a local container, never against PROD. The verdict is recorded, and a crash is followed by a fix of the exposure. (LANE-04)
5. PROOF-01: each gate above goes RED on a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. No ledger line is added, and no `skipIf` either. A migration, if the founder picks one, passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Progress (HARDEN)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 221. SENTRYSCRUB2 | 0/? | Planned for v1.23 | - |
| 224. DEADLEFTOVERS | 0/? | Planned for v1.23 | - |
| 242. SECRETSHYGIENE | 0/? | Planned for v1.23 | - |
| 243. DBBACKSTOP | 0/? | Planned for v1.23 | - |
| 244. ACCESSGUARDS | 0/? | Planned for v1.23 | - |
| 245. ALERTPAGE | 0/? | Planned for v1.23 | - |
| 246. ALERTREADERS | 0/? | Planned for v1.23 | - |
| 247. SENTRYHELD | 0/? | Planned for v1.23 | - |
| 248. SQLGATES2 | 0/? | Planned for v1.23 | - |
| 249. TESTLANES | 0/? | Planned for v1.23 | - |

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
