---
phase: 14a
plan: 04
type: execute
wave: 2
depends_on: [14a-02, 14a-03]
files_modified:
  - src/app/strategy/[id]/v2/page.tsx
  - src/app/strategy/[id]/v2/error.tsx
autonomous: true
requirements: [KPI-01, KPI-22]
must_haves:
  truths:
    - "GET /strategy/{id}/v2 (server-rendered) returns 200 with the StrategyV2Shell mounted when {id} is a published strategy"
    - "GET /strategy/{id}/v2 returns 404 (via Next.js notFound()) when the strategy is missing or status !== 'published'"
    - "Async params is awaited per Next.js 16+ contract"
    - "generateMetadata sets <title>='{strategy.name} — v2 | Quantalyze'"
    - "When the page throws, error.tsx renders 'We couldn\\'t load this strategy' heading and 'Reload strategy' verb+noun primary CTA per UI-SPEC §7"
    - "error.tsx primary CTA invokes Next.js 16.2 unstable_retry() (per RESEARCH.md Pitfall 3)"
    - "error.tsx is a Client Component ('use client' top of file)"
    - "error.tsx secondary CTA links to /strategy/{id} (v1 fallback) — strategy id derived from usePathname()"
  artifacts:
    - path: "src/app/strategy/[id]/v2/page.tsx"
      provides: "Public async server component route at /strategy/[id]/v2"
      exports: ["default", "generateMetadata"]
    - path: "src/app/strategy/[id]/v2/error.tsx"
      provides: "Client error boundary for the v2 route segment"
      exports: ["default"]
  key_links:
    - from: "src/app/strategy/[id]/v2/page.tsx"
      to: "src/lib/queries.ts:getStrategyDetailV2"
      via: "import + await + notFound()"
      pattern: "getStrategyDetailV2"
    - from: "src/app/strategy/[id]/v2/page.tsx"
      to: "src/components/strategy-v2/StrategyV2Shell.tsx"
      via: "default export render"
      pattern: "<StrategyV2Shell"
    - from: "src/app/strategy/[id]/v2/error.tsx"
      to: "Next.js error boundary contract"
      via: "default export receives { error, unstable_retry } props per Next 16.2"
      pattern: "unstable_retry"
---

<objective>
Wire the new `/strategy/[id]/v2` route — `page.tsx` (async server component fetching `getStrategyDetailV2`, calling `notFound()` on null, mounting `<StrategyV2Shell>`, exporting `generateMetadata`) and `error.tsx` (Client Component error boundary using Next.js 16.2 `unstable_retry()` per RESEARCH Pitfall 3, with the verb-noun "Reload strategy" CTA + secondary "Open v1 factsheet" link).

Wave 2 — depends on Plan 14A-02 (data layer) AND Plan 14A-03 (StrategyV2Shell + child components must exist).

Purpose: Land the publicly-accessible URL surface. The page is the integration test surface for everything Plans 14A-01..03 produced; once this plan ships, a developer can `npm run dev` and navigate to the route to see the rendered shell.

Output: 2 new files in `src/app/strategy/[id]/v2/`. No `loading.tsx` is shipped — UI-SPEC §5.4 explicitly forbids skeleton/shimmer states; the server component fetch is synchronous and panels 4-7 use the IntersectionObserver placeholder pattern in lieu of route-level loading UI.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-CONTEXT.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-02-PLAN.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-03-PLAN.md
@AGENTS.md
@src/app/strategy/[id]/page.tsx
@node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
@node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md
@node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md

<interfaces>
<!-- Next.js 16.2 page contract (verified node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md): -->
```ts
// params is a Promise (Next 15+ async API)
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ... fetch + render
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  // ... build metadata
}
```

<!-- Next.js 16.2 error.tsx contract (verified node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md):
  - Must be a Client Component ("use client" at top)
  - Receives `{ error: Error & { digest?: string }, unstable_retry: () => void }` props
  - `unstable_retry` was added in v16.2.0 (line 329 of error.md: "v16.2.0 — unstable_retry prop added")
  - `reset()` still exists but docs explicitly say "In most cases, you should use unstable_retry() instead" (line 157)
-->

<!-- After Plan 14A-02: -->
```ts
// src/lib/queries.ts
export async function getStrategyDetailV2(strategyId: string): Promise<StrategyV2Detail | null>;
export interface StrategyV2Detail { strategy, panel1, panel2Headline, panel2Equity, panel3, lazyKeys, history_days }
```

<!-- After Plan 14A-03: -->
```tsx
// src/components/strategy-v2/StrategyV2Shell.tsx
export function StrategyV2Shell({ detail }: { detail: StrategyV2Detail }): JSX.Element;
```

<!-- v1 reference pattern (verified src/app/strategy/[id]/page.tsx exists; mirror its async-server-component shape — generateMetadata + default export with `params: Promise<{id: string}>`): -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: src/app/strategy/[id]/v2/page.tsx — async server component + generateMetadata</name>
  <files>src/app/strategy/[id]/v2/page.tsx</files>
  <read_first>
    - src/app/strategy/[id]/page.tsx (full file — the v1 reference pattern; mirror the async server component + generateMetadata shape exactly. Do NOT copy v1 logic that the v2 page does not need; in particular, `<StrategyNoteCard>` and `<VerifiedBadge>` placement is delegated to `<StrategyV2Shell>`.)
    - node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md (Next.js 16 async params + generateMetadata signature; AGENTS.md mandates re-reading this before code)
    - node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md (return-type contract for `Metadata`)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §7 page chrome ("Strategy Not Found" title fallback + "{name} — v2 | Quantalyze" success title)
    - src/components/strategy-v2/StrategyV2Shell.tsx (post-Plan-14A-03 — confirm prop name is `detail`)
  </read_first>
  <behavior>
    - The page is exported as a `default async function`
    - `params` is typed `Promise<{ id: string }>` and awaited at the top
    - `getStrategyDetailV2(id)` is awaited; on `null` result, `notFound()` is called (which Next.js converts to a 404 response)
    - On a non-null result, `<StrategyV2Shell detail={result} />` is returned
    - `generateMetadata` is exported as an async function with the same `params: Promise<{ id: string }>` signature
    - When `getStrategyDetailV2` returns null in `generateMetadata`, returns `{ title: "Strategy Not Found | Quantalyze" }`
    - On success, returns `{ title: "{strategy.name} — v2 | Quantalyze", description: "{strategy.name} — Verified quantitative strategy on Quantalyze." }`
    - The em-dash in the title is the literal Unicode em-dash U+2014 (matches v1 pattern)
  </behavior>
  <action>
1. Create the parent directory if it doesn't exist: `src/app/strategy/[id]/v2/`. Verify with `ls -d src/app/strategy/\[id\]/`.

2. Create `src/app/strategy/[id]/v2/page.tsx` with this exact content:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStrategyDetailV2 } from "@/lib/queries";
import { StrategyV2Shell } from "@/components/strategy-v2/StrategyV2Shell";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) {
    return { title: "Strategy Not Found | Quantalyze" };
  }
  return {
    title: `${result.strategy.name} — v2 | Quantalyze`,
    description: `${result.strategy.name} — Verified quantitative strategy on Quantalyze.`,
  };
}

export default async function StrategyV2Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getStrategyDetailV2(id);
  if (!result) notFound();
  return <StrategyV2Shell detail={result} />;
}
```

3. Confirm `npm run typecheck` and `npm run build` exit 0. The `npm run build` step also validates that the route is registered in the App Router file convention (Next.js scans `src/app/**/page.tsx` at build time).
  </action>
  <verify>
    <automated>npm run build 2>&amp;1 | grep -E "strategy/\\[id\\]/v2|error" | head -10</automated>
  </verify>
  <acceptance_criteria>
    - File `src/app/strategy/[id]/v2/page.tsx` exists
    - `grep -n "export default async function" src/app/strategy/\\[id\\]/v2/page.tsx` returns 1 match
    - `grep -n "export async function generateMetadata" src/app/strategy/\\[id\\]/v2/page.tsx` returns 1 match
    - `grep -n "import { notFound } from \"next/navigation\"" src/app/strategy/\\[id\\]/v2/page.tsx` returns 1 match
    - `grep -n "import { getStrategyDetailV2 } from \"@/lib/queries\"" src/app/strategy/\\[id\\]/v2/page.tsx` returns 1 match
    - `grep -n "import { StrategyV2Shell } from \"@/components/strategy-v2/StrategyV2Shell\"" src/app/strategy/\\[id\\]/v2/page.tsx` returns 1 match
    - `grep -n "params: Promise<{ id: string }>" src/app/strategy/\\[id\\]/v2/page.tsx` returns 2 matches (generateMetadata + page default)
    - `grep -n "const { id } = await params" src/app/strategy/\\[id\\]/v2/page.tsx` returns 2 matches
    - `grep -nE "v2 \\| Quantalyze" src/app/strategy/\\[id\\]/v2/page.tsx` returns at least 1 match (success title)
    - `grep -n "Strategy Not Found | Quantalyze" src/app/strategy/\\[id\\]/v2/page.tsx` returns 1 match
    - `grep -n "notFound()" src/app/strategy/\\[id\\]/v2/page.tsx` returns at least 1 match
    - `npm run build` exits 0 (no broken imports, route is registered)
    - The build output (in either stdout or `.next/`) includes `/strategy/[id]/v2` as a recognized route
  </acceptance_criteria>
  <done>v2 route file shipped; build clean; route registered in App Router; metadata contract honored.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: src/app/strategy/[id]/v2/error.tsx — Client Component error boundary</name>
  <files>src/app/strategy/[id]/v2/error.tsx</files>
  <read_first>
    - node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md (Next 16.2 contract — `unstable_retry` is the documented preferred recovery API; the `error` and `unstable_retry` props are both required; line 329 confirms `v16.2.0 — unstable_retry prop added`)
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md §7 error-boundary copy (verbatim — heading, body, primary CTA "Reload strategy", secondary CTA "Open v1 factsheet")
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Pitfall 3 (use `unstable_retry` over `reset` per Next 16.2 docs) and Code Examples section "Error boundary with `unstable_retry`"
    - .planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-RESEARCH.md Assumption A6 (derive strategy id via `usePathname()` — error.tsx does NOT receive `params`)
  </read_first>
  <behavior>
    - File begins with the directive `"use client";` (Client Component)
    - Default export is a function named `Error` (or any name; default export is what matters) accepting `{ error: Error & { digest?: string }, unstable_retry: () => void }` props
    - Logs the error to console in a `useEffect` (per Next.js error.md example)
    - Renders verbatim copy:
        - heading "We couldn't load this strategy" (apostrophe = ASCII single quote, JSX-escaped as `&apos;` or rendered with `{"'"}`)
        - body "Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet."
        - primary `<button>` "Reload strategy" with `onClick={() => unstable_retry()}`
        - secondary `<Link>` "Open v1 factsheet" pointing to `/strategy/{id}` where `{id}` is derived from `usePathname()` — strip the trailing `/v2` suffix from the pathname
  </behavior>
  <action>
1. Create `src/app/strategy/[id]/v2/error.tsx` with this exact content:

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const pathname = usePathname();
  // pathname is like "/strategy/{id}/v2" — derive v1 path by stripping the trailing "/v2"
  const v1Href = pathname?.endsWith("/v2") ? pathname.slice(0, -3) : pathname ?? "/";

  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <div className="rounded-lg border border-border bg-card p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <h2 className="text-base font-semibold text-text-primary">
            We couldn&apos;t load this strategy
          </h2>
          <p className="mt-2 text-xs font-normal text-text-muted">
            Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="rounded-md border border-accent bg-card px-4 py-2 text-xs font-semibold text-accent"
            >
              Reload strategy
            </button>
            <Link
              href={v1Href}
              className="rounded-md border border-border bg-card px-4 py-2 text-xs font-normal text-text-secondary"
            >
              Open v1 factsheet
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
```

2. Confirm `npm run typecheck` exits 0. If TypeScript flags `unstable_retry` because the React/Next types haven't fully caught up, the inline annotation `unstable_retry: () => void` makes it explicit (the type system accepts it). If a type error remains and the workaround is non-trivial, document it in the SUMMARY and consider falling back to `reset` (UI-SPEC §5.5 originally specified `reset`; RESEARCH Pitfall 3 recommends `unstable_retry` but treats it as a non-blocking nicety).

3. Run `npm run build` to confirm the error boundary is registered alongside `page.tsx` for the route segment.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "strategy/\\[id\\]/v2/error|unstable_retry" | head -5; echo "TYPECHECK_DONE"</automated>
  </verify>
  <acceptance_criteria>
    - File `src/app/strategy/[id]/v2/error.tsx` exists
    - First non-blank line is `"use client";` (with double quotes and trailing semicolon)
    - `grep -n "unstable_retry: () =&gt; void" src/app/strategy/\\[id\\]/v2/error.tsx` returns at least 1 match (the prop type annotation)
    - `grep -nE "onClick=\\{\\(\\) =&gt; unstable_retry\\(\\)\\}" src/app/strategy/\\[id\\]/v2/error.tsx` returns 1 match
    - `grep -n "Reload strategy" src/app/strategy/\\[id\\]/v2/error.tsx` returns at least 1 match (the button text — verb+noun CTA per UI-SPEC §7)
    - `grep -n "Open v1 factsheet" src/app/strategy/\\[id\\]/v2/error.tsx` returns 1 match (secondary CTA link)
    - `grep -n "We couldn&amp;apos;t load this strategy" src/app/strategy/\\[id\\]/v2/error.tsx` returns 1 match (verbatim heading from UI-SPEC §7)
    - `grep -n "Something went wrong loading the v2 view. Reload strategy, or fall back to the v1 factsheet." src/app/strategy/\\[id\\]/v2/error.tsx` returns 1 match (verbatim body)
    - `grep -n "import { usePathname } from \"next/navigation\"" src/app/strategy/\\[id\\]/v2/error.tsx` returns 1 match
    - `grep -n "console.error(error)" src/app/strategy/\\[id\\]/v2/error.tsx` returns 1 match
    - `grep -nE "font-medium|font-light|font-bold" src/app/strategy/\\[id\\]/v2/error.tsx` returns ZERO matches (UI-SPEC type-scale contract)
    - `grep -nE "text-\\[11px\\]|text-\\[13px\\]|text-\\[14px\\]|text-sm|text-xl|text-2xl" src/app/strategy/\\[id\\]/v2/error.tsx` returns ZERO matches
    - `npm run build` exits 0
  </acceptance_criteria>
  <done>error.tsx Client Component shipped; uses Next 16.2 unstable_retry; verbatim copy from UI-SPEC §7; v1 fallback link derived via usePathname; build clean.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| URL → server | `params.id` (UUID) flows from URL into Supabase `.eq("id", id)`; parameter-bound (no SQL injection) |
| Server-thrown error → client | Next.js production scrubs `error.message`, exposes only `error.digest` (per error.md:106-115); UI never displays the raw message |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14a-04-01 | I (Information disclosure) | error.tsx exposing internal error message | mitigate | Component logs to console (server-only in production) and displays only the static UI-SPEC §7 copy. `error.digest` is available but not rendered. |
| T-14a-04-02 | I | Strategy existence inference via 404 vs 200 | accept | Same as v1 — `getStrategyDetailV2` honors `status='published'` predicate; non-published returns `null` → `notFound()`. No new disclosure beyond v1 baseline. |
| T-14a-04-03 | T (Tampering) | params.id manipulation | mitigate | Supabase `.eq("id", id)` parameter-binds; the `single()` call returns null on 0 rows; no SQL injection surface. |
</threat_model>

<verification>
- `npm run build` exits 0 — confirms route is registered, no broken imports
- `npm run typecheck` exits 0
- 2 new files exist under `src/app/strategy/[id]/v2/`
</verification>

<success_criteria>
1. `src/app/strategy/[id]/v2/page.tsx` mounts `<StrategyV2Shell>` for published strategies; calls `notFound()` otherwise.
2. `generateMetadata` returns the documented title shape for both success and not-found cases.
3. `error.tsx` renders the verbatim UI-SPEC §7 copy; primary CTA invokes `unstable_retry()`; secondary CTA links to `/strategy/{id}`.
4. `npm run build` exits 0; new route appears in build output.
</success_criteria>

<output>
After completion, create `.planning/phases/14a-single-strategy-v2-eager-panels-identity/14a-04-SUMMARY.md` describing:
- Confirmation that `unstable_retry` was used (or, if a type-system issue forced `reset`, document the deviation)
- Build status — confirm route is listed in `npm run build` output
- Any deviations from UI-SPEC copy (none expected — copy is verbatim)
</output>
