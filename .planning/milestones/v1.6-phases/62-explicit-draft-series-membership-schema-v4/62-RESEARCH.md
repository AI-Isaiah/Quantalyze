# Phase 62: Explicit Draft Series Membership (schema v4) - Research

**Researched:** 2026-07-03
**Domain:** In-repo TypeScript codec + consumer wiring (scenario draft persistence, compare engine selection, share mint/resolve, provenance disclosure). No external packages, no SQL migration, no new network surface.
**Confidence:** HIGH (all findings are direct reads of the current source at HEAD `e5e83247`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Membership Field Shape & Codec (MEMBER-01)**
- Persisted field: `memberKeyIds: string[]` REQUIRED at v4 (empty array = blank-authored draft); zod-bounded `.max(64)` following the bounded-array convention (`addedStrategies` `.max(200)`). NOT optional — the field is load-bearing for compare, so absence must be impossible in a v4 draft (an absent field would resurrect gate-inference).
- Codec: `SCENARIO_SCHEMA_VERSION` 3→4, `SCENARIO_SCHEMA_VERSION_PREV` 2→3. A v3 draft decodes `outcome:"ok"` with `reason:"upgraded_v3_membership"`, membership left UNDERIVED for consumer derivation — the exact `upgraded_v2_windowless` pattern (scenario-state.ts:741 branch). Codec stays pure: it has NO access to liveInputs, so it never derives membership itself.
- v2 drafts (two versions back): keep a v2 chain-upgrade branch — v2 decodes ok with BOTH window-absent AND membership-underived (distinct reason), preserving the v1.5 no-drop guarantee. v2 must never fall to reset.
- Derivation rule lives in ONE shared exported helper (`deriveMembershipFromGate`-style): gate=true ⇒ all currently-eligible per-key ids; gate=false ⇒ empty. Consumed by composer-open, compare, and share-resolve — never re-implemented inline.
- Forward-compat unchanged: rawVersion > current (now 5+) → readonly branch as today.

**Compare Semantics (MEMBER-02)**
- For saved drafts, persisted `memberKeyIds` REPLACES `perKeyDailiesGateSatisfied` as the engine-set selector — an empty membership computes added-only even when the live gate is true (closes F5 by construction; `entryMode` stops being load-bearing).
- Live-book column: `buildLiveBookDraft()` stamps explicit membership at build time via the shared helper (all eligible per-key ids). The Phase-55 windowless own-book union lock stays byte-untouched (no `window` on the synthetic draft).
- Upgraded (v2/v3) drafts in compare derive membership via the same shared helper at the compare boundary — old drafts compute IDENTICALLY post-upgrade. Golden: the P61 verify numbers (Cum +0.06% / Sharpe 0.11 @ the 40-day window, Atlas book book-only draft).
- A persisted member id no longer eligible at compare time: drop that member, compute the remainder with honest `member_count` (existing mechanics). Provenance-note disclosure stays scoped to composer reopen (MEMBER-04) — no compare caption this phase.

**Share Mint/Resolve & "book-only" (MEMBER-03)**
- ONE exported predicate in scenario-state.ts (`isBookOnlyDraft`-style): membership contains ≥1 per-key id AND `addedStrategies` is empty. Consumed by the mint gate, share-resolve, and compare — no surface re-derives it.
- Minted share payload mechanics unchanged: the draft persists WHOLE (no RPC/SQL change), so `memberKeyIds` rides along automatically; share-resolve reads it verbatim the way it reads `window`.
- Shared drafts minted before v4 (v2/v3): share-resolve derives membership via the SAME shared helper using the owner-scoped inputs it already loads to compute the scenario — old shares resolve identically (no honest-absence regression).
- Mixed keys+added share behavior unchanged this phase — the honest caption is Phase 64 (PRESENT-03) and will read this membership field.

**Ineligible-Member Disclosure on Reopen (MEMBER-04)**
- Reuse the v1.5 ProvenanceNote pattern: DefaultChangeNote shell, EPHEMERAL component-local dismissal, keyed on `loadedScenarioId` so it re-shows per affected draft. No new machinery, no blocking modal.
- After the drop the composer RECOMPUTES over the remaining members with the note visible — the recompute is fine as long as it is DISCLOSED (MEMBER-04 forbids the silence, not the recompute). Engine memo recomputes today's numbers as normal.
- Note copy locked at plan time following DESIGN.md + the existing calm note register; exact wording at Claude's discretion within that tone.
- Dismissal is ephemeral (component-local useState), re-shows on every reopen of an affected draft; grep-asserted no cross-tab storage key (v1.5 provenance contract).

### Claude's Discretion
- Exact note copy (within the locked register above).
- Exact helper/predicate names and file placement (scenario-state.ts vs a sibling lib module) — follow existing convention.
- Test naming/organization, following the phase-59 RED-first pattern.

### Deferred Ideas (OUT OF SCOPE)
- Persisting data-source include/exclude toggles with the draft (D3 — deliberately ephemeral this milestone; MEMBER-01 makes it trivial later).
- Compare per-column caption for dropped ineligible members (kept to honest member_count this phase; reopen disclosure covers the requirement).
- Mixed-share honest caption — Phase 64 PRESENT-03.
- Any engine deletion (Phase 63), AUM/caption presentation (Phase 64), prod canary (Phase 65).
- Any change to frozen `src/lib/scenario.ts` / `scenario-window.ts` (GUARD-03).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEMBER-01 | Saved draft persists series membership as explicit per-key id list; `SCENARIO_SCHEMA_VERSION` 3→4 with NON-destructive upgrade branch (v3 derives membership from today's gate rule on open) | Codec map §Standard Stack / Pattern 1; field placement in `ScenarioDraft` + `scenarioDraftSchema`; the **critical two-branch requirement** (v2 AND v3 must both survive) in Pitfall 1 |
| MEMBER-02 | Compare distinguishes blank from book drafts by persisted membership; blank NEVER merges the live book (closes F5); `entryMode` stops being load-bearing for saved drafts | `computeMetricsForDraft` selector rewrite (scenario-compare.ts:157); `buildLiveBookDraft` membership stamp; Architecture Pattern 2 |
| MEMBER-03 | Share mint gate + share-resolve read the SAME membership field; "book-only" = membership containing only per-key ids, one definition | `isBookOnlyDraft` predicate; mint gate at share/route.ts:180-200; share-resolve.ts:197 book-only branch; **Open Question 1** (share-resolve has no owner per-key inputs server-side) |
| MEMBER-04 | Reopening a draft whose persisted member key is no longer eligible DISCLOSES the drop (provenance-note mechanics) — never a silent recompute | Eligibility check in `openSavedScenario` (composer:1135) vs `payload.eligibleApiKeyIds`; ProvenanceNote reuse; Architecture Pattern 4 |
</phase_requirements>

## Summary

This is a **pure-additive, in-repo TypeScript phase** — no new dependencies, no SQL migration, no new HTTP surface. The draft already persists WHOLE as a `jsonb` column (`scenarios.draft`) and is validated by one canonical zod schema (`scenarioDraftSchema` in `scenario-state.ts`), reused verbatim by the save route. Adding a `memberKeyIds: string[]` field therefore requires **zero database work** — it rides the existing whole-draft persistence exactly the way v1.5's optional `window` field did. The `schema_version` int column is written straight from `draft.schema_version`, so the 3→4 bump propagates automatically.

The phase has exactly **one high-risk mechanic**: the codec version trichotomy. Bumping `SCENARIO_SCHEMA_VERSION` 3→4 and `_PREV` 2→3 leaves **v2 drafts two versions back**, which under the current single-PREV-branch logic fall through to the final `reset → version_mismatch` return — **silently deleting every stored v2 draft**. The v1.5 pattern only added ONE non-destructive branch (PREV). This phase must add a **SECOND** non-destructive branch so BOTH v2 and v3 decode `ok`. This is the "v2 chain-upgrade branch KEPT" locked decision, and it is the single most important thing the plan must get right (it is also what breaks the large fixture population in `share-resolve.test.ts`, which pins ~11 `schema_version: 2` fixtures).

The three consumers each have a precise, already-located seam: compare's engine-set selector (`usePerKeySources` at scenario-compare.ts:157), the share mint gate (share/route.ts:180-200, server-side), and the composer reopen path (`openSavedScenario` at ScenarioComposer.tsx:1135, which already owns the ProvenanceNote wiring for the v1.5 window-upgrade case and already has `payload.eligibleApiKeyIds` in scope).

**Primary recommendation:** Follow the v1.5 Phase-59 execution shape verbatim — RED codec tests first (both v2 and v3 non-destructive branches, forward-compat pin), then the field + double version bump + the shared `deriveMembershipFromGate` helper + `isBookOnlyDraft` predicate, then wire the three consumers, then rebase the version-relative fixtures and add the additive RLS round-trip assertion. Treat "membership STAMPING at new-save" and "membership DERIVATION at upgrade-read" as two distinct code paths (see Open Question 2).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Persist `memberKeyIds` in the draft | Pure lib (`scenario-state.ts`) | — | Codec + schema own the persisted shape; the transforms preserve it via `...draft` spread |
| Derive membership for pre-v4 drafts | Pure lib (shared helper) called at each consumer boundary | Frontend (composer, compare panel) supply `gate` + `eligibleApiKeyIds` | Codec is pure and has no `liveInputs`; derivation happens where the live gate/eligible-ids are known |
| Stamp real membership on a NEW save | Frontend (ScenarioComposer) | — | Only the composer knows `entryMode` + live gate + eligible per-key ids at edit time |
| Engine-set selection by membership | Pure lib (`scenario-compare.ts` `computeMetricsForDraft`) | — | Compare already owns the P61-BUG-2 per-key vs holdings selection |
| "book-only" predicate | Pure lib (`scenario-state.ts` `isBookOnlyDraft`) | API route + share-resolve + compare consume it | One definition, multiple read sites (MEMBER-03) |
| Mint-gate rejection | API route (`share/route.ts`) | — | Server-side owner-scoped read of the draft JSONB; already reads `draft.addedStrategies` |
| Ineligible-member disclosure | Frontend (ScenarioComposer `openSavedScenario` + ProvenanceNote) | — | Only the composer has `payload.eligibleApiKeyIds` at reopen and owns the note-gate state |

## Standard Stack

No external libraries introduced. The phase uses only what the surface already imports.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | v4 (Next-bundled) | draft schema validation (`scenarioDraftSchema`) | Already the sole draft validator; `.max(64)` bounded-array mirrors existing `.max(200)` on `addedStrategies` [VERIFIED: src/app/(dashboard)/allocations/lib/scenario-state.ts:591-659] |

**No installation.** No `npm install`. **Package Legitimacy Audit is N/A** — this phase installs nothing.

**Note on zod version:** This repo runs a customized Next.js that bundles **zod 4** (per AGENTS.md "This is NOT the Next.js you know" and the share route's explicit note at share/route.ts:70-76 avoiding zod v4's stricter `.uuid()`). `.max(n)` on `z.array` and `.optional()` are stable across v3/v4; the new field's validation needs no version-specific handling. [CITED: src/app/api/allocator/scenario/share/route.ts:70-76]

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────────┐
   USER EDITS  ───►  │ ScenarioComposer (client)                        │
   (book/blank,      │   entryMode + payload.eligibleApiKeyIds + gate   │
    add/remove)      │   scenario.draft (working ScenarioDraft)         │
                     └───────────────┬──────────────────┬──────────────┘
                                     │ SAVE (POST/PUT)   │ REOPEN
                    stamp memberKeyIds from live state   │ decode via codec
                                     ▼                   ▼
              ┌──────────────────────────────┐   ┌──────────────────────────────┐
              │ /api/.../scenario/saved       │   │ scenarioDraftCodec.decode     │
              │   scenarioDraftSchema (zod)   │   │  v4  → ok(null)               │
              │   → scenarios.draft (jsonb)   │   │  v3  → ok(upgraded_v3_member) │  ← NEW branch
              │   → schema_version col        │   │  v2  → ok(upgraded_v2_window+ │  ← KEEP, extend reason
              └───────────────┬───────────────┘   │        member underived)      │
                              │                    │  >v4 → readonly(version_ahead)│
   ┌──────────────────────────┼────────────┐      └───────────┬───────────────────┘
   │                          │            │                  │ reason drives:
   ▼                          ▼            ▼                  ▼  1. membership derivation (shared helper)
┌───────────────┐  ┌────────────────┐  ┌──────────────┐    2. MEMBER-04 eligibility check → ProvenanceNote
│ COMPARE panel │  │ SHARE mint      │  │ SHARE resolve│
│ computeMetrics│  │  route.ts:180   │  │ (public page)│
│  ForDraft     │  │  isBookOnlyDraft│  │ isBookOnly / │
│  membership → │  │  → 409 or mint  │  │ book-only    │
│  engine set   │  └────────────────┘  │ absence      │
│ buildLiveBook │                      └──────────────┘
│  Draft(stamp) │
└───────────────┘
        │ all read the SAME memberKeyIds field + SAME deriveMembershipFromGate helper + SAME isBookOnlyDraft predicate
        ▼
   deriveMembershipFromGate(gate, eligibleApiKeyIds)  — the ONE derivation rule
```

### Recommended Project Structure (touch list, no new dirs)

```
src/app/(dashboard)/allocations/
├── lib/
│   ├── scenario-state.ts        # field + zod + double version bump + codec branch + deriveMembershipFromGate + isBookOnlyDraft
│   ├── scenario-state.test.ts   # RED-first codec tests (v2 + v3 branches); rebase existing version fixtures
│   ├── scenario-compare.ts      # computeMetricsForDraft selector rewrite; buildLiveBookDraft stamps membership
│   └── scenario-compare.test.ts # F5-closure test; golden P61 numbers preserved
├── components/
│   ├── ScenarioComposer.tsx     # openSavedScenario: derive/eligibility-check + note; save: stamp membership
│   ├── ScenarioComparePanel.tsx # pass eligibleApiKeyIds into buildLiveBookDraft; derive membership for upgraded columns
│   └── ProvenanceNote.tsx       # reuse (may parameterize copy) — ephemeral, keyed on loadedScenarioId
├── hooks/
│   └── useScenarioState.ts      # defaultDraft carries memberKeyIds:[] (no per-key ids available here)
└── ...
src/app/api/allocator/scenario/
├── saved/route.ts               # NO code change needed (reuses scenarioDraftSchema) — verify only
└── share/route.ts               # mint gate: isBookOnlyDraft(draft) replaces addedStrategies-empty check
src/app/scenario-share/[token]/
├── share-resolve.ts             # book-only detection consistency (see Open Question 1)
└── share-resolve.test.ts        # REBASE ~11 schema_version:2 fixtures + the version-ahead .toBe(3) pin
supabase/tests/
└── test_scenario_shares_rls.sql # ADD additive memberKeyIds round-trip assertion (mirror the window one)
```

### Pattern 1: Non-destructive multi-version codec upgrade (the v1.5 idiom, EXTENDED to two prior versions)

**What:** Version-keyed branches placed BEFORE the final `reset` return. Each returns `outcome:"ok"` + a distinct `reason` string; consumers react to the reason.
**When to use:** Every additive-field version bump where old drafts remain fully valid.
**Current code (the single PREV branch that must become two):**
```typescript
// Source: src/app/(dashboard)/allocations/lib/scenario-state.ts:741-755 (current v1.5 shape)
if (rawVersion === SCENARIO_SCHEMA_VERSION_PREV) {   // PREV is currently 2
  const safe = scenarioDraftSchema.safeParse(parsed);
  if (safe.success) {
    return {
      value: { ...(safe.data as unknown as ScenarioDraft),
               schema_version: SCENARIO_SCHEMA_VERSION },
      outcome: "ok",
      reason: "upgraded_v2_windowless",
    };
  }
  return { value: defaultDraft, outcome: "reset", reason: "schema_invalid" };
}
// … then the final: return { value: defaultDraft, outcome: "reset", reason: "version_mismatch" };
```
**After v4 (structure the plan must produce):** `_PREV` becomes 3 → the existing branch keys on v3 (`reason: "upgraded_v3_membership"`). ADD a SECOND branch keyed on the literal `2` (two versions back) that decodes `ok` with a distinct reason (e.g. `"upgraded_v2_chain"`) — it must survive BOTH the missing `window` AND the missing `memberKeyIds`. Without this second branch, a v2 blob hits `< PREV` → `version_mismatch` → **every stored v2 draft is silently dropped** (Pitfall 1). The zod schema must make BOTH new-since-v2 fields tolerant on parse (see Pitfall 3 — a REQUIRED `memberKeyIds` in the schema would fail `safeParse` on a genuine v2 blob that lacks it, routing it to reset).

### Pattern 2: Membership-driven engine-set selection (MEMBER-02, closes F5)

**What:** `computeMetricsForDraft` currently selects the per-key engine set purely from the live gate:
```typescript
// Source: src/app/(dashboard)/allocations/lib/scenario-compare.ts:157
const usePerKeySources = liveInputs.perKeyDailiesGateSatisfied === true;
// then filters eligibleOnly = all eligible keys, ignoring what the draft actually saved
```
**The F5 bug it causes:** a blank-authored draft (no book members) still gets the full live book merged into its compare column whenever the live gate is true — compare cannot tell blank from book because `entryMode` was never persisted.
**After MEMBER-02:** for a SAVED draft, `memberKeyIds` is the selector. `usePerKeySources` becomes `draft.memberKeyIds.length > 0` (membership contains per-key ids), and the `eligibleOnly` filter intersects the live eligible set with `draft.memberKeyIds` (only persisted members that are still eligible — this is also the MEMBER-04 drop point at compute). An empty membership computes added-only even when the live gate is true. For upgraded v2/v3 columns whose membership is underived, the panel derives it via `deriveMembershipFromGate(gate, eligibleApiKeyIds)` at the compare boundary before calling `computeMetricsForDraft`.
**Golden preservation:** the Atlas-book book-only draft must still compute Cum +0.06% / Sharpe 0.11 at the 40-day window — an upgraded v3 draft with gate=true derives membership = all eligible per-key ids, which is exactly what the current gate-only path selects, so real drafts compute identically (0 real gate=false users on prod — CONTEXT §specifics).

### Pattern 3: One predicate, three read sites (MEMBER-03)

**What:** `isBookOnlyDraft(draft): boolean` = `draft.memberKeyIds.length >= 1 && draft.addedStrategies.length === 0`. Exported from `scenario-state.ts`.
**Read sites:**
- Mint gate (`share/route.ts:187-200`) — currently rejects `!Array.isArray(draftAdded) || draftAdded.length === 0`. Replace/augment with `isBookOnlyDraft`. Note it reads the raw draft JSONB (`ownedScenario.draft`), so it can read `memberKeyIds` too.
- share-resolve (`share-resolve.ts:197`) — currently `strategies.length === 0 → honest-absence reason:"book-only"`.
- compare (informational this phase; the honest caption is Phase 64).

### Pattern 4: Ineligible-member disclosure on reopen (MEMBER-04)

**What:** In `openSavedScenario` (ScenarioComposer.tsx:1135), after decode + hydrate, compare the draft's persisted `memberKeyIds` against `payload.eligibleApiKeyIds`. Any persisted member id NOT in the current eligible set is a "dropped member." When ≥1 member dropped, raise a provenance note (reuse the `ProvenanceNote` mechanics) and let the existing engineState memo recompute over the remaining members.
**Reuse target:** `ProvenanceNote.tsx` — the note is already ephemeral (component-local `useState`), keyed in the composer via `key={`${loadedScenarioId ?? "provenance"}-${provenanceOpenNonceRef.current}`}` (ScenarioComposer.tsx:3264). The nonce (`provenanceOpenNonceRef`, defined at :850, bumped at :1182 on every completed open) already solves the A→dismiss→reopen-A re-show case. MEMBER-04 needs either a second note variant or a parameterized copy prop — the existing note is hardwired to the window-upgrade copy and gated on `showProvenanceNote && activeWindowIsCommonPeriod`.

### Anti-Patterns to Avoid
- **Deriving membership inside the codec.** The codec is pure and has no `liveInputs`; it must leave membership underived and hand off a reason. (Locked decision.)
- **Making `memberKeyIds` REQUIRED in the zod schema used for the v2/v3 upgrade `safeParse`.** A genuine v2/v3 blob has no such field; a required field fails `safeParse` and routes the draft to `reset` — the exact silent-delete the branch exists to prevent (Pitfall 3).
- **Stamping membership from `entryMode` in the shared UPGRADE helper.** Old drafts predate `entryMode`; the upgrade rule is gate-only (gate=true ⇒ eligible ids). New-save stamping is a separate path (Open Question 2).
- **A second `.uuid()`/id validator.** Reuse `scenarioDraftSchema`; member ids are opaque strings bounded `.max(64)` count + the existing `MAX_DRAFT_KEY_LENGTH` per-entry convention if you also bound element length.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persisting membership to the DB | A new column / migration / RPC change | The existing whole-draft `jsonb` persistence | `scenarios.draft` stores the draft verbatim; `get_shared_scenario` returns it whole; the window field proved this needs no SQL [VERIFIED: saved/route.ts:137-138, share-resolve.ts:205-210] |
| Draft body validation on save | A second validator in the route | `scenarioDraftSchema` (already imported by saved/route.ts:37) | One canonical contract; adding the field there covers save + PUT + localStorage + cross-tab automatically |
| Book-only definition | Per-surface inline checks | One exported `isBookOnlyDraft` | MEMBER-03 requires a single definition across mint/resolve/compare |
| Membership derivation | Inline gate checks at each consumer | One exported `deriveMembershipFromGate(gate, eligibleIds)` | Locked decision; prevents drift between composer/compare/share |
| Ineligible-member note | A new modal / toast system | `ProvenanceNote` + the existing nonce-keyed remount | v1.5 provenance contract; ephemeral, no cross-tab key |

**Key insight:** Every "new" mechanism this phase appears to need already exists from v1.5 — the whole-draft persistence, the non-destructive codec branch, the ephemeral provenance note, the canonical zod schema. The work is *extending* each by one field/branch/predicate, not building anything new.

## Runtime State Inventory

> This is not a rename/migration phase, but it touches persisted state, so the state surfaces are inventoried for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `scenarios.draft` jsonb rows on prod carry v2/v3 drafts (NO `memberKeyIds`). Prod grounding: 0 real gate=false users; all real saved drafts are book drafts under the live gate (CONTEXT §specifics). | **Code edit only** — no data migration. Old rows upgrade NON-destructively on read (v2/v3 branches). New saves persist v4. The `schema_version` int column is written from `draft.schema_version` (saved/route.ts:138) so it advances automatically on the next save. |
| Stored data (localStorage) | `allocations.scenario_v0_15.{allocatorId}` per-allocator working draft, decoded via the SAME codec + `useCrossTabStorage`. | **None beyond the codec branch** — the localStorage hot path routes through `scenarioDraftCodec`, so the v2/v3 upgrade branches cover it. The legacy bare `loadScenarioDraft` helper (scenario-state.ts:802) does an EXACT `!== SCENARIO_SCHEMA_VERSION` check → returns null on any non-current version; it is back-compat only (NOT the hot path) but its localStorage test rebases (see Pitfall 2). |
| Live service config | None — no external service stores the draft shape. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None referenced by this field. | None. |
| Build artifacts | None. `database.types.ts` is NOT regenerated (no schema change). | None — verified no SQL/column change needed. |

**Nothing found in the OS-registered / secrets / live-service categories — verified by grep of the persistence surfaces (localStorage codec, save route, share RPC).**

## Common Pitfalls

### Pitfall 1: The double version bump silently deletes v2 drafts (THE big one)
**What goes wrong:** Bumping `SCENARIO_SCHEMA_VERSION` 3→4 and `_PREV` 2→3 leaves v2 drafts two versions back. The current codec has exactly ONE non-destructive branch (`rawVersion === SCENARIO_SCHEMA_VERSION_PREV`). A v2 blob no longer matches it, no other branch matches, and it falls to `return { outcome: "reset", reason: "version_mismatch" }` (scenario-state.ts:762) → the user's saved scenario is silently dropped (reopen → fresh live book, share → 404/honest-absence, compare → older-format stamp).
**Why it happens:** The v1.5 pattern was designed for a single-step non-destructive upgrade; a two-versions-back population wasn't a concern then.
**How to avoid:** Add a SECOND non-destructive branch keyed on the literal `2`. Both branches decode `ok` with distinct reasons (`upgraded_v3_membership`, `upgraded_v2_chain`). RED-first: write the test that a v2 blob decodes `ok` (not reset) and assert it FAILS before the branch exists.
**Warning signs:** Any `share-resolve.test.ts` `schema_version: 2` fixture flipping from a computed metric to `honest-absence`; the RLS SQL fixtures (schema_version 2 rows) are DB-only and don't decode through the codec, so they won't catch this.

### Pitfall 2: Version-relative test fixtures break on the bump (v1.5 Pitfall 2, recurring)
**What goes wrong:** Fixtures pinned to `SCENARIO_SCHEMA_VERSION + 1` self-adjust (fine), but fixtures pinned to a HARDCODED version or an explicit `.toBe(3)` assertion break.
**Enumerated breakages (verified reads):**
- `src/app/scenario-share/[token]/share-resolve.test.ts:102` — `expect(SCENARIO_SCHEMA_VERSION).toBe(3)` → must become `.toBe(4)`.
- `share-resolve.test.ts` — **~11 fixtures at `schema_version: 2`** (lines 124, 127, 136, 168, 179, 243, 288, 319, 426, 432, 528, 543). Under v4 these are two-back; they will only keep computing IF the v2 chain branch (Pitfall 1) exists. If the plan intends some to represent "current-minus-one," bump them to 3. Preserve each test's INTENT (Rule 9) — decide per fixture whether it is testing "two versions back survives" vs "prev version upgrades."
- `src/app/(dashboard)/allocations/lib/scenario-state.test.ts:472-478` — "forward version" test uses `SCENARIO_SCHEMA_VERSION + 1` (self-adjusts) but the describe comment says "schema_version=2"; the PERSIST-01 block (:504-559) hardcodes `schema_version: 2` for `windowlessV2()` and Test C asserts `SCENARIO_SCHEMA_VERSION + 1 === 4` (:543 → becomes 5). These need re-basing to the new constants while KEEPING the v2-survives intent.
- `src/app/(dashboard)/allocations/lib/scenario-state.localStorage.test.ts:89-152` — the legacy-helper tests use `SCENARIO_SCHEMA_VERSION + 1` (self-adjust) and assert `loaded?.schema_version).toBe(SCENARIO_SCHEMA_VERSION)` (relative, fine). Low risk; verify.
- `src/app/(dashboard)/allocations/hooks/useScenarioState.hydrate.test.tsx` — uses `SCENARIO_SCHEMA_VERSION` relative throughout (fine); verify the new REQUIRED-in-shape field doesn't break the fixtures that build drafts by hand (they must include `memberKeyIds`).
**How to avoid:** Grep `schema_version:` and `SCENARIO_SCHEMA_VERSION` across `**/*.test.ts*` before landing; classify each fixture as relative (safe) or absolute (rebase). Schedule this as an explicit Pitfall-2 rebase task, not an afterthought.

### Pitfall 3: A REQUIRED `memberKeyIds` in the schema defeats the non-destructive branch
**What goes wrong:** The locked decision makes `memberKeyIds` REQUIRED at v4. But the v2/v3 non-destructive branches call `scenarioDraftSchema.safeParse(parsed)` on a blob that has NO `memberKeyIds`. If the schema field is `.min(0)` REQUIRED (not `.optional()`), `safeParse` FAILS → the branch's `if (safe.success)` is false → it returns `reset(schema_invalid)` → silent delete.
**How it was handled for `window`:** `window` was made `.optional()` in the schema (scenario-state.ts:651-656) precisely so v2 blobs `safeParse` clean.
**How to avoid:** The zod schema field should tolerate absence at parse time for the upgrade branches, while the CONTRACT (a v4 draft always has it) is enforced by the codec supplying it on upgrade and the writers stamping it. Recommended: schema field `z.array(z.string().max(...)).max(64).optional()` with the codec/writers guaranteeing presence at v4. Alternatively, `safeParse` a RELAXED schema in the upgrade branches. This is a genuine design tension the plan must resolve explicitly — flag it. (Contrast: the save-route body schema at saved/route.ts:59 reuses `scenarioDraftSchema`; if the field is optional there, a client could POST a v4 draft without membership. If that matters, add a `.superRefine` requiring the field when `schema_version >= 4`.) **See Open Question 3.**

### Pitfall 4: `buildLiveBookDraft()` takes no arguments today
**What goes wrong:** CONTEXT §code_context says it hardcodes `schema_version: 2` — the ACTUAL current code (scenario-compare.ts:302) already uses `schema_version: SCENARIO_SCHEMA_VERSION` (so it auto-bumps to 4, no stale literal). But it takes NO parameters and returns empty `toggleByScopeRef`/`weightOverrides`. To stamp `memberKeyIds = all eligible per-key ids`, it needs the eligible ids passed in.
**How to avoid:** Change the signature to `buildLiveBookDraft(eligibleApiKeyIds: string[])` and stamp membership. The sole call site is `ScenarioComparePanel.tsx:269`, which has `liveInputs.eligibleApiKeyIds` in scope. Add `memberKeyIds: []` to the literal at minimum so the object satisfies the v4 shape.

### Pitfall 5: `defaultDraftFromHoldings` builds a fresh object without spread
**What goes wrong:** All the transforms (`toggleHolding`, `addStrategyBrowse`, `removeAddedStrategy`, `setWeightOverride`, `applyWeightOverrides`, `setWindow`) return `{ ...draft, ... }` → they PRESERVE `memberKeyIds` automatically. But `defaultDraftFromHoldings` (scenario-state.ts:226-233) builds a FRESH literal with an explicit field list — it must add `memberKeyIds`. It has only `holdings` in scope (no per-key api-key ids), so it can only stamp `[]`.
**How to avoid:** `defaultDraftFromHoldings` stamps `memberKeyIds: []`. The REAL membership is stamped by the composer at edit/save time from the live gate + eligible ids (Open Question 2). Verify each transform's return object still carries the field after edits (they do via spread — pin a test).

## Code Examples

### The eligible-per-key enumeration the shared helper consumes (composer)
```typescript
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1669-1684
const eligible = new Set(payload.eligibleApiKeyIds ?? []);
const eligibleOnly = Object.fromEntries(
  Object.entries(payload.perKeyReturnsByApiKeyId ?? {}).filter(([id]) => eligible.has(id)),
);
// …
const usePerKeySources = entryMode === "book" && payload.perKeyDailiesGateSatisfied;
```
This is the exact input pair the shared `deriveMembershipFromGate(gate, eligibleApiKeyIds)` needs: the gate boolean (`payload.perKeyDailiesGateSatisfied`) and the eligible id list (`payload.eligibleApiKeyIds`). Both are SSR-computed and present at composer-open AND in the compare panel (`ScenarioComparePanel.tsx:187-190`) AND filterable at compute (`scenario-compare.ts:163-167`).

### The compare-panel live-inputs assembly (where upgraded-draft membership derivation hooks in)
```typescript
// Source: src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx:187-190
perKeyReturnsByApiKeyId: payload.perKeyReturnsByApiKeyId,
eligibleApiKeyIds: payload.eligibleApiKeyIds,
equityByApiKeyId,
perKeyDailiesGateSatisfied: payload.perKeyDailiesGateSatisfied,
```

### The mint gate that becomes `isBookOnlyDraft` (server-side, reads raw JSONB)
```typescript
// Source: src/app/api/allocator/scenario/share/route.ts:187-200
const draftAdded = (ownedScenario as { draft?: { addedStrategies?: unknown } | null })
  .draft?.addedStrategies;
if (!Array.isArray(draftAdded) || draftAdded.length === 0) {
  return NextResponse.json({ error: "Nothing shareable", code: "book_only_draft", … },
    { status: 409, … });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Draft = "whatever the live book looks like when opened"; `entryMode` ephemeral, never persisted | Explicit persisted `memberKeyIds` (this phase) | Phase 62 | Compare/share/mint become self-describing; closes F5 |
| Compare selects engine set from live gate only (`perKeyDailiesGateSatisfied`) | Membership replaces the gate as selector for saved drafts | Phase 62 (MEMBER-02) | Blank drafts stop inheriting the live book |
| Single non-destructive codec branch (PREV only) | Two non-destructive branches (v2 chain + v3) | Phase 62 | No stored draft dropped across a two-version span |

**Deprecated/outdated:**
- CONTEXT §code_context claims `buildLiveBookDraft` hardcodes `schema_version: 2` — **stale**; the live code (scenario-compare.ts:302) already uses `SCENARIO_SCHEMA_VERSION`. The membership STAMP is still needed, but no version-literal fix is required there.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No SQL migration needed — draft persists whole as jsonb; `schema_version` col written from `draft.schema_version` | Runtime State Inventory / Don't Hand-Roll | LOW — verified against saved/route.ts:137-138 and share-resolve.ts:205-210; the v1.5 window field is the proof-of-pattern |
| A2 | share-resolve cannot derive membership from owner per-key inputs (it only receives published added-strategy series via the RPC) | Open Question 1 | MEDIUM — if MEMBER-03's "share-resolve derives via the shared helper using owner-scoped inputs" implies the RPC should return eligible ids, that's a scope expansion; verify what `get_shared_scenario` returns |
| A3 | New-save membership stamping (entryMode-aware) is a DISTINCT path from upgrade-read derivation (gate-only) | Open Question 2 | MEDIUM — conflating them would let a blank NEW draft with gate=true stamp book members, re-opening F5 |

## Open Questions (RESOLVED — orchestrator, 2026-07-03, plan-checker iteration 2)

> OQ1 → resolved as recommendation (a): no RPC change; share-resolve detection stays on
> `strategies.length === 0`, `isBookOnlyDraft` (null-safe) for the reason only (plan 03).
> OQ2 → resolved: STAMP (entryMode-aware, plan 04) ≠ DERIVE (gate-only helper, plans 02/04).
> OQ3 → resolved: tolerant shared codec schema + separate `scenarioDraftSaveSchema`
> (`schema_version>=4` superRefine) on BOTH save routes — POST and PUT (plan 01, incl. W-A).

1. **share-resolve membership derivation for pre-v4 shares.** CONTEXT MEMBER-03 says share-resolve "derives membership via the SAME shared helper using the owner-scoped inputs it already loads." But `share-resolve.ts` is a PURE public-page module that receives ONLY the draft JSONB + published added-strategy series from `get_shared_scenario` — it has NO owner per-key api-key ids or gate. On the public page, per-key book series are never resolvable anyway (the live-book boundary), so "book-only" there is effectively `strategies.length === 0` (its current line-197 check). 
   - What we know: the page can read `draft.memberKeyIds` verbatim (it rides the JSONB) and apply `isBookOnlyDraft`. It cannot run `deriveMembershipFromGate` (no gate/eligible ids server-side).
   - What's unclear: whether the plan should (a) keep share-resolve's book-only detection as `addedStrategies.length === 0` + `isBookOnlyDraft` for the REASON only, or (b) expand the RPC to return eligible ids.
   - Recommendation: (a) — no RPC change. A pre-v4 share with empty `addedStrategies` is honest-absence regardless of membership; `isBookOnlyDraft` supplies the reason for v4 drafts. Flag for discuss-phase confirmation.

2. **Where real membership is STAMPED on a new save, and by what rule.** Two rules are in play: the UPGRADE rule (`deriveMembershipFromGate(gate, eligibleIds)` — gate-only, for old drafts that predate `entryMode`) and the NEW-SAVE rule (must respect `entryMode`: book+gate ⇒ eligible ids, blank ⇒ empty even if gate=true — that IS the F5 closure). 
   - What we know: `defaultDraftFromHoldings` can only stamp `[]` (no per-key ids in scope); the composer has `entryMode` + gate + eligible ids.
   - What's unclear: the exact stamping seam — a composer effect/memo that maintains `memberKeyIds` on the working draft, vs. computing it into the POST/PUT body at save time. A dedicated pure transform (`setMemberKeyIds(draft, ids)`) invoked by the composer is the cleanest.
   - Recommendation: composer stamps via a small pure setter whenever `entryMode`/gate/eligible-ids change; save persists `scenario.draft` unchanged. Let the planner pick the seam; the constraint is that a blank-mode save with gate=true persists `[]`.

3. **Zod required-vs-optional tension (Pitfall 3).** `memberKeyIds` is REQUIRED at v4 by decision, but the schema `safeParse` runs on v2/v3 blobs in the upgrade branches. 
   - Recommendation: field `.optional()` in `scenarioDraftSchema` (so upgrade `safeParse` passes), with the codec/writers guaranteeing presence at v4, and optionally a `.superRefine` on the save-route body requiring it when `schema_version >= 4`. Confirm the exact enforcement layer at plan time.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (v8 coverage) + `@testing-library/react` for components; pgTAP-style raw SQL for RLS |
| Config file | `vitest.config.ts` (thresholds: lines 82 / statements 80 / functions 74 / branches 72 — CLAUDE.md) |
| Quick run command | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-state.test.ts` |
| Full suite command | `npm test` (sharded in CI with `--coverage`; `frontend` aggregator gates branch protection) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEMBER-01 | v2 blob decodes ok (never reset) after double bump | unit | `npx vitest run …/scenario-state.test.ts -t "v2"` | ✅ (extend; RED-first) |
| MEMBER-01 | v3 blob decodes ok(upgraded_v3_membership), membership underived | unit | `npx vitest run …/scenario-state.test.ts -t "v3"` | ❌ Wave 0 (new test) |
| MEMBER-01 | forward-compat: v5 → readonly(version_ahead) | unit | `npx vitest run …/scenario-state.test.ts -t "version_ahead"` | ✅ (rebase constant) |
| MEMBER-02 | blank draft (empty membership) computes added-only even when gate=true (F5) | unit | `npx vitest run …/scenario-compare.test.ts -t "blank"` | ✅ (extend) |
| MEMBER-02 | golden: upgraded book draft computes Cum +0.06%/Sharpe 0.11 @ 40-day | unit | `npx vitest run …/scenario-compare.test.ts` | ✅ (P61 block — must stay green) |
| MEMBER-03 | `isBookOnlyDraft` true/false table | unit | `npx vitest run …/scenario-state.test.ts -t "isBookOnly"` | ❌ Wave 0 |
| MEMBER-03 | mint gate 409 book_only via predicate (T_SH13/14 stay green) | unit | `npx vitest run src/app/api/allocator/scenario/share/route.test.ts` | ✅ (extend) |
| MEMBER-04 | reopen with ineligible member → provenance note shows; recompute over remainder | component | `npx vitest run …/ScenarioComposer.test.tsx -t "ineligible"` | ❌ Wave 0 |
| MEMBER-04 | dismissal ephemeral; grep-assert no cross-tab key | unit/grep | `rg "memberKeyIds" src --type ts -l` + `ProvenanceNote.test.tsx` | ✅ (extend) |
| MEMBER-01 (persistence) | additive `memberKeyIds` round-trips through `get_shared_scenario` RPC | SQL | via CI `supabase/tests/test_scenario_shares_rls.sql` | ✅ (add assertion, mirror window one at :249-261) |

### Sampling Rate
- **Per task commit:** the touched-module test file (e.g. `npx vitest run …/scenario-state.test.ts`).
- **Per wave merge:** `npm test` (full vitest) + `npm run lint` (react-hooks errors) + `npx tsc --noEmit`.
- **Phase gate:** full suite green + coverage thresholds met (`npm run test:coverage`) before `/gsd:verify-work`; RLS SQL runs against the persistent test project in CI.

### Wave 0 Gaps
- [ ] `scenario-state.test.ts` — add v3-branch decode test + `isBookOnlyDraft` table + `deriveMembershipFromGate` table (RED-first).
- [ ] `scenario-compare.test.ts` — add F5-closure test (blank membership + gate=true ⇒ added-only).
- [ ] `ScenarioComposer.test.tsx` — add MEMBER-04 ineligible-member reopen → note test.
- [ ] `supabase/tests/test_scenario_shares_rls.sql` — add additive `memberKeyIds` round-trip assertion (parallel to the window assertion at :249-261); update the fixture INSERTs (:146, :162, :193) to include a `memberKeyIds` jsonb array.
- [ ] Pitfall-2 rebase task: reclassify every `schema_version: 2` / `.toBe(3)` fixture in `share-resolve.test.ts` and `scenario-state.test.ts`.
- [ ] Framework install: none — Vitest already configured.

## Security Domain

> `security_enforcement` not disabled in config → included. This phase adds one bounded array field to an existing owner-scoped, RLS-protected persistence path. No new auth/session/crypto surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Unchanged — save/share routes already wrapped by `withAllocatorAuth` |
| V3 Session Management | no | Unchanged |
| V4 Access Control | yes (unchanged) | `scenarios_owner` RLS (`allocator_id = auth.uid()`) + the 3-layer CR-01 ownership probe on share mint (share/route.ts:135-178) — no new access path; `memberKeyIds` rides the already-owner-scoped draft |
| V5 Input Validation | yes | `scenarioDraftSchema` bounds the new field: `.max(64)` element count + reuse `MAX_DRAFT_KEY_LENGTH` (512) per element; the route-level `MAX_DRAFT_BODY_BYTES` (256KB) DoS cap already covers total payload (saved/route.ts:52) |
| V6 Cryptography | no | Unchanged — share tokens hashed via `mintShareToken` (untouched) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Storage-poison via unbounded array (millions of synthetic member ids) | Denial of Service | `.max(64)` count bound + per-element `.max(512)` + the existing 256KB body cap and `MAX_DRAFT_RECORD_ENTRIES` convention (scenario-state.ts:613-621) |
| Cross-tenant leak of another allocator's per-key ids via a shared draft | Information Disclosure | `memberKeyIds` are the OWNER's own api-key ids; share-resolve never exposes book series; the public page resolves only published added-strategy series — member ids in the JSONB are opaque owner-scoped strings, but confirm the RLS SQL over-return guard (test_scenario_shares_rls.sql:240-243 lowercases the whole payload for forbidden-field scanning) still passes with the new field present |
| Book-only share becomes a dead public link | (integrity/UX) | `isBookOnlyDraft` mint gate rejects at source (409); share-resolve keeps already-minted links honest |

**Action for the plan:** confirm the RLS test's content-over-return guard (test_scenario_shares_rls.sql:240-259) does not false-positive on `memberKeyIds` values (they are UUIDs, same class as the existing strategy ids already in the payload — low risk), and add the positive round-trip assertion.

## Sources

### Primary (HIGH confidence — direct source reads at HEAD e5e83247)
- `src/app/(dashboard)/allocations/lib/scenario-state.ts` — codec, schema, version constants, transforms, legacy helpers (full read)
- `src/app/(dashboard)/allocations/lib/scenario-compare.ts` — `computeMetricsForDraft`, `buildLiveBookDraft`, `usePerKeySources` selector (full read)
- `src/app/scenario-share/[token]/share-resolve.ts` — pure resolve layer, book-only branch (full read)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `openSavedScenario`, save handlers, engine-set selection, ProvenanceNote wiring, entryMode (targeted reads :685-2848)
- `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx` — live-inputs assembly, buildLiveBookDraft call site, decodeDraft (targeted read)
- `src/app/(dashboard)/allocations/components/ProvenanceNote.tsx` — ephemeral note contract (full read)
- `src/app/api/allocator/scenario/share/route.ts` — mint gate + CR-01 ownership (full read)
- `src/app/api/allocator/scenario/saved/route.ts` — save validation reuses `scenarioDraftSchema` (full read)
- `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` — defaultDraft/codec wiring (targeted read)
- `src/app/(dashboard)/allocations/lib/scenario-state.test.ts`, `share-resolve.test.ts`, `share/route.test.ts`, `scenario-state.localStorage.test.ts`, `useScenarioState.hydrate.test.tsx` — fixture enumeration (targeted grep + read)
- `supabase/tests/test_scenario_shares_rls.sql` — window round-trip assertion pattern (targeted grep)
- `.planning/phases/62-.../62-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/v1.6-SERIES-SPACE-INPUT.md` — locked decisions + requirements

### Secondary / Tertiary
- None. This phase required no external documentation — it is entirely in-repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external deps; zod v4 reuse confirmed in-source.
- Architecture (codec + consumers): HIGH — every seam located and quoted; the double-branch requirement verified against the current single-branch codec.
- Pitfalls: HIGH — the v2-drop and fixture-rebase risks are verified against the actual test fixtures.
- Open Questions (share-resolve derivation, stamping seam, zod required/optional): MEDIUM — these are genuine design decisions for the plan, not knowledge gaps.

**Research date:** 2026-07-03
**Valid until:** ~2026-08-02 (stable in-repo surface; only invalidated by an intervening edit to scenario-state.ts / scenario-compare.ts / share-resolve.ts before planning).
