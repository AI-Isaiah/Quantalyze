---
phase: 18
status: findings
depth: standard
critical_count: 0
warning_count: 6
info_count: 7
files_reviewed: 22
reviewed_at: 2026-05-06
---

# Phase 18 — Code Review Report

**Reviewed:** 2026-05-06
**Depth:** standard
**Files Reviewed:** 22
**Status:** findings (no critical blockers)

## Summary

Phase 18's redact.py mirror, founder LP cron, and supporting tooling are well-engineered: PII denylist parity is enforced by both an fs-level Vitest test and a 25-case shared corpus run on both runtimes; the cron route layers six adversarial-revision hardenings (dual-alert, double-failure escalation, 503-retry, AbortSignal timeout, Supabase precheck, internal-token bypass), and the test scaffold covers every failure path. Banned packages are not introduced (resend ^6.10 + native fetch only). vercel.json passes the cron-quota guardrail (7 of 10 entries, schedule shape `15 9 1 * *` clears the daily-or-less-frequent check).

No CRITICAL findings. Six WARNING findings flag real correctness/parity gaps that should be fixed before this phase lands: TS↔Python `scrubFreeformString` semantic drift (TS is 3-pass, Python is 4-pass — the parity test only covers denylist key strings, not behavior), an `unhandledRejection` listener registered at module scope (leaks across lambda warm-starts), the cron sending `x-internal-token: ""` when the env is missing (mask config errors), the readiness-script process.exit pattern that bypasses the `.catch` (defensive but fine), the Resend `from` field defaulting to `notifications@quantalyze.com` (production-irrelevant for dev), and `extractAnalytics` not used in the cron's precheck (semantic divergence with the factsheet endpoint). Seven INFO items cover style nits, doc-comment drift, and minor test coverage holes.

## Critical findings (0)

None.

## Warning findings (6)

### WR-01: TS↔Python `scrubFreeformString` semantic drift (Pass 4 in Python only)

**File:** `analytics-service/services/redact.py:159-183` and `src/lib/admin/pii-scrub.ts:157-171`
**Issue:** The Python `scrub_freeform_string` runs a 4-pass redaction (the 4th is the "Grok B1 secondary" transitive re-walk that re-applies `SENSITIVE_KEY_VALUE` to Pass 3's output). The TS `scrubFreeformString` runs only 3 passes and lacks the transitive re-walk. The denylist parity test (`tests/lib/admin/pii-scrub-python-parity.test.ts`) verifies only that denylist key strings appear in both files — it does NOT detect this behavioral divergence. The shared `redact-corpus.json` is exercised against `scrubPii` only (not `scrubFreeformString`), so the parity gap is invisible to CI.

The plan's `must_haves.truths` first bullet says redact.py "mirrors src/lib/admin/pii-scrub.ts byte-for-byte in semantics." This violates that contract.

**Risk:** A pathological multi-line freeform input that triggers re-walking on Python (e.g., a redacted Pass 1 output whose remaining text re-exposes a `key:value` shape) will be redacted by Python but leak through TS — exactly the cross-runtime drift the parity test exists to prevent.

**Fix:** Either (a) add an equivalent Pass 4 to the TS implementation, or (b) drop Pass 4 from Python and rely on a single-pass `re.sub` (`re.sub` is already global). Option (a) preferred. After aligning, extend the parity test with a `scrubFreeformString` corpus (5+ cases including the transitive shape `"api_key=abc\napi_key=def"` from `test_scrub_freeform_string_transitive_match`) so future drift is caught.

```typescript
// src/lib/admin/pii-scrub.ts — add after line 170:
const pass3 = asString.replace(JWT_SUBSTRING, REDACTED_JWT);
// Pass 4: transitive re-walk (parity with redact.py Grok B1 secondary).
return pass3.replace(SENSITIVE_KEY_VALUE, (_match, keyName) => `${keyName}: [REDACTED]`);
```

---

### WR-02: `process.on("unhandledRejection")` registered at module scope leaks listeners

**File:** `src/app/api/cron/founder-lp-report/route.ts:69-80`
**Issue:** The defensive global handler is attached at module-load time, NOT at request-handler time. Every cold start of the lambda registers a fresh listener; in dev/test with module HMR or when Vitest's `await import("./route")` is invoked across the 10 test cases, listeners accumulate (no `vi.resetModules()` is called in `route.test.ts`). At ≥10 listeners, Node emits `MaxListenersExceededWarning`. In long-running dev shells this also masks unrelated unhandled-rejections in the same process from other modules.

The listener is also process-global — it will fire for ANY unhandled rejection in the entire Node process, not just from the founder-lp-report cron, polluting the console.error stream during local dev when other handlers throw.

**Risk:** Listener leak warnings in production logs after a few warm-start cycles; misattribution of any unhandled rejection in the entire process to "founder-lp-report" via the `[CRON_DOUBLE_FAILURE]` prefix.

**Fix:** Move the registration inside `handle()` with an `off()` cleanup in `finally`, OR (preferred) drop it entirely — the dual-alert path already explicitly catches both Sentry and Resend throws and emits `[CRON_DOUBLE_FAILURE]` synchronously. The defense-in-depth value of an additional global handler is low compared to the listener-leak cost.

```ts
// route.ts — replace lines 69-80 with:
async function handle(req: NextRequest): Promise<NextResponse> {
  const onReject = (reason: unknown) => {
    console.error("[CRON_DOUBLE_FAILURE] unhandledRejection in founder-lp-report:", reason);
  };
  if (typeof process !== "undefined" && typeof process.on === "function") {
    process.on("unhandledRejection", onReject);
  }
  try {
    // ... existing handler body ...
  } finally {
    if (typeof process !== "undefined" && typeof process.off === "function") {
      process.off("unhandledRejection", onReject);
    }
  }
}
```

---

### WR-03: Cron sends `x-internal-token: ""` when `INTERNAL_API_TOKEN` is unset

**File:** `src/app/api/cron/founder-lp-report/route.ts:206-211`
**Issue:** `const internalToken = process.env.INTERNAL_API_TOKEN ?? "";` falls back to an empty string when the env var is missing; the request always sends the `x-internal-token` header. The factsheet endpoint at `pdf/route.ts:30-35` correctly rejects empty-token bypass (`internalEnv.length > 0` gate), so the request silently falls through to public-IP rate limiting — but in production this will trigger `publicIpLimiter` against the Vercel egress IP, which is shared across all serverless functions on the same region. A burst of `alert-digest` traffic can starve the LP cron's PDF fetch out of its 25s budget.

**Risk:** Silent config drift — `INTERNAL_API_TOKEN` missing in production will work most months and fail intermittently, surfacing as a `503` retry-then-dual-alert without any indication that the bypass was never engaged. The `must_haves.truths` row that says "INTERNAL_API_TOKEN already exists and is reused" is not enforced; the cron still operates if the env is dropped during a Vercel rollback.

**Fix:** Treat missing `INTERNAL_API_TOKEN` as a configuration error, similar to `FOUNDER_LP_STRATEGY_ID`. Either:

1. Add a guard at the top of `handle()`:
```ts
if (!process.env.INTERNAL_API_TOKEN) {
  // surface via dualAlert, return 500
}
```
2. Or, omit the header entirely when the env is unset (so the factsheet endpoint sees `internalToken === null` and the rate-limit branch is taken deterministically — at least the failure mode is consistent across deploys):
```ts
const headers: Record<string, string> = { "x-correlation-id": correlation_id };
if (process.env.INTERNAL_API_TOKEN) {
  headers["x-internal-token"] = process.env.INTERNAL_API_TOKEN;
}
```

---

### WR-04: Cron precheck duplicates factsheet's `extractAnalytics` parsing logic

**File:** `src/app/api/cron/founder-lp-report/route.ts:159-192` vs `src/app/api/factsheet/[id]/pdf/route.ts:68-69`
**Issue:** The cron's `checkStrategyReadiness` reimplements the embedded-relation parsing inline (`Array.isArray(analyticsRaw) ? analyticsRaw[0] : analyticsRaw`) and the `computation_status === "complete"` gate. The factsheet endpoint uses the canonical `extractAnalytics(strategy.strategy_analytics)` from `src/lib/utils.ts:125-130`, which handles the same Supabase-embedded-array shape. Duplicating this logic introduces a drift surface — if Supabase changes its embedded-relation shape (already happened twice in repo history), only one of the two call sites will be updated.

Identical concern in `scripts/check-founder-lp-readiness.ts:44-49`.

**Risk:** Future Supabase upgrade changes embedded-relation default from `array` to `object` (or vice-versa), the factsheet endpoint gets fixed via `extractAnalytics`, but the cron precheck silently keeps returning `compStatus === undefined` and dual-alerts on every tick.

**Fix:** Import and use `extractAnalytics` in both `route.ts` and `check-founder-lp-readiness.ts`:

```ts
import { extractAnalytics } from "@/lib/utils";
// ...
const analytics = extractAnalytics(data.strategy_analytics);
const compStatus = analytics?.computation_status;
```

---

### WR-05: `redact.py` `_scrub_string` no-op on empty string is correct but doc-drift

**File:** `analytics-service/services/redact.py:100-102` and the corresponding TS `scrubString` at `src/lib/admin/pii-scrub.ts:84-86`
**Issue:** The TS uses `JWT_SHAPE.test(value)` (regex test) and Python uses `JWT_SHAPE.match(value)` (Match object truthiness). Both are anchored with `^...$`, so behavior is equivalent for non-empty strings. For the empty string, `JWT_SHAPE.test("")` → false, `JWT_SHAPE.match("")` → None → falsy. Equivalent. However, the Python `_scrub_string` does NOT short-circuit on empty input, while the TS short-circuits via `Array.isArray`/object branches earlier. Minor — but the `pii-scrub.ts` docstring says "scrubPii is also applied to JSONB fields where legacy concatenated keys appear" — Python's audit-log entry path `scrub_pii(str(exc))` will pass an empty string through `JWT_SHAPE.match("")`, returning `None`, and return `""` unchanged. Behavior is correct.

The "drift" is in the Sentry shim path: `analytics-service/sentry_init.py:166-167` calls `_redact_scrub_pii(value)` then `_broker_quirk_sweep(canonical)`. The `canonical` walker substitutes `[REDACTED]` for denylisted keys, but the `_broker_quirk_sweep` is then asked to walk the result. If the canonical scrub produced nested redacted values (e.g., `{"x-bapi-apikey": "[REDACTED]"}`), the broker-quirk sweep is a redundant pass. Performance is negligible (deepest observed dict = 7 levels per docstring), but the comment at line 156-160 calls this "two-stage scrub" without acknowledging the redundancy on already-redacted keys.

**Risk:** Pure documentation-only — the behavior is correct.

**Fix:** Add a comment to `_scrub` explaining that the broker-quirk sweep is a no-op on canonical-redacted keys but catches the 5 unpromoted Bybit/Binance keys (`x-bapi-api-key` hyphenated form, `x-bapi-timestamp`, `x-bapi-recv-window`, `x-bapi-sign-type`, `x-mbx-time-unit`).

---

### WR-06: TS↔Python `scrub_pii` divergence on `undefined` inputs

**File:** `analytics-service/services/redact.py:121-122` vs `src/lib/admin/pii-scrub.ts:97`
**Issue:** TS guards with `if (value === null || value === undefined) return value;`. Python uses `if value is None: return value`. Python has no `undefined` (they're conceptually the same), but TS test `pii-scrub.test.ts:155-158` explicitly asserts `expect(scrubPii(undefined)).toBeUndefined();` — there is no equivalent Python test, and the `TestSharedCorpus` does not cover null inputs (corpus has no `null` items). Behavior is fine; coverage gap is the issue.

**Risk:** A future TS contributor refactors `scrubPii` to drop the `undefined` guard, breaking admin pages that render `mandate_context: undefined` blobs; the TS test catches this but the Python parity has no equivalent assertion.

**Fix:** Add to `analytics-service/tests/test_redact.py`:

```python
def test_scrub_pii_passes_none_unchanged():
    assert scrub_pii(None) is None
```

And add a `null` good-case to `tests/fixtures/redact-corpus.json` so both runtimes assert it via `TestSharedCorpus` / "Shared corpus — TS side".

## Info findings (7)

- **IN-01:** `scripts/verify-phase18-artifacts.ts:73` — leak-guard regex `[A-Za-z0-9_=+/-]{40,}` allows hyphens; UUIDs are 36 chars and pass under the 40 threshold but a UUID concatenated with a slug (e.g., `00000000-0000-0000-0000-000000000001-foo`) would trip it. Consider documenting the threshold tradeoff inline (you already note it in the docstring, but adding "Fernet ciphertext starts at ~100 chars; UUID+slug = 40 chars exactly" to the regex line would help future readers).

- **IN-02:** `src/app/api/cron/founder-lp-report/route.ts:106` — the success-email subject `[ALERT] Founder LP cron FAILED — ${date}` for the failure path is good. The success-path subject `Founder LP report — ${monthLabel}` (line 281) uses `Date.toLocaleString("en-US", ...)` which is locale-dependent. Recommend `new Date().toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })` to make the label deterministic.

- **IN-03:** `analytics-service/services/redact.py:127` — the comment "`bool` is a subclass of `int`, so check it FIRST" is correct, but the `if isinstance(value, bool)` branch returns `value` unchanged (same as the `int/float` branch). The bool branch is semantically a no-op; the comment promises explicit isolation but the behavior is identical. Either inline a comment "(intentional pass-through, separate branch for future divergence)" or fold into the int/float branch.

- **IN-04:** `src/app/api/cron/founder-lp-report/route.test.ts:32-35` — the `getCorrelationId` mock returns a fixed UUID. Real production returns a fresh `crypto.randomUUID()` per cron tick, but the test does not verify that the same `correlation_id` propagates to BOTH the Sentry tag AND the Resend `tags[].value` AND the success-response JSON `correlation_id` field. Adding a single `expect(sentryArgs.tags.correlation_id).toEqual(json.correlation_id).toEqual(resendTags[0].value)` triple-equality check would catch a future refactor that decouples these.

- **IN-05:** `tests/fixtures/redact-corpus.json:99-102` — corpus item #20 ("Authorization Bearer JWT") expects `Authorization` key redaction but the value `"Bearer abc"` is not actually a JWT shape (only 1 segment, missing dots). The case is misleadingly named; rename to `"Authorization key non-JWT value"` or replace value with a real 3-segment JWT to make the assertion intent obvious.

- **IN-06:** `src/lib/admin/pii-scrub.ts:48` — `DENYLIST_PREFIX` is declared as `["sb-ec-"]` (a mutable array). Recommend `as const` for literal-narrowing parity with the Python `tuple[str, ...]` immutable annotation.

- **IN-07:** `analytics-service/sentry_init.py:170` — `_redact_before_send` keeps the placeholder name even though Phase 18 plan called for renaming away from "placeholder" semantics now that the canonical scrub is wired. Consider renaming to `_sentry_before_send` to drop the legacy term; `_PII_KEYS` could become `_SENTRY_LOCAL_PII_KEYS` to clarify it's the Sentry-module-scoped enumeration vs. the canonical denylist.

## Files reviewed

- `.env.example` (91 lines)
- `TODOS.md` (694 lines — only Phase 18 section reviewed; pre-existing content out of scope)
- `analytics-service/sentry_init.py` (251 lines)
- `analytics-service/services/audit.py` (149 lines)
- `analytics-service/services/logging_config.py` (139 lines)
- `analytics-service/services/redact.py` (183 lines)
- `analytics-service/tests/test_audit.py` (352 lines)
- `analytics-service/tests/test_logging_config.py` (113 lines)
- `analytics-service/tests/test_redact.py` (339 lines)
- `analytics-service/tests/test_sentry_init.py` (347 lines)
- `package.json` (67 lines)
- `scripts/check-founder-lp-readiness.ts` (73 lines)
- `scripts/verify-phase18-artifacts.ts` (86 lines)
- `src/app/api/cron/founder-lp-report/route.test.ts` (365 lines)
- `src/app/api/cron/founder-lp-report/route.ts` (318 lines)
- `src/app/api/factsheet/[id]/pdf/route.ts` (134 lines)
- `src/lib/admin/pii-scrub.test.ts` (307 lines)
- `src/lib/admin/pii-scrub.ts` (171 lines)
- `tests/fixtures/redact-corpus.json` (126 lines)
- `tests/lib/admin/pii-scrub-python-parity.test.ts` (115 lines)
- `vercel.json` (15 lines)
- `vitest.config.ts` (55 lines)

---

_Reviewed: 2026-05-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
