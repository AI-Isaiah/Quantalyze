# Workflow Security Baseline (B24)

**Status:** enforced by construction as of B24 (2026-05-30).
**Test:** `src/__tests__/critical-regressions.test.ts` →
`[CRITICAL-C0293] CI hardening invariants`.
**Companion:** `ci-hardening-permissions-c0293.md` (the original
per-permissions writeup; this doc generalises it to the whole posture).

B24 closes the class "a GitHub Actions workflow silently drifts from the
security baseline" by turning the baseline into a CI-enforced invariant that
**discovers every workflow dynamically** — so the gate can no longer be
out-of-date with the set of workflows it guards.

## The root cause this batch fixed

The SHA-pin / permissions guards already existed — but they iterated a
**hardcoded list of six workflow files**. `cassette-refresh.yml` was added to
the repo *after* that list was written and was never added to it, so its two
unpinned actions (`actions/checkout@v4`, `peter-evans/create-pull-request@v7`)
were never checked. *The static list was itself the gap.*

The fix: the guard now derives `WORKFLOW_FILES` from
`readdirSync('.github/workflows')`. Any current or future workflow is held to
the full baseline automatically. A fail-loud sentinel test asserts the glob
returns ≥ 8 files and contains the known-critical workflows, so a broken glob
or a deleted workflow can't make the per-file loops vacuously pass.

## The invariants (asserted for every discovered workflow)

| Invariant | Rule |
|---|---|
| **SHA-pin** | every `uses:` references a 40-char lowercase-hex SHA — never a mutable tag (`@v4`, `@main`) or partial SHA. First-party `./…` reusable workflows exempt (none today). |
| **Top-level permissions** | exactly one top-level `permissions:` block, including `contents: read`, so a missing/typo'd block can't inherit the repo-default write token. |
| **persist-credentials** | every `actions/checkout` sets `persist-credentials: false` — *except* `PERSIST_CRED_EXEMPT` workflows that legitimately push (see below). |
| **Concurrency** | every workflow triggered by `pull_request` or `push` declares a top-level `concurrency:` group. Schedule-/`workflow_dispatch`-only workflows are exempt. |
| **No YAML anchors/aliases** | the source-text SHA-pin assertion does not dereference anchors; they're banned defensively until a YAML-AST walker lands. |

### persist-credentials exemption

`cassette-refresh.yml` is in `PERSIST_CRED_EXEMPT`. It records broker cassettes
and opens an auto-PR via `peter-evans/create-pull-request`, which needs the
persisted `GITHUB_TOKEN` to `git push` the PR branch. Dropping the credential
would break that push. It is exempt from the persist-credentials rule **only**
— it is still held to SHA-pin, permissions, and (because it's not PR/push
triggered) is correctly not required to declare concurrency, though it does.

### Concurrency exemption

`nightly.yml` and `phase-19-stability.yml` are `schedule` + `workflow_dispatch`
only. Overlapping scheduled runs are rare and their jobs (issue-dedup, probes,
`npm audit`) are idempotent, so concurrency is not required. `cassette-refresh`
and `supabase-migrate` declare concurrency despite being schedule/dispatch
because two refresh/`db push` runs racing on the same branch would conflict.

## Content fixes shipped in B24

- **Pinned the two stragglers** in `cassette-refresh.yml`:
  `actions/checkout@v4` → `…34e11487… # v4.3.1`,
  `peter-evans/create-pull-request@v7` → `…22a90890… # v7.0.11`.
  Surgical pin (no version bump) — the action versions are unchanged.
- **`nightly.yml` fail-loud canary (H-1026 / B23 M-0849).** A missing
  `DEMO_PDF_SECRET` while the canary is enabled (`STAGING_BASE_URL` set, so the
  preflight gate already passed) previously `::warning::`d and `exit 0`d —
  greening the job and skipping the `if: failure()` issue path. A rotated/lost
  secret silently disabled the cold-start canary. Now it emits `::error::` and
  `exit 1`, so the dedup'd `nightly-canary-failure:pdf-coldstart` issue is filed
  and a maintainer is paged.

## Reverify notes — findings already closed before B24 (NOT re-fixed)

These FIX-LIST entries were verified closed against current `main` while scoping
B24; they are reverify-closed, not B24 work:

- **M-0852 / M-0854** (`nightly.yml` STAGING_BASE_URL guard) — closed by C-0294:
  the guard is now single-source in a `preflight` job with a proper
  `tr -d '[:space:]'` trim *before* any expensive setup; downstream jobs gate on
  its output. No more enumerative `!= ' '` check, no triple-duplication.
- **G23-193-mig-03** (`migration-policy.yml` fork-PR fail-open) — closed by the
  retro-PR193-M-3 fix: secrets-missing + migrations-in-diff now fails CLOSED.
- **G23-193-mig-04** (reject-path test) — closed: `migration-policy-self-test.yml`
  exercises the reject / malformed / mixed branches (Cases 4–6), and the
  retro-PR193-M-4 source-text guard pins the algorithm literals.
- **M-1015** (`supabase-migrate.yml` silent CLI success) — mitigated by C-0331:
  post-`db push`, `migration list --linked` is cross-checked and the job fails on
  any "Reverted" row. The plan job already `--dry-run`s the exact command.

## Deferred (with rationale)

- **M-1017 — destructive-migration → paired-rollback CI guard.** Not built. A
  gate that detects destructive DDL (`DROP`/`ALTER … DROP`) and requires a paired
  `supabase/migrations/down/` file is a new, false-positive-prone enforcement
  feature (legitimate migrations drop/alter constantly), it is not an open
  enumerated FIX-LIST finding, and a `down/` convention already exists. It
  deserves its own scoped batch, not a B24 bolt-on.

## Out-of-class for B24 (kept in FIX-LIST)

- **H-1024 / H-1025 / L-0062** (`ci.yml`) — the E2E "all user groups" coverage gap
  + docs-link-check contract. These belong to the deferred Playwright +
  seeded-staging E2E lane, not the workflow-security posture. Untouched here.

## Follow-up (not blocking)

- `cassette-refresh.yml` pins `actions/checkout` at **v4.3.1**, while the rest of
  the repo standardises on **v6.0.2**. Pinning closed the security finding;
  aligning the version is a separate change (a v4→v6 bump can't be verified in
  this PR's CI — cassette-refresh only runs on schedule/dispatch).
