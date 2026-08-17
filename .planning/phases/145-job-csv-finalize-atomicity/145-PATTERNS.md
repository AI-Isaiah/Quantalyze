# Phase 145: JOB — csv-finalize atomicity - Pattern Map

**Mapped:** 2026-08-17
**Files analyzed:** 5 artifact classes (migration, terminalize arm, route changes, rebuilt regression test, CI gates)
**Analogs found:** 5 / 5 — every artifact has a strong in-repo analog; nothing falls back to research docs.

## File Classification

| New/Modified Artifact | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/202608XXXXXXXX_*.sql` — folded SECDEF RPC (finalize + persist in one txn) | migration (FUNCTION) | CRUD, multi-write transactional | **re-base sources:** `20260728120000_csv_finalize_double_submit_idempotency.sql:196-315` + `20260522111839_csv_daily_returns.sql:111-210`; **structure:** `20260817120000_retention_orphaned_running_terminalize.sql` header + `20260728120000` STEP/self-verify | exact |
| TERMINALIZE arm for orphan `strategies` rows | route/RPC failure-arm | request-response compensation | `20260817120000` terminal-UPDATE register (WR-02, `failed_final`) + `writeFailedStrategyAnalyticsPlaceholder` `route.ts:711-806` | role-match |
| `src/app/api/strategies/csv-finalize/route.ts` edits (direct RPC call, honest copy, Sentry) | route | request-response | CONTRIB-02 direct-RPC arm `route.ts:1469-1489`; Sentry pattern `route.ts:933`, `:836` | exact (same file) |
| Rebuilt regression test replacing vacuous `csv-finalize-c14-regression.test.ts:144-190` | test (route unit) | request-response | mock scaffold `csv-finalize-c14-regression.test.ts:22-75`; anti-vacuity discipline `retention-orphaned-running-terminalize.test.ts:152-161` | exact |
| SQL CI gate `supabase/tests/test_*.sql` | test (behavioral SQL) | CRUD | `test_csv_finalize_double_submit.sql` (whole file) + `test_commit_scenario_batch_auth_input.sql:82-139` (42501 shape) | exact |
| TS migration-content gate (if the plan adds one) | test (text gate) | — | `retention-orphaned-running-terminalize.test.ts` (tip check `:76-78`, extraction guard `:152-161`) | exact |

## Pattern Assignments

### 1. The folded SECURITY DEFINER migration

**Re-base sources — LATEST definitions, verified today:**
- `finalize_csv_strategy` (5-arg): `supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql:196-309`. No later redefinition exists (repo tip is `20260817120000`; grep of all migrations confirms).
- `persist_csv_daily_returns` (3-arg): `supabase/migrations/20260522111839_csv_daily_returns.sql:111-186`. This is the ONLY definition in the tree — `20260624120000` and `20260816140000` mention it in comments only. Re-base on it directly.

⭐ **Re-base rule (house law, `20260728120000:186-195`):** the migration must state, in its header, which prior migration each body is re-based on and enumerate the EXACT delta. `20260728120000` STEP 3 is the template: *"Re-based on the LATEST definition: 20260716130500... EXACTLY ONE change from that body..."*. A folded function is a bigger delta, but the enumeration discipline is identical.

**Function-signature and hardening conventions (both source RPCs agree — copy verbatim):**

```sql
-- 20260728120000:203-207 / 20260522111839:116-121
RETURNS UUID                        -- (persist RETURNS INTEGER; folded fn should return the strategy UUID, per finalize)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog   -- pg_temp deliberately excluded; rationale spelled out at 20260601120000:95-99
```

**Guard ordering (copy from `20260728120000:211-256`, then splice persist's guards):**
1. Business precondition FIRST so it RAISEs before any write — the CONTRIB-02 `p_terminal_status NOT IN ('pending_review','private')` guard at `:215-219`. ⛔ CONTEXT locks this: `p_terminal_status` survives verbatim in the folded function.
2. `auth.uid() IS NULL` → 42501 with the exact message `'... called without an auth session'` (`:225-228`) — the SQL gate's arm 1 pins this message.
3. `auth.uid() <> p_user_id` → 42501 (`:230-234`).
4. Input-shape guards → 22023: fmt whitelist (`:237-240`), name 1–80 (`:248-256`), and from persist: `jsonb_typeof(p_rows) <> 'array'` (`20260522111839:152-155`), `> 5000` cap (`:159-162`), empty (`:165-168`).
5. ⭐ **Probe-oracle collapse** (`20260522111839:138-149`): missing-strategy and wrong-owner both collapse into ONE 42501 `'strategy % not accessible'` — the two states must be indistinguishable so authenticated callers cannot enumerate strategy UUIDs. NOTE: in the folded function the strategy is created in the same transaction, so this guard likely dissolves — but if any lookup-by-id path survives (e.g. an idempotent-resolve arm), the collapse discipline applies to it.

**Core write pattern** — set-based idempotent upsert (`20260522111839:171-181`):
```sql
INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return)
SELECT p_strategy_id, (elem->>'date')::DATE, (elem->>'daily_return')::DOUBLE PRECISION
FROM jsonb_array_elements(p_rows) elem
ON CONFLICT (strategy_id, date) DO UPDATE
  SET daily_return = EXCLUDED.daily_return, updated_at = now();
```
plus finalize's two INSERTs (`20260728120000:278-305`) with the FK-at-COMMIT note preserved (`:295-298`).

⭐ **NO `EXCEPTION` block.** `finalize_csv_strategy` deliberately omits it so an unhandled 23505 rolls ALL inserts back — the whole double-submit guarantee depends on it (`20260728120000:80-92` states this at length; the function comment at `:272-277` repeats it). The folded function inherits this requirement: the 23505 from `strategies_user_wizard_session_source_uniq` must abort the ENTIRE folded body, dailies included. Do not copy `commit_scenario_batch`'s `EXCEPTION` arm (`20260601120000:518`) — see Contradictions.

⚠️ **CR-01 fence moves inside** (CONTEXT lock: may MOVE, never WEAKEN). The plpgsql translation of the stale-range predicate at `route.ts:568-573` (`SELECT 1 FROM csv_daily_returns WHERE strategy_id = X AND (date < min OR date > max) LIMIT 1`) should RAISE with a DISTINCT ERRCODE/message so the route can keep mapping it to 409 `CSV_SESSION_REUSED`. The ERRCODE-map-as-interface convention is `20260522111839:104-110` (a comment block enumerating `22023 / 42501 / 23505` → downstream TS meaning). Extend that map, don't invent an ad-hoc one. The fence's full rationale comment (`route.ts:523-557`) must travel with the code — it exists precisely to stop "simplification".

**GRANT discipline** (`20260728120000:311-315`):
```sql
REVOKE ALL ON FUNCTION public.<fn>(<sig>) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.<fn>(<sig>) TO authenticated;
```
- Restate grants even under `CREATE OR REPLACE` (which preserves ACLs) "so the anon REVOKE is auditable at this file" (`:311-313`).
- If any overload is DROPped, grants MUST be re-issued — "DROP loses ACLs" (`20260601120000:32`).
- ⚠️ anon-EXECUTE trap (house memory + `20260522111839:200-209`): REVOKE-from-anon is correct HERE because callers are `authenticated`; it is only SECDEF functions referenced inside `{public}` RLS policies that need anon EXECUTE. These RPCs are not — keep the REVOKE.
- If old function signatures are DROPped (e.g. dropping the standalone persist/finalize in favor of the folded one — the plan must decide), follow `20260716130500`'s DROP-then-CREATE overload discipline referenced at `20260728120000:188-189`, and `20260601120000` STEP 1 (`DROP FUNCTION IF EXISTS` of the superseded arity, `:82`).

**Migration file structure** (freshest discipline = `20260817120000`, but that is a CRON migration; the best FUNCTION-migration analog is `20260728120000` itself):
- Long-form header: "Why this migration exists", the reachable trace, the ">>> READ THIS BEFORE SIMPLIFYING <<<" callouts (`20260728120000:1-127`), a **manual-rollback block** (`:116-127` — only 26/230 migrations carry a `down/` file; a rollback recipe in the header is the norm), and the gate file named in the header (`:110`).
- `BEGIN; SET lock_timeout = '3s'; ... COMMIT;` (`:129-131`).
- Numbered `STEP N` banners with pre-flight DO-block guard as STEP 0 (`:133-162`), including the "honest note on what this can and cannot catch" register (`:141-146`).
- `COMMENT ON FUNCTION` restated (`20260522111839:188-193`) and any semantic-drift `COMMENT ON COLUMN` updates (`20260728120000:317-322`).

**Self-verify DO block for FUNCTION bodies** — the exact analog is `20260728120000` STEP 4 `(:327-425)`, esp. the fragment-scoped check:
```sql
-- :399-422 — scoped to the INSERT fragment ON PURPOSE: a whole-body ILIKE would be
-- satisfied by the parameter declaration ... i.e. the loose check passes on the
-- UNFIXED body and proves nothing.
SELECT pg_get_functiondef('public.finalize_csv_strategy(uuid,uuid,text,text,text)'::regprocedure) INTO v_fn_src;
v_ins_start := strpos(v_fn_src, 'INSERT INTO strategies (');
v_ins_end   := strpos(v_fn_src, 'RETURNING id INTO v_strategy_id');
IF v_ins_start = 0 OR ... THEN RAISE EXCEPTION '... anchors have drifted, FIX THE ANCHORS rather than deleting this check';
```
Secondary analog for overload/arity assertions: `20260601120000:577-622` (exactly-one-overload count `:584`, `pronargs` check `:594`, body-fragment presence checks `:611-622`).

### 2. The TERMINALIZE arm (founder-locked reading β)

**Register analog:** `20260817120000_retention_orphaned_running_terminalize.sql` header — terminal UPDATE, never DELETE; the row survives "so a poller sees a real outcome and the audit trail holds"; the chosen terminal value is picked because it sits OUTSIDE every claim/re-claim predicate while remaining visible. The 145 arm should follow the same three-part justification: (1) what the user's poller sees, (2) what the audit trail keeps, (3) which downstream mechanisms' predicates the terminal value deliberately does/doesn't trip (for 145: Phase 143's sweep conjuncts at `20260816140000:719-762` — ⛔ untouchable).

**Route-side terminal-write analog:** `writeFailedStrategyAnalyticsPlaceholder` `route.ts:711-806` — already writes a `failed` `strategy_analytics` placeholder on the persist-fail arm (`route.ts:640-648`) specifically "so the SyncProgress poller can break out with a recoverable error surface instead of polling forever" (`route.ts:626-633` comment). If 145's terminalize targets `strategies.status`, this helper is the shape: select-then-write with its OWN Sentry captures on failure (`:736`, `:783`, `:801`), `logPrefix`/`correlationId`/`subcontext` opts.

⚠️ Derived thresholds only: if any grace window appears, it must carry a derivation in the register of `20260816140000:51-71` / `20260817120000`'s "Threshold rationale" (batch-of-5 × 30-min timeout arithmetic) — a bare number is what got Phase 106's janitor reverted.

### 3. Route changes (`route.ts`)

**Direct-RPC-from-route call shape (if measurement picks i-b, or for any new RPC call):** CONTRIB-02, `route.ts:1469-1489` —
```typescript
const { data: newStrategyId, error } = await (
  supabase.rpc as unknown as (
    fn: "finalize_csv_strategy",
    rpcArgs: { p_user_id: string; ... p_terminal_status: string },
  ) => Promise<{ data: string | null; error: { code?: string; message?: string } | null }>
)("finalize_csv_strategy", { ..., p_terminal_status: "private" });
```
The cast-through-unknown is the house pattern because `database.types.ts` doesn't carry these RPCs (`route.ts:1462-1468` explains); mirrors the persist cast at `:614-623`. Success check is `if (error || !isUuid(newStrategyId))` — validate the payload, not just error-null (TS-13).

**Error logging:** always `console.error(prefix + [correlation_id=…], error.code, scrubSeamError(error))` — `.code` is the allowlisted SQLSTATE, `.message` never logged raw (SEAMRIM-06; `route.ts:628-637`, `:1493-1500` incl. the optional-chaining-token gotcha).

**Sentry capture pattern** (apply to the two currently-missing arms — persist-error `:624-633` and stale-probe-error `:574-596`):
```typescript
// route.ts:933-936 (metadata-update) / :836-839 (enqueue) — the two live exemplars
captureToSentry(updateError, {
  tags: { surface: "csv-finalize", step: "metadata-update" },   // step distinguishes the arm
  extra: { strategy_id: strategyId, correlation_id: opts.correlationId },
});
```
`captureToSentry` is `src/lib/sentry-capture.ts:191`; import at `route.ts:12`. Convention: pair EVERY `console.error` on a fail-arm with a capture; `tags.step` is the dedupe/triage axis. New steps: e.g. `step: "stale-probe"` and `step: "persist-dailies"`.

**Response-copy honesty:** the 503's `"Nothing was changed."` (`route.ts:588-590`) is FALSE today and must become true (folded txn makes it true) or change. The 500's copy (`:653-654`, "Your strategy was created but…") is the honest template — and note CONTEXT's warning that the two copies move together. Envelope shape: `{ ok: false, code, human_message, debug_context: { strategy_id }, correlation_id }` + `NO_STORE_HEADERS` (`:577-596`) — keep it byte-compatible; `csv-finalize-after-failloud.test.ts` and the merge tests pin codes `CSV_PERSIST_FAIL` / `CSV_SESSION_REUSED`.

### 4. The rebuilt regression test

**Mock scaffold to copy:** `csv-finalize-c14-regression.test.ts:22-75` — `@vitest-environment node`; `vi.mock("server-only", …)`; `withAuth` passthrough with a fixed user id; `vi.hoisted` `rpcMock`/`checkLimitMock`; `createClient` mock exposing `auth.getSession` (unified path's 401 guard), `rpc`, and a chained `from().update().eq().eq()`. `csv-finalize-cross-submission-merge.test.ts` (278 lines, 5 arms incl. fail-closed) is the second exemplar and the one whose arms must be re-observed RED if CR-01 moves into SQL.

**The vacuous test being replaced** — `csv-finalize-c14-regression.test.ts:144-190`: it drives the PRE-create 400 (RPC never called) and then asserts the orphan capture was **NOT** made, searching for the string `"orphan strategy row"` which exists nowhere in `src/`. Its own comments admit the post-RPC path is unreachable from the body alone (`:159-176`). The replacement must drive the actual post-RPC failure (mock `rpcMock` success then force the downstream arm to fail) and assert the capture/terminalize WAS made — then be neutered and observed RED before restore (founder rule).

**Anti-vacuity discipline to copy:** `retention-orphaned-running-terminalize.test.ts:152-161` — after any extraction/setup step, assert a load-bearing invariant of the extracted thing itself ("the extracted body does not contain X — the extraction is broken") so a silently-wrong span cannot green every downstream assertion.

### 5. CI gates

**SQL behavioral gate** (arm 1 of SC#1 + any folded-RPC gate) — analog `supabase/tests/test_csv_finalize_double_submit.sql`:
- Header states what it is FOR, which existing green gate CANNOT catch this ("would have passed, GREEN, on this regression" `:17-22`), and the enumerated Parts.
- ⭐ Part-3 discipline: assert the ROLLBACK ("EXACTLY ONE row after the failed second call — verified here, not trusted" `:32-37`) — for 145, the folded-txn gate must assert that a mid-body failure leaves ZERO strategies rows AND zero dailies.
- ⭐ Control-case discipline: Part 4's cross-source control uses the REAL writer, with its own VACUITY FENCE asserting the precondition of the control (`:44-58`). Do not weaken/rely on `test_strategy_verifications_wizard_session_tenant_scope.sql` (`:17-22`).
- **42501 assertion shape:** `test_commit_scenario_batch_auth_input.sql:82-139` — DO block, forge/omit JWT claims, `EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS`-style capture into `err_state`, then `IF err_state <> '42501' THEN RAISE EXCEPTION 'Test N failed: expected 42501, got %'`, `RAISE NOTICE '… passed'`, and cleanup DELETEs. Arm 1's message assertion should pin the literal `'finalize… called without an auth session'` substring.
- Location law: `supabase/tests/test_*.sql` is the ONLY place SQL gates run in CI.

**TS migration-content gate** (optional, if the plan mirrors 144): `retention-orphaned-running-terminalize.test.ts` — exact-filename + 14-digit prefix strictly greater than the pinned repo tip (`:76-78`, `:180-186`), body-scoped extraction with the anti-vacuity guard, "no later migration silently re-registers" scan (`:34`). For a FUNCTION migration the sibling is `reconcile-dropped-enqueue-sweep.test.ts` (same family, function-body regexes).

## Shared Patterns

### SECDEF hardening checklist (applies to the one new function)
`SECURITY DEFINER` + `SET search_path = public, pg_catalog` (no pg_temp — `20260601120000:95-99`) → NULL-uid 42501 → uid≠p_user_id 42501 → input 22023 guards with caps → probe-oracle-collapsed 42501 for any lookup → no EXCEPTION block unless a specific arm is argued → `REVOKE FROM PUBLIC, anon; GRANT TO authenticated` restated → `COMMENT ON FUNCTION` → self-verify DO block with fragment-scoped body checks. Migration-reviewer invariants #3/#15/#19 apply (caller-supplied JSONB into a SECDEF surface — CONTEXT flags this explicitly).

### Sentry capture (apply to every new/changed fail-arm)
`console.error(prefix, err.code, scrubSeamError(err))` + `captureToSentry(err, { tags: { surface: "csv-finalize", step: "<arm>" }, extra: { strategy_id, correlation_id } })` — exemplars `route.ts:933`, `:836`, `:1514`.

### Every-gate-must-fail
Neuter → run → observe RED → restore, per gate. Inherited green is not evidence — this file's own analog set contains one test that could never fail and one regex window that matched nothing (below).

## Anti-Patterns / Traps the analogs encode

| Trap | Where it bit | The fix the analog applied |
|---|---|---|
| `CREATE UNIQUE INDEX IF NOT EXISTS <old name>` silently no-ops against the OLD definition | `20260728120000:94-99` | new NAME + self-verify asserts the actual column LIST AND ORDER from `pg_index` (`:339-355`) |
| Whole-body `ILIKE` self-verify passes on the UNFIXED body | `20260728120000:399-403` | scope the check to the fragment between two anchors; RAISE "FIX THE ANCHORS" if anchors drift (`:410-414`) |
| `[^)]*` regex window matched nothing / forbids nothing | `reconcile-dropped-enqueue-sweep.test.ts:349` ("was `[^)]*` until 2026-08-17"); `retention-…-terminalize.test.ts:534` uses `[^;]*` deliberately | measure the window against the REAL body; prefer `[^;]*` statement-bounded windows |
| Extraction regex matched a PROSE pair in comments → every negative assertion vacuously green | `retention-…-terminalize.test.ts:57-63` (Phase 143 Plan 02, live) | anti-vacuity guard on the extracted span (`:152-161`); never spell the opening tag in comments |
| Test named for a guarantee that does not exist, asserting NOT-called on a string that exists nowhere | `csv-finalize-c14-regression.test.ts:144-190` | this phase deletes/rebuilds it; replacement must be observed RED when neutered |
| Unchecked supabase-js read resolves (not throws) → failed read rendered as measurement (C-3) | `route.ts:574-580` | fail CLOSED on `staleErr`; keep this in any plpgsql translation (a fence that can't run must refuse, not pass) |
| Substring denylist bounds too loose / presence gates that green-skip | house memory (BL-01, e2e grep-gates) | word-bounded matches + COUNT assertions; grep the WHOLE repo before disclosure-deletes and renames |
| DROP FUNCTION loses ACLs | `20260601120000:32` | re-issue REVOKE/GRANT after any DROP+CREATE |
| Backdated migration prefix ≤ repo tip | `retention-…-terminalize.test.ts:180-186` | new prefix must sort strictly after `20260817120000` |

## Contradictions between analogs (picked, not blended)

1. **`service_role` EXECUTE:** `persist_csv_daily_returns` grants it (`20260522111839:210`); `finalize_csv_strategy` does NOT (`20260728120000:314-315`, authenticated only). **Pick the finalize shape (more recent, and CONTEXT proves zero service-role callers exist).** The folded function: `GRANT ... TO authenticated` only. Flag the persist grant as a candidate for tightening if the standalone persist is dropped.
2. **`EXCEPTION` block:** `commit_scenario_batch` has one (`20260601120000:518`, for its idempotency-cache arm); `finalize_csv_strategy` deliberately has NONE (`20260728120000:80-87` — the 23505 rollback guarantee depends on it). **Pick finalize's no-EXCEPTION discipline for the folded function** — its atomicity claim IS the phase. `commit_scenario_batch` remains the best analog for multi-INSERT loop structure, jsonb array validation, and per-index RAISE messages (`[index=%]`), not for exception handling.
3. **Idempotency locus:** the 23505 idempotent-resolve + CR-01 name comparison live in Python (`process_key.py:1160-1230`); CONTRIB-02 has no such arm. If folding moves idempotency into SQL/route, the Python arm's behavior is the contract to preserve (more tested), and the Python code must not be left half-live — surface, don't blend.

## Migration filename / timestamp convention

- 14-digit prefix, strictly greater than repo tip `20260817120000` (Phase 144, ⛔ untouchable). Recommended: `20260818120000_` or later; the repo favors round `120000`/`140000` times and descriptive snake_case names stating the mechanism (e.g. `..._csv_finalize_atomic_fold.sql`).
- No `down/` file expected (26/230 have one); put a manual-rollback recipe in the header instead (`20260728120000:116-127`).
- ⛔ Merging `supabase/migrations/**` to main AUTO-applies to PROD; apply to TEST via Supabase MCP in the orchestrator session first (MCP is stripped from subagents).

## No Analog Found

None. Every artifact class has a direct in-repo analog. The only genuinely novel surface is a SECDEF function taking caller-supplied JSONB **and** creating the row it writes into (so the probe-oracle guard partially dissolves) — flagged above under Pattern Assignment 1, guard 5, for the planner to reason through rather than copy.

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/tests/`, `src/app/api/strategies/csv-finalize/`, `src/__tests__/`, `src/lib/`
**Key files read:** `20260728120000` (full), `20260522111839:98-215`, `20260601120000:60-120 + grants/self-verify`, `20260817120000:1-120`, `route.ts:514-670, 830-845, 915-940, 1441-1500`, `csv-finalize-c14-regression.test.ts:1-60, 140-195`, `test_csv_finalize_double_submit.sql:1-58`, `test_commit_scenario_batch_auth_input.sql:82-139`, `retention-orphaned-running-terminalize.test.ts` (structure)
**Pattern extraction date:** 2026-08-17
