---
phase: "209"
slug: "scrubleaks-error-reports-carry-no-raw-database-details-and-n"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-14"
---

# Phase 209 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| process -> Sentry (third party) | `captureToSentry`, `beforeSend` and `beforeSendTransaction` are the last hop before an event leaves the process | Error messages, PostgREST error fields, request URLs (share capability tokens) |
| PostgREST -> route | A non-throwing PostgREST error is a plain object whose `details`/`hint` can embed failing-row values | Requester-supplied row values |
| request URL -> event fields | The share capability token is a path segment and rides URL-shaped event fields | Capability token (secret) |
| internet -> `/api/og/factsheet/[id]` | Public route; the `id` segment is untrusted | Untrusted path segment |
| authenticated client -> `/api/keys/validate-and-encrypt` | Untrusted body that carries raw exchange credentials | Exchange API credentials |
| allocator -> `/api/allocator/scenario/share` | An authenticated caller mints a capability URL | Audit trail obligation |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-209-01 | Information Disclosure | `scrubCaptureInput` non-Error branch | medium | mitigate | `scrubSeamErrorForCapture` with `CAPTURE_OBJECT_DIAGNOSTIC_KEYS` (`src/lib/sentry-capture.ts:121`, `src/lib/seam-redaction.ts:198`) | closed |
| T-209-02 | Information Disclosure | cause fold and recursive cause render | medium | mitigate | Capture flag threaded through the recursion; cause fold uses the capture variant (`src/lib/sentry-capture.ts:112`) | closed |
| T-209-03 | Information Disclosure | no-named-field fallback on the capture path | medium | mitigate | `CAPTURE_OPAQUE_OBJECT` returned before both fallbacks (`src/lib/seam-redaction.ts:438`) | closed |
| T-209-04 | Information Disclosure | `scrubSentryEvent` on frozen/sealed/getter-only values | medium | mitigate | Write-on-change, read-back verify, withhold at nearest writable parent (`scrubSlot`, `withholdSlot` in `src/instrumentation.ts`) | closed |
| T-209-05 | Denial of Service (observability) | `beforeSend` throwing (SDK drops the event) | medium | mitigate | `guardedRead` on every read, guarded writes, `Array.isArray` before iteration (`src/instrumentation.ts:55`, `:120`, `:291`) | closed |
| T-209-06 | Denial of Service (observability) | unwritable event root | low | mitigate | `buildWithheldEvent` returns a minimal replacement event, never `null` (`src/instrumentation.ts:322`) | closed |
| T-209-07 | Tampering (telemetry routing) | replacement returned from `beforeSendTransaction` | low | mitigate | `type` copied onto the replacement event (`buildWithheldEvent`) | closed |
| T-209-08 | Denial of Service (alerting) | `og-factsheet:read` throttle slot | medium | mitigate | `isUuid(id)` guard before the read (`src/app/api/og/factsheet/[id]/route.tsx:121`) | closed |
| T-209-09 | Denial of Service (cache/DB load) | malformed-id path | low | mitigate | No DB read on a malformed id; not-found path keeps `LONG_CACHE_CONTROL` | closed |
| T-209-10 | Information Disclosure | body parse error in `POST` | medium | mitigate | `SyntaxError` swallowed with no log or capture; other errors rethrown (`src/app/api/keys/validate-and-encrypt/route.ts:155`) | closed |
| T-209-11 | Denial of Service (error contract) | uncoded 500 on a malformed or `null` body | low | mitigate | Coded 400 `KEY_MISSING_REQUIRED_FIELD` with `NO_STORE_HEADERS` (`route.ts:160`) | closed |
| T-209-12 | Repudiation | scenario share mint without an enforced audit trail | medium | mitigate | `create_scenario_share` in `MUTATING_RPC_NAMES` (`src/__tests__/audit-coverage.test.ts:441`); literal `supabase.rpc(...)` call (`share/route.ts:232`) with `logAuditEvent` (`:255`) | closed |
| T-209-13 | Repudiation | listing becoming decorative again | medium | mitigate | Positive-control pin (`src/__tests__/audit-coverage.test.ts:1058`) | closed |
| T-209-SC | Tampering | npm/pip/cargo installs | low | accept | No package installed by any plan | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

Each mitigate row also carries a neuter-to-RED proof recorded in its plan's SUMMARY (N-labels per plan).

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-209-01 | T-209-SC | No plan installs a package (RESEARCH "Package Legitimacy Audit": none) | plan-time threat model | 2026-11-14 |

*Accepted risks do not resurface in future audit runs.*

Out of scope, recorded in CONTEXT `<deferred>`: direct `Sentry.captureException` call sites (for example alert-digest) are not routed through `scrubCaptureInput`, so a plain PostgREST object captured there can still carry `details`/`hint` under `extra.__serialized__`.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-14 | 14 | 14 | 0 | secure-phase L1 short-circuit (grep evidence, orchestrator) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-14
