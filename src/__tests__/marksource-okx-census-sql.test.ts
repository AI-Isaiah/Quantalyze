import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** `text.indexOf(anchor)`, but a miss THROWS by name instead of returning -1. */
function anchorIndex(text: string, anchor: string, from = 0): number {
  const at = text.indexOf(anchor, from);
  if (at < 0) throw new Error(`ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the subject text.`);
  return at;
}

/**
 * Phase 167.2.1.1.1.1 MARKSOURCE plan 10 (D-05, D-06): the read-only PROD
 * census lives as committed files under `docs/runbooks/marksource-okx-census/`
 * and an operator runs each one on PROD with `supabase db query --linked -f`.
 * This is a static guard (no database) that keeps every file safe to run there.
 *
 * Why each rule exists:
 *  - One statement, starting WITH or SELECT: the CLI returns only the last
 *    statement's rows, and a file that starts with anything else is not a read.
 *  - No `--` anywhere: a leading comment line breaks the CLI's inline form.
 *  - No write keyword as a whole word: the files run on PROD under a standing
 *    authorization that covers reads. A write slipping into a census file would
 *    ride that authorization.
 *  - No uuid-shaped literal: the directory is public; an id of a PROD row
 *    must never be committed.
 *  - The README names exactly the files that exist: an operator follows the
 *    README, so a missing or phantom file name sends them to the wrong place.
 *
 * Plan 13 (D-05) extends the guard to the history-correction runbook
 * (`docs/runbooks/marksource-okx-history-correction.md`): its SQL forms run on
 * PROD under the same standing authorization, so the same rules bind them, and
 * its renderer is the only thing between an operator's shell and a rendered
 * statement, so it is exercised here too.
 *
 * The keyword list is built from an array so this file's own source does not
 * read as SQL.
 */

const DIR = join(process.cwd(), "docs", "runbooks", "marksource-okx-census");

const EXPECTED_FILES = [
  "marker.sql",
  "okx-holdings-census.sql",
  "okx-nonworking-keys.sql",
  "okx-rebuild-feasibility.sql",
  "okx-snapshot-census.sql",
  "okx-snapshot-rows.sql",
  "unpriced-balances-census.sql",
  "unpriced-balances-current.sql",
] as const;

const WRITE_WORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "GRANT",
  "COPY",
  "CALL",
] as const;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function sqlFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function read(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

describe("marksource census directory", () => {
  it("holds exactly the pinned .sql files", () => {
    expect(
      sqlFiles(),
      "a census file was added, deleted or renamed: update EXPECTED_FILES and the README table together",
    ).toEqual([...EXPECTED_FILES].sort());
  });

  it("README backticked .sql names equal the directory listing", () => {
    const readme = read("README.md");
    const named = new Set(
      [...readme.matchAll(/`([A-Za-z0-9._-]+\.sql)`/g)].map((m) => m[1]),
    );
    expect(
      [...named].sort(),
      "README.md must name every .sql file in the directory, and no file that is not there",
    ).toEqual(sqlFiles());
  });
});

describe.each([...EXPECTED_FILES])("marksource census file %s", (name) => {
  const text = read(name);

  it("is one statement starting with WITH or SELECT", () => {
    expect(
      /^(WITH|SELECT)\b/i.test(text.trim()),
      `${name} must start with WITH or SELECT: a census file is a read`,
    ).toBe(true);
    const semicolons = text.split(";").length - 1;
    expect(semicolons, `${name} must hold exactly one ';'`).toBe(1);
    expect(
      text.trimEnd().endsWith(";"),
      `${name}: the single ';' must be the last character`,
    ).toBe(true);
  });

  it("carries no -- comment", () => {
    expect(
      text.includes("--"),
      `${name} contains '--': a comment line breaks the CLI's inline form; remove it`,
    ).toBe(false);
  });

  it("carries no uuid-shaped literal", () => {
    expect(
      UUID_RE.test(text),
      `${name} carries a uuid-shaped literal: the directory is public, select by position or label instead`,
    ).toBe(false);
  });

  it("carries no write keyword as a whole word", () => {
    for (const word of WRITE_WORDS) {
      expect(
        new RegExp(`\\b${word}\\b`, "i").test(text),
        `${name} contains the word ${word}: a census file must not write`,
      ).toBe(false);
    }
  });
});

/**
 * SF-M5: an unpriced-balance readout that finds no gaps returns zero rows, and
 * zero rows read the same as "the query matched nothing". Both files therefore
 * end in a `spot rows examined` row counted over the same spot rows the gap
 * is cut from, so an empty gap list still states how many rows were in scope.
 */
describe.each(["unpriced-balances-census.sql", "unpriced-balances-current.sql"])(
  "marksource unpriced readout %s",
  (name) => {
    const text = read(name);

    it("reports how many spot rows it examined, from a UNION ALL row", () => {
      expect(
        /UNION ALL/i.test(text),
        `${name}: the examined-count row must be a UNION ALL row, so it prints when the gap list is empty`,
      ).toBe(true);
      expect(
        text.includes("'spot rows examined"),
        `${name}: without a 'spot rows examined' row, no gaps cannot be told from matched nothing`,
      ).toBe(true);
      expect(
        /count\(\*\)[\s\S]*FROM public\.allocator_holdings[\s\S]*holding_type = 'spot'/.test(
          text.slice(anchorIndex(text, "UNION ALL")),
        ),
        `${name}: the examined row must count public.allocator_holdings spot rows`,
      ).toBe(true);
    });

    it("sizes a gap from its newest priced row at any age: no asof lower bound in the sizing LATERAL", () => {
      expect(
        /\basof\s*>=\s*g\.asof\s*-/i.test(text),
        `${name}: the refresh sizes a gap from its newest priced row at ANY age (_judge_price_gaps), so a '>= g.asof -' window here would call a refresh-sizable balance unsizable`,
      ).toBe(false);
    });
  },
);

/**
 * The history-correction runbook (plan 13, D-05). Why each rule exists:
 *  - It names the four okx census files: an operator follows the runbook to
 *    them, and a renamed file would send them to nothing.
 *  - No uuid and no planning-directory path: the directory is public, lychee checks
 *    `docs/runbooks` links offline, and a PROD row id must never be committed.
 *  - Every form other than the guarded write form passes the census files'
 *    write-keyword ban and carries no `--` comment.
 *  - Every form other than `marker` ends in ONE top-level SELECT whose first
 *    column is `marker_is_prod`: the CLI returns only the last statement's rows,
 *    so that column is what proves which database answered.
 *  - Every form that selects accounts carries the census files' `okx_account`
 *    CTE byte for byte, so its a-labels are the census files' a-labels.
 *  - The renderer refuses an unvalidated placeholder value (exit 2, nothing
 *    printed): the labels and instants are spliced into SQL.
 */
const RUNBOOK = join(
  process.cwd(),
  "docs",
  "runbooks",
  "marksource-okx-history-correction.md",
);

/** Built from parts: a test source that spells the directory is scanned as a planning reader. */
const PLANNING_DIR = [".plan", "ning/"].join("");

const FORM_RE = /<!-- form: ([a-z0-9-]+) -->\n```sql\n([\s\S]*?)\n```/g;

const EXPECTED_FORMS: readonly string[] = [
  "audit",
  "crosswalk",
  "enqueue",
  "inflight",
  "marker",
  "newjob",
  "pollafter",
  "rebuildfn",
];

/** Forms that choose accounts by a-label and so must carry the census CTE. */
const FORMS_WITH_ACCOUNT_CTE: readonly string[] = [
  "audit",
  "crosswalk",
  "enqueue",
  "inflight",
  "newjob",
  "pollafter",
];

function runbookText(): string {
  return readFileSync(RUNBOOK, "utf8");
}

function runbookForms(): Map<string, string> {
  const forms = new Map<string, string>();
  for (const m of runbookText().matchAll(FORM_RE)) forms.set(m[1], m[2]);
  return forms;
}

/** The census files' first CTE: `okx_account AS (` up to and including its `),`. */
function censusAccountCte(): string {
  const census = read("okx-snapshot-census.sql");
  const start = census.indexOf("okx_account AS (");
  const end = census.indexOf("\n),", start) + 3;
  return census.slice(start, end);
}

/**
 * Phase 178 plan 05: `okx-nonworking-keys.sql` from `user_key AS (` through the `),` that closes
 * `exchange_account AS (`. P7 and the `crosswalk` form must group keys the way the rebuild does,
 * so the block is shared byte for byte; `anchorIndex` makes a renamed CTE throw by name.
 */
function nonworkingKeyGroupBlock(): string {
  const file = read("okx-nonworking-keys.sql");
  const start = anchorIndex(file, "\nuser_key AS (") + 1;
  const exchangeAt = anchorIndex(file, "\nexchange_account AS (", start);
  const end = anchorIndex(file, "\n),", exchangeAt) + 3;
  return file.slice(start, end);
}

/**
 * The `key_digest AS (` CTE of a form, through its closing `),`. P7 prints the digest per label and
 * `enqueue` recomputes it at statement time, so the two must be one expression (review WR-R3-01).
 */
function keyDigestBlock(text: string): string {
  const start = anchorIndex(text, "\nkey_digest AS (") + 1;
  return text.slice(start, anchorIndex(text, "\n),", start) + 3);
}

/** Extracts the renderer the runbook writes with a heredoc, as an operator's shell would. */
function writeRenderer(dir: string): string {
  const m = runbookText().match(
    /cat > "\$MS_SP\/form\.mjs" <<'JS'\n([\s\S]*?)\nJS\n/,
  );
  expect(m, "the runbook must carry the form.mjs heredoc").not.toBeNull();
  const script = join(dir, "form.mjs");
  writeFileSync(script, m![1] + "\n");
  return script;
}

function render(script: string, form: string, env: Record<string, string>) {
  return spawnSync(process.execPath, [script, form], {
    cwd: process.cwd(),
    env: { ...process.env, MS_LABELS: "", MS_T0: "", MS_DEPLOYED_AT: "", ...env },
    encoding: "utf8",
  });
}

const GOOD_ENV = {
  MS_LABELS: "1,2",
  MS_T0: "2026-10-27T20:00:00Z",
  MS_DEPLOYED_AT: "2026-10-27T12:00:00Z",
};

describe("marksource history-correction runbook", () => {
  const forms = runbookForms();

  it("names each okx census file it runs", () => {
    const text = runbookText();
    for (const f of [
      "okx-snapshot-census.sql",
      "okx-holdings-census.sql",
      "okx-nonworking-keys.sql",
      "okx-rebuild-feasibility.sql",
      "okx-snapshot-rows.sql",
    ]) {
      expect(text.includes(f), `the runbook must name ${f}`).toBe(true);
    }
  });

  it("carries the P7 dead-key pre-flight and names the not-recomputed ruling (Phase 178 D-06)", () => {
    const text = runbookText();
    expect(
      /^- \*\*P7 /m.test(text),
      "the runbook must carry a pre-flight bullet starting '- **P7 ': the dead-key census runs before any enqueue",
    ).toBe(true);
    expect(
      text.includes("not recomputed (D-06)"),
      "the runbook must name the label 'not recomputed (D-06)' that P7 applies",
    ).toBe(true);
  });

  it("carries no uuid, no home path and no planning-directory path", () => {
    const text = runbookText();
    expect(UUID_RE.test(text), "uuid-shaped literal in the runbook").toBe(false);
    expect(/\/Users\//.test(text), "home path in the runbook").toBe(false);
    expect(
      text.includes(PLANNING_DIR),
      "lychee checks docs/runbooks links offline: name planning files in prose, never by path",
    ).toBe(false);
  });

  it("holds exactly the pinned forms", () => {
    expect([...forms.keys()].sort()).toEqual([...EXPECTED_FORMS].sort());
  });

  it.each([...EXPECTED_FORMS].filter((n) => n !== "enqueue"))(
    "read form %s writes nothing and carries no comment",
    (name) => {
      const sql = forms.get(name)!;
      expect(sql.includes("--"), `${name}: a comment breaks the CLI's inline form`).toBe(false);
      for (const word of WRITE_WORDS) {
        expect(
          new RegExp(`\\b${word}\\b`, "i").test(sql),
          `${name} contains the word ${word}: a read form must not write`,
        ).toBe(false);
      }
    },
  );

  it.each([...EXPECTED_FORMS].filter((n) => n !== "marker"))(
    "form %s ends in one top-level SELECT whose first column is marker_is_prod",
    (name) => {
      const sql = forms.get(name)!;
      const topLevel = sql.match(/^SELECT\b/gm) ?? [];
      expect(topLevel.length, `${name}: exactly one SELECT at line start`).toBe(1);
      expect(
        /^SELECT\s+m\.marker_is_prod\b/m.test(sql),
        `${name}: marker_is_prod must be the first output column`,
      ).toBe(true);
      expect(sql.trimEnd().endsWith(";"), `${name}: ends with the ';'`).toBe(true);
    },
  );

  it.each([...FORMS_WITH_ACCOUNT_CTE])(
    "form %s carries the census files' okx_account CTE byte for byte",
    (name) => {
      expect(
        forms.get(name)!.includes(censusAccountCte()),
        `${name}: its a-labels must be the census files' a-labels`,
      ).toBe(true);
    },
  );

  it.each(["crosswalk", "enqueue"])(
    "the %s form carries okx-nonworking-keys.sql's key-group block byte for byte (Phase 178 D-02, D-06, review CR-02)",
    (name) => {
      const block = nonworkingKeyGroupBlock();
      expect(
        block.includes("reach AS (") && block.includes("group_member AS (") && block.endsWith("),"),
        "the shared block must hold the recursive grouping and the exchange-account CTE: the slice, not the runbook, is broken",
      ).toBe(true);
      expect(
        (forms.get(name) ?? "").includes(block),
        `${name}: its dead-account count must come from P7's own grouping, so the user_key .. exchange_account block must equal okx-nonworking-keys.sql byte for byte`,
      ).toBe(true);
    },
  );

  describe("the one write form, enqueue", () => {
    const sql = forms.get("enqueue") ?? "";

    it("starts with a DO guard that raises unless the marker names PRODUCTION", () => {
      expect(sql.startsWith("DO $guard$\n"), "the first statement must be the guard").toBe(true);
      const guard = sql.slice(0, anchorIndex(sql, "$guard$;", 10));
      expect(guard.includes("RAISE EXCEPTION"), "the guard must raise").toBe(true);
      expect(
        guard.includes("IS DISTINCT FROM __MARKER__"),
        "a NULL marker must refuse exactly as a mismatched one does",
      ).toBe(true);
    });

    it("forces the rebuild through enqueue_compute_job and nothing else", () => {
      expect(sql.includes("'force_rebuild', true")).toBe(true);
      const calls = new Set(
        [...sql.matchAll(/\bpublic\.([a-z_]+)\(/g)].map((m) => m[1]),
      );
      expect([...calls]).toEqual(["enqueue_compute_job"]);
    });

    it("writes through no statement of its own", () => {
      for (const word of WRITE_WORDS) {
        expect(
          new RegExp(`\\b${word}\\b`, "i").test(sql),
          `enqueue contains the word ${word}: it may only call enqueue_compute_job`,
        ).toBe(false);
      }
    });

    it("carries the operator's rendered P7 reading as the job's expectation, under the worker's own three literals (review CR-02, WR-R2-01, WR-R3-01)", () => {
      const py = readFileSync(
        join(process.cwd(), "analytics-service", "services", "equity_reconstruction.py"),
        "utf8",
      );
      const dead = py.match(/RECONSTRUCT_EXPECTED_NON_WORKING_KEY: Final\[str\] = "([a-z_]+)"/);
      const win = py.match(/RECONSTRUCT_EXPECTED_WINDOW_KEY: Final\[str\] = "([a-z_]+)"/);
      const digest = py.match(/RECONSTRUCT_EXPECTED_KEY_DIGEST_KEY: Final\[str\] = "([a-z_]+)"/);
      expect(dead, "the worker module must define RECONSTRUCT_EXPECTED_NON_WORKING_KEY").not.toBeNull();
      expect(win, "the worker module must define RECONSTRUCT_EXPECTED_WINDOW_KEY").not.toBeNull();
      expect(digest, "the worker module must define RECONSTRUCT_EXPECTED_KEY_DIGEST_KEY").not.toBeNull();
      expect(
        sql.includes(`'${dead![1]}', j.expected_dead_accounts,`),
        `enqueue: the metadata must carry ${dead![1]} as the rendered dead-account count, not a live recount and not typed by hand`,
      ).toBe(true);
      expect(
        sql.includes(`'${win![1]}', j.expected_window_days,`),
        `enqueue: the metadata must carry ${win![1]} as the rendered predicted window`,
      ).toBe(true);
      expect(
        sql.includes(`'${digest![1]}', j.expected_key_digest`),
        `enqueue: the metadata must carry ${digest![1]} as the rendered key-set digest, the worker's third pre-write check`,
      ).toBe(true);
    });

    it("computes its key digest with the block okx-nonworking-keys.sql prints, byte for byte, so the rendered value and the live one are one expression (review WR-R3-01)", () => {
      const block = keyDigestBlock(read("okx-nonworking-keys.sql"));
      expect(
        block.includes('md5(string_agg(u.id::text || \':\' || CASE WHEN u.working THEN \'t\' ELSE \'f\' END, \'|\' ORDER BY u.id::text COLLATE "C"))'),
        "the shared digest block must keep the canonical expression the worker reproduces (sorted by id text in byte order, <id>:<t or f>, joined by '|'): the slice, not the runbook, is broken",
      ).toBe(true);
      expect(sql.includes(block), "enqueue: the key_digest CTE must equal okx-nonworking-keys.sql's, so P7's printed digest and the statement's live digest cannot diverge").toBe(true);
    });

    it("targets a label only when its statement-time dead-account count, window and key digest equal the rendered P7 reading (review WR-R2-01, SFH R2-3, WR-R3-01)", () => {
      const flat = sql.replace(/\s+/g, " ");
      for (const required of [
        "FROM (VALUES __EXPECTED__) AS v(label_no, expected_dead_accounts, expected_window_days, expected_key_digest)",
        "JOIN expected ex ON ex.label_no = a.label_no",
        "AND ex.expected_dead_accounts = (SELECT count(*) FROM exchange_account x WHERE x.label_no = a.label_no AND x.state = 'dead')",
        "AND ex.expected_window_days = CASE WHEN EXISTS (SELECT 1 FROM exchange_account x WHERE x.label_no = a.label_no AND x.state = 'crawled' AND x.venue = 'okx') THEN 90 ELSE 730 END",
        "AND ex.expected_key_digest = (SELECT d.key_digest FROM key_digest d WHERE d.label_no = a.label_no)",
      ]) {
        expect(flat.includes(required), `enqueue must carry ${JSON.stringify(required)}: a moved reading must not be targeted`).toBe(true);
      }
    });

    it("skips an account that already has a reconstruct job open or created since t0", () => {
      expect(sql.includes("c.created_at >= __T0__")).toBe(true);
      expect(sql.includes("'pending', 'running', 'done_pending_children', 'failed_retry'")).toBe(true);
    });
  });

  describe("renderer", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-render-"));
    const script = writeRenderer(dir);
    const P7_HEAD = "account_label,keys_total,dead_exchange_accounts,predicted_window_days,p7_outcome,key_digest";
    const D1 = "0123456789abcdef0123456789abcdef";
    const D2 = "fedcba9876543210fedcba9876543210";
    const writeP7 = (rows: string[]) => {
      writeFileSync(join(dir, "p7-before-enqueue.csv"), [P7_HEAD, ...rows].join("\n") + "\n");
    };
    writeP7([`a1,2,1,90,rebuild,${D1}`, `a2,3,0,90,rebuild,${D2}`]);
    const ENV = { ...GOOD_ENV, MS_SP: dir };
    /** Sets the re-run file's modification time to an absolute instant, as the clock of the machine that ran P7 would. */
    const stamp = (iso: string) => utimesSync(join(dir, "p7-before-enqueue.csv"), new Date(iso), new Date(iso));

    it.each([...EXPECTED_FORMS])("renders %s with no placeholder left", (name) => {
      const r = render(script, name, ENV);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(/__[A-Z0-9_]+__/.test(r.stdout)).toBe(false);
    });

    it("refuses labels that are not comma-separated positive integers", () => {
      for (const bad of ["1;2", "0", "1,,2", "1,2;DROP", "", "01"]) {
        const r = render(script, "pollafter", { ...ENV, MS_LABELS: bad });
        expect(r.status, `labels ${JSON.stringify(bad)} must exit 2`).toBe(2);
        expect(r.stdout).toBe("");
      }
    });

    it("refuses an instant that is not an ISO UTC calendar instant", () => {
      for (const bad of ["2026-10-27", "2026-10-27T20:00:00", "2026-02-31T00:00:00Z", "x'; --", ""]) {
        const r = render(script, "pollafter", { ...ENV, MS_DEPLOYED_AT: bad });
        expect(r.status, `instant ${JSON.stringify(bad)} must exit 2`).toBe(2);
        expect(r.stdout).toBe("");
      }
    });

    it("refuses an unknown form name", () => {
      expect(render(script, "nosuchform", GOOD_ENV).status).toBe(2);
    });

    it("renders the enqueue form's __EXPECTED__ from the B'3a re-run file, label by label (review WR-R2-01)", () => {
      writeP7([`a1,2,1,90,rebuild,${D1}`, `a2,3,0,90,rebuild,${D2}`, `a3,1,2,90,rebuild,${D1}`]);
      const r = render(script, "enqueue", ENV);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.includes(`FROM (VALUES (1,1,90,'${D1}'),(2,0,90,'${D2}')) AS v(label_no`), "only the chosen labels, in MS_LABELS order, each with its key digest").toBe(true);
    });

    it("refuses __EXPECTED__ when the re-run file is missing, empty, quoted, lacks a chosen label, lacks a key digest, or the label is not a P7 rebuild at window 90 (review WR-R2-01, SFH R2-3, WR-R3-01)", () => {
      const bad: Array<[string, string[] | null | "empty"]> = [
        ["no file", null],
        ["an empty file (the query errored)", "empty"],
        ["header only (the query printed no row)", []],
        ["a chosen label missing", [`a1,2,1,90,rebuild,${D1}`]],
        ["a quoted field", [`a1,2,"1",90,rebuild,${D1}`, `a2,3,0,90,rebuild,${D2}`]],
        ["a label ruled not recomputed", [`a1,2,1,90,not recomputed (D-06),${D1}`, `a2,3,0,90,rebuild,${D2}`]],
        ["a label whose window is 730", [`a1,2,1,730,rebuild,${D1}`, `a2,3,0,90,rebuild,${D2}`]],
        ["a dead count that is not a whole number", [`a1,2,x,90,rebuild,${D1}`, `a2,3,0,90,rebuild,${D2}`]],
        ["a row with no key digest", ["a1,2,1,90,rebuild,", `a2,3,0,90,rebuild,${D2}`]],
        ["a key digest that is not 32 lower-case hex characters", [`a1,2,1,90,rebuild,${D1.toUpperCase()}`, `a2,3,0,90,rebuild,${D2}`]],
        ["a key digest one character short", [`a1,2,1,90,rebuild,${D1.slice(1)}`, `a2,3,0,90,rebuild,${D2}`]],
        ["a re-run file from before the key digest column existed", ["a1,2,1,90,rebuild", "a2,3,0,90,rebuild"]],
      ];
      for (const [why, rows] of bad) {
        if (rows === null) rmSync(join(dir, "p7-before-enqueue.csv"), { force: true });
        else if (rows === "empty") writeFileSync(join(dir, "p7-before-enqueue.csv"), "");
        else writeP7(rows);
        const r = render(script, "enqueue", ENV);
        expect(r.status, `${why}: must exit 2`).toBe(2);
        expect(r.stdout, `${why}: must print nothing`).toBe("");
      }
      writeP7([`a1,2,1,90,rebuild,${D1}`, `a2,3,0,90,rebuild,${D2}`]);
    });

    it("refuses __EXPECTED__ for a re-run file modified before MS_T0 and accepts one modified at or after it (silent-failure hunt R3-2)", () => {
      // GOOD_ENV.MS_T0 is 2026-10-27T20:00:00Z.
      stamp("2026-10-27T19:59:59Z");
      const stale = render(script, "enqueue", ENV);
      expect(stale.status, "a file older than MS_T0 is a reading nobody re-took after t0").toBe(2);
      expect(stale.stdout).toBe("");
      expect(stale.stderr.includes("before MS_T0"), "the refusal must name the cause").toBe(true);
      stamp("2026-10-27T20:00:00Z");
      expect(render(script, "enqueue", ENV).status, "a file written at t0 exactly is not older than it").toBe(0);
      stamp("2026-10-27T20:05:00Z");
      expect(render(script, "enqueue", ENV).status, "a file written after t0 is the B'3a re-run").toBe(0);
      writeP7([`a1,2,1,90,rebuild,${D1}`, `a2,3,0,90,rebuild,${D2}`]);
    });

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });
  });
});

/**
 * Phase 178 OKXREWRITE plan 02: the operator's classification list in B'5 rule 3 is the closed
 * set the deployed rebuild can raise. The runbook said fifteen tokens after Phase 171 added a
 * sixteenth, and `account_key_read_stalled` sat in neither list, so an operator met it as a
 * token "outside the set" and stopped. The frozensets are parsed from the module, so a token
 * added to the code turns this RED until the runbook names it.
 */
describe("the runbook's refusal vocabulary is the rebuild's own (Phase 178)", () => {
  const MODULE = join(process.cwd(), "analytics-service", "services", "equity_reconstruction.py");

  /** The double-quoted lower_snake tokens of one `NAME: Final[frozenset[str]] = frozenset(` literal. */
  function frozensetTokens(py: string, name: string): string[] {
    const start = anchorIndex(py, `${name}: Final[frozenset[str]] = frozenset(`);
    const end = anchorIndex(py, "\n)\n", start);
    return [...py.slice(start, end).matchAll(/"([a-z][a-z_]*)"/g)].map((m) => m[1]);
  }

  const py = readFileSync(MODULE, "utf8");
  const codeTokens = new Set([
    ...frozensetTokens(py, "FORCED_REBUILD_ANCHOR_REASONS"),
    ...frozensetTokens(py, "FORCED_REBUILD_ACCOUNT_REASONS"),
  ]);

  const text = runbookText();
  const ruleStart = anchorIndex(text, "3. **A refusal");
  const rule3 = text.slice(ruleStart, anchorIndex(text, "\n4. **", ruleStart));
  const reenqueueAt = anchorIndex(rule3, "**Re-enqueue ONCE**");
  const recordAt = anchorIndex(rule3, "**Record only, no re-run**", reenqueueAt);
  const anyOtherAt = anchorIndex(rule3, "Any other", recordAt);
  const reenqueueText = rule3.slice(reenqueueAt, recordAt);
  const recordText = rule3.slice(recordAt, anyOtherAt);

  /** Backticked snake_case words with an underscore: token-shaped, so `t0` and plain words drop out. */
  function tokenShaped(slice: string): string[] {
    return [...slice.matchAll(/`([a-z]+(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]);
  }

  it("has a non-empty code set (vacuity guard)", () => {
    expect(codeTokens.size, "the frozensets parsed to nothing: the parser, not the runbook, is broken").toBeGreaterThan(0);
  });

  it("states the code's token count after FORCED_REBUILD_REFUSAL_REASONS", () => {
    const m = rule3.match(/`FORCED_REBUILD_REFUSAL_REASONS`,\s*(\d+)\s*tokens/);
    expect(m, "rule 3 must state the count as `FORCED_REBUILD_REFUSAL_REASONS`, N tokens").not.toBeNull();
    expect(
      Number(m![1]),
      `rule 3 says ${m![1]} tokens, the code holds ${codeTokens.size}: ${[...codeTokens].sort().join(", ")}`,
    ).toBe(codeTokens.size);
  });

  it("lists every code token in exactly one of the two lists and no token the code lacks", () => {
    const reenqueue = tokenShaped(reenqueueText);
    const record = tokenShaped(recordText);
    const all = [...reenqueue, ...record];
    const missing = [...codeTokens].filter((t) => !all.includes(t)).sort();
    const extra = [...new Set(all)].filter((t) => !codeTokens.has(t)).sort();
    const twice = [...codeTokens].filter((t) => reenqueue.includes(t) && record.includes(t)).sort();
    expect(missing, `rule 3 names neither list for: ${missing.join(", ")}`).toEqual([]);
    expect(extra, `rule 3 lists tokens the code does not raise: ${extra.join(", ")}`).toEqual([]);
    expect(twice, `rule 3 lists these in both lists: ${twice.join(", ")}`).toEqual([]);
  });

  it("states each list's size and the size equals its length", () => {
    for (const [name, slice] of [
      ["Re-enqueue ONCE", reenqueueText],
      ["Record only, no re-run", recordText],
    ] as const) {
      const m = slice.match(/for these (\d+)/);
      expect(m, `${name}: the list must state its size as 'for these N'`).not.toBeNull();
      const listed = new Set(tokenShaped(slice)).size;
      expect(Number(m![1]), `${name} states ${m![1]} but lists ${listed} distinct tokens`).toBe(listed);
    }
  });

  it("puts account_key_read_stalled in the re-enqueue-once list (Phase 171: the stored windows are kept)", () => {
    expect(
      tokenShaped(reenqueueText).includes("account_key_read_stalled"),
      "account_key_read_stalled keeps the stored windows, so a later run can clear it: re-enqueue it once",
    ).toBe(true);
  });
});

/**
 * Phase 178 OKXREWRITE plan 05: the operator's B'1 prediction and B'5 acceptance must follow the
 * rule the deployed rebuild follows (D-05: a dead key is relevant only to its own exchange
 * account), and the audit's dead-account count must be checked against P7's prediction (D-06).
 * The two stale B'1 bullets predicted a refusal from ONE dead key, which the deployed code no
 * longer raises, so an operator following them would predict the wrong outcome for the account.
 */
describe("the runbook's B'1 rule, audit column and B'5 count check follow the deployed selection (Phase 178)", () => {
  const text = runbookText();
  const forms = runbookForms();

  /** The text from the first anchor up to (not including) the next one, by name on a miss. */
  function region(from: string, to: string): string {
    const start = anchorIndex(text, from);
    return text.slice(start, anchorIndex(text, to, start + from.length));
  }

  it("B'1 states the group rule and predicts the venue refusal from P7, with neither stale bullet", () => {
    const b1 = region("**Predict each chosen account's outcome", "## B'2");
    for (const required of [
      "is skipped and counted, never refused on its own",
      "`account_key_not_working` is predicted only when every exchange account of the allocator is dead",
      "`refused_exchange_accounts`",
    ]) {
      expect(b1.includes(required), `B'1 must say ${JSON.stringify(required)}: the deployed rebuild skips and counts a dead exchange account (D-05)`).toBe(true);
    }
    for (const stale of [
      "- An exchange account with no working key:",
      "- `keys_on_a_venue_the_rebuild_refuses` above 0:",
    ]) {
      expect(b1.includes(stale), `B'1 still carries the stale bullet ${JSON.stringify(stale)}: it predicts a refusal from a dead key (D-05)`).toBe(false);
    }
  });

  it("the audit form selects account_non_working_accounts_excluded and B'5 rule 5 compares it with P7's dead_exchange_accounts", () => {
    expect(
      (forms.get("audit") ?? "").includes("AS account_non_working_accounts_excluded"),
      "the audit form must select account_non_working_accounts_excluded: B'5 compares it with P7",
    ).toBe(true);
    const rule5 = region("5. **RECOMPUTED only when ALL", "6. **Everything else");
    for (const name of ["account_non_working_accounts_excluded", "dead_exchange_accounts"]) {
      expect(rule5.includes(name), `B'5 rule 5 must name ${name}: a mismatch between the audit and P7 is a STOP`).toBe(true);
    }
  });

  it("P7 states that the carry had no age cap from 2026-09-29 to 2026-10-19, and the SQL widens the overlap over that era (Phase 178 review CR-01)", () => {
    const p7 = region("- **P7 ", "## B'1").replace(/\s+/g, " ");
    for (const required of [
      "v0.111.0.0 (2026-09-29)",
      "v0.132.5.0 (2026-10-19)",
      "NO age limit",
      "the cap's merge CI finished 2026-10-19T20:31Z, before the 2026-10-20 05:00Z refresh",
    ]) {
      expect(p7.includes(required), `P7's Why must name ${JSON.stringify(required)}: the 7-day bound is false before the cap shipped`).toBe(true);
    }
    const sql = read("okx-nonworking-keys.sql");
    expect(
      sql.includes("DATE '2026-09-29' AND DATE '2026-10-19'"),
      "okx-nonworking-keys.sql must keep every stored day of the uncapped-carry era in the overlap test",
    ).toBe(true);
  });

  it("no label whose predicted window is not 90 reaches the write: P7, B'1 and B'3a say so (review WR-03)", () => {
    const flat = (t: string) => t.replace(/\s+/g, " ");
    const p7 = flat(region("- **P7 ", "## B'1"));
    for (const required of [
      "A label whose `predicted_window_days` is not 90 is never written",
      "recorded, not recomputed (no crawled OKX account)",
    ]) {
      expect(p7.includes(required), `P7 must say ${JSON.stringify(required)}: a 730-day rewrite is outside the 90-day OKX window`).toBe(true);
    }
    const b1 = flat(region("**Predict each chosen account's outcome", "## B'2"));
    expect(b1.includes("A label that does not read 90 is left out of `MS_LABELS`"), "B'1 must carry the leave-out").toBe(true);
    const b3a = flat(region("## B'3a", "## B'3b"));
    expect(b3a.includes("no longer reads `predicted_window_days` 90"), "B'3a must STOP when a chosen label's window moved off 90").toBe(true);
  });

  it("P7 counts the hard-deleted key from the polls' audit rows, keeps the owner's confirmation as the backstop, and 'What this cannot reach' says so (review WR-01, WR-R2-02)", () => {
    const flat = (t: string) => t.replace(/\s+/g, " ");
    const p7 = flat(region("- **P7 ", "## B'1"));
    for (const required of [
      "A hard-deleted key leaves a trace, and P7 counts it (`deleted_keys_seen_in_window`)",
      "`allocator.holdings.sync_completed` or `allocator.holdings.sync_failed`",
      "that are no longer in `api_keys`",
      "A count above 0 rules the label `not recomputed (D-06)`",
      "The audit write is fire-and-forget",
      "the key owner's confirmation that no key of that account was deleted with its holdings",
    ]) {
      expect(p7.includes(required), `P7 must say ${JSON.stringify(required)}: a deleted key leaves a poll audit trace the file counts`).toBe(true);
    }
    expect(p7.includes("cannot see a hard-deleted key"), "P7 still says a deleted key is invisible: the audit trace shows it").toBe(false);
    const cannot = flat(region("## What this cannot reach", "## Rollback"));
    expect(
      cannot.includes("whose poll audit rows were dropped (Phase 178, backstop only)") && !cannot.includes("unmeasurable"),
      "'What this cannot reach' must name only the dropped-audit residual of a hard-deleted key",
    ).toBe(true);
    const sql = read("okx-nonworking-keys.sql");
    for (const required of [
      "'allocator.holdings.sync_completed', 'allocator.holdings.sync_failed'",
      "AS deleted_keys_seen_in_window",
      "coalesce(dkt.deleted_keys_seen_in_window, 0) > 0",
    ]) {
      expect(sql.includes(required), `okx-nonworking-keys.sql must carry ${JSON.stringify(required)}`).toBe(true);
    }
  });

  it("P7's audit-trace literals are the ones the holdings poll emits: the two actions, entity_type api_key, user_id the allocator, entity_id the key (silent-failure hunt R3-3)", () => {
    const worker = readFileSync(join(process.cwd(), "analytics-service", "services", "job_worker.py"), "utf8");
    const recon = readFileSync(join(process.cwd(), "analytics-service", "services", "equity_reconstruction.py"), "utf8");
    const sql = read("okx-nonworking-keys.sql");

    const literalStart = anchorIndex(worker, "AllocatorHoldingsAction = Literal[");
    const taxonomy = new Set(
      [...worker.slice(literalStart, anchorIndex(worker, "\n]", literalStart)).matchAll(/"(allocator\.holdings\.[a-z_]+)"/g)].map((m) => m[1]),
    );
    const emitted = new Set(
      [...worker.matchAll(/_emit_audit\(\s*allocator_id,\s*api_key_id,\s*"(allocator\.holdings\.[a-z_]+)"/g)].map((m) => m[1]),
    );
    const emitStart = anchorIndex(worker, "\ndef _emit_audit(");
    const emitBody = worker.slice(emitStart, anchorIndex(worker, "\n# ---", emitStart));
    const pollCompleted = recon.match(/^_POLL_COMPLETED_ACTION = "([a-z._]+)"/m);
    expect(taxonomy.size, "the AllocatorHoldingsAction literal parsed to nothing: the parser, not the SQL, is broken").toBeGreaterThan(1);
    expect(emitted.size, "no _emit_audit call site parsed: the parser, not the SQL, is broken").toBeGreaterThan(0);
    expect(pollCompleted, "equity_reconstruction.py must define _POLL_COMPLETED_ACTION").not.toBeNull();

    const actionList = anchorIndex(sql, "al.action IN (");
    const sqlActions = [...sql.slice(actionList, anchorIndex(sql, ")", actionList)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(sqlActions.length, "the SQL's action list parsed to nothing").toBeGreaterThan(1);
    for (const action of sqlActions) {
      expect(taxonomy.has(action), `P7 reads ${action}, which AllocatorHoldingsAction no longer lists: a renamed action turns deleted_keys_seen_in_window to 0 for every label`).toBe(true);
      expect(emitted.has(action), `P7 reads ${action}, which no _emit_audit call site emits any more`).toBe(true);
    }
    expect(sqlActions.includes(pollCompleted![1]), "P7's list must include the action the reconstruction's emptiness proof reads (_POLL_COMPLETED_ACTION)").toBe(true);

    const entityType = emitBody.match(/entity_type="([a-z_]+)"/);
    expect(entityType, "_emit_audit must pass a literal entity_type").not.toBeNull();
    expect(sql.includes(`al.entity_type = '${entityType![1]}'`), `P7 must filter audit_log on entity_type '${entityType![1]}', the one _emit_audit writes`).toBe(true);
    expect(emitBody.includes("user_id=allocator_id"), "_emit_audit must write the allocator as user_id: P7 ties a trace to its allocator by audit_log.user_id").toBe(true);
    expect(emitBody.includes("entity_id=api_key_id"), "_emit_audit must write the key as entity_id: P7 asks whether that id is still in api_keys").toBe(true);
    for (const required of ["JOIN public.audit_log al ON al.user_id = a.allocator_id", "k.id = al.entity_id"]) {
      expect(sql.includes(required), `P7 must carry ${JSON.stringify(required)}`).toBe(true);
    }
  });

  it("the crosswalk's label-total check is an abort and a fingerprint tie has its own end state (silent-failure hunt M2, review WR-R2-03)", () => {
    const xw = region("### Probe labels and census labels", "<!-- form: crosswalk -->").replace(/\s+/g, " ");
    for (const required of [
      "**Abort if** the probe and the crosswalk did not run on the same UTC day, or `probe_accounts_total` differs from the probe summary's `accounts`",
      "**An ambiguous fingerprint is a per-label outcome, not an abort.**",
      "a census row whose predicted fingerprint equals another census row's predicted fingerprint",
      "A re-run never clears it",
      "`recorded, not recomputed (crosswalk ambiguous)` and left out of `MS_LABELS`",
      "`fingerprint_ties` is the number of OTHER census rows whose six predicted counts equal this row's",
      "Above 0 the row's fingerprint is `ambiguous`, whatever the probe record shows, and it is never `match`",
      "No ruling makes an ambiguous label writable",
    ]) {
      expect(xw.includes(required), `the crosswalk section must say ${JSON.stringify(required)}: a tie must end in a recorded outcome, not loop on an abort a re-run cannot clear`).toBe(true);
    }
    expect(xw.includes("**Abort if** an `ok` probe record's fingerprint equals"), "the tie is no longer a runbook-wide abort").toBe(false);
    expect(xw.includes("unless the founder's recorded ruling"), "the founder-override clause was unreachable (plan 04 requires match for every written label) and is dropped").toBe(false);
    const form = (forms.get("crosswalk") ?? "").replace(/\s+/g, " ");
    expect(
      form.includes("count(*) OVER (PARTITION BY pr.okx_members, pr.bybit_members, pr.other_members, pr.zero_contribution_members, pr.non_working_accounts_excluded, CASE WHEN pr.okx_members > 0 THEN 90 ELSE 730 END) - 1 AS fingerprint_ties"),
      "the crosswalk form must print fingerprint_ties over the same six predicted counts the probe fingerprint compares",
    ).toBe(true);
  });

  it("B'3a re-runs P7 and STOPs on any move or an empty reading, and rule 3 sends account_keys_changed back to P7 (review CR-02, SFH M1, SFH R2-1)", () => {
    const b3a = region("## B'3a", "## B'3b").replace(/\s+/g, " ");
    for (const required of [
      "re-run P7",
      "okx-nonworking-keys.sql",
      "**STOP** if the file errors, prints no row, or lacks a chosen label",
      "any of `dead_exchange_accounts`, `dead_keys`, `in_window_days_overlapping_dead_key_holdings`, `in_window_days_written_in_bulk`, `deleted_keys_seen_in_window`, `p7_outcome` or `key_digest` differs for any chosen label",
      "with the pre-flight file `$MS_SP/p7-nonworking.csv`",
      "refuses (exit 2) a file modified before `MS_T0`",
      "every B'3a, the re-enqueue after a refusal included, exports a fresh `MS_T0` and then re-runs P7",
      "never enqueue on a reading that has moved",
      "the renderer fills the `enqueue` form's `__EXPECTED__` from it",
    ]) {
      expect(b3a.includes(required), `B'3a must say ${JSON.stringify(required)}: P7 is read once before the write otherwise`).toBe(true);
    }
    const rule3 = region("3. **A refusal", "\n4. **").replace(/\s+/g, " ");
    expect(
      rule3.includes("`account_keys_changed` also means the enqueue's expectation (the P7 dead-account count or window) no longer matched") &&
        rule3.includes("re-run P7 first"),
      "rule 3 must name account_keys_changed as the expectation mismatch and send the operator back to P7",
    ).toBe(true);
  });

  it("B'3a keeps the re-run and the write clear of the holdings poll band, reading both slots from the manifest (review WR-R2-01)", () => {
    const b3a = region("## B'3a", "## B'3b").replace(/\s+/g, " ");
    for (const required of [
      "**Timing.** B'3a and B'3b are one sitting and fall outside the daily holdings poll and refresh band",
      "`poll-allocator-positions`",
      "`refresh-allocator-equity`",
      "never from memory",
      "opens 30 minutes before the poll slot and closes 105 minutes after the refresh slot",
    ]) {
      expect(b3a.includes(required), `B'3a must say ${JSON.stringify(required)}`).toBe(true);
    }
    expect(
      /\b[0-2][0-9]:[0-5][0-9]Z to [0-2][0-9]:[0-5][0-9]Z\b/.test(b3a),
      "B'3a names a clock band as an example: it goes stale when MARKSOURCE plan 08's cut-over moves both jobs, and the rule is read from the manifest at run time",
    ).toBe(false);
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "scripts", "prod-prober", "cron-manifest.json"), "utf8")) as {
      jobs: Array<{ jobname: string; schedule: string }>;
    };
    for (const name of ["poll-allocator-positions", "refresh-allocator-equity"]) {
      expect(
        manifest.jobs.some((j) => j.jobname === name),
        `the manifest has no job named ${name}: the runbook points the operator at a slot that is not there`,
      ).toBe(true);
    }
  });

  it("B'3b binds the job to the key set, says so, and claims nothing the contract does not bind (review WR-R3-01)", () => {
    const b3b = region("## B'3b", "<!-- form: enqueue -->").replace(/\s+/g, " ");
    for (const required of [
      "its own key digest equal the rendered values",
      "added, deleted, revived or killed, which the two counts cannot see",
      "`expected_key_digest`",
      "on every claim (a job that is deferred and claimed again is checked again)",
      "What the contract binds is the allocator's key set and each key's working flag",
      "It does not bind P7's other inputs",
    ]) {
      expect(b3b.includes(required), `B'3b must say ${JSON.stringify(required)}`).toBe(true);
    }
    const b3a = region("## B'3a", "## B'3b").replace(/\s+/g, " ");
    expect(b3a.includes("or `key_digest` differs for any chosen label"), "B'3a must STOP on a moved key digest").toBe(true);
  });

  it("B'3c requires an armed expectation on every forced job, and the newjob form prints it (review SFH R2-1)", () => {
    const newjob = (forms.get("newjob") ?? "").replace(/\s+/g, " ");
    for (const required of [
      "AS expectation_armed",
      "jsonb_typeof(c.metadata -> 'expected_non_working_accounts') = 'number'",
      "jsonb_typeof(c.metadata -> 'expected_window_days') = 'number'",
      "jsonb_typeof(c.metadata -> 'expected_key_digest') = 'string'",
      "= count(c.id)",
    ]) {
      expect(newjob.includes(required), `newjob must carry ${JSON.stringify(required)}`).toBe(true);
    }
    const b3c = region("## B'3c", "## B'4").replace(/\s+/g, " ");
    expect(
      b3c.includes("`forced_jobs_since_t0` 1 and `expectation_armed` true") && b3c.includes("**STOP** on a false `expectation_armed`"),
      "B'3c must require expectation_armed true for every label and STOP otherwise",
    ).toBe(true);
    expect(
      b3c.includes("the job may already have started") && b3c.includes("detective and not preventive") && !b3c.includes("before the worker claims it"),
      "B'3c must not promise the operator can act before the worker claims the job: a new job is claimed within seconds",
    ).toBe(true);
  });

  it("P1 checks the D-05 fix, P4 requires each target's own ordering reading, rule 6 stops on a NULL count (D-02, D-05, D-06)", () => {
    const p1 = region("- **P1 ", "- **P2 ");
    expect(
      p1.includes("git grep -n -F 'account_non_working_accounts_excluded'"),
      "P1 must check the deployed SHA carries the D-05 fix",
    ).toBe(true);
    const p4 = region("- **P4 ", "- **P5 ");
    expect(p4.includes("Also read each target"), "P4 must cite the D-02 ruling").toBe(true);
    expect(
      p4.includes("recorded, not recomputed (no ordering reading)"),
      "P4 must name the label a target gets when its OKX members read no trade",
    ).toBe(true);
    const rule5 = region("5. **RECOMPUTED only when ALL", "6. **Everything else");
    expect(rule5.includes("`predicted_window_days`"), "rule 5 must compare window_days with P7's predicted_window_days").toBe(true);
    const rule6 = region("6. **Everything else", "A rebuild's in-window level move");
    expect(
      rule6.includes("`account_non_working_accounts_excluded` is NULL"),
      "rule 6 must STOP on a completion without the count: the deployed code predates the fix",
    ).toBe(true);
    const standsAt = anchorIndex(text, "## Where this stands");
    expect(
      text.slice(standsAt, anchorIndex(text, "## Which database am I on?", standsAt)).includes("(2026-10-27, kept as lineage)"),
      "the 2026-10-27 status paragraph must be kept as lineage under a dated 2026-10-28 one",
    ).toBe(true);
  });
});

/**
 * The legacy-chain-move runbook (plan 07, D-01, D-08). Its SQL forms run on
 * PROD under the same standing authorization, so the same rules bind them:
 *  - The set of forms is pinned. An operator renders a form by name, so a form
 *    added or dropped without this list moving is a form nobody reviewed.
 *  - Every form except the two guarded write forms (`move`, `rollback`) is one
 *    read-only statement: starts WITH or SELECT, no `--` comment, exactly one
 *    `;` at the end, no uuid-shaped literal, no write keyword as a whole word.
 *  - `state` and every `reading-*` form select `m.marker_is_prod` as the first
 *    column of their final SELECT: the CLI returns only the last statement's
 *    rows, so that column is what proves which database answered.
 *  - The two write forms open with a `DO $guard$` block that raises unless the
 *    marker names PRODUCTION (`IS DISTINCT FROM`, so a NULL marker refuses).
 */
const LEGACY_RUNBOOK = join(
  process.cwd(),
  "docs",
  "runbooks",
  "marksource-legacy-chain-move-go-live.md",
);

const LEGACY_EXPECTED_FORMS: readonly string[] = [
  "marker",
  "move",
  "reading-a",
  "reading-b",
  "reading-c",
  "reading-e",
  "reading-f",
  "rollback",
  "state",
];

const LEGACY_WRITE_FORMS: readonly string[] = ["move", "rollback"];

const LEGACY_READ_FORMS = LEGACY_EXPECTED_FORMS.filter(
  (n) => !LEGACY_WRITE_FORMS.includes(n),
);

/** Forms that must answer with `marker_is_prod` as their first output column. */
const LEGACY_MARKER_FIRST_FORMS = LEGACY_EXPECTED_FORMS.filter(
  (n) => n === "state" || n.startsWith("reading-"),
);

function legacyRunbookText(): string {
  return readFileSync(LEGACY_RUNBOOK, "utf8");
}

function legacyForms(): Map<string, string> {
  const forms = new Map<string, string>();
  for (const m of legacyRunbookText().matchAll(FORM_RE)) forms.set(m[1], m[2]);
  return forms;
}

describe("marksource legacy-chain-move runbook", () => {
  const forms = legacyForms();

  it("carries no uuid, no home path and no planning-directory path", () => {
    const text = legacyRunbookText();
    expect(UUID_RE.test(text), "uuid-shaped literal in the runbook").toBe(false);
    expect(/\/Users\//.test(text), "home path in the runbook").toBe(false);
    expect(
      text.includes(PLANNING_DIR),
      "lychee checks docs/runbooks links offline: name planning files in prose, never by path",
    ).toBe(false);
  });

  it("holds exactly the pinned forms", () => {
    expect(
      [...forms.keys()].sort(),
      "a form was added, dropped or renamed: update LEGACY_EXPECTED_FORMS, and the runbook's own text, together",
    ).toEqual([...LEGACY_EXPECTED_FORMS].sort());
  });

  describe.each([...LEGACY_READ_FORMS])("read form %s", (name) => {
    const sql = (forms.get(name) ?? "").trim();

    it("is one statement starting with WITH or SELECT", () => {
      expect(
        /^(WITH|SELECT)\b/i.test(sql),
        `${name} must start with WITH or SELECT: a read form is a read`,
      ).toBe(true);
      expect(sql.split(";").length - 1, `${name} must hold exactly one ';'`).toBe(1);
      expect(sql.endsWith(";"), `${name}: the single ';' must be the last character`).toBe(true);
    });

    it("carries no -- comment", () => {
      expect(
        sql.includes("--"),
        `${name} contains '--': a comment line breaks the CLI's inline form; remove it`,
      ).toBe(false);
    });

    it("carries no uuid-shaped literal", () => {
      expect(
        UUID_RE.test(sql),
        `${name} carries a uuid-shaped literal: the runbook is public, select by position or label instead`,
      ).toBe(false);
    });

    it("carries no write keyword as a whole word", () => {
      for (const word of WRITE_WORDS) {
        expect(
          new RegExp(`\\b${word}\\b`, "i").test(sql),
          `${name} contains the word ${word}: a read form must not write`,
        ).toBe(false);
      }
    });
  });

  it.each([...LEGACY_MARKER_FIRST_FORMS])(
    "form %s selects marker_is_prod as the first column of its one top-level SELECT",
    (name) => {
      const sql = forms.get(name) ?? "";
      const topLevel = sql.match(/^SELECT\b/gm) ?? [];
      expect(
        topLevel.length,
        `${name}: exactly one SELECT at line start (the final one); indent the CTE selects`,
      ).toBe(1);
      expect(
        /^SELECT\s+m\.marker_is_prod\b/m.test(sql),
        `${name}: the final SELECT must start with m.marker_is_prod, or the output cannot prove which database answered`,
      ).toBe(true);
    },
  );

  it("reading-c states its population and reads a missing closed-day row as not agreeing (SF-M6)", () => {
    const sql = forms.get("reading-c") ?? "";
    expect(sql.includes("AS allocators_considered"), "reading-c must count the allocators it compared").toBe(true);
    expect(
      sql.includes("AS allocators_excluded_unmarked"),
      "reading-c must count the allocators left out for a missing mark or a non-positive sum",
    ).toBe(true);
    expect(
      sql.includes("coalesce(c.within_tolerance, false)") || /coalesce\([^)]*within_tolerance[^)]*false\)/.test(sql),
      "a missing closed-day snapshot must read within_tolerance = false, never NULL",
    ).toBe(true);
  });

  it.each([...LEGACY_WRITE_FORMS])(
    "write form %s starts with a DO guard that raises unless the marker names PRODUCTION",
    (name) => {
      const sql = forms.get(name) ?? "";
      expect(
        sql.startsWith("DO $guard$\n"),
        `${name}: the first statement must be the DO $guard$ block`,
      ).toBe(true);
      const guard = sql.slice(0, anchorIndex(sql, "$guard$;", 10));
      expect(guard.includes("RAISE EXCEPTION"), `${name}: the guard must raise`).toBe(true);
      expect(
        guard.includes("IS DISTINCT FROM __MARKER__"),
        `${name}: a NULL marker must refuse exactly as a mismatched one does (IS DISTINCT FROM)`,
      ).toBe(true);
    },
  );
});

it("the census buckets an unpriced balance with no priced row at all as never priced by this key", () => {
  const text = read("unpriced-balances-census.sql");
  expect(
    text.includes("'1 unsizable: never priced by this key'"),
    "the unsizable bucket label must say the key never priced the symbol, not a day window",
  ).toBe(true);
  expect(/within \d+ days/i.test(text), "no day window may be named in the bucket label").toBe(false);
});
