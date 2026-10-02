---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
artifact: VALIDATION
status: authored
nyquist_validation: true
authored: 2026-08-13
revised: 2026-08-13 — Wave-0 measurements (156-MEASUREMENTS.md A4) added the SC1-durability row
covers: [CONNECT-01, CONNECT-02, CONNECT-03, CONNECT-04, CONNECT-05]
plans: ["156-01", "156-02", "156-03", "156-04", "156-05", "156-06", "156-07", "156-08", "156-09", "156-10"]
---

# 156 — Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`. `156-RESEARCH.md` §
*Validation Architecture* (`:449+`) already establishes the **test framework**, the **requirement →
test map**, the **sampling rate** and the **Wave-0 gaps**. ⛔ This file does not restate them —
read that section first. This file supplies the two things it does not: a consolidated
**Falsifiability Ledger** mapping every success criterion onto a semantic mutation of *production*
source, and an **Oracle Independence** checklist.

⚠️ **Why this file exists at all.** The substance was present but scattered — plans 03, 05, 08 and
09 demand **a pasted red-under-mutation proof for every row of the inventory below**, and nothing
mapped SC1–SC5 onto those mutations. A mutation that no success criterion claims is a mutation nobody will notice
is missing. Writing the ledger is what surfaced the SC4 hole (row 4 below).

---

## Nyquist Checks 8a–8f

| Check | Requirement | Status |
|-------|-------------|--------|
| 8a | Every task carries an `<automated>` command | ✅ all tasks across plans 01–10 |
| 8b | No watch-mode / interactive command in any `<automated>` | ✅ `vitest run`, `psql -f`, `tsc --noEmit` only |
| 8c | No per-task gate routed through the E2E lane | ✅ `e2e-seeded` appears only in plan 06's live gate, which is a checkpoint, not a task gate |
| 8d | No `MISSING — Wave 0 must create …` stubs | ✅ every gate this phase asserts against either exists or is created by a named task in the same phase |
| 8e | Verify commands are pipeline-honest | ✅ **as of this revision** — plan 08's **three** `psql \| tee` pipelines now run under `set -o pipefail`; plan 09 already used `\|\| exit 1`; plan 03 Task 4 uses `set -o pipefail` |
| **8f** | Consolidated Falsifiability Ledger + Oracle Independence checklist | ✅ **this file** |

---

## Falsifiability Ledger

Every row names a **semantic mutation to production source or to live database state** — never a
mutation to a test — and the assertion that must turn **RED** when it is applied. A criterion with
no red-producing mutation is not verified, however many assertions mention it.

⛔ **Every mutation is applied to a throwaway PG16 fixture or a local working tree, observed, and
reverted.** No mutation is applied to TEST (`qmnijlgmdhviwzwfyzlc`) and none, ever, to PROD
(`khslejtfbuezsmvmtsdn`). ⛔ Never `supabase db push`.

### SC1 — A caller with a valid session cannot set `attested_venue` by any route

| | |
|---|---|
| **Mutation** | On the fixture: `GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text) TO authenticated;` and the same for the 11-arg `add_wizard_composite_key`. This restores exactly the state Migration B removes. |
| **Must turn RED** | `test_api_keys_exchange_not_user_writable.sql` — inverted **5d** (privilege-FALSE arm) and **5f** independently; `test_wizard_session_idempotency.sql` inverted **G1**; `test_wizard_composite_fence.sql` inverted **G2**. |
| **Owned by** | `156-08` Task 1 acceptance (i); `156-09` Task 1 acceptance |
| **Must stay GREEN** | the `service_role`-TRUE positives, the `anon` assertions, and 5b/5c/5e — a mutation that reds everything proves nothing about *which* control fired |
| **Independence** | The oracle reads the ACL via `has_function_privilege` and the SQLSTATE from a real call. It never reads the migration file, so a migration that lies about itself cannot green it. |

### SC1 (durability) — the `REVOKE` stays revoked across future migrations

⚠️ **Distinct from the row above, and the distinction is the point.** The SC1 row proves the `REVOKE`
**happened**. This row proves it **stays happened**. The observable mutation is nearly the same
statement; the failure model, the oracle and the owning task are all different. A ledger that
collapsed the two would record the class as covered when only the instance is.

| | |
|---|---|
| **Why this row exists** | `156-MEASUREMENTS.md` § A4 (Wave 0, **measured**): Supabase's `pg_default_acl` for `public` functions granted by role `postgres` is `postgres=X anon=X authenticated=X service_role=X`. **Any** future migration that `DROP`s and re-`CREATE`s either wizard RPC silently re-grants EXECUTE to `authenticated` **and** `anon` — no error, nothing in the diff. `20260812083206` (Phase 154) did exactly that three days before this phase, and its post-verify at `:867` exists *because the author hit it for `anon`*. ⛔ Migration B cannot guard this: its post-verify runs once, at apply, on a migration that has already shipped. |
| **Mutation (i)** | On the fixture: `GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text) TO authenticated;` |
| **Must turn RED** | **5h** in `test_api_keys_exchange_not_user_writable.sql`, naming `create_wizard_strategy`, `pg_default_acl`, and the remedy. |
| **Mutation (ii)** | The same `GRANT … TO authenticated` against the **11-arg** `add_wizard_composite_key`. |
| **Must turn RED** | **5h** again, **independently**, naming that function. ⭐ Without this second mutation the gate could cover one twin and the ledger would not know — the exact instance-not-class shape this phase was convened to end. |
| **Mutation (iii)** | `GRANT EXECUTE … TO anon` on either signature. ⛔ (i)+(iii) together reproduce **precisely** the ACL state a `DROP`+`CREATE` leaves behind, without dropping the function. |
| **Must turn RED** | 5h's `anon` arm. |
| **Mutation (iv)** | `REVOKE EXECUTE … FROM service_role` on either signature. |
| **Must turn RED** | 5h's positive, with the *outage*-worded message — the anti-vacuity half, which is what catches a `REVOKE` that went one role too far. |
| **Owned by** | `156-08` Task 3 acceptance — **all four reds pasted** into `156-08-SUMMARY.md` |
| **Must stay GREEN** | 5b, 5c, 5e and assertions 1–4 under all four. Each mutation is a bare `GRANT`/`REVOKE` that touches no row, so `153.6-07-SUMMARY.md`'s 5b-interception hazard cannot apply — and that isolation is deliberate, not luck. |
| **Independence** | ⛔ The oracle is a `supabase/tests/test_*.sql` file in the `sql-tests` CI lane, re-run on **every** PR — not a post-verify inside the migration, which is the migration checking itself, once. And 5h arms itself from `pg_get_functiondef` (`auth.uid()` absent ⇒ Migration B is live), **not** from a `col_description` marker: the mechanism this whole file distrusts most — a comment re-stamp that silently un-arms a block — cannot un-arm the gate that guards against it. `(5h′)` and `(5a‴)` red when the body says Migration B is live but a marker has gone missing. |
| **PR-A behaviour, stated so no one has to infer it** | 5h **skips**, it is not inverted. On a Migration-A-only database the bodies still carry `auth.uid()`, so 5h is un-armed by construction; and PR A's copy of the file does not contain 5h at all, since plan 08 lands in PR B. ⛔ A gate that is red for the width of a landing is as bad as one that never fires — this one is neither. |

### SC2 — `attested_venue` is written from a venue the server verified at mint time

| | |
|---|---|
| **Mutation A** | In `create-with-key/route.ts`, re-point the `.rpc(` receiver identifier from the `createAdminClient()` binding to the `createClient()` binding (the user-scoped one the file legitimately also binds). |
| **Must turn RED** | `156-05`'s **Scan B** pairing heuristic, naming the file; and `create-with-key/route.test.ts`'s wrong-client case (the `@/lib/supabase/server` mock's `rpc` throws and is asserted un-called). |
| **Mutation B** | Add a throwaway non-test file under `src/` (including one under `src/lib/**` and one `.tsx`) containing a user-scoped `.rpc("create_wizard_strategy"` call. |
| **Must turn RED** | `156-05`'s **Scan A**, naming the path. ⛔ `git status --porcelain` must be clean afterwards — a probe file left behind is itself the defect. |
| **Mutation C** | Replace `exchangeNormalized` with a hard-coded constant *before* all three consumers (`validateKey`, `encryptKey`, `p_exchange`), so all three still agree. |
| **Must turn RED** | The **literal-anchored** `"binance"` assertion added to `156-02` Task 1 / Task 2. ⚠️ The three-way **identity** assertion stays GREEN under this mutation — that is precisely why both halves are required, and why identity alone was insufficient. |
| **Owned by** | `156-05` Task 1 (A, B); `156-02` Tasks 1–2 (C) |
| **Independence** | Scan A/B read *source text*, not runtime; the route tests read runtime through mocks. Two mechanisms, neither able to green the other. |

### SC3 — The wizard still works, and the ownership check survives the loss of `auth.uid()`

| | |
|---|---|
| **Mutation A** *(PR-A window — added this revision)* | On the fixture, `CREATE OR REPLACE` the `create_wizard_strategy` body with the **flat union**: `v_auth_uid UUID := auth.uid();` declared and never compared, plus `IF v_jwt_role NOT IN ('authenticated','service_role') THEN RAISE`. |
| **Must turn RED** | `test_wizard_composite_fence.sql` **Part 3c** (minted by `156-03` Task 4) — the call is admitted, a row is minted, `raised` stays FALSE, and the row-delta assertion fires. Independently, Migration A's post-verify **(e2)** **aborts at apply**. |
| **Why this row is the highest-value one in the file** | The flat union satisfies *every* loose criterion — it contains `auth.role()`, contains `auth.uid()`, has no `IS NULL THEN RETURN`, has no `IS NOT NULL AND … <> p_user_id`. Before this revision, `create_wizard_strategy` had **no CI-run cross-user assertion at all** (`add_wizard_composite_key` had Part 3b; the single-key twin existed only in `wizard-rpcs-live-db.test.ts:211`, `it.skipIf(!HAS_LIVE_DB)`, which never runs in CI). The same hole opens by accident if the 142-line verbatim re-base simply drops one `RAISE`. |
| **Mutation B** *(PR-B window)* | Revert one re-shaped claim site in `test_wizard_composite_fence.sql` from `'service_role'` to `'authenticated'`. |
| **Must turn RED** | That site's own assertion, naming the RPC (`156-09` Task 2). |
| **Mutation C** | Neuter the route-level `p_user_id === user.id` assertion named in Part 3b's / Part 3c's replacement prose. |
| **Must turn RED** | The named vitest case — proving the pointer to the surviving control is live, not decorative. ⭐ This is the only control that remains after `auth.uid()` leaves the database; a stale pointer to it is a silent single point of failure. |
| **Live oracle (not a mutation)** | `156-06` **row 4** — a composite connect on PROD in a real browser. Falsifier: the first member succeeds and a later one fails, i.e. the twin diverged. ⭐ A 40-minute browser pass has beaten 10,193 tests in this repo before; nothing in the suite can prove Vercel Production actually holds `SUPABASE_SERVICE_ROLE_KEY`. |
| **Owned by** | `156-03` Task 4 (A); `156-09` Task 2 (B, C); `156-06` row 4 (live) |
| **Independence** | (e2) is the migration checking itself and does **not** count on its own; Part 3c is an external gate in a different file, in a different CI job, asserting observable behaviour. |

### SC4 — The `api_keys_attested_venue_matches_exchange` CHECK is kept

| | |
|---|---|
| **Mutation** *(added this revision — the gap the ledger surfaced)* | On the fixture: `ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_attested_venue_matches_exchange;` |
| **Must turn RED** | `test_api_keys_exchange_not_user_writable.sql` **5e**, on its `v_ins_err IS NULL` arm (`:409-411`): the divergent privileged INSERT (`exchange='binance'`, `attested_venue='mt5'`) **succeeds**, so 5e raises *"the CHECK is missing, so an attestation can be forged WITHOUT forging the routing label"*. |
| **⛔ Do not mutate the test** | 5e is byte-frozen by `156-08`'s own constraints. The mutation is to the **database**, and 5e is left exactly as 153.6 shipped it. |
| **⚠️ Run as the privileged role** | As `authenticated` the BEFORE INSERT trigger NULLs `attested_venue` first, the CHECK is never reached, and a "refused" result would be the trigger's doing (`:397-400`). |
| **Owned by** | `156-08` Task 1 acceptance (iii) |
| **Independence — the reason this row was missing** | Both migrations' post-verify **(g)** asserts the constraint is present and `convalidated`. That is **the migration checking itself**: a migration that drops the CHECK and omits (g) passes, and a migration that never had (g) passes trivially. Nothing else in the ten plans reddened on a dropped CHECK. 5e is the independent oracle, and this mutation is what turns "5e exists" into "5e is load-bearing for SC4". |

### SC5 — Every prose claim 153.6 weakened is re-strengthened; the `threat_flag` is cleared

| | |
|---|---|
| **Mutation** | Not a code mutation — the oracle is the **repo grep**, using 153.6-07's own method: *"a repo grep for the claim now returns only the negated usage"*. |
| **Must be true** | `grep -c 'threat_flag: deferred-control' .planning/REQUIREMENTS.md` returns **0** (asserted in `156-10` Task 2's `<automated>`), and every surviving occurrence of the weakened claim is negated or historical (the applied migration `20260811210000` is historical **and must never be edited** — invariant 11). |
| **Owned by** | `156-10` Task 1 (the grep, command and output recorded in the summary) and Task 2 (the ledger flip) |
| **⛔ The gate on flipping** | The flip is permitted only on an **observed-green** `sql-tests` run. ⚠️ Pitfall 9: `sql-tests` shares the `shared-test-db` concurrency group with `python` and `e2e-seeded`; a cancelled job renders **grey**, and branch protection is deferred on this repo, so a lost gate looks like a pass. Re-run it; never interpret it. |
| **Independence** | The grep reads the repo; the ledger flip is gated on CI, not on the grep. Neither can green the other. |

---

## Oracle Independence Checklist

⭐ House rule (`feedback_economic_invariant_oracles_not_self_referential`): **an oracle that
re-derives its expectation from the implementation under test proves nothing.** Three money bugs
survived six review passes in this repo behind self-referential oracles. Each box below asserts
that the oracle and the subject are separate artifacts.

- [ ] **SC1's oracle is not the migration.** 5d/5f/G1/G2 read `has_function_privilege` from the
      live ACL and the SQLSTATE from a real call. ⛔ No SC1 assertion greps the migration file.
- [ ] **SC3's oracle is not the migration's post-verify.** Migration A's (e2) and Migration B's
      body assertions are the migration checking itself. Part 3c and the `test_api_keys_venue_identity_uniq.sql`
      canaries assert `pg_get_functiondef` **from outside the migration chain**, so they survive
      the migration being edited, re-based, or replayed from a stale snapshot.
- [ ] **SC1's `REVOKE` is not self-enforcing, and its guard is not in the migration.**
      `pg_default_acl` re-grants `anon` and `authenticated` on any `DROP`+`CREATE` of a `public`
      function owned by `postgres` (`156-MEASUREMENTS.md` § A4). A post-verify runs **once**, at
      apply; the migration that reopens the door has not been written yet. **5h** lives in
      `supabase/tests/test_*.sql`, runs in `sql-tests` on every PR, and arms from
      `pg_get_functiondef` rather than a comment marker — ⛔ a gate that guards against silent
      un-doing must not itself be armed by something that can be silently un-done.
- [ ] **SC4's oracle is not post-verify (g).** 5e is an independent behavioural assertion; (g) is
      not counted toward SC4 on its own. ⚠️ This was the gap.
- [ ] **Every negative is paired with a positive.** `has_function_privilege('authenticated', …) =
      FALSE` **also passes on a database where the function was dropped**. Every inverted pin in
      plans 08 and 09 carries a `service_role`-TRUE companion worded as an *outage* assertion, and
      every negative call assertion carries a privileged positive that must SUCCEED and store
      `attested_venue = exchange`.
- [ ] **No gate may report success while asserting nothing.** The 5a–5e block is gated on
      `col_description(api_keys.attested_venue) LIKE '%20260811210000%'`; a false marker sends
      control to `RAISE NOTICE 'SKIP (5)'` at **exit 0, green CI, zero coverage**. Plan 08 Task 2's
      (5a′) and (5a″) cross-check marker-against-marker and marker-against-privilege from two
      independent sources. Plan 05's Scan C applies the same lesson to TypeScript with a
      hand-typed per-file match count.
- [ ] **No verify may launder an exit status.** Every `psql … | tee …` runs under `set -o pipefail`
      or `|| exit 1`. ⛔ A pipeline returns `tee`'s status; without this, a run that aborts *after*
      an earlier NOTICE verifies green on a failing gate.
- [ ] **No green is read from a bare exit code in a worktree.** GSD worktree agents get **no**
      `node_modules`: `npx vitest` exits 1 with `MODULE_NOT_FOUND` exactly as a failing test does.
      Symlink the main checkout's `node_modules`, then grep for the per-test **name** among the
      failures. Every new vitest case in this phase carries the literal token `156` for that reason.
- [ ] **No grey is read as green.** `sql-tests` cancelled by the `shared-test-db` concurrency group
      renders grey; branch protection is deferred, so nothing blocks. Re-run, never interpret.
- [ ] **CI-only vitest failures are not flakes.** CI runs Node 22, local is Node 25. Reproduce with
      `PATH=/opt/homebrew/opt/node@22/bin` before calling anything a flake.
- [ ] **`it.skipIf` and `*_live.py` are not gates.** `src/__tests__/wizard-rpcs-live-db.test.ts` is
      `it.skipIf(!HAS_LIVE_DB)` and **never runs in CI**. ⛔ It may not be counted toward any
      success criterion in this phase — which is exactly why SC3 needed Part 3c.

---

## Mutation Inventory — where each proof is pasted

| # | Mutation | Plan / Task | SC |
|---|----------|-------------|-----|
| 1 | Flat-union `create_wizard_strategy` body on the fixture | `156-03` Task 4 | SC3 |
| 2 | Corrupt `exchangeNormalized` before all three consumers | `156-02` Tasks 1–2 — ⚠️ **not demanded as a pasted proof**, see the note below | SC2 |
| 3 | Third `.rpc` writer added under `src/` (incl. `.tsx`, `src/lib/**`) | `156-05` Task 1 Scan A | SC2 |
| 4 | Route `.rpc` receiver re-pointed to the user-scoped binding | `156-05` Task 1 Scan B | SC2 |
| 5 | Re-GRANT `authenticated` EXECUTE — 5d reds | `156-08` Task 1 (i) | SC1 |
| 6 | Re-GRANT `authenticated` EXECUTE — 5f reds independently | `156-08` Task 1 (i) | SC1 |
| 7 | Privileged positive neutered to an `authenticated` claim | `156-08` Task 1 (ii) | SC1 |
| 8 | **DROP the `attested_venue = exchange` CHECK — 5e reds** | `156-08` Task 1 (iii) | **SC4** |
| 9 | Strip `20260811210000` from the column comment — (5a′) reds | `156-08` Task 2 | SC1 |
| 10 | Strip the new migration id, door still shut — (5a″) reds | `156-08` Task 2 | SC1 |
| 11 | Re-GRANT `authenticated` — G1/G2 inverted pins red | `156-09` Task 1 | SC1 |
| 12 | REVOKE `service_role` — both positives red, outage-worded | `156-09` Task 1 | SC1 |
| 13 | Claim site reverted to `'authenticated'` | `156-09` Task 2 | SC3 |
| 14 | Route-side `p_user_id === user.id` assertion neutered | `156-09` Task 2 | SC3 |
| 15 | Re-GRANT `authenticated` — neither 3b nor 3c reds (vacuity proof) | `156-09` Task 2 | SC3 |
| 16 | Pre-`20260811210000` body restored — `attested_venue` canary reds | `156-09` Task 3 | SC3 |
| 17 | Relaxed `auth.uid()` comparison reintroduced — canary reds | `156-09` Task 3 | SC3 |
| 18 | GRANT `authenticated` EXECUTE on the **12-arg** sig — 5h reds | `156-08` Task 3 | **SC1-durability** |
| 19 | GRANT `authenticated` EXECUTE on the **11-arg** sig — 5h reds **independently** | `156-08` Task 3 | **SC1-durability** |
| 20 | GRANT `anon` EXECUTE — 5h's `anon` arm reds (with #18, the post-`DROP`+`CREATE` ACL state) | `156-08` Task 3 | **SC1-durability** |
| 21 | REVOKE `service_role` EXECUTE — 5h's positive reds, outage-worded | `156-08` Task 3 | **SC1-durability** |

⛔ Every one of these is **observed and pasted** into the owning plan's `-SUMMARY.md` — with **one
stated exception, row 2**. A row with an asserted-but-unpasted proof is not closed.

⚠️ **Row 2 — corrected this revision.** `156-02`'s acceptance criteria require the literal-anchored
`"binance"` case to **exist** in both twins; they do **not** demand this mutation be applied,
observed and pasted, and no criterion is being added here to make them. Row 2's falsifiability comes
from plan 02's **RED-first discipline** instead: the case is authored in wave 1 and lands RED on
purpose, before plan 04 changes the route, so the red is observed as a matter of course rather than
manufactured by a mutation. ⛔ The inventory previously implied a paste that no plan asks for — a
ledger that overstates its own evidence is precisely the defect this file exists to prevent, so the
row is annotated rather than quietly counted. Rows 1 and 3–21 are demanded-with-paste as written.

---

## Coverage Statement

| SC | Has a mutation that reds a production-independent oracle? |
|----|-----------------------------------------------------------|
| SC1 | ✅ #5, #6, #11, #12 — the `REVOKE` **happened** |
| SC1-durability | ✅ #18–#21 — it **stays happened**. Added by this revision, after `156-MEASUREMENTS.md` § A4 measured the `pg_default_acl` re-grant that makes a one-shot `REVOKE` insufficient. Previously **uncovered**: nothing in the ten plans reddened when a future `DROP`+`CREATE` re-opened the door |
| SC2 | ✅ #3, #4 pasted; #2 via `156-02`'s RED-first discipline (annotated in the inventory, not a demanded paste) |
| SC3 | ✅ #1, #13, #14, #15, #16, #17 + plan 06 row 4 (live) |
| SC4 | ✅ #8 — **added by this revision**; previously covered only by the migration's own post-verify (g) |
| SC5 | ✅ repo grep + the observed-green `sql-tests` gate on the ledger flip |
