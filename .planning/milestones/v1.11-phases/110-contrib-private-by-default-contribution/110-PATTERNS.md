# Phase 110: CONTRIB — private-by-default contribution - Pattern Map

**Mapped:** 2026-07-16
**Files analyzed:** 16 (6 new, 10 modified)
**Analogs found:** 16 / 16 (every seam has an in-repo precedent — this is a wiring phase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` **(NEW)** | component (overlay) | event-driven / request-response | `StrategyBrowseDrawer.tsx` + `ScenarioCommitDrawer.tsx` (createPortal) + `Modal.tsx` | exact (sibling dir, same overlay family) |
| `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` **(MOD)** | component (state machine) | event-driven | self (parameterize in place) | n/a (extract seam) |
| `src/lib/visibility.ts` **(MOD)** | utility (query predicate) | transform | `withPublishedOnly` (same file) | exact (pre-documented 3-line ext) |
| `src/app/api/strategies/browse/route.ts` **(MOD)** | route (API) | CRUD (read) | self (swap one call) | exact |
| `src/app/api/strategies/finalize-wizard/route.ts` **(MOD)** | route (API) | request-response | self + `finalize_wizard_strategy` RPC | exact |
| `src/app/api/strategies/csv-finalize/route.ts` **(MOD)** | route (API) | request-response | `finalize-wizard/route.ts` (sibling) | role-match |
| `src/components/layout/Sidebar.tsx` **(MOD)** | component (nav) | request-response | `buildNavSections` allocator block (same file) | exact |
| `supabase/migrations/NNN_strategies_status_private.sql` **(NEW)** | migration (DDL) | schema | `20260602180000_funding_fees_exchange_check.sql` | exact (CHECK DROP-then-ADD idiom) |
| `supabase/migrations/NNN_finalize_contribution_private.sql` **(NEW)** | migration (RPC) | schema | `20260521185008_wizard_finalize_inserts_verification.sql` | exact (SECDEF finalize RPC) |
| `supabase/tests/test_strategies_private_owner_isolation.sql` **(NEW)** | test (SQL/pgTAP) | — | `test_strategy_keys_rls.sql` | exact (tenant-isolation RLS test) |
| `tools/eslint-plugin-quantalyze/rules/no-owner-or-on-admin-client.mjs` **(NEW)** | utility (lint rule) | transform | `no-raw-published-predicate.mjs` | exact (clone) |
| `tools/eslint-plugin-quantalyze/tests/no-owner-or-on-admin-client.test.ts` **(NEW)** | test (lint) | — | `no-raw-published-predicate.test.ts` | exact (RuleTester harness) |
| `tools/eslint-plugin-quantalyze/index.mjs` **(MOD)** | config (plugin registry) | — | self (add 2 lines) | exact |
| `eslint.config.mjs` **(MOD)** | config | — | self (add rule line) | exact |
| `src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx` **(MOD)** | component (drawer) | event-driven | self (add CTA) | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` **(MOD)** | component (host) | event-driven | self (`setBrowseOpen` drawer mount pattern) | exact |

---

## Pattern Assignments

### `ContributionWizardOverlay.tsx` (NEW — component, overlay) ◄ the reusable unit Phase 116 mounts

**Analogs (three, layered):** `StrategyBrowseDrawer.tsx` (state-driven `isOpen`/`onClose` panel + Esc + backdrop), `ScenarioCommitDrawer.tsx` (`createPortal` to `document.body`), `Modal.tsx` (minimal `<dialog>` shell). All three live in the SAME `allocations/components/` dir or `components/ui/` — DESIGN.md-conformant, a11y-tested.

**Overlay props contract** — copy `StrategyBrowseDrawer.tsx:71-77`:
```typescript
export interface StrategyBrowseDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  // ...
  /** Optional fetcher override for tests — defaults to fetch("/api/strategies/browse"). */
}
```
`ContributionWizardOverlay` should mirror: `{ isOpen, onClose, source?: 'api'|'csv', onSuccess?: (strategyId: string) => void }`.

**Esc + `if (!isOpen) return null` gate** — copy `StrategyBrowseDrawer.tsx:210-238,322` (hooks run unconditionally ABOVE the null gate; Esc handler in a `useEffect`):
```typescript
useEffect(() => {
  if (!isOpen) { /* cleanup */ return; }
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
  // addEventListener / removeEventListener
}, [isOpen, onClose]);
// ...
if (!isOpen) return null;
```

**createPortal shell** — copy `ScenarioCommitDrawer.tsx:26-27,1133-1139`:
```typescript
import { createPortal } from "react-dom";
// ...
createPortal(
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(15,23,42,0.5)]">
    {/* WizardClient here */}
  </div>,
  document.body,
)
```

**Mounts `<WizardClient entryContext="contribution" source={source} onSuccess={...} onClose={onClose} />`.** Drive the CSV↔API remount with an internal `key={source}` (Pitfall 3 — NO `useSearchParams`; the overlay has no route searchParams). Mirror the manager page's remount keying from `wizard/page.tsx:120-121`:
```typescript
<Suspense key={source} fallback={null}>
  <WizardClient key={source} initialDraft={initialDraft} />
</Suspense>
```

---

### `WizardClient.tsx` (MOD — component, state machine) ◄ the extraction seam

**Analog:** self — parameterize in place, DO NOT fork (CONTEXT: single source of wizard truth for Phase 116).

**Current signature** (`WizardClient.tsx:56-112`) — add `entryContext` + injected callbacks:
```typescript
interface WizardClientProps {
  initialDraft: InitialDraft | null;
}
export function WizardClient({ initialDraft }: WizardClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();   // :114 — overlay must NOT rely on this; pass `source` as prop
  const source: "api" | "csv" =
    searchParams.get("source") === "csv" ? "csv" : "api";   // :119-120
```
**Adaptation:** add `entryContext: 'manager' | 'contribution'` + `onSuccess?: (id: string) => void` + `onClose?: () => void` + optional `source` prop. Default `entryContext='manager'` and callbacks to the CURRENT navigation so the manager page (`wizard/page.tsx:121`) mounts UNCHANGED.

**THE TRAP — hardcoded manager-route navigation that MUST be parameterized** (Pitfall 2). Every terminal path pushes to `/strategies` (109 manager-guarded → an allocator gets `redirect()`-bounced off, overlay context lost):
```typescript
// WizardClient.tsx:357,362 — fail-safe redirects (draft-gone / error branch ~341-370)
router.push("/strategies");
// :542-551 — handleSubmitSuccess (comment: "Wizard finalize sets status='pending_review'")
router.push(`/strategies?wizard_submitted=1`);
router.refresh();
// :594 — 404 non-csv branch
router.push("/strategies");
// :1053-1054 — CSV submit success branch
router.push(`/strategies?wizard_submitted=1`);
router.refresh();
```
**Adaptation:** in `contribution` mode replace each with `onSuccess?.(strategyId)` / `onClose?.()` (close overlay + refetch Browse). Manager mode passes the existing `() => router.push("/strategies?...")`. Also update the `:542` / `:1050` comment ("pending_review") to note the contribution-mode divergence.

---

### `src/lib/visibility.ts` (MOD — utility) ◄ the pre-documented seam

**Analog:** `withPublishedOnly` in the SAME file (`visibility.ts:74-86`), and the module docstring at `:32-40` literally prescribes the addition:
```
* - `withPublishedOrOwner` (published OR own-draft): OMITTED. … When a genuine
*   owner-inclusive discovery surface is first written, add it here then — a
*   3-line extension:  q.or(`status.eq.published,user_id.eq.${authUserId}`).
```
**Add** (mirror `withPublishedOnly`'s structural-cast + `Q` generic to dodge TS2589; client-safe, NO server imports):
```typescript
export function withPublishedOrOwner<Q>(query: Q, authUserId: string): Q {
  return (query as { or(filter: string): Q }).or(
    `status.eq.published,user_id.eq.${authUserId}`,
  );
}
```
Keep the `B10 visibility:` file marker in scope — the new lint rule (below) must exempt this file the same way `no-raw-published-predicate` does.

---

### `browse/route.ts` (MOD — route) ◄ one-line predicate swap

**Analog:** self. Swap the call at `browse/route.ts:119-131`, feeding the session `user.id` from `withAllocatorAuth` (`:91-92`, `AllocatorUser`):
```typescript
// BEFORE (:119): withPublishedOnly(supabase.from("strategies").select("id, name, codename, disclosure_tier, markets, strategy_types, is_example"))
// AFTER:
const { data, error } = await withPublishedOrOwner(
  supabase.from("strategies").select("id, name, codename, disclosure_tier, markets, strategy_types, is_example"),
  user.id,
).order("name", { ascending: true }).limit(STRATEGY_BROWSE_LIMIT + 1);
```
**Load-bearing:** the route stays on the user-scoped `createClient()` (`:108`), NEVER `createAdminClient()` (Pitfall 4). Import swap: `withPublishedOnly` → `withPublishedOrOwner` at `:4`. Update the `:109-113` comment that currently says "RLS … enforces … `status='published'`".

---

### `finalize-wizard/route.ts` (MOD — route) ◄ private-by-default branch (CONTRIB-02)

**Analog:** self. The route already routes through the SECURITY DEFINER RPC and returns `status: "pending_review"` in TWO places:
- `runLegacyFinalize` → `supabase.rpc("finalize_wizard_strategy", {...})` (`:713-729`), returns `status: "pending_review"` (`:973-978`).
- `unifiedFinalizeWizardHandler` → returns `status: "pending_review"` (`:1150-1158`).

**Adaptation:** thread an `entryContext`/mode signal (server/context-derived, NEVER a client-trusted `publish=false` — V5 Input Validation) into the finalize dispatch; the contribution branch calls the NEW private-finalize RPC (below) writing `status='private'` and returns `status: "private"`. Ownership guard pattern to preserve — the belt-and-braces `.eq("user_id", user.id)` at `:427-432`:
```typescript
const { data: strategyRow } = await supabase
  .from("strategies").select("api_key_id")
  .eq("id", fields.strategy_id).eq("user_id", user.id).maybeSingle();
```
**Scope (Open Q4):** research recommends CSV + single API-key only for 110; the composite hoist (`:534-620`) can keep rejecting/deferring composites on the contribution path. Confirm with planner.

---

### `csv-finalize/route.ts` (MOD — route) ◄ same private branch, CSV path

**Analog:** sibling `finalize-wizard/route.ts`. Calls `finalize_csv_strategy` RPC (`csv-finalize/route.ts:503`, migration 093), also terminating at `status='pending_review'` / `trust_tier='csv_uploaded'` (`:18-20`). Same `withAuth` + `createClient()` shape (`:3-5`). Apply the identical contribution branch → private RPC variant. Do NOT fork per-source (CONTEXT: same finalize, one branch).

---

### `Sidebar.tsx` (MOD — nav) ◄ allocator "Add a Strategy" entry (CONTRIB-01)

**Analog:** the allocator workspace block in `buildNavSections` (`Sidebar.tsx:78-104`) + its mobile twin `buildPrimaryMobileNav` (`:220-234`). Both gate on `showsAllocatorWorkspace = isAllocator` (`:53,209`).
```typescript
// Sidebar.tsx:78-84 — the allocator block pattern
if (showsAllocatorWorkspace) {
  workspaceItems.push({ label: "My Allocation", href: "/allocations", icon: PortfolioIcon, badge: flaggedCount });
  // ...
}
```
**THE FRICTION (Open Q2):** `NavItem` is href-based (`:9-15`): `{ label, href, icon, badge? }`. Launching an overlay needs a client action, not a Link. Research leans **option (b): a deep-linkable `/allocations?add=1` href** (zero `NavItem`-type churn; the composer reads the query param and opens the overlay) — minimal, matches the existing pattern where nav items are pure hrefs. Add the entry INSIDE the `showsAllocatorWorkspace` branch ONLY (never leaks to a manager — T-45-01). This is the ROLE-02 scoped-contribution exception. Add to BOTH `buildNavSections` AND `buildPrimaryMobileNav` (the `:174` comment: "the two navs therefore never drift").

---

### `NNN_strategies_status_private.sql` (NEW — migration, DDL) ◄ CHECK widen

**Analog:** `20260602180000_funding_fees_exchange_check.sql` — the canonical DROP-then-ADD CHECK idiom with pre-flight fail-loud + self-verifying DO block. Current constraint at `initial_schema.sql:63`:
```sql
status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'published', 'archived'))
```
**Migration body** (copy the `funding_fees` structure `:36-81` — `BEGIN` / DROP IF EXISTS / ADD / self-verify DO / `COMMIT`):
```sql
ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_status_check;
ALTER TABLE strategies ADD CONSTRAINT strategies_status_check
  CHECK (status IN ('draft','pending_review','published','archived','private'));
```
This is NOT the RLS-policy migration the requirements reject (A2) — RLS `strategies_read` (`rls_policies.sql:28-30` = `status = 'published' OR user_id = auth.uid()`) ALREADY makes `'private'` owner-visible + never-public with no policy change.

**Timestamp convention:** filename `YYYYMMDDHHMMSS_...sql`; MUST sort AFTER the current latest `20260716120000_backfill_staff_role_both.sql` (use e.g. `20260716130000_` or later). ⚠️ **MCP-apply to the test project `qmnijlgmdhviwzwfyzlc` BEFORE merge** (RED-guarded SQL isolation test — test-DB catch-up rule; merging `supabase/migrations/**` to main also auto-applies to PROD).

---

### `NNN_finalize_contribution_private.sql` (NEW — migration, RPC) ◄ SECDEF finalize variant

**Analog:** `20260521185008_wizard_finalize_inserts_verification.sql` — the `CREATE OR REPLACE FUNCTION finalize_wizard_strategy` SECDEF RPC. Copy its guard gauntlet (`:57-106`): assert `auth.uid()` present, `auth.uid() = p_user_id`, `SELECT ... FOR UPDATE`, owner-match, `source='wizard'`, `status='draft'`; then the `UPDATE strategies SET ... status = 'pending_review'` (`:108-121`). Standard footer: `SET search_path = public, pg_catalog` (`:56`), `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated` (`:167-168`).

**Adaptation:** the contribution variant writes `status = 'private'` instead of `'pending_review'`, and does NOT insert the `strategy_verifications('api_verified')` publish-provenance row the analog adds at `:135-158` (Open Q3 — keep analytics enqueue for KPIs, decide on the verification row; it is NOT a publish signal). ⚠️ **Re-base the SQL fn on the LATEST def before `CREATE OR REPLACE`** (grep all migrations for `finalize_wizard_strategy` / `finalize_csv_strategy`; memory rule). Whether this is a new RPC or a `p_terminal_status` param on the existing one is a planner call — a param keeps one function but widens a locked signature (the analog's `:24-27` notes the signature is locked).

---

### `test_strategies_private_owner_isolation.sql` (NEW — SQL test) ◄ CONTRIB-04 RLS layer

**Analog:** `test_strategy_keys_rls.sql` — the canonical tenant-isolation pattern. Copy its structure verbatim:
- Header block documenting "RLS FAILS SILENTLY … assert by CONTENT (count/owner_id)" (`:1-37`).
- Defensive pre-clean `DELETE FROM auth.users WHERE email IN (...)` (`:44-48`).
- `BEGIN; DO $$ DECLARE uid_a UUID := gen_random_uuid(); uid_b ...` fixtures, ending in `ROLLBACK` (`:50-55,30-33`).
- Plain PL/pgSQL `DO $$ ... $$` with `RAISE EXCEPTION` on fail (NO pgTAP — CLAUDE.md; `:21-24`).
- Runs under `psql -v ON_ERROR_STOP=1` via the `sql-tests` CI job; filename matches `test_*.sql` glob.

**Assertions (both directions):** as user B, SELECT user A's `status='private'` strategy → **empty set**; user A's own SELECT → returns it; anon/other → 0 rows. Set the session via `request.jwt.claims` / `set local role` like the analog.

---

### `no-owner-or-on-admin-client.mjs` (NEW — lint rule) ◄ CONTRIB-04 build-time layer

**Analog:** `tools/eslint-plugin-quantalyze/rules/no-raw-published-predicate.mjs` — clone it. Same shape: `fileHasMarker` exemption (`:21,47`), `meta.messages`, `create(context)` returning a `CallExpression` visitor.
```javascript
// no-raw-published-predicate.mjs:45-62 — the template
create(context) {
  const sourceCode = context.sourceCode ?? context.getSourceCode();
  if (fileHasMarker(sourceCode, ["B10 sanctioned-exception:", "B10 visibility:"])) return {};
  return {
    "CallExpression[callee.property.name='eq']"(node) { /* ... */ context.report({ node, messageId: "raw" }); },
  };
}
```
**Adaptation:** match `callee.property.name === 'or'` and a first-arg `Literal` whose value matches `/user_id\.eq\./` (RESEARCH Code Example `:289-294`); exempt `visibility.ts` via its `B10 visibility:` marker. Message: "route owner-inclusive queries through withPublishedOrOwner". Use the shared `./_shared.mjs` `fileHasMarker`.

---

### `no-owner-or-on-admin-client.test.ts` (NEW — lint test)

**Analog:** `no-raw-published-predicate.test.ts` — clone the `RuleTester` harness (`:1-13`): `valid` cases (`.or()` inside `visibility.ts` via marker; unrelated `.or()`), `invalid` cases (`.or('...user_id.eq...')` outside the helper; `.or()` on an admin client). Same `afterAll/describe/it` wiring.

---

### `index.mjs` + `eslint.config.mjs` (MOD — plugin registration)

**Analog:** self. Register in `tools/eslint-plugin-quantalyze/index.mjs` — mirror the two-line pattern (`:20,31`):
```javascript
import noOwnerOrOnAdminClient from "./rules/no-owner-or-on-admin-client.mjs";   // add near :20
// ...in rules: {}
"no-owner-or-on-admin-client": noOwnerOrOnAdminClient,   // add near :31
```
Enable in `eslint.config.mjs` (mirror `:46`):
```javascript
"quantalyze/no-owner-or-on-admin-client": "error",
```
Note `eslint.config.mjs:262-271` has an `off` override block (likely for test fixtures / the plugin's own tests) — add the new rule there too if the sibling rules are disabled in that scope.

---

### `StrategyBrowseDrawer.tsx` (MOD — drawer CTA, CONTRIB-05)

**Analog:** self. Add the "Can't find it? Add your own" CTA (`type="button"` — the drawer already renders several, e.g. `:471-477,523-531`). The CTA opens the `ContributionWizardOverlay`. Thread an `onAddOwn?: () => void` prop (mirror the existing `onClose`/`onSelect` prop style, `:71-77`) so the host (`ScenarioComposer`) owns the overlay-open state.

---

### `ScenarioComposer.tsx` (MOD — host wiring)

**Analog:** self — the exact drawer-mount pattern already used for `StrategyBrowseDrawer` (`:844` `const [browseOpen, setBrowseOpen] = useState(false)`, opened at `:3275` `onClick={() => setBrowseOpen(true)}`, mounted `:3282-3284` `<StrategyBrowseDrawer isOpen={browseOpen} onClose={() => setBrowseOpen(false)} />`). Add a sibling `const [contributeOpen, setContributeOpen] = useState(false)` + mount `<ContributionWizardOverlay ... onSuccess={() => { setContributeOpen(false); /* refetch browse */ }} />`. Wire both the drawer CTA (`onAddOwn`) and (if Open Q2 option b) the `?add=1` query param to `setContributeOpen(true)`.

---

## Shared Patterns

### Two-layer cross-owner isolation (RLS + session userId + lint)
**Sources:** `rls_policies.sql:28-30` (RLS `strategies_read`), `browse/route.ts:91-92,108` (session `user.id` from `withAllocatorAuth`, user-scoped `createClient()`), `no-raw-published-predicate.mjs` (lint precedent).
**Apply to:** browse route + visibility helper + the new lint rule. Deny-by-default: private rows visible only to owner. NEVER `createAdminClient()` on the owner-OR path (Pitfall 4).

### SECURITY DEFINER finalize RPC (never a raw route UPDATE)
**Source:** `20260521185008_wizard_finalize_inserts_verification.sql:57-121` (guard gauntlet + `FOR UPDATE` + status write).
**Apply to:** the private-finalize migration. Every finalize goes through a SECDEF RPC that asserts ownership + from-draft; a raw `.update({status:'private'})` on the route would bypass that invariant (Don't Hand-Roll).

### Session-derived userId, never client-supplied (V4/V5)
**Source:** `withAllocatorAuth` → `AllocatorUser.id` (`browse/route.ts:91-92`); belt-and-braces `.eq("user_id", user.id)` (`finalize-wizard/route.ts:431`).
**Apply to:** browse predicate + finalize entry-context branch. The mode flag must be server/context-derived, never a client-trusted `publish=false`.

### CHECK-constraint migration idiom (DROP IF EXISTS → ADD → self-verify)
**Source:** `20260602180000_funding_fees_exchange_check.sql:36-81`.
**Apply to:** the status-widen migration. Pre-flight fail-loud + self-verifying DO block; MCP-apply to test project before merge.

### State-driven overlay (isOpen/onClose + createPortal + Esc + null gate)
**Sources:** `StrategyBrowseDrawer.tsx:71-77,210-238,322`, `ScenarioCommitDrawer.tsx:26-27,1133-1139`, `Modal.tsx:12-49`.
**Apply to:** `ContributionWizardOverlay`. NOT an intercepting/parallel route (Pattern 2 — user wants NO URL navigation).

### grep the WHOLE repo when adding the `'private'` status (v1.10 lesson)
**Apply to:** every `status IN (...)` / `.eq("status", ...)` / `pending_review` / `published` consumer across `src/`, `e2e/`, `*.test.ts`, `analytics-service/`. Confirm public/verify surfaces EXCLUDE `'private'` (they filter `='published'` today — `admin/page.tsx:40`, `queries.ts` published gates) and owner surfaces INCLUDE it (Pitfall 6 / A5).

## No Analog Found

None. Every file has an in-repo precedent — Phase 110 is a composition/wiring phase (RESEARCH: "the repo pre-staged nearly every seam"). The only genuine net-new engineering is the CONTRIB-02 status divergence (`'private'`) and the overlay-callback parameterization; both have close structural analogs listed above.

## Metadata

**Analog search scope:** `src/app/(dashboard)/{strategies/new/wizard,allocations/components}/`, `src/app/api/strategies/`, `src/lib/`, `src/components/{layout,ui}/`, `supabase/{migrations,tests}/`, `tools/eslint-plugin-quantalyze/`, `eslint.config.mjs`
**Files scanned:** ~18 read/grepped (WizardClient, browse route, finalize-wizard route, csv-finalize route, visibility, Modal, ScenarioCommitDrawer, StrategyBrowseDrawer, ScenarioComposer, Sidebar, requireRolePage, 3 migrations, RLS policy, initial_schema, lint rule + test + registry + config)
**Pattern extraction date:** 2026-07-16
</content>
</invoke>
