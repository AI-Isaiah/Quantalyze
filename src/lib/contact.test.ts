import { describe, expect, it } from "vitest";
import {
  CONTACT_FORM_LINK_TEXT,
  CONTACT_ID_RE,
  CONTACT_PATH,
  CONTACT_SOURCES,
  CONTACT_TOPICS,
  CONTACT_TOPIC_LABELS,
  contactHref,
  parseContactPrefill,
} from "./contact";

// UUID-shaped and cid-shaped ids: the two producers the prefill fence admits.
const UUID = "3f1c9a2e-7b04-4d1a-9c55-0e2f8a6b1d33";
const CID = "cid-lq8x2k-9f3a1b";

describe("contract constants (UI-SPEC, pinned verbatim)", () => {
  it("names the one contact path", () => {
    expect(CONTACT_PATH).toBe("/contact");
  });

  it("lists the four topics in the UI-SPEC order", () => {
    expect([...CONTACT_TOPICS]).toEqual([
      "general",
      "support",
      "security",
      "privacy",
    ]);
  });

  it("labels every topic with the UI-SPEC label, verbatim", () => {
    expect(CONTACT_TOPIC_LABELS).toEqual({
      general: "General question",
      support: "Account or strategy support",
      security: "Security report",
      privacy: "Privacy or data request",
    });
  });

  it("names the two sources the database CHECK admits", () => {
    expect([...CONTACT_SOURCES]).toEqual(["request_call", "contact_form"]);
  });

  it("uses the exact link text every pointer sentence carries", () => {
    expect(CONTACT_FORM_LINK_TEXT).toBe("contact form");
  });

  it("fences ids to the charset and length of the ids the app mints", () => {
    expect(CONTACT_ID_RE.source).toBe("^[A-Za-z0-9_:-]{8,64}$");
  });

  it("admits the wizard page-load correlation id, which carries a colon", () => {
    expect(CONTACT_ID_RE.test("wizard:3f2b8c1e-9d4a-4b7e-8c21-5a6f0e9d1b42")).toBe(true);
    expect(CONTACT_ID_RE.test("wizard:<script>")).toBe(false);
  });
});

describe("contactHref", () => {
  it("builds the bare topic href", () => {
    expect(contactHref({ topic: "support" })).toBe("/contact?topic=support");
  });

  it("emits keys in the fixed order topic, ref, draft, strategy", () => {
    expect(
      contactHref({
        strategy: UUID,
        draft: CID,
        ref: "abcdefgh",
        topic: "security",
      }),
    ).toBe(
      `/contact?topic=security&ref=abcdefgh&draft=${CID}&strategy=${UUID}`,
    );
  });

  it("omits undefined, null and empty values rather than sending them empty", () => {
    expect(
      contactHref({
        topic: "general",
        ref: undefined,
        draft: null,
        strategy: "",
      }),
    ).toBe("/contact?topic=general");
  });

  it("encodes values so a pointer can never inject a second parameter", () => {
    const href = contactHref({ topic: "general", ref: "a&topic=security b" });
    expect(href).toBe("/contact?topic=general&ref=a%26topic%3Dsecurity%20b");
    // Round-trips to the one value, not to extra keys.
    const q = new URL(href, "https://x.test").searchParams;
    expect(q.get("topic")).toBe("general");
    expect(q.get("ref")).toBe("a&topic=security b");
  });
});

describe("parseContactPrefill (D-02 prefill fence)", () => {
  it("accepts a valid topic and returns general for an unknown one", () => {
    expect(parseContactPrefill({ topic: "privacy" }).topic).toBe("privacy");
    expect(parseContactPrefill({ topic: "billing" }).topic).toBe("general");
    expect(parseContactPrefill({}).topic).toBe("general");
  });

  it("treats an array topic as absent", () => {
    expect(parseContactPrefill({ topic: ["security", "privacy"] }).topic).toBe(
      "general",
    );
  });

  it("accepts UUID-shaped and cid-shaped ids", () => {
    const p = parseContactPrefill({ ref: UUID, draft: CID, strategy: UUID });
    expect(p.ref).toBe(UUID);
    expect(p.draft).toBe(CID);
    expect(p.strategy).toBe(UUID);
  });

  it("composes the reference in order, single-space separated, present parts only", () => {
    expect(
      parseContactPrefill({ ref: UUID, draft: CID, strategy: "strat-0001" })
        .reference,
    ).toBe(`${UUID} draft ${CID} strategy strat-0001`);
    expect(parseContactPrefill({ ref: UUID }).reference).toBe(UUID);
    expect(parseContactPrefill({ draft: CID }).reference).toBe(`draft ${CID}`);
    expect(parseContactPrefill({ strategy: UUID }).reference).toBe(
      `strategy ${UUID}`,
    );
    expect(parseContactPrefill({ ref: UUID, strategy: UUID }).reference).toBe(
      `${UUID} strategy ${UUID}`,
    );
  });

  it("returns an empty reference when nothing valid arrived", () => {
    expect(parseContactPrefill({}).reference).toBe("");
  });

  it.each([
    ["a script payload", "<script>alert(1)</script>"],
    ["a 7-character id", "abcdefg"],
    ["a 65-character id", "a".repeat(65)],
    ["a value with a space", "abcd efgh"],
    ["an empty string", ""],
  ])("drops %s from every id slot", (_name, bad) => {
    const p = parseContactPrefill({ ref: bad, draft: bad, strategy: bad });
    expect(p.ref).toBeUndefined();
    expect(p.draft).toBeUndefined();
    expect(p.strategy).toBeUndefined();
    expect(p.reference).toBe("");
  });

  it("keeps a valid id when its siblings are dropped", () => {
    const p = parseContactPrefill({ ref: "<b>", draft: CID });
    expect(p.reference).toBe(`draft ${CID}`);
  });

  it("accepts the boundary lengths 8 and 64", () => {
    expect(parseContactPrefill({ ref: "a".repeat(8) }).ref).toBe("a".repeat(8));
    expect(parseContactPrefill({ ref: "a".repeat(64) }).ref).toBe(
      "a".repeat(64),
    );
  });

  it("treats an array id as absent (a repeated query key)", () => {
    expect(parseContactPrefill({ ref: [UUID, UUID] }).ref).toBeUndefined();
  });

  it("never composes past the 200-character reference CHECK, dropping a whole later part instead of clipping an id", () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    const c = "c".repeat(64);
    const p = parseContactPrefill({ ref: a, draft: b, strategy: c });
    // 64 + " draft " + 64 + " strategy " + 64 = 209 would breach the DB CHECK.
    expect(p.reference).toBe(`${a} draft ${b}`);
    expect(p.reference.length).toBeLessThanOrEqual(200);
    // The individual id the page read is still reported, only the composed
    // Reference prefill omits it.
    expect(p.strategy).toBe(c);
  });
});
