import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signAlertAckToken, verifyAlertAckToken } from "./alert-ack-token";

describe("alert-ack-token", () => {
  const originalSecret = process.env.ALERT_ACK_SECRET;

  beforeEach(() => {
    process.env.ALERT_ACK_SECRET = "test-ack-secret-at-least-16-chars";
  });

  afterEach(() => {
    if (originalSecret) {
      process.env.ALERT_ACK_SECRET = originalSecret;
    } else {
      delete process.env.ALERT_ACK_SECRET;
    }
    vi.useRealTimers();
  });

  it("verifies a freshly-signed token", () => {
    const token = signAlertAckToken("alert-1");
    expect(verifyAlertAckToken("alert-1", token)).toBe(true);
  });

  it("rejects the token for a different alert id", () => {
    const token = signAlertAckToken("alert-1");
    expect(verifyAlertAckToken("alert-2", token)).toBe(false);
  });

  it("rejects null, undefined and empty tokens", () => {
    expect(verifyAlertAckToken("alert-1", null)).toBe(false);
    expect(verifyAlertAckToken("alert-1", undefined)).toBe(false);
    expect(verifyAlertAckToken("alert-1", "")).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(verifyAlertAckToken("alert-1", "not-a-token")).toBe(false);
    expect(verifyAlertAckToken("alert-1", "abc.")).toBe(false);
    expect(verifyAlertAckToken("alert-1", ".abc")).toBe(false);
    expect(verifyAlertAckToken("alert-1", ".")).toBe(false);
  });

  it("rejects signatures that are not 64-character lowercase hex", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    // 64 chars but contains a non-hex letter
    expect(
      verifyAlertAckToken("alert-1", `${exp}.g${"0".repeat(63)}`),
    ).toBe(false);
    // too short
    expect(verifyAlertAckToken("alert-1", `${exp}.${"0".repeat(63)}`)).toBe(
      false,
    );
    // too long
    expect(verifyAlertAckToken("alert-1", `${exp}.${"0".repeat(65)}`)).toBe(
      false,
    );
    // uppercase — digest("hex") is always lowercase
    expect(
      verifyAlertAckToken("alert-1", `${exp}.${"A".repeat(64)}`),
    ).toBe(false);
  });

  it("rejects an expired token (ancient exp)", () => {
    const past = "1.deadbeef";
    expect(verifyAlertAckToken("alert-1", past)).toBe(false);
  });

  it("rejects a freshly-signed token after time-travel past the 48h TTL", () => {
    const token = signAlertAckToken("alert-1");
    expect(verifyAlertAckToken("alert-1", token)).toBe(true);

    // Advance past 48h + 1s.
    const future = Date.now() + (60 * 60 * 48 + 1) * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(future));

    expect(verifyAlertAckToken("alert-1", token)).toBe(false);
  });

  it("accepts a freshly-signed token near-but-before the 48h TTL", () => {
    const token = signAlertAckToken("alert-1");

    // 48h minus 10s from now — still within TTL.
    const future = Date.now() + (60 * 60 * 48 - 10) * 1000;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(future));

    expect(verifyAlertAckToken("alert-1", token)).toBe(true);
  });

  it("rejects a token with a tampered signature", () => {
    const token = signAlertAckToken("alert-1");
    const [exp] = token.split(".");
    const fakeSig = "0".repeat(64);
    expect(verifyAlertAckToken("alert-1", `${exp}.${fakeSig}`)).toBe(false);
  });

  it("returns false silently when ALERT_ACK_SECRET is unset", () => {
    delete process.env.ALERT_ACK_SECRET;
    expect(verifyAlertAckToken("alert-1", "1.abc")).toBe(false);
  });

  it("throws when signing without a secret", () => {
    delete process.env.ALERT_ACK_SECRET;
    expect(() => signAlertAckToken("alert-1")).toThrow();
  });

  it("throws when secret is too short", () => {
    process.env.ALERT_ACK_SECRET = "short";
    expect(() => signAlertAckToken("alert-1")).toThrow();
  });
});
