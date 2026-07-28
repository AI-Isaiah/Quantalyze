# Phase 25 Deferred Items

Out-of-scope discoveries / non-blocking findings logged during execution (NOT fixed this phase).

## DI-25-01 — Re-revoke returns 404 instead of an idempotent 200 (WR-04)

**Status:** deferred — non-blocking, NO security impact. Surfaced by the deep code review (WR-04) and re-confirmed by the verifier. NOT fixed.

**Where:** `src/app/api/allocator/scenario/share/revoke/route.ts`.

**Behavior:** `POST /share/revoke` does `UPDATE scenario_shares SET revoked_at = now() WHERE scenario_id = ? AND revoked_at IS NULL`. On the FIRST revoke this matches 1 row → 200; the link stops resolving immediately (SHARE-03 met; SQL test + the resolve→revoke→404 vitest cover it). A SECOND revoke (already-revoked, or a scenario with no active share) matches 0 rows → the route returns 404 "Share not found", so the UI surfaces an error toast on an action that is semantically a no-op.

**Why deferred, not fixed:** SHARE-03 (revoke makes the link stop resolving) is fully met and tested — this is a pure idempotency/UX nit. The clean fix (return 200 when 0 rows AND the share exists+owned-but-already-revoked, while still 404-ing a genuinely non-owned/nonexistent share id to avoid existence disclosure) is more than a one-liner and changes the revoke response contract that `SavedScenariosList`'s revoke handler depends on. Changing a leak-surface-adjacent response contract in an autonomous run without UI re-testing is the kind of scope-expansion CLAUDE.md Rule 2/3 cautions against. Logged for a deliberate follow-up.

**Correct fix (if pursued):** distinguish "already-revoked, owned" (→ idempotent 200) from "not owned / never existed" (→ keep 404), and add a `T_REV_IDEMPOTENT` test. Re-test the SavedScenariosList revoke handler against the new contract.

## Human-validation items (post-deploy only)

See `25-HUMAN-UAT.md` — 3 items (live generate→open→revoke→404; recipient-page visual + no-leak; real-browser clipboard) that require the migration applied to a live DB + a real browser. Validated at /ship + /qa, exactly as Phase 23/24's live items were. Not build-time gaps; automated must-haves are 3/3 verified.

**Planning-doc note only** — `.planning/` is gitignored; no code change for these items.
