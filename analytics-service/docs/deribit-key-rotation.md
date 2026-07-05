# Deribit LTP Key Rotation — Post-Onboarding Runbook (Phase 72, SC-4)

**Audience:** the founder, after the 3 LTP Deribit accounts (LTP056, LTP068, LTP016)
are onboarded and their track records accepted.

**Why rotate:** during v1.7 (phases 67–72) each LTP account's read-only OAuth key
(`client_id` / `client_secret`) was provisioned into the Railway worker environment
(`DERIBIT_CLIENT_ID_1..3` / `DERIBIT_CLIENT_SECRET_1..3`) and exercised by live probe
runs and the ground-truth/acceptance harnesses. Those secrets were **never committed to
git** (verified: `git log -S DERIBIT_CLIENT_SECRET` is clean; they live only in Railway
env). Even so, a credential that has been read into multiple runtime contexts and
harness runs should be rotated once its job is done — standard hygiene for a shared/tested
secret, and it cleanly severs the worker-probe key from the live production ingestion key.

## What the keys can and cannot do

Every LTP key is **read-only** — scopes `trade:read account:read wallet:read
custody:read block_trade:read` (verified P67/P68; `account:read` present, no `trade:` write,
no `wallet:withdraw`). A leaked read-only key exposes account history and balances but
**cannot trade, transfer, or withdraw**. Rotation is hygiene, not incident response —
unless you suspect the secret leaked, in which case rotate immediately.

## Rotation steps (per account, ×3)

1. **Deribit console** → log in to the LTP account → *Account → API* (https://www.deribit.com/account/BTC/api).
2. **Create a new API client** with the SAME read-only scopes only:
   `account:read wallet:read trade:read` (do NOT grant `trade`, `wallet:withdraw`,
   `block_trade` write, or `custody` write). Deribit shows the new `client_id` /
   `client_secret` **once** — copy both.
3. **Re-point production ingestion** to the new key. Production reads the key from the
   `api_keys` row created at onboarding (envelope-encrypted; the plaintext never leaves
   Deribit → the wizard's server-side validate/encrypt). To rotate the live key:
   - In the Quantalyze app, open the strategy's key (API-key manager) and **reconnect /
     replace** the key with the new `client_id` / `client_secret`, OR
   - delete + re-add via the wizard (the strategy keeps its history; only the credential
     changes).
4. **Update the Railway worker probe env** (only if you keep running harnesses against
   these accounts): set the new values on the `quantalyze-analytics` service —
   `DERIBIT_CLIENT_ID_N` / `DERIBIT_CLIENT_SECRET_N` (N = 1/2/3). Never put them in a
   tracked file; Railway env only.
5. **Revoke the OLD API client** in the Deribit console (delete it). This is the step that
   actually retires the exposed secret — creating a new key does not invalidate the old one.
6. **Verify**: trigger a sync on the reconnected strategy and confirm it completes clean
   (`sync_status = completed`, dailies still span the account's date range). If the old key
   was the only one and you revoked it before re-adding the new one, the sync will fail
   with an auth error until step 3 completes — do 3 before 5 to avoid a gap.

## Order (safe)

For each account: **create new key (2) → re-point production (3) → update probe env (4) →
verify (6) → revoke old key (5).** Revoke last so a mistake in steps 2–4 never leaves the
account without a working read-only key.

## After all three

- Confirm no `DERIBIT_CLIENT_*` value in Railway env is an old (revoked) secret.
- The acceptance harness (`scripts/deribit_acceptance.py`) can be re-run against the
  reconnected strategies to confirm the new keys read identical history.
