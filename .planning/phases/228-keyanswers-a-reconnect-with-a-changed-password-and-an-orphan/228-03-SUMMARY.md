---
phase: 228-keyanswers-a-reconnect-with-a-changed-password-and-an-orphan
plan: 03
subsystem: create-with-key route / MT5 rotate leg
tags: [CONN-02, CONN-04, mt5, rotate-in-place]
requirements: [CONN-02, CONN-04]
status: complete
key-files:
  modified:
    - src/app/api/strategies/create-with-key/route.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/lib/wizardErrors.invariant.test.ts
actuals:
  tasks: 3
  commits: 4
commits: 4
plan_head_before: 1c38664601d69ead6781d95251b608e7be732f7a
plan_head_after: 719fb392a580ab8435c2cbb532d0f0b11bd2ff24
---

# Phase 228 Plan 03: a reconnect with a new MT5 password rotates the working holder in place

An MT5 reconnect that the pre-validation fence resolves to the caller's own WORKING holder on the EXACT stored server is now validated by the rotate seam with the typed password (instead of `validateKey`) and rewritten in place through the shared owner-scoped persist; the answer is the arm's existing 409 plus `key_secret: { outcome, name? }`. KEY_ORPHANED names the caller's own key identically for every role, and no `profiles` row is read.

## Commits

- `56e5660c5` feat: Task 1 tracer (rotate verdict member, leg, builders, harness, three [228] tests)
- `0b5471734` docs: partial summary (replaced by this file)
- `625f2f74e` test: Task 2 (all arms, unchanged, faults, O1/O3/O4, reversed D-01 test, wizardErrors note)
- `719fb392a` feat: Task 3 (SC-2 role parity, CORRECTED comment notes)

## Final rotating-arm set

`connected`, `orphaned`, working `held` and another session's `draft`, only when the resolver picked the caller's own working holder (`isWorkingHolder`) AND `picked.venue_server !== null && picked.venue_server === venueServer`. Never rotated, answering exactly as before: null-server legacy tier, different-server holder, a failing holder (with or without a composite dependent), the post-validation resolve, the 23505 race arm, the same-session draft (F6 answers first).

## Pre-rewrite red list (RESEARCH Pitfall 8 measurement)

Measured by temporarily seeding the harness's re-read double with a row (and the seam double returning nothing), then running the whole `route.test.ts`: exactly ONE pre-existing test entered the rotate leg and went red:

- `a WORKING same-login same-server key whose strategy is past draft is refused by name BEFORE validateKey, exactly as before (D-01)` (the only exact-server working-holder seed in the file). Rewritten, not deleted, to `... now ROTATES in place BEFORE validateKey: the D-01 refusal body plus key_secret (Phase 228 reverses 212-03 SC5)`: seeds the re-read and the seam, asserts 409, `code` unchanged, `key_secret`, the seam called once, `validateKey` and the RPC not called.

The other Pitfall 8 tests (225-05 draft, 212-03 orphan, 161-05 orphan ordering, the KEY_ORPHANED holder tests 1b to 1d) seed the legacy `{ id }` row with a NULL `venue_server`, so under the exact-tier rule they never enter the leg and stay green unchanged: they are the O1 null-server behaviour under their original names. `a WORKING same-login key whose server is NULL ...` was renamed to say it is the O1 NEGATIVE CONTROL and gained a `rotateKeySecretMock` not-called assertion. No red outside the Pitfall 8 list. The throwaway seeding was reverted from a byte backup before any edit.

The [225-07] describe now resets the rotate doubles in its `beforeEach` and `afterEach` (`resetRotateDoubles`), because the reversed test seeds them and a later describe must see "no key found".

## Tests added (Task 2 and 3)

Inside `describe("[228] CONN-02 ...")`: orphaned, working held and other-session draft rotate; `unchanged` (zero UPDATEs, zero audits); absent `secret_changed` writes once; blank, whitespace-only and padded label (`it.each`); O4 (updated then unchanged, one UPDATE); O3 `it.each` (auth failed to KEY_AUTH_FAILED, master password to KEY_MT5_MASTER_PASSWORD, wrong server to KEY_MT5_WRONG_SERVER, all 400, all in `KNOWN_CREATE_WITH_KEY_CODES`, no `key_secret`, zero UPDATEs and audits; expectations hand-typed from `classifyKeyValidationError`); write faults (update error, zero rows) answer UNKNOWN 500; missing service credential answers 503 SEAM_MISCONFIGURED with the seam uncalled (the credential is flipped off after the resolver's admin read so only the leg's own `createAdminClient()` throws); re-read error answers the 503 holder-read body; re-read no row answers today's refusal; O1 null-server and different-server; WR-06 byte-identical; failing holder with no dependent still swaps; post-validation resolve; 23505 race arm; `checkLimit` called once; the NO-ARM-ECHOES case for the `updated` and `unchanged` responses (a separate `it` inside [228], because the pre-existing NO-ARM-ECHOES test seeds null-server rows that never rotate); SC-2 role-parity `it.each` (refusal and rotate paths, three roles, byte-equal bodies naming the key, `profilesReads` empty) and the holder-read-fault case (no `holder`).

## wizardErrors.invariant.test.ts (Task 2 step 3): the measured move is 0, not 2

The plan expected create-with-key `expectedSites` 14 to 16. Measured: green at 14 with both new literals present. Cause: the create-with-key row's `statusRe` is `"400"` ON PURPOSE (the row's own docblock: it does not derive 409, 500 or 503 answers), and the two new emitters answer 503 (`SEAM_MISCONFIGURED`) and 500 (`UNKNOWN`), so neither is inside the predicate. The four 409 builders gained an `extra` spread, not a new site. `expectedSites` was left at 14 and a dated "14 STAYS AT Phase 228" comment records the measurement; no floor or `EMITTER_BODY_MAX_CHARS` was touched.

## Verification

- `route.test.ts`: 258 passed (258). Pre-rewrite red list above.
- Census set from the Task 3 verify command (18 files: route, route.audit, route.bare-401, seam-budgets, resilient-fetch.wiring, seam-log-coverage, seam-ratelimit-posture, seam-citations, seam-terminal-arm, seam-retry-registry, dialog-envelope, wizardErrors.invariant, wizardKeyRosters, seam-wire-vocabulary, limiter-ordering, audit-coverage, no-store-coverage, phase-156-wizard-rpc-writer-guard): 18 files passed, 765 tests passed.
- Task 2 verify set (route, wizardErrors.invariant, wizardKeyRosters, roster-render, seam-wire-vocabulary): 226 passed on the four non-route files plus route green.
- `npx tsc --noEmit`: 0 `error TS`. eslint on route.ts, route.test.ts and wizardErrors.invariant.test.ts: clean.
- `route.audit.test.ts` and `route.bare-401.test.ts` needed NO mock-factory edit.
- Acceptance greps: `CORRECTED 2026-11-26 (Phase 228)` in route.ts = 6 (three builders, two fence notes, one allowlist note), `"profiles"` in route.test.ts present, non-comment `from("profiles")` in route.ts = 0.
- `maxDuration` docblock re-checked: the leg spends one `keys-rotate-secret` budget in place of validate and encrypt, so "at most two seam budgets" still holds. Not changed.
- The builders' "IT TAKES NO PARAMETERS / NO IDENTITY PARAMETER" docblocks now carry a dated CORRECTED note above the old sentence (kept as lineage).

## PROOF-01 transcripts

Each neuter: byte copy of the target to the scratchpad `p228b/ex03/`, neuter, RED run naming the test, `cp` back, `cmp`, GREEN run (the whole `route.test.ts`, 255 tests at Task 2 and 258 at Task 3, GREEN in every transcript below after the restore). Test and `Tests` lines are verbatim from the run (long lines cut at 230 characters).

### Neuter (a): route.ts: the rotate leg returns the refusal without calling the seam

Named test(s) that went RED: the four arm tests (connected, orphaned, held, draft) plus the reversed D-01 test.

```
=== NEUTER a: RED run ===
       × a WORKING same-login same-server key whose strategy is past draft now ROTATES in place BEFORE validateKey: the D-01 refusal body plus key_secret (Phase 228 reverses 212-03 SC5) 3ms
       × a connected exact-server holder rotates the working holder in place, owner-scoped, and names the key 3ms
       × sends the rotate seam exactly the session user's id 1ms
         × an exact-server ORPHANED key rotates and answers KEY_ORPHANED naming the key, plus key_secret 2ms
         × a working HELD key (composite member) rotates and answers KEY_VENUE_ALREADY_CONNECTED plus key_secret 1ms
         × another session's DRAFT on the exact server rotates and answers VENUE_DRAFT_IN_PROGRESS plus key_secret 1ms
         × secret_changed false writes nothing and answers unchanged (zero UPDATEs, zero audits) 1ms
         × an ABSENT secret_changed (an older Python) still writes once and answers updated 1ms
         × a blank key label: name is  1ms
         × a whitespace-only key label: name is     1ms
         × a padded key label: name is   Gold   1ms
         × O4: running the arm twice with the same new password writes once (updated, then unchanged) 1ms
         × auth failed 1ms
         × master password 1ms
         × wrong server 1ms
         × an UPDATE error answers UNKNOWN 500 with no key_secret 1ms
         × zero matched rows answers UNKNOWN 500 with no key_secret 1ms
       × ⛔ NO ARM EVER ECHOES THE LOGIN BACK TO THE BROWSER: the updated and unchanged rotate responses carry no identity, password, ciphertext or key id 1ms
⎯⎯⎯⎯⎯⎯ Failed Tests 18 ⎯⎯⎯⎯⎯⎯⎯
      Tests  18 failed | 237 passed (255)
cmp: identical (restored)
=== a: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (b): route.ts: the `picked.venue_server !== null` half of the exact-tier test dropped (null now matches)

Named test(s) that went RED: `O1: a NULL-server holder answers today's refusal (no key_secret, zero seam calls)`.

```
=== NEUTER b: RED run ===
         × O1: a NULL-server holder answers today's refusal (no key_secret, zero seam calls) 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 254 passed (255)
cmp: identical (restored)
=== b: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (c): route.ts: `rotate` set on the dependent-`held` return too

Named test(s) that went RED: `WR-06 (Pitfall 2): a failing holder with a composite dependent ...`.

```
=== NEUTER c: RED run ===
         × WR-06 (Pitfall 2): a failing holder with a composite dependent answers byte-identical KEY_VENUE_ALREADY_CONNECTED, zero seam calls 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 254 passed (255)
cmp: identical (restored)
=== c: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (d): route.ts: `secret_changed` ignored (always persist)

Named test(s) that went RED: the unchanged test, the O4 test, the extended NO-ARM-ECHOES test.

```
=== NEUTER d: RED run ===
         × secret_changed false writes nothing and answers unchanged (zero UPDATEs, zero audits) 4ms
         × O4: running the arm twice with the same new password writes once (updated, then unchanged) 2ms
       × ⛔ NO ARM EVER ECHOES THE LOGIN BACK TO THE BROWSER: the updated and unchanged rotate responses carry no identity, password, ciphertext or key id 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
      Tests  3 failed | 252 passed (255)
cmp: identical (restored)
=== d: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (e): route.ts: the seam call wrapped in a `.catch` that swallows and persists anyway

Named test(s) that went RED: the three O3 cases (auth failed, master password, wrong server).

```
=== NEUTER e: RED run ===
         × auth failed 3ms
         × master password 1ms
         × wrong server 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯
      Tests  3 failed | 252 passed (255)
cmp: identical (restored)
=== e: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (f): route.ts: `write_failed` mapped to the `updated` answer

Named test(s) that went RED: `an UPDATE error answers UNKNOWN 500 with no key_secret`.

```
=== NEUTER f: RED run ===
         × an UPDATE error answers UNKNOWN 500 with no key_secret 3ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 254 passed (255)
cmp: identical (restored)
=== f: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (g): src/lib/api/rotate-key-secret.ts: `.eq("user_id", userId)` deleted from the persist UPDATE

Named test(s) that went RED: `a connected exact-server holder rotates ... owner-scoped` (the `adminUpdates[0].eqs` assertion).

```
=== NEUTER g: RED run ===
       × a connected exact-server holder rotates the working holder in place, owner-scoped, and names the key 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 254 passed (255)
cmp: identical (restored)
=== g: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (h1): route.ts: the rotate leg re-read `.eq("user_id", user.id)` deleted

Named test(s) that went RED: `re-reads the holder owner-scoped: filters exactly id, user_id, exchange mt5 and live`.

```
=== NEUTER h1: RED run ===
       × re-reads the holder owner-scoped: filters exactly id, user_id, exchange mt5 and live 4ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 254 passed (255)
cmp: identical (restored)
=== h1: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (h2): route.ts: the rotate leg re-read `.eq("exchange", "mt5")` deleted

Named test(s) that went RED: `re-reads the holder owner-scoped: ...` (venue filter).

```
=== NEUTER h2: RED run ===
       × re-reads the holder owner-scoped: filters exactly id, user_id, exchange mt5 and live 5ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 254 passed (255)
cmp: identical (restored)
=== h2: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (h3): route.ts: `userId: rotate.rotate.keyId` sent to `rotateKeySecret` in place of `user.id`

Named test(s) that went RED: `sends the rotate seam exactly the session user's id`.

```
=== NEUTER h3: RED run ===
       × sends the rotate seam exactly the session user's id 5ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 254 passed (255)
cmp: identical (restored)
=== h3: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (h4): route.ts: the `userId` property removed from the `rotateKeySecret` argument

Named test(s) that went RED: `sends the rotate seam exactly the session user's id`.

```
=== NEUTER h4: RED run ===
       × sends the rotate seam exactly the session user's id 5ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 254 passed (255)
cmp: identical (restored)
=== h4: GREEN run ===
      Tests  255 passed (255)
```

### Neuter (i1): route.ts: fence `keyOrphanedResponse(venueMatch.holder)` changed to `keyOrphanedResponse()` (refusal path)

Named test(s) that went RED: `refusal path: allocator, manager and both get byte-equal KEY_ORPHANED bodies naming the key ...` (plus pre-existing 1b).

```
=== NEUTER i: RED run ===
       × 1b. a same-owner key with NO strategy answers KEY_ORPHANED naming that key (nickname, date added, link) and never another owner's key on the same id 5ms
         × refusal path: allocator, manager and both get byte-equal KEY_ORPHANED bodies naming the key, and `profiles` is never read 1ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
      Tests  2 failed | 256 passed (258)
cmp: identical (restored)
=== i: GREEN run ===
      Tests  258 passed (258)
```

### Neuter (i2): route.ts: the rotate leg's orphaned call drops the holder (`keyOrphanedResponse(undefined, outcome)`)

Named test(s) that went RED: `rotate path: allocator, manager and both get byte-equal KEY_ORPHANED bodies ...`.

```
=== NEUTER i2: RED run ===
         × rotate path: allocator, manager and both get byte-equal KEY_ORPHANED bodies naming the key, and `profiles` is never read 2ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 257 passed (258)
cmp: identical (restored)
=== i2: GREEN run ===
      Tests  258 passed (258)
```

### Neuter (ii): route.ts: a `profiles` role read added before the fence

Named test(s) that went RED: both SC-2 `it.each` cases (`profiles` is never read), plus the resolver read-set test `5.`; the other reds in that run are tests whose `profiles` read hit the default `draftLookupMock` double, a side effect of the neuter, not a separate finding.

```
=== NEUTER ii: RED run ===
       × a live key with no strategy and no composite membership answers KEY_ORPHANED, and no poll-written table is read 4ms
       × 5. the resolver's read set is still api_keys, strategies and strategy_keys only: no allocator table enters it 1ms
         × refusal path: allocator, manager and both get byte-equal KEY_ORPHANED bodies naming the key, and `profiles` is never read 2ms
         × rotate path: allocator, manager and both get byte-equal KEY_ORPHANED bodies naming the key, and `profiles` is never read 1ms
     × POSITIVE: an UNCLASSIFIED throw IS captured, with this route's tags 5ms
     × M78b GUARD: the RAW per-request api_key / api_secret / passphrase never reach Sentry — and ECONNREFUSED survives 5ms
     × POSITIVE: an encrypt 2xx with no api_key_encrypted IS captured as a CONTRACT violation 4ms
     × POSITIVE: an UNRECOGNISED RPC failure IS captured (23505 / 42501 are recognised and are not) 4ms
     × POSITIVE: an RPC that SUCCEEDS with no usable row IS captured as a CONTRACT violation 4ms
     × NEGATIVE: a breaker short-circuit is NEVER captured — and the breaker cell is UNDISTURBED 4ms
     × NEGATIVE: a classified CALLER FAULT is never captured (a wrong secret is not our defect) 4ms
     × NEGATIVE: a classified upstream TIMEOUT is never captured (60s cold starts are documented as normal) 4ms
     × NEGATIVE: a duplicate-draft 409 and a permission-denied 403 are recognised RPC outcomes, not faults 4ms
     × [153.7-03] MT5_GATEWAY_UNREACHABLE renders SERVICE_UNREACHABLE/503, and is NOT captured as unclassified 4ms
     × [WR-02] an INTERNAL seam fault renders SEAM_INTERNAL_FAULT/500 AND IS STILL captured — it is our defect 4ms
     × [164.6.5 WR-06] a wedged MT5 terminal renders KEY_MT5_TERMINAL_UNRESPONSIVE/500 AND IS captured — it is our terminal 4ms
     × [164.6.6.3.2 D-07] an unconfigured validation gateway renders KEY_MT5_VALIDATION_UNCONFIGURED/500 AND IS captured 4ms
     × [164.6.6.3.2 D-02] a busy MT5 terminal renders KEY_MT5_TERMINAL_BUSY/424 and is NOT captured 4ms
     × [225] a login-stage MT5 -6 renders KEY_MT5_SIGN_IN_REFUSED/424, not UNKNOWN, and is NOT captured 4ms
     × [218] a not-ready MT5 terminal renders KEY_MT5_TERMINAL_NOT_READY/424 and is NOT captured 11ms
     × [create-with-key] a seam 503 carrying a wait relays that exact value 1ms
     × [create-with-key] a seam 503 with NO advertised wait sends NO header (TRAP-3) 1ms
     × [create-with-key] a zero wait is not a wait — it is omitted, never stamped 1ms
     × [create-with-key] a FRACTIONAL wait is not a delta-seconds — it is omitted, never relayed 1ms
     × [create-with-key] a ZERO breaker cooldown sends NO header — the absence rule binds both branches 1ms
     × [create-with-key] ANTI-CONTROL: a real positive breaker cooldown still stamps 1ms
⎯⎯⎯⎯⎯⎯ Failed Tests 26 ⎯⎯⎯⎯⎯⎯⎯
      Tests  26 failed | 232 passed (258)
cmp: identical (restored)
=== ii: GREEN run ===
      Tests  258 passed (258)
```

Acceptance grep for (ii): `grep -a -v '^\s*//' route.ts | grep -a -v '^\s*\*' | grep -a -c 'from("profiles")'` printed `1` with the neuter applied and `0` after the byte restore (`cmp` identical).


## Deviations from Plan

1. [Finding, not a code deviation] `wizardErrors.invariant.test.ts` `expectedSites` did not move (plan expected 14 to 16). The plan said to stop and record when the move is not exactly 2; the measured cause (the row's `statusRe` is 400 only) is recorded above and in the file, and the number was not forced.
2. [Finding] Only one pre-existing test (D-01) went red under the ruling, not the several the Pitfall 8 list implied, because the others seed null-server legacy rows (see the pre-rewrite red list). The null-server wildcard test became the O1 negative control as planned.
3. [Rule 3 - test hygiene] The [225-07] describe gained `resetRotateDoubles` in `beforeEach` and `afterEach` so the reversed test's seeding cannot leak into later describes.
4. The NO-ARM-ECHOES extension is a separate `it` inside [228] rather than an edit to the pre-existing test, for the reason given above.

No Rule 4 item. No auth gate.

## Known limits (recorded, not fixed; for the ship's CHANGELOG `### Notes`)

- A sync that started with the old password can mark the key failed after the rotate's `sync_status: idle`; the next sync clears it (Phase 225-21 owns the poll writers).
- The founder ruling reverses 212-03 SC5 for MT5: the up-to-120 s validation returns on the exact-server arms.
- The `updated` answer is HTTP 409; monitoring that counts 409s as user-fault refusals will count password updates.
- The rotate persist resets `history_inclusion` to null as every rotate-secret success does.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the rotate leg, already in the plan's threat model (T-228-10 to T-228-17).

## Self-Check: PASSED

- Files: route.ts, route.test.ts, wizardErrors.invariant.test.ts exist and are committed.
- Commits 56e5660c5, 625f2f74e and 719fb392a are ancestors of HEAD.
