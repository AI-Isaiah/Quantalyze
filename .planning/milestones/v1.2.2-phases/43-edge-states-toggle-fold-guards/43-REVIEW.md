---
phase: 43-edge-states-toggle-fold-guards
reviewed: 2026-06-26T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/globals.css
  - src/app/factsheet/[id]/v2/FactsheetBody.scenario-mode.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - e2e/composer-axe.spec.ts
  - src/app/factsheet/[id]/v2/MandatePanels.scenario.test.tsx
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: findings
---

# Phase 43: Code Review Report

**Reviewed:** 2026-06-26
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 43 is the milestone-closing fold-and-guards phase for v1.2.2. The production
surface is small (a toggle fold into a factsheet-shaped `CollapsibleSection`, three
token swaps, a leverage-chip guard, a footer scenarioMode gate, and two `@theme`
light-mode tokens); the bulk of the diff is the four permanent guard tests.

**All HARD phase invariants hold:**
- `src/lib/scenario.ts` is **zero-diff** (verified — FROZEN spine intact).
- `ScenarioComposer.tsx` contains the `FactsheetBody` literal **zero times** (static guard holds).
- The footer `scenarioMode` gate is **additive, default false** — the GUARD-02 innerHTML-equality test pins default ≡ `scenarioMode={false}`, and the disclaimer `<p>` stays unconditional.
- The `--color-text` / `--color-text-2` fix is a genuine `@theme inline` token formalization, **NOT** a repoint of any live factsheet class string (every `border-text` / `text-text-2` class string is unchanged — byte-identity at the DOM level is preserved; the change is CSS-variable resolution only).
- Token swaps (`bg-warning-bg`, `border-warning-border`, `bg-accent/10`, `text-accent`) use real DESIGN.md tokens that exist in `globals.css` (`:78/:79/:42`) with dark-mode overrides.
- The GUARD-04 spy is keyspace-scoped (`/^factsheet-v2|^factsheet-collapse/` + `?range/?cmp/?dark`) and **does not** false-flag the legitimate `composer-collapse:controls` key — there is even a dedicated predicate-scoping unit assertion.

The guard tests are well-constructed and falsifiable (positive controls, documented
mutation-checks, non-vacuous interaction paths verified against the real persist
gate at `factsheet-context.tsx:321`).

Two genuine defects: a leverage-chip guard that over-suppresses **deleveraged**
(<1×) constituents (contradicts its own stated intent and is unguarded by the
new test), and a GUARD-03 axe anchor that hard-requires the degenerate empty
copy, contradicting the spec's own "real OR honest-empty" idiom.

## Warnings

### WR-01: Leverage chip suppressed for deleveraged (<1×) constituents, not just the "1×" noise case

**File:** `src/app/factsheet/[id]/v2/MandatePanels.tsx:194`
**Issue:**
The new guard is `{c.leverage > 1 && (…)}`. The code comment (`:191-193`) and the
phase decision (`43-CONTEXT.md:42`, `43-RESEARCH.md` P42-W) both state the intent
precisely: *"Suppress at exactly 1×; >1× still renders as a meaningful mandate
signal."* But `> 1` also suppresses every **fractional / deleveraged** value
`0 < leverage < 1`.

Fractional leverage is a real, reachable value in this domain:
- `MandatePayloadConstituent.leverage` is `ScenarioState.leverage[id] ?? 1.0` (`src/lib/factsheet/types.ts:196-197`), and the R4 leverage what-if lets a user set per-strategy leverage in the composer.
- `src/lib/diversification.test.ts:419` exercises `leverage: { A: 1.5, B: 0.5, C: 4 }` — `0.5` is a valid engine input.
- `formatLeverage` (`MandatePanels.tsx:228-231`) is explicitly written to render fractions ("1.5"), so the renderer expects sub-integer values.

A deleveraged 0.5× constituent is a **meaningful** mandate signal (the constituent
is run at half exposure) — exactly the kind of honest disclosure this phase is
meant to preserve. `> 1` silently hides it, which is the same "dishonest empty"
failure mode the guards phase exists to prevent.

The new test (`MandatePanels.scenario.test.tsx`, the GUARD-01 case) only covers
`1×` (suppressed) and `3×` (rendered) — both pass under either `> 1` or the
correct `!== 1`, so the bug is unguarded.

**Fix:**
```tsx
{/* Suppress ONLY the 1× noise case; <1× (deleveraged) and >1× are both
    meaningful mandate signals. */}
{c.leverage !== 1 && (
  <div className="flex flex-wrap gap-1">
    <Chip>{formatLeverage(c.leverage)}×</Chip>
  </div>
)}
```
And extend the GUARD-01 mandate test with a fractional case that pins the intent:
```tsx
{ name: "Deleveraged", strategy_types: ["carry"], markets: ["BTC"], leverage: 0.5 },
// …
expect(getByText("0.5×")).toBeTruthy(); // <1× is a meaningful signal, not noise
```
(If product genuinely wants <1× hidden too, then fix the comment + CONTEXT to say
"suppress at ≤1×" — but the current code and its stated intent disagree, which is
the defect.)

### WR-02: GUARD-03 axe Scan-2 hard-gates on the Diversification honest-empty copy, contradicting the spec's own "real OR honest-empty" idiom

**File:** `e2e/composer-axe.spec.ts:194-199`
**Issue:**
The added gate asserts the literal degenerate copy is visible:
```ts
await expect(
  page.locator("#factsheet-diversification")
      .getByText("Add a second strategy to see diversification"),
).toBeVisible({ timeout: 10_000 });
```
This **requires** the Diversification section to be in its `n<2` honest-empty
state. But the in-file comment block immediately above (`:181-191`) explicitly
prescribes the opposite discipline for these sections: *"gate on the section
being PRESENT — real body OR honest-empty copy — never require a non-degenerate
body."* The code does the stricter thing the comment warns against.

Today the seed (`Browse → add first → close drawer`) yields a single-strategy
blend, so the empty copy is present and the gate passes. But this couples the
permanent CI axe gate to a degenerate seed shape: if the seed is ever changed to
add ≥2 strategies (a real Diversification body, no empty heading), this gate
fails with a misleading "element not visible" error that has nothing to do with
an accessibility regression — a brittle false-red on the milestone's permanent
gate.

Note: the comment for anchor (c) also claims a Mandate honest-empty anchor is
asserted ("The Mandate honest-empty copy is the stable single-seed anchor"), but
no Mandate/Peer/OwnBookDelta locator is actually asserted in the code — only the
Diversification copy. The comment over-describes the gate.

**Fix:** Gate on section *presence* (heading), not the degenerate body, matching
the documented idiom:
```ts
// Section present whether its body is real (n>=2) or honest-empty (n<2).
const diversification = page.locator("#factsheet-diversification");
await diversification.scrollIntoViewIfNeeded();
await expect(diversification).toBeVisible({ timeout: 10_000 });
await expect(diversification.getByRole("heading", { name: /Diversification/i }))
  .toBeVisible({ timeout: 10_000 });
```
(The existing `#factsheet-main` and `#factsheet-diversification` visibility gates
already defend against a hollow false-green mount; they don't need the body to be
degenerate.) Either drop the empty-copy assertion or trim the (c) comment to match
what is actually asserted.

## Info

### IN-01: `--color-text` light-mode token changes the live factsheet route's divider color (intended, but appearance-changing and uncovered by GUARD-02)

**File:** `src/app/globals.css:39`
**Issue:**
Adding `--color-text: #CBD5E1` makes Tailwind v4 emit a `.border-text { border-color:#CBD5E1 }`
utility in light mode where none existed before (the token was undefined →
`.border-text` had no emitted rule → `border-color` fell through to `currentColor`,
near-black). `border-text` is used on the **live** `/factsheet/[id]/v2` route in
many places (`FactsheetView.tsx:420,980`, `AnalyticalPanels.tsx`, `MetricsColumn.tsx`,
`StressWindowsPanel.tsx`, `BatchDPanels.tsx`, `MandatePanels.tsx`, `loading.tsx`),
so every header/footer/table divider on the real route changes from near-black to
slate-300.

This is the **intended** P40-NIT fix and it satisfies the phase invariant (token
formalization, not a class repoint). Flagging as Info, not a violation, because:
(a) the invariant explicitly permits `@theme` token formalization; (b) GUARD-02
asserts innerHTML equality, which is class-string-based and correctly unaffected.
Worth recording that the **visible** appearance of the live route did change and
GUARD-02 cannot catch it (innerHTML ≠ computed CSS) — if a visual-regression
guard ever existed for the real route, it would need a baseline refresh. No action
required beyond awareness.

**Fix:** None required. Optionally add a one-line note to the milestone summary
that the factsheet divider tone shifted (near-black → slate-300) by design.

### IN-02: Indentation of the folded Data-sources `{dataSourceKeys.map(...)}` block was not re-indented after wrapping

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2363-2401`
**Issue:**
The Data-sources `role="group"` div gained two new wrapping ancestors (`<Card>` →
`<CollapsibleSection>`), but the inner `{dataSourceKeys.map(...)}` body retained
its prior indentation depth, leaving the JSX block under-indented relative to its
new parents. Purely cosmetic; Prettier/lint will normalize on next format. No
behavior impact.

**Fix:** Run the project formatter over the block (or accept on next touch).

### IN-03: GUARD-04 falsifiability rests on an author-noted manual mutation, not an in-suite negative control

**File:** `src/app/factsheet/[id]/v2/FactsheetBody.guard04-no-bleed.test.tsx:36-41`
**Issue:**
The test documents that flipping `persist={false}` → `true` makes both spies trip
("Verified by momentary mutation during authoring"), which is the right reasoning,
but that negative control is not encoded as a test — so a future refactor that
silently neutralizes the interaction path (e.g. the "Dark mode" label changes, or
the write effect stops keying off `darkMode`) could make the no-write assertions
pass vacuously. The third `it` (predicate scoping) and the live persist gate at
`factsheet-context.tsx:321` partially mitigate this, and the interaction path is
real today (`darkMode` is a write-effect dependency at `:350`).

**Fix (optional hardening):** add a sibling `it` that mounts with `persist={true}`
and asserts the SAME Dark-mode interaction DOES produce a `factsheet-v2:` write /
`?dark=1` URL — making the gate self-falsifying in-suite rather than by author note.

---

_Reviewed: 2026-06-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
