# Phase 241: DEMOCREDS - Context

**Gathered:** 2026-11-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Closes `158-OPS-03` (HIGH), requirements SECR-01 and SECR-02. Two demo login pairs had their
passwords committed in plaintext to this PUBLIC repo. They are named by role only, never by value:
**Pair A** is the shared e2e login. **Pair B** is the `seed-full-app-demo` allocator.

The phase delivers three things:
- Pair B is deleted on TEST and on PROD.
- Pair A's leaked credential is dead: the founder resets its password himself. The account stays.
- Neither password literal remains in any tracked file. A digest guard over the whole tracked tree
  keeps them out, and it is shown RED by planting a literal in a byte copy.

History is not rewritten. No credential is rotated by an agent. No literal (login or password) is
ever quoted in a commit, CHANGELOG, PR body, TODOS entry or planning file.

The measured facts behind the rulings are in `241-PROD-MEASUREMENT.md`.

</domain>

<decisions>
## Implementation Decisions

### Deviation from ROADMAP SC-1 (founder ruling 2026-11-24, recorded per the deviation policy)
- ⛔ **SC-1 is NARROWED.** The ROADMAP says "Neither demo account exists on TEST or PROD." PROD
  measurement on 2026-11-24 disproved the premise that both accounts are unused. Pair A holds the
  admin role (1 admin would remain without it), owns 1 of PROD's 2 published strategies plus 18
  others, has an OKX key that syncs daily, and last signed in on 2026-09-24. Founder ruling,
  option (c): **KEEP Pair A.** The founder resets its password himself, and no agent touches
  credentials. With that, the leaked credential is dead and scrubbed from the tree, and the
  account stays. Pair B is deleted on both projects as SC-1 originally said. The same dated note
  goes into the ROADMAP Phase 241 entry. — **Reversibility:** one-way for Pair B (hard delete of
  an auth user and its cascade).
- SC-1's evidence is therefore: Pair B is absent on TEST and PROD (dated); Pair A's password reset
  is the founder's step, recorded with its date once he confirms it, never by an agent.

### Pair B deletion (founder ruling 2026-11-24)
- **TEST:** done 2026-11-24. One auth user was deleted by a scoped statement matched on the login
  hash. It had auth rows only (1 identity, 11 sessions) and no profile, so nothing else cascaded.
- **PROD:** one atomic SQL block with count assertions (RESEARCH § PROD delete), order-independent of cascade trigger order, then the auth user through the Supabase admin API as ruled. Scoped pre-deletes in this order: (1) Pair B's `allocator_holdings` rows,
  (2) Pair B's `api_keys` rows (their own cascades), (3) the auth user through the Supabase admin
  API. This is rehearsed on the local-stack lane first against a fixture with the same FK shape.
  ⛔ **STOP before any PROD write.** The exact statement list and expected counts go to the
  coordinator for the founder's go. — **Reversibility:** one-way.
- Guards on Pair B's path, checked against the baseline:
  - `api_keys_published_composite_delete_guard` fires only when a deleted key is a
    `strategy_keys` member of a published strategy. Pair B has 0 strategies and 0
    `strategy_keys` rows, so it does not fire.
  - `audit_log.user_id` is nullable and `ON DELETE SET NULL` by design (migration 123: "audit
    rows survive auth.users hard-delete"). `audit_log_retention_guard` is an AFTER DELETE
    statement guard (100k ceiling) and does not fire on SET NULL updates. About 3.7k audit rows
    keep their events with the subject set to NULL.
  - `allocator_holdings.api_key_id` is ON DELETE RESTRICT. This is why holdings are pre-deleted
    before the keys.
  - `match_decisions.decided_by` is NO ACTION with 2 Pair B rows. The plan must verify they are
    the same rows that cascade through `match_decisions.allocator_id`, or delete them explicitly.

### Literal removal and sequencing (founder ruling 2026-11-24)
- **Order:**
  1. A **records PR** scrubs the archived `.planning/` files that hold a password literal: 7
     distinct files (Pair A's password in 7, Pair B's in 1, overlapping in `158-REVIEW.md`; the
     "8" in the 2026-11-24 handback summed the two lists). It also scrubs the login literals,
     which reach 5 more archived files.
  2. The **code PR** adds the whole-tree digest guard and removes Pair A's login and password
     literals from `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts` (constants and
     docblock).
- Run a range-form gitleaks scan before each push. Never print a literal.
- The ship branch changes nothing under `.planning/`.

### Seed and drain coupling (founder ruling 2026-11-24: keep as proposed)
- `scripts/seed-full-app-demo.ts` keeps reading its allocator login from
  `DEMO_SEED_ALLOCATOR_EMAIL` / `DEMO_SEED_ALLOCATOR_PASSWORD`. No CI workflow reads either
  account. `scripts/drain-test-compute-backlog.ts` parses only the seed's fixed `API_KEY_IDS`,
  and none of them is a PROD key of either pair.
- Unchanged: the `observ12-fixtures-presence` byte pin, the `critical-regressions` seed block,
  the drain parse and `knip.json`. SC-3 is met by redirection to the environment variables,
  which has been in place since Phase 158, and the suites that read the seed run green without
  the accounts.

### Decided autonomously
- [Guard] Q: "What does the digest guard hash?" → Selected: "sha256 of each password literal. The scan slides over every tracked file's bytes and compares windows of the literal's length to the stored digest, so no literal is in the source" — a test-only change, cheap to rework.
- [Guard] Q: "What does the guard scan?" → Selected: "every file from git ls-files, binary files included (research measured binaries under 1% of bytes), the guard file itself included" — it covers .planning, CHANGELOG and TODOS; a future exclusion is a one-line change.
- [Guard] Q: "Where does the guard live?" → Selected: "scripts/check-demo-credential-digests.ts chained into npm run lint (vitest shards skip docs-only pushes), plus a vitest test importing it for named arms" — tooling only.
- [Ship] Q: "Delete the [158-OPS-03/SEC] TODOS entry at ship while the founder Pair A reset is pending?" → Selected: "yes; the reset is carried as a human_needed item in VERIFICATION" — the TODOS rule says the closing ship deletes it.
- [Guard] Q: "Does the guard also cover the two login literals?" → Selected: "yes, by digest, since removing the email literal from the e2e test is in scope" — logins are not secrets, but carrying them costs nothing.
- [Guard] Q: "How does the e2e absence test keep biting without its literal?" → Selected: "it keeps its env-sourcing and shape assertions; credential absence moves to the whole-tree digest guard, which covers match-queue.spec.ts too" — test-only.
- [Records] Q: "How are the literals in archived planning files replaced?" → Selected: "a role placeholder such as <pair-A-password: redacted 2026-11-24, Phase 241>" — text-only.
- [Ops] Q: "Where is the PROD delete rehearsed?" → Selected: "the local-stack lane (scripts/local-stack/run.sh), against a fixture user with the same FK shape" — leaves no residue on shared TEST.

### Claude's Discretion
- Guard file name and location under `src/__tests__/`. Whether the digest table is shared with a
  script.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts`: the current absence guard. It is
  literal-based, knows only Pair A, and scans one spec.
- The local-stack lane `scripts/local-stack/run.sh up` loads baseline.sql and replays newer migrations.

### Established Patterns
- `readFileSync` parity tests in `src/__tests__/` and `critical-regressions.test.ts`.
- PROOF-01: neuter, see RED with the named arm, restore from a byte backup (`cp` back, `cmp`), see GREEN.

### Integration Points
- `TODOS.md`: the `[158-OPS-03/SEC]` entry is deleted at ship and named in the CHANGELOG. The
  other `[158-OPS-03]` e2e-disposition entries are a different topic and stay.

</code_context>

<specifics>
## Specific Ideas

- Literal-bearing archived files: `.planning/milestones/v0.16.0.0-phases/11-*/11-PATTERNS.md`,
  `v0.17.0.0-phases/13-*/{13-01,13-02,13-04}-PLAN.md` (plus INTEGRATION.md for the login only),
  `v1.0.0-phases/15-*/{15-06-PLAN,15-VERIFICATION}.md`,
  `v1.20-phases/158-*/158-REVIEW.md` (both pairs). Pair B's login also appears in v0.15 `06-*`
  BUGS-FROM-QA/HANDOFF, v1.0 `16-VERIFICATION.md` and v1.20 `164.8-04-RESTORE.log`.

</specifics>

<deferred>
## Deferred Ideas

- Pair A's bare login local part (no domain) appears in 5 more archived planning files. The full-login digest cannot see it. A login is not a secret and it is outside CONTEXT scope, so it is left as is.

- `sanitize_user` deletes api_keys while `allocator_holdings.api_key_id` is RESTRICT, so it would
  likely fail for any allocator with holdings. Out of scope here. Book it if it is confirmed.

</deferred>
