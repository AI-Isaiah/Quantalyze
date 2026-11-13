# Phase 200: MANAGERKEYS - Research

**Researched:** 2026-11-10
**Domain:** Next.js (App Router) + Supabase UI/route consolidation: key feeds list, confirm-before-re-point, one rename place, one add-a-strategy entry, one key-storage sentence
**Confidence:** HIGH on code inventories (all read in this worktree at `8ac20b1db`), MEDIUM on PROD trigger state (migrations read, live `pg_trigger` not read: no Supabase MCP tool in this agent's tool set)

<user_constraints>
## User Constraints (from CONTEXT.md)

All D-01..D-15 are **orchestrator defaults** ("founder may revisit"); they are binding for this plan. Quoted from `200-CONTEXT.md` `<decisions>`:

### Locked Decisions
- **D-01:** Every key, wherever it is listed, shows the strategies it feeds: single-key links (`strategies.api_key_id`) and composite memberships (`strategy_keys`), each naming the strategy and linking to it. A key that feeds nothing says so. A read that fails says it could not check, never "feeds nothing". Reuse or extend the server-side `GET /api/keys/[id]/memberships` pattern so both link kinds come from one ownership-checked read. No migration.
- **D-02:** Keys are not manager-only. This phase shows strategies fed, and does not add allocator-book usage to the list.
- **D-03:** Every control that changes `strategies.api_key_id` for an existing strategy opens a confirmation before it writes. Today that is `Use & Sync` and `Add Key` on `ApiKeyManager` (both through `handleLinkKey`). The planner inventories every other writer and covers each one that re-points an existing strategy; wizard creation of a NEW strategy is not a re-point.
- **D-04:** The confirmation names the strategy, the current key and the new key (key named by its `label` and exchange; planner picks a fallback when `label` is empty). When no key is linked yet it says so in place of the current key. Resync of the current key is not a re-point and needs no confirmation. Copy follows DESIGN.md Voice / microcopy and Error Envelope.
- **D-05:** A test drives today's one-click `Use & Sync` and goes RED because the write happens with no confirmation; green only when the write waits for the confirm. Must be shown to fail (neuter, see RED, restore from byte backup).
- **D-06:** The one key manager is the account-level list on Profile, the existing `Exchanges` tab renamed to say it holds API keys, shown to every role that can hold keys (manager, allocator, both). Add, delete, rotate secret, update MT5 password, permissions and the D-01 feeds list live there. Planner decides how to merge `AllocatorExchangeManager` and `ApiKeyManager` behaviour (allocator-book bits stay for allocator roles). Reversibility: costly.
- **D-07:** The strategy edit page keeps only that strategy's key panel: the current key, Resync, and "Change key..." (pick another account key, then the D-04 confirm). Adding or deleting keys is not offered there; the panel links to the one key manager. Composite and unknown shapes keep today's fail-closed rules (KCS-23).
- **D-08:** The wizard's connect step stays as part of adding a strategy; it is not a second key manager.
- **D-09:** The one rename place is the strategy edit page, using the existing `RenameStrategyDialog` and `PATCH /api/strategies/[id]/name`. `StrategyForm` stops writing `name` in edit mode (the preset dropdown leaves the edit form). `Rename...` on the factsheet header (`FactsheetView`) and on the strategies list (`StrategiesSection`) is removed. The wizard still picks the initial name at creation.
- **D-10:** The name route's private/draft gate (150 D-17) is kept, not widened. On a published or pending strategy the edit page shows the name read-only and says why.
- **D-11:** The rename place states what the public sees, computed by the same code the public surfaces use, never a claim about a codename. The false dialog hint is replaced. Disclosure behaviour is not changed.
- **D-12:** The one flow is the wizard (`WizardClient`). Manager entry point is one `Add a strategy` control on the merged `/strategies` list linking straight to `/strategies/new/wizard`. Duplicate buttons on `/strategies` that start a new strategy are collapsed to the one control. `Resume draft` / `Revise & resubmit` stay. `/strategies/new` stays as a redirect.
- **D-13:** Allocators keep `ContributionWizardOverlay` (route is manager-guarded). It mounts the same `WizardClient`, so it is the same entry point. Every add-a-strategy control uses one label.
- **D-14:** The security explanation lives on `/security` (`#key-handling`). Every in-app surface that describes key storage or encryption renders `KEY_STORAGE_SENTENCE` with `KEY_STORAGE_LINK` instead, including both `AllocatorExchangeManager` "per-user KEK" sites and the `TRUST_ATOMS` "What we store" / "Who can decrypt" atoms in `ConnectKeyStep` and `MultiKeyConnectStep`.
- **D-15:** Form guidance that tells the user what key to paste stays where the form is, but carries no encryption claim. A test fails when an app surface outside `/security` restates encryption detail (KEK, DEK, AES, Fernet, Vault, "per-user") instead of using the shared sentence.

### Claude's Discretion
Key naming fallback when `label` is empty; dialog layout; whether the feeds list loads per key or in one batched read; tab label wording; exact single label for add-a-strategy controls (DESIGN.md Voice); whether factsheet/list `Rename...` controls are removed or become links to the edit page (D-09 default: removed).

### Deferred Ideas (OUT OF SCOPE)
- Making the public name consistent across surfaces (factsheet shows `name`, discovery shows `Strategy #<id>`, `codename` unused).
- Showing allocator-book usage beside each key (D-02).
- Whether a manager may rename a published strategy (would widen 150 D-17).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROUTE-09 | A manager can see which strategies each key feeds, and no one-click control re-points a strategy's key without an explicit confirmation. | Section "Feeds read" (batched route required by the 5/60s limiter), "Writer inventory" (3 browser-side writers, one not named in CONTEXT), "Confirm design" |
| ROUTE-10 | A manager renames a strategy in one place and can see which name is public. | Section "Rename": RLS/trigger answer (no refusal), 3 rename triggers (one not in CONTEXT), public-name helper |
| LEAN-04 | Adding a strategy, managing keys and renaming each have one entry point; the security explanation lives in one place. | Sections "Key manager merge", "Add-a-strategy inventory", "Key-storage census" |
</phase_requirements>

## Summary

The phase is almost entirely UI consolidation on top of code that already exists, and **no migration is needed**. Two findings change the plan's shape versus CONTEXT. (1) `StrategyForm` in edit mode is not only a second name writer: its "Data Source" card carries a full **Connect API Key modal that mints a key AND writes `strategies.api_key_id` straight from the browser** (`handleApiKeySubmit`, KEYLINK-01). That is a third key-adding surface and a second un-confirmed re-point writer, neither named in CONTEXT; D-03/D-07/D-09 all require touching it. (2) A per-key feeds read cannot back a Profile key list: `GET /api/keys/[id]/memberships` is limited to `userActionLimiter = makeLimiter(5, "60 s")` per user, so a list of more than 5 keys would show "could not check" on the rest. The feeds read for the Profile list must be one batched route.

On the open question 1: **no RLS policy or trigger refuses `StrategyForm`'s direct `name` update on a published or pending row.** `strategies_update` is owner-only with no status gate, and the only status trigger blocks the transition INTO `published`. So today a manager can rename a published strategy from the edit form, bypassing the name route's D-17 gate; removing the picker from `StrategyForm` is what makes D-10 real, not the route. (Direct PostgREST by an owner stays possible; closing that needs a migration, which is out of scope. Record it.)

Merging `AllocatorExchangeManager` (1,793 lines + ~5,100 lines of tests) and `ApiKeyManager` (1,973 lines + ~6,500 lines of tests) literally would be the highest-risk work in the repo. It is not required by the goal. D-07 *shrinks* `ApiKeyManager` into the per-strategy key panel, so the practical shape is: `AllocatorExchangeManager` becomes the one account-level manager (it is already account-level, already shares `ApiKeyForm`, `UpdateMt5SecretDialog`, `AllocatorSyncStatus`, `account-share-note`), gains a feeds line per key and a role switch, and `ApiKeyManager` loses Add Key / Delete / Update password and gains the confirm and a link to Profile.

**Primary recommendation:** Seven plans in two waves (see Architecture Patterns): feeds route+helper, key-storage census+copy, rename place, add-a-strategy entry, then (serialized on the shared files) the `ApiKeyManager`/`StrategyForm` confirm+shrink, and the Profile key manager. Use `apiKeyLabelById`/`dataSourceLabel` for the D-04 key naming (it already has an id-tail fallback), the existing `ApiKeyManager.test.tsx` `strategies.update` mock (`lastLinkedKeyId`) as the D-05 RED oracle, and `src/__tests__/public-truth-census.test.tsx` as the template for the D-15 census.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Feeds list (which strategies a key feeds) | API / Backend (ownership-checked admin read) | Browser (render + honest failure state) | `strategy_keys` read must not depend on RLS (RLS filters silently, 167.2-REVIEW-SFH R2-L4); same reason the memberships route exists |
| Confirm before re-point | Browser (modal gates the write) | Database (owner-only RLS + `check_strategy_api_key_ownership` trigger stay as backstop) | D-03 is a control-level rule; server enforcement would need a migration or a new route (out of scope; residual recorded) |
| Rename write | API / Backend (`PATCH /api/strategies/[id]/name` with D-17 gate) | Browser (`RenameStrategyDialog`) | The direct browser `.update({name})` in `StrategyForm` is the defect being removed |
| Public-name preview | Shared lib (pure function next to `displayStrategyName`) | Frontend Server (edit page computes it) | Same code the factsheet/discovery use, so no second claim |
| Key-storage sentence | Shared constant (`status-surface-copy.ts`) | Every client surface renders it | One string, pinned by `status-surface-copy.test.ts` |
| Key manager (add/delete/rotate/permissions) | Browser component on Profile + existing RPC/routes | API routes (`validate-and-encrypt`, `delete_allocator_api_key` RPC) | Unchanged mechanisms; only the host and role gate move |

## Standard Stack

No new packages. Everything is in-repo. **Package Legitimacy Audit: not applicable (no external package installed).**

| Tool | Where | Purpose |
|------|-------|---------|
| vitest (jsdom + node projects) | `vitest.config.ts`, `node_modules/.bin/vitest` present | Targeted tests |
| `@testing-library/react` | used throughout `ApiKeyManager.test.tsx` | Component tests |
| `stripCommentsPreserveLines` | `@/lib/source-scan` | Comment-stripped source census |
| `apiKeyLabelById`, `dataSourceLabel` | `src/lib/api-key-label.ts` | Key naming with fallback |
| `KEY_STORAGE_SENTENCE`, `KEY_STORAGE_LINK` | `src/lib/status-surface-copy.ts` | The one sentence + link |
| `withAuth`, `checkLimit`, `userActionLimiter`, `NO_STORE_HEADERS`, `createAdminClient` | existing route plumbing | New batched feeds route |

**Gates (no build, per rules):** `npx tsc --noEmit -p .`, `npx vitest run <files>`, `npx eslint <files>`. `node_modules/.bin/{vitest,tsc,eslint}` exist [VERIFIED: ls]. Node v25.8.1 [VERIFIED: node --version].

## Architecture Patterns

### System Architecture Diagram

```
 Profile > API keys tab (all roles) ----GET /api/keys/feeds (batched, owner-checked, admin client)----+
   AllocatorExchangeManager (account list)                                                            |
     per key: feeds line  <---- { feeds: { [keyId]: [{strategy_id,name,status,kind}] } } | 5xx -> "could not check"
     Add / Delete / Rotate / MT5 password / permissions (existing mechanisms)                         |
     Delete confirm  <---- same feeds (single-key links get UNLINKED by FK ON DELETE SET NULL)       |
                                                                                                      v
 /strategies/[id]/edit                                                          strategy_keys (composite) + strategies.api_key_id (single)
   Name: read-only if status not in (private,draft) | RenameStrategyDialog -> PATCH /api/strategies/[id]/name (D-17 gate)
         + public-name preview (publicNamePreview(strategy) shared with factsheet/discovery)
   StrategyForm (no name picker, no Data Source/Connect-key card)
   ApiKeyManager (reduced): current key | Resync | "Change key..." -> ConfirmKeyChange modal
         -> only on confirm: strategies.update({api_key_id}) -> /api/keys/sync
         link -> /profile?tab=exchanges (add/delete keys there)

 /strategies: ONE "Add a strategy" control -> /strategies/new/wizard
   empty state, resume/revise cards keep their own wording; allocator surfaces open ContributionWizardOverlay (same WizardClient)
```

### Recommended plan decomposition (planner may adjust)

| Plan | Scope | Reqs | Touches (disjointness) |
|------|-------|------|------------------------|
| 01 FEEDS-API | `GET /api/keys/feeds` batched route + shared read helper + route test; add to the two route allowlists | ROUTE-09 | new route dir, `no-store-coverage.test.ts`, `limiter-ordering.test.ts` |
| 02 KEYSTORAGE | Replace the 4 TRUST_ATOMS bodies and 2 AEM sites; reword `WithdrawalWarningStrip` line; add the D-15 census test | LEAN-04 | `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`, `AllocatorExchangeManager.tsx` (two copy sites only), new test |
| 03 RENAME | `publicNamePreview` helper; edit page name block + read-only state; `StrategyForm` drops name; remove 2 `Rename...` triggers (+ `StrategyTable`'s) and the `StrategiesSection` dialog mount; new dialog hint | ROUTE-10, LEAN-04 | `strategy-display.ts`, `edit/page.tsx`, `StrategyForm.tsx` (name only), `RenameStrategyDialog.tsx`, `FactsheetView.tsx`, `StrategyTable.tsx`, `StrategiesSection.tsx` |
| 04 ADD-ENTRY | One label, one header control, collapse duplicates | LEAN-04 | `strategies/page.tsx`, `Sidebar.tsx`, `StrategiesEmptyState.tsx`, tests |
| 05 CONFIRM | D-05 RED test first; `ConfirmKeyChange` modal; D-07 shrink of `ApiKeyManager`; `StrategyForm` Data Source card removal | ROUTE-09, LEAN-04 | `ApiKeyManager.tsx`, `StrategyForm.tsx` (after 03) |
| 06 PROFILE-KEYS | Tab for all roles + label, feeds line per key, role switch in AEM, delete confirm uses feeds | ROUTE-09, LEAN-04 | `ProfileTabs.tsx`, `profile/page.tsx`, `ExchangesTabContent.tsx`, `AllocatorExchangeManager.tsx` (after 02) |

Serialization rules: 03 before 05 (both edit `StrategyForm.tsx`); 02 before 06 (both edit `AllocatorExchangeManager.tsx`); 01 before 06. Plans 01, 02, 03, 04 are file-disjoint except `StrategyForm` (03 only) and may run in parallel per-plan worktrees. **Phase 196 (ONESTRATEGYPAGE) also edits `FactsheetView.tsx`**, so plan 03's removal there is the likeliest merge conflict [ASSUMED: 196 not yet planned in this worktree; only its goal read].

### Pattern 1: Batched feeds route (answers open question 5)

**What:** `GET /api/keys/feeds` returns every feed for the caller's keys in two reads. Mirror `memberships/route.ts` exactly: `withAuth`, `checkLimit(userActionLimiter, "key-feeds:${user.id}")`, admin client, explicit `.eq("user_id", user.id)` ownership, `NO_STORE_HEADERS`, `captureToSentry` tags, 500 `{ error: "Lookup failed" }` on any read error, owner-coherence tripwire.

**Why a new route and not per-key `[id]/memberships`:** the memberships limiter is `export const userActionLimiter = makeLimiter(5, "60 s");` [VERIFIED: src/lib/ratelimit.ts:97] and the route consumes `key-memberships:${user.id}` per call, so a Profile list reading per key hits 429 from the 6th key and would render "could not check" for those keys. Per-key stays correct for the Delete confirm (one key at a time).

**Shape (recommended):**
```ts
type Feed = { strategy_id: string; name: string | null; status: string | null; kind: "single" | "composite" };
// 200: { feeds: Record<keyId, Feed[]> }   (every owned key id present, [] when it feeds nothing)
// read: 1) api_keys where user_id = user.id -> ids
//       2) strategy_keys select("api_key_id, strategy_id, strategies(name,status,user_id)") .in("api_key_id", ids)
//       3) strategies select("id,name,status") .eq("user_id", user.id) .in("api_key_id", ids)   // single-key links
```
The existing `[id]/memberships` response drops the strategy id (it maps rows to `{ name, status }` only) [VERIFIED: memberships/route.ts, the `memberships: Membership[]` mapping with `type Membership = { name: string | null; status: string | null }`], so it **cannot** produce the "linking to it" D-01 requires; extend it additively too (`feeds` field with `strategy_id` and `kind`, leave `memberships` untouched so `deleteCompositeWarning` is unchanged) so the Delete confirm can name single-key strategies.

**Both censuses must learn the route:** `src/__tests__/no-store-coverage.test.ts` lists `"keys/[id]/memberships/route.ts"` in its allowlist and `src/lib/api/limiter-ordering.test.ts` lists it in its NO_INPUT bucket (both read this session, lines 126 and 182). A new route file not added there fails those gates, and their vacuity counts ("37 -> 38" lineage comment) must be bumped.

### Pattern 2: Confirm-before-write (D-03/D-04/D-05)

Gate at the **click**, not inside `handleLinkKey`: `Use & Sync` on a non-current key and `Change key...` open `ConfirmKeyChangeDialog`; its Confirm calls the existing `handleSyncTrades(keyId)` unchanged (which calls `handleLinkKey` then the enqueue). `Resync` of the current key keeps calling `handleSyncTrades` directly (D-04: not a re-point). Because `handleSyncTrades` always runs `handleLinkKey(keyId)` (a no-op write when the key is already current), do **not** put the gate in `handleLinkKey`.

Copy: name the strategy (`strategy.name`, pass it as a prop from the edit page; it is not a prop today: `ApiKeyManagerProps` has `strategyId, currentKeyId, defaultExchange, keyShape, compositeMemberKeyIds`), current key and new key via `apiKeyLabelById(keys).get(id)`, which yields `"<Exchange> - <label>"` or `"<Exchange> - ••••<last4 of id>"` when `label` is empty [VERIFIED: src/lib/api-key-label.ts, `m.set(k.id, `${exchange} — ${nickname ?? maskedTail}`)`]. No linked key: say "no key is linked yet". Dialog uses the existing `Modal` (`@/components/ui/Modal`). **Do not call `buildEnvelope(` in the new dialog file**: `src/lib/dialog-envelope.invariant.test.ts` defines a dashboard envelope dialog as a `.tsx` under `src/components` or `src/app/(dashboard)` that both calls `buildEnvelope(` and mounts `<Modal`, and fails by name if it is not on a roster. The link failure already surfaces through `handleSyncTrades`' catch (`syncError`), so the dialog needs no envelope.

### Anti-Patterns to Avoid
- **Putting the gate in `handleLinkKey`:** it also runs for Resync of the current key, so Resync would prompt.
- **Per-key feeds fetch on the Profile list:** limiter exhaustion (above).
- **Reading `strategy_keys` in the browser through RLS:** RLS filters silently; this was the 167.2 R2-L4 defect (documented in the `readKeyCompositeMemberships` docblock).
- **Showing a failed feeds read as "feeds nothing":** H-0395 class; the honest "could not check" state must exist for both the list and the Delete confirm.
- **Citing line numbers in docs/comments** for moving code: CLAUDE.md `[164.7-CITATION-DRIFT-01]` rule; cite by symbol.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Key display name with empty-label fallback | New label formatter | `apiKeyLabelById` / `dataSourceLabel` (`src/lib/api-key-label.ts`) | Already `Exchange - nickname or masked tail`; used by factsheet/allocations |
| Name validation, 80-char cap, error mapping | New rename form | `RenameStrategyDialog` + `PATCH /api/strategies/[id]/name` | Cap from `MAGNITUDE_CAPS.MAX_NAME_CHARS`; D-17 gate server-side |
| Public name resolution | Re-deriving codename/name logic in the edit page | One pure helper beside `displayStrategyName` (see Rename) | Same code the public surfaces use (D-11) |
| Key-storage sentence | New copy | `KEY_STORAGE_SENTENCE` + `KEY_STORAGE_LINK` | Pinned by `status-surface-copy.test.ts`; true per 192 evidence |
| Comment-stripped source scan | New scanner | `stripCommentsPreserveLines` + `walk/population/findHits` pattern from `public-truth-census.test.tsx` | Includes anti-vacuity and planted-line matcher tests |
| Composite membership read | Browser RLS read | Server route with admin client + owner equality | RLS filters silently |

**Key insight:** every mechanism this phase needs already exists and is already tested; the risk is in call-site churn (tests that pin current labels and behaviour), not in new engineering.

## Answers to the open questions CONTEXT hands over

### Q1. Does RLS or a trigger refuse `StrategyForm`'s direct name update on a published/pending row? **No.**
- RLS: `CREATE POLICY strategies_update ON strategies FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());` [VERIFIED: supabase/migrations/20260410225610_sec005_follow_ups.sql:103-106]. No status predicate.
- Column grants: the only strategies grant migration read narrows **anon** (`REVOKE SELECT, INSERT, UPDATE and DELETE on the TABLE from anon`) [VERIFIED: supabase/migrations/20261022120000_strategies_anon_api_key_id_revoke.sql:30]; nothing restricts `authenticated` UPDATE on `name`.
- Triggers on `strategies` found by migration grep (BEFORE INSERT/UPDATE): `check_strategy_api_key_ownership_trigger` (`BEFORE INSERT OR UPDATE OF api_key_id`, cross-tenant check only), `guard_wizard_draft_updates_trigger` (returns early unless `OLD.source <> 'wizard' OR OLD.status <> 'draft'` is false; blocks only flipping a wizard draft out of draft), `strategies_reject_sentinel` (rejects names starting with the `[deleted` sentinel), `guard_strategies_publish_transition_trigger` (`IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published')`, so an already-published row edit passes), `trg_strategies_team_review_mark_guard` (`BEFORE UPDATE OF capital_ownership`) [VERIFIED: the migration files named, lines read this session]. The publish-guard file says it itself: "an already-published row being edited (OLD.status = 'published') is untouched, so owners/admins can still update other columns on a published strategy".
- Therefore the edit form's `supabase.from("strategies").update(payload)` with `name` succeeds on published/pending rows. D-09's removal of the picker from `StrategyForm` is what enforces D-10 in the UI. PROD's live trigger set was not read [ASSUMED: PROD matches migrations; the orchestrator can confirm with one `pg_trigger` read after the marker query].
- Residual (record, do not fix here): an owner can still PATCH `name` or `api_key_id` through raw PostgREST on a published row. Closing it needs a migration (out of scope; no founder ask).

### Q2. Writers of `strategies.api_key_id` on an EXISTING strategy
Browser-side `.update(...)` on `strategies` found in `src` (non-test): `ApiKeyManager.tsx` (`.update({ api_key_id: keyId })`), `StrategyForm.tsx` (`.update({ api_key_id: newKeyId })` and `.update(payload)`), `StrategyActions.tsx` (status only), plus server routes that write `asset_class`, `capital_ownership`, `name`, review fields, csv-finalize payload [VERIFIED: grep of `from("strategies")` + `.update(`].

| Writer | Re-points an existing strategy? | D-03 action |
|--------|-------------------------------|-------------|
| `ApiKeyManager.handleLinkKey` via `Use & Sync` (non-current key) | **Yes** | Confirm (Pattern 2) |
| `ApiKeyManager` `Add Key` -> `handleAddKey` -> `void handleSyncTrades(newKeyId)` -> `handleLinkKey` | **Yes** (links the new key) | Goes away: D-07 removes Add Key from the edit page |
| `ApiKeyManager` `Resync` on current key (`handleSyncTrades(currentKeyId)` -> `handleLinkKey`) | No (same key, no-op write) | No confirm (D-04) |
| **`StrategyForm.handleApiKeySubmit` in `mode === "edit"`** (mint key through `/api/keys/validate-and-encrypt`, then `.update({ api_key_id: newKeyId })`) | **Yes, un-confirmed, NOT in CONTEXT** | Remove the Data Source card + Connect modal from the edit form (also a third key-adding surface, violating D-07); keep it only for `mode="create"` if the create path is kept |
| `StrategyForm.handleSubmit` create INSERT with `api_key_id: connectedKeyId` | No (new row); and `mode="create"` is **unmounted**: the only production mount is `<StrategyForm strategy={strategy} mode="edit" />` in `edit/page.tsx`; `/strategies/new` redirects | No action; see decision below |
| `create-with-key` route (`p_api_key_id: adminKey.id` RPC, draft reuse of `existingDraft.api_key_id`) | No: creates/reuses a NEW wizard draft | None (wizard creation) |
| `composite/add-key`, `composite/set-members`, `composite/members` | No: write `strategy_keys` on a composite draft whose `api_key_id` is NULL | None |
| `finalize-wizard`, `keys/sync`, `admin/strategy-review`, `allocator/*` | Read `api_key_id`, do not re-point | None |
| DB: `strategies.api_key_id UUID REFERENCES api_keys ON DELETE SET NULL` [VERIFIED: supabase/migrations/20260405061911_initial_schema.sql:51] | **Deleting a key silently un-links every single-key strategy** | Delete confirm must name them (feeds data) |

Decision for `StrategyForm` (planner, Rule 3 minimal): gate the Data Source card and modal behind `mode === "create"` (they stay for the dead create path and for their tests) rather than deleting create mode. The alternative (delete create mode, its modal and `StrategyForm.credential-input.test.tsx`) is cleaner but retires ~1,000 lines of tests and is not needed by any success criterion; record it as optional cleanup. Whichever is chosen: `src/__tests__/display-sign-single-source.test.ts` pins `"src/components/strategy/StrategyForm.tsx": { R5: { count: 2, ... "The form error and API error lines, sentences." } }` [VERIFIED: lines 1052-1056], so removing the `apiError` line changes a pinned count; and `src/lib/wizardErrors.roster-render.test.tsx` lists `StrategyForm.tsx` in a roster (line 1150 hit). Re-run both after the edit.

### Q3. In-app key-storage / encryption restatements (rendered, non-comment, non-test)
Grep terms `KEK|DEK|AES|Fernet|Vault|Envelope encryption|per-user|encrypt*|ciphertext|at rest`, excluding comments, tests, `/api/`, crypto libs:

| Site | Text (verbatim fragment) | Action |
|------|-------------------------|--------|
| `AllocatorExchangeManager.tsx` ~1393-1394 | "Keys are validated against the exchange and encrypted with a per-user KEK before storage." | Replace with `KEY_STORAGE_SENTENCE` + link; keep the "Trading and withdrawal keys are ..." guidance sentence without encryption |
| `AllocatorExchangeManager.tsx` ~1643-1644 | "...confirms it's read-only, and encrypts it with a per-user KEK before storing." | Same |
| `ConnectKeyStep.tsx` `TRUST_ATOMS` "What we store" | "Your API key and secret are encrypted with AES-256-GCM envelope encryption before they ever hit the database. The KEK lives in Supabase Vault." | Body -> `KEY_STORAGE_SENTENCE` |
| `ConnectKeyStep.tsx` `TRUST_ATOMS` "Who can decrypt" | "Only the Railway analytics service can decrypt the stored ciphertext to fetch your trade history. The web tier has no decryption path." | Drop the atom (the shared sentence already says "only our analytics service can decrypt it") or reduce to the link |
| `MultiKeyConnectStep.tsx` `TRUST_ATOMS` (same two atoms) | same | same |
| `WithdrawalWarningStrip.tsx` | "scopes are rejected before encryption." | Reword to drop "encryption" (D-15: guidance carries no encryption claim) |
| `wizardErrors.ts` (unreadable-key failure copy) | "We hold your key encrypted, and our stored copy of this one can no longer be read back" | Failure explanation, not a storage description; leave unless the census term list includes bare "encrypted" (recommend it does NOT) |
| `for-quants/page.tsx` trust chip "Envelope encryption" and card title "Envelope encryption at rest" (body already `KEY_STORAGE_SENTENCE`) | label restates a mechanism name | Public page, 192 territory; **flag to planner**: either retitle in plan 02 or allowlist with a reason. The 192 census `BANNED` list does not include "Envelope encryption". |
| `legal/privacy/page.tsx` "Keys are encrypted at rest" | generic, public legal | Leave (no mechanism named); not in the term list |

`/security/page.tsx` is the one allowed home (Fernet/DEK/KEK text, lines ~146-153, ~297-300). `status-surface-copy.ts` owns the sentence. `gdpr-export*`, `constants.ts`, `analytics-schemas.ts` mention `*_encrypted` column names only (not UI copy).

No existing test pins any of the replaced strings (grep of `src/**/*.test.*` for "Who can decrypt|What we store|per-user KEK|encrypts it" returned nothing), so the copy swap has no test churn. `ConnectKeyStep` renders the atoms through `ContactPointerText` and `MultiKeyConnectStep` maps `TRUST_ATOMS` in a `<dl>`; the link must render as an anchor, so the atom body needs a small render change (a `link?` field per atom as `for-quants` already does with `{ body: KEY_STORAGE_SENTENCE, link: KEY_STORAGE_LINK }`).

**D-15 census (recommended shape):** new `src/__tests__/key-storage-census.test.ts` (node env, `// @vitest-environment node`) cloned from `public-truth-census.test.tsx`: roots `src/app/(dashboard)`, `src/components`, `src/lib` UI copy modules; exclude tests, `/api/`, `src/app/(marketing)/security`, `src/lib/status-surface-copy.ts`, crypto/server libs; scan comment-stripped text, whitespace-collapsed (so wrapped JSX lines match), regex `\b(KEK|DEK|AES|Fernet|Vault|per-user)\b|envelope encryption` (case-insensitive for the last). Include: (a) anti-vacuity (population non-empty and contains `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`, `AllocatorExchangeManager.tsx`), (b) planted-line matcher test proving each term fires, (c) an allowlist with a mandatory reason string and a count pin, empty if possible. RED proof: restore one of the two AEM "per-user KEK" lines from a byte backup and see the census name `file:line`.

### Q4. Merging the two key managers (D-06) and what the edit page keeps (D-07)
Measured: `ApiKeyManager.tsx` 1,973 lines; `AllocatorExchangeManager.tsx` 1,793 lines. Tests: `ApiKeyManager.test.tsx` 5,246 + `ApiKeyManager.poll.test.tsx` 1,260; AEM `.test.tsx` 2,990 + liveness 561 + departed-history 452 + native-balance 285 + `AllocatorSyncStatus.test.tsx` 845 [VERIFIED: wc -l].

Both already import `ApiKeyForm`, `UpdateMt5SecretDialog`, `AllocatorSyncStatus`, `API_KEY_USER_COLUMNS`, `accountShareNote` [VERIFIED: import lists]. They differ in mechanism:
- `ApiKeyManager` (strategy-scoped): reads all `api_keys` via supabase client, `Use & Sync`/`Resync` via `/api/keys/sync`, hard `api_keys` DELETE with composite warning, `Update password`, link controls gated by `keyShape` (KCS-23).
- `AllocatorExchangeManager` (account-scoped): add via `/api/keys/validate-and-encrypt` persist, then awaits `/api/allocator/holdings/sync`; delete via RPC `delete_allocator_api_key` (`p_cascade_holdings`), `disconnect_allocator_api_key`, history inclusion, balances/equity, sync pill.

**Recommendation (answers "how to merge"): do not merge the files.** Make AEM the one manager and shrink `ApiKeyManager` to the strategy panel:
1. `profile/page.tsx`: `isAllocator` currently gates both the mandate and exchanges loads and `ProfileTabs` entry `{ key: "exchanges", allocatorOnly: true }`. Roles are `["manager", "allocator", "both"]` [VERIFIED: src/lib/closed-sets.ts:1198], so "every role that can hold keys" is every role: drop `allocatorOnly` on `exchanges`, load `getUserApiKeys` unconditionally, keep `mandate`/`security` allocator-only. Keep the tab **key** `exchanges` (8 inbound `/profile?tab=exchanges` links: OptimizerPanel, EmptyState x2, AddAllocationFlow, OnboardingBanner, EquityHistoryRebuilding, ScenarioComposer, plus the allocations page comment) and change only the **label** to "API keys". `ProfileTabs.test.tsx` Test 5 pins the label `"Exchanges"` and tab order; update it, and add the manager-role assertion (tab present for `isAllocator={false}` is a signature change: introduce a `canManageKeys` prop or compute it from `profile.role`).
2. A manager-only user adding a key through AEM triggers `fetch("/api/allocator/holdings/sync")` and holdings/portfolio copy that are allocator semantics. Add a prop (e.g. `holdingsSync: boolean = isAllocator`) so manager-only skips the post-add holdings sync and the "Active Allocation" subtitle (`ExchangesTabContent` copy and `activePortfolio` card render only for allocator roles). Whether that sync route is role-gated server-side was **not** established [ASSUMED: no role gate; the planner should read `src/app/api/allocator/holdings/sync/route.ts` and `request_allocator_holdings_sync` before deciding].
3. Delete: AEM's RPC delete does not warn about strategies the key feeds; add the feeds-based warning (single-key links get `ON DELETE SET NULL`; composite members cascade). Keep the existing delete copy `DELETE_REMOVES_HISTORY`.
4. Feeds line per key in AEM, from the batched route; failure -> "Could not check which strategies this key feeds."
5. `ApiKeyManager` shrink (D-07): remove `Add Key` button and form, `handleAddKey`, Delete flow and its membership read, `Update password`; keep the key list filtered to the current key plus the picker for `Change key...`, `Resync`, `SyncProgress`, composite fail-closed behaviour. Add a link "Add or remove keys" -> `/profile?tab=exchanges`. This deletes far more test surface than it adds: ~2,000 lines of `ApiKeyManager.test.tsx` pin `Add Key`, Delete and `Update password` behaviour (describe blocks at "Update password affordance", "160-02 conversion: server persists", "SEAMUX-05", KCS-23 `LINK_BUTTON_NAMES = [/^Resync$/, /^Use & Sync$/, /Add Key/]`). Plan 05 must list every such block and either delete it (behaviour moved) or re-point it at AEM; this is the largest estimation risk in the phase.

Reversibility is "costly" per D-06; staging this as plans 05 then 06 lets 05 ship (confirm + shrink with the Profile link) before 06 changes the Profile tab, but the Profile tab must exist for managers before 05 removes Add Key, or a manager has no way to add a key. **Order: 06 before the removal half of 05**, i.e. split 05 into 05a (confirm + RED test, no removals) and 05b (shrink), with 05b depending on 06.

### Q5. Feeds read (D-01)
See Pattern 1. Batched `GET /api/keys/feeds` for lists; additive `feeds` on `[id]/memberships` for the Delete confirm. Do not read `strategies.api_key_id` through the browser client for a list: RLS on `strategies` SELECT also filters, and the feeds list has the same silent-empty hazard.

### Q6. Add-a-strategy entry points (D-12/D-13) and tests that pin them
`/strategies` (manager) currently has: header `<Link href="/strategies/new"><Button>New Strategy</Button>`, resume/revise card -> `/strategies/new/wizard` (stays), empty-state "Resume your draft" -> `/strategies/new/wizard` (stays, continues a draft), empty-state `<Link href="/strategies/new"><Button>Create your first strategy</Button>` [VERIFIED: strategies/page.tsx]. Allocator: `StrategiesEmptyState` "Add a Strategy" button opening `ContributionWizardOverlay`; sidebar/mobile nav action `label: "Add a Strategy"` / `action: "add-strategy"` [VERIFIED: Sidebar.tsx]. `/strategies/new/page.tsx` redirects (forwards `?source=csv`). Other links already go straight to the wizard: `for-quants` `LOGGED_IN_CTA_HREF = "/strategies/new/wizard"`, `DegradeLine`, `CsvStrategyEditNote`, wizard CSV switches.

Collapse: the empty-state "Create your first strategy" is a *second* start-a-new-strategy button on a page whose header already has one. D-12 says collapse duplicates to the one control; recommended: manager empty state renders no create button of its own (text "No strategies yet. Add a strategy above." or the single control is rendered in the page header regardless of rows, which it already is: header `actions` is gated only on `isManager`). Point the header control straight at `/strategies/new/wizard`.

**Label:** DESIGN.md requires "Declarative, sentence-case captions" [VERIFIED: DESIGN.md:437] and the overlay's own title and aria-label already read "Add a strategy" [VERIFIED: ContributionWizardOverlay.tsx `aria-label="Add a strategy"`]. Recommend `Add a strategy` everywhere (Rule 7: the title-case `Add a Strategy` in Sidebar/MobileNav/StrategiesEmptyState and `New Strategy` contradict DESIGN.md; surface it in the plan, do not blend). Test churn if adopted (all verified by grep): `page.merged.test.tsx` lines 401, 412, 416, 433, 721, 786, 787, 793, 804, 805, 881; `page.wizard-draft-banner.test.tsx` 285, 305; `page.key-pill.test.tsx` 1800; `Sidebar.test.tsx` ~14 sites; `DashboardChrome.test.tsx` 369-403; `MobileNav.test.tsx` 143-299 (including a regexp `/^(My allocation|Risk|Bridge|Add a Strategy|Profile)$/` at line 299). `CompareAddStrategy` "Add strategy" adds an *existing* strategy to a comparison; it is not a creation entry point, exclude it. `src/__tests__/degrade-warning-scan.test.ts` references `StrategiesEmptyState` (data-degrade-ids `strategies.empty`, `strategies.empty-allocator`); keep those ids when touching the empty state.

### Q7. Public-name preview (D-11)
Code in use: `displayStrategyName(strategy)` returns `codename` if set, else `name` only when `disclosure_tier === "institutional"`, else `` `Strategy #${strategy.id.slice(0, 8)}` `` [VERIFIED: src/lib/strategy-display.ts:20-29]. Factsheet H1 is `payload.strategyName`, built as `strategyName: strategy.name` (`build-payload.ts`, several sites) and the factsheet page title uses `data?.name ?? data?.codename ?? displayStrategyName(...)` [VERIFIED: v2/page.tsx:339 hit]. Browse routes `name` through `displayStrategyName` [VERIFIED: browse/route.ts hit].

Recommended: add a pure `publicNamePreview(strategy)` in `src/lib/strategy-display.ts` returning `{ factsheet: string; discovery: string }` where `factsheet = strategy.name ?? strategy.codename ?? displayStrategyName(strategy)` (the same order the factsheet title uses) and `discovery = displayStrategyName(strategy)`; unit-test it for codename set, institutional, exploratory with `codename` null (today's PROD reality: `Strategy #<8>`). The edit page already loads the full row (`select("*")`) so `codename` and `disclosure_tier` are present. Copy states facts, never a codename claim: "A shared factsheet shows <name>. Other signed-in viewers see <discovery> in discovery." and, for non-published rows, whether the factsheet is public at all is outside this phase (192 D-04: public by link); say only what is true for the status. `RenameStrategyDialog`'s hint `hint="Only you see this name. Public surfaces keep showing the codename."` [VERIFIED: RenameStrategyDialog.tsx:215] is replaced; the dialog needs a `publicNote?: string` prop (or the hint passed in) so it no longer hard-codes a disclosure claim.

Rename triggers actually present (three, CONTEXT names two): `FactsheetView.tsx` (owner arm: `renameTarget` button `Rename...` plus `<RenameStrategyDialog>`), `StrategyTable.tsx` (`onRename && isRenameable` button `Rename...`), mounted via `StrategiesSection.tsx` (`<RenameStrategyDialog ... currentName={renameTarget.name}`). **`StrategyTable`'s trigger is the one not named in CONTEXT**; D-09 "on the strategies list" covers it. Removing the factsheet button leaves the `renameTarget ? ... : ...` ternary in `FactsheetView` with an unused arm; remove it and the `renameOpen` state, and re-run `FactsheetView*.test.tsx` and `focus-ring-clipproof.test.tsx` (the factsheet comment cites the focus-ring pin on that button). On the edit page, name block: status `private`/`draft` -> editable (opens `RenameStrategyDialog`); any other status -> read-only text plus the reason (D-10 wording: "A name is reviewed by an admin before publication, so it is fixed here.").

### Q8. Test strategy
- **D-05 RED test.** In `ApiKeyManager.test.tsx` the supabase client mock records `strategies.update({api_key_id})` into `strategiesUpdateMock` and `lastLinkedKeyId` [VERIFIED: the `update: (vals) => { const queued = strategiesUpdateMock({ table, vals }); ... lastLinkedKeyId = ... }` block]. Test: render with `currentKeyId="key-a"`, two keys, click `Use & Sync` on `key-b` (helper `cardButton("key-k", "Use & Sync")` exists), assert **before any confirm** `strategiesUpdateMock` not called and a dialog names the strategy, "key-a" label and "key-b" label; then click Confirm and assert the update was called once with `{ api_key_id: "key-b" }`. At HEAD the first assertion fails (write is immediate): that is the required RED. Also assert Cancel writes nothing, Resync of the current key prompts nothing, and "no key linked" copy for `currentKeyId=null`.
- **Neuter-see-RED-restore (rules):** back up bytes (`cp src/components/strategy/ApiKeyManager.tsx <scratchpad>/ApiKeyManager.tsx.bak`), neuter the gate (make the click call `handleSyncTrades` directly), run the one test file, record the RED (test name + assertion), restore with `cp`. Same for: the census (restore a "per-user KEK" line), the feeds route (drop the `.eq("user_id", user.id)` ownership equality; the route test's cross-tenant case must go RED), the name read-only state (render the editable control on `published`).
- Existing tests that click `Use & Sync` and expect the link to follow: `ApiKeyManager.test.tsx` lines ~3993 (`CR01-OTHER-KEY-REFUSED`) and ~4660 (add-in-flight), ~1869/1993/5070 (button presence only). Add a `confirmUseAndSync(keyId)` helper that clicks the card button then the dialog's Confirm, and use it at the two behavioural sites. `ApiKeyManager.poll.test.tsx` has no `Use & Sync` clicks (grep).
- Route tests follow `src/app/api/keys/[id]/memberships/route.test.ts` (14 `it(` cases; `STATE.reads` log asserting the admin client does the read, `STATE.ownershipFilters` asserting the owner equality, `captured` Sentry tags).
- Tests that pin `StrategyForm` name behaviour (to be rewritten, not deleted blind): `StrategyForm.test.tsx` describe "164.6.6.3.1 item 1: own name kept, no rename on unrelated save" (cases at ~609-680). New assertions: edit-mode payload **never** contains `name`; no "Strategy Name" select in edit mode; create mode (if kept) still names the strategy.

## Common Pitfalls

### Pitfall 1: Gate in the wrong layer
**What goes wrong:** gating inside `handleLinkKey` prompts on Resync (it writes the same key every time). **Avoid:** gate at the control, only when `key.id !== currentKeyId`. **Warning sign:** a Resync test starts needing a Confirm click.

### Pitfall 2: Limiter exhaustion looks like "feeds nothing"
5 requests/60 s/user [VERIFIED: ratelimit.ts:97]. A per-key list read fails closed for key 6+. **Avoid:** batched route; assert in the route test that one call serves N keys.

### Pitfall 3: Removing Add Key before the Profile manager exists for managers
Managers would have no way to add a key outside the wizard. **Avoid:** plan order 06 before the removal half of 05.

### Pitfall 4: Pinned counts and rosters in unrelated tests
`display-sign-single-source.test.ts` (`StrategyForm.tsx` R5 count 2), `wizardErrors.roster-render.test.tsx` (lists `StrategyForm.tsx`), `no-store-coverage.test.ts` and `limiter-ordering.test.ts` (route allowlists with vacuity counts), `dialog-envelope.invariant.test.ts` (any new `<Modal` file that calls `buildEnvelope(`), `degrade-warning-scan.test.ts` (degrade ids on the empty states). **Avoid:** after each plan run these five files explicitly; CLAUDE.md "a new ... arm moves several censuses: grep them all".

### Pitfall 5: Comment-only citations rot
Docblocks in the touched files cite line numbers of files that move (the name route cites `visibility.test.ts:87-134`). **Avoid:** cite by symbol in any new comment.

### Pitfall 6: `src/lib/visibility.test.ts` sweep on the published-status filter
The name route comment: any raw equality filter on the published status is swept repo-wide and "must route through withPublishedOnly()". The read-only branch on the edit page must test `status` membership with an `in`-style check against `["private","draft"]` (as the route does), not `status !== "published"`/`=== "published"` literals in a Supabase filter. A plain JS comparison on a fetched row is not a filter, but confirm by running `src/lib/visibility.test.ts` after plan 03.

### Pitfall 7: Phase 196 overlap
Plan 03 removes the factsheet `Rename...` button; 196 reshapes the same file. Land 03 early or rebase deliberately.

## Code Examples

### Feeds read shape (server, mirrors the existing route)
```ts
// Source: pattern of src/app/api/keys/[id]/memberships/route.ts (read this session)
const { data: keyRows, error: keyErr } = await admin
  .from("api_keys").select("id").eq("user_id", user.id);
// strategy_keys side (composite):
await admin.from("strategy_keys")
  .select("api_key_id, strategy_id, strategies ( name, status, user_id )")
  .in("api_key_id", ids);
// single-key side:
await admin.from("strategies")
  .select("id, name, status")
  .eq("user_id", user.id).in("api_key_id", ids);
// any error / non-array -> 500 { error: "Lookup failed" } + captureToSentry tag stage
```

### Confirm gate at the control
```tsx
// Source: design for ApiKeyManager.tsx (not yet written). `labels = apiKeyLabelById(keys)`.
const [pendingChange, setPendingChange] = useState<string | null>(null);
// non-current card:  onClick={() => setPendingChange(key.id)}
// current card:      onClick={() => handleSyncTrades(key.id)}        // Resync, no confirm
// <ConfirmKeyChangeDialog
//    strategyName={strategyName}
//    currentLabel={currentKeyId ? labels.get(currentKeyId) ?? null : null}  // null => "no key is linked yet"
//    nextLabel={labels.get(pendingChange)}
//    onConfirm={() => { const id = pendingChange; setPendingChange(null); void handleSyncTrades(id); }}
//    onCancel={() => setPendingChange(null)} />
```

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| 192: `AES-256-GCM`/`Supabase Vault` copy in trust atoms | `/security`: Fernet, per-row DEK wrapped by a KEK held by the analytics service; `KEY_STORAGE_SENTENCE` | In-app atoms contradict the public account today; the 192 census scans only marketing roots and misses them |
| Rename = preset codename dropdown (`STRATEGY_NAMES`) | Free-text name via `PATCH /api/strategies/[id]/name` (150) | The edit form still writes the preset path directly |

## Runtime State Inventory

Not a rename/refactor/migration of identifiers: no stored data, service config, OS state, secrets or build artifacts embed a string being renamed. **None - verified by:** the phase changes labels, controls and one new read route; `?tab=exchanges` keys and `api_keys`/`strategies` schema are unchanged (tab key kept deliberately).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PROD's live `strategies` triggers/policies match the migration files (no refusal of a name update on published rows) | Q1 | If PROD has an extra trigger the picker removal is still correct, only the "bypass" characterisation weakens |
| A2 | `/api/allocator/holdings/sync` / `request_allocator_holdings_sync` is not role-gated, so a manager-only add via AEM would enqueue allocator holdings ingestion | Q4 point 2 | If gated, the manager add path needs no `holdingsSync` switch; if not gated, skipping it is a behaviour decision the founder may want |
| A3 | Phase 196 will edit `FactsheetView.tsx` and conflict with plan 03 | Pitfall 7 | Only merge friction |
| A4 | The "Teams with verified API data get 3x more allocator interviews" claim in `StrategyForm`'s Data Source card is unsubstantiated marketing; removing the card (edit mode) retires it | Q2 | None; flag only if create mode is kept |
| A5 | `"Add a strategy"` sentence case is preferred over keeping the existing title-case `Add a Strategy` | Q6 | ~30 test line edits either way for the manager labels; wrong choice costs only the extra Sidebar/MobileNav/DashboardChrome edits |

## Open Questions

1. **Does the founder want the manager add-a-key path to skip the allocator holdings sync (A2)?**
   - Known: AEM's add awaits `/api/allocator/holdings/sync`. Unclear: whether a manager's key should create allocator holdings.
   - Recommendation: default to skipping for manager-only (prop), record it in the plan as an orchestrator default.
2. **`for-quants` "Envelope encryption" chip/title (public, 192 domain):** retitle in plan 02 (recommended, one string) or allowlist with a reason in the census.
3. **Delete create mode in `StrategyForm`?** Recommend no (Rule 3); gate the Data Source card to create mode only.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | vitest/tsc | yes | v25.8.1 | - |
| vitest / tsc / eslint binaries | all gates | yes (`node_modules/.bin`, symlinked) | - | - |
| Supabase MCP (PROD read) | A1 confirmation | not in this agent's toolset | - | Orchestrator runs marker query then a `pg_trigger` read; otherwise A1 stays `[ASSUMED]` |
| Local Supabase stack / Docker / build / dev server / playwright | - | not allowed by phase rules | - | Not needed: all gates are unit tests |

Disk: 9.8 GiB free at research time [VERIFIED: df -h /].

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (jsdom default project + node project), `@testing-library/react` |
| Config file | `vitest.config.ts` (`setupFiles: ["src/test-setup.ts"]`) |
| Quick run command | `npx vitest run <file>` (targeted only; no full-suite runs on this disk-constrained host) |
| Full suite command | `npx vitest run` (CI only) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROUTE-09 | `Use & Sync` writes nothing until confirm; confirm names strategy + both keys; Resync prompts nothing; no-key wording | component | `npx vitest run src/components/strategy/ApiKeyManager.test.tsx -t "confirm"` | extend existing (Wave 0: write RED first) |
| ROUTE-09 | Batched feeds route: owner equality, single+composite, 500 on any read error, one call serves N keys | route unit | `npx vitest run src/app/api/keys/feeds/route.test.ts` | new (Wave 0) |
| ROUTE-09 | Profile list: feeds line per key, "could not check" on failure never "feeds nothing" | component | `npx vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx -t "feeds"` | extend existing |
| ROUTE-09 | Delete confirm names single-key strategies it will unlink | component | same file `-t "delete"` | extend existing |
| ROUTE-10 | Edit-mode payload never contains `name`; no "Strategy Name" select | component | `npx vitest run src/components/strategy/StrategyForm.test.tsx` | rewrite describe at ~609 |
| ROUTE-10 | Edit page: private/draft editable via dialog; other statuses read-only with reason; public-name preview rendered | page/component | `npx vitest run "src/app/(dashboard)/strategies/[id]/edit/page.test.tsx"` | extend existing (StrategyForm is mocked there) |
| ROUTE-10 | `publicNamePreview` for codename set / institutional / exploratory-null-codename | unit | `npx vitest run src/lib/strategy-display.test.ts` | extend existing (file exists) |
| ROUTE-10 | No `Rename...` on factsheet/list; dialog hint is no longer the codename claim | component | `npx vitest run src/components/strategy/StrategyTable.test.tsx "src/app/factsheet/[id]/v2"` (targeted files) | update existing |
| LEAN-04 | One add-a-strategy label/control on `/strategies`; no second create button | page | `npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx"` | update existing |
| LEAN-04 | No app surface outside `/security` restates KEK/DEK/AES/Fernet/Vault/per-user | node census | `npx vitest run src/__tests__/key-storage-census.test.ts` | new (Wave 0) |
| LEAN-04 | Profile tab present for manager/allocator/both, label "API keys", `?tab=exchanges` still resolves | component | `npx vitest run src/components/auth/ProfileTabs.test.tsx` | update existing (Test 5 pins "Exchanges") |

### Sampling Rate
- **Per task commit:** the single targeted test file(s) for that task, plus `npx eslint <touched files>`.
- **Per wave merge:** `npx tsc --noEmit -p .` and the pinned-census set: `display-sign-single-source`, `wizardErrors.roster-render`, `no-store-coverage`, `limiter-ordering`, `dialog-envelope.invariant`, `degrade-warning-scan`, `src/lib/visibility.test.ts`, `status-surface-copy.test.ts`.
- **Phase gate:** all of the above green before `/gsd-verify-work`; every user-facing/data-integrity gate shown RED (neuter, restore from byte backup in the scratchpad, never git checkout/stash).

### Wave 0 Gaps
- [ ] `src/app/api/keys/feeds/route.test.ts` - ROUTE-09
- [ ] `src/__tests__/key-storage-census.test.ts` - LEAN-04
- [ ] RED-first `ApiKeyManager` confirm test (D-05) before any production edit
- [ ] `src/lib/strategy-display.test.ts` case for `publicNamePreview` (file exists, extend it)

## Security Domain

`security_enforcement` is not set to false (no key found in `.planning/config.json` by grep), so this section applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | `withAuth` on the new route |
| V3 Session Management | no | - |
| V4 Access Control | yes | Explicit `.eq("user_id", user.id)` ownership on every admin-client read; tenant-coherence tripwire as in the memberships route |
| V5 Input Validation | yes | No client input on the feeds route; rename keeps the 80-char cap and trim in the route |
| V6 Cryptography | no change | Key storage untouched; copy only |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Admin-client read leaking another tenant's strategy names via a mis-scoped `.in()` | Information disclosure | Scope BOTH reads by `user_id = user.id`; drop and count any row whose strategy `user_id` differs (existing tripwire) |
| Feeds route as an existence oracle for key ids | Information disclosure | Batched route takes no ids from the caller; it enumerates only the caller's own keys |
| Owner re-pointing a published strategy's key via raw PostgREST (bypasses the new confirm) | Tampering | Out of scope (control-level rule); residual recorded, needs a migration |
| Copy asserting a false storage mechanism | Repudiation/trust | D-14/D-15 census |
| Missing `NO_STORE_HEADERS` on tenant data | Information disclosure | Add route to `no-store-coverage.test.ts` allowlist |

## Project Constraints (from CLAUDE.md)
- Disk-constrained worktree: no build, dev server, playwright, local Supabase stack, `npm install`; gates are `tsc`, targeted vitest, eslint.
- Never run `supabase db push`; **no migration** is planned (if one becomes unavoidable: file only).
- `grep -a` always; use Write/Edit; never `git checkout/restore/stash` on uncommitted work; byte-backup then `cp` for neuter/restore.
- Commits: explicit `git add <paths>`; **no AI attribution trailers** (project rule overrides the harness reminder); never write the CI skip-trailer tokens in a commit message or PR body.
- CHANGELOG entry and `VERSION`/`package.json` byte-equal 4-digit bump at ship; ship branch changes nothing under `.planning/`.
- DESIGN.md governs UI: sentence-case captions, Error Envelope for dialogs that report failure, Broker Selector Grid untouched.
- Never `.select("*")` on `api_keys`; project `API_KEY_USER_COLUMNS`. A failed read is never shown as an empty answer. KCS-23: link controls fail closed on composite/unknown shapes.
- Data-integrity/user-facing gates must be shown to fail (neuter, RED, restore). Cite moving code by symbol, not line number.
- AGENTS.md: this is not the Next.js you know; read `node_modules/next/dist/docs/` before writing new route/page code (the new route follows the existing `withAuth` route verbatim, so no new Next API is introduced).
- Do not touch `STATE.md`/`ROADMAP.md` beyond Phase 200's own plan rows; `git diff` after every gsd-tools handler.

## Sources

### Primary (HIGH confidence, files read this session at `8ac20b1db`)
- `supabase/migrations/20260410225610_sec005_follow_ups.sql`, `20260716131000_guard_strategies_publish_transition.sql`, `20260515114310_redact_guc_bypass_use_current_user.sql`, `20260410225609_strategy_api_key_tenant_check.sql`, `20260806120000_strategies_capital_ownership.sql`, `20260405061911_initial_schema.sql`, `20261022120000_strategies_anon_api_key_id_revoke.sql`, `20260602183000_b5b_api_key_delete_atomicity.sql`
- `src/components/strategy/{ApiKeyManager,StrategyForm,RenameStrategyDialog}.tsx`, `src/components/exchanges/{AllocatorExchangeManager,ExchangesTabContent}.tsx`, `src/components/auth/ProfileTabs.tsx`
- `src/app/api/keys/[id]/memberships/route.ts` (+ `route.test.ts` header), `src/app/api/strategies/[id]/name/route.ts`, `src/app/api/strategies/create-with-key/route.ts` (writer sites)
- `src/app/(dashboard)/{profile/page.tsx,strategies/[id]/edit/page.tsx,strategies/page.tsx,strategies/StrategiesEmptyState.tsx,strategies/StrategiesSection.tsx,strategies/new/page.tsx}`
- `src/lib/{strategy-display,api-key-label,status-surface-copy,ratelimit}.ts`, `src/__tests__/public-truth-census.test.tsx`, `src/lib/dialog-envelope.invariant.test.ts`, `src/lib/api/limiter-ordering.test.ts`, `src/__tests__/no-store-coverage.test.ts`
- `DESIGN.md` Voice section header, `200-CONTEXT.md`, ROADMAP Phase 200 section, REQUIREMENTS ROUTE-09/ROUTE-10/LEAN-04

### Secondary / Tertiary
- None (no web sources needed; no external libraries involved).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; all helpers read.
- Architecture: HIGH for feeds route, confirm gate, rename, census; MEDIUM for the AEM role switch (A2 unverified).
- Pitfalls: HIGH - each is tied to a read file or measured count.

**Research date:** 2026-11-10
**Valid until:** until Phase 196 or any other phase edits `FactsheetView.tsx`, `ApiKeyManager.tsx` or `AllocatorExchangeManager.tsx` on main (re-measure at HEAD before execution).
