# 162-05 Decision Research — Shape of the use-existing-key service-role writer

Question: for the reuse arm (POST `create-with-key` with `reuse_api_key_id`), which writer shape
makes cross-tenant reuse impossible **by construction** rather than by remembering a check?
Shapes weighed: (A) SECURITY DEFINER RPC with in-function ownership filter; (B) user-scoped
client (anon key + caller JWT), RLS enforces; (C) service-role client + TypeScript pre-check;
(D) hybrid.

## 1. What the codebase already does

The existing writer (`create_wizard_strategy` via `create-with-key`) is a **layered hybrid (D)**,
not a pure (A), (B) or (C):

- **Route-level ownership filter on the admin client.** `resolveByVenueIdentity` selects the live
  key with `.eq("user_id", userId)` on `createAdminClient()` (`src/app/api/strategies/create-with-key/route.ts:210-217`),
  and the docblock declares it load-bearing verbatim: "`.eq("user_id", …)` — the admin client
  BYPASSES RLS, so tenant scoping here IS this filter and nothing else. The value comes from
  `withAuth`'s server-side session and never from the request body" (`route.ts:129-132`).
- **User-scoped RLS reads as defense-in-depth where grants allow.** The strategy reads go "BACK
  ONTO THE USER-SCOPED CLIENT, DELIBERATELY … routing it through RLS means the row we hand back is
  provably the caller's own even if the owner filter above were ever weakened" (`route.ts:248-252`,
  reads at `:271-280` and `:311-318`).
- **The write itself is a SECURITY DEFINER RPC callable only by service_role.** `rpcAdmin.rpc("create_wizard_strategy", { p_user_id: user.id, … })`
  (`route.ts:881-882`), created with the fail-LOUD posture — a missing service-role credential
  refuses the submit with 503, nothing written (`route.ts:851-869`). The RPC is `SECURITY DEFINER
  SET search_path = public, pg_catalog` with an in-body `auth.role()` gate (`supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql:167-168, :207`;
  the durable REVOKE-ALL-then-GRANT-service_role idiom at `:106-107`; "never current_user /
  session_user" inside a DEFINER body at `:201-205`). Migration A (`20260813150106`) admitted
  service_role; Migration B withdrew `authenticated`'s EXECUTE, so "a direct PostgREST call answers
  42501 and mints nothing. This route is now the only POSSIBLE writer" (`route.ts:116-123`).

**Why pure (B) was already rejected for this flow, structurally:** `api_keys` SELECT was revoked
from `authenticated` and granted back a named column list; Postgres requires SELECT privilege on
every column a query *references* (WHERE included), so the venue-identity read "is IMPOSSIBLE on
the user-scoped client. It would not degrade: it would answer 42501 on every single call"
(`route.ts:100-107`). And after Migration B, a user-JWT client cannot EXECUTE the wizard writer at
all — by design.

**ADRs.** ADR-0001 mandates: RLS is the primary authorization layer, and "Every
`createAdminClient()` call site is an RLS bypass. Each must carry a manual ownership or
authorization check" (`docs/architecture/adr-0001-rls-primary-authorization.md`, Decision §
"Admin-client paths"). ADR-0003 defines the three clients and requires every admin-client call
site to fit one of four categories — (a) service-to-service, (b) column-grant-gated reads,
(c) cross-tenant admin tools, (d) audit writes — "Any new `createAdminClient()` usage that does
not fit these categories requires a new ADR or an amendment"
(`docs/architecture/adr-0003-three-client-supabase.md`, Decision § "Admin client usage
categories"). The reuse arm rides the SAME call sites the route already holds (category (b)-style
column-grant read + the sanctioned RPC writer), so no new ADR is triggered; the migration header
must still document the posture (plan `162-05-PLAN.md:132-134`).

**The accepted ceiling**, stated in-file: "any server route holding `createAdminClient()` can
still pass any uid … the standing `service_role` trust boundary (ADR-0001/ADR-0003)"
(`route.ts:124-127`). T-162-05-E *accepts* this (`162-05-PLAN.md:227`). No shape below closes it
except granting EXECUTE to `authenticated` and reading `auth.uid()` inside the function — which
Migration B's posture forbids for wizard writers.

**Precedent for acting on an existing row the caller must own:** `strategies/draft/[id]/route.ts`
applies owner + `source` + `status` filters on its preflight AND again on the DELETE "precisely so
a TOCTOU flip cannot clobber a promoted strategy" (quoted at `create-with-key/route.ts:254-258`).
The repo's precedent is *re-filter at every read and at the write*, never check-once-then-trust.

## 2. Comparison of the four shapes

| | How cross-tenant reuse is prevented | Human memory vs construction | Blast radius if one line is wrong | Fit with this codebase |
|---|---|---|---|---|
| **(A) SECURITY DEFINER RPC, ownership asserted in-body** | Function joins `api_keys.user_id = p_user_id` and raises; EXECUTE service-role-only + in-body `auth.role()` gate | Construction *inside the DB contract* — the assertion ships in the same migration as the write and the state-adaptive SQL gate machine-checks it in CI (`162-05-PLAN.md:176-183`). But `p_user_id` is a parameter: the function verifies consistency, not authenticity of the uid | A wrong in-body predicate = every caller of the RPC is wrong; caught by the SQL gate + RED-witness test | Exact match: `create_wizard_strategy` pattern (`20260814120000:167-207`) |
| **(B) user-scoped client, RLS enforces** | `auth.uid()` comes from the JWT; route code *cannot* pass a foreign uid — strongest by-construction property | Nothing to remember — the DB enforces it | Smallest for the ownership property; but requires re-granting EXECUTE to `authenticated` (reversing Migration B) or new RLS INSERT paths — the browser could then hit the writer directly via PostgREST, bypassing the route's orphan two-read verification, refusal copy, and scrub posture. The write surface widens from 1 route to every JWT holder | Poor: contradicts the Migration-B "only POSSIBLE writer" invariant the SQL gates assert; `api_keys` column grants partially block user-scoped reads (`route.ts:100-107`) |
| **(C) service-role client + TS pre-check** | One `if` in TypeScript before an unfiltered admin write | Pure memory: forget the check (or neuter the filter) and the route is a cross-tenant IDOR; also TOCTOU between check and write | One line = full cross-tenant write, silent | Contradicts both ADRs' spirit and the repo's re-filter-everywhere precedent; no analog does this |
| **(D) = A + route-level `.eq(user_id)` admin filter + user-scoped RLS re-read where grants allow** | Three independent layers: session-uid filter on the admin re-select, RLS-proved ownership read, in-RPC assertion. Cross-tenant reuse requires all three to fail simultaneously | The route filter is memory (RED-witnessed by the neutered-filter test, `162-05-PLAN.md:150-152`); the RPC assertion and EXECUTE surface are construction (SQL-gated) | A wrong route line is caught by the RPC's own assertion; a wrong RPC line is caught by the route filter — no single point of failure | Exact match: this is literally what `create-with-key` already does (`route.ts:210-217`, `:248-252`, `:881`) and what the plan's Task 2 specifies (`162-05-PLAN.md:123-145`) |

On the plan's own sub-choice (new function vs widening `create_wizard_strategy`): the **new-rpc**
option additionally makes T-162-05-B structural — a function that *contains no* `api_keys` INSERT
cannot re-INSERT, and the comment-stripped SQL gate can assert that as a negative token match
(`162-05-PLAN.md:98, :182-183`); under widen-existing, "never re-INSERT" degrades to a branch
condition inside a live function that must be re-based across five historical definitions
(project rule ⭐; `162-05-PLAN.md:104`).

## 3. Outside practice

- **Supabase (primary):** the service role "will ALWAYS bypass RLS" and is for server-side admin
  operations only; RLS is the recommended enforcement layer for user-scoped access —
  [Row Level Security docs](https://supabase.com/docs/guides/database/postgres/row-level-security),
  [service-role troubleshooting note](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z).
  Supabase's own Edge Function guidance is notable dissent-in-practice: functions run with
  service_role by default and are told to "validate authentication in each function" — i.e.
  Supabase itself ships pattern (C) surfaces and compensates with discipline.
- **SECURITY DEFINER hardening (primary/named):** pin `search_path` and schema-qualify references,
  else the caller controls name resolution inside the definer body — PostgreSQL core advisory
  ([pgsql-announce](https://www.postgresql.org/message-id/000001c7500c$1cabf6d0$dc2aa8c0@VLINDERS.NL))
  and Laurenz Albe / Cybertec,
  [Abusing SECURITY DEFINER functions in PostgreSQL](https://www.cybertec-postgresql.com/en/abusing-security-definer-functions/).
  Migration B already complies (`SET search_path = public, pg_catalog`, `20260814120000:168`).
- **Pentest/postmortem class:** real Supabase pentests repeatedly find the exact T-162-05-A failure
  mode — a service-role path missing one ownership check becoming a cross-tenant IDOR —
  [Pentestly, Supabase security lessons from real pentests](https://www.pentestly.io/blog/supabase-security-best-practices-2025-guide);
  the CVE-2025-48757 write-ups catalog RLS-bypass misconfigurations at scale
  ([vibeappscanner](https://vibeappscanner.com/best-practices/supabase)). Practitioner RLS guides
  ([Makerkit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)) state the majority
  view: prefer DB-enforced ownership over app-code checks because the app check must be
  *remembered per call site* while the policy holds *per table*.
- **Where sources disagree:** the purist position ("never touch service_role for user-scoped
  writes, let RLS do it" — Makerkit et al.) collides with the equally standard position that
  privileged writers should be *narrow, service-only surfaces* not reachable from the browser
  (the Migration-B posture; Supabase's own Edge Function model). The disagreement is real and is
  about which risk dominates: forged-uid-in-server-code (B wins) vs browser-reachable write
  surface with per-policy complexity (A/D wins). This codebase measured its way to the second
  camp for wizard writes (the 42501 column-grant wall, `route.ts:100-107`, plus Migration B) —
  and then bolted layer (B)'s property back on wherever grants allow (`route.ts:248-252`). That
  is a considered synthesis, not an accident.

## 4. RECOMMENDATION

**Shape (D), instantiated as the plan's `new-rpc` option**: a new `create_wizard_strategy_for_key`
SECURITY DEFINER function (service-role-only EXECUTE, in-body `auth.role()` gate, in-body
ownership assertion `api_keys.user_id = p_user_id AND disconnected_at IS NULL`, no `api_keys`
INSERT anywhere in the body), called only from `create-with-key` behind `withAuth`, with the
session-uid `.eq("user_id")` re-select on the admin client AND the user-scoped RLS re-read as
defense-in-depth, per `162-05-PLAN.md:123-145`.

- **Strongest argument for:** it is the only shape where a single wrong line is *caught by another
  layer that CI machine-checks* — the route's neutered-filter RED witness proves the route layer
  can fail visibly, and the comment-stripped SQL gate pins the RPC's ownership predicate and the
  absence of any `api_keys` INSERT structurally. It is also byte-for-byte the pattern the live
  writer already uses, so review is a diff against a known-good template, not a new argument.
- **Strongest argument against (stated fairly):** the uid is still a *parameter*. The in-RPC
  assertion verifies the key belongs to `p_user_id`; it cannot verify `p_user_id` is the real
  caller. Any current or future server route holding the service key can pass a victim's uid plus
  the victim's key id and every layer passes — the standing ceiling (`route.ts:124-127`) that only
  a JWT-derived `auth.uid()` inside the function would close, at the cost of granting
  `authenticated` EXECUTE and making the writer browser-reachable.

## 5. What would make the recommendation WRONG

1. **If the accepted ceiling stops being accepted.** T-162-05-E currently *accepts* "any server
   route holding the service key can pass any uid" (`162-05-PLAN.md:227`). If Phase 163's SEC-03
   audit-gate decision — or any founder ruling — reclassifies foreign-uid-from-a-server-route as
   *mitigate*, shape (D) is insufficient by its own admission, and the correct shape becomes an
   `authenticated`-EXECUTE SECURITY DEFINER function that reads `auth.uid()` internally (no
   `p_user_id` parameter at all). That is uniquely feasible for THIS arm because it handles no
   credentials — "nothing is validated against a venue, nothing is encrypted, nothing touches
   api_keys" (`162-05-PLAN.md:144-145`) — the very properties that forced Migration B for the
   original writer do not apply. The cost: the write becomes browser-reachable, bypassing the
   route's orphan verification and refusal copy, and it forks the "wizard writers are
   service-role-only" invariant the SQL gates assert.
2. **If the defense-in-depth read cannot actually run.** The user-scoped `api_keys` re-read
   depends on `id`, `user_id`, `disconnected_at` being in the granted column list
   (`route.ts:100-101` names `disconnected_at` among the granted extensions; the my-strategies
   page reads `k.id`/`k.label`/`k.exchange` user-scoped, `162-PATTERNS.md:283-291`). If a grant
   audit shows any needed column missing, that layer answers 42501 on every call — "it would not
   degrade" (`route.ts:103-105`) — and (D) silently collapses to (A)+route-filter. That doesn't
   flip the recommendation, but it removes one claimed layer: the executor must verify the grant
   or drop the claim, not ship a dead read dressed as defense-in-depth.

## RESEARCH COMPLETE
