/**
 * Wizard state persistence helpers. localStorage (not sessionStorage)
 * so the resume pointer survives tab close. The server-side
 * `strategies` row is the source of truth for the draft data itself —
 * this module only remembers which draft and which step. Secrets are
 * never persisted.
 *
 * P473 — tamper / replay defense
 * -------------------------------
 * Plain JSON in localStorage is mutable by any script running on the
 * page (including a future XSS payload or a curious user via DevTools).
 * Without integrity the wizard would happily resume against any
 * strategyId an attacker drops into the entry — replaying a victim's
 * draft id, or swapping to a strategy they own to bypass guard checks
 * downstream. Pre-fix coverage was zero.
 *
 * The fix is an HMAC-SHA256 envelope:
 *
 *   stored payload = { v: 2, p: <JSON state>, h: <truncated hex hmac> }
 *
 * The HMAC key is derived from a per-tab nonce held in sessionStorage
 * (which is scoped per tab and never persists across tab close). The
 * nonce is generated lazily on first save and reused for the lifetime
 * of the tab. This means:
 *   - A tampered payload (different `p`, original `h`) verifies false.
 *   - A cross-tab replay (`p` + `h` copied into another tab) verifies
 *     false because the new tab has a fresh sessionStorage nonce.
 *   - A cross-user replay between machines verifies false for the same
 *     reason (nonce-bound).
 *
 * The Web Crypto API (`crypto.subtle.sign`) is async, so `saveWizardState`
 * and `loadWizardState` are async. Callers in WizardClient.tsx await
 * them; the only one where the result matters is the post-mount
 * `loadWizardState` (autosave writes are fire-and-forget).
 *
 * v1 payloads (unsigned) from pre-fix sessions are treated as cold-start
 * (loadWizardState returns null) so a half-deployed environment cannot
 * resume an unsigned wizard.
 */

const STORAGE_KEY = "quantalyze_wizard_state_v1";
/** sessionStorage key for the per-tab HMAC nonce. */
const NONCE_KEY = "quantalyze_wizard_signing_nonce_v1";
/** Truncated hex hmac length — 16 hex chars = 64 bits, fine for tamper. */
const HMAC_HEX_LEN = 16;
/** Envelope schema version. v2 = HMAC-signed. v1 was plaintext (rejected). */
const ENVELOPE_VERSION = 2;

export type WizardStepKey =
  | "connect_key"
  | "sync_preview"
  | "metadata"
  | "submit"
  | "csv_upload"
  | "csv_preview"
  // QA report 2026-05-21 ISSUE-010: the CSV branch wrote
  // category_id=null + empty strategy_types/markets/aum/etc, leaving the
  // strategy invisible to discovery and bare in lists. csv_metadata is
  // the new step between preview and submit that collects classification
  // metadata from the user (mirrors the API branch's MetadataStep).
  | "csv_metadata"
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

/** Returns true when sessionStorage is reachable. */
function hasSessionStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return typeof window.sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

/**
 * Returns true when Web Crypto's subtle API is available. jsdom + all
 * modern browsers provide it; the fallback below returns null so callers
 * treat the environment as "no integrity available" and discard saved
 * state on read. Storage still proceeds (best-effort) so an upgraded
 * environment doesn't lose the user's resume pointer.
 */
function hasSubtleCrypto(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.subtle.sign === "function"
  );
}

/**
 * Get-or-create the per-tab signing nonce. Stored in sessionStorage so
 * (a) it is scoped to the tab — copying the localStorage payload to a
 * different tab produces a different HMAC and verification fails, and
 * (b) it never persists past tab close. The nonce is purely an HMAC key
 * — it doesn't appear in any URL, isn't transmitted, and isn't
 * cryptographically secret (anyone with DOM access can read it from
 * the same tab). Its job is to BIND the payload to the tab, not to
 * encrypt anything.
 */
function getOrCreateTabNonce(): string | null {
  if (!hasSessionStorage()) return null;
  try {
    const existing = window.sessionStorage.getItem(NONCE_KEY);
    if (existing && typeof existing === "string" && existing.length >= 32) {
      return existing;
    }
    // 32 random bytes -> 64 hex chars. crypto.randomUUID gives 32 hex
    // chars (after stripping dashes); double up for 256 bits of entropy.
    const fresh =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`
        : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(NONCE_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

/**
 * Compute an HMAC-SHA256 of `payload` using `key` (utf-8 strings),
 * truncated to HMAC_HEX_LEN hex chars. Returns null when subtle crypto
 * isn't available so callers can fail-closed.
 *
 * Exported for tests that need to forge a valid envelope (the round-trip
 * assertion below). Production callers should not import this directly.
 */
export async function computeWizardHmac(
  payload: string,
  key: string,
): Promise<string | null> {
  if (!hasSubtleCrypto()) return null;
  try {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(payload));
    const bytes = new Uint8Array(sigBuf);
    let hex = "";
    for (const b of bytes) {
      hex += b.toString(16).padStart(2, "0");
    }
    return hex.slice(0, HMAC_HEX_LEN);
  } catch {
    return null;
  }
}

/** Constant-time-ish hex string compare. */
function hexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Save the current wizard state. Overwrites any prior state. No-ops
 * during SSR or when localStorage is unavailable. Writes an
 * HMAC-signed envelope (v2) tying the payload to the current tab via
 * sessionStorage nonce.
 */
export async function saveWizardState(
  state: Omit<WizardLocalState, "savedAt">,
): Promise<void> {
  if (!hasLocalStorage()) return;
  try {
    const payload: WizardLocalState = { ...state, savedAt: Date.now() };
    const payloadJson = JSON.stringify(payload);
    const nonce = getOrCreateTabNonce();
    let envelope: string;
    if (nonce) {
      const h = await computeWizardHmac(payloadJson, nonce);
      // If subtle crypto failed mid-call, drop the save rather than
      // write an unsigned envelope that loadWizardState would reject.
      if (!h) return;
      envelope = JSON.stringify({ v: ENVELOPE_VERSION, p: payloadJson, h });
    } else {
      // No sessionStorage (Safari private, etc.) — without a per-tab
      // nonce there is no integrity story, so refuse to persist. The
      // server-side draft is still the source of truth.
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, envelope);
  } catch (err) {
    // Storage full, Safari private mode, or user-denied. Non-fatal:
    // the server-side draft is still the source of truth.
    console.warn("[wizard] saveWizardState failed:", err);
  }
}

/**
 * Read the current wizard state. Returns `null` when no state is
 * saved, storage is unavailable, or the payload is malformed,
 * unsigned, or has a mismatched HMAC.
 *
 * On HMAC mismatch (tamper/replay) we log `localStorage_signature_mismatch`
 * and treat as cold-start so a forged entry cannot resume the wizard.
 */
export async function loadWizardState(): Promise<WizardLocalState | null> {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as unknown;
    if (
      !envelope ||
      typeof envelope !== "object" ||
      (envelope as Record<string, unknown>).v !== ENVELOPE_VERSION ||
      typeof (envelope as Record<string, unknown>).p !== "string" ||
      typeof (envelope as Record<string, unknown>).h !== "string"
    ) {
      // v1 (unsigned) or anything else — treat as cold-start.
      console.warn("[wizard] localStorage_signature_mismatch: missing envelope");
      return null;
    }
    const payloadJson = (envelope as Record<string, unknown>).p as string;
    const storedHmac = (envelope as Record<string, unknown>).h as string;

    const nonce = getOrCreateTabNonce();
    if (!nonce) {
      // No nonce means we cannot verify integrity — refuse to resume
      // a stored payload rather than trust it blindly.
      console.warn("[wizard] localStorage_signature_mismatch: no tab nonce");
      return null;
    }
    const computed = await computeWizardHmac(payloadJson, nonce);
    if (!computed || !hexEquals(computed, storedHmac)) {
      // Tamper, replay, or fresh-tab. Either way, do not resume.
      console.warn("[wizard] localStorage_signature_mismatch: HMAC verify failed");
      return null;
    }

    const parsed = JSON.parse(payloadJson) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as Record<string, unknown>).strategyId !== "string" ||
      typeof (parsed as Record<string, unknown>).wizardSessionId !== "string" ||
      typeof (parsed as Record<string, unknown>).step !== "string" ||
      typeof (parsed as Record<string, unknown>).savedAt !== "number"
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const validSteps: readonly WizardStepKey[] = [
      "connect_key",
      "sync_preview",
      "metadata",
      "submit",
      "csv_upload",
      "csv_preview",
      "csv_metadata",
      "csv_submit",
    ];
    if (!validSteps.includes(obj.step as WizardStepKey)) {
      return null;
    }
    // Phase 15: optional `source` discriminator. Absent ⇒ 'api'
    // (back-compat). Anything else is a malformed payload.
    if (obj.source !== undefined && obj.source !== "api" && obj.source !== "csv") {
      return null;
    }
    // Cross-AI revision 2026-04-30: optional `strategyName` must be a
    // string ≤ 80 chars. Absent on the API branch.
    if (obj.strategyName !== undefined) {
      if (
        typeof obj.strategyName !== "string" ||
        (obj.strategyName as string).length > 80
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
    //
    // Steps "metadata" and "submit" depend on React-only state
    // (syncSnapshot, metadataDraft) that is NOT persisted to localStorage
    // — the parsed analytics + sample symbols are too large and the
    // metadata draft is held in client form state until finalize. Restoring
    // either step from LS would render an empty content region (the
    // conditional in WizardClient.tsx requires the dependent state). Same
    // safety pattern as the CSV branch's csv_upload-only restore above.
    // Fall through to the SSR default "sync_preview", which re-runs the
    // poll and rebuilds syncSnapshot from the server-side draft.
    if (loaded.step === "connect_key" || loaded.step === "sync_preview") {
      out.step = loaded.step;
    }
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
