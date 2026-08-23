---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
verified: 2026-08-23T00:00:00Z
status: gaps_found
score: 30/32 must-have truths verified
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "After this landing the route serves NO ciphertext to any caller: absent-discriminator bodies receive a coded STALE_CLIENT refusal instead of the legacy ciphertext envelope, deployed in the same merge as the migration (plan 160-05)"
    status: failed
    reason: "The legacy ciphertext arm was NOT retired. `grep STALE_CLIENT src/app/api/keys/validate-and-encrypt/route.ts` returns nothing; route.ts:388-390 still returns `{ ...encrypted, valid: true, read_only: true }` to any body without the persist discriminator. 160-05-SUMMARY books this deviation honestly ('dead weight rather than a hole') and carries it forward, but the must_have truth and its artifact pattern (`contains: STALE_CLIENT`) are unmet at HEAD. Mitigation measured on PROD: the browser holds no INSERT on api_keys, so the arm can no longer mint a row — but ciphertext still round-trips to the browser on the legacy body shape, which is exactly what this truth forbade."
    artifacts:
      - path: "src/app/api/keys/validate-and-encrypt/route.ts"
        issue: "Legacy arm (route.ts:384-390) byte-unchanged; no STALE_CLIENT refusal exists"
    missing:
      - "Retire the legacy arm: absent-discriminator bodies get a coded STALE_CLIENT 4xx envelope; no response arm carries api_*_encrypted/dek_encrypted/nonce"
      - "Regression test: legacy-shaped body receives the refusal envelope and no ciphertext key appears in the response"
behavior_unverified_items:
  - truth: "The soak checkpoint confirms PR-1 merged + deployed + prod-smoked (plan 160-05 truth 1, 'prod-smoked' clause) — the production persist arm mints an attested api_keys row on a real connect"
    test: "On PROD (quantalyze.xyz), connect one API key through each converted surface — wizard key-add (ApiKeyManager), StrategyForm, AllocatorExchangeManager — or at minimum the wizard flow"
    expected: "Connect succeeds; the new api_keys row carries attested_venue = exchange (non-NULL); the response to the browser contains api_key_id and no ciphertext fields; the strategy link updates"
    why_human: "The four prod smoke flows in plan 160-05 Task 1 were NOT performed. Zero keys were connected during the 47-minute soak, so the soak measured only the ABSENCE of un-attested inflow. The writer has never handled a real production connect; code+test presence cannot substitute for the first live exercise of the now-ONLY writer of api_keys."
---

# Phase 160: PROVENANCE Verification Report

**Phase Goal:** No client-supplied venue can differ from the venue the server validated, and the √365/√252 annualization stamp derives from the server's attestation — without ever stamping √252 onto a crypto strategy through a NULL attestation.
**Verified:** 2026-08-23 (against HEAD `36e783de`, branch `chore/close-phase-160`; PR-1 `1911a5d5`, PR-2 `ae53d3cd` merged and live)
**Status:** gaps_found (1 failed must-have, 1 production behavior unverified — the phase GOAL itself is achieved, see below)
**Re-verification:** No — initial verification

## Goal Achievement — ROADMAP Success Criteria

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | B-M1 PROD census measured and committed as an EARLY artifact, count-pinned in the `20260811210000` discipline, gating the stamp swap and deciding B-D1 | ✓ VERIFIED | `160-CENSUS.md` committed with Q1/Q1b/Q2 (all zero un-attested; 31/31 rows `attested_venue = exchange` as the anti-vacuity control), hand-typed pins (`c_pin_unattested = 0`, `c_pin_total = 31`), mechanical B-D1 decision. Independently corroborated: orchestrator's post-apply PROD measurement (31 rows, 0 un-attested, 31/31 coherent) matches the census pins — the numbers describe PROD, not TEST. |
| SC-2 | Every INSERT path into `api_keys` writes the server-validated exchange; clients stop inserting; then REVOKE INSERT, deploy-first / revoke-second, every `.from("api_keys")` mutation grepped | ✓ VERIFIED | Persist arm in `validate-and-encrypt/route.ts` (admin INSERT, both `exchange` and `attested_venue` from the single `exchangeNormalized` binding, provenance keys spread LAST per WR-01 at :468-482). All THREE client sites converted (`persist: true` at ApiKeyManager.tsx:237, StrategyForm.tsx:139, AllocatorExchangeManager.tsx:577). Migration `20260823120000` in a separate second PR; PROD post-apply measured: anon/authenticated INSERT false, service_role INSERT true, DELETE retained. My own whole-repo re-grep at HEAD: zero browser-context `api_keys` INSERT chains (remaining hits are service-role test/seed contexts only). Caveat: never exercised by a real PROD connect — see behavior_unverified_items. |
| SC-3 | `asset_class` stamp derives from the attested venue, swap MOVES WITH the null-attestation guard extension; NULL never stamps `traditional`/√252 | ✓ VERIFIED | finalize-wizard/route.ts:1301 `skipAssetClassWrite = Boolean(apiKeyId) && attestedVenue === null`; :1337 `isCryptoExchange(attestedVenue)`; :1277 in-file ⛔ against `?? apiKeyExchange` and no coalescing exists in code (:1281-1283 uses a `typeof` narrowing, never falls back to the forgeable column). Guard is a strict superset of the lookup-fault guard (a faulted lookup leaves `attestedVenue` null → skip). Both changes in the same PR-1 commit set. |
| SC-4 | B-D2 oracle pins the ECONOMICS, never the implementation's expression; census-identified strategies get golden-parity treatment | ✓ VERIFIED | route.test.ts carries `adminApiKeysAttestedVenue` harness knob (17 refs) with literal fixtures (attested deribit ⇒ crypto, mt5 ⇒ traditional, NULL + resolved exchange ⇒ NO update captured). RED-first evidence in git: commit `e9ffb0eb` "Failing B-D2 oracles (RED gate)" precedes the swap; 160-04-SUMMARY records the neuter table with verbatim red assertions per cycle. Census Q2 = zero candidates ⇒ `160-PARITY.md` is the RECORDED no-op with the census line cited and the √(365/252) ≈ 1.2039 delta math pinned in advance. |

## Per-must_have verdicts

### Plan 160-01 — B-M1 census

| Truth | Status | Evidence |
|---|---|---|
| Census exists as committed artifact BEFORE stamp swap / writer / REVOKE | ✓ VERIFIED | `160-CENSUS.md` in repo; PR-2 diff shows the addendum landing with the migration, base census predates it |
| Measures un-attested rows since 2026-08-11 split by exchange, linkage (EXISTS, no fan-out), wizard_session_id | ✓ VERIFIED | Q1 (zero rows), Q1b (zero), split columns present; EXISTS-based linkage per Pitfall 9a note at CENSUS:156 |
| B-D1 threshold applied MECHANICALLY; empty Q2 ⇒ 160-06 recorded no-op | ✓ VERIFIED | CENSUS:215-226; PARITY.md executes exactly that consequence |
| Hand-typed pins in 20260811210000 discipline, ready for the PR-2 guard | ✓ VERIFIED | CENSUS pin table (:250-252) → migration constants `c_pin_unattested=0`, `c_pin_total=31`, `c_pin_dates` — transcription matches |
| (backstop) Numbers produced read-only against PROD `khslejtfbuezsmvmtsdn`, never TEST | ✓ VERIFIED | Explicit exogenous evidence: the orchestrator's independent post-apply PROD measurement (31/0/31-coherent) reproduces the census numbers; TEST holds ~3,540 rows with ~1,200 un-attested (per migration header, measured) — the census numbers are incompatible with TEST |
| PROHIBITION: no PII in artifact | ✓ RESPECTED | Email-shaped-token grep of CENSUS + PARITY: 0 hits; no email/uid/user_name columns in pasted tables |
| PROHIBITION: census SQL performs zero mutations | ✓ RESPECTED | `grep -inE '^\s*(insert|update|delete|alter|create|drop|truncate) '` over CENSUS: 0 hits |

### Plan 160-02 — persist arm + ApiKeyManager

| Truth | Status | Evidence |
|---|---|---|
| Persist-mode writes row server-side, both venue columns from `exchangeNormalized` | ✓ VERIFIED | route.ts:479-482 — insert literal sets `exchange: exchangeNormalized, attested_venue: exchangeNormalized` after the ciphertext spread (WR-01 order enforced at HEAD `36e783de`) |
| Persist response carries `api_key_id` and NO ciphertext | ✓ VERIFIED | route.ts:519 `{ api_key_id: inserted.id, valid: true, read_only: true }`; test at route.test.ts:459-467 asserts response excludes `dek_encrypted/nonce/api_*_encrypted` |
| ApiKeyManager no longer INSERTs; consumes `api_key_id`; link update + DELETE byte-preserved | ✓ VERIFIED | `persist: true` at :237; repo grep finds no insert chain in the component; ApiKeyManager.test.tsx:530 pins the property ("restore a client insert and the assertions redden"); DELETE path retained (migration anti-overreach 4b guards it too) |
| Strict-boolean discriminator; legacy bodies never hit the persist arm | ✓ VERIFIED | route.ts:216 `body.persist === true`; tests at :1225 (legacy envelope, ZERO rows) and :1254 (parameterized non-boolean values are NOT the discriminator) |
| Divergent exchange/attested_venue impossible at writer AND by DB CHECK | ✓ VERIFIED | Single binding at the writer; CHECK `api_keys_attested_venue_matches_exchange` (20260811210000) confirmed intact by migration post-verify + SQL gate assertion |
| Missing/unrecognized exchange or credentials ⇒ coded 4xx, no row; absent label ⇒ server default | ✓ VERIFIED | Route validation precedes the persist arm; 569-line test file covers the arms (ran green through merged main CI — advisory-at-merge caveat noted) |
| (backstop) Failed INSERT / lost response ⇒ no ciphertext exposed, no partial row | ✓ VERIFIED | The write is one `.insert()` statement; the persist error arm (route.ts:495-512) returns a coded envelope and the no-ciphertext-on-error assertion exists in route.test.ts |
| PROHIBITION: no persist-mode response on any arm carries ciphertext | ✓ RESPECTED | Test-asserted (route.test.ts:459-467); grep of persist-arm `NextResponse.json` payloads shows none |
| PROHIBITION: no new arm logs raw key material | ✓ RESPECTED | Both new catch paths pass `scrubSeamError(err, perRequestSecrets)` and `captureToSentry(..., { secrets: perRequestSecrets })` (route.ts:438-450, 495-512) |

### Plan 160-03 — StrategyForm + AllocatorExchangeManager + SQL gate

| Truth | Status | Evidence |
|---|---|---|
| All THREE client INSERT sites converted before any REVOKE | ✓ VERIFIED | Three `persist: true` call sites; PR-1 (#703) merged before PR-2 (#704) which alone carries the REVOKE |
| Allocator re-fetches via `API_KEY_USER_COLUMNS` allowlist | ✓ VERIFIED | AllocatorExchangeManager.tsx:38 import, :605 `.select(API_KEY_USER_COLUMNS)`; migration post-verify 4c proves the allowlist survived the REVOKE on PROD |
| SQL gate proves service_role INSERT RETAINS attested_venue (A1) | ✓ VERIFIED | test_api_keys_insert_not_client_writable.sql:238-254 — unconditional INSERT + read-back with a loud RANK-03 REGRESSION message |
| Negative is state-adaptive on the `revoke_api_keys_insert` comment marker | ✓ VERIFIED | :266-349 — SKIP notice pre-REVOKE, ARMED via `col_description` marker; anti-disarm assertion (:287) catches a dropped marker on a revoked DB |
| Positive controls unconditional: owner SELECT + owner DELETE canaries | ✓ VERIFIED | SKIP notice (:349) enumerates assertions 1-4 as always-enforcing, including the DELETE-retained canary |
| PROHIBITION: no fallback/flagged client-INSERT path in either component | ✓ RESPECTED | Whole-repo grep finds zero insert chains in components; component tests assert the mock receives no api_keys insert |
| PROHIBITION: sibling gate not modified by this plan | ✓ RESPECTED | Sibling `test_api_keys_exchange_not_user_writable.sql` modified only in PR-2 (plan 160-05's 5c landmine fix — a different plan, done to prevent a false sql-tests red, +104 lines in `ae53d3cd`) |

### Plan 160-04 — stamp swap + guard extension

| Truth | Status | Evidence |
|---|---|---|
| Stamp derives from the ATTESTED binding, never the forgeable column | ✓ VERIFIED | route.ts:1337 `isCryptoExchange(attestedVenue)` |
| Guard extension + stamp swap in the SAME change | ✓ VERIFIED | Both inside PR-1's finalize-wizard diff (hunks at :1199, :1282, :1320 only) |
| New guard is a strict superset of the lookup-fault guard | ✓ VERIFIED | :1248 `attestedVenue` initialized null; a lookup fault leaves it null; :1301 skips on null regardless of whether `exchange` resolved |
| B-D2 oracles pin ECONOMICS as literal fixtures | ✓ VERIFIED | `adminApiKeysAttestedVenue` knob, deribit⇒crypto / mt5⇒traditional / NULL⇒no-update-captured fixtures in route.test.ts |
| Every new oracle observed RED under a neuter | ✓ VERIFIED | RED-first commit `e9ffb0eb` in git history; 160-04-SUMMARY neuter table (cycles with verbatim red assertions; each neuter reddens exactly its own oracle) — process evidence anchored in the commit graph, not summary prose alone |
| create-with-key draft stamp unchanged | ✓ VERIFIED | `create-with-key` absent from PR-1's diffstat entirely |
| PROHIBITION: no nullish-coalescing of the attested binding onto exchange | ✓ RESPECTED | Only occurrence of `?? apiKeyExchange` is the ⛔ comment forbidding it (:1277); code path narrows via `typeof` |
| PROHIBITION: composite and CSV arms byte-unchanged | ✓ RESPECTED | PR-1 diff hunks confined to :1199-1341 (single-key stamp/guard region); composite arm (:1473+) untouched by the phase's commits |

### Plan 160-05 — soak → REVOKE (PR-2)

| Truth | Status | Evidence |
|---|---|---|
| Deploy-first / revoke-second; REVOKE only in this plan, authored after soak confirms merged + deployed + **prod-smoked** | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (smoke clause) | Ordering fully held: PR-1 merged, Vercel deployment `dpl_2TjqCXPdM4B85fn4wUHZLC9PxP52` READY at 17:12:02 UTC holding both aliases, 47-min soak, then PR-2. But the four prod smoke flows were NOT performed — zero keys connected during the soak, so it measured absence of un-attested inflow, not that the persist arm works on PROD. Routed to human verification (see frontmatter). |
| Exactly one verb withdrawn: REVOKE INSERT; DELETE and RLS untouched | ✓ VERIFIED | Migration contains exactly 1 `REVOKE` statement; no ALTER/DROP POLICY, no trigger or CHECK change; post-verify 4b/4b′/4c enforce DELETE + service_role INSERT + SELECT allowlist; PROD post-apply measured true on all counts |
| Guard re-runs count-pinned census, ABORTS on drift, PROD-signature discriminator, TEST lenient | ✓ VERIFIED | Two-sided positive-evidence discriminator (mt5 signature vs e2e seed signature, unidentified ⇒ ABORT); dated cutoff separates ENFORCED pre-cutoff pin from REPORTED soak-window rows; proven on a PG16 fixture across 6 scenarios with both post-verify assertions demonstrated to fire under neuters |
| Whole-repo `.from("api_keys")` mutation re-grep, zero browser INSERT chains | ✓ VERIFIED | Re-run independently at HEAD by this verification: only service-role contexts remain (the writer + `src/__tests__/` live-DB helpers + e2e seeds) |
| Route serves NO ciphertext to any caller; STALE_CLIENT refusal in the same merge | ✗ FAILED | `STALE_CLIENT` absent from route.ts; legacy arm at :384-390 byte-unchanged and still returns ciphertext to absent-discriminator bodies. See Gaps. |
| Marker appended PRESERVING every existing substring | ✓ VERIFIED | Append-not-rewrite in migration §3; post-verify 4d/4e assert the new marker, the appended sentence, AND the surviving `20260810120000` marker; all measured present on PROD post-apply |
| ARTIFACT: migration file | ✓ VERIFIED | `supabase/migrations/20260823120000_revoke_api_keys_insert.sql`, contains the exact REVOKE pattern |
| ARTIFACT: route.ts contains STALE_CLIENT | ✗ MISSING | Pattern absent — see gap |
| ARTIFACT: CENSUS re-measure addendum | ✓ VERIFIED | CENSUS:273-327, dated, with the re-cut constants the migration hand-types (transcription verified) |
| PROHIBITION: REVOKE never widens beyond INSERT | ✓ RESPECTED | One REVOKE naming INSERT; anti-overreach post-verifies; PROD measured |
| PROHIBITION: drift comparison never softened; PROD never NOTICEs on the enforced pin | ✓ RESPECTED | PROD branch RAISEs EXCEPTION on `v_unattested <> c_pin_unattested`; only total and soak-window counts are NOTICE-reported, by documented design |
| PROHIBITION: no applied migration edited | ✓ RESPECTED | PR-2 diffstat touches only the NEW migration + `supabase/tests/` sibling + docs; `20260810120000` and `20260811210000` untouched |

### Plan 160-06 — golden parity

| Truth | Status | Evidence |
|---|---|---|
| Every Q2 candidate re-annualized with golden parity, OR the no-op RECORDED with the census line cited | ✓ VERIFIED | Q2 = zero rows (anti-vacuity: measured zero over a real 31-row population, not an empty table); `160-PARITY.md` records the no-op citing the exact census line |
| Expected-delta math pinned BEFORE execution (RISK ×≈1.203, RETURN/CAGR unmoved) | ✓ VERIFIED | PARITY delta table pins √(365/252) ≈ 1.2039 for RISK and MUST-NOT-MOVE for RETURN, with the #597 rationale — pinned despite the no-op so a future run has a pre-existing oracle |
| Per-strategy, bounded to the census id list, no blanket backfill | ✓ VERIFIED | Zero candidates ⇒ zero writes; scope statement explicit ("No UPDATE was issued… No backfill, bounded or otherwise") |
| PROHIBITION: no blanket backfill | ✓ RESPECTED | No mutation block exists in PARITY at all |
| PROHIBITION: no PII in artifact | ✓ RESPECTED | Email-token grep: 0 hits |

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| RANK-03 (server-authoritative `api_keys.exchange` at every INSERT) | ✓ SATISFIED | Browser holds no INSERT (PROD-measured); the only writers are service-role (persist arm derives both venue columns from the route-validated binding; e2e seeds are TEST-only service-role). DB backstops independent of app code: the scrub trigger NULLs client-supplied attestation, the CHECK forces `attested_venue = exchange`, and the armed SQL gate + column-comment marker chain guard regression. No path remains by which a client-supplied venue reaches a row's `exchange` unvalidated. |
| RANK-04 (attestation-derived √365/√252 stamp, null-attestation SKIP) | ✓ SATISFIED | Stamp input is `attestedVenue`; `skipAssetClassWrite` keys on the attestation being null, closing the `isCryptoExchange(null) === false` trap; no fallback to the forgeable column exists; economics oracles pin the behavior; zero historical strategies needed correction (measured, recorded). |

## Anti-Patterns / Behavioral Checks

- Debt-marker scan (TBD/FIXME/XXX) across all seven phase-touched code files: **0 hits**.
- Data-flow: the persist arm's insert payload traces to `exchangeNormalized` (the route's own validation output), never a request-body passthrough; WR-01 ordering makes the provenance keys structurally last-writer in the object literal.
- Behavioral evidence is test-borne (route.test.ts persist oracles, finalize-wizard B-D2 oracles with a RED-first commit, SQL gate on the shared TEST DB) plus the migration's own aborting post-verifies exercised on a PG16 fixture. Full suite not re-run here (merged main CI ran it; per project policy every CI gate is advisory-at-merge, noted, but the PROD post-apply state was measured directly, which is stronger evidence than a green check for the DB-side claims).
- Probes: no `scripts/*/tests/probe-*.sh` declared by this phase; the migration's fixture scenarios and PROD post-apply measurements are the equivalent executed evidence.

## Known Gaps (explicit)

### Gap 1 — Production persist arm never exercised (behavior-unverified, human item)
The four PROD smoke flows in plan 160-05 Task 1 were not performed; zero keys were connected during the 47-minute soak. The soak therefore proved only that no un-attested rows appeared — a claim about absence, not about the writer working. After the REVOKE, the persist arm is the ONLY door into `api_keys`; if it has a production-only fault (env, service credential, CORS/origin, rate limit), connect-a-key is broken for every tenant and nothing in this phase's evidence would have caught it. **Human action:** perform one real connect on PROD (wizard at minimum) and confirm an attested row + `api_key_id` response. Until then this clause stays unverified, not failed — the code, tests, and fixture evidence are all present and wired.

### Gap 2 — Legacy ciphertext arm not retired (failed must-have)
Plan 160-05 required absent-discriminator bodies to receive a coded `STALE_CLIENT` refusal in the same merge as the migration. Not done: route.ts:384-390 still returns the ciphertext envelope. Risk is materially reduced (the arm can no longer create a row — PROD-measured; 5c fixture evidence confirms the 42501 table-permission denial specifically), but key ciphertext still round-trips to the browser for legacy-shaped requests, which the truth explicitly forbade. Booked in 160-05-SUMMARY "Carried forward".

**This looks intentional.** The deviation was recorded, reviewed, and risk-assessed in-session. To accept it, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "After this landing the route serves NO ciphertext to any caller: absent-discriminator bodies receive a coded STALE_CLIENT refusal instead of the legacy ciphertext envelope, deployed in the same merge as the migration"
    reason: "Legacy arm is dead as a row-creating path (browser INSERT revoked, PROD-measured); retirement deferred to a follow-up as booked in 160-05-SUMMARY Carried forward + TODOS.md"
    accepted_by: "<founder>"
    accepted_at: "<ISO timestamp>"
```

If accepted, ensure the retirement lands in TODOS.md as a tracked item (the phase's own summary already carries it — verify it reached TODOS.md, the single backlog ground truth).

## Gaps Summary

The phase goal is achieved in the shipped system: no client path can supply a venue (the verb is gone at the table level, measured on PROD), the stamp reads only the attestation, and a NULL attestation skips rather than defaulting to √252 — with DB-level backstops (scrub trigger, coupling CHECK, armed SQL gate) that hold even if application code regresses. The two gaps are (1) the production writer's first real exercise is still owed — a human smoke of connect-a-key — and (2) one deliberately-deferred must-have (legacy ciphertext arm retirement) that needs either an explicit override or a small follow-up change. Neither reopens RANK-03/RANK-04, but per the contract a failed must-have truth means this phase does not pass verification as specified.

---

_Verified: 2026-08-23_
_Verifier: Claude (gsd-verifier)_
