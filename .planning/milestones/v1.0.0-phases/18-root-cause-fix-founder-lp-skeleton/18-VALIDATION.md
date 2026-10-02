---
phase: 18
slug: root-cause-fix-founder-lp-skeleton
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-06
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | vitest 3.x (TS) + pytest 8.x (Python, analytics-service) |
| **Config files** | `vitest.config.ts` (TS) + `analytics-service/pytest.ini` + `analytics-service/conftest.py` (Python) |
| **Quick run command (TS)** | `npx vitest run` (single-pass; no watch mode) |
| **Quick run command (Py)** | `cd analytics-service && pytest -x --no-cov tests/test_redact.py` |
| **Full suite command (TS)** | `npm run test` |
| **Full suite command (Py)** | `cd analytics-service && pytest --cov-fail-under=80` |
| **Coverage gate (TS)** | `npm run test:coverage` (60% floor / 80% target) |
| **Estimated runtime** | TS quick ~30-60s; Py quick ~5-10s; TS full ~3-5min; Py full ~1-2min |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the runtime touched (TS or Py).
- **After every plan wave:** Run the full suite for both runtimes.
- **Before `/gsd-verify-work`:** Both full suites must be green.
- **Max feedback latency:** ≤ 60s (TS quick) / ≤ 10s (Py quick).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | FIX-01 | T-18-01 | Wizard root-cause traceability recorded; PR #116 commit ref + regression test path persisted in `.planning/phase-18/` artifact | manual+grep | `grep -q "3932842" .planning/phase-18/in-flight-traceability.md && grep -q "TestSyncTradesEnqueuesComputeAnalytics" .planning/phase-18/in-flight-traceability.md` | ❌ W0 | ⬜ pending |
| 18-01-02 | 01 | 1 | FIX-02 | T-18-02 | Founder OKX wizard end-to-end smoke evidence captured (correlation_id + redacted ciphertext fingerprint, never plaintext) | manual+grep | `test -f .planning/phase-18/founder-okx-smoke.md && grep -q "correlation_id" .planning/phase-18/founder-okx-smoke.md && ! grep -qE "[A-Z0-9]{32,}" .planning/phase-18/founder-okx-smoke.md` | ❌ W0 | ⬜ pending |
| 18-01-03 | 01 | 1 | FIX-03 | T-18-03 | 10-team onboarding tracker exists with one row per team and required columns | manual+grep | `test -f .planning/phase-18/team-status.md && [ "$(grep -c '\| ' .planning/phase-18/team-status.md)" -ge 11 ]` | ❌ W0 | ⬜ pending |
| 18-02-01 | 02 | 2 | FIX-04 | T-18-04 | `analytics-service/services/redact.py` exists with `scrub_pii`, `truncate_account_id`, `scrub_freeform_string` | unit | `cd analytics-service && pytest tests/test_redact.py -x --no-cov` | ❌ W0 | ⬜ pending |
| 18-02-02 | 02 | 2 | FIX-04 | T-18-04 | TS↔Python denylist parity test passes — every TS denylist key appears verbatim in `redact.py` text | unit | `npx vitest run tests/lib/admin/pii-scrub-python-parity.test.ts` | ❌ W0 | ⬜ pending |
| 18-02-03 | 02 | 2 | FIX-04 | T-18-04 | Sentry `before_send` uses `scrub_pii` (not the `_redact_before_send` placeholder) | unit | `cd analytics-service && pytest tests/test_sentry_init.py::test_before_send_scrubs_pii -x --no-cov` | ❌ W0 | ⬜ pending |
| 18-02-04 | 02 | 2 | FIX-04 | T-18-04 | structlog processor pipeline includes `redact.scrub_pii` call | unit | `cd analytics-service && pytest tests/test_logging_config.py::test_redact_processor -x --no-cov` | ❌ W0 | ⬜ pending |
| 18-02-05 | 02 | 2 | FIX-04 | T-18-04 | audit-log writer applies `scrub_pii` to JSON payloads | unit | `cd analytics-service && pytest tests/test_audit.py::test_audit_payload_scrubbed -x --no-cov` | ❌ W0 | ⬜ pending |
| 18-02-06 | 02 | 2 | FIX-04 | T-18-04 | Shared 20-bad / 5-good fixture corpus loads from `tests/fixtures/redact-corpus.json` and is consumed by both runtimes via `describe("Shared corpus — TS side", ...)` block in canonical `src/lib/admin/pii-scrub.test.ts` AND `TestSharedCorpus` class in `analytics-service/tests/test_redact.py` <!-- Plan-checker fix 2026-05-06: blocker --> | unit | `grep -q 'describe("Shared corpus — TS side' src/lib/admin/pii-scrub.test.ts && npx vitest run src/lib/admin/pii-scrub.test.ts -t "Shared corpus — TS side" && cd analytics-service && pytest tests/test_redact.py::TestSharedCorpus -x --no-cov` | ❌ W0 | ⬜ pending |
| 18-03-01 | 03 | 2 | LP-01 | T-18-05 | `/api/cron/founder-lp-report` route handler exists, registered in `vercel.json` `crons` at `0 9 1 * *` | unit+grep | `npx vitest run src/app/api/cron/founder-lp-report/route.test.ts && grep -q '"/api/cron/founder-lp-report"' vercel.json` | ❌ W0 | ⬜ pending |
| 18-03-02 | 03 | 2 | LP-02 | T-18-06 | Cron failure path fires both Sentry `cron-failure` + Resend alert email (separate try/catch per Pitfall 7) | unit | `npx vitest run src/app/api/cron/founder-lp-report/route.test.ts -t "failure path"` | ❌ W0 | ⬜ pending |
| 18-03-03 | 03 | 2 | LP-02 | T-18-06 | Success path emits Resend email to founder with PDF attached (Buffer / base64 per Resend SDK v6.10) | unit | `npx vitest run src/app/api/cron/founder-lp-report/route.test.ts -t "success path"` | ❌ W0 | ⬜ pending |
| 18-04-01 | 04 | 3 | LP-03 | T-18-07 | `.planning/phase-18/dogfood-commitment.md` stub exists with PENDING frontmatter + TODO marker (NOT auto-filled by Claude) | grep | `test -f .planning/phase-18/dogfood-commitment.md && grep -q "status: PENDING" .planning/phase-18/dogfood-commitment.md && grep -q "<TODO: founder" .planning/phase-18/dogfood-commitment.md` | ❌ W0 | ⬜ pending |
| 18-04-02 | 04 | 3 | — (docs) | — | BACKBONE-06 + BACKBONE-07 phase attribution updated from Phase 18 → Phase 19 in REQUIREMENTS.md, ROADMAP.md, STATE.md; Day-2 Section 5 receives a "REVISED — superseded by CONTEXT.md" header | grep | `grep -q "Phase 19" .planning/REQUIREMENTS.md && grep -q "Phase 19" .planning/ROADMAP.md` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_redact.py` — pytest module covering `scrub_pii`, `truncate_account_id`, `scrub_freeform_string`, `TestSharedCorpus` class
- [ ] `analytics-service/tests/test_sentry_init.py` — covers `before_send` redaction path (extend if file exists; new file otherwise)
- [ ] `analytics-service/tests/test_logging_config.py` — covers structlog processor pipeline includes `redact.scrub_pii`
- [ ] `analytics-service/tests/test_audit.py` — covers `scrub_pii` applied to audit payloads
- [ ] `tests/lib/admin/pii-scrub-python-parity.test.ts` — Vitest TS↔Python denylist parity (reads `redact.py` text via `fs.readFileSync`)
- [ ] `tests/fixtures/redact-corpus.json` — shared 20-bad / 5-good fixture; `bad[]` items `{input, expected}`, `good[]` items `{input}` (must round-trip unchanged)
- [ ] `src/app/api/cron/founder-lp-report/route.test.ts` — happy + failure-path tests with mocked `fetch` for `/api/factsheet/[id]/pdf` and mocked Resend client + Sentry capture
- [ ] No new framework installs — vitest + pytest already wired

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Founder OKX wizard end-to-end smoke against production-equivalent environment | FIX-02 | Requires founder live test key + Vercel preview / production-equivalent — cannot be CI-driven | Founder runs the wizard against own OKX test creds; captures `correlation_id`, `strategies.id`, redacted ciphertext fingerprint to `.planning/phase-18/founder-okx-smoke.md`. Plan 1 final task verifies the file format, not the run itself. |
| Real founder verbal-in-writing dogfood commitment text | LP-03 | "Verbal-in-writing" by definition cannot be authored by Claude; founder pastes at /ship time | Plan 4 ships a stub with `status: PENDING` + `<TODO: founder fills in at /ship time>`; founder edits at /ship time before merge. Stub presence is the automated check; content is the manual one. |
| Cron PDF arrives in founder inbox via Resend | LP-01 + LP-02 | Requires real Resend send + DNS deliverability + founder mailbox check | Founder triggers the cron manually post-deploy (Vercel "Run Now" or curl with cron secret); confirms email + PDF attachment received. |
| Phase 16 founder gate Plan 16-08 Task 3 Binance cassettes | (deferred, NOT this phase) | Founder has no Binance account per Day-2 Section 6 | Out of scope — recorded as deferred in Day-2 Appendix A. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify (grep, vitest, or pytest) or are explicitly manual-only with reason
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (Plan 1's three artifact tasks each have a grep check)
- [ ] Wave 0 covers all MISSING test files (test_redact.py, parity test, route.test.ts, fixture JSON)
- [ ] No watch-mode flags (vitest `run`, pytest `-x`)
- [ ] Feedback latency < 60s for TS quick, < 10s for Py quick
- [ ] `nyquist_compliant: true` will be set after gsd-planner produces plans aligned with this map
- [ ] LP cron + redact.py wire-ups have parity-of-evidence verification (separate test cases for happy + failure paths; separate Sentry + Resend mocks)

**Approval:** pending
