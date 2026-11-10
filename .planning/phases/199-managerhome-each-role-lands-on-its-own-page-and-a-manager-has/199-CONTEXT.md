# Phase 199: MANAGERHOME - Context

**Gathered:** 2026-11-09
**Status:** Ready for planning

<domain>
## Phase Boundary

After sign-in each role lands on its own page (allocator: My allocation; manager: their strategies list; admin: the admin dashboard), and every post-sign-in and "go home" destination reads one role-aware choice. `/strategies` and `/my-strategies` become one list with one sidebar entry; it shows each strategy's health and has a legend for its status chips. Every degrade warning names the affected days or key and says what to do, and a test goes RED on one that names neither. Requirements: ROUTE-01, LEAN-01, ROUTE-11.
</domain>

<evidence>
## Measured at HEAD (b9ca8b51b, 2026-11-09)

- One literal, `DEFAULT_AUTHENTICATED_ROUTE` (`src/lib/routing/default-route.ts`), feeds the proxy's signed-in bounce from `/login`/`/signup`, the marketing page redirect and `MarketingHeaderActions`. It is role-blind.
- Hand-written copies of `/discovery/crypto-sma` as "home": `LoginForm` (`handleSubmit`, ignores any `?redirect=`), `PendingApprovalPage`, `OnboardingWizard` (allocator branch; manager branch goes to `/strategies`), `src/app/error.tsx`, `src/app/not-found.tsx`, `(dashboard)/error.tsx`, `admin/error.tsx`, `allocations/error.tsx`, `compare/error.tsx`, `strategy/[id]/error.tsx`, and the wrong-role bounce of every `admin/**/page.tsx` (`isAdminUser` guard, 15 pages). Breadcrumb "Discovery" links are navigation, not "home", and stay.
- `/my-strategies` is the ALLOCATOR's list (`requireRolePage(..., "allocator")`, Phase 149 NAV-01: `StrategyTable` at discovery parity, `#` + `Pnn` against the published set, one placeholder row per key with no strategy). `/strategies` is the MANAGER's list (`StrategiesLayout` guards the whole subtree `manager`; share links, `StrategyActions`, pending intros, wizard draft banner, per-row note with untrusted-key pills, share notes, review feedback). Role `both` sees both sidebar entries (`buildNavSections`: "My Strategies" in the allocator workspace, "Strategies" in the manager workspace; mobile `buildMobileNav` has "Strategies" only).
- PROD (read 2026-11-09, marker confirmed): non-archived strategies are owned by allocator, manager and `both` profiles alike, all `both` owners are admins. So a list for "managers only" would drop real allocator-owned rows.
- Chips: `OwnershipTag` ("Own capital", "Team review", `rounded-md` family) and the `DATA_STATE_CHIP` pipeline family in `StrategyTable` (`rounded-sm`, uppercase). No "Health" column and no legend exist.
- Health signals that already exist per row: key `sync_status` via `isUntrustedKeySyncStatus`, analytics `computation_status` / `isComputedAnalytics`, `deriveComputeState`, freshness (`src/lib/freshness.ts`, `SERIES_STALE_DAYS = 7`), review state.
- Degrade warnings are spread across `src/lib/status-surface-copy.ts`, the allocations components and the factsheet; no inventory exists (ROADMAP: "the phase inventories them first").
</evidence>

<decisions>
## Implementation Decisions

### Founder decisions (2026-11-09)
- **D-01 — One list at `/strategies`, for every strategy owner.** Founder pick (2026-11-09): "/strategies for all owners (Recommended)". Allocators, managers and `both` all reach `/strategies`; `/my-strategies` permanently redirects (308) to it; the sidebar (desktop and mobile) has one "Strategies" entry. Only the index page's guard widens to admit allocators; `/strategies/new`, `/strategies/new/wizard` and `/strategies/[id]/edit` keep their current guards (the Phase 110 allocator wizard exception is unchanged).
- **D-02 — The merged list keeps everything from both.** Founder pick (2026-11-09): "Everything from both (Recommended)". It keeps the Phase 149 `#`/`Pnn` ranking and its note, the placeholder row per key with no strategy, and every manager row action, row note, banner (wizard draft, just-submitted) and pending intros. Manager-only actions show by role; nothing is dropped silently. The `phase-149-my-strategies-parity` contract moves to the merged page and stays green.
- **D-03 — Health is one word per row plus a legend.** Founder pick (2026-11-09): "One word + legend (Recommended)". Values: Healthy / Key problem / Analytics failed / Updating / Stale (no data since <date>), derived only from existing signals (key sync status, analytics computation status, `SERIES_STALE_DAYS`). The row note carries the detail. One legend explains the Health words and every status chip ("Team review", "Own capital", "Private", the pipeline chips and the rest).
- **D-04 — App-wide degrade-warning sweep, factsheet after 196.** Founder pick (2026-11-09): "App-wide, factsheet after 196 (Recommended)". One registry and a RED test cover My allocation, the strategies list, Scenario and the factsheet. Plans that edit factsheet files (`src/app/factsheet/**`, tearsheet, share route) execute only after Phase 196 merges, rebased on main.
- **D-05 — Two degrade-warning kinds are exempt from naming days or a key (narrows SC-4).** Founder pick (2026-11-09): "Accept + record" (raised as CD-09). `DepartedHistoryNote` and the three Phase-198 book-level lines use the count-pinned `whole_history` scope plus an action sentence instead of naming days or a key, because their payloads carry no day range or key id today. The registry test still goes RED on any other warning that names neither, and on any warning with no action. Plan 18 keeps the TODOS booking for the analytics-service change that would let `DepartedHistoryNote` name the departed key. Recorded in this file and in ROADMAP Phase 199 success criterion 4 (deviation policy).

### Claude's Discretion (decided, not founder picks)
- **CD-01 — One role-home function.** A pure `roleHomeFor(profile)` in `src/lib/routing/` replaces the role-blind literal at every "home" and post-sign-in site above: admin (`is_admin`) -> `/admin`; allocator -> `/allocations`; manager -> the merged list; `both` without admin -> `/allocations` (allocator workspace leads the sidebar). Not approved -> `/pending-approval`; not onboarded -> `/onboarding` (unchanged). Static error/not-found pages that cannot read a profile link to one server route (e.g. `/home`) that redirects by role, so every site reads one choice. A test enumerates the call sites and fails on a new hard-coded `/discovery/crypto-sma` used as home.
- **CD-02 — Deep links win.** A safe same-origin `?redirect=` (the proxy's existing `^/[a-z]` rule) is honoured by `LoginForm` before the role home; today it is dropped.
- **CD-03 — Wrong-role bounces** (`requireRolePage`, admin page guards) send the user to their own role home, not to Discovery.
- **CD-04 — Health thresholds** reuse existing constants (`SERIES_STALE_DAYS`, `isUntrustedKeySyncStatus`, `isComputedAnalytics`); no new threshold is invented.
- **D-06 (founder, 2026-11-10, replan R-05): the Health column reuses 197's `listSeriesVerdict` ladder (7 days crypto, 10 days traditional/MT5).** Founder pick: "Keep 197's ladder". One staleness rule across discovery and the manager list. Known residual, routed to Phase 201: a non-crypto row 8 to 10 days old reads Healthy on the list and stale on its factsheet chip.
- **CD-05 — Degrade-warning test.** One registry of degrade warnings; a test fails when a registered warning names neither a day range nor a key, or has no action sentence, and a scan fails on an unregistered warning in a scanned surface. A dead key's warning names only that key (founder rule: a revoked key affects only itself).
- **CD-06 — Old URL.** The retired list route permanently redirects (308) to the kept one, query string preserved.

### Settled after research (Claude's discretion, 2026-11-09; not founder picks)
- **CD-07 — `/home` is the role-home route.** A server page reads the profile and redirects; it is in both `PUBLIC_ROUTES` and the proxy's bounce-exempt set (a signed-out visit goes to `/`). The 13 admin guards (CONTEXT said 15; research measured 13) and every static "home" link point at it.
- **CD-08 — Admin lands on `/admin`, including staff with role `both`** (SC-1 as written). Named in the CHANGELOG, because the founder's own landing changes.
- **CD-09 — `DepartedHistoryNote` is not rewritten in this phase.** Today's payload carries no key id, so it is registered as a count-pinned `whole_history` entry with an action. Naming the departed key needs an analytics-service change, which is booked as a follow-up rather than done here. Founder accepted this narrowing on 2026-11-09 ("Accept + record"), extended to the three Phase-198 book-level lines: see D-05.
- **CD-10 — Allocator wizard drafts.** `/strategies/new/wizard` stays manager-guarded (the Phase 110 exception is the overlay, not the route). So an allocator-only viewer keeps a wizard draft as a Draft row with no resume banner; `both` keeps the banner. This corrects UI-SPEC OQ-6.
- **CD-11 — Remedies by role.** Stale and Analytics-failed remedies point an allocator-only viewer at a path they can open, never the manager-only edit page.
- **CD-12 — Archived rows stay on the merged list** with Health `—`, and are left out of the percentile population.
- **CD-13 — The login page's `redirect` parameter is sanitised** with the same `safeRedirectPath` (it is an open redirect at HEAD).
- **CD-14 — UI-SPEC OQ-1..OQ-5 defaults are adopted** ("Stale (no data yet)", `whole_history` scope, `read_failure` and `recipient` classes, contact-form action where no user action restores data, allocator mobile bottom bar unchanged).

### Carried forward
- Phase 198 D-01: My allocation's missing-data message already names key + days + action; this phase registers it, does not rewrite it.
- Phase 198 deferred: sidebar "Add a Strategy" still opens the manager `WizardClient` for allocators (198 FD-3). Not this phase; Phase 200 owns the one add-a-strategy entry point.
- Phase 196 D-03: `/strategy/[id]` and friends 308 to `/factsheet/[id]`; row links on the merged list point at `/factsheet/[id]`.
- Phase 194 D-04/D-15/D-22: figure gate and AUM visibility apply to the list columns unchanged.
- **Review-driven deviation from SC-1 (2026-11-10, review rounds 1-2, WR-01 / WR-01-R2):** four error boundaries do NOT link the role home, because `/home` redirects straight back into the surface that crashed. The root, admin and allocations boundaries link "Go to Discovery" (`DISCOVERY_LANDING_ROUTE`); the strategies boundary links "Go to your profile" (`/profile`, no role guard), since Discovery is allocator-only. `src/__tests__/role-home-call-sites.test.ts` pins each choice. Recorded in 199-REVIEW-FIX.md and in the ROADMAP SC-1 note.

</decisions>

<canonical_refs>
## Canonical References
- `.planning/ROADMAP.md` (### Phase 199), `.planning/REQUIREMENTS.md` (ROUTE-01, LEAN-01, ROUTE-11)
- `DESIGN.md` — Error Envelope, Voice / microcopy, Trust-Tier Badges
- `.planning/phases/198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs/198-CONTEXT.md`
- `196-CONTEXT.md` on branch feat/196-onestrategypage
</canonical_refs>

---
*Phase: 199-managerhome*
