import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 164.4.2 plan 08 checkpoint RED → fix (2026-09-23): every job that makes the
 * Supabase CLI PULL an image logs in to ghcr.io first.
 *
 * WHY. `supabase/setup-cli` exports `SUPABASE_INTERNAL_IMAGE_REGISTRY: ghcr.io`, so every
 * image the CLI pulls (the ~13 stack images behind `supabase start`, and the postgres
 * image `supabase db dump` runs `pg_dump` inside) comes from ghcr.io. Until this fix no
 * workflow logged in there, and anonymous GHCR pulls from shared GitHub runners are
 * throttled. At head b45f4ed3 that took down `sql-tests`, `frontend-local-stack` and
 * `frontend-live-db-lane` (CI run 35911761613, "Boot the local-stack lane") and the
 * VAC-04 step of Migration Drift Check (run 35911761546), all with `toomanyrequests`.
 * The CLI reads registry credentials from the docker config file
 * (`internal/utils/docker.go` `GetRegistryAuth`, CLI v2.98.2), so a plain
 * `docker login ghcr.io` before the pull is what makes the pull authenticated.
 *
 * WHAT IT PINS, per job that uses `supabase/setup-cli`:
 *   - the job is classified as PULLING or NOT PULLING by reading its own commands, and
 *     the classification must equal the pinned rosters below EXACTLY — so a new
 *     setup-cli job, or a job that starts pulling, forces a decision here instead of
 *     slipping through (and a broken detector cannot pass vacuously on an empty set);
 *   - a pulling job has a ghcr.io login step BEFORE its first image-pulling step, fed
 *     by the job's own GITHUB_TOKEN over stdin, with no `continue-on-error` and no
 *     `|| true` — a failed login must go red, never degrade into an anonymous pull;
 *   - a pulling job declares its own `permissions:` block that is EXACTLY the
 *     workflow-level block plus `packages: read` — nothing else is widened.
 *
 * ⚠️ WHAT IT DOES NOT PIN: that GitHub actually lifts the throttle for an
 * authenticated pull. Only a SHA-bound CI run of these jobs measures that.
 */

const ROOT = process.cwd();
const WF_DIR = join(ROOT, ".github/workflows");

/** Jobs that make the CLI pull an image. Key: `<workflow file>:<job>`. */
const PULLING_JOBS: Record<string, string> = {
  "ci.yml:frontend-local-stack": "`run.sh up` runs `supabase start` (pulls the stack images)",
  "ci.yml:frontend-live-db-lane": "`run.sh up` runs `supabase start` (pulls the stack images)",
  "ci.yml:sql-tests": "`run.sh up` runs `supabase start` (pulls the stack images)",
  "migration-drift-check.yml:check":
    "VAC-04 runs `supabase db dump`, which pulls supabase/postgres (measured: run 35911761546)",
  "test-restore-from-baseline.yml:restore":
    "the TEST backup runs `supabase db dump`, the same image pull as VAC-04",
};

/**
 * setup-cli jobs deliberately left WITHOUT a login, each with its measured reason.
 * Measured 2026-09-23 as zero `Pulling from` lines in a green run that executed the
 * named commands.
 */
const NON_PULLING_JOBS: Record<string, string> = {
  "migration-policy.yml:policy":
    "`supabase link` + `supabase db query --linked` only; run 35812108059 printed `Remote tip:` with no pull",
  "prod-prober.yml:probe": "`supabase link` only; run 35899950289 has no pull",
  "supabase-migrate.yml:plan": "`link` + `db push --dry-run` only; run 35819065230 has no pull",
  "supabase-migrate.yml:apply-test":
    "`db push --db-url` + `migration list` only; run 35819065230 applied a migration with no pull",
  "supabase-migrate.yml:apply": "`link` + `db push` + `migration list` only; run 35819065230 has no pull",
};

/**
 * A command that makes the Supabase CLI start a container, and therefore pull its image
 * when it is not cached. Matched only where a command begins — a line start, after a
 * `run:` key, or inside `$(` — so an `echo` that merely QUOTES one does not count.
 */
const PULL_CMD_RE =
  /(?:^|\$\(\s*|run:\s*)(?:bash\s+scripts\/local-stack\/run\.sh\s+up\b|supabase\s+(?:start\b|db\s+(?:start|dump|diff|reset|lint)\b|test\s+db\b|gen\s+types\b|functions\s+serve\b))/;

type Step = { index: number; code: string[]; raw: string[] };
type Job = { key: string; lines: string[]; steps: Step[] };

const indentOf = (l: string) => l.length - l.trimStart().length;
const isComment = (l: string) => l.trimStart().startsWith("#");
const isBlank = (l: string) => l.trim() === "";

function parseJobs(yml: string): Job[] {
  const lines = yml.split("\n");
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt === -1) return [];
  const heads: { name: string; at: number }[] = [];
  for (let i = jobsAt + 1; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
    if (m) heads.push({ name: m[1], at: i });
  }
  return heads.map((h, n) => {
    const body = lines.slice(h.at + 1, n + 1 < heads.length ? heads[n + 1].at : lines.length);
    return { key: h.name, lines: body, steps: parseSteps(body) };
  });
}

function parseSteps(body: string[]): Step[] {
  const at = body.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (at === -1) return [];
  const steps: Step[] = [];
  let cur: string[] | null = null;
  for (const line of body.slice(at + 1)) {
    if (!isBlank(line) && !isComment(line) && indentOf(line) <= 4) break;
    if (/^ {6}- /.test(line)) {
      cur = [line];
      steps.push({ index: steps.length, code: [], raw: cur });
    } else if (cur) {
      cur.push(line);
    }
  }
  for (const s of steps) s.code = s.raw.filter((l) => !isBlank(l) && !isComment(l));
  return steps;
}

/** `key: value` pairs of a permissions block starting at `at`, children at `childIndent`. */
function readPermissions(lines: string[], at: number, childIndent: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines.slice(at + 1)) {
    if (isBlank(line) || isComment(line)) continue;
    if (indentOf(line) !== childIndent) break;
    const m = line.trim().match(/^([a-z-]+):\s*(read|write|none)\s*(?:#.*)?$/);
    if (!m) break;
    out[m[1]] = m[2];
  }
  return out;
}

const usesSetupCli = (s: Step) => s.code.some((l) => /uses:\s*supabase\/setup-cli@/.test(l));
const pullsImage = (s: Step) => s.code.some((l) => PULL_CMD_RE.test(l.trim()));
const isGhcrLogin = (s: Step) => s.code.some((l) => /docker\s+login\s+ghcr\.io\b/.test(l));

type Found = { key: string; wfYml: string; wfLines: string[]; job: Job };

function setupCliJobs(): Found[] {
  const out: Found[] = [];
  for (const file of readdirSync(WF_DIR).filter((f) => f.endsWith(".yml")).sort()) {
    const wfYml = readFileSync(join(WF_DIR, file), "utf8");
    for (const job of parseJobs(wfYml)) {
      if (job.steps.some(usesSetupCli)) {
        out.push({ key: `${file}:${job.key}`, wfYml, wfLines: wfYml.split("\n"), job });
      }
    }
  }
  return out;
}

const FOUND = setupCliJobs();

describe("ghcr.io login precedes every Supabase CLI image pull", () => {
  it("classifies every supabase/setup-cli job exactly as the pinned rosters say", () => {
    const pulling = FOUND.filter((f) => f.job.steps.some(pullsImage)).map((f) => f.key).sort();
    const notPulling = FOUND.filter((f) => !f.job.steps.some(pullsImage)).map((f) => f.key).sort();
    expect(
      pulling,
      "the set of setup-cli jobs that pull an image moved — decide whether each one needs the ghcr.io login, then update PULLING_JOBS / NON_PULLING_JOBS with the measured reason",
    ).toEqual(Object.keys(PULLING_JOBS).sort());
    expect(notPulling).toEqual(Object.keys(NON_PULLING_JOBS).sort());
  });

  for (const key of Object.keys(PULLING_JOBS)) {
    describe(key, () => {
      const found = FOUND.find((f) => f.key === key);

      it("logs in to ghcr.io with the job's own GITHUB_TOKEN BEFORE its first image pull, and a failed login goes red", () => {
        expect(found, `${key} no longer exists or no longer uses supabase/setup-cli`).toBeDefined();
        const steps = found!.job.steps;
        const firstPull = steps.find(pullsImage);
        expect(firstPull, `${key}: no image-pulling step found`).toBeDefined();
        const login = steps.find(isGhcrLogin);
        expect(login, `${key}: has NO ghcr.io login step — its CLI image pull is anonymous and gets throttled`).toBeDefined();
        expect(
          login!.index,
          `${key}: the ghcr.io login (step ${login!.index}) runs AFTER the first image pull (step ${firstPull!.index})`,
        ).toBeLessThan(firstPull!.index);

        const text = login!.code.join("\n");
        expect(text, `${key}: login must read the token from stdin`).toMatch(/--password-stdin/);
        expect(text, `${key}: login must use the job's own token`).toMatch(
          /\$\{\{\s*(?:github\.token|secrets\.GITHUB_TOKEN)\s*\}\}/,
        );
        expect(text, `${key}: login user must be github.actor`).toMatch(/\$\{\{\s*github\.actor\s*\}\}/);
        expect(text, `${key}: a failed login must fail the job, not continue`).not.toMatch(/continue-on-error/);
        expect(text, `${key}: a failed login must not be swallowed`).not.toMatch(/\|\|\s*(?:true|:)\b/);
        expect(text, `${key}: login script must run under set -euo pipefail`).toMatch(/set -euo pipefail/);
      });

      it("declares packages: read in its own permissions block, and widens nothing else", () => {
        expect(found).toBeDefined();
        const wfAt = found!.wfLines.findIndex((l) => /^permissions:\s*$/.test(l));
        expect(wfAt, `${key}: workflow has no top-level permissions block`).toBeGreaterThan(-1);
        const wfPerms = readPermissions(found!.wfLines, wfAt, 2);
        const jobAt = found!.job.lines.findIndex((l) => /^ {4}permissions:\s*$/.test(l));
        expect(
          jobAt,
          `${key}: has no job-level permissions block — its GITHUB_TOKEN lacks packages: read`,
        ).toBeGreaterThan(-1);
        const jobPerms = readPermissions(found!.job.lines, jobAt, 6);
        expect(jobPerms, `${key}: job permissions must be the workflow's plus packages: read, nothing more`).toEqual({
          ...wfPerms,
          packages: "read",
        });
      });
    });
  }
});
