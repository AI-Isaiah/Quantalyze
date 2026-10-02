# Testing Patterns

**Analysis Date:** 2026-04-17

## Test Frameworks

The repo has three test layers, one per surface:

| Layer                                       | Runner             | Config                             | File pattern                                   |
|---------------------------------------------|--------------------|------------------------------------|------------------------------------------------|
| TypeScript unit + route-handler tests       | **Vitest 4.1.2**   | `vitest.config.ts`                 | `src/**/*.test.{ts,tsx}`                       |
| End-to-end browser tests                    | **Playwright 1.59**| `playwright.config.ts`             | `e2e/*.spec.ts`                                |
| Python analytics service tests              | **pytest**         | `analytics-service/pytest.ini`     | `analytics-service/tests/test_*.py`            |

Test counts as of 2026-04-17: **114 Vitest tests**, **1,695 pytest tests** (file count includes parametrized suites), **20 Playwright specs**.

### Vitest

Config at `vitest.config.ts`:
```typescript
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
});
```

Setup file `src/test-setup.ts` registers:
- `@testing-library/jest-dom/vitest` assertion extensions
- Auto `cleanup()` after each test (RTL does not auto-clean without `globals: true`)
- A `ResizeObserverStub` so `lightweight-charts` can render in jsdom

**Assertion library:** Vitest's built-in `expect` + `@testing-library/jest-dom` (`toBeInTheDocument`, `toHaveAttribute`, `toHaveTextContent`).

### Playwright

Config at `playwright.config.ts`:
```typescript
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000", ... },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

Local runs auto-start `npm run dev` via `webServer`. CI runs against `npm run start` after `npm run build`.

### pytest

Config at `analytics-service/pytest.ini`:
```ini
[pytest]
testpaths = tests
pythonpath = .
asyncio_mode = auto
```

Shared fixtures in `analytics-service/tests/conftest.py` (golden returns, zero-vol returns, empty returns, benchmark returns, sample trades).

## Run Commands

```bash
npm test                         # Vitest single-run (CI mode)
npm run test:watch               # Vitest watch mode
npm run test:e2e                 # Playwright
npm run typecheck                # tsc --noEmit
npm run lint                     # eslint src/

# Python analytics service
cd analytics-service
pytest                                              # All tests
pytest --cov=services --cov-report=term-missing   # With coverage
```

## Test File Organization

**Co-located** (preferred for module-scoped tests):
```
src/lib/audit.ts
src/lib/audit.test.ts
src/components/ui/Button.tsx
src/components/ui/CardShell.test.tsx
src/app/api/intro/route.ts
src/app/api/intro/route.test.ts
```

**Cross-module integration tests** live in `src/__tests__/`:
```
src/__tests__/rbac-matrix.test.ts              # Cross-module withRole + pilot route
src/__tests__/audit-coverage.test.ts           # Meta-test: greps route.ts for audit calls
src/__tests__/audit-fanout-integration.test.ts
src/__tests__/critical-regressions.test.ts     # File-system grep guards for CRITICAL findings
src/__tests__/check-banned-packages.test.ts    # Supply-chain guard
src/__tests__/vercel-cron-limits.test.ts       # Infra config guard
src/__tests__/seed-integrity.test.ts
```

**Python tests** mirror the service module: `services/metrics.py` → `tests/test_metrics.py`. Grouping via `class TestFoo:` with method `test_*` — pytest picks both up.

**Playwright specs** live in `e2e/` at the repo root (NOT inside `src/`). Snapshot baselines under `e2e/demo-screenshot.spec.ts-snapshots/`.

## Vitest Test Structure

**Imports always from `vitest`** (never Jest):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

**Describe/it hierarchy** — one top-level `describe` per route or module, nested `describe` blocks for logical groups, `it` cases as the leaves.

Canonical Route Handler test shape (from `src/app/api/intro/route.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// 1. Neuter server-only imports (audit.ts has `import "server-only"`)
vi.mock("server-only", () => ({}));

// 2. Neuter next/server's `after()` so emissions run synchronously in tests
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => { void cb(); },
  };
});

// 3. Hoisted mutable state shared between mocks and assertions
const STATE = vi.hoisted(() => ({
  authUser: { id: "...", email: "..." },
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

// 4. Mock the Supabase server client with inline handlers
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: STATE.authUser }, error: null }) },
    rpc: async (name, args) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
    from: (table) => { /* nested builder */ },
  }),
}));

// 5. Build request helpers
function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/intro", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { /* reset STATE */ });
afterEach(() => { vi.clearAllMocks(); });

describe("POST /api/intro — audit-log emission (Task 7.1a)", () => {
  it("emits intro.send via log_audit_event RPC on successful insert", async () => {
    const { POST } = await import("./route");  // dynamic import AFTER vi.mock
    const res = await POST(makeRequest({ ... }));
    expect(res.status).toBe(200);
  });
});
```

**Test names are sentences**, not identifiers. Start with a verb ("emits", "returns", "rejects", "does NOT emit"). Include the observable behavior and the context: `"returns 403 for foreign portfolio"`, `"fails with 500 and emits no audit when the insert returns null id"`.

**Dynamic `await import()` of the route under test** — hoisted mocks must register BEFORE the SUT module evaluates. See `src/app/api/intro/route.test.ts:179` and every other `route.test.ts`.

## Component Test Structure

Uses `@testing-library/react` (v16.3). Canonical shape (from `src/components/ui/CardShell.test.tsx`):

```typescript
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardShell } from "./CardShell";

describe("<CardShell>", () => {
  it("renders the title and accessible region", () => {
    render(<CardShell status="ready" title="Strategy breakdown"><p>Body</p></CardShell>);
    expect(screen.getByRole("region", { name: "Strategy breakdown" })).toBeInTheDocument();
  });

  it("exposes a screen-reader-only loading announcement in the loading state", () => {
    render(<CardShell status="loading" title="Sharpe" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/Loading Sharpe/);
    expect(status).toHaveAttribute("aria-live", "polite");
  });
});
```

**Prefer accessibility queries:** `getByRole`, `getByText`, `getByLabelText`. Use `getByTestId` only when nothing else works. Use `queryBy*` when the expectation is absence (`expect(queryByText(...)).toBeNull()`).

**Hook tests** use `renderHook` + `act`:
```typescript
import { renderHook, act } from "@testing-library/react";
import { useTimeframe } from "./useTimeframe";
const { result } = renderHook(() => useTimeframe("YTD"));
expect(result.current[0]).toBe("YTD");
```

## Mocking Patterns

### vi.hoisted for shared state

When tests need mutable state accessible from both the mock factory AND the `expect` block, use `vi.hoisted`. This runs the state initializer BEFORE `vi.mock` hoists and is the only way to share between them:
```typescript
const { getUserMock, assertSameOriginMock, userRolesQueryMock } = vi.hoisted(() => ({
  getUserMock: vi.fn<() => Promise<{ data: { user: unknown } }>>(),
  assertSameOriginMock: vi.fn<(req: unknown) => Response | null>(() => null),
  userRolesQueryMock: vi.fn<(userId: string) => Promise<{ data: { role: string }[] | null; error: unknown }>>(),
}));
```
Used in: `src/__tests__/rbac-matrix.test.ts`, `src/lib/auth.test.ts`, `src/app/api/notes/route.test.ts`, and ~27 others.

### Supabase mocks

Two styles, both acceptable, chosen by test scope:

**Inline-chain mock** (fastest for single-table routes) — embed the builder chain the route uses:
```typescript
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: STATE.authUser }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: { role: STATE.profileRole }, error: null }) }),
          }),
        };
      }
      // ...
    },
  }),
}));
```

**In-memory mock store** (when multiple tables or update-log assertions are needed) — `src/lib/supabase/mock.ts` provides a persistent store:
```typescript
import { createMockStore, seedTable, setTableErrorOnce } from "@/lib/supabase/mock";

const store = createMockStore();
seedTable(store, "profiles", [{ id: "u1", is_admin: true }]);
seedTable(store, "user_app_roles", [{ user_id: "u1", role: "admin" }]);
```

The mock supports `.from`, `.select`, `.insert`, `.update`, `.delete`, `.upsert`, `.eq`, `.is`, `.not(col, "is", val)` — anything outside that surface throws with guidance to extend `buildNotFilter`.

### Live-DB integration tests

For tests that exercise real Postgres triggers / RLS / RPCs, use `src/lib/test-helpers/live-db.ts`:
```typescript
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

describe("Migration 055 — sanitize_user RPC", () => {
  it.skipIf(!HAS_LIVE_DB)("idempotent: double-call is a no-op", async () => {
    const admin = createLiveAdminClient();
    const cleanup = { userIds: [] as string[] };
    try {
      const userId = await createTestUser(admin, `test-${Date.now()}@test.sec`);
      cleanup.userIds.push(userId);
      const { data } = await admin.rpc("sanitize_user", { p_user_id: userId });
      expect(data).toBe(true);
    } finally {
      await cleanupLiveDbRow(admin, cleanup);
    }
  }, 60_000);  // explicit timeout for live-DB calls

  it.skipIf(HAS_LIVE_DB)("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("sanitize-user");
    expect(true).toBe(true);
  });
});
```

- `HAS_LIVE_DB` reads `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
- `it.skipIf(!HAS_LIVE_DB)` gates the assertion — CI without live DB still runs the file, just skips the network tests.
- Always clean up in `finally`, always check `expect(error).toBeNull()` after each call.
- **Never hard-code UUIDs without version/variant nibbles.** Zod v4's strict `.uuid()` validator rejects arbitrary hex. Use: `"11111111-1111-4111-8111-111111111111"` (version `4`, variant `8`).

### Module mocks with passthrough

When mocking a subset of a module's exports, import the real module via `vi.importActual`:
```typescript
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after: (cb: () => void | Promise<void>) => { void cb(); } };
});
```

### Global / browser API mocks

```typescript
vi.stubGlobal("localStorage", localStorageMock);  // src/app/(dashboard)/allocations/hooks/useTimeframe.test.ts
```

### Python mocks (pytest)

Use `monkeypatch` for module-level overrides and `unittest.mock.MagicMock` / `AsyncMock` / `patch` for callable mocks. Canonical shape (from `analytics-service/tests/test_audit.py`):
```python
def test_rpc_raises_does_not_propagate(self, monkeypatch, caplog):
    rpc_method = MagicMock(side_effect=RuntimeError("network down"))
    supabase = MagicMock(rpc=rpc_method)
    monkeypatch.setattr(audit_module, "get_supabase", lambda: supabase)

    with caplog.at_level(logging.ERROR, logger="quantalyze.audit"):
        log_audit_event(user_id=DUMMY_USER, action="bridge.score_candidates", ...)

    assert any("log_audit_event_service call threw" in rec.getMessage() for rec in caplog.records)
```

- **`caplog.at_level(..., logger="quantalyze.audit")`** is the canonical way to assert on logged errors.
- **Class-based grouping** — `class TestLogAuditEventHappyPath`, `class TestLogAuditEventSwallowsErrors`, `class TestLogAuditEventNullGuards`.

## Fixtures & Factories

**TS fixtures** live in `src/__tests__/fixtures/` (currently one directory: `portfolio-analytics/`). Fixtures are tiny — most tests inline sample data inside `vi.hoisted` / `const SAMPLE_X = { ... }`.

**Hard-coded UUIDs inside each test** — declared at module scope with descriptive names so the meaning is obvious in the assertion:
```typescript
const STRAT_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ROW_ID = "22222222-2222-4222-8222-222222222222";
const REPLACEMENT_ID = "33333333-3333-4333-8333-333333333333";
```

**Python fixtures** are pytest fixtures in `analytics-service/tests/conftest.py`:
```python
@pytest.fixture
def golden_returns() -> pd.Series:
    """500 trading days of synthetic returns with known statistical properties."""
    np.random.seed(42)
    n_days = 500
    dates = pd.bdate_range("2023-01-01", periods=n_days)
    base_returns = np.random.normal(0.0005, 0.015, n_days)
    base_returns[200:230] = np.random.normal(-0.015, 0.02, 30)
    return pd.Series(base_returns, index=dates, name="returns")
```
Seeds are deterministic (`np.random.seed(42)`). Every financial calculation fixture includes a top-of-fixture comment with the analytical properties (expected mean/vol, drawdown windows).

## What to Mock

**Always mock:**
- External network calls (`fetch`, Supabase RPC/HTTP, Resend email API, PostHog)
- Browser APIs in Node/jsdom (`ResizeObserver`, `localStorage`, `matchMedia`)
- `"server-only"` imports (they throw under jsdom) — `vi.mock("server-only", () => ({}))`
- `next/server`'s `after()` — the tests run the callback synchronously via `void cb();`
- Time when the test depends on elapsed time (`vi.useFakeTimers()`)

**Never mock:**
- The module under test
- Pure utility functions (`cn`, `formatPercent`, `computeFreshness`) — call them directly
- Zod schemas — exercise the real validation
- `NextResponse` / `NextRequest` — construct real instances (`new NextRequest(url, init)`)

## Test Types

**Unit tests** — pure functions, no I/O. `src/lib/utils.test.ts`, `src/lib/csv.test.ts`, `src/lib/portfolio-stats.test.ts`. Fast, ~300 exist.

**Route-handler tests** — exercise `route.ts` handlers with mocked Supabase + mocked `next/server.after`. ~30 exist under `src/app/api/**/route.test.ts`. Assert status codes, response bodies, and side effects via mock call logs.

**Component tests** — RTL + jsdom. Assert rendered output + accessibility roles. ~20 exist. Example: `src/components/admin/DeletionRequestActions.tsx` has implicit coverage via route tests; explicit component tests mostly live for display components (`CardShell`, `Sidebar`, `Disclaimer`, `ScopedBanner`, `Button` variants).

**Hook tests** — `renderHook` + `act`. Example: `src/hooks/useMediaQuery.ts` is exercised indirectly; `useTimeframe` and `useDashboardConfig` have dedicated tests.

**Integration tests** — cross-module, often in `src/__tests__/`. Example: `rbac-matrix.test.ts` exercises `withRole` through the real pilot route. `audit-fanout-integration.test.ts` drives every instrumented route and asserts the audit RPC is called with the right shape.

**Live-DB integration tests** — `HAS_LIVE_DB`-gated. Exercise real Postgres triggers, RLS, RPCs. Examples: `src/__tests__/sanitize-user.test.ts`, `src/__tests__/audit-log-rls.test.ts`, `src/__tests__/log-audit-event-service-rpc.test.ts`.

**Meta / regression-guard tests** — file-system greps that enforce invariants:
- `src/__tests__/audit-coverage.test.ts` — every Supabase mutation under `src/app/api/**/route.ts` must be followed within 60 lines by `logAuditEvent(` / `logAuditEventAsUser(` OR preceded by an `@audit-skip:` pragma. Fails when a new route ships without audit instrumentation.
- `src/__tests__/check-banned-packages.test.ts` — asserts `package.json` does not contain compromised packages (`axios`, etc.).
- `src/__tests__/critical-regressions.test.ts` — file-system reads that guard against regressions in CRITICAL findings (e.g. IDOR fix holds, CSP headers present, analytics-client has a fetch timeout, `VERSION` equals `package.json` version).
- `src/__tests__/vercel-cron-limits.test.ts` — asserts `vercel.json` keeps crons within Hobby-plan limits.
- `src/proxy.test.ts` — exercises the middleware matcher regex against a whitelist/blacklist of paths.

**Playwright E2E** — browser-level flows. Focused suites: auth (`e2e/auth.spec.ts`), smoke (`e2e/smoke.spec.ts`), demo pages (`e2e/demo-public.spec.ts`, `e2e/demo-founder-view.spec.ts`, `e2e/demo-screenshot.spec.ts`), discovery, full-flow, match-queue, strategy-detail-tabs. CI runs only the auth + smoke + demo specs against a placeholder-env Next.js build (the seeded-Supabase specs are gated until a CI Supabase is wired up).

**pytest (analytics-service)** — unit tests for pure math (`test_metrics.py`, `test_portfolio_risk.py`, `test_portfolio_optimizer.py`, `test_portfolio_metrics.py`), integration tests for DB and encryption (`test_db.py`, `test_encryption.py`), harness tests for exchanges (`test_exchange.py`, `test_exchange_harness.py`), job-worker logic (`test_job_worker.py`), reconciliation (`test_reconciliation.py`, `test_position_reconstruction*.py`), and audit emission (`test_audit.py`, `test_routers_audit_emission*.py`).

## Common Patterns

### Async testing

Vitest is async-native. Mark tests `async` and `await` the work:
```typescript
it("returns 403 for foreign portfolio", async () => {
  mockFrom.mockImplementation((table) => ({ /* ... */ }));
  const { PATCH } = await import("./route");
  const res = await PATCH(makePatchReq({ content: "test", portfolio_id: PORTFOLIO_ID }));
  expect(res.status).toBe(403);
});
```

**Draining `after()` / microtask queues** — when a route schedules audit emission via `after()`, tests flush the queue before asserting:
```typescript
async function drainAuditMicrotasks() {
  // logAuditEvent schedules via queueMicrotask; three ticks is enough.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
```

### Error testing

For Route Handlers, exercise error branches by manipulating mock state BEFORE `import`:
```typescript
it("returns 500 when the insert returns null id", async () => {
  STATE.insertedRow = null;
  const { POST } = await import("./route");
  const res = await POST(makeRequest({ strategy_id: STRAT_ID }));
  expect(res.status).toBe(500);
});
```

For pure functions, call directly and assert on the thrown error or returned discriminated-union branch:
```typescript
it("returns { forbidden } when the user lacks the required role", async () => {
  userRolesQueryMock.mockResolvedValue({ data: [], error: null });
  const result = await requireRole(makeFromOnly(), { id: "u1" } as User, "admin");
  expect("forbidden" in result).toBe(true);
});
```

### Parametrized tests

Vitest's `describe.each` / `it.each` for matrix coverage (proxy matcher, HTTP-verb parametrization):
```typescript
// From src/app/api/cron/warm-analytics/route.test.ts
describe.each([["GET", GET], ["POST", POST]] as const)(
  "%s /api/cron/warm-analytics",
  (_verb, handler) => {
    it("returns 401 when CRON_SECRET is unset", async () => { ... });
  },
);

// From src/proxy.test.ts
it.each(["/security.txt", "/robots.txt", "/.well-known/security.txt"])(
  "bypasses %s",
  (path) => { expect(isGuarded(path)).toBe(false); },
);
```

### Explicit timeouts

Live-DB tests and long integration tests set an explicit timeout as the third arg to `it`:
```typescript
it.skipIf(!HAS_LIVE_DB)("cascade test", async () => { ... }, 60_000);
```

### Regression-test requirement (project skill)

When a bug is found, add a test that fails at HEAD and passes after the fix (per `~/.claude/projects/.../feedback_tests_when_finding_errors.md` and the pattern across the codebase). The test should be named after the finding (`"regression guard for codex-adversarial finding #1"`, `"[CRITICAL-01] portfolio-pdf IDOR"`). See `src/lib/csv.test.ts:12-22` and `src/__tests__/critical-regressions.test.ts:24-43` for the canonical shape.

## CI Gates

**`.github/workflows/ci.yml`** runs on every push to `main` and every PR:

| Job                 | Commands                                                                                  | Failure mode |
|---------------------|-------------------------------------------------------------------------------------------|--------------|
| `frontend`          | `npm ci` → `typecheck` → `lint` → `test` → check banned packages → check GDPR coverage → `npm audit --audit-level=critical` → `npm run build` | Any step red blocks merge |
| `python`            | `pip install -r requirements.txt pytest ...` → `pytest --cov=services --cov-fail-under=80` (working dir: `analytics-service`) | Coverage below 80% fails CI |
| `e2e`               | Builds placeholder-env Next app → `playwright install --with-deps chromium` → runs auth/smoke/demo specs | Full match-queue spec is gated until a seeded CI Supabase is available |
| `secret-scan`       | `gitleaks/gitleaks-action@v2` with `.gitleaks.toml`                                       | Any secret pattern fails CI |
| `docs-link-check`   | `lycheeverse/lychee-action@v2 --offline` on `docs/runbooks/**`                            | Broken internal links fail CI |

**Coverage gate:** Python `--cov-fail-under=80` is the ONLY enforced coverage threshold. TypeScript has no `--coverage` gate. The absence is intentional — Vitest's V8 coverage is flaky in this setup; `audit-coverage.test.ts` and `check-gdpr-export-coverage.ts` serve as targeted invariants instead.

**Nightly probe** (`.github/workflows/nightly.yml`): runs `e2e/portfolio-pdf-demo.spec.ts --grep @nightly` at 08:00 UTC against `STAGING_BASE_URL`. On failure, auto-files a `p0` GitHub issue.

## Environment Gates

Tests that depend on env vars skip gracefully:
```typescript
it.skipIf(!HAS_LIVE_DB)("live-DB test", async () => { ... });
```

Common gates:
- `HAS_LIVE_DB` = `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` (cron route tests set/restore the env var in `beforeEach`/`afterEach`)
- `UPSTASH_REDIS_REST_URL` (rate limiter falls open without it; tests exercise the real graceful-degradation path)

**Env var guard pattern** for route tests:
```typescript
const originalSecret = process.env.CRON_SECRET;
beforeEach(() => { process.env.CRON_SECRET = "cron-secret-at-least-16-chars"; });
afterEach(() => {
  vi.restoreAllMocks();
  if (originalSecret) process.env.CRON_SECRET = originalSecret;
  else delete process.env.CRON_SECRET;
});
```

## What NOT to Do

- **Never read `.env` or `.env.local` contents in a test.** Use fake values via `process.env.X = "..."`.
- **Never commit a test that depends on production data / secrets.** Gate with `HAS_LIVE_DB` or `it.skipIf(!process.env.X)`.
- **Never use `it.only` or `describe.only` in committed code.** Playwright's `forbidOnly` enforces this for E2E in CI; Vitest does not, but reviewers should flag it.
- **Never import from `@testing-library/jest-dom`** directly — it's wired via `jest-dom/vitest` in the setup file.
- **Never rely on mock-reset order between suites.** Each suite resets its own state in `beforeEach`. Use `vi.clearAllMocks()` at suite boundaries, never globally.
- **Never add a new mutation to a route without instrumentation.** `audit-coverage.test.ts` will fail; you either emit `logAuditEvent(...)` inline OR add an `@audit-skip: <reason>` pragma above the chain.

---

*Testing analysis: 2026-04-17*
