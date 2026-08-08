---
phase: 150
slug: own-03-the-wizard-asks-whose-capital-this-is
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-06
planned: 2026-08-06
closed: 2026-08-06
---

# Phase 150 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Filled at plan time (2026-08-06, revised same day per plan-check decisions B-1/B-2/B-3/B-4, review round 1 W-1..W-7; rev-2 same day: StrategyTable tag-gate blocker + review round 2 W-1..W-6; rev-3 same day: null-portfolio remedy blocker + review round 3 W-2 (MAGNITUDE_CAPS canonical in closed-sets, not lifted) + review round 3 W-3 (allocation cap = MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD, $1e9, on both tiers — keeps the approved "$1B sanity cap" copy true); rev-4 same day: the round-3 null-portfolio remedy REPLACED by lazy server-side real-portfolio provisioning in the allocation route (D-03-B, orchestrator decision 2026-08-06 — the remedy looped: /portfolios creates only is_test:true rows and NO is_test=false insert existed repo-wide, so SC 2 was unreachable for every allocator)); Status / Observed columns close during execution (Plan 08 Task 2).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (jsdom) + pgTAP (`supabase/tests/test_*.sql`, CI-discovered at `.github/workflows/ci.yml:1015-1017`) |
| **Config file** | `vitest.config.ts` (coverage thresholds 82/80/74/72 — blocking) |
| **Quick run command** | `npx vitest run <file> --no-file-parallelism` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick < 30s per file; full suite ~several min (sharded in CI) |

⚠️ `*_rls.test.ts` live-DB vitest NEVER runs in CI — every DB-tier assertion in this phase is pgTAP (MEMORY `reference_db_test_ci_wiring`).
⚠️ CI is Node 22, local is 25 — reproduce CI-only failures via `PATH=/opt/homebrew/opt/node@22/bin`.

---

## Sampling Rate

- **After every task commit:** the task's `<automated>` command + the collision-risk gates touched by that task's files (phase-147 / phase-148 / phase-149 / visibility / format-percent-contract — each runs in seconds)
- **After every plan wave:** `npm test` (full vitest)
- **Before `/gsd:verify-work`:** full suite + `npm run test:coverage` + `npx tsc --noEmit` + `npm run lint` green; pgTAP applied-and-green on TEST
- **Max feedback latency:** ~150 seconds

---

## Per-Task Verification Map

> **Status column, closed 2026-08-06 (Plan 08 Task 2).** Sources are named rather
> than blended. `✅ suite` = green in this session's FULL `npm test` +
> `npm run test:coverage` run, which executes every vitest command in the
> Automated Command column. `✅ TEST` = pgTAP/DB run by the ORCHESTRATOR against
> the TEST project (qmnijlgmdhviwzwfyzlc) — MCP tools are stripped from
> subagents (#13898), so no executor ran these; the evidence is the 150-01
> orchestrator close-out. The "File Exists" column records the PLAN-TIME fact and
> is left as written; every ❌ W0 file was created by its own plan and is now on
> disk (see the Wave 0 Requirements checklist below).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 150-01-01 | 01 | 1 | OWN-03 (D-03-A, D-04, D-13) | T-150-01/02/03/06/37 | INSERT (incl. upsert arm) blocked for team_review (unconditional) and self-owned non-own_capital; THIRD-PARTY inserts pass; alias UPDATE on legacy rows unharmed; flip is one txn | DB (pgTAP) | CI pgTAP run of `supabase/tests/test_capital_ownership_column.sql` + `test_capital_ownership_allocation_guard.sql`; pre-apply structural greps in-task | ❌ W0 (this task creates them) | ✅ TEST |
| 150-01-02 | 01 | 1 | OWN-03 | T-150-01/37 | migration applied to TEST before merge; pgTAP green AGAINST TEST | DB (pgTAP on TEST) + manual | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_capital_ownership_column.sql && psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_capital_ownership_allocation_guard.sql` (CI-loop shape, ci.yml:1024-1030) + information_schema queries pasted at checkpoint | n/a | ✅ TEST |
| 150-02-01 | 02 | 1 | OWN-03 | T-150-07 | single-source predicate; validator + formatUsd lifts behavior-identical | unit | `npx vitest run src/lib/capital-ownership.test.ts src/lib/dollar-validation.test.ts "src/app/api/strategies/finalize-wizard/route.test.ts" "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx" --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-02-02 | 02 | 1 | OWN-03 | T-150-08 | unknown mark never renders a trusted badge (null → nothing) | unit (RTL) | `npx vitest run src/components/strategy/OwnershipTag.test.tsx --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-02-03 | 02 | 1 | OWN-03 (D-01) | — | radio semantics; copy single-sourced; controlled, never null | unit (RTL) | `npx vitest run src/components/strategy/CapitalOwnershipRadioGroup.test.tsx --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-03-01 | 03 | 2 | OWN-03 (D-01, D-05..D-08, SC 1b) | — | cull render-only (payload deep-equal); asset-class hoist; question default (b) | unit (RTL) | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx" --no-file-parallelism` | ✅ extend | ✅ suite |
| 150-03-02 | 03 | 2 | OWN-03 (D-07, D-10) | T-150-12 | contribution-only render gate; no allocate-now affordance | unit + tsc | `npx tsc --noEmit && npx vitest run "src/app/(dashboard)/strategies/new/wizard" --no-file-parallelism` | ✅ | ✅ suite |
| 150-03-03 | 03 | 2 | OWN-03 (D-02, SC 2) | T-150-09/10/11 | closed-set 400 pre-RPC; owner-predicated post-RPC UPDATE; lost mark degrades to NULL, never a wizard error arm | route unit | `npx vitest run "src/app/api/strategies/finalize-wizard/route.test.ts" --no-file-parallelism` | ✅ extend | ✅ suite |
| 150-04-01 | 04 | 2 | OWN-03 (D-09, D-11, SC 2b) | T-150-13/16/17/18/19 | 404-not-ok-on-zero-rows; 409-until-confirmed flip; RPC-only removal | route unit | `npx vitest run "src/app/api/strategies/[id]/ownership/route.test.ts" --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-04-02 | 04 | 2 | OWN-05 (D-16, D-17, D-18) | T-150-13/14/15 | owner-only + private/draft server-side; reject-not-truncate; B10 clean | route unit | `npx vitest run "src/app/api/strategies/[id]/name/route.test.ts" src/lib/visibility.test.ts --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-05-01 | 05 | 2 | OWN-03 (D-13, D-14, D-03-B, SC 4) | T-150-21/22/23/24/26/40 | upsert-shaped with literal onConflict assertion; pre-checks 404/409; no current_weight; $1e9 MAX_TICKET_SIZE_USD cap (review round 3 W-3) enforced before token burn; rev-4 lazy provisioning: resolve auth.uid()+is_test=false → insert-on-absence (is_test:false + "Active Allocation" literals) → 23505 re-select-and-proceed; container-only, never auto-add | route unit | `npx vitest run "src/app/api/portfolio-strategies/allocation/route.test.ts" --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-05-02 | 05 | 2 | OWN-03 (D-12) | — | inline tenant gate; paired series select | static-analysis | `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts --no-file-parallelism` | ✅ | ✅ suite |
| 150-05-03 | 05 | 2 | OWN-03 + OWN-05 (D-12-A, D-12-B, D-15, SC 1c) | T-150-25 | UNION row set (marked ∪ positioned — no vanished money); allocate-affordance data own-capital-only; derived weight; honest nulls; owner name carve-out; B-3 back-compat slack marked; review round 2 W-1: positioned row with non-null current_weight yields weight null (legacy source dead) | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts" "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx" --no-file-parallelism` | ✅ extend | ✅ suite |
| 150-06-01 | 06 | 3 | OWN-03 + OWN-05 | T-150-28/30 | fetch-only writes; 409→confirm→confirmed-write arc; validation never disables CTA; shared formatUsd only (W-7) | unit (RTL) | `npx vitest run src/components/strategy/MarkOwnershipDialog.test.tsx src/components/strategy/RenameStrategyDialog.test.tsx --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-06-02 | 06 | 3 | OWN-03 (D-09) + OWN-05 | T-150-29/39 | 149 pins intact (esp. pin 7 window, pin 2 public negatives); rev-2 blocker: OwnershipTag gated on visibility === "owner-all-statuses" — public mount of a published+own_capital row renders NO tag; review round 2 W-6: AddToPortfolio 23514 → honest copy | structural + unit (RTL) | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts src/components/strategy/StrategyTable.visibility.test.tsx src/components/portfolio/AddToPortfolio.test.tsx --no-file-parallelism` | ✅ extend | ✅ suite |
| 150-06-03 | 06 | 3 | OWN-03 + OWN-05 (SC 1c) | T-150-27 | owner-lane-only render; nothing enters the cached payload; anon still 404s | structural + unit | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" --no-file-parallelism` | ✅ extend | ✅ suite |
| 150-07-01 | 07 | 3 | OWN-03 (D-12, D-12-A, D-12-B, D-15) | T-150-31/32/33 | render-derived UNSIGNED weight pinned + honest denominator tooltip; never-both-buttons; positions-but-unmarked rows render read-only; three arms in priority order | unit (RTL) | `npx vitest run "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx" src/__tests__/format-percent-contract.test.ts --no-file-parallelism` | ✅ extend | ✅ suite |
| 150-07-02 | 07 | 3 | OWN-03 (SC 2) | T-150-32/34 | inline validation, no fetch on invalid; share-of-allocated helper line (D-12-B supersedes the book-equity fallback); envelope on write failure | unit (RTL) | `npx vitest run "src/app/(dashboard)/allocations/components/AllocateDialog.test.tsx" --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-07-03 | 07 | 3 | OWN-03 (review round 1 W-6, B-3, rev-4) | — | server-fetch wiring, no client reads; getMyStrategies-count empty-arm discriminator; B-3 slack removed; rev-4: portfolio-null render opens the SAME functional amount dialog (no remedy modal, no client portfolio id) | tsc + tree | `npx tsc --noEmit && npx vitest run "src/app/(dashboard)/allocations" --no-file-parallelism` | ✅ | ✅ suite |
| 150-08-01 | 08 | 4 | OWN-03 (SC 2b, SC 3) | T-150-35/36 | eight mutation-proven pins (incl. D-03-A both-arms, union-affordance, and rev-2 P8 tag-gate pins); rot-guarded census | static-analysis | `npx vitest run src/__tests__/phase-150-capital-ownership-invariant.test.ts --no-file-parallelism` | ❌ W0 | ✅ suite |
| 150-08-02 | 08 | 4 | all | — | full surface green; ledger closed | regression | `npm test && npm run test:coverage && npx tsc --noEmit && npm run lint` | ✅ | ✅ suite |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Every box below verified present on disk 2026-08-06 (`ls`, Plan 08 Task 2).

- [x] `supabase/tests/test_capital_ownership_column.sql` — column shape (Plan 01 Task 1)
- [x] `supabase/tests/test_capital_ownership_allocation_guard.sql` — trigger (both D-03-A arms + third-party regression) + PK + flip RPC + legacy-alias regression (Plan 01 Task 1). Grew rev-2 cases 7d–7h and rev-3 case 7i.
- [x] **UNPLANNED, added by Plan 01 Deviation 4:** `supabase/tests/test_weight_snapshot_seed_secdef.sql` — the regression test for the four-month-old PRODUCTION defect (`SECURITY INVOKER` seed triggers writing to a deny-policy table) that this phase's positive control uncovered and repaired.
- [x] `src/lib/capital-ownership.test.ts`, `src/lib/dollar-validation.test.ts` — incl. formatUsd literal pins (Plan 02)
- [x] `src/components/strategy/OwnershipTag.test.tsx`, `CapitalOwnershipRadioGroup.test.tsx` (Plan 02)
- [x] `src/app/api/strategies/[id]/ownership/route.test.ts`, `.../name/route.test.ts` (Plan 04)
- [x] `src/app/api/portfolio-strategies/allocation/route.test.ts` (Plan 05)
- [x] `MarkOwnershipDialog.test.tsx`, `RenameStrategyDialog.test.tsx` (Plan 06), `AllocateDialog.test.tsx` (Plan 07)
- [x] `src/__tests__/phase-150-capital-ownership-invariant.test.ts` (Plan 08) — 15 pins, 979 lines, 6-mutation Rule-9 ledger
- [x] Framework install: none — Vitest, Playwright and pgTAP CI wiring all exist
- [x] `MetadataStep.test.tsx` EXISTS (research A4 corrected at plan time) — extend, not create
- [x] `HoldingsTable.strategy-rows.test.tsx` EXISTS — Plan 02 keeps it green through the formatUsd lift; Plan 05 makes the ONE review round 2 W-1 Weight-cell expectation update; Plan 07 extends it
- [x] `StrategyTable.visibility.test.tsx` EXISTS — Plan 06 extends with the public-mount no-tag negative case (rev-2 blocker)
- [x] `AddToPortfolio.test.tsx` EXISTS — Plan 06 extends with the 23514 → honest-copy mapping case (W-6)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration applied to TEST before merge | OWN-03 | MCP tools stripped from subagents (#13898); apply_migration is orchestrator-only | Plan 01 Task 2 checkpoint: MCP `apply_migration` → qmnijlgmdhviwzwfyzlc, then run the psql pgTAP command (automated half) and paste the two information_schema query outputs |
| PROD `portfolio_strategies` census (READ-ONLY — B-2 decision) | OWN-03 (D-12-A) | PROD read requires orchestrator MCP/authed SQL; replaces the deleted "no real user positions" claim | Plan 05 verification: run the SELECT-only census joining ps → strategies.capital_ownership → portfolios.user_id against khslejtfbuezsmvmtsdn; paste into 150-05-SUMMARY.md; enumerates which rows will render positions-but-unmarked (read-only affordances) |
| Live retro path on real data | OWN-03 (D-11) | Black Swan / Alpha Centauri / Arctic Fox are PROD rows | at phase /qa: mark one legacy strategy own-capital on a real session, see it appear in Holdings, allocate, edit, remove; confirm derived weight renders as share of allocated capital |
| 148 adversarial cache acceptance on a live deploy | OWN-03 (cache) | unstable_cache behavior is runtime, not unit | after an owner views a draft factsheet, anon request for same id still 404s (Phase-148 procedure) |

---

## Falsifiability Ledger

> One row per success criterion. Mutations are semantic edits to PRODUCTION source, run and observed.
> Fill Observed at execution time — "asserted" is not evidence (142.1 item-14 lesson: pending ≠ skipped ≠ observed).

**CLOSED 2026-08-06 (Plan 08 Task 2). 19 of 19 rows Observed; ZERO skipped.**

Seven rows arrived at this plan un-run: their owning plans had asserted the
property with a named test but never executed the mutation. Rather than record
those as "skipped — covered by a named test" (which is precisely the
"asserted ≠ observed" failure this ledger exists to prevent), all seven were RUN
in this session as 150-08 M7–M13 — against the real production files, each
reverted by re-editing, `git status --short` empty afterwards. One of the seven
(SC-1 allocator-only render) came back **GREEN**, i.e. the property had no
oracle at all; it is recorded as a blind spot found-and-closed rather than as a
catch, and the fix is committed.

Provenance convention: **150-08 M<n>** = run in this session (Plan 08); any other
plan id = run by that plan and transcribed from its SUMMARY's own Rule-9 ledger.
No row is marked observed on the strength of a test's existence.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 (question, default b) | `MetadataStep.tsx`: initialize the question state to `OWN_CAPITAL` instead of `TEAM_REVIEW` | MetadataStep.test.tsx default-selection case | ✅ | **150-08 M11**, run 2026-08-06. RED: `MetadataStep.test.tsx` 2 failed | 29 passed — `[D-01] preselects option (b) team_review on mount — never null` and `[SC 2] an untouched allocator submit adds ONLY capitalOwnership=team_review`. Reverted by re-editing. |
| SC-1 (allocator-only render) | `WizardClient.tsx`: pass `showCapitalQuestion={true}` unconditionally (drop the contribution derivation) | MetadataStep/WizardClient render-gate case | ✅ ⚠️ | **150-08 M12**, run 2026-08-06. **Initially GREEN — a measured BLIND SPOT**: all 28 wizard spec files / 420 assertions passed with the gate un-derived, because `MetadataStep` is MOCKED in `WizardClient.test.tsx` and the mock never surfaced `showCapitalQuestion`. The step's own spec proves what it does with the prop; nothing proved what the call site hands it. Closed by two new call-site cases (commit `9f493aa1`). Re-run now RED: `[OWN-03 D-07] does NOT ask the capital question on the manager entry path` — `Expected: false / Received: true`. Same class as 150-05 A6 and 150-07 M2. |
| SC-1b (render-only cull) | `MetadataStep.tsx`: drop one culled field (e.g. `aum`) from the `onComplete` payload | MetadataStep payload deep-equal case | ✅ | **150-08 M13**, run 2026-08-06. Dropped `aum` from the `onComplete` payload. RED: `MetadataStep.test.tsx` 3 failed | 28 passed, led by `[D-08] an untouched manager submit is deep-equal to the pre-Phase-150 payload` — `expected { …(9) } to deeply equal { …(10) }`. The literal-oracle deep-equal is what sees it. |
| SC-1c (rename server gate) | `name/route.ts`: remove `.in("status", ["private","draft"])` from the UPDATE chain | name route published-row-404 case | ✅ | **150-04 M5** (150-04-SUMMARY ledger). Dropped the `.in("status", …)` D-17 gate → RED on 3 independent pins in `name/route.test.ts`. |
| SC-1c (Holdings label) | `strategies-row-adapter.ts`: revert the owner carve-out (drop `s.name` from the resolution chain) | adapter wizard-shaped rename-visibility case | ✅ | **150-08 M7**, run 2026-08-06. Dropped `owned?.name` from the position-half chain. RED on 2 files: gate `P9 — the OWN-05 owner-name carve-out is scoped to the MARKED set` and `strategies-row-adapter.test.ts › makes a RENAME visible` — `expected 'Strategy #s-1' to be 'Black Swan'`. The OPPOSITE direction (un-scoping the carve-out to every row) is **150-05 A2**, RED on 3 tests — both directions observed. |
| SC-2 (mark persistence) | `finalize-wizard/route.ts`: drop `.eq("user_id", user.id)` from the mark UPDATE | finalize route ownership-predicate assertion | ✅ | **150-08 M8**, run 2026-08-06. Dropped `.eq("user_id", user.id)` from the post-RPC mark UPDATE. RED: `finalize-wizard/route.test.ts` 2 failed | 88 passed — the exact-filter-list assertions on both persist cases. |
| SC-2 (allocate write) | `allocation/route.ts`: change upsert to plain `.insert(` | allocation route second-POST-edits case (and pgTAP PK case turns the behavior visible) | ✅ | **150-08 M9**, run 2026-08-06. `upsert(...)` → plain `.insert(...)`. RED across 2 files, 14 cases: gate `P3` loses the literal `onConflict` pin, and `allocation/route.test.ts` reddens on the SC-4 onConflict oracle, the D-13 second-allocate case, the payload case, both 500 arms, the audit case and the two provisioning cases. |
| SC-2b (trigger scope) | migration: `BEFORE INSERT` → `BEFORE INSERT OR UPDATE` on the trigger statement | phase-150 gate P4 (no-OR-UPDATE pin); pgTAP legacy-alias case on TEST | ✅ | **150-08 M3**, run 2026-08-06 on the REAL migration file. RED: gate `P4 — the D-03-A create-side trigger is INSERT-scoped, with no blanket UPDATE arm`, diff showing `BEFORE INSERT OR UPDATE ON public.portfolio_strategies`. **Measured**: the entire vitest suite is structurally blind (no TS test executes SQL). DB-tier twin: **150-01 M4a/M4b** — RED at apply (migration self-check) and RED behaviourally on the legacy-alias case. |
| SC-2b (third-party paths preserved — B-1/D-03-A) | migration: drop the owner-equality conjunct from the trigger predicate (RAISE whenever `capital_ownership IS DISTINCT FROM 'own_capital'`) | pgTAP third-party-insert regression case in `test_capital_ownership_allocation_guard.sql` (on TEST); phase-150 gate P4 both-arms pin | ✅ | **150-01 M2** (150-01-SUMMARY ledger). Blanket `IS DISTINCT FROM 'own_capital'` predicate → RED on guard-test case 8a: `strategy <id> cannot become a position: capital_ownership=unmarked`. This is the mutation that would have deleted AddToPortfolio, MigrationWizard and the demo seed. Gate `P4`'s both-arms pin is the source-tier twin. |
| SC-2b (predicate) | `capital-ownership.ts`: `isAllocatable` → `return mark !== null` | predicate truth-table + adapter affordance cases | ✅ | **150-08 M1**, run 2026-08-06. `isAllocatable` → `return mark !== null`. RED: 2 files, 6 failed | 51 passed — 4 truth-table cases plus both adapter fail-closed arms. **Recorded honestly: the phase-150 gate stayed 15/15 GREEN** (P1 pins WHERE the literal lives, not what the predicate returns), so for this row the behavioural suites are the sole control. |
| SC-2b (census, second member) | add a `.upsert(` on `portfolio_strategies` to `RemoveStrategyButton.tsx` | phase-150 gate P2 (rot-guarded allowlist) | ✅ | **150-08 M2**, run 2026-08-06. Added a `.upsert(` on `portfolio_strategies` to `RemoveStrategyButton.tsx`. RED: gate `P2`, naming the offender in the diff. **Measured asymmetry**: `src/app/(dashboard)/allocations` + `src/components/portfolio` stayed fully GREEN, 137 files / 1889 passed. For this row the gate is the SOLE control. |
| SC-3 (no auto-add) | `finalize-wizard/route.ts`: insert a `portfolio_strategies` write after the mark UPDATE | phase-150 gate P2 names the file; route test call-census | ✅ | **150-08 M10**, run 2026-08-06. Added a `portfolio_strategies` insert after the mark UPDATE in `finalize-wizard/route.ts`. RED: gate `P2`, diff naming `src/app/api/strategies/finalize-wizard/route.ts` as a fourth writer. |
| SC-4 (duplicate-add) | `allocation/route.ts`: change `onConflict: "portfolio_id,strategy_id"` → `onConflict: "portfolio_id"` | `src/app/api/portfolio-strategies/allocation/route.test.ts` — the literal onConflict assertion in the second-POST-edits case (review round 1 W-1: semantic production mutation with a named test; the pgTAP PK case remains the positive DB-tier proof, not the ledger oracle) | ✅ | **150-05 M1** (150-05-SUMMARY ledger). `onConflict` narrowed to `"portfolio_id"` → RED on 2 tests, incl. the literal-onConflict SC-4 oracle. Re-confirmed this session as part of 150-08 M9's blast radius (`[SC-4 ORACLE] pins the onConflict target to the literal 'portfolio_id,strategy_id'`). |
| SC-2b (atomic flip) | `ownership/route.ts`: replace the rpc call with sequential `.update()` + `.delete()` | phase-150 gate P6; ownership route RPC-call assertion | ✅ | **150-08 M5**, run 2026-08-06. RPC replaced by sequential `.update()` on strategies + `.delete()` on portfolio_strategies. RED: 2 files, 8 failed | 47 passed — gate `P6` plus 7 cases in `ownership/route.test.ts` (call-shape, audit metadata, the 404/500/500 RPC-result arms, both source pins). |
| money (weight skew) | `allocation/route.ts`: add `current_weight: 0.5` to the upsert payload | phase-150 gate P3; allocation route payload assertion | ✅ | **150-08 M4**, run 2026-08-06. `current_weight: 0.5` added to the upsert payload. RED: gate `P3` plus 3 of 86 in `allocation/route.test.ts`. **Measured**: `strategies-row-adapter.test.ts` stayed GREEN — the adapter never READS the column, which is exactly what makes a write to it silently corrupting. |
| money (derived-weight honesty — D-12-B) | `strategies-row-adapter.ts`: include non-own-capital allocations in the derived-weight denominator (or emit `0` instead of null for unallocated rows) | adapter derived-weight cases (120k/380k → 0.24/0.76; unmarked-positioned → null; unallocated → null, never 0) | ✅ | **150-05 A3/A4/A5** (150-05-SUMMARY ledger). Denominator widened to include unmarked positioned rows → RED; unallocated `allocation` fabricated as 0 → RED on 2 tests; unallocated `age` fabricated as 0 → RED. |
| invariant 3 (tag gate — public leak; rev-2 blocker) | `StrategyTable.tsx`: delete the `visibility === "owner-all-statuses" &&` guard from the OwnershipTag mount (render the tag unconditionally) | phase-150 gate P8 pin; `StrategyTable.visibility.test.tsx` public-mount no-tag case (published + own_capital row) | ✅ ×2 | Observed INDEPENDENTLY twice. **150-06 M1**: guard deleted → `StrategyTable.visibility.test.tsx` 2 failed | 19 passed, `expected <span …(1)></span> to be null` on both the published+own_capital and team-review public mounts. **150-08 M6**, re-run 2026-08-06: same edit → gate `P8` RED plus those same 2 behavioural cases (2 files, 3 failed | 33 passed). |
| money (legacy weight source dead — review round 2 W-1) | `strategies-row-adapter.ts`: re-add `weight: ps.current_weight` to the position-row mapping | adapter positioned-row-with-current_weight → `weight: null` case (strategies-row-adapter.test.ts) | ✅ | **150-05 A1** (150-05-SUMMARY ledger). `weight: ps.current_weight` re-added as the display source → RED on 3 tests. |
| SC-2 (lazy provisioning — rev-4, D-03-B) | `allocation/route.ts`: drop the `.eq("is_test", false)` filter from the resolve step (or flip the provisioning insert to `is_test: true`) | allocation route provisioning cases in route.test.ts: zero-portfolio POST asserts the insert payload's `is_test: false` LITERAL + the resolve filter; existing-portfolio case asserts ZERO portfolios inserts | ✅ | **150-05 M2 + M3** (150-05-SUMMARY ledger). Resolve losing its `is_test = false` filter → RED (a scenario portfolio could become the real book); provisioning inserting `is_test: true` → RED. Both arms of the row's mutation observed. |

---

## Oracle Independence

Verified by grep 2026-08-06 (Plan 08 Task 2), not by recollection.

- [x] **No test imports a constant from the module it tests.** The $1B ticket cap
      is typed as `1_000_000_000` / `1_000_000_001` literals in
      `allocation/route.test.ts` (which carries the comment "Literal oracles —
      the $1B ticket cap boundary. NEVER import MAGNITUDE_CAPS"); `dollar-validation.test.ts`
      and `AllocateDialog.test.tsx` each state the same rule in-file. `grep -rn
      MAGNITUDE_CAPS` over the phase's test files returns only those three PROSE
      mentions — zero imports. Copy strings are byte-literals in the dialog and
      radio-group specs.
- [x] **No assertion compares a value to itself** via a re-export, fixture, or
      table under test. The one candidate is examined and cleared below.
- [x] **The phase-150 gate pins literal path LISTS with rot-guards, not counts.**
      `P1` is `toEqual([CAPITAL_OWNERSHIP])` and `P2` is
      `toEqual([...SANCTIONED_POSITION_WRITERS].sort())` — both fail in BOTH
      directions (new offender, and an allowlisted file that stops matching).
      `MARK_LITERAL = "own_capital"` is typed into the gate, never imported from
      the module it is pinning. The one length-style assertion in the phase,
      `no-store-coverage`'s `MUST_STAMP_NO_STORE.length === 36`, sits BESIDE an
      explicit literal path list plus a per-path existence + stamp check, so the
      count is a vacuity guard on the list rather than the assertion itself.
- [x] **The DB tests assert against literal expected values**, never against the
      trigger's own message re-read: they assert on SQLSTATE (`check_violation` /
      `23505` / `42501`) and on row counts, and `RAISE EXCEPTION` is used to
      REPORT a failure, never as an oracle. (⚠️ Terminology correction for the
      record: this phase's DB tests are **plain PL/pgSQL `DO` blocks, not pgTAP**
      — the extension is not installed and 0/53 existing `supabase/tests/*.sql`
      files use `plan/ok/finish` (150-01 Decision 2). CI discovery and
      fail-the-job semantics are identical; the word "pgTAP" throughout this
      document should be read as "the `supabase/tests/test_*.sql` suite".)

*Deliberate exceptions — ONE, named with its independent cover:*

- `src/lib/capital-ownership.test.ts` DOES import `OWN_CAPITAL` / `TEAM_REVIEW`
  from the module under test. It is not self-referential: the constants are
  asserted AGAINST LITERALS (`expect(OWN_CAPITAL).toBe("own_capital")`, because
  they are DB column values and a drift silently orphans every existing row),
  and every `isAllocatable` case is fed a LITERAL argument
  (`isAllocatable("team_review")`), never the imported constant. Independent
  cover: the phase-150 gate's `P1`, which spells `own_capital` itself and would
  redden if the module's literal changed underneath.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (map above: every task has one; the Plan-01 checkpoint now carries the post-apply psql run as its automated half — review round 1 W-2)
- [x] Wave 0 covers all MISSING references — every file verified on disk, plus one UNPLANNED addition (the seed-SECDEF regression test)
- [x] No watch-mode flags
- [x] Feedback latency < 150s (gate battery 4.1s; the heaviest single-file command is under 30s)
- [x] **Every success criterion has a Falsifiability Ledger row**
- [x] **Every ledger row is `Observed ✅` with pasted evidence** — 19 of 19, ZERO skipped
- [x] **Oracle Independence checklist complete** — one deliberate exception named with its independent cover
- [x] `nyquist_compliant: true` set in frontmatter

## Closing evidence (Plan 08 Task 2, 2026-08-06)

| Gate | Result |
|------|--------|
| Phase gate battery (147 / 148 / 149 / **150** / visibility B10 / no-store / format-percent / phase-84) | 8 files, **65 passed** |
| `npm test` (full vitest) | **762 files passed, 19 skipped — 11 080 passed / 287 skipped**, 0 failed |
| `npm run test:coverage` | thresholds **green**: statements 85.92 (≥80), branches 80.36 (≥72), functions 82.68 (≥74), lines 87.99 (≥82) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | **0 errors** (1 pre-existing unrelated warning, `EquityChart.tsx:1119`); admin-manifest 20 routes OK, route-contract 57 routes OK |

⚠️ **The first full-suite run was RED**, and that is the finding this task exists
to produce: `src/lib/api/limiter-ordering.test.ts` failed because 150-04's
`strategies/[id]/ownership` and `strategies/[id]/name` consume a rate limiter but
were never classified in the B15 registry. 150-04 ran `src/app/api/strategies` +
`src/__tests__` and not `src/lib/api`, so the gap was invisible until every wave
was merged. Both were classified CANONICAL (they validate the `[id]` segment AND
parse + validate the body before `checkLimit`), and the classification was proven
load-bearing rather than a rubber stamp by hoisting `checkLimit` above the body
parse — `"checkLimit at offset 660 precedes body read/validation at offset 782"`.
Commit `662c0c99`.

## Two founder-visible decisions, recorded as DECISIONS not gaps

Both are dated CONTEXT amendments (2026-08-06) that a reader of the original plan
text would otherwise mistake for unimplemented scope.

**(a) D-12-B — the Weight column is RENDER-DERIVED, and `current_weight` stays
unwritten.** The displayed share is `allocation / Σ allocation` across the
ALLOCATED OWN-CAPITAL rows, computed in a pure post-pass in
`strategies-row-adapter.ts` and formatted `formatPercent(w, 2, { signed: false })`.
The denominator is NAMED on the column header (`title="share of allocated
capital"`) rather than left to the reader — it is the allocated own-capital set,
**not** book equity, and no book-equity scalar is invented anywhere on the
surface. The approved mock's `$120,000 · 24.00%` therefore renders with ZERO
database write. This is deliberate, not deferred: `portfolio_strategies.current_weight`
has no writer anywhere in the repo, and two analytics consumers substitute `1.0`
for a NULL weight and then renormalize — so a write would silently distort
`portfolio_returns_series` and match scoring while nothing on screen changed
(150-RESEARCH § Schema Findings 2). Deriving the display value is precisely what
lets the column stay writer-free until Phase 151, and that non-write is pinned
three ways: phase-150 gate `P3` (route), gate `P5` (adapter), and the route's own
source pin. Ledger row *money (weight skew)* is its falsifier.

**(b) D-12-A — positions-but-unmarked rows KEEP rendering; no money vanishes.**
A position whose strategy is not in the marked set retains its row, its
`Allocation` figure and its metrics, and gains no tag and no Allocate/Edit
affordance until the strategy is marked via the retro path (D-09/D-11). The
alternative — filtering unmarked rows out of the row set — would make an
allocator's live allocation disappear off the money surface, which is why the
gate pins the union as un-filterable (`P5`: no `.filter(`, exactly one
`continue`, and that one is the dedupe). **Scope named from real data, not
estimated:** the orchestrator's read-only PROD census (`khslejtfbuezsmvmtsdn`,
recorded in 150-05-SUMMARY) found **29 `portfolio_strategies` rows, ALL
third-party** — `strategy_owner <> portfolio_owner` on every one, 20 with
`is_test=false` and 9 with `is_test=true`, and ZERO self-owned positions. So on
merge every existing PROD position lands in this read-only arm, and none of them
is markable by its allocator anyway: you cannot mark someone else's strategy.

**Approval:** CLOSED 2026-08-06. Phase evidence complete; ready for `/gsd:verify-work`.
