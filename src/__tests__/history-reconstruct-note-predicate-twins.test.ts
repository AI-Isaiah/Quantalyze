/**
 * Phase 167.1.2.1 RECONMARKER, round-2 review WR-01: the Overview "history could
 * not be rebuilt" note has a TypeScript copy of the fan-out's capped-key
 * predicate, and this test keeps the two from drifting apart.
 *
 * THE TWO COPIES. `enqueue_refresh_allocator_equity_for_all` (migration
 * 20261021120000 and any later one that redefines it) counts the keys it has
 * given up on in the `ck` query and writes the `history_reconstruct_capped` row.
 * `reconstructCappedKeyIds` in `src/lib/queries.ts` decides which keys the
 * Overview note may name. If the note names a key the fan-out stopped counting,
 * the allocator reads a terminal failure about a key the system no longer tracks
 * (the round-1 WR-02 false note); if it drops a key the fan-out still counts, a
 * real cap goes unannounced. The comment "keep in lockstep" was the only thing
 * between them. The Python twin is
 * `analytics-service/tests/test_fanout_owed_predicate_twins.py`, which pins the
 * `rk` (owed) half; this file pins the `ck` (capped) half.
 *
 * Four pins, each of which can fail:
 *   1. Every conjunct of the `ck` count is a term this file knows, and no known
 *      term is missing. A term added to the SQL fails by NAME. The classifier is
 *      also driven on a scratch copy of the real body with a fake term added and
 *      a real term deleted, so a classifier that stopped biting would fail too.
 *   2. The sync_status literals of the SQL (plus the `revoked` term) equal the one
 *      exported TS constant `NON_RETRYABLE_SYNC_STATUSES`.
 *   3. The in-flight statuses and the job kind the fan-out waits on equal
 *      `RECONSTRUCT_IN_FLIGHT_STATUSES` / `RECONSTRUCT_JOB_KIND`, and the cap
 *      equals `HISTORY_RECONSTRUCT_ATTEMPT_CAP`.
 *   4. The TS predicate, driven through the real `reconstructCappedKeyIds`,
 *      EXCLUDES a key for every qualifying term and every sync_status literal the
 *      SQL lists, and names the unmutated control. A term in the known list with
 *      no behaviour case here fails.
 *
 * The migration is read as text from the real tree, never typed here. No
 * migration defining the function is a loud failure, never a vacuous pass.
 */
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  HISTORY_RECONSTRUCT_ATTEMPT_CAP,
  NON_RETRYABLE_SYNC_STATUSES,
  RECONSTRUCT_IN_FLIGHT_STATUSES,
  RECONSTRUCT_JOB_KIND,
} from "@/lib/constants";

// queries.ts pulls in the server clients at import time; none is called here.
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { reconstructCappedKeyIds } from "@/lib/queries";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const FN_RE =
  /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.enqueue_refresh_allocator_equity_for_all\s*\(\s*\)[\s\S]*?AS\s+\$\$([\s\S]*?)\n\$\$;/gi;
const CAP_RE = /v_reconstruct_attempt_cap\s+CONSTANT\s+integer\s*:=\s*(\d+)\s*;/i;

function stripSqlComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** The newest migration that defines the fan-out WITH the reconstruct cap. */
function newestFanoutBody(): { file: string; body: string } {
  const found: { file: string; body: string }[] = [];
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    const code = stripSqlComments(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    for (const m of code.matchAll(FN_RE)) {
      const body = m[1] ?? "";
      if (body.includes("v_reconstruct_attempt_cap")) found.push({ file, body });
    }
  }
  expect(
    found.length,
    `no migration under ${MIGRATIONS_DIR} defines enqueue_refresh_allocator_equity_for_all with v_reconstruct_attempt_cap, so the capped-key predicate cannot be read and the Overview note's TS copy is unpinned (a silent pass here would defeat the test)`,
  ).toBeGreaterThan(0);
  return found[found.length - 1];
}

/** The WHERE conjuncts of the `ck` capped-key count, one per top-level AND. */
function ckConjuncts(body: string): string[] {
  const m = /SELECT\s+count\(\*\)\s+INTO\s+v_capped\s+FROM\s+api_keys\s+\w+\s+WHERE([^;]*);/i.exec(body);
  expect(
    m,
    "the `ck` capped-key count (SELECT count(*) INTO v_capped FROM api_keys ... WHERE ...;) was not found in the fan-out; re-read the migration",
  ).not.toBeNull();
  return (m?.[1] ?? "")
    .split(/\n\s*AND\s+/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

const NOT_ARCHIVED =
  String.raw`\w+\.api_key_id = \w+\.id AND \w+\.user_id = \w+\.user_id AND \w+\.status <> 'archived'`;

/** term name -> regex over ONE conjunct. Every conjunct must match exactly one. */
const TERMS: Record<string, RegExp> = {
  active: /^\w+\.is_active = TRUE$/i,
  not_revoked: /^\w+\.sync_status IS DISTINCT FROM 'revoked'$/i,
  sync_status_exclusions: /^coalesce\(\w+\.sync_status, ''\) NOT IN \(([^)]*)\)$/i,
  not_disconnected: /^\w+\.disconnected_at IS NULL$/i,
  not_deribit: /^lower\(\w+\.exchange\) <> 'deribit'$/i,
  not_linked_direct: new RegExp(
    String.raw`^NOT EXISTS \(SELECT 1 FROM strategies \w+ WHERE ` + NOT_ARCHIVED + String.raw`\)$`,
    "i",
  ),
  not_linked_composite: new RegExp(
    String.raw`^NOT EXISTS \(SELECT 1 FROM strategy_keys \w+ JOIN strategies \w+ ON \w+\.id = \w+\.strategy_id WHERE \w+\.api_key_id = \w+\.id AND \w+\.user_id = \w+\.user_id AND \w+\.status <> 'archived'\)$`,
    "i",
  ),
  marker_null: /^\w+\.history_reconstructed_at IS NULL$/i,
  at_cap: /^\w+\.history_reconstruct_attempts >= v_reconstruct_attempt_cap$/i,
};

function literals(text: string): string[] {
  return [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

function classify(body: string): {
  matched: Map<string, RegExpExecArray>;
  unknown: string[];
  missing: string[];
} {
  const matched = new Map<string, RegExpExecArray>();
  const unknown: string[] = [];
  for (const conj of ckConjuncts(body)) {
    const hits = Object.entries(TERMS)
      .map(([term, rx]) => [term, rx.exec(conj)] as const)
      .filter((h): h is readonly [string, RegExpExecArray] => h[1] !== null);
    if (hits.length !== 1) {
      unknown.push(conj);
      continue;
    }
    const [term, m] = hits[0];
    if (matched.has(term)) {
      unknown.push(`${conj} (term ${term} appears twice)`);
      continue;
    }
    matched.set(term, m);
  }
  const missing = Object.keys(TERMS).filter((t) => !matched.has(t));
  return { matched, unknown, missing };
}

function classifyReal() {
  const { file, body } = newestFanoutBody();
  return { file, body, ...classify(body) };
}

describe("the Overview note's capped-key predicate is pinned to the fan-out's `ck` count (round-2 WR-01)", () => {
  it("every term of the `ck` count is a known term and none is missing", () => {
    const { file, unknown, missing } = classifyReal();
    expect(
      unknown,
      `${file}: the capped-key count has terms with no entry in this twin test: ${JSON.stringify(unknown)}. The Overview note (reconstructCappedKeyIds in src/lib/queries.ts) must apply each one; add the term to TERMS and to a behaviour case below.`,
    ).toEqual([]);
    expect(
      missing,
      `${file}: the capped-key count no longer contains ${JSON.stringify(missing)}. A term was removed from the fan-out; remove it from reconstructCappedKeyIds and from this test together.`,
    ).toEqual([]);
  });

  // The classifier is the whole pin. Prove it can fail on a scratch copy of the
  // real body, so "a term added to SQL fails the twin by name" is a tested claim.
  it("a term ADDED to a scratch copy of the fan-out is reported by name", () => {
    const { body } = newestFanoutBody();
    const anchor = body.match(/\n(\s*)AND ck\.history_reconstructed_at IS NULL/i);
    expect(anchor, "the marker_null conjunct is the insertion anchor").not.toBeNull();
    const scratch = body.replace(
      anchor![0],
      `\n${anchor![1]}AND ck.fake_new_term = FALSE${anchor![0]}`,
    );
    const { unknown } = classify(scratch);
    expect(unknown).toEqual(["ck.fake_new_term = FALSE"]);
  });

  it("a term DELETED from a scratch copy of the fan-out is reported by name", () => {
    const { body } = newestFanoutBody();
    const scratch = body.replace(/\n\s*AND lower\(ck\.exchange\) <> 'deribit'/i, "");
    expect(scratch).not.toBe(body);
    expect(classify(scratch).missing).toEqual(["not_deribit"]);
  });

  it("a sync_status literal ADDED to a scratch copy is seen in the literal set", () => {
    const { body } = newestFanoutBody();
    const scratch = body.replace(
      /coalesce\(ck\.sync_status, ''\) NOT IN \('sign_in_failed', 'error'\)/i,
      "coalesce(ck.sync_status, '') NOT IN ('sign_in_failed', 'error', 'fake_status')",
    );
    expect(scratch).not.toBe(body);
    expect(literals(classify(scratch).matched.get("sync_status_exclusions")![1])).toContain(
      "fake_status",
    );
  });

  it("the sync_status exclusions of the SQL equal NON_RETRYABLE_SYNC_STATUSES", () => {
    const { file, matched } = classifyReal();
    const sql = new Set([
      ...literals(matched.get("sync_status_exclusions")![1]),
      "revoked", // the `IS DISTINCT FROM 'revoked'` term, pinned by name above
    ]);
    expect(
      [...sql].sort(),
      `${file} excludes sync_status ${JSON.stringify([...sql].sort())} but src/lib/constants.ts NON_RETRYABLE_SYNC_STATUSES is ${JSON.stringify([...NON_RETRYABLE_SYNC_STATUSES].sort())}: the Overview note would name a key the fan-out no longer counts, or hide one it does`,
    ).toEqual([...NON_RETRYABLE_SYNC_STATUSES].sort());
  });

  it("the `revoked` term of the SQL is the literal `revoked`", () => {
    const { matched } = classifyReal();
    expect(literals(matched.get("not_revoked")![0])).toEqual(["revoked"]);
  });

  it("the in-flight statuses and job kind the fan-out waits on equal the TS constants", () => {
    const { file, body } = newestFanoutBody();
    const re =
      /compute_jobs\s+(\w+)\s+WHERE\s+\1\.api_key_id\s*=\s*\w+\.id\s+AND\s+\1\.kind\s*=\s*'([^']*)'\s+AND\s+\1\.status\s+IN\s*\(([^)]*)\)/gi;
    const reads = [...body.matchAll(re)];
    expect(
      reads.length,
      `${file}: no in-flight compute_jobs term was found in the fan-out, so RECONSTRUCT_IN_FLIGHT_STATUSES is unpinned`,
    ).toBeGreaterThan(0);
    for (const r of reads) {
      expect(r[2], `${file} job kind`).toBe(RECONSTRUCT_JOB_KIND);
      expect(
        literals(r[3]).sort(),
        `${file} waits on statuses ${r[3]} but RECONSTRUCT_IN_FLIGHT_STATUSES is ${JSON.stringify(RECONSTRUCT_IN_FLIGHT_STATUSES)}`,
      ).toEqual([...RECONSTRUCT_IN_FLIGHT_STATUSES].sort());
    }
  });

  it("the cap of the SQL equals HISTORY_RECONSTRUCT_ATTEMPT_CAP", () => {
    const { file, body } = newestFanoutBody();
    const m = CAP_RE.exec(body);
    expect(m, `${file}: v_reconstruct_attempt_cap declaration not found`).not.toBeNull();
    expect(Number(m![1]), `${file}`).toBe(HISTORY_RECONSTRUCT_ATTEMPT_CAP);
  });
});

// --------------------------------------------------------------------------
// Behaviour: drive the real predicate, one attribute at a time.
// --------------------------------------------------------------------------

type Key = Parameters<typeof reconstructCappedKeyIds>[0][number];
const CONTROL: Key = {
  id: "k-1",
  is_active: true,
  exchange: "binance",
  sync_status: "ok",
  disconnected_at: null,
  history_reconstructed_at: null,
  history_reconstruct_attempts: HISTORY_RECONSTRUCT_ATTEMPT_CAP,
};
const NO_LINKS = { strategies: [], links: [] };
type Links = NonNullable<Parameters<typeof reconstructCappedKeyIds>[1]>;

const named = (over: Partial<Key>, links: Links = NO_LINKS): boolean =>
  reconstructCappedKeyIds([{ ...CONTROL, ...over }], links)!.has("k-1");

// term -> the one mutation of the control that the fan-out's `ck` count excludes.
const ROW_MUTATIONS: Record<string, Partial<Key>> = {
  active: { is_active: false },
  not_revoked: { sync_status: "revoked" },
  not_disconnected: { disconnected_at: "2026-09-10T00:00:00Z" },
  not_deribit: { exchange: "Deribit" },
  marker_null: { history_reconstructed_at: "2026-09-01T00:00:00Z" },
  at_cap: { history_reconstruct_attempts: HISTORY_RECONSTRUCT_ATTEMPT_CAP - 1 },
};
const LINK_MUTATIONS: Record<string, Links> = {
  not_linked_direct: {
    strategies: [{ id: "s-1", api_key_id: "k-1", status: "published" }],
    links: [],
  },
  not_linked_composite: {
    strategies: [{ id: "s-1", api_key_id: null, status: "published" }],
    links: [{ strategy_id: "s-1", api_key_id: "k-1" }],
  },
};

describe("reconstructCappedKeyIds applies every term of the fan-out's `ck` count (round-2 WR-01)", () => {
  it("names the unmutated control (a key at the cap, marker NULL, nothing excluding it)", () => {
    expect(named({})).toBe(true);
  });

  it("every known SQL term has a behaviour case here", () => {
    const covered = new Set([
      ...Object.keys(ROW_MUTATIONS),
      ...Object.keys(LINK_MUTATIONS),
      "sync_status_exclusions", // driven from the migration's own literals below
    ]);
    expect(Object.keys(TERMS).filter((t) => !covered.has(t))).toEqual([]);
  });

  it.each(Object.keys(ROW_MUTATIONS))(
    "a key the fan-out excludes on term %s is not named",
    (term) => {
      expect(term in TERMS, `${term} is not a known SQL term`).toBe(true);
      expect(
        named(ROW_MUTATIONS[term]),
        `the fan-out stops counting a key on term ${term} but the Overview note still names it`,
      ).toBe(false);
    },
  );

  it.each(Object.keys(LINK_MUTATIONS))(
    "a key the fan-out excludes on term %s is not named",
    (term) => {
      expect(term in TERMS, `${term} is not a known SQL term`).toBe(true);
      expect(
        named({}, LINK_MUTATIONS[term]),
        `the fan-out stops counting a linked key (${term}) but the Overview note still names it`,
      ).toBe(false);
    },
  );

  it("every sync_status the SQL excludes is not named (read from the migration, not typed)", () => {
    const { file, matched } = classifyReal();
    const statuses = [
      ...literals(matched.get("sync_status_exclusions")![1]),
      "revoked",
    ];
    expect(statuses.length).toBeGreaterThan(0);
    const stillNamed = statuses.filter((s) => named({ sync_status: s }));
    expect(
      stillNamed,
      `${file} excludes sync_status ${JSON.stringify(stillNamed)} but the Overview note still names such a key`,
    ).toEqual([]);
  });

  it("a NULL sync_status still qualifies (coalesce(sync_status, '') NOT IN (...))", () => {
    expect(named({ sync_status: null })).toBe(true);
  });

  it("an archived strategy link does not exclude the key (the SQL ignores status = archived)", () => {
    expect(
      named({}, { strategies: [{ id: "s-1", api_key_id: "k-1", status: "archived" }], links: [] }),
    ).toBe(true);
  });

  it("an unreadable link source names nothing", () => {
    expect(reconstructCappedKeyIds([CONTROL], null)).toBeNull();
  });
});
