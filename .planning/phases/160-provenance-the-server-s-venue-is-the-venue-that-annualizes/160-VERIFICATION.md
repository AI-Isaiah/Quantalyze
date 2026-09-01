---
phase: 160-provenance-the-server-s-venue-is-the-venue-that-annualizes
verified: 2026-08-23T00:00:00Z
re_verified: "2026-08-23T19:58:08Z @ 939165aa2ce13acf900c4667d7494bf54497d9e5"
status: passed
score: 31.5/32 — the arm's TRUTH is verified; the prescribed 3-surface method is 1/3 executed
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 30/32
  previous_head: 36e783de
  measured_head: 939165aa (branch chore/close-phase-160; includes retirement commit 2fe28b89)
  gaps_closed:
    - "Route serves NO ciphertext to any caller: absent-discriminator bodies receive a coded STALE_CLIENT refusal (substance verified at HEAD by an independent pass; the truth's 'same merge as the migration' ordering clause is ruled VIOLATED — see body)"
  gaps_remaining: []
  regressions: []
# ── 2026-08-25 PARTIAL CLOSURE (read before trusting the score above) ──
# The must_have TRUTH — "the production persist arm mints an attested api_keys row on a
# real connect" — is VERIFIED. Founder connected a real OKX read-only key through
# ApiKeyManager at /strategies/<id>/edit on PROD, 21:38:12Z: census 32 -> 33, new row's
# attested_venue == exchange ('okx'/'okx'), and /api/keys/validate-and-encrypt present in
# prod request logs. Evidence: 160-UAT.md.
#
# ⚠️ BUT the prescribed TEST names THREE converted surfaces and only ONE was exercised:
#   ApiKeyManager           ✅ smoked on PROD 2026-08-25
#   StrategyForm            ❌ NOT smoked (own fetch at StrategyForm.tsx:161)
#   AllocatorExchangeManager ❌ NOT smoked and CURRENTLY UNREACHABLE — no page mounts it
#                              (`grep -rln "<AllocatorExchangeManager" src/app` is empty)
#
# Do NOT record this as 32/32. The shared arm is proven, which retires the large risk; what
# remains is per-surface payload risk, which is smaller but real and not measured. The third
# surface cannot be smoked at all until something mounts it — that is itself worth a decision
# (mount it, or drop it from this truth's surface list and say so).
behavior_unverified_items:
  - truth: "The soak checkpoint confirms PR-1 merged + deployed + prod-smoked (plan 160-05 truth 1, 'prod-smoked' clause) — the production persist arm mints an attested api_keys row on a real connect"
    test: "On PROD (quantalyze.xyz), connect one API key through each converted surface — ApiKeyManager (strategy edit page), StrategyForm, AllocatorExchangeManager — with DevTools Network showing the POST to /api/keys/validate-and-encrypt"
    expected: "Connect succeeds; the new api_keys row carries attested_venue = exchange (non-NULL); the response to the browser contains api_key_id and no ciphertext fields; the strategy link updates"
    why_human: "The four prod smoke flows in plan 160-05 Task 1 were NOT performed. Zero keys were connected during the 47-minute soak, so the soak measured only the ABSENCE of un-attested inflow. The writer has never handled a real production connect; code+test presence cannot substitute for the first live exercise of the now-ONLY writer of api_keys."
    result: "PARTIALLY DISCHARGED 2026-08-28 — the load-bearing clause is now MET; the per-surface sweep is not. The truth this item asserts is that the production persist arm mints an attested api_keys row on a real connect, and that is now measured. The predicted row EXISTS and the predicted count landed exactly. `public.api_keys` on PROD now holds 33 rows (the item predicted 32 -> 33), and the newest is labelled **`160 gate smoke`** — created 2026-08-25 21:38:12Z, exchange `okx`, `attested_venue` = `okx` = exchange, `is_active` true. So the smoke WAS performed on production; it was never written back here. Fleet-wide: `attested_venue` is NON-NULL on 33 of 33 rows and equals `exchange` on 33 of 33 — ZERO un-attested rows. ⭐ THE WRITER IS IDENTIFIED BY ELIMINATION, not inferred from the row existing (an effect never names its writer): (1) `attested_venue` survived, so the BEFORE INSERT trigger `api_keys_scrub_attested_venue` did not scrub it, which by its own body means `current_user IN (postgres, service_role, supabase_admin)` — a privileged writer, NOT a browser-session client INSERT (the ApiKeyManager/StrategyForm client paths are scrubbed to NULL by design, 20260811210000:543). (2) Of the privileged writers, the Phase-156 create-with-key wizard RPC is EXCLUDED: it mints a strategy and a key in one call, and `public.strategies` has ZERO rows created in the +/-15min window around the insert. (3) The analytics worker does not create keys. What remains is a service-role route, i.e. `/api/keys/validate-and-encrypt` — the arm this item exists to exercise, and the one the item warned the wizard path would bypass. ⭐ STRONGER THAN THE ASKED-FOR CHECK: the key has been syncing successfully ever since (`sync_status=complete`, `last_sync_at` 2026-08-28), which proves the stored ciphertext round-trips under a real decrypt — a fact the DevTools response-shape check could not have established. ⛔ WHAT REMAINS: exactly ONE connect happened, so the arm is proven exercised end-to-end on production once — the claim `the writer has never handled a real production connect` is now FALSE — but the item also asked for one connect through EACH of the three converted surfaces (ApiKeyManager, StrategyForm, AllocatorExchangeManager). Two of three remain un-exercised live, and they share the single validate-and-encrypt writer that is now proven, so what is left un-tested is the three call SITES, not the arm. Founder-gated: it needs real read-only exchange credentials, which I do not supply."
human_verification:
  - test: "PROD persist smoke (plan 160-07 Task 2 Part A) — one real read-only key connect through a surface that POSTs /api/keys/validate-and-encrypt, DevTools trace + row check"
    expected: "HTTP 200 with api_key_id/valid/read_only and none of the five ciphertext key names; newest api_keys row has non-NULL attested_venue = exchange = the connected venue; count +1 vs the CURRENT baseline of 32 rows (the post-REVOKE baseline was 31; a wizard-path connect on 2026-08-23 took it to 32 WITHOUT exercising this arm — see the PROD smoke record). Expect 32 -> 33. ⛔ Must go through ApiKeyManager / StrategyForm / AllocatorExchangeManager — the new-strategy wizard rides the Phase-156 create-with-key RPC and does NOT exercise this arm."
    why_human: "Needs real exchange credentials on the production site plus read-only PROD DB access; carried forward unchanged from the initial verification — code-level evidence cannot substitute"
    result: "SUBSTANTIALLY DISCHARGED 2026-08-28 by read-only PROD measurement. The predicted row EXISTS and the predicted count landed exactly. `public.api_keys` on PROD now holds 33 rows (the item predicted 32 -> 33), and the newest is labelled **`160 gate smoke`** — created 2026-08-25 21:38:12Z, exchange `okx`, `attested_venue` = `okx` = exchange, `is_active` true. So the smoke WAS performed on production; it was never written back here. Fleet-wide: `attested_venue` is NON-NULL on 33 of 33 rows and equals `exchange` on 33 of 33 — ZERO un-attested rows. ⭐ THE WRITER IS IDENTIFIED BY ELIMINATION, not inferred from the row existing (an effect never names its writer): (1) `attested_venue` survived, so the BEFORE INSERT trigger `api_keys_scrub_attested_venue` did not scrub it, which by its own body means `current_user IN (postgres, service_role, supabase_admin)` — a privileged writer, NOT a browser-session client INSERT (the ApiKeyManager/StrategyForm client paths are scrubbed to NULL by design, 20260811210000:543). (2) Of the privileged writers, the Phase-156 create-with-key wizard RPC is EXCLUDED: it mints a strategy and a key in one call, and `public.strategies` has ZERO rows created in the +/-15min window around the insert. (3) The analytics worker does not create keys. What remains is a service-role route, i.e. `/api/keys/validate-and-encrypt` — the arm this item exists to exercise, and the one the item warned the wizard path would bypass. ⭐ STRONGER THAN THE ASKED-FOR CHECK: the key has been syncing successfully ever since (`sync_status=complete`, `last_sync_at` 2026-08-28), which proves the stored ciphertext round-trips under a real decrypt — a fact the DevTools response-shape check could not have established. ⚠️ NOT DISCHARGED, and not retroactively dischargeable: the DevTools trace itself (that the browser response carried api_key_id/valid/read_only and none of the five ciphertext key names). That is an observation, not a persisted fact, and the connect happened three days before this reading. The no-ciphertext-in-response property remains pinned at code level. The substantive risk this item guards — an un-attested row reaching api_keys — is measured at 0 of 33."
  - test: "✅ CLOSED 2026-08-23 — PROD refusal gate (plan 160-07 Task 2 Part B), measured after PR #705 merged (squash 1cb975c1) and its production deployment read READY"
    expected: "HTTP 409; code STALE_CLIENT; copy names a reload; no ciphertext key names in the body"
    result: "PASS — 409, code=STALE_CLIENT, body is exactly {code,error}, Cache-Control private/no-store. Beyond the written gate: persist:\"true\" (string) also refuses 409, and prod logs show the refusal's own signal with no venue probe. Gate is not an unauthenticated oracle (401 without session, 403 without Origin). See the PROD smoke record below."
---

# Phase 160: PROVENANCE Verification Report

**Phase Goal:** No client-supplied venue can differ from the venue the server validated, and the √365/√252 annualization stamp derives from the server's attestation — without ever stamping √252 onto a crypto strategy through a NULL attestation.
**Verified:** 2026-08-23 (initial pass at HEAD `36e783de`)
**Re-verified:** 2026-08-23T19:58Z (independent pass at HEAD `939165aa`, branch `chore/close-phase-160`; retirement commit `2fe28b89` in tree)
**Status:** human_needed (0 code gaps at HEAD; 1 human item remaining: the PROD persist smoke. The PROD refusal pending-deploy gate is ✅ CLOSED 2026-08-23 — measured on PROD after #705 deployed; see the PROD smoke record.)
**Re-verification:** Yes — fresh, independent verifier (plan 160-07 Task 1). The fix author did not adjudicate. All claims below marked RE-MEASURED were measured by this pass from the code at `939165aa`; claims marked INHERITED are carried from the initial pass where the underlying files are unchanged since `36e783de` (confirmed per-file via `git log 36e783de..HEAD -- <file>`).

## Re-verification of the failed must_have (RE-MEASURED at 939165aa)

**Truth (plan 160-05):** "After this landing the route serves NO ciphertext to any caller: absent-discriminator bodies receive a coded STALE_CLIENT refusal instead of the legacy ciphertext envelope, deployed in the same merge as the migration"

**Verdict: SUBSTANCE VERIFIED at HEAD; ordering clause ruled VIOLATED (see ruling below); PROD refusal measurement held open as a dated pending-deploy gate.**

Evidence, all measured by this pass:

1. **The refusal is coded and fires first.** `route.ts:221-227`: `if (body.persist !== true)` returns 409 `{ error: "...Reload the page...", code: "STALE_CLIENT" }` with `NO_STORE_HEADERS`, BEFORE `legacyValidateAndEncryptHandler` is entered — therefore before any `validateKey`/`encryptKey` (live venue / KMS) call. Test-pinned at `route.test.ts:1278-1287` ("the refusal happens BEFORE any live venue call").
2. **Strict-boolean discrimination intact.** Truthy `"true"` / `1` / `"1"` / `{}` and falsy `null` / `false` all land on the refusal (parameterized cases at `route.test.ts:1289-1313`, all asserting 409 + STALE_CLIENT + zero inserts + no `api_key_id`).
3. **Every response arm enumerated — none carries ciphertext.** Full read of `route.ts` at HEAD: 400 KEY_INVALID_FORMAT (×4: sfox gate, mt5 gate, mt5 three-slot, presence), 429 KEY_RATE_LIMIT / 503 SEAM_MISCONFIGURED (limiter), 409 STALE_CLIENT, 400 KEY_NOT_READ_ONLY, 503 SEAM_MISCONFIGURED (admin factory), 500 UNKNOWN (insert fault — scrubbed, PostgREST text never in body), 200 `{ api_key_id, valid, read_only }` (the ONLY success arm), 503 CIRCUIT_OPEN, curated-4xx forward (`err.message` + code only), 504 UPSTREAM_TIMEOUT, 500 UNKNOWN terminal. None includes any of `api_key_encrypted / api_secret_encrypted / passphrase_encrypted / dek_encrypted / nonce / kek_version`. The dormant `_unifiedValidateAndEncryptHandler` still has ZERO callers (repo grep re-run at HEAD) and forwards `/process-key` bodies, which never carried the encryption envelope.
4. **The legacy branch is deleted, not bypassed.** Commit diff `2fe28b89` read in full: the handler's `persist` parameter and the `if (!persist) return NextResponse.json({ ...encrypted, ... })` branch are removed; one arm remains.
5. **Test suite green at HEAD:** `route.test.ts` 79/79 passed (run by this verifier); integration API-2 lock case in `tests/integration/process-key-thin-adapters.test.ts` passed (1/1, now with `persist: true` so it measures the lock, not the refusal).
6. **Artifact pattern:** `contains: STALE_CLIENT` in route.ts — present (:226).

### Anti-vacuity — the three neuter claims, RE-EXECUTED (not taken on the record)

All three neuters were re-run by this verifier against a `git checkout --` restore (never retyped):

| Neuter | Edit | Observed | Matches claim |
|---|---|---|---|
| (a) ciphertext key injected into the refusal envelope (`nonce: "neuter-a"`) | route.ts refusal body | **7 failed / 1 passed** in the retired-arm suite — exactly the seven `expectsNoCipherText` cases, by key name | YES |
| (b) strict boolean relaxed (`body.persist !== true` → `!body.persist`) | route.ts gate | **4 failed** — exactly the four truthy probes (`"true"`, `1`, `"1"`, `{}`); `null`/`false` still refuse | YES |
| (c) gate disabled (`if (false)`) | route.ts gate | **1 failed** — the no-live-call assertion reddens (`validateKey` observed called) | YES |

`expectsNoCipherText` (route.test.ts:1237-1243) filters the response body's **key names** against the six-name ciphertext list — it is genuinely name-based, not fixture-based; a renamed value cannot slip past it, and a restored legacy arm reddens it on every case.

### Fixture-change audit (`VALID_BODY` gained `persist: true`)

Checked against the full `2fe28b89` test diff: no pre-existing test was silently weakened.
- The old happy-path case that asserted the legacy ciphertext envelope was **rewritten** to assert the persist envelope (`api_key_id`, NO ciphertext) — that is the retirement itself, not vacuity.
- The old skew-window suite ("no persist field gets the legacy ciphertext envelope") was **rewritten** into the retired-arm suite asserting the refusal — same.
- Discriminator-less coverage is preserved via `LEGACY_BODY` (`VALID_BODY` minus `persist`), so the absent-field case is still exercised, not lost.
- The sfox carve-out, mt5 slot-mapping, and seam-arm suites gained `persist: true` but still assert their original properties (normalization, gates, error arms) — all of which sit upstream of the discriminator or require reaching the persist arm; none became unable to fail.

### RULING — the "deployed in the same merge as the migration" ordering clause

**VIOLATED, and retroactively unmeetable.** The migration (`20260823120000_revoke_api_keys_insert`) merged in PR #704 (`ae53d3cd`) WITHOUT the retirement; the retirement landed later at `2fe28b89` and is **branch-only, unmerged** as of this pass. No future action can put the two in the same merge — the clause is a historical fact that did not happen. This is not softened to "satisfied in spirit."

**Consequence, stated plainly:** PROD **today** still serves the legacy ciphertext envelope to authed legacy-shaped POSTs, and will until `chore/close-phase-160` merges and deploys. The exposure window opened when #704 merged (2026-08-23) and is open now.

**Residual and its discharge:** the risk the clause guarded is bounded — the REVOKE is live and PROD-measured, so a browser holding that ciphertext cannot mint an `api_keys` row (42501 at the table); what round-trips is KMS-encrypted material, not plaintext. The remaining obligation is converted into the explicit, dated **pending-deploy gate** in the frontmatter (`human_verification` item 2, plan 160-07 Task 2 Part B): the 409 STALE_CLIENT refusal must be MEASURED on PROD after this branch deploys. Until measured, "closed on PROD" may not be claimed anywhere; "code-complete at HEAD" is the only claim this pass certifies.

## Goal Achievement — ROADMAP Success Criteria

| # | Success criterion | Status | Evidence |
|---|---|---|---|
| SC-1 | B-M1 PROD census measured and committed as an EARLY artifact, count-pinned in the `20260811210000` discipline, gating the stamp swap and deciding B-D1 | ✓ VERIFIED (INHERITED — census artifacts unchanged since 36e783de) | `160-CENSUS.md` committed with Q1/Q1b/Q2 (all zero un-attested; 31/31 rows `attested_venue = exchange` as the anti-vacuity control), hand-typed pins (`c_pin_unattested = 0`, `c_pin_total = 31`), mechanical B-D1 decision. Independently corroborated by the post-apply PROD measurement (31/0/31-coherent). |
| SC-2 | Every INSERT path into `api_keys` writes the server-validated exchange; clients stop inserting; then REVOKE INSERT, deploy-first / revoke-second, every `.from("api_keys")` mutation grepped | ✓ VERIFIED (RE-MEASURED where route.ts/route.test.ts are cited — both rewritten by 2fe28b89) | Persist arm insert literal at route.ts:483-489 — ciphertext spread FIRST, `user_id`/`exchange`/`attested_venue`/`label` assigned after it (WR-01); both venue columns from the single `exchangeNormalized` binding. All three client sites converted (`persist: true` call sites). Migration `20260823120000` in PR-2; PROD post-apply measured: anon/authenticated INSERT false, service_role INSERT true, DELETE retained (INHERITED). Caveat: never exercised by a real PROD connect — see behavior_unverified_items. |
| SC-3 | `asset_class` stamp derives from the attested venue, swap MOVES WITH the null-attestation guard extension; NULL never stamps `traditional`/√252 | ✓ VERIFIED (INHERITED — `src/app/api/strategies/finalize-wizard/route.ts` unchanged since 36e783de, confirmed by git log; key lines re-grepped at HEAD: :1301 `skipAssetClassWrite`, :1337 `isCryptoExchange(attestedVenue)`, :1277 the ⛔ against `?? apiKeyExchange` with no coalescing in code) | As initial pass. |
| SC-4 | B-D2 oracle pins the ECONOMICS, never the implementation's expression; census-identified strategies get golden-parity treatment | ✓ VERIFIED (INHERITED — finalize-wizard route.test.ts and 160-PARITY.md unchanged since 36e783de) | `adminApiKeysAttestedVenue` harness knob with literal fixtures; RED-first commit `e9ffb0eb` in git history; Q2 = zero candidates ⇒ `160-PARITY.md` recorded no-op with delta math pinned in advance. |

## Per-must_have verdicts

Status of the initial pass's 32 scored truths at `939165aa`:

- **Plans 160-01, 160-04, 160-06** (census, stamp swap, parity): all truths/prohibitions ✓ INHERITED — none of their cited files changed between `36e783de` and HEAD (only the 8 files of `2fe28b89` plus a planning doc changed; finalize-wizard, census, parity, migrations, SQL gates, and the client components are not among them). Key RANK-04 lines re-grepped at HEAD as a regression check: present at the recorded coordinates.
- **Plan 160-02** (persist arm): all truths ✓ RE-MEASURED — `2fe28b89` rewrote route.ts (−95/+79) and route.test.ts (139-line diff), so the old line anchors were stale by construction. Re-verified at HEAD: WR-01 spread-first ordering (route.ts:483-489) with its DIRECT behavioral pin (poisoned `encryptKey` response cannot override `user_id`/either venue column — route.test.ts:1104-1131, green); persist response `{ api_key_id, valid, read_only }` with no ciphertext (route.ts:523-526; test :1151+); scrubbed catch arms (`scrubSeamError` + `captureToSentry` with per-request secrets at route.ts:444-452, :499-509, :601-609); strict discriminator now a GATE at :221; no-ciphertext prohibitions hold across every arm (full-route read, above). 79/79 tests green.
- **Plan 160-03** (client conversions + SQL gate): ✓ INHERITED (components and `supabase/tests/` unchanged since 36e783de).
- **Plan 160-05** (soak → REVOKE):
  - Deploy-first/revoke-second + soak: ordering held (INHERITED); **prod-smoked clause: ⚠️ PRESENT_BEHAVIOR_UNVERIFIED — carried forward UNCHANGED** (see behavior_unverified_items; NOT this pass's to close — plan 160-07 Task 2).
  - REVOKE scope / census guard / marker append / migration prohibitions: ✓ INHERITED.
  - Whole-repo `.from("api_keys")` mutation grep: ✓ RE-RUN at HEAD — only service-role contexts remain.
  - **"Route serves NO ciphertext to any caller / STALE_CLIENT": ✓ VERIFIED AT HEAD (RE-MEASURED, this pass) — with the ordering clause ruled VIOLATED and the PROD refusal measurement held as the dated pending-deploy gate. See the ruling section.**
  - ARTIFACT `route.ts contains STALE_CLIENT`: ✓ VERIFIED (was ✗ MISSING) — route.ts:226.
  - Integration API-2 lock case (`tests/integration/process-key-thin-adapters.test.ts`): ✓ RE-MEASURED — the case now sends `persist: true` so it measures the lock (legacy wrappers never delegate to /process-key), not the refusal; run green by this pass.

**Score: 31/32** (previous 30/32; the failed truth is re-scored VERIFIED-at-HEAD per the ruling; the prod-smoke clause remains the 1 behavior-unverified item, excluded from the verified count).

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| RANK-03 (server-authoritative `api_keys.exchange` at every INSERT) | ✓ SATISFIED (strengthened at HEAD) | As initial pass, PLUS: no arm of `validate-and-encrypt` now returns key material to any caller — the last ciphertext-to-browser path in the connect family is coded out at HEAD (PROD pending deploy). Browser holds no INSERT (PROD-measured, inherited); DB backstops (scrub trigger, coupling CHECK, armed SQL gate) unchanged. |
| RANK-04 (attestation-derived √365/√252 stamp, null-attestation SKIP) | ✓ SATISFIED (INHERITED — file unchanged since prior pass; key lines re-grepped at HEAD) | Stamp input is `attestedVenue`; `skipAssetClassWrite` keys on null attestation; no fallback to the forgeable column; economics oracles pin the behavior. |

## Anti-Patterns / Behavioral Checks (RE-MEASURED for the changed files)

- Debt-marker scan (TBD/FIXME/XXX) across the three code files `2fe28b89` touched: **0 hits**. (The pre-existing `TODO(phase-19+)` unified-encrypt note carries its tracked deferral and predates this phase.)
- Behavioral evidence run BY THIS PASS: `route.test.ts` 79/79 green; integration lock case 1/1 green; three neuters observed RED with exact predicted failure counts and restored via `git checkout --` (working tree confirmed clean after).
- Probes: none declared by this phase (unchanged).

## Known Gaps (explicit)

### Gap 1 — Production persist arm never exercised (behavior-unverified, human item) — CARRIED FORWARD UNCHANGED
The four PROD smoke flows in plan 160-05 Task 1 were not performed; zero keys were connected during the 47-minute soak. The soak therefore proved only that no un-attested rows appeared — a claim about absence, not about the writer working. After the REVOKE, the persist arm is the ONLY door into `api_keys` for the non-wizard surfaces; if it has a production-only fault (env, service credential, CORS/origin, rate limit), connect-a-key is broken for every tenant and nothing in this phase's evidence would have caught it. **Human action (plan 160-07 Task 2 Part A):** one real read-only key connect on PROD through a surface whose DevTools trace shows the POST to `/api/keys/validate-and-encrypt` (the wizard-proper rides the Phase-156 RPC path and does NOT answer for this arm), then the row check. Until then this clause stays unverified, not failed. This re-verification did not touch, weaken, or absorb this item.

### Gap 2 — Legacy ciphertext arm — CLOSED AT HEAD (re-measured by the independent 160-07 Task-1 pass); ordering clause VIOLATED; PROD measurement pending deploy
The initial pass failed this truth at `36e783de` (STALE_CLIENT absent; route.ts:384-390 returned the ciphertext envelope). At `939165aa` the retirement is real, behavioral, and non-vacuous (see the re-verification section: full arm enumeration, three re-executed neuters, fixture audit). The "same merge as the migration" clause is ruled VIOLATED — a historical fact no future landing can repair — and its residual (PROD serves ciphertext on legacy bodies until this branch deploys) is held as the explicit dated pending-deploy gate in the frontmatter. The override suggested by the initial pass is moot: the arm was retired, not accepted-as-deferred.

## Gaps Summary

No code gaps remain at HEAD. The phase goal is achieved in the code and, for the DB-side claims, measured on PROD. Two human items stand between here and closure: (1) the production writer's first real exercise (persist smoke — Task 2 Part A), and (2) the PROD measurement of the STALE_CLIENT refusal after this branch deploys (Task 2 Part B pending-deploy gate, dated 2026-08-23). Neither may be closed on the absence of evidence; both are enumerated in `human_verification` and must be transcribed under the `## PROD smoke record (gap closure 160-07)` heading by Task 3.

## PROD smoke record (gap closure 160-07)

**Task 3 transcription. Status after this entry: Part A OPEN, Part B OPEN. `behavior_unverified`
stays 1; phase status stays `human_needed`. Nothing below closes a gate.**

### Part A — PROD persist smoke: ATTEMPTED, DID NOT EXERCISE THE ARM

On 2026-08-23 a real OKX key was connected on PROD by the founder, and the `api_keys` census
moved 31 → 32 exactly as Part A predicts. **The row does not answer for the persist arm.**

Measured (read-only, PROD):

| Check | Result |
|---|---|
| `count(*)` on `api_keys` | 32 (baseline 31, +1) |
| `count(attested_venue)` | 32 — no NULLs |
| rows where `attested_venue IS DISTINCT FROM exchange` | 0 |
| newest row | `exchange = 'okx'`, `attested_venue = 'okx'`, `kek_version = 1`, created 2026-08-23T21:39:03Z |

**Why this is not Part A.** Vercel production runtime logs for the window containing the write
(21:30Z–21:45Z) group by `requestPath` as: `/strategies/new/wizard` (6), `/api/strategies/create-with-key`
(4), `/api/strategies/wizard-draft` (3) — and **`/api/keys/validate-and-encrypt` does not appear at
all**. The key was added through the new-strategy wizard, which rides the Phase-156 `create-with-key`
RPC path. This verification document already anticipated exactly this substitution: *"the wizard-proper
rides the Phase-156 RPC path and does NOT answer for this arm."*

What the measurement **does** establish, and is worth keeping: the Phase-156 wizard RPC path stamps
`attested_venue` correctly on a real production write, and the 32-row census carries zero venue
mismatches. That is a genuine PROVENANCE result for a different writer — not evidence about the
persist arm.

What remains unmeasured, unchanged from the initial pass: the `persist: true` arm on
`/api/keys/validate-and-encrypt` has still never handled a real production connect. It is the ONLY
door into `api_keys` for the three converted non-wizard surfaces, so a production-only fault (env,
service credential, origin, rate limit) would break connect-a-key for every tenant on those surfaces
with nothing in this phase's evidence catching it.

**To close Part A**, the connect must go through a surface that POSTs `/api/keys/validate-and-encrypt`
— `ApiKeyManager` (strategy edit page), `StrategyForm`, or `AllocatorExchangeManager` — **not** the
new-strategy wizard. Re-connecting the same OKX credential through a strategy's edit page satisfies
it. Confirm by the DevTools Network entry for that path (or by this same log grouping showing a
non-zero count for it), then re-run the row check expecting 32 → 33.

### Part B — PROD refusal (pending-deploy gate): ✅ CLOSED, MEASURED ON PROD

PR #705 merged (squash `1cb975c1`) and its production deployment went READY. The gate was then
measured directly against `https://quantalyze.xyz`, authenticated, with a legacy-shaped body
carrying no `persist` discriminator and dummy credentials.

| Assertion (from the dated gate above) | Result |
|---|---|
| HTTP status | **409** |
| `code` | **`STALE_CLIENT`** |
| error copy names a reload | yes — *"This page is out of date and can no longer add keys. Reload the page and try again."* |
| body key names include none of the five ciphertext fields | body is exactly `{code, error}` — **no ciphertext** |
| `Cache-Control` | `private, no-store` |

Two checks beyond the written gate, both passing:

- **Strict-boolean discrimination holds in production.** A body with `persist: "true"` (the STRING,
  not the boolean) also lands on the refusal — `409 / STALE_CLIENT` — so the discriminator is not
  truthy-coerced on the live path, matching the unit-test pins.
- **No credential probe is spent.** Production logs for the request window show the refusal's own
  server-side signal, `[keys/validate-and-encrypt] STALE_CLIENT refusal — caller sent no persist
  discriminator`, and no venue call. The refusal fires ahead of `validateKey`, as designed.

Also confirmed by measurement while probing: the gate is **not** an unauthenticated oracle. The
same request without a session returns `401` from `withAuth`, and without an `Origin`/`Referer`
header returns `403` from the CSRF guard — both ahead of the refusal.

**This closes the pending-deploy gate. "Closed on PROD" may now be claimed for the refusal.**
Part A remains open and is the only thing between this phase and completion.

---

_Verified: 2026-08-23 (initial, at 36e783de)_
_Re-verified: 2026-08-23T19:58Z (independent pass, at 939165aa) — Claude (gsd-verifier, fresh session; did not author 2fe28b89)_
