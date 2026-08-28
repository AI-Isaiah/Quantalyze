# Phase 164: SHARE — Copy Link always works, and never discloses — Pattern Map

**Mapped:** 2026-08-26
**Files analyzed:** 6 new/modified surfaces
**Analogs found:** 6 / 6 (one with a deliberate, founder-mandated deviation)

All line numbers verified at HEAD (`main`, bf00ad0c). Where CONTEXT.md cites a stale line number, the drift is noted explicitly.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/factsheet-share/[token]/page.tsx` | route (public server component) | request-response | `src/app/scenario-share/[token]/page.tsx` | exact |
| `src/lib/factsheet-share-token.ts` (name at planner's discretion) | utility (crypto) | transform | `src/lib/demo-pdf-token.ts` (HMAC) — NOT `scenario-share-token.ts` | role+mechanism match |
| `src/app/api/.../share/route.ts` (mint-or-reuse) | route handler | request-response | `src/app/api/allocator/scenario/share/route.ts` | exact-with-deviation |
| `src/app/api/.../share/revoke/route.ts` | route handler | request-response | `src/app/api/allocator/scenario/share/revoke/route.ts` | exact-with-deviation |
| `supabase/migrations/<ts>_strategy_shares_*.sql` | migration | CRUD + RPC | `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql` | exact-with-deviation |
| Owner-side share UI on the factsheet | component (client) | request-response | `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` | pattern match |
| Adversarial cache-isolation test | test (structural) | — | `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | exact |

The "link no longer active" 410 page has **no analog** — see the No Analog section.

---

## Pattern Assignments

### 1. `src/app/factsheet-share/[token]/page.tsx` — recipient route

**Analog:** `src/app/scenario-share/[token]/page.tsx` (418 lines, read in full). Copy nearly everything structural.

**What it actually does at HEAD:**
- Opens with a `// SECURITY BOUNDARY:` prose block (lines 1–17) enumerating every DB read on the page and why each is bounded. Write the equivalent block first — it is house style for BYPASSRLS files.
- Pins (lines 54–60):
  ```typescript
  export const dynamic = "force-dynamic";
  export const runtime = "nodejs";
  ```
  with the comment explaining that shared caches are URL-keyed, not revocation-keyed (line 54–58). Copy the comment's argument, re-worded for generation-bump revocation.
- **Limit FIRST, before any DB/crypto work** (lines 114–130): `getClientIp(await headers())` → `checkLimit(publicIpLimiter, "scenario-share:${ip}")`; on failure renders a neutral `EmptyStateCard` ("Please try again shortly"), NOT a 404, so the rate-limit response leaks no token-existence signal. Use key prefix `factsheet-share:${ip}`.
- Token → RPC via the **service-role transport** (lines 134–137): `createAdminClient().rpc("get_shared_scenario", { p_token_hash: hashShareToken(token) } as never)`.
- Miss handling (lines 141–153): RPC error logs a redacted `console.error` and calls `notFound()`; 0 rows also `notFound()`. **⚠️ Misleading if copied verbatim:** CONTEXT.md mandates a **410, content-free "no longer active" page on the token lane** for revoked/unknown tokens, not the scenario-share uniform 404. See No Analog.
- Downstream reads bounded BY CONSTRUCTION to the RPC's own id output (lines 155–263, the Phase-84/147 sibling-read pattern with `withPublishedOnly` and `.in(...)` bounds, each with an `error-absent ≠ legit-absent` logged-degrade arm). The factsheet lane instead calls `fetchAndBuildPayload` directly (see item 6), so this section is mostly not needed — but copy the logged-degrade error discipline.
- Sibling test files to mirror: `page.test.tsx`, `page-server-boundary.test.ts`, plus a resolve-layer module (`share-resolve.ts` + `share-resolve.test.ts`) if the page grows logic. Tests are **colocated in the route directory**, named `<file>.test.ts(x)`.

**Would mislead if copied verbatim:**
- The 404-on-every-miss (line 139–153). The token lane's contract is 410 for revoked/unknown (CONTEXT `<code_context>` "⛔ Unknown token and unknown id…").
- The benchmark self-fetch / scenario resolve machinery (lines 62–105, 265–300) — factsheet payload comes from `fetchAndBuildPayload`, not from a resolve layer.
- `hashShareToken` import (line 29) — the new lane uses HMAC derivation, not sha256-of-random.

### 2. Token module — HMAC + generation (SEPARATE module)

**Analog for MECHANISM:** `src/lib/demo-pdf-token.ts` (keyed HMAC + env secret). **Analog for FILE SHAPE/NAMING:** `src/lib/scenario-share-token.ts`. The founder decision explicitly forbids reusing/extending the latter.

**What `scenario-share-token.ts` actually does at HEAD (46 lines):** `mintShareToken()` = `randomBytes(32).toString("base64url")` + `hashShareToken(raw)` = sha256 hex. Its own header comment (lines 10–12) says the random+stored-hash model was chosen precisely **because** a stateless HMAC can't be revoked — the new design answers that with the stored `generation` counter, which is why it's a different module, not an amendment.

**What `demo-pdf-token.ts` provides to copy (lines 1–60):**
```typescript
import { createHmac, timingSafeEqual } from "crypto";
const SECRET_ENV = "DEMO_PDF_SECRET";
function getSecret(): string {
  const s = process.env[SECRET_ENV];
  if (!s || s.length < 16) {
    throw new Error(`${SECRET_ENV} environment variable must be set to a string >= 16 chars`);
  }
  return s;
}
function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}
```
Copy: the `SECRET_ENV` constant + `getSecret()` length-checked throw with a **named remedy** in the message, `createHmac("sha256", …)`, and `timingSafeEqual` for verification (demo-pdf uses it — copy that, do not `===`-compare digests). ⚠️ CONTEXT demands the secret be validated **at module load / boot**, not lazily at first use — `demo-pdf-token.ts` validates lazily inside `getSecret()`, which is exactly the "founder clicks Copy Link in prod and it 500s" mode this phase removes. Deviate: evaluate the check eagerly (and register `SHARE_TOKEN_SECRET` in whatever env manifest `src/__tests__/contracts/env-manifest.test.ts` pins — read that spec before adding the var).

**Test conventions — what an equivalent pin looks like for HMAC + generation.** `scenario-share-token.test.ts` (64 lines) pins:
- format invariants (length, base64url/hex regexes, lines 13–24, 41–45),
- determinism (47–50),
- and a **literal digest vector** (52–63): `hashShareToken("scenario-share")` → the exact 64-char sha256 hex, "pins the exact algorithm the RPC expects".

The HMAC+generation equivalent pin: with `process.env.SHARE_TOKEN_SECRET` stubbed to a fixed test-only literal (e.g. `"test-secret-0123456789abcdef"`), assert `deriveShareToken("<fixed-uuid>", 1)` equals a **literal precomputed HMAC-SHA256 hex digest**, plus: same `(id, generation)` → same token; `generation 1` vs `generation 2` → different tokens (the revocation mechanism itself); different secret → different token; and the module-load throw when the secret is missing/short (neuter-observe-restore per the anti-vacuity rule). The literal vector is what makes a silent algorithm/encoding change RED, exactly as line 52's comment argues. Also copy the RFC-4648 base64url regex comment style if the token is base64url-encoded.

### 3. Mint-or-reuse route

**Analog:** `src/app/api/allocator/scenario/share/route.ts` (278 lines, read in full).

**Copy verbatim (the "conventions copied verbatim" block at lines 35–43 is itself the house checklist):**
- Auth wrapper first: `withAllocatorAuth` shape (line 82) — the factsheet route will use the equivalent owner-auth wrapper for strategies; verify which wrapper factsheet-owner APIs use before assuming `withAllocatorAuth`.
- **B15 ordering** (lines 84–132): raw body read → tolerant JSON parse → zod `safeParse` (400 burns no limiter token) → `checkLimit(userActionLimiter, "…:${user.id}")` AFTER validation → 503 via `isRateLimitMisconfigured` (not a lying 429), 429 with `Retry-After`.
- `isUuid` refine, NOT zod `.uuid()` (lines 70–80 — zod 4's `.uuid()` rejects legitimate Postgres-shaped ids).
- **Ownership probe via the RLS-scoped client BEFORE minting**, 0 rows → **404 not 403** (lines 136–179 — no existence oracle).
- Redacted error envelope: `console.error` + `captureToSentry(error, { tags: { area: … } })` server-side; stable `{ error, message }` to the client; **never echo `error.message`** (lines 246–255).
- `NO_STORE_HEADERS` (from `@/lib/api/headers`) on **every** response, success and error.
- `logAuditEvent` fire-and-forget, metadata carries **no token content** (lines 257–269).
- URL built from `NEXT_PUBLIC_APP_URL` read per-request (`resolveAppUrl()`, lines 61–68), never a hardcoded host.
- The cast-through-unknown `.rpc()` pattern for an RPC not yet in `database.types.ts` (lines 236–244), with the "delete when types regen lands" note.

**Would mislead if copied verbatim — the core defect this phase exists to avoid:** the analog's `create_scenario_share` RPC **unconditionally revokes any prior active share and inserts a new random-token row on every mint** (lines 214–244; "WR-02"). CONTEXT success criterion 2 names this exactly: a verbatim port "regenerat[es] the original bug in slow motion." The new mint is **mint-or-reuse**: derive `HMAC(secret, strategy_id || generation)` from the stored `(strategy_id, generation, revoked_at)` row; if an active row exists, re-derive and return the SAME URL; only create a row (or bump nothing) when none exists. No `mintShareToken()`, no `token_hash` column, no revoke-on-mint. The `randomBytes` mint and the atomic revoke+insert RPC are the two things to consciously NOT copy.

### 4. Revoke route

**Analog:** `src/app/api/allocator/scenario/share/revoke/route.ts` (142 lines, read in full). Copy the whole skeleton:
- Same B15 ordering, `isUuid`, limiter-misconfig 503, `NO_STORE_HEADERS`, redacted envelope, audit event as above.
- Owner-scoped single-row UPDATE **under RLS, no SECDEF** (lines 99–109):
  ```typescript
  .update({ revoked_at: new Date().toISOString() })
  .eq("scenario_id", scenarioId)
  .is("revoked_at", null)
  .select("id");
  ```
  `.select("id")` is what makes 0-rows detectable → **404, not 403** (lines 121–128). Never a hard DELETE (audit trail, lines 13–17).
- Client-side, 404 is read as **convergence-to-revoked, not failure** — that lives in the analog's consumer, `SavedScenariosList.tsx:332–341` ("404 is CONVERGENCE-to-revoked… the end-state matches a 200"). Copy that comment's argument into the new UI handler.

**Would mislead if copied verbatim:** the analog revokes by stamping `revoked_at` on a token-hash row. Under HMAC+generation, revoke is `generation := generation + 1` (one atomic UPDATE invalidating every derived link at once) — CONTEXT A-decision. Keep the `revoked_at` stamp too if the table carries it, but the *invalidation mechanism* is the generation bump; the WHERE-clause shape (`.eq(strategy_id).is(revoked-state predicate)` + `.select` + 0-rows→404) transfers directly. Double-revoke converges naturally (a second bump is harmless) — decide whether the 0-rows→404 arm even arises, and keep the client-side 404-as-convergence posture either way.

### 5. Migration — `strategy_shares` table + anonymous-read RPC

**Analog:** `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql`. Verified structure at HEAD (grep of the file):
- `CREATE TABLE scenario_shares` (line 63); `ENABLE ROW LEVEL SECURITY` (72); owner policy `scenario_shares_owner FOR ALL USING (created_by = auth.uid()) WITH CHECK (owner-coherence EXISTS)` (91).
- **REVOKE ALL FROM PUBLIC, anon on the table** — "anon's ONLY path is the SECURITY DEFINER RPC" (lines 40, 106).
- Hot-path partial index for the read RPC (line 122); `SECURITY DEFINER` read function that **self-scopes** in its own WHERE (150, 171 — RLS does not protect a SECDEF body, and the file says so in prose); `COMMENT ON FUNCTION` explaining the self-scoping (213).
- Grant discipline (287–297): `REVOKE ALL … FROM PUBLIC, anon` on functions; `GRANT EXECUTE ON FUNCTION create_scenario_share … TO authenticated;` and `GRANT EXECUTE ON FUNCTION get_shared_scenario(TEXT) TO service_role;`.

**⚠️ Grant nuance:** `get_shared_scenario` is granted to `service_role` ONLY, because the recipient page calls it through `createAdminClient()`. If the new design keeps the service-role-transport pattern (recommended — copy it), the anon grant is unnecessary. The separate **anon EXECUTE requirement** (memory + migration `20260719140000_get_published_trust_signals.sql:98`: `GRANT EXECUTE … TO anon, authenticated, service_role`) applies ONLY if a SECDEF function is referenced by a `{public}` RLS policy or called on the anon transport — revoking anon there yields a silent 42501 → SSR `[]`. State which model each new RPC uses and grant accordingly; don't blend the two.
- Filename convention: `<UTC timestamp>_snake_case_description.sql`; latest at HEAD is `20260826150000_…`, so the new one must sort after it. A `down/` directory exists — check whether recent migrations ship a down file before deciding.
- **Would mislead:** the analog stores `token_hash` and has a partial `UNIQUE (scenario_id) WHERE revoked_at IS NULL` supporting revoke-on-mint atomicity (header, lines 29–33). The new table stores `(strategy_id, generation, revoked_at)` and **never a token, raw or hashed** — the token-hash column, its index, and the revoke+insert atomic RPC do not carry over. A plain `UNIQUE (strategy_id)` (one row per strategy, generation mutated in place) is the natural shape; that's planner discretion.
- Process pins from CONTEXT: three reviewers (`migration-reviewer`, `rls-policy-auditor`, `silent-failure-hunter`) before apply; SKIP-01 — no self-check gate whose "safe" arm is TEST's permanently-unapplied state. **⛔ VERIFIED BLOCKER — the phase-29 gate WILL trip.** `src/__tests__/phase-29-frozen-spine-guards.test.ts:141` defines `FORBIDDEN_MIGRATION_RE = /scenario|share/i` and fails on ANY changed/untracked file under `supabase/migrations/` whose FILENAME matches, diffed against `git merge-base origin/main HEAD` (lines 100–165). A migration named `..._strategy_shares_...sql` contains "share" and reddens the gate on the feature branch. Options for the planner: name the migration to avoid the substring (the gate checks the filename only, not the SQL — e.g. `..._factsheet_link_tokens.sql` while the TABLE can still be `strategy_shares`), or amend the phase-29 guard's regex/prose to scope it to the scenario spine (it exists to freeze scenario_shares/get_shared_scenario, not all sharing forever). Pick one explicitly; do not discover this in CI.

### 6. Token lane payload — copy the owner lane, byte for byte of discipline

**Analog:** `src/app/factsheet/[id]/v2/page.tsx` (699 lines at HEAD — CONTEXT's cited line numbers are from a 664-line version; corrected here):
- `unstable_cache` wrapper: `buildFactsheetPayloadCached` at **line 314**; `cacheKey.split("::")` discards everything after the id at **line 317** (SL-1a); `unstable_cache(async () => fetchAndBuildPayload(id, withPublishedOnly), …, ["factsheet-v2-payload-v6", id])` at **lines 330–356** (SL-1b — wrapper is predicate-free, no visibility argument).
- Owner lane bypass at **lines 563–573**: the header comment ("It cannot route through `buildFactsheetPayloadCached` — the effective unstable_cache key is id-ONLY… The same applies to a `null`") then:
  ```typescript
  lane === "owner"
    ? await fetchAndBuildPayload(id, (q) => withPublishedOrOwner(q, ownerUid!))
    : await buildFactsheetPayloadCached(`${id}::${computedAt}`);
  ```
  The token lane in the NEW route is the first arm's twin: `await fetchAndBuildPayload(id, withPublishedOnly-or-token-appropriate-predicate)` — zero cache reads, zero cache writes. Being in a separate file, it physically cannot reach the wrapper (the A-D1 structural argument), and repo-wide pin #4 of the phase-148 guard currently asserts **no production source other than page.tsx mentions `fetchAndBuildPayload`** — the new route WILL trip that pin. **The guard (`src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`, pins enumerated at its lines 36–66) must be consciously amended in the same phase, not worked around.** This is the single most important "analog misleads" item: `fetchAndBuildPayload` is not exported today (it lives inside page.tsx); the plan must decide whether to export it (amending pin #4's allowlist-by-walk) or extract it to a shared module — either way the 148 guard file is a co-edit.
- `OwnerUnpublishedNotice` is imported at `page.tsx:21` and rendered at **line 605** (`{lane === "owner" && <OwnerUnpublishedNotice />}`); it is defined in `src/app/factsheet/[id]/v2/FactsheetView.tsx`. Its "anyone else sees a 404" sentence becomes false when tokens ship (SHARE-04) — same-phase copy fix.
- **CONTEXT drift note:** "`FactsheetView.tsx:1312` strips the token" does not match HEAD. What exists is `useShareMode()` at **FactsheetView.tsx:1470–1481**, keyed on the `?share=1` query param (set by `ShareLinkButton`, line 1483+), gating chrome at line 1742 (`{!scenarioMode && !shareMode && …}`). Under A-D1 there is no query param — the new route implies share mode structurally, so the recipient render should pass an explicit prop (e.g. `shareMode` / `recipient`) rather than reuse the `?share=1` sniffing. Re-read `ShareLinkButton` when wiring Copy Link.

### 7. Owner-side share UI

**Analog:** `src/app/(dashboard)/allocations/components/SavedScenariosList.tsx` (test: colocated `SavedScenariosList.test.tsx`).
- `has_active_share?: boolean` row field with docstring (lines 45–52): derived from the list payload, "Absent → treated as no active share", local state transitions immediately, parent `onMutated` refetch reconciles.
- Local-override state machine (lines 195–204): `shareUrlById` (session-local raw URLs — with the WR-03 comment that re-minting "would rotate the token and silently kill the recipient's existing link"; under HMAC+generation re-derivation this caveat weakens, since Copy Link re-mints the SAME token — note it, don't copy the fear verbatim) and
  ```typescript
  const hasActiveShare = useCallback(
    (row) => shareActiveById[row.id] ?? row.has_active_share ?? false,
    [shareActiveById]);
  ```
- Clipboard discipline (lines ~207–210 comment): mirrors `ShareableLink.tsx` — `navigator.clipboard`, `execCommand` fallback, report success only on a real copy.
- **Inline confirm, never `window.confirm`** (lines 598–619): a ternary render arm `isConfirmingRevoke ? (<span "Revoke this share link? Anyone with the link will lose access." /> + <Button variant="danger" autoFocus>Revoke</Button> + <Button variant="ghost">Keep link</Button>)` with `setConfirmingRevokeId(null)` on cancel. Copy this shape exactly (CONTEXT names it as the mandated precedent).
- Revoke handler 404-as-convergence (lines 325–345), quoted in item 4.
- **Placement deviation:** the control goes on the factsheet (A-D2), NOT in `StrategyActions` (whose `return null` for `status='private'` is untouchable this phase) and not in a list row — copy the state machine and confirm shape, not the list context.

### 8. Adversarial cache-isolation test

**Analog:** `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — a **structural source-scan spec**, not a behavior mock. Its header (lines 7–34) states the load-bearing asymmetry: the behavior spec (`page.owner-lane.test.tsx`) cannot see inside the cached callback, so a structural pin is the sole control. Pins: exactly one `unstable_cache(` call site; the callback names `withPublishedOnly` as a literal; the wrapper declaration carries no visibility token (asserted as a NEGATIVE so reflow can't redden it); a repo-wide `readdirSync` walk for forbidden mentions; `generateMetadata` never contains `withPublishedOrOwner`; `force-dynamic` survives. Copy this file's approach for the phase-164 ordered adversarial test (owner-with-token request FIRST, then anonymous same-id must still `notFound()` — the T-148-04 template lives in `page.owner-lane.test.tsx` for the behavior half). Anti-vacuity: demonstrate RED with the bypass neutered, then restore. For the walk + vacuity-fence idiom (a floor asserting the scanner actually found the population), see `src/__tests__/contracts/spec-disabling.invariant.test.ts:59–83, 222–232`. Contract specs live in `src/__tests__/contracts/` (registered in `REGISTRY.md` — read it before adding one) or as `src/__tests__/phase-NNN-*.test.ts` for phase-scoped structural guards; the 148 file uses the latter. ⛔ Remember: contract specs scan all of `src/`, so partial test runs cannot clear them.

### 9. Proxy wiring (+2 lines, modified file)

`src/proxy.ts:17` — `PUBLIC_ROUTES` array; append `"/factsheet-share"` alongside `"/scenario-share"`. `src/proxy.ts:116–117` — the prefix-arm idiom:
```typescript
const isScenarioShareRoute =
  path === "/scenario-share" || path.startsWith("/scenario-share/");
```
Copy both the const and wherever it's consumed downstream (not read here — check its use site when editing).

---

## Shared Patterns

### Rate limiting — `src/lib/ratelimit.ts`
- Limiters are named `<domain><Purpose>Limiter`, created by `makeLimiter(requests, "N s")` (lines 83–95; returns `null` when redis is unconfigured — hence `isRateLimitMisconfigured`). Anonymous recipient page: `publicIpLimiter` (line 117, 10/60s) + `getClientIp` (line 652), key `"<route>:${ip}"`. Authed mint/revoke: `userActionLimiter` (line 97, 5/60s), key `"<action>:${user.id}"`. Each limiter carries a rationale comment justifying its rate and why it isn't piggybacked on `userActionLimiter` — write one if adding a new limiter; reusing `userActionLimiter`/`publicIpLimiter` needs none.
- Ordering: pages limit FIRST (before crypto/DB); API routes limit AFTER body validation (B15) so a 400 burns no token.

### Error envelope
`NextResponse.json({ error: "<short>", message?: "<stable UI sentence>" }, { status, headers: NO_STORE_HEADERS })`; `NO_STORE_HEADERS` from `@/lib/api/headers` on every response; server-side `console.error("<area> error", { user: user.id, message: error.message })` + `captureToSentry(error, { tags: { area: "…" } })`; never echo DB `error.message` to the client. 429/503 add `Retry-After`.

### force-dynamic declaration
`export const dynamic = "force-dynamic"; export const runtime = "nodejs";` at module top with an adjacent WHY comment tying it to revocation (scenario-share page lines 54–60; the 148 guard pins the factsheet one as a literal — pin the new route's too).

### Test conventions
Colocated `<name>.test.ts(x)` next to the source (routes, components, lib modules alike); structural/cross-cutting guards in `src/__tests__/` (phase-scoped) or `src/__tests__/contracts/` (permanent, registered in `REGISTRY.md`). Token-module tests pin literal digest vectors. Money/crypto oracles must be able to fail (neuter → RED → restore).

### Sentry token scrubbing
CONTEXT requires `beforeSend`/`beforeBreadcrumb` URL scrubbing verified by a real triggered error. **Verified: no `beforeSend`/`beforeBreadcrumb` exists anywhere in `src/` today.** `Sentry.init` lives at `src/instrumentation.ts:30` (server; test colocated at `src/instrumentation.test.ts`). The scrub is net-new work with no in-repo analog; the planner must also locate/confirm the client-side Sentry init (not found under `src/` in this pass) before claiming coverage of browser breadcrumbs.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| Revoked/unknown-token "link no longer active" page (410, no-store, content-free) | route/page | **Nothing in the repo returns a 410.** Grep for `status: 410` matched only unrelated files (`create-with-key`, `ownership` routes — "410" there is not an HTTP 410 share pattern). Scenario-share's miss path is `notFound()` (404). Additionally, an App Router **page component cannot set an HTTP status of 410** — `notFound()` yields 404 and there is no `gone()`. The planner must resolve this: either render the content-free page from the `[token]` route itself with the 410 status via a route-handler/middleware mechanism, or accept the page rendering with a different transport status and pin the CONTENT contract (no name, no metrics, no id, no owner identity, `no-store`) instead. Flag to founder only if the literal 410 status turns out to be unachievable in-page. |

## Metadata

**Analog search scope:** `src/app/scenario-share/`, `src/app/api/allocator/scenario/share/`, `src/app/factsheet/[id]/v2/`, `src/lib/` (token modules, ratelimit), `src/app/(dashboard)/allocations/components/`, `supabase/migrations/`, `src/__tests__/` (+ contracts), `src/proxy.ts`.
**Known line-number drift vs CONTEXT.md:** `v2/page.tsx` is 699 lines (cites assumed 664): wrapper 314/317/330–356, lane branch 563–573, notice 605. `FactsheetView.tsx:1312` cite is stale — share-mode logic is at 1470–1481 (`useShareMode`, `?share=1`).
**Verified late in this pass:** phase-29 migration gate WILL match a `*share*`-named migration filename (see item 5 — blocker with two options); no Sentry `beforeSend` exists in `src/` (net-new work). **Still not verified:** which auth wrapper factsheet-owner API routes use (strategies routes exist under `src/app/api/strategies/` — read one before choosing); the `supabase/migrations/down/` convention; location of the client-side Sentry init.
