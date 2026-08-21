---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 06
artifact: live-acceptance
status: pass
verified_on: 2026-08-13
verified_against: production
gates: 156-07
---

# Phase 156 — Live acceptance for PR A (landing 1 of 2)

**What this file is for.** PR A moves both wizard write RPCs onto the server's own `service_role`
credential while leaving `authenticated`'s grant standing. PR B withdraws that grant. Withdrawing it
is only safe if the new writer is *observed working in production* — not inferred from a green unit
suite that mocks the very client under test.

⭐ The unit suite cannot prove any of: that Vercel's Production env carries
`SUPABASE_SERVICE_ROLE_KEY`, that PostgREST authenticated as `service_role`, or that the RPC body
took the arm we believe it took. Only a real browser against real PROD can.

⛔ Values and booleans only. `.planning/` is **tracked** and this repo is **public** — no key ids,
no user ids, no connection strings, no `venue_account_id`.

---

## Rows 1–5 — GATING

### 1. Deploy state
**Falsifier:** a Production deploy whose SHA is older than the merge commit. A **grey** `sql-tests`
is not a pass either — it shares the `shared-test-db` concurrency group, a cancelled job renders
grey, and branch protection is deferred on this repo.

**Observed:** PR #680 squash-merged as `25e28d3a`. Vercel Production deployment
`githubCommitSha = 25e28d3ac5dfe18232cd6f6c5fd1340b6064a3de`, `target: production`,
`state: READY`, aliased to `quantalyze.xyz` — READY at **18:48:50 UTC**. On `main` at that SHA:
`Supabase Migrate = success`, `CI = success`, `Contracts = success`,
`SQL Function Snapshot — Drift Gate = success`. On the PR beforehand, `sql-tests` ran **30s** (a
real run, not grey), `e2e` 6m51s, `e2e-seeded` 8m15s, `python` 7m15s, zero non-pass checks.
**Verdict:** PASS

---

### 2. Env precondition
**Falsifier:** absent in Preview — every preview wizard broken while Production looks fine, and
nothing in CI would say so. After PR A, **connect-a-key** depends on this variable where previously
only *submit* did (T-156-20).

**Observed:** MEASURED PRE-MERGE via `vercel env ls` — `SUPABASE_SERVICE_ROLE_KEY` present and
Encrypted in **both** `Production` and `Preview`, each created 126d ago. Measured before the merge
precisely because this is the row that decides whether the route swap can take connect-a-key down.
**Verdict:** PASS

---

### 3. Single-key connect — real browser, PROD
**Falsifier:** a `SEAM_MISCONFIGURED` 503 (*"We could not send this request — our own configuration
is wrong"*, no Retry control) means the service key never reached the route; a `42501`-shaped
failure means `GRANT … TO service_role` did not land.

**Observed:** Founder completed a single-key connect on `quantalyze.xyz` at **19:02:40 UTC** —
14 minutes *after* the new deploy went READY, so it was served by PR A's code. Vehicle was **MT5**
rather than a ccxt venue (deviation, see below). Neither falsifier appeared: no
`SEAM_MISCONFIGURED`, no privilege error, and the row was minted.

⭐ **The write is provably the RPC's, not a client INSERT.** The `strategies` row (created as
"Golden Ratio", since renamed by the founder to "Umbra"; `supported_exchanges = {MT5}`) and the
`api_keys` row share an **identical microsecond timestamp**, `19:02:40.164344+00` — one transaction,
which is `create_wizard_strategy` creating both atomically. A client-side two-step could not produce
that, and a count at that exact timestamp returns exactly 1 strategy, so the match is not a
collision.
**Verdict:** PASS

---

### 4. Composite connect — real browser, PROD
**Falsifier:** the first member succeeds and a later one fails — the twin diverged. That is exactly
the defect class Phase 153.6 exists because of, and row 3 cannot detect it.

**Observed:** Founder built a **2-member Deribit composite** on PROD. Strategy "Jade Serpent"
(`supported_exchanges = {deribit}`) and its **first** member key share the identical microsecond
timestamp `19:28:27.579764+00` — one transaction, `create_wizard_strategy`. The **second** member key
was minted at `19:29:18.397491+00`, 51 seconds later, with **no new strategy row**, so it arrived via
the composite add-key path (`add_wizard_composite_key`) rather than the single-key twin. Final state:
`member_keys = 2`, both `deribit`, both `attested_venue = exchange`, both stamped.

⭐ The falsifier was "the first member succeeds and a later one fails". **The later member
succeeded.** The composite route reaching the `service_role` arm in production is now observed, not
inferred.

(Aside, and it confirms the pre-flight reasoning: two ccxt keys on the SAME venue coexisted without
tripping `api_keys_user_exchange_venue_account_uniq`, because ccxt keys carry
`venue_account_id IS NULL` and that index is PARTIAL on `WHERE venue_account_id IS NOT NULL`.)
**Verdict:** PASS

---

### 5. The minted rows
**Falsifier:** `attested_venue IS NULL` — the row went through a client INSERT path, so the wizard
did not use the RPC at all and everything above would be verifying nothing.

**Observed:** For the row minted in row 3: `exchange = mt5`, `attested_venue = mt5`,
`attested_venue = exchange` → **true**, `venue_account_id` non-NULL. The `venue_account_id` stamp is
written by `create_wizard_strategy`'s `NULLIF(btrim(...))` normalisation (WIZCONT-02) and by nothing
else — a second, independent witness that the RPC performed the write.

Both RPC bodies on PROD read: `has_service_role_arm = true`, `keeps_crossuser_guard = true`
(`v_auth_uid <> p_user_id` intact), `service_role` EXECUTE = true, `authenticated` EXECUTE = true
(**still granted, by design — this is landing 1 of 2**), `anon` EXECUTE = false.
**Verdict:** PASS

---

## Row 6 — OPTIONAL, NON-BLOCKING

### 6. MT5 path
**Observed:** ⭐ **PASSED, and it closed a separate open blocker.** MT5 validate had been failing at
the capability seam since the MT5DEAL-01 fix, because `[Experts] Enabled=0` made
`terminal_info().trade_allowed` false (MT5GW-COPY-01). The founder ticked *Allow algorithmic
trading* and unticked both auto-disable boxes; `trade_allowed` read **true** before the connect and
**still true after it**, proving the fix survives a `login()` — the `Account=1` re-disable loop is
broken. The connect obtained a `venue_account_id`, which requires a successful MT5 login.
**Verdict:** PASS (non-blocking)

---

## Gate

**Rows 1–5 must all read PASS before plan 07 authors Migration B.**

⭐ **Rows 1–5 all PASS. The gate is CLEARED.** Row 6 also passed as a bonus. Plan 07 may author
Migration B.

## What PR B may now assume

Both wizard RPCs' `service_role` arms are **exercised in production by our own code**, through both
routes: the single-key route (row 3) and the composite route including a non-first member (row 4).
Migration B's `REVOKE … FROM authenticated` therefore removes a path our own application provably no
longer takes. That is the claim the two-landing split was built to establish, and it is now evidence
rather than inference.

⛔ **What PR B may NOT assume: that nothing else still uses the `authenticated` arm.** Any other
client holding an `authenticated` JWT against these RPCs starts failing with `42501` the instant
Migration B applies — a browser tab sitting mid-wizard on the old bundle, or an unreleased Preview
deploy built before PR A. That breakage is the intended effect of the change, not a defect, but it
is also the reason **PR B must not be merged during an active wizard session window**.

⚠️ At the time this gate was recorded the founder was actively connecting keys on PROD. Merging PR B
in that window would 42501 their in-flight wizard. Hold the merge until the session is idle.

## Deviations

1. **Row 3 used MT5, not a ccxt venue** as the plan specified. Acceptable: both venues traverse the
   same `create-with-key` route and the same `create_wizard_strategy` RPC, which is what CONNECT-02/03
   put under test. It also carried a bonus — it cleared row 6 and the MT5GW-COPY-01 blocker.
2. **The wizard was left as a `draft`.** The strategy row reads `status: draft` with zero
   `compute_jobs` and zero `strategy_keys` links, because the founder stopped after the connect step.
   That does not weaken rows 3 or 5 — the RPC write under the service-role credential is the thing
   under test and it completed — but no sync has run, so this file makes **no claim** about MT5
   ingestion working end to end.
