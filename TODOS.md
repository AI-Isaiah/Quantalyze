# Quantalyze — Backlog (single source of truth)

**Consolidated 2026-07-23.** This file replaces and supersedes every prior scattered
tracker. The following were folded in here and then deleted so there is ONE ground
truth going forward:

- `TODOS.md` (old 60KB sprawl), `.planning/FUTURE-MILESTONES.md`,
  `.planning/v1.0.0-DEFERRED-AUDIT-DECISIONS.md`,
  `.planning/tech-debt/TECH-DEBT-AUDIT-2026-06-09.md`,
  `.planning/DOGFOODING-FINDINGS-2026-07-16.md`, `.planning/DEMO-REPOINT-SCOPE.md`,
  `.planning/BACKBONE-BYPASS-INVENTORY.md`, `.planning/debug/bybit-reconcile-3-findings.md`,
  `.planning/SCENARIO-COVERAGE-WINDOW-ADR.md`, `.review/b7-tweaks/DEFERRED-FOLLOWUPS.md`,
  `.review/follow-ups.md`, `audit/tech-debt-round-1.md`, `audit/tech-debt-round-2.md`,
  `tasks/ADVERSARIAL_USER_NOTES.md`, `.gstack/handoff-2026-04-26-uat-followup.md`.

Kept (NOT backlog): `.planning/milestones/*` (shipped history), `.planning/codebase/*`
+ `research/*` (architecture), `.planning/{STATE,ROADMAP,REQUIREMENTS,PROJECT,MILESTONES}.md`
(active GSD state), `.planning/RETROSPECTIVE.md` (process history), `CHANGELOG.md`.

Items resolved by intervening milestones (v1.10–v1.14) and stale-but-in-prod-without-issue
items were dropped, not carried. Categories: **Fix now** / **Fix mid-term** / **Don't fix**.

**Purged 2026-08-20 (milestone v1.20 Backlog Burndown):** ~56 verified-open items moved into `.planning/REQUIREMENTS.md` (v1.20 scope — RANK/SHARE/WIZERR/HONEST/OPS/SEC/DEPS) and deleted here; ~28 entries verified STALE at HEAD by a 17-agent triage (solved by earlier milestones) and deleted. Founder-gated and remaining open items below are untouched. Snapshot of the pre-purge file: `git show 2e67c4a0:TODOS.md`.

---

## 🔴 FIX NOW — live correctness, trust-boundary security, active go-live

0.005. **`[SHARE-HOST-01]` Every private share link a user copies points at the UNBRANDED host.**
   MEASURED on production 2026-08-28 while discharging Phase 164's browser UAT. Standing on
   `https://quantalyze.xyz/strategies`, signed in, `POST /api/strategies/<id>/share` returned
   `{"url":"https://quantalyze-rho.vercel.app/factsheet-share/<token>"}`. So the owner copies a
   `vercel.app` link and the recipient sees a host that is not the product.
   **Cause, exactly:** `resolveAppUrl` (`src/app/api/strategies/[id]/share/route.ts:107-109`)
   prefers `NEXT_PUBLIC_APP_URL` over the request `origin`, and that variable is
   `https://quantalyze-rho.vercel.app` in **Vercel Production AND Preview** (read from a clean
   directory, not from a repo-local `.env`). The origin fallback at `:111-119` is therefore dead
   in every deployed environment.
   **Two distinct consequences, both live:**
   1. User-facing trust — a private factsheet link to an investor arrives on a domain the sender
      never showed them. The one surface whose whole job is "share this safely".
   2. Preview mints PRODUCTION-host links. A share created on a preview deploy resolves against
      production, which crosses an environment boundary that `.env.example`'s own
      `SHARE_TOKEN_SECRET` note (`Do NOT reuse one value across environments`) exists to keep shut.
   **Fix shape (not taken here — it is a config + one-line decision):** either set
   `NEXT_PUBLIC_APP_URL` per environment to the branded host, or drop the env-var preference and
   let `resolveAppUrl` use the request origin, which is already correct by construction and is
   what the sibling scenario-share route would want too. ⚠️ Do NOT "fix" this by hardcoding a
   host — the localhost fallback at `:121` is load-bearing for local dev.
   ⛔ NOT affected: token derivation, revocation, or the 410 lane. The link WORKS; it is the host
   that is wrong. Full loop verified green in `164-VERIFICATION.md` human item 4.


0.01. **📋 PHASE 164.1 SCOPE — single source. Collected 2026-08-25; the phase does NOT exist yet.**
   Create with `/gsd-phase --insert 164` (decimal phases land AFTER their integer, so 164.1 sits
   between 164 and 165). Build the CONTEXT from THIS list rather than re-deriving it.
   ⚠️ Ordering is load-bearing: 164.1 must come AFTER 164, because DEC-1 retires guards over
   `scenarios`/`scenario_shares` and 164 (SHARE) is the phase that touches them. Retiring first
   would remove the guard immediately before the work it guards.

   **A. Founder decisions already taken (from 161.1's DEC block):**
   - **DEC-1** — retire frozen-spine gates 1+2, KEEP gate 3.
     Acceptance: gate 3 must still FAIL when the `scenarios`/`scenario_shares` RLS honesty tests
     are edited (neuter → observe RED → restore byte-identically), else retiring 1+2 has silently
     taken 3 with it.
   - **DEC-3** — D13 composite twin closes here, BEFORE any composite go-live.
   - **DEC-4** — the advisory lock, in its own phase, with a REAL concurrency test. It touches two
     RPCs that run on every job transition for every strategy; a half-applied lock discipline reads
     as protection while providing none.

   **B. Detection gap found during the 2026-08-25 prod outage:**
   - **0.04 — PYAPI-06 cannot detect the outage it was built for.** The client omits `X-Service-Key`
     when its value is falsy; the server treats an absent header as prober noise. The only caller
     that can legitimately send an absent header is our own service with an empty key — exactly the
     case discarded. Fix is BOTH halves (loud client-side refusal + a server signal that
     distinguishes a guarded-route caller from a prober). See 0.04 for the full shape and the
     explicit warning not to simply dedent the capture out of `if provided:`.

   **C. Phase 161's deferred error-surface items** (`.planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md`):
   - **D-161-01** — the `first_rule.upper()` CSV code family is invisible to the derived vocabulary
   - **D-161-02** — `formatColumnInDataframeMessage` matches a shape this producer has never emitted
   - **D-161-03** — the column-less message still renders "at row 0"
   - **D-161-05-A** — no manager-facing surface can release an ORPHANED api_key
     ⚠️ OVERLAPS Phase 162's HONEST-06 / D-162-3 (the use-existing-key server path). Check what 162
     actually shipped BEFORE planning this, or the two phases will fight over the same file.
   - **D-161-05-B** — an orphaned MT5 connect waits out the full 120 s validate before refusing
   - **D-161-07-A** — the wizard COMPOSITE arm still renders the provenance sentence for an EXAMINED
     verdict (also filed here as 0.07)
   - **D-161-04 / D-161-07-B** — a contracts-registry full-suite timeout flake and a
     `vercel-functions` validator false-positive. Tooling, not user-facing; include only if cheap.

   **D. WIZFORM-02 — server-classified codes still render `code: UNKNOWN`. RECORDED OPEN**
   (Phase 153 span verification FAILED 2026-08-13) and it GATES other work (see the entry near the
   `GATED ON WIZFORM-02 CLOSING` marker — a new code cannot be minted until the coverage-law
   population is honest).
   - ⭐ **FRESH EVIDENCE 2026-08-25, measured on PROD, not inherited:** `/api/keys/validate-and-encrypt`
     returned `{"error":"Unauthorized","code":"UNKNOWN"}` — a server-classified upstream fault
     reaching the client with NO code, exactly the defect. This is a live reproduction, so plan
     against it rather than re-verifying whether the gate is still open.

   **Not in scope:** 0.02 (OKX entity) — founder call, NOT PURSUED.


0.02. **⏸️ NOT PURSUED — founder call 2026-08-25: "forget OKX entity".** A different OKX key connected successfully at 21:38:12Z, so the immediate need is met and the entity theory was never confirmed (the founder's OKX domain was never read back). Kept as a RECORD, not a task: the underlying limitation below is real and measured, so if a future user reports a key that cannot connect while another key on the same account can, start here rather than re-deriving it. Do NOT schedule work on it without a fresh confirmation.
   ORIGINAL FILING: **OKX is hardcoded to ccxt's default (global) entity — a key issued on any other OKX
   entity can NEVER connect, and the UI blames the user's credentials.** Surfaced 2026-08-25 when
   a founder key issued AFTER an OKX re-KYC failed while an older key on the same account passed.
   - `analytics-service/services/exchange.py:817-830` — `create_exchange` sets only `apiKey`,
     `secret`, `password`, `enableRateLimit`. No hostname, region, or entity option is offered for
     any venue, so OKX resolves to ccxt's default endpoint.
   - OKX operates separate entities on separate API hosts. A key minted on entity B produces a
     signature entity A cannot verify, which OKX reports as `50113 Invalid Sign` — indistinguishable
     at the UI from a mistyped secret.
   - **MEASURED, same deployment, minutes apart:** the stored pre-KYC key `QA OKX Read-key` probed
     clean at 21:37:12 (`read:true, trade:false, withdraw:false, probe_error:false`), while the
     post-KYC key returned `50113` at 21:30:12. Our signing path is NOT broken; the endpoint is
     simply the wrong one for that key. ⚠️ CONFIRM the entity with the founder before building
     anything — the correlation is strong but the OKX domain has not yet been read back.
   - **Why this is worse than a missing feature:** the user is told "Authentication failed. Check
     your API key and secret." They then re-issue keys, re-paste secrets, and doubt their own
     account — which is exactly what happened tonight — for a venue we simply do not support the
     entity of. There is no path by which a correct user action resolves it.
   - **Fix shape (needs a founder decision — do not default it):**
     (a) support an entity/host selector for OKX and persist it beside the key, or
     (b) detect the entity mismatch and say so explicitly in the error copy.
     (b) alone is honest but still leaves the user unable to connect; (a) alone without (b) leaves
     the next mis-selected key equally mute. The pair is the complete fix.
   - **HONEST-01 class (Phase 162):** a venue verdict our own configuration caused, rendered as a
     statement about the user's credential. Same class as 0.03 and the `Unauthorized` case, and the
     third instance found in one evening — the error-copy work in 162 should treat "whose fault is
     this actually" as the organising question, not the individual strings.


0.03. **❌ RETRACTED 2026-08-25 — THIS FINDING WAS WRONG. Credentials ARE trimmed.**
   I filed this after grepping only `validate-and-encrypt/route.ts`, seeing `trim()` used just
   in emptiness guards, and concluding no trimming happened. The chokepoint is ONE LAYER DOWN:
   `src/lib/analytics-client.ts:716` defines `trimCredential`, applied to `api_key` AND
   `api_secret` inside BOTH `validateKey` (`:794-795`) and `encryptKey` (`:819-820`) — so
   validate and encrypt normalise identically, which is exactly the property I claimed was
   missing. It shipped in `2464594a8` on 2026-07-18 after an identical live incident, and
   `route.ts:79-81` names the chokepoint in a comment I had already read.
   - Plan `162-10` was authored on this false premise and has been WITHDRAWN. It would have
     added a SECOND trim site (violating its own acceptance criterion) and its witnessed-RED
     test was unachievable: the route suite mocks `@/lib/analytics-client` wholesale, so an
     assertion at that boundary never observes the real chokepoint. Caught by gsd-plan-checker,
     which measured HEAD instead of trusting the plan's citations.
   - ⚠️ **`passphrase` is DELIBERATELY not trimmed** (`analytics-client.ts:714-715`): an OKX
     passphrase is user-CHOSEN, so whitespace there may be significant. Do not "fix" this
     without a venue-aware decision — trimming it could corrupt a valid credential.
   - ⛔ **The 2026-08-25 OKX `50113 Invalid Sign` therefore remains UNEXPLAINED.** Do not carry
     "untrimmed credentials" forward as its cause. A different key connected successfully at
     21:38Z so there is no live impact, and the entity thread is NOT PURSUED per founder call
     (0.02). Remaining untested candidate, recorded not claimed: passphrase whitespace, which
     the documented decision above deliberately permits.
   - **Lesson worth more than the finding:** a grep of one file is not a search of the code
     path. The comment naming the chokepoint was in a file I had already opened.
   ORIGINAL (WRONG) FILING KEPT BELOW FOR THE TRAIL: **Exchange credentials are never whitespace-trimmed, so a paste with a trailing newline
   fails as "Authentication failed. Check your API key and secret."** Found 2026-08-25 while a
   founder with a known-good OKX key could not connect it.
   - `src/app/api/keys/validate-and-encrypt/route.ts` uses `trim()` ONLY inside emptiness guards
     (`:182-186`, `api_key.trim().length === 0`). The value forwarded to `validateKey` (`:502`) and
     to the legacy handler (`:338`) is the RAW string. `api_secret_normalized` (`:103`) is an
     sFOX-only non-string coercion, not a strip.
   - Python repeats the shape: `analytics-service/routers/exchange.py:216` calls `.strip()` only to
     TEST for emptiness, then passes the raw value to `create_exchange`.
   - So an invisible trailing space or newline reaches OKX's HMAC. The signature is computed over a
     byte-different secret and OKX answers `50113 Invalid Sign` — MEASURED in Railway logs at
     21:30:12. (A fake key returns a DIFFERENT code, `50111 Invalid OK-ACCESS-KEY`, at 21:29:11 —
     the two codes discriminate "key not recognised" from "key recognised, signature wrong".)
   - **Fix:** trim `api_key`, `api_secret` and `passphrase` at the ONE chokepoint before use, on the
     TS side, so the trimmed value is what gets validated AND what gets encrypted. Trimming on only
     one of those two paths is worse than neither: the key would validate and then be stored in a
     form that never authenticates again.
   - ⚠️ **Do NOT trim inside the emptiness guard and call it done** — that is the existing shape and
     it is precisely what fails. The guard already trims; the payload does not.
   - **Regression test (must be witnessed RED):** submit a secret with a trailing `\n`, assert the
     value that reaches the venue client is byte-identical to the trimmed secret. Neuter the trim,
     observe the failure first-hand, restore byte-identically.
   - **HONEST-01 class (Phase 162):** the user-facing copy says "Check your API key and secret",
     which reads as "your credential is wrong" when the credential is RIGHT and our handling is
     wrong. It also collapses OKX's `50111` and `50113` into one sentence, discarding the
     information that would tell a user WHICH field to look at. Both belong with 162's error-copy
     work: map the venue code to a specific, true sentence.


0.04. **⚠️ PYAPI-06 cannot detect the outage it was built to detect — the client's silent
   header-omission and the server's noise filter compose into a blind spot.** Found while
   root-causing 0.05, which PYAPI-06 sat through in total silence.
   - `src/lib/analytics-client.ts:466` — `...(SERVICE_KEY && { "X-Service-Key": SERVICE_KEY })`
     OMITS the header entirely when the key is falsy. No throw, no log, no startup failure: an
     unconfigured platform secret silently degrades into an ANONYMOUS request.
   - `analytics-service/main.py:802` — PYAPI-06 site 5 captures the mismatch only `if provided:`.
     An absent header is deliberately treated as "internet background noise" from a prober, and
     that reasoning is CORRECT in isolation — an unauthenticated prober must not page anyone.
   - **Composed, they cancel out.** The one caller that can legitimately send an absent header is
     OUR OWN service with an empty key, and that is precisely the case the server discards. So the
     complete-outage variant is the ONE variant with no signal, while the milder stale-value
     variant (which at least still authenticates as *someone*) is loudly captured. The safeguard is
     inverted with respect to severity.
   - **MEASURED, not theorised:** five consecutive `POST /api/validate-key 401` in Railway logs
     (2026-08-25 20:52 → 21:27) with ZERO `service_key.mismatch` lines. Meanwhile `/health` stayed
     green, `/process-key` and `/internal/*` kept working (both exempt from the gate), and the 4xx
     never tripped the 140.2 breaker. Every alarm the system has was, by design, looking elsewhere.
   - **Blast radius while blind:** all exchange key-connects on every non-wizard surface, key-scope
     verification, AND the scheduled `/api/match/cron-recompute` job — silently, for an unknown
     duration. `api_keys` had been frozen at 32 rows since 2026-08-23.
   - ⭐ **FIX (founder: goes in PHASE 164.1, the guards phase):**
     1. Client — an empty `ANALYTICS_SERVICE_KEY` must FAIL LOUD at startup, not omit a header.
        Mirror `mintTenantClaim`'s existing refusal discipline (`analytics-client.ts:415-422`
        already argues exactly this for the tenant claim, and the same argument was never applied
        one line down to the service key).
     2. Server — distinguish "absent header from a caller that reached a guarded route" from a
        prober, OR make the client's loud failure the guarantee that absence really is noise.
        Do NOT simply dedent the capture out of `if provided:` — the comment there is right that
        doing so buries the signal under internet scan traffic.
     3. Acceptance is a RED-witnessed test, per project rule: set the key empty, assert the seam
        REFUSES rather than sending an anonymous request. Neuter the guard, observe the failure
        first-hand, restore byte-identically.
   - **Also route to HONEST-01 (Phase 162):** a forwarded upstream `Unauthorized` rendered on a
     credential form as user-facing copy. It reads as "your key was rejected" when the truth is
     "our service auth is broken" — the founder reasonably concluded their own key was bad. Exactly
     the class 162 exists to close, and a real instance of it costing real debugging time.


0.05. **✅ RESOLVED 2026-08-25 22:29 SAST — was a LIVE PROD OUTAGE: Vercel's `ANALYTICS_SERVICE_KEY` did not match Railway's `SERVICE_KEY`.**
   - **Fix:** founder re-copied Railway's `SERVICE_KEY` into Vercel (Production, Sensitive) and
     redeployed. Verified by probe: the boundary now returns `424 AUTH_FAILED` ("Authentication failed. Check your API key and secret.") for FAKE credentials, where it
     previously returned `401 {"error":"Unauthorized","code":"UNKNOWN"}` for every key. The
     424 proves the call is authenticated and reached the exchange.
   - ⚠️ **ROOT CAUSE CORRECTION (supersedes the 'stale value' wording below).** Vercel was
     sending NO `X-Service-Key` header at all, not a wrong one. Proof: `service_key.mismatch`
     never appeared in Railway logs across five 401s, and that line only fires when the header
     is non-empty. A stale value would have logged; an absent one did not.
   - ⚠️ **A redeploy takes ~1 minute to cut over.** The first post-redeploy probe still hit the
     OLD deployment id and returned the old 401 — nearly read as "the fix did not work".
     Always confirm the serving `dep=` id changed before judging a config fix.
   - ORIGINAL DIAGNOSIS FOLLOWS (kept for the evidence trail): Every guarded analytics route returns 401. Found 2026-08-25 by a live prod
   connect attempt, confirmed at BOTH ends with matching timestamps.
   - **Evidence (Railway deploy log, prod):** `POST /api/validate-key 401 Unauthorized` at
     20:52:40, 21:00:11, 21:12:59 (three real founder attempts) and 21:16:29 (a deliberate
     fake-credential probe). A probe with syntactically-valid FAKE credentials returns the
     IDENTICAL body to a real key — `{"error":"Unauthorized","code":"UNKNOWN"}`, HTTP 401 — which
     proves the rejection happens at OUR service boundary and is unrelated to any exchange key.
   - **Not an auth-session bug.** An empty-body POST to the same route returns
     `400 KEY_MISSING_REQUIRED_FIELD` with the session cookie present, so `withAuth` passes and the
     handler is reached. Ruled out in order: role gate, expired session, CSRF (403, zero seen),
     rate limit (429, zero seen), unset env var (it IS set — 135d old).
   - **Mechanism.** `src/lib/analytics-client.ts:46` reads `ANALYTICS_SERVICE_KEY`, `:466` attaches
     it as `X-Service-Key`. `analytics-service/main.py:648` compares against `SERVICE_KEY`; mismatch
     → 401. `validate-and-encrypt` then FORWARDS the upstream body verbatim (route `:748-762`,
     F5b/SEAMUX-03), so the operator's 401 is rendered to the user as "Unauthorized".
   - ⛔ **BLAST RADIUS IS WIDER THAN KEY-CONNECT.** The same log shows
     `POST /api/match/cron-recompute 401` at 21:00:00 — a SCHEDULED PRODUCTION JOB failing silently
     on the same cause. Whatever else calls a guarded route is also failing. Audit the full route
     list before declaring this closed; do not assume key-connect is the only casualty.
   - **Why nothing caught it:** `SERVICE_KEY` skips `/health`, `/internal/*` and `/process-key`, so
     compute jobs keep running and `/health` stays green. 4xx, so the 140.2 breaker never trips.
     `main.py:125-128` predicted this exact blind spot in both directions.
   - **This is why Phase 160's gate could never close.** The persist arm was never broken in the way
     we assumed; it cannot reach its validator at all. `api_keys` census has been stuck at 32 since
     2026-08-23.
   - **FIX (founder-only, needs a secret — an agent must not do this):** copy Railway's
     `SERVICE_KEY` value into Vercel `ANALYTICS_SERVICE_KEY` (Production), then REDEPLOY Vercel —
     env changes do not take effect on the running deployment. Copy Railway → Vercel, NOT the
     reverse: if Railway's was rotated for cause, writing the old value back re-opens whatever the
     rotation closed. ⚠️ Check for a trailing newline/space on paste; that alone reproduces this.
   - **Follow-ups this outage earns (do NOT skip once the key is fixed):**
     1. A startup or first-401 operator signal that NAMES the env var (never its value — the
        `main.py` comment is explicit that naming the value turns the signal into the leak it
        exists to detect). PYAPI-06 designed this; verify it actually fires.
     2. `analytics-client.ts:466` omits `X-Service-Key` entirely when the value is empty
        (`...(SERVICE_KEY && {...})`). Silent omission should be a loud startup failure — an unset
        platform secret must not degrade into an anonymous request.
     3. A forwarded upstream "Unauthorized" must NOT render as user-facing copy on a credential
        form. It reads as "your key was rejected" when the truth is "our service auth is broken".
        Same class as HONEST-01; route it there.


0.06. **⚠️ The key-scope panel claims scopes it just said it could not read.** Found in a LIVE prod
   QA pass (2026-08-25) while attempting the Phase-160 persist-arm smoke, not by a reviewer — the
   panel rendered both halves of a contradiction on screen at once.
   - `src/components/connect/KeyPermissionBadge.tsx`: the plain-English summary correctly branches
     on `perms.probe_error` (`:218` → *"Could not contact the exchange to verify scopes."*), but the
     three scope chips (`:251-253`, `Read`/`Trade`/`Withdraw`) and the footer caption (`:255-260`,
     *"Detected {time} from the exchange."*) render **unconditionally** whenever `perms` is present.
   - Observed on screen simultaneously: *"Could not contact the exchange to verify scopes"* AND
     *"Read ✓ Trade ✓ Withdraw ✓ · Detected just now from the exchange."* Both cannot be true.
   - ⛔ Worst arm: the chips asserted **Trade ✓ and Withdraw ✓** directly beneath the form's own copy
     *"Only read-only keys are accepted. Keys with trading or withdrawal permissions will be
     rejected."* A user who believes the chips concludes their read-only key carries withdraw rights.
     A user who believes the copy concludes the app is broken. The panel cannot be trusted either way.
   - **Fix shape:** when `probe_error` is set there is NO fresh probe result, so the chips and the
     "Detected … from the exchange" caption must not render as fact. Show them as unknown or omit
     them; the summary already carries the honest message. ⚠️ Do NOT fix by suppressing only the
     caption — the chips are the load-bearing false claim.
   - **Regression test must be witnessed RED:** render with `probe_error: true` plus non-null
     read/trade/withdraw and assert no scope claim is presented as detected. Neuter the guard,
     observe the failure first-hand, restore byte-identically.
   - **Belongs to Phase 162 (HONEST).** This is the phase's exact class — a rendered claim the data
     underneath contradicts — and it is the same shape as HONEST-02's freshness problem, one surface
     over. If 162's plan does not already cover it, add it there rather than point-fixing here.


0.07. **⚠️ The composite arm tells a `sampled_gapped` series a false provenance sentence.** Found and
   deliberately left live by Phase 161 (`161-07`, D-161-07-A) — it fell outside that task's declared
   file scope, so it was booked rather than silently widened into.
   - `SyncPreviewStep.tsx:1306` / `:1311` hardcode `GATE_SERIES_PROVENANCE_UNVERIFIED` for **every**
     inadmissible composite verdict. A `sampled_gapped` composite is therefore told *"nothing on our
     side recorded how that series was built"* — which is false: the series' provenance IS recorded;
     it simply has a gap (`nav_gap_days > 0`). Reachable via the FIX-2 downgrade, and currently
     pinned by a 142.2 test.
   - Same defect class Phase 161 exists to eliminate — a sentence that names a blocker other than the
     real one — so this is unfinished business of that phase, not new scope.
   - **Fix shape:** branch the composite arm's code on the actual verdict instead of hardcoding one,
     mapping `sampled_gapped` to its own reason. One-line fix recorded in
     `.planning/phases/161-wizerr-honest-error-surfaces/deferred-items.md`; the 142.2 pin moves with it.

0.08. **⚠️ A manager cannot release their own orphaned API key — no surface exists.** Found
   2026-08-24 during Phase 161 (WIZERR-03) execution, when the approved `161-UI-SPEC.md` remedy
   bullet turned out to be **unwinnable at HEAD** and had to be replaced rather than shipped.
   - The UI-SPEC said: *"Disconnect the unused key under Manage keys, then connect it here again."*
     Measured: the string `"Manage keys"` occurs **nowhere** in `src`. `ApiKeyManager` is mounted
     only on the per-strategy edit page (`strategies/[id]/edit/page.tsx`) — and an orphaned key by
     definition has no strategy. Profile → Exchanges is `allocatorOnly`, and the wizard user in this
     flow is a manager. `my-strategies` displays the orphan but its only control reopens the wizard
     that just refused.
   - So the honest refusal now shipping (`KEY_ORPHANED`) correctly tells the user their key is
     stranded — **and there is no place in the product where they can un-strand it.** The orphan is
     permanent: `cleanup_abandoned_wizard_drafts()` builds its candidate set only from drafts that
     same run is deleting, so a key with no draft is never a candidate again (re-measured at HEAD).
   - Shipping the original bullet would have breached the exact principle WIZERR-03 enforces — a
     remedy that cannot succeed. Filed by the executor as D-161-05-A; recorded here because it is a
     **product gap**, not a phase artifact.
   - **Fix shape:** give managers a key-release surface reachable without a strategy (extend the
     profile Exchanges panel past `allocatorOnly`, or add a control on `my-strategies`), then point
     the `KEY_ORPHANED` remedy at it.

0.09. **⚠️ MT5 generic fallback names a cause it has NOT proven — a false sentence in the arm that
   exists for "cause unknown".** Found 2026-08-24 during Phase 161 (WIZERR-01) execution; the plan
   deliberately did not touch it, and `161-UI-SPEC.md` holds arm 3 unchanged, so this is a scoped
   follow-up, not a regression.
   - `MT5_GATEWAY_MISCONFIGURED_DETAIL` (`analytics-service/services/mt5_probe.py`) reads:
     *"MT5 gateway refuses automated trading (the 'Disable automatic trading through the external
     Python API' option is in force), so read-only capability cannot be proven…"*
   - That parenthetical is **arm 2's specific claim** (`MT5_GATEWAY_EXTERNAL_API_BLOCKED_DETAIL`
     asserts the same option, legitimately, because arm 2 *is* that case). Arm 3 is the fallback
     used when **no cause is provable** — the A1 absent-key path and `classify_exception`'s
     allow-list degradation target. Asserting a specific option there is exactly the
     names-a-blocker-it-cannot-establish defect WIZERR-01 exists to eliminate.
   - **Currently low-urgency:** structurally unreachable from both raise sites (they enter the
     operator arm only via `terminal_trade_permission_off`, which forces arm 1 or 2). It survives as
     `Mt5GatewayMisconfigured()`'s default argument and as the allow-list's degradation target — so
     it CAN still surface.
   - **Fix shape:** amend `161-UI-SPEC.md` arm 3 to a cause-free sentence, re-run the 14-token fence
     check, change the constant, and re-run `test_mt5_validate_parity.py` (the default-argument pin
     `str(Mt5GatewayMisconfigured()) == MT5_GATEWAY_MISCONFIGURED_DETAIL` binds it). Founder call on
     the wording, since the UI-SPEC copy contract is an approved artifact.

0. **⛔ MT5 ARCHITECTURE — the shared gateway cannot safely serve more than ONE user, and the
   read-only guarantee can fail OPEN.** Found 2026-08-08 by the platform research that Phase 134
   specified but never executed (`153-EVIDENCE-mt5-platform.md`, `153-EVIDENCE-mt5-latency.md`).
   **Founder decision needed before any further MT5 build.**
   - **Structural:** `mt5linux` 0.1.9 starts a single `ThreadedServer(SlaveService)`; every rpyc
     connection `import MetaTrader5` resolves through that one process's `sys.modules`, so **all
     callers share ONE C-extension holding ONE logged-in account**. `login()` on any connection
     silently reassigns the account every other caller sees, and our `finally:` `close()` →
     `mt5.shutdown()` (`routers/exchange.py:449-466`) tears down the IPC pipe *for concurrent
     callers*, who then see `-10004`. rpyc namespaces isolate variable names, not C globals.
     Our own `Mt5AccountMismatchError` bracket (`routers/exchange.py:364-368`, test named
     `test_mt5_login_bracket_post_hijack`) **detects** this race — it cannot remove it.
     MQL5 moderators are explicit: one account per terminal, a separate installation per account.
   - **🔒 Security — read-only verification can FAIL OPEN.** `is_trade_capable`
     (`services/mt5_validation.py:133-149`) concludes "investor/read-only" when BOTH signals are
     negative (`trade_allowed` false AND `order_check` retcode ≠ 10009). But `trade_allowed` is
     false for several documented reasons besides investor mode — including the terminal's
     **default-ON** *"Disable automatic trading through the external Python API"*. Under that
     default a **MASTER password passes our investor probe** and is stored stamped read-only.
     We call `terminal_info()` **nowhere** (verified: zero hits in `analytics-service/`), so we
     cannot distinguish the two. Also: `_TRADE_RETCODE_DONE = 10009` is `[ASSUMED]`, and the real
     investor signal `10017 TRADE_RETCODE_TRADE_DISABLED` is never tested.
   - **Login classification is inverted both ways** (`services/mt5_validation.py:37-56`, both
     token tables `[ASSUMED]`): a wrong-but-known server returns `-6 AUTH_FAILED` → we blame the
     user's password; an *unknown* server **times out** rather than erroring.
   - **Data integrity:** MT5 history syncs asynchronously after login; first-call-empty is widely
     reported, with an unresolved **Wine-specific** report of history never arriving. Our
     `()` → `[]` "honest empty" rule turns that into a **confidently flat account**.
   - **Why none of this was caught:** CI never installs `mt5linux` (`Dockerfile:29` installs it
     into the image only); every contract test injects a `_connect` double
     (`services/mt5_client.py:135-141`). The real transport has never run outside production.
     Phase 134 designed `scripts/mt5_spike.py` to answer exactly these four unknowns — **the
     harness was never built and `analytics-service/docs/mt5-spike-gonogo.md` still has 38
     `human_needed` cells.** v1.15 shipped through a gate that was never opened.
   - **RESOLVED 2026-08-08 — founder chose option (3), and the "once per day" fact makes it the
     right answer on cost too.** See `docs/notes/mt5-scaling-cost-2026-08-08.md` (prices read
     2026-08-08) — but note that report models **one terminal per account**, which is the wrong
     model for us. MT5 accounts refresh **once per day**, and a daily sync is sequential, so ONE
     terminal serves many accounts across a day (capacity ≈ daily window ÷ cycle time). Corrected
     comparison:
     | | one-terminal self-host (what we have) | MetaApi, duty-cycled nightly |
     |---|---|---|
     | 25 accounts | ~$20/mo **flat** | ~$124/mo |
     | 100 accounts | ~$20/mo **flat** | ~$495/mo |
     | per extra account | **≈ $0** | $4.95/mo |
     The per-account marginal cost is ~zero until we exceed one terminal's daily throughput —
     then we add a second container, not a subscription. ⚠️ Throughput is currently
     **unquantified** because cycle time is uninstrumented; D-32 fixes that and is the input to
     any future revisit.
   - **Credential custody is the decisive non-price factor and it points the same way.** A managed
     provider means a third party holds customers' broker investor passwords — a GDPR
     sub-processor whose blast radius is every MT5 user at once. Quantalyze sells verified track
     records to allocators; this surfaces in diligence. Self-hosting keeps it in our own store.
   - ⚠️ Useful even though we are not buying: MetaApi bills **6 hours minimum per server start**,
     so a wizard validation there would cost ~$0.144 a click — rate-limiting interactive
     validation is sound design regardless of provider.
   - ⛔ **API2Trade: do not use** for anything holding credentials — domain created 2026-04-13,
     no Wayback history, ~5h of status-page history, yet claims "10,000+ Active Accounts", two
     different legal entities named across the site, mail-forwarding address in the Imprint.
   - **Revisit trigger** (not a task): if we ever need *interactive* MT5 at a rate that saturates
     one terminal, or if a second replica is proposed (which breaks the one-session invariant —
     D-33), re-open this with real cycle-time data in hand.
   - ⚠️ **Interacts with Phase 153 WIZFORM-05:** the 30 s wall is *also* a real timeout inversion
     (`initialize()` unbounded at its 60 s vendor default inside a 30 s rpyc bound — D-24), but
     fixing the timeout on a one-account architecture buys a working single user, not a working
     product. Decide the architecture before sizing the budget.

0.4 **⛔ PHASE 153.6 — PARITY: the fixes that only landed on one path (✅ SHIPPED 2026-08-12 as PR #675, v0.58.0.0 — residual above).**
   Raised by `/code-review xhigh` over the whole 153→153.5 span (40 agents, 29 verified findings
   → 13 distinct defects). **Nine come here**; two were fixed unplanned in the same session; two
   are deliberately out. Full charter in `.planning/ROADMAP.md` under *Phase 153.6*.
   ⭐ **The shape is "the fix landed once, not twice."** Three of the four root causes are the
   same failure — a correct remedy applied to one path while its duplicate went untouched, with
   no guard asserting the two agree. Found *inside the span whose own charter said "fix it at
   the SINK, not three times"*. Close each cluster by making the two paths **unable to diverge
   again**, not with N patches.
   | Cluster | What |
   |---|---|
   | **A** (3) | `services/ingestion/mt5.py` never got 153.3's `routers/exchange.py` fixes: the `order_check` short-circuit (without it `_WRONG_SERVER_TOKENS` turns an operator refusal into a 400 accusing the user's BROKER SERVER — the exact documented incident), the broad materialization catch (an unscrubbed rpyc raise is a credential-disclosure surface, T-134-01), and a bare `RuntimeError` documented PERMANENT that the worker actually **RETRIES** via `classify_exception`'s unknown fall-through |
   | **B** (3) | broad `except`s re-absorbing `Mt5SessionAbandoned` upstream of D-42's classify arms: one mislabels a fence incident as a gateway fault that never happened; one 503s it into the **mt5-gateway breaker**; plus `restart()` check 2 raising inside `_timed`, emitting the stage event check 1 was placed outside `_timed` to avoid |
   | **C** (1) | `connectAbortDeadlineMsFor` sized against the branch table's **closed**-breaker column when the governing one is **failing** (175 500 vs 165 000 ms serialized) → CR-01's "nothing was saved" lie is reachable again ~10.5 s before the route finishes writing. ⛔ **Two halves — the number AND the oracle**, which pins the wrong column and so cannot red on it |
   | **D** (1) | 🔒 **SECURITY, LIVE ON PROD.** `REVOKE UPDATE ON api_keys` is bypassable by DELETE + re-INSERT (`authenticated` keeps INSERT/DELETE; the browser already holds the server-minted ciphertext), and that same client-writable `exchange` is the sole authority for skipping finalize-wizard's ASVS V4 scope probe. ⚠️ SELF-targeted control bypass, **not** a tenant leak. The migration is on `main` and `supabase/migrations/**` auto-applies to PROD. ⛔ Needs a design decision, not a patch |
   | **E** (1) | a probe parse miss moved off `KEY_NETWORK_TIMEOUT` onto `KEY_SCOPE_CHECK_UNAVAILABLE`, removing Retry for a condition a rolling deploy produces. Here rather than ad-hoc because error codes ripple into 153.1's pinned tables (re-cut, never delete) |
   📌 **OUT (decided):** MT5 as a **composite member** — 153.4's CR-03 fix made an MT5 composite
   panel reachable for the first time and `run_stitch_composite_job` has no `mt5` arm, so it
   permanently `_stamp_failed`s the job. That is a **product decision** (teach the worker MT5, or
   block MT5 in the composite wizard), natural neighbour **Phase 155**. Also out: the epoch never
   re-binds (`_assert_live` binds on first touch only, so one `Mt5Client` serves exactly one
   lease) — no production path does this, all five lease blocks ast-verified, and 153.5 already
   pinned the constraint naming its future fix (rebind on lease entry).

0.5 **✅ PHASE 153.5 COMPLETE 2026-08-11 — the abandoned-`to_thread` class (three review findings, ONE defect).**
   Raised by the `/code-review high` of Phase 153.3 (2026-08-09, 10 findings reported, 4 fixed
   immediately). **CLOSED: 5/5 plans, verification passed 22/22 must-haves.** The fence is TWO
   mechanisms (D-36 as amended) — a `terminal_key`-keyed epoch registry fencing method calls, and
   a lease-occupancy `ContextVar` fencing construction, since a method-level fence cannot reach
   finding #6 (the zombie sits inside `__init__`'s blocking connect with no method to guard).
   Preconditioned on routing the three raw `async with _mt5_terminal_lock_for(...)` acquisitions
   through the lease — **including finding #5's own path**, without which a bump in the lease
   `finally` would have left the headline finding open with every test green.
   ⚠️ **Two limits ACCEPTED, in code not just docs:** the fence cannot un-send an rpyc call already
   dispatched on the wire (`sync_request_timeout` is client-side only), and a construction
   *completing* between the `wait_for` firing and the bump still leaks one socket — narrowed, not
   closed. ⚠️ Its follow-on review findings are booked as **Phase 153.6** (item 0.4 above).
   Historical charter lives in `.planning/ROADMAP.md`
   § *Phase 153.5*; context at
   `.planning/phases/153.5-wizform-abandon-work-that-outlives-its-timeout/153.5-CONTEXT.md`.
   This entry is the backlog mirror of that charter, not the reminder that it is unplanned.
   **The one defect:** work handed to `asyncio.to_thread` **outlives its `asyncio.wait_for`**. The
   `wait_for` raises, the caller unwinds and releases the terminal lease, and the abandoned thread
   keeps driving the same process-global MT5 session. Three faces, all in the 153.3 diff:
   📌 **Anchors are SYMBOLS, not line numbers** — the original 153.3-era citations rotted (#6 and
   #7 were off by ~30 and ~130 lines; #5 still held). Line hints are `as of 2026-08-11` only:
   **if a hint disagrees with its symbol, the symbol wins.**
   | # | Site (symbol anchor; line hint as of 2026-08-11) | Symptom |
   |---|---|---|
   | 5 | `services/mt5_concurrency.py` › `_mt5_bounded_restart` — the `wait_for(to_thread(client.restart), timeout=_MT5_RESTART_TIMEOUT_S)` (~L118) | `_mt5_bounded_restart` abandons at 10s; the one permitted `mt5.shutdown()` can fire **after** the lease is released, under the next holder |
   | 6 | `routers/exchange.py` › `_validate_mt5_key_probe` › nested `_connect_and_probe`, **STAGE 1 — connect** (~L513) (+ `services/ingestion/mt5.py` › `Mt5Adapter.validate`, the `wait_for(to_thread(_build_client))` inside the lease, ~L207) | connect-stage timeout orphans an `Mt5Client` the thread then constructs — `client` was never assigned, so the Pitfall-6 `finally` releases nothing and the rpyc session leaks |
   | 7 | `routers/exchange.py` › `_validate_mt5_key_probe` — **THE ONE END-TO-END DEADLINE (D-03)**, `wait_for(_connect_and_probe(), timeout=_MT5_VALIDATE_DEADLINE_S)` (~L817) | the end-to-end deadline fires; the abandoned probe keeps issuing rpyc calls, so D-29's serialization does not hold on the timeout path |
   ⭐ **Fix it at the SINK, once — not three times.** Patching three call sites is precisely the
   instance-not-class mistake this milestone has paid for sixteen times, and #5/#6/#7 are the same
   mechanism. Candidate designs (needs a real decision, do NOT let a fixer improvise):
   a cancellation-aware wrapper; a generation/epoch counter the terminal checks before each call;
   or refusing to release the lease until the worker thread confirms it has stopped.
   ⚠️ **The AST lease-roster CANNOT see this** — its enclosure proof is *lexical*, so it reads the
   `shutdown` as inside `async with` and passes while the runtime escapes. Any fix needs a
   **runtime** assertion (observe the abandoned thread touching the session after release), not a
   second static pin. Guard #16 of the phase lives here.
   **Deferred to Phase 155 (needs the real latency data D-32 just made collectable — do NOT guess
   these numbers):** finding #8, the 60s per-stage ceiling wraps SIX round-trips whose own ceilings
   are 45 000ms IPC / 55s rpyc, so "innermost fires first" holds per round-trip but not per stage
   (re-censors exactly the slow-but-working login D-24 unblocked); and finding #10, the 20s
   interactive lease wait is smaller than the worker's 40s read + 10s restart hold, so an
   interactive validate can never wait out one in-flight derive.

0b. **✅ RESOLVED 2026-08-21 — [158-MUTEX-01] shared-test-db mutex holder dies at ~120s —
   serialization guarantee lasts only the first ~2 minutes of each CI job's DB span.**
   Found 2026-08-21 by the Phase 158
   closure's adversarial ship review; mechanism MEASURED: the TEST project sets server-wide
   `statement_timeout=120000` ("configuration file" source in `pg_settings`; no `postgres`-role
   override), which kills the holder's single-statement `SELECT pg_sleep(6000)` at 120s → psql
   exits → session drops → `pg_advisory_lock(61616158)` released while the job's DB work
   continues. ci.yml's release-step detection (`##[error] mutex holder pid … died … ran
   UNSERIALIZED`) fired on every long-job evidence run (32424762495 ×2, 32426772489 ×2,
   32447308698 ×1); the mutex-probe never trips it (45s holds). Contended acquires waiting
   >120s are at risk via the same kill (retry loop masks it). **Fix (one line, three sites):**
   prepend `-c "SET statement_timeout = 0;"` to the holder psql invocation in all three
   acquire steps (sql-tests / python / e2e-seeded) so both the lock wait and the sleep are
   exempt; update `docs/runbooks/shared-test-db-mutex.md` section 2 (WR-01 invariant gains a
   third leg: sleep > TTL **and** no server-side statement kill) and the B24/mutex pins in
   `src/__tests__/critical-regressions.test.ts` if they assert the psql arg shape. Ship as its
   own reviewed PR immediately after the Phase 158 closure PR lands. Closure record already
   carries the defect (158-VERIFICATION.md Known-open, 158-UAT.md item 1(d) correction).
   *Scope note (2026-08-21 post-closure doc review):* the waiter side is confirmed broken
   too — the acquire is one `ON_ERROR_STOP=1` psql, so a contended `pg_advisory_lock` wait
   dies at 120 s and the 3-attempt loop then reports it as "a CONNECT/session fault, NOT
   lock contention" (ci.yml:1222/1664/2300); effective tolerance under real contention is
   ~3×120 s, not the 3600 s cap. Defeated-claim blast radius exceeds runbook §2: runbook §1
   (waiters block/queue), §3 (waiter-count triage), §5 (~20 min hold / quiet-CI drill
   advice) and CONTRIBUTING.md's unqualified serialization claim all assume a long-lived
   holder — sweep them in the fix PR.
   **Resolution (branch `fix/158-mutex-statement-timeout`):** `SET statement_timeout = 0`
   is now the FIRST `-c` statement of the holder psql invocation in all three acquire
   steps (kept byte-identical; exempts both the contended `pg_advisory_lock` wait and the
   `pg_sleep`), the retry-loop error no longer asserts a mid-wait kill is "NOT lock
   contention", and the release-step comment records that a dead holder is now unexpected.
   Runbook §§1/2/3/5 swept (§2 blockquote → RESOLVED record, WR-01 stated three-legged,
   numbers table refreshed, §5 notes the 45 s probe cannot witness this class) and
   CONTRIBUTING.md's serialization claim qualified. New pin in
   `critical-regressions.test.ts`: exactly 3 exempt holder invocations with the `SET`
   before `pg_advisory_lock` — proven able to fail (one site neutered 0→120000 → RED on
   exactly that job, 1 failed | 143 passed; restored → 144 passed).
   **Completed:** v0.69.1.0 (2026-08-21)

0c. **✅ RESOLVED 2026-08-21 — [158-MUTEX-02] orphaned mutex holder BACKEND outlives its
   killed psql client — zeroing statement_timeout removed the accidental janitor, so an
   orphan holds the lock for its full 100-minute sleep and starves every waiter.**
   Second-order consequence of [158-MUTEX-01], observed live on PR #701's own CI run
   32457330139: the python job's release step killed the psql CLIENT (pid 2202, 07:15:19)
   and printed the orderly release line, but a backend executing `pg_sleep(6000)` never
   reads its client socket, so the SERVER backend (pid 3484961, backend_start 07:09:22)
   kept `pg_advisory_lock(61616158)`. Before 158-MUTEX-01 the server-wide
   `statement_timeout=120000` reaped such orphans at ~120s BY ACCIDENT; zeroed, they are
   immortal. sql-tests and e2e-seeded starved on the lock; e2e-seeded hit the 3600s
   acquire cap and FAILED (job 96697217891, "Lock census: 1 granted, 2 waiting"). Same
   mechanism: a waiter whose psql client died (job timeout) lingers as a zombie backend
   blocked in `pg_advisory_lock()` — a lock wait does not read the client socket either.
   **Resolution (same branch/PR, `fix/158-mutex-statement-timeout`):** every mutex
   session (three acquire steps, kept byte-identical, + the probe contender) now also
   sets `client_connection_check_interval = '30s'` (verified USERSET on TEST PG 17.6) —
   the backend polls its client socket during query execution AND lock waits, aborting
   within ~30s of the client dying, covering both the sleeping holder and the zombie
   waiter. The holder additionally prints `HOLDER-BACKEND-PID <pid>`; the release step
   reaps that backend server-side via `pg_terminate_backend` guarded by a `pg_locks`
   check on key 61616158 + pid (no-op if the backend already exited / pid recycled), so
   the lock frees immediately instead of after ~30s. Runbook §§1/2/3/5 swept ("zeroes
   statement_timeout" → "sets both GUCs"; live census + cleanup SQL recorded in §3);
   pins extended in `critical-regressions.test.ts` (ccci membership in all four mutex
   sessions + guarded release-step reap + holder statement order) — each proven able to
   fail by neutering one site (ccci removed from python → RED naming python, 3 failed |
   144 passed; reap removed from python's release → RED naming python, 1 failed | 146
   passed; restored → 147 passed).
   **Completed:** v0.69.1.0 (2026-08-21)

0d. **✅ RESOLVED 2026-08-26 — the 15 rows were DELETED from PROD (see `D-162-1` below); 0
   `is_example` strategies remain, so this census finding no longer describes reality. Kept as
   the record of why RANK-01's badge floor mattered.** Original text follows.

   **[159-SEED-01] 15 published `is_example` strategies sit at `computation_status =
   'failed'` while still carrying KPI values — PROD, since 2026-05-27.** Measured by the
   phase-159 C-M1 census (`.planning/phases/159-rank-public-ranking-integrity/159-CENSUS.md`,
   run read-only against PROD 2026-08-21): of 18 published strategies in the only category
   (`crypto-sma`), 17 fail the `isComputedAnalytics` gate and 15 of those are seeded example
   rows whose analytics have been `failed` since 2026-05-27 yet still hold `sharpe`/`cagr`.
   **Consequence once RANK-01 lands:** `crypto-sma` drops from 18 → 1 gate-passing strategy,
   crossing the `< 5` badge floor, so **every percentile badge on the public discovery
   surface stops rendering**. The gate is CORRECT — a failed computation must never produce a
   published rank — so this is not a reason to weaken it (D-01 pre-decided that a
   disappearing rank is the honest outcome). But the badge loss is driven by demo-data
   quality, not real user data: only 2 real strategies are gated out and 1 real strategy
   survives.
   **This is a data-repair item, not a code item, and was explicitly OUT of phase-159 scope.**
   Remedy options (pick one, do not leave implicit): (a) recompute analytics for the 15
   example strategies so they reach a terminal success status; (b) unpublish them if they are
   no longer wanted as demo content; (c) accept a badge-free discovery surface until real
   published strategies reach the floor. Whichever is chosen, the discovery page's emptiness
   after RANK-01 must be a decided state, not a surprise.
   **Recorded:** 2026-08-21 (phase 159, census C-M1 / C-D1 surfacing)

0e. **[159-BASIS-FLIP] ScenarioComposer: blend basis flips 365→252 mid-render while a
   drawer-added leg's `/returns` probe is in flight.** Red-team finding (2026-08-23,
   INVESTIGATE): a drawer-added leg has no `addedAssetClassById` entry until its probe
   settles (`ScenarioComposer.tsx` ~:1465), so RANK-06 resolves the in-flight null to the
   conservative √365 clock and the settled `'traditional'` to √252 — a pure-tradfi blend's
   displayed vol/Sharpe/Sortino visibly change with no user action, as a function of
   network timing. The steady-state values are honest in both states; only the transition
   is jarring. **Product decision needed:** suppress the basis-dependent metrics (or hold
   the panel) until every selected leg's class has resolved, or accept the flicker as the
   cost of never showing a flattering interim number. Not a phase-159 blocker.
   **Recorded:** 2026-08-23 (phase 159 red-team, finding 3)

0f. **[159-SIMPLIFY-DEFER] metrics.py inline qstats math: extract shared primitives when
   closing the RANK-05 scalars residual.** /simplify pass (2026-08-23, 4-lens Opus review)
   converged on the same shape from three angles: the inlined sharpe/sortino/smart-*
   formulas in `compute_all_metrics` are now 2–4 hand-copies of the same math
   (downside-RMS twice with already-divergent NaN denominators; annualized Sharpe/vol in
   three spellings incl. `sharpe_vol_status_from_backbone`), and the deferred
   `compute_qstats_scalars` closure will need a THIRD copy unless the formulas are first
   extracted as module-level primitives (`_downside_rms`, `_annualized_vol_sharpe`, …).
   Do the extraction AS PART OF the scalars follow-up (WINDOWS.md RANK-05 residual), not
   before — parity tests already pin each site. Also queued for that pass: rewrite the
   line-oriented RANK-05 region gate to AST-walk `qs.stats.*` calls (formatting-immune),
   and consider deriving `PERCENTILE_ANALYTICS_COLUMNS` + csv-finalize's
   `CLOCK_SAFETY_KPI_COLUMNS` + the select strings from ONE exported KPI array so the
   byte-freeze + mirror-prose machinery can be deleted. Skipped same-pass because each
   reshapes just-red-teamed money-math or test machinery right before ship.
   **Recorded:** 2026-08-23 (/simplify, phase 159)

0.12. **🎨 FreshnessChip's longest label overflows its masthead column — measured in a real browser.**
   Found 2026-08-26 during the phase-162 browser pass on localhost/TEST (the first time this phase
   was rendered outside jsdom). Measured on the factsheet v2 masthead at 1485px viewport:
   - `COMPUTED · FRESH` → 1 line, 204.2px — fits
   - `TRACK RECORD · OLD` → 1 line, 204.2px — **fits** (this was the badge fixer's flagged worry; DISPROVED)
   - `TRACK RECORD · FUTURE — CHECK DATA` → **297.9px in a 204.2px container** — overflows
   The row is `flex … justify-end`, so it pushes left rather than wrapping.
   **Reachable:** the `future` tone fires on a future-dated input, and the chip names whichever fact
   carried the verdict — so a future-dated SERIES END produces exactly this string. That is the case
   `NEW-C20-07` exists to catch, so it is not hypothetical.
   **Severity: cosmetic.** The sentence is TRUE; only its width is wrong. Not user-deceiving, so
   non-blocking per the stopping rule.
   **Fix candidates:** shorten the future label on the series arm (e.g. `TRACK RECORD · FUTURE`), or
   let the label row wrap at this breakpoint. Re-measure in a browser — jsdom cannot see this class.

0.11. **📋 Expect FOUR red SQL gates on the phase-162 PR, not two — do not read the extra two as regressions.**
   Recorded 2026-08-26 from the phase-162 code review (IN-01). Nothing applies migrations to the
   TEST project (`supabase-migrate.yml` targets PRODUCTION only, and the `sql-tests` job globs
   `supabase/tests/test_*.sql` and psql's them with no apply step), so every gate that asserts its
   migration is present hard-fails until someone applies it by hand.
   The accepted list named only the two NEW gates. Two AMENDED files fail for the same reason:
   - `supabase/tests/test_create_wizard_strategy_for_key.sql` (new)
   - `supabase/tests/test_compute_jobs_error_kind_copy_parity.sql` (new)
   - `supabase/tests/test_sync_status_marked_refresh_protected.sql:210-214` — gate 0b, needs `20260826120000`
   - `supabase/tests/test_retention_orphaned_running.sql:261-266` — V-1 canary + F-3 counts, needs `20260826140000`
   ⭐ These are deliberately fail-loud and must NOT be softened into skips — CI rejects whole-file
   SKIPs as of 2026-08-25 precisely because a skipping gate reads green while asserting nothing.
   **Clears when** `20260826120000` and `20260826140000` are applied to TEST, in that order.

0.10. **⚠️ The wizard preselect can render a dismissal control that does nothing.**
   ⚠️ *Id note: this is the zero-padded `0.01`–`0.10` series. Do NOT confuse it with the legacy
   unpadded `0.1` / `0.2` / `0.3` items further down, which are a different, older scheme and are
   cited by `docs/runbooks/ledger-refresh-go-live.md` and `.planning/STATE.md`.* Found by the
   B-2 fixer while closing the KEY_REUSE_UNAVAILABLE dead end (2026-08-26); recorded, NOT fixed.
   `onUseDifferentKey` is an OPTIONAL prop while `preselectKey` is also optional, so a host can in
   principle render the preselect branch with no dismissal handler. The "Use a different key"
   button would then paint as a no-op — and because `KEY_REUSE_UNAVAILABLE`'s copy now NAMES that
   control as the remedy, the refusal would point at a dead button. That is the same unwinnable-loop
   class the fix just closed, one prop away.
   **Not live today** (measured): `ContributionWizardOverlay:302-303` passes both and
   `WizardClient:1262-1263` forwards both, so no host omits it. Severity is guard-hygiene, not
   user-facing — filed per the stopping rule, not blocking.
   **Fix:** make the two props co-travel in the type (a discriminated union on the preselect
   branch), so a host that supplies `preselectKey` MUST supply `onUseDifferentKey`. Requires
   editing `WizardClient.tsx`, which the fixer did not own.

0.1. **⛔ LEDGER-BACKED VENUES HAVE NO RECURRING STRATEGY REFRESH — MT5 factsheets go stale
   silently, forever.** Founder-reported 2026-08-23 ("MT5 strategies are not being read out every
   day, and data gets stale"); root-caused by measurement against PROD 2026-08-24.
   - **Measured on PROD.** `strategy_analytics` for the 4 live MT5 strategies: newest
     `2026-08-21 13:51`, oldest `2026-08-04 14:20` (17–20 days). Same query for okx:
     `2026-08-23 21:44` (~2h). MT5 `api_keys.last_sync_at` is FRESH (`2026-08-23 04:09`).
   - **Root cause.** `process_key_long` is the ONLY path that reaches `strategy_analytics` for a
     ledger-backed venue. There is **no recurring enqueuer for it anywhere.** The two
     daily strategy-keyed crons both gate on ccxt-only closed sets that exclude mt5:
     `/api/cron/reconcile-strategies` (03:30) on `RECONCILABLE_EXCHANGES = FUNDING_EXCHANGES`
     = binance/okx/bybit, and `/api/cron/sync-funding` (04:00) on the same set. The 15-min
     `cron_sync` defers anything outside `EXCHANGE_CLASSES` (binance/okx/bybit/deribit) at
     `routers/cron.py:182`. So after onboarding, an MT5 strategy is never recomputed again.
   - ⚠️ **CORRECTED 2026-08-25 (re-measured at HEAD `57a407ea`).** Two refinements this entry
     originally got wrong or left implicit:
     1. **`process_key_long` is not enqueued from `api/strategies/finalize-wizard`** — that route's
        own test asserts the opposite (`route.test.ts:1630`). At HEAD it is enqueued at two Python
        sites: `analytics-service/routers/process_key.py:1517` and `:765`.
     2. **The three ledger venues are ASYMMETRIC.** Only mt5 and sfox hit the `:182` deferral;
        deribit is IN `EXCHANGE_CLASSES` (as this entry already notes) and instead falls to the
        `stored > 0` fill-count filter at `routers/cron.py:471-472`, which is structurally wrong
        for a settlement-ledger venue. Any fix scoped as "venues absent from `EXCHANGE_CLASSES`"
        silently drops deribit — scope off `_LEDGER_BACKED_SOURCES` instead.
     3. **Re-enqueuing `process_key_long` is a provable no-op**, so the naive fix ships green and
        does nothing: `long_fetch.py:154` returns `DONE` on `published`, `:193` on the whole
        `advanced_statuses` set, and every onboarded strategy is `published`.
     Full detail in `.planning/phases/161.1-.../161.1-RESEARCH.md`.
   - **Why it stayed invisible.** The two pg_cron KEY-scoped jobs that DO cover mt5 —
     `poll_allocator_positions` (04:00) and `refresh_allocator_equity_daily` (05:00) — run clean
     every day and advance `last_sync_at`. Key-mode `derive_broker_dailies` explicitly does NOT
     stamp `strategy_analytics` (`job_worker.py:2366` docstring: the per-key series is "dark").
     Net effect: the UI reads "synced 20h ago" on a factsheet that is weeks old. Zero errors,
     zero failed jobs — 14-day `compute_jobs` census shows no MT5 failures at all.
   - **⛔ Two fixes that look right and are NOT.** (a) Adding mt5 to `RECONCILABLE_EXCHANGES`:
     `run_reconcile_strategy_job` calls `fetch_raw_trades` (ccxt) — mt5 is in
     `_LEDGER_BACKED_SOURCES`, so this is the BYB-02 ccxt-fill class. (b) Re-registering the
     `derive-allocator-key-dailies` cron: it is key-mode (never stamps `strategy_analytics`), it
     was DELIBERATELY unscheduled at the v1.11 recovery, and
     `docs/runbooks/flipretry-derived-equity-go-live.md:171` forbids re-registering it via a
     migration — an auto-applying migration paired with a silently-skipped worker deploy recreates
     the v1.11 wedge verbatim. A migration doing exactly this was written and DELETED unmerged
     on 2026-08-24 after `migration-reviewer` caught it.
   - **Shape of the real fix.** A recurring strategy-keyed enqueuer of `process_key_long` for
     ledger-backed venues (mt5/sfox/deribit), which chains → `derive_broker_dailies` (strategy-mode)
     → `compute_analytics_from_csv` → `strategy_analytics`. ⚠️ Carries the v1.11 worker-wedge risk
     shape: MT5 serializes on ONE shared terminal (`services/mt5_concurrency.py`) at a 15-min
     timeout per key. Founder-gated activation (schedule left unregistered, SFOX_ENABLED pattern)
     is the safe landing. NOT yet built.
   - ⚠️ **PROGRESS 2026-08-25 (Phase 161.1) — built, DORMANT, and this entry stays OPEN.**
     Shipped: `supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql` (the
     read-only freshness surface, keyed on the max date inside `returns_series` — a signal no
     status transition can advance); `supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql`
     (`enqueue_ledger_refresh_for_strategies()`, a staleness-gated, bounded fan-out on the chain
     TAIL, fail-closed behind the `app.ledger_refresh_enabled` database setting); the D-15
     non-destructive failure guard in `job_worker.py`; and the founder-gated activation runbook
     `docs/runbooks/ledger-refresh-go-live.md`.
     - **The A7 unknown is closed.** The recurring mt5 `derive_broker_dailies` →
       `strategy_analytics` path had never run end-to-end. Executed on PROD 2026-08-25: PASS —
       `last_return_date` 2026-08-21 → 2026-08-25 (+4 real bars), status held
       `complete_with_warnings`, whole chain 44 s.
     - ⛔ **NOT CLOSED, and not closable by merging.** The mechanism ships DORMANT by design: no
       schedule is registered anywhere in the repo, and the fan-out returns 0 until a founder
       executes the runbook's two LIVE ops. **A merged-but-dormant fix is not a fixed defect.**
       Recording this closed at merge would put a green badge over strategies that are still going
       stale — which is precisely the failure mode this phase exists to eliminate, committed by
       the ledger that is supposed to track it. Close it only after the runbook has been executed
       and the staleness view's stale count is observed to drain.
   - **Adjacent, separate:** the `bybit` key has been failing since 2026-08-14 with
     `retCode 33004 "Your api key has expired."` — last good sync `2026-08-06`. Needs replacing;
     nothing surfaced it.

0.2. **⚠️ SIBLING DEFECT — a ccxt strategy with no new fills also never recomputes.** Raised as
   OQ-5 by Phase 161.1's research and **deliberately left out of scope** there: different venue
   class, different mechanism. Filed here so it is not lost in a phase directory.
   - **Measured at HEAD.** `analytics-service/routers/cron.py:471-472` builds the recompute list as
     `[sid for sid, stored in per_strategy_stored.items() if stored > 0]`. The recurring recompute
     is therefore gated on a **positive stored-fill count**, so a strategy that traded nothing on a
     given day is dropped from the list and is not recomputed at all. A flat trading day produces
     no recompute — the same "nothing happened, so nothing was refreshed" shape as the ledger
     defect above, arrived at by a different route.
   - **Adjacent, same file, same family:** the comment at `:466-469` records that a *failed* enqueue
     is never re-driven either, because `last_sync_at` has already advanced — so the next tick
     fetches no new trades and recomputes nothing. Recovery relies on the daily/portfolio cascade
     or a user-triggered recompute. Another instance of `last_sync_at` advancing while the
     analytics behind it do not.
   - **Why it is less visible than the ledger case:** ccxt venues currently sit at 0 days stale
     (okx, bybit), because those strategies do trade. The gap opens on a quiet strategy, not on a
     broken one — so it will surface as one stale factsheet, not an outage.
   - **This is cheap to detect now.** The staleness view Phase 161.1 shipped
     (`public.ledger_refresh_staleness`) surfaces the ccxt cohort **for free** if the venue filter
     is dropped from the view's row restriction (`… WHERE sv.exchanges && lv.venues`). The
     freshness verdict itself is venue-agnostic.
   - **Fix shape:** a staleness-gated fan-out generalises to this directly — the 161.1 fan-out's
     predicate is "stale AND live AND not in-flight AND outside the cooldown", none of which is
     ledger-specific. What changes is the cohort and the enqueued kind.
   - **Also out of scope, recorded for whoever picks this up:** per the 161.1 PROD census
     (2026-08-25), **34 of the 37 `failed`-status rows are the CSV cohort**, not the ledger venues
     and not ccxt. That is a third, separate population needing its own diagnosis — do not fold it
     into either fix.

0.3. **📋 DISPOSITION (D-COMP / D-01, decided 2026-08-25) — composite ledger strategies, and the
   coverage gap the decision leaves open until the composite arm lands.**
   - **Resolved: option (a) — MT5-only composite deferral.** Founder's words were *"on mt5 no
     composites"*, so the deferral is scoped to MT5 and never to deribit. Option (b) ("exclude all
     composites") was rejected because deribit's **only** live PROD strategy IS a composite, so (b)
     would have left the venue the whole ledger pipeline was built for sitting in the refresh set
     with nothing to refresh.
   - **How it was implemented, which is not quite how it reads.** The single-key fan-out
     (`20260825130000`) excludes **all** composites by an explicit `is_composite = FALSE` conjunct —
     kept and commented deliberately, so a future MT5 composite is *skipped by name* rather than
     silently mishandled. Deribit's coverage was moved to a **separate composite arm on
     `stitch_composite`** rather than being carved out inside that one predicate.
   - ⛔ **The honest consequence, and the reason this entry exists.** Until that composite arm
     lands, **deribit is in the refresh set with nothing refreshing it** — the single-key fan-out
     skips its one strategy, and the composite arm is not yet built. A venue-coverage check that
     asserts set membership passes green over exactly that state. This is the interim shape option
     (b) was rejected *for*, so it must not be allowed to become permanent by inattention.
   - **UPDATE 2026-08-25 (phase 161.1 plan 04) — half of the close condition is met.** The
     composite arm now EXISTS: `enqueue_ledger_composite_refresh`
     (`supabase/migrations/20260825140000_ledger_refresh_composite_arm.sql`), shipped **DORMANT and
     UNSCHEDULED** behind the same fail-closed `app.ledger_refresh_enabled` setting as the
     single-key arm, with an 8-arm matched-pair SQL gate and static gates 10–11.
     ⛔ **The second half is NOT met and this entry stays OPEN.** No deribit composite has been
     observed to refresh. The `stitch_composite` path has never run recurrently, so plan 04's task 3
     requires ONE manual PROD enqueue observed to completion — `last_return_date` advancing in the
     staleness view — **before** the composite schedule is documented as activatable. Until that
     tracer passes, deribit's coverage is a mechanism that has never been exercised end-to-end,
     which is a *different* state from the one above but is **not** the close condition.
   - **Close condition:** the composite arm exists and a deribit composite is observed to refresh —
     `last_return_date` advancing in the staleness view, not a job going green.

1. **`RESEND_API_KEY` unset in Vercel prod** — founder-LP report cron + all transactional
   email are dead (code soft-skips, only Sentry fires). **Founder action:** set the key in
   Vercel prod. Do before the first warned founder month. (Note: portfolio email *alerts*
   are out of the pipeline as of 2026-07-25 — the `alert-digest` cron was removed; alerts
   surface in-app + engineering failures via Sentry. This item is now only about the
   founder-LP report + transactional email.)
   **Widened 2026-07-31 (phase 141.1-08):** the flag-monitor error-rate alert now also
   depends on this key. `sendErrorRateAlert` only emails when `resend && founderEmail` are
   truthy; otherwise it returns `action: "alerted"`, logs, and sends nothing — founder-facing
   silence one layer *below* the numerator 141.1-08 just repaired. Test `I-T6` pins the
   soft-skip as intended code behaviour, but the operational gap is unverified. **Founder
   action:** confirm `RESEND_API_KEY` *and* `FOUNDER_LP_REPORT_TO` in Vercel prod before
   treating this alert as live.
2. **Deribit / Zavara mandate reconciliation (go-live).** Performance reconstructs from the
   API alone (green: cum 62.66% / maxDD −4.13%). The reported capital **4M/10M/1M/2M is
   custodied at Matrixport (keys 1&2) / LiquidityTech (key3), NOT in the Deribit keys** —
   the accounts hold only a $150–750K working-margin slice. **Custodian-statement
   reconciliation is dropped (founder call 2026-07-25) — the API reconstruction stands as
   ground truth.** Zavara live *activation* (write the proven reconciliation config to a
   `strategies` row) remains, pending a founder trigger + strategy id.
3. **sFOX / Nautilus manager-data go-live (v1.13 founder flags).** Pending founder ops:
   EGRESS / WORKER-01/03/04 / FACTSHEET / E2GT-01 / FLIP / GOLIVE. **Reframe:** manager
   data = Nautilus DD API (`api.nautilus.finance`, x-api-key), not sFOX direct — the "sFOX
   key" was a Nautilus key. Enable path = set `NEXT_PUBLIC_SFOX_ENABLED` + `SFOX_ENABLED`
   in Vercel + redeploy main (build-time flag); IP-whitelist the 3 worker egress IPs
   {208.77.244.242, 152.55.184.240/.241} with Nautilus (7-day access, email all 3).
   **Founder decision:** sFOX-venue vs Nautilus-manager path; actual vs adjusted NAV.
5. **v1.15 MT5 — LIVE on quantalyze.xyz 2026-07-25 (flags flipped).** ✅DONE: worker
   `MT5_ENABLED=true` + `MT5_GATEWAY_HOST=mt5-gateway.railway.internal` + `MT5_GATEWAY_PORT=8001`
   (Railway deploy 9d310b40 from main HEAD — also retired the decoupled CLI-snapshot, so the
   worker deploy source is GitHub-tracked again) + Vercel `NEXT_PUBLIC_MT5_ENABLED=true`
   (`vercel --prod` fresh build dpl_AMiWsz…, since NEXT_PUBLIC_ is build-time inlined). Founder
   flipped without pre-rotating the investor pw (read-only) and shortcut the 5–10d soak window
   (day-1 green + full factsheet already proven on the real Vantage acct). Gateway RPyC bridge +
   worker deps + soak history: v0.49.1.0→0.49.3.0, see memory `project_v1_15_metatrader5_milestone`.
   **Server-UTC offset now SET (2026-07-25):** `MT5_SERVER_UTC_OFFSET_S=10800` on the worker
   (EEST/UTC+3, matching the validated soak) — the live derive was defaulting to 0 (raw
   server-time bucketing). The spike's misleading `−810` estimate was root-caused (stale-deal
   artifact: estimator assumed the latest deal ≈ now) and hardened to emit no candidate beyond
   ±13h. **Only remaining (non-blocking):** founder VNC/live-tick confirm of the DST edge (a
   fixed env can't auto-switch EET↔EEST at the Oct/Mar transition; affects day-bucketing only,
   NOT the balance-anchored parity). Optional: rotate the read-only investor pw
   (`Vantage_investor_password_26547876`).

### Phase 153.3 (WIZFORM-GW) — recorded residuals (added 2026-08-09)

- [x] **✅ RESOLVED 2026-08-09 by plan 153.3-06 (D-35) — the WORKER path no longer calls
  `mt5.shutdown()` on the SHARED gateway session.**
  Plan 153.3-03 (D-30) took `shutdown()` off the **request** path: `routers/exchange.py`'s
  `_validate_mt5_key` calls `Mt5Client.release()` (transport close only) in its `finally`, so a
  validate no longer tears the IPC pipe down under a concurrent caller (`-10004` — the mechanism
  item 0 above describes). Recorded here as remaining: `services/exchange.py:924-938`
  (`aclose_exchange`'s mt5 arm) and `services/ingestion/mt5.py:~337`. An ast scan found a **third**
  (`routers/exchange.py`) — three callers through **two** `shutdown()` call nodes.
  **Plan 153.3-06 closed the class AT THE SINK:** `Mt5Client.close()` no longer calls
  `mt5.shutdown()` at all, so all three callers are fixed with **zero call-site edits** (neither
  worker site could be fixed at its own site anyway — both run in a `finally` outside the lease,
  so leasing them would mean queueing inside an error path to buy permission to do something
  destructive). `close()` still releases our own rpyc socket. The knowingly-temporary
  `test_close_alone_still_calls_shutdown_exactly_once` pin was **re-cut**, not deleted, as
  `test_close_alone_never_reaches_shutdown` (`shutdown_calls == 0`, D-35 named in its docstring);
  the eight "the session never leaks" assertions in `tests/test_ingestion_mt5.py` were re-pointed
  to the transport-close observable. A new `shutdown()` call site anywhere in `analytics-service`
  now reds `tests/test_mt5_shutdown_roster.py`, which derives the roster from source (ast) with a
  vacuity floor and self-tests — nobody has to hand-edit a list.

  ⚠️ **The ONE residual that genuinely remains — cross-REPLICA.** The surviving teardown is
  `Mt5Client.restart()`'s (the deliberate heal of a wedged pipe, MT5CONC-01). It is safe because
  every call site holds the terminal lease — but that lease is an `asyncio.Lock`, which is
  **single-event-loop** and serializes **nothing across replicas**: two analytics replicas own two
  registries and two Lock objects. That is precisely why **D-33** pins the gateway to a SINGLE
  replica (runbook `docs/runbooks/mt5-go-live.md` Step 1 + the `[ ] SCALE` gate-check row, plan
  153.3-05). ⛔ **A scale-up is a correctness change, not a capacity knob** — it needs a durable
  cross-process serializer first. **Owner: D-33.**

- [ ] **GSD `gsd-sdk query state.*` verbs take NAMED flags, not positional args — the executor
  prompt documents positional.** Found 2026-08-09 during plan 153.3-05's state update.
  `state.record-session "" "<stopped-at>" "None"` silently records only `Last Date` and drops the
  stopped-at; `state.record-metric` and `state.add-decision` return `{"error": …}` on positional
  argv. Correct forms: `--stopped-at/--resume-file`, `--phase/--plan/--duration/--tasks/--files`,
  `--summary`. ⚠️ Also: **every** SDK write to `.planning/STATE.md` REGRESSES the frontmatter
  `last_activity` to a stale value (observed: `2026-08-09 -- Phase 153.3 wave 4 complete` →
  `2026-08-07 -- Phase 152 execution started`, three times in a row). Repaired in place each time.
  Same defect family as the `### Decisions` heading drift already annotated in `STATE.md`.
  ⚠️ `state.record-metric` is also NOT idempotent — running it twice appends a duplicate row.

### Phase 153.7 review + verification — findings routed onward (added 2026-08-14)

The 153.7 fix round closed WR-01, WR-02, WR-03, W-153.7-1 (with a real guard, not a note),
W-153.7-2 and W-153.7-4 in code. The three below are recorded rather than fixed, each for a
stated reason. ⛔ Neither of the first two is a 153.7 regression — both are pre-existing and are
listed now only because 153.7 is what made them reachable or re-read them.

- [ ] **`ROSTER-DERIVE-01` — the two key-step rosters are still HAND-TYPED, and the class fix has
  no owner until this line does.** `KNOWN_CREATE_WITH_KEY_CODES` (`ConnectKeyStep.tsx`) and
  `KNOWN_ADD_KEY_CODES` (`MultiKeyConnectStep.tsx`) are hand-maintained allow-lists. Their own
  docblock used to assign the derived-roster class fix to *"Phase 153 / WIZFORM-02"* — which is
  now **ticked COMPLETE** (`REQUIREMENTS.md`), so that pointer named a closed requirement and the
  fix was ownerless. **This item is that owner**; both docblocks now cite it by name.
  ⭐ **WHAT CHANGED IN THE MEANTIME, so this is no longer a silent hazard.** 153.7's verifier
  MEASURED that deleting `"SEAM_INTERNAL_FAULT",` from either roster left the whole suite green
  while the wizard rendered `UNKNOWN` **with a Retry control** against `retryable=False` faults —
  the 2026-08-05 `SERVICE_UNREACHABLE` incident shape. The 153.7 fix round closed that with
  `[153.7 review W-153.7-1]` in `wizardErrors.invariant.test.ts`: the classifier-reachable
  population is derived (cascade literals by source scan + the LIVE `VENUE_WIRE_CODE_TO_VERDICT`)
  and checked against each roster under the translate-first admission rule. **A missing roster row
  now reds CI by name.** So what remains is DUPLICATION, not exposure.
  What is blocked: nothing ships wrong today. What unblocks it: deriving both rosters from the
  route contract instead of typing them, so the guard has nothing left to catch.
  ⚠️ **The obvious shortcut is wrong and is written down so it is not re-attempted:** merging the
  two rosters. They are separate on purpose (`ConnectKeyStep`'s docblock argues it at length — a
  step admits the codes ITS route emits, not the whole vocabulary), and a merged set would pass the
  guard while admitting each route's codes at the other.

- [ ] **`W-153.7-3` (pre-existing, low) — coverage-law row 1 enumerates exactly THREE Next route
  files, which is narrower than the phase goal's wording.** `ROUTES` in
  `wizardErrors.invariant.test.ts` still lists `create-with-key`, `composite/add-key` and
  `finalize-wizard`, and matches only literal `NextResponse.json({ code: "X" }, { status })` sites.
  **Six** of our own Next routes mint `code: "UNAUTHENTICATED"` in TypeScript (named in the
  UNAUTHENTICATED exemption row) and sit outside any derived population.
  153.7's declared scope was the PYTHON half plus the four `missing` items — all discharged — so
  this is out of scope rather than skipped. It is recorded because it **bounds the literal claim**
  *"every code that can reach a user-facing surface"*: that claim is true of the analytics-service
  vocabulary and not yet of the Next-minted one.
  What is blocked: nothing user-facing. What unblocks it: extend `ROUTES` to the Next routes that
  mint codes, or state the boundary in the file's docblock the way `EXPECTED_EMITTED_CODES` now
  states its exclusions — ⛔ the one thing that must not happen is the claim staying broader than
  the mechanism.

### v1.14 Smoothed-MTM go-live blockers — FIXED in the v1.14 landing (2026-07-23)
Surfaced by the /ship Fable red team; the safety-critical ones fixed in the landing PR so
flipping `SMOOTHED_MTM_ENABLED` ON can never sink a healthy book's cash+MTM factsheet.
- ✅ **GLB-2 (FIXED)** — single-key smoothed pass now catches `LedgerValuationError` + the
  structural tuple and DEGRADES (omit the smoothed by-basis key, keep cash+MTM), mirroring the
  MTM second pass. RED-verified.
- ✅ **GLB-3 (FIXED)** — composite smoothed fan-out bounded by `asyncio.wait_for` at a remaining-
  budget slice (single-key FIX-2 pattern) and degrades on timeout/structural error; the
  degenerate-length/overlap/ValueError arms also degrade (single-key parity). RED-verified.
  (The RT-3 over-fix — shrinking `_composite_max_members` — was reverted; the cap is byte-
  identical to main again.)
- ✅ **GLB-4 (FIXED)** — `fetch_deribit_option_daily_marks` now treats a malformed/error HTTP-200
  as retryable within the existing backoff (`_FlakyChartResponse`); genuine `no_data` stays
  benign. RED-verified.
- ✅ **GLB-5 (FIXED)** — retention horizon is env-overridable (`DERIBIT_OPTION_MARK_RETENTION_DAYS`)
  and a wholly-empty instrument within 30d of the cutoff buckets as pre-retention cash-fallback
  instead of hard-failing D-07. RED-verified.
- ⏳ **GLB-1 (REMAINS — now non-catastrophic, dogfood-driven):** on an option expiry day the
  ΔMTM grid caps at `last_settled=T-1` while the anchor read is post-08:00-UTC delivery on day T,
  so the book-channel residual can breach `_assert_smoothed_book_channel`
  (`deribit_ingest.py`~2032, `deribit_txn.py`~1746) → `LedgerValuationError`. With GLB-2/GLB-3
  in place this now DEGRADES safely (smoothed omitted for that book/day, cash+MTM intact) rather
  than failing the whole job — so it is NO LONGER a flag-flip safety blocker, but it does mean
  smoothed may be unavailable on expiry days for active options books. Proper fix (reconcile the
  book channel at a boundary consistent with the anchor) is best validated against real options
  books in the live dogfood, not blind. Watch for it in the /qa + Phoenix acceptance.

### v1.16 branch `feat/v1.16-production-resilience` — merge guards (added 2026-07-26)

- **No branch protection on `main` at all.** GitHub `rulesets: []` and
  `branches/main/protection` → 404 — verified first-hand. There are **no required status checks**,
  so nothing mechanically blocks a merge with red CI. Combined with the next item this is the live
  risk. ~~**Founder action:** enable branch protection requiring the `frontend`, `python` and
  `sql-tests` aggregator checks.~~
  → ✅ **DECIDED 2026-07-27 (founder): DEFERRED until there are paying clients.** Raised twice and
  declined twice; **this is settled — do not re-raise it each phase.** The reasoning is a solo-founder
  velocity trade, and it is defensible while the only committer is the founder.
  ⚠️ **The one consequence that must not go invisible:** every CI gate in this repo — including the
  real-Redis lane 140.2 built and wired strictly into the `frontend` aggregator — is **advisory at
  merge**. So *"CI is green"* is a statement about a **run**, never about **what landed on `main`**.
  Any phase-closure or verification wording must say **"the workflow would have caught it"**, never
  **"the workflow did stop it"**. `140.3-VALIDATION.md` already carries this rule verbatim; keep it
  in every subsequent phase's validation doc. **Re-open when the first paying client lands** — at
  that point the merge-time guarantee starts protecting someone other than us.

### v1.16 Phases 141–146 — review-depth policy (DECIDED 2026-07-27, founder-approved)

Not every remaining phase earns the 140.2/140.3 treatment. Depth is set by **blast radius**, not by
habit. This replaces "run the full pipeline everywhere" for the rest of the milestone.

| Phase | Depth | Why |
|---|---|---|
| **141 SEAM (retry)** | **FULL — the deepest of the milestone** | Retry means **double-executing side effects**. Its own SC3 pins that a retried `teaser` mints duplicate `strategy_verifications` rows / `public_token`s / leads. ⚠️ **Mandatory extra:** 141 converts `recoverable` from a *render hint* into an **automated retry input** — TS-35's W-4 rider says the `unknown ⇒ true` polarity **must be RE-DERIVED** at that moment, because the harm asymmetry that justifies `true` does not survive the change of consumer. → **✅ DISCHARGED 2026-07-31 (141.1-09), and the re-derivation is that the PREMISE IS FALSE.** Re-traced at HEAD: `recoverable` appears **zero times** in `src/lib/resilient-fetch.ts`. The retry loop branches on `verdict.counts` (from `seamBreakerVerdict`) and on `isDeadlineError`; *whether* a call may retry at all is the required `retriesOverride` argument, fed from the committed audit in `seam-retry-registry.ts`. `recoverable` stayed exactly what it was — an envelope field the clients emit for the UI. It never became a retry input, so the harm asymmetry never changed consumer and the `unknown ⇒ true` polarity needs no re-derivation. **That finding IS the discharge**; the rider was written from a plausible forecast of 141's shape, and 141 took a different one (a registry gate, not a flag read). |
| **142–145 JOB** | **SPLIT: full on migrations/DDL, light on application code** | Bounded blast radius in app code, but these write **migrations, which auto-apply to PROD on merge to `main`** — and per the decision above that merge is unguarded. Scars to respect: the 106 janitor reaped on the wrong column and was **reverted**; WR-02 (144) is an open call with a prod-outage history. Keep falsifiability ledgers on both halves. |
| **146 RATE** | **LIGHT — researcher + planner + ledger, no deep review round** | Self-described mechanical: a re-grep artifact and a limiter-value audit. Nothing in it can silently corrupt data or money. |

**Keep everywhere, regardless of depth:** the **Falsifiability Ledger** and the **Oracle Independence**
checklist. They are cheap and they are what actually caught the breaker firing at 30-instead-of-5, the
vacuous `status_code=400` grep, and the fake that agreed with itself. The expensive part being cut is
the multi-round red-team fan-out, **not** the mutation discipline.

**Rejected reasoning, recorded so it isn't re-litigated:** the case for going lighter is NOT *"we've
found most of it"* — the data refutes that (140.2 found 3 criticals; 140.3's planning gate found 3
blockers before a line was written). The case is *"this particular phase cannot hurt much,"* which is
true for 146 and half of 142–145, and **false for 141**.

### v1.16 Phase-140.1 review — HOMELESS findings (no owning phase; added 2026-07-26)

> ⚠️ **Why these are here:** they lived only in `.planning/phases/140.1-*/140.1-REVIEW.md` and
> `140.1-TS-OBLIGATIONS.md`, which are **gitignored and have zero git backup** (`git ls-files
> .planning` → 5 legacy phase-19 files only), in a repo whose memory records two prior accidental
> destructions of exactly these ledgers. Full evidence stays in those files while they exist.

- **Tests that run in NO environment (three findings).** (a) `TEST_SUPABASE_DB_URL` is wired into
  the `sql-tests` CI job only (`ci.yml:810`), never the `python` job (`ci.yml:1030-1033`) — so
  **31 pytest cases skip in CI exactly as they do locally**. (b) `HAS_PY_ENV` is set in **zero files
  repo-wide** — the 5 Phase-4-vs-Phase-5 **money-math KPI parity** cases it gates are permanently
  dormant. (c) 4 `tests/test_repro_key_flow.py` cases skip on missing **binance** cassettes
  (`tests/cassettes/` holds only `okx/` and `bybit/`). CI wiring; no owning phase.
- **Nine test modules mount a bare `FastAPI()`**, so they never see the app-global 422/429 handlers
  and their 422s render in FastAPI's default **leaking** shape. **Negative half: none of them is
  vacuous today — do NOT schedule a "fix the broken tests" sweep.** Positive half: the credential-safe
  422 is gated by exactly ONE file (`tests/test_validation_error_contract.py`), and
  `test_process_key.py` is where a future author would "prove the 422 is safe" and prove nothing.
  A shared app-factory fixture closes it.
- **403-vs-422 split unowned.** `_scope_rejected` (`routers/process_key.py:1295-1299`) is a three-arm
  OR behind one return, so ordinary `not val.valid` failures (incl. a malformed CSV) now answer
  **403** where 422 would be sharper. The consumer half is tracked as TS-14; the split decision itself
  has no owner.
- **Worker raises an HTTP exception.** `analytics_runner.py:1725` raises `HTTPException(500)` from the
  WORKER — a category error that can never render.
- **Anonymous teaser bucket 30/hour** (`routers/process_key.py:99`) — deliberate and founder-retunable;
  wants a saturation alert so exhaustion is visible rather than silent.
- **Process item (TRAP-9 class B2):** plans enumerate production sites exhaustively but not the TESTS
  those changes invalidate. Plan-check found 4; plans 06, 07 and 08 each found one *more* the plan did
  not predict. Fold into the planning template, not a code phase.

### MT5 wizard — founder-observed on live UI (added 2026-08-02) — ✅ BOTH DEFECTS CLOSED

> ⚠️ **Neither defect is open.** Kept as a record because the *shape* of the fix (a class fix, not
> the instance) and one **rejected** remedy are what future readers need. Do not re-open either
> item; the residual scope lives in `DEF-142.2-02` below (the 9 out-of-scope emitting sites).
> ⛔ **Closing these means the MT5 connect flow is REACHABLE and its rejections are HONEST. It does
> NOT mean MT5's rendered numbers are correct** — that is Phase 142.3's gate (D-17).

- **MT5 connect failed with copy that named the wrong exchanges.** Submitting the MT5 form
  (login / investor password / broker server, all filled) rendered *"This does not look like a
  valid API key for the selected exchange… Binance secrets are 64 hex characters; OKX and Bybit
  use different formats"* with `code: KEY_INVALID_FORMAT`. Two defects were stacked, both real:
  1. ✅ **CLOSED — it WAS the client-on/server-off half-state, and it was an env fix.**
     `create-with-key/route.ts:147` returned exactly this code when `isMt5EnabledServer()` was
     false, and that gate is strict `MT5_ENABLED === "true"` on the **Vercel/Next server** — a
     *different* variable from the worker's `MT5_ENABLED` and from `NEXT_PUBLIC_MT5_ENABLED`
     (which is what renders the MT5 card the founder clicked). **Resolved 2026-08-03 by MT5-01:**
     the server-side flag was set in Vercel prod and the app redeployed, verified by the
     `/security` mt5-readonly curl. No code was written for it — it was never a code defect.
  2. ✅ **CLOSED as a CLASS by Phase 142.2 plan 07 (MT5-04), not as the instance.** The single
     `KEY_INVALID_FORMAT` bucket was split across **24 emitting sites (12 + 12)** in
     `create-with-key/route.ts` and `composite/add-key/route.ts` into four honest codes
     (`KEY_MISSING_REQUIRED_FIELD`, `KEY_UNSUPPORTED_VENUE`, `KEY_VENUE_NOT_ENABLED`,
     `KEY_INPUT_TOO_LONG`); `KEY_INVALID_FORMAT` now survives on exactly one genuine format guard
     per route and its copy no longer claims a browser-side check that never ran. Guards, HTTP
     statuses and `error` strings are byte-identical at every site — only the `code:` literal
     moved. `wizardErrors.invariant.test.ts` reddens if a future code is emitted without landing
     in all three registries. ⚠️ Fixing the *class* was deliberate: MT5-01 had already made the
     founder's own failing arm unreachable, so an instance fix would have repaired a line that
     can no longer fire.
     ⛔ **The "surface the server's `error` string" half was REJECTED by founder decision D-05 —
     copy-by-code only.** Do not re-open it as an unfinished half of this item. The wizard renders
     copy keyed on the code and deliberately renders no server-supplied string.

7. **Doc defects in the 153 records (non-blocking, logged per the founder stopping rule).**
   (a) `REQUIREMENTS.md:1366` claims `ConnectKeyStep`/`MultiKeyConnectStep` "still pass neither"
   `surface` nor `venue`; at HEAD both pass `surface: "connect"` **and** `venue`, and the row
   directly beneath at `:1368` says so — two adjacent rows contradict. WIZFORM-03 is closed
   *further* than its own record admits. (b) `ROADMAP.md` Phase 153's success-criteria list is
   misnumbered — it runs 1, 2, 3, **5**, 4, **5**, so "SC5" is ambiguous in any report.
   (c) `REQUIREMENTS.md:1434` rollup reads "153 WIZFORM-01..04 + MT5-14", omitting WIZFORM-05.

---

## 🟡 FIX MID-TERM

- [ ] **`[PGLANE-HELP-TRUNCATED]` `scripts/pg-lane/run.sh --help` cuts the stand-in disclaimer off mid-sentence (measured 2026-09-02, Phase 164.4 ship review).**
      `run.sh:612` is `-h|--help) sed -n '2,45p' "$0"`, a hardcoded end line. The
      ⚠️ WHAT IT DOES AND DOES NOT PROVE disclaimer occupies lines 43-50, so `--help`
      renders only lines 43-45 — three of its eight lines, ending mid-sentence. This is
      the disclaimer GRAMMAR rule 4 and `parse.mjs` both cite as the authority for what a
      pg-lane stand-in does and does not prove, so the reader most likely to need it (someone
      running the lane by hand) is the one who sees it truncated. Pre-existing; the 164.4 docs
      pass rewrote the disclaimer in place at the same 8-line length and deliberately did not
      touch executable shell. Fix: end the `sed` range at the last comment line before
      `set -euo pipefail` rather than at a hardcoded 45 — e.g. derive it, or move the
      disclaimer above the help range.

- [ ] **`[WINDOWS-LEDGER-DRIFT]` `.planning/WINDOWS.md` refuses every append: its frontmatter counts and its entries disagree (logged 2026-09-02, Plan 164.4-00).**
      `gsd-tools windows append` exits with `Ledger counts disagree with entries: frontmatter
      open/waived/fixed/total=26/0/2/28 but entries yield 29/0/2/31`. Measured cause: the file carries
      TWO representations — a markdown table with ids 1-28 (26 open / 2 fixed, which is what the
      frontmatter counts) AND a JSON block further down holding 3 more entries (phases 164.3 / 164.3.1)
      that the frontmatter never counted. Drift predates this plan (`last_updated: 2026-08-29`).
      **Consequence: the broken-windows ledger is WRITE-BLOCKED** — Plan 164.4-00 could not record its
      two findings there and recorded them here instead. Decide which representation is canonical, then
      reconcile the frontmatter. Do not "fix" it by editing the counts blind.
      **⚠️ A SECOND transition is now blocked behind this (2026-09-02, Plan 164.4-01): entry 28
      (`sql-mutation`'s first ubuntu execution) is PROVABLY CLOSED** — `workflow_dispatch` run
      **33620169220** at **`89cbef8b`**, self-test 12/12, `arms: 30/30/0`, tallies agree. Recorded in
      `CLAUDE.md:51-53` and now in `GRAMMAR.md`'s 3c honest-residual paragraph, which previously still
      claimed the job "has never executed on its ubuntu host". `gsd-tools windows fixed 28` refuses
      with the same counts error, so the row still reads `open`. **When the ledger is reconciled, close
      28 with that run id and SHA.** Not hand-edited here: the frontmatter is already wrong, so flipping
      one row's status would make the ledger agree with itself while still being wrong — the exact move
      Plan 164.4-00 refused.
      **And a THIRD write is blocked behind it (2026-09-02, Plan 164.4-01):** a `unrun-verify`
      entry for `164.4-01-SUMMARY.md` — the plan's `<human-check>` is UNMET, so the PR number, the
      merged head SHA and the SHA-bound `sql-mutation` ubuntu run id + wall clock read `PENDING`.
      Plan 164.4-02's `<precondition>` is `gate="blocking-human"` and reads exactly those fields;
      it WILL halt until 164.4-01 is landed (`/ship`, then `/gsd-pr-branch` + the CLAUDE.md
      deletion guard) and its CI board read SHA-bound. `gsd-tools windows append` refuses with the
      same counts error, so it is recorded here.

- [ ] **`[REDUNDER-PGCRON]` FOUR Phase-164.4 idiom gate files cannot be FALSIFIED on the pg-lane — the lane has no `pg_cron` (measured 2026-09-02, Plan 164.4-00; mechanism corrected and the set closed at four 2026-09-03, Plan 164.4-03).**
      `scripts/pg-lane/run.sh` boots a vanilla `initdb` cluster. Measured on it: `pg_available_extensions`
      has **0 rows** for `pg_cron`, and `CREATE EXTENSION pg_cron` fails `0A000 … Could not open extension
      control file ".../postgresql@16/share/postgresql@16/extension/pg_cron.control"`.
      ⚠️ **THE MECHANISM IS NOT UNIFORM, and this entry used to say it was.** Re-measured at HEAD
      2026-09-03, per file:
      * `test_reconcile_dropped_enqueue_sweep.sql` (39 sections, rank 1) — `:268-269`
        `IF NOT EXISTS (… extname = 'pg_cron') THEN RAISE EXCEPTION 'TEST FAILED (1/JOB-04) …'`;
      * `test_retention_orphaned_running.sql` (25, rank 4) — `:212-213`, same shape, `1/JOB-05`.
        For BOTH, the lane baseline can never be GREEN and `run.mjs` never judges an arm in a
        red-baseline file. This is deliberate on their part: their anti-green-skip contract.
      * `test_strategy_analytics_stuck_computing_reaper.sql` (29, rank 3) — BASELINES GREEN, then
        `RAISE NOTICE 'SKIP …'` at `:282` (Part 1b + Parts 2-3), `:326` and `:483`, withholding
        identities `1/JOB-02`, `1/JOB-03`, `2…` and `3…`;
      * `test_derive_allocator_keys_fanout.sql` (7, rank 18) — BASELINES GREEN and does NOT raise:
        `:159 IF EXISTS (… 'pg_cron') THEN` guards ASSERTION 6 (`TEST FAILED (6)`) and `:169` prints
        `pg_cron not present — skipping cron assertion` otherwise. Its section `6` is un-falsifiable
        for the same reason, which is why it joins the set rather than being annotated half-way.
      **2 RAISE + 2 green-skip = 100 of the corpus's 355 idiom sections (28%), across 4 files.**
      `test_retention_crons_safe.sql` probes pg_cron too but is a non-idiom file (out of scope under
      (c), and the runner keeps printing it under `unreachable:`, not `lane-blocked:`).
      **DEFERRED 2026-09-03 — pg_cron is NOT installed on the lane; the four files are printed by the
      runner as `lane-blocked:` every run (Plan 164.4-03); 100 of 355 sections; the phase's end state
      is `coverage: files 40/71`.** The deferral CAN expire and is not a parking space: every
      lane-spawning run drives a `probe` leg asking `pg_available_extensions` for pg_cron and prints
      the answer as `lane-probe:`; pg_cron AVAILABLE with a non-empty lane-blocked class is a
      `lane-blocked-stale` MEASURE_FAIL that exits 1, so closing this item reddens the gate until the
      four files are annotated. `sql-mutation` MEASURE_FAILs if either line goes missing.
      **Not fixable inside a batch plan.** Hosting `pg_cron` needs a package on BOTH hosts (`brew search
      pg_cron` finds the formula; it is NOT installed here — ubuntu needs its own `postgresql-<v>-cron`)
      AND `shared_preload_libraries=pg_cron` + `cron.database_name` on `run.sh`'s `pg_ctl -o` line, i.e.
      the lane substrate whose CLI contract `scripts/pg-lane/README.md:10` calls costly to change.
      ⛔ Faking a `pg_extension` row is NOT the fix: it would make arm `1/JOB-04` unfalsifiable while
      reporting it as covered (threat T-164.4-01).
      **Needed before any batch containing those files.** Evidence:
      `.planning/phases/164.4-.../164.4-00-FIXTURE-STRATEGY.md` § "The largest idiom file cannot be
      baselined".

- [ ] **`[ANCHOR-QUOTE-01]` `verify-plan-anchors.mjs` binds a quote ACROSS an XML element boundary — false stales, masked only by element ORDER (booked 2026-09-03, Phase 164.4 plan-check iteration 3).**
      `scripts/verify-plan-anchors.mjs:279-292` (`boundQuote`): when an anchor is the last on its line
      and no backtick span follows it, the verifier binds the FIRST backtick span of the NEXT line as
      that anchor's quote. It does not stop at a line that opens a new XML element. Measured in Phase
      164.4: with `<read_first>` placed before `<precondition>` in Task 1 of every batch plan, a
      `sql-mutation` span on the following `<precondition>` line was read as a quote against the last
      `<read_first>` anchor and reported STALE. The plans were reordered (`<read_first>` after
      `<precondition>`) to dodge it — correct today, fragile forever: any future edit that puts a
      backtick span on the line after `</read_first>` re-triggers the false stale, and an executor
      told "anchor stale" will loosen the anchor rather than suspect the verifier.
      Fix: `boundQuote` must never bind across a line that opens a new XML element (`^\s*<[a-z_]+`)
      or closes the current one (`^\s*</`); return `null` at that boundary. Ship with a red fixture
      (anchor last on its line, next line opens `<precondition>` with a backtick span → must report
      NO quote, not a stale) and a green one (same anchor, span on a plain continuation line → bound).
      Verify with `node scripts/verify-plan-anchors.mjs --pending` on the 164.4 plans: claims count
      unchanged, stale 0, with `<read_first>` moved BEFORE `<precondition>` in one batch plan as the
      probe (then restored).

- [ ] **`[REDUNDER-SAVEPOINT]` `20260416201929_audit_log_hardening.sql` cannot apply to a vanilla PostgreSQL 16 at all (measured 2026-09-02, Plan 164.4-00).**
      Its final `DO $$ … $$;` block issues `SAVEPOINT audit_log_probe;` and `ROLLBACK TO SAVEPOINT
      audit_log_probe;` (`:239-267`) **inside a PL/pgSQL body**. PL/pgSQL has no savepoint statements, so
      the body fails to PARSE: `42601 syntax error at or near "TO"` at `plpgsql_yyerror`
      (`pl_scanner.c:542`), before a single statement in the block runs. Reproduced in isolation from an
      8-line DO body on an empty cluster (probe M1 in the Plan 00 record). It is what killed the stubbed
      real-migration-chain candidate at migration 51 of 262.
      **Either the deployed body differs from the repo body (repo-vs-PROD drift — VAC-04's own subject),
      or this migration never applied as written.** Resolve by DIFFING the deployed
      `audit_log`/`log_audit_event` state against this file before editing anything. Phase 164.4 may not
      touch `supabase/migrations/`, so it is booked, not fixed.

- [ ] **`[REDUNDER-NONIDIOM]` The 27 non-idiom SQL gate files are excluded from Phase 164.4 and need their own phase (logged 2026-09-02, founder scope decision).**
      Phase 164.4's criterion 1 was NARROWED to the 44 `TEST FAILED (` idiom files. The other **27
      files / 334 `RAISE EXCEPTION` sites** assert through their own message prefixes
      (`'MT5SRC-03 (1a): api_keys did not admit exchange=mt5'`,
      `'FLIPRETRY-02: include predicate present % time(s)'`) and are structurally invisible to the
      mutation runner, whose identity needle is the literal `TEST FAILED (<arm>)` (`run.mjs:544`,
      defined once at `run.mjs:947`). They are therefore UNPROVEN — nothing machine-checks that
      those 334 assertions can fail.
      **This is a real coverage gap, deliberately accepted and made loud, not closed.** Phase 164.4
      requires the runner to PRINT these 27 files by name on every run, so the exclusion is emitted
      by the gate rather than asserted in a ledger.
      **The successor work is a message-only rename** into the idiom. Measured and NOT free: the
      321 no-idiom raises carry only **139 distinct prefixes** (`B5b:` heads 28), so unique arm
      identities must be INVENTED per arm, not mechanically transformed — authoring judgement
      across 27 files. It is safe from the "no assertion edits" angle: nothing external reads those
      strings (the sentinel gate counts `RAISE EXCEPTION` lines at `ci.yml:2360`; `sql-tests` uses
      `ON_ERROR_STOP`), so a rename changes message text only, never what an assertion asserts.
      ⛔ Do NOT fold this into 164.4. It has a different risk profile — 164.4 annotates what exists,
      this one authors new identities — and mixing them is how a backfill turns into 334 fresh
      unverified claims.
      ⚠️ Also carries the 174 non-idiom raises that sit INSIDE the 44 idiom files (unreachable and
      un-neuterable there); seven "mixed" files are the concentration, e.g.
      `test_api_keys_exchange_not_user_writable.sql` at 38 non-idiom vs 9 idiom.

- [ ] **`[WINDOWS-STALE]` `.planning/WINDOWS.md` entries 25, 26 and 28 read `open` but have all executed (logged 2026-09-02).**
      `CLAUDE.md:53` already claims entry 28 is closed while `.planning/WINDOWS.md:45` still records
      it `open` — the repo contradicts itself in two tracked files. All three have now run:
      **28** (`sql-mutation` first ubuntu execution) closed by run 33620169220 and re-bound to run
      33643046061 at `60b0722d`, self-test 15/15; **25** (VAC-04 first real-PROD-credential run) and
      **26** (VAC-08 first real-TEST run) both executed on ship PR #730.
      ⚠️ Close 25 PARTIALLY, not fully: VAC-04 ran against the real credential but took the earliest
      short-circuit (`prod-body-drift-check.sh:198`, "no migration files"), so its LEGITIMATE-ZERO
      branch (`:448`), normal compare verdict and absurdity floor (`:608+`) are still unobserved —
      that residue is `[VAC04-ARMS-UNRUN]` below. Update the ledger to match the measurement rather
      than deleting the entries.

- [ ] **`[VAC08-SELFTEST-CI]` VAC-08's five-arm self-test never runs in CI (logged 2026-09-02, Phase 164.3.1 UAT test 2).**
      `ci.yml:2051` invokes `bash scripts/test-ledger-drift-check.sh` with no argument, which the
      script's `case` dispatches to `check` — the `--self-test` mode at
      `scripts/test-ledger-drift-check.sh:671` is therefore never exercised by any workflow. The
      gate itself runs and produces a real verdict, so this is not a dead gate; what is missing is
      the machine proof that its four RED modes still fire. That proof is exactly what
      `feedback_every_test_must_be_able_to_fail` requires, and today it exists only when a human
      runs the flag by hand (the orchestrator did so at HEAD on 2026-09-02: `self-test OK (5/5)`).
      Fix: add a `--self-test` step to the `sql-tests` job ahead of the live check, mirroring how
      `sql-mutation` already runs `run.mjs --self-test` before its corpus pass. Guard hygiene, not
      user-facing — recorded rather than blocking, per the stopping rule.

- [ ] **`[VAC04-ARMS-UNRUN]` VAC-04's three behavioural arms have still never executed in CI (logged 2026-09-02, Phase 164.3.1 UAT test 2).**
      PR #730 closed the big unknown — `migration-drift-check` run 33643046189 ran on a real
      `pull_request` with the real PROD credential (`::notice::Drift-check credentials present.`),
      which retires the WINDOWS.md 25 "never run against its real credential" entry. But that PR
      changed no `supabase/migrations/**` files (it matched the paths filter on VAC-04's own script
      entries), so `scripts/prod-body-drift-check.sh` exited at its EARLIEST short-circuit, `:198`
      *"this PR changes no migration files — nothing to compare against PROD."* Never reached, and
      therefore still unproven on the real credential: the D-13 LEGITIMATE-ZERO branch (`:448`), the
      normal compare verdict, and the absurdity floor (`:608+`, index ≥ half the 118-body snapshot).
      These need a migration-bearing PR to fire. ⛔ Do NOT manufacture one to tick this off while
      the 164.3.1→164.4 window is open — UAT test 2 carries a standing instruction not to merge a
      migration PR in that window. Close it on the next genuine migration PR and record the run id.

- [ ] **`[MUT-SELFTEST-UNREGISTERED]` Three of the mutation runner's 15 self-test modes are not bound by name (logged 2026-09-02, Phase 164.3.1 re-verification finding O-3).**
      The ship-review pass took `scripts/mutation-runner/run.mjs --self-test` from 12 modes to 15
      (the count is visible as `SELF-TEST n/15` in the script). The three added modes fire and pass,
      but they were never registered in `INSTANCE_ARM_REGISTRY`
      (`src/__tests__/gate-family-meta.test.ts:120`), which is what binds an instance to the arm
      that proves it by NAME. Consequence, and it is narrow: renaming or deleting one of those
      three would not fail by name — the count arm would still see 15 and the mode itself would
      still run, so this is a naming-durability gap, not a coverage gap. Fix: add the three entries
      with their needles, and re-derive the `21 needles` measurement recorded at
      `gate-family-meta.test.ts:317` (it is stamped `MEASURED 2026-09-02 at 8969513e`, which
      predates the additions). Not user-facing and not data-integrity, so recorded rather than
      blocking, per the stopping rule.

- [ ] **Two cosmetic verify-precision notes from Phase 164.3's plan gate (logged 2026-08-29).**
      Neither is user-facing nor data-integrity, so neither blocked the phase — recorded so they are
      not re-derived.
      1. `164.3-02-PLAN.md` Task 3 asserts the OPS-08-F9 floors with `grep -a "SENTINEL_FLOOR=8"`,
         which would also match `SENTINEL_FLOOR=80` or a comment containing the string. It is
         verify-and-record of an ALREADY-DONE raise (floors are 8 and 166 at `ci.yml:1738-1739`),
         not a shipped control, so a loose match cannot hide a regression here. Tighten to an
         anchored exact match if the arm ever becomes load-bearing.
      2. `164.3-07-PLAN.md` Task 1's verify masks the status of its `local-stack ... down` teardown
         (`up && test; RC=$?; down; exit $RC`). That is deliberate — it preserves the TEST verdict
         rather than letting a teardown hiccup overwrite it — and orphaned containers are caught
         independently by the lane's `--self-test` no-containers assertion and by the next `up`.


- [ ] **`[VAC-07-DEFER]` Phase 164.3 plan 07 (VAC-07) was DEFERRED 2026-08-29 by founder decision — owned by Phase 164.5.**
      Booked 2026-08-29 (verification gap G2). Before this, the deferral existed only as an
      unchecked ROADMAP checkbox: no date, no reason, no owning phase. An unchecked box is
      inferable, not recorded — and it left Phase 159's two blocked items naming a completed
      phase as their unblocker.
      **The measurement that forced it** (plan 04, recorded in `scripts/local-stack/REPLAY-SPIKE.md`):
      the migration chain does NOT replay from empty. 262 migration files, **69 fail / 193 apply**,
      under BOTH the Supabase CLI and plain `psql`, from at least **six independent root causes** —
      one of which, `20260823120000_revoke_api_keys_insert.sql`, refuses **BY DESIGN** to run
      against a database it cannot identify and therefore can never replay onto a fresh local DB.
      So `supabase db reset` cannot be the lane's schema source, and the substrate became a
      committed schema dump (`supabase/schema/baseline.sql`) — a separate act of work from the spec.
      **Delivered:** `scripts/local-stack/run.sh` — the Supabase-CLI local-stack lane, with a
      trapped teardown, a `[db.migrations]`-disabled derived workdir, a mode-600 env handoff, and a
      baseline loader that REFUSES rather than degrading to the 193-of-262 partial schema. It fails
      loud and tears down; measured.
      **NOT delivered:** the csv-finalize race spec itself. **VAC-07 is not satisfied** and
      `.planning/REQUIREMENTS.md` keeps it `Pending`.
      **Phase 164.5 must, in one change:** (a) repoint `scripts/local-stack/run.sh:50` at the
      committed `supabase/schema/baseline.sql` — today it reads the gitignored, non-existent
      `scripts/local-stack/baseline.sql`; (b) drop `.gitignore:138`; (c) add the baseline staleness
      gate (WINDOWS 29 / DRIFT-05) including a sha256 assertion against `supabase/schema/BASELINE.md`;
      (d) THEN write the spec — two concurrent `csv-finalize` POSTs on one never-classified
      `wizard_session_id`; exactly one 2xx applied receipt, one honest raced refusal, `category_id`
      holds the winner.
      Full record: `.planning/phases/164.3-vacuity-a-control-that-cannot-fail-must-be-caught-by-machine/164.3-07-DEFERRED.md`.

- [ ] **`[VAC-04-ROLE]` Swap Phase 164.3's repo-vs-PROD body diff onto a zero-table-grant role.**
      Booked 2026-08-29 as the deferred half of a founder ruling, so it is not lost.
      **Current state (deliberate, not an oversight):** VAC-04 runs as a step inside
      `.github/workflows/migration-drift-check.yml` and reuses the `SUPABASE_ACCESS_TOKEN` +
      `SUPABASE_DB_PASSWORD` that job already carries. That was chosen over minting a second prod
      credential, because the secret is already in that job's blast radius on every migrations PR —
      adding a step widens nothing, while a new secret would have been a second copy of prod access
      rather than a smaller one.
      **The improvement:** `pg_get_functiondef` needs NO table privileges, so a role with zero
      grants can do the whole job. A credential whose permitted actions are legible from its name
      beats a shared one whose are not.
      **Done when:** a login role with no table grants exists, its DSN is a CI secret, VAC-04 reads
      only that, and the check still exits 1 (never skips) when it is absent.
      ⚠️ Not urgent and not blocking: this changes WHICH credential is used, not whether the control
      works. Do not let it gate the phase.


### RANK-SPLAT-01 — the anon metrics surface is unbounded by construction (booked 2026-08-26)

Booked by founder ruling while closing Phase 159's product call. RANK-02 itself is ACCEPTED as
written and the requirement is MET — this is the broader disclosure question the verifier deferred.

**Measured on PROD 2026-08-26.** `src/app/factsheet/[id]/tearsheet/page.tsx:151` reads
`analytics.metrics_json` as a whole object, and `v2/page.tsx:96` likewise projects
`metrics_json_by_basis` as a whole column. An ANONYMOUS reader of a published strategy therefore
receives **45 distinct keys**, among them `kelly_criterion`, `risk_of_ruin`, `smart_sharpe`,
`treynor`, `beta`, `alpha`, `benchmark_returns`, `drawdown_episodes`.

⚠️ **The defect is the mechanism, not the contents.** Every one of the 45 is a derived performance
statistic — no account, key, or identity data — and a published strategy is public by intent. The
problem is that the set has no boundary: whatever the analytics stage writes becomes publicly
readable with no review step. 45 is what it happens to be today, not a decision anyone took.

- **[RANK-SPLAT-01] Replace the whole-column projection with a named alias set (or an RPC that
  returns one)**, so the anonymous surface is a deliberate list. A metric added upstream should be
  invisible until someone adds it to the list. ⚠️ Pin it with a test that FAILS when a new key
  appears in the projection, or the boundary decays the first time the compute stage learns
  something new.

⛔ Deliberately NOT scoped into Phase 164 (founder call): 164 already carries a migration, a new
public route, two guard amendments and an adversarial cache test, and this is outside SHARE-01..04.


### CI-MIGRATE-01 — CI must apply migrations to TEST before `sql-tests` (booked 2026-08-26)

⭐ **Founder-ruled 2026-08-26** while discharging Phase 163's TEST-apply item. Hand-applying one
migration arms one gate; it does not change why the gate was silent. This item closes the mechanism.

**The mechanism, measured.** All four migration-touching workflows checked: `supabase-migrate.yml`
targets the PROD ref; `migration-drift-check.yml` runs `db push --include-all --dry-run`, also
against PROD; `migration-policy.yml` documents that no write is ever invoked; `mutex-probe.yml`
only takes a lock. And `sql-tests` — the ONLY lane that executes real deployed SQL bodies — has
five steps (install psql, preflight, acquire mutex, run, release) and NO migration-apply step.
⇒ TEST is whatever was last pushed by hand, so every migration self-check with a pre-apply
tolerance is permanently silent there.

- **[CI-MIGRATE-01] Add a migration-apply step to the `sql-tests` lane** (or a job it depends on),
  so TEST is current before the SQL gates run.

⚠️ **This is NOT a one-line CI edit — three named hazards:**
1. **TEST is shared and contended.** The lane already acquires a mutex and the DB has no worker.
   An apply must happen inside that mutex or it races a concurrent run.
2. **DRIFT-01 means TEST runs OLDER revisions of several functions.** The first bulk apply will
   surface accumulated drift all at once, inside CI, on everyone's PRs. Land it deliberately —
   ideally apply once out-of-band first, see what breaks, THEN wire the step.
3. **Applying arms every previously-silent gate simultaneously.** That is the point, but it means
   the first green run after this lands is the first honest one — treat a red as information, not
   as a regression introduced by the wiring.

⭐ Until this lands, the standing rule stands: **a green `sql-tests` run is not evidence that a
migration gate is armed.** Measure the catalog directly (`pg_get_functiondef` / `obj_description`).


### CRON-DRIFT-01 / CRON-OBS-01 — a PROD cron job 401'd hourly for 7 DAYS behind a green cron history (booked 2026-09-01)

**Measured 2026-09-01, live in PROD.** Sentry `QUANTALYZE-18` (169 events, escalating, first seen
2026-08-25T12:49Z) was `config_secret: SERVICE_KEY / config_fault: mismatched` from
`analytics-service/main.py:833`. `net._http_response` ids 3479-3484 showed six consecutive hourly
`401 {"detail":"Unauthorized"}` — while `cron.job_run_details` recorded `succeeded / '1 row'` for
every one of those ticks.

**Root cause.** A Railway `SERVICE_KEY` rotation on 2026-08-25 12:46. Someone created the Vault
secret `analytics_service_key`, described it verbatim as "X-Service-Key for match_engine_cron
(cron.job jobid 1)", and never re-pointed jobid 1 at it. The job kept an INLINE copy of the old
key. First 401 landed 12:49:29 — three minutes after the vault write. Fixed 2026-09-01 by
re-scheduling jobid 1 onto a `DO` block that reads `vault.decrypted_secrets`; verified id 3485
`200 {"status":"ok","processed":14,"skipped":0,"failed":0}`.

Two gaps remain, and neither is closed by that fix:

- **[CRON-DRIFT-01] Nothing compares PROD `cron.job` against the repo's migrations.** PROD jobid 1
  carried a hardcoded `url := 'https://…'` plus an inline key, while
  `supabase/migrations/20260408215026_schedule_match_cron_hourly.sql:70-76` had rebuilt it on
  `current_setting(...)` explicitly so "the secret never lands in `cron.job.command`". That rebuild
  never took effect and nothing noticed for months. This is `VAC-04`'s shape (repo-vs-PROD function
  body diff, shipped in v0.77.0.0) applied to `cron.job` — which has no equivalent.
  ⚠️ **The GUC design in that migration is UNRUNNABLE on Supabase anyway**: `ALTER DATABASE … SET
  app.analytics_service_key` returns `42501 permission denied to set parameter` because a custom
  PLACEHOLDER GUC needs superuser and the `postgres` role is not one. So the migration as committed
  could never have worked here. Any gate must compare against what is ACHIEVABLE, not just what the
  migration says. Vault is the working mechanism.

- **[CRON-OBS-01] Nothing watches `net._http_response`.** `net.http_post` is ASYNC: pg_cron logs
  success for ENQUEUING and never sees the status code. Every other alarm is structurally blind
  here — `/health` stays green (`SERVICE_KEY` skips `/health`, `/internal/*`, `/process-key`), and a
  4xx never trips the 140.2 breaker. The PYAPI-06 Sentry capture was the ONLY instrument that
  spoke, and it fires only for a NON-EMPTY wrong key (`if provided:` at `main.py:830`) — an absent
  header would have been silent too. Needs a periodic check that fails loud on non-2xx in
  `net._http_response`, counted and surfaced (⚠️ not a silent skip — that is `SKIP-01`).


➡️ **ROUTED 2026-09-01 to Phase 164.1 (HARDEN-GUARDS).** That phase already owns this class — its
title names the PYAPI-06 blind spot that let a production service-key mismatch run silently. NOT
164.3/164.3.1: those own gate integrity (a control that cannot fail), this is production
observability (a service down while every instrument reads green). ⭐ `CRON-OBS-01` and
`MT5-WEDGE-OBS-01` are ONE mechanism with two targets — a periodic prober that fails loud — and
are to be planned as one slice, not two.

⭐ **Standing rule until CRON-OBS-01 lands: `cron.job_run_details.status = 'succeeded'` is NOT
evidence that a pg_net-based job worked.** Read `net._http_response`.

### MT5-WEDGE-OBS-01 — a wedged MT5 gateway is invisible to every automated signal (booked 2026-09-01)

Same class as `CRON-OBS-01`: the failure is real, user-facing, and silent to every instrument.

**Measured 2026-09-01.** The `mt5-gateway` Railway service was running deployment `cc895b87`,
created 2026-08-25T12:47:54Z — the same interrupted maintenance window that stranded the cron key
(`CRON-DRIFT-01`). User key-connect failed with:

⚠️ Whether MT5 worked at any point between 08-25 and 09-01 is **unknown and unprovable**: nothing
probes it, which is precisely what this item books. Do not describe this as "healthy for 5 days
then wedged" — that is an inference from an absence of complaints, not a measurement.

```
analytics-service (deployment 8a885909):
  11:07:33  validate_key: MT5 transient upstream failure (code=-10005)
  11:08:50  validate_key: MT5 transient upstream failure (code=-10005)
mt5-gateway (deployment cc895b87):
  11:08:05  accepted ('10.224.213.79', 36962) … welcome
  11:08:50  goodbye          <- 45s later, no work done
```

`-10005` is an MT5 IPC timeout — the rpyc transport accepts the connection and the terminal never
answers.

⛔ **A redeploy does NOT fix this.** Measured the same day: redeploy `9117450b` booted clean
(`mt5linux server is running on port 8001`, 14s), and a real `validate_key` 10 minutes later
reproduced the failure exactly:

```
analytics-service  11:46:36  validate_key: MT5 transient upstream failure (code=-10005)
mt5-gateway        11:45:50  accepted ('10.143.156.226', 33992) … welcome
                   11:46:36  goodbye          <- 46s, no work done
```

So this is NOT uptime drift that a restart clears. The rpyc transport is healthy — it accepts and
welcomes. What never answers is `terminal64.exe` behind it, which matches this repo's own
documented reading of the code (`analytics-service/services/mt5_validation.py:79-83`): `-10004` is
"the bridge isn't attached at all", `-10005` is "the bridge IS attached but the terminal stopped
answering".

⛔ **"Not logged in" is NOT the explanation, and a VNC login is NOT the remedy.** The validate path
takes the per-terminal lease and calls `login(...)` itself on every call
(`analytics-service/routers/exchange.py:767-782`; MT5 binds one account per terminal at a time, so
one terminal cycles through hundreds of accounts a day). The gateway carries no `MT5_LOGIN` /
`MT5_SERVER` variables because it was never meant to hold a session. A pre-logged-in terminal was
never a precondition.

⭐ **ROOT CAUSE, CONFIRMED by direct observation 2026-09-01.** The terminal was sitting at an
**interactive login prompt**. A modal dialog blocks MT5's message loop, so `terminal64.exe` never
services the Python IPC bridge and every call times out as `-10005`. The service mounts a
persistent volume (`RAILWAY_VOLUME_ID` / `RAILWAY_VOLUME_MOUNT_PATH` are set, and the boot log
mounts it), so the Wine prefix and MT5 profile survive every redeploy — which is why the dialog,
and therefore the wedge, replays on every restart and why a redeploy is not a remedy here even
though a redeploy HAS cleared a wedge before.

⚠️ **The precise statement, because it was gotten wrong twice.** The terminal does NOT need to be
logged in for our calls to work — the validate path logs in per call. What it must not be is stuck
in a MODAL DIALOG. "Logged out" is harmless; "showing a login box" is fatal. Those are different
states and only the second one wedges the bridge.

**Remedy:** complete the login at the VNC console so the terminal reaches its normal running state
and saves the account. Cancelling the dialog unblocks IPC for the current boot but the prompt
returns on the next restart, reproducing the wedge.

✅ **RESOLVED AND VERIFIED 2026-09-01 12:07.** The founder completed the login the dialog was
asking for — **not** the account being added through the wizard, which is the point: any login
clears the modal, because the validate path re-logins per call. Verified end-to-end, not just at
the probe:

```
12:07:13  job_worker derive_broker_dailies: upserted 278 daily-return rows
          strategy 401d5f31… (venue=mt5 realized=0 funding=0 heuristic_capital=False)
12:09:25  job_worker derive_broker_dailies: upserted 278 daily-return rows  (same strategy)
```

No `-10005` after the modal cleared. ⚠️ The observability gap this item books is **still open** —
what closed was the outage, not the blind spot. Nothing would have told us either way without a
human clicking connect.

**Why nothing caught it.**

- Railway reports the service **healthy** — the container is running and the port is listening.
  The wedge is inside the Wine/MT5 terminal, one layer below what the platform can see.
- `/health` on analytics-service does not touch MT5 at all, so it stays green.
- The gateway's own log for a wedged call is `accepted … welcome … goodbye` — no ERROR line, no
  non-zero exit. Nothing to alert on without knowing that a 45s gap between welcome and goodbye
  with no work in between IS the failure.
- The only thing that spoke was a **human clicking connect in the wizard**, and what they saw was
  `KEY_NETWORK_TIMEOUT` (the generic catch tail, `src/app/api/strategies/finalize-wizard/route.ts:215-245`)
  — which reads as "your broker is slow", not "our gateway is dead".

**What is needed.** A periodic probe that actually round-trips MT5 (not a port check, not
`/health`) and fails loud on `-10005`/`-10004`, counted and surfaced. ⚠️ Not a silent skip when
the credential is absent — that is `SKIP-01`.


➡️ **ROUTED 2026-09-01 to Phase 164.1 (HARDEN-GUARDS).** That phase already owns this class — its
title names the PYAPI-06 blind spot that let a production service-key mismatch run silently. NOT
164.3/164.3.1: those own gate integrity (a control that cannot fail), this is production
observability (a service down while every instrument reads green). ⭐ `CRON-OBS-01` and
`MT5-WEDGE-OBS-01` are ONE mechanism with two targets — a periodic prober that fails loud — and
are to be planned as one slice, not two.

⭐ **Standing rule until this lands: a green `mt5-gateway` in Railway is NOT evidence that MT5
works.** The only current proof is a real `validate_key` round-trip.

⚠️ **Two wrong readings were made live during this incident. Both cost a wasted remedy, and both
are recorded here so the next person does not repeat them.**

1. *"It wedged after 5 days of uptime, so restart it."* → the redeploy changed nothing. Uptime was
   never measured; nothing probes MT5.
2. *"The terminal isn't logged in, so log it in over VNC."* → right ACTION, wrong REASON, and the
   reason is what makes it reusable. The validate path logs in per call (`exchange.py:767-782`)
   and there is no `MT5_LOGIN` variable, so a missing SESSION was never the problem. The problem
   was the login DIALOG blocking the message loop. Reasoning from "it needs a session" would send
   you to re-enter credentials on a terminal that is merely logged out and working fine.

The first came from reasoning about the error code instead of reading the call path. The second
came from reading the call path but not looking at the screen. Both were needed.


### ⛔ DRIFT-02 — a surgical in-place patch means the REPO no longer holds the true function body (booked 2026-08-27)

⭐ Caught by the pre-merge PROD diff, which is the ONLY thing that could have caught it.
It blocked a GDPR regression from shipping.

**What happened.** Phase 164's companion migration `20260827130000` does a whole-body
`CREATE OR REPLACE` of `sanitize_user`, re-based on the newest full definition in the repo
(`20260517013100`). Measured against PROD:

| | PROD (live) | what we were about to ship |
|---|---|---|
| erasure target | `DELETE FROM verification_requests_legacy` | `DELETE FROM verification_requests` |
| `verification_requests` | a **VIEW** (relkind `v`, 13 cols) | — |
| `verification_requests_legacy` | the **TABLE** (relkind `r`, 18 cols) | — |

Shipping it would have sent GDPR erasure at the VIEW — either erroring mid-erasure or
deleting through a filtered view and silently under-purging PII. That is precisely what
`20260620120000_verification_requests_view_shim_apply.sql` STEP 5.5 exists to prevent; its
own header calls the repoint **MANDATORY**.

**Why every existing control missed it.**
1. `20260620120000` performs a **surgical in-place repoint** — a string replacement against
   the live definition — not a full `CREATE OR REPLACE`. So it does not match
   `grep "FUNCTION public.sanitize_user"`, and the repo's newest FULL body is still the
   superseded `20260517013100`.
2. ⛔ **The authoritative body exists only in the database.** "Re-base on the latest
   definition" is UNSATISFIABLE from repo files for any function a surgical patch has
   touched. This is a CLASS, not an instance — it applies to every future whole-body
   replace of any surgically-patched function.
3. The migration reviewer verified the re-base as faithful — 47→48 statements, single
   insertion, zero deletions. It was faithful **to the wrong baseline**. Faithfulness to a
   stale source reads identically to correctness.
4. The shim's own drift guard (`:268`) aborts if `sanitize_user` has drifted — but it runs
   once, inside that migration, and cannot protect a later one.

- **[DRIFT-02a] Re-base `20260827130000` on PROD's live body**, not on `20260517013100`.
  The only correct source is `pg_get_functiondef` against production.
- **[DRIFT-02b] Add a pre-merge gate for whole-body replaces.** Any migration containing
  `CREATE OR REPLACE FUNCTION` for a function that already exists in PROD must diff its body
  against `pg_get_functiondef` and fail on any delta the migration does not explicitly claim.
  Cheap version: a checklist item; real version: a CI step with a read-only PROD connection.
- **[DRIFT-02c] Stop shipping surgical in-place patches**, or record them in a
  `supabase/schema/functions/*.sql` snapshot at the time they land, so the repo keeps a
  recoverable true body. The snapshot directory already exists and is already regenerated by
  other migrations — the shim simply did not update it.

⚠️ Same family as **DRIFT-01** (TEST runs an older revision) and **SKIP-01**: the artifact
and the reality diverge, and nothing in the pipeline compares them. DRIFT-01 was TEST-vs-repo;
this is **repo-vs-PROD**, and it is the more dangerous direction because merging auto-applies.

**✅ DRIFT-02a RESOLVED 2026-08-27 — and it was a ONE-IDENTIFIER fix, provably.** Read PROD's live
`pg_get_functiondef(sanitize_user)` (md5 `2f4ccf13db95b93464e028e5bce1e0f4`, 6696 chars),
transcribed it, and **proved the transcription exact by md5 equality** rather than by eye. Diffing
that verified body against the shipped body — with the added B1 arm and the added DRIFT-02 comment
block removed — left exactly **two hunks, both the `CREATE OR REPLACE` header wrapper**
(`uuid`/`UUID`, `boolean`/`BOOLEAN`, `SET search_path TO 'public','pg_catalog'` vs
`= public, pg_catalog`) and the `$function$` vs `$$` delimiter. Semantically identical, **zero**
statement-level differences. Before the correction the same diff had a third hunk — the erasure
DELETE naming the view — and that one hunk was the entire bug. So a 193-line body needed a 193-line
re-base only in the sense that it needed to be *checked* line by line; the repair was one token.

Two `sql-tests`-style arms now make the revert un-shippable rather than un-noticed: a positive arm
requiring `DELETE FROM verification_requests_legacy`, and a negative arm rejecting any DELETE
against the bare view. ⭐ **Both were demonstrated able to fail**, which took three mutations, not
two — mutations 1 and 2 abort on the positive arm before the negative arm is ever evaluated, so the
negative arm needed its own mutation (keep the legacy DELETE, add a view-named one alongside) to be
shown reachable at all. Without that third mutation the second arm would have been a test that
cannot fail, in a file whose whole subject is a check that failed to check.

⭐ **Executed, not asserted** — PostgreSQL 16.13, throwaway cluster, full apply GREEN, three
mutations RED, restore GREEN. This is `PROC-01` practised on the first file it applies to. Nothing
was applied to TEST or PROD. Run output is recorded in the migration header.

⚠️ **DRIFT-02b and DRIFT-02c remain open** — this closed the instance, not the class. Nothing yet
compares a whole-body replace against PROD before merge, and nothing yet stops the next surgical
in-place patch from erasing the repo's copy of a body. Route both with the `PROC-*` standards.

⚠️ **Checked and clear:** `scripts/check-gdpr-export-coverage.ts` harvests `DELETE FROM <table>`
out of migrations whose FILENAME matches `/sanitize_user/i`, so the repointed identifier changes
what it sees. Ran it — the only failure is the pre-existing, *intended* `strategy_shares` one that
cannot clear until the declaring migration is applied. No new redness.

### Phase 164 (SHARE) — ACCEPTED RESIDUALS, named (booked 2026-08-27)

Source: `.planning/phases/164-share-.../red-team/SYNTHESIS.md` §7 + §8 item 6. The synthesizer's
finding was that these three were **accepted in conversation and written down nowhere** — and
"accepting a residual silently is indistinguishable from missing it." That is the whole reason
this section exists. None of these is a task. Each is a decision with a name against it.

- **[SHARE-RES-R4] PITR / branch-DB restore defeats revocation.** A point-in-time restore or a
  Supabase branch DB restores `strategy_shares` *including the nonce and the generation counter*,
  so every token that was live at the snapshot instant becomes live again. **Nothing in-database
  can close this** — the revocation state and the thing being restored are the same store.
  Design-neutral: hash-at-rest does not survive a restore either, so this is not a cost of the
  HMAC+generation model.
  **Mitigation shipped:** per-environment `SHARE_TOKEN_SECRET` (founder ruling 2026-08-26),
  which bounds the blast radius to the restored environment — a branch or preview DB can no
  longer derive production-valid tokens. **Accepted:** the within-environment restore case.
  ⚠️ Operational consequence, not yet an item anywhere: a PROD restore is also a share-link
  un-revoke. Whoever runs one must re-revoke, and nothing reminds them.

- **[SHARE-RES-R2g] `service_role` DELETE+INSERT is not bound by anything in-database.** The
  nonce **downgrades** this from resurrection to link-death: an admin who deletes a row and
  re-inserts it gets a fresh `gen_random_uuid()` nonce, so the old tokens stop working rather
  than come back. The residual is narrower and requires intent: an admin who **records the nonce
  before deleting** can restore the exact row and revive every previously-revoked link.
  ⛔ **CORRECTED 2026-08-28 — BOTH HALVES OF THIS WERE WRONG.** Two reviewers measured it.

  (1) **It IS closable in SQL, in one line.** The trigger's INSERT branch forced `generation := 1`
  but left `nonce` caller-suppliable, so `service_role` DELETE + re-INSERT with a recorded nonce
  landed back on generation 1 — a byte-identical HMAC to a token that had been explicitly revoked.
  `NEW.nonce := gen_random_uuid();` in that branch closes it, verified not to break the mint lane
  (the RPC never names `nonce` and reads it back via `RETURNING`). Being fixed now.

  (2) **My justification conflated two different credentials.** I argued that anyone holding
  `service_role` could read `SHARE_TOKEN_SECRET` and mint directly anyway. `service_role` is a
  DATABASE credential; `SHARE_TOKEN_SECRET` is a Vercel environment variable. A database-only
  compromise, a pooler session, `pg_cron`, or an ordinary admin script holds one and not the other.
  Closing the in-database form is real defence, not theatre.

  ⚠️ **And the residual's blast radius was understated.** Measured by the RLS auditor: the restore
  reverses a completed **GDPR Art. 17 erasure**, reconstructing the exact pre-erasure
  `(nonce, generation, live)` triple — `gen 3 → sanitize_user → gen 4 revoked → DELETE + INSERT
  (recorded nonce) → gen 1 → two lawful +1 bumps → gen 3 → un-revoke`. Two statements, loopable to
  any N. Rule (6)'s +1 bound does not constrain it, because the DELETE resets the counter. The
  subject cannot self-remedy: the same RPC sets `banned_until = 'infinity'` and purges their
  sessions.

  **What remains accepted after the fix:** an actor holding `service_role` can still DELETE the row
  outright (killing links — the correct outcome for an erasure) and can mint fresh capabilities.
  What it can no longer do is resurrect a *specific previously-issued* link. If irreversibility of
  erasure is load-bearing for the GDPR posture, a counter cannot carry it — that needs an
  append-only revocation ledger, and it belongs in the Art. 17 DPIA rather than a migration
  comment. Booked, not done.

- **[SHARE-RES-F5] Capability URLs leak through channels no header controls.** Platform access
  logs, link unfurlers, browser history, and screen shares all see a token that is part of the
  URL. Inherent to capability URLs; the phase's own D-01 (`/factsheet-share/[token]`) chose a
  path segment over a query param. **Accepted.**
  ⚠️ **Correction to SYNTHESIS §7 (my error, propagated).** SYNTHESIS says `Referrer-Policy`
  "strips query strings cross-origin, never paths." That is wrong, and it originated in a claim
  I made and later measured to be false. Under the default `strict-origin-when-cross-origin` a
  cross-origin request sends **only the origin** — neither path nor query survives. So the
  path-vs-query choice is **Referrer-neutral**, and this phase ships per-route `no-referrer`
  anyway, which closes that channel outright. The path choice still matters, but for a different
  and narrower reason: log and analytics pipelines commonly redact query strings while retaining
  paths. Keep the residual; discard the stated mechanism.

**What is NOT on this list, deliberately:** N1 (INT4 overflow wedging Art.17 erasure) and N2
(revoke race). Those are **open defects gating 164-03**, not residuals — see the six-condition
merge gate at `SYNTHESIS.md:270-287` and the wave restructure in ROADMAP Phase 164.

⭐ **N1 RE-MEASURED AT HEAD 2026-08-27 — reproduces, but its recorded severity is WRONG.** Run
against the real applied schema on a throwaway PostgreSQL 16.13 (see
`.planning/phases/164-.../EXECUTION-EVIDENCE.md` §5): an owner PATCHes `generation` to bigint max
(⛔ accepted — they hold the `UPDATE(generation)` column grant and the trigger forbids only a
*decrease*), `revoke_strategy_share` then wedges `22003`, and **`sanitize_user` aborts the entire
Art. 17 erasure with the same `22003`**. `BIGINT` raised the ceiling and closed nothing, exactly as
that migration's own header warns. 164-06 stays required.

**But** `SYNTHESIS.md` calls it "unrecoverable without DDL, or a DELETE that resurrects
everything." Measured, `service_role` remedies A (tombstone without bump) and B (rewind) are both
correctly BLOCKED by the trigger — and remedy C (`DELETE` the row) **works and resurrects
nothing**, because a re-created row draws a fresh nonce and every old token dies. That claim was
true pre-nonce and was never re-checked after the nonce landed. True shape at HEAD: *a data subject
can wedge their own erasure until an operator deletes one row* — an availability bug with a
one-statement remedy, not an unrecoverable regulatory failure. Still blocking 164-03; no longer the
worst item in the corpus.

✅ **N2 CLOSED AS NOT-A-DEFECT — founder ruling 2026-08-27. Dropped from 164-06, which is now N1-only.** ⛔ Do not re-open by adding `SELECT … FOR UPDATE` or editing STEP 6 arm (i-b) without new measured evidence; the arm is a guard, not a bug-pin.

⭐⭐ **N2 DOES NOT REPRODUCE (measured 2026-08-27) — and the proposed fix WAS the bug.** Three interleavings, two concurrent sessions each (one holds the row lock in an open transaction, the other arrives 1s in and blocks): revoke∥revoke converges (`rows=1` / `rows=0`, generation advances exactly once); revoke-then-mint and mint-then-revoke both converge with no lost update, no counter inflation and no resurrection. Root cause of the non-reproduction: **both RPCs are single statements** — one `UPDATE … WHERE … AND revoked_at IS NULL`, one `INSERT … ON CONFLICT DO UPDATE … RETURNING` — so there is no read-then-write window for a `SELECT … FOR UPDATE` to protect, and under READ COMMITTED the blocked writer re-evaluates its `WHERE` against the updated row (EvalPlanQual).

⛔ `revoked_at IS NULL` is **the convergence contract**, not a racy predicate. The recorded remedy — rewrite STEP 6 arm (i-b) *so the fix can land* — would have removed the guard, and removing the predicate is what makes a double-revoke inflate the counter. **The arm was not enforcing the bug; the proposed fix was the bug.** None of this was visible without running it: the reasoning chain reads as sound end to end and is simply false. Recommend closing gate condition 3 as not-a-defect and dropping N2 from 164-06 (leaving that plan N1-only) — ⚠️ founder call, since the corpus records N2 as `[M]`. Limits: READ COMMITTED (PostgREST's default), two sessions not N, three interleavings not an exhaustive schedule search.

### Phase 164 (SHARE) — code-review + closure residuals (booked 2026-08-28)

Source: `164-REVIEW.md` (0 critical / 3 warning / 6 info) plus two defects found while running the
closure pipeline. The two user-reachable warnings (WR-02, WR-03) are FIXED and committed; what
follows is everything that was not.

- **✅ CLOSED 2026-08-28 — [SHARE-WR-01] `.env.example` instructed the operator to REUSE one `SHARE_TOKEN_SECRET`.**
  The block added in 164-01 says "set it in ALL Vercel environments", which reads as one shared
  value — precisely the configuration the founder ruling of 2026-08-26 forbids, because a preview
  DB seeded from a production snapshot then becomes a production-token factory. The module docblock,
  `SECRET_REMEDY` and the boot error all say **DISTINCT per environment**; the file an operator
  actually follows verbatim says the opposite, and nothing downstream detects it (the boot check
  verifies length, not distinctness). The same block also documents the stale two-argument
  pre-image `HMAC(secret, "<id>.<generation>")`; the real one is
  `qz.strategy-share.v1.<id>.<nonce>.<generation>`.
  **Fixed in `40527f101`** via a scripted patch the founder ran (this environment denies agent
  access to `.env*`). ⚠️ Lesson kept: the first patch located the block by walking up over
  contiguous `#` lines from the assignment, which swallowed the section banner and the module-load
  rationale — a structural anchor that treats a section header as part of the paragraph below it.
  Restored in the same commit.

- **[SHARE-D-164-C] `create_scenario_share` is not in `MUTATING_RPC_NAMES` at all.** Pre-existing,
  on shipped code: `allocator/scenario/share/route.ts` has therefore never been under the audit
  law. Phase 164 put the new `create_strategy_share` / `revoke_strategy_share` under it and left
  the older sibling out, which is now the only unaudited share mint in the tree.

- **[SHARE-INFO] six Info findings**, none blocking under the stopping rule: ci.yml arm-count
  narrative arithmetic (the *enforced* integers are correct and were re-verified — 103/166/8); the
  Sentry breadcrumb/extra scrub is one level deep; the 32-char secret floor is duplicated with no
  drift test; `sanitize_user` keeps `SET search_path = public, pg_catalog` with no explicit trailing
  `pg_temp`; `strategy-share-token.test.ts` mutates `process.env.SHARE_TOKEN_SECRET` without
  per-test restore; and a future strategy-ownership transfer would wedge mint and orphan a live
  capability.

- **[SHARE-COV-01] a `#` comment inside a SUMMARY's `coverage:` block silently voids the whole
  block.** Measured 2026-08-28: `gsd-tools query uat.classify-coverage` returned
  `mode: legacy` with a single `malformed_block` error, and the fallback is a **quiet** prose
  extraction — every deliverable is dropped and nothing fails. Related: 164-04's block shipped with
  `deliverable:` instead of `id:`+`description:` and free-text `kind:` values, which produced 27
  validation errors and 0 auto-passed deliverables while reading as authoritative. Both repaired;
  the class belongs to Phase 164.3 (VACUITY).

- **[SHARE-B15-01] ⚠️ the B15 limiter registry has no owner in the phase that adds a route.**
  The two new share routes landed unclassified in `src/lib/api/limiter-ordering.test.ts`, and
  nothing inside phase 164 scans that registry — it went red only under the execute-phase
  regression gate over phases 158–163. Fixed (both added to `NO_INPUT`), but the *gap* is that a
  phase can add a rate-limited route and never run the invariant that governs it.

### Phase 164 (SHARE) — /qa on PRODUCTION, post-deploy (booked 2026-08-28)

Ran to close UAT 7 (Plausible) and UAT 9 (Sentry), which were recorded BLOCKED locally.
Neither closed. Both found something better than a pass.

- **✅ FIXED — [SHARE-QA-01] the share token could still reach Sentry, in a TAG.**
  `scrubSentryEvent` covered `request.url`, `transaction`, breadcrumbs, spans, trace
  description and `extra` — but NOT `event.tags`. ⛔ Evidence is a LIVE PRODUCTION EVENT:
  QUANTALYZE-16 shows the SDK setting a `url` tag from the raw request URL independently
  of `request.url` (`transaction: GET /factsheet/[id]` parameterised, `url` tag
  `https://quantalyze.xyz/factsheet/Next.Metadata` RAW). On the share lane that tag would
  have carried a live capability to a third-party store, and tags are INDEXED and
  queryable — worse than a body field. ⛔ The existing test could not find it: `tokenEvent()`
  was built to cover "every channel the scrubber claims to cover", so it mirrored the
  implementation's own surface and inherited its blind spot. Fixed + fixture extended;
  both arms OBSERVED red with the scrub removed.
  **Class still open:** the scrub enumerates fields by hand. Nothing proves the enumeration
  matches what the SDK actually populates. A future SDK version can add a field and the
  scrub will silently not cover it. Candidate for 164.3 (VACUITY).

- **✅ FIXED — [SHARE-QA-02] `secret-scan` went RED on main** after the v0.76.0.0 squash
  merge: 5 `generic-api-key` findings on the phase's hand-typed 43-char token fixtures.
  Rule-scoped allowlist (not a path exemption, per the config's own CR-03 lesson), proven
  NARROW by probe. Same push-to-main-only asymmetry several existing entries document.

- **✅ [SHARE-QA-03] UAT 7 (Plausible) — CLOSED AS NOT-APPLICABLE. Founder call 2026-08-28:
  THERE IS NO PLAUSIBLE ACCOUNT.** Measured first, then explained: zero `plausible.io`
  requests on prod `/strategies`, no script tag in the DOM, `window.plausible === undefined`,
  and `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` unset in every Vercel environment. The reason is not a
  misconfiguration to fix — the service was never signed up for. `src/app/layout.tsx:49,99`
  gates the tag on that var, so the tag can never load and UAT 7 can never obtain a positive
  control. Recording it as permanently blocked would leave a checkpoint nobody can ever close.
  ⛔ **Do NOT "fix" this by setting the var.** A `data-domain` with no matching Plausible site
  loads the script and drops every event silently — it would manufacture a passing positive
  control while recording nothing, which is worse than the honest absence.
  **Status of the SHARE-01 Plausible mitigation: DORMANT BY DESIGN, and still correct.**
  `PlausibleScript` withholds the tag on `/factsheet-share/*` and is unit-tested; it arms the
  moment analytics is ever adopted. The CSP already allows `https://plausible.io` in both
  `script-src` and `connect-src` (`next.config.ts:97`) — harmless, but it is an allowance for
  a host this app never contacts. ⚠️ If analytics is ever adopted, re-open UAT 7 and get the
  positive control before trusting the negative.

- **✅ [SHARE-QA-04] UAT 9 (Sentry) — CLOSED, and closing it found a LIVE LEAK.**
  Method: real `next build && next start`, SDK pointed at a local ingest server, a genuine
  500 driven on `/factsheet-share/<token>`, then the transmitted bytes read directly. Prod
  was never touched.
  ⛔ **`contexts.trace.data.http.target` carried the RAW TOKEN** while `http.route`,
  `request.url`, `transaction`, `extra.path` and `tags.routePath` beside it were all
  correctly scrubbed. `http.target` is the OTel convention for the raw request target.
  Fixed in `cb644bd45` by making the scrub RECURSIVE (nested objects + arrays) rather than
  by naming one more field — this was the SECOND miss of a hand-maintained enumeration
  after `tags`.
  Re-verified end-to-end: 40 requests to force trace sampling (0.1), 10 transaction
  envelopes, `http.target` now reads `/factsheet-share/[token]` — PRESENT and scrubbed,
  not absent.

- **⛔ [SHARE-QA-05] UAT 9 WAS NEVER REPRODUCIBLE ON A DEV SERVER — measured, not assumed.**
  Next 16.2.11 does **not** invoke `instrumentation.ts`'s `onRequestError` in `next dev`.
  Proven with a temporary probe: a real 500 on the share lane produced no probe output and
  no Sentry event, with `SENTRY_DSN` set and the capture server confirmed reachable. The
  same request under `next start` fired the hook immediately.
  **Consequence for the backlog:** any future check of the Sentry redaction path MUST use a
  production build. A dev-server run will show a clean capture for the wrong reason and read
  exactly like a pass.

- **[SHARE-QA-06] the scrub still enumerates WHERE to walk, even though it no longer
  enumerates WHAT to scrub.** `scrubSentryEvent` names `request.url`, `transaction`,
  `breadcrumbs`, `spans`, `contexts.trace`, `extra`, `tags`. Two of those were added only
  after a live leak. Nothing proves the list matches what the SDK populates, and the wire
  capture used above is the only thing that ever has. ⭐ Candidate mechanism for 164.3
  (VACUITY): keep the capture harness and assert on transmitted bytes, rather than on a
  fixture that mirrors the implementation's own idea of its surface.

- **[SHARE-QA-07] the recursive scrub weakened the file's own no-throw contract.**
  `src/instrumentation.ts:41` promises that a future SDK shape change degrades to "that
  field was not scrubbed" and NEVER to a throw inside `beforeSend` — and a throw there
  drops the whole event, so the failure mode is silent loss of error reporting. The
  shallow walk assigned only to top-level keys; the recursive one assigns unconditionally
  across every nested object and array it reaches, so a frozen object, a sealed object or
  a getter-only property anywhere in the subtree now throws where it previously could not.
  No evidence Sentry freezes events and `beforeSend` has no `try/catch`, so this is
  hardening, not a live defect — but the comment currently overstates the guarantee.
  Remedy is one of: wrap the body in `try/catch` and return the event unscrubbed-but-
  delivered on throw (WRONG — that would ship the token), wrap and return `null` to DROP
  the event fail-closed, or assign only when `scrubSharePath` actually changed the string.
  ⭐ The third is cheapest and shrinks the write surface to the rare match. Decide in
  164.1; do not leave the contract comment claiming more than the code delivers.

### Phase 164 (SHARE) — browser-UAT findings (booked 2026-08-28)

Source: `164-UAT.md`, 9 checkpoints against localhost pointed at TEST — 7 passed, 2 recorded
BLOCKED. Both defects below were found ONLY by driving the browser, after a code review, a
verifier pass and a green 88-file regression gate had all cleared the phase.

- **✅ FIXED — [SHARE-UAT-01] every `GET /strategies` threw.** `isPublishedStatus` was declared in
  `ShareableLink.tsx`, which carries `"use client"`; `strategies/page.tsx` is a Server Component
  and CALLS it — on the exact line this phase added when it removed the status gate. Three
  requests, three throws. ⛔ **The class, not the instance:** `page.share-affordance.test.tsx`
  makes the same call and passes, because **jsdom does not enforce the RSC boundary**, so no unit
  test in this repo could have caught it. Fixed in `4db23fe3b` by moving the declarations to a
  directive-free `src/lib/share-affordance.ts`; pinned by a directive assertion that matches a
  bare statement, not a substring (the docblock explains the absence and contains the string).
  **Still open as a class:** nothing detects a server component calling a client-module export.
  Candidate for Phase 164.3 (VACUITY) — it is a control that cannot fail, in the test layer.

- **✅ FIXED — [SHARE-UAT-02] the pending factsheet promised a share link with no control.** The
  still-computing early return rendered `OwnerUnpublishedNotice` alone — a notice ending "You can
  create a private share link…" — on a page with ZERO clickable elements. Same SHARE-04 dishonesty
  class the phase exists to close, on the one render path the class review never walked, and on
  the path the placeholder's own comment calls the moment "an owner is MOST likely to share the
  URL". Fixed in `4db23fe3b` (`OwnerUnpublishedPanel`: notice and controls on one `shareLive`
  state, so fixing the missing mint button could not manufacture a false revoke promise).
  Regression-pinned in `8f26f2a21` — three arms, all OBSERVED red under the bug's real shape.
  ⚠️ Those arms pin DOM **presence**, not visibility: a `className="hidden"` mutation left all
  three GREEN, because jsdom does no layout. Visual-regression territory, not booked as a defect.

- **[SHARE-UAT-03] ⛔ THE IN-PAGE BUTTON HAS NEVER BEEN SUCCESSFULLY CLICKED.** Both synthetic
  clicks produced **zero network requests**, so checkpoints 1/2/6 (mint, reuse, revoke) were
  exercised against the ROUTES, not through the component's own handler. The route contract is
  proven; the click path is not — and that is exactly where the WR-02 Safari
  transient-user-activation concern would surface. A human click is owed. Not fixable by an agent
  in this environment.

- **[SHARE-UAT-04] UAT tests 7 (Plausible) and 9 (Sentry) are BLOCKED, not passed.** No
  `plausible.io` request on the share lane — but none on a normal page either, because Plausible
  is not configured on the local server. Without the positive control the negative proves nothing.
  Same for Sentry (`SENTRY_DSN` unset locally). Both need a deployed environment to become real
  evidence. Recorded as blocked deliberately: reporting them as passes is the vacuity this phase
  spent its whole red-team budget on.

### ⚠️ GSD-01 — `/gsd-plan-phase` cannot add ONE plan to a partly-executed phase (booked 2026-08-28)

`/gsd-plan-phase <N>` replans the **whole** phase. Once some plans carry SUMMARYs, running it risks
regenerating or renumbering executed work, so the only safe path is authoring the new PLAN.md by
hand — which skips the orchestrator-only gates (`plan-phase` step 5.5's VALIDATION.md refresh, and
7.5), and skips `gsd-plan-checker` entirely.

Hit four times in phase 164: `164-06` and `164-07` were hand-authored net-new; `164-03` and
`164-04` were hand-revised. In each case the VALIDATION.md rows had to be written by the
orchestrator to cover the gate that did not fire — see the note at the bottom of
`164-VALIDATION.md`.

⚠️ **This is the same family as `NYQ-01`** (a config-enabled planning gate stopped firing and
nothing noticed). There the gate was silent by accident; here it is silent because the only safe
route around a tool limitation goes past it.

**Fix:** an `--add-plan` mode that appends a single plan to an existing phase and runs the checker
plus the 5.5 refresh over it alone. ⛔ Upstream `gsd-core`, not this repo — same bucket as
`depends_on` yielding `blocked_by: {}` and wave frontmatter drifting from ROADMAP. Phase 164.3
**excludes** this bucket deliberately; do not fold it in.

### ⚠️ DRIFT-03 — an MCP hand-apply stamps the ledger with the APPLY TIME, not the filename (booked 2026-08-28)

Surfaced during the Phase 164 TEST hand-apply. `apply_migration` writes
`supabase_migrations.schema_migrations.version` as the **wall-clock time of the apply**, keeping the
real filename only in the `name` column. TEST now reads:

```
20260828061901  ->  name 20260827120000_strategy_shares_generation_model
20260828062101  ->  name 20260827130000_sanitize_user_revoke_strategy_shares
```

PROD's Migrate workflow will register the same two files as `20260827120000` / `20260827130000`.

⛔ **So any TEST-vs-PROD drift check keyed on `version` silently reports these as missing from TEST.**
Not hypothetical — `DRIFT-01` is exactly such a check, and `CI-MIGRATE-01` proposes building more of
them. A comparison that joins on `version` will conclude TEST is behind when it is current.

Pre-existing, not caused by this phase: the row above these two,
`20260826210044:destrict_enqueue_internal_10param`, has the identical shape.

**Fix:** key drift comparisons on `name`, not `version` — or normalise `version` from the leading
timestamp in `name`. **Route to Phase 164.3** (`DRIFT-02b`'s neighbour): it is the same root as the
rest of that phase — *the claim and the thing are never compared*, and here the join key itself is
the thing that lies.

### NYQ-01 — a config-enabled planning gate stopped firing and nothing noticed (booked 2026-08-26)

⭐ **Founder-ruled 2026-08-26: regenerate, don't waive.** Surfaced while closing Phase 164's
plan-checker gate.

**The mechanism, measured.** `.planning/config.json` sets `workflow.nyquist_validation: true`.
`plan-phase` step 5.5 keys on a `## Validation Architecture` section in the phase RESEARCH.md and
writes `{phase}-VALIDATION.md`. Measured across phases 158–164:

| Phase | RESEARCH has `## Validation Architecture` | VALIDATION.md |
|---|---|---|
| 158, 159, 160, 161, 162 | yes | **present** |
| 161.1, 163, 164 | yes | **absent** |

So the precondition held every time and the artifact simply stopped being written. 163 was planned,
executed, verified and SHIPPED without it. Nothing in the pipeline reported a missing gate —
`gsd-plan-checker` only flags it if something invokes the checker, and on 164 the planner had been
hand-spawned outside the orchestrator, so the checker did not run either until it was invoked by
hand. **Two independent gates were silent at once, and the run still looked clean.**

- **[NYQ-01] Make a skipped step 5.5 loud.** Writing 164-VALIDATION.md by hand fixes one instance;
  it does not fix why five phases' worth of the gate produced nothing. Wanted: a check that fails
  when `nyquist_validation: true` and a phase has `## Validation Architecture` but no VALIDATION.md
  — the same shape as the `sql-tests` anti-SKIP net.
- **[NYQ-01b] Backfill or explicitly waive 163 and 161.1.** Both shipped; the artifact is now
  archival, so a recorded waiver may be the honest close rather than a reconstructed document.

⚠️ Same family as **SKIP-01** and **CI-MIGRATE-01**: a gate whose failure mode is *silence*, where
the green run and the un-run run are indistinguishable from the outside. The standing lesson holds —
**absence of a red is not evidence a gate fired.** Check the artifact, not the exit code.

### Phase 163 / WR-06 residual — a non-UTC reporter reads "ends in the future" ~3h every day (added 2026-08-26)

WR-06 is FIXED for the defect it named (a future series end no longer renders amber beside
"just now"; badge and factsheet chip now agree, both muted). The residual below is the
*stated scenario* that motivated it, and it is NOT closed — recording it so the fix is not
mistaken for covering more than it does.

**Why the clock-skew grace cannot cover it.** `series_end` is a bare date (`"2026-08-27"`)
parsed at UTC midnight, so it is **day-granular**. A reporter at UTC+3 has a local calendar
date ahead of UTC's whenever local time is 00:00–02:59 — the three hours before midnight UTC
— putting `series_end` up to ~3 hours ahead. `CLOCK_SKEW_TOLERANCE_MINUTES` is 5 minutes. The
grace is two orders of magnitude too small, and widening it to 3h would be the wrong fix
anyway: it would start excusing genuine clock problems.

**The correct fix is day-granular comparison** — for a value whose own resolution is one day,
anything under ~1 day ahead is the field's resolution plus timezone, not evidence of anything.

⛔ **It must be done in ONE coordinated change across BOTH surfaces.** `bucketSeriesAge`
(`src/lib/freshness.ts`) and `bucketByAge` (`src/app/factsheet/[id]/v2/FactsheetView.tsx`,
which maps `days < 0` to `future` with no allowance) consume the identical input. Fixing only
the badge would make it read `fresh` while the chip still reads `future — check data`, which
manufactures a NEW two-surface contradiction — the exact class this phase exists to close.
That is why the phase-163 fixer deliberately stopped here rather than half-fixing it.

- **[WR-06-UTC] Give both bucketers a day-granularity allowance for future-dated series ends**,
  in one commit, with a test that renders both surfaces from one row and asserts they agree.

**Net effect today:** for those ~3 hours a day, a non-UTC reporter's strategy renders a muted
grey "Track record ends in the future" on both the discovery badge and the factsheet chip.
Honest and self-consistent — no longer a contradiction, and no longer amber — but still a
degraded render for a perfectly healthy strategy.

⭐ **MECHANISM CORRECTED + MEASURED LIVE 2026-08-26.** Two things this entry could be misread as
saying, both wrong:

1. **The VIEWER's timezone is irrelevant.** `bucketSeriesAge` compares `now.getTime()` against
   `series_end` parsed at UTC midnight — two absolute instants. Nothing in the read path reads a
   local calendar. The offset enters on the WRITE side: the reporter's local date is what gets
   stamped into the series. So the trigger is **a row whose `series_end` is a future UTC date**,
   not who is looking at it. A browser with an overridden timezone will not reproduce this.
2. **`strategy_analytics` has no `series_end` column on PROD.** `seriesEndOf` therefore always
   falls through to the `returns_series` array arm. Anything written against the scalar is
   describing a shape production does not have.

**Live census on PROD, 2026-08-26 18:54 UTC — the defect is LATENT, not active:**

```
strategies_with_series 20 | future_dated 0 | dated_today 0 | newest_series_end 2026-08-25
```

⇒ Nothing renders the degraded copy today. ⛔ A browser QA sweep for this would come back green
and prove nothing — the precondition is absent from the data, not from the code. Reproducing it
needs a seeded row stamped with tomorrow's UTC date, which is also the shape the regression test
must use.


### ⚠️ PRE-EXISTING — a personal email is published in tracked AI-review payloads (added 2026-08-26)

Surfaced by the pre-push secret guardrail while pushing phase 163. **Not introduced by that
branch** — verified: the file is byte-present on `main` with the identical two email-shaped
strings, and phase 163's only change to it was the username scrub. Recording it because a
finding reviewed and then not written down is a finding that gets re-discovered.

**What is exposed.** `.planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-REVIEWS/`
holds a 174 KB single-line `grok-request.json` (plus 8 sibling payload/response artifacts,
376 KB total) containing **5 occurrences of a personal `@gmail.com` address** and one
`internal.url_private` match. The repo is PUBLIC, so these are world-readable.

⚠️ Three further "email" hits in the same scan are FALSE POSITIVES — markdown file
references of the form `<word>@DESIGN.md`. Two other MEDIUM hits elsewhere in the diff are
also false positives worth knowing about, because they will recur on every future scan:
- `pii.cc` matched a git **index line** (`index 32b20c410..656217189 100644`) — diff
  metadata, not content.
- `pii.phone.e164` matched `+20260716090000:283-311` — the diff's `+` marker followed by a
  migration timestamp, which reads as an E.164 number.

**Marginal risk is genuinely low** and should not be overstated: git commit author emails are
already visible on any public repo, so the address is very likely public already through
`git log`. What is new is the address sitting inside AI-vendor request payloads.

- **✅ DECIDED 2026-08-28 — [PII-01] the `13-REVIEWS/` payload artifacts are DELETED FORWARD.**
  Founder-approved during the Phase 164.x dedup. Six tracked files, 376 KB, removed from
  `.planning/milestones/v0.17.0.0-phases/13-discovery-v2-polish/13-REVIEWS/`: `grok-request.json`
  (the 174 KB single-line payload holding the five `@gmail.com` occurrences and the
  `internal.url_private` match), `grok-payload.md`, `grok-response.json`, `grok-review.md`,
  `claude-fresh-review.md`, `SYNTHESIS.md`. Nothing consumed them — a repo-wide grep across
  `*.ts/*.tsx/*.py/*.json/*.yml` returned zero references.
  ⛔ **RECORDED LIMIT, not a fix:** they remain in git history and are still world-readable there.
  History rewriting was explicitly declined by the founder and that decision STANDS — this deletion
  narrows what a reader of the current tree finds, and does not pretend the data is gone. Anyone
  re-discovering the address in history should find this entry, not re-open the question.
  ⚠️ The marginal risk statement below still holds and should not be overstated: commit author
  emails are already public via `git log`, so the address was very likely public independently.
  What this removes is the copy sitting inside AI-vendor request payloads.
  ⛔ These artifacts predate the standing no-Grok/no-Codex rule; they are not evidence of current practice.

<details><summary>Original open item (superseded 2026-08-28)</summary>

- **[PII-01] Decide whether the `13-REVIEWS/` payload artifacts should stay tracked.** They
  are historical AI-review request/response dumps with no ongoing consumer. Deleting them
  forward removes them from the working tree but NOT from history (history rewriting was
  explicitly declined by the founder, so that limit is deliberate and stands). If they are
  kept, the decision should be recorded rather than left implicit.

</details>

⛔ Related standing rule: Grok and Codex are no longer used at all. These artifacts predate
that decision — they are not evidence of current practice.


### ✅ ACCEPTED RISK — Phase 163 / WR-10: the password floor was MEASURED, not RAISED (decided 2026-08-26)

⭐ **DECIDED 2026-08-26 by the founder: the six-character floor is ACCEPTED.** The risk below
was presented in full — including the key-material exposure path — and accepted knowingly.
This is a recorded acceptance, not a deferral and not an oversight: nothing here is waiting on
anyone. Kept in full rather than deleted so the reasoning is auditable, and so that a future
reader who rediscovers the weak floor finds the decision instead of re-opening it.

⚠️ What would REVERSE this: paying clients, a custody or compliance requirement, or any
evidence of credential-stuffing against the platform. At that point the remedy below is still
the remedy — it does not expire.

SEC-01 closed by MEASURING the hosted password policy and mirroring it in one exported
constant. The measurement discipline was right and is not in question: the hosted minimum was
read from the live signup endpoint's own rejection (**6 characters, and `reasons: ["length"]`
alone, so no character-class requirement**), never assumed from the GoTrue default.

**But measuring a weak floor and faithfully mirroring it is not hardening.** The outcome of a
requirement in a phase titled *"HARDEN — fail safe, closed, and loud"* is that a platform
which custodies users' exchange API keys accepts a six-character, all-lowercase password.
Nothing in the phase raised the actual gate — SEC-01's own docblock says the client constant
is UX only and the real gate is hosted GoTrue.

**Why this is a security item and not a preference.** 26^6 ≈ 3×10^8 is trivially searchable
offline and well within online rates, because the observed rate limiting is per-route rather
than per-account. The connected venue keys are decryptable server-side by the platform, so
account takeover is key-material exposure, not just account access.

- **[WR-10] RAISE the hosted minimum and enable leaked-password protection.** Both are
  DASHBOARD-OWNED settings with no repo representation, so a code change alone cannot do it.
  Sequence: raise the hosted minimum (10–12 is the common floor) and switch on GoTrue's
  leaked-password protection, THEN move `MIN_PASSWORD_LENGTH` and its recorded reading in the
  same commit. The procedure is already written down in the constant's docblock.

✅ DONE — the SEC-01 entry in `.planning/REQUIREMENTS.md` now records this acceptance
explicitly. It still does NOT claim the floor was validated: it was observed, accepted, and
says so. Observing a weak floor and accepting it are both legitimate; claiming it was cleared
would not be, and that distinction is the whole point of this phase.


### Phase 163 / OPS-08 (de-strict `_enqueue_compute_job_internal`) — routed onward (added 2026-08-26)

Raised by the three-reviewer gate on `supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql`.
Everything blocking was fixed in that migration and in `supabase/tests/test_enqueue_internal_destrict.sql`;
these four are the deliberate carry-overs, each with the reason it was not fixed there.

- **[OPS-08-TS] The TS half of OPS-08 was never written — nothing retries on 40001.**
  The migration now raises `serialization_failure` (40001) when a lost race's winner has
  already advanced past the in-flight statuses. **Measured at HEAD 2026-08-26:**
  `grep -rn 'serialization_failure\|40001' src/` returns ZERO non-test hits, and
  `src/app/api/allocator/holdings/sync/route.ts:73-87` still answers a blanket 500 for
  every SQLSTATE except `42501`. So the SQL half buys a correct, disambiguated code in the
  logs — a *prerequisite* for a retry, not a retry. Until a caller branches on it, the
  user-visible outcome of a lost race is unchanged. Not done in 163-06 because the plan's
  declared files are SQL only; the migration's header now states the limitation rather
  than claiming the capability. Fix: branch on `error.code === '40001'` at the enqueue
  call sites (allocator holdings sync, csv-finalize) and retry once before falling through
  to the 500.

- **[OPS-08-F2] Both pg_cron fan-out paths swallow the new error and report success.**
  `supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql:449` and
  `20260825140000_ledger_refresh_composite_arm.sql:400` catch `WHEN OTHERS` around the
  enqueue, withhold the `strategy_id`, and continue — so a 40001 (or any other enqueue
  failure) makes the tick UNDER-COUNT while still reporting success. Pre-existing, not a
  regression introduced by 20260826150000, which is why it was recorded rather than fixed
  in that migration. Fix: record the failed target id and surface a non-zero failure count
  from the tick.

- **[OPS-08-F9] `test_enqueue_internal_destrict.sql` has no `ALL N ARMS EXECUTED` sentinel.**
  Any arm can be neutered in place and the file still exits 0, the same as the other ~60
  sentinel-free files in `supabase/tests/`. Declaring one is not free-standing: it requires
  raising `SENTINEL_FLOOR` 7 -> 8 and `ARMS_FLOOR` 63 -> 68 in `.github/workflows/ci.yml`,
  plus the per-file derivation entry that
  `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` reads — and ci.yml is
  outside plan 163-06's declared files and was being edited concurrently by another
  Phase 163 workstream. Fix: add the sentinel and both integers in one diff.

- **[OPS-08-F8] Follow-through on the sql-tests first-failure blast radius.**
  163-06 fixed its own instance (the gate is now a both-or-neither coherence assertion that
  is meaningful pre- and post-apply, instead of knowingly RED). The general problem stands:
  the `sql-tests` loop exits on first failure, so ANY file that is red for an expected
  reason silently suppresses every file sorting after it — for this one, ~40 of ~70. Fix:
  either run every file and aggregate failures at the end, or make the expected-red state
  a first-class, per-file declaration the runner understands.

  ⚠️ **STILL OPEN. Phase 164.3 plan 05 did NOT close this class — read carefully before
  ticking it off.** That plan built a NEW tool, `scripts/mutation-runner/run.mjs`, which
  aggregates across arms by design: it runs every annotated arm, collects defects into one
  table, and only then exits (first-failure identity is asserted WITHIN an arm's run, never
  ACROSS arms). So the run-all-and-aggregate shape now exists in the repo and is proven by
  `--self-test`.

  But that is a *second* runner standing beside the problem, not a fix to it. **The
  pre-existing `sql-tests` loop in `.github/workflows/ci.yml` is untouched and still exits on
  first failure**, so the ~40-of-~70 suppression described above is exactly as live today as
  when this item was written. Converting that loop is a riskier edit to a live gate that
  guards production migrations, and it was deliberately deferred rather than bundled into a
  plan whose subject was the mutation runner.

  Recording this explicitly because the tempting summary — "164.3 added arm aggregation, so
  F8 is handled" — would be a claim about a different artifact than the one this item names.
  That substitution is the precise defect class Phase 164.3 exists to catch, and it would be
  a poor look to commit it in the ledger entry for the phase's own work.

### Phase 163 / OPS-08 — TEST runs an OLDER REVISION of `_enqueue_compute_job_internal` (added 2026-08-26, corrected + root-caused 2026-08-26)

Found while pre-flighting the OPS-08 migration's gate arms against both databases. Three
reviewers independently worried that one gate arm is "meaningful on PROD and vacuous on
TEST". Measuring it explains exactly why, and the cause is broader than that one arm.

| | definition length | line-comment markers | carries the `--` comment naming the strict form |
|---|---|---|---|
| PROD 7-param | 4622 | 23 | yes |
| TEST 7-param | 3093 | **0** | no |

⭐ **CORRECTED 2026-08-26 — "comment-stripped build" was the wrong framing and should not be
repeated.** Re-measured: PROD's 7-param body stripped of comments is **3172** chars; TEST's raw
body is **3093**. Not equal, so TEST is NOT this definition minus its comments — TEST is running
an **older revision** of the function. The observable (0 comment markers vs PROD's 23) is the
same; the explanation is not, and the wrong one implies a stripping mechanism that does not exist.

⭐ **ROOT CAUSE IS NO LONGER UNKNOWN.** TEST's migration ledger explains it. TEST records
`version` as the *application* timestamp with the migration's own timestamp in `name`
(e.g. version `20260826084633` / name `20260826140000`); PROD records the migration timestamp
as `version`, once each. TEST also carries **duplicate applications** — the three
`ledger_refresh_*` migrations and `sync_status_protect_marked_refresh` each appear TWICE, at two
different application times. That is a `db push` re-run over a partially-reset database, not the
`supabase-migrate` workflow. Different mechanism, different history, hence different bodies.

**Why it matters, concretely.** The migration's gate strips comments before matching,
because plpgsql stores `prosrc` verbatim. On PROD that strip is LOAD-BEARING: PROD's
7-param carries `INTO STRICT` inside a comment, and the 7-param parity arm is an ABSENCE
arm, so without the strip the arm would fire and **abort the production deploy**. On TEST
there is nothing to strip, so:

- regressing the comment-strip leaves CI **green on TEST** and **breaks the PROD deploy** —
  first observation would be a failed auto-apply, since merging `supabase/migrations/**`
  applies to PROD;
- removing the block-comment pass (added to close a demonstrated `/* */` evasion) changes
  **zero** TEST results. CI cannot detect the removal of the mechanism CI depends on.

- **[DRIFT-01] Re-align TEST's `_enqueue_compute_job_internal` with the repo definition**, or
  record deliberately that TEST is an older mirror. Until then, no CI run can exercise the
  comment-strip, and any change to it must be pre-flighted against PROD by reading
  `pg_get_functiondef` directly — a green TEST run is not evidence.

⚠️ The gate arms were all measured green on BOTH databases on 2026-08-26, so nothing is broken
today. See **SKIP-01** below: the drift is one symptom of TEST never receiving migrations at all.


### ⛔ SKIP-01 — nothing applies migrations to TEST, so the OPS-08 gate SKIPs FOREVER (added 2026-08-26)

✅ **REMEDY CONFIRMED BY MEASUREMENT 2026-08-26 (this instance only).** `20260826150000` was
hand-applied to TEST via MCP (10-param body MD5 `f349af15a256ad00bd31952723ae7b00`, 7674 bytes —
byte-identical to PROD), and PR #720's `sql-tests` lane then printed the *assertion* arm rather
than the skip:

```
test_enqueue_internal_destrict.sql:775: NOTICE:  OPS-08 Part 1+3 OK: the deployed 10-param
body carries no strict lost-race re-read, does raise serialization_failure on an exhausted
one, and its catalog COMMENT still carries the revert-discriminator marker.
```

⚠️ This closes the *instance*, not the class. The green check itself proved nothing — the
`SKIP (Part 3)` arm exits green too, which is what made this invisible. The evidence is the NOTICE
text, read out of the job log. **CI-MIGRATE-01 remains the class fix**; until it lands, every new
migration self-check is born silent on TEST.


Found by live measurement after PR #717 merged, while checking whether the recorded "OPS-08
code-complete, migration unapplied" state was still true. It is true — of the wrong database.

⚠️ **ATTRIBUTION, corrected 2026-08-26.** The core fact was NOT discovered here. It was already
written down in TWO places before this entry existed:
- the migration's own header (`20260826150000:184-186`): *"Nothing applies migrations to the TEST
  project automatically (supabase-migrate.yml targets PRODUCTION only)"*; and
- Phase 163's verification report, which records that the gate prints `SKIP (Part 3)` and that
  `ci.yml`'s whole-file anti-SKIP net keys on a marker STARTING `SKIP:` — which `SKIP (Part 3):`
  does not match — concluding *"the lane is GREEN and no CI signal will ever report the unapplied
  state."*

What THIS entry adds is the **permanence**, which neither source drew out: because nothing applies
migrations to TEST *at all*, the pre-apply state never resolves on its own. Both prior sources
describe a condition that reads as transitional. It is not. That is the finding, and it is
narrower than "SKIP-01 was discovered here".

**The recorded state MOVED rather than went stale.** Measured on both databases 2026-08-26:

| `_enqueue_compute_job_internal` (10-param) | PROD | TEST |
|---|---|---|
| `INTO STRICT` lost-race re-reads | **0** | **present** |
| `serialization_failure` raise | **yes** | **no** |
| OPS-08 marker comment | **yes** | **no** |

So "the deployed function still carries all four `INTO STRICT`" is now FALSE for production and
TRUE for TEST. Any note repeating the old sentence must name which database it means.

**Why no CI signal will ever say so.** Three measured facts compose:

1. **No workflow applies migrations to TEST.** All four migration-touching workflows checked:
   `supabase-migrate.yml` targets `vars.SUPABASE_PROJECT_REF` (the PROD ref);
   `migration-drift-check.yml` runs `db push --include-all --dry-run` — a dry run, also against
   PROD; `migration-policy.yml` documents that no `db push` or other write is ever invoked;
   `mutex-probe.yml` uses `TEST_SUPABASE_DB_URL` only to take a lock. TEST's ledger tops out one
   migration short.
2. `sql-tests` — the ONLY lane that executes real deployed SQL bodies — has five steps: install
   psql, preflight, acquire mutex, run, release. **There is no migration-apply step.**
3. TEST sits in the gate's *true pre-apply* state (pre-fix body AND no marker comment), which is
   the one state `test_enqueue_internal_destrict.sql` deliberately waves through: `exit 0`,
   `SKIP (Part 3)`.

⭐ **The pre-apply tolerance was designed for the window between authoring a migration and it
applying. For the only database CI runs against, that window NEVER CLOSES.** Parts 1+3 SKIP
permanently. The de-stricted body that is live on production has been executed by **no test,
ever, anywhere**.

✅ Credit where due — the gate is not naive. It RAISES on a revert (pre-fix body + marker
present), on a hybrid re-base (some arms moved), and on the marker going dark (post-fix body,
no marker). It goes silent in exactly one state, and TEST is in that state permanently.

- **[SKIP-01] Make the pre-apply SKIP expire, or give TEST the migrations.** Two shapes, and the
  choice is a real decision, not a detail:
  (a) apply `supabase/migrations/**` to TEST as a CI step before `sql-tests` — closes SKIP-01 and
      **DRIFT-01** together, because both are the same root cause; or
  (b) keep TEST as-is and make the pre-apply arm fail once the migration is older than some
      threshold, so a permanent SKIP becomes loud.
  ⚠️ (a) is the root fix but changes what `sql-tests` is allowed to do to a shared database that
  has no worker and is already contended — see the shared-test-db mutex notes. Do not treat it
  as a one-line CI edit.

⚠️ This generalises past OPS-08. ANY migration's self-check that tolerates a pre-apply state is
permanently silent on TEST by the same three facts. OPS-08 is where it was caught, not where it
is confined.


### ✅ CLOSED — Phase 163 / WR-07: operator jargon reached a user-visible column (closed 2026-08-26)

The OPS-08 migration's `serialization_failure` sentence landed verbatim in
`strategy_analytics.computation_error`, which strategy owners read. It could NOT be fixed in
SQL: `csv-finalize` prefixed `compute job enqueue failed:` unconditionally with no SQLSTATE
branch, so no wording chosen in SQL reached the user unprefixed.

**FIXED in TypeScript.** `csv-finalize` now branches on `enqueueErr.code === '40001'` and
writes the ELSE arm of `computation_error_copy` instead of the operator prefix. The copy is
pinned to the SQL function by a static parity test, so rewording that arm turns the route RED
in CI rather than drifting silently.

⚠️ This entry previously recorded the measurement "ZERO quoted `'40001'` in `src/**`" as
support for the fix. **That measurement was true when written and is FALSE now** — the fix is
what made it false. Corrected rather than deleted, because a backlog that keeps a stale
measurement as live evidence is the same defect class this phase closed elsewhere.

⭐ Two corrections to the review's proposed remedy stand, and are worth keeping:
- the suggested copy *"will retry automatically"* is FALSE at HEAD — nothing retries a 40001
  (see OPS-08-TS). It would have traded operator jargon for a false promise.
- *"route it through the HONEST-01 bridge"* is not available: the bridge derives copy from
  `compute_jobs.error_kind`, and a failed ENQUEUE leaves no job row. The helper
  `computation_error_copy(TEXT)` is directly callable; the bridge is not the route.

### Phase 163 / WR-01 — hygiene Rule 1 is INACTIVE in CI by design (added 2026-08-26)

Closing WR-01 removed the local username from the tree entirely (940 -> 0 across nine
encodings). The needle is now DERIVED AT RUNTIME rather than stored, which is what makes
that possible — but it has a consequence worth stating plainly rather than discovering
later.

**Rule 1 (bare-username detection) does not run in CI.** The scanner derives the needle
from the home-directory basename; on GitHub Actions that is `runner`, which the scanner
deliberately refuses (measured: `/home/runner` occurs 2800 times across 507 tracked files —
a naive derivation would have turned `frontend-lint` permanently red on a clean tree). When
Rule 1 cannot run, the gate says so and drops the username clause from its success line,
rather than claiming a check it did not perform.

**What still runs in CI:** Rules 2 and 3 are structural absolute-path checks that need no
needle, so every leaked `\/Users\/<anyone>\/` form (spelled escaped, per the scanner's own convention) is caught everywhere. The residual gap is
narrow: a BARE username occurrence with no path prefix, in a file added by someone who
never ran `npm run lint` locally.

**DECIDED 2026-08-26 — not closing it, and why.** The remedy is to wire
`HYGIENE_LOCAL_USERNAME` into the `frontend-lint` job from a repository secret. Declined:
the username is already present in published git history (rewriting history was explicitly
declined by the founder as costing more than it buys), so a secret would add config
coupling and a workflow-run-visible value in order to protect a string that is not
actually secret. The local gate plus the structural rules is the right cost/benefit here.

- **[WR-01-CI]** If a bare-username leak ever DOES reach main, that changes the calculus —
  wire `HYGIENE_LOCAL_USERNAME` into `frontend-lint` from a repository secret and delete
  this note. One env line plus one secret; no scanner change needed, the precedence chain
  already reads it first.


### Phase 163 / SEC-03 — H-0001 census RE-MEASURED, and the debt is bigger than recorded (added 2026-08-26)

Raised while closing SEC-03. The `it.skip("H-0001 (intended behavior)")` block in
`src/__tests__/audit-coverage.test.ts` carried a census of the mutation sites that
`findMutations`' line regex misses. The plan treated it as stale *line numbers*. It was
worse than that — re-measuring changed the **count**, not just the coordinates:

- The "kill-switch flip" upsert the comment named **no longer exists** — Phase 106 Stage B
  made flag-monitor alert-only. The record was describing a site that had been deleted.
- **Three sites it never listed do exist and are uncovered:** `keys/sync:496`,
  `finalize-wizard:2287`, `finalize-wizard:2360`.
- Net: the uncovered single-line-mutation set is **6, not 4**. The debt grew while the
  record said otherwise.

The comment in `audit-coverage.test.ts` now carries the re-measured list, the method that
produced it, and a warning not to trust the numbers past the next refactor.

✅ **DETECTOR HALF CLOSED 2026-08-29 — Phase 164.3 plan 03, commit `311ac9cd`.**
(Corrected 2026-08-29, verification gap G4: everything below this line previously read
"H-0001 stays deferred" and asked for a fix that had already landed, which would have sent
the next reader to redo finished work.)

What plan 03 actually did, re-measured at HEAD:

- `findMutations` no longer anchors the mutator to the start of a line, so the single-line
  idiom `const { error } = await supabase.from('trades').insert(batch);` is visible;
- the intended-behavior test is **un-skipped and live** — `grep -c '\.skip('
  src/__tests__/audit-coverage.test.ts` returns **0**;
- the census was re-run and the six sites are pinned as an EXACT SET in
  `H_0001_UNCOVERED_ALLOWLIST`, asserted in both directions: a new uncovered site is red,
  and an allowlisted site that gets covered is *also* red so the list cannot rot.

⚠️ **What remains open, and it is not a detector problem.** The **six allowlisted ROUTES**
are still unaudited — `add_wizard_composite_key` aside, SEC-03 put none of them under the
audit law. Bringing each under it is a per-site compliance judgment (which actor, which
event shape, which failure mode), not a regex change.

- **[H-0001] Bring the six `H_0001_UNCOVERED_ALLOWLIST` routes under the audit law**, one
  per-site decision at a time, shrinking the allowlist as each lands. The gate is no longer
  blind — a SEVENTH site now goes red on arrival — so this is a bounded backlog rather than
  an open hole.

**Lesson worth keeping:** a census recorded as prose in a comment decays silently and
asymmetrically — it under-reported by two AND pointed at one site that no longer existed.
Re-measure such records rather than re-numbering them; re-numbering would have preserved
both errors.


### ✅ FIXED (pending CI confirmation) — CI's gitleaks was too old to read our allowlist (raised + fixed 2026-08-23, Phase-160 ship)

**Was:** the `secret-scan` gate ran with **every allowlist entry in `.gitleaks.toml` silently
dropped**, so ~15 exempted fixture files were unshielded and PRs red-lighted on files the config
had exempted since the v1.12 CI-green commit. Not an exposure — the gate was *stricter* than
designed, not leakier.

**Root cause (isolated by measurement, 2×2 over the same commit range):**

| gitleaks | `[allowlist]` (singular) | `[[allowlists]]` (array) |
|---|---|---|
| **8.24.3** — the action's built-in default | no leaks | **leaks found: 2** ← what CI reported |
| **8.30.1** — Homebrew current | no leaks | no leaks |

`gitleaks-action` resolves its scanner as `process.env.GITLEAKS_VERSION || "8.24.3"`, and **8.24.3
silently ignores the top-level `[[allowlists]]` array-of-tables form** this config uses (converted to
array form by 158-REVIEW CR-03). No parse error, no warning — the allowlist is dropped and the scan
proceeds on default rules. That conversion is what broke it.

**Fix:** pin `GITLEAKS_VERSION: 8.30.1` in `ci.yml`, rather than downgrading the config to the
singular form. Pinning also makes the gate reproducible locally, since Homebrew ships 8.30.x.

**Guard:** `gitleaks-allowlist.test.ts` now fails if the pin is removed *or* set below 8.25.0 while
the config still uses array form. Verified by neuter both ways — RED with the intended message each
time, restored byte-identical.

⚠️ **Two traps worth remembering.** (1) `gitleaks` auto-discovers `.gitleaks.toml` from the working
directory, so omitting `-c` does NOT test the no-config case — it loads the config anyway and prints
a reassuring `no leaks found`. (2) gitleaks scans the **whole PR commit range**, so renaming an
offending value in a later commit does not clear it; the finding stays attributed to the commit that
added it.

**Residual:** the local binary is whatever Homebrew last installed. Expose `npm run secret-scan` that
runs the *pinned* version so local and CI cannot drift again.

### `secret-scan` is red on `workflow_dispatch` runs — full-history scan, no range (raised 2026-08-23, PR #705 review)

**Priority:** P3 — noisy check, not a merge blocker (dispatch runs are not PR checks).

`ci.yml` triggers on `push`, `pull_request` **and `workflow_dispatch`**, and `secret-scan` has no
`if:` guard. In the pinned action bundle, `Scan()` appends `--log-opts` only for `push` and
`pull_request`; `workflow_dispatch` falls through to a bare `gitleaks detect` — i.e. **full history**.
Measured with the now-correct config: **29 findings** across ~20 non-allowlisted paths
(`src/lib/seam-redaction.test.ts` ×3, `analytics-service/services/job_worker.py`,
`scripts/backfill_funding.py`, …).

Not a regression from the version pin — the same full scan under 8.24.3 + the array config produced
**103**, so the pin improved it 103 → 29. But the workflow has dispatch inputs the team actually uses
(`bake_svg_goldens`, `bake_demo_screenshots`), so a manual dispatch red-lights the check for reasons
unrelated to the dispatch. Close it by either scoping `secret-scan` with an `if:` that skips
`workflow_dispatch`, or triaging the 29 full-history findings and allowlisting the genuine fixtures.

⚠️ Note the scope limit this implies: "the allowlist now works" is true for the two **range-scan**
paths (push, pull_request). The dispatch path scans differently and has never been clean.

### `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` on `secret-scan` is now a no-op (raised 2026-08-23, PR #705 review)

**Priority:** P4 — dead config, zero behavioral risk.

The env was added when gitleaks-action's latest release was v2.3.9/node20. The step is now pinned to
v3.0.0, whose `action.yml` declares `using: "node24"`, so the forcing var does nothing. Comment
corrected in place; the var itself was left alone to avoid moving two variables in the PR that
changed the scanner pin. Remove it in a standalone change.

### `gitleaks-allowlist.test.ts`'s real-scanner arm is probably skipped in CI (raised 2026-08-23, PR #705 review)

**Priority:** P3 — a coverage claim that may not hold where it matters.

The H-0017 arm (`suppresses a JWT at an allowlisted path…`) is `skipIf`-gated on the `gitleaks` binary
being on `PATH`. It passes locally only because Homebrew installed 8.30.1; gitleaks is **not** in the
`ubuntu-latest` runner image, so the arm is almost certainly skipped in CI. Confirm against a CI log.

Combined with the new version-pin test being a YAML-text assertion, **nothing running in CI exercises
scanner-version-vs-config-form behavior** — the pin guard is a proxy for it, not a measurement of it.
The `npm run secret-scan` script booked above would close both: it puts the pinned binary on PATH, so
the H-0017 arm runs everywhere and local/CI can no longer drift.

### `gstack-version-bump` writes a 3-digit package.json version this repo's own test rejects (raised 2026-08-24)

**Priority:** P4 — caught every time by a committed guard, so it cannot ship silently.

`gstack-version-bump write` writes the npm-valid 3-digit translation (`0.71.2`) into `package.json`,
but `critical-regressions.test.ts` `[CRITICAL-02]` requires `package.json` to equal `VERSION`
**exactly** — and this repo's convention is the full 4-digit form (`0.71.2.0`). Every bump through
the CLI therefore reddens that test until the value is hand-corrected. Surfaced rather than blended
per Rule 7: the repo's committed, enforced invariant wins over the tool's general convention.

Two follow-ups: pin the repo's 4-digit choice somewhere the tool can read (a `.gstack/` setting if
one exists), and note that `package-lock.json`'s root version is **stale at `0.70.0.0`** — it has
been drifting for several releases with nothing enforcing it. `npm ci` tolerates the root-version
mismatch today, so this is hygiene rather than breakage; left untouched here to keep the diff
surgical.

### Two guard gaps on `keys/validate-and-encrypt` (raised 2026-08-23, Phase-160 closeout review)

Both surfaced by the pre-landing review of the `STALE_CLIENT` retirement. Neither is a
live defect; both are **missing tripwires**, so the class can re-open silently.

- **`wizardErrors.invariant.test.ts` is blind to this route.** Its `ROUTES` population covers
  only `create-with-key`, `composite/add-key` and `finalize-wizard`. Nothing forces
  `keys/validate-and-encrypt`'s emitted codes into the `WizardErrorCode` union — which is
  exactly how `STALE_CLIENT` shipped unregistered and resolving to `UNKNOWN` until this
  review caught it. Closing it means a fourth `ROUTES` row plus a hand-typed, measured site
  count, and it will likely pull in that route's other emitters — so it is its own change,
  not a same-pass edit. Related: `seam-wire-vocabulary.invariant.test.ts` carries a
  DECLARED BLINDNESS note for the same route's clients (they live outside the wizard-steps
  directory its population is derived from).
- **`const body = await req.json()` has no `try`/`catch`** (`route.ts`, top of `POST`).
  Malformed JSON — or a body of literal `null` — throws inside the `withAuth` wrapper, which
  has no catch either, so the caller gets a Next.js default 500 with no coded envelope. That
  contradicts the route's own stated invariant, "a machine code on EVERY error arm".
  Pre-existing, not introduced by Phase 160, and out of that phase's diff.

### ✅ DECIDED + SHIPPED — should the measure ladder have a px cap at all? (raised 2026-08-09, DECIDED 2026-08-09, closed 2026-08-10)
Founder report, with screenshots: *"zooming out should allow me to see more of the
content… it should never produce dead/empty areas."*

**⭐ FOUNDER CHOSE (B): the founder's rule wins for DATA surfaces only.** Dense tables
go fluid (`max-w-full`, **no px ceiling**) and reveal columns as the viewport grows;
prose and forms keep 1100px, where a bounded measure is a genuine readability control
rather than decoration. Rung 3 of DESIGN.md's ladder is therefore FLUID, not 1920px.
Per Rule 7 the conflict was surfaced and one side picked — it was **not** blended into
a compromise cap. (The alternatives weighed were (A) keep the ladder and accept the
dead space, and (C) drop caps everywhere including prose; both were rejected.)

**Landed in:** `ecb7140a` (the `/my-strategies` instance) → `0f4dd69f` (the general
rule: `DashboardChrome`'s `isWide` shell becomes `max-w-full` and gains
`my-strategies`; the page-level `max-w-[1920px]` caps on `/my-strategies`,
`/allocations` (+loading), `/compare` (+loading) and `/discovery/[slug]` are deleted so
the shell is the sole owner) → **153.2 review WR-02** (the two surviving
`max-w-[1440px]` caps on `/allocations`' Scenario tab — `ScenarioComposer` and its
`AllocationsTabs` skeleton — which had kept the founder's reported symptom alive on
that tab, plus DESIGN.md's rule restated with its real scope and its one carve-out
named).

**Recorded in:** DESIGN.md's measure-ladder section and its 2026-08-09 decision-log row.

⚠️ **Two statements in the previous version of this item were false at HEAD** and are
corrected above rather than left to be re-litigated: *"The general principle is NOT
fixed"* (it was decided the same day) and *"It now gets the 1920px dense-table measure
it earns"* (there is no 1920px measure any more — `/my-strategies` is fluid).

**Carve-out, so it is inherited rather than rediscovered:** the four `/admin` prose
pages (`users`, `users/[id]`, `partner-import`, `for-quants-leads`) keep `max-w-[1100px]`.
They live under the `isWide` `/admin` prefix for navigation reasons, but the ladder
governs by CONTENT TYPE, and their content is prose/forms — rung 1.

### Money-path correctness (latent / flag-gated / edge cases)
- ~~**Unified-backbone CSV-finalize breaks if flag on**~~ — **CLOSED 2026-08-17 (Phase 145
  SC#1, verdict CANNOT REPRODUCE)**. Of this bullet's own two remedies, **"forward JWT"
  shipped in Phase 19.1** (2026-05-27; verified at HEAD: `route.ts:1324` forwards
  `X-User-Access-Token`, `process_key.py:1135` reads it and builds the user-scoped client);
  "skip unified for finalize" was not taken, and the flag concept itself was later deleted
  (zero runtime readers at HEAD). Live confirmation + census:
  `.planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md` (four arms, all
  GREEN; PROD's 18 csv orphans are all incident-era fossils predating the fix). The 42501
  GUARD stays live and is now pinned by a permanent CI gate
  (`supabase/tests/test_csv_finalize_auth_guard.sql`).
- **Backbone-bypass parity surfaces** — `_compute_portfolio_analytics` (routers/portfolio.py:632)
  and `equity_reconstruction.py` run independent Sharpe/TWR stacks; frontend TS
  (`portfolio-stats.ts` / `scenario-blend-panels.ts` / `health-score.ts`) and matching
  (`match.py`) compute bespoke annualization/Sharpe. Parity-gated but real divergence risk —
  absorb into the unified backbone.
- **Deribit `correction` residual** — a capital-reason row carrying a trading token and no
  capital word still classifies as trading P&L. Tighten the word-boundary classifier.
- **Worker orphaned-`running` purge: DELETE vs reset** (founder decision at FLIP) — same
  migration; TEST wants DELETE, PROD wants reset (a sustained >4h outage would lose live
  jobs). Window already widened 2h→4h.

### Reliability / observability
- **No cron migration in the repo has EVER asserted `cron.job.username`/`database`** (found
  2026-08-19 by the RLS audit of Phase 146.2's R3 migration; INHERITED gap, not introduced —
  logged as a CLASS fix, deliberately not point-fixed into `20260819150000`).
  `cron.job.username` defaults to `current_user` **at `cron.schedule` time**, so re-registration
  is precisely the operation that re-derives a job's privilege. Every cron self-verify in this
  repo reads `command` + `schedule` and never `username`/`database`/`active`. Two undetectable
  drift paths, both requiring a non-`postgres` applier:
  (a) a different superuser (e.g. `supabase_admin`) → the body silently runs with superuser
  rights thereafter, and the `count(*) = 1` gate still passes;
  (b) a non-BYPASSRLS applier → pg_cron's stock `cron.job` RLS (`USING (username = current_user)`)
  HIDES the postgres-owned row → `IF EXISTS` is false → no unschedule → the unique index on
  `(jobname, username)` permits a **SECOND** row → the sweep fires twice hourly (per-tick radius
  25 → 50). ⚠️ **The `v_count <> 1` guard is RLS-BLIND to this and would read 1 and pass green.**
  **Measured 2026-08-19:** owner is `postgres` on both PROD and TEST, so neither path is currently
  reachable via the normal merge pipeline — this is hardening, not a live break.
  **Fix:** add `username = 'postgres'` + `database = current_database()` equality assertions to
  the STEP-2 self-verify of every cron-registering migration going forward, with a
  consequence-naming message. Evidence of the ratified owner: `20260816140000:375`.
- **The readmit ceiling is SILENT at exactly the moment it gives up** (found 2026-08-19 by the
  RLS audit of Phase 146.2 R3; the fix's own new blind spot). At the ceiling the sweep inserts
  nothing → no `compute_jobs` row → no `{"source":"reconcile-sweep"}` metadata → the worker-side
  capture at `analytics-service/main_worker.py:754` never fires. **The alert is keyed on the
  HEAL**, so the transition from "recovering hourly" to "abandoned for ~90 days" emits NO signal,
  and the strategy's owner has no user surface for it. Not a leak and not a data-integrity
  defect — filed against Rule 12 (fail loud). **Founder decision needed:** body-side audit row on
  exhaustion vs. an external exhaustion query/alert. ⚠️ Interacts with the 90-day retention wall,
  which DELETES the marker rows that ARE the counter — so the bound is "3 per retention window",
  and a strategy can silently resume cycling after ~90d with no notification at either edge.
- **Phase-19 hourly cron never decommissioned** (PR-D) — soak gate passed, cron still running.
- **Match-engine cron health check missing** — no `/api/cron/health-check` route; match-engine
  cron failures are invisible (silent data staleness).
- ~~**Rate limiting only on 6 routes**~~ — **CLOSED 2026-08-18** (Phase 146 / RATE-01):
  stale since at latest audit-2026-05-07. Every route this bullet named
  (`verify-strategy`, `keys/{sync,validate,encrypt}`, `admin/match/recompute`,
  `admin/partner-import`, `trades/upload`, `intro`) is verified LIMITED at HEAD
  `70a8918d`; `admin/match/eval` (the one real remaining gap) gained its limiter
  in the same phase. The authoritative census — route × limiter × value × key
  shape, fresh-derived twice — is `.planning/phases/146-rate/146-AUDIT.md` §1,
  which replaces this list.
- **Cron/email idempotency & budget** — founder-LP cron double-email if lambda dies post-Resend
  (idempotency row on `(cron_name, year_month)`); founder-LP 85s worst-case > 60s maxDuration;
  Resend webhook svix-id idempotency store; email correlation-id fragmentation (per-email not
  per-batch); email retry false-alarm on UNIQUE(23505).
- [ ] Circuit-breaker state/ops dashboard (observability depth; from archived v1.16 v2-requirements).
- [ ] Job-queue depth + age metrics (observability depth; from archived v1.16 v2-requirements).
- [ ] Adaptive/load-aware rate limiting driven by the breaker signal (from archived v1.16 v2-requirements).

### Security
- **npm advisories (2026-07-25).** Shipped highs FIXED at root: `next` 16.2.10→16.2.11
  (clears the 9 App-Router SSRF/proxy-bypass/cache-confusion advisories — stable patch exists)
  + `overrides` `sharp ^0.35.3` (prod libvips), `fast-uri ^3.1.4`, `postcss ^8.5.23`, `tmp
  ^0.2.7`. Nightly gate scoped to the PRODUCTION tree (`npm audit --omit=dev --audit-level=high`)
  so it keeps full HIGH teeth on shipped code but isn't red on the one residual, build-only
  high: `brace-expansion` OOM (GHSA-mh99) is fixed only in 5.0.8, which drops the CJS function
  export and breaks `minimatch@3`/eslint — unfixable without replacing the lint toolchain.
  Left to Dependabot. Follow-up: re-check the `sharp` override once `next` bumps its declared
  `sharp` range past 0.34.5.
- **`GRANT ALL` residue on `public.api_keys` — one item, four verbs** (measured on PROD `khslejtfbuezsmvmtsdn`, 2026-08-23 via `information_schema.role_table_grants` during the Phase-160 B-M1 census; consolidated after the Phase-160 RLS audit). The original `GRANT ALL ON TABLE api_keys TO anon, authenticated` handed out SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. The project has withdrawn them **one verb per migration**: SELECT (re-granted per-column, `20260410225608`), UPDATE (`20260810120000`), INSERT (Phase 160, `20260823120000`). The untouched residue is **TRUNCATE, REFERENCES, TRIGGER on both roles, plus DELETE on `anon`**.
  - **Reachability today: none.** For `anon`, `auth.uid()` is NULL so `api_keys_owner USING (user_id = auth.uid())` matches zero rows — an anon DELETE affects nothing. It is one accidental permissive policy away from being live, i.e. defense-in-depth, not a live hole.
  - ⚠️ **Correction to the original TRUNCATE framing** (from the Phase-160 RLS audit): a bare `TRUNCATE public.api_keys` **fails** — Postgres refuses to truncate a table referenced by foreign keys, and `api_keys` is referenced by `strategies`, `strategy_keys`, `key_permission_audit`, `allocator_holdings` and `csv_daily_returns`. The attacker needs `TRUNCATE … CASCADE`, which requires TRUNCATE on every cascaded table too. So the real blast radius is a function of the grants on *those* tables — measure that before sizing this.
  - Next step: `REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.api_keys FROM anon` (and TRUNCATE/REFERENCES/TRIGGER from `authenticated`) is functionally free. Note the Phase-160 post-verify asserts DELETE survives **for `authenticated` only**, so an anon-scoped revoke will not trip it. Audit which other public tables carry the same default residue first — a one-table fix is a point-fix of a class.
- **⚖️ ARCHITECTURE DECISION OWED: `api_keys` writes have left the RLS-enforced plane entirely** (raised by the Phase-160 RLS audit, 2026-08-23; MEDIUM, no leak today). With UPDATE revoked (`20260810120000`) and now INSERT revoked (Phase 160), **no RLS-subject role can write `api_keys` at all** — so `api_keys_owner`'s `WITH CHECK (user_id = auth.uid())` (`20260405061912_rls_policies.sql:22`) is dead on every path, and the sole writer is a `createAdminClient()` route running BYPASSRLS. That contradicts ADR-0001's "RLS is THE authorization layer". The *current* writer is correctly gated (uid comes only from `withAuth`'s `user.id`; the `...encrypted` spread is closed by a strip-mode Zod schema plus the `quantalyze/no-passthrough-on-ipc` lint rule, with a hostile-`user_id` oracle in `route.test.ts`). The residual is structural: any FUTURE admin-client route inserting `api_keys` with a request-supplied uid would write into another tenant's key list with **nothing in the database** to stop it.
  - ⛔ `FORCE RLS` is NOT the remedy: a service_role insert has no `sub` claim, so `user_id = auth.uid()` is NULL and every connect would fail.
  - The available DB-level backstop is a `BEFORE INSERT` trigger (BYPASSRLS skips RLS, not triggers). The repo already has this exact pattern twice for this exact class: `enforce_strategy_keys_owner_coherence` (`20260710120000:66`) and `check_strategy_api_key_ownership` (`20260410225609`). Decide whether `api_keys.user_id` warrants the same now that the last non-bypassed writer is gone.
- **CSP uses `unsafe-inline`/`unsafe-eval`** — move to nonce-based CSP.
- **VCR cassette over-redaction** — misses token/hmac/digest/nonce (and over-matches
  signal/signedAt/pubkey); replace with per-broker allowlist.

### Phase 164.3.1 review-fix — bounded residuals, deliberately NOT fixed (added 2026-09-02)
- [ ] **`scripts/prod-body-drift-check.sh` — the seven `node "$READER" … || fail` reader sites do not capture the child's exit CODE** (VERIFICATION W1 / READER-STDERR class in `DIAGNOSTIC_FIRST_ALLOWLIST`, gate-family-meta.test.ts). The four READER-STDERR allowlist entries (`node $NORMALIZER --function-names`, `node $NAIVE_NAMES` unqualified, `node $NORMALIZER --function-qualified-names`, `node $NAIVE_NAMES --qualified`) plus the three body/qualifier reads are accepted because the child's own stderr reaches the log un-redirected — but the wrapper's `fail` text carries no exit status, so a reader killed by a signal or an OOM (exit 137) reads identically to a charset refusal (exit 1). Fix: the `set +e; …; _live_rc=$?; set -e` idiom the same script already uses for its verdict-path greps — capture the reader's `rc=$?` and interpolate it into the `fail` message; then drop those four allowlist entries and let the diagnostic-first meta-arm assert it. Booked 2026-09-02 during 164.3.1 UAT item 3 (the allowlist reasons were read and hold; this follow-up was cited there as "recorded, not fixed" and had no tracker row).
- [ ] **`scripts/prod-body-drift-check.sh` — three remaining bare-`grep` sites, all OFF the verdict path.**
      The review-fix pass (`164.3.1-REVIEW-FIX.md`, WR-04, commit `d958e54e`) closed every grep/find
      exit-status site that DECIDES a verdict: the zero-path hit-list test (`textual-hits.txt`), the
      snapshot walk (`find … | grep -c`, now two measurements), and the fetched-body test (`*.live.sql`).
      Three `grep -aqE '[^[:space:]]'` calls keep the bare `if grep`/`grep && … || …` idiom because an
      exit >= 2 at each cannot produce a PASS:
      1. the naive-only names `::warning::` block (`names.naive-only.txt`) — a grep error silences a
         WARNING; the names are already unioned into the index every per-name decision reads;
      2. the two evidence printers inside the [VAC04-C1] BLIND-ZERO `::error::` block
         (`grep … names.lexer.txt && sed … || echo "(none)"`, same for `names.naive.txt`) — the block
         exits 1 regardless; an error there prints `(none)` in place of the list;
      3. `PROD_NAME_COUNT="$(grep -ac … prod-names.txt || true)"` — the file was asserted non-empty by
         the two `|| fail` guards immediately above it, and an empty count fails the absurdity floor
         CLOSED (`0 * 2 < snapshot population`), never open.
      Worth the `set +e; grep; _rc=$?; set -e` idiom for uniformity the next time the file is touched;
      not a fail-open today, so not blocking (stopping rule: blocks only on user-facing / data-integrity).
- [ ] **RED-TEAM — a gate-file `edit`/`insert-after` step can mutate the guard's INPUT, not its condition** (found in the 2026-09-02 /ship review of Phase 164.3.1). A mutation step that sets e.g. `v_raised := false;` inside the arm's own EXCEPTION handler leaves the RAISE on its genuine line, so attribution passes and `biting` rises — while the policy under test was never broken. Rules 3a/3b/3c bound the literal, the branch text and the runtime location, but not the guard's inputs. Proposed: a static rule refusing gate-file edits whose span lies inside the same DO block as the arm's raise AND assigns to an identifier appearing in that arm's failure-branch head; report it as `identity-rewrite`; GRAMMAR rule 3 to state that the guard's INPUTS are part of the condition. Design-level; deliberately not fixed in this ship.
- [ ] **TESTING — drift-check-scripts.test.ts VAC08-JOIN 'DRIVEN' arms echo the test's own computation** (2026-09-02 /ship review). The arms compute the expected missing set in a JS reimplementation (`isMissing`) and feed it to the stub `LEDGER_QUERY_CMD`, so the verdict agrees with the test by construction; the four real SQL join clauses in `default_ledger_query` never execute. Proposed: drive the real SQL on the throwaway pg-lane cluster (`scripts/pg-lane/run.sh`) against a scratch `supabase_migrations.schema_migrations`; keep the JS arm as a text pin only.
- [ ] **ADVERSARIAL F4/F6 (investigate) — run.mjs `judgeBlock` treats any non-ERROR sighting of an identity as forgery, and `attributeIdentities` only MEASURE_FAILs at zero parsed blocks** (2026-09-02 /ship review). A RAISE NOTICE, a `SQL statement "…"` CONTEXT echo or raw stdout that mentions an identity is classified SYNTHESISED and checked FIRST, so a legitimate NOTICE reds the gate with a "forgery" message; and a partially-parseable output (localized `FEHLER:` headers) is diagnosed as forgery rather than as an output-grammar failure. The GRAMMAR / 164.4 authoring rule should say "never echo an identity except from its own RAISE EXCEPTION"; the runner should distinguish grammar failure from forgery when SOME blocks parse.
- [ ] **COVERAGE — cluster-only paths never fired by an automated test** (2026-09-02 /ship coverage audit: 30 of 44 paths = 68%). `restore` and `dirty-checkout` defects (incl. the `gitStatus()==null` MEASURE_FAIL) are exercised by nothing; `judgeBlock`'s sqlstate ≠ P0001 ERROR carrying the literal has no red fixture; `neuterArm`'s "no RAISE precedes" and unterminated-RAISE refusal reasons are unasserted; `invokedDirectly()`'s catch fallback and the naive reader's `--qualified` mode are untested; the `--file`/`--arm` argv error exits are untested.
- [ ] **MAINTAINABILITY (deferred) — three copies of the same substring counter** (2026-09-02 /ship review): `occurrences()` in `src/__tests__/drift-check-scripts.test.ts`, `countOf` in `src/__tests__/gate-family-meta.test.ts` and `countOccurrences` in `scripts/mutation-runner/run.mjs`. Collapse to one helper under `src/__tests__/helpers/` (run.mjs is ESM outside vitest — either import the same module or leave its copy with a pointer).

### CI / test-infra ratchet
- **CI speed/flake (founder 2026-08-05, watched python at 20min/12%) — 4TH MECHANISM FOUND: a WEDGED PostgREST pool.** All-day 504s on TEST (every CI cluster: 07:45, ~11:00, 18:0x, 19:2x) were PGRST003 while Postgres sat at 14/60 connections nearly idle and the same DELETE ran instantly via direct SQL — PostgREST's own pool slots were leaked/wedged after the morning's 2,144-job backlog connection storm, and the state persists until PostgREST's connections are recycled. REMEDY (proven 2026-08-05): `select pg_terminate_backend(pid) from pg_stat_activity where application_name='postgrest' and backend_type='client backend'` → PostgREST rebuilds the pool → instant 200s. Contributing causes booked: python + e2e-seeded run CONCURRENTLY (workflow `needs:` sequencing fix); daily backlog (purged 2,144 `derive-dailies-%` pending, cron untouched). Real fix (Phase 144, owner): per-run isolated DB. Also: e2e-seeded's seed should FAIL FAST with a "PostgREST wedged?" hint on PGRST003 rather than burning the run.
- 44 live-DB vitest files + ~112 python tests are green-skipped in CI while migrations
  auto-apply to prod.
- Shared test-DB sql/e2e race (fence flake); Railway analytics deploys skip silently on red
  main CI (verify `commitHash` + `/health`); `repro-key-flow.sh` Layer-A leak gate is a CI
  no-op; `cassette-refresh.yml` failed 17/17 with no alerting.
- **`analytics-service/tests/` is entirely untyped — 5,439 `mypy --strict` errors across 182 of
  213 test files** (MEASURED 2026-08-02 from Phase 142; `test_main_worker.py` alone = 59, which
  is typical at ~30/file, NOT an outlier). ⚠️ **This is CONFORMANCE, not drift**: `ci.yml:1130`
  states *"tests/ stays untyped by design"* and the gate is deliberately
  `mypy --strict --follow-imports=silent services/ routers/ models/`. So the open question is a
  **policy** one — should the staged B-mypy program (ingestion → `services/` part g →
  `routers/` part h → `models/` part i) get a part j for `tests/`? — not a bug to fix.
  **No owning phase, and deliberately not given one:** it belongs to none of 143/144/145 (JOB —
  job-state integrity) or 146 (RATE), and it does NOT justify a Phase 147 inside v1.16 — a
  5,439-error program is milestone-scale and orthogonal to "Production Resilience & Reliability"
  money-path plumbing. Route to a future milestone as B-mypy part j, or close as WON'T-FIX if
  the untyped-tests posture is reaffirmed. Surfaced because a Phase 142 executor ran
  `mypy --strict` on a path the gate excludes; **zero errors fell in Phase 142's added ranges.**
- **All 16 Phase 142 review/verification items are OWNED BY PHASE 142.1** — not tracked here.
  Full text with per-item failure scenarios: `.planning/STATE.md` § "Phase 142.1 scope".
  Raised by three independent passes (high-effort workflow review, blind `gsd-code-reviewer`,
  `gsd-verifier`). Seven are test-quality/doc items that would normally live here under the
  stopping rule; they were pulled into 142.1 on 2026-08-02 because the phase existed anyway.
  ⚠️ **If 142.1 is descoped or cut, re-file those seven here** — they have no other owner.
  ✅ **RESOLVED in v0.52.0.0 (2026-08-03)** — the one item that was a hard-red CI gate
  (`scripts/dump-sql-functions.ts --check` exiting 1 at `sql-function-snapshot.yml:84`, because
  `supabase/schema/functions/` had not been regenerated after migration `20260802120000`) was
  fixed twice on this branch: commit `fea74933` for `20260802120000` and `400070c3` after the
  `20260803120000` trigger migration. `npm run schema:functions:check` now reports the snapshot
  current (105 functions). Phase 142.1 shipped, so the "re-file those seven here" contingency
  below did not fire.
  The narrow real risk worth separating out, if anyone revisits this: an untyped fixture/double
  can drift from the real contract it stands in for — but the fix for that is targeted
  contract-pinning (already the repo's practice), not blanket typing.

### UX / product polish (founder-requested)
- **Header "+ Allocation" lacks a path-to-existing-strategy affordance** (deferred 2026-08-06 at
  Phase-150 plan-check rev-2): the Allocations header button offers no route to allocate an
  already-onboarded strategy; Phase 150's arm-2 "Go to My Strategies →" empty-state link is the
  interim mitigation. A full affordance needs its own UI-SPEC surface before build. See
  150-CONTEXT.md Deferred Ideas.

- **MT5 "Broker server" should not be a masked field, and should be searchable.**
  `ConnectKeyStep.tsx:696` renders the passphrase-slot input as
  `type={showSecret ? "text" : "password"}`, which is right for an OKX passphrase but wrong for
  MT5 — a broker server name is not a secret, and masking it makes the "copy it exactly as it
  appears in your terminal" instruction hard to satisfy (you cannot proofread what you typed).
  Two parts: (a) render this slot as plain text when the venue's passphrase slot is
  non-secret — needs a per-exchange flag next to the existing `passphraseLabel` /
  `passphrasePlaceholder` / `passphraseHelper` overrides, not a blanket change, since OKX must
  stay masked; (b) turn it into a typeahead — user types a fragment, we scan available MT5
  servers matching it and present a dropdown. **Open question for (b):** where the server list
  comes from — the MT5 gateway can enumerate what its terminal knows, but that is one terminal's
  view, not a global registry. Decide between gateway-enumerated, a curated broker→servers map,
  or free-text-with-suggestions before planning.

  **UPDATE 2026-08-08 (founder, with screenshots of the MT5 mobile flow):**
  - **(a) is CLOSED** — delivered by **MT5-03**: the per-venue `passphraseSecret` flag renders
    MT5's slot as `type="text"` (`ConnectKeyStep.tsx:739`) while OKX stays masked. The line
    number in the paragraph above is stale (`:696` → `:739`).
  - **(b) is now specified, as TWO levels**, matching how the MT5 app actually behaves:
    **level 1 = broker family** (e.g. `VantageMarkets`), showing brokers this user/allocator has
    connected before; **level 2 = every server in that family** (`VantageMarkets-Live 5`,
    `-Live 19`, `-Live 14`, `-Live 3`, `-Live 6`, `-Live 4`, `VantageMarkets-Live`). Typing an
    exact server name is cumbersome and error-prone; a picker removes a whole error class.
  - ⛔ **The real blocker for level 1 is a STORAGE shortcut, not a missing API.** The broker
    server flows into the OKX passphrase slot and is persisted in `api_keys.passphrase_encrypted`
    (`exchange.py:234` states the rationale: *"No new columns"*). A broker server name is public
    information, so encrypting it buys nothing and costs the ability to render a history without
    decrypting secrets. **Fix = a plain `mt5_server` column**; that makes level 1 trivial.
  - **Level 2 direction — REVISED 2026-08-08 after the platform research came back. The founder's
    "just download and store it" is RIGHT in substance but must change its SOURCE.**
    - ⛔ **Auto-syncing MetaQuotes' directory is OUT.** The broker/server list is only obtainable
      inside a terminal; `config/servers.dat` is **binary and undocumented**, and MQL5 warns that
      third-party parsing may violate MetaQuotes' ToS. There is no endpoint and no API. So the
      "our own terminal already has it" idea — mine, 2026-08-08 — does **not** survive: the file
      is there, but reading it is not a route we should take.
    - ✅ **Curating from broker-published pages is IN, and is ToS-clean.** Server names are
      **public** — brokers document them (Vantage publishes its `VantageMarkets-Live N` set).
      Seed a small `broker → servers[]` table by hand for the brokers we actually support,
      refresh rarely, free-text escape hatch for anything unseeded. Hand-curated, not synced.
    - Net: the two-level picker is still achievable and still worth it; it is a **content**
      problem (curate a short list) rather than an **integration** problem.
  - **Not in Phase 153.** 153 deletes an error class and is already 25 files; a server picker is
    a new surface. Needs its own requirement + UI-SPEC.

- **⭐ Expose an MCP server so a client can read their own stored data and analyse it with their own
  AI** (founder-requested 2026-08-03, during `/gsd-plan-phase 142.2`). Once we have ingested and
  derived a client's data, they should be able to point their own AI assistant at it — Claude
  Desktop, Claude Code, ChatGPT, whatever they use — and ask their own questions, rather than being
  limited to the analyses we chose to render. This is a **product** idea, not a refactor: it turns
  Quantalyze from "the dashboard we built" into "your data, queryable", and it is a natural fit for
  the backbone because **dailies are canonical** — one clean series to expose rather than N bespoke
  panels.
  **Not planned, not scoped, not scheduled** — captured so it is not lost. Before it can be planned,
  four things need a decision, and the first two are the ones that make it non-trivial:
  - **Auth.** MCP has no ambient session. This needs a per-user credential (scoped token / OAuth)
    with a revocation story, and it must be **read-only** and **owner-scoped** — the RLS discipline
    that governs every other read path applies here, and a SECURITY DEFINER shortcut would be a
    tenant-leak risk. See the `get_published_trust_signals` SECDEF precedent for how narrow such a
    surface has to be.
  - **What is exposed.** Dailies + derived metrics is the honest answer (canonical, already the
    single source). Raw `trades` is tempting and mostly wrong — it is a partly-redundant
    representation only some venues populate (see Phase 142.2 / D-16). Exposing it would re-teach
    clients the same wrong model the strategy gate just had to unlearn.
  - **Hosting shape.** Remote MCP endpoint on our infra vs. a small local server the client runs
    against an API token. Remote is far easier to support and revoke; local is easier to trust.
  - **Whether it is a paid tier.** Likely yes, but that is a CEO call, not an engineering one.
  ⚠️ Note the adjacent risk: an MCP surface is a **new public read boundary**. Every hardening
  lesson already paid for on the public factsheet path applies to it from day one, not later.

### Tech-debt / maintainability (opportunistic, don't force)

- **The two wizard connect surfaces keep TWO hand-maintained `EXCHANGES` rosters (added 2026-08-11,
  153.4 review CR-03).** `ConnectKeyStep.tsx` and `MultiKeyConnectStep.tsx` each hold a private
  option table, justified by a "State-A neutrality over DRY" docblock. The composite copy fell an
  entire venue behind — no MT5 card, `MT5_UI_ENABLED` not even imported — so a draft-carried MT5
  member panel POSTed `passphrase: null`, dropping the broker server, and rendered no field to
  re-enter it. **Fixed pointwise** (the card + the four third-field overrides are now in the
  composite roster) **and fenced** (`MultiKeyConnectStep.test.tsx` "[CR-03] … THE CLASS GUARD"
  compares both surfaces' rendered exchange cards with both flags ON). ⭐ The CLASS fix is one
  shared option table both steps import — a THIRD module, which the neutrality argument does not
  forbid (it forbids `ConnectKeyStep` growing an export). Do it the next time a venue is added.

- **⭐ AUDIT METHOD + two more unfalsifiable guards (2026-08-09).** Phase 153 found **14** guards
  that could not fail. The method that finds them, in order of cost:
  1. **Grep triage** on six smells: literal-vs-literal · fixture sized off the constant under test ·
     matcher-driven sweep with no positive control · derived roster with no vacuity floor ·
     assertion on absence with no proof the detector works · self-referential oracle.
  2. **Check provenance** — do both sides of the assertion trace to the SAME definition? If yes it
     is a tautology wearing a check's clothes.
  3. **Mutation decides.** Grep only nominates. Break what the guard claims to protect; no red = decorative.
  4. ⭐ **Read the comment as a suspect, not a witness.** 3 of the 14 carried comments asserting
     precisely the capability they lacked. A confident comment over a weak assertion is a signal.
  ⭐ **Highest yield: guards over a CROSS-FILE coupling** (budget↔breaker, roster↔emitter,
  definition↔restatement). Same-file assertions are usually honest; cross-file ones go stale.
  **Scope recommendation:** sweep the money-path and security guards only (`seam-*`, `closed-sets`,
  RLS, `analytics-service/services/`). A mutation pass over 10 000 tests costs more than it returns.

  - **#13 `src/__tests__/scenario-commit-rls.test.ts:971` — a tautology.** `HAS_FULL_LIVE` is
    DEFINED at `:169` as `HAS_LIVE_DB && HAS_BASE_URL && HAS_ANON_KEY`, and `:971` asserts it
    equals that same expression re-evaluated in the same file. Its comment claims it catches
    "e.g. inverts `HAS_BASE_URL`" — inverting it changes BOTH sides identically, so it stays green.
    All three flags come from env vars, so CI (all false) gives `false === false` and a configured
    env (all true) gives `true === true`. It can only red in a mixed state neither environment
    produces. **Fix:** assert the gating BEHAVIOUR (that the suite skips) or delete it.
  - **#14 `grep -c "if (code === "` is a BLIND gate — and the orchestrator authored it.** Used
    across several 153.1 executor prompts as evidence that a fix was class-level rather than
    instance-level ("arm count unchanged at 3"). It is a single-line pattern; `wizardErrors.ts`
    has **six** multi-line arms (`if (` alone on `:2330 :2357 :2373 :2383 :2743 :2789`) that it
    structurally cannot see. Same blindness class as D-34's fourteen `error`-first emitters.
    **The sound invariant is `grep -c "applyFixRequirements("` → 2** (declaration + the one call).
    ⚠️ Lesson: a prose/regex gate in a PROMPT is exactly as falsifiable as one in a test, and
    nobody mutation-tests a prompt. Prefer an invariant a test can hold.
  - **#15 An innocence proof that could not fail — in 153.1's OWN paperwork.** ✅ corrected
    2026-08-09 by the 153.1 verifier. `ROADMAP.md:353` absolved 153.1 of the red
    `seam-citations` gate on the strength of an empty `git diff aff52516..HEAD`. But
    `aff52516` is a 153.1-05 **docs** commit dated AFTER every source edit in 153.1-03/04/05,
    so that diff was empty **by construction**, whoever caused the citations. The truth is the
    opposite: `git log -S'<citation>'` attributes **all nine** to `712c01a9`/`aeea5455`/
    `3011c659` — 153.1's own commits, two of them added by the CR-01 review fix and recorded
    nowhere. `deferred-items.md` said "PRE-EXISTING", then named 153.1-04 as introducer one
    paragraph later, and counted 7 against a live 9.
    ⚠️ Lesson — **this is the first instance found in a PLANNING LEDGER rather than a test**,
    and it is the highest-leverage location of all: a false exoneration is read by the next
    phase's planner and never re-derived. Same taxonomy row as "guards over a CROSS-FILE
    coupling" — the coupling here is commit-order vs file-content. **Rule: a
    baseline commit used to prove "we didn't cause this" must PREDATE the work, and you must
    show that it does.** Prefer `git log -S` (names the author) over `git diff <base>` (names
    nobody).

- **✅ FIXED 2026-08-09 — the STATE.md "SDK bugs" were OUR schema drift, not the SDK.**
  Founder challenge (*"Probably something we do rather than SDK. Didn't have those problems
  before"*) was correct. Root cause: two customised headings that sit inside SDK match patterns.
  | gsd-sdk matches | we had written | consequence |
  |---|---|---|
  | `/##\s*Session\s*\n/i` | `## Session Continuity` | section never found |
  | `/###?\s*(?:Decisions\|…)\s*\n/i` | `### Decisions (requirements-time, …)` | every decision dropped |
  Both verbs **fail silently** — they return `"No session fields found"` / `"Decisions section not
  found"` as data, and nothing checks the string. That is why it went unnoticed for months.
  ⭐ **The `stopped_at` "regression" was a two-sources-of-truth bug.** `stopped_at` lives in YAML
  frontmatter **and** as `**Stopped At:**` in the body, and the SDK rebuilds frontmatter FROM the
  body. With the section unmatched the two floated free; we only ever updated frontmatter, so the
  body copy had been stale since `9e990a90`. Three executors "restoring an accurate value" each
  reconciled against that stale copy in good faith — one fact, two homes, one unmaintained.
  **Fix:** headings renamed to `## Session` / `### Decisions` with load-bearing comments naming
  the exact regex that depends on each. Verified end-to-end: `record-session` → `recorded: true`
  (was `false`), `add-decision` → `added: true` (was an error string), frontmatter ↔ body in sync.
  ⚠️ **Lesson worth keeping:** the first fix attempt put the explanatory comment INSIDE the
  Session block, and because the comment contained the literal `**Last Date:**` markers the SDK's
  regex matched **the comment instead of the data**. Same class as `EMITTER_RE` matching
  commented-out code. Keep prose out of a machine-parsed block. The verb bumps
  `completed_plans` but rewrites `stopped_at` to an older/pre-wave value, silently discarding the
  most recent progress note. Both executors caught it in their own diff and restored an accurate
  string rather than committing the regression — but an executor that did *not* diff-check would
  have committed a ledger that lies about where the run stopped, which is exactly what a resume
  reads. ⚠️ `STATE.md` is the file `/gsd-autonomous` and every resume path trusts.
  **Interim:** always `git diff .planning/STATE.md` before committing after that verb runs.
  **Fix:** make the verb merge rather than overwrite, or stop it touching `stopped_at` at all —
  progress counters and the human-readable stop note are different concerns.
- **149 review IN-01:** `MyStrategiesSection.tsx` comment claims namespaced prefs persistence, but with no `userId` the prefs hook is a persistence no-op on that surface — fix the comment (or pass userId if prefs are wanted there).
- **149 review IN-02:** `getOwnRowPercentiles` fully computes `publishedMap` only for its key-count; name the future consumer or reduce to a count.
- God-files: `queries.ts` (3,205 lines), `job_worker.run_sync_trades_job` (688 lines),
  `portfolio.py` (2,423), `exchange.py` (2,777).
- Formatter copy-paste drift (20+ local `fmtUsd`/`fmtPct` with diverging null handling) →
  shared util.
- Dual strategy create/edit (retire legacy `StrategyForm` once wizard proven).
- PDF route boilerplate ×4 → shared `pdf-route.ts` (+ `Buffer as BodyInit` casts).
- `withAuth` route-context forwarding; migrate `extractAnalytics` off the `@/lib/queries`
  barrel; `@sparticuz/chromium` 16 majors old + puppeteer PDF cold-start hang (no timeout —
  demo risk).
- Env sprawl (59 keys, no manifest/startup validation); README setup stale/prod-dangerous;
  no CONTRIBUTING/ops runbooks (deploy-rollback, Railway restart, migration-recovery, secrets
  rotation).
- **MT5 transport doubles are stateless about IPC-attach (test robustness).** The
  `_FakeMt5`/`_FakeMt5Transport` doubles return True from `initialize()` unconditionally;
  reads don't depend on it. The bug class ("IPC state exists only on the live terminal,
  doubles never modeled it" — the `-10004` connect crash) stays partially unmodeled. Give
  the doubles an `initialized` flag (reads → -10004 unless `initialize()` ran, `shutdown()`
  clears it) so the restart→re-attach path is proven, not just asserted by call-order.
  Deferred from v0.49.2.0 (conflicts with the isolated-read tests that don't login first;
  needs those restructured). Red-team FABLE 2026-07-25.
- **`requirements.in` vs lock drift (analytics-service).** `.in` pins `pandas==2.2.3` but
  the committed `requirements.txt` lock pins `pandas==3.0.3` — out of sync, so a naive
  `make lock` would silently DOWNGRADE prod pandas 3.0.3→2.2.3 (a money-math dep). Also the
  committed lock predates `--universal` markers / drops `[extra]` annotations vs local uv
  0.11.6 output, so `make lock` isn't reproducible across uv versions. Fix: decide the
  intended pandas, pin the uv version used for locking, regen once, commit. (Surfaced by the
  v0.49.1.0 MT5-deps ship; the rpyc line was hand-added to avoid triggering this drift.)
- **No `docs/architecture/` ADRs** — every decision is implicit in code; actively-inconsistent

  ⛔ **FALSE AS WRITTEN — corrected 2026-08-14.** `docs/architecture/` contains **18 ADRs** (`adr-0001` … `adr-0024`), and `REQUIREMENTS.md:1001-1002` cites ADR-0001/ADR-0003 by name. This line is the same ledger-vs-reality class the v1.17 milestone audit was convened over, found by the ADR conflict synthesis. ⭐ What IS true, and is the useful residue: the ADRs are **not all current** — `.planning/INGEST-CONFLICTS.md` records 4 blockers where an ADR contradicts HEAD.
  mechanisms to codify + consolidate: multiple auth wrappers, multiple cron mechanisms
  (vercel.json vs `pg_cron`+`pg_net`), multiple admin checks. (17 existing decisions to
  document + 5 open questions per the 2026-04 architecture audit.)

### v1.16 Phase-140.1.2 — routed findings (added 2026-07-26)

> Both are **pre-existing** and were deliberately fenced OUT of Phase 140.1.2, whose scope was
> four named artifact items and no general sweep. Routed here per that phase's own CONTEXT rule.

- **`analytics-service/tests/test_mt5_validate.py` carries 8 self-referential detail
  assertions** — `:286`, `:310`, `:328`, `:347`, `:383`, `:404`, `:420`, `:436` are each
  `assert ei.value.detail == <CONSTANT>` where the constant is imported from the module under
  test, so the assertion cannot fail when the copy changes. (All 8 re-read at HEAD
  `2c55ece0`; the file is untouched by 140.1/140.1.1/140.1.2.) 140.1.1's oracle audit found
  zero self-referential oracles *in the 19 files it added* — this is an older file it never
  rewrote, so that audit's verdict is not contradicted. **Do not copy this pattern**; fix by
  typing the expected copy as a literal in the test, the way 140.1.1 fixed the one assertion
  in this file that it did touch.
- **`analytics-service/docs/STATUS_CONTRACT.md` not-seam-reachable coordinate drift beyond the
  item 140.1.2 repaired** — `routers/portfolio.py:2242` is a comment line (`# Audit H-0535 —
  the credential fields are pydantic.SecretStr…`; the 429 raise is at `:2254-2264`, located by
  the text `if not _check_verify_strategy_email_rate(` at `:2253`) and `:2446` is a comment
  line too (`# Vectorized matching: build a DataFrame…`), not a deliberate error arm.
  **Re-derive both by text before fixing — do not trust these numbers either**; the raise
  shifts whenever anything above it in a 2500-line router moves. 140.1.2 plan 04 corrected
  the `exchange.py` and
  `internal.py` coordinates in that bullet plus the S-11 row and the classes heading, and
  deliberately stopped there. *(Same file, same class: `routers/exchange.py:37` and
  `services/error_contract.py:6,8` still say "the four classes" in prose — the table has had
  five rows since 140.1.1 plan 01. One-word comment fix, batch it with the above.)*

### v1.16 Phase-140.2 (SEAMCORE) review — findings routed onward (added 2026-07-27)

> From the 140.2 code review (1 Critical, 3 High, 4 Medium, 6 Low) + VERIFICATION W-1..W-4.
> **Fixed in the review-fix pass:** CR-01, HI-01, HI-02, HI-03, ME-01, ME-02, ME-03, LO-03,
> LO-04, W-1, W-2 (folded into HI-01). ME-04 was JUDGED and recorded rather than fixed (the
> containment it needs is a cross-language change to a closed dependency set, and 140.2's fence
> is zero Python) — it lives in `140.1-TS-OBLIGATIONS.md` as **TS-39** with the HI-01 residual.
> Copy halves went to 140.3 as **TS-37/TS-38**; branch protection went to ops as **TS-40**.
> The four below are the ones deliberately left, each with its reason. **Coordinates are
> SEARCHABLE CODE TEXT, not line numbers — five waves rewrote these files.**

- **LO-01 — `501` and `505` count toward the breaker, re-creating the self-sustaining outage the
  `500` arm exists to prevent.** `src/lib/seam-discriminator.ts`, the status table: only `500` is
  `service-permanent`; `501 Not Implemented` and `505 HTTP Version Not Supported` fall into the
  `other 5xx → SERVICE-TRANSIENT → COUNTS` arm. Both are DETERMINISTIC — retrying cannot help — so
  five of them in 30 s open the circuit, which then blocks its own recovery probe. That is verbatim
  the R-1 / A-02 reasoning the `500` arm itself cites. A route deployed against a Python version
  that does not implement a method would trip the seam for everyone, one cooldown at a time.
  *Why not fixed now:* it is PRE-PHASE behaviour that 140.2 did not introduce, and the arm is
  shared with 502/504 (platform edge), where transient IS correct — so the change is a re-derivation
  of the status table, which is SEAMCORE-01's subject and cross-pinned to
  `analytics-service/docs/STATUS_CONTRACT.md`. *Fix:* add `501` and `505` to the permanent arm, or
  state in the table why they are considered transient on this seam. Pair with a discriminator pass.

- **✅ CLOSED 2026-08-01 by phase 141.2 plan 01 (findings 10 + 11) — after being RE-OPENED the
  same day.** Both halves are fixed and both were observed to fail before they were:
  - **Half 1 (arming).** `recordSeamFailure`'s trip path now decides its write from the RAW
    store value's presence, not from the decode, so a corrupt-but-present value is DISPLACED by
    the existing `SET … GET` and the circuit arms with a truthful transition event. The absent
    key keeps the `nx` arm, so concurrent-trip idempotency is unchanged, and the displacement
    arm's ownership rule still refuses a racer that displaced a live lock. Zero extra store
    round trips, which the SC-4b headroom ceiling requires.
  - **Half 2 (the bound).** `decodeBreakerLock` gained a ONE-SIDED absolute plausibility bound:
    an expiry further into the future than the widest legitimate span is rejected.
    ⚠️ **State plainly what this does NOT close.** The PAST side is deliberately unbounded —
    `isBreakerOpen` must decode expired locks to announce the close, so a symmetric bound would
    delete the close event. And the bound rejects implausible values; it does not authenticate
    them. The store remains writable only by us.
  - **Evidence, not assertion.** Three new pins drive `recordSeamFailure`'s WRITE path with the
    corrupt value present (the half 141.1 never drove), plus a decoder case and a separate
    one-sidedness case. Both ledger mutations were applied to production source and observed
    RED, then restored GREEN. Repairing this also exposed a THIRD instance of the same shape:
    the A-25 production-wiring pin was seeded with a REVERSED pair, which decodes to `null`, so
    it had been satisfied by a refused `SET NX` rather than by the guard it is named for. Its
    fixture is now a real tombstone armed mid-flight, and it was shown to redden under its own
    mutation.
  - **Was it live?** A read-only probe of the production Upstash store on 2026-08-01 found all
    five breaker keys ABSENT, so no corrupt value was resident at that instant: this landed as
    hardening, not as incident remediation. The defect itself was live on every seam call for
    the whole period, and a probe is a point-in-time observation, not a history.
  - Advisory-gate language discipline: the new pins **would have caught** this regression at
    141.1; nothing in CI *did* stop it, because they did not exist.

  *The RE-OPENED write-up is kept below in full, unedited, because it is the record of what was
  believed when the defect was found:*

- **⛔ RE-OPENED 2026-08-01 — the 141.1-06 fix is a REGRESSION, and the discharge below was
  false. Owned by phase 141.2 (findings 10 + 11), TOP priority.** The xhigh review of 141.1
  found two defects in `f308b460` itself, and `git log -S "MAX_BREAKER_LOCK_SPAN_MS"` confirms
  that commit is the sole origin — this is ours, not pre-existing:
  1. **The breaker can now fail to arm at all.** A corrupt value that is still PRESENT in Redis
     decodes to `null` under the new span bound, which routes `recordSeamFailure`'s trip path
     into the `nx: true` branch — and `SET NX` cannot overwrite an existing key. So the write is
     refused, no lock is stored, and `emitBreakerTransition` never fires. **For that key's full
     TTL the circuit cannot open on any of the fifteen seam routes, silently.** Before
     `f308b460` the same value decoded to a lock and took the `get: true` overwrite branch,
     which armed correctly. Strictly worse than what it replaced.
  2. **The claim "a `Retry-After` of 1e17 can no longer be minted" is false.** The bound is
     span-only — it never compares either timestamp to `Date.now()` — so
     `open:100000000000000000:100000000000030000` has a legal 30 000 ms span, decodes fine, and
     still puts `Retry-After: 100000000000000` on the wire, including to the anonymous teaser.
     The reachable production variant is a clock-skewed writer telling every reader to retry in
     ~3 600 s instead of 30.
  The regression test cited below exercised only `isBreakerOpen`; it never drove
  `recordSeamFailure` with the corrupt value present, which is why it stayed green.
  *Original (now-false) discharge text kept for provenance:* "The prescribed fix landed exactly
  as written below: `decodeBreakerLock` now rejects a span that is `<= 0` or
  `> MAX_BREAKER_LOCK_SPAN_MS` … A `Retry-After` of 1e17 can no longer be minted."
  Original text kept for provenance: `src/lib/resilient-fetch.ts`, the `^open:(\d+):(\d+)$` regex: it accepts any digit
  strings, so `open:0:99999999999999999999` decodes to `expiresAtMs ≈ 1e20`, `isBreakerOpen`
  returns `retryAfterS ≈ 1e17`, `Number.isInteger` accepts it, and `Retry-After:
  100000000000000000` goes on the wire — **including to the anonymous teaser**. A reversed pair
  (`expiresAtMs < armedAtMs`) makes `emitBreakerTransition`'s `cooldownS` negative. The value is
  only writable by us today, so this is bookkeeping corruption rather than an attack path — but
  `CircuitOpenError`'s A-15 guard was added specifically to stop implausible values reaching a
  header, and this is the one remaining path that can produce one that PASSES it. *Fix:* reject a
  span that is `<= 0` or `> (BREAKER_COOLDOWN_S + BREAKER_LOCK_TOMBSTONE_S) * 1000`, returning
  `null` — corruption reads CLOSED, per locked decision 4. Cheap; belongs with Phase 141's breaker
  pass (**TS-39**) since it touches the same decode path.

- **LO-05 — `sentryCaptureDeps()` resolves ONE hop and re-arms the trap it disarmed.**
  `src/__tests__/gdpr-export-coverage-hook.test.ts`. The change correctly stopped hand-listing
  `sentry-capture.ts`'s deps, but the regex is applied to `sentry-capture.ts` ONLY — it does not
  recurse into what those deps import. It holds today purely because `seam-redaction.ts` has a
  purity guard forbidding imports. The moment `sentry-capture` imports a non-leaf, every mutation
  case in that file fails with `Cannot find module`, for a reason that has nothing to do with what
  they assert — exactly the trap the function's own docblock says it exists to disarm. *Fix:* make
  the walk transitive (worklist over discovered files), or assert the one-hop assumption LOUDLY —
  `expect(depsOf(dep)).toEqual([])` for each discovered dep, with a message naming
  `seam-redaction`'s purity guard as the reason it holds. Test-infra; no production risk.

- **LO-06 — `scrubSeamError(error.message)` passes a STRING into the error renderer.**
  `src/app/api/strategies/finalize-wizard/route.ts`, the site logging `"RPC error:"` with
  `error.code` as a third argument. `scrubSeamString` is the entry point for a string;
  `scrubSeamError` routes it through `describeThrown`, which takes the `String(err)` fallback.
  Harmless (both are total and produce the same bytes for a string) and inconsistent with the six
  sibling sites in the same file. ⚠️ **CR-01 raised its value:** now that `describeThrown` renders a
  plain object's `code`/`message`/`details`/`hint`, passing `error` WHOLE would give this site the
  SQLSTATE, details and hint it currently throws away — the same diagnosis CR-01 restored to the
  other six. *Fix:* `scrubSeamError(error)`, keeping the deliberate raw `error.code` third argument
  (it is an allowlisted `SAFE_PROPERTY`). One line; batch with any finalize-wizard pass.

### v1.16 Phase-140.1.2 review — findings routed onward (added 2026-07-26)

> From the 140.1.2 code review (0 Critical, 0 High, 7 Medium, 6 Low). The four in-fence items
> (M-02, M-04, M-05, M-06) plus L-03/L-04/L-05 and W-02 were fixed in that phase. These are the
> ones deliberately NOT fixed there, each with the reason and the owner. **Every coordinate
> below was re-derived at HEAD by locating the code text; re-derive again before acting.**

- **→ backlog, beside the four-vocabulary unification.** The provenance channel
  (`ValidationResult.permanent`) has ONE consumer. `routers/process_key.py`'s `_envelope_error`
  `recoverable` derivation and the sync-arm 424 venue-transient pre-gate both still key on
  `_ROUTE_TERMINAL_ERROR_CODES` ∪ `PERMANENT_VALIDATION_ERROR_CODES`, neither of which knows
  `MT5_WRONG_SERVER` / `MT5_MASTER_PASSWORD` or any pandera-minted CSV code. **Unreachable for
  MT5 today** — `process_key.py` admits `mt5` to `onboard`/`resync` only and `_is_long_fetch`
  routes both to the worker — so this is latent, not live. It goes live the moment a second
  adapter states permanence, or `_is_long_fetch` changes: two contradictory verdicts on two
  paths for one rejection. Plumbing exists (`_envelope_error` already takes an explicit
  `recoverable: bool | None`). (Review M-03.)
- **→ backlog. One route, two body shapes for one condition.** After 140.1.2,
  `POST /api/validate-key` answers 400 with `{detail, code, recoverable}` for a ccxt
  `AuthenticationError` but bare `{detail}` — byte-identical `detail`, **no `code` at all** —
  for an sFOX 401 or an MT5 bad password. Same for `MT5_WRONG_SERVER_DETAIL` and
  `MT5_MASTER_PASSWORD_DETAIL`, which carry no machine code anywhere on the HTTP path even
  though the WORKER path now knows they are permanent (PYAPIFIX2-02). A 140.3 consumer
  branching on `body.code` therefore behaves differently per venue for an identical condition.
  Pre-existing class (the permanent 400 arms were never in PYAPIFIX2-01's venue-transient
  scope), but the asymmetry is newly VISIBLE. Close it by giving the permanent 400 arms the
  same flat shape with `recoverable=false`. (Review M-07.)
- **→ backlog, no behaviour change requested.** `recoverable: true` is advertised for
  `UNSUPPORTED_EXCHANGE`, which can never clear by retrying, because it is not in
  `PERMANENT_VALIDATION_ERROR_CODES`. The arm is effectively unreachable (`create_exchange`
  gates on `EXCHANGE_CLASSES` and raises `ValueError` for unknown ids) and
  `UNSUPPORTED_EXCHANGE` was explicitly REFUTED and fenced out of 140.1.2, so the
  classification is inherited; what is new is that the derived boolean is now on the wire.
  Fold into the four-vocabulary unification. (Review L-06.)
- **→ backlog, optional.** Three `Retry-After` values advertise the FULL window when the true
  remainder is known: `routers/simulator.py:260`, `routers/portfolio.py:1971`, `:2263`. All
  three guards are SLIDING windows keeping a list of timestamps, so the true wait is
  `bucket[0] + WINDOW - now` — which can be one second, while the header says `3600`. Safe (it
  never under-advertises) but it can tell a user one second from a free slot to come back in an
  hour. The service already has the better pattern at `main.py:_retry_after_seconds` (`:461`),
  which reads the real remainder and falls back to the window only when it cannot. Fix shape:
  have `_check_*_rate` return `(ok, retry_after)`. (Review L-01.)
- **→ backlog, adds to the STATUS_CONTRACT coordinate-drift item above.** A mechanical sweep of
  all 51 `path:line` coordinates in `docs/STATUS_CONTRACT.md` (added while fixing review M-05)
  found three more pointing at a blank line at HEAD, none of them in M-05's scope:
  `services/exchange.py:978` (cited as the range start `:978-1021` in R-2), `routers/exchange.py:96`
  and `routers/exchange.py:215` (the S-02 row). The §7 S-table is a HISTORICAL census — its
  `Site` column records where each site was when the table was built, alongside a `Today`
  column describing the pre-migration shape — so a row's coordinate going stale is expected
  and is not by itself a defect. Prose coordinates outside the table are a different matter.
  **The durable fix is not another sweep**: cite by searchable code text (or an anchor comment
  in the source), so a coordinate cannot rot silently. Until then, re-derive before trusting.
- **⚠️ Declined in 140.1.2, recorded so it is not re-filed.** Review L-02 asked for one
  `from services.error_contract import …` per module in `routers/exchange.py` and
  `routers/portfolio.py` (each has two, with a comment block above each). It was applied and
  then **reverted**: merging the imports adds 5 lines near the top of both files, which shifts
  every line below and silently invalidated ~16 verified line coordinates in
  `docs/STATUS_CONTRACT.md` — including the six `fetch_trades` arms
  (`exchange.py:660,670,685,689,698,760`) a verifier had just checked line-by-line. In a
  programme this coordinate-dense, a cosmetic import merge is not worth invalidating the
  document 140.2/140.3 read. Do it only as part of a change that re-derives those coordinates,
  or after they stop being line-based.

### v1.16 Phase-140.5 (SEAMPROSE) — deferred items (added 2026-07-30)

Full detail: **`.planning/phases/140.5-seamprose-attribution-copy-harness-fidelity-and-prose-citati/140.5-deferred-items.md`** (tracked; the phase's own carry-forward ledger, ~40 sub-items). All items below are **non-blocking** by the founder bar (guard-hygiene, prose/citation, copy, and deferred breadth do not block); logged here so the canonical backlog owns them. The phase's one user-facing defect (**1d**, `permissions/route.ts` KEK "not configured" misattribution) was **FIXED** post-phase at `a89cedbf` and is NOT carried.

- **Copy alignments (non-blocking):** `csv-validate` 503 config-missing arm is a bare heading vs the sibling 502's fuller sentence (§1c); `UNSUPPORTED_EXCHANGE` deserves its own wizard member rather than the honest `UNKNOWN`/500 fallback (§1b).
- **Coverage-law guard widenings (guard-hygiene, §2a–2f):** `.tsx` log-roster class open (two instances scrubbed, roster doesn't cover `.tsx`); wait-threading completeness unguarded; `composite/members` has no `Retry-After` producer (recorded in the guard docblock); docblock-prose rewrites have no guard; purity-needle + wire-vocabulary guards partial-by-construction. Each names its one-line ratchet.
- **Citation/prose harness residuals (§3a–3f):** D/E/F self-relative citations (`line 55`, `(:1027)`) need a second file-scoped predicate; string-literal citations invisible to the comment-scoped census — ⚠️ **NARROWED 2026-07-31 (141.1-02):** `seam-retry-registry.ts` was appended to `SEAM_CITATION_SURFACE` (now 35 files) and given a registry-LOCAL guard that scans all 13 evidence strings and reds on any `file.ext:NN` coordinate, so the registry's own string literals are covered; the residual is now the **other 34 files'** string literals, still comment-scoped only; a marked-quotation-exclusion guard is unbuilt; two RESEARCH offset/count figures (§3.8 `+72`, WP-13 "3+1") are mis-shaped — re-read, don't inherit.
- **Type hazard (§4a):** `AnalyticsUpstreamError`'s positional params — same adjacent-same-typed-argument class as `mintTenantClaim`, more call sites; wants its own scoped plan, not a drive-by.
- **Harness/CI residuals (§5a–5g):** 17 `stripComments` copies unrewired (needs a third string-erasing mode); `ci.yml:1633` left narrow deliberately (subsumed by `spec-disabling.invariant.test.ts`); two PR #108 e2e follow-ups stay skipped; `handleRetrySync` reset is defence for the path 141 adds — ⚠️ **CORRECTED 2026-07-31 (141.1-09): no longer "unreachable today".** 141 shipped that path; it is live and reachable on the five retry-enabled budgets, so this reset is now active defence rather than anticipatory.
- **424 arrival breadth (§7, deferred by decision):** 140.5-06 task 2 landed 1 of 5 arrival routes + 0 of 5 re-homes. Owed to a future plan: 424 arrival cases at `keys/validate-and-encrypt`, `strategies/create-with-key`, `strategies/composite/add-key`, `verify-strategy`; and RE-HOMING (not deleting) five cannot-arrive suites onto an emittable status while keeping their forwarding assertions.
- **Founder-owed (not code — do not plan around, §6):** copy-vs-`DESIGN.md`-§Voice review for the Claude-drafted CSV/KEY copy; **TRAP-4** five-clicks in a real browser (C-4) + **Sentry ingestion** in a preview via an unroutable `ANALYTICS_SERVICE_URL` (C-5); **⛔ D-01 live-Redis lane STILL UNVERIFIED** — `tests/redis/**` needs a live store, registration pins existence not execution.
  - ⚠️ **C-4/TRAP-4 live five-clicks ATTEMPTED in a real browser 2026-07-30 — blocked on key availability, not a defect.** Reaching a gate render (`GATE_NO_DATA_SOURCE` / `GATE_INSUFFICIENT_TRADES` / `COMPOSITE_MEMBERSHIP_UNKNOWN`) requires a read-only key in a valid-but-no/insufficient-data state; none was available, and entering keys is a Claude-prohibited action regardless. Property remains **code-proven** (mutation M103 RED; unconditional `<Link>` escape at `ErrorEnvelope:1609`). Still owed: a human paints it once in a real browser (or a seeded e2e — the PR #108 follow-up).
- **Cosmetic (140.5 verifier/reviewer non-blockers, guard-hygiene):** `SEAMPROSE-01..08` IDs are not in `.planning/REQUIREMENTS.md` (inserted-phase convention, same as SEAMRIM/140.4 — all eight accounted for across the 8 plans); the contracts-registry batch label calls `seam-venue-vocabulary` `SEAMPROSE-05` while plan-02 frontmatter lists `-03/-07` (label drift, no functional effect).

### v1.16 ship findings (per-phase PR landing, 2026-07-30)

- **⚠️ CORRECTED root cause — the `python` red was NOT a straddle; it was a fastapi 0.139 harness incompatibility (FIXED, commit `b3686767`).** `test_validate_key_venue_transient.py` failed all 14 venue-transient cases in CI ("no `/api/validate-key`/`/api/verify-strategy` route on `main.app`") on EVERY cut, and it did NOT self-resolve at the tip — my earlier "23/23 at the tip" was a false read from running the file **in isolation on a local fastapi 0.135.1** (flat routes). Real cause: fastapi **0.139.0** (deps bump #592) made `include_router()` lazy — multi-route sub-routers become a single `_IncludedRouter` placeholder in `app.routes` (routing still works; TestClient reaches every endpoint), so the harness' FLAT `main.app.routes` scan missed the exchange/portfolio routes. Reproduced authoritatively under the exact CI env (Python 3.12.13, fastapi 0.139.0, starlette 0.46.2 via a `uv` venv). Fix descends through `_IncludedRouter.original_router` (correct on both the pre-0.139 flat and 0.139+ lazy shapes). **Consequence to note honestly:** PR2–PR5 were merged on the belief this was a self-resolving straddle — it was not, so `main`'s `python` CI (and thus the Railway worker deploy, which gates on green CI) stayed red from PR2 until this fix. `sql-tests` DID straddle (red 140.1–140.3, green from 140.4).
- **Genuinely separate, still-open: the `MultiKeyConnectStep` WIZ-02 frontend test-isolation flake** (44/44 in isolation, order/shard-sensitive) — did NOT hit PR6's `frontend-test` shard; left as tracked test-hygiene, fix if it reddens a future shard.
- **✅ RESOLVED — `e2e-seeded` red on `main` after the v1.16 ship (`discovery-hide-examples-default.spec.ts:122`, DISCO-05).** NOT a product regression: the spec waited for a "No strategies" empty-state row, silently assuming the `crypto-sma` category held zero non-example published rows — false in the shared test DB (`qmnijlgmdhviwzwfyzlc`), which accumulates other specs' seed data. Fixed (PR #654, merge `4f45dcab`) by gating on the "Hide examples" checkbox reaching `checked=true` (bound `checked={!showExamples}`, flips in the same render that applies the `is_example` filter) instead of a global empty-state, then asserting zero `SEED_NAMES` (polled). Verified: e2e-seeded PASSED against the live polluted DB. ⭐Lesson: e2e specs on the shared DB must assert their OWN seed invariant, never a global DB state. See memory `project_e2e_seeded_shared_db_pollution_global_emptystate`.

### v1.16 carried-forward residuals — 140.3 / 140.4 `gaps_found` (added 2026-07-30)

Both phases SHIPPED to main (PR #651 / #652) with their VERIFICATION marked `gaps_found`; the named residuals below were accepted as tracked tech-debt (per the founder blast-radius bar). **Two are user-facing** and are candidates to fold into a 140.3/140.4 gap-closure pass before or alongside Phase 141 — founder decision owed at 141 kickoff.

- **✅ RESOLVED 2026-07-31 — SEAMUX-03 typed `{code}` envelope.** Closed via gap series G4–G9 (branch `feat/v1.16-141-jobs-rate-retry`). Class-map found **10** bare routes, not the 9 the VERIFICATION named — it missed `admin/strategy-review` (instance-not-class). All 16 seam-importing routes now carry a `code:` on every reachable route-emitted arm (csv-validate was already wire-coded via `csvErrorBody` — audit-only). Opus verifier PASSED: 817/817 tests, RED-on-neuter confirmed on 4 routes, `140.3-VERIFICATION.md` SEAMUX-03 → `resolved`. **Remaining non-blocking residual:** 2 `rateLimitDenyJson` deny bodies stay codeless — `verify-strategy` (route.ts:71) and `scenario/optimize` (route.ts:163) — because SEAMRIM-05 tests pin their exact codeless bodies; it's the rate-limiter boundary (our throttle / Upstash-misconfig, NOT the analytics seam), low blast radius (teaser has no discriminating client; scenario's 429 is a pre-existing no-Retry-After contract). One-line follow-up if ever wanted: give them `throttledBody`/`misconfiguredBody` codes + update the SEAMRIM-05 pins. Also still open (out of this gap's scope): the poll-disjointness pin (test-hygiene) and the SC2 `COMPOSITE_UNSUPPORTED_UNIFIED` residual — 140.3-VERIFICATION.md overall stays `gaps_found` for those two.
- **✅ RESOLVED (was flagged user-facing) — SEAM_MISCONFIGURED→UNKNOWN on the two wizard clients** (140.4). Re-verified against current code **2026-07-31**: the translate-first hop IS present — `ConnectKeyStep.tsx:496` and `MultiKeyConnectStep.tsx:829` both call `recogniseSeamErrorCode(seamErrorCode(data))` before the `KNOWN_*_CODES` membership check, and the docblocks (`ConnectKeyStep.tsx:220-243`) document `SEAM_MISCONFIGURED` handling via the translation. The 140.4-VERIFICATION.md gap was **stale** (fix landed after it was written). No action owed.

### v1.16 Phase-141 / 141.1 (SEAM / SEAMBACKOFF) — deferred items (added 2026-07-31)

**This section discharges G4** — the obligation that Phase 141 have a deferrals section at all, which every prior v1.16 phase had and 141 did not. All items below are **non-blocking** by the founder blast-radius bar (nothing here is user-facing or data-integrity); they are recorded so the canonical backlog owns them, not scheduled. Verdicts, one per 141 obligation — the other four are closed **in place** rather than restated here, so the original text stays where a reader will look for it:

- **G1** — TS-35 W-4 `recoverable` rider (annotated in the 141–146 review-depth table above): **DISCHARGED**. The re-derivation is that the rider's premise is false — `recoverable` never became a retry input.
- **G2** — LO-02 / TS-39 `decodeBreakerLock` unbounded span (annotated on its own row above): **DISCHARGED** in code at `f308b460`, exactly as prescribed.
- **G3** — the `handleRetrySync` "unreachable today" parenthetical (annotated in the 140.5 section above): **DISCHARGED** by correction — 141 shipped that path, so the statement is now the opposite of what it said.
- **G4** — Phase 141 has no deferrals section: **DISCHARGED** by this section's existence.
- **G5** — `141-REVIEW.md` untracked: **DISCHARGED** already, at `2e36016d`. **No action owed**; recorded only so the enumeration is complete.

**Bucket H — recorded, deliberately NOT fixed** (from `141-REVIEW-CONSOLIDATED.md`; each re-verified against HEAD on 2026-07-31 before being written here):

- **H1 — a seam retry double-consumes the PYTHON-side per-tenant limiter, during exactly the incidents it fires in.** The retry is a second HTTP request to the analytics service, so it burns a second token from *that* service's limiter: `/optimize-weights` is `20/minute` per tenant and `/process-key` is `100/hour` tenant / `30/hour` anon under a `500/hour` platform ceiling (values read from the routers, not inherited). The Vercel-side limiter is **not** doubled — it is checked once per user request, before the handler. Net user-visible risk: during upstream degradation a tenant can hit "rate limited" for a fault that is not theirs. Worth a recorded decision (accept, or exempt retries from the Python limiter); not a defect today.
- **H3 — `admittedAtMs` is captured ONCE, outside the retry loop.** Confirmed at HEAD (captured well above the `for (let attempt …)` header). Attempt 2's failure is therefore judged against a pre-loop admission instant and cannot re-arm a just-expired lock. **Know it; don't fix it** — the miss is fail-open, which is this module's doctrine per A-25, and the founder's stance on it is explicit.
- **H4 — `keys/sync` forwards the upstream status verbatim where the legacy contract promised `'syncing'`, and 200 where it promised 202.** Confirmed: the `WIZARD_DUPLICATE` branch emits `status: typeof upstream.status === "string" ? upstream.status : "syncing"`, so a `'draft'` upstream status reaches a caller documented to receive `'syncing'`. Nobody reads it today — no client branches on that field on this route.
- **H7 — `H-0562` (multi-worker durability) had no ledger target.** It is cited as OPEN inside the registry's `match-recompute` NO-verdict evidence, but appeared nowhere in this file, so a reader asked to confirm "still OPEN" had nowhere to look. **This bullet is that target.** Substance: `match.py`'s `_get_recompute_lock` is process-local (an in-memory `dict[str, asyncio.Lock]`), NOT distributed, and there is no unique constraint on `match_batches` — so it bounds the single-process race but does not serialize across worker instances. Unproven ⇒ no-retry, which is why `match-recompute` is a NO.

**Deferred by decision (own phase, own soak):**

- **D-03 — server-side request cancellation in the analytics service.** A retry on any of the four heavy analytics budgets (`bridge` 15 s, `simulator` 15 s, `portfolio-optimizer` 15 s, `optimize-weights` 30 s) adds a **second concurrent full compute while attempt 1 is still burning Railway CPU**, because nothing on the FastAPI side awaits `request.is_disconnected()`. Accepted as a known consequence of 141 and recorded per-entry in `seam-retry-registry.ts` so it cannot be inherited silently; also written into `docs/runbooks/seam-breaker.md`, because during a degradation it is a live contributor to the CPU saturation rather than a red herring. Closing it is its own phase with its own soak.

**D-16 follow-ups** (the denominator/numerator repair itself LANDED in 141.1-08 — these are its residuals, not a re-booking).
⚠️ **Re-framed 2026-08-01: D-16's DENOMINATOR half no longer exists.** Phase 141.2 / D-02 deleted the distinct-`correlation_id` dedup outright (it was wire-steerable, silently truncated at PostgREST `max_rows`, and collapsed nothing on real traffic — 42/42 production rows carried distinct server-minted ids), replacing it with an attempt-grained server-side COUNT. The three residuals below are kept because **all three are about the NUMERATOR or the release record, not the dedup**; nothing here schedules work on deleted code. Read "D-16" in them as "the 141.1-08 flag-monitor repair", not as the dedup:

- **(i) The corrected two-cause diagnosis, recorded FORWARD.** The flag-monitor numerator had been structurally 0 since Phase 19. The 2026-05-27 region-URL fix (`8904b204`) addressed **one of two independent, separately-sufficient causes**; the second is that this repo writes `path` to Sentry `extra` (unindexed) and **never** to `tags`, so a `path:` filter matched nothing regardless of its value — and the value was wrong too (`/api/process-key` vs the FastAPI `/process-key`). ⛔ **Do NOT edit the historical `[0.24.x]` CHANGELOG entries** — a shipped changelog records what was believed at release time, and the partial diagnosis is itself the useful evidence. The corrected account lives in the `[0.51.0.0]` entry.
- **(ii) Post-repair recovered-retry visibility residual.** Now that the numerator *can* fire, a transient failure that fails then succeeds on attempt 2 emits no Sentry error event — so the repaired alert still under-counts degradation, in the direction of silence. Follow-up: a warning-level capture on retry exhaustion plus a numerator widening to match. (Note this is the *only* form in which the review's original "retries suppress the alert" premise is true; as originally stated it was moot, because the alert had never fired at all.)
- **(iii) Confirm the first real process-key event's `transaction` form.** The scoping term `transaction:/process-key` is **derived** from the FastAPI `APIRouter(prefix="/process-key")` plus its bare mount — not observed in the index (the 90-day probe saw no process-key-shaped transaction at all). When the first process-key-origin error is indexed, verify the SDK's actual transaction string (it may take the `POST /process-key` form) and correct the term. Until then the numerator is correctly scoped but **unproven**.

**Still-open carry-forwards from the phase's own `deferred-items.md`** (all four items;
02-B and 09-A were added here at phase verification, which found this list and that file
disagreed):

- **✅ DEF-141.1-02-A — DISCHARGED 2026-08-01 by phase 141.2 plan 02.** The `process_key.py` SCOPE BOUND comment was corrected in place (`71d5b3ab`): the zero-Python fence that blocked it in 141.1 was opened deliberately for this one comment-only edit, because leaving the Python side asserting the sequential class is CLOSED while the TypeScript registry's `resync` evidence asserts it is OPEN is the two-artifacts-disagree drift class 141.2 existed to end. No behaviour change. *Original write-up kept below for provenance:*
- **DEF-141.1-02-A (ORIGINAL, now discharged) — `process_key.py`'s SCOPE BOUND comment still over-claims the thing D-05 corrected.** Confirmed unchanged at HEAD: the comment says the resync draft pre-check "closes the SEQUENTIAL retry class only", i.e. that the sequential class IS closed. D-05 established it is not — the filter is `status='draft'`, and the worker's 30 s tick advances SV#1 out of `draft`, so when that transition lands inside the 15 s-timeout blip window the pre-check matches nothing and a SECOND draft SV row is inserted. The registry evidence for `resync` now states this correctly; **the Python comment still says the opposite**, so two artifacts disagree about one fact — the exact doc-drift class this phase existed to close, in the other direction. Unfixable inside 141.1: every plan that could reach it carried a zero-Python fence (including this one, whose files are docs and release artifacts). Comment-only fix, no behaviour change.
- **DEF-141.1-06-A — the counting arm's FALL-THROUGH exit is still unlogged.** 141.1-06 gave the arm's `continue` (retry) exit a voice, deliberately worded "retrying" so it can never be misread. The fall-through covers **two different operator facts** — the D-01 `Retry-After` fail-fast and a last-attempt surrender — and neither is logged, so in production they remain **mutually indistinguishable**. Not a regression (it was silent before too); left rather than half-done, because one sentence covering both would report neither, which is the over-claim class this phase existed to remove. Closing it needs two distinct sentences, and the fail-fast one arguably belongs with the D-01 surface. Recorded in the runbook as a known gap so on-call is not misled by the absence of a line.
- **DEF-141.1-02-B — `teaser`'s NO evidence overstates two of its three named writes.** It says each call writes a new `strategy_verifications` row "plus a NEW `public_token` and a NEW lead". Traced: the SV row is real; `public_token` is an UPDATE onto that **same** row, not a third write; the "lead" is a PostHog event (ADR-0023 §3), explicitly not a DB row — the route's own `@audit-skip` comment says so. Pre-existing text, outside the D-03…D-06 buckets 141.1-02 discharged, and the imprecision errs **conservative** (it overstates the write surface), so it cannot authorise a wrong retry. Verdict unaffected — `teaser` stays NO on the uncontested first item. Prose-only fix.
- **DEF-141.1-09-A — two runbooks are indexed nowhere.** `docs/runbooks/` holds 26 runbooks + README; `sfox-go-live.md` and `flipretry-derived-equity-go-live.md` appear in no index. Both are go-live procedures — the class most likely to be needed under time pressure by someone who does not know the filename — and the README presents itself as the entry point, so a reader who trusts it will not find them. Needs a category call (the README has no "Go-live" section), not just two rows. Documentation discoverability only, not user-facing.

### v1.16 Phase-141.2 (SEAMFIX) — known limitations, residuals and class censuses (added 2026-08-01)

141.2 closed the 13 verified findings of the 141.1 xhigh review. **"Closed per their dispositions", not "all 13 fixed in code":** twelve were remediated in code or prose; **finding 8 was DISPOSITIONED — accepted, documented, booked — and its mechanism is still live** (entry 2 below). The items here are the limitations and out-of-fence classes the phase deliberately did not fix; none is user-facing or data-integrity, so none clears the founder blast-radius bar. Advisory-gate language throughout: the new pins **would have caught** these regressions, nothing in CI *did* stop them.

1. **KNOWN LIMITATION (D-02) — the flag-monitor error rate is ATTEMPT-grained on both sides, so retries bias it DOWNWARD.** Deliberate, and the safe direction: the alternative that 141.1's D-16 reached for (dedup on `metadata->>correlation_id`) bought a fabricated denominator above PostgREST's `max_rows` and a denominator the wire could pin to 1 through the unauthenticated teaser route. Quieter-under-retry beats false pages plus attacker-chosen silence. A true PER-REQUEST rate needs a **server-minted request id that the retry reuses** — the client-side id cannot serve, because the Python handler re-mints any non-bare-UUID inbound value. That is a cross-seam contract change with its own blast radius, and it is the deferred work. Two further honest caveats already in the docblock, repeated here because they bound what the instrument can see at all: `429`/`401` attempts are refused ABOVE the audit write and produce no row, and the write is fire-and-forget so a lost row biases the rate UPWARD.
2. **FINDING 8 RESIDUAL — DISPOSITIONED, NOT REMEDIATED. The retry→limiter amplification is STILL LIVE.** A granted retry spends a second token of both `/process-key` limiters, including the platform-wide ceiling that is one shared bucket for every caller; draining it refuses the anonymous teaser and the CSV path, neither of which retries. The breaker structurally cannot contain it — `seamBreakerVerdict` classifies `429` caller-throttled and non-counting — and **no signal covers a ceiling drain at all**, because a 429 is refused above the audit write, so neither the breaker nor the flag-monitor denominator advances. **No limiter code was written and no constant moved.** What changed is exposure, not mechanism: post-D-01/D-03 the retry-eligible population is `onboard`-with-a-key only, and `resync` — just under half of all `/process-key` traffic ever recorded, per the 2026-08-01 production audit history — no longer retries, so the worst case applies to an order of magnitude less traffic. Recorded in the `retriesForFlow` docblock in `seam-retry-registry.ts`. *Re-raise if:* a new YES flow verdict lands, `resync` is re-granted, or `RetrySafeEntry.retries` widens past one. **Supersedes H1 above**, which named the same mechanism before it had been measured.
3. **D-01 FOLLOW-UP — a CLIENT-MINTED stable idempotency key.** 141.2 made `onboard`'s retry conditional on the key it already had (`retriesForFlow` refuses a retry when `context.wizard_session_id` is falsy, using `Boolean()` to byte-match the Python truthiness gate). The better end state is to make the antecedent unconditionally TRUE rather than conditionally checked — and it is the same key `resync` would need to earn its grant back. Rejected in-phase on blast radius: it changes the cross-seam contract and the `strategy_verifications` uniqueness semantics, which is more than a defect fix should carry. Needs its own decision, not an inference from the registry entry.
4. **CLASS — unbounded `.select()` on unbounded-growth tables (8 remaining sites).** 141.2 / D-02 closed the one instance the findings named (the flag-monitor denominator, proven truncating in production: `audit_log` held 7350 rows and an unbounded select returned exactly 1000 with HTTP 200 and `error: null`). The class census found 93 unbounded chains, of which these grow without bound: ⚠️ **`api/benchmark/btc` is the highest risk — ASC-ordered over one row per day forever, so past 1000 daily closes the BTC chart silently drops the NEWEST data and the series just ends**; then the two cron enqueue sweeps (`sync-funding`, `reconcile-strategies`, which would silently fund-sync/reconcile only the first 1000 strategies while reporting the truncated number as truth); then `allocator/scenario/commit`'s holdings recompute, the `queries.ts` discovery aggregates, and the marketing page's headline AUM sum. Distinct sub-shape, note only: `cron/cleanup-ack-tokens` caps its DELETE's RETURNING body, so the reported deletion COUNT is wrong, not the deletion. One entry, not eight, deliberately — the fix is the same three-way choice each time (COUNT / `.range()` pagination / an explicit `.limit()` that says so).
7. **DEF-141.2-03-A — stale route coordinates inside a skipped test's comment.** `src/__tests__/audit-coverage.test.ts:962-964` cites three `flag-monitor/route.ts:NN` coordinates, one of them a "feature_flags upsert — kill-switch flip" site Phase 106 (Stage B) retired. Already stale before 141.2 and inside an `it.skip(...)` comment rather than an assertion, so nothing reds and plan 03's edits shifted the numbers further. Comment-only drift, below the bar. Booked here because `deferred-items.md` is a per-phase scratch file and this file is the one backlog.
8. **`Boolean()` does NOT byte-agree with Python's `bool()` for empty JSON collections — the docblock says it does.** Found by the ship red-team pass. `seam-retry-registry.ts` `retriesForFlow` gates on `Boolean(context?.wizard_session_id)` and its docblock claims "the same truthiness predicate the Python gate uses" (`process_key.py`'s `bool(body.context.get("wizard_session_id"))`). True for `null` / `undefined` / `""` / `0` / `false` — the empty-string case it explicitly names is genuinely correct. **False for `[]` and `{}`**: truthy in JS, falsy in Python. A context carrying `wizard_session_id: []` would grant the retry TS-side while Python falls to `… or str(uuid.uuid4())`, mints a fresh session per attempt, skips the duplicate pre-check, and inserts a second draft `strategy_verifications` row — the exact harm D-03 withdrew resync's grant over. **Unreachable at HEAD**, which is why it is logged and not fixed: `retriesForFlow` short-circuits to 0 for every flow but `onboard`, and `onboard`-through-`postProcessKey` has one producer (`finalize-wizard`), whose context is a hand-listed allowlist of validated scalars plus a `wizardSessionId` read off a uuid DB column. Fix when touched: `typeof context?.wizard_session_id === "string" && context.wizard_session_id.length > 0`. Founder call 2026-08-01: ship as-is, the surface is well tested. *Re-raise if:* a second `onboard` producer appears, or any context field stops being an allowlisted scalar.
9. **`hasContractualWait`'s docblock contradicts itself on the HTTP-date form.** `resilient-fetch.ts` states "A date-form wait is a contractual wait like any other and fails fast; there is no deliberate gap here to work around" two lines after correctly noting that no `Date` header yields null. `retry-after.ts` returns null when `Date` is absent, so a date-form 503 WITHOUT a `Date` header does not fail fast — it retries. Harmless in practice (HTTP/1.1 origins must send `Date`; our own emitter uses delta-seconds), but the gap is real and the sentence denies it. Prose-only, below the bar.
10. **The denominator's "attempt over attempt" caveats miss a third class.** `flag-monitor/route.ts` names attempts refused above the audit write (429/401) and lost fire-and-forget writes. A seam attempt failing at the TRANSPORT layer (deadline, refused connection) can produce a Sentry event with no audit row in the window — numerator up, denominator flat. Same safe direction as the lost-write caveat, but unnamed.

### v1.16 SEAM-group close-out — live-ops items still owed (added 2026-08-01)

Booked when the SEAM group (140 → 141.2) had its phase-close bookkeeping run in one
pass. Everything else from those eleven phases is now closed; these need a human with
live access, so they cannot be planned around.

1. **⚠️ FOUNDER/OPS OWED — Phase 140's only `human_verification` item, never dispositioned.** "Watch Sentry during the next real Railway degradation window: confirm `CIRCUIT_OPEN` 503 envelopes appear and that no cascade-500s occur in the same window." Expected: `breaker:railway` trips against the LIVE Upstash, seam callers receive 503 `CIRCUIT_OPEN` + `Retry-After`, and no route emits a raw 500. **Not closable from the repo** — there is no live Upstash in CI/local (20+ test files delete the env vars) and no controllable Railway failure injection; declared manual-only in `140-VALIDATION.md`. `140-VERIFICATION.md` therefore still reads `human_needed` for this one reason, and that is correct, not a defect. *Close it opportunistically the next time Railway degrades.*
2. **⏳ PR #656 is OPEN and unmerged** — `feat/v1.16-141-jobs-rate-retry`, 131 commits ahead of `origin/main`, MERGEABLE. Phases 141, 141.1 and 141.2 are all verified `passed` but unshipped. Founder call.
3. **The fourth 141.2 human item stays PARKED, by design.** "Capture a real Railway-edge 503 carrying an empty, zero or non-numeric `Retry-After`." Cannot be induced: the only contract-bound 503 emitter we own (`error_contract._validate`) raises on `retry_after <= 0` and structurally cannot emit one, and a local dev server sits behind no platform edge. The docblock's and runbook's "whether the platform edge can is unverified" sentences **stay as written** — that is the accurate state. Re-open only if such a trace is ever captured in the wild.
4. **✅ Discharged 2026-08-01 (recorded so the numbers are not re-probed):** the other three 141.2 production probes were run read-only against prod (`khslejtfbuezsmvmtsdn` + live Upstash). `audit_log` `entity_type='process_key'` → **42 rows, 42 distinct `correlation_id`, 0 carrying a `wizard:` prefix**; flow_type **resync 20 · csv 20 · onboard 2** (resync = 47.6%, the quoted "48%"). Unbounded `.select()` → **HTTP 200, `error: null`, exactly 1000 rows** against a 7351-row table, reproducing the silent `max_rows` truncation. All five breaker keys **ABSENT**. ⚠️ One correction owed if anyone re-reads it: the CHANGELOG quotes the table as **7350** rows; it measured **7351** — one row landed between the two reads. The claim is unaffected; the figure is stale by one.

### v1.16 Phase-142 (JOB) — deferred items (added 2026-08-02)

1. **BOTH TypeScript type files are stale on `strategy_analytics` by `computation_warned` + `metrics_json_by_basis`.** `grep -n "computation_warned\|metrics_json_by_basis" src/lib/types.ts src/lib/database.types.ts` returns **zero hits in either file**, while both columns are live in the DB and read by app code (`src/app/api/strategies/finalize-wizard/route.ts`, `src/app/factsheet/[id]/v2/page.tsx`). The last `strategy_analytics` column that actually threaded into `types.ts` was `volume_metrics`/`exposure_metrics` (migration `20260412125725`) — four months and two columns ago, so the interface reads as maintained when it is not. Phase 142 added **only** `computing_started_at` (plan 142-06: the `types.ts` line plus its compile-forced blast radius, 9 files total — `types.ts` + `src/lib/utils.ts` `EMPTY_ANALYTICS` + 7 test fixtures) and deliberately did NOT widen to the other two: that is scope containment, not an oversight, and it is recorded here so the next agent does not read the single addition as evidence the file is current. `database.types.ts` was left untouched entirely and has **no CI freshness gate** (`package.json` + `ci.yml` mention `database.types` nowhere), which is the reason the drift went four months unnoticed. Fix when either file is next touched; the honest fix is all three columns plus a gate, not a fourth one-off addition.
2. **`.claude/agents/migration-reviewer.md` invariant #14 contradicts the repo's actual `BEGIN`/`COMMIT` convention.** The reviewer doc forbids `BEGIN`/`COMMIT` in migrations; **150 of 231 migrations use them, including the repo tip**. Per Rule 11 (conformance over taste inside the codebase) and Rule 7 (pick one, don't blend), Phase 142 followed the repo and pre-documented the deviation in its own migration header so review would not re-litigate it — but that is a per-migration workaround, and every future migration author hits the same contradiction and pays the same cost. The doc is the artifact that is wrong. Fix = update invariant #14 to match the repo (and say what `ROLLBACK` outside `supabase/tests/` still means, which is the part that IS enforced). Documentation-only, no runtime surface.

### v1.16 Phase-142.1 — planning residuals (added 2026-08-02, at plan time — NOT execution findings)

Items 1–5 and 7 were raised by the `gsd-plan-checker` across three verification rounds on 142.1's
plans. **None of those clears the founder blast-radius bar** — all are documentation-rationale or
comment-coverage. Logged here so the next reader does not mistake their absence for oversight. W-1
and W-2 were folded into plan `142.1-05` before execution and are recorded as discharged.

⚠️ **Item 6 (`D-19`) is different in kind and the section heading does not cover it: it is an
EXECUTION finding, not a planning residual** — a real defect found by running the gate against TEST
on 2026-08-02, already fixed on this branch, with a live PROD residual that must be closed at merge.
Read it as such.

1. **⛔ `DEF-142.1-08` — D-08 was CUT from Phase 142.1, and must not be closed by bumping a
   literal.** The finding: `test_main_worker.py:1295`'s `assert len(TIMEOUT_PER_KIND) == 15`
   couples every future job-kind addition to the reaper suite, and the cheapest way to green it is
   to bump the literal WITHOUT the re-derivation the assertion message demands — the trip-wire
   trains the exact behaviour it exists to prevent. It was cut because **no derivation source
   exists for the proposed replacement**: `grep -rn "STRATEGY_SCOPED\|_SCOPED_KINDS\|ALLOCATOR_KINDS"`
   over `analytics-service/` returns **zero hits**, so there is no machine-readable
   strategy-scoped/allocator-scoped partition to assert against. Both remedies are bad — a
   hand-maintained `frozenset` beside `TIMEOUT_PER_KIND` **re-imports D-08's own complaint one
   level up**, and deriving from the `compute_jobs` enqueue surface (which kinds are ever enqueued
   with a non-NULL `p_strategy_id`) is a genuine derivation but materially larger than a
   remediation phase should carry. ⚠️ **There is also a live convention conflict:** the GSD
   VALIDATION template's Oracle Independence checklist requires *"Table/registry sizes are pinned
   to a **literal count**, not to `len(THE_TABLE)`"* — which is precisely the form D-08 argues
   against. That conflict deserves its own decision on the merits, not a drive-by change. ⛔ **Hard
   rule: never close this by bumping the literal to 16.** That is the exact behaviour the trip-wire
   exists to prevent, and it is why the item was raised. Confirmed unchanged at 142.1 execution time
   (`test_main_worker.py:1295` still asserts `len(TIMEOUT_PER_KIND) == 15`) — Phase 142.1
   deliberately implemented no part of D-08.
2. **W-3 — inverted arm D's determinism rests on an unpinned assumption.** The D-11 companion cron
   arm's `LIMIT 25` has no `ORDER BY`, so the inverted arm-D assertion is deterministic only while
   fewer than 25 foreign `(computing, NULL, no-active-job)` rows exist on the shared TEST project.
   Plan 142.1-05 requires the GATE-DETERMINISM NOTE in prose but — unlike plan 03's header
   assumption, which carries an acceptance grep — pins it with none. Add acceptance greps on both
   the migration side and the gate side when either is next touched.
3. **W-4 — `sql-tests` against TEST is expected RED for 142.1's waves 3–4.** Plan 05 inverts arm D
   to require the companion arm, but migration `20260803120000` is not applied to TEST until plan
   07 Task 1 (wave 5), because MCP is stripped from subagents. Unavoidable, and plan 07 already
   documents the false-positive verification state. The residual risk is only that a wave gate is
   misread as a defect — one line in the wave-3/4 SUMMARY templates would close it.
4. **W-5 — gate-file comments owned by no task.** In
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql`: the file header (`:5`
   "Guards migration 20260802120000", `:111` "Run order"), the Part-2 arm summary at `:263`, and
   `:380`'s "arm D: the writer-bug skip rule". Plan 05 step 9 names only `:332-336` and `:390`.
   After 142.1 these comments describe a superseded migration and a superseded arm-D semantics.
   Comment rot only.
5. **W-6 — `142.1-RESEARCH.md` § "Architecture Patterns" still carries the superseded
   `BEFORE INSERT OR UPDATE` trigger sketch verbatim.** Every consuming plan carries an inline
   ⚠️ supersession note in `read_first`, and CONTEXT § D-18 Part 1 states the supersession — but
   the research document itself is never annotated, so a reader who opens it first gets the wrong
   shape. One banner line fixes it.
6. **⚠️ `D-19` — the reaper's `LIMIT`-25 bound is restored on THIS BRANCH ONLY; the PROD cron body
   still carries the unbounded shape until it merges.** Found by the first end-to-end run of
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql` against TEST (phase 142.1
   plan 07 / D-16). Part 3 arm E: 26 seeded stranded rows, **zero** foreign competitors, one tick
   terminalized **26 of 26** — expected 25. Cause: both arms bound their batch through
   `WHERE strategy_id IN (SELECT … LIMIT 25 FOR UPDATE SKIP LOCKED)`; `FOR UPDATE` makes the subplan
   un-hashable, so the planner attaches it as the inner side of a nested-loop semi-join and
   **re-executes it once per outer row**, applying a fresh `LIMIT` each time — the cap is
   per-rescan, never global (measured on PostgreSQL 17.6). Fixed by
   `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql` (commit `2b8c016f`),
   which forces single evaluation of the bounded batch on **both** arms; verified on TEST before the
   migration was written (`failed=25`, `still_computing=1`, the 26th survives) and the gate re-ran
   green after. ⚠️ **A FROM-clause subquery form was ALSO measured and ALSO reaps 26 of 26** — the
   planner is equally free to nest-loop it, so forcing single evaluation is load-bearing, not
   stylistic; do not "simplify" it away. **Impact is a LOCK-DURATION and BLAST-RADIUS defect, NOT
   data corruption** — the rows are genuinely stranded (>16 h, no active job), but unbounded, one
   `*/15` tick against a backlog of N terminalizes all N in one statement and holds row locks on all
   N, on a table every live analytics write touches. **RESIDUAL / ACTION:** ⛔ the migration is
   applied to **TEST only** (stamped `20260802212852`). PROD's registered cron body is still the
   unbounded shape until `feat/v1.16-142-146-job-rate` merges to `main` and the auto-apply runs.
   **The merge-time PROD verification must re-confirm the deployed body carries the bound as TWO
   single-evaluation batches — one per arm — not just that the `LIMIT` token is present.** That
   token-presence check is exactly what every gate in phases 142 and 142.1 passed over. Class census
   at discovery: of the 8 registered cron jobs, only `reap_strategy_analytics_stuck_computing` puts
   a `LIMIT` inside an `IN (…)` subquery; the other seven carry no `LIMIT` at all — the class is
   closed at one member, so no sweep is owed.
   **✅ CLOSED 2026-08-03 (post-merge QA, PR #659 in `main`):** the merge-time PROD verification ran
   read-only against `khslejtfbuezsmvmtsdn` and the deployed `cron.job.command` carries the bound as
   required — NOT by token presence but by shape: the full body was read and eyeballed; each arm is a
   single-evaluation `WITH batch AS MATERIALIZED (SELECT … LIMIT 25 FOR UPDATE SKIP LOCKED) UPDATE …
   FROM batch`, the `AS MATERIALIZED` count is exactly 2, and no `IN (SELECT … LIMIT` shape remains.
   Job registered `*/15 * * * *`, `active=true`. Bonus: the deployed body includes the non-destructive
   clock-start companion arm for `(computing, NULL-stamp)` rows, which also closes 142-VERIFICATION
   Gap 3's deploy-ordering observability window. PROD stuck-`computing` census at check time: **0**.
7. **✅ Discharged at plan time (recorded so they are not re-raised): W-1 and W-2.** W-1: plans
   claimed SQL-gate Part 4b "stays falsifiable" after the D-18 retrofit; it does not — 4b is a
   **double-mutation** defence-in-depth assertion (trigger arm (a) and the bridge's own keep-arm
   each independently preserve the sentinel). W-2: after the retrofit Part 4a's
   `IF v_stamp IS NULL THEN RAISE` is satisfied by its own seed and can no longer fail. Both were
   over-claims of assertion strength — **the same failure class that produced this phase** (142's
   ledger was reported 11/11 Observed when 7 rows had never been run) — so both were corrected in
   `142.1-05-PLAN.md` rather than deferred, and the plan now forbids crediting either as the SC-2b
   observable in the D-16 evidence. SC-2b's single-mutation proof is Part 6/6a in plan 142.1-08.

8. **WR-01 — a D-19 self-verify guard that provably cannot fire (dead guard, NOT a hole).**
   `supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql:188` asserts
   `v_command ~* 'IN\s*\(\s*SELECT[^)]*LIMIT'` to ban the un-hashable-subplan shape D-19 removed.
   `[^)]*` cannot cross a `)`, and BOTH arms carry `AND NOT EXISTS ( SELECT 1 … cj.status IN (…) )`
   between `IN (SELECT` and `LIMIT` — measured against the exact superseded body: **no match**. The
   bound is still genuinely guarded by the `v_mat <> 2` MATERIALIZED-count check immediately above
   it (that one fires, and fails closed on formatting drift), so this is redundancy, not exposure.
   ⚠️ **Deliberately NOT fixed in place:** `20260803130000` is already applied to TEST (stamped
   `20260802212852`), and editing an applied migration is itself a tracked invariant violation
   (migration-reviewer #11) — desyncing TEST's applied text from the file to repair a *redundant*
   guard is the worse trade. Close it in the NEXT forward-only migration that touches this job, or
   by asserting something that can actually fire (e.g. `FROM batch` occurring exactly twice).
   Danger if left unread: the guard's `RAISE` text is what the next engineer will read as proof the
   broken shape is banned. Found by migration review, 2026-08-03.

9. **WR-02 — the `awk`-range hazard recurred in the gate file, and a SUMMARY over-claims it closed.**
   `supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql:16-18` explains that its final
   part is named descriptively *because* its acceptance gate is an `awk '/Part 6/,0'` range. Plan
   `142.1-05` (a different wave) then mentioned that literal twice in the Part 4 header, so the range
   now starts at `:595` and sweeps Parts 4–6 instead of Part 6 alone. **The measured value is 0
   either way, so there is no false green** — the exposure is that `142.1-08-SUMMARY.md:304` records
   the hazard as closed when it is not. Fix: anchor the criterion on `^-- Part 6 --`, which matches
   exactly once. Worth reading as a pattern rather than a nit: this phase was bitten by `awk` range
   semantics **three separate times** (plans 05, 08, and here), always because prose *about* a gate
   sits inside that gate's blast radius. Found by code review, 2026-08-03.

### v1.16 Phase-142.2 (MT5 on the unified backbone) — deferred items (added 2026-08-04)

Booked at phase close (plan `142.2-08`). ⛔ **Read the boundary first: 142.2 delivered MT5
*reachable and honest* — the connect flow works and its rejections name their true cause. It did
NOT verify that MT5's rendered performance NUMBERS are correct.** That is Phase 142.3 (MT5-06..10,
decisions D-07..D-11), against the live terminal on a trading day. Nothing below, and no artifact
of 142.2, may be read as evidence of MT5 number-correctness.

None of these clears the founder blast-radius bar as blocking. Each names its source decision.

1. **`DEF-142.2-01` — MT5 broker-server typeahead (D-04). ⛔ NOT a simple UI task: there is no data
   source.** The field ships as plain text (now legible rather than dot-masked, MT5-03) plus the
   helper copy at `ConnectKeyStep.tsx:144` ("copy the server name exactly as it appears in your MT5
   terminal") — which is the only reliably correct instruction we can give. **The blocker is data,
   not UI.** `grep` for `broker_server` / `server_name` across `.py`/`.ts`/`.tsx` returns **zero
   hits repo-wide**, and there is no public canonical registry of MT5 broker server names. Three
   candidate sources were considered and rejected: (a) **curated static list** — rots silently as
   brokers add/rename servers, and the field must stay free-text anyway, so the list can only ever
   be a hint; (b) **learn-from-successful-connections** — empty until MT5 has real users, and it
   leaks one user's broker choice to every other user; (c) **public registry** — does not exist.
   ⚠️ A *partial* list is worse than none: it invites picking a near-match that then fails
   validation, which is precisely the confusing-rejection class this phase just closed. Re-open
   only with a named, maintainable data source attached.
4. **`DEF-142.2-04` — ccxt/perp verdict refinement is blocked on the ingestion truncation bugs,
   deliberately.** `combine_realized_and_funding` stamps `fill_derived_unproven` **always — a
   constant, not a computation**. A data-driven refinement (stamp `ledger_complete` when realized
   records provably span the series) would newly **ADMIT** exactly the accounts a silent-truncation
   bug makes look healthy. Fix the known truncating inputs first — the **OKX bills paginator** and
   the **bybit funding cursor**, both already booked under § Money-path correctness — then revisit.
   Order matters: refining first would publish understated track records with a certified verdict.
5. **`DEF-142.2-05` — `_LEDGER_BACKED_SOURCES` → `adapter.fetches_fills` (optional follow-up).**
   `analytics-service/services/ingestion/long_fetch.py:63` still holds a venue literal set. ⚠️ It is
   **NOT** the set MT5-12 deleted and must not be removed: it answers an **adapter-capability**
   question (does this adapter implement `fetch_raw` / `compute_fingerprint` /
   `reconstruct_positions`, or does it raise `NotImplementedError` by design?), which is legitimately
   a venue property. The TypeScript mirror was the trust judgement, and that one is gone. Turning
   the ingestion set into a property on the adapter that already knows the answer would remove the
   last venue literal; it is cheap, and **not required by the MT5-12 invariant**.
6. **`DEF-142.2-06` — `database.types.ts` is drifting and there is no regeneration script.** Phase
   142.2 plan 06 hand-patched **only** `series_completeness` (3 sites: `Row`/`Insert`/`Update`).
   Three pre-existing `strategy_analytics` columns remain missing: `computing_started_at`,
   `computation_warned`, `metrics_json_by_basis`. `package.json` has **no** types-generation script
   and `ci.yml` mentions `database.types` nowhere, so there is no freshness gate — which is why the
   drift went months unnoticed. The honest fix is all three columns **plus a gate**, not a fourth
   one-off addition. **Supersedes/absorbs** the narrower Phase-142 item above (§ "BOTH TypeScript
   type files are stale…"), which names the same two columns for `types.ts`; do not fix them
   separately.
7. **`DEF-142.2-07` — Deribit `twr_chain_broken` tightening: FOUNDER DECISION, with the census
   number attached.** Plan 03 shipped the **behaviour-preserving** default — deribit keeps
   `ledger_complete` on **both** return paths even when `meta` carries `twr_chain_broken`.
   Tightening it (stamp a non-admissible verdict when the chain is broken) is a real option, and the
   read-only PROD census that governs it was run in plan 04: **deribit rows carrying
   `twr_chain_broken` = 0 — total AND published** (1 row carries the flag on a non-deribit venue).
   **So tightening would affect nothing today.** ⚠️ Not decided by the phase, on purpose — it is a
   trust-policy call, not an implementation detail. **Remedy rule if it is ever tightened: affected
   series get a RE-DERIVE, never a backfill `UPDATE`** (see item 9 for why).
8. **`DEF-142.2-08` — renaming `csv_daily_returns`.** The table is the canonical daily series for
   **every** producer (keyed derive, composite stitch, CSV upload), so the `csv_` prefix now names
   only one of three producers. Cosmetic relative to the MT5-12 invariant, which is satisfied by the
   verdict column regardless of the table's name. Low value, non-trivial blast radius; do it only if
   the table is being touched for another reason.
9. **`DEF-142.2-09` — the Pitfall-6 healing population: 6 unpublished strategies, THREE remedies,
   one per producer. ⛔ NEVER a backfill `UPDATE`.** Every pre-existing `strategy_analytics` row has
   `series_completeness IS NULL`, and the gate is fail-closed on NULL. Plan 04's read-only PROD
   census (44 strategies: 33 published, 8 `pending_review`, 1 draft, 1 private, 1 archived) sized it:
   - **1 keyed** → **RE-DERIVE** (`derive_broker_dailies`; the combiner re-examines the venue inputs
     and stamps the verdict it can still justify).
   - **4 keyless CSV** (`api_key_id IS NULL`, non-composite) → **RE-RUN `compute_analytics_from_csv`**,
     whose `run_csv_strategy_analytics` pass stamps `user_supplied`. ⚠️ **This is the remedy that is
     easy to omit and it covers the LARGEST group.** No derive job ever runs for a keyless
     non-composite and no stitch exists for it, so a note saying only "re-derive or re-stitch" hands
     the founder an *impossible instruction* for 4 of the 6.
   - **1 composite** → **RE-STITCH** (`run_stitch_composite_job` stamps `composite_stitched`).
   - **0 published composites** — the composite regression `composite_stitched` exists to prevent has
     **no live victims** today.
   The population **self-heals**: the gate runs at exactly two moments (wizard `SyncPreviewStep`,
   admin approve), so a NULL verdict cannot un-publish anything already live; it only refuses the
   next preview until the series is re-produced. ⛔ **A backfill `UPDATE` is forbidden** — it would
   fabricate a trust claim about series whose inputs were never examined and, for some, no longer
   exist. That is the exact lie the verdict column was added to make impossible.
10. **`DEF-142.2-10` — Vercel tooling recommends Workflow DevKit on both wizard connect routes;
    DECLINED, with the reasoning that must survive.** (Was `DEF-142.2-07-A` in the phase's
    `deferred-items.md`.) The repo's Vercel plugin hook fires on every edit to
    `create-with-key/route.ts` (~`:270`, the post-validation seam) and its `composite/add-key`
    mirror, recommending durable execution for the seam's retry handling. **Not applied, and the
    reason is a threat-model question rather than a taste call: these are the two SECRET-BEARING
    routes** — raw `api_key` / `api_secret` / `passphrase` arrive in the request body — so moving
    them onto a durable-execution substrate puts live credentials across a **new persistence
    boundary**. Second reason: both routes spend two seam budgets back to back (`validate-key`, then
    `encrypt-key`) under `maxDuration = 300`, and the 140-series work built a deliberate
    circuit-breaker + classification posture around that seam (`SERVICE_UNAVAILABLE_RETRY`,
    `SERVICE_UNREACHABLE`, `SEAM_MISCONFIGURED`) that a large body of route tests pins. Any move
    must preserve that classification contract. **Disposition:** evaluate as its own phase with a
    threat model, or reject explicitly and silence the hook on these two paths so it stops
    recommending a change the security posture does not want.
11. **`DEF-142.2-11` — `EquityChart.tsx:1119` `react-hooks/exhaustive-deps` warning
    (`useMemo` missing dep `period`).** Pre-existing, untouched by 142.2, recorded by plans 02, 06
    and 07 as the sole output of `npm run lint` (0 errors, 1 warning). Batch it with the next edit to
    that file.
15. **`DEF-142.2-15` — the six code-review findings deferred by founder scope call (2026-08-04).**
    All six cleared the *stopping rule* bar (none user-facing, none data-integrity), which is why
    they were not fixed alongside the four that were. Recorded here so the deferral is a decision
    with a record, not an omission. Batch them with the next edit to each file:
    - **(a) `analytics_runner.py:1564` — `_stamp_user_supplied` infers "not broker-sourced" from a
      null `api_key_id`, which `ON DELETE SET NULL` also produces.** Delete an API key, and a later
      recompute stamps `user_supplied` on a series that was actually broker-derived — overstating
      how the numbers were obtained. Needs a structural check, not a null test.
    - **(b) `broker_dailies.py:524` — `nav_gap_days` reindexes over the FULL span,** so leading and
      trailing gaps count the same as interior holes. An sFOX account whose NAV history simply
      starts later than the requested span is stamped `sampled_gapped` with no interior holes, and
      is refused. Should count interior-only.
    - **(c) `analytics_runner.py:1500` — the composite exclusion rests on the `existing_flags`
      `'composite'` marker, not structural identity.** If that flag is ever cleared or rebuilt
      without the key, a composite recompute stamps `user_supplied` and erases the
      machine-stitched-vs-human-uploaded distinction.
    - **(e) `broker_dailies.py:91` — only ONE of the three producer paths validates its stamp
      against `SERIES_COMPLETENESS_VALUES`.** The other two can emit an unregistered string. Drift
      direction is fail-closed (an unrecognised verdict refuses), so this is a missing loud signal
      at the producer, not a live money bug.
    - **(f) `broker_dailies.py:91` + `strategyGate.ts` — the verdict list is hand-maintained in
      BOTH Python and TypeScript.** ⚠️ **Do not "fix" this by importing one from the other** — the
      duplication is deliberate (producer set vs admissibility policy) and documented in the
      migration comment. The hygiene item is drift *detection*, not de-duplication.

⚠️ **Cross-reference, do NOT duplicate:** the anon-readable `strategy_analytics` splat that plan
04's A2 check re-confirmed (`anon` holds `SELECT` on `series_completeness`, as it does on every
column of that table) is already booked above under § Security — *"`strategy_analytics (*)` splats
every analytics column to anon on two public paths"* (commit `d935fa61`). The new column adds no
new exposure class: it is an enum carrying no magnitude, and protecting one column while the splat
stands would secure nothing.

### v1.16 milestone human-audit QA sweep — authed-browser + PROD probes (added 2026-08-03)

Run via /qa over the open GSD human-verification items of phases 140→142.1 against live PROD
(authed browser as `qa-demo@quantalyze.app` + read-only Supabase/Upstash probes). Discharged that
day: D-19 PROD cron body (see ✅ on the 142.1 item 6 above), PROD stuck-`computing` census = 0,
TEST reaper cron registered/active, 140.1 index shape on PROD correct
(`strategy_verifications_strategy_wizard_session_uniq` present, old index gone), 141.2 audit
numbers re-confirmed (42/42/0 `wizard:`-prefix; resync 20/42; five breaker keys still ABSENT),
wizard AUTH_FAILED arm renders named+actionable copy with Retry/Diagnostics and clean diagnostics
(`code` + `correlation_id` only, no internals), teaser `/api/verify-strategy` rejection envelope
carries `human_message` end-to-end and the TS-17 client fix (`human_message` read first) is live.
New findings, none clearing the founder blast-radius bar as blocking:

5. **Validation-rejected keys leave no audit trail (observation, decide-only).** A failed wizard
   key validation (AUTH_FAILED) writes no `audit_log` `process_key` row — audit starts only when
   a key enters processing. Consistent with current design; recorded so the 141.2 audit censuses
   are read correctly (they count processed flows, not attempts). No action unless rejected-attempt
   telemetry is wanted beyond Sentry.

### Phase 147 (SCEN-01) class-closure audit — `getPortfolioStrategies` consumers (added 2026-08-05)

Phase 147 fixed FOUR readers that selected only `strategy_analytics.daily_returns` and therefore
saw `null` for every API-ingested strategy (whose track lives in `returns_series` as a cumprod
wealth index). Plan 147-06 T3 ran the class-closure audit over `getPortfolioStrategies` — the
query already selects BOTH columns (`queries.ts:1305`), but a *consumer* reading only
`daily_returns` would still strand the series. **Grep, log, do not fix** (orchestrator ruling —
these are outside the phase's locked scope).

**Audit result: 0 bare consumers.** Commands run against `HEAD`:

```
grep -rn --include="*.ts" --include="*.tsx" "getPortfolioStrategies" src/ | grep -v "\.test\."
  → 3 consumers: portfolios/[id]/page.tsx, .../manage/page.tsx, .../documents/page.tsx
grep -n "daily_returns\|returns_series" <each consumer>
  → zero `daily_returns` reads in all three
```

None of the three touches `daily_returns` at all — they read the scalar metrics
(`cagr`/`sharpe`/`max_drawdown`/`sparkline_returns`) via `extractAnalytics`. The bare-reader class
is closed there. Two adjacent findings were surfaced by the audit and are booked, not fixed:

2. **`DEF-147-B` — two dead `daily_returns?: unknown` type annotations promise a column the query
   never selects.** `src/lib/queries.ts:420` (`getPublicStrategyDetail`) and `:458`
   (`getFactsheetDetail`) both annotate their `.single<…>()` generic with
   `strategy_analytics: { daily_returns?: unknown; … }`, but both selects use
   `PUBLIC_ANALYTICS_COLUMNS` (`queries.ts:290`), which contains **neither** `daily_returns` **nor**
   `returns_series`. No consumer reads the field today (`browse/[slug]/[strategyId]/page.tsx`,
   `strategy/[id]/page.tsx`, `factsheet/[id]/tearsheet/page.tsx` — checked, zero hits), so nothing
   is broken. It is a latent trap: the type invites a future reader to consume a field that is
   always `undefined`, which is exactly how the four Phase-147 readers came to render `[]`.
   **Fix shape:** delete the `daily_returns?: unknown` member from both generics (type-only, no
   behaviour change). The Phase 147 grep-gate does **not** flag this — by design, it targets select
   payloads, not type annotations, because a scan wide enough to catch this would redden on prose.

3. **`DEF-147-C` — `queries.my-allocation.test.ts` mock returns fixtures wholesale instead of
   projecting to selected columns.** The mock (`:267-272`) records the select string but hands back
   the full fixture regardless, so narrowing the `getMyAllocationDashboard` embed back to bare
   `daily_returns` would NOT redden that behavioural file (unlike `returns/route.test.ts:296-308`,
   which projects as PostgREST does). Not a phase gap: the 147-04 SC-1 ledger mutation targeted the
   resolver-call argument (falsifiable in that harness), and the select-width regression is held by
   the phase-147 gate's Layer B (verifier confirmed RED under exactly that mutation). Test hygiene
   only (2026-08-05, booked from 147-VERIFICATION.md).
   **Fix shape:** make the mock's `maybeSingle`/embed resolution project to the columns named in the
   recorded select string, mirroring the returns-route harness.

### Phase 148 (OWN) — factsheet v2 payload cache is id-only-keyed (added 2026-08-05)

**`DEF-148-A` — a fresh `strategy_analytics.computed_at` does NOT bust the factsheet v2
payload cache, so the factsheet can serve metrics up to 3600s stale.** The page's header
comment claimed the opposite until phase 148 corrected it; the *behaviour* is unchanged and
deliberately NOT fixed here.

Mechanics. `src/app/factsheet/[id]/v2/page.tsx` passes `` `${id}::${computedAt}` `` into
`buildFactsheetPayloadCached`, which splits at `"::"` and **discards everything after the id**
(`page.tsx:229` pre-148 numbering — the `const [id] = cacheKey.split("::")` line). What actually
keys the entry is Next's own derivation
(`node_modules/next/dist/server/web/spec-extension/unstable-cache.js:55,82`):
`fixedKey = ${cb.toString()}-${keyParts.join(',')}`, then
`invocationKey = ${fixedKey}-${JSON.stringify(args)}`. Here `cb.toString()` is constant source
text, `keyParts` is `["factsheet-v2-payload-v6", id]`, and `args` is `[]` because the returned
function is invoked with no arguments. **Effective key: id only.** `computed_at` never
participates.

Existing mitigations (why this does not clear the founder's blast-radius bar):
- `revalidate: 3600` is a hard 1h staleness ceiling.
- `revalidateTag(\`factsheet-v2:${id}\`, "max")` at
  `src/app/api/admin/strategy-review/route.ts:501` busts the entry on the admin publish/review
  flow — the only writer, and the only transition where a stale payload would be user-visible
  as *wrong* rather than merely *late*.

This is **staleness, not user-facing incorrectness and not data integrity**, so per the founder
stopping rule it is logged, not fixed (phase 148 orchestrator ruling; RESEARCH §3a consequence 3).
**Fix shape if it is ever taken:** make `computed_at` a real `keyParts` member (and update the
`factsheet-v2-payload-v6` bump ledger + the admin revalidator together) — do **not** try to encode
it in the `cacheKey` string, which is exactly the mechanism that already fails.

⛔ **Load-bearing corollary, do not lose:** because the key is id-only, appending a suffix to the
`cacheKey` string yields the *same* entry. Any attempt at viewer/lane separation via that string
would write a viewer-dependent payload into the shared entry and serve it to anonymous readers
for the full TTL. This is why phase 148's owner lane bypasses the cached wrapper entirely rather
than "giving the owner lane its own cache key".

### Phase 148 (OWN-04) — two in-wizard link-style divergences from the UI-SPEC treatment (added 2026-08-05)

**`DEF-148-B` — the two pre-existing `target="_blank"` links in the wizard tree do not match the
now-authoritative link treatment shipped by OWN-04.** Logged only; deliberately **NOT** fixed in
phase 148 (out of the task's blast radius — Rule 3 / phase-148 orchestrator ruling).

The OWN-04 link (`SyncPreviewStep.tsx`, `ViewFullFactsheetLink`) follows 148-UI-SPEC:122/126:
`underline underline-offset-4` (persistent) + `rel="noopener noreferrer"`. Two older siblings
diverge, each in a different way:

| File:line | Divergence | Why the UI-SPEC treatment is the correct one |
|-----------|-----------|----------------------------------------------|
| `src/app/(dashboard)/strategies/new/wizard/WizardChrome.tsx:257` | `className="text-accent underline-offset-4 hover:underline"` — underline appears on **hover only** | It is an inline link inside body prose (`<p className="text-caption text-text-muted">Wizard help · …`), distinguished from the surrounding text by the accent teal ALONE until hover. That is the exact `link-in-text-block` shape DESIGN.md's 2026-06-28 decision ruled a WCAG 1.4.1 failure and remediated on `/security`; this instance was not swept in. |
| `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:662` | `rel="noopener"` — no `noreferrer` | `noopener` alone closes the reverse-tabnabbing hole but still leaks the full wizard URL (including the draft strategy id path) as `Referer` to `/security`. Same-origin here, so the exposure is low — which is why this is logged, not escalated. |

Fix shape if taken: one sweep, both files, plus a check for any third instance
(`grep -rn 'hover:underline' src/app/(dashboard)/strategies/new/wizard/` and
`grep -rn 'rel="noopener"' src`) — a point-fix of these two would leave the class open.
⚠️ Scope caveat: DESIGN.md's persistent-underline rule applies to **body-prose links only**; nav
links, button-styled links, and card links keep their existing hover treatment, so a blanket
`hover:underline` purge would be wrong.

### Phase 149 (NAV-01, `/my-strategies`) — deferred items (added 2026-08-05)

All three were routed out of phase 149 by ruling, not by omission. None is user-blocking: the
surface ships fully functional with each of them open.

**`DEF-149-B` — two live surfaces now render an `h1` reading "My Strategies".**
The manager surface `/strategies` and the allocator surface `/my-strategies` share the title. This
is **benign at runtime** — they are role-disjoint (the allocator never sees `/strategies`, gated by
`requireRolePage`) and the sidebar entries differ. It is a TEST-AUTHORING landmine (research
Pitfall 10): any future unit/e2e selector written as a bare `getByRole("heading", { name: /my
strategies/i })` or `page.getByText("My Strategies")` can silently bind to the wrong surface and
still pass. **Convention going forward (not a code change):** scope every selector for either
surface by route, `href`, or `data-testid` — never by bare heading text. The phase-149 Sidebar
cases already do this (`a[href="/my-strategies"]`).

**`DEF-149-C` — `StrategyGrid` card links dead-end for any FUTURE owner-scoped grid consumer.**
`StrategyGrid.tsx:52-53` builds `${basePath}/${categorySlug}/${s.id}`, which resolves through
`getStrategyDetail` (`queries.ts:776`) → `withPublishedOnly` (`queries.ts:833`) → `notFound()`. For an own
unpublished row that is both a dead end and an existence oracle. Phase 149 resolved it by making
grid **unreachable** on the owner surface instead — the `effectiveViewMode` derivation forces
`"table"` and `showViewToggle` hides the toggle (founder ruling; RESEARCH had recommended the prop
instead). Both halves are pinned (gate pin 7 + `StrategyTable.visibility.test.tsx`). **The debt is
latent, not live:** it becomes real the moment any surface passes
`visibility="owner-all-statuses"` *and* wants grid view. **Fix shape then:** a `rowLinkMode` prop
(`"category-detail" | "factsheet"`) threaded from `StrategyTable` into `StrategyGrid`, defaulting
to today's category-detail form, plus a `StrategyGrid.test.tsx` case pinning the `/factsheet/{id}`
href under the owner mode. Note the grid carries a second owner-surface problem that the
toggle-hide also defers: `StrategyGrid.tsx:79-82` renders `VerifiedBadge` with
`trustTier={s.trust_tier}`, which is null by construction for an unpublished row.

### Phase 162 (HONEST) — plan 162-08 filings (added 2026-08-26)

Five items. Two are live data left unrepaired because plan 162-08 could not reach the PROD
write lane; one is a founder scope call; two are hygiene. Evidence for all five:
`.planning/phases/162-honest-what-the-user-sees-is-true/162-CENSUS.md` (§Recompute — NOT
EXECUTED, §str/None follow-through, §Discovery observation).

- [x] **`D-162-1` CLOSED 2026-08-26 BY DELETION — the 15 rows no longer exist.** ⚠️ Everything
      below this line is the SUPERSEDED record of the state before the deletion; it is kept for
      the reasoning, not as current fact. Recompute was measured IMPOSSIBLE (`csv_daily_returns`
      held 0 rows for all 15 while the handler needs >=2), so on founder instruction the rows
      were unpublished AND deleted from PROD, verified: 0 examples remain. Cascades took 1470
      match_candidates, 29 portfolio memberships, 5 favourites, 3 contact_requests; 28
      allocation_events and 3 match_decisions were cleared first as FK blockers. Full backup
      held outside the repo. Found stale by the phase-162 verifier — this filing still said
      "still published" after the rows were gone.

  <details><summary>Superseded pre-deletion record</summary>

  **`D-162-1` NOT EXECUTED — all 15 published example rows are still `failed` and still
      published.** `51a111ed-0000-4000-8000-0000000000{01..15}`, `computation_status = failed`
      since **2026-05-27**, series ending April 2026. **0 recomputed, 0 unpublished, 0
      touched.** Plan 162-08's Task 1 could not run: the service-role credential read is denied
      by the harness permission classifier (outbound network and plain file reads are *not*
      denied — the block is specifically on reading the secret; three lanes tried, all denied,
      isolation recorded in the census). ⚠️ **The badge fix does not cover this.** 162-03's
      guard means those rows render no *Synced* badge; the rows themselves remain published
      advertising a three-month-dead computation with em-dashes where KPIs belong. **Resuming
      is a lookup, not a re-derivation** — the census records the selected mechanism
      (`compute_analytics_from_csv` via `_enqueue_compute_job_internal`, service-role, with
      every claim cited to its definition at HEAD) plus the ONE unmeasured precondition that
      decides the outcome: whether those 15 strategies have ≥ 2 rows each in
      `csv_daily_returns` (a *different* table from the `strategy_analytics.daily_returns` the
      census confirmed). If they do not, `run_csv_strategy_analytics` fails with "Insufficient
      CSV history" and D-162-1's fence fires for all 15 → unpublish, and say so.

  </details>

- [ ] **Two `strategy_analytics` rows still render raw exception prose, and their only
      re-write path is a dead job kind.** `ec722557-7781-44db-8f2c-edbe252957c0`
      (`pending_review`) and `8581f739-1a7b-42a4-a209-3acfa327e259` (**published**) each carry
      the bare 59-character `str`/`None` `TypeError` text in `computation_error`. Plan 162-02
      fixed the *writer*, so no NEW row can leak this shape — but it cannot rewrite these two,
      and plan 162-08's repair enqueue was blocked by the same credential denial above.
      Disposition recorded as *awaiting-next-write*, with the caveat that makes it nearly
      permanent: their only failing kind, `poll_positions`, has not been enqueued anywhere in
      PROD since **2026-06-14**, so there may be no next write. The published one is a live
      surface.
- [ ] **Retired job kinds still carry a live daily enqueue that has fired nothing since
      2026-06-14 — dead code, low priority.** `enqueue_poll_positions_for_all_strategies`
      exists at HEAD (`analytics-service/main_worker.py:1026-1036`) but no `poll_positions` job
      has been created in PROD since 2026-06-14. Same family: `compute_analytics` is *retired*
      (30 PROD rows, 100% `failed_final`, **zero successes ever**), superseded by
      `compute_analytics_from_csv` + `derive_broker_dailies`; its enqueue RPC actively rejects
      the kind (`20260716090000_retire_compute_analytics_kind_rpc_guard.sql`). ⛔ **File this
      as dead code, NEVER as an outage.** ⚠️ Load-bearing consequence, already actioned in the
      census: any decision rule keyed on "0 `compute_analytics` jobs since X" is **VOID** — it
      fires for the entire fleet, every day. One such rule shipped as the derive-gap trigger in
      the HONEST-02 decision table; the correction is now recorded in 162-CENSUS.md itself, not
      only in a sibling SUMMARY.
- [ ] **`StrategyGrid`'s sync-badge gate is one half short of the table's — guard hygiene, NOT
      user-facing.** Table: `mayClaimSyncRecency = hasComputedAnalytics && !s.is_example`
      (`StrategyTable.tsx:982-983`). Grid: `{!s.is_example && (`
      (`StrategyGrid.tsx:117`) — it has the `is_example` half and lacks the
      `hasComputedAnalytics` half. ⚠️ **Two earlier framings of this item are wrong and should
      not be carried forward.** (a) A WINDOWS.md deferral called the grid badge
      "consumer-less" — **false**: `StrategyTable.tsx:1421` renders `StrategyGrid`, and by
      founder ruling (`StrategyTable.tsx:387-398`) grid is **discovery-only**, i.e. exactly the
      public surface HONEST-03 names. (b) A later handoff said the grid badge is *ungated* —
      also false at HEAD: 162-03 landed the `is_example` half. Re-measured 2026-08-26 on the
      assembled phase branch. **Why it is nonetheless not user-visible, which is what sets the
      severity:** discovery rows pass `shapeRowAnalytics` (`queries.ts:470-474`), whose
      non-terminal-success branch returns `{...EMPTY_ANALYTICS, computation_status}` with
      `computed_at: ""` (`utils.ts:181`), so a failed/pending/computing row reaches the grid
      badge with a falsy date and renders nothing. **Guard-hygiene / defence-in-depth asymmetry
      → mid-term, not blocking**, per the founder stopping rule. ⛔ It is *not* dead code and
      *not* unreachable — deleting it on either premise would be wrong. The table's own comment
      (`StrategyTable.tsx:1149-1156`) states the client guard is kept "as well as, not instead
      of" the server blanking, because the component is mounted by three pages, one anonymous,
      "and it must not be capable of printing a sync date it cannot justify no matter who hands
      it rows." The grid is one row-source change away from printing one. **Fix shape:** extend
      the grid gate to `hasComputedAnalytics && !s.is_example` (or lift the single predicate
      into a shared helper both render paths import) and add a grid case for a `failed` row
      carrying a fresh `computed_at` — no such case exists today, so the missing half is
      currently unpinned on the grid side.
- [x] **✅ RULED + FIXED IN CODE 2026-08-26 (recorded here 2026-08-28) — the badge itself stopped
      reading FRESH; the adjacent-line-only option was NOT taken.** `SyncBadge` now derives from
      `resolveEffectiveRecency(computedAt, seriesEnd)` (`SyncBadge.tsx:99`, `src/lib/freshness.ts`),
      i.e. the STALER OF THE TWO clocks, and renders `Track record ends {when}` when the series is
      the binding one (`:113`, `:135`). `HONEST-02` is `- [x]` / `Complete` in REQUIREMENTS (:63, :208).
      Pinned by `FactsheetView.chip-honesty.test.tsx` and `SyncBadge.staler-of-two.test.tsx`, both
      written to name the EXACT label and tone token per input rather than asserting the absence of
      the word "fresh" — the vacuous shape that let the bug ship in the first place. Everything below
      this line is the SUPERSEDED pre-ruling record, kept for the reasoning.
      <details><summary>Superseded pre-ruling record</summary>

**FOUNDER CALL — is `HONEST-02` satisfied by an adjacent honest line, or must the badge
      itself stop reading FRESH?** Requirement: *"the factsheet freshness **badge** reflects
      series recency — a strategy whose return series ended 89 days ago cannot read FRESH."*
      Plan 162-07 shipped D-162-2's recency line ("Track record through {date}", keyed on the
      series' last point). D-162-2 **deliberately** left `FreshnessChip` computing from
      `computed_at`, so after this phase the surface states the series end while the badge
      beside it can still read FRESH over a 111-day-dead track. The badge still makes a false
      claim in isolation — user-facing by the stopping rule — but D-162-2 was a founder
      decision, so the scope call is the founder's. **The checkbox stays OPEN; do not tick
      HONEST-02 at phase close without a ruling.**
</details>

- [x] **✅ RULED 2026-08-26 BY SPLIT (recorded here 2026-08-28) — neither closed-as-inconclusive nor
      left blocking.** Commit `578ad5f3` ("split HONEST-01, close HONEST-03 by deletion of the example
      cohort") separated the conjunction: the delivered half (leaked text curated at the write
      boundary) closes as `HONEST-01`, now `- [x]` / `Complete` in REQUIREMENTS (:50, :205); the
      inconclusive half became its OWN requirement, `HONEST-07` (:51), which remains `- [ ]` and
      carries the pinned search key forward. So the answer to the question as posed is: a
      permanently-inconclusive root cause does NOT close a requirement — it gets its own, and stays
      open there, instead of being absorbed into a tick. No regression test was minted for a compare
      never shown to be the raiser. Everything below this line is the SUPERSEDED pre-ruling record.
      <details><summary>Superseded pre-ruling record</summary>

**FOUNDER CALL — may a permanently-inconclusive root cause close `HONEST-01`?** The
      requirement is a conjunction: the leaked text mapped at the writer, **with** the
      underlying `str`/`None` compare root-caused. First half delivered (162-02). Second half
      is `inconclusive` **as a decided verdict, not as unfinished work**: stage
      (`poll_positions`), window (2026-06-10 … 06-14) and population (exactly 2 strategies, one
      shared 59-char message) are pinned, but no `str`/`None` compare exists on the handler
      path at HEAD, no traceback survives (`str(exc)[:500]`, no frames), and Sentry is
      orchestrator-only. No code fix is planned — guarding a compare not shown to be the raiser
      would mint a regression test pinning a fiction. **The checkbox stays OPEN.** If reopened
      with Sentry, the search key is exact: kind `poll_positions`, 2026-06-10 … 2026-06-14, two
      strategy ids. ⚠️ The kind has been silent fleet-wide since 2026-06-14, so absence of
      recurrence is **not** evidence of a fix.
</details>

- [ ] **`.planning/WINDOWS.md` loses entries under concurrent appends — measured, with data
      already lost once.** `gsd-tools windows append` does read-modify-write over the whole
      file, so parallel wave agents clobber each other. Observed on 2026-08-26: at commit
      `e6c70ca79` the rendered table carried **three** rows numbered `id 16` while the JSON
      block — the source of truth the table is regenerated from — carried only **one**. The
      other two (162-03's `StrategyGrid` entry, 162-04's `ScenarioComposer` entry) had already
      been dropped from JSON by an earlier race and survived only as orphaned table rows; the
      next append regenerated the table and erased them entirely. Both were re-added by 162-08
      as ids 19 and 20, with their original `recorded_at` preserved in the description text —
      so nothing is lost *now*, but the mechanism is live and will bite again on the next
      parallel wave. ⚠️ Duplicate ids are the detectable symptom: `grep -o '"id": [0-9]*'
      .planning/WINDOWS.md | sort -n | uniq -d` should be empty, and the JSON entry count
      should equal the table row count. **Fix shape:** make the append atomic (lock file, or
      `O_EXCL` temp + rename with a re-read/retry loop), and derive the next id from the JSON
      max rather than a cached count. Upstream in the GSD toolchain, not this repo's source —
      but the corrupted artifact is tracked here.

---

## ⚪ DON'T FIX — cosmetic, stale, superseded, speculative, or unsound

- **"Do NOT implement" landmines (keep documented, do not touch):** bridge-scoring precompute;
  optimizer per-candidate `pd.concat` rewrite; `position_reconstruction` OFFSET→keyset /
  page-size raise (data-loss); `funding_fees.raw_data` JSONB retention delete (corrupts funding
  P&L).
- **Cosmetic / a11y (batch only if touching the file):** focus-ring clipping under
  `overflow-x-auto` (WCAG 2.4.7); `ResponsiveTable` migration of bare tables; STRATEGY_PALETTE
  colorblind/WCAG audit; correlation-heatmap palette; EquityChart polish (baseline line,
  legend, period buttons, current-return summary, stale timestamp); wizard mobile responsive;
  eval-dashboard empty-state copy.
- **Speculative product/demo ideas:** Moments 1–3 narrative cards, demo-persona scaffolding,
  custom benchmark, ML/collaborative optimizer, white-label portal, orgs/teams, dark mode,
  realtime WebSocket refresh.
- **Stale / superseded / in-prod-without-issue:** DOGFOODING Deribit reconstruction (subsumed
  by v1.11 STITCH); tech-debt Round-1 (superseded by Round-2); the 13-week-old UAT handoff
  backfill; ADVERSARIAL EquityChart notes; Round-1 LOW backlog (`getPercentiles` O(n²),
  `formatCurrency` sub-$1, native `alert()`/`confirm()`, inline SVG icons); teaser-series
  persistence + 106 janitor DDL (no active reader/trigger).
- **Safe as-is:** admin dual-gate (email vs `is_admin`) — safe while single-admin; Scenario
  coverage-window ADR open decisions (recompute-on-open / 0-fill gaps / renorm) — shipped
  defaults stand, revisit only if the sharing model changes.
- **No forcing function:** FastAPI / pandas / numpy version lag — upgrade only when a feature
  or advisory blocks.

## Phase 150 review — non-blocking findings (logged 2026-08-06, founder stopping rule)

- [ ] WR-03: guard-test case 7c auth.uid() occurrence-count runs over pg_get_functiondef incl. comments (4 comment hits ≥ 3 threshold) — vacuous as a live-DB control; vitest pin P4 already covers the invariant comment-stripped. Fix: strip comments in 7c or count against exact === 7 total occurrences. (.planning/phases/150-*/150-REVIEW.md)
- [x] ~~IN-01: three route docblocks still claim strategies_update has NO WITH CHECK~~ **CLOSED 2026-08-08** (/ship review round, D6): all three re-based onto 20260410225610_sec005_follow_ups.sql:102-106; the `.eq("user_id")` predicates kept and re-justified as defence-in-depth. — stale since 20260410225610; migration rev-3 corrected its own copy, routes didn't.
- [ ] IN-02: allocation route lacks the archived-status gate the marked-set query enforces (query-side filter only).
- [x] ~~IN-03: mid-request mark flip surfaces as 500/UNKNOWN~~ **CLOSED 2026-08-08** (/ship review round, E4-E6): allocation route maps 23514 -> 409 `not_allocatable`; AllocateDialog decodes it via the new `ALLOCATION_NOT_ALLOCATABLE` envelope and no longer offers a Retry the server will refuse forever. instead of the 409 arm (no row refresh) — race window only.
- [ ] IN-04: MarkOwnershipDialog "Keep own capital" stays clickable while destructive removal is in flight.
- [x] ~~(verifier INFO) finalize-wizard/route.ts:1339-1342 carries the same stale no-WITH-CHECK claim~~ **CLOSED 2026-08-08** with IN-01 (symbol-anchored there, since that file is on the SEAMPROSE-01 surface that bans bare file:line). as IN-01's route docblocks — fix together.
- [x] ~~(verifier INFO) MigrationWizard.tsx:72-76 surfaces raw psError.message~~ **CLOSED 2026-08-08** (/ship review round): both call sites now map to curated copy; driver text goes to console.error only. Copy also corrected so it no longer asserts a DB state the error object cannot prove, nor instructs a re-submit that would double-write the append-only `allocation_events` ledger. — give it the W-6 23514→honest-copy mapping AddToPortfolio got. Reachable only for an owner migrating their own unmarked published strategy.
- [ ] (WR-02 fix note) `bg-card` is a dead class — no `--color-card` token in globals.css @theme; 7 files repo-wide render transparent notice backgrounds. One cleanup pass wanted.
- [ ] (/code-review high, lens 3+5) The stale "strategies_update has NO WITH CHECK" claim also lives in src/app/api/strategies/finalize-wizard/route.test.ts:76-77 and :2996-2997, and ownership/name route docblocks — fix together with IN-01 using the migration rev-3 framing (defence-in-depth, cite 20260410225610).
- [ ] (/code-review high, lens 5) HoldingsTable.tsx D-15 comment cites StrategyTable.tsx:1067-1085; the precedent now lives at :1169-1179 — cite by phrase not line number.
- [x] ~~(/code-review high, lens 5, low-confidence) strategies-row-adapter.ts Half-2 comment~~ **RESOLVED 2026-08-08**: kept `manager: s.codename ?? null` and reworded the comment. Half 1 resolves `organization_name ?? codename ?? null` and an owner's own strategy has a null org, so half 1 lands on the codename too; dropping half 2 to null would make one strategy render "—" while unallocated and its codename once money sits behind it. Cross-half agreement now pinned by test. says "honest — rather than a fabricated manager" but code sets manager: s.codename ?? null — codename-present path renders own codename in the manager column and is untested; decide intended behavior and pin it.

### Phase 162 (HONEST) — post-deploy QA finding, ASSIGNED to Phase 163 (added 2026-08-26)

- [x] **`QA-162-01` / `HONEST-08` ✅ FIXED + VERIFIED ON PROD — the public discovery table advertised "Synced 7h ago" over a
      112-day-dead series.** Found by the post-deploy QA pass on quantalyze.xyz at v0.74.1.0.
      `/browse/crypto-sma` row #2 `Phoenix Protocol`: badge says **Synced 7h ago**, return series
      ends **2026-05-06** (112 days), and its own factsheet chip correctly says `Track record · old`.
      Row #1 `Momentum Sphinx` is the same shape at 7 days. **Two public surfaces contradict each
      other about the same strategy, and the lying one needs no login.**
      HONEST-02 fixed the factsheet chip. HONEST-03 scoped the badge fix to EXAMPLE rows only, so
      real published strategies were never covered — and with all 15 examples deleted from PROD the
      `is_example` gate now guards zero rows here.
      ROADMAP SC-2 states the rule as "a series dead 89 days cannot read FRESH". 112 > 89.
      **Owner: Phase 163, success criterion 6.** Fix = bucket on the staler of sync- and
      series-recency in `StrategyTable`/`StrategyGrid`, reusing `FreshnessChip`'s logic rather than
      reimplementing it. ⛔ Do not close by deleting the badge; ⛔ do not test via `is_example`.
      **Severity: HIGH** — public, unauthenticated, real (non-example) strategy, honesty claim.
      ✅ **FIXED + VERIFIED LIVE ON PROD 2026-08-26** (real browser, unauthenticated, v0.75.0.1).
      Both named rows now bind to the series arm and changed SUBJECT, not just wording:
      `Momentum Sphinx` → **"Track record ends 7d ago"**; `Phoenix Protocol` → **"Track record
      ends 112d ago"**. The contradiction with the factsheet chip is gone.
- [ ] **[HONEST-08-RESIDUAL] The over-binding direction is still unproven.** On the page above,
      BOTH visible rows legitimately bind to the series arm (7d → warm, 112d → stale, each
      strictly worse than its sync verdict), so the render cannot distinguish correct
      staler-of-two from **always binds to series**. `computeFreshness`'s own comment warns that
      "older date wins" would flip every row onto the track-record arm and delete the sync copy
      everywhere — which is the fix the founder ruled out. Prove the sync arm still renders,
      using a published row with a FRESH series. One exists (newest series end across PROD is
      1 day old) but is not on the `crypto-sma` cohort. **Routed to Phase 164.1.**

### Phase 162 (HONEST) — composite failure no longer names the offending member (added 2026-08-26)

- [ ] **On a composite onboarding failure the user is told the composite failed, but not WHICH
      member key caused it.** HONEST-01 / UI-SPEC C-2 removed the `computation_error` appendix
      from the wizard error envelope — correctly, because that column carried raw Python
      exception text and server-SCRUBBING is not curation. But that appendix was also the only
      thing naming the offending member ("… (deribit) failed to reconstruct: …"). The envelope
      now renders generic `GATE_ANALYTICS_FAILED` copy, so a user with a 3-key composite learns
      only that something failed.
      **This is the reader half of the gap Phase 164.2 already owns.** 164.2 covers the writer
      half (the status bridge overwrites the runner's curated sentence on both transition
      branches, so `computation_error_copy`'s output reaches no user). Even once the writer is
      fixed, THIS path still will not render it — the appendix is gone by design. The real fix
      is a curated, member-naming field in the envelope, not re-threading the column.
      **Do NOT close by re-threading `computation_error`** — that is precisely the regression
      HONEST-01 closed, and `e2e/composite-onboarding.spec.ts` now asserts its absence.
      **Found:** ship gate for v0.74.0.0 — `e2e-seeded` went red on the stale assertion, which
      is how the information loss surfaced at all.

### Phase 162 (HONEST) — ship-gate lint finding (added 2026-08-26)

- [ ] **`computationError` is write-only state in `SyncPreviewStep.tsx`, and two comments say
      otherwise.** Phase 162 / HONEST-01 deliberately stopped threading the raw computation-error
      text into the error envelope (`:1935` documents this — correct and intended). What was not
      cleaned up: the `useState` at `:578` is now never READ. `grep` finds four hits — the
      declaration, the setter at `:1015`, an unrelated same-named object property at `:1713`, and
      the comment. The gate reads the locally-passed `nextError`, **not** this state, so `:1935`'s
      "the gate reads it (`checkStrategyGate`, above)" and `:1013`'s "the failure line update[s]
      each tick" both overstate what is wired. ESLint surfaces it as the only `no-unused-vars`
      warning in the repo.
      **Fix:** delete the dead state and its setter, or keep it and correct both comments to say
      it is retained write-only. Prefer deletion — Rule 6. Check `SyncPreviewStep` tests first;
      removing the setter drops one re-render per poll tick when only the error text changes.
      **Not blocking:** nothing user-facing and no data-integrity exposure — the removal of the
      raw text from the envelope is exactly what HONEST-01 wanted. Filed per the stopping rule.
      **Found:** ship gate for v0.74.0.0 (`npm run lint`, 0 errors / 3 warnings).


### Phase 151 (AUM) — deferred by ruling from plan 151-04 (added 2026-08-07)

- [ ] **sFOX holdings: consider the `get_balance_history` `usd_value` NAV anchor instead of per-asset `get_balances`** — deferred from Phase 151, RESEARCH Open Q2. `_fetch_sfox_balance_rows` honours the CONTEXT lock on `get_balances()`, whose rows carry a STRING quantity and NO USD valuation, and whose facade has no ticker endpoint — so a non-stable asset is honestly SKIPPED and named rather than priced at an invented rate. `get_balance_history` returns a daily `usd_value` NAV series: an account-level USD anchor structurally identical to MT5's `account_info().equity`, which would value the whole book with no pricing problem at all. Switching is a CONTEXT amendment (a different method than the one locked), so it belongs to the sFOX go-live phase, not to 151. Until then a live sFOX key with non-stable holdings under-reports its AUM by exactly those assets — visibly, via the `complete_with_warnings` copy that names them.
- [ ] **Overview "your live book" baseline: consider a partial-blend baseline now that the composer shows a partial book** — deferred from Phase 151, RESEARCH Open Q6. The honest-empty baseline is arguably too conservative once a partial-coverage book renders in the composer; 151-05 deliberately left the Overview on the old gate. Revisit as a product call, with an explicit test of what the baseline shows when only some keys contribute.

### Phase 151 (AUM) — code-review Info findings, logged per stopping rule (added 2026-08-07)

- [ ] **IN-01** `_mt5_bounded_restart` logs a hardcoded `derive_broker_dailies:` prefix even when invoked from the holdings path (`mt5_concurrency.py:91-95`) — misleading ops log channel, cosmetic.
- [ ] **IN-02** A manual AUM cannot be cleared once set — `setManualAum(undefined)` has no production caller (`scenario-state.ts:818-832`). UX affordance decision (small ✕ / empty-string-clears), needs founder call on interaction.
- [ ] **IN-03** MT5 holding symbol truncates the key id to 8 chars (`ACCOUNT-{id[:8]}`) for no gain — full UUID satisfies the symbol regex and removes any birthday-collision thought (`allocator_positions.py:560`). ⚠️ Changing it AFTER first PROD write mints duplicate rows; decide before MT5_ENABLED flip or accept forever.
- [ ] **IN-04** Copy-leak test docstring claims broader scope than it checks (`test_allocator_positions_non_ccxt.py:261-288`) — align claim with the (now AST-widened) gate.
- [ ] **IN-05** `test_timeout_constants_survived_the_move` couples to env var defaults (`test_mt5_concurrency.py:166`) — derive expected from the same source, not a literal.
- [ ] **IN-06** Composer defensively `?? false`/`?? []` on payload fields the SSR layer declares required — pick one contract (six sites in ScenarioComposer.tsx).
- [ ] **IN-08** Role-discriminator degradation on a failed `strategy_keys`/`strategies` read re-admits manager keys as book constituents (`queries.ts:3868-3898`) — fail-open vs fail-closed decision; today's blast radius is the founder's own account only.
- [ ] **IN-09** `key={displayed}` remounts the dollar input on Enter, dropping focus (`ScenarioComposer.tsx:5804`) — keyboard-flow polish.
- [ ] **WR-08 residual** `MT5_ENABLED=false` does not stop the preflight's RPyC connect — `Mt5Client.__init__` opens the connection before the kill-switch is consulted; a true pre-connect gate changes disabled-path semantics of two job kinds, deferred deliberately.

### Phase 152 (SCEN composer legibility) — deferred residuals (added 2026-08-07)

- [ ] **Pitfall 6 — a stale persisted draft's factsheet link can 404.** The SCEN-03 row-detail panel emits `href="/factsheet/{id}"` for every added strategy. The link resolves under OWN-02's two-lane access control for the viewer's OWN strategies and for currently-PUBLISHED third-party ones — but a draft persisted weeks ago can still name a third-party strategy that has since been archived or deleted, and that link dead-ends on `notFound()`. Detecting it would require a per-row existence fetch, which Phase 152's CONTEXT explicitly locks out (the panel is an in-memory projection with no loading and no failure state by construction). Acceptance was scoped accordingly. Revisit if/when the composer gains a draft-reconciliation pass — the right fix is to prune or mark unresolvable rows at draft load, not to fetch per row at render.
- [ ] **D-1 residual — same-day own-row duplicates stay indistinguishable in Browse.** The SCEN-05 disambiguation line is `Created {Mon D, YYYY} · {Status}`; the key-count segment was omitted entirely (D-1) because `created_at` alone resolves the founder's real case (two "Alpha Centauri" rows 15 days apart) and a key count costs a second query on the browse path. Two own rows with the same name created on the SAME day therefore render identical lines. Revisit only if the founder treats key count as load-bearing for the choice — the amendment is a wire field plus a segment, not a redesign.

### Phase 152 (SCEN) — code-review Info findings, logged per stopping rule (added 2026-08-07)

- [ ] **IN-01** `isOwn` breaks the browse wire's snake_case convention (route emits snake_case elsewhere) — cosmetic wire-style inconsistency, rename = coordinated schema+client change, not worth it standalone.
- [ ] **IN-02** Five elements share `data-testid="scenario-added-header-label"` — fine for the count assertions today; per-label testids would make header tests sharper.
- [ ] **IN-03** Header labels sit ~8px right of the numbers they label (gap-2 offset accumulation) — visual polish; founder-eyes call.
- [ ] **IN-05** Dedup date renders in the viewer's local timezone — could show "Aug 3" for a UTC "Aug 4" creation; consider pinning UTC if it ever confuses.
- [ ] **IN-06** Detail panel repeats the provenance badge and pushes the row's own state notes below its hairline — layout polish for design-review.
- [ ] **IN-07** Row-wide pointer amplification collapses the panel on incidental clicks (e.g. selecting text in the row) — interaction polish; founder-eyes call.

### Phase 151/152 UAT fix round — deliberately deferred halves (added 2026-08-08)

- [x] ~~**F-3 wizard-UI half: render the `capital_ownership_persisted: false` sidecar.**~~ **CLOSED 2026-08-08** (/ship review round, E8): `SubmitStep.tsx` reads the flag with a strict `=== false` and renders a non-blocking `role="status"` notice naming the My Strategies remedy; because `onSubmitted` navigates, the id is held in state and `Continue` completes the hand-off. Two controls pin that an absent/true field renders nothing. The unified (manager) arm now emits the same sidecar, so one contract covers both arms. ORIGINAL ITEM: The finalize-wizard route now returns a non-error sidecar in its 200 body when the capital-mark UPDATE fails or matches no row (fixed 2026-08-08 — the server had Sentry'd it but reported plain success, so a user who answered "my own capital" silently got an unmarked, non-allocatable strategy and only discovered it days later as a missing `Allocate…` affordance). **Nothing consumes the flag yet.** `SubmitStep.tsx` reads the 200 body then calls `onSubmitted(data.strategy_id)`; surfacing the warning means threading a fourth piece of state through `onSubmitted` → `WizardClient` → the success screen, which is wizard restructuring beyond the "ship a warning string" bound the founder set for this round. Fix: thread the flag to the success screen and render one line — "We couldn't save your capital answer — set it from My Strategies" — pointing at the Mark dialog. The server half and its regression tests (failure arms + the omitted-on-success control) are already landed.
- [x] ~~**Bottom-up AUM cold start: the USD cell is not yet the entry point when AUM is UNSET.**~~ **CLOSED 2026-08-08** (/ship review round, finding [8]): the em-dash guard is now `(scenarioAum <= 0 && !bottomUpAum)`, so in blank mode the row renders a real input and the first amount typed becomes the portfolio. The em-dash stays correct in BOOK mode, where the figure genuinely cannot exist before custody answers. ORIGINAL ITEM: 151 UAT item 1 landed bottom-up edit semantics for blank mode (editing a row's dollars resizes the portfolio and holds the other rows' dollars fixed). But when `scenarioAum <= 0` the row still renders 151-UI-SPEC §2's honest em-dash + "Set portfolio AUM to size in dollars" and there is NO input to type into — so the "the USD input is THE entry point on which weight is built" framing only becomes live once an AUM exists by some other route. The arithmetic already handles the cold case correctly (all other dollars are 0, so AUM' = the typed amount); what is missing is an editable empty cell and its copy, which replaces a deliberately-designed, test-pinned honest-absence state. Needs a founder copy call for that cell before implementing.

### Phase 151/152 `/ship` review round — deferred residuals (added 2026-08-08)

Context: a `/code-review high` (32 agents) plus 7 specialists + 3 red-team passes produced
48 findings across three fix rounds. 23 CRITICAL and all warnings were fixed. What follows
is what was deliberately NOT fixed, with the reason. Two red-team rounds each found that a
previous round's *remedy* had created a new defect — so the items below were left alone on
purpose, not by omission.

**Founder calls (the first one is the significant one):**

- [ ] **⭐ `size_at_decision_usd` is recorded on a NOTIONAL basis while the composer sizes on an EQUITY basis.** The composer computes each row as `weight × scenarioAum`, where `scenarioAum` is now equity (Σ `holdingEquityContribution`, which uses `unrealized_pnl_usd` for derivatives). The commit route records `percent × serverAumUsd`, where that is Σ `value_usd` — notional. On a leveraged derivatives book the two diverge by roughly the leverage factor **on every row**, and `route.ts:~842` documents `size_at_decision_usd` as the denominator a downstream daily-delta cron divides realized PnL by. **The founder's own production book is Deribit, i.e. exactly this case.** Not changed because moving the sized figure is a money decision with a downstream consumer that may live outside this repo. The audit row now at least carries `client_manual_aum_usd` on every row plus a `server_aum_manual_conflict` sentinel, so the divergence is forensically visible rather than silent. **Decide before the next mandate commit on a derivatives book.**
- [ ] **No UI path removes a manual AUM override.** `setManualAum(undefined)` has no production caller. Once a manual Portfolio AUM is set, clearing the field and blurring re-displays the committed value — the draft still holds it. The refusal copy was corrected so it no longer *instructs* the impossible ("Clear the field instead to leave it unset" is gone), but the capability gap stands. The mechanism is available (`aumTouchedRef` separates a clear-to-revert from a bare blur on an empty field, proven by mutation), and a test is already positioned to go red the day it is built. Deferred because it is a behaviour change on a seam that produced three regressions in one session, in service of a LOW finding. Supersedes Phase-151 IN-02 with the mechanism now known.
- [ ] **HoldingsTable's Weight denominator lives only in a `title`.** `<StrategySortableHeader label="Weight" title="share of allocated capital" />` — hover-only, invisible on touch and to sighted keyboard users, inconsistently announced. The D-12-B denominator is stated nowhere else on the table (only inside the AllocateDialog modal). Fix is visible text (a second-line caption in the mono micro-label voice, or a table footnote) — a layout/taste call.
- [ ] **The Portfolio AUM form label uses the mono data-eyebrow voice.** DESIGN.md's typography section names this exact inversion as the failure mode ("the mono on a form label reads like a value"). Needs either a move to DM Sans medium or an explicit DESIGN.md amendment blessing mono on composer form labels.
- [ ] **The Portfolio AUM input is 12px type in a ~26px control.** iOS focus-zooms any input under 16px, and DESIGN.md wants ~44px touch targets; every shared input primitive carries `min-h-[44px]`. It matches the composer's existing dense number strip, so this is a class decision — either bump this field or record the dense strip as an accepted exception, noting it now covers a money entry point rather than only fine-tuning controls.

**Repo-wide sweeps:**

- [ ] **~20 files still use `focus-visible:ring-accent/20` or `/50` without `ring-inset`.** A 20%-alpha accent ring is ~1.3:1 against the surface, far under WCAG 1.4.11's 3:1 floor. Four surfaces were fixed this round (AllocateDialog's money input and its "Remove allocation" button, StrategyTable's ghost row actions, FactsheetView's masthead Rename). The rest remain: **`ui/Button.tsx:35` and `ui/Modal.tsx:33`** (shared primitives mounted by every dialog — the Modal close button is icon-only, so its ring is also its entire keyboard affordance), plus `ui/Input.tsx`, `ui/Select.tsx`, `ui/Textarea.tsx`, the `mandate/*` family, `ApiKeyForm.tsx`, `RenameStrategyDialog.tsx`, `MatchQueueIndex.tsx` and several wizard steps. Most have a border or background so the ring is not the sole affordance, but the 1.4.11 argument is identical. ⚠️ `AllocateDialog.test.tsx`'s focus sweep carves the two primitives out **by identity** and asserts the exempted set still carries `ring-accent/50` — so it goes RED the day they are fixed. That is the signal to delete the carve-out.
- [ ] **`job_worker.py:~7183`'s transient arm hardcodes `error_kind="transient"`** and never walks the `raise … from exc` chain, so a classification lost at a call site is unrecoverable by design. This round's fix prevents the specific downgrade (a geo-block being retried forever against a host that will never answer); it does not make that arm defensive.

**Smaller residuals:**

- [ ] A permanent DERIVATIVE-only failure discards the day's healthy spot rows, so Holdings shows the previous `asof` (stale, not wrong) under a "Sync failed" pill. Kept deliberately: restoring "permanent ⇒ partial success" needs a second hand-tuned axis, which is the exact mechanism that produced the regression being repaired — and it is wrong for Deribit, where spot is deferred so the derivative arm *is* the whole book.
- [ ] A partial-book commit can still trip `server_aum_manual_conflict`: the client narrows its AUM to the contributing keys' toggled-on holdings while the server sums the allocator's whole book. That is a key-SET difference, not a basis error (the basis was fixed); closing it needs the key set on the request.
- [ ] Two stale comments at `ScenarioComposer.tsx:~3806` and `~3943` enumerate a drawdown-USD-scaling consumer of `liveHoldingsSum` that was actually deleted in Phase 38-03.
- [ ] `phase-150-capital-ownership-invariant.test.ts`'s header docblock still says P2 pins "EXACTLY the sanctioned three" writers; the test now sanctions five (the CI demo seed was added).
- [ ] The geo-block's operator-actionable text ("move region or proxy") no longer reaches `api_keys.sync_error` — by design, since that column is end-user copy. It stays in `compute_jobs.last_error`, the audit metadata and the log/Sentry chain. Confirm that is where ops actually looks.

**Found at land time (2026-08-08), not by any review:**

- [ ] **⭐ Stale `file:line` citations live in SOURCE files too, and one class is invisible to any path-based guard.** Found 2026-08-08 while repairing the ledgers. Confirmed stale in shipped code: `src/lib/process-key-onboard-contract.ts:116` cites `process_key.py:680-690` (emitter is now :717-750); `analytics-service/routers/exchange.py:152` cites `wizardErrors.ts:936-1035` (`classifyKeyValidationError` is now :1927-2110); `analytics-service/docs/STATUS_CONTRACT.md:379` cites `routers/internal.py:442`/`:471` (now :488/:517). ⚠️ **The nastiest one is SELF-RELATIVE:** `analytics-service/services/broker_dailies.py:552`'s docstring cites `combine_native_ledger` **(:174)** when it is at **:268** — a coordinate pointing *inside its own file*, which no path-resolving checker would ever flag because there is no path to resolve. Any citation gate must therefore handle bare `:NNN` and same-file references, not just `path:NNN`.
- [ ] **`file:line` citations across `.planning/REQUIREMENTS.md` and `ROADMAP.md` rot silently, and nothing catches it.** ✅ **BOTH LEDGERS REPAIRED 2026-08-08** — ROADMAP: 50 audited / 38 renumbered / 8 anchored / 0 undeterminable. REQUIREMENTS: 91 audited / 60 renumbered / 29 anchored / 2 deliberately left (both are quotations of coordinates *inside another document*, pinned to named commits where the drift IS the argument). Verified: 101 requirement IDs + checkbox states byte-identical, headings identical, independent drift audit 0 problems. **The gate itself is still unbuilt** — that is what remains open below. Audited all **109** distinct code citations on 2026-08-08. Cheap tests found little (1 missing file — `extension.py:506` in ROADMAP.md; 0 out-of-range), because an out-of-range check is far too weak: a citation can be *in range* and still point at unrelated code, which is exactly what WIZFORM-02's `:345` did. A symbol-anchored content check found **~13 high-confidence drifts**, several large: `wizardErrors.ts:967 → classifyKeyValidationError` actually at **:1927** (+960), `allocator_positions.py:154 → _fetch_spot_rows` at **:418**, `ScenarioComposer.tsx:2180 → addedStrategyMetadataLookup` at **:2486**, `wizardErrors.ts:1728 → EXCHANGE_PROBE_FAILED` (symbol no longer in that file at all). **Only the WIZFORM-01..05 + MT5-14 citations were repaired** (phase 153 is about to consume them); the rest stand. ⚠️ **A bare filename is itself the bug in one case: `exchange.py` is ambiguous** — `routers/exchange.py` and `services/exchange.py` both exist and only `routers/` holds `_MT5_PROBE_TIMEOUT_S` / `_validate_mt5_key`. Two candidate fixes: (a) a CI gate that resolves every `path:line` in the ledgers and fails on drift — needs symbol anchoring to be meaningful, and generic anchors (`href`, `ValueError`, `UNKNOWN`, `idempotent`) must be excluded or it is pure noise; (b) drop line numbers from the ledgers entirely in favour of symbol names, which do not rot. Cost of leaving it: every planner and executor that trusts a citation walks to the wrong code, and the reader cannot tell a stale pointer from a correct one without re-deriving.

- [ ] **No gate catches an `e2e/` assertion whose copy no longer exists in `src/`.** Phase 150-03 renamed the MetadataStep heading and updated its own component test; two e2e specs kept waiting 15s for the dead string and only one of them reddened (the other is seed-gated and did not run). Ten specialist review passes, a red team, and 10,193 local tests all missed it, because the phase's own grep never left `src/`. A gate is buildable — extract literals from `getByRole(name:)` / `getByText` / `getByLabel` in `e2e/` and fail when one is absent from `src/` — but a naive version has ~6 false positives today (composed date ranges like `"2026-01-05 → 2026-01-09"`, seeded fixture names like `"E2E Test Key"`, and chart headings built at runtime), so it needs an allowlist to be useful rather than noisy. Same family as the v1.10 lesson that e2e grep-gates scan `src/` only.

### Phase 153.1-02 — deferred open questions from the venue-capability foundation (added 2026-08-09)

Both are explicitly OUT OF SCOPE for phase 153 (RESEARCH §Open Questions Q2 and Q5); logged here so the decision is visible rather than implied by a default.

- [ ] **Should sFOX also opt out of the submit-time scope probe?** `VENUE_CAPABILITIES.sfox` (`src/lib/closed-sets.ts`) asserts NO capability at all, so sFOX's submit path is byte-unchanged — that is D-22, pinned by `closed-sets.test.ts`'s *"sFOX asserts NO capability at all"* assertion. The question stands because sFOX asserts `read_only=True` **structurally** for the same reason MT5 does (`_validate_sfox_key`: the SfoxClient adapter has no order/withdraw/transfer surface, and sFOX exposes no per-key scope endpoint) — the same argument that earned MT5 `scopeProbeSupported: false`. What is unknown: whether the ccxt permissions probe currently *succeeds* for sFOX or has been silently failing on every sFOX submit. ⚠️ This is a SECURITY decision (the scope-broadening probe is ASVS V4) — do not flip it as a tidy-up; measure the probe's current behaviour against a live sFOX key first. Owner: unassigned. Reference: 153.1 D-22, RESEARCH Q2.
- [ ] **`Validating…` (U+2026) at `CsvUploadStep.tsx:751` is the odd one out.** The four other live sites use ASCII `Validating...` (`ConnectKeyStep.tsx:782`, `MultiKeyConnectStep.tsx:1637`, `ApiKeyForm.tsx:199`, `StrategyForm.tsx:356`), and ASCII is the **recorded superseding decision** (`MultiKeyConnectStep.test.tsx:19-21` states it supersedes the UI-SPEC's typographic form). D-21 settles the spelling; a repo-wide copy sweep to apply it is not in phase 153's scope. ⚠️ Before changing any of these strings, grep `e2e/` — `e2e/api-key-flow.spec.ts:212` matches on the prefix regex `/Validating/i` and survives either form, but that is luck, not a guarantee for the next one. Owner: unassigned. Reference: 153.1 D-21, RESEARCH Q5.

### Phase 153.4-03 (the long-wait card) — non-blocking findings, logged per the stopping rule (added 2026-08-10)

Both are recorded rather than fixed: neither is user-facing today and neither is a
data-integrity risk, so both sit below the founder stopping rule. Each is a conflict the
plan resolved by SURFACING it (Rule 7), not by blending.

- [ ] **`ui/Button.tsx:35` cannot be given a full-opacity focus ring by a caller.** It
  hard-codes `focus-visible:ring-2 focus-visible:ring-accent/50` on EVERY variant, and
  `cn` (`src/lib/utils.ts:72`) is a plain `filter(Boolean).join(" ")` — **not**
  tailwind-merge — so a `className` passed in does not override the baked-in utility; it
  merely appends a second, losing declaration. Consequence for this phase: the UI-SPEC
  specifies `Button variant="ghost" size="sm"` for `Stop waiting`, but forbidden item #9
  forbids a `/50` ring on a control this phase creates, so `ValidateWaitCard` renders a
  plain `<button type="button">` carrying the ghost look plus the verbatim focus
  contract. ⚠️ Fixing `Button.tsx` is a CROSS-SUITE change, not a one-line edit:
  `AllocateDialog.test.tsx`'s focus sweep carves `ui/Button.tsx` and `ui/Modal.tsx` out
  **by identity** and asserts they still carry `ring-accent/50`, so the fix reds an
  unrelated suite and the carve-out must be deleted in the same commit. Same item as the
  repo-wide `~20 files still use ring-accent/20 or /50` sweep above — this entry records
  the *mechanism* (plain-join `cn`) that makes the two primitives un-overridable rather
  than merely unfixed. Owner: the focus sweep.
- [ ] **The UI-SPEC's queue-disclosure sentence names `MetaTrader` literally while its
  render condition is the class-shaped `serialized` capability.** Copy (UI-SPEC Surface 1,
  40% rung, shipped verbatim in `ValidateWaitCard.tsx`): *"Still signing in. MetaTrader
  allows one sign-in at a time, so your check may be waiting behind another."* The gate is
  `venueIsSerialized(exchange)` — correctly a class check, so a second serialized venue
  would render this line automatically **and would read wrong**, naming a broker the user
  is not connected to. Not fixed here because the remedy is a copy decision, not a code
  one (`{VenueName} allows one sign-in at a time` loses the concrete, recognisable noun
  that makes the sentence land for the only venue that has it today), and the copy table
  is 153.1's. ⚠️ The trigger is not hypothetical-forever: it fires the day any second
  venue gets `VENUE_CAPABILITIES.<venue>.serialized = true`. Whoever adds that row owns
  this sentence. Owner: unassigned; reference 153.4-03, UI-SPEC Surface 1.

### Phase 153.4-04 (the connect step's honest wait) — non-blocking findings, logged per the stopping rule (added 2026-08-11)

- [ ] **`ui/Button.tsx` accepts no `ref`, so a caller cannot move focus to a shared
  button.** `ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>`, which carries
  no `ref`, and the component is a plain function — so `<Button ref={…}>` is a compile
  error (measured 2026-08-11: `TS2322: Property 'ref' does not exist on type
  'IntrinsicAttributes & ButtonProps'`). React 19 passes `ref` as an ordinary prop, so the
  fix is one optional prop spread through `...props`; the reason it was not taken here is
  the SAME cross-suite carve-out recorded in the 153.4-03 `Button.tsx` item above
  (`AllocateDialog.test.tsx` asserts that component by identity), plus this phase's
  UI-SPEC ⛔ on editing `Button.tsx`. Consequence today: `ConnectKeyStep`'s cancel path
  holds a ref on the submit ROW and queries `button[type="submit"]` inside it to restore
  focus — correct and asserted, but indirection a `ref` prop would delete. Bundle this
  with the focus-ring sweep; both edits land in the same file. Owner: the focus sweep.
- [ ] **`e2e/api-key-flow.spec.ts:41` expects 401 for an Origin-less POST and the route
  answers 403 — a pre-existing spec drift, not a regression.** Measured 2026-08-11 against
  a local dev server: `POST /api/keys/validate-and-encrypt` with no `Origin` header →
  **403**; the identical request WITH `Origin: http://localhost:3000` → **401**
  `{"error":"Unauthorized"}`, exactly what the spec asserts. `withAuth`
  (`src/lib/api/withAuth.ts:53`) runs `assertSameOrigin` BEFORE authenticating on every
  mutating method, so a Playwright `request`-fixture POST is refused as cross-origin
  before auth is ever consulted. Two cases fail on this (`…returns 401 for
  unauthenticated request`, `…rejects request with missing fields`). ⚠️ The remedy is to
  add an `Origin` header to those requests, NOT to relax the CSRF guard — and the same
  trap is already recorded for the verify-strategy probes. Found while running this
  phase's e2e gate; out of scope (no file this plan touches is involved). Owner:
  unassigned. Reference: 153.4-04 verification.

### Phase 153.4-05 (the composite step's honest wait) — non-blocking findings, logged per the stopping rule (added 2026-08-11)

- [x] ~~`MultiKeyConnectStep`'s `EXCHANGES` array has no MT5 card, so a serialized venue
  reaches a composite member panel only sideways~~ **CLOSED 2026-08-11** by the 153.4 review
  fix round (CR-03): the MT5 card and its four third-field overrides are in the composite
  roster, and a class guard compares both surfaces' rendered exchange cards with both flags
  ON. ⛔ This entry contradicted its own file for a day — the fix was recorded under
  *Tech-debt / maintainability* ("The two wizard connect surfaces keep TWO hand-maintained
  `EXCHANGES` rosters") while this one still called the defect "Reachable in production".
  ONE entry now: the tech-debt one, which carries the residual (the CLASS fix is a shared
  option table both steps import).
- [ ] **The composite step's `Loading your saved keys…` banner is the file's one remaining
  U+2026.** D-21 settles the busy label as ASCII and this plan added no new typographic
  ellipsis, but the rehydrate banner (a different surface, untouched here) still carries
  one — as does `CsvUploadStep.tsx:751`. Fold into the repo-wide ellipsis sweep already
  logged under 153.4-03. Owner: that sweep.

### Phase 153.4 code review — the findings the fix round consciously did NOT fix (added 2026-08-11)

⚠️ **Logged late, and that is the point.** The stopping rule blocks only on user-facing or
data-integrity defects; everything else gets **logged instead**. The 153.4 fix round closed
4 criticals + 2 warnings and then recorded the other eight findings nowhere — they survived
only in `.planning/phases/153.4-*/153.4-REVIEW.md`. The verifier escalated that as F-4. The
bargain has two halves; this section is the second one. Source: `153.4-REVIEW.md`.

- [x] ~~WR-04 — `ConnectKeyStep`'s 300 ms mount gate can fire AFTER the request finished~~
  **FIXED 2026-08-11.** The gate was a macrotask cleared only by the timer effect's cleanup,
  which React commits at its own priority, so a sub-300 ms answer could leave a ghost card
  frozen at `0s` whose `Stop waiting` aborted a ref the `finally` had already nulled. Was
  logged here as *user-facing* — the one of the eight that did not qualify for logging-only.
  The gate now self-guards on a `waitStartedAtRef`; the regression case drives the ordering
  and was observed to red without it.
- [ ] **WR-05 — `validatePanel` dereferences `panelsRef.current[idx]` with no guard**, while
  its neighbour `handleStopWaiting` opens with `if (!p) return;`. `panelsRef` lags state by
  one commit, so a click landing between a removal and the sync throws a `TypeError` out of
  an unawaited async callback. **Non-blocking:** a one-commit ref-sync window nobody has hit.
  ⭐ Wider than the review reported — `requestRemove` has the same unguarded shape, so fix the
  CLASS (every `panelsRef.current[idx]` read in this file), not the one line. Owner: unassigned.
- [ ] **IN-01 — the composite wait card mounts at ~1 s, the single-key one at exactly 300 ms.**
  The composite gate is `p.waitElapsedMs >= WAIT_CARD_MOUNT_DELAY_MS` and `waitElapsedMs` only
  moves on the 1 s tick. **Non-blocking:** it satisfies the property (never earlier than
  300 ms) and is deliberate, documented "please do not 'fix' it by adding one". Residual is a
  one-line note on the constant that it is a FLOOR at one surface and an exact delay at the
  other. Owner: unassigned.
- [ ] **IN-02 — the abort-grace assertion in `validate-budget.test.ts` is near-tautological**
  (both operands resolve to the same constant, so it restates `WAIT_ABORT_GRACE_MS > 0`).
  **Non-blocking:** the property that actually matters after CR-01 — the client deadline
  exceeds the ROUTE's 158 500 ms worst case — is now pinned separately in the same file, so
  the vacuous line is redundant rather than misleading. Delete it on the next pass through.
  Owner: unassigned.
- [ ] **IN-03 — a backward system-clock step renders a negative elapsed figure** in
  `ValidateWaitCard` (`Math.floor(elapsedMs / 1000)` over a `Date.now()` delta). **Non-blocking:**
  user-visible but requires an NTP correction or a laptop resume mid-wait. `Math.max(0, …)`
  costs nothing and keeps the card's one number honest under the Numbers Contract. Owner:
  unassigned.
- [x] ~~IN-04 — raising the tombstone widened `MAX_BREAKER_LOCK_SPAN_MS` from 90 s to 120 s~~
  **ADDRESSED 2026-08-11 by disclosure**, which is all it needed: the derived widening (and the
  matching loosening of the clock-skew tolerance from the 141.2 review) is now written into the
  tombstone docblock that otherwise enumerates what moves with the constant. Both consequences
  were already acceptable; only their absence from the notes was not.
- [ ] **IN-05 — `handleStopWaiting` can leave a stale `"user"` abort reason with no controller
  to consume it** (the reason is written before the optional `abort()` call, so pressing the
  control in a race with the `finally` records one for nothing). **Non-blocking:** provably
  unread — the next submit clears it. The composite step takes the stricter delete-per-attempt
  shape; matching it removes the question. Owner: unassigned.
### Phase 153.6 (PARITY) — infrastructure findings surfaced while shipping, logged per stopping rule (added 2026-08-12)

- [ ] **P156-IN-01 — the migration chain cannot be replayed from scratch locally** (`supabase start`
  / `supabase db reset` both die at `20260416125432_rebalance_drift_weekly_index.sql` with
  `CREATE INDEX CONCURRENTLY cannot be executed within a pipeline (SQLSTATE 25001)`;
  **15** migrations under `supabase/migrations/` use `CONCURRENTLY`). **Non-blocking:** CI
  applies SQL tests against the remote TEST project via `psql`, so nothing in the pipeline
  depends on a local replay. **Why it matters anyway:** a migration that auto-applies to PROD
  on merge currently has no from-zero rehearsal environment — the only pre-merge signal is the
  TEST apply against an already-migrated database, which cannot catch ordering/chain defects.
  Discovered 2026-08-11 while trying to certify phase 153.6's `20260811210000`. A fix would
  likely split CONCURRENTLY statements out of the pipelined path. Owner: unassigned.
- [ ] **P156-IN-02 — assertion 5's gate marker has no symmetric post-verify** in
  `20260811210000_api_keys_attested_venue.sql`. Assertion 5 (5a–5e) in
  `supabase/tests/test_api_keys_exchange_not_user_writable.sql` arms on the `20260811210000`
  substring in `api_keys.attested_venue`'s column comment. The migration post-verifies the
  *exchange* marker (check (d)) but has no symmetric check for this one, which gates strictly
  more. **Measured 2026-08-12 (round-3 audit):** dropping the substring COMMITS the migration
  and makes the whole 5a–5e family print `SKIP (5)` — a silent loss of the RPC-door coverage.
  **Non-blocking:** the file carries the marker today and all of 5a–5e were proven to run; the
  realistic way to lose it is a *future* migration re-stamping that comment, at which point
  this file's `$verify$` no longer runs, so a symmetric check would buy little. Guard hygiene.
  Owner: unassigned.

### Phase 154-02 (WIZCONT-01 plumbing) — residual recorded while single-sourcing the draft query (added 2026-08-12)

- [ ] **A THIRD latest-wizard-draft read still lives outside the helper** — `src/app/(dashboard)/strategies/page.tsx:41-49`
  issues the same `source='wizard' AND status='draft' ORDER BY created_at DESC LIMIT 1` read that
  `src/lib/wizard/draft-query.ts` now single-sources for the two wizard entry points, but with a
  different column set (`id, name, created_at, review_note`) for a different consumer: the Resume
  CTA + rejected-draft notice on the strategies list. It could not adopt the helper without widening
  `InitialDraft` with `review_note`/`created_at` for a page outside Phase 154's scope. Consequence:
  the /strategies Resume CTA and the wizard's own resume decision can still drift apart. The
  divergence is NOT silent — `src/__tests__/wizard-draft-query-single-source.test.ts` Scan B pins the
  latest-reader set to exactly these two files, so a THIRD one reddens. Fold it in when the helper
  grows a column-set parameter. Owner: unassigned.

### Phase 154 ship review — non-blocking findings (logged 2026-08-12, founder stopping rule)

Raised by the `/ship` pre-landing + adversarial reviews. The four that met the blast-radius bar
(user-facing or data-integrity) were FIXED in v0.59.0.0 and are not listed here. These did not.

- [ ] **C-2 / A-4 — a rotated venue password re-connect reports success and stores nothing.**
  `create-with-key/route.ts` — the dedup arm returns BEFORE `validateKey`, and keys on the MT5
  login alone; `api_secret`/`passphrase` are never consulted. A user re-running the wizard to
  update a rotated investor password is told the account is already connected, while the stored
  ciphertext still holds the OLD password and the key keeps failing to sync with no signal. Same
  shape for a typo'd password. ⭐ Highest-value of this batch: silent, and it is the ordinary
  "I rotated my credentials" path. Needs a product call — update-in-place, or refuse with copy
  that names the remedy (there is no credential-update UI today; the client UPDATE is revoked).
- [ ] **A-3 — `venue_account_id` is the MT5 login alone, but a login is only unique within a broker
  server.** Two accounts at different brokers sharing a login number collide on
  `(user_id, exchange, venue_account_id)` → wrong-account resolution. Server-qualifying the value
  (`<broker_server>:<login>`, already carried as `passphrase`) closes it. ⚠️ NOT a patch: the column
  is live on PROD, so changing what is stored is a migration decision with a backfill question.
  Not declared anywhere before this review.
- [ ] **Orphaned `api_keys` rows from a deleted composite draft are never swept.**
  `cleanup_abandoned_wizard_drafts.sql:19-24,41-49` cannot see them (the draft row is gone, and the
  keys were never in `strategy_keys`). Found while fixing the composite-draft misclassification;
  the deletion path is now closed, but rows already orphaned in PROD stay orphaned.
- [ ] **C-4 — `sync-progress` picks the strictly-newest job of any kind, with no in-flight
  preference.** A short-circuit `process_key_long` answering `done` in seconds can mask a prior
  chain's `compute_analytics_from_csv` still `running`, suppressing the amber block in exactly the
  state the UI-SPEC says must show it. Bounded by the stall backstop. Changing it means revisiting
  154-04's deliberate two-pass selection.
- [ ] **C-5 — SF-3's keep-last-known now pins `jobStatus`, which is newly load-bearing.**
  Composite-only. If a `stitch_composite` row is DELETEd out from under the client (the
  orphaned-running purge does DELETE in prod), `jobStatus` freezes and `showRecomputing` latches.
  Bounded by the stall backstop.
- [ ] **INFO — the `as unknown as …Args` cast on the scenario-commit RPC suppresses all future type
  checking of that argument object.** `allocator/scenario/commit/route.ts:582-598`. Deliberate: it
  preserves three explicit `null`s that T_R20/T_R24/CR-01 pin by name against a types regeneration
  that made DEFAULT-ed params optional. Cost: a later added or renamed required param compiles
  clean and fails at runtime. Money path.
- [ ] **Two copy-honesty nits in `SyncPreviewStep.tsx`.** (a) the lead paragraph still asserts a
  present-tense exchange fetch under the amber/interrupted blocks, where the identical in-card
  claim was just suppressed as false — gate it on `inFlightClaimIsCurrent` too; (b) with the
  in-flight claim withheld, the status panel can collapse to a bordered box containing only an
  unlabeled number.
- [ ] **Residual: a genuinely-empty account still waits out the patience clock if `/sync-progress`
  is dead or sustained-429.** The zero-history refusal needs positive finished-evidence, which that
  route supplies. Closing this needs a threshold, which Phase 154 bans. Declared, not hidden.
- [ ] **`154-03-TEST-APPLY.md` contradicts itself on whether the SQL gate ran.** §2 records a PASS
  on TEST; §5 records a post-hoc migration amendment and says the seeded cases have NEVER executed;
  `154-VERIFICATION.md` says the gate has not been executed. Honest reading: a pre-amendment
  structural subset ran, the shipped file never has. Correct one of the two records.

### Phase 156 (CONNECT) — the two things this phase deliberately did NOT fix (added 2026-08-13)

Both were raised at planning, decided out of scope there (`156-RESEARCH.md` § "Open Questions" 3 and
4), and are logged here rather than patched in passing. Plan `156-05`'s acceptance asserts BOTH
named files are unmodified by the phase, so neither was quietly half-done.

- [ ] **`p_venue_account_id` has no in-database oracle — Phase 156 closed its REACHABILITY half and
  RESTATED the rest** (added 2026-08-13 by `156-10`; the plan assumed this was already logged and it
  was not). `src/app/api/strategies/create-with-key/route.ts` at the `p_venue_account_id` argument,
  and `create_wizard_strategy`'s `COMMENT ON FUNCTION`
  (`20260814120000_wizard_rpcs_revoke_authenticated.sql:536-550`). ⭐ **What Phase 156 DID close:**
  after Migration B only the server can pass the value at all, so "a browser chose this account id"
  is no longer reachable. ⛔ **What it did NOT close, and cannot:** nothing in the database can ask
  MT5 whether a login is real, so the stored value is *"what the server passed"*, never *"what the
  venue confirmed"* — the same CR-01 class as `p_exchange`, at a narrower scope. An oracle means
  calling the venue, which is an application-tier probe; the MT5 gateway already performs one at
  validate time, so persisting *its verdict* alongside the value is the plausible remedy and needs
  its own decision (it is a migration + backfill question on a column that is live on PROD).
  ⚠️ **Distinct from A-3 above:** A-3 is about this value's *shape* (a login is unique only within a
  broker server); this entry is about its *provenance*. Fixing either does not fix the other.

### Phase 153.7 ship gate — one unnamed vitest flake, recorded rather than lost (added 2026-08-14)

- [ ] **`FLAKE-153.7-01` — the full local vitest suite failed exactly one test once, in parallel
  mode, and I could not name it.** ⚠️ **This is a known-unknown on purpose.** Evidence, in order:
  run 1 (`vitest run`, default parallel) → `Test Files 1 failed | 780 passed | 19 skipped`,
  `Tests 1 failed | 11852 passed`; run 2 (identical command, no code change between) → exit 0;
  run 3 (`vitest run --no-file-parallelism`) → `781 passed | 19 skipped`, `11853 passed`, exit 0.
  Two clean full runs against one failure, so the phase gate is green and Phase 153.7 shipped on it.
  ⛔ **Why this is written down instead of shrugged off:** the failing run's output was not captured,
  so the test has no name. An unnamed flake that fires once locally is the shape that later fires in
  a CI shard and reads as a regression in whatever PR happens to be open — costing a bisect against
  an innocent diff. If a single-test failure appears in a vitest shard and does not reproduce under
  `--no-file-parallelism`, check this entry BEFORE bisecting.
  **What would close it:** capture a failing run (`vitest run > /tmp/run.txt 2>&1` in a loop until
  non-zero) and name the test; then either fix the race or pin the file to `--no-file-parallelism`.
  ⚠️ Local is Node 25, CI is Node 22 — reproduce under
  `PATH=/opt/homebrew/opt/node@22/bin:$PATH` before concluding it is local-only.

### v1.17 milestone-audit residuals — logged per the stopping rule (added 2026-08-14)

- [ ] **`PLANNING-PROJECTREF-01` — the PROD and TEST Supabase project refs are written into tracked
  `.planning/` files, against the standing "never record the PROD project ref in `.planning/`"
  rule.** Found 2026-08-14 by a no-allowlist sweep at the v1.17 close (gitleaks itself: **no leaks
  found** — this is below its threshold, which is why the rule exists separately). Occurrences
  include `REQUIREMENTS.md:910,1433`, `STATE.md:1336`, `TODOS.md:584,1477,1554,1641`.
  ⭐ **Assess the actual exposure before spending effort:** a Supabase project ref is the subdomain
  of `NEXT_PUBLIC_SUPABASE_URL` and therefore ships in every browser bundle already — it is not a
  credential and redacting it buys no security. The real issue is that a stated rule and the repo
  state disagree, and an unenforced rule teaches people to ignore the enforced ones.
  **Decide one way:** either scrub + add a CI grep, or amend the rule to name refs as non-secret
  and keep the prohibition for keys/JWTs/connection strings only. ⛔ Do NOT half-do it.

### Branch & worktree adjudication, 2026-08-14 — four survivors with real unmerged work

Context: 37 stale branches and 9 orphaned agent worktrees accumulated. Every one was adjudicated
**by content** (`grep -aF` per added line against `origin/main`), not by branch age or `git cherry`
— ⭐ patch-id is USELESS here because squash-merges give shipped work a different id, so merged
branches read as "62 commits ahead" forever. 33 were verified shipped and deleted. **These four
were NOT, and all four are now pushed to `origin` so they are no longer local-only:**

> ⚠️ Triage 2026-08-20: all four verified superseded/stale at HEAD — branch deletion is the remaining act, pending founder.

- [ ] **`fix/scenario-empty-daily-returns` — 143 of 164 added lines absent from main.** A real bug
  fix: resolves the lazy-returns series through the analytics column-drift resolver, across
  `api/strategies/[id]/returns/route.ts`, `factsheet/allocator-portfolio-payload.ts` and
  `portfolio-math-utils.ts`. Its own comment records the load-bearing fact: **the legacy
  `daily_returns` column has NO production writer** — the real series lives in `returns_series`,
  the `(1+r).cumprod()` wealth curve the analytics service writes (`metrics.py:775-778`).
  ⚠️ Dated 2026-08-04 and never merged. **Decide: land it or close it with a reason.**

- [ ] **`fix/sync-status-superseded-failed` — an entire MIGRATION that never landed.**
  `supabase/migrations/20260705130000_sync_status_supersede_failed.sql` and its gate
  `supabase/tests/test_sync_status_supersede_failed.sql` are **absent from main**.
  ⚠️ A migration sitting unmerged for 5+ weeks is either abandoned-on-purpose or dropped by
  accident, and the branch name does not say which. ⛔ Do NOT merge it blind — merging
  `supabase/migrations/**` AUTO-APPLIES to PROD. Read it first; it is adjacent to Phase 144's
  reaper-status work, so check for conflict before v1.16 Phase 144 lands.

- [ ] **`ci/pytest-xdist-parallel` — 23% of its additions absent from main.** Parallelizes the
  analytics-service Python CI (`pytest.ini`, `Makefile`, `conftest.py`, `requirements-dev.txt`,
  `ci.yml`). Cheap, useful, never merged. ⚠️ Check it against the `-p no:randomly`/VCR-cassette
  constraints before landing — parallel pytest plus cassettes is exactly where LIVE broker calls
  leak in.

- [ ] **`wip/v1.16-phase140-fix-archive` — 91% divergent (4,046 of 4,441 added lines absent).**
  Highest divergence of any branch, but **no file it touches is missing from main**, so this reads
  as a superseded WIP approach from the Phase 140 era (2026-07-25) rather than lost work. Kept
  rather than deleted *because* 91% is too high to dismiss on a heuristic. **Decide: skim it once
  and delete, or cherry-pick anything still true.**

⭐ Also rescued: `.claude/worktrees/agent-a06a853e5acc0cdd0` held **264 uncommitted lines** across
`SyncPreviewStep.tsx` and three of its tests. Main already carries the recomputing block so it
looks superseded, but the diff was saved rather than assumed — session scratchpad,
`rescued-worktree-a06a853e-uncommitted.patch`. ⚠️ Scratchpad is session-scoped; if this matters,
move it into the repo.

## Phase 143 — recorded deferrals (logged 2026-08-17)

Both are DELIBERATE non-coverages of the JOB-04 dropped-enqueue sweep
(`supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql`), documented in that
file's header and in `143-CONTEXT.md`. Neither is a bug in the sweep; each needs its own mechanism.

- [ ] **(D-09) Composite strategies stranded without analytics are EXCLUDED from the sweep — they
  need a `stitch_composite` re-run mechanism with its own predicate.** The sweep excludes any
  strategy with a `public.strategy_keys` member row. This is **money safety, not optimization**:
  `run_stitch_composite_job` writes `csv_daily_returns` itself (`job_worker.py:6786-6803`) but
  `JOB_CHAIN_FOLLOW_ON["stitch_composite"]` is the empty tuple (`job_worker.py:527`), so a composite
  is chain-terminal and legitimately never gets a `compute_analytics_from_csv` job. Enqueueing one
  would hand the composite headline to the single-key computation its own handler deliberately
  abandoned — a √252-vs-√365 annualization divergence plus a 0.0 gap-fill that "fabricated flat
  performance" (`job_worker.py:6808-6822`). Silent corruption of a CORRECT row on a money surface is
  strictly worse than the un-healed hole. ⚠️ Not hypothetical: the 143-02 census found **1 composite
  on PROD carrying dailies**, currently protected only by a terminal analytics row — i.e. one failed
  terminal write away from being the exact false positive this conjunct stops.

- [ ] **(D-05) The wizard/API first-hop enqueue drop is NOT covered.** A `finalize-wizard` strategy
  whose `sync_trades` enqueue dropped has **no dailies at all**, and "no dailies AND no jobs" is
  byte-identical to a brand-new strategy that has not synced yet, and to a key whose first sync
  legitimately returned nothing. No predicate catches the drop without also catching those, so the
  sweep would re-enqueue healthy strategies forever. Closing it needs a different signal
  (`api_key_id` present + no job EVER + a longer grace) with its own false-positive analysis — a
  separate mechanism, not a second predicate bolted into this migration.

- [ ] **(follow-on, from the 143-04 live tick) `cron.job_run_details.return_message` does NOT carry
  a pg_cron body's RAISE NOTICE text on this Supabase build — it carries the command tag (`DO`).**
  Observed 2026-08-17. This affects **142's reaper too**, whose header relies on the same premise for
  its operator-observability section; that file was not touched by Phase 143. Either correct
  `20260802120000`'s wording or build a real count surface. Until then, count healed rows with
  `SELECT count(*) FROM public.compute_jobs WHERE metadata->>'source' = 'reconcile-sweep' AND
  created_at >= <tick start>`, not by reading the run log.

### Phase 143 red-team residuals (logged 2026-08-17, deliberate trade-offs)

Both have a SAFE failure direction. Recorded so the trade-off is visible, not so it is forgotten.

- [ ] **Sweep-alert de-dupe is in-process (bounded FIFO), not durable.** A worker restart between two
  claims of the same heal costs ONE DUPLICATE alert. The dangerous direction — a heal whose first
  claim died going unreported — was a real bug and is FIXED (red-team F-2). Exactly-once across
  restarts needs a `compute_jobs.metadata` write and therefore a migration, which auto-applies to
  PROD on merge; not worth it for a duplicate. `analytics-service/main_worker.py`.

- [ ] **The D-19 IN-subquery-LIMIT gate is a TEXT gate and remains partially escapable.** Widened
  2026-08-17 from `[^)]*` (which could not match any realistic rewrite, since the predicate needs
  `EXISTS (...)` parens) to `[^;]*`. A rewrite placing a `;` between `IN (SELECT` and `LIMIT` still
  escapes it. Inherent to text gates: the per-tick bound's only real proof is SQL gate Part 4
  executing the deployed body against LIMIT+1 rows. Do not mistake a green text gate for a bound proof.

- [ ] **TEST's migration ledger disagrees with the repo filename for this migration** (logged
  2026-08-17 at land time). Applying via Supabase MCP `apply_migration` stamps `now()`, so TEST
  recorded `supabase_migrations.schema_migrations.version = 20260817092430`, while the repo file —
  and therefore PROD, which got it through the normal `Supabase Migrate` workflow — is
  `20260816140000_reconcile_dropped_enqueue_sweep.sql`. **PROD is correct and unaffected**; this is
  TEST-only bookkeeping. Consequence: TEST still considers `20260816140000` unapplied, so a future
  `supabase db push` at TEST would re-run it. That re-run is believed benign (`cron.schedule` is
  upsert-by-name and the body is unchanged) but has **not** been exercised. Known trap, previously
  seen as the PR-Y2 rename. Reconcile the TEST ledger row, or leave it and never `db push` TEST.

## Phase 145 — recorded deferrals (logged 2026-08-17)

Three DELIBERATE deferrals from the JOB-06 csv-finalize atomicity fold
(`finalize_csv_strategy_with_returns`, migration `20260819120000`; 145-CONTEXT.md `<deferred>`).
None is a defect in the fold; each carries the constraint that made it out-of-scope. Census
citations are from `.planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md`
(taken 2026-08-17: PROD `khslejtfbuezsmvmtsdn`, TEST `qmnijlgmdhviwzwfyzlc`).

- [ ] **(Window E) Enqueue-errored strategies are visible and alerted but never healed — nothing
  re-enqueues them.** Shape: dailies present, the `after()` enqueue errored, `strategy_analytics`
  = `'failed'`, no `compute_jobs` row ever created. The user's poller breaks out on `failed` and
  Sentry fires (`step: csv-analytics-enqueue`), so it is not silent — but Phase 143's sweep
  deliberately excludes it via the terminal-analytics conjunct (`20260816140000:737`), and the
  Phase 145 fold leaves hop 5 (the post-response enqueue) outside the transaction by physical
  necessity (`after()` runs post-commit), so this window survives the fold. Census query (3)
  measured 2026-08-17: **PROD = 1, TEST = 0**. The pre-registered re-rank trigger ("non-zero PROD
  → live cleanup") technically fired, but the single PROD row is the KNOWN composite already
  tracked by the Phase 143 (D-09) entry above — composites are chain-terminal by design and need a
  `stitch_composite` re-run mechanism, not a csv re-enqueue — so there is no genuine window-E
  population today and the item stays mid-term. Any future healer must key on a signal that
  distinguishes "enqueue errored" from "composite, legitimately job-terminal" (the D-09
  false-positive class).

- [ ] **(Wizard first-hop drop) The API/wizard first-hop enqueue drop remains uncovered — ⛔ never
  absorb it into Phase 145's surface by widening a predicate.** Phase 143 filed it as documented
  non-coverage (`20260816140000:259-265`; the D-05 entry above): a dropped first `sync_trades`
  enqueue leaves "no dailies AND no jobs", byte-identical to a brand-new strategy, so no csv-side
  predicate catches it without re-enqueueing healthy strategies forever. It is shape-identical to
  145's pre-fold windows A–C but has an UNSOLVED distinguishing-signal problem — which is exactly
  why 145 dissolved its own windows via the fold instead of sweeping. Census (1)-minus-(2)
  measured 2026-08-17: **PROD = 0** (no wizard first-hop population; PROD's 18 csv no-dailies rows
  are all 2026-05 incident-era fossils), **TEST = 8107** (all non-csv — the e2e-seed residue
  class). Closing it needs its own signal (`api_key_id` present + no job EVER + a longer grace)
  with its own false-positive analysis — a separate mechanism, never a second predicate bolted
  onto `20260816140000` or onto the fold's resolve arm.

- [ ] **(Inert flag cleanup) Delete the dead `feature_flags.process_key_unified_backbone` row and
  the dead `PROCESS_KEY_UNIFIED_BACKBONE` env vars (Vercel Production + Railway
  `quantalyze-analytics`) — respecting the apply-time RAISE trap.** Zero code readers at HEAD
  (145-REPRODUCTION.md arm 2: the token survives only in two comments and one test constant; the
  historical readers named in `106-RATIFICATION.md:29-30` are gone), so row and env vars are dead
  config, not a live switch. Census (4), 2026-08-17: the row is present on BOTH projects — PROD
  reads `'on'` (updated 2026-05-25), TEST reads `'off'` (diverges). ⛔ Constraint, verbatim from
  145-CONTEXT.md: "Do not flip or delete it in this phase —
  `20260620120000_verification_requests_view_shim_apply.sql:86-89` RAISEs at apply time if it
  reads `off`, so a 'cleanup' delete could redden a future migration apply." (Precisely: the gate
  RAISEs when `value = 'off'` AND `updated_by <> 'migration-104-seed'` — the pristine db-reset
  seed is exempt; a DELETE leaves `v_value` NULL, which passes, but a flip to `'off'` trips it,
  and TEST's row ALREADY reads `'off'`, so re-applying that migration on TEST is hazardous today
  unless its `updated_by` is the seed exemption — unverified.) Cleanup order: retire or guard the
  `20260620120000:86-89` check first, then remove the row and both env vars in the same pass.

## Phase 145 ship-review findings (logged 2026-08-18, /ship review army — none blocking per the blast-radius bar)

Fixed at ship time (not listed): the CSV_PERSIST_FAIL retry fence (user-facing dead button)
and the pytest discriminator-suite re-point. Everything below is deliberate deferral —
clean up opportunistically; none is a persistent user-facing defect or data-integrity break.

**→ ABSORBED INTO PHASE 146.1 (2026-08-18):** the v1.19 xhigh milestone review picked this
whole list up as roster item C4 (with overlaps mapped: fold value guards + fmt-blind
empty-rows → A1, copy honesty → A3, 23505 second source → B3, rpc-test re-point → B5).
Items stay open HERE until 146.1 ships; close them here when it does.

- [x] **Python tombstone envelope — MESSAGE fixed in Phase 146.1-07 (2026-08-18).**
  `flow_type=csv, step=finalize` still answers 422 `MISSING_STRATEGY_ID` (deliberately —
  see the gated option below), but the `human_message` no longer tells the caller to supply
  `context.strategy_id`. It now states that CSV finalize moved to the Next.js route in
  migration `20260819120000` and that this service is no longer a writer for that flow.
  The default sentence is byte-identical for every other caller, pinned by
  `test_non_csv_missing_strategy_id_message_is_byte_identical` and
  `test_csv_non_finalize_step_keeps_the_default_message` (neuters C4-BLEED and
  C4-FLOWONLY both observed RED).
- [ ] ⛔ **OPTION `CSV_FINALIZE_MOVED` — a dedicated error code for the tombstone arm.
  GATED ON WIZFORM-02 CLOSING. Do not pick this up before that gate opens.**
  **What it is:** replace the `MISSING_STRATEGY_ID` code on the
  `flow_type='csv' + step='finalize'` arm with a code that names the actual refusal, so a
  caller can branch on the code rather than parse the sentence.
  **Why it is NOT shipped:** a new code must enter the WIZFORM-02 coverage-law population,
  and **WIZFORM-02 is recorded OPEN** — server-classified codes still render as
  `code: UNKNOWN` at the wizard (Phase 153 span verification FAILED 2026-08-13). Minting the
  code today ships it straight into a known-broken classification path, which is strictly
  worse than an honest message under an existing, correctly-rendered code.
  **Cost when the gate opens:** (1) add the code to the coverage-law population and satisfy
  whatever the law requires of a new code; (2) add a wizard-side classification entry so it
  does not render UNKNOWN, and a render test proving it; (3) the honest sentence shipped by
  146.1-07 stays — the code is additive to it, not a replacement, or the message regresses
  to naming only a code.
  **Where:** `analytics-service/routers/process_key.py` (the tombstone branch beside the
  API-6 envelope); the deliberate non-minting is recorded in the comment there.
- [x] **Stale-comment batch from the fold re-point — DONE in Phase 146.1-07 (2026-08-18).**
  Every claim was grep-verified at HEAD BEFORE it was touched; the ones the grep CONFIRMED
  were left alone rather than given a fresh date. Ground truth for the batch: migration
  `20260819120000:349-350` DROPs both `finalize_csv_strategy` and `persist_csv_daily_returns`.
  - CORRECTED: csv-validate-route.test.ts TOC items 6 and 7 (item 6 named the dropped persist
    RPC; item 7 named `CSV_PERSIST_FAIL`, which no test in the file pins — Test 7 pins
    `CSV_FINALIZE_FAIL`). csv-validate-route.test.ts:~898 beforeEach ("Phase 106 Stage B ...
    the SHARED persist_csv_daily_returns RPC"). csv-finalize/route.test.ts:~60 `rpcMock`
    comment (named both dropped RPCs).
  - LEFT ALONE, verified accurate: TOC item 8 — Tests 8a (runtime), 8b (source-shape) and
    8c (arity lock) all exist and match the comment.
  - REMOVED: the orphaned `process.env.INTERNAL_API_TOKEN` set in
    csv-finalize-cross-submission-merge.test.ts (line 177 at HEAD, not the 150 this item
    recorded). The route reads no such variable; the suite was re-run to confirm the
    removal changed nothing.
  - ANNOTATED: atomic-fold gate Part 2c — the enclosing `BEGIN ... EXCEPTION WHEN OTHERS`
    is an implicit PL/pgSQL subtransaction, so once Part 2a establishes that the call
    RAISED, the 0/0/0 counts follow by savepoint semantics rather than by anything the fold
    does. Kept (it still discriminates a write that ESCAPES the subtransaction) with a note
    saying so, so nobody reads a green 2c as independent atomicity evidence.
- [ ] **Residual: `INTERNAL_API_TOKEN` env sets inside csv-validate-route.test.ts.** NOT
  touched by the 146.1-07 batch, deliberately. The file mixes csv-VALIDATE describes (which
  legitimately forward to the Python service with that token, and pin its absence at
  `:808`/`:1883`) with csv-FINALIZE describes (which no longer need it). Separating the ~28
  occurrences requires per-describe analysis, and a wrong removal would make a token-absence
  arm vacuous rather than merely untidy. Cosmetic; do it as its own pass with the suite run
  between each removal, or split the file.
## v1.19 xhigh milestone review (2026-08-18) → Phase 146.1 owns the residue

15 confirmed findings across `43069db9..4e3effb0` (PRs #687–#690). Full roster with file
anchors: `.planning/phases/146.1-review-v1-19-xhigh-close-out-fold-guards-resolve-arm-honesty/146.1-CONTEXT.md`.

**Fixed same-day** (`fix/v1.19-review-easy`): dead CSV_DUPLICATE_SESSION fence + vacuous
predicate test deleted; `TestTerminalizerWindowInvariant` couples the 4h terminalizer
window to `p_batch_size × max(TIMEOUT_PER_KIND)` (RED observed at simulated 5h); three
false "nobody forwards X-User-Access-Token" comments corrected; fold self-verify check (d)
`%5000%` substring → comment-stripped bounded regex (proven on TEST: widen-RAISES,
guard-deleted-comment-kept-RAISES — the old check false-PASSed the latter).

**→ Phase 146.1** (not re-listed item-by-item here; the CONTEXT roster is the working
copy): A1 fold NULL/[] zero-dailies commits · A2 resolve arm ignores private-vs-
pending_review status · A3 "Nothing was saved" copy on unknowable-commit arms · A4
echoed-outcome metadata overwrite + missing re-enqueue · B1 Python rate-limit
bypass-by-omission (route-enumeration gate) · B2 X-User-Access-Token drop-vs-wire
adjudication · B3 any-23505 undiscriminated (pgConstraintName) · B4 terminalizer×sweep
non-composition (widen conjunct — same item as the RESEARCH §6 residual above) · B5
csv-finalize-rpc.test.ts points at a DROPped RPC (nine 22023 assertions coverage-gone) ·
C1 interior-values echo (FOUNDER: hash vs honest copy) · C2 duplicate handler collapse ·
C3 TEST sweep-cron seed residual (mitigated).

### C1 option (a) — content hash over the CSV payload (NOT taken in Phase 146.1)

**Status: filed, not scheduled. Option (b) — honest copy — SHIPPED in Phase 146.1
(plan 146.1-04), and option (b) is what a reader finds in the code today.** The 200
resolve echo in `src/app/api/strategies/csv-finalize/route.ts` now carries a
`human_message` stating that the arm compared the committed series' ROW COUNT and its
FIRST and LAST dates — and explicitly NOT the individual daily values — and the residual
comment beside the series-equality check records this founder call. The predicate did not
change; the envelope stopped implying an observation that was never made.

**The residual that stays open.** The resolve arm makes exactly two reads of the committed
series (count, and [min,max] boundary dates). A resubmit whose payload has the SAME row
count and the SAME first/last dates but DIFFERENT interior values is indistinguishable to
those two reads and is still echoed 200. The identical-retry case dominates by
construction, which is why (b) is defensible; but the hole is real and is not closed.

**What option (a) would cost — filed WITH its price, because an option without its cost is
an option nobody can decide:**

- [ ] **A content hash persisted at CREATE time.** Requires a new column on `strategies`
      (or a field on `strategy_verifications`) holding a digest of the canonicalised
      daily-returns payload, written inside `finalize_csv_strategy_with_returns` so it
      shares the fold's transaction. The resolve arm then compares the resubmit's digest
      against the committed one and refuses on mismatch — a real equality check instead of
      two boundary reads.
- [ ] **Cost 1 — a THIRD migration.** Phase 146.1 already carries two
      (`20260819130000` fold input guards, `20260819130500` sweep readmit), each with its
      own PROD-risk TEST rehearsal. A third means a third rehearsal and a third apply
      window.
- [ ] **Cost 2 — a BACKFILL question for every already-committed row.** Existing CSV
      strategies have no digest. Computing one requires re-reading each strategy's
      `csv_daily_returns` series and canonicalising it exactly as the write path does — and
      any canonicalisation drift between backfill and write silently refuses honest
      retries forever.
- [ ] **Cost 3 — a nullable-hash FAIL-OPEN period.** Between the migration and the
      completed backfill, `hash IS NULL` means "not measured", not "no match". The arm must
      keep the count+boundary behaviour for those rows (absence is not a value), so the
      residual persists for every pre-backfill row until the backfill lands. That window
      needs a decided length and an observable end.

**Re-opening it is a phase of its own, not an amendment to 146.1.** If the founder chooses
(a), the honest-copy sentence shipped by (b) becomes wrong in the other direction (it would
under-claim) and must be revised in the same change.

## Phase 146.1 execution notes (logged 2026-08-18)

- [ ] ⚠️ **Two competing FastAPI route-enumeration helpers now coexist; consolidate on one.**
  `fastapi>=0.139` defers `include_router`, so `app.routes` holds opaque `_IncludedRouter`
  placeholders and a flat `isinstance(r, APIRoute)` scan sees only app-decorated handlers.
  Two independent fixes exist:
  (a) `tests/test_validate_key_venue_transient.py::_effective` — hand-rolled recursion into
      `route.original_router.routes`; yields the ORIGINAL route objects, whose `.path` is
      **UNPREFIXED**. Correct only because every `include_router` in `main.py:811-825` is
      currently bare. **Latent trap:** the first `include_router(..., prefix="/x")` makes its
      path matching silently miss, and that file's lookup then raises "no route registered"
      (loud) — but any future path-based reader of the same helper would go quietly wrong.
  (b) `tests/test_limiter_route_coverage.py` — `fastapi.routing.iter_route_contexts`, the
      flattener FastAPI's own `get_openapi` uses; composes prefixes correctly.
  Prefer (b) and retire (a). Not done here: (a) is green today and is outside this PR's scope.
  ⭐ Process note: (a) already documented this exact behaviour **in-repo** before I began
  debugging it. Grep for `_IncludedRouter` / `original_router` before theorising next time.

- [ ] **`--reporter=basic` is invalid in vitest 4** and appears in the `<verify>` blocks of plans
  146.1-01/03/04/05/06/07. MEASURED: it exits 1 with `Failed to load custom Reporter from basic`.
  ✅ It fails LOUD rather than passing vacuously, so no green in this phase rests on it, and
  ✅ plan 146.1-08 (the merge gate) does NOT use it. Drop the flag from the plan template.

- [x] ~~**146.1-07 task 1 DEFERRED — types regen needs a Supabase access token.**~~
  ✅ **CLOSED 2026-08-18, same day — the deferral rested on MY OWN measurement error.** I
  reported that the Supabase MCP fallback was unusable because `prettier` could not parse it.
  It could not parse it because I fed prettier the **JSON envelope**, not the TypeScript:
  `generate_typescript_types` returns `{"types":"export type Json =…"}`, so the 129,458
  "one line" was a JSON string containing 4,133 escaped newlines. Extracting the `types` field
  yields ordinary TypeScript that needs no formatting at all — the Supabase CLI emits
  semicolon-free output and so does the MCP, so running prettier over it was itself the thing
  that produced a 7,758-line churn diff. Raw extraction diffs **34 lines**.
  **Executed without any token:** extract `types` → prepend the hand-written header (which the
  generator does NOT emit, so a naive `> file` redirect would have destroyed it, including the
  CRITICAL NUMERIC-precision audit note) → re-apply the two `HAND-PATCHED` tripwire comments the
  file itself warns must survive a regen → delete the cast at `route.ts:592`.
  **Verified:** net diff to the types file is **11 lines**, purely the fold's signature; the
  `notify_*` columns and the `scenarios` block survived; `tsc` clean WITH the cast deleted (which
  is the actual proof the signature is right); `database.types.test.ts` + `audit-coverage` +
  the three csv-finalize suites 138 passed; lint 0 errors; and re-introducing an `as any` cast
  trips 3 lint errors, so the type safety is enforced rather than merely present.
- [ ] ⭐ **Comment-blind greps have now failed THREE times in one phase — make it a lint, not
  a habit.** (1) the fold self-verify's `%5000%` substring, satisfied by a widened `50000`
  (fixed, PR #691); (2) my own `BETWEEN -10 AND 100` check, which false-flagged a COMMENT
  explaining the neuter as executable drift; (3) plan 146.1-04's C1 gate,
  `grep -qiE '…checksum…' && fail`, which was **already broken at its own base commit** —
  it matches honest prose at `route.ts:819` ("closing it needs a checksum, not two reads").
  The executor correctly REFUSED to delete truthful prose to make a grep pass and measured
  intent instead (`sha256|createHash|content_hash|digest` → zero, no crypto import;
  orchestrator re-verified with a comment-stripping parse). ⭐ The general rule: a grep over
  source that does not strip comments is unreliable in BOTH directions — vacuous when it
  should fire, false-positive when it should not. Candidate fix: a shared
  `scripts/grep-code.sh` that strips comments, used by every plan `<verify>`.
## Phase 146 — RATE-04 value-parity candidates (logged 2026-08-18, D-146-4: retuning is founder territory)

Source: `.planning/phases/146-rate/146-AUDIT.md` §3 (fresh at HEAD `e912e38b`). Every number
below was re-read from source that session. Standing caveats: Python slowapi storage is
`memory://` PER REPLICA (values are floors ×N, order-of-magnitude only); `userActionLimiter`
backs ~9 surfaces — the remedy for any of its flows is a NEW named limiter, never a resize.

- [ ] **L-9 `/optimize-weights` per-tenant floor out of pattern (post-TS-04 re-look).**
  Measured: Python 20/min/tenant = 1200/h (`optimizer.py:43-45`) vs max legitimate
  Vercel-forwarded 5/min/user = 300/h (`scenario/optimize/route.ts:151`) — 4× headroom where
  the match.py siblings deliberately size 1.5× (30/min over 20/min). No UX harm (Vercel gates
  first); defense-in-depth sizing only, ×N replicas under memory://. Recommendation: tighten
  to 10/minute per tenant (2× headroom, sibling pattern); the literal pin in
  `analytics-service/tests/test_limiter_identity.py` MUST move in the same commit.
- [ ] **verify-strategy teaser: per-IP front door cannot see the shared anon bucket.**
  Measured: Vercel `publicIpLimiter` 10/min per IP = 600/h/IP (`ratelimit.ts:117`;
  `verify-strategy/route.ts:59`) vs Python `/process-key` anon tier 30/h in ONE platform-wide
  shared bucket (`rate_limit.py:107`, `:148` "Everything anonymous shares ONE bucket",
  `:337`). A handful of concurrent anonymous visitors exhaust the platform's teaser capacity;
  it is also a growth ceiling (~30 verifications/h total). The shared bucket is a deliberate
  anti-abuse control (docblock: one anon IP once drained the whole platform window,
  `rate_limit.py:89-91`) — founder call required. Recommendation: key the anon tier per-IP
  (30/h per IP) to preserve the anti-abuse intent while removing the shared ceiling, or raise
  the shared tier when teaser traffic warrants.
- [ ] **csv-validate: 12× over the shared `/process-key` tenant tier + stale docblock
  citation.** Measured: Vercel `csvValidateLimiter` 20/min/user = 1200/h (`ratelimit.ts:206`)
  vs `/process-key` tenant 100/h (`rate_limit.py:100`) SHARED with keys/sync and
  finalize-wizard. The docblock's own 3-5/min iteration estimate sustained = 180-300/h >
  100/h — plausible legitimate exhaustion mid-iteration (softened ×N replicas). Also the
  `csvValidateLimiter` docblock (`ratelimit.ts:195-206`) still justifies its value against
  "the upstream 30/hour cap" in `routers/csv.py`, but the route rides `/process-key` at HEAD
  (`csv-validate/route.ts:6` imports `postProcessKey`; `/csv/validate` has no TS caller).
  Recommendation: founder call between raising `_PROCESS_KEY_TENANT_LIMIT` or adding a
  csv-scoped tier; fix the stale docblock citation in the same commit as whichever lands.

## Phase 146 close-out notes (logged 2026-08-18)

- [ ] **`analytics-service/tests/` are outside the mypy --strict gate — test_match_router.py
  alone carries 274 strict errors.** The canonical gate (`python3 -m mypy --strict
  --follow-imports=silent services/ routers/ models/`, clean at 91 files) deliberately
  excludes tests/; measured 2026-08-18 while verifying the limiter-flake fix: running strict
  on tests/test_match_router.py reports 274 errors (untyped fixtures/mocks — pre-existing,
  not introduced by Phase 146). Decide: either annotate the test tree incrementally and
  widen the gate directory-by-directory (start with the limiter/parity test files, which are
  newest), or record tests/ as permanently out of strict scope in a mypy config comment so
  the next session doesn't re-derive this. Never widen the gate in the same commit as a
  behavior change.

## Phase 146.2 — recorded deferrals (logged 2026-08-19)

*The founder rule: an item ABSORBED into a phase is deleted from this file, but an item the
phase deliberately does NOT fix must be re-recorded here. Silent drop is forbidden. The FIRST
FOUR below were re-verified against HEAD on 2026-08-19 before being written down. The fifth
(WR-01, the `createAdminClient()` request-path throw) was appended on 2026-08-20 from the
Phase 146.2 code review and is verified as of that date — it was NOT part of the 2026-08-19
sweep. Recorded because appending it silently left this preamble asserting "all four", which
was then false: the same scope-amendment class this file exists to prevent.*

- [ ] **`20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql:283-288` — the performance
  note cites the WRONG index.** It says the scalar subquery runs "over compute_jobs indexed by
  strategy_id (20260808120000 and the table's own FK index)". Neither citation holds:
  `20260808120000` creates `idx_strategies_user_id` on `strategies(user_id)` (`:127`), which is
  a different table and a different column; and PostgreSQL does **not** auto-create indexes for
  foreign keys, so there is no "table's own FK index". The index that actually supports the
  subquery is `compute_jobs_strategy_id ON compute_jobs (strategy_id) WHERE strategy_id IS NOT
  NULL`, created by `20260412094454_sync_strategy_analytics_status.sql:68-70`.
  ⚠️ **The SUBSTANCE of the performance claim survives** — a supporting index does exist and no
  new one is needed; only the provenance is wrong. Prose-only, non-blocking (the stopping rule
  keeps citation defects off the blocking path). **Fix:** re-point the citation to
  `20260412094454:68-70` and delete the FK-index phrase, in whatever commit next touches that
  migration's header. Do NOT edit the migration solely for this — it is already applied.
- [ ] **`20260819150000_...:283-288` — the same note asserts an execution ORDER the planner does
  not promise.** It says the subquery runs "only AFTER the three cheaper NOT EXISTS conjuncts
  have already discarded the corpus". PostgreSQL gives no guarantee about conjunct evaluation
  order; cost estimates normally place the `NOT EXISTS` semi-joins first, but that is a
  tendency, not a contract. **Reword to:** "the planner is free to order these conjuncts; cost
  estimates normally place the NOT EXISTS semi-joins first." No behavioural impact — the
  candidate set is bounded by `LIMIT 25` downstream and the sweep runs hourly. Prose-only,
  non-blocking; same commit as the citation fix above.
- [ ] **`process-key-client.ts` transport catch: a TRAP-1-shaped error could inline BODY
  credentials into a seam-level CONSOLE line.** The catch scrubs via `scrubSeamError(err)` whose
  per-request secret set is DERIVED from the OUTGOING HEADERS
  (`resilient-fetch.ts` `CREDENTIAL_HEADER_NAMES` → `credentialHeaderValues`, documented at
  `process-key-client.ts:505-509`). That is a deliberate class fix for header-borne credentials,
  and it is strictly better than the caller-declared list it replaced — but a credential carried
  in the request BODY is not in the derived set, so an upstream error message echoing it back
  would survive the scrub into the console line. **Sentry is unaffected: verified 2026-08-19,
  the file contains zero `captureToSentry` call sites**, so the exposure is Vercel function logs
  only. Not a live leak — no known body-borne credential crosses this seam today; recorded so
  the next credential added to a `/process-key` body is not added blind. **Fix direction:** widen
  the derived secret set to include body values of known credential-shaped keys, or assert at the
  seam that no credential-shaped key appears in the body.

## Phase 146.2 — recorded deferrals, SECOND PASS (logged 2026-08-20)

*Why a second pass: the PR #694 body reported the Phase 146.2 code review as closing with
"5 INFO (recorded)". That was false — not one of IN-01…IN-05 had ever been written into this
file — and four further items the phase knowingly did not fix were also missing. A red team
caught it on 2026-08-20; every entry below was re-measured against HEAD (`181eed3b`) before
being written down, and route.ts line numbers are paired with symbol anchors because that
file moves. The founder rule stands, with a sharpened edge: "recorded" is a claim about THIS
FILE, so grep it before you type it.*

- [ ] **IN-01 — `CsvSubmitStep.tsx:473` and `CsvSubmitStep.test.tsx:305` cite a route function
  that does not exist.** Both docblocks (under
  `src/app/(dashboard)/strategies/new/wizard/steps/`) name `resolveExistingCsvStrategy`.
  Measured 2026-08-20: `grep -rn resolveExistingCsvStrategy src` returns exactly those two
  COMMENT lines and nothing else — the symbol exists nowhere in the repo as code. The function
  they mean is `resolveExistingStrategyOrRefuse`
  (`src/app/api/strategies/csv-finalize/route.ts:1080`, called at `:814`). The SEAMPROSE-01
  protocol asks client-side prose to carry a symbol-anchored citation back to the server arm it
  renders; a citation that resolves to NOTHING is worse than none, because the next reader
  greps, finds zero hits, and cannot tell whether the arm was renamed or deleted. Prose-only,
  non-blocking per the stopping rule. **Fix:** rename both references to
  `resolveExistingStrategyOrRefuse` in whatever commit next touches the wizard directory.
- [ ] **IN-02 — dead conjunct in a c14 assertion.**
  `src/__tests__/csv-finalize-c14-regression.test.ts:740-743` reads
  `expect(opts && call![0], "…").toMatchObject({ code: "57014" })`. `opts` is unconditionally
  truthy at that point, so `opts &&` contributes nothing and the expression is just `call![0]`.
  The assertion still pins the real property (the fail-closed 503's Sentry capture must carry
  the READ error's SQLSTATE, so ops can tell a statement timeout from an RLS hide), so nothing
  is unpinned today — but a dead conjunct in an oracle is exactly the shape that lets a later
  edit "preserve the assertion" while changing its subject. **Fix:**
  `expect(call![0], "…").toMatchObject({ code: "57014" })`.
- [ ] **IN-05 — the "verbatim" wire fixtures in the wizard tests remain unverifiable by the
  suite (self-declared).** `CsvSubmitStep.test.tsx:308` (`ROUTE_ECHO_SENTENCE`), `:319`
  (`ROUTE_CLASSIFICATION_CONFLICT`), `CsvSubmitStep.upstream-arm.test.tsx:96`
  (`ROUTE_PERSIST_FAIL`), `:105` (`ROUTE_SESSION_REUSED`) — all under
  `src/app/(dashboard)/strategies/new/wizard/steps/`. Each constant is BOTH the mocked wire
  payload and the expected DOM text, so the suite is green for ANY string; the correspondence
  to `csv-finalize/route.ts` is enforced by a comment, not by code. W1 fixed a real drift and
  the comment now says this out loud, which is the right disclosure — recorded so the standing
  risk is tracked rather than re-discovered. ⚠️ All four were hand-verified byte-exact against
  their route literals on 2026-08-19; **a hand check does not survive the next edit**, which is
  the whole point of the entry. **Fix (reach for it on the third drift):** the declined static
  coupling — a build-time assertion that each fixture string is a substring of `route.ts`.
- [ ] **`supabase/tests/test_csv_finalize_atomic_fold.sql:565-574` — Part 3e's trailing
  "committed nothing" count block CANNOT FAIL.** The fold call sits inside the probe's own
  `BEGIN … EXCEPTION WHEN OTHERS` (`:545-553`). A plpgsql exception block is an implicit
  SUBTRANSACTION, so any rows the fold wrote are rolled back when it raises — BEFORE `n_strat`
  / `n_sv` / `n_dl` are read at `:565-571`. They are 0/0/0 for a healthy body AND 0/0/0 for the
  exact defect the RAISE at `:572-574` names ("GUARD 1 ran AFTER a write instead of as the
  FIRST statement"). ⚠️ **The Part is NOT vacuous as a whole** — its first three assertions
  (`:555` raised-at-all, `:558` SQLSTATE is 22023, `:561` the message names `p_terminal_status`)
  each discriminate, and the un-provable placement property is separately pinned by the new
  Part 1d no-handler check (`:256-267`). This is guard hygiene, not a live break. ⚠️ **The same
  shape is copied from PRE-EXISTING Part 3d (`:475-481`) — fix both or neither**; removing one
  and leaving the other tells the next reader the shape was reviewed and blessed. ⭐ The sibling
  file states these exact semantics as MEASURED fact —
  `supabase/tests/test_csv_finalize_double_submit.sql:246-253`: a catch-write-and-re-raise
  handler is "NOT caught, and not catchable by ANY row count" because the subtransaction rolls
  the handler's own writes back too. Part 3e was written after that note and did not apply the
  lesson to itself. **Fix:** delete both count blocks and replace them with a comment pointing
  at Part 1d as the real pin, rather than leaving two assertions that read like coverage.
- [ ] **Phase 146.2's own close-out made two completeness claims that were false when
  written.** (a) The PR #694 body reports "5 INFO (recorded)" — the five entries above ARE that
  record, first written 2026-08-20. (b) `146.2-VERIFICATION.md:176-177` states "all appear in
  plan `requirements-completed` fields"; measured 2026-08-20, that field exists in five
  SUMMARYs only (01→R1, 02→R2, 03→R4, 06→R7, 07→R6+W1), while `146.2-04-SUMMARY.md` (R3) and
  `146.2-05-SUMMARY.md` (R5, W2, W3) carry NO such field — so **R3, R5, W2 and W3 appear in no
  plan's `requirements-completed` at HEAD even though all four shipped**. ⚠️ Why this is more
  than tidiness: that frontmatter is what a later milestone audit reads to decide a requirement
  was delivered, so four silently-absent entries make shipped requirements look dropped — the
  precise failure the field exists to prevent, and the inverse of the failure this section
  exists to prevent. **Fix:** add `requirements-completed` to the 04 and 05 summaries, correct
  the PR body, and treat "recorded" / "all appear" as claims to be grepped before typing.
- [ ] **The audit-coverage window is stated as 60 lines; the mechanism is brace-balanced with a
  200-line cap.** `src/app/api/strategies/csv-finalize/route.ts:708-711` warns "⚠️ THE EMISSION
  MUST STAY WITHIN 60 LINES BELOW THIS CALL. That is the law's own coverage window
  (audit-coverage.test.ts `isCovered`)". Measured at HEAD: `isCovered`
  (`src/__tests__/audit-coverage.test.ts:374-424`) walks forward brace-balanced from the
  mutation and stops at the close-brace of the ENCLOSING FUNCTION, with
  `AUDIT_WINDOW_MAX_LINES = 200` (`:331`) only as a hard fail-safe. The flat 60-line window is
  the PRE-P694 behaviour the brace walk deliberately replaced — a flat window let a mutation in
  `POST()` be "covered" by a `logAuditEvent` inside `PATCH()` in the same file. Three lines of
  `146.2-06-SUMMARY.md` (`:52`, `:235`, `:538`) repeat the 60. ⚠️ **The SUBSTANCE survives**:
  the emission sits inside the same function body, 39 lines below the `.rpc(`, so the coverage
  law does hold and the placement warning is still the right warning — only the integer and the
  rule it names are wrong. The failure mode of leaving it: someone "safely" moves the emit 80
  lines down (still same function, still covered) and, believing they broke the law, contorts
  the code instead. **Fix:** restate the route docblock as "the emission must stay inside the
  SAME FUNCTION BODY as the `.rpc(` call — brace-balanced walk, 200-line fail-safe" next time
  that file is touched. Leave the SUMMARY as-is (a shipped artifact is history), but do not
  re-copy the 60 into new prose.
- [ ] **FOLLOW-UP PHASE CANDIDATE — make the FILL arm's recompute actually guaranteed instead
  of refusing when it cannot be.** Phase 146.2 closed the classification gap by REFUSING the
  fill when a recompute is already in flight. That is honest, but it is a NARROWING, not a
  repair: those users get a 409 instead of their classification. Root cause, measured at HEAD:
  `_enqueue_compute_job_internal`
  (`supabase/migrations/20260420073003_allocator_holdings.sql:330-402`) dedupes onto any job
  for the same target + kind with `status IN ('pending','running','done_pending_children')`
  (`:370-376`) and RETURNS the existing id (`:400-402`) — so a fill arriving mid-compute is
  ABSORBED into the running job, and that job already snapshotted the OLD classification. The
  worker reads `asset_class` once at job start
  (`analytics-service/services/analytics_runner.py:1212-1219`, into `_strategy_row` at `:1231`)
  and consumes it far later at `:1399-1401` via `periods_per_year_for_asset_class`, so the
  annualization basis for the whole run is fixed before the fill's UPDATE lands. The route's
  enqueue passes no idempotency key
  (`src/app/api/strategies/csv-finalize/route.ts:1776-1780` sends `p_strategy_id`, `p_kind`,
  `p_metadata` only), so it cannot opt out of the dedupe. ⚠️ **Residual sliver even WITH the
  shipped refusal**: the snapshot at `:1212-1219` runs BEFORE the job marks
  `computation_status='computing'` (`:1238-1242`), so a guard keyed on 'computing' closes the
  dominant window but leaves a millisecond gap between the two. **Fix direction:** either force
  a follow-on job rather than letting the enqueue be absorbed (a distinct idempotency key, or a
  supersede arm), or have the worker RE-READ `asset_class` at write time and compare-and-set.
  Both change the job/worker contract and the queue's dedupe invariant ⇒ **own phase, not a
  point fix.**
- [ ] **CI went RED mid-Phase-146.2 and no artifact records it — plus the operating rule that
  prevents the repeat.** The `sql-tests` job failed at commit `44cc4370` in
  `supabase/tests/test_claim_kind_filter.sql` (the FLIPRETRY-04 double-fan-out DO block,
  `:183-219`) with `compute_jobs_api_key_id_fkey` violated. ROOT CAUSE, measured — not a code
  defect, and not one of the four known shared-TEST-DB flake mechanisms: a LOCAL `npm run test`
  was running against the shared TEST database concurrently with the CI run.
  `enqueue_derive_broker_dailies_for_allocator_keys()`
  (`supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:236-240`) fans out
  over EVERY active, non-revoked, non-disconnected `api_keys` row in the whole shared database
  — it has no test-seed scoping — so the test's own `PERFORM` (`test_claim_kind_filter.sql:204-205`)
  enqueued against ANOTHER writer's key that was deleted between the cursor read and the FK
  check. ⚠️ The fan-out's inner handler catches `unique_violation` ONLY (`:249-250`), so a
  concurrently-deleted key (23503) propagates out and reds the whole file — worth knowing
  before "hardening" it, since a blanket `WHEN OTHERS` there would hide real breakage. It
  re-ran green at `181eed3b` with no code change. ⚠️ **OPERATING RULE: never run the local
  suite while any CI run is in flight — `gh run list` FIRST.** And note the ordering that makes
  this entry honest: the mechanism was identified BEFORE the green re-run. A green re-run is
  never itself proof that the first failure was noise.

## v1.19 milestone audit — integration findings (logged 2026-08-20, audit status: tech_debt; none blocking per the blast-radius bar)

All four were found by the milestone-close integration check at HEAD `00e73aa5`, re-measured by
the orchestrator (code greps + PROD counts) before filing. None blocks the close: the affected
populations measured ZERO on PROD, the failure direction is fail-safe (under-healing, not
runaway), and every v1.19 requirement is satisfied as written.

- [ ] **INT-1 — the 144→143 readmit composition is unreachable for real terminalized orphans
  (and its SQL gate arms pass for the wrong reason).** The sweep's `strategy_analytics`
  exclusion (`20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql:397-402`, list
  includes `'computing'` and `'failed'`) drops any worker-started orphan before the B4 marker
  exemption (`:387-388`) or the `< 3` ceiling (`:390-396`) ever evaluates:
  `analytics_runner.py:1275` runs the unconditional `_mark_computing()` upsert on entry, and
  142's reaper (`20260802120000`) later flips that `computing` → `failed`. Both values are in
  the exclusion list, so a mid-compute orphan terminalized by 144 is never readmitted — it
  settles at a visible `failed` with no auto-retry. The only population that DOES reach the
  ceiling is the claim→mark window (seconds). MEASURED 2026-08-20 on PROD: terminalizer
  markers = **0** (population has never existed); silent under-healed candidates = **0** (the
  one census hit is an honest May-2026 enqueue-failure row). ⚠️ The milestone goal ("detected
  and terminates VISIBLY") is met — readmit was defensive hardening from 146.1-B4, not a
  requirement. TWO sub-items if this is ever picked up: (a) any widening of the analytics
  conjunct must respect that it is THE protection against mass re-enqueue of the
  retention-aged corpus (`test_reconcile_dropped_enqueue_sweep.sql:371-372` gates on exactly
  this); (b) arms C4/C5/C5b seed NO `strategy_analytics` row
  (`test_reconcile_dropped_enqueue_sweep.sql:705-746`), so they prove the ceiling's predicate
  arithmetic, not reachability — seeding analytics at `computing`/`failed` in a NEW arm would
  make the gap executable (and RED until (a) is decided). Migration-header prose at
  `20260819150000:15-26` overstates the readmit path's reach; migrations are immutable, so the
  correction belongs in the successor migration if one is ever written.
- [ ] **INT-2 — no whole-surface limiter coverage law on the Next side (RATE-05 residue).**
  `src/lib/api/limiter-ordering.test.ts:232-234` derives its population from routes that
  ALREADY consume a limiter; `seam-ratelimit-posture.invariant.test.ts:167` derives from seam
  imports only. A new limiterless non-seam Next route is invisible to both. The Python side
  has the wanted shape (`analytics-service/tests/test_limiter_route_coverage.py:407-442`:
  whole-surface derivation ∪ quarantine ∪ `in_neither` anti-vacuity arm) — port that
  partition to `src/app/api`. Phase 146's verification scoped this honestly (D-146-1); this
  item is the widening, not a regression.
- [ ] **INT-3 — RATE-05's requirement text names an artifact that does not exist in source.**
  `withRateLimit` appears in ~15 `.planning/` files and ZERO source files; the shipped
  mechanism is `src/lib/api/withAuthLimited.ts` + `withAdminAuth({rateLimitKey})` (locked
  D-146-1: VERIFIED-EXISTING, no second wrapper). Re-point the REQUIREMENTS.md RATE-05 text
  (and any future grep-gates) at the real symbols so the ledger stops asserting a
  ungreppable name.
- [ ] **INT-4 — note: Phase 145's fold silently shrank Phase 146's seam census by one.**
  csv-finalize left the seam-import edge when the fold replaced the seam client
  (`seam-ratelimit-posture.invariant.test.ts:197-200` records it), so the milestone's busiest
  write route is now covered by `limiter-ordering.test.ts:103` alone. Documented, not broken —
  kept here as the worked example of one phase's refactor moving another phase's gate
  boundary (relevant to INT-2's design).

## Phase 158 — recorded deferrals (logged 2026-08-20)

- [ ] **[158-OPS-03/SEC] ⛔ ROTATE the two leaked demo accounts — NOT done, and only a human can
  do it (158-REVIEW CR-03).** ⚠️ **The two email/password pairs are DELIBERATELY NOT QUOTED in
  this entry.** This file is tracked in a **PUBLIC** repository, so quoting them here would
  re-publish them on a *more* discoverable surface than the history they already sit in — which
  is the opposite of what this ticket asks for (158-REVIEW iteration-3 CR-01 caught exactly that
  regression: the scrub commit pasted both pairs back in while writing this entry). Identify the
  accounts by ROLE, not by value:
  - **Pair A — the shared e2e login identity** (a gmail address), formerly hardcoded in
    `e2e/for-quants-onboarding.spec.ts`, `e2e/discovery-watchlist.spec.ts` and
    `e2e/match-queue.spec.ts`; see commit `11041327` for the values.
  - **Pair B — the `seed-full-app-demo` allocator identity**, formerly hardcoded in
    `scripts/seed-full-app-demo.ts` and quoted in `docs/demos/2026-04-09-full-app-walkthrough.md`
    + the `CHANGELOG.md` entry; see commit `65e1cc52` for the values.

  Both pairs were committed in plaintext and remain in git history, so they **must be treated as
  published**: removing the text is *not* remediation — **disabling or rotating the accounts on
  every project they exist in (TEST, preview, and PROD) is the only step that actually remediates
  this.** No agent can perform it; do not mark this closed on the basis of the scrub commits below.
  **Done in-pass (text surfaces only):** `scripts/seed-full-app-demo.ts` now reads
  `DEMO_SEED_ALLOCATOR_EMAIL` / `DEMO_SEED_ALLOCATOR_PASSWORD` and refuses without them;
  `docs/demos/2026-04-09-full-app-walkthrough.md` and the `CHANGELOG.md` entry are redacted;
  `.gitleaks.toml` no longer blanket-exempts `.planning/`. Live-surface grep for both pairs
  outside `.planning/` now has exactly **one** tracked hit:
  `src/__tests__/e2e-match-queue-no-vacuous-admin-gate.test.ts:71-72`, where pair A is the needle
  of an absence-assertion and is retained deliberately (that guard cannot be written without
  naming what must be absent; see the docblock there). A prose backlog entry needs no needle,
  which is why that exception does not extend to this file.
  **Still open beyond rotation:** pair A also remains quoted in
  `.planning/milestones/v0.17.0.0-phases/13-*` and `.planning/milestones/v0.16.0.0-phases/11-PATTERNS.md`.
  Those are historical artifacts and were deliberately left untouched in this pass; the full
  `.planning/` sweep belongs to **v1.20's SEC-02 requirement**, which owns it end to end.

- [x] **[158-OPS-04] drain execution deferred — the TEST `compute_jobs` backlog is NOT yet
  drained.** CLOSED 2026-08-20: 5-step protocol executed from the credentialed main checkout — measured no-op (BEFORE stale set 0; reaper live on TEST + worker churn had already dissolved the 08-11 backlog; 0 terminalized, residual 0, idempotency zero-delta); measured tables in 158-OPS04-DRAIN-EVIDENCE.md.
  Plan 158-03 landed both halves it could land: the `claimed_at` stamps in the two
  direct running-flip UPDATEs (`analytics-service/tests/test_compute_jobs_fencing.py:1148`,
  `:1200`) and the guarded tool `scripts/drain-test-compute-backlog.ts` (five interlocks, all
  OBSERVED refusing). What did NOT happen is the thing OPS-04 actually closes on: the
  before/after row counts. The executing worktree had no TEST service-role credentials
  (`NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` unset; only `.env.example` present)
  and was explicitly barred from running the drain against a live database or improvising
  access. Measured counts were therefore NOT taken, and
  `.planning/phases/158-ops-ci-a-merge-means-a-deploy/158-OPS04-DRAIN-EVIDENCE.md` carries
  empty BEFORE/AFTER tables marked NOT MEASURED rather than invented numbers. ⚠️ The stale
  backlog keeps growing daily until someone runs this. **Fix:** run the 5-step protocol in
  that evidence file from a checkout with TEST credentials, paste the real tables in, then
  close OPS-04. ⚠️ Do NOT close it on "the fencing tests are green" — the exactly-10 red was
  structurally fixed by PR #674 (`c726a250`, 2026-08-12) and would be green either way.
- [ ] **[158-OPS-04] eligibility flip deferred: MODE 2 never measured (same missing
  credentials).** `scripts/drain-test-compute-backlog.ts --flip-eligibility` reduces tomorrow's
  fan-out by narrowing the job's own eligibility predicate on `api_keys` (never by touching the
  schedule), but neither the eligible-key population nor the proposed flip set was measured, so
  no key was flipped. Without it, MODE 1 is a decaying fix: the daily fan-out refills `pending`
  at roughly one row per eligible key. The allowlist is already settled in code (parsed from
  `scripts/seed-full-app-demo.ts`'s `API_KEY_IDS`, plus `is_example`/`published` strategies'
  keys, plus a 7-day age cutoff covering the per-run e2e fixtures), so this is a run, not a
  design. **Fix:** step 4 of the evidence file's protocol, then step 5 if step 4's output reads
  unambiguous.
- [ ] **[158-OPS-04] the two stamped fencing tests did not execute locally.** `python3 -m pytest
  tests/test_compute_jobs_fencing.py -q` from `analytics-service/` reports `16 passed, 28
  skipped`, and `test_defer_compute_job_token_fence` + `test_defer_compute_job_null_token_backcompat`
  are among the skips (`test Supabase project not configured (local dev)`). The stamps were
  verified by region-scoped grep only (falsifiable: the same grep returns 0 against the
  pre-change revision). CI carries the `TEST_SUPABASE_*` secrets and hard-fails rather than
  skipping, so the first real execution of the stamped payloads is the phase's CI run — watch
  it rather than assuming.
- [ ] **[158-OPS-04] e2e specs leak 2 `auth.users` rows per CI run, by convention (158-REVIEW
  WR-11).** `seedTestAllocator` mints users that nothing ever deletes: `seed-test-project.ts`
  calls `auth.admin.createUser` in **four** places and `deleteUser` in **none**, and the
  `cleanup*` helpers it does export delete strategies, not users. Specs affected today:
  `my-strategies` (new this phase, 2 users/run), plus the pre-existing `composer-axe`,
  `composite-onboarding` and `axe-app-wide`. This is exactly the unbounded TEST-artifact
  accumulation OPS-04's drain script exists to mop up, arriving through a second door that the
  drain does **not** cover (it targets `compute_jobs` and `api_keys`, not `auth.users`).
  ⚠️ Do **not** point-fix this in a single spec — that forks the convention in one file and
  leaves the class open. **Fix:** add user teardown to the shared helper (register minted ids,
  `admin.auth.admin.deleteUser` in a `cleanupSeededUsers`), audit the FK cascade for every
  caller, then adopt it across all four specs. Its own reviewed change.
  Counted first: `select count(*) from auth.users where email like '<seed pattern>%'` on TEST,
  so the close is measured rather than asserted.

## Phase 158 — OPS-03 orphan e2e spec dispositions (logged 2026-08-20)

OPS-03 closes as a CLASS, not a partial fix. Census re-derived at HEAD this session (not
carried forward from the dated research table): **53 spec files in `e2e/`, 20 referenced by no
workflow batch list.** Plan 158-06 wired 5 of them (`api-key-flow` + `sync-analytics-flow` →
unseeded batch; `full-flow` + `csv-upload-flow` + `my-strategies` → seeded MA-8 batch), each
run-and-repaired first by plan 158-05. The remaining 15 get a recorded disposition below, one
line each, plus a 16th correcting the `portfolio-pdf-demo` row and a 17th for the DB-types
residual found while recording the decision.

**The class-level finding — read this before wiring any of them.** These specs are not
orphaned individually by accident. Between them they reach for **four mutually incompatible
identity mechanisms**, none of which any CI job provisions: `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`,
`QUANTALYZE_E2E_PASSWORD`, `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`, and hardcoded in-file
credential literals — plus a fifth, `PLAYWRIGHT_TEST_STRATEGY_ID`, for fixture identity. They
also use **two different seed-gate constant names** (`HAS_SEED_ENV`, which the MA-8 joining rule
keys on, and `HAS_SEEDED_SUPABASE`, which it does not). The real blocker is therefore ONE
missing convention, not 15 wirings: the seed-helper identity contract (`seedTestAllocator` /
`loginViaForm`, the pattern `wizard-resume` and the new `my-strategies` spec use, and the one
plan 158-05 converted `csv-upload-flow` onto). ⚠️ Wiring any spec below **before** converting it
produces an all-skip run, which is the SAME false-coverage state as orphanhood — a green batch
proving nothing. Verify ≥1 executed, non-skipped case per spec before calling it wired.

Dispositions are one of **wire-later** (belongs in a batch; needs a run-and-repair pass first),
**defer** (blocked on env/identity nobody provisions; tracked, low value until unblocked), or
**delete-candidate** (surface gone — deletion would need its own reviewed change, not done here).
No spec below is a delete-candidate: every route they target still exists (verified against
`src/app/` this session), so deletion would destroy coverage intent rather than dead weight.

- [ ] **[158-OPS-03] ⚠️ two of the five wired specs are ADVISORY, not gating (158-REVIEW WR-06).**
  `api-key-flow.spec.ts` and `sync-analytics-flow.spec.ts` went into the **unseeded `e2e` job**,
  which cannot fail a merge for two independent reasons: its test step carries
  `continue-on-error: true` (kept deliberately for the unfixed
  `getaddrinfo ENOTFOUND placeholder.supabase.co` flake), and the `e2e` job is in **no**
  aggregator's `needs:` — `frontend` gates on `e2e-seeded`, not on `e2e`. In the required form:
  after 158-06 these two **would surface** a regression in a run log; they **would not** have
  stopped it merging or deploying. The other three (`full-flow`, `csv-upload-flow`,
  `my-strategies`) went to `e2e-seeded`, which IS in `frontend`'s `needs:` — that half is
  genuinely blocking. Do not describe the OPS-03 wiring as "now gated".
  **To close:** promote the two contract describes into a lane that can fail. They are pure
  `request.post` contract assertions against localhost and do **not** touch the
  `placeholder.supabase.co` DNS path that motivated the tolerance, so either a
  no-`continue-on-error` step in the `e2e` job or the `e2e-seeded` batch would work.
  ⚠️ Requires a MEASURED run in the target env first — 158-05 measured them green under the
  unseeded job's placeholder env, which is **not** evidence about the seeded job's env, and
  promoting an unverified spec into a blocking gate is how a required check reddens on an
  innocent PR. The ci.yml comment at the unseeded batch list carries the same warning.

- [ ] **[158-OPS-03] `admin-csv-status-axe.spec.ts` — wire-later (seeded list).** Already
  conforms to the seeded contract (`HAS_SEED_ENV` present, uses the seed helpers) and
  `/admin/csv-status` still exists, so it is a list-membership change plus one run-and-repair
  pass; it is a single axe case, so the cost of proving it is small.
- [ ] **[158-OPS-03] `discovery-sparkline-regression.spec.ts` — wire-later (seeded list).**
  Seed-contract-conformant and pins a DESIGN.md rule (DIFF-05 single-accent sparklines) that
  nothing else asserts; its 4 cases read live seeded rows, so it needs the seeded batch and a
  run against the shared TEST DB before it can gate PRs.
- [ ] **[158-OPS-03] `discovery-watchlist.spec.ts` — wire-later (seeded list), HIGHEST value of
  the 15.** 544 lines including two genuine RLS proofs (unauthenticated `PUT /api/watchlist`
  → 401, and user-B cannot read user-A's favorites) plus an anon `/browse/[slug]` chrome
  check — security assertions currently running nowhere. Prioritize this one.
- [ ] **[158-OPS-03] `for-quants-landing.spec.ts` — wire-later (seeded list).**
  Seed-contract-conformant; most of its 11 cases are anon (`/for-quants`, `/security`,
  `security.txt`) but one describe is logged-in-gated, so the seeded batch is the right home.
  ⚠️ When wiring, dedupe against `security-page.spec.ts` below — both assert `/security`.
- [ ] **[158-OPS-03] `discovery.spec.ts` — wire-later (unseeded list).** 9 lines, one
  placeholder-safe assertion (unauthenticated `/discovery/crypto-sma` redirects to login) that
  no wired spec covers — checked `auth`, `smoke` and `route-redirects`, none of which touch
  discovery. Cheap to prove, cheap to wire; it just has never been run.
- [ ] **[158-OPS-03] `security-page.spec.ts` — wire-later (unseeded list).** Fully anon
  (`/security` and `/`), no seed env, no identity — genuinely placeholder-safe, so the unseeded
  batch fits with no conversion work. ⚠️ Overlaps `for-quants-landing`'s `/security` describe;
  wire one of them, not both, or the assertion runs twice under different owners.
- [ ] **[158-OPS-03] `bridge-flow.spec.ts` — wire-later (unseeded list), with one case to
  tighten first.** 4 of its 5 cases hit the public `/demo` page (placeholder-safe); the 5th
  (`/allocations`) is written to pass EITHER way — it asserts the login redirect when
  unauthenticated and the InsightStrip when not. ⚠️ That case cannot fail, so wiring it as-is
  buys coverage theatre; split it or gate it properly when wiring.
- [ ] **[158-OPS-03] `simulator-flow.spec.ts` — defer.** Gated on `QUANTALYZE_E2E_PASSWORD`, an
  identity env name used by this spec alone and set in no workflow, so wiring it today yields
  an all-skip batch entry. Unblocks by converting to the seed-helper identity contract.
- [ ] **[158-OPS-03] `strategy-detail-tabs.spec.ts` — defer.** Gated on
  `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`, which this phase recorded a decision NOT to provision
  (see 158-05); it would self-skip every case in CI. Same unblock: convert to seed helpers,
  which mint their own users and need no repo secret.
- [ ] **[158-OPS-03] `match-queue.spec.ts` — defer.** Gated on
  `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD` and targets `/admin/match`, so it needs an ADMIN
  identity; the seed helpers mint allocator/manager roles only, so this needs an admin-seeding
  path that does not exist yet — a real piece of work, not a list edit.
- [ ] **[158-OPS-03] `sync-flow-queue.spec.ts` — defer.** Gated on
  `PLAYWRIGHT_TEST_STRATEGY_ID`, which no workflow sets, so all 3 cases would skip. This is the
  same never-run env gate that keeps `api-key-flow`'s and `sync-analytics-flow`'s UI describes
  dormant even now that those two are wired — a fixture-identity problem, not a spec-rot one.
- [ ] **[158-OPS-03] `wizard-sync-regression.spec.ts` — defer.** Same
  `PLAYWRIGHT_TEST_STRATEGY_ID` gate, same all-skip outcome; wire it in the same change that
  provisions a seeded strategy id, not before.
- [ ] **[158-OPS-03] `mandate-form.spec.ts` — wire-later (seeded list), after renaming its seed
  gate.** It IS seed-gated and mints its own user via the service role (the acceptable
  pattern), but its gate constant is `HAS_SEEDED_SUPABASE`, not `HAS_SEED_ENV`. ⚠️ The MA-8
  joining rule keys on `HAS_SEED_ENV`, so adding this spec to the list would satisfy the
  documented contract's list half while the in-spec half silently does not apply. Rename the
  constant in the same change that wires it.
- [ ] **[158-OPS-03] `wizard-hydration-probe.spec.ts` — defer, blocked on removing in-file
  credentials.** Carries a hardcoded demo email + password literal at `:38-39` — the same class
  plan 158-05 removed from `csv-upload-flow` (whose hardcoded login was additionally MEASURED
  not to authenticate against the TEST project). Convert to the seed-helper contract and drop
  the literals; do not wire it with them in place.
  2026-08-20: credential blocker RESOLVED — the `:38-39` literals are scrubbed to env-sourced
  `E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD` with a visible `test.skip` (same commit as the
  `for-quants-onboarding` scrub below). Seed-helper conversion + wiring still open.
- [x] **[158-OPS-03] ⚠️ `for-quants-onboarding.spec.ts` — defer, blocked on a PUBLIC-REPO
  credential scrub (act on this independently of wiring).** `:31-32` hardcode a
  personal-looking gmail address and a short password literal, committed in a repository that
  is world-readable. Deliberately not quoted here so this entry does not re-publish them.
  The credential removal is worth doing on its own schedule — it is not contingent on anyone
  ever wiring this spec — after which the spec converts to the seed-helper contract like the
  others. Flagged by plan 158-06 while triaging; NOT fixed there because scrubbing a
  credential belongs in its own reviewed change, not buried in a CI-wiring commit.
  ✅ 2026-08-20: scrubbed — creds are env-sourced (`E2E_TEST_EMAIL`/`E2E_TEST_PASSWORD`) with a
  visible `test.skip` on the authed describe; comment-only echoes of the same pair in
  `match-queue.spec.ts`/`discovery-watchlist.spec.ts` reworded in the same commit. Wiring +
  seed-helper conversion stay deferred per the entry above.
- [ ] **[158-OPS-03] `portfolio-pdf-demo.spec.ts` — wire-later (unseeded list); the census row
  for this spec was WRONG and is corrected here.** The research table recorded "non-@nightly
  cases orphaned", implying a split. Measured at HEAD: BOTH describes carry the `@nightly` tag
  in their titles (`:99`, `:160`), and `nightly.yml:109` runs the spec with `--grep @nightly`,
  which matches on the full title — so every one of its 8 cases runs nightly and none is
  orphaned. ⚠️ The real defect is the opposite of the one recorded: the token-shape describe's
  own docblock (`:85-97`) states those cases need no `DEMO_PDF_SECRET` and *"MUST run in main CI
  to keep verifier-branch coverage on every PR"*, and an audit split the describes precisely to
  restore that — but the split describe still carries `@nightly` in its title, so the intended
  per-PR coverage never happened. **Fix:** drop `@nightly` from the token-shape describe title
  and add the spec to the unseeded list, so a regression weakening the hex-regex/indexOf
  verifier guard is caught per-PR rather than up to 24h later.
- [ ] **[158-OPS-03] DB-types residual — defer (fix in its own reviewed change):
  `scenario_shares` lost its hand-patch tripwire comment.** Found while recording
  `158-DB-TYPES-DECISION.md`. `database.types.ts:2326` is a
  hand-patched block per its own test docblock (`database.types.test.ts:75-81`, migration
  `20260622120000`) but carries NO in-file `HAND-PATCHED` warning comment, unlike its two
  siblings `for_quants_leads` (`:1072`) and `scenarios` (`:2375`). Its type-level pins are
  intact so the load-bearing control still holds; what is missing is the warning to the next
  person who regenerates — and `:1080-1081` records that a prior regen stripped exactly such a
  comment and a human re-applied it by hand. **Fix:** re-apply a tripwire comment above the
  block. Not done in plan 158-06: it edits a generated file outside that plan's declared scope.

---

## Phase 161.1 — recorded deferrals (logged 2026-08-25)

Filed from the phase's own review rounds (migration-reviewer r3, rls-policy-auditor r2,
`/code-review high`). Everything **blocking** from those rounds was fixed in-phase; what
follows is what was deliberately left, with the reason.

161.1-D1. **⛔ HIGHEST VALUE — the bridge's read window is fail-SAFE, not CLOSED. The real
  closure is a per-strategy advisory lock in the two mark RPCs.**
  - `sync_strategy_analytics_status` derives its verdict from two `compute_jobs` reads. Phase
    161.1 reordered them so a job crossing the boundary mid-derivation lands on the *inclusive*
    read (non-terminal first, permanent-failure last), which makes the race's OUTCOME safe: the
    worst case parks a published row at `computing`, which the 16-hour reaper heals, instead of
    publishing a clean `complete` over a live `failed_final`.
  - **That is not the same as closing the window.** Under READ COMMITTED every `SELECT` takes a
    fresh snapshot, and `mark_compute_job_done` / `mark_compute_job_failed` take `FOR UPDATE` on
    the **job** row only — neither takes a per-strategy lock before `PERFORM
    sync_strategy_analytics_status`. Bridge calls for the same strategy are therefore not
    serialized at all.
  - The codebase already has the right pattern twice: `positions_atomic_rebuild` and `sync_trades`
    both take `pg_advisory_xact_lock(hashtext(p_strategy_id::text))`.
  - **Fix shape:** take the same advisory lock in `mark_compute_job_done` (`20260603120000`) and
    `mark_compute_job_failed` (`20260529180000`) before the bridge call.
  - **Not done in 161.1:** both files are outside the phase's declared scope, and a half-applied
    lock discipline (one RPC locking, the other not) is worse than a documented window — it reads
    as protection while providing none. Wants its own phase and its own concurrency test.

161.1-D2. **⚠️ A systematic enqueue failure in either fan-out is indistinguishable from "nothing
  was stale".** Both `enqueue_ledger_refresh_for_strategies` and `enqueue_ledger_composite_refresh`
  wrap the per-candidate enqueue in `EXCEPTION WHEN OTHERS THEN RAISE WARNING ... continuing`. A
  *systematic* failure — e.g. `enqueue_compute_job`'s exactly-one-of `22023` if strategy-mode
  targeting is ever narrowed — degrades every row to a `WARNING` and the function returns `0`,
  byte-identical to a healthy fully-fresh estate. This is the same lying-instrument shape the
  phase exists to remove, left open on a different axis. Not user-facing and not data-integrity,
  so it did not block. **Fix shape:** have the go-live runbook assert a NON-ZERO enqueue on first
  activation, and/or count swallowed warnings and fail the tick when they equal the candidate count.

161.1-D3. **⚠️ `test_weight_snapshot_seed_secdef.sql:202-214` carries both defects 161.1 just fixed
  one file over.** It pins `NOT r.rolbypassrls` with no `rolsuper` alternative (false-reddens for a
  superuser owner — the flag is only the *explicitly granted* attribute; superuser RLS bypass is
  implicit), and its `IF EXISTS (...)` shape **passes vacuously when the function is absent** —
  measured on a throwaway cluster during this phase, not inferred. Its `OR p.proowner <> v_owner`
  escape makes a false fire less likely but does not close the vacuity. Not in the findings and not
  in scope; the two 161.1 arms deliberately did NOT copy that shape.

161.1-D5. **⛔ `run_stitch_composite_job._stamp_failed` carries the IDENTICAL defect the phase just
  fixed twice.** `analytics-service/services/job_worker.py` (~:5760) reads `computation_status`
  LIVE at stamp time, in the same "ONE select, BOTH columns" as the M-2 flags merge — i.e. its
  guard's oracle is a column the SQL bridge writes, which is exactly the root cause closed on
  hop 1 and hop 2 this phase.
  - **Why it is narrower:** the composite stamp is chain-terminal, so there is no hop-2
    amplification. Its exposure is the F2 shape only — a sibling job's bridge call moving
    `computation_status` mid-crawl and disarming the guard.
  - **Not fixed in 161.1:** it was outside the five findings' file scope, and splitting the read
    touches gate-10/gate-11 territory that a concurrently-edited migration also pins. Fixing it
    blind, in parallel, was the higher risk.
  - **Fix shape:** take the publish snapshot at handler entry and carry it forward, mirroring
    `run_csv_strategy_analytics`'s `refresh_publish_status` / `refresh_publish_warned` keywords.

161.1-D6. **Residual window on the hop-1 oracle — closing it needs the fan-out migration.** The
  fan-out enqueues the derive in SQL, so the earliest oracle Python can take is at handler entry.
  A sibling transition landing between the SQL enqueue and that read still bounces a plain
  `complete` row to `computing`, and the entry read sees it. **The residual fails LOUD, not
  silent** — which is why it did not block. Full closure means minting `publish_status` into the
  job metadata inside `20260825130000` at enqueue time. Documented in-code at the read site.

161.1-D7. **`HealthScore` on grid cards scores a failed row's stale metrics.** `computeHealthScore`
  always returns a number; before the stale-analytics gating a failed row carrying a stale sharpe
  scored ≈93 (green). With the metric cells withheld it now scores ≈33 (muted) — substantially
  better without the component being touched. The residual question is a public-surface UI
  decision: should the badge hide entirely when nothing is computed, rather than score the
  absence? Founder call, not a defect.

161.1-D8. **⚠️ NOT caused by this phase — found during it. `gdpr-export.test.ts`'s binary-search
  trimmer test has a 2.6x timeout margin and WILL redden CI on a loaded runner.**
  - `src/__tests__/gdpr-export.test.ts:257` — "binary-search trimmer packs optimally (I3)".
    **Measured 2026-08-25:** 1902 ms unloaded on an M-series Mac, against vitest's default
    5000 ms `testTimeout`. Under four concurrent agents it exceeded 5000 ms and failed in
    **two consecutive full runs** at a byte-identical tree, then passed in isolation (57/58).
  - It is CPU-bound (a binary search over payload packing), so it scales with runner speed.
    GitHub's shared runners are routinely slower than the machine that measured 1902 ms.
  - **Why this is more than a slow test in this repo:** a red `main` CI makes the Railway
    analytics deploy **SKIP**. So a load-sensitive timeout is a path from "busy runner" to
    "production analytics silently not deployed" — the exact class Phase 158 exists to close,
    reached through test fragility instead of workflow logic.
  - **Fix shape:** give this test an explicit generous `testTimeout` (it is a correctness
    assertion about packing optimality, not a performance assertion — the 5 s default is
    incidental, not intentional), or shrink the fixture so the search is cheap. Do NOT "fix"
    it by retrying.
  - Verified NOT related to Phase 161.1: the file and every module it exercises are absent
    from `git diff --name-only main...HEAD`.

161.1-D9. **⚖️ FOUNDER CALL — D-15 publishes a MIXED-VINTAGE factsheet that did not exist before
  this phase.** Raised by the red team (reasoned, not executed); the mechanism is a direct read.
  - `run_derive_broker_dailies_job` is **not** read-only before it hands off. Before
    `_enqueue_csv_analytics` it has already COMMITTED, for the NEW crawl: `csv_daily_returns`
    rewritten, `persist_basis_series` for all three bases, and `_prestamp_payload` upserted with
    `data_quality_flags` **wholesale-replaced** and `metrics_json_by_basis` authoritative.
  - Hop 2 owns `metrics_json` / `returns_series` / `daily_returns` — the cash headline and the
    chart the factsheet actually reads.
  - So under D-15, a hop-2 failure now leaves a PUBLISHED row holding **new** dq flags + **new**
    by-basis scalars + **new** persisted series, beside **old** `metrics_json` / `returns_series`.
    The guard's `payload.pop("data_quality_flags")` reasons "the live row's flags are still the
    truth" — but hop 1 already replaced them, so the flags describe data the headline does not
    reflect. `computed_at` is correctly not advanced, so the freshness chip advertises the OLD
    vintage over partly-NEW content.
  - **Before this phase that state was never published** — hop 2's failure wrote `failed` and the
    factsheet went dark. **The phase trades "dark" for "showing numbers it cannot justify".** Both
    are top-severity classes here; the trade is nowhere acknowledged.
  - The nearest existing comment calls the fresh-series/stale-scalar direction "benign … the next
    re-derive lands the matching scalar and heals it" — reasoning that ASSUMED the analytics hop
    would follow, which is exactly what D-15 removes. With a ~20h cooldown and a chronically
    failing hop 2, the mismatch is durable, not transient.
  - **This is a founder decision, not a defect:** D-15 was chosen deliberately. The options are
    (a) accept mixed-vintage as better than dark, and say so in the header; (b) have hop 1 defer
    its committed writes until hop 2 succeeds; (c) widen the guard to restore hop 1's writes too.

161.1-D10. **The `v_protect_hold` scoping is narrower than its own comments claim — it misses the
  resync path's first and longest hop.** Arm I3 seeds the resync as a `derive_broker_dailies` job.
  A real resync does not start there: `_is_long_fetch` sends `flow_type in {onboard,resync}` to
  `enqueue_compute_job(p_kind='process_key_long')`. `has_live_successor` requires
  `r.kind = f.kind`, so for the WHOLE duration of the `process_key_long` hop — the slowest in the
  system — the protected failure has no successor, the hold stays TRUE, branch (a) stands down,
  and the row keeps advertising its pre-resync terminal status. The hold releases only when the
  TAIL derive is enqueued, i.e. at the end of hop 1 of 3.
  - The migration's residual note frames what is still suppressed as "an in-flight job of some
    OTHER kind", illustrated with a cron poll. It does not say the user's own resync spends most
    of its wall clock in exactly that state. **Correct the note.**
  - Severity capped: for `complete_with_warnings` rows (the entire live cohort) branch (a) never
    advertised `computing` anyway, so the incremental harm is on plain-`complete` rows.

161.1-D11. **⛔ THE REAL CLOSURE for the reuse-collision class: `enqueue_compute_job` needs a
  metadata MERGE arm.** `_enqueue_compute_job_internal` dedupes on `(target, kind)` and on a hit does
  `RETURN v_existing_id`, **discarding `p_metadata` entirely**. Phase 161.1 closed the consequence in
  Python (the resync tail retracts an inherited refresh marker; both honour-sites re-ask the row),
  but the RPC still silently drops every caller's metadata on every collision, system-wide.
  - **Not attempted same-day, deliberately:** that RPC is on every enqueue path in the system. A
    merge arm changes what every caller's metadata means on collision and needs its own review and
    its own blast-radius check — not a ride-along on a phase fix.
  - A merge arm would also remove the read-modify-write in the retraction helper (see D12).

161.1-D12. **Read-modify-write residual in the marker retraction, measured harmless.** The retraction
  reads then writes `compute_jobs.metadata`; a claim committing inside that window loses
  `unified_backbone_at_claim`. Measured harmless — nothing re-reads that key from the row (the drain
  check takes it from the claim's own returned metadata). Recorded because "measured harmless today"
  is a dated claim: re-check if any reader of that key from the ROW is ever added. Disappears
  entirely once D11 lands.

161.1-D13. **⚠️ THE COMPOSITE TWIN OF THE REUSE COLLISION IS STILL OPEN.** `stitch_composite` carries
  the `ledger-refresh-composite` marker and has **user-initiated** enqueues at
  `src/app/api/keys/sync/route.ts` and `src/app/api/strategies/finalize-wizard/route.ts` — the same
  `(target, kind)` collision, the same root cause, the same silent inheritance of D-15 protection.
  - **Half-closed already:** the Python retraction helper handles the composite marker (it tests the
    union of both markers), so the *honouring* side is covered. **What is missing is the retraction
    call at the two TypeScript enqueue sites** — they were outside the Python fixer's file scope.
  - Until then a user-initiated composite resync colliding with a live composite fan-out job inherits
    protection, and its failure is suppressed exactly as the single-key case was.
  - ⚠️ The composite fan-out ships DORMANT, so this is not reachable on production until the
    schedule is registered — but it must be closed BEFORE that founder-gated go-live op, not after.

161.1-D14. **The redact pre-push guard cries wolf on migration timestamps — INVESTIGATED, nothing
  to fix, do not re-investigate.** `gstack-redact` flags 14-digit migration timestamps as
  `pii.cc` (Luhn-valid credit-card numbers). Verified 2026-08-25: every flagged token in the SQL
  function snapshots maps to a real file under `supabase/migrations/`. Zero PII, zero secrets.
  - Two further findings appear when scanning `git show` output rather than file content: the git
    `Author:` line and the `Claude-Session:` trailer. Both are commit metadata present in every
    commit in the repo, not content this or any phase introduced.
  - **Cannot be suppressed:** `--allowlist` does not suppress Luhn matches (measured: 1 finding
    with and without), and the managed pre-push wrapper accepts no flags — it reads git ref lines
    on stdin only.
  - **Why this matters rather than being a shrug:** the repo is *made of* migration timestamps, so
    this guard fires on nearly every SQL-touching commit. A guard that is wrong that often gets
    tuned out, and then misses a real one. That is the same failure mode this phase spent its
    entire review budget fixing, one tool over.
  - **Fix shape (upstream, not here):** narrow the `pii.cc` rule so a Luhn match inside a
    `YYYYMMDDHHMMSS` shape, or adjacent to a `.sql` filename, is not reported.

161.1-DEC (founder decisions, 2026-08-25). Four open items resolved. Recorded here because each
  reverses or confirms a default that would otherwise be re-derived blind.

  **DEC-1 — Retire frozen-spine gates 1 and 2, KEEP gate 3.** `src/__tests__/phase-29-frozen-spine-guards.test.ts`
  was a Phase 29 exit gate for milestone v1.2 (shipped ~v0.20, May) but carries NO phase scoping —
  it diffs against `origin/main` on any branch, forever. At v0.73 it is a scope fence for finished
  work, and it is what blocks a proper `scenario-share` fix.
  - RETIRE gate 1 (no new scenarios/share migration) and gate 2 (`scenario.ts` frozen vs baseline).
    Both fenced v1.2's scope only.
  - **KEEP gate 3** — the `scenarios`/`scenario_shares` RLS honesty tests staying byte-unchanged is
    the SOLE proof the `get_shared_scenario` SECURITY DEFINER read path was never loosened. Reword
    it as a standing RLS invariant rather than a phase gate, so it stops reading as expired.
  - Unblocks a real `scenario-share` fix (stale legs in a shared blend). Decide that behaviour
    separately once the fence is down.
  - ⭐ **PLACEMENT (founder, confirmed): this lands in PHASE 164.1, not in 161.1's PR.** Retiring a
    guard is a security-adjacent edit to a guard file; burying it in a 55-file feature PR is how a
    considered gate gets removed for an unrelated reason and takes its real protection with it. It
    belongs next to the `scenario-share` decision it unblocks, in a diff where a reviewer can see
    that removing gates 1+2 and keeping gate 3 was the actual intent.
  - **Acceptance for the 164.1 task:** gate 3 must still FAIL when the `scenarios`/`scenario_shares`
    RLS honesty tests are edited (neuter it, observe RED, restore byte-identically) — otherwise the
    retirement of 1+2 has quietly taken 3 with it, which is the whole risk this placement exists to
    avoid.

  **DEC-2 — D9: WIDEN THE GUARD to restore hop 1's writes.** Founder chose the widen path over
  making the refresh atomic. ⚠️ Recorded honestly: I recommended atomicity (stage hop 1, promote on
  hop 2 success) and was overruled. The reasoning against widen still stands and must be designed
  around, not ignored:
  - The guard does NOT currently hold hop 1's pre-values — hop 1 overwrites `data_quality_flags`,
    the by-basis scalars and the persisted basis series before hop 2 runs. So widening needs BOTH
    (a) a NEW snapshot at hop-1 entry of everything hop 1 will touch, and (b) a restore of all of
    it on the hop-2 failure path.
  - (b) adds bulk to the least-exercised code in the system. F3, F4 and this phase's CRITICAL all
    lived on failure paths precisely because they only run when something already went wrong.
  - ⭐ Design note for whoever implements it: once (a) exists, staging is strictly simpler than
    write-then-unwrite. If the snapshot turns out large or awkward, revisit atomicity before
    growing the failure path.

  **DEC-3 — D13 closes in 164.1, BEFORE any go-live.** Confirms the filed plan. The composite
  reuse collision is unreachable while dormant, which is exactly why the ordering constraint must
  stay explicit: closing it is a prerequisite of the activation op, not a follow-up to it.

  **DEC-4 — D1 advisory lock gets its OWN phase, with a real concurrency test.** Not folded into
  164.1. It touches two RPCs that run on every job transition for every strategy, and a
  half-applied lock discipline reads as protection while providing none. 164.1 is otherwise guards
  and observability (low blast radius); this would dominate its risk profile. Needs a test that
  genuinely exercises concurrent bridge calls, not a unit test.

161.1-D4. **Prose/derivation nits, non-blocking.**
  - `analytics-service/tests/test_computing_started_at_stamp.py:649` — census docstring
    self-contradicts: says "the 7 in analytics_runner.py are unchanged in COUNT" and "7 of those 11"
    while asserting 8 and 12.
  - `supabase/tests/test_ledger_refresh_composite_arm.sql:82` — "having executed ZERO of arms A-I"
    left as-is deliberately: it is a dated record of a measurement taken when the file had arms A–I.
    Editing it to A–J would misstate what was measured.

- [ ] **[DRIFT-04] `create_allocator_connected_strategy` exists in PROD under no migration** — surfaced 2026-08-29 by diffing `supabase/schema/baseline.sql` function names against `supabase/schema/functions/` (119 in PROD vs 118 snapshotted). It is `SECURITY DEFINER`, `OWNER TO postgres`, `SET search_path TO public,pg_catalog`, and `GRANT ALL ... TO authenticated` — so every logged-in session can reach it at `/rest/v1/rpc/`. It writes encrypted credential material (`p_api_key_encrypted`, `p_api_secret_encrypted`, `p_passphrase_encrypted`, `p_dek_encrypted`, `p_nonce`, `p_kek_version`) into `api_keys` + `strategies` + `portfolio_strategies`. Its own COMMENT cites "migration 043", a legacy numbered file absent from this repo. Nothing in `src/` calls it (`database.types.ts` is generated FROM the DB, so it proves existence, not use). Body guards look correct from the dump: raises without an auth session, raises when `p_user_id` != `auth.uid()`, checks portfolio ownership — **no exploit is claimed**. The issue is governance: an authenticated-reachable SECDEF credential-writing RPC that no file in this repo defines, that no PR ever reviewed, and that any hardening of the wizard RPCs (incl. Phase 156 CONNECT-REFACTOR) silently will not cover. **FOUNDER DECISION 2026-08-29: DROP it.** Adopt-then-drop was the earlier recommendation and it no longer holds — committing `supabase/schema/baseline.sql` secured reversibility (the verbatim body is in git; a revert migration can be cut from the file), which was adopt-first's whole justification. What remains of adopt-first is two production DDL changes instead of one, plus transcription risk: `CREATE OR REPLACE` with a body differing even slightly from live IS a production behaviour change, and pg_dump's rendering is not the original source. MEASURED 2026-08-29: the function still WORKS (it supplies all four `api_keys` NOT NULL-without-default columns) and is PostgREST-exposed (present in the `public` schema `Functions` block of the generated `database.types.ts`), so this is not dead-by-decay. Migration shape, owned by Phase 164.5: `DROP FUNCTION public.create_allocator_connected_strategy(<exact 11 arg types>)` with **NO `IF EXISTS` and NO `CASCADE`** — `IF EXISTS` silently no-ops on a signature mismatch (a vacuous pass) and `CASCADE` silently removes dependents. Pre-flight must (a) assert the live body matches `baseline.sql` and abort otherwise, (b) assert zero dependent objects, (c) read `pg_stat_statements` for call evidence and **abort saying so when it is unavailable — never infer zero calls from an absent measurement**. NOT in 164.3: production DDL on a credential surface gets its own review. ⚠️ One unverified claim to settle first (the drop makes it moot either way): the function's COMMENT asserts `source='allocator_connected'` keeps the row off Discovery; `src/lib/strategy-sources.ts` only enumerates the value and the actual Discovery/ranking filter was NOT traced. If that filter does not hold, this is ranking integrity, not governance.
- [ ] **[DRIFT-05] add the PROD→snapshot direction to the function-snapshot gate** — today `dump-sql-functions.ts --check` compares migrations→snapshot and is hermetic by design, so a function present in PROD but in no migration is absent from its input and therefore from its diff: structurally invisible, permanently green. `supabase/schema/baseline.sql` makes the missing direction computable; a name-set diff is a two-line assertion. This is how DRIFT-04 would have been caught years ago. **FOUNDER DECISION 2026-08-29: build it, as TWO gates in Phase 164.5, and do not conflate them.** (a) HERMETIC name-set diff, both directions, comparing two COMMITTED files — `baseline.sql`'s function names against `supabase/schema/functions/*.sql`. No credentials, no Docker, no network, cannot flake; a third assertion inside `dump-sql-functions.ts --check`. It catches the DRIFT-04 class but only AS OF THE LAST BASELINE REFRESH. (b) baseline-vs-LIVE staleness — needs credentials, so it rides the PR-triggered credentialed job VAC-04 already uses; this is WINDOWS.md 29. Shipping (a) while believing it covers (b) would be a control that reads green while blind — the exact defect class Phase 164.3 exists to eliminate. Build (a) first: it costs nothing and closes the measured hole.
- [ ] **[SEC-DRIFTPATHS-01] ⚖️ FOUNDER DECISION NEEDED — confirm the `Production` environment carries REQUIRED REVIEWERS.** Raised 2026-08-29 by the Phase 164.3 ship-stage security specialist. `.github/workflows/migration-drift-check.yml` runs `environment: Production` with `SUPABASE_DB_PASSWORD` + `SUPABASE_ACCESS_TOKEN` in env, and its `paths:` filter includes the gate's own implementation — `scripts/prod-body-drift-check.sh`, `scripts/sql-body-normalize.mjs`, and (added by SP-C05) `scripts/sql-function-names-naive.mjs`. So a PR touching ONLY those files triggers a credentialed run that executes script content **from the PR head**. That is intended: "edits to the gate must re-run the gate" is the whole point of those entries, and a gate whose own edits do not re-run it is the claim-vs-thing defect this phase exists to remove. **This is NOT a code fix and the workflow was deliberately left alone.** Fork PRs are already excluded by the same-repo `if:` at `migration-drift-check.yml:55`, so the blast radius is **push-access collaborators**, which today is the founder alone. The mitigation, if that ever stops being true, is GitHub's environment protection: required reviewers on `Production`. **What the founder must confirm:** open Settings → Environments → Production and record whether required reviewers are configured. If they are, this item closes as verified. If they are not, it is arbitrary code execution with the production DB password for anyone with push access, and it should be configured before the first non-founder committer. ⚠️ Do NOT "fix" this by removing the script paths from the filter — that would silently restore a gate that its own edits cannot re-run.

- [ ] **[GSD-02] `phase-plan-index` drops `depends_on` when the line carries a trailing `#` comment** — measured 2026-08-29 on phase 164.3: plans 06 and 09 declare `depends_on: [...] # no code dependency — sequential ci.yml ownership`, and the tool reported both as wave 1 with a warning that the DAG disagreed with the declared wave. Plan 10, whose `depends_on` carries no comment, resolved correctly. Following that DAG would have put plans 02, 06 and 09 — three editors of `.github/workflows/ci.yml` — in a single parallel wave. Execution used the DECLARED waves instead. Upstream gsd-core parser bug; not fixed here.

---

## Phase 164.3 round-4 residuals — ⚠️ SUPERSEDED 2026-08-29: 9 of 11 are now OWNED BY PHASE 164.3.1

Logged 2026-08-29 under the founder rule "fix the criticals, log the remaining in TODOS".
Round 4 ran three agents in parallel over `4106db31..HEAD` (gsd-code-reviewer,
silent-failure-hunter, testing).

⚠️ **STATUS CHANGED THE SAME DAY. Do NOT work these as loose TODOS.** Writing them up
established that FOUR primitives were cycling, not two: [VAC04-C] meets the same
four-instance trigger that created 164.3.1, and "a control whose own oracle or fixture
agrees with it by construction" is a fourth. **Founder decision: scope all four into
164.3.1.** The phase was edited in place — see `.planning/ROADMAP.md` Phase 164.3.1 and the
Roadmap Evolution entry in `.planning/STATE.md`.

**Owned by 164.3.1 (do not fix here):** [VAC04-C] and members [VAC04-C1] [VAC04-C2]
[VAC04-C3] [VAC04-C4] (PRIMITIVE C); [AUDCOV-01], [VAC-SELFREF-01], [MUT-W02] (PRIMITIVE D,
plus AUDCOV-01's live stripper regression); [MUT-I01] (folded into PRIMITIVE A's tokenizer).
They are kept below because the phase description cites these IDs and the measured detail
lives here — a deferred finding that cannot be acted on without re-deriving it quietly
expires. Close them when 164.3.1 closes, not before.

**Still genuinely open as TODOS:** [MUT-I02] and [MUT-I03] only — both prose.

- [ ] **[VAC04-C] "VAC-04 reports PASS having compared nothing" is a THIRD cycling primitive, four instances deep** — lineage: (1) R1 `WR-01` — "absent → new function, pass" with no floor on `checked`; (2) R2-W03 — the `accounted != NAME_COUNT` floor was tautological; (3) ship-stage `SP-C05` — the name index and the body fetcher were one code path, so `sanitize_user$v2` vanished from both; (4) round 4, below. Four fixes, four re-openings, each closing the previous example. Members [VAC04-C1]..[VAC04-C4]. The unifying defect is that the gate's "I found nothing to compare" path exits 0, so every blindness in any reader converts directly into a green gate over PRODUCTION function bodies. **Fix direction: make the ZERO path itself fail closed** rather than adding a fifth reader — a gate that compared nothing should be required to say so and stop.
- [ ] **[VAC04-C1] the two name readers' blind spots COMPOSE — gate exits 0 printing "Two independent readings agree"** (reviewer R4-C03, Critical) — `scripts/sql-function-names-naive.mjs:83-86` (`DEF_RE`) + `scripts/sql-body-normalize.mjs` (`extractFunctionDefs`), unioned at `scripts/prod-body-drift-check.sh:207-217`. The naive reader cannot see a definition that does not START a line; the lexer cannot see a `$` in an identifier. A single definition trips both. MEASURED at HEAD, three shapes where BOTH return the empty set: `CREATE OR REPLACE FUNCTION\n    public.sanitize_user$v2(p uuid)`; `SELECT 1; CREATE OR REPLACE FUNCTION public.mid$v2(p uuid)`; `CREATE\n  OR REPLACE FUNCTION public.split$v2(p uuid)`. Driven end-to-end through the real gate with CI-shaped stubs on shape 1: `::notice::VAC-04 …: this PR's migrations define no functions — nothing to compare. (Two independent readings agree; see SP-C05.)` / `GATE EXIT=0`. The parenthetical IS the finding: two readers that failed for two *different* reasons on the *same* line are not corroboration. Corpus-wide claim holds TODAY — both readings independently re-derived over all 380 `.sql` files under `supabase/migrations/` + `supabase/schema/functions/`, **0 disagreements** — so this is latent, not live. **Fix:** on the zero path only, run a deliberately crude third reading (`--strip-comments` piped to `grep -aqiE 'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION'`) and `MEASURE_FAIL` if it still sees a definition — a refusal to guess, not a gate (7 of 262 migrations mention it in prose, which is why it must not red-light on its own). Also fix the naive reader's own blind spot: `DEF_RE` should match the whole text with the `m` flag and allow `FUNCTION[ \t\r\n]+`, which removes shapes 1 and 3 from the composition entirely.
- [ ] **[VAC04-C2] the main-module guard no-ops on any symlinked path or path containing a space, so one union member silently never executes** (silent-failure-hunter, Critical) — `scripts/sql-function-names-naive.mjs:224` and `scripts/sql-body-normalize.mjs:623`, both spelled `process.argv[1] && import.meta.url === \`file://${process.argv[1]}\``. The left side is realpath-resolved and percent-encoded; the right side is raw. MEASURED 2026-08-29 with a passing control so the probe can distinguish: plain path `naive=true correct=true`; via symlink `naive=false correct=true`; path containing a space `naive=false correct=true`. When false, `main()` never runs, stdout is empty, **exit 0** — and the gate reads empty stdout as "the independent reading found no names", collapsing the union to the single parser `SP-C05` was about while still printing *"Two independent readings agree"*. On macOS `/tmp` → `/private/tmp` is enough to trigger it, so any operator running these from a temp checkout gets a silent no-op. **Both** union members carry the identical guard (the newer file copied it), so the two "independent" derivations fail together through one mechanism. The repo already documents the correct idiom at `scripts/check-banned-packages.mjs:439-448`: `realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)`, with the realpath rationale in a comment. **Fix:** adopt that idiom in both files. (`scripts/lint-sql-gates.mjs:953` uses `resolve()` — better, still not realpath-safe.)
- [ ] **[VAC04-C3] `grep -aqxF` exit 2 (unreadable index) is indistinguishable from exit 1 (not in index), and both print "measured absent — pass"** (silent-failure-hunter, High) — `scripts/prod-body-drift-check.sh:425`. This is the WR-01 disambiguator: when the fetcher returns an empty body, the gate asks the name index which fact that is. `if grep -aqxF -- "$fname" "$TMP/prod-names.txt"` takes the `else` branch on BOTH "no match" and "file unreadable / I/O error", and the `else` prints `${fname}: measured absent — not in the PROD source's ${PROD_NAME_COUNT}-name index. Treated as a NEW function (pass).` So an unreadable index turns the fail-CLOSED arm into a fail-OPEN one — in the exact arm written to prevent a fail-open, whose own error text says "A gate that could not read cannot report a pass." **Fix:** capture the exit code on its own line after a bare invocation (so `$?` is really grep's, per SP-M01), branch on `0`/`1`, and treat `>= 2` as a hard `fail` naming the code.
- [ ] **[VAC04-C4] a non-ASCII unqualified identifier is TRUNCATED by one reader and dropped by the other, so VAC-04 compares the WRONG function** (reviewer R4-W01, Warning by severity, worst failure mode in the set) — `scripts/sql-function-names-naive.mjs:85` and `scripts/sql-body-normalize.mjs`, both `[A-Za-z0-9_$]`. Postgres accepts unquoted non-ASCII identifiers. MEASURED at HEAD on `CREATE OR REPLACE FUNCTION public.sanitize_üser(p uuid)`: lexer returns nothing, naive returns `sanitize_`. Driven through the gate: it warns about `sanitize_`, reports `sanitize_: measured absent … Treated as a NEW function (pass)`, `GATE EXIT=0`, and never looks at `sanitize_üser`. If PROD holds a real `sanitize_`, the gate compares THAT function's body against `supabase/schema/functions/sanitize_.sql` and reports MATCH — a clean result for the wrong subject, strictly worse than the silent pass SP-C05 removed. **Fix:** truncation must be impossible. Validate the captured chain against `^(?:"[^"]*"|[A-Za-z0-9_$]+)(?:[ \t]*\.[ \t]*(?:"[^"]*"|[A-Za-z0-9_$]+))*$` and THROW rather than letting the chain regex stop at the first illegal byte; same guard in `extractFunctionDefs`. Note both readers currently agree by *both* being ASCII-only — another instance of [VAC04-C1]'s shape.

- [ ] **[AUDCOV-01] the SP-I01 fix REOPENED the phantom-block hazard whose justification it deleted — a multi-line template literal containing `/*` blinds the detector for the rest of the file** (reviewer R4-C04 + testing specialist, Critical) — `src/__tests__/audit-coverage.test.ts:159-178` (`unmatchedBlockOpen`), consumed at `:180-205` (`stripBlockComments`). The pre-fix code entered a block only on a line-LEADING `/*` and its comment said why: entering on any occurrence would let a string such as `"src/**/*.ts"` open a phantom comment and blank the rest of the file. Commit `4dfda654` deleted that sentence and asserted the risk "is closed properly instead of avoided: `unmatchedBlockOpen` tracks quote state". It tracks quote state **per line, reset at every newline** — and multi-line template literals are legal TypeScript. MEASURED against the file's own real bytes (transpiled slice of `MUTATOR_CALL_RE` … `findMutations` + `stripLineComment`, nothing retyped): A) multi-line template containing `/*` → `sites: []` ⛔; B) control, identical without the `/*` → `sites: [line 5]` ✅; C) single-line string `/*`, the shipped SP-I01 arm → `sites: [line 3]` ✅. **The pre-fix code found site A.** Live impact TODAY: none — both strippers A/B'd over all 194 non-test files under `src/app/api`, route files with a site-set difference: 0. But a missed site is a DB write with no audit event that the counted `ALLOWLIST` then certifies as covered, and all three shipped SP-I01 arms use single-line strings, so the fixture agrees with the claim by construction and nothing can catch it. ⚠️ This is a pre-existing gate on `main` (H-0001) made BLINDER than it was, not new machinery with holes — that distinction is why it is filed Critical. **Fix:** carry string state across lines the way `inBlock` already is, forcing `quoteAtEnd` to `null` for `'` and `"` (an unterminated one is a syntax error) so only a backtick survives a newline and the runaway stays bounded exactly as the original comment argued. Add the three-arm table above as the test, with B as the calibration control so the arm cannot pass on a stripper that returns everything.

- [ ] **[VAC-SELFREF-01] `lint-sql-gates.test.ts` asserts properties of a string literal it defines two lines above — the SP-C04 shape, reintroduced in the same fix round that removed it** (testing specialist, Critical) — `src/__tests__/lint-sql-gates.test.ts:182-186`: `const banner = "-- RED FIXTURE (see the rule for the mechanism).\n";` followed by `expect(banner).toContain("RED FIXTURE")` and `expect(banner, "the OLD assertion passes on a fixture with no attribution at all").not.toContain(attribution(first))`. Both assertions are about a constant defined in the same block; neither can fail for any change to `lintFile`, the fixtures, or the rule set. The surrounding calibration (the `crossAttributed` mutation) IS real and does bite — only the two `banner` lines are vacuous. Confirmed present at HEAD 2026-08-29. **Why it matters beyond the two lines:** "assert a constant the test itself defines" is a FOURTH cycling primitive, removed from `local-stack-teardown-assertion.test.ts` and reintroduced here within one fix round — evidence that closing vacuity findings by writing more untested test code reproduces the defect. **Fix:** read the banner from the fixture on disk, or delete the two lines; the `crossAttributed` arm already carries the real property.

- [ ] **[MUT-I01] `neuterArm`'s forward statement scan and `statementEndLine` do not use `executableText`, so one file has two different ideas of what a SQL line contains** (reviewer R4-I01, Info) — `scripts/mutation-runner/run.mjs:397-419` (forward scan) and `:608-628` (`statementEndLine`). Both walk raw characters tracking only `'`, with no masking of `--` comments or dollar-quoted bodies, while `executableText` sits ~200 lines above and exists precisely to do that. MEASURED consequence on a legal multi-line RAISE — `RAISE EXCEPTION 'TEST FAILED (X 1): boom'   -- it's the guard` / `USING HINT = 'check the policy';` — the apostrophe inside the `--` comment flips `inQuote`, the scan runs to EOF, and the runner returns `could not find the end of the RAISE statement for "X 1"`: a spurious `neuter-missed`. That is the LOUD direction so it is not a leak, but it is a false refusal **164.4 will hit while backfilling 70 files**, and the reverse parity (an even number of stray quotes) would over-neuter SILENTLY instead. `failureBranches` inherits the same scanner. **Fix:** route both scans through `executableText` per line before the character walk, or give `statementEndLine` the same masking — one definition of "what is code" per file. ⚠️ Adjacent to 164.3.1's Primitive A but NOT the same defect: 164.3.1 replaces the branch-head *classifier*; this is the statement-*extent* scanner. Worth folding into that phase's tokenizer if the design allows.
- [ ] **[MUT-I02] `sql-function-names-naive.mjs`'s corpus-measurement header understates the migration count by 148** (reviewer R4-I02, Info) — `scripts/sql-function-names-naive.mjs:64` says "MEASURED 2026-08-29 over the whole corpus (114 files under `supabase/migrations/` and 118 under `supabase/schema/functions/`)". MEASURED at HEAD: `supabase/migrations/*.sql` = **262**, `supabase/schema/functions/*.sql` = 118, total 380. The sibling claim at `scripts/prod-body-drift-check.sh:212` ("all 380 .sql files") is correct, and the RESULT is correct — both readings re-derived over all 380 files, 0 disagreements — only this one header's denominator is wrong. Prose-only, non-blocking per the review stopping rule. **Fix:** `(262 files under supabase/migrations/ and 118 under supabase/schema/functions/)`.
- [ ] **[MUT-I03] document that concurrent agents editing the tree make the mutation runner's own `dirty-checkout` gate red for unrelated reasons** (reviewer R4-I03, Info) — during round 4 the runner's `dirty-checkout` detector fired with `M src/__tests__/audit-coverage.test.ts`; the diff was another agent's uncommitted `it("PROBE multi-line template with unmatched slash-star", …)` with a `console.log` and no assertion, independently probing [AUDCOV-01]. Reverted, not at HEAD, not in the reviewed range. Two observations worth keeping: (1) `dirty-checkout` works and is worth keeping; (2) the next operator should not chase a red that belongs to a concurrent editor. **Fix:** one line in the runner's header naming the interaction.
- [ ] **[MUT-W02] the per-job tolerance pin asserts ONE literal spelling, so an equivalently-written tolerance arm widens the aggregator silently** (reviewer R4-W02, Warning) — `src/__tests__/lint-sql-gates.test.ts:341-360`. The posture arm is the right design and the POPULATION half is genuinely derived from `ci.yml` (confirmed: it fails if a fourth job appears). The `tolerance: null` half is only ``const arm = new RegExp(`\\[ "\\$name" = "${job}" \\]`)``. That is one spelling; `[ "${name}" = "sql-mutation" ]`, `case "$name" in sql-mutation)`, `[[ $name == sql-mutation ]]`, or an `if:` on the job itself all install a tolerance the pin cannot see. All three arms in `ci.yml` use the pinned spelling today, so this is future drift, not a live hole — but "cannot silently widen" is the property the fixer claimed and it is not what is asserted. **Fix:** parse the aggregator's `if/elif` chain and range over its branch conditions (`/"\$\{?name\}?"?\s*(?:=|==)\s*"?([a-z0-9-]+)"?/g`), asserting `named.has(job) === (tolerance !== null)` per job, plus a `named.size > 2` floor so the arm cannot pass on an empty set.

- [ ] **[VAC08-LEDGER-32] 32 repo migrations have no TEST ledger row — measured, baselined, and NOT yet applied** — surfaced 2026-08-30 by VAC-08's first working run (CI 33277829284, PR #724). The count fell 253 → 56 → 53 → 32 as each of four ledger naming conventions was found by the gate's own shape diagnostic; the enumeration is now closed (a basename is `<ts>_<desc>` and `name` has held the whole thing, the description, the timestamp, or nothing — there is no fifth substring), so **32 is real drift, not a join bug**. Arithmetic closes in both directions: 237 of 239 ledger rows now match a repo file and 230 of 262 repo files match a ledger row, leaving no spare rows to explain the 32. They are carried in `scripts/vac08-ledger-baseline.txt` as a dated RATCHET — the gate still fails loud on any *new* migration that misses TEST, and a baselined entry that later turns up present is a hard failure ("delete this line"), so the file can only shrink. ⚠️ **LEDGER ABSENCE IS NOT OBJECT ABSENCE.** These have no `schema_migrations` row; whether their objects exist in TEST (hand-applied, or installed by a later migration) is a different question this gate does not answer, and the body half of VAC-08 reports all four checked function bodies MATCHING the committed snapshot. Do not read the list as "TEST is missing 32 features". ⚠️ **Four are security migrations** — `20260529150000_lock_profile_privileged_columns`, `20260814120000_wizard_rpcs_revoke_authenticated`, `20260715120000_grant_anon_execute_current_user_has_app_role`, `20260823120000_revoke_api_keys_insert` — so any RLS/SQL test asserting those grants may be asserting them against a schema that never received them; worth a targeted object-level probe before trusting those tests. ⛔ `20260823120000_revoke_api_keys_insert` refuses BY DESIGN on a database it cannot identify and may never be applicable to TEST. ⛔ **Do NOT hand-apply these to TEST to shorten the list** — TEST is shared with other people's CI; that is a founder decision, not an agent one. Owner: Phase 164.5 (which already owns the drift-gate family), or a founder call to apply them.

- [ ] **[SQLTEST-GLOBALPRE-01] `test_ledger_refresh_fanout.sql` asserts a GLOBAL precondition on the SHARED test database, so anyone's leftover row reds it** — measured 2026-08-30 on PR #724 CI run 33278937294: `psql:supabase/tests/test_ledger_refresh_fanout.sql:595: ERROR: TEST PRECONDITION FAILED: 1 committed strategy/strategies on this database are already stale, live and ledger-backed... Park or clean them in the test project`. **Not caused by that branch** — it never touched the file (only `test_strategy_shares_rls.sql`), and main was green 2026-08-28. The file's reasoning is sound in isolation: a competing stale strategy would fight its fixtures for the global per-tick LIMIT and make arms G1/G2 measure the wrong thing, and it correctly refuses to touch rows it did not seed (its own D-05 note: shared project, concurrent PRs). But refusing to run is still a red board, and the precondition is a statement about **the whole database**, not about its own fixtures — which is exactly the anti-pattern already fixed for the e2e specs in PR #654 (⭐"e2e specs assert their OWN seed invariant, NOT global empty-state"). On a database shared with other people's CI this arm reds for reasons no author controls, and the standing remedy — "park or clean them in the test project" — is a WRITE to shared TEST, i.e. a founder action, not an agent one. **Two candidate fixes, both out of Phase 164.3's scope:** (a) scope the per-tick LIMIT contention check to strategies this file seeded (tag its fixtures and compare within the tag), so the arm measures its own invariant like the e2e specs now do; or (b) keep the global check but downgrade it from a hard precondition to a SKIP-WITH-REASON that is counted and reported, so a polluted shared DB is visible without being indistinguishable from a real fan-out defect. ⚠️ (b) needs care: an uncounted skip that exits 0 is `SKIP-01`, this repo's own named defect — the skip must be tallied and surfaced, never silent. ⭐ **ROOT-CAUSED + cleared 2026-09-01.** The offending row was a leaked e2e seed: `e2e-sfox-verified-*`, owner `@example.test`, created 2026-08-25, `stale_reason='series_behind'`, last return 2026-08-24. **Leakage is structural, not a one-off** — `e2e/helpers/seed-test-project.ts:1347` seeds the strategy `published` with a deterministic 120d series ending the day before the seed, which the view's own verdict reads stale after 4 days, and teardown is the caller's `afterAll` (`cleanupSfoxVerifiedStrategy:1443` -> `cleanupStrategiesByNamePrefix:345`). ANY aborted or crashed e2e run therefore leaves one behind permanently; the seeder's own comment at `:335-343` already concedes it ("cleanup is the caller's responsibility and no caller cleans", 5,153 published rows as of 2026-07-02). So this WILL recur on the next leaked sfox / deribit / mt5 seed. Cleared by hand for 2026-09-01 only: deleted scoped to a single `id` (never to the predicate — D-05), after confirming `public.strategies` carries no `BEFORE DELETE` trigger and that a plain delete is exactly what the missing `afterAll` would have done (`strategy_analytics` cascades via FK); verified in a fresh session, `offending_rows = 0`, and `sql-tests` then passed. The orphaned `api_keys` row and two `auth.users` were left — neither enters `ledger_refresh_staleness`, which starts `FROM strategies`. ⚠️ Fix (a) is harder than it reads: arms G1/G2 deliberately measure a GLOBAL bound (the per-tick `LIMIT` and per-venue cap are global), so id-scoping alone does not give them the exclusivity they need — do NOT resolve it by widening a tolerance to a magic number. Owner: unassigned; raise with the shared-test-db runbook (`docs/runbooks/shared-test-db-mutex.md`), which already documents the queue-depth vs wedged-holder distinction for the sibling failure mode.
