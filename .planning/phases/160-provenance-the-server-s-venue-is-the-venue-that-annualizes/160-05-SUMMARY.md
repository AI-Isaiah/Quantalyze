---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
plan: 05
status: complete
completed: 2026-08-23
requirements: [RANK-03]
---

# Plan 160-05 Summary — withdraw client INSERT on `api_keys` (PR-2)

Landed as PR #704, merged `ae53d3cd`. The migration auto-applied to PROD via
`supabase-migrate.yml` and was verified against the live database afterwards.

## Task 1 — soak checkpoint (orchestrator)

PR-1 (#703, `1911a5d5`, v0.71.0.0) merged and its Vercel deployment
(`dpl_2TjqCXPdM4B85fn4wUHZLC9PxP52`) reached `READY` at **17:12:02 UTC** holding the
`quantalyze.xyz` and `quantalyze-rho.vercel.app` aliases with `aliasError: null`. Alias
binding was read from the deployment API rather than inferred from "newest production
deployment"; the live domain independently returned HTTP 200.

Soaked **47 minutes**, then re-measured. The addendum is committed in `160-CENSUS.md`.

⚠️ **The four prod smoke flows the plan called for were NOT performed.** Zero keys were
connected during the window, so the soak produced the *absence of un-attested inflow*, not
positive evidence that the persist arm works in production. Those are different claims and
the weaker one is what was measured. Recorded rather than presented as a successful
exercise; the next connect-a-key on PROD is the writer's first true exercise.

## Task 2 — the go/no-go gate (amended)

The plan's `gate="blocking-human"` was amended in-session (founder instruction) to
`gate="specialist-review"`: the decision was delegated to `migration-reviewer` and
`rls-policy-auditor`, with a reviewer BLOCKER counting as a NO-GO. Both initially BLOCKED.

## Task 3 — the migration

`supabase/migrations/20260823120000_revoke_api_keys_insert.sql`. One verb:
`REVOKE INSERT ON public.api_keys FROM anon, authenticated`. DELETE, the SELECT allowlist,
RLS policies, the scrub trigger and the coupling CHECK are all untouched.

**All eight reviewer findings fixed:**

| Sev | Finding | Fix |
| --- | --- | --- |
| HIGH | The guard aborted on a condition PR-1 *designs for* — a stale tab client-INSERTs during the soak and the trigger NULLs its attestation, so ONE such row would have aborted the PROD auto-apply of a security fix | Pin bounded by a **dated cutoff** (`c_census_cutoff`); only the censused pre-cutoff population is enforced, soak-window rows are reported |
| HIGH | The branch carried all of PR-1 *plus* the migration → both would land in one auto-applied commit, violating the file's own header; the census guard would then pass **vacuously** (0 un-attested only proves "no client writer remains" if the persist arm has actually been live) | Re-cut off the merged main; diff reduced to the migration + sibling test + docs |
| HIGH | "Safe to re-run" was **measured false** — the second apply aborted because both stale sentences were gone. Compounds with the explicit `COMMIT`: a failed `schema_migrations` write would wedge `db push --include-all` permanently | Correction guard now passes when either the stale sentence OR its replacement is present |
| MED | The appended sentence **never landed** — the guard was keyed on the migration filename, which the first `replace()` already injects, so it was dead code; post-verify 4d was blind to it | Keyed on its own sentinel + new post-verify **4e** asserts it arrived |
| MED | Fail-open: disconnect is a hard DELETE, so the mt5 signature decays monotonically; a PROD whose mt5 keys were all disconnected would print *"non-PROD apply"* **on PROD** and revoke anyway | Both branches require positive evidence (PROD census signature / e2e seed signature); an unidentified database **aborts** rather than guessing |
| MED | Post-verify never asserted `service_role` still holds INSERT — the one privilege the whole post-REVOKE design rests on | Added |
| MED | 5c trusted `42501` alone, but an RLS refusal raises 42501 too (measured both ways) | Matches the table-permission message AND cross-checks the ACL |
| MED | 5c's skip claimed assertions 2/3/5e still covered the scrub trigger — **false**: 2 and 3 are UPDATE-privilege assertions and 5e is the CHECK. None fires the trigger | Briefly re-grants INSERT inside the file's own `BEGIN/ROLLBACK` so the trigger stays under a real client-role INSERT in both states |

An earlier fix (pre-review) widened the PROD signature from two mt5 dates to all three,
after measuring that PROD carries 4 mt5 rows across 2026-08-04/13/21 — a signature resting
on two deletable rows could fail open.

**Verified on a live PostgreSQL 16 fixture, six scenarios:** PROD-shaped applies clean;
second apply is a clean no-op; a soak-window un-attested row is reported not fatal; a
pre-cutoff un-attested row still aborts with the ACL rolled back; an unidentified database
aborts; an e2e-shaped database takes the lenient branch. Both new post-verify assertions
were proven to fire by neutering what they guard.

## Task 4 — pre-REVOKE re-grep + the 5c landmine

Whole-repo write-surface re-grep at HEAD found **zero** browser-context `api_keys` INSERT
chains. The three remaining hits are all `service_role`: the new writer
(`validate-and-encrypt`, via `createAdminClient()`), and two e2e seed helpers using
`TEST_SUPABASE_SERVICE_ROLE_KEY`.

⛔ **The landmine plan 160-03 found and this plan fixed:** assertion 5c of
`test_api_keys_exchange_not_user_writable.sql` RAISES when a client INSERT is *refused*
("D-02/D-03 keep this path open on purpose"). Its gating marker was confirmed present on
the TEST DB, so it was armed — it would have hard-failed `sql-tests` on main the moment
INSERT was withdrawn. Made state-adaptive on the `revoke_api_keys_insert` marker, in the
same commit as the migration.

The legacy-arm retirement (`STALE_CLIENT`) the plan sketched was **not** performed — the
legacy ciphertext arm remains in `validate-and-encrypt`. It is now unreachable as a
row-creating path (the browser holds no INSERT), so it is dead weight rather than a hole.
Booked below.

## Post-apply verification on PROD

Nine assertions measured directly against `khslejtfbuezsmvmtsdn`, not inferred from the
workflow's exit code: `authenticated`/`anon` INSERT **false**; `service_role` INSERT
**true**; `authenticated` DELETE **true**; column SELECT on `id`/`exchange` **true**;
marker, appended sentence and the older `20260810120000` marker all present; the stale
OQ-2 sentence gone. Data unchanged: 31 rows, 0 un-attested, 31/31 coherent.

## Carried forward

- Retire the now-unreachable legacy ciphertext arm in `validate-and-encrypt` (dead path,
  not a hole).
- The four prod smoke flows remain unperformed; the writer's first real exercise is the
  next connect-a-key on PROD.
