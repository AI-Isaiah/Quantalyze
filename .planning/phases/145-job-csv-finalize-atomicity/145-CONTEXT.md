# Phase 145: JOB — csv-finalize atomicity (reproduce-first) - Context

**Gathered:** 2026-08-17
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous), with the SC#1 reproduce-first audit taken FIRST
**HEAD audited:** `4f56bde4db8d34db98769fde066a991f4e1ab0ba` (branch `feat/v1.19-phase-144`)
**DB access:** NONE in this session (Supabase MCP is stripped from subagents). Every live-data
claim below is marked ⚠️ UNVERIFIED and carries the exact query that settles it.

<domain>
## Phase Boundary

A csv-finalize request that fails part-way leaves **no strategy row that nothing owns**. Delivered
after — and gated on — a committed reproduction verdict on the 42501 claim, so no budget is spent
re-fixing a bug that three separate mechanisms already closed.

IN SCOPE: the SC#1 reproduction artifact (pass/fail, committed); the failure-window map for
`finalize_csv_strategy` → metadata UPDATE → stale-range probe → `persist_csv_daily_returns` →
`after()` enqueue; the chosen atomicity mechanism; the user-facing copy that currently *misstates*
what was written; the vacuous `RED-TEAM-M1` test; CI-visible gates.

OUT OF SCOPE: the reconciliation sweep (Phase 143, shipped — do not re-open its predicate);
orphaned-`running` `compute_jobs` (Phase 144, mid-flight — do not touch
`20260817120000_retention_orphaned_running_terminalize.sql`); rate limits (Phase 146); any change
to `enqueue_compute_job` / `_enqueue_compute_job_internal`; the SEAMRIM-03 double-submit index
`strategies_user_wizard_session_source_uniq`; the CR-01 cross-submission-merge fence's *semantics*
(it may MOVE, it may not WEAKEN). ⛔ Constrained by JOB-07: any cleanup mechanism stays off the
worker's asyncio loop.

</domain>

<measurements>
## SC#1 — the reproduce-first verdict

### ⭐ VERDICT: **CANNOT REPRODUCE.** The 42501 bug is closed, and the flag it was conditioned on has zero readers.

This is **not** inherited from `.planning/research/PITFALLS.md:201` (a v1.16-cycle claim). Every
element was re-measured at HEAD today. Two elements of that prior analysis were **wrong** and are
corrected below.

### (a) Token forwarding and the user-scoped client — RE-VERIFIED at HEAD ✅

| Claim | Evidence at HEAD |
|---|---|
| Next forwards the session JWT | `src/app/api/strategies/csv-finalize/route.ts:1281-1301` reads `authClient.auth.getSession()`; **no session → 401 `CSV_FINALIZE_FAIL`, before any dispatch**. Forwarded as `userAccessToken` at `:1324`. |
| Python reads it | `analytics-service/routers/process_key.py:1135` — `user_token = request.headers.get("X-User-Access-Token", "")`; empty → 401 at `:1136-1145`, *before* building any client. |
| The RPC runs user-scoped | `:1146` `user_sb = get_user_scoped_supabase(user_token)`; `:1147-1156` `user_sb.rpc("finalize_csv_strategy", …)`. |
| The client is genuinely user-scoped | `analytics-service/services/db.py:80-111` — anon key as PostgREST `apikey`, user JWT via `client.postgrest.auth(...)`, **not cached**. Its docstring names this exact 42501. |
| The inline comment describes the bug | `process_key.py:1128-1133`, verbatim: *"The module service-role client has no auth.uid(), so calling it with `supabase` raised 42501 'called without an auth session' on every flag-on finalize."* |
| Regression tests exist and are non-vacuous | `analytics-service/tests/test_process_key.py:2175-2231` asserts finalize ran on the user client **and** `svc_finalize == []` ("must NOT use the service-role client"); `:2233-2266` asserts the no-token 401 with `mock_user_client.assert_not_called()`. |

⚠️ **Correction to PITFALLS:** it cites the forwarding at "`process_key.py` lines ~792-820". At HEAD
the branch is at **`:1119-1156`**. The line numbers in that document are stale by ~330 lines; do
not use them as anchors.

### (b) `PROCESS_KEY_UNIFIED_BACKBONE` — RE-VERIFIED: zero runtime readers, and nothing writes the row ✅

Repo-wide grep (case-insensitive, all file types, excluding `node_modules` and `.git`). In
`src/` + `analytics-service/{routers,services,workers}` the token appears **three** times, none of
them a read:

- `src/app/api/cron/flag-monitor/route.ts:13-17` — a COMMENT: *"the feature_flags kill-switch row
  (`process_key_unified_backbone`) has zero readers and is inert. This cron NEVER writes it:
  flipping it would be an outage, not a rollback."*
- `src/app/api/cron/flag-monitor/route.test.ts:131` — a test constant.
- `analytics-service/services/ingestion/csv_adapter.py:145` — a historical comment about the
  2026-05-25 flip.

The historical readers named in `106-RATIFICATION.md:29-30` (`src/lib/feature-flags.ts:95`,
`analytics-service/services/feature_flags.py:142`) are **gone**. And the flag-monitor cron is
proven non-writing by six assertions in `tests/integration/cron-flag-monitor.test.ts` — every
`upsertCalls.filter(c => c.row.flag_key === "process_key_unified_backbone")` is asserted
`toBe(0)`, including in the above-threshold ALERT case (`:250-266`, `:615-643`).

⇒ **There is no flag-on state and no flag-off state.** The TODOS bullet's condition
(`TODOS.md:819`, *"42501 every time when `PROCESS_KEY_UNIFIED_BACKBONE=on`"*) is unsatisfiable —
not because the flag is off, but because **the concept was deleted**. Its own proposed remedy
("Skip unified for finalize **or forward JWT**") was implemented as the second option.

⚠️ **"Absent from code" ≠ "absent as an env var."** Distinguish, as required:
- ⚠️ UNVERIFIED — `PROCESS_KEY_UNIFIED_BACKBONE` is recorded as **still set** to `on` on Vercel
  Production and on the Railway `quantalyze-analytics` service (`106-RATIFICATION.md:16`, dated
  ~2026-07). Nothing reads it, so it is inert; it is dead config, not a live switch.
  Settle with: `vercel env ls production | grep -i PROCESS_KEY` and
  `railway variables -s quantalyze-analytics -e production | grep -i PROCESS_KEY`.
- ⚠️ UNVERIFIED — the `feature_flags` row itself still exists (seeded at
  `20260510173005_process_key_long_idempotency_drain.sql:280`; `106-10-SUMMARY.md:119` says it was
  NOT deleted and "the orchestrator may clean it up manually post-merge"). Settle with:
  `SELECT flag_key, value, updated_at, updated_by FROM public.feature_flags WHERE flag_key = 'process_key_unified_backbone';`
  ⛔ Do not flip or delete it in this phase — `20260620120000_verification_requests_view_shim_apply.sql:86-89`
  RAISEs at apply time if it reads `off`, so a "cleanup" delete could redden a future migration apply.

### (c) `finalize_csv_strategy`'s `auth.uid()` guard — RE-BASED on the LATEST definition ✅ (and PITFALLS cites a superseded one)

⚠️ **Correction to PITFALLS and to `CHANGELOG.md:4512`:** both cite migration **`20260501055202`**
as the home of the guard. That is the ORIGINAL and has been superseded **twice**. Grepping ALL
migrations for `finalize_csv_strategy` and taking the newest:

| Migration | Role |
|---|---|
| `20260501055202_strategy_verifications.sql` | original definition — **superseded** |
| `20260716130500_finalize_terminal_status_param.sql:225-330` | adds `p_terminal_status` (5-arg overload); DROPs the 4-arg form — **superseded** |
| **`20260728120000_csv_finalize_double_submit_idempotency.sql:196-311`** | ⭐ **LATEST**. Adds the `wizard_session_id` write. No later redefinition exists (repo tip is `20260817120000`). |

The guard **survives verbatim** in the latest body:
- `:224-227` — `IF v_auth_uid IS NULL THEN RAISE EXCEPTION 'finalize_csv_strategy called without an auth session' USING ERRCODE = '42501';`
- `:229-233` — `IF v_auth_uid <> p_user_id THEN RAISE … ERRCODE = '42501';`
- `:314-315` — `REVOKE ALL … FROM PUBLIC, anon; GRANT EXECUTE … TO authenticated;`

⇒ **The hazard is live; the path to it is closed.** A service-role caller *would still* get 42501
today. There is simply no such caller.

Also load-bearing for SC#2: the function is `LANGUAGE plpgsql SECURITY DEFINER` with **no
`EXCEPTION` block** (`:307`, and the header note at `:80`), so its two INSERTs
(`strategies` at `:279-289`, `strategy_verifications` at `:298-305`) are atomic with each other —
they already share one transaction. The atomicity gap is *around* this RPC, never inside it.

### (d) The legacy (non-unified) finalize path — GONE; there are now TWO user-scoped writers ✅

`route.ts:1216-1221`: *"Phase 106 Stage B (D2): the unified backbone is now the sole finalize path…
The former flag-off legacy direct-RPC arm was deleted in 106-07."*

But "sole" is **not quite true at HEAD**, and the plan must know it:

| Path | Trigger | Writer | Client |
|---|---|---|---|
| **manager** (default) | `entry_context` absent / `"manager"` | Python `/process-key` → `finalize_csv_strategy` | user-scoped, from the forwarded JWT |
| **contribution** (CONTRIB-02) | `entry_context === "contribution"` (`route.ts:1204-1214`) | **the Next route itself**, `finalize_csv_strategy` direct (`route.ts:1469-1489`) with `p_terminal_status='private'` | the SSR cookie session client — **already user-scoped natively** (`route.ts:1441-1445`) |

Grep of `src/` + `analytics-service/` for `finalize_csv_strategy` call sites returns exactly these
two. **Zero service-role callers exist.** The contribution path is also the existence proof that
option (i-b) below is workable.

### What a reproduction ATTEMPT should actually consist of (runnable, for the plan to execute and commit)

A static audit is *reading*, not *reproducing*. Four arms, cheap, and the first two are the honest
core:

1. **The guard is alive (positive control).** A `supabase/tests/test_csv_finalize_auth_guard.sql`
   part that calls `public.finalize_csv_strategy(...)` with **no** `request.jwt.claims` set (so
   `auth.uid()` is NULL) and asserts SQLSTATE **`42501`** with the message
   `finalize_csv_strategy called without an auth session`; and a second part that sets a claims
   JWT whose `sub` ≠ `p_user_id` and asserts `42501` again. This proves the bug *would* reproduce
   given a service-role caller — the half that is still true.
2. **No such caller exists (negative control).** A committed grep artifact: every
   `finalize_csv_strategy` call site in `src/` and `analytics-service/`, with the client each uses.
   Two sites, both user-scoped. ⚠️ Must be a *fresh* grep, not this document's table.
3. **Run the existing Python gates and record the result:**
   `cd analytics-service && python3 -m pytest tests/test_process_key.py -k "csv_finalize" -q`
   (⛔ must run from `analytics-service/`, else VCR cassettes miss and it makes LIVE broker calls).
   Record pass/fail verbatim. These are mock-level and prove *wiring*, not absence-of-42501 — say
   so in the artifact rather than overclaiming.
4. **One live end-to-end finalize on TEST** (orchestrator session, Supabase MCP available): a real
   user session → `POST /api/strategies/csv-finalize` with a small `daily_returns` payload →
   assert **200 + a UUID `strategy_id`**, and assert the response is not `42501`/`CSV_FINALIZE_FAIL`.
   Use the passwordless service-role magic-link → `setSession` → `curl` pattern.
   ⚠️ This arm doubles as the SC#3 happy-path baseline — capture the resulting row state
   (`strategies`, `strategy_verifications`, `csv_daily_returns` count, `compute_jobs`) so the
   post-change comparison is against a *measured* baseline, not a remembered one.

Expected outcome: **arms 1 GREEN (guard fires), 2/3/4 GREEN (no path reaches it) ⇒ CANNOT
REPRODUCE.** That is the budget-saving outcome SC#1 sanctions, and it must be committed as a
pass/fail artifact **before** any SC#2 code is written.

---

## SC#2 — the genuinely-open gap, mapped at HEAD

### ⚠️ First correction: it is not a three-step sequence

JOB-06 (`REQUIREMENTS.md:56`) and the ROADMAP both say *"three-step RPC → RPC → `after()`"*. At
HEAD the manager path is **five hops**, and one of them is an HTTP boundary that no database
transaction can span:

| # | Hop | Site | Client | Writes | On failure |
|---|---|---|---|---|---|
| 0 | `POST /process-key` (HTTP) | `route.ts:1303-1325` | — | — | `!result.ok` → upstream envelope returned; **the RPC may already have committed** |
| 1 | `finalize_csv_strategy` | `process_key.py:1147-1156` | user-scoped (Python) | `strategies` + `strategy_verifications`, atomic together | RAISEs; 23505 → idempotent-resolve arm `process_key.py:1160+` |
| 2 | metadata UPDATE | `route.ts:1378-1385` → `applyCsvMetadataUpdate` (`:885-938`) | SSR user | `strategies` (category/markets/aum/…) | **NON-FATAL** — logs + `captureToSentry` (`:933`), returns `null`. The 400 arm (`:897-908`) is unreachable in practice: the identical parse already ran pre-create at `:1138-1150` |
| 3 | stale-range probe (READ) | `route.ts:568-612` | SSR user | — | fail-CLOSED **503 `CSV_PERSIST_FAIL`** (`:574-596`) or **409 `CSV_SESSION_REUSED`** (`:597-612`) |
| 4 | `persist_csv_daily_returns` | `route.ts:614-623` | SSR user | `csv_daily_returns` | **500 `CSV_PERSIST_FAIL`** (`:649-659`), preceded by a `failed` `strategy_analytics` placeholder (`:640-648`) |
| 5 | `enqueue_compute_job` | `route.ts:813-866` inside Next's `after()` | **admin / service-role** (`:817-818`) | `compute_jobs` | non-blocking; on error → Sentry (`:836`) + `failed` placeholder (`:860`) |

The contribution path is identical from step 1 onward, with hop 0 removed and hop 1 executed
in-process (`route.ts:1469-1572`).

### The failure windows, and what actually cleans up each one

⭐ **Nothing in this system deletes or terminalizes an orphan `strategies` row today.** There is no
compensating write anywhere in `route.ts` (grep: `orphan` appears only in three comments; there is
no strategy DELETE, no archive, no status flip).

| # | Window | Residual state | Phase 143 sweep? | Anything else? |
|---|---|---|---|---|
| **A** | Hop 0: RPC committed, HTTP response lost (timeout / 5xx / instance death after commit) | `strategies` + `strategy_verifications`; **no dailies**, no job, no analytics row | ❌ **NO** — fails the `EXISTS (csv_daily_returns)` conjunct | Partially self-healing: a retry in the **same wizard session** hits the 23505 arm and resolves to the existing row (`process_key.py:1160-1200`), then continues the fan-out. Only if the user retries, and only with **the same file** (a different file is refused 409 by the CR-01 fence) |
| **B** | Hop 3 probe READ fails → 503 | same as A, **no analytics row** | ❌ NO (no dailies) | none. ⚠️ And the copy is **false** — see below |
| **C** | Hop 4 persist RPC fails → 500 | same as A, **plus** `strategy_analytics` = `failed` | ❌ NO (no dailies, *and* excluded by the terminal-analytics conjunct) | none. ⚠️ **No `captureToSentry` on the persist error itself** — `route.ts:624-633` is `console.error` only; the only Sentry captures in that helper are for the *placeholder write's* own failures (`:736/:783/:801`) |
| **D** | Hop 5 closure **never runs** (instance torn down post-response) | strategy + dailies, no job, **no analytics row** | ✅ **YES — this is exactly and only what 143 heals** | — |
| **E** | Hop 5 runs and the enqueue **errors** | strategy + dailies, no job, `strategy_analytics` = `failed` | ❌ NO — the `failed` placeholder trips the terminal-analytics conjunct (`20260816140000:737`) | Sentry fires (`:836`); the user's poller breaks out on `failed`. The job is never re-enqueued — arguably correct (visible), but it is **not** healed |

⇒ **Phase 143 covers window D and nothing else.** Windows A/B/C — every window in which the
strategy row exists but the dailies do not — are precisely the "orphan strategy row" JOB-06 names,
and 143 structurally cannot reach them: its own header records the analogous non-coverage
(`20260816140000:259-265`, the wizard **first-hop** drop) for the same reason — *"no dailies AND no
jobs" is byte-identical to a brand-new strategy.* An orphan from window A/B/C is in exactly that
indistinguishable class. **Any out-of-band sweep for A/B/C inherits that false-positive problem
and must solve it with a different signal, not by widening 143's predicate.** ⛔ Do not touch
`20260816140000`.

### Two honesty defects found while mapping (both concrete, both in scope)

1. ⭐ **The 503 tells the user a falsehood.** `route.ts:590` says *"Nothing was changed."* — but
   `finalize_csv_strategy` committed the `strategies` **and** `strategy_verifications` rows
   milliseconds earlier. Whatever SC#2 mechanism is chosen, this sentence must become true or must
   change. (The 500's copy at `:653-654` is honest — *"Your strategy was created but the
   daily-return data could not be saved. Contact support…"* — and it becomes a **lie in the other
   direction** if the phase adopts a compensating DELETE. The two copies move together.)
2. ⭐ **A test that cannot fail, named for a guarantee that does not exist.**
   `src/__tests__/csv-finalize-c14-regression.test.ts:144-190` is titled *"RED-TEAM-M1: post-RPC
   metadata validation orphan Sentry capture"* and *"calls captureToSentry with the orphan
   strategy_id when post-RPC metadata validation fails"* — but its body drives the **pre-create**
   400 (the RPC is never called), and then asserts the orphan capture was **NOT** made. Its own
   comments admit this (`:164-176`). The string it searches for, `"orphan strategy row"`, **does
   not exist anywhere in `src/`** (grep, today) — so the assertion is vacuously true and always
   will be. Per the founder rule, a test that cannot fail is worse than none. Fix or delete it in
   this phase; do not leave it asserting a guarantee nobody implemented.

### The two SC#2 options, honestly assessed

⛔ **The hard constraint that shapes everything:** Next's `after()` runs **post-response**, in a
separate execution context, after the request's DB work has already committed. It **cannot** be
inside a request-scoped transaction, under any design. So option (i) can never be "all three/five
steps in one transaction" — the honest ceiling is **hops 1 + 4 fused**, with hop 5 left outside.

#### Option (i) — fold `finalize_csv_strategy` + `persist_csv_daily_returns` into ONE SECURITY DEFINER transaction

⭐ **The composition argument, and it is strong:** if hops 1 and 4 are atomic, then the ONLY
reachable partial state becomes *"strategy + dailies present, no compute job"* — which is
**exactly window D, which Phase 143 already heals on an hourly cadence.** Windows A, B and C stop
existing. The two phases would then compose to full coverage with no new sweep and no destructive
delete. That is the cleanest end state available.

Two shapes, and the choice is a real architectural decision, not a detail:

- **(i-a) Forward the dailies to Python.** Next sends `daily_returns_series` in the `/process-key`
  body; Python calls one folded RPC. ⚠️ Cost: the series never leaves Next today — up to **5000
  rows** (the cap enforced at `route.ts:1152-1157`'s "5000-row cap" note) would now cross the seam
  on every finalize. Payload size, redaction and limiter sizing all move. ⚠️ It also does **not**
  close window A: the HTTP hop still exists, so a lost response still strands a (now *consistent*)
  strategy — but consistent means window D, which 143 heals. So A is downgraded, not removed.
- **(i-b) Call the folded RPC directly from the route with the SSR user client** — i.e. exactly
  what the CONTRIB-02 path already does (`route.ts:1461-1489`), for both paths. ⭐ This removes hop
  0 entirely (window A ceases to exist), converges the two writers on one, and needs no seam
  change. ⛔ **But it reverses Phase 106 Stage B's "the unified backbone is the sole finalize
  path"** (`route.ts:1216-1221`) for this flow. That is a founder-level call, not a Claude call.

Costs common to both:
- ⚠️ **The CR-01 cross-submission-merge fence must move INSIDE the RPC.** It is a READ
  (`route.ts:568-573`) whose whole purpose is the resolve-to-existing case, and it is a **money
  fence** (`route.ts:523-557` explains why at length; gated by
  `src/__tests__/csv-finalize-cross-submission-merge.test.ts`, 5 tests incl. the fail-closed arm).
  Reimplementing it in plpgsql is genuinely better (it becomes atomic with the write) but it is a
  rewrite of a carefully-reasoned guard and its RED must be re-observed, not inherited.
- ⚠️ The 23505 idempotent-resolve arm + its CR-01 name comparison live in Python
  (`process_key.py:1160-1230`). Folding moves where idempotency is decided.
- ⚠️ SC#3: `p_terminal_status` must survive into the folded function, or the CONTRIB-02
  `'private'` finalize regresses to `'pending_review'` — an owner-only draft becoming an admin-queue
  submission. Non-negotiable.
- ⚠️ A folded function is a **new SECURITY DEFINER surface taking caller-supplied JSONB rows**.
  Migration-reviewer invariants #3/#15/#19 apply for real here (unlike 143, which created none).

#### Option (ii) — explicit compensating cleanup + Sentry

- **In-request compensation** is mechanically available: `strategies_delete` RLS is
  `FOR DELETE USING (user_id = auth.uid())` (`20260405061912_rls_policies.sql:33`, the only
  definition — no later policy, no trigger on `strategies`), and all three children cascade
  (`strategy_verifications` `20260501055202:79`, `csv_daily_returns` `20260522111839:37`,
  `strategy_analytics` `20260428120919:72`, all `ON DELETE CASCADE`). So the 500/503 arms *could*
  delete the row they just created.
- ⚠️ **But window A has no id to compensate with** — the route never learns the `strategy_id` when
  the response is lost. It would have to look the row up by `(user_id, wizard_session_id, source='csv')`
  (well-defined: the partial unique index guarantees at most one). And in the crash sub-case the
  compensation code does not run at all — which pushes A back to needing an out-of-band sweep,
  with the indistinguishability problem named above.
- ⚠️ **A compensating DELETE races the instructed retry.** `CSV_SUBMIT_FAILED`'s copy tells the
  user to submit again, and the 23505 arm makes that retry resolve to the existing row. Deleting
  underneath it converts a self-healing path into a new-row path.
- ⚠️ **It contradicts the lesson Phase 144 just shipped** — DELETE→terminal UPDATE, *"the row must
  survive so a poller sees a real outcome and the audit trail holds."* An out-of-band DELETE of a
  user's named strategy is strictly more destructive than the `compute_jobs` DELETE 144 removed.
- ⭐ **Therefore SC#2's literal wording ("leaves no orphan strategy row") needs a decision, not an
  assumption.** Two readings, and the phase must lock one: (α) *no row exists* → deletion; (β) *no
  row is in a limbo state nothing owns and nothing surfaces* → terminalize + alert + make it
  visible/recoverable. Reading (β) is consistent with 142/143/144's whole register; reading (α) is
  what the sentence literally says. **Do not let a plan silently pick one.**

  ✅ **DECIDED — founder call, 2026-08-17 (AskUserQuestion, this session): reading (β),
  TERMINALIZE.** Mark the orphan failed/abandoned with a reason; the user sees a real outcome, the
  audit trail survives, retention collects it later. SC#2's "no orphan row" is LOCKED as "no
  UNEXPLAINED row nothing owns", consistent with 144's WR-02 register. Deletion arms are OUT OF
  SCOPE for the plan.
- Sentry half is cheap and independently correct regardless of the choice: window C currently has
  **no** capture at all (see above), and window B has none either.

## ⚠️ UNVERIFIED — live census the plan MUST take first (orchestrator session, Supabase MCP)

Phases 142/143/144 all had a standing claim falsified by measurement. Do not scope SC#2 before
running these on **both** PROD `khslejtfbuezsmvmtsdn` and TEST `qmnijlgmdhviwzwfyzlc`.

```sql
-- (1) Orphans: a strategy with NO dailies, NO jobs, past a 1-hour grace.
--     Windows A / B / C look exactly like this.
SELECT s.id, s.user_id, s.status, s.source, s.wizard_session_id, s.created_at,
       (SELECT sa.computation_status FROM public.strategy_analytics sa
         WHERE sa.strategy_id = s.id) AS analytics_status
  FROM public.strategies s
 WHERE s.status <> 'archived'
   AND NOT EXISTS (SELECT 1 FROM public.csv_daily_returns d  WHERE d.strategy_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM public.compute_jobs      cj WHERE cj.strategy_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM public.strategy_keys     sk WHERE sk.strategy_id = s.id)
   AND s.created_at < now() - interval '1 hour'
 ORDER BY s.created_at;

-- (2) The same, narrowed to the CSV writer, which is the only population this phase creates.
--     ⚠️ Run BOTH: (1) minus (2) is the wizard first-hop population Phase 143 filed as
--     non-coverage — it must NOT be silently absorbed into 145's scope.
SELECT count(*) FROM public.strategies s
 WHERE s.source = 'csv' AND s.status <> 'archived'
   AND NOT EXISTS (SELECT 1 FROM public.csv_daily_returns d WHERE d.strategy_id = s.id);

-- (3) Window E's population: dailies present, zero jobs, analytics stuck at 'failed'.
SELECT count(*) FROM public.strategies s
 WHERE EXISTS (SELECT 1 FROM public.csv_daily_returns d WHERE d.strategy_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM public.compute_jobs cj WHERE cj.strategy_id = s.id)
   AND EXISTS (SELECT 1 FROM public.strategy_analytics sa
                WHERE sa.strategy_id = s.id AND sa.computation_status = 'failed');

-- (4) Is the retired kill-switch row still present, and what does it read?
SELECT flag_key, value, updated_at, updated_by
  FROM public.feature_flags WHERE flag_key = 'process_key_unified_backbone';
```

⚠️ A **zero** result on (1)/(2) is a legitimate and budget-saving finding — 143's PROD census was
0 and it shipped anyway, correctly, because the mechanism's value is prospective. But zero on PROD
plus a non-zero on TEST would tell you the windows are reachable; and a **non-zero on PROD** would
re-rank this from prospective hardening to a live cleanup. Measure before scoping.

</measurements>

<decisions>
## Implementation Decisions

### SC#1 — the reproduction

- **The verdict is CANNOT REPRODUCE, and the plan's job is to make that verdict *executable and
  committed*, not to re-derive it.** Four arms, per the list above. ⛔ Do not scope any 42501 fix.
  ⛔ Do not re-add `X-User-Access-Token` forwarding — it is at `route.ts:1324` and
  `process_key.py:1135`, and a diff that "adds" it is the warning sign PITFALLS names.
- **The artifact must state the split explicitly: the GUARD is live, the PATH is closed.** A flat
  "not a bug" is wrong and invites someone to delete the guard. Arm 1 exists to make the guard's
  liveness a CI fact, so a future service-role caller reddens rather than 42501s in production.
- **Close the TODOS bullet as part of this phase** (`TODOS.md:819`), citing which of its own two
  proposed remedies shipped and when. A stale bullet that outlived its fix is what cost this
  phase its reproduce-first gate in the first place.
- ⚠️ **Correct `.planning/research/PITFALLS.md` and `.planning/research/SUMMARY.md` line anchors**
  (`~792-820` → `1119-1156`) and the migration citation (`20260501055202` → `20260728120000`) in
  the same commit, or delete those anchors. A stale anchor in a research doc is how the next
  reader re-derives a wrong premise from a green gate.

### SC#2 — the mechanism

- **Decide (α) delete vs (β) terminalize-and-surface FIRST, and record the reading.** See the
  tension above. This is the single decision the rest of the phase hangs on. It is a founder-level
  call because it is destructive-vs-visible on a user-named row.
- **Preferred direction, if the founder does not override: option (i), the folded SECURITY DEFINER
  transaction** — because it *dissolves* windows A/B/C rather than cleaning up after them, and
  because what remains is precisely window D, which Phase 143 already heals. Compensating cleanup
  (option ii) is a second mechanism to maintain, races the instructed retry, and cannot cover the
  crash sub-case of window A at all.
- **The (i-a) vs (i-b) choice is a founder call, not Claude's discretion**, because (i-b) reverses
  Phase 106 Stage B's "unified backbone is the sole finalize path". Surface both with the costs
  above; do not let a plan quietly pick (i-b) because it is easier.

  ⏳ **FOUNDER RULING, 2026-08-17 (AskUserQuestion, this session): "Decide at plan time" —
  MEASURE FIRST.** The plan must include a task that measures the actual (i-a) forwarding cost on
  real data — payload size and latency of shipping ~5000 daily rows across the `/process-key` seam
  versus the direct-from-route call — and brings NUMBERS back before the choice is made. The
  choice itself then returns to the founder (or is made on the measurement if the founder has
  delegated it by then). ⛔ A plan that picks (i-a) or (i-b) without that measurement violates
  this ruling.
- ⛔ **`p_terminal_status` survives, verbatim, in whatever function is created** — SC#3 names the
  CONTRIB-02 owner-only `'private'` variant explicitly, and losing it silently promotes private
  contributions into the admin publish queue.
- ⛔ **The CR-01 cross-submission-merge fence may MOVE but never WEAKEN.** If it moves into SQL,
  its five existing tests (`src/__tests__/csv-finalize-cross-submission-merge.test.ts`) must be
  re-pointed and each must be observed RED against the new implementation — inherited green is not
  evidence.
- ⛔ **Do not touch `20260816140000` (143's sweep)** — not its predicate, not its conjunct order,
  not its gates. Its header (`:73-107`) records why every conjunct is load-bearing and how
  weakening one becomes a mass re-enqueue.
- **Fix the two honesty defects regardless of which option is chosen:** the 503's "Nothing was
  changed" (`route.ts:590`), and the vacuous `RED-TEAM-M1` test
  (`csv-finalize-c14-regression.test.ts:144-190`). Both are cheap, both are in the blast radius,
  and the test is currently *asserting the absence* of the guarantee this phase is meant to deliver.
- **Add the missing Sentry captures** on the persist-error (`route.ts:624-633`) and stale-probe-error
  (`route.ts:574-596`) arms. That is the "+ Sentry alerts" half of SC#2 and it is independently
  correct under either option.

### Claude's Discretion

- Test/gate file names, the folded RPC's name and signature shape, migration filename/timestamp.
- Whether the SC#1 artifact is a standalone `145-REPRODUCTION.md` or a section of the SUMMARY
  (it must be committed **before** SC#2 code either way).
- Whether the SQL auth-guard gate is a new `supabase/tests/test_*.sql` or a new part of an
  existing one.
- Whether the vacuous `RED-TEAM-M1` test is repaired (by implementing the orphan capture it names)
  or deleted (as a test of a guarantee the phase supersedes) — decide from which SC#2 option lands.
- The grace/threshold value, if an out-of-band sweep is nonetheless built. ⚠️ It must be
  **derived**, in the register of `20260816140000:51-71` — a bare number with no derivation is
  what Phase 106's janitor was reverted for.

</decisions>

<code_context>
## Existing Code Insights

- `src/app/api/strategies/csv-finalize/route.ts` (1584 lines) — the whole surface. Anchors
  re-verified at HEAD today: `persistDailyReturnsOrErrorResponse` `:514-662` (CR-01 fence
  `:523-612`, persist RPC `:614-623`, 500 arm `:649-659`);
  `writeFailedStrategyAnalyticsPlaceholder` `:711-806`; `enqueueCsvAnalyticsAfter` `:808-867`
  (Phase 143 cited `after()` at `:813` ✅, guards `:833-837` ✅, `:846-850` ✅, `:858-863` ✅ — **all
  four still exact**); `applyCsvMetadataUpdate` `:885-938`; `POST` `:940-1231`;
  `unifiedCsvFinalizeHandler` `:1239-1429`; `contributionCsvFinalizeHandler` `:1452-1584`.
- `analytics-service/routers/process_key.py:1119-1230` — the csv-finalize branch: token read
  `:1135`, 401 `:1136-1145`, user client `:1146`, RPC `:1147-1156`, 23505 idempotent-resolve arm
  `:1160+` with the CR-01 name comparison.
- `analytics-service/services/db.py:80-111` — `get_user_scoped_supabase`; `:71-78` `get_supabase`
  is the `lru_cache`'d **service-role** singleton. The two are one screen apart; the plan should
  keep them visibly distinguishable.
- `supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql:196-311` — the
  **latest** `finalize_csv_strategy`. Its header `:80-90` explains why there is deliberately no
  `EXCEPTION` block (so 23505 rolls BOTH inserts back). Any folded successor inherits that
  requirement.
- `supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql` — Phase 143. Read
  `:73-107` (SAFETY vs DEBOUNCE), `:256-278` (the two documented non-coverages) and `:719-762`
  (the deployed predicate) before writing anything adjacent to it.
- `supabase/migrations/20260405061912_rls_policies.sql:33` — `strategies_delete` (owner-only), the
  ONLY delete policy on the table; no trigger on `strategies` in any migration.
- Existing gates that must not be re-invented: `src/__tests__/csv-finalize-after-failloud.test.ts`
  (4 D7 fail-loud paths), `src/__tests__/csv-finalize-cross-submission-merge.test.ts` (5 CR-01
  arms incl. fail-closed), `src/app/api/strategies/csv-finalize/route.test.ts` (CONTRIB-02 +
  TS-13 `ok`/`isUuid`), `analytics-service/tests/test_process_key.py:2175-2266`.
- ⚠️ `src/__tests__/csv-finalize-c14-regression.test.ts:144-190` is **vacuous** — see the honesty
  defects above.

</code_context>

<specifics>
## Specific Ideas

- **Every new gate must be shown to FAIL when its target is neutered** — neuter, run, OBSERVE the
  RED, restore. This phase is entering a file that already contains one test named for a guarantee
  that does not exist; inherited green means nothing here.
- **The SC#1 artifact is a *negative* result, and negative results are the easiest place to be
  vacuous.** Arm 1 (the positive control proving the guard still fires) is what stops the artifact
  from being "we grepped and found nothing".
- RLS/SQL gates MUST live in `supabase/tests/test_*.sql` to run in CI. `*_live.py` and `skipIf`
  vitest never run in CI.
- ⛔ Merging `supabase/migrations/**` to `main` **AUTO-APPLIES to PROD**. If this phase creates a
  folded RPC, apply to TEST via the Supabase MCP (never `supabase db push`) and exercise it before
  merge. ⚠️ The MCP is **stripped from subagents** — the apply/live-verify task must run in the
  orchestrator session.
- ⚠️ Run `mypy --strict` before shipping any `analytics-service/` change; the GSD milestone gate
  runs pytest only, so type errors stay latent until PR CI. Use `cast()`, never `# type: ignore`.
- ⚠️ `pytest` for `analytics-service` runs **only** from `analytics-service/` (repo-root runs miss
  the VCR cassettes and make LIVE broker calls). Use `python3`.
- Money-math oracle discipline applies to the CR-01 fence if it moves: pin the **economics** (a
  strategy's persisted series equals exactly the file that was submitted), never the new
  implementation's own formula.
- SC#3's "happy-path unchanged" needs a **measured** before/after, not an assertion — capture the
  row state from the SC#1 arm-4 live finalize and diff it after the change.

</specifics>

<deferred>
## Deferred Ideas

- **Window E** (dailies present, enqueue errored, `strategy_analytics='failed'`, job never
  re-enqueued). Visible to the user and alerted to Sentry, so it is not silent — but nothing
  re-enqueues it and 143's terminal-analytics conjunct deliberately excludes it. → TODOS, unless
  census query (3) shows a non-zero PROD population.
- **The wizard first-hop drop** (no dailies at all on the API/wizard path) — Phase 143 filed it as
  documented non-coverage (`20260816140000:259-265`) because it is indistinguishable from a
  brand-new strategy. It shares a shape with windows A/B/C but has a different signal problem.
  ⚠️ Do NOT absorb it into 145 by widening a predicate. → TODOS.
- **Deleting the inert `feature_flags.process_key_unified_backbone` row and the dead Vercel/Railway
  env vars.** ⛔ Not here: `20260620120000:86-89` RAISEs at apply time if that row reads `off`, so
  a careless cleanup can redden a future migration apply. → TODOS, with that constraint attached.
- **Forwarding `X-User-Access-Token` on onboard/resync** so a user-scoped pre-check is possible
  there too — a standing 140.x obligation
  (`140.1-TS-OBLIGATIONS.md:251`), not this phase's business.
</deferred>
