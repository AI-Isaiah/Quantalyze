---
phase: 96-draft-key-hygiene-onboarding-polish
verified: 2026-07-12T05:33:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
---

# Phase 96: Draft & Key Hygiene + Onboarding Polish — Verification Report

**Phase Goal:** Abandoned wizard artifacts clean themselves up safely, and the small onboarding rough edges are gone.
**Verified:** 2026-07-12T05:33:00Z
**Status:** passed
**Re-verification:** No — initial verification
**Branch:** `gsd/v1.9.1-composite-onboarding-hardening`

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| CLEAN-01 | A cron atomically deletes stale wizard drafts as a SINGLE DELETE (7d window, locked reconciliation with Phase-94), no SELECT-then-DELETE race with finalize | ✓ VERIFIED | Single `DELETE FROM strategies … RETURNING` at migration `20260713120000` L86-95; 7d window L83/L89; cron route makes ONE `admin.rpc("cleanup_abandoned_wizard_drafts")` call (route.ts:70), old SELECT→DELETE + per-key loop deleted (0 hits for `ABANDON_DAYS`/`delete_api_key_if_unreferenced`). OQ3 precondition confirmed independently: `finalize_wizard_strategy` (20260521185008 L83 `FOR UPDATE`, L102 `<> 'draft'` guard, L108-120 `UPDATE … status='pending_review'`, no delete+insert). Race test pins BOTH orderings (finalize-first spare L163-176; cron-first P0002 fail-loud L227-246). |
| CLEAN-02 | After draft cleanup, an api_keys sweep removes ONLY truly-orphaned rows — never a live composite-member, published-composite, single-key, or allocator_holdings-referenced key, and never interferes with sanitize_user | ✓ VERIFIED | 3× `NOT EXISTS` sweep (strategies / strategy_keys / allocator_holdings) at migration L103-105; pre-cascade member capture via `array_agg` L78-83 (BEFORE the DELETE); RPC never sets `sanitize_in_progress` (0 non-comment hits); `delete_api_key_if_unreferenced` not reused (0 non-comment hits); service_role-only ACL (REVOKE L113-114, GRANT L115-116). Self-verify DO block seeds all 5 cases + review_note + 1d, PERFORMs once, RAISEs on any wrong deletion (L143-324), isolated in a ZZ999-sentinel subtransaction → zero real mutation at apply (L174/L314). NEW apply-time ACL self-assert (L333-344). Sweep test pins A/F swept, B/C/D/E spared + sanitize_user behavioral deletion (Part 3 L289-315). |
| UX-01 | Deribit keys render the DRB icon, not "?" | ✓ VERIFIED | `deribit: "DRB"` at ApiKeyManager.tsx:298 in the `exchangeIcon` map (fallback `?` at :352); test asserts `getByText("DRB")` present for a `exchange:"deribit"` row (ApiKeyManager.test.tsx:305). Vitest GREEN. |
| UX-02 | Wizard fetches include X-Correlation-Id, user-findable (sent id === displayed id) | ✓ VERIFIED | `wizardFetch` on all 11 wizard sites (11 calls, 0 bare `fetch(`), memoized singleton `getWizardCorrelationId()` → `wizard:<uuid>` (wizard-correlation.ts:40-45), header set LAST so session id wins (L62-63); 0 `readCorrelationId` copies left, 0 `server-only`/`next/headers` import. SubmitStep.test.tsx:263-282 asserts sent header `/^wizard:[0-9a-f-]{36}$/` AND `getByText(sentId)` rendered in the envelope (sent===displayed). Vitest GREEN. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260713120000_cleanup_abandoned_wizard_drafts.sql` | SECDEF RPC + REVOKE/GRANT + COMMENT + self-verifying DO block | ✓ VERIFIED | 347 lines; SECURITY DEFINER L72; baked `search_path` + `lock_timeout`; 3 NOT EXISTS; 7d ×3; isolated DO block; ACL self-assert |
| `supabase/tests/test_cleanup_wizard_drafts_race.sql` | CLEAN-01 both orderings + structural pins + 7d + M-0255 | ✓ VERIFIED | 302 lines, 4 Parts; 0 meta-commands; asserts `NOT LIKE '%24 hours%'`, finalize FOR UPDATE + `<> 'draft'` + no `DELETE FROM strategies` |
| `supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql` | CLEAN-02 five safety cases + capture + sanitize-unaffected | ✓ VERIFIED | 318 lines, 3 Parts; 0 meta-commands; all 5 cases + pre-cascade capture (Case F) + behavioral `sanitize_user` deletion |
| `src/app/api/cron/cleanup-wizard-drafts/route.ts` | thin auth + single-RPC dispatch + monitor-stable shape | ✓ VERIFIED | Bearer CRON_SECRET via safeCompare (L61), GET+POST (L100-101), 401 otherwise; single rpc (L70); generic 500 + console.error (L72-83); shape `{deleted, orphaned_keys_revoked, key_sweep_errors:0}` |
| `vercel.json` | daily schedule | ✓ VERIFIED | `/api/cron/cleanup-wizard-drafts` → `0 2 * * *` (daily) |
| `src/lib/wizard/wizard-correlation.ts` | client-safe session id + wizardFetch | ✓ VERIFIED | exports `getWizardCorrelationId`, `wizardFetch`, `_resetWizardCorrelationIdForTests`; no server-only import |
| `src/components/strategy/ApiKeyManager.tsx` | deribit entry in icon map | ✓ VERIFIED | `deribit: "DRB"` L298 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| cron route | `cleanup_abandoned_wizard_drafts()` | `admin.rpc()` | ✓ WIRED | route.ts:70 |
| RPC step 1 (capture) | strategy_keys.api_key_id | array_agg BEFORE DELETE | ✓ WIRED | migration L78-83 |
| RPC step 3 (sweep) | api_keys | single DELETE + 3 NOT EXISTS incl allocator_holdings | ✓ WIRED | migration L100-108 |
| wizard steps | wizard-correlation.ts | `wizardFetch(` imports | ✓ WIRED | 11 sites, 0 bare fetch |
| wizardFetch X-Correlation-Id | server getCorrelationId / Sentry tag | inbound-header preference (shipped) | ✓ WIRED | header shape `wizard:<uuid>` passes `/^[A-Za-z0-9._:-]{1,128}$/` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| UX-01 DRB + UX-02 sent===displayed + correlation module + route contract | `npx vitest run` (4 files) | 41 passed (41) | ✓ PASS |
| Migration grep gates | 0 sanitize_in_progress / 0 delete_api_key_if_unreferenced (non-comment); 5 NOT EXISTS; 3 `interval '7 days'` | all pass | ✓ PASS |
| Route grep gate | 0 `ABANDON_DAYS`/`delete_api_key_if_unreferenced` | pass | ✓ PASS |
| SQL meta-command preflight | 0 `^\` lines in both test files | pass | ✓ PASS |

### Probe Execution / SQL Runtime Gate

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| Both SQL safety tests | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f …` | Not executable in this environment (no `TEST_SUPABASE_DB_URL`) | CI-GATED (non-blocking) |

The CI `sql-tests` lane (ci.yml:662-806) auto-discovers `supabase/tests/test_*.sql` via glob and runs each under `psql -v ON_ERROR_STOP=1` — both new files are captured by the glob (confirmed) and their `RAISE EXCEPTION` assertions gate the step. Per repo convention (`reference_db_test_ci_wiring`), SQL gates run only in CI against the shared test project; the RPC persists there from the 96-02 direct-psql apply (committed `CREATE FUNCTION`, only the self-test subtransaction rolls back). The apply-time self-verifying DO block is a second, independent gate that RAISEs (aborting the prod apply) on any wrong deletion. All assertions were read and are substantive — no weakened/short-circuited pins.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CLEAN-01 | 96-01/02/03 | Atomic stale-draft cron (7d, race-safe) | ✓ SATISFIED | migration + route + race test |
| CLEAN-02 | 96-01/02/03 | Scoped orphaned-api_keys sweep, guard/sanitize-safe | ✓ SATISFIED | 3× NOT EXISTS + sweep test + DO block |
| UX-01 | 96-04 | Deribit DRB icon | ✓ SATISFIED | ApiKeyManager.tsx:298 + test |
| UX-02 | 96-04 | Wizard X-Correlation-Id, findable | ✓ SATISFIED | wizardFetch ×11 + SubmitStep sent===displayed test |

### Anti-Patterns Found

None. No `TODO`/`FIXME`/`XXX`/`HACK`/placeholder debt markers in the phase's modified files. No stub returns, no empty handlers, no hardcoded-empty rendered data. The `key_sweep_errors: 0` constant in route.ts is intentional and documented (single-transaction RPC makes partial failure structurally impossible).

### 7-Day Deviation Audit

The locked 7d-on-`created_at` deviation from the ROADMAP's 24h text is documented in EVERY surface: ROADMAP note (line 128), 96-VALIDATION.md decision 1, migration header (L16-20) + COMMENT (L120-121), route.ts header (L13-21), and both SQL test headers. No plan or artifact silently uses a 24h window; the only "24h" strings are deviation-explaining comments, and the race test actively asserts the body does NOT contain `24 hours` (L85-87).

### Human Verification (advisory, NON-BLOCKING)

Per the phase's Nyquist gate, live corroboration is explicitly non-blocking — the offline SQL tests, the apply-time DO block, and the CI sql-tests lane are the authoritative gate. The following are nice-to-have live evidence only, not gating items:

1. **First real prod cron run** — a `POST` with CRON_SECRET (or the daily 02:00 UTC dispatch) returns `{deleted, orphaned_keys_revoked, key_sweep_errors:0}` with a 200.
2. **A genuine 7-day-old abandoned draft is deleted** and its orphaned key swept, in production, without touching any live composite/allocator key.

### Gaps Summary

No gaps. All four success criteria are observably true in the codebase with substantive, non-weakened test backing. The RPC is a single atomic transaction (capture → DELETE → sweep) with a reference-complete, RESTRICT-safe, guard-superset predicate and service_role-only ACL; the cron route is a thin single-RPC dispatcher with preserved auth and redaction; UX-01 and UX-02 are fixed with executed-GREEN vitest proof (41/41). OQ3 (the CLEAN-01 race precondition) was independently confirmed against the live finalize definition, not merely the SUMMARY claim.

---

_Verified: 2026-07-12T05:33:00Z_
_Verifier: Claude (gsd-verifier)_
