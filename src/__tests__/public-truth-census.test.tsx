/**
 * Phase 192 PUBLICTRUTH, plan 10 — the cross-surface copy census.
 *
 * THE PROPERTY. The public site (home, /security, /for-quants, Terms and the static
 * security packet) tells a visitor ONE story about key storage, cost, exchanges and
 * factsheet visibility, and nothing public links to the retired demo (D-11).
 * Plans 02 to 17 each fixed their own surface; this file is the one check that sees
 * every public surface and every app link together, so a phase interrupted halfway,
 * or a later phase that pastes an old sentence back, fails HERE and names the file.
 *
 * ORACLE INDEPENDENCE. Every banned phrase, pattern and path below is typed as a
 * literal in THIS file. Nothing is imported from `status-surface-copy.ts` or from a
 * page, so a drift in a constant fails here instead of passing against itself.
 *
 * SOURCE HALF. Comments are stripped with `stripCommentsPreserveLines` so a docblock
 * that QUOTES a banned phrase (to say it is gone) cannot red a clean tree, and the
 * reported line numbers stay real. The packet HTML is read raw: it has no TS comments.
 * Matching runs on each file's WHOLE whitespace-collapsed text, not line by line, so a
 * phrase wrapped across JSX or packet-HTML lines is still caught (SFH-1, WR-03); the
 * line number is computed only to name the hit. The matcher self-test drives the real
 * `findHits` over planted files, so a broken matcher or comment stripper fails it.
 *
 * ANTI-VACUITY. A census that walks nothing passes. Both populations are asserted to
 * contain a named list of files (`CENSUS_FILES`, `LINK_CENSUS_FILES`), so a moved
 * file or a broken walk fails instead of passing by scanning an empty list.
 *
 * SCOPE. `src/components/landing` is NOT source-scanned: `VerificationForm.tsx` keeps
 * its false "never stored" line while it is orphaned (plan 192-03; booked as
 * [192-ORPHANED-LANDING-VERIFY]). Nothing renders them any more, so the RENDERED census
 * does not reach them either; deleting or reusing them is that entry's closing condition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

// Mocks for the RENDERED half, copied from public-truth-copy.test.tsx (plan 192-03).
// next/link renders a plain anchor so href is observable.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// /for-quants mounts a client component that probes the browser session and fires analytics.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  }),
}));
vi.mock("@/lib/for-quants-analytics", () => ({
  trackForQuantsEventClient: vi.fn(),
}));
vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: vi.fn(),
}));
// Home's anonymous reads: a thenable builder with no rows and no user. `redirect`
// throws so a signed-in branch would fail loudly instead of rendering nothing.
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.not = () => chain;
      chain.then = (
        onFulfilled: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => Promise.resolve({ count: 0, data: [], error: null }).then(onFulfilled, onRejected);
      return chain;
    },
  }),
}));

import Home from "@/app/(marketing)/page";
import SecurityPage from "@/app/(marketing)/security/page";
import ForQuantsPage from "@/app/(marketing)/for-quants/page";
import TermsOfServicePage from "@/app/(marketing)/legal/terms/page";

const REPO_ROOT = process.cwd();

/**
 * The UI-SPEC "Copy census gate" list, verbatim (its eleventh entry, the raw
 * `Strategy #<hex>` id, is RAW_ID_PATTERN below), plus three phrases this phase
 * removed. The /demo-only phrases stay banned so the retired copy cannot return
 * under another route.
 */
const BANNED = [
  "never stored.",
  "AES-256-GCM",
  "Supabase Vault",
  "TLS 1.0, 1.1, and 1.2",
  "qualified allocators only",
  "Retail discovery never sees",
  "Binance, OKX, or Bybit",
  "Demo data is loading",
  "Recommendations computing",
  "Strong fit for this allocator",
  // Removed by this phase beyond the UI-SPEC list.
  "Free to list",
  "accept an intro",
  "Real product on production",
  // The pre-fix key-delete claims (CR-01): a delete removes the credential row only,
  // the strategy and its listing stay until archived. Kept specific so the true copy
  // ("Deleting a key removes its encrypted credential row ...") does not hit.
  "removes the key and the listing",
  "listing removal in a single transaction",
  "delete its strategy from your dashboard in one click",
] as const;

/** A raw id shown in place of a name: `Strategy #1a2b3c4d`, `Exploratory #1a2b3c4d`. */
const RAW_ID_PATTERN = /(Strategy|Exploratory) #[0-9a-f]{8}/;

/**
 * The same label built at runtime, in either interpolation form: a template literal
 * (`` `Strategy #${id.slice(0, 8)}` ``) or JSX (`Strategy #{id.slice(0, 8)}`). The literal
 * pattern above cannot see either, and the RENDERED half cannot either: its mocks return
 * no strategy rows, so no id label ever draws there (SFH-2). This is a SOURCE guard for
 * labels a scanned file builds ITSELF. The legitimate builder lives in `src/lib`, outside
 * every scanned root, so no scanned file may contain this shape.
 */
const RAW_ID_TEMPLATE_PATTERN = /(Strategy|Exploratory) #\s*\$?\{/;

/**
 * The shared helper `displayStrategyName` (`src/lib/strategy-display.ts`) returns
 * `Strategy #<8 hex>` for an exploratory row with no codename, so a scanned file that
 * calls it shows a raw id with no `#${` anywhere in the scanned roots. No marketing
 * surface may use it (SFH-2 residual). Banned by name, so the import and the call both hit.
 */
const RAW_ID_HELPER_PATTERN = /\bdisplayStrategyName\b/;

/**
 * A link target to a retired route: a quote or backtick, then `/demo` (optionally
 * `/api/demo`), then a slash, `?`, `#` or a closing quote. Catches `"/demo"`,
 * `"/demo?persona=..."`, `` `/demo/...` `` and the API form.
 */
const RETIRED_ROUTE_LINK = /["'`]\/(?:api\/)?demo(?:[/?#"'`])/;

/** Banned-phrase scan: the public marketing tree, shared chrome, and the packet. */
const SCAN_ROOTS = [
  "src/app/(marketing)",
  "src/components/marketing",
  "src/components/legal",
  "scripts/build-security-packet.html",
] as const;

/** Retired-route link scan: every non-test source under the app and its components. */
const LINK_SCAN_ROOTS = ["src/app", "src/components"] as const;

/** The directories D-11 deleted. They must never come back. */
const RETIRED_DIRS = ["src/app/(marketing)/demo", "src/app/api/demo"] as const;

/** The banned-phrase population must contain all of these. */
const CENSUS_FILES = [
  "src/app/(marketing)/page.tsx",
  "src/app/(marketing)/security/page.tsx",
  "src/app/(marketing)/for-quants/page.tsx",
  "src/app/(marketing)/legal/terms/page.tsx",
  "scripts/build-security-packet.html",
] as const;

/** The link population must contain all of these (shared chrome included). */
const LINK_CENSUS_FILES = [
  "src/app/(marketing)/page.tsx",
  "src/app/(marketing)/layout.tsx",
  "src/components/legal/LegalFooter.tsx",
  "src/components/marketing/MarketingHeaderActions.tsx",
] as const;

function isTestPath(rel: string): boolean {
  return /\.test\.[^/]+$/.test(rel) || rel.split("/").includes("__tests__");
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
}

/** Resolve roots to files: a directory is walked, a file is taken by name. */
function population(roots: readonly string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(root);
  }
  return [...new Set(out)].sort();
}

/** Source text as the census reads it: TS comment-stripped, HTML raw. */
function readScanned(rel: string): string {
  const raw = readFileSync(resolve(REPO_ROOT, rel), "utf8");
  return /\.tsx?$/.test(rel) ? stripCommentsPreserveLines(raw) : raw;
}

/** 1-based line, in `text`, of the character at `flatIndex` of its whitespace-collapsed form. */
function lineOf(text: string, flatIndex: number): number {
  let n = 0;
  let prevWs = false;
  for (let i = 0; i < text.length; i++) {
    const ws = /\s/.test(text[i]);
    if (!(ws && prevWs)) {
      if (n === flatIndex) return text.slice(0, i).split("\n").length;
      n++;
    }
    prevWs = ws;
  }
  return 1;
}

/**
 * Every `file:line` in `files` whose scanned text, whitespace-collapsed, contains
 * `pattern`. A string is a literal phrase; a RegExp is matched as given. The match runs
 * on the whole file, so a phrase wrapped across lines is found; the reported line is
 * where the match starts.
 */
function findHits(files: readonly string[], pattern: string | RegExp): string[] {
  const re =
    typeof pattern === "string"
      ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
      : new RegExp(pattern.source, pattern.flags.replace("g", "") + "g");
  const hits: string[] = [];
  for (const rel of files) {
    const text = readScanned(rel);
    const flat = text.replace(/\s+/g, " ");
    for (const m of flat.matchAll(re)) hits.push(`${rel}:${lineOf(text, m.index ?? 0)}`);
  }
  return hits;
}

const BANNED_FILES = population(SCAN_ROOTS);
const LINK_FILES = population(LINK_SCAN_ROOTS);

describe("public-truth source census (192)", () => {
  for (const phrase of BANNED) {
    it(`no public marketing source carries "${phrase}"`, () => {
      const hits = findHits(BANNED_FILES, phrase);
      expect(hits, `"${phrase}" is banned (TRUST-01); remove it at the surface`).toEqual([]);
    });
  }

  it("no public marketing source shows a raw id in place of a name", () => {
    const hits = [
      ...findHits(BANNED_FILES, RAW_ID_PATTERN),
      ...findHits(BANNED_FILES, RAW_ID_TEMPLATE_PATTERN),
      ...findHits(BANNED_FILES, RAW_ID_HELPER_PATTERN),
    ];
    expect(hits, "a visitor must see a name or codename, never a raw id").toEqual([]);
  });

  it("no app or component source links to a retired route (/demo, /api/demo) (ROUTE-03, D-11)", () => {
    const hits = findHits(LINK_FILES, RETIRED_ROUTE_LINK);
    expect(hits, "a link to a retired route is a dead end").toEqual([]);
  });

  it("neither retired directory exists (D-11)", () => {
    const back = RETIRED_DIRS.filter((d) => existsSync(join(REPO_ROOT, d)));
    expect(back, "the retired demo directories came back").toEqual([]);
  });

  it("anti-vacuity: the banned-phrase population is non-empty and holds every CENSUS_FILES entry", () => {
    expect(BANNED_FILES.length).toBeGreaterThan(0);
    const missing = CENSUS_FILES.filter((f) => !BANNED_FILES.includes(f));
    expect(missing, "the census walked past a surface it must cover").toEqual([]);
  });

  it("anti-vacuity: the link population holds every LINK_CENSUS_FILES entry", () => {
    expect(LINK_FILES.length).toBeGreaterThan(0);
    const missing = LINK_CENSUS_FILES.filter((f) => !LINK_FILES.includes(f));
    expect(missing, "the link scan walked past a surface it must cover").toEqual([]);
  });

  it("the matchers fire: each banned phrase, the raw id and the retired link are detected on a planted line", () => {
    // A matcher that cannot fire makes every case above pass for the wrong reason, so
    // plant files and run the REAL findHits (readScanned, comment stripper, collapse).
    const dir = mkdtempSync(join(tmpdir(), "census-selftest-"));
    try {
      const plant = (name: string, body: string): string => {
        const abs = join(dir, name);
        writeFileSync(abs, body);
        return abs;
      };
      for (const [i, phrase] of BANNED.entries()) {
        const code = plant(`p${i}.tsx`, `export const x = <p>${phrase}</p>;\n`);
        expect(findHits([code], phrase), `"${phrase}" planted in code`).toEqual([`${code}:1`]);
        const commented = plant(`c${i}.tsx`, `/* ${phrase} */\n// ${phrase}\nexport const y = 1;\n`);
        expect(findHits([commented], phrase), `"${phrase}" quoted in a comment`).toEqual([]);
      }
      // A phrase wrapped across two lines, as JSX and the packet HTML wrap prose.
      // A per-line matcher misses it (SFH-1); the hit names the line it starts on.
      const wrappedTsx = plant("w.tsx", "export const z = (\n  <p>\n    Retail discovery\n    never sees a name\n  </p>\n);\n");
      expect(findHits([wrappedTsx], "Retail discovery never sees")).toEqual([`${wrappedTsx}:3`]);
      const wrappedHtml = plant("w.html", "<p>We use\n   AES-256-GCM envelope</p>\n<p>Binance, OKX,\n or Bybit</p>\n");
      expect(findHits([wrappedHtml], "Binance, OKX, or Bybit")).toEqual([`${wrappedHtml}:3`]);
      const rawIdTemplate = plant("r.tsx", "export const l = `Strategy #${id.slice(0, 8)}`;\n");
      expect(findHits([rawIdTemplate], RAW_ID_TEMPLATE_PATTERN)).toEqual([`${rawIdTemplate}:1`]);
      const rawIdJsx = plant("j.tsx", "export const l = <span>Strategy #{id.slice(0, 8)}</span>;\n");
      expect(findHits([rawIdJsx], RAW_ID_TEMPLATE_PATTERN)).toEqual([`${rawIdJsx}:1`]);
      const rawIdHelper = plant(
        "h.tsx",
        'import { displayStrategyName } from "@/lib/strategy-display";\nexport const l = displayStrategyName(s);\n',
      );
      expect(findHits([rawIdHelper], RAW_ID_HELPER_PATTERN)).toEqual([`${rawIdHelper}:1`, `${rawIdHelper}:2`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(RAW_ID_TEMPLATE_PATTERN.test("`Strategy #${id.slice(0, 8)}`")).toBe(true);
    expect(RAW_ID_TEMPLATE_PATTERN.test("Exploratory #${id}")).toBe(true);
    expect(RAW_ID_TEMPLATE_PATTERN.test("Strategy #{id.slice(0, 8)}")).toBe(true);
    expect(RAW_ID_TEMPLATE_PATTERN.test("Strategy #{ id }")).toBe(true);
    expect(RAW_ID_HELPER_PATTERN.test("displayStrategyName(s)")).toBe(true);
    expect(RAW_ID_HELPER_PATTERN.test("displayStrategyNames")).toBe(false);
    expect(RAW_ID_TEMPLATE_PATTERN.test("Strategy #1a2b3c4d")).toBe(false);
    expect(RAW_ID_PATTERN.test("Strategy #1a2b3c4d")).toBe(true);
    expect(RAW_ID_PATTERN.test("Exploratory #00ff00ff")).toBe(true);
    expect(RAW_ID_PATTERN.test("Strategy #xyz")).toBe(false);
    for (const planted of [
      'href="/demo"',
      "href='/demo?persona=a'",
      "href={`/demo/founder-view`}",
      'fetch("/api/demo/x")',
      'href="/demo#top"',
    ]) {
      expect(RETIRED_ROUTE_LINK.test(planted), planted).toBe(true);
    }
    for (const innocent of ['href="/demonstrations"', 'href="/security"', 'x="/api/demos"']) {
      expect(RETIRED_ROUTE_LINK.test(innocent), innocent).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// RENDERED HALF
// ---------------------------------------------------------------------------

// Typed as literals here, never imported (oracle independence).
const S_KEY =
  "We store your read-only API key encrypted, under a data key of its own, and only our analytics service can decrypt it.";
const S_COST =
  "Listing a strategy is free. A success fee may apply to matched allocations, as set out in the manager agreement.";
const KEY_LINK_HREF = "/security#key-handling";

const pageText = (): string => (document.body.textContent ?? "").replace(/\s+/g, " ");
const hrefs = (): string[] =>
  Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
/** An href equal to or under a retired route. */
const isRetiredHref = (href: string): boolean => /^\/(?:api\/)?demo(?:[/?#]|$)/.test(href);

const PAGES: ReadonlyArray<{ name: string; draw: () => Promise<void> }> = [
  { name: "home", draw: async () => void render(await Home()) },
  { name: "/security", draw: async () => void render(<SecurityPage />) },
  { name: "/for-quants", draw: async () => void render(<ForQuantsPage />) },
  { name: "Terms", draw: async () => void render(<TermsOfServicePage />) },
];

describe("public-truth rendered census (192)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  for (const { name, draw } of PAGES) {
    // The raw-id check here sees literal ids only: the mocks return no strategy rows, so a
    // label built from row data cannot draw. Source-built labels are the source half's job.
    it(`${name}: no banned phrase and no literal raw id in rendered text (source-built labels are covered by the source half), no link to a retired route`, async () => {
      await draw();
      const text = pageText();
      expect(text.length, `${name} rendered nothing`).toBeGreaterThan(200);
      const found = BANNED.filter((p) => text.includes(p));
      expect(found, `${name} renders a banned phrase`).toEqual([]);
      expect(RAW_ID_PATTERN.test(text), `${name} renders a raw id`).toBe(false);
      expect(hrefs().filter(isRetiredHref), `${name} links to a retired route`).toEqual([]);
    });
  }

  it("home renders no input, textarea or form (D-07)", async () => {
    await Home().then((el) => render(el));
    expect(document.querySelectorAll("input, textarea, form").length).toBe(0);
  });

  for (const { name, draw } of PAGES.filter((p) => p.name !== "/security")) {
    it(`${name}: says how keys are stored and links to /security#key-handling (D-02)`, async () => {
      await draw();
      expect(pageText(), `${name} lacks the key-storage sentence`).toContain(S_KEY);
      expect(hrefs(), `${name} lacks the key-handling link`).toContain(KEY_LINK_HREF);
    });
  }

  it("/security carries the key-handling anchor the others link to (D-02)", async () => {
    render(<SecurityPage />);
    expect(document.getElementById("key-handling")).not.toBeNull();
  });

  for (const { name, draw } of PAGES.filter((p) => p.name === "/for-quants" || p.name === "Terms")) {
    it(`${name}: says what listing costs (D-05)`, async () => {
      await draw();
      expect(pageText(), `${name} lacks the listing-cost sentence`).toContain(S_COST);
    });
  }
});
