# Phase 152: SCEN — Composer legibility - Pattern Map

**Mapped:** 2026-08-07
**Files analyzed:** 9 modified + 1 optional-new (chip component)
**Analogs found:** 10 / 10 (every surface has an in-repo analog; zero "no analog" rows)

**Tree verified:** `feat/v1.17-151-aum` @ `115751118c738771aa8d39687ff8439bfac4b2ba`.
`ScenarioComposer.tsx` is 6,467 lines — **identical to the tree RESEARCH.md read**, so
every line anchor below is live, not stale. Re-verify by symbol if anything lands on
this file before execution (`renderDollarInput`, `notionalText`, `Strategies added ·`,
`addedStrategyMetadataLookup`, `<CompositionList`).

⚠️ **Path correction (carried from RESEARCH §State of the Art):** the browse route is
`src/app/api/strategies/browse/route.ts`. `src/app/api/allocator/strategies/browse/`
does not exist — CONTEXT.md and UI-SPEC.md both cite it. Use the real path.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/api/strategies/browse/route.ts` | route handler | request-response (read projection) | **itself** — the Phase-29 `is_example` additive key, `route.ts:143-153` + `:241-244` | exact (self-precedent) |
| `src/app/api/strategies/browse/route.test.ts` | test (unit) | request-response | `route.test.ts:731-794` (H-0300a/b) + `:674-717` (T12f own-vs-other) | exact |
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` | model / zod schema | persisted state (localStorage + jsonb) | `manualAumUsd` decl `scenario-state.ts:920-932` — **but applied to the NESTED `addedStrategySchema:845-850`** | exact pattern, different host schema |
| `src/app/(dashboard)/allocations/lib/scenario-state.test.ts` | test (unit) | persisted state | `describe("AUM-01 manualAumUsd (Phase 151)")` `:1052-1126` | exact — **with the fixture fixed (see Mapper Note 1)** |
| `ScenarioComposer.tsx` — 3 add seams | component (wiring) | event-driven (callback payload) | the three existing literals themselves `:4074-4081`, `:5418-5425`, `:5452-5459` | exact (two are byte-identical twins) |
| `ScenarioComposer.tsx` — new `addedMetricsByRef` prop | component (prop thread) | derived projection | `addedProvenanceByRef`: derived `:2460-2472`, declared `:5674`, threaded `:5285` | exact |
| `ScenarioComposer.tsx` — "Yours" chip | component (render) | pure projection | `OwnershipTag.tsx:34-48` (strings) + `CoverageStateChip.tsx:42-69` (component shape) | exact |
| `ScenarioComposer.tsx` — header `<li>` | component (render) | presentational | separator li `:6193-6197` + eyebrow recipe `:4310-4315` | role-match (composed from two) |
| `ScenarioComposer.tsx` — name button + inline detail | component (interaction) | local view state | `HoldingsTable.tsx:738, 860-868, 960-974` + `HoldingDetail.tsx:20-21` + `StrategyTable.tsx:973-978` | exact (host idiom) — ⚠️ **not** its a11y |
| `ScenarioComposer.tsx` — honest notional em-dash | component (render) | pure projection | `renderDollarInput`'s unset branch `:5875-5885` | exact |
| `ScenarioComposer.test.tsx` | test (component) | render + interaction | AUM-01 Test 6 `:12143-12174`; harness `:456-461`, `:585-599`, `:11845-11890` | exact |
| `StrategyBrowseDrawer.tsx` | component | fetch-once + client filter | row shape `:43-56`, `handleAdd :333-339`, `filtered :280-305`, secondary line `:560-564`, testid rationale `:587-605` | exact (self-precedent) |
| `StrategyBrowseDrawer.test.tsx` | test (component) | render | T16 `:322-366` (discriminating tag test) + `renderDrawer :73-95`, `flush :98-103` | exact |
| *(optional new)* ownership-chip component file | component (leaf) | pure projection | `CoverageStateChip.tsx` (whole file, 69 lines) | exact |
| *(optional)* `e2e/composer-axe.spec.ts` | test (e2e a11y) | browser | itself — one added expand click before `analyze()` | exact |

---

## Pattern Assignments

### `src/app/api/strategies/browse/route.ts` (route handler, request-response)

**Analog:** itself — the Phase-29 `is_example` additive key is the exact shape of the
`isOwn` / `created_at` / `status` add.

**Additive-column pattern in the SELECT** (`:139-156`) — a co-fetched column is added to
the string list with a comment explaining *why it is read and whether it is emitted*:

```ts
    const { data, error } = await withPublishedOrOwner(
      supabase
        .from("strategies")
        .select(
          // CONTRIB-03 — co-fetch `user_id` so the projection can surface the
          // owner's OWN name un-redacted (see the own-row branch below). It is
          // read ONLY to compare against the session id; the raw column is never
          // emitted on the wire.
          "id, user_id, name, codename, disclosure_tier, markets, strategy_types, is_example",
        ),
      user.id,
    )
```

⚠️ Do NOT hand-roll the owner predicate — `withPublishedOrOwner(query, user.id)` is
mandatory (`quantalyze/no-raw-published-predicate` is `error`, `eslint.config.mjs:46-49`),
and the client must stay the **user-scoped** `createClient()` (`:113`, rationale
`:114-133`; service_role has BYPASSRLS).

**Row-cast pattern** (`:200-210`) — every co-fetched column is declared on the local
`r` cast before use; `created_at` / `status` need adding here too:

```ts
      const r = row as {
        id: string;
        user_id: string | null;
        name: string;
        codename: string | null;
        disclosure_tier: DisclosureTier | null;
        markets: unknown;
        strategy_types: unknown;
        is_example: unknown;
      };
```

**The ownership bit already exists** (`:220`) — do not recompute, do not ship the
viewer's uid to the client:

```ts
      const isOwnRow = r.user_id !== null && r.user_id === user.id;
```

**Named-key fence to widen** (`:233-245`) — explicit literal, never `{ ...row }`; the
`is_example` line documents the strict-boolean coercion discipline `isOwn` must copy:

```ts
      return {
        id: r.id,
        name: safeLabel,
        codename: r.codename ?? null,
        markets: Array.isArray(r.markets) ? (r.markets as string[]) : [],
        strategy_types: Array.isArray(r.strategy_types)
          ? (r.strategy_types as string[])
          : [],
        // H-0300 fence: explicit named key (NOT a `...row` spread). Coerce to a
        // strict boolean so a NULL/undefined source column never widens the
        // wire shape beyond `boolean`.
        is_example: r.is_example === true,
      };
```

**Interface-doc pattern** (`:59-68`) — each additive key on `BrowseStrategyRow` carries a
TSDoc block naming the phase/requirement, what `true` means, and why it is not a
disclosure widening. Mirror that voice for `isOwn` (uniform key, `false` on third-party)
and for the OWN-only `created_at` / `status` (state the conditional emission in the doc,
because the TS type will read optional).

**Error-handling pattern** (`:164-174`) — unchanged; do not add a new error path that
forwards a raw Postgres `error.message`.

---

### `src/app/api/strategies/browse/route.test.ts` (test, unit)

**Analog:** `H-0300a` (`:731-764`) — extend into two exhaustive arms, never relax.

```ts
    const ALLOWED = [
      "id",
      "name",
      "codename",
      "markets",
      "strategy_types",
      "is_example",
    ].sort();
    expect(Object.keys(body.strategies[0]).sort()).toEqual(ALLOWED);
    // Explicit forbidden-key fence — disclosure_tier is fetched but must
    // never reach the wire.
    expect(body.strategies[0]).not.toHaveProperty("disclosure_tier");
```

⚠️ This fixture is a **single third-party row**. Adding four keys to this one `ALLOWED`
array passes the test *and* destroys the fence in the same edit (RESEARCH Pitfall 7).
Split into `ALLOWED_THIRD_PARTY` (base + `isOwn`, plus explicit
`.not.toHaveProperty("created_at" | "status")`) and `ALLOWED_OWN` (that + the owner
fields), each still an exhaustive `toEqual`.

**Whole-payload sweep to mirror** (`H-0300b:788-793`) — the absence assertion that a
key-set check cannot make:

```ts
    expect(body.strategies[0]).not.toHaveProperty("backtest_returns");
    expect(body.strategies[0]).not.toHaveProperty("user_id");
    // Whole-payload sweep — none of the sensitive values appear anywhere.
    expect(JSON.stringify(body)).not.toContain("secret-owner-uuid");
```

**Two-row own-vs-other fixture to copy** (`T12f :681-716`) — already sets up exactly the
session-owned + other-owned pair the `isOwn` and disambiguation-emission tests need,
including the `SESSION_ID = "00000000-0000-0000-0000-000000000001"` constant and the
`expect(JSON.stringify(body)).not.toContain(SESSION_ID)` defence-in-depth line.

---

### `src/app/(dashboard)/allocations/lib/scenario-state.ts` (model, persisted state)

**Analog:** the 151-06 `manualAumUsd` declaration (`:920-932`) — copy the *comment
discipline* verbatim (it is the codebase's third repetition of this warning: see also
`leverageOverrides :910-919`):

```ts
  // Phase 151 AUM-01 — the manual portfolio-AUM override (whole USD). Optional +
  // additive so every pre-151 draft validates; no schema_version bump.
  // ⚠️ LOAD-BEARING (same trap as leverageOverrides above): `z.object` STRIPS
  // unknown keys and saved/route.ts persists `parsed.data.draft`, so WITHOUT this
  // declaration a POSTed manual AUM is silently dropped on the way to the DB.
  // DELIBERATELY NO `.min/.max` range refine — a refine failure on this shared
  // schema routes the codec to the draft-deleting reset (data loss over one
  // out-of-range value). `.nullish()` rather than `.optional()` for the same
  // reason: `JSON.stringify` writes `null` for a NaN, and a bare `z.number()`
  // would REJECT that null → schema_invalid → the user's whole scenario deleted.
  manualAumUsd: z.number().nullish(),
```

**⚠️ Different host schema.** `manualAumUsd` sits on the TOP-LEVEL
`scenarioDraftSchema:901`. `isOwn` must go on the **nested** schema (`:845-850`), which
today is:

```ts
const addedStrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  markets: z.array(z.string()),
  strategy_types: z.array(z.string()),
});
```

embedded at `:907` as `addedStrategies: z.array(addedStrategySchema).max(200)`.

**TS interface to widen** (`:96-104`) — note `id` is branded; keep the brand:

```ts
export interface AddedStrategy {
  /** H5-branded — minted only when the strategy enters draft state via
   *  addStrategyBrowse / addStrategyBridge. Outside callers must cast at
   *  the construction boundary. */
  id: StrategyForBuilderId;
  name: string;
  markets: string[];
  strategy_types: string[];
}
```

**Mutators need no change** — `addStrategyBrowse:484-509` and `addStrategyBridge:519-545`
push the whole `strategy` object (`addedStrategies: [...draft.addedStrategies, strategy]`),
so a new field rides along automatically. The dedupe guard
(`draft.addedStrategies.some((s) => s.id === strategy.id)`) is id-only and unaffected.

**Save-boundary schema** (`:982-992`) — `scenarioDraftSaveSchema` is
`scenarioDraftSchema.superRefine(...)`, so declaring on the nested schema covers both
boundaries with one edit. No new refine.

---

### `src/app/(dashboard)/allocations/lib/scenario-state.test.ts` (test, unit)

**Analog:** `describe("AUM-01 manualAumUsd (Phase 151)")` `:1052-1126` — five tests
(backward decode / round-trip / no-refine+null / strip-guard / version discipline). That
is exactly the 152 test set. Copy the structure, **not the fixture**:

```ts
  const v4Draft = (): ScenarioDraft => ({
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "fp",
    toggleByScopeRef: { "holding:binance:BTC:spot": true },
    addedStrategies: [],          // ⚠️ EMPTY — vacuous for a NESTED-field test
    weightOverrides: { "holding:binance:BTC:spot": 1 },
    memberKeyIds: [],
    lastEditedAt: "2026-08-07T00:00:00.000Z",
  });
```

**Strip-guard shape to mirror** (`Test 4, :1102-1121`) — both schemas, one test:

```ts
    const parsed = scenarioDraftSchema.safeParse({ ...v4Draft(), manualAumUsd: 250_000 });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.manualAumUsd).toBe(250_000);
    // And through the SAVE-boundary schema the two save routes use.
    const saved = scenarioDraftSaveSchema.safeParse({ ...v4Draft(), manualAumUsd: 250_000 });
```

For 152 the assertion path becomes `parsed.data.addedStrategies[0].isOwn` over a
populated fixture. Also mirror `Test 5 (:1123-1125)`: `expect(SCENARIO_SCHEMA_VERSION).toBe(4)`.

---

### `ScenarioComposer.tsx` — the three add seams (component wiring, event-driven)

**Analog:** the seams themselves. **Seam A (`:4074-4081`, empty-state mount) and Seam B
(`:5418-5425`, main-body mount) are byte-identical twins** — the single most likely
partial edit in this phase:

```tsx
        onAdd={(s) =>
          handleAddStrategy({
            id: s.id as AddedStrategy["id"],
            name: s.name,
            markets: s.markets,
            strategy_types: s.strategy_types,
          })
        }
```

**Seam C (`:5452-5459`, BridgeDrawer)** — different mutator, different source:

```tsx
        onAddToScenario={(holdingScopeRef, candidate) => {
          const id = candidate.id as AddedStrategy["id"];
          scenario.addStrategyBridge(holdingScopeRef, {
            id,
            name: candidate.name,
            markets: candidate.markets,
            strategy_types: candidate.strategy_types,
          });
```

CONTEXT locks "never fabricate ownership" ⇒ leave `isOwn` **absent** here, with a comment
saying so deliberately (a Bridge candidate carries no ownership signal). Absent and
`false` render identically; absent is the honest claim.

**Fourth site — inside the drawer** (`StrategyBrowseDrawer.tsx:333-339`) — see that
file's section below.

---

### `ScenarioComposer.tsx` — new `addedMetricsByRef` prop (derived projection)

**Analog:** `addedProvenanceByRef` — the exact "derive a narrow projection from
`addedStrategyMetadataLookup`, thread it read-only into `CompositionList`" pattern,
already shipped for CONSTIT-02.

**Derivation** (`:2460-2472`) — a `useMemo` keyed on the lookup, with a TSDoc that says
"presentation-only, never enters the frozen engine":

```tsx
  const addedProvenanceByRef = useMemo<Record<string, ProvenanceTier | null>>(
    () => {
      const out: Record<string, ProvenanceTier | null> = {};
      for (const [id, meta] of Object.entries(addedStrategyMetadataLookup)) {
        out[id] = deriveProvenance({
          trust_tier: meta.trust_tier,
          is_composite: meta.is_composite,
        });
      }
      return out;
    },
    [addedStrategyMetadataLookup],
  );
```

**Source of the metric values** (`:2425-2428`) — already null-honest for drawer-added rows:

```tsx
      map[a.id] = {
        disclosure_tier: found?.strategy.disclosure_tier ?? "public",
        cagr: found?.strategy.strategy_analytics?.cagr ?? null,
        sharpe: found?.strategy.strategy_analytics?.sharpe ?? null,
```

**Prop declaration** (`CompositionListProps`, `:5674` + the doc-comment convention at
`:5677-5700`) — every threaded map carries a TSDoc naming the requirement, what the
value means, and what absence means. Destructure it into the `CompositionList` signature
at `:5757-5778` and pass it at the call site `:5280-5301`, adjacent to
`addedProvenanceByRef={addedProvenanceByRef}` (`:5285`).

**Formatters** — `formatPercent` is already imported at `:121`; `formatNumber` is a new
import from the same `@/lib/utils` module (used by `HoldingDetail.tsx:29`). Both return
`"—"` for null/non-finite; never write an inline `toFixed`.

---

### `ScenarioComposer.tsx` — "Yours" ownership chip (render, pure projection)

**Analog A — the strings, byte-verbatim** (`OwnershipTag.tsx:34-48`):

```ts
const ANATOMY =
  "inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium";
// …
  [TEAM_REVIEW]: "bg-badge-other/10 text-text-muted",
```

⛔ Do NOT widen `OwnershipTag`'s switch. Its closure is a documented anti-spoofing
property (`OwnershipTag.tsx:19-24`, threat T-150-08) and the component returns `null` for
anything outside `{own_capital, team_review}` (`:56`). Do NOT route through `Badge`
(`Badge.tsx:55` falls back to a trusted-looking DRAFT badge).

**Analog B — the component shape**, if the planner chooses a sibling component over an
inline span: `CoverageStateChip.tsx` is the in-surface precedent for a leaf chip —
module-level `BASE` const + a closed `Record` of label/class + `cn(BASE, cls, className)`
+ a header comment pinning the state→label→token mapping and *why* the token is what it
is (`:1-69`). Note it also documents the family split this phase inherits:
`rounded-sm` uppercase = derived state; `rounded-md` = persistent fact (the "Yours" chip).

**Render site** (`:6268-6277`) — UI-SPEC places the chip between `TrustTierLabel` and
`CoverageStateChip`, `shrink-0`:

```tsx
                <span className="text-sm text-text-primary">{a.name}</span>
                {/* CONSTIT-02 — per-row provenance badge (api_verified / csv /
                    self_reported / composite). Null → no badge (honest absence). */}
                <TrustTierLabel
                  trustTier={addedProvenanceByRef[a.id] ?? null}
                  className="shrink-0"
                />
                {chipState && (
                  <CoverageStateChip state={chipState} className="shrink-0" />
                )}
```

Note the render gate idiom already in place: `{chipState && …}` — the chip renders only
on a truthy state, exactly the `isOwn === true` discipline (absent/`false`/`null` → no
node at all, never a `!== false` gate).

---

### `ScenarioComposer.tsx` — header label `<li>` (render, presentational)

**Analog A — the non-row `<li>` precedent + mount point** (`:6193-6197`), immediately
before `{draft.addedStrategies.map((a) => {` at `:6198`:

```tsx
        {draft.addedStrategies.length > 0 && (
          <li className="mt-2 px-1 text-xs uppercase tracking-wider text-text-muted">
            Strategies added · {draft.addedStrategies.length}
          </li>
        )}
```

The header `<li>` mounts between this and the map, inside the same `length > 0` guard.
Precedent confirmed: a non-row `<li>` already lives in this `<ul>`.

**Analog B — the mono eyebrow recipe, byte-verbatim** (`:4310-4315`, the 151 PORTFOLIO
AUM label — the only occurrence in this file):

```tsx
        <label
          htmlFor="scenario-aum"
          className="font-mono text-fixed-10 uppercase tracking-[0.18em] text-text-muted"
        >
          PORTFOLIO AUM (USD)
        </label>
```

**Column widths to mirror** — read off the live added-row cluster (`:6279-6337`), which
is a `<div className="flex items-center gap-2">`:

| Column | Live class | Line |
|--------|-----------|------|
| weight input | `w-20` | `:6292` |
| USD input / unset span | `w-24` | `:5918` / `:5880` |
| mode toggle | no fixed width (`px-2 py-1 text-fixed-11`) | `renderModeToggle :5930` |
| *(target input — conditional, no label)* | `w-16` | `renderTargetInput :5957` |
| leverage input | `w-16` | `:6319` |
| notional span | `w-20` | `:6326` |
| remove `×` button | `px-2 py-1 text-xs` | `:6334` |

⚠️ Geometry: the row's outer wrapper is `<div className="flex w-full items-center
justify-between gap-3">` (`:6249`) inside an `<li … p-3 border>` (`:6245`), and the
parent `<ul>` is `grid gap-2` (`:6058`). The header `<li>` must reproduce that outer
geometry (padding + `justify-between` / `ml-auto`), not the separator li's `px-1`.

**A11y:** UI-SPEC pins `aria-hidden="true"` on the header (every control already has its
own `sr-only` label — see `:6280-6282`, `:6304-6306`).

---

### `ScenarioComposer.tsx` — name button + inline detail (interaction, local view state)

**Analog A — one-open-at-a-time, parent-owned** (`HoldingsTable.tsx:738`, `:860-868`):

```tsx
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
```

```tsx
                  <tr
                    onClick={() =>
                      setExpandedRowId((prev) =>
                        prev === row.id ? null : row.id,
                      )
                    }
                    aria-expanded={isExpanded}
```

`HoldingDetail.tsx:20-21` states the contract: *"One-open-at-a-time is owned by the
parent table (only one HoldingDetail is mounted at a time). This component is purely the
tab body."* Use a single `string | null` in `CompositionList`, never a `Set`.

**Analog B — the detail host** (`HoldingsTable.tsx:960-974`) — a conditional sibling
carrying `bg-surface p-3` behind a hairline:

```tsx
                  {isExpanded ? (
                    <tr data-detail-row-id={row.id}>
                      <td
                        colSpan={DESIGN_TOTAL_COLUMNS}
                        className="border-b border-border bg-surface p-3"
                      >
                        <HoldingDetail … />
```

For 152 the host is inside the row `<li>` (which already carries `flex flex-col gap-2 …
p-3`, `:6245`), below the main row `<div>` — UI-SPEC pins `mt-2 border-t border-border pt-3`.
Precedent for extra children under the main row line already exists in the same `<li>`:
the series-state notes at `:6349-6366` and `renderSolveState(a.id)` at `:6367`.

**⚠️ Do NOT mirror the analog's a11y.** `HoldingsTable.tsx:860-868` puts `onClick` +
`aria-expanded` on a bare `<tr>` with no role, no `tabIndex`, no key handler — pointer-only.
UI-SPEC prescribes the fix: the strategy NAME becomes a real `<button type="button">`
with `aria-expanded` + `aria-controls="scenario-detail-{id}"` (Enter/Space native, no
`onKeyDown`). The row `<li>`'s `onClick` is pointer amplification only.

**Per-control escape hatch** (`HoldingsTable.tsx:888-893`) — the `stopPropagation` idiom,
though 152 applies ONE wrapper on the control-cluster `<div>` (`:6279`), not per-control:

```tsx
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRowId(row.id);
                            }}
```

**Analog C — the factsheet link + hover affordance** (`StrategyTable.tsx:973-978`):

```tsx
                            <Link
                              href={`/factsheet/${s.id}`}
                              className="font-medium text-text-primary hover:text-accent transition-colors"
                            >
                              {s.name}
                            </Link>
```

`/factsheet/${id}` is the repo convention; UI-SPEC recolors the detail-panel link itself
to `text-accent hover:text-accent-hover text-sm` (the panel's single accent element) and
reuses `hover:text-accent transition-colors` for the row-name button.

**Detail eyebrows** reuse the same `font-mono text-fixed-10 uppercase tracking-[0.18em]
text-text-muted` recipe as the header. ⚠️ `TrustTierLabel` renders nothing for a null
tier (`TrustTierLabel.tsx:38-40`), so a `PROVENANCE` eyebrow with a null tier is a
labelled empty space — render an explicit `—` or omit the eyebrow, and pin the choice.

---

### `ScenarioComposer.tsx` — honest non-derivable notional (render)

**Analog:** `renderDollarInput`'s unset branch (`:5870-5885`) — the `title` + duplicated
`sr-only` span, with the comment stating why the duplication is load-bearing:

```tsx
    // AUM unset — an honest non-derivable state, the notionalText recipe: the
    // em-dash, never a silently disabled input and never a fabricated $0. The
    // title is duplicated into an sr-only span because a title alone is
    // unreachable by keyboard/touch and is not announced by every screen reader
    // (UI-SPEC §2). No division executes on this branch.
    if (!Number.isFinite(scenarioAum) || scenarioAum <= 0) {
      return (
        <span
          data-testid="scenario-constituent-usd-unset"
          title={AUM_UNSET_REMEDY}
          className="w-24 text-right font-mono text-xs text-text-muted"
        >
          —<span className="sr-only">{AUM_UNSET_REMEDY}</span>
        </span>
      );
    }
```

**Target to change — a DIFFERENT span, ~450 lines later** (`:6321-6329`). Its derived-state
`title` must survive verbatim; only the `notionalText(a.id) === "—"` branch changes:

```tsx
                {/* WEIGHTS-00 notional — DERIVED read-only text (equity × L),
                    never a weight input. Em-dash when non-derivable. */}
                <span
                  data-testid="scenario-constituent-notional"
                  title="Notional = equity × blend share × leverage — derived, informative only (minimum-investment check); never a weight input"
                  className="w-20 text-right font-mono text-xs text-text-muted"
                >
                  {notionalText(a.id)}
                </span>
```

⚠️ **Copy-cause mismatch (RESEARCH D-3, unresolved).** The em-dash here is produced by
`notionalText` (`:5785-5796`) when `totalBookEquity == null` or the ref is absent from
`blendShareByRef` — **not** by an unset AUM (`AUM_UNSET_REMEDY` is defined at `:5815` for
the *other* cell, whose cause is `scenarioAum <= 0`). `CompositionListProps:5691-5698`
documents the two numbers as deliberately distinct. Shipping "Set portfolio AUM to size
in dollars" here can tell an allocator to set a number that will not make this cell
derivable. Planner must either use a cause-accurate sentence or record explicit founder
acceptance of the shared one.

⛔ Do not touch `notionalText`'s arithmetic (`:5794`), `handleWeightChange`, or
`commitDollarInput` — 151 owns sizing.

---

### `ScenarioComposer.test.tsx` (test, component)

**Harness — the add seam** (`:443-461` + the per-describe mock at `:585-599`):

```tsx
/** Inject an added strategy via the (mocked) browse drawer's captured onAdd.
 *  The capturing mock records onAdd on first render even while the drawer is
 *  closed, so no Browse click is needed. Works in both the empty-state branch
 *  and the main body. */
function addStrategy(s: AddStrategyInput): void {
  expect(browseOnAdd).not.toBeNull();
  act(() => {
    browseOnAdd!(s);
  });
}
```

```tsx
    vi.mocked(StrategyBrowseDrawer).mockImplementation(((props: {
      isOpen: boolean;
      onAdd: (s: unknown) => void;
    }) => {
      browseOnAdd = props.onAdd;
      return props.isOpen ? <div data-testid="browse-drawer-mock" /> : null;
    }) as any);
```

⚠️ See Mapper Note 2 — this captures whichever mount renders, so the seam test must
switch payloads to reach Seam A vs Seam B.

**Absence-branch render test to mirror** (`AUM-01 Test 6, :12143-12174`) — the exact shape
for the SCEN-04 notional test and the SCEN-02 no-chip test: assert non-vacuity first,
then tag name / `title` / text / the `within(cell).getByText(...)` sr-only probe, then
prove reversibility:

```tsx
    const cell = screen.getByTestId("scenario-constituent-usd-unset");
    expect(cell.tagName).toBe("SPAN");
    expect(cell.getAttribute("title")).toBe(
      "Set portfolio AUM to size in dollars",
    );
    expect(cell.textContent).toContain("—");
    expect(
      within(cell).getByText("Set portfolio AUM to size in dollars"),
    ).toBeInTheDocument();
```

**Local helpers to copy** (`:11845-11890`) — `renderUsd(payload)`, `add(id, name)`,
`setAum`, `weightInput`/`dollarInput` via `document.getElementById` on the row-scoped ids
(`weight-${ref}`, `alloc-usd-${ref}`). A 152 describe block should open with the same
helper cluster. Keyboard tests need `@testing-library/user-event` (already a dep) rather
than these `fireEvent` helpers.

**Run command:** `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" -t "<name>" --no-file-parallelism` (12,234 lines / 265 tests).

---

### `StrategyBrowseDrawer.tsx` (component, fetch-once + client filter)

**Row-shape pattern** (`:43-56`) — the drawer keeps its OWN structural declaration of the
route's row (deliberate, documented at `:38-42`), and additive fields land as
**optional** with a TSDoc naming the emitting phase and the absent-branch behaviour:

```ts
export interface StrategyBrowseRow {
  id: string;
  name: string;
  codename: string | null;
  markets: string[];
  strategy_types: string[];
  /**
   * Phase 29 (UNIFY-03 UI) — true for example-universe rows in the merged
   * catalog (`is_example = true AND status = 'published'`). Plan 02 emits this
   * from GET /api/strategies/browse; it gates the neutral-outline "Example"
   * provenance tag rendered next to the row name. Optional + absent → no tag.
   */
  is_example?: boolean;
}
```

Add `isOwn?: boolean` (+ `created_at?: string`, `status?: string`) the same way. Note the
drawer *also* declares its own `AddedStrategy` (`:64-69`, unbranded) — the onAdd payload
contract — which needs the field too.

**The fourth construction site** (`handleAdd :333-339`) — field-by-field, same trap as the
composer seams:

```tsx
  function handleAdd(s: StrategyBrowseRow) {
    onAdd({
      id: s.id,
      name: s.name,
      markets: s.markets,
      strategy_types: s.strategy_types,
    });
```

**Collision detection belongs in/beside the `filtered` memo** (`:280-305`) — which already
maps to `{ s, tier }` pairs and is keyed on `[strategies, q, activeMarkets, activeTypes,
allocatorMandate]`. RESEARCH D-2 recommends computing collisions over `filtered` (two
O(n) passes: build a normalized-name→count map, then tag), so a filter that narrows a
collision set to one row clears the line.

**Secondary-line recipe to clone** (`:560-564`) — the disambiguation line is a second
sibling of this, inside the same `min-w-0` block:

```tsx
                      <div className="mt-1 text-xs text-text-muted">
                        {s.codename ?? ""}
                        {s.codename && s.markets.length > 0 ? " · " : ""}
                        {s.markets.join(" · ")}
                      </div>
```

Note the conditional-separator idiom (`" · "` only when both sides exist) — reuse it for
the `key_count`-absent branch UI-SPEC allows.

**Conditional-tag render + testid pattern** (`:551-558`):

```tsx
                        {s.is_example === true && (
                          <span
                            data-testid={`browse-example-tag-${s.id}`}
                            className="inline-flex items-center rounded-sm border border-text-muted px-2 py-0.5 text-fixed-10 uppercase tracking-wide font-semibold text-text-muted"
                          >
                            Example
                          </span>
                        )}
```

⚠️ **Testid namespace** — `:587-605` documents the PR #620 regression at length: a testid
inside the `browse-add-` family collides with the `[data-testid^="browse-add-"]`
first-match automation locator. `browse-dedup-{id}` (UI-SPEC) is correctly outside it;
`browse-example-tag-{id}` is the in-file precedent for the naming.

---

### `StrategyBrowseDrawer.test.tsx` (test, component)

**Analog:** `T16 (:322-366)` — the discriminating conditional-render test. It is the exact
template for the SCEN-05 tests (collision set gets the line, unique row does not,
third-party rows do not) and for a browse-side `isOwn` chip if adopted:

```tsx
    renderDrawer({ fetchStrategies: async () => mergedRows });
    await flush();
    // The example row carries the "Example" provenance tag; the verified row
    // does not (discriminating — gates on is_example, not on every row).
    const exampleTag = screen.getByTestId("browse-example-tag-s-example-1");
    expect(exampleTag).toHaveTextContent("Example");
    expect(
      screen.queryByTestId("browse-example-tag-s-verified-1"),
    ).not.toBeInTheDocument();
    // LOCKED honesty token: … A regression that swapped to bg-accent … fails here.
    expect(exampleTag.className).toContain("border-text-muted");
```

**Harness** (`:73-95` `renderDrawer` with a `fetchStrategies` override, `:98-103` `flush()`).
Every fixture-driven test injects rows through `fetchStrategies`, never a global fetch mock.

**onAdd payload assertion** (`T9 :239-249`) — the pattern for proving the drawer's own
`handleAdd` carries `isOwn` (the composer test's module-mocked drawer cannot see this):

```tsx
    expect(onAdd.mock.calls[0][0]).toMatchObject({
      id: "s-momentum-1",
      name: "Momentum Alpha",
    });
```

---

## Shared Patterns

### Additive-field discipline (applies to: route.ts, StrategyBrowseDrawer.tsx, scenario-state.ts)
**Source:** `route.ts:59-68`, `StrategyBrowseDrawer.tsx:49-55`, `scenario-state.ts:920-932`
Every additive field in this codebase ships with a TSDoc that names (a) the phase /
requirement id, (b) what a truthy value means, (c) **what absence means**, and (d) why it
is not a widening / not a version bump. Reviewers gate on this.

### Absence is honest — never fabricate (applies to: every render surface)
**Source:** `OwnershipTag.tsx:29-31`, `CoverageStateChip.tsx:26-29`, `notionalText:5779-5784`
```
 * Three display states, and one of them is nothing: an unmarked legacy row
 * renders NO tag. Absence is honest — the remedy is the Mark-ownership dialog,
 * never a fabricated default.
```
Gate on `=== true` (never `!== false`); render `—` via `formatNumber`/`formatPercent`
(both null-safe by construction, `src/lib/utils.ts:8, :28`); never an inline `toFixed`.

### Named-key fence / no spreads on the wire (applies to: route.ts)
**Source:** `route.ts:241-244` + `route.test.ts:766-793`
Explicit object literal, strict coercion per key, exhaustive key-set test plus a
whole-payload `JSON.stringify(...).not.toContain(...)` sweep. Never `{ ...row }`.

### z.object strips — declare or lose it (applies to: scenario-state.ts)
**Source:** `scenario-state.ts:910-919` (leverageOverrides), `:920-932` (manualAumUsd)
Third repetition of the same warning in one file. `.nullish()`, never a refine, never a
`SCENARIO_SCHEMA_VERSION` bump — a refine failure routes the codec to the draft-deleting
reset.

### Presentation-only props never reach the engine (applies to: ScenarioComposer.tsx)
**Source:** `:2397-2405`, `:2454-2459`
Metadata that rides beside the `StrategyForBuilder` Pick is cast away at the adapter
boundary. Thread a *narrow projection* (`{ cagr, sharpe }`) into `CompositionList`, not
the whole lookup.

### Test-id namespaces are an automation contract (applies to: StrategyBrowseDrawer.tsx)
**Source:** `StrategyBrowseDrawer.tsx:595-604`
A prefixed testid that shares a family with a first-match locator is a shipped regression
(PR #620). New testids: `browse-dedup-{id}`, `scenario-detail-{id}`.

### Component-test harness convention (applies to: all three test files)
**Source:** `StrategyBrowseDrawer.test.tsx:73-103`, `ScenarioComposer.test.tsx:456-461, 11845-11890`
Local `renderX` + fixture-injection helpers at the top of each describe; module-mock the
child drawers; `act()`-wrapped `fireEvent`; `flush()` for the fetch effect. New tests
extend an existing describe block — RESEARCH confirms zero new fixture modules needed.

---

## No Analog Found

None. Every surface in this phase has an in-repo analog; the phase installs no packages
and introduces no new idiom. The two "closest but not identical" cases are called out
inline rather than as gaps:

| Surface | Why it is not a clean copy |
|---------|---------------------------|
| `HoldingsTable` → detail expansion | The **host** idiom transfers; its interaction model does not (`<tr onClick>` with `aria-expanded`, no role/tabIndex/key handler). Copy the host, replace the affordance with a real `<button>`. |
| `manualAumUsd` zod block | Same pattern, different host schema — 152's field goes on the NESTED `addedStrategySchema`, and the fixture must be repopulated (see Mapper Note 1). |

---

## Mapper Notes (findings from reading the analogs, beyond RESEARCH)

1. **The 151-06 fixture trap is confirmed live.** `scenario-state.test.ts:1059` really is
   `addedStrategies: []`, and `:1099` even asserts `expect(r.value.addedStrategies).toEqual([])`.
   A copy-paste for `isOwn` is provably vacuous. The 152 fixture needs a populated array
   AND its own assertion path (`parsed.data.addedStrategies[0].isOwn`).

2. **`browseOnAdd` captures the LAST-RENDERED drawer mount, not both.** The capturing mock
   (`ScenarioComposer.test.tsx:591-598`) overwrites a single module-scoped variable on
   every render, and only ONE `StrategyBrowseDrawer` mounts per branch (empty-state
   `:4066` lives inside the blank-slate return; main-body `:5410` in the composed one).
   So the "all seams carry `isOwn`" test must run twice with **different payloads**
   (`blankSlatePayload()` → Seam A; a booked payload → Seam B) — not twice in one render.
   Also: because the drawer is module-mocked in that file, the composer test can never
   cover `StrategyBrowseDrawer.tsx:333-339`; that fourth site is only reachable from
   `StrategyBrowseDrawer.test.tsx` (T9 pattern).

3. **RESEARCH Open Question 3 resolved — no server-side `.strict()` reader exists.**
   `grep -rn "strict()\|z.strictObject" src/app/api/allocator/scenario/ scenario-state.ts`
   → zero hits. The only other server reader of `addedStrategies` is
   `share/route.ts:199-201`, which is purely structural
   (`!Array.isArray(draftAdded) || draftAdded.length === 0`) and indifferent to new keys.
   The wire add cannot turn into a 400.

4. **Two chip families coexist on this exact row, and the split is documented.**
   `CoverageStateChip.tsx:58` = `rounded-sm … uppercase` (derived state);
   `OwnershipTag.tsx:35` = `rounded-md … text-caption` (persistent fact). The row at
   `:6268-6277` will carry one of each. Picking the wrong family is a silent
   semantics error a reviewer will catch — UI-SPEC pins `rounded-md`.

5. **`data-testid="scenario-constituent-notional"` is already on the target span** — the
   SCEN-04 test can target it directly, and a `queryAllByTestId(...).length` guard
   distinguishes it from `scenario-constituent-usd-unset` (the wrong em-dash, Pitfall 4).

---

## Metadata

**Analog search scope:** `src/app/api/strategies/browse/`, `src/app/(dashboard)/allocations/{lib,components}/`,
`src/components/strategy/`, `src/lib/{utils,visibility}.ts`, `src/app/api/allocator/scenario/`
**Files read this session:** 14 source + 4 test (targeted, non-overlapping ranges)
**Pattern extraction date:** 2026-08-07
**Anchors verified against:** `feat/v1.17-151-aum` @ `115751118c` (ScenarioComposer.tsx = 6,467 lines, matching RESEARCH.md)
