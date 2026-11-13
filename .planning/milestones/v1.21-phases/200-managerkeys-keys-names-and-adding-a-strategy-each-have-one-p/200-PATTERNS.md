# Phase 200: MANAGERKEYS - Pattern Map

**Mapped:** 2026-11-10
**Files analyzed:** 22 (new + modified)
**Analogs found:** 22 / 22 (all analogs verified git-tracked; cite by symbol, not line)

Most work edits existing files, so the "analog" for many rows is the file itself plus a sibling pattern. Only five files are new.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/app/api/keys/feeds/route.ts` (new) | route | request-response (read) | `src/app/api/keys/[id]/memberships/route.ts` | exact |
| `src/app/api/keys/feeds/route.test.ts` (new) | test | request-response | `src/app/api/keys/[id]/memberships/route.test.ts` | exact |
| `src/app/api/keys/[id]/memberships/route.ts` (mod: additive `feeds`) | route | request-response | itself | exact |
| `src/__tests__/no-store-coverage.test.ts`, `src/lib/api/limiter-ordering.test.ts` (mod: allowlists + vacuity counts) | test | census | their `keys/[id]/memberships/route.ts` entries | exact |
| `src/__tests__/key-storage-census.test.ts` (new) | test | file-I/O census | `src/__tests__/public-truth-census.test.tsx` | exact |
| `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx` (mod: `TRUST_ATOMS`) | component | copy | `src/app/(marketing)/for-quants/page.tsx` (`body: KEY_STORAGE_SENTENCE, link: KEY_STORAGE_LINK`) | exact |
| `AllocatorExchangeManager.tsx` (mod: 2 copy sites, feeds line, role switch, delete warning) | component | CRUD | itself; feeds read mirrors `ApiKeyManager` `readKeyCompositeMemberships` | role-match |
| `WithdrawalWarningStrip.tsx` (mod: reword) | component | copy | n/a (one phrase) | n/a |
| `src/lib/strategy-display.ts` (mod: `publicNamePreview`) | utility | transform | `displayStrategyName` in same file | exact |
| `src/lib/strategy-display.test.ts` (mod) | test | unit | itself | exact |
| `strategies/[id]/edit/page.tsx` (mod: name block, read-only state) | page | request-response | itself; `RenameStrategyDialog` trigger from `StrategiesSection.tsx` | role-match |
| `RenameStrategyDialog.tsx` (mod: `publicNote` prop) | component | request-response | itself (`hint=` line) | exact |
| `StrategyForm.tsx` (mod: drop `name`, gate Data Source card to create) | component | CRUD | itself | exact |
| `FactsheetView.tsx`, `StrategyTable.tsx`, `StrategiesSection.tsx` (mod: remove `Rename...`) | component | removal | themselves | exact |
| `ApiKeyManager.tsx` (mod: confirm gate, shrink) | component | CRUD | itself | exact |
| `ConfirmKeyChangeDialog` (new, inside `src/components/strategy/`) | component | event-driven modal | `RenameStrategyDialog.tsx` (uses `Modal`) | role-match |
| `ApiKeyManager.test.tsx` (mod: D-05 RED test) | test | component | itself (`strategiesUpdateMock`, `lastLinkedKeyId`, `cardButton`) | exact |
| `ProfileTabs.tsx`, `profile/page.tsx`, `ExchangesTabContent.tsx` (mod) | component/page | request-response | themselves | exact |
| `strategies/page.tsx`, `StrategiesEmptyState.tsx`, `Sidebar.tsx` (mod: one label/control) | page/component | navigation | themselves | exact |

## Pattern Assignments

### `src/app/api/keys/feeds/route.ts` (route, request-response)

**Analog:** `src/app/api/keys/[id]/memberships/route.ts`. Copy the whole skeleton; differences: no id param, batched.

**Imports** (top of file):
```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/withAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { userActionLimiter, checkLimit, rateLimitDenyJson, isRateLimitMisconfigured } from "@/lib/ratelimit";
import { NO_STORE_HEADERS } from "@/lib/api/headers";
import { captureToSentry } from "@/lib/sentry-capture";
import type { User } from "@supabase/supabase-js";
```

**Limiter + ownership + error pattern** (GET body):
```typescript
export const GET = withAuth(async (req: NextRequest, user: User): Promise<NextResponse> => {
  const rl = await checkLimit(userActionLimiter, `key-feeds:${user.id}`);
  if (!rl.success) { /* console.warn status 503|429 */ return rateLimitDenyJson(rl, { headers: NO_STORE_HEADERS }); }
  const admin = createAdminClient();
  // ownership = explicit user_id equality on the service role, NOT RLS
  const { data: keyRows, error: keyErr } = await admin.from("api_keys").select("id").eq("user_id", user.id);
  if (keyErr) {
    captureToSentry(new Error("key feeds ownership read failed"), { tags: { route: ROUTE_TAG, stage: "ownership", code: errorCodeTag(keyErr) } });
    return NextResponse.json({ error: "Lookup failed" }, { status: 500, headers: NO_STORE_HEADERS });
  }
  ...
  return NextResponse.json({ feeds }, { status: 200, headers: NO_STORE_HEADERS });
});
```

**Embed unwrap + coherence tripwire** (copy `unwrapEmbed`, `errorCodeTag`, and the `ownerMismatches` / `danglingEmbeds` counters verbatim): `.select("strategy_id, strategies ( name, status, user_id )")`, a row whose `strategy.user_id !== user.id` is still LISTED with null name and status and counted via `captureToSentry` stage `coherence`. Only name/status/id leave the route. Add the single-key side as a second read `admin.from("strategies").select("id, name, status").eq("user_id", user.id).in("api_key_id", ids)`. Any read error or non-array: 500 `{ error: "Lookup failed" }`, never an empty map. Every owned key id must be present in the response (`[]` when it feeds nothing).

### `src/app/api/keys/feeds/route.test.ts` (test)

**Analog:** `src/app/api/keys/[id]/memberships/route.test.ts` (14 cases; `STATE.reads` log proving the admin client does the read, `STATE.ownershipFilters` proving the owner equality, `captured` Sentry tags). Add: one call serves N>5 keys (limiter pitfall), cross-tenant case goes RED when `.eq("user_id", user.id)` is dropped (neuter, see RED, restore from byte backup in scratchpad).

### `no-store-coverage.test.ts` and `limiter-ordering.test.ts` (census allowlists)

Add `"keys/feeds/route.ts"` beside the existing `"keys/[id]/memberships/route.ts"` entry in `no-store-coverage.test.ts` (`:126`) and in the NO_INPUT bucket of `limiter-ordering.test.ts` (`:182`; comment at `:178` documents `key-memberships:<user.id>`). Bump the vacuity counts and their lineage comment.

### `src/__tests__/key-storage-census.test.ts` (test, file-I/O)

**Analog:** `src/__tests__/public-truth-census.test.tsx`. Copy these helpers verbatim and keep node env (`// @vitest-environment node`), dropping the render mocks and imports of pages:
```typescript
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";
const REPO_ROOT = process.cwd();
function isTestPath(rel: string): boolean { return /\.test\.[^/]+$/.test(rel) || rel.split("/").includes("__tests__"); }
function walk(dir: string, out: string[]): void { /* recurse, .tsx? only, skip tests */ }
function population(roots: readonly string[]): string[] { /* dir -> walk, file -> by name */ }
function readScanned(rel: string): string { /* stripCommentsPreserveLines for ts/tsx */ }
function lineOf(text: string, flatIndex: number): number { /* whitespace-collapsed index -> line */ }
function findHits(files: readonly string[], pattern: string | RegExp): string[] { /* flat.matchAll, file:line */ }
```
Keep the file's own contracts: ORACLE INDEPENDENCE (banned terms typed as literals, nothing imported from `status-surface-copy.ts`), ANTI-VACUITY (assert population contains `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`, `AllocatorExchangeManager.tsx`), a planted-file matcher self-test using `mkdtempSync`/`writeFileSync`. Regex: `\b(KEK|DEK|AES|Fernet|Vault|per-user)\b|envelope encryption` (i for the last). Exclude `src/app/(marketing)/security`, `status-surface-copy.ts`, `/api/`. Allowlist entries need a reason string and a count pin.

### `ConnectKeyStep.tsx` / `MultiKeyConnectStep.tsx` (`TRUST_ATOMS`)

**Analog:** `src/app/(marketing)/for-quants/page.tsx` (`:317-318`):
```typescript
body: KEY_STORAGE_SENTENCE,
link: KEY_STORAGE_LINK,
```
Constants (`src/lib/status-surface-copy.ts:754-761`): `KEY_STORAGE_SENTENCE` and `KEY_STORAGE_LINK = { href: "/security#key-handling", label: "How we store keys" }`. Add an optional `link` field to each atom and render an anchor (`ConnectKeyStep` renders atoms through `ContactPointerText`; `MultiKeyConnectStep` maps `TRUST_ATOMS` in a `<dl>`). Drop the "Who can decrypt" atom.

### `src/lib/strategy-display.ts` (`publicNamePreview`)

**Analog:** `displayStrategyName` in the same file:
```typescript
export function displayStrategyName(strategy: DisplayableStrategy | null | undefined): string {
  if (!strategy) return "Unnamed strategy";
  if (strategy.codename) return strategy.codename;
  if (strategy.disclosure_tier === "institutional" && strategy.name) return strategy.name;
  return `Strategy #${strategy.id.slice(0, 8)}`;
}
```
Add a pure sibling returning `{ factsheet, discovery }`, `factsheet = name ?? codename ?? displayStrategyName(s)`, `discovery = displayStrategyName(s)`. Extend `src/lib/strategy-display.test.ts` (codename set, institutional, exploratory with null codename).

### `ConfirmKeyChangeDialog` (new) and `ApiKeyManager.tsx` confirm gate

**Analog:** `RenameStrategyDialog.tsx` (`<Modal open onClose title=...>` from `@/components/ui/Modal`). Do NOT call `buildEnvelope(` in the new file (`src/lib/dialog-envelope.invariant.test.ts`). Key naming: `apiKeyLabelById(keys).get(id)` from `src/lib/api-key-label.ts` (yields `"<Exchange> — <label or ••••tail>"`). Gate pattern, from RESEARCH Pattern 2: gate at the control, not in `handleLinkKey`; Resync of the current key keeps calling `handleSyncTrades(key.id)` directly; Confirm calls the existing `handleSyncTrades(pendingChange)`. `strategyName` becomes a new prop of `ApiKeyManagerProps` (passed from the edit page).

### `ApiKeyManager.test.tsx` (D-05 RED test)

Use the file's own `strategiesUpdateMock` / `lastLinkedKeyId` mock and `cardButton("key-k", "Use & Sync")` helper; add `confirmUseAndSync(keyId)` and use it at the behavioural sites (`CR01-OTHER-KEY-REFUSED` ~3993 and add-in-flight ~4660). Write RED first, before any production edit; byte-backup, neuter, see RED, restore with `cp`.

### `RenameStrategyDialog.tsx`

Replace the `hint="Only you see this name. Public surfaces keep showing the codename."` line with a `publicNote?: string` prop fed from `publicNamePreview`. Edit-page name block: editable only when status is in `["private","draft"]` (membership check like the name route; no raw published-status equality, `src/lib/visibility.test.ts` sweeps those).

### `StrategyForm.tsx`

Edit mode update payload today: `...(mode === "create" || name !== strategy?.name ? { name } : {})`. Remove the name picker and name from edit payload; gate Data Source card + Connect modal (`handleApiKeySubmit`) to `mode === "create"`. Re-run `src/__tests__/display-sign-single-source.test.ts` (R5 count pin for this file) and `src/lib/wizardErrors.roster-render.test.tsx`. Rewrite the `164.6.6.3.1 item 1` describe in `StrategyForm.test.tsx`.

### Profile key manager (`ProfileTabs.tsx`, `profile/page.tsx`, `ExchangesTabContent.tsx`, `AllocatorExchangeManager.tsx`)

`ProfileTabs.tsx:20`: `{ key: "exchanges", label: "Exchanges", allocatorOnly: true }`. Keep the key `exchanges`, change label to "API keys", drop `allocatorOnly` (8 inbound `?tab=exchanges` links). `profile/page.tsx` loads `getUserApiKeys(user.id)` for every role. Update `ProfileTabs.test.tsx` Test 5. Feeds line per key reads `GET /api/keys/feeds` once; failure text "Could not check which strategies this key feeds." (never "feeds nothing"; same honesty rule as `readKeyCompositeMemberships` in `ApiKeyManager`). Replace the two "per-user KEK" sites with the shared sentence.

### Add-a-strategy entry (`strategies/page.tsx`, `StrategiesEmptyState.tsx`, `Sidebar.tsx`)

One label `Add a strategy` (sentence case per DESIGN.md; matches `ContributionWizardOverlay` aria-label). Header `<Link href="/strategies/new">` goes straight to `/strategies/new/wizard`; empty-state "Create your first strategy" button removed. Keep degrade ids `strategies.empty` / `strategies.empty-allocator` (`degrade-warning-scan.test.ts`). Update tests listed in RESEARCH Q6 (`page.merged.test.tsx`, `page.wizard-draft-banner.test.tsx`, `page.key-pill.test.tsx`, `Sidebar.test.tsx`, `DashboardChrome.test.tsx`, `MobileNav.test.tsx` including the `/^(My allocation|Risk|Bridge|Add a Strategy|Profile)$/` regexp).

## Shared Patterns

### Honest failure, never silent empty (H-0395)
**Source:** `memberships/route.ts` (500 `{ error: "Lookup failed" }` on any read error) and `ApiKeyManager` `readKeyCompositeMemberships`. **Apply to:** feeds route, Profile feeds line, Delete confirm.

### Admin-client tenant gate
**Source:** `memberships/route.ts` explicit `.eq("user_id", user.id)` before any read, `NO_STORE_HEADERS` on every response. **Apply to:** feeds route; add to both route censuses.

### One key-storage sentence
**Source:** `KEY_STORAGE_SENTENCE` / `KEY_STORAGE_LINK`, pinned by `status-surface-copy.test.ts`. **Apply to:** all in-app key-storage copy.

### Comment-stripped, whitespace-collapsed source census
**Source:** `public-truth-census.test.tsx` helpers. **Apply to:** `key-storage-census.test.ts`.

### Pinned-census re-run after each plan
`display-sign-single-source`, `wizardErrors.roster-render`, `no-store-coverage`, `limiter-ordering`, `dialog-envelope.invariant`, `degrade-warning-scan`, `src/lib/visibility.test.ts`, `status-surface-copy.test.ts`.

### Standing rules
Never `.select("*")` on `api_keys` (use `API_KEY_USER_COLUMNS`); KCS-23 link controls fail closed on composite/unknown shapes; cite moving code by symbol.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `ConfirmKeyChangeDialog` | component | modal confirm | No confirm-before-write dialog for key re-point exists; use `RenameStrategyDialog`'s `Modal` usage for shape and RESEARCH Pattern 2 for behaviour |

## Metadata

**Analog search scope:** `src/app/api/keys`, `src/lib`, `src/__tests__`, `src/components/{strategy,exchanges,auth}`, `src/app/(marketing)`.
**Files scanned:** ~12 read in full or by range; remainder taken from RESEARCH.md verified inventories.
**Tracked-source check:** `memberships/route.ts`, `public-truth-census.test.tsx`, `api-key-label.ts` confirmed in `git ls-files`.
**Pattern extraction date:** 2026-11-10
