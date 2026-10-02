# Coding Conventions

**Analysis Date:** 2026-04-17

## Language & Compiler

**TypeScript** is the language for the Next.js app. Config at `tsconfig.json`:
- `"strict": true` (no opt-out of strict mode anywhere)
- `"target": "ES2017"`, `"module": "esnext"`, `"moduleResolution": "bundler"`
- `"jsx": "react-jsx"` — do not import React explicitly for JSX
- Path alias: `"@/*": ["./src/*"]` — always use `@/...` for intra-project imports, never relative climbs past one `../`
- `"noEmit": true` — `tsc` is used only as a type-checker (`npm run typecheck`)

**Python** is used for the analytics service (`analytics-service/`). Conventions:
- Python 3.12 (CI pins via `actions/setup-python@v5`)
- Type hints required on public service functions (`from __future__ import annotations` at top)
- `pytest` with `asyncio_mode = auto` (see `analytics-service/pytest.ini`)

## Linting & Formatting

**Linter:** ESLint 9 + `eslint-config-next` (flat config at `eslint.config.mjs`):
```javascript
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
```
Run: `npm run lint` (scope: `src/`).

**Formatter:** No repo-level Prettier config. ESLint's Next.js preset enforces the only style rules. Match the indentation/quote style of surrounding code (2-space indent, double quotes for strings in `.ts`/`.tsx`, single-quote JSX attributes are NOT used).

**Python:** `pytest` config at `analytics-service/pytest.ini`. Tests live under `analytics-service/tests/`. No Black/Ruff config is checked in; follow the style of existing service files.

## Naming Patterns

**Files:**
- Route handlers: `src/app/api/<resource>/route.ts` (and optional `route.test.ts` sibling)
- React components: PascalCase `.tsx` files: `src/components/ui/Button.tsx`, `src/components/admin/DeletionRequestActions.tsx`
- Hooks: camelCase starting with `use`: `src/hooks/useMediaQuery.ts`, `src/app/(dashboard)/allocations/hooks/useTimeframe.ts`
- Lib/utility modules: kebab-case: `src/lib/alert-ack-token.ts`, `src/lib/correlation-math.ts`, `src/lib/portfolio-stats.ts`
- Test files: co-located `.test.ts` / `.test.tsx` next to the source file (e.g. `Button.tsx` → `Button.test.tsx`). Cross-module integration tests live in `src/__tests__/` and are named with kebab-case + purpose (`audit-coverage.test.ts`, `rbac-matrix.test.ts`).
- Python services: snake_case `services/metrics.py`, tests `tests/test_metrics.py`.

**Functions & variables:** camelCase. Example: `logAuditEvent`, `createAdminClient`, `isAdminUser`. Constants use SCREAMING_SNAKE_CASE and are exported from the same module (`export const UUID_RE`, `APP_ROLES`, `SELF_EDITABLE_PREFERENCE_FIELDS`).

**Types & interfaces:** PascalCase. Props interfaces suffixed `Props` (e.g. `interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>`). Discriminated-union result shapes are named for their purpose:
```typescript
export type RequireRoleResult =
  | { forbidden: NextResponse }
  | { roles: AppRole[] };
```

**Audit-event actions:** namespaced `subject.verb` strings (`intro.send`, `role.grant`, `api_key.decrypt`, `deletion.request.create`). See `docs/architecture/adr-0023-audit-event-taxonomy.md` — keep grep-able, never collapse to a single token.

**Database tables:** snake_case (`user_app_roles`, `contact_requests`, `audit_log`). PostgREST column ops always quote column names verbatim; do not rename on the TS side unless mapping through a typed DTO.

## Directives & Module Boundaries

**Client components:** First line `"use client";` (exact double-quotes). About 10 files use it; keep the default to Server Components and promote only the files that need browser APIs / React state. Example: `src/components/admin/DeletionRequestActions.tsx:1`.

**Server-only modules:** First line `import "server-only";` for any module that imports a service-role key, uses `next/server`'s `after()`, or otherwise must never bundle into the client. Examples: `src/lib/auth.ts`, `src/lib/audit.ts`. Tests neuter this import with:
```typescript
vi.mock("server-only", () => ({}));
```

**Server Actions (`"use server"`):** Not used in this codebase. Mutations are Route Handlers under `src/app/api/**/route.ts`. Do not introduce server actions without a `/plan-eng-review` discussion.

## Import Organization

Observed convention (see `src/app/api/intro/route.ts:1-19` for the canonical shape):
1. Next.js / React externals (`"next/server"`, `"react"`)
2. Third-party packages (`"zod"`, `"@supabase/ssr"`)
3. Internal `@/lib/*` imports (Supabase clients, auth helpers, domain helpers)
4. Internal relative imports (siblings — avoid deep relative climbs)
5. Type-only imports use `import type { ... }` when the symbol is never used at runtime

Path alias `@/` is preferred for everything under `src/`. Only use relative imports for sibling files in the same directory (e.g. `import { CardShell } from "./CardShell";`).

## Route Handler Patterns

Every `route.ts` under `src/app/api/**` follows a consistent shape. Canonical template (from `src/app/api/intro/route.ts` and `src/app/api/admin/users/[id]/roles/route.ts`):

```typescript
// 1. CSRF check (for mutations)
const csrfError = assertSameOrigin(req);
if (csrfError) return csrfError;

// 2. Auth — always read user from Supabase server client
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// 3. Rate limit (Upstash; fails open if not configured)
const rl = await checkLimit(userActionLimiter, `intro:${user.id}`);
if (!rl.success) {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
  );
}

// 4. Role / RBAC gate (defense-in-depth over RLS)
// ...profile or user_app_roles lookup → 403 if not permitted

// 5. Zod parse of the body (never trust raw JSON)
const rawBody = await req.json().catch(() => null);
const parsed = SCHEMA.safeParse(rawBody);
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid request body", issues: parsed.error.issues },
    { status: 400 },
  );
}

// 6. Do the work (typically Supabase RPC / insert / update)
// 7. Emit audit event via logAuditEvent (fire-and-forget)
// 8. Return NextResponse.json(...)
```

**Wrappers preferred over ad-hoc boilerplate:**
- `withRole("admin")(handler)` — new route-style RBAC gate from `src/lib/auth.ts`, threads `{ user, roles, supabase, params }` context into the handler. Pilot: `src/app/api/admin/users/[id]/roles/route.ts`.
- `withAdminAuth` — legacy admin-only wrapper that checks `profiles.is_admin`. Still in use; `withRole` is the forward path (see ADR-0005).

**Zod schemas** are defined at module top and named with SCREAMING_SNAKE or PascalCase + `_SCHEMA` suffix:
```typescript
const INTRO_SCHEMA = z.object({
  strategy_id: z.string().uuid(),
  message: z.string().max(2000).nullish(),
  source: z.enum(["direct", "bridge"]).optional().default("direct"),
});
```

**Dynamic route params are awaited** (Next 16 async params):
```typescript
export const POST = withRole<{ id: string }>("admin")(
  async (req, { user, supabase, params }) => {
    const targetUserId = params?.id;  // withRole awaits params for you
    // ...
  },
);
```

Use `export const dynamic = "force-dynamic"` only when Vercel's ISR/prerender must be disabled (cron routes, pages that read PII per-request). Example: `src/app/api/cron/warm-analytics/route.ts:23`. Do NOT sprinkle on pages that don't need it — it breaks static generation.

## API Response Shape

Always `NextResponse.json(body, { status })`. Never return plain JSON literals or `Response` directly.

**Error shape:** `{ "error": "<human-readable message>" }`. For validation failures, attach `issues` (from `ZodError`):
```typescript
NextResponse.json({ error: "Invalid request body", issues: parsed.error.issues }, { status: 400 });
```

**Success shape varies by route** but typical patterns:
- Mutation: `{ success: true, id: "..." }` or `{ success: true, action, role }`
- Fetch: the row / list directly (no `data` wrapper), `NextResponse.json({ content, updated_at })`
- Count / batch: `{ enqueued: number, skipped: number }`

**Status codes:** 200 success, 400 validation, 401 unauthenticated, 403 forbidden, 404 not found, 409 conflict (duplicate), 410 gone (expired token), 429 rate-limited, 500 server error. `503` for "service not configured" (missing env vars) as seen in `analytics-service/main.py:68`.

## Error Handling

**No `Result` / `Either` types** — TypeScript throws or returns discriminated unions. Idioms observed:

1. **`safeParse` then branch** for anything user-supplied (Zod, JSON.parse wrapped in `.catch(() => null)`).
2. **Supabase calls destructure `{ data, error }` and branch:**
   ```typescript
   const { data, error } = await supabase.from("profiles").select("role").eq("id", user.id).single();
   if (error) {
     console.error("[lib-prefix] ... failed:", { code: error.code, message: error.message });
     return NextResponse.json({ error: "..." }, { status: 500 });
   }
   ```
3. **`try { ... } catch { /* fall open */ }`** for non-critical side paths (e.g. rate limiter graceful degradation, audit emission). See `src/lib/audit.ts:182-192`:
   ```typescript
   try {
     after(() => emit(client, event));
   } catch {
     // Outside a request scope, fall back to microtask
     queueMicrotask(() => { void emit(client, event); });
   }
   ```
4. **Fire-and-forget functions never throw to the caller.** `logAuditEvent` returns `void` by contract — emission failures are logged with a stable `[audit]` prefix and dropped. Applies equally to the Python side in `analytics-service/services/audit.py`.
5. **Discriminated-union results for multi-step gates** (e.g. `RequireRoleResult` in `src/lib/auth.ts:100-102`). Callers use `if ("forbidden" in result) return result.forbidden;` as the narrowing check.

**Error boundaries:**
- `src/app/error.tsx` — root error boundary for pages/nested layouts. Uses `"use client"` + `useEffect(() => console.error("[error-boundary]", error))` + `unstable_retry()` (Next 16 shape).
- `src/app/global-error.tsx` — root-layout error boundary; renders its own `<html>` + `<body>`.
- `src/instrumentation.ts` — wires `Sentry.captureException` in `onRequestError` when `SENTRY_DSN` is set (optional; prod-only).

**Middleware file is named `proxy.ts`** (not `middleware.ts`): `src/proxy.ts`. Next.js 16 renamed middleware → proxy. Do not rename back.

## Logging

**No logger library.** Use `console.log` / `console.warn` / `console.error` directly. Every log line MUST be prefixed with a bracketed module tag so log aggregation can grep:

```typescript
console.error("[audit] log_audit_event RPC returned error (dropping):", { code, message });
console.error("[auth] getUserRoles failed:", { user_id: userId, code, message });
console.error("[ratelimit] check failed, failing open:", err);
console.warn("[csrf] NEXT_PUBLIC_SITE_URL is not a valid URL:", siteUrl);
console.error("[api/intro] snapshot compute rejected:", err);
```

Python side: `logging.getLogger("quantalyze.audit")` with log messages that include the same stable `[audit]` prefix so the two services' logs unify under one grep. See `analytics-service/services/audit.py:53`.

**Do not log secrets or full request bodies.** Log structured context (ids, codes, messages) only. Never `console.log(request)` or `console.log(user)` — use `user.id` + selected fields.

**No `debugger` statements in committed code.** ESLint will not flag them, but reviewers will.

## Comments & Documentation

**JSDoc blocks** on exported functions/types document the contract, not the implementation. The audit module (`src/lib/audit.ts:1-75`) is the canonical example — multi-paragraph top-of-file docblock explaining design constraints, taxonomy, and typical call site.

**Inline comments explain WHY, not WHAT.** Short blocks above non-obvious branches. Often reference the ADR, task plan, or migration they implement:
```typescript
// Sprint 6 Task 7.1a — audit the intro send. entity_id pins to the
// contact_requests row so a later forensic query can reconstruct "who
// introduced themselves to whom, when". Fire-and-forget.
logAuditEvent(supabase, { ... });
```

**TODO / FIXME markers** reference a tracked sprint or task (`// TODO: wire Sentry.captureException(error) once observability is set up`). Do not leave unqualified TODOs.

**`@audit-skip:` pragmas** — when a mutation legitimately does not emit an audit event, add an `@audit-skip: <reason>` pragma within 3 lines above the chain. The regression test `src/__tests__/audit-coverage.test.ts` enforces this.

## Function Design

- **Small, single-purpose helpers.** `formatPercent`, `cn`, `isUuid`, `computeFreshness` live in `src/lib/utils.ts` and `src/lib/freshness.ts`. One responsibility per exported symbol.
- **Pure math in its own module.** `src/lib/correlation-math.ts`, `src/lib/drawdown-math.ts`, `src/lib/portfolio-math-utils.ts` — no I/O, easy to unit test. Mirrors the Python side (`analytics-service/services/metrics.py`).
- **Server helpers accept a `SupabaseClient` parameter.** Do not call `createClient()` inside helpers; let the caller inject so tests can pass a mock (`getUserRoles(supabase, userId)` in `src/lib/auth.ts:65`).
- **Named parameters via object destructuring when >2 optional args.** Positional args OK for 1-2 required params.
- **Return `null` or a discriminated-union marker for "not found" / "not applicable"**, never throw for expected absence.

## Module Design

- **One concept per file** in `src/lib/`. If a module exceeds ~300 lines, split by concern (helpers + schemas + types).
- **Co-located tests** for unit modules (`foo.ts` + `foo.test.ts` in the same directory).
- **No barrel files / index re-exports** in `src/lib/` or `src/components/`. Import from the specific module: `import { Button } from "@/components/ui/Button";`, not `from "@/components/ui";`.
- **Typed config / constants at the top.** `APP_ROLES`, `UUID_RE`, `SUPPORTED_EXCHANGES`, `DEFAULT_PREFERENCES` — exported from a stable module and used with `as const` where possible.

## Design System Conformance

Every component pulls colors / radii / spacing from Tailwind classes wired to DESIGN.md tokens. **Never hardcode hex colors in JSX** — use `bg-accent`, `text-positive`, `border-border`, etc. Example from `src/components/ui/Button.tsx:8-13`:
```typescript
const variantStyles: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover",
  secondary: "bg-white text-text-primary border border-border hover:bg-page",
  ghost: "text-text-secondary hover:bg-page",
  danger: "bg-negative text-white hover:bg-red-700",
};
```

Class concatenation uses the project helper `cn(...classes)` from `src/lib/utils.ts:44` (not `clsx` or `classnames`):
```typescript
className={cn("inline-flex items-center ...", variantStyles[variant], className)}
```

Min-height `44px` is enforced on buttons and inputs (touch target). See `src/components/ui/Input.tsx:26`.

## Rules From Project Skills

**`AGENTS.md`:** Next.js 16 has breaking changes. Consult `node_modules/next/dist/docs/` before writing Next-specific code. Honor deprecation notices — notably middleware was renamed to **proxy**.

**`CLAUDE.md` (project) + `DESIGN.md`:** Always read `DESIGN.md` before making visual/UI decisions. Flag code that drifts from the design system (institutional finance aesthetic, no purple gradients, Instrument Serif / DM Sans / Geist Mono only, teal `#1B6B5A` accent). The document at `DESIGN.md:1-117` is the single source of truth for colors, spacing, radii, and anti-patterns.

**Global `CLAUDE.md`:** Simplicity first, minimum diff, root-cause fixes, and elegant solutions over clever abstractions. Banned packages list is enforced by `src/__tests__/check-banned-packages.test.ts` + `scripts/check-banned-packages.mjs` (fails CI if any of `axios`, `react-native-international-phone-number`, `react-native-country-select`, `@openclaw-ai/openclawai` appears in `package.json`).

---

*Convention analysis: 2026-04-17*
