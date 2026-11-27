# Phase 242: SECRETSHYGIENE — the full history is scanned on a schedule, and the cron service key goes only to named hosts - Context

**Gathered:** 2026-11-26
**Status:** Ready for planning

Smart discuss ran inside a background phase agent, which cannot ask the founder. The brief from the coordinator said "the rest is your call, following the workflow specs, CLAUDE.md and the project memory rules". So the hard-to-reverse questions below were decided by the phase agent, each on its recommended answer. They are reported to the coordinator at handback, and the founder can override any of them before execution.

<domain>
## Phase Boundary

Two deliverables, SECR-03 and SECR-04:

1. **Full-history scan (SECR-03).** A scheduled GitHub workflow runs gitleaks 8.30.1 over the full history of `main` and is green on its first run. The historical findings are suppressed without re-publishing any credential-shaped literal.
2. **Cron destinations (SECR-04).** Every database function that posts the Vault `analytics_service_key` sends it only to an exact named origin, never through the `.up.railway.app` suffix wildcard. The `[167.1.2.2.2-CRON-TICK-RESIDUALS]` gate-arm gap (item 2) and tab-key guard gap (item 3) are closed in the same migration. This is the first S5 migration of v1.23, and Phase 246 ALERTREADERS re-bases on its bodies.

Out of scope: rotating any key, rewriting git history, a new alert channel, and the `workflow_dispatch` re-trigger defect in CI's own secret-scan job (WINDOWS.md entry 61 half (b)).

</domain>

<decisions>
## Implementation Decisions

### Full-history scan
- Historical findings are suppressed with commit-scoped fingerprints in a repo-root `.gitleaksignore` (`<commit>:<file>:<rule>:<line>`), one line per finding, each grouped under a comment naming why the literal is a fixture. Never a committed `--baseline-path` report, and no path or regex widening of `.gitleaks.toml` for these. — **Reversibility:** costly — the file becomes the suppression contract every later full-history and PR-range scan reads, and moving to another method means re-auditing every fingerprint. Rationale: history cannot be rewritten, so making a literal "obviously fake" in today's tree does not remove it from the history the scan walks; a fingerprint carries no literal; and it is pinned to one commit, so a real credential committed later at the same path still fires.
- The scan covers the history of `main` (the checked-out default branch, `--log-opts` set to its HEAD), not every ref. — **Reversibility:** costly — it sets what "full history" means for the gate. Rationale: PR branches are already scanned by CI's PR-range scan, other branches come and go, and an all-refs scan makes the result depend on which branches exist that day. Measured 2026-11-26 at origin/main `45d7b4e5c` with gitleaks 8.30.1 and `.gitleaks.toml`: main's history gives **31 findings**; all local refs give 49. Every one of the 31 read locally as a test fixture, a canary or a false positive (`match_key',\n ignore_duplicates=True`); none is a live credential. The planner re-measures at plan time and suppresses whatever the scan reports then.
- A red scheduled scan fails its workflow (fail loud) and files or comments on one open issue with a fixed label, like `sql-mutation-nightly.yml` does. It is accepted that a red run attaches a failing check to main's head SHA and can block a Railway redeploy of that SHA, the coupling the founder accepted for the nightly in Phase 164.9.6 D-11. — **Reversibility:** costly — it couples the scan to the deploy path. Rationale: a red full-history scan means a credential may be public, and a human must look before anything else moves; the next merge carries a new SHA, so the block is narrow.

### Cron destinations
- The allowed destinations are an exact set of two origins, compared by equality, never by a pattern: `https://quantalyze-analytics-production.up.railway.app` (PROD's stored `analytics_service_url`, read 2026-11-26) and `http://127.0.0.1:9` (the loopback discard literal the gates use, and TEST's stored value, read 2026-11-26). — **Reversibility:** one-way — it is enforced by a migration on PROD; moving the analytics service to another host now needs a forward migration first, which is the intended cost.
- One migration narrows all of it: the `system_settings_analytics_service_url_allowed` CHECK constraint and the in-body re-test of all four functions that post the key (`cron_sync_tick`, `ops_staleness_check`, `match_engine_cron_tick`, `prod_prober_cadence_check`). — **Reversibility:** one-way — four `CREATE OR REPLACE` bodies and a constraint change on PROD. Rationale: SECR-04 names two functions, but measured on PROD 2026-11-26 the same wildcard is in four function bodies and the CHECK, and the `[167.1.2.2.2-CRON-TICK-RESIDUALS]` close gate (1) requires the CHECK and every in-body re-test to accept one exact origin. Narrowing two and leaving `match_engine_cron_tick` and `prod_prober_cadence_check` on the wildcard would leave the same key leak open and two spellings of one rule (CLAUDE.md Rule 7). This widens the roadmap wording, not its success criteria.
- Every function re-bases on its latest definition across all migrations and the committed PROD baseline before `CREATE OR REPLACE` (project memory rule). PROD md5 of `pg_get_functiondef` read 2026-11-26, for the planner to re-check: `match_engine_cron_tick` f7e5c66f…, `prod_prober_cadence_check` a8aeaeba…, `cron_sync_tick` f59054f0…, `ops_staleness_check` 92288598…. `scripts/prod-prober/cron-manifest.json` moves with it if any registered command or body hash it carries changes.
- The blank-key guard refuses a key that is empty under all whitespace (spaces, tabs, newlines, carriage returns), by name, in every function that posts the key, with an arm observed RED under the old spaces-only `btrim` guard (residual item 3).
- Gate arm P1 of `supabase/tests/test_cron_sync_tick.sql` asserts the recorded `X-Service-Key` header equals the Vault secret, observed RED under a mutant body that posts a fixed string (residual item 2).
- Each new SQL arm carries a `RED-UNDER` twin, and every census a new arm or gate file moves is updated (`grep -a` them all). PROOF-01 applies: each gate goes RED on a neutered copy with its named arm first, is restored from a byte backup (`cp` back, `cmp`), goes GREEN, and is recorded verbatim in the plan SUMMARY.
- The migration timestamp sorts after the PROD ledger tip (`20261126180000` read 2026-11-26) and after any migration Phase 243 DBBACKSTOP lands first; it is re-checked against origin/main and the PROD ledger before every push. migration-reviewer and rls-policy-auditor must report no MEDIUM+ finding before merge.

### Decided autonomously
- [Full-history scan] Q: "How is gitleaks installed in the scheduled job?" → Selected: "The sha256-pinned 8.30.1 release binary, copying the install step `supabase-migrate.yml` already uses" — a workflow step, replaceable in one edit.
- [Full-history scan] Q: "How often does it run?" → Selected: "Daily on a cron schedule, plus workflow_dispatch" — a one-line cron edit; a main-only scan takes about a minute.
- [Full-history scan] Q: "What pins the workflow?" → Selected: "A vitest pin asserting the schedule, the binary pin, the main-only log-opts and that the report is never committed" — a test file, cheap to adjust.
- [Cron destinations] Q: "What does the refusal message say?" → Selected: "Keep each function's not-an-allowed-destination message and its rule of never echoing the stored value, but correct its 'Allowed:' tail so it names the two exact allowed origins instead of 'an https host under .up.railway.app', which the narrowing makes untrue" — message text inside a body that is replaced anyway. Revised 2026-11-27 after research open question 1.

### Claude's Discretion
- Whether the four functions and the CHECK share one helper (for example an IMMUTABLE `analytics_destination_allowed(text)`) or each inline the same two-value equality. The planner decides on the evidence, weighing one spelling of the rule against a new function and its grants.
- How WINDOWS.md entry 61 is updated: its half (c) (latent full-history findings) is answered by this phase; its half (b) (no working `workflow_dispatch` re-trigger for CI's secret-scan job) is out of scope and stays recorded.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.gitleaks.toml` (array-form `[[allowlists]]`, `useDefault = true`) and `src/__tests__/gitleaks-allowlist.test.ts`, which drives a real gitleaks scan.
- The sha256-pinned gitleaks install step in `.github/workflows/supabase-migrate.yml` ("Install gitleaks (sha256-pinned release binary)").
- `.github/workflows/sql-mutation-nightly.yml`: the scheduled-workflow pattern that fails red and files or comments on one labelled issue.
- SQL gates: `supabase/tests/test_cron_sync_tick.sql`, `test_ops_staleness_check.sql`, `test_prod_prober_cadence.sql`, `test_analytics_service_settings_and_vault_tick.sql`.

### Established Patterns
- Each function migration ends with a verify `DO` block that reads `pg_get_functiondef` and raises on a missing needle (for example `cron_sync_tick` checks it reads `vault.decrypted_secrets`). New data-reading `DO` guards are refused by `scripts/lint-migration-data-dependence.mjs`; catalogue reads are fine.
- Committed function snapshots and census tests move with any function body change.

### Integration Points
- `supabase/migrations/20261010140000_cron_sync_tick.sql`, `20261020120000_ops_staleness_check.sql`, `20260911120000_vault_tick_hardening.sql` (`match_engine_cron_tick`), `20260918120000_prod_prober_cadence.sql`, and the CHECK from `20260907120000_analytics_service_settings_and_vault_tick.sql`.
- `scripts/prod-prober/cron-manifest.json`.
- Phase 246 ALERTREADERS re-bases on these bodies.

</code_context>

<specifics>
## Specific Ideas

- `[167.1.2.2.2-CRON-TICK-RESIDUALS]` items 1, 2 and 3 close in this phase; item 4 closed in Phase 164.6.8. The ship PR deletes the TODOS.md entry and names it in the CHANGELOG entry.
- Never quote a credential-shaped fixture literal in CHANGELOG prose, a SUMMARY or a commit message; refer to findings by file, rule and fingerprint only.

</specifics>

<deferred>
## Deferred Ideas

- A working `workflow_dispatch` recovery for CI's push-to-main secret-scan job (WINDOWS.md entry 61 half (b)) stays open and recorded there.

</deferred>
