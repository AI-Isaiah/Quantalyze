# Phase 36 Plan Check

**Checked:** 2026-06-25
**Plans:** 36-01-PLAN.md (Wave 1), 36-02-PLAN.md (Wave 1), 36-03-PLAN.md (Wave 2)
**Checker stance:** Adversarial — assume plans fail until evidence proves otherwise.

---

## PLAN CHECK PASSED

All three plans, if executed as written, will achieve the phase goal. No blockers found. Two warnings and one informational note are recorded below.

---

## Verification by Dimension

### Dimension 1: Requirement Coverage

| Requirement | Phase Goal Fragment | Covered By | Status |
|-------------|--------------------|----|--------|
| UNIFY-01 | `queries.ts` reads persisted per-key dailies (not snapshot reconstruction) | 36-01 (type patch unblocks compile), 36-02 (frontmatter), 36-03 (Task 1 fetch + blend) | COVERED |
| UNIFY-02 | Equity curve = blend of per-key dailies through compute path | 36-03 Task 1 (`liveBaselineMetricsFromPerKeyDailies` via `computeScenario`) | COVERED |
| UNIFY-03 | Live HOLDINGS still read the poll/snapshot path | 36-03 Task 1 (acceptance criteria: allocator_holdings select + derivePhase07Fields unchanged; git diff guard) | COVERED |

All three requirement IDs appear in at least one plan's `requirements` frontmatter. 36-03 claims UNIFY-01/02/03 and its tasks address all three. 36-01 and 36-02 claim UNIFY-01 and their scope is correctly bounded.

### Dimension 2: Task Completeness

**36-01:** 1 task. Has `<files>`, `<action>`, `<verify>` (tsc --noEmit), `<acceptance_criteria>`, `<done>`. Complete.

**36-02:** 2 tasks. Both have all required elements.
- Task 1: files, behavior, action, verify (tsc), acceptance_criteria, done.
- Task 2: files, read_first, action, verify (vitest run + tsx), acceptance_criteria, done.

**36-03:** 2 tasks. Both have all required elements.
- Task 1: files, read_first, behavior, action, verify (tsc + vitest), acceptance_criteria, done.
- Task 2: files, read_first, behavior, action, verify (vitest), acceptance_criteria, done.

All tasks: COMPLETE.

### Dimension 3: Dependency Correctness

- 36-01: `depends_on: []`, wave 1. Correct — standalone type patch.
- 36-02: `depends_on: []`, wave 1. Correct — no dependency on 36-01 (GDPR manifest work is independent of the types patch; the manifest code does not read from `csv_daily_returns` TypeScript types).
- 36-03: `depends_on: ["36-01"]`, wave 2. Correct — the per-key typed read (`api_key_id, allocator_id`) in queries.ts requires the type patch from 36-01 to compile. 36-03 does not depend on 36-02 (the GDPR manifest is a separate file set).

Wave assignments are consistent. No cycles. No forward references.

**Note on 36-02 wave placement:** 36-02 is correctly wave 1 / no dependency on 36-01. The GDPR manifest (`gdpr-export-manifest.ts`) is pure runtime logic with no import of `database.types.ts`; the type patch in 36-01 is only needed for the `queries.ts` typed Supabase select in 36-03.

### Dimension 4: Key Links Planned

**36-01:**
- `database.types.ts` → migration `20260624120000_csv_daily_returns_per_key_axis.sql` (hand-patch mirrors the ALTER). Link: confirmed. The migration file exists at `supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql`.

**36-02:**
- `gdpr-export-manifest.ts` → `csv_daily_returns` (via projected spec, allocator_id axis). Link: specified in key_links.
- `check-gdpr-export-coverage.ts` → `csv_daily_returns_per_key` (SANITIZE_PARITY_ALLOWLIST). Link: specified.
- The Task 2 test pins that the `getOrderColumn` lookup returns "date" for the new projected spec via source_table inheritance — no edit to ORDER_COLUMN_OVERRIDES required (verified: manifest already maps `csv_daily_returns → "date"` at ~887).

**36-03:**
- `getMyAllocationDashboard` → `csv_daily_returns` (parallel fetch in Step-1 fan-out, `.eq(allocator_id, userId)`). Link: key_links + acceptance criteria grep.
- `queries.ts` → `computeScenario` (per-key blend builds StrategyForBuilder per api_key_id). Link: specified; frozen engine reused (SCENARIO-05).
- `liveBaselineMetrics` → `allocator_holdings` (AUM + per-key weights from holdingsSummary). Link: specified; pattern `holdingEquityContribution`.
- The D3 gate seam is wired: the plan computes `activeKeyIds` from the already-fetched `apiKeys` (which carries `id: string` per `MyAllocationDashboardPayload.apiKeys` type at ~1558-1573). `allActiveKeysHavePerKeyDailies` is then inserted before the two existing `liveBaselineMetricsFromHoldings` call sites (~2845 and ~3153), replacing both with the single computed value.

### Dimension 5: Scope Sanity

| Plan | Tasks | Files Modified | Wave | Assessment |
|------|-------|---------------|------|------------|
| 36-01 | 1 | 1 | 1 | Within budget |
| 36-02 | 2 | 3 | 1 | Within budget |
| 36-03 | 2 | 3 | 2 | Within budget |

Total: 5 tasks across 3 plans, 7 files. Well within thresholds.

### Dimension 6: Verification Derivation (must_haves)

**36-01 truths:** "A TS read of csv_daily_returns can project id / api_key_id / allocator_id and treat strategy_id as nullable without a type error." This is user-observable (compile-time correctness that unblocks 36-03) and falsifiable (tsc --noEmit).

**36-02 truths:**
- "An Art.15/20 export bundle includes per-key rows" — user/compliance-observable, falsifiable by the new test.
- "Strategy-scoped rows still export via existing indirect entry" — falsifiable.
- "Cross-allocator rows never appear" — falsifiable by the cross-allocator fixture in the test.
- "Coverage hook stays green" — falsifiable by `npx tsx check-gdpr-export-coverage.ts` exit code.

**36-03 truths:**
- "When every active key has a series → stats derive from per-key blend" — observable + falsifiable (per-key-vs-fallback divergence test).
- "When any active key lacks a series → whole allocator falls back" — falsifiable (the mixed-population test must fail if code blends half-and-half).
- "AUM unchanged" — falsifiable (both branches sum holdingEquityContribution).
- "liveBaselineMetrics shape byte-identical on both branches" — falsifiable (shape-identity assertion).
- "Holdings path provably untouched" — falsifiable (git diff guard in acceptance criteria + UNIFY-03 acceptance criterion).

All truths are user- or compliance-observable and falsifiable. PASS.

### Dimension 7: Context Compliance

All CONTEXT.md locked decisions D1–D7 are addressed:

| Decision | Coverage |
|----------|---------|
| D1 — blend unit = per api_key_id | 36-03 Task 1: one StrategyForBuilder per api_key_id |
| D2 — AUM from holdings; curve/KPIs from per-key blend | 36-03 Task 1: AUM = Σ holdingEquityContribution; curve from computeScenario |
| D3 — all-or-nothing fallback per allocator | 36-03 Task 1 + Task 2 (allActiveKeysHavePerKeyDailies predicate + mixed-population test) |
| D4 — GDPR per-key axis (projected spec on allocator_id) | 36-02 Task 1 (spec) + Task 2 (allowlist + test) |
| D5 — database.types.ts hand-patch | 36-01 Task 1 |
| D6 — backfill = post-deploy operational step | 36-03 verification section (post-deploy note, not a code task — correct per D6) |
| D7 — /compare holding-compare-adapter stays on snapshots | Not touched by any plan (out of scope, correctly excluded) |

No deferred ideas are implemented. No locked decisions are contradicted.

**Scope reduction scan:** No "v1", "static for now", "stub", "future enhancement", or similar hedging language found in any task action. The blend is wired live through computeScenario. The GDPR export includes actual allocator_id-scoped rows. The fallback is real fallback logic, not a placeholder. No scope reduction detected.

### Dimension 7b: Scope Reduction Detection — PASS

The per-key blend in 36-03 routes through the frozen `computeScenario` engine — not a stub. The D3 gate is a real predicate (`allActiveKeysHavePerKeyDailies`), not a hardcoded true/false. The GDPR spec (36-02) produces a real `.eq(allocator_id, userId)` query with a re-filter projection, not a static list.

### Dimension 7c: Architectural Tier Compliance — PASS

The per-key fetch in 36-03 uses the user supabase client with `.eq("allocator_id", userId)` and relies on the owner RLS policy (`allocator_id = auth.uid()`). This correctly keeps tenant isolation at the DB tier. The threat register in 36-03 explicitly marks the admin client as NOT to be used for this read (T-36-03-01). PASS.

### Dimension 8: Nyquist Compliance

All tasks have `<verify>` elements with `<automated>` commands:

| Task | Plan | Automated Command | Status |
|------|------|-------------------|--------|
| Task 1 | 36-01 | `npx tsc --noEmit` | Present |
| Task 1 | 36-02 | `npx tsc --noEmit` | Present |
| Task 2 | 36-02 | `npx vitest run ... && npx tsx ...` | Present |
| Task 1 | 36-03 | `npx tsc --noEmit && npx vitest run ...` | Present |
| Task 2 | 36-03 | `npx vitest run ...` | Present |

All verify commands are concrete, synchronous (no watch mode), and expected to complete in seconds. PASS.

### Dimension 9: Cross-Plan Data Contracts — PASS

No conflicting data transformations across plans. 36-01 patches types; 36-02 edits the GDPR manifest; 36-03 reads `csv_daily_returns`. None of these touch the same data pipeline or transform the same entity. The `liveBaselineMetrics` output contract is the only shared artifact between 36-03 and downstream consumers (Phase 37), and the plan explicitly guards it as byte-identical on both branches.

### Dimension 10: CLAUDE.md Compliance — PASS

CLAUDE.md mandates: read before write (all tasks have `<read_first>`), simplicity first (plans are additive-only, no rewrites of existing functions), surgical changes (36-01 touches only the csv_daily_returns block, 36-03 does not modify reconstructHoldingReturnsByScopeRef or liveBaselineMetricsFromHoldings), tests verify intent not just behavior (falsifiable assertions specified for each branch and the honesty guard), fail loud (D3 gate asserts mixed population falls back — never silently blends).

No banned packages. No forbidden patterns.

### Dimension 11: Research Resolution — SKIPPED (no RESEARCH.md for phase 36)

### Dimension 12: Pattern Compliance — SKIPPED (no PATTERNS.md for phase 36)

---

## Adversarial Checks (from verification_dimensions in prompt)

### 1. Goal achievement: does the equity curve actually come from the per-key blend?

**Verdict: YES.** 36-03 Task 1 constructs `liveBaselineMetricsFromPerKeyDailies` which: (a) builds one StrategyForBuilder per api_key_id from `csv_daily_returns` rows, (b) runs the frozen `computeScenario` engine, and (c) replaces BOTH existing `liveBaselineMetricsFromHoldings(...)` call sites at ~2845 and ~3153 with the single computed value. The acceptance criteria grep for `liveBaselineMetricsFromPerKeyDailies` and the requirement that `reconstructHoldingReturnsByScopeRef` body is unchanged confirm the snapshot reconstruction is not consulted in the per-key branch.

The per-key-vs-fallback divergence test (Task 2, behavior clause a) explicitly asserts the result "differs from the snapshot reconstruction for a fixture where the two bases disagree." A test that can only pass if the per-key fetch is actually routed into the displayed curve.

### 2. D3 all-or-nothing fallback: falsifiable mixed-population test?

**Verdict: YES.** 36-03 Task 2 behavior specifies: "Mixed-population honesty (D3): an allocator with key A having per-key rows and active key B having NONE takes the FALLBACK — never a half-per-key/half-snapshot blended curve. Assert the result equals the snapshot-fallback result ... and is NOT the per-key blend." The action instructs: "Make every new assertion falsifiable: a mixed-population test must FAIL if the code blends half-per-key/half-snapshot." This is a true honesty guard — it would catch a naive implementation that checks "any key has rows" instead of "every active key has rows."

### 3. liveBaselineMetrics output contract byte-identical?

**Verdict: ADEQUATELY PINNED.** The shape-identity assertion (Task 2, behavior clause d + getMyAllocationDashboard.scenario.test.ts) asserts "identical key sets + value types (aum:number, ytdTwr/sharpe/maxDd/avgRho:number|null, equity/drawdown:array)" on both branches. The action instructs exporting `liveBaselineMetricsFromPerKeyDailies` for unit testing and mirroring the empty-default logic. This is sufficient — it catches any branch that drops or renames a payload field.

### 4. UNIFY-03 holdings-untouched: is there a concrete checkable assertion?

**Verdict: YES, but layered.** 36-03 Task 1 acceptance criteria item 4 states: "The allocator_holdings select string + derivePhase07Fields are unchanged (UNIFY-03)." The plan's `<verification>` section states: "`git diff src/lib/queries.ts` shows the allocator_holdings fetch + derivePhase07Fields + reconstructHoldingReturnsByScopeRef + liveBaselineMetricsFromHoldings bodies unchanged (only additions)." This is a concrete, executor-checkable git diff assertion — not just prose. Combined with the tsc pass and vitest tests that exercise the holdings-derived AUM on both branches, this is sufficient.

### 5. GDPR 36-02: three-way test + coverage hook?

**Verdict: YES.** Task 2 action item 2 specifies a fixture of exactly [per-key row allocator_id=subject, per-key row allocator_id=OTHER, strategy row allocator_id=null] asserting: (a) subject per-key row included, (b) cross-allocator row dropped, (c) strategy row dropped (exported via other axis). The manifest dual-axis scan (both indirect and projected entries present) guards against a future refactor dropping either axis. The `npx tsx check-gdpr-export-coverage.ts` exit-0 acceptance criterion covers the coverage hook. PASS.

The one subtle issue checked: does 36-02 Task 2's test prove **strategy rows still export** (not just that the new projected spec exports per-key rows)? Reading carefully: "assert by scanning USER_EXPORT_TABLES ... so a future refactor that drops either axis fails loudly." This scans that the `kind:"indirect"` entry is still present, which is the correct guard that strategy-scoped rows are still covered by the indirect axis. PASS.

### 6. Wave/dependency correctness: 36-03 depends on 36-01; 36-01 ∥ 36-02 have no file overlap?

**Verdict: CORRECT.** 36-01 modifies only `database.types.ts`. 36-02 modifies `gdpr-export-manifest.ts`, `check-gdpr-export-coverage.ts`, and creates `__tests__/gdpr-export-per-key-dailies.test.ts`. Zero file overlap between 36-01 and 36-02; they can safely execute in parallel (Wave 1). 36-03 modifies `queries.ts`, `queries.my-allocation.test.ts`, and `__tests__/getMyAllocationDashboard.scenario.test.ts` — no overlap with 36-01 or 36-02's output files. The wave-2 dependency on 36-01 is correct (the typed `api_key_id` select in queries.ts requires the type patch).

### 7. Anti-shallow: read_first coverage?

**Verdict: ADEQUATE.** Every task has a `<read_first>` block listing the specific files and line-ranges to read before writing. 36-03 Task 1 lists: `reconstructHoldingReturnsByScopeRef (~2002-2044)`, `liveBaselineMetricsFromHoldings (~2099-2209)`, `holdingEquityContribution (~2081-2091)`, the payload type, the Step-1 fan-out, `assertOk`, both liveBaselineMetricsFromHoldings call sites (~2845 and ~3153), `apiKeys / is_active` usage, `computeScenario` signatures, and the migration. This is the minimum needed to write the seam correctly. 36-02 Task 1 lists the ProjectedUserTable interface, the existing indirect entry, ORDER_COLUMN_OVERRIDES, and a pattern analogue for the project fn. PASS.

### 8. computeScenario: frozen engine reused, not forked?

**Verdict: YES.** 36-03 Task 1 states explicitly: "Do NOT modify ... computeScenario." The read_first for Task 1 lists `src/lib/scenario.ts` for "signatures (the frozen engine — reuse, do not edit)". The objective block: "`computeScenario` is the FROZEN engine (SCENARIO-05) — reuse, never fork." The plan's `<verification>` block references `git diff` showing no edits to the engine. PASS.

### 9. AUM sourced from holdings (D2), not from per-key returns?

**Verdict: YES.** 36-03 Task 1 behavior: "AUM = Σ holdingEquityContribution(all holdings)" on both branches. Per-key weights = Σ holdingEquityContribution over holdings with that api_key_id (grouped from holdingsSummary). The per-key returns series is used only for the curve shape and KPIs — not to compute AUM. The key_links entry confirms: "AUM + per-key weights still sourced from holdingsSummary (api_key_id grouped)." PASS.

---

## Issues Found

### WARNING (2)

**W1 — [scope_sanity] 36-03 Task 1 limit cap is under-specified**

The action says cap the per-key fetch with `.limit(...)` "consistent with the snapshot cap (730 = 2yr) scaled by key count, or a sane fixed cap; pick a bound that cannot grow unbounded." This leaves the executor to choose. The THREAT register (T-36-03-03) calls this out but the action language is ambiguous — "scaled by key count" (dynamic limit) vs "sane fixed cap" (static limit). A dynamic `730 * keyCount` limit is correct in intent but imposes a per-execution query cap that depends on runtime data; a fixed high cap (e.g., 3650 = 10yr * 1 key, or per-key grouped fetch with `.limit(730)` per key) is simpler and equally correct.

This does not block execution — the executor will pick one of the valid options — but the ambiguity could produce a suboptimal approach (e.g., a single `.limit(730)` that silently truncates a multi-key allocator to fewer than 2 years per key).

Fix hint: In Task 1 action item 1, specify the limit strategy explicitly. Recommended: fetch all per-key rows for the allocator (`.limit(730 * 10)` as a hard ceiling with a comment, or structure as a single query with the cap documented). Alternatively: the per-key blend only needs the same 2-year window as the snapshot path — `.limit(730)` per key group. A flat `.limit(7300)` ceiling with a comment "730 days * 10 keys upper bound" is the simplest safe choice.

Severity: WARNING — execution can proceed; a wrong limit could silently truncate history for allocators with many keys, producing a shorter curve than expected. Not a blocker.

**W2 — [key_links_planned] 36-03 does not explicitly cover the !portfolio return branch**

The plan's action item 4 says "Replace the two inline `liveBaselineMetricsFromHoldings(...)` calls with the single computed value." This correctly covers both branches (~2845 and ~3153). However, the !portfolio branch at ~2845 returns early BEFORE Step 2 (the portfolio-specific fetch); the per-key fetch is added to Step-1's Promise.all at ~2404-2491, so the per-key data IS available in the !portfolio branch. This is correct. The concern is that the !portfolio branch comment at ~2829-2831 says "liveBaselineMetrics carries aum=0 (no holdings → no AUM)" — an allocator with no real portfolio but api_keys + per-key rows would get the per-key blend, which is the correct behavior. The plan does not explicitly call out that the !portfolio branch will also benefit (and correctly so) from the D3 gate. This is minor — not an actual gap — but a future reader of the plan might not realize this.

Fix hint: In Task 1 action item 4, add a note: "The !portfolio early-return branch (~2845) also replaces its liveBaselineMetricsFromHoldings call with the computed value — an allocator with no real portfolio but all active keys covered by per-key rows should get the per-key blend, not the snapshot fallback."

Severity: WARNING — execution can proceed; the plan's action "replace both calls" is correct. This is a documentation gap, not a logic gap.

---

### INFORMATIONAL (1)

**I1 — [verification_derivation] 36-01 Insert type for `id` — convention ambiguity**

36-01 Task 1 action says: "add `id?: never` (IDENTITY GENERATED ALWAYS — never client-supplied, matching the repo's existing convention for identity surrogate PKs; if no such precedent exists in this file, use `id?: number`)". The executor needs to read the existing file to pick the convention. This is correctly flagged in the plan's own action text. The database.types.ts currently has `id: string` (UUID) patterns on most tables and does not appear to have a `GENERATED ALWAYS AS IDENTITY` bigint pattern yet. The executor will use `id?: number` per the fallback clause, which is correct.

No fix required — the plan handles this correctly with its fallback clause.

---

## Summary

| Dimension | Status |
|-----------|--------|
| 1 — Requirement Coverage | PASS |
| 2 — Task Completeness | PASS |
| 3 — Dependency Correctness | PASS |
| 4 — Key Links Planned | PASS |
| 5 — Scope Sanity | PASS |
| 6 — Verification Derivation | PASS |
| 7 — Context Compliance (D1–D7) | PASS |
| 7b — Scope Reduction Detection | PASS |
| 7c — Architectural Tier Compliance | PASS |
| 8 — Nyquist Compliance | PASS |
| 9 — Cross-Plan Data Contracts | PASS |
| 10 — CLAUDE.md Compliance | PASS |
| 11 — Research Resolution | SKIPPED |
| 12 — Pattern Compliance | SKIPPED |
| Adversarial: goal achievement | PASS |
| Adversarial: D3 mixed-population test | PASS |
| Adversarial: output contract identity | PASS |
| Adversarial: UNIFY-03 holdings untouched | PASS |
| Adversarial: GDPR three-way test | PASS |
| Adversarial: wave/dependency | PASS |
| Adversarial: computeScenario frozen | PASS |
| Adversarial: AUM from holdings | PASS |

**Blockers: 0**
**Warnings: 2** (W1: limit cap under-specified; W2: !portfolio branch not explicitly called out)
**Info: 1** (I1: `id?: never` vs `id?: number` convention self-handled)

Plans may proceed to execution. The two warnings are addressable in-execution without a plan revision.
