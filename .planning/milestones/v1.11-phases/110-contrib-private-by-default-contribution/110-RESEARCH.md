# Phase 110: CONTRIB — private-by-default contribution - Research

**Researched:** 2026-07-16
**Domain:** Next.js 16 App Router client-overlay composition + Supabase RLS/status-lifecycle + owner-inclusive discovery query + custom-ESLint by-construction backstop
**Confidence:** HIGH (every claim verified against in-repo source; Next 16 modal-vs-route decision cross-checked against bundled `node_modules/next/dist/docs/`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Wizard presentation & reuse (shaped by user UAT direction 2026-07-16)**
- Present the contribution wizard as an inline **OVERLAY** (modal/drawer) launched from an allocator-scoped "Add a Strategy" entry. Do NOT route allocators into `/strategies/new/wizard` — that page lives under the manager-guarded `strategies/` subtree (locked manager-only in Phase 109). Mounting an overlay carves allocator wizard access WITHOUT weakening the 109 manager guard or re-opening the route.
- Extract the existing wizard (`WizardClient.tsx` + `WizardChrome`) into a shared client component mountable BOTH ways: the existing manager page AND an allocator overlay. This is the reusable unit **Phase 116's "+ Allocation"** will mount on My Allocation — build for that reuse now (single source of wizard truth, no fork).
- The wizard's finalize step branches on entry context: allocator-contribution entry finalizes UNpublished (no `manager_status` write, no "your investors" sell-side copy); the manager page keeps its existing publish flow.

**Private-by-default finalization (CONTRIB-02)**
- A contributed strategy row is owned by the allocator (`user_id` = authenticated session id), `published=false` (or equivalent), and NEVER enters the public catalog, NEVER auto-published. No `manager_status` transition on the contribution path.

**Allocator-scoped "Add a Strategy" entry (CONTRIB-01)**
- A new entry in the ALLOCATOR workspace (the ROLE-02 "scoped contribution entry" exception noted in Phase 109). It launches the overlay. Copy is allocator-framed (adding a strategy to track/compose), not manager "publish to investors".

**Owner-inclusive Browse discovery (CONTRIB-03)**
- The composer Browse drawer discovery uses `withPublishedOrOwner` semantics: `published OR user_id = <session id>`. The owner id is sourced ONLY from the authenticated server session — never a client-supplied param.

**Cross-owner isolation — two-layer + lint (CONTRIB-04)**
- Enforce at BOTH layers: (a) `strategies_read` RLS already permits `published OR user_id = auth.uid()` (this is a query-builder `.or()`, NOT a new policy migration); (b) the request-scoped query builder derives userId from the session.
- Add a LINT rule banning `.or('...user_id...')` used against a service-role / admin client, so a future client swap cannot silently remove the RLS backstop and leak unpublished rows.
- A cross-owner-isolation test proves a second, non-owner user never sees the first user's unpublished strategy in Browse — asserted at the RLS layer AND the query-builder layer.

**Browse drawer CTA (CONTRIB-05)**
- The Browse drawer surfaces a "Can't find it? Add your own" CTA that launches the contribution overlay (same reusable wizard).

### Claude's Discretion
- Overlay implementation (existing Modal/Drawer primitive vs a new one — reuse existing); exact wizard-extraction seam; the `published`/private column mechanics (reuse whatever the existing wizard already writes, just default private on the contribution branch); lint-rule mechanism (eslint custom rule vs a grep-gate script — match existing repo lint conventions).

### Deferred Ideas (OUT OF SCOPE)
- "+ Allocation" on My Allocation mounting this same wizard overlay → Phase 116 (ADDALLOC). 110 builds the reusable component; 116 wires the trigger.
- No-disabled-buttons → remedy-popup pattern → Phase 117 (UIFIX).
- Composer weighting / leverage on the contributed constituent → 111/112.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONTRIB-01 | Allocator adds an off-catalog strategy through the existing wizard (CSV or API key), from an allocator-scoped "Add a Strategy" nav entry | Extract `WizardClient` (state machine) + mount in a client overlay (`Modal.tsx` / `createPortal` precedent); add nav entry in `Sidebar.tsx` allocator blocks (`buildNavSections` + `buildPrimaryMobileNav`). |
| CONTRIB-02 | Contributed strategy is private by default — never enters public catalog, never auto-published | **Core finding:** the wizard finalize currently terminates at `status='pending_review'`, which IS a publish candidate (admin review queue → `published`). The contribution branch MUST diverge to an owner-only terminal status (`'private'`) — see Pitfall 1 + the migration decision in Open Question 1. |
| CONTRIB-03 | Allocator sees + selects their own private contributions in the composer Browse drawer (owner-inclusive discovery) | Add `withPublishedOrOwner(query, userId)` to `src/lib/visibility.ts` (the file already documents this exact 3-line extension); swap it into `api/strategies/browse/route.ts`; `userId` from `withAllocatorAuth` session. |
| CONTRIB-04 | A user never sees another user's unpublished strategy in Browse (RLS- and query-builder-tested) | RLS `strategies_read` already = `status='published' OR user_id=auth.uid()` (no new policy). Add an ESLint backstop rule (precedent: `no-raw-published-predicate.mjs`). Two-layer isolation test. |
| CONTRIB-05 | Browse drawer surfaces a "Can't find it? Add your own" CTA linking to the contribution path | Edit `StrategyBrowseDrawer.tsx` to render the CTA → opens the same contribution overlay. |
</phase_requirements>

## Summary

Phase 110 lets an allocator contribute an off-catalog strategy through the **existing** onboarding wizard, mounted as an inline overlay (never a page navigation), finalized private-by-default, and made selectable in the composer Browse drawer with provable zero cross-owner leakage. Almost every piece has a canonical in-repo seam already prepared for it — the risk is not "how to build it" but one sharp correctness trap and three careful wiring seams.

**The one trap that dominates this phase (CONTRIB-02):** the existing wizard does NOT finalize to a private state — it finalizes to `status='pending_review'`, and `pending_review` is a **publish candidate**. `src/app/(dashboard)/admin/page.tsx:40` lists `.eq("status","pending_review")` strategies in the admin review queue and `src/app/api/admin/strategy-review/route.ts:175` promotes them to `status='published'`. So "reuse whatever the wizard already writes" is *insufficient* for CONTRIB-02 — a contribution finalizing to `pending_review` would appear in the admin queue and be publishable. The contribution path MUST terminate at an owner-only status that is never a publish candidate. The strategy `status` CHECK constraint is `('draft','pending_review','published','archived')` — there is no `'private'` value today, so the cleanest fix is a small `ALTER TABLE ... CHECK` migration adding `'private'` (this is NOT the RLS-policy migration the requirements reject — RLS already covers any non-published status for the owner). Separately, `manager_status` is a **`profiles` account column** (newbie/pending/verified), not a strategy column, and the wizard finalize never writes it — so "no manager_status write" is already satisfied; the real work is diverging from the publish queue and swapping the sell-side copy.

**The three wiring seams (all with in-repo precedent):** (1) the Browse owner-inclusive query — `src/lib/visibility.ts` *literally documents* `withPublishedOrOwner` as a deliberately-omitted 3-line extension to add "when a genuine owner-inclusive discovery surface is first written"; this phase is that surface. (2) The lint backstop — `tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs` is a working AST-rule precedent to clone. (3) The overlay — `Modal.tsx` + the `createPortal` pattern in `ScenarioCommitDrawer.tsx` are the state-driven overlay precedents; a client-state overlay (NOT an intercepting/parallel route) is correct because the user explicitly wants NO URL navigation and the wizard's success/failure paths currently hardcode `router.push("/strategies")`, which must be parameterized.

**Primary recommendation:** Extract `WizardClient` behind an `entryContext` prop + injectable `onSuccess`/`onClose` callbacks; mount it in a new `ContributionWizardOverlay` (Modal + portal) that the allocator nav entry and the Browse-drawer CTA both open; branch the finalize path to write an owner-only `status='private'` (add the value via a CHECK-constraint migration, MCP-applied to the test project before merge); add `withPublishedOrOwner` to `visibility.ts` and swap it into the browse route; clone the published-predicate ESLint rule to ban owner-OR on the admin client; prove isolation at both the RLS (pgTAP) and query-builder (vitest) layers.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| "Add a Strategy" nav visibility | Frontend Server (`Sidebar` flags from `profiles.role`) | Browser (renders entry, opens overlay) | Role-derived visibility is a UX hint; the entry is allocator-only (ROLE-02 exception). |
| Wizard overlay presentation | Browser (client island `WizardClient` + Modal/portal) | — | Stateful multi-step client machine; state-driven overlay, no route change. |
| Private-by-default finalize | Database (SECURITY DEFINER finalize RPC writes terminal status) | API/Backend (`finalize-wizard` / `csv-finalize` route branches) | The RPC is the authoritative status writer; the route selects the contribution branch. |
| Catalog exclusion of private rows | Database (RLS `strategies_read` + admin-queue `status` filter) | API (browse route predicate) | RLS is the real boundary; the admin queue filters `pending_review` so `private` is auto-excluded. |
| Owner-inclusive Browse discovery | API/Backend (browse route + `withPublishedOrOwner`) | Database (RLS backstop) | Session-derived userId in the query builder; RLS is defence-in-depth. |
| Cross-owner isolation enforcement | Database (RLS) | Build-time (ESLint backstop) + API (session userId) | Defence-in-depth: RLS + query-builder + a lint that stops a future admin-client swap from leaking. |

## Standard Stack

**No new dependencies.** This is a composition/wiring phase on the existing stack (confirmed by the REQUIREMENTS "Out of Scope" row: *"the pre-stubbed `withPublishedOrOwner`"* and *"zero new deps"*).

### Core (existing, in-repo)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.2.10 | App Router RSC + client islands; `redirect()`/`useRouter` | Already the framework. `[VERIFIED: node_modules/next package.json]` |
| React | 19.2.4 | Client overlay state machine + `createPortal` | Existing. `[VERIFIED: package.json]` |
| @supabase/ssr | in-repo | Per-request user-scoped server client (RLS-scoped reads/writes) | Pattern used by every finalize route + browse route. `[VERIFIED: codebase]` |
| eslint-plugin-quantalyze (local) | 0.1.0 | Custom AST rules — by-construction backstop | `tools/eslint-plugin-quantalyze/`; the CONTRIB-04 lint clones an existing rule. `[VERIFIED: codebase]` |
| pgTAP-style SQL tests | in-repo | RLS isolation assertion | `supabase/tests/*.sql` convention, runs in CI. `[VERIFIED: codebase]` |

**Installation:** none.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. All work is in-repo composition on the existing Next.js/React/Supabase stack + the local ESLint plugin. No `npm install` step.

## Architecture Patterns

### System Architecture Diagram

```
  ALLOCATOR NAV                         BROWSE DRAWER CTA
  Sidebar buildNavSections /            StrategyBrowseDrawer
  buildPrimaryMobileNav                 "Can't find it? Add your own"
  "Add a Strategy" (allocator block)          │
        │  onClick (client action)            │  onClick
        └──────────────┬──────────────────────┘
                       ▼
        ┌─────────────────────────────────────────────┐
        │ ContributionWizardOverlay  [NEW, client]      │
        │  • Modal.tsx / createPortal (no route change) │
        │  • mounts <WizardClient entryContext=          │
        │      'contribution' onSuccess onClose />       │
        └───────────────┬─────────────────────────────┘
                        │ CSV or API-key steps (unchanged WizardClient state machine)
                        ▼
        ┌─────────────────────────────────────────────┐
        │ Finalize: POST /api/strategies/finalize-wizard │
        │          or /api/strategies/csv-finalize        │
        │   ── entryContext branch ──                     │
        │   manager  → status='pending_review'  (publish  │
        │              candidate; existing flow)          │
        │   contrib  → status='private'  (owner-only;     │
        │              NEVER in admin publish queue)  ◄── CONTRIB-02
        └───────────────┬─────────────────────────────┘
                        │ SECURITY DEFINER finalize RPC (writes terminal status)
                        ▼
                 strategies row (user_id = session id)
                        │
        ┌───────────────┴───────────────────────────────┐
        │ RLS strategies_read = status='published'        │
        │                        OR user_id = auth.uid()  │  ◄── isolation boundary (unchanged)
        └───────────────┬───────────────────────────────┘
                        ▼
        ┌─────────────────────────────────────────────┐
        │ GET /api/strategies/browse  (withAllocatorAuth)│
        │  withPublishedOrOwner(query, user.id)   ◄── CONTRIB-03
        │  = .or('status.eq.published,user_id.eq.<id>')  │
        │  user.id from SESSION, never a client param     │
        └───────────────┬─────────────────────────────┘
                        ▼  own private rows + all published rows
                 Composer Browse drawer (selectable constituents)
```

### Recommended Project Structure
```
src/
├── app/(dashboard)/strategies/new/wizard/
│   └── WizardClient.tsx            # EXTRACT SEAM: add entryContext + onSuccess/onClose props
├── app/(dashboard)/allocations/components/
│   ├── ContributionWizardOverlay.tsx   # NEW — Modal/portal wrapper mounting WizardClient (contribution mode); the unit Phase 116 reuses
│   └── StrategyBrowseDrawer.tsx    # EDIT: add CONTRIB-05 "Add your own" CTA → opens overlay
├── app/api/strategies/
│   ├── finalize-wizard/route.ts    # EDIT: entryContext branch → private terminal status
│   └── csv-finalize/route.ts       # EDIT: same branch for the CSV path
├── components/layout/Sidebar.tsx   # EDIT: allocator "Add a Strategy" entry in buildNavSections + buildPrimaryMobileNav
├── lib/visibility.ts               # EDIT: add withPublishedOrOwner (the pre-documented 3-line extension)
supabase/
├── migrations/NNN_strategies_status_private.sql   # NEW — extend status CHECK to include 'private' (NOT an RLS policy)
├── migrations/NNN_finalize_contribution_private.sql # NEW — RPC param/variant writing the private terminal status
└── tests/test_strategies_private_owner_isolation.sql # NEW — RLS cross-owner isolation
tools/eslint-plugin-quantalyze/
├── rules/no-owner-or-on-admin-client.mjs   # NEW — clone of no-raw-published-predicate
├── index.mjs                                # EDIT: register the rule
└── tests/…                                  # NEW rule test
eslint.config.mjs                            # EDIT: enable the rule (error)
```

### Pattern 1: Extract the wizard behind an entry-context + injected callbacks
**What:** `WizardClient` is a `"use client"` island (`export function WizardClient({ initialDraft })`, `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx:112`). Today its post-terminal behaviour is hardcoded to page navigation. Extract by adding an `entryContext: 'manager' | 'contribution'` prop and callbacks that default to the current navigation.
**When to use:** so the manager page (`page.tsx`) mounts it unchanged, and the overlay mounts it in contribution mode with `onSuccess` closing the overlay + refreshing the composer instead of navigating.
**Reference (the hardcoded nav that must be parameterized):**
```typescript
// Source: WizardClient.tsx:535-554 handleSubmitSuccess
router.push(`/strategies?wizard_submitted=1`);   // ← manager route (109-guarded); an allocator would be redirected
router.refresh();
// Also: :341-370 fail-safe redirects, :550, :594 → all push "/strategies"
```
**Adaptation:** inject `onSuccess(finalStrategyId)` / `onClose()`; manager page passes the existing `router.push("/strategies?...")`; the overlay passes `() => { closeOverlay(); refetchBrowse(); }`.

### Pattern 2: Client-state overlay, NOT an intercepting/parallel route
**What:** the user explicitly wants NO page navigation ("I don't even need to go to a different page … just overlay the wizard"). A client-state overlay (open flag + `Modal.tsx`/`createPortal`) satisfies this; an intercepting/parallel route (`(.)`/`@slot`) would change the URL and remount.
**Why route-based is wrong here:** `[CITED: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/parallel-routes.md + intercepting-routes.md]` intercepting routes are for *URL-addressable* modals (shareable/deep-linkable, `router.back()` to dismiss). This wizard is a stateful multi-step island whose current terminal paths *navigate away*; giving it a URL re-introduces exactly the navigation the user rejected and collides with the 109 manager guard on `/strategies/new/wizard`.
**Reference (in-repo overlay precedents):** `src/components/ui/Modal.tsx`; `createPortal` in `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx`; the sibling `StrategyBrowseDrawer.tsx` (state-driven `isOpen`, fixed-position panel, Esc handler) mounted from `ScenarioComposer.tsx:3282,4576`.

### Pattern 3: Owner-inclusive discovery predicate (the pre-documented seam)
**What:** add the helper `visibility.ts` already specifies.
**Reference (`src/lib/visibility.ts:32-40` — verbatim guidance):**
```
* - `withPublishedOrOwner` (published OR own-draft): OMITTED. … When a genuine
*   owner-inclusive discovery surface is first written, add it here then — a
*   3-line extension:  q.or(`status.eq.published,user_id.eq.${authUserId}`).
```
**Swap site (`src/app/api/strategies/browse/route.ts:119`):** replace `withPublishedOnly(supabase.from("strategies").select(...))` with `withPublishedOrOwner(supabase.from("strategies").select(...), user.id)`. `user` is the `AllocatorUser` from `withAllocatorAuth` (session-derived; the route already forbids a client userId param).

### Anti-Patterns to Avoid
- **Finalizing the contribution to `pending_review`:** it enters the admin publish queue (`admin/page.tsx:40` + `admin/strategy-review/route.ts:175`). This silently violates CONTRIB-02. Diverge to `status='private'`.
- **Forking `WizardClient`:** the CONTEXT mandates a single source of wizard truth for Phase 116 reuse. Parameterize, don't copy.
- **Running the owner-OR query on `createAdminClient()`:** the service-role client bypasses RLS; an owner-OR predicate there leaks every user's private rows if `userId` is ever wrong/absent. Keep the browse route on the user-scoped `createClient()` (as it is today) and add the lint backstop.
- **Deriving the overlay/CSV branch from route `searchParams`:** the manager page reads `?source=csv` server-side and keys the island to remount (`page.tsx:53-65,120`). The overlay has no route searchParams — pass `source`/mode as a prop and handle CSV↔API remount internally.
- **A plain `href` nav item for "Add a Strategy":** `NavItem` is `{label, href, icon}` (navigation). Launching an overlay needs a client action, not an href (see Open Question 2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Owner-inclusive query predicate | An inline `.or('status.eq.published,user_id.eq.'+id)` at the route | `withPublishedOrOwner` in `visibility.ts` (add it there) | The module exists precisely so the predicate lives in ONE place; the browse route + Phase 116 both consume it. |
| Cross-owner lint backstop | A bespoke grep script | Clone `no-raw-published-predicate.mjs` into a new AST rule in the existing plugin | The plugin + rule registration + rule-test harness already exist (`index.mjs`, `eslint.config.mjs`, `tools/…/tests/`). |
| Overlay shell (backdrop, Esc, portal, a11y) | A fresh modal | `Modal.tsx` / the `ScenarioCommitDrawer` `createPortal` pattern / the `StrategyBrowseDrawer` panel | DESIGN.md-conformant, a11y-tested precedents already in this exact directory. |
| Private terminal status write | A raw `.update({status:'private'})` on the route | A SECURITY DEFINER finalize RPC (param or variant) | Every finalize today goes through a SECDEF RPC that asserts ownership + from-draft; a raw route UPDATE would bypass that invariant. |
| Session userId for the query | A client-supplied `userId` param | `withAllocatorAuth`'s `AllocatorUser.id` | CONTRIB-03/04 require the id be session-only; the wrapper already provides it. |

**Key insight:** the repo pre-staged nearly every seam (the documented `withPublishedOrOwner`, the ESLint rule family, the overlay primitives). The genuine engineering is the CONTRIB-02 status divergence + the finalize-RPC branch, and the overlay-callback parameterization that stops the wizard navigating an allocator into a manager-guarded route.

## Runtime State Inventory

This phase edits code AND adds a small **schema migration** (status CHECK constraint) + a finalize-RPC change. Both must appear in the plan and be MCP-applied to the test project before merge.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `strategies` rows are unaffected — no backfill. New contributions write a NEW status value (`'private'`). The status CHECK constraint `('draft','pending_review','published','archived')` (initial_schema.sql:63) must be widened FIRST or the INSERT/UPDATE fails a check violation. | **Schema migration** (extend CHECK) + **RPC change** (write the private status). No data backfill. |
| Live service config | None — no n8n/Datadog/external service stores the strategy status enum. The admin review queue (`admin/page.tsx:40`) filters `status='pending_review'`, so `'private'` is auto-excluded by construction (verify no other consumer hard-codes the full status set). | **Code review** — grep every `status IN (...)` / `.eq("status", …)` consumer to confirm `'private'` is handled (excluded from public/verify surfaces, included on the owner's own surfaces). |
| OS-registered state | None — no cron/scheduler references strategy status. `cron/reconcile-strategies` keys on `computation_status`, not `status`. | None. |
| Secrets/env vars | None — no secret/env references the contribution path. `INTERNAL_API_TOKEN` (used by the finalize probe) is unchanged. | None. |
| Build artifacts | None — no compiled artifact embeds the status set. The ESLint plugin is loaded at lint time from source (`tools/eslint-plugin-quantalyze/index.mjs`); registering a rule is a source edit, no build step. | None. |

**The canonical question — after every file is updated, what runtime state still has the old assumption?** The `strategies.status` CHECK constraint in the DB. Until the migration widens it, a `'private'` write fails. Apply the migration to the test project (qmnijlgmdhviwzwfyzlc) via MCP **before merge** so the RED-guarded SQL isolation test passes in CI (test-DB catch-up rule).

## Common Pitfalls

### Pitfall 1: The contribution silently becomes a publish candidate (`pending_review`)
**What goes wrong:** the plan "reuses whatever the wizard writes" and the contribution finalizes to `status='pending_review'`. That row appears in the admin review queue (`admin/page.tsx:40`) and an admin approve promotes it to `published` (`admin/strategy-review/route.ts:175`) — the exact opposite of CONTRIB-02.
**Why it happens:** `finalize_wizard_strategy` / `finalize_csv_strategy` (SECURITY DEFINER RPCs) HARDCODE `status='pending_review'` and assert the current status is `draft`. The wizard's own success comment even says "Wizard finalize sets status='pending_review'" (`WizardClient.tsx:542`).
**How to avoid:** diverge the contribution branch to an owner-only terminal status (`'private'`) that is never in a publish queue. RLS (`published OR user_id=auth.uid()`) already makes `'private'` owner-visible + never public; the admin queue filter auto-excludes it.
**Warning signs:** a plan that edits only the browse route + nav and leaves the finalize path untouched; any finalize test asserting `status: 'pending_review'` on the contribution path.

### Pitfall 2: The overlay wizard navigates the allocator into a manager-guarded route
**What goes wrong:** on submit/failure/delete, `WizardClient` calls `router.push("/strategies")` / `router.push("/strategies?wizard_submitted=1")` (`:341-370,550,594`). `/strategies` is manager-owned (Phase 109 guard) — an allocator gets server-redirected off it, and the overlay's context is lost.
**How to avoid:** parameterize the terminal behaviour with `onSuccess`/`onClose` callbacks; in contribution mode, close the overlay + refresh the Browse drawer, never navigate.
**Warning signs:** the overlay renders `WizardClient` without overriding its navigation; an e2e where an allocator lands on `/allocations` (109 redirect) after submitting.

### Pitfall 3: `source=csv` remount depends on route searchParams the overlay doesn't have
**What goes wrong:** the manager page reads `?source=csv` server-side and keys the island for remount to fix the API↔CSV branch bug (`page.tsx:53-123`). Mounted in an overlay, there is no route searchParams; the CSV branch renders a blank body (the original bug).
**How to avoid:** pass `source`/mode as an explicit prop into the overlay and drive the CSV↔API switch with an internal keyed remount, not `useSearchParams()`.
**Warning signs:** the overlay imports `useSearchParams`; an empty CSV upload step in the overlay.

### Pitfall 4: Running the owner-OR predicate on an RLS-bypassing client
**What goes wrong:** a future refactor swaps the browse route to `createAdminClient()` (service-role) "for performance" while keeping `.or(published OR user_id=X)`. If `userId` is ever absent/wrong the query returns EVERY user's private rows — a cross-owner leak that RLS would have caught.
**How to avoid:** keep the browse route on the user-scoped `createClient()` (as today) AND add the ESLint rule banning owner-OR on the admin client. This is precisely the CONTRIB-04 lint backstop.
**Warning signs:** `createAdminClient()` in `browse/route.ts`; an `.or('...user_id...')` outside `withPublishedOrOwner`.

### Pitfall 5: Confusing `manager_status` (a profiles column) with strategy status
**What goes wrong:** the plan tries to "not write `manager_status`" on the strategy row — but `manager_status` is a `profiles` account column (`newbie|pending|verified`, initial_schema.sql:13) touched only by `admin/manager-approve` and the onboarding gate. The wizard finalize never writes it.
**How to avoid:** read "no manager_status write" as "don't route the contribution through the manager verification/publish flow." The actionable work is the status divergence (Pitfall 1) + swapping the sell-side copy ("Submit for review" → allocator-framed), NOT touching `profiles.manager_status`.
**Warning signs:** a task that updates `profiles.manager_status` on the contribution path.

### Pitfall 6: Grepping `src/` only when adding the `'private'` status
**What goes wrong:** a consumer that hard-codes the status set (or asserts a strategy is `pending_review`/`published`) lingers in `e2e/` or `*.test.ts` and turns red, or worse a public surface fails to exclude `'private'`. (v1.10 lesson: grep-gates that scan `src/` only miss `e2e/`.)
**How to avoid:** grep the WHOLE repo for `pending_review` / `published` / `status IN` consumers; confirm every public/verify surface excludes `'private'` and every owner surface includes it.
**Warning signs:** a status-set literal in a test fixture not updated for `'private'`.

## Code Examples

### The owner-inclusive helper (add to `src/lib/visibility.ts`)
```typescript
// Source: the exact 3-line extension the module docstring prescribes (visibility.ts:38-40).
// Client-safe (no server-only imports), mirroring withPublishedOnly. userId is
// session-derived by the caller (never a client param) — CONTRIB-03/04.
export function withPublishedOrOwner<Q>(query: Q, authUserId: string): Q {
  return (query as { or(filter: string): Q }).or(
    `status.eq.published,user_id.eq.${authUserId}`,
  );
}
```

### Browse route swap (`src/app/api/strategies/browse/route.ts:119`)
```typescript
// BEFORE: withPublishedOnly(supabase.from("strategies").select(...))
// AFTER:
const { data, error } = await withPublishedOrOwner(
  supabase.from("strategies").select("id, name, codename, disclosure_tier, markets, strategy_types, is_example"),
  user.id, // AllocatorUser.id from withAllocatorAuth — session only
).order("name", { ascending: true }).limit(STRATEGY_BROWSE_LIMIT + 1);
```

### CONTRIB-04 lint rule (clone of the published-predicate rule)
```javascript
// Source pattern: tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs
// New rule: ban `.or("...user_id...")` outside withPublishedOrOwner (visibility.ts marker exempt),
// especially against a service-role/admin client. Register in index.mjs + enable in eslint.config.mjs.
"CallExpression[callee.property.name='or']"(node) {
  const arg = node.arguments[0];
  if (arg?.type === "Literal" && /user_id\.eq\./.test(String(arg.value))) {
    context.report({ node, messageId: "raw" }); // "route owner-inclusive queries through withPublishedOrOwner"
  }
}
```

### Status CHECK migration (NOT an RLS policy)
```sql
-- Source: initial_schema.sql:63 defines the current constraint.
-- Widen it to admit an owner-only 'private' terminal status. RLS strategies_read
-- (status='published' OR user_id=auth.uid()) already makes 'private' owner-visible
-- and never public — no policy change needed.
ALTER TABLE strategies DROP CONSTRAINT strategies_status_check;
ALTER TABLE strategies ADD CONSTRAINT strategies_status_check
  CHECK (status IN ('draft','pending_review','published','archived','private'));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `withPublishedOrOwner` omitted (zero consumers, Rule-2 removal) | Added as the browse route becomes the first owner-inclusive surface | Phase 110 | Realizes CONTRIB-03; the module docstring pre-authorized this exact addition. |
| Wizard finalize → `pending_review` only (publish candidate) | Contribution branch → owner-only `private` terminal status | Phase 110 | Realizes CONTRIB-02; keeps contributions out of the admin publish queue. |
| Browse route `withPublishedOnly` (public catalog only) | `withPublishedOrOwner` (public + own private) | Phase 110 | Owner sees own contributions; non-owners still see only published (RLS + lint). |

**Deprecated/outdated:** none removed. The wizard's `handleSubmitSuccess` comment "Wizard finalize sets status='pending_review'" becomes contribution-mode-inaccurate — update the comment where the branch is added.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Adding `'private'` to the status CHECK is the cleanest private-by-default mechanism (vs. a `pending_review` + contribution-flag that the admin queue must exclude) | Pitfall 1 / Open Question 1 | MEDIUM — a flag-based approach avoids a migration but relies on every publish-surface remembering to exclude the flag (fragile). Planner + discuss-phase should confirm. This is the phase's key decision. |
| A2 | The requirements' "no new RLS migration" non-goal does NOT forbid a status CHECK-constraint migration | CONTRIB-02 | LOW-MEDIUM — the non-goal text targets an RLS *policy* migration specifically ("`strategies_read` already permits …"). A CHECK widening is a different object. Confirm with user in discuss-phase. |
| A3 | The contribution still wants analytics computed (so the allocator sees KPIs in the composer) but NOT a `strategy_verifications` "verified" provenance row | Open Question 3 | MEDIUM — if a contribution should show KPIs, the finalize must still enqueue `sync_trades`/`compute_analytics_from_csv`; whether it inserts `strategy_verifications` (trust_tier) is a product call. |
| A4 | The "Add a Strategy" nav entry launches a client overlay via an onClick action, not an href navigation | Open Question 2 | LOW — `NavItem` is href-based; the overlay-trigger mechanism (action nav item vs. query-param-mounted overlay) is a UI-wiring choice, both viable. |
| A5 | Contribution `status='private'` rows must be excluded from public detail (`/strategy/[id]`), factsheet PDF, and match/intro surfaces | Runtime State Inventory | MEDIUM — those surfaces filter `status='published'` today (e.g. queries.ts:255), so `'private'` is already excluded; verify each explicitly. |

## Open Questions

1. **Private-by-default mechanism: new `'private'` status vs. `pending_review`+exclusion flag.** *(THE phase decision.)*
   - What we know: the wizard finalizes to `pending_review`, which is a publish candidate; the status CHECK has no owner-only terminal value.
   - Recommendation: add `'private'` via a CHECK-constraint migration + branch the finalize RPC. By-construction safe (RLS + admin-queue filter auto-exclude). Surface to discuss-phase for confirmation given A1/A2.

2. **How the allocator nav entry launches the overlay.** `NavItem` is href-based; an overlay needs a client action.
   - Recommendation: either (a) add an action-style nav item (onClick opens a client store/state that the allocations layout observes), or (b) the entry links to `/allocations?add=1` and the composer opens the overlay from the query param. (b) keeps `NavItem` unchanged and is deep-linkable; (a) is a truer "no navigation." Planner picks; lean (b) for minimal nav-type churn.

3. **Does a contribution insert `strategy_verifications` / enqueue analytics?** The manager finalize inserts a `strategy_verifications` row (trust_tier=api_verified) and enqueues compute. A contribution wants KPIs but not "verified for publication" provenance.
   - Recommendation: keep the analytics enqueue (allocator needs KPIs in the composer); decide whether to insert `strategy_verifications` — likely yes for CSV/API trust display, but NOT as a publish signal. Confirm in discuss-phase.

4. **Composite (multi-key) contributions.** The finalize path has heavy composite routing (`stitch_composite`). Does an allocator contribution support multi-key composites in 110, or single-key/CSV only?
   - Recommendation: scope 110 to the CSV + single API-key paths (matching the UAT "enter the KPI data" direction); defer composite contribution if it complicates the private branch. Flag for the planner.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Next.js runtime | overlay, routes | ✓ | 16.2.10 | — |
| Supabase test project (qmnijlgmdhviwzwfyzlc) | pre-merge SQL isolation test + CHECK migration apply | ✓ (MCP) | — | none — migration MUST be MCP-applied before merge (RED-guarded test) |
| eslint-plugin-quantalyze (local) | CONTRIB-04 lint backstop | ✓ | 0.1.0 | — |
| Analytics service (Railway) | compute KPIs for the contribution (if enqueued) | ✓ (existing finalize path) | — | contribution still finalizes; KPIs compute async |

**Missing dependencies with no fallback:** none. **With fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (TS/TSX) + pgTAP-style SQL tests (`supabase/tests/*.sql`) + ESLint rule tests (`tools/eslint-plugin-quantalyze/tests/`) |
| Config file | `vitest.config.ts` (sharded in CI, `--coverage`); coverage is a blocking gate (lines 82 / stmts 80 / fns 74 / branches 72) |
| Quick run command | `npx vitest run src/app/api/strategies/browse/route.test.ts --no-file-parallelism` |
| Full suite command | `npm run test` (TS) + the supabase SQL test job in `ci.yml` + `npm run lint` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONTRIB-01 | Allocator opens the wizard overlay from the nav entry; finalizes a CSV/API strategy | unit + e2e | `npx vitest run src/app/(dashboard)/allocations/components/ContributionWizardOverlay.test.tsx` | ❌ Wave 0 (new component) |
| CONTRIB-02 | Contribution finalize writes owner-only `private`, NOT `pending_review`; never in admin queue | unit (route) + SQL | `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts` + supabase test | ⚠️ route test exists — extend; SQL new (Wave 0) |
| CONTRIB-03 | Owner sees own `private` rows in browse; `withPublishedOrOwner` uses session id | unit (route) | `npx vitest run src/app/api/strategies/browse/route.test.ts` | ✅ exists — extend (currently asserts published-only) |
| CONTRIB-04 | Non-owner never sees another's `private` row — RLS AND query-builder | SQL + unit + lint-test | supabase pgTAP + browse route test + `npx vitest run tools/eslint-plugin-quantalyze/tests/…` | ❌ Wave 0 (SQL + lint rule + test) |
| CONTRIB-05 | Browse drawer CTA opens the contribution overlay | unit | `npx vitest run src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx` | ✅ exists — extend |

### Cross-owner isolation test strategy (both layers)
- **RLS layer (pgTAP, `supabase/tests/test_strategies_private_owner_isolation.sql`):** as user B (`set local role` / `request.jwt.claims`), SELECT user A's `status='private'` strategy → assert **empty set**. Assert user A's OWN select returns it. Assert `'private'` never appears for an anon/other authed reader. RED-guarded → MCP-apply the CHECK migration to the test project first.
- **Query-builder layer (vitest, browse route):** mock/seed user A private + published rows; call the browse route as user B → assert only published rows returned; call as user A → assert A's private row present. Assert the `.or()` filter string embeds **the session `user.id`**, not a request-supplied param (pin CONTRIB-03/04's session-only contract).
- **Build-time layer (ESLint rule test):** a fixture with `.or('...user_id...')` outside `visibility.ts` → rule reports; inside `visibility.ts` (marker-exempt) → no report; `.or()` on an admin client → reports.

### Sampling Rate
- **Per task commit:** `npx vitest run <touched route/component test> --no-file-parallelism` + `npm run lint`
- **Per wave merge:** `npm run test` + supabase SQL test job + `npm run lint`
- **Phase gate:** full suite green + coverage thresholds + the pgTAP isolation assertion green in CI before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `supabase/tests/test_strategies_private_owner_isolation.sql` — CONTRIB-04 RLS layer (MCP-apply the CHECK migration to test project first)
- [ ] `tools/eslint-plugin-quantalyze/rules/no-owner-or-on-admin-client.mjs` + its test — CONTRIB-04 build-time layer
- [ ] `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` + test — CONTRIB-01
- [ ] Extend `finalize-wizard/route.test.ts` + `csv-finalize` coverage for the private branch — CONTRIB-02
- [ ] Extend `browse/route.test.ts` (owner-inclusive) + `StrategyBrowseDrawer.test.tsx` (CTA) — CONTRIB-03/05

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | `getUser()` in routes; `withAllocatorAuth` / `withAuth` |
| V3 Session Management | no | existing |
| V4 Access Control | **yes** | RLS `strategies_read` (owner isolation) + session-derived userId in the query builder + ESLint backstop banning owner-OR on the admin client. Deny-by-default: private rows are visible only to their owner. |
| V5 Input Validation | **yes (existing)** | The finalize routes already Zod/hand-validate the payload; the entryContext branch adds no new user input beyond a trusted mode flag (must be server/context-derived, never a client-trusted "publish=false" the user could flip). |
| V6 Cryptography | no | — |

### Known Threat Patterns for {owner-scoped discovery + status lifecycle}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-owner read of another user's private strategy in Browse | Information Disclosure | RLS `published OR user_id=auth.uid()` + session userId in `.or()` + lint backstop (CONTRIB-04) |
| Contribution accidentally published (enters admin queue as `pending_review`) | Elevation of Privilege / unintended disclosure | Diverge to owner-only `status='private'`, never a publish candidate (CONTRIB-02) |
| Admin-client swap silently removes the RLS backstop → leak all private rows | Information Disclosure | ESLint rule banning `.or('...user_id...')` on the service-role client + keep browse on the user client |
| Client-supplied `userId`/`publish` param used to widen the query or force publication | Tampering | Source userId + entry context server-side only; never trust a client field |
| Private status leaking onto public detail/factsheet/match surfaces | Information Disclosure | Confirm every public surface filters `status='published'` (excludes `'private'`) — grep audit (A5) |

## Sources

### Primary (HIGH confidence)
- `src/lib/visibility.ts` — the `withPublishedOrOwner` seam (documented 3-line extension) + `withPublishedOnly`
- `src/app/api/strategies/browse/route.ts` — browse discovery query, `withAllocatorAuth` session user, `withPublishedOnly` swap site
- `src/app/api/strategies/finalize-wizard/route.ts` + `csv-finalize/route.ts` — finalize paths; both terminate at `pending_review` via SECDEF RPCs
- `supabase/migrations/20260405061912_rls_policies.sql:28-33` — `strategies_read` = `status='published' OR user_id=auth.uid()` (+ insert/update/delete owner policies)
- `supabase/migrations/20260405061911_initial_schema.sql:63` — status CHECK `('draft','pending_review','published','archived')`; `:13` — `profiles.manager_status`
- `supabase/migrations/20260521185008_wizard_finalize_inserts_verification.sql` — `finalize_wizard_strategy` writes `status='pending_review'`, asserts from-draft, inserts `strategy_verifications`
- `src/app/(dashboard)/admin/page.tsx:34-40` + `src/app/api/admin/strategy-review/route.ts:175` — `pending_review` is a publish candidate (queue → `published`)
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — the extractable state machine + hardcoded `router.push("/strategies")` terminal paths
- `src/app/(dashboard)/strategies/new/wizard/page.tsx` — the manager mount (server auth + draft fetch + `?source=csv` remount keying)
- `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` + `ScenarioComposer.tsx` — the drawer + state-driven overlay mount points; `ScenarioCommitDrawer.tsx` (`createPortal`); `src/components/ui/Modal.tsx`
- `src/components/layout/Sidebar.tsx:78-106,220-227` — allocator nav blocks (`buildNavSections` + `buildPrimaryMobileNav`)
- `tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs` + `index.mjs` + `eslint.config.mjs:46` — the lint-backstop precedent
- `.planning/phases/109-…/109-RESEARCH.md` — role model, manager-guarded `strategies/` subtree, ROLE-02 scoped-contribution exception
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{parallel-routes,intercepting-routes,default}.md` — modal-route pattern (rejected in favour of a client-state overlay) `[CITED]`

### Secondary (MEDIUM confidence)
- CONTEXT.md / REQUIREMENTS.md — phase scope, non-goals, UAT direction
- `.planning/codebase/CONVENTIONS.md` / `STRUCTURE.md` — file placement, route/RLS conventions

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; every seam verified in-repo.
- Architecture (overlay + finalize branch + discovery): HIGH — each maps to a verified in-repo pattern; the modal-vs-route call is cited against bundled Next 16 docs.
- Pitfalls: HIGH — each grounded in a specific source line (esp. Pitfall 1: the `pending_review`→publish queue is exact).
- CONTRIB-02 mechanism: MEDIUM on the *choice* (new `'private'` status vs. flag) — a real product/schema decision surfaced as Open Question 1 for discuss-phase; the *problem* (pending_review is a publish candidate) is HIGH-confidence.

**Research date:** 2026-07-16
**Valid until:** 2026-08-15 (stable; in-repo patterns unlikely to shift within the milestone)
