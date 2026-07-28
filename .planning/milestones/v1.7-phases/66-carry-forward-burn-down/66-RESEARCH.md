# Phase 66: Carry-Forward Burn-Down - Research

**Researched:** 2026-07-04
**Domain:** In-repo debt burn-down (TS/Next scenario-membership code, dead-payload removal, prod-data cleanup, TODOS triage)
**Confidence:** HIGH (all findings are codebase-grep-verified against the live tree; no external dependencies)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **F-3 (CF-01):** DELETE the dead `isBookOnlyDraft` disjunct from the share-mint gate rather than promoting it — promotion would change share-eligibility semantics (product change, out of scope). Correct the overstated "the ONE definition of shareable" comment. Add a regression test proving a book-only draft remains blocked by the surviving `addedStrategies.length === 0` disjunct (test must fail if that block is removed).
- **F-5 (CF-02):** RAISE the `memberKeyIds` `.max(64)` cap (scenario-state.ts:793) to the real eligible-key ceiling — research the actual bound on eligible api_key ids per allocator; if effectively unbounded, pick a defensible generous cap. Do NOT silently clamp the save-time stamp — dropping membership entries silently breaks share-caption honesty (fail-loud).
- **F-5 error surface:** the composer save path must map the over-cap 400 to honest copy naming the real ceiling, replacing the misleading generic "Couldn't save this portfolio. Check your connection and try again." for that case.
- **F-4 (CF-03):** one-off re-derive/re-stamp sweep (script, NOT permanent infra) that finds v4 rows downgraded to v3 shape during the mixed-version deploy window and re-stamps them; run against prod and verify with before/after row evidence. The deploy window is past — no cron, no migration-embedded backfill.
- **CF-04:** remove the dead `holdingReturnsByScopeRef` + `holdingsSummary` SSR pipeline end-to-end (producer → props → any consumers) with the FULL vitest suite green as the gate. Straight deletion — no deprecation flag. **⚠️ SEE RISK-1 BELOW: `holdingsSummary` is NOT dead — only `holdingReturnsByScopeRef` is. Scope must be corrected.**
- **Prod residue:** SELECT-verify the 6 `phase10-rpc-*` auth.users rows match the exact expected pattern and count before DELETE; record evidence in the SUMMARY.
- **D3 source-toggle persistence:** DECIDED — no persistence (YAGNI). Document the decision where D3 is tracked; revisit only on user demand.
- **Gantt:** friendly key labels using the existing label-mapping idiom in the surrounding code.
- **AllocationsTabs.tsx:964:** replace the payload cast with a parsed/narrowed type (zod parse or type guard consistent with nearby idiom).
- **TODOS.md triage:** verify each entry against live code; fix small/decision-free/test-coverable quick wins in-phase; DELETE stale/done entries same-pass (no strike-through graveyard); every surviving entry re-verified with file/symbol evidence; file ends reflecting only live debt; the v1.6 red-team section (F-3/F-4/F-5) is removed once CF-01..03 land.
- **Every fix gets a regression test that fails without it** (user standing rule).

### Claude's Discretion
- Exact new `memberKeyIds` cap value (research-driven — see F-5 section, recommendation below).
- Sweep implementation shape (Node script vs SQL via Supabase MCP) and how downgraded rows are detected.
- Which additional TODOS.md entries qualify as quick wins under the threshold above.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (Note: Phase 19.1 P1 Plans 07-10 in TODOS.md are TRIAGED — verify whether still live — but NOT executed here.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CF-01 | F-3 — share-mint gate: dead `isBookOnlyDraft` disjunct resolved (deleted per CONTEXT), overstated comment fixed | Gate located at `route.ts:203`; disjunct proven dead below. Exact deletion + comment sites identified. |
| CF-02 | F-5 — >64-key save cap raised to real ceiling + honest error copy | Cap at `scenario-state.ts:793`; no DB cap on api_keys per user; composer error path at `ScenarioComposer.tsx:1571-1626` identified; recommended cap + 400-discrimination approach below. |
| CF-03 | F-4 — deploy-skew v4→v3 downgrade re-derive/re-stamp sweep | `scenarios` table shape confirmed; downgrade discriminator SQL derived; re-derivation mechanics (mirror `ScenarioComparePanel.tsx:252` gate-derive) documented. |
| CF-04 | Dead SSR pipeline removed | `holdingReturnsByScopeRef` confirmed dead (queries.ts:1729 doc + 63-04 plan). `holdingsSummary` confirmed **ALIVE** — see RISK-1. Full removal touch-list below. |
| CF-05 | Planning-ledger smalls closed | 6 `phase10-rpc-*` prod rows documented; D3 site located; gantt label site + idiom located; AllocationsTabs.tsx:964 cast read. |
| CF-06 | TODOS.md triaged | Full open-entry inventory + pre-classification below. |
</phase_requirements>

## Summary

This is a pure in-repo burn-down phase: no new dependencies, no external tech domain. All work touches the existing TypeScript/Next scenario-membership subsystem (`src/app/(dashboard)/allocations/**` + `src/lib/queries.ts` + `src/app/api/allocator/scenario/**`), one prod-data cleanup (6 residue `auth.users` rows), one one-off sweep script, and a TODOS.md triage. The v1.6 membership-schema-v4 substrate (PR #572, phases 62-64) is the ground truth for F-3/F-4/F-5.

**The single most important finding: RISK-1 — CF-04's scope as written ("`holdingReturnsByScopeRef` + `holdingsSummary` SSR removal") is WRONG about `holdingsSummary`.** `holdingReturnsByScopeRef` is genuinely dead (zero production consumers since v1.6 phase 63, explicitly documented at `queries.ts:1729`). `holdingsSummary`, by contrast, is a live, heavily-consumed field: it renders the entire Holdings tab, feeds mandate AUM gates, seeds the scenario composer draft, and drives the drift reference and composition list. Deleting it would break the allocator dashboard and turn the vitest suite red. The planner MUST scope CF-04 to `holdingReturnsByScopeRef` only and treat "`holdingsSummary` SSR removal" as a misclassification (likely already-satisfied by the v1.6 phase-63 engine-input removal that stopped `holdingsSummary` feeding the scenario ENGINE while keeping it as display data). The "full suite green — no consumer breaks" gate in the success criteria is exactly the guard that catches an over-broad deletion.

**Primary recommendation:** Structure the phase as ~6 independent task clusters (one per CF requirement), each with its own regression test. CF-04 is the one that needs a scope correction before planning; the rest are mechanical-with-a-test. F-4's sweep and the prod-row DELETE both need Supabase MCP against prod (`khslejtfbuezsmvmtsdn`) with SELECT-before-mutate evidence.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Share-mint gate (F-3) | API / Backend (`api/allocator/scenario/share/route.ts`) | — | Server-side eligibility check before minting a token |
| Save-cap + honest error (F-5) | API validation (`scenario-state.ts` zod) + Frontend (composer error map) | — | Cap is a zod bound at the save boundary; error copy is client-rendered |
| Deploy-skew re-stamp sweep (F-4) | One-off script / DB (Supabase MCP) | — | Operates on persisted `scenarios` rows in prod |
| Dead-payload removal (CF-04) | Frontend Server (SSR payload in `queries.ts`) + Frontend props | — | Removes a per-request compute + RSC payload field |
| Prod residue cleanup (CF-05) | Database (prod `auth.users`) | — | Data-only DELETE |
| Gantt labels / cast / D3 doc (CF-05) | Frontend (`CoverageTimeline.tsx`, `AllocationsTabs.tsx`) | — | Presentation + type-safety |
| TODOS triage (CF-06) | Docs (repo-tracked `TODOS.md`) | — | Verification deliverable |

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Coverage is a BLOCKING CI gate** (`vitest.config.ts` thresholds: lines 82 / statements 80 / functions 74 / branches 72). Every removal that deletes tested code must keep or raise coverage; every new fix must carry tests. The `frontend-coverage` job merges sharded blob reports and enforces thresholds; the `frontend` aggregator gates branch protection.
- **AGENTS.md:** "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before writing Next.js-API code. (Low relevance here — this phase touches route handlers + client components already established in the codebase; match existing idioms, don't introduce new Next APIs.)
- **DESIGN.md** must be consulted before any visual change. Relevant to CF-05 gantt labels (`CoverageTimeline.tsx`) and any composer error-copy surface — reuse existing tokens/idioms, no new visual language.
- **Feature-branch + PR workflow** (never commit from main); regression test per bug that fails without the fix; delete-closed-immediately for TODOS.
- **Prod SQL via Supabase MCP** with SELECT-before-DELETE evidence; prod project `khslejtfbuezsmvmtsdn`, test project `qmnijlgmdhviwzwfyzlc`.

## Findings by Requirement

### CF-01 / F-3 — Dead `isBookOnlyDraft` share-mint disjunct

**The gate** (`src/app/api/allocator/scenario/share/route.ts:200-213`, VERIFIED):
```ts
const draft = (ownedScenario as { draft?: ScenarioDraft | null }).draft ?? null;
const draftAdded = draft?.addedStrategies;
const nothingShareable = !Array.isArray(draftAdded) || draftAdded.length === 0;
if (nothingShareable || isBookOnlyDraft(draft as ScenarioDraft)) {
  return NextResponse.json({ error: "Nothing shareable", code: "book_only_draft", ... }, { status: 409, ... });
}
```

**`isBookOnlyDraft`** (`src/app/(dashboard)/allocations/lib/scenario-state.ts:684-689`, VERIFIED):
```ts
export function isBookOnlyDraft(draft: ScenarioDraft): boolean {
  return (draft.memberKeyIds ?? []).length >= 1 && (draft.addedStrategies ?? []).length === 0;
}
```

**Red-team claim CONFIRMED (HIGH):** the `isBookOnlyDraft(draft)` disjunct is dead in this gate.
- If `addedStrategies.length === 0` → `nothingShareable` is already `true` → short-circuits before the `||` even evaluates `isBookOnlyDraft`.
- If `addedStrategies.length > 0` → `isBookOnlyDraft` returns `false` (it requires `addedStrategies.length === 0`).
- Therefore `isBookOnlyDraft` can NEVER change the branch outcome. The `nothingShareable` disjunct (`addedStrategies` empty/missing) fully subsumes the book-only shape.

**Deletion scope (per locked decision — DELETE, do not promote):**
1. `route.ts:203` — remove `|| isBookOnlyDraft(draft as ScenarioDraft)` from the `if`.
2. `route.ts:58` — remove the `isBookOnlyDraft` import (verify no other use in the file — grep shows only line 203).
3. `route.ts:191-199` — rewrite the "MEMBER-03 — ONE definition of book-only across mint/resolve/compare" comment block. It currently overstates that the gate reads a shared predicate; after deletion the gate keys purely on `addedStrategies` (via `nothingShareable`). Correct it to state the honest single source: **book-only ⇔ zero added strategies** (the resolved-projection counterpart in `share-resolve.ts:213-226` already keys on `strategies.length === 0`, NOT `memberKeyIds` — that comment is accurate and stays).
4. **Keep** `isBookOnlyDraft` the exported function itself — it has live callers elsewhere? **Verify:** grep shows non-test usages ONLY at `route.ts` (being deleted) and the function definition. Comment references in `share-resolve.ts:210/222/287` are prose, not calls. **⚠️ If `route.ts` is the only real caller, `isBookOnlyDraft` becomes dead code after deletion** — this triggers the CLAUDE.md dead-code AskUserQuestion rule. Planner should decide: delete the now-orphaned function + its `scenario-state.test.ts:778-809` tests, OR keep it as documented API. Recommend deleting it (and its test block) in the same pass since the comment-only references don't need the symbol.

**Comment sites to fix (verbatim, VERIFIED):**
- `route.ts:191`: `// MEMBER-03 — ONE definition of book-only across mint/resolve/compare: the` … continues `// gate reads the SAME null-safe isBookOnlyDraft predicate the compare and` `// share surfaces use...`. This is the overstated claim to correct.

**Regression test:** add to `route.test.ts` (existing `T_SH15` at line 395 already asserts a book-only-BY-MEMBERSHIP draft → 409). The NEW test must prove the surviving `addedStrategies.length === 0` disjunct alone blocks a book-only draft — i.e. a draft with `memberKeyIds` set AND `addedStrategies: []` still 409s AFTER the `isBookOnlyDraft` disjunct is gone. Test must fail if the `nothingShareable` block is removed. Note `route.test.ts:354` (`expect(routeSrc).toContain("isBookOnlyDraft")`) is a SOURCE-STRING assertion that will BREAK on deletion — retire/repoint it.

### CF-02 / F-5 — >64-key save cap + honest error

**The cap** (`src/app/(dashboard)/allocations/lib/scenario-state.ts:793`, VERIFIED):
```ts
memberKeyIds: z.array(z.string().max(MAX_DRAFT_KEY_LENGTH)).max(64).optional(),
```
- `MAX_DRAFT_KEY_LENGTH = 512` (`scenario-state.ts:740`).
- This field lives on the shared `scenarioDraftSchema`; the save-boundary refinement is `scenarioDraftSaveSchema` (used by `saved/route.ts` POST + `saved/[id]/route.ts` PUT via `SaveScenarioBodySchema`, `route.ts:60-62`). The `.max(64)` bound is on the shared schema so it applies to both decode and save.

**The real eligible-key ceiling (VERIFIED — no hard cap exists):**
- `memberKeyIds` is stamped from `eligibleApiKeyIds` (`deriveMembershipFromGate`, `scenario-state.ts:670-675`), which is a filtered subset of the allocator's `api_keys` (`is_active ∧ sync_status≠'revoked' ∧ disconnected_at IS NULL`, per v1.6 grounding).
- `apiKeysCount` = `apiKeys.length` (`queries.ts:2829`) — no cap.
- **No DB constraint bounds `api_keys` per user** — grep of `supabase/migrations/**` found no per-user count CHECK/limit on `api_keys`. The RLS owner policy (`20260405061912_rls_policies.sql`) gates ownership, not count.
- **No product cap** on connecting keys found in the wizard/connection flow.
- **Conclusion:** the eligible-key ceiling is effectively unbounded. The `.max(64)` is an arbitrary DoS bound (comment at `scenario-state.ts:791` calls it "T-62-02 DoS: ≤64 ids"). An allocator with >64 eligible keys has every save 400'd.

**DoS envelope check:** `MAX_DRAFT_BODY_BYTES = 256_000` (`saved/route.ts:52`). 64 UUIDs (~36 chars) is ~2.3KB — trivially under the body cap. A generous raise stays well inside the byte ceiling.

**Recommendation (Claude's discretion, MEDIUM):** raise `.max(64)` to a defensible generous cap — **1000** is a clean, well-above-any-realistic-key-count bound that stays two orders of magnitude under the 256KB body cap (1000 × 36 chars ≈ 36KB, still safe with the 512-char per-id max being the real DoS guard via body bytes). Extract to a named const (e.g. `MAX_MEMBER_KEY_IDS = 1000`) so the number is self-documenting and testable. The per-id `.max(MAX_DRAFT_KEY_LENGTH)` + `MAX_DRAFT_BODY_BYTES` route cap remain the actual DoS defenses. Do NOT clamp the stamp (locked decision — fail-loud).

**Honest-error surface (composer, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, VERIFIED):**
- The generic copy is produced at FOUR sites: lines 1573, 1590 (`postNewScenario`), 1617, 1625 (`putUpdateScenario`). All fire on `!res.ok` (the `if (!res.ok)` block) OR the `catch`.
- **The over-cap case is a 400** (`SaveScenarioBodySchema.safeParse` fail → `saved/route.ts:102-106` returns `{ error: "Invalid request body", issues }` with status 400). The generic 500 copy from the route (`route.ts:154`) is a DIFFERENT server-side path (DB error); the 400 currently falls into the composer's generic `!res.ok` branch producing the misleading network-error message.
- **To distinguish:** in `postNewScenario`/`putUpdateScenario`, inspect `res.status === 400` and (optionally) the parsed `issues` to detect the `memberKeyIds` `too_big` zod issue, then set an honest message naming the ceiling (e.g. "This portfolio references more than {N} book sources, which is the current save limit. Remove some sources or contact support."). Because the cap is being RAISED to 1000, this path becomes practically unreachable in normal use — but the honest copy is still required per the locked decision (the misleading generic copy for a validation ceiling is the bug). Recommend a small helper that maps `res.status` (+ zod issue code) → message, reused across all four sites.
- **Regression test:** in `ScenarioComposer.save.test.tsx` (existing pattern: `T_SAVE9` at line 574 pins the generic copy for a 500). Add a test that a 400 with a `memberKeyIds`/`too_big` issue renders the honest over-cap copy, NOT the generic connection message. Must fail against the current code (which shows generic copy for all `!res.ok`).

### CF-03 / F-4 — Deploy-skew v4→v3 downgrade re-stamp sweep

**The mechanism** (from TODOS.md:34-41 + v1.6 substrate): during a mixed-version deploy, old serverless code running the shared zod schema in strip mode drops `memberKeyIds` from a v4 save body, so a stale client round-trips a v4 row back to a v3-shaped row (`memberKeyIds` key absent from the persisted `draft` JSONB).

**The table** (`supabase/migrations/20260621120000_scenarios_table_and_rls.sql:38-45`, VERIFIED):
```sql
CREATE TABLE scenarios (
  id UUID PRIMARY KEY ..., allocator_id UUID NOT NULL REFERENCES profiles ...,
  name TEXT ..., draft JSONB NOT NULL, schema_version INT NOT NULL,
  created_at ..., updated_at ...);
```
- `schema_version` column is written from `draft.schema_version` at save (`saved/route.ts:141`, `170`).

**Downgrade discriminator (recommended detection SQL, MEDIUM — verify against prod before acting):**
```sql
-- A GENUINE v4 row always carries the memberKeyIds KEY (either [] for a blank
-- save or a populated array — see the STAMP tests: blank save persists [], book
-- save persists ids). A DOWNGRADED row had the key stripped, so it is ABSENT.
SELECT id, allocator_id, schema_version, updated_at
FROM scenarios
WHERE schema_version >= 4
  AND NOT (draft ? 'memberKeyIds');   -- JSONB key-presence: true = present
```
Rationale (VERIFIED against composer STAMP tests, `ScenarioComposer.test.tsx:7630-7649`): a blank save persists `memberKeyIds: []` and a book save persists the eligible ids — a genuine v4 write ALWAYS includes the key. Absence of the key on a `schema_version >= 4` row is the downgrade signature.

**Re-derivation — "the gate re-derives membership on reopen"** (`ScenarioComparePanel.tsx:252-261`, VERIFIED):
```ts
const normalized = draft.memberKeyIds === undefined
  ? setMemberKeyIds(draft, deriveMembershipFromGate(
      payload.perKeyDailiesGateSatisfied ?? false,
      payload.eligibleApiKeyIds ?? []))
  : draft;
```
This is the runtime graceful-degradation path (why F-4 is transient, not corrupting). The sweep replicates it server-side: for each downgraded row, compute that allocator's `perKeyDailiesGateSatisfied` + `eligibleApiKeyIds` and stamp `memberKeyIds = deriveMembershipFromGate(gate, eligibleIds)`.

**Sweep-shape recommendation (Claude's discretion, MEDIUM):** the gate-derive requires per-allocator live inputs (eligible api_keys + per-key dailies existence) — the same inputs `getMyAllocationDashboard` computes. Two viable shapes:
- **(a) Pure SQL via Supabase MCP** — derive `eligibleApiKeyIds` (`api_keys` where active/not-revoked/not-disconnected) and gate (per-key `csv_daily_returns` presence) in SQL, then `UPDATE scenarios SET draft = jsonb_set(draft, '{memberKeyIds}', <derived>)`. Self-contained, no deploy, SELECT-before/after evidence trivial. **Recommended** — the deploy window is past and this is a one-off.
- **(b) Node script** reusing the TS derivation helpers. Heavier (needs service-role client + import graph); no advantage for a one-off.
- **Given prod grounding (v1.6 doc:22): "gate=false real users: 0" and only 2 residue rows** — the realistic downgraded-row population is likely tiny or zero. The sweep may find nothing; that is a valid, evidence-recorded outcome (SELECT returns 0 rows → record "no downgraded rows in prod" in SUMMARY). **Detection-first**: run the discriminator SELECT before writing any UPDATE.
- **Regression test:** unit-test the detection predicate + re-derivation transform against fixtures (a downgraded-shape row vs a genuine-v4 row) so the sweep logic is proven independent of prod state. A pure-SQL sweep can be pinned with a `supabase/tests/test_*.sql` fixture per the DB-test CI wiring rule.

### CF-04 — Dead SSR pipeline removal (⚠️ SCOPE CORRECTION REQUIRED)

**`holdingReturnsByScopeRef` — CONFIRMED DEAD (HIGH).** `queries.ts:1729` doc verbatim: *"NO PRODUCTION CONSUMER (as of v1.6 phase 63): nothing in the component tree reads this field any more. It is retained per a deferred-cleanup decision — see the 'queries / SSR payload' P1 entry in TODOS.md."* The v1.6 phase 63-04 plan explicitly left it in place as "Open Question 1 … note as future cleanup." Every remaining reference is either the producer, the payload field, or a test stub.

**`holdingsSummary` — CONFIRMED ALIVE (HIGH) → RISK-1.** Grep-verified live consumers that RENDER or COMPUTE from it:
- `AllocationDashboardV2.tsx:34,61,82` — `holdingsEmpty` empty-state gate (renders the whole dashboard shell).
- `HoldingsTabPanel.tsx:39,55-60` — filters spot vs derivative rows; **renders the entire Holdings tab**.
- `ScenarioComposer.tsx` — extensive: composition list, seeding (`defaultDraftFromHoldings`), drift reference, per-ref map (`:2774-2804`, `:4194`, `:4577`).
- `useScenarioState.ts:59,139-162` — default draft + live-book fingerprint.
- `mandate-gates.ts:94-192` — AUM gate (`totalAum` from `holdingsSummary`).
- `holdings-adapter.ts:125-171` — `holdingsSummary[] → DesignHoldingRow[]` transform.
- `ScenarioComparePanel.tsx:57,166,220` — compare payload.
- `queries.ts` — producer (`:2472-2487`) + `liveBaselineMetrics` consumer (`:2128-2212`, `:3000-3073`).
- There is even a **live P2 bug** filed against it (TODOS.md:976, `holdingsSummary` symbol-only dedup) — you cannot have a live bug in a dead field.

**Deleting `holdingsSummary` would break the Holdings tab, mandate AUM gates, composer seeding, and turn the vitest suite red.** The "holdingsSummary SSR removal" phrase in REQUIREMENTS/PROJECT/ROADMAP/MILESTONES is a **misclassification** — most likely a conflation with the v1.6 phase-63 work that removed `holdingsSummary` as a scenario-ENGINE INPUT (`ScenarioComposer.tsx:57` comment: *"It no longer feeds the engine"*) while keeping it as display data. That engine-input removal already shipped in v1.6.

**Planner action for CF-04:** scope removal to `holdingReturnsByScopeRef` ONLY. For the `holdingsSummary` half, the honest resolution is one of:
- (a) mark it **already-satisfied** (engine-input removal shipped in v1.6 phase 63; the field remains legitimately as Holdings-tab display data) and record that verdict in the SUMMARY; or
- (b) escalate to the user as a scope correction (matches the "no clients → take decisions" + fail-loud posture: document the finding, proceed with the safe interpretation).
Recommend (a) with an explicit SUMMARY note. The success-criterion "no consumer breaks / full suite green" is satisfied precisely because `holdingsSummary` is NOT touched.

**`holdingReturnsByScopeRef` removal touch-list (VERIFIED, non-test):**
| File | Line | What |
|------|------|------|
| `src/lib/queries.ts` | 2037 | `reconstructHoldingReturnsByScopeRef` function definition — DELETE |
| `src/lib/queries.ts` | 1734 | payload TYPE field `holdingReturnsByScopeRef: Record<string, DailyPoint[]>` — DELETE |
| `src/lib/queries.ts` | 2998 | `const holdingReturnsByScopeRef = reconstructHoldingReturnsByScopeRef(...)` call — DELETE |
| `src/lib/queries.ts` | 3013 | explanatory comment — DELETE/reword |
| `src/lib/queries.ts` | 3107, 3417 | two payload construction sites `holdingReturnsByScopeRef,` — DELETE |
| `src/lib/queries.ts` | 2462, 2840 | prose comment references — reword (doc-only) |

**Test sites to update (VERIFIED):** most are stub payloads carrying `holdingReturnsByScopeRef: {}` (mechanical field removal): `AllocationsTabs.test.tsx:143`, `AllocationsTabs.onboarding.test.tsx:112`, `AllocationsTabs.scenario-state-preservation.test.tsx:203`, `ScenarioComposer.test.tsx` (×9: 453,535,1577,1777,2054,2293,2338,2876,4955), `ScenarioComposer.save.test.tsx:208`, `ScenarioComparePanel.test.tsx:120`. **Active assertions to RETIRE/repoint** (they pin the dead field's presence):
- `AllocationsTabs.scenario-composer.test.tsx` — `T_AT3` (`:308-321`) asserts "ScenarioComposer receives full payload including holdingReturnsByScopeRef" — RETIRE.
- `queries.my-allocation.test.ts:2117-2141` — Phase 37 byte-identity test reading `result.holdingReturnsByScopeRef` — REPOINT (drop the `holdingReturnsByScopeRef` axis, keep the `liveBaselineMetrics` byte-identity axis) or retire the dead-field portion.
- `getMyAllocationDashboard.scenario.test.ts:301` — type-smoke on scope_ref key shape — RETIRE.
Gate: full vitest suite green + coverage thresholds hold after removal.

### CF-05 — Planning-ledger smalls

**6 `phase10-rpc-*` auth.users residue rows (prod `khslejtfbuezsmvmtsdn`):**
- Documented in `.planning/v1.6-SERIES-SPACE-INPUT.md:22-27,91`: *"2 users have holdings rows but zero eligible keys — both are stale `phase10-rpc-*@test.local` residue (latest asof 2026-04-26), not real users."* Note the tension: that doc says **2 users** (the last gate=false holders, GUARD-01 already removed their HOLDINGS rows per `v1.6-REQUIREMENTS.md:46`), whereas CF-05 says **6 `phase10-rpc-*` auth.users rows**. The 6 likely counts `auth.users` rows (users) distinct from the holdings rows GUARD-01 cleared. **The SELECT-before-DELETE evidence step resolves this**: run `SELECT id, email, created_at FROM auth.users WHERE email LIKE 'phase10-rpc-%@test.local'` against prod, confirm the exact pattern + count (expect ~6), verify none are real users, then DELETE and record before/after evidence in SUMMARY. Do NOT run prod queries during research (per instruction) — the planner/executor does this at execution time via Supabase MCP.
- Cross-check for FK cascade: `scenarios.allocator_id REFERENCES profiles ON DELETE CASCADE` and `api_keys` etc. — deleting `auth.users` rows cascades. Confirm no real data hangs off these test users before DELETE.

**D3 source-toggle persistence decision (DECIDED: no persistence — YAGNI):**
- The D3 gate lives in `ScenarioComposer.tsx` (per-data-source toggle; `ScenarioComposer.tsx:1790` comment "Phase-36 D3", and the DSRC-02/03 control tests at `ScenarioComposer.test.tsx:4221-4435`). The toggle is transient UI state (per-key data-source inclusion), NOT persisted to the draft. **Where to document the decision:** there is no standalone D3 ledger entry in TODOS.md — the item is tracked in the planning docs (PROJECT.md:33, ROADMAP.md:62, MILESTONES.md:20) as "D3 source-toggle persistence decided". Record the "no persistence (YAGNI), revisit on user demand" decision in the phase SUMMARY and, if a code comment is the natural home, near the D3 toggle in `ScenarioComposer.tsx`. This is a documentation-only deliverable.

**Friendly gantt key labels:**
- The gantt is `CoverageTimeline.tsx` (mounted at `ScenarioComposer.tsx:3598`; Phase 58 COVERAGE-01, `ScenarioComposer.tsx:2336`).
- `CoverageTimeline.tsx` renders `row.name` (`:130,132,155` — `title`, text, `aria-label`). Each row is `{ id, name, ... }` (`:35`). The "friendly key labels" task is about the `name` passed per row — currently raw key ids for per-key rows. **The existing label-mapping idiom** (per locked decision) is the one already used elsewhere in the composer to render friendly key names from `payload.apiKeys` (grep `payload.apiKeys` in `ScenarioComposer.tsx` — the composer already resolves key display names). Map per-key gantt rows through that same key→label lookup so book-member rows show a friendly exchange/account label instead of a UUID. **DESIGN.md check required** (visual/label change). Regression test: assert a per-key gantt row renders the friendly label, not the raw id.

**AllocationsTabs.tsx:964 payload cast (VERIFIED):**
```ts
payload={props as unknown as ScenarioComparePanelProps["payload"]}
```
- This is the `ScenarioComparePanel` mount inside `AllocationsTabs`. `props` is the full `MyAllocationDashboardPayload`; the double-cast `as unknown as` erases type-safety. Replace with a narrowed type — the nearby idiom is a structural narrow (the panel needs a SUBSET of `props`). Options consistent with the codebase: (a) build an explicit object with the fields `ScenarioComparePanelProps["payload"]` requires (compile-time checked, no cast), or (b) a zod parse if runtime validation is warranted (heavier — the data is already server-trusted SSR props, so a structural narrow is proportionate). Recommend (a): construct the panel payload explicitly from `props` fields, dropping the double-cast. Regression: type-level — the change is enforced by `tsc`; add a light assertion that the panel receives the expected fields if a behavioral test is cheap.

### CF-06 — TODOS.md triage (pre-classification)

TODOS.md is 1002 lines. Pre-classification of the OPEN entries into (a) stale/done → DELETE, (b) quick-win in-phase, (c) live debt → keep. **Every verdict must be re-verified against live code before acting** (this table is the planner's raw material, not the final verdict).

| Entry (section) | Pre-class | Evidence / note |
|---|---|---|
| v1.6 red-team F-3 (`isBookOnlyDraft` dead disjunct) | REMOVE after CF-01 lands | This phase fixes it; section deleted per locked decision |
| v1.6 red-team F-5 (memberKeyIds cap) | REMOVE after CF-02 lands | Fixed this phase |
| v1.6 red-team F-4 (deploy-skew downgrade) | REMOVE after CF-03 lands | Fixed this phase |
| "queries / SSR payload" P1 (`holdingReturnsByScopeRef` removal) | REMOVE after CF-04 lands | Fixed this phase |
| P2 `holdingsSummary` symbol-only dedup bug (`queries.ts:1779`) | KEEP (live debt) | Genuine live bug in a live field — NOT in scope; verify line still `.set(r.symbol, r)` |
| v1.3 P3 flagged-count badge > 99 cap | QUICK-WIN candidate | CONTEXT names this explicitly as a quick win (`99+` cap); small, test-coverable |
| v1.3 P3 stale `DesktopGate` comment rot (`for-quants-lead/route.ts` ~167/182/391) | QUICK-WIN candidate | CONTEXT names this explicitly; doc-only comment cleanup |
| v1.3 P3 tab-strip/sortable-header focus-ring clip (WCAG 2.4.7) ×2 | KEEP or QUICK-WIN | Judgement: CSS change with DESIGN.md implications — likely KEEP unless trivially test-coverable |
| v1.3 P3 wizard 320px reflow coverage past entry step | KEEP | Needs seeded draft/step-state injection — not decision-free |
| v1.3 P3 migrate remaining tables to `ResponsiveTable` | KEEP | Multi-file, judgement |
| Phase 19.1 P1 Plans 07-10 (gated deploy work) | KEEP — verify live | CONTEXT specifics: "triage verifies whether it's still live, does not execute it". Check if `USE_COMPUTE_JOBS_QUEUE` flip + stop-gap removal already shipped |
| Phase 19.1 P2 atomicity gap / after() monitoring / P3 edge coverage | KEEP | Deferred infra/monitoring |
| Phase 19.1 red-team P1 unified-backbone CSV-finalize / P2 RLS EXISTS / P2 worker-crash / P3 audit-skip | KEEP | Structural, flag-gated |
| Phase 17/16 review follow-ups (many P1/P2/P3) | VERIFY each | Several may have shipped since — verify against code, DELETE stale (e.g. some email.ts / webhook items may be done) |
| DISCO-05 / v1.0.0 migration-drift ratification | KEEP (historical decision record) | Ratified decision; keep as record |
| v0.23 vitest concurrent-worker timeout flakes (P0) | VERIFY | Check `vitest.config.ts` pool settings — may be partially addressed by `--no-file-parallelism` memory |
| PR #149 flaky live-DB fence tests (P1, 3 skipped) | VERIFY | Check if the 3 `@pytest.mark.skip` still present in `test_compute_jobs_fencing.py` |
| Sprint-1 follow-ups (many, some `~~struck~~` done) | VERIFY + DELETE struck | Several already `~~done~~` — delete those; verify the rest |
| "My Allocation" widgets needing endpoints (Widget 28/29/18/38) | KEEP | Genuine unbuilt features |
| Founder LP cron idempotency / timeout / alert-digest verb mismatch | VERIFY | `alert-digest` GET/POST may have been fixed; verify `route.ts` exports |
| `extractAnalytics` barrel migration (M2) | VERIFY | Check if `src/lib/queries.ts:167` re-export still present |
| North-star / Moment 1-3 / demo-narrative idea lists | KEEP (idea backlog) | Explicitly "IDEAS, not a plan" per file header — keep as backlog |

**Triage method:** for each entry, grep the named file/symbol; if the described state no longer matches live code (fix shipped), DELETE the entry same-pass. Quick wins (flagged-count cap, DesktopGate comment rot, plus any others meeting the small/decision-free/test-coverable threshold) get fixed in-phase with a regression test. End state: only live, verified debt remains; the v1.6 F-3/F-4/F-5 section is gone.

## Runtime State Inventory

> Rename/refactor/cleanup phase — runtime state that a grep cannot find:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) prod `scenarios` rows downgraded v4→v3 in the deploy window (`memberKeyIds` key absent, `schema_version >= 4`) — F-4. (2) 6 `phase10-rpc-*@test.local` `auth.users` residue rows in prod — CF-05. | (1) one-off re-stamp sweep (SELECT-then-UPDATE via MCP). (2) SELECT-verify pattern+count, then DELETE (cascades to child rows). Both need before/after evidence in SUMMARY. |
| Live service config | None — no external service (n8n/Datadog/Tailscale) stores any string this phase touches. Verified: phase is repo + prod-DB only. | None |
| OS-registered state | None — no Task Scheduler / pm2 / cron registration involves these symbols. The F-4 sweep is explicitly NOT infra (no cron). | None |
| Secrets/env vars | None — no secret/env-var name changes. (`USE_COMPUTE_JOBS_QUEUE` appears only in TODOS triage as a state-to-verify, not a change.) | None |
| Build artifacts | None — no package rename, no egg-info/compiled artifact. `holdingReturnsByScopeRef` removal is source-only; the vitest suite is the sole build-side gate. | None |

**Canonical question — after every file is updated, what runtime systems still hold old state?** Answer: the two prod-data items above (F-4 downgraded rows + phase10-rpc residue). Both are addressed by explicit data operations, not code edits. Everything else in this phase is code/doc-only with no runtime-state tail.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Deriving membership in the F-4 sweep | A bespoke membership algorithm | Mirror `deriveMembershipFromGate` + the `ScenarioComparePanel.tsx:252` normalize pattern | The runtime already re-derives on reopen; replicating that exact logic keeps the sweep consistent with live behavior |
| Detecting downgraded rows | Ad-hoc heuristics | JSONB key-presence (`NOT (draft ? 'memberKeyIds')`) + `schema_version >= 4` | Postgres native operator; matches the genuine-v4-always-has-the-key invariant proven by the STAMP tests |
| Composer error mapping | Inline per-site string logic ×4 | One shared `status → message` helper reused at all 4 save sites | Keeps the honest-copy contract in one place; the 4 sites currently duplicate the generic string |
| Gantt key labels | New label formatter | The composer's existing `payload.apiKeys` key→label idiom | Locked decision: reuse the surrounding idiom |
| AllocationsTabs:964 narrowing | New zod schema for the panel payload | Explicit structural narrow from `props` (or existing panel prop type) | Data is server-trusted SSR props; a full zod parse is disproportionate |

## Common Pitfalls

### Pitfall 1: Deleting `holdingsSummary` because CF-04 lists it
**What goes wrong:** Following the requirement literally deletes a live field → Holdings tab, mandate gates, composer seeding all break; vitest goes red.
**How to avoid:** Scope CF-04 to `holdingReturnsByScopeRef` only (RISK-1). `holdingsSummary` engine-input removal already shipped in v1.6 phase 63; the field stays as display data.
**Warning sign:** any task touching `holdingsSummary` production/consumers in `queries.ts`, `HoldingsTabPanel.tsx`, `mandate-gates.ts`.

### Pitfall 2: Source-string test assertions break on symbol deletion
**What goes wrong:** `route.test.ts:354` (`routeSrc).toContain("isBookOnlyDraft")`) and `AllocationsTabs.scenario-composer.test.tsx` T_AT3 assert the presence of the deleted code/field → they fail on deletion even though the deletion is correct.
**How to avoid:** Retire/repoint these assertions in the same commit as the deletion; don't chase them as regressions.

### Pitfall 3: F-4 sweep re-derives with WRONG per-allocator inputs
**What goes wrong:** Deriving membership from stale/incorrect eligible-key sets writes wrong `memberKeyIds`, silently corrupting share-caption honesty — the exact thing F-4 protects.
**How to avoid:** Derive `eligibleApiKeyIds` + gate exactly as `getMyAllocationDashboard` does (active ∧ not-revoked ∧ not-disconnected keys; per-key `csv_daily_returns` presence). Prefer detection-first; the population may be 0 (prod grounding says 0 gate=false real users). Record SELECT evidence before any UPDATE.

### Pitfall 4: Coverage gate regression on test-heavy deletions
**What goes wrong:** Removing tested `holdingReturnsByScopeRef` code + its tests can drop function/branch coverage under the `vitest.config.ts` thresholds (74/72) → CI red.
**How to avoid:** Removing both the tested code AND its tests is coverage-neutral for that unit; run `npm run test:coverage` locally before pushing. Watch the functions/branches ratchet specifically (closest to the floor).

### Pitfall 5: Local vitest contention flakes
**What goes wrong:** Full-suite local runs flake on RTL-heavy composer tests under worker contention (documented — MEMORY + TODOS v0.23 entry).
**How to avoid:** Run with `--no-file-parallelism` locally (per project memory) when verifying the composer/save suites.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (v8 coverage via `@vitest/coverage-v8`) |
| Config file | `vitest.config.ts` (root) — thresholds lines 82 / statements 80 / functions 74 / branches 72 |
| Quick run command | `npx vitest run <path> --no-file-parallelism` (targeted file) |
| Full suite command | `npm run test:coverage` (enforces thresholds; CI runs sharded with `--coverage`) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Command | File Exists? |
|-----|----------|-----------|---------|-------------|
| CF-01 | Book-only draft still 409s via surviving `addedStrategies` disjunct after `isBookOnlyDraft` removed | unit | `npx vitest run src/app/api/allocator/scenario/share/route.test.ts` | ✅ (extend; `T_SH15` exists) |
| CF-02 | Over-cap 400 renders honest ceiling copy, not generic network copy | unit/RTL | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx` | ✅ (extend; `T_SAVE9` exists) |
| CF-02 | Raised cap accepts >64 ids up to new bound; rejects above it | unit | `npx vitest run src/app/(dashboard)/allocations/lib/scenario-state.test.ts` | ✅ (extend) |
| CF-03 | Detection predicate flags downgraded row, passes genuine-v4 row; re-derivation stamps correct ids | unit + SQL fixture | `npx vitest run` (transform) / `supabase/tests/test_*.sql` | ❌ Wave 0 (new test for sweep logic) |
| CF-04 | Full suite green after `holdingReturnsByScopeRef` removal; no consumer breaks | full suite | `npm run test:coverage` | ✅ (retire dead-field assertions) |
| CF-05 | Gantt per-key row renders friendly label not UUID; AllocationsTabs panel typed without double-cast | RTL + tsc | `npx vitest run src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx` | ✅ (extend) |

### Sampling Rate
- **Per task commit:** targeted `npx vitest run <touched file> --no-file-parallelism`
- **Per wave merge:** `npm run test:coverage` (thresholds)
- **Phase gate:** full suite green + coverage thresholds hold before `/gsd:verify-work`; F-4 sweep + prod DELETE carry SELECT-before/after evidence.

### Wave 0 Gaps
- [ ] New test for F-4 detection predicate + re-derivation transform (`scenarios` downgraded-row fixture) — covers CF-03. If sweep is pure-SQL, add a `supabase/tests/test_scenario_downgrade_sweep.sql` fixture per DB-test CI wiring.
- [ ] (If not present) `CoverageTimeline.test.tsx` assertion for friendly key labels — covers CF-05 gantt.
- *All other requirements extend existing test files — no new framework install.*

## Security Domain

> `security_enforcement` not disabled — included, light (no new attack surface; this is cleanup).

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | zod at the save boundary (`scenarioDraftSaveSchema`); raising `.max(64)` keeps the per-id `.max(512)` + `MAX_DRAFT_BODY_BYTES` DoS guards intact — do NOT remove those |
| V4 Access Control | yes (F-4 sweep, prod DELETE) | Sweep/DELETE run with service-role via Supabase MCP; RLS is the tenant gate for normal paths. Verify residue rows are non-real before DELETE |
| V6 Cryptography | no | none touched |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Raising the cap enables a payload-DoS | Denial of Service | `MAX_DRAFT_BODY_BYTES=256_000` + per-id `.max(512)` remain the real bounds; 1000 UUIDs ≈ 36KB, safe |
| Sweep re-derives wrong membership → caption dishonesty | Tampering | Mirror the exact runtime derive; detection-first with SELECT evidence |
| Deleting wrong `auth.users` rows | Tampering/Repudiation | Exact-pattern SELECT + count verification before DELETE; evidence in SUMMARY |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The genuine-v4 invariant "row always carries `memberKeyIds` key" holds for ALL prod v4 rows (basis for the `NOT (draft ? 'memberKeyIds')` discriminator) | CF-03 | If some genuine-v4 path omitted the key, the sweep would false-positive; mitigated by verifying the discriminator against a known-genuine prod row before UPDATE |
| A2 | `phase10-rpc-*` residue is exactly 6 `auth.users` rows (CF-05 says 6; v1.6 input doc says "2 users") | CF-05 | Count mismatch — RESOLVED by the mandatory SELECT-before-DELETE evidence step; do not hard-code 6 |
| A3 | Recommended raised cap = 1000 is defensible (no real allocator approaches it; well under body-byte cap) | CF-02 | If a future product cap on keys is intended lower, 1000 is still safe (over-permissive, not corrupting); Claude's-discretion per CONTEXT |
| A4 | "holdingsSummary SSR removal" in planning docs is a misclassification of the already-shipped v1.6 engine-input removal | CF-04 / RISK-1 | If the user genuinely intended a different `holdingsSummary` removal, escalate — but no dead `holdingsSummary` surface exists in code |
| A5 | `isBookOnlyDraft` has no live caller besides the (to-be-deleted) share route | CF-01 | If a caller is missed, deleting the function breaks it; grep confirms only `route.ts` + definition + tests — planner re-greps before deleting the function |

## Open Questions (RESOLVED)

1. **`holdingsSummary` in CF-04 — already-satisfied vs escalate?**
   - Known: `holdingsSummary` is live; its engine-input removal shipped in v1.6 phase 63; only `holdingReturnsByScopeRef` is dead.
   - Unclear: whether to mark the `holdingsSummary` half done-in-v1.6 or surface to user.
   - Recommendation: mark already-satisfied with an explicit SUMMARY note (safe interpretation; "no consumer breaks" gate confirms it).
   - **RESOLVED — adopted in plan 66-03 (Task 2):** already-satisfied verdict; the RISK-1 scope-correction is recorded in the 66-03 SUMMARY and `holdingsSummary` is untouched.

2. **F-4 downgraded-row population size.**
   - Known: prod grounding says 0 gate=false real users, only residue rows.
   - Unclear: exact count of `schema_version >= 4 AND NOT (draft ? 'memberKeyIds')` rows in prod.
   - Recommendation: detection-first SELECT; a 0-row result is a valid evidence-recorded outcome (no UPDATE needed), still closes F-4 honestly.
   - **RESOLVED — adopted in plan 66-02 (Task 2):** detection-first; the DETECT SELECT runs before any UPDATE, and a 0-row result is recorded as valid closure evidence.

3. **`phase10-rpc-*` count (6 vs 2).**
   - Known: docs disagree (6 auth.users vs 2 users whose holdings GUARD-01 cleared).
   - Recommendation: SELECT-verify exact count/pattern before DELETE; record actual count.
   - **RESOLVED — adopted in plan 66-02 (Task 3):** the SELECT-before-DELETE resolves the actual count (no hard-coded expectation anywhere); evidence recorded in the SUMMARY.

4. **`isBookOnlyDraft` function fate after disjunct deletion (dead-code AskUser rule).**
   - Recommendation: delete the orphaned function + its `scenario-state.test.ts:778-809` block in the same pass (comment-only references don't need the symbol); if the planner prefers, gate behind the CLAUDE.md dead-code AskUserQuestion.
   - **RESOLVED — adopted in plan 66-01 (Task 1):** delete the orphaned function + test block in the same pass, after a repo-wide re-grep confirms no non-test caller. This deviates from the CLAUDE.md dead-code AskUserQuestion gate; the deviation and its sanction (this resolution + the CONTEXT Claude's-discretion charter — the CF-01 locked decision covers only the disjunct) are recorded in the 66-01 SUMMARY.

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Supabase MCP (prod `khslejtfbuezsmvmtsdn`) | F-4 sweep, CF-05 residue DELETE | ✓ (MCP configured) | SELECT-before-mutate; service-role. Do NOT run prod queries during research/planning — execution only |
| Vitest + `@vitest/coverage-v8` | all test gates | ✓ | Established; `npm run test:coverage` |
| No new packages | — | — | Zero external deps; Package Legitimacy Audit N/A (no installs) |

## State of the Art

Not applicable — no evolving external tech domain. This is in-repo debt burn-down against the v1.6 membership-schema-v4 substrate (PR #572, phases 62-64, shipped 2026-07-04).

## Sources

### Primary (HIGH confidence — codebase-verified this session)
- `src/app/api/allocator/scenario/share/route.ts:58,191-213` — share-mint gate + overstated comment
- `src/app/(dashboard)/allocations/lib/scenario-state.ts:684-704,740,777-796` — `isBookOnlyDraft`, cap, save schema
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1555-1630,7630-7649` — save error sites, STAMP tests
- `src/app/api/allocator/scenario/saved/route.ts:52,60-107,141` — save route, 400 path, schema_version write
- `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx:245-261` — runtime re-derive-on-reopen
- `src/lib/queries.ts:1725-1734,2037,2472-2487,2998-3117,3417-3430` — `holdingReturnsByScopeRef` (dead) + `holdingsSummary` (alive) producers/consumers
- `src/app/(dashboard)/allocations/{AllocationDashboardV2,HoldingsTabPanel,AllocationsTabs}.tsx`, `hooks/useScenarioState.ts`, `lib/{mandate-gates,holdings-adapter}.ts` — `holdingsSummary` live consumers
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx:592-601,945-966` — apiKeysCount source, line-964 cast
- `src/app/(dashboard)/allocations/components/CoverageTimeline.tsx:35,124-172` — gantt rows/labels
- `supabase/migrations/20260621120000_scenarios_table_and_rls.sql:38-45` — `scenarios` table shape
- `.planning/v1.6-SERIES-SPACE-INPUT.md:20-27,91` — prod grounding, phase10-rpc residue
- `.planning/milestones/v1.6-phases/63-*/63-04-PLAN.md` — explicit "DO NOT touch holdingsSummary production" + `holdingReturnsByScopeRef` LEAVE-IT decision
- `TODOS.md` (full) — triage source; `:976` live holdingsSummary bug; `:990-1001` holdingReturnsByScopeRef removal entry

### Secondary
- `.planning/{REQUIREMENTS,PROJECT,ROADMAP,MILESTONES}.md` — CF-01..06 definitions + the "holdingsSummary SSR removal" misclassification origin
- `CLAUDE.md` / `AGENTS.md` — coverage gate, workflow, Next.js caution

## Metadata

**Confidence breakdown:**
- CF-01 (dead disjunct): HIGH — logic proven by inspection; deletion sites enumerated
- CF-02 (cap + error): HIGH on the mechanism/no-DB-cap; MEDIUM on the exact recommended cap value (discretion)
- CF-03 (F-4 sweep): HIGH on table shape + re-derive mechanism; MEDIUM on the discriminator (verify against a genuine prod row) and population size
- CF-04 (dead pipeline): HIGH — `holdingReturnsByScopeRef` dead, `holdingsSummary` alive, both documented in code + v1.6 plan
- CF-05 (smalls): HIGH on locations; MEDIUM on residue-row count (6 vs 2 — SELECT resolves)
- CF-06 (triage): HIGH on the inventory; verdicts are pre-classifications requiring per-entry re-verification

**Research date:** 2026-07-04
**Valid until:** 2026-08-04 (stable in-repo domain; re-verify if the scenario subsystem changes materially)
