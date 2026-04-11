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
  | "submit";

export interface WizardLocalState {
  /** The server-side strategies row id for the in-progress draft. */
  strategyId: string;
  /** Client-generated UUID for funnel telemetry correlation. */
  wizardSessionId: string;
  /** Current wizard step. */
  step: WizardStepKey;
  /** Epoch millis of the last save. Used for the "N hours ago" banner. */
  savedAt: number;
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
    ];
    if (!validSteps.includes(parsed.step as WizardStepKey)) {
      return null;
    }
    return parsed as WizardLocalState;
  } catch {
    return null;
  }
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
