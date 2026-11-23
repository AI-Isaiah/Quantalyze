---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
fixed_at: 2026-11-14T00:00:00Z
review_path: .planning/phases/212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and/212-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 212: Code Review Fix Report

**Fixed at:** 2026-11-14
**Source review:** 212-REVIEW.md
**Iteration:** 1
**Verification ran in:** the `feat/212-wiztruth` checkout (`quantalyze-212`), no extra worktree. Node 22.

**Summary:**
- Findings in scope: 5 (WR-01 to WR-04, and IN-01 escalated to MEDIUM)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### WR-03: wrong credentials and the 400-status venue verdicts render their own entry again

**Files modified:** `src/lib/wizardErrors.ts`, `src/app/api/keys/validate-and-encrypt/route.ts`, plus tests in `src/lib/wizardErrors.test.ts`, `route.test.ts`, `StrategyForm.test.tsx`, `AllocatorExchangeManager.test.tsx`
**Commit:** dfef8a5e8 (fixed: requires human verification, logic change)
**Applied fix:** `recogniseValidateAndEncryptCode` resolves a 4xx wire code through `VENUE_WIRE_CODE_TO_VERDICT`, after the alias lookup (so `RATE_LIMITED` at 429 is unchanged), and only for rows whose `status === 400` (AUTH_FAILED, MISSING_SCOPE, PERMISSION_DENIED, WITHDRAW_SCOPE, TRADE_SCOPE). It also accepts the wizard-code form of those rows. The route's 4xx arm now answers the classifier's code for a bare 400 (`??` order: upstream seamCode, status map, classifier, "UNKNOWN"), restricted to a 400-status verdict. The old pin "AUTH_FAILED at 424 is UNKNOWN" was corrected.

### WR-02: forwarded 5xx operator-fault codes render UNKNOWN's own cause

**Files modified:** `StrategyForm.tsx`, `AllocatorExchangeManager.tsx` and their tests
**Commit:** 845f2510d
**Applied fix:** the curated-sentence fallback applies only below 500, or when the body has no string code, or the code is the route's own `UNKNOWN` (the persist-INSERT 500 keeps its sentence).

### WR-01: the inbound correlation id is read and logged on the failure paths

**Files modified:** `src/app/api/keys/validate-and-encrypt/route.ts`, `route.test.ts`
**Commit:** eb0a1feef
**Applied fix:** `getCorrelationId()` (the existing helper) is read once in `legacyValidateAndEncryptHandler` and in the STALE_CLIENT arm. The id is on the terminal-500, persist-INSERT and admin-unavailable logs and Sentry tags, the breaker log, a new 504 log, and a new `console.warn` (status and code only) on the 4xx-forward arm. Not threaded through `validateKey`/`encryptKey` to Python (see below).

### WR-04: a stale service key or internal token pages again

**Files modified:** `src/lib/wizardErrors.ts`, `src/app/api/keys/[id]/rotate-secret/route.ts`, tests in `wizardErrors.test.ts`, `rotate-secret/route.test.ts`, `composite/add-key/route.test.ts`; note in `212-CONTEXT.md`
**Commit:** 38c16ed78 (fixed: requires human verification, paging policy)
**Applied fix:** `SEAM_MISCONFIGURED` added to `OUR_DEFECT_KEY_ERROR_CODES`. The classifier's 401/403 branch now requires `error instanceof Error && error.name === "AnalyticsUpstreamError"`; rotate-secret stamps that name on its plain `Error`. Docblocks corrected.

### IN-01: StrategyForm clears the envelope when the connect modal closes

**Files modified:** `StrategyForm.tsx`, `StrategyForm.test.tsx`
**Commit:** f95a91bb8
**Applied fix:** `closeApiModal()` clears `apiEnvelope` and `apiError`, used by the modal `onClose` and Cancel.

## Decisions to confirm

- WR-04 overrides a CONTEXT decision (not adding `SEAM_MISCONFIGURED` to the paging set). It also pages `KEK_UNAVAILABLE`, `SERVICE_KEY_UNCONFIGURED` and `EGRESS_PROXY_MISCONFIGURED` on all three key routes. Noted in `212-CONTEXT.md`; ROADMAP not edited.
- WR-02: "honest cause" is read as UNKNOWN's own cause (the review's fix). These codes were not resolved to `SEAM_MISCONFIGURED` copy, per the review's WIZERR-06 W1 warning.

## Not fixed / residual

- WR-03: a bare-400 MT5 master-password or wrong-server detail, and `KEY_INVALID_SIGNATURE`, have no verdict-table row. The route now emits their wizard code, but the recogniser does not accept it, so they still render the curated sentence inside the UNKNOWN shell (the pre-fix state). Fixing them needs a roster or table addition.
- WR-01: the id is not threaded through `validateKey`/`encryptKey` to Python, so it joins Vercel logs and Sentry, not the analytics service's logs.

---

_Fixed: 2026-11-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
