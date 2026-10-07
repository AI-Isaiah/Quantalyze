/**
 * Phase 164.6.6.3.5 DOMAINONE (D-03) — RFC 9116 shape of `public/.well-known/security.txt`.
 *
 * A researcher or scanner reads this file to find where to report a
 * vulnerability. D-03 points that channel at the contact page on the one
 * canonical host instead of a mailbox on the retiring third-party domain, so a
 * report lands in the founder CRM rather than in a mailbox nobody reads.
 *
 * Pure file-read test (no render, no network). It fails when:
 *   - Contact stops pointing at the contact page on the canonical host
 *   - Expires is missing, duplicated, unparseable, already past, or so far out
 *     that it is no longer a periodic review (RFC 9116 section 2.5.5 says
 *     SHOULD be less than a year)
 *   - Canonical / Policy / Acknowledgments leave the canonical host
 *   - a mail-scheme line reappears anywhere in the file
 *
 * The Expires window is a live-clock check on purpose: when the date passes,
 * this goes red and says the file must be re-issued, which is exactly what an
 * expired security.txt needs (RFC 9116 treats an expired file as stale).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HOST = "https://quantalyze.xyz";
const FILE = resolve(process.cwd(), "public", ".well-known", "security.txt");
const text = readFileSync(FILE, "utf8");
const lines = text.split(/\r?\n/);

/** Every line `Field: value` for one field name (case-insensitive). */
function field(name: string): string[] {
  const prefix = `${name.toLowerCase()}:`;
  return lines
    .filter((l) => l.toLowerCase().startsWith(prefix))
    .map((l) => l.slice(prefix.length).trim());
}

describe("public/.well-known/security.txt (RFC 9116, D-03)", () => {
  it("Contact points at the contact page on the canonical host, topic security", () => {
    const contacts = field("Contact");
    expect(contacts.length).toBeGreaterThanOrEqual(1);
    for (const c of contacts) {
      expect(c.startsWith(`${HOST}/contact`)).toBe(true);
    }
    expect(contacts).toContain(`${HOST}/contact?topic=security`);
  });

  it("has exactly one Expires, parseable, in the future and under a year out", () => {
    const expires = field("Expires");
    expect(expires).toHaveLength(1);
    const at = Date.parse(expires[0]);
    expect(Number.isNaN(at)).toBe(false);
    const now = Date.now();
    // Expired: re-issue the file (bump Expires after re-reading the policy).
    expect(at).toBeGreaterThan(now);
    expect(at).toBeLessThan(now + 365 * 24 * 60 * 60 * 1000);
  });

  it.each(["Canonical", "Policy", "Acknowledgments"])(
    "%s is a URL on the canonical host",
    (name) => {
      const values = field(name);
      expect(values.length).toBeGreaterThanOrEqual(1);
      for (const v of values) {
        expect(v.startsWith(HOST)).toBe(true);
      }
    },
  );

  it("names no mail-scheme address anywhere, comments included", () => {
    expect(text.toLowerCase()).not.toContain("mailto:");
    expect(text).not.toMatch(/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });
});
