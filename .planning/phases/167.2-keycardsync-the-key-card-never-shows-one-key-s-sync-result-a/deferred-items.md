# Phase 167.2 — deferred items (out of scope for the plan that found them)

## Found during 167.2-07 (2026-09-24)

- **The discovery-detail fallback still says "still computing".**
  `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` renders
  "The detailed factsheet for this strategy is still computing." on its own
  payload-pending fallback. That is the same claim KCS-10 removed from the
  factsheet v2 placeholder, and it is false for a failed or never-started
  strategy. It is outside plan 07's `files_modified` and outside the UI-SPEC
  surface map (S1 to S9), so it was not touched. Whoever owns it next should
  decide whether it is a user-facing defect that earns a phase or a fix inside
  a later 167.2 plan.

## Found during 167.2-06 (2026-09-24)

- **The locked KCS23-COMPOSITE line can be false on an owner with keys outside
  the composite.** The line says "This composite strategy reads from every key
  below", but `ApiKeyManager`'s `loadKeys` lists EVERY `api_keys` row the owner
  can read (`from("api_keys").select(API_KEY_USER_COLUMNS).order(...)`, no
  strategy filter; RLS scopes it to the owner only), not the composite's
  `strategy_keys` members. So an owner with, say, five keys and a two-key
  composite is told the composite reads from all five. This predates the phase
  (the card has always listed all of the owner's keys) and the string is locked
  in `167.2-UI-SPEC.md` § KCS-23, so plan 06 shipped it verbatim rather than
  re-word a locked string. It is user-facing copy, so it needs a decision: either
  the UI-SPEC re-words the line so it is true of the list as rendered (for
  example "reads from its member keys; ..."), or the composite card filters the
  list to `strategy_keys` members (a client read the RLS policy
  `strategy_keys_owner` already permits, no migration). Routed to the phase's
  review / verifier for that call.
