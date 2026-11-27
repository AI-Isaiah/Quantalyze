# Phase 242: SECRETSHYGIENE - Research

**Researched:** 2026-11-26
**Domain:** CI secret scanning (gitleaks 8.30.1, GitHub Actions) and PostgreSQL / Supabase SECURITY DEFINER cron functions (Vault key, pg_net, CHECK constraint, SQL gate corpus with mutation twins)
**Confidence:** HIGH for the gitleaks mechanics and the SQL/gate/census mechanics (all measured this session); MEDIUM for the Railway redeploy coupling and for PROD-side body equality (cited, not re-read from PROD)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Full-history scan**
- Historical findings are suppressed with commit-scoped fingerprints in a repo-root `.gitleaksignore` (`<commit>:<file>:<rule>:<line>`), one line per finding, each grouped under a comment naming why the literal is a fixture. Never a committed `--baseline-path` report, and no path or regex widening of `.gitleaks.toml` for these. — **Reversibility:** costly — the file becomes the suppression contract every later full-history and PR-range scan reads, and moving to another method means re-auditing every fingerprint. Rationale: history cannot be rewritten, so making a literal "obviously fake" in today's tree does not remove it from the history the scan walks; a fingerprint carries no literal; and it is pinned to one commit, so a real credential committed later at the same path still fires.
- The scan covers the history of `main` (the checked-out default branch, `--log-opts` set to its HEAD), not every ref. — **Reversibility:** costly — it sets what "full history" means for the gate. Rationale: PR branches are already scanned by CI's PR-range scan, other branches come and go, and an all-refs scan makes the result depend on which branches exist that day. Measured 2026-11-26 at origin/main `45d7b4e5c` with gitleaks 8.30.1 and `.gitleaks.toml`: main's history gives **31 findings**; all local refs give 49. Every one of the 31 read locally as a test fixture, a canary or a false positive (`match_key',\n ignore_duplicates=True`); none is a live credential. The planner re-measures at plan time and suppresses whatever the scan reports then.
- A red scheduled scan fails its workflow (fail loud) and files or comments on one open issue with a fixed label, like `sql-mutation-nightly.yml` does. It is accepted that a red run attaches a failing check to main's head SHA and can block a Railway redeploy of that SHA, the coupling the founder accepted for the nightly in Phase 164.9.6 D-11. — **Reversibility:** costly — it couples the scan to the deploy path. Rationale: a red full-history scan means a credential may be public, and a human must look before anything else moves; the next merge carries a new SHA, so the block is narrow.

**Cron destinations**
- The allowed destinations are an exact set of two origins, compared by equality, never by a pattern: `https://quantalyze-analytics-production.up.railway.app` (PROD's stored `analytics_service_url`, read 2026-11-26) and `http://127.0.0.1:9` (the loopback discard literal the gates use, and TEST's stored value, read 2026-11-26). — **Reversibility:** one-way — it is enforced by a migration on PROD; moving the analytics service to another host now needs a forward migration first, which is the intended cost.
- One migration narrows all of it: the `system_settings_analytics_service_url_allowed` CHECK constraint and the in-body re-test of all four functions that post the key (`cron_sync_tick`, `ops_staleness_check`, `match_engine_cron_tick`, `prod_prober_cadence_check`). — **Reversibility:** one-way — four `CREATE OR REPLACE` bodies and a constraint change on PROD. Rationale: SECR-04 names two functions, but measured on PROD 2026-11-26 the same wildcard is in four function bodies and the CHECK, and the `[167.1.2.2.2-CRON-TICK-RESIDUALS]` close gate (1) requires the CHECK and every in-body re-test to accept one exact origin. Narrowing two and leaving `match_engine_cron_tick` and `prod_prober_cadence_check` on the wildcard would leave the same key leak open and two spellings of one rule (CLAUDE.md Rule 7). This widens the roadmap wording, not its success criteria.
- Every function re-bases on its latest definition across all migrations and the committed PROD baseline before `CREATE OR REPLACE` (project memory rule). PROD md5 of `pg_get_functiondef` read 2026-11-26, for the planner to re-check: `match_engine_cron_tick` f7e5c66f…, `prod_prober_cadence_check` a8aeaeba…, `cron_sync_tick` f59054f0…, `ops_staleness_check` 92288598…. `scripts/prod-prober/cron-manifest.json` moves with it if any registered command or body hash it carries changes.
- The blank-key guard refuses a key that is empty under all whitespace (spaces, tabs, newlines, carriage returns), by name, in every function that posts the key, with an arm observed RED under the old spaces-only `btrim` guard (residual item 3).
- Gate arm P1 of `supabase/tests/test_cron_sync_tick.sql` asserts the recorded `X-Service-Key` header equals the Vault secret, observed RED under a mutant body that posts a fixed string (residual item 2).
- Each new SQL arm carries a `RED-UNDER` twin, and every census a new arm or gate file moves is updated (`grep -a` them all). PROOF-01 applies: each gate goes RED on a neutered copy with its named arm first, is restored from a byte backup (`cp` back, `cmp`), goes GREEN, and is recorded verbatim in the plan SUMMARY.
- The migration timestamp sorts after the PROD ledger tip (`20261126180000` read 2026-11-26) and after any migration Phase 243 DBBACKSTOP lands first; it is re-checked against origin/main and the PROD ledger before every push. migration-reviewer and rls-policy-auditor must report no MEDIUM+ finding before merge.

**Decided autonomously (phase agent, overridable by the founder before execution)**
- [Full-history scan] "How is gitleaks installed in the scheduled job?" → the sha256-pinned 8.30.1 release binary, copying the install step `supabase-migrate.yml` already uses.
- [Full-history scan] "How often does it run?" → daily on a cron schedule, plus `workflow_dispatch`.
- [Full-history scan] "What pins the workflow?" → a vitest pin asserting the schedule, the binary pin, the main-only log-opts and that the report is never committed.
- [Cron destinations] "What does the refusal message say?" → keep each function's existing not-an-allowed-destination message, which never echoes the stored value.

### Claude's Discretion
- Whether the four functions and the CHECK share one helper (for example an IMMUTABLE `analytics_destination_allowed(text)`) or each inline the same two-value equality. The planner decides on the evidence, weighing one spelling of the rule against a new function and its grants.
- How WINDOWS.md entry 61 is updated: its half (c) (latent full-history findings) is answered by this phase; its half (b) (no working `workflow_dispatch` re-trigger for CI's secret-scan job) is out of scope and stays recorded.

### Deferred Ideas (OUT OF SCOPE)
- A working `workflow_dispatch` recovery for CI's push-to-main secret-scan job (WINDOWS.md entry 61 half (b)) stays open and recorded there.

Out of scope (CONTEXT `<domain>`): rotating any key, rewriting git history, a new alert channel, the `workflow_dispatch` re-trigger defect in CI's own secret-scan job.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SECR-03 | A full-history secret scan runs on a schedule. Suppression method and whether a red scan may block a redeploy are decided at plan time. (covers SECRETSCAN-FULLHISTORY-01) | `.gitleaksignore` format and scope semantics measured on 8.30.1; main-ancestry scan = 31 findings, 0 after the ignore file; workflow skeleton is actionlint-clean; install step and issue-filing pattern located; every test that a new workflow / new ignore file moves is listed (Census, Pitfalls 1-6). |
| SECR-04 | `cron_sync_tick` and `ops_staleness_check` post the service key only to exact named hosts, never through a `.up.railway.app` suffix wildcard; the gate-arm and tab-key guard gaps are closed. (covers 167.1.2.2.2-CRON-TICK-RESIDUALS) | Latest bodies of all four functions confirmed equal to the committed baseline; inline-equality design prototyped on the pg-lane (10/10 arms RED with identity ok, baseline GREEN); helper rejected on measured evidence; ~32 twins to repoint; every census a new arm moves (Census). |
</phase_requirements>

## Summary

The phase has two independent halves that only meet in the squash commit. **SECR-03** is a hermetic CI job: one new schedule+dispatch workflow that installs the sha256-pinned gitleaks 8.30.1 binary, scans `main`'s ancestry with the repo's `.gitleaks.toml`, and on any finding fails and files one deduplicated issue. The 31 findings measured on main's history (30 `generic-api-key`, 1 `jwt`, all in test/canary/CHANGELOG-prose/`match_key` false-positive sites) are suppressed by 31 four-part lines in a repo-root `.gitleaksignore`. This session measured that: with the file present `gitleaks git` and the action's `gitleaks detect` both report `no leaks found` over 2744 commits in about one minute. Two traps were found that the CONTEXT does not name: a **three-part line (`file:rule:line`) is a GLOBAL fingerprint that suppresses that site in every commit, including future ones**, and an **inline `# comment` after a fingerprint silently voids the line** (no warning). Both must be pinned by a test.

**SECR-04** is one forward migration that replaces four SECURITY DEFINER bodies and the CHECK constraint with an exact two-origin set. The decisive facts: (1) a helper function called from the CHECK needs EXECUTE for every role that writes `system_settings`; measured on PostgreSQL 16, a writer without EXECUTE fails with `permission denied for function` even when writing an unrelated key, which would break the match-engine cursor write that `analytics-service/routers/match.py` makes, so the helper is rejected and **inline equality with a catalogue cross-check is the recommendation**; (2) about 32 existing `RED-UNDER-M` edit twins mutate text in the four old migrations and will report `no-red` the moment the new migration replaces those bodies, so every one must be repointed at the new file, which is exactly what the previous function-changing PR (#1383, 20261126180000) did; (3) the same needle occurs in all four bodies, which the runner handles with `occurrences` (measured total) plus `nth` (which match to mutate); prototyped and proven on the pg-lane.

**Primary recommendation:** Two parallel tracks. Track A: `.gitleaksignore` (31 four-part lines regenerated from a fresh scan) + `.github/workflows/secret-scan-full-history.yml` + a text-only vitest pin. Track B: one migration `20261127…_cron_destinations_exact.sql` (CHECK `value = ANY (ARRAY[…])` and four `CREATE OR REPLACE` bodies using a `TEXT[]` constant and `NOT (v_url = ANY (…))`, key guard `btrim(v_key, E' \t\r\n') = ''`), a rollback file, four re-based gates with repointed twins plus two or three new arms each, and every census moved. Do not edit any applied migration.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Full-history secret scan | CI (GitHub Actions scheduled workflow) | Repo config (`.gitleaks.toml`, `.gitleaksignore`) | Runs on the default branch's checkout; the suppression contract is repo-owned text read by the scanner |
| Suppression of historical fixtures | Repo config (`.gitleaksignore`, commit-scoped) | Vitest text pin | The scanner reads the file; a test must prove its shape because malformed lines are silently inert |
| Red-scan escalation | CI (`report` job: issues API) | — | Same pattern as `sql-mutation-nightly.yml`; no credential, `issues: write` on the report job only |
| Destination allow-list (what may be stored) | Database (CHECK constraint on `system_settings`) | — | Binds every writer (owner, service_role, admin) |
| Destination allow-list (what may be posted to) | Database (in-body re-test in four SECURITY DEFINER functions) | — | Survives one `ALTER TABLE … DROP CONSTRAINT`; it is the last control before the Vault key enters a header |
| Blank-key refusal | Database (same four bodies) | — | A blank header is answered 401 asynchronously and nothing downstream sees it |
| Proof that each control can fail | SQL gate corpus + mutation runner (pg-lane) | Vitest census pins | Twins mutate the live migration text; the runner requires the first `TEST FAILED (<arm>)` to name the arm |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| gitleaks (binary) | 8.30.1 | Secret scanner | Already the repo's pinned scanner (ci.yml `GITLEAKS_VERSION: 8.30.1`, supabase-migrate.yml). 8.24.3 silently drops `[[allowlists]]`, so the pin is load-bearing [VERIFIED: .github/workflows/ci.yml:5505 region, read; src/__tests__/gitleaks-allowlist.test.ts header] |
| actions/checkout | `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1) | Full-history checkout (`fetch-depth: 0`, `persist-credentials: false`) | Same pin as every other workflow; a repo test requires SHA pins and `persist-credentials: false` |
| actions/github-script | `3a2844b7e9c422d3c10d287c895573f7108da1b3` (v9.0.0) | Open or comment on the dedup issue | The `report` job of sql-mutation-nightly.yml [VERIFIED: .github/workflows/sql-mutation-nightly.yml:877] |
| PostgreSQL 16 pg-lane | brew `postgresql@16` 16.13 | Local proof for SQL gates | `scripts/pg-lane/run.sh --print-pgbin` resolves it; the mutation runner's `--file` mode ran 10 arms in 44 s here |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| actions/setup-node | `949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0) | `node` for the count step | Only if the scan step reads the JSON with `node -e`; `jq` is also on ubuntu runners |
| actionlint | /opt/homebrew/bin/actionlint | Lint the new workflow | Ran clean on the scan skeleton below |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `.gitleaksignore` fingerprints | `--baseline-path` report | Rejected by the locked decision (a committed report holds the literals) |
| Inline two-origin equality | IMMUTABLE helper `analytics_destination_allowed(text)` | Rejected below on measured grounds (EXECUTE-in-CHECK, snapshot, COMPARED_FLOOR, DRIFT-05 name set) |
| `gitleaks-action` for the scheduled scan | The pinned binary | The action's `workflow_dispatch` branch has no `--log-opts` and scans every ref; the binary gives exact scope |

**Installation:** none. No npm, PyPI or crates package is added. Local worktree needs `npm ci` before any vitest command (the worktree has no `node_modules`).

**Version verification:** the release tarball's sha256, computed this session over `gitleaks_8.30.1_linux_x64.tar.gz`, equals both the hard-coded value in `supabase-migrate.yml` and the release's own `checksums.txt` line: `551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb` [VERIFIED: shasum of the downloaded tarball + curl of checksums.txt, 2026-11-26]. The tarball was downloaded into its own scratch directory and never executed.

## Package Legitimacy Audit

No external package is installed by this phase. The only external artifact is the gitleaks release binary, verified against the upstream checksums file as above.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| gitleaks 8.30.1 release tarball | GitHub release | years-old project, already pinned in two workflows | n/a | github.com/gitleaks/gitleaks | OK (sha256 matches upstream checksums) | Approved |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*`gsd_run query package-legitimacy check` was not run: there is no npm/pypi/crates package to check.*

## Architecture Patterns

### System Architecture Diagram

```
SECR-03 (scheduled scan)                                SECR-04 (cron destinations)

 cron 05:30 UTC / workflow_dispatch                      merge to main (touches supabase/migrations/**)
        |                                                        |
        v                                                        v
 checkout main, fetch-depth 0                            supabase-migrate.yml: plan
        |                                                        |
        v                                                        v
 install gitleaks 8.30.1 (sha256 -c)                      apply-test  (TEST: marker query, db push)
        |                                                        | success
        v                                                        v
 gitleaks git . -c .gitleaks.toml                          apply  (PROD, auto, no human gate)
   --log-opts=HEAD --redact --exit-code 2                        |
        | reads .gitleaksignore (root)                           v
        |                                                  redump-dump -> redump-pr (bot PR, human merges)
   exit 0 ---------> green                                       |
   exit 2 (findings) \                                           v
   exit other (error) +--> job red -> report job -> one dedup issue: count + run link only
                                                        pg_cron job (hourly / daily) -> public.<tick>()
                                                          1. read Vault key (one scan, count + value)
                                                          2. refuse blank key  (btrim(v_key, E' \t\r\n'))
                                                          3. read system_settings.analytics_service_url
                                                          4. refuse unless v_url = ANY (c_allowed_origins)
                                                          5. net.http_post(url || route, X-Service-Key)
                                                        CHECK on system_settings refuses to STORE anything else
```

### Recommended Project Structure

Files this phase creates or edits (the planner's task map). `[N]` = new.

```
.gitleaksignore                                              [N] 31 four-part lines (re-measure) under reason comments
.github/workflows/secret-scan-full-history.yml               [N]
src/__tests__/secret-scan-full-history.test.ts               [N] text pins + a skipIf(no gitleaks) scoping arm
supabase/migrations/2026112…_cron_destinations_exact.sql     [N] one forward migration
supabase/migrations/down/2026112…-rollback.sql               [N] manual rollback (house convention, see #1383)
supabase/schema/functions/{match_engine_cron_tick,prod_prober_cadence_check,cron_sync_tick,ops_staleness_check}.sql
                                                             regenerated by `npm run schema:functions`
supabase/tests/test_cron_sync_tick.sql                       repoint 6 edit twins, +2 arms
supabase/tests/test_ops_staleness_check.sql                  repoint 13 edit twins, +2 arms
supabase/tests/test_prod_prober_cadence.sql                  repoint 7 edit twins, +2 arms
supabase/tests/test_analytics_service_settings_and_vault_tick.sql  repoint 6 edit twins (R3 stays), +3 arms
scripts/mutation-floors.mjs                                  ARMS_FLOOR raised by the number of new twinned arms
.github/workflows/ci.yml                                     sql-tests derivation table rows + ARMS_FLOOR sum (no new file, SENTINEL_FLOOR unchanged)
src/__tests__/gate-family-meta.test.ts, drift-check-scripts.test.ts, mutation-runner-floors.test.ts,
  mutation-annotation-parser.test.ts, contracts/ci-anti-skip-gate.contract.test.ts   currency edits (read the measured values off the red)
docs/runbooks/prod-prober-cadence-go-live.md, ops-staleness-go-live.md   restate the wildcard regex: update to the exact set
.planning/WINDOWS.md (entry 61), TODOS.md (delete 2 entries), CHANGELOG.md, VERSION, package.json   ship records
```

### Pattern 1: the `.gitleaksignore` contract
**What:** one line per historical finding, `<40-hex commit>:<file>:<rule>:<line>`, each group under a `#` comment on its OWN line naming why the literal is a fixture. Read from the repo root by `gitleaks git`, by `gitleaks dir`, and by the action's `gitleaks detect`.
**Measured facts (8.30.1, this session):**
- Fingerprint in git mode is `Commit:File:RuleID:StartLine` [VERIFIED: gitleaks v8.30.1 `detect/detect.go` `AddFinding`, fetched; and the JSON report's `Fingerprint` field, 31 values, none duplicated].
- A three-part line `file:rule:line` is the **global** fingerprint and is checked first: it suppresses that file/rule/line in every commit [VERIFIED: same function, `globalFingerprint` branch returns before the commit branch]. Never write one.
- A line is split on `:`; anything that is not exactly 3 or 4 parts logs `Invalid .gitleaksignore entry` at warn level and is stored anyway, inert [VERIFIED: `AddGitleaksIgnore` source]. Measured consequence: appending `  # inline comment` to a valid line made the scan report 29 instead of 31 for three entries, i.e. that line silently stopped suppressing. Comments must be whole lines starting with `#` (blank lines are also skipped).
- With the 31 lines in place at the repo root: `gitleaks git . --config .gitleaks.toml --log-opts=HEAD --redact` → `2744 commits scanned … no leaks found`, 63 s; the same through `GITLEAKS_CONFIG=.gitleaks.toml gitleaks detect --redact -v --exit-code=2 --report-format=sarif --log-opts=HEAD` (what `gitleaks-action` runs) → `no leaks found`. The file is found in the source directory even when the cwd is elsewhere (`found .gitleaksignore file path=<source>/.gitleaksignore`).
- The ignore file's own content is clean to the scanner: `gitleaks dir` over a directory holding only it (with a header comment) → `no leaks found`. Re-run this on the final committed text, because a comment containing key-shaped words could trip `generic-api-key` once the file is in a commit.
- gitleaks scans only added lines of each commit's patch, so a commit that merely *lists* a fingerprint is not a finding itself.

**Regenerate the lines from a fresh redacted scan (no literal ever printed):**
```bash
cd "$(git rev-parse --show-toplevel)"   # the phase worktree root
gitleaks git . --config .gitleaks.toml --log-opts=origin/main --redact --no-banner \
  --report-format json --report-path "$SCRATCH/main.json" --exit-code 7
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));
  for (const f of r) console.log(f.Fingerprint)' "$SCRATCH/main.json" | sort -u
```
`--redact` makes `Match` and `Secret` read `REDACTED` in the report (verified: the only distinct Secret value was `REDACTED`). Never copy any `Match`/`Secret` from an unredacted report into a tracked file.

**The 31 findings measured at origin/main `45d7b4e5c` (short commit · file · rule · line; no values):**

| Commit | File | Rule | Line(s) | Reading (value masked locally) |
|---|---|---|---|---|
| 604d655f | CHANGELOG.md | generic-api-key | 46, 63 | CHANGELOG prose quoting two fixture spellings |
| 8523b6fd | analytics-service/tests/test_structlog_frozen_proxy.py | generic-api-key | 145 | `_LEAK_TOKEN = "…"` canary |
| 54a0d26d | analytics-service/tests/test_mt5_validate_parity.py | generic-api-key | 333 | `secret = "…"` fixture |
| 6541a134 | src/lib/analytics-client.test.ts | generic-api-key | 1911 | `const TOKEN = "…"` |
| 67b2c01a | src/lib/ratelimit.test.ts | generic-api-key | 177 | `const TOKEN = "…"` |
| b22a2047 | src/app/api/portfolio-optimizer/route.test.ts | generic-api-key | 401 | `INTERNAL_TOKEN` fixture |
| b22a2047 | src/app/api/scenario/optimize/route.test.ts | generic-api-key | 389 | `INTERNAL_TOKEN` fixture |
| b22a2047 | src/__tests__/csv-validate-route.test.ts | generic-api-key | 458 | `INTERNAL_TOKEN` fixture |
| 00aeddbc | src/app/api/admin/match/recompute/route.test.ts | generic-api-key | 458 | `INTERNAL_TOKEN` fixture |
| 00aeddbc | src/app/api/keys/[id]/permissions/route.test.ts | generic-api-key | 1124 | `INTERNAL_TOKEN` fixture |
| 00aeddbc | src/app/api/admin/match/eval/route.test.ts | generic-api-key | 417 | `INTERNAL_TOKEN` fixture |
| 00aeddbc | src/app/api/verify-strategy/route.test.ts | jwt | 539 | JWT-shaped fixture |
| 00aeddbc | src/app/api/verify-strategy/route.test.ts | generic-api-key | 540, 541 | `RAW_API_KEY` / `RAW_API_SECRET` fixtures |
| 632eea07 | src/lib/resilient-fetch.test.ts | generic-api-key | 2130 | `const TOKEN = "…"` |
| a5f2957c | src/lib/resilient-fetch.test.ts | generic-api-key | 2085 | `INTERNAL_API_TOKEN` fixture |
| 19e904c2 | src/lib/sentry-capture.test.ts | generic-api-key | 51, 54 | `INTERNAL_TOKEN`, `EXCHANGE_SECRET` |
| f06d9a5b | src/lib/seam-redaction.test.ts | generic-api-key | 54, 63, 66 | `INTERNAL_TOKEN`, `SERVICE_KEY`, `EXCHANGE_SECRET` |
| 86fd7f04 | analytics-service/tests/test_status_contract_match_sim_portfolio.py | generic-api-key | 647 | `"api_key": "…"` |
| d36e8f37 | analytics-service/tests/test_service_key_log_companion.py | generic-api-key | 40, 41 | `_SERVICE_KEY_CANARY`, `_WRONG_SERVICE_KEY` |
| 46886c33 | analytics-service/tests/test_create_exchange_attribution.py | generic-api-key | 139, 258 | `api_key="…"` |
| 946ec06d | analytics-service/tests/test_mt5_client_contract.py | generic-api-key | 310 | `investor_password="…"` |
| de04f420 | analytics-service/services/job_worker.py | generic-api-key | 490 | false positive: the word `match_key` + `ignore_duplicates` |
| de04f420 | analytics-service/tests/test_funding_backfill_idempotency.py | generic-api-key | 41 | same false positive |
| de04f420 | scripts/backfill_funding.py | generic-api-key | 16 | same false positive |

Totals: 30 `generic-api-key` + 1 `jwt` = 31. Every line was read locally with the matched span masked (variable names and surrounding code only); none is a live credential shape the repo uses. The planner re-measures at plan time and again immediately before the push, and the reason comments must say what the site is, never quote it.

### Pattern 2: the scheduled workflow (actionlint-clean skeleton)
**What:** one `scan` job (read-only token) and one `report` job (`issues: write`), both with the repo's mandatory shape (top-level `permissions: contents: read` exactly once, SHA-pinned `uses:`, `persist-credentials: false`, no YAML anchors).
**When to use:** this phase only.

```yaml
# Source: skeleton verified with actionlint 2026-11-26; install step copied from supabase-migrate.yml:1324-1335
name: Secret scan - full history of main (scheduled)

on:
  schedule:
    - cron: "30 5 * * *"      # 03:00 sql-mutation-nightly, 04:00 cassette-refresh, 08:00 nightly: 05:30 is free
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: secret-scan-full-history
  cancel-in-progress: false

jobs:
  scan:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    outputs:
      findings: ${{ steps.count.outputs.findings }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          ref: main                 # a dispatch from another ref still scans main's ancestry and ignore file
          fetch-depth: 0
          persist-credentials: false
      - name: Install gitleaks (sha256-pinned release binary)
        env:
          GITLEAKS_VERSION: 8.30.1
          GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
        run: |
          set -euo pipefail
          tarball="${RUNNER_TEMP}/gitleaks.tar.gz"
          curl -fsSL -o "${tarball}" "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz"
          printf '%s  %s\n' "${GITLEAKS_SHA256}" "${tarball}" | sha256sum -c -
          mkdir -p "${RUNNER_TEMP}/gitleaks-bin"
          tar -xzf "${tarball}" -C "${RUNNER_TEMP}/gitleaks-bin" gitleaks
          echo "${RUNNER_TEMP}/gitleaks-bin" >> "${GITHUB_PATH}"
      - name: Scan the full history of main
        run: |
          set -uo pipefail
          report="${RUNNER_TEMP}/gitleaks-report.json"
          gitleaks git . --config .gitleaks.toml --log-opts=HEAD --redact --no-banner \
            --exit-code 2 --report-format json --report-path "${report}"
          rc=$?
          echo "gitleaks exit code: ${rc}"
          if [ "${rc}" -ne 0 ] && [ "${rc}" -ne 2 ]; then
            echo "::error::MEASURE_FAIL: gitleaks exited ${rc}, neither 0 (clean) nor 2 (findings); the scan did not complete."
          fi
          exit "${rc}"
      - name: Count findings (count only, never a location or a value)
        id: count
        if: always()
        run: |
          set -uo pipefail
          report="${RUNNER_TEMP}/gitleaks-report.json"
          if [ -s "${report}" ]; then
            n=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).length)' "${report}" || echo unknown)
          else
            n=unknown
          fi
          echo "findings=${n}" >> "${GITHUB_OUTPUT}"
```

Scan-step facts: `gitleaks git` exits 1 on an internal error and `--exit-code` on findings, so `--exit-code 2` (the action's own choice) separates the two. `--redact` keeps `Match`/`Secret` out of the report file; the report stays in `RUNNER_TEMP` and is never uploaded or committed. Do **not** pass `-v` (it prints each finding block into the public log).

`report` job: copy `sql-mutation-nightly.yml`'s `report` job (lines 859-941, `needs: [scan]`, `if: always() && needs.scan.result != 'success'`, `issues: write`, `actions/github-script`, `listForRepo` by label, comment-or-create). Change: label `nightly-canary-failure:secret-scan-full-history`, labels `["nightly-probe", "security", <dedup label>]`, and the body carries **only** the run URL, `needs.scan.result`, the findings count, and the local reproduction command. **No file, line, commit or fingerprint in the issue or in an artifact**: the repo is public and a red scan may be a real credential; maintainers get locations by running the command locally in about a minute. The body must also say what to do first: if any finding could be live, rotate before anything else; suppress only fixtures, by adding a four-part line.

### Pattern 3: the migration (inline equality, catalogue cross-check)
**What:** `BEGIN; SET lock_timeout='5s';` then one `ALTER TABLE … DROP CONSTRAINT IF EXISTS … , ADD CONSTRAINT … CHECK (key <> 'analytics_service_url' OR value = ANY (ARRAY['<prod origin>','http://127.0.0.1:9']))`, four `CREATE OR REPLACE FUNCTION` bodies re-based from the committed snapshots with three edits each, `COMMENT ON CONSTRAINT`, an idempotent `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` per function, and a catalogue-only verify `DO` block.

**Three body edits (applied mechanically to each snapshot body; prototype produced 1/1/1 substitutions per body and the pg-lane accepted it):**
```sql
-- 1. the constant
c_allowed_origins CONSTANT TEXT[] :=
  ARRAY['https://quantalyze-analytics-production.up.railway.app', 'http://127.0.0.1:9'];
-- 2. the guard (equality, never a pattern); the refusal text stays as it is (see Open Question 1)
IF NOT (v_url = ANY (c_allowed_origins)) THEN
-- 3. the blank-key guard, widened to the four whitespace characters the decision names
IF v_key IS NULL OR btrim(v_key, E' \t\r\n') = '' THEN
```
Measured on PG16: `btrim(E'\t')=''` is false and `btrim(E'\t', E' \t\r\n')=''` is true; a real key with a trailing newline is not blank; U+00A0 stays non-blank under the explicit set (a `[[:space:]]` class would call it blank, so the explicit set is the one that matches the decision text). `pg_get_constraintdef` renders the new CHECK as `value = ANY (ARRAY['…'::text, 'http://127.0.0.1:9'::text])`; a stored `https://evil.up.railway.app` or the production origin with a trailing slash both fail with 23514. Stored values must therefore equal the origin byte for byte (PROD's has no trailing slash per the CONTEXT read).

**Verify block (catalogue only, so `lint-migration-data-dependence.mjs` is not engaged):** assert, over `pg_get_constraintdef` and each of the four comment-stripped `pg_get_functiondef` texts (comments stripped first, lint rule R2): both quoted origin literals present in all five spellings; the old pattern fragment `[a-z0-9.-]*` absent from the CHECK text; each function still `SECURITY DEFINER`, `search_path` pinned `public, pg_catalog`, one overload, EXECUTE held by the owner alone. Follow the old 20260907120000 STEP 3 check 7 idiom (`position()`, not `~`).

**Two traps in that block (see Pitfalls 9 and 10):** do not spell a gate twin's `find` needle in the verify block or in comments (the runner counts `occurrences` over raw file text, comments included), and do not assert the *absence* of the old pattern inside the four **bodies**, because the wildcard-arm twin puts it back into a body and the apply would abort instead of the arm going RED. Positive assertions on bodies and a negative assertion on the CHECK only.

### Pattern 4: gate arms and twins (proven on the pg-lane)
In the cron_sync gate, as a prototype in a scratch clone (since deleted), the following gave `arms: 10/10/0`, `biting: 10`, every arm `RED (identity ok)`, baseline GREEN, with the old migration still in the apply list and only the new migration appended:
- repoint each existing edit twin: `"file":"<new migration>"`, same `find` (except the guard lines, which now read as in Pattern 3), `"occurrences":<measured total>`, `"nth":<position of this function's body>`;
- new arm **K1** (blank key refuses by name): vault stand-in holds `E'\t\n'`; twin = edit the new guard back to `btrim(v_key) = ''` (the old spaces-only guard), so K1 is the first failure while V2 (space-only) stays GREEN under that mutant;
- new arm **W1** (wildcard sibling refused): key fixture usable, `analytics_service_url` set to a `*.up.railway.app` host that is **not** the production origin (the existing foreign host `collector.attacker.example` is refused by the old and the new rule alike, so it cannot discriminate); twin = edit the new guard line back to the old `!~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$'` form.
- Every arm needs a prose `-- RED-UNDER:` line directly above its `-- RED-UNDER-M:` twin (prose/twin parity).

Item 2 (P1 compares the header to the Vault secret): seed the P1 secret as `'arm-fixture-key-' || gen_random_uuid()::text` (not the shared literal), read it back from `vault.decrypted_secrets`, assert `p.headers ->> 'X-Service-Key'` equals it; twin = edit `'X-Service-Key', v_key` to `'X-Service-Key', 'fixed-not-the-secret'` with the measured `occurrences`/`nth`. A fixed secret literal would let a mutant that posts that same literal pass. Candidate twin and fixture strings (a tab/newline key, a uuid-suffixed key, a `*.up.railway.app` host, the `'X-Service-Key', 'fixed-not-the-secret'` replace) were scanned with `gitleaks dir` against the repo config: `no leaks found`, and `gitleaks dir supabase` over the prototype migration plus gate: `no leaks found`.

### Anti-Patterns to Avoid
- **A three-part `.gitleaksignore` line or an inline comment:** global suppression, or silent no-op (Pattern 1).
- **Editing an old migration to change the regex:** PROOF-01 says an edit to an applied migration is never a close; it would also split the replay from PROD.
- **A helper function in the CHECK:** needs EXECUTE for every `system_settings` writer (Standard Stack / Don't Hand-Roll).
- **Printing, uploading or committing a gitleaks report that is not redacted, or any `Match`/`Secret`:** the repo is public.
- **`pull_request`/`push` triggers on the new workflow, or adding `main` to a path-triggered job:** it must stay schedule + dispatch, so it stays out of the merge-path set pinned in `critical-regressions.test.ts`.
- **Raising a floor by adding arms and re-pinning to "make it pass":** raise floors to the measured value read off the runner; never lower or loosen.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Scanning git history for secrets | A grep over `git log -p` | gitleaks 8.30.1 with the repo `.gitleaks.toml` | Entropy rules, decoding, allowlist semantics already tuned and tested here |
| Suppressing known historical fixtures | A regex or path allowlist in `.gitleaks.toml` | Commit-scoped `.gitleaksignore` | Locked decision; path/regex widening would also hide a later real credential at the same site |
| A shared "is this destination allowed" function | `analytics_destination_allowed(text)` in the CHECK | Inline `value = ANY (ARRAY[…])` in the CHECK and `NOT (v_url = ANY (c_allowed_origins))` in each body | A function in a CHECK needs EXECUTE for every writer. Measured on PG16: a writer without EXECUTE got `permission denied for function allowed` writing the matching key AND an unrelated key (the cron cursor row `analytics-service/routers/match.py` writes). A public EXECUTE grant then exposes an RPC and drops the "owner alone" posture the four ticks keep |
| Issue filing for a red scan | A bespoke webhook | The `report` job of `sql-mutation-nightly.yml` | Same dedup label scheme, same permissions split |
| Proving a gate arm can fail | Hand-editing the migration and eyeballing | `node scripts/mutation-runner/run.mjs --file <gate>` (mutates copies in scratch), then a manual byte-backup cycle for the PROOF-01 record | The runner requires the first `TEST FAILED (<arm>)` to name the arm and attributes it by source location |
| Cross-checking five spellings of one rule | A new gate arm reading four bodies | The migration's own apply-time verify block plus a hermetic text pin | A cross-function arm would force every gate lane to load every other function's predecessor chain; the verify block runs on TEST and PROD at apply time |

**Key insight:** every control here already has an in-repo idiom (pinned-binary install, dedup-issue job, replace-and-verify migration, twin-per-arm gate). The risk is not missing machinery; it is the churn the idioms impose (about 32 repointed twins, six census files) and the two silent-failure traps in the ignore file.

## Runtime State Inventory

> Included because SECR-04 changes where a live secret may be sent and re-bases four live PROD functions. This is not a rename phase; the categories are answered anyway.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `public.system_settings` row `analytics_service_url`: PROD = `https://quantalyze-analytics-production.up.railway.app`, TEST = `http://127.0.0.1:9` (both read 2026-11-26 per CONTEXT; the seed in `20260907120000` is the production origin, so any lane built from migrations holds a member of the new set) | `ALTER TABLE … ADD CONSTRAINT` validates existing rows; PROD and TEST pass. No data migration. A row set out of band to another host makes the apply fail loud, which is the intent |
| Live service config | pg_cron jobs on PROD call the four functions by name (`SELECT public.cron_sync_tick();` etc.: jobs 43, 44, 41, 1 in `scripts/prod-prober/cron-manifest.json`); `CREATE OR REPLACE` leaves the cron command text and the job rows untouched | None for the jobs. `cron-manifest.json` carries command text and `command_sha256` of the *call*, not function bodies, so it does **not** move (verified by reading the four job rows) [VERIFIED: scripts/prod-prober/cron-manifest.json] |
| OS-registered state | None — verified by grep: no host-level scheduler references these functions | None |
| Secrets/env vars | Vault secret `analytics_service_key` (name unchanged, value untouched, nothing rotated); Railway `ANALYTICS_BASE_URL` / `ANALYTICS_HEALTH_URL` repo variables are prober/deploy-verify inputs, not the CHECK's subject | None |
| Build artifacts | `supabase/schema/functions/*.sql` snapshots (regenerate); `supabase/schema/baseline.sql` and `baseline-carried-migrations.txt` go stale until the post-apply bot re-dump merges | Regenerate snapshots in the PR; **do not** touch `baseline.sql` in the PR; merge the bot's re-dump PR after the PROD apply |

## Common Pitfalls

### Pitfall 1: a three-part ignore line is a global suppression
**What goes wrong:** `CHANGELOG.md:generic-api-key:46` silences that site in every past and future commit. A real credential later committed at the same path and line is invisible.
**Why it happens:** `AddFinding` checks the global fingerprint first and returns.
**How to avoid:** the vitest pin rejects any non-comment line that is not `^[0-9a-f]{40}:[^:\s]+:[a-z0-9-]+:[0-9]+$`. The pin must itself be falsifiable: calibrate by feeding it a three-part line and an inline-comment line and requiring RED.
**Warning signs:** `Invalid .gitleaksignore entry` in a debug log; a fingerprint count that does not equal the finding count.

### Pitfall 2: an inline comment or stray text voids the line silently
**What goes wrong:** measured: three entries, one with `  # inline comment`, reported 29 of 31. No error.
**How to avoid:** whole-line `#` comments only; the pin forbids `#` after the fingerprint and trailing whitespace. After writing the file, run the full scan and require exactly zero findings and zero `Invalid .gitleaksignore entry` warnings (`-l warn`).

### Pitfall 3: the first scheduled run can be red from this phase's own commit
**What goes wrong:** the PR's squash commit has a SHA no one can fingerprint in advance. If a twin, a gate fixture, a CHANGELOG sentence or the new test carries something `generic-api-key` reads as a secret, the first scheduled scan fails (and CI's push-to-main scan fails first on the same commit).
**How to avoid:** a pre-merge gate: build the squash-shaped diff and scan it as one commit, exactly as the push scan does (`--log-opts=-1`):
```bash
git switch -c scratch-squash-probe origin/main && git merge --squash gsd/phase-242-secretshygiene \
  && git -c user.name=probe -c user.email=probe@example.invalid commit -q -m probe \
  && gitleaks git . --config .gitleaks.toml --log-opts=-1 --redact --no-banner --exit-code 7
```
(plus the same over the PR-range `origin/main..HEAD`). In the new vitest pin, build any key-shaped fixture at runtime (`crypto.randomBytes(...).toString("hex")`), never as a source literal, because `gitleaks-allowlist.test.ts` is path-allowlisted for exactly that reason and a new test file is not.
**Warning signs:** CHANGELOG or SUMMARY text that quotes a fixture; the CHANGELOG finding at commit 604d655f is the precedent.

### Pitfall 4: "first run green" is only observable after merge
**What goes wrong:** GitHub registers a `schedule`/`workflow_dispatch` workflow only from the default branch, so SC-1's "green on its first run" cannot be shown on the PR.
**How to avoid:** pre-merge evidence is the exact scan command and pinned binary run locally (31 → 0 after the ignore file) plus the squash probe in Pitfall 3 plus actionlint; post-merge, dispatch once (`gh workflow run secret-scan-full-history.yml --ref main`) and record the run id and the `no leaks found` line. A red first dispatch blocks Railway for that SHA, so merge only on the local zero.

### Pitfall 5: `workflow_dispatch` scope
**What goes wrong:** `--log-opts=HEAD` is main only on the schedule; a dispatch from a branch checks out that branch (its own `.gitleaksignore`, its own history).
**How to avoid:** `ref: main` on the checkout (Pattern 2). The vitest pin asserts both `ref: main` and `--log-opts=HEAD`.

### Pitfall 6: new workflow versus the repo's workflow-wide invariants
**What goes wrong:** `src/__tests__/critical-regressions.test.ts` discovers every `.github/workflows/*.yml` dynamically and requires, per file: every `uses:` pinned to a 40-hex SHA; exactly one top-level `permissions:` containing `contents: read`; every `actions/checkout` sets `persist-credentials: false`; no YAML anchors/aliases; and the merge-path classifier must stay exactly the 8 listed files, so the new file must have no `push`/`pull_request`/`merge_group`/`pull_request_target` trigger. `contracts/ci-apt-bounded.contract.test.ts` and `ghcr-login-before-image-pull.contract.test.ts` also iterate all workflows; the new file has no apt and no image pull, so both are unaffected [VERIFIED: read both iterations]. No inventory of workflow names exists in docs (grep of `sql-mutation-nightly` finds only CLAUDE.md, ci.yml, its parity test and the contracts test).

### Pitfall 7: the Railway redeploy coupling
**What goes wrong:** a red scheduled run attaches a failing check to main's head SHA, and Railway gates on every workflow's check runs for a commit [CITED: .github/workflows/sql-mutation-nightly.yml header, D-11; CLAUDE.md]. The founder accepted this for the nightly and, per CONTEXT, for this scan. The mechanism on Railway's side was not read this session [ASSUMED]. A *running* scheduled scan (about 2-3 minutes) attaches to the SHA that was HEAD at trigger time, not to a later merge, so the exposure is narrow. The job loops on nothing and exits on its own, so the circular-wait shape recorded for `analytics-deploy-verify.yml` cannot occur.
**How to avoid:** state the coupling in the workflow header and in the issue body (copy the nightly's wording); merge this phase only after the local zero.

### Pitfall 8: about 32 twins mutate dead text after the replace
**What goes wrong:** every edit-kind twin in the four gates names the old migration. After `CREATE OR REPLACE` in a later file the live definition is the new file; the old file's text is not live and the runner reports `no-red`.
**Counts [VERIFIED: grep of the four gates]:** cron_sync 6, ops_staleness 13, prod_prober 7, analytics_settings 7 edit twins (6 on `20260911120000_vault_tick_hardening.sql`, which repoint; R3 edits `20260907120000`'s `REVOKE ALL … FROM anon;` and stays).
**How to avoid:** repoint `"file"`, re-measure `occurrences` with `grep -aFc` on the **final** migration text, add `"nth"` where the needle occurs in several bodies, append the new migration to each gate's `RED-UNDER-SETUP` `apply` list (after the old ones; do not remove them). The previous function-changing PR is the precedent (`eedbc2433`, #1383: "the eleven older twins were repointed at the new migration, the newest definition", per `scripts/mutation-floors.mjs` comment at the `ARMS_FLOOR` block).
**Facts for the grammar:** `occurrences` is the measured total in the file, `nth` (default 1) selects which match to mutate, both required [VERIFIED: scripts/mutation-runner/GRAMMAR.md edit schema table]. Prototype counts in the new file (functions ordered match_engine, prober, cron_sync, ops): the guard line 4, the url-null guard 4, the allow-list guard 4, the refusal tail 4, `'/api/cron-sync'` 1, `'X-Service-Key', v_key` 5 (ops posts twice). A reorder of the four functions moves every `nth`; pin the order with a comment and prefer a unique multi-line `find` where one exists (the post path line is unique per function except `/api/prober-cadence-alert`, shared by prober and ops).
**Lane setup:** appending only the new migration to the cron_sync gate's apply list was enough in the prototype, because `CREATE OR REPLACE` creates the other three functions fresh and the body is plpgsql (relations are not resolved at create time). Keep the new verify block free of any `cron_runs` / `compute_jobs` dependence so that stays true; re-run each gate's `--file` to confirm.

### Pitfall 9: the verify block can abort an `edit` twin's apply
**What goes wrong:** if the migration's verify block asserts a string a twin edits, the mutated migration aborts at apply and the runner scores a defect rather than a bite (GRAMMAR rule: use a `sql` step, or layer a second edit that re-baselines the pin). Existing gates already use `sql` twins for this reason (arms 0, U2, G1, D1).
**How to avoid:** prescribe a `sql`-kind twin for the CHECK arms (shape of D1's twin: `ALTER TABLE public.system_settings DROP CONSTRAINT …, ADD CONSTRAINT … CHECK (… wildcard regex …)`); keep body-edit twins on the guard lines only, leaving every literal the verify block pins intact (Pattern 3).

### Pitfall 10: occurrence counts include comments
**What goes wrong:** the runner counts `occurrences` over raw file text. A header paragraph that quotes a guard line adds a match and shifts `nth`. The old cron_sync migration deliberately assembled its verify needles by concatenation for this reason.
**How to avoid:** no gate needle in header prose or verify-block literals; assemble verify needles by concatenation; re-measure at the end.

### Pitfall 11: the existing refusal tail is now misleading prose
**What goes wrong:** every body's refusal ends `Allowed: an https host under .up.railway.app`. With the exact set that sentence is false documentation in a log line, and the C3/S13 twins use that very tail as a `find` needle.
**How to avoid:** CONTEXT locks "keep each function's existing not-an-allowed-destination message". Keep it byte for byte unless the founder overrides (Open Question 1); the gates key on the substring `not an allowed destination`, so a wording change would be cheap (re-point the C3/S13 needles). Do not echo the stored value either way.

### Pitfall 12: ordering and drop in the analytics-settings gate
**What goes wrong:** arm U2 proves the CHECK bites and then drops it for the rest of the file (documented load-bearing order). A new "CHECK refuses a wildcard sibling" arm placed after the drop measures nothing.
**How to avoid:** place the new CHECK arm (suggest `U3`) between U2 and the drop; its twin is a `sql` step reinstalling the wildcard CHECK. New function-behaviour arms (`C4` wildcard host, `V3` tab key) go after C2/C3 / V2 where the constraint is already gone. That file also runs on the local-stack lane with the real Vault view, so its fixtures must use the same `DELETE FROM vault.decrypted_secrets` + `vault.create_secret` pattern V2 uses. The other three gates are LANE-ONLY on the pg-net stand-in (`net._lane_posts`, fixture 34) and read the posted header off it.

### Pitfall 13: floors and sentinels are pinned in several files
See Census. The mutation-floors comment convention: cite the measured value and the date, never a derived target. Floors are read as of `1fd1ce2ee`: `FILES_FLOOR = 96`, `ARMS_FLOOR = 1079`, `WAIVED_CEILING = 0` (scripts/mutation-floors.mjs lines 1397, 3579, 3693), ci.yml `SENTINEL_FLOOR=38`, `ARMS_FLOOR=589` (lines 5363-5364). Phase 243 runs in parallel and will move the same constants: re-base on origin/main and re-measure with `node scripts/mutation-runner/run.mjs --parse-only` before every push.

### Pitfall 14: the expected reds on the PR (do not "fix" them)
- `sql-gate-lint` job's `baseline-content-drift-check` step: 4 DRIFT rows (`match_engine_cron_tick/0`, `prod_prober_cadence_check/0`, `cron_sync_tick/0`, `ops_staleness_check/0`) until the post-apply re-dump merges. Precedent in the script's own comments: "EXPECTED until that re-dump, and NO allowlist row was added". Do not add allowlist rows; `COMPARED_FLOOR` (148) does not move because no function is added. Project memory counts this stale-baseline red as green.
- `test-db-drift` (VAC-08) can read red on the PR for the new migration's ledger row until `apply-test` runs on merge (CLAUDE.md coupling (b), narrowed by the ledger-frontier exemption).
- VAC-04 (`migration-drift-check.yml`) **requires four `-- prod-body-ack: <sha256>` lines** in the migration: it compares the committed snapshot body to PROD's live body and a DRIFT row is acknowledged only by the hash of the normalized PROD body. Candidate values (normalized baseline == committed snapshot, each `MATCH`, read this session): `cron_sync_tick` `2816b95cff1895d8201da70bf7dcd8ee5833dc0b8d94593a7369899da60d167e`, `ops_staleness_check` `bc790f0c9ba9382247555ece7cc484bddf861ff778c6c5cb06060093b4925abb`, `match_engine_cron_tick` `277f02d6d0cfdffab2269fb3a146e9dc78cb47f47c7217101748fd47d5a65bd6`, `prod_prober_cadence_check` `7555dbdeabf467c199fa48dba1a24344ebe7597e605d8574df06eafa3100fccc`. These are equal to the PROD hashes only if PROD still equals the baseline (re-dumped after the PROD apply of `eedbc243`); PROD was not read this session, so **the CI VAC-04 output is the authority** for the final four pragma values [ASSUMED for PROD equality].
- `migration-policy` rejects a timestamp below the PROD ledger tip; use a timestamp after `20261126180000` and after anything on origin/main, re-checked before every push.

### Pitfall 15: Docker is down, no `node_modules` in the worktree
Local SQL proof uses the pg-lane (`bash scripts/pg-lane/run.sh`, driven by `node scripts/mutation-runner/run.mjs --file …`), not the local-stack lane. The local-stack lane is exercised by CI's `sql-tests`, which replays this migration on top of the dump (it is not in `baseline-carried-migrations.txt`). `npm ci` is required in the worktree before any vitest command.

## Code Examples

### The pg-lane proof loop (verified commands)
```bash
cd "$(git rev-parse --show-toplevel)"   # the phase worktree root
# One gate, every twin, on throwaway copies; 10 arms took 44 s in the prototype. Exit code 2 by design (never 0).
node scripts/mutation-runner/run.mjs --file supabase/tests/test_cron_sync_tick.sql
# Static census (no lane): prints arms: 0/<annotated>/<waived> and static defects
node scripts/mutation-runner/run.mjs --parse-only
```
Expected tail per gate: `arms: N/N/0`, `biting: N`, `lane-invocations: N`, every arm `RED (identity ok)`, `No defects in the narrowed scope`. [VERIFIED: baseline gate run 8/8 on the unmodified cron_sync gate, and 10/10 on the prototype]

### PROOF-01 manual byte-backup cycle (record verbatim in the plan SUMMARY)
```bash
cp supabase/migrations/<new>.sql "$SCRATCH/<new>.bak"
# neuter: e.g. revert the key guard line to btrim(v_key) = '' (old spaces-only guard)
bash scripts/pg-lane/run.sh --workdir "$SCRATCH/w" --apply <the gate's RED-UNDER-SETUP list, in order> --gate supabase/tests/test_cron_sync_tick.sql   # expect: first TEST FAILED (K1)
cp "$SCRATCH/<new>.bak" supabase/migrations/<new>.sql && cmp "$SCRATCH/<new>.bak" supabase/migrations/<new>.sql && echo BYTE-IDENTICAL
bash scripts/pg-lane/run.sh --workdir "$SCRATCH/w" --apply <same list> --gate supabase/tests/test_cron_sync_tick.sql                              # expect GREEN
```
Never `git checkout`, `restore` or `stash` on uncommitted work. The runner's `--file` output is the machine-attributed proof for every twin; the manual cycle is the literal PROOF-01 record for at least the three new classes (wildcard host, tab key, P1 header-equals-secret) and for the scan (remove one `.gitleaksignore` line, require exactly that one finding, restore with `cp` + `cmp`, require zero).

### Hermetic pin for the ignore file (shape)
```typescript
// src/__tests__/secret-scan-full-history.test.ts  (text-only; skipIf(no gitleaks) for the behavioural arm)
const LINE = /^[0-9a-f]{40}:[^:\s#]+:[a-z0-9-]+:[0-9]+$/;
const lines = readFileSync(".gitleaksignore", "utf8").split("\n").map((l) => l.trim());
const entries = lines.filter((l) => l !== "" && !l.startsWith("#"));
it("every entry is a four-part commit fingerprint (a three-part line is global; a trailing comment voids the line)", () => {
  expect(entries.filter((l) => !LINE.test(l))).toEqual([]);
});
```
Behavioural arm (skipped where the binary is absent, like `gitleaks-allowlist.test.ts`): a throwaway git repo with the same fixture at one path in two commits, an ignore file naming only the first commit's fingerprint, assert the first is suppressed and the second still reported, and that the global three-part form suppresses both (the trap, demonstrated). Build the fixture value at runtime.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Allow-list by `.up.railway.app` suffix regex in CHECK + four bodies | Exact two-origin equality in CHECK + four bodies | This phase | Moving the analytics host needs a forward migration (intended) |
| Spaces-only `btrim(v_key) = ''` | `btrim(v_key, E' \t\r\n') = ''` | This phase | Tab/newline keys refused by name instead of a 401 behind a green tick |
| Fixtures accepted in history only by PR-time allowlists | Commit-scoped `.gitleaksignore` + scheduled scan | This phase | The full-history direction is measured on a cadence |

**Deprecated/outdated:** gitleaks-action's default scanner (8.24.3) ignores `[[allowlists]]`; it stays pinned in `ci.yml`. WINDOWS.md entry 61 half (b) (CI's own `workflow_dispatch` scope) is unchanged by this phase.

## Census: every file a plan must account for

| File | What moves | How to get the value |
|------|-----------|----------------------|
| `scripts/mutation-floors.mjs` `ARMS_FLOOR` | + number of new twinned arms (no new gate file, so `FILES_FLOOR` stays) | `node scripts/mutation-runner/run.mjs --parse-only` prints `arms: 0/<annotated>/0`; also add a dated comment line in the file's existing style |
| `src/__tests__/gate-family-meta.test.ts` | key `"scripts/mutation-floors.mjs :: ARMS_FLOOR=<n>"` | same number |
| `.github/workflows/ci.yml` sql-tests step (lines ~4960-5364) | the four per-file rows (`test_analytics_service_settings_and_vault_tick.sql 13`, `test_cron_sync_tick.sql 8`, `test_ops_staleness_check.sql 14`, `test_prod_prober_cadence.sql 7`), the `ARMS_FLOOR=` sum and its derivation comment; `SENTINEL_FLOOR` unchanged | each file's own first `ALL N ARMS EXECUTED` sentinel, never the table; `ci-anti-skip-gate.contract.test.ts` re-derives the table and goes red on drift |
| `src/__tests__/drift-check-scripts.test.ts` | the test title and two `grep -ac "ARMS_FLOOR=589"` arguments (and `SENTINEL_FLOOR=38` if it moves) | read off the red |
| `src/__tests__/mutation-runner-floors.test.ts`, `mutation-annotation-parser.test.ts` | `armsSeen`, `stepsSeen`, `needles.length`, `totalAnchored`, the synthetic FULL log numbers, per-file row for each gate that gained arms | precedent diff of `eedbc2433` shows the exact set; read each measured value off the failing expectation, never add by hand |
| `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` line 314-336 | `okCount` of files printing `ALL 7 ARMS EXECUTED`; `test_prod_prober_cadence.sql` declares 7 but is LANE-ONLY and excluded from that count, so this likely does not move; confirm by running it | run the test |
| each gate's own sentinel notice | `ALL N ARMS EXECUTED (roster)` integer and roster | count the arms the file executes |
| `supabase/schema/functions/*.sql` (four) | regenerated | `npm run schema:functions`, then `npm run schema:functions:check` |
| `scripts/prod-prober/cron-manifest.json` | **no change** (carries job command text, not bodies) | run `src/__tests__/prod-prober-wiring.test.ts` to confirm |
| `scripts/baseline-content-drift-check.mjs` | no change; 4 expected DRIFT rows until re-dump (Pitfall 14) | — |
| `docs/runbooks/prod-prober-cadence-go-live.md:112`, `docs/runbooks/ops-staleness-go-live.md:134` | restate the wildcard regex / run a membership query against it | edit to the exact set |
| `.planning/WINDOWS.md` entry 61 | the table row (line 78) and its JSON record (id 61, near line 813): half (c) answered, half (b) stays open | hand edit; `git diff` after |
| `TODOS.md` | delete `[SECRETSCAN-FULLHISTORY-01]` and `[167.1.2.2.2-CRON-TICK-RESIDUALS]` (items 1-3 close here, item 4 closed 2026-10-14), name both in the CHANGELOG entry; annotate (do not delete) `secret-scan is red on workflow_dispatch runs` with a dated note that the 31 main-history sites are now suppressed but other refs are not | CLAUDE.md rule (b) |
| `CHANGELOG.md`, `VERSION`, `package.json` | one unified entry, byte-equal 4-digit version | CLAUDE.md CHANGELOG discipline; never write a fixture literal or the CI skip tokens |

Not touched (verified by reading): `gitleaks-allowlist.test.ts` (its `--no-git` scans use temp dirs; commit-scoped lines never match them), `.gitleaks.toml` (no widening), `restore-test-from-baseline.sh` and `test-only-normalize-analytics-url.sh` (their self-tests carry their own copies of the old CHECK and a synthetic `selftest-stand-in.up.railway.app` seed on a scratch table; they never read the repo migration), `D1` of the analytics gate (it needs the loopback literal to stay in the allowed set, which it does).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PROD's function bodies equal the committed baseline (the four candidate `prod-body-ack` hashes are PROD's) | Pitfall 14 | VAC-04 reds with the real hash; fix = copy the hash its output prints. Low |
| A2 | Railway's "wait for CI" treats a red scheduled run on main HEAD as it treats the nightly's (D-11) | Pitfall 7 | The coupling is milder or harsher than recorded; founder already accepted it |
| A3 | A `*.up.railway.app` sibling is not in PROD's `system_settings` and no non-prod database holds another host | Runtime State Inventory | The `ADD CONSTRAINT` validation aborts the apply on that database (fail loud, TEST first) |
| A4 | The apply-time verify block can stay free of `cron_runs`/`compute_jobs` dependence so the pg-lane lists need only the new migration appended | Pitfall 8 | Each gate lane needs the ops lane's wider fixture list; re-run each `--file` |
| A5 | PR-time `sql-gate-lint` red from baseline drift is accepted as green by the founder, as the project memory states | Pitfall 14 | The aggregate reads red; merge decision falls to the coordinator |

## Open Questions (RESOLVED)

1. **Refusal text tail.**
   - What we know: CONTEXT locks keeping the existing message; the tail says "an https host under .up.railway.app".
   - What's unclear: whether the founder wants the tail corrected now that the rule is two named origins.
   - Recommendation: keep byte-for-byte as locked (twins C3/S13 and the gates key on it); report at handback that the sentence is now inexact and that changing it is a two-line twin re-point.
   - **RESOLVED 2026-11-27:** superseded by the CONTEXT revision of the same date ("Decided autonomously", refusal message): the "Allowed:" tail is corrected to name the two exact origins (phase contract body edit 4, `array_to_string(c_allowed_origins, ' or ')`), and the C3/S13 echo twins are re-pointed at the new tail in plans 02, 03 and 04.
2. **First-run evidence for SC-1.**
   - What we know: the workflow cannot run before it is on main.
   - Recommendation: accept local zero + squash probe as pre-merge evidence and a post-merge dispatch as the recorded "first run"; do not add a `pull_request` trigger (it would join the merge-path set and add a check to every PR).
   - **RESOLVED 2026-11-27:** adopted as recommended. Plan 01 records the local zero and PROOF-01 for the scan, plan 06 Task 3 runs the full-history, range and squash-shaped scans, the workflow has no `pull_request` trigger (pinned), and the post-merge dispatch run id is a recorded verification item (VALIDATION.md Manual-Only).
3. **`secret-scan` on CI's own `workflow_dispatch`.**
   - What we know: the 31 main sites are now suppressed in that path too (same root file), but other refs hold ~18 more findings (49 local-ref total) that this phase does not touch.
   - Recommendation: leave WINDOWS entry 61 half (b) open and the TODOS dispatch entry annotated, not deleted.
   - **RESOLVED 2026-11-27:** adopted as recommended. Plan 06 Task 1 annotates (does not delete) the TODOS dispatch entry, and Task 2 records WINDOWS.md entry 61 half (c) as answered while half (b) and the entry's `open` status stay.
4. **Phase 233 / 243 / 246 interleaving.** Re-check `git log origin/main -- supabase/migrations` and the PROD ledger for any newer body of these four functions before the push; re-base on whatever is there. Phase 243's migrations should not touch these functions, but the floors and timestamp ordering will collide.
   - **RESOLVED 2026-11-27:** handled by the phase contract's "Ship" paragraph (re-base on origin/main, re-check the migration timestamp against origin/main and the PROD ledger tip, re-measure floors with `--parse-only`) and "Migration identity" rename rule, by plan 02 Task 1's latest-definition re-measure, and by plan 05 Task 1 stopping if Phase 243 moved `ARMS_FLOOR` on origin/main.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| gitleaks | local scan, PROOF | yes | 8.30.1 (/opt/homebrew/bin/gitleaks) | none needed |
| PostgreSQL 16 + pg-lane | gate proof | yes | 16.13 (brew `postgresql@16`) | CI `sql-mutation` |
| actionlint | workflow lint | yes | /opt/homebrew/bin/actionlint | — |
| node / vitest | pins, censuses | node 25.8.1 yes; **vitest not runnable in the worktree: no `node_modules`** | vitest 4.1.12 via npx cache fails to load config | `npm ci` in the worktree first (Wave 0) |
| Docker | local-stack lane | **no** (daemon down) | — | CI `sql-tests`; if started, stop and clean up afterwards |
| Supabase CLI | none (must NOT be used against a remote) | present, linked to PROD | 2.84.2 | never run `db push`/`--linked`/`--db-url` |
| Supabase MCP (PROD reads) | optional md5 re-read | not exposed in this session | — | CONTEXT's 2026-11-26 md5s and the VAC-04 CI output |

**Missing dependencies with no fallback:** none. **With fallback:** node_modules (npm ci), Docker (CI).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.12 (text pins, contracts); SQL gates under `supabase/tests/` run by the mutation runner on the pg-lane and by CI `sql-tests` on the local-stack lane |
| Config file | `vitest.config.ts`; `scripts/mutation-runner/`, `scripts/pg-lane/run.sh` |
| Quick run command | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_cron_sync_tick.sql` (per gate); `npx vitest run src/__tests__/secret-scan-full-history.test.ts` |
| Full suite command | `npx vitest run` after `npm ci`; `node scripts/mutation-runner/run.mjs --parse-only`; `node scripts/lint-sql-gates.mjs && node scripts/lint-sql-gates.mjs --self-test`; `node scripts/lint-migration-data-dependence.mjs`; `node scripts/lint-app-guc.mjs`; `npm run schema:functions:check` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SECR-03 | `.gitleaksignore` entries are four-part, no inline comment, none global | unit (text) | `npx vitest run src/__tests__/secret-scan-full-history.test.ts` | Wave 0 |
| SECR-03 | commit scoping holds: same fixture in a later commit still fires | integration (real binary, skipIf absent) | same file | Wave 0 |
| SECR-03 | workflow shape: schedule + dispatch only, sha256-pinned 8.30.1, `ref: main`, `--log-opts=HEAD`, `--redact`, no upload/commit of the report, report job `issues: write` only | unit (text) | same file + `npx vitest run src/__tests__/critical-regressions.test.ts` | Wave 0 / exists |
| SECR-03 | the scan is green over main with the ignore file, and red when one line is removed | local PROOF (real) | `gitleaks git . --config .gitleaks.toml --log-opts=origin/main --redact --no-banner --exit-code 7` | commands above |
| SECR-03 | squash-shaped diff of this PR scans clean | pre-merge gate | squash probe (Pitfall 3) | procedure |
| SECR-04 | wildcard sibling host refused by each of the four bodies | SQL gate arm per function (W1/C4/…) | `node scripts/mutation-runner/run.mjs --file supabase/tests/<gate>.sql` ×4 | existing files, new arms |
| SECR-04 | CHECK refuses a wildcard sibling | SQL gate arm U3 (analytics settings) | same | new arm |
| SECR-04 | tab / newline / CR key refused by name in each body | SQL gate arms K1/V3/… | same | new arms |
| SECR-04 | P1 header equals the Vault secret; RED under a fixed-string mutant | SQL gate arm P1 strengthened | same | edit |
| SECR-04 | the five spellings carry the same origin set; no wildcard in the CHECK | migration verify block (apply-time, TEST then PROD) | local-stack replay in CI `sql-tests`; pg-lane applies it in every gate | in migration |
| SECR-04 | every twin still bites after repoint | mutation runner | `--file` ×4 and `--parse-only` | existing |
| SECR-04 | snapshots, floors, sentinels, censuses current | unit/contract | `npm run schema:functions:check`; the Census test list | existing |

### Sampling Rate
- **Per task commit:** the touched gate's `--file` run, `--parse-only`, `lint-sql-gates`, the specific vitest file.
- **Per wave merge:** all four gate `--file` runs, `npm run schema:functions:check`, `lint-migration-data-dependence`, the Census vitest set (`critical-regressions`, `gitleaks-allowlist`, `sql-mutation-nightly-parity`, `mutation-runner-floors`, `mutation-annotation-parser`, `gate-family-meta`, `drift-check-scripts`, `contracts/ci-anti-skip-gate.contract`, `prod-prober-wiring`, `baseline-redump-wiring`).
- **Phase gate:** full suite green except the expected reds in Pitfall 14; squash probe zero; actionlint clean; migration-reviewer and rls-policy-auditor MEDIUM+ clean.

### Wave 0 Gaps
- [ ] `npm ci` in the phase worktree root (no `node_modules`)
- [ ] `src/__tests__/secret-scan-full-history.test.ts`
- [ ] Final `.gitleaksignore` regenerated from a fresh scan at plan time

### How each success criterion is proven
- **SC-1 (scan green, nothing re-published):** local exact-command zero over 2744+ commits; ignore-file pin; squash probe zero; actionlint; post-merge dispatch recorded. Neuter evidence: delete one fingerprint line → exactly one finding printed by file/rule/line → restore with `cp` + `cmp` → zero. Disclosure check: `git diff` of the PR contains no `Match`/`Secret` (the table above holds file, rule, line, commit only).
- **SC-2 (wildcard arm RED, gaps closed):** per-function arms W1/C4/etc. and U3, K1/V3, P1; each twin run by the runner (`RED (identity ok)`), plus the manual byte-backup cycle for the three new classes. P1's mutant posts a fixed string; K1's mutant is the old spaces-only guard; the wildcard mutants restore the old suffix rule.
- **SC-3 (PROOF-01 and review):** SUMMARY records, verbatim, the neuter edit, the command, the RED line naming the arm and the GREEN line after restore for every gate and for the scan; `migration-reviewer` and `rls-policy-auditor` run on the migration with no MEDIUM+ finding; the migration is the only one in its lane.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no auth flow changes) | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | CHECK binds every writer of `system_settings`; four functions stay EXECUTE-for-owner-only (`REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, owner-alone verify) |
| V5 Input Validation | yes | exact-equality allow-list instead of a pattern; blank-key refusal |
| V6 Cryptography | no (the Vault key is read, never created or rotated; nothing hand-rolled) | Supabase Vault |
| V7 Error handling / logging | yes | refusal messages name the setting and never echo the stored value (T-161.1-10); the scan issue carries a count only |
| V10 Malicious code / supply chain | yes | gitleaks release verified by a hard-coded sha256 (checksum file is never fetched at runtime), `persist-credentials: false`, SHA-pinned actions, report job holds `issues: write` and the scan job holds no write scope |
| V14 Configuration | yes | public repo: no credential in any tracked text, ignore file holds fingerprints only |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Admin/service_role repoints `analytics_service_url` at another Railway subdomain and receives the Vault key | Information disclosure, Tampering | exact two-origin set in the CHECK (stored) and in each body (posted) |
| Blank/whitespace key posted, 401'd asynchronously, tick reads green | Repudiation / Denial of service | widened blank-key guard, by name |
| Global (3-part) ignore line masks a future real credential | Information disclosure | four-part only, pinned by test |
| Malformed ignore line silently inert | Tampering (silent weakening) | shape pin + full scan must read zero with no `Invalid .gitleaksignore entry` |
| Credential printed into a public log / artifact / issue by the scanner | Information disclosure | `--redact`, no `-v`, report kept in `RUNNER_TEMP`, issue carries count + run link only |
| Tampered scanner binary | Tampering | hard-coded sha256 verified before extraction |
| Fixture literal re-published in CHANGELOG/SUMMARY/commit | Information disclosure | refer by file, rule, line and fingerprint only; build test fixtures at runtime |

## Sources

### Primary (HIGH confidence)
- gitleaks v8.30.1 source fetched this session: `detect/detect.go` (`AddGitleaksIgnore`, `AddFinding`), `sources/git.go` (`NewGitLogCmdContext`: a user `--log-opts` replaces the default `--full-history --all --diff-filter=tuxdb`).
- gitleaks-action at the pinned SHA `e0c47f4f…`, `src/gitleaks.js`: the action runs `gitleaks detect --redact -v --exit-code=2 …` with `--log-opts=--no-merges --first-parent <base>^..<head>` for push/pull_request and nothing for dispatch.
- Local measurements 2026-11-26 (gitleaks 8.30.1, PostgreSQL 16.13): main-ancestry scan 31 findings / 2744 commits / 56-63 s; 31-line ignore file → 0; inline-comment void (29 of 31); global-vs-commit semantics from source; `gitleaks detect` honours the root file; EXECUTE-in-CHECK failure; blank-key and constraint-rendering probes; prototype gate run 10/10 RED (identity ok); actionlint clean; release sha256.
- Repo files read this session: `supabase/schema/baseline.sql` (bodies at 4224-4301, 8869-8957, 8964-9188, 9469-9623; CHECK at 16059), `supabase/schema/functions/*.sql` (four), migrations `20260907120000`, `20261010140000`, gates `test_cron_sync_tick.sql` (whole), `test_analytics_service_settings_and_vault_tick.sql`, `test_ops_staleness_check.sql`, `test_prod_prober_cadence.sql` (arms and twins), `scripts/mutation-runner/GRAMMAR.md`, `scripts/mutation-floors.mjs`, ci.yml (secret-scan, floors, sentinel table), `.github/workflows/{supabase-migrate,sql-mutation-nightly,migration-drift-check,migration-policy,sql-function-snapshot}.yml`, `src/__tests__/{critical-regressions,gitleaks-allowlist,sql-mutation-nightly-parity}.test.ts`, `scripts/prod-body-drift-check.sh`, `scripts/baseline-content-drift-check.mjs`, `scripts/lint-migration-data-dependence.mjs`.
- Precedent commits: `eedbc2433` (#1383, function-changing migration PR file list and census diffs), `45d7b4e5c` (#1385, post-apply baseline re-dump file list).

### Secondary (MEDIUM confidence)
- CONTEXT.md PROD/TEST readings (2026-11-26) and PROD md5 prefixes, carried from the coordinator; not re-read from PROD here.
- CLAUDE.md statements on the Railway gate and the `Production` environment's missing reviewer (PROD migrations auto-apply once `apply-test` succeeds).

### Tertiary (LOW confidence)
- Railway-side behaviour of its check-suite gate is inferred from the nightly's header (A2).

## Project Constraints (from CLAUDE.md)

- Supabase CLI in this checkout is linked to PROD: never `db push`, `db reset --linked`, `--project-ref`, `--db-url`. Run the marker query before any write; PROD writes need that and are the founder's call. This phase writes to no database.
- Migrations apply on merge: `apply-test` then PROD auto-apply once it succeeds; **there is no human stop**, so every review (migration-reviewer, rls-policy-auditor) happens before merge.
- SQL gate integrity: every new arm carries `RED-UNDER:` + `RED-UNDER-M:`; `WAIVED_CEILING` stays 0; floors are raised by measured value, read by symbol; `node scripts/lint-sql-gates.mjs --self-test` before and after; do not restate counts from memory.
- Never use `covered_digest` / `covered_files`; verification uses `verified_at_sha` + `drift_subjects`.
- CHANGELOG discipline: every ship writes an entry in the same commit as the VERSION bump (`VERSION` and `package.json` byte-equal 4-digit strings); never write the CI skip tokens in a commit message or PR body; never quote a credential-shaped fixture literal in CHANGELOG prose.
- TODOS.md holds open work only: delete the two entries this ship closes and name them in the CHANGELOG; do not book LOW/Info.
- Match codebase conventions; surgical changes; no AI attribution trailers (project memory).
- Memory rules that bind this phase: re-base every `CREATE OR REPLACE` on the latest definition across all migrations; SECDEF helpers in `{public}` policies need anon EXECUTE (the reason a helper is rejected); public repo: no secrets, PROD ids, home paths or account numbers in tracked text; always `grep -a`; a new supabase/tests arm moves several censuses.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — pinned binary verified against upstream checksum; all actions already used in-repo.
- Architecture: HIGH — gitleaks semantics from source and measurement; migration and twin mechanics proven on the pg-lane.
- Pitfalls: HIGH for the measured traps (global fingerprint, inline comment, EXECUTE-in-CHECK, dead twins, `nth`); MEDIUM for Railway coupling and PROD body equality (assumed, flagged).

**Research date:** 2026-11-26
**Valid until:** 2026-12-03 (fast-moving: Phase 233/243/246 and the floors change daily; re-measure the scan, the floors and the ledger tip at plan time and before every push)
