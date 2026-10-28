import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
          text.slice(text.indexOf("UNION ALL")),
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
      "okx-rebuild-feasibility.sql",
      "okx-snapshot-rows.sql",
    ]) {
      expect(text.includes(f), `the runbook must name ${f}`).toBe(true);
    }
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

  describe("the one write form, enqueue", () => {
    const sql = forms.get("enqueue") ?? "";

    it("starts with a DO guard that raises unless the marker names PRODUCTION", () => {
      expect(sql.startsWith("DO $guard$\n"), "the first statement must be the guard").toBe(true);
      const guard = sql.slice(0, sql.indexOf("$guard$;", 10));
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

    it("skips an account that already has a reconstruct job open or created since t0", () => {
      expect(sql.includes("c.created_at >= __T0__")).toBe(true);
      expect(sql.includes("'pending', 'running', 'done_pending_children', 'failed_retry'")).toBe(true);
    });
  });

  describe("renderer", () => {
    const dir = mkdtempSync(join(tmpdir(), "ms-render-"));
    const script = writeRenderer(dir);

    it.each([...EXPECTED_FORMS])("renders %s with no placeholder left", (name) => {
      const r = render(script, name, GOOD_ENV);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.length).toBeGreaterThan(0);
      expect(/__[A-Z0-9_]+__/.test(r.stdout)).toBe(false);
    });

    it("refuses labels that are not comma-separated positive integers", () => {
      for (const bad of ["1;2", "0", "1,,2", "1,2;DROP", "", "01"]) {
        const r = render(script, "pollafter", { ...GOOD_ENV, MS_LABELS: bad });
        expect(r.status, `labels ${JSON.stringify(bad)} must exit 2`).toBe(2);
        expect(r.stdout).toBe("");
      }
    });

    it("refuses an instant that is not an ISO UTC calendar instant", () => {
      for (const bad of ["2026-10-27", "2026-10-27T20:00:00", "2026-02-31T00:00:00Z", "x'; --", ""]) {
        const r = render(script, "pollafter", { ...GOOD_ENV, MS_DEPLOYED_AT: bad });
        expect(r.status, `instant ${JSON.stringify(bad)} must exit 2`).toBe(2);
        expect(r.stdout).toBe("");
      }
    });

    it("refuses an unknown form name", () => {
      expect(render(script, "nosuchform", GOOD_ENV).status).toBe(2);
    });

    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });
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
      const guard = sql.slice(0, sql.indexOf("$guard$;", 10));
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
