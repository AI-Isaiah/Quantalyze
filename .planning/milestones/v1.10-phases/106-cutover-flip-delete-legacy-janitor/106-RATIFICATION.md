# Phase 106 — Stage-A Ratification Record

**Statement of record:** Stage A is a **RATIFICATION, not a flip.** Prod has run the
unified backbone path since **2026-05-25**; the legacy `compute_analytics` dark path is
**48+ days cold** as of 2026-07-14 (0 invocations in 30 days; 45 all-time, last 48 days
ago — per CONTEXT prod-state audit). This document is the written pin every later Stage-B
deletion points at.

Ratified: 2026-07-14 (plan 106-01, Wave 1).

## The three cutover flags — values, location, verification method

| Flag | Location | Pinned value | Verification (2026-07-14) |
|------|----------|--------------|----------------------------|
| `USE_COMPUTE_JOBS_QUEUE` | Vercel (Production) | `"true"` | CLI `vercel env ls production` — **exists**, added 76d ago (encrypted, names-only). Value `"true"` per CONTEXT CLI-resolution 2026-07-14. |
| `PROCESS_KEY_UNIFIED_BACKBONE` | Vercel (Production) + Railway worker | `"on"` | Vercel CLI — **exists**, added 50d ago (≈2026-05-25, matches kill-switch-row flip). Railway `railway variables` (quantalyze-analytics/production) — **`on`** (value visible). |
| `BROKER_DAILIES_VIA_FUNDING` | Railway worker (code default) | **unset → code default `true`** | Railway `railway variables` — **absent** from the analytics worker env → `job_worker.py:186` default `"true"` applies. |

Live-env evidence method: read-only CLI listing. Vercel cannot print encrypted values, so
Vercel evidence = existence + age + CONTEXT resolution. Railway prints plaintext, so
`PROCESS_KEY_UNIFIED_BACKBONE=on` and the *absence* of `BROKER_DAILIES_VIA_FUNDING` are
directly observed. No secret values were copied into this doc.

## Code-comparison greps (fully automated — all pass)

Verify gate: `RATIFY-GREPS-OK`.

- `analytics-service/services/job_worker.py:185-186` — `os.environ.get("BROKER_DAILIES_VIA_FUNDING", "true").lower() != "false"` (exactly 1 occurrence). Default `true`; only the literal `"false"` disables.
- `src/lib/feature-flags.ts:95` — `process.env.PROCESS_KEY_UNIFIED_BACKBONE === "on"` (env fallback).
- `analytics-service/services/feature_flags.py:142` — `os.getenv("PROCESS_KEY_UNIFIED_BACKBONE", "off") == "on"` (Python env fallback).
- `USE_COMPUTE_JOBS_QUEUE` TS readers — all compare `=== "true"` / `!== "true"`. Six live reader sites confirmed: `finalize-wizard/route.ts:890,:934`, `csv-finalize/route.ts:684,:1247`, `keys/sync/route.ts:183,:534` (plus doc/comment references). No drift from the CONTEXT anchor list.

## D6 wrong-money falsifier — CLOSED

`BROKER_DAILIES_VIA_FUNDING` unset → default `true` → the `compute_analytics` else-branch
(`job_worker.py:1520`, `cron.py:451`) is **NOT taken in prod**. Therefore deleting the
dark path in Stage B shifts **no funding numbers**. The only prod path is
`derive_broker_dailies`.

## Stage-B preconditions checklist (orchestrator/human gates — NOT executor tasks)

Stage B (plans 106-06…106-10, the irreversible deletions) must NOT start until ALL of:

- [ ] **(a) Explicit user go** — the user authorizes crossing the irreversibility boundary.
- [ ] **(b) Empirical prod query re-run == 0** — via Supabase MCP on prod project `khslejtfbuezsmvmtsdn` (executor has NO Supabase MCP; orchestrator/human step):
  `SELECT count(*) FROM compute_jobs WHERE kind='compute_analytics' AND created_at > now() - interval '30 days'` → must be `0`.
- [ ] **(c) Stage-A E2E gate approved** — plan 106-05's 11-point live surface all PASS + user "approved" (any FAIL blocks Stage B).
- [ ] Plus (per CONTEXT/memory): migration-reviewer + rls-auditor on 106-06's migration, test-project MCP catch-up before merge, and a documented `git revert` rollback statement for the deletion PR.

## Stage-A E2E gate result (plan 106-05 — the Stage-A exit gate)

**Status: DRAFTED, awaiting the live run.** Stage-A code is committed to the branch
(`gsd/v1.10-portfolio-intelligence-options-mtm`, `23bfca23..aaf54de7`; janitor reverted
`742cfb1c` → deferred to 106.1), full suite green (pytest 3732 / tsc 0 / lint 0 / vitest).
This gate is a **MANUAL/LIVE** surface on PROD — the executor cannot run it (no Supabase
MCP, no authed prod session). A prior flag flip exposed 2 latent CSV bugs that only live
E2E caught, so no cell is "obviously fine".

**Deploy precondition (why this can't run yet):** in this milestone the code lives on the
v1.10 branch and is NOT deployed to prod until the milestone ships. The live 11-point
surface therefore runs against prod only after the branch is merged + Railway/Vercel
deploy is confirmed. Until then this gate stays DRAFTED.

Prod: quantalyze.xyz (never .com). Authed QA: qa-demo@quantalyze.app. For each factsheet
cell, confirm it renders COMPLETE and UNCHANGED (KPIs + equity/drawdown/returns/rolling
charts + rail; no new gaps, no shifted numbers).

| # | Point | Expected | PASS/FAIL |
|---|-------|----------|-----------|
| 1 | CSV single-key — **cash** | factsheet byte-identical on unified path | ⬜ |
| 2 | CSV single-key — **MTM toggle** | MTM view renders, cash unchanged | ⬜ |
| 3 | ccxt single-key — **cash** | byte-identical | ⬜ |
| 4 | ccxt single-key — **MTM toggle** | MTM renders | ⬜ |
| 5 | Deribit single-key — **cash** | byte-identical (inverse-valuation intact) | ⬜ |
| 6 | Deribit single-key — **MTM toggle** | MTM renders | ⬜ |
| 7 | Composite (stitched) — **cash** | stitched factsheet byte-identical | ⬜ |
| 8 | Composite (stitched) — **MTM toggle** | MTM renders | ⬜ |
| 9 | Onboarding sync-teaser | scalars render; **nothing persisted** (105.1 preview-only exception intact) | ⬜ |
| 10 | Per-key allocator dashboard | blend/per-key reads render (`csv_daily_returns` per-key axis) | ⬜ |
| 11 | One RESYNC (broker key) | completes on unified path (`derive_broker_dailies`→`compute_analytics_from_csv`); factsheet refreshes; **NO `compute_jobs` row with kind='compute_analytics'** | ⬜ |

_(Point 12 "janitor spot-check" removed — the computing-janitor was reverted from
Stage A and deferred to 106.1; see 106-REVIEW / [[project_106_janitor_deferred_needs_transition_timestamp]].)_

**Approver:** _______  **Date:** _______

**Resume signal:** any FAIL blocks Stage B and routes to a fix plan. Type **"approved"**
(all PASS) to close Stage A and unlock Stage-B *consideration* (Stage B still additionally
requires explicit user go + the empirical `compute_analytics == 0` re-query).
