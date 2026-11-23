# Phase 213: KEYFLOW - Pattern Map

**Mapped:** 2026-11-14
**Files analyzed:** 27 (modified or created, source and test)
**Analogs found:** 26 / 27 (one file has only a partial analog, see "No Analog Found")
**Citation rule:** every reference is a repo-relative path plus a SYMBOL. The `plan-anchor-verify` gate re-resolves `file:line` anchors, so no line numbers appear here; the excerpts are HEAD readings (worktree HEAD `52c2c2877`) and the symbol names are the stable handle. Every analog path below was confirmed git-tracked (`git ls-files`); none is a `.gsd/capabilities` mirror.

This phase is copy, state and reuse. Almost every file is a MODIFY whose best analog is itself plus a sibling that already solved the same problem. The patterns below say which sibling to copy and which lines of the file being edited are load-bearing.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/wizard/localStorage.ts` (`deriveWizardResumeOverrides`, `sessionKeyMatches`) | utility | transform | itself (the 164.2.1 gate arm) | self |
| `src/lib/wizard/localStorage.test.ts` | test | transform | its own `same-key wizardSessionId gate (Phase 164.2.1 / SESSIONID-FENCE)` describe | exact |
| `src/lib/wizard/derive-resume-overrides-arity.contract.test.ts` (docblock) and `src/__tests__/contracts/contracts-registry.test.ts` (row text) | test (contract) | transform | themselves | self |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` (triage label in the mount effect) | component | event-driven | its own `reason` ladder | self |
| `src/app/api/strategies/create-with-key/route.ts` (F6 arm `deduped`) | route | request-response | the venue-fence arm in the same file (already carries `deduped: true`) | exact |
| `src/app/api/strategies/create-with-key/route.test.ts` | test | request-response | its own F6 describe and the vacuity fence `a first connect is NOT reported as deduped` | exact |
| `src/lib/queries.ts` (`deriveStrategylessKeys`, `StrategylessKey`) | service | transform | itself; `isPerKeyDailiesEligibleKey` stays untouched | self |
| `src/app/(dashboard)/strategies/page.tsx` (placeholder read + `placeholderRows`) | route (RSC page) | request-response | itself; the `isAllocator ? Promise.all : [[], null]` ternary | self |
| `src/app/(dashboard)/strategies/StrategiesSection.tsx` | component (client host) | event-driven | itself (`onFinishSetup` / `markTarget` callback minting) | self |
| `src/components/strategy/StrategyTable.tsx` (placeholder `<tr>`, `PlaceholderKeyRow`) | component | CRUD (read + row action) | the ranked rows' `Edit` action (`GHOST_ROW_ACTION` container) | exact |
| NEW shared feeds-aware confirm module (extracted from `AllocatorExchangeManager.tsx`) | utility + component | request-response | `AllocatorExchangeManager.tsx` module-private helpers | exact (extraction) |
| NEW Disconnect-only confirm host in `StrategiesSection` | component | request-response | `AllocatorExchangeManager.tsx` Disconnect `Modal` block + `handleDeleteKey` Disconnect branch | exact |
| `src/components/exchanges/AllocatorExchangeManager.tsx` (import the extracted helpers) | component | request-response | itself | self |
| `src/app/(dashboard)/strategies/StrategiesLegend.tsx` (`PIPELINE_DEFINITIONS.no_strategy_yet`) + `StrategiesLegend.test.tsx` | component + test | transform | itself | self |
| `src/lib/wizardErrors.ts` (`KEY_ORPHANED` copy; new `COMPOSITE_MT5_UNSUPPORTED` union member + entry) | model (copy table) | transform | `COMPOSITE_TOO_MANY_MEMBERS` / `COMPOSITE_UNSUPPORTED_UNIFIED` entries | exact |
| `src/app/api/strategies/composite/add-key/route.ts` | route | request-response | the `isSfox && !isSfoxEnabledServer()` and `isMt5 && !isMt5EnabledServer()` guards in the same file | exact |
| `src/app/api/strategies/composite/add-key/route.test.ts` | test | request-response | its own `SITES` table + `mt5 server gate` describe | exact |
| `src/app/api/strategies/composite/set-members/route.ts` | route | request-response | `create-with-key/route.ts` user-scoped `supabase.from("api_keys")` owner read (shape) and this file's own `classifyMembersRpcError` | role-match |
| `src/app/api/strategies/composite/set-members/route.test.ts` | test | request-response | itself (mock `createClient` gains `from`) | self |
| `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` (roster, `enterMulti`, footer note, admitted-code sets) | component | event-driven | itself; the `...(SFOX_UI_ENABLED ? [...] : [])` roster idiom | self |
| `MultiKeyConnectStep.test.tsx`, `MultiKeyConnectStep.credential-input.test.tsx` | test | event-driven | themselves (re-seat MT5 panels onto ccxt panels) | self |
| `src/lib/wizardErrors.invariant.test.ts`, `src/lib/wizardErrors.roster-render.test.tsx` | test (census) | transform | themselves (arithmetic moves) | self |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (`legsPending`, held consumers, hydration effect) | component | event-driven | the `metricsState` / `loadingReturnsIds` machinery in the same file | self |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` (+ `ScenarioBenchmarkSection`, `ScenarioFactsheetChart`) | utility + component | transform | `buildScenarioFactsheetPayload` degenerate branch (`emptyComputeSummary()` etc.) | role-match |
| `ScenarioComposer.added-metrics.test.tsx` (+ `.test.tsx`, `.d11.test.tsx`, `.save.test.tsx`) | test | event-driven | `deferredReturnsFetch()` harness | exact |
| NEW `StrategiesSection.disconnect.test.tsx` | test | event-driven | `AllocatorExchangeManager.feeds.test.tsx` (confirm) + `StrategiesSection.test.tsx` (mount/mocks) | role-match |

## Pattern Assignments

### (a) `src/lib/wizard/localStorage.ts` (utility, transform)

**Analog:** itself. The unknown-case decline is added inside the existing `if` that already holds the key gate. Copy its shape; do not add a parameter.

**Core pattern to extend** (`deriveWizardResumeOverrides`, the single `if` that emits `wizardSessionId`):
```typescript
if (loaded.wizardSessionId && (loaded.source ?? "api") === source && sessionKeyMatches(loaded.apiKeyId, incomingApiKeyId)) {
  out.wizardSessionId = loaded.wizardSessionId;
  // RT-3 — the burn rides with the session id it retired, never on its own.
  if (source === "csv" && loaded.failedCsvSubmitSig) {
    out.failedCsvSubmitSig = loaded.failedCsvSubmitSig;
  }
}
```
Add the decline as one more `&&` conjunct in this SAME `if` (the existing comment says why: "ANDed into the SAME `if` on purpose: `failedCsvSubmitSig` is emitted inside it, and the burn must decline together with the id it retired"). The F1-refined predicate (RESEARCH Pattern 1) uses only existing arguments:
```typescript
const sameDraftOnScreen = initialDraftId !== null && loaded.strategyId === initialDraftId;
const unknownMeetsStoredKey =
  source === "api" && incomingApiKeyId === null &&
  typeof loaded.apiKeyId === "string" && !sameDraftOnScreen;
```
**What stays:** `sessionKeyMatches` itself (an incoming `null` returns `true`) is left as it is; the decline lives in `deriveWizardResumeOverrides`, because the CSV branch's literal `null` must stay permissive and `sessionKeyMatches` cannot see `source`.

**Docblocks to supersede IN PLACE (repo style: add a dated supersession, never delete lineage):** the `sessionKeyMatches` docblock paragraph "founder-locked decision D-01: the unknown case stays permissive" and the paragraph beginning "KNOWN RESIDUAL, NAMED BECAUSE D-01 DOES NOT REMOVE IT". Add a `⛔ SUPERSEDED 2026-11-14 (Phase 213 decision (a))` note naming exactly which sentence changed ("for the unknown case only; the CSV branch's literal null stays load-bearing"), mirroring the density and `⚠️` / `⛔` markers already in the file.

**Fields withheld on a decline (measured by RESEARCH):** only `wizardSessionId` (and `failedCsvSubmitSig`, csv-only so unreachable on `source === "api"`). Nothing else on the API branch needs withholding in the F1-refined case.

---

### (a) `src/lib/wizard/localStorage.test.ts` (test, transform)

**Analog:** the `same-key wizardSessionId gate (Phase 164.2.1 / SESSIONID-FENCE)` describe in the same file. Fixture, naming and assertion style to copy:
```typescript
const abandonedDraftOnKeyA: WizardLocalState = {
  strategyId: "draft-uuid",
  wizardSessionId: "api-session-id",
  step: "sync_preview",
  savedAt: 1_700_000_000_000,
  source: "api",
  apiKeyId: "key-a",
};

it("does NOT lend key A's session id to a wizard opened over key B", () => {
  const out = deriveWizardResumeOverrides(abandonedDraftOnKeyA, "api", null, "key-b");
  expect(out.wizardSessionId).toBeUndefined();
});
```
**The one pin whose result flips** (`DOES restore when the caller names NO incoming key — no claim, nothing to compare`, calling `deriveWizardResumeOverrides(abandonedDraftOnKeyA, "api", null, null)` and expecting `"api-session-id"`): INVERT it, keep its `it` as a sibling, and write the supersession into the TEXT of the test ("decision (a), 2026-11-14: unknown incoming key meeting a stored key declines"). Rewrite the docblock above it ("This is the CSV branch …, the manager route mounted with neither draft nor preselect, and every legacy three-argument caller") so the CSV branch stays permissive and the other two named populations no longer are.
**Add the five new pins** (RESEARCH section (a)): api+null+stored string+no draft on screen declines; csv+null+stored string restores (load-bearing, must go RED if the csv guard is deleted); api+null+stored absent/null restores; **composite draft on screen** (`initialDraftId === loaded.strategyId`, stored first-member key, incoming `null`) restores BOTH `wizardSessionId` and `step` (must go RED under CONTEXT's literal rule); `initialDraftId !== loaded.strategyId` declines with `showResumeBanner: true`.
**Pass unmodified:** the ~25 three-argument API-branch tests (legacy payloads carry no `apiKeyId`, so stored is not a string and they stay permissive). That is the stated evidence for D-02.

---

### (a) `derive-resume-overrides-arity.contract.test.ts` and `contracts-registry.test.ts` (test, contract)

**Analog:** themselves. Update the docblock sentences "`null` is the PERMISSIVE value … fail-open default" and "the ~25 existing three-argument unit pins must pass UNMODIFIED", and the registry row's `invariant` text for the same file (registry pins the text; keep the batch id). The arity guard (every production call passes the key) is NOT weakened; the CSV branch still needs the literal `null`.

---

### (a) `WizardClient.tsx` (component, event-driven) — triage label only

**Analog:** the `reason` ladder in the mount effect, directly after `deriveWizardResumeOverrides(loaded, source, initialDraft?.id ?? null, incomingApiKeyId)`:
```typescript
if (loaded?.wizardSessionId && !overrides.wizardSessionId) {
  let reason = "other";
  if ((loaded.source ?? "api") !== source) {
    reason = "source_mismatch";
  } else if (incomingApiKeyId !== null) {
    if (typeof loaded.apiKeyId !== "string") {
      reason = "stored_key_absent";
    } else if (loaded.apiKeyId !== incomingApiKeyId) {
      reason = "key_mismatch";
    }
  }
  trackForQuantsEventClient("wizard_session_id_not_restored", { step: reason });
```
Add an `else if (incomingApiKeyId === null && typeof loaded.apiKeyId === "string")` arm labelled `incoming_key_unknown`. The ladder's own comment states the rule ("written to degrade rather than lie … falls through to 'other'"). Never log key ids or the session id (existing `⛔ NEVER the key ids or the session id themselves`). No test pins any `step` label value, so the new label is free. Leave the `incomingApiKeyId` ternary (`source === "csv" ? null : …`) and its `⛔ CSV branch: a LITERAL null` comment byte-identical.

---

### (a) `src/app/api/strategies/create-with-key/route.ts` (route, request-response) — F6 arm

**Analog:** the venue-fence arm in the same function, which already answers `deduped: true`:
```typescript
if (venueMatch.kind === "draft") {
  return NextResponse.json(
    {
      ok: true,
      strategy_id: venueMatch.strategy_id,
      api_key_id: venueMatch.api_key_id,
      deduped: true,
    },
    { headers: NO_STORE_HEADERS },
  );
}
```
**Edit target** (the F6 session fence, `if (existingDraft?.id && existingDraft.api_key_id)`): add the single field `deduped: true` after `api_key_id`, no other change. ⛔ The identity (venue account id) never crosses back (T-154-06-C): `deduped` carries no id.
**Comment to supersede:** the paragraph at the venue-fence arm, "⭐ `deduped` IS ADDITIVE AND APPEARS ON THIS ARM ONLY. The session-fence arm above stays byte-identical". It is now false; add the dated correction, keep the lineage. Also touch the prose in the route that quotes the retired `KEY_ORPHANED` sentence and the `handleReuseExistingKey` docblock ("releasing the stored key is not something they can do from any page we ship").
**F2 residual (record in plan and CHANGELOG `### Notes`, do not fix):** the two RPC-internal replays (`create_wizard_strategy`, `create_wizard_strategy_for_key`) return the same `(strategy_id, api_key_id)` shape for replay and mint, so the route cannot flag them without a `RETURNS TABLE` change (a migration, out of scope per SC-5).

---

### (a) `create-with-key/route.test.ts` (test, request-response)

**Analog:** the F6 describe. The case to update (its `toEqual` pins the old shape):
```typescript
it("returns the existing draft and skips Railway validate+encrypt+RPC when a draft already exists for this (user, wizard_session_id)", async () => {
  draftLookupMock.mockResolvedValueOnce({ data: { id: STRATEGY_ID, api_key_id: API_KEY_ID }, error: null });
  const POST = await importPost();
  const res = await POST(makeReq(VALID_BODY));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, strategy_id: STRATEGY_ID, api_key_id: API_KEY_ID });
  expect(validateKeyMock).not.toHaveBeenCalled();
  expect(encryptKeyMock).not.toHaveBeenCalled();
  expect(rpcMock).not.toHaveBeenCalled();
});
```
Add `deduped: true` to the `toEqual`, and state the supersession in the test name. **Keep** the vacuity fence `a first connect is NOT reported as deduped` (it `toEqual`s the shape WITHOUT `deduped` on the ordinary path): it is the control that goes RED if every arm is made to answer `deduped`.
**UI side:** `ConnectKeyStep.handleSubmit` already forwards `deduped` only on `data.deduped === true`; `ConnectKeyStep.handleContinueWithKey` (reuse arm) deliberately does NOT forward it, so `ContributionWizardOverlay.preselect.test.tsx` ("reuse arm answers deduped:true, no notice") stays green and must not be edited. Update the `ConnectKeyStep.tsx` docblock on `deduped` ("Absent on every other arm, including … the F6 session-fence replay").

---

### (b) `src/lib/queries.ts` (service, transform) — `deriveStrategylessKeys`

**Analog:** itself. Current body:
```typescript
export type StrategylessKey = { id: string; exchange: SupportedExchange; label: string };
...
return keys
  .filter(isPerKeyDailiesEligibleKey)
  .filter((k) => !covered.has(k.id))
  .map(({ id, exchange, label }) => ({ id, exchange: exchange as SupportedExchange, label }));
```
**Edit shape (F4):** widen the FILTER to `k.disconnected_at == null` and carry the predicate as a per-row flag. NEVER edit `isPerKeyDailiesEligibleKey` (documented byte-identical to the Python backfill's active-key predicate; it also feeds `allActiveKeysHavePerKeyDailies`):
```typescript
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
Keep the token `isPerKeyDailiesEligibleKey` inside the function body: `src/__tests__/phase-149-my-strategies-parity.test.ts` pin 8 requires it there, plus `deriveStrategyLinkedKeyIds(` and the `"archived"` literal. Extend `StrategylessKey` with the two fields. Update the docblock sentence "Eligibility reuses the exported `isPerKeyDailiesEligibleKey` predicate rather than re-deriving …" with a dated note.
**Tests that move:** `queries.my-strategies.test.ts` "never returns ineligible keys, even when totally uncovered" (only `["eligible"]` today) now also returns inactive and revoked orphans with `finishSetupEligible: false`; disconnected stays excluded.

---

### (b) `src/app/(dashboard)/strategies/page.tsx` (RSC page, request-response)

**Analog:** itself. Current gate (the placeholder read and `getRealPortfolio` share one `Promise.all`):
```typescript
const [bareKeys, portfolio] = isAllocator
  ? await Promise.all([getStrategylessActiveKeys(user.id), getRealPortfolio(user.id)])
  : [[], null];
const placeholderKeysUnreadable = bareKeys === null;
const placeholderRows = (bareKeys ?? []).map((k) => ({
  id: k.id,
  exchange: k.exchange,
  exchangeLabel: EXCHANGE_DISPLAY[k.exchange],
  keyLabel: k.label,
}));
```
**Edit shape:** split the reads so every role reads `getStrategylessActiveKeys(user.id)` and only `isAllocator` reads `getRealPortfolio(user.id)` (a manager must still make NO portfolio read; `page.merged.test.tsx` pins it). Keep the ⛔ T-199-25 `error ≠ empty` semantics (`null` means unreadable, never "no keys"). Carry `finishSetupEligible` and `syncStatus` through `placeholderRows`. Leave `allocatorFurniture={isAllocator}` unchanged. Record the supersession of the Phase 199 plan 10 (D-02) `isAllocator` gate in code.
For the optional `revoked` pill on a newly-listed row, the page already knows the render idiom: `<AllocatorSyncStatus subject="strategy-key" syncStatus={…} syncError={…} lastSyncAt={…} exchange={…} />` inside the `keyLines.map(...)` block, gated by `isUntrustedKeySyncStatus` imported from `@/lib/closed-sets`. NOTE: the page uses it WITHOUT `pillOnly`; `pillOnly` is used by `StrategiesLegend.tsx`. A placeholder row has no `sync_error`/`last_sync_at` in `StrategylessKey` today, so the planner either projects them or uses `pillOnly` with `syncStatus` alone (decide and record).
**Tests that move:** `page.merged.test.tsx` "a manager's page makes neither allocator read and shows no placeholder or K sentence": split into "manager reads `getStrategylessActiveKeys`, not `getRealPortfolio`"; keep the allocator/`both` assertion `toHaveBeenLastCalledWith("u-1")`. `kSentence(placeholderRows.length)` and `hasRows` already handle placeholders for any role.

---

### (b) `src/app/(dashboard)/strategies/StrategiesSection.tsx` (component, event-driven)

**Analog:** itself; the existing client-boundary callback minting. Copy:
```typescript
export type OwnerPlaceholderKeyRow = PlaceholderKeyRow & { exchange: SupportedExchange };
...
const [preselectKey, setPreselectKey] = useState<PreselectedKey | null>(null);
const [markTarget, setMarkTarget] = useState<{ id: string; name: string; mark: CapitalOwnership | null } | null>(null);
const router = useRouter();
...
onFinishSetup={(keyId) => {
  const clicked = placeholderKeys.find((k) => k.id === keyId);
  setPreselectKey(clicked ? { id: clicked.id, exchange: clicked.exchange, exchangeLabel: clicked.exchangeLabel, keyLabel: clicked.keyLabel } : null);
  setWizardOpen(true);
}}
```
**Edit shape:** add `const [disconnectTarget, setDisconnectTarget] = useState<{ id; exchangeLabel; keyLabel } | null>(null)` (capture only the fields the confirm needs, per the file's own comment about `markTarget`: "a stale row object held in state would be a second, silently diverging copy of the truth"), mint `onDisconnect={(keyId) => …}` for the table (a function prop is non-serializable across the RSC boundary, same reason as `onFinishSetup`), and mount the confirm the way `markTarget && <MarkOwnershipDialog key={markTarget.id} open …/>` is mounted: only while a row is selected, keyed by the row id. After success: `router.refresh()`, a `LiveRegion` (polite) announcement, focus to the next remaining placeholder `Disconnect` control else the `Strategies` heading (UI-SPEC 1.5). Widen `OwnerPlaceholderKeyRow` here (not in `StrategyTable`) for any fact only this surface needs, per the `162-06 / HONEST-06` comment.
**Imports to add** (from the analog's confirm): `Modal` from `@/components/ui/Modal`, `Button` from `@/components/ui/Button`, `LiveRegion` from `@/components/ui/LiveRegion`, `createClient` from `@/lib/supabase/client`.

---

### (b) `src/components/strategy/StrategyTable.tsx` (component, CRUD) — placeholder row Actions cell

**Analog:** the ranked rows' owner-list Actions container and the `GHOST_ROW_ACTION` constant:
```typescript
const GHOST_ROW_ACTION =
  "text-caption font-medium text-text-muted hover:text-text-primary transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent";
...
<div className="flex flex-nowrap items-center justify-end gap-3 whitespace-nowrap">
  {managerRows[s.id]?.editHref && (
    <Link href={managerRows[s.id].editHref as string}
          aria-label={`Edit ${s.name}`}
          className={`${GHOST_ROW_ACTION} inline-flex items-center pointer-coarse:min-h-[44px]`}>
      Edit
    </Link>
  )}
  ...
</div>
```
**Current placeholder Actions `<td>` (to extend, not replace):**
```typescript
<td className="pl-4 pr-8 py-3 text-right">
  <button type="button" onClick={() => onFinishSetup?.(p.id)} className="text-small text-accent underline underline-offset-2">
    Finish setup →
  </button>
</td>
```
**Edit shape (UI-SPEC 1.3):** wrap in the `flex flex-nowrap items-center justify-end gap-3 whitespace-nowrap` container ONLY when `onDisconnect` is passed (so `StrategyTable.default-mounts.test.tsx`'s pinned normalized string for the owner mount, which passes `onFinishSetup` but no `onDisconnect`, stays byte-identical; otherwise move that pin with a stated reason). Render `Finish setup →` only when the row's `finishSetupEligible` is not `false` (default eligible for rows that omit the field, so the public mounts and existing fixtures are unchanged); render the new button with `aria-label={`Disconnect ${p.exchangeLabel} · ${p.keyLabel}`}` and `className={`${GHOST_ROW_ACTION} inline-flex items-center pointer-coarse:min-h-[44px]`}`. Add `onDisconnect?: (keyId: string) => void` beside `onFinishSetup` in `StrategyTableProps`. Extend `PlaceholderKeyRow` with OPTIONAL `finishSetupEligible?: boolean` and the pill status so the public discovery surfaces' prop contract stays byte-identical. Keep the `<td>` count equal to the `<th>` count (`StrategyTable.pending-chip.test.tsx` asserts it).
**Tests that move:** `StrategyTable.pending-chip.test.tsx` (td/th parity; "a mid-sync row … offers no Finish setup"), `StrategyTable.default-mounts.test.tsx`; add a mount case with `onDisconnect`.

---

### (b) NEW shared feeds-aware confirm module (extraction) and `AllocatorExchangeManager.tsx`

**Analog:** the module-private helpers at the top of `src/components/exchanges/AllocatorExchangeManager.tsx`. Extract these symbols byte-for-byte into one module (suggested location `src/components/exchanges/`, imported by both hosts; the type `KeyFeed` already lives in `@/lib/key-feeds`): `FEEDS_UNCHECKED_COPY`, `FEEDS_UNREADABLE_NAME`, `FEEDS_READ_BOUND_MS`, `parseKeyFeed`, `readJson`, `readKeyFeedsForConfirm`, `type DeleteFeedsState`, `deleteFeedsNote`.
```typescript
type DeleteFeedsState =
  | { state: "checking" }
  | { state: "unchecked" }
  | { state: "ok"; feeds: KeyFeed[] };

function deleteFeedsNote(check: DeleteFeedsState, hardDelete: boolean): { text: string; tone: "muted" | "warning" } {
  if (check.state === "checking") return { text: "Checking which strategies this key feeds…", tone: "muted" };
  if (check.state === "unchecked") return { text: FEEDS_UNCHECKED_COPY, tone: "warning" };
  if (check.feeds.length === 0) return { text: "This key feeds no strategy.", tone: "muted" };
  ...
}
```
`readKeyFeeds` / `readKeyFeedsForConfirm` call `GET /api/keys/${encodeURIComponent(keyId)}/memberships` (a `withAuth`, ownership-checked, role-agnostic route) and return `"unreadable"` instead of throwing; keep that never-throws contract. Keep the `console.error("[AllocatorExchangeManager] …")` prefix strings unless a test pins them (grep first). **Do not extract `readKeyFeeds` (the all-keys `/api/keys/feeds` read, `KeyFeedsLine`) unless the planner needs it; it is not part of the confirm.**
**`AllocatorExchangeManager.tsx` itself:** only replace the local definitions with imports. Keep these `data-testid`s byte-identical (the existing tests read them): `allocator-delete-feeds`, `allocator-delete-feeds-loss`, `allocator-delete-retry`, plus `allocator-delete-holdings-unchecked`. Guard test files: `AllocatorExchangeManager.test.tsx`, `AllocatorExchangeManager.feeds.test.tsx`.

---

### (b) NEW Disconnect-only confirm (in the strategies host)

**Analog:** the `Modal` block of `AllocatorExchangeManager` plus `handleDeleteKey`'s Disconnect branch plus `runDeleteChecks`' feeds half. Copy the sequence-guarded feeds read, the Disconnect-while-open rule and the RPC call; DROP the holdings read, the cascade checkbox, `Delete key` and everything role-conditional on `managerOnly`.

**Feeds read with stale-answer guard** (copy the seq-ref idiom):
```typescript
const seq = ++deleteFeedsSeqRef.current;
setDeleteFeeds({ state: "checking" });
void readKeyFeedsForConfirm(keyId).then((answer) => {
  if (deleteFeedsSeqRef.current !== seq) return;
  setDeleteFeeds(answer === "unreadable" ? { state: "unchecked" } : { state: "ok", feeds: answer });
});
```
**RPC call + error line** (the Disconnect branch, verbatim strings):
```typescript
const { error } = await supabase.rpc("disconnect_allocator_api_key", { p_api_key_id: keyId });
setDeleteLoading(false);
if (error) { setDeleteError("Could not disconnect this key. Please try again."); return; }
```
**Modal body, feeds note, Retry, alert line, footer** (copy classes and testids):
```tsx
<Modal open={!!confirmDeleteId} onClose={() => { if (deleteLoading) return; /* reset + forgetDeleteFeeds() */ }} title={...}>
  <p className="text-sm text-text-secondary">...</p>
  <p data-testid="allocator-delete-feeds"
     className={`mt-3 text-xs ${note.tone === "warning" ? "text-warning" : "text-text-muted"}`}>{note.text}</p>
  {deleteFeeds?.state === "unchecked" ? (
    <Button variant="secondary" size="sm" className="mt-2" data-testid="allocator-delete-retry" disabled={deleteLoading}
            onClick={() => void runChecks(keyId)}>Retry</Button>
  ) : null}
  {deleteError ? (<p role="alert" className="mt-3 text-xs text-negative bg-negative/5 border border-negative/20 rounded px-3 py-2">{deleteError}</p>) : null}
  <div className="mt-4 flex justify-end gap-2">
    <Button variant="secondary" disabled={deleteLoading} onClick={...}>Cancel</Button>
    <Button variant="danger" disabled={deleteLoading || feedsOpen} onClick={...}>
      {deleteLoading ? "Disconnecting…" : "Disconnect"}
    </Button>
  </div>
</Modal>
```
Per UI-SPEC 1.4: `Disconnect` is disabled while the feeds read is `checking` and while in flight; an `unchecked` read warns and does NOT hold Disconnect (the source confirm treats Disconnect as reversible: `feedsOpen = deleteFeeds?.state === "checking"`). Title `Disconnect {Exchange} · {label}?`; allocator/`both` body is the source's verbatim sentence "We'll stop syncing this key. Your historical holdings stay available for audit and are reflected in past performance."; manager-only body is the new sentence from UI-SPEC 1.4.
**Announcement:** `LiveRegion` takes `{ message: string | null; assertive?: boolean }` and must render BEFORE its message arrives (its own docblock: "WHY THE REGION RENDERS BEFORE ITS MESSAGE ARRIVES"), so mount it unconditionally in the host and set the message after success.
**Client creation:** `const supabase = createClient();` from `@/lib/supabase/client` (the manager component does exactly this).
**RPC contract (live definition, read in RESEARCH):** `disconnect_allocator_api_key(p_api_key_id UUID) RETURNS BOOLEAN`, owner-scoped via `auth.uid()`, idempotent, no role check, granted to `authenticated`, defined once in `supabase/migrations/20260422101911_api_keys_disconnected_at.sql`. No migration.

---

### (b) `StrategiesLegend.tsx` + `StrategiesLegend.test.tsx` (component + test)

**Analog:** itself. Replace the `PIPELINE_DEFINITIONS.no_strategy_yet` string with the UI-SPEC 1.6 sentence and update the pinned old string in `StrategiesLegend.test.tsx` in the SAME task (it asserts the old `no_strategy_yet` definition verbatim).

---

### (b)/(c) `src/lib/wizardErrors.ts` (model, copy table)

**Analog for the new code:** `COMPOSITE_TOO_MANY_MEMBERS` and `COMPOSITE_UNSUPPORTED_UNIFIED`. Entry shape and the non-recoverable action rule:
```typescript
COMPOSITE_UNSUPPORTED_UNIFIED: {
  title: "Multi-key strategies can't be finalized on this path yet.",
  cause: "…",
  fix: ["…", "…"],
  docsHref: "/security",
  // ⚠️ NO `clear_and_retry` and NO `try_another_key` — the two members of
  // `RECOVERABLE_ACTIONS`. Their absence derives `recoverable: false` …
  actions: ["request_call", "expand_log"],
},
```
Register in three places: the `WizardErrorCode` union (next to `| "COMPOSITE_TOO_MANY_MEMBERS"` / `| "COMPOSITE_UNSUPPORTED_UNIFIED"`, with a docblock in the same density), the `WIZARD_ERROR_COPY` entry beside them, and (in `MultiKeyConnectStep.tsx`) both admitted-code sets. NOT an alias in `SEAM_CODE_TO_WIZARD_CODE` (the file says so for `COMPOSITE_UNSUPPORTED_UNIFIED`: "this one is minted by our own route, so it is a wizard member outright"). UI-SPEC 3.3 fixes copy and uses `actions: ["expand_log"]` (precedent: a `METADATA_` entry). Recoverability derives from `actions` via `buildEnvelope` and `RECOVERABLE_ACTIONS = {"clear_and_retry","try_another_key"}` in `src/lib/envelope.ts`; do not add a flag. Check the `[140.3-10 / TRAP-4]` destructive-action scan before choosing `actions`.

**Analog for `KEY_ORPHANED` rewrite:** the entry itself. Keep `title`, `docsHref: "/security"`, `actions: ["try_another_key", "expand_log"]` and the `⛔ try_another_key AND NOT clear_and_retry` / `⛔ AND NEITHER resume_draft NOR start_fresh` comment unchanged. Rewrite `cause` and the three `fix` lines per UI-SPEC Surface 2. The long docblock above the entry is stale in three named places ("`allocatorOnly` in `ProfileTabs.tsx`", "nothing we ship lets an owner of ANY role release their own stored key", the `/my-strategies` `requireRolePage(…, "allocator")` guard); add a dated `⛔ CORRECTED 2026-11-14 (Phase 213)` note rather than deleting, per repo convention. Do NOT add a "use Profile → API keys" remedy (RESEARCH F3: not reliably reachable for a manager).
**Copy vocabulary guard:** `src/__tests__/key-storage-census.test.ts` scans `src/app`, `src/components`, `src/lib` (not `src/app/api`) for the whole words `KEK`, `DEK`, `AES`, `Fernet`, `Vault`, `per-user` and the phrase `envelope encryption`. New copy and comments in those roots must avoid them.
**Preselect sweep:** before rewording `KEY_ORPHANED`, check `ConnectKeyStep.preselect-refusal-class.test.tsx`'s derived `PRESELECT_REACHABLE` set (RESEARCH A4, unverified).

---

### (c) `src/app/api/strategies/composite/add-key/route.ts` (route, request-response)

**Analog:** the sFOX and MT5 server guards in the same handler. Exact shape to copy (status 400 with a `{ code, error }` literal, before any rate-limit token, validate or encrypt):
```typescript
if (isSfox && !isSfoxEnabledServer()) {
  return NextResponse.json(
    { code: "KEY_VENUE_NOT_ENABLED", error: "sFOX integration is not yet available." },
    { status: 400, headers: NO_STORE_HEADERS },
  );
}
```
**Edit shape:** immediately after `const isMt5 = exchange.toLowerCase() === "mt5";` and BEFORE the `isMt5 && !isMt5EnabledServer()` gate, add `if (isMt5) return NextResponse.json({ code: "COMPOSITE_MT5_UNSUPPORTED", error: "…" }, { status: 400, headers: NO_STORE_HEADERS });` so the answer does not depend on `MT5_ENABLED`. Use the literal `{ code: "…", error: "…" }, { status: 400 …` form: it is the form `wizardErrors.invariant.test.ts`'s derived scan counts (`ROUTES` `expectedSites` for `composite/add-key` 12 → 13, `EXPECTED_SPLIT_CODES` gains the code, `MIRROR_EXEMPT` gains it because only add-key emits it; the law polices that exemption). Per RESEARCH, KEEP the now-unreachable `isMt5 && !isMt5EnabledServer()` gate and the MT5 three-credential guard (Rule 3, surgical) with a dated comment, and say so in the tests.
**Comment to correct:** the venue-arm comment "cannot be a composite member anyway (the stitch worker has no mt5 arm; ROADMAP 153.6 records it as out of scope)" becomes true-by-guard; cite decision (c) instead.

### (c) `composite/add-key/route.test.ts` (test)

**Analog:** its own `describe("… mt5 acceptance (MT5SRC-03)")` and `describe("… mt5 server gate (MT5_ENABLED off)")` and the hand-typed `SITES` table with `expect(SITES.length).toBe(12)`. Three of four acceptance cases (accepts `exchange=mt5`; api_secret-required 400; short login accepted) invert to the new refusal; the unsupported-exchange case stays; the `it.each(["mt5","MT5","Mt5"])` gate cases answer the new code; the "does NOT gate ccxt" case stays; two `SITES` rows (`mt5 venue switch is off …`, `mt5 investor password absent …`) become unreachable (source emitter count 13 vs reachable rows 11, by design; the test text must say so). Assert refusal under `MT5_ENABLED` both on AND off, before any validate/encrypt/RPC.

---

### (c) `src/app/api/strategies/composite/set-members/route.ts` (route, request-response)

**Analog (role-match):** this file's own post-validation structure plus the user-scoped read pattern used across the wizard routes (`createClient` from `@/lib/supabase/server`, already imported, with `.eq("user_id", user.id)` on an `api_keys` read; `exchange` is in `API_KEY_USER_COLUMNS`). Order is load-bearing: the new guard runs AFTER `keyWindowsSchema` and the `everyKeyMinted` check and AFTER the rate-limit token (so a malformed request does not burn one) but BEFORE `set_wizard_composite_members`, so "We stopped before saving anything" is true. Shape (RESEARCH, with the file's own error posture: bare `{ code }` bodies, `NO_STORE_HEADERS`):
```typescript
const supabase = await createClient();
const { data: owned, error: readErr } = await supabase
  .from("api_keys").select("id, exchange")
  .in("id", members.map((m) => m.api_key_id)).eq("user_id", user.id);
if (readErr) return NextResponse.json({ code: "UNKNOWN" }, { status: 500, headers: NO_STORE_HEADERS }); // fail loud, never pass
if (owned?.some((k) => k.exchange === "mt5")) {
  return NextResponse.json({ code: "COMPOSITE_MT5_UNSUPPORTED" }, { status: 409, headers: NO_STORE_HEADERS });
}
```
(Status 400 vs 409 is the planner's choice; RESEARCH "Choice 1/2" explains the census consequence. This route is NOT in `ROUTES`, so its emitter is only caught by `wizardErrors.roster-render.test.tsx`.) The existing `createClient()` is created inside the `try`; either hoist it or create the guard's client inside the `try` and keep the catch arm's `{ code: "UNKNOWN" }, 500` posture.
**Test:** `set-members/route.test.ts` mocks `createClient` as `{ rpc }` only; extend it with `from` returning the chain (copy the `vi.mock("@/lib/supabase/server", …)` block already in the file). Assert: refusal, `rpcMock` not called, and a faulted read refuses (500 `UNKNOWN`).

---

### (c) `MultiKeyConnectStep.tsx` (component, event-driven)

**Analog:** itself. Three edits, each with a precedent in the file.

1. **Remove the MT5 roster entry.** The block is a conditional spread, same idiom as sFOX directly above it:
```typescript
...(SFOX_UI_ENABLED ? [ { id: "sfox" as const, name: "sFOX", … } ] : []),
// 153.4 review CR-03 — THE MT5 CARD THIS ROSTER WAS MISSING …
...(MT5_UI_ENABLED ? [ { id: "mt5" as const, name: "MT5", … } ] : []),
```
Delete the MT5 spread and replace the CR-03 comment with a dated supersession (decision (c)); also drop the now-unused `MT5_UI_ENABLED` import only if nothing else in the file reads it. The roster-parity docblock and the "THE CLASS GUARD" test gain ONE named exception for MT5 citing decision (c).
2. **Footer note instead of the button.** Today `footerSlot` is an unconditional ghost button:
```tsx
footerSlot={
  <Button type="button" variant="ghost" data-testid="multi-add-key" onClick={enterMulti}>
    + Add another key window
  </Button>
}
```
`onSingleDraftChange` only writes `singleDraftRef` and `setSingleDraftDirty`, so add one piece of state for the draft's exchange from the same callback (`ConnectKeyStep` reports `{ exchange, … }` on every credential change, including a restored exchange) and render `<p data-testid="multi-add-key-mt5-note" className="text-caption text-text-muted">MT5 accounts connect one key per strategy, so they can't be combined with other keys.</p>` while it equals `"mt5"` (UI-SPEC 3.2).
3. **Refuse in `enterMulti`.** Current body reads `singleDraftRef.current` and copies `draft.exchange` into panel 1. Add an early return when `draft?.exchange === "mt5"` (before `setPanels` / `setMode`) so a stale handler cannot reopen CR-03.
4. **Admitted-code sets.** Add the new code to BOTH `KNOWN_ADD_KEY_CODES` and `KNOWN_SET_MEMBERS_CODES` (both are `ReadonlySet<WizardErrorCode>` built with `new Set<WizardErrorCode>([...])`). The latter does not translate: `data.code && KNOWN_SET_MEMBERS_CODES.has(data.code as WizardErrorCode)` falls to `"UNKNOWN"` for an unlisted code. Follow the in-file convention of a dated comment per added row.
5. **Rehydration fallback.** `toRehydratedPanel` yields `exchange: member.exchange as ExchangeId`; a legacy MT5 member now has no roster entry, so `active?.name` is blank. Fall back to the venue label (`venueLabel` from `@/lib/display-labels`, already used by the routes) so the user can see which key to remove (RESEARCH section (c) item 3).

**Tests that lose their premise** (largest rewrite in the phase; read before editing): `MultiKeyConnectStep.test.tsx` `[CR-03]` block (3 cases drive `mt5Panel()`), the class-guard roster-parity case, and the `[153.4-05 / WIZFORM-05] … the honest long wait, per panel` block (9 tests built on an MT5 panel 0 via `mixedVenuePanels()` / `renderFresh(true)` + `enterMultiFromMt5Draft()`); `MultiKeyConnectStep.credential-input.test.tsx` MT5 "Broker server" panel and `renderPanel1OnMt5` (2 tests). Re-seat the venue-independent behaviour onto ccxt panels or delete each with a recorded reason; never leave a silently-skipped case.

---

### (d) `ScenarioComposer.tsx` (component, event-driven) — `legsPending` and held consumers

**Analog:** the `metricsState` machinery in the same file. The pending signal already exists per leg:
```typescript
metricsState:
  found != null
    ? "settled"
    : lazyMetrics === undefined
      ? "pending"
      : lazyMetrics === "unavailable"
        ? "unavailable"
        : "settled",
```
(`addedStrategyMetadataLookup` memo; book legs are `"settled"` by construction.) The failure write is `markMetricsUnavailable = () => setAddedMetricsById((prev) => ({ ...prev, [id]: "unavailable" }))` and leaves `addedReturnsById[id]` undefined (WR-01: remove + re-add retries).

**Hold predicate (RESEARCH Composer hold, shape only):** one derived boolean over `engineSet.strategies` (every leg, selected or not, per UI-SPEC 4.1), keyed on `loadingReturnsIds.has(s.id) || meta.metricsState === "pending"`, computed once and fed to every held consumer. Place it beside `blendBasis`, which is the single basis rule:
```typescript
const blendBasis = useMemo(
  () => blendPeriodsPerYear(engineSet.strategies.filter((s) => engineState.selected[s.id])),
  [engineSet, engineState],
);
```
Do not add a local 365/252 ternary anywhere (MD-01); `blendPeriodsPerYear` in `src/lib/closed-sets.ts` is `legs.some((l) => l.asset_class === "crypto" || l.asset_class == null) ? 365 : 252` and stays untouched.

**F5 — failure must be terminal for the hydration effect (recommended option 1).** Current effect:
```typescript
useEffect(() => {
  for (const a of scenario.draft.addedStrategies) {
    if (!strategyById.has(a.id) && addedReturnsById[a.id] === undefined) {
      fetchAddedReturns(a.id);
    }
  }
}, [scenario.draft.addedStrategies, strategyById, addedReturnsById, fetchAddedReturns]);
```
Add `addedMetricsById[a.id] !== "unavailable"` to the guard (and `addedMetricsById` to the deps) so a failed leg is not re-fetched when another leg settles; re-adding is the retry (already documented by WR-01). The comment above this effect says "Deliberately NO second dedup mechanism"; the extra conjunct reads existing state and is not a second mechanism, but say so in the comment. Test that the retry-after-failure sequence (leg A fails, leg B settles, A's retry succeeds as `traditional`) shows no interim-basis number.

**Held consumers (UI-SPEC 4.3 table), by symbol:** `gatedBlendMetrics` (volatility, sharpe, sortino blanked; cagr only when `gateAnnualized` gives the same verdict at 365 and 252), `blendGateNote`, `sharpeDeltaState` and the delta pill / "Current book" tooltip, `scenarioOwnBookDelta` (`sampleBasisRatios(bookReturns, blendBasis)`), `peerSharpe` / `peerSortino` (pass `null` while pending: `buildScenarioPeerRankRequest` returns `null` on non-finite, the peer-rank effect then does `setScenarioPeer(null)` and sends no request, which is the "no request, panel absent" behaviour for free), `blendPanels = deriveBlendPanels(..., blendBasis)` plus the caption `…-day rolling window · {blendBasis}-day annualized · …`, `<ScenarioBenchmarkSection periodsPerYear={blendBasis}>` (TE, IR, alpha blank inside the populated layout; correlation and beta render), `<ScenarioFactsheetChart periodsPerYear={blendBasis}>`. NOT held (verified basis-invariant): `max_drawdown`, the Max-DD target solve (`solveLeverageForMaxDD` documents it), Monte Carlo, stress. Preserve the BLEND-01 PEER-RANK FENCE comment: the peer-rank inputs stay RAW `scenarioMetrics.*` with no basis factor; the hold only nulls them.
**Never a held consumer's own empty/unavailable branch** (`ScenarioBenchmarkSection` prints "Benchmark comparison unavailable" with a cause; that would state an untrue cause while pending). Blank slots inside the normal layout; where a consumer has no way to do that, add a hold input prop.
**Save/commit/share persist no figure** (verified in RESEARCH): `postNewScenario` / `putUpdateScenario` send `{ name, draft }`; add the structural pin ("the POST/PUT body keys are `name` and `draft`; no `sharpe|sortino|volatility` token in either body builder") rather than new copy or disabled controls.

### (d) `scenario-factsheet-payload.ts` (utility, transform)

**Analog:** `buildScenarioFactsheetPayload`'s own degenerate branch, the nearest existing "silent dash" mechanism: `strategyMetrics: emptyComputeSummary()`, `bootstrapCI: emptyBootstrapCI()`, rolling arrays `[]`, `rollingWindow: emptyBlendRollingWindow()`, `figureRecord: null`. A pending hold reuses exactly those empty counterparts for the basis-dependent fields only (`strategyMetrics`, `record`/`figureRecord`, `rollingWindow(.1y).annualization`, `strategyRollingVol/Sharpe/Sortino`, the three `1y` rolling series, `bootstrapCI`), keeping equity and drawdown. Prefer one optional `basisPending` input that defaults to today's behaviour (the many `src/app/factsheet/[id]/v2/*.test.tsx` use the builder as a fixture with default arguments). **Open item the planner must close BEFORE coding (RESEARCH Open Question 5 / A5):** read `FactsheetBody` / `MetricsColumn` / the rolling panels to learn whether an empty `rollingWindow` and a null `figureRecord` print a reason caption (UI-SPEC 4.2 forbids a caption while pending), and read `src/lib/factsheet/compute.ts` to list which `compute()` summary keys are basis-dependent. Record the slot list in the plan.

### (d) `ScenarioComposer.added-metrics.test.tsx` and siblings (test, event-driven)

**Analog:** the `deferredReturnsFetch()` harness, which resolves ONE `/returns` call by hand so a test can observe the render between the add and the answer:
```typescript
function deferredReturnsFetch() {
  ...
  const fetchMock = vi.fn(async (url: unknown) => {
    if (typeof url === "string" && url.includes("/returns")) {
      const r = await settled;
      return { ok: r.ok, status: r.status, json: async () => r.body };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
  return { fetchMock, answer(body) {...}, failWithStatus(status) {...}, fail() {...} };
}
```
Use it (with `renderScen()`, `add()`, `browseOnAdd`, `lsStore` / `localStorageMock`, and the C-A..C-G naming style) for: held-open probe reads `—` for Volatility, Sharpe, Sortino and never a number; settled leg shows the final-basis value once; a failed probe ends pending (C-E / C-E2 path); book legs are never pending; no peer-rank request while pending; the F5 retry-after-failure case. Oracle rule inherited from `ScenarioComposer.test.tsx`: formatter outputs pinned as LITERALS (`"+18.4%"`, `"1.63"`, `"—"`), never re-derived by calling the formatter. Tests that expect a number while a drawer leg's `/returns` is unresolved (the BLEND-01 / RANK-06 blocks in `ScenarioComposer.test.tsx`, `ScenarioComposer.d11.test.tsx` which mocks `blendPeriodsPerYear`, `ScenarioComposer.constituent-figure-gate.test.tsx`, `ScenarioComposer.save.test.tsx`) move to `—`-until-settle, each with the supersession stated in the test text.

---

### NEW `StrategiesSection.disconnect.test.tsx` (test, event-driven)

**Analog (role-match):** two files, composed. For the mount/mocks style: `StrategiesSection.test.tsx` (`vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }))`, a mocked `ContributionWizardOverlay`, and a `mount(extra)` helper). That file replaces `StrategyTable` with a prop probe; the new test needs the REAL table so the row's Disconnect button and the confirm can be clicked. For the confirm assertions: `AllocatorExchangeManager.feeds.test.tsx` (the `rpcMock`, `routerRefreshMock` and `@/lib/supabase/client` mock pattern, plus the case names `CONFIRM-HELD-WHILE-READING`, `R2-03 DISCONNECT-WARNS-ONLY`, `SFH-3 CONFIRM-RETRY`, `CONFIRM-STALE-ANSWER-DROPPED`). Assert (UI-SPEC / SC-2): the confirm has exactly Cancel and Disconnect (no `Delete key`, no cascade checkbox), the feeds note, the RPC is called with `disconnect_allocator_api_key` and the ROW's id, the error line, and that after success `router.refresh` ran, the announcement text is exact, and focus moved. **Neuter protocol (SC-6):** replace the RPC name or drop the handler, see RED; add a `Delete key` button, see the "no delete" assertion RED; restore from a byte backup.
**The "way out actually opens" proof (SC-2c)** cannot be a vitest mock alone (RESEARCH Pitfall 7): the DB layer is already proven by `supabase/tests/test_api_keys_venue_identity_uniq.sql` arm 6b ("a DISCONNECTED row must NOT squat the slot"), run by `sql-tests`; the route layer gets one new case over a stateful fake whose `resolveByVenueIdentity` lookup honours `.is("disconnected_at", null)`. Do NOT add a new `supabase/tests` file or arm (it moves several censuses; CLAUDE.md "grep them all").

---

## Shared Patterns

### Supersession is recorded in place, with the lineage kept
**Source:** `src/lib/wizard/localStorage.ts` docblocks (D-01 / D-02 / `⚠️ KNOWN RESIDUAL`), `src/lib/wizardErrors.ts` `KEY_ORPHANED` docblock (`⭐ 162-06 / D-162-3 — THE LAST BULLET … NO LONGER HOLDS, AND THE COPY MOVED IN THE COMMIT THAT BROKE IT`).
**Apply to:** every comment or docblock that a decision (a) to (d) falsifies. Add `⛔ SUPERSEDED/CORRECTED 2026-11-14 (Phase 213 decision <letter>)` beside it; never delete the old sentence. Pins that encode superseded behaviour are UPDATED with the supersession stated in the test text, never deleted (CONTEXT (a)).

### Error code flows route → `WizardErrorCode` union → copy entry → step admitted-code set
**Source:** `COMPOSITE_TOO_MANY_MEMBERS` (`src/lib/wizardErrors.ts`), `KNOWN_ADD_KEY_CODES` / `KNOWN_SET_MEMBERS_CODES` (`MultiKeyConnectStep.tsx`).
**Apply to:** `COMPOSITE_MT5_UNSUPPORTED` only. Coverage law in `wizardErrors.invariant.test.ts` reds by name on a missing union member or roster row; `wizardErrors.roster-render.test.tsx` derives its population from the route sources and drives each code through the real step.

### Error is not empty (fail loud)
**Source:** `getStrategylessActiveKeys` returns `null` on a transient DB failure and the page prints `placeholderKeysUnreadable` instead of an empty state; `readKeyFeedsForConfirm` returns `"unreadable"` and the confirm says "Could not check which strategies this key feeds." rather than "feeds no strategy".
**Apply to:** the set-members MT5 read (a faulted read refuses with 500 `UNKNOWN`, never passes), the Disconnect feeds read, and any new read the host adds.

### Owner-scoped, user-client reads and RPCs; ids are selection intent only
**Source:** `getStrategylessActiveKeys` (`.eq("user_id", userId)` on the user client), `disconnect_allocator_api_key` (`auth.uid()` ownership, `42501` otherwise), `GET /api/keys/[id]/memberships` (`withAuth`).
**Apply to:** the new set-members `api_keys` read (`.eq("user_id", user.id)`), and the Disconnect confirm. Keep one answer for "not yours / gone" (the existing reuse-arm discipline); a refusal must not become an ownership oracle.

### Additive `deduped` field convention
**Source:** the venue-fence arm and `ConnectKeyStep.handleSubmit` (`...(data.deduped === true ? { deduped: true } : {})`); client reads `=== true`.
**Apply to:** the F6 arm. Never carry an id in it. Do not add a UI variant for the reuse arm.

### Neuter → RED → restore from a byte backup (SC-6)
**Source:** RESEARCH "How each must be shown able to fail", repo testing rule in MEMORY.
**Apply to:** every fix. Copy the source file to the scratchpad, edit, run the named test, see RED, restore with `cp`; never `git checkout` / `git restore` / `git stash` on uncommitted work. Controls that must exist: the F1 composite-resume pin (RED under the literal rule), the csv literal-null pin (RED if the csv guard is deleted), the `a first connect is NOT reported as deduped` vacuity fence, the set-members "faulted read refuses" case.

### Cite by symbol, not line number
**Source:** CLAUDE.md `[164.7-CITATION-DRIFT-01]` and the `plan-anchor-verify` job.
**Apply to:** the PLAN.md files. Use the symbol names in this document; do not copy a `:NNN` anchor.

### Repo hygiene that bites this phase
- CHANGELOG entry in the same commit as the `VERSION` bump; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`. Name the TODOS ids closed (RESEARCH item 8: `164.2.1-INCOMING-NULL-CONFLATION`, `D-161-05-A`, `159-BASIS-FLIP`, the 153.6 MT5-composite OUT line, and `0.08` were already removed from `TODOS.md` by #1267; re-run `grep -aF` per id at ship and say so).
- No skip-CI trailer token anywhere in a commit or PR body, not even to deny it.
- A ship branch changes nothing under `.planning/`.
- `src/__tests__/key-storage-census.test.ts` vocabulary (see `KEY_ORPHANED` above).
- `critical-regressions.test.ts` was grepped for the touched symbols and needs no change; `dialog-envelope.invariant.test.ts` and the three `seam-*.invariant.test.ts` censuses must still be RUN.
- Two executors must never edit `src/lib/wizardErrors.ts` ((b) KEY_ORPHANED and (c) new code) or `create-with-key/route.ts` ((a) F6 arm and (b) prose) at once: sequence those plans.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Factsheet-preview hold (`basisPending` into `buildScenarioFactsheetPayload`) | utility | transform | The degenerate-branch empties are the nearest analog (listed above), but nothing in the codebase holds only the basis-dependent fields while keeping the rest; and whether `FactsheetBody` renders an empty `rollingWindow` / null `figureRecord` silently is NOT yet measured. Planner must read `FactsheetBody`, `MetricsColumn` and `src/lib/factsheet/compute.ts` first (RESEARCH Open Question 5). Use RESEARCH section (d) as the pattern source until then. |

## Metadata

**Analog search scope:** `src/lib/wizard/`, `src/lib/{queries,wizardErrors,closed-sets,envelope}.ts`, `src/app/api/strategies/{create-with-key,composite/add-key,composite/set-members}/`, `src/app/(dashboard)/strategies/` (page, section, legend, `new/wizard/`), `src/app/(dashboard)/allocations/components/ScenarioComposer*`, `src/components/{strategy,exchanges,ui}/`.
**Files scanned:** about 40 (targeted reads and greps; `AllocatorExchangeManager.tsx` read for its helpers, state refs and Disconnect confirm only).
**Not verified here (carried from RESEARCH):** `node_modules` is absent in this worktree, so no test was run and no census arithmetic was re-measured; `ConnectKeyStep.preselect-refusal-class` membership for `KEY_ORPHANED`; the factsheet preview slot list.
**Pattern extraction date:** 2026-11-14
