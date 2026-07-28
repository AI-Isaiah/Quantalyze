---
phase: 02
slug: mandate-profile-builder
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-18
revised: 2026-04-18
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

See `02-RESEARCH.md` § Validation Architecture for the full test-layer matrix that this file operationalizes into per-task automated commands.

**Revision note (2026-04-18):** Both `nyquist_compliant` and `wave_0_complete` flipped to `true` after the revision restructured Plan 02-01 + Plan 02-02 to include a Task 0 whose sole job is creating empty test scaffolds (`describe.skip()` shells). This ensures every implementation task's `<automated>` verify references an already-existing file, and no 3 consecutive tasks lack an automated verify. See Plan 02-01 Task 0 and Plan 02-02 Task 0.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 (unit + route-handler) + Playwright 1.59 (E2E) |
| **Config file** | `vitest.config.ts` / `playwright.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && npm run typecheck && npm run lint` |
| **E2E command** | `npm run test:e2e` (gated by `HAS_SEEDED_SUPABASE` env) |
| **Estimated runtime** | ~12 s (Vitest) / ~45 s (Playwright single spec) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (Vitest single-run, ~12 s)
- **After every plan wave:** Run `npm test && npm run typecheck && npm run lint`
- **Before `/gsd-verify-work`:** Full suite must be green; `HAS_SEEDED_SUPABASE=1 npm run test:e2e mandate-form` must pass locally
- **Max feedback latency:** 15 s (per-task); 120 s (per-wave)

---

## Per-Task Verification Map

*Per-task rows match Plan 02-01 and Plan 02-02's task numbering post-revision.*

### Plan 02-01 (Wave 1)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T0 | 01 | 1 | — | — | Wave 0 scaffolds exist so every downstream verify can reference existing files | scaffold | `test -f src/__tests__/mandate-columns-schema-sync.test.ts && test -f src/__tests__/update-allocator-mandates-rpc.test.ts && test -f src/__tests__/mandate-audit.test.ts && test -f src/app/api/preferences/route.test.ts` | ✅ after T0 | ⬜ pending |
| 02-01-T1 | 01 | 1 | MANDATE-01..08 + SC4 | T-02-01, T-02-03, T-02-12 | Migration 061 adds 5 columns + drops `allocator_prefs_self_update` + creates RPC (ROADMAP SC4 Option A) | grep assertions | grep chain on `supabase/migrations/061_mandate_columns.sql` | ✅ after T0 | ⬜ pending |
| 02-01-T2 | 01 | 1 | MANDATE-01..08 + SC4 | — | Migration applied live; self-verify DO block asserts 5 columns + RPC prosecdef=TRUE + self-update policy absent | live-DB probe | `npx supabase db push` (requires `SUPABASE_ACCESS_TOKEN`) | (applied) | ⬜ pending |
| 02-01-T3a | 01 | 1 | MANDATE-08 | T-02-02 | AuditAction union extended + ADR-0023 rows | typecheck | `npm run typecheck && grep -qE "mandate_preference.update" src/lib/audit.ts` | ✅ always | ⬜ pending |
| 02-01-T3b | 01 | 1 | MANDATE-01..03, MANDATE-07 | T-02-08 | Types + SELF_EDITABLE whitelist extended + validateSelfEditableInput bounds + EXPORTED ALLOCATOR_PREFERENCES_COLUMNS | unit | `npx vitest run src/lib/preferences.test.ts` | ✅ always | ⬜ pending |
| 02-01-T4 | 01 | 1 | MANDATE-04, MANDATE-05, MANDATE-08 | T-02-05 (CSRF), T-02-06 (rate-limit) | PUT /api/preferences routes via update_allocator_mandates RPC; mandate_edited_at populated DB-side (asserted in T6) | route unit | `npx vitest run src/app/api/preferences/route.test.ts` | ✅ after T0 | ⬜ pending |
| 02-01-T5 | 01 | 1 | MANDATE-03 (admin parity) | — | Admin PreferencesPanel renders new controls + "Last edited by" indicator | lint + typecheck | `npm run typecheck && npm run lint -- src/components/admin` | ✅ always | ⬜ pending |
| 02-01-T6 | 01 | 1 | MANDATE-04..08 + SC4 | T-02-07, T-02-08, T-02-12 | Live-DB: RPC succeeds + mandate_edited_at within 5s; anon 28000; out-of-range 22023; direct UPDATE on mandate columns affects 0 rows (SC4 Option A) | live-DB | `HAS_LIVE_DB=1 npx vitest run src/__tests__/mandate-columns-schema-sync.test.ts src/__tests__/update-allocator-mandates-rpc.test.ts src/__tests__/mandate-audit.test.ts` | ✅ after T0 | ⬜ pending |

### Plan 02-02 (Wave 2)

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-02-T0 | 02 | 2 | — | — | Wave 0 scaffolds for formatRelativeTime + useMandateAutoSave + MandateForm + MandateAdvanced + e2e/mandate-form | scaffold | `test -f src/components/mandate/*.test.ts{,x} && test -f e2e/mandate-form.spec.ts` | ✅ after T0 | ⬜ pending |
| 02-02-T1 | 02 | 2 | MANDATE-04 | T-02-06 (DoS) | formatRelativeTime pure + useMandateAutoSave retry (429 + 5xx) covered via renderHook — unconditional because @testing-library/react v16.3.2 is installed | unit | `npx vitest run src/components/mandate/formatRelativeTime.test.ts src/components/mandate/useMandateAutoSave.test.ts` | ✅ after T0 | ⬜ pending |
| 02-02-T2 | 02 | 2 | MANDATE-01, MANDATE-02, MANDATE-03 | T-02-04 (XSS), T-02-11 (design drift) | Basic + Advanced section render; chips toggle; slider clamps; MandateSlider keyboard debounce via useRef (W-09 fix — regression test asserts rapid arrow-key → onCommit × 1) | unit | `npx vitest run src/components/mandate/MandateForm.test.tsx src/components/mandate/MandateAdvanced.test.tsx` | ✅ after T0 | ⬜ pending |
| 02-02-T3 | 02 | 2 | MANDATE-01, MANDATE-02, MANDATE-03, MANDATE-04 | — | Full allocator flow — first visit blank, set max_weight, reload, value persists, Reset clears, Advanced expands | E2E | `HAS_SEEDED_SUPABASE=1 npx playwright test e2e/mandate-form.spec.ts` | ✅ after T0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Nyquist continuity check:** No 3 consecutive tasks lack an automated verify. Every implementation task (T1 onward in both plans) references a file that exists after T0 runs; every verify is an automated command (grep, vitest, playwright, or typecheck/lint).

---

## Wave 0 Requirements

Populated by Plan 02-01 Task 0 + Plan 02-02 Task 0 — all files materialized as `describe.skip()` / `test.skip()` shells before any implementation task runs.

- [x] `src/__tests__/mandate-columns-schema-sync.test.ts` — MANDATE-07 smoke test (diff `ALLOCATOR_PREFERENCES_COLUMNS` vs `information_schema.columns`) — scaffolded in 02-01 T0, populated in 02-01 T6
- [x] `src/__tests__/update-allocator-mandates-rpc.test.ts` — live-DB test for MANDATE-05 / MANDATE-06 (RPC-only write path + SC4 Option A direct-UPDATE-blocked) — scaffolded in 02-01 T0, populated in 02-01 T6
- [x] `src/__tests__/mandate-audit.test.ts` — MANDATE-08 audit log coverage — scaffolded in 02-01 T0, populated in 02-01 T6
- [x] `src/app/api/preferences/route.test.ts` — MANDATE-04 (mandate_edited_at) + MANDATE-05 + MANDATE-08 route unit tests — scaffolded in 02-01 T0, populated in 02-01 T4
- [x] `src/components/mandate/MandateForm.test.tsx` — MANDATE-01..MANDATE-04 UI unit tests — scaffolded in 02-02 T0, populated in 02-02 T2
- [x] `src/components/mandate/MandateAdvanced.test.tsx` — MANDATE-03 Advanced accordion unit tests — scaffolded in 02-02 T0, populated in 02-02 T2
- [x] `src/components/mandate/useMandateAutoSave.test.ts` — auto-save hook unit tests (unconditional — @testing-library/react v16.3.2 installed) — scaffolded in 02-02 T0, populated in 02-02 T1
- [x] `src/components/mandate/formatRelativeTime.test.ts` — pure util — scaffolded in 02-02 T0, populated in 02-02 T1
- [x] `e2e/mandate-form.spec.ts` — MANDATE-01..MANDATE-04 end-to-end (HAS_SEEDED_SUPABASE gated) — scaffolded in 02-02 T0, populated in 02-02 T3

*All Wave 0 files are new — no existing harness covers mandate-form surface. Vitest and Playwright are already installed; `@testing-library/react` v16.3.2 is already installed (confirmed during revision). No new framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| "Mandate saved" visually appears and auto-dismisses after 2s | MANDATE-04 (UX) | DM Sans / Geist Mono rendering + 1px border styling + timing visible only in a real browser. D-16 "toast" implemented as inline aria-live region (W-06 reinterpretation note). | Log in as allocator, visit `/preferences`, change `max_weight` slider, release; confirm text "Mandate saved" with teal-accent checkmark appears for ~2 s then reverts to "Last saved: just now", no visual regression vs DESIGN.md |
| Advanced accordion collapse/expand animation smooth (no layout jank) | MANDATE-03 | Animation timing and layout shift | Visit `/preferences`, toggle Advanced accordion twice; confirm no visible jank |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (via Task 0 scaffolds in both plans)
- [x] No watch-mode flags (`--watch` banned — would hang sampling)
- [x] Feedback latency < 15 s per-task
- [x] `nyquist_compliant: true` set in frontmatter
- [x] `wave_0_complete: true` set in frontmatter — flipped after revision restructured both plans to include Task 0

**Approval:** draft (post-revision — ready for plan-checker re-validation)
</content>
