import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  MissingDataMessage,
  missingDataLines,
  namedExitKeyIds,
} from "./MissingDataMessage";
import type { KeyDataGap } from "../lib/key-data-gaps";
import type { EquityHistoryRebuildReason } from "@/lib/queries";
import * as rebuildClassModule from "./EquityHistoryRebuilding";
import { ACTION_SENTENCES, WHOLE_HISTORY_IDS } from "@/lib/degrade-warnings";

// ---------------------------------------------------------------------------
// Phase 198 plan 09 (D-01, ROUTE-07). The Overview's missing-data message names
// the key, the days and what to do, one line per affected key.
//
// Why these tests exist: D-01 replaced a generic "we are holding back your
// equity history" panel that named nothing. Three promises are easy to break
// and each is pinned here. (1) A dead key affects only itself: a line names its
// own keys and never says "your keys" or "your book" for one key's fault.
// (2) An unknown range is said ("no data since", "no complete history yet"),
// never guessed. (3) Every named key is labelled through the one key-label rule
// (`apiKeyLabelById`), and a key the owner's list does not carry names nothing.
//
// Fixtures are written by hand. Expected sentences are typed out literally, so
// a change to the component's copy fails here rather than being read back from
// it.
// ---------------------------------------------------------------------------

const K1 = { id: "k1-0001", exchange: "binance", label: "Main" };
// No nickname: labelled by its masked tail, `Binance — ••••4f2a`.
const K2 = { id: "k2-4f2a", exchange: "binance", label: "  " };
const K3 = { id: "k3-9c10", exchange: "okx", label: "Spare" };
const API_KEYS = [K1, K2, K3];

const L1 = "Binance — Main";
const L2 = "Binance — ••••4f2a";
const L3 = "OKX — Spare";

const RANGE = [{ from: "2026-10-03", to: "2026-10-11" }];
const RANGE_TEXT = "Oct 3, 2026 – Oct 11, 2026";

const gap = (
  cause: KeyDataGap["cause"],
  apiKeyIds: string[],
  over: Partial<KeyDataGap> = {},
): KeyDataGap => ({
  apiKeyIds,
  cause,
  firstMissingDay: null,
  ranges: null,
  ...over,
});

type Reason = EquityHistoryRebuildReason | null | undefined;

function lines(
  gaps: KeyDataGap[],
  over: {
    rebuilding?: boolean;
    reason?: Reason;
    notSyncingKeys?: typeof API_KEYS | null;
    apiKeys?: typeof API_KEYS;
  } = {},
) {
  return missingDataLines({
    gaps,
    apiKeys: over.apiKeys ?? API_KEYS,
    rebuilding: over.rebuilding ?? true,
    reason: over.reason ?? null,
    notSyncingKeys: over.notSyncingKeys ?? null,
  });
}

/** Renders the message and returns the text of every `<p>` line under the eyebrow. */
function linesText(
  gaps: KeyDataGap[],
  over: Parameters<typeof lines>[1] = {},
): string[] {
  const { container } = render(<MissingDataMessage lines={lines(gaps, over)} />);
  const section = container.querySelector("section");
  if (!section) return [];
  const ps = Array.from(section.querySelectorAll("p")).slice(1);
  return ps.map((p) => p.textContent ?? "");
}

afterEach(() => cleanup());

// 199-05 (D-05, CD-14 OQ-2): the D-10 sentence that carries the book-wide scope. Typed
// by hand, as every expected sentence here is.
const HISTORY_HIDDEN =
  "The equity chart and the ratios built from it are hidden for your whole history. ";

const EXCHANGES_ACTION = "Reconnect the key on the Exchanges page or wait for the next sync.";

describe("MissingDataMessage: one line per key, named, dated and actionable (D-01)", () => {
  it("nothing missing: no lines and the component renders nothing, whatever the reason or state", () => {
    for (const rebuilding of [false]) {
      for (const reason of [null, "awaiting_derivation", "key_not_syncing"] as Reason[]) {
        expect(lines([], { rebuilding, reason })).toEqual([]);
      }
    }
    const { container } = render(<MissingDataMessage lines={[]} />);
    expect(container.innerHTML).toBe("");
    expect(screen.queryByTestId("overview-missing-data")).toBeNull();
  });

  it.each([["not_syncing"], ["sync_failing"]] as const)(
    "%s: names the key, the range and the one action; Exchanges page is the profile link",
    (cause) => {
      const out = linesText(
        [gap(cause, [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE })],
        { reason: cause === "not_syncing" ? "key_not_syncing" : null },
      );
      expect(out).toEqual([`${L1}: no data for ${RANGE_TEXT}. ${EXCHANGES_ACTION}`]);
      expect(screen.getByRole("link", { name: "Exchanges page" })).toHaveAttribute(
        "href",
        "/profile?tab=exchanges",
      );
      // The label is set at 600 weight in the primary text colour.
      const label = screen.getByText(L1);
      expect(label.tagName).toBe("SPAN");
      expect(label.className).toContain("font-semibold");
      expect(label.className).toContain("text-text-primary");
    },
  );

  it("read_incomplete: 'no complete data for', and the wait comes before the reconnect", () => {
    expect(
      linesText([gap("read_incomplete", [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE })], {
        rebuilding: false,
      }),
    ).toEqual([
      `${L1}: no complete data for ${RANGE_TEXT}. Wait for the next sync, or reconnect the key on the Exchanges page if this persists.`,
    ]);
  });

  it("a single day reads as one date, and two separate runs are joined by a semicolon", () => {
    expect(
      linesText([
        gap("sync_failing", [K1.id], {
          firstMissingDay: "2026-10-03",
          ranges: [{ from: "2026-10-03", to: "2026-10-03" }],
        }),
      ])[0],
    ).toBe(`${L1}: no data for Oct 3, 2026. ${EXCHANGES_ACTION}`);
    cleanup();
    expect(
      linesText([
        gap("sync_failing", [K1.id], {
          firstMissingDay: "2026-10-03",
          ranges: [
            { from: "2026-10-03", to: "2026-10-04" },
            { from: "2026-10-09", to: "2026-10-09" },
          ],
        }),
      ])[0],
    ).toBe(`${L1}: no data for Oct 3, 2026 – Oct 4, 2026; Oct 9, 2026. ${EXCHANGES_ACTION}`);
  });

  it("a range that crosses a month and a year edge is expanded day by day, not guessed", () => {
    expect(
      linesText([
        gap("sync_failing", [K1.id], {
          firstMissingDay: "2026-12-30",
          ranges: [{ from: "2026-12-30", to: "2027-01-02" }],
        }),
      ])[0],
    ).toBe(`${L1}: no data for Dec 30, 2026 – Jan 2, 2027. ${EXCHANGES_ACTION}`);
  });

  it("range unknown, first missing day known: 'no data since {day}.' then the action", () => {
    expect(
      linesText([gap("sync_failing", [K1.id], { firstMissingDay: "2026-10-03", ranges: null })])[0],
    ).toBe(`${L1}: no data since Oct 3, 2026. ${EXCHANGES_ACTION}`);
    cleanup();
    expect(
      linesText([gap("read_incomplete", [K1.id], { firstMissingDay: "2026-10-03", ranges: null })])[0],
    ).toBe(
      `${L1}: no data since Oct 3, 2026. Wait for the next sync, or reconnect the key on the Exchanges page if this persists.`,
    );
  });

  it("neither range nor day known: 'no complete history yet.' and never an invented date", () => {
    const out = linesText([gap("sync_failing", [K1.id], { firstMissingDay: null, ranges: null })])[0];
    expect(out).toBe(`${L1}: no complete history yet. ${EXCHANGES_ACTION}`);
    expect(out).not.toMatch(/\b(19|20)\d{2}\b/);
    cleanup();
    // An empty list of ranges is not a range either.
    expect(
      linesText([gap("not_syncing", [K1.id], { firstMissingDay: null, ranges: [] })], {
        reason: "key_not_syncing",
      })[0],
    ).toBe(`${L1}: no complete history yet. ${EXCHANGES_ACTION}`);
  });

  it("a malformed range prints no guessed date", () => {
    const out = linesText([
      gap("sync_failing", [K1.id], {
        firstMissingDay: null,
        ranges: [{ from: "not-a-day", to: "2026-10-11" }],
      }),
    ])[0];
    expect(out).toBe(`${L1}: no complete history yet. ${EXCHANGES_ACTION}`);
  });

  it("duplicate_account: both keys in one line, in the producer's order", () => {
    expect(
      linesText([gap("duplicate_account", [K1.id, K2.id])], { reason: "duplicate_account" }),
    ).toEqual([
      `${L1} and ${L2} read the same exchange account. Disconnect one of them on the Exchanges page and the history rebuilds.`,
    ]);
  });

  it("shared_account_failing: both keys, the range, and the fix", () => {
    expect(
      linesText(
        [gap("shared_account_failing", [K1.id, K2.id], { firstMissingDay: "2026-10-03", ranges: RANGE })],
        { reason: "shared_account_no_working_key" },
      ),
    ).toEqual([
      `${L1} and ${L2}: no data for ${RANGE_TEXT}. Fix or reconnect one of these keys on the Exchanges page.`,
    ]);
    cleanup();
    expect(
      linesText([gap("shared_account_failing", [K1.id, K2.id])], {
        reason: "shared_account_no_working_key",
      }),
    ).toEqual([
      `${L1} and ${L2}: no complete history yet. Fix or reconnect one of these keys on the Exchanges page.`,
    ]);
  });

  it("identity_pending: says what is being confirmed, with no range", () => {
    expect(
      linesText([gap("identity_pending", [K3.id])], { reason: "account_identity_pending" }),
    ).toEqual([`${L3}: we are confirming which exchange account this key reads. Each daily sync checks it again.`]);
  });
});

describe("MissingDataMessage: every gap line is rendered from a registry entry (199-05, D-04)", () => {
  it.each([
    ["not_syncing", "allocation.key-gap.not-syncing"],
    ["sync_failing", "allocation.key-gap.sync-failing"],
    ["read_incomplete", "allocation.key-gap.read-incomplete"],
    ["duplicate_account", "allocation.key-gap.duplicate-account"],
    ["shared_account_failing", "allocation.key-gap.shared-account-failing"],
    ["identity_pending", "allocation.key-gap.identity-pending"],
  ] as const)("%s carries data-degrade-id %s and the line's whole text", (cause, id) => {
    const { container } = render(
      <MissingDataMessage
        lines={lines([gap(cause, [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE })], {
          rebuilding: false,
        })}
      />,
    );
    const marked = container.querySelectorAll(`[data-degrade-id="${id}"]`);
    expect(marked).toHaveLength(1);
    // The marker wraps the whole line, so the registry text IS the sentence a reader sees.
    const p = container.querySelectorAll("section p")[1];
    expect(marked[0].textContent).toBe(p.textContent);
    expect(marked[0].textContent).toContain(L1);
  });

  it("the one-named-key not-syncing fallback carries its own id", () => {
    const { container } = render(
      <MissingDataMessage
        lines={lines([], { reason: "key_not_syncing", notSyncingKeys: [K1] })}
      />,
    );
    expect(container.querySelectorAll('[data-degrade-id="allocation.key-gap.not-syncing-one-key"]')).toHaveLength(1);
  });
});

describe("MissingDataMessage: the key-label rule and the owner-only rule (T-198-17)", () => {
  it("every named key reads through apiKeyLabelById: exchange display name, em dash, nickname or masked tail", () => {
    // A hand-built `${exchange} ${nickname}` would print `okx Spare` and `binance Main`.
    const out = linesText([
      gap("sync_failing", [K3.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
      gap("sync_failing", [K2.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
    ], { rebuilding: false });
    expect(out.some((l) => l.startsWith(`${L3}: `))).toBe(true);
    expect(out.some((l) => l.startsWith(`${L2}: `))).toBe(true);
    expect(out.join(" ")).not.toMatch(/okx Spare|binance /);
  });

  it("a gap whose key ids have no label names nothing, and a raw id is never printed", () => {
    const g = gap("sync_failing", ["foreign-key-id-77"], { firstMissingDay: "2026-10-03", ranges: RANGE });
    expect(lines([g], { rebuilding: false })).toEqual([]);
    // One id of a two-key gap unknown: the whole gap names nothing (never half a pair).
    const half = gap("duplicate_account", [K1.id, "foreign-key-id-77"]);
    expect(lines([half], { rebuilding: false })).toEqual([]);
    const { container } = render(
      <MissingDataMessage lines={lines([g, half], { rebuilding: true, reason: "duplicate_account" })} />,
    );
    expect(container.textContent).not.toContain("foreign-key-id-77");
  });

  it("an unlabelled gap leaves the reason's shipped unnamed sentence to cover the book", () => {
    const g = gap("not_syncing", ["foreign-key-id-77"], { firstMissingDay: "2026-10-03", ranges: RANGE });
    expect(linesText([g], { reason: "key_not_syncing" })).toEqual([
      `${HISTORY_HIDDEN}One of your keys is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.`,
    ]);
  });

  it("namedExitKeyIds lists only labelled keys of the two exit causes", () => {
    const ids = namedExitKeyIds(
      [
        gap("sync_failing", [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
        gap("read_incomplete", [K2.id]),
        gap("sync_failing", ["foreign-key-id-77"]),
        gap("not_syncing", [K3.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
      ],
      API_KEYS,
    );
    expect([...ids].sort()).toEqual([K1.id, K2.id].sort());
  });
});

describe("MissingDataMessage: the shipped fallbacks, once, and only when no line covers the reason", () => {
  it("key_not_syncing with one resolvable key: the shipped sentence naming the key, from the one label rule", () => {
    expect(linesText([], { reason: "key_not_syncing", notSyncingKeys: [K1] })).toEqual([
      `One of your keys, ${L1}, is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.`,
    ]);
    cleanup();
    // No nickname: the masked tail, as the label rule prints it.
    expect(linesText([], { reason: "key_not_syncing", notSyncingKeys: [K2] })[0]).toContain(
      `One of your keys, ${L2}, is not syncing`,
    );
  });

  it.each([
    // 199-05 (OQ-2): the unnamed fallbacks keep every shipped word and gain the scope
    // sentence in front (see HISTORY_HIDDEN).
    [
      "key_not_syncing",
      `${HISTORY_HIDDEN}One of your keys is not syncing, so we cannot confirm which exchange account it reads. Check it on the Exchanges page.`,
    ],
    [
      "duplicate_account",
      `${HISTORY_HIDDEN}Two of your keys read the same exchange account. Disconnect one of them on the Exchanges page and the history rebuilds.`,
    ],
    [
      "shared_account_no_working_key",
      `${HISTORY_HIDDEN}The keys that read one of your exchange accounts are all failing to sync, so that account's history stops. Fix or reconnect one of them on the Exchanges page.`,
    ],
    [
      "account_identity_pending",
      `${HISTORY_HIDDEN}We are confirming which exchange account each key reads. Each daily sync checks it again.`,
    ],
  ] as const)("%s with no gap line: the shipped unnamed sentence under its scope sentence", (reason, sentence) => {
    expect(linesText([], { reason })).toEqual([sentence]);
  });

  it.each([
    [
      // 198-UAT-01 (D-10): names what the history hides, never return or risk.
      // 199-05 (OQ-2): the shipped D-10 wording plus `for your whole history` and one action.
      "awaiting_derivation",
      "Your book's history is recomputed once a day from each account's returns and cash flows. Until the next recompute, the equity chart and the ratios built from it are hidden for your whole history. They appear after the next daily recompute.",
    ],
    [
      "derivation_rejected",
      "The latest rebuild of your book's history did not pass its checks, so it is not shown. The equity chart and the ratios built from it are hidden for your whole history. Use the contact form to have it checked.",
    ],
    [
      "history_read_failed",
      "We could not load your book's history just now. Reload the page to try again.",
    ],
    [
      "shared_account_history_truncated",
      "One of your exchange accounts changed keys, and we cannot join its history from before the change to the new key's, so your history is not shown. The equity chart and the ratios built from it are hidden for your whole history. Use the contact form to have it checked.",
    ],
  ] as const)("book-level %s: its one line", (reason, sentence) => {
    expect(linesText([], { reason })).toEqual([sentence]);
  });

  it("history_read_failed says reload and names no page; the waiting reasons name neither", () => {
    const failed = linesText([], { reason: "history_read_failed" })[0];
    expect(failed).toContain("Reload the page");
    expect(failed).not.toContain("Exchanges page");
    cleanup();
    for (const reason of ["awaiting_derivation", "account_identity_pending"] as const) {
      const text = linesText([], { reason })[0];
      expect(text).not.toContain("Exchanges page");
      expect(text).not.toContain("Reload");
      cleanup();
    }
    for (const reason of [
      "duplicate_account",
      "key_not_syncing",
      "shared_account_no_working_key",
    ] as const) {
      expect(linesText([], { reason })[0]).toContain("Exchanges page");
      cleanup();
    }
  });

  it.each([[null], [undefined], ["constructor"], ["a_reason_added_later"]])(
    "a rebuilding book with reason %s: exactly one shipped line and no error",
    (reason) => {
      expect(linesText([], { reason: reason as Reason })).toEqual([
        "The equity chart and the ratios built from it are hidden for your whole history for now. Use the contact form to have it checked.",
      ]);
    },
  );

  it("a fallback does not double a gap line of its own cause, and another cause does not suppress it", () => {
    // Own cause rendered: no unnamed second sentence.
    const own = linesText(
      [gap("not_syncing", [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE })],
      { reason: "key_not_syncing", notSyncingKeys: [K1] },
    );
    expect(own).toEqual([`${L1}: no data for ${RANGE_TEXT}. ${EXCHANGES_ACTION}`]);
    cleanup();
    // A different cause on the page: the reason's own fallback still renders.
    const other = linesText(
      [gap("identity_pending", [K3.id])],
      { reason: "duplicate_account" },
    );
    expect(other).toHaveLength(2);
    expect(other[0]).toContain(L3);
    expect(other[1]).toBe(
      `${HISTORY_HIDDEN}Two of your keys read the same exchange account. Disconnect one of them on the Exchanges page and the history rebuilds.`,
    );
  });

  it("one key named and another the list cannot label: the cause's fallback still prints, so no affected key is dropped (SFH-4)", () => {
    // Why: the fallback used to be suppressed whenever ANY gap of its cause
    // printed, so key A was named and key B silently vanished.
    const out = linesText(
      [
        gap("not_syncing", [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
        gap("not_syncing", ["foreign-key-id-77"]),
      ],
      { reason: "key_not_syncing", notSyncingKeys: [K1] },
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toContain(L1);
    expect(out[1]).toContain("is not syncing");
  });

  it("two not-syncing keys both named, one with no range: both lines print and no fallback doubles them (SFH-4)", () => {
    const out = linesText(
      [
        gap("not_syncing", [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
        gap("not_syncing", [K3.id]),
      ],
      { reason: "key_not_syncing", notSyncingKeys: [K1, K3] },
    );
    expect(out).toEqual([
      `${L1}: no data for ${RANGE_TEXT}. ${EXCHANGES_ACTION}`,
      `${L3}: no complete history yet. ${EXCHANGES_ACTION}`,
    ]);
  });

  it("a not-syncing key with no gap (history reaches yesterday) beside a gapped one: the fallback still prints (R3-01)", () => {
    // Why: the producer returns no gap for K2, so counting gaps hid it. The
    // reason attributes both keys, and K2 must not vanish from the page.
    const out = linesText(
      [gap("not_syncing", [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE })],
      { reason: "key_not_syncing", notSyncingKeys: [K1, K2] },
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(`${L1}: no data for ${RANGE_TEXT}. ${EXCHANGES_ACTION}`);
    expect(out[1]).toContain("Some of your keys are not syncing");
    // R2-03 stays: K2 gets no false "no complete history yet" line.
    expect(out.join("\n")).not.toContain("no complete history yet");
  });

  it("a ready book gets gap lines only, never a reason fallback", () => {
    expect(linesText([], { rebuilding: false, reason: "key_not_syncing" })).toEqual([]);
    cleanup();
    expect(linesText([], { rebuilding: false, reason: null })).toEqual([]);
  });
});

describe("MissingDataMessage: book-wide lines state their whole-history scope, one action, and never return or risk (D-10, R-03)", () => {
  // Phase 198 D-10: a book-level line names the equity chart and the ratios built from
  // it. GlancePanel prints those two figures from live per-key figures this history does
  // not gate, so a line naming either would be false. Whole-word: "returns" passes.
  const FORBIDDEN = /\b(return|risk)\b/i;
  const CASES: Array<[string, Reason, typeof API_KEYS | null]> = [
    ["awaiting_derivation", "awaiting_derivation", null],
    ["derivation_rejected", "derivation_rejected", null],
    ["shared_account_history_truncated", "shared_account_history_truncated", null],
    ["account_identity_pending", "account_identity_pending", null],
    ["duplicate_account", "duplicate_account", null],
    ["key_not_syncing, keys unknown", "key_not_syncing", null],
    ["key_not_syncing, two keys", "key_not_syncing", [K1, K3]],
    ["shared_account_no_working_key", "shared_account_no_working_key", null],
    ["no known reason", null, null],
  ];

  it.each(CASES)("%s: the rendered line has the scope phrase, ends on one action, and names neither return nor risk", (_name, reason, notSyncingKeys) => {
    const { container } = render(
      <MissingDataMessage lines={lines([], { reason, notSyncingKeys })} />,
    );
    const wholeHistory = Array.from(container.querySelectorAll("[data-degrade-id]")).filter((el) =>
      (WHOLE_HISTORY_IDS as readonly string[]).includes(el.getAttribute("data-degrade-id") ?? ""),
    );
    // Not vacuous: the case must have produced exactly one whole-history line.
    expect(wholeHistory).toHaveLength(1);
    const text = wholeHistory[0].textContent ?? "";
    expect(text).toContain("for your whole history");
    expect(text).not.toMatch(FORBIDDEN);
    expect(
      Object.values(ACTION_SENTENCES).some((a) => text.endsWith(a.sentence)),
      `ends on a vocabulary action: ${text}`,
    ).toBe(true);
  });
});

describe("MissingDataMessage: order, shell and the scope rule", () => {
  it("key lines are sorted by label with book-level lines last", () => {
    const out = linesText(
      [
        gap("sync_failing", [K3.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
        gap("sync_failing", [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
        gap("identity_pending", [K2.id]),
      ],
      { reason: "awaiting_derivation" },
    );
    const labelOf = (l: string) => l.split(":")[0];
    expect(out).toHaveLength(4);
    const named = out.slice(0, 3).map(labelOf);
    expect(named).toEqual([...named].sort((a, b) => a.localeCompare(b)));
    expect(named).toContain(L1);
    expect(named).toContain(L2);
    expect(named).toContain(L3);
    // The book-level line is last. 198-UAT-01 (D-10): it names the history, not return or risk.
    expect(out[3]).toContain("Your book's history is recomputed once a day");
  });

  it("the section is labelled by its eyebrow, is not a live region, and wraps long text", () => {
    const longNick = "N".repeat(120);
    render(
      <MissingDataMessage
        lines={lines(
          [gap("sync_failing", ["kx-long"], { firstMissingDay: "2026-10-03", ranges: RANGE })],
          { apiKeys: [{ id: "kx-long", exchange: "binance", label: longNick }] },
        )}
      />,
    );
    const section = screen.getByTestId("overview-missing-data");
    expect(section.tagName).toBe("SECTION");
    expect(section).not.toHaveAttribute("role");
    expect(section).not.toHaveAttribute("aria-live");
    expect(section.className).toContain("max-w-[1100px]");
    expect(screen.getByRole("region", { name: "What is missing" })).toBe(section);
    const eyebrow = section.querySelector("#overview-missing-data-heading");
    expect(eyebrow?.textContent).toBe("What is missing");
    expect(section.getAttribute("aria-labelledby")).toBe("overview-missing-data-heading");
    const p = section.querySelectorAll("p")[1];
    expect(p.className).toContain("max-w-prose");
    expect(p.className).toContain("[overflow-wrap:anywhere]");
    expect(p.className).toContain("text-text-secondary");
    // Never truncated.
    expect(p.textContent).toContain(longNick);
  });

  it("no named-key line blames 'your keys' or 'your book', and no reason ever says 'holding back your equity history'", () => {
    const gaps: KeyDataGap[] = [
      gap("sync_failing", [K1.id], { firstMissingDay: "2026-10-03", ranges: RANGE }),
      gap("read_incomplete", [K2.id], { firstMissingDay: null, ranges: null }),
      gap("duplicate_account", [K1.id, K2.id]),
      gap("shared_account_failing", [K1.id, K3.id]),
      gap("identity_pending", [K3.id]),
      gap("not_syncing", [K3.id], { firstMissingDay: "2026-10-05", ranges: null }),
    ];
    for (const l of linesText(gaps, { rebuilding: false })) {
      expect(l).not.toMatch(/your keys|your book/i);
    }
    cleanup();
    const reasons: EquityHistoryRebuildReason[] = [
      "duplicate_account",
      "key_not_syncing",
      "shared_account_no_working_key",
      "history_read_failed",
      "account_identity_pending",
      "awaiting_derivation",
      "derivation_rejected",
      "shared_account_history_truncated",
    ];
    for (const reason of reasons) {
      const { container } = render(
        <MissingDataMessage lines={lines(gaps, { reason, notSyncingKeys: [K1] })} />,
      );
      expect(container.textContent).not.toContain("holding back your equity history");
      expect(container.textContent).not.toContain("We are holding back");
      cleanup();
    }
  });
});

describe("EquityHistoryRebuilding.tsx after D-01: the class table and the link, and no panel", () => {
  it("exports exactly the rebuild-reason class table, its guards and the Exchanges link", () => {
    // Why: D-01 retired the generic panel. A heading-rendering component coming
    // back into this module would revive the surface the Overview no longer
    // mounts, and give the Scenario parity test a false comparator again.
    expect(Object.keys(rebuildClassModule).sort()).toEqual([
      "ExchangesPageLink",
      "REBUILD_REASON_CLASS",
      "equityHistoryRebuildClass",
      "isKnownRebuildReason",
      "isNeedsActionReason",
    ]);
  });
});
