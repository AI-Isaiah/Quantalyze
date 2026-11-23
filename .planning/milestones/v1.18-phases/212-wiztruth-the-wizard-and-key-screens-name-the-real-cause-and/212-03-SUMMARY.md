---
phase: 212-wiztruth-the-wizard-and-key-screens-name-the-real-cause-and
plan: 03
subsystem: create-with-key route, MT5 venue-identity fence
tags: [wizard, mt5, key-orphaned, sc5, sc8, red-on-revert]
requires: []
provides:
  - "keyOrphanedResponse(): the one builder of the KEY_ORPHANED 409, called by the pre-validation fence and the 23505 arm"
  - "Early orphan arm in the MT5 credential path: KEY_ORPHANED before validateKey and the RPC"
affects: [src/app/api/strategies/create-with-key/route.ts, src/app/api/strategies/create-with-key/route.test.ts]
tech-stack:
  added: []
  patterns: ["one parameterless body builder shared by two emitting arms (venueAlreadyConnectedResponse template)", "dated CORRECTED comment keeping the superseded 161-05 reasoning as lineage"]
key-files:
  created: []
  modified:
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
key-decisions:
  - "Reverses the 161-05 'credentials speak first' order for the MT5 arm only; ccxt, sFOX, 23505 races and reuse_api_key_id are unchanged"
  - "held keeps its latency and is out of scope; unresolved still falls through (a fault never invents a refusal)"
status: complete
commits: 2
plan_head_before: eeadcdd1fde5940b2be98b864cbf2789ee350cd3
plan_head_after: f47445ab2b46d6e9cbb1939fac1e4f64bfe6c1bd
actuals:
  tokens: 4100
  tasks: 2
  commits: 2
---

# Phase 212 Plan 03: Orphaned MT5 key refused before the 120 s validate Summary

An MT5 `create-with-key` request whose login resolves to an orphaned key now answers `409 KEY_ORPHANED` straight from the venue-identity fence, without calling `validateKey` or the RPC, even when the credentials are wrong; both emitting arms share one `keyOrphanedResponse()` body and the KEY_ORPHANED copy is untouched.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 (tracer) | 04268504c | fix(212-03): refuse an orphaned MT5 key before the 120 s validate |
| 2 | f47445ab2 | test(212-03): orphan refusal wins over wrong credentials; ccxt unchanged |

## What changed

- `route.ts`: `keyOrphanedResponse()` (no parameters, so no venue id can enter it) beside `venueAlreadyConnectedResponse`; the 23505 arm's inline body replaced by a call to it (the stored sentence appears once in the file); a new `venueMatch.kind === "orphaned"` return after the `connected` arm and before `validateKey`. `held` and `unresolved` still fall through. The 161-05 comment block is now a dated Phase 212 CORRECTED note: it keeps the old reasoning as lineage, names the arms, and states the truthfulness cost (orphaned key plus wrong password: the orphan is heard first, which is true and discloses nothing because the resolver is scoped by `user.id`).
- `route.test.ts`: three old-order pins inverted and retitled (409, byte-pinned body, `validateKeyMock` and `rpcMock` not called); the wizard-session NEGATIVE CONTROL re-fixtured with a one-shot empty `api_keys` read ahead of the persistent orphan seed, title and DRAFT_ALREADY_EXISTS assertion kept; new wrong-credentials case; new okx case (validates first, RPC called, KEY_ORPHANED through the 23505 arm); a CORRECTED note on the 161-05 describe docblock.

## Observed RED evidence

**Task 1 Step 4a** (route change applied, tests not yet edited), the failing set was exactly the four named titles:

1. an ORPHANED key (no strategy hangs off it) falls through to the RPC rather than inventing a pair
2. an ORPHANED key is still an orphan — 'no strategy at all' must not become a refusal
3. NEGATIVE CONTROL — the wizard-session constraint still answers the fence 409, orphan state or not
4. the PRE-RPC fence lets the orphan through to validate — the credentials speak first

No other test in `route.test.ts` failed (4 failed, 163 passed of 167).

**Task 2 Step 3, SC8 RED-on-revert** (backup `cp`'d to the scratchpad, the new `orphaned` early return deleted, nothing else): 4 failed, 165 passed of 169:

1. an ORPHANED key (no strategy hangs off it) is refused 409 KEY_ORPHANED before validate and the RPC, never paired with an unrelated strategy
2. an ORPHANED key — 'no strategy at all' — is refused 409 KEY_ORPHANED up front, not resumed and not submitted
3. the PRE-RPC fence refuses the orphan BEFORE validate — the refusal does not wait on the credentials
4. the orphan refusal wins even when the credentials are WRONG — validateKey is never called

The re-fixtured NEGATIVE CONTROL stayed green, as predicted (its fence read sees no key). Backup restored, `cmp` exit 0, rerun GREEN (179 passed across both create-with-key files).

## Verification

- `npx vitest run src/app/api/strategies/create-with-key/`: 2 files, 179 passed.
- `npm run typecheck`: exit 0.
- `src/lib/wizardErrors*` tests: 3 files, 460 passed. `wizardErrors.ts` untouched by this plan.
- `grep -c keyOrphanedResponse route.ts` = 3 (definition, fence, 23505 arm); the KEY_ORPHANED sentence count in `route.ts` = 1.
- Plan 09 census command scoped to this plan's files prints 0 lines.
- `verify-plan-anchors.mjs` on this plan: OK, 6 claims.
- No file under `supabase/migrations` changed.

## Deviations from Plan

None - plan executed exactly as written. The "falls through" in the unchanged "OWNER read faulting" case title is accurate and kept.

## Known Stubs

None.

## Threat Flags

None. T-212-04 (disclosure) is mitigated structurally by the parameterless helper and the `user.id`-scoped resolver; T-212-05 (refusal from a fault) is pinned by the unchanged "OWNER read faulting" case.

## Records for ship (ship owns TODOS.md and CHANGELOG)

- Closes TODOS `0.012` (`D-161-05-B`).
- Plan 09 marks `.planning/WINDOWS.md` entry 12 fixed.

## Self-Check: PASSED

- route.ts and route.test.ts modified and present; both commits (04268504c, f47445ab2) are ancestors of HEAD.
