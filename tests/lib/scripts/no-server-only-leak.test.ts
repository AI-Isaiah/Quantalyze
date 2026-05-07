/**
 * Phase 18 / hotfix-server-only — regression gate.
 *
 * Any `scripts/*.ts` that imports from `@/` is at risk of pulling in
 * `src/lib/supabase/admin` (via `@/lib/queries` or another barrel) and
 * triggering `import "server-only"` at top-level — which throws under any
 * non-React-Server-Components runtime, including `tsx`-run pre-flight
 * scripts. Unit tests `vi.mock("@/lib/supabase/admin", ...)` and never
 * see the chain, so the bug ships silently.
 *
 * Pre-fix, `scripts/check-founder-lp-readiness.ts` was the canary: its
 * import chain was `script → readiness.ts → @/lib/queries → admin.ts →
 * "server-only"` and `npm run check:founder-lp-readiness` always crashed
 * with `This module cannot be imported from a Client Component module`
 * before main() ran, even though all 19 unit tests for the cron route
 * passed. The fix changed `readiness.ts` to import from `@/lib/utils`
 * directly. This test is the regression gate that catches the next
 * script that drifts into the same trap.
 *
 * Strategy: spawn each at-risk script under `tsx` with a scrubbed env
 * (forces it to bail at the missing-env branch within milliseconds, not
 * hit the network or write to DBs). Assert stderr/stdout never contain
 * the canonical server-only error banner. Exit code is intentionally
 * NOT asserted — different scripts have different missing-env failure
 * modes.
 *
 * "At-risk" = imports from `@/`. Pure scripts (no `@/` imports) cannot
 * reach the chain so we skip them, both for speed and to avoid running
 * seed scripts pointlessly.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const scriptsDir = resolve(repoRoot, "scripts");

const allScripts = readdirSync(scriptsDir).filter((f) => f.endsWith(".ts"));
const atRiskScripts = allScripts.filter((f) => {
  const src = readFileSync(resolve(scriptsDir, f), "utf8");
  return /from ["']@\//.test(src);
});

describe("scripts/*.ts — no server-only leak", () => {
  // Sanity: at least one at-risk script must exist for this gate to
  // mean anything. If a future refactor moves all script logic into
  // pure modules, this test silently degrades to a no-op — the
  // assertion below catches that.
  it("has at least one at-risk script to cover", () => {
    expect(atRiskScripts.length).toBeGreaterThan(0);
  });

  it.each(atRiskScripts)(
    "%s is loadable under tsx without a server-only crash",
    (script) => {
      const result = spawnSync("npx", ["tsx", `scripts/${script}`], {
        cwd: repoRoot,
        // Scrubbed env: forces script's missing-env branch to fire
        // immediately, before any module main() can do real work.
        // PATH preserved so npx/tsx resolve.
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
        encoding: "utf8",
        timeout: 60_000,
      });
      const combined = (result.stdout ?? "") + (result.stderr ?? "");

      // The exact banner from node_modules/server-only/index.js. If a
      // future server-only release changes this, update here.
      expect(combined).not.toMatch(
        /This module cannot be imported from a Client Component module/,
      );
      expect(combined).not.toMatch(
        /at .*node_modules\/server-only\/index\.js/,
      );
    },
    90_000,
  );
});
