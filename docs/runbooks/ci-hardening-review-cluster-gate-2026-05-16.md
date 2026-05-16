# Review-cluster gate report — PR #179 (CI security hardening)

Companion to [`ci-hardening-permissions-c0293.md`](./ci-hardening-permissions-c0293.md).

**Date**: 2026-05-16
**Branch**: `chore/ci-security-hardening-2026-05-16`
**PR**: https://github.com/AI-Isaiah/Quantalyze/pull/179
**Version**: 0.22.40.4
**Outcome**: **PASS** — zero in-scope code changes required; 4 follow-ups
deferred to backlog.

## Why this report exists

Per project policy ("always run the review cluster that we did in the
worktrees before any /land-and-deploy for tech-debt PRs"), this PR
underwent a worktree-style review cluster gate AFTER /ship landed the
core hardening commits and BEFORE /land-and-deploy. This report records
what the cluster examined, what it found, and why every finding is
either resolved or deferred.

## Scope

This PR closes audit-2026-05-07 finding **C-0293** (red-team CHAIN:
mutable action tags + missing permissions + NEXT_PUBLIC artifact leak).
Diff: 4 workflow files + 1 audit-trail doc.

The standard 6-specialist suite doesn't fully apply to a YAML-only PR.
The cluster ran the 4 lenses that DO apply (security, code-reviewer,
pr-test-analyzer, performance), plus a focused supply-chain red-team
pass.

## Specialist findings summary

| Lens | Findings | Severity breakdown | Action |
|------|----------|--------------------|--------|
| security (PRIMARY) | 6 | 6 info | none — clean baseline |
| code-reviewer | 4 | 4 info | none — clean baseline |
| pr-test-analyzer | 3 | 1 info, 2 medium | both medium DEFERRED |
| performance | 3 | 3 info | none — within historical envelope |
| red-team | 10 | 7 info, 2 medium, 1 low | all medium/low DEFERRED |

**Total**: 26 findings.

- 0 CRITICAL
- 0 HIGH
- 0 in-scope MED conf≥8 requiring a fix
- 4 medium findings deferred (would expand PR scope or require new infra)

## Stage 1 specialist highlights

### security (PRIMARY)

- **SHA verification: 100% match** — all 10 unique pins verified
  against upstream via `gh api repos/<org>/<action>/git/ref/tags/<vX.Y.Z>`.
  Every pin resolves to a `commit` object (not annotated-tag indirection):

  | Action | Pinned SHA | Tag |
  |--------|-----------|-----|
  | actions/checkout | 34e114876b0b11c390a56381ad16ebd13914f8d5 | v4.3.1 |
  | actions/setup-node | 49933ea5288caeca8642d1e84afbd3f7d6820020 | v4.4.0 |
  | actions/cache | 0057852bfaa89a56745cba8c7296529d2fc39830 | v4.3.0 |
  | actions/upload-artifact | ea165f8d65b6e75b540449e92b4886f43607fa02 | v4.6.2 |
  | actions/download-artifact | d3f86a106a0bac45b974a628896c90dbdf5c8093 | v4.3.0 |
  | actions/setup-python | a26af69be951a213d495a4c3e4e4022e16d87065 | v5.6.0 |
  | actions/github-script | f28e40c7f34bde8b3046d885e986cb6290c5673b | v7.1.0 |
  | gitleaks/gitleaks-action | ff98106e4c7b2bc287b24eaf42907196329070c7 | v2.3.9 |
  | lycheeverse/lychee-action | 8646ba30535128ac92d33dfc9133794bfdd9b411 | v2.8.0 |
  | supabase/setup-cli | b60b5899c73b63a2d2d651b1e90db8d4c9392f51 | v1.6.0 |

- **Permissions audit**: all 4 workflows declare
  `permissions: contents: read` at workflow level. Per-job uplifts are
  minimal and justified (gitleaks: `pull-requests: write`; nightly
  auto-issue jobs: `issues: write`). No `contents: write`,
  `actions: write`, or `id-token: write` anywhere.

- **NEXT_PUBLIC trace**: end-to-end verified —
  - Path 1 (placeholder build → artifact): `ci.yml:184-185` literal
    placeholder env, `ci.yml:197-213` upload step. The `.next/**`
    contains only placeholder strings inlined at build time.
  - Path 2 (seed-gated rebuild → never uploaded): `ci.yml:640-669`
    conditionally rebuilds with real env, stays on runner FS.
  - Path 3 (source-code leak via console.log): only `csrf.ts:25` emits
    `NEXT_PUBLIC_SITE_URL` (non-secret public URL). Zero matches for
    `console.* NEXT_PUBLIC_SUPABASE_*` across `src/**`.

- **Injection surface**: no `github.event.*` flows into any `run:`
  shell substitution. `sql-tests` fork-author gate
  (`github.event.pull_request.head.repo.full_name`) sits in YAML
  expression context (workflow-parse time), never in shell
  substitution. Defense-in-depth meta-command preflight rejects
  `\!`, `\copy`, `\COPY`, `\o` in SQL test files.

- **Workflow coverage**: all 4 workflow files are touched by this PR.
  No untouched workflow harbors the same C-0293 vulnerabilities.

- **Residual mutable tags**: zero `@v<N>` pins across all workflows.

### code-reviewer

- `actionlint 1.7.12` passes clean on all 4 workflows.
- `needs:` chains, `if: always()` aggregator pattern, matrix shard
  strategy — all preserved post-hardening.
- `on:` triggers unchanged.

### pr-test-analyzer

- No drift between `docs/runbooks/ci-hardening-permissions-c0293.md`
  and the workflow files.
- Two MED findings DEFERRED — see Stage 3 below.

### performance

- SHA-pinning does NOT add cold-start overhead vs tag-pinning.
- NEXT_PUBLIC rebuild adds ~30-60s ONLY on seed-gated runs.
- Current run wall-clock within historical envelope (frontend-build
  1m24s, e2e 2m1s).

## Stage 2 red-team highlights (10 scenarios)

- **Pinned versions trail upstream latest by 1-3 majors** (checkout
  v4.3.1 vs upstream v6.0.2; setup-node v4.4.0 vs v6.4.0;
  upload-artifact v4.6.2 vs v7.0.1; cache v4.3.0 vs v5.0.5). MED
  conf=7. DEFER: enable Dependabot for `github-actions` ecosystem.
- `pull_request_target` is NOT used anywhere — clean.
- No reusable workflows (`uses: ./...` returns 0 matches) — no
  callee gap.
- Permissions bypass via `if:` race — not exploitable; permissions
  are declared per-job, `if:` gates whether the job runs at all.
- NEXT_PUBLIC fix verified COMPLETE end-to-end.
- SHA force-push detection blindspot — known limitation of pinning;
  out-of-band threat, not C-0293 scope.
- supabase-migrate `plan` job lacks environment gate — read-only,
  intentional design (contributors WANT to see the diff before
  approving the apply).
- phase-19-stability hourly cron exposes test-project service-role —
  bounded to test project (qmnijlgmdhviwzwfyzlc), acceptable risk.

## Stage 3 apply — zero in-scope changes

All HIGH conf≥7 / MED conf≥8 findings are either already-clean or
deferred to follow-up backlog. Specifically:

| Finding | Severity | Conf | Disposition | Why deferred |
|---------|----------|------|-------------|--------------|
| SHA-pin enforcement gap (no CI check rejects new `@v<N>` pins) | MED | 8 | DEFER | New workflow step, not a fix to the 4 hardened files. |
| No automated artifact-content gate | MED | 7 | DEFER | New post-upload step, doubles artifact transfer cost — requires deliberate design. |
| Pinned versions trail upstream | MED | 7 | DEFER | Solved via Dependabot for `github-actions` ecosystem (separate PR). |
| Upstream SHA force-push detection | LOW | 7 | DEFER | Out-of-band threat; needs attestation/Sigstore infrastructure. |

## Stage 4 verification

- `actionlint .github/workflows/*.yml` — exit 0, no output
- 10 unique SHA pins, all `[a-f0-9]{40}`
- `gh pr view 179 --json mergeable -q .mergeable` — `MERGEABLE`
- `gh pr checks 179` — 15/15 PASS

## Stage 5 push

This commit (`docs(ci): review-cluster gate report`) records the gate
report alongside the C-0293 audit trail. No re-watch of CI needed —
this PR is documentation-only on top of an already-green branch.

## Decision

**`ci-hardening-review-gate: PASS`** — PR #179 is gated and ready for
`/land-and-deploy`.
