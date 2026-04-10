# ADR-0014: Secret handling -- env vars, Postgres GUCs, and KEK encryption for exchange keys

## Status
Accepted (retroactively documenting existing decision)

## Context
Secrets are managed via a mix of Vercel env UI, Railway env UI, Postgres
GUCs, and HMAC-at-rest for payload tokens. The KEK (Key Encryption Key)
envelope encryption story for exchange API keys is sophisticated but only
documented in plan files. There is no runbook for key rotation.

## Decision
Three classes of secrets exist, each with a defined management pattern:

### Class 1: Platform secrets
Secrets for third-party SaaS integrations.

| Secret | Provider | Rotation |
|--------|----------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase | Project-scoped, rarely rotated |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase | Via Supabase dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase | Via Supabase dashboard |
| `RESEND_API_KEY` | Resend | Via Resend dashboard |
| `UPSTASH_REDIS_REST_URL` | Upstash | Via Upstash dashboard |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash | Via Upstash dashboard |

**Management**: Set in Vercel env UI (frontend) and Railway env UI
(analytics service). Rotate via the respective provider dashboards.

### Class 2: Service-to-service secrets
Secrets for internal service communication.

| Secret | Used by | Auth mechanism |
|--------|---------|---------------|
| `ANALYTICS_SERVICE_KEY` | Next.js -> FastAPI | `X-Service-Key` header |
| `CRON_SECRET` | Vercel Cron -> Next.js | `Authorization: Bearer` header |
| `HMAC_SECRET` | Demo PDF token signing | HMAC-SHA256 |

**Management**: Set in Vercel + Railway env UIs. Rotation requires
updating both sides simultaneously (or a short grace period where both
old and new values are accepted).

**Postgres GUC pattern** (approved alternative): For DB-originated calls,
secrets can be stored as Postgres GUCs via
`ALTER DATABASE postgres SET app.analytics_service_key = '...'` and read
with `current_setting('app.analytics_service_key', true)`. This keeps the
secret out of application env vars entirely. Used by pg_cron in migrations
013 and 015.

### Class 3: Data protection secrets
Secrets that protect user data at rest.

| Secret | Purpose | Storage |
|--------|---------|---------|
| `KEK` | Key Encryption Key for exchange API keys | Railway env var |
| `KEK_VERSION` | Tracks which KEK version encrypted each row | Railway env var + DB column |

**Envelope encryption**: Each exchange API key row has a per-row DEK
(Data Encryption Key) encrypted by the KEK. The `KEK_VERSION` column
enables key rotation: new writes use the current KEK version, old rows
can be re-encrypted in a batch migration.

**Management**: The original plan specified HashiCorp Vault for KEK
storage; the shipped implementation uses Railway env vars. This is an
accepted tradeoff for v1 but should be revisited if the number of
encrypted records or compliance requirements grow.

### Rotation runbook (open item)
A rotation runbook should be created for each class, covering:
- How to rotate without downtime
- Grace period for old values
- How to verify the new secret is active
- KEK rotation procedure (re-encrypt existing rows)

## Consequences

### Positive
- Three clear classes make it possible to write a rotation runbook.
- The Postgres GUC pattern is documented as an ADR-approved alternative,
  preventing ad-hoc secret storage mechanisms.
- KEK_VERSION column enables future key rotation without data loss.

### Negative
- KEK rotation is an open question -- the column exists but no
  re-encryption procedure is documented.
- Env-var secrets appear in shell history for any developer who exports
  them locally. The GUC pattern avoids this for DB-originated calls.

## Evidence
- `.env.example` (lines 1-33): 15+ secrets declared.
- Admin client: `src/lib/supabase/admin.ts` (line 5) -- service role key.
- CRON_SECRET: `src/app/api/cron/warm-analytics/route.ts` (line 39),
  `src/app/api/alert-digest/route.ts` (line 22).
- HMAC_SECRET: `src/lib/demo-pdf-token.ts`.
- Postgres GUC pattern: `supabase/migrations/013_cron_heartbeat.sql`
  (lines 144-151).
- Envelope encryption: `analytics-service/services/encryption.py`.
- KEK schema: `supabase/migrations/001_initial_schema.sql` (line 19).
- Analytics service key: `src/lib/analytics-client.ts` (line 2).
