/**
 * Phase 199 plan 14 (D-03, SC-3, R-05) - the strategies legend.
 *
 * One legend explains every Health word the list can print. The definitions are
 * CLAIMS about the product, so the two stale thresholds are pinned here as
 * literals, independent of the constants the legend reads: moving a threshold
 * must redden this file and force the legend's sentence to be re-read, instead
 * of the legend silently following the constant.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import React from "react";
import {
  SERIES_STALE_DAYS,
  SERIES_STALE_DAYS_TRADITIONAL,
  listSeriesVerdict,
} from "@/lib/freshness";
import { HEALTH_TONE, STRATEGY_HEALTH_KINDS } from "@/lib/strategy-health";
import { STRATEGY_STATUSES, STRATEGY_STATUSES_COMPLETE } from "@/lib/closed-sets";
import { statusLabelMap } from "@/components/ui/Badge";
import { LABELS as OWNERSHIP_LABELS } from "@/components/strategy/OwnershipTag";
import { DATA_STATE_CHIP, PIPELINE_CHIPS } from "@/components/strategy/StaleSeriesChip";
import { StrategiesLegend, HEALTH_LEGEND } from "./StrategiesLegend";

afterEach(cleanup);

/** The `dt`/`dd` pairs of one legend group, keyed by its eyebrow. */
function groupEntries(
  container: HTMLElement,
  group: string,
): Array<{ term: string; definition: string; dt: HTMLElement }> {
  const eyebrow = Array.from(
    container.querySelectorAll<HTMLElement>("[data-legend-group]"),
  ).find((g) => g.getAttribute("data-legend-group") === group);
  expect(eyebrow, `the ${group} group`).toBeTruthy();
  const dl = (eyebrow as HTMLElement).querySelector("dl") as HTMLElement;
  return Array.from(dl.querySelectorAll<HTMLElement>("dt")).map((dt) => ({
    term: (dt.textContent ?? "").trim(),
    definition: (dt.nextElementSibling?.textContent ?? "").trim(),
    dt,
  }));
}

describe("the legend shell (199-14, UI-SPEC Legend)", () => {
  it("is a section labelled by an h2 reading Legend, square, always visible, not a details", () => {
    const { container } = render(<StrategiesLegend />);
    const section = container.querySelector("section#strategies-legend") as HTMLElement;
    expect(section).toBeTruthy();
    expect(section.getAttribute("aria-labelledby")).toBe("strategies-legend-heading");
    const h2 = section.querySelector("h2#strategies-legend-heading") as HTMLElement;
    expect(h2.textContent).toBe("Legend");
    // Square data panel: no radius, no shadow (DESIGN.md), `mt-6` under the table.
    expect(section.className).toContain("border border-border bg-surface px-4 py-4");
    expect(section.className).toContain("mt-6");
    expect(section.className).not.toMatch(/rounded|shadow/);
    // Static and printed: never a disclosure.
    expect(container.querySelector("details")).toBeNull();
  });

  it("never announces: no live region and no status role anywhere in it", () => {
    const { container } = render(<StrategiesLegend />);
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
  });

  it("the @container host is an ANCESTOR of the grid, which steps 1 / 2 / 4 columns on its own width", () => {
    const { container } = render(<StrategiesLegend />);
    const grid = container.querySelector("[data-legend-grid]") as HTMLElement;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("@lg:grid-cols-2");
    expect(grid.className).toContain("@4xl:grid-cols-4");
    // Container queries answer to an ancestor, never to the element itself.
    expect(grid.className).not.toContain("@container");
    expect(grid.closest(".\\@container")).toBeTruthy();
  });
});

describe("the HEALTH group (199-14 task 1, D-03, R-05)", () => {
  const HEALTH_TERMS = [
    "Healthy",
    "Updating",
    "Stale (no data since …)",
    "Analytics failed",
    "Key problem",
    "—",
  ];

  it("lists the six Health words in UI-SPEC order", () => {
    const { container } = render(<StrategiesLegend />);
    expect(groupEntries(container, "Health").map((e) => e.term)).toEqual(HEALTH_TERMS);
  });

  it("every Health kind the cell can render has a legend entry (stale_no_data shares the Stale entry)", () => {
    const covered = new Set(HEALTH_LEGEND.flatMap((e) => e.kinds));
    for (const kind of STRATEGY_HEALTH_KINDS) {
      expect(covered.has(kind), `no legend entry for the "${kind}" Health kind`).toBe(true);
    }
  });

  it("each term carries the tone the cell prints it in", () => {
    const { container } = render(<StrategiesLegend />);
    const entries = groupEntries(container, "Health");
    const toneByTerm: Record<string, string> = {
      Healthy: HEALTH_TONE.healthy,
      Updating: HEALTH_TONE.updating,
      "Stale (no data since …)": HEALTH_TONE.stale,
      "Analytics failed": HEALTH_TONE.analytics_failed,
      "Key problem": HEALTH_TONE.key_problem,
      "—": HEALTH_TONE.not_judged,
    };
    for (const e of entries) {
      expect((e.dt.firstElementChild as HTMLElement).className, e.term).toContain(toneByTerm[e.term]);
    }
  });

  it("carries the UI-SPEC definitions verbatim", () => {
    const { container } = render(<StrategiesLegend />);
    const defs = Object.fromEntries(
      groupEntries(container, "Health").map((e) => [e.term, e.definition]),
    );
    expect(defs["Updating"]).toBe(
      "A computation is queued or running. Any figures shown are from the last completed computation.",
    );
    expect(defs["Analytics failed"]).toBe(
      "The last computation did not produce figures. The note under the row says what to do.",
    );
    expect(defs["Key problem"]).toBe(
      "An exchange key feeding this strategy is revoked or can no longer sign in. The note under the row names the key.",
    );
    expect(defs["—"]).toBe(
      "Not judged: the strategy is archived, the row has no strategy yet, the newest date cannot be trusted, or key status could not be checked.",
    );
  });

  it("R-05: Healthy says at most and Stale says older than, each naming BOTH thresholds (pinned literals)", () => {
    const { container } = render(<StrategiesLegend />);
    const defs = Object.fromEntries(
      groupEntries(container, "Health").map((e) => [e.term, e.definition]),
    );
    expect(defs["Healthy"]).toBe(
      "Analytics are computed and the newest data point is at most 7 days old for a crypto strategy, or 10 days for any other.",
    );
    expect(defs["Stale (no data since …)"]).toBe(
      'The newest data point is older than 7 days for a crypto strategy, or 10 days for any other. The date is the last day with data. "No data yet" means nothing has been computed and nothing is running.',
    );
  });

  it("R-05: the thresholds in the sentences are the constants the Health word reads, not typed numbers", () => {
    const { container } = render(<StrategiesLegend />);
    const defs = Object.fromEntries(
      groupEntries(container, "Health").map((e) => [e.term, e.definition]),
    );
    expect(defs["Healthy"]).toContain(
      `at most ${SERIES_STALE_DAYS} days old for a crypto strategy, or ${SERIES_STALE_DAYS_TRADITIONAL} days for any other`,
    );
    expect(defs["Stale (no data since …)"]).toContain(
      `older than ${SERIES_STALE_DAYS} days for a crypto strategy, or ${SERIES_STALE_DAYS_TRADITIONAL} days for any other`,
    );
  });

  it("R-05: the ladder itself is pinned, so a moved constant is a conscious change to this file and a re-read of the sentences", () => {
    expect(SERIES_STALE_DAYS).toBe(7);
    expect(SERIES_STALE_DAYS_TRADITIONAL).toBe(10);
  });

  it("R-05: the words match listSeriesVerdict's operator: current AT the threshold, stale one day past it, per class", () => {
    const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
    const dayBefore = (days: number) =>
      new Date(NOW - days * 86_400_000).toISOString().slice(0, 10);
    // Crypto: 7 days. Any other class, null included: 10 days.
    for (const [assetClass, threshold] of [
      ["crypto", 7],
      ["traditional", 10],
      [null, 10],
    ] as const) {
      expect(
        listSeriesVerdict(dayBefore(threshold), assetClass, NOW).verdict,
        `${assetClass}: ${threshold} days old reads current ("at most")`,
      ).toBe("current");
      expect(
        listSeriesVerdict(dayBefore(threshold + 1), assetClass, NOW).verdict,
        `${assetClass}: ${threshold + 1} days old reads stale ("older than")`,
      ).toBe("stale");
    }
  });

  it("an entry's definition sits in the dd beside its term (dl semantics)", () => {
    const { container } = render(<StrategiesLegend />);
    const dl = container.querySelector('[data-legend-group="Health"] dl') as HTMLElement;
    expect(within(dl).getAllByText("Healthy").length).toBe(1);
    expect(dl.querySelectorAll("dt").length).toBe(dl.querySelectorAll("dd").length);
  });
});

describe("the STATUS group (199-14 task 2)", () => {
  it("is one entry per STRATEGY_STATUSES member, in UI-SPEC order, each term the Badge's own label", () => {
    const { container } = render(<StrategiesLegend />);
    const terms = groupEntries(container, "Status").map((e) => e.term);
    expect(terms).toEqual(["Published", "Pending review", "Draft", "Private", "Archived"]);
    expect(terms).toEqual(STRATEGY_STATUSES.map((s) => statusLabelMap[s]));
  });

  it("STRATEGY_STATUSES lists every strategy status statusLabelMap names (contact-request keys excluded), and the union is covered", () => {
    expect(STRATEGY_STATUSES_COMPLETE).toBe(true);
    const contactRequestKeys = ["pending", "intro_made", "completed", "declined"];
    const strategyKeys = Object.keys(statusLabelMap).filter((k) => !contactRequestKeys.includes(k));
    expect([...strategyKeys].sort()).toEqual([...STRATEGY_STATUSES].sort());
  });

  it("definitions: Published, Pending review and Private are UI-SPEC verbatim; Draft and Archived are the code-checked corrections", () => {
    const { container } = render(<StrategiesLegend />);
    const defs = Object.fromEntries(
      groupEntries(container, "Status").map((e) => [e.term, e.definition]),
    );
    expect(defs["Published"]).toBe(
      "Listed in Discovery and ranked against other published strategies.",
    );
    expect(defs["Pending review"]).toBe(
      "Submitted and waiting for our review before it can be published.",
    );
    expect(defs["Private"]).toBe(
      "Visible only to you and anyone you send a private link. Not ranked publicly.",
    );
    // Every unpublished row can mint a private link (shareAffordanceMode), so a
    // draft is not "visible only to you"; and an archived row is gone from
    // Discovery but is not guaranteed to be shown on this page alone.
    expect(defs["Draft"]).toBe(
      "Not submitted yet. Visible only to you, and to anyone you send a private link.",
    );
    expect(defs["Archived"]).toBe("Withdrawn from Discovery. It stays listed on this page.");
  });
});

describe("the TAGS group (199-14 task 2)", () => {
  it("ownership terms are OwnershipTag's own labels, then the verified check and the compact BTC chip", () => {
    const { container } = render(<StrategiesLegend />);
    const entries = groupEntries(container, "Tags");
    expect(entries.map((e) => e.term).slice(0, 2)).toEqual(Object.values(OWNERSHIP_LABELS));
    expect(entries.map((e) => e.term).slice(0, 2)).toEqual(["Own capital", "Team review"]);
    expect(entries.length).toBe(4);
    expect(entries[2].dt.querySelector('[title="Verified via exchange API"]')).toBeTruthy();
    expect(entries[2].definition).toBe(
      "Verified via exchange API: the data comes from a read-only exchange key.",
    );
    expect(entries[3].dt.querySelector("[data-returns-unit]")?.getAttribute("data-returns-unit")).toBe("BTC");
    expect(entries[3].definition).toBe("Returns are measured in BTC, not USD.");
    expect(entries[0].definition).toBe(
      "You marked this strategy as your own capital. Only these strategies can take an allocation.",
    );
    expect(entries[1].definition).toBe(
      "You marked this strategy as a trading team's key you are reviewing, not your own capital.",
    );
  });
});

describe("the PIPELINE group (199-14 task 2)", () => {
  it("renders the chips the table renders: the shared base class and the shared label and tone", () => {
    const { container } = render(<StrategiesLegend />);
    const entries = groupEntries(container, "Pipeline");
    expect(entries.map((e) => e.term)).toEqual(["Syncing", "No data", "No strategy yet"]);
    expect(entries.map((e) => e.term)).toEqual(Object.values(PIPELINE_CHIPS).map((c) => c.label));
    for (const [i, key] of (["syncing", "no_data", "no_strategy_yet"] as const).entries()) {
      const chip = entries[i].dt.firstElementChild as HTMLElement;
      expect(chip.className).toBe(`${DATA_STATE_CHIP} ${PIPELINE_CHIPS[key].tone}`);
    }
    expect(entries.map((e) => e.definition)).toEqual([
      "First metrics arrive about 10–15 minutes after a key connects.",
      "No figures yet, and no computation is running.",
      "A connected key with no strategy. Finish setup creates one.",
    ]);
  });
});

describe("the KEY PILLS group (199-14 task 2)", () => {
  it("renders the real pill for each untrusted status, with no helper line and so no announcement", () => {
    const { container } = render(<StrategiesLegend />);
    const entries = groupEntries(container, "Key pills");
    expect(entries.map((e) => e.term)).toEqual(["Key revoked", "Sign-in failed"]);
    expect(entries.map((e) => e.definition)).toEqual([
      "The exchange revoked this key. Re-add a read-only key from your exchange.",
      "This account's credentials no longer work. Update them; they may have changed.",
    ]);
    const pills = Array.from(container.querySelectorAll("[data-sync-status]"));
    expect(pills.map((p) => p.getAttribute("data-sync-status"))).toEqual(["revoked", "sign_in_failed"]);
    // The row's own pill id stays the row's: a page asking for it finds only rows.
    expect(container.querySelector('[data-testid="allocator-sync-pill"]')).toBeNull();
    expect(container.querySelector('[data-testid="allocator-sync-helper"]')).toBeNull();
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
  });
});

describe("the legend lists the five groups in UI-SPEC order", () => {
  it("HEALTH, STATUS, TAGS, PIPELINE, KEY PILLS", () => {
    const { container } = render(<StrategiesLegend />);
    expect(
      Array.from(container.querySelectorAll("[data-legend-group]")).map((g) =>
        g.getAttribute("data-legend-group"),
      ),
    ).toEqual(["Health", "Status", "Tags", "Pipeline", "Key pills"]);
  });
});
