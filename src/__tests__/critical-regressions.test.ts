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

  // PR #179 / C-0293 — CI hardening invariants.
  //
  // PR #179 pinned every `uses:` to a 40-char SHA, added workflow-level
  // permissions blocks, and switched the frontend-build artifact to
  // placeholder-only NEXT_PUBLIC_* values. The runbook prescribes
  // verification (actionlint + manual `gh run download` grep) but
  // nothing automated catches a regression at PR-review time. The
  // retroactive specialist sequence (pr-test-analyzer) flagged three
  // HIGH-conf gaps:
  //
  //   retro-PR179-H2 — no CI gate for SHA-pin policy
  //   retro-PR179-H3 — no CI gate for placeholder-env-in-artifact
  //   retro-PR179-H4 — no contract test for the rebuild step shape
  //
  // These guards encode the invariants at the source-text level, the
  // same pattern as [CRITICAL-02] VERSION/package.json drift. Each test
  // fails locally + in CI BEFORE any workflow runs, catching the
  // exact regressions a future PR could silently land.
  describe("[CRITICAL-C0293] CI hardening invariants (PR #179)", () => {
    const WORKFLOW_FILES = [
      ".github/workflows/ci.yml",
      ".github/workflows/nightly.yml",
      ".github/workflows/phase-19-stability.yml",
      ".github/workflows/supabase-migrate.yml",
    ];

    // Test helpers — collapse the repeated regex-assertion pattern below.
    function expectMatch(haystack: string, re: RegExp, msg: string): void {
      expect(re.test(haystack), msg).toBe(true);
    }
    function expectNoMatch(haystack: string, re: RegExp, msg: string): void {
      expect(re.test(haystack), msg).toBe(false);
    }
    // Locate a substring via regex, fail with a clear message if missing,
    // and return the first capture group (or full match if no group).
    function findOrFail(src: string, re: RegExp, msg: string): string {
      const m = src.match(re);
      expect(m, msg).not.toBeNull();
      return m![1] ?? m![0];
    }

    // retro-PR179-H2: SHA-pin policy. Every `uses:` must reference a
    // 40-character lowercase hex SHA — never a mutable tag (vN, main,
    // latest) or a partial SHA. First-party reusable workflows (`./...`)
    // are exempt; there are none in this repo today.
    describe("SHA-pin policy: every `uses:` must reference a 40-char SHA", () => {
      const SHA_RE = /^[a-f0-9]{40}$/;

      for (const rel of WORKFLOW_FILES) {
        it(`${rel} — every uses: ref is a 40-char SHA`, () => {
          const src = readText(rel);
          const usesLineRe = /^\s*-?\s*uses:\s*([^\s#]+)/gm;
          const offenders: string[] = [];
          let match: RegExpExecArray | null;
          while ((match = usesLineRe.exec(src)) !== null) {
            const fullRef = match[1];
            // Skip first-party reusable workflows (./...) — none today.
            if (fullRef.startsWith("./")) continue;
            const atIdx = fullRef.lastIndexOf("@");
            // No `@` at all is invalid for non-local refs.
            if (atIdx < 0) {
              offenders.push(`${fullRef} (no @ref)`);
              continue;
            }
            const ref = fullRef.slice(atIdx + 1);
            if (!SHA_RE.test(ref)) {
              offenders.push(`${fullRef} (ref "${ref}" is not a 40-char SHA)`);
            }
          }
          expect(
            offenders.length,
            `${rel} contains non-SHA-pinned uses references — C-0293(b) regression:\n  ${offenders.join("\n  ")}`,
          ).toBe(0);
        });
      }
    });

    // retro-PR179-H2: workflow-level permissions block. Every workflow
    // MUST declare `permissions:` at workflow level (defaulting to
    // contents: read), so a missing/typo'd block can't fall back to
    // the GITHUB_TOKEN repo default (contents: write etc.).
    describe("Workflow-level permissions: every workflow declares the minimum scope", () => {
      const PERMISSIONS_BLOCK_RE = /^permissions:\s*\n(?:\s+\S+:[\s\S]*?)(?=\n[^\s])/m;

      for (const rel of WORKFLOW_FILES) {
        it(`${rel} — declares a top-level permissions: block with contents: read`, () => {
          const src = readText(rel);
          const block = findOrFail(
            src,
            PERMISSIONS_BLOCK_RE,
            `${rel} has no top-level permissions: block — GITHUB_TOKEN would inherit repo default (writes)`,
          );
          expectMatch(
            block,
            /contents:\s*read/,
            `${rel} top-level permissions block does not include 'contents: read'`,
          );
        });
      }
    });

    // retro-PR179-H3: frontend-build artifact MUST be built with
    // placeholder NEXT_PUBLIC_* values UNCONDITIONALLY. The previous
    // seed-aware ternary leaked TEST_SUPABASE_URL/ANON_KEY into the
    // uploaded artifact. A regression that re-introduces the ternary
    // (or any non-placeholder value) re-opens the exfil pivot.
    describe("frontend-build env: placeholder NEXT_PUBLIC_* values only", () => {
      it("ci.yml frontend-build env block uses placeholder NEXT_PUBLIC_* values and does not reference secrets.TEST_SUPABASE_URL", () => {
        const src = readText(".github/workflows/ci.yml");
        // Find the frontend-build job's `npm run build` step env block.
        // The placeholder MUST appear directly in the env literal, not
        // via a secret/var expression.
        const envBlock = findOrFail(
          src,
          /frontend-build:[\s\S]*?-\s*run:\s*npm run build[\s\S]*?env:\s*\n([\s\S]*?)(?=\n\s{0,6}-\s|\n[a-z])/,
          "ci.yml: could not locate frontend-build npm run build env block",
        );
        expectMatch(
          envBlock,
          /NEXT_PUBLIC_SUPABASE_URL:\s*https:\/\/placeholder\.supabase\.co/,
          "frontend-build env NEXT_PUBLIC_SUPABASE_URL is not the literal placeholder — C-0293(c) regression",
        );
        expectMatch(
          envBlock,
          /NEXT_PUBLIC_SUPABASE_ANON_KEY:\s*placeholder\b/,
          "frontend-build env NEXT_PUBLIC_SUPABASE_ANON_KEY is not the literal placeholder — C-0293(c) regression",
        );
        // Defensive: secrets.TEST_SUPABASE_URL must NOT appear in the
        // frontend-build env block (it belongs only in the rebuild
        // step further down in the e2e job).
        expectNoMatch(
          envBlock,
          /secrets\.TEST_SUPABASE_URL/,
          "frontend-build env references secrets.TEST_SUPABASE_URL — C-0293(c) seed-aware ternary regression",
        );
      });

      // retro-PR179-H4: seed-gated rebuild step contract. The step
      // MUST (a) be gated on vars.E2E_TEST_DB_CONFIGURED, (b) wipe
      // .next/server + .next/static + the 3 manifests, (c) re-run
      // `npm run build` with the REAL secrets in env.
      it("ci.yml seed-gated rebuild step has the required shape (contract for C-0293(c) Path 2)", () => {
        const src = readText(".github/workflows/ci.yml");
        // The rebuild step's identifying name is unique in the file.
        const step = findOrFail(
          src,
          /-\s*name:\s*Rebuild Next\.js with real test-Supabase env[\s\S]*?(?=\n\s{0,6}-\s)/,
          "ci.yml: rebuild step name not found — Path 2 contract drifted",
        );
        // (a) gated on vars.E2E_TEST_DB_CONFIGURED
        expectMatch(
          step,
          /if:\s*\$\{\{\s*vars\.E2E_TEST_DB_CONFIGURED\s*==\s*'true'\s*\}\}/,
          "rebuild step not gated on vars.E2E_TEST_DB_CONFIGURED — would run on fork PRs and burn rebuild cost",
        );
        // (b) wipes the placeholder manifests before rebuild
        expectMatch(
          step,
          /rm\s+-rf\s+\.next\/server\s+\.next\/static/,
          "rebuild step no longer wipes .next/server + .next/static — placeholder chunks could leak through",
        );
        // (c) re-runs `npm run build` with REAL secrets in env (not
        // placeholder values). secrets.TEST_SUPABASE_URL must appear
        // in the env block.
        expectMatch(step, /npm run build/, "rebuild step no longer runs `npm run build`");
        expectMatch(
          step,
          /NEXT_PUBLIC_SUPABASE_URL:\s*\$\{\{\s*secrets\.TEST_SUPABASE_URL\s*\}\}/,
          "rebuild step env no longer wires secrets.TEST_SUPABASE_URL — seed-gated specs would run against placeholder bundle",
        );
        expectMatch(
          step,
          /NEXT_PUBLIC_SUPABASE_ANON_KEY:\s*\$\{\{\s*secrets\.TEST_SUPABASE_ANON_KEY\s*\}\}/,
          "rebuild step env no longer wires secrets.TEST_SUPABASE_ANON_KEY",
        );
      });
    });

    // retro-PR179-M (#20/#21): include-hidden-files: true on the
    // frontend-build upload step. Without this flag, upload-artifact@v4
    // silently excludes the dotfile-prefixed `.next/` directory and the
    // e2e job crashes with "Could not find a production build". This is
    // operational knowledge captured in YAML comments; the regression
    // test pins the invariant.
    describe("upload-artifact invariants", () => {
      it("ci.yml frontend-build upload step must set include-hidden-files: true", () => {
        const src = readText(".github/workflows/ci.yml");
        const step = findOrFail(
          src,
          /-\s*name:\s*Upload \.next \+ public artifact for e2e[\s\S]*?(?=\n\s{0,6}-\s|\n[a-z])/,
          "ci.yml: frontend-build upload step name not found",
        );
        expectMatch(
          step,
          /include-hidden-files:\s*true/,
          "frontend-build upload step missing include-hidden-files: true — .next/ silently excluded, e2e crashes",
        );
      });
    });
  });
});
