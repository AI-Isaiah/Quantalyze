# Phase 164.8.1 — deferred items (out of scope for the plan that found them)

## From 164.8.1-03 (the seeder message and the hazard booking) — 2026-09-09

### 1. Shared TEST's cron can POST to the PRODUCTION analytics service — PRE-EXISTING

`system_settings.analytics_service_url` is seeded with the PROD Railway host
(`supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql:294-296`) and
that row feeds `public.match_engine_cron_tick()`, a `pg_net` tick. A TEST cron tick can therefore
reach PROD compute. ⛔ The host literal is deliberately NOT repeated here: this repo is PUBLIC,
this file is tracked, and the restore's log is world-readable. Cite the anchor.

**PRE-EXISTING, not introduced by this phase — measured, not assumed.** The restore drops only
`public` (`scripts/restore-test-from-baseline.sh:861` — `DROP SCHEMA public CASCADE;`), so TEST's
`cron.job` schedule is never touched; whatever TEST was doing before the restore, it still does.
The same migration seeded the same value on TEST when it applied.

⛔ **Not fixed here, by founder decision (2026-09-09, `164.8.1-CONTEXT.md` `<specifics>`, locked
decision L-03): Phase 164.8.1 replays the statement FAITHFULLY.** Omitting it would leave TEST
missing a setting its own ledger claims applied — a second lie on top of the one this phase
exists to remove. And ⛔ it must NOT be closed by editing
`scripts/restore-test-refdata-allowlist.txt`: a restore that silently normalises the hazard is
the exact failure class this line of work removes. The remedy is a TEST-SIDE VALUE — the
migration's own CHECK admits `http://127.0.0.1:9` as a deliberate sink
(`supabase/schema/baseline.sql:10881`; its `COMMENT ON CONSTRAINT` at `:10892` states the intent),
and any `*.up.railway.app` host, so a TEST-scoped Railway service qualifies too — applied by a
founder-run statement or by a migration guarded on the `pg_database` identity marker.

**Destination: Phase 164.9 TESTISOLATION**, the ROADMAP's declared home for hardening deferrals
that depend on 164.8's restore (`.planning/ROADMAP.md`, Phase 164.9, `ROUTED HERE 2026-09-09`).
Booked as `[164.8.1-TEST-ANALYTICS-URL-PROD]` in `TODOS.md`.

⚠️ **Two traps for whoever takes it, both learned the expensive way.**
1. **`pg_net` is ASYNC.** A green `cron.job_run_details` row proves the tick FIRED, never what
   the far end answered — seven days of 401s once hid behind exactly such a green row. Verify at
   the SERVICE, not at the cron row.
2. **The database marker answers a different question.** The `COMMENT ON DATABASE` check confirms
   which DATABASE you are connected to. It says nothing about which SERVICE the tick calls. Only
   the first of those two has a guard.

---

### 2. RESEARCH A1 / Pitfall 2 — the lane cannot prove hosted `BYPASSRLS`; Plan 04's preflight owes the measurement

This is **not** a deferral to another phase. It is a measurement this phase still owes, named here
so it is not lost between plans.

`supabase/schema/baseline.sql:9578` puts `FORCE ROW LEVEL SECURITY` on `compute_job_kinds` whose
only policy is SELECT (`:13012`), and the dump preamble sets `row_security = off`. Under those two
together, an INSERT by a role that RLS applies to raises rather than filters. The replay works
today only because the restoring role BYPASSES RLS — hosted Supabase's `postgres` is
`rolbypassrls = TRUE` (`[CITED: supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql:375]`,
a code COMMENT, not a probe), and the pg-lane runs as a superuser.

⛔ **So neither the lane nor the self-test can prove this about hosted TEST** — a green lane arm
here is evidence about the lane's superuser, not about TEST's `postgres`. RESEARCH grades the
assumption MEDIUM: "comment-cited, not probed". `164.8.1-01-SUMMARY.md` records the same limit
in the allowlist masthead's three stated limitations.

**Who owes it:** Plan 04's first real run is `--mode preflight`, which exercises the full
transaction against TEST and is the only thing that measures this. If the assumption is false the
replay errors on TEST alone and the transaction rolls back — safe, and loud, which is why it was
accepted as a preflight-time measurement rather than a blocker.

---

### 3. `CHANGELOG.md:8241` repeats the same false inference — deliberately left

The 2026-era changelog entry that shipped the `crypto-sma` lookup ends: *"throws loudly if the row
is missing (the initial-schema migration `20260405061911_initial_schema.sql` seeds it, so absence
indicates the migration didn't run)"* — the same claim this plan removed from the runtime string.

⛔ **Not fixed here, and the reason is not scope.** `CHANGELOG.md` is a DATED record of what
shipped and what was believed at the time. Editing it to match today's measurement would falsify
history and destroy the evidence that the inference was once held. The correction belongs where a
reader acts on it — the runtime error, now fixed, and `.planning/ROADMAP.md:1465`, which already
carries a ⚠️ marking the quoted CI line's inference FALSE.

---

### 4. `scripts/seed-demo-data.ts` does not satisfy `prettier --check` — PRE-EXISTING, and prettier gates nothing

`npx prettier --check scripts/seed-demo-data.ts` exits 1. Measured at `HEAD` **before** this plan's
edit (via `git show HEAD:scripts/seed-demo-data.ts | npx prettier --check --stdin-filepath …`,
exit 1), so it is pre-existing. Every delta is in unrelated code — a hex literal's case at `:82`,
and six expression-wrapping choices between `:95` and `:641`. **None is in the region this plan
touched.**

⛔ **Not fixed here.** Reformatting a 1000-line file to close a warning nothing enforces is exactly
the adjacent "improvement" that hides which line actually moved in a review. And it is unenforced:
`grep -rn prettier .github/workflows/*.yml package.json` finds no `--check` step and no format
script, so there is no gate to go green. If prettier should gate this repo, that is its own
decision with its own PR, not a side effect of a four-line error-message fix.

---

### 5. Five refusal BRANCHES in `restore-test-from-baseline.sh` have no arm — PRE-EXISTING, overclaim retracted, arming deferred

Found while discharging W2 (Plan 02). The self-test's closing line claimed *"every branch of every
one of them is armed"*. Measured 2026-09-09, it was **already false before this phase** — the arms
cover one exit per refusal, not every exit:

| Refusal | Unarmed `fail` branch |
|---|---|
| `refuse_absent_credential` | `psql` is not on PATH |
| `refuse_wrong_baseline_sha` | the baseline dump is not found |
| `refuse_wrong_baseline_sha` | the provenance doc is not found |
| `refuse_wrong_baseline_sha` | the doc carries no parseable `sha256` row |
| `refuse_stale_baseline` | `FRESHNESS_TS_CMD` printed no epoch (either side) |

**Fixed here:** the false SENTENCE. The line now claims only that each refusal is armed by a
named-message arm, which is true and checkable, and the comment above it carries the
`refuse_wrong_baseline_sha` counter-example so the stronger claim is not re-introduced. Plan 02's
own refusal 8 has all three of its reason branches armed (arm 24 legs a/b/c).

⛔ **Arming the five is NOT done here, and the reason is scope, not difficulty.** They are cheap
(all filesystem, no lane) but each is a new arm, and every new arm moves `EXPECTED_ARMS` and the
eleven vitest literals that read it. Plan 02 already moves that ratchet 21 → 24 in one commit
because CI is red between a ratchet and its pins; folding five more arms into the same commit would
mean landing ten unreviewed arms behind a plan whose subject is reference data.

**Destination — needs a founder/orchestrator call, and this file is not a queue.** Per the
"every deferral must name a PHASE" rule the options are (a) fold into **Phase 164.9 TESTISOLATION**,
which already owns work in this script's neighbourhood, or (b) a small dedicated phase via
`/gsd-phase --edit`. Recommendation: **(a)**, because 164.9 will be reading this harness anyway and
five filesystem-only arms are a natural rider rather than a phase of their own.

⚠️ **Until then the retraction is the mitigation.** The gate does not overstate itself, so nobody
reads "every branch is armed" and skips checking. That is the difference between a known gap and a
false claim.
