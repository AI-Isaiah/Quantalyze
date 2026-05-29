"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { captureToSentry } from "@/lib/sentry-capture";

/**
 * B7 — Cross-Tab / Cross-Version Storage Safety.
 *
 * `useCrossTabStorage` is the single primitive through which client state
 * crosses the `localStorage` boundary. It generalizes — by construction — the
 * hardening that the allocator dashboard-config hook grew piecemeal across the
 * audit-2026-05-07 findings (that hook was retired in B7b; this primitive is
 * now the single home for the pattern):
 *
 *   - version trichotomy (higher → read-only, equal → adopt, lower → reset),
 *   - flush-before-adopt cross-tab sync (the StorageEvent listener),
 *   - prototype-poison key stripping at the parse boundary,
 *   - recovery-flag emission (a sessionStorage breadcrumb a banner can drain),
 *   - debounced persist with a beforeunload / pagehide / unmount final flush,
 *   - SSR-safe hydration.
 *
 * Separation of concerns:
 *   - THIS primitive owns the *mechanics* — the React lifecycle, the
 *     localStorage IO, the cross-tab event wiring, the debounce + flush, the
 *     recovery breadcrumb. None of it is domain-specific.
 *   - A consumer-supplied {@link StorageCodec} owns *parse + validate +
 *     version + serialize*. Simple consumers use {@link versionedObjectCodec}
 *     (zod-validated, version-gated) or {@link rawStringCodec} (scalar values
 *     like a timeframe enum). A complex consumer (the dashboard) supplies its
 *     own codec for per-tile salvage / dedup without re-implementing any of
 *     the mechanics above.
 *
 * A new persistence hook *physically cannot* skip the hardening: routing
 * through this primitive bakes it in. The raw-`localStorage` lint ban (B25)
 * is what forces the remaining ad-hoc sites onto this path.
 */

/** Outcome of decoding a persisted raw string. */
export type DecodeOutcome =
  /** Clean parse — adopt the value and allow writes. */
  | "ok"
  /** Corrupt / version-mismatch / unsalvageable — `value` is the caller's
   *  default; writes are allowed (the default persists on next mutation) and
   *  a recovery breadcrumb is emitted. */
  | "reset"
  /** Forward-compat — a newer build wrote a higher version; `value` is the
   *  user's actual persisted data (NOT the default) but writes are suppressed
   *  so this older tab never down-converts the newer blob. */
  | "readonly";

export interface DecodeResult<T> {
  value: T;
  outcome: DecodeOutcome;
  /**
   * Machine-readable reason for a non-"ok" outcome. The built-in
   * `versionedObjectCodec` emits: "parse_failed", "schema_invalid",
   * "version_mismatch" (reset) and "version_ahead" (readonly); the primitive
   * itself emits "read_failed" when getItem throws. Custom codecs may emit
   * their own (hence the open `string`). Surfaced to the recovery breadcrumb so
   * a banner can route copy. `null`/omitted when outcome === "ok".
   */
  reason?: string | null;
}

/**
 * Owns parse + validate + version (decode) and serialize (encode). MUST be
 * pure and side-effect free — `decode` runs during render (lazy-init form) and
 * on every cross-tab StorageEvent, so a side effect here would fire at render
 * time. The primitive performs all side effects (sessionStorage / Sentry).
 */
export interface StorageCodec<T> {
  /** Decode a raw localStorage string (or `null` when absent). */
  decode(raw: string | null): DecodeResult<T>;
  /** Serialize a value for persistence. */
  encode(value: T): string;
  /**
   * Cross-tab no-op equality. Defaults to `encode(a) === encode(b)`. Provide a
   * cheaper comparison when encode is expensive.
   */
  equals?(a: T, b: T): boolean;
}

/**
 * Hydration strategy:
 *   - "deferred" (default): render the caller's `initial` on the server AND
 *     the first client render, then load from localStorage in a mount effect.
 *     SSR-safe — server HTML and first client render are byte-identical, so
 *     there is no hydration mismatch. Costs one extra render.
 *   - "lazy": read localStorage synchronously in the useState initializer
 *     (server still gets `initial`). No post-mount flash, but the first client
 *     render differs from the server render — only safe for trees that are not
 *     server-rendered with a meaningful value (e.g. a value that never paints
 *     before mount, or a client-only-gated subtree).
 */
export type HydrationStrategy = "deferred" | "lazy";

export interface UseCrossTabStorageOptions<T> {
  /** localStorage key. MUST stay under a prefix registered in
   *  `storage-namespaces.ts` so the sign-out purge still reaches it. */
  key: string;
  /** The value rendered on the server and (for "deferred") before hydration. */
  initial: T;
  codec: StorageCodec<T>;
  /** Cross-tab sync via the storage event. Default `true`. */
  crossTab?: boolean;
  /** Trailing-debounce delay for writes, ms. Default 150. `0` writes
   *  synchronously inside the persist effect. */
  debounceMs?: number;
  /** Hydration strategy. Default "deferred" (SSR-safe). */
  hydration?: HydrationStrategy;
  /** When false, the hook is pure in-memory: no read, no write, no cross-tab
   *  listener. For scoped keys whose scope id isn't ready yet (empty
   *  allocatorId / undefined uid) so we never touch a prefix-only key. Default
   *  true. */
  enabled?: boolean;
  /** sessionStorage key for the recovery breadcrumb. When set, a "reset" /
   *  "readonly" decode writes its `reason` here for a banner to drain. */
  recoveryKey?: string;
  /** Sentry tag for recovery / persist-failure breadcrumbs. Default the key. */
  sentryArea?: string;
}

export interface UseCrossTabStorageReturn<T> {
  value: T;
  /** Functional or direct update. Schedules a debounced write unless readOnly. */
  setValue: (next: T | ((prev: T) => T)) => void;
  /** `removeItem(key)` + cancel any pending write, then set in-memory to
   *  `resetValue` WITHOUT re-persisting it (suppresses the next persist tick). */
  removeStored: (resetValue: T) => void;
  /** Forward-compat: a newer build's blob is loaded; all writes are suppressed. */
  readOnly: boolean;
  /** False until the deferred mount-load completes. Always true for "lazy". */
  isHydrated: boolean;
}

const DEFAULT_DEBOUNCE_MS = 150;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

/**
 * Best-effort write of the recovery breadcrumb. Failure is itself logged (the
 * private-mode contexts that corrupt the read also lock sessionStorage), so a
 * banner-never-appeared report still has a paper trail.
 */
export function setStorageRecoveryFlag(
  recoveryKey: string,
  reason: string,
  sentryArea: string,
): void {
  if (!hasWindow()) return;
  try {
    window.sessionStorage.setItem(recoveryKey, reason);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn(
        "[cross-tab] sessionStorage recovery write failed; breadcrumb lost",
        { recoveryKey, reason },
        err,
      );
    }
    captureToSentry(err ?? new Error("cross-tab recovery write failed"), {
      level: "warning",
      tags: { area: sentryArea, reason: "recovery_write_failed" },
    });
  }
}

/**
 * One-shot drain of a recovery breadcrumb. Returns the reason if one was set
 * during this session and clears it so a banner surfaces once per tab.
 */
export function consumeStorageRecoveryFlag(recoveryKey: string): string | null {
  if (!hasWindow()) return null;
  try {
    const value = window.sessionStorage.getItem(recoveryKey);
    if (!value) return null;
    window.sessionStorage.removeItem(recoveryKey);
    return value;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("[cross-tab] consumeStorageRecoveryFlag failed", err);
    }
    return null;
  }
}

/** Read + decode the key once. Pure except for the localStorage read. */
function readDecoded<T>(
  key: string,
  codec: StorageCodec<T>,
  initial: T,
): DecodeResult<T> {
  if (!hasWindow()) return { value: initial, outcome: "ok", reason: null };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch (err) {
    // Safari private mode / sandboxed iframe can throw on getItem. Treat as a
    // corrupt read so the caller sees defaults + a recovery breadcrumb rather
    // than an unhandled throw.
    if (typeof console !== "undefined") {
      console.warn("[cross-tab] localStorage read threw; using defaults", { key }, err);
    }
    return { value: initial, outcome: "reset", reason: "read_failed" };
  }
  return codec.decode(raw);
}

function valuesEqual<T>(codec: StorageCodec<T>, a: T, b: T): boolean {
  if (codec.equals) return codec.equals(a, b);
  return codec.encode(a) === codec.encode(b);
}

export function useCrossTabStorage<T>(
  options: UseCrossTabStorageOptions<T>,
): UseCrossTabStorageReturn<T> {
  const {
    key,
    initial,
    codec,
    crossTab = true,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    hydration = "deferred",
    recoveryKey,
    sentryArea = key,
    enabled = true,
  } = options;

  // Refs that must stay stable across renders / never trigger re-render.
  const codecRef = useRef(codec);
  codecRef.current = codec;
  const keyRef = useRef(key);
  keyRef.current = key;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // ---- Mount-time decode (shared by lazy + deferred) ---------------------
  // The lazy initializer runs exactly once. For "lazy" hydration it reads
  // localStorage synchronously; for "deferred" it returns `initial` (the
  // localStorage read happens in the mount effect instead). We capture the
  // decode OUTCOME so the recovery breadcrumb + Sentry side effects fire from
  // an effect, never during render.
  const [bootstrap] = useState<{
    value: T;
    readOnly: boolean;
    pending: DecodeResult<T> | null;
  }>(() => {
    if (hydration === "lazy" && enabled) {
      const decoded = readDecoded(keyRef.current, codecRef.current, initial);
      return {
        value: decoded.value,
        readOnly: decoded.outcome === "readonly",
        pending: decoded,
      };
    }
    return { value: initial, readOnly: false, pending: null };
  });

  const [value, setValueState] = useState<T>(bootstrap.value);
  // Disabled hooks have nothing to hydrate; lazy already read at mount.
  const [isHydrated, setIsHydrated] = useState<boolean>(
    !enabled || hydration === "lazy",
  );
  // readOnly is a mount-time invariant — a ref so flipping it never re-renders,
  // mirrored to state only so the return value is reactive on deferred load.
  const readOnlyRef = useRef(bootstrap.readOnly);
  const [readOnly, setReadOnly] = useState<boolean>(bootstrap.readOnly);

  // pendingValueRef always holds the freshest value queued for persistence. It
  // is synced SYNCHRONOUSLY inside setValue (not in the [value] effect) so a
  // beforeunload firing between setState and commit still flushes the user's
  // latest intent (race-free flush — red-team MED conf 8 on the reference hook).
  const pendingValueRef = useRef<T>(bootstrap.value);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persist ONLY value changes that originate from a user mutation (setValue).
  // Hydration (initial → loaded) and cross-tab adoption both change `value` but
  // are observe-without-rewrite — they must never persist. A dirty flag is more
  // robust than a first-render-tick skip: deferred hydration changes `value`
  // post-mount with a fresh object identity, which a tick counter mis-handles.
  const dirtyRef = useRef(false);
  // The {key,value} a pending debounced write targets — BOTH captured when the
  // write is scheduled, NOT read live at flush time. A key flip (a per-allocator
  // hook remounting its key) re-runs hydration, which overwrites the live
  // `pendingValueRef`/keyRef with the NEW scope's value; reading those at flush
  // would write the wrong value to the wrong key, corrupting the new scope
  // (CT-01 / B7A1-03). Snapshotting both here makes the scheduled write immune.
  const pendingWriteRef = useRef<{ key: string; value: T } | null>(null);
  // sentryArea via ref so `persist` is a STABLE callback (deps []). When
  // sentryArea defaults to `key`, a key change would otherwise recreate persist
  // and fire the flush-effect cleanup against the wrong key.
  const sentryAreaRef = useRef(sentryArea);
  sentryAreaRef.current = sentryArea;

  const persist = useCallback((writeKey: string, next: T) => {
    if (!hasWindow()) return;
    try {
      window.localStorage.setItem(writeKey, codecRef.current.encode(next));
    } catch (err) {
      const isQuota =
        err instanceof DOMException && err.name === "QuotaExceededError";
      if (typeof console !== "undefined") {
        console.warn(
          isQuota
            ? "[cross-tab] localStorage write failed (quota exceeded); will not persist"
            : "[cross-tab] localStorage write failed; will not persist",
          { key: writeKey },
          err,
        );
      }
      captureToSentry(err ?? new Error("cross-tab persist failed"), {
        level: "warning",
        tags: { area: sentryAreaRef.current, reason: isQuota ? "persist_quota" : "persist_failed" },
      });
    }
  }, []);

  // Cancel an armed debounce and write its snapshot out NOW. Returns true iff a
  // timer was actually pending — the cross-tab handler uses that to mean "we
  // won the write race, don't adopt the foreign value". Stable (reads refs).
  const flushPending = useCallback((): boolean => {
    if (persistTimerRef.current === null) return false;
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = null;
    const w = pendingWriteRef.current;
    pendingWriteRef.current = null;
    if (w) persist(w.key, w.value);
    return true;
  }, [persist]);

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    if (readOnlyRef.current) return;
    const computed =
      typeof next === "function"
        ? (next as (prev: T) => T)(pendingValueRef.current)
        : next;
    // No-op (updater returned the same reference): do NOT mark dirty. Otherwise
    // dirtyRef stays stuck true (the bailed setState fires no persist tick to
    // clear it) and a later cross-tab adoption re-persists the adopted value,
    // breaking observe-without-rewrite (B7A1-02).
    if (Object.is(computed, pendingValueRef.current)) return;
    pendingValueRef.current = computed;
    dirtyRef.current = true;
    setValueState(computed);
  }, []);

  const removeStored = useCallback((resetValue: T) => {
    if (persistTimerRef.current !== null) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    pendingWriteRef.current = null;
    if (hasWindow()) {
      try {
        window.localStorage.removeItem(keyRef.current);
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn("[cross-tab] removeItem failed", { key: keyRef.current }, err);
        }
      }
    }
    // A remove is observe-without-rewrite: clear any in-flight dirty flag so a
    // pending user mutation doesn't immediately re-persist the just-removed key.
    dirtyRef.current = false;
    pendingValueRef.current = resetValue;
    setValueState(resetValue);
  }, []);

  // ---- Side effects from the mount-time (lazy) decode ---------------------
  // Emit the recovery breadcrumb / Sentry breadcrumb for a non-"ok" lazy
  // decode here (in an effect, once) so render stays pure.
  useEffect(() => {
    const pending = bootstrap.pending;
    if (!pending || pending.outcome === "ok") return;
    // Fail-loud: a reset discarded persisted data — always console.warn (the
    // Sentry breadcrumb below is best-effort and can be lost if transport
    // fails). readonly is a legit forward-compat state, not data loss.
    if (pending.outcome === "reset" && typeof console !== "undefined") {
      console.warn(
        `[cross-tab] storage reset (${pending.reason ?? "?"}); using fallback`,
        { key: keyRef.current },
      );
    }
    if (recoveryKey && pending.reason) {
      setStorageRecoveryFlag(recoveryKey, pending.reason, sentryArea);
    }
    if (pending.reason) {
      captureToSentry(new Error(`cross-tab decode ${pending.outcome}: ${pending.reason}`), {
        level: "warning",
        tags: { area: sentryArea, reason: pending.reason },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Deferred hydration: load from localStorage post-mount -------------
  useEffect(() => {
    if (hydration !== "deferred") return;
    if (!enabled) {
      setIsHydrated(true);
      return;
    }
    const decoded = readDecoded(keyRef.current, codecRef.current, initial);
    if (decoded.outcome !== "ok") {
      if (decoded.outcome === "reset" && typeof console !== "undefined") {
        console.warn(
          `[cross-tab] storage reset (${decoded.reason ?? "?"}); using fallback`,
          { key: keyRef.current },
        );
      }
      if (recoveryKey && decoded.reason) {
        setStorageRecoveryFlag(recoveryKey, decoded.reason, sentryArea);
      }
      if (decoded.reason) {
        captureToSentry(
          new Error(`cross-tab decode ${decoded.outcome}: ${decoded.reason}`),
          { level: "warning", tags: { area: sentryArea, reason: decoded.reason } },
        );
      }
    }
    readOnlyRef.current = decoded.outcome === "readonly";
    pendingValueRef.current = decoded.value;
    // dirtyRef stays false — this load-driven setState is observe-without-write.
    setValueState(decoded.value);
    setReadOnly(readOnlyRef.current);
    setIsHydrated(true);
    // Re-run when the key flips (per-allocator hooks) or enabled toggles
    // (scope id became available).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hydration, enabled]);

  // ---- Debounced persist --------------------------------------------------
  useEffect(() => {
    // Only persist user-originated mutations; hydration / cross-tab adoption
    // leave dirtyRef false (observe-without-rewrite).
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    if (!enabledRef.current || readOnlyRef.current) return;
    // Snapshot key+value NOW (when the mutation rendered). A later schedule
    // overwrites this (coalescing keeps the latest); a key flip + hydration
    // does NOT touch it, so the scheduled write always targets the right scope.
    pendingWriteRef.current = { key: keyRef.current, value: pendingValueRef.current };
    if (debounceMs <= 0) {
      const w = pendingWriteRef.current;
      pendingWriteRef.current = null;
      persist(w.key, w.value);
      return;
    }
    if (persistTimerRef.current !== null) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      const w = pendingWriteRef.current;
      pendingWriteRef.current = null;
      if (w) persist(w.key, w.value);
    }, debounceMs);
  }, [value, debounceMs, persist]);

  // ---- Final flush on unmount / tab close --------------------------------
  // beforeunload is unreliable on iOS Safari / mobile Chrome / bfcache; pagehide
  // covers the swipe-close tab kill. Same handler, both events.
  useEffect(() => {
    function flush() {
      if (readOnlyRef.current) return;
      flushPending();
    }
    if (hasWindow()) {
      window.addEventListener("beforeunload", flush);
      window.addEventListener("pagehide", flush);
    }
    return () => {
      if (hasWindow()) {
        window.removeEventListener("beforeunload", flush);
        window.removeEventListener("pagehide", flush);
      }
      flush();
    };
  }, [flushPending]);

  // ---- Cross-tab sync -----------------------------------------------------
  useEffect(() => {
    if (!crossTab || !enabled || !hasWindow()) return;
    function onStorage(e: StorageEvent) {
      if (e.key !== keyRef.current) return;
      if (e.newValue === null) return; // ignore clears
      if (readOnlyRef.current) return; // a read-only tab is a spectator
      // If this tab has a pending local write, it just won the race: flush it
      // (cementing our value as authoritative) and do NOT adopt the foreign
      // value, which was written before our flush.
      if (flushPending()) return;
      const decoded = codecRef.current.decode(e.newValue);
      // Only adopt a clean, same-version foreign write. A "reset" (corrupt /
      // version-mismatch) or "readonly" (newer build) foreign blob is ignored
      // so we never clobber valid in-memory state with defaults, and never
      // ping-pong defaults back to a tab on a different version.
      if (decoded.outcome !== "ok") return;
      if (valuesEqual(codecRef.current, pendingValueRef.current, decoded.value)) {
        return; // no-op storage event — avoid render thrash
      }
      pendingValueRef.current = decoded.value;
      // Adopting a cross-tab write is observe-without-rewrite: it is already the
      // authoritative persisted value. dirtyRef stays false so we don't re-persist.
      setValueState(decoded.value);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [crossTab, enabled, flushPending]);

  return { value, setValue, removeStored, readOnly, isHydrated };
}
