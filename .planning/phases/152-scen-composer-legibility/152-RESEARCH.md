# Phase 152: SCEN — Composer legibility - Research

**Researched:** 2026-08-07
**Domain:** In-repo React 19 / Next 16 client-component surgery — additive wire field
through a zod-validated persisted draft, an inline row-detail expansion, a column
header strip, and a browse-row disambiguation line.
**Confidence:** HIGH (every claim below is `[VERIFIED: codebase]` against the live
post-151 working tree on branch `feat/v1.17-151-aum`; the only MEDIUM/LOW items are
called out explicitly in the Assumptions Log)

**Working-tree note:** research was performed on branch `feat/v1.17-151-aum` at
`472117a8`, which contains all of Phase 151 (waves 01–07) merged. Every line anchor
in this document was read from that tree, not from REQUIREMENTS.md.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Ownership marker (SCEN-02)**
- Muted "YOURS" chip on the added-strategy row, visually consistent with the Phase-150
  mark tag on /my-strategies. Never amber/red; sign-only color discipline per DESIGN.md.
- Wire: additive optional `isOwn` on the browse route row AND on `AddedStrategy` —
  zod optional/nullish, NO SCENARIO_SCHEMA_VERSION bump (151-06 `manualAumUsd`
  precedent: optional + no refine + safeParse tolerance; a decode of a v4 blob without
  the field must never reset the draft).
- Old persisted drafts: absent field = no marker rendered (never fabricate ownership);
  the field populates when browse/add next runs.

**Clickable rows (SCEN-03)**
- Detail drawer matching the Holdings tab pattern (`HoldingsTable` → `HoldingDetail`);
  contains a "View factsheet" link (OWN-02 shipped in 148 — owner sees own factsheet,
  published resolves for everyone; never a notFound() dead end).
- Drawer content: ONLY what is already in memory (name, provenance/TrustTierLabel,
  markets, strategy types, cagr/sharpe when present). Null metrics → honest
  "not available" state per no-invented-data. NO new fetches this phase.
- Click target: row surface + name clickable; interactive controls (toggle,
  weight/dollar/leverage inputs) excluded via stopPropagation. Keyboard-reachable
  (Enter/Space on focused row) per a11y baseline.

**Labeled numbers (SCEN-04)**
- ONE header row over the constituents list, mono eyebrow style per DESIGN.md:
  WEIGHT · MODE · LEV · NOTIONAL (exact copy pinned by UI-SPEC).
- Non-derivable notional em-dash: reuse 151's exact pattern — `title` + `sr-only`
  span with remedy copy ("Set portfolio AUM to size in dollars") so it reads
  "not applicable", never "broken".

**Browse duplicates (SCEN-05)**
- DISAMBIGUATE, don't hide: when an owned row's name collides with another owned row
  in the same browse result, render a secondary line (created date + venue/key count +
  status) so the choice is resolvable. No destructive merge, no collapsing — the two
  Alpha Centauri rows are real and may differ in key sets.
- Prevention stays with WIZCONT-02 (Phase 154); data cleanup of the existing duplicate
  rows is a founder decision outside this phase.

### Claude's Discretion
- Drawer component reuse vs. a thin composer-specific wrapper (prefer reuse of the
  Holdings pattern; do not fork a second drawer idiom).
- Exact header-label copy and chip copy within UI-SPEC constraints.
- Disambiguation-line format details (date format per existing browse rows).
- Test placement per repo convention.

### Deferred Ideas (OUT OF SCOPE)
- Richer drawer metrics for drawer-added strategies (needs a returns-route change —
  separate decision).
- Duplicate-row cleanup/merge tooling for existing data.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCEN-02 | An allocator-uploaded strategy is visually distinguishable from a third-party published one in the scenario composition list | §Wire Trace A (route → drawer → AddedStrategy → row), §Pitfall 1 (nested-schema strip), §Pitfall 2 (three add seams), §Component Contract 1 anatomy verified at `OwnershipTag.tsx:34-35` |
| SCEN-03 | A strategy row in the scenario is clickable, opening richer detail incl. a factsheet link | §Wire Trace B (`addedStrategyMetadataLookup` is NOT threaded to `CompositionList` — a new prop is required), §Pitfall 5 (the HoldingsTable pattern is NOT keyboard-accessible — do not mirror its a11y), §Pitfall 6 (the factsheet link CAN 404 — honest scope bound) |
| SCEN-04 | The numbers on a scenario row are labelled | §Wire Trace C (exact column widths + the `gap-2` cluster), §Pitfall 3 (Target-mode injects a 6th control and breaks alignment), §Pitfall 4 (the em-dash pattern already exists at `:5875-5884` — SCEN-04's notional cell must COPY it, it is a different span) |
| SCEN-05 | The strategy browser does not present an unresolvable duplicate | §Wire Trace D, §Decision D-1 (key_count costs a second query — `created_at` alone resolves the founder's actual case), §Pitfall 7 (H-0300 fence test must gain TWO arms, not be relaxed) |
</phase_requirements>

---

## Summary

This is a **pure in-repo integration phase**. There is no library research to do, no
package to install, and no new dependency. Every asset the phase needs already exists
and was read in this session; the entire risk surface is *wiring* — specifically, four
places where the obvious implementation silently loses data or silently widens a
security fence.

The four defects decompose into two wire changes and two render changes. The wire
changes (`isOwn` onto `AddedStrategy`; `isOwn` + disambiguation fields onto the browse
row) each traverse a *fence* that is pinned by an exhaustive test: the browse route's
`H-0300a` allow-list assertion (`Object.keys(...).sort()).toEqual(ALLOWED)`,
`route.test.ts:760`) and the scenario draft's `z.object` strip semantics
(`scenario-state.ts:845-850`). Both fences will FAIL on a correct implementation and
must be **extended with new exhaustive arms**, never relaxed. The render changes
(inline detail expansion; column-header strip) both need data that is currently *in
the composer but not threaded into `CompositionList`*, and both must compose with
Phase 151's shipped per-row dollar input rather than fighting it.

Four findings materially change what a naive plan would do, and are the reason this
document exists:

1. **The browse route is at `src/app/api/strategies/browse/route.ts`, not
   `src/app/api/allocator/strategies/browse/route.ts`.** Both CONTEXT.md and UI-SPEC.md
   state the latter path; it does not exist. `[VERIFIED: filesystem]`
2. **`isOwn` on `AddedStrategy` must be declared on the NESTED `addedStrategySchema`,
   not the top-level draft schema.** A copy-paste of 151-06's `manualAumUsd` test into
   a draft with `addedStrategies: []` would be **vacuous** — it would pass while the
   field is being stripped on every localStorage round-trip and every save-route POST.
3. **`AddedStrategy` is constructed at THREE distinct sites** (two `StrategyBrowseDrawer`
   mounts at `ScenarioComposer.tsx:4074` and `:5418`, plus the `BridgeDrawer` seam at
   `:5454`), each with its own hand-written field-by-field literal. Wiring `isOwn`
   through one and forgetting the others is the default failure.
4. **`key_count` is not obtainable from the existing browse SELECT.** It requires
   either a PostgREST embed (no repo precedent) or a second RLS-scoped query. The
   founder's own two "Alpha Centauri" rows are 15 days apart (`2026-08-04` vs
   `2026-07-20`), so `created_at` alone already resolves the phase's actual acceptance
   case. See Decision D-1.

**Primary recommendation:** Treat this as four independent additive wires with a
fence-extension test for each. Land the wire (route + zod + seams) *before* any render
work, because every render behaviour is downstream of a field that can be silently
dropped — and a silent drop looks identical to "the chip just doesn't show for this
row".

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ownership determination (`user_id === session.id`) | API / Backend (`browse/route.ts` under `withAllocatorAuth`) | — | The session id is server-only (`withAllocatorAuth`); a client derivation would need the viewer's uid on the wire, widening disclosure for zero benefit. The bit is ALREADY computed at `route.ts:220`. |
| Ownership persistence across sessions | Browser (localStorage draft) + API (`scenarios.draft` jsonb) | — | `AddedStrategy` is both localStorage-persisted (codec) and DB-persisted (save routes). Both traverse the same `scenarioDraftSchema`. |
| Ownership chip render | Browser / Client (`ScenarioComposer` → `CompositionList`) | — | Pure projection of a draft field. |
| Row-detail expansion state (one-open-at-a-time) | Browser / Client (`CompositionList` local `useState`) | — | Transient view state, never persisted — mirrors `HoldingsTable`'s `expandedRowId` (`HoldingsTable.tsx:738`). Persisting it would put view state in a money-path blob. |
| Detail-panel metric values | Browser / Client (`addedStrategyMetadataLookup`, already in memory) | — | CONTEXT locks NO new fetches. The lookup at `ScenarioComposer.tsx:2390` already holds cagr/sharpe for book strategies. |
| Factsheet resolution | Frontend Server (RSC, `factsheet/[id]/v2/page.tsx` two-lane) | Database (RLS `strategies_read`) | OWN-02 (Phase 148) owns this; the composer only emits an href. |
| Duplicate-name detection | Browser / Client (`StrategyBrowseDrawer` over the fetched result) | — | The route returns the whole result set in one shot (`limit 200`, no pagination); collision is a property of the rendered list, so the client is the only tier that knows what is actually on screen. |
| Disambiguating metadata (`created_at`, `status`) | API / Backend (browse route, OWN rows only) | Database (RLS) | Owner metadata; must be fenced to own rows so a third-party row's creation date never reaches the wire. |

---

## Standard Stack

No new packages. This phase installs nothing.

### Core (already present, versions verified from `package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `next` | ^16.2.11 | App Router, route handlers | Existing app framework `[VERIFIED: package.json]` |
| `react` | 19.2.7 | Client components, `useState`/`useMemo` | Existing `[VERIFIED: package.json]` |
| `zod` | ^4.4.3 | Draft schema validation (`scenario-state.ts`) | Existing; `.nullish()` semantics used by the 151-06 precedent are v4-valid `[VERIFIED: package.json + scenario-state.ts:932]` |
| `vitest` | ^4.1.2 | Unit/component suite | Existing `[VERIFIED: package.json]` |
| `@testing-library/react` | ^16.3.2 | Component render tests | Existing `[VERIFIED: package.json]` |
| `@testing-library/user-event` | 14.6.1 | Keyboard/pointer interaction (needed for Enter/Space acceptance) | Existing `[VERIFIED: package.json]` |
| `@playwright/test` | ^1.61.1 | e2e + axe (`composer-axe.spec.ts` is CI-wired at `ci.yml:1780`) | Existing `[VERIFIED: package.json + ci.yml]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline expansion inside the row `<li>` | A right-edge slide-out (`StrategyBrowseDrawer` idiom) | UI-SPEC Component Contract 2 explicitly forbids it ("not a modal and not a right-edge slide-out") — a second drawer idiom on the same surface. REJECTED by contract. |
| A new prop threading `cagr`/`sharpe` into `CompositionList` | Hoisting the whole detail panel into `ScenarioComposer` and passing it as a render-prop | More indirection for one panel; the existing prop-threading convention on `CompositionList` (21 props) is the codebase convention (CLAUDE.md Rule 11). Use a prop. |
| Second query for `key_count` | Omit the key segment entirely (spec's own absent-branch) | See Decision D-1 — recommended. |

**Installation:** none.

---

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** No `npm install`, no
`pip install`, no new dependency in `package.json`. slopcheck was therefore not run;
there is nothing to check. Any plan that introduces a package for this phase is out of
scope and should be rejected.

---

## Project Constraints (from CLAUDE.md / AGENTS.md)

Actionable directives extracted; the planner must verify compliance:

| Directive | Source | Consequence for this phase |
|-----------|--------|----------------------------|
| **Read `node_modules/next/dist/docs/` before writing Next.js code — this Next version has breaking changes vs. training data** | AGENTS.md | Only relevant for the route handler. `browse/route.ts` already sets `export const runtime = "nodejs"` and uses `NextRequest`/`NextResponse` — no new Next API surface is introduced. No doc read strictly required, but do NOT introduce a new Next idiom. |
| **Coverage is a BLOCKING CI gate** (lines 82 / statements 80 / functions 74 / branches 72, `vitest.config.ts`) | CLAUDE.md | New render branches (chip-absent, detail-collapsed, metrics-absent note, disambiguation-absent) must each be exercised, or branch coverage can regress below 72. |
| **`npm run test:coverage` produces the report; the CI shards emit blob reports merged by `frontend-coverage`** | CLAUDE.md | Local verification: `npx vitest run <file> --no-file-parallelism`. |
| **DESIGN.md is binding for every visual decision; deviation needs explicit user approval; QA flags non-conforming code** | CLAUDE.md | 152-UI-SPEC.md is the phase's approved derivation of DESIGN.md and is itself binding. Do not re-litigate it. |
| **Skill routing** (review / qa / ship etc.) | CLAUDE.md | Orchestration concern, not a plan constraint. |
| Global: **Rule 3 Surgical Changes** — touch only what you must; don't refactor what isn't broken | ~/.claude/CLAUDE.md | `ScenarioComposer.tsx` is 6,467 lines and just took seven waves of 151 changes. Do not restructure it. |
| Global: **Rule 9 Tests verify intent** — a test that can't fail when business logic changes is wrong | ~/.claude/CLAUDE.md | Directly targets Pitfall 1 (the vacuous strip-guard test). |
| Global: **Rule 12 Fail loud** — "tests pass" is wrong if any were skipped | ~/.claude/CLAUDE.md | `composer-axe.spec.ts` self-skips without `TEST_SUPABASE_URL`; a green local run of it proves nothing. |

Repo lint gates that bite this surface `[VERIFIED: eslint.config.mjs]`:
- `quantalyze/no-raw-font-px` is **`error` repo-wide** (`eslint.config.mjs:98`) and
  additionally re-asserted `error` for `allocations/**` (the Phase-52/53 per-surface
  ratchet, `:295`). Use tier classes / `--text-fixed-*` tokens only — never `text-[10px]`.
- `quantalyze/no-raw-published-predicate` and the CONTRIB-04 owner-OR ban are `error`
  (`:46-49`). The browse route must keep routing through `withPublishedOrOwner`; do not
  add a raw `.or(...)` for the disambiguation query.
- `jsx-a11y/click-events-have-key-events` and `no-noninteractive-element-interactions`
  are **not** enabled (the repo uses `eslint-config-next`'s subset only), so an
  `onClick` on the row `<li>` will not be lint-blocked — but see Pitfall 5: that is a
  reason to be *more* careful, not less.

---

## Architecture Patterns

### System Architecture Diagram — the four wires

```
                          ┌─────────────────────────────────────┐
   session (server-only)  │  GET /api/strategies/browse         │
   withAllocatorAuth  ───▶│  route.ts                           │
                          │                                     │
   Supabase (RLS          │  withPublishedOrOwner(select …)     │
   strategies_read) ─────▶│    :139-162                         │
                          │         │                           │
                          │         ▼                           │
                          │  isOwnRow = r.user_id === user.id   │  ← ALREADY COMPUTED :220
                          │         │                           │     (today: only un-redacts name)
                          │         ▼                           │
                          │  NAMED-KEY FENCE :233-245           │
                          │   id, name, codename, markets,      │
                          │   strategy_types, is_example        │
                          │   + isOwn            ◀── WIRE 1     │
                          │   + created_at ┐                    │
                          │   + status     ├ OWN ROWS ONLY      │
                          │   (+ key_count)┘     ◀── WIRE 4     │
                          └──────────────┬──────────────────────┘
                                         │ BrowseResponse.strategies[]
                                         ▼
                          ┌─────────────────────────────────────┐
                          │  StrategyBrowseDrawer.tsx           │
                          │   StrategyBrowseRow  ◀── WIRE 1+4   │
                          │   filtered = useMemo(…)  :280       │
                          │        │                            │
                          │        ├─▶ collision detect ◀ WIRE 4│──▶ disambiguation <li> line
                          │        │                            │       (SCEN-05 render)
                          │        └─▶ handleAdd(s) :333        │
                          │              onAdd({id,name,        │
                          │                markets,types        │
                          │                (+isOwn) ◀── WIRE 2 })│
                          └──────────────┬──────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │ SEAM A :4074 (empty-state)     │ SEAM B :5418 (main body)       │ SEAM C :5454 (Bridge)
        │ handleAddStrategy({…})         │ handleAddStrategy({…})         │ addStrategyBridge(ref,{…})
        └────────────────────────────────┴────────────────┬───────────────┘
                                                          ▼
                          ┌─────────────────────────────────────┐
                          │  scenario-state.ts                  │
                          │   interface AddedStrategy  :96-104  │  ◀── WIRE 2 (type)
                          │   addStrategyBrowse  :484           │
                          │   addStrategyBridge  :519           │
                          │   ─────────────────────────────     │
                          │   addedStrategySchema  :845-850     │  ◀── WIRE 2 (zod) ⚠ z.object STRIPS
                          │   scenarioDraftSchema  :901         │
                          │   scenarioDraftSaveSchema :982      │
                          └──────────┬───────────────┬──────────┘
                                     │               │
                localStorage codec ◀─┘               └─▶ POST/PUT /api/…/scenarios/saved
                (decode MUST stay "ok")                  (persists parsed.data.draft)
                                     │
                                     ▼
                          ┌─────────────────────────────────────┐
                          │  CompositionList  :5757             │
                          │   per-key rows   :6073-6192         │  (no dollar input, no × button)
                          │   separator li   :6193-6197         │
                          │   ▸ HEADER li       ◀── WIRE 3      │  (SCEN-04 render)
                          │   added rows     :6198-6370         │
                          │     ├ name span :6268 → <button>    │  ◀── SCEN-03
                          │     ├ YOURS chip                    │  ◀── SCEN-02 render
                          │     ├ control cluster :6279         │  ← stopPropagation wrapper
                          │     └ detail panel (isExpanded)     │  ◀── SCEN-03 render
                          └─────────────────────────────────────┘
                                     ▲
                                     │ NEW PROP required (see Wire Trace B)
                          addedStrategyMetadataLookup :2390 (cagr/sharpe, in memory)
```

### Wire Trace A — SCEN-02 ownership, route → row

**Server (`src/app/api/strategies/browse/route.ts`)** `[VERIFIED: codebase]`

| What | Line | State today |
|------|------|-------------|
| `BrowseStrategyRow` interface | `:39-69` | 6 keys: `id, name, codename, markets, strategy_types, is_example` |
| `BrowseResponse` interface | `:84-88` | `{ strategies, has_more, limit }` |
| owner-inclusive select | `:139-156` | co-fetches `user_id` + `disclosure_tier`, both read-only, never emitted |
| `isOwnRow` computation | `:220` | `r.user_id !== null && r.user_id === user.id` — exists, used only for `safeLabel` |
| named-key fence (emit) | `:233-245` | explicit literal, `is_example: r.is_example === true` documents the "coerce so a NULL never widens the wire shape" discipline |

The bit is one line from the wire. The fence is an **explicit object literal, not a
spread** — that is load-bearing and pinned by `H-0300b`. Add `isOwn` as another named
key with the same strict-boolean coercion.

**Wire shape recommendation:** emit `isOwn: boolean` on **every** row (`false` for
third-party), NOT conditionally. Rationale: `isOwn` is a *viewer-relative relationship*,
not the other owner's metadata — `isOwn: false` discloses nothing the viewer does not
already know. A uniform key keeps the TypeScript shape non-optional and keeps the
`is_example` coercion precedent. The genuinely owner-scoped fields (`created_at`,
`status`, and `key_count` if adopted) are the ones that must be conditional. `[VERIFIED:
route.ts:241-244 precedent + H-0300 test intent]`

**Client (`StrategyBrowseDrawer.tsx`)** `[VERIFIED: codebase]`
- `StrategyBrowseRow` is a **duplicate structural declaration** at `:43-56` — it does
  NOT import from the route (the file's own TSDoc at `:39-42` says "when Plan 03 ships
  in this branch, this can be re-exported from the route handler instead"). It carries
  `is_example?: boolean` as an *optional*. Add `isOwn?: boolean` the same way.
- `AddedStrategy` is **a third, independent structural declaration** at `:64-69`
  (`id: string`, unbranded) — separate from `scenario-state.ts`'s branded one.
- `handleAdd` at `:333-339` builds the payload field-by-field.

**Draft (`scenario-state.ts`)** `[VERIFIED: codebase]`
- `interface AddedStrategy` `:96-104` — `id: StrategyForBuilderId` (branded), `name`,
  `markets`, `strategy_types`.
- `const addedStrategySchema = z.object({ id, name, markets, strategy_types })`
  `:845-850` — **this is the strip point.** See Pitfall 1.
- `scenarioDraftSchema` `:901-968` embeds it as `addedStrategies:
  z.array(addedStrategySchema).max(200)` `:907`.
- `scenarioDraftSaveSchema` `:982-992` = the same schema + a `memberKeyIds` superRefine.

**Row render (`ScenarioComposer.tsx`)**
- Added-row name cluster `:6250-6278`: toggle button → `<span>{a.name}</span>` `:6268`
  → `<TrustTierLabel trustTier={addedProvenanceByRef[a.id] ?? null} className="shrink-0" />`
  `:6271-6274` → `{chipState && <CoverageStateChip … className="shrink-0" />}` `:6275-6277`.
  UI-SPEC places the YOURS chip **between** `TrustTierLabel` and `CoverageStateChip`.

**`OwnershipTag` reuse verdict:** `src/components/strategy/OwnershipTag.tsx` `:51-58`
takes `mark: CapitalOwnership | null | undefined` and returns `null` for anything
outside `{own_capital, team_review}` — a **closed switch with no fallback**, and its
TSDoc `:19-24` states the closure is a deliberate anti-spoofing property (T-150-08).
**It does not accept the needed variant and must not be widened.** Reuse the ANATOMY
string byte-verbatim instead:

```
"inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium"   // OwnershipTag.tsx:35
"bg-badge-other/10 text-text-muted"                                          // OwnershipTag.tsx:48 (team_review ink)
```

Both tokens exist: `--color-badge-other: #6B7280` (`globals.css:87`) and
`--text-caption` (`globals.css:142`). `[VERIFIED: codebase]`

### Wire Trace B — SCEN-03 detail expansion

**The pattern to mirror (`HoldingsTable.tsx`)** `[VERIFIED: codebase]`

| Mechanic | Line | Detail |
|----------|------|--------|
| parent-owned open id | `:738` | `const [expandedRowId, setExpandedRowId] = useState<string \| null>(null)` |
| toggle | `:861-865` | `setExpandedRowId(prev => prev === row.id ? null : row.id)` — one-open-at-a-time by construction |
| `aria-expanded` | `:866` | on the `<tr>` |
| nested-control escape | `:889-893` | `onClick={(e) => { e.stopPropagation(); setExpandedRowId(row.id); }}` — per-control, because that control has a *different* intent |
| detail host | `:960-972` | a sibling `<tr data-detail-row-id>` with `className="border-b border-border bg-surface p-3"` |
| deterministic keys | `:754-762` | rows tie-break on id so sub-rows don't remount |

`HoldingDetail.tsx:20-21` states the contract explicitly: *"One-open-at-a-time is owned
by the parent table (only one HoldingDetail is mounted at a time). This component is
purely the tab body."*

**Data availability — the gap.** `addedStrategyMetadataLookup`
(`ScenarioComposer.tsx:2390-2452`) is a `Record<string, Pick<StrategyForBuilder,
"disclosure_tier"|"cagr"|"sharpe"|"asset_class"> & { trust_tier, is_composite }>`. It
holds `cagr`/`sharpe` from `found.strategy.strategy_analytics` for **book** strategies
and `null` for drawer-added ones (`:2427-2428`).

⚠️ **It is NOT passed to `CompositionList`.** The call site (`:5280-5301`) threads 21
props; only the *derived* `addedProvenanceByRef` (`:2460-2472`) crosses the boundary.
The detail panel therefore needs **one new prop**. Recommended shape — thread the
narrow projection, not the whole lookup, so `CompositionList` cannot accidentally reach
engine-facing fields:

```ts
/** SCEN-03 — ref → the in-memory metrics for the row detail. Book strategies carry
 *  values; drawer-added carry null (the returns route does not return them — CONTEXT
 *  locks NO new fetches this phase). Presentation-only; never an engine input. */
addedMetricsByRef: Record<string, { cagr: number | null; sharpe: number | null }>;
```

`markets` / `strategy_types` need no prop — they are already on `a` (the `AddedStrategy`
being mapped at `:6198`). Provenance needs no prop — `addedProvenanceByRef` is already
threaded.

**Formatters.** `formatPercent` is already imported in `ScenarioComposer.tsx:121`
(`import { formatCurrency, formatPercent } from "@/lib/utils"`). `formatNumber` is a
**new import from the same module** — it exists at `src/lib/utils.ts:27-30` and is
already used by `HoldingDetail.tsx:28`. Both return `"—"` for `null`/non-finite by
construction (`utils.ts:8`, `:28`), so the Numbers-Contract null rendering is inherited
free — no inline `?? "—"` needed, and no inline `toFixed`. `formatPercent`'s third
option defaults `signed: true` (`utils.ts:9`), which is what the signed-CAGR contract
wants. `[VERIFIED: codebase]`

**`TrustTierLabel` renders `null` for a null tier** (`TrustTierLabel.tsx:38-40`,
"`null`/`undefined` still render nothing (Phase 15 v0 contract, byte-for-byte
preserved)"). So a `PROVENANCE` eyebrow paired with a null tier produces a **labelled
empty space**, not an em-dash. The detail panel must render `—` explicitly when
`addedProvenanceByRef[a.id]` is null, or omit the eyebrow. Pick one and pin it.

### Wire Trace C — SCEN-04 header strip

**The added-row control cluster** — `ScenarioComposer.tsx:6279-6337`, a
`<div className="flex items-center gap-2">` containing, in order:

| # | Control | Class width | Line |
|---|---------|-------------|------|
| 1 | weight `<input type="number">` (+ `sr-only` label) | `w-20` | `:6283-6293` |
| 2 | `renderDollarInput(...)` → `w-24` input, or `w-24` em-dash span | `w-24` | `:6297` → `:5864-5922` |
| 3 | `renderModeToggle(...)` → `<button>` "Leverage" / "Target DD" | `shrink-0 … px-2 py-1 text-fixed-11` (**no fixed width**) | `:6301` → `:5930-5951` |
| 3b | `renderTargetInput(...)` — **conditional**, only when `targetModeByRef[ref] === true` | `w-16` | `:6302-6303` → `:5957-5993` |
| 4 | leverage `<input>` (+ `sr-only` label) | `w-16` | `:6307-6320` |
| 5 | notional `<span>` (read-only) | `w-20` | `:6323-6329` |
| 6 | remove `<button>` `×` | `px-2 py-1 text-xs` (**no fixed width**) | `:6330-6337` |

The **per-key** cluster (`:6136-6187`) is the same minus #2 (`renderDollarInput`) and
minus #6 (`×`) — which is exactly why UI-SPEC's Component Contract 3 scopes the header
to the added-strategies group only.

**Mount point.** The separator is:

```tsx
{draft.addedStrategies.length > 0 && (
  <li className="mt-2 px-1 text-xs uppercase tracking-wider text-text-muted">
    Strategies added · {draft.addedStrategies.length}
  </li>
)}                                                        // :6193-6197
```

immediately before `{draft.addedStrategies.map((a) => {` at `:6198`. The header `<li>`
mounts between them, inside the same `length > 0` guard (satisfying UI-SPEC's render
rule "renders whenever ≥1 added-strategy row renders").

⚠️ The parent is `<ul className="grid gap-2" data-testid="scenario-constituent-list">`
(`:6058`) — a **grid**, not a flex column. Each `<li>` is a grid item spanning the full
width. So the header `<li>` must itself reproduce the row's outer geometry to align:
the row's outer `<div className="flex w-full items-center justify-between gap-3">`
(`:6249`) pushes the control cluster to the right edge. The header must be a
`justify-between` with a left spacer (or `ml-auto` on the label cluster) plus the same
`gap-2` cluster — otherwise the labels sit flush-left over nothing. Note also the rows
carry `p-3` and `border` (`:6245`) while the separator li carries only `px-1`; the
header needs horizontal padding matching the ROW's `p-3` + its `border` width, not the
separator's `px-1`, or every label sits ~13px left of its column.

**Existing eyebrow recipe (byte-verbatim reuse target)** — the single existing
occurrence in this file is the 151 PORTFOLIO AUM label at `:4312`:

```
className="font-mono text-fixed-10 uppercase tracking-[0.18em] text-text-muted"
```

DESIGN.md's tracking ladder confirms `0.18em` = "Eyebrow std / the default eyebrow ·
micro-label" (`DESIGN.md:75`), and `--text-fixed-10: 0.625rem` exists
(`globals.css:164`). `[VERIFIED: codebase]`

**No list-level keyboard navigation exists.** Exhaustive `onKeyDown` census of
`ScenarioComposer.tsx` `[VERIFIED: grep]`: `:4142` (entry-mode segmented radiogroup,
ArrowLeft/ArrowRight — scoped to `data-testid="scenario-entry-mode"`, not the
constituent list), `:4331` (AUM input), `:5910` (dollar input, Enter), `:5975` (target
input, Enter), `:6409` (reset modal, Escape). **Nothing indexes the constituent `<ul>`'s
children**, and no test asserts `getAllByRole("listitem")` on it — the three
`getAllByRole("listitem")` assertions in `ScenarioComposer.test.tsx` (`:4120`, `:4174`,
`:4206`) are all scoped to the PCR (risk-contribution) list, reached via
`.closest("div")?.querySelector('ul[role="list"]')`. Inserting a non-row `<li>` is
therefore **safe** — and there is precedent: the separator `<li>` at `:6194` is already
a non-row list item.

### Wire Trace D — SCEN-05 disambiguation

**Route side.** `strategies.created_at` (`string`) and `strategies.status`
(`"draft" | "pending_review" | "published" | "archived" | "private"`) both exist on the
table `[VERIFIED: src/lib/types.ts Strategy interface]`. Neither is in the current
SELECT list (`route.ts:153`) — both are pure additive column adds to an existing query,
**zero extra round-trips**.

`key_count` is different. Key membership is bimodal `[VERIFIED: migrations]`:
- single-key strategy → `strategies.api_key_id` is set, zero `strategy_keys` rows;
- composite strategy → `strategies.api_key_id IS NULL`, N rows in `public.strategy_keys`
  (`supabase/migrations/20260710120000_strategy_keys.sql`).

`strategy_keys` RLS is `strategy_keys_owner … USING (owner_id = auth.uid())` `TO
authenticated`, with `REVOKE ALL … FROM anon` (`:123-129`). So an owner-scoped read is
permitted and third-party rows are filtered out by RLS regardless of what the query
asks for — the RLS itself is a second fence. But obtaining the count needs either a
PostgREST embed (`strategy_keys(count)` — **no precedent anywhere in `src/`**
`[VERIFIED: grep]`) or a second `.in("strategy_id", ownIds)` query plus a JS group-by,
plus co-fetching `api_key_id` into the read-only-never-emitted set.

**Client side.** `StrategyBrowseDrawer` fetches once per open (`:165-212`) into
`strategies`, then derives `filtered` in a `useMemo` (`:280-305`) that already produces
`{ s, tier }` pairs. Collision detection belongs in (or immediately beside) that memo.
The existing secondary line is at `:560-564`:

```tsx
<div className="mt-1 text-xs text-text-muted">
  {s.codename ?? ""}
  {s.codename && s.markets.length > 0 ? " · " : ""}
  {s.markets.join(" · ")}
</div>
```

— the recipe UI-SPEC pins for the disambiguation line ("`mt-1 text-xs text-text-muted`,
`·` separators").

**Collision scope decision (recommend `filtered`, not `strategies`).** UI-SPEC's honesty
invariant reads *"renders ONLY on rows in a detected own-row name collision — never on
every own row (it is a tiebreaker, not a metadata dump)"*. If the collision set is
computed over the FULL result, a market-filter that leaves one "Alpha Centauri" visible
still renders its metadata line — a metadata dump on a row with nothing to disambiguate
from. Computing over `filtered` is the reading faithful to the invariant. Cost: the
memo must run in two passes (build the name→count map over `filtered`, then tag) —
O(n), not O(n²). Pin this choice with a test (a filter that narrows to one row clears
the line).

**Collision key.** Normalize `trim().toLowerCase()` per UI-SPEC, and **gate on
`isOwn === true`** — SCEN-05 depends on SCEN-02's wire. Third-party rows carry
pseudonymised labels; a synthetic `Strategy #<id-prefix>` is id-derived and cannot
collide, and two real institutional names colliding is not this phase's problem.

**Date format.** UI-SPEC pins `toLocaleDateString("en-US", { month: "short", day:
"numeric", year: "numeric" })` (BridgeWidget precedent). ⚠️ `created_at` is a
timestamptz ISO string; `new Date(iso).toLocaleDateString(...)` renders in the
**browser's local timezone**, so a row created at `2026-08-04T02:00:00Z` shows "Aug 3"
for a US viewer. For a *disambiguation tiebreaker* that is harmless (the two rows are
15 days apart), and it matches the BridgeWidget precedent, so accept it — but a
snapshot-style test must pin a timezone or assert on a UTC-safe date to avoid a
CI-vs-local flake (recall the CI=Node22 / local=Node25 class of environment-dependent
test failures).

### Anti-Patterns to Avoid

- **`{ ...row, name: safeLabel }` in the browse route.** `H-0300b`
  (`route.test.ts:766-792`) exists specifically to fail on this and sweeps the whole
  payload for `user_id` / `backtest_returns`. Keep the explicit literal.
- **Widening `OwnershipTag`'s switch or routing the chip through `Badge`.**
  `Badge.tsx:55` falls back to the DRAFT entry for any unrecognised label — an
  unrecognised ownership value would render a trusted-looking Draft badge (documented
  threat T-150-08, `OwnershipTag.tsx:19-24`).
- **`role="button"` + `tabIndex` on the row `<li>`.** It would nest the toggle switch,
  four inputs, and the remove button inside an interactive role. UI-SPEC Component
  Contract 2 forbids it. The name-as-`<button>` is the correct affordance.
- **A `title`-only remedy on the em-dash.** `renderDollarInput`'s own comment
  (`:5870-5874`): *"the title is duplicated into an sr-only span because a title alone
  is unreachable by keyboard/touch and is not announced by every screen reader"*.
- **Forking a second weight-write path, or touching `handleWeightChange` /
  `commitDollarInput` / `notionalText`'s computation.** 151 owns sizing. SCEN-04 changes
  the notional cell's *`title` + `sr-only`* in the non-derivable branch only — not the
  arithmetic at `:5794`.
- **Bumping `SCENARIO_SCHEMA_VERSION`.** CONTEXT locks it; `scenario-state.test.ts:1124`
  already pins `expect(SCENARIO_SCHEMA_VERSION).toBe(4)` as "version discipline".

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Null-safe metric rendering | `x == null ? "—" : x.toFixed(2)` | `formatNumber(x, 2)` / `formatPercent(x, 1)` from `@/lib/utils` | Both already return `"—"` for null AND non-finite (`utils.ts:8, :28`); an inline `toFixed` misses `NaN`/`Infinity`. UI-SPEC: "never an inline `toFixed`; one formatter module per surface." |
| Ownership badge visuals | A hand-written span with new classes | Byte-verbatim `OwnershipTag` ANATOMY + `team_review` INK strings | Anything else forks the badge family and drifts the token set; UI-SPEC "Reuse rule (binding)". |
| One-open-at-a-time expansion | A `Set<string>` of open ids, or per-row local state | A single `useState<string \| null>` in the parent + `prev === id ? null : id` | `HoldingsTable.tsx:861-865`. Per-row state makes "one at a time" impossible; a Set silently allows many. |
| "Is this row mine?" | Comparing ids client-side | The server's `isOwnRow` (`route.ts:220`) | The session id is server-only by design (T-110-05/07); shipping the viewer uid to the client to derive it is a disclosure widening for zero gain. |
| Owner-inclusive query predicate | `.or("status.eq.published,user_id.eq." + id)` | `withPublishedOrOwner(query, user.id)` | `quantalyze/no-raw-published-predicate` + the CONTRIB-04 owner-OR ban are `error` in eslint (`eslint.config.mjs:46-49`). |
| Draft-shape validation | A hand-rolled runtime check on `addedStrategies` | Declaring the field on `addedStrategySchema` | `z.object` strips undeclared keys — a runtime check downstream of the strip can never see the field. |

**Key insight:** every "don't hand-roll" item here is a case where the hand-rolled
version *renders identically* to the correct version in the happy path, and diverges
only in the failure/absence branch. That is precisely the class of defect a render test
with populated fixtures cannot catch — which is why the Validation Architecture below
insists on absence-side falsifiers.

---

## Common Pitfalls

### Pitfall 1: The nested-schema strip — and the vacuous test that hides it

**What goes wrong:** `isOwn` is added to `interface AddedStrategy` and to all three
construction sites, the chip renders in dev, and then it silently vanishes on every
page refresh and never reaches the DB.

**Why it happens:** `addedStrategySchema` is `z.object({ id, name, markets,
strategy_types })` (`scenario-state.ts:845-850`). **`z.object` strips unknown keys.**
The draft traverses this schema on *every* localStorage decode (the codec safeParses in
all four version branches, `:1031/:1049/:1081/:1112`) AND at the save boundary — and
`saved/route.ts` persists `parsed.data.draft`, i.e. the **stripped** object. The
codebase has been bitten by this twice and documented it twice, at
`scenario-state.ts:912-914` (leverageOverrides: *"⚠️ LOAD-BEARING: `z.object` STRIPS
unknown keys and saved/route.ts:140 persists `parsed.data.draft`, so WITHOUT this field
a POSTed leverage map is silently dropped"*) and `:922-924` (manualAumUsd, same
warning).

**How to avoid:** declare it on the **nested** schema:
`addedStrategySchema = z.object({ …, isOwn: z.boolean().nullish() })`. `.nullish()` (not
`.optional()`) for the 151-06 reason at `:927-929`: `JSON.stringify` writes `null` for
values it cannot represent, and a bare `z.boolean()` REJECTS `null` → safeParse fails →
the codec's `schema_invalid` reset → **the user's entire scenario is deleted**.

**Warning signs:** this is the trap. The 151-06 strip-guard test (`scenario-state.test.ts:1102-1121`)
uses a `v4Draft()` fixture with **`addedStrategies: []`** (`:1059`). Copy-pasting that
fixture for `isOwn` produces a test that asserts nothing about the nested schema and
passes while the field is being stripped. **The `isOwn` strip-guard fixture MUST have a
non-empty `addedStrategies` array**, and the assertion must read
`parsed.data.addedStrategies[0].isOwn`.

### Pitfall 2: Three construction sites, one edit

**What goes wrong:** `isOwn` flows for strategies added from the main-body Browse
drawer but is absent for the same strategy added from the empty-state drawer.

**Why it happens:** `AddedStrategy` is built by hand at three places `[VERIFIED: grep]`:
- `ScenarioComposer.tsx:4074-4081` — empty-state `<StrategyBrowseDrawer onAdd={...}>`
- `ScenarioComposer.tsx:5418-5425` — main-body `<StrategyBrowseDrawer onAdd={...}>`
- `ScenarioComposer.tsx:5454-5459` — `<BridgeDrawer onAddToScenario={...}>` →
  `scenario.addStrategyBridge(...)`

The two Browse mappings are **byte-identical duplicates** with independent JSX literals.
Plus a fourth hand-written mapping inside the drawer itself (`StrategyBrowseDrawer.tsx:334-339`).

**How to avoid:** edit all four. For the **Bridge** seam, leave `isOwn` **absent** — a
Bridge candidate comes from the match engine and carries no ownership signal, and CONTEXT
locks "never fabricate ownership". Absent and `false` render identically, but absent is
the honest claim. Make it a deliberate, commented decision, not an omission.

**Warning signs:** a render test that only ever mounts the composed (non-empty) branch.
Note `composer-axe.spec.ts:12-21` documents that a freshly-seeded allocator lands on the
**blank-slate branch** — so the empty-state drawer is the one a first-time user actually
touches.

### Pitfall 3: The header strip drifts on any Target-mode row

**What goes wrong:** the header labels line up beautifully in dev and are visibly off by
~72px the moment a row is switched to Target max-DD mode.

**Why it happens:** `renderTargetInput` (a `w-16` input) is injected into the cluster
**between** the mode toggle and the leverage input, conditionally on
`targetModeByRef[ref] === true` (`:6302-6303`). It is a per-ROW state, so one row in
Target mode shifts LEV and NOTIONAL right on that row only, while the single header
stays put.

**How to avoid:** this is unavoidable with one static header — UI-SPEC accepted it
("Target-mode's conditional drawdown input is a sub-control of MODE and gets no column
label"). The plan should (a) size the header for the **default Leverage mode** (the
state every row starts in — `ScenarioComposer.tsx:1806, :1863` confirm a reopened
scenario starts every row in Leverage mode), and (b) **state the limitation in the
plan** so a reviewer does not log it as a defect. Do NOT attempt a per-row header.

**Warning signs:** a plan task that says "align the header with the row columns" with no
Target-mode caveat.

### Pitfall 4: Patching the wrong em-dash

**What goes wrong:** the SCEN-04 "honest notional" work modifies
`renderDollarInput`'s em-dash and calls the requirement done.

**Why it happens:** there are **two** em-dash spans in the added row, ~450 lines apart
and easy to confuse:
- `:5875-5884` — the **USD allocation** cell, `data-testid="scenario-constituent-usd-unset"`,
  which **already has** the full `title` + `sr-only` remedy pattern (151 shipped it).
- `:6323-6329` — the **NOTIONAL** cell, `data-testid="scenario-constituent-notional"`,
  which today carries only the derived-state `title` (*"Notional = equity × blend share
  × leverage — derived, informative only…"*) and **no remedy, no `sr-only`**, and whose
  value comes from `notionalText(a.id)` (`:5785-5796`).

SCEN-04's honest-notional item is about the **second** one. UI-SPEC Component Contract 4
is explicit: *"The existing derived notional span keeps its recipe and its derived-state
`title` verbatim. ONLY the non-derivable state changes."*

**How to avoid:** the change is conditional on `notionalText(ref) === "—"`, swaps the
`title` to the remedy sentence, and adds the `sr-only` span. Note the two remedies are
different sentences with different causes: the USD cell's `AUM_UNSET_REMEDY` (`:5815`)
is *"Set portfolio AUM to size in dollars"*, but the notional em-dash's cause is
`totalBookEquity == null` or an excluded row absent from `blendShareByRef`
(`:5787-5792`) — **not** an unset AUM. CONTEXT pins the copy as "Set portfolio AUM to
size in dollars"; that sentence is only strictly accurate for the USD cell. Flag this
to the founder/planner: reusing the AUM copy on the notional cell risks telling a
book-less allocator to set an AUM that will not make the notional derivable (notional
bases on `totalBookEquity`, a *different* number, per `:5692-5698`). **This is the
single most likely source of a dishonest-copy finding in review.** Recommendation:
keep the copy CONTEXT pinned for the USD cell (unchanged, already shipped) and use a
cause-accurate sentence for the notional cell, or explicitly get the founder to accept
the shared sentence.

### Pitfall 5: Mirroring the Holdings pattern's a11y

**What goes wrong:** the row detail is unreachable by keyboard, and `composer-axe`
reports an ARIA violation.

**Why it happens:** `HoldingsTable.tsx:858-869` puts `onClick` and `aria-expanded`
directly on a `<tr>` with **no role, no `tabIndex`, and no key handler**. That row is
pointer-only, and `aria-expanded` on a bare `<tr>` is not a valid ARIA usage. It is the
*host* idiom that is worth mirroring (inline expansion, parent-owned single open id,
`bg-surface p-3` host), **not** its interaction model.

**How to avoid:** UI-SPEC Component Contract 2 already prescribes the fix — the strategy
NAME becomes `<button type="button" aria-expanded aria-controls="scenario-detail-{id}">`.
A real `<button>` gets Enter/Space natively; no `onKeyDown` needed. The row `<li>`'s
`onClick` is pointer amplification only.

⚠️ **Acceptance phrasing is binding** (UI-SPEC "Acceptance-phrasing rule"): every
keyboard criterion must read *"Enter/Space on the focused strategy-name button"*, never
*"on the focused row"* — the row container is deliberately not focusable, so a
row-focus criterion tests an affordance the contract forbids.

⚠️ **`stopPropagation` scope.** The row `<li>` contains more than the control cluster:
`renderSolveState(a.id)` (`:6367`) and the two series-state notes (`:6349-6366`) also
live inside it. One wrapper on the control-cluster `<div>` (`:6279`) is what UI-SPEC
specifies; clicking a note will then toggle the detail. Decide whether that is
acceptable (it probably is — a note is not interactive) and pin it, rather than
discovering it in QA.

### Pitfall 6: "The factsheet link always resolves" is an over-claim

**What goes wrong:** an acceptance criterion asserts the link never dead-ends, and a
reviewer finds a reachable 404.

**Why it happens:** OWN-02 (Phase 148) makes `/factsheet/[id]` resolve for (a) any
published strategy and (b) the owner's own unpublished strategy — the two-lane selection
at `factsheet/[id]/v2/page.tsx:414-540`, with `notFound()` on both lane misses (`:455`,
`:500`). `[VERIFIED: codebase]` But an `AddedStrategy` in a **persisted draft** is a
snapshot: a third-party strategy that was `published` when added and has since been
`archived` (or deleted) is now on neither lane, and the link 404s.

Nor is there an in-memory signal for it. The lazy returns fetch treats a 404 as a
retryable failure that leaves the entry `undefined` (`ScenarioComposer.tsx:1435-1444`,
WR-01) — it produces **no** distinguishing state; `addedSeriesStateByRef` falls back to
`"available"` (`:6229`), so the row looks normal.

**How to avoid:** scope the acceptance criterion honestly — *"the link resolves for the
viewer's own strategies (OWN-02) and for currently-published third-party strategies"* —
and log the stale-draft residual as a deferred item. Detecting it would require a fetch,
which CONTEXT explicitly forbids this phase.

### Pitfall 7: Relaxing the H-0300 fence instead of extending it

**What goes wrong:** `H-0300a` fails after the wire change, and the fix is to add the
new keys to `ALLOWED` — which silently grants third-party rows the owner metadata.

**Why it happens:** `route.test.ts:731-763` asserts
`expect(Object.keys(body.strategies[0]).sort()).toEqual(ALLOWED)` against a **single
row fixture** with no `user_id`, i.e. a third-party row. Adding four keys to one flat
`ALLOWED` array makes the test pass and destroys the disclosure fence in the same edit.

**How to avoid:** split into **two exhaustive arms**:
- *third-party row* (`user_id` ≠ session) → keys are exactly
  `[id, name, codename, markets, strategy_types, is_example, isOwn]`, plus explicit
  `not.toHaveProperty("created_at" | "status" | "key_count")`;
- *own row* (`user_id` === session) → keys are exactly the above **plus**
  `created_at`, `status` (`+ key_count` if adopted).

Both arms must stay exhaustive `toEqual` comparisons. Add a whole-payload sweep
(`expect(JSON.stringify(body)).not.toContain(<other owner's created_at>)`) mirroring
`H-0300b:789-791`.

**Warning signs:** a single-row fixture in the fence test; a `ALLOWED` array with
optional members; `expect.objectContaining`.

### Pitfall 8: Local vitest parallelism

`ScenarioComposer.test.tsx` is 12,234 lines / 265 tests. Run targeted files with
`--no-file-parallelism` locally (documented repo behaviour for this suite); CI shards
run on Node 22 while local is Node 25, and environment-dependent assertions
(notably `toLocaleDateString`) are the known divergence class.

---

## Runtime State Inventory

Not a rename/refactor/migration phase — but there IS persisted state whose shape
changes, so the categories are answered rather than omitted.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **`scenarios.draft` (jsonb, Supabase)** — every saved scenario holds an `addedStrategies[]` array whose objects will lack `isOwn`. **`localStorage` key `allocations.scenario_v0_15.{allocatorId}`** (`scenario-state.ts:92-94`) — same. | **Code edit only, NO data migration.** CONTEXT locks: absent field = no chip; the field populates on the next browse/add. A backfill would have to *infer* ownership from a stale snapshot — the fabrication CONTEXT forbids. Verified: no writer of `scenarios.draft` other than the two save routes. |
| Live service config | None — no external service holds composer row shape. Verified by: the browse route and the composer are both first-party code in this repo; no n8n workflow, Datadog dashboard, or Tailscale ACL references these identifiers. | none |
| OS-registered state | None — no scheduled task, pm2 process, or systemd unit references composer/browse identifiers. Verified by absence from `scripts/` and CI workflow files. | none |
| Secrets / env vars | None. No new env var; no existing var name changes. `composer-axe.spec.ts` reads the pre-existing `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` (unchanged). | none |
| Build artifacts | None — TypeScript/Next build output only, regenerated on every build. No egg-info, no published package, no Docker tag. | none |

**Schema-version consequence, stated explicitly:** `SCENARIO_SCHEMA_VERSION` stays `4`
and `SCENARIO_SCHEMA_VERSION_PREV` stays `3`. Because `isOwn` is optional/nullish on the
nested schema, a pre-152 v4 blob safeParses clean through every one of the codec's four
branches — no new upgrade branch, no new reason string, and critically **no path to the
draft-deleting reset**. `scenario-state.test.ts:1124` already pins the version; extend
that discipline test rather than adding a second one.

---

## Code Examples

All snippets below are **read verbatim from the live tree** and are reference material
for the planner — not prescriptions to paste.

### The named-key fence to widen (`src/app/api/strategies/browse/route.ts:233-245`)

```ts
      return {
        id: r.id,
        name: safeLabel,
        codename: r.codename ?? null,
        markets: Array.isArray(r.markets) ? (r.markets as string[]) : [],
        strategy_types: Array.isArray(r.strategy_types)
          ? (r.strategy_types as string[])
          : [],
        // H-0300 fence: explicit named key (NOT a `...row` spread). Coerce to a
        // strict boolean so a NULL/undefined source column never widens the
        // wire shape beyond `boolean`.
        is_example: r.is_example === true,
      };
```

### The strip point (`src/app/(dashboard)/allocations/lib/scenario-state.ts:845-850`)

```ts
const addedStrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  markets: z.array(z.string()),
  strategy_types: z.array(z.string()),
});
```

### The nullish rationale to mirror (`scenario-state.ts:925-932`)

```ts
  // DELIBERATELY NO `.min/.max` range refine — a refine failure on this shared
  // schema routes the codec to the draft-deleting reset (data loss over one
  // out-of-range value). `.nullish()` rather than `.optional()` for the same
  // reason: `JSON.stringify` writes `null` for a NaN, and a bare `z.number()`
  // would REJECT that null → schema_invalid → the user's whole scenario deleted.
  // The [0, 1e12) bound and the null are both resolved on READ by `isValidDollar`
  // at the composer (the sanitize-on-read precedent, sanitizeLeverageMap).
  manualAumUsd: z.number().nullish(),
```

### The em-dash + `title` + `sr-only` pattern to copy (`ScenarioComposer.tsx:5875-5885`)

```tsx
    if (!Number.isFinite(scenarioAum) || scenarioAum <= 0) {
      return (
        <span
          data-testid="scenario-constituent-usd-unset"
          title={AUM_UNSET_REMEDY}
          className="w-24 text-right font-mono text-xs text-text-muted"
        >
          —<span className="sr-only">{AUM_UNSET_REMEDY}</span>
        </span>
      );
    }
```

### The one-open-at-a-time toggle to mirror (`HoldingsTable.tsx:858-868`)

```tsx
                  <tr
                    onClick={() =>
                      setExpandedRowId((prev) =>
                        prev === row.id ? null : row.id,
                      )
                    }
                    aria-expanded={isExpanded}
```

### The badge anatomy to reuse byte-verbatim (`OwnershipTag.tsx:34-48`)

```ts
const ANATOMY =
  "inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium";
// …
  [TEAM_REVIEW]: "bg-badge-other/10 text-text-muted",
```

### The browse secondary-line recipe (`StrategyBrowseDrawer.tsx:560-564`)

```tsx
                      <div className="mt-1 text-xs text-text-muted">
                        {s.codename ?? ""}
                        {s.codename && s.markets.length > 0 ? " · " : ""}
                        {s.markets.join(" · ")}
                      </div>
```

### The 151-06 test block to mirror — **and its vacuity trap** (`scenario-state.test.ts:1054-1121`)

```ts
  const v4Draft = (): ScenarioDraft => ({
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: "fp",
    toggleByScopeRef: { "holding:binance:BTC:spot": true },
    addedStrategies: [],          // ⚠️ EMPTY — a copy-paste for `isOwn` is VACUOUS
    weightOverrides: { "holding:binance:BTC:spot": 1 },
    memberKeyIds: [],
    lastEditedAt: "2026-08-07T00:00:00.000Z",
  });
```

---

## Decisions the Planner Must Make

### D-1 — `key_count`: adopt, or use the spec's absent-branch? (RECOMMEND: absent-branch)

| Option | Cost | Evidence |
|--------|------|----------|
| **A — omit `key_count`; line reads `Created {date} · {Status}`** | Zero extra queries. Two additive columns on the existing SELECT. UI-SPEC's own copy rule already covers it: *"If `key_count` is 0/absent, omit that segment rather than render '0 keys' as a claim"*. | The founder's two "Alpha Centauri" rows were created **2026-08-04** and **2026-07-20** (REQUIREMENTS SCEN-05) — 15 days apart. `created_at` **alone resolves the phase's actual acceptance case.** |
| **B — adopt `key_count`** | A second RLS-scoped query (`strategy_keys.select("strategy_id").in("strategy_id", ownIds)`) on every drawer open, plus co-fetching `api_key_id` into the read-only-never-emitted set (single-key strategies have zero `strategy_keys` rows — `key_count = api_key_id ? 1 : rows[id] ?? 0`). No PostgREST-embed precedent exists in `src/` for a nested `(count)`. | `[VERIFIED: migrations 20260710120000, 20260710180000; grep of src/ for count-embeds]` |

**Recommendation: A.** It satisfies the SC with less surface, is inside UI-SPEC's own
escape hatch, and avoids adding a round-trip to a drawer whose whole design contract is
"single round-trip per activation" (`StrategyBrowseDrawer.tsx:18-23`). If the planner
takes B, note the `!inner` trap: `strategy_keys!inner(count)` on the main select would
**filter out every single-key strategy from Browse entirely**.

### D-2 — Collision scope: `filtered` or the full result? (RECOMMEND: `filtered`)

See Wire Trace D. `filtered` is faithful to UI-SPEC's "tiebreaker, not a metadata dump"
invariant. Pin with a test that narrows the filter to one row and asserts the line is gone.

### D-3 — Notional em-dash copy (RECOMMEND: escalate)

See Pitfall 4. The CONTEXT-pinned sentence ("Set portfolio AUM to size in dollars") is
accurate for the USD cell but **not causally accurate** for the notional cell, whose
em-dash is driven by `totalBookEquity == null` — a different number. Either use a
cause-accurate sentence or get explicit founder acceptance of the shared one.

### D-4 — Chip parity in the browse overlay (planner's call per UI-SPEC)

UI-SPEC Component Contract 1 leaves it open. Note it is **not** a substitute for the
SCEN-05 line (both duplicates are own rows). Recommend **skip it this phase** — Rule 2
(minimum code), and it adds a fifth render site for a chip whose acceptance lives on the
composer row.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Row anatomy anchors from REQUIREMENTS.md (`:5558-5686`, `:5588-5595`, `:5630-5672`, `:2180-2215`) | Post-151 anchors: added rows `:6198-6370`, name span `:6268`, control cluster `:6279-6337`, metadata lookup `:2390-2452` | Phase 151 (waves 01–07, merged) | **Every REQUIREMENTS line number for this phase is stale.** Locate by symbol. |
| Added row = weight, mode, lev, notional (4 columns) | Added row = weight, **USD**, mode, lev, notional (5 columns) + `×` | Phase 151 AUM-01 (`renderDollarInput`, `:5864-5922`, called at `:6297`) | CONTEXT's 4-label header (WEIGHT · MODE · LEV · NOTIONAL) is one label short; UI-SPEC corrects to 5 (`WEIGHT USD MODE LEV NOTIONAL`). |
| Per-key and added rows had identical control anatomy | **Diverged**: per-key rows have no USD input and no `×` button | Phase 151 | A single header above the whole list would drift over per-key rows — the reason UI-SPEC scopes it to the added group. |
| Factsheet 404s for the owner's own unpublished strategy | Two-lane selection resolves it (`factsheet/[id]/v2/page.tsx:414-540`) | Phase 148 / OWN-02 | The "View factsheet" link is viable — within the bound in Pitfall 6. |
| `browse/route.ts` under `api/allocator/` | It is at `src/app/api/strategies/browse/route.ts` | Never moved — CONTEXT/UI-SPEC record a path that has never existed | Correct the path in the plan. |

**Deprecated/outdated:**
- CONTEXT.md and UI-SPEC.md both name `src/app/api/allocator/strategies/browse/route.ts`.
  This path does not exist `[VERIFIED: find]`. The real file is
  `src/app/api/strategies/browse/route.ts` and its tests are
  `src/app/api/strategies/browse/route.test.ts`.
- CONTEXT.md's `SCEN-04` header set of four labels is superseded by UI-SPEC's five.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/test | ✓ | local 25 / CI 22 | — (see Pitfall 8) |
| `vitest` | unit + component tests | ✓ | 4.1.2 | — |
| `@vitest/coverage-v8` | blocking coverage gate | ✓ | 4.1.10 | — |
| `@testing-library/user-event` | Enter/Space acceptance | ✓ | 14.6.1 | `fireEvent.keyDown` (worse — bypasses focus semantics) |
| `@playwright/test` + axe harness | `composer-axe.spec.ts` | ✓ | 1.61.1 | — |
| `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` | axe/e2e seeded specs (self-skip without them) | ✗ locally (CI-provided) | — | Specs self-skip; **a green local run proves nothing** (`composer-axe.spec.ts:22-28` documents this as a deliberate false-green guard) |
| Supabase (TEST project) | not needed — all new tests are unit/component with mocked Supabase (`route.test.ts` STATE harness) | n/a | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** seeded-e2e env vars — CI supplies them; local
verification for this phase is unit/component only.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 + @testing-library/react 16.3.2 (jsdom) |
| Config file | `vitest.config.ts` (carries the blocking coverage thresholds) |
| Quick run command | `npx vitest run <path> --no-file-parallelism` |
| Full suite command | `npm test` (CI: sharded + `--coverage`, merged by the `frontend-coverage` job) |
| Coverage command | `npm run test:coverage` |
| e2e / a11y | `npx playwright test e2e/composer-axe.spec.ts` (self-skips without seed env) |

### Phase Requirements → Test Map

Every row below names an **oracle that is independent of the implementation's own
formula** and a **falsifier** — the mutation that must turn the test red. Per the
`economic_invariant_oracles_not_self_referential` rule, no test may assert a value by
re-running the code under test.

| Req | Behaviour | Type | Automated command | File exists? |
|-----|-----------|------|-------------------|--------------|
| SCEN-02 | Route emits `isOwn: true` for a row whose `user_id === session id`, `false` otherwise | unit | `npx vitest run src/app/api/strategies/browse/route.test.ts -t "isOwn"` | ✅ extend (`route.test.ts`, sibling of `T12f` at `:674`) |
| SCEN-02 | **Fence, third-party arm:** key set is exactly the 7 base keys — no `created_at`/`status`/`key_count` | unit | same file, `-t "H-0300"` | ✅ extend `H-0300a` (`:731`) into two arms — **must not be relaxed** |
| SCEN-02 | **Fence, own arm:** key set is exactly base + owner fields; another owner's `created_at` appears nowhere in the payload | unit | same | ✅ extend (mirror the `H-0300b:789-791` whole-payload sweep) |
| SCEN-02 | **Strip-guard (nested):** a draft with a NON-EMPTY `addedStrategies` carrying `isOwn` survives `scenarioDraftSchema` AND `scenarioDraftSaveSchema` | unit | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-state.test.ts" -t "isOwn"` | ✅ extend (mirror `:1102`, **with a populated array**) |
| SCEN-02 | **Backward decode:** a v4 blob whose `addedStrategies[0]` has NO `isOwn` decodes `outcome === "ok"` and preserves `weightOverrides` | unit | same | ✅ extend (mirror `:1065`) |
| SCEN-02 | **Null tolerance:** `isOwn: null` (what `JSON.stringify` can produce) decodes `ok`, never `reset` | unit | same | ✅ extend (mirror `:1085`) |
| SCEN-02 | **Version discipline:** `SCENARIO_SCHEMA_VERSION` is still 4 | unit | same | ✅ exists at `:1123` — assert it still holds |
| SCEN-02 | Chip renders iff `isOwn === true`; absent/`false`/`null` → **no chip node at all** | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" -t "Yours" --no-file-parallelism` | ✅ extend |
| SCEN-02 | **All three add seams** carry `isOwn` from the drawer payload to the draft (empty-state mount, main-body mount) and the Bridge seam leaves it absent | component | same | ✅ extend — must mount BOTH branches |
| SCEN-03 | Clicking the strategy-name button expands the detail; clicking it again collapses | component | same, `-t "detail"` | ✅ extend |
| SCEN-03 | **Enter and Space on the focused strategy-name button** toggle the detail (`user-event`, `.tab()`+`.keyboard()`) | component | same | ✅ extend — phrase per UI-SPEC's binding rule |
| SCEN-03 | **One-open-at-a-time:** opening row B closes row A | component | same | ✅ extend |
| SCEN-03 | A click on the weight input / dollar input / mode toggle / leverage input / remove button does **not** toggle the detail | component | same | ✅ extend — one assertion per control |
| SCEN-03 | Book strategy → CAGR/Sharpe render; drawer-added (both null) → the metrics-absent note, **no fabricated 0.00** | component | same | ✅ extend |
| SCEN-03 | `href` is exactly `/factsheet/{id}` | component | same | ✅ extend |
| SCEN-04 | Header renders iff ≥1 added strategy; hidden with zero | component | same, `-t "header"` | ✅ extend |
| SCEN-04 | Header renders **exactly once** even with N added rows | component | same | ✅ extend |
| SCEN-04 | Header carries `aria-hidden="true"` and its label text is absent from the accessible tree | component | same | ✅ extend |
| SCEN-04 | Non-derivable notional (`totalBookEquity == null`) → `—` + remedy `title` + an `sr-only` node with the same sentence | component | same | ✅ extend |
| SCEN-04 | Derived notional keeps its **original** `title` verbatim (no regression on the derived branch) | component | same | ✅ extend — this is the falsifier for "changed the wrong branch" |
| SCEN-05 | Route emits `created_at` + `status` on own rows only | unit | `npx vitest run src/app/api/strategies/browse/route.test.ts` | ✅ extend |
| SCEN-05 | Two own rows with names differing only by case/whitespace both get the line | component | `npx vitest run "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx" -t "duplicate"` | ✅ extend |
| SCEN-05 | A single own row with a unique name gets **no** line | component | same | ✅ extend |
| SCEN-05 | Two **third-party** rows with identical labels get **no** line | component | same | ✅ extend |
| SCEN-05 | A filter that narrows a collision set to one row **removes** the line (D-2) | component | same | ✅ extend |
| SCEN-05 | The testid is `browse-dedup-{id}` — outside the `browse-add-` namespace | component | same | ✅ extend (PR #620 automation-contract lesson, `StrategyBrowseDrawer.tsx:594-604`) |
| all | Zero WCAG-AA violations on the composed composer surface | e2e (CI) | `npx playwright test e2e/composer-axe.spec.ts` | ✅ exists — CI-wired at `ci.yml:1780` |

### Falsifiers (the mutation each SC's test must catch)

| SC | Falsifier — apply it, the named test must go RED |
|----|--------------------------------------------------|
| SCEN-02 wire | Delete `isOwn` from `addedStrategySchema` (leave it on the TS interface). Strip-guard must fail. **If it stays green, the fixture's `addedStrategies` is empty — Pitfall 1.** |
| SCEN-02 wire | Change `isOwn: z.boolean().nullish()` → `z.boolean()`. The null-tolerance test must fail with `outcome !== "ok"`. |
| SCEN-02 wire | Emit `created_at` unconditionally (drop the `isOwnRow` guard). The third-party fence arm must fail. |
| SCEN-02 render | Change the render gate to `isOwn !== false`. The `undefined`-legacy-draft test must fail (a legacy draft must render no chip). |
| SCEN-02 seams | Revert the `isOwn` mapping in the **empty-state** drawer only (`:4074`). A seam test must fail. |
| SCEN-03 | Remove `aria-expanded`/`type="button"` and revert the name to a `<span>`. The Enter/Space test must fail. |
| SCEN-03 | Remove the `stopPropagation` wrapper. The per-control non-toggle assertions must fail. |
| SCEN-03 | Change `expandedId` from `string \| null` to a `Set`. The one-open-at-a-time test must fail. |
| SCEN-03 | Render `formatPercent(0)` instead of the metrics-absent note when both metrics are null. The no-fabricated-metric test must fail. |
| SCEN-04 | Move the header outside the `addedStrategies.length > 0` guard. The zero-strategies test must fail. |
| SCEN-04 | Apply the remedy `title` to the **derived** notional branch too. The derived-title-verbatim test must fail. |
| SCEN-04 | Drop the `sr-only` span, keep the `title`. The sr-only assertion must fail (a `title` alone is unreachable — `:5870-5874`). |
| SCEN-05 | Drop the `isOwn` gate on collision detection. The two-third-party-rows test must fail. |
| SCEN-05 | Compare raw `name` without `trim().toLowerCase()`. The case/whitespace-variant test must fail. |
| SCEN-05 | Rename the testid to `browse-add-dedup-{id}`. The namespace test must fail. |

### Sampling Rate

- **Per task commit:** `npx vitest run <the file(s) that task touched> --no-file-parallelism`
- **Per wave merge:** `npm test` + `npm run typecheck` + `npm run lint`
- **Phase gate:** `npm run test:coverage` green against the blocking thresholds
  (lines 82 / statements 80 / functions 74 / branches 72) **before** `/gsd:verify-work`.
  New absence-branches (no chip / collapsed detail / metrics-absent / no dedup line)
  must each be exercised or branch coverage can dip.

### Wave 0 Gaps

**None — existing test infrastructure covers all phase requirements.** All five target
files exist and are already the canonical pins:

- `src/app/api/strategies/browse/route.test.ts` (923 lines, 28 tests) — owns the wire
  fence
- `src/app/(dashboard)/allocations/lib/scenario-state.test.ts` (1,184 lines, 82 tests) —
  owns the codec/schema contract, with the 151-06 block at `:1052-1125` as the template
- `src/app/(dashboard)/allocations/lib/scenario-state.localStorage.test.ts` (321 lines,
  15 tests) — owns round-trip behaviour
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (12,234 lines,
  265 tests) — owns row render
- `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx` (733 lines,
  29 tests) — owns drawer render

No new framework, no new config, no new fixtures module required. **Every new test is an
extension of an existing describe block.**

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard control |
|---------------|---------|------------------|
| V2 Authentication | no (unchanged) | `withAllocatorAuth` already gates the route; this phase adds no auth surface |
| V3 Session Management | no (unchanged) | session id stays server-only (`user.id` from `withAllocatorAuth`, never a request param — T-110-05/07) |
| **V4 Access Control** | **yes — the core risk** | Two layers preserved: query-builder isolation via `withPublishedOrOwner` (`visibility.ts`) **and** the `strategies_read` RLS backstop. The new owner-scoped fields must be emitted **only when `isOwnRow`**; the `strategy_keys` read (if D-1 option B) is additionally gated by `strategy_keys_owner … USING (owner_id = auth.uid())`. |
| V5 Input Validation | yes | `scenarioDraftSchema` / `scenarioDraftSaveSchema` validate the persisted blob; `isOwn: z.boolean().nullish()` is the additive declaration. Deliberately **no refine** — a refine failure here is a draft-deleting reset (a self-inflicted availability defect), so range/shape sanity lives on READ. |
| V6 Cryptography | no | none touched |
| V7 Error Handling / Logging | yes (unchanged) | the route already redacts the raw Postgres `error.message` and captures to Sentry (`route.ts:164-174`); do not add a new error path that forwards raw DB detail |

### Known Threat Patterns for this surface

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| **Pseudonymity break** — cross-correlating a real strategy name back to its codename via the drawer search | Information Disclosure | `displayStrategyName` on every non-own row (`route.ts:225-232`). ⚠️ The disambiguation line must **never** render on third-party rows: `created_at` + `status` on a pseudonymised row is a correlation vector. |
| **Owner-metadata leak on third-party rows** | Information Disclosure | The H-0300 named-key fence, extended with two exhaustive arms (Pitfall 7). Never `{ ...row }`. |
| **Service-role RLS bypass** | Elevation of Privilege | The route's own comment (`:126-133`): the owner-OR must stay on the **user-scoped** `createClient()`; `service_role` has `BYPASSRLS` and would leak every user's private rows. Any new query added for `key_count` must use the same user-scoped client. |
| **Persisted-blob poisoning / DoS** | Denial of Service | Existing `MAX_DRAFT_RECORD_ENTRIES` (2000), `addedStrategies.max(200)`, `MAX_DRAFT_BODY_BYTES` (256,000) at the route. A `boolean` field adds ~12 bytes/entry — no cap change needed. |
| **Draft-deleting reset via schema strictness** | Denial of Service (self-inflicted) | `.nullish()`, no refine, no version bump. Documented at `scenario-state.ts:925-932`. |
| **UI spoofing via a badge fallback** | Spoofing | Do not route the chip through `Badge` — `Badge.tsx:55` falls back to the DRAFT entry for an unrecognised label (threat T-150-08). Do not widen `OwnershipTag`'s closed switch. |
| **Automation-contract collision** | Tampering (test integrity) | `data-testid="browse-dedup-{id}"` must stay outside the `browse-add-` namespace — a `[data-testid^="browse-add-"]` first-match locator binding to a non-add element is the PR #620 regression (`StrategyBrowseDrawer.tsx:594-604`). |
| **Repo is PUBLIC and `.planning/` is tracked** | Information Disclosure | This document and every plan are world-readable on push. Nothing here contains a secret, a PROD id, or a credential — verify the same before pushing plans. |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | The founder's two "Alpha Centauri" rows are 15 days apart, so `created_at` alone disambiguates them | Decision D-1 | If the founder has (or later creates) same-day duplicates, `created_at` alone stops disambiguating and `key_count` (or a venue/id segment) becomes necessary. Source is REQUIREMENTS.md SCEN-05, not a live PROD query — **not verified against the database this session**. |
| A2 | Bridge-added candidates are never the viewer's own strategies | Pitfall 2 | If a Bridge match candidate could be the viewer's own, leaving `isOwn` absent under-marks it. Derived from the match-engine's purpose, not verified against `match_candidates` data. |
| A3 | `jsx-a11y/click-events-have-key-events` and `no-noninteractive-element-interactions` are not enabled by `eslint-config-next` | Project Constraints | If enabled, the row-`<li>` `onClick` fails lint and needs an eslint-disable or a structural change. Inferred from the absence of an explicit `jsx-a11y` dependency and no rule entry in `eslint.config.mjs`; **not verified by running `npm run lint` on a modified file.** Cheap to check: add the handler and run `npm run lint`. |
| A4 | `toLocaleDateString("en-US", {month:"short",…})` on a timestamptz renders in the viewer's local timezone and can shift the day | Wire Trace D | If the assertion is wrong the timezone caveat is unnecessary. Standard JS `Date` semantics; not measured in this repo's jsdom config. |
| A5 | No PostgREST nested-`(count)` embed exists anywhere in `src/` | Decision D-1 | If one exists and I missed it, option B is cheaper than stated. Based on a grep for `select("...(count)` patterns. |
| A6 | The `composer-axe` e2e will scan the new elements without spec changes | Environment / Validation | It scans the whole composed `<main>` in one `analyze()` (`composer-axe.spec.ts:38-45`), so new DOM is covered — but it drives the composer via Browse-add, so a *collapsed* detail panel is what gets scanned. An axe pass does **not** prove the expanded panel is clean. Consider an explicit expand step, or accept the gap and say so. |
| A7 | Emitting `isOwn: false` on third-party rows is not a disclosure widening | Wire Trace A | It reveals a viewer↔row relationship the viewer already knows. If a reviewer disagrees, make `isOwn` own-rows-only and optional — the render rule (`=== true`) is unaffected. |

---

## Open Questions (RESOLVED)

All three resolved at planning (2026-08-07) — one-line resolutions, owning
artifacts pointed:

1. → RESOLVED: yes — D-3 in `152-03-PLAN.md` pins the cause-accurate sentence
   ("Notional needs live book equity — not derivable in this scenario"); the
   CONTEXT AUM sentence stays on the USD cell.
2. → RESOLVED: yes — `152-06-PLAN.md` Task 2 expands the panel before
   `analyze()` in `composer-axe.spec.ts`.
3. → RESOLVED: no — `152-VALIDATION.md` Wave 0 grep closed it at planning
   (zero `.strict()` schemas; the wire add cannot 400).

Original questions as researched:

1. **Does the notional em-dash deserve its own remedy sentence?** (D-3)
   - What we know: the USD cell's em-dash is caused by `scenarioAum <= 0`; the notional
     cell's is caused by `totalBookEquity == null` or a missing blend share
     (`:5787-5792`). They are different numbers with different remedies (`:5692-5698`
     documents the distinction explicitly).
   - What's unclear: CONTEXT pinned one sentence and UI-SPEC repeated it.
   - Recommendation: raise it in planning. Shipping *"Set portfolio AUM to size in
     dollars"* on a cell that will still show `—` after the user sets an AUM is a
     dishonest-remedy finding waiting to happen — exactly the class the phase exists to
     fix. If the founder wants the pinned copy, record the acceptance explicitly so
     review does not re-open it.

2. **Should the axe e2e be extended to scan the EXPANDED detail panel?** (A6)
   - What we know: `composer-axe.spec.ts` performs one `analyze()` over the composed
     `<main>` after a Browse-add, with anti-false-green visible-anchor gates.
   - What's unclear: whether adding an expand step is in scope, or whether the
     component-level a11y assertions (`aria-expanded`, `aria-controls`,
     `aria-hidden` on the header) suffice.
   - Recommendation: add one line to the spec's composed-surface arm (click the name
     button before `analyze()`); it is a two-line change to a spec that already exists
     and is CI-wired, and the panel is the phase's only new interactive surface.

3. **Does anything read `scenarios.draft.addedStrategies[]` server-side and assume a
   closed shape?**
   - What we know: the save routes persist `parsed.data.draft` wholesale; the commit
     route has its own schema.
   - What's unclear: whether any analytics/worker path parses `addedStrategies` with a
     strict schema that would now reject `isOwn`. Not exhaustively traced this session.
   - Recommendation: the planner should grep `addedStrategies` across `src/app/api/**`
     and `analytics-service/**` in Wave 0 before landing the wire. Low expected risk
     (`z.object` strips rather than rejects), but a `.strict()` schema anywhere would
     turn this into a 400.

---

## Sources

### Primary (HIGH confidence) — read directly this session

- `src/app/api/strategies/browse/route.ts` (whole file, 256 lines) — wire fence,
  `isOwnRow`, `withPublishedOrOwner` usage, service-role rationale
- `src/app/api/strategies/browse/route.test.ts:207-810` — the H-0300 fence tests,
  T12f own-row naming test
- `src/app/(dashboard)/allocations/lib/scenario-state.ts:55-180, 440-570, 835-1000` —
  `AddedStrategy`, add mutators, `addedStrategySchema`, `scenarioDraftSchema`,
  `scenarioDraftSaveSchema`, codec version trichotomy
- `src/app/(dashboard)/allocations/lib/scenario-state.test.ts:1040-1125` — the 151-06
  `manualAumUsd` test block (the template, and its vacuity trap)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `:121` imports,
  `:1420-1530` lazy returns fetch, `:2280-2330` add seam, `:2390-2472` metadata lookup
  + provenance, `:4060-4095` + `:5405-5470` drawer/bridge mounts, `:5280-5301`
  `CompositionList` call site, `:5674-5740` props interface, `:5779-6037` notional /
  dollar / mode / target / solve renderers, `:6040-6389` the row list
- `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` (whole file,
  642 lines) — row shape, fetch contract, filter memo, secondary line, testid namespace
- `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:440-530, 730-990` —
  expansion mechanics
- `src/app/(dashboard)/allocations/components/HoldingDetail.tsx:1-80` — host contract
- `src/components/strategy/OwnershipTag.tsx` (whole file, 59 lines) — anatomy + closed
  switch rationale
- `src/components/strategy/TrustTierLabel.tsx:1-60` — null-renders-nothing contract
- `src/lib/utils.ts:3-30` — `formatPercent`, `formatNumber`, `formatCurrency`
- `src/lib/visibility.ts:1-80` — `withPublishedOrOwner` provenance
- `src/lib/types.ts` `Strategy` interface — `created_at`, `status`, `api_key_id`
- `src/app/factsheet/[id]/page.tsx`, `src/app/factsheet/[id]/v2/page.tsx:1-540` —
  OWN-02 two-lane selection
- `src/components/strategy/StrategyTable.tsx:965-985` — the `/factsheet/${id}` convention
- `supabase/migrations/20260710120000_strategy_keys.sql:115-135` — `strategy_keys` RLS
- `supabase/migrations/20260710180000_wizard_composite.sql:1-60` — composite membership model
- `src/app/globals.css:87, 142, 164-165` — `--color-badge-other`, `--text-caption`,
  `--text-fixed-10/11`
- `eslint.config.mjs:18-296` — `no-raw-font-px`, `no-raw-published-predicate`, CONTRIB-04
- `DESIGN.md:39-90` — three-voice typography, tracking ladder
- `e2e/composer-axe.spec.ts:1-60` — a11y gate scope + self-skip semantics
- `.github/workflows/ci.yml:1780` — composer-axe CI wiring
- `package.json` — versions + scripts
- `.planning/phases/152-scen-composer-legibility/152-CONTEXT.md`, `152-UI-SPEC.md`
- `.planning/REQUIREMENTS.md` SCEN-02..05, `.planning/STATE.md`, `CLAUDE.md`, `AGENTS.md`

### Secondary (MEDIUM confidence)

- Phase 151 artifact directory `.planning/phases/151-aum-a-book-you-can-reach-and-a-size-you-can-set/`
  (existence + wave list confirmed; SUMMARYs not read in full — the live code was read
  instead, which is stronger)
- `git log --oneline -15` — confirms 151 landed with its WR fix commits before 152 planning

### Tertiary (LOW confidence)

- None. No WebSearch, no Context7, no external documentation was needed or used: this
  phase introduces no library, and every claim is a property of this repository.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — no new packages; existing versions read from `package.json`
- Architecture / wire traces: **HIGH** — every anchor read from the live post-151 tree
  and quoted verbatim
- Pitfalls: **HIGH** — 6 of 8 are derived from load-bearing comments the codebase wrote
  about itself after being bitten (`scenario-state.ts:912`, `:922`; `route.test.ts:720`;
  `ScenarioComposer.tsx:5870`; `StrategyBrowseDrawer.tsx:594`; `OwnershipTag.tsx:19`)
- Decision D-1 (`key_count`): **MEDIUM** — the recommendation rests on A1 (creation
  dates sourced from REQUIREMENTS.md, not re-verified against PROD)
- Security: **HIGH** — the fence and RLS layers were read directly, including the
  service-role rationale
- Validation architecture: **HIGH** — all five target test files exist and were sized;
  every falsifier names a concrete mutation against a concrete line

**Research date:** 2026-08-07
**Valid until:** 2026-09-06 for the framework/version facts. ⚠️ **The line anchors are
valid only against `feat/v1.17-151-aum` @ `472117a8`.** `ScenarioComposer.tsx` is 6,467
lines and moves under every phase that touches it — if any further work lands on this
file before 152 executes, re-locate by symbol (`renderDollarInput`, `notionalText`,
`Strategies added ·`, `addedStrategyMetadataLookup`, `<CompositionList`) rather than by
line number.
