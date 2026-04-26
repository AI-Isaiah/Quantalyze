---
phase: 11-onboarding-and-security-readiness
plan: 02
subsystem: api
tags: [audit-log, csv, rfc-4180, rls, supabase, nextjs-route-handler, gdpr-art-15]

# Dependency graph
requires:
  - phase: 06-strategy-creation-wizard
    provides: audit_log table + log_audit_event function (used by all routes that emit audit events; this plan READS the table back)
  - phase: 02-mandate-builder
    provides: audit_log_owner_read RLS policy (migration 010 line 179) — the per-user gating mechanism this plan relies on
provides:
  - "GET /api/me/audit-log/export — authenticated route returning the caller's last 90 days of audit_log rows as a CSV (capped at 10,000 rows per BLOCK-1)."
  - "src/lib/audit-log-csv.ts — RFC 4180 CSV serializer with caption + header. Greenfield (csv.ts only had parse-side helpers)."
  - "AUDIT_LOG_CSV_CAPTION constant — recipient-readable provenance line documenting the 10K row cap."
affects: [11-06-allocator-profile-security-tab, 11-04-widget-state-primitive (no — independent), future-bridge-csv-exports]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies
  patterns:
    - "RFC 4180 export-side serializer (mirror of csv.ts parse-side)"
    - "User-scoped Supabase client + RLS gating (no service-role admin client) for per-user reads"
    - "Bounded-rows in-memory CSV build (BLOCK-1) — alternative to streaming for low-write tables"
    - "Defensive @audit-skip pragma on read-only routes that touch audit-related tables"

key-files:
  created:
    - "src/lib/audit-log-csv.ts (118 LOC) — serializer module"
    - "src/lib/audit-log-csv.test.ts (153 LOC) — 13 unit tests"
    - "src/app/api/me/audit-log/export/route.ts (93 LOC) — GET handler"
    - "src/app/api/me/audit-log/export/route.test.ts (412 LOC) — 9 unit + 2 live-DB tests"
  modified: []

key-decisions:
  - "BLOCK-1 enforcement: hard .limit(10000) on the SELECT — caps in-memory CSV string build at ~2 MB (10K rows × ~200 bytes + caption + header). Alternative streaming via ReadableStream is a deliberate Phase 11+1+ deferral."
  - "Caption line documenting the 10K cap to recipients — appears as the first line of every export so an LP receiving the file knows what the cap is."
  - "Greenfield serializer in src/lib/audit-log-csv.ts (NOT colocated in csv.ts) — csv.ts only exports parse-side helpers and the audit-log shape (caption + JSON-stringified metadata column) is specific enough to warrant a dedicated module."
  - "User-scoped Supabase client (cookies-bridged) — RLS does the gating via audit_log_owner_read policy at the DB layer. Service-role admin client is intentionally NOT used."
  - "POSIX \\n line endings (not CRLF) — matches the existing csv.ts parse-side behavior and what spreadsheet apps accept."
  - "JSON.stringify is the contract for metadata_summary — null metadata renders as an empty cell (not the literal 'null' string) to avoid ambiguity with a legitimate stringified null."
  - "CSV-injection lead chars (=, +, -, @) are NOT stripped on export — that's the parse-side guard's job (sanitizeCsvValue in csv.ts). Stripping on export would silently mutate legitimate audit values."
  - "Defensive @audit-skip pragma included even though the route uses only .select (audit-coverage's regex would not match) — documents intent for future maintainers in case the regex is ever widened to scan reads."

patterns-established:
  - "Pattern: bounded-rows CSV export — limit + serialize + return, no streaming. Best for low-write per-user tables (audit_log size grows ~10s of rows/day at most)."
  - "Pattern: GET-only download route — no CSRF (not a state-mutating verb), no rate limiter (memory bounded by row cap), Cache-Control: no-store + dynamic = force-dynamic to defeat any CDN/ISR caching."
  - "Pattern: user-scoped Supabase client for per-user reads where RLS already enforces isolation — the user-scoped path is the authoritative path; admin clients are reserved for cross-user/system-level operations."

requirements-completed: [ONBOARD-03]

# Metrics
duration: 16min
completed: 2026-04-26
---

# Phase 11 Plan 02: Audit-log CSV download infrastructure Summary

**Authenticated GET /api/me/audit-log/export returns the caller's last 90 days of audit_log rows as a downloadable CSV, capped at 10,000 rows per BLOCK-1 with a recipient-readable caption documenting the cap.**

## Performance

- **Duration:** ~16 min
- **Started:** 2026-04-26T19:13:41Z
- **Completed:** 2026-04-26T19:30:00Z (approximate)
- **Tasks:** 2 (each TDD: RED + GREEN = 4 commits)
- **Files created:** 4 (2 source + 2 test)
- **Files modified:** 0

## Accomplishments

- **Greenfield CSV serializer (`src/lib/audit-log-csv.ts`).** Three exports — `AUDIT_LOG_CSV_CAPTION`, `escapeCsvValue`, `serializeAuditLogCsv` — plus an `AuditLogRow` type. RFC 4180 compliant; hand-rolled (no new npm dependency); mirrors `csv.ts`'s parse-side regex `/[,"\n\r]/` for the symmetric serialize-side guard.
- **Authenticated route handler (`GET /api/me/audit-log/export`).** Returns 401 unauth / 200 + text/csv authed / 500 on DB error. RLS-scoped via `audit_log_owner_read`; no admin client; hard 10K row cap; 90-day window; `Cache-Control: no-store` + `dynamic = "force-dynamic"`.
- **BLOCK-1 mitigation enforced and tested at three layers.** (1) Source code: single `.limit(10000)` call on the SELECT chain (grep gate verified, count=1). (2) Unit test: limit-arg spy on the mock builder asserts `limit === 10000`. (3) Live-DB test (gated on HAS_LIVE_DB): seeds 10,005 rows for a test user, signs in, asserts the SELECT returns ≤ 10,000 rows and the serialized CSV has ≤ 10,002 newlines (caption + header + 10,000 data lines).
- **Caption line as recipient-readable provenance.** Every export starts with `# Quantalyze audit log export — most recent 10,000 entries within 90-day window` so an LP opening the file in a spreadsheet sees the cap documented at the top.
- **audit-coverage compatibility.** The route uses only `.select` (no mutations), so the audit-coverage regex `/^\s*\.(insert|update|delete|upsert)\s*\(/` does not match it. A defensive `@audit-skip:` pragma above the `.from('audit_log')` call documents intent for future maintainers in case the regex is ever widened to scan reads.

## Task Commits

Each task was executed via TDD with separate RED and GREEN commits, all using `--no-verify` per the parallel-execution worktree convention:

1. **Task 1 RED** — `6c23a58` `test(11-02): RED — audit-log CSV serializer tests (RFC 4180 + caption + cap docs)` (13 failing tests; module did not exist)
2. **Task 1 GREEN** — `b9b2140` `feat(11-02): GREEN — implement audit-log CSV serializer` (13 tests pass; module shipped)
3. **Task 2 RED** — `1698c93` `test(11-02): RED — GET /api/me/audit-log/export route handler tests` (10 failing tests; module did not exist; mock builder + live-DB harness in place)
4. **Task 2 GREEN** — `06cf7a9` `feat(11-02): GREEN — implement GET /api/me/audit-log/export route handler` (9 unit tests pass + 2 live-DB tests skip cleanly without HAS_LIVE_DB)

_Note: a `docs(11-02): complete plan summary` commit will be created by the post-task metadata commit step._

## Files Created/Modified

- **Created:** `src/lib/audit-log-csv.ts` (118 LOC) — RFC 4180 serializer with caption + header; `AUDIT_LOG_CSV_CAPTION` / `escapeCsvValue` / `serializeAuditLogCsv` exports + `AuditLogRow` type.
- **Created:** `src/lib/audit-log-csv.test.ts` (153 LOC) — 13 unit tests across 3 describe blocks (caption constant, escape edge cases, serializer integration).
- **Created:** `src/app/api/me/audit-log/export/route.ts` (93 LOC) — GET handler with `dynamic = "force-dynamic"`, `@audit-skip:` pragma, `.limit(10000)` cap, attachment Content-Disposition.
- **Created:** `src/app/api/me/audit-log/export/route.test.ts` (412 LOC) — 9 unit tests (auth, headers, error envelope, .gte/.limit spies, audit-coverage compatibility) + 2 live-DB integration tests (RLS isolation, BLOCK-1 row-cap regression).

## Decisions Made

See frontmatter `key-decisions` for the full list. Highlights:

1. **BLOCK-1 enforcement at three layers** (source + unit-spy + live-DB regression) so the cap can never silently regress.
2. **Greenfield serializer module** (not colocated in `csv.ts`) — keeps the audit-log-specific shape (caption + JSON-stringified metadata) isolated from the parse-side primitives.
3. **User-scoped Supabase client + RLS** — no service-role admin client. The `audit_log_owner_read` policy at migration 010 line 179 (`USING (user_id = auth.uid())`) does per-user gating at the DB layer.
4. **Defensive `@audit-skip` pragma** even though the route is read-only — documents intent in case the audit-coverage regex is ever widened to scan reads.

## Final Exports

### `src/lib/audit-log-csv.ts`

```typescript
/** Caption line prepended to every export — documents the BLOCK-1 cap. */
export const AUDIT_LOG_CSV_CAPTION =
  "# Quantalyze audit log export — most recent 10,000 entries within 90-day window";

/** Shape of an audit_log row read by GET /api/me/audit-log/export. */
export interface AuditLogRow {
  created_at: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
}

/** RFC 4180: quote if value contains , " \r \n; double up internal quotes. */
export function escapeCsvValue(value: string): string;

/** Serialize audit_log rows to RFC 4180 CSV with caption + header. */
export function serializeAuditLogCsv(rows: AuditLogRow[]): string;
```

### `src/app/api/me/audit-log/export/route.ts`

```typescript
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<NextResponse>;
```

**Auth/error envelopes:**

| Status | Condition                                       | Body                                  |
|--------|-------------------------------------------------|---------------------------------------|
| 401    | `auth.getUser()` returns no user                | `{ "error": "Unauthorized" }`         |
| 500    | `supabase.from('audit_log').select(...)` errors | `{ "error": "Failed to read audit log" }` |
| 200    | Authenticated, query OK                         | CSV body (text/csv; charset=utf-8)    |

**Response headers (200 path):**

```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="quantalyze-audit-log-YYYY-MM-DD.csv"
Cache-Control: no-store
```

### audit-coverage pragma format used

The route is read-only (`.select` only) so the audit-coverage regex `/^\s*\.(insert|update|delete|upsert)\s*\(/` does not match. The pragma is included for defensive documentation:

```typescript
/**
 * @audit-skip: read-only export of caller's own audit_log rows. The
 *   download itself does not mutate state; emitting an audit event for
 *   a read of audit_log would create an audit-log-of-audit-logs feedback
 *   loop. Out of scope per D-05 ("download a CSV of the last 90 days").
 *   audit-coverage.test.ts scans for .insert/.update/.delete/.upsert; the
 *   chain below uses only .select, so this pragma is defense-in-depth in
 *   case the regex is widened.
 */
```

## BLOCK-1 outcome

| Aspect              | Value / Implementation                                                                            |
|---------------------|---------------------------------------------------------------------------------------------------|
| Row cap             | 10,000                                                                                            |
| Caption text        | `# Quantalyze audit log export — most recent 10,000 entries within 90-day window`                 |
| Source code         | Single `.limit(10000)` call on the SELECT chain (grep gate verified: `grep -c "limit(10000)" route.ts` returns `1`) |
| Unit test coverage  | Test 9 (limit-arg spy, `expect(STATE.limitArg).toBe(10000)` and `expect(STATE.limitCallCount).toBe(1)`) |
| Live-DB regression  | Test 10 — seeds 10,005 audit_log rows for a test user, signs in, asserts SELECT returns ≤ 10,000 rows and serialized CSV has ≤ 10,002 newlines (caption + header + ≤ 10,000 data lines, each terminated by `\n`) |
| Test count exercising the cap | 2 (1 unit, 1 live-DB)                                                                |

## Live-DB integration test status

`HAS_LIVE_DB` was **not set** during this execution → the 2 live-DB integration tests (RLS isolation + 10K row cap regression) were **skipped cleanly** via `describe.skipIf(!HAS_LIVE_DB)`. Test runner output confirms:

```
Test Files  3 passed (3)
Tests  23 passed | 2 skipped (25)
```

The 2 skipped tests (Test 5 and Test 10) are written against the existing `src/lib/test-helpers/live-db.ts` harness (`createLiveAdminClient`, `createTestUser`, `cleanupLiveDbRow`, `advertiseLiveDbSkipReason`). To run them locally, export `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` and re-run `npx vitest run src/app/api/me/audit-log/export/route.test.ts`.

## Confirmation that Plan 06 (S6 AuditLogSubsection) can call this route

Plan 06 (per CONTEXT D-05) will land an `AuditLogSubsection.tsx` component on `/profile?tab=security` that calls this endpoint via:

```tsx
const handleDownload = () => {
  // GET request — no body, no CSRF token, no auth header (cookies are
  // already attached by same-origin browser navigation rules).
  window.location.assign("/api/me/audit-log/export");
};
```

This works because:

1. **Same-origin GET** — the browser attaches the existing Supabase auth cookie automatically (no CSRF token needed; `assertSameOrigin` is intentionally NOT called for GET requests on this route).
2. **`Content-Disposition: attachment`** — the browser triggers the file save dialog instead of rendering the CSV in a tab. Filename is set server-side (`quantalyze-audit-log-YYYY-MM-DD.csv`).
3. **`Cache-Control: no-store`** — even if the user clicks the download button twice in a row, each request is served fresh (different timestamps in audit_log, different filename if it crosses midnight UTC).
4. **401 envelope** — if the user's session has expired, the browser displays `{ "error": "Unauthorized" }` as plain JSON instead of a corrupted CSV. Plan 06's button can wrap the call in a `fetch()` first to detect the 401 and route to login before falling back to `window.location.assign(...)` for the actual download.

## Deviations from Plan

**None — plan executed exactly as written.** All 11 behaviors specified in Task 1's `<behavior>` block were covered (across 13 tests for slightly more granular coverage), all 10 behaviors specified in Task 2's `<behavior>` block were covered (with 9 unit + 2 live-DB tests, matching the plan's split). All grep acceptance gates pass:

| Gate | Expected | Actual |
|------|----------|--------|
| `grep -q "export const dynamic = \"force-dynamic\"" route.ts` | match | matches |
| `grep -q "@audit-skip:" route.ts` | match | matches |
| `grep -q "Content-Disposition.*attachment" route.ts` | match | matches |
| `grep -q "text/csv; charset=utf-8" route.ts` | match | matches |
| `grep -q "Cache-Control.*no-store" route.ts` | match | matches |
| `grep -q "audit_log_owner_read\|RLS\|user_id = auth.uid" route.ts` | match | matches |
| `grep -c "limit(10000)" route.ts` | `1` | `1` |
| `grep -c "logAuditEvent" route.ts` | `0` | `0` |
| `grep -c "createAdminClient" route.ts` | `0` | `0` |
| `grep -q "export function serializeAuditLogCsv" audit-log-csv.ts` | match | matches |
| `grep -q "export function escapeCsvValue" audit-log-csv.ts` | match | matches |
| `grep -q "export const AUDIT_LOG_CSV_CAPTION" audit-log-csv.ts` | match | matches |
| `grep -q "export interface AuditLogRow" audit-log-csv.ts` | match | matches |
| `grep -q "occurred_at,action,entity_type,entity_id,metadata_summary" audit-log-csv.ts` | match | matches |

A minor in-process iteration (NOT a deviation) occurred during Task 1 GREEN: the initial assertion in test "escapes action / entity_type / metadata cells per RFC 4180" used a JS string with a real `\n` byte while the actual JSON.stringify output contains the literal two-char escape sequence `\n`. The test assertion was rewritten using `String.raw` to match the literal escape sequence — this is a test-side fix internal to the same RED→GREEN cycle and was committed as part of the GREEN commit `b9b2140`.

## Issues Encountered

- **Pre-existing typecheck errors from sibling Plan 01 + Plan 04 commits in the same worktree.** When `npm run typecheck` was run, errors surfaced for `WidgetState.test.tsx`, `WidgetState.tsx`, `widget-state-flag.ts`, `queries.ts`, `queries.mandateIsSet.test.ts`, and several `AllocationsTabs*.test.tsx` files — all owned by Plan 01 (`apiKeysCount` / `mandateIsSet` payload extension) and Plan 04 (WidgetState primitive). Per the executor's scope-boundary rule ("Only auto-fix issues DIRECTLY caused by the current task's changes"), these are out of scope for Plan 02 and tracked under their owning plans. **Task 1 + Task 2 files compile cleanly with zero new typecheck errors and zero lint warnings** (verified via `npm run typecheck 2>&1 | grep -E "audit-log|api/me"` returning empty and `npx eslint src/lib/audit-log-csv* src/app/api/me/audit-log/export/*` returning zero diagnostics).

## Self-Check: PASSED

Verified all created files exist and all commits are present:

```
FOUND: src/lib/audit-log-csv.ts
FOUND: src/lib/audit-log-csv.test.ts
FOUND: src/app/api/me/audit-log/export/route.ts
FOUND: src/app/api/me/audit-log/export/route.test.ts
FOUND: 6c23a58 (Task 1 RED)
FOUND: b9b2140 (Task 1 GREEN)
FOUND: 1698c93 (Task 2 RED)
FOUND: 06cf7a9 (Task 2 GREEN)
```

## TDD Gate Compliance

Plan 02 frontmatter specifies `type: execute` with each task having `tdd="true"`. The required RED → GREEN sequence is verified in git log:

| Task | RED commit (`test(...)`) | GREEN commit (`feat(...)`) |
|------|--------------------------|----------------------------|
| Task 1 (CSV serializer) | `6c23a58` | `b9b2140` |
| Task 2 (Route handler)  | `1698c93` | `06cf7a9` |

No REFACTOR pass was needed (the GREEN implementation was already minimal and well-factored).

## Threat Surface Scan

No new security-relevant surface was introduced beyond what is already documented in the plan's `<threat_model>`. The single new endpoint `GET /api/me/audit-log/export` is fully covered by threats T-11-08 through T-11-14, all dispositioned `mitigate` (or `accept` for T-11-14 GET CSRF). No new flags to file.

## Next Phase Readiness

Plan 06 (Allocator profile security tab + S6 AuditLogSubsection) is unblocked: the `GET /api/me/audit-log/export` endpoint is live and contract-stable, the response shape is documented in this summary, and the auth + 401 path is already exercised by unit tests. Plan 06's S6 component can call the endpoint via either `window.location.assign(...)` (simplest) or a `fetch().then(blob)` flow if it wants to detect 401 before triggering the download. No further changes to this plan's surface are required.

Plan 04 (WidgetState primitive) and Plan 01 (allocator dashboard onboarding payload) — which surface as pre-existing typecheck errors above — are independent of this plan and will resolve when their own Tasks reach GREEN.

---
*Phase: 11-onboarding-and-security-readiness*
*Completed: 2026-04-26*
