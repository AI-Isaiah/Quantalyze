/**
 * service_role statement_timeout migration — STATIC GATE, Phase 164.5.1 plan 03.
 *
 * ⛔ THE DEFECT THIS FILE CATCHES. Criterion 7 sets `service_role`'s
 * `statement_timeout` strictly below the API gateway's 60s ceiling and
 * strictly above the measured 44.67s successful run. A value outside that
 * band in EITHER direction is a real defect: too high leaves the gateway 504
 * unclassifiable exactly as before; too low aborts legitimate work
 * (T-164.5.1-03-02). This gate also proves the migration REGISTERS NO
 * SCHEDULE (D1/D2) and carries NEITHER the PROD-body acknowledgment pragma
 * nor the custom-GUC lineage header, since neither applies to an `ALTER ROLE`
 * statement with no function body.
 *
 * ⭐ EVERY PREDICATE HERE IS WRITTEN OVER ARBITRARY TEXT AND CALIBRATED ON A
 * MUTATED COPY (see `analytics-service/tests/test_ledger_refresh_gates.py`'s
 * `_fold_sql_string_concatenations` and this repo's own house discipline). A
 * predicate only ever applied to passing input is not evidence.
 *
 * ⛔ HAND-TYPED LITERALS LIVE ONLY HERE. `SCHEDULE_VERBS`, the PROD-body
 * acknowledgment token and the custom-GUC lineage-header token are spelled
 * ONLY in this file — the migration itself (Task 1) was deliberately written
 * NOT to name any of them, in prose or otherwise, precisely so this gate's
 * raw-text scan is never self-tripping and the migration's own prose can
 * never satisfy or trip it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "supabase",
  "migrations",
  "20260916120000_service_role_statement_timeout.sql",
);
const MIGRATION_TEXT = readFileSync(MIGRATION_PATH, "utf8");

// ---------------------------------------------------------------------------
// Hand-typed literals — owned HERE, never spelled in the migration itself.
// ---------------------------------------------------------------------------

/** The two pg_cron catalogue-mutating verbs. D1/D2 forbid a migration that
 * schedules OR unschedules; both are checked. */
export const SCHEDULE_VERBS = ["cron.schedule", "cron.unschedule"] as const;

/** scripts/prod-body-drift-check.sh's machine-read acknowledgment comment
 * token. Applies only to a `CREATE OR REPLACE FUNCTION` body; this migration
 * defines none, so it must never appear here. */
const PROD_BODY_ACK_TOKEN = "prod-body-ack";

/** scripts/lint-app-guc.mjs's custom-`app.*`-GUC lineage-header token.
 * `statement_timeout` is a BUILT-IN GUC, so this must never appear here. */
const APP_GUC_LINEAGE_TOKEN = "APP-GUC-LINEAGE";

/** Strictly above the measured 44.67s successful run (net._http_response id
 * 3758, 19:00Z — see 164.5.1-CONTEXT.md § Area 2 and § Specific Ideas). */
const MEASURED_SUCCESS_MS = 44670;

/** Strictly below the API gateway's timeout. */
const GATEWAY_CEILING_MS = 60000;

/** Comfortably under the migration's real header length; the majority of
 * this gate's value per the "anti-vacuity floor, first" rule. */
const ANTI_VACUITY_FLOOR_CHARS = 800;

// ---------------------------------------------------------------------------
// Helpers. Every one takes TEXT, so each can be run against a mutant.
// ---------------------------------------------------------------------------

/** Strip `--` line comments. This repo's migrations use line comments
 * exclusively for header prose (confirmed: 20260911120000's own RESIDUAL
 * note records 0 block-comment openers in its body); a block-comment hole
 * is out of scope for this gate, matching that file's own recorded scope. */
function stripLineComments(text: string): string {
  return text.replace(/--.*$/gm, "");
}

/**
 * Collapse `'a' || 'b'` into `'ab'`, repeatedly. Closes the indirect-
 * assembly hole a raw literal scan would otherwise leave open — mirrors
 * `analytics-service/tests/test_ledger_refresh_gates.py`'s
 * `_fold_sql_string_concatenations` (same regex shape, ported to JS).
 */
const SQL_CONCAT_RE = /'((?:[^']|'')*)'\s*\|\|\s*'((?:[^']|'')*)'/g;
function foldSqlStringConcatenations(text: string): string {
  let folded = text;
  for (let i = 0; i < 32; i += 1) {
    const collapsed = folded.replace(SQL_CONCAT_RE, (_m, a: string, b: string) => `'${a}${b}'`);
    if (collapsed === folded) break;
    folded = collapsed;
  }
  return folded;
}

/** Parse a Postgres interval literal of the shape `'Ns'` (the only shape
 * this migration or its calibrated mutants use) into milliseconds. */
function parseIntervalLiteralMs(strippedText: string): number {
  const match = strippedText.match(/statement_timeout\s*=\s*'(\d+(?:\.\d+)?)\s*s'/i);
  if (!match) {
    throw new Error(
      "service-role-statement-timeout-migration gate: could not find a statement_timeout " +
        "interval literal of the shape 'Ns' in the comment-stripped text.",
    );
  }
  return Math.round(parseFloat(match[1]) * 1000);
}

// ---------------------------------------------------------------------------
// The assertion set, over arbitrary TEXT — never the file path directly —
// so the CALIBRATION block below can run it against synthetic mutants.
// ---------------------------------------------------------------------------

export function assertServiceRoleStatementTimeoutMigration(text: string): void {
  // 1. Anti-vacuity floor, FIRST. Every assertion below is green over an
  //    empty string, so this floor is the majority of the gate's value.
  if (text.length <= ANTI_VACUITY_FLOOR_CHARS) {
    throw new Error(
      `ANTI-VACUITY: migration text is only ${text.length} chars, at or under the ` +
        `${ANTI_VACUITY_FLOOR_CHARS}-char floor. A truncated or empty file must not be scored ` +
        "as passing every downstream assertion.",
    );
  }
  const stripped = stripLineComments(text);
  if (stripped.trim().length === 0) {
    throw new Error("ANTI-VACUITY: comment-stripped migration text is empty.");
  }

  // 2. Exactly one ALTER ROLE, naming service_role and statement_timeout.
  const alterRoleMatches = stripped.match(/\balter\s+role\b/gi) ?? [];
  if (alterRoleMatches.length !== 1) {
    throw new Error(
      "Expected exactly one ALTER ROLE statement in the comment-stripped migration text, " +
        `found ${alterRoleMatches.length}.`,
    );
  }
  if (!/\bservice_role\b/.test(stripped)) {
    throw new Error("Expected the comment-stripped text to name service_role.");
  }
  if (!/\bstatement_timeout\b/.test(stripped)) {
    throw new Error("Expected the comment-stripped text to name statement_timeout.");
  }

  // 3. The value band. Fails in EITHER direction.
  const ms = parseIntervalLiteralMs(stripped);
  if (!(ms > MEASURED_SUCCESS_MS && ms < GATEWAY_CEILING_MS)) {
    throw new Error(
      `statement_timeout value ${ms}ms is outside the (${MEASURED_SUCCESS_MS}ms, ` +
        `${GATEWAY_CEILING_MS}ms) band — strictly above the measured 44.67s successful run and ` +
        "strictly below the 60s API gateway ceiling.",
    );
  }

  // 4. No schedule-registration verb, however assembled. Scanned over RAW
  //    text (not comment-stripped) — legitimate ONLY because Task 1's
  //    migration was written not to name either verb in prose at all.
  const folded = foldSqlStringConcatenations(text).toLowerCase();
  for (const verb of SCHEDULE_VERBS) {
    if (folded.includes(verb.toLowerCase())) {
      throw new Error(
        `Found schedule-registration verb "${verb}" in the migration's raw text (after ` +
          "folding string concatenations). D1/D2 forbid a migration that schedules or " +
          "unschedules; the live cron.job repoint is a RUNBOOK operation, never a migration.",
      );
    }
  }

  // 5. No misapplied pragma. Neither applies to an ALTER ROLE statement.
  if (text.includes(PROD_BODY_ACK_TOKEN)) {
    throw new Error(
      "Found the PROD-body acknowledgment pragma token in the migration text. This migration " +
        "defines no function body, so there is nothing for scripts/prod-body-drift-check.sh to " +
        "compare against a PROD snapshot — the acknowledgment pragma does not apply here.",
    );
  }
  if (text.includes(APP_GUC_LINEAGE_TOKEN)) {
    throw new Error(
      "Found the custom-GUC lineage-header token in the migration text. statement_timeout is " +
        "a BUILT-IN Postgres GUC, not an app.* custom placeholder GUC, so " +
        "scripts/lint-app-guc.mjs's allowlist mechanism does not apply here.",
    );
  }

  // 6. Provenance present.
  if (!text.includes("164.5.1")) {
    throw new Error("Expected the header to name Phase 164.5.1.");
  }
  if (!text.includes("[164.5.1-GATEWAY-CEILING-INVERSION]")) {
    throw new Error("Expected the header to name [164.5.1-GATEWAY-CEILING-INVERSION].");
  }
  if (!/\b20\d{2}-\d{2}-\d{2}\b/.test(text)) {
    throw new Error("Expected the header to carry a four-digit year-month-day measurement date.");
  }
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe("service_role statement_timeout migration — static gate", () => {
  it("the shipped migration passes every assertion", () => {
    expect(() => assertServiceRoleStatementTimeoutMigration(MIGRATION_TEXT)).not.toThrow();
  });

  it("the shipped migration's value sits strictly inside the (44670ms, 60000ms) band", () => {
    const stripped = stripLineComments(MIGRATION_TEXT);
    const ms = parseIntervalLiteralMs(stripped);
    expect(ms).toBeGreaterThan(MEASURED_SUCCESS_MS);
    expect(ms).toBeLessThan(GATEWAY_CEILING_MS);
    expect(ms).toBe(45000);
  });

  describe("CALIBRATION — every failure mode observed against a synthetic mutant", () => {
    it("a '60s' mutant throws, naming the gateway ceiling", () => {
      const mutant = MIGRATION_TEXT.replace(
        "statement_timeout = '45s'",
        "statement_timeout = '60s'",
      );
      expect(mutant).not.toBe(MIGRATION_TEXT);
      expect(() => assertServiceRoleStatementTimeoutMigration(mutant)).toThrow(/60000ms/);
    });

    it("a '40s' mutant throws, naming the measured 44.67s baseline", () => {
      const mutant = MIGRATION_TEXT.replace(
        "statement_timeout = '45s'",
        "statement_timeout = '40s'",
      );
      expect(mutant).not.toBe(MIGRATION_TEXT);
      expect(() => assertServiceRoleStatementTimeoutMigration(mutant)).toThrow(/44670ms/);
    });

    it("a schedule-registration verb appended inside a comment throws", () => {
      const mutant = `${MIGRATION_TEXT}\n-- injected: ${SCHEDULE_VERBS[0]}('x', '* * * * *', $$SELECT 1$$);\n`;
      expect(mutant).not.toBe(MIGRATION_TEXT);
      expect(() => assertServiceRoleStatementTimeoutMigration(mutant)).toThrow(
        /schedule-registration verb/,
      );
    });

    it("the same verb assembled by string concatenation throws — the fold is not decorative", () => {
      const verb = SCHEDULE_VERBS[0];
      const half1 = verb.slice(0, 6);
      const half2 = verb.slice(6);
      // Sanity: the un-concatenated halves must not themselves contain the
      // full verb, or this calibration case would prove nothing.
      expect(foldsDoNotTriviallyContain(half1, half2, verb)).toBe(true);
      const mutant = `${MIGRATION_TEXT}\n-- assembled: '${half1}' || '${half2}'\n`;
      expect(mutant).not.toBe(MIGRATION_TEXT);
      expect(mutant.toLowerCase()).not.toContain(verb.toLowerCase());
      expect(() => assertServiceRoleStatementTimeoutMigration(mutant)).toThrow(
        /schedule-registration verb/,
      );
    });

    it("a mutant adding the PROD-body acknowledgment pragma token throws", () => {
      const mutant = `${MIGRATION_TEXT}\n-- ${PROD_BODY_ACK_TOKEN}: deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n`;
      expect(mutant).not.toBe(MIGRATION_TEXT);
      expect(() => assertServiceRoleStatementTimeoutMigration(mutant)).toThrow(
        /acknowledgment pragma/,
      );
    });

    it("a mutant adding the custom-GUC lineage-header token throws", () => {
      const mutant = `${MIGRATION_TEXT}\n-- ${APP_GUC_LINEAGE_TOKEN}: some-reason\n`;
      expect(mutant).not.toBe(MIGRATION_TEXT);
      expect(() => assertServiceRoleStatementTimeoutMigration(mutant)).toThrow(
        /lineage-header token/,
      );
    });

    it("an empty file throws on the anti-vacuity floor, not a downstream assertion", () => {
      expect(() => assertServiceRoleStatementTimeoutMigration("")).toThrow(/ANTI-VACUITY/);
    });

    it("a truncated file (header only, no statement) throws on the anti-vacuity floor", () => {
      const truncated = MIGRATION_TEXT.slice(0, 100);
      expect(truncated).not.toBe(MIGRATION_TEXT);
      expect(truncated.length).toBeLessThan(ANTI_VACUITY_FLOOR_CHARS);
      expect(() => assertServiceRoleStatementTimeoutMigration(truncated)).toThrow(
        /ANTI-VACUITY/,
      );
    });

    it("a mutant missing the ALTER ROLE statement throws, naming the count", () => {
      // Swaps the one executable line for an inert statement, so the
      // comment-stripped body stays non-empty (the anti-vacuity floor must
      // not be what fires here) while the ALTER ROLE count assertion does.
      const mutant = MIGRATION_TEXT.replace(
        "ALTER ROLE service_role SET statement_timeout = '45s';",
        "SELECT 1;",
      );
      expect(mutant).not.toBe(MIGRATION_TEXT);
      expect(() => assertServiceRoleStatementTimeoutMigration(mutant)).toThrow(/found 0/);
    });

    it("a mutant with a SECOND ALTER ROLE statement throws, naming the count", () => {
      const mutant = `${MIGRATION_TEXT}\nALTER ROLE service_role SET statement_timeout = '50s';\n`;
      expect(mutant).not.toBe(MIGRATION_TEXT);
      expect(() => assertServiceRoleStatementTimeoutMigration(mutant)).toThrow(/found 2/);
    });
  });
});

/** True iff neither half, alone, already contains the full verb — a
 * sanity check that the calibration case actually exercises the fold. */
function foldsDoNotTriviallyContain(half1: string, half2: string, verb: string): boolean {
  return (
    !half1.toLowerCase().includes(verb.toLowerCase()) &&
    !half2.toLowerCase().includes(verb.toLowerCase())
  );
}
