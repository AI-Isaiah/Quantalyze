# Roadmap: Quantalyze

## Milestones

- ✅ **v1.21 UX — trustworthy, navigable, lean** — Phases 192–206 (shipped 2026-11-13)
- ✅ **v1.20 Backlog Burndown** — Phases 158–191 (shipped 2026-11-06)
- ✅ **v1.19 JOB/RATE** — Phases 143–146, 146.1, 146.2 (shipped 2026-08-20)
- ✅ **v1.18 MT5-VERIFY & founder confirmations** — Phases 155, 155.1, 207–220 (shipped 2026-11-23; 155.2's remaining work, 157 and 221–225 moved to v1.22 2026-11-23, then 221 and 224 to v1.23 by F-10, and 155.2 and 157 to v1.23 2026-11-25)
- 🚧 **v1.22 TRUTH — data you can trust** — Phases 222, 223, 225, 226–241 (started 2026-11-23)
- 📋 **v1.23 HARDEN — security, alerting, tooling** — Phases 155.2, 157, 221, 224, 242–249, 254, 255, 256, 257, 260 (planned; starts after v1.22, founder 2026-11-23; 155.2 and 157 moved in from v1.22 2026-11-25)
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

🚧 **v1.22 TRUTH — data you can trust — STARTED 2026-11-23, roadmapped.** 22 phases: the carried 222, 223 and 225, the new 226–241, and 250–252 booked later; 10 of them are complete (see the Progress table). ⛔ **CORRECTED 2026-11-25 (founder ruling in chat): 155.2 and 157 moved to v1.23 HARDEN.** Founder (2026-11-25): "We will Move 157 and 155.2 into the next milestone". Until then this paragraph read "no new phase started", counted 21 phases with 155.2 and 157 in, and named 226 MT5SOAK (since shipped) as the first phase to plan. The order, the seam owners, the 155.2 freeze window (which still binds v1.22's number-moving phases until 155.2 plan 12's recapture actually runs) and the milestone-wide rules are in the v1.22 section below.

📋 **v1.23 HARDEN — security, alerting, tooling** is planned and starts after v1.22 closes (founder ruling 2026-11-23, "Yes, split into two milestones"). It holds the carried 221 and 224, the new 242–249, and 155.2 LIVEPARITY and 157 FOUNDER-CONFIRM, moved here from v1.22 on 2026-11-25 (founder: "We will Move 157 and 155.2 into the next milestone"). 254 OPENINGDEPOSIT was booked into it on 2026-11-26 (founder: "Exempt it, book for v1.23"), and 255 NULLANCHOR the same day (founder: "Keep it on, fix records"). 256 OKXUNITSWITCH was booked into it on 2026-11-27 (founder: "USD before 11-15, BTC after"), and 257 SEEDHOLD the same day (founder: "Fix both in a follow-up (Recommended)"). 260 CIHEADROOM, a CI-only phase, was booked into it the same day from Phase 243's measurement that `ci.yml` had reached GitHub's workflow file size limit. Its section follows v1.22's.

⛔ **Do not advertise MT5 until Phase 155.2 passes.** Carried from v1.17 and v1.18 and unchanged by the close. No surface, copy or badge advertises MT5 or calls it verified before 155.2 passes (`milestones/v1.18-REQUIREMENTS.md` Out of Scope).

⚠️ **Public repo:** account labels only (MM2, MM3, FX-AI_V). No login, server name, amount, account number or PROD id in tracked text. Raw captures stay in the untracked capture directory.

⭐ **v1.18 MT5-VERIFY & founder confirmations — CLOSED 2026-11-23** (audit `passed`, 5/5 requirements, 16/16 phases), **v1.21 UX — CLOSED 2026-11-13** and **v1.20 Backlog Burndown — CLOSED 2026-11-06.** Their position notes are in [`milestones/v1.18-ROADMAP.md`](milestones/v1.18-ROADMAP.md) as lineage.

## 🚧 Current Milestone: v1.22 TRUTH — data you can trust

**Goal:** Every number, label and alert we show is correct, or it fails loudly. Started 2026-11-23. Requirements: [`REQUIREMENTS.md`](REQUIREMENTS.md), 71 for v1.22 and 45 planned for v1.23 (116 in all; 155.2's and 157's 10 moved to v1.23 on 2026-11-25), bound by founder decisions F-1..F-10 and the D-A..D-E carry. Research: [`research/v1.22/`](research/v1.22/SUMMARY.md). The top-level `research/SUMMARY.md` is v1.18's and stale.

**Founder ruling 2026-11-23, "Yes, split into two milestones" (F-10).** v1.22 keeps the data-integrity and user-facing tiers. v1.23 HARDEN takes security, alerting and tooling, in the section after this one. ⭐ **One exception:** SECR-01 and SECR-02 stay in v1.22 as Phase 241 DEMOCREDS: deleting the two demo accounts and removing their committed passwords (`158-OPS-03`). They stay because `158-OPS-03` is the only HIGH item in scope. SECR-03/04 go to v1.23. The carried 221 SENTRYSCRUB2 and 224 DEADLEFTOVERS moved to v1.23 with their tiers. 155.2 and 157 came from v1.18 by founder rulings on 2026-11-23 ("Move to next milestone: Your broker statements for 155.2, then its Gate B run and final verification."; "delay 157 into next milestone. Cannot do that now"), and 221–225 were moved the same day ("Move them too (Recommended)").

⭐ **155.2 and 157 moved to v1.23 HARDEN, 2026-11-25 (founder ruling in chat; recorded here, in v1.23's section, in `155.2-CONTEXT.md` and `157-CONTEXT.md`, and in `REQUIREMENTS.md`, per the deviation policy).** Founder (2026-11-25): "We will Move 157 and 155.2 into the next milestone". Their phase sections and Progress rows moved to v1.23's section, unchanged apart from a dated note, and their requirements (MT5-07..10, MT5-15 and MT5-GOAL-01 on 155.2; FCONF-01..04 on 157) are mapped to v1.23. v1.22 now holds 22 phases. Two rules do not move with them: the 155.2 freeze window below still binds v1.22's number-moving phases until 155.2 plan 12's recapture actually runs, and MT5 stays unadvertised until 155.2 passes.

**Order** (founder F-1: data integrity, then user-facing, then security). Within a tier, the order follows the research's seams and waves (`research/v1.22/ARCHITECTURE.md` § Suggested build order). Real dependencies are in each phase's Depends-on line. The rest is priority, and phases without a shared seam may run in parallel.

1. **Wave 0, now and in parallel:** 226 MT5SOAK, the independent MT5 oracle, which lands before any `nav_twr.py` edit. Beside it runs the read-only Deribit diagnosis, a `/gsd-debug` session and not a phase: it owns no requirement and writes nothing. Its verdict is what 233 DERIBITTRUTH plans FRESH-01 from.
2. **Data integrity:** 227 JOBLEDGER (S3) → 225 ONEACCOUNTONCE (S4) → 228 KEYANSWERS (its sibling, right after it) → 229 MT5DERIVE2 → 230 MT5NIGHTLY (once 227's records hold real nights) → the venue reads 231 BYBITREADS ‖ 232 OKXTRADES ‖ 223 FLOWKINDS → 233 DERIBITTRUTH (after 229) → 234 NOCAPITAL ‖ 235 HOLDINGSTRUTH (after 225) → 236 FIGUREMATH.
3. **User-facing:** 237 FACTSHEETHONEST → 238 NEVERCOMPUTED ‖ 239 SURFACECACHE ‖ 240 CONNECTTRUTH ‖ 222 ALERTTRUTH.
4. **Security, by exception:** 241 DEMOCREDS. It shares no seam with any phase, so the founder may pull it forward without a conflict.
5. **Outside the order:** 155.2, which runs statements → plan 11 → plan 12's recapture → plans 13 and 14, under the freeze window below. 157 runs in the same founder sitting, and its password rotation comes after 155.2's last live read. ⭐ 2026-11-25: both moved to v1.23 HARDEN (founder: "We will Move 157 and 155.2 into the next milestone"); this item is kept as lineage, and v1.23's Order carries it now.

**Seam owners.** Each seam has one owning phase. Another phase on the same seam works strictly after the owner and re-bases on its merged bodies, never in parallel. The unit of contention is a (file, top-level symbol) pair, so every plan lists its write scope by symbol. `run_derive_broker_dailies_job` is not refactored in this milestone.

| Seam | Owner | Also touched, strictly after the owner |
|---|---|---|
| S1 Derive writer: `run_derive_broker_dailies_job` and its key-mode exits, `_native_key_usd_writer_basis`, `nav_twr.py` | 229 MT5DERIVE2 | 230 (if its fix lands here), 233 (the key-mode exits), v1.23's 155.2 (its fixes; moved 2026-11-25) |
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
  - ⭐ **2026-11-25: 155.2 is now in v1.23 HARDEN** (founder ruling in chat: "We will Move 157 and 155.2 into the next milestone"). The rule is unchanged, and it still binds the v1.22 phases above until 155.2 plan 12's recapture actually runs. The move neither opens nor closes the window. The plan counts above are 155.2's as of the move.
- **TODOS closure.** Each phase deletes the `TODOS.md` entries its requirements close (the `(covers: …)` ids in `REQUIREMENTS.md`) in its ship PR, and names them in the CHANGELOG entry (CLAUDE.md, rule b).
- **Founder rulings at plan time** are taken in discuss-phase. Each requirement that needs one says so, and is written so that it can be met either way.
- ⛔ **MT5 stays unadvertised until 155.2 passes.** The repo is public: account labels only.

### Phases (this milestone)

- [x] **Phase 222: ALERTTRUTH — Python and SQL error copy and portfolio benchmark labels name the real cause and a channel that exists** - User-facing error copy and the benchmark outage label, with a migration; independent of the MT5 parity phases (completed 2026-11-25)
- [x] **Phase 223: FLOWKINDS — each funding caller treats a malformed row by a recorded, tested decision, and the malformed count is on record first** - Flow-source half only (F-2, no composites): the funding callers' malformed-row decisions and the PROD malformed count; FLOWK-01 dropped (completed 2026-11-24)
- [x] **Phase 225: ONEACCOUNTONCE — a user cannot connect the same exchange account more than once, and one account shared across users stays allowed** - Per-owner duplicate account refusal; shared keys across users stay allowed; founder decision 2026-11-23; also the seam S4 owner: server-qualified MT5 identity, the draft-clash answer, the failing-holder rule (completed 2026-11-27)
- [x] **Phase 226: MT5SOAK — the MT5 soak checks what it claims, independently of the code it checks** - Wave 0: BTC-unit floors, NaN and implausible timed days, an independent per-day attribution walk; lands before any nav_twr.py edit (completed 2026-11-24)
- [x] **Phase 227: JOBLEDGER — a failed job attempt keeps its cause, and no strategy is stranded by a dropped, reset or reclaimed job** - Seam S3 owner: per-attempt failure record, first-hop drop, batch-mate reset, readmit ceiling signal, reclaim provenance, private strategies polled; migrations (completed 2026-11-24)
- [ ] **Phase 228: KEYANSWERS — a reconnect with a changed password and an orphaned key each get an answer that names the key** - Sibling of 225 on seam S4, right after it: the rotated MT5 password reconnect and the KEY_ORPHANED copy for allocators
- [x] **Phase 229: MT5DERIVE2 — an MT5 key's return chain keeps every day it should, and a key with no writer basis never composes silently** - nav_twr.py empty-cohort refund, day-0 P&L and the D-15 band, basis-silent keys, writer-basis values; moves MT5 numbers (155.2 freeze) (completed 2026-11-25)
- [ ] **Phase 230: MT5NIGHTLY — every MT5 nightly derive ends done on its first attempt, for a named reason** - Data-gated on the JOBLEDGER records: the second-attempt cause fixed at its root, seven clean nights, the clock-switch replay
- [x] **Phase 231: BYBITREADS — a Bybit read covers every coin, settle type, window and deposit exactly once, or refuses by name** - Census first; all-coin anchor, USDC and inverse positions, full trade window, on-chain deposit verdict; the static egress IP is a founder action (completed 2026-11-25)
- [x] **Phase 232: OKXTRADES — an OKX read converts or refuses a non-USDT bill, completes a long window and never runs ahead of stored trades** - Mixed-currency daily bills, page-cap truncation, the trade cursor (completed 2026-11-24)
- [x] **Phase 233: DERIBITTRUTH — a Deribit key's returns reach its newest flow, every book day is explained or withheld, and stale series page on every venue** - From the wave-0 diagnosis: stale-returns root fix, per-venue freshness check, correction classifier, book cumulative (completed 2026-11-26)
- [x] **Phase 234: NOCAPITAL — a no-capital key takes one named path, and a transient read never drops a funded key** - Seam S2 owner: transient-zero MT5 keys, any exception reverts, counted fallback flag, no residue reason (completed 2026-11-25)
- [x] **Phase 235: HOLDINGSTRUTH — one account counts once on Holdings, match scoring and the dashboard, and every failing key is named** - Reads the identity value 225 settles: identity misses fail loud, per-account unpriced marker, dashboard marker read, shared-account keys named (completed 2026-11-26)
- [x] **Phase 236: FIGUREMATH — every engine annualizes one way, CVaR is historical, and moved figures are re-derived and announced** - F-5 "365, ddof 1 everywhere", F-6 historical CVaR, quantstats 0.0.86, one CAGR span rule, fleet re-derive; moves published figures (completed 2026-11-27)
- [x] **Phase 237: FACTSHEETHONEST — every surface shows a strategy's true state, and no cache re-serves a stale or failed one** - Owner of the OG route and payload builder: withheld residue, re-run holding on every surface, OG not-found cache, BTC price failure cache, owner data source (completed 2026-11-25)
- [x] **Phase 238: NEVERCOMPUTED — a strategy that never computed, failed or stalled never claims a compute time or tells its owner to wait** - computed_at on never-computed rows (founder ruling) and the /strategies note wording (completed 2026-11-26)
- [x] **Phase 239: SURFACECACHE — the composer range and the Discovery ranking reflect the current truth** - Composer range stored as dates; BTC-unit and USD returns ranked together as pure performance (founder ruling 2026-11-24) (completed 2026-11-24)
- [x] **Phase 240: CONNECTTRUTH — validating a key or a CSV gets a true answer, and anonymous limits are fair** - One error code on every venue, CSV month-name cells, anonymous bucket fairness, edge and upstream CSV limits agree (completed 2026-11-25)
- [x] **Phase 241: DEMOCREDS — the two demo accounts are gone, and their passwords are out of the tree behind a guard that still bites** - The only HIGH item (158-OPS-03), kept in v1.22 by founder exception: accounts deleted on TEST and PROD, digest absence guard (completed 2026-11-26)
- [x] **Phase 250: BINANCEFILLS — a Binance fills read walks every window and never stalls its cursor** - Routed from 232 review (R2-01, R2-02, the BINANCE_PAGE_CAP stop); lands before `USE_RAW_TRADE_INGESTION` is turned on for Binance (completed 2026-11-26)
- [x] **Phase 251: SYNCSTORE — run_sync_trades_job stores every run's daily P&L and refusal flags truthfully** - The four 232 OKXTRADES leftovers in `run_sync_trades_job`; after 222 (completed 2026-11-26)
- [ ] **Phase 252: DERIBITOPTIONS — a Deribit options strategy's published figures are mark-to-market or withheld, never a cash-wallet artefact** - From the diagnosed `deribit-implausible-returns` debug session (mechanism B, cash-basis options): Quantum Drift's owner factsheet shows +1636172.7% cumulative, unwithheld; re-measures DEF-142.2-07
- [x] **Phase 253: BINANCECURSOR — a stopped Binance fills read below a cursor that runs ahead of the stored fills is re-read, and its signal lasts** - Routed from 250 review rounds 1-3 (`[250-BINANCE-STOP-BELOW-CURSOR]`, MEDIUM, data-integrity) by founder ruling 2026-11-26; an RPC change, so a migration; the Binance `USE_RAW_TRADE_INGESTION` switch stays off until it closes (completed 2026-11-26)

### Phase 222: ALERTTRUTH — Python and SQL error copy and portfolio benchmark labels name the real cause and a channel that exists

**Goal:** Every Python and SQL error sentence a user can read names the real cause and offers only a channel that exists (the contact form, never "contact support"), and a portfolio whose benchmark sources all failed says the benchmark is unavailable, not "stale". The `computation_error_copy` arms (`supabase/schema/functions/computation_error_copy.sql`) move by migration, so migration-reviewer and rls-policy-auditor apply before merge. `run_sync_trades_job` no longer returns DONE after recording an analytics failure that the bridge then erases to `complete`. Trigger: founder decisions 2026-11-23, "Book phases: SENTRYSCRUB2, ALERTTRUTH, FLOWKINDS (composite half), DEADLEFTOVERS". Owns `TODOS.md` `[212-CONTACT-SUPPORT-SURVIVORS]`, `[166.4.1-BENCHMARK-OUTAGE-LABEL]` and `[SYNCTRADES-ENQUEUE-DONE]` (readings, cautions and fix directions as written there, including that the 161.1 F1 remedy does not transfer to the sync-trades handler as-is).
**Requirements**: ERRC-01, ERRC-02, ERRC-03
**Depends on:** none (independent of the MT5 parity phases). It shares files, not symbols, with three v1.22 phases, so each plan lists its write scope by symbol: `run_sync_trades_job` with 232 OKXTRADES (VREAD-08), `csv_validator.py` with 240 CONNECTTRUTH (CONN-06), and `routers/portfolio.py` with 236 FIGUREMATH (FIG-01/02). By tier order 232 and 236 merge first, and this phase re-bases on them. Its `computation_error_copy` migration runs in the one serial migration lane. ⛔ **CORRECTED 2026-11-26 (coordinator decision, recorded in 222-CONTEXT.md):** 222's CONTEXT said its migration queues behind 225's PR-3, but 222 merged first (#1352, migration `20261125212222`, applied to TEST and PROD). PR-3 did not exist yet, and the lane order only decides which PR re-stamps; it is not a correctness dependency. 225 PR-3 re-stamps after 222.
**Success Criteria** (what must be TRUE):
1. No string in `analytics-service` or in the `computation_error_copy` arms says "contact support"; each names the contact form or a remedy that works, and csv-finalize's `ENQUEUE_LOST_RACE_USER_COPY` is back in byte parity with the SQL ELSE arm, with the parity test reading the SQL arm instead of a hand-typed oracle.
2. A total benchmark source failure (no price source and no recent cached day) writes a note distinct from the stale-cache note, and the page shows it with its own wording; a test drives both cases and tells them apart. ⛔ NARROWED 2026-11-25 (founder ruling OQ1, recorded in 222-CONTEXT.md): no page renders the note, so this is met by the stored value with `stale=false`, the amber-only-when-stale rule, and an adapter-level test that pins both; no card rebuild.
3. When the follow-on analytics enqueue fails in `run_sync_trades_job`, the strategy's row does not read `complete` with no analytics; a test drives the failed enqueue through the bridge and asserts the stored status and error, shown RED before the fix. ⛔ NARROWED 2026-11-25 (founder rulings ERRC-03 option a, OQ2, OQ4, recorded in 222-CONTEXT.md): FAILED with error_kind `transient` only when nothing is published; a strategy at `complete`, `complete_with_warnings`, or `computing` with `metrics_json` counts as published, keeps its publish state, and gets no failed write.
4. The migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, and every census it moves (schema snapshot, mutation floors, pins) moves in the same PR.
5. The three TODOS entries above are deleted in the ship PR and named in its CHANGELOG entry.
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. The parity test reads the SQL arm, never a hand-typed oracle.
**Plans:** 4/4 plans complete

Plans:
**Wave 1**
- [x] 222-01-PLAN.md — migration: `computation_error_copy` arms name the contact form; csv-finalize parity read from the SQL; both pinning SQL gates moved
- [x] 222-02-PLAN.md — the five analytics-service sentences name the contact form; ast scan and per-function pins; wizardErrors quote

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 222-03-PLAN.md — a total benchmark source failure reads "no price source", not "stale"; the stale-gated tone rule beside the adapter
- [x] 222-04-PLAN.md — a failed follow-on enqueue fails a never-published strategy and leaves a published one alone, proven through the real bridge

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
**Depends on:** nothing hard. It shares no seam with 227 and follows it in the data-integrity order. 155.2 freeze: resolving the MM3-publishes-MM2 duplicate (ONCE-03) moves MT5 numbers, so this phase merges before 155.2 plan 12's recapture or after plan 14, never in between. Research schedules it before plan 12. Research first: the read-only PROD same-owner duplicate count, and the CONN-03 backfill design. ⭐ 2026-11-25: 155.2 moved to v1.23 HARDEN; this freeze rule still holds until 155.2 plan 12's recapture actually runs (see the milestone-wide rule).
**Deviation (founder override, 2026-11-23):** the standing rule "keep data; disconnect, never delete" and the never-deletes half of 167.1.2 D-01 are overridden for SAME-OWNER duplicate keys only. Founder, verbatim: "Delete all duplicate keys. So same key in one accused twice. Delete also all associated factsheet, data etc. One key can be used over several accounts. Imagine one team sharing the key if their master account with several allocator. Of course each allocator should be able to generate a factsheet". Same-owner duplicate keys and their strategies, factsheets and derived data are deleted once, from a read-only PROD manifest the founder confirms first; cross-user sharing stays and each user keeps their own factsheet. Recorded in `225-CONTEXT.md` too.
**Success Criteria** (what must be TRUE):
1. Connecting a key or saving a draft whose account identity matches a key the same owner already holds is refused with a named reason, in the wizard and in the API; a test drives it for an exchange key and for an MT5 login. A connect that matches the user's own draft answers with what was stored, never a silent `200 deduped`. (ONCE-01, CONN-01)
2. The same account connected by two different users stays allowed and keeps its share link; a test pins that the refusal is per owner, and a strategy-linked key in an allocator book is unaffected. (ONCE-02)
3. Every same-owner duplicate already stored on PROD is counted read-only and brought to the founder, and no strategy publishes another key's numbers under its own name once the phase ships. (ONCE-03)
4. Two keys that share a login always carry a share link, so a shared login with no link cannot recur; a test drives the stamping in `account_identity.py` for that case. MT5 account identity includes the broker server, so the same login on two servers never collides, and the backfill uses no data-reading `DO` guard. (ONCE-04, CONN-03)
5. An MT5 key whose sign-in keeps failing cannot claim an account's holder slot. A test drives a failing key beside a working one for the same account, and the working key holds the slot. (MT5D-08)
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Any migration (the CONN-03 identity change and backfill, any per-owner refusal constraint) passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 21/21 plans complete

Plans:
**Wave 1**
- [x] 225-01-PLAN.md — migration A1: `api_keys.venue_server` column and the 13-parameter `create_wizard_strategy` (PR-1)
- [x] 225-02-PLAN.md — the same-owner duplicate census and the one-time delete, run by the orchestrator on PROD (PR-1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 225-03-PLAN.md — move every SQL gate pin to the 13-parameter signature (PR-1)
- [x] 225-04-PLAN.md — migration A2: `swap_account_slot`, the one place a holder slot moves; the orchestrator ships PR-1 and confirms both migrations on PROD before wave 3 (PR-1)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 225-05-PLAN.md — an own-draft match is refused by name, `VENUE_DRAFT_IN_PROGRESS` (PR-2)
- [x] 225-06-PLAN.md — the shared server rule, holder pick and swap helper, TS and Python held equal by one fixture (PR-2)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 225-07-PLAN.md — the wizard connect, MT5 path: server-aware resolver, server write, failing-holder swap (PR-2)
- [x] 225-08-PLAN.md — the Exchanges-page connect gets the same rule, and the demoted key's card names its holder (PR-2)
- [x] 225-09-PLAN.md — the poll stamper: a working key takes a failing holder's slot through the swap (PR-2)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 225-11-PLAN.md — the wizard connect, every venue: post-validation refusal, interim race arm, per-owner pins (PR-2)
- [x] 225-12-PLAN.md — the poll stamper: MT5 server capture and backfill, cross-owner stamping, the backfill census (PR-2)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 225-10-PLAN.md — migration B: the index gains the server member and reconnect agrees, after the backfill census passes (PR-3)

**No MT5 key without a server, founder ruling 2026-11-25:** "Delete keys without Server, dont accept keys without Server". This replaces the CONTEXT Q6 agent decision for keys with no server. It applies to MT5 only: connect refuses an MT5 key with an empty server, and existing MT5 keys without a server are deleted through the product path, with the coordinator confirming the scope first. Recorded in `225-CONTEXT.md` Q6.

**Plan 13 founder ruling, 2026-11-25:** "Owner-only read (Recommended)": SELECT on `api_keys.venue_server` is granted to `authenticated`, owner-only through the existing RLS, like `venue_account_id`. Recorded in `225-CONTEXT.md` Q6.

**Gap closure for CR-01 (founder ruling 2026-11-25, `225-CONTEXT.md` Q6): plans 13-18 and 20 ship as PR-2b-1, PR-2b-2, PR-2c0 and PR-2c from origin/main before PR-3; plan 19 re-bases plan 10. Gap waves below are numbered within the gap set.**
**Plan 20 added 2026-11-25:** plan 18's merge gate step 1 found 0 relogin server verdicts on PROD, and PR-2c review WR-01 found that the three MT5 poll reads prove only the login. Plan 20 (PR-2c0) logs a server verdict at those reads and measures it on PROD before PR-2c merges. Plan 18 now waits on that measurement. Plan 19 waits on the poll-path refusal being shipped, or booked with an owner by plan 20 Task 3.
**Gap wave 1**
- [x] 225-13-PLAN.md — owners can read `venue_server` (column GRANT), after a founder decision checkpoint (PR-2b-1)
- [x] 225-14-PLAN.md — the Python twin: a server-aware `account_identity_tokens`, the derive reads `venue_server`, and the named `account_server_ambiguous` refusal (PR-2b-2)

**Gap wave 2** *(blocked on gap wave 1 completion)*
- [x] 225-15-PLAN.md — the TS twin: a server-aware `accountIdentityTokens` and every reader and key-card state carries `venue_server` (PR-2b-2)
- [x] 225-20-PLAN.md — the MT5 poll reads log whether the session is on the requested broker server, measured on PROD before PR-2c merges, and the poll-path refusal gets an owner (PR-2c0)
- [x] 225-21-PLAN.md — the three MT5 poll reads refuse a terminal session that is not on the requested broker server (review WR-01 of PR-2c), with one post-deploy poll cycle read

**Gap wave 3** *(blocked on gap wave 2 completion)*
- [x] 225-16-PLAN.md — the SQL twin: `commit_scenario_batch` identity edges become server-aware, with a gate arm per rule clause (PR-2b-2)
- [x] 225-18-PLAN.md — the MT5 connect check proves the broker server, not only the login, with founder measurements before and after deploy, after plan 20's measurement (PR-2c)

**Gap wave 4** *(blocked on gap wave 3 completion)*
- [x] 225-17-PLAN.md — re-point the existing fingerprint twins, record the drift row, and a read-only PROD check before PR-2b-2 merges (PR-2b-2)

**Gap wave 5** *(blocked on gap wave 4 completion)*
- [x] 225-19-PLAN.md — re-base plan 10: rename migration B to a current timestamp, re-measure the census, last read-only PROD check (PR-3)

**Poll-path server refusal booked 2026-11-26 (plan 20 Task 3 PASS):** the enforcing server bracket at the three MT5 poll reads (review WR-01 of PR-2c) is owned by gap plan 225-21 (`225-21-PLAN.md`, gap wave 3), which shipped in #1374 (v0.133.95.0); its Task 3 post-deploy poll-cycle read is still open (`225-21-SUMMARY.md`). Record: `225-20-SUMMARY.md`, section `Poll-path server enforcement: owner`.

**PR-3 merged 2026-11-26** (#1368, v0.133.92.0): migration B `20261126140500` applied to TEST and PROD, and the PROD index and `reconnect_allocator_api_key` body read back equal to the migration (`225-19-SUMMARY.md`). Phase 225 stays open: plan 18's post-deploy positive control is a founder item, and plan 225-21 (the poll-path refusal) shipped in #1374 with its Task 3 post-deploy poll read still open.

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
**Founder ruling (2026-11-26, CONN-02):** "Validate and update in place". On the MT5 same-account arms, a reconnect with a new password is validated, and on success the stored key's secret is rotated through the rotate-secret seam and the answer names the key. The founder accepted the trade-off: the up-to-120 s validation returns on those arms, which reverses 212-03 SC5 for MT5, and a connect request now changes an existing key. Recorded in `228-CONTEXT.md`.
**Success Criteria** (what must be TRUE):
1. Reconnecting an MT5 account with a rotated password gets a named answer, and what the answer says matches what `api_keys` holds afterwards. A mistyped password is never reported as success. (CONN-02)
2. An allocator-role owner who hits `KEY_ORPHANED` is told, by name, which key to Disconnect; a test drives the allocator and manager roles. (CONN-04)
3. PROOF-01: each test goes RED on a neutered copy of the route arm it guards, with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 4 plans
**UI hint**: yes

Plans:
**Wave 1**
- [ ] 228-01-PLAN.md — The rotate seam reports `secret_changed` (probe-then-compare, UTF-8 constant-time), and its seam call (`rotateKeySecret`) and owner-scoped persist (`persistRotatedMt5Secret`) are shared, with rotate-secret byte-identical (CONN-02)
- [ ] 228-02-PLAN.md — The connect step renders the password outcome notice from `key_secret`, the F6 fallback strip stops claiming the credentials are connected, and KEY_ORPHANED's Disconnect bullet names the key (CONN-02, CONN-04)
- [ ] 228-04-PLAN.md — The seam-budget census declares the create-with-key `mt5-rotate` branch and pins that it fits the browser deadline (CONN-02)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 228-03-PLAN.md — An MT5 reconnect whose fence picks the caller's own working holder on the exact server is validated and rotated in place and named; failures write nothing; KEY_ORPHANED is the same named answer for every role (CONN-02, CONN-04)

### Phase 229: MT5DERIVE2 — an MT5 key's return chain keeps every day it should, and a key with no writer basis never composes silently

**Goal:** An MT5 key's return chain keeps every day it should, and a timed key with no writer basis never composes silently: the seam-S1 money-math gaps are fixed at their root, which moves published MT5 returns.
- A timed re-funding day with an empty cohort 0 keeps the return chain intact (`nav_twr.py` `_judged_cohorts`).
- An inception day's P&L is booked or flagged by name, never dropped as NaN (`chain_linked_twr`).
- A day-level flow just under the previous day's NAV carries the large-flow annotation, or the D-15 band is recorded as accepted. This is a founder ruling at plan time, and `FLOW_TIMING_LARGE_RATIO` is never widened to make a check pass.
- A timed MT5 key with no writer basis is counted or blocked with a named signal (`_native_key_usd_writer_basis`).
- The writer-basis gate (`read_writer_basis`, in S2) compares per-day values as well as the calendar, and refuses a same-day re-derive pair whose P&L does not match. It is here because the writer and the reader of one contract change together (Pattern 3).
**Requirements**: MT5D-04, MT5D-05, MT5D-06, MT5D-07, HOLD-03
**Depends on:** Phase 226 merged, so the soak judges these edits independently. 155.2 freeze: merges before 155.2 plan 12's recapture or after plan 14, never in between; research schedules it before plan 12, so its fixes are inside the parity verdict. No migration expected. ⭐ 2026-11-25: 155.2 moved to v1.23 HARDEN; this freeze rule still holds until 155.2 plan 12's recapture actually runs (see the milestone-wide rule).
**Success Criteria** (what must be TRUE):
1. A timed re-funding day into an emptied account (empty cohort 0) keeps the return chain intact; a test that is RED on today's code drives it. (MT5D-04)
2. An inception day's P&L is booked, or carries a named flag; no day-0 P&L is dropped as NaN without one. (MT5D-05)
3. A day-level flow just under the previous day's NAV carries the large-flow annotation, or the founder's acceptance of the D-15 band is recorded with its reason. `FLOW_TIMING_LARGE_RATIO` is not widened to make a check pass. (MT5D-06)
4. A timed MT5 key with no writer basis is counted or blocked with a named signal, never composed silently on the legacy roll. The writer-basis gate refuses a same-day re-derive pair whose per-day P&L does not match, as well as a calendar mismatch. (MT5D-07, HOLD-03) ⭐ NOTE 2026-11-24 (planning, recorded in 229-CONTEXT.md): the per-day comparison is a compose-side `returns_stamp` (each derive stores the per-day returns it wrote in its `key_inputs` row; the compose compares it per raw key before the stitch and refuses a differing pair as the blocking `key_inputs_mismatch`). `read_writer_basis` stays byte-unchanged, because editing it fires the open entry `167.1.2.2.1-WRITER-BASIS-EMPTY-READS-LEGACY` and a post-stitch check reads the stitched series. Known limit: a correction confined to a day with no stored return that moves no other return leaves the pair content-consistent and is not refused; a row written before this change carries no stamp and is counted, not refused. ⭐ SCOPE NOTE 2026-11-24 (founder ruling on review MR-01 / SFH-229-01, recorded in 229-CONTEXT.md): "Exempt departed keys". Live keys still block. A departed key whose last `key_inputs` row carries `writer_basis_withheld` or a stale returns stamp stays out of `withheld_by_key` and `stamp_mismatch_days_by_key`; it is counted into a non-blocking benign flag with a counts-only log, in the spirit of D-22, because a departed key never re-derives and the block could never self-heal.
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy of `nav_twr.py` / the writer-basis symbols, with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Money-math oracles import no production helper. The frozen spine is never re-baselined by re-running `regen_golden.py`. 226's soak, run against the changed derive, is recorded beside the merge.
**Plans:** 6/6 plans complete

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
- [x] 229-06-PLAN.md — Phase gate on the merged head, PROOF-01 ledger, and the founder's live soak recorded as verdict lines (closing)

### Phase 230: MT5NIGHTLY — every MT5 nightly derive ends done on its first attempt, for a named reason

**Goal:** Once 227's per-attempt record holds real nightly runs, the named cause of MT5 `derive_broker_dailies` second attempts is fixed at its root. Then, over seven consecutive nights, every MT5 derive ends `done` with `attempts=1`. Raising retries or a watchdog threshold is not a close. The MT5 derive values that moved without explanation are replayed under both server-clock settings, and each moved value is attributed to the clock switch or to another named cause (`202-MT5-CLOCK-LEAD-01`). This phase is data-gated: its fix cannot be planned before the records exist. The suspected cause is a lease heartbeat shared with HEAL-02, a hypothesis and not a finding. It may land in S3 or S1, and wherever it lands it re-bases on that seam owner's merged bodies.
**Requirements**: MT5D-02, MT5D-03
**Depends on:** Phase 227 deployed, with its per-attempt record holding real nightly MT5 runs (the number of nights is set at plan time from the data); 229 must be merged first if the fix lands in S1. 155.2 freeze, conditional: if the fix or the replay's outcome changes stored values for MM2, MM3 or FX-AI_V, it merges before 155.2 plan 12's recapture or after plan 14, never in between. Research first: read the records. ⭐ 2026-11-25: 155.2 moved to v1.23 HARDEN; this freeze rule still holds until 155.2 plan 12's recapture actually runs (see the milestone-wide rule).
- 2026-11-25, research (`230-DISCUSSION-LOG.md`): the named cause is cross-process contention for the one shared MT5 terminal. The backfill worker's nightly derive and the API process's `poll_allocator_positions` log it into different accounts at once, and the MT5CONC-02 login bracket refuses the read. The HEAL-02 hypothesis is refuted.
- 2026-11-25, founder rulings (AskUserQuestion, relayed by the coordinator, verbatim in `230-CONTEXT.md`). D-01: "Database lease (Recommended)", option text: "One lease row per terminal in the database (with an expiry and an owner token), taken by every MT5 terminal user: derive, holdings poll, balance sync, key validation. A caller that finds it busy waits or gets the existing 'terminal busy' answer. The runbook already calls for this. It needs a small migration and changes no stored values." D-02: "I run it (Recommended)": the coordinator runs the read-only ledger capture on the Railway worker outside 00:40 to 01:40 UTC and replays it with `mt5offset_dry_run`, counts only in records. The seven clean nights count from the lease fix's deploy.
- 2026-11-26, review rounds 1-2 (`230-REVIEW.md`, recorded in `230-CONTEXT.md`): the heal and liveness arms now catch lease-unavailable ahead of busy (SF-M1), and a missing renew RPC mid-hold now self-fences at the loss deadline instead of ending the renew loop (SF-M4, superseding plan 04's "renew stops without bumping the epoch").
- 2026-11-26, shipped as v0.133.91.0 (#1358). The migration was re-stamped at ship to `20261126140000_mt5_terminal_lease.sql`, so it sorts after 238's `20261126130000`. `supabase-migrate.yml` run 45807605366 applied it to TEST and PROD, and the baseline re-dump is v0.133.91.1 (#1365). The status stays `human_needed`: plan 09 needs seven clean nights counted from the first 00:40Z derive after both services carry the lease, and plan 10 needs the coordinator's capture and replay. Neither plan has a SUMMARY yet.
**Success Criteria** (what must be TRUE):
1. The cause of MT5 second attempts is named from 227's per-attempt records over real nights before any fix is planned, and the fix lands at that cause.
2. After the fix, seven consecutive nights show every MT5 derive `done` with `attempts=1`, read from stored job rows and recorded with their dates. No retry budget or watchdog threshold was raised. (MT5D-02)
3. Each MT5 derive value that moved without explanation is replayed under both server-clock settings and attributed to the clock switch or to another named cause. The repo's record of the setting alone is not a replay. (MT5D-03)
4. PROOF-01: a test that drives the named cause goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Any migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 8/10 plans executed

Plans:
- [x] 230-01-PLAN.md — the terminal lease table and its three token-fenced RPCs, proven on the pg-lane (MT5D-02)
- [x] 230-02-PLAN.md — mt5_terminal_lease takes the database lease; two processes never share the terminal, PROOF-01 on production code (MT5D-02)
- [x] 230-03-PLAN.md — the dry run's --days-out flag and the clock-replay runbook with the capture contract (MT5D-03)
- [x] 230-04-PLAN.md — a missing lease RPC degrades loudly, every other database error fails closed (MT5D-02)
- [x] 230-05-PLAN.md — the transient classify arm, the holdings sync-error arm and the two validate arms (MT5D-02)
- [x] 230-06-PLAN.md — the SQL, function and gate-file censuses moved to measured values (MT5D-02)
- [x] 230-07-PLAN.md — [BLOCKING] the migration on the local-stack lane, the live PostgREST test, every suite green (MT5D-02)
- [x] 230-08-PLAN.md — re-stamp rehearsal, the lease runbook, the corrected single-replica note, ship records (MT5D-02, MT5D-03)
- [ ] 230-09-PLAN.md — the nightly evidence proven on the lane, then seven nights after both deploys (MT5D-02, human-gated)
- [ ] 230-10-PLAN.md — the capture hand-off proven offline, then the coordinator's replay and the per-scope attribution (MT5D-03, human-gated)

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
  - ⛔ **PARTLY REVERSED 2026-11-27 by Phase 256 OKXUNITSWITCH (founder ruling, AskUserQuestion: "USD before 11-15, BTC after"; recorded here and in `232-CONTEXT.md`, per the deviation policy).** The refusal stays for a coin with no unit switch. For an account that moves from USDT into a coin, the coin's bills are booked in that coin's segment of a two-unit series instead of refusing the whole read. Reason, measured 2026-11-27: the refusal froze one OKX account's 3 strategies and failed 7 nightly derives since 2026-11-24, because the BTC-charged fees of its spot BTC buys tripped it. This line is kept as lineage.

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
**Depends on:** Phase 229 merged, because candidate cause (a), the `<2-day` key-mode exit, is shared with MT5; and the wave-0 Deribit diagnosis, which names which keys write the account's returns and which the compose reads. 155.2 freeze, conditional: if the fix changes a shared key-mode exit so that MM2, MM3 or FX-AI_V numbers move, it merges before 155.2 plan 12's recapture or after plan 14, never in between. FRESH-02's home is decided at plan time; as an arm of `ops_staleness_check()` (S5) it is a migration in the serial lane, and v1.23's 242 and 246 re-base on it. ⭐ 2026-11-25: 155.2 moved to v1.23 HARDEN; this freeze rule still holds until 155.2 plan 12's recapture actually runs (see the milestone-wide rule).
⛔ **DEVIATION 2026-11-24 (founder rulings on the wave-0 diagnosis, recorded in `233-CONTEXT.md`):** the diagnosis (`.planning/debug/deribit-stale-returns.md`) found no writer defect. The account is Phase 188's key C, and its tail is held out by the tiny-base rule (188 D-02, D-03, D-08) after a near-total withdrawal on 2026-10-26. The stored, named reason is `key_inputs.tiny_base_days`, and 2026-11-25 is its first countable day. Q1: FRESH-01 is the diagnosis, plus the 2026-11-26 PROD confirmation reading, plus FRESH-02 accepting stated left-out days. There is no writer change, no backfill, and the 155.2 freeze condition does not apply. Read criterion 1's "the fix lands at it" as "the fix lands at the missing reader". Q2: 233 does not touch S2, and the out-of-window case went to 234. Q3: FRESH-02's home is a fifth prod-prober arm, `freshness`, not S5, so no migration ships here and v1.23's 242 and 246 do not re-base on 233. Q4: DBOOK-01 is an independent per-day attribution oracle. Days it cannot reproduce, or days with no stored base level, are withheld by name. Capital-outside-base days are named but not nulled.
⭐ **2026-11-25 (founder answer to q-dbook01, "Accept (Recommended)", recorded in `233-CONTEXT.md`):** the plan 233-07 PROD re-reading read STOP with 114 structural withheld days. They stay published and are named withheld in the reading; DBOOK-01 closes as a reading, and the ship PR deletes `TODOS.md` `[185-BOOK-CUMULATIVE-UNEXPLAINED]`.
**Success Criteria** (what must be TRUE):
1. The diagnosis names the cause, and the fix lands at it. The account's return series reaches its newest flow and anchor day, or the gap carries a stored, named reason, and no day is backfilled. (FRESH-01)
2. A check outside the derive job reports and pages every daily-derived key, on every venue, whose newest return day trails its newest flow or anchor day by more than the stated bound without a named reason. It goes RED on a lane fixture whose series end is held back, and it never blocks CI. (FRESH-02)
3. Every day of the founder's Deribit book cumulative return is explained by booked P&L and flows, or withheld by name, with no plausibility bound. The close is an attribution reading, not a tolerance. (DBOOK-01)
4. A correction row carrying a capital reason never classifies as trading P&L, including one with a trading token and no capital word; each correction shape has its own fixture. (DBOOK-02)
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Any migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 7/7 plans complete

Plans:
**Wave 1**
- [x] 233-01-PLAN.md — DBOOK-02: a correction is trading only when it names an instrument; one fixture per shape
- [x] 233-02-PLAN.md — FRESH-02 tracer (and FRESH-01's reader): fifth prod-prober arm `freshness` end to end, floor 5
- [x] 233-03-PLAN.md — DBOOK-01 tracer: independent book attribution oracle, withheld classes, key-set check and verdict order

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 233-04-PLAN.md — FRESH-02 expansion: silent-green guards, day-by-day and boundary fixtures, SQL names bound to their writers
- [x] 233-05-PLAN.md — DBOOK-01 expansion: remaining classes and annotations, leak guards and --print-sql, then the orchestrator's PROD reading

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 233-06-PLAN.md — FRESH-01: the 2026-11-26 PROD confirmation reading and the A5 record; diagnosis record resolved
- [x] 233-07-PLAN.md — DBOOK-01 gap closure: an emptied level is zero capital as the compose counts it, a counted key with no stored basis is withheld by name, the loader reads PROD's shapes, then the PROD re-reading

### Phase 234: NOCAPITAL — a no-capital key takes one named path, and a transient read never drops a funded key

**Goal:** A no-capital key takes one named path, and a transient read never drops a funded key, in the compose reader's no-capital machinery (seam S2, owned here):
- An MT5 key whose stored terminal reads zero for one tick is never dropped as no-capital while it is funded.
- Any exception raised by a no-capital candidate, not only `NavReconstructionError`, leaves the previous row intact.
- A fallback to `dropped_key` stores a payload flag naming why, and is counted per run.
- A refused candidate leaves no residue reason (such as `key_inputs_mismatch`) in the stored payload.

Python only, no migration. This is the allocator book path, not composite work.
⭐ **Added 2026-11-24 (founder ruling on 233 DERIBITTRUTH's Q2, "233 does not touch S2"):** `_reconstruct_key_equity` in `allocator_equity_derive.py` counts a flow as `out_of_window_flow` when it is dated on a left-out tail day that the derive stated (`key_inputs.tiny_base_days`) after the key's last stored return. That flow belongs to a stated day, not to a day outside the window. 234 owns the fix as part of S2. Evidence: `.planning/debug/deribit-stale-returns.md`. ~~For the one account seen, the flag clears by itself once a return is stored after the flow (2026-11-26).~~ ⛔ **CORRECTED 2026-11-26 (records PR for 233, from `233-06-SUMMARY.md` and `233-VERIFICATION.md`):** the flag did NOT clear for every book. In the 2026-11-26 PROD reading after the 01:37Z compose, books A and C no longer carry `out_of_window_flow` and are trustworthy. Book B still reads `classified_rotation, out_of_window_flow, window_truncated` with `is_trustworthy=false`. By the Q2 ruling, book B's remaining `out_of_window_flow` goes to Phase 234, and it does not reopen FRESH-01. ⚠️ Phase 234 had already shipped the general fix: plan 234-04 (v0.133.76.0, #1339, complete 2026-11-25) stops counting a flow on a stated `tiny_base_days` day as out of window. Book B still carried the flag at the 2026-11-26 01:37Z compose. Two things are unmeasured: whether that compose ran 234's code, and which of B's flows is counted. So B's case is either outside 234-04's rule or a deploy-timing artefact. Phase 234 is closed, so no plan owns this reading. The coordinator decides how to route it.
**Requirements**: NOCAP-01, NOCAP-02, NOCAP-03, NOCAP-04
**Depends on:** Phase 229 merged (its `read_writer_basis` edit in S2 lands first); it runs in parallel with 235. 155.2 freeze: NOCAP-01 touches an MT5 key, so it merges before 155.2 plan 12's recapture or after plan 14, never in between. ⭐ 2026-11-25: 155.2 moved to v1.23 HARDEN; this freeze rule still holds until 155.2 plan 12's recapture actually runs (see the milestone-wide rule).
**Success Criteria** (what must be TRUE):
1. A funded MT5 key whose stored terminal reads zero for one tick keeps its capital; a test drives the transient zero. (NOCAP-01)
2. Any exception raised by a no-capital candidate leaves the previous row intact across retries; a test raises an exception that is not a `NavReconstructionError`. (NOCAP-02)
3. A fallback to `dropped_key` stores a payload flag naming why and is counted per run, not only logged. A refused candidate leaves no residue reason in the stored payload. (NOCAP-03, NOCAP-04)
4. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 4/4 plans complete

Plans:
**Wave 1**
- [x] 234-01-PLAN.md — Every no-capital fallback is counted by name in the stored payload, and a refused holed candidate leaves no residue reason (NOCAP-03, NOCAP-04)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 234-02-PLAN.md — An MT5 no-capital exit needs the key's own deal ledger to agree; a negative terminal is never an exit (NOCAP-01)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 234-03-PLAN.md — Any exception from a candidate reverts once to the stored inputs and keeps the row across retries (NOCAP-02)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 234-04-PLAN.md — A flow on a stated tiny-base tail day after the last return is not out_of_window_flow (founder ruling 2026-11-24)

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
**Plans:** 6/6 plans complete
**UI hint**: yes

Plans:
- [x] 235-01-PLAN.md — HOLD-01: a key missing from the identity read fails loud (strict `keyAccountOf`, `strictAccountOf`) (wave 1)
- [x] 235-02-PLAN.md — HOLD-02: the matcher applies the native-unpriced marker per account, shared case table replayed in pytest and vitest (wave 1)
- [x] 235-03-PLAN.md — HOLD-04 server: a failed marker read sets `holdingsUnpricedCheckFailed` and fires a throttled Sentry event (wave 2)
- [x] 235-04-PLAN.md — HOLD-04 UI: the unpriced-check note on the Overview and the Holdings tab (wave 3)
- [x] 235-05-PLAN.md — HOLD-05 producer: `sharedAccountFailingGroups` and its payload field (wave 3)
- [x] 235-06-PLAN.md — HOLD-05 message: every failing shared-account key named, undated line, ship obligations (wave 4)

### Phase 236: FIGUREMATH — every engine annualizes one way, CVaR is historical, and moved figures are re-derived and announced

**Goal:** Every engine that annualizes follows F-5, "365, ddof 1 everywhere": the stored Python metrics, the factsheet and Scenario TypeScript engines, portfolio analytics and matching. F-5 sits inside the existing annualization rule: risk by frequency (crypto 365, traditional 252), returns by calendar, and a blend uses 365 if any leg is crypto. The TypeScript engines move to match Python.
- Each language holds the convention in one named constant set, and a cross-language pin enforces it.
- Every engine reports the same CAGR, Sharpe and TWR within a pinned tolerance. The composite half of `L2214` is out (F-2).
- CVaR is historical and null below a minimum observation count held in one named constant (F-6). quantstats moves to 0.0.86 in the same PR as a per-metric decision record.
- CAGR uses one span rule in every engine. Whether emptied stretches count toward the span is a founder ruling at plan time.
- The figures that move are re-derived for the whole fleet. The frozen spine is re-baselined as a reviewed act, and the CHANGELOG names the figures that moved.

This moves published figures on every surface, MT5 included.
**Requirements**: FIG-01, FIG-02, FIG-03, FIG-04, FIG-05
**Depends on:** Phases 229, 233 and 234 merged, so one fleet re-derive covers the stored inputs they change. 155.2 freeze: merges before 155.2 plan 12's recapture or after plan 14, never in between; with F-5 and F-6 ruled either side is open, and the side is recorded. The SCENARIO-05 / BODY-02 regression pins move in the same PR. Research first: the per-metric quantstats decisions. ⭐ 2026-11-25: 155.2 moved to v1.23 HARDEN; this freeze rule still holds until 155.2 plan 12's recapture actually runs (see the milestone-wide rule).
**Success Criteria** (what must be TRUE):
1. A cross-language pin test fails if any engine's year length or ddof changes. Each language holds both in one named constant set, and a census lists every annualizing site. (FIG-01)
2. For the same strategy and period, every engine reports the same CAGR, Sharpe and TWR within a pinned tolerance, proven by a parity test across all engines whose oracle imports no production helper. (FIG-02)
3. CVaR is historical and reads null below the named minimum observation count. quantstats is 0.0.86, with a per-metric decision record in the same PR, and no moved value is re-pinned without a decision. CAGR uses one span rule in every engine, pinned by a test, per the founder's ruling. (FIG-03, FIG-04)
4. The moved figures are re-derived for the whole fleet. The frozen spine is re-baselined as a reviewed act, never by re-running `regen_golden.py` in a constants PR. The CHANGELOG entry names the figures that moved. (FIG-05)
5. PROOF-01: each gate above goes RED on a one-sided constant change or a neutered copy, with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. A loosened tolerance or re-pinned values is not a close.
**Plans:** 11/11 plans complete

Plans:
- [x] 236-01-PLAN.md — One named constant set per language, the cross-language pin and the annualizing-site census; FIGURE_DEFS_VERSION 3 (FIG-01)
- [x] 236-02-PLAN.md — TS calendar clock on whole days / 365 (Scenario, OG card, Python mirror) (FIG-01, FIG-04)
- [x] 236-03-PLAN.md — Python engine: CVaR floor on the total record, smart_* on the frequency clock, stored CAGR span (FIG-01, FIG-03, FIG-04)
- [x] 236-04-PLAN.md — Optimizer on the blend frequency clock and XIRR on 365 (FIG-01)
- [x] 236-05-PLAN.md — Every TS annualized dispersion on ddof 1 (FIG-01)
- [x] 236-06-PLAN.md — quantstats 0.0.86 with the per-metric decision record (FIG-03)
- [x] 236-07-PLAN.md — CVaR floored at every total-record reader, with a reader census (FIG-03)
- [x] 236-08-PLAN.md — Independent-oracle CAGR, Sharpe and TWR parity across every engine (FIG-02)
- [x] 236-09-PLAN.md — Close-out: migration lists empty, re-derive runbook, figures-moved list, TODOS, freeze check, phase-wide gate (FIG-01, FIG-05)
- [x] 236-10-PLAN.md — Factsheet compute() on the span rule and its pins (FIG-01, FIG-04)
- [x] 236-11-PLAN.md — The factsheet states the span its CAGR covers (FIG-04)

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
**Plans:** 13/13 plans complete
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
**Depends on:** nothing hard. If the founder picks the nullable `computed_at`, every reader keyed on it is censused and moved in the same PR. FRESH-02's check is among those readers, so this phase then comes after 233. ⭐ **Founder ruling 2026-11-24 (238-CONTEXT.md):** "A: allow an empty date (Recommended)", so `computed_at` becomes nullable. The phase ships in two PRs. PR-1 (FACT-05 and the public-link note, no migration) ships now. PR-2 (FACT-03: the nullable migration and the reader census) waits for Phase 233 to merge and for a free migration lane. ⛔ **DEVIATION 2026-11-24 (PR-1 review WR-01):** UI-SPEC §1.7 said the owner pending factsheet page needs no viewer mapping. Review showed an allocator-only owner exists (CD-10), and the page could link them to the manager-only edit page or CSV wizard, so PR-1 maps both the share note and the KCS-09 remedy line through `viewerRemedyAction` with the owner's `profiles.role`. Recorded in 238-CONTEXT.md too. ⛔ **DEVIATION 2026-11-24 (founder ruling "Neutral 'unknown' note"):** UI-SPEC §1.1 row 5 kept KCS12-UNREADABLE ("… once a computation succeeds") for an unpublished row whose jobs read failed. It is replaced by `KCS12_MINT_B_UNKNOWN`, "… opens a page without its factsheet. If no computation is running, use the contact form to have it checked.": the KCS12-PUBLIC-UNKNOWN tail, with a lead that is true for both private-link cards (reviewer MEDIUM). Recorded in 238-CONTEXT.md too.
**Success Criteria** (what must be TRUE):
1. A never-computed row shows no compute date on any surface, and no freshness check reads its insert time as a compute time. A census of `computed_at` readers fails on an unclassified new one. (FACT-03)
2. For a failed, stalled or never-started row, the /strategies note names an action and never says to wait. (FACT-05)
3. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. A migration, if the founder picks one, passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 9/9 plans complete
**UI hint**: yes

Plans:
**Wave 1**
- [x] 238-01-PLAN.md — PR-1: an unpublished failed, stalled or never-started /strategies row's note names its remedy action (tracer; leads, `DegradeAction`, per-state key-pill cases) (FACT-05)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 238-02-PLAN.md — PR-1: the published row's note reads the state the page already read, KCS12-PUBLIC-UNKNOWN otherwise; role matrix and parity with the Health detail (FACT-05)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 238-03-PLAN.md — PR-1: the owner pending page note names its remedy line's action; the retired wait sentence leaves the string API; TODOS entry deleted (FACT-05)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 238-04-PLAN.md — PR-2 gate: waits for 233 to merge and a free migration lane; re-measures PROD counts, table owner and the migration version (FACT-03)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 238-05-PLAN.md — PR-2: nullable `computed_at` migration with a trigger-aware backfill, its rollback, and the sql-exec proof (FACT-03)
- [x] 238-06-PLAN.md — PR-2: a NULL date renders the null dash on the factsheet, and the type becomes `string | null` with its typecheck fallout fixed (FACT-03)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 238-07-PLAN.md — PR-2: NULL pins for the badge, admin card, wizard preview, HealthScore and table sort, each proven able to fail (FACT-03)

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 238-08-PLAN.md — PR-2: the `computed_at` reader census across TS, Python and SQL (FACT-03)

**Wave 8** *(blocked on Wave 7 completion)*
- [x] 238-09-PLAN.md — PR-2: lane replay, migration-reviewer and rls-policy-auditor clean, TODOS entry deleted (FACT-03)

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
**Plans:** 4/4 plans complete

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
**Founder ruling 2026-11-25 (UTC), quiet-prefix deadline case:** "Ship the window-walking fix now and record this as a named, loud, bounded limit. The switch that turns on raw trade import for Binance must name it as an exception. Also give the sync about 14 of its 15 minutes for reading, which makes the stall about 3.5x rarer." (AskUserQuestion, "Record as known limit (Recommended)"; recorded in `250-CONTEXT.md`.)
**Success Criteria** (what must be TRUE):
1. A Binance linear key whose cursor is followed by more than 7 days with no fills keeps reading forward window by window and reaches fills newer than those days; its cursor never stays at C on a quiet stretch and never advances past stored data, with one named exception: a read stopped by its deadline over a prefix holding no stored fill leaves the cursor at C, loudly (`binance_deadline_symbols`) and bounded by the reach clamp (founder ruling 2026-11-25, quiet-prefix known limit). A test that is RED on today's code feeds the quiet stretch. (R2-02)
2. A symbol that fails on every run is named on every run, the healthy symbols' fills past C+7d are still read and stored, and a transiently failed symbol's span is re-read on the next clean run, never skipped silently. (R2-01)
3. A symbol that hits `BINANCE_PAGE_CAP` records a named flag, the cursor never stamps past that symbol's unread fills, and a later run resumes past the cap instead of re-reading the same oldest pages. (`BINANCE_PAGE_CAP` stop)
4. `USE_RAW_TRADE_INGESTION` is not turned on for Binance before criteria 1 to 3 are met on `main`; the phase records this as an explicit precondition of that switch.
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 8/8 plans complete

Plans:
**Wave 1**
- [x] 250-01-PLAN.md — The phase's test instrument, and R2-02 reproduced through it: a venue-faithful Binance fake on a REAL ccxt instance, a driver that runs the
- [x] 250-02-PLAN.md — SC-3 and SC-2, consumer half, plus SC-4: the fills-cursor gate of `run_sync_trades_job` never stamps past a stopped symbol's unread fills, n

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 250-03-PLAN.md — SC-1 (R2-02, the silent stall): a Binance raw fills read walks every window from its start to now, proven end to end by promoting 250-01's s

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 250-04-PLAN.md — SC-1, the rest of the walk's contract: every arm of the research table that belongs to the walk is pinned, can fail, and is seen failing. 25

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 250-05-PLAN.md — SC-2, producer half, end to end (R2-01, the loud stall): a venue-unlisted Binance symbol is named on every run without holding the healthy s

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 250-06-PLAN.md — SC-3, producer half, end to end (the `BINANCE_PAGE_CAP` stop): a capped symbol is named with one read-through bound the gate stamps at, the

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 250-07-PLAN.md — The [Budget] decision together with the founder ruling of 2026-11-25 (UTC), and the ordering measurement the orchestrator asked for. The pha

**Wave 7** *(blocked on Wave 6 completion)*
- [x] 250-08-PLAN.md — The phase's closing gates, split out of 250-07 at plan revision 2026-11-25 (checker iteration 2: 250-07 sat at its whole context budget). Ru

### Phase 251: SYNCSTORE — run_sync_trades_job stores every run's daily P&L and refusal flags truthfully

**Goal:** Every run of `run_sync_trades_job` keeps the daily P&L it read and records its refusal flags truthfully. Booked by founder ruling 2026-11-25 from the four items Phase 232 OKXTRADES routed by name to 222 (`232-01-SUMMARY.md`, handoff-222), which fall outside 222's goal:
1. the Phase-1 daily P&L store runs after the Phase-2 walk, so a first sync whose walk hits the 900 s handler timeout loses that run's Phase-1 daily P&L;
2. the Phase-1 store proceeds under refusal flags;
3. the public `daily_pnl_*` flags are never cleared by any run;
4. with `USE_RAW_TRADE_INGESTION` off and Phase 1 fine, `needs_flag_write` is False, so a drained `daily_pnl_*` refusal flag (232-03's `daily_pnl_non_usd_okx` among them) never reaches `data_quality_flags` while `last_sync_at` still advances.
⭐ **2026-11-26 (records PR for 222):** this phase also owns `TODOS.md` `[222-SYNCTRADES-REREAD-FAILED]` (Phase 222 review SFH-R3-01, MEDIUM, data-integrity): a failed re-read after a zero-row write in `run_sync_trades_job`'s enqueue-failure tail returns FAILED, so on the last attempt the bridge can write `failed` over a published row, and the log line says "wizard may still hang". The outcome to pin and its gate are as written in the entry.
**Requirements**: TBD
**Depends on:** Phase 222 (it reorders `run_sync_trades_job`, which 222 edits)
**Success Criteria** (what must be TRUE):
1. Item 1: the Phase-1 daily P&L is stored through `sync_trades` before the Phase-2 fills walk starts, so a run whose walk raises or is cancelled (the `asyncio.wait_for` handler timeout cancels it) has already stored that run's daily P&L. A test that cancels the Phase-2 fetch goes RED on today's code.
2. Item 2: a Phase-1 read whose drained flags carry a refusal reason, as named by the shared reader `daily_pnl_read_verdict`, stores nothing through `sync_trades`, holds `last_sync_at`, never stamps `phase1_daily_pnl_persist_failed`, and reports `trade_count` 0. A rate-limited read reaches the handler's 429 arm. A fixture with the Binance income fallback's spot fills goes RED on today's code.
3. Item 3: a run whose Phase-1 read is clean removes the refusal keys an earlier run wrote (the reader's reason keys and their companions `daily_pnl_fetch_error_class` and `daily_pnl_unsupported_venue`) from `strategy_analytics.data_quality_flags`. The derive-owned `daily_pnl_malformed_*` keys are left alone.
4. Item 4: with `USE_RAW_TRADE_INGESTION` off and Phase 1 fine, a drained refusal flag reaches `strategy_analytics.data_quality_flags` at the sync's own write, and `last_sync_at` does not advance under it.
5. `[222-SYNCTRADES-REREAD-FAILED]`: the outcome of a re-read that raises after a zero-row write is decided in the discuss step, pinned by a live-lane test in `test_sync_trades_enqueue_failure_bridge_live.py`, and its log line says what happened. The TODOS entry is deleted in the ship PR and named in the CHANGELOG.
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 2/2 plans complete

Plans:
- [x] 251-01-PLAN.md — items 1-4: verdict-first refusal, store before the fills walk, truthful refusal flags (wave 1)
- [x] 251-02-PLAN.md — the re-read outcome after a zero-row write, plus live-lane arms (wave 2)

### Phase 252: DERIBITOPTIONS — a Deribit options strategy's published figures are mark-to-market or withheld, never a cash-wallet artefact

**Goal:** A Deribit strategy that trades options never publishes a headline figure measured against the cash wallet alone. Either its returns are measured on a mark-to-market basis in key mode, or its headline is withheld by name when its chain is broken and its figures cannot be trusted. Evidence (PROD, 2026-11-25): the owner factsheet of strategy Quantum Drift, a private ZAV-Composite with a Deribit options leg and a broken chain, shows cumulative return +1636172.7%, CAGR +514301268133036.3% and Calmar 10402151596756.16, annualized from 122 days and "measured since Dec 16, 2025", and its headline is NOT withheld.
- **Root cause (diagnosed, not fixed).** `.planning/debug/deribit-implausible-returns.md` (status `diagnosed`, R11 verdict mechanism B): a key-mode Deribit derive always runs the `cash_settlement` basis (`DEFAULT_PNL_BASIS` in `deribit_txn.py`; the MTM and smoothed passes in `job_worker.py` are gated on `not is_key_mode`), so the TWR divides option P&L by the cash wallet, which excludes open option mark value. A long option prints a large loss on the buy day and a large gain on the close day, measured against a premium-shrunk wallet (key-A 2025-08-03 -78% then 08-04 +529%; key-B 2026-02-28 +169% on 1840 option trades). The session's `next_action`, "book the fix phase if A is confirmed", was never booked; this phase is that booking.
- **The choice.** The discuss step decides between (a) a mark-to-market basis for Deribit options in key mode and (b) withholding the headline when the chain is broken and the figures are implausible, or a combination. It decides within Phase 194 D-05 (no plausibility bound is applied to a published figure) and the KPI-gate ruling (withhold KPIs only under about 3 months of total record; zoomed windows always show), so option (b) needs a named, non-numeric trigger, never a magnitude threshold.
- ⭐ **FOUNDER RULING 2026-11-25 (AskUserQuestion via the coordinator), verbatim answer "Withhold first, then MTM (Recommended)", recorded in `252-CONTEXT.md`.** The option text chosen, verbatim: "Ship now: withhold the headline of a Deribit options book whose figure comes from the cash wallet, with the reason named on every surface (factsheet, share card, Compare, Discovery). The trigger is the existing 'unsmoothed options book' flag, not a size threshold. This extends D-05, so you'd be accepting a new named withhold, like you did for 233 today. Then measure market-price valuation and switch the headline to it only if it actually works for these keys." **This EXTENDS Phase 194 D-05** ("only D-04 and genuine nulls withhold a figure") by one named, structural withhold. It is not a plausibility bound. Wave 1 is the withhold, scoped to Deribit options books only: it never fires on MT5 and never on `twr_chain_broken` alone. Wave 2 measures market-price valuation first and promotes it to the headline only if the measurement passes. Discuss finding: the evidence strategy is a COMPOSITE (`run_stitch_composite_job`), whose MTM is closed by `mark_to_market_available` on option activity, not by the key-mode gates.
- **DEF-142.2-07 re-measured.** That entry's plan-04 census read 0 Deribit rows carrying `twr_chain_broken`; Quantum Drift suggests otherwise. The phase re-runs the census at HEAD on PROD (marker first), records the reading, and settles or carries the founder decision the entry holds.
**Requirements**: none mapped (routed from the diagnosed debug session `deribit-implausible-returns`, mechanism B, and TODOS `DEF-142.2-07`)
**Depends on:** nothing blocking. Founder decision 2026-11-25 (AskUserQuestion): "Book it in v1.22 (Recommended)". It shares the Deribit derive with 233 DERIBITTRUTH, whose book-cumulative criterion carries the same no-plausibility-bound rule, so plans list their write scope by symbol and the two phases do not edit the same function in parallel. User-facing: it moves published numbers. 155.2 freeze, conditional: if any MT5 number for MM2, MM3 or FX-AI_V moves (expected none, since the change is Deribit-only), it merges before 155.2 plan 12's recapture or after plan 14, never in between. ⭐ 2026-11-25: 155.2 moved to v1.23 HARDEN; this freeze rule still holds until 155.2 plan 12's recapture actually runs (see the milestone-wide rule).
**Success Criteria** (what must be TRUE):
1. The discuss step records which remedy the phase takes (mark-to-market basis in key mode, a named withhold, or both) and why, citing Phase 194 D-05 and the KPI-gate ruling; no criterion below applies a numeric plausibility bound.
2. A Deribit key-mode series built from an option buy and a later close, with no flow between them, yields daily returns that reflect the account's equity (option mark value included) or carries a named withhold reason that every surface honours. A fixture reproducing the debug session's 0.311 → 0.1605 → 0.165 → 0.528 wallet shape goes RED on today's code.
3. Quantum Drift's owner factsheet, after a re-derive (never a backfill `UPDATE`), shows either mark-to-market figures or a withheld headline with its named reason; it never shows the cash-wallet cumulative, CAGR or Calmar. Every surface that reads the same series (factsheet, share card, OG image, Discovery) agrees.
4. The `DEF-142.2-07` census is re-run on PROD at HEAD (marker query first) and its reading recorded: the count of Deribit rows carrying `twr_chain_broken`, total and published. The entry is either closed and deleted in the ship PR, or rewritten with the new number and its open founder decision.
5. Every Deribit strategy or book whose published figures move is re-derived, and the moved figures are listed in the CHANGELOG entry. No MT5 figure moves; if one does, the 155.2 freeze rule above governs the merge. ⭐ 2026-11-25: 155.2 moved to v1.23 HARDEN; this freeze rule still holds until 155.2 plan 12's recapture actually runs (see the milestone-wide rule).
6. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Any migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.

- ⭐ **FOUNDER DECISION 2026-11-26 (recorded in `252-CONTEXT.md` and `252-VERIFICATION.md`):** the OG card does NOT get the withheld sentence, and the return and drawdown charts are NOT withheld; both stay as they are. This narrows the "reason named on every surface" reading of the 2026-11-25 ruling for these two surfaces only. Phase 252 stays `human_needed` (the founder still runs the PROD probe).
- ⭐ **FOUNDER DECISION 2026-11-26 (AskUserQuestion via the coordinator), verbatim answer "Fix it inside 252" (recorded in `252-CONTEXT.md`):** the wave-2 probe read `fail` on PROD (member m3: smoothed build `LedgerValuationError:position`). The cause is fixed inside Phase 252, and 252 stays open until the probe passes. The fix invents no data and does not narrow the MTM span without a separate founder ruling.
- ⭐ **FOUNDER DECISION 2026-11-27 (AskUserQuestion via the coordinator), verbatim "Accept measured shape only (Recommended)"; partial reversal of D-09, recorded in `252-CONTEXT.md`:** a Deribit `exercise` row is accepted only as change 0 with position present and 0, closing the option to 0 that day like `expiry`. Every other exercise shape keeps refusing. Gap plan 252-08 carries the fix.
- ⭐ **DECIDED AT GAP PLANNING 2026-11-27 (orchestrator, under the 2026-11-25 ruling, after the PASS probe; recorded in `252-CONTEXT.md`):** gap plans 252-09 and 252-10 promote a composite options book to the smoothed mark-to-market headline when criteria P1 to P4 hold, else today's withhold stays. The composite smoothed pass stops reading `SMOOTHED_MTM_ENABLED` (single-key keeps it); a promoted row stores `headline_basis = "smoothed_mtm"` and drops `mtm_gated_reason`. Cheap to revert; the founder may overturn it.
- ⚠️ **Known limit (review WR-02, 2026-11-27):** a promoted smoothed headline is time-limited by venue mark retention; as marks age out a later refresh returns it to the named withhold on its own (WARNING log plus Sentry report). When that happens is unmeasured; a remedy needs a founder ruling.
- ⭐ **FOUNDER DECISION 2026-11-28 (via the coordinator), verbatim "Keep always-on (Recommended)" (recorded in `252-CONTEXT.md`):** options composites use smoothed mark-to-market regardless of `SMOOTHED_MTM_ENABLED`; this confirms the 2026-11-27 gap-planning decision.
- ⭐ **FOUNDER DECISION 2026-11-28 (via the coordinator), verbatim "Fix inside 252 first" (recorded in `252-CONTEXT.md`):** the post-deploy re-stitch did not promote (the smoothed third crawl hit its bounded budget), so one more gap plan inside 252 builds the smoothed ledger from the cash pass's own crawl (key-mode precedent, Phase 185 `retain_raw_rows`), with no third crawl; then re-stitch, read PROD, close 252.
**Plans:** 10/11 plans executed

Plans:
- [x] 252-01-PLAN.md — tracer: one predicate `isOptionsCashWalletBook`, a named withhold cause in the headline verdict, the factsheet read path and the share card name the reason (SC-2 RED fixture)
- [x] 252-02-PLAN.md — the rest of the factsheet: windows, benchmark cells, range figures withheld for this cause, leverage, toggle copy
- [x] 252-03-PLAN.md — the D-15 figure-record marker, recommendations, the returns route and the composer constituents
- [x] 252-04-PLAN.md — Discovery, owner lists, percentile ranks and allocator book legs
- [x] 252-05-PLAN.md — Compare, the completeness census test and cross-language pin, DEF-142.2-07 closed, the single-key follow-up booked
- [x] 252-06-PLAN.md — wave 2 measurement tooling: the read-only smoothed MTM probe (the founder-gated run and any promotion follow the ship)
- [x] 252-07-PLAN.md — name which smoothed-only refusal fired (G252-PROBE-M3, gap closure)
- [x] 252-08-PLAN.md — accept the measured exercise shape (change 0, position 0) as an option close (G252-PROBE-M3, gap closure)
- [x] 252-09-PLAN.md — the composite stitch stores the smoothed mark-to-market result as an option-active composite's headline when criteria P1 to P4 hold, else keeps the wave-1 withhold (G252-MTM-PROMOTION, gap closure)
- [x] 252-10-PLAN.md — the factsheet opens a promoted composite on the smoothed basis with "Cash settlement" still withheld; a census proves every surface agrees; cache key v30, shipped as v31 (G252-MTM-PROMOTION, gap closure)
- [ ] 252-11-PLAN.md — the composite smoothed pass rebuilds each Deribit member from the cash pass's own crawl, with no third crawl (founder decision 2026-11-28 "Fix inside 252 first"; G252-MTM-PROMOTION, gap closure)

**Cross-cutting constraints:** <!-- gsd:generated -->
- PROOF-01: each gate goes RED on a neutered copy with its arm named, is restored by cp from a byte backup with cmp exit 0, and goes GREEN; outputs verbatim in the SUMMARY

### Phase 253: BINANCECURSOR — a stopped Binance fills read below a cursor that runs ahead of the stored fills is re-read, and its signal lasts

**Goal:** A Binance raw fills read that stops (deadline, `BINANCE_PAGE_CAP`) or loses a symbol (`binance_partial_symbols`) never leaves an unread span that no later run re-reads, even when the fills cursor column is ahead of the strategy's newest stored fill, and the signal that names such a span outlives the sync's own follow-on writes. It closes `TODOS.md` `[250-BINANCE-STOP-BELOW-CURSOR]` (Phase 250 BINANCEFILLS review rounds 1-3, MEDIUM, data-integrity; detail, fix direction and gates as written there and in `250-REVIEW-R3.md` WR-01 and WR-02):
- **The re-read gap.** When the cursor column is ahead of the stored fills (likeliest entry: the first sync of a second strategy on a key shared with another strategy; also pre-232 wall-clock stamps and deleted fills), a bounded stop stamp is below the column, and the forward-only `advance_sync_cursor` RPC (migration `20260602173710`) drops it. The next run seeds at the column, so the stopped or failed symbol's span between its bound and the column is never re-read. It is the recorded open gap in Phase 250's SC-3, named at `_RAW_TRADE_INGESTION_ENABLED` in `analytics-service/services/job_worker.py`.
- **The predicate (round 3 WR-01).** `binance_stop_below_cursor` takes the stop bound as the unread start whenever a bound exists, so a run where one symbol stops past the column and another fails is not flagged. Round 3 verified, in a scratch copy, a predicate that compares the earliest complete-through instant with the next run's walk start.
- **The short-lived signal (round 3 WR-02).** Every sync-time `binance_*` flag is overwritten by the chained `derive_broker_dailies` job (`_prestamp_flags`) and rebuilt without `binance_*` keys by `run_csv_strategy_analytics`, so the WARNING log is the only lasting signal. This also affects `binance_deadline_symbols`, which the founder-ruled quiet-prefix exception (Phase 250, 2026-11-25) relies on.
⭐ **FOUNDER RULING 2026-11-26 (relayed by the coordinator, recorded in `250-VERIFICATION.md` and `250-UAT.md` on the Phase 250 branch):** "ship Phase 250 now. `[250-BINANCE-STOP-BELOW-CURSOR]` is routed to a follow-up phase, which the main session books on main with /gsd-phase add. The Binance switch stays off until that phase closes." So Phase 250 ships with this gap open and recorded, and `USE_RAW_TRADE_INGESTION` is NOT turned on for Binance until this phase is complete.
**Requirements**: none mapped (routed review survivor from Phase 250: `[250-BINANCE-STOP-BELOW-CURSOR]`, round 3 WR-01 and WR-02)
**Depends on:** Phase 250 BINANCEFILLS (its windowed walk, stop bounds and `binance_stop_below_cursor` flag are what this phase corrects; it must be on `main` first). The fix needs an RPC change (a cursor write that can lower the column to a bounded stop stamp, or a seed rule that does not trust a column ahead of the strategy's stored fills), so it carries a migration: migration-reviewer and rls-policy-auditor clean at MEDIUM+ before merge, in the one serial migration lane. It shares `run_sync_trades_job` with 251 SYNCSTORE, so plans list their write scope by symbol.
**Success Criteria** (what must be TRUE):
1. A two-run test in which run 1's cursor column is set by another strategy on the same key, and run 2 is seeded from what run 1 wrote, re-reads the stopped or failed symbol's span between its bound and the column. It is RED on today's code. The cursor never stamps past stored data.
2. A run where one symbol stops past the column and another fails is flagged by name; a stop-plus-partial arm pins the predicate, and the predicate compares the earliest complete-through instant with the next run's walk start.
3. A sync-time `binance_*` flag (`binance_stop_below_cursor` and `binance_deadline_symbols` among them) survives the chained `derive_broker_dailies` write and the `run_csv_strategy_analytics` rebuild; an arm proves each.
4. `USE_RAW_TRADE_INGESTION` stays off for Binance until criteria 1 to 3 are met on `main`, and the `_RAW_TRADE_INGESTION_ENABLED` comment and the `TODOS.md` entry are updated in the ship PR (the entry deleted and named in its CHANGELOG entry).
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 4/4 plans complete

Plans:
- [x] 253-01-PLAN.md — the per-strategy re-read bound table and its fenced SECURITY DEFINER writer, with the 24-arm SQL gate (D-01, D-05)
- [x] 253-02-PLAN.md — the worker reads the bound into the Binance fills seed and writes it back; the stop-plus-partial predicate (SC-1, SC-2)
- [x] 253-03-PLAN.md — every census the new gate and function move, and the committed function snapshot (D-12)
- [x] 253-04-PLAN.md — the sync-time `binance_*` flags survive the derive and the CSV rebuild, and a clean sync clears them (SC-3, SC-4)

### Progress (this milestone)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 222. ALERTTRUTH | 4/4 | Complete (shipped v0.133.81.0, #1352; migration `20261125212222` applied to TEST and PROD) | 2026-11-25 |
| 223. FLOWKINDS | 5/5 | Complete (shipped v0.133.68.0, #1327) | 2026-11-24 |
| 225. ONEACCOUNTONCE | 21/21 | Complete (PR-1 #1315, PR-2 #1324, PR-2b-1, PR-2b-2, PR-2c0, PR-2c #1344, PR-3 #1368 and plan 21 #1374 shipped; plan 18 founder control passed 2026-11-26; plan 21 post-deploy poll read PASSED 2026-11-27; verification passed) | 2026-11-27 |
| 226. MT5SOAK | 5/5 | Complete (shipped v0.133.64.0, #1319) | 2026-11-24 |
| 227. JOBLEDGER | 11/11 | Complete (shipped v0.133.67.0, #1325; HEAL-01 sweep registered on PROD) | 2026-11-24 |
| 228. KEYANSWERS | 0/? | Not started | - |
| 229. MT5DERIVE2 | 6/6 | Complete (shipped v0.133.69.0, #1328; founder's live soak exit 0 and the 155.2 freeze check recorded 2026-11-25) | 2026-11-25 |
| 230. MT5NIGHTLY | 8/10 | Shipped v0.133.91.0 (#1358; migration 20261126140000 applied to TEST and PROD in supabase-migrate run 45807605366); verification human_needed (plan 09: seven clean nights after both services carry the lease; plan 10: the coordinator's capture and replay) | - |
| 231. BYBITREADS | 6/6 | Complete (plans 01-05 shipped v0.133.61.6 #1314 and v0.133.65.0 #1321; plan 06 shipped v0.133.73.0 #1333 after Phase 229) | 2026-11-25 |
| 232. OKXTRADES | 4/4 | Complete (shipped v0.133.70.0, #1330) | 2026-11-24 |
| 233. DERIBITTRUTH | 7/7 | Complete (shipped v0.133.83.0, #1360; verification passed 5/5; book B's out_of_window_flow handed to Phase 234) | 2026-11-26 |
| 234. NOCAPITAL | 4/4 | Complete (shipped v0.133.76.0, #1339; verification passed, SECURITY 15/15 closed) | 2026-11-25 |
| 235. HOLDINGSTRUTH | 6/6 | Complete    | 2026-11-26 |
| 236. FIGUREMATH | 11/11 | Complete (shipped v0.133.82.0, #1354; FIG-05 fleet re-derive passed 2026-11-27, verification `passed`) | 2026-11-27 |
| 237. FACTSHEETHONEST | 13/13 | Complete (shipped v0.133.63.0, #1316; both visual checks passed 2026-11-25) | 2026-11-25 |
| 238. NEVERCOMPUTED | 9/9 | Complete (shipped PR-1 v0.133.71.0 #1331, FACT-05, and PR-2 v0.133.90.0 #1363, FACT-03; migration 20261126130000 applied to TEST and PROD; verification passed, all five human items resolved 2026-11-26) | 2026-11-26 |
| 239. SURFACECACHE | 3/3 | Complete (shipped v0.133.72.0, #1332) | 2026-11-24 |
| 240. CONNECTTRUTH | 8/8 | Complete (shipped v0.133.74.0, #1334) | 2026-11-25 |
| 241. DEMOCREDS | 4/4 | Complete    | 2026-11-26 |
| 250. BINANCEFILLS | 8/8 | Complete (shipped v0.133.84.0, #1355; verification passed, UAT 4/4; ⛔ corrected 2026-11-26: the switch is on in PROD and stays on by founder ruling, see 250-VERIFICATION) | 2026-11-26 |
| 251. SYNCSTORE | 2/2 | Complete (shipped v0.133.87.0, #1359; verification passed 6/6, SECURITY 13/13 closed) | 2026-11-26 |
| 252. DERIBITOPTIONS | 8/8 | Human verification pending: the wave-2 probe PASSES on PROD (2026-11-27 18:36Z, 3/3 members, after gap plans 07 and 08, #1390 and #1400); next is the MTM promotion plan; the post-deploy PROD factsheet check and the ship-time census item stay open | - |
| 253. BINANCECURSOR | 4/4 | Complete (shipped v0.133.93.0, #1367; migration 20261126150000 applied to TEST and PROD in supabase-migrate run 45824919779; re-dump #1369; verification passed after founder rulings 2026-11-26, "Keep it on, fix records" and "Accept both"; `USE_RAW_TRADE_INGESTION` stays on, and PROD has no Binance key) | 2026-11-26 |

## 📋 v1.23 HARDEN — security, alerting, tooling (planned; starts after TRUTH closes)

Planned by founder ruling 2026-11-23, "Yes, split into two milestones" (F-10 in `REQUIREMENTS.md`). This milestone takes the security tier and the rest: alerting, held Sentry captures, SQL gates, test lanes and dead leftovers. The one exception is SECR-01/02, which stay in v1.22 as 241 DEMOCREDS because `158-OPS-03` is the only HIGH item. Its 35 requirements are listed under "Planned for v1.23" in `REQUIREMENTS.md`. The carried 221 SENTRYSCRUB2 and 224 DEADLEFTOVERS moved here with their tiers.

⭐ **155.2 LIVEPARITY and 157 FOUNDER-CONFIRM moved here from v1.22, 2026-11-25 (founder ruling in chat; recorded here, in v1.22's section, in each phase's CONTEXT.md and in `REQUIREMENTS.md`, per the deviation policy).** Founder (2026-11-25): "We will Move 157 and 155.2 into the next milestone". Their sections and Progress rows are below, unchanged apart from a dated note. Their 10 requirements (MT5-07..10, MT5-15, MT5-GOAL-01, FCONF-01..04) are mapped to v1.23 in `REQUIREMENTS.md`'s traceability table, which makes 45 for v1.23. Their text stays under its "Carried" headings in `REQUIREMENTS.md`'s v1.22 part, with a dated pointer. Both phases are in progress. The ruling names only the milestone. Nothing else was ruled on, and the earlier records stand. v1.22's 155.2 freeze window still binds v1.22's number-moving phases until 155.2 plan 12's recapture actually runs. The milestone starts with `/gsd-new-milestone` after v1.22 closes, when its requirements and these sections are re-read. PROOF-01, the migration lane and the TODOS closure rule from v1.22 apply unchanged.

**Order** (founder F-1, then the research's waves):
1. **Security:** 242 SECRETSHYGIENE (its S5 narrowing is the first S5 migration), 243 DBBACKSTOP, 244 ACCESSGUARDS and 221 SENTRYSCRUB2.
2. **The rest:** 245 ALERTPAGE; 246 ALERTREADERS, after 242's S5 migration; 247 SENTRYHELD, after 221; 224 DEADLEFTOVERS; 248 SQLGATES2; 249 TESTLANES.
3. **Outside the order (moved from v1.22 on 2026-11-25):** 155.2, which runs statements → plan 11 → plan 12's recapture → plans 13 and 14, under v1.22's freeze window. 157 runs in the same founder sitting, and its password rotation comes after 155.2's last live read.

### Phases (HARDEN)

- [ ] **Phase 155.2: LIVEPARITY — on a trading day, our MT5 numbers match the terminal's and the broker's within 1%** - The founder's scripted session on MM2, MM3 and FX-AI_V, Gate A and Gate B per account, every surface the same, every gap fixed at its root or ruled on; after 155, session after the 155.1 deploy
- [ ] **Phase 157: FOUNDER-CONFIRM — the observations only the founder can make are made** - Wizard resume, the amber recomputing block and the four 153.7 copy members seen in a real wizard; the spike password rotated after the live reads and gate 1 re-checked; same sitting as the 155.2 session
- [ ] **Phase 221: SENTRYSCRUB2 — no Sentry event carries PostgREST details or hint from any capture site, and browser captures actually report** - Sentry scrub at the last hop for direct capture sites, then client Sentry init; independent of the MT5 parity phases
- [ ] **Phase 224: DEADLEFTOVERS — dead SQL, retired job kinds still enqueued and inert plumbing are retired** - Dead SQL, the retired compute_analytics enqueue and kind rows, and inert plumbing, with a migration; the poll_positions enqueue stays live (F-8)
- [x] **Phase 242: SECRETSHYGIENE — the full history is scanned on a schedule, and the cron service key goes only to named hosts** - Scheduled full-history scan; the S5 wildcard closed in both cron functions, first of the S5 migrations
- [x] **Phase 243: DBBACKSTOP — anon reads only named metric keys, an api_keys write must belong to its caller, and a client role cannot hold a table lock** - Database-level backstops by migration; the lock timeout measured on TEST first
- [x] **Phase 244: ACCESSGUARDS — an owner read without its key id fails to compile, every route writes its audit row, and the watchlist RLS runs in CI** - Application and CI guards, no migration expected
- [ ] **Phase 245: ALERTPAGE — an MT5 outage pages once, recovers once and closes once, and every paging failure is loud** - Python paging path: episode lifecycle on a fake clock, honest Sentry credit, inline close budget, ERROR-level failures
- [ ] **Phase 246: ALERTREADERS — every alert reader sees every row, reports its own delivery failure and pages per account** - S5 readers re-based on the narrowed body: pg_net delivery, scrub reader, per-account sync paging, match-engine cron signal
- [ ] **Phase 247: SENTRYHELD — a failing anonymous read reports exactly once, and the landing page at most once per window** - Caller-only; ordered after SENTRYSCRUB2
- [ ] **Phase 248: SQLGATES2 — SQL gate censuses fail when an axis drifts, and apply-test tells a seeded ledger row from an applied migration** - Derived census axes, enforced exemptions, provenance gate twins, the apply-test fix before the forward comment correction
- [ ] **Phase 249: TESTLANES — every live-DB lane test executes, a fence timeout fails, lint agrees cold and warm, and the PROD image crash risk is measured** - Ledger to zero with no assertion weakened, no green skips, cache-proof lint, supautils measured locally on the PROD image version
- [x] **Phase 254: OPENINGDEPOSIT — a deposit dated the day before a key's first return is its opening deposit on every venue** - Booked 2026-11-26 by founder ruling ("Exempt it, book for v1.23") from an allocator book whose `out_of_window_flow` is a Bybit key's opening deposit dated one day before its first return; a narrow opening-run exemption in `replay_key_equity`, not a wider `FULL_HISTORY_VENUES`
- [x] **Phase 255: NULLANCHOR — an OKX, Bybit or Deribit fills read that fails after the daily store never leaves a span the next run skips** - Booked 2026-11-26 by founder ruling ("Keep it on, fix records") from 253 BINANCECURSOR's routed `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]`, live today because `USE_RAW_TRADE_INGESTION` is on in PROD (completed 2026-11-27)
- [x] **Phase 256: OKXUNITSWITCH — an OKX account that moves from USDT into a coin is reported in USD up to the switch and in that coin after it, on every surface, and its frozen derives recover** - Booked 2026-11-27 by founder ruling (AskUserQuestion, "USD before 11-15, BTC after") from the diagnosed `okx-non-usd-native` debug session: one OKX account, stored as 4 keys, moved from USDT into spot BTC and its 7 nightly derives fail by `daily_pnl_non_usd_okx`; reverses part of 232-03's VREAD-06
- [ ] **Phase 257: SEEDHOLD — a down re-read bound cannot move a strategy's seed past an unrecorded span, and a Bybit fills read that hits its deadline records what it read** - Booked 2026-11-27 by founder ruling (AskUserQuestion, "Fix both in a follow-up (Recommended)") from 255 NULLANCHOR's two routed survivors, `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` and `[255-BYBIT-DEADLINE-NO-PROGRESS]`
- [x] **Phase 258: REDUMPDIRECT — after a PROD migration apply, the baseline re-dump commits straight to main with no PR and no approval** - Booked 2026-11-27 by founder ruling ("Push to main directly") as a CI-only phase: `supabase-migrate.yml`'s re-dump stops opening a bot PR that waits on a human approval and pushes its one commit to `main`; overrides 164.9.5 AUTOREDUMP's D-13 and D-23 (completed 2026-11-28)
- [x] **Phase 260: CIHEADROOM — ci.yml sits well under GitHub's workflow file size limit, and a gate outside ci.yml fails a PR when any workflow file nears it** - Booked 2026-11-27 (CI-only) from 243 DBBACKSTOP's measurement: main's `ci.yml` is 511,509 bytes, and PR #1405 at 512,355 bytes got a CI run that failed at startup with zero jobs on two pushes, while 511,664 bytes started normally (completed 2026-11-28)
- [ ] **Phase 261: UNITSWITCHEDGES — the edge shapes OKXUNITSWITCH routed: a re-pointed key, a first mark on a mixed day, a pre-mark deposit, keys with no early mark, and bills ageing out** - Booked 2026-11-27 by founder ruling (AskUserQuestion, "Book a follow-up phase (Recommended)") from 256 OKXUNITSWITCH review round 3 survivors R3-02, R3-04, R3-05, R3-07 and SF3-01

### Phase 155.2: LIVEPARITY — on a trading day, our MT5 numbers match the terminal's and the broker's within 1%

**Goal:** On one trading day, with the founder at the terminal, the numbers Quantalyze renders for MM2, MM3 and FX-AI_V are compared with the terminal's and the broker's own figures, and every difference is fixed at its root or ruled on by the founder, until the parity verdict passes on every surface. This is the only phase gate 2 blocks, and the phase whose pass lifts the advertising ban. Research Phase C.
**Requirements**: MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01
**Depends on:** Phase 155 (dress rehearsal green). The founder session inside this phase also waits on 155.1's reading deployed with a weekday PROD reading row per key; that is a deploy condition, not a completion dependency (see 155.1)
**Plans:** 13/17 plans complete
**UI hint**: no

D-E amended 2026-11-22 (founder): the weekend edge is the Fri 2026-11-20 frozen close, read 2026-11-22 for all three accounts; for that edge only, the Gate B window runs past the 11-19 run day (see `milestones/v1.18-REQUIREMENTS.md` D-E; `REQUIREMENTS.md` was removed at the v1.18 close). ⛔ CORRECTED 2026-11-23: `REQUIREMENTS.md` exists again for v1.22 TRUTH; it carries D-A..D-E again, D-E's 2026-11-22 amendment included, beside the archived copy in `milestones/v1.18-REQUIREMENTS.md`.

**Freeze window (v1.22, roadmap 2026-11-23):** a change that moves MT5 numbers for MM2, MM3 or FX-AI_V merges before plan 12's recapture or after plan 14, never in between, because a merge in between voids plan 13's `computed_at` binding. It binds 225, 229, 234 and 236, and binds 230 and 233 if their fix moves these numbers. The research schedules plan 12's recapture after 225 and 229 deploy, so that their fixes (MM3 no longer publishing MM2's numbers, the `nav_twr.py` gaps) are inside the verdict. Plan 11 waits on the founder's broker statements.

⭐ **Run day 2026-12-01, monthly statements only (founder ruling 2026-11-23; also in `155.2-CONTEXT.md` and `155.2-RULINGS.md`).** Founder (2026-11-23): "I would suggest, we do 155.2 on 1st of december with the new monthly statments only". Gate B's statement oracle is the November 2026 monthly statement per account; plan 12's recapture runs on or after 2026-12-01; plans 11 to 14 are re-planned from the actual statements. The freeze window opens only at plan 12's recapture, so until then number-moving phases (225, 229 and the others it binds) merge freely.

⭐ **Moved to v1.23 HARDEN, 2026-11-25 (founder ruling in chat; recorded here, in both milestone sections, in `155.2-CONTEXT.md` and in `REQUIREMENTS.md`, per the deviation policy).** Founder (2026-11-25): "We will Move 157 and 155.2 into the next milestone". This section moved from v1.22's section with its content unchanged. The freeze window above still binds the v1.22 phases it names until plan 12's recapture actually runs; its "(v1.22, roadmap 2026-11-23)" label records where it was set.

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

⭐ **Moved to v1.23 HARDEN, 2026-11-25 (founder ruling in chat; recorded here, in both milestone sections, in `157-CONTEXT.md` and in `REQUIREMENTS.md`, per the deviation policy).** Founder (2026-11-25): "We will Move 157 and 155.2 into the next milestone". This section moved from v1.22's section with its content unchanged. The ruling names only the milestone. Nothing else was ruled on, and the earlier records stand.

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
**Plans:** 6/6 plans complete

Plans:
- [x] 242-01-PLAN.md — SECR-03: commit-scoped `.gitleaksignore`, the scheduled full-history scan of main with its count-only dedup issue, the workflow and ignore-file pins, PROOF-01 for the scan (wave 1)
- [x] 242-02-PLAN.md — SECR-04 tracer: one migration narrows the CHECK and all four key-posting functions to the exact two origins and widens the key guard; cron_sync gate arms W1, K1 and P2 (wave 1)
- [x] 242-03-PLAN.md — SECR-04: the prober and ops gates repointed at the new bodies, with W1 and K1 in each (wave 2)
- [x] 242-04-PLAN.md — SECR-04: the analytics settings gate repointed, with U3 (the CHECK), W1 and K1, and the migration's tested manual rollback (wave 2)
- [x] 242-05-PLAN.md — SECR-04: ARMS_FLOOR and every arm census moved to measured values (wave 3)
- [x] 242-06-PLAN.md — Records and the phase gate: the two closed TODOS entries deleted, runbooks and WINDOWS entry 61 updated, all gates and a squash-shaped scan green (wave 4)

### Phase 243: DBBACKSTOP — anon reads only named metric keys, an api_keys write must belong to its caller, and a client role cannot hold a table lock

**Goal:** An anonymous request reads only named metric keys, an `api_keys` write must belong to its caller, and a client role cannot hold a table lock past a timeout:
- **Anon factsheet read.** An anonymous request reads only the named metric keys a factsheet needs, never the whole `metrics_json_by_basis` column.
- **`api_keys` ownership.** A database-level backstop refuses an `api_keys` write whose `user_id` is not the caller's, including an insert through the admin client. Its design gets architecture sign-off at plan time, and `FORCE RLS` on `api_keys` is not the mechanism: it breaks every connect. ⭐ **FOUNDER DECISION 2026-11-26 (the architecture sign-off, "Two-part backstop"):** the backstop is (i) a BEFORE UPDATE trigger that makes `api_keys.user_id` immutable for every role, BYPASSRLS included, and (ii) a BEFORE INSERT check that refuses any insert made outside a sanctioned SECDEF writer function, through a transaction-local fence GUC. The founder accepts the narrowing from "the caller's `user_id`" to "only the audited writer path can insert, and `user_id` can never be repointed". The `validate-and-encrypt` insert, the e2e inserts and the seed inserts move to that writer RPC. ⛔ **CORRECTED 2026-11-26:** the fence is a `current_user` check (a client/API role is refused, a postgres-owned SECDEF writer passes), not a GUC. Migration `20260515114310` already rejected the GUC shape as forgeable. The GUC wording is kept as lineage.
- **Lock hold.** A client role holding UPDATE or DELETE cannot keep a table-wide lock past a set timeout. The timeout mechanism is first proven on TEST to be honoured through PostgREST.
**Requirements**: DBACC-01, DBACC-02, DBACC-03
**Depends on:** Phases 237, 225 and 235 merged (all v1.22): DBACC-01 edits 237's payload-builder select, and DBACC-02's trigger is on `api_keys`, the table 225 changes and 235 reads. DBACC-03's timeout is measured on TEST as a client role before any migration.
**Success Criteria** (what must be TRUE):
1. An anonymous request reads only the named metric keys a factsheet needs; a test fails on a key outside the pinned alias set. (DBACC-01)
2. A database-level backstop, without `FORCE RLS` on `api_keys`, refuses an UPDATE that changes `api_keys.user_id` for every role, and refuses any `api_keys` insert made outside the sanctioned SECDEF writer, including a direct insert through the admin client. (DBACC-02; narrowed by founder decision 2026-11-26. The original wording, "refuses an `api_keys` write whose `user_id` is not the caller's", is kept here as lineage.)
3. A client role holding UPDATE or DELETE cannot keep a table-wide lock past a set timeout. A recorded TEST measurement comes first, showing that PostgREST honours the timeout and that no legitimate request needs longer. (DBACC-03)
4. PROOF-01: each gate above goes RED on a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. Each migration passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 10 plans

Plans:
**Wave 1**
- [x] 243-01-PLAN.md — DBACC-03: TEST REST measurement of the client-role timeouts (PR-A, wave 1)
- [x] 243-03-PLAN.md — DBACC-01(a): 21-alias by-basis projection in the payload builder (PR-A, wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 243-02-PLAN.md — DBACC-03: migration pins anon 3s / authenticated 8s, plus a pg-lane gate (PR-A, wave 2)
- [x] 243-04-PLAN.md — DBACC-01(a): OG route reads the aliases (PR-A, wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 243-05-PLAN.md — DBACC-02 step 1: insert_api_key writer RPC and user_id immutability trigger (PR-A, wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 243-06-PLAN.md — DBACC-02 step 2: validate-and-encrypt writes through the RPC (PR-B, wave 4)
- [x] 243-07-PLAN.md — DBACC-02 step 2: live-DB test seeds move to the RPC (PR-B, wave 4)
- [x] 243-08-PLAN.md — DBACC-02 step 2: e2e, script, integration and Python seeds move to the RPC (PR-B, wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 243-09-PLAN.md — DBACC-01(b): anon loses the metrics_json_by_basis column (PR-B, wave 5)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 243-10-PLAN.md — DBACC-02 step 3: the INSERT fence, a current_user allow-list (PR-C, wave 6)

### Phase 244: ACCESSGUARDS — an owner read without its key id fails to compile, every route writes its audit row, and the watchlist RLS runs in CI

**Goal:** An owner read without its key id fails to compile, every route writes its audit row or carries an exemption, and the watchlist RLS assertions run in CI:
- **Compile guard.** An owner-surface read that lacks `api_key_id` fails to compile (`src/lib/types.ts`). ⭐ Founder decision 2026-11-27 ("Accept as narrowed"): met as narrowed — the compile guard (a public row cannot pass as `Strategy`) plus the blocking CI source-scan pin over cast-typed owner selects and its cast-site census; owner reads typed by casts are not compiler-checked. The shared StrategyTable/StrategyGrid optional-key remainder stays on TODOS `170.6.1.1-API-KEY-ID-OPTIONAL-OWNER-GUARD`.
- **Audit rows.** Each of the six routes outside the audit-log law writes an audit row, or carries a recorded founder exemption. The exact-set allowlist only shrinks. ⭐ Founder decision 2026-11-26 ("Approve as proposed", recorded in `244-CONTEXT.md`): partner-import's `profiles` upsert is covered by its `admin.partner_import` roll-up row; the two flag-monitor `ZERO_DENOM_STREAK_KEY` upserts (internal cron counter) and the three `strategy_analytics` 'failed' stamps in keys/sync and finalize-wizard (derived compute state) are founder exemptions. The allowlist goes 6 to 0.
- **Watchlist in CI.** The `discovery-watchlist` RLS and auth assertions (the MEDIUM half of `158-OPS-03`) run in CI and can fail there.
**Requirements**: DBACC-04, DBACC-05, DBACC-06
**Depends on:** nothing hard.
**Success Criteria** (what must be TRUE):
1. An owner-surface read that lacks `api_key_id` fails to compile, shown by a type-level test. (DBACC-04)
2. Each of the six routes writes an audit row or carries a recorded founder exemption, and the exact-set allowlist only shrinks. (DBACC-05)
3. The `discovery-watchlist` RLS and auth assertions run in a CI job, and a neutered policy turns that job red. (DBACC-06)
4. PROOF-01: each gate above goes RED on a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 4 plans

Plans:
- [x] 244-01-PLAN.md — DBACC-04 compile guard: required Strategy.api_key_id, PublicStrategy and PublicRankedStrategyRow, shared list components relaxed, type test under tsc, PROOF-01
- [x] 244-02-PLAN.md — DBACC-05 audit law: partner-import pragma moved into the window, five founder-exemption pragmas, allowlist 6 to 0, PROOF-01
- [x] 244-03-PLAN.md — DBACC-06 part 1: watchlist spec run as-is on the local-stack lane, spec-local repairs, RLS and proxy neuters (PROOF-01), lane teardown
- [x] 244-04-PLAN.md — DBACC-06 part 2: spec wired into e2e-seeded, census 26 to 27, wiring pin, PROOF-01

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

### Phase 254: OPENINGDEPOSIT — a deposit dated the day before a key's first return is its opening deposit on every venue

**Goal:** A deposit dated exactly the day before a key's first return counts as that key's opening deposit on every venue, not only on Deribit and MT5. Today `replay_key_equity` in `analytics-service/services/allocator_equity_derive.py` treats such a deposit as an opening deposit only for `FULL_HISTORY_VENUES` (Deribit, MT5). On any other venue it lands outside the key's window and is reported as `out_of_window_flow`, which degrades a book whose history is in fact complete. Source: an allocator book on PROD carries `out_of_window_flow` from one Bybit key, and that flow is the key's opening deposit, dated one day before its first return. The founder ruled on 2026-11-26: "Exempt it, book for v1.23".
- **The fix is narrow.** An opening-run exemption in `replay_key_equity`: a flow dated exactly one day before the key's first return is its opening deposit, whatever the venue.
- **Not the fix.** Widening `FULL_HISTORY_VENUES`. That set is shared with the D-13 zero-start checks, which must keep their meaning.
**Requirements**: TBD
**Depends on:** nothing hard.
**Success Criteria** (what must be TRUE):
1. On a non-Deribit, non-MT5 venue, a deposit dated exactly the day before a key's first return is that key's opening deposit, and it is not counted in `out_of_window_flows`. A test drives this on a Bybit-shaped fixture.
2. A deposit two or more days before the first return, and a flow on any later day outside the window, are still reported as `out_of_window_flow`.
3. `FULL_HISTORY_VENUES` and the D-13 zero-start checks are unchanged, and a test pins that.
4. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 1/1 plans complete

Plans:
- [x] 254-01-PLAN.md — the opening-deposit exemption in `replay_key_equity` (deposit only, off full history, count flag `opening_deposit_exempted`), the SC-1/SC-2/SC-3 and writer-basis arms, the old-rule tests reworked, the full suite against a HEAD baseline, and PROOF-01 neuters N1 to N10

### Phase 255: NULLANCHOR — an OKX, Bybit or Deribit fills read that fails after the daily store never leaves a span the next run skips

**Goal:** A fills read on OKX, Bybit or Deribit that raises, is rate limited (429) or is cancelled after Phase 251's daily `sync_trades` store never leaves a span that the next run's seed skips, on a NULL `last_fetched_trade_timestamp` column and on a set column with no stored fill alike. This is `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]`, which is live today: the Railway production `USE_RAW_TRADE_INGESTION` is `true` on both analytics services, and PROD holds OKX, Bybit and Deribit keys.
- **Founder ruling 2026-11-26 (AskUserQuestion), verbatim: "Keep it on, fix records".** The switch stays on. This phase gives the entry its v1.23 owner. Booked with `/gsd-phase` add and placed in v1.23 HARDEN by hand, as Phase 254 was.
- **Fix direction (from the `TODOS.md` entry, a decision for this phase):** an `advance_sync_cursor` anchor covers only the NULL column, because that RPC cannot lower a set column. Two directions cover both cases. One extends the Phase 253 per-strategy re-read bound to these venues: a provisional bound written at the seed before the daily store, and the daily store held when the bound cannot be recorded. The other holds the daily store until the fills read has run, which changes Phase 251's ordering. Holding the worker's own store does not stop `cron_sync` or `/fetch-trades` from storing daily rows.
**Requirements**: TBD
**Depends on:** nothing hard. It re-bases on Phase 253's bound table and RPC if it extends them.
**Success Criteria** (what must be TRUE):
1. For each of OKX, Bybit and Deribit, on a NULL column and on a set column with no stored fill, with a 429, a cancel and a plain raised read from the fills read after run 1 stored a daily row, run 2's walk start is at or before run 1's seed. Each arm is RED on `origin/main` today.
2. Binance's Phase 253 behaviour and `advance_sync_cursor`'s callers do not regress, and a test pins that.
3. The `TODOS.md` entry `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` is deleted in the ship PR and named in its CHANGELOG entry.
4. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 3 plans

Plans:
- [x] 255-01-PLAN.md — the gate before the fix: the SC-1 two-run matrix for OKX, Bybit and Deribit (30 arms) measured RED at HEAD, and the SC-2 pin on `advance_sync_cursor` and the Binance-only flags
- [x] 255-02-PLAN.md — the fix: the Phase 253 per-strategy re-read bound extended to OKX, Bybit and Deribit inside `run_sync_trades_job`, no migration
- [x] 255-03-PLAN.md — PROOF-01 neuters N1 to N10 (each named arm RED, restored from a byte backup, GREEN) and the SC-3 ship hand-over

⭐ **Shipped 2026-11-27 as v0.133.104.0 (#1395).** `255-VERIFICATION.md` is `passed`: SC-1, SC-2 and SC-4 verified, SC-3 met at ship (the `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]` entry is deleted from `TODOS.md` and named in the v0.133.104.0 CHANGELOG entry). `255-SECURITY.md`: 0 open threats. Recorded deviation from SC-1's wording: four arms (`okx/bybit/deribit-null-plain`, `okx-null-trunc`) were already GREEN on unmodified code through the Phase 232 bootstrap anchor and are kept as regression pins.
⭐ **FOUNDER DECISIONS 2026-11-27 (AskUserQuestion at the Phase 255 close; recorded here and in `255-CONTEXT.md`), verbatim:**
- For `[255-OKX-PAGER-BACKFILL]`: **"Re-read now (Recommended)"**. The affected OKX strategies' full available history is re-read now through the product's own path. The backfill is done outside this phase, and its result is recorded in a later commit on the records branch. ⭐ **Result:** the backfill ran 2026-11-27 about 16:00Z on PROD through the product's own path. No cursor reset was needed: all three strategies' fills cursors and newest stored fills were already older than the OKX begin floor, and no re-read bound row existed, so the queued read's seed was clamped to the floor (`okx_fills_reach_clamped`) and walked the whole reachable span. One `sync_trades` job per strategy was enqueued through `enqueue_compute_job`, as the wizard does, after confirming the analytics service runs `2fda7ab31` or later on Railway. All three `sync_trades` jobs ended `done`, with no `sync_truncated_*` or `phase2_fill_ingestion_failed` flag and no bound row left. Stored OKX ETHUSDTSWAP fills: 100 -> 1182, 106 -> 1188 and 200 -> 1282 (total fills 3316 -> 4409, 106 -> 1199, 200 -> 1293), now running to 2026-11-20, so every read paged far past one 100-row page. The fills stored before Phase 255 all predate the floor (the newest was 2026-08-19), so the spans the one-page pager dropped before then are outside `fills-history`'s reach and were NOT recovered; only the OKX archive endpoint could reach them. No headline figure moved: each chained `derive_broker_dailies` ended `failed_final` with `realized read incomplete (daily_pnl_non_usd_okx)`, the same refusal every daily derive of these strategies has hit since at least 2026-11-25 (owned by Phase 256 OKXUNITSWITCH), so `strategy_analytics.computed_at` and its metrics are unchanged. The same Phase-1 refusal holds `last_fetched_trade_timestamp`, so later reads re-walk from the floor and the unique index absorbs the overlap. The entry is deleted from `TODOS.md`.
- For `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` and `[255-BYBIT-DEADLINE-NO-PROGRESS]`: **"Fix both in a follow-up (Recommended)"**. Both are owned by Phase 257 SEEDHOLD.
- `[255-OKX-BEGIN-REACH-PROBE]` has no ruling yet and stays booked in `TODOS.md`.


### Phase 256: OKXUNITSWITCH — an OKX account that moves from USDT into a coin is reported in USD up to the switch and in that coin after it, on every surface, and its frozen derives recover

**Goal:** An OKX account whose P&L was in USDT and which then moves into a coin is reported in USD up to the switch and in that coin after it, on every surface, and the derives that fail today end `done` and unfreeze the strategies they hold. No reader supports a series that changes unit today: the native-unit machinery (`services/account_unit.py`, `api_key_nav_marks.native_unit`, the BTCUSDVIEW USD view in `services/native_to_usd.py`, `benchmark.read_btc_closes`) gives one unit per key for its whole history.
- **Founder ruling 2026-11-27 (AskUserQuestion), verbatim: "USD before 11-15, BTC after".** It picked option C of four (A: stay in USD and convert each BTC bill at the day's close; B: BTC for the whole history; C: USD before the switch and the coin after; D: keep the refusal). The date 11-15 is the founder's reading of this one account, and the phase derives it from data.
- **What is failing (measured read-only on PROD 2026-11-27, no ids recorded here).** One OKX account, stored as 4 keys, has ended 7 derive jobs `failed_final` every night since 2026-11-24 (4 key-mode and 3 strategy-mode), `error_kind=permanent`, `realized read incomplete (daily_pnl_non_usd_okx)`. Its 3 strategies are frozen at their last good figures (`read_refusal_kept_figures`). Every night from 11-16 to 11-24 those jobs ended `done`.
- **Cause.** Phase 232-03's VREAD-06 refusal, in the OKX branch of `fetch_daily_pnl` in `analytics-service/services/exchange.py`, trips on 11 bills with `ccy=BTC` and a non-zero `pnl + fee` (the census read `{'BTC': 11}` of about 1300 bills; every other bill is USDT or zero). They are most likely the fees, charged in BTC, on the spot BTC-USDT buys of 11-15 and 11-21. That is inferred from holdings and dates, not proven from a raw bill, because no bill is stored. 232-CONTEXT Q3 recorded this exact case as a known refusal. ⛔ **CORRECTED 2026-11-27 (Phase 256 research):** the buy days by UTC bill timestamp are 2026-11-14 and 2026-11-20; 2026-11-15 and 2026-11-21 are the holdings asof labels, which describe the end of the previous UTC day. The derived switch is: last USD return day 2026-11-14, first BTC return day 2026-11-15, which is the founder's "USD before 11-15, BTC after". The "11-15 and 11-21" wording above is kept as lineage; `232-CONTEXT.md` carries the same correction. ⛔ CORRECTED 2026-11-27 (founder rulings on review findings CR-01 and R2-01, "≥95% coin and stays (Recommended)"): the switch is now the first day the coin is at least 95% of account value and stays so, so the derived switch is last USD return day 2026-11-20, first BTC return day 2026-11-21. The 11-14/11-15 reading in this sentence is kept as lineage.
- **History.** A USDT-margined ETHUSDT swap from May to 11-12, an all-USDT account on 11-13 and 11-14, then spot BTC buys. About 99.7% of its value is BTC today.
- **The part this phase reverses.** 232-03's VREAD-06 refuses any non-stable `ccy` by name with no price source. For a coin the account has switched into, this phase books the bills in that coin's segment instead of refusing. Other coins that appear with no switch still refuse by name.
- **Not the fix.** Re-reporting the key in BTC for its whole history (option B), converting each BTC bill to USD at a daily close while keeping one USD series (option A), or raising or removing the refusal. The founder chose a two-unit series.
- **Founder answers 2026-11-27 (AskUserQuestion, during discuss), verbatim option labels:** headline KPIs "Whole record in USD (Recommended)" (full history in USD, the BTC segment converted at each day's BTCUSDVIEW close, passing the total-record KPI gate, with a note naming the switch); charts "One chart, marked switch (Recommended)"; composites, allocator books and the USD view "USD, BTC part converted (Recommended)" (consistent with 164.6.6.2 D-13/D-15); copy "In USD to 14 Nov, in BTC from 15 Nov" wherever the unit appears, built from the derived switch date. Recorded in `256-CONTEXT.md`.
- **Founder ruling 2026-11-27 on review finding CR-01, verbatim: "Move switch to coin majority".** The switch day is the first day the coin is the clear majority and stays so (2026-11-21 for this account, not 11-15). Mixed days before it are reported in USD, with transition fee bills valued at their day's close; an account with no persistent majority yet refuses by name. The copy dates come from the computed switch day. This supersedes the 11-15 reading for this account. Recorded in `256-CONTEXT.md`.
- **Founder ruling 2026-11-27 on review finding R2-01, verbatim choice: "≥95% coin and stays (Recommended)".** It supersedes the "coin majority" wording above: the switch day is the first day the coin is at least 95% of account value and stays so (11-21 for this account, since a plain majority would give 11-15 on the measured 75% BTC). 11-15 to 11-20 are USD days at true values, and the copy reads "In USD to Nov 20, 2026, in BTC from Nov 21, 2026". Recorded in `256-CONTEXT.md`.
- **Founder rulings 2026-11-27 after review round 3, verbatim choices:** R3-03 "<50% for 7 days (Recommended)" (95% decides only when the switch happens; a switch back needs 7 consecutive days under 50%), and the survivors "Book a follow-up phase (Recommended)" (R3-01, SF3-02, SF3-03, R3-06 fixed before ship; R3-02, R3-04, R3-05, R3-07, SF3-01 booked as one v1.23 follow-up phase). Recorded in `256-CONTEXT.md`.
**Requirements**: TBD
**Depends on:** nothing hard. It re-bases on whichever of 229 and 233 (the S1 derive writer and its key-mode exits), 235 and 236 merged last, and on Phase 232's `daily_pnl_non_usd_okx` seam. Research first: the raw OKX bills for the account (read through the venue API docs as well as the stored rows, per the standing OKX rule), which settles whether the 11 bills are the spot fees.
**Success Criteria** (what must be TRUE):
1. The switch date is derived from data, never hard-coded for this account: the first day on which the account's value or P&L is denominated in a coin other than its stable unit, read from stored bills, holdings or fills. A test feeds two differently shaped accounts with different switch dates and gets each one's own date. For the founder's account the derived date matches his 11-15 reading, recorded in the plan SUMMARY, and a missing or ambiguous date refuses by a named reason rather than guessing.
2. A two-unit series is stored with each segment's unit named (USD up to the switch, the coin from the switch), and a design is chosen and recorded for where that lives (the `api_key_nav_marks` and `account_unit` seam, and the strategy and composite readers). The boundary day is carried once, in one unit, with no day double-counted and no day dropped.
3. Every reader handles the boundary without inventing data: the factsheet, the KPIs, the charts, composites, allocator books and the USD view. Each states its rule for a series that switches unit. A figure that would need a cross-unit return, volatility, drawdown or correlation across the boundary is either computed per segment and labelled, or withheld by name, never computed on a mixed series. Each reader has a test that is RED on `origin/main` today.
4. The BTC fee bills are booked in the BTC segment. The 11 bills no longer trip `daily_pnl_non_usd_okx` for this account, and an account that never switches, and any other coin with no switch, still refuses by name (a test pins both).
5. The 7 nightly failures end `done` after the fix is deployed and the account's 3 strategies unfreeze, read from PROD with the marker query first and no ids written into tracked text. `read_refusal_kept_figures` clears, and the next nightly derive confirms it.
6. The reversal of part of 232-03's VREAD-06 is recorded with its reason, in `232-CONTEXT.md` and here in the ROADMAP, per the deviation policy.
7. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY. A migration, if the design needs one, passes migration-reviewer and rls-policy-auditor with no MEDIUM+ finding, in the one serial migration lane.
**Plans:** 10/10 plans complete

Plans:
- [x] 256-01-PLAN.md — SWITCH: pure `derive_unit_switch` (date from bills and holdings, named refusals) and the per-day P&L split at the switch
- [x] 256-02-PLAN.md — MIGRATION: nullable jsonb `strategy_analytics.unit_segments` with an object CHECK, SQL test, migration lane review; ships alone first
- [x] 256-03-PLAN.md — FETCH: optional `unit_switch` resolver on the OKX bills read, coin side channel, live ccy share; every other caller keeps refusing
- [x] 256-04-PLAN.md — SERIES: two-segment builder (coin reconstructed in BTC, converted at the daily close) giving one whole-history USD headline
- [x] 256-05-PLAN.md — PRESENT-TEXT: parser and composer, payload fields, masthead switch sentence, KPI note, cache bump
- [x] 256-06-PLAN.md — DERIVE-STRATEGY: strategy-mode derive ends done with the USD headline, `unit_switch` flag and `unit_segments`; runner carry
- [x] 256-07-PLAN.md — PRESENT-CHART: one cumulative chart with two native segments and a real break; leverage held at 1x
- [x] 256-08-PLAN.md — PRESENT-LIST: list chip, OG note, returns API fields, pins for unchanged TS readers
- [x] 256-09-PLAN.md — DERIVE-KEY: key-mode derive ends done, key_inputs in USD with additive `unit_segments`; RED-on-main tests for every Python reader
- [x] 256-10-PLAN.md — CLOSE: SC-6 date correction in 232-CONTEXT and the ROADMAP, PROOF-01 index, two-PR ship order, post-deploy SC-5 PROD read

### Phase 257: SEEDHOLD — a down re-read bound cannot move a strategy's seed past an unrecorded span, and a Bybit fills read that hits its deadline records what it read

**Goal:** Two survivors of Phase 255 NULLANCHOR's review are fixed together, because both leave the next run's seed past (or back at) a span the bound does not record:
- **Hold the seed while the bound RPC is down.** While `set_strategy_fills_reread_bound` is unavailable, `cron_sync` (`routers/cron.py`) and `/fetch-trades` (`routers/exchange.py`) can still store daily rows past an unread span, so the next run seeds at `min(column, daily high-water)` past it. The cron must not move a strategy's seed past a span no bound records. This is `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`, reachable today on OKX, Bybit and Deribit keys (PROD holds all three) during an outage of the RPC. Phase 255 research rated the worker-only fail-closed fix not small, because refusing Phase 2 in the worker does not stop `cron_sync` moving the daily high-water.
- **A Bybit deadline records what it read.** A Bybit fills read that hits its deadline (`BybitTradeWindowIncomplete("deadline")`) records a read-through mark the way Binance does, at the last complete 7-day window, so the next run continues from there instead of re-reading the same span from the same seed. This is `[255-BYBIT-DEADLINE-NO-PROGRESS]`: today each refusal also lowers the bound by the 1 h overlap.
- **Founder ruling 2026-11-27 (AskUserQuestion), verbatim: "Fix both in a follow-up (Recommended)".** Booked with `/gsd-phase` add and placed in v1.23 HARDEN by hand, as 254 to 256 were.
**Requirements**: none mapped (routed review survivors from Phase 255: `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`, `[255-BYBIT-DEADLINE-NO-PROGRESS]`)
**Depends on:** Phase 255 NULLANCHOR (shipped as v0.133.104.0; its bound extension, `_bound_read` gating and Bybit remaining-budget deadline are what this phase corrects). Plans list their write scope by symbol, because `run_sync_trades_job` is shared with other phases.
**Success Criteria** (what must be TRUE):
1. A two-run arm in which a cron-stored daily row lands between a run whose bound write failed and a run after the RPC recovered: run 2's walk start is at or before run 1's seed, for each of Binance, OKX, Bybit and Deribit. The arm is RED on `origin/main` today.
2. A two-run arm in which a deadline-stopped Bybit read advances the next run's walk start past the windows it completed, and the bound does not creep down by the overlap on each refusal. RED on `origin/main` today.
3. Binance's read-through behaviour, Phase 255's SC-1 matrix and `advance_sync_cursor`'s callers do not regress, and a test pins that.
4. The `TODOS.md` entries `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` and `[255-BYBIT-DEADLINE-NO-PROGRESS]` are deleted in the ship PR and named in its CHANGELOG entry.
5. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first. It is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Phase 258: REDUMPDIRECT — after a PROD migration apply, the baseline re-dump commits straight to main with no PR and no approval

**Goal:** After a PROD migration apply, the gated baseline re-dump reaches `main` with no pull request and no human click. Today `.github/workflows/supabase-migrate.yml` job `redump-pr` opens a bot PR on `automation/baseline-redump` with the job token, so GitHub holds that PR's CI in an approval-required state until a human approves the runs and then merges it. After this phase, once the gated `redump-dump` job succeeds, the workflow composes the same commit it composes today (baseline.sql, baseline-carried-migrations.txt, BASELINE.md, the VERSION and package.json patch bump and its CHANGELOG entry) onto the current `main` and pushes it straight to `main`.
- **Founder ruling 2026-11-27, verbatim answer to the choice "Bot token / Claude allow rule / Push to main directly": "Push to main directly".** The founder also said: "So stupid that I have to approve the baseline redump. I want it to be approved or just that no approval is needed."
- **⛔ DEVIATION RECORD (global deviation policy).** This overrides 164.9.5 AUTOREDUMP decision **D-13** (a human reviews and merges every re-dump; nothing in the workflow merges it) and **D-23** (the bot PR's runs wait in an approval-required state and a human approves them). Reason: the founder's ruling above. The same override and its reason are recorded in `258-CONTEXT.md`.
- **CI-only.** No migration, no app code, no analytics code. It counts outside the in-flight phase cap.
**Requirements**: none (CI-only; no REQUIREMENTS.md id)
**Depends on:** nothing. Re-bases on the current `supabase-migrate.yml` and `scripts/baseline-redump.mjs` from 164.9.5 AUTOREDUMP.
**Success Criteria** (what must be TRUE):
1. After a succeeded `redump-dump` whose dump changed, the workflow pushes exactly one bot commit to `refs/heads/main` with a plain (never forced) push, carrying exactly the six paths the bot PR carries today. No PR is opened or edited, and nothing waits on a human.
2. A push refused because `main` moved is retried by re-composing onto the fresh `main`, never by force. After a bounded number of tries the job fails red, naming the cause. Any other push failure fails at once.
3. `VERSION` and `package.json` stay byte-equal 4-digit strings in the pushed commit.
4. The wiring tests that pin today's `redump-pr` job (`src/__tests__/baseline-redump-wiring.test.ts`, `src/__tests__/critical-regressions.test.ts`, `src/__tests__/supabase-migrate-test-first.test.ts`) pin the single push refspec to `main` instead, and each new pin goes RED under a neutered copy and GREEN once restored from a byte backup (PROOF-01).
5. `258-CONTEXT.md` states what a GITHUB_TOKEN push to `main` means: it starts no workflow, so the bot commit carries no CI run, and the Railway API service, which waits for CI, deploys a commit with no checks. The choice made about that is stated and deliberate.
6. No skip-CI token appears in any commit message, PR body or prose. No AI attribution lines. Nothing under `.planning/` is on the ship branch.
**Plans:** 3/3 plans complete

Plans:
- [x] 258-01-PLAN.md — tracer: the `--compose-and-push` mode, `PUSH_ARGV` and the `redump-push` job with the wiring pins retargeted; then the bounded re-compose retry (SC-1 to SC-4)
- [x] 258-02-PLAN.md — delete the bot-branch and PR machinery by symbol, the redump-dump no-op notice, and the text the bot writes names redump-push (D-11, D-12, D-24 retired)
- [x] 258-03-PLAN.md — dated lineage notes in the workflow, BASELINE.md and two comments, then the phase gate on the merged tree (SC-5, SC-6)

### Phase 260: CIHEADROOM — ci.yml sits well under GitHub's workflow file size limit, and a gate outside ci.yml fails a PR when any workflow file nears it

**Goal:** `.github/workflows/ci.yml` sits well under GitHub's workflow file size limit with real headroom, and a gate that runs outside `ci.yml` fails a PR loudly when any workflow file nears that limit.
- **Why.** Measured by the Phase 243 agent on 2026-11-27: main's `ci.yml` is 511,509 bytes. PR #1405 at 512,355 bytes got a CI run that failed at startup with zero jobs ("workflow file issue") on two pushes; at 511,664 bytes CI started normally. The limit is therefore consistent with 512,000 bytes. A PR that grows `ci.yml` by more than about 300 bytes silently gets no CI run, and the board then shows only the non-CI checks (the CLAUDE.md "count the checks" trap).
- **Where the bytes are (measured at `da98acd39`).** 236,643 bytes of YAML comments, 128,570 bytes of shell comments inside `run:` blocks, 102,304 bytes of shell code, 41,660 bytes of other YAML. Two `run:` bodies hold 129 KB: `sql-tests`' "Run SQL self-tests against the local-stack lane" (about 88.7 KB) and `sql-mutation`'s "Assert the run PRINTED its coverage and cleared both floors" (about 40.4 KB, copied byte-equal into `sql-mutation-nightly.yml`). Neither uses a `${{ }}` expression in its body.
- **Coordination.** Phase 243 PR #1405 edits the `sql-tests` step's `SENTINEL_FLOOR`/`ARMS_FLOOR`, and Phase 258 edits `supabase-migrate.yml`. This phase rebases over them.
**Requirements**: none mapped (CI-only; outside the in-flight phase cap)
**Depends on:** nothing.
**Success Criteria** (what must be TRUE):
1. `ci.yml` is well under 512,000 bytes, with headroom measured in tens of kilobytes, reached with the fewest moving parts: its long YAML-level rationale comments move verbatim to `docs/ci-yml-notes.md`, one section per job, with a one-line pointer left where each stood, so no executed YAML changes. ⛔ DEVIATION 2026-11-27 (main-session direction, recorded here and in `260-CONTEXT.md`): this criterion first read "long inline `run:` bodies moved into checked-in scripts the step calls"; moving comments was chosen instead after measuring that removing every YAML-level comment fails no test that reads `ci.yml`, while the script move breaks about 70 tests in 6 files.
2. A gate in its own workflow, not in `ci.yml`, fails a PR loudly when any `.github/workflows/*.yml` file passes a ceiling set a margin below 512,000 bytes, and it still runs when `ci.yml` itself is the oversized file. The gate proves it can fail on a red fixture.
3. Every existing test that reads `ci.yml` text keeps passing, or follows the moved code to its new file, and still fails when the behaviour it pins changes.
4. The `frontend` aggregator's `needs:` list and result loop, and every job name that branch protection or another workflow references, stay identical.
**Plans:** 1 plan

Plans:
- [x] 260-01-PLAN.md — the size gate in its own workflow (`scripts/check-workflow-size.mjs`, `workflow-size.yml`, ceiling 460,800, proven RED on the unshrunk `ci.yml`), then the 24 long YAML-level comment blocks moved verbatim to `docs/ci-yml-notes.md` behind pointer comments (`ci.yml` to about 406.6 KB, move proven lossless), and the two prose readers repointed

### Phase 261: UNITSWITCHEDGES — the edge shapes OKXUNITSWITCH routed: a re-pointed key, a first mark on a mixed day, a pre-mark deposit, keys with no early mark, and bills ageing out

**Goal:** The five unit-switch survivors of Phase 256 OKXUNITSWITCH review round 3 (`256-REVIEW.md` round 3) are fixed. None affects the founder's switched OKX account at Phase 256's ship:
- **R3-02:** a switched strategy re-pointed to a new key on the same OKX account (OKX has no in-place key rotation) keeps its stored switch instead of refusing (`ambiguous_boundary` / `bills_precede_majority_beyond_tolerance`) or, once the coin bills leave the 93-day window, silently losing it. The stored record binds to the exchange account, not the key.
- **R3-04:** a first NAV mark that falls on a mixed (USD-segment) day is not read as 0%.
- **R3-05:** a deposit made before the first mark does not skew every earlier USD return.
- **R3-07:** keys with no mark before the coin either fix or name the rescale of earlier USD returns (flagged, and named in key mode).
- **SF3-01:** the mixed-day withholding survives the coin bills ageing out of the bills window for keys without marks (persist the mixed-from day in the stored record).
- **Founder ruling 2026-11-27 (AskUserQuestion), verbatim: "Book a follow-up phase (Recommended)".** Booked with `/gsd-phase` add and placed in v1.23 HARDEN by hand, as 254 to 257 were.
**Requirements**: none mapped (routed review survivors from Phase 256)
**Depends on:** Phase 256 OKXUNITSWITCH (its unit-switch seam, `unit_segments` record and marks-anchored USD run are what this phase corrects)
**Success Criteria** (what must be TRUE):
1. Each of R3-02, R3-04, R3-05, R3-07 and SF3-01 has a test RED on the Phase 256 code and GREEN after the fix.
2. The founder's switched account's figures do not move (a pinned regression arm on the measured shape).
3. PROOF-01: each gate above goes RED on pre-fix code or a neutered copy with its named arm first, is restored from a byte backup (`cp` back, `cmp`) and goes GREEN, recorded verbatim in the plan SUMMARY.
**Plans:** 0 plans

Plans:
- [ ] TBD — plans not listed yet

### Progress (HARDEN)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155.2. LIVEPARITY | 13/17 | In progress | - |
| 157. FOUNDER-CONFIRM | 1/3 | In progress | - |
| 221. SENTRYSCRUB2 | 0/? | Planned for v1.23 | - |
| 224. DEADLEFTOVERS | 0/? | Planned for v1.23 | - |
| 242. SECRETSHYGIENE | 6/6 | Complete | 2026-11-27 |
| 243. DBBACKSTOP | 10/10 | Complete | 2026-11-28 |
| 244. ACCESSGUARDS | 4/4 | Complete (shipped v0.133.102.0, #1391; verification passed, SC-1 met as narrowed by founder decision 2026-11-27; SECURITY 0 open) | 2026-11-27 |
| 245. ALERTPAGE | 0/? | Planned for v1.23 | - |
| 246. ALERTREADERS | 0/? | Planned for v1.23 | - |
| 247. SENTRYHELD | 0/? | Planned for v1.23 | - |
| 248. SQLGATES2 | 0/? | Planned for v1.23 | - |
| 249. TESTLANES | 0/? | Planned for v1.23 | - |
| 254. OPENINGDEPOSIT | 1/1 | Complete (shipped v0.133.109.0, #1407; verification passed 4/4, SECURITY 8/8 closed; the one PROD book's `out_of_window_flow` clears on its next daily derive) | 2026-11-27 |
| 255. NULLANCHOR | 3/3 | Complete (shipped v0.133.104.0, #1395; verification passed, SC-3 met at ship; SECURITY 0 open; founder rulings 2026-11-27: "Re-read now (Recommended)" for the OKX backfill, "Fix both in a follow-up (Recommended)" for 257 SEEDHOLD) | 2026-11-27 |
| 256. OKXUNITSWITCH | 10/10 | Complete (shipped PR-1 v0.133.108.0, #1402 at f7c80fb7, migration applied to TEST and PROD, re-dump #1406; PR-2 v0.133.112.0, #1411 at 647c595d); verification passed 2026-11-28 (SC-5 PROD read: 7 of 7 derives done, 3 strategies unfrozen, switch BTC 11-20/11-21 stored); chart-break visual UAT with the founder; SECURED, 0 open | 2026-11-28 |
| 257. SEEDHOLD | 0/? | Planned for v1.23 | - |
| 258. REDUMPDIRECT | 3/3 | Complete (shipped v0.133.111.0, #1408 at 66a4016e; verification passed 6/6, SECURED; the live direct push is proven by the first migration merge after it) | 2026-11-28 |
| 260. CIHEADROOM | 1/1 | Complete (shipped v0.133.113.0, #1414 at d0398d28; verification passed 4/4, SECURED 0 open; ci.yml 511,664 -> 406,613 bytes; deviation: comment move instead of script move) | 2026-11-28 |
| 261. UNITSWITCHEDGES | 0/? | Planned for v1.23 | - |

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
