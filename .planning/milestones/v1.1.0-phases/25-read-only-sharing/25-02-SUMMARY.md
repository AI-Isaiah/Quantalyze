---
phase: 25-read-only-sharing
plan: 02
subsystem: scenario-sharing
tags: [crypto, security, share-token, leaf-primitive]
requires: []
provides:
  - "mintShareToken() — 256-bit base64url raw token + its sha256 hex hash"
  - "hashShareToken(raw) — the single sha256 digest source-of-truth the generate route stores and the public page passes to get_shared_scenario(p_token_hash)"
affects:
  - "Plan 25-03 generate/revoke routes (store hashShareToken result as token_hash)"
  - "Plan 25-04 public recipient page (passes hashShareToken(token) as p_token_hash)"
  - "Plan 25-01 get_shared_scenario(p_token_hash) RPC — matches this exact digest"
tech-stack:
  added: []      # Node built-in crypto only — no package installs
  patterns:
    - "random+stored-hash opaque token (revocable), adapted from demo-pdf-token.ts's keyed-HMAC model with the SECRET_ENV dependency removed"
    - "hash-in-Node single-source-of-truth digest aligned with the SQL RPC predicate (pgcrypto digest not enabled in any migration)"
key-files:
  created:
    - src/lib/scenario-share-token.ts
    - src/lib/scenario-share-token.test.ts
  modified: []
decisions:
  - "256-bit randomBytes(32) -> base64url (43 chars) clears the >=128-bit unguessability bar; entropy is CSPRNG, not a keyed MAC, so the module reads NO env secret (distinct from demo-pdf-token.ts:20)."
  - "hashShareToken is the ONLY place the sha256 algorithm is defined for the share path; the route stores it and the page passes it to the RPC, so all three sides cannot drift. Pinned with known sha256 vectors so an accidental algorithm change fails CI loudly."
  - "Random+stored-hash (not stateless HMAC) is the load-bearing choice for SHARE-03 revocation: only a stored row can be marked revoked_at."
metrics:
  duration: ~4 min
  completed: 2026-06-22
  tasks: 1
  files: 2
  commits: 3
---

# Phase 25 Plan 02: Scenario Share Token Primitive Summary

A dependency-light token leaf — `mintShareToken()` returns a 256-bit `randomBytes` base64url raw token plus its sha256 hex hash, and `hashShareToken(raw)` is the single deterministic digest source-of-truth that the generate route stores as `scenario_shares.token_hash` and the public page passes to the `get_shared_scenario(p_token_hash)` RPC. The raw token lives only in the URL; only its hash is ever persisted.

## What Was Built

- `src/lib/scenario-share-token.ts` — two pure exports, Node `crypto` only:
  - `mintShareToken(): { raw, hash }` — `raw = randomBytes(32).toString("base64url")` (256-bit, 43 chars, URL-safe, no padding); `hash = hashShareToken(raw)`.
  - `hashShareToken(raw): string` — `createHash("sha256").update(raw).digest("hex")` (64-char lowercase hex).
  - Header comment names `get_shared_scenario(p_token_hash)` as the matching digest consumer and documents the no-env-secret / revocable-by-hash rationale.
- `src/lib/scenario-share-token.test.ts` — 6 unit tests pinning: 32-byte base64url entropy (43 chars), `hash === hashShareToken(raw)` + `raw !== hash`, randomness across 50 calls, 64-char lowercase sha256 hex format, hash determinism, and two known sha256 vectors (`sha256("scenario-share")`, `sha256("a")`) so the exact RPC-aligned algorithm is locked.

## TDD Gate Compliance

Plan task is `tdd="true"`. Gate sequence satisfied in git log:

1. RED — `0fdb2135` `test(25-02): ...` — test authored, run, confirmed failing (module did not exist → import error, "no tests" ran).
2. GREEN — `48fa782c` `feat(25-02): ...` — minimal implementation, all 6 tests pass.
3. REFACTOR — none needed; the implementation is already minimal (the header comment is intrinsic documentation of the cross-wire contract, not cleanup).

No test passed unexpectedly during RED (the feature did not previously exist).

## Verification

- `npx vitest run src/lib/scenario-share-token.test.ts` → 6 passed (1 file). < 1s, no DB.
- Acceptance criteria checks:
  - No `process.env` / `SECRET` / `createHmac` in the module (`grep` → NONE).
  - RPC `get_shared_scenario(p_token_hash)` named in the header (lines 8, 18, 41).
  - `npx tsc --noEmit` → no scenario-share-token type errors.
  - `npx eslint` on both files → clean.

## Threat Model Coverage

| Threat ID | Disposition | How addressed |
|-----------|-------------|---------------|
| T-25-06 (token guessing/enumeration) | mitigate | 256-bit `randomBytes(32)` CSPRNG token; proven by the `Buffer.from(raw,"base64url").length === 32` entropy test. |
| T-25-07 (raw token persisted at rest) | mitigate | Only `sha256(raw)` hex is returned for storage; `raw !== hash` test pins this; the route (25-03) stores `hash`, never `raw`. |
| T-25-SC (package installs) | accept | No installs — Node built-in `crypto` only. No legitimacy checkpoint required. |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This is a complete, fully-wired pure primitive; Wave-2 plans (25-03 route, 25-04 page) consume both exports.

## Self-Check: PASSED

- FOUND: src/lib/scenario-share-token.ts
- FOUND: src/lib/scenario-share-token.test.ts
- FOUND commit: 0fdb2135 (RED)
- FOUND commit: 48fa782c (GREEN)
