# Phase 59: Saved / Shared / Compared Windows - Research

**Researched:** 2026-07-02
**Domain:** Scenario-draft persistence + versioning; SECURITY DEFINER read-RPC pass-through; heterogeneous-window compare UI; non-destructive schema upgrade
**Confidence:** HIGH (all four load-bearing assumptions verified against code with file:line; no external-library uncertainty)

## Summary

Phase 59 makes the v1.5 coverage window durable across the three exit paths of the composer (save, share, compare). The design locked in `59-CONTEXT.md` — store the window INSIDE the `ScenarioDraft` JSONB as `window?: CoverageWindow`, bump the draft schema 2→3 as a non-destructive code-level upgrade, and thread `draft.window` into `state.window` at exactly three compute sites — is **fully supported by the current code**. I verified every load-bearing assumption directly:

1. `get_shared_scenario` returns `v_scenario.draft` **whole** (the raw JSONB column, not a re-projection) — a `window` field inside the draft rides to the recipient automatically. **NO RPC change, NO SQL migration, NO `npm run schema:functions`.** [VERIFIED: file:line below]
2. The save route persists `parsed.data.draft` **whole** — adding `window?` to the draft auto-saves it. **NO route change beyond the codec accepting the field.** [VERIFIED]
3. Adding an OPTIONAL `window?` to `scenarioDraftSchema` keeps v2 drafts decoding — BUT the bump 2→3 **collides with the existing reset-on-mismatch trichotomy**: today ANY draft whose `schema_version !== SCENARIO_SCHEMA_VERSION` and is not *ahead* takes the `reset` path (`scenario-state.ts:647-653`). Naively bumping to 3 would make **every existing v2 saved scenario `reset` → dropped**. This is the single highest-risk correctness point of the phase; the executor MUST add an explicit v2→v3 non-destructive branch to the codec. [VERIFIED — see Pitfall 1]
4. The three `computeScenario`/`computeMetricsForDraft` sites that must thread `state.window` are identified with the canonical injection idiom already proven in the composer (`ScenarioComposer.tsx:1830-1835`). [VERIFIED]

**Primary recommendation:** Add `window?: CoverageWindow` to `ScenarioDraft` + `scenarioDraftSchema` (optional, additive like `userWeightOverrides?`); bump `SCENARIO_SCHEMA_VERSION` to 3 **and simultaneously add an explicit `rawVersion === 2` non-destructive upgrade branch** to `scenarioDraftCodec.decode` that returns `outcome: "ok"` with a transient provenance marker (NOT the `reset` path). Thread `draft.window ?? undefined` into `state.window` at the three sites. Extend the SQL leak-scan test additively. No SQL migration, no RPC change, no new dependency.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Persist window in saved scenario (PERSIST-01) | Database / Storage (`scenarios.draft` JSONB) | API (save route) | Window is a field inside the already-stored `draft` JSONB; the DB stores it verbatim, the route just passes it through |
| Draft schema versioning + non-destructive 2→3 upgrade | Frontend (codec, `scenario-state.ts`) | — | The "migration" is a pure-TS codec upgrade, not a SQL DDL migration; runs on every decode |
| Reopen recompute at saved window (PERSIST-01) | Frontend (`useScenarioState` hydrate → composer memo) | — | Recompute is client-side `computeScenario`; window is applied into `state.window` on hydrate |
| Shared-link window pass-through (PERSIST-02) | Database (SECDEF RPC returns `draft` whole) | Frontend (`share-resolve.ts` threads it) | The window rides in the returned `draft` JSONB with zero RPC change; recipient recompute is client/SSR-side |
| Leak safety of the shared window (PERSIST-02) | Database (RLS + SECDEF RPC + leak-scan test) | — | Security-critical; the RPC's explicit 4-column list + leak-scan SQL are the enforcement points |
| Compare per-scenario window (PERSIST-03) | Frontend (`scenario-compare.ts` + panel + table) | — | Each column computes at its own `draft.window`; live-book column stays windowless (Phase-55 lock) |
| Per-column window label (Contract 2) | Browser / Client (`ScenarioCompareTable` `<tfoot>`) | — | Pure presentation of engine-emitted `effective_start`/`effective_end` |

## Standard Stack

**No new runtime dependency.** This phase is 100% first-party TypeScript + one additive SQL-test assertion. All the machinery already exists in-repo:

### Core (existing, reused)
| Module | Path | Purpose | Why it is the tool |
|--------|------|---------|--------------------|
| `scenario-state.ts` | `src/app/(dashboard)/allocations/lib/scenario-state.ts` | `ScenarioDraft` type + `SCENARIO_SCHEMA_VERSION` + `scenarioDraftSchema` (zod) + `scenarioDraftCodec` | The single source of truth for the persisted draft shape + version trichotomy |
| `scenario-window.ts` | `src/lib/scenario-window.ts` | `CoverageWindow`, `coverageSpanOf`, `intersectionOf`, `unionOf`, `defaultWindowFor`, `covers` | FROZEN. Reused to derive the intersection default for a windowless v2 draft |
| `scenario.ts` | `src/lib/scenario.ts` | `computeScenario` + `ScenarioState.window?: { start; end }` (already exists, line 126) + additive `member_count`/`effective_start`/`effective_end` | FROZEN engine. `state.window` is the one input we set; it already gates membership |
| `scenario-compare.ts` | `src/app/(dashboard)/allocations/lib/scenario-compare.ts` | `computeMetricsForDraft`, `buildLiveBookDraft` | Compare compute path; currently passes NO window (`:29-31`, `:139-143`) |
| `share-resolve.ts` | `src/app/scenario-share/[token]/share-resolve.ts` | `resolveSharedScenario` (codec trichotomy + `computeScenario` at `:185`) | Recipient recompute path; currently passes NO window |
| `useScenarioState.ts` | `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` | `hydrateFromSaved(:273)` reopen seam | Sets the working draft on reopen; window flows from `draft.window` |
| `DefaultChangeNote.tsx` | `src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx` | Inline `role="status"` info-note shell | Pattern source for the provenance note (Contract 1) |
| `BlendHeader.tsx` | `.../components/BlendHeader.tsx` | `font-mono tabular-nums` date treatment | Typography source for the per-column window label (Contract 2) |
| `ScenarioCompareTable.tsx` | `.../components/ScenarioCompareTable.tsx` | `<tfoot>` "Window" row (`:242-282`) stamping `methodologyLine(n)` | Host for Contract 2's `{start}–{end}` label |
| `ScenarioComparePanel.tsx` | `.../components/ScenarioComparePanel.tsx` | Decodes each row (trichotomy) → `computeMetricsForDraft` (`:200-221`) | Threads each `draft.window` into compute; feeds effective bounds to the table |

### Type shapes to reuse (do NOT re-author)
- `CoverageWindow` is already exported from `scenario-window.ts:42` as `{ start: string; end: string }`. `ScenarioState.window?` (`scenario.ts:126`) is the identical `{ start: string; end: string }` shape. Use `CoverageWindow` for the new `ScenarioDraft.window?` field so all three are the same type.

**Installation:** none. `REQUIREMENTS.md` "zero new runtime dependencies" holds. `59-UI-SPEC.md` confirms no new component library, no shadcn init.

## Package Legitimacy Audit

Not applicable — this phase installs **zero external packages**. All code is first-party TypeScript + SQL already in the repo. slopcheck / registry verification is vacuously satisfied (no `npm install`, no `pip install`, no `cargo add`).

## Architecture Patterns

### System Architecture Diagram (data flow of the window through the three exit paths)

```
                          ┌──────────────────────────────────────┐
                          │  Composer (ScenarioComposer.tsx)      │
                          │  coverageWindow (Phase 57 state) ─────┼──► draft.window on save
                          └──────────────┬───────────────────────┘
                                         │ draft (JSONB, now with window?)
                                         ▼
   SAVE (PERSIST-01)      POST /api/allocator/scenario/saved  ── inserts draft WHOLE ──► scenarios.draft (JSONB)
                                                                                              │
   REOPEN (PERSIST-01)    scenarios.draft ──► codec.decode (v3 ok │ v2 → non-destructive upgrade + provenance)
                                         │                                    │
                                         ▼                                    ▼
                          useScenarioState.hydrateFromSaved(draft)   defaultWindowFor(spans) if windowless
                                         │                                    │
                                         ▼                                    │
                          composer memo: engineState = {...state, window: draft.window ?? default}
                                         │                                    │
                                         ▼ ◄──────────────────────────────────┘
                                   computeScenario  ──► TODAY's numbers at the saved window

   SHARE (PERSIST-02)     get_shared_scenario(token_hash)  ── returns v_scenario.draft WHOLE (SECDEF, leak-scoped) ──┐
                                                                                                                     ▼
                          share-resolve.resolveSharedScenario ── codec trichotomy (only "ok" renders) ──► state.window = draft.window
                                                                                                                     │
                                                                                                                     ▼
                                                                                              computeScenario (recipient == owner)

   COMPARE (PERSIST-03)   selectedRows[].draft ──► decode each ──► computeMetricsForDraft(draft, liveInputs) with state.window = draft.window
                          liveBook draft ─────────► computeMetricsForDraft (NO window — Phase-55 lock, union path)
                                         │
                                         ▼
                          ScenarioCompareTable <tfoot> "Window" row: per-column methodologyLine(n) + NEW {start}–{end}
```

File-to-implementation mapping lives in the Standard Stack table above; the diagram shows data flow only.

### Pattern 1: Window injection POST-collapse onto the engine state (the canonical idiom)
**What:** The window is set on the `ScenarioState` object handed to `computeScenario`, NEVER on the pre-collapse `projectionState` (dealias reconstructs state and silently drops `window`).
**When to use:** All three threading sites.
**Example (the composer's proven idiom — copy this shape):**
```typescript
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1821-1835 [VERIFIED]
// ⚠️ HAZARD FIX (Phase 57 RESEARCH Pitfall 1): collapseAliasedHoldingStrategies
// reconstructs the ScenarioState and SILENTLY DROPS `state.window`. Inject the
// window onto deAliased.state POST-collapse, never on projectionState pre-collapse.
const engineState = useMemo(
  () =>
    coverageWindow
      ? { ...deAliased.state, window: coverageWindow }
      : deAliased.state,          // absent window → legacy UNION path (byte-compat, own-book lock)
  [deAliased, coverageWindow],
);
```
For `share-resolve.ts` and `scenario-compare.ts`, the equivalent post-collapse state object is where `window: draft.window` must be spread — `scenario-compare.ts` currently builds `projectionState` (`:139-143`) then runs `collapseAliasedHoldingStrategies` (`:145-149`) and calls `computeScenario(deAliased.strategies, deAliased.state, ...)` (`:155`), so the window must be injected onto `deAliased.state`, not `projectionState`.

### Pattern 2: Absent window → union path (byte-compat lock)
**What:** `computeScenario` runs the legacy UNION path when `state.window` is `undefined` (`scenario.ts:119-124,254`). A windowless v2 draft, after the non-destructive upgrade, gets `defaultWindowFor(spans)` (intersection) applied — it does NOT stay union. But the **live-book compare column** and all own-book callers pass NO window and stay union (Phase-55 lock).
**When to use:** Live-book compare column (`buildLiveBookDraft`) — never inject a window.

### Pattern 3: Codec trichotomy is the ONLY decode path (M-0153)
**What:** Every persisted draft is decoded through `scenarioDraftCodec.decode` returning `{ value, outcome, reason }` where `outcome ∈ {ok, readonly, reset}`. Never bare-cast (`row.draft as ScenarioDraft`). Only `ok` renders in share-resolve (DI-23-01) and computes in compare.
**When to use:** Everywhere a persisted draft is read. The 2→3 upgrade MUST be a new branch that returns `outcome: "ok"` (see Pitfall 1).

### Anti-Patterns to Avoid
- **Reusing the `version_mismatch → reset` path for 2→3.** This deletes users' saved scenarios. The v1→v2 bump was deliberately destructive (v1 drafts were unreachable under the new UI); v2→v3 must be non-destructive (a v2 draft is fully valid, just windowless). See Pitfall 1.
- **Injecting window onto `projectionState` (pre-collapse).** Dealias drops it. Always post-collapse.
- **Passing a window to the live-book compare column.** Breaks the Phase-55 own-book union lock.
- **Re-deriving a fresh intersection on the recipient side.** Published series could differ from the owner's snapshot → divergent membership. Recipient reads `draft.window` VERBATIM.
- **Persisting the provenance marker into the draft.** It is a transient decode-result flag, per-open, never written back.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deriving the intersection default for a windowless draft | Custom min-start/max-end interval math | `defaultWindowFor(spans)` (`scenario-window.ts:116`) | FROZEN helper; identical derivation everywhere = the "one shared helper" invariant PERSIST-02 requires |
| Threading the window into the engine | A parallel windowed-compute function | Set `state.window` on the existing `computeScenario` call | Engine already has the present-window path (`scenario.ts:246+`); no new algorithm |
| Version-mismatch handling | A new decoder for v3 | Add a branch to `scenarioDraftCodec.decode` | The codec is the single decode authority (M-0153); a second decoder would drift |
| The provenance note UI | A new component from scratch | Reuse `DefaultChangeNote`'s shell (new copy + ephemeral dismissal) | `59-UI-SPEC.md` Contract 1 locks this; identical tokens/a11y |
| Per-column date-range label | Custom date formatting | Reuse `BlendHeader`'s `font-mono tabular-nums` + en-dash convention | Contract 2 locks this; reads `effective_start`/`effective_end` from the engine, never re-derives |
| Shared-window pass-through | A new RPC / migration to project the window | Nothing — `get_shared_scenario` returns `draft` whole | Assumption 1 verified: the field rides along for free |

**Key insight:** The entire phase is *threading an existing optional field through paths that already decode and recompute drafts.* The only genuinely new logic is (a) the non-destructive v2→v3 codec branch and (b) two small UI reuses. Everything else is a one-line `window: draft.window` spread at three sites.

## Runtime State Inventory

> This is a schema-version bump, which is migration-adjacent — but the "migration" is code-level, not data-level. I checked all five categories.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `scenarios.draft` JSONB rows saved as `schema_version = 2` (existing users' saved scenarios). The `scenarios` table stores `draft` JSONB + `schema_version INT` (mig 20260621120000). Bumping `SCENARIO_SCHEMA_VERSION` to 3 in code makes every stored v2 row a "mismatched" version on decode. | **Code edit only — NO data migration.** The non-destructive codec branch upgrades v2 rows on read (window defaults to intersection). Do NOT `UPDATE scenarios SET schema_version = 3` — the design is read-time upgrade, and a bulk data write would need a real SQL migration + risk. The row's stored `schema_version` stays 2 until the user next saves (which re-serializes at 3). |
| Live service config | None. No external service (n8n, Datadog, etc.) references the scenario schema version. Shares are resolved through the in-repo SECDEF RPC only. | None — verified: the only consumers of `draft` are the save route, `useScenarioState`, `share-resolve`, and `scenario-compare`, all in-repo. |
| OS-registered state | None — verified. No cron, no scheduler, no OS-registered task touches scenario drafts. | None. |
| Secrets / env vars | None — verified. The window is two ISO date strings; no secret, no env var, no key name references it. | None. |
| Build artifacts / installed packages | The SQL-function snapshot (`supabase/schema/functions/get_shared_scenario.sql`) — a tracked build artifact regenerated by `npm run schema:functions`. | **None for this phase** — the RPC body does NOT change (Assumption 1), so the snapshot stays byte-identical and `schema:functions:check` passes without regeneration. If (and only if) a future decision forces an RPC change, regenerate. The leak-scan test lives in `supabase/tests/`, a *different* file that does not feed the snapshot. |

**Critical distinction:** existing v2 rows carry `schema_version = 2` in the DB column and `schema_version: 2` inside the JSONB. On reopen the codec sees `2 !== 3` → today's trichotomy resets it. The non-destructive branch must key on `rawVersion === 2` (the exact prior version), upgrade in-memory, and let the next save re-persist at 3. No `ALTER TABLE`, no backfill.

## Common Pitfalls

### Pitfall 1: The 2→3 bump silently drops every saved scenario (HIGHEST RISK)
**What goes wrong:** Bumping `SCENARIO_SCHEMA_VERSION` from 2 to 3 without adding a v2→v3 branch makes the codec's existing "missing / lower / non-integer version → reset" path (`scenario-state.ts:647-653`) fire for every stored v2 draft. `reset` returns the neutral default draft (a fresh live book) — **the user's saved scenario is gone.** In share-resolve, `reset` → `honest-absence` (a 404-shaped blank). In compare, `reset` → the "Saved in an older format" stamp + NULL_METRICS. All three paths would treat every pre-v1.5 saved scenario as garbage.
**Why it happens:** The v1→v2 bump was *deliberately* reset-on-mismatch (v1 drafts were genuinely unreachable under the read-only-tokens UI — `scenario-state.ts:48-56`). The codec has exactly three branches: `> current → readonly` (`:623`), `=== current → ok` (`:635`), everything-else `→ reset` (`:653`). A v2 draft under `current = 3` falls into the `reset` bucket.
**How to avoid:** Add an explicit `rawVersion === 2` (i.e., `=== SCENARIO_SCHEMA_VERSION - 1`, or a named `SCENARIO_SCHEMA_VERSION_PREV = 2`) branch BEFORE the final reset return. In that branch: `safeParse` the draft (a v2 draft validates against the additive-optional new schema because `window?` is optional), and on success return `{ value: upgradedDraft, outcome: "ok", reason: null }` — where `upgradedDraft` has `schema_version` bumped to 3 and `window` left `undefined` (the composer/consumers default it via `defaultWindowFor`). Carry the transient provenance marker (see Pitfall 3). On `safeParse` failure, fall through to `reset` (a genuinely-corrupt v2 blob is still garbage).
**Warning signs:** `useScenarioState.hydrate.test.tsx` (which pins `hydrateFromSaved(mismatchedSavedDraft())` behavior) and `share-resolve.test.ts:85-96` (which pins "version-ahead → honest-absence") will surface breakage. **Add a RED test first:** a v2 draft (no window) must decode `ok` after the bump, not `reset`.

### Pitfall 2: Bumping to 3 changes what counts as "ahead" — a v3 draft that used to be `readonly` is now `ok`
**What goes wrong:** `share-resolve.test.ts:85` asserts a draft with `schema_version > current` → `honest-absence`. Once `current = 3`, a `schema_version = 3` draft that a test previously treated as "ahead" now decodes `ok`. Any test fixture using a hard-coded future version must be re-based to `current + 1` (i.e., 4) to keep testing the readonly path.
**Why it happens:** The trichotomy is relative to `SCENARIO_SCHEMA_VERSION`. Bumping the constant shifts every relative comparison.
**How to avoid:** Grep test fixtures for hard-coded `schema_version: 3` (or `SCENARIO_SCHEMA_VERSION + 1` written literally as `3`) and confirm intent. The `buildLiveBookDraft()` helper hard-codes `schema_version: 2` (`scenario-compare.ts:172`) — it is a synthetic in-memory draft that never persists and is not decoded, so it is harmless, but consider bumping it to 3 (or to `SCENARIO_SCHEMA_VERSION`) for consistency and to avoid confusion; verify no test asserts the literal 2.
**Warning signs:** `share-resolve.test.ts`, `scenario-compare.test.ts`, `ScenarioComparePanel.test.tsx` red on version assertions.

### Pitfall 3: The provenance marker must be transient, not persisted
**What goes wrong:** Persisting a "was-upgraded" flag into the draft JSONB pollutes the stored shape and would re-trigger on every open even after the user re-saves at v3.
**Why it happens:** The natural instinct is to add a boolean to `ScenarioDraft`.
**How to avoid:** Carry the marker on the **decode result**, not the value. Cleanest shape (Claude's-discretion per CONTEXT): extend the codec's `DecodeResult` reason or add a sibling field the hydrate seam reads — e.g., return `{ value, outcome: "ok", reason: "upgraded_v2_windowless" }` and have `useScenarioState.hydrateFromSaved` / `share-resolve` inspect `reason` to set a component-local `useState` provenance flag. The `DefaultChangeNote`-style note (Contract 1) then renders from that ephemeral flag, dismissible per-open, NOT via the `useCrossTabStorage` global that POLISH-03 uses. **Do NOT reuse `composer.coverageDefaultChangeNoteDismissed`** — that is the POLISH-03 education artifact; this is a per-scenario data-provenance signal that must recur for each old draft (`59-UI-SPEC.md` Interaction contract, KEY divergence).
**Warning signs:** A fresh v3 draft showing the provenance note; the note not re-appearing when a second old draft is opened.

### Pitfall 4: Injecting the window pre-collapse (dealias drops it)
**What goes wrong:** Setting `window` on `projectionState` before `collapseAliasedHoldingStrategies` — the collapse reconstructs `ScenarioState` and silently drops `window`, so the engine never sees it and silently runs the union path.
**Why it happens:** It looks orthogonal; the composer's comment (`ScenarioComposer.tsx:1821-1827`) is the documented scar from Phase 57.
**How to avoid:** Inject onto the POST-collapse state (`deAliased.state`) at all three sites, matching the composer idiom.
**Warning signs:** Windowed numbers equal to union numbers; `member_count` == full selected count when it should be smaller.

### Pitfall 5: Recipient re-deriving a fresh window instead of reading the owner's
**What goes wrong:** If `share-resolve` computes `defaultWindowFor` from the recipient-visible published series rather than reading `draft.window`, the recipient's intersection can differ from the owner's (published series may have changed since save) → recipient view ≠ owner view, violating PERSIST-02.
**Why it happens:** The composer derives the window from spans; copying that logic to the recipient is tempting.
**How to avoid:** Recipient reads `draft.window` VERBATIM into `state.window`. Only when the draft is v2/windowless does the recipient default to intersection (same rule as owner reopen). The "one shared helper" invariant is satisfied because the persisted value was derived once via `scenario-window.ts` at save time.

### Pitfall 6: The `<tfoot>` label must augment, not replace, the day-count stamp
**What goes wrong:** Replacing `methodologyLine(n)` with the date range loses the trading-day count; duplicating it (a second row) breaks the table structure.
**How to avoid:** Append `· {start}–{end}` to the existing `verdict.ok` branch (`ScenarioCompareTable.tsx:266-269`) only. The `undecodable` (`:259`) and below-sample-floor (`:270`) branches suppress the date label (no honest window to show). Read `effective_start`/`effective_end` from `c.metrics` — never re-derive.

## Code Examples

### Adding the optional field to the schema (additive, like `userWeightOverrides?`)
```typescript
// Source pattern: scenario-state.ts:582 (userWeightOverrides is the proven additive-optional precedent) [VERIFIED]
// In the ScenarioDraft interface (scenario-state.ts:75-96):
export interface ScenarioDraft {
  // ...existing fields...
  userWeightOverrides?: Record<string, number>;
  /** v1.5 PERSIST-01 — the saved coverage window. Optional + additive: a v2
   *  (pre-v1.5) draft omits it and defaults to intersection on open. */
  window?: CoverageWindow;              // import type { CoverageWindow } from "@/lib/scenario-window"
  lastEditedAt: string;
}

// In scenarioDraftSchema (scenario-state.ts:574-585), mirror the shape:
export const scenarioDraftSchema = z.object({
  // ...existing...
  userWeightOverrides: boundedRecord(z.number(), "userWeightOverrides").optional(),
  window: z.object({ start: z.string().max(32), end: z.string().max(32) }).optional(),
  lastEditedAt: z.string().max(64),
});
```

### The non-destructive v2→v3 codec branch (the load-bearing correctness fix)
```typescript
// Insert in scenarioDraftCodec.decode, BEFORE the final `reset` return (scenario-state.ts:653).
// This is the ONLY genuinely-new decode logic in the phase.
// SCENARIO_SCHEMA_VERSION is now 3.
if (rawVersion === SCENARIO_SCHEMA_VERSION - 1) {         // a v2 (pre-v1.5, windowless) draft
  const safe = scenarioDraftSchema.safeParse(parsed);     // window? optional → a v2 blob validates
  if (safe.success) {
    return {
      value: {
        ...(safe.data as unknown as ScenarioDraft),
        schema_version: SCENARIO_SCHEMA_VERSION,           // upgrade in memory; next save persists at 3
        // window intentionally left undefined → consumers default via defaultWindowFor()
      },
      outcome: "ok",                                       // ✅ NOT reset — the draft is fully valid
      reason: "upgraded_v2_windowless",                    // transient provenance marker (Pitfall 3)
    };
  }
  return { value: defaultDraft, outcome: "reset", reason: "schema_invalid" };  // genuinely-corrupt v2 → reset
}
// ...falls through to the existing reset return for < 2 / non-integer / garbage versions.
```
Note: `DecodeResult.reason` is a string on the existing type (`:609,630,644,653` all set string reasons), so `"upgraded_v2_windowless"` is type-compatible; verify the `DecodeResult` reason union in `@/lib/storage/cross-tab` accepts an arbitrary string or extend it minimally.

### Threading the window at the three compute sites
```typescript
// SITE 1 — reopen (via composer): draft.window flows through useScenarioState.hydrateFromSaved
//   into the composer's coverageWindow state, then the EXISTING engineState memo
//   (ScenarioComposer.tsx:1830-1835) injects it. If draft.window is present, seed the composer's
//   window state from it on hydrate; if absent (upgraded v2), seed from defaultWindowFor(spans).

// SITE 2 — share-resolve.ts (currently NO window, :183-185):
const state: ScenarioState = {
  selected, weights, startDates,
  ...(draft.window ? { window: draft.window } : {}),      // owner's window VERBATIM (Pitfall 5)
};                                                        // v2 windowless → default via defaultWindowFor upstream
const metrics = computeScenario(strategies, state, dateMapCache);

// SITE 3 — scenario-compare.ts computeMetricsForDraft (currently NO window, injects post-collapse):
const deAliased = collapseAliasedHoldingStrategies(adapterOutput.strategies, projectionState, ...);
const engineState = draft.window
  ? { ...deAliased.state, window: draft.window }          // POST-collapse (Pitfall 4)
  : deAliased.state;                                       // live-book draft has no window → union (Phase-55 lock)
return computeScenario(deAliased.strategies, engineState, dateMapCache);
```

### The RPC returns `draft` whole (Assumption 1 — the pass-through that eliminates a migration)
```sql
-- Source: supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:195-208 [VERIFIED]
RETURN QUERY
SELECT v_scenario.name,
       v_scenario.draft,          -- ◄── the WHOLE draft JSONB column; a `window` field inside rides along
       v_scenario.schema_version,
       COALESCE( ... published series ... );
-- The RETURNS TABLE signature (:142-147) declares `draft JSONB` — no per-field re-projection.
-- addedStrategies[].id is extracted for the series join (:190-193) but the draft itself is NOT rebuilt.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Window was transient composer `useState` (Phase 57), lost on save/share/compare | Window persisted inside `ScenarioDraft` JSONB (this phase) | Phase 59 | The blend follows the scenario everywhere |
| Draft schema_version 2 (read-only-tokens model) | Version 3 (adds `window?`), non-destructive upgrade | Phase 59 | Existing saved scenarios upgrade in-memory on read, never dropped |
| Compare + share ran union-when-absent (no window) | Compare uses each draft's own window; share uses owner's window verbatim | Phase 59 | Heterogeneous, honest windows per column; recipient == owner |

**Deprecated/outdated:** none. The v1→v2 reset-on-mismatch idiom is NOT deprecated — it remains correct for genuinely-incompatible past shapes; it simply must NOT be extended to the v2→v3 transition.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Modified Next.js:** `AGENTS.md` — this is NOT stock Next.js; read `node_modules/next/dist/docs/` before any framework-API assumption. This phase touches route handlers (`saved/route.ts`) and RSC/`share-resolve` — the existing files already use `export const runtime = "nodejs"` and `NextResponse`; match them, do not introduce new Next APIs from memory. Middleware is renamed to `proxy` in this version (relevant only if PUBLIC_ROUTES need a change — they do NOT for this phase; shares already resolve).
- **Commits:** `/ship` only; never manual `git commit` (user directive).
- **Coverage ratchet is a BLOCKING CI gate** (CLAUDE.md): lines 82 / statements 80 / functions 74 / branches 72, enforced by the `frontend-coverage` job. New code (codec branch, 3 threading edits, 2 UI reuses) MUST carry tests or coverage can regress the gate. Run `npm run test:coverage` before shipping.
- **DESIGN.md** governs all visual decisions — `59-UI-SPEC.md` already resolved both new contracts to inherited tokens; do not deviate.
- **Migration/RLS reviewers apply ONLY IF SQL changes.** Verified: no SQL migration and no RPC change are required. The leak-scan test extension is a `supabase/tests/*.sql` addition (not a migration, not a `schema/functions/` snapshot) — timestamp-naming and backdated-migration guards do NOT apply to it, but the SQL-test discovery gate (`ci.yml:770`) auto-picks it up. If a decision unexpectedly forces an RPC change, then: timestamp naming `YYYYMMDD120000_*.sql`, SECDEF hardening, backdated-migration guard, and `npm run schema:functions` all apply.
- **Rules 6 (root-cause), 7 (surface conflicts), 9 (tests verify intent):** the non-destructive-upgrade branch is a root-cause fix (not a per-consumer guard); the RED test for "v2 decodes ok, not reset" encodes WHY (no data loss), not just WHAT.

## Assumptions Log

> All four load-bearing assumptions from the phase brief were VERIFIED against code. The remaining `[ASSUMED]` items are minor and low-risk.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `DecodeResult.reason` accepts an arbitrary string (so `"upgraded_v2_windowless"` type-checks) | Code Examples / Pitfall 3 | LOW — if it is a closed union, extend it by one member; a 1-line change |
| A2 | A v2 draft's JSONB validates against the new schema (window optional) with no other shape drift | Pitfall 1 | LOW — verified the v2 shape (`ScenarioDraft` fields) is a strict subset of the new schema; only `window?` is added, and it is optional |
| A3 | `buildLiveBookDraft()`'s hard-coded `schema_version: 2` is harmless (never decoded/persisted) | Pitfall 2 | LOW — it is a synthetic in-memory draft fed straight to `computeMetricsForDraft`; confirmed no decode path touches it |
| A4 | The composer's `coverageWindow` state can be seeded from `draft.window` on hydrate without a new prop drilling problem | Threading Site 1 | MEDIUM — the exact seam (how `useScenarioState` surfaces `draft.window` to the composer's window state, which is Phase-57 local state) needs the planner to trace the composer's window-state ownership; see Open Question 1 |

**VERIFIED (not assumed):**
- get_shared_scenario returns `draft` whole — `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:142-147,195-208`.
- Save route persists `draft` whole — `src/app/api/allocator/scenario/saved/route.ts:132-141`.
- Codec reset-on-mismatch collision — `src/app/(dashboard)/allocations/lib/scenario-state.ts:623-653`.
- `ScenarioState.window?` already exists — `src/lib/scenario.ts:126`; `CoverageWindow` exported — `src/lib/scenario-window.ts:42`.
- Three threading sites — composer `:1830-1835`, share-resolve `:183-185`, compare `:139-155`.
- Compare `<tfoot>` "Window" row — `ScenarioCompareTable.tsx:242-282`.
- No RPC change → no `schema:functions` regeneration; snapshot lives at `supabase/schema/functions/get_shared_scenario.sql`, leak-scan lives separately at `supabase/tests/test_scenario_shares_rls.sql`.

## Open Questions

1. **How does `draft.window` reach the composer's coverage-window state on reopen?**
   - What we know: `useScenarioState.hydrateFromSaved(:273)` sets the working draft. The composer's window is Phase-57 local state (`winStart`/`winEnd` → `coverageWindow` memo, `ScenarioComposer.tsx:1781`).
   - What's unclear: the exact wiring by which a hydrated `draft.window` seeds `winStart`/`winEnd` (does the composer read `draft.window` in an effect on hydrate, or does `hydrateFromSaved` need to surface it?). The composer file is ~3000 lines; the planner should trace the window-state ownership and hydrate effect.
   - Recommendation: add a task step to locate the composer's hydrate/reopen effect and seed `applyWindow({start, end})` (`:1802`) from `draft.window` (or `defaultWindowFor(selectedSpans)` + provenance flag when absent). This is Threading Site 1 and the trickiest wiring; the other two sites (share-resolve, compare) are self-contained one-liners.

2. **Where does the effective-window date range come from for the per-column label when a column's window is the union (live-book) vs. a saved window?**
   - What we know: `computeScenario` emits `effective_start`/`effective_end` on both paths (`scenario.ts:154-155,181`). `59-UI-SPEC.md` Contract 2 says read them from `computeMetricsForDraft` output only.
   - What's unclear: nothing blocking — both paths emit the fields. The live-book column shows its union-derived effective window, consistent with other columns.
   - Recommendation: read `c.metrics.effective_start`/`c.metrics.effective_end` in the `verdict.ok` `<tfoot>` branch; suppress the label on `undecodable`/below-floor columns.

## Environment Availability

Not applicable — this phase is code + one SQL-test assertion, no new external dependency. Existing test tooling (vitest, the SQL-test CI job) is already present:
- `vitest` — configured (`vitest.config.ts`), jsdom env, coverage gated. Available.
- SQL test runner — CI discovers `supabase/tests/test_*.sql` (`ci.yml:770`). Available.
- `npm run schema:functions` — present (`scripts/dump-sql-functions.ts`), but NOT invoked this phase (no RPC change).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (jsdom), `@vitest/coverage-v8` |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / statements 80 / functions 74 / branches 72 — BLOCKING) |
| Quick run command | `npx vitest run <file>` (single file, e.g. the codec or share-resolve test) |
| Full suite command | `npm run test:coverage` (full suite + coverage; must be green + above thresholds before `/ship`) |
| SQL test | discovered + run by CI from `supabase/tests/test_*.sql` (`ci.yml:770`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PERSIST-01 | v2 (windowless) draft decodes `ok` (NOT reset) after 2→3 bump; window defaults to intersection; provenance marker set | unit (codec) | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-state.test.ts` | ⚠️ existing file — ADD the RED v2-non-destructive case (Wave 0) |
| PERSIST-01 | v3 draft with `window` round-trips through save (whole draft persisted) | route test | `npx vitest run src/app/api/allocator/scenario/saved/route.test.ts` | ✅ exists — extend to assert `window` in the inserted draft |
| PERSIST-01 | reopen applies `draft.window` into state → recompute at saved window; v2 defaults + provenance | unit (hydrate) | `npx vitest run src/app/(dashboard)/allocations/hooks/useScenarioState.hydrate.test.tsx` | ✅ exists — extend for window + provenance reason |
| PERSIST-02 | recipient reads owner's `draft.window` verbatim; `ok` draft with window → non-null metrics at that window; v2 → intersection | unit | `npx vitest run src/app/scenario-share/[token]/share-resolve.test.ts` | ✅ exists — extend + re-base the version-ahead fixture to 4 (Pitfall 2) |
| PERSIST-02 **(security-critical)** | window round-trips through the RPC AND no api_key/value_usd/holdings leak | SQL leak-scan | CI: `supabase/tests/test_scenario_shares_rls.sql` | ✅ exists — ADD an assertion that a windowed draft's `draft.window` survives AND the existing `api_key\|allocated_amount\|account_balance\|value_usd` guard (`:236-239`) still holds |
| PERSIST-03 | each compare column computes at its own `draft.window`; live-book column stays windowless | unit | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-compare.test.ts` | ✅ exists — extend for heterogeneous windows + live-book union |
| PERSIST-03 | per-column `{start}–{end}` label renders on `verdict.ok` columns; suppressed on undecodable/below-floor | component | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioCompareTable.test.ts` | ✅ exists — extend for the new label |
| PERSIST-01 (UI) | provenance note shows only for upgraded-v2, ephemeral dismissal, re-shows for another old draft | component | `npx vitest run .../DefaultChangeNote.test.tsx` (or new `ProvenanceNote.test.tsx`) | ✅/⚠️ — depends on reuse-vs-wrapper decision (Claude's discretion) |

### Security-Critical Observables (PERSIST-02 no-leak)
- **The SQL leak-scan (`test_scenario_shares_rls.sql`) is the enforcement point.** Its Assertion 1 CONTENT-by-field guard (`:236-239`) already fails if the payload contains `api_key|allocated_amount|account_balance|value_usd`. Because the window is added INSIDE the existing `draft` JSONB (which is already in `payload_text`), this guard already covers it — the new window field cannot introduce a forbidden token. **Extend, do not weaken:** add a positive assertion that a seeded windowed draft's `draft->'window'->>'start'`/`'end'` survives the RPC round-trip, and keep the existing negative guard intact. Assertion 2 (empty addedStrategies → series `[]`, no holdings leak, `:249-252`) and the cross-tenant assertions (4/8/9) must all stay green.
- **Recipient == owner (deterministic):** a unit test in `share-resolve.test.ts` asserting the recipient's `effective_start`/`effective_end` equal the owner's saved `draft.window` (verbatim, no re-derivation) is the observable that proves the "one shared helper" invariant.

### Sampling Rate
- **Per task commit:** the focused `npx vitest run <changed-file-test>` for that task's seam.
- **Per wave merge:** `npm run test:coverage` (full suite + coverage gate) + the SQL leak-scan (CI).
- **Phase gate:** full suite green + coverage above thresholds + the Phase-55 frozen-spine + BLEND-07 + PARITY-01 guards green (they anchor Phase 60's re-bake) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `scenario-state.test.ts` — ADD the RED case: a v2 windowless draft decodes `outcome: "ok"` (NOT `reset`), `window` undefined, `reason === "upgraded_v2_windowless"`. This is the load-bearing correctness test; write it first.
- [ ] Re-base any hard-coded future-version fixture from `3` to `4` in `share-resolve.test.ts` / codec tests (Pitfall 2) so the `readonly`/`honest-absence` path is still exercised.
- [ ] Extend `test_scenario_shares_rls.sql` with the window round-trip + no-leak assertion (seed one scenario whose draft carries a `window`).
- [ ] Decide provenance-note test home (reuse `DefaultChangeNote` with a new prop, or a `ProvenanceNote` wrapper — Claude's discretion) and add the ephemeral-dismissal-recurs test.
- Framework install: none — vitest + SQL-test CI already present.

## Security Domain

`security_enforcement` is enabled (no `false` in config). This phase has a real, narrow security surface (the shared-link path, PERSIST-02).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface; save route already gated by `withAllocatorAuth`; share is anon-by-token by design |
| V3 Session Management | no | Unchanged |
| V4 Access Control | yes | `scenarios_owner` RLS (`allocator_id = auth.uid()`) on save/read; `get_shared_scenario` SECDEF with CR-01 owner-coherence (`:175-181`) — unchanged; window adds no new access path |
| V5 Input Validation | yes | `scenarioDraftSchema` (zod) bounds the draft; the new `window` field gets a bounded `z.object({start,end}).optional()` with `.max()` on the strings (defense-in-depth vs storage-poison, mirroring the existing `MAX_DRAFT_BODY_BYTES` + bounded records) |
| V6 Cryptography | no | Token hashing (sha256) unchanged; window is plaintext ISO dates, no crypto |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant leak via the shared window (over-return) | Information Disclosure | The window is two ISO date strings inside the already-leak-scoped `draft`; the RPC's explicit 4-column list + the leak-scan CONTENT-by-field guard already cover it. Do NOT add any join or field to the RPC. |
| Storage-poison via an oversized/nested window value | Denial of Service / Tampering | Bound the `window` object in the zod schema (`.max()` on start/end); the route's `MAX_DRAFT_BODY_BYTES` (256KB) cap already backstops the whole draft |
| Downgrade / data loss on schema bump | Tampering (integrity) | Non-destructive v2→v3 codec branch (Pitfall 1) — never `reset`; existing `stripPoisonKeys` on decode stays |
| Forged future-version draft rendering stale/wrong data | Tampering | Existing `version_ahead → readonly → honest-absence` path stays (only the threshold shifts to 3); a v4+ draft still honest-absences on share |

## Sources

### Primary (HIGH confidence — verified in-repo)
- `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:142-147,195-208` — RPC returns `draft` whole (Assumption 1).
- `src/app/api/allocator/scenario/saved/route.ts:52-60,132-141` — save persists `draft` whole (Assumption 2).
- `src/app/(dashboard)/allocations/lib/scenario-state.ts:57,75-96,565-661,693-705` — schema, codec, version trichotomy, reset-on-mismatch (Assumption 3).
- `src/lib/scenario.ts:91-126,154-193,246-260` — `ScenarioState.window?`, present/absent-window paths, additive metrics.
- `src/lib/scenario-window.ts:42,55-128` — `CoverageWindow`, `defaultWindowFor`, `intersectionOf`, `covers`.
- `src/app/scenario-share/[token]/share-resolve.ts:107-196` — recipient recompute, trichotomy, `computeScenario` at `:185` (Assumption 4, Site 2).
- `src/app/(dashboard)/allocations/lib/scenario-compare.ts:27-31,120-179` — `computeMetricsForDraft`, post-collapse state, heterogeneous-window comment (Site 3).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1781-1835` — canonical window-injection idiom + dealias hazard (Site 1).
- `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx:242-282` — `<tfoot>` "Window" row (Contract 2 host).
- `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx:194-252` — per-column decode + compute + live-book.
- `src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx:29-100` — note shell (Contract 1 pattern).
- `src/app/(dashboard)/allocations/hooks/useScenarioState.ts:264-279` — `hydrateFromSaved` reopen seam.
- `supabase/tests/test_scenario_shares_rls.sql:10-17,209-253` — leak-scan assertions (PERSIST-02 security observable).
- `scripts/dump-sql-functions.ts:16,41,260-282` + `.github/workflows/ci.yml:770` — SQL-fn snapshot + SQL-test discovery (confirms no `schema:functions` needed).
- `vitest.config.ts:21-73` — test framework + coverage gate.

### Secondary / Tertiary
- None needed — no external library or ecosystem question arose; the phase is entirely first-party.

## Metadata

**Confidence breakdown:**
- Load-bearing assumptions (RPC pass-through, save whole, codec collision, threading sites): HIGH — all verified with file:line.
- Non-destructive upgrade pattern: HIGH — the fix is a well-scoped codec branch; the risk is well-characterized (Pitfall 1).
- Threading Site 1 (composer hydrate wiring): MEDIUM — the exact seam in the ~3000-line composer needs planner tracing (Open Question 1).
- Validation architecture: HIGH — all test files exist; gaps are additive.
- Security: HIGH — no new leak surface (window is two ISO strings inside the already-scoped draft); leak-scan guard already covers it.

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (stable — first-party code, no fast-moving external dependency; only revisit if `scenario.ts`/`scenario-window.ts` or the RPC change, which this phase explicitly forbids)
