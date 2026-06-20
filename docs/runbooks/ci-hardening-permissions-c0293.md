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
| `npm-audit` | `contents: read` + `issues: write` | The `failure()` path files an auto-issue when `npm audit --audit-level=high` finds a new advisory. |

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
| `check` | (inherits default) | Hourly cron runs `scripts/verify-no-legacy-writes.sh` against the **production** Supabase project (`khslejtfbuezsmvmtsdn`) via the read-only `phase19_soak_status` RPC, authenticated with the prod ANON key (`PROD_SUPABASE_*` secrets) — not a service_role key. No GitHub API surface. |

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

## Automated regression gates (per-PR)

`src/__tests__/critical-regressions.test.ts` includes a
`[CRITICAL-C0293] CI hardening invariants` describe block that runs in
every PR's `frontend-test` job. Each invariant catches a specific
regression class at the test layer — no CI runner round-trip needed.

| Invariant | Source | Failure mode caught |
|-----------|--------|---------------------|
| Every `uses:` is a 40-char SHA | retro-PR179-H2 | Mutable tag reintroduced (e.g. `@v4`) re-opens the tj-actions class. |
| Workflow-level `permissions: contents: read` | retro-PR179-H2 | A new workflow inherits the repo default (write-on-everything). |
| `frontend-build` env uses placeholder NEXT_PUBLIC_* values | retro-PR179-H3 | A "re-optimize" PR re-adds the seed-aware ternary that uploads real creds. |
| `frontend-build` env contains no `secrets.TEST_SUPABASE_*` | retro-PR188-F1 | URL banned originally; ANON_KEY + SERVICE_ROLE_KEY now also banned (F1 widened the prefix). |
| Seed-gated rebuild step has its required shape | retro-PR179-H4 | A drift in the wipe list or env wiring silently breaks Path 2. |
| `Upload Playwright report on failure` is gated against seed-gated | retro-PR188-F2 | A "let me see traces on every failure" revert re-opens the trace-zip exfil pivot. |
| Every `actions/checkout` sets `persist-credentials: false` | retro-PR188-F3 | A new checkout step inherits the persisted GITHUB_TOKEN attack surface. |
| `supabase-migrate.yml` plan + apply both set `environment: Production` | retro-PR188-F4 | A rebase drops the plan-side env gate; SUPABASE_DB_PASSWORD bypasses approval. |
| No YAML anchors/aliases at value position in workflow files | retro-PR188-F8 | A future PR uses `&name` / `*name` to indirect a `uses:` past the SHA-pin regex. |
| Exactly one top-level `permissions:` block per workflow | retro-PR188-F10 | A split block (top-level + per-job same-key) causes silent default fallback. |
| `frontend-build` upload sets `include-hidden-files: true` | retro-PR179-M (#20/#21) | A `with:` drop silently excludes `.next/`; e2e crashes. |

## Enforcement gaps (deferred)

The following hardening items were flagged by the PR #188 retroactive
specialist audit but are NOT applied here — they require separate
scope or design work. Until landed, these protections depend on human
review of the YAML diff.

- **SHA-drift detection cron** (red-team #28, MEDIUM/8). A nightly
  `gh api repos/<org>/<action>/git/ref/tags/<tag>` probe that fails
  when any pinned SHA no longer resolves to the documented tag.
  Catches upstream force-push or org takeover within 24h. Deferred:
  needs a `nightly.yml` job design + auto-issue routing.
- **Artifact-content runtime gate** (pr-test-analyzer #35, HIGH/9).
  A post-upload CI step that downloads the `nextjs-build` artifact in
  the same run and greps for `TEST_SUPABASE_*` / project ref. Deferred:
  the test-time placeholder-only invariant (F1) covers the source-text
  regression; the runtime grep would catch a buggy build that drifts
  the inlined values vs the source despite passing F1.
- **`supabase-migrate` plan-job password removal** (red-team #38,
  MEDIUM/9). The plan job currently consumes `SUPABASE_DB_PASSWORD`
  even though `supabase migration list` is read-only. Replacing it
  with `SUPABASE_ACCESS_TOKEN`-only auth would actually reduce the
  exposure surface (the current PR #188 fix only achieves plan/apply
  symmetry). Deferred: needs validation that the read-only flow works
  end-to-end with the pinned CLI version.
- **CRITICAL-C0293 file isolation** (red-team #43, MEDIUM/8). Moving
  the describe block to its own file
  (`src/__tests__/ci-hardening-invariants.test.ts`) would let it run
  in every vitest shard, hardening against a single-shard flake
  swallowing the gate. Deferred: depends on the project's vitest
  shard config which currently treats shards uniformly.
