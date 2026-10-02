# Phase 126: FACTSHEET — connected-key api_verified factsheet render + blocking e2e - Pattern Map

**Mapped:** 2026-07-19
**Files analyzed:** 6 (2 new components/layout, 1 new test, 2 edits, 1 CI edit)
**Analogs found:** 6 / 6

> Read-only pattern map. All excerpts are real signatures read this session from the
> repo at v1.12 (92be47af). The degradation primitive `unstable_catchError` has NO
> existing repo usage (grep clean) — its analog is the INSTALLED Next 16.2.10 doc
> plus the repo's `error.tsx` boundary shape.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/strategy/[id]/VerificationBoundary.tsx` (new) | component (client error boundary) | event-driven (error-recovery) | Next docs `catchError.md` + repo `src/app/strategy/[id]/error.tsx` | role-match (no prior repo `catchError`) |
| `src/app/strategy/layout.tsx` (new — Option B) | layout / config | request-response | `src/app/browse/layout.tsx` (`<main>` at :38) | exact |
| `src/app/strategy/[id]/page.tsx` (edit) | page (async RSC) | request-response | itself + `src/app/browse/[slug]/[strategyId]/page.tsx` | exact (in-place edit) |
| `src/app/strategy/[id]/error.tsx` (KEEP — no new file) | error boundary (route) | event-driven | already exists; stays as last-resort | exact (already correct) |
| `src/app/strategy/[id]/VerificationBoundary.test.tsx` (new) | test (unit, jsdom) | — | `src/app/error.test.tsx` | exact |
| `.github/workflows/ci.yml` (edit) | config (CI aggregator) | batch | `frontend` aggregator loop (:642-660) + `e2e-seeded` (:1269) | exact |

## Pattern Assignments

### `src/app/strategy/[id]/VerificationBoundary.tsx` (new — component, error-recovery)

**Primary analog:** `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/catchError.md` (Next 16.2.10, CITED — `v16.2.0` introduced). No repo `unstable_catchError` exists yet; this is the first.
**Copy the fallback-copy + token conventions from:** `src/app/strategy/[id]/error.tsx` (digest-only, no `error.message` leak) and `src/components/strategy-v2/PartialDataBanner.tsx` (honest degraded `role="status"` panel).

**Exact API signature to copy (doc lines 22-40):**
```tsx
'use client'
import { unstable_catchError, type ErrorInfo } from 'next/error'

function ErrorFallback(props: { title: string }, { error, unstable_retry }: ErrorInfo) {
  // ...
}
export default unstable_catchError(ErrorFallback)
```
- `ErrorInfo` exposes `{ error, unstable_retry, reset }`. Prefer `unstable_retry` (re-fetches + re-renders the RSC subtree; `reset` will NOT recover a Server Component throw — doc lines 116-119).
- The fallback's first arg is the wrapper's props (excluding `children`); second arg is `ErrorInfo`.
- The fallback module MUST be `'use client'` (doc line 83).

**CRITICAL security constraint (from `error.tsx` + RESEARCH Security Domain / T-52-15):** Do NOT render `error.message` in the fallback. The repo `error.tsx` (below) shows digest-only; the degraded panel must render STATIC honest copy, not the thrown text — the doc example that prints `{error.message}` is a generic sample, NOT the repo contract.

**Digest-only + no-leak precedent** — `src/app/strategy/[id]/error.tsx` (lines 20-46):
```tsx
export default function StrategyError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[strategy-error]", error);   // log server error client-side, never render it
  }, [error]);
  // ...renders static copy + {error.digest} ONLY (line 42-46), never error.message
}
```

**Honest degraded-panel shape to mirror** — `src/components/strategy-v2/PartialDataBanner.tsx` (whole file, 26 lines):
```tsx
export function PartialDataBanner({ heading, body }: PartialDataBannerProps) {
  return (
    <div role="status" className="mx-auto max-w-[480px] rounded-md border border-border bg-surface-subtle p-4 text-center">
      <p className="text-xs font-normal uppercase tracking-wider text-text-secondary">{heading}</p>
      <p className="mt-1 text-xs font-normal text-text-muted">{body}</p>
    </div>
  );
}
```
For a TRANSIENT/recoverable state DESIGN.md mandates AMBER, not red. Verified tokens (`src/app/globals.css:60,78,79`): `--color-warning: #B45309`, `--color-warning-bg: #FEF3C7`, `--color-warning-border: #FDE68A` → Tailwind classes `text-warning`, `bg-warning-bg`, `border-warning-border`. Add `aria-live="polite"` on the status region (RESEARCH Pattern 1). Copy suggestion (RESEARCH): "Verification temporarily unavailable. The rest of this factsheet is unaffected." NO fabricated metric (no-invented-data).

---

### `src/app/strategy/layout.tsx` (new — Option B — layout, request-response)

**Analog:** `src/app/browse/layout.tsx` (exact — the proven `<main>` landmark source).

`/strategy` currently has NO route-group layout (verified: `ls src/app/strategy/` → only `[id]/`). The root layout renders `{children}` bare (`src/app/layout.tsx:91`, inside `<body className="h-full font-sans antialiased">` at :90). So the v1 page has no `<main>` → axe `landmark-one-main`/`region` fails even on a successful render.

**`<main>` landmark pattern** — `src/app/browse/layout.tsx` (lines 5-44, the load-bearing line is :38):
```tsx
export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-white">
      {/* header ... */}
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        {children}
        <Disclaimer variant="footer" />
      </main>
      <LegalFooter />
    </div>
  );
}
```
Also verified: `StrategyV2Shell.tsx:54` uses `<main className="min-h-screen bg-page">` — this is the v2 surface's own `<main>` on a SEPARATE route. Keep exactly ONE `<main>` per document: v2 is `/strategy/[id]/v2` (own shell), the new `/strategy` layout wraps the v1 `[id]` page. They do not collide.

> **Option A alternative (page-body wrap, RESEARCH Code Examples):** change the v1 page's outer `<div className="min-h-screen bg-page">` (`page.tsx:121`) to `<main className="min-h-screen bg-page">`. Either is valid; a layout also covers future sibling `/strategy/*` routes. Planner picks one — do NOT do both (would yield two `<main>`).

---

### `src/app/strategy/[id]/page.tsx` (edit — page async RSC, request-response)

**Analog:** itself (in-place edit) + the proven-safe twin `src/app/browse/[slug]/[strategyId]/page.tsx` (same `getPublicStrategyDetail` query).

**The fallible region to wrap (the H1 suspect — authed-only sub-tree), current shape** `page.tsx` lines 100-118 + 200-206:
```tsx
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
let initialNoteContent = "";
let initialNoteSavedAt: Date | null = null;
if (user) {
  const { data: noteRow } = await supabase
    .from("user_notes")
    .select("content, updated_at")
    .eq("user_id", user.id)
    .eq("scope_kind", "strategy")
    .eq("scope_ref", strategy.id)
    .maybeSingle();
  // ...
}
// ...later, the only authed-v1 render:
{user && (
  <StrategyNoteCard strategyId={strategy.id} initialContent={initialNoteContent} initialLastSavedAt={initialNoteSavedAt} />
)}
```
This authed `user_notes` fetch → `StrategyNoteCard` (`src/components/notes/StrategyNoteCard.tsx`, a `"use client"` card consuming `NoteRender`/`useNoteAutoSave`/`NoteSaveStatus`) is the ONLY authed-only path on v1 and the leading throw suspect (RESEARCH H1). **Wave 0 repro pins the exact line BEFORE any fix (Rule 6, locked).** Fix at source first; the boundary is defense-in-depth for the transient case.

**Wrap pattern (RESEARCH target):** move the fallible async child into a `<VerificationBoundary>` from `./VerificationBoundary`, keeping the badge/metrics/sparkline OUTSIDE the boundary so they always render:
```tsx
import VerificationBoundary from "./VerificationBoundary";
// ...
<VerificationBoundary>
  {/* the fallible authed sub-region (async RSC) */}
</VerificationBoundary>
```
Import-convention note: this file uses `@/` path aliases for lib/components (`@/lib/queries`, `@/components/ui/VerifiedBadge`) but RELATIVE `./` for co-located route files (mirror `./error.tsx` → use `./VerificationBoundary`).

**Genuinely-wrong stays fail-loud:** `if (!result) notFound();` (`page.tsx:88`) — do NOT move `notFound()` inside the catch boundary. `unstable_catchError` passes `notFound()`/`redirect()` through by design (doc line 16).

---

### `src/app/strategy/[id]/error.tsx` (KEEP — no new file)

Already exists and is correct (client, `unstable_retry` NOT `reset`, digest-only). It stays as the LAST-RESORT route boundary for genuinely-wrong / `notFound`. Do NOT "fix" it to `reset` (RESEARCH State of the Art: repo already migrated to `unstable_retry`). No edit required unless the repro reveals a genuinely-wrong path change.

---

### `src/app/strategy/[id]/VerificationBoundary.test.tsx` (new — unit test, jsdom)

**Analog:** `src/app/error.test.tsx` (exact — a co-located boundary test).

**Header + harness pattern to copy** (`error.test.tsx` lines 1, 14-16, 41-45):
```tsx
/** @vitest-environment jsdom */
import { render, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import Error from "./error";
// ...
await act(async () => {
  render(<Error error={err} unstable_retry={vi.fn()} />);
  await Promise.resolve();
});
```

**What THIS test must pin (RESEARCH Test Map, FACTSHEET-01):** the degrade-not-throw contract — mount `VerificationBoundary` wrapping a child that throws; assert (a) the fallback honest-copy renders, (b) a sibling badge/region still renders (the throw did NOT blank the subtree), (c) `error.message` text is NOT in the DOM (no-leak). This test must FAIL without the boundary (Rule 9 / regression-first). Co-locate next to the component (repo convention — `find` shows every `*.test.tsx` sits beside its source). Run: `npm run test -- src/app/strategy`.

> Note: a Vitest unit cannot exercise Next's server-render catch semantics fully; the e2e `sfox-badge.spec.ts` is the end-to-end regression. Pin the client-boundary contract deterministically here; prove the render path in e2e.

---

### `.github/workflows/ci.yml` (edit — CI aggregator, batch)

**Analog:** the `frontend` aggregator result loop (lines 615-660) + the `e2e-seeded` job (lines 1269-1303).

**Current aggregator loop to extend** (`ci.yml` lines 633-655):
```yaml
  frontend:
    runs-on: ubuntu-latest
    needs:
      - frontend-typecheck
      - frontend-lint
      - frontend-test
      - frontend-coverage
      - frontend-policy
      - frontend-build
    if: always()
    steps:
      - name: Verify all frontend-* jobs succeeded
        run: |
          fail=0
          for r in \
            "frontend-typecheck=${{ needs.frontend-typecheck.result }}" \
            ...
            "frontend-build=${{ needs.frontend-build.result }}"; do
            name="${r%=*}"; result="${r#*=}"
            echo "$name: $result"
            if [ "$result" != "success" ]; then fail=1; fi
          done
```

**Two edits (RESEARCH CI wiring + Pitfall 2):**
1. Add `- e2e-seeded` to `frontend.needs:` (after line 639).
2. Add an `e2e-seeded=${{ needs.e2e-seeded.result }}` row to the `for r in` loop, and treat `skipped` as pass FOR THAT ROW ONLY — because `e2e-seeded` self-skips when `vars.E2E_TEST_DB_CONFIGURED` is unset (`if:` at `ci.yml:1290`). The existing loop's `if [ "$result" != "success" ]` would fail CI on every fork/unconfigured repo. Scope the skip-tolerance so the OTHER rows still demand `success`:
```bash
# for the e2e-seeded row only:
if [ "$result" != "success" ] && [ "$result" != "skipped" ]; then fail=1; fi
```
The blocking effect is REAL on the main repo where `E2E_TEST_DB_CONFIGURED` IS set (secret `qmnijlgmdhviwzwfyzlc` wired) → the spec then gates branch protection (FACTSHEET-02). `e2e-seeded` already `needs: - frontend-typecheck` only (:1291-1292) — do not change its own needs.

---

## Shared Patterns

### Error-boundary security contract (digest-only, no message leak)
**Source:** `src/app/strategy/[id]/error.tsx:27-46`
**Apply to:** `VerificationBoundary.tsx` fallback AND its test.
The fallback logs the error client-side (`console.error`) and renders STATIC honest copy + `error.digest` only — NEVER `error.message` (T-52-15 Information Disclosure). This overrides the generic Next doc example that prints `{error.message}`.

### `unstable_retry` NOT `reset`
**Source:** Next doc `catchError.md:116-119` + repo `error.tsx`/`global-error.tsx` already on `unstable_retry`.
**Apply to:** any recovery affordance in the boundary. `reset()` cannot recover a Server Component throw.

### DESIGN.md semantic color — amber = transient/recoverable
**Source:** `DESIGN.md:183-184,476` + verified tokens `src/app/globals.css:60,78,79`.
**Apply to:** the degraded verification panel. Amber (`text-warning` #B45309 / `bg-warning-bg` #FEF3C7 / `border-warning-border` #FDE68A), NEVER red (red = permanent failure). No fabricated metric.

### Co-located `*.test.tsx` with `/** @vitest-environment jsdom */` + `@testing-library/react`
**Source:** `src/app/error.test.tsx:1,14`
**Apply to:** `VerificationBoundary.test.tsx`.

### `@/` alias for lib/components, `./` for co-located route files
**Source:** `src/app/strategy/[id]/page.tsx:5-14` (`@/lib/...`, `@/components/...`) vs `./error.tsx` sibling refs.
**Apply to:** the boundary import in `page.tsx` (`./VerificationBoundary`).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/app/strategy/[id]/VerificationBoundary.tsx` | component (client error boundary) | error-recovery | No existing `unstable_catchError`/`next/error` usage anywhere in `src/` (grep clean). Use the INSTALLED Next 16.2.10 doc `catchError.md` for the API signature + `error.tsx`/`PartialDataBanner.tsx` for the repo's security + token conventions. This is the first `catchError` boundary in the codebase. |

## Metadata

**Analog search scope:** `src/app/strategy/**`, `src/app/browse/**`, `src/components/strategy-v2/**`, `src/components/notes/**`, `src/app/*.test.tsx`, `.github/workflows/ci.yml`, `node_modules/next/dist/docs/**`, `DESIGN.md`, `src/app/globals.css`.
**Files scanned:** 13 read + targeted greps.
**Pattern extraction date:** 2026-07-19
**Note:** Vercel `next-cache-components`/`react-best-practices` skill injections were surfaced on `app/**` reads; ignored per task scope (read-only mapping; the authoritative primitive is the installed `catchError.md`, not the injected external doc).
