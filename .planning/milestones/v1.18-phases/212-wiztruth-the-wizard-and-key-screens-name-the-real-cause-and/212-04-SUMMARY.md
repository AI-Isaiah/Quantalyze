---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 04
subsystem: key-validation classifier, validate-and-encrypt code channel
tags: [wizard, seam, sc3, sc8, red-on-revert, bare-401]
requires: []
provides:
  - "UPSTREAM_STATUS_TO_SEAM_CODE exported once from src/lib/wizardErrors.ts; the validate-and-encrypt route imports it"
  - "classifyKeyValidationError status branch: a null-seamCode 401/403 answers SEAM_MISCONFIGURED at 500 for all three callers"
  - "recogniseValidateAndEncryptCode(body, status): the one status-aware recogniser plan 212-08's two dashboard forms call"
affects:
  - src/lib/wizardErrors.ts
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/keys/[id]/rotate-secret/route.ts
tech-stack:
  added: []
  patterns: ["own-property typeof reads in the classifier (never instanceof, route suites mock the seam client wholesale)", "status split on a wire code with two producers (RATE_LIMITED at 429 vs the venue's throttle)"]
key-files:
  created:
    - src/app/api/strategies/create-with-key/route.bare-401.test.ts
  modified:
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/lib/wizardErrors.invariant.test.ts
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/app/api/strategies/composite/add-key/route.test.ts
    - src/app/api/keys/[id]/rotate-secret/route.ts
    - src/app/api/keys/[id]/rotate-secret/route.test.ts
key-decisions:
  - "SEAM_MISCONFIGURED stays out of OUR_DEFECT_KEY_ERROR_CODES (CONTEXT); the docblock records that the Next-side page for a stale service key stops and the Python middleware still captures it"
  - "Classifier consults only the 401/403 rows of the map (RESEARCH Pitfall 4); 422/429 are not read there"
  - "A wire code of the literal string UNKNOWN answers recognised:false even though UNKNOWN is rostered, so the caller keeps its curated cause"
status: complete
commits: 4
plan_head_before: 8d92b8a8fc860d61efd8d248ca0c8612e9c0dae4
plan_head_after: f1a14a52d3a663b257ad0989485bad5ae7c10174
actuals:
  tokens: 14000
  tasks: 3
  commits: 4
---

# Phase 212 Plan 04: Bare 401/403 answers SEAM_MISCONFIGURED on every key route Summary

A bare upstream 401 or 403 (our own analytics service key refused, no seam code) now answers `SEAM_MISCONFIGURED` at status 500 on `create-with-key`, `composite/add-key` and `keys/[id]/rotate-secret` through one shared map that `validate-and-encrypt` also reads, and the dashboard forms get one status-aware recogniser that cannot confuse our limiter (429) with a venue throttle.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 (tracer) | cc65e9d55 | fix(212-04): a bare upstream 401/403 answers SEAM_MISCONFIGURED on every key route |
| 2 (deviation fix) | e3281c242 | fix(212-04): rotate-secret carries the upstream status so a bare 401/403 classifies |
| 2 | fb92a514c | test(212-04): bare 401/403 pinned on all three classifier callers |
| 3 | f1a14a52d | feat(212-04): one status-aware recogniser for the validate-and-encrypt code channel |

## What changed

- `wizardErrors.ts`: `UPSTREAM_STATUS_TO_SEAM_CODE` moved here from the route, `export` prefixed and otherwise byte-identical (same four rows), docblock moved with it and a lead paragraph added naming the move. It sits immediately above `classifyKeyValidationError`, so the first occurrence of its declaration prefix in the comment-stripped source is the declaration. The classifier gained a block after the `seamCode` and `seamTransportCode` blocks and before the message cascade, guarded by `typeof seamCode !== "string"` and by an own-property `typeof status === number` of 401 or 403. New `recogniseValidateAndEncryptCode` beside `recogniseDashboardDialogCode`. Docblocks: `KNOWN_VALIDATE_AND_ENCRYPT_CODES` (reader note, roster unchanged), `OUR_DEFECT_KEY_ERROR_CODES` (SEAM_MISCONFIGURED deliberately not added, paging consequence recorded).
- `validate-and-encrypt/route.ts`: the private declaration and docblock deleted, import added; the `mappedCode` expression untouched.
- `wizardErrors.invariant.test.ts`: the `[164.2-05 / WIZFORM-02]` describe reads `UNION_SOURCE` (the `VE_ROUTE` constant is gone), failure messages name `src/lib/wizardErrors.ts`, `EXPECTED_STATUS_MAP` still hand-typed and unchanged.
- New `create-with-key/route.bare-401.test.ts` (own file because plan 03 owns `route.test.ts`).
- No roster membership change, no new `WizardErrorCode`, `EXPECTED_TABLE_SIZE` pins untouched and green. No file under `supabase/migrations`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] rotate-secret never carried the upstream status to the classifier**
- **Found during:** Task 2 (the plan's own Step 1 instruction: confirm the real client leaves `seamCode` null for `{ detail: "Unauthorized" }`).
- **Issue:** The plan assumed `rotate-secret` builds its error "through the real client". It does not. The route builds a plain `Error(seamHumanMessage(errBody) ?? "Upstream <status>")` and attaches only `seamCode` (when present). `seamCode` is indeed null for the flat body, but `status` was never attached, so the new classifier branch could not fire and the case answered `UNKNOWN`. The must-have truth "rotate-secret, the classifier's third caller, also answers SEAM_MISCONFIGURED/500 for a bare 401" was false at HEAD for this caller.
- **Fix:** one own data property in the route, `upstreamFailure.status = res.status`, mirroring what `AnalyticsUpstreamError` carries for the other two callers. The classifier reads it with `typeof`, and only for a null `seamCode` at 401/403, so no other verdict on this route moves (the route's full suite, 52 cases, is green).
- **Files modified:** `src/app/api/keys/[id]/rotate-secret/route.ts` (outside the plan's `files_modified`; no other plan in the phase lists it).
- **Commit:** e3281c242

**2. [Rule 2 - hardening] The wire string "UNKNOWN" is not a recognition**
- `UNKNOWN` is a member of `KNOWN_VALIDATE_AND_ENCRYPT_CODES`, so the plan's step (d) would have returned `recognised: true` for the PROD-measured body `{"code":"UNKNOWN"}`, suppressing the caller's curated-cause fallback. The recogniser answers `recognised: false` for it (pinned by a case). Roster untouched.
- **Commit:** f1a14a52d

## SC8 RED-on-revert evidence

**Task 2 Step 3** (backup `cp`'d to the scratchpad, the classifier's new status block deleted, nothing else), five files run: 4 files failed, 6 cases failed, 552 passed of 558. Every failing case answered `UNKNOWN`:

1. `rotate-secret`: a bare upstream 401 answers SEAM_MISCONFIGURED at 500 and writes no row
2. `composite/add-key`: a bare upstream 401 answers SEAM_MISCONFIGURED/500 ...
3. `composite/add-key`: a bare upstream 403 answers SEAM_MISCONFIGURED/500 ...
4. `create-with-key/route.bare-401.test.ts`: answers SEAM_MISCONFIGURED at 500, not UNKNOWN, and writes nothing
5. `wizardErrors.test.ts`: status 401 with seamCode null answers SEAM_MISCONFIGURED at 500
6. `wizardErrors.test.ts`: status 403 with seamCode null answers SEAM_MISCONFIGURED at 500

`validate-and-encrypt/route.test.ts` stayed green (it reads the map directly, not the classifier). Restored: `cmp` exit 0, rerun 5 files, 558 passed.

**Task 3 Step 4** (step (b), the `RATE_LIMITED`-at-non-429 split, deleted): 2 failed, 307 passed of 309. The failures were `RATE_LIMITED at 424 (the venue throttled us) answers KEY_RATE_LIMIT` and `reads a nested service_error body through the discriminator` (its 424 half); `RATE_LIMITED at 429 (our own limiter) stays RATE_LIMITED` PASSED under the neuter, as designed. Restored: `cmp` exit 0, rerun 309 passed.

Not separately neutered: the `status` property carry in `rotate-secret/route.ts` (its case is already RED under the classifier neuter, and the pre-fix run answered `UNKNOWN` for it before the route fix, which is the observed RED for that line).

## Verification

- Seven-file vitest set from the plan plus the whole `create-with-key` directory: 9 files, 924 passed.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors (4 pre-existing warnings in files this plan does not touch: `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`).
- `grep -c 'const UPSTREAM_STATUS_TO_SEAM_CODE'` in the route: 0; `grep -c 'export const UPSTREAM_STATUS_TO_SEAM_CODE'` in `wizardErrors.ts`: 1; `grep -c 'export function recogniseValidateAndEncryptCode'`: 1.
- `KNOWN_VALIDATE_AND_ENCRYPT_CODES` Set literal: no added or removed member line (diff touches only comments around it).

## SC3 disposition for plan 08

Re-confirmed by grep at HEAD in `analytics-service/main.py` and `routers/exchange.py`. `recogniseValidateAndEncryptCode(body, status)` results:

| Wire shape reaching validate-and-encrypt's 4xx forward arm | Recogniser result | Notes |
|---|---|---|
| 429 `RATE_LIMITED` (our app limiter, `main.py` 429 `JSONResponse`) | `{RATE_LIMITED, recognised: true}` | alias |
| 424 `RATE_LIMITED` (venue throttle, `VenueTransientHTTPException` in `routers/exchange.py`, sFOX arm and ccxt arms) | `{KEY_RATE_LIMIT, recognised: true}` | status split via `VENUE_WIRE_CODE_TO_VERDICT` |
| 401 bare (`main.py` `verify_service_key`, `{"detail":"Unauthorized"}`) | route already maps to `SEAM_MISCONFIGURED` | recogniser sees the route's mapped code: alias, recognised |
| 403 bare | route maps to `SEAM_MISCONFIGURED` | see A1 below |
| 422 bare | route maps to `VALIDATION_FAILED` | alias, recognised |
| route literals (`KEY_MISSING_REQUIRED_FIELD`, `KEY_VENUE_NOT_ENABLED`, `STALE_CLIENT`, `SEAM_MISCONFIGURED`, `KEY_NOT_READ_ONLY`, `KEY_VENUE_ALREADY_CONNECTED`, `CIRCUIT_OPEN`, `UPSTREAM_TIMEOUT`) | alias or roster, recognised true | |
| 424 `NETWORK_UNAVAILABLE`, `SIGN_IN_FAILED`, `MT5_SERVER_UNKNOWN`, `MT5_TERMINAL_BUSY`, and the 424 `code=result["error_code"]` validator verdicts (`AUTH_FAILED`, `MISSING_SCOPE`, `PERMISSION_DENIED`, `WITHDRAW_SCOPE`, `TRADE_SCOPE`, ...) | `{UNKNOWN, recognised: false}` | plan 08 renders the UNKNOWN envelope shell with the route's curated `error` sentence as `cause` (UI-SPEC SC3 rule 5); recorded as a finding, richer copy needs a per-code truth audit and is not folded in here |
| flat 400 detail with no code (`AUTH_FAILED_DETAIL`, `MT5_WRONG_SERVER_DETAIL`, `MT5_MASTER_PASSWORD_DETAIL`, `SFOX_DISABLED_DETAIL`, `MT5_DISABLED_DETAIL`) | `{UNKNOWN, recognised: false}` | route answers `UNKNOWN` plus the curated sentence; same curated-cause fallback |
| the wire literal `"UNKNOWN"` | `{UNKNOWN, recognised: false}` | pinned by a case (deviation 2) |
| `__proto__`, `constructor`, `""`, non-string code, null / string / array body | `{UNKNOWN, recognised: false}` | pinned |

Plan 08 must also correct the consumer-count and "no consumer reads `code`" sentences about this route in `wizardErrors.ts` and its tests when they become false; this plan deliberately did not touch them.

## A1 finding (threat T-212-07)

Assumption A1 (no venue-meaning 401/403 on `/api/validate-key` or `/api/encrypt-key`) holds at HEAD. The only 401 in the service on that hop is `verify_service_key` in `main.py` (`{"detail":"Unauthorized"}`), refused before `call_next`. The only `HTTPException(403)` in `routers/exchange.py` is "API key does not belong to strategy owner" on `/fetch-trades` (declared after `/validate-key` at line 1505 and `/encrypt-key` at line 1675), a route none of the three classifier callers hit. So a 401/403 on the validate/encrypt hop is always our own service key, and mapping it to "not your key" is true.

## For ship (ship owns TODOS.md, CHANGELOG, VERSION)

- Closes `[164.2-WIZARD-BARE401]`.
- `[164.2-SEAMCODE-UNION]` stays open; its citations of the route file and the invariant-test lines for the status map go stale and must be re-pointed by symbol (`UPSTREAM_STATUS_TO_SEAM_CODE` in `src/lib/wizardErrors.ts`).
- CHANGELOG theme: behaviour change (bare 401/403 names our configuration on three more key routes), infrastructure/tests (new bare-401 route test, recogniser), note that the Next-side Sentry page for a stale service key stops (Python middleware still captures).

## Known Stubs

None.

## Threat Flags

None. The only new surface is a number attached to an in-process Error object in `rotate-secret/route.ts`; it is read only by the classifier and never serialised to the browser.

## Self-Check: PASSED

- FOUND: src/app/api/strategies/create-with-key/route.bare-401.test.ts
- FOUND commits (ancestors of HEAD): cc65e9d55, e3281c242, fb92a514c, f1a14a52d
