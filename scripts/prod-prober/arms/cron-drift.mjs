/**
 * CRON-DRIFT-01 arm — "is PROD's `cron.job` still the configuration we agreed
 * it should be, and does any of it carry a secret?" (phase 164.1 plan 03).
 *
 * ============================================================================
 * THE MEASURED OUTAGE THIS ARM EXISTS FOR
 * ============================================================================
 * PROD `cron.job` jobid 1 carried a hardcoded URL and an INLINE SERVICE KEY in
 * its `command` text for MONTHS, until it was re-scheduled by hand onto a `DO`
 * block reading `vault.decrypted_secrets` on 2026-09-01. Nothing in this
 * repository ever compared PROD's cron configuration to anything, so neither
 * the inline key nor the drift was visible to any gate.
 *
 * ============================================================================
 * ⛔ THE ORACLE IS A COMMITTED MANIFEST, NOT THE MIGRATIONS (D-13)
 * ============================================================================
 * Both scheduling migrations build the command out of
 * `current_setting('app.analytics_service_url' / 'app.analytics_service_key')`.
 * Setting those GUCs needs `ALTER DATABASE … SET` on a placeholder GUC, which
 * returns **42501 on Supabase** — so that design COULD NEVER HAVE RUN HERE.
 * Deriving the oracle from `supabase/migrations/**` would therefore enshrine an
 * UNRUNNABLE design as the standard PROD is judged against, and every real
 * production configuration would read as drift forever.
 *
 * The oracle is instead a file — `scripts/prod-prober/cron-manifest.json` —
 * CAPTURED from PROD read-only through `--capture-manifest`, reviewed by a
 * human, and committed. What makes it an oracle rather than a photograph is
 * that a capture is REFUSED unless every row passes the ten secret-hygiene
 * rules below: the manifest records the ACHIEVABLE configuration, never
 * "whatever PROD happens to have".
 *
 * ============================================================================
 * ⛔ THE REPOSITORY IS PUBLIC AND `.planning/` IS TRACKED (T-164.1-10)
 * ============================================================================
 * The manifest is committed. The drift diff is printed into a world-readable
 * Actions log. And the rows beyond jobid 1 have NEVER BEEN READ BY ANYONE
 * (RESEARCH Finding 3) — nobody can vouch for what is in fourteen other cron
 * commands. That is why there are TEN hygiene rules rather than the three
 * RESEARCH proposed, why they run on BOTH sides of the comparison, and why a
 * PROD command failing them is `cron-secret-in-command` EVEN WHEN ITS SHA
 * MATCHES THE MANIFEST.
 *
 * Every rule ships with a RED fixture row in `fixtures/cron-drift/hygiene-red.json`
 * proving it fires and a GREEN control in `hygiene-green.json` proving the
 * ACHIEVABLE shapes do not. A rule that cannot fire IS the defect; a rule that
 * fires on the shape we want people to use is worse than none, because it
 * trains the reader to ignore it.
 *
 * ── THE REVIEWER'S WITHHOLD PROCEDURE ────────────────────────────────────────
 * `command` is OPTIONAL per manifest row. To publish a row SHA-ONLY, delete its
 * `command` key and add:
 *
 *     "command_withheld": true,
 *     "withheld_reason": "<why this text is not published>"
 *
 * The sha stays machine-produced by `captureManifest`, so this is a REDACTION,
 * not authorship — a reviewer can hide text they do not want in a public repo
 * without being able to invent an oracle. A sha-only row detects drift exactly
 * as a full row does (proven by `manifest-sha-only.json`); the arm simply never
 * prints a diff for it and says so.
 *
 * ── PLAUSIBILITY LIST, EXPLICITLY NOT THE ORACLE ────────────────────────────
 * `supabase/migrations/**` schedules these fifteen jobnames. Whether each
 * EXISTS on PROD is unknown — the GUC-gated skips above prove migrations and
 * PROD can disagree. Use this only as a capture reviewer's checklist:
 *   match_engine_cron, audit_log_hot_to_cold, audit_log_cold_purge,
 *   retention_notification_dispatches, retention_compute_jobs_done,
 *   retention_compute_jobs_failed, api_key_rotation_reminder,
 *   compute_bridge_outcome_deltas, poll-allocator-positions,
 *   refresh-allocator-equity, resend_message_correlation_retention_90d,
 *   derive-allocator-key-dailies, retention_compute_jobs_orphaned_running,
 *   reap_strategy_analytics_stuck_computing, reconcile_dropped_enqueue_sweep.
 *
 * ⛔ NOTHING IN THIS FILE READS `process`.env, WRITES TO PROD, OR ADDS A
 * MIGRATION. Both exported `*_SQL` constants are single SELECTs, asserted
 * read-only by a self-test scenario.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The committed oracle. NOT written by plan 03 — plan 06 captures it from PROD
 * through the workflow's capture-manifest mode. Until it exists the live drift
 * arm reports `manifest-invalid`, which is the honest state: a comparison with
 * no oracle is not a comparison.
 */
export const MANIFEST_PATH = resolve(HERE, "..", "cron-manifest.json");

/** Bumping either of these invalidates every committed sha. Reviewed edit only. */
export const MANIFEST_SCHEMA_VERSION = 1;
export const NORMALIZATION = "ws-collapse-v1";

/**
 * The hand-set `COMMENT ON DATABASE` marker CLAUDE.md requires before trusting
 * ANY reading against a Supabase project: `current_database()` is `postgres` on
 * both PROD and TEST and proves nothing. A NULL marker is a `measure-fail`, not
 * a pass — an unlabelled database is one whose identity was never established.
 */
export const DB_MARKER_SQL = `SELECT shobj_description(oid, 'pg_database') AS marker FROM pg_database WHERE datname = current_database()`;

/**
 * ALL rows of `cron.job` (D-14: an unexpected EXTRA job is drift too), and only
 * the columns the comparison or the report needs. `nodename` / `nodeport` are
 * deliberately absent.
 */
export const CRON_JOB_SQL = `SELECT jobid, jobname, schedule, active, database, username, command FROM cron.job ORDER BY jobid`;

/**
 * ⚠️ THIS QUERY NEEDS NON-DEFAULT SEPARATORS, AND THAT IS NOT A STYLE CHOICE.
 * `cron.job.command` is frequently a multi-line `DO $$ … $$` block containing
 * both newlines and (in `jsonb_build_object` argument lists) tabs. With psql's
 * default tab field / newline record separators such a command DESYNCS the
 * parser: one job's body silently becomes several malformed rows, and a drift
 * arm that mis-parses PROD is worse than one that does not run.
 *
 * ASCII 0x1F (unit separator) and 0x1E (record separator) exist for exactly
 * this and cannot occur in SQL source text.
 */
export const CRON_JOB_SEPARATORS = { fieldSep: "\u001f", recordSep: "\u001e" };

export const REMEDIES = {
  "cron-drift":
    "PROD cron.job no longer matches the committed manifest. Read BOTH recorded readings printed with the defect and decide which side moved: either re-schedule PROD from the manifest, or run the workflow in capture-manifest mode, review the produced artifact by hand, and commit it. cron.job has no updated_at, so the captured_at date and the two shas are the only evidence of ordering that exists.",
  "cron-secret-in-command":
    "A cron.job command carries credential-shaped text. Treat the named secret as EXPOSED and rotate it first (the repository, its Actions logs and this manifest are all public), then re-schedule that job onto a body that resolves the secret from vault.decrypted_secrets at execution time, then re-capture the manifest. A sha that matches the manifest does NOT clear this — it means the manifest was captured from a state that already carried it.",
  "manifest-invalid":
    "The cron oracle is missing, unparsable, or does not describe a usable configuration, so no comparison happened at all. Run the prod-prober workflow in capture-manifest mode, review every row of the produced artifact by hand (withhold any row you do not want published, per the withhold procedure in arms/cron-drift.mjs), and commit it to scripts/prod-prober/cron-manifest.json.",
};

// ---------------------------------------------------------------------------
// Normalization and hashing
// ---------------------------------------------------------------------------

/**
 * `ws-collapse-v1`: CRLF → LF, trim, every whitespace run → one space.
 *
 * Two commands whose normalized text is byte-equal are NOT drift — an operator
 * re-indenting a DO block, or a client that round-tripped it through CRLF, has
 * changed nothing that runs. One differing non-whitespace byte IS drift.
 */
export function normalizeCommand(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .replace(/\s+/g, " ");
}

/** sha256 over the UTF-8 bytes of the NORMALIZED text. */
export function sha256Hex(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Secret hygiene — ten rules, each with a red fixture row and a green control
// ---------------------------------------------------------------------------

/**
 * The rule ids, EXPORTED so the self-test can assert the red-fixture set equals
 * this list member for member. A rule added without a red row, or a red row
 * whose rule never fires, is a SELF-TEST FAIL rather than a quiet gap.
 */
export const HYGIENE_RULE_IDS = [
  "x-service-key-literal",
  "app-guc",
  "vault-absent",
  "pg-password",
  "authorization-literal",
  "bearer-literal",
  "apikey-literal",
  "service-role",
  "jwt-shape",
  "long-literal-in-headers",
];

/**
 * A quoted literal shorter than this after a header name is a CONSTANT, not a
 * credential: `'Bearer '` (7) and `'application/json'` (16) are the shapes the
 * achievable configuration uses, and flagging them would train the reader to
 * ignore this whole class.
 */
const HEADER_LITERAL_MIN = 16;

/** A quoted literal at least this long inside a header argument list is a credential. */
const HEADERS_LITERAL_MAX = 32;

/** Walk to the `)` matching `text[openIdx]`, skipping over quoted literals. */
function matchingParen(text, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const c = text[i];
    if (c === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2;
            continue;
          }
          break;
        }
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

/** Every single-quoted literal in `[from, to)`, with `''` treated as an escape. */
function singleQuotedLiterals(text, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    if (text[i] !== "'") {
      i += 1;
      continue;
    }
    let j = i + 1;
    let content = "";
    while (j < to) {
      if (text[j] === "'") {
        if (text[j + 1] === "'") {
          content += "'";
          j += 2;
          continue;
        }
        break;
      }
      content += text[j];
      j += 1;
    }
    out.push({ content, start: i, end: j });
    i = j + 1;
  }
  return out;
}

const escapeRe = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * `'<header>' , '<literal>'` where the literal is long enough to BE a
 * credential.
 *
 * ⚠️ The length test is what separates the red shape from the green one, and it
 * is load-bearing rather than defensive. `'Authorization', 'Bearer ' || <expr>`
 * — the achievable Vault-backed shape — closes its quote immediately after the
 * space and concatenates; a bare `/Authorization'\s*,\s*'/` would fire on it,
 * i.e. on exactly the configuration this arm exists to endorse.
 */
function headerCarriesLiteral(text, headerName) {
  const re = new RegExp(`'${escapeRe(headerName)}'\\s*,\\s*'`, "gi");
  for (const m of text.matchAll(re)) {
    const quoteIdx = m.index + m[0].length - 1;
    const first = singleQuotedLiterals(text, quoteIdx, text.length)[0];
    if (first && first.content.length >= HEADER_LITERAL_MIN) return true;
  }
  return false;
}

/** The argument-list regions a header value can hide in. */
function headerRegions(text) {
  const regions = [];
  for (const m of text.matchAll(/jsonb_build_object\s*\(/gi)) {
    const open = m.index + m[0].length - 1;
    const close = matchingParen(text, open);
    regions.push([open + 1, close === -1 ? text.length : close]);
  }
  for (const m of text.matchAll(/headers\s*:=/gi)) {
    const from = m.index + m[0].length;
    const semi = text.indexOf(";", from);
    const paren = text.indexOf("(", from);
    if (paren !== -1 && (semi === -1 || paren < semi)) {
      const close = matchingParen(text, paren);
      regions.push([paren + 1, close === -1 ? text.length : close]);
    } else {
      // `headers := '{"X-Service-Key":"…"}'::jsonb` — no call to walk into.
      regions.push([from, semi === -1 ? text.length : semi]);
    }
  }
  return regions;
}

/**
 * SQL comments removed, so a rule can test what the database would EXECUTE
 * rather than what the text merely says. Line comments (`-- …`) and block
 * comments are both stripped.
 *
 * ⚠️ This is a TEXT strip, not a parser: a `--` inside a string literal is
 * removed with everything after it on that line. That direction is safe for
 * the only rule that uses it — `vault-absent` fires when the needle is
 * ABSENT, so over-stripping can only produce a FALSE ALARM, never a false
 * clean. Do not reuse it for a rule that fires on PRESENCE without first
 * making it quote-aware.
 *
 * @param {string} t
 * @returns {string}
 */
export function stripSqlComments(t) {
  return String(t ?? "").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * Ten rules. Returns one sentence per violation, each prefixed with a stable
 * `[rule-id]`.
 *
 * ⛔ A VIOLATION NEVER QUOTES THE OFFENDING TEXT. It names the rule and the job.
 * A hygiene report that printed the credential it found would be the leak it
 * exists to prevent, and it would print it into a public Actions log.
 *
 * @param {string} jobname
 * @param {string} command  the RAW command text (normalization does not change
 *        any of these judgements, and running on raw text keeps the rules
 *        readable against what an operator actually sees in `cron.job`).
 *        ⚠️ ONE rule departs from that: `vault-absent` tests
 *        COMMENT-STRIPPED text, because a needle that must be PRESENT is
 *        otherwise satisfied by a comment naming it. See CR-03.
 * @returns {string[]}
 */
export function hygieneViolations(jobname, command) {
  const text = String(command ?? "");
  const name = String(jobname ?? "");
  const out = [];
  const say = (id, sentence) => out.push(`[${id}] ${sentence}`);

  if (headerCarriesLiteral(text, "X-Service-Key")) {
    say(
      "x-service-key-literal",
      `job ${name} passes an X-Service-Key header as an inline quoted literal — this is the exact pre-2026-09-01 shape that kept a live analytics key inside cron.job.command for months. Resolve it from vault.decrypted_secrets at execution time instead.`,
    );
  }
  if (/current_setting\s*\(\s*'app\./i.test(text)) {
    say(
      "app-guc",
      `job ${name} reads a current_setting('app.…') GUC. Setting those needs ALTER DATABASE … SET on a placeholder GUC, which returns 42501 on Supabase — a job carrying this design is not the achievable configuration and cannot be the standard PROD is judged against.`,
    );
  }
  // ⛔ Tested against COMMENT-STRIPPED text. A substring test over raw command
  // text is satisfied by `-- resolves from vault.decrypted_secrets`, which is
  // a grep matching its own comment — the named anti-vacuity shape, and it
  // returned CLEAN on a command inlining a live key (CR-03, 2026-09-10).
  if (name === "match_engine_cron" && !stripSqlComments(text).includes("vault.decrypted_secrets")) {
    say(
      "vault-absent",
      `job ${name} does not read vault.decrypted_secrets. The achievable configuration resolves its key from Vault at execution time, so a command without it is obtaining the key some other way — and the only other ways this project has used put it in the command text.`,
    );
  }
  if (/PGPASSWORD/i.test(text) || /password\s*=/i.test(text)) {
    say(
      "pg-password",
      `job ${name} carries a database password assignment (PGPASSWORD or password=). A cron command should never hold connection credentials in its text.`,
    );
  }
  if (headerCarriesLiteral(text, "Authorization")) {
    say(
      "authorization-literal",
      `job ${name} passes an Authorization header as an inline quoted literal long enough to be a credential.`,
    );
  }
  if (/'Bearer\s+[A-Za-z0-9._-]{8,}/i.test(text)) {
    say(
      "bearer-literal",
      `job ${name} carries a Bearer token that continues INSIDE its own quotes — the achievable shape closes the quote right after the space ('Bearer ' || <expr>) and does not match this.`,
    );
  }
  if (headerCarriesLiteral(text, "apikey")) {
    say(
      "apikey-literal",
      `job ${name} passes an apikey header as an inline quoted literal long enough to be a credential.`,
    );
  }
  if (/service_role/i.test(text)) {
    say(
      "service-role",
      `job ${name} names service_role. A cron command referencing the service role is either carrying a service-role key or escalating to it; both are findings.`,
    );
  }
  if (/eyJ[A-Za-z0-9_-]{20,}/.test(text)) {
    say(
      "jwt-shape",
      `job ${name} contains a JWT-shaped literal (an eyJ… header segment). This is the shape Supabase's own pg_cron → pg_net documentation puts directly in headers, which is how it reaches production by copy-paste.`,
    );
  }
  for (const [from, to] of headerRegions(text)) {
    const long = singleQuotedLiterals(text, from, to).find((l) => l.content.length >= HEADERS_LITERAL_MAX);
    if (long) {
      say(
        "long-literal-in-headers",
        `job ${name} passes a quoted literal of ${HEADERS_LITERAL_MAX}+ characters inside a header argument list. Header constants are short ('application/json' is 16); anything that long is a value, and a value in a header is a credential.`,
      );
      break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Parse psql `-At -F <US> -R <RS>` output into `cron.job` row objects. */
export function parseCronJobRows(stdout) {
  const out = [];
  for (const record of String(stdout || "").split(CRON_JOB_SEPARATORS.recordSep)) {
    const rec = record.replace(/^[\r\n]+/, "");
    if (rec.trim().length === 0) continue;
    const f = rec.split(CRON_JOB_SEPARATORS.fieldSep);
    if (f.length < 7) continue;
    out.push({
      jobid: f[0].trim(),
      jobname: f[1].trim(),
      schedule: f[2].trim(),
      active: f[3].trim() === "t",
      database: f[4].trim(),
      username: f[5].trim(),
      command: f[6],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The comparison — PURE (D-13, D-14, D-15)
// ---------------------------------------------------------------------------

/**
 * D-15's two readings, printed VERBATIM on every drift defect.
 *
 * `cron.job` has no `updated_at`. Nothing in the database can say which side
 * moved, so the honest report is BOTH readings with the remedy for each — not a
 * guess dressed as a finding. They are literal sentences in this file rather
 * than assembled at the call site so that the defect row, the workflow summary
 * and the auto-issue body cannot drift apart.
 */
const READING_1 = "reading 1: PROD moved after the capture — remedy: re-schedule PROD from the manifest";
const READING_2 =
  "reading 2: the manifest was updated ahead of PROD — remedy: run the workflow in capture-manifest mode, review the artifact, commit it";

const withReadings = (headline) => `${headline}\n      ${READING_1}\n      ${READING_2}`;

/**
 * @param {object|null} manifest   parsed `cron-manifest.json` (null when absent/unparsable)
 * @param {Array<object>} prodRows from `parseCronJobRows`
 * @returns {{defects: Array<{kind:string, subject:string|null, detail:string}>, lines: string[]}}
 */
export function compareManifest(manifest, prodRows, opts = {}) {
  const defects = [];
  const lines = [];
  const drift = (subject, headline) => defects.push({ kind: "cron-drift", subject, detail: withReadings(headline) });

  // -------------------------------------------------------------------------
  // (1) Validate the ORACLE first. Comparing against an invalid oracle would
  //     produce confident nonsense — and "no manifest" must never read as "no
  //     drift", which is the whole SKIP-01 shape this phase exists to remove.
  // -------------------------------------------------------------------------
  const invalid = (why) => {
    defects.push({ kind: "manifest-invalid", subject: "cron-manifest.json", detail: why });
    return { defects, lines };
  };

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return invalid(
      "the cron manifest is missing or is not a JSON object, so NO comparison happened. An absent oracle is not the absence of drift.",
    );
  }
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) {
    return invalid(
      `the cron manifest declares schema_version ${JSON.stringify(manifest.schema_version)}; this arm reads ${MANIFEST_SCHEMA_VERSION}. Every committed sha depends on the schema, so a mismatch is not something to compare through.`,
    );
  }
  if (manifest.normalization !== NORMALIZATION) {
    return invalid(
      `the cron manifest declares normalization ${JSON.stringify(manifest.normalization)}; this arm computes ${NORMALIZATION}. Two different normalizations produce two different shas for identical text.`,
    );
  }
  if (!Array.isArray(manifest.jobs) || manifest.jobs.length === 0) {
    return invalid("the cron manifest lists no jobs. An empty oracle agrees with every PROD state, which is not a comparison.");
  }
  for (const row of manifest.jobs) {
    if (!row || typeof row.jobname !== "string" || row.jobname.length === 0) {
      return invalid("a cron manifest row has no jobname; the comparison is keyed by jobname.");
    }
    if (typeof row.command_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.command_sha256)) {
      return invalid(
        `cron manifest row ${row.jobname} has no valid command_sha256. The sha is what the comparison uses, so a row without one cannot detect drift at all.`,
      );
    }
    if (typeof row.command !== "string") {
      if (row.command_withheld !== true || typeof row.withheld_reason !== "string" || row.withheld_reason.trim().length === 0) {
        return invalid(
          `cron manifest row ${row.jobname} carries neither a command nor a REVIEWED withholding (command_withheld: true plus a non-empty withheld_reason). A row that merely lost its text is indistinguishable from one a reviewer deliberately redacted, and the two mean opposite things.`,
        );
      }
    }
    // ⛔ BIND THE TEXT TO ITS OWN SHA. Nothing re-derived this until
    // 2026-09-10, so the two fields floated free after capture: a hand-cleaned
    // `command` beside a sha still matching a DIRTY prod command reported
    // clean on the manifest side and printed a diff whose "manifest" half was
    // never the text that was compared. The docstring's promise that a
    // reviewer "cannot invent an oracle" was true of the withhold path only
    // (WR-11).
    if (typeof row.command === "string") {
      const derived = sha256Hex(normalizeCommand(row.command));
      if (derived !== row.command_sha256) {
        return invalid(
          `cron manifest row ${row.jobname} carries a command whose own sha (${derived.slice(0, 12)}) is not the command_sha256 it publishes (${String(row.command_sha256).slice(0, 12)}). The two fields describe different text, so the printed diff and the manifest-side hygiene scan would be about a command that was never captured. Re-capture rather than hand-editing; to hide text, use the withhold procedure.`,
        );
      }
    }
    // ⛔ The comparison below reads `active` through Boolean(), and
    // Boolean(undefined) is `false`. A row that merely OMITS the flag would
    // therefore AGREE with a deactivated PROD job — a job that produces no
    // run rows at all, which is quieter than the hourly 401 this arm exists
    // for. The oracle is a hand-reviewed file by design, so the omission is
    // one hand-edit away and must be refused rather than trusted.
    if (typeof row.active !== "boolean") {
      return invalid(
        `cron manifest row ${row.jobname} has no boolean \`active\`. Boolean(undefined) is false, so an omitted flag would silently AGREE with a deactivated PROD job — the quietest form of the outage this arm exists for.`,
      );
    }
    if (typeof row.schedule !== "string" || row.schedule.trim().length === 0) {
      return invalid(`cron manifest row ${row.jobname} has no schedule, so its cadence cannot be compared against PROD at all.`);
    }
    // `username` is the pg_cron column that decides WHICH ROLE the command
    // executes as, and `database` which database it runs in. Both are captured
    // on every row; both are compared below; neither may be absent.
    for (const field of ["username", "database"]) {
      if (typeof row[field] !== "string" || row[field].trim().length === 0) {
        return invalid(`cron manifest row ${row.jobname} has no ${field}. It is captured on every row and compared below, so an absent one would make that comparison vacuous.`);
      }
    }
  }
  if (!manifest.jobs.some((j) => j.jobname === "match_engine_cron")) {
    return invalid(
      "the cron manifest has no match_engine_cron entry. That is jobid 1 — the job every measured outage in this phase came from — and an oracle that does not describe it cannot detect its disappearance.",
    );
  }

  const capturedAt = manifest.captured_at || "<unknown>";
  const marker = manifest.database_marker || "<unset>";

  // -------------------------------------------------------------------------
  // (1b) WHICH DATABASE PRODUCED THIS READING? `run()` reads the hand-set
  //      COMMENT ON DATABASE marker because current_database() is `postgres`
  //      on every Supabase project and proves nothing — but until 2026-09-10
  //      that value was only null-checked and logged, never compared to the
  //      marker the ORACLE was captured from. So a run aimed at another
  //      project would compare ITS cron.job against PROD's oracle and stamp
  //      every line with PROD's marker: a provenance the report never
  //      verified. Two different databases is not drift, it is a void run.
  // -------------------------------------------------------------------------
  if (opts.liveMarker !== undefined && String(opts.liveMarker) !== String(manifest.database_marker ?? "")) {
    defects.push({
      kind: "measure-fail",
      subject: "database marker",
      detail:
        `the cron oracle was captured from a database marked ${JSON.stringify(manifest.database_marker ?? null)}, ` +
        `but this reading came from one marked ${JSON.stringify(String(opts.liveMarker))}. Two different databases were compared, ` +
        `so NO statement about drift can be made from this run.`,
    });
    return { defects, lines };
  }

  // -------------------------------------------------------------------------
  // (2) Hygiene on BOTH sides, INDEPENDENTLY of equality. A PROD command that
  //     matches the manifest byte for byte and still carries an inline key is
  //     STILL a defect — that is what makes the oracle "achievable" rather than
  //     "whatever PROD has".
  // -------------------------------------------------------------------------
  const manifestHygiene = new Map();
  for (const row of manifest.jobs) {
    if (typeof row.command !== "string") continue; // a withheld row was read by a human at capture time
    const v = hygieneViolations(row.jobname, row.command);
    manifestHygiene.set(row.jobname, v);
    if (v.length > 0) {
      defects.push({
        kind: "cron-secret-in-command",
        subject: `manifest:${row.jobname}`,
        detail: `the COMMITTED manifest row for ${row.jobname} fails ${v.length} hygiene rule(s): ${v.join(" ")}`,
      });
    }
  }
  const prodHygiene = new Map();
  for (const row of prodRows) {
    const v = hygieneViolations(row.jobname, row.command);
    prodHygiene.set(row.jobname, v);
    if (v.length > 0) {
      defects.push({
        kind: "cron-secret-in-command",
        subject: `prod:${row.jobname}`,
        detail: `the PROD cron.job row for ${row.jobname} fails ${v.length} hygiene rule(s): ${v.join(" ")}`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // (3) Adjacency: zero rows and duplicates, before any set arithmetic.
  // -------------------------------------------------------------------------
  if (prodRows.length === 0) {
    drift(
      "cron.job",
      `cron-drift: PROD cron.job returned zero rows; the manifest has ${manifest.jobs.length} job(s). Every scheduled job has vanished — this is the loudest possible drift, not "no drift".`,
    );
    return { defects, lines };
  }

  const seen = new Set();
  const duplicates = new Set();
  for (const row of prodRows) {
    if (seen.has(row.jobname)) duplicates.add(row.jobname);
    seen.add(row.jobname);
  }
  for (const name of duplicates) {
    drift(
      name,
      `cron-drift: duplicate jobname ${name} in PROD cron.job. The comparison is keyed by jobname, so a duplicate means one of the two rows is invisible to every check — including this one.`,
    );
  }

  // -------------------------------------------------------------------------
  // (4) Set equality on jobname, then per-job fields. Order is irrelevant by
  //     construction — the comparison is a map lookup, never a positional one.
  // -------------------------------------------------------------------------
  const manifestByName = new Map(manifest.jobs.map((j) => [j.jobname, j]));
  const prodByName = new Map(prodRows.map((r) => [r.jobname, r]));

  for (const name of prodByName.keys()) {
    if (!manifestByName.has(name)) {
      drift(
        name,
        `cron-drift: unexpected job ${name} in PROD (it is not in the manifest at all). An EXTRA job is drift too — nobody reviewed what it runs.`,
      );
    }
  }
  for (const name of manifestByName.keys()) {
    if (!prodByName.has(name)) {
      drift(name, `cron-drift: job ${name} missing from PROD (the manifest has it, cron.job does not).`);
    }
  }

  let differing = 0;
  for (const [name, m] of manifestByName) {
    const p = prodByName.get(name);
    if (!p) continue;

    lines.push(`cron-drift: ${name} jobid ${p.jobid} (manifest ${m.jobid === undefined ? "-" : m.jobid})`);

    const changed = [];
    if (String(m.schedule ?? "").trim() !== String(p.schedule ?? "").trim()) changed.push("schedule");
    if (Boolean(m.active) !== Boolean(p.active)) changed.push("active");
    // `username` decides which ROLE the command executes as and `database`
    // which database it runs in — both are captured on every manifest row, and
    // until 2026-09-10 neither was ever tested, so a job repointed to a more
    // privileged role was not drift to this arm (CR-01).
    if (String(m.username ?? "").trim() !== String(p.username ?? "").trim()) changed.push("username");
    if (String(m.database ?? "").trim() !== String(p.database ?? "").trim()) changed.push("database");
    // ⛔ `jobid` is PRINTED above and deliberately NOT compared, and that is a
    // decision rather than the oversight CR-01 named. It is pg_cron's
    // surrogate key: it carries no configuration meaning, it changes on any
    // legitimate unschedule/reschedule, and every semantically meaningful
    // field it could stand proxy for (schedule, command, username, database,
    // active) is already compared beside it. MEASURED 2026-09-10: comparing it
    // made `prod-duplicate-jobname.json` report TWO cron-drift defects — the
    // duplicate, and a jobid change that is merely that duplicate's
    // consequence — which would have cost an existing isolation control to
    // accommodate. Printing it stays useful: an operator reading a drift line
    // wants the id to run `SELECT * FROM cron.job WHERE jobid = …`.

    const prodSha = sha256Hex(normalizeCommand(p.command));
    if (m.command_sha256 !== prodSha) changed.push("command");

    if (changed.length === 0) continue;
    differing += 1;

    const withheld = typeof m.command !== "string";
    const manifestDirty = (manifestHygiene.get(name) || []).length > 0;
    const prodDirty = (prodHygiene.get(name) || []).length > 0;

    let headline =
      `cron-drift: manifest captured ${capturedAt} (marker ${marker}) sha ${m.command_sha256} — ` +
      `PROD now sha ${prodSha}; changed: ${changed.join(", ")}` +
      (changed.includes("schedule") ? ` (schedule ${m.schedule} → ${p.schedule})` : "") +
      (changed.includes("active") ? ` (active ${Boolean(m.active)} → ${Boolean(p.active)})` : "") +
      (changed.includes("username") ? ` (username ${m.username} → ${p.username} — the role the command EXECUTES AS)` : "") +
      (changed.includes("database") ? ` (database ${m.database} → ${p.database})` : "") +
      (changed.includes("jobid") ? ` (jobid ${m.jobid} → ${p.jobid})` : "");

    // ⛔ The command TEXT is printed only when BOTH sides pass hygiene AND the
    // manifest row carries text. Otherwise: shas only, and SAY WHY.
    if (withheld) {
      headline += `\n      command text withheld: manifest row is sha-only (${m.withheld_reason})`;
    } else if (manifestDirty || prodDirty) {
      const which = [manifestDirty ? "manifest" : null, prodDirty ? "PROD" : null].filter(Boolean).join(" and ");
      const ruleIds = [...(manifestHygiene.get(name) || []), ...(prodHygiene.get(name) || [])]
        .map((v) => v.slice(0, v.indexOf("]") + 1))
        .join(" ");
      headline += `\n      command text withheld: ${which} fails hygiene (${ruleIds})`;
    } else if (changed.includes("command")) {
      // Both sides clean: a unified diff of the NORMALIZED text. Normalization
      // collapses each side to one line, so the diff is exactly two lines.
      lines.push(`--- manifest ${name} (captured ${capturedAt})`);
      lines.push(`+++ PROD ${name}`);
      lines.push(`- ${normalizeCommand(m.command)}`);
      lines.push(`+ ${normalizeCommand(p.command)}`);
    }

    drift(name, headline);
  }

  lines.push(
    `cron-drift: ${prodRows.length} PROD job(s) vs ${manifest.jobs.length} manifest job(s), ${differing} differing`,
  );

  return { defects, lines };
}

// ---------------------------------------------------------------------------
// The arm
// ---------------------------------------------------------------------------

/**
 * Read the committed oracle.
 *
 * ⛔ AN ABSENT FILE IS AN ERROR, NOT AN EMPTY MANIFEST AND NOT A SKIP. It flows
 * into `compareManifest` as `manifest-invalid`; making the absence explicit at
 * the read keeps the message about the FILE rather than about its shape.
 */
function readManifestFile(path) {
  if (!existsSync(path)) {
    throw new Error("no such file (plan 06 captures it from PROD through the workflow's capture-manifest mode)");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

async function run({ seams, log, addDefect, manifestPath }) {
  // (1) The oracle. An ABSENT file is `manifest-invalid`, never a skip.
  let manifest = null;
  let readError = null;
  try {
    manifest = readManifestFile(manifestPath);
  } catch (err) {
    readError = err && err.message ? err.message : String(err);
  }
  if (readError) {
    addDefect(
      "manifest-invalid",
      "cron-drift",
      "cron-manifest.json",
      `the cron manifest at ${manifestPath} could not be read or parsed: ${readError}. No comparison happened; that is not the absence of drift.`,
      REMEDIES["manifest-invalid"],
    );
    return;
  }

  // (2) WHICH DATABASE AM I ON? `current_database()` is `postgres` on every
  //     Supabase project and proves nothing; the hand-set COMMENT ON DATABASE
  //     marker is the only identification that exists. The marker is a name a
  //     human chose, so it is safe to print.
  const markerRes = await seams.sql("cron-drift", DB_MARKER_SQL);
  if (markerRes.measureFail) {
    addDefect(
      "measure-fail",
      "cron-drift",
      "database marker",
      `the database marker could not be read: ${markerRes.measureFail}.`,
    );
    return;
  }
  const marker = String(markerRes.stdout || "").trim();
  if (marker.length === 0) {
    addDefect(
      "measure-fail",
      "cron-drift",
      "database marker",
      "the database has no COMMENT ON DATABASE marker, so which database this reading came from was never established. current_database() is `postgres` on every Supabase project and proves nothing.",
      "Re-set the COMMENT ON DATABASE marker on the project before trusting this reading.",
    );
    return;
  }
  log(`cron-drift: database marker = ${marker}`);

  // (3) All rows of cron.job, with separators a multi-line command survives.
  const res = await seams.sql("cron-drift", CRON_JOB_SQL, CRON_JOB_SEPARATORS);
  if (res.measureFail) {
    addDefect(
      "measure-fail",
      "cron-drift",
      "cron.job",
      `the cron.job read could not be performed at all: ${res.measureFail}. An empty answer from a failed psql is NOT an empty cron.job.`,
    );
    return;
  }

  const prodRows = parseCronJobRows(res.stdout);
  const { defects, lines } = compareManifest(manifest, prodRows, { liveMarker: marker });
  for (const line of lines) log(line);
  for (const d of defects) addDefect(d.kind, "cron-drift", d.subject, d.detail, REMEDIES[d.kind]);
}

export const ARM = {
  name: "cron-drift",
  requiredEnv: ["PROBER_POOLER_URL", "SUPABASE_DB_PASSWORD"],
  run,
  REMEDIES,
};
