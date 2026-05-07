import { describe, it, expect } from "vitest";
import {
  deriveWizardResumeOverrides,
  type WizardLocalState,
} from "./localStorage";

// Regression coverage for the React #418 hydration mismatch on
// /strategies/new/wizard?source=csv. The previous WizardClient pattern
// read localStorage during render via a useRef + conditional assignment.
// `typeof window !== "undefined"` is false on SSR and true on the client
// first render, so the LS-derived `loaded` value drove different
// useState initial values per pass — and the CSV branch in particular
// rendered csv_preview on the client when SSR rendered csv_upload,
// which caused React to unmount the tree.
//
// The fix: extract the LS-derivation logic into this pure helper, call
// it ONLY from a post-mount useEffect (not during render), and apply
// the overrides via setState. SSR + first client render produce
// identical markup; the resumed step arrives on the next paint.
//
// These tests pin the helper's contract so a future patch cannot
// silently re-introduce the trap.

describe("deriveWizardResumeOverrides — pure LS-derivation helper", () => {
  it("returns no overrides when loaded is null (SSR + fresh client)", () => {
    expect(deriveWizardResumeOverrides(null, "csv", null)).toEqual({});
    expect(deriveWizardResumeOverrides(null, "api", "draft-1")).toEqual({});
  });

  describe("CSV branch", () => {
    const csvLoaded: WizardLocalState = {
      strategyId: "",
      wizardSessionId: "ls-session-id",
      step: "csv_preview",
      savedAt: 1_700_000_000_000,
      source: "csv",
      strategyName: "Aurora Capital",
    };

    it("restores csv_preview/csv_submit/csv_upload when LS source is csv", () => {
      const out = deriveWizardResumeOverrides(csvLoaded, "csv", null);
      expect(out.step).toBe("csv_preview");
      expect(out.strategyName).toBe("Aurora Capital");
      expect(out.wizardSessionId).toBe("ls-session-id");
      // No server-side draft id on the CSV branch ⇒ banner stays hidden.
      expect(out.showResumeBanner).toBeUndefined();
    });

    it("does NOT restore an API-branch step (e.g. sync_preview) on the CSV branch", () => {
      const apiLoaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "sync_preview",
        savedAt: 1_700_000_000_000,
        source: "api",
      };
      const out = deriveWizardResumeOverrides(apiLoaded, "csv", null);
      expect(out.step).toBeUndefined();
      // strategyName is CSV-only ⇒ no override from an API payload.
      expect(out.strategyName).toBeUndefined();
    });

    it("does NOT bring strategyName forward when LS source is api", () => {
      const apiLoaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "metadata",
        savedAt: 1_700_000_000_000,
        source: "api",
        // A future writer that accidentally serializes a name on the
        // API branch must not leak it into the CSV input field.
        strategyName: "leaked-from-api-branch" as unknown as string,
      };
      const out = deriveWizardResumeOverrides(apiLoaded, "csv", null);
      expect(out.strategyName).toBeUndefined();
    });
  });

  describe("API branch", () => {
    it("restores the LS step when strategyId matches the server draft", () => {
      const loaded: WizardLocalState = {
        strategyId: "draft-uuid",
        wizardSessionId: "ls-session-id",
        step: "metadata",
        savedAt: 1_700_000_000_000,
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "draft-uuid");
      expect(out.step).toBe("metadata");
      expect(out.showResumeBanner).toBeUndefined();
    });

    it("surfaces the resume banner when strategyId mismatches the server draft", () => {
      const loaded: WizardLocalState = {
        strategyId: "stale-uuid",
        wizardSessionId: "ls-session-id",
        step: "metadata",
        savedAt: 1_700_000_000_000,
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "fresh-uuid");
      expect(out.step).toBeUndefined();
      expect(out.showResumeBanner).toBe(true);
    });

    it("does NOT restore the LS step when the CSV-sentinel '' strategyId leaks onto the API branch", () => {
      const loaded: WizardLocalState = {
        strategyId: "",
        wizardSessionId: "ls-session-id",
        step: "csv_preview",
        savedAt: 1_700_000_000_000,
        source: "csv",
        strategyName: "Aurora",
      };
      const out = deriveWizardResumeOverrides(loaded, "api", "draft-uuid");
      expect(out.step).toBeUndefined();
      // Mismatch '' vs 'draft-uuid' ⇒ banner.
      expect(out.showResumeBanner).toBe(true);
    });
  });

  it("always carries the wizardSessionId forward so funnel correlation survives resume", () => {
    const loaded: WizardLocalState = {
      strategyId: "draft-uuid",
      wizardSessionId: "ls-session-id",
      step: "sync_preview",
      savedAt: 1_700_000_000_000,
    };
    expect(
      deriveWizardResumeOverrides(loaded, "api", "draft-uuid").wizardSessionId,
    ).toBe("ls-session-id");
    expect(
      deriveWizardResumeOverrides(loaded, "csv", null).wizardSessionId,
    ).toBe("ls-session-id");
  });
});
