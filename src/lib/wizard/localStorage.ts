/**
 * Wizard state persistence helpers. localStorage (not sessionStorage)
 * so the resume pointer survives tab close. The server-side
 * `strategies` row is the source of truth for the draft data itself —
 * this module only remembers which draft and which step. Secrets are
 * never persisted.
 */

const STORAGE_KEY = "quantalyze_wizard_state_v1";

export type WizardStepKey =
  | "connect_key"
  | "sync_preview"
  | "metadata"
  | "submit"
  | "csv_upload"
  | "csv_preview"
  | "csv_submit";

export interface WizardLocalState {
  /**
   * API branch (`source === 'api'` or undefined): a real UUID — the
   * server-side strategies row id for the in-progress draft.
   * CSV branch (`source === 'csv'`): empty string `""` sentinel — the
   * strategies row is NOT created until submit-time. Consumers MUST
   * guard before constructing `/strategies/${strategyId}/...` URLs.
   */
  strategyId: string;
  /** Client-generated UUID for funnel telemetry correlation. */
  wizardSessionId: string;
  /** Current wizard step. */
  step: WizardStepKey;
  /** Epoch millis of the last save. Used for the "N hours ago" banner. */
  savedAt: number;
  /**
   * Phase 15: discriminator for resume-banner branching. Absent ⇒ 'api'
   * (back-compat with v1 payloads written before the CSV branch shipped).
   */
  source?: "api" | "csv";
  /**
   * Phase 15 cross-AI revision 2026-04-30: user-typed strategy name on the
   * CSV branch — preserved across back-navigation and tab refresh. Absent
   * on the API branch (the API path uses a different name-source: the
   * metadata step). Bounded at 80 chars to match the UI input cap.
   */
  strategyName?: string;
}

/** Returns true when running in a browser with localStorage available. */
function hasLocalStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Some browsers throw on access when storage is disabled (Safari private).
    return typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Save the current wizard state. Overwrites any prior state. No-ops
 * during SSR or when localStorage is unavailable.
 */
export function saveWizardState(state: Omit<WizardLocalState, "savedAt">): void {
  if (!hasLocalStorage()) return;
  try {
    const payload: WizardLocalState = { ...state, savedAt: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    // Storage full, Safari private mode, or user-denied. Non-fatal:
    // the server-side draft is still the source of truth.
    console.warn("[wizard] saveWizardState failed:", err);
  }
}

/**
 * Read the current wizard state. Returns `null` when no state is
 * saved, storage is unavailable, or the payload is malformed.
 */
export function loadWizardState(): WizardLocalState | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.strategyId !== "string" ||
      typeof parsed?.wizardSessionId !== "string" ||
      typeof parsed?.step !== "string" ||
      typeof parsed?.savedAt !== "number"
    ) {
      return null;
    }
    const validSteps: readonly WizardStepKey[] = [
      "connect_key",
      "sync_preview",
      "metadata",
      "submit",
      "csv_upload",
      "csv_preview",
      "csv_submit",
    ];
    if (!validSteps.includes(parsed.step as WizardStepKey)) {
      return null;
    }
    // Phase 15: optional `source` discriminator. Absent ⇒ 'api'
    // (back-compat). Anything else is a malformed payload.
    if (
      parsed.source !== undefined &&
      parsed.source !== "api" &&
      parsed.source !== "csv"
    ) {
      return null;
    }
    // Cross-AI revision 2026-04-30: optional `strategyName` must be a
    // string ≤ 80 chars. Absent on the API branch.
    if (parsed.strategyName !== undefined) {
      if (
        typeof parsed.strategyName !== "string" ||
        parsed.strategyName.length > 80
      ) {
        return null;
      }
    }
    return parsed as WizardLocalState;
  } catch {
    return null;
  }
}

/**
 * Resume overrides derived from a localStorage payload. Pure function;
 * never reads window/localStorage. The caller invokes loadWizardState()
 * post-mount and applies these via setState.
 *
 * Hydration safety: WizardClient initializes its useState values to
 * SSR-deterministic defaults (no LS access during render). After mount,
 * a single useEffect calls loadWizardState() and feeds the result here
 * to compute which fields need to flip. SSR HTML matches the first
 * client render exactly; the resumed state arrives on the next paint.
 *
 * Returning an undefined field means "no override for this field" —
 * leave the SSR-default in place.
 */
export interface WizardResumeOverrides {
  step?: WizardStepKey;
  strategyName?: string;
  showResumeBanner?: boolean;
  wizardSessionId?: string;
}

export function deriveWizardResumeOverrides(
  loaded: WizardLocalState | null,
  source: "api" | "csv",
  initialDraftId: string | null,
): WizardResumeOverrides {
  if (!loaded) return {};
  const out: WizardResumeOverrides = {};

  if (loaded.wizardSessionId) {
    out.wizardSessionId = loaded.wizardSessionId;
  }

  // strategyName is CSV-branch only.
  if (loaded.source === "csv" && loaded.strategyName) {
    out.strategyName = loaded.strategyName;
  }

  if (source === "csv") {
    // CSV branch: only restore csv_upload from LS. csv_preview and
    // csv_submit both render conditional on `csvFmt && csvPreview` in
    // WizardClient, and those values are NOT persisted to LS (the
    // parsed dataset can be megabytes — too large for localStorage).
    // Restoring step=csv_preview from LS without the dependent state
    // would leave the user staring at an empty preview body with no
    // recovery path (the bug pinned by the regression test below).
    // Falling through with no override means the SSR-default
    // (csv_upload) stays in place, so the user re-selects the file
    // while their typed strategyName + wizardSessionId carry over.
    if (loaded.source === "csv" && loaded.step === "csv_upload") {
      out.step = loaded.step;
    }
  } else if (initialDraftId && loaded.strategyId === initialDraftId) {
    // API branch: only restore the LS step when the pointer matches the
    // server-side draft. Mismatch ⇒ leave the SSR default ("sync_preview")
    // and surface the resume banner instead.
    out.step = loaded.step;
  }

  if (initialDraftId && loaded.strategyId !== initialDraftId) {
    out.showResumeBanner = true;
  }

  return out;
}

/** Clear the wizard state (called on submit, delete draft, or explicit start fresh). */
export function clearWizardState(): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Human-readable "N hours ago" string for the Resume banner. Returns
 * an empty string when the timestamp is invalid.
 */
export function formatSavedAt(savedAtMs: number): string {
  if (!Number.isFinite(savedAtMs)) return "";
  const diffMs = Date.now() - savedAtMs;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Generate a new wizard_session_id. Uses `crypto.randomUUID()` when
 * available (all modern browsers + Node 19+), falls back to a
 * timestamp-derived UUID-ish string otherwise. The value is opaque
 * to downstream consumers — it is only used for PostHog funnel
 * correlation and client-side tab-isolation debugging.
 */
export function newWizardSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const ts = Date.now().toString(16);
  const rnd = Math.random().toString(16).slice(2);
  return `${ts}-${rnd}`;
}
