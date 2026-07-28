# Phase 22: Methodology-Honesty Scaffolding - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 6 (2 new, 2 modified UI, 2 extended tests) + 1 registry edit
**Analogs found:** 6 / 6 (every file has a verified in-repo analog — zero invention)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/sample-floor.ts` (NEW) | utility (pure lib primitive / gate) | transform (pure decision fn) | `src/lib/scenario-history.ts` (structure) + `src/lib/min-history.ts` (named-constant + message fn) | exact |
| `src/lib/sample-floor.test.ts` (NEW) | test | transform (exhaustive branch pin) | `src/lib/scenario-history.test.ts` (degenerate coverage) + `holding-outcome-adapter.test.ts:101-112` (constant value pin) | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1059-1068` (MODIFY in place) | component | request-response (client render of `ComputedMetrics`) | itself (Phase-21 caveat) | self (in-place copy upgrade) |
| `src/components/scenarios/ScenarioBuilder.tsx:296-303` (MODIFY in place) | component | request-response (client render of `ComputedMetrics`) | `ScenarioComposer.tsx:1059-1068` (identical sibling) | exact |
| below-floor empty-state shell (rendered on consuming surface; primary consumers are 26/27) | component | request-response (reason-routed render) | `src/components/portfolio/CorrelationHeatmap.tsx:171-193` | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` + `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` (EXTEND) | test | request-response (RTL render assert) | themselves (existing `IMPACT-01` caveat blocks) | self (extend, do not replace) |
| `src/__tests__/contracts/contracts-registry.test.ts` `CONTRACT_GUARDS` (EXTEND, +1 entry) | config (CI registry) | event-driven (fail-loud existence check) | the array's existing 27 entries | exact |

## Pattern Assignments

### `src/lib/sample-floor.ts` (utility, pure transform) — NEW

**Analog A (module structure + degenerate-safety + doc header):** `src/lib/scenario-history.ts`

Module header to copy verbatim (`scenario-history.ts:1-2`) — open the new module with this exact pure-TS invariant line, then document each degenerate route inline:
```typescript
/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 * ...
 */
```

Single-export, degenerate-safe, never-throws shape (`scenario-history.ts:45-61`) — note the explicit "Degenerate cases (never throws)" doc block at lines 41-44 and the guard-first body:
```typescript
export function shortestHistoryName(
  strategies: ReadonlyArray<StrategyForBuilder>,
): string | null {
  if (strategies.length === 0) return null;   // degenerate → null, no throw
  // ...
}
```

**Analog B (named constant + message helper):** `src/lib/min-history.ts`

The exported-magic-number-with-self-documenting-comment pattern (`min-history.ts:19-26`):
```typescript
/** 90-day rolling correlation needs at least one full Sharpe-ratio year of aligned points. */
export const CORRELATION_90D_MIN_DAYS = 250;
```
**Apply:** export the floor ONCE as a self-documenting named const, e.g.
`/** Conservative distributional/tail bar — DISTINCT from correlation's 10-day bar (scenario.ts) and min-history.ts chart bars (250/365). */ export const SAMPLE_FLOOR_OVERLAPPING_DAYS = 60;`

The copy-consistency message-helper pattern (`min-history.ts:33-39`) — a pure string-builder that names actual + required:
```typescript
export function insufficientHistoryMessage(
  metric: string, requiredDays: number, actualDays: number,
): string {
  return `Insufficient history for institutional-grade ${metric} (have ${actualDays} days, need ${requiredDays}).`;
}
```
**Apply:** the gate's reason/empty-state strings follow this "name actual N + the floor" builder shape (UI-SPEC Copywriting Contract supplies the exact wording for the three reason bodies).

**Gate signature (planner decision — research Open Question 1, recommended richer shape):**
`evaluateSampleFloor(n: number | null | undefined, floor = SAMPLE_FLOOR_OVERLAPPING_DAYS) → { ok: boolean; n: number | null; floor: number; reason: 'ok' | 'below-floor' | 'no-usable-n' }`.
Contract is a **floor check on a finite overlapping-day count** (research Pitfall 2 / Assumption A2): `n == null` or `!Number.isFinite(n)` → `no-usable-n` (NEVER ok); `n < floor` → `below-floor`; else `ok`. The 0/1-strategy body and non-finite-*metrics*-with-large-`n` case route at the call site (caller knows strategy count + metric nullity). Document this boundary in the doc comment so 26/27 know the gate is not a full degenerate-input classifier.

---

### `src/lib/sample-floor.test.ts` (test) — NEW

**Analog A (exhaustive degenerate-branch coverage):** `src/lib/scenario-history.test.ts`

The full degenerate matrix to mirror (one `it` per branch — `scenario-history.test.ts:52-89`): multi-input happy path, tiebreak determinism, empty input, single input, zero-window edge. **Apply** the equivalent matrix for the gate: `n ≥ floor` → ok; `n < floor` → below-floor + body names n+floor; `n == null` → no-usable-n; `n` NaN → no-usable-n; `n` Infinity/negative → no-usable-n; default-floor vs explicit override-floor; each reason string asserted. This is the Pitfall 4 coverage defense (blocking gate: functions 74 / branches 72).

**Analog B (constant value pin):** `holding-outcome-adapter.test.ts:101-112`

The "pin the magic number's value" pattern (`holding-outcome-adapter.test.ts:101-104`):
```typescript
describe("FLAG_COMPOSITE_THRESHOLD parity (finding f5)", () => {
  it("SSR constant equals 50 (D-06 + RESEARCH A3)", () => {
    expect(FLAG_COMPOSITE_THRESHOLD).toBe(50);
  });
```
**Apply:** `expect(SAMPLE_FLOOR_OVERLAPPING_DAYS).toBe(60)`. **Do NOT** copy the `readFileSync(...match.py...)` cross-runtime parity arm (lines 105-111) — there is NO Python distributional floor this phase (research Pitfall 3); a pure TS value+behavior pin is the single-source mechanism. The pin must fail when neutered: a future consumer hardcoding `60` instead of importing the const must break a test (CONTEXT specifics; AGENTS Rule 9/12).

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1059-1068` (component) — MODIFY in place

**Analog:** itself (the shipped Phase-21 caveat). Current render (`ScenarioComposer.tsx:1059-1068`):
```tsx
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

**Edit the CONTENTS only** — keep the `<p>` element, the `data-testid="scenario-coverage-caveat"`, and the `mt-2 text-[11px] text-text-muted` token (UI-SPEC §1 PINNED; Pitfall 1). Fold method + N + horizon into ONE line (do not add a second `<p>`). Target copy (UI-SPEC Copywriting Contract): `Historical realized · {N} overlapping days · not a forecast` with the conditional `coverageShortestName !== null ? \` Shortest history: ${coverageShortestName}.\` : ""` clause RETAINED. `{N}` stays `scenarioMetrics.n` rendered inline in DM Sans — do NOT switch to `.font-metric`/Geist Mono (Pitfall, UI-SPEC Typography note).

---

### `src/components/scenarios/ScenarioBuilder.tsx:296-303` (component) — MODIFY in place

**Analog:** identical sibling of the composer caveat. Current render (`ScenarioBuilder.tsx:296-303`):
```tsx
<p
  data-testid="scenario-coverage-caveat"
  className="mt-2 text-[11px] text-text-muted"
>
  Projected from {metrics.n} overlapping days.
  {shortestName ? ` Shortest history: ${shortestName}.` : ""} Not a
  forecast.
</p>
```

Same in-place fold as the composer — `{metrics.n}` source, `shortestName` conditional, same testid + token. The two surfaces must read identically (CONTEXT: BOTH composer and sandbox).

---

### Below-floor honest empty state (component) — build + render on at most one surface; exported for 26/27

**Analog:** `src/components/portfolio/CorrelationHeatmap.tsx:171-193` (reason-routed empty state)

**Reason-routing precedence pattern** (`CorrelationHeatmap.tsx:171-186`) — shared heading, body branched by the SPECIFIC degenerate reason, checked in precedence order:
```tsx
if (!correlationMatrix || ids.length < 2) {
  const tooFewDays = overlappingDays !== undefined && overlappingDays < 10;
  const tooFewStrategies = ids.length < 2 && !tooFewDays;
  const body = tooFewDays
    ? EMPTY_BODY_FEW_DAYS
    : tooFewStrategies && (correlationMatrix !== null || overlappingDays !== undefined)
      ? EMPTY_BODY_FEW_STRATEGIES
      : EMPTY_BODY_COMBINED;
```
**Apply:** route the gate's three UI-SPEC bodies the same way — `no-usable-n` (null/NaN N) body, 0/1-strategy body, `<floor` body (which names actual N + floor).

**Pinned card shell** (`CorrelationHeatmap.tsx:187-192`) — copy VERBATIM, do not invent a new card (UI-SPEC §2 PINNED tokens):
```tsx
<div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
  <div className="font-semibold text-text-secondary">{reasonHeading}</div>
  <div className="mt-1 text-[11px]">{body}</div>
</div>
```

**Reason-copy constant pattern** (`CorrelationHeatmap.tsx:143-154`) — module-level `EMPTY_HEADING` / `EMPTY_BODY_*` consts with a UI-SPEC-cite comment. **Apply** with DISTINCT copy (UI-SPEC Copywriting Contract): heading `Not enough history for this estimate` (NOT correlation's "Not enough overlap to correlate"); bodies name actual N + floor, never "No data", never red / `role="alert"` (it is honest absence, not an error).

**Anti-pattern guard:** do NOT route correlation through `sample-floor.ts` and do NOT retrofit the 60-day floor onto the existing ≥10-day composer/sandbox projection (CONTEXT + UI-SPEC explicit; research Open Question 3 — this phase BUILDS + PINS the primitive, render on ≤1 demonstrative surface, no Phase-21 behavior change).

---

## Shared Patterns

### Pure-lib invariant header
**Source:** `src/lib/scenario-history.ts:1-2`
**Apply to:** `src/lib/sample-floor.ts`
```typescript
/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 * ...
 */
```

### Named-constant single source (no consumer re-declaration)
**Source:** `src/lib/min-history.ts:19-26`
**Apply to:** `SAMPLE_FLOOR_OVERLAPPING_DAYS` in `sample-floor.ts`; 26/27 must `import` it, never `const floor = 60`.

### Constant value pin (regression — fail when neutered)
**Source:** `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.test.ts:101-104`
**Apply to:** `sample-floor.test.ts` — `expect(SAMPLE_FLOOR_OVERLAPPING_DAYS).toBe(60)` + every gate branch. (Skip the Python `readFileSync` parity arm — no Python counterpart this phase.)

### Single-source CI registration (fail-loud if dropped)
**Source:** `src/__tests__/contracts/contracts-registry.test.ts:57-87` (the `CONTRACT_GUARDS` array) + the `it.each` existence test at lines 97-104
**Apply to:** add ONE entry, mirroring the existing object shape:
```typescript
{ path: "src/lib/sample-floor.test.ts", batch: "Phase22",
  invariant: "SAMPLE_FLOOR_OVERLAPPING_DAYS=60 + gate branch behavior (HONEST-02 single source)" },
```
Also add the human-readable row to `src/__tests__/contracts/REGISTRY.md` (verified to exist). **Do NOT** add a new ESLint rule to `EXPECTED_RULES` (lines 32-46) — the wiring test (`plugin exports exactly the expected rule set`, line 108) would go red, and the lint rule is explicitly deferred to 26/27 (research A3, CONTEXT optional).

### Reason-routed honest empty-state shell + copy constants
**Source:** `src/components/portfolio/CorrelationHeatmap.tsx:143-154` (copy consts) + `:171-193` (routing + shell)
**Apply to:** the below-floor empty state — verbatim shell, distinct copy, distinct threshold.

### In-place caveat upgrade (preserve testid + Phase-21 assertions)
**Source:** `ScenarioComposer.tsx:1059-1068` / `ScenarioBuilder.tsx:296-303`
**Apply to:** both touched components — edit contents, keep `data-testid` + token.

## Test-Extension Map (existing tests to extend, NOT replace)

Resolves research Open Question 2 — the sandbox caveat DOES have a render test. Both touched-component tests already assert the Phase-21 caveat; extend with a `Historical realized` substring assertion, keep every existing assertion green.

| Test file | Existing Phase-21 assertions (MUST stay green) | Extension |
|-----------|-----------------------------------------------|-----------|
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (`IMPACT-01`, lines 2419-2438) | `text.toContain(\`Projected from ${n} overlapping days.\`)` (2434); `Shortest history: ${REF_BTC}.` (2437); `Not a forecast.` (2438) | add `expect(text).toContain("Historical realized")` (and the `·`-separated form) without removing the above |
| `src/components/scenarios/ScenarioBuilder.honesty.test.tsx` (lines 110-116) | **`expect(text).toMatch(/^Projected from \d+ overlapping days\./)` (114)** — anchored `^`; `Shortest history: Short Leg.` (115); `Not a forecast.` (116) | **PLANNER ALERT:** the `^Projected from` anchor at line 114 is INCOMPATIBLE with folding `Historical realized ·` to the FRONT of the line. The plan must update this regex (e.g. to `/^Historical realized · \d+ overlapping days · not a forecast/`) in the same task that upgrades the copy, or the fold breaks a green test. Composer test uses `.toContain` (order-agnostic) so only the builder regex is at risk. |

## No Analog Found

None. Every Phase-22 file maps to a verified in-repo analog. (The phase is composition + a thin new gate, not invention — research §Don't Hand-Roll.)

## Metadata

**Analog search scope:** `src/lib/`, `src/app/(dashboard)/allocations/components/`, `src/components/scenarios/`, `src/components/portfolio/`, `src/__tests__/contracts/`, `src/app/(dashboard)/allocations/lib/`
**Files scanned:** 9 (3 lib + 2 component + 4 test/registry), all read directly
**Pattern extraction date:** 2026-06-21
