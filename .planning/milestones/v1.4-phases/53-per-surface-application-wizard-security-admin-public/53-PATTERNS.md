# Phase 53: Per-surface Application — Wizard + /security + Admin + Public - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** ~30 (route-state files for admin + sub-pages + portfolios tree + wizard; 1 `DashboardChrome.isWide` edit + its test; ~5 `@container` table migrations; per-surface type migration across 4 surface globs; the wizard review-step + inline-validation across 6 step files + 4 enum/step-array edit sites; clip fixes; 1 eslint ratchet edit)
**Analogs found:** 29 / 30 (1 has no direct analog — the admin-reflow proof gap, see No Analog Found)

> This is a CONFORMANCE phase + ONE additive wizard UX upgrade — the direct continuation of Phase 52. Every new artifact has a proven in-repo analog (`52-PATTERNS.md` is the precedent map). Treat every "Analog" below as the exact file the new work copies its idiom from, with the line refs verified on disk 2026-06-29. The value is *applying* the analog per-surface with discipline (no clip relocation, no frozen-island/state-machine disturbance, no token drift), plus the wizard recap/inline-validation — not building anything new.

> **Naming correction (Rule 7 — verified source wins over upstream prose):** RESEARCH/UI-SPEC refer to `wizardErrors.ts` `human_message` / `buildEnvelope()`. The on-disk truth is: the file is `src/lib/wizardErrors.ts`, the per-code copy type `WizardErrorCopy` (`src/lib/wizardErrors.ts:79-89`) has fields **`title` / `cause` / `fix[]` / `docsHref` / `actions`** (there is no `human_message`); the `role="alert"` summary renders `envelope.cause` + `envelope.fix` (`src/components/error/ErrorEnvelope.tsx:113,122-125`). Use these real field names for the inline-validation copy — NEVER invent a new string.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/admin/loading.tsx` (NEW, shared) | route (loading) | request-response (Suspense fallback) | `src/app/factsheet/[id]/v2/loading.tsx` + `discovery/[slug]/loading.tsx` | exact |
| `src/app/(dashboard)/admin/error.tsx` (NEW, shared) | route (error boundary) | event-driven (boundary catch) | `src/app/(dashboard)/error.tsx` | exact |
| `admin/{csv-status,compute-jobs,deletion-requests,intros,usage,partner-import,partner-roi,for-quants-leads,users,match}/…` per-page `loading.tsx`/`error.tsx` (NEW, only where layout differs) | route (loading/error) | request-response | same admin shared pair / factsheet bar | exact |
| `src/app/(dashboard)/portfolios/loading.tsx` (NEW) | route (loading) | request-response | `strategies/loading.tsx` (cards grid) + `factsheet/[id]/v2/loading.tsx` | exact |
| `src/app/(dashboard)/portfolios/error.tsx` (NEW) | route (error boundary) | event-driven | `src/app/(dashboard)/error.tsx` | exact |
| `portfolios/[id]/{,manage,documents}/loading.tsx` + `error.tsx` (NEW ×3 pairs) | route (loading/error) | request-response | factsheet bar (detail) / `(dashboard)/error.tsx` | exact |
| `src/app/(dashboard)/strategies/error.tsx` (NEW) | route (error boundary) | event-driven | `src/app/(dashboard)/error.tsx` | exact |
| `strategies/new/wizard/loading.tsx` (NEW) | route (loading) | request-response | `strategies/loading.tsx` (form/stepper shape) | role-match |
| `strategies/new/wizard/error.tsx` (NEW) | route (error boundary) | event-driven | `src/app/strategy/[id]/error.tsx` | exact |
| `…/{loading,error}.test.tsx` (NEW, per new route file) | test | — | `src/app/strategy/[id]/v2/error.test.tsx` | exact |
| `src/components/layout/DashboardChrome.tsx:72` (MOD: add `admin\|portfolios` to `isWide`) | component (shell) | transform (layout) | self — line 72 regex | exact |
| `src/components/layout/DashboardChrome.test.tsx:232-236` (MOD: flip the /portfolios not-widened assertion + add admin) | test | — | self — existing `isWide` test block | exact |
| `src/components/admin/{ComputeJobsTable,MatchQueueIndex,AllocatorMatchQueue}.tsx` (MOD: `@container` host on existing `ResponsiveTable`) | component | CRUD (table) | `StrategyTable.tsx:516-520` + `ResponsiveTable.tsx:55-63` | exact |
| portfolio cards / holdings lists + wizard step panels + broker-selector grid + marketing body cards (MOD: `@container`) | component | transform (layout) | `StrategyTable.tsx` `@container` + `@max-3xl:hidden` | role-match |
| `WizardClient.tsx:57-69` (MOD: extend `STEP_INDEX` + add review render branch + one transition) | component (state machine) | event-driven | self — existing `STEP_INDEX` + `step ===` render branches | exact |
| `WizardChrome.tsx:13-33` (MOD: add review to `DEFAULT_STEPS`/`CSV_STEPS`) | component (chrome) | render | self — existing step arrays | exact |
| `src/lib/wizard/localStorage.ts:59-72` + `:302-311` (MOD: add `review`/`csv_review` to `WizardStepKey` + `validSteps`) | utility (storage) | transform | self — existing union + validation array | exact |
| wizard step fields (MOD: wrap in `Field`, surface `wizardErrors` inline) | component | request-response (form) | `src/components/ui/Field.tsx` | exact |
| wizard ReviewStep (NEW component) | component | render (read-only recap) | `WizardChrome.tsx` measure + hairline-divider idiom; data from `WizardClient` state | role-match |
| named clip fixes (portfolios/page.tsx:44/48, admin/MatchQueueIndex:289, etc.) | component | render | `ScopedBanner.tsx` wrap / StrategyTable `title=` cell | exact |
| per-surface type migration (security 27, admin 15 + components/admin 66, wizard 22, marketing 39, components/portfolio 28) | — | — | the `--text-*` spine in `globals.css` (Phase 49) | exact |
| `eslint.config.mjs:107-151` (MOD: add migrated Phase-53 globs to the `error` ratchet block) | config | — | self — Phase-52 strangler block | exact |

---

## Pattern Assignments

### admin (shared) + portfolios + portfolio-detail + wizard `loading.tsx` (route, loading)

**Analog:** `src/app/factsheet/[id]/v2/loading.tsx` (the match-layout fidelity bar) — supplemented by the leaner `src/app/(dashboard)/strategies/loading.tsx` (cards-grid + `Skeleton`/`SkeletonCard` idiom) and `discovery/[slug]/loading.tsx` for table-row loops.

**Two idioms in the repo, both sanctioned:**
1. **Structural-grid bar** (factsheet): a page-shell `<article>` at the route max-width, single `animate-pulse` on the shell, hand-rolled `bg-border rounded-sm` divs for layout-fidelity dimensions, closed by an `sr-only role="status" aria-live="polite"` liveness hint (`factsheet/[id]/v2/loading.tsx:8-9,28-38,63-66`).
2. **Primitive-assembled** (strategies): assemble from `Skeleton`/`SkeletonCard` — the newer, preferred idiom for non-structural placeholders.

`strategies/loading.tsx` (the closest in-tree NEW-file precedent — copy this for portfolios list):
```tsx
import { Skeleton, SkeletonCard } from "@/components/ui/Skeleton";
export default function StrategiesLoading() {
  return (
    <div>
      <div className="flex justify-between mb-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    </div>
  );
}
```

`Skeleton` primitive (assemble from this; reduced-motion-safe via `globals.css`) (`src/components/ui/Skeleton.tsx:7-14,29-36`):
```tsx
export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`animate-pulse rounded-md bg-border/60 ${className}`} aria-hidden />;
}
export function SkeletonCard() {
  return <Card><Skeleton className="h-5 w-1/3 mb-4" /><SkeletonText lines={3} /></Card>;
}
```

The factsheet bar's liveness hint — **REQUIRED on every new `loading.tsx`** (UI-SPEC Copywriting: "Loading {surface}.") (`factsheet/[id]/v2/loading.tsx:63-66`):
```tsx
<p className="sr-only" role="status" aria-live="polite">Loading factsheet — computing analytics.</p>
```

**Per-surface dominant anchor** (UI-SPEC §State Coverage "Dominant visual anchor"):
- **admin shared `loading.tsx`** → the data table is the anchor: a page-title `Skeleton` + a `border border-border bg-surface` block with a header rule + N `Skeleton` rows at the table's real column count. Page-shell width matches the fluid-fill measure (`max-w-[1920px]` is set by `DashboardChrome`, so the loading shell should NOT re-impose `max-w-7xl`). Generic Skeleton is acceptable for admin internal pages (53-CONTEXT Claude's-discretion).
- **portfolios `loading.tsx`** → a responsive grid of `SkeletonCard` (name line + description + metric row) matching the live card grid.
- **portfolio detail (`[id]`/`manage`)** → portfolio-name header + headline-metric block (factsheet header idiom), holdings/strategy rows secondary below.
- **wizard `loading.tsx`** → `WizardChrome`-shaped: a stepper-rail placeholder (4 cells) + a first-step field-block placeholder so the wizard does not flash blank before `WizardClient` hydrates. Match the `WizardChrome` `mx-auto max-w-3xl px-6 py-10` measure (`WizardChrome.tsx:105`).

**Pitfall guard (RESEARCH Pitfall 5):** keep server-fetch in `page.tsx`, never a layout. VERIFIED: `portfolios/page.tsx:24` (`await getUserPortfolios()`) and `admin/page.tsx` fetch in the page body → the skeleton WILL render. Do NOT move auth/fetch into `(dashboard)/layout.tsx`.

---

### admin (shared) + portfolios (+detail) + strategies + wizard `error.tsx` (route, error boundary)

**Analog:** `src/app/(dashboard)/error.tsx` (the canonical shape) and `src/app/strategy/[id]/error.tsx` (the subtree-level precedent — copy its doc comment rationale verbatim for the wizard subtree).

**Imports + signature + digest-only body** (`src/app/strategy/[id]/error.tsx:1-5,20-55`):
```tsx
"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

export default function StrategyError({
  error,
  unstable_retry,                         // Next 16.2.0 — NOT `reset` (RESEARCH State of the Art)
}: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => { console.error("[strategy-error]", error); }, [error]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="mt-4 font-display text-2xl text-text-primary">Something went wrong</h1>
        <p className="mt-2 text-sm text-text-muted">
          This section encountered an error. You can retry or navigate to another page.
        </p>
        {error.digest && (                                {/* digest ONLY — never error.message (RSC info-leak, ASVS V7 / T-52-15) */}
          <p className="mt-1 font-mono text-xs text-text-muted/60">Error ID: {error.digest}</p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <Link href="/discovery/crypto-sma"><Button variant="ghost">Go to Discovery</Button></Link>
        </div>
      </div>
    </div>
  );
}
```

Copy strings verbatim from UI-SPEC Copywriting Contract ("Something went wrong" + body + `Error ID: {digest}`). Change the `console.error` tag per surface (`[admin-error]`, `[portfolios-error]`, `[wizard-error]`). For the wizard `error.tsx`, mirror `strategy/[id]/error.tsx`'s doc comment: this covers the server-prep gap BEFORE `WizardClient` mounts and must NOT surface the thrown message (Information Disclosure). The fallback `Link` target can stay `/discovery/crypto-sma` or point to the surface's own list (e.g. `/strategies` for the wizard).

---

### `…/{loading,error}.test.tsx` (test — STATE-05 proof + coverage gate)

**Analog:** `src/app/strategy/[id]/v2/error.test.tsx` (the exact precedent). The coverage ratchet (lines 82 / stmts 80 / fns 74 / branches 72, `vitest.config.ts`) is a BLOCKING CI gate — each new route file MUST carry a render/behavior test in the SAME change.

Assertion shape (from the 52-PATTERNS extraction; the canonical idiom):
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
it("renders heading + body copy + CTA", () => {
  const err = Object.assign(new Error("boom"), { digest: "d-1" });
  render(<AdminError error={err} unstable_retry={vi.fn()} />);
  expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeTruthy();
});
it("retry button invokes unstable_retry()", () => {
  const retry = vi.fn();
  render(<AdminError error={new Error("boom")} unstable_retry={retry} />);
  fireEvent.click(screen.getByRole("button", { name: /try again/i }));
  expect(retry).toHaveBeenCalledTimes(1);
});
```
For `loading.tsx`: smoke-render + assert the `role="status"` liveness node and the dominant-anchor structure exist (skeleton has no props/logic, so this is sufficient for the gate).

---

### `DashboardChrome.isWide` — add admin + portfolios (the ONE fluid-fill wiring change)

**Analog:** the file itself. `isWide` is a regex allow-list selecting `max-w-[1920px]` vs `max-w-7xl` on the content container.

**CURRENT** (`src/components/layout/DashboardChrome.tsx:72`):
```tsx
const isWide = /^\/(allocations|compare|discovery)(\/|$)/.test(pathname);
```
**PHASE 53 →** add `admin|portfolios` (data/table surfaces only — NOT wizard/auth/marketing, which stay narrow):
```tsx
const isWide = /^\/(allocations|compare|discovery|admin|portfolios)(\/|$)/.test(pathname);
```
The container then takes `max-w-[1920px]` via the existing ternary (`DashboardChrome.tsx:166-170`). Update the comment at lines 64-71 (it currently states the Phase-53 surfaces "keep `max-w-7xl`").

**CAUTION (leave unchanged):** the `isFullBleed` carve-out `/^\/admin\/match\/[^/]+\/?$/` (`DashboardChrome.tsx:61-62`, the match-detail page) takes a DIFFERENT branch (no centered container at all) — it is unaffected by `isWide`; leave it.

**MUST also update the test** — `DashboardChrome.test.tsx:232-236` currently asserts `/portfolios` stays at `max-w-7xl`:
```tsx
it("keeps a non-allocator dashboard route (/portfolios) at the default max-w-7xl", () => {
  const container = contentContainerFor("/portfolios");
  expect(container).toHaveClass("max-w-7xl");           // FLIP → toHaveClass("max-w-[1920px]")
  expect(container).not.toHaveClass("max-w-[1920px]");  // FLIP → .not.toHaveClass("max-w-7xl")
});
```
Flip this for portfolios, add a parallel admin assertion, and pick a NEW non-widened route for the negative case (e.g. `/strategies` — wizard/strategies stay narrow). Keep the `/discoveryx` regex-boundary test (`DashboardChrome.test.tsx:238-243`) green.

---

### `@container` table migrations: admin data tables + portfolio cards/holdings + wizard panels + marketing cards (component, transform)

**Analog:** `src/components/strategy/StrategyTable.tsx` (the working `@container` precedent) + its host `src/components/ResponsiveTable.tsx`. **The admin tables already use `ResponsiveTable`** (`ComputeJobsTable.tsx`, `MatchQueueIndex.tsx`, `AllocatorMatchQueue.tsx`, `MatchEvalDashboard.tsx` all import it) — so the migration is adding `className="@container"` to the EXISTING host, then `@max-*:`/`@min-*:` variants on the columns. No new wrapper.

**The host-container idiom** (`StrategyTable.tsx:516-520`):
```tsx
<ResponsiveTable label="Strategies" className="@container" scrollRef={scrollContainerRef}>
  <table className="w-full text-body">
```

**`ResponsiveTable` merges `@container` onto the scroll region** (`ResponsiveTable.tsx:55-63`):
```tsx
const accessibleName = hint ?? (label ? `${label}: ${DEFAULT_HINT}` : DEFAULT_HINT);
return (
  <div ref={scrollRef}
       className={["overflow-x-auto", className].filter(Boolean).join(" ")}  // "@container" lands here
       role="region" aria-label={accessibleName} tabIndex={0}>
    {children}
  </div>
);
```

**Priority-collapse on columns + `tabular-nums` preservation** (`StrategyTable.tsx:559,577-583`):
```tsx
<th className={`… ${col.align === "right" ? "text-right" : "text-left"} ${col.collapse ? "@max-3xl:hidden" : ""}`}>
…
<th className="… @max-3xl:hidden">Return</th>
{/* details disclosure column reappears at narrow widths: */}
<th className="… @3xl:hidden"><span className="sr-only">Details</span></th>
```

**Apply-rules:**
- Mark the varying-width region with plain `className="@container"` (inline-size). NEVER `@container-size` — it establishes block-size containment and collapses panel height to 0 (RESEARCH Pitfall 1).
- **⚠️ Tailwind v4 CRITICAL (#551 regression):** the `@container` HOST and its `@`-variants MUST be parent/child — **never the same element.** `ResponsiveTable` is the parent host; the `<th>`/`<td>` children carry the variants — this structure already satisfies the rule. A same-element host never matches and freezes the grid 1-wide; jsdom class-string tests FALSE-PASS it — verify with a parent/child structural assertion, not just a class-string check.
- Collapse columns from the RIGHT in priority order; relocate the real value into a `<details>` — never a fabricated em-dash/zero (no-invented-data LOCKED).
- Every columnar number stays Geist Mono `tabular-nums` across every `@max-*` breakpoint (RESEARCH Pitfall 2). Add a per-new-container test asserting alignment holds.
- **Ultra-wide tuning (RESEARCH Pitfall 4):** at the wider 1920 measure, un-collapse `@container` columns at `@min-*` so a 2-column table is not stranded in whitespace ("data density > card density").

---

### Wizard inline per-field validation surfacing (APPLY-02 — additive; `Field` does the a11y)

**Analog:** `src/components/ui/Field.tsx` — it ALREADY wires `aria-invalid` + `aria-describedby` (in `[hint, error]` order, `undefined` when neither). Field does NOT validate (ASVS V5) — the consumer supplies the `error` string.

**The a11y wiring Field performs for you** (`src/components/ui/Field.tsx:60-92`):
```tsx
const id = providedId ?? useId();
const errorId = error ? `${id}-error` : undefined;
const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
const wiredControl = cloneElement(control, {
  id,
  "aria-describedby": describedBy,
  "aria-invalid": error ? "true" : undefined,
  ...control.props,                                  // consumer's own id/aria win
});
…
{error && <p id={errorId} className="text-caption text-negative">{error}</p>}   // --text-caption text-negative (UI-SPEC Color)
```

**Usage (surface the EXISTING `wizardErrors.ts` copy on blur + submit):**
```tsx
<Field label="Strategy codename" error={blurred && fieldError ? fieldError : undefined}>
  <Input value={name} onBlur={() => setBlurred(true)} onChange={…} />
</Field>
```
- **Copy source:** `src/lib/wizardErrors.ts` — the `WizardErrorCopy.cause` (the why) + `fix[]` (the steps) for that field's code (`src/lib/wizardErrors.ts:79-89`, e.g. `KEY_HAS_TRADING_PERMS` at `:99-110`). There is no `human_message` field — use `cause`/`title`. NEVER invent a new inline string.
- **Per-field messages are NOT `role="alert"`** — only the summary banner is (RESEARCH Pitfall 6; double-announce trap). The summary stays `WizardErrorEnvelope`, which renders `envelope.cause` + `envelope.fix` under `role="alert"` (`src/components/error/ErrorEnvelope.tsx:113,122-125`).
- On submit-with-errors: focus the FIRST invalid field (DESIGN.md step-transition focus rule).
- **Migration scope:** `CsvUploadStep.tsx` wires `aria-invalid` but NOT `aria-describedby` (the exact gap `Field` closes — Field's doc comment names it). `MetadataStep` already uses `Input`/`Select` — bring the full set onto `Field`. The migration swaps `<input>`→`<Input>`/`<Field>`; it MUST NOT change any `onChange`/`onBlur`/`onComplete` wiring (RESEARCH Pitfall 3).

---

### Wizard review step (APPLY-02 — read-only recap, the only `WizardStepKey` change)

**Analog:** no single component; assemble from the `WizardChrome` measure + hairline-divider editorial idiom; the recap DATA comes from existing `WizardClient` state (`metadataDraft`/`csvMetadataDraft` + `syncSnapshot`/`csvPreview`). The review step is inserted as a NEW `step ===` render branch + ONE transition into it; `SubmitStep`/`CsvSubmitStep` still do the POST.

**The 4 verified edit sites (A3 in RESEARCH, confirmed on disk):**

1. **`WizardClient.tsx:57-69`** — extend `STEP_INDEX`. CURRENT:
```tsx
const STEP_INDEX: Record<WizardStepKey, 1 | 2 | 3 | 4> = {
  connect_key: 1, sync_preview: 2, metadata: 3, submit: 4,
  csv_upload: 1, csv_preview: 2, csv_metadata: 3, csv_submit: 4,
};
```
→ widen the value union to `1|2|3|4|5`; API becomes `…metadata:3, review:4, submit:5`; CSV `…csv_metadata:3, csv_review:4, csv_submit:5`. Add the `step === "review"` / `step === "csv_review"` render branches (mirror the existing `step === "submit"` branch at `WizardClient.tsx:662-674`) and a `setStep("review")` transition where `handleMetadataComplete` currently sets `submit` (`WizardClient.tsx:412-423`) — i.e. metadata now advances to review; review's "Continue" advances to submit.

2. **`WizardChrome.tsx:13-33`** — add the review entry to `DEFAULT_STEPS` (before `submit`) and `CSV_STEPS` (before `csv_submit`):
```tsx
const DEFAULT_STEPS = [
  { key: "connect_key", label: "Connect key", number: "01" },
  { key: "sync_preview", label: "Verify data", number: "02" },
  { key: "metadata", label: "Strategy profile", number: "03" },
  { key: "review", label: "Review & confirm", number: "04" },   // NEW
  { key: "submit", label: "Submit", number: "05" },             // number bumps 04→05
];
```
The `gridColsClass` ternary at `WizardChrome.tsx:87-88` only handles 3-vs-4 — it must become `grid-cols-1 sm:grid-cols-5` for the 5-step arrays (verify the stepper still reflows single-column < 640px, the WIZARD-01 reflow at `:81-88`).

3. **`src/lib/wizard/localStorage.ts:59-72`** — add `review`/`csv_review` to the `WizardStepKey` union.

4. **`src/lib/wizard/localStorage.ts:302-311`** — add `review`/`csv_review` to the `validSteps` array (else a stored `review` pointer fails validation and safe-degrades to the SSR default — verify with `localStorage.test.ts`). **No data migration:** existing drafts never carry `review`; an unknown step already falls back via the `validSteps.includes` guard at `:312-314` (RESEARCH Runtime State Inventory).

**Recap content** (UI-SPEC §Wizard UX Upgrade 3 — entered values ONLY, no fabrication): API branch from `metadataDraft` + `syncSnapshot` (name, description, categoryId, strategyTypes, subtypes, markets, supportedExchanges, leverageRange, aum, maxCapacity); CSV branch from `csvPreview` (fmt, row_count, date_range — the REAL parsed numbers). Each row: `--text-caption` label + `--text-body` value (numbers Geist Mono `tabular-nums`). Each section "Edit" → `setStep(owningStep)` (the existing seam; autosave preserves data). Layout: narrow form measure, `border-t border-border` hairline dividers, no card-on-card, no `role="alert"`. Final CTA: existing verb — "Create strategy" (API) / "Submit strategy" (CSV).

**FROZEN (RESEARCH Pitfall 3):** the transition functions (`handleConnectSuccess`/`handleSyncComplete`/`handleMetadataComplete`/`handleSubmitSuccess` + the CSV `onContinue`/`onComplete` chain, `WizardClient.tsx:383-444,699-831`), `saveWizardState`/`loadWizardState` semantics, and the `finalize-wizard`/`csv-finalize` POST body shape stay identical. **Pin FIRST:** `WizardClient.test.tsx`, `src/lib/wizard/localStorage.test.ts`, `src/app/api/strategies/finalize-wizard/route.test.ts` — they must stay green (the behavioral guard; no new git-delta guard, since Phase 53 deliberately edits `WizardClient`).

---

### Truncation / no-clip fixes (component, render — TYPE-02)

**Two analogs:** (a) WRAP — `src/components/ui/ScopedBanner.tsx:29-35` (`break-words` + `min-w-0`, no `truncate`); (b) single-line + `title=` — the StrategyTable dense-cell idiom (`<td className="truncate" title={fullText}>`).

**Named accidental-clip sites in scope** (audit SoT: `.planning/audits/truncation-audit.md`; UI-SPEC §Truncation; verified samples):

| Site | Treatment | Analog |
|------|-----------|--------|
| `portfolios/page.tsx:44` (`<h3 … truncate>` name) + `:48` (`line-clamp-2` desc) | WRAP (`break-words min-w-0`) — card heading, not tabular | ScopedBanner wrap |
| `portfolios/[id]/manage/page.tsx:69` (strategy name) | WRAP or `title=` | ScopedBanner / `title=` |
| `admin/MatchQueueIndex.tsx:289` (`mandate_archetype`, `max-w-[260px]`) | single-line + `title=` (dense table) | StrategyTable `title=` cell |
| `admin/AllocatorMatchQueue.tsx:560/701` (reason / founder note) | `title=` (dense table) | StrategyTable `title=` cell |
| `admin/partner-pilot/[partner_tag]/page.tsx:166/170/209/212` (allocator name / **email mid-clip unrecoverable** / staged name / status·manager) | `title=` or wrap — email MUST recover | `title=` |
| `DocumentList.tsx:68` (document title) | WRAP or `title=` | ScopedBanner / `title=` |
| `PortfolioOptimizer.tsx:78` (suggestion name; `:81` strategy_id legitimate — leave) | WRAP | ScopedBanner wrap |
| `portfolio/MorningBriefing.tsx:33` (`line-clamp-3` narrative) | wrap or add expand | — |
| marketplace/deck/event/replacement names (`StrategyGrid.tsx:63`, `DeckCard.tsx:13/17`, `AllocationTimeline.tsx:30/34`, `ReplacementCard.tsx:116`, etc. — only if the route resolves in scope) | `title=` / 2-line clamp / wrap per audit | per audit |

**Hard rule — never relocate a clip:** do NOT introduce a NEW `truncate`/`line-clamp` without a `title`/tooltip when re-typing onto fluid tiers. **Do NOT strip the LEGITIMATE clips' recovery affordance:** `ComputeJobsTable.tsx:240/261` + `admin/compute-jobs/page.tsx:135` carry `title=`; the `:125` 8-char ID slice and `PortfolioOptimizer.tsx:81` raw strategy_id are intentional (UI-SPEC "Legitimate clips").

---

### Per-surface type migration (raw `text-[Npx]` → `--text-*` tiers) + eslint ratchet

**Analog:** the named fluid `--text-*` tiers in `globals.css` (Phase 49 spine) — never raw `text-[Npx]`/`text-sm`. Per-surface raw-px census (verified on disk 2026-06-29):

| Surface glob | files-with-px | total `text-[Npx]` sites |
|--------------|---------------|--------------------------|
| `src/app/(marketing)/security` | 1 | 27 |
| `src/app/(dashboard)/portfolios` (page tree) | 0 | 0 |
| `src/app/(dashboard)/admin` (pages) | 8 | 15 |
| `src/app/(dashboard)/strategies/new` (wizard, 9 files) | 9 | 22 |
| `src/app/(auth)` | 0 | 0 |
| `src/components/admin` | 13 | 66 |
| `src/components/portfolio` | 18 | 28 |
| `src/app/(marketing)` (all bodies) | 7 | 39 |

**Note (A2):** `portfolios/**` page tree is already 0 raw-px, but `components/portfolio/**` (28) carries the debt — the portfolios eslint glob can only flip to `error` once `components/portfolio/**` is also clean (migrate together, or add the components glob). `(auth)/**` is 0 raw-px → conform primitives/fluid-type only where present (A4).

**eslint ratchet edit** — extend the Phase-52 strangler block. **Analog:** the existing `error` block (`eslint.config.mjs:107-151`) which lists grep-clean Phase-52 globs/files; the repo-wide level stays `warn` (`eslint.config.mjs:82`), and the comment at `:104-106` already names the Phase-53 surfaces (`portfolios/security/admin/wizard`) as the next strangler targets. After a surface's migration greps clean, ADD its glob to the `files:` array:
```js
{
  files: [
    /* …existing Phase-52 globs… */
    "src/app/(marketing)/security/**",
    "src/app/(dashboard)/portfolios/**",        // + "src/components/portfolio/**"
    "src/app/(dashboard)/admin/**",             // + "src/components/admin/**"
    "src/app/(dashboard)/strategies/new/**",
  ],
  rules: { "quantalyze/no-raw-font-px": "error" },
}
```
Chart globs stay `off` (`eslint.config.mjs:155-159`). Per-category tier budget: data/admin/portfolios ≤ 4 tiers (`--text-h3`/`body`/`small`/`caption`); form/wizard/auth (`page-title`/`h3`/`body`/`caption`); prose/marketing (`page-title`/`h2`/`body`/`caption` — `--text-h2` is marketing-ONLY).

---

## Shared Patterns

### Route-error boundary signature (apply to: every new `error.tsx`)
**Source:** `src/app/strategy/[id]/error.tsx:1-26` / `src/app/(dashboard)/error.tsx`. `"use client"`; prop is `unstable_retry` (Next 16.2.0, NOT `reset`); `error: Error & { digest?: string }`. Surface `digest` ONLY, never `error.message` (ASVS V7 / RSC info-leak). `console.error` with a per-surface tag in `useEffect`.

### Skeleton primitives + liveness (apply to: every new `loading.tsx`)
**Source:** `src/components/ui/Skeleton.tsx:7-36` (`Skeleton`/`SkeletonText`/`SkeletonCard`, reduced-motion-safe). Assemble from these; reserve the factsheet bar's structural grid only for layout-fidelity dimensions. Close every `loading.tsx` with the `sr-only role="status" aria-live="polite"` liveness hint (`factsheet/[id]/v2/loading.tsx:63-66`). A single `animate-pulse` on the RSC shell wrapper is the sanctioned idiom — the anti-pattern targets bespoke per-element pulse divs, not the shell.

### Honest empty/degenerate state (apply to: every admin/portfolios degenerate branch — STATE-05)
**Source:** `src/components/ui/EmptyStateCard.tsx:23-30` — neutral muted card, NO `role="alert"`, NO red/warning. `{ heading, body }` props. Empty ≠ error.
```tsx
export function EmptyStateCard({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
      <div className="font-semibold text-text-secondary">{heading}</div>
      <div className="mt-1 text-[11px]">{body}</div>
    </div>
  );
}
```
EXTEND existing tested degenerate branches (admin "no compute jobs"/"no deletion requests"/"no intros"; portfolios "no portfolios yet"/"no strategies"/"no documents") — never render fabricated zeros/demo numbers/count-ups (no-invented-data LOCKED). Errors route through `ErrorEnvelope`/route `error.tsx`, NOT `EmptyStateCard`. (Note: `EmptyStateCard` itself carries a `text-[11px]` at `:27` — if the portfolios/admin glob flips to `error`, this shared primitive must migrate too or be excluded.)

### `@container` host idiom (apply to: every TYPE-04 migration)
**Source:** `StrategyTable.tsx:516-520` + `ResponsiveTable.tsx:55-63`. Plain `className="@container"` (inline-size) on the containment region (the `ResponsiveTable` host); `@max-*:`/`@min-*:`/`@3xl:hidden` variants on CHILDREN; `tabular-nums` on every columnar number. Never `@container-size`; never same-element host.

### Field a11y wrapper (apply to: every wizard form field)
**Source:** `src/components/ui/Field.tsx:60-92`. Wraps a control; wires `aria-invalid`+`aria-describedby` from a consumer-supplied `error` string. Field does NOT validate — pass the `wizardErrors.ts` `cause`/`title` string. Per-field message is `--text-caption text-negative`, NOT `role="alert"`.

### Wizard error copy (apply to: inline validation + the summary envelope)
**Source:** `src/lib/wizardErrors.ts` — `WizardErrorCopy { title, cause, fix[], docsHref, actions }` (`:79-89`), keyed by `WizardErrorCode` (`:10-`). The `role="alert"` summary (`WizardErrorEnvelope` → `ErrorEnvelope`) renders `envelope.cause`+`envelope.fix` (`src/components/error/ErrorEnvelope.tsx:113,122-125`). NEVER a new string.

### Access-control gate preservation (apply to: every page-shell edit — ASVS V4)
**Source:** `portfolios/page.tsx:22` (`if (!user) redirect("/login")`), admin pages' `await isAdminUser()` redirect. A restyle/width-raise MUST NOT remove a `redirect("/login")` or admin gate. `title={fullText}` recovery applies only to data already rendered — never pull an un-gated field into a `title`. `proxy.ts` `PUBLIC_ROUTES` + the P51 route-contract guard stay green (the guard scans only `page.tsx` → new `loading.tsx`/`error.tsx` need no manifest entry; /security/demo/for-quants/legal are already in `PUBLIC_ROUTES`).

---

## No Analog Found

| Item | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Admin ultra-wide responsiveness proof | test (e2e) | — | Admin routes are deliberately EXCLUDED from `reflow-sweep-authed.spec.ts:26-28` — `seedTestAllocator` stamps `role='allocator'` and `admin/page.tsx` redirects non-admins to `/discovery/crypto-sma`, so an admin row would measure a redirected page (false-green; RESEARCH Pitfall 7). NOT a missing pattern — prove admin `@container`/`tabular-nums` responsiveness via component-level Vitest (parent/child structural assertion + alignment-across-`@max-*`) + the per-surface DESIGN.md-conformance check. An admin e2e reflow row needs an ADMIN seed (role=both + is_admin), a Phase-54 hermetic-seed concern. Document the gap. |

The wizard review step has no single-file analog (it is assembled from `WizardChrome`'s measure/divider idiom + existing `WizardClient` state) but every constituent pattern (step-array extension, render-branch, `setStep` transition, `WizardStepKey`/`validSteps` edit) has an exact in-file precedent — see Pattern Assignments. Everything else has a direct in-repo analog.

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/{admin,portfolios,strategies}`, `src/app/(dashboard)/strategies/new/wizard` (+ `steps/`), `src/lib/wizard/localStorage.ts`, `src/lib/wizardErrors.ts`, `src/app/factsheet/[id]/v2/loading.tsx`, `src/app/(dashboard)/error.tsx`, `src/app/strategy/[id]/error.tsx` + `v2/error.test.tsx`, `src/components/layout/DashboardChrome.tsx` + `.test.tsx`, `src/components/strategy/StrategyTable.tsx`, `src/components/ResponsiveTable.tsx`, `src/components/ui/{Field,Skeleton,EmptyStateCard}.tsx`, `src/components/admin/*`, `src/components/error/ErrorEnvelope.tsx`, `eslint.config.mjs`, `.planning/phases/52-…/52-PATTERNS.md`, `.planning/audits/truncation-audit.md`.
**Files scanned:** ~30 read in full or targeted; route-state existence + raw-px census verified by grep across the in-scope inventory; cross-referenced against 52-PATTERNS + RESEARCH/UI-SPEC analog lists.
**Pattern extraction date:** 2026-06-29
