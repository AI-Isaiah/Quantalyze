---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
verified: 2026-11-14T04:00:00Z
status: passed
score: 5/5 must-haves verified
verified_at_sha: 84ca0cf5b3ccec6961248e06d0b7cfdf22576e1a
drift_subjects:
  - src/lib/seam-redaction.ts
  - src/lib/sentry-capture.ts
  - src/instrumentation.ts
  - src/lib/scrub-share-path.ts
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/allocator/scenario/share/route.ts
  - src/__tests__/audit-coverage.test.ts
  - src/lib/wizardErrors.invariant.test.ts
behavior_unverified: 0
overrides_applied: 0
---

# Phase 209: SCRUBLEAKS Verification Report

**Phase Goal:** Error reports never carry raw PostgREST `details`/`hint` and are never lost: scrub at the capture boundary, a `beforeSend` that cannot throw, a UUID guard on the signed-out OG route, and a coded 400 for malformed JSON on validate-and-encrypt. `SHARE-D-164-C` rides along.
**Verified:** 2026-11-14 at `84ca0cf5b`
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `scrubCaptureInput` scrubs non-Error objects, so no capture site can forward `details`/`hint` | VERIFIED (scope noted below) | `sentry-capture.ts` `scrubCaptureInput` renders the non-Error branch AND the Error `cause` fold through `scrubSeamErrorForCapture`. `seam-redaction.ts` `describeThrown(..., capture)` reads only `CAPTURE_OBJECT_DIAGNOSTIC_KEYS` (name, code, message, errno, syscall), propagates `capture` into the recursive cause call, and renders `CAPTURE_OPAQUE_OBJECT` when no named field exists. `PLAIN_OBJECT_DIAGNOSTIC_KEYS` still lists `details`/`hint` (D-03 log path unchanged). RED proof below. |
| 2 | `scrubRecordStrings` survives frozen and getter-only objects without losing the report | VERIFIED | `instrumentation.ts`: `guardedRead`, `scrubSlot` (writes only when `scrubSharePath` changed the string, reads the write back), `cleanOrWithhold`/`withholdSlot`/`rebuildScrubbed` (replace at nearest writable parent), `buildWithheldEvent` (never `null`, keeps `type: transaction`), outer try/catch returns a withheld event. The walk covers every top-level key. 66 tests in `instrumentation.test.ts` pass. |
| 3 | A malformed id on the OG route returns early without spending the Sentry slot | VERIFIED | `og/factsheet/[id]/route.tsx`: `if (isUuid(id)) { try { ...read... } catch { reportOgFailure } }`. A malformed id skips the read and `reportOgFailure`, so `shouldCaptureNow` is never reached. It logs one `console.info` (not an error, no capture). Tests P3 (200, long cache, no DB read) and P6 (a malformed hit, then a valid-uuid read error still captures once) pass. |
| 4 | Malformed JSON on validate-and-encrypt returns a coded 400 | VERIFIED | `keys/validate-and-encrypt/route.ts`: `req.json().catch(err => SyntaxError ? null : throw)` then `!body \|\| typeof body !== "object"` returns `{ code: "KEY_MISSING_REQUIRED_FIELD", error: "Invalid request body" }`, status 400, `NO_STORE_HEADERS`. Non-SyntaxError rethrows (review WR-07). Both censuses moved (route.test 2 to 3, `wizardErrors.invariant` expectedSites 13). |
| 5 | Each fix has a test that goes RED when it is reverted | VERIFIED | Independently reproduced, see the RED table. |

**Score:** 5/5 truths verified.

### RED proofs (reproduced by this verifier)

Each neuter was applied to the implementation file, the named tests run, then the file was restored from a byte backup in the scratchpad (`diff` confirmed identical every time; `git status` shows no source changes).

| SC | Neuter | Result |
|----|--------|--------|
| 1 | add `details`,`hint` to `CAPTURE_OBJECT_DIAGNOSTIC_KEYS` | RED: 7 tests (5 in `sentry-capture.test.ts` [209 SC1] incl. cause and nested cause; 2 in `seam-redaction.test.ts`) |
| 2 | `scrubSlot` writes unconditionally and unguarded | RED: 14 tests in `instrumentation.test.ts` |
| 2 | `scrubSentryEvent` returns the event even when not clean | RED: 3 tests (unwritable root, transaction root, root-withheld shape) |
| 3 | `isUuid(id)` guard replaced by `true` | RED: P3 and P6 |
| 4 | body guard removed (bare `req.json()`) | RED: 8 tests (5 malformed/null/number/string/boolean bodies, the credential-not-leaked test, and both censuses) |
| SHARE-D-164-C | drop `"create_scenario_share"` from `MUTATING_RPC_NAMES` | RED: pin "detected exactly once ... covered by an audit call" |
| SHARE-D-164-C | rename the route's `logAuditEvent(` call | RED: the pin plus the corpus "every .insert/.update ... has a logAuditEvent" test |
| SHARE-D-164-C | reintroduce a method cast around the rpc call | RED: the pin |

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/seam-redaction.ts` (`scrubSeamErrorForCapture`, `CAPTURE_OBJECT_DIAGNOSTIC_KEYS`, `CAPTURE_OPAQUE_OBJECT`) | VERIFIED | exists, substantive, imported by `sentry-capture.ts` |
| `src/lib/sentry-capture.ts` | VERIFIED | imports only `./seam-redaction` (client-bundle constraint kept) |
| `src/instrumentation.ts` (guarded `scrubSentryEvent`, `SENTRY_WITHHELD_EVENT_MESSAGE`) | VERIFIED | registered as both `beforeSend` and `beforeSendTransaction`; `traceLifecycle: "static"` and a `beforeBreadcrumb` that nulls `console` crumbs (D-17/D-18) are in `Sentry.init` |
| `og/factsheet/[id]/route.tsx` | VERIFIED | `isUuid` import from `@/lib/utils` and the guard |
| `keys/validate-and-encrypt/route.ts` | VERIFIED | guard present |
| `allocator/scenario/share/route.ts` | VERIFIED | plain typed `supabase.rpc("create_scenario_share", {` on one line, cast deleted |
| `audit-coverage.test.ts` | VERIFIED | name listed plus positive-control pin |

### Key Link Verification

| From | To | Status |
|------|----|--------|
| `scrubCaptureInput` | `scrubSeamErrorForCapture` (both the top-level and cause-fold sites) | WIRED |
| `describeThrown` | itself, passing `capture` into the cause recursion | WIRED |
| `Sentry.init` | `scrubSentryEvent` for `beforeSend` and `beforeSendTransaction` | WIRED |
| OG route | `isUuid` before `reportOgFailure` | WIRED |
| `wizardErrors.invariant` census | validate-and-encrypt route | WIRED (census passes at 13 and goes RED without the guard) |

### Data-Flow Trace (Level 4)

Not applicable in the render sense. The relevant flow, a thrown PostgREST object to `Sentry.captureException`, was verified by the SC1 tests asserting what the mocked Sentry client receives. The `[209 CR-01/CR-02]` describe in `instrumentation.test.ts` runs the real `@sentry/nextjs` with an in-memory transport and reads the serialised envelope (no raw token in a streamed or transaction envelope).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All phase test files | `npx vitest run` over 10 files (sentry-capture, seam-redaction, instrumentation, OG public-access, validate-and-encrypt, wizardErrors.invariant, audit-coverage, scrub-share-path, PlausibleScript, phase-29-frozen-spine-guards) | 10 files, 409 tests passed | PASS |
| Typecheck | `npx tsc --noEmit -p .` | no output | PASS |
| `phase-29-frozen-spine-guards` | included above | green (scans `supabase/migrations/` only, as D-16 predicted) | PASS |

Probe Execution: none declared. Skipped.

### Requirements Coverage

The PLAN frontmatter `requirements:` fields use the ROADMAP success-criterion labels (SC1 to SC5), not REQUIREMENTS.md ids. `grep` of `.planning/REQUIREMENTS.md` for SC1..SC5, SCRUBLEAKS and Phase 209 returns no rows, matching the task note that the phase has no REQUIREMENTS.md ids, so there is nothing orphaned or unaccounted for.

| Label | Plan | Status |
|-------|------|--------|
| SC1 (+SC5) | 209-01 | SATISFIED |
| SC2 (+SC5) | 209-02 | SATISFIED |
| SC3 (+SC5) | 209-03 | SATISFIED |
| SC4 (+SC5) | 209-04 | SATISFIED |
| SC5 (SHARE-D-164-C) | 209-05 | SATISFIED |

### TODOS ids named in the goal

| TODOS id | Code state |
|----------|------------|
| `204-SENTRY-RAW-SUPABASE-ERRORS` | fixed at the capture boundary (SC1) |
| `SHARE-QA-07` | fixed (SC2) |
| `170.3-OG-MALFORMED-ID` (+ `170.3-OG-P3-STATUS-VACUOUS`) | fixed (SC3, D-12; P3 now has a mock status) |
| validate-and-encrypt bare `req.json()` | fixed (SC4) |
| `SHARE-D-164-C` | fixed (listed, literal typed call, pin) |

### Anti-Patterns Found

Debt-marker scan over the changed non-test source files found nothing unreferenced. Code review ran 3 rounds (`209-REVIEW.md` iteration 3: 0 critical, 0 warning, 11 info; `209-REVIEW-FIX-A/B` all fixed). `209-SECURITY.md`: `threats_open: 0`.

### Judgement: SC1 as worded versus the deferred direct-`Sentry.captureException` sites

SC1 reads "`scrubCaptureInput` scrubs non-Error objects, so no capture site can forward `details`/`hint`". `scrubCaptureInput` is private to `captureToSentry`, so "capture site" is naturally read as a `captureToSentry` call site. Against that reading SC1 is fully met. Every caller of `captureToSentry` is covered at the chokepoint, including `Error` objects whose `cause` is a PostgREST object, which a naive top-level-only fix would have missed (D-02). I also confirmed no `captureToSentry` caller puts a raw error object in `extra`; the one `extra: { error: ... }` I found (`cron/flag-monitor`) is already a string from `scrubSeamError`.

Under a broader reading ("no place in the repo can ship `details`/`hint` to Sentry") SC1 would not be met, because `alert-digest`, `lib/admin.ts` (`reportNonRlsError`), `cron/founder-lp-report`, `cron/ops-alert`, `for-quants-lead` and the `error.tsx` / `global-error.tsx` boundaries call `Sentry.captureException` directly, bypassing `scrubCaptureInput`. I judge the narrow reading correct, for three reasons: (a) the ROADMAP criterion names `scrubCaptureInput` explicitly, (b) the CONTEXT `<deferred>` section records those sites as measured and out of scope, decided before planning, and (c) the `sentry-capture.ts` docblock already states that this helper is the seam's chokepoint, not the repo's. This is an accepted, documented scope boundary, not a silent miss. It is carried below as a non-blocking note.

### Notes (non-blocking, not gaps)

1. **TODOS bookkeeping is still open.** `TODOS.md` is byte-identical to the merge base on this branch; the five closed entries are still `- [ ]` (for example line 1101, `204-SENTRY-RAW-SUPABASE-ERRORS`). The goal says the phase "closes" them. That is records work done at ship time, not a code gap, but it must happen: tick or move those entries, and book the deferred items from `209-CONTEXT.md` `<deferred>` (the direct `Sentry.captureException` sites, `170.3-OG-NOTFOUND-CACHE` left open).
2. **The direct-`Sentry.captureException` bypass is a live, recorded leak class** (see the judgement above). It needs a follow-up entry or phase at ship; nothing in the repo yet owns it.
3. Two inline-snapshot ULP failures in `src/lib/factsheet/compute.conventions.test.ts` reproduce locally per the brief. That file is untouched by this phase and was not run here.
4. D-17/D-18 (static tracing, dropped console crumbs) change Sentry event content (events lose their console trail). This was a recorded decision, not a defect.

### Human Verification Required

None. Every truth is backed by a passing behavioral test that this verifier reproduced as RED when the fix is removed.

### Gaps Summary

No gaps. The phase goal is achieved in the codebase as worded: scrub at the capture boundary (including the cause chain), a total `beforeSend` that delivers a withheld replacement rather than throwing or returning null, a UUID guard that keeps a malformed OG id off the Sentry slot, a coded 400 on validate-and-encrypt, and `create_scenario_share` reachable by the audit law and pinned.

---

_Verified: 2026-11-14_
_Verifier: Claude (gsd-verifier)_
