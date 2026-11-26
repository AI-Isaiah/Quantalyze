# Phase 235: HOLDINGSTRUTH - Pattern Map

**Mapped:** 2026-11-26
**Files analyzed:** 26 (11 production files modified, 5 new test/fixture files, 10 existing test/ledger files modified)
**Analogs found:** 26 / 26 (25 exact, 1 role-match: `HoldingsTabPanel.tsx`; 0 without an analog). The census test files are run-only and are not counted.
**Worktree:** the phase worktree, at HEAD `2c1a32820`. Every existing path this document names was checked with `git ls-files --error-unmatch` (all tracked source; no `.gsd/capabilities` mirrors involved); only the 5 NEW files are untracked. Line numbers were read at this HEAD and are positions, not contracts: re-find by symbol before editing (CLAUDE.md `[164.7-CITATION-DRIFT-01]` rule).

Conventions that apply to every plan below (CLAUDE.md, RESEARCH "Project Constraints"): `grep -a` always; PROOF-01 neuter with `cp` byte backup, RED with the named arm, `cp` back, `cmp`, GREEN, recorded verbatim in the SUMMARY; pytest only from `analytics-service/` with its `.venv`; mypy strict in every analytics-touching brief; no AI attribution trailers; no CI skip tokens in any message; ship PR changes nothing under `.planning`; TODOS and CHANGELOG moves are ship-time (RESEARCH "Ship checklist": delete `170.4-IDENTITY-READ-COMPLETENESS`, `170.4-MATCH-UNPRICED-PER-KEY`, `170.4-DASHBOARD-MARKER-READ-SILENT`, `198-SHARED-ACCOUNT-FALLBACK-UNNAMED` and name them in the CHANGELOG entry).

---

## File Classification

### Production files

| File | Req | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `src/lib/latest-holdings-per-key.ts` (add `HoldingsIdentityError`, strict `keyAccountOf`, `strictAccountOf`) | HOLD-01 | utility (identity mapping) | transform | `src/lib/holdings-account-day.ts` `HoldingsUpdatedAtError` (error class) + its own `keyAccountOf` (edit site) | exact (named-error pattern) |
| `src/lib/portfolio-exposure.ts` (docblock only; no code change) | HOLD-01 | service (series reader) | CRUD read, paged | itself (`fetchHoldings` already throws on identity-read error / row cap) | exact |
| `src/lib/holdings-account-day.ts` (docblock sentence only) | HOLD-01 | utility | transform | itself | exact |
| `src/lib/queries.ts` `derivePhase07Fields` strict lookup | HOLD-01 | service (pure derive) | transform | itself (`oneKeyPerAccountDay(perKeyRows, ...)` call) | exact |
| `src/app/api/allocator/scenario/commit/route.ts` strict lookup | HOLD-01 | route | request-response | itself (`holdingsLookupErr` try/catch block) | exact |
| `analytics-service/routers/match.py` `_load_holding_portfolio_context` | HOLD-02 | service (request-time scorer) | transform over per-key reads | the TS reader `fetchLatestHoldingsPerKey` reading-day rule (cross-runtime twin) + Step 1b/2 in the same function | exact (twin) |
| `src/lib/queries.ts` `getMyAllocationDashboard` flag + capture + `shouldCaptureDerivedRowRejection` union | HOLD-04 | service (RSC read) | request-response + event (Sentry) | same file: `role_discriminator_read_failed` capture (queries.ts ~5958) and the `tiny_base_days_key_malformed` throttled capture (~3988) | exact |
| `src/lib/queries.ts` `MyAllocationDashboardPayload` fields + both return literals | HOLD-04, HOLD-05 | model (payload type) | request-response | same file: `departedHistoryUnavailable?: boolean` (~3033) and `keyDataGaps?: KeyDataGap[]` (~3094; literals ~6141, ~6711) | exact |
| `src/lib/queries.ts` sibling for attributed groups (or factor of `deriveKeyDataGapsField`, ~4635) | HOLD-05 | service (pure derive) | transform | `deriveKeyDataGapsField` itself | exact |
| `src/app/(dashboard)/allocations/lib/key-data-gaps.ts` sibling export `sharedAccountFailingGroups` | HOLD-05 | utility (pure producer) | transform | `accountGroups` + the `shared_account_no_working_key` arm of `keyDataGaps` (same file) | exact |
| `src/app/(dashboard)/allocations/components/MissingDataMessage.tsx` `missingDataLines` + undated `GapLine`-style render | HOLD-05 | component (list builder) | transform | the R3-01 `not_syncing` block in `missingDataLines` (same file) | exact |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx` Mount A note + new `missingDataLines` arg | HOLD-04, HOLD-05 | component | request-response render | `DepartedHistoryNote` (same file, ~521) | exact |
| `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx` Mount B note (+ new imports) | HOLD-04 | component | request-response render | `DepartedHistoryNote` markup (cross-file) and the sibling `positions-unreported-caption` `<p>` | role-match |
| `src/lib/degrade-warnings.ts` two new registry entries | HOLD-04, HOLD-05 | config (registry) | none (static copy) | `allocation.alerts-unverified` (read_failure + A-RELOAD) and `allocation.key-gap.shared-account-failing` / `allocation.failing-key-undated` (degrade + `key` scope) | exact |

### Test, fixture and ledger files

| File | Req | Role | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/latest-holdings-per-key.test.ts` (extend) | HOLD-01 | test | the `keyAccountOf` test at ~871 in the same file | exact |
| `src/lib/portfolio-exposure.test.ts` (extend) | HOLD-01 | test | "an unparseable updated_at on a counted row rejects with HoldingsUpdatedAtError" (~456) | exact |
| `src/lib/queries.holdings-per-key.test.ts` (extend + fix 3 fixtures) | HOLD-01 | test | the `derive` helper + "a row without a parseable updated_at fails loud" (~196) | exact |
| `src/lib/queries.test.ts` (fix 4 fixtures) | HOLD-01 | test | itself (`derivePhase07Fields: holdingsSummary is each key's own latest asof (D-16)`) | exact |
| `src/app/api/allocator/scenario/commit/route.per-key-aum.test.ts` (extend) | HOLD-01 | test | itself (fixture-serving harness) | exact |
| `analytics-service/tests/fixtures/native_unpriced_account_day_cases.json` (NEW) | HOLD-02 | fixture | `analytics-service/tests/fixtures/one_key_per_account_day_cases.json` | exact |
| `src/lib/native-unpriced-account-day.parity.test.ts` (NEW) | HOLD-02 | test (TS replay) | `src/lib/fingerprint-unpriced-parity.test.ts` (client) + `src/lib/holdings-account-day.test.ts` (JSON loading) | exact |
| `analytics-service/tests/test_match_native_unpriced_account_day.py` (NEW) | HOLD-02 | test (Python replay) | `analytics-service/tests/test_match_portfolio_aum_native_unpriced.py` + `test_one_key_per_account_day.py` (JSON loading) | exact |
| `src/lib/queries.my-allocation.test.ts` (extend + harness injection key) | HOLD-04 | test | the CR-01 block (~5349) + the `tiny_base_days_malformed` capture-spy test (~5588) | exact |
| `src/lib/degrade-warnings.test.tsx` (SAMPLES rows + 2 pins) | HOLD-04, HOLD-05 | test | `allocation.alerts-unverified` SAMPLES row (~166) and pin (~692) | exact |
| `src/__tests__/degrade-warning-scan.test.ts` (move 1 row, add 1, extend MISSING_DATA ids) | HOLD-04, HOLD-05 | test (ledger) | the `DASHBOARD` and `MISSING_DATA` rows (~91-130) | exact |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.unpriced-check.test.tsx` (NEW) | HOLD-04 | test (render) | `AllocationDashboardV2.departed-history.test.tsx` | exact |
| `src/app/(dashboard)/allocations/HoldingsTabPanel.unpriced-check.test.tsx` (NEW) | HOLD-04 | test (render) | `HoldingsTabPanel.positions-header.test.tsx` | exact |
| `src/app/(dashboard)/allocations/lib/key-data-gaps.test.ts` (extend) | HOLD-05 | test | the `shared_account_no_working_key` group test (~218) | exact |
| `src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx` (extend) | HOLD-05 | test | `lines()` / `linesText()` helpers + shared-account fallback tests (~336-420) | exact |
| Census set (run only, no edit expected): `copy-census`, `computed-at-reader-census`, `holding-scope-key-census`, `recompute-verdict-census` | all | test | n/a | n/a |

---

## Pattern Assignments

### 1. `src/lib/latest-holdings-per-key.ts` (utility, transform) — HOLD-01

**Analogs:** error class `HoldingsUpdatedAtError` in `src/lib/holdings-account-day.ts:56-61`; the edit site `keyAccountOf` at `latest-holdings-per-key.ts:97-129`.

**Named error class to copy** (`holdings-account-day.ts:56-61`):
```typescript
/** A holdings row's `updated_at` is missing, null or not an ISO instant. */
export class HoldingsUpdatedAtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HoldingsUpdatedAtError";
  }
}
```
Add `HoldingsIdentityError` the same way (name string `"HoldingsIdentityError"`; tests assert by that string, never by imported class, so pre-fix code fails on behaviour and not on a missing export, RESEARCH Pitfall 2).

**Edit site** (`keyAccountOf`, `latest-holdings-per-key.ts` ~110-129; only the final `return` changes; cite by symbol):
```typescript
export function keyAccountOf(
  keys: readonly KeyIdentityRow[],
): (keyId: string) => string {
  const identity = accountIdentityTokens(
    keys.map((k) => ({ id: k.id, exchange: ..., /* ...liveness/returns fields null... */ })),
  );
  return (keyId: string): string => identity.get(keyId) ?? `key:${keyId}`;   // <- the last statement (~line 128), becomes strict
}
```
Discriminator rule (RESEARCH anti-pattern): `identity` is a `Map` with an entry for EVERY key in `keys` (value `null` = in `keys` but unplaceable, legitimate, keeps `key:<id>`; `src/lib/departed-history.ts:252-254`). Only a MISSING entry means absent, so use `identity.has(keyId)`, never a null check. The existing test at `latest-holdings-per-key.test.ts:871` already pins `of("k-c") === "key:k-c"` for the in-keys unplaceable case and must stay green.

**`strictAccountOf`** (new export beside `keyAccountOf`, same module, same error class) for the two dollar callers; shape in RESEARCH "Code Examples" (`accountByKey[keyId] === undefined` throws). Do NOT add tokens the censuses pin: `recompute-verdict-census.test.ts:185-186` pins `!== "complete"` x1 and `!== "complete_with_warnings"` x1 in this file.

**Docblock to fix** (becomes false; `keyAccountOf`'s docblock, ~lines 107-108): "A key the identity does not group, or that is absent from `keys`, is its own account (`key:<id>`)" and `holdings-account-day.ts:118-119` "a key it does not know should map to its own token".

**Contract guard:** `fetchLatestHoldingsPerKey` documents "Never throws" (~327) and only passes ids taken from `keys` (`accountOf(key.id)` at ~518/531/573), so the new throw is unreachable from it. Do not add a throw or an extra query there (CONTEXT locked "no").

---

### 2. `src/lib/portfolio-exposure.ts` (service, paged CRUD read) — HOLD-01

**Analog:** itself. No code change: `fetchHoldings` already propagates throws.

**Existing fail-loud structure the new throw joins** (`portfolio-exposure.ts:305-360`):
```typescript
const keysRes = await supabase.from("api_keys").select(KEY_IDENTITY_COLUMNS).eq("user_id", userId).limit(HOLDINGS_ROW_CAP);
if (keysRes.error) throw keysRes.error;
const keys = (keysRes.data ?? []) as unknown as KeyIdentityRow[];
if (keys.length >= HOLDINGS_ROW_CAP) { throw new Error(`portfolio-exposure: api_keys identity read reached the row cap ...`); }
const accountOf = keyAccountOf(keys);          // :320
...
counted.push(...oneKeyPerAccountDay(byDay.get(asof)!, accountOf));   // :349 - the strict closure throws here
```
Planner note: only add a sentence to the `fetchHoldings` docblock if one currently claims "its own account"; otherwise nothing.

---

### 3. `src/lib/queries.ts` `derivePhase07Fields` (service, pure transform) — HOLD-01

**Analog:** itself; edit one lambda and the stale parameter comment.

**Current lookup to replace** (`queries.ts:5130-5133`):
```typescript
const dollarRows = oneKeyPerAccountDay(
  perKeyRows,
  (keyId) => accountByKey[keyId] ?? keyId,      // -> strictAccountOf(accountByKey)
);
```
**Stale comment to fix** (`queries.ts:4903-4906`): "A key it does not name is its own account, so a caller that passes none counts every key." Keep the `= {}` default (RESEARCH Open Question 1 recommendation); remove the "no map means every key" branch.

**Seven fixtures that MUST move in the same task** (RESEARCH measured, strict lookup neutered, 7 failures in 2 files, nothing else):
- `src/lib/queries.holdings-per-key.test.ts`: "with no account map every key is its own account (the default)" (line 82; pins the default HOLD-01 retires: rewrite to assert the throw or pass an explicit identity, do not delete silently); "within one key two rows of one venue:symbol:type still yield one row" (91); "a row without a parseable updated_at fails loud rather than being treated as a tie" (196).
- `src/lib/queries.test.ts` (`derivePhase07Fields: holdingsSummary is each key's own latest asof (D-16)`): "a position the key closed before its latest poll is gone"; "a key that did not poll on the latest day keeps its own latest rows"; "input order is irrelevant"; "D-08: two keys on one venue:symbol:type keep one row EACH".

Fix with a tiny test helper mapping each fixture key id to `account:<id>` (the shape `fetchLatestHoldingsPerKey` returns, e.g. `latest-holdings-per-key.test.ts` expects `{ "k-a": "account:k-a" }`). The other 28 calls in `queries.test.ts` are unaffected.

---

### 4. `src/app/api/allocator/scenario/commit/route.ts` (route, request-response) — HOLD-01

**Analog:** itself. The try/catch already converts a throw into `holdingsLookupErr`; only the lambda changes.

**Excerpt** (`route.ts:876-892`; the lambda at 882 becomes `strictAccountOf(read.accountByKey)`):
```typescript
if (!holdingsLookupErr) {
  try {
    countedRows = oneKeyPerAccountDay(
      (read.data ?? []) as CommitHoldingRow[],
      (keyId) => read.accountByKey[keyId] ?? keyId,
    ).filter((r) => r.holding_type === "spot" || r.holding_type === "derivative");
  } catch (e) {
    holdingsLookupErr = { message: e instanceof Error ? e.message : String(e) };
  }
}
```
Downstream (`route.ts:905-925`): `holdingsLookupErr` -> `console.warn` + `captureToSentry(new Error("scenario_commit: holdings lookup for audit recompute failed"), { tags: { area: "scenario-commit", gate: "audit_size_recompute" }, extra: { user_id: user.id, supabase_err: holdingsLookupErr.message }, level: "warning" })` and per-row `_size_source: "lookup_failed"`. Unchanged.

**Test seam** (RESEARCH): the harness reads rows only for keys in `api_keys`, so a row absent from `accountByKey` cannot arise through it; partially mock the reader: `vi.mock("@/lib/latest-holdings-per-key", async (orig) => ({ ...(await orig()), fetchLatestHoldingsPerKey: ... }))` in `route.per-key-aum.test.ts` (a `vi.mock` of the reader module is FILE-WIDE and that file's existing tests rely on the real reader through the fixture harness, so default the mock to the original and override per test, or put the case in a new file; harness header lines 1-80: `withAllocatorAuth` mock, `query()` thenable honouring eq/order/limit, `tablesRead`). Assert `_size_source: "lookup_failed"` and no AUM figure; pre-fix the row is counted.

---

### 5. `analytics-service/routers/match.py` `_load_holding_portfolio_context` (service, transform) — HOLD-02

**Analog (reference rule):** the TS reader in `src/lib/latest-holdings-per-key.ts:448-466` and `510-541`. Python must reproduce it exactly.

**TS rule to mirror** (`latest-holdings-per-key.ts:456-465`, `510-541`):
```typescript
const unpricedAsof = unpricedRes.error ? null : nativeUnpricedDay(unpricedRes.data?.[0]?.payload ?? null);
if (unpricedAsof !== null && (latestAsof === null || unpricedAsof > latestAsof)) {
  return { reading: { day: unpricedAsof, hasRows: false }, partialDay: null, error: null, markerError };
}
...
const accountOf = keyAccountOf(keys);
const newestByAccount = new Map<string, string>();
keys.forEach((key, i) => {
  const reading = readings[i].reading;
  if (reading === null) return;
  const account = accountOf(key.id);
  const current = newestByAccount.get(account);
  if (current === undefined || reading.day > current) newestByAccount.set(account, reading.day);
});
// only keys with reading.hasRows && reading.day === newestByAccount.get(accountOf(key.id)) are read
```

**Current Python (what changes)** (`match.py`, line numbers at HEAD):
- Step 1 (`:824-873`): `key_rows` read with identity columns, per-key `latest` asof then `day_rows`; `if not latest: continue`. The newest asof is discarded after reading rows. Add `latest_by_key: dict[str, str]`, filled here.
- Step 1b (`:881-903`): markers only for `key_ids = sorted({... for h in holdings_rows})` (keys WITH rows); `try: unpriced_days = read_native_unpriced_days(supabase, allocator_id, key_ids) except Exception: logger.exception(...)`; `kept_rows` loop drops a key's own rows `< unpriced_day`. This loop becomes redundant (RESEARCH design step 5): do not keep both mechanisms.
- Step 2 (`:905-931`):
```python
group_of: dict[str, str] = {}
if holdings_rows:                                   # <- must become unconditional (rows-less marker keys need placing)
    for key_id, token in account_identity_tokens(key_rows).items():
        if token is not None:
            group_of[key_id] = token

def _account(holding: Row) -> str:
    key_id = str(holding["api_key_id"])
    return group_of.get(key_id, f"key:{key_id}")

newest_day: dict[str, str] = {}
for holding in holdings_rows:                       # <- newest_day must come from per-key READING days, not surviving rows
    account = _account(holding)
    if account not in newest_day or str(holding["asof"]) > newest_day[account]:
        newest_day[account] = str(holding["asof"])
```

**Reading-day shape to implement** (RESEARCH "Code Examples"; strict `>` as in TS, a marker on or before the rows' own day changes nothing):
```python
def _reading_day(key_id: str) -> str | None:
    latest = latest_by_key.get(key_id)
    marker = unpriced_days.get(key_id)
    if marker is not None and (latest is None or marker > latest):
        return marker            # a reading with no rows
    return latest
```
Markers read for EVERY `key_rows` id (`key_ids = [str(k["id"]) for k in key_rows]`), same `try/except Exception` + `logger.exception(...)` at ERROR and `unpriced_days = {}` on failure (CONTEXT-locked: failed read keeps today's behaviour). Account newest day = max over its keys' reading days; counted rows are those with `asof == newest_day[account]`.

**Measured RED at HEAD** (RESEARCH, temporary pytest): A 1000 on D-2, B 700 on D-1, marker A on D gives `portfolio_aum == 700.0` (expected 0.0 post-fix); marker key with no rows, B 700 on D-1, marker D gives 700.0 (expected 0.0).

**Census guards (do not trip):** no `f"holding:..."` strings, no `(venue, symbol)` tuples, no `computed_at` in this file (`holding-scope-key-census.test.ts` pins `match.py` M4 count 6; `computed-at-reader-census.test.ts` pins `match.py`). Step 3 mark history deliberately applies neither rule (comment near `match.py:987`): unchanged.

**Docstring fix:** `read_native_unpriced_days`'s docstring (`allocator_positions.py:1933-1945`) says "the same reader the daily refresh uses"; at HEAD `match.py` is its only caller (RESEARCH grep). Fix only if the plan edits that file; else record in SUMMARY.

**Gate:** `cd analytics-service && .venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`.

---

### 6. `analytics-service/tests/fixtures/native_unpriced_account_day_cases.json` (NEW fixture) — HOLD-02

**Analog:** `analytics-service/tests/fixtures/one_key_per_account_day_cases.json`. That file's `_comment` says "the two suites consume this file whole", so do NOT append cases to it; make a new file.

**Copy this `_comment` discipline** (from the analog's head): name both consumers by path; say HAND-TYPED; state the rule in words; "Do not add a case here without adding its expectation in both runtimes' runs". Include: A-marker/B-older; marker key without rows; marker on the rows' own day; marker older than rows; two keys on different accounts (marker drops only its own key, the shape of `test_match_portfolio_aum_native_unpriced.py`); duplicate-marker pair from `src/lib/fingerprint-unpriced-parity.test.ts` (KEY_S `duplicate` of KEY_U). Schema per RESEARCH: `keys` (id, exchange, venue_account_id, venue_server, share columns), `rows` (key, asof, value), `markers` (key -> day), `expected_counted_keys`, `expected_total_usd`. Every expectation hand-worked (no value read from either implementation).

---

### 7. `src/lib/native-unpriced-account-day.parity.test.ts` (NEW, TS replay) — HOLD-02

**Analogs:** `src/lib/fingerprint-unpriced-parity.test.ts` (chain client) and `src/lib/holdings-account-day.test.ts` (JSON load).

**JSON load pattern** (`holdings-account-day.test.ts:36-45`):
```typescript
const spec = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "analytics-service/tests/fixtures/one_key_per_account_day_cases.json"),
    "utf8",
  ),
) as { ... };
```
**Hand-rolled client to generalise** (`fingerprint-unpriced-parity.test.ts:122-170`): `from(table)` returns a chain with `select/eq/order/limit` recording `eqs`, `order`, `limit`; `then` selects the source by table (`api_keys` -> KEYS, `audit_log` -> `[]`, `allocator_equity_derived` -> markers, else HOLDINGS), filters with `c === "user_id" && table === "api_keys" ? r.user_id === v : r[c] === v`, sorts, slices, `resolve({ data: rows, error: null })`. Read the tables from the fixture case instead of module constants. Markers shaped `{ allocator_id, kind: \`${NATIVE_UNPRICED_KIND_PREFIX}${key}\`, payload: { native_unpriced: true, asof } }` (imports `fetchLatestHoldingsPerKey, NATIVE_UNPRICED_KIND_PREFIX` from `./latest-holdings-per-key`).

**Mode:** call `fetchLatestHoldingsPerKey(client, ALLOCATOR, cols, { auditEvidence: false })` (or serve an empty `audit_log`) so TS and Python are compared on rows plus markers only (RESEARCH parity limit; the matcher reads no audit log). Boilerplate for modules importing `queries.ts` is not needed here (the reader module is imported directly); keep the `vi.mock("server-only")` scaffolding only if an import chain requires it.

**PROOF-01 note:** this replay is GREEN at HEAD (the TS reader is the reference). Its sensitivity proof is a neutered byte-backed copy of the reader's marker branch (`latest-holdings-per-key.ts:456-465`), RED, restore, `cmp`.

---

### 8. `analytics-service/tests/test_match_native_unpriced_account_day.py` (NEW, Python replay) — HOLD-02

**Analogs:** `test_match_portfolio_aum_native_unpriced.py` (harness) and `test_one_key_per_account_day.py:25-27` (JSON load via `Path(__file__).parent / "fixtures"`).

**Harness to copy** (`test_match_portfolio_aum_native_unpriced.py:14-76`):
```python
from routers import match as match_mod
from tests.fake_postgrest import FakeDb

def _marker(key: str, day: str) -> dict[str, Any]:
    return {"allocator_id": ALLOCATOR, "kind": f"native_unpriced:{key}",
            "payload": {"native_unpriced": True, "asof": day}}

def _aum(monkeypatch: pytest.MonkeyPatch, db: FakeDb) -> dict[str, Any]:
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    return match_mod._load_holding_portfolio_context(ALLOCATOR)
```
`FakeDb({"api_keys": [{"id":..., "user_id": ALLOCATOR, "exchange":..., ...}], "allocator_holdings": [...], "allocator_equity_derived": [...]})`; a failed marker read is simulated with `db.errors["allocator_equity_derived"] = RuntimeError(...)`. The `api_keys` rows must carry the identity columns the fixture case supplies (`venue_account_id`, `venue_server`, share columns), because `account_identity_tokens(key_rows)` reads them. Assert `ctx["portfolio_aum"]` (use `pytest.approx`) and the counted key ids. RED at HEAD with the 700-vs-0 arms named.

**Must stay green unchanged:** `test_match_portfolio_aum_native_unpriced.py`, `test_match_portfolio_aum_per_key.py`, `test_native_unpriced_marker_reader.py` (31 tests, RESEARCH measured).

---

### 9. `src/lib/queries.ts` `getMyAllocationDashboard` flag + capture (service, request-response + event) — HOLD-04

**Analogs (same file):** the existing Sentry captures inside `getMyAllocationDashboard`, `scheduleDerivedRowCapture` (`:4309`) and `shouldCaptureDerivedRowRejection` (`:4338`).

**File convention for a capture inside this function** (`queries.ts:~5958-5962`, `role_discriminator_read_failed`):
```typescript
console.error("[queries.getMyAllocationDashboard] strategy-link read failed (the reconstruct note names nothing):", ...);
captureToSentry(phase151LinkReadError, {
  tags: { op: "getMyAllocationDashboard", reason: "role_discriminator_read_failed" },
  extra: { userId },
  level: "warning",
});
```
**Convention conflict, surfaced (CLAUDE.md Rule 7), RESEARCH decision:** CONTEXT says "an `area` tag"; this file uses `op`+`reason`; the commit route uses `area`+`gate`. Use all of `tags: { op: "getMyAllocationDashboard", reason: "holdings_marker_read_failed", area: "my-allocation-dashboard" }`, `extra: { userId, supabase_err: markerReadError }`, `level: "warning"`. Keep the `area` value undotted (a dotted `allocation.*` string would be read as a registry id by the scan test, UI-SPEC T8).

**Throttled + scheduled shape to copy** (`queries.ts:4296-4354`):
```typescript
function scheduleDerivedRowCapture(capture: Promise<void>): void {
  try { after(() => capture.catch(() => {})); }
  catch { console.warn("[queries.getMyAllocationDashboard] scheduling capture via queueMicrotask fallback (non-request scope)");
          queueMicrotask(() => { void capture.catch(() => {}); }); }
}
export const DERIVED_ROW_CAPTURE_WINDOW_MS = 6 * 60 * 60 * 1000;
export function shouldCaptureDerivedRowRejection(
  allocatorId: string,
  rejection: DerivedPayloadRejection | "tiny_base_days_key_malformed" | "tiny_base_days_strategy_malformed",
): boolean { /* per-instance Map, 6 h window */ }
export function __resetDerivedRowCaptureThrottleForTests(): void { derivedRowCaptureLastAt.clear(); }
```
Extend the `rejection` union with `"holdings_marker_read_failed"` (RESEARCH A3: reuse the window; the Overview polls every `PERFORMANCE_POLL_INTERVAL_MS` so un-throttled capture is one per poll per tab; record the choice).

**Wiring** (RESEARCH "Flag and capture"): after the `assertOk(phase07HoldingsRes, "allocator_holdings")` block (`queries.ts:5680`):
```typescript
const holdingsUnpricedCheckFailed = phase07HoldingsRes.markerReadError !== null;
if (holdingsUnpricedCheckFailed && shouldCaptureDerivedRowRejection(userId, "holdings_marker_read_failed")) {
  console.error("[queries.getMyAllocationDashboard] native-unpriced marker read failed (holdings rows kept, note shown):", phase07HoldingsRes.markerReadError);
  scheduleDerivedRowCapture(captureToSentry(new Error("getMyAllocationDashboard: native-unpriced marker read failed"), { tags: {...}, extra: {...}, level: "warning" }));
}
```
Do NOT thread the flag through `derivePhase07Fields` (its `Pick<...>` return and 50+ call sites would widen).

**Payload type + BOTH return literals** (Pitfall 3): add `holdingsUnpricedCheckFailed?: boolean` (optional, like `departedHistoryUnavailable?: boolean` at `:3033`) and set it explicitly in the `!portfolio` literal (~6141, next to `keyDataGaps,`) AND the main literal (~6711). A test per branch.

**Test harness gap (Wave 0)** (`queries.my-allocation.test.ts` ~470-490): failure injection is keyed by table; `allocator_equity_derived` fails the curve read too:
```typescript
const injected =
  state.tableErrors[table] ??
  (table === "allocator_equity_derived" && filters.some((f) => f.op === "in" && f.column === "kind")
    ? state.tableErrors["allocator_equity_derived:key_inputs"]
    : null);
```
Add a third key (e.g. `"allocator_equity_derived:native_unpriced"`, matched when a recorded `eq("kind", "native_unpriced:...")` filter exists) at BOTH injection points (the `maybeSingle` path at ~455-458 and the `then` path above). Model assertions on `vi.spyOn(sentry, "captureToSentry").mockImplementation(async () => {})` (~5595) with `__resetDerivedRowCaptureThrottleForTests()` first (~5592), and seed from the CR-01 block (~5349-5372: `state.apiKeys`, `state.allocatorHoldings`, `unpricedRecord(asof)` = `{ allocator_id, kind: "native_unpriced:key-btc", payload: { native_unpriced: true, asof }, computed_at }`).

**Census guard:** no `computedAt` / `computed_at` identifiers added to `queries.ts` (`computed-at-reader-census.test.ts`).

---

### 10. `src/lib/degrade-warnings.ts` (config registry) — HOLD-04 + HOLD-05

**Entry A, HOLD-04 (copy VERBATIM from UI-SPEC 1.1/1.2).** Analog `allocation.alerts-unverified` (`degrade-warnings.ts:924-942`), the read_failure + A-RELOAD shape:
```typescript
// AlertBanner's alerts-check failure. A read_failure, so it names no scope; it gains the
// A-RELOAD action ("Reload this page to try again."), which is true: the check re-runs on mount.
{
  id: "allocation.alerts-unverified",
  surface: "my-allocation",
  class: "read_failure",
  scope: "none",
  action: "A-RELOAD",
  text: (): DegradeSegment[] => [
    "Couldn't verify critical alerts. ",
    { action: "A-RELOAD" },
  ],
},
```
New entry: id `allocation.holdings-unpriced-check-failed`, same fields, text `[ "We could not check whether each account's newest day could be priced in USD, so the holdings shown may include an account's positions from an earlier day. ", { action: "A-RELOAD" } ]`, placed directly after `allocation.alerts-unverified`. Comment above it names Phase 235 HOLD-04 (TODOS `170.4-DASHBOARD-MARKER-READ-SILENT`) and why `read_failure` (bare boolean, no key or day, rows kept on purpose). ASCII apostrophes. Sibling "We could not ... so ... may ..." shape: `strategies.placeholder-keys-unreadable` (~1070).

**Entry B, HOLD-05 undated line.** Analog `allocation.key-gap.shared-account-failing` (~646-656) for the action/labels and `allocation.failing-key-undated` (~501-513, `scope: "key"`, no day) for the scope:
```typescript
{
  id: "allocation.key-gap.shared-account-failing",
  surface: "my-allocation",
  class: "degrade",
  scope: "key_day",
  action: "A-FIX-ONE-OF-THESE",
  text: (a: { labels: readonly string[]; coverage: GapCoverage }): DegradeSegment[] => [
    ...labelSegments(a.labels),
    `: ${coverageText(a.coverage, "data")}. `,
    { action: "A-FIX-ONE-OF-THESE" },
  ],
},
```
New entry (RESEARCH concrete proposal, copy is Claude's discretion, founder may override): id `allocation.key-gap.shared-account-failing-undated`, `class: "degrade"`, `scope: "key"` (a `key_day` scope makes `judgeEntry` demand a day), `action: "A-FIX-ONE-OF-THESE"`, `text: (a: { labels: readonly string[] }) => [...labelSegments(a.labels), ": these keys read one exchange account and every one of them is failing to sync. ", { action: "A-FIX-ONE-OF-THESE" }]`; placed directly after `allocation.key-gap.shared-account-failing`.

**Registry tests to move** (`src/lib/degrade-warnings.test.tsx`): SAMPLES rows (a missing row fails "every entry has a sample"): `"allocation.holdings-unpriced-check-failed": { args: undefined, labels: [], days: [] }` beside `:166`, and `"allocation.key-gap.shared-account-failing-undated": { args: { labels: [KEY_A, KEY_B] }, labels: [KEY_A, KEY_B], days: [] }`. Verbatim pin copying `:692-699`:
```typescript
it("allocation.alerts-unverified is a read_failure that ends on A-RELOAD, apostrophe as shipped", () => {
  const e = entry("allocation.alerts-unverified");
  expect(e.class).toBe("read_failure");
  expect(e.action).toBe("A-RELOAD");
  expect(degradePlainText(degradeSegments("allocation.alerts-unverified", undefined))).toBe(
    "Couldn't verify critical alerts. Reload this page to try again.",
  );
});
```
plus `not.toContain("the total")` (UI-SPEC G4). `WHOLE_HISTORY_IDS` count pin (10) does NOT move.

---

### 11. `AllocationDashboardV2.tsx` Mount A (component) — HOLD-04, and wire-up for HOLD-05

**Analog:** `DepartedHistoryNote` in the same file (`:521-536`):
```tsx
function DepartedHistoryNote() {
  return (
    <p role="status" data-testid="dashboard-departed-history-note" className="mb-3 px-1 text-sm text-text-secondary">
      <DegradeLine
        id="allocation.departed-history"
        segments={degradeSegments("allocation.departed-history", undefined)}
      />
    </p>
  );
}
```
Imports `DegradeLine` (`:26`) and `degradeSegments` (`:27`) already exist. **Mount** exactly per UI-SPEC 1.3: inline `<p role="status" data-testid="dashboard-holdings-unpriced-check-note" className="mt-3 mb-3 px-1 text-sm text-text-secondary">` with the literal id written at the render site, directly after `<MissingDataMessage lines={missingLines} />` (`:299`) and before `{departedHistoryUnavailable && !isRebuilding && <DepartedHistoryNote />}` (`:304`); condition `props.holdingsUnpricedCheckFailed === true && (props.holdingsSummary ?? []).length > 0`; NOT gated on `!isRebuilding` (the glance prints in both states; the sibling notes are gated and this one deliberately is not). No new component (two inline `<p>` is the convention).

**HOLD-05 wire-up** (`:166-175`): pass `sharedFailingGroups: props.sharedAccountFailingGroups` into the `missingDataLines({...})` call and add it to the `useMemo` dependency array:
```tsx
const missingLines = useMemo(
  () => missingDataLines({ gaps: keyDataGaps ?? [], apiKeys: apiKeys ?? [], rebuilding: isRebuilding, reason: equityHistoryRebuildReason, notSyncingKeys }),
  [keyDataGaps, apiKeys, isRebuilding, equityHistoryRebuildReason, notSyncingKeys],
);
```
**Props spread:** `page.tsx` spreads the payload into `AllocationsTabs`, which spreads into `AllocationDashboardV2` and `HoldingsTabPanel` (`AllocationsTabs.tsx` ~1009/1017), so no prop plumbing beyond the payload type. The narrow object at `AllocationsTabs.tsx` ~1163 is the `ScenarioComparePanel` slice and needs nothing.

---

### 12. `HoldingsTabPanel.tsx` Mount B (component) — HOLD-04

**Analog:** the `DepartedHistoryNote` markup above (cross-file) for the `DegradeLine` pattern; the sibling `positions-unreported-caption` `<p>` for placement (`HoldingsTabPanel.tsx:737-745`).

**Insertion point** (`HoldingsTabPanel.tsx:717-745`): the section is `grid grid-cols-1 gap-4`, so the new `<p>` takes no margin of its own:
```tsx
<section id="positions" aria-labelledby="holdings-positions-heading" className="grid grid-cols-1 gap-4">
  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
    <h3 id="holdings-positions-heading" ...>Positions</h3>
    <span data-testid="positions-book-equity" ...>Allocation equity {formatUsd(bookEquity)} ...</span>
  </div>
  {/* <- Mount B goes here: first child after the header div, before the unreported caption */}
  {unreportedCaption !== null ? (<p data-testid="positions-unreported-caption" className="text-caption text-text-muted">...</p>) : null}
```
Markup per UI-SPEC 1.3: `<p role="status" data-testid="positions-holdings-unpriced-check-note" className="text-sm text-text-secondary [overflow-wrap:anywhere]">` + `<DegradeLine id="allocation.holdings-unpriced-check-failed" segments={degradeSegments("allocation.holdings-unpriced-check-failed", undefined)} />`. Same render condition as Mount A, using the file's existing memo `holdingsSummary` (`:327`, `props.holdingsSummary ?? []`). **New imports needed** (not present today, verified by grep): `import { DegradeLine } from "@/components/degrade/DegradeLine";` and `import { degradeSegments } from "@/lib/degrade-warnings";` (copy from `AllocationDashboardV2.tsx:26-27`). No `hidden md:block` (visible at 390px).

**Census guards:** `HoldingsTabPanel.tsx` is pinned by `computed-at-reader-census` and `holding-scope-key-census` (M2 count 2): add no `computedAt`, no `${venue}:${symbol}` template.

---

### 13. `degrade-warning-scan.test.ts` (ledger) — HOLD-04 + HOLD-05

**Analog:** the `DASHBOARD` and `MISSING_DATA` rows (`degrade-warning-scan.test.ts:91-130`):
```typescript
[DASHBOARD]: {
  tripHits: 7,
  ids: ["allocation.departed-history", ..., "allocation.unpriced-whole"],
  reason: "My allocation notes: the four key/day notes render registry text through DegradeLine; the hit count also covers the Risk loading line and the factsheet warm-up note, ...",
},
[MISSING_DATA]: { tripHits: 0, ids: [ ... "allocation.key-gap.shared-account-failing", "allocation.key-gap.sync-failing" ], reason: "the Phase 198 missing-data message: ..." },
```
Edits: (a) `DASHBOARD`: add `"allocation.holdings-unpriced-check-failed"` to `ids` (sorted), move `tripHits` by the measured comment-stripped delta (expected +1 for the new `role="status"`; re-measure, do not assume) and extend `reason`. (b) NEW row for `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx` (no row exists today): `ids: ["allocation.holdings-unpriced-check-failed"]`, measured `tripHits` (expected 1), reason like "read_failure: the unpriced-check note renders registry text through DegradeLine inside its role=status paragraph"; define a const beside `const A = ...` (`:84`) if the file path is needed more than once. (c) `MISSING_DATA`: add `"allocation.key-gap.shared-account-failing-undated"` to `ids` (alphabetical, after `...shared-account-failing`), `tripHits` stays 0. The id must appear as a literal at its render site in `MissingDataMessage.tsx` or the ledger test fails.

---

### 14. `key-data-gaps.ts` sibling export `sharedAccountFailingGroups` (utility, transform) — HOLD-05

**Analog:** `accountGroups` (`key-data-gaps.ts:160-178`) and the `shared_account_no_working_key` arm (`:236-254`). Leave `keyDataGaps()` and its return shape UNTOUCHED: `key-data-gaps.test.ts` asserts whole arrays with `toEqual`.

**Arm to mirror** (`key-data-gaps.ts:236-254`):
```typescript
case "shared_account_no_working_key": {
  const failingById = new Map(input.keyAccounts.map((k) => [k.id, k.failing]));
  for (const group of accountGroups(input.keyAccounts, { countedOnly: false })) {
    if (!group.every((id) => failingById.get(id) === true)) continue;
    let latest: string | null = null;
    for (const id of group) { const day = lastDayOf(id); if (day !== null && (latest === null || day > latest)) latest = day; }
    push(group, "shared_account_failing", 2, { lastDay: latest, referenceDay: input.yesterdayUtc });
  }
  break;
}
```
**Owner filter to copy from `push`** (`:193-203`): `const owned = ids.filter((id) => own.has(id)).sort(); if (owned.length < minIds || owned.length === 0) return;`.

**New function shape** (RESEARCH design): `export function sharedAccountFailingGroups(input: KeyDataGapsInput): string[][]` returns `[]` unless `input.reason === "shared_account_no_working_key"`; otherwise each `accountGroups(input.keyAccounts, { countedOnly: false })` group whose every key `failing === true`, ids filtered to `input.ownKeyIds`, sorted, groups with fewer than two owned ids dropped, ordered by first id. Pure (no React/Date/runtime `queries.ts` import, per the file docblock); `accountId` never copied (T-186-18). Grouped (`string[][]`), not a flat list: a flat list cannot say "one of these keys" per account without merging two accounts into one sentence (UI-SPEC P2).

**Producer wiring** (`queries.ts:4635-4690`, `deriveKeyDataGapsField`): it builds `KeyDataGapsInput` inline then `return computeKeyDataGaps({...})`. Factor the input into a local `const gapsInput: KeyDataGapsInput = {...}` and add a sibling `deriveSharedAccountFailingGroupsField(...)` taking the same arguments (or have both consume one builder). Import alias pattern at `queries.ts:68`: `keyDataGaps as computeKeyDataGaps,`. Add `sharedAccountFailingGroups?: string[][]` (optional) to the payload type beside `keyDataGaps?: KeyDataGap[]` (~3094) and set in BOTH return literals next to `keyDataGaps` (~6141, ~6711); call site `queries.ts:6082-6087` (`deriveKeyDataGapsField(apiKeys, phase07, perKeyReturnsByApiKeyId, new Date().toISOString().slice(0, 10))`).

**Test analog** (`key-data-gaps.test.ts:218-234`): `input({ reason: "shared_account_no_working_key", keyAccounts: [{ id: "K1", accountId: "va-1", shareKind: null, failing: true }, ...], lastSeriesDayByKey: {...} })` with hand-typed `toEqual` on the result. Add: a group with no dated gap still appears; one-working-key group absent; foreign id dropped; group left with <2 owned ids dropped; non-shared reason gives `[]`.

---

### 15. `MissingDataMessage.tsx` `missingDataLines` (component, list builder) — HOLD-05

**Analog:** the R3-01 `not_syncing` block, same function (`MissingDataMessage.tsx:313-338`):
```typescript
const causesPrinted = new Set<KeyDataGapCause>();
for (const { gap } of resolvedGaps) {
  const all = gaps.filter((g) => g.cause === gap.cause).length;
  const named = resolvedGaps.filter((r) => r.gap.cause === gap.cause).length;
  if (named === all) causesPrinted.add(gap.cause);
}
// A not-syncing key whose history reaches yesterday has no gap, so the gap count cannot see it. ...
if (causesPrinted.has("not_syncing") && notSyncingKeys !== null) {
  const printed = new Set(resolvedGaps.filter((r) => r.gap.cause === "not_syncing").flatMap((r) => r.gap.apiKeyIds));
  if (!notSyncingKeys.every((k) => printed.has(k.id))) causesPrinted.delete("not_syncing");
}
```
**Required shape (CONTEXT correction + RESEARCH design):** add an OPTIONAL argument `sharedFailingGroups?: readonly (readonly string[])[] | null` (a required param breaks `MissingDataMessage.test.tsx`'s `lines()` helper, which passes five keys). When non-empty: (1) a group is named by a dated gap when a printed `shared_account_failing` gap has exactly those `apiKeyIds`; (2) otherwise, if every id labels through `apiKeyLabelById(apiKeys)` (`missingDataLines` calls `apiKeyLabelById(apiKeys)` itself, already imported; `resolveGaps`' `labelById` at `:131-142` is a local of that function and not reusable), push an undated `MissingLine` `{ id: \`gap:shared_account_failing_undated:${ids.join(",")}\`, sortLabel: labels.join(" and "), content: <DegradeLine id="allocation.key-gap.shared-account-failing-undated" segments={degradeSegments("allocation.key-gap.shared-account-failing-undated", { labels })} /> }` (id as a LITERAL at its render site, like every `GapLine` case, `:181-235`); (3) a group with an id the owner's list cannot label names nothing (T-198-17 / SFH-4) and keeps the book fallback; (4) `causesPrinted` keeps `"shared_account_failing"` iff every group is covered by (1) or (2). Absent or empty argument = byte-identical to today.

**Existing key-line push + sort to join** (`:339-352`): `keyLines.push({ id: \`gap:${cause}:${ids.join(",")}\`, sortLabel: resolved.labels.join(" and "), content: <GapLine {...resolved} /> })` then the `localeCompare` sort; the new undated lines enter `keyLines` before the sort.

**Fallback body to leave alone** (`NeedsActionLine`, `:~276-281`, `case "shared_account_no_working_key": return <BookLine id="allocation.book.shared-account-no-working-key" />`).

**Test changes (MissingDataMessage.test.tsx):** helper `lines()` (`:55-66`) gains an optional `sharedFailingGroups` passthrough. RED fixture = UI-SPEC S3 two-account case (A1,A2 with tail gap `{from:"2026-10-05",to:"2026-10-11"}`; B1,B2 reaching yesterday): pre-fix prints only account A's dated line and B1/B2 are named nowhere with no fallback (RESEARCH probe-measured). Expected post-fix: line 1 account A dated, line 2 `<B1 label> and <B2 label>: these keys read one exchange account and every one of them is failing to sync. Fix or reconnect one of these keys on the Exchanges page.`, no book fallback. Assert P1-P4 (UI-SPEC section 3). The TODOS two-key literal passes at HEAD (book fallback) and is kept as GREEN-only, but its expected text CHANGES deliberately (undated labelled line, no fallback); the existing `[]`-gaps + no-groups fallback test (`:~345-348`, "shared_account_no_working_key with no gap line") is the legacy-payload case and stays green unchanged. Existing tests use hand-typed literal sentences (`HISTORY_HIDDEN`, `EXCHANGES_ACTION`, `RANGE_TEXT`), never read back from the component.

---

### 16. Render tests (NEW) — HOLD-04

**Overview** `AllocationDashboardV2.unpriced-check.test.tsx`; analog `AllocationDashboardV2.departed-history.test.tsx` (copy whole scaffolding): the five `vi.mock(...)` stubs (InsightStrip, AlertBanner, EquityChart, FactsheetProvider, FactsheetBody, `buildAllocatorPortfolioFactsheetPayload`), the `baseProps` object (portfolio, strategies, analytics, apiKeys, `holdingsSummary` with one BTC row, ..., cast `as unknown as MyAllocationDashboardPayload`), then:
```tsx
render(<AllocationDashboardV2 {...baseProps} equityHistoryState="ready" departedHistoryUnavailable />);
const note = screen.getByTestId("dashboard-departed-history-note");
expect(note.textContent).toBe(LINE);
expect(note.querySelector('[data-degrade-id="allocation.departed-history"]')).not.toBeNull();
```
Cases (UI-SPEC T5/T9): flag true + rows -> note present, `data-degrade-id="allocation.holdings-unpriced-check-failed"`, verbatim sentence, rendered after the missing-data section; flag true + `equityHistoryState: "rebuilding"` -> still present (this differs from the departed-history test, whose last case asserts absence while rebuilding); flag true + zero rows -> absent; flag false/absent -> absent and no `data-degrade-id` in the DOM; rerender flip true->false->true follows the payload (T9).

**Holdings** `HoldingsTabPanel.unpriced-check.test.tsx`; analog `HoldingsTabPanel.positions-header.test.tsx`: `vi.mock("@/components/portfolio/PortfolioOptimizer", ...)`, the `spot(...)`/`perp(...)` row builders, `KEYS`, `payload(holdingsSummary)` object (incl. `exposure: EMPTY_EXPOSURE` from `./lib/exposure-props`), render `<HoldingsTabPanel {...(p as any)} />` (with the file's eslint-disable comment), query `section#positions`. Same four cases for `positions-holdings-unpriced-check-note`, plus an order check: it follows `positions-book-equity` and precedes the spot table.

Each case is shown RED first (PROOF-01): neuter by dropping the mount/flag in a byte-backed copy.

---

## Shared Patterns

### S-1 Named error + test-by-name (HOLD-01, both readers)
**Source:** `src/lib/holdings-account-day.ts:56-61` and its test form in `portfolio-exposure.test.ts:456-464`:
```typescript
await expect(getNetExposureSeries(USER_ID)).rejects.toMatchObject({ name: "HoldingsUpdatedAtError" });
await expect(getAllocationSeries(USER_ID)).rejects.toMatchObject({ name: "HoldingsUpdatedAtError" });
```
**Apply to:** `HoldingsIdentityError` tests in `portfolio-exposure.test.ts` (seed `keysResolver.rows = [keyRow(K1)]` is already the `beforeEach` default, set `holdingsResolver.rows = [row({ api_key_id: K2 })]`), `queries.holdings-per-key.test.ts`, `latest-holdings-per-key.test.ts`, the commit route test. Assert by the string `name`.

### S-2 Fail loud: an error and an empty result are distinct (all four requirements)
`fetchHoldings` throws on identity-read error and row cap (`portfolio-exposure.ts:313-318`); `fetchLatestHoldingsPerKey` never throws and returns `error` / `markerReadError`; the matcher logs the marker failure at ERROR and keeps rows (`match.py:884-890`); `getMyAllocationDashboard` now surfaces it as a flag + capture. Never collapse an error into `[]` or a silent default.

### S-3 Degrade sentence = registry entry rendered by `DegradeLine` (HOLD-04, HOLD-05)
**Source:** `src/lib/degrade-warnings.ts` (entries above), `DegradeLine` (`src/components/degrade/DegradeLine.tsx`), `degradeSegments(id, args)`. **Apply to:** both new entries and all three render sites. Never JSX copy. Id written as a literal at each render site (the scan test attributes it); labels only via `apiKeyLabelById(apiKeys)` (T-198-17, a raw id never prints). Copy checks: copy-census rule A (no `portfolio`, `book`, `favorites`, `starred`, `preference`, `my strategies`, `My Allocation`, `My Watchlist`, `Bridge`), rule B (no glossary label), no "the total"/"return"/"risk" on non-glance lines, `copy-census.test.ts` stays at its pinned exception count (36).

### S-4 Cross-runtime twin replayed against one hand-typed JSON case table (HOLD-02)
**Source:** `analytics-service/tests/fixtures/one_key_per_account_day_cases.json`, replayed by `src/lib/holdings-account-day.test.ts:36-45` (TS) and `test_one_key_per_account_day.py:25-27` (Python). **Apply to:** the new `native_unpriced_account_day_cases.json` and its two consumers. The `account_identity_tokens` / `accountIdentityTokens` twins are pinned by `analytics-service/tests/fixtures/venue_server_identity.json`.

### S-5 PROOF-01 neuter / RED / restore (every new gate)
`cp` byte backup of the production file, apply the neuter (HOLD-01 restore the `?? \`key:${id}\`` / `?? keyId` fallbacks; HOLD-02 revert the Python edit; HOLD-04 drop the flag/capture/mount; HOLD-05 return the old `causesPrinted` logic), run the named test and record the RED arm, `cp` back, `cmp` identical, GREEN; record verbatim in the plan SUMMARY. Never `git checkout`/`stash` on uncommitted work. HOLD-02's TS replay additionally needs a neutered copy of the reader's marker branch.

### S-6 Census set (run after the TS edits; none should need an edit beyond the ledger rows above)
`npx vitest run src/__tests__/copy-census.test.ts src/__tests__/computed-at-reader-census.test.ts src/__tests__/holding-scope-key-census.test.ts src/__tests__/recompute-verdict-census.test.ts src/__tests__/degrade-warning-scan.test.ts src/lib/degrade-warnings.test.tsx`, plus `npm run typecheck`. Pre-existing red to NOT blame on this phase: `src/lib/factsheet/compute.conventions.test.ts` (2 snapshot failures on the clean tree); `return-stats.single-source.test.ts` is a load flake (RESEARCH).

---

## Wave and file-collision map (planner input, RESEARCH A7)

| Wave | Plans | Why |
|---|---|---|
| 1 | HOLD-01 (TS identity: `latest-holdings-per-key.ts`, `queries.ts` lambda, `route.ts`, 5 test files) ‖ HOLD-02 (`match.py`, fixture, 2 replays) | Disjoint files. NOTE: HOLD-01 and HOLD-04/05 all edit `queries.ts`; HOLD-01 touches only the `derivePhase07Fields` lambda/comment, so it must land before wave 2's payload edits or be a separate non-overlapping hunk. |
| 2 | HOLD-04 | Owns the first edits to `degrade-warnings.ts`/`.test.tsx`, `degrade-warning-scan.test.ts`, `AllocationDashboardV2.tsx`, `HoldingsTabPanel.tsx`, `queries.ts` payload literals. |
| 3 | HOLD-05 | Shares those same files; follows HOLD-04 (parallel would collide). |

## No Analog Found

None. Closest to "new": the matcher's rows-less marker handling (no Python code reads a marker for a key without rows; analog is the TS reader's `{ day: unpricedAsof, hasRows: false }` branch, cross-runtime) and the `HoldingsTabPanel.tsx` Mount B (no existing registry-rendered note in that file; analog is `DepartedHistoryNote` in another file).

## Metadata

**Analog search scope:** `src/lib/`, `src/app/(dashboard)/allocations/`, `src/app/api/allocator/scenario/commit/`, `src/__tests__/`, `analytics-service/routers/`, `analytics-service/services/`, `analytics-service/tests/` (+ `fixtures/`).
**Files read in full or by targeted range:** 30. All analog paths tracked (`git ls-files --error-unmatch` OK).
**Pattern extraction date:** 2026-11-26
