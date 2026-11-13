# Phase 192: PUBLICTRUTH - Research

**Researched:** 2026-11-06
**Domain:** Public marketing copy truthfulness (Next.js 16.4.2 App Router server components), the `/demo` route's read path, CI e2e lane coupling
**Confidence:** HIGH on code facts and copy census; MEDIUM on D-08 root cause (code narrows it to three PROD reads, none run); the CI-lane conflict (Pitfall 1) is the phase's biggest planning risk.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** The truth is the code path that stores credentials, read by the planner at HEAD. Today the pages disagree: `/security` says AES-256-GCM envelope encryption with a Vault-held KEK, `/for-quants` says a per-row Fernet data key, and the home form says "Your keys are never stored." At least two of these are false.
- **D-02** The full explanation lives once, on `/security`. Home, `/for-quants` and Terms carry one identical short sentence that links to it. (Phase 200 LEAN-04 later owns "the security explanation lives in one place" for the manager surfaces; this phase sets the public copy it builds on.)
- **D-03** TLS, measured 2026-11-06 from a workstation with OpenSSL 3.6.4 against the production host: TLS 1.0 and 1.1 are refused by the server (alert 70, protocol version, with `@SECLEVEL=0` so the client could offer them); TLS 1.2 is accepted (ECDHE-RSA-AES128-GCM-SHA256); TLS 1.3 is accepted (TLS_AES_128_GCM_SHA256). `/security`'s "We disable TLS 1.0, 1.1, and 1.2 at the edge" is false and is rewritten to match. The handshakes are re-recorded in the phase at execution, for each version. The behaviour is not changed. (Assumption, not measured: the Vercel edge does not offer a per-project switch that drops TLS 1.2. The planner verifies it in Vercel's docs and records it.)
- **D-04** Factsheet visibility: the proxy lists `/factsheet` in `PUBLIC_ROUTES` and the v2 page serves a published factsheet to signed-out visitors. `/for-quants`' "Listed to qualified allocators only ... Retail discovery never sees your factsheet" is false and is rewritten to the truth: a published factsheet is public by link, and the firm name stays behind its codename. The behaviour is not changed. The executor records what a signed-out request for a published factsheet returns.
- SC-2 note: the founder chose to change the sentences, not the behaviour, for both D-03 and D-04.
- **D-05** One shared sentence on `/for-quants` and Terms §7: free to list, and a success fee may apply on matched allocations as set out in the manager agreement. No fee figure is invented (legal and fee terms are founder-supplied, see REQUIREMENTS Out of Scope).
- **D-06** Every page that states an exchange count reads one shared, flag-aware value, the one the home page already uses (`EXCHANGES` from `src/lib/closed-sets.ts`, flag-gated venues included the same way). No hard-coded count in copy.
- **D-07** The home page shows an anonymous visitor no API key or secret form. `VerificationSection` is replaced, for anonymous visitors, by a sign-up call to action.
- **D-08** `/demo` showed "Demo data is loading" on PROD on 2026-11-06. Root-cause why the demo data does not load (`demo/page.tsx` notes an admin-client path and a persona-id lookup) and fix that cause. A headline figure that cannot be computed is removed together with its claim, never filled in.
- **D-09** `/demo/founder-view`: filled from the same demo data if it can be computed; otherwise the route and every link to it are removed.
- **D-10** No raw id where a strategy name belongs: show the strategy's name or codename.

### Claude's Discretion
- The exact short security sentence and the CTA wording, within DESIGN.md's voice rules.
- Where the shared copy constants live, preferring an existing module over a new one.

### Deferred Ideas (OUT OF SCOPE)
- Legal entity and jurisdiction text in Terms and Privacy (founder supplies; out of scope).
- Changing who may view a factsheet (not chosen; would need its own phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRUST-01 | Home, `/security`, `/for-quants` and Terms give one consistent, true account of key storage/encryption, TLS versions, who can view a factsheet, listing cost, exchange count; home asks an anonymous visitor for no key or secret | Truth of key storage verified in code (Standard Stack, Code Examples); TLS and HSTS research readings; factsheet visibility traced to `proxy.ts` + `v2/page.tsx`; exchange list/count sources found (`EXCHANGES`, plus the hard-coded stragglers listed in the Copy Census); home form removal blast radius mapped |
| ROUTE-03 | `/demo` shows no stuck loading notice, no "—" under a headline claim, no empty founder view, no raw ids | Live PROD research reading of `/demo` shows what is broken and where; seed/reader key drift found for the BTC cells; founder-view removal reference census; D-08 candidate causes with the PROD read that confirms each; CI-lane conflict mapped |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives the planner must honour (CLAUDE.md files and the founder memory index):
- **AGENTS.md**: "This is NOT the Next.js you know" - read `node_modules/next/dist/docs/` before writing code. Installed Next is 16.4.2 [VERIFIED: `node -e` on `node_modules/next/package.json`].
- **DESIGN.md governs all copy/UI.** Voice rule: declarative, sentence-case, active voice, "No adjectives where a number exists". AI-Slop Ban bans centred-everything layouts and generic hero copy [VERIFIED: DESIGN.md:432-444].
- **Gates must be able to fail**: neuter, see RED, restore from a byte backup (`cp`), never `git checkout/restore/stash` on uncommitted work.
- **Which database am I on**: this checkout's Supabase CLI is linked to PROD. This phase needs PROD *reads* only (Supabase MCP, one read-only query per call, marker query first); no `supabase db query`, no CLI writes. PROD writes (a match recompute, a data repair) are not in this research's remit; per the founder memory they are authorized but must go through the product's own paths and be reported; the orchestrator confirms before one is planned.
- **CHANGELOG discipline**: every ship writes a CHANGELOG entry and moves `VERSION` and `package.json` (byte-equal 4-digit strings) in the release commit. No skip-trailer tokens in any commit message or PR body, not even to deny them. A ship branch changes nothing under `.planning`.
- **Public repo**: no secrets, PROD ids, home paths or account numbers in tracked text. The evidence file the executor writes must follow this too.
- **Parallel agents** share the git index; use explicit `git add` paths.
- **Agent gates include mypy** only for analytics-service changes; this phase should not touch `analytics-service/` (see Open Question 4).
- `npm run lint` runs eslint, `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene`, `check-canonical-domain` [VERIFIED: package.json:11].

## Summary

The phase is mostly copy, but five findings change how it must be planned. (1) **Key storage truth is verified**: credentials are Fernet-encrypted by `analytics-service/services/encryption.py` under a fresh per-credential DEK wrapped by a KEK read from the `KEK` env var; no Vault, no AES-256-GCM anywhere in code. The identical false "AES-256-GCM ... KEK lives in Supabase Vault" text also sits in two **signed-in wizard steps** and in `scripts/build-security-packet.html` (the PDF source), which the UI-SPEC census did not list. (2) **The unseeded `e2e` CI lane treats `/demo` rendering against an unreachable Supabase as its fixture.** Eight specs and three committed screenshot baselines depend on `/demo` rendering a 200 page with the "Demo data is loading" card under placeholder env. The UI-SPEC's "throw to `error.tsx` on a read error or an empty persona" turns that render into an error page and reds the lane unless the specs are re-homed in the same phase. (3) **The live PROD `/demo` (research reading) is not a seeding gap.** The active persona's analytics, attribution and hero figures render; only the holdings list and recommendations are empty, and `holdingsRes.error` is never read. The BTC "—" cells have an identified code cause: the full-app seeder writes `benchmark_comparison` with keys `benchmark_return`/`portfolio_return` (and a hard-coded `0.62`), while the reader and the Python writer use `benchmark_twr`/`portfolio_twr`. (4) The demo allocator is excluded from the match cron on purpose (D-01 of QUANTALYZE-Z), so **no match batch exists or will be produced** for it without a manual recompute: both the `/demo` recommendations and the founder view are empty by design. (5) A signed-out factsheet is 200 for a published strategy and 404 otherwise; the factsheet title is `name ?? codename`, and the wizard makes `name` a codename, so the UI-SPEC sentence is true for wizard-created strategies, but the public `/for-quants` "Codename anonymization / Your firm name is never public" rows and the tearsheet's attested-allocator identity reveal need the planner's attention.

**Primary recommendation:** Plan in this order: (a) evidence plan first (handshakes, signed-out factsheet, three PROD reads for D-08), (b) shared constants in `src/lib/status-surface-copy.ts` and the four pages plus the PDF source, (c) home CTA, (d) demo reader/hero logic with fail-loud reads and an explicit CI-lane re-home task, (e) founder-view removal (default) with the full reference list below, (f) one RED-then-restored census test. Do not leave the CI-lane decision to the executor.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Key storage/encryption description | Frontend Server (SSR marketing pages) | Python analytics service (the fact source) | Copy renders server-side from a shared constant; the claim's truth lives in `analytics-service/services/encryption.py` and the DB column grants |
| TLS versions accepted | CDN / Static (Vercel edge) | - | TLS terminates at Vercel; not configurable from the repo (see Standard Stack, Vercel docs) |
| Factsheet visibility by link | Frontend Server (`proxy.ts` + `v2/page.tsx`) | Database (published-only visibility predicate) | Proxy allows `/factsheet`; the page applies `withPublishedOnly` |
| Listing cost / exchange list | Frontend Server | - | One shared constant/derivation read by each page at render |
| Home sign-up CTA | Frontend Server | - | Plain `<Link>` to `/signup`; the page already redirects signed-in users |
| `/demo` data read | Frontend Server (RSC, admin Supabase client) | Database; analytics-service for the match batch | `force-dynamic` page reads persona rows via service role; the match batch is produced only by an admin recompute |
| `/demo` failure surface | Frontend Server (`src/app/error.tsx` boundary) | - | Thrown RSC errors land in the nearest `error.tsx` with a digest, no message in production |
| Match batch for demo allocator | API / Backend (analytics-service `/recompute`) | Database | Produced only by manual admin recompute; the cron skips the demo allocator |

## Standard Stack

No new package. Everything is in-repo. Package Legitimacy Audit: **not applicable, no external package is installed** (the UI-SPEC's Registry Safety row agrees: `Tool: none`).

### Core (in-repo modules this phase edits or reads)
| Module | Role | Notes |
|--------|------|-------|
| `src/lib/status-surface-copy.ts` | Home of the new shared constants (`KEY_STORAGE_SENTENCE`, `KEY_STORAGE_LINK`, `LISTING_COST_SENTENCE`, an exchange-list value) | UI-SPEC names it; it already exports public sentences (`SHARE_CARD_COPY`, `KCS10_PUBLIC_SENTENCE` at `:599-616`). Tested by `src/lib/status-surface-copy.test.ts` ("pinned character for character") |
| `src/lib/closed-sets.ts` | `EXCHANGES` and the flag consts | `export const EXCHANGES: readonly ExchangeDisplay[] = UI_EXCHANGE_CODES.map(` (`:470`); base set `"binance","okx","bybit","deribit"` (`:423-428`); display `binance: "Binance", okx: "OKX", bybit: "Bybit", deribit: "Deribit", sfox: "sFOX", mt5: "MT5"` (`:48-55`) |
| `vitest` + `@testing-library/react` | Unit/render tests (jsdom default, node project for listed files) | `vitest.config.ts` `INCLUDE` has `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.{ts,tsx}` |
| `@playwright/test` + `@axe-core/playwright` | e2e (unseeded `e2e` lane, seeded `e2e-seeded` lane) | See Pitfall 1 |
| `puppeteer-core` ^25.16.0 + system Chrome | Security packet rebuild | `node scripts/build-security-packet.mjs`; Chrome path defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on darwin |

### Verified facts about the encryption path (the truth S-KEY must match)
`analytics-service/services/encryption.py` [VERIFIED: read this session]:
- `:6` `from cryptography.fernet import Fernet, InvalidToken`
- `:16` `kek = os.getenv("KEK")`
- `:49` `return int(os.getenv("KEK_VERSION", "1"))`
- `:54` `return Fernet.generate_key()` (inside `generate_dek`)
- `:86` `"dek_encrypted": encrypted_dek.decode(),` and the returned dict also carries `"kek_version": get_kek_version()`, `"api_secret_encrypted": None`, `"nonce": None  # Fernet handles nonce internally`.
- `encrypt_credentials` docstring: "1. Generate a unique DEK for this key pair 2. Encrypt the credentials with the DEK 3. Encrypt the DEK with the KEK".

Consequences, each clause of S-KEY:
- "encrypted": true. "under a data key of its own": true (per-credential DEK). "only our analytics service can decrypt it": true in code; `KEK` appears in `src/` only inside comments and error-code names (grep of `src/**/*.ts(x)` non-test: `validate-and-encrypt/route.ts:729-731` comments, `KEK_UNAVAILABLE` code strings, and the marketing copy being fixed). `.env.example` lists `# KEK=your-key-encryption-key` and `# KEK_VERSION=1` under the analytics-service block (`:202-203`).
- **No Vault, no AES-256-GCM in code**: `grep -i vault` over `analytics-service/**/*.py` returns only `routers/cron.py` and `services/mt5_client.py`, both about an MT5 vault *password* and an unrelated future Vault note, not the KEK; `src/` non-test hits are exclusively the false marketing/wizard copy. `[VERIFIED: grep this session]`
- Fernet = AES-128-CBC + HMAC-SHA256. `[ASSUMED]` (training knowledge of the `cryptography` spec; the UI-SPEC repeats it; no doc was fetched). Low risk but the sentence on `/security` states it, so re-confirm in `cryptography`'s Fernet docs at execution.
- **Column grants (the "web tier and your dashboard cannot read the ciphertext" clause)**: `supabase/migrations/20260410225608_api_keys_column_revoke.sql:73` `REVOKE SELECT ON api_keys FROM anon, authenticated;` followed by an allowlist `GRANT SELECT (...)` back to `authenticated`. Current effective state, read from `supabase/schema/baseline.sql:18233-18335`: `GRANT REFERENCES,DELETE ON TABLE "public"."api_keys" TO "anon";` (no SELECT), `GRANT ALL ON TABLE "public"."api_keys" TO "service_role";`, and per-column `GRANT SELECT("id"|"user_id"|"exchange"|"label"|"is_active"|"last_sync_at"|"created_at"|"account_balance_usdt"|"sync_status"|"sync_error"|"last_429_at"|"disconnected_at"|"venue_account_id"|...) ... TO "authenticated"`; zero of those lines name an `*_encrypted`, `dek_encrypted` or `nonce` column (counted in lines 18236-18340). The wording "revoked at the column-grant level" is accurate in effect (a table-level revoke plus a non-encrypted column allowlist). The baseline is a dump at some sha, so the executor re-checks the grants in the checked-out migrations before shipping the clause.
- The migration's own header comment still says "KEK (stored in Supabase Vault)" (`20260410225608...sql:5-8`) - stale text in an immutable migration; do not edit a shipped migration for it.

### TLS / Vercel
- Vercel docs: "Vercel supports TLS version 1.2 and TLS version 1.3." and lists TLS 1.2 ciphers (`ECDHE-RSA-AES128-GCM-SHA256` among them) `[CITED: https://vercel.com/docs/security/encryption, fetched 2026-11-06]`. The page documents no setting for a minimum TLS version; a community thread says specific versions cannot be disabled (secondary, not authoritative). **The "no per-project switch" conclusion rests on that absence, so it is `[ASSUMED]`** (Absent-evidence rule): record it as "Vercel documents TLS 1.2 and 1.3 as supported and documents no minimum-version control" and do not write "Vercel cannot". Behaviour does not change either way (D-03).
- HSTS: served header `strict-transport-security: max-age=31536000; includeSubDomains` (research reading, below); set by `next.config.ts:238-239` `key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains"` `[VERIFIED: next.config.ts:224-240]`. Vercel's documented custom-domain default is `max-age=63072000`, so the repo header is what is served. `/security`'s "one-year max-age" is true.

### Research readings (public network reads, 2026-11-06; execution re-records them)
`openssl s_client -connect quantalyze.xyz:443 -servername quantalyze.xyz -<ver> -cipher 'DEFAULT:@SECLEVEL=0'`, OpenSSL 3.6.4:

| Version | Result |
|---------|--------|
| TLS 1.0 | `tlsv1 alert protocol version`, `SSL alert number 70`, `New, (NONE), Cipher is (NONE)` |
| TLS 1.1 | `tlsv1 alert protocol version`, `SSL alert number 70`, `New, (NONE), Cipher is (NONE)` |
| TLS 1.2 | `New, TLSv1.2, Cipher is ECDHE-RSA-AES128-GCM-SHA256` |
| TLS 1.3 | `New, TLSv1.3, Cipher is TLS_AES_128_GCM_SHA256` |

Also: `curl -sI https://quantalyze.xyz/` -> `HTTP/2 200`, `server: Vercel`, `strict-transport-security: max-age=31536000; includeSubDomains`. Served certificate issuer `Let's Encrypt`, not-before `Oct 9 2026`, not-after `Jan 7 2027` (about 90 days, so "rotated automatically before expiry" is plausible; Vercel documents automatic Let's Encrypt renewal). This is enough to keep the UI-SPEC's optional certificate and HSTS sentences, **provided the executor writes the same readings into the phase evidence file**.

## Architecture Patterns

### System architecture (data flow for this phase)
```
Visitor (anonymous)
  |
  +--> proxy.ts (PUBLIC_ROUTES: /demo, /for-quants, /security, /legal, /factsheet, ...)
         |
         +--> (marketing)/page.tsx --- redirect(DEFAULT_AUTHENTICATED_ROUTE) if signed in
         |        reads: EXCHANGES.length, shared KEY sentence, getSocialProofStats (anon client)
         |        NEW: sign-up section (Link -> /signup) replaces VerificationSection
         +--> security/page.tsx, for-quants/page.tsx, legal/terms/page.tsx
         |        read shared constants from src/lib/status-surface-copy.ts
         |        + scripts/build-security-packet.html -> (puppeteer-core + Chrome) -> public/security-packet.pdf
         +--> factsheet/[id] -> v2/page.tsx -> withPublishedOnly(...) ; no row => notFound() (404)
         +--> demo/page.tsx (force-dynamic RSC)
                  |  persona enum -> getPersona() -> allocatorId   (only sanctioned input transform)
                  |  Phase 1 (admin client, parallel): profiles, match_batches(limit 2), portfolios(limit 1)
                  |  Phase 2 (parallel): portfolio_strategies+strategies+strategy_analytics,
                  |                      portfolio_analytics(latest), resolveDemoRecommendations(batches)
                  |  adaptHoldings / adaptPortfolioAnalytics -> EditorialHero, CounterfactualStrip,
                  |  WinnersLosersStrip, WhatWedDoCard, NextFiveMillionCard, holdings list, recs
                  |  failure => throw => src/app/error.tsx (digest only in production)
         match batch producer (only path): admin session -> POST /api/admin/match/recompute
                  -> analytics-service /recompute (demo allocator universe = is_example only)
                  -> match_batches + match_candidates     (cron skips the demo allocator)
```

### Recommended structure (no new directories)
```
src/lib/status-surface-copy.ts        # + KEY_STORAGE_SENTENCE/LINK, LISTING_COST_SENTENCE, exchange-list value
src/lib/status-surface-copy.test.ts   # + literal pins (oracle independence rule in its header)
src/app/(marketing)/page.tsx          # sign-up section replaces <VerificationSection />
src/app/(marketing)/security|for-quants|legal/terms/page.tsx
src/app/(marketing)/demo/{page,layout}.tsx
src/components/portfolio/EditorialHero.tsx   # render a cell only when its value is non-null (see Pitfall 6)
scripts/build-security-packet.html + public/security-packet.pdf
src/__tests__/public-truth-*.test.ts(x)      # census + render pins (new)
```

### Pattern 1: shared constant, rendered by every page
**What:** one exported string per shared sentence, imported by each page, plus a literal-pinned test. **When:** S-KEY, S-COST, S-EXCH (UI-SPEC copy table). **Constraint:** `/security` renders the full explanation, not S-KEY; the others render S-KEY plus the `/security#key-handling` link. The anchor already exists: `/security`'s Key handling `<h2 id="key-handling">` [VERIFIED: security/page.tsx ~`:131-139`].
**Flag-awareness caveat:** `EXCHANGES` follows `SFOX_UI_ENABLED = process.env.NEXT_PUBLIC_SFOX_ENABLED === "true"` (`closed-sets.ts:276`, build-time inlined), whereas `/security`'s sFOX walkthrough keys on `isSfoxEnabledServer()` = `process.env.SFOX_ENABLED === "true"` (`:374-376`, runtime). Two different env vars; flipping one without the other makes pages disagree. Out of scope to unify, but the plan must not describe them as one flag, and the census test should assert the list/count from `EXCHANGES` only.

### Pattern 2: demo page fail-loud reads
Read **every** `.error` (Phase 2 reads today are unchecked: `holdingsRes`, `analyticsRes`; `recommendationsRes` swallows errors inside `fetchCandidatesForBatch`, which destructures only `data`). Throw when any read errored, when a holding's `strategies` embed is null, or when the persona resolves to neither holdings nor recommendations. Keep the existing `console.error` and add a Sentry capture through the repo's `captureToSentry` (`@/lib/sentry-capture`, used by `(marketing)/page.tsx`).

### Anti-Patterns to Avoid
- **Fixing the demo by seeding or patching PROD from code.** The seeders refuse PROD by design (`seed-full-app-demo.ts:1456-1470` allowlist, `seed-demo-data.ts:651-663` prod-URL regex plus `SEED_CONFIRM_STAGING`). Do not weaken those guards (pinned by `critical-regressions.test.ts:474-527`).
- **Using the stored `benchmark_return: 0.62`** (seed constant) as BTC TWR. It is an invented number. Never display it.
- **Editing the shared `displayStrategyName`** to hide the `Strategy #<id>` fallback: UI-SPEC and the helper's docblock say it guards exploratory rows elsewhere.
- **Deleting orphaned `VerificationSection`/`VerificationForm`/`VerificationResults`/`VerificationProgress` or `/api/verify-strategy`** in this phase (see Don't Hand-Roll and Pitfall 7).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Exchange list text | A typed "Binance, OKX, or Bybit" string or a count literal | `new Intl.ListFormat("en", { style: "long", type: "disjunction" }).format(EXCHANGES)` over `EXCHANGES` | One flag-aware value; `/for-quants:317` is the live straggler |
| Date display on `/demo` | A new formatter | `formatAbsoluteDate` from `@/lib/utils` (UI-SPEC) | Already the repo's absolute-date formatter |
| Demo sentence "name or codename" | New name logic | Fix at the data/read (a codename on the demo strategy, or a non-null embed), not in `displayStrategyName` | UI-SPEC D-10 contract |
| Error surface for demo outage | A new in-page empty/error card | Throw to `src/app/error.tsx` | UI-SPEC; one loud path |
| Security packet PDF | Hand-edited PDF or a new renderer | `node scripts/build-security-packet.mjs` (puppeteer-core) | Runbook-mandated; Chrome exists on the workstation (`/Applications/Google Chrome.app`, verified present) |
| Public-surface census | A one-off grep in the summary | A vitest census over the files (like `security-packet-date-drift.test.ts`) | Must fail loud, must be re-runnable |

**Key insight:** every discrepancy in this phase exists because the same fact was typed by hand in several places (security page, wizard steps, packet HTML, for-quants, home form, seed vs reader keys). The fix is one source per fact plus a test that reads the sources.

## Copy Census (what the UI-SPEC did not list)

Greps over `src`, `scripts/build-security-packet.html`, 2026-11-06, non-test:

| Where | Text | Status | Recommendation |
|-------|------|--------|----------------|
| `scripts/build-security-packet.html:202-206` | "AES-256-GCM envelope encryption", "Supabase Vault (KMS-backed)" | False; the PDF is built from this file | In scope (UI-SPEC covers it). Also rebuild the PDF |
| `scripts/build-security-packet.html:253-254` | `<dt>Supported exchanges</dt><dd>Binance, OKX, Bybit (read-only scope on each)</dd>` | Hard-coded 3-venue list; `EXCHANGES` has 4 | **Not in UI-SPEC.** Static HTML cannot import `EXCHANGES`; correct it by hand to the current list and let the census test compare it with `EXCHANGES` |
| `scripts/build-security-packet.html` Data handling | "Raw fills retention 30 days; hard-deleted by daily job" | Contradicts `/security` Data handling ("all kept for the life of the connection") | Open Question 5 (retention is outside the five claims, but two public documents disagree) |
| `(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:198` and `MultiKeyConnectStep.tsx:225` | "encrypted with AES-256-GCM envelope encryption ... The KEK lives in Supabase Vault." | False, shown to signed-in managers at the exact moment they paste a key | Outside the five pages. Open Question 4 |
| `components/exchanges/AllocatorExchangeManager.tsx:1394,1644` | "per-user KEK" | A third description (ROADMAP Phase 200 names it) | Phase 200 owns it |
| `(marketing)/for-quants/page.tsx:135,292-293` | trust badge "Envelope encryption", row body with Fernet + Vault | Row body is rewritten by UI-SPEC; the hero badge "Envelope encryption" stays true (DEK wrapped by KEK) | Keep badge |
| `(marketing)/for-quants/page.tsx` "Codename anonymization / Your firm name is never public ... allocators see only the codename until you explicitly accept an intro" and badge "Listed under codename", step 03 "under your codename" | See Factsheet findings below | **Not in UI-SPEC's change list; needs the same measurement** | Plan task: reconcile with the new "Public by link, under your codename" row so the page does not say two things |
| `(marketing)/legal/privacy/page.tsx:39-41` | "Keys are encrypted at rest and never used to place orders. We store the resulting analytics, not the raw keys in plaintext." | Agrees with S-KEY | Left (UI-SPEC) |
| `src/app/api/demo/match/.../route.ts` | masks to `Exploratory #<8 hex>` and `exploratory-<8 hex>` | A second raw-id shape that the UI-SPEC regex `Strategy #[0-9a-f]{8}` does not match | If the founder view is kept, extend the regex to `(Strategy|Exploratory) #[0-9a-f]{8}`; if removed, moot |

## Factsheet visibility (D-04) - what the code does

- `src/proxy.ts:18` `PUBLIC_ROUTES = [... "/strategy", "/factsheet", "/api/factsheet", "/api/og/factsheet", "/browse", ...]`; `/factsheet` is also bounce-exempt (`isFactsheetRoute`, `:119-120`) [VERIFIED].
- `src/app/factsheet/[id]/page.tsx` re-exports `./v2/page`. The v2 page's public lane reads `withPublishedOnly(...)` (published rows only, any viewer); with no row and no session it logs `"signature gate -> notFound"` and calls `notFound()` (the same 404 a missing id gets, by design; comments `v2/page.tsx:436-449, 485-487`).
- **Research reading**: a signed-out `GET /factsheet/<random uuid>` returned **404**. The published case needs a real published id; obtain one by a PROD MCP read (marker query first, one read-only query: one `id` from `strategies` where `status = 'published'`), then the executor runs signed-out `curl -s -o body.html -w '%{http_code}'` against `https://quantalyze.xyz/factsheet/<id>` and records the status plus whether the body contains the firm/company name of that strategy's manager (read `profiles.company` in a second MCP read; do not write either value into the repo evidence, record "present"/"absent"). The public `/browse/crypto-sma` page rendered no strategy links (research reading), so the id cannot be taken from the public site.
- What the factsheet shows as the strategy title: `fetch-and-build-payload.ts:968-974` "prefer the real name, fall back to codename, then to the synthetic Strategy#id" (`const factsheetName = strategy.name ?? strategy.codename ?? displayStrategyName(strategy);`). The v2 payload select (`:310-319`) has **no manager/profile join**: no firm name field exists in the v2 payload (read of the select list, so the executor's measured body check is the confirmation, not this absence).
- For wizard-created strategies, `strategies.name` **is** a preset codename: `MetadataStep.tsx:186-187` documents "The control is a `<select>` over `STRATEGY_NAMES`" and `:273` labels it "Strategy codename"; `src/lib/constants.ts:3-4` `export const STRATEGY_NAMES = [ "Alpha Centauri", "Black Swan", ...`. So "It shows your codename" is true for those. For seed/legacy rows whose `name` is a free-text real name (every demo archetype), the factsheet shows that name.
- The **tearsheet** differs: `tearsheet/page.tsx:364-368` forces the exploratory (redacted) block for any caller who is not logged in **and** attested (`const effectiveDisclosureTier = isAttested ? disclosureTier : "exploratory"; const effectiveManager = isAttested ? manager : null;`). So an attested signed-in allocator sees an institutional-tier manager identity with no accepted intro. The UI-SPEC clause "your firm name stays hidden until you accept an intro" is therefore **true for signed-out visitors and for the v2 factsheet, not for attested allocators on the tearsheet**. Recommendation: scope the sentence to what was measured: "A published factsheet opens for anyone who has its link, without signing in, and shows no firm name." Drop "until you accept an intro" unless the executor can show it holds for every viewer. This is a copy decision the planner must flag; it is `[ASSUMED]` that the founder wants the broader sentence.

## Exchange count and list - every source

- Single source: `EXCHANGES` (`closed-sets.ts:470`), re-exported by `src/lib/constants.ts:71` (`export { EXCHANGES };`). At HEAD with sFOX off it has 4 entries.
- Readers today: home `page.tsx:145` (`{EXCHANGES.length} exchanges supported`) and `:245-248` (the stat, label "Exchanges supported") [VERIFIED].
- Hard-coded: `for-quants/page.tsx:317` ("Binance, OKX, or Bybit. We validate ..."), `build-security-packet.html:254`. Everything else matched by the census grep (`/security` sections for Binance/OKX/Bybit walkthroughs are per-venue operational docs with their own anchors, not counts). `AllocatorExchangeManager.tsx:1389` ("Upload a read-only API key from Binance, OKX, Bybit, or ...") is signed-in UI, Phase 200 territory.
- `closed-sets.ts:331-333,485` document that the public count must not move when MT5 is flagged on; keep S-EXCH on `EXCHANGES`, never `WIZARD_EXCHANGE_CODES`/`SUPPORTED_EXCHANGES`.

## The `/demo` read path (D-08, D-10) - candidate root causes

**Code facts** (`src/app/(marketing)/demo/page.tsx`, read in full):
- Admin client (`createAdminClient()` throws if `SUPABASE_SERVICE_ROLE_KEY` is missing, so a missing key is a 500, never "loading"). RLS does not apply to the service role.
- Phase 1 errors are logged (`:121-134`), Phase 2 errors are **not read at all**: `adaptHoldings(holdingsRes.data ?? null)` (`:172`), `adaptPortfolioAnalytics(analyticsRes.data)` (`:173`). The "Demo data is loading" card renders when `!hasPortfolio && !hasRecommendations` (`:356`), i.e. when the holdings list is empty **and** there are no recommendations, whatever the reason.
- `strategy_name` inside `attribution_breakdown`/`optimizer_suggestions` is written by the analytics service from `strategies.name`, falling back to the raw id: `analytics-service/routers/portfolio.py:996,1024` `"strategy_name": strategy_names.get(sid, sid),` and `:2005` `s["strategy_name"] = candidate_names.get(s["strategy_id"], s["strategy_id"])`. `adaptPortfolioAnalytics` falls back the same way (`portfolio-analytics-adapter.ts:163` `strategy_name: asString(v.strategy_name) ?? strategy_id`). So a UUID can appear in `WinnersLosersStrip`, `WhatWedDoCard` and `NextFiveMillionCard`; and the stored name is the strategy's real `name`, not `displayStrategyName` (it ignores codename/tier).
- `adaptHoldings` returns a row with `name: ""` when the `strategies` embed is null; `displayStrategyName` then yields `Strategy #<8 hex>` (`strategy-display.ts`). Source of the `Strategy #xxxxxxxx` shape. The seeded archetypes cannot produce it (institutional tier with a real name, or exploratory with a codename; verified over the 15 `ARCHETYPES` in `seed-full-app-demo.ts`), so it appears only through a null embed or a non-demo row.
- Persona books: `seed-full-app-demo.ts` step 12 recreates the three `/demo` persona books "composed from this seed's own 15 strategies", and its header says an earlier version "wiped its data without replacement - leaving prod /demo in a permanent 'Demo data is loading' empty state". Its footer says "match_batches are NOT seeded (never were) - populate recommendations post-seed via POST /api/admin/match/recompute per allocator".

**Research reading of live PROD `/demo` (active persona, public GET, 2026-11-06; execution re-records):** page rendered 200 with hero "Portfolio TWR +25.86%", "BTC TWR —", "Portfolio drawdown -11.65%", "BTC drawdown —", a "Download IC Report" link, the narrative line ("Active Allocator Portfolio: 3 active strategies, total AUM $10.00M, TWR 25.9% since inception, Sharpe 1.19, max DD -11.7%."), "Top contributors" with two seed strategy names, "Top detractors" with one, then **no holdings list, no recommendations, "Demo data is loading"**, and the footer "Founder view →". The persona's `/api/demo/match/<id>` JSON on PROD returns a non-null `profile`, `batch: null`, `candidates: []`, i.e. the persona profile exists and no batch exists. (The same JSON carries the persona's seed email: `TODOS.md` `[170.1.2-DEMO-MATCH-PAYLOAD-EMAIL]` is closed for free if the route is deleted.)

So the persona profile, portfolio and `portfolio_analytics` row all exist on PROD (the hero needs `portfolio.id`), but `holdings.length === 0`. This rules out "PROD was never seeded". Candidates, in the order the planner should test them, each with the PROD read that confirms it (Supabase MCP, one read-only query per call, marker query first, nothing written to the repo but yes/no/counts):

| # | Candidate cause | Confirming PROD read | Fix if confirmed |
|---|-----------------|----------------------|------------------|
| C1 | The persona portfolio has zero `portfolio_strategies` rows (rows lost when example strategies were deleted/re-created: `portfolio_strategies_strategy_id_fkey ... ON DELETE CASCADE`, `baseline.sql:16083`; or the seeder's persona step ran partially) | `count(*)` of `portfolio_strategies` for the persona's portfolio id (the id is `ACTIVE_PORTFOLIO_ID` in `src/lib/demo.ts`) | A data repair: re-insert via the product's seeder path on a safe target is impossible (guards); needs a founder-authorized PROD write or the executor's decision to remove the holdings list claim. Also then read the strategies' `computation_status` |
| C2 | Rows exist but the embedded select errors (swallowed) | Run the exact select from `page.tsx:149-155` against PROD via MCP and read the error | Code fix + logging; **no ambiguity expected**: `strategies` has one FK from `portfolio_strategies` and `strategy_analytics`'s table name resolves uniquely (`baseline.sql:16078-16083,16173-16178`; `strategy_analytics_series` is a different relation), so C2 is unlikely |
| C3 | `strategies` embed null (strategy rows deleted/unreadable) | Same select; check `strategies` rows for the held ids | Treat null embed as read failure (throw); data repair |

Whichever is true, the page change is the same and is cheap to plan now: read and surface every `.error`, treat a null `strategies` embed as failure (never render `Strategy #...`), and add a unit test with a Phase-2 error that must throw. The PROD read decides whether a data repair is also required; **a data repair is a PROD write and must not be planned as an unconditional task**.

### BTC "—" cells (SC-5) - found cause
`portfolio-analytics-adapter.ts:150` reads `benchmark_twr: asNumber(v.benchmark_twr)`, and the Python writer uses the same names. `scripts/seed-full-app-demo.ts:1031-1038,1204-1211` writes `benchmark_comparison: { symbol, benchmark_return, portfolio_return, alpha, beta, stale }` with `benchmark_return: 0.62` (a hard-coded constant, `:1206`). `scripts/seed-demo-data.ts:265-268,512` writes `benchmark_twr`. So the PROD persona rows (written by the full-app seeder, evidenced by the attribution names) carry **no** `benchmark_twr`, giving "BTC TWR —", hiding `CounterfactualStrip` (`portfolioTwr == null || benchmarkTwr == null` returns null), and leaving the headline "Beat BTC on the way up. And on the way down." over two dashes. `page.tsx:185-193` hard-codes `benchmarkMaxDrawdown` to `null`.
**Decision rule for the plan (never invent data):** BTC TWR/drawdown are renderable only if computed from stored real data; `benchmark_return: 0.62` is not that. A real computation would need BTC closes in `benchmark_prices` (`date`, `symbol`, `close_price`, `baseline.sql:12843-12847`) covering the first-to-last date of `portfolio_equity_curve` (which the adapter exposes). That is a PROD read (coverage of `symbol='BTC'` over the window) plus new read-time math in a public route. Recommendation: **remove the two BTC cells and use the neutral headline "Allocator portfolio review"** (UI-SPEC already allows it), and only plan the computation if the founder asks for it. Fixing the seeder's key names is a separate, optional hygiene item; it does not repair PROD.
The `CounterfactualStrip` default `period = "12 months ago"` is false for the persona books (window starts 2024-06-03 per the seed; `SEED_END = 2026-04-08`): derive the window from `analytics.portfolio_equity_curve` first/last dates or do not render it. With BTC TWR absent it will not render anyway.

### Recommendations and the founder view (D-09) - what the data needs
- `AllocatorMatchQueue` (via `getAllocatorMatchPayload`, `src/lib/admin/match.ts`) and `/demo`'s `resolveDemoRecommendations` both need a **`match_batches` row for the demo allocator with ranked, non-excluded `match_candidates`** (`rank` not null XOR `exclusion_reason` not null, `baseline.sql:13767-13780`; `/demo` shows up to 3: `limit(3)`, `MIN_LATEST_RECOMMENDATIONS = 3`).
- Only producer: `POST /api/admin/match/recompute` (admin session, same-origin CSRF, `maxDuration = 300`) which calls analytics-service. The scoring universe for the demo allocator is `is_example = true` published strategies (`match.py:1827-1840`; `_load_candidate_universe(demo_only=True)` `:399-427`).
- The cron **excludes** the demo allocator on purpose: `match.py:3212` `.neq("id", _DEMO_ALLOCATOR_ID)` (D-01, QUANTALYZE-Z, to stop a warning). So a batch, once made, goes stale: `AllocatorMatchQueue` prints "Stale: Nd ago" in `text-negative` when `computeFreshness(...) === "stale"` (`:467,541-544`), which the UI-SPEC lists as an unresolved consideration. Keeping it fresh means reversing a recorded decision in `analytics-service` (not in scope).
- PROD example strategies were `computation_status = 'failed'` since 2026-05-27 while still holding `sharpe/cagr` and (per STATE) `daily_returns` (TODOS `[159-SEED-01]`); whether the engine ranks them is not established.
- **Measurement for the decision rule** (D-09 "computable"): on the local-stack lane (private to the runner, safe), seed with `seed-demo-data.ts` then recompute for the demo allocator and count ranked candidates; that proves the *mechanism* but not PROD's data. PROD proof needs a PROD recompute (a write through the product's own admin path). **Recommended default: remove the founder view** (UI-SPEC's "Removed" outcome): the data is not produced by anything automatic, the batch would go stale in the shared queue component, and deletion also closes `[170.1.2-DEMO-MATCH-PAYLOAD-EMAIL]` and a public service-role fan-out route. Keep it only if the founder authorizes a PROD recompute and accepts a stale stamp. The `/demo` recommendations block depends on the same batch, so the plan must state that `/demo` renders with holdings alone (UI-SPEC: "the holdings stand alone").

### Founder-view removal - complete reference list (grep at HEAD, excluding `.planning`, CHANGELOG, TODOS)
Code and config:
- `src/app/(marketing)/demo/founder-view/page.tsx` (delete); `src/app/(marketing)/demo/page.tsx:375-379` footer link; `src/app/(marketing)/demo/layout.tsx:11` docblock mention.
- `src/lib/routing/route-contract-manifest.ts:315` the `/demo/founder-view` entry. `scripts/check-route-contract.ts` Rule 4: "Every manifest entry MUST map to a real page file on disk... STALE", so the entry must go in the same change or `npm run lint` fails.
- `src/lib/demo.ts:4` docblock (mentions the route); `src/lib/playwright-console-filter.ts` and `.test.ts` (examples naming `/api/demo/match`; leave the generic helper, edit only if tests assert the founder spec).
- `eslint.config.mjs:267` lists `"src/app/(marketing)/demo/founder-view/page.tsx"` in a rule-scope array.
- `next.config.ts:308-326` comment block (the `/demo/:path*` header rule stays for `/demo`; edit the comment only).
- If the API is removed too: `src/app/api/demo/match/[allocator_id]/route.ts` and `route.test.ts`; `vitest.node-env.ts:168` (lists the test file); `src/lib/api/limiter-ordering.test.ts:150` (lists `"demo/match/[allocator_id]/route.ts"` in a bucket; check how a bucket entry for a missing route behaves before deleting); `src/lib/admin/match.ts:11,125` comments.
- `src/components/admin/AllocatorMatchQueue.tsx` `forceReadOnly`/`sourceApiPath` props and `AllocatorMatchQueue.test.tsx`: leave (shared admin component, out of scope; props become unused by prod code but remain tested).
- `src/proxy.ts` keeps `"/demo"` and `"/api/demo"` (the PDF route `/api/demo/portfolio-pdf` remains). `src/proxy.test.ts:224-225,357` reference a `/demo/match/abc-123` path as a prefix example, unaffected.
- No sitemap or robots file exists under `src/app` (`ls src/app` and grep, 2026-11-06); `public/` has none.
e2e and CI:
- `e2e/demo-founder-view.spec.ts` (delete); `e2e/marketing-shell.spec.ts:46` row `{ path: "/demo/founder-view", ...}`; `e2e/demo-public.spec.ts:30,262-266` (comments and `ignoreTextOrUrlIncludes: ["/api/demo/match"]`).
- `.github/workflows/ci.yml:6192,6398,6454` mention/list `e2e/demo-founder-view.spec.ts` in the unseeded `e2e` command; remove it from the command, and check `src/__tests__/critical-regressions.test.ts` (it pins parts of this CI file, e.g. `:1047` region and `:205`), `grep -n "demo-founder-view" src/__tests__ -r` before editing.
- Docs: `docs/architecture/adr-0009-caching-strategy.md:72` names the page (history; leave or amend with a one-line note).

## Common Pitfalls

### Pitfall 1: The placeholder-env e2e lane IS the `/demo` fixture (phase-shaping)
**What goes wrong:** UI-SPEC says a read error or an empty persona `throw`s to `error.tsx`. The `e2e` CI job builds with `NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY: placeholder_service_role` and runs `/demo` against it; `demo-public.spec.ts` header: "Under that env the admin Supabase client can't connect, so /demo falls through to the 'Demo data is loading' empty-state card". With a throw, `/demo` becomes the error page, and these break: `demo-public.spec.ts` (status `< 400`, persona-switcher chrome, console cleanliness, overflow), `demo-screenshot.spec.ts` (three committed `chromium-linux` PNGs of the placeholder empty state), `reflow-sweep.spec.ts:53`, `no-clip-sweep.spec.ts:156`, `axe-app-wide.spec.ts:101` (each anchors `#editorial-hero-headline`), `marketing-shell.spec.ts:45`, plus `demo-founder-view.spec.ts`. All are in the single command at `ci.yml:6398`.
**Why:** the specs were written when the empty-state card was the expected placeholder render.
**How to avoid (decision for the plan, recommended):** (1) keep the throw (UI-SPEC, and "fail loud" is the point); (2) the unseeded lane gets exactly one `/demo` spec that asserts the *loud* behaviour under placeholder env (error boundary heading "Something went wrong", no "Demo data is loading"); the HTTP status of a thrown RSC render is `[ASSUMED]` 500, **probe it** with `next build && next start` under the CI placeholder env before writing the assertion; (3) drop the `/demo` rows from the unseeded-lane sweeps (reflow, no-clip, axe, marketing-shell) and cover `/demo` in the `e2e-seeded` lane, which already runs `no-clip-sweep`, `axe-app-wide`, `target-size` (so `/demo` rows already execute there against a private seeded DB) and seeds portfolios + analytics through `seed-demo-data.ts` (`ci.yml:6829`); (4) retire `demo-screenshot.spec.ts` and its three PNGs (its own header says the baselines pin the placeholder empty state "NOT the seeded production render", the state this phase removes) or retarget it to the seeded lane and re-bake via the existing `bake_demo_screenshots` dispatch (a bake needs the Linux image; local Docker is the documented alternative). Retiring a gate is a decision: surface it to the orchestrator, do not let the executor decide it. Either way the banner copy change ("Real product on production." cut) alters the demo screenshots, so the baselines cannot stay as they are.
**Warning signs:** `e2e` job red on `/demo` in the first PR run; `critical-regressions.test.ts` red after editing `ci.yml` (it pins CI structure).

### Pitfall 2: seed/reader shape drift is invisible to unit tests
The demo test mocks Supabase and the adapter test feeds `benchmark_twr`, so the `benchmark_return` seed shape never meets the reader. A test that passes the **seeder's actual payload** through `adaptPortfolioAnalytics` would have caught it; add one asserting the full-app seeder's `benchmark_comparison` keys are the reader's keys, or accept that the BTC cells are removed and the seeder is left (record the drift in TODOS as a routed item rather than fixing silently).

### Pitfall 3: `error.tsx` is signed-in copy and replaces the marketing shell
Root `src/app/error.tsx` (client) says "return to the dashboard" with "Go to Discovery" (`/discovery/crypto-sma`), shows `Error ID: {error.digest}`, and (being the root boundary) replaces the whole `(marketing)` layout, so the masthead and footer vanish with it. UI-SPEC accepts it for an outage path; a nested `src/app/(marketing)/demo/error.tsx` would keep the demo banner and shell but is new surface, so record the choice. In production the thrown message is masked and only `digest` reaches the client `[CITED: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:106-111]`; the real message must be in `console.error`/Sentry server-side (the UI-SPEC's "log, report, throw" order).

### Pitfall 4: tearsheet reveals identity to attested allocators
See Factsheet visibility. Do not write "firm name hidden until an intro" as an absolute.

### Pitfall 5: `EditorialHero` markup does change
UI-SPEC says the phase "changes which cells ... not its markup", but `MetricCell` always renders every `<dt>/<dd>` pair (`EditorialHero.tsx`: four `MetricCell`s, a null value prints `formatSignedPercent(null)` as the dash). Removing a null cell requires a conditional in this component (it is used only by `/demo`: usages are `demo/page.tsx`, its tests, `e2e/reflow-sweep.spec.ts`, and the display-sign census tests). Update `EditorialHero.test.tsx`, `portfolio.signed-zero.test.tsx`, `display-sign-census-misses.test.tsx` and `display-sign-single-source.test.ts` expectations that count cells or expect dashes.

### Pitfall 6: the shared strips "never unmount" by policy
`WinnersLosersStrip` documents "Editorial /demo policy: strips NEVER unmount ... The strip now always renders with fallback copy" (so the page height is stable). The UI-SPEC reverses that for `/demo` by gating on the page. Update the component docblock and `WinnersLosersStrip.test.tsx` only if the component itself changes; gating at the call site leaves the component untouched.

### Pitfall 7: orphaned home components are pinned by tests
After the home section is replaced, `VerificationSection/Form/Results/Progress` are imported nowhere in app code. They are still referenced by `page.stat-errors.test.tsx:38-39` (a `vi.mock` of `VerificationSection`; harmless once the import is gone but delete the mock), `display-sign-single-source.test.ts:1212` (path-keyed census entry for `VerificationProgress.tsx`), `src/components/landing/*test*`, and `/api/verify-strategy` is in `PUBLIC_ROUTES`, the contracts registry and `seam-budgets.invariant.test.ts`. **Leave all of them in place this phase** (Surgical Changes) and book the dead-code removal; deleting any one of them triggers a census/registry edit chain with no phase requirement behind it. Note for the record: the public `/api/verify-strategy` endpoint stays reachable by anyone who calls it directly, so SC-4 ("no form") is met but the endpoint is not removed.

### Pitfall 8: `Last reviewed` and `Last updated` dates
`security-packet-date-drift.test.ts` requires the same ISO date after "Last reviewed" in `build-security-packet.html` (`<span class="mono">2026-10-07</span>`) and `security/page.tsx:392` (`Last reviewed: 2026-10-07.`). Bump both to the change date, then rebuild the PDF. Terms "Last updated: 2026-04-07" (`terms/page.tsx:15`) becomes the commit date per UI-SPEC. The PDF's own text is not asserted by any test (binary), so verify it with `pdftotext public/security-packet.pdf -` (poppler 26.02.0 present on the workstation) and record the output in the evidence file.

### Pitfall 9: public JSON lane, Cache-Control and the demo route
`next.config.ts` sets `Cache-Control: public, s-maxage=10, stale-while-revalidate=300` for `/demo/:path*`. A thrown render is not cached as a page success, but the 10 s edge cache applies to whatever the page last returned; verify after fixing that a recovered page does not keep serving the old card (`stale-while-revalidate=300`).

## Code Examples

### Shared constants (pattern; wording is the UI-SPEC's, verbatim)
```ts
// Source: 192-UI-SPEC.md Copywriting Contract; module per CONTEXT discretion
export const KEY_STORAGE_SENTENCE =
  "We store your read-only API key encrypted, under a data key of its own, and only our analytics service can decrypt it.";
export const KEY_STORAGE_LINK = { href: "/security#key-handling", label: "How we store keys" } as const;
export const LISTING_COST_SENTENCE =
  "Listing a strategy is free. A success fee may apply to matched allocations, as set out in the manager agreement.";
// EXCHANGES is derived (flag-aware) at module load; never type the names or the count
import { EXCHANGES } from "@/lib/closed-sets";
export const EXCHANGE_LIST = new Intl.ListFormat("en", { style: "long", type: "disjunction" }).format(EXCHANGES);
```
Check `status-surface-copy.ts` imports: it is also imported client-side in places; `closed-sets` is pure (only `zod`), so the import is safe, but confirm with `npx tsc --noEmit` and the existing client-bundle tests.

### Demo read hardening (shape, not final code)
```ts
// Source: src/app/(marketing)/demo/page.tsx:146-174 (current), changed to read errors
const readErrors = [holdingsRes.error, analyticsRes.error].filter(Boolean);
if (readErrors.length) { console.error("[demo] phase-2 read failed:", readErrors); captureToSentry(readErrors[0], { tags: { route: "demo", stage: "phase2" } }); throw new Error("demo read failed"); }
if (holdings.some((h) => !h.strategy.name && !h.strategy.codename)) throw new Error("demo holding without a strategy row");
if (!hasPortfolio && !hasRecommendations) throw new Error("demo persona has neither holdings nor recommendations");
```
`fetchCandidatesForBatch` in `demo-recommendations.ts` destructures only `{ data: rows }`; a recommendation read error is currently invisible. Return the error or throw from it (its test file `demo-recommendations` fake needs updating).

### Source-level census test (can fail; reads the packet HTML too)
```ts
// Pattern from src/__tests__/security-packet-date-drift.test.ts (fs reads, anchored, no vacuous pass)
const BANNED = ["never stored.", "AES-256-GCM", "Supabase Vault", "TLS 1.0, 1.1, and 1.2",
  "qualified allocators only", "Retail discovery never sees", "Binance, OKX, or Bybit",
  "Demo data is loading", "Recommendations computing", "Strong fit for this allocator"];
// scan: src/app/(marketing)/**, src/components/landing/**, scripts/build-security-packet.html
// plus a regex /(Strategy|Exploratory) #[0-9a-f]{8}/ over the demo + route sources
// anti-vacuity: assert the scanned file list is non-empty and includes the packet HTML
```
Caveat: `src/components/landing/VerificationForm.tsx:219` still carries "Your keys are never stored." after the home section is replaced (the file stays, Pitfall 7). Either scope the scan to *rendered* pages (render Home and assert) or edit that line when you leave the component in place; do not let the source scan and the "leave the component" rule contradict.

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| `/security`: AES-256-GCM, Vault KEK, TLS 1.3 only | Fernet + env KEK; TLS 1.2 and 1.3 accepted | Copy, packet, two wizard steps |
| `Strategy #id` fallback as display | Fix at data/read for `/demo` | D-10 |
| Next.js error masking | Production RSC errors arrive as digest only | Log server-side before throwing |

**Deprecated/outdated:** the migration header comment ("KEK stored in Supabase Vault") and the seeder's `benchmark_return` shape are stale artefacts; leave migrations alone.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Fernet is AES-128-CBC with HMAC-SHA256 | Standard Stack | `/security` states it; low risk, confirm in `cryptography` docs |
| A2 | Vercel documents no minimum-TLS control (absence of evidence) | Standard Stack | Only changes a recorded note; behaviour unchanged by D-03 |
| A3 | A thrown RSC render returns HTTP 500 in this app under placeholder env | Pitfall 1 | The new unseeded `/demo` assertion would be wrong; probe with a build |
| A4 | The founder wants "firm name hidden until you accept an intro" kept verbatim | Factsheet visibility | Tearsheet reveals identity to attested allocators; sentence would be false for them |
| A5 | C1 (zero holdings rows) is the PROD cause; C2/C3 unlikely | `/demo` read path | Wrong order of PROD reads only; all three reads are cheap |
| A6 | The match engine would rank the `failed`-status example strategies | Founder view | D-09 decision rule input; unmeasured |
| A7 | Deleting `/api/demo/match` leaves `limiter-ordering.test.ts` green after a bucket edit | Removal list | Possible extra test edit; run the test before and after |
| A8 | Wizard "Strategy codename" select is the only strategy-creation path that sets `name` | Factsheet visibility | Other creation paths may set a real name, making "shows your codename" untrue for them |

## Open Questions (RESOLVED)

Each question below is resolved by a plan. The question text is kept as written at research time; the `RESOLVED` line under it names the plan that settles it.

1. **Re-home of the unseeded `/demo` e2e specs and the screenshot gate (Pitfall 1).** Known: eight specs plus three PNGs depend on the placeholder render. Unclear: whether the founder accepts retiring `demo-screenshot.spec.ts`. Recommendation: ask once with the plan, default to retiring it and to one loud-failure spec plus seeded-lane coverage.
   RESOLVED by plan 192-08: Task 2 is a `checkpoint:decision` (retire or retarget, default retire, reason recorded). Task 1 adds the loud-failure spec, plans 192-08 and 192-09 move the coverage to the seeded lane, and plan 192-10 books the pixel re-baseline if the gate is retired.
2. **D-09 keep or remove.** Recommendation above: remove, unless the founder authorizes a PROD recompute and a stale stamp. This is the one `/demo` decision that needs PROD (write) facts; it should be decided before plan 4 is written, or planned as "remove" with the PROD read as an optional upgrade.
   RESOLVED by plan 192-01: Task 2 measures the D-09 rule's inputs, and Task 3 is a `checkpoint:decision` (default remove) that writes `D-09 outcome:`. Plans 192-05 and 192-07 carry out "remove" behind a `D-09 outcome: remove` precondition and stop if it reads keep. Plans 192-08 and 192-09, which depend on them, drop the founder-view e2e rows.
3. **`/demo` data repair (D-08).** Whether C1 needs a PROD write is only knowable after the three reads; plan the reads as plan 1 tasks and the repair as a conditional, founder-confirmed task.
   RESOLVED by plans 192-01 and 192-06: 192-01 Task 2 makes the reads and writes one `D-08 verdict:` line. 192-06 drafts the repair only on `repair-needed` and writes to PROD only on the founder's "apply". Plan 192-10's ship gate holds the phase unless `D-08 repair:` reads applied or not needed, and the post-deploy probe is owned in 192-VALIDATION.md.
4. **The two wizard steps with the same false encryption sentence.** Recommendation: book to Phase 200 LEAN-04 (it owns manager surfaces) but tell the founder these two surfaces remain false after 192; if he prefers, replacing both bodies with `KEY_STORAGE_SENTENCE` is a two-line change plus tests in the same constants module.
   RESOLVED by plan 192-10: Task 3 books `[192-WIZARD-KEY-STORAGE-COPY]` with owner Phase 200 MANAGERKEYS (LEAN-04). Plans 192-03 and 192-10 name the two surfaces for the founder.
5. **Retention contradiction**: PDF "30 days; hard-deleted by daily job" vs `/security` "all kept for the life of the connection". Not one of the five claims; verify against the retention job and correct one document or book it.
   RESOLVED by plans 192-01 and 192-04: 192-01 Task 1 records `Retention at HEAD:` from the code, and 192-04 Task 3 makes /security and the packet state only that line, or removes the claim when it reads undeterminable.
6. **`for-quants` "Codename anonymization" rows**: reconcile with the new "Public by link, under your codename" row after the signed-out measurement.
   RESOLVED by plans 192-01 and 192-03: 192-01 Task 2 records the signed-out status, firm-name presence, the title classification and the non-codename title count. 192-03 Task 2 rewrites the codename rows, scoped to a signed-out request. Its codename sentences ship only on `title=codename non-codename-titles=0`; any other reading stops for the founder.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | tests, packet build | yes | v25.8.1 | CI uses Node 22 (vitest `DEF-16-1` note) |
| Google Chrome (macOS) | packet rebuild | yes | `/Applications/Google Chrome.app` present | `PUPPETEER_EXECUTABLE_PATH` |
| `pdftotext` | PDF text check | yes | 26.02.0 | none needed |
| OpenSSL | TLS handshakes | yes | 3.6.4 | n/a |
| Docker | screenshot baseline bake | not probed | - | `bake_demo_screenshots` workflow_dispatch |
| Supabase MCP (PROD, read-only) | D-04 id, D-08 reads | execution-time | - | none; PROD writes need confirmation |
| `node_modules` in the worktree | vitest, tsc | yes | present | `npm ci` |

**Missing with no fallback:** none for planning. Execution needs PROD MCP read access for D-04 and D-08 evidence.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x (jsdom default; node project via `vitest.node-env.ts`), `@testing-library/react`; Playwright for e2e |
| Config file | `vitest.config.ts` (`INCLUDE` covers `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.{ts,tsx}`), `playwright.config.*` |
| Quick run command | `npx vitest run src/lib/status-surface-copy.test.ts "src/app/(marketing)" src/components/portfolio src/__tests__/security-packet-date-drift.test.ts` |
| Full suite command | `npx vitest run` then `npx tsc --noEmit` and `npm run lint` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRUST-01 / SC-1 | Home, `/for-quants`, Terms render `KEY_STORAGE_SENTENCE` + `/security#key-handling` link; `/security` has the full explanation and `id="key-handling"` | render | `npx vitest run src/__tests__/public-truth-copy.test.tsx` | Wave 0 |
| TRUST-01 / SC-1 | No banned phrase in the marketing tree, landing components or `build-security-packet.html` | fs census | same file | Wave 0 |
| TRUST-01 / SC-1 | Packet HTML facts equal the `/security` rows; dates match | fs | `npx vitest run src/__tests__/security-packet-date-drift.test.ts` | exists (extend) |
| TRUST-01 / SC-2 | `/security` TLS sentence text pinned; handshakes recorded | render + evidence file | render in the census; evidence is a recorded artifact, not a test | Wave 0 + execution evidence |
| TRUST-01 / SC-2 | `/for-quants` visibility sentence pinned; signed-out factsheet status recorded | render + evidence | same | Wave 0 + evidence |
| TRUST-01 / SC-3 | Cost sentence identical on `/for-quants` and Terms §7; exchange list/count equal `EXCHANGES` on home, `/for-quants`, packet | render + fs | census file | Wave 0 |
| TRUST-01 / SC-4 | Home renders no password/secret/key input, no "never stored", one `Link` to `/signup` | render (`page.stat-errors.test.tsx` mock pattern) | `npx vitest run "src/app/(marketing)/page"` | extend existing |
| ROUTE-03 / SC-5 | No `Demo data is loading`, no `Recommendations computing`, no invented reason, no `#—`; null BTC cells removed; neutral headline; counts read `holdings.length` | render (`page.max-dd-tone.test.tsx` mock pattern) | `npx vitest run "src/app/(marketing)/demo"` | extend existing / new file |
| ROUTE-03 / SC-5 | A Phase-2 read error, a null strategy embed, and an empty persona each throw | render | same | Wave 0 |
| ROUTE-03 / SC-5 | No `Strategy #xxxxxxxx` or UUID in rendered demo text, incl. `attribution_breakdown` names | render | same | Wave 0 |
| ROUTE-03 / D-09 (if removed) | No file or reference left | lint + grep | `npm run lint`; `grep -rn "founder-view\|api/demo/match" src e2e .github eslint.config.mjs vitest.node-env.ts` returns nothing but comments you chose to keep | n/a |
| ROUTE-03 | Unseeded lane asserts the loud failure; seeded lane renders `/demo` with data | e2e | `npx playwright test e2e/demo-public.spec.ts` (placeholder env) and the seeded list | rewrite spec |

### Sampling Rate
- **Per task commit:** the quick command above plus `npx tsc --noEmit` on touched types.
- **Per wave merge:** `npx vitest run`, `npm run lint`.
- **Phase gate:** full suite green and CI e2e green on the head SHA before `/gsd-verify-work`.
- **RED-then-restore rule:** for each new census/render test, take a `cp` byte backup of the page being tested, restore HEAD's old sentence into the working copy (or the banned phrase), show the test RED naming the phrase, restore from the backup, show GREEN. Never `git checkout/restore/stash`. Same for the throw tests (remove the `.error` check, see RED, restore) and for the removed-cell test (re-add the dash cell).

### Wave 0 Gaps
- [ ] `src/__tests__/public-truth-copy.test.tsx` - SC-1..SC-4 renders and census (new)
- [ ] `src/app/(marketing)/demo/page.truth.test.tsx` - SC-5 cases (new; reuse the `max-dd-tone` mock builder)
- [ ] `src/lib/status-surface-copy.test.ts` - literal pins for the three new constants (extend)
- [ ] `e2e/` unseeded loud-failure assertion for `/demo`, and `/demo` rows moved to the seeded lane (rewrite `demo-public.spec.ts`, edit sweeps)
- [ ] Evidence file in the phase directory (handshakes, HSTS and certificate readings, signed-out factsheet status and body check, the three D-08 PROD read answers as yes/no/counts, `pdftotext` output) - no PROD ids

## Security Domain

`security_enforcement` not set false in `.planning/config.json`, so it applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no auth change; the CTA only links to `/signup` |
| V3 Session Management | no | home still redirects signed-in users (`page.tsx:70-72`) |
| V4 Access Control | yes | the `/demo` persona enum allowlist stays the only input transform (`getPersona`); the page keeps the admin client behind it; `/factsheet` publishes only `status = 'published'` |
| V5 Input Validation | yes | persona allowlist; no new inputs |
| V6 Cryptography | yes (claims only) | the phase describes, never changes, Fernet/KEK; do not hand-roll or alter crypto |
| V9 Communications | yes (claims only) | TLS claims match recorded handshakes |
| V14 Configuration | yes | HSTS header is repo-set; do not weaken seeder guards |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Public route exposing service-role fan-out (`/api/demo/match`) and a persona email in cached JSON | Information disclosure / DoS | Delete the route with the founder view (default), else mask `profile.email` per `[170.1.2-DEMO-MATCH-PAYLOAD-EMAIL]` |
| False security claims | Repudiation / trust | Single-source constants + census test + rebuilt packet |
| Thrown error leaking detail | Information disclosure | Next masks to a digest in production; log server-side only |
| Raw ids or real strategy names of non-example rows on `/demo` | Information disclosure | Fix at data/read; keep reads parameterized by persona only |
| Weakening seed guards to "fix" PROD | Tampering | Do not; PROD changes go through authorized MCP/product paths |

## Sources

### Primary (HIGH confidence)
- Repo files read this session (paths with lines cited inline): `demo/page.tsx`, `demo/layout.tsx`, `founder-view/page.tsx`, `api/demo/match/[allocator_id]/route.ts`, `src/lib/{personas,demo,demo-recommendations,strategy-display,closed-sets}.ts`, `src/proxy.ts`, `next.config.ts`, `analytics-service/services/encryption.py`, `analytics-service/routers/match.py`, `routers/portfolio.py`, `supabase/migrations/20260410225608_api_keys_column_revoke.sql`, `supabase/schema/baseline.sql` (grants, tables), `scripts/seed-full-app-demo.ts`, `scripts/seed-demo-data.ts`, `scripts/build-security-packet.{html,mjs}`, `docs/runbooks/security-packet-update.md`, `.github/workflows/ci.yml` (e2e/e2e-seeded), the e2e specs named above, `DESIGN.md:432-470`.
- Next.js 16.4.2 bundled docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`, `01-app/01-getting-started/10-error-handling.md`.
- Live public readings by `openssl s_client` and `curl` against the production host, 2026-11-06.

### Secondary (MEDIUM confidence)
- Vercel docs, Encryption and TLS: https://vercel.com/docs/security/encryption (supported TLS versions, ciphers, certificates, HSTS default); Vercel community thread on disabling TLS versions (secondary).

### Tertiary (LOW confidence)
- Fernet = AES-128-CBC + HMAC-SHA256 (training knowledge, A1).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new packages; modules verified by reading.
- Architecture / copy census: HIGH, grep plus file reads.
- D-08 root cause: MEDIUM, narrowed by a live reading and code, three PROD reads outstanding.
- Pitfalls: HIGH for CI-lane coupling (read in CI and the specs), MEDIUM for the 500-status assumption (A3).

**Research date:** 2026-11-06
**Valid until:** 2026-11-13 for the live readings and PROD-dependent items (the demo and TLS readings are re-recorded at execution); 30 days for the code facts.
