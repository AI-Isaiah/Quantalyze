/**
 * TABLE-01 / T-53-11 — MatchQueueIndex @container parent/child STRUCTURAL guard.
 *
 * The match-queue allocator list migrated its raw `<table>` onto a
 * `ResponsiveTable className="@container"` host with `@max-*` priority-collapse
 * on the two lowest-priority columns (Last intro, Recomputed). A class-string
 * jsdom check FALSE-PASSES the #551 same-element regression, so this guard
 * asserts the RELATIONSHIP structurally: the `@container` host must be a STRICT
 * ANCESTOR of every `@-`variant cell (never the same node), and numeric columns
 * keep `tabular-nums`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";

import { MatchQueueIndex } from "./MatchQueueIndex";

function allocatorRow(id: string) {
  return {
    id,
    display_name: `Allocator ${id}`,
    company: "Acme Capital",
    email: `${id}@example.com`,
    role: "allocator",
    mandate_archetype: "Long-vol crisis-alpha multi-strat overlay",
    has_founder_notes: false,
    latest_batch: {
      id: `batch-${id}`,
      computed_at: new Date().toISOString(),
      mode: "personalized" as const,
      candidate_count: 7,
      filter_relaxed: false,
    },
    hours_since_recompute: 5,
    days_since_last_intro: 3,
    needs_attention: true,
    is_stale: false,
    zero_decisions: false,
    triage_score: 42,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("kill-switch")) {
        return { ok: true, status: 200, json: async () => ({ enabled: true }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ allocators: [allocatorRow("a1"), allocatorRow("a2")] }),
      };
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("MatchQueueIndex — @container parent/child structural guard", () => {
  it("the @container host is a STRICT ANCESTOR of the @-variant cells (never same element)", async () => {
    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(<MatchQueueIndex />));
    });

    const hosts = Array.from(
      container!.querySelectorAll<HTMLElement>('[class*="@container"]'),
    );
    expect(hosts.length).toBe(1);
    const host = hosts[0];

    // Same-element host is the #551 bug — the host must carry NO @-variant.
    expect(host.className).not.toMatch(/@(max|min|2xl|3xl)/);

    const variants = Array.from(
      container!.querySelectorAll<HTMLElement>(
        '[class*="@max-"], [class*="@min-"], [class*="@2xl:"], [class*="@3xl:"]',
      ),
    );
    expect(variants.length).toBeGreaterThan(0);
    for (const el of variants) {
      expect(host.contains(el)).toBe(true);
      expect(host).not.toBe(el);
    }
  });

  it("preserves tabular-nums on numeric columns across the reshape", async () => {
    let container: HTMLElement;
    await act(async () => {
      ({ container } = render(<MatchQueueIndex />));
    });
    const tabular = container!.querySelectorAll('[class*="tabular-nums"]');
    expect(tabular.length).toBeGreaterThan(0);
  });
});
