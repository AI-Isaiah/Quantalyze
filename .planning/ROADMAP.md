# Roadmap: Quantalyze

## Milestones

- ✅ **v1.21 UX — trustworthy, navigable, lean** — Phases 192–206 (shipped 2026-11-13)
- ✅ **v1.20 Backlog Burndown** — Phases 158–191 (shipped 2026-11-06)
- ✅ **v1.19 JOB/RATE** — Phases 143–146, 146.1, 146.2 (shipped 2026-08-20)
- ⏸️ **v1.18 MT5-VERIFY & founder confirmations** — Phases 155, 157 (parked, founder-gated)
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

## Parked Milestone: v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157) — founder-gated

**Goal:** The numbers Quantalyze renders for the live funded MT5 account are proven true against
the terminal's own figures — and the handful of observations only the founder can make are made.

⛔ **EVERY phase in this milestone is founder-gated. That is its defining property, not an
accident of sequencing.** Nothing here can be delivered by an agent. The milestone was created on
2026-08-14 so that the agent-deliverable work in v1.17 could close without waiting on a calendar.

**Blocked on, both required:**

1. ⛔ **New MT5 investor passwords.** The founder changed the account passwords on/around
   2026-08-14, so the stored credentials are stale and will not authenticate. MEASURED on PROD
   that day: three `mt5` keys exist (labels `FX-AI_V`, `MM2`, `MM3` — ⚠️ **there is NO key
   labelled `MM1`**, so the founder's "MM1 and MM2 are erroring" does not map 1:1 onto stored
   rows; **re-verify ALL THREE at reconnect**), all `disconnected_at IS NULL`, all
   `sync_status='complete'` with `last_sync_at` 04:01–04:07 UTC — those are the last *successful*
   syncs, taken **before** the change.
   ⛔ **When these flip to `error`, that is EXPECTED. Do not investigate it as a code defect.**

2. ⛔ **The founder physically at the MT5 terminal, on a TRADING day**, with the live funded
   account's read-only investor password. A demo account, the v1.15 soak account, or a weekend run
   does not satisfy it.

**Settled inputs — do not re-litigate:**

- Parity tolerance **1%, INCLUDING open P&L** (founder call 2026-08-14). Adjustable later; keep it
  a named test constant, never a hardcoded literal.

- ⭐ **The measurement window MUST end before the day of the run.** `broker_dailies` anchors to
  today — initial capital is derived as `current_equity − total_pnl` — so reconstruction error
  accrues *backward into the past*. Comparing today's equity is therefore near-tautological, and a
  historical window is the only one that can actually fail.

**Requirements:** MT5-06, MT5-07, MT5-08, MT5-09, MT5-10, MT5-15, MT5-GOAL-01 (umbrella acceptance)

⛔ **Do not advertise MT5 until Phase 155 passes.** Carried verbatim from v1.17.

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

⭐ **v1.21 UX — trustworthy, navigable, lean — CLOSED 2026-11-13** (audit `tech_debt`, 32/32). The next milestone is not started (`/gsd-new-milestone`); it carries the composer range-as-dates fix and TERMS-01/02.

⭐ **v1.20 Backlog Burndown — CLOSED 2026-11-06.** Its Phase 188 SC-4 residual (D-13) was closed by 202 RESIDCHURN and 203 B3TRUNC in v1.21.

⏸️ **v1.18 MT5-VERIFY & founder confirmations (Phases 155, 157)** — PARKED, founder-gated twice over: new MT5 investor passwords AND the founder at the terminal on a trading day. Phase numbers 155 and 157 stay reserved.

---

_Shipped milestone details: `.planning/MILESTONES.md` + `.planning/milestones/`._
