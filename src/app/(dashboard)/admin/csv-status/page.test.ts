/**
 * Phase 15 BUG P2 — /admin/csv-status "View factsheet" link.
 *
 * The CSV-status admin page is an async server component (Supabase admin
 * client) that cannot mount in jsdom, so the link contract is guarded at
 * the source-shape level — same precedent as src/app/strategy/[id]/page.test.tsx.
 *
 * Pre-fix the link was `/strategies/${strat.id}` — PLURAL, a route that does
 * not exist (only /strategies/[id]/edit) — so EVERY "View factsheet" click
 * 404'd. The fix links published rows to the singular public factsheet
 * `/strategy/${id}` and shows a muted state otherwise (the factsheet is
 * status='published'-gated; there is no admin view for an unpublished
 * strategy, so a link on a non-published row would also 404).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.join(process.cwd(), "src/app/(dashboard)/admin/csv-status/page.tsx"),
  "utf8",
);

describe("/admin/csv-status — View factsheet link (Phase 15 BUG P2)", () => {
  it("links to the singular public factsheet route, not the non-existent plural one", () => {
    expect(SRC).toContain("href={`/strategy/${strat.id}`}");
    // The plural /strategies/[id] route has no page.tsx (only /edit) — guard
    // against the exact regression that shipped.
    expect(SRC).not.toContain("href={`/strategies/${strat.id}`}");
  });

  it("gates the factsheet link on the strategy being published", () => {
    // Mirrors getPublicStrategyDetail's status='published' visibility gate so
    // the link only renders when /strategy/[id] will actually resolve.
    expect(SRC).toContain('strat.status === "published"');
  });

  it("selects strategies.status so the publish gate has data to read", () => {
    // The gate is meaningless unless `status` is part of the !inner select.
    expect(SRC).toMatch(/strategies!inner\s*\([^)]*\bstatus\b/);
  });

  it("renders a muted non-link state for non-published rows (no broken link)", () => {
    // A non-published row must NOT get a factsheet link (it would 404). It
    // shows "Not published" when a strategy id exists, or "—" when it doesn't.
    // Pins both fallback sub-branches of the ternary.
    expect(SRC).toContain('strat?.id ? "Not published" : "—"');
  });
});
