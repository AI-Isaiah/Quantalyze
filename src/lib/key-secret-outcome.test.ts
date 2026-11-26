import { describe, expect, it } from "vitest";
import {
  keySecretField,
  keySecretNoticeText,
  parseKeySecretOutcome,
} from "./key-secret-outcome";

describe("parseKeySecretOutcome", () => {
  it("keeps a closed-set outcome and trims a string name", () => {
    expect(parseKeySecretOutcome({ outcome: "updated", name: " K " })).toEqual({
      outcome: "updated",
      name: "K",
    });
  });

  it("an outcome with no name has no name key at all", () => {
    const parsed = parseKeySecretOutcome({ outcome: "unchanged" });
    expect(parsed).toEqual({ outcome: "unchanged" });
    expect(parsed).not.toHaveProperty("name");
  });

  it("drops a blank or non-string name but keeps the outcome", () => {
    expect(parseKeySecretOutcome({ outcome: "updated", name: "  " })).toEqual({
      outcome: "updated",
    });
    expect(parseKeySecretOutcome({ outcome: "updated", name: 7 })).toEqual({
      outcome: "updated",
    });
  });

  it("an unknown outcome or a non-object is 'we were not told' (null)", () => {
    expect(parseKeySecretOutcome({ outcome: "rotated" })).toBeNull();
    expect(parseKeySecretOutcome({})).toBeNull();
    expect(parseKeySecretOutcome(null)).toBeNull();
    expect(parseKeySecretOutcome(undefined)).toBeNull();
    expect(parseKeySecretOutcome("updated")).toBeNull();
    expect(parseKeySecretOutcome([])).toBeNull();
  });
});

describe("keySecretField", () => {
  it("is {} when there is no outcome, so the body is byte-identical to today's", () => {
    expect(keySecretField(undefined)).toEqual({});
    expect(keySecretField(null)).toEqual({});
  });

  it("omits a blank name, never null and never an empty string", () => {
    const f = keySecretField({ outcome: "updated", name: "  " });
    expect(f).toEqual({ key_secret: { outcome: "updated" } });
    expect(f.key_secret).not.toHaveProperty("name");
  });

  it("carries a trimmed name", () => {
    expect(keySecretField({ outcome: "unchanged", name: " Gold " })).toEqual({
      key_secret: { outcome: "unchanged", name: "Gold" },
    });
  });
});

describe("keySecretNoticeText: the four sentences, byte for byte", () => {
  it("updated, named", () => {
    expect(keySecretNoticeText({ outcome: "updated", name: "K" })).toBe(
      'We updated the password on your key "K". No new key or strategy was created.',
    );
  });
  it("updated, unnamed", () => {
    expect(keySecretNoticeText({ outcome: "updated" })).toBe(
      "We updated the password on your stored key for this account. No new key or strategy was created.",
    );
  });
  it("unchanged, named", () => {
    expect(keySecretNoticeText({ outcome: "unchanged", name: "K" })).toBe(
      'Your key "K" already uses this password and it signs in, so we changed nothing.',
    );
  });
  it("unchanged, unnamed", () => {
    expect(keySecretNoticeText({ outcome: "unchanged" })).toBe(
      "Your stored key for this account already uses this password and it signs in, so we changed nothing.",
    );
  });
  it("a blank name that slipped past the parser still selects the unnamed sentence", () => {
    expect(keySecretNoticeText({ outcome: "updated", name: "   " })).not.toContain('""');
  });
});
