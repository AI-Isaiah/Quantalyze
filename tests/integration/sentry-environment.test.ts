/**
 * Phase 19 / BACKBONE-05 / H-6 — Sentry SDK init `environment` tag smoke test.
 *
 * The /api/cron/flag-monitor cron filters Sentry events by
 * `environment:production` (Pitfall 8) to prevent dev/preview events from
 * tripping the production auto-rollback. That filter only works if BOTH
 * Sentry SDK init paths actually stamp the environment tag from VERCEL_ENV
 * (or the analytics-service equivalent) on every captured event.
 *
 * This test is the static surface — it fails on H-6 regression even without
 * a live Sentry receiver. The dynamic-capture surface (CI smoke that fires
 * a real event into the test Sentry org and reads it back via the events
 * API) lives in .github/workflows/phase-19-stability.yml as a separate
 * `npm run smoke:sentry-env` step (deferred — see SUMMARY).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `import "server-only"` throws in jsdom; mock it for module-level imports
// that may transitively pull it in during static-source reads (no impact on
// fs-based assertions below but prevents unrelated failures if this file is
// later expanded with a runtime register() call).
vi.mock("server-only", () => ({}));

const REPO_ROOT = resolve(__dirname, "..", "..");
const TS_INIT_PATH = resolve(REPO_ROOT, "src", "instrumentation.ts");
const PY_INIT_PATH = resolve(
  REPO_ROOT,
  "analytics-service",
  "sentry_init.py",
);

describe("Phase 19 / H-6 — Sentry init writes environment tag", () => {
  it("src/instrumentation.ts threads VERCEL_ENV into Sentry.init", () => {
    const src = readFileSync(TS_INIT_PATH, "utf8");
    // Tolerate either nullish-coalesce or logical-or fallback. Reject any
    // init that hardcodes "production" without an env-var read.
    // Match Sentry.init({...environment: ...}) — use [\s\S] instead of `s`
    // flag (ES2017 target compat).
    expect(src).toMatch(/Sentry\.init\([\s\S]*?environment\s*:/);
    expect(src).toMatch(/process\.env\.VERCEL_ENV/);
  });

  it("analytics-service/sentry_init.py threads VERCEL_ENV via the resolver", () => {
    const src = readFileSync(PY_INIT_PATH, "utf8");
    // Resolver function must exist + be referenced by sentry_sdk.init.
    expect(src).toMatch(/def _resolve_environment\(\)/);
    expect(src).toMatch(/VERCEL_ENV/);
    // The init call must use the resolver (not a hardcoded string).
    expect(src).toMatch(/environment\s*=\s*_resolve_environment\(\)/);
  });

  it("analytics-service/sentry_init.py stamps event.environment in before_send (defense-in-depth)", () => {
    const src = readFileSync(PY_INIT_PATH, "utf8");
    // The before_send must stamp event["environment"] when missing — guards
    // against pre-init captures and future refactors that drop the init arg.
    expect(src).toMatch(
      /event\["environment"\]\s*=\s*_resolve_environment\(\)/,
    );
  });
});

describe("Phase 19 / H-6 — _resolve_environment fallback chain (Python static read)", () => {
  // Static check that the documented fallback order is preserved. Catches
  // accidental drift to "production" default (Pitfall 8 regression risk).
  it("prefers VERCEL_ENV → RAILWAY_ENVIRONMENT_NAME → 'development' (NOT 'production')", () => {
    const src = readFileSync(PY_INIT_PATH, "utf8");
    // Bracket the resolver body between `def _resolve_environment` and the
    // next top-level `def ` (init_sentry, defined immediately after). This
    // avoids the regex over-matching the first inner `)` in `os.getenv(...)`.
    const start = src.indexOf("def _resolve_environment(");
    expect(start, "resolver fn missing").toBeGreaterThanOrEqual(0);
    const after = src.slice(start);
    const nextDef = after.search(/\ndef\s+\w/);
    const body = nextDef >= 0 ? after.slice(0, nextDef) : after;
    const vercelIdx = body.indexOf("VERCEL_ENV");
    const railwayIdx = body.indexOf("RAILWAY_ENVIRONMENT_NAME");
    const devIdx = body.indexOf('"development"');
    const prodCodeIdx = body.search(/return\s+"production"|or\s+"production"/);
    expect(vercelIdx).toBeGreaterThanOrEqual(0);
    expect(railwayIdx).toBeGreaterThan(vercelIdx);
    expect(devIdx).toBeGreaterThan(railwayIdx);
    // Default MUST NOT be "production" in the executable fallback — that
    // would tag local dev events as production and trip the cron's
    // auto-rollback path falsely. The docstring may MENTION "production"
    // when explaining Pitfall 8, so we look only at executable forms.
    expect(prodCodeIdx).toBe(-1);
  });
});

describe("Phase 19 / H-6 — runtime smoke (instrumented register)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.VERCEL_ENV;
    delete process.env.SENTRY_DSN;
  });

  it("register() passes VERCEL_ENV through to Sentry.init when DSN is set", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SENTRY_DSN = "https://fake@sentry.example/0";
    const initMock = vi.fn();
    vi.doMock("@sentry/nextjs", () => ({ init: initMock }));
    const { register } = await import("../../src/instrumentation");
    await register();
    expect(initMock).toHaveBeenCalledTimes(1);
    const arg = initMock.mock.calls[0][0] as { environment?: string };
    expect(arg.environment).toBe("production");
  });

  it("register() falls back to 'development' when VERCEL_ENV is unset", async () => {
    delete process.env.VERCEL_ENV;
    process.env.SENTRY_DSN = "https://fake@sentry.example/0";
    const initMock = vi.fn();
    vi.doMock("@sentry/nextjs", () => ({ init: initMock }));
    const { register } = await import("../../src/instrumentation");
    await register();
    expect(initMock).toHaveBeenCalledTimes(1);
    const arg = initMock.mock.calls[0][0] as { environment?: string };
    // Documented fallback in src/instrumentation.ts. NOT "production" —
    // Pitfall 8 mitigation: dev events must NOT count toward prod rollback.
    expect(arg.environment).not.toBe("production");
  });
});
