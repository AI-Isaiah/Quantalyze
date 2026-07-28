# Phase 66: Carry-Forward Burn-Down - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 9 modified + 1 new (sweep artifact) + 1 new test fixture
**Analogs found:** 11 / 11 (this is a burn-down phase — every change has an in-repo sibling idiom)

## Orientation

This is a **modification-heavy debt burn-down**, not greenfield creation. There are almost no "new file" analogs to find — instead, each edit must **match the idiom already living in the file it touches** (CLAUDE.md Rule 11: conformance > taste). The "analog" for most rows below is therefore a **sibling pattern in the same file** (e.g. the composer already has a key→label lookup; the gantt fix reuses it) or a **peer file of the same class** (e.g. the F-4 SQL fixture copies an existing `supabase/tests/test_*.sql`; the F-4 sweep copies `scripts/backfill_funding.py`).

Two genuinely-new artifacts:
- **F-4 sweep** (one-off script OR pure-SQL-via-MCP) — analog: `scripts/backfill_funding.py` (one-shot, idempotent, SELECT-before-mutate).
- **F-4 detection/re-derive test fixture** — analog: `supabase/tests/test_scenarios_rls.sql` (plain PL/pgSQL `DO $$` blocks, no pgTAP).

## File Classification

| File (change) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/api/allocator/scenario/share/route.ts` (CF-01 delete disjunct + comment) | route handler | request-response | same-file gate idiom + `share-resolve.ts` book-only counterpart | exact (in-file) |
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` (CF-02 raise cap, named const) | validation (zod schema) | transform/validate | same-file `MAX_DRAFT_RECORD_ENTRIES` / `MAX_DRAFT_KEY_LENGTH` const idiom | exact (in-file) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (CF-02 honest error map ×4 sites) | client component | request-response (fetch) | same-file `postNewScenario`/`putUpdateScenario` + `dataSourceLabel` helper idiom | exact (in-file) |
| `src/lib/queries.ts` (CF-04 delete `holdingReturnsByScopeRef` producer/type/callsites) | SSR data producer | request-response (RSC payload) | same-file `holdingsSummary` producer (KEEP) — mirror-but-inverse; the dead-field is self-analog | exact (in-file) |
| F-4 sweep script/SQL (CF-03, NEW) | one-off script / DB op | batch / file-I/O | `scripts/backfill_funding.py` (one-shot idempotent backfill) | role-match |
| F-4 detection+re-derive test (CF-03, NEW) | test (SQL fixture) | transform | `supabase/tests/test_scenarios_rls.sql` | role-match |
| prod `auth.users` residue DELETE (CF-05) | DB op (MCP) | batch delete | MEMORY prod-cleanup recipe (SELECT-before-DELETE) + `test_scenarios_rls.sql` FK notes | role-match |
| `src/app/(dashboard)/allocations/components/CoverageTimeline.tsx` + composer row-build (CF-05 friendly labels) | client component | transform (props) | same-file composer `dataSourceLabel` (`ScenarioComposer.tsx:638`) key→label idiom | exact (in-file) |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx:964` (CF-05 replace double-cast) | client component | transform (props narrow) | same-file explicit-prop-pass idiom (lines 945-958, sibling mounts pass named props) | exact (in-file) |
| `TODOS.md` (CF-06 triage) | docs | verification | delete-closed-immediately rule (MEMORY) | policy-match |
| Regression tests (all CF) | test | unit / RTL | existing `route.test.ts` `T_SH15`, `ScenarioComposer.save.test.tsx` `T_SAVE9`, `scenario-state.test.ts` | exact (extend) |

## Pattern Assignments

### CF-01 — `share/route.ts` dead `isBookOnlyDraft` disjunct (route handler, request-response)

**Analog:** same-file gate (VERIFIED `route.ts:200-213`). The disjunct is provably dead: when `addedStrategies.length === 0`, `nothingShareable` is already `true` and short-circuits the `||`; when `> 0`, `isBookOnlyDraft` returns `false`. It can never flip the branch.

**The gate (delete the `||` disjunct at line 203):**
```ts
const draft = (ownedScenario as { draft?: ScenarioDraft | null }).draft ?? null;
const draftAdded = draft?.addedStrategies;
const nothingShareable = !Array.isArray(draftAdded) || draftAdded.length === 0;
if (nothingShareable || isBookOnlyDraft(draft as ScenarioDraft)) {   // ← drop `|| isBookOnlyDraft(...)`
  return NextResponse.json({ error: "Nothing shareable", code: "book_only_draft", ... }, { status: 409, ... });
}
```

**Comment to correct (`route.ts:191-199`)** — the overstated "MEMBER-03 — ONE definition of book-only ... the gate reads the SAME null-safe `isBookOnlyDraft` predicate" block. After deletion the gate keys purely on `addedStrategies` (via `nothingShareable`). Rewrite to the honest single source: **book-only ⇔ zero added strategies**. Keep the accurate `share-resolve.ts` counterpart note (that surface keys on `strategies.length === 0`, not `memberKeyIds`).

**Also delete:** the `isBookOnlyDraft` import at `route.ts:58` (grep confirms line 203 is its only real use in the file).

**Orphaned-function decision:** after deletion, `isBookOnlyDraft` (`scenario-state.ts:684-689`) loses its only non-test caller → dead code. Per the CLAUDE.md dead-code rule, delete the function + its `scenario-state.test.ts:778-809` block in the same pass (comment-only references in `share-resolve.ts:210/222/287` are prose, not calls). Re-grep before deleting.

**Regression test (extend `route.test.ts`, `T_SH15` at :395 is the sibling):** prove a draft with `memberKeyIds` set AND `addedStrategies: []` still 409s via the surviving `nothingShareable` disjunct alone — test must fail if the `nothingShareable` block is removed.
**Retire:** `route.test.ts:354` `expect(routeSrc).toContain("isBookOnlyDraft")` — a source-string assertion that breaks on deletion (not a regression; repoint/retire same commit).

---

### CF-02 — `scenario-state.ts` raise `.max(64)` cap (zod validation, transform)

**Analog:** same-file DoS-cap const idiom (VERIFIED `scenario-state.ts:739-747`). The file already extracts named caps with a self-documenting comment:
```ts
const MAX_DRAFT_RECORD_ENTRIES = 2000;
const MAX_DRAFT_KEY_LENGTH = 512;
```
**Apply the same idiom:** extract `const MAX_MEMBER_KEY_IDS = 1000;` (research-recommended; ~36KB well under `MAX_DRAFT_BODY_BYTES = 256_000`) and replace the inline `.max(64)` at `:793`:
```ts
// before (:793)
memberKeyIds: z.array(z.string().max(MAX_DRAFT_KEY_LENGTH)).max(64).optional(),
// after
memberKeyIds: z.array(z.string().max(MAX_DRAFT_KEY_LENGTH)).max(MAX_MEMBER_KEY_IDS).optional(),
```
Update the `T-62-02 DoS: ≤64 ids` comment at `:791` to name the new bound. Keep the per-id `.max(MAX_DRAFT_KEY_LENGTH)` and route-level `MAX_DRAFT_BODY_BYTES` — those remain the real DoS guards (do NOT remove; fail-loud, do NOT silently clamp the stamp).

**Regression test (extend `scenario-state.test.ts`):** >64 ids up to `MAX_MEMBER_KEY_IDS` accepted; above it rejected.

### CF-02 — `ScenarioComposer.tsx` honest over-cap error (client component, request-response)

**Analog A — the four generic-copy sites (VERIFIED `ScenarioComposer.tsx:1571-1626`):** `postNewScenario` (:1573, :1590) and `putUpdateScenario` (:1617, :1625) both set the same misleading string on `!res.ok` and in `catch`:
```ts
if (!res.ok) {
  setSaveError("Couldn't save this portfolio. Check your connection and try again.");
  return;
}
```
**Analog B — the shared-helper idiom already in this file:** `dataSourceLabel(k)` (`:632-648`) is the file's established "one small pure helper reused across sites" pattern. Mirror it: add one `saveErrorMessage(res, issues?) → string` helper that maps `res.status === 400` + the `memberKeyIds`/`too_big` zod issue → honest ceiling copy, else returns the generic string. Reuse at all four sites (Don't-Hand-Roll: no inline per-site string logic ×4).

The over-cap path is a **400** (`SaveScenarioBodySchema.safeParse` fail → `saved/route.ts:102-106` `{ error: "Invalid request body", issues }`), currently swallowed by the generic `!res.ok` branch. Distinguish on `res.status === 400` and (optionally) the parsed `issues`.

**Regression test (extend `ScenarioComposer.save.test.tsx`, `T_SAVE9` at :574 pins the 500 generic copy):** a 400 with a `memberKeyIds`/`too_big` issue renders the honest ceiling copy, NOT the generic connection message. Must fail against current code.

---

### CF-04 — `queries.ts` remove `holdingReturnsByScopeRef` (SSR producer, request-response)

**⚠️ SCOPE CORRECTION (RISK-1):** delete `holdingReturnsByScopeRef` ONLY. `holdingsSummary` is LIVE (Holdings tab, mandate AUM gates, composer seeding, drift ref) — do NOT touch it; record "already-satisfied by v1.6 phase-63 engine-input removal" in the SUMMARY.

**Analog:** the dead field is its own inverse-analog — `holdingsSummary`'s producer/type/payload wiring in the same file shows exactly the shape being removed, and the surviving `holdingsSummary` sites are the "keep untouched" reference that the full-suite-green gate protects.

**Deletion touch-list (VERIFIED, non-test):**
| File | Line | What |
|---|---|---|
| `src/lib/queries.ts` | 2037 | `reconstructHoldingReturnsByScopeRef` fn def — DELETE |
| `src/lib/queries.ts` | 1734 | payload TYPE field `holdingReturnsByScopeRef: Record<string, DailyPoint[]>` — DELETE |
| `src/lib/queries.ts` | 2998 | the `const holdingReturnsByScopeRef = reconstruct...(...)` call — DELETE |
| `src/lib/queries.ts` | 3013 | explanatory comment — DELETE/reword |
| `src/lib/queries.ts` | 3107, 3417 | two payload-construction `holdingReturnsByScopeRef,` — DELETE |
| `src/lib/queries.ts` | 2462, 2840 | prose comment refs — reword (doc-only) |

**Test sites — mechanical field removal** (stub payloads carrying `holdingReturnsByScopeRef: {}`): `AllocationsTabs.test.tsx:143`, `AllocationsTabs.onboarding.test.tsx:112`, `AllocationsTabs.scenario-state-preservation.test.tsx:203`, `ScenarioComposer.test.tsx` (×9: 453,535,1577,1777,2054,2293,2338,2876,4955), `ScenarioComposer.save.test.tsx:208`, `ScenarioComparePanel.test.tsx:120`.
**Active assertions to RETIRE/repoint:** `AllocationsTabs.scenario-composer.test.tsx` T_AT3 (:308-321); `queries.my-allocation.test.ts:2117-2141` (drop the dead-field axis, keep `liveBaselineMetrics` byte-identity); `getMyAllocationDashboard.scenario.test.ts:301`.
**Gate:** full vitest suite green + coverage thresholds hold (remove code AND its tests together = coverage-neutral; watch functions/branches ratchet 74/72). Run `npm run test:coverage` locally with `--no-file-parallelism`.

---

### CF-03 — F-4 deploy-skew re-stamp sweep (one-off script/DB, batch)

**Analog A — sweep shape:** `scripts/backfill_funding.py` — the repo's canonical **one-shot, idempotent, SELECT-before-mutate** backfill (header: "One-shot backfill script ... re-runs are idempotent ... Requires SUPABASE_URL, SUPABASE_SERVICE_KEY"). Research recommends **pure-SQL-via-Supabase-MCP** instead (deploy window past, one-off, self-contained) — either shape must keep the backfill script's contract: detection-first SELECT, idempotent UPDATE, before/after evidence.

**Detection discriminator (recommended, verify vs a known-genuine prod row first — Assumption A1):**
```sql
SELECT id, allocator_id, schema_version, updated_at
FROM scenarios
WHERE schema_version >= 4
  AND NOT (draft ? 'memberKeyIds');   -- JSONB key-presence: a genuine v4 write ALWAYS carries the key
```

**Re-derivation — mirror the runtime reopen path (VERIFIED `ScenarioComparePanel.tsx:252-261`):**
```ts
const normalized = draft.memberKeyIds === undefined
  ? setMemberKeyIds(draft, deriveMembershipFromGate(
      payload.perKeyDailiesGateSatisfied ?? false, payload.eligibleApiKeyIds ?? []))
  : draft;
```
`deriveMembershipFromGate` (`scenario-state.ts:670-675`) = `gate ? [...eligibleApiKeyIds] : []`. The sweep replicates this server-side per allocator (eligible = `api_keys` active ∧ not-revoked ∧ not-disconnected; gate = per-key `csv_daily_returns` presence — exactly `getMyAllocationDashboard`'s inputs; Pitfall 3). Detection-first: a 0-row result is a valid evidence-recorded outcome (prod grounding: 0 gate=false real users).

**Analog B — test fixture:** `supabase/tests/test_scenarios_rls.sql` — the SQL-fixture convention (plain PL/pgSQL `DO $$ ... $$` with `RAISE EXCEPTION` on fail / `RAISE NOTICE` on pass; NO pgTAP; NO psql meta-commands; filename `test_*.sql` auto-discovered by ci.yml `sql-tests`). Copy this scaffold for `supabase/tests/test_scenario_downgrade_sweep.sql`: seed a downgraded-shape row + a genuine-v4 row, assert the discriminator flags exactly the downgraded one and the re-derive stamps correct ids. (Per DB-test CI wiring: SQL gates MUST be `supabase/tests/test_*.sql`, not `*_live.py`.)

---

### CF-05 — planning-ledger smalls

**Prod `auth.users` residue DELETE (DB op, batch):** analog is the MEMORY prod-cleanup recipe + the FK-cascade notes in `test_scenarios_rls.sql`. `SELECT id, email, created_at FROM auth.users WHERE email LIKE 'phase10-rpc-%@test.local'`, confirm exact pattern + count (docs disagree 6 vs 2 — Assumption A2; do NOT hard-code), verify non-real, then DELETE (cascades via `scenarios.allocator_id REFERENCES profiles ON DELETE CASCADE` etc.). Prod project `khslejtfbuezsmvmtsdn`; before/after evidence in SUMMARY. Execution-time only — no prod queries during planning.

**Gantt friendly key labels (`CoverageTimeline.tsx` + composer row-build, transform):**
- **Analog — same-file composer key→label idiom (VERIFIED `ScenarioComposer.tsx:632-648`):**
```ts
function dataSourceLabel(k: { exchange: string; label: string; id: string }) {
  const exchange = EXCHANGE_LABELS[k.exchange.toLowerCase()] ?? k.exchange;
  const nick = k.label?.trim();
  ...
}
```
  and the eligible-keys memo at `:1912-1918` (`(payload.apiKeys ?? []).filter(k => eligible.includes(k.id))`).
- The gantt row-build (`ScenarioComposer.tsx:2344-2355`) maps `engineSet.strategies → { id, name, span, inBlend }`; `CoverageTimeline.tsx:33-40` renders `row.name` as `title`/text/`aria-label`. For per-key/book-member rows the `name` is a raw id — map it through the same `dataSourceLabel`/`payload.apiKeys` lookup so a friendly exchange/account label renders instead of a UUID. **DESIGN.md check required** (visual/label change — reuse existing tokens). Regression: assert a per-key row renders the friendly label, not the raw id (`CoverageTimeline.test.tsx`).

**`AllocationsTabs.tsx:964` double-cast (transform, props narrow):**
- **Analog — sibling explicit-prop mounts in the same render (VERIFIED `AllocationsTabs.tsx:945-958`):** `ScenarioComposer` and `SavedScenariosList` are mounted passing explicitly-named props. The `ScenarioComparePanel` mount breaks the pattern with `payload={props as unknown as ScenarioComparePanelProps["payload"]}`. Replace with an explicit structural narrow — construct the panel payload from the `props` fields `ScenarioComparePanelProps["payload"]` requires (compile-time checked, no cast; Don't-Hand-Roll: no new zod schema — data is server-trusted SSR props). Enforced by `tsc`.

**D3 source-toggle persistence (docs-only):** DECIDED no-persistence (YAGNI). The D3 toggle is transient UI state near `ScenarioComposer.tsx:1790` (Phase-36 D3). No standalone TODOS entry — record the decision in the phase SUMMARY (and optionally a code comment at the toggle).

---

### CF-06 — TODOS.md triage (docs, verification)

**Policy analog:** delete-closed-immediately (MEMORY) — verify each entry against live code, DELETE stale/done same-pass (no strike-through graveyard), every survivor re-verified with file/symbol evidence. Quick-wins fixed in-phase with a regression test: `99+` flagged-count badge cap, stale `DesktopGate` comment rot (`for-quants-lead/route.ts` ~167/182/391), plus any small/decision-free/test-coverable entry. Remove the v1.6 F-3/F-4/F-5 section once CF-01..03 land. KEEP the live P2 `holdingsSummary` symbol-only dedup bug (`queries.ts:1779` — verify still `.set(r.symbol, r)`). Phase 19.1 P1 Plans 07-10: VERIFY whether still live, do NOT execute. Full pre-classification inventory in `66-RESEARCH.md` §CF-06.

## Shared Patterns

### Named DoS-cap constant (V5 Input Validation)
**Source:** `scenario-state.ts:739-747` (`MAX_DRAFT_RECORD_ENTRIES`, `MAX_DRAFT_KEY_LENGTH`, `boundedRecord`).
**Apply to:** CF-02 cap raise — extract `MAX_MEMBER_KEY_IDS = 1000`, do not inline. Keep `MAX_DRAFT_KEY_LENGTH` + `MAX_DRAFT_BODY_BYTES` as the real DoS guards.

### One small pure helper reused across sites
**Source:** `ScenarioComposer.tsx:632-648` `dataSourceLabel`.
**Apply to:** CF-02 `saveErrorMessage(res, issues)` (4 save sites) AND CF-05 gantt key→label mapping (reuse `dataSourceLabel`/`payload.apiKeys`).

### Regression test per bug, fails without the fix (user standing rule)
**Source:** `route.test.ts` `T_SH15`, `ScenarioComposer.save.test.tsx` `T_SAVE9`.
**Apply to:** every CF fix. Retire source-string assertions (`route.test.ts:354`, T_AT3) that break on deletion in the same commit — those are not regressions.

### One-shot idempotent DB op, SELECT-before-mutate + evidence
**Source:** `scripts/backfill_funding.py`; prod-cleanup MEMORY recipe.
**Apply to:** CF-03 F-4 sweep AND CF-05 residue DELETE. Detection-first SELECT; before/after evidence in SUMMARY; Supabase MCP prod `khslejtfbuezsmvmtsdn`; execution-time only.

### SQL test fixture convention
**Source:** `supabase/tests/test_scenarios_rls.sql` (plain PL/pgSQL `DO $$`, `RAISE EXCEPTION`/`RAISE NOTICE`, no pgTAP, `test_*.sql` auto-glob).
**Apply to:** CF-03 `test_scenario_downgrade_sweep.sql` if the sweep is pure-SQL.

### Coverage gate (BLOCKING CI)
**Source:** `vitest.config.ts` thresholds (lines 82 / statements 80 / functions 74 / branches 72); `frontend` aggregator gates branch protection.
**Apply to:** CF-04 especially — remove tested code AND its tests together (coverage-neutral); `npm run test:coverage --no-file-parallelism` before push.

## No Analog Found

None. Every change maps to an existing in-repo idiom or peer-file convention (expected — this is a burn-down of the existing v1.6 membership subsystem, not new feature surface).

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/**`, `src/app/api/allocator/scenario/**`, `src/lib/queries.ts`, `scripts/`, `analytics-service/scripts/`, `supabase/tests/`, `supabase/migrations/`.
**Files scanned (targeted reads):** `share/route.ts` (185-224), `scenario-state.ts` (665-796), `ScenarioComposer.tsx` (1555-1639, 2320-2359, grep label idiom), `CoverageTimeline.tsx` (28-87), `AllocationsTabs.tsx` (945-969), `scripts/backfill_funding.py` (header), `supabase/tests/test_scenarios_rls.sql` (header) + `supabase/tests/` listing.
**Pattern extraction date:** 2026-07-04
</content>
</invoke>
