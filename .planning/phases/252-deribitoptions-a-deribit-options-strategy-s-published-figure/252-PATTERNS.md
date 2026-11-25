# Phase 252: DERIBITOPTIONS - Pattern Map

**Mapped:** 2026-11-25
**Files analyzed:** 27 (21 modified, 6 new)
**Analogs found:** 27 / 27 (every analog is git-tracked; checked with `git ls-files --error-unmatch`)
**Scope source:** 252-CONTEXT.md including "Decided at planning" (no migration; share card NAMES the reason; blends, wizard and admin approve out of scope; muted tone, not amber). Where 252-RESEARCH.md recommended otherwise (cohort RPC migration, wizard in scope, blend withhold, share card dashes), CONTEXT wins and the file is NOT listed as a write target.

All paths are relative to the repository root. Line numbers were read in this worktree at HEAD; re-anchor by symbol if they drift.

## Phase 233 exclusion (read first)

No plan may list any of these as a write target. Wave 2 may READ `deribit_txn.py`, never edit these symbols:
`analytics-service/services/deribit_txn.py` `correction_is_trading`, `assert_correction_classifiable`, `_correction_names_instrument`, `_CORRECTION_INSTRUMENT_TOKEN_RE`; `analytics-service/scripts/deribit_book_oracle.py`; `scripts/prod-prober/*` (arms/freshness.mjs, run.mjs); `.github/workflows/prod-prober.yml`; `src/__tests__/prod-prober-wiring.test.ts`; Phase 233's tests `test_deribit_txn.py`, `test_deribit_book_oracle.py`. None of the analogs below is in that set.

## File Classification

### Wave 1 (TS only, read side; no Python, no migration)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/factsheet/headline-basis.ts` (add `OPTIONS_CASH_WALLET_REASON`, `isOptionsCashWalletBook`, cause `options_cash_wallet`, phrase table) | utility (pure verdict owner) | transform | itself: `GUARD_REASON_PHRASES` + `headlineVerdict` | exact |
| `src/lib/figure-gate.ts` (marker on `FigureRecord`, `recordClears`, 3 reason sentences) | utility (D-15 gate) | transform | itself: the `unreadable` marker | exact |
| `src/lib/figure-record-scalars.ts` + `src/lib/record-span-read.ts` `RECORD_SPAN_SELECT` + `src/lib/queries.ts` `PERCENTILE_SPAN_COLUMNS` (fifth alias, only if the planner takes the marker route for the 28 `gateAnnualized` sites) | config (projection) | request-response | the existing four-alias fragment, byte-pinned across three files | exact |
| `src/lib/queries.ts` (`CATEGORY_RANKING_ANALYTICS_COLUMNS` alias pair, `shapeRowAnalytics` arm, `shapeStoredAnalytics` alias drop, `getPercentiles` skip, `COMPARE_ANALYTICS_COLUMNS`) | service (server query shaping) | CRUD / request-response | itself: `shapedNativeUnit` + `shapeRowAnalytics` blank arm | exact |
| `src/lib/types.ts` (`StrategyAnalytics`: alias inputs + one withhold marker) | model | n/a | its own `native_unit` / `last_success_*` optional fields (lines 386-438) | exact |
| `src/lib/factsheet/composite-read-path.ts` (`applyHeadlineBasis`, single-key `else if` branch at :1033) | service (RSC read path) | request-response | itself | exact |
| `src/lib/factsheet/og-metrics.ts` | utility | transform | itself (already calls `headlineVerdict`; likely NO change) | exact |
| `src/lib/factsheet/build-payload.ts` (:905 `twrChainBroken === true &&` coupling) | service | transform | itself | exact |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (withheld gates, new tone, new sentences) | component | request-response | itself: `headlineCoverageNote`, `isHeadlineWithheld`, `headlineNoteColor` | exact |
| `src/app/factsheet/[id]/v2/basis-context.tsx` (`leverageEligibleFor`, `mtmDisabledReasonCopy` reword) | provider | request-response | itself | exact |
| `src/app/api/og/factsheet/[id]/route.tsx` (share card names the reason on the `figureNote` line) | route / component | request-response | itself: the `state === "withheld"` arm lines 334-337 | exact |
| `src/app/(dashboard)/compare/page.tsx` + `src/components/strategy/CompareEquityOverlay.tsx` (no curve for a flagged row) | route / component | request-response | itself: effective-generation pick lines 156-178 and `overlayItems` 293-305 | exact |
| `src/app/factsheet/[id]/v2/page.tsx` (cache key `factsheet-v2-payload-v27` -> v28 plus dated comment line) | config | request-response | itself: the bump comment lines 340-349 | exact |
| `TODOS.md` (delete `DEF-142.2-07`), `CHANGELOG.md`, `VERSION`, `package.json` (ship) | config / docs | n/a | CLAUDE.md "CHANGELOG discipline" and "TODOS.md holds open work only" | rule-based |
| `src/__tests__/options-cash-wallet-withhold.census.test.ts` (NEW: one row through every seam, source scan, cross-language pin) | test | transform | `src/__tests__/figure-gate-census.test.ts` + `src/__tests__/recompute-verdict-census.test.ts` | role-match |
| `src/lib/factsheet/headline-basis.test.ts` (extend) | test | transform | itself | exact |
| `src/lib/factsheet/headline-verdict.parity.test.ts` (extend, new `describe`) | test | request-response | itself | exact |
| `src/lib/factsheet/composite-read-path.headline-basis.test.ts` (extend; update intent of tests asserting the cash headline is kept) | test | request-response | itself | exact |
| `src/app/api/og/factsheet/[id]/route.figure-gate.test.tsx` (extend: the card line names the reason) | test | request-response | itself | exact |
| `src/lib/figure-record-scalars.test.ts`, `src/lib/queries.test.ts`, `src/lib/queries.percentile-columns.test.ts` (move alias pins) | test | n/a | themselves | exact |
| `src/__tests__/recompute-verdict-census.test.ts`, `src/__tests__/figure-gate-census.test.ts`, `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` (move counts, rows, key) | test | n/a | themselves | exact |

### Wave 2 (measure first; promotion only after the founder-gated run)

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/scripts/deribit_options_smoothed_probe.py` (NEW, read-only) | script (worker-run probe) | batch / file-I/O (live Deribit reads, stdout report) | `analytics-service/scripts/deribit_acceptance.py` (live crawl, no write) + `analytics-service/scripts/flowtiming_dry_run.py` (redaction) | role-match |
| `analytics-service/tests/test_deribit_options_smoothed_probe.py` (NEW) | test | batch | `analytics-service/tests/test_deribit_acceptance.py` + `analytics-service/tests/test_flowtiming_dry_run.py` | role-match |
| `analytics-service/tests/test_stitch_composite_job.py` (extend, ONLY if promoted) | test | event-driven (job) | itself, lines ~1195-1215 | exact |
| `analytics-service/services/job_worker.py` `run_stitch_composite_job` (promotion, ONLY if measurement passes) | service | batch | itself (`merged_flags["mtm_gated_reason"]` stamping near the `if not mtm_ok and mtm_reason is not None:` block) | exact |

## Pattern Assignments

### `src/lib/factsheet/headline-basis.ts` (utility, transform)

**Analog:** itself. Add the predicate and cause beside the existing owner; do not create a second module.

**Closed set + compile-checked phrase table to copy** (lines 32-59):
```typescript
export type GuardReason = "negative_nav" | "dust_nav" | "pnl_dominated";
// ...
export const GUARD_REASON_PHRASES = {
  negative_nav: "a zero or negative account balance",
  dust_nav: "a near-zero account balance",
  pnl_dominated: "a one-day gain or loss larger than the balance",
} as const satisfies Record<GuardReason, string>;
```
New `OPTIONS_CASH_WALLET_PHRASES` (or per-slot record) must use the same `as const satisfies Record<...>` shape so a missing phrase is a compile error. No flag name in any string.

**Strict flag read to copy** (lines 112-119): non-object and array guard, then exact comparison.
```typescript
export function readHeadlineBasis(dqf: unknown): HeadlineBasis {
  const flags: Record<string, unknown> =
    dqf !== null && typeof dqf === "object" && !Array.isArray(dqf) ? (dqf as Record<string, unknown>) : {};
  const twrChainBroken = flags.twr_chain_broken === true;
```
The new predicate is the same guard then `flags.mtm_gated_reason === OPTIONS_CASH_WALLET_REASON` (strict equality, no trim, no case fold).

**Verdict seam to modify** (lines 160-177). The new cause is tested FIRST, before `readHeadlineBasis`, so it beats `dated` (the evidence row has `headline_since`) and does not need `twr_chain_broken`:
```typescript
export type HeadlineWithholdCause = "unmeasured" | "recomputing" | "failed";

export type HeadlineVerdict =
  | { kind: "clean" }
  | { kind: "dated"; since: string }
  | { kind: "withheld"; cause: HeadlineWithholdCause };

export function headlineVerdict(dqf: unknown, gate: StoredCashHeadlineGate, computationStatus?: unknown): HeadlineVerdict {
  const basis = readHeadlineBasis(dqf);
  if (!basis.twrChainBroken) return { kind: "clean" };
  if (basis.headlineSince === null) return { kind: "withheld", cause: "unmeasured" };
  if (!gate.applicable) return { kind: "withheld", cause: withholdCauseOf(gate, computationStatus) };
  return { kind: "dated", since: basis.headlineSince };
}
```
Target: `if (isOptionsCashWalletBook(dqf)) return { kind: "withheld", cause: "options_cash_wallet" };` as the first statement. `withholdCauseOf` (lines 184-192) is NOT extended: the cause is decided before the gate.

**Basis scope:** CONTEXT line 26 says a non-cash basis stored behind the toggle is not withheld. The verdict is about the cash headline only; the read side keeps `basis === "cash_settlement"` in `isHeadlineWithheld` (MetricsColumn.tsx:100).

**Cross-language pin** (copy the text-read idiom from `src/lib/figure-gate.test.ts` lines 384-396, but target `analytics-service/services/stitch_composite.py` line 101 `MTM_REASON_OPTIONS = "unsmoothed_options_book"`):
```typescript
const py = readFileSync(resolve(process.cwd(), "analytics-service/services/metrics.py"), "utf8");
const read = (name: string): number => {
  const hits = [...py.matchAll(new RegExp(`^${name} = (\\d+)\\s*$`, "gm"))];
  expect(hits, `${name} must be defined exactly once in metrics.py`).toHaveLength(1);
```
Adapt the regex to `^MTM_REASON_OPTIONS = "([a-z_]+)"\s*$`, exactly one hit, equal to the TS constant.

---

### `src/lib/figure-gate.ts` (utility, transform)

**Analog:** itself, the `unreadable` marker (a record that withholds without naming a length).

**Marker field to copy** (lines 45-58): optional, `true`-typed, absent on every normal record.
```typescript
  unreadable?: true;
}
```
Add `withheldBy?: "options_cash_wallet"` (name is the planner's; keep it a closed literal).

**Builder to copy** (lines 172-189): conditional spread keeps the normal record byte-identical.
```typescript
  const unreadable = [input.seriesStart, input.seriesEnd, input.headlineSince].some((d) => !!d && !isReadableDay(d));
  return {
    spanDays: figureSpan(input),
    observations: typeof obs === "number" && Number.isFinite(obs) ? obs : null,
    crypto: input.periodsPerYear === 365,
    ...(unreadable ? { unreadable: true as const } : {}),
  };
```
**Gate to modify** (lines 197-204): `if (record.unreadable) return false;` becomes `if (record.unreadable || record.withheldBy) return false;`. This single change makes `gateAnnualized`, `gateDelta` (258-259), `gateRollingWindow` (309) and `withholdShortRecordRanks` withhold.

**Reason sentences to branch** (must not print "This record covers N days", which is false here): `withheldReason` lines 346-361, `withheldCellTitle` lines 364-370, `widenedWithheldReason` lines 459-472. Copy the `unreadable` early-return shape:
```typescript
  if (record.unreadable) {
    return `Annualized figures are not shown: ${blend ? "the blend's" : "this record's"} dates could not be read.`;
  }
```
and
```typescript
  if (record.unreadable) return "Withheld: the record's dates could not be read.";
```
Draft wording is in RESEARCH "Recommended design"; it is user-facing copy for the founder visual check (CONTEXT Claude's Discretion). `src/lib/figure-gate.test.ts` is the existing sentence oracle (typed by hand): extend it with the new sentences typed by hand, never imported.

---

### Alias projections (config, request-response): `figure-record-scalars.ts`, `record-span-read.ts`, `queries.ts`

**Analog:** the existing four-alias fragment, `src/lib/figure-record-scalars.ts` lines 33-34:
```typescript
export const RECORD_SCALAR_ALIASES: string =
  "series_start:returns_series->0->>date, series_end:returns_series->-1->>date, headline_since:data_quality_flags->>headline_since, record_observations:metrics_json->record_observations";
```
and `queries.ts` lines 240-241 (`PERCENTILE_SPAN_COLUMNS`, identical string). Typed `string`, not a literal, because postgrest-js cannot parse `->-1`.

**Pitfall (RESEARCH Pitfall 4):** `RECORD_SCALAR_ALIASES`, `PERCENTILE_SPAN_COLUMNS` and `RECORD_SPAN_SELECT`'s inner list are pinned equal by `src/lib/figure-record-scalars.test.ts`; `CATEGORY_RANKING_ANALYTICS_COLUMNS` and `COMPARE_ANALYTICS_COLUMNS` have exact-set pins in `queries.test.ts`; the percentile projection is a hand-written byte pin in `src/lib/queries.percentile-columns.test.ts` (`PINNED_KPI_PROJECTION`, header says write the expected string BY HAND). All move in ONE commit. The new alias is a `->>` text scalar (closed vocabulary string), never the blob (privacy rule, T-194-35).

**Planner decision to flag:** a record only carries the marker where it is built through these aliases (`recordFromScalars`, `figureRecord`). Whether all 28 `gateAnnualized(` call sites build their record that way was NOT verified here (RESEARCH read some at grep level). The completeness census (below) is the control; the planner should have it list which sites get the marker for free and which need a per-file decision, instead of assuming 28.

---

### `src/lib/queries.ts` (service, request-response)

**Analog:** itself. The pattern for "the list row carries a scalar derived from the effective flags generation" is `shapedNativeUnit`, and "a row blanks to the empty shape plus real fields" is the failed arm of `shapeRowAnalytics`.

**Effective-generation read to copy** (lines 873-886):
```typescript
function shapedNativeUnit(a: StrategyAnalytics) {
  if (usesLastSuccessSnapshot(a)) {
    const effective = effectiveDataQualityFlags(a);
    return parseReturnsUnit(
      effective.source === "snapshot" ? effective.flags?.native_unit : a.last_success_native_unit,
    );
  }
  return parseReturnsUnit(a.native_unit ?? a.data_quality_flags?.native_unit);
}
```
The new reason read follows this: snapshot generation reads `last_success_mtm_gated_reason`, otherwise the live alias `mtm_gated_reason`, otherwise `a.data_quality_flags?.mtm_gated_reason` on the owner's blob row. Never read the live flags raw (a derive prestamp drops `mtm_gated_reason` and would un-withhold the row for minutes). Pass the string through the ONE predicate, never compare to the literal here.

**Blank arm to copy** (lines 1002-1007, the failed arm; `shapeRowAnalytics` begins at 944):
```typescript
  return {
    ...EMPTY_ANALYTICS,
    strategy_id: strategyId,
    computation_status: a.computation_status,
    trades_fetched_at: a.trades_fetched_at ?? null,
  };
```
New arm sits BEFORE `if (isRankableAnalyticsRow(a))` (line 955) and returns the same shape plus the one new marker field naming the withhold. Pitfall 8: the marker must win over the table's muted "No data" chip (`deriveEmptySeriesState`), so check `StrategyTable` health/chip logic.

**Alias drop to copy** (lines 934-942, `shapeStoredAnalytics`): `delete out.last_success_*` for each alias input, so no shaped object or client component carries the new `last_success_mtm_gated_reason` or `mtm_gated_reason` alias.

**Alias strings to extend:** `CATEGORY_RANKING_ANALYTICS_COLUMNS` (line 598-599) and `COMPARE_ANALYTICS_COLUMNS` (469-470). Add `mtm_gated_reason:data_quality_flags->>mtm_gated_reason` and `last_success_mtm_gated_reason:data_quality_flags->last_success_snapshot->flags->>mtm_gated_reason` in the same style as the existing `last_success_cumulative_method` alias.

**Percentile peer sets** (lines 385-406): a flagged row is skipped before `rows.push`, at the same place as `isRankableAnalyticsRow`:
```typescript
    const a = extractAnalytics(s.strategy_analytics);
    if (!a) continue;
    // RANK-01: ...
    if (!isRankableAnalyticsRow(a)) continue;
```
Add the flagged-row skip here (and in `getOwnRowPercentiles`, ~line 1430, same `isRankableAnalyticsRow` filter). Do not rely on `withholdShortRecordRanks`: it nulls only the five annualized metrics and leaves max drawdown and cumulative return, which are themselves cash artefacts for this row. No migration (CONTEXT): `get_verified_cohort_rank` is untouched; booked in `<deferred>`.

**Census pitfall (RESEARCH Pitfall 5):** `src/__tests__/recompute-verdict-census.test.ts` pins `queries.ts::effectiveDataQualityFlags` at count 3. Prefer reusing an effective-flags object already computed in `shapedNativeUnit`; otherwise update the census row with an honest reason in the same commit.

---

### `src/lib/factsheet/composite-read-path.ts` (service, request-response)

**Analog:** itself.

**`applyHeadlineBasis`** (lines 548-586). It hard-codes `twrChainBroken: true` (line 574) for every non-clean verdict, which would print the chain-break sentence over an intact chain (RESEARCH Pitfall 2). Copy this conditional-spread idiom for the quality object, and make `twrChainBroken` carry only when the row is chain-broken, with the new cause carried the same way as the D-14 cause:
```typescript
  const verdict = headlineVerdict(dqf, options.gate ?? { applicable: true }, options.computationStatus);
  if (verdict.kind === "clean") return { headline, redacted: false, quality: {} };
  const basis = readHeadlineBasis(dqf);
  const withheld = verdict.kind === "withheld";
  const quality: ReturnType<typeof applyHeadlineBasis>["quality"] = {
    twrChainBroken: true,
    ...(basis.reasons.length > 0 && options.composite !== true ? { headlineGuardReasons: basis.reasons } : {}),
    ...(verdict.kind === "dated" ? { headlineCoversFrom: verdict.since } : {}),
    ...(withheld ? { headlineWithheld: true as const } : {}),
    ...(verdict.kind === "withheld" && verdict.cause !== "unmeasured" ? { headlineWithheldCause: verdict.cause } : {}),
  };
  if (!withheld) return { headline, redacted: false, quality };
  const redacted: Record<string, number | null> = { ...headline };
  for (const { serverKey } of BASIS_KPI_MAP) redacted[serverKey] = null;
```
The redaction loop (nulls every `BASIS_KPI_MAP` key) is reused unchanged ("Don't Hand-Roll"). The `FactsheetPayload["dataQuality"]` type in `types.ts` (~855-945) gains the cause value.

**Single-key arm to modify** (lines 1028-1046). The `else if (dqf?.twr_chain_broken === true)` branch must also fire for an options row whose gate is not applicable, or the page computes whole-record figures from the cash series (the artefact):
```typescript
  let shownHeadline = cashHeadline;
  if (cashHeadline) {
    const applied = applyHeadlineBasis(cashHeadline, dqf);
    shownHeadline = applied.headline;
    Object.assign(addedQuality, applied.quality);
  } else if (dqf?.twr_chain_broken === true) {
    const applied = applyHeadlineBasis({}, dqf, { gate, computationStatus });
```
Make the second branch condition `dqf?.twr_chain_broken === true || isOptionsCashWalletBook(dqf)`. `dqf` here is the effective flags generation (passed by `fetch-and-build-payload.ts`); keep it that way.

Composite arm call is at line 430: `applyHeadlineBasis(cashHeadline, dqf, { composite: true })`; line 494 reads `mtm_gated_reason` into `mtmGate` for the toggle and stays.

---

### `src/lib/factsheet/build-payload.ts` (service, transform)

**Analog:** itself, line 905:
```typescript
    headlineWithheld: opts?.dataQuality?.twrChainBroken === true && opts.dataQuality.headlineWithheld === true,
```
Drop the `twrChainBroken === true &&` coupling so `headlineWithheld === true` alone decides. Keep byte-identical output for a clean composite (existing test `(g) a clean composite's dataQuality is byte-identical to HEAD` in `composite-read-path.headline-basis.test.ts`).

---

### `src/app/factsheet/[id]/v2/MetricsColumn.tsx` (component, request-response)

**Analog:** itself.

**Tone split to copy** (lines 72-82). Amber is for the recoverable `withheld` variant; this cause is structural, so add a variant (or a tone input) rather than reusing `withheld`:
```typescript
export interface HeadlineNote {
  variant: "dated" | "withheld";
  text: string;
}
const WITHHELD_GLYPH = "⚠ ";
export function headlineNoteColor(variant: HeadlineNote["variant"]): string {
  return variant === "withheld" ? "var(--color-warning, #B45309)" : "var(--color-text-muted, #64748B)";
}
export function headlineNoteGlyph(variant: HeadlineNote["variant"]): string {
  return variant === "withheld" ? WITHHELD_GLYPH : "";
}
```
The muted colour and no glyph are exactly the `dated` branch; the new variant maps to `var(--color-text-muted, #64748B)` and `""`. Precedent for the same decision on the toggle: `mtmReasonTone` (basis-context.tsx 961-969), which classes `unsmoothed_options_book` as `steady`. DESIGN.md:175 reserves warning amber for transient recoverable states.

**Welded gates to relax** (RESEARCH Pitfall 2): line 100
```typescript
  return basis === "cash_settlement" && dataQuality?.twrChainBroken === true && dataQuality.headlineWithheld === true;
```
line 125 `if (dataQuality?.twrChainBroken !== true) return null;` in `headlineCoverageNote`, line 236 in `windowCoverageNote`, and line 272 in `headlineBenchSource`. Each keys off `twrChainBroken`; for the new cause they must key off `headlineWithheld` (or the cause) first.

**Cause-picks-the-sentence pattern to copy** (lines 127-153): `headlineCoverageNote` already switches on `headlineWithheldCause` per slot (`panel` vs `strip`/`stripRelative`/`main`) before joining reasons:
```typescript
    if (slot === "panel") {
      if (dataQuality.headlineWithheldCause === "recomputing") {
        return { variant: "withheld", text: "Withheld while the headline figures are recomputed." };
      }
      if (dataQuality.headlineWithheldCause === "failed") return null;
      return { variant: "withheld", text: `Withheld: this panel covers earlier history, ...` };
    }
    if (slot !== "strip" && slot !== "stripRelative" && slot !== "main") return null;
```
The new cause returns its own sentences from the phrase table BEFORE `joinGuardPhrases` runs (it must never mention a chain break). Voice: "factual, institutional, no contractions" (basis-context.tsx docblock before line 880).

### `src/app/factsheet/[id]/v2/basis-context.tsx` (provider, request-response)

**Analog:** itself. `leverageEligibleFor` (lines 790-795) excludes `twrChainBroken === true` rows; add a `headlineWithheld` exclusion so a single-key options row cannot fabricate figures at L != 1:
```typescript
    payload.dataQuality?.composite !== true &&
    payload.dataQuality?.twrChainBroken !== true &&
    payload.dataQuality?.returnsConventionOverride !== true &&
```
`mtmDisabledReasonCopy` case `"unsmoothed_options_book"` (line 907) says composites with options "report cash settlement only"; it sits beside a withheld cash headline now. Reword in the same change, keeping the `mtmReasonTone` steady classification. Existing tests pass `mtmGate` directly (`basis-context.test.tsx`, `FactsheetBody.basis.test.tsx`), so only wording assertions move.

---

### `src/app/api/og/factsheet/[id]/route.tsx` (route, request-response): share card NAMES the reason

**Analog:** itself. The card already has a one-line muted note slot driven by `figureNote`, fed by the D-15 withhold arm (lines 332-340):
```typescript
      const record = recordFromScalars(analytics, data?.asset_class);
      const state = gateAnnualized(record);
      if (state === "withheld") {
        sharpe = NaN;
        cagr = NaN;
        figureNote = withheldReason("record", record);
      } else if (state === "short" && ...) {
        figureNote = shortTrackMarkerTitle(record.spanDays);
      }
```
and the render (lines 393-395):
```tsx
        {figureNote && (
          <div style={{ marginTop: 24, fontSize: 20, color: "#64748B" }}>{figureNote}</div>
        )}
```
No new card element is needed: the colour is already muted `#64748B`. `computeOgHeadline` (og-metrics.ts 101-137) already returns all NaN when `headlineVerdict(effectiveDataQualityFlags(persisted).flags, gate, status).kind === "withheld"`, so the dashes come for free from the verdict. Only the sentence is new: compute the verdict (or the predicate over `effectiveDataQualityFlags(analytics).flags`) in the route and set `figureNote` to the cause's card sentence. Mind Max DD: `computeOgHeadline` returns NaN for `maxDd` too on a withheld verdict (the three are returned together at line 136), which is correct here because max drawdown is also a cash artefact.

Test analog to extend: `src/app/api/og/factsheet/[id]/route.figure-gate.test.tsx` (sentences typed by hand, `ogCalls` captures the element tree, `STATE.strategyRow` seeds the embed). Its select pin (`STATE.select`) will need the `data_quality_flags` it already selects; no select change expected (the route already embeds `data_quality_flags`, line 185).

---

### `src/app/(dashboard)/compare/page.tsx` + `CompareEquityOverlay.tsx` (route/component, request-response)

**Analog:** the page itself. Compare does NOT call `shapeRowAnalytics`; it shapes its own rows over `EMPTY_ANALYTICS`.

**Effective-generation pick to copy** (lines 149-178):
```typescript
    const fromSnapshot = usesLastSuccessSnapshot(row);
    effectiveHeadlineSince.set(
      strat.id,
      fromSnapshot ? row?.last_success_headline_since : row?.headline_since,
    );
    // ...
    const generation: Partial<StrategyAnalytics> = fromSnapshot
      ? {
          twr_chain_broken: row?.last_success_twr_chain_broken ?? null,
          cumulative_method: row?.last_success_cumulative_method ?? null,
        }
      : {};
```
Add the alias pair to the projected row type (`CompareProjectedRow`, lines 38-43), to `COMPARE_ANALYTICS_COLUMNS` (in `queries.ts`), pick the effective one with `fromSnapshot`, run it through the predicate, and for a flagged row blank the figures (compose over `EMPTY_ANALYTICS` as lines 190-207 do) plus the withhold marker so `CompareTable` can print the sentence. Copy the drop-before-client idiom (lines 182-188):
```typescript
    const fetched: CompareProjectedRow = { ...(row ?? {}) };
    delete fetched.headline_since;
    delete fetched.record_observations;
    delete fetched.last_success_computed_at;
```
Also `delete` the two new alias inputs.

**Overlay no-curve rule to copy** (lines 293-305): a row with no usable span already gets `headlineCoversFromStatus: "undatable"` and "the overlay draws no curve for it":
```typescript
  const overlayItems = strategyOnlyItems.map((it) => {
    if (it.analytics.twr_chain_broken !== "true") return it;
    const { headlineSince } = readHeadlineBasis({ twr_chain_broken: true, headline_since: effectiveHeadlineSince.get(it.strategy.id) });
    return { ...it, headlineCoversFrom: headlineSince, headlineCoversFromStatus: headlineSince === null ? ("undatable" as const) : ("dated" as const) };
  });
```
For a flagged row, mark it `"undatable"` (or a new status) regardless of chain state. Open Question 8 in RESEARCH recommends Compare draws no curve for a flagged row; the factsheet keeps its own pattern until the founder rules at the visual check.

**FigureRecord for Compare** (lines 163-172) uses `figureRecord({...})`; pass the new marker there so `CompareTable`'s gated cells withhold with the named sentence.

---

### `src/app/factsheet/[id]/v2/page.tsx` (config)

**Analog:** itself, lines 340-349. One dated comment line per bump, then the key. Copy the style:
```typescript
    // Bumped v26→v27 (Phase 237 CACHE-03, 2026-11-23): the payload shape is unchanged, and ...
    ["factsheet-v2-payload-v27", id, computedAt, tradesFetchedAt ?? "none", provenanceKey, computationStatus],
```
New line: "Bumped v27→v28 (Phase 252 DERIBITOPTIONS, 2026-11-25): ..." stating that for the same inputs a row carrying the options flag now reads withheld, so under v27 an entry built before the deploy would keep serving the cash headline for the 1 h TTL drain. Update `page.public-cache-key.test.tsx` and the `phase-148-owner-lane-cache-isolation` pin in the same commit.

---

### `src/__tests__/options-cash-wallet-withhold.census.test.ts` (test, transform) NEW

**Analog:** `src/__tests__/figure-gate-census.test.ts` (header lines 1-45; imports lines 46-55) for the walk + closed-reason `EXCLUDED` map + planted self-test + oracle independence; `src/__tests__/recompute-verdict-census.test.ts` header for exact per-pair counts.

**Imports and walk idiom to copy** (figure-gate-census.test.ts lines 46-55):
```typescript
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
```
**Closed reason set to copy** (lines 71-79 region): plain reasons as regexes plus a `gated upstream: <path>` reason whose target must itself import the predicate module. Suggested reasons: `label only`, `gated upstream: <path>`, `owner-only, decided: <ruling>`, plus `out of scope, decided: <CONTEXT line>` for the wizard, admin and blends files.

**What the file pins (from RESEARCH Validation Architecture):**
1. One row through every seam (`headlineVerdict`, `applyHeadlineBasis`, `computeOgHeadline`, `shapeRowAnalytics`, Compare shaping, `figureRecord` + `gateAnnualized`) agrees, built from the debug-session wallet shape (cash returns -0.4839, +0.0280, +3.3339 from `analytics-service/tests/fixtures/deribit_option_round_trip.py` header) scaled to a long record, with an anti-vacuity assertion that the unredacted series computes finite figures first.
2. `NOT_TRIGGERS` table (RESEARCH "Negative pin"): chain-broken alone dated, chain-broken alone undated, venue reason, each of `mtm_summary_coverage_incomplete`, `mtm_series_uncomputable`, `mtm_second_pass_timeout`, `mtm_anchor_race`, `mtm_option_row_field_missing`, case variant, padded, boolean, array, null. The closed reason list is quoted from `stitch_composite.py` (lines 101-160); build it as a typed oracle in the test, not imported.
3. MT5-shaped dqf: verdict, payload quality and shaped row byte-identical to HEAD snapshot (155.2 freeze).
4. Source scan with `stripCommentsPreserveLines`: no non-test file compares `mtm_gated_reason` to the literal outside `headline-basis.ts`, with an allowlist by file for the existing hits (`FactsheetView.tsx` toggle at ~3286, `basis-context.tsx` switch, `types.ts` union, `SyncPreviewStep.tsx`, `composite-read-path.ts` ~494).
5. Cross-language pin (see headline-basis section).
6. Planted self-test over a temp dir: an unclassified file that selects `data_quality_flags` without the predicate fails; a comment-only mention does not count.

**PROOF-01:** for each gate, back up the file by byte copy (`cp file file.bak`), neuter (return `false` from the predicate, delete the verdict's first `if`, drop the `shapeRowAnalytics` arm, remove the `recordClears` marker read, remove the Compare alias pick, revert the cache key), record RED with the arm named, restore by `cp` and `cmp`, record GREEN. Never `git checkout`/`restore`/`stash` on uncommitted work.

---

### `src/lib/factsheet/headline-verdict.parity.test.ts` (test, request-response): extend

**Analog:** itself. Same row through page and card, anti-vacuity first.

**Helpers to reuse** (lines 25-70): `SEVEN`, `STORED_ROW`, `CHAIN`, a 400-day `SERIES`, `page(row, dqf)` over `readSingleKeyBasisOpts`, `card(row, dqf)` over `computeOgHeadline`, `allNaN`, `quiet`.

**Case table to widen** (lines 77-94). The tuple type is `"recomputing" | "failed" | undefined`; widen it to include `"options_cash_wallet"`:
```typescript
  const CASES: Array<[string, Row | null, "recomputing" | "failed" | undefined]> = [ ... ];

  it.each(CASES)("%s", async (_name, row, cause) => {
    expect(Number.isFinite(computeOgHeadline(SERIES, "crypto").sharpe)).toBe(true);
    const p = await quiet(() => page(row, CHAIN));
    expect(p.dataQuality).toMatchObject({ twrChainBroken: true, headlineWithheld: true });
    expect(p.dataQuality?.headlineWithheldCause).toBe(cause);
    expect(allNaN(card(row, CHAIN)), "the card must withhold what the page withholds").toBe(true);
  });
```
New `describe`: dqf `{ composite: true, twr_chain_broken: true, headline_since: "2025-12-16", mtm_gated_reason: "unsmoothed_options_book" }` (the evidence shape, which is `dated` today) and the same dqf minus the two chain flags. Assert `p.dataQuality` has `headlineWithheld: true`, `headlineWithheldCause: "options_cash_wallet"`, NO `twrChainBroken` for the second shape, `p.metricsByBasis?.cash_settlement` scalars null, and `allNaN(card(...))`. This is the SC-2 RED fixture: on today's code the first shape is `dated` (figures kept) and the second is `clean`.

---

### `src/lib/factsheet/headline-basis.test.ts` (test): extend

**Analog:** itself (hand-typed oracle, imports at lines 1-13). Add table-driven `NOT_TRIGGERS` and the precedence test (new cause beats `dated`, beats `gate.applicable === true`, and is independent of the gate). Add a phrase-table test with sentences typed by hand.

---

### Wave 2: `analytics-service/scripts/deribit_options_smoothed_probe.py` (script, batch) NEW

**Analog 1 (live-read structure, no write):** `analytics-service/scripts/deribit_acceptance.py`.

Module docstring idiom (lines 1-60): WHY, the checks, READ-ONLY by construction, USAGE via `railway ssh "cd /app && python -m scripts.<name> ..."` orchestrator-only, EXIT CODES (0 pass, 1 check failed, 2 usage/env error, no secrets printed on any path).

**Exchange build to copy** (lines 405-420): creds from the read-only env pair, passed to ccxt only, never printed:
```python
def _build_deribit_exchange(key_index: int) -> Any:
    from services.exchange import create_exchange
    client_id = os.getenv(f"DERIBIT_CLIENT_ID_{key_index}", "")
    client_secret = os.getenv(f"DERIBIT_CLIENT_SECRET_{key_index}", "")
    if not client_id or not client_secret:
        raise RuntimeError(f"DERIBIT_CLIENT_ID_{key_index} and DERIBIT_CLIENT_SECRET_{key_index} are required")
    return create_exchange("deribit", client_id, client_secret)
```
For composite members the key lookup differs (members are stored keys, decrypted by the existing worker key path); the planner reads how `run_stitch_composite_job` resolves member exchanges (around `job_worker.py:13075-13090`) and reuses that path rather than env pairs. RESEARCH Security: never print, log or store a credential.

**Crawl + ledger pattern to copy** (lines 512-545): `try/finally` with `aclose_exchange`, ledger built through the SHARED production builder, then `assert_ledger_complete`:
```python
    from services.exchange import aclose_exchange
    exchange = _build_deribit_exchange(spec.key_index)
    try:
        native_ledger, _ledger_report = await build_deribit_native_ledger(exchange, None)
    finally:
        await aclose_exchange(exchange)
```
Imports to copy (lines 69-78): `from services.deribit_ingest import LedgerCompletenessError, assert_ledger_complete, build_deribit_native_ledger`. The probe additionally imports `fetch_deribit_native_account_state` (deribit_ingest.py:2131), `PNL_BASIS_SMOOTHED_MTM` (deribit_txn.py:1172), `LedgerValuationError` (deribit_txn.py:85) and `combine_native_ledger` (`services/broker_dailies.py:350`). Signature to call: `build_deribit_native_ledger(exchange, since_ms=None, *, account_state=..., pnl_basis=PNL_BASIS_SMOOTHED_MTM, retain_raw_rows=...)` (deribit_ingest.py:2971-2981).

**Hard rules from RESEARCH:** do NOT call `run_stitch_composite_job` (it persists); do NOT set `SMOOTHED_MTM_ENABLED`; no DB write; do not edit anything in the Phase 233 set. Pass criteria C1-C4 are stated in the plan BEFORE the run and use the code's own tolerances; C5 (days over `pnl_dominated_guard`) is descriptive, never a bound (D-05). Fail promotion, never retry-until-green, on a raised `LedgerValuationError`.

**Analog 2 (redaction):** `analytics-service/scripts/flowtiming_dry_run.py` lines 25-28 and 118-123. Ordinals, counts and ratios only; every rendered string passes `_scrub`:
```python
def _scrub(text: str) -> str:
    """Second line of defence: ids, emails, long digit runs and home paths never reach a report."""
    out = _UUID_RE.sub("[redacted]", str(text))
    out = _EMAIL_RE.sub("[redacted]", out)
    out = _HOME_RE.sub("[redacted]", out)
    return _LONG_DIGITS_RE.sub("[redacted]", out)
```
Plus its docstring contract ("never opens a database connection ... writes no file except where `--out` names one") and its `main()` `argparse` shape. Public repo: no PROD ids or account numbers in tracked output or SUMMARY.

**Typing:** `scripts/` is NOT in the CI mypy gate, but keep annotations (analogs are annotated).

### Wave 2: `analytics-service/tests/test_deribit_options_smoothed_probe.py` (test) NEW

**Analog:** `analytics-service/tests/test_flowtiming_dry_run.py` (lines 1-40): module docstring says each test names the intent it protects; synthetic fixtures only; `from scripts import flowtiming_dry_run as dr`; `_SCRIPT = Path(dr.__file__)` so a source-scan test can assert the script has no write verbs and prints no id. And `analytics-service/tests/test_deribit_acceptance.py` (docstring lines 1-20): "Revert-proof anchors (a mutation to the check's core comparison reddens the test)", I/O-free, live driver exercised only by a smoke import. Oracle fixture: `analytics-service/tests/fixtures/deribit_option_round_trip.py` (cash `-0.4839, +0.0280, +3.3339`; options `0.0000, +0.1740, +0.9586`; compare `abs=5e-4`; hand-built `NativeLedger`s). Run pytest from `analytics-service/` only; never `importlib.reload`.

### Wave 2 conditional: `job_worker.py` promotion and `test_stitch_composite_job.py`

Only if the founder-gated measurement passes the pre-stated criteria. **Analog:** the producer handshake test at `analytics-service/tests/test_stitch_composite_job.py` ~1195-1215:
```python
    dq = None
    for table, payload, _ in reversed(fake.upserts):
        if table == "strategy_analytics" and isinstance(payload, dict) \
                and "data_quality_flags" in payload and "metrics_json_by_basis" in payload:
            dq = payload["data_quality_flags"]
            break
    assert dq is not None
    assert dq.get("mtm_gated_reason") == MTM_REASON_OPTIONS == "unsmoothed_options_book"
```
Producer stamping lives in `job_worker.py` (`merged_flags["mtm_gated_reason"] = mtm_reason`, ~14493, inside `if not mtm_ok and mtm_reason is not None:`); gate is `mark_to_market_available` (`stitch_composite.py:336-352`). Promotion must make the TS predicate read "headline is cash" and not just the flag (RESEARCH Wave 2 outline b), so a promoted row is not withheld. Before editing `job_worker.py` re-run `git diff origin/gsd/phase-233-deribittruth -- analytics-service/services/job_worker.py` (RESEARCH A6, not yet done) and add an MT5-only composite byte-identical pytest (155.2 freeze). Promotion is a re-stitch through the product's job, never an UPDATE.

---

## Shared Patterns

### One predicate, strict string, effective flags generation
**Source:** `src/lib/factsheet/headline-basis.ts` (new `isOptionsCashWalletBook`) fed by `src/lib/stored-analytics-result.ts` `effectiveDataQualityFlags` (lines 122-135) and `usesLastSuccessSnapshot` (line 211).
**Apply to:** every surface above. Flags read order: live flags win when they carry a non-empty `cumulative_method`; otherwise the `last_success_snapshot` flags only when bound to the row's `computed_at`; otherwise live (which then lack the marker). Raw `data_quality_flags` reads are an anti-pattern here. Lists and Compare read scalar aliases, never the blob.

### Compile-checked phrase tables, no flag names in public text
**Source:** `GUARD_REASON_PHRASES` (headline-basis.ts 55-59). **Apply to:** all new sentences (factsheet strip, panel, cell title, widened kinds, share card line). Draft wording is in RESEARCH "Recommended design"; copy follows `mtmDisabledReasonCopy`'s voice (factual, institutional, no contractions). Founder sees it at the visual check.

### Muted, not amber
**Source:** `headlineNoteColor` (MetricsColumn.tsx 76-78) `dated` branch and `mtmReasonTone` (basis-context.tsx 961-969). **Apply to:** the factsheet note and any chip/cell title. DESIGN.md:175 reserves warning for transient recoverable states.

### Absence is the convention (blank to dashes plus a named reason)
**Source:** `shapeRowAnalytics` failed arm (queries.ts 1002-1007) over `EMPTY_ANALYTICS`; `computeOgHeadline` NaN sentinel; `figure-gate.ts` null renders the em dash. **Apply to:** Discovery grid/table, owner list, detail fetchers, Compare, card. DESIGN.md:22 and :161: a null renders as the em dash, never 0 or blank.

### Hand-typed oracle, anti-vacuity first, neuter then see RED
**Source:** `headline-verdict.parity.test.ts` (anti-vacuity at line 88), `figure-gate-census.test.ts` header (oracle independence, planted self-test). **Apply to:** every new test. Back up by byte copy, never `git checkout/restore/stash` on uncommitted work.

### Alias projections pinned byte-for-byte in several places
**Source:** `queries.percentile-columns.test.ts` (`PINNED_KPI_PROJECTION`, written by hand), `figure-record-scalars.test.ts`, `queries.test.ts`. **Apply to:** any alias change; one commit moves all of them. Alias values are `->>` text scalars only.

### Ship hygiene
**Source:** CLAUDE.md. **Apply to:** the ship commit: CHANGELOG entry written BEFORE push in the same commit as the VERSION bump (`VERSION` and `package.json` byte-equal 4-digit, never `npm version`); enumerate commits, group by theme, cross-check; name the closed TODOS entry (`DEF-142.2-07`) and delete it in the same PR (RESEARCH recommends close and delete, recording the 2 total / 0 published / 0 `ledger_complete` census in the CHANGELOG and SUMMARY so the founder can reopen it; the planner decides and says which); state in the CHANGELOG that a mixed composite (Deribit options member plus another venue) is withheld by definition; never write the CI skip-trailer tokens; a ship branch changes nothing under `.planning`; no AI-authorship trailers per the founder memory.

## Corrections to RESEARCH found while mapping

1. **Surface 6 (`tearsheet.pdf`) needs no bespoke refusal shape.** `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts` only prints the `/factsheet/[id]/tearsheet` page with Puppeteer; its `data_quality_flags` select (line 193) feeds `analyticsHold`. The tearsheet page builds `FactsheetView` from `fetchAndBuildPayloadWithReason` (page.tsx ~line 200) and `PeerRanksSection` from `payload.figureRecord`, so the verdict seam and marker cover it. RESEARCH assumption A4 is therefore not needed; the planner should confirm with one tearsheet test case rather than a route change. `getFactsheetDetail` (queries.ts ~1777) also goes through `shapeRowAnalytics`, so the new arm covers the metadata and detail fetchers.
2. **The share card needs no new element.** `figureNote` is an existing muted line (route.tsx 393-395) and the card's NaN dashes already come from `headlineVerdict`; CONTEXT's "share card names the reason" is a one-sentence change in the route, not design work (RESEARCH Open Question 2 default of dashes-only is superseded).
3. **`MTM_REASON_SUMMARY_COVERAGE` and the other `mtm_*` reasons are stamped by the single-key derive path too** (stitch_composite.py comments at lines 102-130), while `unsmoothed_options_book` is composite-only; that is why the strict equality (not a prefix or `startsWith("mtm_")`) is load-bearing.
4. **Count of `gateAnnualized` call sites that get the marker for free is unverified.** The marker only reaches records built via the alias scalars; the census test should enumerate, not assume 28.

## No Analog Found

None. Closest-to-novel items and where they borrow from:

| File | Role | Data Flow | Note |
|---|---|---|---|
| Muted withheld tone variant in `MetricsColumn.tsx` | component | request-response | No existing "withheld but steady" variant; borrow the `dated` colour/glyph branch and the `mtmReasonTone` steady classification. |
| `deribit_options_smoothed_probe.py` | script | batch | No existing probe builds the smoothed ledger from live member keys; compose `deribit_acceptance.py` (live crawl) with `flowtiming_dry_run.py` (redaction) and the `deribit_option_round_trip` oracle. |

## Metadata

**Analog search scope:** `src/lib/factsheet/`, `src/lib/` (figure-gate, queries, stored-analytics-result, figure-record-scalars), `src/app/factsheet/[id]/v2/`, `src/app/factsheet/[id]/tearsheet/`, `src/app/api/og/factsheet/`, `src/app/api/factsheet/`, `src/app/(dashboard)/compare/`, `src/__tests__/`, `analytics-service/scripts/`, `analytics-service/services/stitch_composite.py`, `analytics-service/tests/`.
**Files read:** ~30 (targeted ranges for the large files `queries.ts` 6607 lines and `composite-read-path.ts` 1470 lines; no range read twice).
**Not verified here (planner to read before tasking):** `HoldingFactsheet.tsx`, `PeerRanksSection.tsx`, `comparator-block.ts`, `intro/snapshot.ts`, `recommendations/page.tsx`, `allocations/lib/constituent-figure.ts` (RESEARCH rows 12, 13, 15 are grep-level); allocations blends and the wizard/admin are out of scope per CONTEXT.
**Pattern extraction date:** 2026-11-25

## PATTERN MAPPING COMPLETE
