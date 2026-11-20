import { describe, it, expect } from "vitest";
import {
  resumeBannerBody,
  resumeSecretKind,
  type ResumeSecretKind,
} from "./resume-banner";
import type { WizardStepKey } from "./localStorage";

/**
 * 218-SC-7. The founder was told to paste an API secret on a banner whose
 * Resume lands on a step with no secret input (2026-11-19). The matrix pins
 * the intent: a re-entry sentence appears only when the resumed step is the
 * one that has a secret input, and it names the right secret for the key type.
 */
const CSV =
  "A CSV upload draft from an earlier session is ready. Re-select the file and continue.";
const PLAIN = "A draft from an earlier session is ready.";
const MT5 =
  "A draft from an earlier session is ready. Secrets are never stored in your browser, so you will need to enter your investor password again.";
const API =
  "A draft from an earlier session is ready. Secrets are never stored in your browser, so you will need to paste your API secret again.";

const KINDS: ResumeSecretKind[] = ["api_secret", "investor_password"];
const STEPS: WizardStepKey[] = ["sync_preview", "connect_key", "csv_upload"];

describe("resumeBannerBody matrix", () => {
  for (const secretKind of KINDS) {
    for (const resumeStep of STEPS) {
      it(`csv / ${secretKind} / ${resumeStep}: the re-select copy, never a secret sentence`, () => {
        expect(resumeBannerBody({ source: "csv", secretKind, resumeStep })).toBe(
          CSV,
        );
      });
    }
  }

  for (const secretKind of KINDS) {
    it(`api / ${secretKind} / sync_preview: no re-entry sentence (the step has no secret input)`, () => {
      const body = resumeBannerBody({
        source: "api",
        secretKind,
        resumeStep: "sync_preview",
      });
      expect(body).toBe(PLAIN);
      expect(body).not.toMatch(/secret|password|again/i);
    });

    it(`api / ${secretKind} / csv_upload: no re-entry sentence`, () => {
      expect(
        resumeBannerBody({ source: "api", secretKind, resumeStep: "csv_upload" }),
      ).toBe(PLAIN);
    });
  }

  it("api / investor_password / connect_key: names the investor password", () => {
    expect(
      resumeBannerBody({
        source: "api",
        secretKind: "investor_password",
        resumeStep: "connect_key",
      }),
    ).toBe(MT5);
  });

  it("api / api_secret / connect_key: names the API secret", () => {
    expect(
      resumeBannerBody({
        source: "api",
        secretKind: "api_secret",
        resumeStep: "connect_key",
      }),
    ).toBe(API);
  });
});

describe("resumeSecretKind", () => {
  it("an MT5 draft needs the investor password (capability predicate, not a name list)", () => {
    expect(resumeSecretKind(["mt5"])).toBe("investor_password");
    expect(resumeSecretKind(["MT5"])).toBe("investor_password");
  });

  it("an ordinary venue, an empty list, null and undefined all need the API secret", () => {
    expect(resumeSecretKind(["binance"])).toBe("api_secret");
    expect(resumeSecretKind([])).toBe("api_secret");
    expect(resumeSecretKind(null)).toBe("api_secret");
    expect(resumeSecretKind(undefined)).toBe("api_secret");
  });

  it("any MT5 entry among several decides it", () => {
    expect(resumeSecretKind(["binance", "mt5"])).toBe("investor_password");
  });
});
