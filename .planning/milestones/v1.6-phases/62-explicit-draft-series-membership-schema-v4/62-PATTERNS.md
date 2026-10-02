# Phase 62: Explicit Draft Series Membership (schema v4) - Pattern Map

**Mapped:** 2026-07-03
**Files analyzed:** 11 (5 modified source, 1 verify-only, 5 test/SQL)
**Analogs found:** 11 / 11 (all in-repo; the v1.5 Phase-59 `window` field is the direct precedent for every seam)

## Orientation

This phase is PURE ADDITIVE and every mechanic it needs already exists from v1.5 Phase-59 (the optional `window` field). The work is *extending each seam by one field/branch/predicate*, not building new machinery. The self-analog is therefore the same file's own `window` handling in almost every case — copy the `window` pattern, swap in `memberKeyIds`. Two structural deltas vs v1.5:

1. **`memberKeyIds` is REQUIRED at v4** (not `.optional()` semantically), but the zod schema field MUST parse-tolerate absence so the v2/v3 upgrade `safeParse` passes (Pitfall 3). Resolve: schema field `.optional()`, contract enforced by codec-on-upgrade + writers-on-save.
2. **Double version bump (3→4, PREV 2→3) needs TWO non-destructive codec branches** (v3 AND v2), not one — a v2 blob is now two versions back and would silently reset (Pitfall 1).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/scenario-state.ts` | model/codec + schema | transform / version-migration | itself — the `window` field + `SCENARIO_SCHEMA_VERSION_PREV` branch (self-analog) | exact |
| `lib/scenario-compare.ts` | service (pure engine) | transform | itself — `usePerKeySources` selector (:157) + `buildLiveBookDraft` (:297) | exact |
| `components/ScenarioComposer.tsx` | component | event-driven (reopen/save) | itself — `openSavedScenario` window-seed + ProvenanceNote branch (:1265-1273) | exact |
| `components/ScenarioComparePanel.tsx` | component | request-response | itself — `liveInputs` assembly (:187-190) + `buildLiveBookDraft` call (:269) | exact |
| `components/ProvenanceNote.tsx` | component | event-driven | itself — the whole ephemeral-note contract | exact (reuse/parameterize) |
| `hooks/useScenarioState.ts` | hook/store | transform | `defaultDraftFromHoldings` fresh-literal (scenario-state.ts:226-233) | role-match |
| `api/allocator/scenario/share/route.ts` | route (API) | request-response | itself — the mint gate `book_only_draft` check (:187-200) | exact |
| `scenario-share/[token]/share-resolve.ts` | service (pure resolve) | transform | itself — `book-only` branch (:197) + window verbatim-thread (:205-210) | exact |
| `api/allocator/scenario/saved/route.ts` | route (API) | request-response | reuses `scenarioDraftSchema` — VERIFY-ONLY, no code change | exact |
| `supabase/tests/test_scenario_shares_rls.sql` | test (SQL) | request-response | window round-trip assertion (:140-159, :249-261) | exact |
| test files (see Shared Patterns) | test | — | v1.5 fixture idioms | role-match |

## Pattern Assignments

### `lib/scenario-state.ts` (model/codec, version-migration)

**Analog:** itself — the v1.5 `window` field + the `SCENARIO_SCHEMA_VERSION_PREV` branch.

**Version constants** (`scenario-state.ts:66,73`) — bump BOTH in the same change:
```typescript
export const SCENARIO_SCHEMA_VERSION = 3;       // → 4
export const SCENARIO_SCHEMA_VERSION_PREV = 2;   // → 3
```
The `PREV` doc comment (:68-72) already says "Bump this to the old CURRENT whenever SCENARIO_SCHEMA_VERSION is bumped and the transition is non-destructive." Update it to name the v2 chain branch.

**Zod field — copy the `window` optional pattern** (`scenario-state.ts:651-656`, and reuse the bound constants at :613-614). Add AFTER the `window` field, BEFORE `lastEditedAt`:
```typescript
// v1.5 window field — the parse-tolerance precedent to mirror:
window: z
  .object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .optional(),
```
New field follows the bounded-array convention (`addedStrategies: z.array(...).max(200)` at :638) + the per-element cap `MAX_DRAFT_KEY_LENGTH = 512` (:614):
`memberKeyIds: z.array(z.string().max(MAX_DRAFT_KEY_LENGTH)).max(64).optional()` — **`.optional()` for the same reason `window` is** (Pitfall 3: the v2/v3 upgrade `safeParse` at :742 runs on a blob with no such field; a required field would fail and route to reset/silent-delete). The v4 CONTRACT is enforced by the codec supplying it on upgrade + writers stamping it, NOT by schema requiredness.

**Codec branch — the exact pattern to extend** (`scenario-state.ts:741-755`, the current single PREV branch):
```typescript
if (rawVersion === SCENARIO_SCHEMA_VERSION_PREV) {
  const safe = scenarioDraftSchema.safeParse(parsed);
  if (safe.success) {
    return {
      value: { ...(safe.data as unknown as ScenarioDraft), schema_version: SCENARIO_SCHEMA_VERSION },
      outcome: "ok",
      reason: "upgraded_v2_windowless",
    };
  }
  return { value: defaultDraft, outcome: "reset", reason: "schema_invalid" };
}
```
After bump: this branch keys on v3 (PREV now = 3), reason becomes `"upgraded_v3_membership"`, membership left UNDERIVED (the `...safe.data` spread carries no `memberKeyIds`). Then ADD a SECOND branch keyed on the LITERAL `2` (two-back), same shape, distinct reason (e.g. `"upgraded_v2_chain"`) — it must survive BOTH window-absent AND membership-absent. **Do NOT touch the forward-compat branch** (:697-706, `version_ahead → readonly`) — it self-adjusts and stays as-is.

**Fresh-literal writer** (`scenario-state.ts:226-233`, `defaultDraftFromHoldings`) — the ONE transform that does not spread and must add the field. It has only `holdings` in scope, so it can only stamp `[]`:
```typescript
return {
  schema_version: SCENARIO_SCHEMA_VERSION,
  init_holdings_fingerprint: fingerprint ?? computeHoldingsFingerprint(holdings),
  toggleByScopeRef,
  addedStrategies: [],
  weightOverrides: clampAllWeights(weightOverrides),
  lastEditedAt: new Date().toISOString(),
  // ADD: memberKeyIds: [],
};
```
All OTHER transforms (`toggleHolding`, `addStrategyBrowse`, `removeAddedStrategy`, `setWeightOverride`, `setWindow`) return `{ ...draft, ... }` → they preserve `memberKeyIds` automatically (Pitfall 5). Pin a spread-preservation test.

**New shared helpers (Claude's-discretion names, this file per convention):**
- `deriveMembershipFromGate(gate: boolean, eligibleApiKeyIds: string[]): string[]` — gate=true ⇒ `[...eligibleApiKeyIds]`, gate=false ⇒ `[]`. The ONE upgrade-derivation rule; consumed by composer-open, compare, share-resolve.
- `isBookOnlyDraft(draft): boolean` = `draft.memberKeyIds.length >= 1 && draft.addedStrategies.length === 0`. The ONE book-only predicate; consumed by mint gate, share-resolve, compare.

---

### `lib/scenario-compare.ts` (service, transform) — MEMBER-02, closes F5

**Analog:** itself — the `usePerKeySources` selector and `buildLiveBookDraft`.

**Selector to rewrite** (`scenario-compare.ts:157` and the eligible-filter at :162-167):
```typescript
const usePerKeySources = liveInputs.perKeyDailiesGateSatisfied === true;
// ...
const all = liveInputs.perKeyReturnsByApiKeyId ?? {};
const eligible = new Set(liveInputs.eligibleApiKeyIds ?? []);
const eligibleOnly = Object.fromEntries(Object.entries(all).filter(([id]) => eligible.has(id)));
```
After MEMBER-02: for a SAVED draft, `usePerKeySources` becomes `draft.memberKeyIds.length > 0`, and the `eligible` set INTERSECTS the live-eligible set with `draft.memberKeyIds` (persisted members still eligible — this intersection is ALSO the MEMBER-04 drop point at compute time). Empty membership ⇒ added-only even when the live gate is true (F5 closed by construction; `entryMode` stops being load-bearing). Preserve the P61-BUG-2 comment intent (:151-156).

**Synthetic live-book draft to stamp** (`scenario-compare.ts:297-309`) — NOTE: research corrected CONTEXT here; the literal already uses `SCENARIO_SCHEMA_VERSION` (:302, NOT a stale `2`), so no version-literal fix — only the membership stamp + a signature to receive eligible ids:
```typescript
export function buildLiveBookDraft(): ScenarioDraft {
  return {
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "live-book",
    toggleByScopeRef: {},
    addedStrategies: [],
    weightOverrides: {},
    lastEditedAt: new Date(0).toISOString(),
    // ADD: memberKeyIds — all eligible per-key ids via deriveMembershipFromGate(true, eligibleApiKeyIds)
  };
}
```
Change signature to `buildLiveBookDraft(eligibleApiKeyIds: string[])` (Pitfall 4). Keep the `{ liveBook: true }` union-path exception (:293) byte-untouched (Phase-55 lock) — NO `window` on this synthetic draft, and NO `window` change here.

**Golden to preserve:** an upgraded v3 book draft with gate=true derives membership = all eligible ids = exactly today's gate-only selection → Atlas book-only draft still computes Cum +0.06% / Sharpe 0.11 @ 40-day window (0 real gate=false users on prod).

---

### `components/ScenarioComposer.tsx` (component, event-driven) — MEMBER-04

**Analog:** itself — `openSavedScenario` window-seed branch + the ProvenanceNote nonce/gate machinery.

**Reopen decode/hydrate branch** (`ScenarioComposer.tsx:1265-1273`) — the exact window/provenance decision tree to extend:
```typescript
if (drifted) {
  setShowProvenanceNote(false);
} else if (decoded.value.window) {
  seedWindowLocal(decoded.value.window);
  setShowProvenanceNote(false);
} else {
  resetWindowToDefaultOnReopen();
  setShowProvenanceNote(decoded.reason === "upgraded_v2_windowless");
}
```
MEMBER-04 hooks in HERE (non-drift path): after hydrate, compute dropped members = persisted `decoded.value.memberKeyIds` NOT in `payload.eligibleApiKeyIds`; when ≥1 dropped, raise a membership provenance note (parallel to `setShowProvenanceNote`, likely a second gate flag). For upgraded v2/v3 columns (`decoded.reason` is `upgraded_v*`), membership is underived → derive via `deriveMembershipFromGate(payload.perKeyDailiesGateSatisfied, payload.eligibleApiKeyIds ?? [])`. The engineState memo recomputes over the remainder — allowed as long as DISCLOSED.

**Per-open nonce** (`ScenarioComposer.tsx:1182`) — already solves A→dismiss→reopen-A re-show; the membership note reuses it:
```typescript
provenanceOpenNonceRef.current += 1;   // bumped on every completed open (:1182)
```

**Eligible-id + gate enumeration** (`ScenarioComposer.tsx:1669-1684`) — the input pair for BOTH derivation and the new-save stamp:
```typescript
const eligible = new Set(payload.eligibleApiKeyIds ?? []);
// ...
const usePerKeySources = entryMode === "book" && payload.perKeyDailiesGateSatisfied;
```
**New-save STAMP rule is DISTINCT from the upgrade-derive rule** (Open Question 2 / anti-pattern): new save must respect `entryMode` — `book && gate ⇒ eligibleApiKeyIds`, `blank ⇒ []` even if gate=true (THAT is the F5 closure). Do NOT reuse the gate-only `deriveMembershipFromGate` for new saves. Cleanest seam: a pure `setMemberKeyIds(draft, ids)` transform the composer invokes when `entryMode`/gate/eligible-ids change; save persists `scenario.draft` unchanged.

**ProvenanceNote render gate** (`ScenarioComposer.tsx:3262-3267`) — the placement + remount-key idiom to mirror for the membership note:
```typescript
{windowBounds && showProvenanceNote && activeWindowIsCommonPeriod && (
  <ProvenanceNote
    key={`${loadedScenarioId ?? "provenance"}-${provenanceOpenNonceRef.current}`}
    onShowFullRange={() => fullRangeWindow && applyWindow(fullRangeWindow)}
  />
)}
```
Note the suppression coupling at :3279 (`!showProvenanceNote`) so notes don't stack — apply the same care with a membership note.

---

### `components/ScenarioComparePanel.tsx` (component, request-response)

**Analog:** itself — the `liveInputs` assembly and `buildLiveBookDraft` call site.

**Live-inputs assembly** (`ScenarioComparePanel.tsx:187-190`) — where derivation for upgraded columns hooks in:
```typescript
eligibleApiKeyIds: payload.eligibleApiKeyIds,
equityByApiKeyId,
perKeyDailiesGateSatisfied: payload.perKeyDailiesGateSatisfied,
```
**Call site to update** (`ScenarioComparePanel.tsx:269`, inside the `liveBook` memo at :265-271): pass `payload.eligibleApiKeyIds` into `buildLiveBookDraft(...)`. Keep `{ liveBook: true }` (:271, Phase-55 union lock). For upgraded (underived) saved columns, derive membership via the shared helper at this boundary before `computeMetricsForDraft`.

---

### `components/ProvenanceNote.tsx` (component, event-driven) — reuse/parameterize

**Analog:** itself. The contract is ALREADY exactly what MEMBER-04 needs: `role="status"` live-region, ephemeral component-local `useState` dismissal (:40), NO cross-tab storage key (the v1.5 provenance contract — grep-assert this stays true). The current copy is hardwired to the window-upgrade message (:51-67). MEMBER-04 needs EITHER a copy `prop` (parameterize the `<p>` text + optional action) OR a sibling variant. Follow the file's own header note (:21-27) explaining WHY dismissal must stay ephemeral (a per-scenario signal that must re-show on the next affected draft). New copy locked at plan time within the calm register: "A data source saved with this scenario is no longer available — showing the remaining sources."

---

### `api/allocator/scenario/share/route.ts` (route, request-response) — MEMBER-03

**Analog:** itself — the mint gate (`share/route.ts:187-200`):
```typescript
const draftAdded = (ownedScenario as { draft?: { addedStrategies?: unknown } | null }).draft?.addedStrategies;
if (!Array.isArray(draftAdded) || draftAdded.length === 0) {
  return NextResponse.json(
    { error: "Nothing shareable", code: "book_only_draft", message: "..." },
    { status: 409, headers: NO_STORE_HEADERS },
  );
}
```
Replace/augment the inline `addedStrategies`-empty check with `isBookOnlyDraft(ownedScenario.draft)` (it reads the raw owner-scoped JSONB, so it can read `memberKeyIds` too). T_SH13/14 must stay green. Note zod-v4 `.uuid()` caveat at :70-76 — do NOT add a second id validator; member ids are opaque `.max(512)` strings.

---

### `scenario-share/[token]/share-resolve.ts` (service, transform) — MEMBER-03

**Analog:** itself — the book-only branch (:197) and the window verbatim-thread (:205-210):
```typescript
if (strategies.length === 0) {
  return { kind: "honest-absence", reason: "book-only" };
}
```
`memberKeyIds` rides the JSONB verbatim exactly like `window` does (no RPC/SQL change). **Open Question 1 (recommendation a):** share-resolve is a pure public-page module with NO owner gate/eligible-ids server-side, so it CANNOT run `deriveMembershipFromGate`. Keep book-only detection as `addedStrategies.length === 0` + `isBookOnlyDraft` for the REASON only; do NOT expand the RPC. A pre-v4 share with empty `addedStrategies` is honest-absence regardless of membership.

---

### `api/allocator/scenario/saved/route.ts` (route) — VERIFY-ONLY

Reuses `scenarioDraftSchema` (imported at :37; body-validate at :59; persists `draft` + `schema_version` from `draft.schema_version` at :137-138). NO code change needed — the field rides automatically. VERIFY the `.optional()` schema decision doesn't let a client POST a v4 draft without membership; if that matters, add a `.superRefine` requiring `memberKeyIds` when `schema_version >= 4` (Open Question 3 — decide the enforcement layer at plan time). `MAX_DRAFT_BODY_BYTES` (256KB, :52) already caps total payload.

---

### `supabase/tests/test_scenario_shares_rls.sql` (test, SQL)

**Analog:** the window round-trip assertion — fixture insert (`:140-159`) + positive assertion (`:249-261`):
```sql
-- fixture (:146-159): draft carries 'window', jsonb_build_object('start','2024-01-01','end','2024-12-31')
-- assertion (:255-259):
IF (r.draft->'window'->>'start') IS DISTINCT FROM '2024-01-01'
   OR (r.draft->'window'->>'end') IS DISTINCT FROM '2024-12-31' THEN
  RAISE EXCEPTION 'TEST FAILED (Assertion 1): draft.window did not round-trip ...';
END IF;
```
Mirror this: add a `'memberKeyIds', jsonb_build_array(...)` to the fixture INSERTs (:146, :162, :193) and a parallel positive round-trip assertion. **Confirm the content-over-return guard at :243** (`payload_text := lower(... r.draft::text ...)`) does not false-positive on member ids — they are UUIDs, same class as the strategy ids already in the payload (low risk). These SQL rows are DB-only (never decode through the codec), so they do NOT exercise the v2-drop risk.

## Shared Patterns

### Membership derivation (the ONE rule)
**Source (new):** `deriveMembershipFromGate(gate, eligibleApiKeyIds)` in `scenario-state.ts`.
**Apply to:** composer reopen (upgraded columns), compare boundary (upgraded columns), NOT share-resolve (no gate server-side).
**Input pair (existing):** `payload.perKeyDailiesGateSatisfied` + `payload.eligibleApiKeyIds` — present at ScenarioComposer.tsx:1669-1684 AND ScenarioComparePanel.tsx:187-190 AND filterable at scenario-compare.ts:163-167. **Never** derive inside the codec (it has no `liveInputs`), and **never** derive from `entryMode` in the upgrade helper (old drafts predate `entryMode`).

### Book-only predicate (the ONE definition)
**Source (new):** `isBookOnlyDraft(draft)` in `scenario-state.ts`.
**Apply to:** mint gate (share/route.ts:190), share-resolve reason (share-resolve.ts:197), compare (informational). No surface re-derives it inline (MEMBER-03).

### Non-destructive codec upgrade (the v1.5 idiom, EXTENDED to two prior versions)
**Source:** scenario-state.ts:741-755 (the single PREV branch) → produce v3 branch (reason `upgraded_v3_membership`) + a SECOND literal-`2` branch (reason `upgraded_v2_chain`). Both `outcome:"ok"`. **Apply to:** every version-relative test fixture (see below). RED-first: assert a v2 blob decodes `ok` (not reset) and prove it FAILS before the second branch exists (Pitfall 1 — the single biggest risk; a missing v2 branch silently drops every stored v2 draft).

### Ephemeral provenance disclosure
**Source:** ProvenanceNote.tsx (whole file) + the nonce-keyed remount at ScenarioComposer.tsx:1182,3264. **Apply to:** MEMBER-04 reopen note. Component-local `useState` dismissal, re-shows per affected draft, grep-assert NO cross-tab storage key.

### Version-relative test-fixture rebase (Pitfall 2 — schedule as an explicit task)
**Apply to:** classify every `schema_version:` / `SCENARIO_SCHEMA_VERSION` fixture as relative (self-adjusts, safe) vs absolute (rebase), preserving each test's INTENT (Rule 9):
- `share-resolve.test.ts:102` — `expect(SCENARIO_SCHEMA_VERSION).toBe(3)` → `.toBe(4)`.
- `share-resolve.test.ts` — ~11 `schema_version: 2` fixtures (lines 124,127,136,168,179,243,288,319,426,432,528,543) — decide per fixture: "two-back survives" (keep 2) vs "prev upgrades" (bump 3).
- `scenario-state.test.ts:472-478, 504-559` — PERSIST-01 v2 hardcodes + Test C `SCENARIO_SCHEMA_VERSION + 1`.
- `scenario-state.localStorage.test.ts:89-152` — relative, low risk, verify.
- `useScenarioState.hydrate.test.tsx` — hand-built drafts must include `memberKeyIds`.
- Grep `schema_version:` and `SCENARIO_SCHEMA_VERSION` across `**/*.test.ts*` before landing.

### Wave 0 RED-first test gaps (from RESEARCH Test Map)
- `scenario-state.test.ts` — v3-branch decode + v2-chain-survives + `isBookOnlyDraft` table + `deriveMembershipFromGate` table.
- `scenario-compare.test.ts` — F5 closure (blank membership + gate=true ⇒ added-only); keep P61 golden block green.
- `ScenarioComposer.test.tsx` — MEMBER-04 ineligible-member reopen → note shows + recompute over remainder.
- `share/route.test.ts` — mint 409 via `isBookOnlyDraft` (T_SH13/14 green).
- `test_scenario_shares_rls.sql` — additive `memberKeyIds` round-trip assertion.

## No Analog Found

None. Every file has an in-repo analog (in most cases the same file's own v1.5 `window`/provenance handling). No RESEARCH.md fallback needed.

## Frozen — zero-diff (GUARD-03, milestone-wide)

`src/lib/scenario.ts`, `src/lib/scenario-window.ts` — do NOT touch.

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/{lib,components,hooks}`, `src/app/api/allocator/scenario/{saved,share}`, `src/app/scenario-share/[token]`, `supabase/tests`.
**Files scanned:** 8 source + 1 SQL (targeted seam reads at RESEARCH-cited line numbers) + grep enumeration of composer seams and test fixtures.
**Pattern extraction date:** 2026-07-03 (HEAD e5e83247).
