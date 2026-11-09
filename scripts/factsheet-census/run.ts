/**
 * Phase 196 plan 01 (SC-5): the Playwright driver for the factsheet census.
 *
 *   npx tsx scripts/factsheet-census/run.ts --self-test
 *   CENSUS_BASE_URL=... CENSUS_STRATEGIES='A:<id>,B:<id>,C:<id>' \
 *     npx tsx scripts/factsheet-census/run.ts --mode before
 *   ... --mode after                     (twice per strategy: Advanced closed, then open)
 *   ... --mode after --print             (print-media pass over /factsheet/<id>/tearsheet)
 *   CENSUS_SHARE_URL=... ... --share     (one anonymous render of a share link)
 *
 * The page is read anonymously. The UI-SPEC says "as an allocator"; no credential is
 * ever entered here, and the only allocator-only element in the article is the AUM chip,
 * so a before run and an after run stay comparable (196-CENSUS.md, "Method").
 *
 * IDS NEVER PRINT. The repo is public and tracks .planning/. Strategy ids and the share
 * link reach this script through the environment only; the printed table names a profile
 * letter and the page's own H1. Before anything is written to stdout the output is checked
 * against every env id and against any UUID-shaped substring, and on a hit the run exits 2
 * having printed nothing.
 *
 * Exit codes: 0 printed; 1 could not measure (page missing, no article, self-test mismatch);
 * 2 refused to print (an id-shaped string was about to leak); 64 usage.
 */

import { chromium, type Page } from "@playwright/test";
import { countFactsheetCensus, type CensusCounts } from "./count";

type Profile = "A" | "B" | "C";
type Row = { profile: string; name: string; state: string; counts: CensusCounts };

const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Ids known to this run; the error path scrubs them (Playwright messages quote the URL). */
let knownSecrets: string[] = [];

function scrub(text: string): string {
  let out = text;
  for (const s of knownSecrets) if (s.length >= 6) out = out.split(s).join("<redacted>");
  return out.replace(new RegExp(UUID_SHAPE.source, "gi"), "<redacted>");
}

function usage(msg: string): never {
  console.error(`census: ${msg}`);
  process.exit(64);
}

/** `A:<id>,B:<id>,C:<id>` into ordered pairs. Anything else is a usage error. */
function parseStrategies(raw: string | undefined): Array<{ profile: Profile; id: string }> {
  if (!raw) usage("CENSUS_STRATEGIES is not set (format A:<id>,B:<id>,C:<id>)");
  return raw.split(",").map((part) => {
    const [p, id] = part.trim().split(":");
    if ((p !== "A" && p !== "B" && p !== "C") || !id) usage("CENSUS_STRATEGIES entries must read A:<id>, B:<id> or C:<id>");
    return { profile: p, id };
  });
}

/**
 * The page-side function reaches the browser as source text, and tsx compiles with
 * keepNames, which wraps named functions in a `__name(...)` helper that does not exist
 * in the page. Defining it first (as a string, so tsx does not rewrite it) keeps the
 * shipped function runnable.
 */
async function prepare(page: Page): Promise<void> {
  await page.evaluate("window.__name = window.__name || ((f) => f)");
}

/** Scroll the whole page in viewport steps so LazyMount panels mount, then return to the top. */
async function scrollThrough(page: Page): Promise<void> {
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(`(async () => {
      const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 150));
      }
      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise((r) => setTimeout(r, 300));
    })()`);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

async function count(page: Page): Promise<CensusCounts> {
  await prepare(page);
  return page.evaluate(countFactsheetCensus as unknown as () => CensusCounts);
}

async function hasArticle(page: Page): Promise<boolean> {
  return (await page.locator("article#factsheet-main").count()) > 0;
}

async function displayName(page: Page): Promise<string> {
  const h1 = page.locator("article#factsheet-main h1").first();
  const text = (await h1.count()) > 0 ? await h1.innerText() : "";
  return text.replace(/\s+/g, " ").trim() || "(no H1)";
}

async function measure(page: Page, url: string, label: string): Promise<{ name: string; counts: CensusCounts }> {
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  if (!res || res.status() >= 400) {
    console.error(`census: profile ${label} answered ${res ? res.status() : "no response"}; not substituting another strategy`);
    process.exit(1);
  }
  if (!(await hasArticle(page))) {
    console.error(`census: profile ${label} has no article#factsheet-main on the page; not substituting another strategy`);
    process.exit(1);
  }
  await prepare(page);
  await scrollThrough(page);
  return { name: await displayName(page), counts: await count(page) };
}

const COLUMNS = ["profile", "display name", "state", "sections", "charts", "brush", "repeated", "warnings", "hints", "on request"];

function renderTable(rows: Row[]): string {
  const head = `| ${COLUMNS.join(" | ")} |\n|${COLUMNS.map(() => "---").join("|")}|`;
  const body = rows.map((r) => {
    const c = r.counts;
    return `| ${r.profile} | ${r.name} | ${r.state} | ${c.sections} | ${c.charts} | ${c.masterBrush} | ${c.repeatedMetrics.length} | ${c.smallSampleWarnings} | ${c.visibleChartHints} | ${c.onRequestRows} |`;
  });
  const repeated = rows.map((r) => `- ${r.profile} (${r.state}): ${r.counts.repeatedMetrics.length === 0 ? "none" : r.counts.repeatedMetrics.join(", ")}`);
  const kinds = rows.map((r) => `- ${r.profile} (${r.state}): ${r.counts.warningKinds.length === 0 ? "none" : r.counts.warningKinds.join(", ")}`);
  return `${head}\n${body.join("\n")}\n\nRepeated metrics by row:\n${repeated.join("\n")}\n\nSmall-sample warnings by kind:\n${kinds.join("\n")}\n`;
}

/** True when `text` holds an env id, the share link or its token, or any UUID-shaped substring. */
function leaks(text: string, secrets: string[]): boolean {
  return UUID_SHAPE.test(text) || secrets.some((s) => s.length >= 6 && text.includes(s));
}

/** Refuse to print an id: exit 2 with nothing on stdout. */
function assertIdFree(text: string, secrets: string[]): void {
  if (leaks(text, secrets)) {
    console.error("census: refusing to print, the output contains an id-shaped string");
    process.exit(2);
  }
}

// --- self-test ----------------------------------------------------------------

const SELF_TEST_HTML = `<!doctype html><html><body>
<article id="factsheet-main">
  <table class="w-full text-fixed-12"><tbody><tr><td>Sharpe</td><td>1.2</td><td></td></tr></tbody></table>
  <table class="w-full text-fixed-12"><tbody><tr><td>Sharpe</td><td>1.2</td><td></td></tr></tbody></table>
  <figure><svg role="img" aria-label="chart" width="10" height="10"></svg></figure>
  <p>Ctrl/Cmd + wheel to zoom</p>
  <p class="sr-only">Hold Control or Command and turn the mouse wheel to zoom toward the cursor.</p>
  <p style="display:none">Ctrl/Cmd + wheel to zoom</p>
  <details id="factsheet-closed"><summary>Closed</summary><p>Ctrl/Cmd + wheel to zoom</p></details>
</article>
</body></html>`;

/** What SELF_TEST_HTML must count: one closed section, one chart, Sharpe repeated, one visible hint. */
const SELF_TEST_EXPECTED = {
  sections: 1,
  charts: 1,
  masterBrush: 0,
  repeatedMetrics: ["sharpe"],
  smallSampleWarnings: 0,
  visibleChartHints: 1,
  onRequestRows: 0,
} as const;

/** The output guard must fire on an id and stay quiet on clean text; exercised without the network. */
function selfTestGuard(): void {
  // Assembled at run time so this file carries no id-shaped literal.
  const uuidShaped = ["0123abcd", "0123", "0123", "0123", "0123456789ab"].join("-");
  const cases: Array<[string, string[], boolean]> = [
    ["profile B | Momentum Sphinx | 12 | 38", ["abcdef123456"], false],
    [`url /factsheet/${uuidShaped}`, [], true],
    ["a row naming abcdef123456", ["abcdef123456"], true],
  ];
  for (const [text, secrets, want] of cases) {
    if (leaks(text, secrets) !== want) {
      console.error(`census self-test MISMATCH guard: expected leaks=${want} for a ${secrets.length}-secret case`);
      process.exit(1);
    }
  }
}

async function selfTest(): Promise<void> {
  selfTestGuard();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(SELF_TEST_HTML);
    const got = await count(page);
    const mismatches = (Object.keys(SELF_TEST_EXPECTED) as Array<keyof typeof SELF_TEST_EXPECTED>).filter(
      (k) => JSON.stringify(got[k]) !== JSON.stringify(SELF_TEST_EXPECTED[k]),
    );
    if (mismatches.length > 0) {
      for (const k of mismatches) console.error(`census self-test MISMATCH ${k}: expected ${JSON.stringify(SELF_TEST_EXPECTED[k])}, got ${JSON.stringify(got[k])}`);
      process.exit(1);
    }
    console.log("census self-test OK");
  } finally {
    await browser.close();
  }
}

// --- main ----------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();

  const modeIdx = args.indexOf("--mode");
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : undefined;
  const wantPrint = args.includes("--print");
  const wantShare = args.includes("--share");
  if (!wantShare && mode !== "before" && mode !== "after") usage("pass --mode before|after (or --share, or --self-test)");

  const base = process.env.CENSUS_BASE_URL?.replace(/\/+$/, "");
  const shareUrl = process.env.CENSUS_SHARE_URL;
  if (!wantShare && !base) usage("CENSUS_BASE_URL is not set");
  if (wantShare && !shareUrl) usage("--share needs CENSUS_SHARE_URL");

  const strategies = wantShare ? [] : parseStrategies(process.env.CENSUS_STRATEGIES);
  const secrets = [
    ...strategies.map((s) => s.id),
    ...(shareUrl ? [shareUrl, shareUrl.split(/[/?#]/).filter(Boolean).pop() ?? ""] : []),
  ];

  knownSecrets = secrets;
  const browser = await chromium.launch();
  const rows: Row[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    if (wantShare) {
      const m = await measure(page, shareUrl!, "share");
      rows.push({ profile: "share", name: m.name, state: "anonymous share link", counts: m.counts });
    }

    for (const s of strategies) {
      if (wantPrint) {
        await page.emulateMedia({ media: "print" });
        const res = await page.goto(`${base}/factsheet/${s.id}/tearsheet`, { waitUntil: "networkidle", timeout: 60_000 });
        if (!res || res.status() >= 400) {
          console.error(`census: profile ${s.profile} tearsheet answered ${res ? res.status() : "no response"}`);
          process.exit(1);
        }
        await prepare(page);
        await scrollThrough(page);
        rows.push({ profile: s.profile, name: await displayName(page), state: "print media", counts: await count(page) });
        await page.emulateMedia({ media: "screen" });
        continue;
      }

      const first = await measure(page, `${base}/factsheet/${s.id}`, s.profile);
      if (mode === "before") {
        rows.push({ profile: s.profile, name: first.name, state: "as loaded", counts: first.counts });
        continue;
      }
      rows.push({ profile: s.profile, name: first.name, state: "Advanced closed", counts: first.counts });
      // Open the Advanced disclosure (the after layout's one summary) and count again.
      const summary = page.locator("#factsheet-advanced > summary");
      if ((await summary.count()) > 0) {
        await summary.click();
        await scrollThrough(page);
        rows.push({ profile: s.profile, name: first.name, state: "Advanced open", counts: await count(page) });
      } else {
        console.error(`census: profile ${s.profile} has no #factsheet-advanced summary; the Advanced-open count is skipped`);
      }
    }
  } finally {
    await browser.close();
  }

  const out = renderTable(rows);
  assertIdFree(out, secrets);
  console.log(out);
}

main().catch((err: unknown) => {
  console.error(scrub(`census: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
