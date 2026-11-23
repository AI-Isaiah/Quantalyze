---
phase: 212
slug: wiztruth
status: secured
threats_open: 0
asvs_level: 1
block_on: high
audited_at_head: 1213ab060
diff_base: 4c4fa1993
---

# Phase 212 WIZTRUTH - Security Verification

Verdict: **SECURED**. 17 numbered threats (T-212-01..08, T-212-10..18; the register has no T-212-09) plus the T-212-SC accept row repeated in each of the nine plans. Every `mitigate` threat has its mitigation found in code at HEAD `1213ab060`; every `accept` row is recorded below as an accepted risk. No threat is rated high or critical. `threats_open: 0`.

Verification method: ASVS L1 grep-level presence, with L2-style boundary placement checks on the review-fix surface. Targeted tests re-run at HEAD: `validate-and-encrypt/route.test.ts`, `wizardErrors.test.ts`, `no-email-in-copy.test.ts`, `create-with-key/*` - 6 files, 669 tests, all passed.

## Threat verification

| Threat ID | Category | Severity | Disposition | Status | Evidence |
|-----------|----------|----------|-------------|--------|----------|
| T-212-01 | Info disclosure | medium | mitigate | CLOSED | `analytics-service/services/mt5_probe.py` new `MT5_GATEWAY_MISCONFIGURED_DETAIL` sentence names no credential word and no remote text; `test_mt5_validate_parity.py::test_every_builder_emittable_constant_is_curated_and_credential_free` (parametrized over the constant family, classifier verdict must be `transient`) is unmodified in assertions (only a docstring/arm-3 comment edit in the diff) |
| T-212-02 | Denial of service | low | mitigate | CLOSED | `analytics-service/tests/test_mt5_concurrency.py::test_a_held_job_terminal_never_delays_a_validation_acquisition` added; fails with a named message if validation and job keys collapse; includes the equal-pair RED control; `_MT5_LEASE_WAIT_S` not touched in the diff |
| T-212-03 | Tampering | low | mitigate | CLOSED | `src/lib/strategyGate.ts` `isSeriesExaminedButRefused` = `SERIES_EXAMINED_BUT_REFUSED.has(v ?? "")` (Map/Set membership only; null and unknown strings answer false); `SyncPreviewStep.tsx` falls to `SERIES_PROVENANCE_UNVERIFIED` otherwise (fail-closed); pinned by the `some_future_verdict` case |
| T-212-04 | Info disclosure | medium | mitigate | CLOSED | `create-with-key/route.ts`: `keyOrphanedResponse()` takes no parameters, body is a fixed `code` + static `error`, `NO_STORE_HEADERS`; early arm at the `venueMatch.kind === "orphaned"` branch calls it; `resolveByVenueIdentity` selects on `.eq("user_id", userId)` with `user.id` passed at the call site, so it can only see the caller's own row. No venue id, strategy name or key id in the body |
| T-212-05 | Spoofing | low | mitigate | CLOSED | Resolver returns `UNRESOLVED` on admin-client throw or read fault and the route has no refusal for that kind, so it falls through to `validateKey`; only `kind === "orphaned"` (a positive row match through `resolveStrategiesForKey`) refuses |
| T-212-06 | Tampering | medium | mitigate | CLOSED | `wizardErrors.ts` `recogniseValidateAndEncryptCode`: wire code read via `seamErrorCode`/typed string check, then `recogniseSeamErrorCode` (Map), `VENUE_WIRE_CODE_TO_VERDICT.get` (Map), `KNOWN_VALIDATE_AND_ENCRYPT_CODES.has` (Set), one guarded cast only after membership, else `{UNKNOWN, recognised:false}`. No plain-object property reads; empty string and non-string answer unrecognised |
| T-212-07 | Spoofing | medium | mitigate | CLOSED | `classifyKeyValidationError` maps a bare 401/403 (no seam code) to `SEAM_MISCONFIGURED`, status 500, upstream 401 not echoed; branch now restricted to `error.name === "AnalyticsUpstreamError"` (review WR-04), and `rotate-secret/route.ts` stamps that name and `status` on its hop error. `SEAM_MISCONFIGURED` is now in `OUR_DEFECT_KEY_ERROR_CODES` so a stale service key or internal token pages again |
| T-212-08 | Repudiation | low | accept | CLOSED (accepted) | Original plan accepted no Next-side page; superseded by review WR-04 which restores paging (stricter than the accepted risk). Residual: two events for one fault on the service-key hop (noise, recorded in the `OUR_DEFECT_KEY_ERROR_CODES` docblock) |
| T-212-10 | Info disclosure | medium | mitigate | CLOSED | `StrategyForm.tsx` and `AllocatorExchangeManager.tsx`: on a non-JSON body the only log is `HTTP ${status} (${statusText})`; body, typed key and secret never reach `console.error`; pinned by case (f) and the non-JSON case in the allocator test |
| T-212-11 | Spoofing | medium | mitigate | CLOSED | Both forms call `buildEnvelope(code, correlationId)` with no `surface`/`venue` context, so `fixRequires`-gated wizard bullets are suppressed; case (h) pins the absence of "Your draft is saved." |
| T-212-12 | Tampering | low | mitigate | CLOSED | Curated `error` is placed in `envelope.cause` and rendered as a React text node inside `ErrorEnvelope`; only the fixed contact-form phrase becomes a link, via `ContactPointerText` with an href from `contactHref`. 5xx forwarded-code bodies do not replace UNKNOWN-copy with upstream text (`curatedAllowed` gate, review WR-02) |
| T-212-13 | Tampering | low | mitigate | CLOSED | `src/components/contact/ContactPointerText.tsx`: `newTab` sets `target="_blank" rel="noopener noreferrer"`; the newTab call sites (ScenarioCommitDrawer, WeightOptimizerSection, wizard steps) all go through that component |
| T-212-14 | Info disclosure | low | mitigate | CLOSED | All new hrefs come from `contactHref` (`encodeURIComponent` on every value; topic/strategy only); no `@` in new copy; `no-email-in-copy.test.ts` extended and passing |
| T-212-15 | Tampering | low | mitigate | CLOSED | `ContactPointerText` renders `{before}`, one `Link`, `{after}` as text nodes (no `dangerouslySetInnerHTML`); `SyncProgress` passes `computation_error` as `text` with a fixed `contactHref`, so column text cannot set a URL |
| T-212-16 | Info disclosure | low | mitigate | CLOSED | Diff of account/export, admin send-intro, partner-import, csv-finalize, finalize-wizard routes: only static string literals changed, no interpolation, no new response fields |
| T-212-17 | Repudiation | low | mitigate | CLOSED | send-intro and partner-import `audit_warning` now read "Add the audit entry by hand; do not re-send" / "Do NOT re-run the import"; status codes untouched in the diff |
| T-212-18 | Info disclosure | low | mitigate | CLOSED | `no-email-in-copy.test.ts` source-scan arm extended to every touched module, exact-literal allowlist (`you@example.com`, `local@host.tld`) with a presence check; passing at HEAD |
| T-212-SC (plans 01-09) | Tampering | low | accept | CLOSED (accepted) | Committed lockfiles/requirements only. `git diff 4c4fa1993..HEAD --stat` shows no `package.json`, lockfile or `requirements*.txt` change |

## Review-fix round (explicit checks)

| Check | Result | Evidence |
|-------|--------|----------|
| Inbound `X-Correlation-Id` injection / length | PASS | `src/lib/correlation-id.ts` `getCorrelationId`: trim, then `^[A-Za-z0-9._:-]{1,128}$`, else a fresh `crypto.randomUUID()`. CR/LF/NUL/whitespace and >128 chars cannot reach a log line or the Sentry tag. Every new use in `validate-and-encrypt/route.ts` (STALE_CLIENT arm, `legacyValidateAndEncryptHandler` const at the top of the handler) goes through it; no raw `headers().get` |
| Correlation id as Sentry tag | PASS | `tags: { ..., correlation_id: correlationId }` on the persist-arm and persist-INSERT and validation-failed `captureToSentry` calls; value is the sanitised id; each call keeps `secrets: perRequestSecrets` |
| New `console.warn` on the 4xx arm | PASS | `console.warn("[keys/validate-and-encrypt] upstream 4xx forwarded:", { correlationId, status, code })`. `err.message`, request body, `api_key`/`api_secret`/`passphrase` and the upstream body are not in the payload; `code` is `err.seamCode ?? mappedCode ?? classifiedCode ?? "UNKNOWN"` (seam code or fixed-map string). Placed with an explicit no-Sentry stance |
| Credential scrubbing on every new log line | PASS | Every new line is either an id-only/status-only object (STALE_CLIENT `{userId, correlationId}`, circuit-open, timeout, 4xx warn) or prepends `{ correlationId }` to an existing `scrubSeamError(err, perRequestSecrets)` call (persist unavailable, collision with `venueAccountId` added to the secret list, INSERT fault, validation failed). Client-side new logs carry HTTP status and statusText only. No new log line passes a raw error or message |
| create-with-key early orphan refusal | PASS | See T-212-04/05. User-scoped resolver, parameterless static body, falls through on `UNRESOLVED`; MT5-only (identity known pre-validation); `reuse_api_key_id` arm and ccxt/23505 race arm unchanged |
| No raw database detail in a new response body | PASS | New bodies are `keyOrphanedResponse()` (static), the `code`-only forward (fixed vocabulary), and static rewritten route strings. The `error: err.message` on the unmapped 4xx forward is pre-existing, not new, and only reaches the UI as a `cause` when the code is unrecognised and status < 500 |

## Accepted risks log

- T-212-SC (all plans): no dependency change in this phase; installs come from committed lockfiles.
- T-212-08: Next-side paging for a stale service key is not separately accepted any more; WR-04 restored it. Duplicate event on the service-key hop is accepted noise.
- Known, recorded limit (not a threat row): an orphaned-key user who also has a wrong password hears the orphan first (truthfulness cost stated in the `create-with-key` comment block, 212-03).

## Unregistered flags

None. All nine SUMMARY `## Threat Flags` sections map to registered IDs or report "None". The `status` own property now carried on the rotate-secret hop error is in-process only (SUMMARY 04) and is not serialised; confirmed by the diff (the thrown error is classified, never echoed).

**threats_open:** 0
