---
phase: 161
slug: wizerr-honest-error-surfaces
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-24
---

# Phase 161 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by plan-phase §5.5 from `161-RESEARCH.md § Validation Architecture`.
> The Per-Task Verification Map below is a template row until plans exist — `/gsd-validate-phase 161`
> fills it once task IDs are minted.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (TS, jsdom) · pytest (Python) · Playwright (e2e — not exercised by this phase) |
| **Config file** | `vitest.config.ts` · `analytics-service/pytest.ini` |
| **Quick run command** | `npx vitest run <file>` · `cd analytics-service && python3 -m pytest tests/<file> -x` |
| **Full suite command** | `npm run test` · `cd analytics-service && python3 -m pytest` |
| **Estimated runtime** | ~90s per touched TS suite; full TS suite runs sharded in CI |

### Invocation constraints (measured — violating these produces false RED/GREEN)

| Constraint | Why |
|---|---|
| Run vitest from the **repo root**, never inside a git worktree | Worktree agents get no `node_modules`: `npx vitest` exits 1 `MODULE_NOT_FOUND` and `npx tsc` resolves an unrelated package |
| Run pytest **from `analytics-service/`**, not the repo root | A repo-root run misses the VCR cassettes and issues LIVE broker calls |
| Use `python3`, not `python` | `python` is not on PATH in this environment |
| Do **not** wrap the vitest suite in `gstack-evidence run` | Measured 2026-08-24: 5/5 wrapped runs RED vs 3/3 direct runs GREEN on identical trees. A/B must use the same invocation mode |
| Never clear a contract test with a file-scoped run | `src/__tests__/contracts/` scan all of `src/`; only a full-suite run is authoritative |
| CI is **Node 22**, local is Node 25 | A CI-only vitest failure is not a flake; reproduce with `PATH=/opt/homebrew/opt/node@22/bin` |

---

## Sampling Rate

- **After every task commit:** the touched file's own suite (per-requirement commands below)
- **After every plan wave:** `npm run test` + `cd analytics-service && python3 -m pytest` when Python was touched
- **Before `/gsd-verify-work`:** full TS + Python suites green, `mypy --strict` clean on `analytics-service`, coverage thresholds intact (lines 82 / stmts 80 / fns 74 / branches 72 — blocking)
- **Max feedback latency:** ~90 seconds per task

> ⚠️ **Ledger rule — verification wording.** Branch protection is deliberately off until there are
> paying clients, so every CI gate is **advisory at merge**. Verification prose must say a gate
> "**would have** caught it", never "did stop it".

---

## Requirement → Test Map

| Req | Test type | Automated command | Exists? |
|-----|-----------|-------------------|---------|
| WIZERR-01 | pytest parity/fence | `python3 -m pytest tests/test_mt5_validate_parity.py -x` (+ job_worker, ingestion_mt5 pins) | ✅ fence exists; cause-variant cases are Wave 0 additions in the same files |
| WIZERR-02/03 | vitest route + component | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts` + WizardClient / SyncPreviewStep suites | ✅ suites exist; new arms need new cases |
| WIZERR-04 | vitest route + **NEW law** | `npx vitest run 'src/app/api/keys/[id]/permissions/route.test.ts'` (+ `route.seam.test.ts`) | ✅ route tests exist; the derived-population law is **NEW** (Wave 0) |
| WIZERR-05 | vitest lib + routes | `npx vitest run src/lib/analytics-client.test.ts` + both key-route tests | ✅ exist; `retryAfter` field cases are new |
| WIZERR-06 | vitest, 5 route tests | each route has `route.test.ts` (bridge / simulator / match) | ✅ ⚠️ they re-declare `AnalyticsUpstreamError` locally — a ctor change must not silently miss them |
| WIZERR-07 | vitest component + law extension | `npx vitest run src/components/strategy/RenameStrategyDialog.test.tsx` etc. | ✅ `AllocateDialog.test.tsx` has a Button/Modal identity carve-out — do not disturb it |
| WIZERR-08 | vitest 2 route tests + 4th ROUTES row | `npx vitest run src/lib/wizardErrors.invariant.test.ts` | ✅ invariant file exists; the row is **NEW** |
| WIZERR-09/10 | vitest gate + step | `npx vitest run src/lib/strategyGate.test.ts src/lib/wizardErrors.test.ts` + SyncPreviewStep.composite.render | ✅ — D-15's oracle re-cut is deliberate |
| WIZERR-11 | vitest copy tests | `npx vitest run src/lib/wizardErrors.test.ts` | ✅ venue-conditional cases are new |
| WIZERR-12 | vitest route + fixtures | `npx vitest run src/__tests__/csv-finalize-c14-regression.test.ts` + CsvSubmitStep.upstream-arm | ✅ fixtures re-pointed by hand |
| WIZERR-13 | pytest validator + vitest envelope | `python3 -m pytest tests/ -k csv_validator -x` + `npx vitest run 'src/app/(dashboard)/strategies/new/wizard/steps/CsvValidationEnvelope.test.tsx'` | ✅ both exist |

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _pending_ | — | — | — | — | — | — | — | — | ⬜ pending |

*Populated by `/gsd-validate-phase 161` once PLAN task IDs exist. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] **NEW** derived-population coverage law over the `keys/[id]/permissions` `PROBE_*` vocabulary (venue-vocabulary-law form) — covers WIZERR-04
- [ ] **NEW** 4th `ROUTES` row (`keys/validate-and-encrypt`) with a *measured* `expectedSites` count + roster decision — covers WIZERR-08 and closes the STALE_CLIENT regrowth vector
- [ ] **NEW** law extension reaching the three dashboard dialogs (a population outside the wizard-steps directory) — covers WIZERR-07
- [ ] MT5 cause-variant cases added to `test_mt5_validate_parity.py` alongside the existing fence assertions — covers WIZERR-01

*Everything else lands in existing suites.*

---

## Anti-Vacuity Requirement (project rule — non-negotiable)

> **A test that CANNOT FAIL is worse than none.** Four vacuity mechanisms have shipped in this repo
> in a single day. Every new law, pin, and regression case in this phase must be proven falsifiable:
> neuter the production behavior, **observe RED first-hand**, then restore the code byte-identical.
> Record the observed failure message in the task's verification note. A coverage law whose
> population resolves to the empty set passes trivially and is exactly this failure mode — every
> new law above must assert its population is non-empty.

Money-math oracles are not in scope here, but the sibling rule applies to copy oracles: pin the
**economics/semantics**, not the implementation's own formula. A test asserting `copy(X) === copy(X)`
is self-referential and cannot fail.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dialog overflow with a multi-bullet `fix[]` list | WIZERR-07 | The three dialogs mount the envelope in a **fixed-height** body; whether it scrolls or clips is a rendered-layout property jsdom does not measure | Open Allocate / Rename / MarkOwnership, force an error carrying ≥3 `fix[]` bullets, confirm the list scrolls within the dialog rather than clipping. Flagged ⚠ unresolved in `161-UI-SPEC.md § UI Considerations` |
| MT5 `tradeapi_disabled` arm selection on a live gateway | WIZERR-01 | Assumption A1 — `terminal_info()` carrying `tradeapi_disabled` was founder-measured once (2026-08-13) with zero production readers | Re-measure against the live gateway before relying on the flag; an absent key must fall through to the generic fallback, never mis-select an arm |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (4 items above)
- [ ] Every new law/pin proven falsifiable by observed RED (anti-vacuity rule)
- [ ] Every new coverage law asserts a non-empty population
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
