---
phase: 150-own-03-the-wizard-asks-whose-capital-this-is
verified: 2026-08-06T21:59:36Z
status: human_needed
score: 6/7 must-haves verified (1 UNCERTAIN — external DB state, not observable from the repo)
overrides_applied: 0
re_verification:
  previous_status: null
  previous_score: null
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "As an ALLOCATOR, add a key through the contribution wizard and stop on the categorization step. Confirm the capital question renders FIRST, defaults to 'A trading team's key I'm verifying', that only codename/description/category (+ asset class when editable) are visible, and that everything else sits behind 'More details (optional)'. Then submit without touching the question."
    expected: "Question renders first with the team-review option pre-selected; step feels culled; on submit the strategy lands status=private with capital_ownership='team_review'; NO amount is asked, NO position is created, no 'allocate now' shortcut appears anywhere in the wizard."
    why_human: "Visual ordering, copy quality and the founder's 'I hate this page' acceptance bar are not greppable. The end-to-end wizard→RPC→post-RPC mark UPDATE has only ever run against mocked Supabase clients."
  - test: "As a MANAGER (entryContext != contribution), walk the same categorization step."
    expected: "No capital question at all; the step is otherwise identical to the allocator's; finalize behaviour unchanged and capital_ownership stays NULL."
    why_human: "Role-conditional render + a no-op server arm; the console.warn fallback on the unified arm has never been exercised live."
  - test: "As an allocator with ZERO portfolios (no is_test=false row), mark a strategy own-capital, open Holdings → Strategies, click Allocate…, enter an amount and save."
    expected: "The dialog opens with no remedy modal and no dead end; the route lazily creates the real portfolio ({user_id, name:'Active Allocation', is_test:false}), then upserts the position; the row re-renders as '$X · N.NN%' with an [Edit allocation…] button; a second allocate for the same strategy EDITS rather than duplicating."
    why_human: "HIGHEST RISK PATH. This is the rev-4 lazy-provisioning arm — the repo's only is_test=false creation path. It depends on (a) portfolios_owner RLS reusing USING as the INSERT check, (b) the portfolios_one_real_per_user partial unique index, and (c) migration 20260806130000's SECURITY DEFINER repair of seed_weight_snapshots_for_portfolio(), without which the parent INSERT aborts with 42501. All three are DB-runtime facts that mocked unit tests cannot observe."
  - test: "With a live allocation on an own-capital strategy, open Change mark… on /my-strategies and flip it to team review."
    expected: "409 arm fires: an inline confirm names the allocated amount; on confirm the single flip RPC removes the position AND sets the mark; the strategy disappears from the allocatable set; no stranded position remains."
    why_human: "The 409 → confirm → RPC arc spans client, route and a plpgsql transaction. Copy correctness and the absence of a silent removal are human judgements."
  - test: "Rename an OWN private/draft strategy from /my-strategies and again from the factsheet owner masthead; then check the name on /my-strategies, the Browse drawer, the factsheet and the Holdings row. Finally confirm Rename… is ABSENT (not disabled) on a published own row, and that an anon request for the same factsheet id still 404s."
    expected: "The new name appears coherently on every owner surface; public surfaces still render the codename per the disclosure contract; Rename… is absent on published rows; anon still 404s."
    why_human: "Cross-surface name coherence and the pseudonymity contract are visual/behavioural; the anon-after-owner-view check is the phase-148 cache-isolation adversarial case."
  - test: "Confirm migrations 20260806120000 and 20260806130000 are applied to the TEST project (qmnijlgmdhviwzwfyzlc) and that supabase/tests/test_capital_ownership_column.sql, test_capital_ownership_allocation_guard.sql and test_weight_snapshot_seed_secdef.sql all exit 0 there."
    expected: "All three files run green under psql -v ON_ERROR_STOP=1; the migration self-verify blocks emit their NOTICE rather than RAISE."
    why_human: "External database state. Not observable from the repository; the verifier has no DB credentials. CI's sql-tests job will enforce it at PR time, but that has not run yet on this branch."
---

# Phase 150: OWN-03 — The Wizard Asks Whose Capital This Is — Verification Report

**Phase Goal:** When an allocator adds a key the product asks the question it never asked — own capital, or a trading team's key being verified — stores the answer as a persistent ownership mark, and lets ONLY marked own-capital strategies be added to the allocation from the Holdings tab.

**Verified:** 2026-08-06T21:59:36Z
**Status:** human_needed
**Re-verification:** No — initial verification
**Stance:** FORCE (adversarial). Every claim below was re-derived from the codebase; SUMMARY.md bullet points were treated as unverified assertions throughout.

---

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | Wizard asks the two-way capital question at allocator key-add (team_review default), stores the persistent mark, writes NO position and asks NO amount | ✓ VERIFIED | `WizardClient.tsx:952` passes `showCapitalQuestion={entryContext === "contribution"}`; `MetadataStep.tsx:143-144` defaults `useState<CapitalOwnership>(initial?.capitalOwnership ?? TEAM_REVIEW)`; `:306-312` renders `CapitalOwnershipRadioGroup` as the FIRST child of the form, before codename; `:251` spreads the key in ONLY when the question rendered; `SubmitStep.tsx:145-147` sends `capital_ownership` only when present; `finalize-wizard/route.ts:1343-1379` persists it via a SEPARATE owner-scoped `.update().eq("id").eq("user_id").select("id")` AFTER the untouched 13-arg RPC. The write census (below) confirms NO wizard file creates a `portfolio_strategies` row, and no amount field exists on the step. |
| 1b | Categorization step culled to essentials, every culled answer's downstream consumer checked (hide, never fabricate) | ✓ VERIFIED | `MetadataStep.tsx:395-479` — bare native `<details>` labelled "More details (optional)" wraps strategy types, subtypes, markets, supported exchanges, leverage range, AUM, max capacity. The cull is RENDER-ONLY: `:234-250` still emits every culled field to `onComplete`, and `SubmitStep.tsx:120-131` still sends `strategy_types / subtypes / markets / supported_exchanges / leverage_range / aum / max_capacity` in the finalize body. Zero server-payload change ⇒ downstream consumers keep their existing absent-hides behaviour by construction. Asset-class select is HOISTED out of the disclosure when editable (`:376` `{!assetClassLocked && assetClassSelect}`) and only sits inside when locked (`:455`) — the √252-on-crypto default cannot hide. |
| 1c | Owner rename for OWN private/draft strategies (OWN-05), owner-authz only, public codename/disclosure redaction contract byte-untouched, all owner surfaces coherent | ✓ VERIFIED | `api/strategies/[id]/name/route.ts:152-158` — `.update({ name }).eq("id").eq("user_id", user.id).in("status", ["private","draft"]).select("id")`, zero rows ⇒ 404 (`:167-175`), trim-only normalisation, 80-char cap measured after trim, CSRF first, rate limit AFTER validation, `NO_STORE_HEADERS` on every arm, `strategy.rename` audited. The route writes `name` and nothing else — no codename/disclosure_tier read or write anywhere in the file. Surfaces: `StrategyTable.tsx:932-940` renders `Rename…` only when `s.status === "private" \|\| "draft"` (absent, not disabled, on published); `FactsheetView.tsx:732-757` owner masthead arm; `strategies-row-adapter.ts:165-173` owner-name carve-out gated on marked-set membership; Browse drawer already prefers the owner's real name (pre-existing CONTRIB-03 carve-out, `api/strategies/browse/route.ts:50-53`). |
| 2 | Holdings tab: own-capital-marked strategy can be ADDED to allocation (explicit action + amount); path (b) or never-reaching-the-question changes nothing | ✓ VERIFIED | Full data path traced: `allocations/page.tsx:108` `getOwnCapitalStrategies(user.id)` → `:156` prop → `AllocationsTabs.tsx:961` `<HoldingsTabPanel {...props} />` → `HoldingsTabPanel.tsx:124-131` `toStrategyRows({strategies, positions})` → `HoldingsTable.tsx:422-433` renders `[Allocate…]`/`[Edit allocation…]` ONLY when `row.capitalOwnership === OWN_CAPITAL` → `AllocateDialog.tsx:42` POSTs `/api/portfolio-strategies/allocation` → `route.ts:286-296` upserts exactly three columns with `onConflict: "portfolio_id,strategy_id"`. `queries.ts:1697-1719` filters `.eq("capital_ownership", OWN_CAPITAL)` server-side. Unmarked and team_review rows reach neither the marked set nor the affordance. |
| 2b | HARD INVARIANT: team-review strategy can NEVER become a position — asserted structurally. Retro mark path included | ✓ VERIFIED (with a documented narrowing, see note) | THREE table-layer triggers in `20260806120000`: `trg_portfolio_strategies_own_capital_only` (BEFORE INSERT, `:344-348`), `trg_portfolio_strategies_own_capital_on_repoint` (BEFORE UPDATE OF strategy_id, `:375-379`), `trg_strategies_team_review_mark_guard` (BEFORE UPDATE OF capital_ownership, `:455-459`). Predicate `:321-322` — arm 1 `v_mark = 'team_review'` is UNCONDITIONAL; arm 2 owner-scoped. All SECURITY DEFINER so the lookup is not RLS-blinded; all REVOKEd from PUBLIC/anon/authenticated. Migration carries a self-verifying `DO $$` block (`:571-735`) that RAISEs at apply if any trigger loses its event or column target. Structurally asserted in `src/__tests__/phase-150-capital-ownership-invariant.test.ts` P4 ×4 + 43 `RAISE EXCEPTION` assertions in `supabase/tests/test_capital_ownership_allocation_guard.sql`. Retro path: `MarkOwnershipDialog.tsx:99-112` → `api/strategies/[id]/ownership/route.ts:239-294` → `flip_capital_ownership_to_team_review` RPC (owner precheck at `:519-525`, DELETE-before-UPDATE at `:537-553`). |
| 3 | Auto-add remains refused — no code path adds to the portfolio without the explicit (a) answer | ✓ VERIFIED | Independent write census run by the verifier over `src/` and `scripts/`: the only `portfolio_strategies` insert/upsert sites in production source are `AddToPortfolio.tsx:54`, `MigrationWizard.tsx:72` and `api/portfolio-strategies/allocation/route.ts:286` (plus `scripts/seed-full-app-demo.ts`, not production). This matches `SANCTIONED_POSITION_WRITERS` (gate line 327-331) exactly, and pin P2 is bidirectional (a new offender AND a vanished allowlist entry both redden). The allocation route refuses with 409 `not_allocatable` before any write when `capital_ownership !== OWN_CAPITAL` (`:214-216`), and requires a parsed amount in (0, $1e9] (`:115-128`, `:172-180`). Lazy portfolio provisioning (`:242-281`) creates a CONTAINER only, strictly AFTER the strategy pre-checks, and mints no position. |
| 7 | Both migrations applied to the TEST project and all three DB test files green there | ? UNCERTAIN | External database state. The migration files, their self-verify blocks and all three `supabase/tests/test_*.sql` files exist in the tree and are auto-discovered by the CI `sql-tests` job (`.github/workflows/ci.yml:966-1010`, glob `supabase/tests/test_*.sql`, `psql -v ON_ERROR_STOP=1`). The verifier has no DB credentials and cannot confirm the TEST-side apply. Routed to human verification. |

**Score:** 6/7 truths verified · 1 UNCERTAIN · 0 FAILED

**Note on SC 2b's documented narrowing (INFO, not a gap):** the migration header (g) (`:190-210`) and the column COMMENT state explicitly that `team_review` means "never *newly* allocatable": no INSERT can mint a position from a team-review strategy for anyone, and the owner cannot strand their own book — but a THIRD-PARTY position created before a flip is RETAINED, because the alternative is a cross-tenant DELETE in which one allocator's bookkeeping silently rewrites another's portfolio. This is pinned by guard-test case 7e and is a deliberate, reviewed decision recorded before execution, not a shortfall discovered here.

---

### Plan-Level Must-Haves (merged, spot-checked)

| Plan | Must-have | Status | Evidence |
|------|-----------|--------|----------|
| 01 | Column nullable TEXT, CHECK-constrained, NO default, NO backfill | ✓ | `20260806120000:249-277` — `ADD COLUMN IF NOT EXISTS capital_ownership TEXT` with no DEFAULT; DROP-then-ADD CHECK; self-verify 5b RAISEs unless `is_nullable='YES' AND column_default IS NULL` |
| 01 | Third-party insert with NULL mark still SUCCEEDS (B-1 regression) | ✓ | Arm 2's `v_strategy_owner = v_portfolio_owner` conjunct (`:322`); self-verify 5d RAISEs if the `portfolios` lookup disappears from the body |
| 01 | Legacy alias UPDATE still succeeds (trigger is INSERT-scoped, never `OR UPDATE`) | ✓ | `:344-348` INSERT-only; the repoint trigger is column-targeted `OF strategy_id` (`:377`) and the alias route sets `alias` alone; self-verify 5c/5g enforce both |
| 01 | One RPC flips the mark AND removes positions in ONE transaction | ✓ | `flip_capital_ownership_to_team_review` (`:492-559`), single plpgsql body, owner precheck first, DELETE before UPDATE; self-verify 5e pins the ordering by string position |
| 02 | Allocatable predicate spelled in exactly ONE place | ✓ | `src/lib/capital-ownership.ts:40-44` `isAllocatable`; gate pin P1 `expect(markLiteralSpellers()).toEqual([CAPITAL_OWNERSHIP])` |
| 02 | OwnershipTag renders nothing for null/undefined, never a Draft fallback | ✓ | `OwnershipTag.tsx:56` closed guard `if (mark !== OWN_CAPITAL && mark !== TEAM_REVIEW) return null` — a bespoke component precisely because `Badge.tsx:55` falls back to DRAFT |
| 02 | Shared validator/formatter; route-local and module-private copies deleted | ✓ | `src/lib/dollar-validation.ts` exports both; `finalize-wizard/route.ts:9` imports `isValidDollar`; `HoldingsTable.tsx:48` imports `formatUsd`; `MAGNITUDE_CAPS` still canonical in `@/lib/closed-sets`, not re-exported |
| 04 | Non-owner / unknown id gets 404, never `{ok:true}` | ✓ | `ownership/route.ts:319-325` and `:275-283`; `name/route.ts:167-175` — count-checked `.select("id")` on both |
| 04 | CSRF, rate-limit-after-validation, audit, NO_STORE on every response | ✓ | Both routes: `assertSameOrigin` first line; `checkLimit` after all validation; `logAuditEvent`; `NO_STORE_HEADERS` on every `NextResponse.json`. `src/lib/audit.ts:427-428,634-635` registers both actions; `analytics-service/services/audit.py` mirrors them for the TS↔Python parity test. `no-store-coverage` and `limiter-ordering` gates green. |
| 05 | Allocation write NEVER writes current_weight | ✓ | Only three columns at `route.ts:289-293`; gate pin P3 `expect(allocationSrc).not.toContain("current_weight")` |
| 05 | Union row set — a position row never vanishes | ✓ | `strategies-row-adapter.ts:146-228` — half 1 emits EVERY position (unconditionally, no filter), half 2 adds unseen marked strategies; unmarked positioned rows carry `capitalOwnership: null` |
| 05 | Weight render-derived, current_weight neither read nor written | ✓ | `:236-248` post-pass over `allocation / Σ allocation` across allocated own-capital rows; `null` when Σ=0; the string `current_weight` appears nowhere in the adapter except the ⛔ comment explaining its absence |
| 05 | Unallocated rows carry age=null, weight=null, allocation=null | ✓ | `:221-226` — explicit `null`s with no-invented-data comments |
| 05 | Zero-portfolio allocator can still allocate (lazy provisioning, 23505 race handled) | ✓ (code) / see human item 3 | `route.ts:222-281` — `resolveRealPortfolio` mirrors `getRealPortfolio`'s exact `.eq("user_id").eq("is_test", false)` filter (`:412-430`); 23505 → re-select, and a failed re-select returns 500 rather than falling through with an undefined portfolio_id (`:249-264`). Ordering verified: strategy 404/409 pre-checks run BEFORE any provisioning. |
| 06 | OwnershipTag in StrategyTable ONLY behind `visibility === "owner-all-statuses"` | ✓ | `StrategyTable.tsx:1018-1019`; gate pin P8 walks EVERY OwnershipTag mount in the shared table and requires the guard; `StrategyTable.visibility.test.tsx` covers published+own_capital and team_review public mounts |
| 06 | AddToPortfolio maps 23514 to honest copy | ✓ | `AddToPortfolio.tsx:62-70` — `error.code === "23514"` → "This strategy isn't marked as your own capital — mark it in My Strategies first." |
| 06 | Owner factsheet lane threads the mark like `viewerNotice`, nothing in the cached payload | ✓ | `factsheet/[id]/v2/page.tsx:473,519-521,645-657` — owner-lane probe select, closed-set narrowing, prop threaded beside `viewerNotice`; gate pin P7 asserts the cache callback carries no ownership token; `phase-148-owner-lane-cache-isolation` green |
| 07 | B-3 back-compat slack REMOVED | ✓ | `StrategyRowAdapterInputs.positions` is REQUIRED (no `?`, no default); zero `HAND-OFF(150-07)` markers remain anywhere in `src/` |
| 07 | Three empty-state arms in priority order | ✓ | `HoldingsTable.tsx:298-331` — list ≻ "No strategies marked as own capital." (with a /my-strategies link) ≻ "No strategies yet."; discriminator is the `hasAnyStrategies` prop derived from `getMyStrategies` count at `page.tsx:115` |
| 07 | Weight cell UNSIGNED, header carries the honest denominator | ✓ | `:387` `formatPercent(row.weight, 2, { signed: false })`; `:342` header `title="share of allocated capital"`; `format-percent-contract.test.ts` green |
| 08 | Structural gate exists with mutation ledger; VALIDATION.md complete | ✓ | `src/__tests__/phase-150-capital-ownership-invariant.test.ts` — 979 lines, 15 pins across 6 describes including P10 ("the gate cannot pass vacuously"); `150-VALIDATION.md` frontmatter `nyquist_compliant: true`, ledger closed "19 of 19 rows Observed; ZERO skipped" |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260806120000_strategies_capital_ownership.sql` | column + CHECK + D-03-A trigger + flip RPC + grants + self-verification | ✓ VERIFIED | 737 lines; contains `BEFORE INSERT`; three triggers, two guard functions, one RPC, seven self-verify assertions |
| `supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql` | SECURITY DEFINER repair of the two weight_snapshots seed triggers | ✓ VERIFIED | 357 lines; both functions `CREATE OR REPLACE … SECURITY DEFINER SET search_path`; REVOKEd; self-verify asserts `prosecdef` on both. A genuine production defect (live since 2026-04-16) found and root-caused, not a bandaid |
| `supabase/tests/test_capital_ownership_column.sql` | column-shape assertions | ✓ VERIFIED | 186 lines, 12 `RAISE EXCEPTION` assertions, transaction-scoped fixtures, ROLLBACK, no psql meta-commands (CI preflight-safe) |
| `supabase/tests/test_capital_ownership_allocation_guard.sql` | trigger positive/negative/null/third-party + legacy-alias + PK duplicate + flip atomicity | ✓ VERIFIED | 898 lines, 43 `RAISE EXCEPTION` assertions |
| `supabase/tests/test_weight_snapshot_seed_secdef.sql` | SECDEF repair regression | ✓ VERIFIED | 220 lines (third DB test file, added by the Plan-01 deviation) |
| `src/lib/capital-ownership.ts` | type + constants + `isAllocatable` | ✓ VERIFIED | 44 lines, fails closed; imported by 10+ call sites |
| `src/lib/dollar-validation.ts` | `isValidDollar` + `formatUsd` | ✓ VERIFIED | 53 lines; both consumers import it; no duplicate copies remain |
| `src/components/strategy/OwnershipTag.tsx` | null-safe badge-family tag | ✓ VERIFIED | 59 lines, closed switch, no fallback |
| `src/components/strategy/CapitalOwnershipRadioGroup.tsx` | THE question component, both mounts | ✓ VERIFIED | 89 lines; `role="radiogroup"` + `role="radio"` + `aria-checked`; copy is module constants so the two mounts cannot drift |
| `src/components/strategy/MarkOwnershipDialog.tsx` | retro mark with flip-confirm | ✓ VERIFIED | 217 lines; PATCHes the route, handles `live_allocation` 409 → `confirm_remove_allocation: true` |
| `src/components/strategy/RenameStrategyDialog.tsx` | rename with inline validation | ✓ VERIFIED | 180 lines |
| `src/app/api/strategies/[id]/ownership/route.ts` | mark write + flip orchestration | ✓ VERIFIED | 335 lines; exports PATCH; no `.delete(` anywhere (pin P6) |
| `src/app/api/strategies/[id]/name/route.ts` | owner rename, server-side status gate | ✓ VERIFIED | 185 lines; exports PATCH |
| `src/app/api/portfolio-strategies/allocation/route.ts` | money write | ✓ VERIFIED | 431 lines; exports POST + DELETE |
| `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts` | union rows, derived weight, owner-name carve-out | ✓ VERIFIED | 251 lines; imports `isAllocatable`, no ad-hoc literal |
| `src/app/(dashboard)/allocations/components/AllocateDialog.tsx` | allocate/edit/remove | ✓ VERIFIED | 346 lines; POST + DELETE against the route; $1e9 cap via `MAGNITUDE_CAPS.MAX_TICKET_SIZE_USD`; two-step Remove confirm |
| `src/__tests__/phase-150-capital-ownership-invariant.test.ts` | D-03 structural gate (min 300 lines) | ✓ VERIFIED | 979 lines, 15 pins; includes an anti-vacuity pin |
| `150-VALIDATION.md` | completed validation contract | ✓ VERIFIED | `nyquist_compliant: true`; 19/19 ledger rows Observed with pasted failure evidence, zero skipped |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| portfolio_strategies BEFORE INSERT trigger | strategies.capital_ownership + user_id + portfolios.user_id | `guard_allocation_requires_own_capital()` | ✓ WIRED | `:297-307` both lookups present; both arms at `:321-322` |
| flip RPC | portfolio_strategies DELETE + strategies UPDATE | one plpgsql transaction | ✓ WIRED | `:537-553`, ordering self-verified at apply |
| `types.ts` Strategy / `database.types.ts` | `strategies.capital_ownership` | field on row types | ✓ WIRED | `types.ts:223`, `database.types.ts:2352/2384/2416` |
| `finalize-wizard/route.ts` | `@/lib/dollar-validation` | import (route-local copy deleted) | ✓ WIRED | `:9`; no local `isValidDollar` definition remains |
| `HoldingsTable.tsx` | `@/lib/dollar-validation` | `formatUsd` import | ✓ WIRED | `:48`; module-private copy gone |
| `WizardClient.tsx` entryContext | MetadataStep `showCapitalQuestion` | `entryContext === "contribution"` | ✓ WIRED | `:952` |
| `finalize-wizard/route.ts` | `strategies.capital_ownership` | post-RPC owner-scoped UPDATE | ✓ WIRED | `:1346-1351`; 13-arg RPC signature byte-untouched |
| ownership route confirm arm | `flip_capital_ownership_to_team_review` | `supabase.rpc` | ✓ WIRED | `:239-247`; no sequential delete+update |
| name route | `strategies.name` | `.eq(id).eq(user_id).in(status,[private,draft]).select` | ✓ WIRED | `:152-158` |
| allocation route | portfolio_strategies | upsert onConflict portfolio_id,strategy_id | ✓ WIRED | `:286-296` |
| allocation route | portfolios | lazy real-book provisioning, 23505 re-select | ✓ WIRED | `:242-281`, `:412-430` |
| `strategies-row-adapter.ts` | `@/lib/capital-ownership` | `isAllocatable` / `OWN_CAPITAL` import | ✓ WIRED | `:39`, `:189`, `:220` |
| `MarkOwnershipDialog` | `/api/strategies/{id}/ownership` | fetch PATCH, 409 → confirm | ✓ WIRED | `:99-112` |
| factsheet page owner lane | `FactsheetView` | owner-only props beside `viewerNotice` | ✓ WIRED | `page.tsx:645-657`; nothing in the cached payload (pin P7) |
| `HoldingsTabPanel` | `getOwnCapitalStrategies` + `toStrategyRows` | server fetch → adapter merge | ✓ WIRED | `page.tsx:108/156` → `AllocationsTabs.tsx:961` `{...props}` → `HoldingsTabPanel.tsx:100/127` |
| `AllocateDialog` | `/api/portfolio-strategies/allocation` | fetch POST + DELETE | ✓ WIRED | `:42`, `:186` |
| phase-150 gate | migration SQL | source pins on BEFORE INSERT, absence of OR UPDATE | ✓ WIRED | pins P4 ×4, scoped to the CREATE statement (not file-wide, so COMMENT prose cannot satisfy them) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `HoldingsTable` strategy rows | `strategyRows` | `toStrategyRows({strategies: getOwnCapitalStrategies(user.id), positions: payload.strategies})` | Yes — real Supabase select with `.eq("user_id").eq("capital_ownership", OWN_CAPITAL)` and a paired `strategy_analytics` embed | ✓ FLOWING |
| Weight cell | `row.weight` | derived post-pass over `row.allocation` (which is `portfolio_strategies.allocated_amount`) | Yes — derived from the real money column; `null` (renders `—`) rather than a fabricated 0 when there is no allocation | ✓ FLOWING |
| Allocation cell | `row.allocation` | `ps.allocated_amount` from the dashboard payload | Yes | ✓ FLOWING |
| MTD / Sharpe / MaxDD | `s.strategy_analytics.*` | embedded analytics row | Yes; `null` when absent | ✓ FLOWING |
| `OwnershipTag` on /my-strategies | `s.capital_ownership` | `getMyStrategies` → `select("*")` → `shapeRankingRows` `...strat` splat | Yes — the column rides the splat; `MyStrategiesSection.tsx:97` reads it | ✓ FLOWING |
| Factsheet owner masthead tag | `ownershipMark` | owner-lane probe `select(… capital_ownership …)` narrowed to the closed set (`page.tsx:519-521`) | Yes — request-scoped, outside the cached payload | ✓ FLOWING |
| `hasAnyStrategies` | `myStrategies.length > 0` | `getMyStrategies` count | Yes — real count, not a hardcoded boolean | ✓ FLOWING |

No HOLLOW_PROP or DISCONNECTED sources found. `props.ownCapitalStrategies` reaches `AllocationsTabs` from `page.tsx` with a real value (`ownCapitalStrategies ?? []`), and the `?? []` fallbacks exist only for pre-existing test call-sites, never at the production call site.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Structural gate + shared vocabulary tests pass | `npx vitest run phase-150-capital-ownership-invariant + capital-ownership + dollar-validation + OwnershipTag + CapitalOwnershipRadioGroup` | 5 files / 52 tests passed | ✓ PASS |
| Phase feature tests (routes, adapter, dialogs, wizard, table) pass | `npx vitest run` on the 13 phase-touched test files | 13 files / 380 tests passed | ✓ PASS |
| Collision gates green on the phase diff | `npx vitest run phase-147 + phase-148 + phase-149 + no-store-coverage + phase-84` | 5 files / 39 tests passed | ✓ PASS |
| B15 limiter-ordering gate green | `npx vitest run src/lib/api/limiter-ordering.test.ts` | 1 file / 6 tests passed | ✓ PASS |
| FULL suite green (SUMMARY claim re-run independently) | `npm test -- --run` | **762 passed \| 19 skipped (781 files); 11,080 passed \| 287 skipped (11,367 tests)** — exactly matches the claimed figures | ✓ PASS |
| Typecheck clean | `npx tsc --noEmit` | exit 0, zero output | ✓ PASS |
| Lint clean | `npm run lint` | 0 errors, 1 pre-existing warning in `EquityChart.tsx` (untouched by this phase); admin-route + route-contract manifests OK | ✓ PASS |
| Write census matches the gate's allowlist | verifier-run `grep` over `src/` + `scripts/` for `from("portfolio_strategies")` + insert/upsert | 3 production writers + the demo seed — identical to `SANCTIONED_POSITION_WRITERS` | ✓ PASS |
| DB tests execute against TEST | (requires `TEST_SUPABASE_DB_URL`) | no credentials available to the verifier | ? SKIP → human item 6 |

---

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| — | — | No `scripts/*/tests/probe-*.sh` exist and no PLAN/SUMMARY in this phase declares a probe. Not a migration/CLI phase. | N/A — SKIPPED (no probes declared or conventional) |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OWN-03 | 01, 02, 03, 04, 05, 06, 07, 08 | Wizard asks own-capital vs team-review, stores a persistent mark; Holdings is where a marked own-capital strategy is added to the allocation (explicit action + amount); team-review is NEVER allocatable (structural); retro mark path for legacy rows; categorization step culled to essentials without breaking downstream consumers | ✓ SATISFIED | Truths 1, 1b, 2, 2b, 3 above. All four founder sub-clauses covered: (1) question in the wizard with no amount/position; (2) Holdings allocation with explicit action + amount; (3) hard invariant at the table layer across all three write shapes; (4) retro Mark dialog on every owned row |
| OWN-05 | 04, 05, 06, 08 | Allocator renames OWN private/draft strategies; owner-authz only; public codename/disclosure redaction untouched; owner surfaces coherent | ✓ SATISFIED | Truth 1c. Route is `user_id`-scoped and status-gated server-side; render gate mirrors the write gate exactly; the pseudonymity trap is closed by scoping the Holdings name carve-out to the owner-filtered marked set (`strategies-row-adapter.ts:150-173`) and by the route writing `name` only |

**Orphaned requirements:** none. REQUIREMENTS.md maps exactly OWN-03 and OWN-05 to Phase 150 (lines 1058-1059), and both appear in this phase's plan frontmatter.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | `TBD` / `FIXME` / `XXX` | — | **ZERO across the entire phase diff** (all changed files under `src/`, `supabase/`, `analytics-service/`). Debt-marker gate passes. |
| — | — | `TODO` / `HACK` / `PLACEHOLDER` | — | **ZERO across the phase diff.** |
| `src/app/api/strategies/finalize-wizard/route.ts` | 1339-1342 | Stale comment: "the strategies_update RLS policy has no WITH CHECK clause" | ℹ️ Info | Factually outdated — `20260410225610_sec005_follow_ups.sql:102-106` added an explicit `WITH CHECK`. The migration header (`20260806120000:479-490`) already re-based this exact citation; this one copy was not updated. The CODE is correct and unaffected (the `.eq("user_id")` predicate is right either way); only the justification prose is stale. Documentation-only, below the blocking bar. |
| `src/components/portfolio/MigrationWizard.tsx` | 72-76 | Raw `psError.message` surfaced to the user | ℹ️ Info | `AddToPortfolio` got the W-6 23514→honest-copy mapping; `MigrationWizard` did not. Reachable only in the narrow case where an allocator migrates a PUBLISHED strategy they themselves own and have not marked — the search is `withPublishedOnly`, so third-party rows (the normal case) are unaffected. Worst case is an opaque-but-non-sensitive Postgres message, not a data-integrity or money defect. Below the blocking bar; worth a TODOS.md line. |

No stubs, no empty implementations, no hardcoded-empty data flowing to render. Every `?? []` / `?? null` inspected traces to an honest-empty or no-invented-data decision documented at the site.

---

### Human Verification Required

Six items, listed in full in the frontmatter. Summary:

#### 1. Allocator wizard — the question, the default, the cull
**Test:** Add a key as an allocator; stop on the categorization step; submit without touching the question.
**Expected:** Question renders first, defaulted to team-review; only codename/description/category (+ editable asset class) visible; everything else behind "More details (optional)"; on submit → `status=private`, `capital_ownership='team_review'`, no amount asked, no position written.
**Why human:** Visual ordering and the founder's acceptance bar for this step are not greppable; the wizard→RPC→post-RPC mark UPDATE has only run against mocked clients.

#### 2. Manager wizard — no question, identical step
**Test:** Walk the same step as a manager.
**Expected:** No question; finalize behaviour unchanged; mark stays NULL.
**Why human:** Role-conditional render plus a server no-op arm that has never been exercised live.

#### 3. ⚠️ HIGHEST RISK — zero-portfolio allocator allocates
**Test:** As an allocator with no `is_test=false` portfolio, mark a strategy own-capital, then Allocate… with an amount; allocate the same strategy again.
**Expected:** No dead end and no remedy modal; the route lazily creates the real book, then upserts; the row shows `$X · N.NN%` with [Edit allocation…]; the second allocate EDITS, never duplicates.
**Why human:** This rev-4 path depends on three DB-runtime facts no mocked test can observe — `portfolios_owner FOR ALL USING` being reused as the INSERT check, the `portfolios_one_real_per_user` partial unique index, and migration `20260806130000`'s SECURITY DEFINER repair (without which the parent INSERT aborts 42501).

#### 4. Flip own→team with a live allocation
**Test:** Change mark… → team review on an allocated strategy.
**Expected:** Inline confirm names the allocated amount; on confirm the one RPC removes the position and sets the mark; nothing stranded.
**Why human:** Client → route → plpgsql transaction arc; copy correctness and the absence of a silent removal are human judgements.

#### 5. Rename coherence + pseudonymity + published absence
**Test:** Rename from /my-strategies and from the factsheet masthead; check /my-strategies, Browse drawer, factsheet, Holdings row; confirm Rename… is absent on a published own row; confirm anon still 404s on the draft factsheet id after an owner views it.
**Expected:** New name coherent on every owner surface; public surfaces still render the codename; Rename… absent (not disabled) on published; anon 404.
**Why human:** Cross-surface coherence + the phase-148 cache-isolation adversarial case.

#### 6. TEST database state
**Test:** Confirm `20260806120000` and `20260806130000` are applied to `qmnijlgmdhviwzwfyzlc` and that all three `supabase/tests/test_*.sql` files exit 0 there.
**Expected:** All green; migration self-verify blocks NOTICE rather than RAISE.
**Why human:** External DB state; the verifier has no credentials. CI's `sql-tests` job enforces it at PR time but has not run on this branch yet.

---

### Gaps Summary

**No gaps.** Every ROADMAP success criterion is observably true in the codebase, verified independently of SUMMARY.md by reading the migration SQL, the routes, the adapter, the components and the wiring between them, and by re-running the full test suite, typecheck, lint and an independent write census.

The adversarial hypothesis for this phase — "tasks completed, goal missed" — was tested at the places it usually hides and did not hold:

- **Stub hunt:** every artifact is substantive (44–979 lines of real logic); no placeholder returns, no `=> {}` handlers, no `return null` bodies.
- **Wiring hunt:** the full server→client→route→DB chain was traced by hand for the money path (`page.tsx → AllocationsTabs {...props} → HoldingsTabPanel → toStrategyRows → HoldingsTable → AllocateDialog → POST → upsert`). No orphans.
- **Hollow-data hunt:** the Weight column is derived from real `allocated_amount`, not from an empty prop; `getOwnCapitalStrategies` issues a real filtered select; `hasAnyStrategies` is a real count. `null` appears where a fabricated `0` would have been the easy shortcut.
- **Claim hunt:** the two most falsifiable SUMMARY figures — "762 files / 11,080 passed" and "tsc clean, lint clean" — were re-run by the verifier and matched exactly.
- **Census hunt:** the "only three writers" claim was re-derived from a fresh repo-wide grep rather than read from the gate's allowlist.

Two INFO-level observations were recorded (a stale RLS comment in `finalize-wizard/route.ts`, and `MigrationWizard`'s unmapped 23514) — both documentation/UX-copy items well below the project's user-facing/data-integrity blocking bar, and neither touches the phase goal.

One truth (T7, migrations applied to TEST) is **UNCERTAIN** rather than FAILED: the artifacts exist and CI discovers them automatically, but the external database state is outside the verifier's reach. It is routed to human confirmation rather than counted against the phase.

Status is therefore `human_needed`, not `passed`: all automated evidence supports the goal, and six behavioural items — led by the never-runtime-exercised lazy-portfolio-provisioning path — require a human before this money surface is trusted.

---

_Verified: 2026-08-06T21:59:36Z_
_Verifier: Claude (gsd-verifier)_
