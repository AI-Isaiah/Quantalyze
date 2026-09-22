---
phase: "167"
slug: "credtrust-an-invalid-venue-credential-is-named-to-the-custom"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: validated
nyquist_compliant: true
wave_0_complete: true
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
| D-09 / D-10 | No end-user note promises a retry when `classify_exception` calls the failure permanent | unit | `./.venv/bin/python -m pytest tests/test_allocator_positions.py -x` (cwd `analytics-service/`) | ⚠️ file exists; today's cases pin the UNCONDITIONAL strings — **owned by `167-02` tasks 1–3** |
| D-04 | The public factsheet payload never carries the new cause field | *(none — honoured by omission)* | ⛔ **No command. MEASURED: `phase-148-owner-lane-cache-isolation.test.ts` has ZERO field-level assertions over `FactsheetPayload` — every payload mention is the cached builder's function name or prose. It would stay GREEN through a leaked field.** The guard CANNOT be the evidence here, so the plan action is *do not add the field*, verified by no plan's `files_modified` touching `fetchAndBuildPayload`, the cached wrapper or the share route. A new guard is owed only if a `checkpoint:decision` ever approves such a field. | n/a |
| D-12 | `ledger_refresh_staleness`'s grants stay `service_role`-only | *(none needed)* | ⭐ **No consumer is added by any of the five plans**, so the view's grant posture is untouched and nothing is owed. Re-opens only if a future phase adds a reader. | n/a |

⛔ **Every assertion added or changed must be proven able to fail:** neuter → observe RED →
restore from a `cp` byte backup verified with `cmp`, re-taken after every edit. ⛔ Never
`git checkout -- <path>` / `git restore` / `git stash`.

---

## Wave 0 Requirements

⭐ **All three gaps are OWNED by plan tasks as of 2026-09-22.** Verified by `gsd-plan-checker`
against the five committed plans; the owners below are task-level, not aspirational.

- [x] Python cases proving the retry-promising copy family became a function of
      `classify_exception`'s verdict (D-10) — **owned by `167-02`, tasks 1–3.**
- [x] The arm-B SQL gate over the widened CHECK constraint, and the test proving the new
      `sync_status` value cannot render as a neutral **idle** pill — **owned by `167-03`, tasks 1–2**,
      landing in the SAME commit as the migration.
- [x] ⛔ **The "new write boundary" gap is N/A by measurement, not by waiver.** `167-04`'s scoping
      decision measures that PROD cron **jobid 15** (`poll-allocator-positions`, `0 4 * * *`, active)
      already polls every active non-revoked key daily — the write boundary EXISTS and fires. The
      ROADMAP's own multi-week evidence is that job writing the wrong cause repeatedly. Nothing is
      built; the gap is closed by the absence of a need for it.

⚠️ **A fourth fallback was found during planning and is closed in `167-04`:** `sync_error_copy`'s
`.get(status, SYNC_ERROR_COPY_BY_STATUS["error"])` silently renders the GENERIC sentence for a status
with no copy row — so the new value would have looked handled while saying the wrong thing. It is
closed with a fallback-SPECIFIC test, not a key-existence test.

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

- [x] All tasks have `<automated>` verify or a named Wave 0 dependency
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers every MISSING reference above
- [x] No watch-mode flags; every command asserts non-zero test discovery
- [x] Feedback latency < 120 s for the scoped commands
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-22 — `gsd-plan-checker` VERIFICATION PASSED over the five committed
plans, 0 blockers. The checker re-measured every census pin, the wave intersection and the D-11
self-latch evidence itself rather than reading them off the plans.

⚠️ **This file's frontmatter was stale until this edit** (`draft` / `nyquist_compliant: false` /
`wave_0_complete: false`) while all three gaps were already owned. Caught by the plan checker and
recorded here rather than silently corrected, because an automated Nyquist gate reads the
frontmatter, not the prose — a stale `draft` would have misled it in the direction of looking
*less* verified than the phase is, which is the harmless direction, but it is still a lie.
