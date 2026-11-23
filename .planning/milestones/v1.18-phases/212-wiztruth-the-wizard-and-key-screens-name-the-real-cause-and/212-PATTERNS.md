# Phase 212: WIZTRUTH - Pattern Map

**Mapped:** 2026-11-14
**Bound to:** worktree HEAD of branch `feat/212-wiztruth`. Every analog path below was checked with one `git ls-files --` over all named analog and target paths (41 of 41 printed, so each is git-tracked source; none is a gitignored mirror).
**Rows classified:** 31 (a row may group sibling files, e.g. the four SC6b server routes share one row)
**Analogs found:** 29 / 31 rows have a code analog: 22 exact, 6 role-match, 1 partial (`ApiKeyForm` envelope slot). 2 rows have none: the `161-UI-SPEC.md` amendment (planning doc) and the records row (process, not code). See "No Analog Found".

**How to read the excerpts.** Excerpt text is taken from HEAD, but some blocks are reformatted onto fewer lines (whitespace only). Blocks labelled "(condensed)" drop comments or unrelated branches and are NOT paste-safe; re-read the symbol before copying. Quoted `it(...)` titles and user strings keep their original punctuation (em dashes included) so a `plan-anchor-verify` re-resolve finds them.

Citation rule (CLAUDE.md `[164.7-CITATION-DRIFT-01]`): every anchor is a symbol. Excerpts are quoted from HEAD so the planner can paste them; re-resolve by symbol, not by position.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/strategyGate.ts` (add `isSeriesExaminedButRefused`) | utility | transform | `isDailyReturnsSourced` in same file | exact |
| `src/lib/strategyGate.test.ts` (new predicate cases) | test | transform | `describe("[161-07 / WIZERR-10] examined-but-refused verdicts ...")` in same file | exact |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` (composite arm) | component | request-response | single-key arm `gateFailureToWizardError(gate.code)` in same file | exact |
| `.../steps/SyncPreviewStep.composite.render.test.tsx` | test | request-response | `it("REFUSES a composite whose stitch never stamped a verdict ...")` + the `onReviewKeys` case in same file | exact |
| `analytics-service/services/mt5_probe.py` (`MT5_GATEWAY_MISCONFIGURED_DETAIL` + docblock + class docstring) | config (curated constant) | static copy | `MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL` in same file | exact |
| `analytics-service/tests/test_mt5_validate_parity.py` (`_EXPECTED_GENERIC`) | test | transform | `_EXPECTED_TRADE_PERMISSION_OFF` beside it | exact |
| `.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/161-UI-SPEC.md` (arm 3 amendment) | doc | n/a | none (planning-only edit) | no analog |
| `src/lib/wizardErrors.ts` (SC3a: shared map, classifier branch, recogniser, docblocks) | utility/service | request-response | `recogniseDashboardDialogCode` + `classifyKeyValidationError` in same file | exact |
| `src/app/api/keys/validate-and-encrypt/route.ts` (import the map, drop local const) | route | request-response | itself (move, not new logic) | exact |
| `src/lib/wizardErrors.test.ts` / `wizardErrors.invariant.test.ts` | test | transform | `[164.2-05 / WIZFORM-02]` describe in `wizardErrors.invariant.test.ts` | exact |
| `src/app/api/strategies/create-with-key/route.bare-401.test.ts` (NEW) | test | request-response | `route.audit.test.ts` (small scaffold) | role-match |
| `src/app/api/strategies/composite/add-key/route.test.ts` (bare-401 case) | test | request-response | `[153.7-03] MT5_GATEWAY_UNREACHABLE ...` case in same file | exact |
| `src/app/api/keys/[id]/rotate-secret/route.test.ts` (bare-401 case) | test | request-response | existing seam-error cases in same file | role-match |
| `src/components/strategy/StrategyForm.tsx` | component | request-response | `RenameStrategyDialog.tsx` | role-match (different host, same mechanism) |
| `src/components/exchanges/AllocatorExchangeManager.tsx` | component | request-response | `RenameStrategyDialog.tsx` | role-match |
| `src/components/strategy/ApiKeyForm.tsx` (envelope prop or caller-rendered) | component | request-response | `RenameStrategyDialog.tsx` envelope slot (`mt-4` wrapper) | partial |
| `src/lib/wizardErrors.roster-render.test.tsx` (fifth surface) | test | request-response | its own four `SURFACES` + `HARNESS` rows | exact |
| `src/components/strategy/StrategyForm.test.tsx`, AllocatorExchangeManager tests | test | request-response | existing persist-failure case in `StrategyForm.test.tsx` | exact |
| `src/app/api/strategies/create-with-key/route.ts` (SC5 early orphan refusal) | route | request-response | `venueAlreadyConnectedResponse` + the 23505-arm `orphaned` branch, same file | exact |
| `src/app/api/strategies/create-with-key/route.test.ts` (invert two pins) | test | request-response | the two cases being inverted + `seedOrphanedKey()` | exact |
| `analytics-service/tests/test_mt5_concurrency.py` (SC4 structural pin) | test | event-driven (asyncio locks) | `test_lease_does_not_serialize_distinct_terminals` / `test_lease_bound_expiry_raises_busy_and_never_acquires` | role-match |
| `analytics-service/services/closed_sets.py` + `wizardErrors.ts` busy copy (CONDITIONAL on founder checkpoint) | config | static copy | `MT5_TERMINAL_BUSY_DETAIL` / `KEY_MT5_TERMINAL_BUSY` themselves | exact |
| `src/components/auth/ProfileForm.tsx`, `SignupForm.tsx` (x2) | component | static copy | `MetadataStep.tsx` `categoryLoadError` host | exact |
| `src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx` (x2) | component | static copy | `MetadataStep.tsx` host (+ `SyncProgress` `stopCopy`) | exact |
| `src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx` | component | static copy | `SyncProgress.tsx` `stopCopy` host | role-match (string flows through `EmptyStateCard`) |
| `src/components/strategy/ApiKeyManager.tsx` (`SYNC_UNAVAILABLE_COPY`, two render sites) | component | static copy | its own `COMPOSITE_CARD_NOTE` render | exact |
| `src/components/strategy/SyncProgress.tsx` (`syncError` paragraph) | component | static copy | its own `stopCopy` paragraph | exact |
| `src/app/api/strategies/csv-finalize/route.ts` + `route.test.ts` (WR-07 oracle re-cut) | route/test | batch copy | itself | exact |
| `src/app/api/strategies/finalize-wizard/route.ts`, `account/export/route.ts`, `admin/match/send-intro/route.ts`, `admin/partner-import/route.ts` | route | static copy | the same literals being rewritten | exact |
| `src/__tests__/no-email-in-copy.test.ts` (extend `USER_FACING_SOURCES`) | test | transform | its own list + `SOURCE_ALLOWLIST` | exact |
| `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json`, `.planning/WINDOWS.md` | records | n/a | CLAUDE.md § CHANGELOG discipline / TODOS rules | process, not code |

## Pattern Assignments

### `src/lib/strategyGate.ts` (utility, transform) - SC1

**Analog:** `isDailyReturnsSourced` (same file, directly below `SERIES_EXAMINED_BUT_REFUSED`). The map is module-private; the predicate is the export.

**Source structure to point at** (`SERIES_EXAMINED_BUT_REFUSED`):
```typescript
const SERIES_EXAMINED_BUT_REFUSED: ReadonlyMap<string, string> = new Map([
  ["fill_derived_unproven", "The return series is derived from individual fills, ..."],
  ["sampled_gapped", "The return series is built from sampled balance snapshots ..."],
]);
```

**Predicate shape to copy** (same `?? ""` coercion and the same direction-of-safety docblock as `isDailyReturnsSourced`):
```typescript
export function isDailyReturnsSourced(input: {
  tradeCount: number; csvRowCount: number; seriesCompleteness: string | null;
}): boolean {
  return (
    input.tradeCount === 0 &&
    input.csvRowCount > 0 &&
    SERIES_TRUSTED_FOR_DAILY_BRANCH.has(input.seriesCompleteness ?? "")
  );
}
// New, beside it:
export function isSeriesExaminedButRefused(seriesCompleteness: string | null): boolean {
  return SERIES_EXAMINED_BUT_REFUSED.has(seriesCompleteness ?? "");
}
```
`checkStrategyGate` already discriminates with `!SERIES_EXAMINED_BUT_REFUSED.has(input.seriesCompleteness ?? "")` (provenance-unverified) versus `.get(...)` (examined-refused); the new export is that same test, named once.

**Test analog:** `strategyGate.test.ts` `describe("[161-07 / WIZERR-10] examined-but-refused verdicts get their own truthful outcome")`. `strategyGate.invariant.test.ts` does not pin the export count (RESEARCH SC1), so the new export is safe.

---

### `.../steps/SyncPreviewStep.tsx` composite arm (component, request-response) - SC1

**Analog:** the single-key arm in the same file, which calls `gateFailureToWizardError(gate.code)` (symbol: `const wizardCode = gate.code ? gateFailureToWizardError(gate.code) : "UNKNOWN"`).

**Imports already present** (`@/lib/strategyGate` block and `@/lib/wizardErrors` block): `isDailyReturnsSourced`, `STRATEGY_GATE_MIN_CSV_ROWS`, `gateFailureToWizardError`. Add `isSeriesExaminedButRefused` to the first.

**Current code to replace** (the `compositeAdmissible` block):
```typescript
const compositeAdmissible = isDailyReturnsSourced({
  tradeCount: 0,
  csvRowCount: series.length,
  seriesCompleteness: (analyticsRow?.series_completeness as string | null) ?? null,
});
if (!compositeAdmissible) {
  setErrorCode("GATE_SERIES_PROVENANCE_UNVERIFIED");
  setPhase("gate_failed");
  trackForQuantsEventClient("wizard_error", {
    wizard_session_id: wizardSessionId, step: "sync_preview",
    code: "GATE_SERIES_PROVENANCE_UNVERIFIED", trade_count: 0,
  });
  return "done";
}
```
**Pattern to apply:** compute one `code` through `gateFailureToWizardError(isSeriesExaminedButRefused(verdict) ? "SERIES_EXAMINED_REFUSED" : "SERIES_PROVENANCE_UNVERIFIED")` and feed that same variable to `setErrorCode` and to the telemetry `code`, so rendered code and telemetry cannot diverge (UI-SPEC SC1). Evaluation order stays: the 7-day floor sits BELOW this return (161-07 / WIZERR-09 comment), so the null-verdict plus 6-days case still answers PROVENANCE_UNVERIFIED.

**Interaction side effect to expect:** `GATE_SERIES_EXAMINED_REFUSED` has `actions: ["try_another_key"]` and no `clear_and_retry`, so `kickoffRetryCanChangeTheOutcome` goes false and the kickoff Retry vanishes; `compositeReviewIsAvailable = isComposite && Boolean(onReviewKeys)` keeps the "Review your keys" control.

---

### `.../steps/SyncPreviewStep.composite.render.test.tsx` (test) - SC1

**Analog:** the cases inside the composite describe (`renderComposite` helper + `defaultAnalyticsRow`), plus the `onReviewKeys` case near the `GATE_ANALYTICS_FAILED` pin.

**Pin that moves** (`it("REFUSES a composite carrying a verdict the gate does not trust")`): flips `GATE_SERIES_PROVENANCE_UNVERIFIED` to `GATE_SERIES_EXAMINED_REFUSED` for `sampled_gapped`; rename it.

**Negative controls that must NOT move:** `it("REFUSES a composite whose stitch never stamped a verdict ...")` (null stays PROVENANCE_UNVERIFIED), the `[161-07 / WIZERR-09]` evaluation-order case, and the healthy `composite_stitched` case.

**Fixture trap, copy this** (the existing case at the `GATE_ANALYTICS_FAILED` pin): `baseProps` carries no `onReviewKeys`, which `WizardClient` always supplies; without it "Review your keys" fires `onTryAnotherKey` and destroys the draft. New cases must do:
```typescript
const onReviewKeys = vi.fn();
render(<SyncPreviewStep {...baseProps} onReviewKeys={onReviewKeys} />);
// ...
const reviewBtn = screen.getByTestId("wizard-try-another-key");
expect(reviewBtn).toHaveAccessibleName(/review your keys/i);
fireEvent.click(reviewBtn);
expect(onReviewKeys).toHaveBeenCalledTimes(1);
expect(baseProps.onTryAnotherKey).not.toHaveBeenCalled();
```
**Assertion shape for the envelope:** `screen.getByTestId("error-envelope").getAttribute("data-error-code")`.

**Telemetry oracle (verified: a mock exists but nothing reads it yet):** this file already has `vi.mock("@/lib/for-quants-analytics", () => ({ trackForQuantsEventClient: vi.fn() }))`, and no case asserts on it. To assert the `wizard_error` code equals the rendered code, import `trackForQuantsEventClient` from that module and read `vi.mocked(trackForQuantsEventClient).mock.calls` for the last `"wizard_error"` call, the technique `trackedWizardErrorCode()` uses in `wizardErrors.roster-render.test.tsx`. Reset the mock between cases.

---

### `analytics-service/services/mt5_probe.py` (curated constant) - SC2

**Analog:** `MT5_GATEWAY_TRADE_PERMISSION_OFF_DETAIL` (same file), including its dated `#:` correction block (the 164.6.5-06 pattern for correcting a sentence AND its docblock together).

**Constant to rewrite** (symbol `MT5_GATEWAY_MISCONFIGURED_DETAIL`, `Final[str]`, implicit-concatenation style). New value, byte for byte, em dash U+2014 with one space each side:
```python
MT5_GATEWAY_MISCONFIGURED_DETAIL: Final[str] = (
    "The MT5 gateway would not let us prove read-only capability, and it did "
    "not report why. This needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)
```
**Invariants that must survive (all by-symbol, none edited):** tuple `MT5_GATEWAY_MISCONFIGURED_DETAILS` still lists it first with the other two (len 3, all distinct); `Mt5GatewayMisconfigured.__init__(self, message: str = MT5_GATEWAY_MISCONFIGURED_DETAIL)`; `mt5_gateway_misconfigured_detail` falls through to it; `curated_gateway_detail` degrades to it.

**Prose to correct in the same pass (read each, do not blanket-replace; arm 2 legitimately carries the parenthetical):**
- the `#:` docblock above the constant ("This sentence names a SPECIFIC option ... re-wording it to a cause-free fallback is a copy decision for the phase owner") becomes a dated `CORRECTED` note citing this phase and the founder decision, in the 164.6.5-06 style.
- `Mt5GatewayMisconfigured` class docstring lead ("Operator fault: the gateway refuses automated trading ...") if judged arm-3-specific.
- Likely keep: `job_worker.py` `classify_exception` comment, `tests/test_job_worker.py` docstring, `mt5_validation.py`, `mt5_client.py`, `ingestion/mt5.py`, `routers/exchange.py`, `docs/runbooks/mt5-go-live.md` (arm 2 or the option itself).

**Fence the constant must pass unrelaxed:** `test_mt5_validate_parity.py::test_every_builder_emittable_constant_is_curated_and_credential_free` (verdict `transient` through `classify_mt5_login_error`, `len > 40`, none of `password`/`investor`/`master`/`secret`). RESEARCH pre-measured: length 159, `transient`, clean. Execution of the test is still the proof.

### `analytics-service/tests/test_mt5_validate_parity.py` (test) - SC2

**Analog:** `_EXPECTED_TRADE_PERMISSION_OFF` / `_EXTERNAL_API_BLOCKED` / `_GENERIC` triple. Hand-typed, never imported (the file's own header: "An oracle that reads its expectation out of the thing it is testing asserts `copy(X) == copy(X)` and cannot fail").
```python
_EXPECTED_GENERIC = (
    "MT5 gateway refuses automated trading (the 'Disable automatic trading "
    "through the external Python API' option is in force), so read-only "
    "capability cannot be proven. This needs an operator, not a retry — see "
    "docs/runbooks/mt5-go-live.md."
)
```
Re-type it as the founder sentence, with a comment dated like the one above `_EXPECTED_TRADE_PERMISSION_OFF` (164.6.5-06 note). It feeds five parametrised rows, `test_worker_sink_lets_a_curated_cause_through_but_never_raw_remote_text`, and the anchor in `test_the_exception_docstring_names_the_sink_the_worker_actually_calls`. Pins that import the constant (`test_job_worker.py`, `test_ingestion_mt5.py`) stay self-consistent and need no edit.

---

### `src/lib/wizardErrors.ts` - SC3a (the one file this phase serializes)

**Analog A (recogniser):** `recogniseDashboardDialogCode` (the one guarded cast, in one audited place) and `recogniseCreateWithKeyCode` in `ConnectKeyStep.tsx`.

`ConnectKeyStep.tsx` `recogniseCreateWithKeyCode` (alias table first, roster second, UNKNOWN else):
```typescript
function recogniseCreateWithKeyCode(data: { code?: string }): WizardErrorCode {
  const translated = recogniseSeamErrorCode(seamErrorCode(data));
  return translated !== "UNKNOWN"
    ? translated
    : data.code && KNOWN_CREATE_WITH_KEY_CODES.has(data.code as WizardErrorCode)
      ? (data.code as WizardErrorCode)
      : "UNKNOWN";
}
```
`wizardErrors.ts` `recogniseDashboardDialogCode` (guarded cast, rosters co-located):
```typescript
export function recogniseDashboardDialogCode(route: DashboardDialogRoute, wireCode: unknown): WizardErrorCode {
  if (typeof wireCode !== "string" || wireCode.length === 0) return "UNKNOWN";
  const roster = DASHBOARD_DIALOG_ROUTE_CODES.get(route);
  if (!roster) return "UNKNOWN";
  return roster.has(wireCode as WizardErrorCode) ? (wireCode as WizardErrorCode) : "UNKNOWN";
}
```
**Pattern to apply:** new exported `recogniseValidateAndEncryptCode(body, status)` placed beside `recogniseDashboardDialogCode`, returning `{ code, recognised }`. It must take `status` because wire `RATE_LIMITED` means our limiter at 429 (alias to `RATE_LIMITED`) but the venue throttle at 424 (use `VENUE_WIRE_CODE_TO_VERDICT.get("RATE_LIMITED")?.code`, which is a typed `KEY_RATE_LIMIT`, no cast). Read the wire code through `seamErrorCode` from `@/lib/seam-discriminator` (handles the nested shape). Sketch is in RESEARCH § Code Examples; copy its order: venue-throttle split, alias table, guarded roster check, else UNKNOWN.

**Analog B (shared status map):** the route-private `UPSTREAM_STATUS_TO_SEAM_CODE` in `keys/validate-and-encrypt/route.ts`:
```typescript
const UPSTREAM_STATUS_TO_SEAM_CODE: ReadonlyMap<number, string> = new Map<number, string>([
  [401, "SEAM_MISCONFIGURED"], [403, "SEAM_MISCONFIGURED"],
  [422, "VALIDATION_FAILED"],  [429, "RATE_LIMITED"],
]);
```
Move it to `wizardErrors.ts` as `export const UPSTREAM_STATUS_TO_SEAM_CODE: ReadonlyMap<number, string> = new Map<number, string>([` (keep that exact opening line: `wizardErrors.invariant.test.ts` `deriveStatusMap` does `source.indexOf("const UPSTREAM_STATUS_TO_SEAM_CODE")` and its SELF-TEST byte-pins the declaration's opening). A Next `route.ts` must not export non-handler symbols, which is why it moves to `src/lib`.

**Analog C (classifier branch):** `classifyKeyValidationError`'s `seamCode` block and `seamTransportCode` block (condensed: the long explanatory comments are omitted). Both use the "own property read with `typeof`, never `instanceof`" idiom (route suites mock `@/lib/analytics-client` wholesale so the class is `undefined`):
```typescript
const seamCode = (error as { seamCode?: unknown } | null | undefined)?.seamCode;
if (typeof seamCode === "string") {
  const verdict = VENUE_WIRE_CODE_TO_VERDICT.get(seamCode);
  if (verdict !== undefined) return verdict;   // no ?? fallback BY DESIGN
}
const transportCode = (error as { seamTransportCode?: unknown } | null | undefined)?.seamTransportCode;
if (typeof transportCode === "string") {
  const wizardCode = recogniseSeamErrorCode(transportCode);
  if (wizardCode !== "UNKNOWN") return { code: wizardCode, status: 502 };
}
```
**Pattern to apply:** a third block after those two and before `const message = error instanceof Error ? ...`, reading `(error as { status?: unknown }).status` with `typeof === "number"`. Restrict to 401/403 only (RESEARCH Pitfall 4: consulting 422/429 before the substring cascade would change today's `KEY_RATE_LIMIT` and `KEY_INVALID_SIGNATURE` answers). Return `{ code: recogniseSeamErrorCode(mapped), status: 500 }`, matching the three existing `SEAM_MISCONFIGURED` verdict rows (status 500). Do not echo 401 to the browser. Three callers share it: `create-with-key`, `composite/add-key`, `keys/[id]/rotate-secret`.

**Docblock and census corrections in the same file** (read, do not trust): `KNOWN_VALIDATE_AND_ENCRYPT_CODES` docblock ("none of this route's three consumers reads the `code` field" and "Three components POST"; it is TWO consumers since Phase 200, and now both read `code`); its "`KEY_RATE_LIMIT` IS NOT LISTED HERE AND MUST NOT BE ADDED" sentence stays true about the roster but must say the recogniser returns it from the typed verdict table; `OUR_DEFECT_KEY_ERROR_CODES` docblock (record that Next-side paging for a stale service key stops, Python middleware still captures; do NOT add `SEAM_MISCONFIGURED` per CONTEXT).

**Anti-patterns (from the file itself):** no `code as WizardErrorCode` outside the one guarded cast; do not mint a `WizardErrorCode` (it moves `EXPECTED_TABLE_SIZE` at both pins plus `KNOWN_*` rosters); do not edit `KEY_ORPHANED` copy (Phase 213 owns it).

### `src/app/api/keys/validate-and-encrypt/route.ts` - SC3a

**Analog:** itself. Replace the local const with an import from `@/lib/wizardErrors`; the consuming expression stays:
```typescript
const mappedCode = err.seamCode
  ? null
  : (UPSTREAM_STATUS_TO_SEAM_CODE.get(err.status) ?? null);
return NextResponse.json(
  {
    error: mappedCode ? WIZARD_ERROR_COPY[recogniseSeamErrorCode(mappedCode)].title : err.message,
    code: err.seamCode ?? mappedCode ?? "UNKNOWN",
  },
  { status: err.status, headers: NO_STORE_HEADERS },
);
```
Update the docblock that says "Every consumer of this route renders `error` and ignores `code`" (now false). This route has no `classifyKeyValidationError` call (it forwards the 4xx, and its terminal arm answers `code: seamCode ?? "UNKNOWN"` at 500); the `wizardErrors.invariant.test.ts` fourth `ROUTES` row (`label: "keys/validate-and-encrypt"`, `expectedSites`) counts `NextResponse.json({ code ... })` literals, which this move does not change.

### `src/lib/wizardErrors.invariant.test.ts` - SC3a

**Analog:** the `[164.2-05 / WIZFORM-02]` describe. Re-point `VE_ROUTE` to `UNION_SOURCE` (declared near the top as `join(REPO, "src", "lib", "wizardErrors.ts")`) in `deriveStatusMap(stripped(VE_ROUTE))`; keep `EXPECTED_STATUS_MAP` hand-typed and unchanged; keep the two other cases ("every value is a key of `SEAM_CODE_TO_WIZARD_CODE`", "has copy AND is a union member").

### `src/app/api/strategies/create-with-key/route.bare-401.test.ts` (NEW test) - SC3a

**Analog:** `route.audit.test.ts` (364 lines; the minimal scaffold, vs the 4872-line `route.test.ts`). It is the right base because the bare-401 case needs only a non-MT5 body, so no venue-lookup chain mocks. Copy its mock block:
```typescript
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/withAuth", () => ({
  withAuth: (h) => (req) => h(req, MOCK_USER),
}));
vi.mock("@/lib/ratelimit", () => ({ userActionLimiter: {}, checkLimit: vi.fn(async () => ({ success: true })) }));
const validateKeyMock = vi.fn(); const encryptKeyMock = vi.fn();
vi.mock("@/lib/analytics-client", () => ({
  validateKey: (...a: unknown[]) => validateKeyMock(...a),
  encryptKey: (...a: unknown[]) => encryptKeyMock(...a),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (...a) => rpcMock(...a) }) }));
```
plus its `vi.mock("@/lib/supabase/server", ...)` returning a `from().select().eq().eq().maybeSingle()` "no existing draft" chain, `makeReq`, `VALID_BODY` (binance) and `importPost()`.

**Thrown shape, copy exactly (own properties, plain object; the class is `undefined` under the mock, which is why `new AnalyticsUpstreamError(...)` from CONTEXT/TODOS cannot be used in this suite, RESEARCH Pitfall 5):**
```typescript
validateKeyMock.mockRejectedValue(
  Object.assign(new Error("Unauthorized"), {
    name: "AnalyticsUpstreamError", status: 401, seamCode: null,
  }),
);
// expect status 500, json.code === "SEAM_MISCONFIGURED", encryptKeyMock/rpcMock not called
```
This is a NEW file so Plan 03 (SC5) exclusively owns the existing `route.test.ts`.

### `src/app/api/strategies/composite/add-key/route.test.ts` - SC3a

**Analog:** the `[153.7-03] MT5_GATEWAY_UNREACHABLE renders SERVICE_UNREACHABLE/503, and is NOT captured as unclassified` case (and its `INTERNAL` / `MT5_TERMINAL_UNRESPONSIVE` neighbours): same `Object.assign(new Error(...), { name: "AnalyticsUpstreamError", status, seamCode })` shape, `await importPost()`, `POST(makeReq(VALID_BODY))`, assert `res.status`, `json.code`, `encryptKeyMock`/`rpcMock` not called, and `nextCapture()` for Sentry tags (`surface: "strategies-composite-add-key"`, `step: "unclassified-key-error"`). For the bare 401 assert code `SEAM_MISCONFIGURED`; whether it is Sentry-captured follows CONTEXT (not in `OUR_DEFECT_KEY_ERROR_CODES`, so not captured), so assert that explicitly rather than assuming.

---

### `src/app/api/keys/[id]/rotate-secret/route.test.ts` - SC3a (bare-401 case)

**Analog (verified, differs from the other two route suites):** this suite does NOT mock `@/lib/analytics-client`; it mocks `@/lib/resilient-fetch` (`mockResilientFetch`) and the REAL seam client builds the `AnalyticsUpstreamError`. So the thrown shape is produced by a response, not by `Object.assign`. Helper and neighbouring case to copy:
```typescript
function seamResponse(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body };
}
// the flat-body neighbour, already in the file:
it("a body with no code (the flat AUTH_FAILED_DETAIL shape) still falls through to the substring cascade unharmed", async () => {
  mockResilientFetch.mockResolvedValue(
    seamResponse(false, 400, { detail: "Authentication failed. Check your API key and secret." }),
  );
  const res = await PATCH(makeReq({ new_secret: SYNTHETIC_NEW_SECRET }), makeCtx());
  expect(res.status).toBe(400);
  const envelope = (await res.json()) as Record<string, unknown>;
  expect(envelope.code).toBe("KEY_AUTH_FAILED");
});
```
Bare-401 case: `seamResponse(false, 401, { detail: "Unauthorized" })`, expect status 500 and `envelope.code` `SEAM_MISCONFIGURED`, `ADMIN_STATE.updates` length 0 (the `KEK_UNAVAILABLE answers SEAM_MISCONFIGURED at 500` case is the exact sibling). Confirm by running it that the real client leaves `seamCode` null for a flat `{ detail: "Unauthorized" }` body (not read this session). `DASHBOARD_DIALOG_ROUTE_CODES["keys/[id]/rotate-secret"]` already rosters `SEAM_MISCONFIGURED`.

### `src/app/api/keys/validate-and-encrypt/route.test.ts` - SC3a

**Analog:** itself (tracked). Its 401/403/422/429 route cases around the comment citing `UPSTREAM_STATUS_TO_SEAM_CODE` stay green unchanged if route behaviour is unchanged (RESEARCH). Only the comment's pointer to the map's location updates.

---

### `src/components/strategy/StrategyForm.tsx` and `src/components/exchanges/AllocatorExchangeManager.tsx` - SC3b

**Analog:** `src/components/strategy/RenameStrategyDialog.tsx` (WIZERR-07 precedent: mint id before request, send it, read code not prose, envelope in a `mt-4` wrapper, no `onRetry`).

**Imports to copy:**
```typescript
import { ErrorEnvelope } from "@/components/error/ErrorEnvelope";
import { buildEnvelope, type ErrorEnvelope as ErrorEnvelopeShape } from "@/lib/envelope";
import { recogniseDashboardDialogCode, type DashboardDialogRoute } from "@/lib/wizardErrors";
import { newCorrelationId } from "@/lib/correlation-id-client";
```
(swap in `recogniseValidateAndEncryptCode`.)

**Core pattern, copy (condensed: the field-level `NAME_REQUIRED` / `NAME_TOO_LONG` branch and the `wireCode` local are omitted):**
```typescript
const correlationId = newCorrelationId("rename");     // minted BEFORE the request
const res = await fetch(`/api/strategies/${strategyId}/name`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", "X-Correlation-Id": correlationId },
  body: JSON.stringify({ name: trimmed }),
});
if (!res.ok) {
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  setEnvelope(buildEnvelope(recogniseDashboardDialogCode(ROUTE, body?.code), correlationId));
  setStatus("idle");
  return;
}
// catch { setEnvelope(buildEnvelope("UNKNOWN", correlationId)); }
```
```tsx
{envelope && (<div className="mt-4"><ErrorEnvelope envelope={envelope} /></div>)}
```
**Existing tests to extend (verified present):** `src/components/strategy/StrategyForm.test.tsx` (has `it("surfaces the route's curated persist-failure copy, not raw Postgres text (H-0405 class)")`) and `src/components/exchanges/AllocatorExchangeManager.test.tsx` (its fetch stub already branches on `url === "/api/keys/validate-and-encrypt"` in the add-key cases; sibling files `AllocatorExchangeManager.*.test.tsx` exist but are for other behaviours).

**Differences this phase needs (UI-SPEC SC3 rules 3 to 5, RESEARCH Pitfalls 1, 2):**
- `ctx` passed to `buildEnvelope` carries no `surface` and no `venue` slot, so `REQUIRES_CONNECT_SURFACE` bullets ("Your draft is saved.") are suppressed.
- No `onRetry`; the form's own submit button is the retry.
- Unparseable body: log `status`/`statusText` only (analog `ConnectKeyStep` `readCreateWithKeyBody`, the `PARSE_FAILED` sentinel, logs `HTTP ${res.status} (${res.statusText || "no body"})` and never the body).
- A 4xx with an unrecognised code and a curated string `error`, or the persist-INSERT 500 (`code: "UNKNOWN"`, `error: "Your key was verified but couldn't be saved. Please try again."`, pinned by `StrategyForm.test.tsx` `it("surfaces the route's curated persist-failure copy, not raw Postgres text (H-0405 class)")`): render `{ ...buildEnvelope("UNKNOWN", cid), cause: error }` inside `<ErrorEnvelope>`, never a bare string. Keep that StrategyForm test green (sentence must stay findable by text).
- Current code to replace in StrategyForm (`handleApiKeySubmit`): `const err = await res.json().catch(() => ({ error: "Validation failed" })); throw new Error(err.error || "Key validation failed");`, rendered by `{apiError && <p className="text-sm text-negative">{apiError}</p>}` inside the connect-key modal. In AllocatorExchangeManager (`handleAddKey`): `const result = await response.json(); if (!response.ok) { setFormError(result.error ?? "Validation failed"); ...}`, where `await response.json()` is UNGUARDED today (a non-JSON body throws into the outer catch and shows `err.message`); the guarded parse closes that.
- Only the validate-and-encrypt `!res.ok` arm moves. "Not authenticated", "verified but not saved", "saved, but we couldn't load it here", delete-RPC strings stay inline (UI-SPEC rule 6).

### `src/components/strategy/ApiKeyForm.tsx` - SC3b (partial analog)

No exact analog; `ApiKeyForm` takes `error: string | null` and renders `{error && <p className="text-sm text-negative mt-3">{error}</p>}` between the read-only hint and the `submitBlockedReason` paragraph. Its only caller is `AllocatorExchangeManager` (re-measured: one `<ApiKeyForm` outside tests). Either add an envelope-shaped optional prop rendered in the `mt-4` wrapper at that same position, or render the envelope from the manager. The string `error` prop keeps carrying the other messages. This is the one place the planner must choose; both keep the envelope between the hint and `submitBlockedReason`.

### `src/lib/wizardErrors.roster-render.test.tsx` (test) - SC3b

**Analog:** its own four `SURFACES` entries, `HARNESS` map and `renderConnectKeyRefusal`.

**Entry shape to copy:**
```typescript
{
  id: "connect-key",
  rosterFile: join(WIZARD_STEPS, "ConnectKeyStep.tsx"),
  rosterName: "KNOWN_CREATE_WITH_KEY_CODES",
  routeFile: join(REPO, "src/app/api/strategies/create-with-key/route.ts"),
  consultsSeamMap: true,
  rosterFloor: 28, literalFloor: 12, populationFloor: 34,   // HAND-TYPED, never derived.length
},
```
Fifth entry: `rosterFile = src/lib/wizardErrors.ts`, `rosterName = "KNOWN_VALIDATE_AND_ENCRYPT_CODES"`, `routeFile = src/app/api/keys/validate-and-encrypt/route.ts`, `consultsSeamMap: true`, new hand-typed floors measured on the new population. Extend `type SurfaceId` and `const HARNESS: Record<SurfaceId, ...>` (harness drives `StrategyForm` through its real `fetch` mock with `jsonResponse({ code: row.wireCode, error: wireProseFor(row.wireCode) }, row.status)`).

**Anti-vacuity rules (file's own):** recompute `EXPECTED_POPULATION_MIN` (typed `78` at HEAD) from a fresh measurement and never from `POPULATION.length`; the code also checks `copyRows.length >= EXPECTED_POPULATION_MIN - 6`, which moves with it. Do not restate the old number in prose.

**Telemetry exemption (RESEARCH Pitfall 8):** the sweep's last assertion `expect(trackedWizardErrorCode()).toBe(row.expectedCode)` must branch on `row.surface`; the dashboard forms emit no `wizard_error` telemetry and must not be given any. DOM oracle (`data-error-code`, title text, no UNKNOWN card) carries the proof for the fifth surface.

**Replace, do not delete, the describe `"[164.2-09] the FIFTH surface is excluded, and the blocker is measured"`:** its `CONSUMERS` array (already the two live consumers) and `codeChannelReads(src)` (currently asserted `toEqual([])`) invert so each consumer now MUST read `code`; keep the `derivePosters()` census case (`toEqual([...CONSUMERS].sort())`, still two). Update the header prose ("FOUR SURFACES ... NOT FIVE", `theFifthSurface`). Named extra cases (not population rows, since `mustRenderAs` is surface-agnostic): 424 plus wire `RATE_LIMITED` renders `KEY_RATE_LIMIT`; bare-401 `{ error: "Unauthorized", code: "SEAM_MISCONFIGURED" }` renders the envelope with no Retry; persist-failure curated sentence; unparseable body; 4xx curated-sentence fallback.

---

### `src/app/api/strategies/create-with-key/route.ts` (route, request-response) - SC5

**Analog:** `venueAlreadyConnectedResponse(strategyName)` (module helper, the "one builder for pre-RPC arm and race arm" pattern) and the 23505-arm `orphaned` branch.

**The two literals that must not drift, copy one into a helper** (the 23505-arm body, verbatim):
```typescript
return NextResponse.json(
  { code: "KEY_ORPHANED", error: "This key is already stored, but no strategy uses it." },
  { status: 409, headers: NO_STORE_HEADERS },
);
```
**Helper shape to mirror:**
```typescript
function venueAlreadyConnectedResponse(strategyName: string | null): NextResponse {
  return NextResponse.json(
    { code: "VENUE_ALREADY_CONNECTED", error: "This account is already connected to an existing strategy.", ...(strategyName === null ? {} : { strategy_name: strategyName }) },
    { status: 409, headers: NO_STORE_HEADERS },
  );
}
```
Add `keyOrphanedResponse()` beside it (no params; no venue id can leak) and call it from BOTH places. `KEY_ORPHANED` copy and actions are byte-identical (Phase 213 owns the sentence).

**Insertion point:** inside `if (venueAccountId) { const venueMatch = await resolveByVenueIdentity(...) ... }`, directly after the `connected` arm and before `validateKey`:
```typescript
if (venueMatch.kind === "connected") { return venueAlreadyConnectedResponse(venueMatch.strategyName); }
// NEW: if (venueMatch.kind === "orphaned") return keyOrphanedResponse();
```
`held` and `unresolved` keep falling through (`held` is out of scope per UI-SPEC; `unresolved` must never invent a refusal from a fault, pinned by the "OWNER read faulting" test). `venueAccountId` is `isMt5 ? api_key.trim() : null`, so this is the MT5 credential arm only; ccxt venues learn identity after validation and keep the 23505-arm resolution; the `reuse_api_key_id` arm (`handleReuseExistingKey`) resumes orphans on purpose and is untouched; `composite/add-key` is not an SC5 site.

**Comment to correct:** the two paragraphs that argue "161-05 / WIZERR-03 — `orphaned` DELIBERATELY DOES NOT SHORT-CIRCUIT HERE" and "THE COST IS LATENCY, AND IT IS REAL" become a dated `CORRECTED` note (CLAUDE.md house style: keep the old reasoning as lineage, state the reversal, name the cost: a user with an orphan AND a wrong password hears the orphan first, which is true and discloses nothing since the resolver is scoped by `user.id`).

### `src/app/api/strategies/create-with-key/route.test.ts` (test) - SC5

**Analog:** the two cases being inverted, plus `seedOrphanedKey()`, `makeReq(MT5_RECONNECT_BODY)`, `venueKeyLookupMock` / `venueStrategyLookupMock` / `venueOwnerLookupMock`, `validateKeyMock`, `rpcMock`.

**Cases to invert** (both currently pin the OLD order and will go RED, correctly):
- `it("an ORPHANED key is still an orphan — 'no strategy at all' must not become a refusal")`: currently `expect(res.status).toBe(200); expect(rpcMock).toHaveBeenCalledTimes(1)`.
- `it("the PRE-RPC fence lets the orphan through to validate — the credentials speak first")`: currently `expect(validateKeyMock).toHaveBeenCalled(); expect(rpcMock).toHaveBeenCalled()`.
New: 409, `code: "KEY_ORPHANED"`, `validateKeyMock` NOT called, `rpcMock` NOT called, body equal to the 23505-arm body.

**Keep green unchanged:** `it("the OWNER read faulting falls through to the RPC — a refusal is never invented from an error")`, the 23505-arm orphan cases, and `it("NEGATIVE CONTROL — the wizard-session constraint still answers the fence 409, orphan state or not")` (asserts the byte string `'{"code":"DRAFT_ALREADY_EXISTS","error":"A wizard session with this key is already in progress."}'`).

**New cases:** orphan plus wrong credentials (`validateKeyMock` rejects) still answers `KEY_ORPHANED` with the validator not called (proves "before the 120 s validate"); a non-MT5 venue with an orphan still validates first (use the `[167.1.2 / D-01]` okx block's `OKX_RECONNECT_BODY` setup). RED proof: neuter the new arm, the "not called" assertions fail.

---

### `analytics-service/tests/test_mt5_concurrency.py` (test) - SC4 structural pin

**Analog:** `test_lease_does_not_serialize_distinct_terminals` (interleaving oracle, not "context manager ran") and `test_lease_bound_expiry_raises_busy_and_never_acquires` (deadman `asyncio.wait_for(..., timeout=10.0)`, literal elapsed bar, `lock.locked()` observed from outside). The file's own stated rule: "The oracle here is BLOCKING, never 'the context manager ran'".

**Reusable idioms:**
```python
lock = mt5_concurrency._mt5_terminal_lock_for("h:1")
await lock.acquire()                      # somebody else holds the terminal
with pytest.raises(mt5_concurrency.Mt5TerminalBusyError):
    await asyncio.wait_for(_attempt(), timeout=10.0)   # deadman: wait_s=None would hang forever
```
`@pytest.fixture(autouse=True) _reset_mt5_terminal_locks` already resets the lock registry; `pytest.ini` has `asyncio_mode = auto` (no marker needed). Imports available in the file: `mt5_concurrency`, `mt5_relogin`, `mt5_terminal_key` (from `services.mt5_client`, signature `mt5_terminal_key(host: str, port: int) -> str`). Env readers: `mt5_relogin.read_env_gateway_endpoint()` (job pair `MT5_GATEWAY_HOST/PORT`) and `read_env_validation_gateway_endpoint()` (`MT5_VALIDATION_GATEWAY_HOST/PORT`; both return `tuple[str, int] | None`, and the validation one refuses non-private hosts). Env setting uses `monkeypatch.setenv(...)` as `_set_full_env` in `tests/test_mt5_relogin.py` does.

**Shape (RESEARCH § Code Examples):** distinct env pairs gives two different keys; a lease held on the JOB key does not delay a `wait_s=0.05` acquire on the VALIDATION key; RED control in the same test, env pairs set EQUAL makes that acquire raise `Mt5TerminalBusyError`. The existing routing pin to sit beside, not duplicate: `_VALIDATE_SITES` / `test_only_the_validate_sites_read_the_validation_endpoint`. Document in the docstring that nothing refuses equal pairs (config dependence).

### Busy-copy carriers (CONDITIONAL on founder checkpoint) - SC4 copy

**Analog:** the carriers themselves, and their byte pins. Do not edit unless the founder picks a number.
- Python `MT5_TERMINAL_BUSY_DETAIL` (`analytics-service/services/closed_sets.py`): `"Our MetaTrader connection was busy and could not take this check yet. " "Try again in a minute."`
- TS `WIZARD_ERROR_COPY.KEY_MT5_TERMINAL_BUSY`: title `"Our MetaTrader terminal is briefly busy."`, `fix[0]` `"Try again in a minute."`, `fixRequires: [null, null, REQUIRES_CONNECT_SURFACE]`, `actions: ["clear_and_retry", "request_call"]`.
- Pins that move together (verified by grep at HEAD): `EXPECTED_MT5_TERMINAL_BUSY_DETAIL` in `tests/test_validate_key_venue_transient.py`; the fixture literal `"Our MetaTrader connection was busy and could not take this check yet. Try again in a minute."` in `src/app/api/keys/[id]/rotate-secret/route.test.ts`; the TS title pin `expect(envelope.textContent).toContain("Our MetaTrader terminal is briefly busy.")` in `MultiKeyConnectStep.test.tsx`. RESEARCH also names a `wizardErrors.test.ts` busy-copy pin and a Python/TS byte-equality test; a grep of `wizardErrors.test.ts` for `KEY_MT5_TERMINAL_BUSY` and the sentence found NOTHING, so treat both as per-RESEARCH, unverified, and locate them (the TS busy code is referenced in `dialog-envelope.invariant.test.ts`, `seam-venue-vocabulary.invariant.test.ts` and `UpdateMt5SecretDialog.test.tsx`) before the plan asserts them. `create-with-key` and `composite/add-key` route tests use a different, shorter test-only message (`"The MetaTrader check is briefly busy."`) as a thrown error and do not pin the carrier copy. Python fences stay: `test_mt5_server_known.py::test_terminal_busy_detail_collides_with_no_cascade_needle`, plus the module note's banned words.

---

### SC6a in-app pointer hosts - `ProfileForm.tsx`, `SignupForm.tsx`, `ScenarioCommitDrawer.tsx`, `WeightOptimizerSection.tsx`, `ApiKeyManager.tsx`, `SyncProgress.tsx`

**Analog:** `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` (`categoryLoadError` host) and `SyncProgress.tsx` `stopCopy` paragraph.

**Imports:**
```typescript
import { ContactPointerText } from "@/components/contact/ContactPointerText";
import { contactHref } from "@/lib/contact";
```
**Core pattern (MetadataStep, new-tab over unsaved state):**
```tsx
<p className="text-caption text-negative" role="alert">
  {categoryLoadError}{" "}
  <ContactPointerText
    text="Refresh the page. If this persists, use the contact form."
    href={contactPointerHref}      // contactHref({ topic: "support", ... })
    newTab
  />
</p>
```
**Pattern (SyncProgress, no new tab, id passed where the host holds it):**
```tsx
<p className="text-xs text-text-secondary mt-1 ml-6">
  <ContactPointerText text={stopCopy.detail} href={contactHref({ topic: "support", strategy: strategyId })} />
</p>
```
**Renderer contract** (`ContactPointerText`): links the FIRST exact lowercase `contact form` substring and returns `<>{text}</>` unchanged when the phrase is absent; `newTab` adds `target="_blank"`, `rel="noopener noreferrer"` and the sr-only " (opens in a new tab)". A sentence-initial "Contact form" does not match, so every rewrite uses "use the contact form" or "Use the contact form". `contactHref` params: `{ topic, ref?, draft?, strategy? }`, topics `general | support | security | privacy`.

**Per-host mechanics found (all string-typed today, so the swap is a text-node change at the render site):**
- `ProfileForm`: `<span className="text-xs text-text-muted">Set at signup. Contact support to change it.</span>` becomes a `ContactPointerText` inside that span, `newTab`.
- `SignupForm`: (a) `setError("Something went wrong — please try again or contact support ...")` is a string in state rendered by `{error && <p className="text-sm text-negative">{error}</p>}`, and the same slot also shows `error.message` from Supabase, so the pointer must be applied at render (wrap `error` in `ContactPointerText`, which is a no-op when the phrase is absent) rather than in the setter; (b) the locked-after-signup `<p className="mt-2 text-xs text-text-muted">`. `/contact` is in `PUBLIC_ROUTES`, so signed-out linking works.
- `ScenarioCommitDrawer`: `remediation` is concatenated into one string by the IIFE `topLevelError` and rendered at `{topLevelError}` (one render site, inside the failure banner). Wrap the render, not the string pieces.
- `WeightOptimizerSection`: `FAILURE_COPY.unreadable.body` flows into `<EmptyStateCard heading body />`, whose `body: string` prop renders `<div className="mt-1 text-micro">{body}</div>`. `EmptyStateCard` has no node slot, so the planner must either widen `body` to `ReactNode` (touches a shared UI component, so check its other callers) or render the pointer at this site; flag as the one non-trivial host.
- `ApiKeyManager`: `SYNC_UNAVAILABLE_COPY` reaches TWO render sites: `{error && !(syncStatus === "error" && error === syncError) && <p className="text-sm text-negative">{error}</p>}` and `SyncProgress`'s `syncError`. The component already imports both helpers and holds `supportContactHref = contactHref({ topic: "support", strategy: strategyId })`. `ApiKeyManager.poll.test.tsx` `TIMEOUT_COPY` is a different server-fixture string, read before touching.
- `SyncProgress`: its error branch is a plain `<p className="text-xs text-text-secondary mb-2">{syncError}</p>` and `syncError` carries the server `computation_error` column (SC6b rows 8 to 9), so routing it through `ContactPointerText` with `{ topic: "support", strategy: strategyId }` makes those server strings links here with no new response field.

**Test analog:** `MetadataStep.test.tsx` asserts the rendered link (copy its shape for each host):
```typescript
const link = alert.querySelector("a")!;
expect(link.getAttribute("href")).toBe("/contact?topic=support&ref=session-1&draft=strat-1");
expect(link).toHaveAttribute("target", "_blank");
expect(link.getAttribute("rel")).toBe("noopener noreferrer");
expect(alert.textContent).not.toMatch(/@/);
```
Tests that pin old wording and move with the string: `ApiKeyManager.test.tsx` (`SYNC_UNAVAILABLE_SENTENCE` is hand-typed "... contact support if it keeps failing."). Add render tests asserting the link href for ProfileForm, SignupForm, ScenarioCommitDrawer, WeightOptimizerSection.

### SC6b server strings - `csv-finalize/route.ts`, `finalize-wizard/route.ts`, `account/export/route.ts`, `admin/match/send-intro/route.ts`, `admin/partner-import/route.ts`

**Analog:** the literals themselves (plain-text edits; codes, statuses and every other body field unchanged; 5xx bodies stay static, 161 Fence 2). Current text and the lines to touch:
- `csv-finalize` `const ENQUEUE_LOST_RACE_USER_COPY = "Analytics could not complete for this strategy. Retry the sync, or contact support if this persists.";`
- `finalize-wizard` composite arm: `"... unified-backbone finalize path. Contact support."` (change only the pointer clause; the internals wording is a recorded finding, not rewritten).
- `account/export`: `export_truncated` ("Please contact support — GDPR Art. 15 ...") and `export_manifest_drift` ("Export manifest drift — please contact support."). No in-app caller of `POST /api/account/export` under `src/`; `gdpr-export-route.test.ts` asserts `code`, not message text, so no text pin moves.
- `admin/match/send-intro` `audit_warning: "Intro committed but the audit record could not be written. Contact support."` and `admin/partner-import` `audit_warning: "... Contact support. Do NOT re-run the import."` become the UI-SPEC rows 12 and 13 sentences (admin's own action). No test pins them (`redteam-b02-regressions.test.ts` only locates `audit_warning`).

**`csv-finalize` oracle conflict (RESEARCH CONFLICT row 8 vs SC7; CONTEXT default is option 1).** The WR-07 test derives its expected string from the SQL:
```typescript
const CURATED_DEFAULT_COPY: string = (() => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/schema/functions/computation_error_copy.sql"), "utf8");
  const arm = sql.match(/\bELSE\s*\n\s*'([^']+)'/);
  if (!arm) throw new Error("WR-07 oracle: could not parse the ELSE arm ...");
  return arm[1];
})();
// ... expect(copy).toBe(CURATED_DEFAULT_COPY);
```
Changing the TS literal alone reds it, and changing the SQL needs a migration (forbidden by SC7). Re-cut the oracle to a hand-typed sentence (the repo's oracle-independence rule), KEEP its independent assertions (`toContain("Retry the sync")`, `not.toMatch(/automatic/i)`, length floor), and record the divergence in the test header. Book the SQL arms (`permanent`, `transient`, `unknown`) plus the Python "contact support" strings (`services/exchange.py` `VALIDATION_UNEXPECTED`, `services/csv_validator.py`, `services/job_worker.py` x2, `routers/portfolio.py`) as one TODOS survivor owned by a later migration phase. `SyncPreviewStep.render.test.tsx` and `.composite.render.test.tsx` use "Contact support" sentences as fixtures/negative assertions; they stay.

### `src/__tests__/no-email-in-copy.test.ts` - SC6

**Analog:** its own `USER_FACING_SOURCES` array (already lists `src/app/api/strategies/csv-finalize/route.ts`) and `SOURCE_ALLOWLIST` entries (`{ file, literal, reason }`, reason > 20 chars, entry must still be present in the file or the "still needed" case fails):
```typescript
{ file: "src/app/(marketing)/for-quants/RequestCallModal.tsx", literal: "you@firm.com",
  reason: "the visitor's own email input placeholder: an example of what to type, not an address we publish" },
```
Add each touched module to `USER_FACING_SOURCES`. RESEARCH Pitfall 7 measured two that need allowlist entries before they can be added: `SignupForm.tsx` (placeholder `you@example.com`) and `admin/match/send-intro/route.ts` (comment text `local@host.tld`); the other ten touched files measured 0 hits. Single owner of this file: Plan 09.

---

## Shared Patterns

### Code, not prose (every client render change)
**Source:** `ConnectKeyStep.tsx` `recogniseCreateWithKeyCode` + `wizardErrors.ts` `recogniseDashboardDialogCode` + `recogniseSeamErrorCode`.
**Apply to:** `StrategyForm`, `AllocatorExchangeManager`, and the new `recogniseValidateAndEncryptCode`. Order is always: venue-throttle status split (new, SC3 only), alias table, guarded roster membership, else `UNKNOWN`. The only `as WizardErrorCode` cast lives inside a membership-checked helper in `wizardErrors.ts`.

### Envelope rendering (DESIGN.md authoring rule)
**Source:** `RenameStrategyDialog.tsx` (envelope in `<div className="mt-4"><ErrorEnvelope envelope={envelope} /></div>`, `buildEnvelope(code, correlationId)`).
**Apply to:** the two SC3b forms. Every error path calls `buildEnvelope`; no inline string envelope.

### Correlation id minted before the request
**Source:** `newCorrelationId("rename")` and header `"X-Correlation-Id": correlationId` in `RenameStrategyDialog`; server side `getCorrelationId()` reads that header. Without it the envelope shows an id no server log carries.
**Apply to:** the two SC3b forms (`newCorrelationId("key-validate")`).

### Own-property `typeof` reads, never `instanceof AnalyticsUpstreamError`
**Source:** `classifyKeyValidationError` (`seamCode`, `seamTransportCode` blocks) and the test thrown shape `Object.assign(new Error(msg), { name: "AnalyticsUpstreamError", status, seamCode })`.
**Apply to:** the classifier's new status block and every route test in this phase (route suites mock `@/lib/analytics-client` wholesale so the class is `undefined`).

### Parse failure is logged by metadata only
**Source:** `ConnectKeyStep.tsx` `readCreateWithKeyBody` + `PARSE_FAILED = Symbol("parse-failed")`:
```typescript
console.error(`[wizard:ConnectKeyStep] ${arm} arm: response body was not JSON — HTTP ${res.status} (${res.statusText || "no body"})`);
return {};
```
**Apply to:** both SC3b forms (log `status`/`statusText`, never the body; render the `UNKNOWN` envelope).

### Contact pointers
**Source:** `ContactPointerText` + `contactHref` (`src/lib/contact.ts`, the one encoder) and the `MetadataStep` / `SyncProgress` hosts above.
**Apply to:** every SC6a host. Pass ids only where the host already holds them; `newTab` only where the host holds unsaved state.

### Proof standard (SC8) and test-oracle independence
**Source:** CLAUDE.md memory rules plus the files' own headers (`_EXPECTED_*` "HAND-TYPED ... never imported", roster-render "NEVER `derived.length`", `invariant.test.ts` `expectedSites` rule).
**Apply to:** every test in this phase. Each fix: neuter, observe RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work); expected strings hand-typed; floors typed from a fresh measurement; always `grep -a`; pytest from `analytics-service/` only; mypy strict on any Python edit.

### Cite by symbol; planning edits stay off the ship branch
**Source:** CLAUDE.md `[164.7-CITATION-DRIFT-01]` and the ship-planning-guard. The `161-UI-SPEC.md` amendment and `.planning/WINDOWS.md` #12 ride a planning-only commit. `plan-anchor-verify` re-resolves every named symbol a pending PLAN asserts.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/161-UI-SPEC.md` (arm 3) | doc | n/a | One-sentence contract amendment; edit only WIZERR-01 arm 3 and add a dated note. Leave `161-RESEARCH.md`, `161-02-SUMMARY.md` and the 153.6 files as history. |
| `ApiKeyForm.tsx` envelope slot | component | request-response | No existing form takes an envelope-shaped prop; the `mt-4` position is defined, the prop shape is a planner choice (see its section). |
| Records (`TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json`) | records | n/a | Mechanism is CLAUDE.md prose (CHANGELOG discipline, TODOS deletes with ship); `VERSION` and `package.json` stay byte-equal 4-digit strings, never `npm version`. |

## Metadata

**Analog search scope:** `src/lib/` (`strategyGate`, `wizardErrors`, `contact`, `envelope`), `src/components/{strategy,exchanges,auth,contact,error,ui}`, `src/app/(dashboard)/strategies/new/wizard/steps`, `src/app/(dashboard)/allocations/components`, `src/app/api/{keys,strategies,account,admin}`, `src/__tests__`, `analytics-service/{services,tests}`, `.planning/milestones/v1.20-phases/161-*`.
**Files read this session:** about 30 (large files read by targeted ranges after locating symbols with grep: `wizardErrors.ts` 6601 lines, `SyncPreviewStep.tsx` 3418, `ConnectKeyStep.tsx` 2246, `create-with-key/route.ts` 1906, `route.test.ts` 4872, `test_mt5_concurrency.py` 2520).
**Tracked-source check:** one `git ls-files --` over every named analog and target path printed all 41 (run from the worktree root), covering `RenameStrategyDialog.tsx`, `MetadataStep.tsx`, `SyncProgress.tsx`, `ConnectKeyStep.tsx`, `route.audit.test.ts`, `seam-discriminator.ts`, `closed_sets.py`, `AllocatorExchangeManager.test.tsx`, `test_mt5_server_known.py` and the rest. None is under a `.gsd/capabilities` mirror.
**Claims taken from RESEARCH and not re-verified here:** the Python busy-copy byte-equality test and a `wizardErrors.test.ts` busy pin (not found, see SC4 copy section); that the real seam client leaves `seamCode` null for a flat `{ detail: "Unauthorized" }` body (rotate-secret case); `test_mt5_server_known.py::test_terminal_busy_detail_collides_with_no_cascade_needle` and the module note's banned-word list (file is tracked, symbol not opened).
**Pattern extraction date:** 2026-11-14

## Corrections to upstream artifacts found while mapping

1. UI-SPEC SC3 rule 1 says the recogniser should "translate through `SEAM_CODE_TO_WIZARD_CODE` first". That table is module-private (`const SEAM_CODE_TO_WIZARD_CODE`, not exported); the only public reader is `recogniseSeamErrorCode`. RESEARCH's code sketch already calls `recogniseSeamErrorCode`, so only the UI-SPEC wording is loose. The new recogniser lives in `wizardErrors.ts` (both documents agree) and calls `recogniseSeamErrorCode`, never the table.
2. RESEARCH names `venueAlreadyConnectedResponse` only implicitly; it is the in-file template for extracting a shared `KEY_ORPHANED` response builder (see SC5 section). Note the pre-RPC arm and the 23505 arm both currently call it for `connected`, which is the structural reason the orphan body should get the same treatment.
3. `ApiKeyForm`'s `submitBlockedReason` docblock says "The strategy key card passes it" while "`AllocatorExchangeManager` passes nothing"; the caller census (one `<ApiKeyForm` outside tests, in `AllocatorExchangeManager`) agrees with UI-SPEC, so that docblock is the stale party. Leave it (not this phase's scope) unless the plan touches that prop block.
