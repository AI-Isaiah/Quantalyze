/**
 * M-0943 (audit-2026-05-07 / reverify-2026-05-25) — security packet date-drift
 * guard.
 *
 * `scripts/build-security-packet.html` is the source the PDF regeneration
 * script (`scripts/build-security-packet.mjs`) renders into the committed
 * `public/security-packet.pdf` — the allocator-diligence artifact linked from
 * the /security CTA. The runbook's step 2 is "bump the Last reviewed date in
 * BOTH the HTML source and src/app/security/page.tsx so the downloadable
 * packet and the live page never disagree". That coupling is enforced
 * by-process today (a human remembering to edit both); nothing fails CI when
 * they drift.
 *
 * This is a pure file-read drift detector: extract the "Last reviewed" ISO
 * date from both files and assert they are identical. It does NOT regenerate
 * the PDF (that needs Chrome/puppeteer and is acceptable to skip per the
 * finding) — it only catches the date-drift class the runbook warns about.
 *
 * If a contributor bumps the page date but forgets the packet HTML (or vice
 * versa), this fails LOUD with both dates in the message.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EXCHANGES } from "@/lib/closed-sets";

const HTML_PATH = resolve(
  process.cwd(),
  "scripts",
  "build-security-packet.html",
);
// Phase 51 (NAV-04): /security moved into the (marketing) route group
// (folder-only — the URL stays /security). The page source path picks up the
// (marketing) segment; the route itself is unchanged.
const PAGE_PATH = resolve(
  process.cwd(),
  "src",
  "app",
  "(marketing)",
  "security",
  "page.tsx",
);

/**
 * Extract the first ISO `YYYY-MM-DD` date that follows a "Last reviewed"
 * marker (case-insensitive). Both files phrase it slightly differently:
 *   - HTML: `Last reviewed <span class="mono">2026-04-12</span>`
 *   - page: `Last reviewed: 2026-04-12.`
 * so we anchor on the marker and grab the next ISO date in the same vicinity.
 * Throws if the marker or a date is absent — guards against a vacuous pass if
 * the surrounding markup is refactored such that the date disappears.
 */
function extractLastReviewedDate(source: string, label: string): string {
  const markerIdx = source.search(/Last reviewed/i);
  if (markerIdx === -1) {
    throw new Error(
      `${label}: "Last reviewed" marker not found (markup refactored?)`,
    );
  }
  // Look at the slice starting at the marker (cap the window so a later,
  // unrelated date elsewhere in the file can't be mistaken for this one).
  const window = source.slice(markerIdx, markerIdx + 120);
  const dateMatch = window.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) {
    throw new Error(
      `${label}: no ISO date found within the "Last reviewed" marker`,
    );
  }
  return dateMatch[1];
}

describe("security packet ↔ /security page date parity (M-0943)", () => {
  it("the 'Last reviewed' date in build-security-packet.html matches src/app/(marketing)/security/page.tsx", () => {
    const htmlDate = extractLastReviewedDate(
      readFileSync(HTML_PATH, "utf8"),
      "build-security-packet.html",
    );
    const pageDate = extractLastReviewedDate(
      readFileSync(PAGE_PATH, "utf8"),
      "src/app/(marketing)/security/page.tsx",
    );

    // Sanity: both are well-formed ISO dates (the extractor already enforces
    // shape, but pin it so a future loosening of the regex stays honest).
    expect(htmlDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pageDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The contract: regenerating the PDF must keep its review date in lockstep
    // with the live page. A drift here means the downloadable allocator-
    // diligence packet and the page that links it disagree.
    expect(
      htmlDate,
      `security-packet HTML last-reviewed (${htmlDate}) drifted from ` +
        `/security page last-reviewed (${pageDate}) — bump BOTH per the ` +
        `build-security-packet runbook step 2`,
    ).toBe(pageDate);
  });
});

/**
 * Phase 192 — PUBLICTRUTH (plan 04, D-01, D-03, D-06).
 *
 * The downloadable packet is forwarded to allocator risk teams, so a packet
 * that contradicts /security breaks the one-true-story requirement as surely
 * as a page would. These are pure file reads on the two sources; the PDF itself
 * is rebuilt from the HTML by `node scripts/build-security-packet.mjs`.
 */
describe("packet facts match /security (192)", () => {
  const html = readFileSync(HTML_PATH, "utf8");
  const page = readFileSync(PAGE_PATH, "utf8");

  it("both state the cipher the code uses (Fernet) and neither names an unsupported one", () => {
    const cipher = "Fernet (AES-128-CBC + HMAC-SHA256)";
    expect(html).toContain(cipher);
    expect(page).toContain(cipher);
    expect(html).not.toMatch(/AES-256/);
    expect(html).not.toMatch(/Vault/);
  });

  it("the packet's In transit row states the TLS versions /security states (D-03)", () => {
    // /security: "TLS 1.3 or TLS 1.2. The edge refuses TLS 1.0 and 1.1."
    expect(page).toContain("TLS 1.3 or TLS 1.2");
    const row = html.match(/<dt>In transit<\/dt>\s*<dd>([^<]*)<\/dd>/);
    if (!row) {
      throw new Error(
        'build-security-packet.html: "<dt>In transit</dt>" row not found (markup refactored?)',
      );
    }
    expect(row[1]).toContain("TLS 1.3");
    expect(row[1]).toContain("TLS 1.2");
    expect(row[1]).toContain("TLS 1.0 and 1.1 refused");
  });

  it("the packet's Supported exchanges list is EXCHANGES, not a frozen three-venue list (D-06)", () => {
    const row = html.match(
      /<dt>Supported exchanges<\/dt>\s*<dd>([\s\S]*?)<\/dd>/,
    );
    if (!row) {
      throw new Error(
        'build-security-packet.html: "<dt>Supported exchanges</dt>" row not found (markup refactored?)',
      );
    }
    const listed = row[1].replace(/\s+/g, " ").trim();
    const expected = new Intl.ListFormat("en", {
      style: "long",
      type: "disjunction",
    }).format(EXCHANGES);
    expect(listed).toContain(expected);
  });

  it("the packet's Deletion row agrees with /security: a key delete leaves the strategy and its listing (CR-01)", () => {
    // strategies.api_key_id is ON DELETE SET NULL; a published strategy can only be archived.
    const row = html.match(/<dt>Deletion<\/dt>\s*<dd>([\s\S]*?)<\/dd>/);
    if (!row) {
      throw new Error(
        'build-security-packet.html: "<dt>Deletion</dt>" row not found (markup refactored?)',
      );
    }
    const cell = row[1].replace(/\s+/g, " ").trim();
    expect(cell).not.toMatch(/single transaction/i);
    expect(cell).not.toMatch(/listing removal/i);
    expect(cell).toContain("Deleting a key removes its encrypted credential row");
    expect(cell).toContain("The strategy, its fills and its listing stay");
    // The database refuses to delete a key a published composite uses.
    expect(cell).toContain(
      "A key used by a published composite cannot be deleted: use the contact form to change that composite's keys",
    );
    // The same claim, in the same words, on the page the packet is linked from.
    expect(page.replace(/\s+/g, " ")).toContain(
      "The strategy, its fills and its listing stay",
    );
    expect(page.replace(/\s+/g, " ")).toContain(
      "A key used by a published composite cannot be deleted",
    );
  });

  it("the packet states no retention window the code does not enforce (192-EVIDENCE 'Retention at HEAD')", () => {
    // Nothing deletes strategy fills or aggregates on a schedule, so a
    // "30 days; hard-deleted by daily job" row is a claim with no code behind it.
    expect(html).not.toMatch(/30 days/);
    expect(html).not.toMatch(/hard-deleted/i);
    expect(html).not.toMatch(/indefinitely/i);
    expect(html).toMatch(/<dt>Raw fills retention<\/dt>\s*<dd>\s*No scheduled deletion/);
    expect(html).toMatch(/<dt>Aggregate analytics<\/dt>\s*<dd>\s*No scheduled deletion/);
  });
});
