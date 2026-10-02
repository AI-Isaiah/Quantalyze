# Phase 145: JOB — csv-finalize atomicity (reproduce-first) — Research

**Researched:** 2026-08-17
**Domain:** Next.js route + Python seam + Postgres SECURITY DEFINER RPC atomicity on the csv-finalize path
**Confidence:** HIGH on everything answerable from the repo; DB-only facts marked ⚠️ UNVERIFIED with the exact settling query.
**Researched at:** branch `feat/v1.19-phase-144`, HEAD `1e3004d9` (⚠️ CONTEXT.md was audited at `4f56bde4`; Phase 144 commits have landed since — every anchor below was re-verified at THIS head, not inherited)
**Tools available to this agent:** filesystem + git only. **No Supabase MCP, no psql, no DB access.** Live-data claims carry the settling query.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**SC#1 — the reproduction**
- **The verdict is CANNOT REPRODUCE, and the plan's job is to make that verdict *executable and committed*, not to re-derive it.** Four arms (fleshed out in §4). ⛔ Do not scope any 42501 fix. ⛔ Do not re-add `X-User-Access-Token` forwarding — it is at `route.ts:1324` and `process_key.py:1135`, and a diff that "adds" it is the warning sign PITFALLS names.
- **The artifact must state the split explicitly: the GUARD is live, the PATH is closed.** A flat "not a bug" is wrong and invites someone to delete the guard. Arm 1 exists to make the guard's liveness a CI fact.
- **Close the TODOS bullet** (`TODOS.md:817-820`) citing which of its own two proposed remedies shipped.
- **Correct `.planning/research/PITFALLS.md` and `.planning/research/SUMMARY.md` line anchors** (`~792-820` → `:1119-1156`) and the migration citation (`20260501055202` → `20260728120000`) in the same commit.

**SC#2 — the mechanism**
- ✅ **FOUNDER RULING 1 (2026-08-17): orphan disposition = reading (β), TERMINALIZE.** Mark the orphan failed/abandoned with a reason; the user sees a real outcome, the audit trail survives, retention collects it later. SC#2's "no orphan row" is LOCKED as "no UNEXPLAINED row nothing owns". **Deletion arms are OUT OF SCOPE for the plan.**
- ⏳ **FOUNDER RULING 2 (2026-08-17): the (i-a) forward vs (i-b) direct-from-route choice = DECIDE AT PLAN TIME, MEASURE FIRST.** The plan must include a task that measures the actual (i-a) forwarding cost on real data — payload size and latency of shipping ~5000 daily rows across the `/process-key` seam versus the direct-from-route call — and brings NUMBERS back before the choice is made. ⛔ A plan that picks (i-a) or (i-b) without that measurement violates this ruling. (§3 designs the measurement; payload-size half already measured this session.)
- **Preferred direction, absent override: option (i), the folded SECURITY DEFINER transaction** — it *dissolves* windows A/B/C rather than cleaning up after them; what remains is window D, which Phase 143 heals.
- ⛔ **`p_terminal_status` survives, verbatim, in whatever function is created** — losing it silently promotes CONTRIB-02 `'private'` contributions into the admin publish queue.
- ⛔ **The CR-01 cross-submission-merge fence may MOVE but never WEAKEN.** If it moves into SQL, its five existing tests must be re-pointed and each observed RED against the new implementation.
- ⛔ **Do not touch `20260816140000` (143's sweep)** — not its predicate, not its conjunct order, not its gates.
- **Fix the two honesty defects regardless of option:** `route.ts:590` "Nothing was changed." and the vacuous `RED-TEAM-M1` test (`csv-finalize-c14-regression.test.ts:144-190`).
- **Add the missing Sentry captures** on the persist-error (`route.ts:624-633`) and stale-probe-error (`route.ts:574-596`) arms.

### Claude's Discretion
- Test/gate file names, the folded RPC's name and signature shape, migration filename/timestamp.
- Whether the SC#1 artifact is a standalone `145-REPRODUCTION.md` or a SUMMARY section (committed **before** SC#2 code either way).
- Whether the SQL auth-guard gate is a new `supabase/tests/test_*.sql` or a new part of an existing one.
- Whether the vacuous `RED-TEAM-M1` test is repaired or deleted — decide from which SC#2 option lands.
- The grace/threshold value if an out-of-band sweep is nonetheless built — ⚠️ must be **derived** (a bare number is what got 106's janitor reverted).

### Deferred Ideas (OUT OF SCOPE)
- **Window E** (dailies present, enqueue errored, analytics `failed`, job never re-enqueued) → TODOS, unless census query (3) shows non-zero PROD.
- **The wizard first-hop drop** — 143's documented non-coverage. ⚠️ Do NOT absorb it into 145 by widening a predicate. → TODOS.
- **Deleting the inert `feature_flags.process_key_unified_backbone` row / dead Vercel-Railway env vars.** ⛔ `20260620120000:86-89` RAISEs at apply if that row reads `off`. → TODOS with that constraint attached.
- **Forwarding `X-User-Access-Token` on onboard/resync** (140.1 obligation) — not this phase.
  ⛔ RESOLVED 2026-08-18 by Phase 146.1 / B2, in the opposite direction: the forward was REMOVED from keys/sync and verify-strategy rather than extended, because the only Python reader has zero callers. See 140.1-TS-OBLIGATIONS.md TS-15.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description (verbatim from REQUIREMENTS.md) | Research Support |
|----|---------------------------------------------|------------------|
| JOB-06 | "The stale 42501 / `PROCESS_KEY_UNIFIED_BACKBONE` claim is reproduced against current `main` before any fix is scoped (documented pass/fail); the genuinely-open gap — csv-finalize's three-step RPC → RPC → `after()` sequence having no wrapping transaction — is closed by either one SECURITY DEFINER transaction or explicit compensating cleanup + Sentry, so a partial failure leaves no orphan strategy row." (`.planning/REQUIREMENTS.md:56`) | §4 (four executable reproduction arms with pass/fail oracles), §1 (the folded-transaction design, re-based on both LATEST RPC definitions), §2 (the founder-locked TERMINALIZE disposition for residual orphans), §3 (the founder-mandated measurement), §6 (the "+ Sentry" half), §7 (the gates that make it CI-visible) |

⚠️ Note: JOB-06's "three-step" phrasing is superseded by CONTEXT's five-hop map (re-verified at HEAD in §1) — the sequence is hop 0 HTTP → hop 1 finalize RPC → hop 2 metadata UPDATE → hop 3 stale-range probe → hop 4 persist RPC → hop 5 `after()` enqueue. "No orphan strategy row" is LOCKED to reading (β): no *unexplained* row nothing owns.
</phase_requirements>

---

## Summary

All seven research questions are answered from source with file:line evidence. The five-hop map, the failure-window table, and the SC#1 CANNOT-REPRODUCE evidence in CONTEXT.md were spot-re-verified at HEAD `1e3004d9` and hold. The reproduction arms are fleshed into mechanically executable commands with pre-registered pass/fail oracles (§4). The folded-RPC design is fully re-based: `finalize_csv_strategy`'s latest body is `20260728120000:196-311` and `persist_csv_daily_returns`'s latest (and only) body is `20260522111839:111-186` — **but the table under it was restructured by `20260624120000`** (surrogate PK, XOR source check, owner-coherence trigger), which no prior phase document mentions and which the folded function must be written against (§1).

**Three CONTEXT.md claims are corrected at HEAD:**

1. ⛔ **"no trigger on `strategies` in any migration" is FALSE.** Three triggers exist: `strategies_reject_sentinel` (`20260515114310:231-234`), `guard_strategies_publish_transition_trigger` (`20260716131000:76-80`), and `trg_strategies_team_review_mark_guard` (`20260806120000:487-491`). None blocks a terminalize UPDATE (§2), but the claim as written was load-bearing for the (now out-of-scope) deletion analysis and must not propagate.
2. ⚠️ **"the series never leaves Next today" is MISLEADING.** The `daily_returns_series` is *produced by Python* (`csv_validator.py:885-886`) and already crosses the Railway→Vercel seam in every csv-validate response; it then crosses Next→PostgREST at hop 4 on every finalize. What (i-a) adds is only the Next→Railway direction. Measured this session: **280,001 bytes** for 5000 rows at full float precision (§3) — three orders of magnitude under any relevant body cap.
3. ⚠️ **"Nothing was changed." is false on the 409 arm too, differently.** CONTEXT names the 503's lie (strategy + verification committed). On the 409 `CSV_SESSION_REUSED` arm (`route.ts:606`), the *metadata UPDATE has already overwritten the resolved strategy's metadata* (hop 2 runs before hop 3), so "Nothing was changed" is false there as well — the copy fix has three sentences to reconcile, not two (§5).

**The strongest structural finding (§1):** under the fold, the 23505 double-submit rollback becomes *the* atomicity mechanism. A window-B/C failure inside the folded function rolls back *everything* — so the instructed retry becomes a clean first submit (no 23505, no resolve arm). A 23505 can then only mean a prior attempt **fully** committed (strategy + verification + dailies), which is exactly window A — and the resolve arm no longer needs to persist anything, only to verify identity (name + range) and echo the id. The CR-01 fence's write-blocking job disappears; its identity-checking job moves into the resolve arm as a read.

**Primary recommendation:** execute §4's four arms and commit the verdict first; then fold hops 1+4 into one SECURITY DEFINER function per §1's skeleton (choice of caller deferred to the §3 measurement per founder ruling 2); terminalize the *measured* residual orphan population once, by hand in the orchestrator session, per §2 — do **not** build a new sweep (the wizard-first-hop indistinguishability problem is unsolved and the fold makes the windows unreachable prospectively); fix the three copy sentences and rebuild the vacuous test per §5; add the two Sentry captures per §6; and re-point the SQL + TS gates per §7 with observed-RED discipline for every one.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Input validation (series shape, 5000 cap, metadata, name) | API route boundary (`route.ts`) | folded RPC (defense-in-depth) | Already the load-bearing gate (`route.ts:82-87` comment); the RPC re-validates so a non-route caller cannot bypass |
| Atomic strategy + verification + dailies write | Database (SECURITY DEFINER RPC) | — | Only a single Postgres transaction can make hops 1+4 atomic; the HTTP boundary (hop 0) can never be inside one |
| Double-submit idempotency + cross-submission refusal (CR-01) | Database (partial unique index + resolve arm) | caller of the fold (answer shape) | `20260728120000` header: "This migration owns the guarantee; the router owns the answer shape" |
| Compute-job enqueue | API route `after()` (service-role) | Phase 143 sweep (heals the drop) | Post-response by design; cannot join the transaction — honest ceiling per CONTEXT |
| Residual-orphan disposition (windows A–C, pre-fix population) | Orchestrator session, one-time (founder-locked TERMINALIZE) | — | No automated sweep: the A/B/C shape is indistinguishable from the wizard first-hop drop (143's filed non-coverage) |
| Failure observability (windows B/C) | API route (`captureToSentry`) | Sentry | The file's own convention (`route.ts:736/:783/:836`); B/C are the only backend-failure arms without it |
| Gates | CI: vitest shards + `sql-tests` + pytest | — | `supabase/tests/test_*.sql` is the only SQL path that runs in CI; `csv-finalize-rpc.test.ts` is live-DB skipIf and NEVER runs in CI (§7) |

---

## §1 — The folded-RPC design (Q1)

### Re-base discharge: the LATEST definitions of both RPCs

**`finalize_csv_strategy`** — grep of ALL migrations returns ten files mentioning it; only three ever (re)define it, and the newest is:

| Migration | Role |
|---|---|
| `20260501055202_strategy_verifications.sql` | original 4-arg — superseded |
| `20260716130500_finalize_terminal_status_param.sql:225-330` | 5-arg with `p_terminal_status`; DROPs the 4-arg form — superseded |
| **`20260728120000_csv_finalize_double_submit_idempotency.sql:196-311`** | ⭐ LATEST — adds the `wizard_session_id` write. No later redefinition (repo tip is `20260817120000`, Phase 144's cron migration, which does not touch it). [VERIFIED: full file read this session] |

**`persist_csv_daily_returns`** — defined ONCE, never redefined: `20260522111839_csv_daily_returns.sql:111-186`. Grep of all migrations for the name returns only `20260522111839` (definition), `20260624120000` (comments — table DDL only, no `CREATE OR REPLACE FUNCTION persist_…`), and `20260816140000` (comment). [VERIFIED: grep + all three files read this session]

⚠️ **NEW finding no prior phase document carries: the TABLE under `persist_csv_daily_returns` was restructured by `20260624120000_csv_daily_returns_per_key_axis.sql` and the folded function must be written against the RESTRUCTURED table:**

- PK is no longer `(strategy_id, date)` — it is a surrogate `id BIGINT GENERATED ALWAYS AS IDENTITY` (`:32-33`); `strategy_id` is **nullable** (`:28`).
- Strategy-row uniqueness now lives in a **non-partial unique index** `csv_daily_returns_strategy_date_key ON (strategy_id, date)` (`:55-57`) — the `ON CONFLICT (strategy_id, date)` clause in the RPC still resolves to it (the migration header at `:9-17` states this was verified live: "one SECDEF consumer `persist_csv_daily_returns` whose ON CONFLICT survives").
- A CHECK `csv_daily_returns_source_xor CHECK (num_nonnulls(strategy_id, api_key_id) = 1)` (`:43-45`) — the folded INSERT must supply `strategy_id` and leave `api_key_id`/`allocator_id` NULL.
- A BEFORE INSERT OR UPDATE trigger `csv_daily_returns_owner_coherence` gated `WHEN (NEW.api_key_id IS NOT NULL)` (`:113-118`) — strategy-scoped inserts pay zero trigger overhead; the fold does not interact with it.

### The folded function: shape and semantics

**Signature (name at planner's discretion; suggested `finalize_csv_strategy_with_returns`):**

```
(p_user_id UUID, p_wizard_session_id UUID, p_fmt TEXT, p_strategy_name TEXT,
 p_rows JSONB, p_terminal_status TEXT DEFAULT 'pending_review') RETURNS UUID
```

`LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`, **no `EXCEPTION` block** — the no-EXCEPTION property is inherited from `20260728120000`'s header (`:80-87`, verbatim: *"finalize_csv_strategy is LANGUAGE plpgsql SECURITY DEFINER with NO `EXCEPTION` block … An unhandled 23505 therefore aborts the function and the enclosing statement, so BOTH the strategies row and the strategy_verifications row roll back"*) and now extends to THREE writes: an unhandled error anywhere rolls back strategies + strategy_verifications + csv_daily_returns together.

### Guards that must survive VERBATIM (with their sources)

From `finalize_csv_strategy` (`20260728120000`), in order — the order is load-bearing (terminal-status guard FIRST, per its own comment at `:212-214`):

| Guard | Source lines | Verbatim value |
|---|---|---|
| `p_terminal_status` whitelist | `:215-219` | `IF p_terminal_status NOT IN ('pending_review', 'private') THEN RAISE … ERRCODE = '22023'` |
| auth-session guard | `:225-228` | `IF v_auth_uid IS NULL THEN RAISE EXCEPTION 'finalize_csv_strategy called without an auth session' USING ERRCODE = '42501'` (message string must be preserved or the §4 arm-1 gate re-pointed) |
| identity guard | `:230-234` | `IF v_auth_uid <> p_user_id THEN RAISE … ERRCODE = '42501'` |
| fmt whitelist | `:237-240` | `IF p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN RAISE … ERRCODE = '22023'` |
| name required / ≤80 | `:248-256` | two 22023 raises with distinguishing message substrings (plan 15-06 tests pin them separately) |
| strategies INSERT writes `wizard_session_id`, `source='csv'`, `status=p_terminal_status` | `:278-288` | columns `user_id, name, status, source, strategy_types, subtypes, markets, supported_exchanges, wizard_session_id` — the `wizard_session_id` write is what makes the partial index bite (SEAMRIM-03; the migration's STEP 4 self-verify asserts it inside the INSERT fragment, `:399-422`) |
| verification INSERT | `:299-305` | `status='validated', trust_tier='csv_uploaded', flow_type='csv', source='csv'`, errors/correlation_id NULL |
| grants | `:314-315` | `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;` — same shape for the fold. ⚠️ Do NOT grant service_role-only: `20260522111839:200-208` documents that narrowing to service_role NULLs `auth.uid()` and 42501s every legitimate call |

From `persist_csv_daily_returns` (`20260522111839`):

| Guard | Source lines | Fold disposition |
|---|---|---|
| auth NULL / identity 42501 | `:127-136` | REDUNDANT with the finalize guards — one copy suffices in the fold |
| probe-oracle ownership collapse | `:145-149` | **DISSOLVES** — the fold creates the strategy in the same transaction, so ownership is true by construction; there is no caller-supplied `p_strategy_id` to probe. (State this in the migration header so the "missing guard" is not read as a regression.) |
| `jsonb_typeof(p_rows) <> 'array'` → 22023 | `:153-155` | survives verbatim |
| **5000-row cap** → 22023 | `:160-162` | survives verbatim: `IF jsonb_array_length(p_rows) > 5000 THEN RAISE … ERRCODE = '22023'`. See "where the cap lives" below. |
| empty-array guard → 22023 | `:166-168` | **MUST BE ADAPTED**, not copied: the fold must accept an EMPTY array as the legitimate `fmt='trades'` no-series case. Today the route simply skips the persist call when `rows.length === 0` (`route.ts:521` `if (rows.length === 0) return null;` and the enqueue gate `route.ts:1403`); inside the fold that skip becomes `IF jsonb_array_length(p_rows) > 0 THEN <insert> END IF`. The route continues to 400 an empty series for `daily_returns`/`daily_nav` pre-create (`route.ts:1116-1131`), so the DB-side guard's only reachable empty case is trades. |
| upsert `ON CONFLICT (strategy_id, date) DO UPDATE` | `:173-181` | For a freshly-minted `strategy_id` a conflict is impossible (no prior rows can exist for an id created in this transaction), and duplicate dates within the payload are rejected at the route (`route.ts:233-241`). A plain INSERT is honest; keeping the upsert shape is harmless. Planner's call — but if the upsert is kept, do not let anyone cite it as the retry mechanism (the retry story changed; see below). |

### Where the 5000-row cap lives at HEAD, and where it moves

Current enforcement, both layers verified:
1. **Route boundary (load-bearing):** `route.ts:87` `const MAX_DAILY_RETURNS_ROWS = 5000;` and the reject at `:146-152` (message cites the literal cap). This is CONTEXT's ":1152-1157 5000-row cap note" — at THIS head the B15 comment block sits at `:1152-1157` and the cap enforcement itself at `:87` + `:146-152`.
2. **RPC defense-in-depth:** `20260522111839:160-162` (22023).

Under the fold: the route layer is UNCHANGED (it validates before any dispatch on both (i-a) and (i-b)); the RPC cap moves verbatim into the folded function. Under (i-a) the Python hop merely relays the already-validated array — it must NOT re-implement validation (one gate, one place; Python's contribution is transport).

### The partial-unique index interaction — the retry story CHANGES, for the better

The fence: `strategies_user_wizard_session_source_uniq ON (user_id, wizard_session_id, source) WHERE wizard_session_id IS NOT NULL` (`20260728120000:167-169`). The fold keeps the `wizard_session_id` write, so a duplicate submit still raises 23505 — but now the rollback covers the dailies too. Consequences, worked through:

- **Window B/C failure under the fold → NOTHING committed.** The user's instructed retry (`CSV_SUBMIT_FAILED` copy says "Submit again") arrives as a **clean first submit**: no existing row, no 23505, no resolve arm. The fold does not merely shrink windows B/C — it deletes the retry-races-cleanup problem CONTEXT flagged for option (ii).
- **A 23505 now has exactly ONE meaning: a prior attempt FULLY committed** (strategy + verification + dailies, all-or-nothing). That is window A (response lost after commit). The resolve arm therefore no longer needs to persist anything — the dailies are guaranteed present — it only needs to (1) re-fetch the existing row scoped `(user_id, wizard_session_id, source='csv')` exactly as today (`process_key.py:1191-1204`, with the C-08 tenant-scope reasoning at `:1179-1190`), (2) run the CR-01 **name comparison** (`process_key.py:1258-1269`), and (3) run the CR-01 **range comparison** as a READ against the committed dailies (same predicate as `route.ts:568-573`: any row outside `[min,max]` of this payload → refuse 409). Then echo the existing id at 200.
- ⭐ **The CR-01 fence MOVES but does not weaken — and its write-blocking half becomes vestigial.** Today the fence guards a *merge-writing upsert* (file B's rows landing on strategy A). Under the fold there IS no standalone persist onto an existing strategy — the only write path to dailies creates the strategy in the same transaction. The fabrication mechanism is gone; what remains is the *reporting* hazard (echoing strategy A's id for file B's submission), which the resolve arm's name+range checks close. The five tests in `csv-finalize-cross-submission-merge.test.ts:202-260` must be re-pointed at the resolve arm and each observed RED (locked decision). The economic oracle to pin: **a strategy's persisted series equals exactly the file that was submitted** — never the fence's own predicate.
- The 23505-resolve arm lives in Python today (`process_key.py:1160-1269`). Under (i-b) it must move to the route (TypeScript); under (i-a) it stays in Python with the persist half deleted. Either way the CR-01 comparisons move with it and their RED must be re-observed.

### The two callers, and what each costs (decision deferred to §3's measurement — founder ruling 2)

| | (i-a) Python calls the fold | (i-b) route calls the fold directly |
|---|---|---|
| Wire change | `daily_returns_series` added to the `/process-key` body (`postProcessKey` args, `src/lib/process-key-client.ts`) | none — the CONTRIB-02 path (`route.ts:1469-1489`) is the existence proof and becomes the shape of BOTH paths |
| Window A | survives but downgraded: a lost response now strands a CONSISTENT strategy+dailies+no-job state = **window D, healed by 143** | **ceases to exist** (hop 0 removed) |
| Phase 106 Stage B "unified backbone is the sole finalize path" (`route.ts:1216-1221`) | preserved | **reversed for this flow** — this is why the founder reserved the choice |
| Python csv-finalize branch (`process_key.py:1117-1269`) | rewritten to call the fold + slimmed resolve arm | becomes DEAD CODE — must be deleted, and its tests (`test_process_key.py:2164-2266`, `:3889+`, `:4033+`) retired/re-pointed; leaving it live is a second writer and a drift bomb |
| Seam budget | csv stays on `process-key-sync` (60s; `process-key-client.ts` `budgetKeyFor`) — body grows ~280 KB (§3) | one fewer 280 KB hop; the 60s budget row keeps serving csv-validate |
| `X-User-Access-Token` forwarding | kept | no longer needed for finalize (SSR cookie client is natively user-scoped, `route.ts:1441-1445` comment) — but MUST be kept for nothing-else-uses-it verification before removal |

**Common to both:** the old 5-arg `finalize_csv_strategy` and the standalone `persist_csv_daily_returns` must be explicitly dispositioned — either DROPped (then `supabase/tests/test_csv_finalize_double_submit.sql` and `test_wizard_session_idempotency.sql` MUST be re-pointed in the same PR, §7 — the exact Phase-144-§8 trap) or kept as deprecated shims (then the source-scan/drift risk must be named). Recommend DROP + re-point: two writers converging on one function is the point of the phase.

**Migration-reviewer invariants that apply for real here** (a NEW SECURITY DEFINER surface taking caller-supplied JSONB): pinned `search_path` (`SET search_path = public, pg_catalog` — both parents do this), `REVOKE FROM PUBLIC, anon` + `GRANT TO authenticated` only, every caller-supplied value validated before use, self-verifying DO block asserting `prosecdef`, grants, and the INSERT-fragment writes (copy the `20260728120000:327-425` STEP-4 idiom incl. its anchor-drift guard).

---

## §2 — The TERMINALIZE arm for windows A–C (Q2, founder-locked reading β)

### The `strategies.status` vocabulary at HEAD — verified, and there is NO 'failed'/'abandoned' value

The CHECK constraint was created inline in `20260405061911_initial_schema.sql:63` and redefined ONCE, by `20260716130000_strategies_status_private.sql:58-61` — verbatim:

```sql
  DROP CONSTRAINT IF EXISTS strategies_status_check;
ALTER TABLE …
  ADD CONSTRAINT strategies_status_check
  CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private'));
```

**Allowed values (exact, 5):** `draft`, `pending_review`, `published`, `archived`, `private`. [VERIFIED: supabase/migrations/20260716130000_strategies_status_private.sql:58-61; grep of all migrations for `strategies_status_check` returns only this file — the original was inline/unnamed-then-named per its own header `:15-17`]

⇒ **Phase 144's `user_message` lesson applies exactly:** there is no failed/abandoned status to write. The plan must NOT invent one, and adding one via a CHECK redefinition is a heavyweight change (every status-reading query, the RLS read policy, the publish-transition trigger, discovery, and the admin queue key on this closed set) that reading (β) does not require.

### What the vocabulary DOES offer, and the recommended terminalize shape

- **`archived` is the existing terminal/hidden value with settled UI semantics.** The W-4 ruling (2026-08-05) is codified at `src/lib/queries.ts:285-287` — *"archived rows [are excluded] … archived is not coverage"* — and enforced by `.neq("status", "archived")` at `queries.ts:312` (getMyStrategies) and `:361` (the owner-has-any check). An archived orphan disappears from /my-strategies, from Phase 143's candidate set (`20260816140000:722` `WHERE s.status <> 'archived'`), and from the CONTEXT census query (1) (same filter).
- **The user-visible "real outcome" surface on the CSV path is `strategy_analytics`, not `strategies.status`.** The wizard's SyncProgress poller breaks out on `computation_status='failed'` + renders `computation_error` — this is precisely why window C already writes the `failed` placeholder (`route.ts:640-648`) and window B's lack of one is part of its defect.
- **Recommended terminalize = the pair:** `strategy_analytics` upsert `computation_status='failed'` + `computation_error` naming the orphan-reap reason (the reason string is the "with a reason" half of the founder ruling), THEN `strategies.status='archived'` (the audit-trail-preserving, UI-honest half). Both writes are established patterns; neither invents vocabulary.

### Triggers on `strategies` — ⛔ CONTEXT correction, and why the terminalize UPDATE passes all three

CONTEXT.md asserts "no trigger on `strategies` in any migration". **False at HEAD** — three exist, verified by grep + reads:

| Trigger | Source | Fires on | Blocks a terminalize UPDATE? |
|---|---|---|---|
| `strategies_reject_sentinel` | `20260515114310:231-234` | BEFORE INSERT OR UPDATE | No — only rejects `name` values matching `'[deleted%'` from `current_user IN (authenticated, anon)` (`:202-206`) |
| `guard_strategies_publish_transition_trigger` | `20260716131000:76-80` | BEFORE INSERT OR UPDATE | No — only blocks transitions INTO `'published'` when `current_user='authenticated'` (`:51-58`); a service-role or SECDEF write to `'archived'` is untouched |
| `trg_strategies_team_review_mark_guard` | `20260806120000:487-491` | BEFORE UPDATE **OF capital_ownership** | No — column-targeted; a status flip never evaluates it |

### What retention would collect a terminalized row — and the answer is NOTHING, which is fine under reading β

The only cron that deletes `strategies` rows is `cleanup_abandoned_wizard_drafts` (`20260713120000:93-96`), predicate verbatim:

```sql
    DELETE FROM strategies
     WHERE source='wizard' AND status='draft' AND review_note IS NULL
       AND created_at < now() - interval '7 days'
```

A CSV orphan is `source='csv'`, `status='pending_review'` (or `'private'`) — **outside this predicate on two columns**, and after terminalization (`'archived'`) still outside it. No other retention/cleanup migration touches `strategies` (grep over `*retention*.sql` / `*cleanup*.sql`, this session). ⇒ **Nothing collects a terminalized strategy row, and nothing needs to:** reading (β)'s register (from 144: "the row must survive so the audit trail holds") makes the surviving archived row the desired end-state, not a leak. CONTEXT's phrase "retention collects it later" is aspirational, not mechanical — say so in the SUMMARY rather than implying a collector exists.

### Do NOT build an A/B/C sweep — the disposition mechanism for the residual population

The founder locked *what happens to an orphan* (terminalize), not *that a new cron must exist*. Strong recommendation: **no new sweep.**

1. **The signal problem is unsolved by construction.** CONTEXT itself: an A/B/C orphan is byte-identical to the wizard first-hop drop ("no dailies AND no jobs" = a brand-new strategy), which 143 filed as non-coverage for exactly that reason (`20260816140000:256-278`). Any predicate distinguishing them needs a signal that does not exist in the schema. A sweep would inherit 143's false-positive problem with a DELETE-adjacent action instead of an enqueue.
2. **The fold makes the windows unreachable prospectively** (§1) — a sweep would guard a class the same PR extinguishes.
3. **The residual population is finite and measured.** The CONTEXT census queries (1)/(2) (⚠️ UNVERIFIED — must run in the orchestrator session on PROD `khslejtfbuezsmvmtsdn` and TEST `qmnijlgmdhviwzwfyzlc` before scoping) bound it. Terminalize those specific ids **once, by hand, in the orchestrator session**, with the id list committed in the phase artifact. Human review of a finite list is the "different signal" — a person distinguishing "CSV orphan" from "wizard first-hop drop" by looking at `source`, `wizard_session_id` and `strategy_verifications` presence, which the queries expose per-row.
4. If a zero census comes back on both projects, the terminalize arm is a no-op and the phase records that — the same budget-saving shape as 144's SC#4.

⛔ JOB-07 note: nothing here touches the worker loop — a one-time orchestrator-session SQL pass has no asyncio surface at all.

---

## §3 — The founder-mandated (i-a) vs (i-b) measurement (Q3)

### Half 1 — payload size: MEASURED THIS SESSION (reproducible)

Command (commit it with the artifact so the number is re-derivable):

```bash
node -e '
const rows=[];const d=new Date(Date.UTC(2006,0,1));
for(let i=0;i<5000;i++){rows.push({date:new Date(d.getTime()+i*86400000).toISOString().slice(0,10),daily_return:0.0123456789012345});}
const body={flow_type:"csv",source:"csv",context:{wizard_session_id:"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",fmt:"daily_returns",strategy_name:"Measured Strategy Name",user_id:"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",step:"finalize"}};
console.log("envelope alone:",Buffer.byteLength(JSON.stringify(body)));
console.log("5000-row series:",Buffer.byteLength(JSON.stringify(rows)));
console.log("envelope+series:",Buffer.byteLength(JSON.stringify({...body,daily_returns_series:rows})));'
```

Results (2026-08-17, this session):

| Payload | Bytes |
|---|---|
| Current `/process-key` csv-finalize body (no series) | **235 B** |
| 5000-row series, 16-significant-digit floats | **280,001 B** (~274 KiB) |
| 5000-row series, worst case (negative, 17 digits) | 290,001 B |
| 5000-row series, typical 4-decimal returns | 220,001 B |
| Envelope + series | **280,260 B** |

Context for the number: the series **already** crosses two seams today — Railway→Vercel in every csv-validate response (it is *born* in Python: `csv_validator.py:885-886` `envelope["daily_returns_series"] = daily_returns_series`, returned to the client, held in wizard state, re-POSTed at finalize per `CsvSubmitStep.tsx:65` and `:264`) and Next→Supabase PostgREST at hop 4 on every finalize (`route.ts:614-623`). So:

- **(i-a) net new movement:** ONE additional ~280 KB crossing (Next→Railway), then Railway→PostgREST carries what Next→PostgREST carries today. Two crossings total for the rows.
- **(i-b) net new movement:** ZERO — the rows keep the single Next→PostgREST crossing they make today, now as an argument of the folded RPC instead of `persist_csv_daily_returns`.
- Platform caps: 280 KB is far under Vercel's serverless request-body limit (~4.5 MB [ASSUMED — platform knowledge, not re-verified this session; the live measurement below settles it empirically]) and FastAPI/uvicorn impose no default body cap [ASSUMED — same]. No repo middleware caps the body (grep of `analytics-service/main.py`, no `middleware/` dir).

### Half 2 — latency: the exact runnable steps for the plan (orchestrator session, TEST only)

**Step A — marginal seam cost of the series (no side effects).** POST the 280 KB body to TEST Railway `/process-key` with a valid `INTERNAL_API_TOKEN` but **no `X-User-Access-Token`** — the csv-finalize branch 401s at `process_key.py:1136-1146` AFTER FastAPI has received and pydantic-parsed the full body (the handler signature demands the parsed model), so the timing isolates upload+parse without writing anything:

```bash
# payload.json = envelope+series from Half 1; control.json = envelope alone
for f in control.json payload.json; do for i in 1 2 3 4 5; do
  curl -s -o /dev/null -w "$f %{size_upload} %{time_total}\n" \
    -X POST "$RAILWAY_TEST_URL/process-key" \
    -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
    -H "Content-Type: application/json" --data @"$f"
done; done
```

Marginal (i-a) seam cost = median(payload) − median(control). ⚠️ The slowapi limiter (`process_key.py:874-875`) counts these; five reps each is inside any sane budget on TEST, but check the limiter values first rather than assuming.

**Step B — end-to-end (i-b)-equivalent cost, which is also the SC#3 baseline.** Two live finalizes on TEST via the real route (passwordless service-role magic-link → `setSession` → `curl`, the repo's authed-prod idiom): one 10-row file, one 5000-row file. Record total wall-clock each. The 5000−10 delta bounds today's Next→PostgREST persist cost for a full-cap series (hop 4), which is the cost the folded call inherits under (i-b). ⚠️ This doubles as SC#1 arm 4 (§4) — capture the row-state baseline in the same run.

**Step C — the memo.** One table: `payload bytes | marginal Next→Railway cost (A) | full-cap persist cost (B delta) | route total (B)`. Decision rule to propose to the founder (who retains the choice): if (A) is small relative to (B)'s total — expected, at 280 KB on an intra-cloud hop — the choice is NOT latency-driven and should be made on the architectural axis alone (Phase 106 Stage B reversal vs seam-payload growth). The measurement's job is to *retire the latency argument*, whichever way it points.

⛔ Do not run Step A against PROD (limiter consumption + junk 401 noise in Sentry); do not run Step B against PROD at all (it mints real strategies).

---

## §4 — The four reproduction arms for SC#1, made mechanically executable (Q4)

Pre-registered expected outcome (from CONTEXT, re-verified at HEAD): **arm 1 GREEN (guard fires), arms 2/3/4 GREEN (no path reaches it) ⇒ CANNOT REPRODUCE — the GUARD is live, the PATH is closed.** The artifact (145-REPRODUCTION.md or SUMMARY section, planner's call) must be committed BEFORE any SC#2 code.

### Arm 1 — positive control: the 42501 guard still fires (becomes a permanent CI gate)

New file `supabase/tests/test_csv_finalize_auth_guard.sql` (or a new part of `test_csv_finalize_double_submit.sql` — planner's call; a separate file keeps a structural failure from aborting the behavioral parts, per that file's own header reasoning at `:11-14`). Use the repo's claims idiom, verbatim from `test_csv_finalize_double_submit.sql:119/:230/:285`: `PERFORM set_config('request.jwt.claims', <json with sub>, true)` to drive `auth.uid()`, `PERFORM set_config('request.jwt.claims', NULL, true)` to clear it. Plain PL/pgSQL `DO $$` blocks, per-part `BEGIN; SET LOCAL lock_timeout='5s'; … ROLLBACK;`, NO psql backslash meta-commands, ungated Part 1 (no green-skip presence gate — 144-RESEARCH §8's anti-pattern).

- **Part A (no session):** clear claims; call `public.finalize_csv_strategy(<uuid>, <uuid>, 'daily_returns', 'guard probe', 'pending_review')` inside `BEGIN … EXCEPTION WHEN insufficient_privilege THEN` capturing `SQLERRM`; assert SQLSTATE `42501` **and** `SQLERRM = 'finalize_csv_strategy called without an auth session'` (the exact string, `20260728120000:226`). PASS = raise observed with both properties. FAIL = call returns, or any other SQLSTATE/message.
- **Part B (wrong identity):** set claims with `sub` = user X (a seeded auth.users row, following the seeding pattern in `test_csv_finalize_double_submit.sql`); call with `p_user_id` = user Y; assert `42501` with the mismatch message shape (`20260728120000:230-234`). PASS/FAIL as above.
- **Neuter-RED proof:** temporarily point Part A at a claims-set call (guard satisfied) → the gate must go RED (expected raise absent). Observe, restore, record.
- ⚠️ When the folded function lands, this gate must be extended (not replaced) to assert the SAME two raises on the fold — the gate's purpose is that a future service-role caller reds in CI instead of 42501-ing in production.

### Arm 2 — negative control: fresh call-site grep (MUST be re-run at execution time, not copied)

```bash
grep -rn "finalize_csv_strategy" src/ analytics-service/ --include="*.ts" --include="*.py" \
  | grep -v -e test -e __tests__ -e "\.types\.ts"
```

For each hit, classify: call site vs mention. Expected observed output at HEAD `1e3004d9` (fresh grep, this session): exactly **2 call sites** — `route.ts:1483` (`)("finalize_csv_strategy", {…, p_terminal_status: "private"})` on the SSR cookie client from `createClient()` at `:1461`) and `process_key.py:1150-1151` (`user_sb.rpc("finalize_csv_strategy", …)` on the client from `get_user_scoped_supabase(user_token)` at `:1148`); remaining hits are comments/docstrings (`process-key-client.ts`, `wizardErrors.ts`, `draft-query.ts`, `analytics-schemas.ts`, `csv.py`, `db.py`, `queries.ts`) and generated types. PASS = every call site's client is user-scoped (SSR cookie session or `get_user_scoped_supabase`); FAIL = any call on `get_supabase()` (the `lru_cache`'d service-role singleton, `db.py:70-77`) or `createAdminClient()`. Record the grep output verbatim in the artifact.

### Arm 3 — the existing Python gates, run and recorded verbatim

```bash
cd analytics-service && python3 -m pytest tests/test_process_key.py -k "csv_finalize" -q
```

⛔ MUST run from `analytics-service/` (repo-root runs miss VCR cassettes → LIVE broker calls); use `python3`. Expected collected tests include `test_process_key_csv_finalize_calls_finalize_csv_strategy_rpc` (`:2164` — asserts finalize ran on the user client AND `svc_finalize == []`), `test_process_key_csv_finalize_without_user_token_returns_401` (`:2234` — asserts `mock_user_client.assert_not_called()`), the PYAPI-09c pair (`:3889+`), and `test_seamrim03_csv_finalize_23505_answers_200_with_existing_strategy` (`:4033`). PASS = all green; record the tail verbatim. **The artifact must say explicitly: these are mock-level and prove WIRING, not absence-of-42501** — the overclaim guard CONTEXT mandates.

### Arm 4 — one live end-to-end finalize on TEST (orchestrator session ONLY — Supabase MCP is stripped from subagents)

Passwordless idiom: service-role magic-link for a test user → `setSession` → `curl -X POST $TEST_APP_URL/api/strategies/csv-finalize` with a small `daily_returns_series` (10 rows), fresh `wizard_session_id`, `fmt='daily_returns'`, a name, minimal valid metadata. PASS = HTTP 200, body `ok: true` + UUID `strategy_id`; FAIL = any `42501` in any layer's logs, or `CSV_FINALIZE_FAIL`. Then capture the **row-state baseline** (this is also SC#3's measured before-state and §3 Step B's first run):

```sql
SELECT id, status, source, wizard_session_id, created_at FROM strategies WHERE id = :sid;
SELECT status, trust_tier, flow_type, source FROM strategy_verifications WHERE strategy_id = :sid;
SELECT count(*) FROM csv_daily_returns WHERE strategy_id = :sid;   -- expect 10
SELECT kind, status FROM compute_jobs WHERE strategy_id = :sid;     -- expect compute_analytics_from_csv
SELECT computation_status FROM strategy_analytics WHERE strategy_id = :sid;
```

### The live census the plan must take before scoping SC#2 (⚠️ UNVERIFIED — orchestrator session)

Run CONTEXT's four census queries (CONTEXT.md `:310-341`) verbatim on BOTH projects. Interpretation is pre-registered in CONTEXT `:343-346`: zero on both = prospective hardening (ship anyway, like 143); non-zero on PROD = re-rank to live cleanup and the §2 one-time terminalize gets a real id list. ⚠️ Query (1) minus (2) is the wizard first-hop population — it must NOT be absorbed into 145.

---

## §5 — The two honesty defects, scoped (Q5)

### Defect 1 — the copy: THREE sentences move together, not two

Verified at HEAD:

| Arm | Site | Current copy | Truth today | Truth under the fold |
|---|---|---|---|---|
| 503 `CSV_PERSIST_FAIL` (stale-probe read failed) | `route.ts:589-591` | "We could not confirm what is already saved for this strategy, so we stopped before writing. **Nothing was changed.** Try again shortly." | **FALSE** — `finalize_csv_strategy` committed strategies + strategy_verifications milliseconds earlier (and the metadata UPDATE may have applied) | TRUE — a probe/fence failure inside the fold rolls everything back. Under the fold the arm itself changes shape (the probe moves into the resolve arm); whatever 5xx remains must say "nothing was saved — try again", and it becomes accurate |
| 409 `CSV_SESSION_REUSED` (stale rows found) | `route.ts:601-611` (sentence at `:606`) | "This strategy already holds a different track record, so we stopped before writing. **Nothing was changed.** Start a new strategy…" | ⚠️ **ALSO FALSE, differently — CONTEXT missed this:** the 409 is reachable only via the 23505-resolve to an existing strategy, and hop 2 (`applyCsvMetadataUpdate`, `route.ts:1378-1385`) has ALREADY overwritten that strategy's metadata with THIS submission's values before the fence refuses at hop 3. The refusal is real; "nothing was changed" is not | TRUE if the resolve arm re-orders identity checks BEFORE any metadata write — the fold's resolve arm must run name+range checks first, which also fixes this |
| 500 `CSV_PERSIST_FAIL` (persist RPC failed) | `route.ts:652-655` | "**Your strategy was created** but the daily-return data could not be saved. Contact support…" | TRUE (honest today) | **BECOMES FALSE** under the fold — nothing survives a failed fold. Must become "Nothing was saved. Try again…", and CONTEXT's warning inverts: this copy would lie in the OTHER direction if left alone |

Minimal fix: the copy changes land in the SAME plan/wave as the mechanism change (they are assertions about the mechanism); a TS route test pins each sentence against the arm's observable state (neuter: revert copy → RED).

### Defect 2 — the vacuous `RED-TEAM-M1` test

`src/__tests__/csv-finalize-c14-regression.test.ts:144-190`, verified: the single `it` drives the **pre-create** 400 (`metadata: { aum: "-999" }` → rejected at `route.ts:1138-1150`, RPC never called), then asserts `captureToSentry` was **NOT** called with a message containing `"orphan strategy row"` — a string that (fresh grep, this session) **does not exist anywhere in `src/`**. Its own comments admit the post-RPC path is unreachable from the body alone (`:164-176`). The assertion is vacuously true forever; per the founder rule it is worse than none.

**Recommended disposition: DELETE the describe block, and replace it in the same commit with gates that CAN fail** (the guarantee it names — "post-RPC metadata 400 orphan capture" — is superseded by whichever SC#2 mechanism lands, which is the deletion condition CONTEXT's discretion clause sets):
- a test that mocks the stale-probe read to fail and asserts the 503 arm calls `captureToSentry` with `step: "stale-probe-fail"` + the corrected copy (neuter: remove the capture call → RED — the exact shape of the four existing tests in `csv-finalize-after-failloud.test.ts:207-291`);
- a test that mocks the persist RPC to error and asserts `step: "persist-fail"` capture + placeholder + the corrected copy.

If the planner instead repairs it (implements a real post-RPC orphan capture), the test must be shown RED against the pre-fix route first. Either way: **neuter → observe RED → restore**, recorded, for every assertion touching this file — it has already hosted one test named for a guarantee that never existed.

---

## §6 — Sentry coverage for windows B and C (Q6)

### Current state, verified: B and C have ZERO captures on the failure itself

- **Window B** (stale-probe read fails → 503): `route.ts:580-584` is `console.error` only.
- **Window C** (persist RPC fails → 500): `route.ts:625-633` is `console.error` only. The captures inside `writeFailedStrategyAnalyticsPlaceholder` (`:736`, `:783`, `:801`) fire only when the *placeholder write itself* fails — the persist failure that triggered it is never captured.
- Every OTHER backend-failure arm in this file already captures: metadata-update (`:933`), enqueue error/throw (`:836`, `:849`), contribution finalize-RPC (`:1514`). B and C are the anomaly.

### The helper and its contract (verified)

`captureToSentry(err, { tags, extra?, level?, secrets? })` — `src/lib/sentry-capture.ts:191-205`. `tags` is required; scrubbing is folded in at this chokepoint (SEAMCORE-06); it RETURNS the import chain (SEAMRIM-04) but an unused return is legal, and both new sites run in the request path (not `after()`), so no explicit scheduling is needed — matching the file's existing in-path call sites. ⚠️ Pass the per-request `secrets` option if any raw error could carry the forwarded JWT; on these two arms the error objects are PostgREST errors already routed through `scrubSeamError` for the console line — mirror `:933-936`'s shape.

### Exact placements + tag discipline (the file's own convention, continued)

| Site | Insert after | Call |
|---|---|---|
| Window B | the `console.error` at `route.ts:580-584`, before the 503 return | `captureToSentry(staleErr, { tags: { surface: "csv-finalize", step: "stale-probe-fail" }, extra: { strategy_id: strategyId, correlation_id: opts.correlationId } })` |
| Window C | the `console.error` at `route.ts:625-633`, before the placeholder write | `captureToSentry(persistError, { tags: { surface: "csv-finalize", step: "persist-fail" }, extra: { strategy_id: strategyId, correlation_id: opts.correlationId } })` |

`step` values must be NEW (grep-unique) — the existing taken values in this surface are `placeholder-precheck`, `placeholder-upsert`, `placeholder-upsert-throw`, `csv-analytics-enqueue`, `csv-analytics-enqueue-throw`, `metadata-update`, `finalize-rpc`.

### Marker/dedupe discipline — what Phase 143's heal-identity lesson does and does not require here

143's lesson (`analytics-service/main_worker.py:344-368`): an alert that can re-fire for the same underlying event must be keyed on a **stable event identity** (job id + `detected_at` marker), never on a mutable counter (`attempts <= 1` LOST the alert in the crash case). That applies to *loop-emitted* alerts. The two new captures here are **request-scoped, one-shot** — one failure, one capture, keyed by `correlation_id` in `extra` — so no marker is needed and inventing one would be ceremony. If a storm is a concern (a Supabase outage failing every finalize), `shouldCaptureNow(key)` (`sentry-capture.ts:272-281`, 60 s window) is the sanctioned throttle — recommend NOT adding it initially: finalize volume is low, and the WR-06 throttle exists for the seam's highest-volume paths, which this is not. Under the fold, the two arms collapse into one folded-RPC error arm — carry ONE capture there (`step: "finalize-fold-fail"`) plus the resolve-arm refusal warn, and retire the two step names with the arms that emitted them.

Gates: one TS test per capture, in the `csv-finalize-after-failloud.test.ts` idiom (its four existing tests at `:207-291` are the exact template — they assert tags.step AND that the console line survives). Neuter-RED each.

---

## §7 — CI gates: what guards this surface today, what this phase adds (Q7)

### Existing gates, verified (and one that does NOT run in CI)

| File | What it pins | Phase 145 impact |
|---|---|---|
| `src/app/api/strategies/csv-finalize/route.test.ts` | CONTRIB-02 private-by-default (`:187`), SEAMRIM-05 limiter deny (`:209`), TS-13 `ok`/`isUuid` (`:400`) | Must stay green; CONTRIB-02 describe is the SC#3 `p_terminal_status` wire-level gate |
| `src/__tests__/csv-finalize-after-failloud.test.ts` | 4 D7 fail-loud Sentry paths (`:207-291`) | Template for §6's new tests |
| `src/__tests__/csv-finalize-cross-submission-merge.test.ts` | 5 CR-01 arms (`:202-260`) incl. fail-closed (`:260`) | **Re-point at the resolve arm, each observed RED** (locked decision) |
| `src/__tests__/csv-finalize-c14-regression.test.ts` | C14 metadata/validation fixes; `:144-190` is the vacuous block | §5 rebuild/delete |
| `src/__tests__/csv-finalize-rpc.test.ts` | live-DB behavioral RPC tests | ⛔ **skipIf live-DB — NEVER runs in CI** (`:314` "advertises skip reason when live DB is unavailable"; standing rule: `*_live.py` + skipIf vitest never run in CI). Do not count it as a gate; do not "fix" the fold by editing only it |
| `analytics-service/tests/test_process_key.py:2164-2266, :3889+, :4033+` | user-client wiring, no-token 401, 23505-resolve answer shape | Arm 3 runs them; (i-b) retires/re-points them, (i-a) rewrites the mocks |
| `supabase/tests/test_csv_finalize_double_submit.sql` | the REAL RPC against real Postgres: parts 1-4 (first submit, 23505, rollback-of-both, cross-source control) | ⛔ **Calls `finalize_csv_strategy` by name — reds the moment the 5-arg function is DROPped.** Re-point in the SAME PR (the Phase-144-§8 trap, same shape). Part 3's rollback assertion must widen to THREE tables under the fold |
| `supabase/tests/test_wizard_session_idempotency.sql` | the partial-unique index structure | Unaffected by the fold (index untouched) — verify, don't assume |
| `supabase/tests/test_strategies_private_owner_isolation.sql` | `'private'` row isolation | Unaffected; SC#3-adjacent |
| CI wiring | vitest shards + `frontend-coverage` merge job (blocking); `sql-tests` job discovers `supabase/tests/test_*.sql`; pytest job (⚠️ known 05:30-UTC TEST-DB backlog flake — deterministic 10 failures, not this phase's signal) | RLS/SQL gates MUST live in `supabase/tests/test_*.sql` to run at all |

### New gates this phase needs (closest analog named for each)

1. **`test_csv_finalize_auth_guard.sql`** (§4 arm 1) — analog: `test_csv_finalize_double_submit.sql`'s claims idiom + `test_guard_wizard_draft_updates_auth_uid.sql`'s auth-guard shape.
2. **Folded-RPC behavioral gate** (new parts in the re-pointed double-submit file, or a sibling): the **atomicity oracle** — call the fold with a payload engineered to fail AFTER the strategies INSERT would have run (e.g. a `p_rows` element whose `date` cast raises 22P02/22007, bypassing the route validator by calling the RPC directly), then assert **ZERO** strategies rows, ZERO verification rows, ZERO dailies for that session — the assertion that makes "no orphan" checkable at the deployed body. Plus: `p_terminal_status='private'` writes `status='private'` (SC#3); empty `p_rows` array + `fmt='trades'` succeeds with zero dailies; 5000-cap 22023; 23505 rolls back all three tables. Analog for structure/discipline: `test_reconcile_dropped_enqueue_sweep.sql` (per-part BEGIN/ROLLBACK, ungated Part 1, EXECUTE-the-real-object, century-backdating where aging is needed).
3. **TS route tests** for the three copy sentences (§5) and the two captures (§6) — analogs: `route.test.ts` CONTRIB-02 describe; `csv-finalize-after-failloud.test.ts`.
4. **The SC#1 artifact's arm 1** doubles as gate #1 — one file serves both.

**Every new gate: neuter → observe RED → restore, recorded in the SUMMARY.** Inherited green is nothing in a file that already contains RED-TEAM-M1.

---

## Runtime State Inventory

Not a rename — but the phase changes a live money-path flow, replaces a deployed SECDEF function, and (one-time) edits live rows. The equivalent inventory:

| Category | Items found | Action required |
|---|---|---|
| Stored data | The residual A/B/C orphan population — ⚠️ UNVERIFIED, census queries (1)/(2) on BOTH projects (§4) | One-time orchestrator-session TERMINALIZE of the measured id list (§2); no migration backfill |
| Stored data (2) | `feature_flags.process_key_unified_backbone` row — ⚠️ UNVERIFIED still present (seeded `20260510173005:280`) | ⛔ Do NOT flip/delete — `20260620120000:86-89` RAISEs at apply if it reads `off`. → TODOS (already deferred) |
| Live service config | `PROCESS_KEY_UNIFIED_BACKBONE` env var recorded as still set on Vercel prod + Railway (⚠️ UNVERIFIED, `106-RATIFICATION.md:16`). Zero code readers at HEAD (fresh grep this session: 3 hits, all comments/test-constants — `flag-monitor/route.ts:13`, `route.test.ts:131`, `csv_adapter.py:145`) | Inert; settle with `vercel env ls production \| grep -i PROCESS_KEY` and `railway variables …`. Cleanup deferred → TODOS |
| Live DB objects | Deployed `finalize_csv_strategy(uuid,uuid,text,text,text)` + `persist_csv_daily_returns(uuid,uuid,jsonb)` on BOTH projects | The fold migration DROPs/replaces them; apply to TEST via Supabase MCP (orchestrator session — MCP stripped from subagents), exercise, THEN merge (auto-applies to PROD). Never `supabase db push` |
| OS-registered state | None | — |
| Secrets / env vars | `INTERNAL_API_TOKEN` (route :1261) unchanged; `SUPABASE_ANON_KEY` required by `get_user_scoped_supabase` (`db.py:100-104`) unchanged | None |
| Build artifacts | `src/lib/database.types.ts` does not carry `finalize_csv_strategy`'s TS signature (the route casts through unknown, `route.ts:1463-1482`) — the fold continues the cast pattern or regenerates types | Planner's call; the cast is the established idiom |
| **CI gates carrying the OLD contract** | `test_csv_finalize_double_submit.sql` (names the 5-arg function), `csv-finalize-cross-submission-merge.test.ts` (tests the route-side fence), `test_process_key.py` csv-finalize tests | **Same-PR re-point** (§7) — the Phase-144-§8 class |

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Atomicity across strategy+verification+dailies | Compensating cleanup / saga in TS | ONE plpgsql SECURITY DEFINER body, no EXCEPTION block | Founder-locked preference; a Postgres transaction is the only mechanism that covers the crash sub-case; option (ii)'s races are enumerated in CONTEXT and dissolve under the fold (§1) |
| Orphan detection for windows A–C | A new pg_cron sweep | The fold (prospective) + one-time measured terminalize (retrospective) | The distinguishing signal does not exist; 143 filed the identical shape as non-coverage (§2) |
| A "failed" strategy status | A new `strategies.status` value | `strategy_analytics.computation_status='failed'` + `computation_error`, then `status='archived'` | The CHECK is a closed 5-value set (§2); the poller already renders the analytics surface |
| Sentry capture | Direct `import("@sentry/nextjs")` | `captureToSentry` (`src/lib/sentry-capture.ts:191`) | Scrub chokepoint (SEAMCORE-06); the JWT-bearing seam must never capture raw |
| Proving the deployed RPC | Re-typed predicates in tests | Call the REAL function in `supabase/tests/test_*.sql` with the claims idiom | `test_csv_finalize_double_submit.sql` header: the executable receipt vs the one-time grep |
| Idempotency answer shape | Bespoke dedupe logic | The partial-unique index + 23505 + resolve arm | "The migration owns the guarantee; the router owns the answer shape" (`20260728120000:89-92`) |
| Payload measurement | Estimating | §3's committed node one-liner + curl -w runs | Founder ruling 2 demands NUMBERS |

---

## Common Pitfalls

### Pitfall 1 — Re-basing the fold on a superseded parent
Copying the 4-arg (`20260501055202`) or pre-SEAMRIM-03 (`20260716130500`) body silently deletes the terminal-status guard or the `wizard_session_id` write. Parent = `20260728120000:196-311` ONLY. (PITFALLS.md and CHANGELOG.md:4512 both cite the superseded migration — correct them in this phase, per locked decision.)

### Pitfall 2 — Copying `persist_csv_daily_returns`'s empty-array 22023 guard verbatim
It breaks `fmt='trades'` (legitimately empty). The fold gates the insert on `jsonb_array_length(p_rows) > 0` instead (§1). Neuter-RED: a trades finalize through the fold must succeed with zero dailies.

### Pitfall 3 — Writing the fold against the OLD csv_daily_returns shape
The table has a surrogate PK, nullable `strategy_id`, a `num_nonnulls(strategy_id, api_key_id) = 1` XOR CHECK, and an owner-coherence trigger since `20260624120000`. An INSERT naming only `(strategy_id, date, daily_return)` is correct; anything cleverer must respect the XOR.

### Pitfall 4 — DROPping the old RPCs without re-pointing their SQL gate in the same PR
`test_csv_finalize_double_submit.sql` calls `finalize_csv_strategy` by name → `sql-tests` reds on a CORRECT migration (144-§8's exact failure mode).

### Pitfall 5 — Losing `p_terminal_status` (SC#3)
The default is `'pending_review'`; the contribution caller passes `'private'` explicitly (`route.ts:1488`). If the fold's caller signature drops the argument, private contributions silently enter the admin publish queue. Gate: the fold's SQL test asserts a `'private'` call writes `status='private'`; `route.test.ts:187`'s describe pins the wire.

### Pitfall 6 — Treating the 409 arm's metadata overwrite as out of scope
Hop 2 runs before hop 3, so a session-reuse refusal has already overwritten the resolved strategy's metadata (§5's third sentence). Under the fold, order the resolve arm: name check → range check → ONLY THEN metadata. Otherwise the fold ships with the same lie.

### Pitfall 7 — Counting `csv-finalize-rpc.test.ts` as CI coverage
It is skipIf-live-DB and never runs in CI. A fold "verified" only there is unverified.

### Pitfall 8 — Scoping SC#2 before the census
Phases 142/143/144 each had a standing claim falsified by measurement. Queries (1)-(4) run FIRST, both projects, orchestrator session.

### Pitfall 9 — Running the reproduction arms as a paraphrase
Arm 2 must be a FRESH grep at execution time (this document's table is dated evidence, not the artifact); arm 3's output recorded verbatim; arm 1 observed RED under neuter. A negative result is the easiest place to be vacuous.

### Pitfall 10 — Measuring (i-a) on PROD
Step A consumes limiter budget and pollutes Sentry with 401s; Step B mints real strategies. TEST only (§3).

---

## Code Examples

### The folded-RPC skeleton (shape only; every literal is sourced in §1 — re-verify each against the cited parent lines before writing the migration)

```sql
CREATE OR REPLACE FUNCTION public.finalize_csv_strategy_with_returns(
  p_user_id           UUID,
  p_wizard_session_id UUID,
  p_fmt               TEXT,
  p_strategy_name     TEXT,
  p_rows              JSONB,
  p_terminal_status   TEXT DEFAULT 'pending_review'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid    UUID := auth.uid();
  v_strategy_id UUID;
BEGIN
  -- Guards copied VERBATIM from 20260728120000:215-256, in the same order:
  -- terminal-status whitelist (22023) -> auth NULL (42501, exact message
  -- 'finalize_csv_strategy… called without an auth session' shape) ->
  -- identity mismatch (42501) -> fmt whitelist (22023) -> name guards (22023).

  -- Rows guards adapted from 20260522111839:153-162:
  --   typeof <> 'array' -> 22023 ; length > 5000 -> 22023 ;
  --   NO empty-array raise (empty = the trades no-series case).

  INSERT INTO strategies ( … 20260728120000:278-288 columns, incl. wizard_session_id … )
  VALUES ( … ) RETURNING id INTO v_strategy_id;

  INSERT INTO strategy_verifications ( … 20260728120000:299-305 … );

  IF jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO csv_daily_returns (strategy_id, date, daily_return)
    SELECT v_strategy_id, (e->>'date')::DATE, (e->>'daily_return')::DOUBLE PRECISION
      FROM jsonb_array_elements(p_rows) e;
    -- fresh strategy_id => no conflict possible; duplicate dates are a route-
    -- boundary 400 (route.ts:233-241). NO EXCEPTION block anywhere in this
    -- body: ANY failure (23505 on the session index included) rolls back all
    -- three inserts — that rollback IS the SC#2 mechanism.
  END IF;

  RETURN v_strategy_id;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_csv_strategy_with_returns(UUID,UUID,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_csv_strategy_with_returns(UUID,UUID,TEXT,TEXT,JSONB,TEXT) TO authenticated;
-- + STEP-4-style self-verifying DO block (20260728120000:327-425 idiom):
--   prosecdef, grants, INSERT-fragment writes wizard_session_id, body contains
--   the 5000 cap, body contains NO EXCEPTION block.
```

### The resolve arm's changed contract (caller side, pseudocode)

```text
try: id = rpc(fold, …rows…)
catch 23505:                         # ONLY reachable when a prior attempt FULLY committed (window A)
  row = select id,name from strategies
        where user_id=U and wizard_session_id=S and source='csv'   # C-08 scope, process_key.py:1179-1204
  if row.name != submitted_name: refuse 409          # CR-01 arm 1 (process_key.py:1258-1269)
  if any csv_daily_returns row outside [min,max] of THIS payload: refuse 409   # CR-01 arm 2, now a READ
  return 200 with row.id             # dailies guaranteed present — nothing to persist
```

---

## State of the Art

| Old approach | Current approach | When changed | Impact on this phase |
|---|---|---|---|
| Flag-gated legacy direct-RPC arm | Unified backbone sole manager-path writer; flag readers deleted | 106-07 / 106-10 | Why the 42501 bullet is unsatisfiable; arm 2's expected result |
| Service-role finalize call (the 42501 bug) | `X-User-Access-Token` → `get_user_scoped_supabase` (`db.py:80-111`, not cached) | Phase 19.1 (2026-05-27) | The already-shipped fix; ⛔ do not re-add |
| `(strategy_id,date)` composite PK on csv_daily_returns | Surrogate PK + per-key axis + XOR CHECK + coherence trigger | `20260624120000` | §1 Pitfall 3 — no prior phase doc carries this |
| 2-column session index | `(user_id, wizard_session_id, source)` partial unique | `20260728120000` | The 23505 the fold's rollback rides on |
| DELETE janitors | Terminal UPDATE, row survives (WR-02) | Phase 144 (`20260817120000`) | The register the founder's TERMINALIZE ruling extends to strategies |
| PITFALLS/SUMMARY anchors `~792-820`, migration `20260501055202` | `process_key.py:1119-1156`, `20260728120000` | this phase (locked decision) | Correct in the same commit |

---

## Package Legitimacy Audit

**Not applicable.** Zero external packages. The phase ships: one SQL migration, SQL test file(s), TS route + test edits, Python router edits (option-dependent), and planning artifacts. No `package.json` / `requirements.txt` / `pyproject.toml` change.

| Package | Registry | Verdict | Disposition |
|---|---|---|---|
| — | — | — | No packages introduced |

Packages removed due to `[SLOP]`: none. Packages flagged `[SUS]`: none.

---

## Environment Availability

| Dependency | Required by | Available to THIS agent | Available to orchestrator | Fallback |
|---|---|---|---|---|
| Supabase MCP (census, TEST apply, one-time terminalize, arm 4) | §2, §3-B, §4 | ✗ — stripped from subagents | ✓ | None — those tasks are orchestrator-session-only |
| `psql` + `TEST_SUPABASE_DB_URL` | `sql-tests` CI | ✗ | ✓ in CI | None |
| Railway TEST URL + `INTERNAL_API_TOKEN` | §3 Step A | ✗ | ✓ | None — measurement is orchestrator-session |
| `node` (payload sizing) | §3 Half 1 | ✓ (measured this session) | ✓ | — |
| `python3` + pytest from `analytics-service/` | Arm 3; (i-a) tests | ✓ locally (⚠️ pandera caveat: `pip install 'pandera==0.32.1' --break-system-packages` if csv_validator imports fail) | ✓ | — |
| `mypy --strict` | Any `analytics-service/` change, pre-ship | ✓ | ✓ | None — GSD gate runs pytest only; type errors latent till PR CI. `cast()`, never `# type: ignore` |
| GSD worktree caveat | executor plans | `npx vitest`/`npx tsc` FAIL in worktrees (no node_modules) | — | Run TS gates from the main checkout or install first |

**Blocking for the planner:** census, TEST apply + live exercise, terminalize pass, arm 4, and both §3 latency steps MUST be orchestrator-session tasks.

---

## Validation Architecture

### Test framework

| Property | Value |
|---|---|
| TS | Vitest (sharded, blocking coverage gate: lines 82 / stmts 80 / fns 74 / branches 72). Local flakes → `--no-file-parallelism`; CI = Node 22 (local 25 — CI-only failures reproduce via `PATH=/opt/homebrew/opt/node@22/bin`) |
| SQL | Plain PL/pgSQL under `psql -v ON_ERROR_STOP=1`; pgTAP NOT installed; `supabase/tests/test_*.sql` only |
| Python | pytest from `analytics-service/` only; `python3`; VCR cassettes |
| Quick run | `npx vitest run src/__tests__/csv-finalize-*.test.ts src/app/api/strategies/csv-finalize/route.test.ts` · `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_csv_finalize_double_submit.sql` · `cd analytics-service && python3 -m pytest tests/test_process_key.py -k csv_finalize -q` |
| Full suite | `npm run test:coverage` · `sql-tests` job · full pytest (⚠️ known TEST-DB backlog flake at 05:30 UTC) |

### Phase requirements → test map

| Req | Behavior | Type | Command | Exists? |
|---|---|---|---|---|
| JOB-06/SC1 | 42501 guard fires (both arms) | SQL gate | `psql … -f supabase/tests/test_csv_finalize_auth_guard.sql` | ❌ Wave 0 (§4 arm 1) |
| JOB-06/SC1 | No service-role caller | grep artifact | §4 arm 2, committed verbatim | ❌ Wave 0 |
| JOB-06/SC1 | Wiring green | pytest | §4 arm 3 | ✅ exists, run + record |
| JOB-06/SC1 | Live finalize 200+UUID | live (orchestrator) | §4 arm 4 | ❌ Wave 0 |
| JOB-06/SC2 | Mid-payload fault → ZERO rows in all three tables | SQL gate | fold behavioral gate (§7 #2) | ❌ Wave 0 |
| JOB-06/SC2 | 23505 rolls back all three | SQL gate | re-pointed double-submit part 3 | ⚠️ exists for two tables; widen |
| JOB-06/SC2 | Copy sentences match reality | vitest | §5 route tests | ❌ Wave 0 |
| JOB-06/SC2 | B/C Sentry captures | vitest | §6 tests (after-failloud idiom) | ❌ Wave 0 |
| JOB-06/SC3 | `'private'` survives the fold | SQL gate + route.test.ts:187 | §7 | ⚠️ wire half exists; SQL half Wave 0 |
| JOB-06/SC3 | Happy path unchanged, measured | live diff vs arm-4 baseline | orchestrator | ❌ Wave 0 |
| CR-01 | 5 arms re-pointed, observed RED | vitest | cross-submission-merge tests | ⚠️ exist; re-point |

### Sampling rate
- **Per task commit:** the quick-run trio above (scoped to touched layers).
- **Per wave merge:** full vitest coverage + `sql-tests`.
- **Phase gate:** all green + TEST-applied fold exercised live + census/terminalize artifacts committed, before `/gsd-verify-work` and the one-way merge.

### Wave 0 gaps
- [ ] `supabase/tests/test_csv_finalize_auth_guard.sql` (SC#1 arm 1)
- [ ] Fold behavioral SQL gate incl. the atomicity oracle + `'private'` + trades-empty + cap
- [ ] Re-point `test_csv_finalize_double_submit.sql` (same PR as the DROP)
- [ ] §5 copy tests + §6 capture tests; delete/rebuild RED-TEAM-M1
- [ ] Neuter-RED observation recorded for EVERY new/changed assertion

---

## Security Domain

| ASVS category | Applies | Standard control at HEAD |
|---|---|---|
| V2 Authentication | **yes** | `auth.uid()` guards inside the SECDEF fold (42501 pair, §1); JWT forwarding via `X-User-Access-Token` (i-a) or SSR cookie session (i-b); arm-1 gate makes guard-liveness a CI fact |
| V3 Session management | yes | `wizard_session_id` is caller-supplied — the C-08 rule stands: the tenant key LEADS every unique index and every re-fetch filter (`20260728120000:71-76`, `process_key.py:1179-1190`) |
| V4 Access control | **yes** | `REVOKE FROM PUBLIC, anon; GRANT TO authenticated` on the fold (⚠️ NOT service_role-only — that NULLs auth.uid(), `20260522111839:200-208`); RLS untouched; publish-transition trigger keeps `'published'` unreachable |
| V5 Input validation | **yes** | Route boundary is the load-bearing gate; the fold re-validates every caller-supplied value (fmt/name/status whitelists, array typeof, 5000 cap) — a new SECDEF surface taking caller JSONB is exactly where migration-reviewer invariants #3/#15/#19 bite (CONTEXT) |
| V6 Cryptography | no | — |
| V7 Error handling / logging | **yes** | `scrubSeamError` on every console line; `captureToSentry` chokepoint scrubbing; this flow's headers carry a LIVE user JWT (`route.ts:788-794` comment) — never capture raw |

| Threat | STRIDE | Mitigation |
|---|---|---|
| Service-role caller writes rows under another user | Elevation | The verbatim 42501 identity guards + arm-1 CI gate |
| Strategy-id enumeration via error shapes | Info disclosure | The probe-oracle collapse dissolves with its caller-supplied-id parameter (§1) — the fold takes no `p_strategy_id`; keep resolve-arm refusals uniform |
| Cross-tenant echo via caller-supplied session id | Info disclosure | Resolve re-fetch scoped `(user_id, wizard_session_id, source)` on the USER client (`process_key.py:1186-1201` reasoning) |
| Data fabrication via cross-submission merge | Tampering (money) | Fence moves into the resolve arm; economic oracle: persisted series == submitted file; 5 tests re-pointed with observed RED |
| Orphan DELETE destroying user-named rows | DoS/repudiation | Founder-locked TERMINALIZE; deletion arms out of scope; the one-time pass is UPDATE-only with a committed id list |
| JWT leakage via new capture sites | Info disclosure | `captureToSentry` scrub chokepoint + per-request `secrets` option (§6) |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | The A/B/C orphan census is small (or zero) on PROD | §2, §4 | Non-zero re-ranks to live cleanup (pre-registered in CONTEXT); the one-time terminalize absorbs it either way. Settle: census queries (1)/(2), both projects |
| A2 | Vercel serverless request-body cap (~4.5 MB) and no FastAPI/uvicorn default body cap | §3 | [ASSUMED — platform knowledge]. §3 Step A settles it empirically; at 280 KB the margin is ~16× even if the cap is 10× lower than assumed |
| A3 | The 401-before-side-effects property of §3 Step A (missing `X-User-Access-Token` after full body parse) | §3 | If FastAPI middleware rejects earlier, the measurement under-counts parse cost; verify by comparing Step A against Step B's delta. Handler code path read this session (`process_key.py:1135-1146` runs after model parse) — MEDIUM-HIGH |
| A4 | `PROCESS_KEY_UNIFIED_BACKBONE` env vars still set (inert) on Vercel/Railway | Inventory | Cosmetic; settle with the two CLI commands listed. Cleanup deferred regardless |
| A5 | The `feature_flags` row still exists reading `'on'` | Inventory | Only matters if someone "cleans up"; ⛔ constraint already documented (`20260620120000:86-89`) |
| A6 | Dropping the two old RPCs breaks nothing beyond the named gates | §1, §7 | Settle before the DROP with a fresh repo-wide grep for BOTH function names (including `supabase/tests/`, `schema/`, docs) — arm-2's discipline applied to the DROP |

**Everything else is `[VERIFIED]` against a file read this session, with path and line range, and quoted verbatim where the value is discrete.**

---

## Open Questions

1. **Fold caller: (i-a) or (i-b)?** Founder-reserved, measure-first (ruling 2). §3 produces the numbers; the architectural axis (Phase 106 Stage B reversal vs a second 280 KB seam crossing + Python resolve-arm retention) is laid out in §1's table. Research stance: the measurement will likely retire the latency argument; the real decision is architectural and the founder holds it.
2. **Does hop 2 (metadata UPDATE) fold in too?** Not required by SC#2 (a metadata-less-but-consistent strategy is not an orphan). Folding it widens the SECDEF JSONB surface substantially (the whole `CsvMetadataPayload`). Recommendation: leave outside, keep non-fatal + existing Sentry — but order it AFTER the resolve-arm checks to fix the 409 lie (§5 Pitfall 6).
3. **DROP vs deprecate the old RPCs?** Recommend DROP + same-PR gate re-point (§1); a kept-but-unused SECDEF function granted to `authenticated` is standing attack surface with no caller.
4. **Does the SC#1 artifact live in `145-REPRODUCTION.md` or the SUMMARY?** Discretion. Recommendation: standalone `145-REPRODUCTION.md` — it is cited by TODOS closure and PITFALLS correction, and a standalone file survives SUMMARY rewrites.

---

## Sources

### Primary (HIGH confidence — read in full or in cited range this session)
- `src/app/api/strategies/csv-finalize/route.ts` (entire, 1585 lines) — all anchors in §§1,5,6
- `analytics-service/routers/process_key.py:1090-1269` — csv-finalize branch, 23505/CR-01 arms; `:647`, `:874-875`
- `analytics-service/services/db.py:60-115` — `get_supabase` (service singleton) vs `get_user_scoped_supabase`
- `supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql` (entire) — LATEST `finalize_csv_strategy` + index + self-verify idiom
- `supabase/migrations/20260522111839_csv_daily_returns.sql` (entire) — ONLY `persist_csv_daily_returns` definition
- `supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql:1-131` — the restructured table (Pitfall 3)
- `supabase/migrations/20260716130000_strategies_status_private.sql:15-81` — the 5-value status CHECK
- `supabase/migrations/20260716131000_guard_strategies_publish_transition.sql` (entire) — publish trigger
- `supabase/migrations/20260515114310_redact_guc_bypass_use_current_user.sql:200-240` — sentinel trigger
- `supabase/migrations/20260806120000_strategies_capital_ownership.sql:455-500` — team-review trigger
- `supabase/migrations/20260713120000_cleanup_abandoned_wizard_drafts.sql:1-130` — the only strategies-row collector
- `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql:719-762` — 143's deployed predicate (`status <> 'archived'`)
- `supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql:1-120` — 144's register (template; ⛔ not touched)
- `supabase/tests/test_csv_finalize_double_submit.sql:1-70, :119, :230, :285` — gate shape + claims idiom
- `src/__tests__/csv-finalize-c14-regression.test.ts:100-220` — the vacuous block, verbatim
- `src/__tests__/csv-finalize-after-failloud.test.ts:207-291`; `src/__tests__/csv-finalize-cross-submission-merge.test.ts:202-260`; `src/app/api/strategies/csv-finalize/route.test.ts:187,209,400`; `src/__tests__/csv-finalize-rpc.test.ts:129,314`
- `analytics-service/tests/test_process_key.py:282-340, :2164-2266, :3889-4043` (anchors)
- `src/lib/sentry-capture.ts` (entire); `src/lib/process-key-client.ts:1-120`; `src/lib/queries.ts:272-361` (anchors)
- `analytics-service/services/csv_validator.py:858-886`; `src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx:55-80, :141-165, :264`
- `analytics-service/main_worker.py:344-368` — heal-identity dedupe lesson
- `.planning/ROADMAP.md:146-166`; `.planning/REQUIREMENTS.md:29-32,56`; `.planning/research/PITFALLS.md:198-210`; `.planning/research/SUMMARY.md:20,82,161,199,225`; `TODOS.md:817-820`
- Payload sizes: measured via node this session (§3, command committed)

### Secondary (MEDIUM confidence)
- `145-CONTEXT.md` — treated as ground truth for the SC#1 evidence table and failure-window map; spot-re-verified at HEAD `1e3004d9`; three corrections issued (Summary)
- `144-RESEARCH.md` / `144-CONTEXT.md` — register and template only

### Tertiary (LOW confidence)
- Vercel body-cap figure (A2) — training knowledge, empirically settled by §3. No web search performed; every question was answerable from the repository.

---

## Metadata

**Confidence breakdown:**
- §1 fold design — **HIGH** on both parent bodies + table shape (read verbatim; re-base discharged by grep); **MEDIUM** on the resolve-arm redesign (reasoned, not yet executed — the fold behavioral gate is what proves it).
- §2 terminalize — **HIGH** on vocabulary/triggers/collector (all read verbatim); the no-sweep recommendation is a judgement call, stated as such, inside founder ruling 1's bounds.
- §3 measurement — **HIGH** on payload (measured); **MEDIUM-HIGH** on the Step-A isolation property (A3).
- §4 arms — **HIGH**; every command/oracle points at objects verified to exist at HEAD.
- §5 defects — **HIGH**; both read verbatim, plus the new 409 finding.
- §6 Sentry — **HIGH**; helper contract + all existing call sites read.
- §7 gates — **HIGH**; every file opened, incl. the skipIf non-gate.

**Research date:** 2026-08-17
**Valid until:** 2026-09-16 (30 days — stable surface). ⚠️ Shorter-lived: the orphan census (re-run immediately before scoping AND before merge), the HEAD anchors into `route.ts` (a 1585-line file under active phase work — re-verify line numbers at plan time), and Phase 144's in-flight branch state.

