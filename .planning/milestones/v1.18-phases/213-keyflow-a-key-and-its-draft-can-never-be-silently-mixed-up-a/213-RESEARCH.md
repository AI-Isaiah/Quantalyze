# Phase 213: KEYFLOW - Research

**Researched:** 2026-11-14
**Domain:** wizard draft/key resume fence, create-with-key idempotency flag, orphaned-key release surface, MT5 composite refusal, scenario-composer blend-basis hold (TypeScript / Next.js route handlers / React client components / Supabase RPC reuse)
**Confidence:** HIGH on code measurements (every item below was read at HEAD `af96bc00d1c3f8d3f280eb2e6d6ba6813152b9c6`); MEDIUM on the three items marked as decisions the founder must see (F1, F2, F5)
**Citation rule used here:** code is cited by repo-relative path and symbol (the repo's own `plan-anchor-verify` gate re-resolves `file:line` anchors in PLAN.md, so plans must cite symbols or anchors that resolve). Line ranges below are HEAD readings and will drift.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Founder decisions (from ROADMAP, 2026-11-14 — locked, quoted not paraphrased in plans)**
- (a) Refuse when unknown: an unknown incoming key meeting a stored key does not resume the draft, and create-with-key returns a `deduped` flag whenever it returns an existing draft. Supersedes Phase 164.2.1 D-01 and D-02 for the unknown case only. The CSV branch's literal `null` stays load-bearing.
- (b) Add Disconnect: a Disconnect control (disconnect, never delete) on the "No strategy yet" row, with the `KEY_ORPHANED` copy pointing at it.
- (c) Block it: MT5 cannot be a composite member. The wizard's MT5 composite card is removed and `composite/add-key` refuses `mt5` with a named code.
- (d) Hold and show pending: basis-dependent metrics in the scenario composer show as pending until every leg's asset class resolves.

**(a) Refuse when unknown — how**
- The distinction between "provably keyless" and "unknown" is carried by `source`, which already reaches `deriveWizardResumeOverrides`: on `source === "csv"` an incoming `null` stays permissive (unchanged); on `source === "api"` an incoming `null` meeting a stored string `apiKeyId` declines. Incoming `null` with no stored key stays permissive (nothing to conflict with). No new parameter.
- "Does not resume" means the decline withholds what the key-mismatch arm already withholds — the `wizardSessionId` (and the burn that rides with it) — so the submission cannot hit the create-with-key session fence for key A. Any other locally-restored field that belongs to key A's draft on the API branch (for example a restored step that presumes key A's connect) is withheld too; the planner measures which fields and records them.
- The Phase 164.2.1 three-argument pins and the arity contract's docblock are evidence for D-01. Pins that encode the superseded unknown-case behaviour are UPDATED with the supersession stated in the test text (founder 2026-11-14, decision (a)), never deleted. The arity guard (every production call passes the key) stays.
- create-with-key: `deduped: true` is added on the F6 session-fence arm, and the planner checks every other arm that returns an existing draft (the RPC select-existing path, the 23505 collision re-read) so "whenever it returns an existing draft" holds on all of them. The venue-fence and reuse arms already carry it.

**(b) Add Disconnect — how**
- Reuse the existing owner-scoped RPC `disconnect_allocator_api_key` (auth.uid() ownership, idempotent, sets `disconnected_at`). No migration, no new route unless the RPC is shown to be unsuitable; read its LIVE definition before relying on it.
- Success criterion 2 says "a manager can disconnect an orphaned key". Today `/strategies` reads placeholder keys only for allocator and `both`. Phase 199 D-02 ("everything from both") gives no reason for excluding manager-only accounts, so the placeholder row and its Disconnect render for every role that can create a key through the wizard (manager, allocator, both). This supersedes the `isAllocator` gate on the placeholder read; recorded as a supersession in code and the plan.
- The Disconnect must reach every key the create-with-key venue fence refuses as `KEY_ORPHANED`. The placeholder list filters on `is_active` and not-revoked while the fence filters only on `disconnected_at`, so a revoked-but-not-disconnected orphan is refused and listed nowhere. Close that mismatch so such a key is listed with Disconnect (it may offer no "Finish setup").
- For allocator and `both`, a strategyless key may feed holdings. The new control reuses the existing feeds-aware Disconnect confirm from `AllocatorExchangeManager` rather than a second confirm.
- The test for criterion 2 asserts the way out actually opens: after Disconnect, connecting the same account again is not refused as `KEY_ORPHANED`. The key row is kept (disconnected_at set, never deleted).
- `KEY_ORPHANED` copy: the fix lines name the Disconnect control on the "No strategy yet" row; the conditional "if your account includes the Strategies page" and "releasing the stored key is not something you can do from this page" sentences are rewritten to match what is now reachable.

**(c) Block MT5 composite membership — how**
- Remove the MT5 card from `MultiKeyConnectStep`'s roster. The UAT/F-4 carry-over in `enterMulti` is the one other route an MT5 key reaches a member panel (153.4 CR-03); it must also refuse MT5 (no multi-mode entry from an MT5 single-key draft), so removing the card cannot reopen CR-03.
- `composite/add-key` refuses `mt5` with a new named code BEFORE the `MT5_ENABLED` gate, so the answer does not depend on the flag. The code joins the `wizardErrors` union with copy, and the step's admitted-code list.
- `composite/set-members` also refuses a member whose key is `mt5` (TS read of the owned key's exchange, same named code), so an existing MT5 key cannot be attached by id. No SQL change.
- PROD measured 2026-11-14 via MCP (marker query first): 0 MT5 keys are composite members, so no data repair is needed.

**(d) Hold and show pending — how**
- `blendPeriodsPerYear` treats a nullish `asset_class` as crypto (365). A leg is "resolved" when its asset-class probe has SETTLED — answered with a class, answered null, or failed. A settled null or failure keeps the existing conservative rule (nullish ⇒ 365); this phase does not change that rule. Pending is therefore always terminal: no leg can hold the composer in pending forever.
- While any leg is unresolved, every basis-dependent figure (annualized vol, Sharpe, Sortino, and any other consumer of the blend basis the planner enumerates) renders the composer's existing pending treatment, never a number on the interim basis. Basis-invariant figures (for example CAGR on the calendar clock) are not held.
- The planner enumerates every consumer of the blend basis and checks that save, commit and share cannot persist a figure computed while a leg is pending.

**Decided autonomously**
- [Decision a] Q: "Which value distinguishes unknown from keyless?" → Selected: "the existing `source` argument" — internal function contract, one call site.
- [Decision a] Q: "Show a notice when the stored session is declined?" → Selected: "no new notice; the wizard simply starts without key A's token" — there is no draft on screen in the unknown case, so nothing is hidden from the user.
- [Decision b] Q: "New endpoint or existing RPC for Disconnect?" → Selected: "existing `disconnect_allocator_api_key` RPC" — no schema change, swappable later.
- [Decision c] Q: "Where else must MT5 be refused?" → Selected: "add-key, set-members, and the enterMulti carry-over" — TS-only guards.
- [Decision d] Q: "What ends pending on a failed probe?" → Selected: "settled-with-null counts as resolved, existing nullish rule applies" — keeps the existing RANK-06 contract.

### Claude's Discretion
- Exact wording of the new MT5 composite refusal copy and of the rewritten `KEY_ORPHANED` fix lines, written under the repo's existing wizard copy principles (161-UI-SPEC § Copy Principles: name only remedies that are reachable). Flagged for founder review in the hand-back.
- Whether the existing "These credentials are already connected…" notice (`wizard-dedup-notice`) shows when the session-fence arm now answers `deduped: true`. Default: it shows — the user did not get a new strategy, which is exactly what the notice says. Cheap to reverse (one condition); flagged for founder review in the hand-back.
- Visual form of the Disconnect control and of the pending state: reuse existing components (the row's existing action styling, the composer's existing pending treatment) per DESIGN.md.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are assigned (`ROADMAP.md` `### Phase 213:` says `Requirements: TBD`; `REQUIREMENTS.md` carries no 213 or KEYFLOW row [VERIFIED: grep of `.planning/REQUIREMENTS.md`, 0 hits]). The six ROADMAP success criteria are the contract:

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Unknown incoming key + stored draft key: no resume; create-with-key carries `deduped` whenever it returns an existing draft | § (a). F1 changes the rule's shape; F2 bounds "whenever" |
| SC-2 | A manager can disconnect an orphaned key from its "No strategy yet" row; row kept; `KEY_ORPHANED` copy names the control | § (b). F3 corrects the "no release surface" premise |
| SC-3 | No MT5 composite card; `composite/add-key` refuses `mt5` with a named code | § (c) |
| SC-4 | Composer shows basis-dependent metrics as pending until every leg's asset class resolved; never an interim-basis number | § (d). F5 names the sound pending signal |
| SC-5 | No migration expected | § Migration answer: none needed; two bounded residuals named |
| SC-6 | Each fix has a test that goes RED when reverted | § Validation Architecture |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives that bind this phase's plans (treated with the authority of locked decisions):

- **Next.js caveat (`AGENTS.md`):** this Next.js has breaking changes; read `node_modules/next/dist/docs/` before asserting an API. [ASSUMED-LIMIT] The worktree has no `node_modules` (see Environment Availability), so no Next doc could be read in this session. The phase touches no new Next API (existing route handlers, client components, `router.refresh()`), so it adds no Next claim.
- **Database safety:** this checkout's Supabase CLI is linked to PRODUCTION. This phase needs no migration and no DB query; never run `supabase db push` / `--linked` from here. No database was queried during this research.
- **Public repo, tracked `.planning/`:** no secrets, PROD ids, home paths or account numbers in tracked text. This file uses repo-relative paths only.
- **CHANGELOG discipline:** every ship writes a unified CHANGELOG entry in the same commit as the `VERSION` bump (`VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`). Section vocabulary is the repo's own (`### Fixed/Added/Changed/Removed/Tests/Notes/Security/Root cause/Why`). The entry must name the TODOS ids this phase closes (rule b below).
- **TODOS.md holds open work only:** a ship deletes the entries it closed, in the same PR, and names them in the CHANGELOG. LOW/Info review survivors are not booked in `TODOS.md`.
- **Never write a skip-CI trailer token** (the CI-skip tokens listed in CLAUDE.md) in a commit message or PR body, not even to deny it; verify CI by counting checks bound to the head SHA.
- **No AI authorship attribution** (founder memory 2026-10-20): no `Co-Authored-By` / `Claude-Session` trailers, no "Generated with Claude Code".
- **Tests must be able to fail:** neuter the fix, see RED, restore from a byte backup. Never `git checkout` / `git restore` / `git stash` on uncommitted work. Always `grep -a`. A new `supabase/tests` file or arm moves several censuses: grep them all.
- **Cite by symbol, not line number** in prose that will drift (`[164.7-CITATION-DRIFT-01]`); `plan-anchor-verify` fails loud on a `file:line` anchor that no longer resolves.
- **Copy:** `key-storage-census.test.ts` scans `src/app`, `src/components`, `src/lib` (not `src/app/api`) for the whole words `KEK`, `DEK`, `AES`, `Fernet`, `Vault`, `per-user` and the phrase `envelope encryption`. New copy and comments in those roots must avoid them [VERIFIED: `src/__tests__/key-storage-census.test.ts` `SCAN_ROOTS`, `EXEMPT_PREFIXES`, `WORD_TERMS`, `PHRASE_TERM`].
- **Design:** read `DESIGN.md` before UI decisions; `213-UI-SPEC.md` is the approved contract (reuse only: no new token, primitive, colour or dependency).
- **Agent gates:** analytics-touching briefs include mypy; this phase touches no `analytics-service/` file.
- **Planning-file shape:** `ROADMAP.md` / `STATE.md` edits follow hygiene rules 6d/6e/7 (`scripts/check-planning-hygiene.ts`); `git diff` after every `gsd-tools` handler run.
- **Ship guard:** a ship branch changes nothing under `.planning/`; check before push.

## Summary

All four decisions are implementable with existing seams and **no migration**. Reading the code at HEAD turned up five facts that change how the plan must be written. Three of them conflict with, or silently narrow, a locked decision's literal wording, so the planner should surface them to the founder rather than resolve them silently.

**Plan-changing findings (read these first):**

- **F1 — CONTEXT's rule for (a), read literally, breaks composite-draft resume.** The rule "`source === "api"`, incoming `null`, stored string `apiKeyId` declines" fires on every legitimate reload of a *composite* draft. `MultiKeyConnectStep` reports `apiKeyId: first.apiKeyId ?? ""` to `WizardClient.handleConnectSuccess`, which stores it through `persistPointer` (`apiKeyId: keyId || null`), so a composite pointer holds the first member's key id (a string). A resumed composite draft has `initialDraft.api_key_id === null`, so `incomingApiKeyId` is `null`. The decline would withhold the composite's session id, and `add_wizard_composite_key` locates the composite draft by `(user_id, wizard_session_id, api_key_id IS NULL)`, so the next add-key under the fresh id would INSERT a *second* composite draft. **Recommended refinement (no new parameter):** an incoming `null` is "unknown" only when no draft matching the stored pointer is on screen: decline iff `source === "api" && incomingApiKeyId === null && typeof loaded.apiKeyId === "string" && !(initialDraftId !== null && loaded.strategyId === initialDraftId)`. `initialDraftId` is already the third argument. This is consistent with the ROADMAP's own wording ("`initialDraft` was nulled … and no preselect exists"). It must be recorded as a clarification of the locked "how" in the plan and the hand-back.
- **F2 — "`deduped` whenever it returns an existing draft" cannot be made exact without a migration.** Both wizard RPCs replay an existing draft internally and return the same `(strategy_id, api_key_id)` shape as a fresh mint; the route's two final success returns carry no `deduped`. The route-owned arms (F6 session fence, venue fence, 23505 race re-read, reuse resolver) can all be made to carry it with TS only. The RPC-internal replay is reachable only on an F6-read fault or a true concurrent double-submit. Recommendation: no migration; record it as a named, bounded residual (plan + CHANGELOG `### Notes`) and have the founder confirm that reading of "whenever".
- **F3 — the "Profile → Exchanges is allocator-only" fact behind (b) is stale since Phase 200 D-06, but the premise "a manager has no release path" is largely still right.** Measured: `ProfileTabs.tsx` `ALL_TABS` shows the "API keys" tab (`{ key: "exchanges", label: "API keys" }`, no `allocatorOnly`) for every role (ProfileTabs.tsx:24-28). `getUserApiKeys` lists every key the user owns with no lifecycle filter, and `AllocatorExchangeManager` paints a release button on every key with `disconnected_at === null`, including a revoked or inactive one (AllocatorExchangeManager.tsx:1695-1704, the card's actions block). So **allocator and `both`** can already Disconnect an orphan there. But **a manager gets `Delete key` only** (`managerOnly` → label "Delete key", never "Disconnect"), and a manager's delete is refused when the key has holdings (`MANAGER_KEY_HAS_HOLDINGS_ERROR`: "This key still has allocator holdings tied to it, so it cannot be deleted from a manager account."). The route docblock states the daily poll writes `allocator_holdings` for every live key with a balance, no role filter (`create-with-key/route.ts`, `resolveOtherKeyUse` docblock, :287-296) [CITED: that comment; the SQL was not re-read]. If that holds, a *polled* manager orphan has no release path on Profile, which is exactly the population (b) serves. (b) therefore stands as locked. What changes: the plan must not claim "nothing ships that releases a key" for allocator/`both`, and the `KEY_ORPHANED` docblock sentence naming `allocatorOnly` is stale. Do **not** add a "use Profile → API keys" line to the copy: it is reachable for allocator/`both` and not reliably for a manager, and the 161 principle forbids a remedy the reader may not be able to use. See Open Question 3.
- **F4 — the `isPerKeyDailiesEligibleKey` predicate must not be edited, and pin 8 requires its token in `deriveStrategylessKeys`.** The predicate is documented as byte-identical to the Python backfill's active-key predicate. The way to list newly-visible orphans is to widen the *filter* in `deriveStrategylessKeys` to `disconnected_at == null` and carry `isPerKeyDailiesEligibleKey(k)` as a per-row flag (`finishSetupEligible`), which keeps `phase-149-my-strategies-parity.test.ts` pin 8 green (it requires the token `isPerKeyDailiesEligibleKey` in that function's body).
- **F5 — CONTEXT's "a failed probe is resolved, so pending always ends" disagrees with the composer's own re-fetch effect, and that is an OPEN DECISION, not a solved signal.** A failed probe writes only `addedMetricsById[id] = "unavailable"` and leaves `addedReturnsById[id]` undefined (so remove + re-add retries). The hydration effect (`useEffect` over `scenario.draft.addedStrategies`, deps `[…, strategyById, addedReturnsById, fetchAddedReturns]`) treats `addedReturnsById[a.id] === undefined` as "not resolved" and calls `fetchAddedReturns(a.id)` again whenever any dependency changes, for example when another leg settles. Trace: leg A failed (`"unavailable"`, not loading, not pending); leg B settles → `addedReturnsById` changes → that commit renders with `legsPending` false (A looks resolved) → numbers show on A's null → 365 rule → the effect then re-fires A's fetch after the commit → A is loading → figures blank → A's retry succeeds as `traditional` → figures return on 252. So a number can render, blank, and return on a different basis. Three ways out, each with a cost:
  1. **Make failure terminal for the effect** (skip ids whose `addedMetricsById[id] === "unavailable"`; only remove + re-add retries, which is what WR-01's comment already describes as the retry path). Then `metricsState` alone is sufficient and CONTEXT's "pending always ends" is literally true. Changes the effect's current behaviour (a test must pin it). **Recommended.**
  2. Key the hold on `loadingReturnsIds.has(id) || metricsState === "pending"` and accept the one-frame number on the settled-failure basis (the number is what the locked rule allows, but it is then superseded by a retry result).
  3. Key the hold on the effect's own predicate (`addedReturnsById[id] === undefined`): consistent with the effect, but a failed leg would hold the composer in pending forever, contradicting CONTEXT.
  Present this to the founder as a one-line decision; implement option 1 and keep `loadingReturnsIds` in the predicate as a belt.

**Other measured facts the plan depends on:**

- The reuse arm (`handleReuseExistingKey` and the `create_wizard_strategy_for_key` assertion) filters only on `disconnected_at IS NULL`, so it **accepts** a revoked or inactive key. `213-UI-SPEC.md` expected the opposite. Whether a newly-listed revoked orphan gets `Finish setup →` is therefore a product choice, not a constraint; recommendation: keep `Finish setup →` only where `isPerKeyDailiesEligibleKey` holds (a draft over a revoked key would never sync).
- "Finish setup" from `/strategies`: none of the routes the overlay flow calls has a role check (grep for `profiles|\.role\b|requireRole|isManager|role ===|role !==` over `create-with-key`, `wizard-draft`, `finalize-wizard`, `keys/sync` and `strategies/[id]/sync-progress` found nothing), and the overlay documents itself as role-agnostic. It was not exercised in a browser. It always mounts `WizardClient` with `entryContext="contribution"`, which asks the allocator capital question and finalizes to `private`, not `pending_review`. See Open Question 4.
- **No migration.** `disconnect_allocator_api_key` is defined once (migration `20260422101911`), matches the baseline dump, is granted to `authenticated`, and a disconnected key releases the venue-identity unique index (`WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL`).
- MT5 composite membership is reachable by **more** doors than the two routes: `strategy_keys` has an owner `ALL` policy and `GRANT SELECT,INSERT,…,UPDATE … TO authenticated`, and `set_wizard_composite_members` is granted to `authenticated`. The TS guards are UX fences, not hard fences (CONTEXT already accepts "No SQL change").
- Blend-basis consumers that persist anything: **none**. `postNewScenario` / `putUpdateScenario` send `{name, draft}`; commit sends diffs and AUM; the peer-rank route is a read-only RPC; share recomputes server-side. `solveLeverageForMaxDD` documents `max_drawdown` as basis-invariant, so the Max-DD target solve needs no hold.
- The worktree has **no `node_modules`**: no test was run, and nothing here claims a test passes at HEAD.

**Primary recommendation:** plan four independently-testable plans (a), (b), (c), (d), sequenced so `src/lib/wizardErrors.ts` (touched by (b) and (c)) and `src/app/api/strategies/create-with-key/route.ts` (touched by (a) and a comment edit for (b)) are never edited by two parallel executors; put the F1 refinement, the F2 bound and the F3 corrections in front of the founder in the hand-back.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Decide whether a stored wizard session id may be reused (the unknown-key decline) | Browser / Client (`src/lib/wizard/localStorage.ts`, called from `WizardClient`) | API (F6 fence is the backstop) | The token lives in `localStorage`; the server fence cannot know the client lost its key context |
| Report that an existing draft was returned (`deduped`) | API / Backend (`create-with-key/route.ts`) | Browser (ConnectKeyStep forwards, WizardClient renders the notice) | Only the route knows which arm answered |
| List orphaned keys | Frontend Server (`strategies/page.tsx` via `getStrategylessActiveKeys`) | Database (RLS-scoped reads) | Server component reads, client table renders |
| Disconnect an orphaned key | Database / Storage (RPC `disconnect_allocator_api_key`, owner-scoped via `auth.uid()`) | Browser (browser Supabase client calls the RPC; confirm UI) | Existing pattern in `AllocatorExchangeManager`; no new route |
| Refuse MT5 as composite member | API / Backend (`composite/add-key`, `composite/set-members`) | Browser (roster card removed, footer note, `enterMulti` guard) | Server refusal is authoritative; UI removal prevents the dead end |
| Annualization basis hold in the composer | Browser / Client (`ScenarioComposer.tsx`) | — | All blend math runs client-side on already-fetched series; server-side share path already uses DB asset class |

## Standard Stack

No new library, token, component primitive or dependency (the `213-UI-SPEC.md` contract and the CONTEXT scope forbid them). Package Legitimacy Audit: **not applicable — this phase installs no external package.**

### Core (existing, reused)
| Library / module | Purpose | Why Standard |
|---|---|---|
| `src/lib/wizard/localStorage.ts` (`deriveWizardResumeOverrides`, `sessionKeyMatches`) | Resume-override derivation | One production caller (`WizardClient.tsx`), guarded by the arity contract test |
| `src/app/api/strategies/create-with-key/route.ts` | Idempotent draft creation, five arms | Existing `deduped` field convention (additive, `=== true` on the client) |
| `disconnect_allocator_api_key(uuid)` RPC | Owner-scoped soft-disconnect | LIVE definition read; granted to `authenticated` |
| `src/components/ui/{Modal,Button,LiveRegion}` | Confirm shell, buttons, announcement | Named in `213-UI-SPEC.md` Component Inventory |
| `src/lib/closed-sets.ts` `blendPeriodsPerYear` | The one blend-basis rule | MD-01: no call site may grow a local 365/252 ternary |
| `src/lib/wizardErrors.ts` (`WizardErrorCode` union, `WIZARD_ERROR_COPY`) + `src/lib/envelope.ts` `buildEnvelope` | Named error copy and recoverability derivation | Recoverable is derived from `actions` against `RECOVERABLE_ACTIONS` |

**Installation:** none. **Version verification:** not applicable (no package).

## Architecture Patterns

### System Architecture Diagram

```
(a) RESUME FENCE
 localStorage (signed envelope: strategyId, wizardSessionId, apiKeyId?, source, step)
        │ loadWizardState()
        ▼
 WizardClient mount effect ── incomingApiKeyId = source==="csv" ? null
        │                                       : (initialDraft?.api_key_id ?? preselectKey?.id ?? null)
        ▼
 deriveWizardResumeOverrides(loaded, source, initialDraft?.id ?? null, incomingApiKeyId)
        │   decline? ── yes ─▶ {} (no wizardSessionId, no burn) ─▶ WizardClient keeps newWizardSessionId()
        │                                                          + triage label + wizard_session_id_not_restored event
        └─ no ─▶ {wizardSessionId, step?, ...} ─▶ submit ─▶ POST /api/strategies/create-with-key
                                                              │
        ┌──────────────── route arms that RETURN an existing draft ───────────────┐
        │ 1 F6 session fence      (user_id, wizard_session_id) ─▶ ok + deduped:true   [NEW]
        │ 2 venue fence "draft"   (mt5 pre-validate)           ─▶ ok + deduped:true   [exists]
        │ 3 23505 venue race arm  re-resolve                   ─▶ ok + deduped:true   [exists]
        │ 4 reuse arm resolver    held.kind==="draft"          ─▶ ok + deduped:true   [exists]
        │ 5 RPC internal replay   (create_wizard_strategy / _for_key) ─▶ ok, no flag  [F2: not discriminable in TS]
        └─────────────────────────────────────────────────────────────────────────┘
        ConnectKeyStep.handleSubmit forwards deduped ─▶ WizardClient.setDedupedExisting ─▶ wizard-dedup-notice (sync_preview)
        ConnectKeyStep.handleContinueWithKey (reuse) deliberately does NOT forward it

(b) RELEASE
 /strategies page ── getStrategylessActiveKeys(user.id) [every role] ─▶ placeholderRows(+finishSetupEligible, +syncStatus)
        ▼
 StrategiesSection (client host) ── onDisconnect(keyId) ─▶ shared feeds-aware confirm (Disconnect-only)
        │  GET /api/keys/[id]/memberships (feeds)        browser supabase.rpc("disconnect_allocator_api_key")
        ▼                                                         ▼
 router.refresh() + LiveRegion + focus move          api_keys.disconnected_at = now()  (row kept)
                                                      └─▶ unique index predicate frees the venue slot ─▶ reconnect no longer KEY_ORPHANED

(c) MT5 BLOCK
 ConnectKeyStep (single-key, MT5 card unchanged) ─ footerSlot ─▶ [MT5 selected] note instead of "+ Add another key window"
 MultiKeyConnectStep roster: MT5 entry removed;  enterMulti refuses exchange==="mt5"
 composite/add-key:  isMt5 ─▶ 400 COMPOSITE_MT5_UNSUPPORTED  (before MT5_ENABLED gate, before validate/encrypt)
 composite/set-members: user-scoped api_keys read (id, exchange) ─▶ any mt5 ─▶ refuse, BEFORE set_wizard_composite_members

(d) COMPOSER HOLD
 added legs ─ fetchAddedReturns ─▶ settle()/markMetricsUnavailable()/abort ─▶ loadingReturnsIds, addedAssetClassById, addedMetricsById
        ▼
 legsPending = any leg: !found && (loadingReturnsIds.has(id) || metricsState==="pending")    [F5]
        ▼ true: held consumers render "—" inside their normal layout (never their empty/unavailable branch)
 blendBasis (unchanged) ─ computeScenario(..., blendBasis) ─▶ volatility, sharpe, sortino ... (cagr/twr/max_dd invariant)
```

### Recommended Project Structure
```
src/lib/wizard/localStorage.ts                      # (a) decline rule + docblock supersession
src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx   # (a) triage label only
src/app/api/strategies/create-with-key/route.ts     # (a) deduped on the F6 arm
src/lib/queries.ts                                  # (b) deriveStrategylessKeys filter + flag
src/app/(dashboard)/strategies/page.tsx             # (b) drop isAllocator gate on the placeholder read
src/app/(dashboard)/strategies/StrategiesSection.tsx# (b) host the Disconnect confirm
src/components/strategy/StrategyTable.tsx           # (b) row action
src/components/exchanges/<new shared module>        # (b) extracted feeds-aware confirm helpers
src/lib/wizardErrors.ts                             # (b) KEY_ORPHANED copy; (c) new code + copy
src/app/api/strategies/composite/{add-key,set-members}/route.ts   # (c)
src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx  # (c)
src/app/(dashboard)/allocations/components/ScenarioComposer.tsx          # (d)
```

### Pattern 1 — the unknown-key decline (F1 form)
**What:** keep `sessionKeyMatches` as it is for a present incoming key; add the unknown arm in `deriveWizardResumeOverrides` using only existing arguments.
**Example (sketch, not a final edit):**
```ts
// source: derived from src/lib/wizard/localStorage.ts deriveWizardResumeOverrides (HEAD)
const sameDraftOnScreen = initialDraftId !== null && loaded.strategyId === initialDraftId;
const unknownMeetsStoredKey =
  source === "api" &&
  incomingApiKeyId === null &&
  typeof loaded.apiKeyId === "string" &&
  !sameDraftOnScreen;
if (
  loaded.wizardSessionId &&
  (loaded.source ?? "api") === source &&
  sessionKeyMatches(loaded.apiKeyId, incomingApiKeyId) &&
  !unknownMeetsStoredKey
) { /* restore wizardSessionId (+ burn on csv) */ }
```
**Fields withheld on a decline (measured):** only `wizardSessionId` (and `failedCsvSubmitSig`, which is csv-only and cannot be emitted on `source === "api"`). On the API branch the function can emit exactly: `wizardSessionId`, `step` (only when `initialDraftId` is non-null and `loaded.strategyId === initialDraftId`, and only for `connect_key` / `sync_preview`), and `showResumeBanner` (only when `initialDraftId` is non-null and `loaded.strategyId !== initialDraftId`; it concerns the *server* draft on screen, not key A). `strategyName` is csv-only. In the F1-refined unknown case `initialDraftId` is null or mismatched, so `step` cannot be restored anyway: **nothing beyond `wizardSessionId` needs withholding.** (Under CONTEXT's literal rule the composite case would withhold `step` too, which is the regression F1 names.)

### Pattern 2 — Disconnect-only variant of the feeds-aware confirm
**What:** extract the module-private helpers from `AllocatorExchangeManager.tsx` (`deleteFeedsNote`, `readKeyFeedsForConfirm`, `FEEDS_UNCHECKED_COPY`, `FEEDS_READ_BOUND_MS`, `parseKeyFeed`, `readJson`, the `DeleteFeedsState` type) into one shared module and import them from both hosts, so the strategies host never imports a Delete path. Keep the existing `data-testid`s (`allocator-delete-feeds`, `allocator-delete-feeds-loss`, `allocator-delete-retry`) byte-identical: `AllocatorExchangeManager.feeds.test.tsx` and `AllocatorExchangeManager.test.tsx` read them.
**RPC call (existing pattern):** `supabase.rpc("disconnect_allocator_api_key", { p_api_key_id: keyId })` from the browser client; error → `Could not disconnect this key. Please try again.`

### Pattern 3 — pending hold keyed on one derived boolean
**What:** compute `legsPending` once in `ScenarioComposer`; feed it to the held consumers rather than re-deriving per consumer. The peer-rank request is already suppressed by `buildScenarioPeerRankRequest` when `sharpe`/`sortino` is `null` (`Number.isFinite` guard), so passing `null` while pending gives the "no request, panel absent" behaviour for free.

### Anti-Patterns to Avoid
- **Editing `isPerKeyDailiesEligibleKey`** (cross-language mirror of the Python backfill predicate). Widen the filter in `deriveStrategylessKeys` instead (F4).
- **Sending a held consumer into its own empty/unavailable branch** (`ScenarioBenchmarkSection` prints "Benchmark comparison unavailable" with a cause): blank the slots inside the populated layout (`213-UI-SPEC.md` §4.2).
- **Importing `Delete key` / the cascade checkbox into the strategies host**: the confirm is Disconnect-only.
- **Keying the composer hold on `metricsState` alone** (F5).
- **Deleting superseded tests**: update them with the supersession stated (CONTEXT (a); same repo habit for (b)–(d)).
- **Adding a `deduped` UI variant for the reuse arm**: `ContributionWizardOverlay.preselect.test.tsx` pins "reuse arm answers deduped:true → no notice"; that site stays.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Disconnect an owned key | A new route / SQL / service-role write | `disconnect_allocator_api_key` via the browser client | Owner-scoped (`auth.uid()`), idempotent, grants already in place |
| Feeds-aware confirm body | A second copy of the feeds read and note strings | Extract the existing helpers (Pattern 2) | Two copies drift; the existing tests pin the strings |
| Blend annualization basis | A local 365/252 ternary | `blendPeriodsPerYear` | MD-01 |
| Peer-rank suppression while pending | A new "pending" request flag | Pass `null` sharpe/sortino to `buildScenarioPeerRankRequest` | Its guard already returns `null` (no fetch) |
| Recoverable-vs-not for the new MT5 code | A new flag on the copy entry | Omit `clear_and_retry` / `try_another_key` from `actions` | `buildEnvelope` derives `recoverable` from `actions` |
| Composite-member MT5 detection | Client-side venue guess | A user-scoped `api_keys` read of `id, exchange` (`exchange` is in `API_KEY_USER_COLUMNS`) | The server read is authoritative; the client list can be stale |
| Orphan detection for the list | A second resolver | Existing `deriveStrategyLinkedKeyIds` coverage logic | Handles both link forms and W-4 (archived ≠ coverage) |

## Section (a) — measurements

### Callers and meaning of an incoming `null`
`deriveWizardResumeOverrides` has **one production caller**: `WizardClient.tsx`, in the single post-mount `useEffect`. It computes `incomingApiKeyId` as a literal `null` when `source === "csv"` and `(initialDraft?.api_key_id ?? preselectKey?.id ?? null)` otherwise [VERIFIED: `WizardClient.tsx` mount effect, `const incomingApiKeyId = source === "csv" ? null : (initialDraft?.api_key_id ?? preselectKey?.id ?? null);`]. The arity guard (`derive-resume-overrides-arity.contract.test.ts`) scans production files from disk and fails any call with fewer than four arguments.

What `null` means per mount:

| Mount | `initialDraft` | `preselectKey` | incoming | Meaning |
|---|---|---|---|---|
| CSV wizard (page `?source=csv`, overlay CSV toggle) | any | any | literal `null` | provably keyless: unchanged, permissive |
| Manager page `/strategies/new/wizard`, no draft | null | none | `null` | unknown (read fault degrades `initialDraft` to null, or no draft at all) → NEW decline if a stored string key exists |
| Manager page, keyed API draft | draft with `api_key_id` string | none | string | present: compared by `sessionKeyMatches` |
| Manager page / overlay, **composite draft** | draft with `api_key_id === null` | none | `null` | **keyless by design — not unknown (F1)** |
| Overlay, "Finish setup" on key B | null (overlay offers a draft only when `draft.api_key_id === activePreselect.id`) | key B | key B id | present |
| Overlay, "Add" with no preselect, no draft | null | none | `null` | unknown → NEW decline if stored string key |

### F1 evidence (composite resume)
- `MultiKeyConnectStep` success: `onSuccess({ strategyId, apiKeyId: first.apiKeyId ?? "", exchange: first.exchange })` [VERIFIED: `MultiKeyConnectStep.tsx` Continue handler].
- `WizardClient.handleConnectSuccess` → `persistPointer("sync_preview", result.strategyId, result.apiKeyId)`; `persistPointer` stores `apiKeyId: keyId || null` [VERIFIED: `WizardClient.tsx` `persistPointer`].
- `WizardClient` passes `initialDraft?.api_key_id` (null for a composite) into `incomingApiKeyId`, so a later composite resume has incoming `null` and stored string.
- `add_wizard_composite_key` finds its draft by session: `WHERE s.user_id = p_user_id AND s.wizard_session_id = p_wizard_session_id AND s.api_key_id IS NULL`, and INSERTs a new composite draft when none matches [VERIFIED: `supabase/schema/baseline.sql` `add_wizard_composite_key` body]. A wrongly-declined session id therefore forks the composite draft.
- Existing pin to keep in mind: `ContributionWizardOverlay.sessionid-fence.test.tsx` "a keyless draft's resume stamps the DRAFT's key" shows composite/keyless drafts reach `WizardClient` with a live `initialDraft`.

### Test pins that encode the superseded unknown-case behaviour (update with supersession, never delete)
| Pin | What it encodes | Action |
|---|---|---|
| `src/lib/wizard/localStorage.test.ts`, test "DOES restore when the caller names NO incoming key — no claim, nothing to compare" (stored `apiKeyId: "key-a"`, `source: "api"`, `deriveWizardResumeOverrides(abandonedDraftOnKeyA, "api", null, null)`) | The one existing unit pin whose result flips (restore → decline) | Invert, name decision (a) in the test text, keep its two siblings; add the F1 counter-pins below |
| same file, docblock above that test ("This is the CSV branch …, the manager route mounted with neither draft nor preselect, and every legacy three-argument caller in this file") | States the superseded D-01 asymmetry | Rewrite the comment: CSV stays permissive; the other two named populations no longer are |
| same file, the roughly 25 three-argument API-branch tests (lines near 142–260) | Legacy payloads carry **no `apiKeyId`** → stored not a string → still permissive | Pass unmodified (this is the evidence D-02's "default did not change behaviour for a keyless claim" still holds) |
| `src/lib/wizard/derive-resume-overrides-arity.contract.test.ts`, docblock | "`null` is the PERMISSIVE value … fail-open default" and "the ~25 existing three-argument unit pins must pass UNMODIFIED" | Update prose: on the API branch an omitted 4th argument now fails closed against a stored key; the arity guard itself stays (the CSV branch still needs its literal `null`) |
| `src/__tests__/contracts/contracts-registry.test.ts`, the `derive-resume-overrides-arity.contract.test.ts` row `invariant` text | Same "fail-open default / PERMISSIVE" sentence, registry-pinned text | Update the row text; keep the batch id |
| `src/lib/wizard/localStorage.ts`, docblocks of `sessionKeyMatches` and the "KNOWN RESIDUAL" paragraph | Name D-01 and the open residual | Add the dated supersession in place (repo style: keep lineage) |
| `WizardClient.tsx` mount effect comments ("CSV branch: a LITERAL `null` …", the decline-warning block) | Triage label computed at the call site | Add reason `incoming_key_unknown` (today the unknown case falls to `"other"`) |
| `ContributionWizardOverlay.sessionid-fence.test.tsx` SC-1c/SC-1d/SC-1e | All use a *present* preselect | Unchanged; add one unknown-case pin (see Validation) |
| `src/lib/wizardErrors.ts` comment on `DRAFT_ALREADY_EXISTS` ("restores `wizardSessionId` … UNCONDITIONALLY") | Already stale after 164.2.1 | Optional touch-up |
| `ContributionWizardOverlay.csv-preselect-burn.test.tsx`, `WizardClient.csv-durable-mint.test.tsx`, `WizardClient.test.tsx` | CSV literal-null pin; two stub `deriveWizardResumeOverrides` entirely | Unchanged (the CSV pin is the "stays load-bearing" evidence) |
| Telemetry label `wizard_session_id_not_restored` | No test pins any `step` label value [VERIFIED: grep of `src`, only `WizardClient.tsx` and `src/lib/analytics.ts`] | New label is free |

New unit pins required (`localStorage.test.ts`): (1) api, incoming null, stored string, no draft on screen → no `wizardSessionId`; (2) csv, incoming null, stored string → restored (load-bearing); (3) api, incoming null, stored absent/null → restored; (4) **api, composite draft on screen (`initialDraftId === loaded.strategyId`), stored first-member key string, incoming null → `wizardSessionId` AND `step` restored** (the F1 over-decline control; it must go RED under CONTEXT's literal rule); (5) api, incoming null, stored string, `initialDraftId !== loaded.strategyId` → declined and `showResumeBanner` true.

### create-with-key arms that return an existing draft
All in `src/app/api/strategies/create-with-key/route.ts` [VERIFIED by reading the arms]:

| # | Arm (symbol / location) | Returns existing draft? | Carries `deduped` today? | Action |
|---|---|---|---|---|
| 1 | Credential arm, F6 session fence: `existingDraft?.id && existingDraft.api_key_id` → `{ok, strategy_id, api_key_id}` | yes | **no** | add `deduped: true` |
| 2 | Credential arm, venue fence `venueMatch.kind === "draft"` (MT5 pre-validate) | yes | yes | none |
| 3 | Credential arm, 23505 venue-identity race arm `venueMatch.kind === "draft"` | yes | yes | none |
| 4 | Credential arm, final success from the RPC `create_wizard_strategy` (internal advisory-lock replay: "Idempotent replay … returns any draft already created for this (user, session)") | yes, when replayed | no | **F2** |
| 5 | Reuse arm `handleReuseExistingKey`: `held.kind === "draft"` | yes | yes | none |
| 6 | Reuse arm final success from `create_wizard_strategy_for_key` ("replay: an existing wizard draft over this key IS the answer") | yes, when replayed | no | **F2** |
| 7 | 23505 session-fence arms (`DRAFT_ALREADY_EXISTS`, `DRAFT_SESSION_COLLISION`) | no (409 refusals) | n/a | none |

**F2 detail.** `create_wizard_strategy` is `RETURNS TABLE("strategy_id" "uuid", "api_key_id" "uuid")` [VERIFIED: `supabase/schema/baseline.sql:3839`, `CREATE OR REPLACE FUNCTION "public"."create_wizard_strategy"( … ) RETURNS TABLE("strategy_id" "uuid", "api_key_id" "uuid")`]; the route cannot distinguish replay from mint from that shape. The replay predicate (user, session, `api_key_id IS NOT NULL`) equals the route's own F6 SELECT predicate, so replay is reachable only when the F6 SELECT errored (`existingDraftErr`, the route logs and falls through) or when two first-time submits race. Exact discrimination needs the RPC to return a flag: changing a `RETURNS TABLE` shape means `DROP FUNCTION` + `CREATE`, re-issuing the `REVOKE` / `GRANT` pair (the migration header warns CREATE OR REPLACE preserves ACLs but DROP destroys them), a baseline re-dump and the migration-reviewer / rls-policy-auditor gates. A `created_at`-vs-request-start heuristic in TS is possible but is not exact under concurrency and is not recommended. Recommended resolution: no migration; the F2 bound is recorded; founder confirms (Open Question 1).

### ConnectKeyStep / WizardClient sites
- `ConnectKeyStep.handleSubmit` forwards `deduped` only when `data.deduped === true` (`...(data.deduped === true ? { deduped: true } : {})`) — so the F6 arm's new flag reaches `WizardClient.handleConnectSuccess`, which does `setDedupedExisting(result.deduped === true)` and the strip renders at `step === "sync_preview"`: **the notice will show on an ordinary double-click or browser retry** that today is silent (the F6 arm's own old comment: "the common case (a double-click) is already safe, already silent"). `213-UI-SPEC.md` Founder Review item 1 already names this; the notice copy ("These credentials are already connected.") is not measured on that arm.
- `ConnectKeyStep.handleContinueWithKey` (reuse arm) says in its docblock "`deduped` IS DELIBERATELY NOT FORWARDED" and the reuse arm never reads the F6 fence, so **adding `deduped` to arm 1 changes nothing there**; `ContributionWizardOverlay.preselect.test.tsx` (answers `deduped: true`, asserts `wizard-dedup-notice` is null) stays valid and must stay green.
- Tests that pin the old F6 shape and must be updated with the supersession stated: `create-with-key/route.test.ts`, "returns the existing draft and skips Railway validate+encrypt+RPC …" (`toEqual({ok, strategy_id, api_key_id})`). The vacuity fence "a first connect is NOT reported as deduped" already exists and should stay. Route comments to update: the "`deduped` IS ADDITIVE AND APPEARS ON THIS ARM ONLY" paragraph at the venue-fence arm, and `ConnectKeyStep.tsx` docblock on `deduped` ("Absent on every other arm, including … the F6 session-fence replay").

## Section (b) — measurements

- **Live RPC.** `disconnect_allocator_api_key(p_api_key_id UUID) RETURNS BOOLEAN`, `SECURITY DEFINER`, `search_path = public, pg_temp`; raises `42501` `not_authenticated` when `auth.uid()` is null; raises `42501` (`caller does not own api_key`) when the row is missing or owned by another user; returns `false` when already disconnected; otherwise `UPDATE api_keys SET disconnected_at = now() WHERE id = p_api_key_id AND user_id = v_uid AND disconnected_at IS NULL` and returns `true`. It has **no role check**, so a manager can call it. Defined once, in `supabase/migrations/20260422101911_api_keys_disconnected_at.sql`, and the baseline dump holds the identical body [VERIFIED: `supabase/schema/baseline.sql` (the `CREATE OR REPLACE FUNCTION "public"."disconnect_allocator_api_key"` body) and no later migration redefines it: grep of `supabase/migrations` for `disconnect_allocator_api_key` finds only comments and `reconnect_allocator_api_key` references]. Grants [VERIFIED: baseline lines `REVOKE ALL ON FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") FROM PUBLIC;`, `GRANT ALL … TO "authenticated";`, `GRANT ALL … TO "service_role";`].
- **Reconnect is released.** The venue-identity index is `CREATE UNIQUE INDEX "api_keys_user_exchange_venue_account_uniq" ON "public"."api_keys" USING "btree" ("user_id", "exchange", "venue_account_id") WHERE (("venue_account_id" IS NOT NULL) AND ("disconnected_at" IS NULL));` [VERIFIED: `supabase/schema/baseline.sql:15157`]. The route's resolver mirrors it (`resolveByVenueIdentity` reads `api_keys` with `.is("disconnected_at", null)`, create-with-key route.ts, the `.from("api_keys")` chain at the top of that function). The existing SQL gate `supabase/tests/test_api_keys_venue_identity_uniq.sql` arm 6b ("a DISCONNECTED row must NOT squat the slot", `UPDATE api_keys SET disconnected_at = now() WHERE id = k_live;` then an INSERT of the same login that must not raise `unique_violation`, lines ~659-672) already proves a soft-disconnected row frees the slot; it uses a direct `UPDATE`, not the RPC. The `RED-UNDER-M` annotations in that file are on other arms (1, 2, 3, 4, 5, 6.0, 6e, 6f); 6b carries no annotation of its own (grep `RED-UNDER` over the file), though arm 6f (a ccxt venue, "once the first is disconnected the slot is free again", lines ~738-747) mutates the same index.
- **The two lists differ exactly as CONTEXT says.**
  - Fence (`resolveByVenueIdentity` → `ORPHANED`): live key = `disconnected_at IS NULL` only; orphaned = no strategy of **any status** points at it and no `strategy_keys` row (`resolveOtherKeyUse`).
  - List (`getStrategylessActiveKeys` → `deriveStrategylessKeys`): `isPerKeyDailiesEligibleKey` = `is_active && sync_status !== "revoked" && disconnected_at == null`, and coverage = live (non-archived) strategy or composite link. So an inactive or revoked-but-connected orphan is refused as `KEY_ORPHANED` and not listed. (The reverse difference is harmless: a key behind only an *archived* strategy is listed but the fence answers `VENUE_ALREADY_CONNECTED`, not `KEY_ORPHANED`.)
- **Placeholder read gate.** `strategies/page.tsx`: `const [bareKeys, portfolio] = isAllocator ? await Promise.all([getStrategylessActiveKeys(user.id), getRealPortfolio(user.id)]) : [[], null];` — the placeholder read shares one `Promise.all` with `getRealPortfolio`; ungating the placeholder read means splitting them so a manager still makes no portfolio read. Also `allocatorFurniture={isAllocator}` is passed to the host unchanged. The `kSentence` count and the "no table" empty-card gating (`hasRows`) already handle placeholders for any role.
- **`Finish setup →` for a manager-only account.** No role gate was found on the routes the flow calls (`create-with-key`, `wizard-draft`, `finalize-wizard`, `keys/sync`, `strategies/[id]/sync-progress`; grep for `profiles`, `.role`, `requireRole`, `isManager`, `role ===` returned nothing in them; not exercised in a browser), and `ContributionWizardOverlay` states it is role-agnostic. It mounts `WizardClient entryContext="contribution"`, which sets `showCapitalQuestion` and sends `entryContext` to finalize, which then finalizes to `private` rather than `pending_review`. So it works mechanically for a manager; the outcome differs from the manager wizard's (Open Question 4).
- **Reuse arm accepts revoked/inactive keys.** `handleReuseExistingKey` layers 1 and 2 and the RPC assertion all filter `disconnected_at IS NULL` only [VERIFIED: route reuse arm reads; `20260826130000_create_wizard_strategy_for_key.sql` gate 3]. A draft minted over a revoked key would be skipped by every cron dispatcher (the migration's own comment), which is the reason to keep `Finish setup →` limited to `isPerKeyDailiesEligibleKey` keys even though the server would accept it.
- **Feeds-aware confirm.** `deleteFeedsNote`, `readKeyFeedsForConfirm`, `FEEDS_UNCHECKED_COPY`, `FEEDS_READ_BOUND_MS` are module-private to `AllocatorExchangeManager.tsx`. The feeds read is `GET /api/keys/[id]/memberships` (`withAuth`, ownership-checked, role-agnostic). The source confirm's Disconnect is gated only on `feedsOpen` (and the cascade case), and an `unchecked` read warns without holding Disconnect. The strategies host needs `Modal`, `Button`, `LiveRegion`, and the browser `createClient` for the RPC.
- **Who can already release a key (F3, narrowed).** `ProfileTabs.tsx:24-28` `ALL_TABS` has `{ key: "exchanges", label: "API keys" }` with no `allocatorOnly` (comment: "Phase 200 D-06: the one key manager, for every role that can hold keys (manager, allocator, both)"). `AllocatorExchangeManager.tsx` has `canHardDeleteKey = role === "manager" || role === "both"` and `managerOnly = role === "manager"` (grep-observed at :779-780): a manager sees `Delete key` only; the card's button is painted for every key in `activeKeys = keys.filter((k) => k.disconnected_at === null)` (:1695), and the file's own comment says "A revoked or inactive key that was never disconnected keeps its row above (its pill, its departed-history card, its Disconnect)" (:1701-1704). A manager's delete is refused when holdings exist (`MANAGER_KEY_HAS_HOLDINGS_ERROR`, :403-404). `getUserApiKeys` selects `API_KEY_USER_COLUMNS` `.eq("user_id", userId)` with no lifecycle filter. Net: allocator / `both` can already Disconnect any non-disconnected orphan on Profile; a manager can delete one only while it has no holdings, and the poll may write holdings for any live key ([CITED] route docblock). The `KEY_ORPHANED` docblock in `wizardErrors.ts` still says the only Disconnect list "sits behind `allocatorOnly` in `ProfileTabs.tsx`" — stale prose.

### Tests that move for (b)
| Test | Why it moves |
|---|---|
| `src/app/(dashboard)/strategies/page.merged.test.tsx` "a manager's page makes neither allocator read and shows no placeholder or K sentence" | Manager now reads `getStrategylessActiveKeys`; still no `getRealPortfolio`. Split the assertion; the `allocator and both` test keeps `toHaveBeenLastCalledWith("u-1")` |
| `src/lib/queries.my-strategies.test.ts` "never returns ineligible keys, even when totally uncovered" (expects only `["eligible"]` from inactive / revoked / disconnected / eligible) | Inactive and revoked orphans are now returned (with `finishSetupEligible: false`); disconnected stays excluded |
| `src/__tests__/phase-149-my-strategies-parity.test.ts` pin 8 | Requires `isPerKeyDailiesEligibleKey`, `deriveStrategyLinkedKeyIds(` and the `"archived"` literal in the bodies; the F4 shape keeps it green. Pin 12 asserts every extractor found a body |
| `src/components/strategy/StrategyTable.default-mounts.test.tsx` "the merged /strategies owner mount (owner-all-statuses, placeholder, callbacks) is unchanged" | Mount passes `onFinishSetup` but no `onDisconnect`; if the Actions cell gains an unconditional `flex` wrapper the pinned normalized string moves. Either render the wrapper only when `onDisconnect` is passed (pin stays byte-identical) or move the pin with a stated reason; add a new mount case with `onDisconnect` |
| `src/components/strategy/StrategyTable.pending-chip.test.tsx` (placeholder `<td>` count equals header `<th>` count; `Finish setup` role/name queries; "a mid-sync row … offers no Finish setup") | New row variants (no `Finish setup`, `Disconnect` only, optional pill) must keep the td count |
| `src/app/(dashboard)/strategies/StrategiesLegend.test.tsx` (pipeline group asserts the old `no_strategy_yet` definition string) | `213-UI-SPEC.md` §1.6 replaces the string; update the pin in the same task |
| `src/lib/wizardErrors*.test` / `create-with-key/route.test.ts` comment at the `KEY_ORPHANED` arm and docblock on `handleReuseExistingKey` ("releasing the stored key is not something they can do from any page we ship") | Prose only; update with the copy |
| `ConnectKeyStep.preselect-refusal-class.test.tsx` | Sweeps copy of preselect-reachable codes for "banned phrases" naming absent controls and checks quoted labels against painted controls. Check whether `KEY_ORPHANED` is in its derived `PRESELECT_REACHABLE` set before rewording (the arm that emits it is the credential arm) |
| `AllocatorExchangeManager.test.tsx`, `AllocatorExchangeManager.feeds.test.tsx` | Extraction must keep the `allocator-delete-*` testids and strings byte-identical |

Tests/pins found **not** to need changes: `critical-regressions.test.ts` (`grep -acE 'localStorage|WizardClient|create-with-key|add-key|set-members|MultiKeyConnectStep|ScenarioComposer|StrategyTable|queries\.ts|wizardErrors|closed-sets|AllocatorExchangeManager|StrategiesSection|strategies/page|disconnect_allocator'` over it printed 0, which covers the files this phase edits) and `key-storage-census.test.ts` (only a copy-vocabulary scan, see Project Constraints).

## Section (c) — measurements

### Every route an MT5 key reaches composite membership
Measured, not assumed:
1. **`MultiKeyConnectStep` roster entry** (`EXCHANGES`, the `...(MT5_UI_ENABLED ? [{ id: "mt5" … }] : [])` block): lets a user pick MT5 in a member panel.
2. **`enterMulti` carry-over** (153.4 CR-03): copies `singleDraftRef.current` (including `exchange`) into panel 1, so an MT5 single-key draft becomes a member panel with the card's strings.
3. **Rehydration** (`toRehydratedPanel`): a resumed composite draft's members arrive as `exchange: member.exchange as ExchangeId`, already `validated`. A legacy MT5 member would render with **no roster entry**, so the panel summary (`active?.name`) is blank; the planner should fall back to the venue label so the user can see which key to remove. (PROD has 0 such members per CONTEXT, [CITED: CONTEXT.md]; TEST and local data are not measured.)
4. **`composite/add-key`**: accepts `mt5` today (`isSupportedExchange`; `isMt5` carve-outs; `isMt5EnabledServer()` gate).
5. **`composite/set-members`** → RPC `set_wizard_composite_members`: attaches any owned `api_key_id` by id.
6. **Outside the two routes** — writers of `strategy_keys`: the only SQL function that INSERTs it is `set_wizard_composite_members` (baseline); `src/` reads the table in many places and writes it nowhere else; no `analytics-service` writer. **But** the table is directly writable by an authenticated owner: `CREATE POLICY "strategy_keys_owner" … TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()))` and `GRANT SELECT,INSERT,REFERENCES,DELETE,UPDATE ON TABLE "public"."strategy_keys" TO "authenticated"` [VERIFIED: baseline], and `set_wizard_composite_members` is `GRANT … TO "authenticated"`. So a crafted PostgREST call can attach an MT5 key regardless of any TS guard. CONTEXT accepts "No SQL change"; record the bound (the worker's `run_stitch_composite_job` fails loudly on such a member per ROADMAP [CITED: ROADMAP `### Phase 213:` goal, not independently re-verified in `analytics-service`]).

### Where the new code must be registered
Recommended name `COMPOSITE_MT5_UNSUPPORTED` (UI-SPEC §3.3; the planner may rename). Registration points:
- `src/lib/wizardErrors.ts`: the `WizardErrorCode` union (next to `COMPOSITE_TOO_MANY_MEMBERS` / `COMPOSITE_UNSUPPORTED_UNIFIED`) and a `WIZARD_ERROR_COPY` entry. No `fixRequires` needed. `actions: ["expand_log"]` has precedent (a `METADATA_` entry uses exactly `["expand_log"]`), and `RECOVERABLE_ACTIONS` is `{"clear_and_retry","try_another_key"}` [VERIFIED: `src/lib/envelope.ts`], so `recoverable` derives `false`.
- `MultiKeyConnectStep.tsx`: `KNOWN_ADD_KEY_CODES` **and** `KNOWN_SET_MEMBERS_CODES` (the latter does not translate: an unlisted code renders `UNKNOWN`).
- Not `ConnectKeyStep`'s `KNOWN_CREATE_WITH_KEY_CODES` (create-with-key is untouched).

### Census arithmetic (derived from reading the tests; re-measure by running, which this session could not)
Choice 1 — **status 400 with `{ code, error }` literal** (consistent with the sibling `KEY_VENUE_NOT_ENABLED` guard, and the shape `wizardErrors.invariant.test.ts` expects):
- `ROUTES` entry `composite/add-key`: `expectedSites` 12 → 13 (derived population is `{ code: …, error: … }, { status: 400`). The measured total in that file's prose (60) → 61; `DERIVED_FLOOR = 36` unaffected.
- `EXPECTED_SPLIT_CODES` (six members today) → gains the new code (seven): the split-route union is closed.
- The mirror law ("the two KEY-VALIDATION routes emit the SAME set of codes") would red unless the code joins `MIRROR_EXEMPT` (today `["PRESELECT_REQUEST_INVALID"]`). The law polices the exemption: the code must be emitted by exactly one of the two routes (add-key only), which holds.
- Coverage law: union member + `KNOWN_ADD_KEY_CODES` row required or it reds by name.
- `wizardErrors.roster-render.test.tsx` derives its population from the route sources (rosters, alias map and `code: "X"` literals) and drives each code through the real step: the new code on `composite/add-key` (and the `{ code }` literal on `composite/set-members`) is picked up automatically; a missing roster row renders `UNKNOWN` and reds.

Choice 2 — status 409/422: outside the derived 400 population, so `expectedSites`, `EXPECTED_SPLIT_CODES` and the mirror law are untouched, and the roster row is owed by hand; the roster-render population (source (c), any status) still catches an omission. Not recommended: it diverges from the neighbouring guards.

`composite/set-members` is **not** in `ROUTES` (its 400s are `{ code }` without `error:`), so its new emitter is unscanned except by roster-render; the user-scoped `from("api_keys").select("id, exchange")` read needs the route test's `createClient` mock extended (today it only provides `rpc`). Fail loud: a faulted read must refuse (500 `UNKNOWN`), never pass.

Seam censuses that list the rosters (`seam-wire-vocabulary.invariant.test.ts`, `seam-ratelimit-posture.invariant.test.ts`, `seam-transport-attribution.invariant.test.ts`) assert roster *names* and wire-table overlaps, not member counts; they should stay green and must be run. The `EXPECTED_TABLE_SIZE` copy-table literal named in old comments no longer exists in any live test: repo-wide grep finds it only in comments, `CHANGELOG.md` and `.planning/**` [VERIFIED: grep over `*.ts, *.tsx, *.mjs, *.js, *.md`]. The only sweeps over the whole copy table are `ConnectKeyStep.preselect-refusal-class.test.tsx` (membership check for preselect-reachable codes) and `SubmitStep.test.tsx` (filters `METADATA_*`); neither counts.

### Dead guards after the refusal (decision for the planner)
Placing the refusal ahead of the `MT5_ENABLED` gate makes two add-key guards unreachable: the `isMt5 && !isMt5EnabledServer()` gate and the MT5 three-credential guard. Consequences:
- `route.test.ts` hand-typed table `SITES` asserts `expect(SITES.length).toBe(12)` and drives every row; its two MT5 rows (`"mt5 venue switch is off …"` expecting `KEY_VENUE_NOT_ENABLED`, `"mt5 investor password absent …"` expecting `KEY_MISSING_REQUIRED_FIELD` under `MT5_ENABLED=true`) can no longer be reached.
- Arithmetic: keep the dead guards → source emitter count 13 vs reachable table rows 11 (12 − 2 + 1): they diverge by design and the test text must say so. Delete the dead guards → both numbers are 11 and consistent, at the cost of a wider diff in a route that has other MT5-aware lines (`isMt5` api-key shape ternary, venue handling). Recommendation: keep (Rule 3, surgical; the guards are the tripwire if the refusal is ever lifted when the stitch job gains an MT5 arm), annotate with a dated comment, and say so in the tests.
- Add-key tests that assert MT5 is **accepted**/gated and therefore change: `describe("… mt5 acceptance (MT5SRC-03)")` — three of its four cases (accepts `exchange=mt5`; api_secret-required 400; short login accepted) invert to the new refusal, the unsupported-exchange case stays; `describe("… mt5 server gate (MT5_ENABLED off)")` — the `it.each(["mt5","MT5","Mt5"])` (3 cases) answers the new code, the "does NOT gate ccxt" case stays; plus the two `SITES` rows above and the file's own comment ("MT5 cannot be a composite member — so this cannot fire today"). Also update the production comment block in `add-key/route.ts` ("cannot be a composite member anyway (the stitch worker has no mt5 arm; ROADMAP 153.6 records it as out of scope)").

### MultiKeyConnectStep tests that lose their premise (counts)
- `MultiKeyConnectStep.test.tsx` `describe("[CR-03] … a draft-carried MT5 panel keeps its broker server")`: 3 cases drive `mt5Panel()` (State A on MT5 → click `multi-add-key` → panel); with the footer note replacing the button they cannot run. The "flag OFF: no MT5 card" case stays. The "THE CLASS GUARD" roster-parity case compares the two rosters' rendered cards with MT5 on and must gain the named MT5 exception (UI-SPEC §3.1).
- `describe("[153.4-05 / WIZFORM-05] … the honest long wait, per panel")`: **9 tests** build an MT5 panel 0 through `mixedVenuePanels()` (8 call sites) or `renderFresh(true)` + `enterMultiFromMt5Draft()` (1). MT5 is the only serialized/non-substitutable venue (`venueIsSubstitutable`), so their MT5-panel premise is gone; the planner must read them and either re-seat the venue-independent behaviours onto ccxt panels or delete each with a recorded reason. This is the largest test rewrite in the phase.
- `MultiKeyConnectStep.credential-input.test.tsx`: the MT5 "Broker server" panel test (State A on MT5 → `multi-add-key`) and `renderPanel1OnMt5` (2 tests: D-08 investor-password paste kept verbatim, login still stripped; it selects `key-1-exchange-mt5`). Those D-08 / D-76 behaviours also live in the single-key step; re-home or delete with a reason.
- `wizardErrors.roster-render.test.tsx` and e2e specs that click `multi-add-key` (`e2e/wizard-axe.spec.ts`, `e2e/composite-onboarding.spec.ts`) use ccxt venues: unaffected.

### Footer note (UI-SPEC §3.2) implementation seam
`MultiKeyConnectStep.onSingleDraftChange` only writes `singleDraftRef` and `setSingleDraftDirty`, so the footer cannot react to the draft's exchange. Add one piece of state for the draft's exchange (set from the same callback; `ConnectKeyStep` reports `{ exchange, … }` from an effect on every credential change including a restored exchange), and render the note `data-testid="multi-add-key-mt5-note"` instead of `multi-add-key` while it equals `"mt5"`. `enterMulti` also early-returns for an MT5 draft.

## Section (d) — measurements

- **`blendPeriodsPerYear`** [VERIFIED: `src/lib/closed-sets.ts`]:
  ```ts
  export function blendPeriodsPerYear(
    legs: ReadonlyArray<{ asset_class?: string | null }>,
  ): number {
    // EMPTY → 252 falls out of `.some()` on an empty array — no guard needed.
    return legs.some((l) => l.asset_class === "crypto" || l.asset_class == null)
      ? 365
      : 252;
  }
  ```
  Other callers (unchanged, server-resolved asset classes): `share-resolve.ts`, `scenario-compare.ts`, `queries.ts`, `intro/snapshot.ts`.
- **`ScenarioComposer` `blendBasis`** is derived from the *selected* engine-set legs only (`engineSet.strategies.filter((s) => engineState.selected[s.id])`); `computeScenario(..., blendBasis)` is the only place basis changes numbers: `volatility = volDaily * Math.sqrt(periodsPerYear)`, Sharpe via `returnStatsSharpe(portDaily, { periodsPerYear, ddof: 1 })`, Sortino via `periodsPerYear`; CAGR, TWR and `max_drawdown` ride the calendar clock and are invariant [VERIFIED: `src/lib/scenario.ts` comment block and lines computing `volatility`, `sharpe`, `downsideVol`].
- **Consumers of `blendBasis` / basis-dependent output** (grep `blendBasis` in `ScenarioComposer.tsx`, then read): `scenarioMetrics` (engine call) → `gatedBlendMetrics` (the "Scenario blend" `KpiStrip`: volatility, Sharpe, Sortino, and `cagr` via `gatedValue`); `blendRecord` (`figureRecord({ periodsPerYear: blendBasis })`; `crypto = periodsPerYear === 365` switches D-15's bound between 90 covered days and 60 observations) → `blendGateState` → `blendGateNote`, `rollingVerdict`, `sharpeDeltaState`; `peerSharpe` / `peerSortino` → `buildScenarioPeerRankRequest` → `/api/scenario/peer-rank`; `blendPanels = deriveBlendPanels(..., blendBasis)` and the caption `…-day rolling window · {blendBasis}-day annualized · …`; `scenarioOwnBookDelta` (`sampleBasisRatios(bookReturns, blendBasis)` and both `figureRecord`s); `<ScenarioFactsheetChart periodsPerYear={blendBasis}>`; `<ScenarioBenchmarkSection periodsPerYear={blendBasis}>`; the Max-DD target solve (`solveLeverageForMaxDD`).
- **Not basis-dependent** (verified): the Max-DD target solve — `solve-leverage.ts` docblock says "`@param args.periodsPerYear the engine annualization (max_drawdown is invariant to it)`" and the code comments "`max_drawdown` is annualization-invariant, so `periodsPerYear` only rides along for signature fidelity" [VERIFIED: Read of `src/app/(dashboard)/allocations/lib/solve-leverage.ts`]. So UI-SPEC §4.3's conditional resolves to **not held** (no refusal path needed; a solved leverage is also what Save folds into the draft, and it is basis-free). Monte Carlo (`scenario-montecarlo.ts`) takes a *horizon* in trading days (`MC_HORIZON_DEFAULT = 252`), not a basis; stress (`scenario-stress.ts`) has no `periodsPerYear`.
- **`ScenarioFactsheetChart` is the heaviest consumer.** It renders the whole `FactsheetBody` from a synthesized payload built by `buildScenarioFactsheetPayload` → `buildReturnsBody(portfolioDaily, periodsPerYear)` [VERIFIED: Read of `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts:337-491`]. Fields that ride `periodsPerYear` there: `strategyMetrics` (from `const { eq, dd, ...strategyMetrics } = compute(rets, datesR, 0, periodsPerYear);` :398; which keys of `compute()`'s summary are basis-dependent was not read, see `src/lib/factsheet/compute.ts`), `figureRecord` / `record` (:404-414, the gate's crypto flag), `rollingWindow.annualization` and `rollingWindow1y.annualization` (`gateRollingWindow(record, …)` :418, :438), `strategyRollingVol` / `strategyRollingSharpe` / `strategyRollingSortino` (:453-455), the three `1y` rolling series from `rollingCalendarStats(…, periodsPerYear)` (:430, :458-460), and `bootstrapCI(rets, 2000, 5, 42, periodsPerYear)` (:477). Basis-invariant in the same body: `dates`, `strategyEquity`, `strategyDrawdowns`, `strategyReturns`, `strategyWorst10`, `streaks`, `calmarByYear(rets, datesR)`, `monthlyReturns`, `dailyHeatmap`, `stressWindows`, `quantiles`. The nearest existing "silent dash" mechanism is the function's own degenerate branch (:353-378): `strategyMetrics: emptyComputeSummary()`, `bootstrapCI: emptyBootstrapCI()`, the rolling arrays `[]`, `rollingWindow: emptyBlendRollingWindow()`, `figureRecord: null`. A pending hold can reuse exactly those empty counterparts for the basis-dependent fields only, keeping the equity and drawdown charts. **Not read:** how `FactsheetBody` / `MetricsColumn` / the rolling panels render an empty `rollingWindow` and a null `figureRecord` (whether they print a reason caption, which `213-UI-SPEC.md` §4.2 forbids while pending). The many `src/app/factsheet/[id]/v2/*.test.tsx` files use `buildScenarioFactsheetPayload` as a fixture with default arguments, so an optional extra argument that defaults to today's behaviour does not disturb them; I did not locate a standalone parity test for the builder (the file comments cite "parity with `build-payload.ts`"), so grep for one during planning. Highest-uncertainty item in the phase; see Open Question 5.
- **Pending signal (F5).** Settle bookkeeping [VERIFIED by reading `fetchAddedReturns`]: success → `settle()` writes `addedReturnsById[id]`, `addedAssetClassById[id]` (string or `null`), `addedMetricsById[id]` together and clears the in-flight flag; failure → `markMetricsUnavailable()` writes only `addedMetricsById[id] = "unavailable"`, leaves `addedReturnsById[id]` undefined (so remove + re-add retries) and `clearInflight()`; abort → nothing written. `addedStrategyMetadataLookup[id].metricsState` is `"settled"` for a book leg (`found != null`), `"pending"` when `lazyMetrics === undefined`, `"unavailable"` for the failure marker. The effect `useEffect(… for (const a of scenario.draft.addedStrategies) { if (!strategyById.has(a.id) && addedReturnsById[a.id] === undefined) fetchAddedReturns(a.id); } …, [scenario.draft.addedStrategies, strategyById, addedReturnsById, fetchAddedReturns])` re-fires for a failed leg whenever another leg settles, and `fetchAddedReturns` early-returns only while `lazyAbortRef` still holds the id (it was deleted on failure). The retry does not reset `addedMetricsById[id]`, so `metricsState` reads `"unavailable"` while the retry is in flight and a successful retry can flip 365 → 252 *after* the composer showed numbers on the null → 365 rule. **This is the open decision recorded as F5** (three options; option 1, making failure terminal for the effect, is recommended); `loadingReturnsIds.has(id) || metricsState === "pending"` alone leaves a number → blank → number sequence on the commit where another leg settles. Add-time ordering is safe: `handleAddStrategy` calls `scenario.addStrategyBrowse(s)` and `fetchAddedReturns(s.id)` in one handler (batched), and a reopened scenario's legs are `pending` on the first render until the effect fires.
- **Literal "every leg" vs selected legs.** UI-SPEC §4.1 implements every leg of the engine set, selected or not (locked wording); the narrower reading (selected only) is recorded there as a founder-review alternative. Both always terminate.
- **Save / commit / share persist no figure.** `postNewScenario` body is `{ name, draft: setLeverageOverrides(setMemberKeyIds(scenario.draft, …), pruneLeverageToDraftRefs(…)) }`; `putUpdateScenario` sends `{ name, draft }`; `handleCommit` builds `voluntary_add` diffs from weights and AUM only and the drawer receives `diffs`, AUM, fingerprint; the peer-rank route calls the read-only RPC `get_verified_cohort_rank`; the share routes carry no metrics and the shared view recomputes server-side (`share-resolve.ts` calls `blendPeriodsPerYear` on strategies with DB asset class) [VERIFIED by reading each]. A structural pin ("the POST/PUT body keys are `name` and `draft`; no `sharpe|sortino|volatility` token in either body builder") makes this durable without new copy or disabled controls.

### Tests that move for (d)
`ScenarioComposer.test.tsx` (about 11k lines; BLEND-01 / RANK-06 blocks near "Phase 84 Plan 05 (BLEND-01) — the blend-basis headline regression pins": tests that add a drawer leg and read a number while the fetch is unsettled), `ScenarioComposer.d11.test.tsx` (mocks `blendPeriodsPerYear` via `vi.mocked(blendPeriodsPerYear).mockReturnValue(252)`; a hold derived outside that function keeps it valid), `ScenarioComposer.added-metrics.test.tsx` (the `pending`/`settled`/`unavailable` contract), `ScenarioComposer.constituent-figure-gate.test.tsx`, `ScenarioComposer.save.test.tsx`. Any test that expects Volatility/Sharpe/Sortino to render a number while an added leg's `/returns` is unresolved now expects `—` until settle, and each moved expectation needs the supersession stated.

## Censuses and contract tests a new code, control or copy will move (summary)
| Census / contract | Moves for |
|---|---|
| `wizardErrors.invariant.test.ts`: `ROUTES` `expectedSites` (add-key 12 → 13), `EXPECTED_SPLIT_CODES`, `MIRROR_EXEMPT`, coverage law | (c) status-400 choice |
| `wizardErrors.roster-render.test.tsx` (derived population) | (c) automatic row; rosters must admit the code |
| `create-with-key/route.test.ts` (F6 `toEqual`) | (a) |
| `localStorage.test.ts`, arity contract docblock, `contracts-registry.test.ts` row text | (a) |
| `StrategiesLegend.test.tsx` pipeline definition | (b) |
| `StrategyTable.default-mounts.test.tsx` owner mount pin; `StrategyTable.pending-chip.test.tsx` td/th parity | (b) |
| `page.merged.test.tsx` manager read; `queries.my-strategies.test.ts` eligibility; phase-149 pin 8 | (b) |
| `composite/add-key/route.test.ts` acceptance, gate and `SITES` (`toBe(12)`) | (c) |
| `MultiKeyConnectStep.test.tsx` CR-03 block, class guard, 9 long-wait tests; `.credential-input.test.tsx` MT5 panel tests | (c) |
| `ScenarioComposer*.test.tsx` | (d) |
| `key-storage-census.test.ts` | any new copy or comment containing `per-user`, `Vault`, `AES`, `KEK`, `DEK`, `Fernet`, `envelope encryption` |
| `critical-regressions.test.ts` | none found |
| `dialog-envelope.invariant.test.ts` | its rosters are the dashboard-dialog routes; the new code is not in them (run it) |

## Migration answer (success criterion 5)
**None needed.** (a) is TS in the browser module and one route object; (b) reuses a live, granted, owner-scoped RPC and a partial unique index whose predicate already excludes disconnected rows; (c) is two TS route guards plus UI; (d) is client state. The only candidate for a migration is making F2 exact (RPC replay flag), which is a decision, not a requirement, and is recommended against. If the founder wants F2 exact, the exact reason is: both `create_wizard_strategy` and `create_wizard_strategy_for_key` `RETURNS TABLE(strategy_id, api_key_id)` with no replay indicator, so the route cannot tell replay from mint; that change needs `DROP` + `CREATE`, a re-issued REVOKE/GRANT pair, a baseline re-dump, and migration-reviewer + rls-policy-auditor clean before merge (ROADMAP SC-5).

## TODOS ids this phase closes (item 8)
- `grep -acF` over `TODOS.md`: `164.2.1-INCOMING-NULL-CONFLATION` → 0, `D-161-05-A` → 0, `159-BASIS-FLIP` → 0, `MT5 as a composite member` → 0, `0.08` → 0 hits, and the `0e` token has no entry line. All four are already absent (removed by the #1267 sweep, per CONTEXT) [VERIFIED: grep this session].
- Still citing them: `CHANGELOG.md` line 158 (history, leave) and `.planning/ROADMAP.md` `### Phase 213:` (the closing sentence; the phase's own record). Pointers to the retired 153.6 OUT line in code: `src/app/api/strategies/composite/add-key/route.ts` (the 23505 venue-arm comment: "MT5 … cannot be a composite member anyway (the stitch worker has no mt5 arm; ROADMAP 153.6 records it as out of scope)") and `src/app/api/strategies/composite/add-key/route.test.ts` ("MT5 cannot be a composite member — so this cannot fire today"); both comments become true-by-guard after (c) and should cite decision (c) instead. No code, test or doc cites `D-161-05-A` or `159-BASIS-FLIP`. At ship, per CLAUDE.md rule (b): re-run `grep -aF` per id, say so in the CHANGELOG, and fix any pointer.

## Common Pitfalls

### Pitfall 1: over-declining a composite draft (F1)
**What goes wrong:** the literal rule drops the composite draft's session id; the next add-key under a fresh id forks a second composite draft.
**Why:** composite pointers store the first member's key id while the composite row's `api_key_id` is null.
**How to avoid:** the `sameDraftOnScreen` clause; unit pin 4 above.
**Warning signs:** `wizard_session_id_not_restored` events with the new label on resumed composites.

### Pitfall 2: a benign over-decline when the draft was deleted
Stored pointer for key A, draft deleted elsewhere → `initialDraft` null, incoming null → declined → one fresh token. Harmless (the F6 SELECT finds nothing for the old id anyway); accepted, and counted by the new telemetry label.

### Pitfall 3: widening the list by editing the shared predicate (F4)
Editing `isPerKeyDailiesEligibleKey` changes the allocator gate (`allActiveKeysHavePerKeyDailies`) and diverges from the Python backfill. Filter on `disconnected_at == null` in `deriveStrategylessKeys` and carry the predicate as a flag.

### Pitfall 4: the two-door MT5 bypass
TS guards do not stop a direct PostgREST insert into `strategy_keys` or a direct `set_wizard_composite_members` call. State the bound; do not claim "MT5 cannot be a composite member" as a database invariant.

### Pitfall 5: a held consumer that prints a false cause
`ScenarioBenchmarkSection` prints "Benchmark comparison unavailable" in its empty branch; holding by routing into that branch states a cause that is not true while pending.

### Pitfall 6: the notice on every double-click
Adding `deduped` to the F6 arm makes the dedup notice appear for an ordinary retry. Intended by CONTEXT's default and flagged in `213-UI-SPEC.md`; do not "fix" it by dropping the flag.

### Pitfall 7: mock-only proof of "reconnect works"
A vitest mock cannot prove the database releases the venue slot. The real proof is the SQL arm 6b plus the resolver filter; see Validation.

### Pitfall 8: two parallel executors on one file
`src/lib/wizardErrors.ts` ((b) KEY_ORPHANED and (c) new code) and `create-with-key/route.ts` ((a) F6 arm and prose edits for (b)) — sequence these.

## Code Examples

### The F6 arm after the change (a)
```ts
// source: src/app/api/strategies/create-with-key/route.ts F6 session fence (HEAD), additive field only
if (existingDraft?.id && existingDraft.api_key_id) {
  return NextResponse.json(
    {
      ok: true,
      strategy_id: existingDraft.id,
      api_key_id: existingDraft.api_key_id,
      deduped: true,
    },
    { headers: NO_STORE_HEADERS },
  );
}
```

### Placeholder list widened with a flag (b, F4)
```ts
// source: derived from src/lib/queries.ts deriveStrategylessKeys (HEAD); keeps the
// token isPerKeyDailiesEligibleKey in the body (phase-149 pin 8)
return keys
  .filter((k) => k.disconnected_at == null)
  .filter((k) => !covered.has(k.id))
  .map((k) => ({
    id: k.id,
    exchange: k.exchange as SupportedExchange,
    label: k.label,
    finishSetupEligible: isPerKeyDailiesEligibleKey(k),
    syncStatus: k.sync_status,
  }));
```

### Disconnect call (b)
```ts
// source: src/components/exchanges/AllocatorExchangeManager.tsx handleDeleteKey (HEAD), the Disconnect branch
const { error } = await supabase.rpc("disconnect_allocator_api_key", { p_api_key_id: keyId });
if (error) { setDeleteError("Could not disconnect this key. Please try again."); return; }
```

### set-members guard (c), shape only
```ts
// before set_wizard_composite_members; user-scoped client; exchange is in API_KEY_USER_COLUMNS
const { data: owned, error: readErr } = await supabase
  .from("api_keys").select("id, exchange").in("id", members.map((m) => m.api_key_id)).eq("user_id", user.id);
if (readErr) return NextResponse.json({ code: "UNKNOWN" }, { status: 500, headers: NO_STORE_HEADERS }); // fail loud
if (owned?.some((k) => k.exchange === "mt5")) {
  return NextResponse.json({ code: "COMPOSITE_MT5_UNSUPPORTED" }, { status: 409, headers: NO_STORE_HEADERS });
}
```

### Composer hold (d), shape only
```ts
const legsPending = engineSet.strategies.some((s) => {
  const meta = addedStrategyMetadataLookup[s.id];
  if (meta === undefined) return false; // book leg: resolved from the SSR payload
  return loadingReturnsIds.has(s.id) || meta.metricsState === "pending";
});
// heldMetrics = legsPending ? { ...gatedBlendMetrics, volatility: null, sharpe: null, sortino: null } : gatedBlendMetrics
// peerSharpe / peerSortino = legsPending ? null : scenarioMetrics.<field>   (request suppressed)
```

## State of the Art

| Old approach | Current approach | Changed | Impact |
|---|---|---|---|
| Unknown incoming key permissive (164.2.1 D-01) | Unknown meeting a stored key declines | 2026-11-14 decision (a) | Stored key-A token never reaches a key-B submit |
| `deduped` on venue/reuse arms only | Also on the F6 session fence | decision (a) | One more notice on ordinary retry |
| No Disconnect for a strategyless key on `/strategies` (manager not even listed) | Row-level Disconnect for every role | decision (b) | Supersedes the Phase 199 plan-10 `isAllocator` gate on the placeholder read |
| MT5 offered as a composite member under the flag | Refused by name | decision (c) | Retires the CR-03 member-panel path |
| Basis flips mid-render when a drawer leg's probe settles | Held until legs settle | decision (d) | Supersedes 159-04's "render on the interim basis" |

**Deprecated/outdated:** the `KEY_ORPHANED` docblock claim that the only Disconnect list is allocator-only (F3); the add-key comment citing ROADMAP 153.6 as the MT5 composite exclusion; `wizardErrors.ts` comment calling the session-id restore "UNCONDITIONAL".

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | `run_stitch_composite_job` has no MT5 arm and an MT5 member's job fails permanently (ROADMAP wording; not re-verified in `analytics-service` this session) | Summary, § (c) | The rationale for (c) is the founder's; low risk to the build, but the CHANGELOG should cite it as the founder's premise, not as a measurement |
| A2 | PROD has 0 MT5 composite members (CONTEXT, measured by the founder via MCP; no DB queried here) | § (c) | If wrong, a rehydrated MT5 panel exists for someone; the fallback venue name and the set-members refusal give the user a way out |
| A3 | `213-UI-SPEC.md` copy strings are final (its checker sign-off table is unticked "pending" although `status: approved`) | § (b), (c) | Copy edits late in the phase move the pins listed above |
| A4 | The `ConnectKeyStep.preselect-refusal-class` sweep does not include `KEY_ORPHANED` (not verified: the derived `PRESELECT_REACHABLE` set was not enumerated) | § (b) tests | The reworded `KEY_ORPHANED` copy could trip a banned-phrase or painted-label check |
| A5 | The factsheet preview's basis-dependent panels are the list in § (d) (grep-observed field names, panels not read) | § (d) | A missed panel shows an interim-basis number |
| A6 | Census arithmetic (`expectedSites` 13, `EXPECTED_SPLIT_CODES` 7, mirror exemption) was derived by reading, not by running (no `node_modules`) | § (c) | Re-measure by running the invariant suite once the worktree has dependencies |

## Open Questions (RESOLVED)

Resolutions (planning, 2026-11-14; founder confirmation at hand-back where noted):
- Q1 → RESOLVED by CONTEXT clarification F2: no migration; the RPC-internal replay is a named residual (plan 213-02, CHANGELOG `### Notes`).
- Q2 → RESOLVED by CONTEXT clarification F1: the `sameDraftOnScreen` clause, pinned by the composite control pin (plan 213-01).
- Q3 → RESOLVED by CONTEXT clarification F3: no "Profile → API keys" remedy in the copy; stale docblock sentences get dated CORRECTED notes (plan 213-07). This overrides the recommendation written below.
- Q4 → RESOLVED in plan 213-04: kept; a manager's "Finish setup" runs the contribution entry and finalizes to `private` (flagged for founder review).
- Q5 → RESOLVED in plan 213-10: one optional `basisPending` input to `buildScenarioFactsheetPayload`; the slot map is recorded there, with three fields the executor measures under a STOP rule.
- Q6 → RESOLVED in plan 213-04: no `Finish setup →` on a newly listed inactive or revoked orphan.


1. **Does the founder accept the F2 bound?**
   - Known: arms 1–3 and 5 can carry `deduped` with TS only; the two RPC-internal replays cannot be discriminated without changing `RETURNS TABLE`.
   - Unclear: whether "whenever it returns an existing draft" was meant to include the race/read-fault replay.
   - Recommendation: no migration; record the residual in the plan and CHANGELOG `### Notes`; ask in the hand-back.
2. **Does the founder accept the F1 refinement of the locked "how"?**
   - Known: the literal rule regresses composite resume and forks composite drafts.
   - Recommendation: use the `sameDraftOnScreen` clause (no new parameter); state it as a clarification, with unit pin 4 as the guard.
3. **How should the `KEY_ORPHANED` copy treat the Profile → API keys surface (F3)?**
   - Known: every role has an API keys tab listing every key with a release control; `213-UI-SPEC.md` fix[3] sends users to the contact form when the Strategies page does not list the key.
   - Unclear: whether to add a reachable "or remove it under Profile → API keys" line (copy is Claude's discretion, under "name only remedies that are reachable").
   - Recommendation: add it and keep fix[3] only for a failed placeholder read; flag in the hand-back. Also ask whether the stale "allocator-only" statements in `wizardErrors.ts` / `create-with-key/route.ts` docblocks should be corrected in this phase (recommended: yes, prose only).
4. **Is it intended that a manager's "Finish setup" runs the contribution entry (capital question, `private` terminal status)?** It works mechanically; the outcome differs from the manager wizard. Recommendation: keep (CONTEXT says reuse), name it in the hand-back; revisit only if the founder objects.
5. **Factsheet-preview hold design.** Which `FactsheetBody` panels read the basis-dependent fields, and how should each render `—` silently? Recommendation: the planner reads `FactsheetBody` / `MetricsColumn` and records the slot list in the plan before coding; prefer one `basisPending` input to `buildScenarioFactsheetPayload` that nulls the basis-dependent fields, over reusing gate "withheld" states (they print a cause).
6. **Placeholder row for a newly-listed revoked orphan: show `Finish setup →`?** Server accepts it; recommended no (a draft over a revoked key never syncs). Record the measured answer in the plan (UI-SPEC asks for it).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node 22 | vitest | yes | v22.22.1 at `/opt/homebrew/opt/node@22/bin/node` | — |
| `node_modules` in the 213 worktree | every test command | **no** (`ls node_modules` → no such directory) | — | run `npm ci` in the worktree before Wave 1; `npx vitest` without an install resolves a cached vitest that fails at `vitest.config.ts` with `MODULE_NOT_FOUND` (observed once in this session) |
| Supabase / any database | none (no migration, no DB query in this phase) | n/a | — | — |
| Playwright / e2e | optional UI measurement | not checked | — | component tests cover the contracts |

**Missing, blocking until installed:** `node_modules` (Wave 0). No test was run in this session, so nothing in this document claims a test passes at HEAD.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (node + jsdom projects) via `vitest.config.ts`; `@testing-library/react` for components |
| Config file | `vitest.config.ts` (includes `src/**/*.test.{ts,tsx}` and `scripts/**` tests) |
| Quick run command | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <files>` (after `npm ci`) |
| Full suite command | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test` (`package.json` `scripts.test` is `vitest run`, :13; `scripts.test:coverage` is `vitest run --coverage`, :15); `npm run lint` also runs `scripts/check-planning-hygiene.ts` |

### Phase Requirements → Test Map
| SC | Behavior | Test type | Automated command | File exists? |
|----|----------|-----------|-------------------|--------------|
| SC-1a | unknown incoming key + stored string key → no `wizardSessionId`; csv literal null still restores; composite draft on screen still restores; stale pointer declines | unit | `npx vitest run src/lib/wizard/localStorage.test.ts src/lib/wizard/derive-resume-overrides-arity.contract.test.ts` | file yes; new cases Wave 0/1 |
| SC-1a (wired) | the WIZARD actually posts a fresh id in the unknown case (real `saveWizardState`, no mock of `@/lib/wizard/localStorage`; await hydration with `toHaveBeenCalledWith`, never a call count, per the file's own rules) | component | `npx vitest run "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.sessionid-fence.test.tsx"` | file yes; add one case mounting `WizardClient` directly (as the keyless-draft pin does) |
| SC-1b | F6 arm answers `deduped: true`; first connect has no `deduped`; other arms unchanged | route | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts` | yes (update `toEqual`) |
| SC-1b (UI) | credential-path `deduped` reaches the notice; reuse-arm `deduped` still shows no notice | component | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx" "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx" "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx"` | yes |
| SC-2a | manager page reads placeholders, not the portfolio; revoked/inactive orphans listed, disconnected not | unit/page | `npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx" src/lib/queries.my-strategies.test.ts src/__tests__/phase-149-my-strategies-parity.test.ts` | yes (update) |
| SC-2b | Disconnect on the row opens the Disconnect-only confirm (no Delete, no cascade), feeds note, RPC called with the row id, error line, row gone + announcement + focus after refresh | component | new `StrategiesSection.disconnect.test.tsx` (+ `StrategyTable.pending-chip.test.tsx`, `StrategyTable.default-mounts.test.tsx`, `AllocatorExchangeManager*.test.tsx`) | new |
| SC-2c | after Disconnect, the same account is not refused as `KEY_ORPHANED`; `api_keys` row kept | SQL (existing) + route | existing `supabase/tests/test_api_keys_venue_identity_uniq.sql` arm 6b (frees the slot; run by `sql-tests` on the local stack) + route test over a stateful fake whose live-key lookup honours `disconnected_at` | SQL exists; route case new |
| SC-2d | `KEY_ORPHANED` copy names Disconnect, drops the two retired sentences; legend string | unit | `npx vitest run src/lib/wizardErrors.test.ts src/lib/wizardErrors.invariant.test.ts "src/app/(dashboard)/strategies/StrategiesLegend.test.tsx"` | yes |
| SC-3a | no MT5 card in the roster; roster-parity exception; footer note replaces the button with MT5 selected, button returns on another exchange; `enterMulti` refuses; rehydrated MT5 panel keeps a visible name | component | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx" "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.credential-input.test.tsx"` | yes (heavy rewrite) |
| SC-3b | add-key refuses `mt5` with the new code with MT5_ENABLED on AND off, before any validate/encrypt/RPC; set-members refuses, no RPC call, read-fault refuses | route | `npx vitest run src/app/api/strategies/composite/add-key/route.test.ts src/app/api/strategies/composite/set-members/route.test.ts` | yes (update + new) |
| SC-3c | new code in union + both rosters + copy; censuses | invariant | `npx vitest run src/lib/wizardErrors.invariant.test.ts src/lib/wizardErrors.roster-render.test.tsx src/lib/seam-wire-vocabulary.invariant.test.ts src/lib/seam-ratelimit-posture.invariant.test.ts src/lib/seam-transport-attribution.invariant.test.ts` | yes |
| SC-4 | volatility, Sharpe, Sortino (and the other held consumers) read `—` and never a number while a drawer leg's probe is held open or retrying; final basis value appears once on settle; failed probe ends pending; book legs never pending; no peer request while pending | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx" "src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx"` | yes (add held-probe cases) |
| SC-4b | save/commit/share persist no basis figure | unit | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"` + structural pin | add |
| SC-5 | no migration | check | `git diff --stat origin/main -- supabase/` shows no change | n/a |
| SC-6 | every fix goes RED when reverted | neuter protocol (below) | per row | n/a |

### How each must be shown able to fail (neuter → RED → restore from a byte backup; never `git checkout/restore/stash`)
Copy the source file to the scratchpad before editing; run the named test; restore with `cp`.
- (a) rule: delete `!unknownMeetsStoredKey` → unit pin 1 RED; replace it with CONTEXT's literal rule (no `sameDraftOnScreen`) → pin 4 (composite) RED; delete the csv guard → pin 2 RED.
- (a) deduped: delete `deduped: true` on the F6 arm → the F6 route test RED; make every arm answer `deduped` → the "first connect is NOT deduped" vacuity fence RED.
- (b) list: restore `.filter(isPerKeyDailiesEligibleKey)` → the new revoked/inactive-listed case RED; restore the `isAllocator` gate → the manager page case RED.
- (b) Disconnect: replace the RPC name or drop the handler → the component test RED; add a `Delete key` button → the "no delete" assertion RED.
- (b) reconnect proof: for the route layer, remove `.is("disconnected_at", null)` from `resolveByVenueIdentity` → the route test over the stateful fake REDs. The database layer is proven by SQL arm 6b, which `sql-tests` runs on the local stack (CLAUDE.md: `sql-tests` runs the `supabase/tests` corpus on a lane private to its runner via `scripts/local-stack/run.sh`); predicate sensitivity is exercised by the mutation lane (`scripts/mutation-runner/run.mjs`, the `sql-mutation` job) through the `RED-UNDER` annotations that exist in that file. I did not run either lane. If a NEW SQL arm calling `disconnect_allocator_api_key` under a JWT claim were wanted, CLAUDE.md warns a new `supabase/tests` file or arm moves several censuses ("grep them all"); the census list was not enumerated here [ASSUMED: it includes the `scripts/mutation-floors.mjs` floors and `lint-sql-gates`]. Recommendation: do not add a SQL file; rely on arm 6b plus the TS layers.
- (c) refusal: delete the add-key guard → the refusal test RED for both flag states; move it after the flag gate → the flag-off case RED; delete the set-members guard → its test RED; delete the `enterMulti` early return and the footer swap → the footer/`enterMulti` case RED; re-add the roster entry → the roster-parity case RED.
- (d) hold: remove `legsPending` from the held strip → the held-open-probe case RED; for F5, the retry-after-failure case (leg A fails, leg B settles, A's retry succeeds as `traditional`) must show no number on the interim basis, and goes RED if the effect again retries a failed leg (option 1) or if the predicate is `metricsState`-only (option 2 variant).

### Sampling Rate
- **Per task commit:** the single test file(s) the task touched (commands above).
- **Per wave merge:** the invariant/census group (`wizardErrors.*`, seam invariants, `phase-149`, `contracts-registry`, `key-storage-census`) plus the touched component suites.
- **Phase gate:** full suite green and coverage ratchet intact (`vitest.config.ts` thresholds are read live) before `/gsd-verify-work`; CI counts bound to the head SHA.

### Wave 0 Gaps
- [ ] `npm ci` in `quantalyze-213` (no `node_modules` today).
- [ ] New cases: `localStorage.test.ts` pins 1–5; F6 route case; `StrategiesSection.disconnect.test.tsx`; add-key/set-members refusal cases; composer held-probe, retry-after-failure and failed-probe cases.
- [ ] Enumerate the factsheet preview's basis-dependent slots (Open Question 5) before the (d) plan is written.
- [ ] Verify whether `KEY_ORPHANED` is in `PRESELECT_REACHABLE` (A4) before editing its copy.

## Security Domain

`security_enforcement` is not set to `false` in `.planning/config.json`, so it applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | existing `withAuth` on every route |
| V3 Session Management | partly | wizard session id is an idempotency token, not an auth credential; the decline only reduces reuse |
| V4 Access Control | yes | Disconnect: RPC checks `auth.uid()` ownership (42501 otherwise); set-members read is `.eq("user_id", user.id)` on the user-scoped client; tenant scoping on any admin read stays an explicit `user_id` filter |
| V5 Input Validation | yes | `isUuid` on ids; the new set-members guard runs after `keyWindowsSchema` and the `isUuid` member check; closed code sets for the new error |
| V6 Cryptography | no | no secret handled; never log or return a key id beyond what exists today (T-154-06-C: the venue account id never crosses back; `deduped` must not carry it) |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-key session reuse hands key B key A's draft | Tampering / info disclosure | F1-refined decline; F6 fence remains the server backstop |
| Cross-tenant disconnect | Elevation of privilege | RPC ownership check; ids are selection intent only |
| Ownership oracle through distinguishable refusals | Info disclosure | keep one answer for "not yours / gone" (existing reuse-arm discipline); the new MT5 refusal reveals only the caller's own key's venue |
| MT5 member via a direct PostgREST insert / RPC call | Tampering | bounded residual (TS guard is a UX fence); stitch job fails loud |
| Interim-basis figure persisted or ranked | Integrity | hold at the display layer; peer-rank suppressed with null inputs; structural pin on save/commit bodies |

## Sources

### Primary (HIGH — read at HEAD `af96bc00d`)
- `src/lib/wizard/localStorage.ts`, `localStorage.test.ts`, `derive-resume-overrides-arity.contract.test.ts`; `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx`, `page.tsx`, `steps/ConnectKeyStep.tsx`, `steps/MultiKeyConnectStep.tsx`; `ContributionWizardOverlay.tsx` and its `sessionid-fence` / `preselect` tests
- `src/app/api/strategies/create-with-key/route.ts` and `route.test.ts`; `composite/add-key/route.ts` and test; `composite/set-members/route.ts` and test
- `src/lib/wizardErrors.ts`, `wizardErrors.invariant.test.ts`, `wizardErrors.roster-render.test.tsx`, `src/lib/envelope.ts`
- `src/lib/queries.ts` (`deriveStrategylessKeys`, `getStrategylessActiveKeys`, `isPerKeyDailiesEligibleKey`, `getUserApiKeys`); `src/app/(dashboard)/strategies/page.tsx`, `StrategiesSection.tsx`, `StrategiesLegend.tsx`; `src/components/strategy/StrategyTable.tsx`; `src/components/exchanges/AllocatorExchangeManager.tsx`, `ExchangesTabContent.tsx`; `src/components/auth/ProfileTabs.tsx`
- `supabase/schema/baseline.sql` (functions `disconnect_allocator_api_key`, `create_wizard_strategy`, `add_wizard_composite_key`, `set_wizard_composite_members`; the venue-identity index; `strategy_keys` policy and grants); `supabase/migrations/20260422101911_api_keys_disconnected_at.sql`, `20260826130000_create_wizard_strategy_for_key.sql`, `20260812083206_api_keys_venue_account_id.sql`; `supabase/tests/test_api_keys_venue_identity_uniq.sql`
- `src/lib/closed-sets.ts`, `src/lib/scenario.ts`, `src/lib/figure-gate.ts`, `src/lib/scenario-peer-request.ts`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `.../lib/solve-leverage.ts`, `.../widgets/performance/ScenarioFactsheetChart.tsx` and `scenario-factsheet-payload.ts` (grep-observed fields), `src/app/api/scenario/peer-rank/route.ts`, `src/app/api/allocator/scenario/*`
- `.planning/phases/213-*/213-CONTEXT.md`, `213-UI-SPEC.md`, `ROADMAP.md` `### Phase 213:`, `STATE.md` `## Current Position` (213 booked, not started), `REQUIREMENTS.md` (no 213 row), `CLAUDE.md`, `AGENTS.md`

### Secondary (MEDIUM)
- ROADMAP/CONTEXT statements not re-verified here: the stitch job's missing MT5 arm; PROD 0 MT5 composite members.

### Tertiary (LOW)
- None. No web source was used; this is an in-repo phase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new package; every reused module was read.
- Architecture: HIGH for (a), (b), (c); MEDIUM for (d)'s factsheet-preview slot list.
- Pitfalls: HIGH — F1, F3, F4, F5 each traced to the source lines that cause them.
- Census arithmetic: MEDIUM — derived by reading, not by running (no `node_modules`).

**Research date:** 2026-11-14
**Valid until:** 2026-11-21 (fast-moving: many parallel phases touch `wizardErrors.ts`, `create-with-key/route.ts` and the composer; re-resolve symbols before planning)
