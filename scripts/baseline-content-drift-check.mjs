#!/usr/bin/env node
/**
 * BASELINE-CONTENT-DRIFT — the committed `supabase/schema/baseline.sql` pinned
 * to the MIGRATION CHAIN, not merely to its own changelog (Phase 164.5,
 * criterion 7).
 *
 * ── THE DEFECT CLASS THIS EXISTS FOR ───────────────────────────────────────
 * Phase 164.5's co-edit gate fires on a BYTE CHANGE to `baseline.sql`. It
 * structurally CANNOT fire in the other direction: a migration changes a
 * function body, `baseline.sql` is left untouched, and nothing notices. That is
 * exactly what Phase 164.7 did — two ledger bodies moved on 2026-09-07 and the
 * committed dump still describes the pre-164.7 shape. Left unpinned, a
 * migration squash would freeze that drift into the new floor permanently, so
 * decision D-04 lands this gate BEFORE any squash.
 *
 * ── WHAT IT COMPARES, AND WHAT IT DOES NOT ─────────────────────────────────
 * FUNCTION BODIES ONLY. No tables, no columns, no policies, no triggers, no
 * grants, no indexes, no defaults, no extensions. The gate PRINTS that boundary
 * on every run — a gate that reads green while blind is this repository's named
 * defect class, and the only defence is saying out loud what was not measured.
 *
 * The "applied migration chain" side is `supabase/schema/functions/*.sql`: a
 * HERMETIC TEXT-REPLAY rendering of `supabase/migrations/**` produced by
 * `scripts/dump-sql-functions.ts`, whose own currency is enforced by that
 * script's `--check` gate. It is NOT a live replay, and that is not a shortcut:
 * `supabase/schema/BASELINE.md` records the measurement — 69 of 262 migrations
 * fail to replay from empty, from at least six independent causes, one of which
 * (`20260823120000_revoke_api_keys_insert.sql`) refuses BY DESIGN to run
 * against a database it cannot identify. A full replay is IMPOSSIBLE here, not
 * merely slow. `dump-sql-functions.ts`'s own header carries the matching limit:
 * tables/columns/policies/triggers evolve via incremental `ALTER`s that a
 * text-replay cannot reconstruct, which is why the chain side is functions-only
 * and why this gate inherits that boundary rather than pretending past it.
 *
 * ── WHY IT WRITES NO NORMALIZER (D-05 of Phase 164.3) ──────────────────────
 * `scripts/sql-body-normalize.mjs` is the DECLARED SINGLE shared normalizer and
 * already implements this comparison (`diffFunctionBodies()`, its `--diff-bodies`
 * mode). This file imports it. It re-implements no extraction, no normalization
 * and no hashing — a second normalizer would be a second definition of what
 * "the same body" means, which is the coupling D-05 exists to forbid.
 *
 * ── EVERY STATUS IS DISPOSITIONED. NONE IS SILENTLY IGNORED ────────────────
 *   MATCH             pass.
 *   DRIFT             finding (allowlistable) — the gate's primary target.
 *   SNAPSHOT_MISSING  finding (allowlistable) — the chain has a function the
 *                     committed dump has no body for.
 *   SNAPSHOT_ONLY     finding (allowlistable) — a committed body whose
 *                     same-named chain counterpart matched something else.
 *                     `sql-body-normalize.mjs` calls this "advisory"; a status
 *                     that is merely advisory to a GATE is a status the gate is
 *                     blind to, so it is a finding here. It is ZERO on today's
 *                     tree, so this strictness costs nothing and buys the claim
 *                     that no status is unhandled.
 *   UNCOMPARABLE      MEASURE_FAIL, exit 1. NEVER a pass, never allowlistable.
 *                     An absent measurement is not a zero (D-02).
 *
 * ── THE ALLOWLIST IS A DATED RATCHET, NOT A MUTE BUTTON ────────────────────
 * P-03 of the plan chose PRECEDENT B (a dated, name-AND-HASH-pinned ratchet)
 * over PRECEDENT A (shipping the gate red for an interval): this phase exists
 * because an artifact was committed with no staleness gate and no consumer, and
 * a gate that cannot block for an interval reproduces that class in a smaller
 * form. So the gate ships GREEN with its known drift PINNED.
 *
 * Each row pins the `snapshotHash`/`candidateHash` PAIR, not the name. Three
 * consequences, each proven by a self-test arm and by task 2's mutation arms:
 *
 *   • a DIFFERENT drift on an already-allowlisted function still FAILS
 *     (`allowlist-hash-moved`) — a name-only row would be a mute button;
 *   • an allowlisted function that is now MATCH FAILS (`allowlist-stale`),
 *     telling the operator to delete the row — the list may only SHRINK;
 *   • a row without both hash fields is refused at startup
 *     (`allowlist-malformed`) — the shape cannot degrade into a name list.
 *
 * ⛔ A red corpus run from here is a REGRESSION. It is NEVER cleared by adding
 * a row. What DOES clear a row is naming in `clearedBy`: a regeneration of
 * `supabase/schema/baseline.sql` from PROD — a separate REVIEWED act on a
 * credential-bearing surface, which also moves the sha recorded in
 * `supabase/schema/BASELINE.md`.
 *
 * ── OUTPUT CONTRACT: NEVER BODY TEXT. THIS REPOSITORY IS PUBLIC ────────────
 * Findings carry names, argument counts, sha256 hashes and differing-line
 * counts — nothing else. That is `sql-body-normalize.mjs`'s own hard
 * requirement (its header, "prints no body text in any reporting mode") and it
 * matters because a PROD body can contain a surgical patch that exists nowhere
 * in this repo. MEASURE_FAILs deliberately use `::error::` with NO `file=`
 * field, so counting `::error file=` can never be inflated by a measurement
 * failure — the same split `scripts/lint-app-guc.mjs` uses.
 *
 * ── USAGE (CI pastes these lines VERBATIM — mode identity) ─────────────────
 *   node scripts/baseline-content-drift-check.mjs             # the real corpus
 *   node scripts/baseline-content-drift-check.mjs --self-test # synthetic arms
 */
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { diffFunctionBodies } from "./sql-body-normalize.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Repo-relative, so the header, the CI step and every finding name one path. */
export const SNAPSHOT_FILE = "supabase/schema/baseline.sql";
export const CHAIN_DIR = "supabase/schema/functions";

/** Statuses that are a FINDING unless a row pins them exactly. */
export const FINDABLE_STATUSES = ["DRIFT", "SNAPSHOT_MISSING", "SNAPSHOT_ONLY"];

/** A sha256 hex digest as `normalizedHash()` renders it. */
const HASH_RE = /^[0-9a-f]{64}$/;
/** `capturedAt` must be a real ISO calendar date — "recently" is not a date. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A reason must actually say something; a one-word reason is a mute button. */
const MIN_REASON_LEN = 60;

/**
 * The finding registry. `src/__tests__/baseline-content-drift-allowlist.test.ts`
 * pins this id set EXACTLY, so adding a kind without an arm reds the suite.
 */
export const FINDING_KINDS = [
  {
    id: "content-drift",
    title: "a function body disagrees between the committed baseline and the chain",
  },
  {
    id: "allowlist-hash-moved",
    title: "an allowlisted function drifted DIFFERENTLY from the pinned pair",
  },
  {
    id: "allowlist-stale",
    title: "an allowlisted row no longer describes a real disagreement — delete it",
  },
  {
    id: "allowlist-malformed",
    title: "an allowlist row is missing a field the ratchet depends on",
  },
];

/**
 * ── THE DATED RATCHET ──────────────────────────────────────────────────────
 *
 * ⚠️ SUPERSEDED 2026-09-07 by the PROD REGENERATION. The prior reading — taken
 * at commit `415e0a6c` against the 2026-08-29 dump — was **114 MATCH, 6 DRIFT,
 * 2 SNAPSHOT_MISSING, 0 SNAPSHOT_ONLY, 0 UNCOMPARABLE**, and it is kept here as
 * dated lineage, not as the current census.
 *
 * MEASURED 2026-09-07 after `supabase db dump --linked` re-took
 * `supabase/schema/baseline.sql` from PROD (119 -> 121 distinct function names):
 * **119 MATCH, 3 DRIFT, 0 SNAPSHOT_MISSING, 0 SNAPSHOT_ONLY, 0 UNCOMPARABLE**
 * over 122 compared functions. FIVE rows went MATCH and were DELETED, which is
 * the only direction this list is allowed to move.
 *
 * ⛔ THE THREE SURVIVORS ARE NOT WHAT THEY SAID THEY WERE. Every one of the
 * eight original rows carried `clearedBy: "A regeneration of
 * supabase/schema/baseline.sql from PROD"`. That regeneration has now HAPPENED,
 * and these three rows' `snapshotHash` values did not move by a single bit —
 * PROD's bodies were never stale. So the shared diagnosis ("the dump is the
 * stale side, the chain is the current truth") was FALSE for them, and each
 * row's `reason` now records what was actually measured instead: PROD runs an
 * EARLIER revision of the body than the migration chain renders. That is a
 * PROD-vs-REPO divergence of the DRIFT-04 family, tracked as DRIFT-06 in
 * TODOS.md, and a further regeneration will never clear it.
 *
 * Every row pins `snapshotHash` + `candidateHash` + `nargs` + `hunks`. `hunks`
 * is implied by the two hashes (it is a pure function of the two bodies), so
 * checking it can never false-fail independently — it is there to catch a
 * hand-edited row, not to add a second ratchet.
 *
 * `snapshotHash: null` is legal ONLY for `SNAPSHOT_MISSING`, where the
 * committed dump structurally has no body to hash; `candidateHash: null` only
 * for `SNAPSHOT_ONLY`. Any other null is `allowlist-malformed`.
 *
 * ⛔ THIS LIST MAY ONLY SHRINK.
 */
export const CONTENT_DRIFT_ALLOWLIST = [
  {
    function: "check_fan_in_ready",
    nargs: 1,
    status: "DRIFT",
    snapshotHash: "29bbdf0ffb42247be96a43d88ae495a713fdd4b1dfc30f24bdf3e8f21eed759c",
    candidateHash: "ca20a5cf99d8239653bb169487347a54edc1ce58c2cecdb73694fedcd6e7018f",
    hunks: 5,
    capturedAt: "2026-09-07",
    clearedBy:
      "PROD and the migration chain agreeing on this body — which a regeneration of " +
      "supabase/schema/baseline.sql CANNOT deliver, because the regeneration of 2026-09-07 was " +
      "taken and this row's snapshotHash did not move by a single bit. Clearing it needs the " +
      "20260510180226 body to actually reach the live catalogue, or the repo's migration text to " +
      "be re-based onto what PROD really runs. Both are founder-gated acts on PROD.",
    reason:
      "⚠️ RE-MEASURED 2026-09-07 against a FRESHLY REGENERATED PROD dump, and the row's original " +
      "diagnosis was WRONG. It read 'the committed dump was taken from PROD on 2026-08-29; the " +
      "chain has since been re-rendered from migrations that redefine this body' — i.e. the dump " +
      "is stale. It is not. The new dump's normalized body hashes to the SAME snapshotHash as the " +
      "old one, so PROD never moved; only two migrations ever define this function " +
      "(20260411144407, then 20260510180226) and PROD is running the EARLIER of the two. The " +
      "difference is executable, not cosmetic: the chain declares `v_row_found BOOLEAN` and " +
      "SELECTs `true` into it to distinguish 'no parent row' from 'a parent row of NULLs'; PROD " +
      "has neither. So this is a PROD-vs-REPO divergence of the DRIFT-04 family — either " +
      "20260510180226 never reached PROD, or its file was retro-edited after it did — and a " +
      "read-only dump cannot tell those two apart. Tracked as DRIFT-06 in TODOS.md.",
  },
  {
    function: "reject_sentinel_writes",
    nargs: 0,
    status: "DRIFT",
    snapshotHash: "1fc944f328e55cb80c62f54c16d2a3cd6c9d5f23d56753a2b6110eac341d2e82",
    candidateHash: "0f08c6cab3df4c1f49daa7eeed858b78701a4466cdc55231dd6f12c214ef6d7b",
    hunks: 9,
    capturedAt: "2026-09-07",
    clearedBy:
      "the same act named on check_fan_in_ready above — NOT a baseline regeneration. That was " +
      "performed on 2026-09-07 and left this row's snapshotHash bit-identical.",
    reason:
      "⚠️ RE-MEASURED 2026-09-07 against a FRESHLY REGENERATED PROD dump; the original 'the dump " +
      "side is the stale one' diagnosis is FALSIFIED. snapshotHash is unchanged, so PROD's body " +
      "never moved. Two migrations define this trigger function (20260513073518, then " +
      "20260515114310) and PROD runs the EARLIER one: its three RAISE EXCEPTION messages are the " +
      "short 2026-05-13 wording, while the chain renders the 2026-05-15 wording that adds 'by " +
      "user-originated writes (sentinel reserved for sanitize_user)' and the 'red-team Finding 4' " +
      "citation. The nine hunks are those three messages and the dollar-quote tag; the GUARD " +
      "LOGIC — which sentinel values are refused, on which three tables — is identical on both " +
      "sides, so this is a message-text divergence and not a hole in the guard. Same DRIFT-04 " +
      "family as the row above. Tracked as DRIFT-06 in TODOS.md.",
  },
  {
    function: "retention_delete_guard",
    nargs: 0,
    status: "DRIFT",
    snapshotHash: "99789ed5f10e85069c1f13b45b419b3713f4725963ee62c6ef19c24f11d9ed2d",
    candidateHash: "0cd7a7d0cc3e0843881291cd59cc8daf76a7b359edd593f9ebaf559c1e8f0801",
    hunks: 2,
    capturedAt: "2026-09-07",
    clearedBy:
      "the same act named on check_fan_in_ready above — NOT a baseline regeneration. That was " +
      "performed on 2026-09-07 and left this row's snapshotHash bit-identical.",
    reason:
      "⚠️ RE-MEASURED 2026-09-07 against a FRESHLY REGENERATED PROD dump; the original diagnosis " +
      "is FALSIFIED here too, and this row is the cleanest specimen of the class. Exactly ONE " +
      "migration in the repository defines this function (20260515113853_retention_crons_safe), " +
      "so there is no later revision for PROD to be behind — yet PROD's RAISE message OMITS the " +
      "clause 'This indicates an unbounded DELETE (missing WHERE) — aborting.' that this single " +
      "defining migration contains. A live catalogue cannot lag a migration it is the only " +
      "definition of; the migration FILE was therefore edited after it was applied, which is the " +
      "retro-edit half of the DRIFT-04 family. The 100,000-row ceiling and the abort itself are " +
      "identical on both sides, so the guard's behaviour is unaffected — only its message text. " +
      "Tracked as DRIFT-06 in TODOS.md.",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Corpus assembly
// ───────────────────────────────────────────────────────────────────────────

/**
 * The chain side, concatenated in an EXPLICIT lexicographic order.
 *
 * The order is spelled with `.sort()` rather than inherited from `readdirSync`
 * or from a shell glob, because both are platform- and locale-dependent and the
 * `used` bookkeeping inside `diffFunctionBodies()` consumes snapshot bodies in
 * candidate order — a different order could pair a different overload and move
 * a pinned hash for no real reason.
 *
 * Returns `{ sql, files, index }` where `index` maps a function name to the
 * repo-relative file it came from, so a finding can name a file a human opens.
 */
export function buildChainSql(absDir) {
  const names = readdirSync(absDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const parts = [];
  const index = new Map();
  for (const n of names) {
    parts.push(readFileSync(join(absDir, n), "utf8"));
    index.set(n.slice(0, -4), `${CHAIN_DIR}/${n}`);
  }
  return { sql: parts.join("\n"), files: names, index };
}

// ───────────────────────────────────────────────────────────────────────────
// Allowlist validation — the shape cannot degrade into a name list
// ───────────────────────────────────────────────────────────────────────────

/**
 * Refuse a row that cannot carry the ratchet's weight. Runs BEFORE the
 * comparison, so a malformed row fails the gate even on a clean corpus: a row
 * validated only when it happens to be consulted is a row that can rot.
 */
export function validateAllowlist(allowlist) {
  const findings = [];
  const bad = (row, i, message) =>
    findings.push({
      kind: "allowlist-malformed",
      file: "scripts/baseline-content-drift-check.mjs",
      line: 0,
      message: `CONTENT_DRIFT_ALLOWLIST[${i}] (${row?.function ?? "<unnamed>"}): ${message}`,
    });

  const seen = new Set();
  allowlist.forEach((row, i) => {
    if (!row || typeof row !== "object") return bad(row, i, "is not an object.");
    if (typeof row.function !== "string" || row.function.length === 0)
      return bad(row, i, "has no `function` name.");
    if (!FINDABLE_STATUSES.includes(row.status))
      return bad(
        row,
        i,
        `has status ${JSON.stringify(row.status)}; must be one of ${FINDABLE_STATUSES.join("/")}. ` +
          "UNCOMPARABLE and MATCH are deliberately not allowlistable.",
      );
    if (!Number.isInteger(row.nargs) || row.nargs < 0)
      return bad(row, i, "has no integer `nargs` — an overload must be pinned by arity too.");

    // A null hash is legal ONLY on the side the pinned status says is absent.
    const snapMayBeNull = row.status === "SNAPSHOT_MISSING";
    const candMayBeNull = row.status === "SNAPSHOT_ONLY";
    if (!(snapMayBeNull && row.snapshotHash === null) && !HASH_RE.test(row.snapshotHash ?? ""))
      return bad(
        row,
        i,
        "has no sha256 `snapshotHash`. A row keyed on the name alone is a mute button, which is " +
          "the defect this gate is built to refuse.",
      );
    if (!(candMayBeNull && row.candidateHash === null) && !HASH_RE.test(row.candidateHash ?? ""))
      return bad(row, i, "has no sha256 `candidateHash`.");
    if (snapMayBeNull && row.snapshotHash !== null)
      return bad(row, i, "is SNAPSHOT_MISSING but pins a `snapshotHash`; there is no body to hash.");
    if (candMayBeNull && row.candidateHash !== null)
      return bad(row, i, "is SNAPSHOT_ONLY but pins a `candidateHash`; there is no body to hash.");

    const hunksMustBeNull = row.status !== "DRIFT";
    if (hunksMustBeNull) {
      if (row.hunks !== null) return bad(row, i, "must pin `hunks: null` — only DRIFT has a magnitude.");
    } else if (!Number.isInteger(row.hunks) || row.hunks < 0) {
      return bad(row, i, "has no integer `hunks` magnitude.");
    }

    if (!DATE_RE.test(row.capturedAt ?? ""))
      return bad(row, i, "has no `capturedAt` YYYY-MM-DD date — an undated ratchet cannot expire.");
    if (typeof row.clearedBy !== "string" || row.clearedBy.length === 0)
      return bad(row, i, "has no `clearedBy` naming what removes it.");
    if (typeof row.reason !== "string" || row.reason.length < MIN_REASON_LEN)
      return bad(
        row,
        i,
        `has no \`reason\` of at least ${MIN_REASON_LEN} characters stating why the row is ` +
          "legitimate rather than a bug.",
      );

    const key = `${row.function}#${row.nargs}`;
    if (seen.has(key)) return bad(row, i, `duplicates ${key}; two rows for one identity is ambiguous.`);
    seen.add(key);
  });
  return findings;
}

// ───────────────────────────────────────────────────────────────────────────
// The comparison
// ───────────────────────────────────────────────────────────────────────────

const identity = (r) => `${r.function ?? r.name}#${r.nargs}`;

/** Names + hashes + magnitudes ONLY. Never a slice of a body. */
function describeRow(r) {
  return (
    `${r.status} ${r.name}/${r.nargs} ` +
    `snapshot=${r.snapshotHash ?? "(absent)"} chain=${r.candidateHash ?? "(absent)"}` +
    (r.hunks === undefined || r.hunks === null ? "" : ` differing-lines=${r.hunks}`)
  );
}

/**
 * Pure text in, verdict out — the injectable seam (PATTERNS shared pattern 3),
 * so every red arm here and in the vitest runs with no file, no lane and no
 * credential.
 */
export function checkContentDrift({ snapshotSql, chainSql, allowlist = CONTENT_DRIFT_ALLOWLIST, chainIndex = new Map() }) {
  const findings = validateAllowlist(allowlist);
  const measureFails = [];

  let rows;
  try {
    rows = diffFunctionBodies(snapshotSql, chainSql);
  } catch (err) {
    if (!err?.charsetRefusal) throw err;
    const r = err.charsetRefusal;
    // Identifier-and-position facts only — never the source line. Same contract
    // as sql-body-normalize.mjs's own reportCharsetRefusal.
    measureFails.push({
      reason:
        `sql-body-normalize refused an identifier at line ${r.line} (read '${r.prefix}' then hit ` +
        `'${r.offender}', ${r.codepoint}). NOTHING was compared, so this is a MEASURE_FAIL rather ` +
        "than a clean run.",
    });
    return summarize({ rows: [], findings, measureFails, allowlist, ok: false });
  }

  const counts = { MATCH: 0, DRIFT: 0, SNAPSHOT_MISSING: 0, SNAPSHOT_ONLY: 0, UNCOMPARABLE: 0 };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const byIdentity = new Map(allowlist.map((row) => [identity(row), row]));
  const consumed = new Set();
  const fileFor = (r) =>
    chainIndex.get(r.name) ?? (r.status === "SNAPSHOT_ONLY" ? SNAPSHOT_FILE : SNAPSHOT_FILE);

  for (const r of rows) {
    if (r.status === "UNCOMPARABLE") {
      // D-02: never a pass. It carries no `file=` so a findings count can never
      // be inflated by a measurement failure.
      measureFails.push({
        reason:
          `${r.name}/${r.nargs}: no dollar-quoted body on the ${r.side} side, so the two bodies ` +
          "were NOT compared. UNCOMPARABLE is never allowlistable — an absent measurement is not a zero.",
      });
      continue;
    }
    if (r.status === "MATCH") continue;

    const pinned = byIdentity.get(identity(r));
    if (!pinned) {
      findings.push({
        kind: "content-drift",
        file: fileFor(r),
        line: 0,
        message:
          `${describeRow(r)} — the committed ${SNAPSHOT_FILE} disagrees with the migration chain ` +
          `for \`${r.name}\`, and no CONTENT_DRIFT_ALLOWLIST row pins this disagreement.`,
      });
      continue;
    }
    consumed.add(identity(r));
    const same =
      pinned.status === r.status &&
      (pinned.snapshotHash ?? null) === (r.snapshotHash ?? null) &&
      (pinned.candidateHash ?? null) === (r.candidateHash ?? null) &&
      (pinned.hunks ?? null) === (r.hunks ?? null);
    if (!same) {
      findings.push({
        kind: "allowlist-hash-moved",
        file: fileFor(r),
        line: 0,
        message:
          `\`${r.name}\` IS allowlisted, but this is a DIFFERENT disagreement from the pinned one. ` +
          `pinned: ${pinned.status} snapshot=${pinned.snapshotHash ?? "(absent)"} ` +
          `chain=${pinned.candidateHash ?? "(absent)"}` +
          (pinned.hunks === null ? "" : ` differing-lines=${pinned.hunks}`) +
          `; measured: ${describeRow(r)}. The allowlist pins a specific known drift, never a name — ` +
          "so a new drift on an already-pinned function still fails.",
      });
    }
  }

  for (const row of allowlist) {
    if (consumed.has(identity(row))) continue;
    findings.push({
      kind: "allowlist-stale",
      file: "scripts/baseline-content-drift-check.mjs",
      line: 0,
      message:
        `\`${row.function}\`/${row.nargs} is pinned as ${row.status} (captured ${row.capturedAt}) but ` +
        "the corpus reports no such disagreement — it now MATCHes, or the function is gone. " +
        "DELETE THIS ROW from CONTENT_DRIFT_ALLOWLIST. The list may only shrink; a row that has " +
        "stopped being true is a row that would silence a future real drift.",
    });
  }

  return summarize({
    rows,
    counts,
    findings,
    measureFails,
    allowlist,
    ok: findings.length === 0 && measureFails.length === 0,
  });
}

function summarize({ rows, counts, findings, measureFails, allowlist, ok }) {
  return {
    ok,
    findings,
    measureFails,
    rows: rows ?? [],
    counts: counts ?? { MATCH: 0, DRIFT: 0, SNAPSHOT_MISSING: 0, SNAPSHOT_ONLY: 0, UNCOMPARABLE: 0 },
    compared: (rows ?? []).length,
    allowlisted: allowlist.length,
  };
}

/** The real corpus. Both paths are hard failures when absent (D-02). */
export function checkRepo(opts = {}) {
  const snapPath = resolve(opts.snapshotFile ?? join(REPO_ROOT, SNAPSHOT_FILE));
  const chainDir = resolve(opts.chainDir ?? join(REPO_ROOT, CHAIN_DIR));
  const allowlist = opts.allowlist ?? CONTENT_DRIFT_ALLOWLIST;

  if (!existsSync(snapPath))
    return {
      ...summarize({ findings: [], measureFails: [], allowlist, ok: false }),
      measureFails: [
        {
          reason: `${SNAPSHOT_FILE} does not exist. NOTHING was compared. An absent baseline is a hard failure, never a skip.`,
        },
      ],
      chainFiles: 0,
    };
  if (!existsSync(chainDir))
    return {
      ...summarize({ findings: [], measureFails: [], allowlist, ok: false }),
      measureFails: [
        { reason: `${CHAIN_DIR} does not exist. NOTHING was compared — regenerate it with \`npm run schema:functions\`.` },
      ],
      chainFiles: 0,
    };

  const chain = buildChainSql(chainDir);
  if (chain.files.length === 0)
    return {
      ...summarize({ findings: [], measureFails: [], allowlist, ok: false }),
      measureFails: [
        { reason: `${CHAIN_DIR} contains zero *.sql files. A corpus of zero compares nothing and must never read as clean.` },
      ],
      chainFiles: 0,
    };

  const result = checkContentDrift({
    snapshotSql: readFileSync(snapPath, "utf8"),
    chainSql: chain.sql,
    allowlist,
    chainIndex: chain.index,
  });
  return { ...result, chainFiles: chain.files.length };
}

// ───────────────────────────────────────────────────────────────────────────
// Reporting
// ───────────────────────────────────────────────────────────────────────────

/** The scope boundary, PRINTED on every run — green as well as red. */
export const SCOPE_SENTENCE =
  "SCOPE — this gate compares FUNCTION BODIES ONLY (normalized: comments stripped, whitespace " +
  "collapsed). It does NOT compare tables, columns, policies, triggers, grants, indexes, defaults " +
  "or extensions. The chain side is supabase/schema/functions/*.sql, a HERMETIC TEXT-REPLAY " +
  "rendering of supabase/migrations/** (currency gated by `tsx scripts/dump-sql-functions.ts " +
  "--check`), NOT a live replay: 69 of 262 migrations fail to replay from empty, so a live replay " +
  "is impossible here, not merely slow.";

export function report(result) {
  for (const mf of result.measureFails) {
    console.error(`::error::MEASURE_FAIL — ${mf.reason}`);
  }
  for (const f of result.findings) {
    console.error(`::error file=${f.file},line=${f.line}::${f.kind} — ${f.message}`);
  }
  // The summary ALWAYS prints, at zero as well, so "clean" and "did not run"
  // never look the same in a CI log.
  console.log(`baseline-content-drift: chain files ${result.chainFiles ?? 0} (${CHAIN_DIR}/*.sql, sorted)`);
  console.log(
    `baseline-content-drift: functions compared ${result.compared} — ` +
      `MATCH ${result.counts.MATCH}, DRIFT ${result.counts.DRIFT}, ` +
      `SNAPSHOT_MISSING ${result.counts.SNAPSHOT_MISSING}, SNAPSHOT_ONLY ${result.counts.SNAPSHOT_ONLY}, ` +
      `UNCOMPARABLE ${result.counts.UNCOMPARABLE}`,
  );
  console.log(
    `baseline-content-drift: allowlisted rows ${result.allowlisted} — ` +
      (result.allowlisted
        ? CONTENT_DRIFT_ALLOWLIST.map((r) => `${r.function}/${r.nargs}`).join(", ")
        : "(none)"),
  );
  console.log(`baseline-content-drift: findings ${result.findings.length}`);
  console.log(`baseline-content-drift: ${SCOPE_SENTENCE}`);
  if (!result.ok) {
    console.error(
      "::error::baseline-content-drift FAILED. Each line above is a function whose committed " +
        `${SNAPSHOT_FILE} body disagrees with the migration chain, or an allowlist row that has ` +
        "stopped describing the disagreement it pinned. ⛔ This is NEVER cleared by adding a row: " +
        "the list may only shrink. What clears a row is a regeneration of the baseline from PROD " +
        "as a separate reviewed act, which also moves the sha256 in supabase/schema/BASELINE.md.",
    );
  }
  return result.ok ? 0 : 1;
}

// ───────────────────────────────────────────────────────────────────────────
// Self-test — synthetic corpora, one arm per documented behaviour
// ───────────────────────────────────────────────────────────────────────────

/** A minimal but REAL dollar-quoted function definition. */
function fn(name, body, args = "") {
  return `CREATE OR REPLACE FUNCTION public.${name}(${args})\nRETURNS void\nLANGUAGE plpgsql\nAS $$\nBEGIN\n${body}\nEND;\n$$;\n`;
}

const ROW_TEMPLATE = {
  capturedAt: "2026-09-07",
  clearedBy: "A self-test fixture; removed when the fixture is.",
  reason:
    "Self-test fixture row. It exists to drive one arm of the gate's own proof and never describes " +
    "a real disagreement in this repository's corpus.",
};

/** Measure one identity's hashes off a real diff so no hash is hand-typed. */
function measure(snapshotSql, chainSql, name) {
  return diffFunctionBodies(snapshotSql, chainSql).find((r) => r.name === name);
}

export function selfTest() {
  const checks = [];
  const assert = (cond, msg) => checks.push({ cond: Boolean(cond), msg });
  const run = (snapshotSql, chainSql, allowlist) =>
    checkContentDrift({ snapshotSql, chainSql, allowlist });
  const kinds = (res) => res.findings.map((f) => f.kind);

  // ── The GREEN arm. Red arms alone cannot show a clean pass. ──────────────
  {
    const same = fn("alpha", "  PERFORM 1;");
    const res = run(same, same, []);
    assert(res.ok, "GREEN: identical corpora with an empty allowlist must pass");
    assert(res.findings.length === 0, "GREEN: identical corpora produce zero findings");
    assert(res.counts.MATCH === 1, "GREEN: identical corpora report exactly one MATCH");
    assert(res.measureFails.length === 0, "GREEN: identical corpora produce zero MEASURE_FAILs");
  }

  // ── 1. DRIFT, not allowlisted -> one finding NAMING the function. ────────
  const snapA = fn("alpha", "  PERFORM 1;");
  const chainA = fn("alpha", "  PERFORM 2;");
  {
    const res = run(snapA, chainA, []);
    assert(!res.ok, "DRIFT: an unallowlisted drifting body must FAIL");
    assert(kinds(res).join() === "content-drift", "DRIFT: fires exactly `content-drift`");
    assert(res.findings[0].message.includes("alpha"), "DRIFT: the finding NAMES the function");
    assert(res.counts.DRIFT === 1, "DRIFT: the census counts one DRIFT row");
  }

  // ── 2. DRIFT allowlisted at the EXACT pinned pair -> no finding. ─────────
  const mA = measure(snapA, chainA, "alpha");
  const pinA = {
    ...ROW_TEMPLATE,
    function: "alpha",
    nargs: mA.nargs,
    status: "DRIFT",
    snapshotHash: mA.snapshotHash,
    candidateHash: mA.candidateHash,
    hunks: mA.hunks,
  };
  {
    const res = run(snapA, chainA, [pinA]);
    assert(res.ok, "PINNED: an exactly-pinned drift passes");
    assert(res.findings.length === 0, "PINNED: an exactly-pinned drift produces zero findings");
  }

  // ── 3. The hashes MOVED -> still fails. The pin is not a name. ───────────
  {
    const chainA2 = fn("alpha", "  PERFORM 3;");
    const res = run(snapA, chainA2, [pinA]);
    assert(!res.ok, "HASH-MOVED: a DIFFERENT drift on an allowlisted function must still FAIL");
    assert(kinds(res).join() === "allowlist-hash-moved", "HASH-MOVED: fires `allowlist-hash-moved`");
    assert(
      res.findings[0].message.includes(pinA.candidateHash) &&
        res.findings[0].message.includes(measure(snapA, chainA2, "alpha").candidateHash),
      "HASH-MOVED: the finding quotes BOTH the pinned and the measured hash",
    );
  }

  // ── 4. An allowlisted row that is now MATCH -> STALE, "delete this row". ─
  {
    const res = run(snapA, snapA, [pinA]);
    assert(!res.ok, "STALE: a row that no longer describes a disagreement must FAIL");
    assert(kinds(res).join() === "allowlist-stale", "STALE: fires `allowlist-stale`");
    assert(
      /DELETE THIS ROW/i.test(res.findings[0].message),
      "STALE: the finding tells the operator to DELETE the row",
    );
  }

  // ── 5. UNCOMPARABLE -> MEASURE_FAIL, never a pass, and no `file=`. ───────
  {
    // `LANGUAGE sql ... AS 'body'` has no dollar-quoted body by construction.
    const uncomparable = "CREATE OR REPLACE FUNCTION public.beta() RETURNS int LANGUAGE sql AS 'SELECT 1';\n";
    const res = run(snapA, uncomparable, []);
    assert(!res.ok, "UNCOMPARABLE: must never be a pass");
    assert(res.measureFails.length === 1, "UNCOMPARABLE: reported as exactly one MEASURE_FAIL");
    assert(res.findings.length === 0, "UNCOMPARABLE: is NOT counted as a `file=` finding");
    assert(
      res.measureFails[0].reason.includes("never allowlistable"),
      "UNCOMPARABLE: says out loud that it cannot be allowlisted",
    );
  }

  // ── 6. SNAPSHOT_MISSING -> a finding, allowlistable with a null snapshot. ─
  {
    const res = run("", chainA, []);
    assert(!res.ok, "SNAPSHOT_MISSING: a chain function absent from the baseline must FAIL");
    assert(res.counts.SNAPSHOT_MISSING === 1, "SNAPSHOT_MISSING: counted in the census");
    assert(kinds(res).join() === "content-drift", "SNAPSHOT_MISSING: fires `content-drift`");
    const m = measure("", chainA, "alpha");
    const pin = {
      ...ROW_TEMPLATE,
      function: "alpha",
      nargs: m.nargs,
      status: "SNAPSHOT_MISSING",
      snapshotHash: null,
      candidateHash: m.candidateHash,
      hunks: null,
    };
    const res2 = run("", chainA, [pin]);
    assert(res2.ok, "SNAPSHOT_MISSING: pinnable with `snapshotHash: null` (structural, not omitted)");
  }

  // ── 7. SNAPSHOT_ONLY is a FINDING, not a silently-advisory status. ───────
  {
    // Two same-named committed overloads, one chain body: the unmatched
    // committed body reports SNAPSHOT_ONLY.
    const snap = fn("alpha", "  PERFORM 1;") + fn("alpha", "  PERFORM 9;", "p int");
    const res = run(snap, fn("alpha", "  PERFORM 1;"), []);
    assert(res.counts.SNAPSHOT_ONLY === 1, "SNAPSHOT_ONLY: the fixture actually produces the status");
    assert(!res.ok, "SNAPSHOT_ONLY: is a FINDING, not silently ignored");
    assert(kinds(res).includes("content-drift"), "SNAPSHOT_ONLY: fires `content-drift`");
  }

  // ── 8. A name-only allowlist row is REFUSED at startup. ──────────────────
  {
    const res = run(snapA, snapA, [{ function: "alpha" }]);
    assert(!res.ok, "MALFORMED: a name-only row must be refused");
    assert(
      kinds(res).includes("allowlist-malformed"),
      "MALFORMED: a name-only row fires `allowlist-malformed`",
    );
    const res2 = run(snapA, chainA, [{ ...pinA, snapshotHash: undefined }]);
    assert(
      kinds(res2).includes("allowlist-malformed"),
      "MALFORMED: a row missing `snapshotHash` fires `allowlist-malformed`",
    );
    const res3 = run(snapA, chainA, [{ ...pinA, capturedAt: "recently" }]);
    assert(
      kinds(res3).includes("allowlist-malformed"),
      "MALFORMED: a row with a non-ISO `capturedAt` fires `allowlist-malformed`",
    );
    const res4 = run(snapA, chainA, [{ ...pinA, reason: "known" }]);
    assert(
      kinds(res4).includes("allowlist-malformed"),
      "MALFORMED: a row with a one-word `reason` fires `allowlist-malformed`",
    );
    const res5 = run(snapA, chainA, [{ ...pinA, status: "MATCH" }]);
    assert(
      kinds(res5).includes("allowlist-malformed"),
      "MALFORMED: MATCH is not an allowlistable status",
    );
    // Validation runs BEFORE the comparison, so it bites on a CLEAN corpus too.
    assert(
      !run(snapA, snapA, [{ function: "alpha" }]).ok,
      "MALFORMED: a bad row fails even when the corpus itself is clean",
    );
  }

  // ── 9. The output contract: names/hashes/counts, never body text. ────────
  {
    const res = run(snapA, chainA, []);
    const emitted = [
      ...res.findings.map((f) => `${f.file} ${f.kind} ${f.message}`),
      ...res.measureFails.map((m) => m.reason),
    ].join("\n");
    assert(!emitted.includes("PERFORM"), "OUTPUT: no statement text from either body appears");
    assert(!/BEGIN|END;|\$\$/.test(emitted), "OUTPUT: no dollar-quote or block delimiters appear");
    assert(emitted.includes(measure(snapA, chainA, "alpha").candidateHash), "OUTPUT: hashes ARE reported");
  }

  // ── 10. The real allowlist itself must be well-formed. ──────────────────
  {
    const bad = validateAllowlist(CONTENT_DRIFT_ALLOWLIST);
    assert(bad.length === 0, `REAL ALLOWLIST: every shipped row validates (${bad[0]?.message ?? ""})`);
    assert(
      CONTENT_DRIFT_ALLOWLIST.every((r) => r.snapshotHash !== undefined && r.candidateHash !== undefined),
      "REAL ALLOWLIST: every row carries BOTH hash fields explicitly",
    );
  }

  const failed = checks.filter((c) => !c.cond);
  for (const c of failed) console.error(`SELF-TEST FAIL: ${c.msg}`);
  if (failed.length === 0) {
    console.log(
      `baseline-content-drift self-test OK: ${checks.length} assertions across ` +
        `${FINDING_KINDS.length} finding kinds (content-drift, allowlist-hash-moved, ` +
        "allowlist-stale, allowlist-malformed), plus UNCOMPARABLE->MEASURE_FAIL, the " +
        "no-body-text output contract, and one all-green arm.",
    );
  }
  return failed.length === 0 ? 0 : 1;
}

// ───────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────

export function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  if (argv.length > 0) {
    console.error(
      `baseline-content-drift: unknown argument "${argv[0]}". See the header of this file for usage.`,
    );
    return 2;
  }
  return report(checkRepo());
}

/**
 * Realpath-safe main-module guard — the `[VAC04-C2]` lesson: comparing
 * `import.meta.url` to `file://${process.argv[1]}` no-ops on symlinked or
 * space-bearing paths, silently turning the CLI into a library that exits 0
 * having measured nothing. Same idiom as `scripts/lint-app-guc.mjs`.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  process.exit(main(process.argv.slice(2)));
}
