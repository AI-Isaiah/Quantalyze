# Phase 13 — Discovery v2 Polish — Security Audit

**Branch:** `feature/v0.17-sprint-13`
**ASVS Level:** 2
**Audit Date:** 2026-04-28

## Verification Method

Each threat verified by disposition: `mitigate` requires code evidence;
`accept` requires entry in this log; `transfer` (none in scope).
Implementation files were not modified. Evidence is `file:line`.

## Per-Threat Verification

### Plan 13-01 — Watchlist API (`PUT /api/watchlist/[strategyId]`)

| Threat ID  | Category                      | Disposition | Evidence                                                                                          | Status |
|------------|-------------------------------|-------------|---------------------------------------------------------------------------------------------------|--------|
| T-13-01-01 | Spoofing (CSRF)               | mitigate    | `src/app/api/watchlist/[strategyId]/route.ts:40-41` — `assertSameOrigin(req)` is the FIRST call inside PUT, before auth and rate-limit. Returns 403 NextResponse on mismatch (`src/lib/csrf.ts:45-75`). | LIVE |
| T-13-01-02 | DoS (rapid-toggle)            | mitigate    | `route.ts:56` — `checkLimit(mandateAutoSaveLimiter, \`watchlist:${user.id}\`)`. Limiter defined at `src/lib/ratelimit.ts:91` as `makeLimiter(30, "60 s")`. 429 + `Retry-After` returned at `route.ts:58-61`. Key prefix literal `watchlist:` confirmed. | LIVE |
| T-13-01-03 | Tampering / IDOR              | mitigate    | DELETE: `route.ts:99-103` — `.delete().eq("user_id", user.id).eq("strategy_id", strategyId)` (defense-in-depth on RLS). UPSERT: `route.ts:83-88` — `user_id` derived from server `supabase.auth.getUser()` (line 50), never from body. RLS: `supabase/migrations/024_user_favorites.sql:42-73` — 4 policies (SELECT/INSERT/UPDATE/DELETE) all enforce `auth.uid() = user_id`; self-verifying assertion at L78-105. | LIVE |
| T-13-01-04 | Info Disclosure (read)        | accept      | `src/lib/queries.ts:1703-1718` — `getMyWatchlist(userId)` filters `.eq("user_id", userId)`. Call site: `src/app/(dashboard)/discovery/[slug]/page.tsx:20,37` — `userId` is `user.id` from `supabase.auth.getUser()`, never from request input. Accept logged here. | LIVE |
| T-13-01-05 | Repudiation (no audit trail)  | accept      | `route.ts:79-82` (add branch) and `route.ts:98` (delete branch) — `@audit-skip: T-13-01-05` pragmas present at both mutation sites, with rationale referencing the `api/preferences/route.ts` precedent. Accept logged here. | LIVE |
| T-13-01-06 | Input validation              | mitigate    | `route.ts:65-73` — JSON parse wrapped in try/catch (400 on parse error); strict whitelist `body.action !== "add" && body.action !== "remove"` returns 400. No other shape accepted. | LIVE |

### Plan 13-02 — Customize Prefs / localStorage

| Threat ID  | Category                              | Disposition | Evidence                                                                                          | Status |
|------------|---------------------------------------|-------------|---------------------------------------------------------------------------------------------------|--------|
| T-13-02-01 | Info Disclosure (cross-account leak)  | mitigate    | `src/lib/discovery-prefs.ts:46-48` — `keyFor(uid, slug)` returns `discovery_view_preferences:${uid}:${slug}` (uid segment present). The hook at L92-104 only ever reads/writes a key constructed from the current session's uid. SYNTHESIS BLOCKER 2 fix verified at L88: signature is `useDiscoveryPrefs(uid: string \| undefined, slug: string)` with both effects guarded by `if (!uid) return` (L93-99 and L108) — no key written when uid undefined. | LIVE |
| T-13-02-02 | Tampering (DevTools edit)             | mitigate    | `discovery-prefs.ts:67-71` — `safeRead` does `{...DEFAULTS, ...parsed, sort: {...}}` partial-merge; only typed fields propagate. JSON parse failure caught at L72-74 returns DEFAULTS. | LIVE |
| T-13-02-03 | Info Disclosure (uid in logs)         | accept      | uid never appears in URL or server logs from this feature; localStorage key only. Accept logged here. | LIVE |
| T-13-02-04 | DoS (localStorage quota)              | accept      | `discovery-prefs.ts:110-114` — try/catch around `setItem` swallows quota / Safari-private errors. ~120 byte payload. Accept logged here. | LIVE |

### Plan 13-04 — Sparkline (visual)

| Threat ID  | Category                         | Disposition | Evidence                                                                                          | Status |
|------------|----------------------------------|-------------|---------------------------------------------------------------------------------------------------|--------|
| T-13-04-01 | Info Disclosure (color leak)     | accept      | Color encodes already-public sparkline final value; no PII. Accept logged here. | LIVE |
| T-13-04-02 | Tampering (visual regression)    | mitigate    | Playwright spec `e2e/discovery-sparkline-regression.spec.ts` declared as the regression gate; `sparklineColor` helper imported at `src/components/strategy/StrategyGrid.tsx:8,112`. Out of ASVS scope but regression-fenced. | LIVE |

### Plan 13-05 — Migration 091 (data-only DML)

| Threat ID  | Category                                     | Disposition | Evidence                                                                                          | Status |
|------------|----------------------------------------------|-------------|---------------------------------------------------------------------------------------------------|--------|
| T-13-05-01 | Tampering (mass-flag non-seed strategies)    | mitigate    | `supabase/migrations/091_seed_is_example_backfill.sql:23-34` — `UPDATE … WHERE id IN (<8 hard-coded UUIDs>)`. UUIDs match `scripts/seed-demo-data.ts:44-53` exactly (8 entries `cccccccc-0001-4000-8000-00000000000{1..8}`). No DDL tokens (grep for `ALTER TABLE`/`CREATE TABLE`/`DROP TABLE`/`ON CONFLICT` returns empty). Post-update RAISE NOTICE at L38-57 emits row count. | LIVE |
| T-13-05-02 | Info Disclosure (`is_example` flag)          | accept      | Column already public per migration 001:64. Accept logged here. | LIVE |
| T-13-05-03 | DoS (row locks)                              | accept      | UPDATE touches at most 8 rows by PK. Accept logged here. | LIVE |
| T-13-05-04 | Repudiation (push without audit)             | accept      | `schema_migrations` + git history + `RAISE NOTICE` provide trail. Accept logged here. | LIVE |

## Cross-Cutting Verification

| Concern                                          | Result | Evidence |
|--------------------------------------------------|--------|----------|
| No `withAuth` bypass on dynamic-segment route    | PASS   | `route.ts` does not import or invoke `withAuth`. Inline auth at L47-53 calls `supabase.auth.getUser()` and returns 401 on null user. Pitfall 5 honored. |
| No server-only secrets read from client code     | PASS   | `grep -rEn 'process\.env\.SUPABASE_SERVICE_ROLE_KEY' src/lib/discovery-prefs.ts src/components/ src/app/api/watchlist/` returns no real reads. (One pre-existing string literal in `ApiKeyManager.tsx:194` is an error message, not an env read; out of Phase 13 scope.) |
| No production URLs / API keys in new files       | PASS   | New files audited (`route.ts`, `discovery-prefs.ts`, `091_*.sql`, `queries.ts:1685-1719`) contain no hard-coded secrets, tokens, or non-test URLs. |
| Migration 091 idempotency                        | PASS   | `UPDATE … SET is_example = true` is idempotent by definition; running twice produces identical state. |

## Unregistered Flags (from SUMMARY.md `## Threat Flags`)

None reviewed in scope of this audit beyond the registered IDs above.

## Verdict

**THREATS MITIGATED** — 14/14 threats verified LIVE
(7 mitigate + 7 accept). No gaps. No unregistered flags.
