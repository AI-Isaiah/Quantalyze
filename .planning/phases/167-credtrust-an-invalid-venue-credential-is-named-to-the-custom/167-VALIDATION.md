---
phase: "167"
slug: "credtrust-an-invalid-venue-credential-is-named-to-the-custom"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-22"
---

# Phase 167 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `167-RESEARCH.md` § Validation Architecture. The per-task map is filled by the
> planner; this file establishes the infrastructure, the sampling rate and the Wave 0 gaps.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (TS)** | Vitest |
| **Framework (Python)** | pytest — ⛔ run ONLY from `analytics-service/` via that directory's `.venv/bin/python` by ABSOLUTE path |
| **Config file** | `vitest.config.ts` (repo root); `analytics-service/` pytest config |
| **Quick run command (TS)** | `npx vitest run src/lib/ src/app/api/keys/ --reporter=dot` |
| **Quick run command (Python)** | `./.venv/bin/python -m pytest tests/test_allocator_positions.py tests/test_job_worker.py -x` (cwd `analytics-service/`) |
| **Full suite command (TS)** | `npm run test:coverage` |
| **Full suite command (Python)** | `./.venv/bin/python -m pytest` (cwd `analytics-service/`) |
| **Estimated runtime** | scoped TS ~60 s; scoped Python ~90 s; full TS suite several minutes |

⛔ **`0 collected` / `0 tests` is a LOUD FAILURE, never a pass.** Every `<automated>` command in
this phase must assert the run discovered tests, following the shape this repo already uses:
`... > /tmp/x.log 2>&1; RC=$?; cat /tmp/x.log; test "$RC" = 0 && ! grep -qE '\b0 (passed|tests)\b' /tmp/x.log`.

⛔ **No watch-mode flags.** `vitest run`, never bare `vitest`.

---

## Sampling Rate

- **After every task commit:** the scoped quick-run command matching the files touched.
- **After every plan wave:** full TS suite, plus the full Python suite when any
  `analytics-service/**` file moved.
- **Before `/gsd-verify-work`:** full suite green, per repo convention.
- **Max feedback latency:** 120 s for the scoped commands.

---

## Per-Task Verification Map

*Filled by `gsd-planner`. Every task must carry an `<automated>` verify or an explicit Wave 0
dependency. The decision→behaviour rows below are the contract those task rows must satisfy.*

| Decision | Behaviour that must be proven | Test Type | Automated Command | File Exists |
|---|---|---|---|---|
| D-06 / D-07 | The new `WizardErrorCode` is reachable FROM its wire code and does not fall through to the `UNKNOWN` terminal | unit | `npx vitest run src/lib/wizardErrors.test.ts --reporter=dot` | ✅ |
| D-06 | Both hand-typed `EXPECTED_TABLE_SIZE` pins agree with the live table, and the third self-referential assertion still reads them back | unit | `npx vitest run src/lib/wizardErrors.test.ts --reporter=dot` | ✅ |
| D-06 | The Python emitter's `error_code` set still equals the TS disposition set — a new code with no `VENUE_WIRE_CODE_TO_VERDICT` row reds BY NAME | unit | `npx vitest run src/lib/seam-venue-vocabulary.invariant.test.ts --reporter=dot` | ✅ |
| D-08 | `buildEnvelope` derives `recoverable: false` for the new code, so `ErrorEnvelope` renders NO Retry | unit | `npx vitest run src/lib/wizardErrors.test.ts src/components/error/ErrorEnvelope.test.tsx --reporter=dot` | ✅ |
| rosters | BOTH `ReadonlySet<WizardErrorCode>` rosters admit the new code — `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) and `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`) | unit | `npx vitest run src/lib/ --reporter=dot` | ✅ |
| D-05 / D-09 | The owner-surface helper for a credential failure is AUTHORED, not a pass-through of `api_keys.sync_error` | unit | `npx vitest run src/components/exchanges/AllocatorSyncStatus.test.tsx --reporter=dot` | ✅ |
| D-09 / D-10 | No end-user note promises a retry when `classify_exception` calls the failure permanent | unit | `./.venv/bin/python -m pytest tests/test_allocator_positions.py -x` (cwd `analytics-service/`) | ⚠️ file exists; the cases assert today's UNCONDITIONAL strings — **Wave 0 gap** |
| D-04 | The public factsheet payload never carries the new cause field | integration | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts --reporter=dot` | ✅ existing guard; must be EXTENDED if any field is added to the payload type |
| D-12 | `ledger_refresh_staleness`'s grants stay `service_role`-only after any new consumer | sql gate | a new `supabase/tests/test_*.sql` gate | ❌ **Wave 0** — only if a consumer is added |

⛔ **Every assertion added or changed must be proven able to fail:** neuter → observe RED →
restore from a `cp` byte backup verified with `cmp`, re-taken after every edit. ⛔ Never
`git checkout -- <path>` / `git restore` / `git stash`.

---

## Wave 0 Requirements

- [ ] Python cases proving the retry-promising copy family became a function of
      `classify_exception`'s verdict (D-10). None exist: today's cases pin the current
      unconditional strings, so they would pass unchanged against a broken implementation.
- [ ] **If D-11 arm B (a new `sync_status` value) is chosen:** a `supabase/tests/test_*.sql` gate
      over the widened CHECK constraint, and a test proving `PILL_STYLES`' unknown-value fallback
      cannot render the new value as a neutral **idle** pill. ⛔ That fallback is the phase's
      worst silent-failure mode — a half-done rollout shows a BROKEN key as HEALTHY.
- [ ] **If a new write boundary is added** to `run_sync_trades_job` or the ledger fan-out (see the
      open scoping question in RESEARCH): a Python test proving that boundary writes the same
      curated-copy contract the holdings pipeline already enforces — never a raw exception string.

*Existing `wizardErrors.test.ts`, `seam-venue-vocabulary.invariant.test.ts` and the envelope tests
are NOT gaps — they are the proven, reusable mechanism from 164.5.4 and simply gain cases and pins.*

---

## Manual-Only Verifications

| Behaviour | Why Manual | Test Instructions |
|---|---|---|
| The live credential-failure render against a real stalled key | Requires a real venue credential to be invalid in production. ⛔ The founder enters credentials; no agent enters, reads or echoes one. | Founder observes the owner surface for a key in the failed state and confirms the copy names the credential and offers no Retry. |
| The wizard render against a wedged MT5 terminal | A live MT5 op is a FOUNDER act — ⛔ no agent may `railway redeploy`, restart or `ssh` into the live gateway. | Founder-only; plan it as a `checkpoint:human-action`, never an `auto` task. |
| That the ledger refresh is still recurring in production | ⛔ No database command may be run from this checkout — its Supabase CLI is linked to PRODUCTION (D-02). | Out of scope for this phase; recorded as a deferred ops-observability item. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a named Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers every MISSING reference above
- [ ] No watch-mode flags; every command asserts non-zero test discovery
- [ ] Feedback latency < 120 s for the scoped commands
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
