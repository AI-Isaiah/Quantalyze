import { describe, it, expect } from "vitest";
import type { ComputeState } from "./compute-state";
import {
  KCS10_PUBLIC_SENTENCE,
  ownerRemedy,
  ownerStateLine,
  recipientShareNote,
  SHARE_CARD_COPY,
  untrustedKeyCaption,
  type OwnerRemedy,
} from "./status-surface-copy";

/**
 * Phase 167.2 / KCS-13, KCS-14 — the S4-S9 copy, pinned character for
 * character against 167.2-UI-SPEC.md § Copywriting Contract.
 *
 * ORACLE INDEPENDENCE: every expected string below is typed as a literal in
 * THIS file, never imported from the module under test. U+2014 and U+00B7 are
 * also asserted by code point, so a hyphen or a period in their place fails.
 * One `it` per UI-SPEC pin id; the id is in the test name.
 */

const SID = "00000000-0000-4000-8000-000000000001";

const rendered = (r: OwnerRemedy) => r.before + (r.link?.text ?? "") + r.after;

const RELOAD = "Reload this page to see the latest status.";

describe("S6 — KCS-09 owner state lines", () => {
  const cases: Array<[string, ComputeState, string, "muted" | "amber" | "red"]> = [
    ["KCS09-QUEUED", { state: "queued" }, "A computation for this strategy is queued and has not started yet.", "muted"],
    ["KCS09-RETRYING", { state: "retrying" }, "The last attempt hit a temporary problem, and the service is retrying it automatically.", "amber"],
    ["KCS09-RUN-FETCH", { state: "running", phase: "fetch" }, "Fetching this strategy's trades from the exchange.", "muted"],
    ["KCS09-RUN-MEMBER", { state: "running", phase: "fetch", memberOf: { n: 3, m: 3 } }, "Fetching trades for this composite strategy: key 3 of 3.", "muted"],
    ["KCS09-RUN-COMPUTE", { state: "running", phase: "compute" }, "Computing this strategy's analytics from its trades.", "muted"],
    ["KCS09-RUN-UNKNOWN", { state: "running", phase: "unknown" }, "The analytics service is working on this strategy.", "muted"],
    ["KCS09-STALLED", { state: "stalled" }, "The computation for this composite strategy stopped reporting progress more than 12 minutes ago.", "amber"],
    ["KCS09-FAIL-PERMANENT", { state: "failed", errorKind: "permanent" }, "The last computation stopped on a problem that retrying alone will not resolve.", "red"],
    ["KCS09-FAIL-TRANSIENT", { state: "failed", errorKind: "transient" }, "The last computation stopped after its automatic retries ran out.", "amber"],
    ["KCS09-FAIL-ORPHANED", { state: "failed", errorKind: "orphaned" }, "The last computation stopped before it finished because the process running it went away.", "amber"],
    ["KCS09-FAIL-UNKNOWN", { state: "failed", errorKind: "unknown" }, "The last computation stopped, and the service could not tell why.", "amber"],
    ["KCS09-FAIL-OTHER", { state: "failed", errorKind: null }, "The last computation did not finish.", "amber"],
    ["KCS09-FINISHED", { state: "finished" }, "The last computation finished, but the factsheet could not be built from its results.", "amber"],
    ["KCS09-NEVER", { state: "never_started" }, "No computation is running for this strategy, and none is on record.", "muted"],
    ["KCS09-UNREADABLE", { state: "unreadable" }, "The computation status for this strategy could not be read.", "muted"],
  ];
  for (const [id, state, text, tone] of cases) {
    it(`${id}: text and tone`, () => {
      expect(ownerStateLine(state)).toEqual({ id, text, tone });
    });
  }

  it("KCS09-RUN-MEMBER interpolates {n} and {m} from memberOf", () => {
    expect(ownerStateLine({ state: "running", phase: "fetch", memberOf: { n: 1, m: 2 } }).text).toBe(
      "Fetching trades for this composite strategy: key 1 of 2.",
    );
  });

  it("KCS09-STALLED renders 12 from STALL_THRESHOLD_MS (720000 / 60000), not a typed literal", () => {
    expect(ownerStateLine({ state: "stalled" }).text).toContain(" 12 minutes ");
  });

  it("apostrophes are ASCII U+0027", () => {
    const t = ownerStateLine({ state: "running", phase: "fetch" }).text;
    expect(t).toContain("strategy's");
    expect(t).not.toContain("’");
  });
});

describe("S6 — KCS-09 fixed remedies", () => {
  it("KCS09-RELOAD for queued, retrying and every running phase", () => {
    const states: ComputeState[] = [
      { state: "queued" },
      { state: "retrying" },
      { state: "running", phase: "fetch" },
      { state: "running", phase: "fetch", memberOf: { n: 2, m: 3 } },
      { state: "running", phase: "compute" },
      { state: "running", phase: "unknown" },
    ];
    for (const s of states) {
      for (const shape of ["single", "unlinked", "composite", "csv", "unknown"] as const) {
        const r = ownerRemedy(s, shape, SID);
        expect(r.id).toBe("KCS09-RELOAD");
        expect(r.link).toBeUndefined();
        expect(rendered(r)).toBe(RELOAD);
      }
    }
  });

  it("KCS09-CONTACT-PERMANENT for a permanent failure, whatever the shape", () => {
    for (const shape of ["single", "composite", "csv", "unknown"] as const) {
      const r = ownerRemedy({ state: "failed", errorKind: "permanent" }, shape, SID);
      expect(r.id).toBe("KCS09-CONTACT-PERMANENT");
      expect(rendered(r)).toBe("Contact support@quantalyze.com to resolve it.");
    }
  });

  it("KCS09-CONTACT-CHECK for finished without a payload", () => {
    const r = ownerRemedy({ state: "finished" }, "single", SID);
    expect(r.id).toBe("KCS09-CONTACT-CHECK");
    expect(rendered(r)).toBe("Contact support@quantalyze.com to have it checked.");
  });

  it("KCS09-UNREADABLE remedy: Reload this page to try again.", () => {
    const r = ownerRemedy({ state: "unreadable" }, "single", SID);
    expect(rendered(r)).toBe("Reload this page to try again.");
    expect(r.link).toBeUndefined();
  });
});

describe("S6 — KCS-21 shape remedies", () => {
  const shapeStates: ComputeState[] = [
    { state: "stalled" },
    { state: "failed", errorKind: "transient" },
    { state: "failed", errorKind: "orphaned" },
    { state: "failed", errorKind: "unknown" },
    { state: "failed", errorKind: null },
    { state: "never_started" },
  ];

  it("KCS21-SINGLE with an edit-page link", () => {
    for (const s of shapeStates) {
      const r = ownerRemedy(s, "single", SID);
      expect(r.id).toBe("KCS21-SINGLE");
      expect(r.link).toEqual({ text: "edit page", href: `/strategies/${SID}/edit` });
      expect(rendered(r)).toBe(
        "Start a new computation with Resync on this strategy's edit page. Contact support@quantalyze.com if it does not complete.",
      );
    }
  });

  it("KCS21-UNLINKED with an edit-page link", () => {
    const r = ownerRemedy({ state: "never_started" }, "unlinked", SID);
    expect(r.id).toBe("KCS21-UNLINKED");
    expect(r.link).toEqual({ text: "edit page", href: `/strategies/${SID}/edit` });
    expect(rendered(r)).toBe(
      "Link a key with Use & Sync on this strategy's edit page to start a new computation. Contact support@quantalyze.com if it does not complete.",
    );
  });

  it("KCS21-COMPOSITE carries no link", () => {
    const r = ownerRemedy({ state: "stalled" }, "composite", SID);
    expect(r.id).toBe("KCS21-COMPOSITE");
    expect(r.link).toBeUndefined();
    expect(rendered(r)).toBe(
      "A composite strategy has no self-serve re-run. Contact support@quantalyze.com to start a new computation.",
    );
  });

  it("KCS21-CSV links to the CSV wizard", () => {
    const r = ownerRemedy({ state: "failed", errorKind: "transient" }, "csv", SID);
    expect(r.id).toBe("KCS21-CSV");
    expect(r.link).toEqual({
      text: "upload a new CSV strategy",
      href: "/strategies/new/wizard?source=csv",
    });
    expect(rendered(r)).toBe(
      "A CSV strategy's data is fixed at upload. To publish a corrected series, upload a new CSV strategy, or contact support@quantalyze.com.",
    );
  });

  it("an unknown shape never guesses: every shape-remedy state renders the retry-read sentence, no link", () => {
    for (const s of shapeStates) {
      const r = ownerRemedy(s, "unknown", SID);
      expect(rendered(r)).toBe("Reload this page to try again.");
      expect(r.link).toBeUndefined();
    }
  });
});

describe("S5 / S7 — KCS-12 share notes", () => {
  it("KCS12-MINT-A: private link, in progress", () => {
    expect(recipientShareNote("mint-token", "in_progress")).toBe(
      "Right now, a private link to this strategy shows that its factsheet is being prepared. The numbers appear there once a computation succeeds.",
    );
  });

  it("KCS12-MINT-B: private link, not available", () => {
    expect(recipientShareNote("mint-token", "not_available")).toBe(
      "Right now, a private link to this strategy shows that its factsheet is not available yet. The numbers appear there once a computation succeeds.",
    );
  });

  it("KCS12-UNREADABLE: private link, state unreadable", () => {
    expect(recipientShareNote("mint-token", "unreadable")).toBe(
      "Right now, a private link to this strategy shows a placeholder page instead of the numbers. They appear there once a computation succeeds.",
    );
  });

  it("KCS12-PUBLIC: public URL, any arm", () => {
    for (const arm of ["in_progress", "not_available", "unreadable"] as const) {
      expect(recipientShareNote("public-url", arm)).toBe(
        "Right now, this strategy's factsheet link shows that the factsheet is not available yet. The numbers appear there once a computation succeeds.",
      );
    }
  });
});

describe("S8 — KCS-10 public pending sentence", () => {
  it("KCS10-PUBLIC is exact and names no failure, error or timing", () => {
    expect(KCS10_PUBLIC_SENTENCE).toBe("The detailed factsheet for this strategy is not available yet.");
    const lower = KCS10_PUBLIC_SENTENCE.toLowerCase();
    for (const banned of ["failed", "error", "still computing", "few minutes", "some strategies stay in this state"]) {
      expect(lower).not.toContain(banned);
    }
  });
});

describe("S9 — KCS-11 share page arms", () => {
  it("KCS11-A: in progress", () => {
    expect(SHARE_CARD_COPY.in_progress).toEqual({
      heading: "This factsheet isn't ready yet",
      body: "The link works — the strategy's performance data is being prepared. Try again later.",
    });
  });

  it("KCS11-B: not available", () => {
    expect(SHARE_CARD_COPY.not_available).toEqual({
      heading: "This factsheet isn't available yet",
      body: "The link works — the strategy's performance data is not available yet. Check with the person who shared this link before trying again.",
    });
  });

  it("KCS11-A and KCS11-B bodies carry U+2014, not a hyphen, and name no failure, error or minutes", () => {
    for (const arm of [SHARE_CARD_COPY.in_progress, SHARE_CARD_COPY.not_available]) {
      expect(arm.body).toContain("—");
      expect(arm.body).not.toContain(" - ");
      const lower = arm.body.toLowerCase();
      for (const banned of ["failed", "error", "minutes"]) {
        expect(lower).not.toContain(banned);
      }
    }
  });
});

describe("S4 — KCS-06 key-mark captions", () => {
  it("KCS06-ONE: one key", () => {
    expect(untrustedKeyCaption(["bybit"], 1)).toBe("Exchange key · Bybit");
  });

  it("KCS06-MANY: distinct display names in first-seen order", () => {
    expect(untrustedKeyCaption(["bybit", "okx", "bybit"], 3)).toBe("Exchange keys · Bybit, OKX");
    expect(untrustedKeyCaption(["bybit"], 2)).toBe("Exchange keys · Bybit");
  });

  it("KCS06 captions carry U+00B7", () => {
    expect(untrustedKeyCaption(["okx"], 1)).toContain("·");
    expect(untrustedKeyCaption(["okx"], 1).codePointAt("Exchange key ".length)).toBe(0xb7);
  });

  it("a code absent from EXCHANGE_DISPLAY renders as stored", () => {
    expect(untrustedKeyCaption(["future_venue"], 1)).toBe("Exchange key · future_venue");
    expect(untrustedKeyCaption(["constructor"], 1)).toBe("Exchange key · constructor");
  });
});

describe("totality — every ComputeState variant has a state line and a remedy", () => {
  const every: ComputeState[] = [
    { state: "queued" },
    { state: "retrying" },
    { state: "running", phase: "fetch" },
    { state: "running", phase: "fetch", memberOf: { n: 1, m: 1 } },
    { state: "running", phase: "compute" },
    { state: "running", phase: "unknown" },
    { state: "stalled" },
    { state: "failed", errorKind: "permanent" },
    { state: "failed", errorKind: "transient" },
    { state: "failed", errorKind: "orphaned" },
    { state: "failed", errorKind: "unknown" },
    { state: "failed", errorKind: null },
    { state: "finished" },
    { state: "never_started" },
    { state: "unreadable" },
  ];

  it("fifteen variants map to fifteen distinct state-line ids", () => {
    const ids = every.map((s) => ownerStateLine(s).id);
    expect(new Set(ids).size).toBe(15);
  });

  it("each variant renders a non-empty, period-terminated line and remedy for every shape", () => {
    for (const s of every) {
      const line = ownerStateLine(s);
      expect(line.text.length).toBeGreaterThan(0);
      expect(line.text.endsWith(".")).toBe(true);
      expect(["muted", "amber", "red"]).toContain(line.tone);
      for (const shape of ["single", "unlinked", "composite", "csv", "unknown"] as const) {
        const r = rendered(ownerRemedy(s, shape, SID));
        expect(r.length).toBeGreaterThan(0);
        expect(r.endsWith(".")).toBe(true);
      }
    }
  });

  it("only a permanent failure is red (DESIGN.md § Semantic-color gates)", () => {
    const red = every.filter((s) => ownerStateLine(s).tone === "red");
    expect(red).toEqual([{ state: "failed", errorKind: "permanent" }]);
  });
});
