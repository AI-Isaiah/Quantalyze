---
phase: "200"
slug: managerkeys-keys-names-and-adding-a-strategy-each-have-one-p
status: verified
threats_open: 0
asvs_level: 1
block_on: high
verified_at_sha: f531e3600b056927f36be437df2d4343ff6b72fa
created: "2026-11-11"
---

# Phase 200 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Audited read-only at branch `feat/200-managerkeys`, HEAD `f531e3600`, over
> `git diff $(git merge-base origin/main HEAD)...HEAD -- . ':!.planning'` (70 files).
> No source file was modified; no stack, build, install or PROD query was run.

**Verdict: SECURED.** 23 of 23 threats resolve: 19 `mitigate` closed against code, 4 `accept` documented below. 0 open (blocking or non-blocking).

Config read through gsd-tools: `workflow.security_asvs_level` = 1, `workflow.security_block_on` = "high", `workflow.security_enforcement` = true. The four focus areas were additionally read end to end at their call boundary rather than by pattern presence, but the register closes at the configured L1. In particular T-200-20 and the role half of T-200-21 are client-side guards: at L2 a wrong-layer check would not close them (see Unregistered Flags item 2).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| browser -> `GET /api/keys/feeds` | authenticated, approved user asks which strategies each of THEIR keys feeds | strategy id, name, status (own rows only) |
| route -> service-role client | admin reads bypass RLS, so ownership is enforced in route code | tenant key and strategy rows |
| browser -> `strategies.api_key_id` (PostgREST) | owner-only RLS (`strategies_update` USING and WITH CHECK `user_id = auth.uid()`) plus `check_strategy_api_key_ownership_trigger` as the cross-tenant backstop | key id |
| browser -> `delete_allocator_api_key` / holdings sync | SECURITY DEFINER RPC checks key ownership only; role gating is a client-side control | key id, cascade flag |
| browser -> `PATCH /api/strategies/[id]/name` | server-side D-17 status gate (`.in("status", ["private","draft"])`) | strategy name |
| public factsheet -> owner-only controls | owner controls on a page public by link | owner-lane render props |
| product copy -> user trust | users decide whether to hand over exchange keys from this copy | storage claim text |

---

## Threat Register

Severity is taken from each plan's `<threat_model>` table; every threat carries one, so no fail-closed `critical` default was needed.

| Threat ID | Category | Component | Severity | Disposition | Evidence | Status |
|-----------|----------|-----------|----------|-------------|----------|--------|
| T-200-01 | Info disclosure | feeds route admin reads | high | mitigate | `src/app/api/keys/feeds/route.ts:73-76` key read `.eq("user_id", user.id)`; `:113-117` single-link read `.eq("user_id", user.id).in("api_key_id", ids)`; `:97-100` composite read scoped `.in("api_key_id", ids)` (owned ids only); `src/lib/key-feeds.ts:82-83` a composite row whose strategy `user_id` differs, or whose embed is missing, is listed with null id/name/status; `route.ts:130-150` counts it to Sentry (stage `coherence`, counts only). Route test fakes filter rows by every `eq`/`in`: `FOREIGN-KEY-ABSENT`, `FOREIGN-SINGLE-LINK-HIDDEN`, `COMPOSITE-FOREIGN-REDACTED`, `ADMIN-OWNER-FILTERS` (`route.test.ts:205-280`). Neuter proof recorded in `200-01-SUMMARY.md` (drop either `.eq` -> RED). | CLOSED |
| T-200-02 | Info disclosure | feeds as existence oracle | medium | mitigate | `route.ts:57` handler is `(_req, user)`; it reads no query, body or path id. The only ids it touches are the caller's own (`:89-92`), and the response map is keyed only by those (`:92`, `:133-134` skips any non-owned key). `FOREIGN-KEY-ABSENT` asserts a foreign key id and strategy never appear in the body. | CLOSED |
| T-200-03 | Info disclosure | tenant data cached | medium | mitigate | `NO_STORE_HEADERS` on every response the route builds: `route.ts:53` (500), `:67` (limiter deny, via `rateLimitDenyJson(rl, { headers })`, merged by `src/lib/ratelimit.ts` `denyHeaders`), `:94` and `:164` (200). `withAuth` stamps it on its own 401 and approval-403 (`src/lib/api/withAuth.ts`). Route registered in `src/__tests__/no-store-coverage.test.ts:131` (count 37 -> 38 lineage at `:139`). `expectNoStore` asserted in the route test, including `RATE-LIMITED`. | CLOSED |
| T-200-04 | DoS | limiter | low | mitigate | `route.ts:58` `checkLimit(userActionLimiter, "key-feeds:<user.id>")` is the first statement after auth, before `createAdminClient()` and any read (`:70`). One call answers every owned key (`SEVEN-KEYS-ONE-CALL`). Classified `NO_INPUT` in `src/lib/api/limiter-ordering.test.ts` (`"keys/feeds/route.ts"`), so an unclassified or mis-ordered limiter fails the gate. | CLOSED |
| T-200-05 | Repudiation | in-app storage copy | medium | mitigate | One sentence, `KEY_STORAGE_SENTENCE` (`src/lib/status-surface-copy.ts:755`), rendered with `KEY_STORAGE_LINK` -> `/security#key-handling` (anchor present at `src/app/(marketing)/security/page.tsx:128-132`). Consumers: `AllocatorExchangeManager.tsx:1765,2025`, `ConnectKeyStep.tsx:204`, `MultiKeyConnectStep.tsx:230` (plus the 192 public pages). `src/__tests__/key-storage-census.test.ts` bans `KEK`, `DEK`, `AES`, `Fernet`, `Vault`, `per-user` (whole word) and `envelope encryption` in every non-test `.ts/.tsx` under `src/app`, `src/components`, `src/lib`, exempting only `/security`, `src/app/api` and the sentence's home file; it carries an anti-vacuity population check and a planted-file matcher self-test. The remaining generic "encrypted at rest" wording on public pages names no mechanism and is recorded under Unregistered Flags item 4. The three restatements this phase removed (`per-user KEK` x2 in `AllocatorExchangeManager.tsx`, `Envelope encryption` in `for-quants/page.tsx`) are gone from the diff. | CLOSED |
| T-200-06 | Info disclosure | copy naming internal key management | low | accept | See Accepted Risks Log AR-200-01. Premise verified: `/security` names the mechanism on purpose (`security/page.tsx:146`, `:297`). | CLOSED (accepted) |
| T-200-07 | Tampering | StrategyForm edit payload | medium | mitigate | `src/components/strategy/StrategyForm.tsx:219` `...(mode === "create" ? { name } : {})`, so an edit never sends `name`. The server rename route is unchanged by this branch and keeps the gate: `src/app/api/strategies/[id]/name/route.ts:200-202` `.eq("id").eq("user_id").in("status", ["private","draft"])`. Renames reach it only through `StrategyNameBlock`, which renders Rename only for `RENAMEABLE_STATUSES` (private, draft). | CLOSED |
| T-200-08 | Tampering | StrategyForm Data Source card | medium | mitigate | Card at `StrategyForm.tsx:306` and the API-key modal at `:356` render only under `mode === "create"`; `handleApiKeySubmit` (`:125`) has no UI entry in edit mode and writes no `strategies` row (it holds the id for the create INSERT, `:234` `mode === "create" && connectedKeyId`). The `.update(...)` at `:241` carries neither `name` nor `api_key_id`. No `update({ api_key_id })` remains in `StrategyForm`. | CLOSED |
| T-200-09 | Tampering | raw PostgREST `name`/`api_key_id` update by an owner on a published row | low | accept | See Accepted Risks Log AR-200-02. Premise verified: `git diff` over `supabase/` for the range is empty (no migration), and the RLS policy is owner-scoped (`baseline.sql` `strategies_update`). | CLOSED (accepted) |
| T-200-10 | Elevation | wizard route guard | low | accept | See Accepted Risks Log AR-200-03. Premise verified: header link only inside `isManager ?` (`src/app/(dashboard)/strategies/page.tsx:1349`); `src/app/(dashboard)/strategies/new/layout.tsx` still calls `requireRolePage(supabase, user, "manager")` and is not in the diff; `new/page.tsx` is a redirect into that guarded subtree. | CLOSED (accepted) |
| T-200-11 | Elevation | owner-only factsheet controls sharing the removed prop | medium | mitigate | `renameTarget` is removed from `FactsheetView.tsx` and `page.tsx` (props, threading, `RenameStrategyDialog` import). The remaining owner-lane controls each keep their own lane-derived render prop gated on `lane === "owner"`: `viewerNotice`, `ownershipMark`, `ownerShare` (`page.tsx:1089-1098`), none of which was gated through `renameTarget`. No non-test reference to `renameTarget` remains in `src`; `page.owner-lane.test.tsx:609-631,666,685` asserts the prop is absent from both the props and the payload, and `FactsheetView.owner-notice.test.tsx` is in the diff and updated. `generateMetadata` now reads `publicNamePreview(...).factsheet`, which is the same `name ?? codename ?? displayStrategyName` chain as before, so no new public disclosure. | CLOSED |
| T-200-12 | Tampering | one-click re-point | medium | mitigate | See "Re-point write" below. The only browser writer of `strategies.api_key_id` is `handleLinkKey` (`src/components/strategy/ApiKeyManager.tsx:876-925`); it runs only after the dialog's Confirm. | CLOSED |
| T-200-13 | Tampering | re-point via raw PostgREST | low | accept | See Accepted Risks Log AR-200-04. Premise verified: `check_strategy_api_key_ownership_trigger` (`supabase/schema/baseline.sql:15674`, function `:1875-1917`, `SECURITY DEFINER`, `FOR SHARE`, raises `insufficient_privilege` on a key not owned by the strategy's user) and `strategies_update` USING + WITH CHECK `user_id = auth.uid()` (`:17032`). No later migration drops either. | CLOSED (accepted) |
| T-200-15 | Tampering | delete silently unlinking strategies | medium | mitigate | `src/app/api/keys/[id]/memberships/route.ts`: ownership equality `api_keys.id = :id AND user_id = session` before any read (same 404 for absent and foreign), uuid check before the limiter, both link kinds returned in `feeds`, every read error a 500 (never an empty list). `AllocatorExchangeManager.tsx` `runDeleteChecks` (`:1096-1129`) reads it before the confirm; `deleteFeedsNote` (`:596-615`) names each fed strategy (a null or blank name prints `FEEDS_UNREADABLE_NAME`, a redacted row never shows another tenant's name) and says `loses its key` / `loses this member` per link kind; an unreadable answer sets `unchecked` (prints `FEEDS_UNCHECKED_COPY`), which holds `Delete key` (`:2273-2277` `feedsUnknownOrOpen`) and the cascading Disconnect (`:2256-2262`), per CONTEXT D-R1. | CLOSED |
| T-200-16 | Tampering | `Change key…` pick | medium | mitigate | Picker option `onClick` only does `setPickerOpen(false); setPendingKeyId(key.id)` (`ApiKeyManager.tsx:1432-1436`); `setPendingKeyId` has no other setter than Confirm/Cancel (`:1693`, `:1698`). The write is `ConfirmKeyChangeDialog`'s `onConfirm` (`:1691-1697`) -> `handleSyncTrades`. Focus starts on Cancel (`ConfirmKeyChangeDialog.tsx`). Neuter proof in `200-06-SUMMARY.md` and `200-11-SUMMARY.md` (`NO-WRITE-BEFORE-CONFIRM` RED). | CLOSED |
| T-200-17 | Tampering | composite/unknown shape re-point | medium | mitigate | `linkControlsAllowed = keyShape === "single"` (`ApiKeyManager.tsx:439`) hides the picker (`:864`) and Resync (`:1571`), and the handlers fail closed independently: `handleLinkKey` throws (`:881-883`), `handleSyncTrades` returns (`:1045`). `LINK_BUTTON_NAMES` (`ApiKeyManager.test.tsx:2945`) lists `Change key…` and the KCS-23 cases (`:4102`, `:4276`) assert no link control for `composite` and `unknown`. | CLOSED |
| T-200-18 | Info disclosure | wizard feeds line | low | mitigate | `ConnectKeyStep.tsx:828` fetches `/api/keys/feeds` with no id, no query, no body; it indexes the caller's own map by the saved key id (`:845`). Rendered through JSX text (no `dangerouslySetInnerHTML` in any added line of the diff). | CLOSED |
| T-200-19 | Repudiation | false "feeds nothing" in the wizard | medium | mitigate | `readPreselectFeeds` returns `failed` for a non-2xx, a body with no map, a missing entry for the key, a malformed entry, a reject, or the abort bound (`ConnectKeyStep.tsx:831-866`); `PreselectFeedsLine` renders `Feeds no strategy.` only for `status: "ok"` with an empty list. The same discipline holds in `ApiKeyManager` (`:375-391`) and `AllocatorExchangeManager` (`KeyFeedsLine`, a missing entry is could-not-check). Neuter proof in `200-01-SUMMARY.md` (five `FAILED-NEVER-EMPTY` cases RED). | CLOSED |
| T-200-20 | Tampering | manager-only caller enqueueing allocator holdings polls | medium | mitigate | All three `/api/allocator/holdings/sync` call sites are guarded by `isAllocatorRole` (`AllocatorExchangeManager.tsx:775`): reconnect (`:1312`, early return before the fetch at `:1323`), `handleSync` (`:1444`), post-add (`:1623`, fetch at `:1628`). The holdings-bearing renderers are gated too (`:880`, `:1017`). The other non-test callers of that route are the route itself and the pre-existing allocator `scenario/commit` route, neither reachable from the manager's keys tab. The `role` that drives the gate comes from the server-fetched profile (`src/app/(dashboard)/profile/page.tsx:42,57,105`) and is passed down through `ProfileTabs` to `ExchangesTabContent`. Neuter proof in `200-10-SUMMARY.md` (guard flipped -> RED). Residual noted under Unregistered Flags. | CLOSED |
| T-200-21 | Tampering | hard delete removing history | medium | mitigate | Confirm names every fed strategy and shows `DELETE_REMOVES_HISTORY` (`AllocatorExchangeManager.tsx:389-390`, `:2161-2165`, `:2205`). The RPC refuses non-owners: `supabase/migrations/20261104120000_drop_allocator_equity_snapshots.sql:182-185` `IF v_owner IS NULL OR v_owner <> auth.uid() THEN RAISE ... ERRCODE '42501'`, with `REVOKE ALL ... FROM PUBLIC, anon` and `GRANT EXECUTE ... TO authenticated, service_role` (`:221-222`). Both `DELETE`s are also keyed on `auth.uid()`. | CLOSED |
| T-200-22 | Tampering | key capability lost from the edit page before Profile has it | medium | mitigate | Process gate, evidenced: `200-08-SUMMARY.md` records the three plan-10 parity tests run green before any removal; they still exist at HEAD (`AllocatorExchangeManager.test.tsx` `manager-only parity: add` `:3120`, `delete` `:3203`, `update password` `:3410`), and 0 `it.skip` remain in `ApiKeyManager.test.tsx` and the two `AllocatorExchangeManager` test files. | CLOSED |
| T-200-23 | Tampering | composite/unknown shape re-point | medium | mitigate | Same control and evidence as T-200-17, from plan 08's side (KCS-23 fail-closed kept; `LINK_BUTTON_NAMES` updated, not removed). | CLOSED |
| T-200-SC | Tampering | npm installs | high | mitigate | Measured at HEAD: `git diff --stat` across the merge-base range over `package.json`, `package-lock.json` and the analytics requirements files is empty, and `supabase/` has no diff. No package was added and no migration shipped. | CLOSED |

*Status: open · closed · open — below block_on threshold (non-blocking). All 23 are closed.*

### Focus-area detail

**`GET /api/keys/feeds`.** `withAuth` (default `requireApproval: true`, so a pending-approval user cannot call it) at `route.ts:57`. Limiter before reads (`:58`). Every admin read is owner-scoped: the key read by `user_id`, the single-link read by `user_id` AND the owned key ids, the composite read by the owned key ids with the strategy's `user_id` re-checked per row. Another user's strategy that points at the caller's key is excluded by the `user_id` equality (`FOREIGN-SINGLE-LINK-HIDDEN`); another user's strategy reached through a membership is redacted to null id/name/status. Sentry captures carry counts and route/stage tags only, never a user, key or strategy id. All responses are `private, no-store`. Read errors are 500s, never an empty map.

**Re-point write (`strategies.api_key_id`, T-200-12/16).** `handleLinkKey(keyId, expectedCurrent)` (`ApiKeyManager.tsx:876-925`): `:905` returns without writing when the key equals the expectation (Resync and its Retry write nothing); `:906-909` the update is conditioned on the attempt's expected current key (`.is("api_key_id", null)` or `.eq("api_key_id", expectedCurrent)`) in addition to `.eq("id", strategyId)`; `:913-917` zero matched rows is a loud error, not a success. `expectedCurrent` is carried with the attempt (`lastAttemptExpectedKeyIdRef`, `:469`, `:1061`, `:1177`, replayed by Retry at `:1665`) and is never the live `currentKeyId` prop, which closes the CR-01 and R2-01 stale-page re-point paths. Authorization is the database's: the write runs through the user's browser client, so `strategies_update` (owner USING + WITH CHECK) and `check_strategy_api_key_ownership_trigger` (key must belong to the strategy's user) both apply. The key picker lists keys read through RLS (`api_keys_owner`), so only the caller's keys are offered. The read-back (`readLinkedKeyId`) still guards a stalled older link landing late.

**Manager `delete_allocator_api_key` with `p_cascade_holdings:false`.** Role gating is client-side: `canHardDeleteKey = manager || both` and `managerOnly = manager` (`AllocatorExchangeManager.tsx:778-779`); a manager is not offered Disconnect (`:2253`) and never sees the cascade box (`:2167-2174`), and `setCascadeHoldings(true)` is reachable only from that box (`:2183`), so a manager's `handleDeleteKey` (`:1143-1149`) always takes the `p_cascade_holdings: false` arm. The RPC enforces ownership only (`:182`), which is the real authorization boundary and is cross-tenant safe. A key with holdings is refused by `allocator_holdings_api_key_id_fkey ... ON DELETE RESTRICT` (`baseline.sql:15831`), so the manager delete raises 23503 and rolls back. Error handling (`:1151-1163`): 23503 maps to authored copy per role (`MANAGER_KEY_HAS_HOLDINGS_ERROR` / `OWNER_KEY_HAS_HOLDINGS_ERROR`), every other error to a fixed generic sentence; no PostgREST message reaches the UI; the dialog stays open and the row is not removed on error. Success removes the row, refreshes feeds and the router. The delete is held while the feeds or holdings reads are unknown (`:2273-2277`, `:2258`).

**Encryption internals in copy (T-200-05).** One home, `/security#key-handling`. In-app surfaces render `KEY_STORAGE_SENTENCE` plus `KEY_STORAGE_LINK` and say nothing about the mechanism; a census gate fails the build on any restatement (see T-200-05).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-200-01 | T-200-06 | The public `/security` page states the key-storage mechanism on purpose (Phase 192 D-02). Naming it there reveals no secret, and it is the single home for that statement. | Phase 200 planner, `200-02-PLAN.md` threat model | 2026-11-10 |
| AR-200-02 | T-200-09 | An owner can PATCH `strategies.name` or `api_key_id` on a published row through raw PostgREST, around the name route's D-17 gate. The RLS policy has no status gate on `name`. Closing it needs a migration; CONTEXT fixes "no migration" for this phase. The owner is changing their own row; no cross-tenant effect. | Phase 200 planner, `200-12-PLAN.md` threat model | 2026-11-10 |
| AR-200-03 | T-200-10 | The manager header link to `/strategies/new/wizard` renders only for `isManager`; the route guard (`strategies/new/layout.tsx`, `requireRolePage(..., "manager")`) is unchanged and is what actually protects the route. Allocators keep the overlay. | Phase 200 planner, `200-05-PLAN.md` threat model | 2026-11-10 |
| AR-200-04 | T-200-13 | An owner can re-point their own strategy's key through raw PostgREST without the confirm dialog; the confirm is a control-level rule. Server enforcement needs a migration (out of scope). Cross-tenant re-point is already blocked by `check_strategy_api_key_ownership_trigger`. | Phase 200 planner, `200-06-PLAN.md` threat model | 2026-11-10 |

These four were accepted at plan time by the planner, not separately signed by the founder. A founder who wants them re-decided can reopen AR-200-02 and AR-200-04 together: both close with the same server-side migration.

---

## Unregistered Flags

SUMMARY.md `## Threat Flags` sections: all twelve say "None" or map to registered IDs. No flag is unmapped.

Audit-found items with no threat ID (informational, none blocking, none open):

1. **No `T-200-14`.** The register runs 01-13 then 15-23; the ID is never defined in any plan, context or research file. A numbering gap, not a dropped threat (nothing in the artifacts references it).
2. **Role gating of the manager flows is client-side only** (WARNING, below `block_on`). `AllocatorExchangeManager.tsx:771-774` records that neither `/api/allocator/holdings/sync` nor `request_allocator_holdings_sync` checks role, only key ownership, and `delete_allocator_api_key` likewise checks only ownership. T-200-20 and the role half of T-200-21 are therefore UX guards: a manager calling the route or RPC directly acts only on their own key (no cross-tenant path), but could enqueue an allocator holdings poll or pass `p_cascade_holdings: true` for it. This is the same deferral as AR-200-02 and AR-200-04 (a server check needs a migration, out of scope per CONTEXT D-01). Recommend booking one follow-up item rather than a fix here.
3. **Stale `cascadeHoldings` across a Retry (INFO, role `both`/`allocator` only).** `cascadeHoldings` is reset on close, Cancel and success but not in `runDeleteChecks`. If the box was ticked (holdings > 0) and a Retry then re-reads 0 holdings, the box disappears while `cascadeHoldings` stays true and `Delete key` then sends `p_cascade_holdings: true`. It needs an external holdings change during an open dialog, affects only allocator-capable users who may cascade anyway, and cannot occur for a manager-only user (the box is never rendered for them, so the state is never set). Not reported as a threat.
4. **Generic "encrypted at rest" wording remains on public pages** (`for-quants/page.tsx:141,316,342`, `legal/privacy/page.tsx:39`). These name no mechanism, are outside D-14's in-app scope, and this phase made them more generic (`Envelope encryption` -> `Encrypted at rest`). The census does not ban the phrase, by design.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-11 | 23 | 23 | 0 | gsd-security-auditor (read-only; against `f531e3600`) |

Method: code read at the cited `file:line` for every `mitigate` threat; premises of every `accept` threat re-verified in code and migrations; `200-REVIEW.md` (three rounds, all findings dispositioned, 0 open MEDIUM+) read as context, not as evidence. Tests were read, not run, by this audit (the audit is a code-presence verification and the caller's constraints excluded installs and builds), so "its test can fail" is argued from the fakes' filtering behaviour and from the neuter records in the plan SUMMARYs.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-11
