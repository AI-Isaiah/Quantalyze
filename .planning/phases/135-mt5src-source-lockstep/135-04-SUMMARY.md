---
phase: 135-mt5src-source-lockstep
plan: 04
subsystem: api
tags: [mt5, wizard-errors, key-routes, validate-encrypt, go-dark, fail-closed, nextjs, vitest]

# Dependency graph
requires:
  - phase: 135-01
    provides: "MT5 detail-string contract (MT5_MASTER_PASSWORD_DETAIL / MT5_WRONG_SERVER_DETAIL) + mt5_enabled_server() go-dark gate in closed_sets.py"
  - phase: 135-02
    provides: "TS SUPPORTED_EXCHANGES + EXCHANGE_DISPLAY widened for mt5; isMt5EnabledServer() (strict MT5_ENABLED === 'true')"
  - phase: 135-03
    provides: "worker is_mt5 validate branch that EMITS the three MT5 detail strings the TS classifier maps"
  - phase: 120-sfox-ingestion
    provides: "sfox server-gate + api_secret carve-out template (mirror-imaged for mt5)"
provides:
  - "KEY_MT5_MASTER_PASSWORD + KEY_MT5_WRONG_SERVER — two distinguishable wizard error codes with honest copy + substring matcher branches (classifyKeyValidationError)"
  - "validate-and-encrypt: isMt5EnabledServer() fail-closed server gate + three-credential defense (mt5 requires api_key + api_secret + passphrase; mirror-image of the sfox api_secret relaxation)"
  - "mt5 acceptance across all 3 key routes' tests (create-with-key + composite/add-key auto-accept via widened isSupportedExchange; invalid exchange still 400)"
affects: [138-mt5ui, 139-mt5-golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Substring-based cross-language error mapping: TS classifyKeyValidationError pins the worker's Python detail strings as byte-identical literals (a Python reword reds the TS suite)"
    - "Mirror-image credential contract: sfox RELAXES api_secret, mt5 REQUIRES all three slots — same route, opposite carve-out"
    - "Dual-layer go-dark: TS isMt5EnabledServer() gate fires first (no probe), worker mt5_enabled_server() gate is the authoritative backstop"

key-files:
  created: []
  modified:
    - "src/lib/wizardErrors.ts — KEY_MT5_MASTER_PASSWORD + KEY_MT5_WRONG_SERVER (union + copy + matcher branches)"
    - "src/lib/wizardErrors.test.ts — exact-literal worker-string pins + three-distinguishable-paths + placement + honest-copy tests"
    - "src/app/api/keys/validate-and-encrypt/route.ts — isMt5EnabledServer gate + mt5 three-credential defense + canonical 'mt5' normalization"
    - "src/app/api/keys/validate-and-encrypt/route.test.ts — mt5 gate-off fail-closed + three-cred defense + happy-path forward"
    - "src/app/api/strategies/create-with-key/route.test.ts — mt5 acceptance + api_secret-required + invalid-rejected"
    - "src/app/api/strategies/composite/add-key/route.test.ts — mt5 acceptance + api_secret-required + invalid-rejected"

key-decisions:
  - "Two NEW distinguishable codes (resolved Q-B): master-login and wrong-server are DISTINCT user mistakes from bad creds — collapsing into KEY_AUTH_FAILED would tell the user to fix the wrong thing. Honest copy: the master path never asserts a wrong password (it was correct, just trade-capable)."
  - "Matcher branches inserted AFTER KEY_AUTH_FAILED and BEFORE ip/allow, collision-invariant documented — neither worker string contains any earlier/later branch keyword, so no shadowing either direction."
  - "Server gate added to validate-and-encrypt ONLY (the live-probe route); create-with-key + composite/add-key take ZERO route.ts edits per plan — the worker mt5_enabled_server() gate is the authoritative backstop there."
  - "mt5 asset_class:'crypto' force-derive in create-with-key left UNTOUCHED — the traditional-√252 divergence is explicitly Phase 136 / MT5RECON-02 (with its own mutation test); mt5 ships dark and is not UI-reachable, so fixing it here would be premature scope creep (Rule 3)."

requirements-completed: [MT5SRC-02, MT5SRC-03]

# Metrics
duration: 7min
completed: 2026-07-23
---

# Phase 135 Plan 04: TS route half — distinguishable MT5 wizard error codes + key-route acceptance Summary

**Closed the TS half of the MT5 source seam: two new distinguishable, honestly-worded wizard error codes (`KEY_MT5_MASTER_PASSWORD` / `KEY_MT5_WRONG_SERVER`) mapped from the worker's exact detail strings, a fail-closed `MT5_ENABLED` server gate plus a mirror-image three-credential defense at `validate-and-encrypt`, and mt5 acceptance across all three key routes — invalid exchanges still rejected, the seam still dark.**

## Performance
- **Duration:** ~7 min
- **Started / Completed:** 2026-07-23
- **Tasks:** 2 (Task 1 TDD RED→GREEN, Task 2 route + tests)
- **Files modified:** 6 (0 created)

## Accomplishments
- **Two distinguishable MT5 codes (MT5SRC-02 tail).** Added `KEY_MT5_MASTER_PASSWORD` and `KEY_MT5_WRONG_SERVER` to the `WizardErrorCode` union with a rationale comment, honest/actionable `WIZARD_ERROR_COPY` entries (master → "this login can place trades, reconnect with the read-only investor password", never asserting a wrong password; wrong-server → "copy the exact server name from your MT5 terminal login window"), and two substring matcher branches (`"master password"` / `"broker server"`) inserted after the `KEY_AUTH_FAILED` branch and before ip/allow. The raw worker message is still never returned (H-0305) — only the code.
- **Three distinguishable failure paths pinned.** bad creds → `KEY_AUTH_FAILED`, master login → `KEY_MT5_MASTER_PASSWORD`, wrong server → `KEY_MT5_WRONG_SERVER`. The worker detail strings are pinned as byte-identical literals in the spec (a Python-side reword reds the suite — the cross-language contract).
- **validate-and-encrypt gate + defense (MT5SRC-03).** Imported `isMt5EnabledServer` and added: a STRUCTURAL server gate (fail-closed 400 "MT5 integration is not yet available." BEFORE rate-limit and any worker probe, mirroring the sfox F2 arm); a three-credential defense (mt5 REQUIRES non-blank `api_key` + `api_secret` + `passphrase` — the mirror-image of the sfox `api_secret` relaxation — before any worker call); and canonical lowercase `'mt5'` normalization for mixed-case input.
- **All 3 routes accept mt5.** `create-with-key` and `composite/add-key` auto-accept via the `isSupportedExchange` set widened in 135-02 (ZERO route.ts edits); tests pin mt5 through the `api_secret`-REQUIRED path (no sfox relaxation leak) and that a bogus exchange value still 400s.

## Task Commits
1. **Task 1 (RED):** failing tests for the two MT5 codes — `aae6a1e3` (test)
2. **Task 1 (GREEN):** two distinguishable MT5 wizard error codes — `b250930c` (feat)
3. **Task 2:** mt5 gate + three-credential defense + route acceptance tests — `035c4e42` (feat)

## Deviations from Plan
None — plan executed exactly as written. Rules 1–4 not triggered; no auth gates.

## Out-of-Scope Observation (already tracked, NOT fixed here)
`create-with-key/route.ts` force-derives `asset_class: 'crypto'` unconditionally ("every supported exchange is a crypto venue"), which is now inaccurate for mt5 (forex/CFD = traditional √252). This is **already owned by Phase 136 / MT5RECON-02** (which mandates a mutation test that fails if MT5 gets √365). It was deliberately NOT touched here: mt5 ships dark (MT5_ENABLED off), is not UI-reachable until Phase 138, finalize re-derives, and the plan mandates ZERO create-with-key route edits. Fixing it now would be premature scope creep (Rule 3) and risk the #597 crypto-derive for the real crypto venues.

## Verification
- `npx tsc --noEmit` — exits 0.
- `npm run test` on the touched suites — 181 passed (wizardErrors 64, validate-and-encrypt 44, create-with-key + composite/add-key with the new mt5 cases).
- Regression guard: `closed-sets`, `strategy-sources-migration-parity`, `check-zod-db-check-parity` — 53 passed (135-02 parity intact).
- `npx eslint` on all 6 touched files — clean.
- Gate-off tests assert the worker fetch mock is NEVER called (no live probe while dark).

## TDD Gate Compliance
Task 1 (`tdd="true"`) followed a real RED→GREEN cycle: `aae6a1e3` (test, 7 failing) precedes `b250930c` (feat, all green). Task 2's behavior (the route gate) landed with its pinning tests in one `feat` commit (`035c4e42`); MVP+TDD runtime gate was not active this run, and the route gate's contract (the fail-closed shape) is the sfox precedent cloned verbatim.

## Known Stubs
None. No hardcoded empty values or placeholder copy introduced; both new error-copy entries are complete, honest, and non-placeholder.

## Threat Flags
None. All new surface maps to the plan's threat register: T-135-14 (raw message never returned — H-0305 pinned), T-135-16 (isMt5EnabledServer fail-closed gate), T-135-17 (three-credential presence check). No new network endpoint, auth path, or schema change introduced.

## Self-Check: PASSED
- Modified files verified present on disk (all 6).
- Commits verified in `git log`: `aae6a1e3`, `b250930c`, `035c4e42`.
- `grep -c "KEY_MT5_MASTER_PASSWORD" src/lib/wizardErrors.ts` == 4 (comment + union + copy + matcher); same for `KEY_MT5_WRONG_SERVER`.

---
*Phase: 135-mt5src-source-lockstep*
*Completed: 2026-07-23*
