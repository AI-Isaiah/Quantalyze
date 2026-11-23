---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
verified: 2026-11-14T20:45:00Z
status: passed
score: 8/8 must-haves verified
verified_at_sha: 9eb393fb14fc3bee5949412eab86a5e30a079a6d
behavior_unverified: 0
overrides_applied: 0
drift_subjects:
  - analytics-service/services/mt5_probe.py
  - analytics-service/tests/test_mt5_concurrency.py
  - analytics-service/tests/test_mt5_validate_parity.py
  - src/lib/wizardErrors.ts
  - src/lib/strategyGate.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx
  - src/app/api/keys/validate-and-encrypt/route.ts
  - src/app/api/keys/[id]/rotate-secret/route.ts
  - src/app/api/strategies/create-with-key/route.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/app/api/strategies/finalize-wizard/route.ts
  - src/app/api/account/export/route.ts
  - src/app/api/admin/match/send-intro/route.ts
  - src/app/api/admin/partner-import/route.ts
  - src/components/strategy/StrategyForm.tsx
  - src/components/strategy/ApiKeyForm.tsx
  - src/components/strategy/ApiKeyManager.tsx
  - src/components/strategy/SyncProgress.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/auth/ProfileForm.tsx
  - src/components/auth/SignupForm.tsx
  - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
  - src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx
---

# Phase 212: WIZTRUTH Verification Report

**Phase Goal:** Every refusal the wizard and the key screens show names the cause that was actually established, and every remedy it offers can succeed.
**Verified:** 2026-11-14, HEAD `9eb393fb1`, phase diff base `4c4fa1993`
**Status:** passed
**Re-verification:** No, initial verification

Judged against the ROADMAP Success Criteria including its dated CORRECTED note (consumer count is two, not three; the 20 s lease wait is not run against a derive at HEAD), and against the founder decisions and recorded defaults in `212-CONTEXT.md`.

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | Composite gated `sampled_gapped` / `fill_derived_unproven` renders `GATE_SERIES_EXAMINED_REFUSED` | VERIFIED | `SyncPreviewStep.tsx` composite arm computes `code = gateFailureToWizardError(isSeriesExaminedButRefused(verdict) ? "SERIES_EXAMINED_REFUSED" : "SERIES_PROVENANCE_UNVERIFIED")` and feeds the same variable to `setErrorCode` and the `wizard_error` telemetry. `isSeriesExaminedButRefused` in `strategyGate.ts` reads the gate's own `SERIES_EXAMINED_BUT_REFUSED` map (no second verdict list). Null/unknown verdict keeps the provenance refusal. Neuter (predicate forced false) turned `SyncPreviewStep.composite.render.test.tsx` RED (4 failed), restored. |
| 2 | `MT5_GATEWAY_MISCONFIGURED_DETAIL` names no cause; founder approves copy; 161-UI-SPEC arm 3 moves with it | VERIFIED | `mt5_probe.py:111` is byte-equal to the founder-approved sentence in CONTEXT. The old "refuses automated trading ... Disable automatic trading through the external Python API" clause is gone from the constant (remaining hits are arm 2 / comments). `161-UI-SPEC.md` arm 3 amended with a dated note. Hand-typed oracle `_EXPECTED_GENERIC` in `test_mt5_validate_parity.py` moved. Neuter (old text restored) turned that file RED (6 failed), restored. `mypy services/mt5_probe.py` clean; `test_mt5_validate.py`, `test_ingestion_mt5.py`, `test_job_worker.py -k mt5` pass. |
| 3 | Validate-and-encrypt consumers render from `code`; bare upstream 401/403 answers a named code | VERIFIED | Two live consumers (`StrategyForm`, `AllocatorExchangeManager` via `ApiKeyForm`) call `recogniseValidateAndEncryptCode(body, status)` and render through `buildEnvelope` + `ErrorEnvelope`; they send `X-Correlation-Id`. `ApiKeyManager` has no `validate-and-encrypt` reference (grep), matching the CORRECTED note. `UPSTREAM_STATUS_TO_SEAM_CODE` moved to `wizardErrors.ts`; `classifyKeyValidationError` answers `SEAM_MISCONFIGURED`/500 for a bare 401/403 on `AnalyticsUpstreamError`, so `create-with-key`, `composite/add-key`, `rotate-secret` and `validate-and-encrypt` agree (`route.bare-401.test.ts`, rotate-secret and add-key tests). Neuter of the 401/403 branch: RED (4 failed). Neuter of `StrategyForm` recogniser call: RED (8 failed). Both restored. |
| 4 | MT5 connect during a running derive waits long enough, or says busy and when to retry; sized from measurement, not guessed | VERIFIED (against recorded decision) | At HEAD a derive leases the job terminal key and an interactive validate leases the validation terminal key (`212-SC4-MEASUREMENT.md`, CONTEXT post-research decision), so a connect does not queue behind a derive. `test_a_held_job_terminal_never_delays_a_validation_acquisition` pins it with a deadman and an equal-config RED control; passes. `_MT5_LEASE_WAIT_S` stays 20 s (`mt5_concurrency.py:183`), no number invented (Railway `mt5.stage` returned 0 entries; recorded). `KEY_MT5_TERMINAL_BUSY` keeps "Try again in a minute." per the founder answer; code does not contradict it. See Notes. |
| 5 | Orphaned MT5 key refused without waiting out validation where identity is known first | VERIFIED | `create-with-key/route.ts`: `if (venueMatch.kind === "orphaned") return keyOrphanedResponse();` sits in the pre-`validateKey` MT5 fence; `keyOrphanedResponse()` takes no parameters and is also used by the 23505 race arm (single body). The two 161-05 order pins were inverted. ccxt/sFOX/race arms unchanged. Neuter of the early refusal: RED (8 failed), restored. |
| 6 | Every remaining "contact support" pointer names a real next step | VERIFIED (against recorded decision) | Census regenerated at HEAD (`grep -rni 'contact support' src ... | grep -v wizardErrors.ts | grep -v test`) returns only two comments (`gdpr-export.ts:379`, `fetch-and-build-payload.ts:224`) and one test fixture JSON. ProfileForm, SignupForm, ScenarioCommitDrawer, WeightOptimizerSection, SyncProgress and ApiKeyManager render through `ContactPointerText`; server strings (`account/export` x2, csv-finalize lost-race, finalize-wizard composite) say "use the contact form"; the two admin `audit_warning` strings name the admin's action. `no-email-in-copy.test.ts` sweep covers the touched modules. Neuter of ProfileForm pointer: RED (2 failed), restored. Survivors recorded by decision, see Notes. |
| 7 | No migration | VERIFIED | `git diff --name-only 4c4fa1993..HEAD` has no path under `supabase/` or any migration; changes are only `src/`, `analytics-service/` and `.planning/`. |
| 8 | Each fix has a test that goes RED when reverted | VERIFIED | Independently neutered SC1, SC2, SC3 (server and client), SC5 and SC6 (ProfileForm sample): each went RED and restored from byte backup (`git status` clean of tracked changes afterwards). SC4 pin carries its own RED control. SC4 copy was not changed, so there is no fix to revert. |

**Score:** 8/8 truths verified (0 behavior-unverified)

### Behavioral Spot-Checks

| Check | Command | Result | Status |
|---|---|---|---|
| Phase vitest surface (127 files, includes every changed test file) | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <phase dirs>` | 127 files, 3440 tests passed | PASS |
| MT5 Python | `cd analytics-service && .venv/bin/pytest tests/test_mt5_validate_parity.py tests/test_mt5_concurrency.py -q` | 62 passed | PASS |
| MT5 curated-message fence consumers | `pytest tests/test_mt5_validate.py` / `-k mt5` on `test_ingestion_mt5.py`, `test_job_worker.py` | 119 passed, 1 skipped / 41 passed | PASS |
| mypy | `.venv/bin/mypy services/mt5_probe.py` | no issues | PASS |
| tsc | `npx tsc --noEmit -p .` | exit 0, no output | PASS |

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX` added in the phase diff; no stubs; wired consumers read real response bodies.

### Notes (not gaps)

- **SC4 copy (founder answer, recorded default kept):** `KEY_MT5_TERMINAL_BUSY` still says "Try again in a minute." `212-CONTEXT.md` still labels this question "pending"; the caller records the founder answer as keep. The label in CONTEXT is stale if the answer was given; no code contradicts the decision. ⛔ **CORRECTED 2026-11-14 (records PR):** the founder answered keep via AskUserQuestion, and `212-CONTEXT.md` now carries it under "Founder answers"; the label is no longer stale.
- **SC6 survivors (recorded default):** the SQL `computation_error_copy` arms and five Python strings (`services/exchange.py` `VALIDATION_UNEXPECTED`, `services/csv_validator.py`, `services/job_worker.py` x2, `routers/portfolio.py`) still read "contact support". SC7 forbids the migration; csv-finalize's TS string deliberately diverges from the SQL ELSE arm and its oracle is hand-typed. Founder 2026-11-14: the divergence is accepted until `[212-CONTACT-SUPPORT-SURVIVORS]` restores parity. 212-09-SUMMARY "Records for ship" says to book ONE survivor entry in `TODOS.md`; that entry does not exist yet (ship owns `TODOS.md`). Ship must write it, or the survivors are unowned. ⛔ **CORRECTED 2026-11-14 (records PR):** the ship (#1274) wrote it; `TODOS.md` carries `[212-CONTACT-SUPPORT-SURVIVORS]`.
- **WR-04 reversal:** `SEAM_MISCONFIGURED` is in `OUR_DEFECT_KEY_ERROR_CODES` (`wizardErrors.ts`), matching the reversed decision, with the widened paging cost (also pages `KEK_UNAVAILABLE`, `SERVICE_KEY_UNCONFIGURED`, `EGRESS_PROXY_MISCONFIGURED` on all three key routes) recorded in CONTEXT and the docblock. Code agrees with the reversal. Founder 2026-11-14: keep the paging.
- **Residuals recorded in `212-REVIEW-FIX.md`:** a bare-400 MT5 master-password/wrong-server detail and `KEY_INVALID_SIGNATURE` still render their curated sentence inside the UNKNOWN shell (pre-fix state); the inbound correlation id is not threaded to Python. Neither is a ROADMAP criterion.
- **SC4 configuration dependence:** validate/derive separation is a deploy-configuration fact (equal job and validation endpoint pairs would reinstate the old premise); pinned honestly by the RED control, not enforced in code.
- **Ship records owed (not phase gaps):** delete closed `TODOS.md` entries (`0.07`, `0.09`, `0.012`, `0.013`, `WIZFORM-02-VE-CODECHANNEL`, `164.2-WIZARD-BARE401`, `CONTACT-SUPPORT-POINTERS-01`; `0.51` as recorded and structurally pinned), name them in the CHANGELOG, and keep `.planning/` commits off the ship branch.
