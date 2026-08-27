---
phase: 164
slug: share-copy-link-always-works-and-never-discloses
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-26
---

# Phase 164 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

**Why this file exists and why it is late.** `workflow.nyquist_validation` is `true`, and
`164-RESEARCH.md` carries the `## Validation Architecture` section that step 5.5 keys on — so this
artifact was owed and was simply never written. It was not written for phase 163 either (whose
research also carries the section), nor for 161.1. Phases 158–162 all have one. The gate stopped
firing somewhere after 162 and nothing surfaced it. Founder ruling 2026-08-26: **regenerate**
rather than waive. Booked as `NYQ-01` in `TODOS.md` so the *mechanism* gets fixed, not just this
instance.

Seeded from `164-RESEARCH.md § Validation Architecture` and the five PLAN.md files at their
post-plan-checker state. No planner re-spawn was needed — step 5.5 is orchestrator work.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo-pinned; `vitest.config.ts` coverage thresholds are a blocking CI gate) + Playwright e2e + `supabase/tests/*.sql` via the `sql-tests` CI lane |
| **Config file** | `vitest.config.ts` · `playwright.config.ts` · `.github/workflows/ci.yml` (`sql-tests` job) |
| **Quick run command** | `npx vitest run <file>` |
| **Full suite command** | `npm run test` then `npm run lint` then `npm run typecheck` |
| **Estimated runtime** | quick ~20–60s · full vitest **~242s measured** (828 files / 13,000 tests, clean serialized run) |

⛔ **File-scoped runs cannot clear `src/__tests__/contracts/`** — those tests scan all of `src/`
globally, so even a comment can redden them and only the full suite is the arbiter.
⛔ **Full vitest must not share the box** with pytest/mypy — contention manufactures timeout
failures that read as regressions. Serialize: vitest → pytest → mypy.

---

## Sampling Rate

- **After every task commit:** the task's own `<automated>` command (file-scoped vitest + `tsc --noEmit`)
- **After every plan wave:** `npm run test` + `npm run lint` + `npm run typecheck`, serialized
- **Before `/gsd-verify-work`:** full suite green **and** `sql-tests` green on the PR
- **Max feedback latency:** ~60s per task; ~242s per wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 164-01-01 | 01 | 1 | SHARE-02 | Disclosure / id-keyed cache | Token lane lands in a module with no reach to the cached wrapper | unit + structural guard | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts && npx tsc --noEmit` | ✅ | ⬜ pending |
| 164-01-02 | 01 | 1 | SHARE-01 | Secret absence | Missing/short `SHARE_TOKEN_SECRET` fails LOUD at module load, never at first share | unit | `npx vitest run src/lib/strategy-share-token.test.ts src/__tests__/contracts/env-manifest.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 164-01-03 | 01 | 1 | SHARE-01, SHARE-02 | Enumeration / oracle | Bounded constant-time scan; every miss is a content-free 410 `no-store` | unit + route | `npx vitest run src/app/factsheet-share/[token]/page.test.tsx src/app/factsheet-share/gone/route.test.ts && npm run lint && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 164-02-01 | 02 | 1 | SHARE-01, SHARE-03 | Guard erosion | Phase-29 guard narrowed to the scenario spine and STILL bites a scenario-spine migration | unit + audit-law | `npx vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts src/__tests__/audit-coverage.test.ts && npx tsx scripts/dump-sql-functions.ts --check` | ✅ | ⬜ pending |
| 164-02-02 | 02 | 1 | SHARE-03 | Silent-skip (SKIP-01) | RLS + generation monotonicity asserted with **no pre-apply tolerance arm** | SQL (`sql-tests` lane) | **MISSING by design** — RED until the TEST hand-apply in 164-02-03; then the `sql-tests` CI lane is the runner | ❌ W0 | ⬜ pending |
| 164-02-03 | 02 | 1 | SHARE-03 | Prod auto-apply | Three reviewers → TEST hand-apply → `sql-tests` green, before any migration reaches main | **blocking-human checkpoint** | none — `gate="blocking-human"`, typed `<resume-signal>` required; `/gsd-execute-phase` cannot auto-approve past it | n/a | ⬜ pending |
| 164-03-01 | 03 | 2 | SHARE-01 | Non-owner mint | Mint-or-**reuse**: two mints in two sessions yield a byte-identical URL; non-owner 404s | route | `npx vitest run src/app/api/strategies/[id]/share/route.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 164-03-02 | 03 | 2 | SHARE-03 | Revoke non-atomicity | Atomic `generation+1`; double-revoke converges via 404, never an error | route + audit-law | `npx vitest run src/app/api/strategies/[id]/share/revoke/route.test.ts && npx vitest run src/__tests__/audit-coverage.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 164-04-01 | 04 | 2 | SHARE-01, SHARE-04 | Published-lane regression | Published Copy Link stays `/factsheet/<id>?share=1` **byte-identical** (D-09) | component + url-shape pin | `set -o pipefail; npx vitest run "src/app/factsheet/[id]/v2" --silent 2>&1 \| tail -20 && npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts && npx tsc --noEmit` | ✅ | ⬜ pending |
| 164-04-02 | 04 | 2 | SHARE-04 | Affordance dishonesty | ONE predicate at all three sites; no "Link copied!" for a link that cannot work | component | `set -o pipefail; npx vitest run src/components/strategy src/app/\(dashboard\)/strategies --silent 2>&1 \| tail -20 && npx tsc --noEmit` | ✅ | ⬜ pending |
| 164-04-03 | 04 | 2 | SHARE-04 | Recipient chrome leak | Recipient never sees a Copy-Link control that rebuilds the URL without the token | component | `set -o pipefail; npx vitest run "src/app/factsheet/[id]/v2" --silent 2>&1 \| tail -20` | ✅ | ⬜ pending |
| 164-05-01 | 05 | 2 | SHARE-02 | Token in telemetry | Sentry path scrub (net-new) strips the token from captured events | unit | `npx vitest run src/lib/scrub-share-path.test.ts src/instrumentation.test.ts && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 164-05-02 | 05 | 2 | SHARE-02 | Referrer / analytics leak | `no-referrer` per-route; Plausible exclusion; recipient analytics suppressed | unit + build | `set -o pipefail; npx vitest run src/app/layout src/app/factsheet/[id]/v2/factsheet-analytics --silent 2>&1 \| tail -15 && npm run build 2>&1 \| tail -5` | ✅ | ⬜ pending |
| 164-05-03 | 05 | 2 | SHARE-02 | **Cache poisoning** | ORDERED: after a token-lane render, anon `/factsheet/<id>` STILL 404s | acceptance (**RED-first**) | `npx vitest run "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx" src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | ❌ W0 | ⬜ pending |
| 164-06-01 | 06 | 2 | SHARE-03 | N1 / ceiling jump | Trigger forces `generation=1` on INSERT and bounds every UPDATE to +1 | SQL (real PG) + snapshot | `npx tsx scripts/dump-sql-functions.ts --check` — behaviour proven by `pg-harness/run.sh`, NOT by a vitest file | ✅ | ✅ green (orchestrator re-ran 2026-08-28: ALL 106 ARMS, `{1,1,2,2,2,3}`, N1 repro now rejected at step 2) |
| 164-06-02 | 06 | 2 | SHARE-03 | Silent-skip / vacuity | 5 new arms, each OBSERVED red under its own RED-UNDER; floors re-derived PRE-EDIT in the same diff | contract + SQL gate | `set -o pipefail; npx vitest run src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts 2>&1 \| tail -20` | ✅ | ✅ green (18/18; floors 106/169/8; snapshot clean) |
| 164-06-03 | 06 | 2 | SHARE-03 | Prod auto-apply | Harness run → three reviewers (execution status declared) → TEST hand-apply → `sql-tests` green | **blocking-human checkpoint** | none — `gate="blocking-human"`, typed `<resume-signal>` required | n/a | ⬜ pending |
| 164-07-01 | 07 | 2 | SHARE-02 | F6 / cache reach | No module in the builder's 38-module transitive closure imports `next/cache`; walker proven non-vacuous by a size floor + an alias assertion | structural guard (**RED-first**, planted import in a DEEP dep) | `set -o pipefail; npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts 2>&1 \| tail -20` | ✅ | ⬜ pending |
| 164-07-02 | 07 | 2 | SHARE-02 | Unenforced claim in prose | Builder docblock CITES the guard instead of asserting the absence | contract suite (a comment alone can redden `contracts/`) | `set -o pipefail; npx vitest run src/__tests__/contracts 2>&1 \| tail -20` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/strategy-share-token.test.ts` — HMAC vectors, namespace pin, determinism (SHARE-01)
- [ ] `src/app/factsheet-share/[token]/page.test.tsx` — recipient render + miss→410 (SHARE-01/02)
- [ ] `src/app/factsheet-share/gone/route.test.ts` — genuine 410, `no-store`, content-free (SHARE-03)
- [ ] `supabase/tests/test_strategy_shares_rls.sql` — RLS + generation monotonicity, **no tolerance arm** (SHARE-03)
- [ ] `src/app/api/strategies/[id]/share/route.test.ts` + `…/revoke/route.test.ts` (SHARE-01/03)
- [ ] `src/lib/scrub-share-path.test.ts` — Sentry scrub, net-new, no analog (SHARE-02)
- [ ] `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` — the ORDERED adversarial spec (SHARE-02)
- [ ] token-lane rows added to `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — **extend, do not fork**

*Framework install: none — vitest, Playwright and the `sql-tests` lane all already exist.*

⭐ **Added 2026-08-27 for plan 06.** Its behavioural oracle is **not** a vitest file — it is
`pg-harness/run.sh`, a throwaway PostgreSQL cluster (`PROC-01`). That is deliberate: N1 is a
trigger/privilege defect that no TypeScript test can observe, and the phase already proved that
prose in an `<automated>` block is not a command. ⚠️ This plan was authored by the orchestrator
rather than by `gsd-planner`, because `/gsd-plan-phase 164` replans the WHOLE phase and 164-01/02
are already executed with SUMMARYs on disk. The step-5.5 rows above are the gate that would
otherwise have been skipped — see `NYQ-01`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sentry scrub holds on a **real** captured event | SHARE-02 | CI has no live Sentry ingest; a mocked `beforeSend` cannot prove the deployed pipeline scrubs | After deploy, trigger a handled error on `/factsheet-share/<token>`, open the event in Sentry, confirm no token substring in path/URL/breadcrumbs |
| Analytics network check | SHARE-02 | Requires a real browser against a real Plausible endpoint | Load a token URL with devtools open; confirm no request carries the token path |
| 410 URL-bar hop | SHARE-03 | Cosmetic, by design (App Router pages cannot emit 410) | Open a revoked token; confirm final status 410 and that landing on `/factsheet-share/gone` is acceptable — **design, not a bug** |
| Three reviewers + TEST hand-apply | SHARE-03 | Human gate by project law: `supabase/migrations/**` merging to main AUTO-APPLIES to PRODUCTION | 164-02 Task 3 `<resume-signal>` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — the single `MISSING`
      (164-02-02) is deliberate SKIP-01 design, gated by the blocking human checkpoint in the
      same plan; the honest alternative was a permanently-silent tolerance arm
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — the longest gap is
      **2** (164-02-02 MISSING, 164-02-03 checkpoint), immediately followed by 164-03-01
- [ ] Wave 0 covers all MISSING references — 8 files listed above, none written yet
- [x] No watch-mode flags — verified across all 5 plans
- [x] Feedback latency < 300s — full vitest measured 242s
- [ ] `nyquist_compliant: true` set in frontmatter

**Checks 8a–8d were run in substance by `gsd-plan-checker` (2026-08-26) against plan content and
PASS.** The frontmatter stays `draft` / `nyquist_compliant: false` because the lifecycle assigns
that flip to `validate-phase §6`, and because flipping it here would be the orchestrator signing
off its own artifact. Wave 0 is genuinely incomplete — that box is unticked because it is untrue,
not as a formality.

⛔ **ORCHESTRATOR-OWNED FILE (2026-08-27).** Plans 06 and 07 run concurrently and both once
listed this file in `files_modified` — a shared write target for two agents that share the git
index. Their rows are already written above; executors must NOT edit this file. The orchestrator
flips the Status column after the wave.

**Approval:** pending
