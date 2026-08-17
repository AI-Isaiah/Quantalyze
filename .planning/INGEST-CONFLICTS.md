# Conflict Detection Report — 18 ADRs, `--mode merge`

**Run**: 2026-08-14 · branch `docs/branch-adjudication-2026-08-14` · HEAD `9046ad52`
**Input**: `.planning/ingest-manifest.yml` — 18 docs, all type `ADR`, all confidence high (classification pre-settled by manifest; no `UNKNOWN`, no low-confidence entries, so no type-tag blockers).
**Precedence**: ADR > SPEC > PRD > DOC. No SPEC/PRD/DOC in this set, so precedence never adjudicates across tiers — every cross-doc conflict below is ADR-vs-ADR (resolved by specificity + explicit deferral) or ADR-vs-HEAD (not resolvable by precedence at all).
**Deliverable**: this report only. No phases, requirements or state were written. `ROADMAP.md`, `REQUIREMENTS.md`, `PROJECT.md`, `STATE.md` are untouched — this run is contradiction-detection, not ingestion.

**Bucket mapping**: `unresolved-blockers` = BLOCKERS · `competing-variants` = WARNINGS · `auto-resolved` = INFO.

**Cross-ref graph**: 18 nodes, 15 edges, max depth 3. One 2-cycle (ADR-0010 ↔ ADR-0018) — discharged, see INFO-3. One dangling edge (ADR-0006 → ADR-0007, which was never written) — see INFO-11. No traversal cap hit.

**Verification standard used**: every staleness claim below was read at HEAD and is cited `file:line`. Claims that could not be verified at HEAD are marked as such and are not asserted.

---

## BLOCKERS (4) — `unresolved-blockers`

⛔ These gate. Each is a claim an Accepted ADR makes that HEAD falsifies, or an escalation clause an ADR imposes on itself that was never discharged. None is auto-resolvable: precedence cannot settle a doc-vs-code contradiction, and picking a winner here would either bless undocumented behaviour or condemn shipped, working code.

### [BLOCKER-1] ADR-0009 forbids `unstable_cache`; HEAD runs it on two paths, and the ADR's own escalation clause was never discharged

  Found: `docs/architecture/adr-0009-caching-strategy.md:38-42` lists `unstable_cache` under **"Explicitly NOT adopted"**, alongside `'use cache'`, `cacheLife`/`cacheTag` and PPR.
  Found: `adr-0009:44-48` — *"Adopting any of these features requires a new ADR that addresses: how auth-sensitive data is excluded from cached segments; how attestation gates are preserved; what invalidation strategy replaces `force-dynamic`."*
  Found: `adr-0009:76-77` (Evidence) — *"Zero Cache Component usage: grep for `'use cache'`, `unstable_cache`, `cacheLife`, `cacheTag` returns no matches."*
  Contradicted at HEAD, two production call sites:
   · `src/app/factsheet/[id]/v2/page.tsx:3` (import) and `:295` (`return unstable_cache(...)`) — id-keyed, 3600s TTL, shape-versioned key bumped v2→v6.
   · `src/app/api/keys/[id]/permissions/route.ts:2` (import) and `:203` (`unstable_cache(...)` inside `makeCachedFetcher`) — a 60s cache on an **authenticated** API route, which is exactly the class `adr-0009:23-25` says is `force-dynamic` with *"no cross-request caching at any layer"*.
  Found: no ADR anywhere in `docs/architecture/` mentions this adoption. The highest-numbered ADR is 0025 (scenario peer carve-out); the caching decision was made inside phase work (Phase 148 "OWN — owner factsheet without cache disclosure"; the reasoning lives in code comments at `page.tsx:290-294` and `:529-531`, and in `route.ts:216-230`).
  Why this is a blocker and not staleness: the three questions ADR-0009 requires an adopting ADR to answer are **real and were actually answered** — the factsheet key is deliberately id-only so a viewer-dependent predicate cannot leak (`page.tsx:290-294`), the owner lane bypasses the cache (`src/app/factsheet/[id]/v2/page.owner-lane.test.tsx`), and the permissions route reasons explicitly about breaker-vs-TTL interaction. The answers exist in comments and tests; the governing document says they must exist in an ADR. Right now the only durable statement of the caching rule says the opposite of what ships, so the next contributor reading ADR-0009 will either "fix" working code or, worse, cite ADR-0009 as proof that no cached auth-sensitive path exists.
  → Resolve by writing the ADR that ADR-0009:44-48 demands (an ADR-0026 covering both call sites), then correcting `adr-0009:38-42` and `:76-77`. Do NOT resolve by deleting the ban — the ban is what makes the two existing call sites reviewable.

### [BLOCKER-2] ADR-0006's service-boundary contract is false at HEAD on all three of its contract elements

  Found: `docs/architecture/adr-0006-analytics-service-boundary.md:36-38` — *"`src/lib/analytics-client.ts` is the single callsite for all frontend-to-analytics-service communication. No route handler may inline its own fetch to the analytics service."*
  Contradicted at HEAD: there are now **three** client modules plus one inline caller.
   · `src/lib/analytics-client.ts` still exists but is no longer the transport — it delegates to `src/lib/resilient-fetch.ts` (`analytics-client.ts:13-19`, `:309`).
   · `src/lib/process-key-client.ts` is a second first-class client for the unified `/process-key` upstream (`:20-24`), imported by six routes: `strategies/csv-validate:6`, `strategies/finalize-wizard:23`, `strategies/csv-finalize:9`, `keys/sync:13`, `verify-strategy:13` (and the composite/create wizard pair reach the seam through `analytics-client`).
   · `src/lib/resilient-fetch.ts` is the shared transport core (base URL, budgets, breaker) — `:1773`, `:588`.
   · `src/app/api/debug-key-flow/route.ts:120-122` inlines `process.env.ANALYTICS_SERVICE_URL` with its own token read — an inline caller of exactly the kind the ADR forbids.
  Found: `adr-0006:43-44` — *"Timeout: 30 seconds (`ANALYTICS_TIMEOUT_MS`). No retry policy (fail-fast for user-facing requests)."*
  Contradicted at HEAD: `ANALYTICS_TIMEOUT_MS` has **zero** occurrences anywhere in `src/`. Budgets are per-call-site in `resilient-fetch.ts:588` `SEAM_BUDGETS` and range at least 15s → 120s (`validate-key` 30s at `:614`, `validate-key-serialized` **120s** at `:628`, `encrypt-key` 30s, a 15s entry at `:658`). Retry is real, not absent: `retriesOverride` gated by `RETRY_SAFE_ANALYTICS` / `RETRY_SAFE_FLOW_TYPES` (`resilient-fetch.ts:603-607`, `analytics-client.ts:38`, `process-key-client.ts:18`).
  Found: `adr-0006:41-42` says auth is `X-Service-Key` validated against `SERVICE_KEY`. At HEAD a **second** service-to-service auth mechanism is live — `Authorization: Bearer <INTERNAL_API_TOKEN>` on the `/process-key` path (`process-key-client.ts:24-31`, `debug-key-flow/route.ts:120`, `keys/[id]/permissions/route.ts:206-210`). ADR-0006 does not mention it; neither does ADR-0014 (see INFO-9).
  Why this is a blocker and not staleness: ADR-0006 is the only document stating the seam contract, and the seam is where v1.16's entire resilience programme (Phases 140–141) lives. A reader using ADR-0006 to reason about timeout budgets, retry safety or where to add a new call would be wrong on every count — including on the retry question, which is the one with idempotency consequences.
  → Resolve by rewriting ADR-0006's Decision + Contract-elements sections against the post-140/141 seam (three modules with stated roles, `SEAM_BUDGETS` as the budget source of truth, the retry-safety registry as the retry gate, both auth mechanisms), or by superseding it with a new seam ADR and marking 0006 Superseded. Either way `debug-key-flow`'s inline fetch is a separate call: sanction it explicitly or route it through a client.

### [BLOCKER-3] ADR-0024's "locked retention policy" is contradicted by the compute_jobs retention family at HEAD

  Found: `docs/architecture/adr-0024-data-retention.md:61-63` — *"Thresholds are measured against `created_at` for **every** table. `created_at` is the row's birth and is monotonic; using a claim/update column would let a long-retried job outlive its successful ancestor by minutes."* This is a stated rule with a stated reason, not an incidental detail.
  Contradicted at HEAD: `supabase/migrations/20260720120000_retention_orphaned_running_window_4h.sql:68-71` schedules a DELETE keyed on **`claimed_at < now() - interval '4 hours'`** — a claim column, the exact class §1 rejects. (Introduced at 2h by `20260719120000_retention_orphaned_running_compute_jobs.sql:99-102`, widened to 4h.)
  Found: `adr-0024:53-59` (the per-table window table) enumerates five retention classes; it contains **no** row for `compute_jobs status='running'`. HEAD has one — `retention_compute_jobs_orphaned_running`, live as pg_cron jobid 11 (`TODOS.md:942`).
  Found: the same TODOS entry records that the family is also missing a sweep for stale `pending` (`TODOS.md:942-943`), which ADR-0024's table likewise does not contain, and names **Phase 144 (WR-02)** as owner of the DELETE→terminal-UPDATE behavioural half (`TODOS.md:944-949`).
  Scope note — what is NOT claimed here: the DELETE-vs-reset prod-outage risk is already tracked and owned; this report does not re-open it. The blocker is narrower and is a documentation-integrity failure: `adr-0024` is presented as the *locked* retention policy (`:9-10`, Status "Accepted (shipped)") and it is neither complete nor accurate about a table whose rows are being deleted on a schedule.
  → Resolve by amending ADR-0024 §1 and §7 to carry the `running` class, its `claimed_at` basis, and the reason the `created_at` rule does not apply to it (an orphan's birth time is not the quantity of interest — its claim time is). Land the amendment with Phase 144 so the doc and the behaviour change together.

### [BLOCKER-4] Phase 156's service-role wizard writer fits none of ADR-0003's four admin-client categories, and ADR-0003's own escalation clause was not discharged

  Found: `docs/architecture/adr-0003-three-client-supabase.md:34-48` — every `createAdminClient()` call site must be classifiable into **(a)** service-to-service operations *"that run without a user context (cron jobs, webhooks, system-level writes)"*, **(b)** column-level PII reads, **(c)** cross-tenant seeds/admin tools, or **(d)** audit-table writes — and *"Any new `createAdminClient()` usage that does not fit these categories requires a new ADR or an amendment to this one."*
  Found: `docs/architecture/adr-0001-rls-primary-authorization.md:22-32` narrows further — API handlers are not expected to re-check ownership *"except in two narrow cases"*: **(1)** admin client for **cross-tenant reads**, **(2)** column-level PII hiding.
  Contradicted at HEAD by Phase 156 (`ROADMAP.md:127`, `:672`; shipped `25e28d3a` + `5d43df6b`): the wizard's `api_keys`/strategy INSERT is now a **per-user write, in a user request, under the service-role client**.
   · `src/app/api/strategies/create-with-key/route.ts:28` imports `createAdminClient`; `:805-807` binds `rpcAdmin = createAdminClient()`; `:836` passes `p_user_id: user.id`.
   · `src/app/api/strategies/composite/add-key/route.ts:11`, `:443-445`, `:478` — the identical shape on the composite twin.
   · `supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql:439-458` REVOKEs EXECUTE from `authenticated` on both RPCs and GRANTs `service_role`; the in-body gate is `auth.role() IS DISTINCT FROM 'service_role'` with **zero** `auth.uid()` (`:537-538`, `:557`, `:649`).
  It is not (a) — it runs squarely inside a user context, under `withAuth` (`create-with-key:346`, `add-key:130`). It is not (b), (c) or (d). It is not ADR-0001 case 1 (a *read*, cross-tenant) nor case 2 (PII column hiding).
  Found: no amendment exists. `grep -i` for `attested_venue`, `Phase 156` and the wizard RPC names across all 18 ADRs returns nothing — `docs/architecture/` carries no trace of the change. `.planning/REQUIREMENTS.md:1001-1002` *does* name the boundary correctly (*"Any server route holding `createAdminClient()` can still pass any uid — the standing `service_role` trust boundary (ADR-0001/ADR-0003)"*), which means the phase knew it was leaning on these ADRs and still did not amend them.
  Why this is a blocker: ADR-0003's category list is load-bearing review machinery — `adr-0003:53-56` says the point is that *"any new `createAdminClient()` import is an immediate discussion point in code review."* A fifth, un-enumerated category that is now the wizard's normal write path silently converts that mechanical check into a judgement call, and Phase 156 itself proves the review value is real (its own `CONNECT-02b` structural guard at `src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts` exists precisely because a second such writer would otherwise land unnoticed).
  → Resolve by amending ADR-0003 with the fifth category — "user-scoped write where the server, not the caller, must supply an attested field" — with its mandatory conditions (route-level `withAuth`-verified `p_user_id`, an in-body `auth.role()` gate, and a source-scan sole-writer guard). ⚠️ Note the amendment's durability caveat is already known and should be carried into it: `20260814120000:82-96` records that Supabase's `pg_default_acl` re-grants `anon`/`authenticated` on any `DROP`+`CREATE`, so the REVOKE is not self-enforcing and assertion 5h is the durable control.

---

## WARNINGS (2) — `competing-variants`

⚠️ Two documents that both plausibly govern the same decision and now give different answers. Not auto-resolved: picking one would delete a real position.

### [WARNING-1] Where the authoritative ownership check for the wizard write lives — ADR-0001 (database) vs ADR-0004 + ADR-0022 (route)

  Variant A — `adr-0001:9-11` — *"the database is the single source of truth for 'which user can see which rows'"*, and `:22` *"RLS is the primary authorization layer."*
  Variant B — `adr-0022:29-43` — Layer 2 (`getUser()` in the handler) is authoritative, and `adr-0004:36-39` makes `withAuth`/`withAdminAuth` mandatory for every mutation.
  Both governed this write identically until Phase 156, because the wizard RPCs carried `auth.uid()` guards. They no longer do: `.planning/REQUIREMENTS.md` CONNECT-03b states the ownership binding *"moves **entirely to the route**"*, and the migration asserts **zero** `auth.uid()` in both bodies (`20260814120000:537-538`, `:649`). The DB gate that remains is a *role* gate, not an *ownership* gate.
  So for this path Variant B is now the whole answer and Variant A is not true as written. But Variant A is still true — and load-bearing — for the ~all other tables ADR-0001 covers, and the phase deliberately kept the `CHECK (attested_venue IS NULL OR attested_venue = exchange)` fence (`ROADMAP.md` SC4) precisely so the DB keeps *some* structural say.
  Impact: synthesis cannot pick without losing intent. Choosing A condemns shipped, deliberately-designed code. Choosing B weakens the single most important standing invariant in the codebase for every other table.
  → Founder call needed: does ADR-0001 gain a stated exception ("for writes where the server must supply an attested field, the ownership check is route-level and the DB retains only a role gate plus a coherence CHECK"), or does ADR-0022 gain a stated escalation ("a route-level-only ownership check requires X")? Both variants are preserved verbatim above; neither has been merged.

### [WARNING-2] ADR-0023 §5 and §8 disagree on whether a compromised route can forge audit attribution

  Variant A — `adr-0023:315-326` (§5) — *"user_id is set from `auth.uid()` — the caller cannot spoof attribution by passing a different user_id… Even a compromised Next route cannot write an audit row attributed to user B when user A's JWT is on the wire."*
  Variant B — `adr-0023:378-394` (§8) — Option A1, migration 058, installs `log_audit_event_service(p_user_id, …)` where **the caller supplies user_id**, and states the gate honestly: *"The attribution-spoof gate is at the grant layer: a compromised `authenticated` JWT cannot reach this RPC."*
  At HEAD, Variant B is what ships: `supabase/migrations/20260417155900_log_audit_event_service.sql:75-76` (`p_user_id UUID` as the first parameter), `:90-91` (raises only on NULL, never derives from `auth.uid()`), `:125-128` (REVOKE from PUBLIC/anon/authenticated, GRANT to `service_role`). The TS entry point is `src/lib/audit.ts:897` `logAuditEventAsUser(adminClient, actingUserId, event)`, documented at `:245-251` and `:274-285`, and it is used on live paths including `src/app/api/strategies/finalize-wizard/route.ts:2135`.
  §5 is scoped to `log_audit_event` and is correct within that scope. Its **final sentence** is not scoped, and is false: a route holding the service-role key can attribute an audit row to any user. §5 carries no pointer to §8.
  Impact: §5 is the section a reader lands on when asking "can attribution be forged?", and it answers with an absolute. This matters more than ordinary prose drift because it is a *safety* claim about a control — the exact shape the branch's own discipline forbids ("say 'would have caught', never 'did stop'").
  → Do not merge: keep §5's claim for the `log_audit_event` path and keep §8's grant-layer framing, but scope §5's last sentence explicitly ("…cannot write an audit row attributed to user B **through this RPC**; see §8 for the service-role variant and where its gate actually sits").

---

## INFO (11) — `auto-resolved` and recorded

### Auto-resolved by precedence / explicit deferral

**[INFO-1] ADR-0004 vs ADR-0005 on the mandatory route wrapper — ADR-0005 wins for admin routes.**
`adr-0004:36-39` makes `withAuth`/`withAdminAuth` the mandatory wrappers and lists no third. `adr-0005:68-76` introduces `withRole(...roles)` as the V2 peer of `withAdminAuth`, and `adr-0005:129-137` schedules the V1→V2 migration of all `/api/admin/**`. Same precedence tier, so ordering does not decide it; resolved on specificity (ADR-0005 is *the* admin-authorization ADR) plus its explicit self-declaration as the successor pattern. Verified at HEAD: 6 files under `src/app` use `withAdminAuth`, 6 use `withRole(` — exactly the coexistence `adr-0005:153-157` predicts and labels a known cost. No action; ADR-0004's rule stands unchanged for non-admin mutations.

**[INFO-2] ADR-0002 vs ADR-0009 on the scope of "cache features not adopted" — ADR-0009 wins.**
`adr-0002:40-42` bans `'use cache'`, `cacheLife`, `cacheTag`, PPR — and does **not** name `unstable_cache`. `adr-0009:38-42` bans all of those **plus** `unstable_cache`. Not a contradiction: `adr-0002:41-42` defers explicitly — *"See ADR-0009 for the full caching strategy rationale."* Resolved to ADR-0009's wider list. Recorded because it is load-bearing for BLOCKER-1: the ban HEAD violates is ADR-0009's, and ADR-0002 cannot be read as licensing it.

**[INFO-3] ADR-0010 ↔ ADR-0018 mutual-deferral cycle — discharged, non-blocking.**
Cycle detection found one 2-cycle: `adr-0018:82-85` (§4) defers the logger choice to ADR-0010, while `adr-0010:64-66` (sub-decision 1) defers error boundaries to ADR-0018. At authoring time this was a genuine deferral loop — neither could be executed first. Both were resolved together in Phase 16 / v0.19.0.0 (`adr-0010:26-39`, `adr-0018:37-53`), so the cycle is discharged and synthesis is not at risk of looping. No action.

### Recorded — verified stale prose, non-blocking

Per the project stopping rule these are logged, not gated: none is user-facing or data-integrity. All were read at HEAD.

**[INFO-4] ADR-0004's "Routes requiring retrofit" list is closed.** `adr-0004:51-57` names five routes lacking CSRF and/or rate limits, and `:78-79` repeats three as "CSRF gaps". At HEAD all three named CSRF gaps call `assertSameOrigin` **and** a limiter: `src/app/api/preferences/route.ts:84` + `:56`/`:156`; `src/app/api/portfolio-optimizer/route.ts:56` + `:113`; `src/app/api/verify-strategy/route.ts:52` + `:59`.

**[INFO-5] ADR-0008's timing-unsafe `alert-digest` finding is fixed.** `adr-0008:23` (Problems), `:53-54` (Mandatory fixes) and `:95-96` (Evidence) all assert `/api/alert-digest` compares `CRON_SECRET` with `!==`. At HEAD `src/app/api/alert-digest/route.ts:44-45` uses `safeCompare(auth, expected)`.

**[INFO-6] ADR-0008 and ADR-0021 document 2 of 8 Vercel cron schedules.** `adr-0021:30-38` quotes `vercel.json` as carrying two crons; `adr-0008:60-67` inventories the same two. `vercel.json` at HEAD declares **eight**: the two documented plus `cleanup-wizard-drafts`, `sync-funding`, `reconcile-strategies`, `cleanup-ack-tokens`, `founder-lp-report`, `flag-monitor`. The two ADRs agree with each other and both disagree with HEAD, so this is not a competing variant. ⚠️ It does mean `adr-0008:82`'s stated purpose — *"Operators can answer 'where does job X run?' from this document"* — is unmet for six of eight. Worth folding into whichever pass touches ADR-0008 next. **Checked and clean:** the v1.16 Phase 142–144 pg_cron reaper *is* documented, and documented well — `adr-0008:65`, `:69-78` describes it as a deliberate sixth mechanism (in-DB SQL, no auth pattern, no `cron_runs` row) and cites the correct currently-registered migration `20260803130000` at `:100-103`. That was the specific staleness this run was asked to look for on ADR-0008, and it is absent.

**[INFO-7] ADR-0018 understates its own resolution.** `adr-0018:49-51` says segment-level boundaries *"(`(dashboard)/error.tsx`, `(auth)/error.tsx`) … remain open follow-ups for a later phase."* Both exist at HEAD, as do eight more: `src/app/error.tsx`, `(auth)/error.tsx`, `(dashboard)/error.tsx`, `factsheet/[id]/v2/error.tsx`, `(dashboard)/strategies|portfolios|admin|allocations|compare/error.tsx`, `strategy/[id]/error.tsx`.

**[INFO-8] ADR-0010 and ADR-0018 Evidence sections describe the pre-Phase-16 world.** "No Sentry in `package.json`" (`adr-0010:94`), "Zero `error.tsx` files" (`adr-0010:101`, `adr-0018:103`). Both are superseded by the `## Resolution` blocks and both ADRs mark their Decision sections "original — preserved for history"; the Evidence sections carry no such marker. Cosmetic — a one-line header on each Evidence section would close it.

**[INFO-9] ADR-0014's Class 2 secrets table omits a live service-to-service secret.** `adr-0014:33-37` lists `ANALYTICS_SERVICE_KEY`, `CRON_SECRET`, `HMAC_SECRET`. `INTERNAL_API_TOKEN` is a fourth, in production on the `/process-key` seam (`src/lib/process-key-client.ts:24-31`, `src/app/api/debug-key-flow/route.ts:120`, `src/app/api/keys/[id]/permissions/route.ts:206-210`) and named as a redaction target by `src/lib/seam-redaction.test.ts:24`. Since ADR-0014's stated purpose is *"three clear classes make it possible to write a rotation runbook"* (`:108`), a missing Class-2 secret is a real gap in the artifact it exists to enable. **Checked and clean — this was the specific ADR-0014 question this run was asked:** the `venue_account_id` / `attested_venue` work does **not** contradict ADR-0014. `API_KEY_USER_COLUMNS_ARR` remains the single source of truth (`src/lib/constants.ts:138-171`) and neither new column is in it; both migrations state and justify carrying no GRANT (`20260811210000:112`, `20260812083206:67-71`). The SEC-005 posture at `adr-0014:68-83` holds as written. The one drift is that the allowlist has grown three members since the ADR (`sync_error`, `last_429_at`, `disconnected_at`) — which is exactly the maintenance path the ADR prescribes, not a violation of it.

**[INFO-10] ADR-0020's line references have moved; its claims hold.** `adr-0020:74-75` cites `loadManagerIdentity` at `src/lib/queries.ts:41-50`; at HEAD it is a thin wrapper at `queries.ts:83-91` delegating to `src/lib/manager-identity.ts`. `adr-0020:76-77` cites `DisclosureTier` at `src/lib/types.ts:31`; at HEAD it is `types.ts:153`. Both decisions (admin-client-only identity read, two-value CHECK-constrained tier) are intact.

**[INFO-11] Reference-integrity: ADR-0006 cites an ADR that was never written, and TODOS.md denies the ADRs exist.**
 · `adr-0006:45` — *"Cold-start handling: See ADR-0007 for warmup strategy."* No `adr-0007-*.md` exists. Seven numbers in the 0001–0025 range are unwritten (0007, 0011, 0012, 0013, 0015, 0016, 0019); 0007 is the only one anything points at. Either write it or inline the warmup contract into ADR-0006 (which BLOCKER-2 already reopens).
 · `TODOS.md:1229-1232` carries an open item reading *"**No `docs/architecture/` ADRs** — every decision is implicit in code… (17 existing decisions to document + 5 open questions per the 2026-04 architecture audit.)"* This is false at HEAD — the 18 ADRs in this run are that item's deliverable, largely shipped. Same ledger-vs-reality class this run was convened over; close or rewrite the entry to name what actually remains (by this report: ADR-0007, plus the ADR-0009 successor BLOCKER-1 demands).

---

## Verified and clean — explicit negative findings

Checked at HEAD, no contradiction found. Recorded so a later reader does not have to redo the work, and so "not reported" is distinguishable from "not looked at".

  · **ADR-0002 (Next.js 16 conventions)** — holds in full. Zero `'use server'` / `"use server"` anywhere in `src/`. `src/proxy.ts` present, no `pages/`, route groups `(auth)`/`(dashboard)`/`(marketing)` intact. (Its cache clause is narrower than ADR-0009's — see INFO-2 — but is not itself violated.)
  · **ADR-0022 (proxy optimistic / DAL authoritative)** — holds, and specifically **survives Phase 156**. This was the sharpest question put to this run and the answer is no: Layer 2 was not weakened. Both rewired wizard routes still gate on `withAuth` (`create-with-key/route.ts:4`, `:346`; `composite/add-key/route.ts:12`, `:130`), and the `p_user_id` passed to the service-role RPC is `withAuth`'s `getUser()`-verified `user.id`, never a body field (`:836`, `:478`). What changed is *where the ownership check lives* — that is WARNING-1, and it is an ADR-0001 question, not an ADR-0022 one.
  · **ADR-0018 (error handling) vs Phase 153.7** — no contradiction. The envelope contract ADR-0018 describes is intact at HEAD: `src/lib/envelope.ts` still carries `correlation_id`, `human_message`, `debug_context`, and gates retry on `recoverable` derived from the action set (`envelope.ts:52-56`, `:84-92`). 153.7's work is **additive to the code population**, not a change to the contract: `SEAM_INTERNAL_FAULT` is a new member of the closed set at `src/lib/wizardErrors.ts:523` with a copy entry at `:2412` and three upstream mappings at `:3081-3088`. ADR-0018 never enumerated codes, so a 17→37 population growth cannot falsify it. (The one stale sentence is INFO-7.)
  · **ADR-0006 vs the v1.16 seam/breaker work (Phases 140.x)** — this *is* BLOCKER-2; recorded here only to confirm the question was asked in the form posed. The breaker itself is not the contradiction; the single-callsite, 30s-timeout and no-retry clauses are.
  · **ADR-0005 (admin authorization)** — no contradiction. Status is "Superseded-in-progress" and HEAD matches: V1 (`withAdminAuth`, `profiles.is_admin` at `src/lib/admin.ts:8-31`) and V2 (`withRole`) coexist 6 files to 6, exactly as `adr-0005:153-157` states.
  · **ADR-0023 (audit taxonomy)** — the taxonomy is live and enforced, not drifted: `src/lib/audit.ts:319` `AuditAction` cites the ADR as canonical (`:291`, `:317`) and `src/__tests__/audit-coverage.test.ts:1264` pins call sites back to it. The only defect found is the §5/§8 over-claim (WARNING-2). §1–§4, §6, §7 were read at section level and spot-checked, not line-by-line audited — stated so the confidence level is legible.
  · **ADR-0017 (deployment topology)** and **ADR-0025 (scenario peer carve-out)** — read in full, no claim found that HEAD falsifies. ADR-0025's carve-out invariants (`scenarioPeer` on the csv arm only, `ingestSource` stays `"csv"`, min-N floor) are stated as pinned by tests; those pins were not independently re-run in this pass.
  · **ADR-0020, ADR-0021** — see INFO-6 and INFO-10; no decision-level contradiction, stale references only. ADR-0021 remains "Proposed", so its unbuilt `npm run ci` composite (absent from `package.json:11-13` at HEAD) is an open item, not a contradiction.

---

## Summary

  · **18 of 18** classifications consumed. No `UNKNOWN`, no low-confidence, no type-tag blockers.
  · **4 blockers** — all ADR-vs-HEAD, none resolvable by precedence: ADR-0009 (`unstable_cache` shipped against an explicit ban with an undischarged escalation clause), ADR-0006 (seam contract false on all three elements), ADR-0024 (`claimed_at` threshold + an undocumented `running` retention class), ADR-0003 (Phase 156's writer fits no category; the ADR's own amendment requirement not met).
  · **2 competing variants** — where the wizard write's ownership check authoritatively lives (ADR-0001 vs ADR-0004/0022, post-156); whether a route can forge audit attribution (ADR-0023 §5 vs §8). Both preserved verbatim, neither merged.
  · **11 info** — 3 auto-resolved cross-ADR (incl. the discharged 0010↔0018 cycle), 8 recorded staleness.
  · **Answer to the question that motivated the run**: yes — four. And notably, three of the six ADRs the run flagged as *likely* stale turned out to be clean when checked (ADR-0022 survives Phase 156 intact; ADR-0014 is unaffected by the `attested_venue`/`venue_account_id` work; ADR-0008 already documents the pg_cron reaper correctly), while the two largest findings — ADR-0009 and ADR-0006 — were not on the list.

⛔ **Gate**: 4 blockers open. Per the ingest contract no destination file may be written from this intel while they stand. `ROADMAP.md`, `REQUIREMENTS.md`, `PROJECT.md` and `STATE.md` were not written and must not be until each blocker is either resolved in `docs/architecture/` or explicitly accepted as a residual with an owner.
