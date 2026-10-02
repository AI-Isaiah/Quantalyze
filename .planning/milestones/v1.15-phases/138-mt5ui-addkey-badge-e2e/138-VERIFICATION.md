---
phase: 138-mt5ui-addkey-badge-e2e
verified: 2026-07-24T01:05:00Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
re_verification:
  # none — initial verification
---

# Phase 138: MT5UI — Flag-gated add-key UI + api_verified badge + setup guide + all-roles e2e Verification Report

**Phase Goal:** MT5 is a first-class, flag-gated add-key experience with the `api_verified` trust distinction visible and e2e-proven across all roles — dark until Phase 139 flips it.
**Verified:** 2026-07-24T01:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

Verification method was RUN + GREP, not SUMMARY trust. Every vitest/pytest suite named in the plans was executed in this process; every guard was grepped against the actual source.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | MT5 card behind `MT5_UI_ENABLED` (reads `NEXT_PUBLIC_MT5_ENABLED`, strict `=== "true"`); OFF = byte-identical (no MT5 option); 3 fields (login/investor pw/broker server, server required); three distinguishable `KEY_MT5_*` envelopes, zero new strings | ✓ VERIFIED | `closed-sets.ts:124` strict `=== "true"`. RAN `vitest` mt5-flag + sfox-flag + ConnectKeyStep → **49 passed**. Card gated at `ConnectKeyStep.tsx:119 ...(MT5_UI_ENABLED ? [...] : [])`; labels `MT5 login`/`Investor password`/`Broker server` (`:126`,`:131`); `requiresPassphrase:true` gates broker-server submit; `buildEnvelope` wired (`:339`); `wizardErrors.ts` diff **empty** across phase commits (no new strings) |
| 2 | `#mt5-readonly` setup guide gated on SERVER flag `isMt5EnabledServer` (not client), prominent MUTED "use INVESTOR password never master"; present when server-flag ON, absent OFF | ✓ VERIFIED | `security/page.tsx:544 isMt5EnabledServer() && <SubAnchor id="mt5-readonly">`. RAN security page vitest (part of **96 passed**) — renders-iff-flag both directions + non-exact `it.each`. Steer at `:549-552` uses muted voice; no `text-amber`/`text-red`/`⚠` added (only comments referencing the ban). Client `MT5_UI_ENABLED` NOT imported into this Server Component |
| 3 | `api_verified` badge ZERO visual change; MT5 rides existing trust_tier projection | ✓ VERIFIED | `git diff --stat a21d0f5f^..087c27ba -- VerifiedBadge.tsx TrustTierLabel.tsx trust-tier-tokens*` → **empty**. Phase filelist contains no badge component or token file |
| 4 | `mt5-badge.spec.ts` across ALL roles (owner/allocator/admin/anon) + REGISTERED exactly once in the blocking `e2e-seeded` list in ci.yml; `seedMt5VerifiedStrategy` exists | ✓ VERIFIED | `playwright --list` → **5 tests** (owner-edit tag, owner factsheet+axe, allocator, admin, anon). `grep -F -c e2e/mt5-badge.spec.ts ci.yml` → **1**, at `ci.yml:1558` inside the else-branch blocking seeded list feeding the `frontend` aggregator. `seedMt5VerifiedStrategy`/`cleanupMt5VerifiedStrategy`/`SeededMt5VerifiedStrategy` exported; fail-loud names migration `20260723172032` |
| 5 | Provenance tags: mt5 in BOTH `ApiKeyManager.exchangeIcon` + `AllocatorExchangeManager.EXCHANGE_TAGS`, sfox hex reused (no new hex) | ✓ VERIFIED | `ApiKeyManager.tsx:316 mt5:"MT5"`; `AllocatorExchangeManager.tsx:143 mt5:{label:"MT5",bg:"#F1F5F9",fg:"#0F172A"}` = sfox `:136` hex verbatim. RAN both component test files (part of **96 passed**) |
| 6 | Server gate `MT5_ENABLED` fail-closed confirmed by EXISTING 135/136 tests (collect + pass, not skip) | ✓ VERIFIED | RAN `vitest validate-and-encrypt/route.test.ts -t "mt5"` → **15 passed** (29 filtered out by `-t`, not code-skipped). RAN `pytest test_mt5_derive_branch.py` → **16 passed, 0 skipped**; `test_ingestion_mt5.py` enabled_server truth table + fail-closed → **10 passed** on the combined filter. No pandera collection error |
| 7 | Exclusions: mt5 NOT in `UI_EXCHANGE_CODES` (test-pinned); NOT in `MultiKeyConnectStep`/manager `ApiKeyForm` | ✓ VERIFIED | `UI_EXCHANGE_CODES` = base(4) + optional sfox only (`closed-sets.ts:199-216`); flag test pins mt5-free under flag ON **and** OFF (`closed-sets.mt5-flag.test.ts:55-70`). `grep mt5 MultiKeyConnectStep.tsx` → none; `grep mt5 ApiKeyForm.tsx` → none |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/closed-sets.ts` | `MT5_UI_ENABLED` strict-true const | ✓ VERIFIED | `:124`, single static member access; docblock distinguishes from server `isMt5EnabledServer` |
| `src/lib/closed-sets.mt5-flag.test.ts` | truth table + no-widening pin | ✓ VERIFIED | 72 lines; strict-true + 6 non-exact `it.each`; UI_EXCHANGE_CODES/EXCHANGES no-widening pins both flag states |
| `ConnectKeyStep.tsx` | flag-gated MT5 card + label overrides + trust-atom swap | ✓ VERIFIED | `wizard-exchange-mt5` testid derived; trust-atom keyed `activeExchange?.id === "mt5"` first (`:248`); presentation-only passphrase overrides |
| `security/page.tsx` | server-flag-gated `#mt5-readonly` SubAnchor | ✓ VERIFIED | `:544-567`; muted 4-step list; no IP/gateway claim |
| `e2e/mt5-badge.spec.ts` | all-roles seeded badge + tag spec | ✓ VERIFIED | 221 lines; 5 legs; buildAxe pass; api_verified OR-locator on stable `data-trust-tier` |
| `e2e/helpers/seed-test-project.ts` | seedMt5VerifiedStrategy trio | ✓ VERIFIED | trio exported; parameterized boundary detector names mt5 migration; getAdmin prod-safety path preserved |
| `.github/workflows/ci.yml` | mt5 spec in blocking seeded list | ✓ VERIFIED | registered exactly once, `:1558` |
| `ApiKeyManager.tsx` / `AllocatorExchangeManager.tsx` | mt5 tag entries | ✓ VERIFIED | both present, sfox hex reused |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| ConnectKeyStep.tsx | closed-sets.ts | `import { MT5_UI_ENABLED } from @/lib/utils` | ✓ WIRED | `:12`; utils re-export `:165` |
| ConnectKeyStep.tsx | wizardErrors/envelope | `buildEnvelope(code)` | ✓ WIRED | `:339`; codes pre-authored 135, wizardErrors.ts diff empty |
| security/page.tsx | closed-sets.ts | `isMt5EnabledServer()` (server, not client flag) | ✓ WIRED | `:2` import, `:544` gate |
| ConnectKeyStep `/security#mt5-readonly` | security/page.tsx | stable SubAnchor `id="mt5-readonly"` | ✓ WIRED | href auto-derived from `ex.id`; target `id="mt5-readonly"` present |
| mt5-badge.spec.ts | seed-test-project.ts | import `seedMt5VerifiedStrategy` | ✓ WIRED | `:54-55` |
| ci.yml e2e-seeded | mt5-badge.spec.ts | explicit spec list | ✓ WIRED | `:1558`, blocking else-branch, count 1 |
| strategy_verifications.trust_tier | VerifiedBadge/TrustTierLabel | trust_tier projection + Phase-126 SECDEF RPC | ✓ WIRED | anon + admin legs assert non-owner visibility via `data-trust-tier="api_verified"` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Flag truth table + no-widening + wizard card | `vitest mt5-flag + sfox-flag + ConnectKeyStep` | 3 files, 49 passed | ✓ PASS |
| Security guide renders-iff-flag + tag maps | `vitest security/page + ApiKeyManager + AllocatorExchangeManager` | 3 files, 96 passed | ✓ PASS |
| TS route go-dark gate | `vitest validate-and-encrypt -t "mt5"` | 15 passed (29 filtered) | ✓ PASS |
| Worker derive go-dark | `pytest test_mt5_derive_branch.py` | 16 passed, 0 skipped | ✓ PASS |
| Ingestion enabled-server + fail-closed | `pytest -k "enabled_server or disabled_fails_closed or fails_closed"` | 10 passed | ✓ PASS |
| Playwright spec lists all roles | `playwright test e2e/mt5-badge.spec.ts --list` | 5 tests (owner/owner/allocator/admin/anon) | ✓ PASS |
| CI registration count | `grep -F -c e2e/mt5-badge.spec.ts ci.yml` | 1 | ✓ PASS |
| Seeded Playwright run against live TEST DB | (needs seed env + CI infra) | deferred to CI e2e-seeded blocking gate | ? SKIP (by design — spec is registered + self-skips w/o seed env; CI is authority) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MT5UI-01 | 138-01, 138-02 | Flag-gated MT5 add-key (3 creds, server required) + investor-password setup guide | ✓ SATISFIED | Truths 1, 2, 7 verified |
| MT5UI-02 | 138-03 | api_verified badge across all roles + connect-flow honest copy + server gate fail-closed | ✓ SATISFIED | Truths 3, 4, 5, 6 verified |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | none | — | No debt markers (TBD/FIXME/XXX) in phase files; no amber/red/⚠ styling leaked into resting forms (only comments citing the ban); no stub returns in new code |

### Human Verification Required

None. The seeded Playwright badge e2e is an AUTOMATED blocking CI gate (registered in the `e2e-seeded` else-branch feeding the `frontend` aggregator), not human UAT. Per the phase classification, a local seeded-DB run is explicitly NOT required — local verification of registration + `--list` (5 tests) is sufficient, and both pass. The flag FLIP + live badge render against a real MT5 account is Phase 139 scope, explicitly not a Phase 138 gap.

### Gaps Summary

No gaps. All 7 must-haves verified against the codebase by running the tests and grepping the guards:
- The flag is strict `=== "true"` and OFF is byte-identical (test-pinned both directions incl. the UI_EXCHANGE_CODES no-widening pin).
- The three `KEY_MT5_*` envelopes are distinguishable at the component level with zero new strings (wizardErrors.ts untouched).
- The setup guide is server-flag-gated and muted.
- The badge components are byte-identical (git diff empty).
- The all-roles spec exists, lists 5 tests, and is registered exactly once in the blocking CI list.
- Provenance tags reuse the sfox hex in both maps.
- The 135/136 go-dark gates collect and pass (not skip).
- mt5 is excluded from UI_EXCHANGE_CODES, MultiKeyConnectStep, and manager ApiKeyForm.

The buildable/flag-gated, dark-until-139 goal is achieved.

---

_Verified: 2026-07-24T01:05:00Z_
_Verifier: Claude (gsd-verifier)_
