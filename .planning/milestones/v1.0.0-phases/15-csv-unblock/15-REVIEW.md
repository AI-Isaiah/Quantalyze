---
phase: 15
status: findings_found
gathered: 2026-04-30
files_reviewed: 23
findings_count: { blocker: 0, error: 0, warning: 5, info: 7 }
depth: standard
files_reviewed_list:
  - src/components/strategy/TrustTierLabel.tsx
  - src/components/strategy/TrustTierLabel.test.tsx
  - src/components/strategy/StrategyHeader.tsx
  - src/components/strategy/StrategyGrid.tsx
  - src/lib/types.ts
  - src/lib/queries.ts
  - src/lib/analytics-client.ts
  - src/lib/analytics-schemas.ts
  - src/lib/wizard/localStorage.ts
  - src/app/api/strategies/csv-validate/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/(dashboard)/admin/csv-status/page.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvPreviewStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.tsx
  - src/__tests__/csv-finalize-rpc.test.ts
  - src/__tests__/csv-validate-route.test.ts
  - src/__tests__/strategy-verifications-rls.test.ts
  - e2e/csv-upload-flow.spec.ts
  - analytics-service/services/csv_validator.py
  - analytics-service/routers/csv.py
  - analytics-service/main.py
  - analytics-service/requirements.txt
  - analytics-service/tests/test_csv_validator.py
  - supabase/migrations/093_strategy_verifications.sql
---

# Phase 15: Code Review Report

**Reviewed:** 2026-05-01T05:30:00Z
**Depth:** standard
**Files Reviewed:** 23 source files (TS/TSX + Python + SQL; tests scanned for reliability only)
**Status:** findings_found

## Summary

Phase 15 ships a complete, well-tested CSV unblock implementation. The migration is defense-in-depth (TEXT CHECKs, 3-tier RLS, SECURITY DEFINER RPC with manual `auth.uid()` guard, 6 self-verifying assertions). The route layer validates input before calling the RPC. The Pandera validator collects errors lazily and routes only structured data to logs (no raw cell values). The wizard state machine threads `strategyName + source:"csv"` through all 4 `saveWizardState` calls per design.

**No blockers, no errors.** Five warnings (one DoS surface in the Python multipart route, one rate-limit budget collision, two routing/contract robustness gaps, one possible RLS subquery edge case) and seven info items (mostly forward-compat documentation suggestions). None block the goal of unblocking the 10 onboarding teams; they should be addressed in Phase 16 / Phase 17 follow-ups.

The cross-AI revisions called out in the prompt (`p_strategy_name` rename, `ANALYTICS_SERVICE_URL` throw-on-missing in CSV path, 6 RULE_LABELS, `_redact_preview` helper, WizardLocalState extension) are all present and correctly implemented — no re-flag.

## Warnings

### WR-01: Python multipart route reads entire upload before size check (DoS surface)

**File:** `analytics-service/routers/csv.py:40-48`
**Issue:** `csv_validate` does `raw = await file.read()` at line 40, then checks `if len(raw) > MAX_BYTES` at line 41. A direct caller (one with the analytics-service `SERVICE_KEY`) bypassing Next.js could push hundreds of MB or GBs into memory before the size guard fires. The Next.js layer is the front-line cap, but this defeats the "defense in depth" framing in `csv-validate/route.ts:13`.
The Next.js `validateCsv` proxy uses `body: formData` which streams, but `await file.read()` on the FastAPI side fully realizes the bytes regardless.
**Fix:** Stream-read with a running byte counter and abort early once the cap is exceeded. Example:

```python
async def _read_capped(file: UploadFile, cap: int) -> bytes:
    buf = bytearray()
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > cap:
            raise HTTPException(status_code=400, detail={
                "ok": False,
                "code": "CSV_FILE_TOO_LARGE",
                "human_message": "Maximum file size is 10 MB.",
                "debug_context": {"size_bytes": len(buf)},
                "correlation_id": None,
            })
    return bytes(buf)

raw = await _read_capped(file, MAX_BYTES)
```

This makes the Python service safe to expose with a leaked `SERVICE_KEY` for the cap window. Phase 16 / OBSERV-04 should also wire request-size telemetry here.

### WR-02: csv-validate route shares `userActionLimiter` budget with sensitive POSTs (5/min total)

**File:** `src/app/api/strategies/csv-validate/route.ts:27-30`
**Issue:** The route uses `userActionLimiter` (5 requests / 60 s per user, see `ratelimit.ts:49`). That same bucket is used by attestation, deletion, and other sensitive mutations across the app. A user iterating on a CSV (validate then fix then re-validate) realistically spends 3–5 attempts in a minute; doing so consumes the full bucket and 429s their *next* attestation/deletion action with no visible link between the two surfaces.
The Python service has its own `30/hour` limiter (`analytics-service/routers/csv.py:28`), so a dedicated Next.js limiter (e.g. `csvValidateLimiter` at 20/min) would be more aligned with both end-user iteration and the upstream Python budget. The current implementation is functional but creates a confusing UX cliff.
**Fix:** Add a dedicated limiter to `src/lib/ratelimit.ts`:

```ts
// Phase 15 / CSV-01..CSV-02. CSV iteration realistically spends 3-5
// validations per minute as the user fixes monotonic_dates / nav_non_zero
// errors; userActionLimiter (5/min) collides with attestation+deletion.
export const csvValidateLimiter = makeLimiter(20, "60 s");
```

Use it in both `csv-validate/route.ts` and `csv-finalize/route.ts`. Defer if Phase 17 ships a single wizardLimiter; either way, document the choice.

### WR-03: csv-validate route does not validate `wizard_session_id` UUID shape before forwarding to Python

**File:** `src/app/api/strategies/csv-validate/route.ts:44-102`
**Issue:** The route extracts `file` and `fmt` from the multipart body and validates them, but `wizard_session_id` is never read or validated at the Next.js layer — it's only consumed by `validateCsv(formData)` which passes the entire `FormData` to the analytics service. The Python router declares `wizard_session_id: str = Form(...)` (`routers/csv.py:33`), so a missing/malformed value will surface as a FastAPI 422 wrapped as a `CSV_UPSTREAM_FAIL` 502 — the user sees an opaque "Analytics service error" instead of a clean 400.
Defense in depth (which `csv-finalize/route.ts:67-77` already implements) means rejecting the bad UUID at the edge before paying the round-trip cost.
**Fix:** Add a validation gate alongside the file/fmt checks:

```ts
const sessionId = formData.get("wizard_session_id");
if (typeof sessionId !== "string" || !isUuid(sessionId)) {
  return NextResponse.json(
    {
      ok: false,
      code: "CSV_INVALID_FORMAT",
      human_message: "wizard_session_id must be a valid UUID.",
      debug_context: {},
      correlation_id: null,
    },
    { status: 400 },
  );
}
```

Import `isUuid` from `@/lib/utils` (already used in csv-finalize).

### WR-04: queries.ts left-join on `strategy_verifications` is unbounded; sort is per-row in JS

**File:** `src/lib/queries.ts:180, 195-197, 305, 319-321`
**Issue:** Both `getStrategiesByCategory` (line 180) and `getStrategyDetail` (line 305) embed `strategy_verifications (trust_tier, status, created_at)` without a row-limit clause. In Phase 15 the schema admits at most one row per strategy (the RPC inserts exactly one), so the JS-side sort + `[0]` pick is correct. The reasoning is captured in the inline comment at line 311–315 ("In Phase 15 there's at most ONE row per strategy_id") — but Phase 19 explicitly reserves the freedom to add multiple rows (`flow_type` admits `'resync'` and `'onboard'`, see migration 093:88).
Once Phase 19 lands a second insert, every published-strategies marketplace query will pull the entire history per strategy, sort it client-side, then discard all but one. There's no explicit guard preventing that latent footgun.
**Fix:** Add a comment-only DB-side ordering hint, or scope the embedded select to the row of interest. The clean form is a database-side `.order("created_at", { ascending: false }).limit(1)` on the embedded resource using PostgREST's nested-resource modifiers:

```ts
.select(
  `*, strategy_analytics (*),
   strategy_verifications!inner (trust_tier, status, created_at)
   .order(created_at.desc).limit(1)`
)
```

Or, minimally, hoist a Postgres VIEW that exposes only the latest row per strategy. Either is a Phase 17/Phase 19 task — for Phase 15 it's enough to add a comment noting the assumption. Today's behavior is correct but fragile.

### WR-05: RLS subquery `strategy_id IN (SELECT ...)` does not key off the embedding context

**File:** `supabase/migrations/093_strategy_verifications.sql:118-124`
**Issue:** The owner-select policy reads:

```sql
CREATE POLICY strategy_verifications_owner_select ON strategy_verifications FOR SELECT
  USING (
    strategy_id IN (
      SELECT id FROM strategies WHERE user_id = auth.uid()
    )
  );
```

When the strategies row's RLS policy itself has predicates (e.g. `status='published'` for public reads), this subquery does NOT inherit those — the inner `SELECT id FROM strategies` re-evaluates RLS in the subquery context. For Phase 15 this is fine: a strategy owner can always see their own strategies regardless of `status`, so the subquery returns the right ids. But the policy is brittle: a future stricter strategies-RLS that restricts `SELECT` on the owner's own draft rows would silently break trust-tier reads.
The more idiomatic Postgres-RLS form is:

```sql
USING (
  EXISTS (
    SELECT 1 FROM strategies s
    WHERE s.id = strategy_verifications.strategy_id
      AND s.user_id = auth.uid()
  )
)
```

Functionally equivalent today but more explicit about the join column and signals intent.
**Fix:** Either add a comment to the existing policy explaining the dependency on the strategies-RLS owner-select policy admitting the subquery, OR (preferred) replace the subquery with the EXISTS form in a follow-up migration. The strategy-verifications-rls.test.ts already pins the contract end-to-end, so a refactor is safe.

## Info

### IN-01: `analytics-client.ts:17` retains localhost fallback for non-CSV path

**File:** `src/lib/analytics-client.ts:17`
**Issue:** The legacy `ANALYTICS_URL = process.env.ANALYTICS_SERVICE_URL ?? "http://localhost:8002"` constant on line 17 powers `analyticsRequest` (every non-CSV endpoint). The CSV path correctly throws on missing env (line 280-282). This split is intentional per the cross-AI revision but creates a foot-gun: a future endpoint that copy-pastes the `analyticsRequest` shape will silently inherit the localhost fallback. The verification report already notes this is by design (Phase 15 only tightens the CSV path), so no change is required, but a guard could prevent regression.
**Fix:** Add a one-line `console.warn` when `ANALYTICS_SERVICE_URL` is missing at module load (NOT throw, to preserve the API-key path's local-dev ergonomics). Or document with `// LEGACY: do not copy — see validateCsv() at L278 for the throw-on-missing pattern`.

### IN-02: `_redact_preview` masks any column whose NAME matches PII regex, even numeric/date columns

**File:** `analytics-service/services/csv_validator.py:182-205`
**Issue:** A column literally named `wallet_id_count` (a number) would be masked to `'***'`. The docstring at line 191–194 acknowledges this and accepts the false-positive rate for v0. Worth pinning a test for the trade-off: e.g., a CSV with a column `customer_count: int` would fail to display useful preview metadata.
**Fix:** No change for Phase 15 (per the deferred Phase 18 / FIX-04 plan). When Phase 18 / FIX-04 ships full `redact.py`, narrow the column-match to value-shape detectors AND column names. Add a test asserting today's behavior so a future tightening doesn't accidentally regress.

### IN-03: Pandera `is_monotonic_increasing` allows duplicate dates (non-strictly-increasing)

**File:** `analytics-service/services/csv_validator.py:65-68, 95-98, 122-125`
**Issue:** The check `lambda s: s.is_monotonic_increasing` returns True for `[2024-01-02, 2024-01-02, 2024-01-03]` because pandas `is_monotonic_increasing` is non-strict (allows equal). The error key `monotonic_dates` and the human label "Dates must be strictly increasing" (`CsvValidationEnvelope.tsx:31`) imply STRICT monotonicity, but the validator does not enforce that.
The mismatch is purely cosmetic for happy-path use, but a customer with duplicate-date rows would pass validation while the human-message implies they should be rejected.
**Fix:** Use `is_monotonic_increasing and not s.duplicated().any()` or pandas' `s.is_monotonic_increasing & s.is_unique`. Add a regression test in `test_csv_validator.py` for duplicate-date rejection:

```python
def test_duplicate_dates_violation():
    df = pd.DataFrame({
        "date": ["2024-01-02", "2024-01-02", "2024-01-03"],
        "daily_return": [0.001, 0.001, 0.001],
    })
    result = validate_csv(_csv_bytes(df), "daily_returns")
    assert result["ok"] is False
    rules = {e["rule"] for e in result["errors"]}
    assert "monotonic_dates" in rules
```

Likely Phase 17 follow-up; not Phase 15 critical.

### IN-04: `csv-finalize/route.ts:123` uses unsafe length on the un-trimmed `strategy_name`

**File:** `src/app/api/strategies/csv-finalize/route.ts:110-134`
**Issue:** Lines 110–122 trim `strategy_name` and check `trimmedName.length === 0`. Line 123 then re-checks `if (strategy_name.length > MAX_NAME_CHARS)` against the UN-TRIMMED string. This means `"   X   "` (5 trailing whitespace + 1 char + 5 leading whitespace = 11 chars) is rejected if total length > 80 even when the trimmed value is well under the cap. The UI input has `maxLength={MAX_NAME_CHARS}` so practically this only fires from a non-browser caller, but defense-in-depth should be consistent: use `trimmedName.length` everywhere.
**Fix:** Change line 123 to `if (trimmedName.length > MAX_NAME_CHARS)`. The error message at line 128 should also reference the trimmed value.

### IN-05: `WizardClient.tsx:88-89` SSR-safety check is correct but subtle; add a comment

**File:** `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx:87-90`
**Issue:** `initialLocalStateRef.current` is set inside the component body (not in useEffect), guarded by `typeof window !== "undefined"`. This works because the ref is initialized to `null` on the SSR pass and lazily populated on the first client render. But the pattern is non-obvious; future readers may "fix" it by moving to `useEffect`, which would make the initial render miss the resume state for one paint.
The block is functional but undocumented.
**Fix:** Add a one-line comment explaining the SSR-safe lazy ref init:

```ts
// Lazy ref-init pattern (NOT useEffect): we need the loaded state
// available in the same render that runs the useState initializers
// below. SSR pass leaves the ref null; first client render populates.
```

### IN-06: `loadWizardState` validates `strategyName.length <= 80` but persists no upper bound on trim

**File:** `src/lib/wizard/localStorage.ts:117-124`
**Issue:** The validator rejects `strategyName.length > 80`, but `WizardClient.setStrategyName` (line 174) accepts the loaded value verbatim and forwards it as `initialStrategyName` (CsvUploadStep line 489). The CsvUploadStep then trims at submit time. If the localStorage value is exactly 80 chars (e.g. "X".repeat(80)), it persists and round-trips fine — but a value that's 80 chars of whitespace would round-trip fine and only fail at finalize time, which is too late.
This is an edge case; the route + RPC both reject empty names, so the worst outcome is the user clicking submit and seeing a clean envelope error. Worth a defense-in-depth tweak.
**Fix:** Trim before validating in `loadWizardState`:

```ts
if (parsed.strategyName !== undefined) {
  if (typeof parsed.strategyName !== "string") return null;
  // length check is on the raw value (matches MAX_NAME_CHARS UI cap);
  // empty/whitespace-only is rejected by the route + RPC at submit
  // time, but localStorage can't catch it until the user re-submits.
  if (parsed.strategyName.length > 80) return null;
}
```

### IN-07: TODO markers acknowledged but not enumerated for Phase 17 hand-off

**File:** Multiple (CsvUploadStep, CsvPreviewStep, CsvSubmitStep, CsvValidationEnvelope)
**Issue:** Many `// TODO(phase-17): hoist into wizardErrors.ts per DESIGN-05` markers exist. The PATTERNS.md / VERIFICATION.md note them as intentional, but there's no central list ensuring Phase 17 picks all of them up.
**Fix:** Phase 17 plan should grep `TODO(phase-17)` across `src/app/(dashboard)/strategies/new/wizard/` to enumerate the work. Not a Phase 15 change.

## Pass-Through Notes (Intentional Patterns Confirmed Clean)

The following were inspected and confirmed correct per the locked design:

- **`TrustTierLabel` returns null for non-csv_uploaded variants** — intentional Phase 17 hand-off (`TrustTierLabel.tsx:37`). DOM shape stable; tests pin the contract.
- **`correlation_id: null` on every envelope path** — intentional Phase 16 hand-off. Verified across `csv_validator.py` (7), `csv-validate/route.ts` (8), `csv-finalize/route.ts` (12), `CsvValidationEnvelope.tsx` (3). DOM placeholder is `—`.
- **Migration 093 RPC is SECURITY DEFINER with manual `auth.uid()` guard** — correctly mirrors `create_wizard_strategy:118-186`. The 42501 (auth) + 22023 (validation) SQLSTATE separation is clean. RPC body has no string concatenation; all user input flows through prepared statement params. No SQL injection surface.
- **DO block self-verification (6 assertions a–f)** — table existence, 12 columns, RLS enabled, 3 named policies, 2 indexes, RPC registered. Wraps in BEGIN/COMMIT so a failed assertion rolls back the entire migration.
- **`strategies.name` rendered via `displayStrategyName(strategy)` then `<h1>...</h1>`** — Next.js / React's default JSX text interpolation HTML-escapes user input. No XSS surface for the user-typed strategy name on the factsheet (`StrategyHeader.tsx:18`). Same for the admin csv-status page (`csv-status/page.tsx:131`) — `{strat?.name ?? "—"}` is text-content interpolation; no raw-HTML injection sink in any reviewed file.
- **Admin csv-status page uses `createAdminClient()` (service-role) for the cross-user reads** — correctly bypasses RLS by design, gated behind `isAdminUser(supabase, user)` redirect on a regular client first. Auth-then-elevate pattern is consistent with `admin/compute-jobs/page.tsx`.
- **`_redact_preview` runs BEFORE serialization** at lines 311–312 of `csv_validator.py`. The redacted dicts go into the response payload; the un-redacted DataFrame is what gets validated. Logger calls in the same module never carry raw cell values (line 240 logs only `[csv-validator] parse failure`; line 276–279 logs only row index + rule key).
- **Wizard state machine: 4 saveWizardState calls + skipApiResumeRedirect guard** — verified all 4 calls (`WizardClient.tsx:496, 517, 529, 550`) carry `source: "csv"` AND `strategyName`. The `skipApiResumeRedirect` guard at line 98–99 correctly handles the empty-string sentinel for CSV drafts. Resume from CSV-branch back into CSV-branch is handled at line 109–117. INFO #9 fragility flag is mitigated by the centralized branch test.
- **CSRF protection on POST routes** — both `csv-validate` and `csv-finalize` go through `withAuth` which calls `assertSameOrigin(req)` for non-GET methods (`withAuth.ts:12-15`). Defense-in-depth before CSRF tokens.
- **Test files (csv-finalize-rpc, csv-validate-route, strategy-verifications-rls, test_csv_validator, csv-upload-flow) are well-structured** — graceful skip-when-no-live-DB pattern, dependency-order cleanup, explicit assertion targeting. The strategy-verifications-rls.test.ts pins the anti-leak invariant for cross-user reads. No flaky patterns; assertion density is appropriate.

---

_Reviewed: 2026-05-01T05:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
