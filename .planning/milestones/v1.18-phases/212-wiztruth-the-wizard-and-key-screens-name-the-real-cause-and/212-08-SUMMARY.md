---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 08
subsystem: dashboard key forms, validate-and-encrypt code channel, roster-render sweep
tags: [wizard, sc3, sc8, red-on-revert, error-envelope, truth-audit]
requires: ["212-04", "212-02"]
provides:
  - "StrategyForm and AllocatorExchangeManager render the validate-and-encrypt !res.ok arm from code, as an ErrorEnvelope, through recogniseValidateAndEncryptCode"
  - "ApiKeyForm optional errorEnvelope prop"
  - "roster-render sweep: validate-and-encrypt is the fifth surface, with a live consumer-reads-code assertion"
affects:
  - src/components/strategy/StrategyForm.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/components/strategy/ApiKeyForm.tsx
  - src/lib/wizardErrors.roster-render.test.tsx
key-files:
  modified:
    - src/components/strategy/StrategyForm.tsx
    - src/components/strategy/StrategyForm.test.tsx
    - src/components/exchanges/AllocatorExchangeManager.tsx
    - src/components/exchanges/AllocatorExchangeManager.test.tsx
    - src/components/strategy/ApiKeyForm.tsx
    - src/components/strategy/ApiKeyForm.test.tsx
    - src/lib/wizardErrors.roster-render.test.tsx
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.invariant.test.ts
    - src/app/api/keys/validate-and-encrypt/route.ts
key-decisions:
  - "The fallback rule lives inline in both forms (about ten lines each) rather than in a new shared helper: the recogniser is the one shared piece the plan locked, and a helper would have been a new module outside files_modified"
  - "codeChannelReads gained a fifth detector (a call to recogniseValidateAndEncryptCode in the response handler), because the consumers read code through the recogniser and never touch .code themselves; the older four detectors stay"
  - "No fixRequires gating: the truth audit found no bullet that is false on these forms; three imprecise-or-unreachable remedies are recorded as findings"
status: complete
commits: 4
plan_head_before: 16bc724e8c6591b76a6c170a075db198393e11ba
plan_head_after: d5e38e8ddb048c6fb02377159b80769085406ce4
actuals:
  tokens: 21000
  tasks: 3
  commits: 4
---

# Phase 212 Plan 08: The dashboard key forms render the validate-and-encrypt code Summary

Both live consumers of `keys/validate-and-encrypt` (`StrategyForm`'s connect-key modal and the allocator Add-key form via `ApiKeyForm`) now classify the `!ok` body through `recogniseValidateAndEncryptCode` and render a `buildEnvelope` envelope in a `mt-4` wrapper. They send a minted `X-Correlation-Id`, never log a body, and the sweep covers the surface with a DOM oracle and a live assertion that both consumers read `code`.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 (tracer) | eac1d0aa2 | fix(212-08): StrategyForm renders the validate-and-encrypt code, not prose |
| 2 | 459b056f0 | fix(212-08): allocator Add-key renders the validate-and-encrypt code |
| 3 (Steps 1-3) | ba0a5c6e7 | test(212-08): the validate-and-encrypt surface joins the roster-render sweep |
| 3 (Steps 4-5) | d5e38e8dd | docs(212-08): validate-and-encrypt docblocks name two code-reading consumers |

The Steps 1-3 commit (the proven sweep) precedes the audit and prose commit, as the plan orders.

## What changed

- `StrategyForm.tsx`: mints `newCorrelationId("key-validate")` before the request and sends `X-Correlation-Id`. The `!res.ok` arm parses with a guarded `res.json().catch(() => PARSE_FAILED)` (a non-JSON body logs `HTTP <status> (<statusText or "no body">)`, never the body), calls `recogniseValidateAndEncryptCode(body, res.status)`, and sets a new `apiEnvelope` state. A recognised code renders `buildEnvelope(code, cid)`. An unrecognised code with a non-empty string `error` renders `{ ...buildEnvelope("UNKNOWN", cid), cause: error }` at any status. Anything else renders the UNKNOWN envelope. Rendered in `<div className="mt-4"><ErrorEnvelope/></div>` where the paragraph sat, with no `onRetry` and no ctx. `apiError` and its paragraph stay for every other message (verified-but-not-saved, network throw).
- `AllocatorExchangeManager.tsx`: the same, in `handleAddKey`. The unguarded `await response.json()` is gone (a thrown parse used to land in the catch and show "Unexpected token ..."). `formEnvelope` state is cleared on submit, on modal close and on Cancel, and is passed as `errorEnvelope`.
- `ApiKeyForm.tsx`: optional `errorEnvelope?: ErrorEnvelope | null` prop in a `mt-4` wrapper, between the read-only hint and `submitBlockedReason`; the string `error` paragraph stays after it.
- `wizardErrors.roster-render.test.tsx`: fifth `SURFACES` entry, `renderValidateAndEncryptRefusal` harness (real `StrategyForm`, real fetch), telemetry oracle skipped for that surface only, seam-hop census row, `[164.2-09]` fifth-surface describe replaced (title and comment say what replaced it), `codeChannelReads` fifth detector with its own self-test, six named status/shape/fallback cases.
- Docblocks: `KNOWN_VALIDATE_AND_ENCRYPT_CODES` ("three components" / "no consumer reads code" rewritten for two consumers reading `code`), two roster row comments, the `KEY_VENUE_ALREADY_CONNECTED` entry comment, the invariant test's roster docblock and its VOCABULARY `guard` string, the roster-render header prose, and the route's comment saying every consumer ignores `code`. No copy-table entry, no `fixRequires`, no `EXPECTED_TABLE_SIZE` pin changed.

## Measured population (SC8 floor)

Fresh measurement with the fifth surface in, derived from disk: total 107 rows (connect-key 43, multi-key-add 37, set-members 4, csv-submit 11, validate-and-encrypt 12). The fifth surface: 8 roster members, 15 route code literals, 12 population rows. `EXPECTED_POPULATION_MIN` is hand-typed at 103; the fifth surface's floors are roster 7, literals 13, population 10.

The fifth surface's 12 rows (wire code to rendered code at the status used): `VALIDATION_FAILED`, `RATE_LIMITED` (429), `CIRCUIT_OPEN` -> `SERVICE_UNAVAILABLE_RETRY`, `UPSTREAM_TIMEOUT` and `UPSTREAM_NETWORK_ERROR` -> `SERVICE_UNREACHABLE`, `SEAM_MISCONFIGURED`, `CSV_RATE_LIMIT` -> `RATE_LIMITED`, `KEY_MISSING_REQUIRED_FIELD`, `KEY_VENUE_NOT_ENABLED`, `KEY_NOT_READ_ONLY`, `STALE_CLIENT`, `KEY_VENUE_ALREADY_CONNECTED`. All rendered as expected on the first run of the harness.

## SC8 RED-on-revert evidence

All proofs: backup `cp`'d to the scratchpad, neutered, observed RED, `cp` back, `cmp` exit 0, rerun GREEN.

1. **Task 1** (`StrategyForm.tsx` `!res.ok` arm neutered to put the body's `error` prose into `apiError`): 9 of 27 failed, 18 passed. RED: cases (a), (b) 424, (b) 429, (c), (d), (e), (f), (g), (h) of the new describe. The pre-existing persist-failure case stayed green under the neuter, as expected (the sentence is findable either way; case (e) is the one that pins the envelope shell). Restored `cmp` 0; 36 passed across the two StrategyForm files.
2. **Task 2** (`AllocatorExchangeManager.tsx` `!ok` arm neutered to `setFormError(result.error ...)`): 6 of 124 failed. RED: 400 KEY_NOT_READ_ONLY envelope, 424 RATE_LIMITED, 429 RATE_LIMITED, non-JSON body renders UNKNOWN, curated-sentence fallback, X-Correlation-Id equals the envelope id. Green under the neuter, correctly: the unchanged verified-but-not-saved string case. Restored `cmp` 0; 294 passed across `src/components/exchanges/` and both ApiKeyForm files.
3. **Task 3 Step 3** (`StrategyForm.tsx` neutered as in 1, sweep run): 19 of 128 failed, 109 passed. RED: the consumer-reads-code case (`each consumer reads the route's code through the recogniser, so the surface is a render row`), all 12 `validate-and-encrypt/*` sweep rows, and the six named extra cases. Restored `cmp` 0; 128 passed. Separately, `AllocatorExchangeManager.tsx` neutered: exactly the consumer-reads-code case went RED (1 of 128). Restored `cmp` 0.

The `ApiKeyForm` `errorEnvelope` slot itself was not separately neutered; its three cases (position, null, string) are exercised by the AllocatorExchangeManager RED above, which removes the envelope from the DOM entirely.

## Truth audit (UI-SPEC SC3)

Read as the two forms show it: no `surface` or `venue` ctx, so surface-gated and venue-gated bullets are suppressed or fail open as measured with `formatKeyError(code)` and no context. No `onRetry`, so no Retry control and no "Try another key" control render. Plan 02's SC1 finding: none owed (the `GATE_SERIES_EXAMINED_REFUSED` bullets were not false, so no finding to apply).

| Code | Bullets shown on the forms | True here? |
|---|---|---|
| `VALIDATION_FAILED` | 1: send the correlation id through the contact form | true |
| `RATE_LIMITED` | 1: wait, then run the same action again | true |
| `SERVICE_UNAVAILABLE_RETRY` (from `CIRCUIT_OPEN`) | 1: wait a moment, try again; 2: contact form after a few minutes | true |
| `SERVICE_UNREACHABLE` (from `UPSTREAM_TIMEOUT`, `UPSTREAM_NETWORK_ERROR`) | bullet 1 ("open /strategies before retrying") is suppressed (`REQUIRES_SUBMIT_SURFACE`); shown: 2 try again, 3 contact form | true |
| `SEAM_MISCONFIGURED` | 1: contact form, a configuration fault is ours; 2: nothing to undo, "the request never left our servers, so no draft, key or strategy changed" | true, with one note: for a bare analytics-service 401/403, "never left our servers" is true only because our analytics service counts as ours and refuses before any venue I/O (plan 04's A1 measurement). No draft exists on either form, and "no draft changed" is vacuously true |
| `KEY_MISSING_REQUIRED_FIELD` | bullets 1 and 2 (fill every field shown for the selected exchange; submit again) shown via `NOT_ON_PRESELECT_SURFACE`; bullets 3 and 4 (preselect-only) suppressed | true |
| `KEY_VENUE_NOT_ENABLED` | 1: connect a key from one of the other exchanges "on this step"; 2: ask us to let you know when it opens | true in substance, see finding F1 |
| `KEY_NOT_READ_ONLY` | 1: check Read-only on the exchange; 2: create a fresh read-only key; 3: paste the key here again | true (the fields are on both forms) |
| `STALE_CLIENT` | 1: reload this page; 2: add the key again on the reloaded page; 3: contact form if a reload does not clear it | true |
| `KEY_VENUE_ALREADY_CONNECTED` | 1: use the key you already have; 2: create a key on a different account; 3: contact form before disconnecting | true on the allocator form, see finding F2 for StrategyForm |
| `KEY_RATE_LIMIT` (only via the recogniser's 424 split) | 1: wait 60 seconds and try again; 2: "try a different exchange account or use the contact form" (the non-substitutable-venue bullet 3 is suppressed) | true for the venues that throttle through this arm, see finding F3 |
| `UNKNOWN` | 1: try the last action again; 2: contact form | true |

**No `fixRequires` gating was made.** No bullet is false on these forms; three are imprecise or unreachable and are recorded as findings, because the existing mechanism cannot express them without a `surface` or `venue` ctx slot, which the plan decided against.

- **F1, `KEY_VENUE_NOT_ENABLED` bullet 1 says "on this step".** Both forms have an Exchange selector, so the remedy exists; "step" is wizard wording. Imprecise, not false. A copy edit is out of scope.
- **F2, `KEY_VENUE_ALREADY_CONNECTED` bullet 1 on `StrategyForm`.** "Use the key you already have" is a remedy with no control on that modal (it has no saved-key picker). The allocator form's key list is the existing key, so it is fine there. Gating it would also remove a true remedy on the allocator form, so it is recorded rather than gated. Owner: whoever next touches `StrategyForm`'s connect modal.
- **F3, `KEY_RATE_LIMIT` bullet 2 fails open with no venue ctx.** For a non-substitutable venue (sFOX on the allocator form when its flag is on), "try a different exchange account" is the unwinnable remedy. The forms know the selected exchange, so passing `venue` would suppress it, but that contradicts this plan's locked "no venue ctx slot" decision and was not folded in. The 424 `RATE_LIMITED` producer is the sFOX and ccxt arms (plan 04's table), so the sFOX case is reachable.

## Deviations from Plan

None in behaviour. Two recorded choices:

- **codeChannelReads gained a recogniser detector.** The plan said "invert `codeChannelReads` so it requires each consumer to read `code`". The consumers read `code` through `recogniseValidateAndEncryptCode` and never touch `.code`, so the four existing detectors returned nothing for the new code and the inverted assertion could not pass. The fifth detector looks for a call to the recogniser in the response handler's window; the consumer assertion requires that hit specifically; a self-test pins that a prose-only reader yields none. This is a test-file change inside `files_modified`.
- **The fallback rule is inline in both forms**, not factored into a helper (see key-decisions).

## Verification

- The plan's seven-file vitest set plus `src/components/exchanges/` and both `ApiKeyForm` files: 14 files, 929 passed.
- `npm run typecheck`: exit 0. `npm run lint`: 0 errors (4 pre-existing warnings, unchanged from plan 04's note).
- Plan 09's census command scoped to the four census-counted files this plan edits: 0 lines.
- No file under `supabase/` changed; `STATE.md`, `ROADMAP.md`, `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` untouched.
- 320px long-text wrapping (the plan's backstop item): not measured here. jsdom has no layout; `ErrorEnvelope`'s markup and classes are unchanged and sit in a `mt-4` block wrapper inside both containers, so wrapping behaviour is the component's existing one. Left for the phase's visual pass.

## For ship (ship owns TODOS.md, CHANGELOG, VERSION)

- Closes `0.013` (WIZFORM-02 section D) and `[WIZFORM-02-VE-CODECHANNEL]`. The `GATED ON WIZFORM-02 CLOSING` marker in the Phase 145 entry `OPTION CSV_FINALIZE_MOVED` opens; update its text at ship, do not pick it up. `164.2-09-SUMMARY.md` is historical and was not edited.
- CHANGELOG themes: behaviour change (the two dashboard key forms show the real cause and a remedy that works on that surface instead of the route's prose), infrastructure/tests (fifth sweep surface, consumer-reads-code assertion), notes (the three findings above are recorded, not fixed).

## Known Stubs

None.

## Threat Flags

None. T-212-10 (body never logged on a parse failure) is pinned by case (f) in `StrategyForm.test.tsx` and the non-JSON case in `AllocatorExchangeManager.test.tsx`, both asserting the body and the typed key never reach `console.error`. T-212-11 (no false remedy on a new surface) is covered by the truth audit above and case (h) (no "Your draft is saved."). T-212-12 holds: the curated sentence is a React text node inside `ErrorEnvelope`.

## Self-Check: PASSED

- FOUND commits (ancestors of HEAD): eac1d0aa2, 459b056f0, ba0a5c6e7, d5e38e8dd.
- FOUND the ten modified source files; `git rev-list --count 16bc724e8..HEAD` was 4 before this summary commit.
