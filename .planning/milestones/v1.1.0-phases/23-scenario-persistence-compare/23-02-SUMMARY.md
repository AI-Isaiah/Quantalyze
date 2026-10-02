---
phase: 23-scenario-persistence-compare
plan: 02
subsystem: allocator-scenario-crud
tags: [persistence, rls, route-handler, rate-limit, zod, tdd]
requires:
  - "scenarios table + RLS (23-01)"
  - "scenarioDraftSchema (scenario-state.ts)"
  - "withAllocatorAuth + NO_STORE_HEADERS + ratelimit + captureToSentry primitives"
provides:
  - "GET /api/allocator/scenario/saved (list, RLS-scoped)"
  - "POST /api/allocator/scenario/saved (create, allocator_id from auth)"
  - "PATCH /api/allocator/scenario/saved/[id] (rename)"
  - "PUT /api/allocator/scenario/saved/[id] (update draft + touch updated_at)"
  - "DELETE /api/allocator/scenario/saved/[id]"
  - "exported scenarioDraftSchema for route reuse"
affects:
  - "Phase 23-04+ (SavedScenariosList / composer Save-Update toolbar consume these routes)"
tech-stack:
  added: []
  patterns:
    - "single-row supabase.from('scenarios') writes under RLS (no SECURITY DEFINER RPC)"
    - "B15 ordering: auth -> validate (400, no token) -> rate-limit -> write"
    - "redacted DB-error envelope (F5a/F5b): console.error + Sentry server-side, stable UI message"
    - "NO_STORE_HEADERS on every response"
    - "async [id] route params (Promise) awaited per-handler; wrapper does not forward ctx"
    - "non-owned id -> 0 rows under RLS -> 404 (existence-oracle mitigation)"
key-files:
  created:
    - "src/app/api/allocator/scenario/saved/route.ts"
    - "src/app/api/allocator/scenario/saved/route.test.ts"
    - "src/app/api/allocator/scenario/saved/[id]/route.ts"
    - "src/app/api/allocator/scenario/saved/[id]/route.test.ts"
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-state.ts"
decisions:
  - "[id] handlers await ctx.params (Promise) and validate the uuid BEFORE delegating to a withAllocatorAuth-wrapped inner handler — withAuth/withAllocatorAuth do not forward the route ctx, so the wrapper cannot supply params; this mirrors the watchlist [strategyId] route while keeping the allocator-role gate."
  - "uuid id validated with the repo's isUuid() helper (watchlist analog convention) rather than an inline z.string().uuid() in the route — same 400-on-malformed behavior, matches codebase convention (CLAUDE.md Rule 11)."
  - "non-owned/non-existent id surfaces as 404 (PGRST116 on .single() update; 0-row .select() on delete), never 403 — does not reveal existence across tenants (T-23-10)."
  - "PUT touches updated_at = now() in the route payload (no set_updated_at trigger; 23-01 decision to keep the dump-sql-functions snapshot gate clean)."
metrics:
  duration_minutes: 24
  tasks_completed: 3
  files_created: 4
  files_modified: 1
  tests_added: 27
  completed_date: 2026-06-21
---

# Phase 23 Plan 02: Scenario CRUD Routes Summary

Allocator-owned scenario CRUD over the RLS-bound `scenarios` table: `saved/route.ts` (GET list, POST create) and `saved/[id]/route.ts` (PATCH rename, PUT update-draft, DELETE) — copying the `/api/allocator/scenario/commit` conventions verbatim (withAllocatorAuth, zod body reusing the exported `scenarioDraftSchema`, rate-limit-after-validation, redacted error envelope, NO_STORE_HEADERS) over single-row writes instead of a SECURITY DEFINER RPC.

## What Was Built

- **`scenarioDraftSchema` exported** (`scenario-state.ts:499`, `const` → `export const`, no shape change) so both routes validate the `draft` body field against the one canonical contract — no second draft validator.
- **`saved/route.ts`**
  - `POST`: `withAllocatorAuth` → `req.text()` (400 on read failure) → `JSON.parse` (try/catch → null) → `SaveScenarioBodySchema.safeParse` (`name` trim/1..120 + reused `scenarioDraftSchema`) → rate-limit AFTER validation (`scenario_save:${user.id}`, 503 misconfig / 429 + Retry-After) → user-scoped `.from("scenarios").insert({ allocator_id: user.id, name, draft, schema_version: draft.schema_version }).select(...).single()`. `allocator_id` is ALWAYS `user.id`; a forged body `allocator_id` is structurally dropped (not in the schema). DB error → redacted `{ error, message }` 500 (console.error + Sentry server-side).
  - `GET`: `.from("scenarios").select("id, name, schema_version, created_at, updated_at").order("updated_at", { ascending: false })`; RLS scopes to the caller; redacted-error + NO_STORE_HEADERS.
- **`saved/[id]/route.ts`** (`PATCH` / `PUT` / `DELETE`): each handler awaits `ctx.params` (a Promise in this Next.js), validates the uuid first (400, before auth/rate-limit), then delegates to a `withAllocatorAuth`-wrapped inner handler that closes over the validated id. PATCH re-validates name 1..120; PUT updates `draft` + `schema_version` + touches `updated_at = now()` in the payload; DELETE removes by id. Non-owned id → 0 rows under RLS → 404 (not 403). Redacted errors + NO_STORE_HEADERS on every response.
- **27 vitest cases** across both files: auth gate (401), body validation (400 + limiter-not-called proving a 400 burns no token), rate-limit deny (429 + Retry-After) and misconfig (503), success paths, the cross-tenant guard (body `allocator_id` ignored, insert uses `user.id`), redacted DB-error message (raw `error.message` never reaches the client), and the 404-not-403 existence-oracle path.

## Verification

- `npx vitest run src/app/api/allocator/scenario/saved/route.test.ts "src/app/api/allocator/scenario/saved/[id]/route.test.ts"` → **27 passed**.
- `npm run typecheck` (`tsc --noEmit`) → clean.
- `npx eslint` on all five files → clean (exit 0).
- **Falsifiability (Rule 9):** the cross-tenant security assertion (T_S8) was mutation-tested — sourcing `allocator_id` from a forged constant instead of `user.id` makes the test fail; restoring `user.id` makes it pass. The test cannot pass on a broken implementation.

## Threat-Register Coverage (from plan `<threat_model>`)

| Threat ID | Mitigation shipped |
|-----------|--------------------|
| T-23-05 (forged allocator_id) | `allocator_id: user.id` always from auth; body field absent from schema; test-proven drop |
| T-23-06 (malformed/oversized draft) | `scenarioDraftSchema` on the wire + name 1..120; 400 before rate-limit |
| T-23-07 (DB error disclosure) | redacted `{ error, message }`; console.error + captureToSentry server-side; raw message never echoed (test-proven) |
| T-23-08 (write flood) | `userActionLimiter` per `user.id`, consumed AFTER validation (503/429 + Retry-After) |
| T-23-09 (caching of payloads) | `NO_STORE_HEADERS` on every response (success + error), test-asserted |
| T-23-10 (existence oracle) | non-owned id → 0 rows → 404 (not 403), test-asserted for PATCH/PUT/DELETE |

## Deviations from Plan

### Auto-fixed / Convention-aligned

**1. [Rule 3 / Rule 11 — convention] uuid validation via `isUuid()` instead of inline `z.string().uuid()`**
- **Found during:** Task 2.
- **Issue:** The plan's verify grep expected `z.string().uuid()` in the `[id]` route. The repo's canonical dynamic-`[id]` analog (`watchlist/[strategyId]/route.ts`, the same route the plan's F5a UUID→400 reference points to) uses `isUuid()` from `@/lib/utils`.
- **Resolution:** Used `isUuid(id)` → 400 on malformed. Behavior is identical to the acceptance criterion ("id validated as uuid → 400 on malformed"); the choice matches codebase convention (CLAUDE.md Rule 11: conformance > taste). The other Task 2 verify-greps (`updated_at`, exported PATCH/PUT/DELETE, `test -f`) all pass; only the literal `z.string().uuid()` substring differs.
- **Files modified:** `src/app/api/allocator/scenario/saved/[id]/route.ts`.

**2. [Rule 2 — missing critical handling] async-params + ctx-forwarding seam**
- **Found during:** Task 2.
- **Issue:** `withAuth`/`withAllocatorAuth` (`withAuth.ts:37,72`) call the handler with `(req, user)` only — they do NOT forward the Next.js route context, and in this Next.js `params` is a `Promise` that must be awaited. A naive `withAllocatorAuth(handler)` export would have no access to `[id]`.
- **Resolution:** Each exported handler `(req, ctx)` awaits `ctx.params`, validates the uuid, then invokes `withAllocatorAuth(inner)(req)` with `inner` closing over the validated id. This keeps the allocator-role gate (the plan's mandate) AND the async-params contract. Verified against `node_modules/next/dist/docs/.../route.md:82-90` (params is `Promise<{ id }>`) per the AGENTS.md Next.js-16 mandate.
- **Files modified:** `src/app/api/allocator/scenario/saved/[id]/route.ts`.

## Known Stubs

None. Both routes are fully wired to the live RLS-bound `scenarios` table; no placeholder data or unwired data sources.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/lib/scenario-state.ts` — FOUND
- `src/app/api/allocator/scenario/saved/route.ts` — FOUND
- `src/app/api/allocator/scenario/saved/route.test.ts` — FOUND
- `src/app/api/allocator/scenario/saved/[id]/route.ts` — FOUND
- `src/app/api/allocator/scenario/saved/[id]/route.test.ts` — FOUND
- Commit `0546d762` (Task 1) — FOUND
- Commit `cc16986c` (Task 2) — FOUND
- Commit `012201e4` (Task 3) — FOUND
