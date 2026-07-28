---
phase: 14a
plan: 04
subsystem: routing
tags: [single-strategy-v2, app-router, error-boundary, kpi-01, kpi-22]
requirements: [KPI-01, KPI-22]
dependency_graph:
  requires:
    - "src/lib/queries.ts:getStrategyDetailV2 (Plan 14a-02)"
    - "src/components/strategy-v2/StrategyV2Shell.tsx (Plan 14a-03)"
  provides:
    - "Public route /strategy/[id]/v2 (server-rendered Next.js App Router page)"
    - "Client error boundary for the /strategy/[id]/v2 route segment"
  affects:
    - "Plan 14a-05 (component test suite — exercises this route via Playwright in 14b)"
    - "Phase 14b (lazy panel bodies render inside StrategyV2Shell mounted by this route)"
tech_stack:
  added: []
  patterns:
    - "Next.js 16 async params contract (params: Promise<{ id: string }> + await params)"
    - "Next.js 16.2 unstable_retry() error-boundary recovery (per RESEARCH Pitfall 3)"
    - "usePathname-derived v1 fallback href (no params prop on error.tsx — Assumption A6)"
key_files:
  created:
    - "src/app/strategy/[id]/v2/page.tsx (31 LOC, server component)"
    - "src/app/strategy/[id]/v2/error.tsx (51 LOC, client component)"
  modified: []
decisions:
  - "Used Next.js 16.2 unstable_retry() per RESEARCH Pitfall 3 — typecheck + build exit 0; no fallback to reset() needed"
  - "v1 fallback href derived via usePathname() + .endsWith('/v2') strip per Assumption A6 — error.tsx receives no params prop"
  - "Substituted bg-card -> bg-surface (and inline shadow -> shadow-card) per Plan 14a-03 SUMMARY token canonicalization decision; --color-card is undefined in globals.css (Rule 1 fix)"
  - "Route registered in App Router build output as /strategy/[id]/v2 (dynamic — 'ƒ' marker)"
metrics:
  duration_minutes: 3
  completed: 2026-04-29
  tasks_total: 2
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  lines_added: 82
  commits:
    - "ad52f4d feat(14a-04): add /strategy/[id]/v2 server route + generateMetadata"
    - "be1863a feat(14a-04): add /strategy/[id]/v2 client error boundary"
---

# Phase 14a Plan 04: Route Wiring Summary

**One-liner:** Ships the publicly-accessible `/strategy/[id]/v2` route — async server component (`page.tsx`) calling `getStrategyDetailV2`, mounting `<StrategyV2Shell>`, plus a Next.js 16.2 client error boundary (`error.tsx`) using `unstable_retry()` and a `usePathname`-derived v1 fallback link.

## Tasks

| # | Task | Files | Commit | Status |
| - | ---- | ----- | ------ | ------ |
| 1 | Create `src/app/strategy/[id]/v2/page.tsx` (async server component + generateMetadata) | `src/app/strategy/[id]/v2/page.tsx` (+31 LOC) | `ad52f4d` | Done |
| 2 | Create `src/app/strategy/[id]/v2/error.tsx` (Client Component error boundary) | `src/app/strategy/[id]/v2/error.tsx` (+51 LOC) | `be1863a` | Done |

## Final Shape

### `page.tsx` — server component

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStrategyDetailV2 } from "@/lib/queries";
import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell";

export async function generateMetadata({
  params,
}: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) return { title: "Strategy Not Found | Quantalyze" };
  return {
    title: `${result.strategy.name} — v2 | Quantalyze`,
    description: `${result.strategy.name} — Verified quantitative strategy on Quantalyze.`,
  };
}

export default async function StrategyV2Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) notFound();
  return <StrategyV2Shell detail={result} />;
}
```

### `error.tsx` — Client Component

- `"use client";` at top of file (verified — Next.js error.md:21 contract)
- props `{ error: Error & { digest?: string }, unstable_retry: () => void }` — exact shape from `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:329` (`v16.2.0 — unstable_retry prop added`)
- `useEffect(() => console.error(error), [error])` log path
- Heading: verbatim `We couldn&apos;t load this strategy` (UI-SPEC §7)
- Body: verbatim `Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet.`
- Primary CTA: `<button>` "Reload strategy" with `onClick={() => unstable_retry()}` (verb+noun per UI-SPEC §7)
- Secondary CTA: `<Link href={v1Href}>` "Open v1 factsheet" — `v1Href` derived from `usePathname()` by stripping the trailing `/v2` (Assumption A6 — error.tsx does NOT receive `params`)

## Verification (Plan §verification)

| Gate | Command | Result |
| ---- | ------- | ------ |
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Production build | `npm run build` | exit 0 |
| Route registered | `grep "strategy/\[id\]/v2" build.log` | `└ ƒ /strategy/[id]/v2` (dynamic, line 146 of build output) |
| 2 new files exist | `ls src/app/strategy/[id]/v2/` | `error.tsx page.tsx` |

## Acceptance Criteria — Task 1 (page.tsx)

| Check | Result |
| ----- | ------ |
| File exists | ✅ `src/app/strategy/[id]/v2/page.tsx` |
| `export default async function` count | 1 ✅ |
| `export async function generateMetadata` count | 1 ✅ |
| `import { notFound } from "next/navigation"` | 1 ✅ |
| `import { getStrategyDetailV2 } from "@/lib/queries"` | 1 ✅ |
| `import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell"` | 1 ✅ |
| `params: Promise<{ id: string }>` count | 2 ✅ (generateMetadata + page default) |
| `const { id } = await params` count | 2 ✅ |
| `v2 \| Quantalyze` literal in title | ✅ (1 match) |
| `Strategy Not Found \| Quantalyze` literal | ✅ (1 match) |
| `notFound()` call | ✅ (1 match) |
| `npm run build` exits 0 | ✅ |
| Route registered in build output | ✅ `ƒ /strategy/[id]/v2` |

## Acceptance Criteria — Task 2 (error.tsx)

| Check | Result |
| ----- | ------ |
| File exists | ✅ `src/app/strategy/[id]/v2/error.tsx` |
| First non-blank line `"use client";` | ✅ |
| `unstable_retry: () => void` prop type annotation | ✅ (1 match) |
| `onClick={() => unstable_retry()}` | ✅ (1 match) |
| `Reload strategy` text | ✅ (2 matches — button text + body copy) |
| `Open v1 factsheet` text | ✅ (1 match) |
| `We couldn&apos;t load this strategy` heading | ✅ (1 match) |
| Body verbatim copy | ✅ (1 match) |
| `import { usePathname } from "next/navigation"` | ✅ (1 match) |
| `console.error(error)` | ✅ (1 match) |
| Forbidden weights `font-medium\|font-light\|font-bold` | 0 ✅ |
| Forbidden sizes `text-[11px]\|text-[13px]\|text-[14px]\|text-sm\|text-xl\|text-2xl` | 0 ✅ |
| `npm run build` exits 0 | ✅ |

## Success Criteria (Plan §success_criteria)

1. ✅ `page.tsx` mounts `<StrategyV2Shell>` for published strategies (via `getStrategyDetailV2`); calls `notFound()` for non-published / missing strategies.
2. ✅ `generateMetadata` returns documented title shape — `"{name} — v2 | Quantalyze"` on success, `"Strategy Not Found | Quantalyze"` on null.
3. ✅ `error.tsx` renders verbatim UI-SPEC §7 copy; primary CTA invokes `unstable_retry()`; secondary CTA links to `/strategy/{id}` (v1 fallback derived via `usePathname()`).
4. ✅ `npm run build` exits 0; new route appears in build output as `ƒ /strategy/[id]/v2` (dynamic route, line 146).

## unstable_retry vs reset — confirmed unstable_retry

Per RESEARCH Pitfall 3, the implementation uses `unstable_retry()`. TypeScript compilation (`npx tsc --noEmit`) and `npm run build` both exit 0 — no type-system issues with the `unstable_retry` prop. Next.js 16.2 docs (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:329`) confirm `v16.2.0 — unstable_retry prop added`. No fallback to `reset()` was required.

## Build Output Confirmation

```
├ ƒ /strategy/[id]
└ ƒ /strategy/[id]/v2
```

Route is registered as a dynamic (`ƒ`) route per `next build` output. The error boundary file does not appear as a separate entry — Next.js wraps the route segment internally (per error.md:96 "wraps `loading.js`, `not-found.js`, `page.js`, and nested `layout.js` files in a React error boundary").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `bg-card` token does not exist in this project**

- **Found during:** Task 2 drafting — confirmed by grepping `globals.css` for `--color-card` (zero matches) and checking the canonicalization precedent in Plan 14a-03 SUMMARY (decisions: "Project token bg-card is NOT defined in globals.css. Substituted bg-surface").
- **Issue:** Plan 14a-04 skeleton (lines 240, 253, 259) uses `bg-card`, which silently produces no background under Tailwind v4 because `--color-card` is undefined.
- **Fix:** Substituted `bg-card` → `bg-surface` (3 occurrences: card body, button, link) and the inline `shadow-[0_1px_3px_rgba(0,0,0,0.04)]` → `shadow-card` (the centralized `--shadow-card` token has the identical value `0 1px 3px rgba(0,0,0,0.04)` per `src/app/globals.css:76`).
- **Why:** Matches the canonicalization decision logged in Plan 14a-03 SUMMARY commit `bf95fa5` and the project-wide pattern in `Card.tsx` / `MetricCard.tsx` / `CardShell.tsx` / `LazyPanelPlaceholder.tsx`. Same visual outcome (white card with 4% opacity 1px shadow), centralized token usage.
- **Files modified:** `src/app/strategy/[id]/v2/error.tsx` only.
- **Commit:** `be1863a` (Task 2 commit; substitution applied before commit).

## Authentication Gates

None — the route is publicly accessible (matches v1 `getPublicStrategyDetail` visibility gate via `getStrategyDetailV2`'s `.eq("status", "published")` predicate). No external services, no API keys, no user auth required.

## Threat Model Compliance

All three threats from Plan §threat_model are honored:

| Threat | Disposition | Implementation |
| ------ | ----------- | -------------- |
| T-14a-04-01 (Information disclosure via error.tsx) | mitigate | `console.error(error)` runs only in the client environment; rendered UI shows only the static UI-SPEC §7 copy. `error.digest` is available on the prop but not rendered (per error.md:106-115, production scrubs `error.message` automatically). |
| T-14a-04-02 (Strategy existence inference via 404 vs 200) | accept | Same as v1 baseline — `getStrategyDetailV2` honors `status='published'`; non-published strategies return `null` → `notFound()` (404). No new disclosure beyond v1. |
| T-14a-04-03 (params.id manipulation) | mitigate | `getStrategyDetailV2` uses `.eq("id", id)` parameter-binding via Supabase JS client; no SQL injection surface. `single()` returns `null` on 0 rows → `notFound()`. |

No new threat-model surface introduced; no `threat_flags` to report.

## Self-Check: PASSED

- ✅ FOUND: src/app/strategy/[id]/v2/page.tsx
- ✅ FOUND: src/app/strategy/[id]/v2/error.tsx
- ✅ FOUND: ad52f4d (Task 1 commit on main)
- ✅ FOUND: be1863a (Task 2 commit on main)
- ✅ Branch is `main` (verified post-commit; no checkout/pull/rebase ops performed)
- ✅ Type-scale grep contract holds for error.tsx (zero font-medium/light/bold; zero text-sm/xl/2xl/[11px]/[13px]/[14px])
- ✅ `npx tsc --noEmit` exit 0
- ✅ `npm run build` exit 0; route `/strategy/[id]/v2` registered in App Router output
- ✅ No stub patterns introduced (the route consumes real `StrategyV2Detail` from `getStrategyDetailV2` and renders the existing `<StrategyV2Shell>`; the lazy panel placeholders are owned by Plan 14a-03 and explicitly tracked in that plan's CONTEXT — not stubs in this plan's scope)
- ✅ No deletions in either commit (verified via `git diff --diff-filter=D --name-only HEAD~2 HEAD`)
