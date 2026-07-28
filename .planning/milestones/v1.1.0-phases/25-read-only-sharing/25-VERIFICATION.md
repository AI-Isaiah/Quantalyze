---
phase: 25-read-only-sharing
verified: 2026-06-22T14:00:00Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Revoke is idempotent (second revoke returns 200)"
    status: partial
    reason: "WR-04: revoke route returns 404 on a second revoke call (no active row). Core SHARE-03 goal is met — revoke stops the link resolving — but double-click surfaces a confusing 404 error. UX gap only; no security impact."
    artifacts:
      - path: "src/app/api/allocator/scenario/share/revoke/route.ts"
        issue: "0-rows → 404 instead of idempotent 200; only the non-idempotent first-revoke path is tested"
    missing:
      - "Return 200 when count===0 (already revoked); add test T_REV_IDEMPOTENT"
human_verification:
  - test: "Live generate → open → revoke → 404"
    expected: "Allocator generates a share link; recipient page renders scenario name + EquityChart with no USD/AUM; allocator revokes; recipient page returns 404 immediately (force-dynamic, no stale edge cache)"
    why_human: "Requires a live Supabase DB with migration 20260622120000 applied, a real browser, and confirming the recipient page shows zero allocator-identity or live-book data"
  - test: "Visual appearance of the recipient page"
    expected: "Scenario name + 'PROJECTED (simulated)' pill visible; inline KPI strip in return/percentage form; no '$' symbols, no allocation amounts, no dashboard navigation; EquityChart and BTC overlay render"
    why_human: "CSS layout, responsive behaviour, and exact visual output cannot be verified with grep"
  - test: "Clipboard copy behaviour"
    expected: "Clicking 'Copy link' writes the URL to the clipboard and shows the temporary 'Copied' badge only after navigator.clipboard.writeText resolves; no badge on failure"
    why_human: "navigator.clipboard is a browser API; clipboard permission and badge timing cannot be asserted with unit tests"
---

# Phase 25: Read-Only Sharing Verification Report

**Phase Goal:** An allocator can share a saved scenario read-only via a revocable link, and a recipient sees the blend without any exposure of the allocator's live book or another tenant's data.
**Verified:** 2026-06-22T14:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An allocator can generate a share link for a saved, published scenario and the raw token is only ever sent to the browser (never stored) | VERIFIED | `src/app/api/allocator/scenario/share/route.ts`: `mintShareToken()` returns `{raw, hash}`; route stores only `hash` via `create_scenario_share` RPC; response returns `raw` in URL; test T_SH1 asserts hash-not-raw |
| 2 | A recipient visiting the share URL sees the scenario name and projected metrics in return/percentage form with no allocator identity, live-book fields, or cross-tenant data | VERIFIED | `src/app/scenario-share/[token]/page.tsx`: `publicIpLimiter` rate-limit first; `hashShareToken(token)` passed to `get_shared_scenario` SECURITY DEFINER RPC; `notFound()` on 0 rows; page renders `NAME` only; no `formatCurrency`/`api_keys`/`holdings`/`getMyAllocationDashboard` in file; SQL test Assertions 1+4 cover content-by-field + cross-tenant isolation |
| 3 | An allocator can revoke a share link and the public route stops resolving immediately; cross-tenant actors cannot mint shares for scenarios they do not own | VERIFIED | Revoke route sets `revoked_at`; RPC filters `WHERE revoked_at IS NULL`; page is `force-dynamic` + `no-store`; page test asserts resolve→0-rows→`notFound()`; CR-01 3-layer defense: route ownership probe + RLS WITH CHECK EXISTS + RPC JOIN `s.allocator_id = sh.created_by`; SQL test Assertions 5+8+9 |

**Score:** 3/3 truths verified

---

### Roadmap Success Criteria

| SC | Text | Status |
|----|------|--------|
| SHARE-01 | Allocator can generate a revocable share link for a saved, published scenario | VERIFIED |
| SHARE-02 | A recipient (no session required) can view the shared scenario in return/percentage form with no allocator-identity or live-book data exposure | VERIFIED |
| SHARE-03 | Revoking the link stops the public route from resolving immediately | VERIFIED |

---

### Required Artifacts

| Artifact | Purpose | Exists | Substantive | Wired | Status |
|----------|---------|--------|-------------|-------|--------|
| `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql` | `scenario_shares` table + `get_shared_scenario` SECURITY DEFINER RPC + `create_scenario_share` SECURITY INVOKER RPC + CR-01 RLS/RPC/grant hardening | Yes | Yes (18495 bytes, 9 assertions in body-shape DO-block) | Applied in migration sequence | VERIFIED |
| `supabase/migrations/down/20260622120000-rollback.sql` | Drops both functions explicitly + DROP TABLE CASCADE | Yes | Yes (drops `get_shared_scenario`, `create_scenario_share`, `scenario_shares CASCADE`) | Companion to forward migration | VERIFIED |
| `supabase/tests/test_scenario_shares_rls.sql` | 9-assertion SQL test covering CONTENT, unknown token, cross-tenant read, revoke immediacy, anon direct SELECT (42501), cross-tenant write, CR-01 A-mints-for-B, CR-01 RPC backstop | Yes | Yes (22094 bytes, 9 DO-block assertions) | Glob-discovered by CI `test_*.sql` | VERIFIED |
| `supabase/schema/functions/get_shared_scenario.sql` | Snapshot for `dump-sql-functions --check` CI gate | Yes | Yes (3744 bytes) | Checked by CI gate | VERIFIED |
| `supabase/schema/functions/create_scenario_share.sql` | Snapshot for `dump-sql-functions --check` CI gate (added by CR-01 fix commit `d2c6ce55`) | Yes | Yes (3035 bytes) | Checked by CI gate | VERIFIED |
| `src/lib/scenario-share-token.ts` | `mintShareToken()` + `hashShareToken()` — single digest source-of-truth | Yes | Yes (2293 bytes, Node built-in crypto only) | Imported by generate route + recipient page | VERIFIED |
| `src/lib/scenario-share-token.test.ts` | 6 unit tests: 32-byte entropy, base64url, hash≠raw, randomness (50 calls), 64-char lowercase hex, two known sha256 vectors | Yes | Yes (2588 bytes) | CI vitest suite | VERIFIED |
| `src/app/api/allocator/scenario/share/route.ts` | Generate route: ownership probe → rate-limit → mint → atomic RPC; T_SH1–T_SH12 tests | Yes | Yes (11514 bytes, 12 tests) | `withAllocatorAuth`, `mintShareToken`, `create_scenario_share`, `userActionLimiter` | VERIFIED |
| `src/app/api/allocator/scenario/share/revoke/route.ts` | Revoke route: UUID validation → set `revoked_at` WHERE active | Yes | Yes (5806 bytes) | `withAllocatorAuth`, supabase update, 0-rows→404 | VERIFIED (WR-04 warning below) |
| `src/app/api/allocator/scenario/saved/route.ts` | GET /saved: now joins `scenario_shares` and maps `has_active_share` per row (WR-01 fix) | Yes | Yes (WR-01 fix commit `9a1fdad4`) | `scenario_shares` WHERE `revoked_at IS NULL` join → `has_active_share` field | VERIFIED |
| `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` | Share UI: per-row Share→generating→active (Copy link + Revoke) state machine; `has_active_share` initial state | Yes | Yes (4-state inline UX, inline Revoke confirmation, `role="alert"` on error) | Calls `/api/allocator/scenario/share` + `/revoke`; reads `has_active_share` | VERIFIED |
| `src/app/scenario-share/[token]/share-resolve.ts` | Pure resolve layer: RPC row → `{kind:"ok"|"honest-absence"}`; DI-23-01 outcome branch; WR-05 weight finite-guard | Yes | Yes (8682 bytes, no Next/admin/network imports) | Imported by page.tsx | VERIFIED |
| `src/app/scenario-share/[token]/page.tsx` | Public RSC: `force-dynamic`, limit-first, admin RPC, `notFound()` on miss/revoke, honest-absence on non-ok, return/% render; WR-03 AbortController | Yes | Yes (11073 bytes, `force-dynamic`, no USD/AUM/dashboard imports) | `publicIpLimiter`, `hashShareToken`, `createAdminClient`, `resolveSharedScenario` | VERIFIED |
| `src/app/scenario-share/[token]/page.test.tsx` | 5 page tests: resolve→200+no-leak, unknown→404, resolve→revoke→404 (SHARE-03), version-ahead→honest-absence, RPC error→404 | Yes | Yes (11670 bytes) | CI vitest suite | VERIFIED |
| `src/lib/database.types.ts` | `scenario_shares` Tables block (Row/Insert/Update) | Yes | Yes (alphabetical block at line 1151) | database.types.test.ts tripwire | VERIFIED |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| Generate route | `create_scenario_share` RPC | `admin.rpc("create_scenario_share", { p_scenario_id, p_token_hash })` | WIRED | WR-02 fix: atomic revoke-prior + mint in one transaction; route stores `hash` never `raw` |
| Generate route | `mintShareToken` | `import { mintShareToken } from "@/lib/scenario-share-token"` | WIRED | Returns `{raw, hash}`; `raw` in response URL only |
| Recipient page | `get_shared_scenario` RPC | `admin.rpc("get_shared_scenario", { p_token_hash: hashShareToken(token) })` | WIRED | `createAdminClient` (service_role transport); RPC is the sole anon-accessible gate |
| Recipient page | `resolveSharedScenario` | import + called with RPC row + btcDaily | WIRED | DI-23-01: outcome branch; only `"ok"` renders |
| Recipient page | `publicIpLimiter` | `await headers()` + `getClientIp` before any DB/crypto | WIRED | B15 order: rate-limit first |
| `share-resolve.ts` | `hashShareToken` | `import { hashShareToken } from "@/lib/scenario-share-token"` | WIRED | Single digest source-of-truth matches SQL RPC predicate |
| Revoke route | `scenario_shares` | `.update({ revoked_at }).eq("scenario_id").is("revoked_at", null)` | WIRED | Never `.delete()` — preserves audit trail |
| GET /saved route | `scenario_shares` | query WHERE `revoked_at IS NULL`, map `has_active_share` per row | WIRED | WR-01 fix; `SavedScenariosList` reads `has_active_share` to set initial UI state |
| `scenario_shares` RLS | owner coherence | `WITH CHECK (... AND EXISTS (SELECT 1 FROM scenarios s WHERE s.id = scenario_shares.scenario_id AND s.allocator_id = auth.uid()))` | WIRED | CR-01 layer 2 |
| `get_shared_scenario` RPC | owner coherence | `JOIN scenario_shares sh ON ... AND s.allocator_id = sh.created_by` | WIRED | CR-01 layer 3 |
| Route ownership probe | CR-01 layer 1 | SELECT scenarios WHERE id = p_scenario_id AND allocator_id = user.id | WIRED | Verifies ownership before minting; `created_by` always from `user.id` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `page.tsx` | `rpcRow` | `admin.rpc("get_shared_scenario", { p_token_hash })` → `scenario_shares JOIN scenarios JOIN strategy_series` | Yes — SECURITY DEFINER RPC with `status='published'` filter and `revoked_at IS NULL` gate | FLOWING |
| `share-resolve.ts` | `computedMetrics` | `computeScenario(draft, seriesMap)` using `addedStrategies[].id` from RPC row | Yes — live return-series computation from published series data | FLOWING |
| `SavedScenariosList.tsx` | `has_active_share` | GET /saved route → `scenario_shares` WHERE `revoked_at IS NULL` join | Yes — WR-01 fix; row reflects current DB state | FLOWING |

---

### Behavioral Spot-Checks

Step 7b SKIPPED for migration SQL (cannot run pgTAP without a live DB). TypeScript/Next.js routes are not startable without the DB. Token lib is pure and covered by 6 unit tests.

---

### Probe Execution

No `probe-*.sh` files declared in PLAN or found under `scripts/*/tests/`. Step 7c: N/A.

---

### Security Review: CR-01 (Cross-Tenant Disclosure)

Critical finding from 25-REVIEW.md (commit `d2c6ce55`). Three-layer defense verified:

| Layer | Location | Evidence |
|-------|----------|----------|
| 1: Route ownership probe | `src/app/api/allocator/scenario/share/route.ts` | SELECT scenarios WHERE id=p_scenario_id AND allocator_id=user.id before RPC call; 404 on miss |
| 2: RLS WITH CHECK | `supabase/migrations/20260622120000_...sql` | `AND EXISTS (SELECT 1 FROM scenarios s WHERE s.id = scenario_shares.scenario_id AND s.allocator_id = auth.uid())` |
| 3: RPC JOIN guard | same migration, `get_shared_scenario` body | `AND s.allocator_id = sh.created_by` |

SQL test Assertions 8 and 9 cover both the write path (A cannot mint share for B's scenario) and the read backstop (mis-owned share never resolves via RPC).

Status: CLOSED (all 3 layers verified in committed code).

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SHARE-01 | 25-02, 25-03 | Allocator can generate a revocable share link for a saved published scenario | SATISFIED | Token lib (`mintShareToken`/`hashShareToken`), generate route (ownership probe + atomic RPC + Share UX), `has_active_share` wired (WR-01) |
| SHARE-02 | 25-01, 25-04 | Recipient (no session) views shared scenario in return/% form; no live-book or identity exposure | SATISFIED | `get_shared_scenario` SECURITY DEFINER RPC (4-column projection, `status='published'`, `REVOKE ALL FROM anon`), recipient page (`force-dynamic`, limit-first, `notFound()` on miss, no USD/AUM/holdings/dashboard), SQL Assertion 1 (content-by-field), DI-23-01 honest-absence |
| SHARE-03 | 25-01, 25-04 | Revoking the link stops the public route resolving immediately; cross-tenant actors cannot mint shares | SATISFIED | Revoke route sets `revoked_at`; RPC filters WHERE `revoked_at IS NULL`; `force-dynamic`+`no-store` guarantees no stale edge cache; page test asserts revoke→`notFound()`; CR-01 3-layer defense verified |

---

### Anti-Patterns Found

| File | Pattern | Severity | Assessment |
|------|---------|----------|------------|
| `src/app/api/allocator/scenario/share/revoke/route.ts` | 0 rows → 404 (WR-04: idempotent revoke) | WARNING | Not a security issue; second revoke returns "Share not found" instead of 200. Core revocation goal is met. No debt marker; the code path is explicit. |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 25 source files. No `return null` / empty stubs / placeholder renders in critical paths. No hardcoded empty data flowing to render.

---

### Human Verification Required

#### 1. Live generate → open → revoke → 404

**Test:** Apply migration `20260622120000_scenario_shares_and_read_rpc.sql` to the test or staging DB. Log in as an allocator, navigate to Saved Scenarios, generate a share link for a published scenario. Open the link in an incognito tab. Verify the recipient page renders the scenario name and projected metrics with no allocator identity, no USD amounts, no live portfolio data. Return to the allocator view and click Revoke. Reload the recipient tab.
**Expected:** Recipient tab returns 404 immediately (no stale content).
**Why human:** Requires a live Supabase instance with the migration applied plus a real browser and cross-tab verification.

#### 2. Visual appearance of the recipient page

**Test:** After step 1 above, inspect the rendered recipient page across viewport widths.
**Expected:** Scenario name + "PROJECTED (simulated)" pill; inline KPI strip showing return/% values with em-dash for null; EquityChart with BTC overlay; CorrelationHeatmap; ScenarioBenchmarkSection. No "$" symbols, no AUM, no allocator email/name, no dashboard navigation, no edit controls.
**Why human:** CSS layout and visual rendering are not verifiable with grep or unit tests.

#### 3. Clipboard copy behaviour across browsers

**Test:** On the recipient page or on the allocator's active-share row, click "Copy link".
**Expected:** URL is written to clipboard; "Copied" badge appears only after successful `navigator.clipboard.writeText` resolves; no badge appears if the clipboard permission is denied.
**Why human:** `navigator.clipboard` is a browser API whose permission model and timing cannot be tested in jsdom unit tests.

---

### Gaps Summary

**WR-04 — WARNING (not a blocker):** The revoke route returns 404 when an already-revoked scenario is revoked a second time (0 matching rows). The core SHARE-03 requirement — revoke stops the link resolving immediately — is fully satisfied. WR-04 is a UX-level gap: an allocator who double-clicks Revoke sees a "Share not found" error instead of a clean success. To close: return 200 when `count === 0` (already revoked) and add test `T_REV_IDEMPOTENT`. No security impact.

All three roadmap success criteria (SHARE-01/02/03) are verified in the codebase. The critical CR-01 cross-tenant hole is closed with three independent layers. All five WR-series warnings from 25-REVIEW.md are either fixed (WR-01/02/03/05) or classified as an open UX gap (WR-04). Phase goal is achieved pending live E2E confirmation and visual sign-off.

---

_Verified: 2026-06-22T14:00:00Z_
_Verifier: Claude (gsd-verifier)_
