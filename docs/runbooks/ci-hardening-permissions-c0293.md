# CI Hardening: Permissions Map + Rationale (audit-2026-05-07 / C-0293)

Audit trail for the CI security hardening PR landing 2026-05-16. Closes
audit-2026-05-07 finding **C-0293** (red-team CHAIN — score 40 on the
tech-debt priority list).

> Filed under `docs/runbooks/` (rather than the originally-proposed
> `.planning/audit-2026-05-07/`) because `.planning/` is gitignored by
> project policy as "per-developer tooling, never in the repo"
> (.gitignore lines 47-50). Tracked audit trails belong with the rest
> of the security/SOC2 runbooks.

## Threat model

The tj-actions/changed-files compromise (2024) demonstrated the canonical
attack:

1. Attacker takes over (or impersonates) a maintainer of a popular
   third-party action.
2. Re-points the mutable major-version tag (e.g. `v2`) to a malicious
   commit.
3. Every downstream CI run that references `org/action@v2` executes the
   malicious code on the next push.
4. The malicious code runs with whatever GITHUB_TOKEN scope the
   workflow holds — by default, write on contents/issues/packages/PRs/
   statuses — and can also read any secrets the workflow exposes and
   any artifacts uploaded earlier in the run.

Pre-fix, Quantalyze CI had ALL THREE legs of this exposure:

| Leg | Pre-fix state | Post-fix state |
|-----|---------------|----------------|
| (a) GITHUB_TOKEN scope | Default repo scope (`contents: write`+) inherited by every workflow | Workflow-level default `contents: read`; per-job uplifts documented inline |
| (b) Mutable tag pins | Every `uses:` referenced `@v4`, `@v5`, etc. | Every `uses:` pinned to a 40-char commit SHA (with semver tag comment) |
| (c) Artifact credential leak | `frontend-build` baked real test-Supabase `NEXT_PUBLIC_*` into `.next/**` then uploaded the artifact (any action with `actions: read` could grep it) | Build uses placeholders unconditionally; seed-gated specs rebuild locally in the e2e job, never uploaded |

## Per-workflow permission map

### `ci.yml`

Workflow default: `permissions: contents: read`

| Job | Permissions | Justification |
|-----|-------------|---------------|
| `frontend-typecheck` | (inherits default) | Only checks out the tree + runs `tsc --noEmit`. |
| `frontend-lint` | (inherits default) | Only checks out the tree + runs eslint. |
| `frontend-test` | (inherits default) | Only checks out the tree + runs vitest. |
| `frontend-policy` | (inherits default) | Only checks out the tree + runs banned-package + GDPR coverage scripts. |
| `frontend-build` | (inherits default) | Builds `.next/`, uploads as artifact. Artifact upload uses the same workflow run's GITHUB_TOKEN; no special scope needed. |
| `frontend` (aggregator) | (inherits default) | Pure shell check of `needs.*.result`. No external surface. |
| `sql-tests` | (inherits default) | Runs `psql` against test Supabase via raw DB DSN secret. No GitHub API. |
| `secret-scan` | `contents: read` + `pull-requests: write` | gitleaks-action posts finding summaries as PR comments so the author sees the diagnostic without digging into the workflow log. |
| `docs-link-check` | (inherits default) | Runs lychee against checked-out docs. No GitHub API. |
| `python` | (inherits default) | Runs pytest + mypy against the analytics-service tree. No GitHub API. |
| `e2e` | (inherits default) | Runs Playwright against a local `next start`. Artifact download uses same-run GITHUB_TOKEN. |

### `nightly.yml`

Workflow default: `permissions: contents: read`

| Job | Permissions | Justification |
|-----|-------------|---------------|
| `demo-pdf-coldstart` | `contents: read` + `issues: write` | The `failure()` path uses actions/github-script to file an auto-issue against the repo so the broken staging cold-start is surfaced to the maintainer queue. |
| `npm-audit` | `contents: read` + `issues: write` | The `failure()` path files an auto-issue when `npm audit --audit-level=critical` finds a new advisory. |

### `supabase-migrate.yml`

Workflow default: `permissions: contents: read`

| Job | Permissions | Justification |
|-----|-------------|---------------|
| `plan` | (inherits default) | Runs `supabase migration list` against remote project. Auth via SUPABASE_ACCESS_TOKEN, not GITHUB_TOKEN. Also gated by `environment: production` (required-reviewer approval) since `retro-PR179-M-env-gate` — `supabase link --project-ref` consumes SUPABASE_DB_PASSWORD and writes it into a local supabase config file, so the plan phase has the same prod-credential exposure surface as apply. |
| `apply` | (inherits default) | Runs `supabase db push`. Auth via SUPABASE_ACCESS_TOKEN. Mutation power is gated by the `production` GitHub Environment's required-reviewer rule, orthogonal to GITHUB_TOKEN. |

### `phase-19-stability.yml`

Workflow default: `permissions: contents: read`

| Job | Permissions | Justification |
|-----|-------------|---------------|
| `check` | (inherits default) | Hourly cron runs `scripts/verify-no-legacy-writes.sh` against the test Supabase project's PostgREST endpoint. No GitHub API surface. |

## Pinned action SHAs

| Action | SHA | Tag |
|--------|-----|-----|
| `actions/checkout` | `34e114876b0b11c390a56381ad16ebd13914f8d5` | v4.3.1 |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0 |
| `actions/setup-python` | `a26af69be951a213d495a4c3e4e4022e16d87065` | v5.6.0 |
| `actions/cache` | `0057852bfaa89a56745cba8c7296529d2fc39830` | v4.3.0 |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | v4.6.2 |
| `actions/download-artifact` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` | v4.3.0 |
| `actions/github-script` | `f28e40c7f34bde8b3046d885e986cb6290c5673b` | v7.1.0 |
| `gitleaks/gitleaks-action` | `ff98106e4c7b2bc287b24eaf42907196329070c7` | v2.3.9 |
| `lycheeverse/lychee-action` | `8646ba30535128ac92d33dfc9133794bfdd9b411` | v2.8.0 |
| `supabase/setup-cli` | `b60b5899c73b63a2d2d651b1e90db8d4c9392f51` | v1.6.0 |

Update procedure: when bumping an action, resolve the new tag's underlying
commit SHA via `gh api repos/<org>/<action>/git/ref/tags/<tag>` and replace
both the SHA and the trailing comment in a single commit.

## Verification

Local: `actionlint .github/workflows/*.yml` passes clean post-change
(actionlint 1.7.12).

Post-merge spot check: download the `nextjs-build` artifact from any CI
run and verify the test-Supabase credentials no longer appear:

```bash
gh run download <run-id> -n nextjs-build -D /tmp/check
grep -r "TEST_SUPABASE_URL\|test-supabase\|qmnijlgmdhviwzwfyzlc" /tmp/check/.next/ | wc -l
# expected: 0
```

A non-zero count would mean the rebuild step ran on the artifact-uploaded
path (a regression) — reopen C-0293(c).
