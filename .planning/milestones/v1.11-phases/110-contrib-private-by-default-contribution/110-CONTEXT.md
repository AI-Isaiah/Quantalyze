# Phase 110: CONTRIB — private-by-default contribution - Context

**Gathered:** 2026-07-16
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey areas auto-resolved from locked requirements + a live-UAT direction from the user (2026-07-16) folded in.

<domain>
## Phase Boundary

An allocator can contribute an off-catalog strategy through the EXISTING onboarding wizard (CSV or API key), reached from an allocator-scoped "Add a Strategy" entry, finalized PRIVATE by default (never published, never auto-published), and can see + select their own private contributions in the composer Browse drawer — with provable zero cross-owner leakage. Delivers CONTRIB-01..05. Does NOT build the composer weighting/leverage (112+), the +Allocation behavior on My Allocation (116 — but 110 builds the REUSABLE wizard overlay that 116 mounts), or the constituent unification (111).

</domain>

<decisions>
## Implementation Decisions

### Wizard presentation & reuse (shaped by user UAT direction 2026-07-16 — [[project_v1_11_uat_direction_addalloc_no_disabled_buttons]])
- Present the contribution wizard as an inline **OVERLAY** (modal/drawer) launched from an allocator-scoped "Add a Strategy" entry. Do NOT route allocators into `/strategies/new/wizard` — that page lives under the manager-guarded `strategies/` subtree (locked manager-only in Phase 109). Mounting an overlay carves allocator wizard access WITHOUT weakening the 109 manager guard or re-opening the route.
- Extract the existing wizard (`src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` + `WizardChrome`) into a shared client component mountable BOTH ways: the existing manager page AND an allocator overlay. This is the reusable unit **Phase 116's "+ Allocation"** will mount on My Allocation — build for that reuse now (single source of wizard truth, no fork).
- The wizard's finalize step branches on entry context: allocator-contribution entry finalizes UNpublished (no `manager_status` write, no "your investors" sell-side copy); the manager page keeps its existing publish flow.

### Private-by-default finalization (CONTRIB-02)
- A contributed strategy row is owned by the allocator (`user_id` = authenticated session id), `published=false` (or equivalent), and NEVER enters the public catalog, NEVER auto-published. No `manager_status` transition on the contribution path.

### Allocator-scoped "Add a Strategy" entry (CONTRIB-01)
- A new entry in the ALLOCATOR workspace (this is the ROLE-02 "scoped contribution entry" exception noted in Phase 109). It launches the overlay. Copy is allocator-framed (adding a strategy to track/compose), not manager "publish to investors".

### Owner-inclusive Browse discovery (CONTRIB-03)
- The composer Browse drawer discovery uses `withPublishedOrOwner` semantics: `published OR user_id = <session id>`. The owner id is sourced ONLY from the authenticated server session — never a client-supplied param.

### Cross-owner isolation — two-layer + lint (CONTRIB-04)
- Enforce at BOTH layers: (a) the `strategies_read` RLS policy already permits `published OR user_id = auth.uid()` (per REQUIREMENTS non-goal: this is a query-builder `.or()`, NOT a new policy migration); (b) the request-scoped query builder derives userId from the session.
- Add a LINT rule banning `.or('...user_id...')` used against a service-role / admin client, so a future client swap cannot silently remove the RLS backstop and leak unpublished rows.
- A cross-owner-isolation test proves a second, non-owner user never sees the first user's unpublished strategy in Browse — asserted at the RLS layer AND the query-builder layer.

### Browse drawer CTA (CONTRIB-05)
- The Browse drawer surfaces a "Can't find it? Add your own" CTA that launches the contribution overlay (same reusable wizard).

### Open-question resolutions (from 110-RESEARCH.md, locked)
- **[KEY] Private mechanism = a NEW `'private'` strategy status** (research-recommended over `pending_review`+flag). The existing wizard finalizes at `status='pending_review'`, which is a PUBLISH CANDIDATE (`admin/page.tsx` lists it; `admin/strategy-review/route.ts` promotes it to `published`) — so "reuse whatever the wizard writes" would SILENTLY violate CONTRIB-02. Add `'private'` to the strategy `status` CHECK constraint via a small migration (NOT the RLS-policy migration the requirements reject — RLS `published OR user_id=auth.uid()` already makes `'private'` owner-visible + never-public, and the admin queue's `pending_review` filter auto-excludes it). The allocator-contribution finalize branch writes `status='private'`. NOTE: `manager_status` is a profiles ACCOUNT column, not a strategy column — "no manager_status write" is already satisfied.
- **Nav launches the overlay via a client action** (not a `/…?add=1` query-param route) — matches the user's "no navigation" direction. `NavItem` is href-based today, so the allocator "Add a Strategy" entry needs a small client-action affordance (a nav item that opens the overlay, not a Link). Keep it minimal.
- **Contribution DOES compute analytics** (it's a real track record needing KPIs) but is NOT a publish signal — enqueue the same dailies/analytics derivation the wizard already does; never flip to published.
- **No artificial source restriction** — CSV / single API-key / (composite if the wizard already supports it) all flow to the SAME finalize; the `status='private'` branch applies regardless of source. Do not fork per-source.

### `withPublishedOrOwner` is pre-staged
- `src/lib/visibility.ts` already documents `withPublishedOrOwner` as a deliberately-omitted 3-line extension "to add when a genuine owner-inclusive discovery surface is first written." THIS phase is that surface. Add it there; swap `browse/route.ts` from `withPublishedOnly` → `withPublishedOrOwner`. `user.id` comes from `withAllocatorAuth` (session-only).

### Lint backstop has an exact precedent
- Clone `tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs` (registered in `index.mjs` + `eslint.config.mjs`) — a working AST rule — to ban `.or('...user_id...')` outside `visibility.ts` / against the admin client.

### Claude's Discretion
- Overlay primitive: reuse `Modal.tsx` / the `createPortal` pattern in `ScenarioCommitDrawer.tsx`; exact wizard-extraction seam into `ContributionWizardOverlay` (parameterize the hardcoded `router.push("/strategies")` success/failure/delete paths with `onSuccess`/`onClose` props so an allocator isn't bounced off the overlay).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` + `WizardChrome.tsx` — the EXISTING onboarding wizard (CSV / API key). Extract to a shared, overlay-mountable component.
- `src/app/(auth)/onboarding/page.tsx` — the other wizard entry (signup onboarding) — check for a shared wizard core to reuse rather than fork.
- Composer Browse drawer + `withPublishedOrOwner` — the discovery query the drawer runs (research to locate exact file; `src/app/api/strategies/browse/route.ts` is the browse API with `withAllocatorAuth`).
- `src/lib/auth/requireRolePage.ts` (Phase 109) — allocator role gate for any new allocator-scoped page/route.

### Established Patterns
- Role = `role IN ('allocator','both')`; the "Add a Strategy" entry shows in the allocator workspace only (Phase 109 ROLE-02 scoped exception).
- Two-layer auth (RLS + request-scoped query) — nav/UI is cosmetic, server enforces.
- `strategies_read` RLS already = `published OR user_id = auth.uid()`.

### Integration Points
- Allocator workspace nav (add the "Add a Strategy" entry — the Phase 109 Sidebar allocator block).
- Composer Browse drawer (owner-inclusive discovery + CTA).
- The wizard finalize path (private-by-default branch).

</code_context>

<specifics>
## Specific Ideas

- User UAT direction (2026-07-16, live prod dogfood): the wizard must OVERLAY inline, not navigate away — "I don't even need to go to a different page. It can just overlay the wizard, and let me enter the KPI data." Build the reusable overlay here; Phase 116 mounts it on "+ Allocation".
- Rejected (REQUIREMENTS non-goal): a new RLS migration for CONTRIB — `strategies_read` already permits `published OR user_id=auth.uid()`; the change is a query-builder `.or()` + the lint backstop, not a policy migration.

</specifics>

<deferred>
## Deferred Ideas

- "+ Allocation" on My Allocation mounting this same wizard overlay → Phase 116 (ADDALLOC). 110 builds the reusable component; 116 wires the trigger.
- No-disabled-buttons → remedy-popup pattern → Phase 117 (UIFIX), applied wherever CTAs block.
- Composer weighting / leverage on the contributed constituent → 111/112.

</deferred>
