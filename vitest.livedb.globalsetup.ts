import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";

/**
 * THE LIVE-DB LANE'S PRE-BOOT REFUSALS (Phase 164.9 plan 08).
 *
 * Companion to `vitest.livedb.config.ts`, which holds that lane's four-claim
 * header. Everything here runs ONCE, in vitest's main process, BEFORE a single
 * spec is loaded — which is the only place a refusal can still be a refusal.
 *
 * ⛔ WHY THESE LIVE IN A `globalSetup` AND NOT IN THE CONFIG BODY, recorded
 * because the first draft did the other thing. A config body executes whenever
 * ANY tool enumerates this repo's vitest configs — the dead-code reporter does
 * exactly that — so a throw there turns an unrelated job's output into a
 * confusing error about an absent Supabase stack. Measured on the first run.
 * A `globalSetup` runs only when the lane is actually invoked, so the refusal
 * fires exactly when it means something.
 *
 * ⛔ AND IT IS A THROW, NEVER A SKIP. An absent stack must FAIL this lane. A
 * live-DB corpus that quietly skips is the precise condition ROADMAP criterion
 * 13 exists to end, and this repo has a named tombstone for it — six live-DB
 * cases that skipped silently in every CI shard for months over a function that
 * had been dropped.
 */

const REPO_ROOT = __dirname;

/**
 * ⛔ A path printed into a CI log is PUBLISHED - this repository is public and
 * the Actions log is world-readable. On a developer box an absolute path under
 * the home directory carries the LOCAL USERNAME, so every diagnostic that names
 * a file names it RELATIVE to the repo, or not at all. Same idiom, same phase,
 * as the three `.mjs` gates that carry their own copy of this helper.
 */
const relPrintable = (p: string): string => {
  const r = relative(REPO_ROOT, p);
  return !r || r.startsWith("..") ? `<outside the repository>/${basename(p)}` : r;
};
const RUN_SH = resolve(REPO_ROOT, "scripts/local-stack/run.sh");
const REPO_SUPABASE_DIR = resolve(REPO_ROOT, "supabase");

export const LANE_ENV_PATH = resolve(
  REPO_ROOT,
  "scripts/local-stack/.stack-env",
);

const BOOT_HINT =
  "Boot it with:  bash scripts/local-stack/run.sh up   (then re-run). " +
  "This lane FAILS rather than skips on an absent stack: a live-DB corpus that " +
  "skips silently is the condition ROADMAP criterion 13 exists to end.";

export interface LaneEnv {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

/**
 * T-164.9-08-01 — the production-linked-checkout refusal, ASSERTED not assumed.
 *
 * This checkout's Supabase CLI context is linked to PRODUCTION, and that same
 * directory governs production deploys. So the lane ASKS the stack runner where
 * it would start and refuses hard on this repository's own `supabase/`
 * directory. Asking beats pattern-matching the runner's source: any ordinary
 * re-spelling of the assignment reads as "unwired" to a substring match, which
 * would leave a green check measuring nothing.
 *
 * A failure to ASK is also a refusal. "Could not measure" is not "measured
 * safe", and this is the one control standing between a lane boot and a
 * production-linked directory.
 */
export function assertStackWorkdirIsNotTheRepoSupabaseDir(): void {
  let reported: string;
  try {
    reported = execFileSync("bash", [RUN_SH, "--print-workdir"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
  } catch (err) {
    throw new Error(
      `LIVE-DB LANE REFUSED: could not ask ${RUN_SH} for its resolved workdir ` +
        `(${(err as Error).message}).`,
    );
  }
  if (!reported) {
    throw new Error(
      "LIVE-DB LANE REFUSED: the stack runner reported an EMPTY workdir. An unmeasured " +
        "answer is not a passing answer.",
    );
  }
  const workdir = resolve(REPO_ROOT, reported);
  if (
    workdir === REPO_SUPABASE_DIR ||
    workdir === REPO_ROOT ||
    REPO_SUPABASE_DIR === resolve(workdir, "supabase")
  ) {
    throw new Error(
      `LIVE-DB LANE REFUSED: the stack runner resolves its workdir to ${workdir}, which is ` +
        `this repository's own Supabase context. That context is linked to PRODUCTION in this ` +
        `checkout and it governs production deploys. The lane must start from a derived, ` +
        `throwaway workdir instead. Refusing to boot.`,
    );
  }
}

/**
 * The mode-600 handoff `run.sh up` writes, or `null` when it is absent.
 * ⚠️ `null` is for the CONFIG's benefit only — it populates the lane's env from
 * this and must not throw while a tool is merely enumerating configs. The RUN's
 * refusal is {@link setup} below, which never tolerates a null.
 */
export function readLaneEnvOrNull(): LaneEnv | null {
  if (!existsSync(LANE_ENV_PATH)) return null;
  const raw = readFileSync(LANE_ENV_PATH, "utf8");
  const pick = (key: string): string | null => {
    const m = raw.match(new RegExp(`^${key}="?([^"\\n]*)"?$`, "m"));
    return m && m[1] ? m[1] : null;
  };
  const API_URL = pick("API_URL");
  const ANON_KEY = pick("ANON_KEY");
  const SERVICE_ROLE_KEY = pick("SERVICE_ROLE_KEY");
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) return null;
  return { API_URL, ANON_KEY, SERVICE_ROLE_KEY };
}

/**
 * Re-assert LOCAL-ONLY independently of `run.sh`'s own check, and deliberately
 * duplicated. This lane's corpus creates auth users, api keys, strategies and
 * compute jobs; it must never do that against a database this repo shares with
 * other people's CI, nor against production.
 */
export function assertLocalApiUrl(apiUrl: string): void {
  if (
    !/^http:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(apiUrl) &&
    !/^http:\/\/localhost(:\d+)?(\/|$)/.test(apiUrl)
  ) {
    throw new Error(
      "LIVE-DB LANE REFUSED: the handoff reports a NON-LOCAL API URL. This lane writes real " +
        "rows and is local-only. Refusing to continue.",
    );
  }
}

/** vitest `globalSetup` entry point. */
export function setup(): void {
  assertStackWorkdirIsNotTheRepoSupabaseDir();
  const lane = readLaneEnvOrNull();
  if (!lane) {
    throw new Error(
      `LIVE-DB LANE ABSENT: ${relPrintable(LANE_ENV_PATH)} is missing or incomplete, so the Supabase stack ` +
        `this lane needs is not running (or was torn down mid-write). ${BOOT_HINT}`,
    );
  }
  assertLocalApiUrl(lane.API_URL);
  // ⛔ The credential VALUES are never printed. A guard that quotes what it
  // found is a proof-of-absence that publishes what it proves absent, and this
  // repo has a dated record of that exact mistake.
  console.log(
    `[live-db lane] stack handoff accepted: local API URL, three keys present, ` +
      `workdir is not the repository's own Supabase context.`,
  );
}
