# ADR-0002: Next.js 16 conventions -- App Router, proxy.ts, no Server Actions, Server Components for all data reads

## Status
Accepted (retroactively documenting existing decision)

## Context
Next.js 16 introduced several breaking changes from previous versions:
middleware was renamed to proxy, params/cookies became async, and Cache
Components were added. The team has committed to specific patterns but
none are written down. `AGENTS.md` warns "This is NOT the Next.js you know"
but does not list the actual conventions. New contributors (human or AI)
have no reference for which Next.js 16 features are adopted and which are
explicitly rejected.

## Decision
The following conventions are codified:

1. **App Router only**: All route segments live under `src/app/`. Zero
   `pages/` directory usage. Route groups `(auth)` and `(dashboard)` are
   used for layout scoping.

2. **`proxy.ts` (Next 16 rename)**: The project uses `src/proxy.ts`, not
   `middleware.ts`. This file handles session checks and route protection.

3. **Server Components for all read paths**: The root layout and dashboard
   layout are Server Components that perform database reads directly.
   Data arrives in props from Server Components, not from client-side
   fetching libraries.

4. **Route handlers for all mutations**: Mutations go through HTTP
   POST/PUT/PATCH to `src/app/api/**/route.ts`. Server Actions
   (`'use server'` directive) are NOT used anywhere in the codebase.
   This is a deliberate choice to keep CSRF defense, rate limiting, and
   Origin checks as explicit first-class concerns in route handlers
   (see ADR-0004).

5. **Node.js runtime by default**: No Edge runtime is used unless
   explicitly opted in. `next.config.ts` contains no experimental flags.

6. **Cache Components NOT adopted**: `'use cache'`, `cacheLife`,
   `cacheTag`, and PPR are not used. See ADR-0009 for the full caching
   strategy rationale.

## Consequences

### Positive
- Consistent pattern across the codebase; predictable for newcomers.
- Explicit mutation handling makes security controls (CSRF, rate limiting)
  visible in code review.
- Avoiding Cache Components prevents accidental caching of
  auth-sensitive pages.

### Negative
- Any AI agent or LLM will default to suggesting Server Actions unless
  told otherwise. This ADR must be referenced in `AGENTS.md`.
- The "no Server Actions" convention is the kind of invisible default
  that erodes without documentation.

## Evidence
- Proxy file: `src/proxy.ts` (lines 1-91) -- session check + route
  protection using the Next 16 `proxy` export name.
- Root layout (Server Component): `src/app/layout.tsx` (lines 29-52).
- Dashboard layout (Server Component with DB reads):
  `src/app/(dashboard)/layout.tsx` (lines 6-46).
- Route groups: `src/app/(auth)/` and `src/app/(dashboard)/`.
- Zero Server Actions: grep for `'use server'` or `"use server"` across
  `src/` returns zero files.
- Mutation route handlers: `src/app/api/**/route.ts` (multiple files).
- Next config: `next.config.ts` (lines 1-26) -- CDN headers only, no
  experimental flags.
- Vercel config: `vercel.json` (lines 1-10) -- framework stub with crons.
