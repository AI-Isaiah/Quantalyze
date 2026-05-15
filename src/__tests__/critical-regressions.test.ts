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

  // Audit-2026-05-07 #53 — Plausible analytics is pre-emptively whitelisted
  // in the CSP so a future integration does not silently break under a
  // strict default-src. The directive must appear in BOTH script-src AND
  // connect-src; missing connect-src would let the page load the script
  // but block the events POST.
  describe("[AUDIT-2026-05-07 #53] Plausible CSP whitelist", () => {
    it("next.config.ts script-src must allow https://plausible.io", () => {
      const src = readText("next.config.ts");
      // The CSP value contains nested single quotes (e.g. 'self'), so
      // the capture group must terminate on the outer double-quote only.
      const cspMatch = src.match(
        /Content-Security-Policy[\s\S]*?value:\s*"([^"]+)"/,
      );
      expect(cspMatch, "next.config.ts has no CSP value to inspect").not.toBeNull();
      const cspValue = cspMatch![1];
      const scriptSrc = cspValue
        .split(";")
        .find((d) => d.trim().startsWith("script-src"));
      expect(
        scriptSrc && /https:\/\/plausible\.io/.test(scriptSrc),
        "next.config.ts CSP script-src does not include https://plausible.io",
      ).toBe(true);
    });

    it("next.config.ts connect-src must allow https://plausible.io", () => {
      const src = readText("next.config.ts");
      const cspMatch = src.match(
        /Content-Security-Policy[\s\S]*?value:\s*"([^"]+)"/,
      );
      expect(cspMatch).not.toBeNull();
      const cspValue = cspMatch![1];
      const connectSrc = cspValue
        .split(";")
        .find((d) => d.trim().startsWith("connect-src"));
      expect(
        connectSrc && /https:\/\/plausible\.io/.test(connectSrc),
        "next.config.ts CSP connect-src does not include https://plausible.io — Plausible script will load but events will be blocked",
      ).toBe(true);
    });
  });

  // Audit-2026-05-07 #28 — partner_tag CHECK constraint migration.
  // The CHECK lives in migration 101. We can't apply it at unit-test
  // time (no Postgres), but we CAN assert the migration file is shape-
  // correct: pre-flight scrub, four ALTER TABLE statements, and a
  // self-verifying assertion that fails loudly if any CHECK is missing.
  describe("[AUDIT-2026-05-07 #28] migration 101 partner_tag CHECK constraint", () => {
    const MIGRATION_PATH =
      "supabase/migrations/20260510172412_partner_tag_check_constraint.sql";

    it("migration file exists", () => {
      expect(() => readText(MIGRATION_PATH)).not.toThrow();
    });

    it("contains the pre-flight scrub guard", () => {
      const sql = readText(MIGRATION_PATH);
      expect(/Migration 101 cannot apply/.test(sql)).toBe(true);
      expect(/SELECT count\(\*\) INTO bad_count/i.test(sql)).toBe(true);
    });

    const TABLES = ["profiles", "strategies", "contact_requests", "match_batches"];
    for (const table of TABLES) {
      it(`adds CHECK constraint on ${table}.partner_tag matching ^[a-z0-9-]+$`, () => {
        const sql = readText(MIGRATION_PATH);
        const constraintRe = new RegExp(
          `ALTER TABLE\\s+${table}[\\s\\S]*?ADD CONSTRAINT\\s+${table}_partner_tag_format_check[\\s\\S]*?CHECK\\s*\\([\\s\\S]*?\\^\\[a-z0-9-\\]\\+\\$`,
          "i",
        );
        expect(
          constraintRe.test(sql),
          `migration 101 missing CHECK constraint for ${table}.partner_tag`,
        ).toBe(true);
      });
    }

    it("ends with the self-verifying assertion that all four constraints landed", () => {
      const sql = readText(MIGRATION_PATH);
      // The trailing DO $$ block expands the expected_constraints array
      // and RAISE EXCEPTIONs if pg_constraint count != 4. Without this
      // guard a soft no-op (the failure mode that bit migration 017)
      // would land silently.
      expect(/expected_constraints\s+text\[\]/.test(sql)).toBe(true);
      expect(/Migration 101 failed/.test(sql)).toBe(true);
    });
  });

  // Audit-2026-05-07 #43 / #44 — defensive UI branches that surface
  // previously-silent failures. The component-level tests live alongside
  // the components; these guards prevent regression at the source-text
  // level so a future refactor cannot silently strip the safety net.
  describe("[AUDIT-2026-05-07 #43] ShareableLink surfaces clipboard failures", () => {
    it("ShareableLink.tsx must track fallbackSucceeded and render copyFailed UI", () => {
      const src = readText("src/components/strategy/ShareableLink.tsx");
      // The fix introduces an explicit success flag for the fallback
      // path so we don't fire the success badge when both paths failed.
      expect(
        /fallbackSucceeded/.test(src),
        "ShareableLink.tsx no longer tracks the fallback outcome — copy-failed regression possible",
      ).toBe(true);
      expect(
        /copyFailed/.test(src) && /Copy failed/.test(src),
        "ShareableLink.tsx no longer renders the 'Copy failed' state",
      ).toBe(true);
    });
  });

  describe("[AUDIT-2026-05-07 #44] PendingIntros detects RLS-zero updates", () => {
    it("PendingIntros.tsx must call .select('id') on the update so PostgREST returns the affected rowset", () => {
      const src = readText("src/components/strategy/PendingIntros.tsx");
      expect(
        /\.select\(\s*["']id["']\s*\)/.test(src),
        "PendingIntros.tsx no longer chains .select('id') on the contact_requests update — RLS-zero silent-success regression possible",
      ).toBe(true);
    });

    it("PendingIntros.tsx must check updated.length === 0 and surface a permission-style error", () => {
      const src = readText("src/components/strategy/PendingIntros.tsx");
      expect(
        /updated\.length\s*===\s*0/.test(src) ||
          /updated\.length\s*<\s*1/.test(src),
        "PendingIntros.tsx no longer checks for a zero-row update — RLS-zero silent-success regression possible",
      ).toBe(true);
      expect(
        /may not have permission/.test(src),
        "PendingIntros.tsx no longer surfaces the permission-style error copy",
      ).toBe(true);
    });
  });

  // Audit-2026-05-07 #24 — ContactRequestStatus type drift. The DB write
  // is `status: "intro_made"` (NOT "accepted"); a stale type definition
  // would let a typo'd literal slip through at compile time.
  describe("[AUDIT-2026-05-07 #24] ContactRequestStatus union", () => {
    it("types.ts must export the ContactRequestStatus alias with intro_made/completed/declined values", () => {
      const src = readText("src/lib/types.ts");
      expect(/ContactRequestStatus/.test(src)).toBe(true);
      expect(/"intro_made"/.test(src)).toBe(true);
      expect(/"completed"/.test(src)).toBe(true);
      expect(/"declined"/.test(src)).toBe(true);
      // Defensive: the legacy "accepted" literal must NOT remain on the
      // ContactRequestStatus alias — DB writes use "intro_made".
      const aliasMatch = src.match(
        /(?:export\s+)?type\s+ContactRequestStatus\s*=\s*([^;\n]+)/,
      );
      expect(aliasMatch).not.toBeNull();
      expect(
        /"accepted"/.test(aliasMatch![1]),
        "ContactRequestStatus alias still includes legacy 'accepted' literal — DB writes use 'intro_made'",
      ).toBe(false);
    });
  });

  // Audit-2026-05-07 #35 — explicit staging project-ref allowlist. The
  // legacy guard relied on substring match against /prod|production/i,
  // which never matched a real Supabase URL (project refs are 8-char
  // alphanumerics). Replace with an explicit allowlist of known staging
  // refs, with a SEED_ALLOW_SUPABASE_PROJECT_REF override.
  describe("[AUDIT-2026-05-07 #35] seed-full-app-demo staging allowlist guard", () => {
    it("scripts/seed-full-app-demo.ts must hardcode the staging project ref allowlist", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      expect(
        /STAGING_PROJECT_REF_ALLOWLIST/.test(src),
        "scripts/seed-full-app-demo.ts no longer defines an explicit staging allowlist set",
      ).toBe(true);
      expect(
        /qmnijlgmdhviwzwfyzlc/.test(src),
        "scripts/seed-full-app-demo.ts no longer pins the documented staging project ref",
      ).toBe(true);
    });

    it("scripts/seed-full-app-demo.ts must support SEED_ALLOW_SUPABASE_PROJECT_REF env override", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      expect(/SEED_ALLOW_SUPABASE_PROJECT_REF/.test(src)).toBe(true);
    });

    it("scripts/seed-full-app-demo.ts must exit with code 3 when project ref is unparseable or absent from allowlist", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      // The allowlist guard exits with code 3 — same exit code as the
      // legacy /prod/production/ guard so existing CI checks keep working.
      const hasExit3 = /process\.exit\(3\)/.test(src);
      expect(hasExit3).toBe(true);
    });
  });

  // Audit-2026-05-07 #47 — wipeLegacySeed surfaces auth.admin.deleteUser
  // failures at WARN. Pre-fix, `.catch(() => {})` swallowed every error —
  // an orphaned auth.users row could not be detected because the FK
  // lookup by id missed (the profile was already gone).
  describe("[AUDIT-2026-05-07 #47] wipeLegacySeed surfaces auth-delete failures", () => {
    it("scripts/seed-full-app-demo.ts must NOT swallow deleteUser errors with .catch(() => {})", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      // A literal `.catch(() => {})` directly after deleteUser is the
      // pre-fix pattern. The fix uses try/catch + console.warn, so this
      // exact substring must be gone.
      const hasSwallowedCatch =
        /admin\.auth\.admin\.deleteUser\([^)]*\)\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(
          src,
        );
      expect(
        hasSwallowedCatch,
        "scripts/seed-full-app-demo.ts still swallows auth.admin.deleteUser errors with .catch(() => {}) — orphan trail invisible",
      ).toBe(false);
    });

    it("scripts/seed-full-app-demo.ts must surface deleteUser failures via console.warn", () => {
      const src = readText("scripts/seed-full-app-demo.ts");
      // Both the {error}-returned path and the throws path must call
      // console.warn so an operator sees the orphan.
      expect(
        /auth\.admin\.deleteUser[\s\S]*?console\.warn/.test(src),
        "scripts/seed-full-app-demo.ts no longer logs auth.admin.deleteUser failures",
      ).toBe(true);
    });
  });
});
