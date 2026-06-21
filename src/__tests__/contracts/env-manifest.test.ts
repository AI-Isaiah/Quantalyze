import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * [#15] Env/config manifest gate.
 *
 * Config sprawls across 4 planes (Vercel / Railway / Supabase GUC / GitHub)
 * with no parity tooling: src/ read ~58 distinct process.env keys while
 * .env.example documented ~30, so app config (ALERT_ACK_SECRET,
 * RESEND_WEBHOOK_SECRET, the server-side POSTHOG_* trio, …) drifted into
 * "undocumented unless you grep the source", and dead entries
 * (PORTFOLIO_PDF_SECRET) lingered. That already bit once: RESEND_API_KEY
 * unset in Vercel prod silently disabled the founder-LP report cron.
 *
 * This makes .env.example the ENFORCED manifest, bidirectionally:
 *   (a) every literal process.env.<KEY> read in src/ is documented here OR
 *       allowlisted as a platform/test/indirect key;
 *   (b) every active (uncommented) key in .env.example is actually read in
 *       src/ (no dead entries) OR is a known indirect read.
 *
 * Limitation: only LITERAL `process.env.FOO` / `process.env["FOO"]` reads are
 * discoverable. Computed reads (`process.env[someVar]`) are invisible to the
 * grep — those keys go in INDIRECT_READS so direction (b) doesn't false-flag
 * them as dead. ALERT_ACK_SECRET is the one such case today.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const ENV_EXAMPLE = join(ROOT, ".env.example");

// Platform / runtime keys set by the host (Node, Vercel, CI, Vitest), not app
// config the operator provisions — never belong in .env.example.
const PLATFORM_KEYS = new Set([
  "NODE_ENV",
  "CI",
  "TZ",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "NEXT_PUBLIC_VERCEL_URL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "VITEST",
  "VITEST_WORKER_ID",
]);

// Keys read only by tests / test-helpers (live-DB integration, e2e seeding,
// parity harnesses). Operational config, not app config.
const TEST_ONLY_KEYS = new Set([
  "BASE_URL",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "SCENARIO_COMMIT_BASE_URL",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_TEST_URL",
  "SUPABASE_TEST_ANON_KEY",
  "SUPABASE_TEST_SERVICE_ROLE_KEY",
  "TRADE_MIX_HAS_MAKER_TAKER",
]);

// App config read via a computed accessor (`const E = "FOO"; process.env[E]`),
// invisible to the literal grep. Documented in .env.example but exempt from the
// "documented ⇒ read literally" dead-entry check. Keep this in step with the
// `process.env[SECRET_ENV]`-style reads in src/ (alert-ack-token.ts,
// demo-pdf-token.ts, pdf-render-token.ts).
const INDIRECT_READS = new Set(["ALERT_ACK_SECRET", "DEMO_PDF_SECRET"]);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx|mts|cts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Literal reads only: process.env.FOO and process.env["FOO"]/['FOO'].
const ENV_READ_RE =
  /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g;

function readKeysInSrc(): Set<string> {
  const keys = new Set<string>();
  for (const file of collectSourceFiles(SRC)) {
    // Skip this file: its JSDoc/messages contain example `process.env.FOO`
    // reads that are documentation, not real reads.
    if (file.endsWith("env-manifest.test.ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(ENV_READ_RE)) {
      const key = m[1] ?? m[2];
      // `process.env.X` in withAdminAuth.ts is a comment artifact (a literal
      // single-letter placeholder describing a bad pattern), not a real read.
      if (key && key !== "X") keys.add(key);
    }
  }
  return keys;
}

// Active = uncommented `KEY=...` lines. Commented `# KEY=` lines are
// documentation-only (e.g. the Railway/Python reference block) and are not
// required to be read by src/.
function activeManifestKeys(): Set<string> {
  const keys = new Set<string>();
  for (const line of readFileSync(ENV_EXAMPLE, "utf8").split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) keys.add(m[1]);
  }
  return keys;
}

describe("[#15] env/config manifest (.env.example is the enforced manifest)", () => {
  it("every literal process.env read in src/ is documented or allowlisted", () => {
    const read = readKeysInSrc();
    const documented = activeManifestKeys();
    // Commented docs also count as "documented" for direction (a): a key
    // documented as `# KEY=` is acknowledged config, just optional/defaulted.
    const commentedDocs = new Set<string>();
    for (const line of readFileSync(ENV_EXAMPLE, "utf8").split("\n")) {
      const m = /^#\s*([A-Z][A-Z0-9_]*)=/.exec(line);
      if (m) commentedDocs.add(m[1]);
    }
    const undocumented = [...read]
      .filter(
        (k) =>
          !documented.has(k) &&
          !commentedDocs.has(k) &&
          !PLATFORM_KEYS.has(k) &&
          !TEST_ONLY_KEYS.has(k) &&
          !INDIRECT_READS.has(k),
      )
      .sort();
    expect(
      undocumented,
      `Undocumented env keys read in src/: ${undocumented.join(", ")}. ` +
        `Add each to .env.example (with its owning plane), or to PLATFORM_KEYS / ` +
        `TEST_ONLY_KEYS / INDIRECT_READS in this test if it is not app config.`,
    ).toEqual([]);
  });

  it("every active key in .env.example is actually read in src/ (no dead entries)", () => {
    const read = readKeysInSrc();
    const active = activeManifestKeys();
    const dead = [...active]
      .filter((k) => !read.has(k) && !INDIRECT_READS.has(k))
      .sort();
    expect(
      dead,
      `Active .env.example keys read nowhere in src/ (dead entries): ${dead.join(", ")}. ` +
        `Remove them, comment them out as reference-only, or add to INDIRECT_READS if ` +
        `read via a computed accessor.`,
    ).toEqual([]);
  });
});
