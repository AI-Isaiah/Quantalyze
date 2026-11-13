# Phase 192: PUBLICTRUTH — the public site and the demo tell a visitor one true story - Context

**Gathered:** 2026-11-06
**Status:** Ready for planning

<domain>
## Phase Boundary

The home page, `/security`, `/for-quants`, Terms and `/demo` give a first-time visitor one consistent, true account of key storage and encryption, accepted TLS versions, who can view a factsheet, listing cost and the number of supported exchanges; the home page asks an anonymous visitor for no key or secret; `/demo` looks finished (TRUST-01, ROUTE-03). Copy and layout are checked against `DESIGN.md` (Voice / microcopy, AI-Slop Ban). Never invent data.

</domain>

<decisions>
## Implementation Decisions

### Key storage and encryption (area 1, accepted as recommended)
- **D-01:** The truth is the code path that stores credentials, read by the planner at HEAD. Today the pages disagree: `/security` says AES-256-GCM envelope encryption with a Vault-held KEK, `/for-quants` says a per-row Fernet data key, and the home form says "Your keys are never stored." At least two of these are false.
- **D-02:** The full explanation lives once, on `/security`. Home, `/for-quants` and Terms carry one identical short sentence that links to it. (Phase 200 LEAN-04 later owns "the security explanation lives in one place" for the manager surfaces; this phase sets the public copy it builds on.)

### TLS and factsheet visibility (area 2, accepted as recommended — sentence changes, behaviour stays)
- **D-03:** TLS, measured 2026-11-06 from a workstation with OpenSSL 3.6.4 against the production host: TLS 1.0 and 1.1 are refused by the server (alert 70, protocol version, with `@SECLEVEL=0` so the client could offer them); TLS 1.2 is accepted (ECDHE-RSA-AES128-GCM-SHA256); TLS 1.3 is accepted (TLS_AES_128_GCM_SHA256). `/security`'s "We disable TLS 1.0, 1.1, and 1.2 at the edge" is false and is rewritten to match. The handshakes are re-recorded in the phase at execution, for each version. The behaviour is not changed. (Assumption, not measured: the Vercel edge does not offer a per-project switch that drops TLS 1.2. The planner verifies it in Vercel's docs and records it.)
- **D-04:** Factsheet visibility: the proxy lists `/factsheet` in `PUBLIC_ROUTES` and the v2 page serves a published factsheet to signed-out visitors. `/for-quants`' "Listed to qualified allocators only … Retail discovery never sees your factsheet" is false and is rewritten to the truth: a published factsheet is public by link, and the firm name stays behind its codename. The behaviour is not changed. The executor records what a signed-out request for a published factsheet returns.
- SC-2 note: the founder chose to change the sentences, not the behaviour, for both D-03 and D-04.

### Listing cost and exchange count (area 3, accepted as recommended)
- **D-05:** One shared sentence on `/for-quants` and Terms §7: free to list, and a success fee may apply on matched allocations as set out in the manager agreement. No fee figure is invented (legal and fee terms are founder-supplied, see REQUIREMENTS Out of Scope).
- **D-06:** Every page that states an exchange count reads one shared, flag-aware value, the one the home page already uses (`EXCHANGES` from `src/lib/closed-sets.ts`, flag-gated venues included the same way). No hard-coded count in copy.

### Home form and /demo (area 4, accepted as recommended)
- **D-07:** The home page shows an anonymous visitor no API key or secret form. `VerificationSection` is replaced, for anonymous visitors, by a sign-up call to action.
- **D-08:** `/demo` showed "Demo data is loading" on PROD on 2026-11-06. Root-cause why the demo data does not load (`demo/page.tsx` notes an admin-client path and a persona-id lookup) and fix that cause. A headline figure that cannot be computed is removed together with its claim, never filled in.
- **D-09:** `/demo/founder-view`: filled from the same demo data if it can be computed; otherwise the route and every link to it are removed.
- **D-10:** No raw id where a strategy name belongs: show the strategy's name or codename.

### Founder override 2026-11-07: the public demo is retired (supersedes parts of D-07 to D-10)
- **D-11 (founder override, 2026-11-07, recorded under the CLAUDE.md deviation policy):** The public demo feature is retired in code. Plan 192-06 asked how to handle `D-08 verdict: strategies-missing` (the 9 strategies the persona books are built from are absent on PROD). The founder answered "delete demo", clarified it as "Page only", then wrote: "retire the whole demo part". Scope:
  - Removed: `/demo` and every sub-route, its API routes, its components, data readers, the persona and allocator wiring used only by the demo, its e2e and visual specs, and every link to it (nav, home, marketing pages, sitemap, `PUBLIC_ROUTES`, route-contract manifest, console-filter allowlists).
  - PROD demo rows stay untouched: no PROD writes or deletes.
  - Plan 192-06's repair is moot. 192-EVIDENCE.md records `D-08 repair: not needed (demo retired, founder 2026-11-07)`.
  - Plan 192-08's screenshot decision is "Retire it (Recommended)". The pixel spec, its 3 PNGs and the bake plumbing are retired. With the demo gone, no seeded-render baseline is booked.
  - Scope fence: the factsheet's "Demo portfolios" section (BatchDPanels) and the demo payload producers (`[193-DEMO-PAYLOAD-PRODUCERS]`) belong to Phase 193 and are not touched here. Every `demo` hit is classified before it is deleted. Test fixtures or local-dev seeders named "demo" stay unless they exist only for the public demo.
- **D-07 amendment (2026-11-07, D-11):** D-07 stands. The home sign-up band also links nowhere to `/demo`.
- **D-08 amendment (2026-11-07, D-11):** The root cause was measured as `strategies-missing`. It is not repaired, because the page is retired. "Fix that cause" is superseded. The loud-failure code from plan 192-05 is removed along with the page.
- **D-09 amendment (2026-11-07, D-11):** The founder chose `remove` on 2026-11-06, and plan 192-07 shipped it. With D-11 the whole demo follows the founder view out.
- **D-10 amendment (2026-11-07, D-11):** D-10 no longer has a `/demo` surface. Plan 192-10's ship gate no longer reads `D-10 unresolvable labels` or any `D-08 repair:` line as a demo precondition. D-10 still holds for any other public surface this phase touches.

### Claude's Discretion
- The exact short security sentence and the CTA wording, within DESIGN.md's voice rules.
- Where the shared copy constants live, preferring an existing module over a new one.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `EXCHANGES` (`src/lib/closed-sets.ts:470`), already read via `EXCHANGES.length` on the home page (`src/app/(marketing)/page.tsx:145`, `:245`).
- Flag helpers `isSfoxEnabledServer`, `isMt5EnabledServer` imported by `/security`.

### Established Patterns
- Marketing pages live under `src/app/(marketing)/`. Public routes are listed in `PUBLIC_ROUTES` in `src/proxy.ts`.
- Status and caveat copy is centralised in `src/lib/status-surface-copy.ts`.

### Integration Points
- Home: `src/app/(marketing)/page.tsx` mounts `VerificationSection` (form text at `src/components/landing/VerificationForm.tsx:219`).
- `/security`: `src/app/(marketing)/security/page.tsx` (TLS `:108`, encryption `:140`).
- `/for-quants`: `src/app/(marketing)/for-quants/page.tsx` ("Free to list" `:97`, Fernet `:293`, "qualified allocators only" `:300`).
- Terms §7: `src/app/(marketing)/legal/terms/page.tsx:73`.
- Demo: `src/app/(marketing)/demo/page.tsx` (loading notice `:359`, "—" fallbacks `:291`, `:296`) and `demo/founder-view/`.

</code_context>

<specifics>
## Specific Ideas

- The home page uses "exchanges supported" twice; both read the shared value.
- Grep the marketing tree for every other key-storage, TLS, cost and count sentence before declaring one story; the evidence list in the ROADMAP is a spot-check, not a census.

</specifics>

<deferred>
## Deferred Ideas

- Legal entity and jurisdiction text in Terms and Privacy (founder supplies; out of scope).
- Changing who may view a factsheet (not chosen; would need its own phase).

</deferred>
