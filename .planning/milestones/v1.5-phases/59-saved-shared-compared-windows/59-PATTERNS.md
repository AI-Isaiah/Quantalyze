# Phase 59: Saved / Shared / Compared Windows - Pattern Map

**Mapped:** 2026-07-02
**Files analyzed:** 11 (6 source modifications, 1 UI-reuse, 4 test extensions — this phase is almost entirely MODIFICATION, not new files)
**Analogs found:** 11 / 11 (every change maps to an in-file or sibling analog; NO net-new pattern except the non-destructive codec branch, which is a variant of the existing trichotomy)

> **Framing for the planner:** This phase threads ONE optional field (`window?: CoverageWindow`)
> through paths that already decode + recompute drafts. Almost every "analog" is the file's OWN
> existing pattern — the change is additive, and the load-bearing risk is a single new codec branch.
> Three seams carry disproportionate risk and are called out in **Shared Patterns**:
> (1) the non-destructive v2→v3 codec branch (DATA-LOSS if wrong), (2) the ephemeral-vs-localStorage
> dismissal divergence (wrong reuse silently suppresses the note), (3) the leak-scan additive-only
> extension (weaken it and PERSIST-02 loses its enforcement point).

## File Classification

| Modified / New File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` (type + schema + codec) | model / codec | transform (decode) | its OWN existing `userWeightOverrides?` field + trichotomy branches (same file) | exact (self) |
| `src/app/scenario-share/[token]/share-resolve.ts` (thread window) | service (SSR resolver) | request-response | its OWN `const state: ScenarioState = {...}` at `:183` | exact (self) |
| `src/app/(dashboard)/allocations/lib/scenario-compare.ts` (thread window post-collapse) | service (compute) | transform / batch | its OWN post-collapse `computeScenario` call `:145-155` + composer `engineState` memo | exact (cross-file idiom) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (seed window on hydrate) | component | event-driven (hydrate) | its OWN `engineState` memo `:1830-1835` + `applyWindow` `:1802` | exact (self) |
| `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` (surface `draft.window` + provenance) | hook | event-driven (hydrate) | its OWN `hydrateFromSaved` `:273-279` | exact (self) |
| Provenance note (reuse `DefaultChangeNote` OR thin `ProvenanceNote` wrapper) | component | event-driven | `DefaultChangeNote.tsx` (whole shell) | exact (reuse) |
| `ScenarioCompareTable.tsx` `<tfoot>` "Window" row augment | component | request-response (render) | its OWN `verdict.ok` branch `:266-269` + `BlendHeader` date treatment `:64-77` | exact (self + sibling) |
| `scenario-state.test.ts` (RED v2→v3 non-destructive) | test | transform | existing trichotomy assertions in same test file | role-match |
| `share-resolve.test.ts` (re-base version-ahead 3→4 + window verbatim) | test | request-response | existing `:85` version-ahead assertion | role-match |
| `scenario-compare.test.ts` + `ScenarioComparePanel.test.tsx` + `ScenarioCompareTable.test.ts` | test | transform / render | existing per-column assertions | role-match |
| `supabase/tests/test_scenario_shares_rls.sql` (window round-trip + no-leak) | test (SQL leak-scan) | request-response | Assertion 1 CONTENT-by-field guard `:236-239` + seed pattern `:150-196` | exact (self) |

## Pattern Assignments

### `scenario-state.ts` — add `window?` field (model, additive-optional)

**Analog:** the file's OWN `userWeightOverrides?` — the proven additive-optional precedent (`M-0126`), which added an optional field WITHOUT a schema bump. `window?` differs: it DOES bump the version (the schema shape is otherwise unchanged, but the bump is what forces the non-destructive branch below).

**Interface field precedent** (`scenario-state.ts:84-95`):
```typescript
  /** H-0126 — ... Optional + additive: pre-B7 drafts (field absent)
   *  load unchanged; the zod codec marks it optional so no schema_version bump. */
  userWeightOverrides?: Record<string, number>;
  lastEditedAt: string;
```
Add `window?: CoverageWindow;` (import `type { CoverageWindow } from "@/lib/scenario-window"` — `:42`, the `{ start: string; end: string }` shape identical to `ScenarioState.window?` at `scenario.ts:126`). Do NOT re-author the type.

**Zod schema precedent** (`scenario-state.ts:582`):
```typescript
  userWeightOverrides: boundedRecord(z.number(), "userWeightOverrides").optional(),
  lastEditedAt: z.string().max(64),
```
Mirror the DoS-bound convention (every variable-length field carries `.max()`): add
`window: z.object({ start: z.string().max(32), end: z.string().max(32) }).optional(),` — the
`.max(32)` mirrors the "generous upper bound" FIX A comment at `:570-573` (defense-in-depth vs
storage-poison; `MAX_DRAFT_BODY_BYTES` backstops the whole draft).

**Version constant** (`scenario-state.ts:57`): bump `SCENARIO_SCHEMA_VERSION = 2` → `3`. Consider adding a named `SCENARIO_SCHEMA_VERSION_PREV = 2` for the branch below (research recommends this over a bare `- 1`).

---

### `scenario-state.ts` — the non-destructive v2→v3 codec branch (⚠️ HIGHEST-RISK new logic)

**Analog:** the codec's OWN three existing branches — this new branch is a FOURTH, inserted BEFORE the final `reset` return. It structurally copies the `version_ahead → readonly` branch's `safeParse`-then-return shape.

**The existing trichotomy (must NOT be reused for 2→3)** (`scenario-state.ts:623-653`):
```typescript
      // Forward-compat: newer build wrote a higher schema_version → read-only.
      if (Number.isInteger(rawVersion) && (rawVersion as number) > SCENARIO_SCHEMA_VERSION) {
        const safe = scenarioDraftSchema.safeParse(parsed);
        return {
          value: safe.success ? (safe.data as unknown as ScenarioDraft) : defaultDraft,
          outcome: "readonly",
          reason: "version_ahead",
        };
      }
      // Exact version — whole-shape validate (M-0153) and adopt.
      if (rawVersion === SCENARIO_SCHEMA_VERSION) {
        const safe = scenarioDraftSchema.safeParse(parsed);
        if (safe.success) {
          return { value: safe.data as unknown as ScenarioDraft, outcome: "ok", reason: null };
        }
        return { value: defaultDraft, outcome: "reset", reason: "schema_invalid" };
      }
      // Missing / lower / non-integer / non-numeric version → RESET.  ◄── v2 falls HERE under current=3
      return { value: defaultDraft, outcome: "reset", reason: "version_mismatch" };
```

**The new branch to insert BEFORE `:653`** (copy the `readonly` branch's `safeParse` shape, but return `ok`):
```typescript
      // v1.5 PERSIST-01 — NON-DESTRUCTIVE v2→v3 upgrade. A v2 (pre-window) draft
      // is fully valid, just windowless; window? is optional so it safeParses.
      // Return "ok" (NOT reset — reset would DELETE the user's saved scenario).
      if (rawVersion === SCENARIO_SCHEMA_VERSION - 1) {   // or SCENARIO_SCHEMA_VERSION_PREV
        const safe = scenarioDraftSchema.safeParse(parsed);
        if (safe.success) {
          return {
            value: {
              ...(safe.data as unknown as ScenarioDraft),
              schema_version: SCENARIO_SCHEMA_VERSION,     // upgrade in-memory; next save persists at 3
              // window intentionally undefined → consumers default via defaultWindowFor()
            },
            outcome: "ok",
            reason: "upgraded_v2_windowless",              // transient provenance marker (see below)
          };
        }
        return { value: defaultDraft, outcome: "reset", reason: "schema_invalid" };  // genuinely-corrupt v2
      }
```

**⚠️ Two NEW-pattern notes for the planner (both verified):**
1. `DecodeResult.reason` is typed `string | null` (`cross-tab.ts:62`, comment: *"Custom codecs may emit their own (hence the open `string`)"*). So `"upgraded_v2_windowless"` type-checks — research A1 CONFIRMED, no type extension needed.
2. **`reason` on an `ok` outcome is a NEW convention.** Every existing `ok` return uses `reason: null` (`:604,:641`). Emitting a non-null `reason` on `ok` is the intended provenance channel (research Pitfall 3) — but the primitive's Sentry breadcrumb only fires on NON-`ok` outcomes (`cross-tab.ts:418`), so the marker is inert to logging and read ONLY by `hydrateFromSaved` / `share-resolve` to set the ephemeral note flag. Verify no existing consumer asserts `ok ⇒ reason === null`.

---

### `share-resolve.ts` — thread owner's window VERBATIM (service, request-response)

**Analog:** its OWN `state` construction at `:183`.

**Current (NO window)** (`share-resolve.ts:183-185`):
```typescript
  const state: ScenarioState = { selected, weights, startDates };
  const dateMapCache = buildDateMapCache(strategies);
  const metrics = computeScenario(strategies, state, dateMapCache);
```
Change to spread the owner's window VERBATIM (Pitfall 5 — do NOT re-derive):
```typescript
  const state: ScenarioState = {
    selected, weights, startDates,
    ...(draft.window ? { window: draft.window } : {}),   // owner's saved window, read verbatim
  };
```
`draft` is `decoded.value` and ONLY reached on `outcome === "ok"` (`:120-124`, DI-23-01) — so the non-destructive upgrade branch above means a v2 shared draft now reaches here `ok` (windowless), threads NO window, and runs the union path unless a default is applied upstream. NOTE: there is no `collapseAliasedHoldingStrategies` call in share-resolve (it builds `strategies` directly from `addedStrategies`), so the Pitfall-4 pre/post-collapse hazard does NOT apply here — `state` is already the engine state.

---

### `scenario-compare.ts` — inject window POST-collapse (service, transform)

**Analog:** the composer's `engineState` memo (`ScenarioComposer.tsx:1830-1835`) — the canonical POST-collapse injection idiom, replicated here.

**Current (NO window, post-collapse call)** (`scenario-compare.ts:145-155`):
```typescript
  const deAliased = collapseAliasedHoldingStrategies(
    adapterOutput.strategies, projectionState, liveInputs.symbolByHoldingId,
  );
  const dateMapCache = buildDateMapCache(deAliased.strategies);
  return computeScenario(deAliased.strategies, deAliased.state, dateMapCache);
```
Inject onto `deAliased.state` (POST-collapse — Pitfall 4; `projectionState` at `:139-143` is PRE-collapse and dealias silently drops `window`):
```typescript
  const engineState = draft.window
    ? { ...deAliased.state, window: draft.window }   // per-scenario window (heterogeneous OK)
    : deAliased.state;                                // windowless (v2) or live-book → union path
  return computeScenario(deAliased.strategies, engineState, dateMapCache);
```
The file's `:27-31` comment already flags this as the Phase-59 seam. **Live-book column stays windowless**: `buildLiveBookDraft()` (`:170-179`) omits `window`, so `draft.window` is falsy → union path (Phase-55 lock — verified: this is the exact intended behavior). Consider bumping `buildLiveBookDraft`'s hard-coded `schema_version: 2` (`:172`) to `SCENARIO_SCHEMA_VERSION` for consistency (harmless — never decoded/persisted, research A3), but confirm no test asserts the literal `2`.

---

### `ScenarioComposer.tsx` + `useScenarioState.ts` — seed window on reopen (component + hook, event-driven)

**Analog:** the composer's `applyWindow` (`:1802-1806`) + `windowBounds`/`commonPeriodWindow` memos (`:1790-1818`), and the hook's `hydrateFromSaved` (`:273-279`).

**Threading Site 1 is the trickiest wiring (research Open Question 1, MEDIUM confidence).** The window is Phase-57 composer LOCAL state (`winStart`/`winEnd` → `coverageWindow` memo, `:1781-1784`), NOT part of the draft the hook owns. On reopen the planner must locate the composer's hydrate effect and:
- If `draft.window` present (v3): seed via `applyWindow(draft.window)` (`:1802`).
- If absent (upgraded v2): seed from `commonPeriodWindow`/`defaultWindowFor(selectedSpans)` (`:1815-1818`) AND set the ephemeral provenance flag (from the codec's `reason === "upgraded_v2_windowless"`, surfaced through `hydrateFromSaved`).

**`hydrateFromSaved` current** (`useScenarioState.ts:273-279`) sets only the working draft via `setValue`. It must additionally surface the decode `reason` (or the composer reads the decode result directly) so the provenance flag can be set component-local. Do NOT persist the marker into the draft (Pitfall 3).

---

### Provenance note — reuse `DefaultChangeNote` shell (component, event-driven)

**Analog:** `DefaultChangeNote.tsx` (the WHOLE component — Contract 1 locks this reuse).

**Reusable shell** (`DefaultChangeNote.tsx:72-99`) — copy tokens/a11y VERBATIM:
```tsx
    <div
      role="status"
      aria-live="polite"
      data-testid="scenario-default-change-note"
      className="mt-6 flex items-start justify-between gap-3 rounded-md border border-border bg-surface-subtle px-4 py-3"
    >
      <p className="text-fixed-13 leading-relaxed text-text-secondary">
        {/* copy */} ·{" "}
        <button type="button" onClick={onShowFullRange}
          className="rounded-sm font-medium text-accent transition-colors duration-150 ease-out hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none">
          Show full range
        </button>
      </p>
      <button type="button" aria-label="Dismiss" onClick={() => setDismissed(true)}
        className="shrink-0 rounded-sm px-1 text-fixed-13 text-text-muted transition-colors duration-150 ease-out hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none">
        ×
      </button>
    </div>
```
New copy (locked, 59-CONTEXT §4 / UI-SPEC): `This saved scenario predates coverage windows — showing the common period · Show full range`.

**⚠️ KEY DIVERGENCE — dismissal MUST be ephemeral, NOT localStorage (Pitfall 3 / UI-SPEC Interaction contract):**
`DefaultChangeNote` persists dismissal via `useCrossTabStorage` at key `composer.coverageDefaultChangeNoteDismissed` (`:49-66`). The provenance note MUST instead use a **component-local `useState`** so it re-shows for EACH old draft reopened. Do NOT reuse the POLISH-03 localStorage flag. This is Claude's-discretion: either (a) add a `dismissalMode: "ephemeral" | "persistent"` prop to `DefaultChangeNote`, or (b) a thin `ProvenanceNote.tsx` wrapper that renders the same `<div>` shell with local `useState`. Either is acceptable; the ephemeral behavior is the hard requirement.

---

### `ScenarioCompareTable.tsx` `<tfoot>` — augment the Window row (component, render)

**Analog:** its OWN `verdict.ok` branch (`:266-269`) + `BlendHeader`'s date treatment (`BlendHeader.tsx:64-77`).

**Current `verdict.ok` branch** (`ScenarioCompareTable.tsx:266-269`):
```tsx
                    ) : verdict.ok ? (
                      <span className="text-xs font-metric text-text-muted">
                        {methodologyLine(c.metrics.n)}
                      </span>
                    ) : (
```
**AUGMENT (do NOT replace/duplicate — Pitfall 6):** append `· {effective_start}–{effective_end}` to the `verdict.ok` branch ONLY, reading `c.metrics.effective_start` / `c.metrics.effective_end` (NEVER re-derive). Suppress the label on the `undecodable` (`:259`) and below-floor (`:270`) branches (no honest window to show).

**Date-treatment analog — `BlendHeader.tsx:64-77`** (Contract 2 typography source: `font-mono tabular-nums`, en-dash, lexicographic `YYYY-MM-DD`):
```tsx
          Mean of{" "}
          <span className="font-mono tabular-nums">{n}</span> strategies ·{" "}
          <span className="font-mono tabular-nums">{effStart}</span>
          {"–"}
          <span className="font-mono tabular-nums">{effEnd}</span>
```
Contract 2 label lands at `text-fixed-11 text-text-muted` (the `<tfoot>` cell is already that, `:248`). Claude's-discretion: inline in the `<tfoot>` branch or extract a small `CompareWindowLabel`.

---

### `test_scenario_shares_rls.sql` — additive window round-trip + no-leak (SQL leak-scan)

**Analog:** the file's OWN Assertion 1 CONTENT-by-field guard (`:236-240`) + the seed INSERTs (`:150-196`).

**Seed pattern** (`test_scenario_shares_rls.sql:155-163`) — add a `window` to a seeded draft:
```sql
  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES ( uid_a, 'tenant a ... scenario',
    jsonb_build_object(
      'addedStrategies', jsonb_build_array(...),
      'toggleByScopeRef', jsonb_build_object(...),
      'window', jsonb_build_object('start','2024-01-01','end','2024-12-31')  -- ◄ ADD
    ), 2 );   -- keep schema_version 2 to also exercise the pre-v1.5 round-trip, OR add a 3rd v3-seeded row
```
**Existing negative guard (MUST stay intact — do NOT weaken)** (`:236-240`):
```sql
  payload_text := lower(coalesce(r.name,'') || ' ' || coalesce(r.draft::text,'') || ' ' || coalesce(r.series::text,''));
  IF payload_text ~ 'api_key|allocated_amount|account_balance|value_usd' THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): ... OVER-RETURN LEAK. payload=%', payload_text;
  END IF;
```
**ADD a positive assertion** that the window survives the RPC round-trip:
```sql
  IF (r.draft->'window'->>'start') IS DISTINCT FROM '2024-01-01'
     OR (r.draft->'window'->>'end') IS DISTINCT FROM '2024-12-31' THEN
    RAISE EXCEPTION 'TEST FAILED: draft.window did not round-trip through get_shared_scenario';
  END IF;
```
The negative CONTENT-by-field guard already covers the new field automatically (the window is INSIDE `draft`, already in `payload_text`) — the window is two ISO date strings and cannot introduce a forbidden token. Keep Assertion 2 (empty addedStrategies → `series = []`, `:249-252`) and the cross-tenant assertions green.

## Shared Patterns

### Non-destructive schema upgrade (the phase's load-bearing correctness pattern)
**Source:** the codec trichotomy in `scenario-state.ts:623-653` (add a 4th branch, do NOT reuse the reset path).
**Apply to:** `scenario-state.ts` codec ONLY (single decode authority, M-0153). All three consumers (reopen, share, compare) inherit the fix by decoding through this one codec.
**Rule:** a `rawVersion === SCENARIO_SCHEMA_VERSION - 1` draft `safeParse`s → `outcome: "ok"` (NEVER `reset`). Reset here silently DELETES every pre-v1.5 saved scenario (in share → `honest-absence`/404; in compare → older-format stamp + NULL_METRICS). **Write the RED test first** (`scenario-state.test.ts`): a v2 windowless draft decodes `ok`, `window === undefined`, `reason === "upgraded_v2_windowless"`.

### Window injection POST-collapse (the canonical engine-state idiom)
**Source:** `ScenarioComposer.tsx:1830-1835` (`engineState` memo).
**Apply to:** `scenario-compare.ts` (`deAliased.state`, `:155`). NOT needed in `share-resolve.ts` (no collapse there — `state` is already engine state). NEVER inject on the pre-collapse `projectionState` (dealias drops `window` — Pitfall 4). Live-book / own-book callers pass NO window (Phase-55 union lock).

### Ephemeral vs localStorage dismissal (the KEY UI divergence)
**Source:** `DefaultChangeNote.tsx:49-66` uses `useCrossTabStorage` (persistent). The provenance note MUST use component-local `useState` (ephemeral, per-open, re-shows for each old draft).
**Apply to:** the provenance note (Contract 1) ONLY. Reusing the `composer.coverageDefaultChangeNoteDismissed` localStorage flag would suppress the note globally after one dismissal — a correctness bug (a per-scenario data-provenance signal must recur).

### Additive-only leak-scan extension (the PERSIST-02 enforcement point)
**Source:** `test_scenario_shares_rls.sql:236-240` (Assertion 1 CONTENT-by-field guard).
**Apply to:** the leak-scan test. ADD a positive round-trip assertion + keep every existing negative guard intact. Do NOT weaken the `api_key|allocated_amount|account_balance|value_usd` regex — it is the sole content-level over-return guard for the shared payload. The window rides INSIDE `draft` (already scanned), so it adds zero new leak surface; the RPC body does NOT change → `npm run schema:functions` NOT invoked, snapshot stays byte-identical.

### Bounded-optional zod field (storage-poison defense)
**Source:** `scenario-state.ts:582` (`userWeightOverrides` bounded + `.optional()`) + FIX A comment `:570-573`.
**Apply to:** the new `window` zod field — `.max(32)` on each ISO string, `.optional()`. `MAX_DRAFT_BODY_BYTES` (256KB) backstops the whole draft.

### Version-relative test fixtures shift with the constant (Pitfall 2)
**Source:** `share-resolve.test.ts:85` (version-ahead → honest-absence assertion).
**Apply to:** `share-resolve.test.ts` + any codec test using a hard-coded future version. Re-base future-version fixtures from `3` to `4` (now that `current = 3`, a `schema_version: 3` draft decodes `ok`, not `readonly`). Grep test fixtures for literal `schema_version: 3`.

## No Analog Found

None. Every change maps to an in-file or sibling analog. The single piece of genuinely-new LOGIC (the
non-destructive v2→v3 codec branch) is a structural variant of the existing `version_ahead → readonly`
branch, not a new pattern — it copies the `safeParse`-then-return shape and only changes the outcome
to `ok` and the reason to a provenance marker.

## Metadata

**Analog search scope:**
- `src/app/(dashboard)/allocations/lib/` (scenario-state.ts, scenario-compare.ts)
- `src/app/(dashboard)/allocations/components/` (ScenarioComposer.tsx, ScenarioCompareTable.tsx, DefaultChangeNote.tsx, BlendHeader.tsx)
- `src/app/(dashboard)/allocations/hooks/` (useScenarioState.ts)
- `src/app/scenario-share/[token]/` (share-resolve.ts)
- `src/app/api/allocator/scenario/saved/` (route.ts — save-whole verified)
- `src/lib/storage/cross-tab.ts` (DecodeResult.reason type — A1 verified)
- `supabase/tests/` (test_scenario_shares_rls.sql)

**Files scanned:** 9 source + 1 SQL test (all read at verified line ranges; no re-reads)
**Load-bearing assumptions re-verified against code:**
- `DecodeResult.reason` is `string | null` (open string) — CONFIRMED `cross-tab.ts:62`. A1 resolved: no type extension needed.
- Save route persists `draft` whole — CONFIRMED `saved/route.ts:132-141` (`draft: parsed.data.draft`).
- Codec reset-on-mismatch collision at v2 under `current=3` — CONFIRMED `scenario-state.ts:653`.
- `share-resolve` has NO collapse step (Pitfall 4 N/A there) — CONFIRMED `share-resolve.ts:183`.
- `buildLiveBookDraft` omits window (stays union) — CONFIRMED `scenario-compare.ts:170-179`.

**Pattern extraction date:** 2026-07-02
