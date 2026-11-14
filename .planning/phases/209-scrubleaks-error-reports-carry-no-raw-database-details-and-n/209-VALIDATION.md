---
phase: "209"
slug: "scrubleaks-error-reports-carry-no-raw-database-details-and-never-get-lost"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-14"
---

# Phase 209 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `209-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom default project; `src/instrumentation.test.ts` and `src/lib/seam-redaction.test.ts` run in the node project via `vitest.node-env.ts`) |
| **Config file** | `vitest.config.ts` (+ `vitest.node-env.ts`) |
| **Quick run command** | `npx vitest run src/lib/sentry-capture.test.ts src/lib/seam-redaction.test.ts src/instrumentation.test.ts src/lib/scrub-share-path.test.ts src/app/api/og src/app/api/keys/validate-and-encrypt src/lib/wizardErrors.invariant.test.ts src/lib/wizardErrors.test.ts src/__tests__/audit-coverage.test.ts src/app/api/allocator/scenario/share src/__tests__/phase-29-frozen-spine-guards.test.ts src/app/api/intro src/app/api/strategies/create-with-key` |
| **Full suite command** | `npx vitest run`, then `npm run typecheck` and `npm run lint` |
| **Estimated runtime** | quick ~3 s; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** quick run + `npm run typecheck`
- **Before `/gsd-verify-work`:** full `npx vitest run`, `npm run typecheck`, `npm run lint` green
- **Max feedback latency:** ~5 seconds (quick)

---

## Per-Task Verification Map

Filled by the planner per plan task. Every success criterion maps to a test that must go RED when its fix is neutered:

| SC | Behavior | Test Type | Automated Command | File Exists | Status |
|----|----------|-----------|-------------------|-------------|--------|
| SC1 | plain object / Error-with-plain-cause / nested cause with `details`+`hint` sentinels: no sentinel reaches `Sentry.captureException`; no-field object renders a placeholder | unit | `npx vitest run src/lib/sentry-capture.test.ts src/lib/seam-redaction.test.ts` | ✅ extend | ✅ green |
| SC2 | frozen sub-object holding a share token: no throw, non-null event, token absent; throwing getter; non-iterable breadcrumbs; whole-event frozen | unit | `npx vitest run src/instrumentation.test.ts` | ✅ extend | ✅ green |
| SC3 | malformed id: no read, no capture, long cache; a valid-uuid read error in the same window still captures once | unit | `npx vitest run src/app/api/og` | ✅ extend | ✅ green |
| SC4 | malformed JSON / literal `null` body: 400 `KEY_MISSING_REQUIRED_FIELD`, no-store | unit | `npx vitest run src/app/api/keys/validate-and-encrypt src/lib/wizardErrors.invariant.test.ts` | ✅ extend | ✅ green |
| SC5 / SHARE-D-164-C | listed name + literal call: removing `logAuditEvent` turns audit-coverage RED; positive-control pin keeps the call literal | unit (source scan) | `npx vitest run src/__tests__/audit-coverage.test.ts src/app/api/allocator/scenario/share` | ✅ extend | ✅ green |

| SC2 (review round 2, D-17/D-18) | static trace lifecycle routes transactions through `beforeSendTransaction`; console breadcrumbs dropped; real-SDK envelope carries no token or `details`/`hint` | unit (real SDK, in-memory transport) | `npx vitest run src/instrumentation.test.ts` | ✅ extend | ✅ green |
| WR-09 | no Plausible script on `/scenario-share` | unit | `npx vitest run src/app/PlausibleScript.test.tsx src/lib/scrub-share-path.test.ts` | ✅ new | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-11-14 (quick run: 22 files, 1011 tests green)

## Validation Audit 2026-11-14

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
