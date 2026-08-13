---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 06
artifact: live-acceptance
status: blocked
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

⭐ **The write is provably the RPC's, not a client INSERT.** The `strategies` row ("Golden Ratio",
`supported_exchanges = {mt5}`) and the `api_keys` row share an **identical microsecond timestamp**,
`19:02:40.164344+00` — one transaction, which is `create_wizard_strategy` creating both atomically.
A client-side two-step could not produce that.
**Verdict:** PASS

---

### 4. Composite connect — real browser, PROD
**Falsifier:** the first member succeeds and a later one fails — the twin diverged. That is exactly
the defect class Phase 153.6 exists because of, and row 3 cannot detect it.

**Observed:** ⛔ **NOT PERFORMED.** The founder holds a single exchange key, and a composite needs
≥2 members. What IS proven for the composite twin: its `service_role` arm exists on PROD and keeps
the cross-user guard (row 5's query covers both functions); Migration A's Part 3d behaviourally
proved the arm works on **both** RPCs against TEST; and the CONNECT-02b guard proves the composite
route binds its receiver from `createAdminClient()`. What is **NOT** proven: the composite *route*,
in production, reaching that arm with a service-role client.
**Verdict:** ⛔ NOT VERIFIED — this is the sole open gate item.

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

**Rows 1, 2, 3, 5 PASS. Row 4 is NOT VERIFIED. The gate is therefore NOT cleared and
`status: blocked` stands — Migration B is not authored.**

Migration B withdraws `authenticated` EXECUTE from **both** RPCs. Landing it while the composite
route is unexercised in production would convert a state that is *working but open* into one that is
*broken and closed* for composite connects, and no test in the suite would fail.

**To clear row 4:** exchange keys carry `venue_account_id IS NULL`, and the duplicate-account unique
index is PARTIAL (`WHERE venue_account_id IS NOT NULL`), so **two ccxt keys on the same exchange do
not collide**. A second read-only API key at the founder's existing venue is enough to build a
composite and close this row as designed.

## Deviations

1. **Row 3 used MT5, not a ccxt venue** as the plan specified. Acceptable: both venues traverse the
   same `create-with-key` route and the same `create_wizard_strategy` RPC, which is what CONNECT-02/03
   put under test. It also carried a bonus — it cleared row 6 and the MT5GW-COPY-01 blocker.
2. **The wizard was left as a `draft`.** The strategy row reads `status: draft` with zero
   `compute_jobs` and zero `strategy_keys` links, because the founder stopped after the connect step.
   That does not weaken rows 3 or 5 — the RPC write under the service-role credential is the thing
   under test and it completed — but no sync has run, so this file makes **no claim** about MT5
   ingestion working end to end.
