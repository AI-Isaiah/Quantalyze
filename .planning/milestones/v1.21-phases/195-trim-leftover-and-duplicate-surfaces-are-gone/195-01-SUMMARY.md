---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
plan: 01
subsystem: ui
tags: [nextjs, redirects, route-contract, sidebar, vitest, playwright]

requires:
  - phase: 192-publictruth
    provides: "the /scenarios config-redirect pattern and the retired /demo precedent"
provides:
  - "/portfolio-pdf/<id> as a named, public, data-free retired-report page"
  - "/api/portfolio-pdf/:id -> /portfolio-pdf/:id 308 and /decks -> /discovery/crypto-sma 307 in next.config.ts, in lockstep with the route manifest"
  - "Sidebar without a Decks entry for any role"
affects: [195-02 portfolios retirement, 195-07 guard test, 196 tearsheet, 201 plainwords]

plan_head_before: e2fb131deaf25ff2caf57fd3b9fad3d8cb1dccae
plan_head_after: 9a6606b152fba59719b4af31d0c80378787b61e2

actuals:
  tokens: 25300
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "config-level redirects() + manifest redirectFrom + e2e maxRedirects:0 canary (the /scenarios precedent) for a retired URL"
    - "retired surface = one data-free server page, noindex, no client reads, LegalFooter kept, no disclaimer block"

key-files:
  created:
    - "src/app/portfolio-pdf/[id]/page.test.tsx"
  modified:
    - "src/app/portfolio-pdf/[id]/page.tsx"
    - "next.config.ts"
    - "src/lib/routing/route-contract-manifest.ts"
    - "src/proxy.ts"
    - "src/components/layout/Sidebar.tsx"
    - "src/components/layout/Sidebar.test.tsx"
    - "e2e/route-redirects.spec.ts"
    - "e2e/reflow-sweep.spec.ts"
    - "e2e/axe-app-wide.spec.ts"
    - "e2e/no-clip-sweep.spec.ts"
    - "src/lib/api/limiter-ordering.test.ts"
    - "src/__tests__/critical-regressions.test.ts"
    - "src/__tests__/contracts/env-manifest.test.ts"
    - "src/__tests__/display-sign-single-source.test.ts"
    - "vitest.node-env.ts"
    - ".env.example"
  deleted:
    - "src/app/api/portfolio-pdf/[id]/route.ts (+ route.test.ts)"
    - "src/lib/pdf-render-token.ts (+ test)"
    - "src/app/portfolio-pdf/[id]/vintage.ts (+ test)"
    - "five src/app/portfolio-pdf/[id]/page.*.test.tsx files"

key-decisions:
  - "Redirect mechanism is config redirects() (the /scenarios precedent); CONTEXT's 'Phase 192 retired /demo with a 307' is inaccurate (192 deleted /demo outright) and was not edited."
  - "A2 held: check:route-contract accepts redirectFrom on the non-exception /decks entry (class private, page file kept)."
  - "The retired page does not read the id segment at all, so it needs no params handling and renders the same for a malformed id."

patterns-established:
  - "Retired-report landing: public + bounce-exempt in proxy so an old share link never meets a login wall or a 404."

requirements-completed: [LEAN-03]

coverage:
  - id: D1
    description: "GET /portfolio-pdf/<id> renders the 'This portfolio report has been retired' page for any id, with or without a render token, reading no database client"
    requirement: LEAN-03
    verification:
      - kind: unit
        ref: "src/app/portfolio-pdf/[id]/page.test.tsx#renders the retired notice for a well-formed id and reads nothing (and malformed id, renderToken query)"
        status: pass
      - kind: e2e
        ref: "e2e/route-redirects.spec.ts#/portfolio-pdf/:id renders the retired page to an anonymous visitor (CI only)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "/api/portfolio-pdf/<id> answers 308 to /portfolio-pdf/<id>; /decks answers 307 to /discovery/crypto-sma; both lockstepped with the manifest"
    requirement: LEAN-03
    verification:
      - kind: other
        ref: "npm run check:route-contract (Rule 3 MISSING-REDIRECT seen RED when the /decks source was neutered, GREEN restored)"
        status: pass
      - kind: e2e
        ref: "e2e/route-redirects.spec.ts#/api/portfolio-pdf/:id 308 and #/decks 307 (CI only)"
        status: unknown
    human_judgment: false
  - id: D3
    description: "The sidebar renders no Decks and no /portfolios anchor for allocator, manager, admin or both; allocator workspace order is preserved"
    requirement: LEAN-03
    verification:
      - kind: unit
        ref: "src/components/layout/Sidebar.test.tsx#Sidebar workspace - Decks hidden, no portfolios link (Phase 195 D-04)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The retired page reflows at 320px-class widths with the two CTAs wrapping, and passes axe and no-clip"
    requirement: LEAN-03
    verification:
      - kind: e2e
        ref: "e2e/reflow-sweep.spec.ts, e2e/axe-app-wide.spec.ts, e2e/no-clip-sweep.spec.ts public route row (CI only)"
        status: unknown
    human_judgment: true
    rationale: "Layout adequacy is proven only by the CI public sweeps, which cannot run locally (no seeded build); the verifier reads them from the CI run bound to the head SHA."

duration: 11min
completed: 2026-11-07
status: complete
---

# Phase 195 Plan 01: Retire the portfolio report and hide Decks Summary

**`/portfolio-pdf/<id>` is now a data-free "report retired" page, `/api/portfolio-pdf/<id>` 308s to it, `/decks` 307s to discovery with the Decks code kept, and the sidebar no longer lists Decks.**

## Performance

- **Duration:** about 11 min
- **Started:** about 2026-11-07T11:33Z (not recorded at spawn; estimated from first test run)
- **Completed:** 2026-11-07T11:44Z
- **Tasks:** 3
- **Files modified:** 28 (340 insertions, 1762 deletions over 3 commits)

## Accomplishments

- Old report links by either URL end on a named page: server component, noindex, reads nothing (not even the `id` segment), `LegalFooter` kept, no disclaimer block, copy verbatim from UI-SPEC S-4.
- The renderer, its API route, the HMAC render-token module, the `vintage` helper and eight test files are deleted; every census that listed them moved (limiter registry, critical-regressions pdfRoutes + the CRITICAL-01 IDOR describe, node-env includes, env-manifest INDIRECT_READS, display-sign census lists).
- Decks leaves navigation for every role; `/decks` is a temporary redirect, so removing one config rule restores the page. Decks page, `DeckCard`, `getDecks` and the `crypto-decks` / `tradfi-decks` categories are byte-unchanged.

## Task Commits

1. **Task 1 (tracer): retire the report, old links land on the retired page** - `574a295e6` (feat)
2. **Task 2: delete the orphaned render-token module, move the censuses, add the page to the public sweeps** - `4e3a24ddc` (refactor)
3. **Task 3: hide Decks (sidebar + /decks redirect)** - `9a6606b15` (feat)

**Plan metadata:** the SUMMARY commit (docs) follows this file.

## Grep gates (HEAD baseline -> after)

| Gate | HEAD | After |
|------|------|-------|
| `This portfolio report has been retired` in page.tsx | 0 | 1 |
| `createAdminClient\|verifyPdfRenderToken\|searchParams` in page.tsx | present | 0 |
| API `route.ts`, `vintage.ts`, `pdf-render-token.ts` exist | yes | no |
| `source: "/api/portfolio-pdf/:id"` in next.config.ts / `redirectFrom` in manifest | 0 / 0 | 1 / 1 |
| `portfolio-pdf.*CHROMIUM_BIN` in next.config.ts | 1 | 0 |
| `NEVER MOVE` in manifest | 5 | 4 |
| `"/portfolio-pdf"` in proxy.ts | 2 | 2 (unchanged, still public) |
| `portfolio-pdf/[id]/route.ts` in limiter-ordering.test.ts | 1 | 0 |
| `DEMO_PDF_SECRET` in env-manifest.test.ts | 1 | 0 |
| `pdf-render-token.test.ts` in vitest.node-env.ts | 1 | 0 |
| `portfolio-analytics-adapter.test.ts` in vitest.node-env.ts | 1 | 1 (kept) |
| `portfolio-pdf/[id]/page.tsx` in display-sign-single-source.test.ts | 2 | 0 |
| `href: "/decks"` / `function DeckIcon` / `/portfolios` in Sidebar.tsx | 1 / 1 / 1 | 0 / 0 / 0 |
| `source: "/decks"` / `redirectFrom: "/decks"` | 0 / 0 | 1 / 1 |
| `git diff HEAD` on Decks page + DeckCard | n/a | empty (untouched) |

`npm run check:route-contract`: `[check-route-contract] OK - 56 page routes, all declared in the manifest.` (before and after; no new page routes, two redirect sources added).

**Assumption A2 held:** the non-`exception` `/decks` entry (`class: "private"`) carries `redirectFrom` without any rule objecting.

## Neuter -> RED -> restore proofs

| Guard | Neuter | RED observed | Restore |
|-------|--------|--------------|---------|
| `src/app/portfolio-pdf/[id]/page.test.tsx` ("reads nothing", CTA hrefs) | page imported and called `createAdminClient()` and pointed the secondary CTA at `/portfolios` | 4 of 6 tests failed (3 "reads nothing" cases, the CTA-hrefs case) | `cp -p` from byte backup, `cmp` equal, 6/6 green |
| `src/components/layout/Sidebar.test.tsx` Decks-hidden block | tests written first, Decks still in `Sidebar.tsx` | 3 failures (allocator, both, workspace order) | then production edit made them green (67/67 then 111/111 with neighbours) |
| `npm run check:route-contract` Rule 3 | `/decks` redirect source renamed in `next.config.ts` | `MISSING-REDIRECT: route /decks declares redirectFrom /decks ...` | `cp -p` from byte backup, `cmp` equal, `OK - 56 page routes` |
| `env-manifest.test.ts` dead-entry check | (natural RED) `.env.example` still documented the removed secret | `Active .env.example keys read nowhere in src/ (dead entries): DEMO_PDF_SECRET` | removed the `.env.example` entry, green |

## Gate results

- `npx tsc --noEmit`: clean (no output).
- `npm run lint`: exit 0. eslint reported 0 errors and 2 pre-existing warnings (unused vars in `MetricsColumn.tsx` and `composite-read-path.ts`, files this plan does not touch); admin-route manifest, route contract, planning hygiene and canonical-domain checks all OK.
- Targeted vitest, Task 1 set (page test, limiter-ordering, critical-regressions, proxy): 4 files, 300 passed.
- Task 2 set (env-manifest, display-sign-single-source, anon-strategies-projection): 3 files, 35 passed.
- Task 3 set (Sidebar, MobileNav, phase-32 frozen-spine, requireRolePage-wiring, check-route-contract): 5 files, 111 passed.
- Wider neighbour run (contracts, gitleaks-allowlist, legacy-host-redirect, share-lane headers, no-store-coverage, portfolio-ownership-gate, components/layout, lib/api, portfolio-pdf): 38 files, 958 passed, 1 skipped (pre-existing skip).
- `next build` was not run (not a local gate on the symlinked node_modules).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed the `DEMO_PDF_SECRET` entry from `.env.example`**
- **Found during:** Task 2
- **Issue:** The plan removed the secret from `INDIRECT_READS`, but `.env.example` still documented it, so the env-manifest dead-entry test failed. A repo-wide `git grep` (tracked files, excluding planning, CHANGELOG, TODOS and docs prose) found no remaining reader.
- **Fix:** Deleted the "PDF Generation" block (header, comment and the one key) from `.env.example`.
- **Files modified:** `.env.example`
- **Verification:** env-manifest test green (35/35 across the Task 2 set).
- **Committed in:** `4e3a24ddc`

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** necessary to keep the env manifest honest; no scope creep.

### Authentication gates

None.

## Issues Encountered

- A first dependency grep for the removed secret missed `.env.example` (BSD grep recursion quirk with dotfiles). It was caught by the env-manifest test, then confirmed with `git grep`. No effect on shipped code.

## Follow-ups for the founder / orchestrator (recorded, not done here)

- The `DEMO_PDF_SECRET` variable is still set in Vercel environments. Nothing reads it now; removing it is optional hygiene and was deliberately not done by the executor.
- `src/app/(dashboard)/portfolios/[id]/page.tsx` still links to `/api/portfolio-pdf/<id>`. That page goes in plan 02 (Wave 2); until then the link now resolves through the 308 to the retired page.
- Prose-only mentions of the removed module remain by design (surgical): `src/lib/ratelimit.ts`, factsheet PDF routes, scenario share route, `no-store-coverage.test.ts`, `test-restore-workflow-wiring.test.ts`, the ADR-0014 doc.

## Known Stubs

None. The retired page is complete and intentionally static.

## Threat Flags

None. New surface is two same-origin redirects (fixed destinations, `:id` substituted into the path only) and a public data-free page; no new endpoint, auth path or schema.

## STATE.md and ROADMAP.md

Not updated by this executor. The run is inside a linked phase worktree whose `STATE.md` / `state.json` carried uncommitted orchestrator edits at spawn, and the plan-progress and requirement handlers are owned by the orchestrator (single-writer; LEAN-03 is shared with later plans, so `requirements.mark-complete` must wait for the last declaring plan). Orchestrator action: run `roadmap.update-plan-progress 195` and the shared-ID gate after this SUMMARY lands.

## Expected CI changes (e2e, CI only)

- New cases in `e2e/route-redirects.spec.ts`: `/api/portfolio-pdf/x` (308 to `/portfolio-pdf/x`, not `/login`), `/portfolio-pdf/<zero-uuid>` (200 with the retired heading), `/decks` (307 to `/discovery/crypto-sma`, not `/login`).
- New public rows in `e2e/reflow-sweep.spec.ts`, `e2e/axe-app-wide.spec.ts` and `e2e/no-clip-sweep.spec.ts` for the retired page (reflow at 390px, axe at 3 viewports, no-clip at each viewport).
- Screenshot goldens expected to change: none. A diff in `e2e/svg-chart-parity.spec.ts-snapshots` or `e2e/strategy-v2-chart-parity.spec.ts` is a regression.

## Next Phase Readiness

Plan 02 can extend `next.config.ts`, the manifest and `e2e/route-redirects.spec.ts` (all three now carry the 195-01 entries). No blockers.

---
*Phase: 195-trim-leftover-and-duplicate-surfaces-are-gone*
*Completed: 2026-11-07*

## Self-Check: PASSED

- Created/changed files exist: `src/app/portfolio-pdf/[id]/page.tsx`, `src/app/portfolio-pdf/[id]/page.test.tsx` found; deleted files absent (API route, `pdf-render-token.ts`, `vintage.ts`).
- Commits `574a295e6`, `4e3a24ddc`, `9a6606b15` are ancestors of HEAD; measured `commits: 3` from the plan ledger.
- All task acceptance criteria re-run and passing (table above); plan-level verification (tsc, lint, targeted vitest) green.
