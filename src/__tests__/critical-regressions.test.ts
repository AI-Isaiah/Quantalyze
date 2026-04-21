import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Regression guards for CRITICAL findings from the 2026-04-10 deep audit
// and CSO security findings (SEC-001 through SEC-005).
// Each test fails against the code state at commit 9930829 (baseline) and
// is expected to pass after the corresponding fix in the same PR.
//
// Findings:
//   CRITICAL-01   audit/tech-debt-round-1.md       portfolio-pdf IDOR
//   CRITICAL-02   audit/tech-debt-round-1.md       VERSION / package.json drift
//   SD-CRITICAL-01 audit/system-design-round-1.md  analytics-client no timeout
//   SD-CRITICAL-02 audit/system-design-round-1.md  vercel.json missing crons
//   SD-CRITICAL-03 audit/system-design-round-1.md  no production error telemetry
//   SEC-002       CSO audit                        alert-digest timing-safe compare
//   SEC-003       CSO audit                        Content-Disposition sanitizer
//   SEC-004       CSO audit                        Content-Security-Policy headers

const REPO_ROOT = join(__dirname, "..", "..");
const readText = (relPath: string) => readFileSync(join(REPO_ROOT, relPath), "utf8");
const readJson = <T>(relPath: string): T => JSON.parse(readText(relPath)) as T;

describe("Critical regression guards", () => {
  describe("[CRITICAL-01] portfolio-pdf IDOR", () => {
    it("portfolio-pdf page must gate admin-client access with auth or signed token", () => {
      const src = readText("src/app/portfolio-pdf/[id]/page.tsx");
      const usesAdminClient = /createAdminClient\s*\(/.test(src);
      if (!usesAdminClient) {
        // Fix landed via a different route (e.g. switched to anon client under RLS).
        // That's a valid fix — the test is satisfied.
        return;
      }
      // If it still uses the admin client, it MUST have an auth/token gate.
      const hasAuthGate =
        /\.auth\.getUser\s*\(/.test(src) ||
        /verifyDemoPdfToken|verifyPdfToken|verifyPortfolioPdfToken|verifyPdfRenderToken/.test(src) ||
        /timingSafeEqual/.test(src);
      expect(
        hasAuthGate,
        "src/app/portfolio-pdf/[id]/page.tsx uses createAdminClient() without an auth/token gate (IDOR)",
      ).toBe(true);
    });
  });

  describe("[CRITICAL-02] VERSION / package.json drift", () => {
    it("VERSION file must equal package.json version", () => {
      const versionFile = readText("VERSION").trim();
      const pkg = readJson<{ version: string }>("package.json");
      expect(pkg.version, "package.json version does not match VERSION file").toBe(versionFile);
    });
  });

  describe("[SD-CRITICAL-01] analytics-client must have a fetch timeout", () => {
    it("src/lib/analytics-client.ts must wire a fetch abort signal", () => {
      const src = readText("src/lib/analytics-client.ts");
      const hasTimeout =
        /AbortSignal\.timeout/.test(src) ||
        /new\s+AbortController/.test(src) ||
        /signal\s*:/.test(src);
      expect(
        hasTimeout,
        "analytics-client has no timeout/abort — a hung Railway worker will hang the lambda until platform kill",
      ).toBe(true);
    });
  });

  describe("[SD-CRITICAL-02] vercel.json must register Vercel Crons", () => {
    type VercelConfig = {
      crons?: ReadonlyArray<{ path: string; schedule: string }>;
    };

    it("vercel.json must have a crons array", () => {
      const cfg = readJson<VercelConfig>("vercel.json");
      expect(
        Array.isArray(cfg.crons),
        "vercel.json has no `crons` — warm-analytics and alert-digest never run",
      ).toBe(true);
    });

    it("vercel.json crons must include warm-analytics", () => {
      const cfg = readJson<VercelConfig>("vercel.json");
      const paths = (cfg.crons ?? []).map((c) => c.path);
      expect(paths).toContain("/api/cron/warm-analytics");
    });

    it("vercel.json crons must include alert-digest", () => {
      const cfg = readJson<VercelConfig>("vercel.json");
      const paths = (cfg.crons ?? []).map((c) => c.path);
      expect(paths).toContain("/api/alert-digest");
    });
  });

  describe("[SEC-002] alert-digest must use timing-safe secret comparison", () => {
    it("alert-digest route must import safeCompare, not use !== for secret check", () => {
      const src = readText("src/app/api/alert-digest/route.ts");
      expect(
        /safeCompare/.test(src),
        "alert-digest route does not import/use safeCompare — timing side-channel on cron secret",
      ).toBe(true);
      // The route must NOT have a bare `auth !== expected` comparison
      const hasBareComparison = /auth\s*!==\s*expected/.test(src);
      expect(
        hasBareComparison,
        "alert-digest route still uses `auth !== expected` — replace with safeCompare(auth, expected)",
      ).toBe(false);
    });
  });

  describe("[SEC-003] PDF routes must sanitize Content-Disposition filenames", () => {
    const pdfRoutes = [
      "src/app/api/factsheet/[id]/pdf/route.ts",
      "src/app/api/factsheet/[id]/tearsheet.pdf/route.ts",
      "src/app/api/portfolio-pdf/[id]/route.ts",
      "src/app/api/demo/portfolio-pdf/[id]/route.ts",
    ];

    for (const route of pdfRoutes) {
      it(`${route} must use sanitizeFilename`, () => {
        const src = readText(route);
        expect(
          /sanitizeFilename/.test(src),
          `${route} does not use sanitizeFilename — Content-Disposition header injection risk`,
        ).toBe(true);
      });
    }
  });

  describe("[SEC-004] next.config.ts must set security headers", () => {
    it("must include Content-Security-Policy header", () => {
      const src = readText("next.config.ts");
      expect(
        /Content-Security-Policy/.test(src),
        "next.config.ts has no Content-Security-Policy header",
      ).toBe(true);
    });

    it("must include X-Frame-Options DENY", () => {
      const src = readText("next.config.ts");
      expect(/X-Frame-Options/.test(src) && /DENY/.test(src)).toBe(true);
    });

    it("must include X-Content-Type-Options nosniff", () => {
      const src = readText("next.config.ts");
      expect(
        /X-Content-Type-Options/.test(src) && /nosniff/.test(src),
      ).toBe(true);
    });
  });

  describe("[SD-CRITICAL-03] production error telemetry must be wired", () => {
    it("package.json must include an error-telemetry dependency", () => {
      const pkg = readJson<{
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }>("package.json");
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const hasErrorTelemetry = Object.keys(deps).some(
        (name) =>
          name.startsWith("@sentry/") ||
          name.startsWith("@datadog/") ||
          name.startsWith("@axiomhq/") ||
          name.startsWith("@highlight-run/") ||
          name === "@opentelemetry/api",
      );
      expect(
        hasErrorTelemetry,
        "no error telemetry library installed — production errors are invisible",
      ).toBe(true);
    });
  });

  // Phase 08 Plan 01 — atomic rename of portfolio_note.update → user_note.*.update.
  // D-23 mandates the rename lands in a single atomic commit with migration 071,
  // the audit enum, the route emitter, and ADR-0023 all in lockstep. This guard
  // asserts the legacy quoted literals are absent from the route emitter and
  // the audit enum so a future accidental reintroduction fails fast. Comments
  // referencing the old name for historical context are allowed — the guard
  // matches only quoted string literals (the forms used by the enum + emitter).
  describe("[PHASE-08-01] portfolio_note literal absent from route.ts + audit.ts", () => {
    const watchedFiles = ["src/app/api/notes/route.ts", "src/lib/audit.ts"];

    for (const rel of watchedFiles) {
      it(`${rel} must not contain the quoted literal "portfolio_note.update"`, () => {
        const src = readText(rel);
        const hasQuotedLiteral =
          /"portfolio_note\.update"/.test(src) ||
          /'portfolio_note\.update'/.test(src);
        expect(
          hasQuotedLiteral,
          `${rel} still references the legacy audit action "portfolio_note.update" — the Phase 08 rename to user_note.{scope}.update must remove all in-repo call sites atomically (D-23).`,
        ).toBe(false);
      });

      it(`${rel} must not contain the quoted legacy entity_type literal "portfolio_note"`, () => {
        const src = readText(rel);
        // Match the quoted literal only (enum/emitter form). Comments
        // referencing the old name for historical context are allowed.
        const hasLiteral =
          /"portfolio_note"/.test(src) || /'portfolio_note'/.test(src);
        expect(
          hasLiteral,
          `${rel} still references the legacy entity_type "portfolio_note" — should be "user_note" per Phase 08 reshape.`,
        ).toBe(false);
      });
    }
  });
});
