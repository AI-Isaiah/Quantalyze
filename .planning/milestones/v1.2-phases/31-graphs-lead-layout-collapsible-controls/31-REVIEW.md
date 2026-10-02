---
phase: 31-graphs-lead-layout-collapsible-controls
reviewed: 2026-06-23T19:16:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/components/ui/CollapsibleSection.tsx
  - src/components/ui/CollapsibleSection.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/__tests__/phase-31-frozen-spine-guards.test.ts
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
status: issues_found
---

# Phase 31: Code Review Report

**Reviewed:** 2026-06-23T19:16:00Z
**Depth:** standard (per-file + cross-file for the shared-primitive lift)
**Files Reviewed:** 6
**Status:** issues_found

## Summary

The lift is, on the merits the plan claimed, byte-clean: `CollapsibleSection`
moved verbatim into `src/components/ui/` with exactly the three documented
generalizations (event-constant rename, optional `onToggle` replacing the hard
`trackFactsheetEvent` import, comment edits), and `git` recorded it as a rename.
The factsheet repoint preserves behavior exactly — I verified every one of the 6
`onToggle` callbacks fires `factsheet_v2_section_toggle` with a `section` literal
(`"factsheet-perf"`, `"factsheet-dist"`, …) that is byte-identical to the OLD
`<details id>` value the pre-lift primitive read from `id`, so the analytics
payload is unchanged; all 6 `storageKey` strings are untouched; the open-all
event-string value was renamed on BOTH the dispatcher and the listener together,
with zero stray references to the old `"factsheet-v2:open-all"` literal anywhere
in `src`. Hide-don't-unmount holds by construction: `CompositionList` is an
unconditional child of a native `<details>`, and `leverageByRef` (parent
`useState`, L502, only ever written by the initializer and the user handler) and
`scenario.draft.weightOverrides` both live above the collapsible boundary, so
collapse cannot reset them. The LAYOUT-02 regression test is genuinely
non-vacuous — it edits to non-default weight+leverage, asserts the projection
moved off baseline, then proves both inputs AND the projection survive
collapse→expand; it fails against a conditional-mount regression because the
`getElementById` input lookups would return null. tsc is clean; no dangling
imports; the old factsheet file/test are deleted; the frozen engine
(`scenario.ts`/`scenario.test.ts`) is correctly zero-diff and the guard's
baseline resolution is fail-loud and correct.

But the lift introduced a NEW localStorage namespace — `composer-collapse:controls`
— that was never registered with the cross-account sign-out purge, and the
existing leak-guard passed vacuously because its inventory is manually
maintained. That is a cross-account data-leak on shared devices, classified
Critical below. There is also a real false-negative hole in the new
no-conditional-mount guard (it misses the idiomatic parenthesized conditional).

## Critical Issues

### CR-01: New `composer-collapse:controls` localStorage key is unregistered → survives sign-out → cross-account leak on shared devices

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2287` (the `storageKey="composer-collapse:controls"` prop) — root cause spans `src/lib/storage-namespaces.ts:20-30` and `src/components/auth/SignOutButton.test.tsx:124-135`.

**Issue:**
The wrapped `<CollapsibleSection storageKey="composer-collapse:controls">` routes
through `useCrossTabStorage({ key: "composer-collapse:controls", enabled: true })`,
which writes that raw key into `localStorage` on every collapse/expand toggle.

`composer-collapse:` is NOT one of the 9 prefixes registered in
`APP_NAMESPACED_PREFIXES` (`src/lib/storage-namespaces.ts:20-30`:
`quantalyze-`, `quantalyze_`, `allocations.`, `widget_state_`, `discovery_`,
`discovery.`, `admin-compute-`, `factsheet-v2:`, `factsheet-collapse:`). The
`useCrossTabStorage` contract documents this invariant explicitly
(`src/lib/storage/cross-tab.ts:98-99`: *"localStorage key. MUST stay under a
prefix registered in `storage-namespaces.ts` so the sign-out purge still reaches
it."*).

Consequence (the exact failure T-13-02-01 + `purgeAppNamespacedStorage()` exist
to prevent): on a shared device, when an allocator signs out,
`purgeAppNamespacedStorage()` (`storage-namespaces.ts:45-50`) does NOT remove
`composer-collapse:controls` (it starts with no registered prefix). The next
account that signs in inherits the previous user's composer collapse preference.

Why the guard did not catch it: `SignOutButton.test.tsx`'s `KNOWN_APP_KEYS`
inventory (L124-135) is a **manually maintained** list, not a grep of the live
source — its own comment (L121-123) says "Keep this list in sync with grep
results … a missed key here means the purge silently leaks it across user
accounts." Plan 02 added a brand-new namespace but did not update either the
prefix registry or the inventory, so the leak-guard passes vacuously (119 tests
green, leak still present). The `no-raw-localstorage` ESLint rule does not fire
either, because the access is correctly routed through the sanctioned
`useCrossTabStorage` primitive — so nothing automated covers this.

(Note: 31-01-SUMMARY's claim that "the `SignOutButton.test.tsx` purge-key
inventory stays accurate (untouched)" was true for the factsheet repoint, but
Plan 02 invalidated it by introducing the new namespace.)

**Fix:** Register the new namespace AND add it to the manual inventory so the
purge reaches it and the guard stops being vacuous.

```ts
// src/lib/storage-namespaces.ts
export const APP_NAMESPACED_PREFIXES: readonly string[] = [
  "quantalyze-",
  "quantalyze_",
  "allocations.",
  "widget_state_",
  "discovery_",
  "discovery.",
  "admin-compute-",
  "factsheet-v2:",
  "factsheet-collapse:",
  "composer-collapse:", // ADD — ScenarioComposer controls collapse (Phase 31)
] as const;
```

```ts
// src/components/auth/SignOutButton.test.tsx — KNOWN_APP_KEYS
  "factsheet-collapse:{strategyId}:{section}", // CollapsibleSection.tsx (templated, B7c)
  "composer-collapse:controls",                // ScenarioComposer.tsx (Phase 31)
```

(Alternatively, rename the composer key to live under an existing registered
prefix, e.g. `allocations.composer-collapse:controls` — `allocations.` is already
purged — and still add the concrete key to `KNOWN_APP_KEYS`. Registering the new
prefix is cleaner and matches the factsheet precedent.)

## Warnings

### WR-01: The no-conditional-mount guard misses the idiomatic *parenthesized* conditional mount (false-negative hole)

**File:** `src/__tests__/phase-31-frozen-spine-guards.test.ts:248,259`

**Issue:**
The guard forbids `&&\s*<CompositionList` and `[?:]\s*<CompositionList`. Both
regexes require `<CompositionList` to immediately follow the `&&` / `?` / `:`
(after whitespace). But the standard — and Prettier-enforced — way to write a
multi-line conditional JSX mount wraps the element in parentheses:

```jsx
{open && (
  <CompositionList ... />
)}
// or
{open ? (
  <CompositionList ... />
) : null}
```

Verified empirically: against `{open && (\n  <CompositionList />\n)}` and
`{open ? (\n  <CompositionList />\n) : null}`, BOTH regexes return `false` — the
guard would pass while the controls are conditionally mounted and the exact
unmount-on-collapse / wipe-edits regression (Pitfall 5) is live. Because Prettier
auto-wraps multi-line JSX in parens, a future refactor that converts the wrap to
a conditional is *more* likely to produce the parenthesized form the guard misses
than the inline form it catches. This is the guard's stated whole reason to
exist, so the hole matters even though the behavioral test would still catch it
at runtime (the durable structural gate is precisely the thing that runs when no
one reruns the behavioral test).

**Fix:** Allow an optional open-paren (and a JSX fragment) between the operator
and `<CompositionList`:

```ts
// Catches `&& <CompositionList`, `&& (<CompositionList`, `&& (\n <CompositionList`, `&& (<>...<CompositionList`
const CONDITIONAL_AND = /&&\s*\(?\s*(?:<>\s*)?<CompositionList\b/;
const CONDITIONAL_TERNARY = /[?:]\s*\(?\s*(?:<>\s*)?<CompositionList\b/;
```

Add a self-test asserting the regex matches the parenthesized form (so the gate's
own non-vacuity is pinned), or — more robustly — assert positively that
`<CompositionList` sits directly inside `<CollapsibleSection>` with no JS
expression boundary (`{`) introduced between the opening `>` of the section and
`<CompositionList` other than the JSX comment, rather than enumerating forbidden
forms.

### WR-02: Wrap-present assertion keys off the FIRST `<CollapsibleSection`, fragile if a second usage is ever added above it

**File:** `src/__tests__/phase-31-frozen-spine-guards.test.ts:223-234`

**Issue:**
`openIdx = COMPOSER_SRC.indexOf("<CollapsibleSection")` and the
`closeBetween` check both anchor on the FIRST `<CollapsibleSection` occurrence in
the file. Today there is exactly one usage so the check is correct. But if a
future edit adds a second `CollapsibleSection` ABOVE the CompositionList wrap (or
the wrapping one is moved below another), the assertion inspects the wrong
section instance and can pass or fail spuriously without reflecting whether
CompositionList is actually enclosed. The `WRAP_RE` non-greedy
`/<CollapsibleSection\b[\s\S]*?<CompositionList\b/` similarly matches the nearest
preceding section, not necessarily the enclosing one. Low likelihood, but it
weakens the "durable structural gate" claim.

**Fix:** Anchor on the LAST `<CollapsibleSection` before the FIRST
`<CompositionList` (`COMPOSER_SRC.lastIndexOf("<CollapsibleSection", compIdx)`),
or scope the search window to the immediate parent by matching the
`id="composer-composition-controls"` section specifically:

```ts
const compIdx = COMPOSER_SRC.indexOf("<CompositionList");
const openIdx = COMPOSER_SRC.lastIndexOf("<CollapsibleSection", compIdx);
expect(openIdx).toBeGreaterThanOrEqual(0);
const closeBetween = COMPOSER_SRC.slice(openIdx, compIdx).includes("</CollapsibleSection>");
expect(closeBetween).toBe(false);
```

## Info

### IN-01: `sentryArea: "factsheet.section"` now misattributes composer storage errors

**File:** `src/components/ui/CollapsibleSection.tsx:87`

**Issue:**
The lifted primitive keeps `sentryArea: "factsheet.section"` hardcoded. Now that
the composer reuses it, any `composer-collapse:controls` read/write failure (e.g.
Safari private mode) is reported to Sentry under `factsheet.section`, a slightly
misleading area tag for an allocations-surface error. The 31-01-SUMMARY documents
this as a deliberate out-of-scope decision ("changing it alters Sentry
attribution"). Acceptable for this phase; flagged so it is not forgotten when the
composer eventually wants its own attribution.

**Fix (optional, future):** Expose `sentryArea` as an optional prop defaulting to
`"factsheet.section"`, and pass `sentryArea="composer.section"` from the composer.

### IN-02: Stale `factsheet-collapse:` example in the now-generalized primitive's docstring

**File:** `src/components/ui/CollapsibleSection.tsx:62`

**Issue:**
The lifted (intentionally factsheet-agnostic) primitive still carries the comment
*"The key is the raw `storageKey` prop unchanged (e.g. `factsheet-collapse:${id}:perf`)."*
The whole point of the lift was to decouple from the factsheet; the example now
reads as residual coupling. Cosmetic only.

**Fix:** Generalize the example, e.g. `(e.g. `factsheet-collapse:…` or
`composer-collapse:…`)`, or drop the concrete example.

### IN-03: `defaultOpen={true}` is redundant (default already `true`); composer `<h2>` uses a different size tier than the adjacent graph-panel `<h2>`s

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2286` (and 2264-2284 comment block)

**Issue:**
Two minor notes, neither a bug:
(a) `defaultOpen={true}` is explicit while the prop already defaults to `true`
(`CollapsibleSection.tsx:37`). Harmless; mildly redundant. The 26-line comment
block above the wrap is also unusually long for a surgical wrap, though it
faithfully documents the Pitfall-5 invariant.
(b) The lifted summary renders `<h2 class="text-sm font-semibold uppercase
tracking-wider …">` (14px uppercase), whereas the composer's adjacent graph
panels use `<h2 class="text-base font-semibold …">` (16px, non-uppercase,
DESIGN.md H3 tier). The surface now mixes two `<h2>` visual treatments. This is
an explicitly locked 31-CONTEXT decision ("reuse the existing summary styling so
the composer's collapse control reads consistently with the factsheet") and falls
within DESIGN.md's `uppercase tracking-wider` sub-heading convention, so it is NOT
a deviation — recorded for visibility only. Keyboard a11y is fine (native
`<details>`/`<summary>` toggles on Enter/Space, `focus-visible:outline-accent`,
`min-h-[44px]` carry over).

**Fix:** Optionally drop `={true}` (use bare `defaultOpen`) to match the factsheet
call sites. No change needed for (b).

---

_Reviewed: 2026-06-23T19:16:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
