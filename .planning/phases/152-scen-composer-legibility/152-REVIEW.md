---
phase: 152-scen-composer-legibility
reviewed: 2026-08-07T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/app/api/strategies/browse/route.ts
  - src/app/api/strategies/browse/route.test.ts
  - src/app/(dashboard)/allocations/lib/scenario-state.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx
  - src/app/(dashboard)/allocations/components/YoursChip.tsx
  - e2e/composer-axe.spec.ts
findings:
  critical: 1
  warning: 6
  info: 7
  total: 14
status: issues_found
---

# Phase 152: Code Review Report

**Reviewed:** 2026-08-07
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Seven files reviewed at standard depth, with the four special-attention areas traced
end-to-end.

**What holds up under attack:**

- **The pseudonymization fence.** `route.ts:264` computes `isOwnRow` from
  `withAllocatorAuth`'s session id only; `created_at` / `status` are emitted through
  single-key conditional spreads gated on that same bit (`:305-310`), so the key is
  ABSENT (not `undefined`) on third-party rows. The two-arm allow-list test
  (`route.test.ts:740-867`) makes the "just append the key to the shared list" fix
  structurally impossible. I could not construct a request that pulls another owner's
  `created_at` or `status`: no request param reaches the predicate (T3b pins it), the
  client is user-scoped (RLS backstop), and `user_id` itself is read-only.
- **isOwn spoofing (server→client direction).** `isOwn` is computed server-side and
  reused from the same variable that un-redacts the name, so the chip and the label
  can never disagree. Client-persisted `isOwn` (via `scenarioDraftSchema`) is a
  self-spoof only — I traced `scenario-share/[token]` and `ScenarioComparePanel` and
  neither renders `YoursChip`, so a tampered draft cannot show a false ownership claim
  to a *different* viewer.
- **zod tolerance.** `isOwn: z.boolean().nullish()` on the nested `addedStrategySchema`
  with no refine. A pre-152 blob (key absent) and a `JSON.stringify`-produced `null`
  both safeParse clean in every decode branch, so no draft-deleting reset. Correct.
- **The stopPropagation choreography.** I enumerated every descendant of the added
  `<li>`: the include/exclude switch (`:6465`), the name button (`:6489`), the control
  cluster wrapper (`:6540`) and the detail panel (`:6672`) all stop. `TrustTierLabel`,
  `YoursChip`, `CoverageStateChip`, `renderSolveState` and the two series-state notes
  are non-interactive `<span>`/`<p>` only. No missed site.

**Where it fails:** the *honest-copy* invariant — the one thing this phase names as its
reason to exist. `NOTIONAL_UNAVAILABLE_NOTE` is presented to the user as a diagnosis and
is wrong in the most common em-dash state (CR-01), and the same em-dash on the per-key
row half of the same list was left un-explained (WR-06). Secondary: the `isOwn` chip has
no refresh path onto an existing draft row despite a comment claiming one (WR-01), and
the detail panel's two headline figures are structurally unreachable on the dominant
code path (WR-02).

---

## Critical Issues

### CR-01: The notional em-dash note names a cause that is usually not the cause

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:5918-5919`
(the string), `:6602-6615` (the `title` + `sr-only` render), `:5877-5888` (the deriver)

**Issue:**
`notionalText` returns `"—"` on **three** independent conditions:

```ts
const notionalText = (ref: string): string => {
  const share = blendShareByRef[ref];
  if (
    totalBookEquity == null ||          // (a) no live book equity
    typeof share !== "number" ||        // (b) ref absent from the blend-share map
    !Number.isFinite(share)             // (c) degenerate share
  ) {
    return "—";
  }
  ...
```

SCEN-04 attaches a single explanatory sentence to that em-dash, in both a `title` and a
screen-reader-visible `sr-only` span:

```ts
const NOTIONAL_UNAVAILABLE_NOTE =
  "Notional needs live book equity — not derivable in this scenario";
```

That sentence is true only for branch (a). Branch (b) is reached whenever the row is
**not in the selected engine set**, because `blendShareByRef` is built exclusively over
selected units and bails to `{}` when the selected weight sum is `<= 0`
(`:2842-2855`). The file states this itself at `:6232-6234`: *"an excluded row is absent
from that map"*.

Reachable states that render the **wrong** sentence to an allocator who *does* have live
book equity:

1. **Any row toggled OFF.** Exclusion is a first-class gesture with its own
   `manually-excluded` chip. The row then reads: notional `—`, hover/SR text "Notional
   needs live book equity". The allocator has book equity. The named blocker is false,
   and the implied remedy (get a live book) cannot make the cell derivable — re-including
   the row can.
2. **Every added row at once**, when the selected weight sum is `0` (`if (sum <= 0)
   return out;` at `:2848`) — e.g. all constituents excluded, or an all-zero weight
   vector. Every row simultaneously blames missing equity.
3. Any added row not present in `engineSet.strategies` for this render.

This is the exact defect class the SCEN-04 comment at `:5908-5917` says the phase exists
to remove ("Telling a book-less allocator to 'set portfolio AUM' would name a remedy that
cannot make this cell derivable — a dishonest remedy"). The replacement sentence commits
the same error against a different cause, and it is *louder* than the old one because it
is duplicated into `sr-only` text that a screen reader announces unconditionally.

**Fix:** branch the note on the actual cause rather than pinning one string. Derive the
cause beside `nText` (both are already computed once per row at `:6420-6421`):

```ts
// beside `const nText = notionalText(a.id);`
const notionalCause: "equity" | "not-in-blend" | null =
  nText !== "—"
    ? null
    : totalBookEquity == null
      ? "equity"
      : "not-in-blend";

const NOTIONAL_NOTE_BY_CAUSE = {
  equity:
    "Notional needs live book equity — not derivable in this scenario",
  "not-in-blend":
    "Notional needs a blend share — this row is not in the blend",
} as const;
```

then render `notionalCause ? NOTIONAL_NOTE_BY_CAUSE[notionalCause] : <derived sentence>`
in both the `title` and the `sr-only` span. Add a regression test that toggles an added
row OFF **with a non-null `totalBookEquity`** and asserts the note does NOT mention book
equity — the current suite cannot fail on this because it never pins the excluded-row
branch against a live book.

---

## Warnings

### WR-01: `isOwn` can never reach a strategy already in the draft — the comment claims a refresh path that does not exist

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:6524-6527`;
mechanism at `src/app/(dashboard)/allocations/lib/scenario-state.ts:501`

**Issue:** The chip's gating comment states:

> *"Absence is honest; such rows go un-marked until the next browse/add refreshes them."*

There is no such refresh. `addStrategyBrowse` is dedupe-guarded and returns the **same
draft reference** when the id is already present:

```ts
// scenario-state.ts:501
if (draft.addedStrategies.some((s) => s.id === strategy.id)) return draft;
```

`handleAddStrategy` (`:2325-2333`) calls straight into it, so re-adding the strategy from
Browse is a silent no-op that never writes the newly-known `isOwn`. Consequence: any
allocator carrying a pre-152 draft (localStorage or a saved scenario) sees **no** "Yours"
chip on their own strategies, permanently, with no user-reachable remedy short of
removing and re-adding the row (or a reset). The drawer will happily let them click "Add"
again and nothing observable happens.

Either the comment is wrong (fix the comment, and accept that the chip needs a
remove/re-add), or the intent is real and the dedupe branch should reconcile additive
metadata before returning. If you take the second route, do it without churning
`lastEditedAt` (an autosave-only metadata backfill must not look like a user edit and must
not inflate `diffCount`):

```ts
// scenario-state.ts, inside addStrategyBrowse's dedupe branch
const existing = draft.addedStrategies.find((s) => s.id === strategy.id);
if (existing) {
  if (existing.isOwn === strategy.isOwn || strategy.isOwn == null) return draft;
  return {
    ...draft,
    addedStrategies: draft.addedStrategies.map((s) =>
      s.id === strategy.id ? { ...s, isOwn: strategy.isOwn } : s,
    ),
    // deliberately NOT touching lastEditedAt — metadata backfill is not an edit
  };
}
```

### WR-02: the detail panel's CAGR / SHARPE are unreachable for every drawer-added strategy — the dominant path

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2496-2506`
(`addedMetricsByRef`), source at `:2429-2431`, render at `:6693-6727`

**Issue:** `addedStrategyMetadataLookup` sources `cagr` / `sharpe` from **one** place:

```ts
cagr: found?.strategy.strategy_analytics?.cagr ?? null,
sharpe: found?.strategy.strategy_analytics?.sharpe ?? null,
```

`found` is `strategyById.get(a.id)` — a map built only from the allocator's **book**
payload (`:2270`). Unlike `asset_class`, `trust_tier` and `is_composite`, which all carry
a lazily-fetched fallback (`addedAssetClassById`, `addedProvenanceById`), the metrics have
none — and `/api/strategies/[id]/returns` does not serve them (its select is
`"daily_returns, returns_series, computation_status, data_quality_flags"`,
`returns/route.ts:253-255`).

A strategy added from the Browse drawer is, by construction, one the allocator does not
already hold. So for the entire population the SCEN-03 panel exists to serve, `metricsAbsent`
is always `true` and the panel renders the fallback sentence *"Metrics not available in this
view — open the factsheet for full detail."* every single time. The CAGR/SHARPE eyebrows
are dead code on that path; the shipped panel is markets + types + provenance + a link.

This is honest (no fabricated numbers — good) but it is not the feature the plan
describes, and a reader of the code will reasonably assume the figures render. Either
widen `/api/strategies/[id]/returns` to co-serve `cagr, sharpe` from `strategy_analytics`
(same row, same RLS, no new round-trip) and add an `addedMetricsById` lazy fallback
mirroring `addedProvenanceById`, or drop the metric pair and its `formatNumber` import and
keep the note as the panel's honest metrics statement. Do not leave both.

### WR-03: `expandedAddedId` is never cleared on remove — a re-added strategy mounts pre-expanded

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:5860`

**Issue:** `expandedAddedId` is `CompositionList`-local state keyed by strategy id. When
the user expands row X and then removes X via the `×` button, the id is still held. Adding
X back in the same session mounts its row with the detail panel **already open** and
`aria-expanded="true"`, with no user gesture — a state the one-open-at-a-time contract did
not intend and that a screen reader will announce as expanded on first encounter.

**Fix:** clear the id when the row it names leaves the draft. Cheapest correct form,
beside the existing memos in `CompositionList`:

```ts
useEffect(() => {
  if (
    expandedAddedId != null &&
    !draft.addedStrategies.some((a) => a.id === expandedAddedId)
  ) {
    setExpandedAddedId(null);
  }
}, [draft.addedStrategies, expandedAddedId]);
```

### WR-04: `new Date(created_at)` is unguarded — a malformed timestamp renders "Created Invalid Date"

**File:** `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx:694-712`

**Issue:** The gate is `typeof s.created_at === "string"`. The inline comment claims this
*"keeps the pre-152 wire shape rendering NOTHING rather than 'Created Invalid Date'"* —
it does that for an **absent** key, but a present-and-unparseable string flows straight
into `new Date(...).toLocaleDateString(...)` and renders the literal text
`Created Invalid Date`. The first-party route only emits Postgres ISO timestamps, so this
is not reachable today; it becomes reachable the moment a second producer (a fixture, a
cached payload, a future aggregated endpoint) feeds `strategies` into this drawer, and the
comment will make the next reader believe it is already handled.

**Fix:**

```ts
const createdAt =
  typeof s.created_at === "string" ? new Date(s.created_at) : null;
const createdValid = createdAt != null && !Number.isNaN(createdAt.getTime());
// ...gate the line on `createdValid` and format from `createdAt`
```

### WR-05: `AddedStrategy` is declared twice across the seam this phase widened, with divergent `isOwn` types

**Files:** `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx:89-104`
(`isOwn?: boolean`) vs `src/app/(dashboard)/allocations/lib/scenario-state.ts:96-116`
(`isOwn?: boolean | null`)

**Issue:** Two structurally-similar `AddedStrategy` interfaces, same name, different
nullability on the field this phase added. The assignment happens to compile
(`boolean | undefined` is assignable to `boolean | null | undefined`) — which is exactly
why it is a silent drift surface: the direction that does *not* compile
(scenario-state → drawer) is one refactor away, and a future field added to one and not
the other will not error anywhere. The drawer's own comment already has to cross-reference
the other file ("`scenario-state.ts` declares the persisted twin as `z.boolean().nullish()`")
to explain itself, which is the tell.

**Fix:** have the drawer import and re-export the scenario-state type rather than
re-declare it (the drawer already re-exports `AllocatorMandateForFit` this way at `:36`):

```ts
import type { AddedStrategy } from "../lib/scenario-state";
export type { AddedStrategy };
```

Delete the local interface. If the branded `StrategyForBuilderId` on `id` is the blocker,
export a `Pick<>`-based payload type from `scenario-state.ts` and use it on both sides.

### WR-06: the per-key half of the same list still shows an unexplained em-dash — the SCEN-04 fix stopped halfway

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:6284-6291`
(per-key) vs `:6600-6615` (added)

**Issue:** Both row kinds render `data-testid="scenario-constituent-notional"`, both call
the same `notionalText`, and both render `"—"` under the same three conditions. Only the
added row got the explanatory `title` + `sr-only` treatment. The per-key row keeps the
original derived-only sentence *"Notional = equity × blend share × leverage — derived,
informative only…"* on a cell that is showing no number at all — which is the original
SCEN-04 complaint ("what does this mean?") left standing on half the list, immediately
above the rows that now answer it. Per the project's "close the whole class across the
surface" rule this should land in the same change as CR-01's fix, using the same
cause-derived string.

**Fix:** extract the cause-derivation + note selection from CR-01 into one helper next to
`notionalText` and call it from both render sites, so the two halves cannot drift again.

---

## Info

### IN-01: `isOwn` breaks the wire's snake_case convention

**File:** `src/app/api/strategies/browse/route.ts:83`
Every other member of `BrowseStrategyRow` is snake_case (`strategy_types`, `is_example`,
`created_at`) as is `BrowseResponse` (`has_more`). `isOwn` is camelCase. Cosmetic on the
wire, but it means the drawer/composer types cannot be mechanically derived from the row
shape. Not worth a breaking rename now; note it if the contract is ever versioned.

### IN-02: five elements share `data-testid="scenario-added-header-label"`

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:6338-6376`
WEIGHT / USD / MODE / LEV / NOTIONAL all carry the identical testid, so `getByTestId`
throws and Playwright strict mode fails; only `getAllByTestId` works, and no assertion can
name a specific column. Suffix them (`scenario-added-header-weight`, …) if a future test
needs to pin one column.

### IN-03: header labels are ~8px right of the numbers they label

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:6338-6376`
The label spans are `w-20/w-24/w-16 text-right` flush to the column edge; the inputs
underneath are the same widths but carry `px-2`, so their digits sit 8px further left.
The MODE column uses the invisible-sizer idiom and is exact; the other four are not.

### IN-04: stale line citation in the SCEN-04 comment

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:5911`
Cites `:5787-5792` for the em-dash branch; `notionalText` is at `:5877-5888`. (The
drawer's `route.ts:296` citation is accurate.)

### IN-05: the dedup date renders in the viewer's local timezone

**File:** `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx:703-711`
`toLocaleDateString("en-US", …)` on a UTC instant: a strategy created `2026-07-20T02:00Z`
shows "Jul 19, 2026" west of UTC. Harmless for the 15-day-apart disambiguation case it was
built for; would matter if two same-named rows are ever created a day apart.

### IN-06: the detail panel repeats the provenance badge and pushes the row's own state notes below its hairline

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:6683-6697`,
`:6743-6770`
PROVENANCE inside the panel renders the same `TrustTierLabel` already shown in the row
header three lines above. Separately, the panel is emitted *before* the syncing /
no-series notes and `renderSolveState`, so on an expanded syncing row the "First metrics
arrive in ~10–15 min" note appears below the panel's `border-t` hairline and reads as part
of the detail panel rather than as a row-level state note.

### IN-07: row-wide pointer amplification collapses the panel on incidental clicks

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:6446`
The `<li onClick>` fires for any pointer-up in the row outside the four stop-sites —
including a click on the whitespace between badges, and the mouseup that ends a
text-selection drag over the strategy name area. The panel itself is protected
(`:6672`), so this only affects the collapsed→expanded transition; noted because it is the
kind of behavior a /qa browser pass will report as "it opens when I didn't click
anything".

---

_Reviewed: 2026-08-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
