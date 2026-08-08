---
phase: 153
slug: wizform-form-errors-belong-on-the-form-mt5-declarable
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-08
---

# Phase 153 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `153-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest `^4.1.2` (TS) + pytest (`analytics-service/`) |
| **Config file** | `vitest.config.ts` — coverage thresholds lines 82 / statements 80 / functions 74 / branches 72 |
| **Quick run command** | `npx vitest run <file>` + `npx tsc --noEmit` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Python command** | `cd analytics-service && python3 -m pytest tests/ -k mt5 -x` |
| **Lint** | `npm run lint` |
| **e2e** | `npx playwright test e2e/api-key-flow.spec.ts` |
| **Estimated runtime** | quick ~15s · full vitest ~6min · python ~90s |

⚠️ **pytest MUST run from `analytics-service/`** — a repo-root run misses the VCR
`cassette_library_dir` and fires LIVE broker calls.
⚠️ **CI is Node 22, local is Node 25.** A CI-only vitest failure is not a flake —
reproduce with `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test`.
⚠️ **Never run the python and e2e-seeded suites concurrently** against the shared TEST DB.

---

## Sampling Rate

- **After every task commit:** the vitest file(s) the task touched + `npx tsc --noEmit`
- **After every plan wave:** `npm test` + `npm run lint` + `cd analytics-service && python3 -m pytest -x`
- **Before `/gsd:verify-work`:** full vitest `--coverage` (blocking), `mypy --strict` on
  `analytics-service`, full playwright
- **Max feedback latency:** 60 seconds (per-task quick run)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; this table is keyed by requirement until then.
> `❌ W0` = the test file/assertion does not exist yet and is a Wave 0 dependency.

| Req | Wave | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----|------|-----------------|-----------|-------------------|-------------|--------|
| WIZFORM-01 | 1 | A 2-char description is refused inline; no POST fires | unit (RTL) | `npx vitest run src/app/\(dashboard\)/strategies/new/wizard/steps/MetadataStep.test.tsx` | ✅ extend | ⬜ pending |
| WIZFORM-01 | 1 | Submit focuses the FIRST invalid control, opening a collapsed `<details>` first | unit (RTL) | same file | ✅ extend | ⬜ pending |
| WIZFORM-01 | 1 | Submit button is **not** `disabled` for a validation reason — the predicate refuses | unit (RTL) | same file | ✅ extend | ⬜ pending |
| WIZFORM-01 / D-12 | 1 | `AllocateDialog` amount fixed after an error clears red **live**; border derives from `aria-invalid` | unit (RTL) | `npx vitest run src/app/\(dashboard\)/allocations/components/AllocateDialog.test.tsx` | ✅ extend | ⬜ pending |
| WIZFORM-02 | 1 | Every `finalize-wizard` emitted code clears the roster — **derived from disk** | invariant | `npx vitest run src/lib/wizardErrors.invariant.test.ts` | ✅ extend `ROUTES` | ⬜ pending |
| WIZFORM-02 | 0 | The derivation is NOT vacuous (site-count floor for the third route) | invariant | same file | ❌ **W0** | ⬜ pending |
| WIZFORM-02 | 0 | SELF-TEST: the widened emitter predicate matches the new arm shape | invariant | same file | ❌ **W0** | ⬜ pending |
| WIZFORM-02 | 1 | Each of the nine 400 arms returns its `code` | route unit | `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts` | ✅ extend | ⬜ pending |
| WIZFORM-02 | 1 | `EXPECTED_TABLE_SIZE` moves at **both** sites (`:1437`, `:1649`) | unit | `npx vitest run src/lib/wizardErrors.test.ts` | ✅ update | ⬜ pending |
| WIZFORM-03 | 0 | No `substitutable:false` venue receives a substitution bullet — swept over the **whole copy table** | unit | `npx vitest run src/lib/wizardErrors.test.ts` | ❌ **W0** | ⬜ pending |
| WIZFORM-03 | 0 | A `fix[]` bullet presupposing a surface is suppressed when `context.surface` is absent | unit | same | ❌ **W0** | ⬜ pending |
| WIZFORM-04 | 1 | An MT5 submit makes **zero** `keys-permissions` seam calls | route unit | `npx vitest run src/app/api/strategies/finalize-wizard/route.test.ts` | ✅ extend | ⬜ pending |
| WIZFORM-04 | 0 | An **unresolved** venue (`null`) still probes — fail-toward-probing | route unit | same | ❌ **W0** | ⬜ pending |
| WIZFORM-04 | 1 | A ccxt submit still probes — byte-identical behaviour (D-22: sFOX unchanged) | route unit | same | ✅ extend | ⬜ pending |
| WIZFORM-05 | 0 | `budgetKeyFor("mt5")` selects the long row; every other venue selects `validate-key`; unknown falls back | unit | `npx vitest run src/lib/analytics-client.*.test.ts` | ❌ **W0** | ⬜ pending |
| WIZFORM-05 | 1 | SC-4a/b/d/e/f still green with the new legs | invariant | `npx vitest run src/lib/seam-budgets.invariant.test.ts` | ✅ update rosters | ⬜ pending |
| WIZFORM-05 | 1 | Every budget key / timeout / dependency / retry pin | pin | `npx vitest run src/lib/seam-constants.pin.test.ts` | ✅ update literals | ⬜ pending |
| WIZFORM-05 | 0 | ⭐ **A-25 holds against the NEW longest budget** (D-18/D-19) | pin | same file | ❌ **W0** | ⬜ pending |
| WIZFORM-05 | 1 | Python nested ordering `LOGIN_MS < REQUEST_S < STAGE_S < DEADLINE_S` holds (D-02) | unit | `cd analytics-service && python3 -m pytest tests/ -k mt5 -x` | ✅ extend | ⬜ pending |
| WIZFORM-05 | 0 | The `finally`-close still runs when the end-to-end deadline fires | unit | same | ❌ **W0** | ⬜ pending |
| MT5-14 | 1 | Flag OFF ⇒ no MT5 in any offered set (byte-identical) | pin | `npx vitest run src/lib/closed-sets.mt5-flag.test.ts` | ✅ **re-cut** | ⬜ pending |
| MT5-14 | 0 | Flag ON ⇒ MT5 **is** offered in the wizard chip set — the **positive** assertion (D-20) | pin | same file | ❌ **W0** | ⬜ pending |
| MT5-14 | 1 | `CRYPTO_EXCHANGES` stays mt5-free; `isCryptoExchange("mt5") === false` | pin | `npx vitest run src/lib/closed-sets.test.ts` | ✅ **must stay green** | ⬜ pending |
| MT5-14 | 0 | MT5 is **preselected** from `detectedExchange`; the pinned chip is a `<span>` not a disabled `<button>` | unit (RTL) | `MetadataStep.test.tsx` | ❌ **W0** | ⬜ pending |
| MT5-14 | 0 | `supportedExchanges` always contains the detected venue in the submitted payload | unit (RTL) | same | ❌ **W0** | ⬜ pending |
| Cross-cutting | 2 | e2e wizard flow still green | e2e | `npx playwright test e2e/api-key-flow.spec.ts` | ✅ | ⬜ pending |
| Cross-cutting | 2 | a11y — new long-wait card, new inline errors | e2e axe | `npx playwright test e2e/axe-app-wide.spec.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] ⭐ A-25 derived-longest-budget assertion in `src/lib/seam-constants.pin.test.ts` — WIZFORM-05
- [ ] `budgetKeyFor(exchange)` unit tests incl. the unknown-venue fallback — WIZFORM-05
- [ ] Vacuity floor + SELF-TEST for the widened emitter predicate in `wizardErrors.invariant.test.ts` — WIZFORM-02
- [ ] Class-level sweep: no `substitutable:false` venue receives a substitution bullet — WIZFORM-03
- [ ] Surface-absent ⇒ bullet suppressed — WIZFORM-03
- [ ] Fail-toward-probing on an unresolved venue in `finalize-wizard/route.test.ts` — WIZFORM-04
- [ ] Python: `finally`-close survives the end-to-end deadline; ordering-chain assertion — WIZFORM-05
- [ ] Flag-ON **positive** assertion in `closed-sets.mt5-flag.test.ts` — MT5-14
- [ ] MT5 preselect + `<span>`-not-`<button>` pinned chip in `MetadataStep.test.tsx` — MT5-14
- [ ] Framework install: **none needed**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real MT5 login completes inside the 90s budget and reports an honest verdict | WIZFORM-05 | Needs the live funded account on a trading day; no distribution of *successful* MT5 login latencies exists to pin against | Founder connects the live MT5 key via the wizard on a trading day; verdict must render before the client gives up. Deferred to **Phase 155** (MT5-VERIFY). |
| The inline red field reads correctly to a screen reader | WIZFORM-01 | axe catches the wiring, not the announcement quality | VoiceOver over the metadata step with a 2-char description |

---

## Falsifiability Ledger

> **Coverage answers "is it verified?". This section answers "CAN the verification FAIL?"**
> Complete the Observed column at execution time. **Observed means run** — paste the failing assertion.

| SC | Mutation (exact edit to production source) | Must turn RED | Observed? | Evidence |
|----|-------------------------------------------|---------------|-----------|----------|
| SC-1 (WIZFORM-01) | `MetadataStep.tsx`: raise the inline guard's threshold off `MIN_DESCRIPTION_CHARS` to a bare `1` | `MetadataStep.test.tsx` 2-char case | ⬜ pending | |
| SC-1 (WIZFORM-01) | Delete the `aria-invalid` prop from the description control, keeping the red class hand-toggled | `MetadataStep.test.tsx` aria assertion **and** the axe e2e | ⬜ pending | |
| SC-2 (WIZFORM-02) | Remove `code:` from **one** of the nine 400 arms (pick the 7th, not the 1st) | `wizardErrors.invariant.test.ts` derived-roster assertion | ⬜ pending | |
| SC-2 (WIZFORM-02) | Reorder one arm's literal to `{ error, code }` so `EMITTER_RE` goes blind | the **vacuity floor** must red — if only the roster assertion reds, the floor is too low | ⬜ pending | |
| SC-3 (WIZFORM-04) | Flip the `scopeProbeSupported` default from `true` to `false` | fail-toward-probing test (unresolved venue) | ⬜ pending | |
| SC-3 (WIZFORM-04) | Change the mt5 skip to an instance check `venue === "mt5"` and add a second non-probing venue | the class-level sweep must red; an instance test will not | ⬜ pending | |
| SC-4 (WIZFORM-05) | Raise the MT5 budget to `120_000` without touching `BREAKER_LOCK_TOMBSTONE_S` | ⭐ the **new derived** A-25 assertion (the existing literal-vs-literal one must NOT red — that is the point) | ⬜ pending | |
| SC-4 (WIZFORM-05) | In `exchange.py`, set the stage timeout **above** the end-to-end deadline | the Python ordering-chain assertion (D-02) | ⬜ pending | |
| SC-5 (WIZFORM-03) | Add a venue-substitution bullet to one `substitutable:false` copy entry | the whole-table sweep | ⬜ pending | |
| SC-6 (MT5-14) | Add `mt5` to `CRYPTO_EXCHANGES` | `closed-sets.test.ts` `isCryptoExchange("mt5") === false` | ⬜ pending | |
| SC-6 (MT5-14) | Ship the chip-set widening but delete the preselect from `detectedExchange` | the preselect RTL test — the roadmap forbids widening without preselect | ⬜ pending | |

*Rules:*
- **Observed means run.** "The test covers it" is not evidence. Paste the failing assertion.
- **A mutation that is skipped** (ambiguous anchor, unreachable) is recorded as skipped, **never as caught**.
- **Prefer the second member of a class.** Two ledger rows above (SC-2 arm #7, SC-3 second
  non-probing venue) exist specifically to detect instance-fixes masquerading as class-fixes.

---

## Oracle Independence

> The failure this catches: assertions that read their expected value out of the module under
> test, so the test passes for any implementation.
>
> ⭐ **This phase contains a live instance of exactly that failure.** The A-25 pin at
> `seam-constants.pin.test.ts:713-718` asserts `60_000 >= 60_000 - 30_000` with **both sides
> hand-typed literals** — it stays green while its premise goes false. D-19 makes fixing it
> in-scope. Treat this section as load-bearing, not ceremonial.

- [ ] No test imports a **constant** from the module it tests — expected values are **literals** in the test
- [ ] No assertion compares a value to itself via a re-export, fixture, or table under test
- [ ] Table/registry sizes are pinned to a **literal count**, not to `len(THE_TABLE)`
- [ ] Any fake/double is pinned against the real contract it stands in for (version, key shape, semantics)
- [ ] ⭐ The new A-25 assertion **derives** the longest budget from `SEAM_BUDGETS` and compares it
      to **hand-typed** breaker constants — derivation-vs-hand-typed, never literal-vs-literal
- [ ] The existing literal-vs-literal A-25 assertion is **kept beside** the derived one — it
      catches the constants moving; the derived one catches the coupling breaking. Neither
      implies the other.

*Deliberate self-referential oracles:* the derived-roster invariant reads emitted codes from
disk (that IS the mechanism). It is protected from vacuity by a **site-count floor** and four
SELF-TESTs; both must move with the third `ROUTES` entry or the derivation can silently match
nothing.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (10 items above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] **Every success criterion has a Falsifiability Ledger row**
- [ ] **Every ledger row is `Observed ✅` with pasted evidence, or explicitly marked skipped-with-reason**
- [ ] **Oracle Independence checklist complete**
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
