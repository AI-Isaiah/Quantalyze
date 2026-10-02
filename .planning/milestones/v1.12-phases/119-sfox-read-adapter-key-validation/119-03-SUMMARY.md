---
phase: 119-sfox-read-adapter-key-validation
plan: 03
subsystem: api
tags: [sfox, key-validation, bearer-token, carve-out, security-sensitive, tdd, vitest]

# Dependency graph
requires:
  - phase: 119-01
    provides: sfox in SUPPORTED_EXCHANGES / isSupportedExchange (TS lockstep) + DB exchange-value boundary widened
  - phase: 119-02
    provides: worker validate_key non-ccxt sfox branch (api_secret "" accepted) + AUTH_FAILED -> KEY_AUTH_FAILED contract
provides:
  - "api_secret carve-out at all 3 key routes: sfox admits absent/empty secret, normalized to '' through the shared trim/validate/encrypt chokepoint"
  - "Token-only sfox key flows end-to-end into validateKey/encryptKey with api_secret ''"
  - "Regression fence pinning ccxt (binance/okx/bybit/deribit) secret presence/length rejections byte-identical (T-119-08)"
affects: [phase-120-sfox-reconstruction, phase-122-sfox-wizard-ui, key-connect]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Exchange-specific credential carve-out keyed on a single literal (exchange==='sfox'), normalized to a present-but-empty string so the DoS bound + shared chokepoint stay intact — no parallel code path"
    - "Security-sensitive relaxation is fenced by explicit both-direction regression tests (relaxed exchange admitted; every other exchange pinned to pre-change copy)"

key-files:
  created: []
  modified:
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/api/strategies/composite/add-key/route.ts
    - src/app/api/strategies/composite/add-key/route.test.ts

key-decisions:
  - "Normalize the absent sfox secret to '' via a local apiSecretNormalized const rather than passing undefined — keeps the 512-char max-length bound and the trimCredential funnel byte-identical for ccxt (a no-op there) and safe for sfox"
  - "Carve-out keyed per-file on the file's existing convention: validate-and-encrypt uses raw `exchange === 'sfox'` (no normalization anywhere in that route); create-with-key + composite use `exchange.toLowerCase() === 'sfox'` mirroring their existing `=== 'okx'` branch"
  - "Zero edits to the shared chokepoint (analytics-client.ts) or the shared classifier (wizardErrors.ts) — sfox auth failure surfaces as KEY_AUTH_FAILED purely by reuse (119-02's worker AUTH_FAILED string flows through the existing classifyKeyValidationError branch)"

metrics:
  duration_min: 6
  tasks_completed: 2
  files_changed: 6
  commits: 4
  tests_added: 30
  completed: 2026-07-18
---

# Phase 119 Plan 03: sFOX api_secret Carve-out (SFOX-03) Summary

The Q1 credential carve-out that lets a token-only sFOX key pass all 3 key routes: for `exchange === 'sfox'` ONLY, `api_secret` becomes optional (normalized to `""`) and the Bearer token is stored as `api_key`, routed through the SAME shared trim/validate/encrypt chokepoint — a surgical relaxation that leaves every ccxt exchange's credential validation byte-identical, proven both directions by regression tests.

## What Was Built

**Task 1 — `validate-and-encrypt` presence gate (`:23`)**
The `!exchange || !api_key || !api_secret` gate now reads `!exchange || !api_key || (!isSfox && !api_secret)`. `isSfox = exchange === "sfox"` (this route never normalizes case; the raw exchange is what flows to the worker). A local `api_secret_normalized` coerces an absent sfox secret to `""` and is passed into the existing `legacyValidateAndEncryptHandler` → `validateKey`/`encryptKey` calls untouched. `trimCredential("") === ""` carries the empty secret through the SAME funnel — no parallel path.

**Task 2 — `create-with-key` (`:61`) + `composite/add-key` (`:81`) length gates**
The `typeof api_secret !== "string" || api_secret.length < 8` gate is now guarded by `!isSfox && (...)`, with `isSfox = exchange.toLowerCase() === "sfox"` (mirroring each file's existing `=== "okx"` branch). A local `apiSecretNormalized: string` (`typeof api_secret === "string" ? api_secret : ""`) replaces the three downstream `api_secret` references: the `> 512` max-length bound (so the DoS cap survives for any present sfox secret AND `undefined.length` never throws), and the `validateKey`/`encryptKey` calls. The okx passphrase branches, RPC insert paths, and `api_secret_encrypted ?? null` handling are untouched.

## How It Works (key flow)

- **Admission:** `isSupportedExchange("sfox")` already returns true (119-01), so the `:47/:67` gates admit sfox — the happy-path tests regression-prove the wiring, not just the constant.
- **Shared chokepoint:** sfox `api_secret: ""` → `trimCredential("")` → `""` in both `validateKey` and `encryptKey` (`analytics-client.ts:169`). The tests assert `validateKey`/`encryptKey` were called with `("sfox", token, "", undefined)` in all 3 routes — proving the empty secret rides the SAME funnel.
- **Fail-closed:** a worker `"Authentication failed…"` rejection maps to `KEY_AUTH_FAILED` (create-with-key/composite, via the existing `classifyKeyValidationError`) or the forwarded curated 4xx (validate-and-encrypt) — zero `wizardErrors.ts` edits.
- **Persistence:** `p_exchange: "sfox"` reaches `create_wizard_strategy` / `add_wizard_composite_key` (asserted in tests); the DB CHECK admits it per 119-01.

## Security Posture (T-119-08/09/11)

The relaxation is keyed on the literal `sfox` and nothing else. Regression tests pin, for EVERY ccxt exchange (binance/okx/bybit/deribit):
- absent secret → still rejected byte-identical (`"Missing required fields"` / `KEY_INVALID_FORMAT "api_secret is required"`)
- 7-char (short) secret → still rejected `KEY_INVALID_FORMAT "api_secret is required"`
- empty-string secret → still rejected (carve-out is sfox-only)

And for sfox: absent/`null`/empty secret all normalize identically to `""` and are accepted; a `> 512`-char present secret is still rejected (DoS bound retained); `api_key` presence stays universal (sfox with no `api_key` is rejected).

## Verification

- `npx vitest run` on all 3 route test files, `--no-file-parallelism`: **71 passed** (30 new sfox/regression tests across the 3 files).
- `npx tsc --noEmit`: clean (exit 0).
- `npx eslint` on the 6 touched files: clean (exit 0).
- `git diff` (my 4 commits): touches ONLY the 6 `files_modified` — no `wizardErrors.ts`, no `analytics-client.ts`, no `closed-sets.ts` (the latter is 119-01's, `ca59a0ba`).

## Commits

- `a7b3fccf` test(119-03): failing sfox carve-out tests for validate-and-encrypt (RED)
- `ee1aaf37` feat(119-03): sfox api_secret carve-out at validate-and-encrypt presence gate (GREEN)
- `a80ca76f` test(119-03): failing sfox carve-out tests for create-with-key + composite/add-key (RED)
- `0d303b4a` feat(119-03): sfox api_secret carve-out at create-with-key + composite length gates (GREEN)

## Deviations from Plan

None — plan executed exactly as written. TDD RED/GREEN gate commits present for both tasks. During RED, the ccxt-regression assertions passed (as expected — they pin UNCHANGED behavior); only the sfox assertions failed pre-implementation, which is the intended fail-fast signal for a carve-out that adds new admitted behavior without altering existing rejections.

## Known Stubs

None. No hardcoded empty values, placeholders, or unwired data sources introduced.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries beyond the 119-CONTEXT Q1 carve-out already captured in the plan's threat_model (T-119-08/09/10/11).

## TDD Gate Compliance

Both tasks followed RED → GREEN. Gate sequence in git log: `test(...)` → `feat(...)` for each task. No REFACTOR commit needed (changes were minimal and clean on first GREEN).

## Self-Check: PASSED

All 6 modified source files and the SUMMARY exist on disk; all 4 task commits (a7b3fccf, ee1aaf37, a80ca76f, 0d303b4a) are present in git log.
