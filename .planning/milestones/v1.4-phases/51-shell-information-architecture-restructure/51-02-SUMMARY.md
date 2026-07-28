---
phase: 51-shell-information-architecture-restructure
plan: 02
subsystem: routing / CI-guards
tags: [route-contract, public-routes, lockstep, ci-gate, NAV-03, "#512"]
requires:
  - "51-01: guard skeleton (runCheck stub), data-only manifest seed, RED guard-unit test"
provides:
  - "GREEN route-contract guard enforcing 4 lockstep rules in npm run lint"
  - "Full 57-page-route ROUTE_CONTRACT_MANIFEST (the NAV-03 inventory SoT) + 2 route.ts exceptions"
  - "Guard registered in CONTRACT_GUARDS + REGISTRY.md (delete/rename → red CI)"
affects:
  - "51-04 / 51-05 route moves — every move must update the manifest + PUBLIC_ROUTES (or redirects()) in lockstep or fail lint"
tech-stack:
  added: []
  patterns:
    - "CI-gate guard clone of scripts/check-admin-route-manifest.ts (fs-walk + runCheck(rootDir, manifest) + stripComments + exit-code)"
    - "data-only manifest (mirrors src/lib/auth/rbac-manifest.ts) — imports nothing, loads from any context"
    - "Rule-2 matcher replicates proxy.ts public-route semantics verbatim (path === / special-case + prefix matcher)"
key-files:
  created: []
  modified:
    - "scripts/check-route-contract.ts (implemented the 4 runCheck rules + parseRedirectSources)"
    - "src/lib/routing/route-contract-manifest.ts (seed → full 57-route + 2-exception inventory)"
    - "package.json (lint chain + check:route-contract script)"
    - "src/__tests__/contracts/contracts-registry.test.ts (CONTRACT_GUARDS row)"
    - "src/__tests__/contracts/REGISTRY.md (human-readable row)"
decisions:
  - "Classified /forgot-password + /reset-password as `exception` (not `public`) to keep the guard GREEN against proxy.ts reality — neither is in PUBLIC_ROUTES; editing PUBLIC_ROUTES is a proxy behavior change scoped out of this plan. The /forgot-password anon-307 question is logged to deferred-items.md."
  - "Rule 2 matcher includes the proxy `path === \"/\"` special-case so `/` classifies `public` honestly without forcing a phantom `/` entry into PUBLIC_ROUTES."
  - "Rule 4 skips `exception`-class entries from the page-existence check so route.ts handlers (/api/health, /auth/callback) are not flagged STALE."
metrics:
  duration: "~25 min"
  completed: "2026-06-29"
  tasks: 2
  files: 5
---

# Phase 51 Plan 02: Route-Contract Guard GREEN Summary

Turned the Wave-0 route-contract guard GREEN: `runCheck` now enforces all four lockstep rules against the live tree, the full 57-page-route inventory is classified in `ROUTE_CONTRACT_MANIFEST`, the guard is wired into `npm run lint`, and it is registered in the contracts registry — permanently closing the #512 (307→login) drift class by construction at lint time.

## What shipped

**Task 1 — guard rules + full inventory** (`feat(51-02)` `21448684`)
- Implemented the 4 `runCheck` rules (previously stubbed no-ops from 51-01):
  - **Rule 1 (UNCLASSIFIED):** every `page.tsx` the walk discovers must have a manifest entry.
  - **Rule 2 (MISSING-FROM-PUBLIC, the #512 lockstep):** every manifest `public` route must be covered by `proxy.ts` `PUBLIC_ROUTES`, using the proxy's *exact* matcher (`route === "/"` special-case + `route === prefix || route.startsWith(prefix + "/")`) so guard and runtime agree.
  - **Rule 3 (MISSING-REDIRECT):** every manifest `redirectFrom` must have a matching `next.config.ts` `redirects()` source. Added `parseRedirectSources()` (comment-hardened, bracket-balanced span walk). No `redirects()` exists yet → satisfied vacuously, ready for 51-05.
  - **Rule 4 (STALE):** every non-`exception` entry must map to a real page; `exception` entries are skipped (route.ts handlers have no page.tsx).
- Populated `ROUTE_CONTRACT_MANIFEST` with all 57 page routes (the exact set the guard's `findRouteFiles` + `pageFileToUrl` produces) + `/api/health` and `/auth/callback` as documented `exception` carve-outs.
- Guard exits 0 on the live tree; the 51-01 RED guard-unit test passes (7/7).

**Task 2 — lint wiring + registry** (`feat(51-02)` `69bb3c24`)
- Appended `&& tsx scripts/check-route-contract.ts` to the `lint` chain (so `frontend-lint` CI runs it) + added a `check:route-contract` sibling script.
- Registered the guard in `CONTRACT_GUARDS` (batch `NAV-03`) + the REGISTRY.md table — the existence pin now fails CI if it is deleted/renamed.
- `npm run lint` exits 0 (0 errors; 572 pre-existing unrelated warnings); contracts-registry suite green (34/34, incl. the new existence pin).

## Verification

- `npx vitest run src/__tests__/check-route-contract.test.ts` → **7/7 GREEN** (the 51-01 RED contract now passes).
- `npx tsx scripts/check-route-contract.ts` → **exit 0**, "57 page routes, all declared in the manifest".
- `npx vitest run src/__tests__/contracts/contracts-registry.test.ts` → **34/34 GREEN** (existence pin holds).
- `npm run lint` → **exit 0** with both `check-admin-route-manifest` (20 routes) and `check-route-contract` (57 routes) OK.
- `npx tsc --noEmit` → **exit 0**.
- **Deliberate-break proofs:**
  - Removing a manifest entry → exactly one `UNCLASSIFIED` for that route.
  - Flipping a private route (`/allocations`) to `public` (not in PUBLIC_ROUTES) → guard exits 1 with `MISSING-FROM-PUBLIC` (the #512 gate by construction). Restored via `git checkout -- <file>`; guard GREEN again.

## Deviations from Plan

### Auto-fixed / scope-boundary discoveries

**1. [Rule 2 / scope-boundary] `/forgot-password` + `/reset-password` are NOT in PUBLIC_ROUTES**
- **Found during:** Task 1 (classifying the 57 page routes against `proxy.ts` PUBLIC_ROUTES).
- **Issue:** The RESEARCH inventory groups these under "Public page routes" alongside `/login`/`/signup`, but neither is a `PUBLIC_ROUTES` member. Classifying them `public` would make Rule 2 fail (guard RED), and the fix (adding them to PUBLIC_ROUTES) is a runtime proxy **behavior** change — out of scope for this classification/guard plan (no moves; PUBLIC_ROUTES edits are 51-04/51-05 or a dedicated fix).
- **Resolution:** Classified both as `exception` with notes documenting the real flow: `/reset-password` is reached *with* a recovery session minted by `/auth/callback?next=/reset-password` (so it passes the proxy gate without being public); `/forgot-password` is the anon recovery entry-point that — per proxy.ts reality — currently 307→login for a logged-out visitor. This keeps the guard GREEN against proxy reality without silently blessing a wrong `public` class.
- **Latent question logged** (NOT fixed here): whether `/forgot-password` should be added to PUBLIC_ROUTES so the "Forgot password?" link works for logged-out users. Tracked in `.planning/phases/51-shell-information-architecture-restructure/deferred-items.md`. Recommended follow-up: add it to PUBLIC_ROUTES + extend the proxy.test public-route `it.each` table + re-classify to `public` (Rule 2 then holds).
- **Files:** `src/lib/routing/route-contract-manifest.ts`; `deferred-items.md` (gitignored, local).

**2. [design clarification] `/` (landing) classified `public` via the proxy `path === "/"` special-case**
- `/` is not a PUBLIC_ROUTES *array* member; the proxy gates it via `path === "/"`. Rather than force a phantom `"/"` entry into PUBLIC_ROUTES, the Rule-2 matcher replicates the proxy's `/` special-case (it already does at proxy.ts L54), so `/` classifies `public` honestly. Documented in the `/` entry's notes.

No other deviations — the rest of the plan executed as written.

## Threat Model Compliance

All `mitigate`-disposition threats in the plan's register are now enforced by construction:
- **T-51-01 (DoS / #512):** Rule 2 fails lint when a manifest-`public` route is not covered by PUBLIC_ROUTES — proven by the deliberate-break smoke-test.
- **T-51-04 (info disclosure):** the manifest is the explicit classification SoT; a route is `public` only if intentionally classified *and* covered by PUBLIC_ROUTES.
- **T-51-05 (redirect tampering):** Rule 3 requires every `redirectFrom` to map to a static `redirects()` source (ready for 51-05).
- **T-51-06 (stripComments bypass):** the guard parses PUBLIC_ROUTES through the hardened `stripComments` tokenizer; the 51-01 comment-bypass test pins it (still GREEN).
- **T-51-SC:** zero package installs this plan — no checkpoint required.

## Known Stubs

None. No hardcoded empty values, placeholder copy, or unwired data sources were introduced. The guard and manifest are fully wired and enforced at lint time.

## Self-Check: PASSED

- All modified files present on disk (scripts/check-route-contract.ts, src/lib/routing/route-contract-manifest.ts, package.json, contracts-registry.test.ts, REGISTRY.md) + 51-02-SUMMARY.md.
- Both task commits present in git history: `21448684` (Task 1), `69bb3c24` (Task 2).
