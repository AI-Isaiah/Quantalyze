---
phase: 209-scrubleaks-error-reports-carry-no-raw-database-details-and-n
plan: 04
subsystem: api
tags: [keys, validate-and-encrypt, body-guard, wizard-error-codes, credential-hygiene]

requires: []
provides:
  - "POST /api/keys/validate-and-encrypt answers malformed JSON, a literal null and any non-object JSON value with the coded 400 { code: KEY_MISSING_REQUIRED_FIELD, error: Invalid request body } and no-store, instead of an uncoded 500"
  - "the parse rejection is swallowed: a credential quoted by a V8 SyntaxError reaches no response, log line or capture"
  - "both censuses that count this route's emissions moved on purpose (KEY_MISSING_REQUIRED_FIELD 2 -> 3, expectedSites 12 -> 13)"
affects: [209-05]

status: complete
commits: 2
plan_head_before: dd3baf44ed6beafd56e876ad1eb233fb0e6a739b
plan_head_after: acfea25170e2633b48b5c3587ea4cc3d59270125

actuals:
  tokens: 1900
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "req.json().catch(() => null) plus a typeof-object guard, copied byte-for-byte from the strategies/create-with-key sibling"

key-files:
  created: []
  modified:
    - src/app/api/keys/validate-and-encrypt/route.ts
    - src/app/api/keys/validate-and-encrypt/route.test.ts
    - src/lib/wizardErrors.invariant.test.ts

key-decisions:
  - "D-13: guard copied exactly from create-with-key, no new error code, so the wizard code catalogue does not grow"
  - "D-14: both emission censuses moved with the reason written beside each (route.test.ts 2 -> 3; wizardErrors.invariant expectedSites 12 -> 13; rosterFloor stays 4)"
  - "Pitfall 5: the catch logs and captures nothing; proven by a sentinel test with two independent console oracles"

requirements-completed: [SC4, SC5]
---

# Phase 209 Plan 04: validate-and-encrypt body guard Summary

A malformed, `null` or non-object JSON body on `/api/keys/validate-and-encrypt` now returns the route's own coded 400 (`KEY_MISSING_REQUIRED_FIELD`, `Invalid request body`, `no-store`) before the limiter and the credential probe. Before, the first statement of `POST` awaited `req.json()` bare and `withAuth` has no catch, so the caller got a Next.js default 500 with no machine code. The parse error is swallowed, because a V8 `SyntaxError` message quotes a fragment of a body that carries raw exchange credentials.

## What was built

- `route.ts`: the bare parse became `await req.json().catch(() => null)` plus `if (!body || typeof body !== "object")` returning the coded 400 with `NO_STORE_HEADERS`. A comment names Phase 209 SC4, D-13, the sibling precedent and why the rejection is swallowed.
- `route.test.ts`: `makeRawReq(body: string)` helper; a new `[209 SC4]` describe with malformed JSON and literal `null` cases (status, code, sentence, no-store, no probe, no encrypt, no capture), an `it.each` over `42`, a JSON string and `true`, and a nested describe for the credential sentinel. The `KEY_MISSING_REQUIRED_FIELD` emitter count moved 2 -> 3 with a comment; a one-line comment beside `expect(ARMS.length).toBe(4)` says the guard is pinned in its own describe.
- `wizardErrors.invariant.test.ts`: the `keys/validate-and-encrypt` row `expectedSites` 12 -> 13 with a dated "12 -> 13 (Phase 209 SC4)" paragraph. No other row touched.

## Neuter-to-RED proofs (SC5)

Each: byte backup in the scratchpad, neuter, run, RED, `cp` restore, `cmp` clean, rerun GREEN. Verified with `git status`: `route.ts` unmodified after each restore.

| Proof | Neuter | RED cases |
|---|---|---|
| N1 | Bare `await req.json();` back, no catch, no guard (route.ts) | `[209 SC4] malformed JSON -> 400 ...` and `[209 SC4] a literal null -> 400 ...` (handler rejects); census `KEY_INVALID_FORMAT has NO emitter left on this route` (`expected 2 to be 3`); census `keys/validate-and-encrypt: the site count is THIS ROUTE's hand-typed literal` (`expected 12 to be 13`: the scan finds 12 sites, the literal says 13). 4 failed, 457 passed. |
| N2 | Guard condition reduced to `if (!body) {` (typeof half removed) | `a number -> the same coded 400`, `a JSON string -> the same coded 400`, `a boolean -> the same coded 400`. 3 failed, 112 passed. |
| N3 | Parse catch changed to `.catch((e) => { console.error(e); return null; })` | `answers 400 and the secret reaches no response, log line or capture`: `an Error instance was logged: expected true to be false` (primary oracle). 1 failed, 114 passed. |
| N3b (extra) | Catch changed to `console.error(String(e))` so no Error instance is logged | Same case, secondary oracle: `expected 'SyntaxError: Unexpected token 'S', ...' not to contain 'SECRET-SEN'`. Run separately because the primary oracle throws first under N3 and would otherwise hide whether the secondary one bites. |

The sentinel fixture carries an anti-vacuity case: `JSON.parse` of the constant throws a message matching `SECRET-SEN`.

## Verification

- `npx vitest run src/app/api/keys/validate-and-encrypt src/lib/wizardErrors.invariant.test.ts src/lib/wizardErrors.test.ts`: green (461 tests after Task 1; 115 in the route directory after Task 2).
- Neighbouring guards (`no-store-coverage`, `limiter-ordering`, `seam-log-coverage`, `process-key-thin-adapters`): green, 572 tests with the above.
- Plan quick-run list (21 files): 948 tests passed.
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 7 claims, before any edit.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors, 4 warnings, all in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`).
- Acceptance greps: guard line count 1, coded-body line count 1, `SECRET-SENTINEL-must-not-echo` count 1, the row-scoped `expectedSites: 13,`.

## Deviations from Plan

None - plan executed exactly as written. The one addition is proof N3b, which strengthens SC5 by showing the secondary oracle bites independently.

## Known Stubs

None.

## Threat Flags

None. T-209-10 (parse error disclosure) and T-209-11 (uncoded 500 on a bad body) are both mitigated and each has a RED proof above.

## Self-Check: PASSED

- route.ts, route.test.ts, wizardErrors.invariant.test.ts, this SUMMARY: present.
- Commits `bb5c73187` and `acfea2517` are ancestors of HEAD.
