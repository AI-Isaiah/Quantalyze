# Phase 240: CONNECTTRUTH - Pattern Map

**Mapped:** 2026-11-24
**Anchored at:** worktree HEAD `68bbb93cc` (branch `gsd/phase-240-connecttruth`). Line numbers are HEAD readings; cite by symbol, they rot.
**Files analyzed:** 41 (21 modified source/doc, 8 new test/fixture files, 12 modified existing tests)
**Analogs found:** 41 / 41 (every file has an in-repo analog; two Wave-0 files are role-matches, not exact)

All analog paths below were checked with `git ls-files` and are tracked source (no gitignored mirror paths).

## File Classification

### Source files (modified)

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `analytics-service/services/rate_limit.py` | utility (key functions, claim verifier) | request-response | itself: `tenant_rate_limit_key`, `tenant_or_platform_key`, `anon_bucket_key` | exact (in-place widen) |
| `analytics-service/routers/process_key.py` (limits, providers, decorator stack) | route/config | request-response | itself: `_process_key_limit_for`, `_process_key_ceiling_limit_for`, decorator pair | exact |
| `analytics-service/routers/process_key.py` (`_envelope_error` caller, 424 pre-gate permanence) | route | request-response | itself: Phase 216 CSV 422 arm + PYAPIFIX-02 424 pre-gate | exact |
| `analytics-service/routers/exchange.py` (11 raise sites) | route | request-response | itself: existing `VenueTransientHTTPException(status_code=424, ...)` sites | exact |
| `analytics-service/services/error_contract.py` (docblock sentence only) | utility | request-response | `VenueTransientHTTPException` class | exact |
| `analytics-service/services/app_error_handlers.py` (`_alert_anon_bucket_saturated`) | middleware/handler | event-driven (alert) | itself | exact |
| `analytics-service/services/csv_validator.py` (`_detect_and_normalize_date_column` + helpers) | utility | transform | itself: `iso_like` mask + `year_first` merge | exact |
| `analytics-service/routers/csv.py` | route | request-response | docblock touch only, no limit change | n/a |
| `analytics-service/docs/STATUS_CONTRACT.md` | doc | n/a | self (replace `path:line` prose coords with symbols) | n/a |
| `src/lib/tenant-claim.ts` (`anonymousClaimPayload`, csv payload helper, `TenantIdentity` doc) | utility | transform (HMAC) | itself: `mintTenantClaim` | exact |
| `src/lib/process-key-client.ts` (`postProcessKey`, `PostProcessKeyArgs`) | service/client | request-response | itself: claim mint block | exact |
| `src/lib/ratelimit.ts` (`csvFinalizeLimiter`, `csvValidateLimiter` docblock) | config | request-response | itself: `csvValidateLimiter = makeLimiter(20, "60 s")` | exact |
| `src/lib/wizardErrors.ts` (`VENUE_WIRE_CODES_WITHOUT_VERDICT`) | config (roster) | n/a | existing entries `KILL_SWITCH_UNAVAILABLE`, `MT5_MASTER_PASSWORD` | exact |
| `src/app/api/verify-strategy/route.ts` | route | request-response | itself (`const ip = getClientIp(...)` already computed) | exact |
| `src/app/api/strategies/csv-finalize/route.ts` | route | request-response | itself (swap limiter) | exact |
| `src/app/api/strategies/csv-validate/route.ts` | route | request-response | no code change expected (flow_type csv already passed) | n/a |

### Tests and fixtures

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `analytics-service/tests/test_validate_key_permanent_400.py` (new) | test | request-response | `analytics-service/tests/test_validate_key_venue_transient.py` (`app_client`, `_arrange_*`, `_assert_flat_venue_body`) | exact |
| `analytics-service/tests/fixtures/validate_key_permanent_400_contract.json` (new) | fixture | n/a | `analytics-service/tests/fixtures/validate_key_venue_transient_contract.json` | exact |
| `tests/lib/validate-key-permanent-400-parity.test.ts` (new) | test | transform | `tests/lib/validate-key-venue-transient-parity.test.ts` | exact |
| `analytics-service/tests/test_process_key_anon_ip_tier.py` (new) | test | request-response | `analytics-service/tests/test_process_key.py` `throttled_client` + `test_anon_bucket_exhausts_at_30...` | role-match |
| `analytics-service/tests/test_process_key_csv_tier.py` (new) | test | request-response | same | role-match |
| `tests/lib/csv-limit-agreement.test.ts` (new) | test | file-I/O (reads two source files) | `tests/lib/process-key-onboard-contract-parity.test.ts` (readFileSync of `analytics-service/...`) | role-match |
| `tests/fixtures/tenant-claim-parity.json` (new cases) | fixture | n/a | itself | exact |
| `analytics-service/tests/test_process_key.py` (pins move) | test | request-response | itself | exact |
| `analytics-service/tests/test_anon_bucket_alert.py` (extend) | test | event-driven | itself | exact |
| `analytics-service/tests/test_limiter_identity.py` (widen gate 3) | test (static) | file-I/O | itself: `TestClassClosure` + `_source_name_tokens` | exact |
| `analytics-service/tests/test_tenant_claim_parsing.py`, `test_tenant_claim_parity.py` (extend) | test | transform | themselves | exact |
| validate-key census gate (new class in `test_validate_key_permanent_400.py`) | test (AST) | file-I/O | `analytics-service/tests/test_raw_5xx_census.py` (`scan_source`, `_enclosing_function_resolver`) | role-match |
| `analytics-service/tests/test_csv_validator_date_format_2026_05_27.py` (extend) | test | transform | itself (`_csv`, `_dates`, `_flag_rules`) | exact |
| `src/lib/tenant-claim.test.ts`, `src/lib/process-key-client.test.ts`, `src/lib/seam-venue-vocabulary.invariant.test.ts` (extend) | test | transform | themselves | exact |
| csv-finalize vitest mocks (5 files) | test | n/a | `csvValidateLimiter: {}` mock factory entry in each | exact |

## Pattern Assignments

### `analytics-service/services/rate_limit.py` (utility, request-response) — claim grammar, RLIM-01/02

**Analog:** itself. Add ONE private classifier used by both key functions (today they duplicate `payload == ANON_PAYLOAD`).

**Existing spots to edit** (symbols): `ANON_PAYLOAD`, `anon_bucket_key`, `tenant_rate_limit_key` (the `if payload == ANON_PAYLOAD:` arm), `tenant_or_platform_key` (same arm), module docblock (stale FINDING-10 prose, the "Verify strategy / CSV validate" token-cost rows, and the comment above the `get_remote_address` note that says "outside `routers/simulator.py` (FINDING-10)").

**Existing arms to copy the never-raise shape from** (`tenant_rate_limit_key`, lines 345-363):
```python
    try:
        payload = verify_tenant_claim(request)
        if payload == ANON_PAYLOAD:
            return anon_bucket_key(scope)
        if payload is not None:
            return f"{scope}:t:{payload}"
        log.warning("rate_limit.tenant_claim_unverified", scope=scope, claim_present=bool(_header(request, TENANT_CLAIM_HEADER)))
        return f"{scope}:unverified:{credential_hash(request)}"
    except Exception:
        log.error("rate_limit.key_func_degraded", scope=scope, exc_info=True)
        return f"{scope}:unverified:fallback"
```

**Grammar to implement** (RESEARCH Pattern 1): `public` -> `process_key:anon` (legacy shared fallback); `public:<32 lowercase hex>` (`re.fullmatch`) -> `process_key:anon:<hex>`; a verified `public:*` payload that fails the fullmatch -> the SHARED anon key, never `:t:`; `csv:<36-char uuid>` -> `process_key:csv:<uuid>`; malformed `csv:*` -> generic tenant arm. Never raise, never return `""` (an empty key makes slowapi skip the limit and log an ERROR; see `_NO_CREDENTIAL` comment, lines 166-169).

**Reuse, do not re-implement:** `verify_tenant_claim` (lines 266-316: `rsplit(".", 2)`, `exp`, `hmac.compare_digest`, 512-char cap). Add new key-spelling helpers beside `anon_bucket_key` (`f"{scope}:anon"`) so bucket, provider and alert share one spelling; add an aggregate-key helper spelled distinctly (`process_key:anon-all`, because `limits` storage keys include the amount, RESEARCH Pattern 2 item 8).

**Docblock corrections:** `routers/simulator.py` already re-keyed (Phase 163 SEC-05, `IP_KEYED_QUARANTINE = frozenset()` in `test_limiter_identity.py`). Replace the FINDING-10 paragraph and the "Nothing ... outside `routers/simulator.py`" comment with the measured current state. Cite by symbol.

---

### `analytics-service/routers/process_key.py` (route, request-response) — limit stack, RLIM-01/02

**Analog:** itself (lines 108-167 and the decorator pair above `async def process_key`).

**Constants pattern** (lines 108-124; keep as module-level strings so tests can `monkeypatch.setattr`):
```python
_PROCESS_KEY_TENANT_LIMIT = "100/hour"
_PROCESS_KEY_ANON_LIMIT = "30/hour"
_PROCESS_KEY_CEILING_LIMIT = "500/hour"
```
Add `_PROCESS_KEY_ANON_AGGREGATE_LIMIT = "200/hour"` and `_PROCESS_KEY_CSV_LIMIT = "60/minute"` in the same style (CONTEXT discretion numbers; founder-retunable, each with a docblock giving its derivation).

**Provider pattern** (lines 143-167): a callable that declares a parameter literally named `key` receives the key function output (`slowapi/wrappers.py` `LimitGroup.__iter__`).
```python
def _process_key_limit_for(key: str) -> str:
    return (
        _PROCESS_KEY_ANON_LIMIT
        if key == anon_bucket_key("process_key")
        else _PROCESS_KEY_TENANT_LIMIT
    )
```
Widen to prefix tests on the second segment (`process_key:anon`, `process_key:anon:*` -> anon; `process_key:csv:*` -> csv). The aggregate provider MUST be a callable and MUST declare NO `key` parameter (so its key function runs only for non-exempt requests). A static string would be evaluated BEFORE dynamic ones and re-create the ceiling-burn.

**Decorator stack — the order fix** (current source, evaluated bottom-up, so the ceiling runs FIRST today):
```python
@limiter.limit(_process_key_limit_for, key_func=_process_key_rate_limit_key)
@limiter.limit(_process_key_ceiling_limit_for, key_func=_process_key_ceiling_key)
async def process_key(request: Request, body: Annotated[_ProcessKeyBody, Body()]) -> ...
```
Target (RESEARCH Pattern 2): bottom = per-identity (evaluated first), middle = anon aggregate with `exempt_when=<not anonymous>`, top = ceiling with `exempt_when=<csv-scoped claim>`; all three callable providers. Rewrite the misleading comment above the stack ("Inner = per-identity; outer = the platform ceiling") to state the real evaluation order.

**`exempt_when` predicate shape** (one-parameter callable receives the request in slowapi 0.1.10; must never raise, built on `verify_tenant_claim`; safe default on fault: aggregate NOT exempt, ceiling NOT exempt):
```python
def _process_key_not_anonymous(request: Request) -> bool:
    payload = verify_tenant_claim(request)          # never raises
    return not (payload == ANON_PAYLOAD or (payload or "").startswith("public:"))
```
Wrap in try/except returning the safe default (same shape as the key functions).

**Permanence plumbing (CONN-05 light touch)** — analog is the Phase 216 CSV 422 arm that STATES `recoverable` (lines ~2044-2085) and `long_fetch.py`'s provenance read:
```python
# at the 403 _envelope_error(...) call: pass recoverable= derived from val.permanent when not None
# at the 424 pre-gate: `val.error_code not in exchange_svc.PERMANENT_VALIDATION_ERROR_CODES and val.permanent is not True`
```
Do NOT add the MT5 codes to `exchange_svc.PERMANENT_VALIDATION_ERROR_CODES` (pinned by `test_process_key_scope_rejection_statuses.py`) and do NOT reuse `_ROUTE_TERMINAL_ERROR_CODES` in the pre-gate (it holds `VALIDATION_UNEXPECTED`). Latent path: test by driving the helper/arm directly with a `ValidationResult(permanent=True)`.

---

### `analytics-service/routers/exchange.py` (route, request-response) — CONN-05, 11 raise sites

**Analog:** the existing flat-body raise at the sFOX 429 arm (lines ~437-442, 424):
```python
raise VenueTransientHTTPException(
    status_code=424,
    code="RATE_LIMITED",
    detail=RATE_LIMITED_DETAIL,
    recoverable=True,
)
```
**Imports already present:** `from services.error_contract import VenueTransientHTTPException` (line ~103). Detail constants (`AUTH_FAILED_DETAIL` already imported from `services.exchange`; `MT5_WRONG_SERVER_DETAIL`, `MT5_MASTER_PASSWORD_DETAIL`, `SFOX_DISABLED_DETAIL`, `MT5_DISABLED_DETAIL` from `services.closed_sets`) stay the same constants so `detail` stays byte-identical.

**Transform per site** (status stays 400, `recoverable=False`; `detail` untouched):
```python
raise VenueTransientHTTPException(
    status_code=400, code="AUTH_FAILED", detail=AUTH_FAILED_DETAIL, recoverable=False,
)
```
Site map (find by symbol, not line): `_validate_sfox_key` blank-token guard, `SfoxApiError` 401/403, aiohttp `ValueError` control-char -> `AUTH_FAILED`; `_validate_mt5_key_probe` `except Mt5ValidationError` `wrong_server` -> `MT5_WRONG_SERVER`, `auth` -> `AUTH_FAILED`; `except Mt5ClientError` `auth` / `wrong_server` arms -> same two; master-rejected arm (`trace.outcome = "master_rejected"`) -> `MT5_MASTER_PASSWORD`; `validate_key` sFOX gate and MT5 gate -> `VENUE_DISABLED`; `create_exchange` `except ValueError as e` -> `INVALID_REQUEST`, `detail=str(e)`.

Keep each `trace.outcome = ...` assignment that precedes the raise. Do NOT touch `fetch_trades`' raw `HTTPException(400, "Strategy has no connected API key")` or `routers/internal.py`'s raw 400s (out of scope).

**Rotate-secret go-dark gap (CONTEXT discretion, taken in this phase):** Python `rotate_key_secret` calls `_validate_mt5_key` without the `mt5_enabled_server()` gate. Copy the gate shape from `validate_key`:
```python
if not mt5_enabled_server():
    raise VenueTransientHTTPException(status_code=400, code="VENUE_DISABLED", detail=MT5_DISABLED_DETAIL, recoverable=False)
return await _validate_mt5_key(...)
```
(`routers/internal.py` owns `rotate_key_secret`; read it before editing.)

---

### `analytics-service/services/error_contract.py` (docblock only)

**Analog:** `VenueTransientHTTPException` docstring (lines ~345-410). Add one sentence: the class is the repo's one flat-body builder and now also carries permanent 400s (constructor guard `400 <= status_code < 500` already admits it). No code change.

---

### `analytics-service/services/app_error_handlers.py` (handler, event-driven) — alert follows the re-key

**Analog:** itself, `_alert_anon_bucket_saturated` (lines 223-281). The only equality to change:
```python
    if refusing_key != anon_bucket_key("process_key"):
        return
```
New rule: fire for {legacy shared key, anon-aggregate key} only; per-IP keys stay a structured warning only (dedupe dict `_anon_alert_last_at` is keyed by refusing key and would grow unbounded with per-IP keys). Keep byte-stable: the Sentry message `"Anonymous teaser bucket saturated on /process-key"`, fingerprint `["anon-bucket-saturated", "process_key"]`, tag `anon_bucket_saturated` (a Sentry rule outside the repo reads the tag). Use the shared key-spelling helpers from `rate_limit.py`, not a second string literal. The 429 body at `rate_limit_exceeded_handler` (lines 284-324) already carries no key/IP; do not add any.

---

### `analytics-service/services/csv_validator.py` (utility, transform) — CONN-06

**Analog:** itself — the `iso_like` mask and `year_first` merge in `_detect_and_normalize_date_column` (lines 885-906). Month-name cells follow the same technique: mask them out of the parse input, parse them independently, merge into BOTH readings.
```python
iso_like = s.str.match(r"^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}").fillna(False).astype(bool)
if iso_like.all():
    return None
with warnings.catch_warnings():
    warnings.simplefilter("ignore")
    parsed_mf = _parse_dates(s, dayfirst=False)
    parsed_df = _parse_dates(s, dayfirst=True)
    year_first = _parse_dates(s.where(iso_like), dayfirst=False)
    ...
    parsed_mf = parsed_mf.where(~iso_like, year_first).mask(odd_digits)
    parsed_df = parsed_df.where(~iso_like, year_first).mask(odd_digits)
```
**Write list, strictly inside date-detection/parse symbols** (Phase 222 owns `_maybe_auto_normalize_percent_form`; do not touch): new private `_MONTH_NUMBER` (own English dict, never `%b`), `_MN_DMY` / `_MN_MDY` regexes (4-digit year, anchored, `re.ASCII`), `_read_month_name_cell` (builds `datetime.date(y, m, d)` so `31 Feb` stays unreadable), `_month_name_cells(s) -> (mask, parsed)`, `_month_name_flag_sentence`, `_month_only_flag`. In `_detect_and_normalize_date_column` ONLY: compute the mask after `iso_like`; `s.where(~month_named)` for both parses; fill month cells into both readings; add `and not month_named.any()` to the `if not iso_like.any() and readable.all(): return None  # month-first is the only valid reading` branch; return the M-only flag from the two branches that currently `return None` after rewriting; append the "Also read ..." sentence in the day-first branch. Count N only when the column also holds a non-month, non-blank cell.

**Flag shape to copy** (the day-first return, lines 960-967; the rule literal stays `date_format_normalized`, no new `"rule":` literal, `test_csv_rule_family_oracle.py` pins the family):
```python
return {
    "rule": "date_format_normalized",
    "detected_format": "day_first",
    "message": (
        "Detected day-first (DD/MM/YYYY) dates and normalized them "
        "to YYYY-MM-DD."
    ),
}
```
Day-first sentence stays byte-identical. The four month-name sentences are pinned character-for-character in RESEARCH "Month-name flag text" (UI-SPEC section 1.3). Flag sentences use the fixed example `12 Mar 2024`, never the cell.

**Still-rejected cases to preserve** (pin in tests): `12 Mar 24`, non-English month, month cell with a time, ISO-first in a day-first column (existing limitation), cells over `MAX_DATE_CELL_CHARS = 64`.

---

### `src/lib/tenant-claim.ts` (utility, transform/HMAC) — mint grammar

**Analog:** itself. Imports (line 1): `import { createHmac } from "node:crypto";`. Keep guards 1/2/3 of `mintTenantClaim` unchanged. Pseudonym pattern (RESEARCH Pattern 1), same `createHmac` construction as the mint at lines 207-210:
```ts
const exp = Math.floor(Date.now() / 1000) + TENANT_CLAIM_TTL_SECONDS;
const signed = `${payload}.${exp}`;
const mac = createHmac("sha256", secret).update(signed).digest("hex");
return `${signed}.${mac}`;
```
Add `anonymousClaimPayload(ip, secret)`: returns `"public"` when `ip` is `"unknown"`/empty, else `public:` + `createHmac("sha256", secret).update("anon-ip:" + ip).digest("hex").slice(0, 32)` (domain-separated message so the pseudonym can never equal a claim MAC). The raw IP never leaves Vercel; payload stays dot-free. Update `TenantIdentity.userId` docblock (lines 99-110, "ONE server-side literal is also admitted: `public`") for the two new prefixes. Keep this module the ONE implementation (the file header says so).

---

### `src/lib/process-key-client.ts` (client, request-response) — single chokepoint

**Analog:** itself. The mint is at `postProcessKey` (lines ~405-420):
```ts
let tenantClaim: string;
try {
  tenantClaim = mintTenantClaim({ userId: args.userId }, internalToken);
} catch (err) {
  const tag = args.routeTag ?? "process-key-client";
  console.error(`[${tag}] refusing to call /process-key — could not mint X-Tenant-Claim`, { correlation_id: correlationId, reason: scrubSeamError(err) });
  ...
}
```
Derive the payload INSIDE this try (so a mint refusal keeps the existing 503 path), per RESEARCH "TS payload derivation": `args.userId === "public"` -> `anonymousClaimPayload(args.clientIp ?? "unknown", internalToken)`; `args.flow_type === "csv"` -> `` `csv:${args.userId}` ``; else `args.userId`. Add optional `clientIp?: string` to `PostProcessKeyArgs` (docblock like the neighbouring fields). `X-User-Id` header stays the literal `args.userId` (`"public"`), unsigned, diagnostic only: never put the hash there.

**Do-not-touch guards:** the line-scoped extractor reads `retriesOverride: retriesForFlow(args.flow_type, args.context),` on ONE physical line (line ~549); `src/lib/seam-log-coverage.test.ts` pins `console.*` sites in this file, so add NO new log site. `FlowType` is the closed union at line 60.

---

### `src/lib/ratelimit.ts` (config) — edge CSV split and docblock

**Analog:** itself (lines 83-95 `makeLimiter`, lines 195-206):
```ts
function makeLimiter(requests: number, window: `${number} s`): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(requests, window), analytics: true, prefix: "quantalyze" });
}
export const csvValidateLimiter = makeLimiter(20, "60 s");
```
Add `export const csvFinalizeLimiter = makeLimiter(20, "60 s");` (60 s window kept so the wire sentence "Wait a minute and try again" stays true; size unchanged). Rewrite the `csvValidateLimiter` docblock: it currently says "the upstream Python service has its own 30/hour cap (the CSV router's limiter in analytics-service/routers/csv.py)" and "Used by csv-validate AND csv-finalize so the wizard's validate->submit cycle rides the same dedicated bucket" (both stale; the real upstream tier is `_PROCESS_KEY_CSV_LIMIT`, sized at 3x the edge so latency between the edge check and the upstream hit cannot push an admitted user over it; do not call it "airtight"). The stale-phrase gate in `tests/lib/csv-limit-agreement.test.ts` asserts the old phrase is gone. `publicIpLimiter` (line 117) is shared with factsheet/scenario/BTC/PDF routes: do not retune.

`getClientIp` (lines ~654-690) is the single IP reader; `verify-strategy` already calls it, pass its result through.

---

### `src/app/api/verify-strategy/route.ts` and `csv-finalize/route.ts` (route, request-response)

**verify-strategy analog:** itself. `ip` is already computed (`const ip = getClientIp(req.headers);` at line 61, used for `publicIpLimiter`). At the `postProcessKey({ flow_type: "teaser", ..., userId: "public" })` call (line ~409-422) add `clientIp: ip`. Keep `userId: "public"` (the existing comment above it says why; update that comment).

**csv-finalize analog:** itself. Swap the import and the limiter instance:
```ts
import { csvValidateLimiter, checkLimit, rateLimitDenyJson } from "@/lib/ratelimit";
...
const rl = await checkLimit(csvValidateLimiter, `strategies-csv-finalize:${user.id}`);
```
becomes `csvFinalizeLimiter`; the identifier string and the post-validation position (B15 limiter-ordering comment) stay. csv-validate keeps `csvValidateLimiter` and its identifier `strategies-csv-validate:${user.id}`. Five vitest files mock `@/lib/ratelimit` with a closed factory, and a missing export on a `vi.mock` factory throws, so each needs the new export (see test section).

---

### `src/lib/wizardErrors.ts` (roster) — two new emitted codes

**Analog:** the existing reasoned entries in `VENUE_WIRE_CODES_WITHOUT_VERDICT` (a `ReadonlyMap<string,string>`, line ~5365), e.g. `KILL_SWITCH_UNAVAILABLE`:
```ts
export const VENUE_WIRE_CODES_WITHOUT_VERDICT: ReadonlyMap<string, string> =
  new Map([
    [
      "KILL_SWITCH_UNAVAILABLE",
      "NOT a key-validation code at all — it is the match engine's " + ...
    ],
```
Add `VENUE_DISABLED` and `INVALID_REQUEST` entries: each reason over 80 characters, written from a replay of `classifyKeyValidationError` (RESEARCH A5: the UI-SPEC claim that both render `UNKNOWN` through the cascade was NOT replayed; replay it with vitest once `npm ci` has run before writing the reason). `MT5_MASTER_PASSWORD` and `MT5_WRONG_SERVER` are already in this map; `AUTH_FAILED` already maps to `KEY_AUTH_FAILED` in `VENUE_WIRE_CODE_TO_VERDICT`. No verdict row is added (a code cannot hold both a row and an exemption: "no code is BOTH mapped and exempt").

---

### `analytics-service/tests/test_validate_key_permanent_400.py` (new test, request-response)

**Analog:** `analytics-service/tests/test_validate_key_venue_transient.py`. Copy the harness verbatim in shape.

**Client fixture** (lines 238-275: full `main.app`, go-live env flags, limiter reset, `SERVICE_KEY` patched on the module global):
```python
@pytest.fixture
def app_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SFOX_ENABLED", "true")
    monkeypatch.setenv("MT5_ENABLED", "true")
    ...
    import main
    _reset = getattr(getattr(main.app.state, "limiter", None), "reset", None)
    if callable(_reset):
        _reset()
    monkeypatch.setattr(main, "SERVICE_KEY", _SERVICE_KEY)
    return TestClient(main.app, raise_server_exceptions=False)
```
**Patching rule:** patch via `_handler_globals("/api/validate-key")` + `monkeypatch.setitem(g, name, ...)`, never by re-importing `routers.exchange` (stale-module hazard documented at lines 278-330). Reuse `_arrange_sfox(monkeypatch, status)` (sFOX 401/403 via `SfoxApiError(status, ...)`), `_arrange_mt5(monkeypatch, login_raises=...)`, `_MT5_FIELDS`, `_post_validate_key(client, **overrides)`.

**Assertion helper:** clone `_assert_flat_venue_body` (lines 411-488) with `EXPECTED_STATUS = 400` and `recoverable=False`; keep the exact key-set pin (`{detail, code, recoverable}`), `type(body["detail"]) is str`, the `detail` literal typed in the test (oracle discipline: expected strings are retyped, never imported at module scope; the cross-artifact pin imports constants inside the pin function bodies), and fixture-parity assertions against the NEW fixture.

**One test per venue** (CONTEXT): ccxt-adjacent `create_exchange` `ValueError` arm (`INVALID_REQUEST`), sFOX (`AUTH_FAILED` for 401, empty token, control char; `VENUE_DISABLED` gate), MT5 (`MT5_WRONG_SERVER`, `AUTH_FAILED`, `MT5_MASTER_PASSWORD`, `VENUE_DISABLED` gate; plus rotate-secret gate). Add a census test with the `EXPECTED_FIXTURE_TRIGGERS` named-and-driven shape (analog `test_every_fixture_case_is_named_and_driven_here`, lines ~1581-1630).

**Census gate (AST) analog:** `analytics-service/tests/test_raw_5xx_census.py` `scan_source` / `_enclosing_function_resolver` (lines 317-390). Reuse the walk: an `ast.Call` with `ast.Name` func `HTTPException`, status from `status_code=` keyword or first positional, accepted only as an `ast.Constant` int; key by enclosing FUNCTION NAME, never line number. Scope to `validate_key`, `_validate_sfox_key`, `_validate_mt5_key`, `_validate_mt5_key_probe` in `routers/exchange.py` and fail on any bare `HTTPException` with status 400 (`fetch_trades` legitimately keeps a raw 400 and must not be swept in). Include positive/negative scanner self-tests in the style of that file (`test_positive_a_POSITIONAL_status_is_detected`, `test_negative_a_COMMENTED_OUT_raise_is_NOT_detected`).

**Direct-call tests that must keep passing:** `test_sfox_validate.py`, `test_mt5_validate.py`, `test_mt5_validate_parity.py`, `test_mt5_rotate_secret_internal.py` use `pytest.raises(HTTPException)` and `.detail` / `.status_code`; `VenueTransientHTTPException` subclasses `HTTPException`, so they stay green. Do NOT extend `validate_key_venue_transient_contract.json` (its TS reader asserts one status, 424, and `EXPECTED_FIXTURE_TRIGGERS` pins 18 triggers one-to-one).

### `analytics-service/tests/fixtures/validate_key_permanent_400_contract.json` and `tests/lib/validate-key-permanent-400-parity.test.ts` (new)

**Analogs:** `validate_key_venue_transient_contract.json` (top-level `contract`, `notes`, `consumers[]`, `cases[]` each `{site_id, trigger, note, status, body:{detail, code, recoverable}}`) and `tests/lib/validate-key-venue-transient-parity.test.ts` (zero module mocks, `readFileSync(resolve(process.cwd(), "analytics-service/tests/fixtures/..."))`, a hand-typed `EXPECTED` roster per code with `wizardCode` / `wireRecoverable` / `envelopeRecoverable`, drives `classifyKeyValidationError` and `buildEnvelope`). COMMITTED, never generated (python and frontend-test CI jobs have no `needs:` edge). The new TS test's roster rows are replayed from the real classifier, not guessed (RESEARCH A5).

---

### `analytics-service/tests/test_process_key_anon_ip_tier.py` and `test_process_key_csv_tier.py` (new tests, request-response)

**Analog:** `analytics-service/tests/test_process_key.py` — `throttled_client` fixture (lines 3207-3226) and `_post` (3229-3238), `_mint_claim` (2853-2868). Import the router and helpers FROM `tests.test_process_key` (as `test_anon_bucket_alert.py` does, with its comment about `routers.process_key` being popped and re-imported), never import `routers.process_key` directly.
```python
@pytest.fixture
def throttled_client(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", _CLAIM_SECRET)
    app = build_test_app(process_key_router.router)
    app.state.limiter = process_key_router.limiter
    process_key_router.limiter.reset()
    yield TestClient(app, raise_server_exceptions=False)
    process_key_router.limiter.reset()
```
**Behaviour-test shape** (copy `test_two_stacked_limits_both_evaluated` lines 3265-3297): shrink constants with `monkeypatch.setattr(process_key_router, "_PROCESS_KEY_..._LIMIT", "3/hour")`, drive real requests, any non-429 means admitted. Required arms per RESEARCH: IP A exhausts 30 and IP B is admitted; aggregate refuses past its size; **IP A hammering well past its limit does not move the aggregate or the ceiling and a tenant stays admitted** (the order finding); 60 csv calls in one minute for one user none 429 and the 61st refused; tenants saturating a shrunk ceiling do not refuse csv; hygiene arm with `structlog.testing.capture_logs` (analog `test_anon_bucket_alert.py` imports `capture_logs`) asserting no IP / hash / bucket key in the 429 body, headers or the app handler's log line. Literal expected bucket strings only (oracle discipline: `_mint_claim` recomputes the HMAC from stdlib, nothing imported from `services.rate_limit`). Hex payloads in new tests must be computed in the test from `hmac`, never pasted from a captured claim.

---

### `analytics-service/tests/test_process_key.py` (existing, pins that MOVE in the same commit)

- `test_process_key_limit_sizing_literals` (lines 3129-3148): add literals for csv, aggregate, per-IP anon.
- `test_process_key_route_registers_both_limits` (3151-3164): `len(groups) == 2` -> 3, rename; add an order literal reading `limiter._dynamic_route_limits["routers.process_key.process_key"]` key-function names in evaluation order `[per-identity, aggregate, ceiling]`.
- `test_two_stacked_limits_both_evaluated`, `test_inner_tenant_limit_evaluates_independently_of_the_ceiling`: expected to stay green under the new order (measured 32 pins green under a byte-copy swap); confirm.
- `test_teaser_claim_buckets_to_anon` (3011-3030) stays: bare `public` is the legacy shared fallback.
- `test_process_key_limit_key_func_is_not_get_remote_address` (3109-3126) stays.

### `analytics-service/tests/test_anon_bucket_alert.py` (extend)

**Analog:** itself. Fixtures `sentry_spy`, `clock`, `client` (which shrinks `_PROCESS_KEY_ANON_LIMIT` to `"2/hour"` via `monkeypatch.setattr`) and `_post`. Existing `test_anonymous_refusal_emits_one_tagged_event` drives the legacy `public` claim and stays valid. Add arms: aggregate-key refusal emits exactly one event with the same message/fingerprint/tags; a per-IP refusal emits nothing and does not grow `_anon_alert_last_at`.

### `analytics-service/tests/test_limiter_identity.py` (widen gate 3)

**Analog:** itself, `TestClassClosure.test_no_router_source_references_get_remote_address` (lines 522-548) and `_source_name_tokens` (token-based, not grep):
```python
offenders = {
    p.name
    for p in sorted(ROUTERS_DIR.glob("*.py"))
    if "get_remote_address" in _source_name_tokens(p)
}
assert offenders == IP_KEYED_QUARANTINE, (...)
```
Add a sibling test (keep the `== IP_KEYED_QUARANTINE` equality convention, quarantine stays empty) scanning every non-test `.py` under `analytics-service/` for the NAME token. Green by construction today, so PROOF-01 requires showing it RED by planting the token in a `services/` byte copy. L-4 stays `"30 per 1 hour"`; the simulator row L-10 already records the SEC-05 re-key (nothing to redo).

### `tests/fixtures/tenant-claim-parity.json` + `src/lib/tenant-claim.test.ts` + `analytics-service/tests/test_tenant_claim_parity.py` + `src/lib/analytics-client.test.ts`

**Analog:** the fixture itself. Cases are `{name, why, payload, secret, exp, claim}`; each `claim` was computed ONCE by a standalone `node -e` calling `node:crypto` directly (see the fixture `_comment`), never by importing the module under test. Add cases for `public:<hex32>`, `csv:<uuid>` and a malformed `public:*` payload (far-future `exp`, like the 2050/2030 cases). New cases move all three readers by design; `test_fixture_is_present_and_populated` floor is "at least 4 cases". Python side reads `payload` via `verify_tenant_claim`; add per-payload bucket-key assertions in `test_tenant_claim_parsing.py` (hostile-input corpus style) for the new classifier and both `exempt_when` predicates (safe defaults on fault).

### `src/lib/process-key-client.test.ts` (extend) and `tests/lib/csv-limit-agreement.test.ts` (new)

**process-key-client.test.ts analog:** `it("mints the literal payload 'public' on the anonymous teaser path", ...)` (line 648) and the `it.each([["teaser","public"],["onboard","u1"],["resync","u2"],["csv","u3"]])` claim-attached table (line 665). That test stays valid with no IP passed; add IP-known -> `public:<hex32>` recomputed with an independent `createHmac` in the test, IP-unknown -> `public`, `flow_type: "csv"` -> `csv:<uuid>` and ONLY then, raw IP absent from every header and logged value. `tests/integration/process-key-thin-adapters.test.ts` pins `X-User-Id = public`; stays.

**csv-limit-agreement analog:** `tests/lib/process-key-onboard-contract-parity.test.ts` shape (`readFileSync(resolve(process.cwd(), "analytics-service/..."))`, hand-typed literals, no module mocks). Read `src/lib/ratelimit.ts` (the `csvValidateLimiter`/`csvFinalizeLimiter` numbers) and `analytics-service/routers/process_key.py` (`_PROCESS_KEY_CSV_LIMIT`) as text; one assertion `python per-minute >= edge per-window`; assert the stale phrase "the upstream 30/hour cap" is gone from the docblock and the csv tier literal is named. Neuter by editing either number in a source copy.

### csv-finalize vitest mock factories (5 files)

**Analog:** the entry `csvValidateLimiter: {},` inside each closed `vi.mock("@/lib/ratelimit", ...)` factory, e.g. `src/app/api/strategies/csv-finalize/route.test.ts` (lines 49-58: `importActual`, then `csvValidateLimiter: {}, checkLimit: checkLimitMock, rateLimitDenyJson: actual.rateLimitDenyJson, isRateLimitMisconfigured: actual.isRateLimitMisconfigured`) and `src/__tests__/csv-finalize-after-failloud.test.ts` (line 46). Add `csvFinalizeLimiter: {}` to: `src/app/api/strategies/csv-finalize/route.test.ts`, `src/__tests__/csv-finalize-after-failloud.test.ts`, `csv-finalize-c14-regression.test.ts`, `csv-finalize-concurrent-never-classified.test.ts`, `csv-finalize-cross-submission-merge.test.ts`. csv-validate's mocks and `seam-ratelimit-posture.invariant.test.ts` (line 321 roster `["src/app/api/strategies/csv-validate/route.ts", ["csvValidateLimiter"]]`) stay as they are. Add one identity assertion that each route calls `checkLimit` with its own limiter object and distinct identifiers.

### `src/lib/seam-venue-vocabulary.invariant.test.ts` (extend)

**Analog:** itself. `EXPECTED_EMITTED_CODES` (line 786, alphabetic hand-typed roster with dated comments per code) goes 48 -> 50 (`INVALID_REQUEST`, `VENUE_DISABLED`); `DERIVED_FLOOR = 28` (line 967) moves by its own rule 0.6 x 50 = 30.0 -> 30, and the dated history comment above it gets a new "28 -> 30 (2026-11-24, Phase 240)" line in the same voice. The emitter scanner reads `code=` literals of `VenueTransientHTTPException`, so literal codes leave the `routers/exchange.py: 1` dynamic-site pin unchanged. `wizardKeyRosters.ts` `CLASSIFIER_RETURNED_CODES` does not move.

### `analytics-service/tests/test_csv_validator_date_format_2026_05_27.py` (extend)

**Analog:** itself. Helpers (lines 40-61):
```python
def _csv(rows, header="date,daily_return") -> bytes:
    body = "\n".join(f"{d},{r}" for d, r in rows)
    return f"{header}\n{body}\n".encode("utf-8")
def _dates(envelope): return [row["date"] for row in (envelope.get("daily_returns_series") or [])]
def _flag_rules(envelope): return {f["rule"] for f in (envelope.get("info_flags") or [])}
```
Acceptance shape to copy: `test_european_day_first_with_day_over_12_now_accepted` (lines 163-173: `env["ok"] is True`, `_dates(env) == [...]`, `date_flags[0]["detected_format"]`). Rejection shape to copy: `test_unparseable_dates_still_rejected_without_flag` (lines 231-240). Parametrize spelling x position (mid, first, last) x column format (DD/MM, MM/DD, ISO) x schema (`daily_returns`, `daily_nav`, `trades`); for `trades` build from an existing valid trades fixture (the research probe's residual error was a currency rule from a synthetic file). Pin the five flag sentences character for character, the day-first flag byte-identical, the all-month column unchanged (accepted, no flag). Also run `test_csv_rule_family_oracle.py`, `test_csv_never_raises_170_1.py`, `test_csv_hostile_inputs_170_1.py`. Evidence was gathered on local pandas 3.0.1 / pandera 0.32.1 / Python 3.14; CI is 3.12 / 3.0.3 / 0.34.1, so re-run on CI.

---

## Shared Patterns

### Key functions and predicates never raise (G-8)
**Source:** `analytics-service/services/rate_limit.py` `tenant_rate_limit_key` (lines 319-363), `platform_ceiling_key` (366-383), `verify_tenant_claim` (266-316).
**Apply to:** the new classifier, aggregate key function, both `exempt_when` predicates, any new key spelling. slowapi re-raises whatever a key function throws (`swallow_errors=False`), producing a bodyless 500 that feeds the TS breaker. Every new function: `try: ... except Exception: log.error(..., exc_info=True); return <safe default>`; never return `""`.

### Callable limit providers, not static strings
**Source:** `routers/process_key.py` `_process_key_limit_for`, `_process_key_ceiling_limit_for`.
**Apply to:** all three stacked limits. Static limits always evaluate before dynamic ones (`route_limits = limits + dynamic_limits`), which silently reorders the stack.

### Literal limit constants and pins move in the same commit
**Source:** `tests/test_process_key.py` `test_process_key_limit_sizing_literals`; `tests/test_limiter_identity.py` literal tables.
**Apply to:** every limit change; use `monkeypatch.setattr(process_key_router, "_PROCESS_KEY_..._LIMIT", ...)` to exercise a limit without a hundreds-of-requests loop.

### Flat error body via the one builder
**Source:** `services/error_contract.py` `VenueTransientHTTPException`.
**Apply to:** all 11 exchange.py raise sites and the rotate gate. Never `service_error(...)` here (nests an object at `body["detail"]`, which the TS seam stringifies to `[object Object]`); never a new exception class.

### Oracle discipline (expected values typed in the test)
**Source:** `tests/test_validate_key_venue_transient.py` header and `EXPECTED_*_DETAIL` literals; `tests/test_process_key.py` `_mint_claim` ("computed here from the stdlib, NOT by importing the production verifier"); `tests/fixtures/tenant-claim-parity.json` `_comment`.
**Apply to:** every new test. Wire expectations, bucket strings and claim bytes are literals or independently computed; none read from the module under test.

### Committed cross-language fixtures, zero module mocks
**Source:** `tests/lib/validate-key-venue-transient-parity.test.ts`, `tests/lib/process-key-onboard-contract-parity.test.ts`.
**Apply to:** `validate_key_permanent_400_contract.json` and its TS reader, `csv-limit-agreement.test.ts`. Fixtures are committed, never generated (python and frontend-test jobs have no `needs:` edge).

### Cite by symbol, never by line number
**Source:** `tests/test_raw_5xx_census.py` (keys sites on `(module, function, status)`, never line numbers) and the CLAUDE.md citation-drift rule.
**Apply to:** every new docblock, test message and `STATUS_CONTRACT.md` edit. A mechanical `grep -noE '[A-Za-z_/.-]+\.(py|ts|tsx):[0-9]+'` over the doc should return only lines inside the S-table afterwards (the S-table is a historical census, kept and recorded with that reason).

### PROOF-01: neuter in a byte copy
**Apply to:** each new gate. Byte-copy the file, neuter (RESEARCH "PROOF-01 neuter points" table lists 17), run the named test to RED with its arm named, restore with `cp` and verify with `cmp`, run GREEN, record verbatim in the plan SUMMARY. Never `git checkout`, `git restore` or `git stash` on uncommitted work.

### Type and test gates
**Apply to:** every analytics-touching plan. `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; pytest only from `analytics-service/`; no `importlib.reload` in tests; grep with `grep -a`. TS side needs `npm ci` first (this worktree has no `node_modules`, so every TS statement in RESEARCH is from reading); per AGENTS.md, skim the relevant `node_modules/next/dist/docs/` guide before touching the route handlers.

## No Analog Found

None. Closest-to-novel items and the nearest analog used:

| File / Behavior | Role | Data Flow | Note |
|-----------------|------|-----------|------|
| `exempt_when` on a stacked decorator | config | request-response | No in-repo use of `exempt_when` on `/process-key` today (its docblock wrongly says it "cannot see the request"; false in slowapi 0.1.10, which passes the request to a one-parameter callable). Planner uses RESEARCH Pattern 2 probe A, which was executed against slowapi 0.1.10. |
| Source-text agreement test across Python and TS | test | file-I/O | Existing parity tests read fixtures, not source. `csv-limit-agreement.test.ts` reads two source files; use the fixture-reader shape and a regex over each file. |
| `logging.Filter` on the `slowapi` logger (RESEARCH Open Question 1) | utility | event-driven | CONTEXT resolved this as "no logging filter; the rule binds response BODIES". Do not build one. |

## Metadata

**Analog search scope:** `analytics-service/{services,routers,tests,tests/fixtures,docs}`, `src/lib`, `src/app/api/{verify-strategy,strategies}`, `src/__tests__`, `tests/{lib,fixtures,integration}`.
**Files read for excerpts:** `rate_limit.py` (whole), `process_key.py` (lines 60-170, 374-513, 1160-1180, 2030-2170), `app_error_handlers.py` (195-345), `error_contract.py` (345-450), `exchange.py` (98-110, 430-462, 575-596, 970-986, 1338-1350, 1715-1750, 1838-1856), `csv_validator.py` (805-975), `tenant-claim.ts` (whole), `process-key-client.ts` (320-425), `ratelimit.ts` (78-125, 175-215, 640-700), the three route files, `test_process_key.py` (2840-3320), `test_anon_bucket_alert.py`, `test_limiter_identity.py`, `test_validate_key_venue_transient.py`, `test_raw_5xx_census.py`, `test_csv_validator_date_format_2026_05_27.py`, both TS parity tests and fixtures.
**Pattern extraction date:** 2026-11-24
