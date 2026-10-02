---
phase: 156-connect-refactor-the-venue-the-server-validated-is-the-venue
plan: 08
subsystem: testing
tags: [postgres, plpgsql, rls, acl, pg_default_acl, security-definer, postgrest, sql-tests]

requires:
  - phase: 156-07
    provides: "Migration B (20260814120000) — REVOKE authenticated EXECUTE on both wizard RPCs, service_role-only in-body gate, attested_venue comment re-stamped with the new marker"
  - phase: 153.6
    provides: "the 5a-5e block, the column-comment gate idiom, and the instance-not-class framing this plan's 5f/5g exist to close"
provides:
  - "5d inverted: the RPC door is asserted SHUT (privilege polarity both ways, SQLSTATE 42501, zero row delta)"
  - "5d+ / 5g anti-vacuity positives: the same calls service-role-shaped must SUCCEED and store attested_venue = exchange"
  - "5f/5g — the first assertions anywhere in the repo against add_wizard_composite_key's RPC door"
  - "5h — six ACL assertions across both signatures and three roles, armed from pg_get_functiondef, in the sql-tests lane on every PR"
  - "(5a'), (5a\"), (5h'), (5a''') — four marker-durability cross-checks from two independent sources"
affects: [156-09, 156-10, any future migration that DROPs and re-CREATEs either wizard RPC]

tech-stack:
  added: []
  patterns:
    - "Body-armed CI gate: arm an assertion from pg_get_functiondef (comment-stripped), never from a comment marker, when the thing it distrusts can silently rewrite comments"
    - "Reachability analysis on guard ordering: an assertion whose premise is entailed by an earlier guard's premise is dead code and must be reordered, not shipped"
    - "Purpose-built PG16 fixture re-based verbatim on the load-bearing migration fragments, validated by running the UNMODIFIED gate against it first"

key-files:
  created: []
  modified:
    - supabase/tests/test_api_keys_exchange_not_user_writable.sql

key-decisions:
  - "5h is armed from a COMMENT-STRIPPED pg_get_functiondef. Measured: on a fixture carrying Migration B the RAW definition still contains auth.uid() (inside Migration B's own Trap B comment), so a naive raw match would leave 5h permanently un-armed and silently green — this file's signature failure, committed by its own remedy."
  - "(5h') was moved AHEAD of 5h. As the plan specified it (after 5h) it is provably dead code: reaching it requires `authenticated` both to hold and not to hold EXECUTE on create_wizard_strategy."
  - "5f/5g were placed BEFORE 5e so a single contiguous `IF v_revoke_live` gate covers all four RPC-door assertions; 5e is byte-identical and unmoved relative to the ELSE."
  - "(5a') and (5a\") live OUTSIDE `IF v_attest_live`, because inside it (5a') is unreachable and (5a\") could not fire in the arm it guards."
  - "The file header was rewritten: it still described 5d as asserting the call SUCCEEDS, the opposite of what the file now asserts."

patterns-established:
  - "Two-sources discipline: every marker-gated assertion is cross-checked against live catalog state (has_function_privilege / pg_get_functiondef), so no assertion can be disarmed by editing prose alone"
  - "Anti-vacuity pairing: every negative privilege assertion is paired with a positive that reds if the function merely vanished, worded as an OUTAGE"

requirements-completed: [CONNECT-01, CONNECT-04]

duration: ~95min
completed: 2026-08-13
---

# Phase 156 Plan 08: Invert the RPC Door and Make the REVOKE Stay Revoked — Summary

**`test_api_keys_exchange_not_user_writable.sql` now asserts both wizard RPC doors are SHUT for the right reason with nothing minted, each negative paired with a privileged positive, and adds 5h — six ACL assertions armed from the function body rather than a comment marker, so a future `DROP`+`CREATE` that lets `pg_default_acl` re-grant `anon`/`authenticated` reds `sql-tests` on every PR instead of reopening CONNECT-01 in silence.**

## Performance

- **Duration:** ~95 min
- **Tasks:** 3 of 3
- **Files modified:** 1 (`supabase/tests/test_api_keys_exchange_not_user_writable.sql`, 424 → 838 lines)
- **Commits:** 4

| Commit | Task | Content |
|---|---|---|
| `517b3ea0` | 1 | invert 5d, add 5d+, mint 5f/5g |
| `2c3fad9c` | 2 | `v_revoke_live` gate, (5a′), (5a″), two distinguishable SKIP notices |
| `bab2655c` | 3 | 5h, (5h′), (5a‴), header rewrite |
| `47dc0d45` | — | SKIP (5) notice names 5a-5h |

## Evidence — read this before reading the claims

### What was actually run

⭐ **Everything below was EXECUTED against a real PostgreSQL 16.13 database, not reasoned about.** The plan's evidence bar was relaxed to "code-level only" on the premise that no database carries Migration B. That premise was avoidable: Migration B is a file, and a local fixture can carry it. I built one.

⛔ **What was NOT run: nothing was applied to TEST or PROD.** No `supabase db push`, no MCP, no migration applied to any shared database. `sql-tests` in CI has **not** been observed green for this change, because TEST does not carry Migration B and applying it there before plans 08/09 land would red `sql-tests` on every open PR. The phase-level verification line *"`sql-tests` observed green (not grey) in CI against TEST"* is **NOT DISCHARGED** by this plan and must be discharged after PR B applies Migration B to TEST.

### The fixture, and why it is trustworthy

A throwaway PG16 cluster (`initdb`, loopback TCP on `127.0.0.1:54329` — the scratchpad path exceeds the 103-byte `sun_path` limit). `156-03-SUMMARY.md` already recorded that replaying all 243 migrations into a bare `initdb` is not a one-liner, so the fixture is purpose-built and re-based **verbatim** on the load-bearing fragments:

| Fixture object | Re-based from |
|---|---|
| `scrub_client_supplied_attested_venue` + trigger | `20260811210000:491-548` |
| `prevent_api_key_venue_change` + trigger | `20260810120000:107-135` |
| `api_keys_attested_venue_matches_exchange` | `20260811210000:293-295` |
| both wizard RPCs, Migration A shape | `20260813150106:82-435` |
| both wizard RPCs, Migration B shape + §3 grants + §4 comment | `20260814120000`, applied **in full, unmodified** |
| `ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role` | `156-MEASUREMENTS.md` § A4 |

**Three independent fidelity checks, all passed:**

1. The fixture's function ACL after Migration A reproduces the measured PROD/TEST ACL **exactly**:
   `postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres` — matching § A4 byte for byte, including the fact that no migration grants `service_role`.
2. The **UNMODIFIED** gate file (assertions 1 → 5e as they stood on `7fb0a05f`) runs **fully green, exit 0** against the Migration-A fixture. A fixture that could not run the existing gate would prove nothing about the new one.
3. Migration B's **own post-verify (a)–(h)** passes on the fixture when the migration is applied to it.

**Baseline, confirming the review's HIGH finding:** the unmodified gate against the Migration-B fixture reds exactly where predicted —

```
ERROR:  TEST FAILED (5d): create_wizard_strategy could not be called by the row
owner (42501 permission denied for function create_wizard_strategy). This is the
wizard's own connect path — a refusal here means connect-a-key is broken…
```

### Three database states, all exercised

| Fixture | State | psql exit | Assertions run | Skips |
|---|---|---|---|---|
| `fixb` | Migrations A + B (fully migrated) | **0** | **13** | **0** |
| `fixa` | Migration A only (the PR-A window) | **0** | 8 | 2 (`SKIP (5d/5f/5g)`, `SKIP (5h)`) |
| `fixold` | pre-`20260811210000` (no `attested_venue` column) | **0** | 4 | 1 (`SKIP (5)`) |

Full roll-call on `fixb`: `1, 2, 3, 4, 5a, 5b, 5c, 5d, 5d+, 5f, 5g, 5e, 5h`.

⭐ **5h SKIPS on `fixa` and is never inverted and never red** — exactly the behaviour the plan requires during PR A. The `fixold` run also proves the new pre-`IF` code (`v_revoke_live`, `v_revoke_landed`, (5a′), (5a″)) does not error on a database that lacks the column entirely.

### Falsifiability — 13 mutations applied, observed RED, and reverted

Every run under `set -o pipefail`; the psql exit code is read directly, never through a `tee` pipeline.

**Task 1**

| # | Mutation | Result |
|---|---|---|
| 1 | `GRANT EXECUTE ON … create_wizard_strategy(12 args) TO authenticated` | exit 3 — **5d** reds naming the privilege |
| 2 | `GRANT EXECUTE ON … add_wizard_composite_key(11 args) TO authenticated` (create left correct) | exit 3 — **5f** reds **independently**, after 5d/5d+/5e all report OK |
| 3 | neuter the 5d+ positive (service_role claim → authenticated claim) | exit 3 — **5d+** reds, **5d's negative stayed green** |
| 4 | `ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_attested_venue_matches_exchange` | exit 3 — **5e** reds on its `v_ins_err IS NULL` arm, naming the missing CHECK, with 5b/5c/5d/5d+ green |

Mutation 3 is worth reading twice: the refusal message was `42501 create_wizard_strategy: caller role (authenticated) may not write wizard drafts` — the **in-body gate**, not the GRANT layer, because `RESET ROLE` leaves the harness holding EXECUTE by **ownership**. That is the orchestrator's point about owner-role callers, observed rather than asserted.

**Task 2**

| # | Mutation | Result |
|---|---|---|
| 5 | strip `20260811210000` from the `attested_venue` comment, leave `20260814120000` | exit 3 — **(5a′)** reds |
| 6 | strip **only** `20260814120000`; the door stays correctly shut | exit 3 — **(5a″)** reds |

**Task 3**

| # | Mutation | Result |
|---|---|---|
| 7 | `GRANT EXECUTE … create_wizard_strategy TO authenticated` | exit 3 (5d intercepts — see *Ordering*) |
| 8 | `GRANT EXECUTE … add_wizard_composite_key TO authenticated` | exit 3 (5f intercepts) |
| 9 | `GRANT EXECUTE … add_wizard_composite_key TO anon` | exit 3 — **5h** reds; 5b/5c/5e all green first |
| 10 | `GRANT EXECUTE … create_wizard_strategy TO anon` | exit 3 — **5h** reds; 7 assertions green first |
| 11 | `REVOKE EXECUTE … create_wizard_strategy FROM service_role` | exit 3 (5d's outage arm intercepts) |
| 12 | marker stripped **and** `authenticated` re-granted | exit 3 — **(5h′)** reds |
| 13 | **both** markers stripped **and** `authenticated` re-granted | exit 3 — **(5a‴)** reds |

⭐ **The real defect shape, reproduced rather than simulated.** On a clone of the Migration-B fixture I ran an actual `DROP FUNCTION create_wizard_strategy(…)` followed by a re-`CREATE` of Migration B's own §1 body with **no grant statements** — i.e. exactly what a future migration that forgets the standing rule would do. Measured ACL afterwards:

```
create_wizard_strategy   -> =X/postgres postgres=X/postgres anon=X/postgres
                            authenticated=X/postgres service_role=X/postgres
add_wizard_composite_key -> postgres=X/postgres service_role=X/postgres   (untouched)
```

`pg_default_acl` re-granted **`anon` AND `authenticated`**, silently, with nothing in the migration diff to read. Two runs on that database:

- **marker intact** → CI reds at 5d.
- **marker also dropped by a later re-stamp** → 5b, 5c and 5e report OK, `SKIP (5d/5f/5g)` is emitted, and **5h is the only thing that reds**:

```
ERROR:  CONNECT-01 REGRESSION (5h): authenticated holds EXECUTE on
create_wizard_strategy. MECHANISM: Supabase pg_default_acl for public functions
granted by role postgres is postgres=X anon=X authenticated=X service_role=X, so
a DROP + CREATE of a public function owned by postgres SILENTLY RE-GRANTS anon
and authenticated … (it bit 20260812083206, whose post-verify at :867 exists for
that reason). REMEDY: … REVOKE ALL ON FUNCTION … FROM PUBLIC, anon,
authenticated; and GRANT EXECUTE ON FUNCTION … TO service_role;
```

That is the whole justification for Task 3, executed end to end.

⚠️ Mutations 7, 8 and 11 are each intercepted by 5d/5f before 5h is reached, because 5d/5f assert the same privilege earlier. CI is red either way and the message is equally specific, but the honest statement is: **5h's `authenticated` and `service_role` arms are redundant with 5d/5f while the marker is intact; 5h's uniquely-reachable contribution is the two `anon` arms (mutations 9, 10) and its independence from the marker (mutation 12's neighbourhood).** That redundancy is deliberate — 5d/5f are marker-gated and 5h is body-gated, so removing the marker leaves 5h/(5h′) as the only live guards.

**Protected regions, verified programmatically** against `git show 7fb0a05f:` — assertions 1-4 (`:139-231`), 5b (`:267-281`), 5c (`:283-327`) and 5e (`:389-418`) are each **present byte-identical** in the final file. Every `SET LOCAL ROLE` (7) is bracketed by a `RESET ROLE`; every role-shaped call is followed by `set_config('request.jwt.claims', NULL, true)` (4 claim-setting calls, 4 resets). No `RAISE` format string is `||`-concatenated.

## Deviations

### [Rule 1 — Bug] (5h′) as specified is dead code; reordered ahead of 5h

- **Found during:** Task 3 falsifiability, when no mutation could make (5h′) fire.
- **Issue:** The plan places (5h′) after 5h. Reaching it requires (5a″) to stay silent — which requires `authenticated` to **hold** EXECUTE on `create_wizard_strategy` — **and** 5h to stay silent, which (5h being armed) requires `authenticated` **not** to hold it. Contradiction. Shipping a provably unreachable assertion inside the phase whose entire subject is decorative controls (`_assert_owner`, Trap B) would have been the worst possible thing to land.
- **Fix:** Moved (5h′) immediately **before** the 5h block and extended its message to tell the operator that 5h has not run either, so the ACL on both signatures must be re-checked after restoring the marker. Reachability then demonstrated by mutation 12.
- **Commit:** `bab2655c`

### [Rule 1 — Bug] The arming condition needs the comment strip, and the plan did not say so

- **Issue:** Task 3 specifies arming on "`pg_get_functiondef` … does NOT contain `auth.uid()`". **Measured on the fixture:** the RAW definition of Migration B's body **does** contain `auth.uid()` — `pg_get_functiondef` reconstructs from `prosrc`, which stores comments verbatim, and Migration B's Trap B comment explains at length why `auth.uid()` must be absent. A literal reading of the plan yields `v_revoke_landed = false` on exactly the database 5h exists to guard: **permanently un-armed, silently green.**
- **Fix:** `regexp_replace(def, '--[^\n]*', '', 'g')` before the test — the same strip and the same reason as `20260814120000`'s post-verify. Documented inline as measured.
- **Commit:** `bab2655c`

### [Rule 1 — Bug] The file header stated the opposite of what the file asserts

- **Issue:** `:50-61` said *"5d calls it as the row's own owner … and asserts the outcome that is actually true: the call SUCCEEDS"*. After inversion that is false, and a reviewer reading the header would conclude the file green-lights the vulnerability.
- **Fix:** Rewrote that paragraph to cover 5d/5d+/5f/5g/5e/5h, flag the polarity flip explicitly, and restate the honest ceiling. Not a protected region.
- **Commit:** `bab2655c`

### [Structural] 5f/5g placed before 5e, and (5a′)/(5a″) outside `IF v_attest_live`

- **Rationale:** one contiguous `IF v_revoke_live` gate covers all four RPC-door assertions instead of two blocks emitting two skip notices. 5e is byte-identical and unmoved relative to the `ELSE`. (5a′) **must** sit outside `IF v_attest_live` — inside it, `v_attest_live` is true by construction and the check is unreachable; the plan's own acceptance criterion ("reds when `v_revoke_live` is true and `v_attest_live` is false") requires the outside placement.
- **Commit:** `2c3fad9c`

### [Additive] Explicit `to_regprocedure` existence guard on the composite twin inside 5h

- `has_function_privilege` on a text signature **errors** if the function is gone. 5h's arming only proves `create_wizard_strategy` exists. Added a named check so "the composite twin vanished" reads as itself rather than as a parse failure.
- **Commit:** `bab2655c`

### [Process] A commit briefly swept in plan 09's concurrently-staged work

- `git commit` without a pathspec committed the whole index, which the concurrent plan-09 agent had staged between my commits. Corrected with `git reset --soft HEAD~1` followed by `git commit … -- <my file>`; **plan 09's five files are preserved untouched and still staged**, exactly as found. No content of theirs was modified, and none of it is in my history. Subsequent commits use an explicit pathspec.

## Not done / carried forward

- ⛔ **`sql-tests` has NOT been observed green in CI.** TEST does not carry Migration B, deliberately. This must be observed after PR B applies it — a **grey** `sql-tests` (cancelled by the `shared-test-db` concurrency group) is **not** a pass (Pitfall 9).
- ⛔ **The fixture is not TEST.** It reproduces the surface this file touches, validated three ways, but it is not a full replay of 243 migrations. A divergence between fixture and TEST would be invisible to this evidence.
- `.planning/STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` were **not** updated — the orchestrator fenced them off for the phase owner.
- 5h's `authenticated`/`service_role` arms are shadowed by 5d/5f while the `20260814120000` marker is present (see the ⚠️ above). Deliberate redundancy, recorded so nobody later reads their non-firing as evidence they are inert.

## Known Stubs

None.

## Threat Flags

None. This plan adds assertions only; it introduces no endpoint, auth path, file access or schema change.

## Self-Check: PASSED

- `supabase/tests/test_api_keys_exchange_not_user_writable.sql` — FOUND
- `.planning/phases/156-…/156-08-SUMMARY.md` — FOUND
- Commits `517b3ea0`, `2c3fad9c`, `bab2655c`, `47dc0d45` — all FOUND in `git log`
- Protected regions (assertions 1-4, 5b, 5c, 5e) — verified byte-identical against `7fb0a05f`
