# Phase 72 — LTP Onboarding & Acceptance Verification (CONTEXT)

**Milestone:** v1.7 Deribit Exchange Coverage & Carry-Forward Burn-Down (final phase).
**Goal:** The founder's 3 LTP Deribit accounts are live as 3 SEPARATE verified track
records, proven correct against exchange truth — the milestone's end-to-end canary.
**Depends on:** P69 (wizard), P70 (ingestion+dailies), P71 (positions) — all SHIPPED+LANDED.

## Success criteria (ROADMAP) and how P72 satisfies each

1. **LTP056 (Aug–Sep 2025), LTP068 (Sep–Nov 2025), LTP016 (Dec 2025–Apr 2026) live as 3
   separate verified strategies, each with a factsheet.** → **FOUNDER-GATED live canary.**
   Onboarding is a founder UI-wizard action (see Decision D-1). Prod `api_keys` currently
   has ZERO deribit rows (verified 2026-07-05) → this is a fresh onboarding.

2. **Acceptance gates: trade counts match known totals, funding reconciles to daily
   settlements, inverse-P&L signs verified.** → acceptance-verification harness (SC-2).
   ⚠️ **P70-corrected reality:** the literal counts 18,778 / 21,014 / 61,248 count
   FILLS/LEGS and **reconcile to NO API surface** (Wave-0 BLOCKING_FINDING; see
   `deribit-ingestion-design.md:123`, `test_deribit_ingest.py:761`). They are an
   **advisory** cross-check only. The pipeline's honesty anchor is **txn-log/settlement
   ledger completeness over the date range** (`assert_ledger_complete`, enforced in-sync).
   So the acceptance gate = {ledger completeness clean, funding→settlement reconcile,
   inverse-P&L signs correct}; fill-count is logged, never gated.

3. **Secrets via env/Keychain only — no tracked file ever contains a credential (repo scan
   clean).** → **SATISFIED.** Verified NO Deribit secret ever committed to git history
   (`git log -S DERIBIT_CLIENT_SECRET` clean; keys live only in Railway env
   DERIBIT_CLIENT_ID/SECRET_1..3). The CI gitleaks gate is a RANGE scan (ci.yml:809-824),
   so my P72 diff is scanned; I range-scan my own commits before ship. 3 pre-existing
   entropy FPs (`on_conflict='match_key'` in job_worker.py / backfill_funding.py /
   test_funding_backfill_idempotency.py @ commit de04f420, 2026-04-16, pre-Deribit) are
   OUT OF SCOPE: benign, don't gate CI (outside any P72 range), and allowlisting a
   production source file would violate .gitleaks.toml's narrow-allowlist philosophy.

4. **Founder receives a post-onboarding key-rotation recommendation.** → SC-4 doc.

## Decisions

- **D-1 (onboarding mechanism) — UPDATED per founder instruction 2026-07-05
  ("use /qa and the keys stored in railway, to test the full onboarding of keys when
  needed"):** I drive the **full onboarding via /qa browser automation against prod
  (quantalyze.xyz)**, using the 3 read-only keys from Railway env
  (`DERIBIT_CLIENT_ID_1..3` / `DERIBIT_CLIENT_SECRET_1..3`) pasted into P69's Deribit
  wizard card (Client ID→api_key, Client Secret→api_secret, no passphrase). This exercises
  the exact product path P69 shipped end-to-end AND produces the 3 real verified strategies
  (SC-1). Secret handling: fetch plaintext only at onboarding time, paste via the browser
  form (server-side validate+envelope-encrypt), NEVER echo in visible output, NEVER commit
  evidence containing a secret (reuse deribit_ground_truth.py sanitize/redact); keys are
  read-only and rotated immediately after per SC-4. Choice of a founder-manual wizard vs a
  worker provisioning script is now moot — /qa is the driver.
- **D-2 (acceptance anchor):** completeness + reconciliation, NOT fill-count reconciliation
  (per P70; see SC-2 above). Fill-count is advisory/logged.
- **D-3 (SC-3):** verify + document; do NOT broaden the gitleaks allowlist for unrelated
  pre-existing FPs.

## Autonomous deliverables (this phase's code, shippable now)

- **SC-2 harness** — `analytics-service/scripts/deribit_acceptance.py`: given the 3 onboarded
  strategy IDs, emits a per-account PASS/FAIL acceptance report (date-range coverage, sync
  completeness, funding→settlement reconcile, inverse-P&L sign check, advisory fill-count).
  Pure reconciliation/sign-check logic unit-tested with fixtures; thin live driver.
- **SC-4 doc** — `analytics-service/docs/deribit-key-rotation.md`: post-onboarding rotation
  runbook for the founder.
- **SC-3** — verification (above) + this CONTEXT documents the residual FPs.

## Founder-gated canary (SC-1) — the milestone's completion step

After the code lands: founder onboards the 3 keys via the prod wizard → I run
`deribit_acceptance.py` against the 3 strategies → confirm gates green → founder rotates
the 3 Deribit read-only keys per the SC-4 runbook. Only then is v1.7 truly complete
(Rule 12: "complete" is false if SC-1 isn't actually done).
