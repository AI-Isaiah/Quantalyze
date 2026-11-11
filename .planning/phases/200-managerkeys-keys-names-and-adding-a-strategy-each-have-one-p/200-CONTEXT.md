# Phase 200: MANAGERKEYS — keys, names and adding a strategy each have one place - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning
**Measured at:** `25d31622b` (branch `feat/200-managerkeys`, origin/main with Phase 199 merged). Code is cited by symbol; the ROADMAP's 2026-11-06 line numbers have drifted (for example `strategies/page.tsx:903` is now the header `New Strategy` link near `:1350`).

**How these decisions were made:** the founder was not available during this discuss run. Every gray area took the recommended default, and every decision below is marked **(orchestrator default, founder may revisit)**. Requirements and success criteria are quoted only from ROADMAP.md (Phase 200) and REQUIREMENTS.md.

<domain>
## Phase Boundary

ROADMAP goal: "A manager can see which strategies each key feeds, and nothing re-points a strategy's key without an explicit confirmation. Renaming happens in one place that shows which name is public. Adding a strategy and managing keys each have one entry point, and the security explanation lives in one place."

Requirements: ROUTE-09, ROUTE-10, LEAN-04. Success criteria 1-4 in ROADMAP.md Phase 200 are the scope anchor. This phase changes where controls live and what they say. It does NOT change disclosure behaviour (who sees which name), key encryption, the wizard's own steps, or the database schema.

</domain>

<measured>
## "Not confirmed at HEAD" items, measured 2026-11-10

1. **"Strategy Name" is a dropdown of preset codenames: CONFIRMED.** `StrategyForm` renders `<Select label="Strategy Name">` over `STRATEGY_NAMES` (`src/lib/constants.ts`: "Alpha Centauri", "Black Swan", ...), prepending the current name when it is outside the list (164.6.6.3.1 D-01). In edit mode the update payload sends `name` whenever the picker changed (`...(mode === "create" || name !== strategy?.name ? { name } : {})`), through a direct browser `supabase.from("strategies").update(...)`. So the edit form is a **second writer of `strategies.name`** that does not go through `PATCH /api/strategies/[id]/name` and its private/draft status gate (150 D-17). Whether RLS or a trigger refuses that write on a published row was not measured; the planner measures it.
2. **The edit page lists every key on the account: CONFIRMED.** `ApiKeyManager` reads `api_keys` with `.select(API_KEY_USER_COLUMNS).order("created_at", ...)` and no strategy filter, so RLS scopes it to the user's keys and every one of them gets a card. Every non-current card offers one-click `Use & Sync`, which calls `handleSyncTrades(key.id)` and, via `handleLinkKey`, writes `strategies.api_key_id` with no confirmation. `Add Key` on the same card links the newly added key the same way (comment above `linkControlsAllowed`, KCS-23). Both are hidden on a composite or an unknown shape.
3. **The two key managers are:** (a) `ApiKeyManager` on `/strategies/[id]/edit` (manager, per strategy, lists all account keys), and (b) `AllocatorExchangeManager` inside Profile → `Exchanges` tab (`ExchangesTabContent`, `ProfileTabs` entry `{ key: "exchanges", allocatorOnly: true }`; `profile/page.tsx` loads `getUserApiKeys(user.id)` for role `allocator` or `both`). Both operate on the same `api_keys` rows. A manager-only user sees only (a); an allocator-only user sees only (b); a `both` user sees both over the same keys.

Further facts found while grounding (all at `25d31622b`):
- **Public name.** `displayStrategyName` (`src/lib/strategy-display.ts`) returns `codename` if set, else `name` for `institutional`, else `Strategy #<first 8 of id>`. Discovery/browse uses it for other people's rows. The public factsheet (public by link, 192 D-04) shows `strategies.name` in its H1 (`build-payload.ts` `strategyName: strategy.name`) and prefers `name` in its metadata.
- **PROD, read-only, after the marker query, 2026-11-10:** `codename` is NULL on every non-example strategy (17 private, 13 archived exploratory, 7 archived institutional, 6 pending_review, 3 published; all exploratory except the 7 archived). No app code writes `codename`.
- So `RenameStrategyDialog`'s hint "Only you see this name. Public surfaces keep showing the codename." is not true: no codename exists, and once a strategy is published its `name` is the factsheet H1.
- **Feeds.** A key feeds a strategy two ways: `strategies.api_key_id` (single-key) and `strategy_keys` membership (composite). `GET /api/keys/[id]/memberships` already reads the composite side server-side with an explicit ownership check, and the Delete confirm uses it with a visible "could not check" state (167.2.1 D-01).
- **Security restatements in-app** (grep covered about 9 of ~30 files mentioning encryption; the inventory is INCOMPLETE and the planner completes it): `AllocatorExchangeManager` says "encrypted with a per-user KEK" twice; `ConnectKeyStep` and `MultiKeyConnectStep` each carry a `TRUST_ATOMS` "What we store" atom saying "AES-256-GCM envelope encryption ... The KEK lives in Supabase Vault", which contradicts 192's corrected account (`/security`: Fernet, per-row DEK wrapped by a KEK held by the analytics service). 192 shipped `KEY_STORAGE_SENTENCE` and `KEY_STORAGE_LINK` (`/security#key-handling`) in `src/lib/status-surface-copy.ts`, used by home, `/for-quants` and Terms.
- **Add-a-strategy entry points.** `/strategies` (merged list, Phase 199): header `New Strategy` → `/strategies/new` (a redirect to `/strategies/new/wizard`), draft card `Resume draft` / `Revise & resubmit` → wizard, empty state `Create your first strategy` → `/strategies/new`, plus `StrategiesSection` and `StrategiesEmptyState` mounting `ContributionWizardOverlay`. Allocator surfaces open the overlay (sidebar `Add a Strategy`, `StrategyBrowseDrawer` CTA, `ScenarioComposer`). The overlay mounts the SAME `WizardClient`; it exists because `/strategies/new/wizard` is manager-guarded (Phase 109 lock; Phase 199 CD-10 keeps that). Other links: `/for-quants` logged-in CTA, `DegradeLine` and `CsvStrategyEditNote` (`?source=csv`), and the wizard's own CSV switch.
- **Phase 199 CONTEXT** is not in this worktree's tree (`git merge-base` says commit `81d489627` that brought it to main is not an ancestor of HEAD). It was read from git object `81d489627`. Relevant: D-01 (one list at `/strategies` for every owner), CD-10 (wizard route stays manager-guarded; the allocator exception is the overlay).

</measured>

<decisions>
## Implementation Decisions

### Which strategies each key feeds (SC-1, ROUTE-09)
- **D-01:** Every key, wherever it is listed, shows the strategies it feeds: single-key links (`strategies.api_key_id`) and composite memberships (`strategy_keys`), each naming the strategy and linking to it. A key that feeds nothing says so. A read that fails says it could not check, never "feeds nothing" (same honesty rule as the Delete confirm). Reuse or extend the server-side `GET /api/keys/[id]/memberships` pattern so both link kinds come from one ownership-checked read. No migration. **(orchestrator default, founder may revisit)**
- **D-02:** Keys are not manager-only. A key can also be in an allocator book (founder memory 2026-10-31); this phase shows strategies fed, and does not add allocator-book usage to the list. **(orchestrator default, founder may revisit)**

### Re-pointing a strategy's key (SC-1)
- **D-03:** Every control that changes `strategies.api_key_id` for an existing strategy opens a confirmation before it writes. Today that is `Use & Sync` and `Add Key` on `ApiKeyManager` (both through `handleLinkKey`). The planner inventories every other writer (client and `src/app/api`, for example `composite/*`, `keys/sync`, `create-with-key`) and covers each one that re-points an existing strategy; wizard creation of a NEW strategy is not a re-point. **(orchestrator default, founder may revisit)**
- **D-04:** The confirmation names the strategy, the current key and the new key (key named by its `label` and exchange; the planner picks a fallback when `label` is empty). When no key is linked yet it says so in place of the current key, so first links are confirmed too. Resync of the current key is not a re-point and needs no confirmation. Copy follows DESIGN.md Voice / microcopy and Error Envelope. **(orchestrator default, founder may revisit)**
- **D-05:** A test drives today's one-click `Use & Sync` and goes RED because the write happens with no confirmation; it goes green only when the write waits for the confirm. It must be shown to fail (neuter, see RED, restore from byte backup). **(orchestrator default, founder may revisit)**

### One place to manage keys (SC-3, LEAN-04)
- **D-06:** The one key manager is the account-level list on Profile, the existing `Exchanges` tab renamed to say it holds API keys, shown to every role that can hold keys (manager, allocator, both), not only allocators. Add, delete, rotate secret, update MT5 password, permissions and the D-01 feeds list live there. The planner decides how to merge `AllocatorExchangeManager` and `ApiKeyManager` behaviour (allocator-book bits stay for allocator roles). **(orchestrator default, founder may revisit)** — **Reversibility:** costly — merges two ~1,800-2,000-line components and moves the manager's key controls off the edit page.
- **D-07:** The strategy edit page keeps only that strategy's key panel: the current key, Resync, and "Change key…" (pick another account key, then the D-04 confirm). Adding or deleting keys is not offered there; the panel links to the one key manager. Composite and unknown shapes keep today's fail-closed rules (KCS-23). **(orchestrator default, founder may revisit)**
- **D-08:** The wizard's connect step stays as part of adding a strategy (connect a new key or pick an existing one); it is not a second key manager. **(orchestrator default, founder may revisit)**

### One place to rename, showing the public name (SC-2, ROUTE-10)
- **D-09:** The one rename place is the strategy edit page, using the existing `RenameStrategyDialog` and `PATCH /api/strategies/[id]/name` (free text, `MAGNITUDE_CAPS` cap). `StrategyForm` stops writing `name` in edit mode (the preset dropdown leaves the edit form). `Rename…` on the factsheet header (`FactsheetView`) and on the strategies list (`StrategiesSection`) is removed. The wizard still picks the initial name at creation; that is adding, not renaming. **(orchestrator default, founder may revisit)**
- **D-10:** The name route's private/draft gate (150 D-17) is kept, not widened. On a published or pending strategy the edit page shows the name read-only and says why (an admin reviews names before publication). **(orchestrator default, founder may revisit)**
- **D-11:** The rename place states what the public sees, computed by the same code the public surfaces use, never a claim about a codename: what the public factsheet shows (today `strategies.name` once published) and what discovery shows for other viewers (`displayStrategyName`, today `Strategy #<id>` for exploratory rows since every codename is NULL). The false dialog hint is replaced. Disclosure behaviour itself is not changed in this phase. **(orchestrator default, founder may revisit)**

### One entry point to add a strategy (SC-3, LEAN-04)
- **D-12:** The one flow is the wizard (`WizardClient`). The manager entry point is one `Add a strategy` control on the merged `/strategies` list (Phase 199 D-01), linking straight to `/strategies/new/wizard`. Other links (empty state, `/for-quants` CTA, CSV links, degrade remedies) lead to that same wizard; duplicate buttons on `/strategies` that start a new strategy are collapsed to the one control. `Resume draft` / `Revise & resubmit` continue an existing draft and stay. `/strategies/new` stays as a redirect for old bookmarks. **(orchestrator default, founder may revisit)**
- **D-13:** Allocators keep `ContributionWizardOverlay` because the route is manager-guarded (Phase 109 lock, Phase 199 CD-10). It mounts the same `WizardClient`, so it counts as the same entry point, not a second flow. Every add-a-strategy control uses one label. **(orchestrator default, founder may revisit)**

### One security explanation (SC-4, LEAN-04)
- **D-14:** The security explanation lives on `/security` (`#key-handling`), as 192 D-02 set for public pages. Every in-app surface that describes key storage or encryption renders `KEY_STORAGE_SENTENCE` with `KEY_STORAGE_LINK` instead, including both `AllocatorExchangeManager` "per-user KEK" sites and the `TRUST_ATOMS` "What we store" / "Who can decrypt" atoms in `ConnectKeyStep` and `MultiKeyConnectStep`. **(orchestrator default, founder may revisit)**
- **D-15:** Form guidance that tells the user what key to paste (read-only scopes only, MT5 investor login) stays where the form is, but carries no encryption claim. A test fails when an app surface outside `/security` restates encryption detail (KEK, DEK, AES, Fernet, Vault, "per-user") instead of using the shared sentence. **(orchestrator default, founder may revisit)**

### Claude's Discretion
- Key naming fallback when `label` is empty; dialog layout; whether the feeds list loads per key or in one batched read; tab label wording; exact single label for add-a-strategy controls (DESIGN.md Voice).
- Whether the factsheet/list `Rename…` controls are removed or become links to the edit page (D-09 default: removed).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope
- `.planning/ROADMAP.md` § Phase 200 — goal, evidence, SC-1..SC-4
- `.planning/REQUIREMENTS.md` — ROUTE-09, ROUTE-10, LEAN-04

### Prior decisions this phase builds on
- `.planning/phases/192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one/192-CONTEXT.md` — D-01, D-02 (security explanation lives once on `/security`; 200 owns the manager surfaces)
- Phase 199 CONTEXT (D-01 one list at `/strategies`; CD-10 wizard route stays manager-guarded) — not in this worktree; read with `git show 81d489627:.planning/phases/199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has/199-CONTEXT.md`
- `DESIGN.md` § Broker Selector Grid, § Error Envelope, § Voice / microcopy

### Code
- `src/components/strategy/ApiKeyManager.tsx` — `handleLinkKey`, `handleSyncTrades`, `linkControlsAllowed`, `readKeyCompositeMemberships`
- `src/components/exchanges/AllocatorExchangeManager.tsx`, `src/components/exchanges/ExchangesTabContent.tsx`, `src/components/auth/ProfileTabs.tsx`, `src/app/(dashboard)/profile/page.tsx`
- `src/app/api/keys/[id]/memberships/route.ts`
- `src/app/(dashboard)/strategies/[id]/edit/page.tsx`, `src/components/strategy/StrategyForm.tsx`
- `src/components/strategy/RenameStrategyDialog.tsx`, `src/app/api/strategies/[id]/name/route.ts`, `src/lib/strategy-display.ts`, `src/lib/factsheet/build-payload.ts`, `src/app/factsheet/[id]/v2/FactsheetView.tsx`, `src/app/(dashboard)/strategies/StrategiesSection.tsx`
- `src/app/(dashboard)/strategies/page.tsx`, `src/app/(dashboard)/strategies/new/page.tsx`, `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx`, `src/components/layout/Sidebar.tsx`
- `src/lib/status-surface-copy.ts` — `KEY_STORAGE_SENTENCE`, `KEY_STORAGE_LINK`
- `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx`, `.../MultiKeyConnectStep.tsx` — `TRUST_ATOMS`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `KEY_STORAGE_SENTENCE` / `KEY_STORAGE_LINK`: the one short key-storage sentence and its `/security` link, pinned by `status-surface-copy.test.ts`.
- `RenameStrategyDialog` + name route: validation, cap and error mapping already done.
- `/api/keys/[id]/memberships`: server-side, ownership-checked feeds read with honest failure.
- `displayStrategyName`: the public label resolver for discovery surfaces.
- `ContributionWizardOverlay`: same `WizardClient` for allocators.

### Established Patterns
- Never `.select("*")` on `api_keys`; project `API_KEY_USER_COLUMNS` (migration 027 GRANT allowlist).
- A failed read is never shown as an empty answer (H-0395 class).
- KCS-23: link-writing controls fail closed on composite/unknown shapes.

### Integration Points
- Profile tab set and role gating (`allocatorOnly`) in `ProfileTabs`.
- `/strategies` header actions (Phase 199 merged list).

</code_context>

<specifics>
## Specific Ideas

- The confirm must name the strategy and both keys in words a manager recognises (label + exchange), not ids.

</specifics>

<deferred>
## Deferred Ideas

- Making the public name consistent across surfaces (factsheet shows `name`, discovery shows `Strategy #<id>`, `codename` unused) is a disclosure-behaviour change, not in this phase. Candidate for its own phase; founder decides.
- Showing allocator-book usage beside each key (D-02).
- Whether a manager may rename a published strategy (would widen 150 D-17).

</deferred>

---

*Phase: 200-managerkeys-keys-names-and-adding-a-strategy-each-have-one-place*
*Context gathered: 2026-11-10*

## Review-time decision (2026-11-11, review rounds 1–2; founder unavailable, default taken)

- **D-R1 — an unchecked feeds read holds Delete, never Disconnect.** When the Profile API keys tab cannot check what a key feeds (the read failed or was rate-limited), `Delete key` stays disabled and the dialog offers Retry, because a delete is irreversible (SFH-2). `Disconnect` is reversible and keeps plan 07's "warn, never block" behaviour (R2-03). A failed holdings-count read is unknown, never zero, and also holds `Delete key` (SFH-1, SFH2-1). Recorded in 200-REVIEW.md.
