# Phase 107: Leverage as a dailies transform - Pattern Map

**Mapped:** 2026-07-15
**Files analyzed:** 6 source + 3 test = 9
**Analogs found:** 9 / 9 (this is an in-repo refactor — every analog is a sibling file already in the codebase)

> **Nature of this phase (load-bearing for the planner):** This is a *frontend
> refactor*, not net-new construction. There are no "new file, find an analog
> elsewhere" cases — every file being modified either (a) *is* the analog
> template being extended (`basis-context.tsx`), (b) copies a precedent that
> lives one module over (`scenario.ts:325-427`), or (c) is a delete-and-rewire.
> "Match quality" below therefore reads as **template-to-extend**,
> **precedent-to-mirror**, or **delete/rewire** rather than the usual
> exact/role-match grading.

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/lib/factsheet/build-payload.ts` | service (pure derivation) | transform | *itself* — the two existing `deriveSeriesBundle(...)` call sites (`:411`, `:432`) | self / export-only |
| `src/app/factsheet/[id]/v2/basis-context.tsx` | hook / provider | transform (view-merge) | `useBasisSeriesView` (`:132-164`) — **the template being extended in place** | template-to-extend |
| `src/app/factsheet/[id]/v2/leverage-context.tsx` | hook / provider | request-response (state) | `basis-context.tsx` `BasisProvider`/`useBasis` (`:43-54`) — the kept-state shape | delete-derived / keep-provider |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | component (view) | request-response | `MetricsColumnWithBasis` MTM eyebrow (`:326-384`); `KpiStrip` view read (`:791-792`) | delete/rewire |
| `src/lib/factsheet/joint.ts` | service (metrics) | transform | *read-only* — the honesty mechanism, byte-untouched | no-change (proof target) |
| `src/lib/scenario.ts` | service (engine) | transform | *read-only precedent* — `lev()` closure (`:325-427`) | precedent-to-mirror (untouched) |
| `src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx` | test | — | its own eligibility/clamp blocks (kept) + rewrite MODELED blocks | rewrite |
| `src/app/factsheet/[id]/v2/leverage-context.test.tsx` | test | — | its own Test 1/6 (kept) | prune |
| `src/lib/factsheet/joint.test.ts` | test | — | `#597 periodsPerYear` scaling block (`:39-52`) — **the exact template for an L-scaling case** | analog-in-file |

**Confirmed payload field names** (for the client re-derive args, `types.ts`):
`payload.strategyReturns` (`:488`), `payload.dates` (`:486`), `payload.periodsPerYear`
(`:598`, optional), `payload.markets` (`:465`), `payload.strategyName` (`:463`).

---

## Pattern Assignments

### `src/app/factsheet/[id]/v2/basis-context.tsx` — the leverage composition (PRIMARY WORK)

**Role:** hook / view-merge. **Analog: the file itself** — `useBasisSeriesView`
is *simultaneously* the template AND the function to extend/wrap. Compose leverage
INTO it (or a thin wrapper reading `useLeverage()`), per CONTEXT "Architecture /
composition". Order: **basis-merge FIRST, then `r→L·r` re-derive on that result.**

**The identity short-circuit template to copy verbatim** (`basis-context.tsx:139-163`):
```typescript
export function useBasisSeriesView(payload: FactsheetPayload): FactsheetPayload {
  // Read context directly (NOT via useBasis, which throws) so a panel mounted
  // WITHOUT a provider degrades gracefully instead of crashing.
  const basis = useContext(BasisContext)?.basis ?? "cash_settlement";
  return useMemo<FactsheetPayload>(() => {
    const bundle = payload.seriesByBasis?.mark_to_market;
    if (basis !== "mark_to_market" || !bundle) return payload;   // ← by REFERENCE = byte-identical (SC-4 template)
    // ... {...payload, ...bundle} merge ...
  }, [basis, payload]);
}
```

**Leverage layer to author** — mirror the short-circuit, then re-derive. Insert an
analogous guard **before** any `deriveSeriesBundle` call (SC-4):
```typescript
// pattern: extend/wrap useBasisSeriesView
const base = useBasisSeriesView(payload);        // basis merge first (active-basis dailies)
const { leverage } = useContext(LeverageContext) ?? { leverage: 1 };  // degrade like the basis read
return useMemo<FactsheetPayload>(() => {
  const L = sanitizeLeverage(leverage);
  if (L === 1) return base;                       // ← SC-4: base view BY REFERENCE, never re-derive
  const leveredDailies = base.strategyReturns.map((r, i) => ({ date: base.dates[i], value: L * r }));
  const bundle = deriveSeriesBundle(leveredDailies, { /* args below */ });
  return { ...base, ...bundle };                  // same spread shape as the MTM arm (:158-162)
}, [base, leverage]);
```

**`deriveSeriesBundle` re-derive args (CONTEXT-locked, mirrors the MTM arm `build-payload.ts:432-440`):**
```typescript
deriveSeriesBundle(leveredDailies, {
  periodsPerYear: base.periodsPerYear,     // payload.periodsPerYear (types.ts:598); gate leverageEligible on != null
  isArithmetic: false,                     // single-key is GEOMETRIC (see Shared Pattern: isArithmetic guard, A2)
  markets: base.markets,                   // types.ts:465
  strategyName: base.strategyName,         // types.ts:463
  // comparatorAnnVol: OMIT — let the levered bundle vol-match its OWN levered vol,
  //   exactly as the MTM arm omits it (build-payload.ts:437-438). Do NOT pass the
  //   persisted cash overlay ann_vol (that un-levers the comparator vol-match).
})
```
**Do NOT lever the benchmark leg** — only `strategyReturns` is multiplied.
`deriveSeriesBundle` re-aligns `BTC_DAILY`/`SPX_DAILY`/etc internally on the levered
axis (`build-payload.ts:215-219`) and `buildComparatorBlock → jointMetrics(leveredStrat,
unleveredBench)` is what makes β→L·β / α→L·α fall out honestly.

---

### `src/lib/factsheet/build-payload.ts` — export `deriveSeriesBundle` (ENABLER)

**Analog: the two existing internal call sites.** Currently `function
deriveSeriesBundle(...)` at `:186` is module-private. The ONLY change is making it
`export`-able for the client re-derive. It is already called twice inside the same file:

**Cash bundle** (`:411-418`) and **MTM bundle** (`:432-440`) — the client leverage call
copies the MTM arm's arg shape (comparatorAnnVol omitted). The full return contract
(`:262-298`) shows everything one bundle carries — charts, rolling, comparators+joint,
heatmaps, quantiles, streaks, calmarByYear, `bootstrapCI`, styleDrift, stressWindows,
`strategyMetrics`, correlations. `bootstrapCI` (`:292`) is the heaviest sub-derivation —
the measurement-gated perf note (CONTEXT "Performance") targets THIS.

**A1 (verified client-safe):** `build-payload.ts` has no `server-only` / `next/headers`
import; many `.test.tsx` already import it under jsdom. Safe to call in a client hook.

---

### `src/app/factsheet/[id]/v2/leverage-context.tsx` — delete derived hooks, KEEP provider

**Analog: `basis-context.tsx:43-54` (the provider/hook shape to preserve).**

**KEEP verbatim** (`:31-58`) — `LeverageContext`, `LeverageProvider`, `useLeverage`.
This is the exact split-context template `basis-context.tsx` uses (`BasisProvider`
`:43-47`, `useBasis` `:50-54`): narrow context + memoized `{state, setter}` value +
throwing hook. GUARD-04: no storage/URL/cookie/history anywhere (`:16-21`).

**DELETE** (`:60-168`):
- `useModeledLeverage` (`:71-92`) — the cheap BASE·1× predicate.
- `useLeveragedMetrics` (`:110-168`) — the standalone `compute(payload.strategyReturns.map(r => appliedLeverage * r), ...)` recompute (`:154-159`) that discards eq/dd. **This is the exact bespoke path SC-5 forbids** — after the refactor no `compute(...map(r => L*r)...)` may exist outside `scenario.ts`.
- The now-orphaned imports: `compute`, `useBasisMetrics`, `ComputeSummary` (keep `sanitizeLeverage` — moves to the basis-context leverage layer).

---

### `src/app/factsheet/[id]/v2/FactsheetView.tsx` — delete disclosure, swap to levered view

**Analog for the KEEP shape:** the MTM eyebrow logic in the same file already models
"render an eyebrow only when a condition holds, else the bare column, byte-identical."

**KpiStrip (`:770-887`) — swap the metrics source:**
```typescript
// CURRENT (:783): const { basis, m, modeled, appliedLeverage } = useLeveragedMetrics(payload);
// TARGET: read the levered VIEW like every other panel —
const view = useBasisSeriesView(payload);      // now leverage-composed (:791 already reads it for joint)
const m = view.strategyMetrics;                // the 7 scalars follow leverage
const j = view.comparators[cmpKey].joint;      // α/β/IR follow leverage honestly (:792 unchanged)
```
**Delete (D1-D3):**
- `LEVERAGE_CAVEAT` const (`:767-768`).
- MODELED amber eyebrow + caveat JSX (`:875-887`, the `{modeled && (...)}` block).
- `suppressRelative = modeled || (...)` (`:829`) → drop the `modeled` disjunct; α/IR
  render honest values. **KEEP** the `basis === "mark_to_market" && !mtmBundlePresent`
  disjunct (orthogonal MTM-bundle-absent concern, UI-SPEC D3).

**MetricsColumnWithBasis (`:326-384`) — delete the BASE·1× branch (D4):**
- Delete `const { modeled } = useModeledLeverage(payload);` (`:337`) and the
  `data-testid="metricscolumn-base-track-eyebrow"` block (`:365-372`).
- **No-orphan (UI-SPEC D4):** the `if (!composite)` path must return the **bare
  `<MetricsColumn>`** when `!mtmParticipant` (drop the wrapping `flex flex-col gap-4`
  div when only the leverage branch is gone), so no empty eyebrow gap remains. The
  MTM `BASIS · MARK-TO-MARKET` branch (`:373-380`) stays untouched.

**ControlBar (`:1160-1270`) — KEEP the cluster, edit two lines + reword copy:**
- **Remove the cash-only gate** (`:1174-1175`): `leverageEligible = !composite &&
  payload.periodsPerYear != null && basis === "cash_settlement"` → drop the
  `basis === "cash_settlement"` clause (CONTEXT "Scope"). Keep `!composite` +
  `periodsPerYear != null`.
- **Reword clamp copy** (see Shared Pattern: Microcopy) — `:1191` negative message,
  `:1194` over-max message. The `:1185` non-finite message and `:1233-1234`
  title/aria are already honest → **kept unchanged**.
- Everything else (`onLeverageChange`, `resetLeverage`, `leverageMsg`, the input
  cluster `:1217-1269`, the L-1 empty-field guard `:1240`) is UNCHANGED.

---

### `src/lib/scenario.ts` — PRECEDENT ONLY (byte-untouched, LEV-02)

The `lev()` closure (`:325-328`) + `r += w * lev(s.id) * strategyReturns[s.id][i]`
(`:427`) is the canonical shape Phase 107 mirrors: **lever the daily return in the
numerator BEFORE the cumulative/metrics derivation.** Note `scenario.ts` does NOT
lever the correlation/benchmark input (`:110-114`) — corr is leverage-invariant.
This file is OUT OF SCOPE and must not be edited (SC-5 grep-gate exempts it).

---

### `src/lib/factsheet/joint.ts` — the honesty mechanism (READ-ONLY)

Byte-untouched. The α/β algebra is *why* the delete is safe. Under `rets → L·rets`,
`bench` unchanged (`:21-32`):
- `beta = cov/varB` → `cov → L·cov`, `varB` fixed ⇒ **β → L·β** (`:30`)
- `alpha = (m − beta·mb)·ppy` → `(L·m − L·beta·mb)·ppy` = **L·α** (`:31`)
- `corr = cov/(s·sb)` → `s → L·s` ⇒ **corr invariant** (`:32`)

Reached via `comparator-block.ts:36` `jointMetrics(stratReturns, benchReturns, 0,
periodsPerYear)` — strat leg levered, bench leg not. SC-2 pins this.

---

## Shared Patterns

### SC-4 identity short-circuit (return base by reference)
**Source:** `basis-context.tsx:141` (`if (basis !== "mark_to_market" || !bundle) return payload;`)
**Apply to:** the new leverage layer — `if (sanitizeLeverage(L) === 1) return base;`.
Reference-equal return ⇒ byte-identical render, no float tolerance. This is the
load-bearing SC-4 mechanism, NOT float reasoning. Mirrors the two existing
short-circuits (basis-context `:141` + the deleted `leverage-context.tsx:148-152`).

### isArithmetic guard (A2, plan-time REQUIREMENT)
**Source:** `build-payload.ts:381` (`const isArithmetic = opts?.cumulativeMethod === "arithmetic"` — server-only; payload carries no `isArithmetic`).
**Apply to:** the client re-derive. Hard-code `isArithmetic: false` (single-key is
geometric; the Zavara "simple"/arithmetic override is composite/allocated-capital,
and composites hide the slider `:1174`). Plan-time: add an assertion confirming no
arithmetic single-key case exists; if one can, thread `cumulativeMethod` onto the
payload instead.

### Graceful context degrade (no crash outside provider)
**Source:** `basis-context.tsx:138` (`useContext(BasisContext)?.basis ?? "cash_settlement"`)
**Apply to:** the leverage read in the view layer — `useContext(LeverageContext)?.leverage ?? 1`.
Several isolated panel mounts render without a `LeverageProvider`; degrade to L=1
(base by reference) rather than throw.

### Microcopy reword (UI-SPEC Copywriting Contract — verbatim strings)
**Source:** `FactsheetView.tsx:1191, 1194` (current "…isn't modeled in this projection" / "maximum modeled leverage").
**Apply to:** the two clamp messages. Verbatim replacements:
- negative: `Leverage can't be negative — shorting isn't included in this what-if. Clamped to 0.`
- over-max: `Leverage clamped to {MAX_LEVERAGE}× — the maximum in this what-if projection.`
- what-if disclosure (replaces `LEVERAGE_CAVEAT`, renders **inserted at L≠1 only**,
  **muted** `text-text-muted` caption, `role="status" aria-live="polite"`, OFF amber
  per UI-SPEC Color): `What-if projection at {L}× leverage: daily returns are scaled r → L·r and the whole factsheet re-derives. Excludes borrow, funding, and liquidation cost — not the strategy's realized track record.`
- `{MAX_LEVERAGE}` interpolates the `src/lib/leverage.ts` constant — never hard-code the numeral.

### SC-5 grep-gate (new test)
**Pattern:** after the refactor, NO standalone `compute(...map(r => L * r)...)` may
exist outside `scenario.ts`. Source-scan test, mirrors the existing GUARD-04
source-scan (`leverage-context.test.tsx:191-205` Test 6 — reads the file text and
regex-asserts absence). Copy that test's `readFileSync + regex` shape.

---

## Test Patterns

### `joint.test.ts` — add an L-scaling case (SC-2)
**Analog IN THE FILE:** the `#597 periodsPerYear` block (`:39-52`) already proves
"scale an input, assert which outputs move and which are invariant" (byte-identical
default vs explicit; 365 scales alpha/TE, beta/corr invariant). Copy that structure:
compute `jointMetrics(rets, bench)` then `jointMetrics(rets.map(r => L*r), bench)`;
assert `beta2 ≈ L·beta1`, `alpha2 ≈ L·alpha1`, `corr2 ≈ corr1`. Falsifiable — fails
if a future change re-analytic-scales.

### `FactsheetView.leverage.test.tsx` — rewrite MODELED blocks, KEEP eligibility/clamp
**KEEP** (`:196-247`, `:357-421`): eligibility gate, composite-never-recompute,
L=1 baseline byte-identity, empty-field guard, clamp messaging (update the two
reworded strings). **REWRITE** the MODELED/α-IR/BASE·1× blocks (`:249-356`):
- `:249-297` MODELED state → assert charts + rail + α/β **follow L** (real values,
  no `MODELED`/no caveat const).
- `:298-327` WR-01 α/IR suppression → **invert**: at L≠1 α/IR show real (L·α) values,
  `"—"` only for the surviving MTM-bundle-absent reason.
- `:328-356` M-3 BASE·1× → delete (rail now levers with everything else).

### `leverage-context.test.tsx` — prune to kept surface
**KEEP** Test 1 (`:91` throws-outside-provider), Test 6 (`:191` GUARD-04 source scan).
**DELETE** Tests 2/3/4/5/7 (`:95-190`) — all exercise the deleted
`useLeveragedMetrics`/`useModeledLeverage` recompute + MTM short-circuit. The SC-4
L=1 identity assertion moves to the new leverage-view test against the extended hook.

---

## No Analog Found

None. Every file is either the analog itself (in-repo refactor), a byte-untouched
precedent (`scenario.ts`, `joint.ts`), or a delete/rewire of existing code. The
planner should reference the sibling-file excerpts above directly, not RESEARCH.md
generic patterns.

---

## Metadata

**Analog search scope:** `src/app/factsheet/[id]/v2/` (view + contexts + tests),
`src/lib/factsheet/` (build-payload, joint, comparator-block, types), `src/lib/scenario.ts`,
`src/lib/leverage.ts`.
**Files scanned:** 9 read in full/targeted + `types.ts`/`comparator-block.ts` grep-verified.
**Pattern extraction date:** 2026-07-15
