---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 06
artifact: live-acceptance
status: pending
verified_on:
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
took the arm we believe it took. Only a real browser against real PROD can. A 40-minute browser pass
has beaten 10,193 tests in this repo before.

⛔ Record values and booleans only. `.planning/` is **tracked** and this repo is **public** — no key
ids, no user ids, no connection strings, no PROD census beyond the two rows under test.

---

## Rows 1–5 — GATING

### 1. Deploy state
The Vercel **Production** deploy's commit SHA equals PR A's merge commit, and the `Supabase Migrate`
job is green for Migration A (`20260813150106_wizard_rpcs_service_role_writer.sql`).

**Falsifier:** a Production deploy whose SHA is older than the merge commit — the routes calling
`createAdminClient()` are then not the code actually serving traffic, and every row below would be
testing the previous deploy.

⚠️ A **grey** `sql-tests` is not a pass. That job shares the `shared-test-db` concurrency group with
`python` and `e2e-seeded`; a cancelled job renders grey, and branch protection is deferred on this
repo, so nothing stops a grey from merging. Re-run it rather than reading grey as green.

**Observed:**
**Verdict:**

---

### 2. Env precondition
`SUPABASE_SERVICE_ROLE_KEY` is present in Vercel **Production** *and* **Preview**.

**Falsifier:** absent in Preview. Production would look fine while every preview deployment's wizard
is hard-broken, and nothing in CI would say so. Before PR A, only *submit* depended on this variable;
after PR A, **connect-a-key** does too (T-156-20).

**Observed:** MEASURED PRE-MERGE 2026-08-13 via `vercel env ls` — present and Encrypted in **both**
`Production` and `Preview`, each created 126d ago. This row's precondition therefore held *before*
the merge, which is why merging PR A was judged not to risk a connect outage.
**Verdict:** PASS (pre-merge measurement; re-confirm nothing changed it post-deploy)

---

### 3. Single-key connect — real browser, PROD
As `qa-demo@quantalyze.app` on `quantalyze.xyz`, complete a connect through the wizard's
**single-key** path for a ccxt venue, end to end.

⚠️ Headless `browse` cannot hydrate an authed React surface — use a real browser or CDP.

**Falsifier (two distinct shapes, and they mean different things):**
- A `SEAM_MISCONFIGURED` 503 — on screen: *"We could not send this request — our own configuration
  is wrong."* with **no Retry control**. Means the service key never reached the route.
- A `42501`-shaped / insufficient-privilege failure. Means `GRANT … TO service_role` did not land on
  PROD, i.e. Migration A applied partially or not at all.

**Observed:**
**Verdict:**

---

### 4. Composite connect — real browser, PROD
Complete a **composite** connect with at least two member keys.

**Falsifier:** the first member succeeds and a later one fails. The composite route is a deliberate
shape-identical twin of the single-key one; a divergence between them is exactly the defect class
this phase exists to close, and it would not show up in row 3.

**Observed:**
**Verdict:**

---

### 5. The minted rows
For the keys created in rows 3–4, `attested_venue` is non-NULL and equals `exchange`.

**Falsifier:** `attested_venue IS NULL`. The stamp is written *by the RPC*. A NULL means the row was
created through a client-side INSERT path instead — the wizard did not use the RPC at all, and every
row above would be verifying nothing.

**Observed:**
**Verdict:**

---

## Row 6 — OPTIONAL, NON-BLOCKING

### 6. MT5 path
Best-effort only, **if** a working MT5 credential is available.

⚠️ All three PROD MT5 keys currently sit at `sync_status='error'` from a pre-existing defect
(`MT5GW-COPY-01` — the gateway terminal's `[Experts] Enabled=0`, an operator-side condition unrelated
to this phase). **An MT5 failure here is attributable to that defect and is NOT a Phase 156 finding.**
Do not block PR B on this row.

**Observed:**
**Verdict:**

---

## Gate

**Rows 1–5 must all read PASS before plan 07 authors Migration B.**

A FAIL on any of rows 1–5 **stops the phase** and returns to the orchestrator. Migration B withdraws
`authenticated`'s EXECUTE grant; merging it on top of a failed gate would convert a state that is
*working but open* into one that is *broken and closed* — strictly worse than either landing alone,
and the outage would hit the exact user action this phase set out to protect.
