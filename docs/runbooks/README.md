# Runbooks

Operational procedures for Quantalyze. Start with **Incident response** when
something is broken in prod; the rest are subsystem and one-off references.

For deploy semantics and the CI/prod invariants, see the repo
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Incident response (start here)

| Runbook | When |
|---------|------|
| [deploy-rollback.md](./deploy-rollback.md) | A deploy regressed prod — roll back Vercel / Railway / schema |
| [railway-worker.md](./railway-worker.md) | Analytics worker is stale, wedged, or stuck on old code (skipped-deploy gotcha) |
| [migration-failure.md](./migration-failure.md) | A migration broke prod, the apply workflow failed, or `schema_migrations` drifted |
| [sentry-triage.md](./sentry-triage.md) | Investigating a Sentry alert/error (EU region, deploy-lag, read-only MCP) |

## Subsystems

| Runbook | Subsystem |
|---------|-----------|
| [compute-queue.md](./compute-queue.md) | Durable compute-jobs queue |
| [match-engine.md](./match-engine.md) | Trade match engine |
| [bridge-outcome-cron.md](./bridge-outcome-cron.md) | Bridge outcome cron |
| [metrics-nan-policy.md](./metrics-nan-policy.md) | Metrics NaN handling policy |
| [posthog-wizard-funnel.md](./posthog-wizard-funnel.md) | PostHog wizard funnel dashboard |
| [vercel-cron-upgrade.md](./vercel-cron-upgrade.md) | Vercel cron scheduler |

## Security & compliance

| Runbook | Topic |
|---------|-------|
| [breach-notification.md](./breach-notification.md) | Data-breach notification |
| [security-contact.md](./security-contact.md) | Security contact / disclosure |
| [security-packet-update.md](./security-packet-update.md) | Security packet updates |
| [soc2-readiness.md](./soc2-readiness.md) | SOC 2 Type 1 readiness |
| [workflow-security-baseline-b24.md](./workflow-security-baseline-b24.md) | CI workflow security baseline |
| [ci-hardening-permissions-c0293.md](./ci-hardening-permissions-c0293.md) | CI permissions map (C-0293) |

## Historical / one-off (audit campaign + single deploys)

Point-in-time records kept for provenance; not live operating procedures.

- [deploy-mig-117-claim-token-fence.md](./deploy-mig-117-claim-token-fence.md) — migration 117 claim-token fence deploy
- [audit-canonical-integration-2026-05-17.md](./audit-canonical-integration-2026-05-17.md)
- [fix-list-reverify-2026-05-17.md](./fix-list-reverify-2026-05-17.md)
- [sql-migrations-coverage-2026-05-16.md](./sql-migrations-coverage-2026-05-16.md)
- [sql-migrations-redteam-2026-05-16.md](./sql-migrations-redteam-2026-05-16.md)
- [sql-migrations-review-cluster-2026-05-16.md](./sql-migrations-review-cluster-2026-05-16.md)
- [ci-hardening-review-cluster-gate-2026-05-16.md](./ci-hardening-review-cluster-gate-2026-05-16.md)
