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
 * that a capture is REFUSED unless every row passes the secret-hygiene
 * rules below: the manifest records the ACHIEVABLE configuration, never
 * "whatever PROD happens to have".
 *
 * ⚠️ AND THAT SENTENCE IS ONLY EVER AS STRONG AS THE RULES IT POINTS AT — it
 * says every row PASSES them, which is not the same as every credential being
 * caught. It has been falsified by measurement twice already: 164.8.5-REVIEW
 * CR-02 (a record separator inside a command truncated the text the rules were
 * handed) and 164.8.5-REVIEW-R1 CR-R1-01 (a 37-character key directly under
 * 'X-Service-Key', one ordinary `coalesce(…)` deep, tripped NO rule and was
 * WRITTEN INTO the committed oracle). Both are closed and each carries its own
 * red row. ⛔ The next reader should treat this paragraph as a DESIGN INTENT to
 * re-measure against — `hygiene-bypass.json` is where a falsification is
 * recorded — and never as a property already proven.
 *
 * ============================================================================
 * ⛔ THE REPOSITORY IS PUBLIC AND `.planning/` IS TRACKED (T-164.1-10)
 * ============================================================================
 * The manifest is committed. The drift diff is printed into a world-readable
 * Actions log. And the rows beyond jobid 1 have NEVER BEEN READ BY ANYONE
 * (RESEARCH Finding 3) — nobody can vouch for what is in fourteen other cron
 * commands. That is why the hygiene rules below are many rather than the
 * three RESEARCH proposed, why they run on BOTH sides of the comparison, and why a
 * PROD command failing them is `cron-secret-in-command` EVEN WHEN ITS SHA
 * MATCHES THE MANIFEST — and even when there is no readable manifest at all,
 * because the PROD-side scan is section (0) of `compareManifest`, above every
 * `return` in it, and `run()` reads the oracle LAST precisely so that section
 * can never be starved of rows.
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

// ⚠️ THE FIRST UPWARD `../` ESM IMPORT BETWEEN `.mjs` FILES UNDER `scripts/`,
// AND IT IS DELIBERATE.
//
// The pattern census (164.8.5-PATTERNS §6) found 16 cross-module imports under
// `scripts/`, every one of them same-directory or downward. This one goes up
// two levels, so it is a NEW pattern rather than a stretch of an existing one,
// and it is here for a measured reason:
//
//   The reverted repair `84b21cb5` shipped a NAIVE `stripSqlComments` of its
//   own — one import away from the quote-aware, dollar-aware lexer this
//   repository already owns and already unit-tests
//   (`src/__tests__/sql-body-normalize.test.ts`). A second lexer is "a control
//   that cannot fail": it drifts from the first, and nothing tells you which
//   one is wrong. There is exactly ONE SQL lexer in this repo and this arm uses
//   it.
//
// What the coupling costs, stated so the next editor knows: an edit to
// `scanSql` can now break this arm. The tripwires are this file's own
// `--self-test` scenarios and `src/__tests__/prod-prober-wiring.test.ts`, both
// of which exercise real command text through `codeSpans` below. The three open
// `[VAC04-C*]` items against the normalizer concern `extractFunctionDefs` and
// `readQualifiedName`, NOT `scanSql`.
//
// Importing is side-effect-free: the module's CLI runs only under its
// `invokedDirectly()` realpath guard (`sql-body-normalize.mjs:768-779`).
import { extractFunctionDefs, scanSql } from "../../sql-body-normalize.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The committed oracle. NOT written by plan 03 — plan 06 captures it from PROD
 * through the workflow's capture-manifest mode. Until it exists the live drift
 * arm reports `manifest-invalid`, which is the honest state: a comparison with
 * no oracle is not a comparison.
 */
export const MANIFEST_PATH = resolve(HERE, "..", "cron-manifest.json");

/**
 * The COMMITTED function snapshot `vault-absent` resolves callables against.
 *
 * ⛔ IT IS THE REPO'S TEXT, NOT PROD'S. `supabase/schema/functions/` is a
 * hermetic replay of `supabase/migrations/**` (`scripts/dump-sql-functions.ts`),
 * regenerated by `npm run schema:functions`. So the rule answers "does the
 * COMMITTED body of the callable this command names read Vault", which is the
 * only question a repo-side oracle can honestly answer. Whether PROD's body
 * still matches is VAC-04's question, and the violation sentence says so.
 *
 * ⚠️ READ-ONLY, AND NEVER THROUGH `seams`. The seam layer exists so the
 * self-test can pin an arm's REQUEST COUNT (`greenSeamCalls: 2` for this arm,
 * asserted twice); routing a local file read through it would inflate that
 * count and turn a pinned invariant into a moving number. Plain `node:fs`
 * against an INJECTED directory is the idiom `manifestPath` already
 * establishes (S6).
 */
export const FUNCTIONS_DIR = resolve(HERE, "..", "..", "..", "supabase", "schema", "functions");

/** Bumping either of these invalidates every committed sha. Reviewed edit only. */
export const MANIFEST_SCHEMA_VERSION = 1;
export const NORMALIZATION = "ws-collapse-v2";

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
/**
 * The output columns of `CRON_JOB_SQL`, IN ORDER — the one source of the field
 * count `parseCronJobRows` requires (criterion 9: no hand-typed counts).
 *
 * ⛔ `total` IS LAST AND THE POSITION IS LOAD-BEARING (164.8.5-REVIEW-R1 CR-R1-03).
 * It is the out-of-band job count, and putting it AFTER `command` is what makes
 * the field-count guard bite on a record separator INSIDE a command: the head
 * fragment of such a split loses the trailing `total` field and is therefore
 * SHORT, rather than being a full-width record carrying a silently truncated
 * command. MEASURED 2026-09-11 with `total` FIRST instead: the head fragment
 * had the full width, parsed as a row, and the whitespace-tail spelling was
 * caught by nothing at all.
 */
export const CRON_JOB_COLUMNS = ["jobid", "jobname", "schedule", "active", "database", "username", "command", "total"];

/**
 * ⛔ `count(*) OVER ()` IS AN OUT-OF-BAND COUNT AND THE PARSER CANNOT WORK
 * WITHOUT ONE. A delimiter-based parser CANNOT self-validate a delimiter that
 * appears in its own payload: whatever the field count says, it says it about
 * FRAGMENTS, and fragments can be well-formed. The window count is computed by
 * Postgres over the real rows, so `rows + malformed === total` is the only
 * statement about completeness this parser is entitled to make.
 */
export const CRON_JOB_SQL =
  `SELECT ${CRON_JOB_COLUMNS.slice(0, -1).join(", ")}, count(*) OVER () AS ${CRON_JOB_COLUMNS[CRON_JOB_COLUMNS.length - 1]}` +
  ` FROM cron.job ORDER BY jobid`;

/**
 * ⚠️ THIS QUERY NEEDS NON-DEFAULT SEPARATORS, AND THAT IS NOT A STYLE CHOICE.
 * `cron.job.command` is frequently a multi-line `DO $$ … $$` block containing
 * both newlines and (in `jsonb_build_object` argument lists) tabs. With psql's
 * default tab field / newline record separators such a command DESYNCS the
 * parser: one job's body silently becomes several malformed rows, and a drift
 * arm that mis-parses PROD is worse than one that does not run.
 *
 * ASCII 0x1F (unit separator) and 0x1E (record separator) exist for exactly
 * this and are vanishingly rare in SQL source text.
 *
 * ⛔ CORRECTED: this docstring used to claim they "cannot occur in SQL source
 * text". They can. `E'\x1e'` is a legal literal, and a control byte can be
 * pasted into a command directly; either produces a record this parser splits
 * in two. That is precisely why `parseCronJobRows` COUNTS a short record and
 * both callers refuse on it, rather than trusting the separator to be unique.
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
 * `ws-collapse-v2`: `\r\n`/`\r` → `\n`, then per LINE collapse every run of
 * HORIZONTAL whitespace to one space and trim it. **Line breaks SURVIVE.**
 *
 * Two commands whose normalized text is byte-equal are NOT drift — an operator
 * re-indenting a DO block, or a client that round-tripped it through CRLF, has
 * changed nothing that runs. One differing non-whitespace byte IS drift.
 *
 * ⛔ WHY `v1` HAD TO DIE, MEASURED ON COMMITTED TEXT (164.8.5-REVIEW CR-01).
 * `v1` was `.replace(/\s+/g, " ")` — it collapsed NEWLINES too, and a newline is
 * not whitespace in SQL: it is what TERMINATES a `--` comment. Fold a
 * multi-line command onto one line and a leading `--` swallows the entire body.
 *
 * The victim is a REAL committed row. `retention_compute_jobs_orphaned_running`
 * is 1791 characters, opens with a `-- CANARY_…` comment block, and carries the
 * `DO $sweep$ … END $sweep$;` reaper that fails orphaned `compute_jobs`. Run
 * through `v1` it becomes ONE line, `scanSql` masks it to 100% spaces, and
 * EVERY lexer-based rule in this file sees an empty command. A 37-character
 * token spliced anywhere into it was caught on 13 of the 14 committed
 * commands and MISSED on that one.
 *
 * Worse than a blind row: the working program and its all-comment no-op twin
 * HASHED IDENTICALLY under `v1`, so `compareManifest` reported `0 differing`
 * between them — and `REMEDIES["cron-drift"]`'s own instruction to
 * "re-schedule PROD from the manifest" would have silently disabled the reaper.
 * Under `v2` the two texts differ by their newlines and therefore by their sha,
 * which is the entire point of hashing a normalized form rather than a folded
 * one.
 *
 * ⚠️ STILL LOSSY INSIDE LITERALS, deliberately and unchanged from `v1`:
 * `'a  b'` normalizes to `'a b'`. Narrowing that would move every committed sha
 * a second time for a shape nothing has measured; it is recorded here rather
 * than fixed.
 *
 * ⚠️ BLANK LINES ARE PRESERVED (as empty lines). Dropping them would be a
 * second semantic edit inside dollar-quoted literals, where a blank line is
 * data.
 */
export function normalizeCommand(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .join("\n")
    .trim();
}

/** sha256 over the UTF-8 bytes of the NORMALIZED text. */
export function sha256Hex(text) {
  return createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Secret hygiene — every rule in `HYGIENE_RULE_IDS` has a red fixture row and
// a green control. The COUNT is never restated in prose: it moved once already.
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
  "header-unparseable",
  "long-token-anywhere",
  // ⛔ NOT A CREDENTIAL RULE — A REFUSAL, and it is in this list so a red row
  // must prove it can fire (WR-R1-03). It is a member of
  // `UNJUDGEABLE_RULE_IDS` beside `header-unparseable`, so it routes to
  // `measure-fail` rather than to a rotation remedy.
  "command-unjudgeable",
  // ⛔ ALSO A REFUSAL, AND ITS SCOPE IS ONE RULE (164.8.5-REVIEW-R2 CR-R2-01).
  // It says "the jobname-SCOPED rule could not be applied to this row" and
  // NOTHING ELSE — every other rule still ran beside it. See the derivation in
  // `hygieneViolations`.
  "jobname-absent",
];

/**
 * A quoted literal shorter than this after a header name is a CONSTANT, not a
 * credential: `'Bearer '` (7) and `'application/json'` (16) are the shapes the
 * achievable configuration uses, and flagging them would train the reader to
 * ignore this whole class.
 */
const HEADER_LITERAL_MIN = 16;

/** A quoted literal at least this long inside a header argument list is a credential. */
export const HEADERS_LITERAL_MAX = 32;

/**
 * The token threshold for `long-token-anywhere`.
 *
 * ⛔ DERIVED, NEVER A SECOND LITERAL — and the derivation is the invariant, not
 * a tidiness preference.
 *
 * (1) THE Q2 REGION PARTITION. `long-token-anywhere` deliberately EXCLUDES
 *     header regions, because `long-literal-in-headers` already owns them and
 *     two rules firing on one red row would break the one-rule-isolation
 *     assertion. That exclusion needs `TOKEN_MIN >= HEADERS_LITERAL_MAX`: a
 *     whitespace-delimited token of `TOKEN_MIN` characters lives inside a
 *     literal of at least `TOKEN_MIN` characters, which is an argument of at
 *     least `HEADERS_LITERAL_MAX` DERIVED length, which is exactly what
 *     `long-literal-in-headers` fires on. Let the two constants drift apart and
 *     a token in the gap is caught by NOBODY, silently — the whole point of
 *     writing one in terms of the other.
 *
 *     ⛔ CORRECTED 2026-09-11 (164.8.5-REVIEW-R1 CR-R1-01): this paragraph used
 *     to claim the exclusion "loses nothing ONLY while
 *     `TOKEN_MIN >= HEADERS_LITERAL_MAX`". THAT CONDITION IS NECESSARY AND NOT
 *     SUFFICIENT, and the claim was false as written. The partition ALSO needs
 *     the header measurement to be TOTAL over the region — and it is not:
 *     `derivedLiteralLength` deliberately refuses to enter `(SELECT …)` and any
 *     `(` whose callee is not in `BUILDERS`, so a literal behind either derives
 *     0 and the header rules never see it. MEASURED: a 37-character key under
 *     `'X-Service-Key'` behind `coalesce(nullif(v,''), '<key>')` reported ZERO
 *     violations from every rule. The exclusion at the token rule is now
 *     conditional on the literal having been COUNTED rather than merely
 *     LOCATED; both halves of the condition are live, and neither constant
 *     moved.
 *
 * (2) THE PIN. `src/__tests__/prod-prober-wiring.test.ts` asserts
 *     `TOKEN_MIN === HEADERS_LITERAL_MAX` under a title that states this
 *     argument. Equality rather than `>=`: `>=` is what the partition needs,
 *     equality is what the DERIVATION says, and a divergence in either
 *     direction is a decision somebody must make on purpose.
 *
 * (3) ⚠️ THE STATED FRAGILITY — THE MARGIN IS ONE CHARACTER WIDE. Measured on
 *     the committed manifest (2026-09-10) the longest non-URL literal tokens
 *     are `retention_notification_dispatches:` (34 — over the threshold, clean
 *     ONLY for lack of a digit) and `reconcile_dropped_enqueue_sweep:`
 *     (EXACTLY 32). A future cron job named `<32+ chars>_2` would fire this
 *     rule on every hourly PROD run. The false-positive-budget scenario over
 *     `cron-manifest.json` is the tripwire.
 *
 *     ⛔ THE ANSWER TO A RED THERE IS TO NARROW THE RULE. Never edit the
 *     manifest to fit, and never raise this constant to dodge a job name —
 *     raising it silently shrinks what the rule catches AND (per (1)) opens the
 *     region partition.
 */
export const TOKEN_MIN = HEADERS_LITERAL_MAX;

/**
 * A URL with nothing hitchhiking on it. Exported so the wiring test can
 * calibrate it in both directions.
 *
 * ⛔ NARROW ON PURPOSE. `?`, `#` and `user:pw@` are all ABSENT from this
 * pattern, so a "URL" carrying a token in its query string
 * (`https://x.invalid/a?token=…`) or `user:pw@` credentials in its authority
 * is NOT exempt — those are two of the ways a key actually reaches a cron
 * command. The exemption exists for the ONE measured shape in the committed
 * corpus: a 79-character bare analytics URL.
 *
 * ⛔ CORRECTED 2026-09-11 (164.8.5-REVIEW-R2 WR-R2-01). This paragraph used to
 * claim the pattern rejected "credentials in its authority" FULL STOP. It is
 * true only of the `user:pw@` spelling. A HOST LABEL matches `[A-Za-z0-9.-]+`
 * in full, so every character of an opaque key fits inside the authority's own
 * charset — MEASURED, `isBareUrl('https://<39-char key>.invalid/a')` returned
 * `true` and the command reported `[]` from every rule. That is byte-for-byte
 * the CR-04 path-segment defect moved LEFT of the first `/`. `isBareUrl` now
 * asks the same question of each host label that it asks of each path segment.
 */
export const BARE_URL_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/[A-Za-z0-9._~/-]*)?$/;

/**
 * A canonical RFC-4122 UUID, and NOTHING looser.
 *
 * ⛔ IT EXISTS TO NARROW A FALSE POSITIVE, NOT TO WIDEN AN EXEMPTION
 * (164.8.5-REVIEW-R1 WR-R1-02). CR-04's path-segment test asks whether any
 * `/`-delimited segment would be a credential on its own — `TOKEN_MIN`+
 * characters and containing a digit. A UUID is 36 characters and contains
 * digits, so EVERY resource-scoped REST path failed the exemption and fired a
 * rule whose remedy is "treat the named secret as EXPOSED and rotate it first".
 * MEASURED 2026-09-11:
 *   isBareUrl("https://x.invalid/api/strategies/123e4567-e89b-12d3-a456-426614174000") -> false
 * An arm that cries wolf on a UUID is how a true positive gets ignored, which is
 * the failure mode the zero-FP budget exists to prevent.
 *
 * ⛔ THE ANSWER IS NARROWING, NEVER RAISING `TOKEN_MIN` — per the rule's own
 * instruction beside the constant, and because raising it re-opens the Q2 region
 * partition. The shape is FIXED-LENGTH and FIXED-LAYOUT (8-4-4-4-12 hex), so it
 * cannot absorb an opaque key: a `FAKE-…` segment of the same 36 characters is
 * NOT a UUID and still fires. The wiring test calibrates both directions.
 *
 * ⚠️ A UUID *is* a secret in some designs (an unguessable share link). This
 * exemption says only that this ARM will not call one a credential — a
 * capability-URL scheme needs a different control, and the residual is recorded
 * rather than closed.
 */
export const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The punctuation a token picks up from the PROSE AROUND IT, stripped before —
 * and ONLY before — the bare-URL exemption is tested.
 *
 * ⛔ ZERO-FP BUDGET LEAK (164.8.5-REVIEW-R2 WR-R2-07). `BARE_URL_RE` is anchored
 * `^…$` and the exemption was applied to the whole whitespace-delimited token,
 * so ANY adjacent character outside the path charset `[A-Za-z0-9._~/-]`
 * destroyed it. `.` happens to be in that charset; `,` `)` `;` `'` are not.
 * MEASURED 2026-09-11, ordinary prose carrying no credential at all:
 *
 *   RAISE NOTICE 'see https://api.example.com/v1/ingest, then retry' -> ["long-token-anywhere"]
 *   SELECT 'endpoint (https://api.example.com/v1/ingest)'            -> ["long-token-anywhere"]
 *   …the identical URL with no trailing punctuation                  -> []
 *
 * `long-token-anywhere` is a CREDENTIAL rule, so each of those became
 * `cron-secret-in-command` — remedy "treat the named secret as EXPOSED and
 * rotate it first" — hourly, on a real command, on no evidence. The `TOKEN_MIN`
 * docstring already names that as the thing this rule must never do.
 *
 * ⛔ TRIMMED FOR THE EXEMPTION, NEVER FOR THE LENGTH. The length test still
 * measures the REAL token, so trailing punctuation can never shrink a
 * credential under `TOKEN_MIN`; and `https://hook.invalid/t/<key>,` still fires,
 * because trimming the comma leaves a URL whose PATH SEGMENT is a credential.
 */
const TRIM_PUNCT = /^[('"`[]+|[)'"`\].,;:!?]+$/g;
/**
 * Is this token a URL carrying NOTHING — the exemption `long-token-anywhere`
 * actually means?
 *
 * ⛔ `BARE_URL_RE.test(token)` ALONE WAS THE BUG (164.8.5-REVIEW CR-04). The
 * docstring above reasons about `?`, `#` and `user:pw@` and NEVER about the
 * PATH — which is the commonest webhook-token shape there is. Every character
 * of a `FAKE-0123…` credential is inside the pattern's own path charset
 * `[A-Za-z0-9._~/-]`, so `https://hook.invalid/t/<37-char token>` matched, was
 * exempted, and reported `[]`; the query-string spelling of the SAME credential
 * fired. Reproduced both ways before this fix.
 *
 * ⛔ THE SEGMENT THRESHOLD IS `TOKEN_MIN`, DERIVED AND NOT A NEW CONSTANT. The
 * rule's own test is "a whitespace-delimited token of at least `TOKEN_MIN`
 * characters containing a digit"; this asks the same question of each
 * `/`-delimited PATH SEGMENT **and of each `.`-delimited HOST LABEL**.
 *
 * ⛔ THE HOST-LABEL HALF WAS MISSING UNTIL 164.8.5-REVIEW-R2 WR-R2-01, AND THE
 * SENTENCE HERE CLAIMED OTHERWISE. It read "the exemption can never be the
 * reason a credential goes unreported"; MEASURED 2026-09-11 on the parent
 * commit, a 39-character digit-bearing key spelled as a host label reported
 * `[]` from EVERY rule while the identical key in a PATH SEGMENT and the
 * identical key bare both reported `[long-token-anywhere]` — and
 * `captureManifest` would have written that command into an oracle committed to
 * a PUBLIC repository. The claim is now TRUE of both halves of the authority
 * this pattern admits, which is what makes it safe to restate.
 *
 * MEASURED on the committed corpus: the one URL the exemption exists for —
 * `https://quantalyze-analytics-production.up.railway.app/api/match/cron-recompute`,
 * 79 characters — has path segments `api` (3), `match` (5) and `cron-recompute`
 * (14) and host labels `quantalyze-analytics-production` (31 — UNDER
 * `TOKEN_MIN` by ONE character), `up`, `railway`, `app`, so it stays exempt and
 * the false-positive budget stays at zero. ⚠️ That one-character margin is the
 * same fragility `TOKEN_MIN` (3) already names; the committed-manifest budget
 * scenario is its tripwire.
 *
 * ⚠️ ACCEPTED RESIDUAL, recorded beside the rule: a credential SPLIT across
 * several short path segments (`/a1b2/c3d4/…`) evades this, exactly as a
 * `||`-split value evades a first-literal length test. Closing it needs a
 * whole-path measure, which would fire on long REST paths that carry no secret.
 *
 * @param {string} token a whitespace-delimited token from a literal's content
 */
export function isBareUrl(token) {
  if (!BARE_URL_RE.test(token)) return false;
  // ONE predicate, asked of both halves of the URL. Spelling it twice would be
  // two chances for them to drift — which is exactly how the authority half
  // came to be missing while the docstring said it was not.
  const credentialish = (part) => part.length >= TOKEN_MIN && /\d/.test(part) && !CANONICAL_UUID_RE.test(part);
  // `:port` is stripped so `app:8443` is judged as the label `app`, not as a
  // 8-character token that happens to carry a digit.
  const authority = token.replace(/^https?:\/\//, "").split("/")[0].replace(/:\d+$/, "");
  if (authority.split(".").some(credentialish)) return false;
  return !token
    .replace(/^https?:\/\/[^/]*/, "")
    .split("/")
    .some(credentialish);
}


/**
 * The prefix that makes a QUOTED region CODE rather than DATA.
 *
 * `DO $body$ … $body$` and `DO LANGUAGE plpgsql $$ … $$` are both valid; the
 * suffix form (`DO $$…$$ LANGUAGE plpgsql`) needs no handling because the
 * prefix is all this test reads. All five `DO` commands in the committed
 * manifest use the bare `DO $tag$` form.
 *
 * ⛔ THE TRAILING `(?:[EU]&?)?` IS FOR `DO E'…'` AND `DO U&'…'`, and it is what
 * keeps this ONE predicate honest for BOTH of its readers. `codeSpans` uses it
 * to decide what to RE-ENTER as code and `literalsIn` uses it to decide what to
 * SKIP; the two must range over the SAME set or a body is skipped by one and
 * never re-entered by the other — which is exactly the CR-03 hole below.
 */
const DO_PREFIX = /\bDO\s+(?:LANGUAGE\s+[A-Za-z_]+\s+)?(?:[EU]&?)?$/i;

/** Give-up depth for dollar nesting. No real command nests even one deep. */
const MAX_DOLLAR_DEPTH = 4;

/**
 * Every span of EXECUTABLE text in a cron command: the outer command, plus each
 * `DO` body, recursively.
 *
 * ⛔ WHY THIS EXISTS, AND WHY IT IS HERE RATHER THAN IN THE NORMALIZER.
 * `scanSql` is a STRING lexer and it is right that `$$ … $$` is a string —
 * `sql-body-normalize.mjs` exists to hash and diff FUNCTION BODIES, and
 * re-entering a body as code would change what VAC-04 and VAC-08 compare. But a
 * cron command is not a function body: a top-level `DO $body$ … $body$` is the
 * thing that RUNS. MEASURED 2026-09-10: 4 of the 14 committed PROD commands are
 * that shape, so a rule reading only `scanSql(cmd).masked` sees an empty
 * command for the flagship job — the redesigned `vault-absent` would have fired
 * on the exact configuration it exists to endorse.
 *
 * Nested tags need no special case: recursing into a `$a$` body means the
 * body's own `scanSql` treats an inner `$b$…$b$` as the literal it is.
 *
 * ⛔ BOTH SPELLINGS OF A `DO` BODY ARE RE-ENTERED (164.8.5-REVIEW CR-03 / F1,
 * found independently by two reviewers). This loop used to iterate
 * `dollarRegions` ONLY, while `literalsIn` below SKIPPED every `DO`-prefixed
 * literal *including the single-quoted ones*, on the stated premise that
 * "`codeSpans` already re-enters exactly these regions as CODE". For `DO '…'`
 * NOBODY DID. The two predicates were byte-identical as documented and ranged
 * over DIFFERENT SETS, so a single-quoted procedural body was a TOTAL blind
 * spot — skipped as code, skipped as data. Orchestrator-reproduced:
 *
 *   DO $$ … k := '<37-char token>' … $$   =>  ["long-token-anywhere"]
 *   DO '  … k := ''<same token>''  … '    =>  []
 *
 * `DO 'BEGIN … END'` is valid PostgreSQL — dollar-quoting is only RECOMMENDED —
 * and five of the fourteen committed commands are `DO` blocks, so this was one
 * spelling variant away from live exposure. Unlike the measured bypass family
 * (a)-(g) it is not even obfuscation.
 *
 * ⚠️ THE SINGLE-QUOTED RECURSION IS ON `literalAt(...).content`, i.e. on the
 * `''`-UNESCAPED text, because that is the program PostgreSQL actually runs.
 * One consequence, recorded rather than fixed: `base` is only an approximation
 * for such a child span — every `''` in the source shortens the body by one
 * character. Nothing in this file reads `base` today (it is documented as "so a
 * future caller can report a position"); that future caller must unescape-aware
 * map its offsets or stop at the child's `base`.
 *
 * @param {string} sql
 * ⛔ THE DEPTH CAP RETURNS, IT DOES NOT THROW (164.8.5-REVIEW-R2 WR-R2-05). It
 * used to `throw` from INSIDE the recursion, which abandoned the PARENT's
 * remaining `dollarRegions` loop AND its entire single-quoted-body walk —
 * everything not yet pushed into `spans` was lost, not merely the too-deeply
 * nested body. `hygieneViolations` caught the throw and reported
 * `command-unjudgeable` beside whatever HAD been collected, so the refusal was
 * additive in NAME while being substitutive for every span the unwind skipped.
 *
 * MEASURED 2026-09-11 on the parent commit, with `deep` = six nested `DO`
 * bodies carrying no credential and `sibling` = an ordinary depth-1 `DO $y$ … $y$`
 * carrying an inline `X-Service-Key`:
 *
 *   SIBLING ALONE (control) -> ["x-service-key-literal","long-literal-in-headers"]
 *   SIBLING then DEEP       -> ["command-unjudgeable","x-service-key-literal","long-literal-in-headers"]
 *   DEEP then SIBLING       -> ["command-unjudgeable"]          <-- credential NOT named
 *
 * The only thing that changed was the ORDER of two independent statements in
 * one command, and `command-unjudgeable` is in `UNJUDGEABLE_RULE_IDS`, so the
 * row routed to `measure-fail` with no rotation remedy. Order-dependence in a
 * refusal is the substitutive bug wearing a different hat.
 *
 * @param {string[]} [refusals] every span this walk GAVE UP on, as sentences.
 *   Non-empty means the reading is incomplete; the caller reports that BESIDE
 *   its findings rather than instead of them. It is an out-parameter for the
 *   same reason `out` is: the traversal must keep going after a refusal.
 * @returns {{base:number, sql:string, masked:string, dollarRegions:object[]}[]}
 *   `base` is the offset of this span inside the ORIGINAL command, so a future
 *   caller can report a position; `masked` is index-aligned with `sql`.
 */
export function codeSpans(sql, base = 0, depth = 0, out = [], refusals = []) {
  if (depth > MAX_DOLLAR_DEPTH) {
    refusals.push(`dollar-quote nesting deeper than ${MAX_DOLLAR_DEPTH} at offset ${base}`);
    return out;
  }
  const { masked, dollarRegions } = scanSql(sql);
  const span = { base, sql, masked, dollarRegions };
  out.push(span);
  for (const r of dollarRegions) {
    if (DO_PREFIX.test(masked.slice(0, r.start))) {
      codeSpans(sql.slice(r.contentStart, r.contentEnd), base + r.contentStart, depth + 1, out, refusals);
    }
  }
  // The single-quoted body. Walked with the same primitives every other walk in
  // this file uses — `skipQuotedIdent` so a `'` inside a "quoted identifier"
  // cannot desync the scan, and `literalAt` so the lexer (not this loop) decides
  // where a literal ends.
  let i = 0;
  while (i < masked.length) {
    if (masked[i] === '"') {
      i = skipQuotedIdent(masked, i);
      continue;
    }
    if (masked[i] !== "'") {
      i += 1;
      continue;
    }
    const lit = literalAt(span, i);
    if (!lit) {
      i += 1;
      continue;
    }
    if (DO_PREFIX.test(masked.slice(0, lit.start))) {
      codeSpans(lit.content, base + lit.start + 1, depth + 1, out, refusals);
    }
    i = lit.end;
  }
  return out;
}

/**
 * The string builders whose arguments are still "the value" for length
 * purposes. Anything NOT on this list is a black box the walk refuses to enter
 * — see `derivedLiteralLength`'s accepted residual.
 */
const BUILDERS =
  /^(?:concat|concat_ws|format|chr|decode|encode|convert_from|quote_literal|lower|upper|replace|reverse|translate|btrim|trim|substr|substring|left|right|repeat|lpad|rpad|regexp_replace|split_part|to_hex)$/i;

/** The identifier immediately before a `(` — the callee, or null for a grouping paren. */
const CALLEE_RE = /([A-Za-z_][A-Za-z0-9_.]*)\s*$/;

/**
 * `"quoted identifier"` — kept VERBATIM by `scanSql`'s mask (it is a name, not
 * data), so every walk over masked text must step over it or a `'` or `(`
 * inside a column name would desync the scan.
 */
function skipQuotedIdent(masked, i) {
  let j = i + 1;
  while (j < masked.length) {
    if (masked[j] === '"') {
      if (masked[j + 1] === '"') {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j += 1;
  }
  return j;
}

/**
 * The literal starting at `i`, or null. Boundaries come from `masked` (where a
 * literal's CONTENT is blank, so the next `'` is always its closing quote);
 * CONTENT comes from the original `sql`.
 *
 * This one primitive is what makes `E'…'`, `U&'…'` and `$q$…$q$` literals to
 * this arm — the lexer already classified them, so bypass shapes (a) and (f)
 * stop being spellings the rules cannot see.
 */
function literalAt(span, i) {
  if (span.masked[i] === "'") {
    let j = i + 1;
    while (j < span.masked.length && span.masked[j] !== "'") j += 1;
    return { start: i, end: j + 1, content: span.sql.slice(i + 1, j).replace(/''/g, "'") };
  }
  for (const r of span.dollarRegions) {
    if (r.start === i) return { start: r.start, end: r.end, content: span.sql.slice(r.contentStart, r.contentEnd) };
  }
  return null;
}

/**
 * EVERY literal in a span, in order, as `{ start, end, content }`.
 *
 * ⛔ THE `DO` BODY IS SKIPPED, AND THAT IS NOT AN OPTIMISATION. At the OUTER
 * span a top-level `DO $body$ … $body$` is a dollar-quoted literal to
 * `scanSql`, so without this skip the whole procedural body would be handed to
 * the token rule as one enormous "literal" — and every CODE token in it
 * (identifiers, numeric arguments, `timeout_milliseconds := 60000`) would be
 * length-tested as if it were data. `codeSpans` already re-enters exactly these
 * regions as CODE and the rules run over the resulting span list, so the real
 * literals inside a `DO` body are reached on the CHILD span, once, correctly.
 * The predicate here is byte-identical to `codeSpans`' own, on purpose.
 *
 * ⚠️ Written for `long-token-anywhere`. Plan 03 specified a `literalsIn` and
 * did not write one because nothing then needed it (03-SUMMARY deviation 7);
 * this is that rule's arrival, not a second helper.
 */
/**
 * EVERY COMMENT BODY in a span, as `{ start, end, content }` — the sibling
 * producer of `literalsIn`, feeding the SAME token test.
 *
 * ⛔ WHY THIS EXISTS (164.8.5-REVIEW-R1 WR-R1-01). `long-token-anywhere` read
 * `literalsIn(span)` only, and `literalsIn` walks `masked`, in which `scanSql`
 * has blanked comment bodies AND their delimiters. So a comment was never a
 * literal and never reached the token rule. MEASURED 2026-09-11: a
 * 37-character digit-bearing key in a `--` comment, in a `/* *\/` comment and in
 * a comment inside a `DO` body all reported `[]`, while the identical key in a
 * literal reported `[long-token-anywhere]`.
 *
 * ⛔ IT IS THE CALL THIS REPOSITORY ALREADY MADE FOR THE SIBLING GATE.
 * `scripts/lint-app-guc.mjs` (decision D-05) argues at length that "criterion
 * 1's gate is a grep, and a grep does not know a comment from a statement. So
 * neither may this gate." The token rule quietly did. The realistic path is not
 * an adversary: it is an operator "removing" an inline key by commenting it
 * out, after which the next `captureManifest` writes that comment byte for byte
 * into a manifest committed to a PUBLIC repository while the arm reports the
 * row clean. Comments in these commands are not hypothetical — the committed
 * `retention_compute_jobs_orphaned_running` row opens with one.
 *
 * ⚠️ The four text-shape rules already read `span.sql` RAW, so a JWT, a
 * `service_role` mention and a `'Bearer xxxxx` literal were caught in a comment
 * all along. What was invisible was the OPAQUE non-JWT key — the one family
 * `long-token-anywhere` exists for.
 *
 * The walk steps over quoted identifiers and literals with the same primitives
 * every other walk here uses, so a `--` inside `"a--b"` or inside a string is
 * not a comment start; the START is read from `sql` and CONFIRMED against
 * `masked` being blank there, which is exactly "scanSql agreed this is a
 * comment". Nested block comments are matched by depth, the way `scanSql`
 * itself treats them (MEASURED: `/* a /* b *\/ c *\/` masks as one comment).
 */
function commentsIn(span) {
  const { masked, sql } = span;
  const out = [];
  let i = 0;
  while (i < masked.length) {
    if (masked[i] === '"') {
      i = skipQuotedIdent(masked, i);
      continue;
    }
    const lit = literalAt(span, i);
    if (lit) {
      i = lit.end;
      continue;
    }
    // `masked[i] === " "` is scanSql's own verdict that this is not code.
    if (masked[i] === " " && sql[i] !== masked[i]) {
      if (sql.startsWith("--", i)) {
        const nl = sql.indexOf("\n", i);
        const end = nl === -1 ? sql.length : nl;
        out.push({ start: i, end, content: sql.slice(i + 2, end) });
        i = end;
        continue;
      }
      if (sql.startsWith("/*", i)) {
        let depth = 1;
        let j = i + 2;
        while (j < sql.length && depth > 0) {
          if (sql.startsWith("/*", j)) {
            depth += 1;
            j += 2;
          } else if (sql.startsWith("*/", j)) {
            depth -= 1;
            j += 2;
          } else j += 1;
        }
        out.push({ start: i, end: j, content: sql.slice(i + 2, depth === 0 ? j - 2 : j) });
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

function literalsIn(span) {
  const out = [];
  const { masked } = span;
  let i = 0;
  while (i < masked.length) {
    if (masked[i] === '"') {
      i = skipQuotedIdent(masked, i);
      continue;
    }
    const lit = literalAt(span, i);
    if (lit) {
      if (!DO_PREFIX.test(masked.slice(0, lit.start))) out.push(lit);
      i = lit.end;
      continue;
    }
    i += 1;
  }
  return out;
}

/**
 * The `)` matching `masked[openIdx]`, or **-1** when the parentheses do not
 * balance.
 *
 * ⛔ -1 IS A REFUSAL, NOT A DEFAULT. The rule this replaced silently widened an
 * unmatched region to the end of the text and kept judging; a region nobody can
 * delimit is one nobody can clear, and `header-unparseable` says so out loud.
 * No quote-skipping is needed here because literal contents are already blank
 * in `masked` — that is the whole benefit of walking the mask.
 */
function closingParen(masked, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < masked.length) {
    const c = masked[i];
    if (c === '"') {
      i = skipQuotedIdent(masked, i);
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

/**
 * The DERIVED length of the value expression in `[from, to)`: how many
 * characters of literal text this expression can put on the wire.
 *
 * ⛔ THE POINT OF THE WORD "DERIVED". Testing the first literal's length is
 * dodged by typing `'FAKE-key-' || '0123456789ab'`, and every one of the
 * measured bypass family (chr/concat/format/decode/quote_literal) is the same
 * dodge with a different builder. Summing operands closes the family rather
 * than the cases. THE THRESHOLDS DID NOT MOVE (D4) — the MEASUREMENT fed to
 * them did.
 *
 * Where it deliberately stops:
 *  - `(SELECT …)` is NEVER entered. ⛔ MEASURED: the naive "every literal up to
 *    the next depth-0 comma" sum reads **28** on the GREEN, achievable
 *    `'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE
 *    name = 'analytics_service_key')` shape — a false positive on committed
 *    text, i.e. exactly D4's forbidden outcome. With the skip it reads **7**.
 *  - a `(` whose callee is not in `BUILDERS` is skipped whole. ACCEPTED
 *    RESIDUAL: `my_fn('FAKE-key-0123456789ab') || 'CCCCDDDD'` sums to 8 and does
 *    not fire. Closing it by descending into every function re-creates the
 *    `(SELECT …)` false positive, and it needs an adversary who both splits the
 *    key AND routes it through a function this list does not name.
 *  - `chr(...)` counts 1 — it emits one character however it spells its argument.
 *  - a literal's length is its RAW content; `U&'\0046…'` over-counts 6:1 and
 *    `E'\x46'` 4:1. Conservative, and the right direction for a credential test.
 */
function derivedLiteralLength(span, from, to) {
  const { masked } = span;
  let sum = 0;
  let i = from;
  while (i < to) {
    const c = masked[i];
    if (c === '"') {
      i = skipQuotedIdent(masked, i);
      continue;
    }
    // End of THIS argument. The caller decides what the next one means.
    if (c === "," || c === ")") break;
    const lit = literalAt(span, i);
    if (lit) {
      sum += lit.content.length;
      i = lit.end;
      continue;
    }
    if (c === "(") {
      const close = closingParen(masked, i);
      const end = close === -1 ? to : close;
      const m = CALLEE_RE.exec(masked.slice(from, i));
      const callee = m ? m[1] : null;
      if (/^\s*SELECT\b/i.test(masked.slice(i + 1, end))) {
        i = end + 1;
        continue;
      }
      if (callee === null) {
        // A grouping paren: `('a' || 'b')` still derives its operands.
        sum += derivedLiteralLength(span, i + 1, end);
      } else if (BUILDERS.test(callee)) {
        if (/^chr$/i.test(callee)) sum += 1;
        else for (const [a, b] of depth0Args(span, i + 1, end)) sum += derivedLiteralLength(span, a, b);
      }
      i = end + 1;
      continue;
    }
    i += 1;
  }
  return sum;
}

/**
 * `[from, to)` split on commas at paren depth 0 — the `countArgs` idiom from
 * `sql-body-normalize.mjs`. Literal contents are already blank in `masked`, so
 * a comma inside a string cannot split an argument.
 */
function depth0Args(span, from, to) {
  const { masked } = span;
  const args = [];
  let start = from;
  let depth = 0;
  let i = from;
  while (i < to) {
    const ch = masked[i];
    if (ch === '"') {
      i = skipQuotedIdent(masked, i);
      continue;
    }
    const lit = literalAt(span, i);
    if (lit) {
      i = lit.end;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      args.push([start, i]);
      start = i + 1;
    }
    i += 1;
  }
  args.push([start, to]);
  return args;
}

const escapeRe = (s) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * `'<header>', <value>` where the DERIVED value is long enough to BE a
 * credential.
 *
 * ⚠️ The length test is what separates the red shape from the green one, and it
 * is load-bearing rather than defensive. `'Authorization', 'Bearer ' || <expr>`
 * — the achievable Vault-backed shape — closes its quote immediately after the
 * space and concatenates; a bare `/Authorization'\s*,\s*'/` would fire on it,
 * i.e. on exactly the configuration this arm exists to endorse.
 *
 * ⛔ THE ANCHOR IS READ FROM `sql`, AND CONFIRMED ON `masked` (D7). The header
 * NAME is itself a literal, so it is BLANK in the mask and cannot be matched
 * there. Matching it on the raw text and then requiring `masked[idx] === "'"`
 * gets both halves: the name is found, and a name that is really sitting inside
 * a `--` comment or inside a bigger literal (a whole-header JSON blob) is NOT
 * an anchor, because in the mask those positions are blank.
 */
function headerCarriesLiteral(span, headerName) {
  const re = new RegExp(`'${escapeRe(headerName)}'\\s*,`, "gi");
  for (const m of span.sql.matchAll(re)) {
    if (span.masked[m.index] !== "'") continue;
    if (derivedLiteralLength(span, m.index + m[0].length, span.masked.length) >= HEADER_LITERAL_MIN) return true;
  }
  return false;
}

/**
 * The argument-list regions a header value can hide in, as
 * `{ from, to, unparseable }`.
 *
 * ⛔ AN `unparseable` REGION IS NEITHER CLEAN NOR DIRTY — IT IS REFUSED.
 * Every header-rule walk below skips it, and `[header-unparseable]` is the only
 * verdict it produces. (The token rule a later plan adds must exclude it too,
 * for the same reason: a region whose end nobody can find has no contents
 * anybody can enumerate.)
 *
 * The no-paren branch — `headers := '{"X-Service-Key":"…"}'::jsonb` — is
 * PRESERVED as a `[from, semi)` region on purpose: that inline spelling is one
 * of the measured bypass shapes, and dropping the branch would stop it being a
 * header region at all.
 */
function headerRegions(span) {
  const { masked } = span;
  const regions = [];
  const push = (open) => {
    const close = closingParen(masked, open);
    if (close === -1) regions.push({ from: open + 1, to: masked.length, unparseable: true });
    else regions.push({ from: open + 1, to: close, unparseable: false });
  };
  for (const m of masked.matchAll(/jsonb_build_object\s*\(/gi)) push(m.index + m[0].length - 1);
  for (const m of masked.matchAll(/headers\s*:=/gi)) {
    const from = m.index + m[0].length;
    const semi = masked.indexOf(";", from);
    const paren = masked.indexOf("(", from);
    if (paren !== -1 && (semi === -1 || paren < semi)) push(paren);
    else regions.push({ from, to: semi === -1 ? masked.length : semi, unparseable: false });
  }
  return regions;
}

// ---------------------------------------------------------------------------
// `vault-absent` — "does this command REACH a Vault read that EXECUTES?"
// ---------------------------------------------------------------------------

/**
 * An EXECUTING read of the Vault view. `FROM`/`JOIN` rather than a bare mention:
 * the whole point of the redesign is that naming the table in a comment or a
 * string is not reading it.
 */
const VAULT_READ_RE = /\b(?:FROM|JOIN)\s+vault\.decrypted_secrets\b/i;

/** `[schema.]name(` on MASKED text — so a "call" inside a comment or a literal is not a call. */
const CALL_RE = /(?:\b([A-Za-z_][A-Za-z0-9_]*)\.)?\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

/**
 * Words that precede `(` without being a callable.
 *
 * ⚠️ DELIBERATELY SHORT, AND THE OMISSIONS ARE SAFE IN THE LOUD DIRECTION. A
 * keyword this list forgets is looked up as a function name, finds no snapshot
 * file, and therefore does NOT satisfy the rule — the command still has to reach
 * a real Vault read some other way. Forgetting a name can only make the rule
 * fire, never make it pass, so this list is a NOISE control and not a security
 * boundary.
 */
const CALL_KEYWORDS =
  /^(?:if|values|in|exists|coalesce|nullif|case|when|then|else|and|or|not|select|from|where|group|order|having|returning|cast|array|row|on|using|do|begin|end|perform|execute|into|as|is|by|limit|offset|union|all|distinct|with|over|filter|greatest|least)$/i;

/** Depth cap for the callable DFS. The measured graph has ZERO edges; five is room to spare. */
const CALLABLE_DEPTH_MAX = 5;

/**
 * Names called on `masked` that this arm is willing to look up: unqualified, or
 * qualified with `public`. Everything else (`net.`, `cron.`, `vault.`,
 * `pg_catalog.`) is somebody else's schema and has no file in the snapshot.
 *
 * ⚠️ `readQualifiedName`'s identifier charset limitation (`[VAC04-C1]`) — a name
 * carrying a byte outside `[A-Za-z0-9_]` is dropped by `extractFunctionDefs` —
 * CANNOT silently un-resolve a real call here, because `CALL_RE` collects names
 * from the SAME charset. A name this arm can see is a name that reader can read.
 */
function calleesOn(maskedText) {
  const names = [];
  CALL_RE.lastIndex = 0;
  for (let m = CALL_RE.exec(maskedText); m !== null; m = CALL_RE.exec(maskedText)) {
    const schema = m[1] ? m[1].toLowerCase() : null;
    const name = m[2];
    if (schema !== null && schema !== "public") continue;
    if (CALL_KEYWORDS.test(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * Does `<functionsDir>/<name>.sql` — or anything it calls, transitively —
 * contain an EXECUTING Vault read?
 *
 * ⛔ FAIL CLOSED IN EVERY UNKNOWN DIRECTION. A name with no snapshot file is
 * `{ reads: false }` WITH the name recorded, so the violation can say which
 * callable it could not judge. That is the only direction that cannot silently
 * un-block Phase 164.5.1: if someone deletes the Vault read from
 * `match_engine_cron_tick` and regenerates the snapshot, this rule starts
 * firing on the live job — which is correct.
 *
 * Overloads share one file; EVERY definition in it is tested and ANY reader
 * counts, because the command does not say which overload it calls.
 *
 * ⛔ TWO F3-ADJACENT DEFECTS CLOSED HERE (164.8.5-REVIEW F6). Both resolved to
 * `vault-absent` FIRING — a LOUD false positive on correct configuration, never
 * a silent pass — which is why they are low severity and not why they are
 * acceptable.
 *
 * (1) A NON-DOLLAR BODY WAS DROPPED SILENTLY. A function defined
 *     `AS 'SELECT … FROM vault.decrypted_secrets'` — the single-quoted body form,
 *     the same spelling CR-03 found a `DO` block can take — is filtered out by
 *     `bodyKind === "dollar"`, contributed NO body, and was NOT recorded in
 *     `unresolved`. So the violation sentence could not say it had skipped
 *     anything: the operator read "this command reaches no Vault read" when the
 *     truth was "this arm did not read one definition". A skip nobody is told
 *     about is the same shape as a rule that cannot fire.
 *
 * (2) `visited` MEMOISED `false` ACROSS DEPTHS. It was a Set shared for the
 *     whole call, so a name first reached at depth `CALLABLE_DEPTH_MAX` was
 *     marked visited with its own callees TRUNCATED by the depth cap — and if
 *     the same name was later reachable at depth 1, with budget to spare, the
 *     memoised `false` was returned without exploring it. It is now a Map of
 *     name -> the SHALLOWEST depth already explored, so a name reached shallower
 *     than before is re-explored and a name reached at the same depth or deeper
 *     is not. Cycles still terminate: `a -> b -> a` re-enters `a` at depth 2
 *     against a recorded 0, which is not shallower.
 */
function resolveCallable(name, functionsDir, visited, depth, unresolved) {
  if (depth > CALLABLE_DEPTH_MAX) return false;
  // `>=`, not `has`: a name already explored with LESS depth budget than we
  // have now was explored with a truncated subtree, and must be re-explored.
  if (visited.has(name) && visited.get(name) <= depth) return false;
  visited.set(name, depth);
  const file = resolve(functionsDir, `${name}.sql`);
  if (!existsSync(file)) {
    unresolved.add(name);
    return false;
  }
  const defs = extractFunctionDefs(readFileSync(file, "utf8"));
  const bodies = [];
  for (const d of defs) {
    if (d.bodyKind === "dollar") bodies.push(scanSql(d.body).masked);
    // ⛔ NAMES ONLY, NEVER BODY TEXT — this string reaches a world-readable
    // Actions log. The PARENTHETICAL is what makes the sentence honest: "could
    // not be shown to read Vault" is a different claim from "has no file".
    else unresolved.add(`${name} (a definition whose body is not dollar-quoted)`);
  }
  if (bodies.some((masked) => VAULT_READ_RE.test(masked))) return true;
  for (const masked of bodies) {
    for (const callee of calleesOn(masked)) {
      if (resolveCallable(callee, functionsDir, visited, depth + 1, unresolved)) return true;
    }
  }
  return false;
}

/**
 * `{ reads, unresolved }` for a command's span list.
 *
 * ⛔ THE DIRECTORY CHECK IS AT THE TOP, NOT INSIDE THE RESOLVER, AND THAT
 * PLACEMENT IS THE MEASUREMENT. Deferred into `resolveCallable` it would only
 * fire for a command that happens to NEED resolution — so a missing snapshot
 * would read as "clean" for every command that satisfies the shape directly,
 * and as "this callable is unknown" (a finding against the COMMAND) for the
 * next one. Neither is true: what happened is that the instrument is gone.
 * Throwing here makes it `measure-fail`, which is the honest verdict.
 */
function reachesVaultRead(spans, functionsDir) {
  if (!existsSync(functionsDir)) {
    throw new Error(
      `functions snapshot directory ${functionsDir} is absent — the callable resolver cannot measure. A missing snapshot is not the absence of a Vault read; regenerate it with \`npm run schema:functions\`.`,
    );
  }
  if (spans.some((span) => VAULT_READ_RE.test(span.masked))) return { reads: true, unresolved: [] };
  // name -> the SHALLOWEST depth it has already been explored at. See F6 (2)
  // beside `resolveCallable`: a Set memoised `false` for a name whose subtree
  // the depth cap had truncated.
  const visited = new Map();
  const unresolved = new Set();
  for (const span of spans) {
    for (const callee of calleesOn(span.masked)) {
      if (resolveCallable(callee, functionsDir, visited, 0, unresolved)) return { reads: true, unresolved: [] };
    }
  }
  return { reads: false, unresolved: [...unresolved].sort() };
}

/**
 * Every rule in `HYGIENE_RULE_IDS`. Returns one sentence per violation, each
 * prefixed with a stable
 * `[rule-id]`.
 *
 * ⛔ A VIOLATION NEVER QUOTES THE OFFENDING TEXT. It names the rule and the job.
 * A hygiene report that printed the credential it found would be the leak it
 * exists to prevent, and it would print it into a public Actions log.
 *
 * @param {string} jobname
 * @param {string} command  the RAW command text.
 *
 *        ⛔ THIS PARAMETER USED TO CLAIM "normalization does not change any of
 *        these judgements". That was MEASURABLY FALSE under `ws-collapse-v1`
 *        and the correction is the reason `ws-collapse-v2` exists: folding a
 *        multi-line command onto one line lets a leading `--` comment swallow
 *        the body, which took the committed
 *        `retention_compute_jobs_orphaned_running` row from TWO violations to
 *        ZERO. Normalization is a SEMANTIC operation on SQL, never a cosmetic
 *        one, and these rules are judged on the RAW text precisely so that a
 *        future normalization bug cannot quietly blank them.
 *
 *        ⚠️ A manifest row's `command` is the text `captureManifest` STORED,
 *        i.e. already normalized at capture time. A row captured under `v1`
 *        therefore carries text whose newlines are gone for good; no change to
 *        this function can put them back, which is why the `NORMALIZATION`
 *        mismatch refuses such a manifest wholesale rather than scanning it.
 * @param {object} [opts]
 * @param {string} [opts.functionsDir]  the committed function snapshot
 *        `vault-absent` resolves callables against. Injected so the self-test's
 *        tri-state scenario runs on a FIXTURE snapshot: resolving those rows
 *        against the real one would let a Phase 164.8.6 edit to
 *        `match_engine_cron_tick` flip a 164.8.5 scenario. Exactly ONE scenario
 *        uses the default, on purpose — that is the 164.5.1 collision, and it
 *        is meant to be measured every run.
 * @returns {string[]}
 */
export function hygieneViolations(jobname, command, { functionsDir = FUNCTIONS_DIR } = {}) {
  // ⛔ A COMMAND THAT IS NOT A STRING IS ONE NOBODY MEASURED — IT IS NOT A CLEAN
  // ONE. Found by the CR-R1-02 audit of "absence coerced to a pass" (the
  // invariant is recorded beside `recordVerdict`): `String(command ?? "")`
  // turned `undefined`, `null` and a number into the empty command, and the
  // empty command trips no rule, so `hygieneViolations(name, undefined)`
  // returned `[]` — the same sentence this function uses for "judged and
  // clean". MEASURED 2026-09-11, all four returned `[]`.
  //
  // ⭐ IT THROWS RATHER THAN RETURNING A VIOLATION, because "no measurement
  // happened" is the verdict every OTHER refusal in this function already
  // spells that way (`codeSpans`' depth cap, `reachesVaultRead`'s absent
  // snapshot). Both callers already route the throw to a per-row
  // `measure-fail`: `compareManifest`'s `judgeRow` and `captureManifest`'s
  // guard. The manifest side had its own totality check (a row whose `command`
  // is not a string is a WITHHELD row and is skipped); the PROD side had
  // nothing, and the PROD side is the one read live from a database.
  // ⛔ THE JOBNAME REFUSAL IS ADDITIVE, NEVER SUBSTITUTIVE (164.8.5-REVIEW-R2
  // CR-R2-01). This used to be a THROW beside the one above, and a throw here
  // is REPLACEMENT: both callers route it to a per-row `measure-fail` and
  // `continue`, so NO rule ran and no `cron-secret-in-command` was produced for
  // that row. `cron.job.jobname` is NULLable and pg_cron's TWO-ARGUMENT
  // `cron.schedule(schedule, command)` leaves it NULL — `psql -At` renders NULL
  // as the empty string — so this needed no adversary, and it was a one-step
  // off-switch (`cron.unschedule` + the two-arg `cron.schedule`).
  //
  // ORCHESTRATOR-REPRODUCED 2026-09-11 on the pre-fix file, one inline 39-char
  // X-Service-Key in the command:
  //   jobname "named_job" -> ["x-service-key-literal","long-literal-in-headers"]
  //   jobname "" / "   " / null / undefined -> THROW, and compareManifest then
  //   reported `measure-fail | prod: | …no usable jobname…` and NOTHING ELSE.
  //
  // ⛔ THE GUARD'S OWN JUSTIFICATION DID NOT SUPPORT ITS BLAST RADIUS. The
  // jobname scopes exactly ONE rule — `vault-absent`, gated on
  // `name === "match_engine_cron"` — and the refusal disabled EVERY rule in
  // `HYGIENE_RULE_IDS`. So the loss is reported as its own id, BESIDE whatever
  // the other rules found. That is WR-R1-03's own remedy, applied here.
  //
  // ⛔ THE `typeof command !== "string"` THROW BELOW STAYS A THROW, and the
  // asymmetry is the point: a non-string command really cannot be scanned —
  // there is no text to run a rule over — whereas a nameless one can be scanned
  // completely except for the one rule keyed on the name.
  const named = typeof jobname === "string" && jobname.trim().length > 0;
  const name = named ? jobname.trim() : "an unnamed job";
  if (typeof command !== "string") {
    throw new Error(
      `the cron.job command for ${name} is ${command === null ? "null" : typeof command}, not a string — refusing to judge it. An unread command is not a clean one, and String(undefined ?? "") is the empty command, which trips no rule.`,
    );
  }
  const text = command;
  const out = [];
  const said = new Set();
  // A rule says its piece AT MOST ONCE per command. Every rule below runs over
  // a LIST of spans and the outer span's raw text contains each `DO` body, so
  // without this a text-shape rule would report the same finding twice for the
  // same job.
  const say = (id, sentence) => {
    if (said.has(id)) return;
    said.add(id);
    out.push(`[${id}] ${sentence}`);
  };

  // The ADDITIVE half of CR-R2-01. It is reported FIRST so an operator reads
  // "one rule could not be applied" before the findings, and it changes NOTHING
  // about whether the rules below run.
  if (!named) {
    say(
      "jobname-absent",
      "a cron.job row carries no jobname, so the vault-absent rule — the ONE rule in this file scoped to a single jobname — could not be applied to it. pg_cron's two-argument cron.schedule(schedule, command) leaves jobname NULL, so this is an ordinary API call and not an attack. EVERY OTHER RULE BELOW STILL RAN, and any finding they report is real.",
    );
  }

  // ⛔ EVERY RULE READS THE SPAN LIST, NOT THE RAW COMMAND. See `codeSpans`:
  // four of the fourteen committed commands are a top-level `DO $body$` block,
  // which the string lexer correctly masks away in its entirety.
  //
  // ⛔ THE REFUSAL IS ADDITIVE, NOT SUBSTITUTIVE (164.8.5-REVIEW-R1 WR-R1-03).
  // `codeSpans` gives up when dollar nesting exceeds `MAX_DOLLAR_DEPTH`, and it
  // used to throw straight out of this function — BEFORE ANY RULE RAN. Every
  // rule that would have fired on that command was lost, and the row became a
  // generic `measure-fail`. MEASURED 2026-09-11: an `audit_log_hot_to_cold` row
  // with six nested `DO` bodies and an inline `X-Service-Key` reported
  // `credential findings: 0`.
  //
  // ⚠️ AND THE RESIDUAL AS FIRST RECORDED WAS UNDERSTATED. The FIX-PROBER
  // summary bounded it to `match_engine_cron`, "the one job the rule resolves
  // callables for". False: this call sits above every rule, so the loss applied
  // to ANY jobname. That is the same shape as F2 — an off-switch an adversary
  // holds with one character, on the rules that exist to catch bypasses — and
  // the answer is the same: collect what CAN be measured, and report the
  // refusal BESIDE it rather than instead of it.
  //
  // ⛔ AND "ADDITIVE" HAD TO MEAN IT AT EVERY OFFSET (164.8.5-REVIEW-R2
  // WR-R2-05). Catching the throw HERE was still substitutive for every span the
  // unwind skipped, because the throw came from INSIDE the recursion and took
  // the parent's remaining `dollarRegions` loop and its whole single-quoted-body
  // walk with it. MEASURED: `SIBLING then DEEP` named the credential,
  // `DEEP then SIBLING` reported `["command-unjudgeable"]` alone — the same two
  // statements, reordered. The depth cap now RECORDS a refusal and returns, so
  // the traversal completes and the refusal is reported beside every finding the
  // rest of the command produced. `codeSpans` appends into both out-parameters
  // as it recurses, so passing our own arrays keeps everything it reached.
  const spans = [];
  const refusals = [];
  codeSpans(text, 0, 0, spans, refusals);
  if (refusals.length > 0) {
    say(
      "command-unjudgeable",
      `job ${name} carries a command this module gave up lexing (${refusals.join("; ")}). The rules ran over the ${spans.length} span(s) that WERE read, and any finding they report is real — but the unread part was NOT judged, and an unjudged command is not a clean one.`,
    );
  }

  for (const span of spans) {
    if (headerCarriesLiteral(span, "X-Service-Key")) {
      say(
        "x-service-key-literal",
        `job ${name} passes an X-Service-Key header as an inline quoted literal — this is the exact pre-2026-09-01 shape that kept a live analytics key inside cron.job.command for months. Resolve it from vault.decrypted_secrets at execution time instead.`,
      );
    }
    if (headerCarriesLiteral(span, "Authorization")) {
      say(
        "authorization-literal",
        `job ${name} passes an Authorization header as an inline quoted literal long enough to be a credential.`,
      );
    }
    if (headerCarriesLiteral(span, "apikey")) {
      say(
        "apikey-literal",
        `job ${name} passes an apikey header as an inline quoted literal long enough to be a credential.`,
      );
    }
    const regions = headerRegions(span);
    for (const region of regions) {
      if (region.unparseable) {
        say(
          "header-unparseable",
          `job ${name} has a header argument list whose parentheses do not balance, so its contents cannot be delimited and its value cannot be judged. An unjudgeable command is not a clean one — fix the command text, or re-capture it if the reading itself was truncated.`,
        );
        continue;
      }
      // ⚠️ The DERIVED length of EVERY depth-0 argument, not of the first
      // literal: a `||`-split or builder-assembled value under a header name
      // outside the three anchored ones is the same defect spelled differently.
      // A single literal sums to itself, so the pre-existing red row still
      // fires and `HEADERS_LITERAL_MAX` never moved.
      //
      // ACCEPTED RESIDUAL, recorded beside the rule it belongs to: a derived
      // value of 16-31 characters under a NON-anchored header name sits below
      // this threshold, whose VALUE D4 locks. That is the pre-existing
      // threshold POLICY — the three anchored names are the ones the achievable
      // configuration sends a credential under, and lowering the general
      // threshold fires on `'application/json'`-class constants. It is not a
      // bypass family.
      const long = depth0Args(span, region.from, region.to).some(
        ([a, b]) => derivedLiteralLength(span, a, b) >= HEADERS_LITERAL_MAX,
      );
      if (long) {
        say(
          "long-literal-in-headers",
          `job ${name} passes a value deriving ${HEADERS_LITERAL_MAX}+ characters of literal text inside a header argument list. Header constants are short ('application/json' is 16); anything that long is a value, and a value in a header is a credential.`,
        );
        // ⚠️ No `break`. The old loop broke out to avoid repeating itself;
        // `say` now de-duplicates, and breaking would let a long literal in an
        // EARLY region hide an unparseable region later in the same command.
      }
    }

    // ⭐ `long-token-anywhere` — THE ONLY RULE THAT CATCHES BYPASSES (h) AND
    // (i), WHICH ARE WHAT A NORMAL DEVELOPER WRITES:
    //
    //   (h) k := '<key>';                          … jsonb_build_object('X-Service-Key', k)
    //   (i) h := '{"X-Service-Key":"<key>"}'::jsonb; … headers := h
    //
    // Neither obfuscates anything. In (h) the header VALUE is a variable, so
    // every header-anchored rule sees nothing to measure; in (i) the header
    // NAME lives inside a bigger literal, so the anchor never matches on the
    // mask. Every other rule in this file looks at a header region, and the key
    // in both shapes is somewhere else entirely.
    //
    // ⛔ WHY TOKENS AND NOT LITERALS, MEASURED. "any literal >= 32 anywhere"
    // fires on 5 of the 14 committed PROD commands at EVERY threshold up to 64
    // — six hits, all of them `RAISE` message prose or one URL, 73 to 156
    // characters. An hourly prober that cries wolf on real configuration is how
    // a true positive gets ignored. Splitting literal CONTENT on whitespace and
    // testing TOKENS, then requiring a DIGIT and rejecting bare URLs, measures
    // to ZERO false positives on that same corpus while still catching (h) and
    // (i). The token census is in 164.8.5-RESEARCH.md Q4.
    //
    // ⚠️ ACCEPTED RESIDUAL (A2, T-164.8.5-21): a purely alphabetic 32+ character
    // key evades the digit test. Every credential shape this repository has
    // recorded — `sk_live_`-style, `eyJ…` JWTs, hex digests — carries a digit,
    // and dropping the test costs the zero-FP budget outright (the two 32/34
    // character job-name tokens in the committed corpus are clean ONLY for lack
    // of one). Recorded rather than closed.
    //
    // ⛔ REGION EXCLUSION, BOTH KINDS (Q2 + W7). A token inside a header region
    // belongs to `long-literal-in-headers`, and letting both fire would break
    // the red fixtures' one-rule isolation. An UNPARSEABLE region is excluded
    // too and for a different reason: its only honest verdict is
    // `header-unparseable`, because nobody can delimit its contents to
    // enumerate them. The partition loses nothing while
    // `TOKEN_MIN >= HEADERS_LITERAL_MAX` — see the derivation beside
    // `TOKEN_MIN`, which the wiring test pins.
    //
    // ⛔ THE TOKEN TEST ITSELF IS ONE FUNCTION WITH TWO PRODUCERS — literals
    // and comment bodies (164.8.5-REVIEW-R1 WR-R1-01). It is factored out
    // rather than duplicated so the two can never drift: a threshold or an
    // exemption added for one would otherwise silently not apply to the other,
    // which is precisely how the comment path came to be uncovered.
    //
    // ⛔ THE `vaultSpan` EXEMPTION WAS DELETED IN 164.8.5-REVIEW F5, AND ITS
    // ABSENCE IS THE SAFEGUARD. It read
    //
    //     const vaultSpan = VAULT_READ_RE.test(span.masked);
    //     …
    //     if (vaultSpan && BARE_URL_RE.test(token)) continue;
    //
    // one line BELOW the unconditional `BARE_URL_RE` test, which already
    // handles the only condition that could make it true — and `vaultSpan` had
    // no other reader, so the line could not execute. It was dressed as a
    // security exemption, so the next reader had to re-derive its
    // unreachability before touching anything near it, and an edit to the test
    // ABOVE would have silently changed its meaning with NO test moving. A
    // redundant line that cannot execute is worse than a deleted one. Do not
    // "restore" it: the bare-URL exemption below is the whole of it.
    const testTokens = (text, where) => {
      for (const token of String(text).split(/\s+/)) {
        if (token.length < TOKEN_MIN) continue;
        if (!/\d/.test(token)) continue;
        // ⚠️ `TRIM_PUNCT` — see the constant. The LENGTH test above read the
        // real token; this reads the token without the prose punctuation glued
        // to it, which is the only difference between a URL in a sentence and
        // the same URL alone.
        if (isBareUrl(token.replace(TRIM_PUNCT, ""))) continue;
        // Already `jwt-shape`'s finding. Without this the JWT red row would fire
        // TWO rules and its isolation assertion — the thing that makes a red row
        // attributable — would fail.
        if (/eyJ[A-Za-z0-9_-]{20,}/.test(token)) continue;
        say(
          "long-token-anywhere",
          `job ${name} carries a ${TOKEN_MIN}+ character whitespace-delimited token containing a digit inside a ${where}. A value that long is not a header constant or a message: it is a credential that has been moved out of the header expression — into a variable, into a whole-header JSON blob, or into a comment — where the header rules cannot see it.`,
        );
      }
    };

    for (const lit of literalsIn(span)) {
      // ⛔ `!r.unparseable` — PARSEABLE REGIONS ONLY (164.8.5-REVIEW F2). The
      // exclusion used to cover UNPARSEABLE regions too, and an unparseable
      // region runs to the END OF THE SPAN, so ONE stray `(` excluded every
      // literal after it. REPRODUCED: a token that reports
      // `["long-token-anywhere"]` reports `["header-unparseable"]` alone once a
      // header argument list is left open, and `header-unparseable` is the sole
      // `UNJUDGEABLE_RULE_IDS` member — so the finding routes to `measure-fail`
      // and NO RULE NAMES THE TOKEN. Still exit 1, so a downgrade rather than a
      // false green, but an off-switch an adversary holds with ONE CHARACTER,
      // on the one rule that exists to catch bypasses (h) and (i).
      //
      // ⛔ THE OLD COMMENT'S DEFENCE — "nobody can delimit its contents to
      // enumerate them" — IS TRUE OF THE WRONG WALK. It holds for
      // `depth0Args`, which needs balanced parens to split arguments. It does
      // NOT hold for `long-token-anywhere`, which splits a literal's CONTENT on
      // whitespace and needs no paren structure at all.
      //
      // ⚠️ `header-unparseable` now fires ALONGSIDE this rule on such a
      // command, so a fixture covering it declares BOTH ids. That is the right
      // trade: one-rule isolation is a property of the RED fixture file, and
      // preserving it at the cost of never naming the credential is the
      // measurement serving the harness.
      //
      // ⛔ EXCLUDE ONLY WHAT `long-literal-in-headers` COULD ACTUALLY SEE
      // (164.8.5-REVIEW-R1 CR-R1-01). THE INVARIANT: a literal may be handed to
      // the header rules ONLY if the header measurement really EXAMINED it —
      // being LOCATED inside a header region is not the same thing as having
      // been COUNTED by one.
      //
      // The old test was pure location. The Q2 partition argued that a literal
      // inside a header region is an argument of at least its own derived
      // length, so `long-literal-in-headers` owns it — but that is false
      // wherever `derivedLiteralLength` deliberately refuses to descend: it
      // never enters `(SELECT …)` and skips whole any `(` whose callee is not
      // in `BUILDERS`. Such an argument derives 0, the three anchored header
      // rules measure 0 < `HEADER_LITERAL_MIN`, and the only rule left had been
      // switched off for that region.
      //
      // ⛔ AND THE SHAPE THAT DOES IT IS ORDINARY CODE, NOT OBFUSCATION.
      // MEASURED 2026-09-11, a 37-character digit-bearing key directly under
      // 'X-Service-Key' behind `coalesce(nullif(v_key,''), '<key>')` — "read the
      // config, else the hardcoded fallback" — reported ZERO violations from
      // EVERY rule in `HYGIENE_RULE_IDS`, and `captureManifest` returned 0 and WROTE THAT KEY
      // into the oracle committed to a PUBLIC repository. `nullif`,
      // `(SELECT …)` and any non-BUILDERS wrapper behaved identically. The
      // identical key written PLAINLY, and the identical `coalesce` OUTSIDE a
      // header region, were both caught — moving the credential INTO the header
      // expression is what made it invisible, which is the precise inversion of
      // what this rule set is for.
      //
      // ⛔ NO THRESHOLD MOVES. D4's `HEADER_LITERAL_MIN` / `HEADERS_LITERAL_MAX`
      // are untouched and `TOKEN_MIN` stays derived; what changed is the
      // PREDICATE, from "is located in" to "was counted by".
      if (
        regions.some(
          (r) =>
            !r.unparseable &&
            lit.start < r.to &&
            lit.end > r.from &&
            depth0Args(span, r.from, r.to).some(
              ([a, b]) =>
                lit.start >= a && lit.end <= b && derivedLiteralLength(span, a, b) >= lit.content.length,
            ),
        )
      )
        continue;
      testTokens(lit.content, "string literal, outside any header argument list");
    }

    // ⛔ AND THE SAME TEST OVER COMMENT BODIES (164.8.5-REVIEW-R1 WR-R1-01) —
    // the D-05 parallel is recorded on `commentsIn`. A comment needs NO header
    // exclusion: it is never an argument of anything, so nothing else could
    // have counted it.
    for (const c of commentsIn(span)) {
      testTokens(c.content, "COMMENT — commenting a key out does not remove it, and the next capture writes that comment into a manifest committed to a public repository");
    }
  }

  // The text-shape rules. They read each span's RAW `sql` rather than its mask
  // BY DESIGN: `'app.` lives inside a literal, `service_role` is a literal in
  // its own red row, and a JWT and a Bearer token are shapes of text. Masking
  // those would blank the very thing they match. Iterating spans changes
  // nothing today (the outer raw text already contains each body) — they are
  // written this way so both families read the same input list.
  for (const span of spans) {
    // ⛔ BYTE-IDENTICAL to `DETECT_RE` in `scripts/lint-app-guc.mjs` — this repo
    // has ONE definition of what an app-GUC read looks like, and
    // `src/__tests__/lint-app-guc.test.ts` pins that identity by SUBSTRING, so
    // drifting either copy reds the suite. Widened 2026-09-11 (plan 164.8.5-07,
    // 164.7-REVIEW WR-07) to the five spellings the single-quote form missed;
    // the six detected forms are tabulated in `lint-app-guc.mjs`'s docstring.
    if (
      /current_setting\s*(?:\/\*[\s\S]*?\*\/\s*)?\(\s*(?:(?:\/\*[\s\S]*?\*\/|--[^\n]*\n)\s*)?(?:[EU]&?)?'{1,2}app\.|current_setting\s*(?:\/\*[\s\S]*?\*\/\s*)?\(\s*(?:(?:\/\*[\s\S]*?\*\/|--[^\n]*\n)\s*)?\$[A-Za-z_]*\$app\./i.test(
        span.sql,
      )
    ) {
      say(
        "app-guc",
        `job ${name} reads a current_setting('app.…') GUC. Setting those needs ALTER DATABASE … SET on a placeholder GUC, which returns 42501 on Supabase — a job carrying this design is not the achievable configuration and cannot be the standard PROD is judged against.`,
      );
    }
    // ⚠️ IN-04. THREE ARMS, AND THEY ARE DELIBERATELY DISJOINT — each one can
    // be neutered alone and exactly one red row goes clean.
    //
    //  1. `password :=` on MASKED — the plpgsql assignment. The `:=` is CODE,
    //     so it survives masking. The mask is what makes this arm mean "an
    //     assignment", because inside a literal it would be blank.
    //  2. `PGPASSWORD` / `password=` on RAW — these live INSIDE a connection
    //     string literal (`'host=… password=…'`), whose contents the mask
    //     blanks, so raw text is the only place they exist.
    //  3. the libpq URI on RAW — likewise a literal.
    //
    // ⛔ ARM 2 IS `password\s*=`, NOT `password\s*:?=`. With the colon
    // optional it would also match `v_password :=` in the raw text and SUBSUME
    // arm 1 entirely — arm 1 could then never be the reason a command is
    // flagged, i.e. a control that cannot fail. The colon is what keeps them
    // separable. MEASURED before this plan: the assignment form and the URI
    // form were both MISSED; only the bare `PGPASSWORD` arm fired.
    if (
      /password\s*:=/i.test(span.masked) ||
      /PGPASSWORD/i.test(span.sql) ||
      /password\s*=/i.test(span.sql) ||
      /postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/i.test(span.sql)
    ) {
      say(
        "pg-password",
        `job ${name} carries a database password (a PGPASSWORD/password= assignment, a plpgsql password variable assignment, or a libpq URI with credentials in it). A cron command should never hold connection credentials in its text.`,
      );
    }
    if (/'Bearer\s+[A-Za-z0-9._-]{8,}/i.test(span.sql)) {
      say(
        "bearer-literal",
        `job ${name} carries a Bearer token that continues INSIDE its own quotes — the achievable shape closes the quote right after the space ('Bearer ' || <expr>) and does not match this.`,
      );
    }
    if (/service_role/i.test(span.sql)) {
      say(
        "service-role",
        `job ${name} names service_role. A cron command referencing the service role is either carrying a service-role key or escalating to it; both are findings.`,
      );
    }
    if (/eyJ[A-Za-z0-9_-]{20,}/.test(span.sql)) {
      say(
        "jwt-shape",
        `job ${name} contains a JWT-shaped literal (an eyJ… header segment). This is the shape Supabase's own pg_cron → pg_net documentation puts directly in headers, which is how it reaches production by copy-paste.`,
      );
    }
  }

  // ⛔ `vault-absent` IS NOT `text.includes("vault.decrypted_secrets")`, AND THE
  // DIFFERENCE IS THE WHOLE POINT OF THIS RULE.
  //
  // It serves two phases pulling in opposite directions (D2):
  //   · 164.5.1 needs `SELECT public.match_engine_cron_tick();` ACCEPTED — that
  //     command contains no Vault reference at all; the callable reads Vault in
  //     its own body.
  //   · This phase needs a command that names the table only in a `--` comment
  //     or inside a string literal REJECTED — `includes()` accepted both, which
  //     made the rule satisfiable by typing a comment.
  //
  // So the question is REACHABILITY OF AN EXECUTING READ: the `FROM`/`JOIN`
  // shape on some span's MASKED text (masked, so comments and literal contents
  // are blank), or a call — also on masked text — to a public/unqualified
  // function whose COMMITTED body reaches one, transitively.
  //
  // ⚠️ THE JUDGEMENT IS AGAINST THE COMMITTED SNAPSHOT, NEVER PROD'S BODIES.
  // `supabase/schema/functions/` is a hermetic replay of the migrations; whether
  // PROD's live body still matches it is VAC-04's question, not this arm's. The
  // sentence below says so out loud so nobody reads a green here as proof about
  // production.
  if (name === "match_engine_cron") {
    const { reads, unresolved } = reachesVaultRead(spans, functionsDir);
    if (!reads) {
      // ⛔ NAMES ONLY, NEVER VALUES. `unresolved` holds FUNCTION NAMES the
      // resolver could not find a snapshot file for — safe to print into a
      // world-readable Actions log, unlike any part of the command text.
      const named =
        unresolved.length > 0
          ? // ⛔ THE SENTENCE NAMES EVERY CALLABLE THE RESOLVER COULD NOT READ, AND
            // SAYS WHY (164.8.5-REVIEW F6). It used to claim the named callables
            // "have no file in the committed function snapshot" — true of one of
            // the two skip reasons. A definition whose body is not dollar-quoted
            // (`AS 'SELECT …'`) HAS a file and was dropped ANYWAY, contributing no
            // body and no entry, so the sentence could not say it had skipped
            // anything. Each entry now carries its own reason.
            ` The command calls ${unresolved.join(", ")}, which this arm could not read a body for — either no file in the committed function snapshot, or a definition the snapshot reader does not expose — so it could not be shown to read Vault either. An unjudged callable is never assumed to be a reader.`
          : "";
      say(
        "vault-absent",
        `job ${name} does not reach a Vault read that EXECUTES: neither the command itself nor any public function it calls reads FROM vault.decrypted_secrets in its committed body. Naming the table in a comment or inside a string literal is not reading it.${named} The achievable configuration resolves its key from Vault at execution time, so a command without it is obtaining the key some other way — and the only other ways this project has used put it in the command text. This judgement is against the COMMITTED bodies in supabase/schema/functions/, not against PROD's; repo-vs-PROD body drift is VAC-04's question.`,
      );
    }
  }

  return out;
}

/** Rule ids whose finding is "I could not judge this", not "this carries a secret". */
const UNJUDGEABLE_RULE_IDS = ["header-unparseable", "command-unjudgeable", "jobname-absent"];

/**
 * How a jobname is PRINTED. Identical to `hygieneViolations`' own derivation so
 * a defect detail and the rule sentence inside it name the row the same way.
 * ⛔ It is for TEXT only — `subject` stays the raw jobname, because that is the
 * key scenarios and the issue body match on.
 */
const shownName = (jobname) =>
  typeof jobname === "string" && jobname.trim().length > 0 ? jobname.trim() : "an unnamed job";

/**
 * Split a violation list into the two things a caller must report DIFFERENTLY.
 *
 * ⛔ THE REMEDY IS WHY THIS EXISTS. `cron-secret-in-command`'s remedy says
 * "treat the named secret as EXPOSED — rotate it". That sentence is FALSE for a
 * command whose parentheses do not balance: nothing was found, something could
 * not be read. Reporting a parse failure under a rotation remedy would send an
 * operator to rotate a key on no evidence, and — worse — would teach them that
 * the arm's rotation calls are sometimes noise.
 *
 * It stays a VIOLATION, so `captureManifest` still refuses to write an oracle
 * containing it. It is merely CLASSIFIED as `measure-fail`, a kind that already
 * exists: adding a new `DEFECT_KIND` would need four other pins edited in step
 * (`DEFECT_KINDS`, `EXPECTED_DEFECT_KINDS`, `KIND_ASSERTIONS`, the coverage
 * extractor) for no gain in meaning.
 */
export function splitHygiene(violations) {
  const credential = [];
  const unjudgeable = [];
  for (const v of violations) {
    const id = v.slice(1, v.indexOf("]"));
    (UNJUDGEABLE_RULE_IDS.includes(id) ? unjudgeable : credential).push(v);
  }
  return { credential, unjudgeable };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse psql `-At -F <US> -R <RS>` output into `cron.job` row objects.
 *
 * ⛔ A ROW THE PARSER COULD NOT READ IS NOT A ROW THAT IS NOT THERE. A record
 * with fewer than seven fields used to be `continue`d away, so a `cron.job`
 * command containing a record separator (see `CRON_JOB_SEPARATORS`) removed
 * itself from every judgement this arm makes — including the credential scan —
 * and the run still read green. Such a record is COUNTED here and answered with
 * a `measure-fail` by both callers.
 *
 * ⛔ THE FIELD COUNT IS `!== CRON_JOB_COLUMNS.length`, NOT `< 7` (164.8.5-REVIEW
 * CR-02). The guard used to be `< 7` and was therefore blind in the OTHER
 * direction, which is the exact mirror of the defect above and strictly worse:
 * a command carrying a literal FIELD separator (0x1F) splits into one field too
 * many, `command` was taken as `f[6]` — the text up to that byte — and the
 * remainder was SILENTLY DISCARDED with `malformed: []`. MEASURED: an over-wide
 * record whose full command reports `[x-service-key-literal,
 * long-literal-in-headers]` reported `[]` once truncated, and the run read
 * green. The width is the column count of `CRON_JOB_SQL`, DERIVED from
 * `CRON_JOB_COLUMNS`; anything else is a record this parser did not read, in
 * either direction.
 *
 * ⛔ AND THE FIELD COUNT ALONE CANNOT CLOSE THE CLASS (164.8.5-REVIEW-R1
 * CR-R1-03). `!== 7` was a fix for one SPELLING, not for the defect. A RECORD
 * separator (0x1E) inside a command splits the record into two, and the head
 * fragment of such a split used to carry EXACTLY the required seven fields — so
 * `!== 7` could never fire on it, by construction. MEASURED at the parent
 * commit, both surviving spellings reported `malformed: []`:
 *
 *   - a tail carrying six further 0x1F parsed as a FABRICATED row, while the
 *     REAL row's command was truncated to the clean head — three rows out of a
 *     two-row reading, one of them a job that does not exist, and the credential
 *     attributed to the phantom;
 *   - a whitespace-only tail was swallowed by the (correct-in-isolation)
 *     empty-record skip, leaving only the truncation.
 *
 * ⭐ THE INVARIANT: A DELIMITER-BASED PARSER CANNOT SELF-VALIDATE A DELIMITER
 * APPEARING IN ITS PAYLOAD. Whatever it counts, it counts about FRAGMENTS, and a
 * fragment can be well-formed. It needs an OUT-OF-BAND count, which is why
 * `CRON_JOB_SQL` carries `count(*) OVER () AS total` — computed by Postgres over
 * the real rows, before any separator was chosen — and why `total` is the LAST
 * column: the head fragment of a payload-RS split then loses it and is SHORT,
 * so the width guard bites as well.
 *
 * Two guards, two failure modes, each independently neuterable:
 *   (A) `f.length !== CRON_JOB_COLUMNS.length` — a fragment of any split.
 *   (B) `rows.length + malformed.length === total` — a record that VANISHED or
 *       a record that was FABRICATED. It catches what (A) cannot: a stdout
 *       truncated at a record boundary loses whole rows and leaves every
 *       surviving record perfectly well-formed.
 *
 * The EMPTY-record skip is different and is CORRECT: psql prints the record
 * separator AFTER every record, last one included, so the trailing empty string
 * is an artefact of the format rather than a row. ⛔ It is also why (B) is not
 * optional — the skip is exactly what swallows a whitespace-only tail.
 *
 * ⚠️ REJECTED, and recorded so it is not re-proposed: "refuse any record whose
 * `command` field contains either separator byte". MEASURED to be VACUOUS —
 * `command` is produced by splitting on both bytes, so it can never contain
 * one. A guard that cannot fail is worse than no guard, because it reads as
 * coverage.
 *
 * @returns {{rows: Array<object>, malformed: Array<{index:number, fields:number}>, total: number|null, countMismatch: string|null}}
 *          `malformed` carries the record INDEX and its FIELD COUNT and never
 *          the record TEXT — that text is exactly what may hold the credential
 *          this arm exists to find, and every detail it produces is world-readable.
 *          `total` is the database's own row count, or `null` when no record
 *          carried one. `countMismatch` is a ready-to-print sentence, or `null`.
 */
export function parseCronJobRows(stdout) {
  const out = [];
  const malformed = [];
  const totals = new Set();
  let index = -1;
  for (const record of String(stdout || "").split(CRON_JOB_SEPARATORS.recordSep)) {
    index += 1;
    const rec = record.replace(/^[\r\n]+/, "");
    if (rec.trim().length === 0) continue;
    const f = rec.split(CRON_JOB_SEPARATORS.fieldSep);
    // (A) WIDTH.
    if (f.length !== CRON_JOB_COLUMNS.length) {
      malformed.push({ index, fields: f.length });
      continue;
    }
    if (/^\d+$/.test(f[7].trim())) totals.add(Number.parseInt(f[7].trim(), 10));
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

  // (B) COMPLETENESS, against the count the DATABASE produced.
  //
  // ⛔ `total === null` IS ONLY BENIGN WITH NOTHING TO COUNT. `count(*) OVER ()`
  // returns no rows at all for an empty `cron.job`, which is a state the arm
  // already answers loudly ("every scheduled job has vanished"). With records in
  // hand and no total, something between the query and this parser dropped the
  // column, and that is a hole rather than a reading.
  const total = totals.size === 1 ? [...totals][0] : null;
  let countMismatch = null;
  if (totals.size > 1) {
    countMismatch =
      `the cron.job records disagree about how many rows the database returned (${[...totals].sort((a, b) => a - b).join(", ")}). ` +
      "count(*) OVER () is one number per reading, so two answers means the records were assembled from fragments of different records.";
  } else if (out.length + malformed.length > 0 && total === null) {
    countMismatch =
      `${out.length + malformed.length} cron.job record(s) were read and NOT ONE carried the out-of-band row count that ${"count(*) OVER ()"} adds. ` +
      "Without it nothing can say whether this reading is complete, and an unverifiable reading is not a complete one.";
  } else if (total !== null && out.length + malformed.length !== total) {
    countMismatch =
      `the database reported ${total} cron.job row(s) but this reading yielded ${out.length + malformed.length} record(s) ` +
      `(${out.length} parsed, ${malformed.length} unreadable). A record separator (0x1E) inside a command splits one row into two, and a truncated read loses whole rows; either way the rows and the count are the only two independent statements about completeness this arm has, and they disagree.`;
  }

  return { rows: out, malformed, total, countMismatch };
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
 * CR-04 — the manifest fields whose ABSENCE would make the comparison agree
 * with PROD by accident, checked for presence in section (1)'s row loop.
 *
 * ⛔ ONE LOOP, THREE CONTROLS. The predicate is identical for all three, so
 * spelling it out three times would be three chances to typo it (SR-09) — but
 * the loop is the IMPLEMENTATION, not the control. `schedule` is WHEN a job
 * runs, `username` is the ROLE it executes as, `database` is WHERE it runs;
 * each is independently load-bearing, and each is neuter-proved ALONE with the
 * other two left live (D3). Removing a name from this list must redden exactly
 * one test.
 *
 * `active` is NOT here because its collapse is a different one — see the
 * boolean guard beside the loop.
 */
const REQUIRED_ROW_STRINGS = ["schedule", "username", "database"];

/**
 * CR-01 — the manifest fields compared per job that are neither `schedule`,
 * `active` nor the command sha.
 *
 * MEASURED 2026-09-10 on the reverted repair: `compareManifest` COLLECTED
 * `username` and `database` on all fourteen manifest rows and compared
 * NEITHER, so a cron job repointed from `postgres` to a more privileged role
 * and moved to another database produced `defects: []`. `username` is the
 * pg_cron column that decides which role the command executes as, which makes
 * an unnoticed change to it a privilege escalation this arm was blind to.
 *
 * ⛔ Each name here is its own control with its own red fixture
 * (`prod-username-changed.json`, `prod-database-changed.json`) and is neutered
 * alone. `schedule` is deliberately NOT in this list: it keeps its own line so
 * that restricting this list cannot darken it too.
 */
const COMPARED_ROW_STRINGS = ["username", "database"];

/**
 * @param {object|null} manifest   parsed `cron-manifest.json` (null when absent/unparsable)
 * @param {Array<object>} prodRows from `parseCronJobRows`
 * @param {object} opts
 * @param {string} opts.liveMarker  ⛔ MANDATORY. The `COMMENT ON DATABASE` marker read from the
 *        database this reading came from. Absent or empty is a `measure-fail`, never a pass.
 * @param {string|null} [opts.manifestReadError]  the reason the oracle could not be read, if any
 * @param {string} [opts.manifestPath]            the path it was looked for at, named in that defect
 * @param {string} [opts.functionsDir]            the committed function snapshot `vault-absent` resolves
 *        callables against; defaults to `FUNCTIONS_DIR`. Threaded so BOTH hygiene loops — PROD-side (0)
 *        and manifest-side (2) — judge against the SAME snapshot. Two different answers to "does this
 *        command reach Vault" for the same text would be a defect nobody could attribute.
 * @returns {{defects: Array<{kind:string, subject:string|null, detail:string}>, lines: string[]}}
 */
export function compareManifest(manifest, prodRows, opts = {}) {
  const defects = [];
  const lines = [];
  const drift = (subject, headline) => defects.push({ kind: "cron-drift", subject, detail: withReadings(headline) });

  // -------------------------------------------------------------------------
  // (0) PROD-SIDE HYGIENE, ABOVE EVERY `return` IN THIS FUNCTION.
  //
  // ⛔ DO NOT MOVE THIS BELOW ANY RETURN. MEASURED on the reverted repair
  // `84b21cb5`: with a PROD command carrying an inline JWT, appending a tidy
  // ` -- comment` to the MANIFEST's copy of that command collapsed the whole
  // result to `manifest-invalid` and the `cron-secret-in-command` finding
  // VANISHED for all fourteen jobs. This arm's own adversary is someone
  // hand-cleaning the committed text, and an oracle-validity check placed above
  // the live credential scan hands them an off switch.
  //
  // This loop reads `prodRows` ONLY. It needs nothing from the oracle, so no
  // oracle state — absent, unparsable, schema-bumped, hand-edited, or captured
  // from a different database — can silence it.
  // -------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // F3 (164.8.5-REVIEW) — A ROW THAT CANNOT BE JUDGED IS ONE ROW, NOT THE RUN.
  //
  // ⛔ `hygieneViolations` THROWS, and this function collects into a LOCAL array
  // returned only at the end. `reachesVaultRead` refusing on an absent snapshot
  // directory is RIGHT — absence of the instrument is not absence of the finding
  // — but it happens inside a PER-ROW loop, so the throw took every defect
  // already collected with it. MEASURED with two rows, one leaking: an absent
  // `functionsDir` turned `["cron-secret-in-command:prod:leaky_job",
  // "manifest-invalid:…"]` into a THROW, i.e. into ONE generic arm-level
  // measure-fail. Delete or fail to regenerate `supabase/schema/functions/` and
  // the `cron-secret-in-command` line — the signal, in a workflow that exits 0
  // on everything else — was simply gone.
  //
  // So the refusal is SCOPED to the row it belongs to: that row becomes a
  // `measure-fail` naming itself, and every other row is still judged.
  // ---------------------------------------------------------------------------
  const judgeRow = (jobname, command) => {
    try {
      return { violations: hygieneViolations(jobname, command, { functionsDir: opts.functionsDir }), error: null };
    } catch (err) {
      return { violations: null, error: err && err.message ? err.message : String(err) };
    }
  };

  // ---------------------------------------------------------------------------
  // CR-R1-02 (164.8.5-REVIEW-R1) — THE HYGIENE MAPS RECORD A VERDICT, NEVER A
  // BARE ARRAY, AND "NOT IN THE MAP" IS NOT A VERDICT.
  //
  // ⛔ THE INVARIANT: every consumer of a hygiene map must distinguish NO ENTRY
  // (the row was never judged) from an EMPTY entry (the row was judged and is
  // clean) — and an unjudged row must WITHHOLD exactly as a dirty one does.
  //
  // The F3 repair above scopes a refusal to its row by `continue`-ing without
  // ever calling `.set(…)`, so the row is ABSENT. The consumer below used to
  // read `(map.get(name) || []).length > 0`, which coerces absence to `false`:
  // "could not be judged" became "passed hygiene", and the text-withholding
  // rule then printed the full command text of the ONE row nobody could clear,
  // into a log `prod-prober.yml` `cat`s into a PUBLIC Actions log and which the
  // step summary and the auto-filed issue copy verbatim (D-03). `makeScrubber`
  // redacts each arm's `requiredEnv` VALUES and knows nothing about an inline
  // key in `cron.job.command`.
  //
  // REPRODUCED 2026-09-11, two independent triggers, neither needing an
  // adversary: (a) an absent `supabase/schema/functions/` makes
  // `reachesVaultRead` throw, (b) a command nesting `DO` bodies deeper than
  // `MAX_DOLLAR_DEPTH` makes `codeSpans` throw — for ANY jobname. Both printed
  // the credential.
  //
  // ⭐ THE REFUSAL IS NOW EXPLICIT AT THE POINT OF REFUSAL rather than
  // inferable at the point of use: `recordVerdict` writes a `judged: false`
  // sentinel into the map, and `hygieneVerdict` below still treats a MISSING
  // entry as unjudged so that a future third producer that forgets to record
  // cannot re-open this hole.
  // ---------------------------------------------------------------------------
  const recordVerdict = (map, jobname, judged) =>
    map.set(
      jobname,
      judged.error !== null
        ? { judged: false, violations: [], reason: judged.error }
        : { judged: true, violations: judged.violations, reason: null },
    );

  const UNRECORDED = Object.freeze({
    judged: false,
    violations: [],
    reason: "no hygiene verdict was recorded for this row at all",
  });
  const hygieneVerdict = (map, jobname) => map.get(jobname) ?? UNRECORDED;

  const rows = Array.isArray(prodRows) ? prodRows : [];
  const prodHygiene = new Map();
  for (const row of rows) {
    const judged = judgeRow(row.jobname, row.command);
    recordVerdict(prodHygiene, row.jobname, judged);
    if (judged.error !== null) {
      defects.push({ kind: "measure-fail", subject: `prod:${row.jobname}`, detail: judged.error });
      continue;
    }
    const v = judged.violations;
    const { credential, unjudgeable } = splitHygiene(v);
    if (credential.length > 0) {
      defects.push({
        kind: "cron-secret-in-command",
        subject: `prod:${row.jobname}`,
        // ⚠️ `shownName`, not `row.jobname`: an unnamed row is now JUDGED
        // (CR-R2-01) and interpolating `""` produced "the PROD cron.job row for
        //  fails 2 hygiene rule(s)", which reads like a truncation bug.
        detail: `the PROD cron.job row for ${shownName(row.jobname)} fails ${credential.length} hygiene rule(s): ${credential.join(" ")}`,
      });
    }
    if (unjudgeable.length > 0) {
      defects.push({
        kind: "measure-fail",
        subject: `prod:${row.jobname}`,
        detail: `${unjudgeable.join(" ")} The command could not be judged, and an unjudged command is not a clean one.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // (0b) WHICH DATABASE WAS THIS READ FROM? MANDATORY, and checked here rather
  //      than only at the call site so that a future second caller cannot omit
  //      it. Note the `return` carries section (0)'s findings with it: a
  //      reading whose provenance failed still reports the credentials it saw.
  // -------------------------------------------------------------------------
  const liveMarker = typeof opts.liveMarker === "string" ? opts.liveMarker.trim() : "";
  if (liveMarker.length === 0) {
    defects.push({
      kind: "measure-fail",
      subject: "database marker",
      detail:
        "the live database marker was never established, so no statement about drift can be made. current_database() is `postgres` on every Supabase project and proves nothing; the hand-set COMMENT ON DATABASE marker is the only identification that exists.",
    });
    return { defects, lines };
  }

  // -------------------------------------------------------------------------
  // (1) Validate the ORACLE. Comparing against an invalid oracle would
  //     produce confident nonsense — and "no manifest" must never read as "no
  //     drift", which is the whole SKIP-01 shape this phase exists to remove.
  // -------------------------------------------------------------------------
  const invalid = (why) => {
    defects.push({ kind: "manifest-invalid", subject: "cron-manifest.json", detail: why });
    return { defects, lines };
  };

  const readError = typeof opts.manifestReadError === "string" ? opts.manifestReadError.trim() : "";

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    if (readError.length > 0) {
      return invalid(
        `the cron manifest at ${opts.manifestPath || "<unknown path>"} could not be read or parsed: ${readError}. No comparison happened; that is not the absence of drift.`,
      );
    }
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
    // -----------------------------------------------------------------------
    // (1a) THE COMMAND IS BOUND TO ITS OWN SHA (WR-11).
    //
    // ⛔ MEASURED on the reverted repair: hand-cleaning a manifest row's
    // `command` text while leaving its machine-produced `command_sha256` alone
    // reported CLEAN on the manifest side — the hygiene scan judged text that
    // was never captured — and then printed a DIFF between that fabricated
    // text and PROD, which is a fictional diff about a fictional oracle. The
    // sha is what the comparison uses; the text is what a human reads and what
    // section (2) scans. Nothing made them describe the same command.
    //
    // Only the first twelve hex of each digest is printed: they are truncated
    // digests of command TEXT that is already published in this same file, so
    // there is no new leak surface, and twelve is enough to point a reviewer at
    // the right row without inviting a byte-comparison by eye.
    //
    // ⚠️ This sits BELOW section (0) on purpose. Above it, this very return
    // would hand the arm's own adversary the off switch that reverted the first
    // repair — see the `HAND-EDITED` self-test scenario, which drives dirty
    // PROD rows through exactly this defect and requires the credential anyway.
    // -----------------------------------------------------------------------
    if (typeof row.command === "string") {
      const derived = sha256Hex(normalizeCommand(row.command));
      if (derived !== row.command_sha256) {
        return invalid(
          `cron manifest row ${row.jobname}: its command text hashes to ${derived.slice(0, 12)} but the command_sha256 it publishes is ${String(row.command_sha256).slice(0, 12)}. The two fields describe different text, so the printed diff and the manifest-side hygiene scan are about a command that was never captured. Re-capture rather than hand-editing; to hide text, use the withhold procedure.`,
        );
      }
    }
    // -----------------------------------------------------------------------
    // (1b) TOTALITY (CR-04). Every field the per-job comparison later reads
    //      must be PRESENT and of the right type, because JavaScript's
    //      coercions turn every absence into AGREEMENT rather than into a
    //      question.
    // -----------------------------------------------------------------------
    if (typeof row.active !== "boolean") {
      return invalid(
        `cron manifest row ${row.jobname} has no boolean active flag. Boolean(undefined) is false, so an omitted flag silently AGREES with a deactivated PROD job — the quietest form of the outage this arm exists for.`,
      );
    }
    for (const field of REQUIRED_ROW_STRINGS) {
      if (typeof row[field] !== "string" || row[field].trim().length === 0) {
        return invalid(
          `cron manifest row ${row.jobname} has no usable ${field}. String(undefined ?? "").trim() is "", which compares EQUAL to an absent or empty PROD value, so a row missing its ${field} is not a comparison — it is an agreement by accident.`,
        );
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
  // (1b) The oracle is well-formed — so it can now be asked WHICH DATABASE it
  //      describes, and that answer compared to the one in hand. Two different
  //      databases produce a full-page diff that means nothing: it is not drift,
  //      it is a comparison that was never valid. Both markers are names a human
  //      chose, so both are safe to print — and printing both is the only way
  //      the reader can tell which side is the surprise.
  //
  //      Placed AFTER section (1) on purpose: a null or schema-bumped oracle
  //      must report `manifest-invalid`, not a marker mismatch against
  //      `undefined`. Section (0)'s findings ride along on this return too.
  // -------------------------------------------------------------------------
  if (String(manifest.database_marker ?? "").trim() !== liveMarker) {
    defects.push({
      kind: "measure-fail",
      subject: "database marker",
      detail: `the manifest was captured from a database marked ${JSON.stringify(String(manifest.database_marker ?? ""))} but this reading came from one marked ${JSON.stringify(liveMarker)}. These are two different databases, so NO comparison happened — a diff between two databases is not drift.`,
    });
    return { defects, lines };
  }

  // -------------------------------------------------------------------------
  // (2) MANIFEST-side hygiene, INDEPENDENTLY of equality. (The PROD side ran in
  //     section (0), above every return.) A PROD command that matches the
  //     manifest byte for byte and still carries an inline key is STILL a
  //     defect — that is what makes the oracle "achievable" rather than
  //     "whatever PROD has".
  // -------------------------------------------------------------------------
  const manifestHygiene = new Map();
  for (const row of manifest.jobs) {
    if (typeof row.command !== "string") continue; // a withheld row was read by a human at capture time
    // Same F3 scoping as section (0): one unjudgeable row is one row.
    const judged = judgeRow(row.jobname, row.command);
    recordVerdict(manifestHygiene, row.jobname, judged);
    if (judged.error !== null) {
      defects.push({ kind: "measure-fail", subject: `manifest:${row.jobname}`, detail: judged.error });
      continue;
    }
    const v = judged.violations;
    const { credential, unjudgeable } = splitHygiene(v);
    if (credential.length > 0) {
      defects.push({
        kind: "cron-secret-in-command",
        subject: `manifest:${row.jobname}`,
        detail: `the COMMITTED manifest row for ${shownName(row.jobname)} fails ${credential.length} hygiene rule(s): ${credential.join(" ")}`,
      });
    }
    if (unjudgeable.length > 0) {
      defects.push({
        kind: "measure-fail",
        subject: `manifest:${row.jobname}`,
        detail: `${unjudgeable.join(" ")} The command could not be judged, and an unjudged command is not a clean one.`,
      });
    }
  }

  // -------------------------------------------------------------------------
  // (3) Adjacency: zero rows and duplicates, before any set arithmetic.
  // -------------------------------------------------------------------------
  if (rows.length === 0) {
    drift(
      "cron.job",
      `cron-drift: PROD cron.job returned zero rows; the manifest has ${manifest.jobs.length} job(s). Every scheduled job has vanished — this is the loudest possible drift, not "no drift".`,
    );
    return { defects, lines };
  }

  const seen = new Set();
  const duplicates = new Set();
  for (const row of rows) {
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
  const prodByName = new Map(rows.map((r) => [r.jobname, r]));

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
    // CR-01: the ROLE and the DATABASE, which were captured on every row and
    // compared on none. See COMPARED_ROW_STRINGS for the measurement.
    for (const field of COMPARED_ROW_STRINGS) {
      if (String(m[field] ?? "").trim() !== String(p[field] ?? "").trim()) changed.push(field);
    }

    // ⛔ `jobid` is PRINTED on the line above and deliberately NOT compared,
    // and that is a decision rather than the oversight CR-01 named.
    //
    // It is pg_cron's surrogate key and carries no configuration meaning.
    // ⚠️ It is ALSO not the change-detector it looks like: `cron.schedule` on
    // an existing jobname is an UPSERT and PRESERVES the id, so an ordinary
    // re-schedule moves the schedule or the command while the id sits still —
    // both of which are compared beside it. Only an unschedule / re-schedule
    // CYCLE allocates a new one, and such a cycle necessarily changes nothing
    // else this arm can see. THE LOAD-BEARING REASON is therefore field
    // coverage, not churn: every semantically meaningful field a jobid could
    // stand proxy for — schedule, command, username, database, active — is
    // already compared, so comparing the id adds no detection and costs
    // isolation. MEASURED 2026-09-10: adding "jobid" to COMPARED_ROW_STRINGS
    // made `prod-duplicate-jobname.json` report TWO cron-drift defects (the
    // duplicate, plus a jobid change that is only that duplicate's
    // consequence) and broke that fixture's one-defect isolation control.
    // Printing it stays useful: an operator reading a drift line wants the id
    // to run `SELECT * FROM cron.job WHERE jobid = …`.

    const prodSha = sha256Hex(normalizeCommand(p.command));
    if (m.command_sha256 !== prodSha) changed.push("command");

    if (changed.length === 0) continue;
    differing += 1;

    const withheld = typeof m.command !== "string";
    // ⛔ UNJUDGED WITHHOLDS EXACTLY AS DIRTY DOES — see the invariant recorded
    // beside `recordVerdict`. `!v.judged` is the whole of CR-R1-02's fix; the
    // `.violations.length > 0` half is the pre-existing reading.
    const manifestVerdict = hygieneVerdict(manifestHygiene, name);
    const prodVerdict = hygieneVerdict(prodHygiene, name);
    const manifestDirty = !manifestVerdict.judged || manifestVerdict.violations.length > 0;
    const prodDirty = !prodVerdict.judged || prodVerdict.violations.length > 0;

    let headline =
      `cron-drift: manifest captured ${capturedAt} (marker ${marker}) sha ${m.command_sha256} — ` +
      `PROD now sha ${prodSha}; changed: ${changed.join(", ")}` +
      (changed.includes("schedule") ? ` (schedule ${m.schedule} → ${p.schedule})` : "") +
      (changed.includes("active") ? ` (active ${Boolean(m.active)} → ${Boolean(p.active)})` : "") +
      (changed.includes("username") ? ` (username ${m.username} → ${p.username} — the role the command EXECUTES AS)` : "") +
      (changed.includes("database") ? ` (database ${m.database} → ${p.database})` : "");

    // ⛔ The command TEXT is printed only when BOTH sides were JUDGED, both
    // PASSED, and the manifest row carries text. Otherwise: shas only, and SAY
    // WHY. "Judged" is the half CR-R1-02 added: between the F3 repair and this
    // fix, a row nobody could judge satisfied "passes hygiene" and had its full
    // text printed into a public log.
    if (withheld) {
      headline += `\n      command text withheld: manifest row is sha-only (${m.withheld_reason})`;
    } else if (manifestDirty || prodDirty) {
      // The REASON is part of the withholding line, because "fails hygiene" and
      // "could not be judged" send an operator to two different places and the
      // second one used to print the text instead of saying anything at all.
      const say = (side, v) =>
        v.judged ? `${side} fails hygiene (${v.violations.map((x) => x.slice(0, x.indexOf("]") + 1)).join(" ")})` : `${side} could not be judged (${v.reason})`;
      const reasons = [manifestDirty ? say("manifest", manifestVerdict) : null, prodDirty ? say("PROD", prodVerdict) : null]
        .filter(Boolean)
        .join("; ");
      headline += `\n      command text withheld: ${reasons}`;
    } else if (changed.includes("command")) {
      // Both sides judged and clean: a unified diff of the NORMALIZED text.
      //
      // ⛔ EVERY PHYSICAL LINE CARRIES ITS MARKER (164.8.5-REVIEW-R1 IN-R1-01).
      // This used to read "normalization collapses each side to one line, so the
      // diff is exactly two lines" and push one array entry per side. That was
      // true of `ws-collapse-v1` and has been FALSE since `ws-collapse-v2`,
      // which PRESERVES line breaks by design — so a multi-line command reached
      // the Actions log as two entries carrying embedded newlines, `-` and `+`
      // marked only their FIRST physical line, and a reader could not tell where
      // the manifest text ended and PROD's began. MEASURED 2026-09-11: 4 array
      // entries, 10 physical lines, 6 of them unmarked. The assertion at
      // `run.mjs` counts ARRAY ENTRIES, which is why nothing noticed.
      const marked = (sign, text) =>
        String(text)
          .split("\n")
          .map((physical) => `${sign} ${physical}`)
          .join("\n");
      lines.push(`--- manifest ${name} (captured ${capturedAt})`);
      lines.push(`+++ PROD ${name}`);
      lines.push(marked("-", normalizeCommand(m.command)));
      lines.push(marked("+", normalizeCommand(p.command)));
    }

    drift(name, headline);
  }

  lines.push(
    `cron-drift: ${rows.length} PROD job(s) vs ${manifest.jobs.length} manifest job(s), ${differing} differing`,
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

/**
 * ⛔ THE ORDER OF THIS FUNCTION IS LOAD-BEARING, AND IT IS NOT THE ORDER IT WAS
 * WRITTEN IN. `run()` used to read the ORACLE first and `return` on a read
 * error BEFORE `CRON_JOB_SQL` was ever issued — so hoisting the hygiene scan
 * inside `compareManifest` alone would still have left the "no oracle at all"
 * case silent, because there were no PROD rows to scan. The oracle read is
 * therefore LAST, and it never returns: whatever it produces is handed to
 * `compareManifest`, which reports the credentials it can see before it judges
 * the oracle it was given.
 *
 * The two EARLY returns that remain are both "nothing has been read yet":
 * a marker read that failed and a `cron.job` read that failed. There is no row
 * to scan in either case, so returning hides nothing.
 */
async function run({ seams, log, addDefect, manifestPath, functionsDir }) {
  // (1) WHICH DATABASE AM I ON? `current_database()` is `postgres` on every
  //     Supabase project and proves nothing; the hand-set COMMENT ON DATABASE
  //     marker is the only identification that exists. The marker is a name a
  //     human chose, so it is safe to print.
  const markerRes = await seams.sql("cron-drift", DB_MARKER_SQL);
  if (markerRes.measureFail) {
    addDefect(
      "measure-fail",
      "cron-drift",
      "database marker",
      `the database marker could not be read: ${markerRes.measureFail}. No cron.job row has been read at this point, so there is nothing this return can hide.`,
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

  // (2) All rows of cron.job, with separators a multi-line command survives.
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

  // (3) Parse the rows.
  //
  // ⛔ ATTRIBUTION FENCE. A record this parser could not read is a row whose
  //    contents were never judged — not a row that is absent, and not a row
  //    that passed. It is reported by COUNT and FIELD COUNT only, because the
  //    text is what may carry the credential. The readable rows continue
  //    through section (0) and the comparison: a parse failure on ONE record
  //    must not silence the credential scan on the others, which is the same
  //    "one bad input disables the instrument" shape the hoist exists to remove.
  const { rows: prodRows, malformed, countMismatch } = parseCronJobRows(res.stdout);
  if (malformed.length > 0) {
    addDefect(
      "measure-fail",
      "cron-drift",
      "cron.job",
      `${malformed.length} of ${malformed.length + prodRows.length} record(s) returned by the cron.job read could not be parsed (field counts: ${malformed.map((m) => m.fields).join(", ")}; ${CRON_JOB_COLUMNS.length} are required). Those rows were NOT judged by any check in this arm. An unreadable row is not an absent row and is not a clean one.`,
      "Read the affected cron.job command by hand: a record separator (0x1E) inside a command splits it, and the likeliest sources are a pasted control byte or an E'\\x1e' literal. Re-schedule that job onto a body without it, then re-capture the manifest.",
    );
  }
  // ⛔ SEPARATE FROM THE WIDTH GUARD ABOVE, AND NOT REDUNDANT WITH IT. This is
  // the out-of-band reading: a record that VANISHED, or one the split
  // FABRICATED, leaves every surviving record perfectly well-formed. See the
  // invariant beside `parseCronJobRows`.
  if (countMismatch !== null) {
    addDefect(
      "measure-fail",
      "cron-drift",
      "cron.job",
      `${countMismatch} The rows this arm did judge are reported above; the ones it never saw are the point.`,
      "Read cron.job by hand (SELECT jobid, jobname FROM cron.job ORDER BY jobid) and compare it with the manifest. A command carrying a record separator (0x1E) is the likeliest cause; a truncated read is the other.",
    );
  }

  // (4) The oracle, LAST and WITHOUT A RETURN. An ABSENT or unparsable file is
  //     `manifest-invalid` — raised by `compareManifest` from
  //     `manifestReadError`, BELOW its section (0), so the credential scan on
  //     the rows already in hand happens either way.
  let manifest = null;
  let readError = null;
  try {
    manifest = readManifestFile(manifestPath);
  } catch (err) {
    readError = err && err.message ? err.message : String(err);
  }

  // (5) Compare.
  const { defects, lines } = compareManifest(manifest, prodRows, {
    liveMarker: marker,
    manifestReadError: readError,
    manifestPath,
    functionsDir,
  });
  for (const line of lines) log(line);
  for (const d of defects) addDefect(d.kind, "cron-drift", d.subject, d.detail, REMEDIES[d.kind]);
}

export const ARM = {
  name: "cron-drift",
  requiredEnv: ["PROBER_POOLER_URL", "SUPABASE_DB_PASSWORD"],
  run,
  REMEDIES,
};
