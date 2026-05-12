/**
 * audit-2026-05-07 P97 / G12.A.2 — claim_token leak prevention (mig 117).
 *
 * `compute_jobs.claim_token` is a CAPABILITY TOKEN: any caller that knows
 * the token can mark the row done/failed via the worker fence RPCs. It
 * MUST NOT be exposed to the admin UI or any other client surface — only
 * the worker, which reads it from the row returned by the claim RPC,
 * needs it.
 *
 * The current admin/compute-jobs page uses an explicit select list that
 * doesn't include claim_token, but a future debugger doing
 * `select("*")` against compute_jobs would silently leak the token.
 * This grep gate fails the build if any src/ file selects all columns
 * from compute_jobs.
 *
 * Why this is a real risk (not paranoia):
 * - The fence assumes the token is server-side-only.
 * - With the token in any HTML/JSON response, an authenticated attacker
 *   (or anyone with read access to the admin page) can race the worker
 *   by calling mark_compute_job_done(p_job_id, p_claim_token=stolen).
 * - mark_compute_job_done(..., NULL) is also dangerous (back-compat
 *   skip-fence path) but at least requires authenticated RPC access.
 *
 * The companion C7 fix adds a security warning comment in
 * src/app/(dashboard)/admin/compute-jobs/page.tsx — this test is the
 * mechanical enforcement.
 *
 * NOTE: this is a static-analysis test (no DB). It walks the src/ tree
 * and greps for select("*") / select('*') with compute_jobs context.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.resolve(__dirname, "..");

function walkSrc(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip generated / vendored trees, and the __tests__ tree itself —
      // tests run server-side with admin credentials and never render to
      // a client surface, so a select("*") in a test helper is acceptable
      // (e.g., compute-jobs-audit-2026-05-07-g10b.test.ts uses select("*")
      // to read claim_token and verify the fence). The leak risk is in
      // RUNTIME source: routes, server components, edge functions.
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      if (entry.name === "__tests__") continue;
      walkSrc(full, files);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      // Belt-and-suspenders: skip any *.test.ts even if it lives outside
      // a __tests__ directory.
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
        continue;
      }
      files.push(full);
    }
  }
  return files;
}

describe("audit-2026-05-07 P97 — compute_jobs.claim_token must not leak", () => {
  it("no src/ file selects * from compute_jobs (would leak claim_token)", () => {
    const files = walkSrc(SRC_ROOT);
    const offenders: { file: string; line: number; text: string }[] = [];

    // Pattern: any .from("compute_jobs") call followed within ~12 lines by
    // a .select("*") or .select('*'). 12 lines covers method chaining
    // across line breaks (Supabase client style).
    const COMPUTE_JOBS_RE =
      /\.from\(\s*["']compute_jobs["']\s*\)/;
    const SELECT_STAR_RE = /\.select\(\s*["']\*["']\s*[\),]/;

    for (const file of files) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!COMPUTE_JOBS_RE.test(lines[i])) continue;
        // Look ahead up to 12 lines for a select("*") in the same chain.
        const window = lines.slice(i, Math.min(i + 12, lines.length)).join("\n");
        if (SELECT_STAR_RE.test(window)) {
          offenders.push({
            file: path.relative(SRC_ROOT, file),
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }

    expect(
      offenders,
      [
        "compute_jobs.claim_token would leak from these select(*) calls.",
        "Replace with an explicit column list and OMIT claim_token. See",
        "src/app/(dashboard)/admin/compute-jobs/page.tsx for the pattern.",
        "",
        ...offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`),
      ].join("\n"),
    ).toEqual([]);
  });
});
