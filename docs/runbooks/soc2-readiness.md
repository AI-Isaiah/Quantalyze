# SOC 2 Type 1 Readiness Checklist

An internal signal of where Quantalyze stands against the SOC 2 Type 1
control areas an allocator diligence team will ask about. This is NOT a
formal audit package — Type 1 requires a licensed auditor plus a 3-6
month observation window (Year-2 exercise at current scale). The table
below is a living checklist so we can point at concrete evidence when an
allocator asks, and so we know which gaps are still open.

Scope: the eight control rows below are the minimum an allocator risk
officer expects to see. Evidence links point at in-repo code, migrations,
runbooks, or CI config. Rows whose implementation ships later in this
sprint reference the sprint branch with a `PLANNED` status.

| Control | Owner | Evidence link | Status | Notes |
|---|---|---|---|---|
| Encryption at rest | Founder | [`supabase/migrations/004_kek_version.sql`](../../supabase/migrations/004_kek_version.sql), [`docs/architecture/adr-0014-secret-handling.md`](../architecture/adr-0014-secret-handling.md), [`src/app/security/page.tsx`](../../src/app/security/page.tsx) (§ Data handling) | READY | AES-256-GCM envelope encryption. Per-row DEK wrapped by a KEK held in Supabase Vault. Encrypted columns revoked from `anon`/`authenticated` Postgres roles (migration 027). |
| Encryption in transit | Founder | [`src/app/security/page.tsx`](../../src/app/security/page.tsx) (§ Encryption table, row 1), [`docs/architecture/adr-0017-deployment-topology.md`](../architecture/adr-0017-deployment-topology.md) | READY | TLS 1.3 at the edge (Vercel) and on service-to-service calls. HSTS enabled. No plaintext transport inside the trust boundary. |
| Access control / RBAC | Founder | [`docs/architecture/adr-0001-rls-primary-authorization.md`](../architecture/adr-0001-rls-primary-authorization.md), [`docs/architecture/adr-0005-admin-authorization.md`](../architecture/adr-0005-admin-authorization.md), [`supabase/migrations/002_rls_policies.sql`](../../supabase/migrations/002_rls_policies.sql) | IN_PROGRESS | Postgres RLS is the primary authorization layer. Admin routes gated by `withAdminAuth` wrapper. Task 7.2 (Sprint 6, branch `feat/sprint-6-bridge-security`) consolidates the three admin-check patterns onto `isAdminUser` + documents the matrix. |
| Audit logging | Founder | [`supabase/migrations/052_key_permission_audit.sql`](../../supabase/migrations/052_key_permission_audit.sql) | IN_PROGRESS | Per-key permission-probe audit rows already in prod. Task 7.1a (Sprint 6, branch `feat/sprint-6-bridge-security`) broadens this to an append-only admin-action audit table covering kill-switch, recompute, allocator-approve, intro-request, strategy-review. |
| Incident response | Founder | [`docs/runbooks/security-contact.md`](./security-contact.md), [`src/app/security/page.tsx`](../../src/app/security/page.tsx) (§ Breach notification) | READY | `security@quantalyze.com` alias documented end-to-end (MX / SPF / DKIM / DMARC + smoke test). 72-hour breach-notification SLA published on `/security` in line with GDPR Article 33. |
| Backup policy | Founder | [`docs/architecture/adr-0017-deployment-topology.md`](../architecture/adr-0017-deployment-topology.md) | GAP | Supabase Postgres PITR is available on the Pro plan but is not yet enabled on the production project. Enable PITR (retention: 7 days min) and record the activation date in this row before the first allocator diligence call. |
| Vulnerability scanning | Founder | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) (`secret-scan` + `npm audit --audit-level=critical` + banned-package check), [`scripts/check-banned-packages.mjs`](../../scripts/check-banned-packages.mjs), [`.gitleaks.toml`](../../.gitleaks.toml) | READY | Task 7.6 shipped on `feat/sprint-6-bridge-security`: gitleaks on every PR (full history on PRs via `fetch-depth: 0`), `npm audit` gated at `critical`, supply-chain banned-package allowlist. |
| Vendor management | Founder | [`docs/architecture/adr-0017-deployment-topology.md`](../architecture/adr-0017-deployment-topology.md) (Provider roles + Failure mode table), [`docs/architecture/adr-0014-secret-handling.md`](../architecture/adr-0014-secret-handling.md) (Class 1 secrets table) | IN_PROGRESS | Three subprocessors documented (Vercel, Railway, Supabase) with role and failure mode. DPAs on file with each. Formal subprocessor register + quarterly review cadence is a Year-2 task. |
| Change management | Founder | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml), [`docs/architecture/adr-0021-cicd-and-schedules.md`](../architecture/adr-0021-cicd-and-schedules.md) | READY | Every merge to `main` goes through CI (typecheck, lint, unit, `npm audit`, banned-package, gitleaks, E2E) and a PR review gate. Cron schedules version-controlled in `vercel.json` per ADR-0021. Supabase migrations are sequentially numbered and append-only. |

## Status vocabulary

- **READY** — evidence in-repo, control is operating, no known gap.
- **IN_PROGRESS** — control shipping on the current sprint branch; evidence link points at the branch / migration / doc that lands the work.
- **PLANNED** — committed for a named sprint but not yet on a branch.
- **GAP** — known gap with no owner or ship date yet. Must be resolved before a formal Type 1 engagement.

## What this doc is NOT

- A SOC 2 report or attestation. A real Type 1 requires a licensed CPA firm, a named auditor, a defined observation window, and ~$15-30k of budget.
- A substitute for the allocator-facing `/security` page or the downloadable security packet (`public/security-packet.pdf`). Those are the external-facing surfaces; this runbook is the internal checklist behind them.
- A list of every control an auditor will eventually test. The AICPA Trust Services Criteria has >60 points of focus. The rows above are the ones an allocator diligence team will actually ask about in a pilot conversation.

## Updating this doc

Add a new row only if the gap is unambiguous (e.g., we start offering SSO and need to track MFA enrollment). Otherwise, flip the Status and update the Evidence link as each row progresses. Keep the preamble short — detail lives in the ADRs and runbooks that the Evidence column points at.
