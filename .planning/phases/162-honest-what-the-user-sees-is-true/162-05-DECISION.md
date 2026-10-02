# 162-05 Task 1 — Decision record (writer shape)

**Decision: `new-rpc`** — a NEW `create_wizard_strategy_for_key` SECURITY DEFINER function.
`create_wizard_strategy` stays byte-untouched.

Decided 2026-08-26 by the orchestrator under the founder's standing autonomous mandate for
this phase ("take decide 162-05 yourself"), informed by 162-05-DECISION-RESEARCH.md.

## Rationale

1. **The security property is structural, not remembered.** A function whose body contains no
   `api_keys` INSERT cannot re-INSERT one. T-162-05-B ("reuse, never re-INSERT" — the measured
   KEY_ORPHANED unwinnable loop) then holds by construction and the comment-stripped SQL gate
   asserts it as a negative token match. Under `widen-existing` the same guarantee degrades to a
   branch condition inside a live function.
2. **No re-base risk on the live wizard writer.** `widen-existing` requires CREATE OR REPLACE of
   `create_wizard_strategy` re-based across all historical definitions (project rule), with a
   blast radius covering every existing wizard submit. A new function's blast radius is itself.
3. **Layering, not a single gate.** The shape is the layered hybrid the route already uses:
   in-RPC ownership assertion (SQL-gated) + route-level session-uid `.eq(user_id)` on the admin
   client (RED-witnessed) + user-scoped RLS re-read. A wrong route line is caught by the RPC
   assertion; a wrong RPC line by the route filter. No single point of failure.

## Verified before deciding

The defense-in-depth user-scoped re-read is **live, not a dead read**: `id` and `user_id` are in
the `api_keys` column allowlist (`20260410225608_api_keys_column_revoke.sql:79-89`) and
`disconnected_at` was granted by `20260422101911_api_keys_disconnected_at.sql:48`. Had any been
missing, the layer would answer 42501 on every call and the claim would have to be dropped rather
than shipped. This was the research's own falsifier #2 — checked, cleared.

## Known ceiling (accepted, unchanged)

`p_user_id` is a parameter: the RPC verifies the key belongs to that uid, not that the uid is the
real caller. Any server route holding the service key can pass a foreign uid — the standing
ADR-0001/0003 `service_role` ceiling (`create-with-key/route.ts:124-127`), accepted by T-162-05-E.

**Falsifier — what would make this decision wrong:** if that ceiling is ever reclassified from
*accept* to *mitigate* (Phase 163 SEC-03, or a founder ruling), the correct shape flips to an
`authenticated`-EXECUTE function reading `auth.uid()` internally with no `p_user_id` at all —
uniquely feasible for THIS arm because it handles no credentials. The cost is a browser-reachable
writer that bypasses the route's orphan verification and refusal copy, forking the Migration-B
"wizard writers are service-role-only" invariant. Revisit here if SEC-03 lands that way.
