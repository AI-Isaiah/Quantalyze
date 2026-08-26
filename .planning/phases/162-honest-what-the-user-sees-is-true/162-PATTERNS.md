# Phase 162: HONEST — What the user sees is true — Pattern Map

**Mapped:** 2026-08-25
**Files analyzed:** 14 to create/modify (+2 test-only)
**Analogs found:** 13 / 14 (the one gap is the D-162-3 use-existing-key RPC — closest analog is `create_wizard_strategy` itself, quoted below)

All citations read at HEAD this session (tree byte-identical to merged `origin/main`, v0.73.0.0 — see 162-RESEARCH.md Working-Tree State).

## File Classification

| New/Modified File | Req | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `analytics-service/services/job_worker.py` (classify_exception unknown arms `:828,:831` + ~18 `_stamp_strategy_analytics_failed` call sites) | HONEST-01 | service (worker) | event-driven job | InvalidToken arm `job_worker.py:698-703` + `curated_gateway_detail` arm `:743-744` | exact (same file, same function) |
| `analytics-service/routers/portfolio.py` (`_fail` catch-all `:1191`) | HONEST-01 | service (worker) | event-driven job | same curated-copy arms as above | role-match |
| `supabase/migrations/` NEW (only if bridge copy semantics change) | HONEST-01 | migration | batch | `20260825150000_sync_status_protect_marked_refresh.sql` (LATEST def — re-base here, NOT 20260802120000) | exact |
| `analytics-service/tests/` new pytest cases | HONEST-01 | test | — | existing classify/stamp suites (`tests/test_computing_started_at_stamp.py`) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (series-recency line, D-162-2) | HONEST-02 | component | request-response (RSC render) | `FreshnessChip` in same file `:843-877` | exact (adjacent) |
| Data repair / recompute of 15 example rows (ops task, not a code file) | HONEST-03 (D-162-1) | migration/ops | batch | phase-159 C-M1 read-only census pattern (`.planning/phases/159-*/159-CENSUS.md`) | role-match |
| `src/components/strategy/StrategyTable.tsx` (optional `is_example` badge guard; `onFinishSetup(keyId)`) | HONEST-03/06 | component | request-response | its own `hasComputedAnalytics` gate `:969,:1158` | exact |
| `src/components/strategy/StrategyGrid.tsx` (ungated SyncBadge `:110`, no page consumer — cover if guard ships) | HONEST-03 | component | request-response | StrategyTable gate | exact |
| `src/app/(dashboard)/portfolios/[id]/page.tsx` (`buildEquityCurveSeries` `:211-231`) | HONEST-04 | component (RSC) | request-response transform | `isRankableAnalyticsRow` + `resolveDailyReturnSeries` + cumprod fold | exact composites |
| `src/lib/queries.ts` (`getPortfolioStrategies` reduce `:2092-2103`) | HONEST-04 | service (query layer) | request-response | `_rs`/`_dr` strip idiom `:2255-2278` | exact (same file) |
| `src/app/api/strategies/[id]/returns/route.ts` (widen select + gate scalars) | HONEST-05 | route | request-response | its own select `:257-259` + `deriveEmptySeriesState` routing `:322-369` | exact (same file) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (`addedMetricsById`) | HONEST-05 | component (client) | request-response lazy fetch | `addedProvenanceById` `:1134-1146` + purge in `handleRemoveAdded` | exact |
| `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` (preselect prop) + `MyStrategiesSection.tsx`/`MyStrategiesEmptyState.tsx` mounts + `WizardClient.tsx` seam | HONEST-06 | component (client) | request-response | overlay `key={...}` remount idiom `:244-250`; `apiKeyId` state `WizardClient.tsx:246-248` | exact |
| NEW use-existing-key server path (new arm in `create-with-key/route.ts` and/or a new service-role RPC migration) | HONEST-06 (D-162-3) | route + migration | request-response write | `resolveByVenueIdentity` + `rpcAdmin.rpc("create_wizard_strategy")` `create-with-key/route.ts:199-328, :881` | role-match (highest-risk file; no exact analog exists) |
| test files per RESEARCH Validation map (StrategyTable.stale-analytics, returns/route R4/R4b/R10, new overlay preselect spec, portfolio equity spec) | all | test | — | named existing specs | exact/extend |

## Pattern Assignments

### REQUIRED SHARED ANALOG — the STALE-01 gate (HONEST-04 AND HONEST-05 must quote-apply this, not name-drop it)

**Source:** `src/lib/closed-sets.ts:747-751, 786-790` — verbatim:

```ts
export function isComputedAnalytics(
  status: string | null | undefined,
): boolean {
  return status === "complete" || status === "complete_with_warnings";
}
```
```ts
export function isRankableAnalyticsRow(
  row: { computation_status?: string | null } | null | undefined,
): boolean {
  return isComputedAnalytics(row?.computation_status);
}
```

**Its application shape** — `shapeRowAnalytics` (`src/lib/queries.ts:440-475`), applied on the browse read at `queries.ts:348` (`analytics: shapeRowAnalytics(a, s.id)`):

```ts
export function shapeRowAnalytics(
  a: StrategyAnalytics | null,
  strategyId: string,
): StrategyAnalytics {
  if (a === null) return { ...EMPTY_ANALYTICS, strategy_id: strategyId };
  if (isRankableAnalyticsRow(a)) return a;
  // failed / pending / computing — a run that did not produce these numbers.
  return {
    ...EMPTY_ANALYTICS,
    strategy_id: strategyId,
    computation_status: a.computation_status,
  };
}
```

The call shape is: **derive the row's allowed claims BEFORE handing values to any render/serialize path; the failed arm withholds values but keeps the status.** The commit's rule: "the row denied a rank, the row denied its list cells and the row denied its DETAIL cells are the same row, decided once." Extend, never fork. A plan that says "apply the gate" must show either `shapeRowAnalytics(...)` on the row or `isRankableAnalyticsRow(a) ? ... : null` at the value site. Its docblock (`closed-sets.ts:765-769`) explains why a NULL check is NOT a substitute: failed rows still hold sharpe/cagr corpses (measured 17/18 in PROD).

---

### `analytics-service/services/job_worker.py` — HONEST-01, D-162-4 strict (~18 call sites)

**Analog A — fixed-copy arm (the target shape), `job_worker.py:694-702` verbatim:**

```python
    # Fernet InvalidToken means the DEK cannot be unwrapped with the
    # current KEK — either a key rotation mismatch or a corrupted row.
    # The raw exception string is NOT safe to render (older fernet
    # versions included token bytes in error text). Ship a fixed message.
    if isinstance(exc, InvalidToken):
        return (
            "permanent",
            "Credentials could not be decrypted — key may have rotated",
        )
```

**Analog B — curated allow-list family, `job_worker.py:743-744`:**

```python
    if isinstance(exc, Mt5GatewayMisconfigured):
        return ("permanent", curated_gateway_detail(exc))
```

Its docblock (`:723-733`) states the rule to copy: "Ships a message read through an ALLOW-LIST (`curated_gateway_detail`), never a bare str(exc) … any text originating upstream is a credential-disclosure surface". Anything outside the family degrades to a generic constant.

**The arms to fix (bottom of `classify_exception`), `:827-831` verbatim:**

```python
    if isinstance(exc, ccxt.BaseError):
        return ("unknown", str(exc)[:500])

    # Everything else (RuntimeError, ValueError, KeyError, ...).
    return ("unknown", str(exc)[:500])
```

⚠️ `error_kind` handling must NOT change — `"unknown"` drives retry classification (RESEARCH Code Examples). Fix the message slot only; raw string to logs/Sentry.

**The prefixed-`scrubbed` writer family (D-162-4 in-scope).** `_stamp_strategy_analytics_failed` call sites — enumerated this session, 18 total: `:2746, :3054, :3167, :3229, :3675, :3700, :3727, :3840, :3863, :3891, :4256, :4292, :4305, :4336, :4377, :4996, :5101`. Canonical current shape (`:3699-3704` verbatim):

```python
                scrubbed = str(scrub_freeform_string(str(exc)))
                await _stamp_strategy_analytics_failed(
                    "Deribit ledger contained a transaction that could not be "
                    "processed (unvaluable coin cash, undatable, or schema drift). "
                    + scrubbed
                )
```

Target shape per D-162-4: keep the typed human sentence, drop the `+ scrubbed` suffix from the STAMP (user-readable column); keep the scrubbed detail in the `DispatchResult.error_message` / logs (the same block already writes it there at `:3707-3709`). The stamp helper itself (`:2874-2877`) is the ONE choke point (161.1 CR-02) — if suffix-stripping can be done inside the helper, prefer that over 18 point edits; the helper already re-scrubs (`scrubbed = str(scrub_freeform_string(message))`), so a `detail=` kwarg split there mirrors the choke-point discipline. ⚠️ Anti-vacuity gate regions around `:2855-2874` — count gate tokens PRE-edit (pitfall 7).

**Curated writers that must NOT be reworked** (already fixed copy): CSV runner literals `analytics_runner.py:2079,2114` and typed arms `:1979,:2023`; reaper literal `20260802120000:508`; TS routes `finalize-wizard/route.ts:2294,2367`, `keys/sync/route.ts:552`.

---

### `analytics-service/routers/portfolio.py` — HONEST-01 second writer

**The leak, `:1191` verbatim:** `_fail(f"{type(exc).__name__}: {str(exc)[:400]}")`

**The writer it feeds, `:692-700` verbatim:**

```python
    def _fail(error_msg: str) -> None:
        # @audit-skip: compute-job failure state.
        # error_msg is bounded to ~500 chars to keep the column readable.
        supabase.table("portfolio_analytics").update(
            {
                "computation_status": ComputationStatus.FAILED.value,
                "computation_error": error_msg[:500],
            }
        ).eq("id", analytics_id).execute()
```

**User render (do not change; it displays whatever the column holds):** `src/app/(dashboard)/portfolios/[id]/page.tsx:138-140` — `Showing last-good data.{error ? ` Error: ${error}` : ""}`. Same fix shape as Analog A: fixed user copy into `_fail`, raw `type/str(exc)` to `logger.exception` (already present at `:1193`).

---

### SQL bridge (only if `computation_error` copy semantics change) — HONEST-01

**Analog / re-base target:** `supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql` — the LATEST live definition of `sync_strategy_analytics_status` (verified applied to PROD, RESEARCH §Working-Tree State). Five historical definitions exist; grep ALL migrations and `CREATE OR REPLACE` from this one only (project rule ⭐). The verbatim-copy seam being inherited is branch (b) of the 20260802120000 lineage (`:392-394`): `VALUES (p_strategy_id, 'failed', v_latest_error, NULL)` — and the 150000 protected branch ALSO writes `computation_error` (COALESCEd `last_error`). ⚠️ RETRACTED 2026-08-26 (measured): this previously said the bridge needs no change because "it copies what it is given". It is NOT given the Python stamp — branch (b) fires inside `mark_compute_job_failed` AFTER the writer and overwrites `computation_error` from `compute_jobs.last_error`; branch (b-prime) writes it too. The bridge IS the write boundary and MUST change. A bridge edit auto-applies to PROD on merge — that cost is now unavoidable, not a reason to prefer the writer-only route. See `162-02-DECISION.md`.

---

### `src/app/factsheet/[id]/v2/FactsheetView.tsx` — HONEST-02 (D-162-2 "Track record through {date}")

**Analog:** `FreshnessChip` in the same file, `:843-877`. The two-row chip layout to sit beside/extend (label row + mono value row) — verbatim from the sentinel arm:

```tsx
      <div>
        <div className="flex items-center justify-end gap-1.5 text-micro font-mono uppercase tracking-[0.18em] text-text-muted">
          <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-text-muted)" }} />
          Computed · not yet
        </div>
        <p className="mt-1 text-small font-mono tabular-nums text-text-secondary">
          N/A
        </p>
      </div>
```

Bucketing it must NOT copy for the new line (the new line has no threshold per D-162-2): `days <= 3 ? "fresh" : days <= 7 ? "stale" : "old"`. **Data source for the date:** series max-date, the D-03 verdict signal — server-side, `max((e->>'date')::date)` semantics per `20260825120000_ledger_refresh_staleness_view.sql`; on the TS side the payload already carries the resolved series (factsheet v2 read selects `returns_series`/`daily_returns`; resolve via `resolveDailyReturnSeries`, `src/lib/factsheet/resolve-series.ts:50-57`, and take the last point's date). Anti-pattern (RESEARCH): no third freshness ladder; never key on `computed_at`. Investigation task precedes any code (criterion hard-orders it); census template = phase-159 C-M1.

---

### Example-row repair (ops) + `StrategyTable.tsx`/`StrategyGrid.tsx` guard — HONEST-03 (D-162-1)

**Recompute path analog:** read-only census first (159 C-M1 pattern), then enqueue real compute — never synthesize values (D-162-1 fence: if recompute impossible → unpublish + report). Memory constraint: ledger venues enqueue `process_key_long` only at creation; recompute means enqueuing fresh `compute_jobs`, and verification means checking `strategy_analytics.computed_at`+status transitions to terminal success, never `last_sync_at`.

**Badge-guard analog (optional class guard):** `StrategyTable.tsx:969` + `:1158` verbatim:

```tsx
const hasComputedAnalytics = isComputedAnalytics(chipStatus);
```
```tsx
{hasComputedAnalytics && (
  <SyncBadge computedAt={s.analytics.computed_at} exchange={s.supported_exchanges?.[0]} />
)}
```

`is_example` is already on the row (`StrategyTable.tsx:555` filters on it; `StrategyGrid.tsx:84` renders the Example chip). If the guard ships, cover `StrategyGrid.tsx:110` too (ungated `SyncBadge`, currently consumer-less) or do it in the shaper. Extend `StrategyTable.stale-analytics.test.tsx`.

---

### `src/app/(dashboard)/portfolios/[id]/page.tsx` — HONEST-04 equity curves

**The code being replaced, `:211-231`** — `buildEquityCurveSeries` with the false comment ("Returns_series is not selected…") and `equityCurve: null as { date: string; value: number }[] | null`. The comment is false: `getPortfolioStrategies` selects `returns_series, daily_returns` (`queries.ts:2098` verbatim select in classification table).

**Composite analog (three pieces):**

1. Gate — REQUIRED shared analog above. `extractAnalytics` (`src/lib/utils.ts:171-176`) does NO status gating and these rows do NOT pass through `shapeRowAnalytics`; the fix must call `isRankableAnalyticsRow(a)` per constituent, else this phase re-opens STALE-01. Shape (RESEARCH Code Examples):
```ts
const a = extractAnalytics(ps.strategies.strategy_analytics);
const curve = isRankableAnalyticsRow(a) ? /* build points */ : null;   // chart skips null (:78)
```
2. Series resolution — `resolveDailyReturnSeries` (`src/lib/factsheet/resolve-series.ts:50-57` verbatim):
```ts
export function resolveDailyReturnSeries(
  dailyReturnsRaw: unknown,
  returnsSeriesRaw: unknown,
): DailyReturn[] {
  const direct = normalizeDailyReturns(dailyReturnsRaw);
  if (direct.length > 0) return direct;
  return equityCurveToDailyReturns(normalizeDailyReturns(returnsSeriesRaw));
}
```
API strategies: `returns_series` is ALREADY the cumprod wealth curve — normalize/validate to `{date,value}` directly. CSV strategies: only `daily_returns` — derive wealth via the cumprod fold precedent, `src/lib/scenario-blend-adapter.ts:136-140` verbatim:
```ts
  let c = 1;
  const histogramSeries = portfolioDaily.map((p) => {
    c *= 1 + p.value;
    return { date: p.date, value: c };
  });
```
3. Chart contract — `PortfolioEquityCurve.tsx:31` `RETURN_FORMATTER = (v) => \`${((v - 1) * 100).toFixed(1)}%\`` (wealth points, base 1), and it skips empty/null curves at `:78`. No component change needed.

**Payload reduction analog** — strip raw series before the RSC boundary, `queries.ts:2265-2278` verbatim (the `_rs`/`_dr` idiom):

```ts
      const {
        returns_series: _rs,
        daily_returns: _dr,
        ...analyticsRest
      } = analyticsObj;
```
Compute the curve points server-side, ship only the points (DEF-147-A: "the reason may be stale but the cost is real").

---

### `src/app/api/strategies/[id]/returns/route.ts` — HONEST-05 route widening

**The select to widen, `:255-262` verbatim:**

```ts
      const { data, error } = await supabase
        .from("strategy_analytics")
        .select(
          "daily_returns, returns_series, computation_status, data_quality_flags",
        )
        .eq("strategy_id", id)
        .maybeSingle();
```
Add `cagr, sharpe` here. Precedent for widening is in the block comment directly above (`:243-254`): Phase 147 widened this same select and documented the RLS reasoning ("`analytics_read` RLS is table-level (published OR owner) — there are no column grants") — the same sentence covers the scalar columns.

**The withholding analog (MANDATORY — same predicate as the series):** this route already routes failed rows into empty state — `:322` comment "Emptying it routes the row into `deriveEmptySeriesState` — the SAME…" and `:369` `series_state = deriveEmptySeriesState(status, strategyCreatedAt);`. Co-served `cagr`/`sharpe` must be nulled under `isRankableAnalyticsRow({ computation_status: status })` (REQUIRED shared analog) — extend the existing R4/R4b/R10 fixtures in `returns/route.test.ts`. Also mirror the F5b error redaction already in the file (`:264-276`): never forward raw Postgres errors.

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — HONEST-05 `addedMetricsById`

**Analog:** `addedProvenanceById`, declared `:1134-1146` (verbatim tail):

```ts
  // beside addedAssetClassById and purged identically in handleRemoveAdded (a
  // re-add starts clean). Fed into addedStrategyMetadataLookup so the wave-3
  // per-row provenance badge (via deriveProvenance) reaches every constituent.
  // Presentation-only — never threaded into the frozen engine (Pitfall 3).
  const [addedProvenanceById, setAddedProvenanceById] = useState<
    Record<string, { trust_tier: string | null; is_composite: boolean }>
  >({});
```

Lifecycle to copy exactly: written by `fetchAddedReturns` from the widened `/returns` payload, purged in `handleRemoveAdded` (re-add starts clean), presentation-only (never into the frozen engine). **The consumption site to change, `:2528-2529` verbatim:**

```ts
        cagr: found?.strategy.strategy_analytics?.cagr ?? null,
        sharpe: found?.strategy.strategy_analytics?.sharpe ?? null,
```
becomes `?? addedMetricsById[a.id]?.cagr ?? null` — the exact fallback shape the adjacent `asset_class` line already uses (`:2531-2532`): `found?.strategy.asset_class ?? addedAssetClassById[a.id] ?? null`. Do not worsen 159-BASIS-FLIP (out of scope; follow the purge-on-remove discipline).

---

### HONEST-06 client thread — `StrategyTable` → mounts → Overlay → `WizardClient`

**Callback to widen:** `StrategyTable.tsx:303` `onFinishSetup?: () => void;` (docblock above it records "no preselect seam today … tracked in TODOS.md" — this phase closes that). Invocation site `:1377-1379` `onClick={onFinishSetup}`; the row HAS the key id — `my-strategies/page.tsx:94-98` verbatim:

```ts
  const placeholderRows = (bareKeys ?? []).map((k) => ({
    id: k.id,
    exchangeLabel: EXCHANGE_DISPLAY[k.exchange],
    keyLabel: k.label,
  }));
```

**Overlay prop seam:** `ContributionWizardOverlay.tsx:49-54` — `{ isOpen, onClose, onSuccess? }`; add the preselect key id here. **Remount idiom (REQUIRED — the preselect id belongs in the key):** `:244-245` verbatim:

```tsx
            <WizardClient
              key={`${source}:${offeredRead?.draft?.id ?? "new"}`}
```

**WizardClient seam (exists):** `WizardClient.tsx:246-248` verbatim:

```ts
  const [apiKeyId, setApiKeyId] = useState<string | null>(
    initialDraft?.api_key_id ?? null,
  );
```

**Mounts to update:** `MyStrategiesSection.tsx:129-136` (and the `:124-127` comment recording the 2026-08-05 founder ruling — that comment must be updated/removed, D-162-3 supersedes it) and `MyStrategiesEmptyState.tsx:47`. Populations (RESEARCH): (a) key-with-draft → existing draft-resume plumbing; (b) orphaned → NEW server path; (c) mid-sync → pending chip, pinned by `StrategyTable.pending-chip.test.tsx:665-681`.

---

### NEW use-existing-key server path — HONEST-06 (D-162-3, service-role boundary — the phase's highest-risk file)

**No exact analog exists** (that is why the file is new). The closest analog is `create-with-key/route.ts` itself, and the planner must copy TWO things from it verbatim.

**1. The authorization gate — how an existing route proves the caller owns the row before writing.** `resolveByVenueIdentity`, `create-with-key/route.ts:210-217` verbatim:

```ts
    const admin = createAdminClient();
    const { data: liveKey, error: liveKeyErr } = await admin
      .from("api_keys")
      .select("id")
      .eq("user_id", userId)
      .eq("exchange", exchangeNormalized)
      .eq("venue_account_id", venueAccountId)
      .is("disconnected_at", null)
      .maybeSingle();
```

With the load-bearing rule from its docblock (`:129-132` verbatim): "`.eq("user_id", …)` — the admin client BYPASSES RLS, so tenant scoping here IS this filter and nothing else. The value comes from `withAuth`'s server-side session and never from the request body." The new path receives a CLIENT-supplied key id — it must re-select `api_keys` by `.eq("id", keyId).eq("user_id", user.id).is("disconnected_at", null)` on the admin client (or better: through the user-scoped client where grants allow, per the `:248-252` defence-in-depth note: "routing it through RLS means the row we hand back is provably the caller's own even if the owner filter above were ever weakened"). Never trust the key id beyond selection intent (RESEARCH §Security, IDOR row). It must also re-verify the key is genuinely ORPHANED (both strategy reads empty — the `:295-318` two-read discipline, verbatim ownerRow read at `:311-318` uses `.eq("user_id", userId).eq("api_key_id", liveKeyId)`), refusing `connected` keys with honest copy.

**2. The service-role writer discipline.** The RPC call, `:881-882` verbatim:

```ts
    const { data, error } = await rpcAdmin.rpc("create_wizard_strategy", {
      p_user_id: user.id,
```

With the boundary contract (`:116-127`): `authenticated` holds no EXECUTE (Migration A `20260813150106`, Migration B `20260814120000`); the fn body refuses non-`service_role` callers; and the ⛔ CEILING sentence: "any server route holding `createAdminClient()` can still pass any uid and any venue string, the standing `service_role` trust boundary (ADR-0001/ADR-0003)." If a new RPC is minted (e.g. `create_wizard_strategy_for_key`), it copies `create_wizard_strategy`'s pattern: SECURITY DEFINER, service-role-only EXECUTE + in-body `auth.role()` gate, advisory-lock + select-existing idempotency fence, and — the new part — an in-body ownership assertion joining `api_keys.user_id = p_user_id`. Crucially it must NOT INSERT into `api_keys` (the whole point: reuse, never re-INSERT — the KEY_ORPHANED unwinnable loop, `wizardErrors.ts:1780-1817`). Missing-credential posture: fail LOUD and refuse the write, per `:858` ("no service-role credential for the wizard write; refusing the submit (nothing was written)"). New error copy lives inside the WIZERR fences (pitfall 6); `wizardErrors.test.ts` has a NUL byte at line 1572 — sweep with `grep -a`/node.

Resolver arm note: the `orphaned` arm deliberately carries no key id (`:184-186`, T-154-06-C). The new path does NOT need to change that — on `/my-strategies` the key id is already in the owner's page payload; threading it from the client is the design RESEARCH endorses, provided the server re-proves ownership as above.

## Shared Patterns

### STALE-01 gate (`isRankableAnalyticsRow` / `shapeRowAnalytics`)
**Source:** `src/lib/closed-sets.ts:747-790`, `src/lib/queries.ts:440-475` (quoted in full above). **Apply to:** HONEST-04 curve building, HONEST-05 widened scalars, HONEST-03 guard. One predicate; extend, never fork; SQL twin is `IN ('complete','complete_with_warnings')` (`20260821120000` cohort predicate / `STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES` in `20260825150000`). ⚠️ SI-01 census (`complete-status-scan.test.ts`) greps raw source for exact-match comparisons on `'complete'` — call the predicate, never inline the comparison.

### Curated-copy-at-writer
**Source:** InvalidToken arm `job_worker.py:698-703`, `curated_gateway_detail` `:743-744` + docblock `:723-733`, reaper literal `20260802120000:508` ("Analytics was interrupted before it could finish and did not recover. Retry the sync."). **Apply to:** every HONEST-01 writer (classify_exception unknown arms, `_fail`, the 18 stamp sites). Rule: fixed user copy in the column; raw `str(exc)` to logs/Sentry only. `scrub_freeform_string` stays as defence-in-depth but is NOT the mapping (pitfall 3).

### Lazy per-leg fallback (composer)
**Source:** `addedProvenanceById` `ScenarioComposer.tsx:1134-1146` + `asset_class` fallback chain `:2531-2532`. **Apply to:** `addedMetricsById` (HONEST-05). Settle from `/returns` payload, purge on remove, presentation-only.

### Error-redaction at API boundary
**Source:** `returns/route.ts:264-276` (log + Sentry + static envelope, never raw Postgres error) and `create-with-key`'s `scrubSeamError(..., secrets)` posture `:227-231`. **Apply to:** widened `/returns`, new use-existing-key path.

### Read-only PROD census before deciding
**Source:** phase-159 C-M1 (`.planning/phases/159-*/159-CENSUS.md`). **Apply to:** HONEST-01 root-cause diagnostic, HONEST-02 flat-vs-gap investigation, HONEST-01 repair census (`computation_error` rows matching exception-shaped patterns), HONEST-03 example-row re-census. ⚠️ `.planning/` is public — snapshot citations only, no UUIDs/emails.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Use-existing-key RPC (if minted as SQL) | migration (SECURITY DEFINER fn) | request-response write | No existing RPC writes a strategy OVER an existing key without inserting one; nearest is `create_wizard_strategy` (pattern quoted above) minus its `api_keys` INSERT plus an ownership assertion. Planner must design the delta, carrying the ADR-0001/0003 review D-162-3 mandates. |

## Metadata

**Analog search scope:** `src/lib`, `src/app/(dashboard)`, `src/app/api`, `src/app/factsheet`, `src/components/strategy`, `analytics-service/services`, `analytics-service/routers`, `supabase/migrations` (citations verified by direct read; stamp-site enumeration via grep this session)
**Files scanned:** 16 read in targeted excerpts; ~30 grep-located
**Pattern extraction date:** 2026-08-25
