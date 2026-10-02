# Phase 22: Methodology-Honesty Scaffolding - Research

**Researched:** 2026-06-21
**Domain:** Brownfield TS lib primitive + in-place UI copy upgrade (Next.js 16 / React 19 client components, Vitest 4 + local ESLint plugin)
**Confidence:** HIGH (all findings verified by direct codebase reads; no external-library uncertainty — zero new deps)

## Summary

Phase 22 is **mostly a pure TypeScript lib primitive plus two surgical copy upgrades**, not a feature build. The entire phase touches four files and adds two:

1. **HONEST-01** — upgrade the already-shipped Phase-21 coverage caveat (`data-testid="scenario-coverage-caveat"`) in *both* `ScenarioComposer.tsx:1059-1068` and `ScenarioBuilder.tsx:296-303` so it reads the canonical methodology line `Historical realized · {N} overlapping days · not a forecast` while *retaining* the existing `Projected from {n}…/Shortest history: {name}.` semantics and the testid (so Phase-21 tests stay green).
2. **HONEST-02** — a new pure module `src/lib/sample-floor.ts` (mirroring `scenario-history.ts`: no fetch, no side effects, no time reads, single well-tested export surface) exporting a named floor constant (default **60 overlapping days**), a gate predicate, and the below-floor empty-state reason strings; consumed for the below-floor empty state in this phase and exported for Phases 26/27.

The hardest correctness work is the **regression-pin / single-source enforcement** (point 5). The repo already has *two* mature, complementary single-source mechanisms — a **constant + parity test** (`min-history.ts`, `FLAG_COMPOSITE_THRESHOLD`) and a **local ESLint AST rule + RuleTester test** (`tools/eslint-plugin-quantalyze/rules/no-raw-staleness-derivation.mjs`). My primary recommendation: ship the floor as a clearly-named exported constant in `sample-floor.ts`, pin it with a Vitest regression test (the gate behavior + the constant value), and register `sample-floor.test.ts` in the `CONTRACT_GUARDS` registry. A bespoke ESLint rule (`no-raw-sample-floor`) is **optional and likely over-engineering for this phase** — recommend deferring it to Phase 26/27 when there are actual consumers to over-flag against, per the project's own precedent of declining speculative lint rules over already-closed finding-classes (B16/B17 declines).

There are **no new dependencies, no migrations, no Python**. The frozen engine already nulls every degenerate output; the gate's job is to treat `null`/`NaN` `n` and `n < floor` and 0/1 strategy as below-floor.

**Primary recommendation:** Build `src/lib/sample-floor.ts` as a pure module modeled byte-for-byte on `scenario-history.ts` conventions; pin the floor + gate with a Vitest test registered in `CONTRACT_GUARDS`; upgrade the two caveat lines in place keeping the testid; reuse the `CorrelationHeatmap.tsx:188-190` empty-state shell verbatim. Skip a new ESLint rule this phase.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**HONEST-01 — per-stat method disclosure:**
- Mechanism: upgrade the existing Phase-21 projection caveat into a canonical methodology line `{method} · {N} overlapping days · not a forecast` — one honest line per projection block (NOT a tooltip on every KPI cell).
- Method label for current scenario stats: **`Historical realized`** — the engine computes realized statistics over the overlap window; label the ACTUAL method (bootstrap is Phase 27, do not claim it here).
- Horizon wording: **`not a forecast`**.
- Scope: BOTH the own-book composer (`ScenarioComposer`) AND the `/scenarios` Sandbox (`ScenarioBuilder`).
- Compose with the existing Phase-21 caveat (`Projected from N overlapping days. Shortest history: {name}.`) — fold method + horizon into ONE coherent disclosure, do not stack two separate lines.

**HONEST-02 — shared minimum-sample floor gate:**
- Location: new pure module `src/lib/sample-floor.ts` — no fetch / no side effects / no time reads (mirrors `scenario-history.ts`). The SINGLE source of truth.
- Default floor: **60 overlapping days** for distributional/tail outputs (conservative, tunable). Distinct from — and does NOT replace — Phase 21 correlation's existing 10-day bar.
- Tunability: a named default constant + an optional per-call override parameter (Stress/MC default to the shared floor but may pass their own).
- Below-floor empty state: a shared honest empty state that NAMES the actual N and the floor — reused by 26/27.
- Export shape: a floor constant, a gate predicate (e.g. `isBelowSampleFloor(n, floor?)` or richer `evaluateSampleFloor(...)` returning `{ ok, n, floor, reason }`), and the empty-state reason string. **Planner picks the exact signature; keep it minimal and reuse-friendly.**

**Degenerate inputs + single-source enforcement:**
- The gate routes ALL of: 0/1 strategy, below-floor overlap, AND non-finite returns → the honest empty state. (The frozen engine already nulls non-finite returns; the gate must treat a null/NaN `n` as below-floor, NEVER as a passing value.)
- Single-source enforcement: a **regression test pins the floor constant + gate behavior** so Phases 26/27 reuse it; no second floor definition. (A lint/grep guard against re-declaring a floor is acceptable but **optional — the test is the gate.**)
- Do NOT retrofit Phase 21's `<10`-overlapping-day correlation empty state onto this floor — correlation is a separate, lower statistic-specific threshold. Avoid scope creep / collision.

### Claude's Discretion
- Exact gate function signature/return shape.
- The precise methodology-line composition with the existing caveat.
- The empty-state copy wording (within the UI-SPEC Copywriting Contract bounds — must name actual N and the floor, never "No data", never fabricate a number).

### Deferred Ideas (OUT OF SCOPE)
- Actually consuming the floor in Stress (Phase 26) and Monte-Carlo (Phase 27) — this phase only builds + pins the primitive and applies HONEST-01 disclosure; consumers come later.
- Per-statistic distinct floors (e.g. VaR vs MC) — single shared default now; per-call override is the escape hatch.
- Unifying the correlation 10-day bar with the 60-day floor — explicitly out of scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HONEST-01 | Every projected stat surfaces its method + overlapping-N + horizon (e.g. "Historical realized · 412 overlapping days · not a forecast") | Two existing caveat sites located + their exact render documented (Component Contracts §1); `ComputedMetrics.n` semantics confirmed (Architecture §Engine); testid + token preservation rules documented (Pitfall 1). |
| HONEST-02 | A shared minimum-sample gate (tunable floor, conservative default for distributional/tail) renders an honest empty state below the floor — reused by Stress and MC | `scenario-history.ts` convention model captured; engine degenerate-output table built (so gate maps null/NaN/0/1/`<floor`→below); single-source regression-pin mechanism identified (constant+test, registered in `CONTRACT_GUARDS`); empty-state shell located at `CorrelationHeatmap.tsx:188-190`. |

## Project Constraints (from CLAUDE.md / AGENTS.md / DESIGN.md)

- **Next.js 16, React 19** (`next ^16.2.3`, `react 19.2.4`). AGENTS.md: "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before any code. **Relevance to this phase: LOW** — no new routes, no cache-component work, no server actions. Both touched files are existing client components (`ScenarioComposer` is a `next/dynamic({ ssr:false })` chunk; `ScenarioBuilder` is a client component). The new lib is framework-agnostic pure TS.
- **Coverage is a BLOCKING CI gate** (CLAUDE.md tech-debt #11): lines 82 / statements 80 / functions 74 / branches 72 in `vitest.config.ts`. The new lib + UI changes MUST ship with tests. A new exported function with no test will drag function/branch coverage toward the ratchet — pin every branch of the gate.
- **DESIGN.md is the single source of truth for visuals.** This phase introduces NO new token (UI-SPEC confirms). All copy lives in PINNED Phase-21 tokens (`mt-2 text-[11px] text-text-muted`; empty-state `rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm` + `font-semibold text-text-secondary` heading + `mt-1 text-[11px]` body).
- **Skill routing (CLAUDE.md):** none of the routing triggers (ship/qa/review/investigate/tech-debt) apply to a plan-phase research pass.
- **No `.claude/skills/` project skills dir relevant to this phase was found** (the routing table references gstack skills, not local rule files gating lib authoring).
- **Tests verify intent, not behavior (Rule 9 + Rule 12 fail-loud):** the single-source regression test must FAIL when neutered (a future feature hardcoding `60` instead of importing the constant must break a test) — mirror the project's "prove it fails when neutered" convention.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Methodology-line copy (HONEST-01) | Browser / Client (React render) | — | Pure presentational string composed from `ComputedMetrics.n` (already client-side) + a static method label. No server round-trip; reuses an existing client-rendered `<p>`. |
| Sample-floor gate primitive (HONEST-02) | Pure lib (`src/lib/`) | Consumed by Browser/Client | A pure, side-effect-free decision function — same tier as `scenario.ts` / `scenario-history.ts`. Deliberately framework-free so Stress/MC (and a possible future SSR caller) can import it. |
| Below-floor empty state render | Browser / Client | — | Presentational card reusing the `CorrelationHeatmap` shell; routed by the lib gate's verdict. |
| Single-source regression pin | Test tier (Vitest) + CI registry | — | `sample-floor.test.ts` + `CONTRACT_GUARDS` entry; an optional ESLint AST rule would live in `tools/eslint-plugin-quantalyze/` (lint/CI tier). |

**No API / Backend / Database / Python tier work this phase.** The frozen engine (`scenario.ts`) is read-only. No migration. The Python `analytics-service` is NOT touched (its existing `min_overlap_days` match-engine floor is a different concept — see Pitfall 3).

## Standard Stack

**Zero new dependencies.** This phase is implemented entirely with the existing toolchain.

### Core (already installed — verified in `package.json`)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | ^16.2.3 [VERIFIED: package.json] | Host framework (client components only here) | Project standard; no new framework surface used |
| `react` | 19.2.4 [VERIFIED: package.json] | Client component render | Project standard |
| `vitest` | ^4.1.2 [VERIFIED: package.json] | Unit + regression-pin tests, RuleTester host | The project's sole TS test runner; coverage gate runs through it |
| `eslint` | (via `eslint-config-next`) [VERIFIED: eslint.config.mjs] | Hosts the local `eslint-plugin-quantalyze` if a rule is added | Already wired; `RuleTester` from `eslint` runs under Vitest |

### Supporting (existing in-repo modules — reuse, do not rebuild)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/lib/scenario.ts` (FROZEN) | Source of `ComputedMetrics.n`, `effective_start/end` | Read-only input to both HONEST-01 line and HONEST-02 gate |
| `src/lib/scenario-history.ts` | Structural convention model for the new pure lib | Mirror its export/test shape for `sample-floor.ts` |
| `src/components/portfolio/CorrelationHeatmap.tsx` | Empty-state shell (lines 188-190) + reason-routing pattern (lines 170-192) | Copy the card markup verbatim for the below-floor empty state |
| `tools/eslint-plugin-quantalyze/` | Local ESLint AST-rule infra (5 rules + RuleTester tests) | ONLY if planner elects the optional lint guard |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Vitest constant+gate regression test (recommended) | A new `no-raw-sample-floor` ESLint AST rule | Lint rule is the strongest *edit-time* drift guard but is speculative this phase (no real consumers yet to over-flag); the project explicitly declines speculative lint rules over closed/empty finding-classes (B16/B17). Add the rule in Phase 26/27 alongside the first real consumer if drift becomes a live risk. |
| `evaluateSampleFloor(...)` returning a rich `{ ok, n, floor, reason }` | A bare `isBelowSampleFloor(n, floor?)` predicate | Richer return lets the UI pick reason copy without re-deriving the degenerate class; bare predicate is leaner but forces the caller to re-classify 0/1-strategy vs null-N vs `<floor`. **Recommend the richer shape** — the UI-SPEC defines three distinct empty-state bodies keyed on those exact sub-reasons. |

**Installation:** none — no `npm install`.

## Package Legitimacy Audit

> Not applicable — this phase installs **zero external packages**. No registry interaction, no slopcheck needed. All modules are first-party in-repo (`@/lib/*`) or already-installed devDependencies (`vitest`, `eslint`).

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────────────────────────────┐
                          │  src/lib/scenario.ts (FROZEN — read only)      │
                          │  computeScenario(...) → ComputedMetrics        │
                          │    .n  (overlapping days; 0 | <10-null | N)    │
                          │    .effective_start / .effective_end           │
                          └───────────────┬──────────────────┬─────────────┘
                                          │ n (number)       │ n
                       ┌──────────────────▼────────┐   ┌─────▼───────────────────────┐
                       │ HONEST-01 methodology line │   │ HONEST-02 sample-floor gate  │
                       │ (presentational, in-place) │   │ src/lib/sample-floor.ts (NEW)│
                       │                            │   │  FLOOR const (60)            │
                       │ "Historical realized · {n} │   │  evaluateSampleFloor(n,floor?)│
                       │  overlapping days · not a  │   │   → { ok, n, floor, reason } │
                       │  forecast[. Shortest       │   │  reason copy strings         │
                       │  history: {name}.]"        │   └─────┬───────────────┬────────┘
                       │                            │         │ ok=true       │ ok=false
                       │ Rendered in BOTH:          │         │ (≥floor)      │ (0/1 strat,
                       │  • ScenarioComposer:1059   │         │               │  null/NaN n,
                       │  • ScenarioBuilder:296     │         ▼               │  n<floor)
                       └────────────────────────────┘   (normal projection)  ▼
                                                                    ┌─────────────────────────────┐
                                                                    │ Below-floor honest empty     │
                                                                    │ state — reuse shell from     │
                                                                    │ CorrelationHeatmap:188-190   │
                                                                    │ heading + body NAME n + floor│
                                                                    └─────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │ SINGLE-SOURCE PIN (CI / test tier)                                                 │
   │  src/lib/sample-floor.test.ts  — pins FLOOR value + every gate branch              │
   │  → registered in src/__tests__/contracts/contracts-registry.test.ts CONTRACT_GUARDS│
   │  (fail-loud if dropped). Exported FLOOR is the only definition; 26/27 import it.    │
   └──────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
src/lib/
├── scenario.ts              # FROZEN engine (read-only this phase)
├── scenario-history.ts      # convention model for the new module
├── scenario-history.test.ts # convention model for the new test
├── sample-floor.ts          # NEW — pure gate primitive (HONEST-02 SoT)
└── sample-floor.test.ts     # NEW — regression pin (constant + gate branches)
```

### Pattern 1: Pure-lib convention (mirror `scenario-history.ts`)
**What:** Module-level doc comment stating the pure-TS invariant verbatim, a single named export (or a small cohesive set), explicit degenerate-case handling that never throws, deterministic behavior.
**When to use:** `sample-floor.ts`.
**Example:**
```typescript
// Source: src/lib/scenario-history.ts:1 (verbatim convention header)
/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 * ...
 */
export function shortestHistoryName(
  strategies: ReadonlyArray<StrategyForBuilder>,
): string | null { /* never throws; degenerate → null */ }
```
The new `sample-floor.ts` should open with the same `Pure TypeScript — no fetch, no side effects, no DOM/time reads.` line and document each degenerate route inline.

### Pattern 2: Reason-routed honest empty state (mirror `CorrelationHeatmap`)
**What:** A shared card shell whose BODY copy is selected by the *specific* degenerate reason, so the allocator knows what to fix. Heading shared, body branched.
**When to use:** the below-floor empty state.
**Example:**
```tsx
// Source: src/components/portfolio/CorrelationHeatmap.tsx:187-192 (PINNED shell)
<div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
  <div className="font-semibold text-text-secondary">{reasonHeading}</div>
  <div className="mt-1 text-[11px]">{body}</div>
</div>
```
The reason-routing precedence in `CorrelationHeatmap.tsx:180-186` (check `tooFewDays` first, then `tooFewStrategies`, then combined) is the model for the below-floor gate's three UI-SPEC bodies (null/NaN-N route, 0/1-strategy route, `<floor` route).

### Pattern 3: Single-source constant + parity/regression test (mirror `FLAG_COMPOSITE_THRESHOLD` / `min-history.ts`)
**What:** Export the magic number ONCE as a named `const` with a self-documenting comment; a test imports the constant and asserts its value + asserts behavior keyed on it. For cross-runtime parity, a test reads the *other* runtime's source via `readFileSync` + regex and asserts equality.
**When to use:** pinning the 60-day floor.
**Example:**
```typescript
// Source: src/app/(dashboard)/allocations/lib/holding-outcome-adapter.test.ts:101-112
describe("FLAG_COMPOSITE_THRESHOLD parity (finding f5)", () => {
  it("SSR constant equals 50 (D-06 + RESEARCH A3)", () => {
    expect(FLAG_COMPOSITE_THRESHOLD).toBe(50);
  });
  // ...reads analytics-service/routers/match.py via regex for cross-runtime parity
});
```
For HONEST-02 there is **no Python counterpart this phase** (Pitfall 3), so a pure TS value+behavior pin suffices: `expect(SAMPLE_FLOOR_OVERLAPPING_DAYS).toBe(60)` plus branch assertions on `evaluateSampleFloor`.

### Anti-Patterns to Avoid
- **Re-declaring the floor in a consumer:** Phases 26/27 must `import { SAMPLE_FLOOR_OVERLAPPING_DAYS }`, never write `const floor = 60`. The regression pin exists to break this.
- **Routing correlation through `sample-floor.ts`:** correlation's 10-day bar lives in the frozen engine (`scenario.ts:192`) and `CorrelationHeatmap`'s `< 10` check. Do NOT unify (CONTEXT + UI-SPEC explicit).
- **Treating `n` as the only degenerate signal:** the engine returns `n` (a real number) even when all metrics are null (`<10` days, non-finite). The gate must NOT pass a value just because `n >= floor` if metrics are null/NaN — but per CONTEXT, the primary contract is: null/NaN `n` → below-floor; 0/1 strategy → below-floor; `n < floor` → below-floor. (See Pitfall 2 for the subtlety that `n` can be `>= 60` while metrics are nulled by the non-finite guard — clarify with planner whether the gate keys on `n` alone or also on metric nullity.)
- **Stacking two caveat lines:** fold method + N + horizon into the ONE existing caveat `<p>` (CONTEXT explicit), do not add a second `<p>`.
- **Switching inline `{N}` to Geist Mono:** the shipped caveat renders `{n}` in DM Sans inside running prose; the UI-SPEC forbids switching it to `.font-metric` (would break Phase-21 tests).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shortest-history strategy name | A new loop over `daily_returns.length` | `shortestHistoryName()` (`scenario-history.ts`) — already wired at both call sites | Unit-tested, tiebreak-deterministic, degenerate-safe; re-implementing risks a divergent tiebreak |
| Overlapping-day count | Re-deriving `n` from dates | `ComputedMetrics.n` (frozen engine) | The engine is the SoT; the caveat already reads `scenarioMetrics.n` / `metrics.n` |
| Empty-state card | A new bespoke card | `CorrelationHeatmap.tsx:188-190` shell verbatim | UI-SPEC pins this; new card would fork the visual language and trip the design-review |
| The floor magic number in any consumer | `const floor = 60` per feature | `import { SAMPLE_FLOOR_OVERLAPPING_DAYS }` | The whole point of HONEST-02 single-source |
| Edit-time drift guard | A grep test inventing its own AST traversal | The existing `eslint-plugin-quantalyze` + `RuleTester` infra (IF a rule is added) | Established, tested, registry-tracked — but optional this phase |

**Key insight:** Every primitive HONEST-01/02 needs already exists in the repo. The phase is *composition + a thin new gate*, not invention.

## Common Pitfalls

### Pitfall 1: Regressing the Phase-21 caveat content or testid
**What goes wrong:** Replacing the caveat text wholesale drops the `Projected from {n}…/Shortest history: {name}.` content (or the `data-testid="scenario-coverage-caveat"`), failing existing Phase-21 tests and re-introducing the "phantom strategy" risk.
**Why it happens:** The methodology-line copy looks like a clean replacement, but CONTEXT/UI-SPEC require *folding* (compose into the same line) — keep the conditional shortest-history clause (`coverageShortestName !== null` in composer; `shortestName` in builder) and keep the testid.
**How to avoid:** Edit the *contents* of the existing `<p data-testid="scenario-coverage-caveat" className="mt-2 text-[11px] text-text-muted">` at `ScenarioComposer.tsx:1059` and `ScenarioBuilder.tsx:296`; do not delete and re-create the element. Add a Phase-22 assertion for the `Historical realized` substring without removing Phase-21 assertions.
**Warning signs:** Phase-21 caveat tests turn red; the rendered line stacks two paragraphs; the inline `{n}` renders in mono.

### Pitfall 2: Gate mis-classifies a `n >= floor` scenario whose metrics are nulled
**What goes wrong:** The frozen engine returns a real `n` (e.g. 200) but nulls ALL metrics when returns are non-finite or a day ≤ −100% (`scenario.ts:281-297`). A gate keying ONLY on `n >= 60` would PASS such a scenario and let the UI try to render a distributional/tail estimate on nulled inputs.
**Why it happens:** CONTEXT frames the gate around `n` ("treat null/NaN `n` as below-floor"), but the engine's `n` is non-null even in the non-finite-metrics case — only the *metrics* are null, not `n`.
**How to avoid:** Decide explicitly (planner): the cleanest contract for THIS phase is that the *caller* passes the gate the value it intends to gate on (the overlapping-day count for the floor check) AND the gate independently guards `Number.isFinite(n)` and `n >= 2`-strategy semantics. Since the only Phase-22 consumer is the below-floor empty state and the *real* consumers are 26/27 (which will compute their own distributional inputs), the gate's contract should be: `evaluateSampleFloor(n, floor?)` returns below-floor for `n == null`, `!Number.isFinite(n)`, `n < floor`. The 0/1-strategy and non-finite-*returns* cases route to below-floor at the *call site* (the caller already knows strategy count and whether the engine nulled metrics). Document this boundary in the module doc comment so 26/27 know the gate is a *floor check on a finite overlapping-day count*, not a full degenerate-input classifier.
**Warning signs:** A test where `n=200` but `correlation_matrix===null` passes the gate.

### Pitfall 3: Colliding with existing min-history / overlap concepts
**What goes wrong:** Re-using or duplicating an existing threshold name, or wiring the new floor onto the wrong surface.
**Why it happens:** The repo already has THREE distinct min-sample concepts:
- `src/lib/min-history.ts` — `CORRELATION_90D_MIN_DAYS=250`, `WORST_DRAWDOWNS_MIN_DAYS=365`, `ROLLING_SHARPE_MIN_DAYS=365` (institutional-fidelity *chart* bars on the factsheet; per-chart "Insufficient history" empty states).
- `CorrelationHeatmap` + engine `scenario.ts:192` — the **`< 10` overlapping-day correlation bar** (CONTEXT: do NOT unify).
- Python `analytics-service` — a `min_overlap_days` parameter (default in match-engine / window-alignment; 30-day floor in tests) for **portfolio-fit overlap** — a *match-engine* concept, unrelated to distributional/tail outputs.
**How to avoid:** Name the new constant distinctively and self-documentingly (e.g. `SAMPLE_FLOOR_OVERLAPPING_DAYS` or `DISTRIBUTIONAL_SAMPLE_FLOOR_DAYS`), put it ONLY in `sample-floor.ts`, and articulate in the doc comment why 60 (distributional/tail) is SEPARATE from correlation's 10 (a lower, statistic-specific bar) and from `min-history.ts`'s chart bars (250/365, a different aesthetic-fidelity axis). Do NOT add a Python parity test this phase — there is no Python distributional floor yet (26/27 add Stress/MC).
**Warning signs:** A new constant named `MIN_*` clashing in grep; a parity test failing because no Python constant exists; correlation empty state copy changing.

### Pitfall 4: Coverage gate regression from an untested gate branch
**What goes wrong:** The new exported gate function adds uncovered functions/branches, nudging the blocking coverage gate (functions 74 / branches 72) toward red.
**Why it happens:** A gate with 3-4 degenerate branches is branch-dense; partial tests leave branches uncovered.
**How to avoid:** Pin EVERY branch in `sample-floor.test.ts`: `ok` (n ≥ floor), `n < floor`, `n == null`, `n` NaN, default-floor vs override-floor, and each reason string. Mirror the exhaustive degenerate coverage in `scenario-history.test.ts` (empty, single, tie, zero-window).
**Warning signs:** `npm run test:coverage` functions/branches drop below threshold.

## Code Examples

Verified patterns from the codebase (sources are in-repo, HIGH confidence):

### Existing caveat to upgrade — composer (`ScenarioComposer.tsx:1059-1068`)
```tsx
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1059
<p
  data-testid="scenario-coverage-caveat"
  className="mt-2 text-[11px] text-text-muted"
>
  Projected from {scenarioMetrics.n} overlapping days.
  {coverageShortestName !== null
    ? ` Shortest history: ${coverageShortestName}.`
    : ""}{" "}
  Not a forecast.
</p>
```

### Existing caveat to upgrade — sandbox (`ScenarioBuilder.tsx:296-303`)
```tsx
// Source: src/components/scenarios/ScenarioBuilder.tsx:296
<p
  data-testid="scenario-coverage-caveat"
  className="mt-2 text-[11px] text-text-muted"
>
  Projected from {metrics.n} overlapping days.
  {shortestName ? ` Shortest history: ${shortestName}.` : ""} Not a
  forecast.
</p>
```
**Target (UI-SPEC Copywriting Contract):** `Historical realized · {N} overlapping days · not a forecast` — with the shortest-history clause retained when present, e.g. `Historical realized · {N} overlapping days · not a forecast. Shortest history: {strategyName}.` (middot `·` separators).

### Engine degenerate-output table (`scenario.ts` — read-only)
```
// Source: src/lib/scenario.ts
0 active strategies      → { n: 0, ...all null, effective_start/end: null }   (lines 140-156)
n < 10 overlapping days  → { n: <count>, ...all metrics null, eff_start/end set } (lines 192-208)
non-finite OR day ≤ −100%→ { n: <count≥10>, ...all metrics null, eff set }     (lines 281-297)
otherwise                → { n, twr, cagr, sharpe, ..., correlation_matrix, ... } (lines 417-431)
```
**Gate implication:** `n` is `0` for empty, a small number for `<10`, and a normal number (possibly ≥60) for the non-finite case. Per CONTEXT the gate treats `null`/`NaN` `n` and `n < floor` as below-floor; the non-finite-*metrics*-with-large-`n` case is handled at the call site (the caller sees nulled metrics) — see Pitfall 2.

### Module convention header to copy (`scenario-history.ts:1`)
```typescript
// Source: src/lib/scenario-history.ts:1
/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 * ...
 */
```

### Single-source regression registration (`contracts-registry.test.ts`)
```typescript
// Source: src/__tests__/contracts/contracts-registry.test.ts:67 (CONTRACT_GUARDS array)
const CONTRACT_GUARDS: Guard[] = [
  // ...existing entries...
  // ADD for HONEST-02:
  { path: "src/lib/sample-floor.test.ts", batch: "Phase22",
    invariant: "SAMPLE_FLOOR_OVERLAPPING_DAYS=60 + gate branch behavior (HONEST-02 single source)" },
];
```
The registry's `guard exists: $path` `it.each` test then fails loud if the pin is ever dropped (`contracts-registry.test.ts:97-104`).

## Runtime State Inventory

> Applicable: this phase includes an in-place *copy upgrade* of two existing UI strings (a refactor-adjacent edit). Verified each category.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — verified by reading both touched files (`ScenarioComposer`, `ScenarioBuilder`): the caveat is a render-time string composed from in-memory `ComputedMetrics`; no string is persisted to any datastore. The new floor constant lives only in source. | none |
| Live service config | **None** — no external service stores "60", "Historical realized", or the caveat copy. The Python `analytics-service` has its OWN unrelated `min_overlap_days` (match-engine), not changed here. | none |
| OS-registered state | **None** — no cron/scheduler/process-name references this phase's strings. | none |
| Secrets/env vars | **None** — no env var gates the floor or the disclosure copy (it is a hardcoded named constant by design, "tunable" via the per-call override parameter, not via env). | none |
| Build artifacts | **None** — pure TS source + tests; no generated artifact embeds these strings. The new `sample-floor.test.ts` is picked up by the existing Vitest `include` glob (`src/**/*.test.{ts,tsx}`) — no config change needed. | none |

**The canonical question — after every file is updated, what runtime systems still carry the old caveat string cached/stored/registered?** Answer: none. The caveat is recomputed on every render from live engine output; there is no cache, no persisted copy, no external registration. This is a pure source-level edit.

## Validation Architecture

> `nyquist_validation` not explicitly disabled (no `.planning/config.json` key found → treat as enabled). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 (jsdom environment) [VERIFIED: package.json, vitest.config.ts] |
| Config file | `vitest.config.ts` (include globs lines 25-45; setup `src/test-setup.ts`) |
| Quick run command | `npx vitest run src/lib/sample-floor.test.ts` |
| Full suite command | `npm test` (and `npm run test:coverage` for the blocking gate) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HONEST-01 | Composer caveat renders `Historical realized · {n} overlapping days · not a forecast`, keeps testid + shortest-history clause | unit (RTL render) | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` | ✅ exists (extend) |
| HONEST-01 | Sandbox caveat renders the same methodology line | unit (RTL render) | `npx vitest run` on the `ScenarioBuilder` test (locate/extend) | ⚠️ verify a `ScenarioBuilder` render test exists; if not → Wave 0 |
| HONEST-01 | Phase-21 caveat semantics NOT regressed (existing assertions stay green) | regression | existing Phase-21 caveat tests | ✅ exists (must stay green) |
| HONEST-02 | `SAMPLE_FLOOR_OVERLAPPING_DAYS === 60` (value pin) | regression pin | `npx vitest run src/lib/sample-floor.test.ts` | ❌ Wave 0 |
| HONEST-02 | Gate: `n >= floor` → ok=true | unit | same | ❌ Wave 0 |
| HONEST-02 | Gate: `n < floor` → below-floor + names n + floor reason | unit | same | ❌ Wave 0 |
| HONEST-02 | Gate: `n == null` / `NaN` → below-floor (never passes) | unit | same | ❌ Wave 0 |
| HONEST-02 | Gate: per-call `floor` override respected | unit | same | ❌ Wave 0 |
| HONEST-02 | Below-floor empty state renders, body names actual N + floor (not "No data") | unit (RTL render) | render test on the consuming surface | ❌ Wave 0 |
| HONEST-02 | Single-source pin registered in `CONTRACT_GUARDS` (fail-loud if dropped) | meta/registry | `npx vitest run src/__tests__/contracts/contracts-registry.test.ts` | ✅ exists (extend) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/sample-floor.test.ts` + the touched component test.
- **Per wave merge:** `npm test` (full suite).
- **Phase gate:** `npm run test:coverage` green (blocking gate: lines 82 / stmts 80 / fns 74 / branches 72) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/sample-floor.ts` — the new pure module (the deliverable).
- [ ] `src/lib/sample-floor.test.ts` — value pin + every gate branch (HONEST-02).
- [ ] Extend `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — assert the new `Historical realized` substring without removing Phase-21 caveat assertions.
- [ ] Verify/create a `ScenarioBuilder` render test for the sandbox caveat (confirm one exists; the repo has `AllocationsTabs.scenario-composer.test.tsx` but the sandbox builder needs its own caveat assertion).
- [ ] Add a `CONTRACT_GUARDS` entry for `src/lib/sample-floor.test.ts` in `contracts-registry.test.ts` + the human-readable `src/__tests__/contracts/REGISTRY.md`.
- [ ] Below-floor empty-state render test (asserts body names N + floor; asserts it is NOT a `role="alert"` / red).

*Framework install: none — Vitest already present.*

## Security Domain

> `security_enforcement` not explicitly `false` (no config found → treat as enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface touched; both components are inside the existing authed dashboard / sandbox |
| V3 Session Management | no | — |
| V4 Access Control | no | No new route, no new data read; the gate is a pure function over client-side numbers |
| V5 Input Validation | yes (light) | The gate must defensively handle `null`/`NaN`/`Infinity`/negative `n` (treat as below-floor) — mirrors the engine's own `Number.isFinite` defensiveness (`scenario.ts:275`). No external/untrusted input enters here. |
| V6 Cryptography | no | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Misleading disclosure (showing a confident stat on too little data) — the *honesty* threat this phase exists to close | Information Disclosure / Repudiation (trust) | The floor gate routes degenerate inputs to an honest empty state; the methodology line names the actual method + N + horizon. This is a *trust/integrity* control, not a classic security one — but it is the project's documented "no-invented-data" invariant. |
| Non-finite poisoning of a downstream estimate | Tampering | Gate guards `Number.isFinite(n)`; engine already nulls non-finite metrics. |

**No classic security surface.** This phase adds no auth, no PII, no network, no persistence, no new route handler. The dominant "threat" is the *honesty* threat (false precision), which the phase's own primitives mitigate.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single caveat line "Projected from N… Not a forecast." (Phase 21, IMPACT-01) | Folded methodology line "Historical realized · N overlapping days · not a forecast" (HONEST-01) | This phase | Names the actual method, not just the count — closes the "how was this computed?" gap |
| Per-chart ad-hoc min-history bars (`min-history.ts`) + correlation's inline `<10` | A *shared* distributional/tail floor primitive (`sample-floor.ts`, default 60) reused by 26/27 | This phase | One source of truth for the distributional/tail bar; correlation + chart bars stay separate by design |

**Deprecated/outdated:** nothing deprecated. The frozen engine and Phase-21 caveat are extended, not replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A dedicated `ScenarioBuilder` render test for the sandbox caveat may not exist (composer test confirmed at `ScenarioComposer.test.tsx`; sandbox not separately confirmed) | Validation Architecture | LOW — Wave 0 already lists "verify/create"; planner confirms during planning. If it exists, the task is an extend; if not, a small new test. |
| A2 | The gate should be a *floor check on a finite overlapping-day count* (`evaluateSampleFloor(n, floor?)`), with 0/1-strategy and non-finite-metrics routing handled at the call site, because the only Phase-22 consumer is the empty state and 26/27 compute their own distributional inputs | Pitfall 2, Standard Stack | MEDIUM — if the planner/discuss-phase decides the gate itself must classify strategy-count and metric-nullity, the signature grows. CONTEXT leaves the exact signature to Claude's discretion, so either is in-bounds; flag for the planner to lock. |
| A3 | A new ESLint rule is NOT needed this phase (Vitest constant+registry pin is sufficient; lint rule deferred to 26/27) | Summary, Alternatives | LOW — CONTEXT explicitly makes the lint guard optional ("the test is the gate"). Deferring matches the project's B16/B17 precedent of declining speculative rules. |
| A4 | No `.planning/config.json` `nyquist_validation` / `security_enforcement` keys found → both treated as enabled | Validation Architecture, Security Domain | LOW — both sections are includable regardless; if disabled, planner trims. |

## Open Questions (RESOLVED)

> Resolved at planning (2026-06-21): Q1 → `evaluateSampleFloor(n, floor?) → { ok, n, floor, reason }`, null/NaN/Infinity/negative/`n<floor` all route to a non-passing result (Plan 22-02). Q2 → the ScenarioBuilder caveat render test exists (`ScenarioBuilder.honesty.test.tsx`); extended in Plan 22-01. Q3 → BUILD + PIN + EXPORT only; the below-floor empty state is proven on a standalone component, NOT retrofitted onto the live composer/sandbox projection (Plan 22-02).

1. **Exact gate signature & degenerate-routing boundary** *(RESOLVED — Plan 22-02)*
   - What we know: CONTEXT leaves the signature to Claude's discretion; the UI-SPEC defines three distinct empty-state bodies (null/NaN-N, 0/1-strategy, `<floor`).
   - What's unclear: whether the gate itself classifies all three sub-reasons (richer `{ ok, n, floor, reason }`) or whether the call site supplies the strategy-count/metric-nullity context (Pitfall 2).
   - Recommendation: richer `evaluateSampleFloor(n, floor?) → { ok, n, floor, reason }` where `reason ∈ { 'below-floor' | 'no-usable-n' }`, and the call site passes strategy count separately for the 0/1 body. Lock this at plan time (it's the one real design decision in the phase).

2. **Does a sandbox (`ScenarioBuilder`) caveat render test exist?**
   - What we know: the composer has `ScenarioComposer.test.tsx`; Phase-21 added the sandbox caveat (STATE.md 21-04 notes).
   - What's unclear: whether the sandbox caveat has its own render assertion.
   - Recommendation: planner greps `src/components/scenarios/` + `src/app/scenarios/` for a builder test; extend or create in Wave 0.

3. **Where (if anywhere) does Phase-22 UI actually render the below-floor empty state?** (Investigation point 6)
   - What we know: HONEST-02's gate + empty state are PRIMARILY consumed by Phases 26/27 (Stress/MC). The own-book composer and sandbox already have their OWN degenerate handling (the engine nulls metrics; KPI cells render em-dashes; the correlation heatmap has its own `<10`/`<2` empty state).
   - What's unclear: whether Phase 22 wires the new below-floor empty state into any live surface, or only *builds + pins* the primitive (and the empty-state copy) for export.
   - Recommendation: **Phase 22 should BUILD + PIN the primitive and the empty-state copy, and may render it on at most one demonstrative surface, but is not obligated to gate the existing composer/sandbox projection behind the 60-day floor.** The CONTEXT deferred-ideas explicitly defer "actually consuming the floor in Stress/MC". The existing projection already degrades honestly via the engine's null metrics; retrofitting the 60-day floor onto the *current* composer projection would change Phase-21 behavior (a scenario with 30 overlapping days currently renders real-but-thin numbers, not an empty state). Recommend the planner treat the Phase-22 empty-state usage as: (a) the gate + reason copy are exported and unit-tested, and (b) a render test proves the empty-state shell renders the reason copy for a below-floor input — WITHOUT changing the composer's existing ≥10-day projection behavior. Confirm with discuss-phase whether any live surface should newly gate at 60 in this phase.

## Environment Availability

> Skipped — this phase is pure code/config (TS lib + UI copy + tests). No external tools, services, runtimes, databases, or CLIs beyond the already-present Node/Vitest/ESLint toolchain. Step 2.6: no blocking external dependencies.

## Sources

### Primary (HIGH confidence — direct codebase reads, 2026-06-21)
- `.planning/phases/22-methodology-honesty-scaffolding/22-CONTEXT.md` — locked decisions, discretion, deferred
- `.planning/phases/22-methodology-honesty-scaffolding/22-UI-SPEC.md` — approved UI contract (tokens, copy, reuse inventory)
- `.planning/REQUIREMENTS.md` — HONEST-01, HONEST-02 definitions + traceability
- `src/lib/scenario.ts` (FROZEN) — `ComputedMetrics.n` semantics + degenerate-output branches (lines 140-156, 192-208, 281-297, 417-431)
- `src/lib/scenario-history.ts` + `src/lib/scenario-history.test.ts` — pure-lib convention model
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1059-1068` — composer caveat
- `src/components/scenarios/ScenarioBuilder.tsx:296-303` — sandbox caveat
- `src/components/portfolio/CorrelationHeatmap.tsx:143-192` — empty-state shell + reason routing + 10-day bar
- `src/lib/min-history.ts` — existing institutional-fidelity chart bars (250/365)
- `tools/eslint-plugin-quantalyze/{index.mjs, rules/no-raw-staleness-derivation.mjs, rules/_shared.mjs, tests/no-raw-staleness-derivation.test.ts}` — ESLint AST-rule + RuleTester model
- `eslint.config.mjs` — plugin wiring + directory exemptions + test exemptions
- `src/__tests__/contracts/contracts-registry.test.ts` — `CONTRACT_GUARDS` registry + wiring-integrity test
- `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.test.ts:101-112` — constant+parity-test SoT model
- `src/lib/scenario.test.ts` — REGRESSION PIN convention (lines 109-208)
- `src/lib/sync-freshness/types.ts` — single-source-of-truth doc-comment convention
- `vitest.config.ts` — test include globs + coverage gate
- `package.json` — versions (next ^16.2.3, react 19.2.4, vitest ^4.1.2)
- `analytics-service/tests/test_window_alignment.py`, `test_match_engine.py` — existing Python `min_overlap_days` (separate concept)
- `DESIGN.md` — token definitions referenced by UI-SPEC

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — Phase-21 closure notes (21-02/03/04 caveat + heatmap wiring history)

### Tertiary (LOW confidence)
- None — every claim is grounded in a direct file read.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; every reused module read directly.
- Architecture: HIGH — engine semantics, both caveat sites, empty-state shell, and SoT mechanisms all confirmed by source.
- Pitfalls: HIGH — Pitfall 2 (n vs metric-nullity) and Pitfall 3 (three pre-existing min-sample concepts) are derived from reading the actual engine + `min-history.ts` + Python tests.
- Open Question 1 (gate signature) and Open Question 3 (where the empty state renders) are genuine design decisions for the planner/discuss-phase, flagged as such.

**Research date:** 2026-06-21
**Valid until:** ~2026-07-21 (stable — pure in-repo primitives, no fast-moving external dependency)
