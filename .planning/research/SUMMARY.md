# Project Research Summary

**Project:** Quantalyze
**Domain:** Targeted backlog burndown on a live, continuously-deployed platform (Next.js 16 App Router on Vercel + Supabase Postgres/RLS with auto-apply-on-merge migrations + FastAPI worker on Railway + GitHub Actions against a SHARED remote TEST Supabase project, **no branch protection** — every CI gate is advisory at merge)
**Researched:** 2026-08-20
**Confidence:** HIGH

> **Scope note.** This is NOT ecosystem research. All four files are targeted passes over specific
> v1.20 items (groups RANK / SHARE / WIZERR / HONEST / OPS / SEC / DEPS per `.planning/REQUIREMENTS.md`).
> Nearly every claim was read from source at HEAD `ca3f0c5c` or measured from a registry / CI log.
> Where TODOS.md's own description of a problem was found to be wrong, the research says so — and in
> three cases (#686, #606, the concurrency remedy) **TODOS.md is wrong and the plan must not inherit it.**

## Executive Summary

v1.20 is not a feature milestone; it is a burndown of ~50 verified-open items whose difficulty is
concentrated in **four traps that all ship green**. The research's single most valuable output is that
the "obvious" fix for each of the four is measurably the wrong one: (1) the SHARELINK-01 token cannot
be threaded through the factsheet `cacheKey` string — the wrapper splits at `"::"` and discards the
tail, so the intuitive fix silently publishes a private strategy to every anonymous visitor for a
3600s TTL, strictly worse than the bug being fixed; (2) the ranking filter must not be
`.eq("computation_status","complete")` — that drops `complete_with_warnings`, a terminal *success*,
and re-forks a predicate two migrations were spent unifying; (3) "shrink the `shared-test-db`
concurrency group", the remedy TODOS.md proposes, does not address the eviction rule at all, because
the bug is concurrent **run count**, not member count; (4) the pip dependabot PR #685 **silently
downgrades production pandas 3.0.3 → 2.3.3** because `requirements.in` has been lying since PR #604.

The recommended approach is therefore ordering-first, and the ordering is forced by measured
dependencies rather than by preference. **OPS must be the first phase** — the concurrency eviction
makes main-branch CI conclude `cancelled` (grey, not red), which makes Railway silently skip the
analytics deploy (issue #616); running a 9-PR dependency campaign against an unfixed group
*guarantees* at least one silently-skipped deploy, and #685 is 100% `analytics-service/`, so it is
exactly the PR that would sit undeployed. **RANK is early** because it is pure read-path, zero DDL,
zero deploy ordering, trivially revertible, and it front-loads the cheap PROD census. **SHARE is its
own late phase** because it is the only item introducing a new public, anonymous, unauthenticated
surface, with its own migration, its own token module, its own cache invariant and two unresolved
product decisions — it should not share a PR with anything. **DEPS is last**, strictly after OPS, one
PR at a time.

The risks are mitigated by four disciplines the research names explicitly: bypass-don't-re-key on the
share cache (with an *ordered adversarial* test — token request first, then anon 404 — demonstrated
RED with the bypass neutered); `isComputedAnalytics()` never a status literal, plus a PROD
before/after population snapshot as a gate rather than a nicety; an external FIFO mutex plus a
`cancelled`-conclusion watcher instead of a smaller group; and a prerequisite one-line commit fixing
`requirements.in` to `pandas==3.0.3` *before* #685 is touched at all. Two of the nine dependabot PRs
should never land: **#614 (TypeScript 7) close, do not merge** — TS 7 is the Go port whose root export
is `version.cjs`, and this repo consumes the compiler API in the error-classification coverage-law
gate; **#606 close as stale** — three of its four booked claims are false at HEAD.

## Key Findings

### Recommended Stack

No new technology is required anywhere in v1.20. Every gap closes with code already idiomatic here
(`unstable_cache` + `revalidateTag`, hash-in-Node share tokens, SECURITY DEFINER RPCs,
`createAdminClient()` writers, `withPublishedOnly`, `isComputedAnalytics`). The only genuinely new
*dependency-shaped* decision in the milestone is an external GitHub Actions mutex to replace the
native concurrency group. The stack research is therefore a **dependency-campaign verdict table**, not
a selection exercise: six of the nine PRs are cheap, one is a trap, one is a silent production
downgrade, one must not land.

**Core decisions:**
- **`typescript` stays at 6.0.3** — 6.0.3 is already the newest 6.x; TS 7.0.2's root export is
  `./lib/version.cjs` (measured via `npm view`), so `ts.SyntaxKind` / `createSourceFile` are
  unreachable, breaking `src/lib/seam-log-coverage.test.ts` (the WIZFORM-02 coverage law) at *import*;
  and `typescript-eslint@8.58.0`'s peer range is `>=4.8.4 <6.1.0`. Close #614, do not shim.
- **`pandas` stays at 3.0.3 in `requirements.txt`** — the *lock* is right and `requirements.in` (still
  `2.2.3`) is the file that is wrong. Prerequisite commit on `main` fixes the `.in`; then re-run
  `cd analytics-service && make lock` (a `uv pip compile --universal` artifact — Dependabot's edit does
  not match the format).
- **#686 (29 npm updates) needs a rebase + `npm install`, not a bisect** — all nine red checks fail at
  the same `npm ci` EUSAGE (missing `proxy-agent` subtree Dependabot mis-materialised);
  `npm ci --dry-run` on `main` is clean, so the desync is PR-introduced.
- **Retarget two PRs before landing:** `@testing-library/jest-dom` **7.0.1** (not 7.0.0) and `jsdom`
  **30.0.1** (not 30.0.0 — 30.0.0 regressed `getComputedStyle()` with `calc()`). jsdom 30's only
  breaking change is `engines` excluding **local Node 25** (CI Node 22 is fine) — an inversion of the
  repo's usual hazard, to be decided explicitly, not discovered as a flake. Bonus: jsdom 30 moves
  `undici` to ^8, clearing a standing high advisory.
- **`supabase/setup-cli` 3.0.0 changes the install source GitHub→npm** on the four workflows that
  auto-apply migrations to PROD. Lands **alone**, validated on `migration-drift-check.yml` first, with
  `supabase --version` == `2.98.2` confirmed in the plan job log.
- **One-line free win:** bump the `fast-uri` override `^3.1.4` → `^3.1.5` (the current override pins to
  the last *vulnerable* version).

### Expected Features

Feature research covered SHARE (SHARELINK-01) only — revocable capability-URL sharing of a private,
unpublished factsheet, benchmarked against Google Docs / Notion / Figma / Dropbox / DocSend.

**Must have (table stakes):**
- **Copy Link always produces a link that works** — this IS the founder-hit defect; the fix is
  mint-on-copy, not hide-the-button.
- **Mint-or-REUSE across sessions** — the in-repo scenario-share precedent **cannot deliver this**:
  it stores only `sha256(raw)` and `create_scenario_share` unconditionally revokes the prior share, so
  reuse works only within one browser session. A verbatim port regenerates the original bug in slow
  motion. Requires a deliberate choice: **(A) store the raw token** (lowest cost, a stated deviation
  from hash-only discipline) or **(B) HMAC over a stored generation counter** (recomputable forever,
  revoke = `generation += 1`, nothing secret at rest — but needs a **new Vercel env secret**, a
  prod-only failure mode this repo has already been bitten by via `RESEND_API_KEY`).
- **Immediate, unconditional revoke** — soft (`revoked_at`), never DELETE; 404-not-403; double-revoke
  = convergence. Port the precedent's semantics wholesale.
- **A distinct recipient page for a revoked/unknown token** — **410 Gone**, content-free, `no-store`.
  The 410 applies to the **TOKEN lane ONLY**; the bare-id lane keeps its uniform 404 (T-148-04) or the
  id becomes an existence oracle.
- **Owner sees whether a live link exists** (`has_active_share` shape) + inline revoke confirm.
- **Token-lane render must never populate the id-keyed cache** — a *correctness* table stake.
- **Recipient chrome suppression** — found during research, not in TODOS.md: a *recipient* of a token
  link currently sees the Share button, and `ShareLinkButton` rebuilds the URL as `?share=1`,
  **stripping the token** — a second instance of the same false-affordance class, on the recipient side.
- **`OwnerUnpublishedNotice` copy correction** — it currently states "anyone else who opens this link
  sees a 404", which becomes **factually false** the moment tokens ship. A phase that ships tokens
  without touching this component is incomplete.

**Should have (competitive):**
- **"Replace link" as a control distinct from "Revoke"** — two different intents; conflating them is
  what makes reuse impossible.
- **`last_viewed_at`** — one column, answers the only question an allocator has, with no surveillance
  apparatus.

**Defer (v2+):**
- **Link expiry** — tier-gated across Notion/Dropbox/Figma; that is the tell it is not table stakes.
- **Multiple named tokens per strategy** — the right end-state; keep the schema compatible
  (partial-unique `WHERE revoked_at IS NULL`), defer the UI.
- **Anti-features, explicitly:** per-view analytics / notify-on-open (a surveillance beacon aimed at
  named allocators, plus GDPR surface); link passwords; **hiding or disabling** the Share button
  (hiding removes the capability the founder wants; the repo's UAT direction bans disabled buttons);
  appending the token to the cacheKey.

### Architecture Approach

Three items were designed in place. **C (ranking)** is read-path only: hoist the gate marker at the
*projection* site (`PERCENTILE_GATE_COLUMN`), leave `PERCENTILE_ANALYTICS_COLUMNS` byte-unchanged (the
csv-finalize `CLOCK_SAFETY_KPI_COLUMNS` mirror and the 146.2-03/G1 ruling both depend on it), and apply
`isComputedAnalytics` once through a shared helper so the two callers cannot diverge. **B (venue
provenance)** extends the *already-applied* Phase-156 SECDEF-writer pattern with its deploy-first /
revoke-second discipline (B-1 writer → B-2 route+components → B-3 REVOKE → B-4 stamp). **A (share
token)** is mostly a transposition of the complete `/scenario-share` spine — token lib, migration with
owner-coherence RLS + partial unique index + body-shape DO-block, SECDEF reader, INVOKER writer, mint
and revoke routes.

**Major components:**
1. **Token lane on the factsheet** — a *third* arm alongside published/owner that calls
   `fetchAndBuildPayload` **directly** (zero cache reads, zero cache writes at the id key), exactly as
   the owner lane already does. `force-dynamic`, `runtime = "nodejs"`, `publicIpLimiter`,
   `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` per-route, generic metadata.
2. **`strategy_shares` migration + two RPCs** — SECDEF reader `get_shared_factsheet(p_token_hash)`,
   SECURITY **INVOKER** writer `create_strategy_share`. The precedent's body-shape assertion pins
   `status = 'published'` — the factsheet share's whole purpose is the opposite, so the assertion must
   be **re-authored**, not copied (copying aborts the apply; deleting leaves the reader unpinned).
3. **The share-affordance class fix** — all **three** sites (`FactsheetView.tsx:1565`,
   `strategies/page.tsx:175`, `discovery/[slug]/[strategyId]/page.tsx:187`) derive from ONE predicate,
   not three literals.
4. **Percentile projection + a single filter helper** in `queries.ts` / `percentile-core.ts`.
5. **Server-authoritative connect writer** — `validate-and-encrypt` (which already knows the canonical
   venue) writes the row and returns `{ api_key_id }`; the three client components stop inserting;
   then `REVOKE INSERT ON api_keys FROM authenticated`.
6. **OPS: external FIFO mutex + a `cancelled`-conclusion watcher** replacing the native concurrency
   group, plus the structlog two-artifact fix (source-scan gate + behavioral redaction test).

### Critical Pitfalls

1. **Token render poisons the id-keyed cache (SL-1).** The `cacheKey` string is split at `"::"` and the
   tail discarded — a suffix is not a key; and `keyParts`-with-token, while it "works", puts the secret
   in the cache namespace and grows unbounded. **Bypass, don't re-key.** The failure is *silent and
   TTL-long*: the poisoning request is the owner's own, renders correctly, and no error or Sentry event
   fires. Never add a visibility parameter to `buildFactsheetPayloadCached`. Never make
   `/api/og/factsheet/[id]` token-aware (a CDN-cached, un-revocable public image of a private strategy
   behind a 7-day `stale-while-revalidate`). Test: **ordered adversarial**, extended into
   `phase-148-owner-lane-cache-isolation.test.ts`, demonstrated RED with the bypass neutered.
2. **The concurrency remedy in TODOS.md is wrong.** A group holds at most one RUNNING + one PENDING
   entry *globally*; a third request **evicts** the pending one, which concludes `cancelled` with
   `steps: []` (grey — nobody triages grey), and Railway then skips the analytics deploy. Membership
   count changes only how fast you reach three simultaneous *runs*. Do NOT "finish the chain" with
   more `needs:` edges — the `if:` conditions diverge on `workflow_dispatch` and it would disable
   `e2e-seeded` on every manual run (a trap a `/ship` review already caught once).
3. **The naive percentile filter has three failure modes.** `.eq(...,"complete")` drops
   `complete_with_warnings` (a terminal success, deliberately written by the v1.8 uPnL DQ decision);
   the `< 5` floors (and the SQL RPC's min-N **20**) make filtering a **rank-disappearance** event in
   thin categories, catalog-wide, in one day, with no explanation available to a manager; and embed
   `!inner` vs post-fetch land on *different* early-return gates. Also: `get_verified_cohort_rank`
   claims parity-by-construction and *also* does not filter status — move both engines or record the
   decision.
4. **#685 silently reverts a shipped production migration.** pandas 3.0.3 → 2.3.3 installs cleanly on
   Python 3.12 and fails *quietly* at behaviour (copy-on-write, string-dtype defaults). **A green
   pytest run is not proof of safety here; the pin itself is the assertion.**
5. **The null-attestation √252 trap (B-ii).** TODOS.md calls the `apiKeyExchange → attestedVenue` swap
   "a one-identifier change" — **that framing is dangerously incomplete.** `isCryptoExchange(null)` is
   `false`, so a null attestation stamps `'traditional'` ⟹ **√252 on a crypto strategy** ⟹ ~1.20×
   Sharpe inflation, and the worker reads `strategies.asset_class` directly as the annualization clock.
   The swap **must move with its guard**: extend `skipAssetClassWrite` so a null attestation SKIPS.
6. **structlog's two failure modes look identical.** Mode A (module-scope `.bind()`) is *not* fixed by
   dropping `cache_logger_on_first_use`; Mode B (first use before `configure_logging()`) is *not* fixed
   by a source scan. Fixing one and closing the audit is false closure — and the leak class is ccxt HMAC
   signatures and MT5 passwords. Ship **both** artifacts, both demonstrated RED when neutered.

## Implications for Roadmap

Suggested phase structure. Item letters below map to ARCHITECTURE.md (A = SHARE, B = provenance,
C = ranking).

### Phase 1: OPS — CI concurrency, deploy-skip detection, structlog redaction
**Rationale:** **Hard predecessor of DEPS** (named independently by both PITFALLS and STACK). Nine
dependabot PRs against an unfixed group *guarantees* main-branch eviction and therefore a silently
skipped analytics deploy — and #685 is 100% `analytics-service/`, so it is exactly the PR that would
sit undeployed behind a grey main. Also drains the TEST `compute_jobs` backlog that otherwise reddens
**exactly 10** claim-path tests deterministically and will masquerade as dependency breakage.
**Delivers:** external FIFO mutex (with a TTL/steal path and a documented manual-unlock runbook — a
*requirement of adoption*, not a follow-up); a `workflow_run` watcher that treats a `cancelled` main
run as a loud signal; the structlog source-scan gate + behavioral redaction test; TEST backlog drained
with a named drain owner; #616 closed by *mechanism*, not by symptom convergence.
**Avoids:** Pitfalls 1 and 5.
**Verification:** simulate **three** concurrent runs (not two); assert a forced `cancelled` main run
produces an issue or rerun; plant a module-scope `.bind()` and observe the gate go RED.
Run `mypy --strict` before shipping any `analytics-service/` change — the GSD flow runs pytest only.

### Phase 2: RANK — public-ranking integrity (`getPercentiles`)
**Rationale:** Zero DDL, zero deploy ordering, one file plus tests, purely read-path — so it can land,
be observed on PROD, and be reverted trivially. It is a public-trust correctness item and should land
**before anything that publishes new strategies**, so the population delta is measured against a stable
cohort. It also front-loads the cheapest owed measurement (C-M1).
**Delivers:** `PERCENTILE_GATE_COLUMN` appended at the projection site with `PERCENTILE_ANALYTICS_COLUMNS`
byte-unchanged; one shared `isComputedAnalytics` filter helper used by both callers; a decision on
`get_verified_cohort_rank` (move it or record leaving it); a PROD before/after per-strategy percentile
snapshot **in the phase artifact** (a gate, not a nicety — it is the only way "why did my rank change?"
is ever answerable).
**Avoids:** Pitfall 3. **Keep out (logged):** `StrategyTable`'s ungated KPI cells (C-D2).
**Note:** a failed published strategy's own percentile panel disappears — the honest outcome, but a
visible change to a live page: it belongs in UAT, not a footnote. Any test asserting "ranks improve" is
wrong; direction is not uniform.

### Phase 3: HONEST / WIZERR / SEC — the remaining small items
**Rationale:** Sequenced between the two ordering-constrained anchors; low individual risk. One
cross-group coupling to plan rather than discover: the SEC group's `MUTATING_RPC_NAMES` gap and the
SHARE phase's new mint/revoke RPCs are **two REQ groups, one edit** — a new RPC missing from that list
means the mutation gate silently does not cover the new surface.

### Phase 4: PROVENANCE (B) — server-authoritative venue
**Rationale:** Extends a pattern **already applied to PROD** (`20260813150106` + `20260814120000`), so
the risky design work is done; what remains is sequencing discipline. It must not be last because B-3's
REVOKE needs a full deploy-then-migrate cycle with soak time.
**Delivers:** B-M1 census → B-4 (stamp swap **+ null-guard**) as the small, high-value cut; optionally
B-1 → B-2 → B-3 (writer → deploy → revoke) as the larger provenance close.
**Discipline:** deploy-first, revoke-second, never migration-first; `CREATE OR REPLACE` never
`DROP+CREATE`; role gate on `auth.role()` not `current_user`; post-verify asserting the *comparison*.
Before B-3, grep **every** `.from("api_keys")` mutation — DELETE is also a live client path.
**If the milestone runs short, B-4-alone is the correct minimal cut** — but only *with* the null-guard.

### Phase 5: SHARE (A) — revocable share links
**Rationale:** Last of the feature work. The only item introducing a NEW public, anonymous,
unauthenticated surface; its own migration, token module, cache invariant and adversarial test; the
largest "ships green and leaks" surface; and two unresolved product decisions. Full
plan → discuss → execute → red-team treatment. **Must not share a PR with anything else.**
Do not start on `feat/phase-156-connect-refactor` — Phase 156's Migration B is pending against
`strategies`, and two concurrent migrations on one table on an auto-apply-to-PROD path is an ordering
surprise waiting to happen.
**Delivers:** the MVP list in FEATURES.md § "Launch With", including the `OwnerUnpublishedNotice` copy
correction, recipient chrome suppression, and the three-site class fix.
**Avoids:** Pitfalls 1 (SL-1) and the token-leakage channels (Sentry `beforeSend` scrub verified
against a *real captured event*, not the config file; `no-referrer` per-route; generic metadata).

### Phase 6: DEPS — the 9-PR dependabot campaign
**Rationale:** LAST, strictly after OPS. Landing dependency churn before the correctness work would
make every red ambiguous.
**Prerequisite (a commit on `main`, not a PR):** `requirements.in` `pandas==2.2.3` → `3.0.3` with its
comment corrected; `requirements.txt` untouched.
**Order:** #643 → (#627, #626) → #612 *alone*, drift-check first → #685 (rebased, pandas dropped from
the diff, `make lock` re-run) → #686 (rebased + `npm install`) → #645 @7.0.1 → #646 @30.0.1.
**Close, do not land:** #614 (TypeScript 7) with a comment citing the `exports`-map read and the
typescript-eslint peer range, so the next Dependabot reopen is pre-answered; **#606 as stale** (3 of its
4 booked claims are false at HEAD; `@lhci/cli` 0.15.1 IS latest, `extract-zip`'s vulnerable range is
`*`, `npm audit fix --force` would *downgrade* lhci nine minors, and `nightly.yml`'s `--omit=dev`
already encodes the policy). Do **not** add an audit-allowlist file.
**Discipline:** **Never two PRs at a time** — shared-TEST-DB contention makes an attributed red
impossible. Assert `conclusion == "success"`, never "not failure" (with no branch protection, a grey
run merges). Update each action's SHA **and** its version comment together (C-0293). Verify lint runs
with `--no-cache`.

### Phase Ordering Rationale

- **OPS → DEPS is a hard, measured dependency**, asserted independently by both PITFALLS (concurrency
  eviction ⟹ guaranteed skipped deploy across 9 PRs) and STACK (#616 is a prerequisite of landing #685,
  which is 100% analytics-service).
- **RANK early** because it is the only purely-read-path item — trivially revertible, observable on
  PROD, and it must precede new publications so the population delta is measured against a stable cohort.
- **SHARE late and alone** because it is the only new anonymous public surface, and because its failure
  mode is silent, TTL-long disclosure.
- **B before A** because B-3's REVOKE needs a full deploy-then-soak cycle and cannot be last.
- **No file-level collisions** between A, B and C — they *can* be planned in parallel. They should
  **not** be executed in parallel by concurrent agents (`feedback_concurrent_agents_share_git_index_race`;
  B and C both touch `supabase/tests/`).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 5 (SHARE):** the payload-builder seam is the one un-measured integration question —
  extracting the *build* half of `fetchAndBuildPayload` touches the composite arm and the single-key
  basis arm, so its diff is wider than it looks (ARCHITECTURE confidence: MEDIUM). Budget for it;
  don't discover it.
- **Phase 4 (PROVENANCE):** blocked on the **B-M1 PROD census** — reachability of un-attested rows
  through `finalize-wizard` is not inferable from source (confidence LOW without it).

Phases with standard patterns (skip research-phase):
- **Phase 2 (RANK):** the fix location, the correct predicate and the csv-finalize mirror constraint are
  all read directly from source; only a cheap census (C-M1) remains.
- **Phase 6 (DEPS):** every verdict is registry- or log-measured; STACK.md is effectively the plan.
- **Phase 1 (OPS):** the mechanism is understood and the repo already carries the dedup'd-issue pattern
  to copy (`analytics-deploy-verify.yml`).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | **HIGH** | Everything measured locally or read from a vendor release API / npm+PyPI registries. MEDIUM only on the TS7 ecosystem narrative (one WebSearch pass corroborating a primary `exports`-map read) and on FastAPI 0.140.0's changelog (page truncated on fetch). |
| Features | **HIGH / MEDIUM** | HIGH on every in-repo claim (read at HEAD `ca3f0c5c`, cited file:line). MEDIUM on comparable-product conventions (cross-checked across ≥2 products) and on the W3C TAG capability-URL rules (a 2014 Note, not a REC). |
| Architecture | **HIGH** | Every claim read from live source at HEAD with file:line; nothing inferred from training data. MEDIUM on the payload-builder seam's true diff width; LOW on two items pending PROD censuses (B-M1, C-M1). |
| Pitfalls | **HIGH / MEDIUM** | HIGH on the four repo-verified areas. MEDIUM on GitHub Actions concurrency semantics — GitHub does not document the pending-eviction rule in its reference page; verified against community docs plus this repo's own measured evidence (hotfix `861a4d91`, CI run 31273384829). |

**Overall confidence:** **HIGH**

### Gaps to Address

**Measurements owed (block planning, not just execution):**
- **B-M1 (PROD census, blocks B-4):** count `api_keys` rows with `attested_venue IS NULL AND created_at >= '2026-08-11'`, split by `exchange` and by whether a `strategies` row links them; of those, how many carry a `wizard_session_id`. If non-zero, those strategies' `asset_class` changes — a re-annualization event needing golden-parity treatment. Copy the count-pinned, abort-on-drift census discipline from `20260811210000`.
- **C-M1 (PROD census, blocks only the copy decision):** per `discovery_categories.slug`, published-with-analytics counts before and after the `isComputedAnalytics` filter. Any slug crossing **5 → 4** is the decision surface for C-D1. Also compute the resulting `cohort_n` against the SQL RPC's **min-N 20**.
- **Percentile before/after snapshot per published strategy** — a phase-artifact gate.

**Decisions owed (founder / human calls, not research):**
- **A-D1 — route vs query param. The two research files disagree, deliberately.** FEATURES treats the founder's `?s=` on `/factsheet/[id]` as settled INPUT and calls a separate route an anti-feature (it forks a 664-line page for a second render path). ARCHITECTURE recommends `/factsheet-share/[token]` because SL-1 enforcement becomes *structural* rather than behavioural, the id leaves the URL, and `/scenario-share` is a complete CI-pinned in-repo precedent. **Surface this to the founder; do not let a planner pick silently.**
- **A-D2 — `status='private'` has zero UI actions** (`StrategyActions` falls through to `return null`), and contribution-flow strategies are minted exactly there. This is on A's critical path because the revoke control needs a home. Two options: (a) permanently private by design — put revoke on the factsheet itself; (b) `private` needs a publish path — **its own phase.** Do not let a publish flow grow inside a share-link phase.
- **A-D3 — does the token lane extend to `/factsheet/[id]/tearsheet` and the PDF routes?** Scoping to the HTML factsheet only is defensible and smaller; deciding it *implicitly* is how a second unguarded surface appears.
- **A — token model A (raw at rest) vs B (HMAC + stored generation counter).** Must be written into the plan with the deviation from `scenario-share-token.ts`'s hash-only discipline **argued, not assumed** — a reviewer will otherwise read B as contradicting a documented decision. B's real cost is a new required Vercel env var (a prod-only 500).
- **B-D1 — scope:** all of B-1..B-4, or B-4 alone gated on B-M1?
- **B-D2 — the oracle** for √365 vs √252: must pin the *economics* (a null attestation annualizes on nothing — it skips), never re-derive the implementation's own expression.
- **C-D1 — the `< 5` cliff.** Recommend **accept the disappearance** (honest, matches the existing convention) and say so in the UAT.
- **C-D2 — `StrategyTable`'s ungated KPI cells.** Recommend **out**, logged.
- **jsdom 30 vs local Node 25** — accept the `EBADENGINE` warning and treat CI Node 22 as authority, or run that PR's verification under `PATH=/opt/homebrew/opt/node@22/bin`. Decide, don't discover.
- **Link-unfurl degradation is real and measured** (`generateMetadata` and the OG route are both `withPublishedOnly`, so a token link unfurls as "Strategy" with a 404 image). Recommend **accept it explicitly** — a private link *should* be dull in a chat preview, and an unfurl bot's cache is a leak amplifier.

**Unresolved / adjacent — log rather than absorb:**
- `/api/scenario/peer-rank`'s `get_verified_cohort_rank` may carry the same status defect — a *sibling* item.
- `knip` 6.25 → 6.32 spans seven minors, changelogs unread; if #686 reds after a clean `npm ci`, knip is the highest-prior suspect and its findings may be **legitimate**, not regressions.
- The whole DEPS campaign is **predicted, not executed** — no PR was rebased, no lock regenerated, no suite run.

## Sources

### Primary (HIGH confidence)
- **This repository at HEAD `ca3f0c5c`**, cited file:line throughout all four research files — `factsheet/[id]/v2/page.tsx` (the cache-key reality, the owner-lane bypass, `force-dynamic`), `FactsheetView.tsx`, `lib/queries.ts`, `lib/percentile-core.ts`, `lib/closed-sets.ts`, `csv-finalize/route.ts`, `finalize-wizard/route.ts`, `validate-and-encrypt/route.ts`, `logging_config.py`, `mt5_client.py`, `.github/workflows/{ci,supabase-migrate,migration-policy,migration-drift-check,analytics-deploy-verify}.yml`, `next.config.ts`, `package.json`, `.nvmrc`
- **Supabase migrations read in full** — `20260622120000` (the revocable-token precedent), `20260813150106` + `20260814120000` (Phase 156), `20260811210000` (attested venue + the dated backfill cutoff), `20260626120000` (`get_verified_cohort_rank`), `20260405061912`
- **npm / PyPI registries** — `npm view typescript@7.0.2 exports dependencies`, `typescript-eslint@8.58.0` peer range, `jsdom@30.0.1`, `supabase@2.98.2`, PyPI `requires_dist` for fastapi 0.139.0 vs 0.141.1
- **Measured locally / from CI** — `npm ci --dry-run` at `main` HEAD, `gh run view --log-failed` (run 32365605203), `gh pr diff 685`, `npm audit --json`, `git log -S`
- **Vendor release APIs** — GitHub Releases for `jsdom/jsdom`, `testing-library/jest-dom`, `actions/setup-node`, `actions/setup-python`, `supabase/setup-cli`, `actions/checkout`

### Secondary (MEDIUM confidence)
- [Good Practices for Capability URLs — W3C TAG](https://www.w3.org/2001/tag/doc/capability-urls/) — entropy, https, referrer, expiry, revocation, rate limiting, 410-or-404 (a 2014 Note, not a REC)
- Notion / Figma / Dropbox / Google Docs / DocSend help docs — share-link conventions, expiry tier-gating, "this link is expired" vs generic 404
- [structlog configuration + performance docs](https://github.com/hynek/structlog) — the lazy proxy, never-bind-at-module-scope rule, `cache_logger_on_first_use`
- GitHub community discussions [#12835](https://github.com/orgs/community/discussions/12835) and [#32376](https://github.com/orgs/community/discussions/32376) — the pending-eviction rule GitHub does not document
- [ben-z/gh-action-mutex](https://github.com/ben-z/gh-action-mutex) · [softprops/turnstyle](https://github.com/marketplace/actions/action-turnstyle) — FIFO alternatives
- MDN / PortSwigger / Cobalt — `Referer` leakage channels; [410 Gone — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/410)

### Tertiary (LOW confidence — flagged, not relied upon)
- SitePoint / Medium / InfoQ TypeScript 7 migration write-ups — used only to corroborate the primary `exports`-map read, never standing alone

---
*Research completed: 2026-08-20*
*Ready for roadmap: yes*
