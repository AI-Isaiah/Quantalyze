# Phase 159: RANK — Public-ranking integrity - Pattern Map

**Mapped:** 2026-08-21
**Files analyzed:** 12 modified + 4 new (census artifact, 1 SQL migration, 2 test files)
**Analogs found:** 15 / 16 (only the census artifact has no in-repo analog; its SQL is supplied by RESEARCH.md)

All line refs verified against RESEARCH.md's HEAD read (`5916012b`) this session; three analog files re-read directly (`queries.ts:1110-1139`, `deletion-requests/[id]/approve/route.ts:335-358`, `visibility.test.ts:1-60`). Planner must re-grep anchors at its own HEAD (house rule — refs drift within days).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/closed-sets.ts` (gate helper + blend fix) | shared pure lib | transform | `isComputedAnalytics` + `blendPeriodsPerYear` in the SAME file | exact (in-file) |
| `src/lib/queries.ts` (percentile gate + projections) | RSC data layer | request-response (PostgREST reads) | `getStrategyDetailV2` projection, `src/lib/queries.ts:1118-1139` | exact |
| `src/app/(dashboard)/compare/page.tsx:68` (projection) | RSC page query | request-response | same `getStrategyDetailV2` projection pattern | exact |
| `supabase/migrations/NEW_get_verified_cohort_rank.sql` | migration (SECDEF RPC) | request-response (SQL) | `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` (full re-base) | exact — it IS the file being replaced |
| `analytics-service/services/metrics.py` (RANK-05) | Python worker service | batch/transform | `sharpe_vol_status_from_backbone`, `metrics.py:1299-1371` | exact (D-04 mandates this mirror) |
| `src/app/api/strategies/csv-finalize/route.ts` (CAS) | API route | request-response (CRUD) | `deletion-requests/[id]/approve/route.ts:341-358` | exact |
| `src/lib/wizard/localStorage.ts` (fingerprint) | client utility | transform | its own `csvSubmissionSignature` (:664-672) — widen in place | exact (in-file) |
| `src/app/(dashboard)/submit/WizardClient.tsx` (deps) | client component | event-driven | its own re-mint effect :587/:635 + dep arrays :624/:651 | exact (in-file) |
| `src/lib/visibility.ts` (uid validation) | shared pure lib | transform | `isUuid`/`UUID_RE`, `src/lib/utils.ts:77-83` | exact |
| `src/lib/queries.percentiles.test.ts` (extend) | test | — | its own thenable-chain mock harness | exact |
| `src/__tests__/csv-finalize-cross-submission-merge.test.ts` (extend) | test | — | its own real-POST + ordered-read mock harness (:97, :268, :1417) | exact |
| `src/lib/visibility.test.ts` (extend) | test | — | its own fake-builder harness (read below) | exact |
| `supabase/tests/test_get_verified_cohort_rank_gate.sql` (NEW) | SQL test | — | existing `supabase/tests/test_*.sql` files (only CI-run SQL tier) | role-match |
| `analytics-service/tests/test_metrics.py` (new sign-invariant test) | test | — | existing harness in `test_metrics.py` | exact |
| `.planning/phases/159-rank-public-ranking-integrity/159-CENSUS.md` (NEW) | phase artifact | — | v1.19 close-by-measurement census artifacts | role-match (SQL supplied in RESEARCH.md §Code Examples) |

## Pattern Assignments

### `src/lib/closed-sets.ts` — gate helper (RANK-01) + blend fix (RANK-06)

**Analog:** the module itself (MD-01 single-source; D-03 locks placement here).

**Module constraint** (closed-sets.ts:16-18): "This module imports ONLY zod." The new helper must be import-free and delegate — never re-derive status semantics.

**Semantic core to delegate to** (closed-sets.ts:715-719):
```ts
export function isComputedAnalytics(
  status: string | null | undefined,
): boolean {
  return status === "complete" || status === "complete_with_warnings";
}
```

**Gate composition sketch** (from RESEARCH.md §Code Examples — invariants binding, naming discretionary):
```ts
export const PERCENTILE_GATE_COLUMN = "computation_status";
export function isRankableAnalyticsRow(
  row: { computation_status?: string | null } | null | undefined,
): boolean {
  return isComputedAnalytics(row?.computation_status);
}
```

**RANK-06 fix point** (closed-sets.ts:605-609, verbatim at HEAD):
```ts
export function blendPeriodsPerYear(
  legs: ReadonlyArray<{ asset_class?: string | null }>,
): number {
  return legs.some((l) => l.asset_class === "crypto") ? 365 : 252;
}
```
Fix at the helper (`l.asset_class === "crypto" || l.asset_class == null` → 365-style; empty blend stays 252 — state explicitly in the docblock, which currently claims "empty or all-unknown … keeps 252" and becomes false for all-unknown). NO venue literal anywhere; Python side already closed via `closed_sets.py::CRYPTO_VENUES` (:211-213) — do not re-fix. All 4 production call sites (`queries.ts:2985`, `share-resolve.ts:363`, `ScenarioComposer.tsx:3222`, `scenario-compare.ts:349`) inherit the helper fix.

---

### `src/lib/queries.ts` + `compare/page.tsx` — projections (RANK-01/RANK-02)

**Analog:** `getStrategyDetailV2`'s path-extraction projection, `src/lib/queries.ts:1118-1139` — the codebase's one prior splat→explicit conversion. Copy its shape AND docblock discipline:

```ts
/**
 * Path-extraction projection. Replaces the wildcard
 * `select("*, strategy_analytics (*)")` with explicit column lists so the
 * row payload stays close to what the seven panels actually consume.
 * ...
 * Analytics columns: every field that getStrategyDetailV2 unpacks below.
 * `metrics_json` is intentionally a single blob fetch — its keys ...
 * PostgREST cannot project a JSONB sub-tree without an RPC.
 */
const STRATEGY_V2_STRATEGY_COLUMNS =
  "id, name, start_date, supported_exchanges, strategy_types, subtypes, markets, leverage_range, avg_daily_turnover";
```
Note the pattern's guard-comment style continues at :1138 ("CRITICAL: data_quality_flags MUST stay in this projection…") — new projections should carry equivalent must-stay comments for `sparkline_returns`/`sparkline_drawdown`/`computation_status`. ⚠️ The :1130-1132 "cannot project a JSONB sub-tree" comment conflicts with the `->` alias option (A4) — reconcile explicitly if aliasing `three_month` is chosen.

**Percentile gate wiring** — frozen constant stays byte-identical (queries.ts:126-127):
```ts
const PERCENTILE_ANALYTICS_COLUMNS =
  "cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return";
```
Compose at the projection sites only (both callers — `getPercentiles` :150/:156, `getOwnRowPercentiles` :625):
```ts
.select(`id, strategy_analytics (${PERCENTILE_ANALYTICS_COLUMNS}, ${PERCENTILE_GATE_COLUMN})`)
```
Never append to `PERCENTILE_ANALYTICS_COLUMNS` — csv-finalize/route.ts:1031/:1488/:1505 prose ("MIRRORING … member for member"; ":1505 `computation_status` … NOT a member of `CLOCK_SAFETY_KPI_COLUMNS`") would be falsified.

**Splat dispositions** (D-02, complete inventory): queries.ts:210 (`getStrategiesByCategory`, ANON) → projection; :310 (`getMyStrategies`, OWNER-only via `.eq("user_id", userId)`) → keep splat + one-line exemption comment; :936 (`getStrategyDetail`, ANON) → projection (retain `computation_status`; resolve `data_quality_flags` tension explicitly — RESEARCH Open Question 2); `compare/page.tsx:68` (AUTHED allocator) → projection. Anon projections exclude `daily_returns`, `metrics_json`, `data_quality_flags`. Full column universe: `src/lib/database.types.ts` `strategy_analytics` Row.

**Anon-read precedent for column-explicitness discipline:** `readPublicVerificationSignals` / SECDEF `get_published_trust_signals` (CONTEXT §Reusable Assets) — RLS is row-level and cannot hide columns (`analytics_read` policy, migration `20260405061912:35-44`, no TO clause).

---

### `supabase/migrations/NEW_..._get_verified_cohort_rank.sql` (RANK-01 SQL)

**Analog:** `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` — the ONLY definition (repo-wide grep verified; re-grep at plan time). Re-base: `CREATE OR REPLACE FUNCTION` with the FULL body, preserving SECURITY DEFINER + `SET search_path = public, pg_catalog` + REVOKE/GRANT + in-fn auth guard + decile quantization + identity strip + self-verifying DO block.

**The lockstep edit:** add `AND a.computation_status IN ('complete', 'complete_with_warnings')` to BOTH cohort predicates — count query (:174-184) AND rank query (:212-227) — or the min-N denominator diverges from the rank numerator (the migration's own :56-62 auditor lesson). Min-N floor `v_min_n CONSTANT INT := 20;` (:152) unchanged. Parity prose (:72-73, :83, :241-242 "parity-by-construction") stays true only with this SQL twin.

**Ordering constraint:** migrations auto-apply to PROD on merge → `159-CENSUS.md` committed BEFORE this migration merges (D-01).

---

### `analytics-service/services/metrics.py` (RANK-05)

**Analog:** `sharpe_vol_status_from_backbone`, `metrics.py:1299-1371` — the P114 closed path D-04 mandates mirroring. Core (:1360-1366):
```python
vol = _safe_float(returns.std() * math.sqrt(periods_per_year))
mean_ret = returns.mean() * periods_per_year
...
sharpe = _safe_float(mean_ret / vol)
```
Its docblock (:1315-1324) names the exact defect ("PRICE-detection heuristic … FLIPS the sign of Sharpe") — copy that docblock discipline to the new sites.

**Two-arm application in `compute_all_metrics`** (kwarg matrix verified against installed 0.0.81; A1: re-verify inside analytics-service CI env):
- HAS `prepare_returns=` → pass `prepare_returns=False` + caller-side cleanup (inf→NaN mostly done upstream; verify per site): `volatility` (:707), `value_at_risk` (:826), `cvar` (:836), `tail_ratio` (:902), `profit_factor` (:966).
- NO kwarg → inline P114 mirror, no new abstraction: `sharpe` (:708), `sortino` (:713), plus `max_drawdown` (:700), `to_drawdown_series` (:702), `omega` (:884), `gain_to_pain_ratio` (:893), `smart_sharpe`/`smart_sortino` (:935/:944).

**NaN convention:** inline skipna vs `_prepare_returns` `fillna(0)` diverge on interior NaN — golden/parity fixture movement (`test_metrics_parity.py`, `test_accuracy.py`, `test_mt5_golden_fixtures.py`, `test_teaser_derive_golden.py`, …) is a FINDING to adjudicate, never a regen.

---

### `src/app/api/strategies/csv-finalize/route.ts` (RANK-07 CAS)

**Analog:** `src/app/api/admin/deletion-requests/[id]/approve/route.ts:341-358` — the house CAS-with-observed-rowcount pattern, verbatim (re-read this session):
```ts
const { data: updatedRows, error: updateErr } = await admin
  .from("data_deletion_requests")
  .update({ completed_at: new Date().toISOString() })
  .eq("id", requestId)
  .is("completed_at", null)
  .is("rejected_at", null)
  .select("id");
if (updateErr) { /* 500, console.error with route-tagged prefix */ }
const rowsAffected = (updatedRows ?? []).length;
```
Apply to the `applyCsvMetadataUpdate` chain (route.ts:2068-2072): append `.is("category_id", null)` + `.select("id")`; `data.length === 0` → distinct `"raced"` result kind, routed into the existing `metaResult.kind !== "applied"` refusal (:2610-2629, `CSV_PERSIST_FAIL`). Never report `"applied"` on 0 rows (BL-01 no-false-receipt). Safe on both arms reaching the UPDATE (fresh row's `category_id` also NULL, :1438). Sibling precedents: `reject/route.ts:163-164`, `create-with-key/route.ts:193`.

---

### `src/lib/wizard/localStorage.ts` + `WizardClient.tsx` (RANK-08)

**Analog:** the fingerprint's own signature scheme — widen in place (localStorage.ts:664-672):
```ts
export function csvSubmissionSignature(
  strategyName: string,
  series: readonly { date: string; daily_return: number }[] | undefined,
): string {
  const rows = (series ?? []).map((r) => `${r.date}=${r.daily_return}`).join("|");
  // NUL separates the two fields so no name/series boundary is ambiguous.
  return `${strategyName} ${rows}`;
}
```
Pattern to extend: more NUL-separated fields for `categoryId` + `assetClass` (D-05 default arm — evidence supports inclusion; the docblock's ":661-662 only fields that reach csv-finalize" claim is FALSE and must be corrected in the same edit). `csvSubmissionFingerprint` (:702-717) is non-cryptographic BY DESIGN (:690-696) — do not "upgrade" it. Both `WizardClient.tsx` call sites (:587, :635) pass the new args AND both dep arrays (:624, :651) gain `categoryId` (:272) / `assetClass` (:294) — stale-dep is the silent failure mode (Pitfall 7).

---

### `src/lib/visibility.ts` (RANK-09)

**Analogs:** `isUuid`/`UUID_RE` in `src/lib/utils.ts:77-83` (house validation — never a new regex):
```ts
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
```
and the fail-closed arm's shape = the module's own `withPublishedOnly` (`.eq("status","published")`). Current interpolation (visibility.ts:115-125): `` .or(`status.eq.published,user_id.eq.${authUserId}`) `` — validate BEFORE `.or()`; malformed → published-only predicate + loud log. Module purity constraint (:17-19): no server-only imports; `utils.ts` is pure and importable; `console.error` is the safe logging floor unless `captureToSentry` is verified client-pure.

---

## Shared Patterns

### Fake-builder test harness (RANK-09, RANK-02 projection pins)
**Source:** `src/lib/visibility.test.ts:1-60` (re-read this session)
```ts
const builder: { or: ReturnType<typeof vi.fn> } = { or: vi.fn(() => builder) };
const result = withPublishedOrOwner(builder, "uid-123");
expect(builder.or).toHaveBeenCalledWith("status.eq.published,user_id.eq.uid-123");
expect(result).toBe(builder); // SAME builder — chain + query type survive
```
New RANK-09 tests: malformed uid (e.g. `"x) or (user_id.neq.z"`) → `.eq("status","published")` called, `.or` NEVER called. Same capture-the-`.select()`-string technique pins RANK-02 projections (harness in `queries.test.ts` / `queries.percentiles.test.ts` thenable-chain mocks).

### Route-level two-writer race harness (RANK-07)
**Source:** `src/__tests__/csv-finalize-cross-submission-merge.test.ts` — imports the real `POST` (:268), drives with `NextRequest` against a mocked supabase builder recording every ordered read (:97); FILL/REFUSE describe at :1417. Race test: both mocked resolves return `category_id: null`; mock honors `.is("category_id", null)` (first update matches, second returns empty data); plus a neuterable wiring pin that the chain received `.is` (remove `.is` → RED).

### Anti-vacuity + oracle laws (ALL new tests)
- Neuter→observe-RED→restore drill for every new pin (founder law).
- Money-math oracles pin ECONOMICS, never the impl's formula: "all-winning series has non-negative Sharpe", "√365 vol = √252 vol × √(365/252) on the same series".
- No test asserts rank DIRECTION (success criterion 2) — membership only (`complete_with_warnings` retained, gated rows excluded).
- Wiring, not just helper: RANK-06 helper test paired with a call-site pin (queries.ts:2985 path).

### MD-01 single-source discipline
Any new set/constant joins `src/lib/closed-sets.ts` (TS) or `analytics-service/services/closed_sets.py` (Python) — never a second literal. Venue-adjacent Python logic imports `CRYPTO_VENUES`.

### Migration hygiene
Full-body `CREATE OR REPLACE` re-based on the LATEST definition (grep ALL migrations first); preserve SECDEF + search_path + REVOKE/GRANT + self-verifying DO block; census-before-merge ordering.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `159-CENSUS.md` | phase artifact | — | Close-by-measurement precedent (v1.19) exists as a PROCESS, not a copyable file. Use RESEARCH.md §Code Examples census SQL verbatim; counts/percentiles/strategy-ids ONLY (repo public, `.planning/` tracked). PROD execution path = Open Question 1 (plan as emitted-SQL + human-verify step). |

## Metadata

**Analog search scope:** `src/lib/`, `src/app/api/`, `src/app/(dashboard)/`, `supabase/migrations/`, `supabase/tests/`, `analytics-service/services/`, test harnesses — leveraging RESEARCH.md's verified-at-HEAD inventory plus 3 direct analog reads this session.
**Files scanned:** ~25 (research-verified) + 3 re-read directly
**Pattern extraction date:** 2026-08-21
