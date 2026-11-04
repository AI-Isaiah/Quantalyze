# Phase 190: FACTSHEETQUEUED - Pattern Map

**Mapped:** 2026-11-03
**Files analyzed:** 17 (new + modified, incl. tests and measurement files)
**Analogs found:** 17 / 17 (all in-repo; every analog path below is git-tracked source)

Line numbers are at worktree HEAD (`53f25ac3e`). Cite by symbol in plans where the file is large; numbers drift.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/finalize-rerun.ts` (NEW, `decideFinalizeRerun`) | utility (pure-ish decision + admin reads) | request-response (DB read → verdict) | `compositeMemberCount` in `src/app/api/strategies/finalize-wizard/route.ts:2435-2471`; `isFactsheetJobInFlight` / `FACTSHEET_CHAIN_KINDS` in `src/lib/compute-state.ts:40-46, 396-401, 464-468` | role-match |
| `src/lib/finalize-rerun.test.ts` (NEW) | test (truth table) | transform | `src/lib/strategyGate.test.ts` (`BASE: StrategyGateInput` + per-arm `it`) | exact |
| `src/app/api/strategies/finalize-wizard/route.ts` (MOD: `runLegacyFinalize` after() enqueue; asset_class old/new compare) | controller (route handler) | event-driven (`after()` side effect) | itself, `enqueue_sync_trades_job` side effect `:2236-2342`; asset_class write `:1317-1365` | exact (in-place) |
| `src/app/api/strategies/finalize-wizard/route.test.ts` (MOD) | test (route) | event-driven | itself: `STATE.runAfterCallback` + `flushAfter()` `:553-569, 697-701`; contribution enqueue test `:3429-3456` | exact |
| `src/lib/closed-sets.ts` (MOD: `isRecomputeOverStoredResult`) | utility (closed-set predicate) | transform | `isComputedAnalytics` `:781-785`, `isRankableAnalyticsRow` `:824-828` | exact |
| `src/lib/factsheet/fetch-and-build-payload.ts` (MOD: G1 + `analyticsUpdating`) | service (SSR resolve stage) | request-response | itself, G1 `:419-428`, `NotBuildableDetail.analyticsFailed` `:105-115, 149` | exact |
| `src/lib/factsheet/composite-read-path.ts`, `headline-basis.ts`, `v2-joint.ts` (MOD: take resolved decision) | service | transform | same files' raw-status gates (RESEARCH table, `composite-read-path.ts:550, 761, 1256-1366`, `headline-basis.ts:209`, `v2-joint.ts:186`) | exact |
| `src/lib/factsheet/types.ts` (MOD: `FactsheetPayload.analyticsUpdating: boolean`) | model (type) | — | `computedAt` / `tradesFetchedAt` fields `:585-593` | exact |
| `src/app/factsheet/[id]/v2/page.tsx` (MOD: cache key v19 → v20) | route (RSC page) | request-response (cached) | itself `:271`, `:588`, `:621` | exact |
| `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` (MOD) | test | — | itself `:288, 324, 345` | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (MOD: updating line) | component | request-response (payload render) | `SeriesRecencyLine` `:1628`; header wrapper `:1304-1320` | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.updating-line.test.tsx` (NEW) | test (component) | — | `FactsheetView.recency-line.test.tsx` | exact |
| `src/lib/status-surface-copy.ts` (MOD: `ANALYTICS_UPDATING_LINE`) | config (copy constant) | — | `KCS10_PUBLIC_SENTENCE` `:614-617` | exact |
| `src/lib/status-surface-copy.test.ts` (MOD) | test (verbatim pin) | — | `KCS10_PUBLIC_SENTENCE` pin `:590-593` | exact |
| `src/app/factsheet/[id]/v2/page.stale-analytics.test.tsx` (MOD: re-cut V3, add SC-4 arm) | test (RSC page) | — | itself, V1/V3/V4 `:192-283` | exact |
| `src/lib/strategyGate.ts` + `src/app/api/admin/strategy-review/route.ts` + `src/lib/strategyGate.test.ts` (MOD, D-02 approval arm) | utility + controller + test | request-response | `seriesCompleteness` required-nullable input `strategyGate.ts:60-77`; caller `admin/strategy-review/route.ts:251-260, 385-390` | exact |
| `src/lib/queries.ts` `shapeRowAnalytics` (MOD, only if Open Question 1 widens to lists) | service (shaper) | transform | itself `:690-715` | exact |
| `.planning/phases/190-…/190-MEASUREMENT-marker.sql` + `190-MEASUREMENT.sql` (NEW, SC-1 / SC-5) | measurement (read-only SQL) | batch (count) | `.planning/phases/166.5-computedatstamp-…/166.5-MEASUREMENT-marker.sql`, `166.5-MEASUREMENT.sql`, recorded in `166.5-08-SUMMARY.md` | exact |

---

## Pattern Assignments

### `src/lib/finalize-rerun.ts` (NEW, utility)

**Analog A — admin count read that fails loud** (`finalize-wizard/route.ts:2435-2471`, `compositeMemberCount`):
```ts
async function compositeMemberCount(
  admin: ReturnType<typeof createAdminClient>,
  strategyId: string,
): Promise<number> {
  const { count, error: countErr } = await admin
    .from("strategy_keys")
    .select("*", { count: "exact", head: true })
    .eq("strategy_id", strategyId);
  if (countErr || count === null) { ... throw new Error(reason); }
  return count;
}
```
Copy the signature shape (`admin: ReturnType<typeof createAdminClient>`, `strategyId`) and the "null without error is NOT a fact" discipline. **Invert the fail direction** per RESEARCH: a read error returns `{ enqueue: true, reason: "read_failed" }`, it never throws and never skips.

**Analog B — the pinned job-status/kind sets** (`src/lib/compute-state.ts`):
```ts
export const FACTSHEET_CHAIN_KINDS = [
  "process_key_long", "sync_trades", "derive_broker_dailies",
  "compute_analytics_from_csv", "compute_analytics",
] as const;                                                      // :40-46

const IN_FLIGHT_JOB_STATUSES = [                                 // :396-401 (NOT exported)
  "pending", "running", "failed_retry", "done_pending_children",
] as const satisfies readonly ComputeJobStatus[];

export function isFactsheetJobInFlight(status: string | null | undefined): boolean {
  return isOneOf(IN_FLIGHT_JOB_STATUSES, status);                // :464-468
}
```
Use `FACTSHEET_CHAIN_KINDS` (+ `"stitch_composite"` for a composite) as the `.in("kind", …)` set and filter rows client-side with `isFactsheetJobInFlight` — do not re-type a status list (Don't Hand-Roll). If a server-side `.in("status", …)` is wanted, export `IN_FLIGHT_JOB_STATUSES` rather than copying it.

**Terminal-success test:** `isComputedAnalytics` from `@/lib/closed-sets` (never `=== "complete"`).

**Verdict type:** discriminated union, as RESEARCH Pattern 1:
`{ enqueue: true; reason: "no_terminal_success" | "asset_class_changed" | "read_failed" } | { enqueue: false; reason: "already_current" | "chain_in_flight" }`.

### `src/lib/finalize-rerun.test.ts` (NEW)

**Analog:** `src/lib/strategyGate.test.ts` lines 1-40: imports the function + its input type, builds one `BASE` input, then each `it` spreads `{ ...BASE, <one change> }` and asserts the code. Mirror that: one passing-through `BASE` fake admin, one arm per verdict reason. Each arm's comment says WHY (Rule 9): e.g. "a `complete` row with nothing in flight must NOT enqueue — that redundant run is what blanked the founder's factsheet".

---

### `src/app/api/strategies/finalize-wizard/route.ts` (MOD)

**Enqueue site** (`:2316-2340`, single key) and composite twin (`:2253-2315`) inside the `sideEffects` entry `label: "enqueue_sync_trades_job"`:
```ts
          if (!keyLink?.api_key_id) return;
          const { error: enqueueErr } = await admin.rpc(
            "enqueue_compute_job",
            {
              p_strategy_id: resolvedId,
              p_kind: "sync_trades",
              p_metadata: { source: "finalize-wizard" },
            },
          );
          if (enqueueErr) {
            throw new Error(`enqueue_compute_job failed: ${enqueueErr.message}`);
          }
```
Insert the `decideFinalizeRerun` call before each enqueue (after `compositeMemberCount`, which stays first — its fail-closed stamp must still run). Skip path: `console.info("[strategies/finalize-wizard] analytics already current; no re-run queued (<reason>)")` then `return` — follows the file's `[strategies/finalize-wizard] …` log-prefix convention (e.g. `:2296`, `:1319`). `notify_founder_new_strategy` and the `api_keys` touch side effects stay unconditional. Note the composite branch also runs `retractInheritedRefreshMarker` and `logAuditEventAsUser(... "sync.start" ...)` — both belong only on the enqueue path.

**Sentry capture shape** if the decision reads need their own capture (copy from `:2287-2298`):
```ts
captureToSentry(err, {
  tags: { surface: "finalize-wizard-after", side_effect: "<name>" },
  extra: { strategy_id: resolvedId, correlation_id: correlationId },
});
```

**asset_class change detection** (`:1317-1365`): the write is
```ts
const { error: assetClassErr } = await supabase.from("strategies").update({
  asset_class: apiKeyId ? (isCryptoExchange(attestedVenue) ? "crypto" : "traditional")
    : isCompositeForAssetClass ? "crypto" : fields.asset_class,
}).eq("id", fields.strategy_id).eq("user_id", user.id);
```
Read the old value before it, compute the new value into a local, compare → `assetClassChanged`. A failed old-value read means `assetClassChanged = true` (fail toward enqueue). **Constraint at `:1338-1341`:** the `@audit-skip` pragma must stay within 8 lines of the mutation (`audit-coverage.test.ts`); put new code ABOVE the comment block, never between pragma and `.update`. `skipAssetClassWrite` (`:1317`) ⇒ nothing changed ⇒ `false`.

**Threading:** `runLegacyFinalize(args: { supabase; user; fields; terminalStatus? })` at `:2026-2035` — add `assetClassChanged: boolean` as a REQUIRED arg (compile error at every call site, the `seriesCompleteness` precedent).

### `src/app/api/strategies/finalize-wizard/route.test.ts` (MOD)

**after() harness** (`:553-569`, `:697-701`):
```ts
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual,
    after: (fn: () => unknown) => {
      if (STATE.runAfterCallback) {
        STATE.afterPromise = Promise.resolve().then(fn).catch(() => {});
      }
    },
  };
});
async function flushAfter(): Promise<void> {
  if (STATE.afterPromise) await STATE.afterPromise;
}
```
Note `.catch(() => {})` swallows a throw inside the callback — a RED test must assert on `STATE.adminRpcCalls`, not on a rejection.

**Test shape to copy** (`:3429-3456`, contribution keeps its enqueue):
```ts
const fetchSpy = mockProbeReadOnly();
STATE.strategyRow = { api_key_id: API_KEY_ID };
STATE.strategyKeysCount = 0;
STATE.adminApiKeyId = API_KEY_ID;
STATE.runAfterCallback = true;
const POST = await importPost();
const res = await POST(makeReq({ ...VALID_BODY, entry_context: "contribution" }));
expect(res.status).toBe(200);
await flushAfter();
expect(STATE.adminRpcCalls.find((c) => c.name === "enqueue_compute_job" &&
  (c.args as { p_kind?: string }).p_kind === "sync_trades")).toBeDefined();
fetchSpy.mockRestore();
```
SC-2 RED test = same body with a `complete` analytics row + no in-flight jobs, asserting `.toBeUndefined()`. Composite variant uses `routeThroughLegacyFinalize()` (used at `:3463`).

**Mock gaps to fill (must extend, else new reads hit the default branch):** the admin `from()` (`:306+`) handles `strategy_analytics` with **only `upsert`** (`:409-417`) and `compute_jobs` with **only `select().eq().maybeSingle()` and `update`** (`:419+`, used by the refresh-marker retraction). New `STATE` fields (e.g. `analyticsStatusRow`, `analyticsReadError`, `chainJobs`, `chainJobsReadError`) plus `select().eq().maybeSingle()` on `strategy_analytics` and a list-returning `select().eq().in()` on `compute_jobs` are needed, reset in the `beforeEach` at `:615-641`. Keep the existing `maybeSingle` path intact (retraction). The existing `:3429` test must still pass with default STATE = "no analytics row" (Pitfall 5).

---

### `src/lib/closed-sets.ts` (MOD)

**Analog** (`:781-785`, `:824-828`):
```ts
export function isComputedAnalytics(status: string | null | undefined): boolean {
  return status === "complete" || status === "complete_with_warnings";
}
export function isRankableAnalyticsRow(row: { computation_status?: string | null } | null | undefined): boolean {
  return isComputedAnalytics(row?.computation_status);
}
```
Add `isRecomputeOverStoredResult(status, hasStoredResult)` directly after `isComputedAnalytics`, with a JSDoc in the same voice. Beside `isRankableAnalyticsRow` (its "Change one, change the other" note at `:819-823`) add one line recording that ranking stays on terminal success during a re-run (Open Question 2). Do NOT widen either existing function.

### `src/lib/factsheet/fetch-and-build-payload.ts` (MOD)

**G1 today** (`:419-428`):
```ts
  if (!isComputedAnalytics(analytics?.computation_status)) {
    console.warn(
      `[factsheet] resolve(${caller}) — analytics row is not a terminal success; withholding the payload`,
      { id, caller, computationStatus: analytics?.computation_status ?? null },
    );
    return notBuildable(
      "not_computed",
      analytics?.computation_status === "failed" ? { analyticsFailed: true } : {},
    );
  }
```
Change to: compute `analyticsUpdating = isRecomputeOverStoredResult(status, hasStoredResult)`; withhold only when `!isComputedAnalytics(status) && !analyticsUpdating`. The comment block above (`:400-418`, "`computing` is included for the reason `shapeRowAnalytics` gives") must be rewritten, not left contradicting the code. `hasStoredResult` = stored series entry count > 0 (reuse the existing counting helper ~`:160-230` / `resolveDailyReturnSeries`) AND finite `cumulative_return` (on the embed ~`:338-339`). The `ok: true` result (`:642`) gains `analyticsUpdating`; the not-buildable detail plumbing (`:105-115`, `:149`, `:743-744`, `:778`) is the precedent for threading an optional field through both result shapes.

**Inner gates:** pass one resolved boolean (e.g. `analyticsDone = isComputedAnalytics(s) || analyticsUpdating`) into `composite-read-path.ts` (`singleKeyBasisOpts :761`, series gates `:1256-1366`, `headlineVerdict :550`), `headline-basis.ts:209` `storedCashHeadlineGate`, `v2-joint.ts:186`. One variable everywhere; no half-raw-status gates (RESEARCH Pattern 2). Pitfall 3 may keep basis-series reads terminal-gated — decide explicitly.

### `src/lib/factsheet/types.ts` (MOD)
Add `analyticsUpdating: boolean` next to `computedAt` (`:585`) with a JSDoc in the `tradesFetchedAt` style (`:589-593`: "Distinct from `computedAt` …"). Non-optional so every payload builder (incl. `buildScenarioFactsheetPayload`, used as a test fixture source) is forced to set it.

### `src/app/factsheet/[id]/v2/page.tsx` + `page.public-cache-key.test.tsx` (MOD)
```ts
["factsheet-v2-payload-v19", id, computedAt, tradesFetchedAt ?? "none", provenanceKey, computationStatus],  // page.tsx:271
```
Bump to `v20`, update the header comment at `:264` per its convention. Test pins at `page.public-cache-key.test.tsx:288, 324, 345` move to `v20`. Do not touch `unstable_cache` usage (`phase-148-owner-lane-cache-isolation.test.ts`).

### `src/app/factsheet/[id]/v2/FactsheetView.tsx` (MOD)

**Placement** (header wrapper `:1304-1310`):
```tsx
<div>
  <FreshnessChip computedAt={payload.computedAt} seriesDates={payload.dates} />
  <SeriesRecencyLine seriesDates={payload.dates} />
  {/* NEW: after SeriesRecencyLine, before TradeFetchLine (UI-SPEC, not RESEARCH Pattern 3) */}
  <TradeFetchLine tradesFetchedAt={payload.tradesFetchedAt} tradeFetchVenue={payload.tradeFetchVenue} />
```
**Style analog** (`:1628`):
```tsx
<p className="mt-1 text-caption text-text-muted">Track record through {end.formatted}</p>
```
New: `{payload.analyticsUpdating === true && <p className="mt-1 text-caption text-text-muted" data-testid="factsheet-analytics-updating">{ANALYTICS_UPDATING_LINE}</p>}`. testid convention: `factsheet-…` (cf. `:1133` `factsheet-usd-unpriced-note`). No role/aria-live. `payload` here is the native payload already resolved in `FactsheetHeader` (UI-SPEC).

### `src/app/factsheet/[id]/v2/FactsheetView.updating-line.test.tsx` (NEW)

**Analog:** `FactsheetView.recency-line.test.tsx`. Copy its imports (lines 1-7), the `populatedPayload` / `emptySeriesPayload` fixtures built from `buildScenarioFactsheetPayload` (`:~120-156`), and these helpers verbatim:
```tsx
function renderFactsheet(payload: FactsheetPayload) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <FactsheetBody payload={payload} hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}
function chipRoot(container: HTMLElement): HTMLElement { /* via '[class*="tracking-[0.18em]"]' parentElement */ }
function recencyLine(container: HTMLElement): HTMLElement | null { /* header p starting with RECENCY_PREFIX */ }
```
Assertions mirror F-1 (`:193-224`): exact `textContent` against a **literal typed in the test** (ORACLE INDEPENDENCE — do not import the constant for the text oracle; the copy test is where the constant is pinned), className, `getAttribute("role")`/`"aria-live"` null, sibling order, and `expect(chip.nextElementSibling).toBe(line)` still holding with the flag true. Header doc comment states WHY in numbered points, as the analog does.

### `src/lib/status-surface-copy.ts` + `status-surface-copy.test.ts` (MOD)
**Analog** (`status-surface-copy.ts:614-617`):
```ts
/** True in every state, no timing, no internal state (KCS10-PUBLIC). */
export const KCS10_PUBLIC_SENTENCE =
  "The detailed factsheet for this strategy is not available yet.";
```
Add `ANALYTICS_UPDATING_LINE` with a JSDoc naming phase 190 / D-03 and the UI-SPEC row. File header rule (`:7-10`): change a string only with its UI-SPEC row and its pin in the same commit; ASCII apostrophes; no client directive.
**Pin analog** (`status-surface-copy.test.ts:590-593`):
```ts
expect(KCS10_PUBLIC_SENTENCE).toBe("The detailed factsheet for this strategy is not available yet.");
const lower = KCS10_PUBLIC_SENTENCE.toLowerCase();
for (const banned of [...]) expect(lower).not.toContain(banned);
```
Add the import to the block at `:3-16`; pin verbatim + `not.toContain("…")`.

### `src/app/factsheet/[id]/v2/page.stale-analytics.test.tsx` (MOD — Pitfall 1)
Harness: `strategyRow(computationStatus)` (`:~83`, sets `daily_returns: CASH_DAILY`, `computation_status`), `renderPage(status)` (`:180-183`), `findPayload(ui)` / `collectText(ui)` walkers (`:~140-178`).
Today's pin (`:259-263`):
```ts
it("V3: a live `computing` run is withheld the same way", async () => {
  const ui = await renderPage("computing");
  expect(findPayload(ui)).toBeNull();
});
```
Re-cut V3: `computing` over the stored fixture (it has a series + headline) ⇒ payload non-null and `payload.analyticsUpdating === true`. Add V3b/V3c: `computing` and `pending` with NO stored series/headline ⇒ `findPayload(ui)` null (SC-4). V1 (`failed` ⇒ null) and V4/V5 controls stay; assert `analyticsUpdating === false` on V4. `strategyRow` needs a param (or variant) to null the series/headline. ⚠️ This file already contains a PROD-shaped id in V2b's title; do not copy it into new tests.

### `src/lib/strategyGate.ts` + `admin/strategy-review/route.ts` + `strategyGate.test.ts` (MOD, D-02 literal)
**Input precedent** (`strategyGate.ts:60-77`): JSDoc'd "REQUIRED and NULLABLE, deliberately. Required so a caller that 'forgot' to read it is a compile error…" — add e.g. `hasStoredResult: boolean` the same way. Arms to change: `:519-535` (`pending` → `ANALYTICS_PENDING`, `computing` → `ANALYTICS_COMPUTING`) pass when the stored result exists.
**Caller** (`admin/strategy-review/route.ts:251-260`) builds the input from `analytics?.…`; the re-check at `:385-390` (`if (!isComputedAnalytics(recheckAnalytics?.computation_status)) … 409 REVIEW_RECHECK_FAILED`) must change in the same commit. Second caller `SyncPreviewStep.tsx:2043` also must supply the new field (compile error forces it).
**Tests:** existing `ANALYTICS_PENDING` / `ANALYTICS_COMPUTING` arms at `strategyGate.test.ts:179, 618, 623` stay for `hasStoredResult: false`; add passing arms for `true`. Also check `strategyGate.invariant.test.ts`.

### `src/lib/queries.ts` `shapeRowAnalytics` (MOD only if lists are in scope)
`:696-715`: `if (isRankableAnalyticsRow(a)) { … return { ...withResolvedSeriesEnd(a), native_unit }; }` then the `failed / pending / computing` blanking arm whose comment says the `computing` premise is under review. Same predicate, same evidence rule; matching pins in `queries.stale-analytics-detail.test.ts` and `StrategyTable.stale-analytics.test.tsx`.

---

### `190-MEASUREMENT-marker.sql` + `190-MEASUREMENT.sql` (NEW, SC-1 before / SC-5 after)

**Analog:** `.planning/phases/166.5-computedatstamp-the-analytics-runner-stamps-strategy-analyti/166.5-MEASUREMENT-marker.sql` (tracked), copy verbatim with the phase number swapped:
```sql
                                    -- first line blank on purpose (CLI inline form breaks on leading --)
-- header: READ-ONLY; run alone and first; proceed only on `marker OK`
DO $marker$
DECLARE
  v_marker TEXT;
BEGIN
  SELECT shobj_description(d.oid, 'pg_database') INTO v_marker
    FROM pg_database d WHERE d.datname = current_database();
  IF v_marker IS NULL
     OR v_marker !~* 'prod'
     OR v_marker ~* '(^|[^[:alnum:]_])test([^[:alnum:]_]|$)' THEN
    RAISE EXCEPTION '<phase> measurement refused: the database identity marker is missing or does not name PRODUCTION. Nothing was read. ...';
  END IF;
END
$marker$;
SELECT 'marker OK' AS which_database_check;
```
Key properties to keep: the refusal literal never echoes the marker text; the marker text is never copied into a tracked file.

**Count file** mirrors `166.5-MEASUREMENT.sql` header discipline: "READ-ONLY: one SELECT … The CLI returns only the LAST statement, so this file is ONE statement"; "PUBLIC REPO: it selects counts and version strings only. No strategy id, key id, email … may be added"; a DEFINITIONS block (here: "finalize job", "prior compute done", and the 30-day `done` retention limit). Body = the RESEARCH SC-1 query (counts per `kind`, `min/max(created_at)::date`), no id column. Run from the main checkout: `supabase db query --linked -f <file>`.
**Recording:** like `166.5-08-SUMMARY.md` (`:12-13, 58, 103-105`): record the UTC run time, "marker OK first, nothing written", and the table; verify locally first (`psql -X -v ON_ERROR_STOP=1 -f` on the local stack: marker RAISEs, count returns one row per kind) and a "tracked-SQL uuid-literal count 0" grep. ⚠️ Do NOT follow `160-CENSUS.md`: it writes the project ref into tracked text, which current rules forbid.

---

## Shared Patterns

### Fail toward the needed run (Rule 12)
**Source:** RESEARCH Pattern 1 + `compositeMemberCount` (`route.ts:2435`). Apply to `decideFinalizeRerun`: any read error ⇒ enqueue; null-without-error is not "no rows".

### Closed-set predicates, never inline status strings
**Source:** `closed-sets.ts:781-828`, `compute-state.ts:40-46, 396-468`. Apply to every new status check (route helper, resolve stage, gate, shaper). The SI-01 census grep catches exact `=== "complete"` matches.

### Copy single-sourced and pinned
**Source:** `status-surface-copy.ts` header (`:1-20`) + `status-surface-copy.test.ts` ORACLE INDEPENDENCE (`:19-25`). Apply to the updating line (FactsheetView and, if widened, the tear sheet import the constant; tests type the literal).

### Row state, never lane state, in the cached payload
**Source:** `page.tsx:264-271` keyParts; `unstable_cache` cannot read request data. Apply to `analyticsUpdating` (derived inside the builder from the same row).

### Log prefix
`[strategies/finalize-wizard] …` for the route; `[factsheet] resolve(${caller}) — …` for the resolve stage.

### Tests must be able to fail
Neuter the condition, see RED, restore from a byte backup (never git checkout/restore/stash). Applies to SC-2 route test, SC-3 V3 re-cut, the updating-line test.

## No Analog Found

None. Every file has an in-repo analog. Closest-to-novel: the `compute_jobs` list read inside `decideFinalizeRerun` (no existing route reads in-flight chain jobs by `.in("kind", …)` via the admin client in this route; the route test mock has no list-returning `compute_jobs` branch and must gain one).

## Metadata

**Analog search scope:** `src/app/api/strategies/finalize-wizard/`, `src/lib/` (closed-sets, compute-state, strategyGate, status-surface-copy, queries, factsheet/), `src/app/factsheet/[id]/v2/`, `src/app/api/admin/strategy-review/`, `.planning/phases/*` measurement records.
**Files scanned:** ~25
**Pattern extraction date:** 2026-11-03
