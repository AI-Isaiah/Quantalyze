"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { TrustTierLabel } from "@/components/strategy/TrustTierLabel";
import { buildEnvelope } from "@/lib/envelope";
import { WizardErrorEnvelope } from "../WizardErrorEnvelope";
import { keyWindowsSchema } from "@/lib/composite/keyWindowsSchema";
import { windowsOverlap } from "@/lib/composite/windowOverlap";
import { ConnectKeyStep, type ConnectKeySuccess } from "./ConnectKeyStep";
import { type WizardErrorCode } from "@/lib/wizardErrors";
import type { SupportedExchange } from "@/lib/utils";

/**
 * Phase 88 / ONB-01 — the multi-key ConnectKeyStep.
 *
 * State A (single-key, default) delegates to the EXISTING ConnectKeyStep,
 * injecting the ONE additive "+ Add another key window" ghost affordance via
 * the `footerSlot` prop — so a user who never clicks it completes onboarding on
 * the byte-identical single-key path (A1 neutrality; the SC-4 regression pin).
 *
 * State B (multi) is an ordered KeyPanel list: per-key credentials, native-date
 * windows, Move ↑/↓ (position-derived seq), remove-with-confirm, per-key
 * validate against composite/add-key, live keyWindowsSchema validation (inline
 * + a step-level buildEnvelope summary — A4), and a Continue that persists
 * members wholesale via composite/set-members then advances.
 *
 * ── DELIBERATE DUPLICATION (flagged for Phase-91 QA) ──────────────────────────
 * The exchange-card grid + credential markup + credential posture below are
 * replicated VERBATIM from ConnectKeyStep (autoComplete="off", secret as
 * type="password" with show/hide, POST-body-only, no browser storage). This is
 * neutrality-over-DRY: State A must stay byte-identical to ConnectKeyStep, which
 * means ConnectKeyStep exports nothing new (footerSlot is its ONLY diff), so the
 * multi-key panels cannot share ConnectKeyStep's private EXCHANGES/markup. The
 * duplication is intentional — Phase-91 QA should verify the two credential
 * surfaces stay in lockstep (labels, placeholders, secret handling).
 */

// ── Credential posture / correlation-id (mirrors ConnectKeyStep verbatim) ─────
function readCorrelationId(): string {
  if (typeof document !== "undefined") {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="x-correlation-id"]',
    );
    const value = meta?.getAttribute("content");
    if (value && value.length > 0) return value;
  }
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function genId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** UTC calendar day — caps the native date pickers so no window is authored
 *  into the future (the zod future-window rule is the loud backstop). */
const TODAY = new Date().toISOString().slice(0, 10);

type ExchangeId = SupportedExchange;

interface ExchangeOption {
  id: ExchangeId;
  name: string;
  caption: string;
  requiresPassphrase: boolean;
  credentialLabels?: { key: string; secret: string };
  credentialPlaceholders?: { key: string; secret: string };
}

// Replicated verbatim from ConnectKeyStep (see DELIBERATE DUPLICATION above).
const EXCHANGES: ExchangeOption[] = [
  {
    id: "binance",
    name: "Binance",
    caption: "Spot + USDⓈ-M Futures + COIN-M Futures supported.",
    requiresPassphrase: false,
  },
  {
    id: "okx",
    name: "OKX",
    caption: "Spot + Perpetuals. Passphrase required.",
    requiresPassphrase: true,
  },
  {
    id: "bybit",
    name: "Bybit",
    caption: "Spot + Linear + Inverse supported.",
    requiresPassphrase: false,
  },
  {
    id: "deribit",
    name: "Deribit",
    caption: "Spot + Inverse Perpetuals + Options supported.",
    requiresPassphrase: false,
    credentialLabels: { key: "Client ID", secret: "Client Secret" },
    credentialPlaceholders: {
      key: "Paste the Deribit Client ID",
      secret: "Paste the Deribit Client Secret",
    },
  },
];

// Replicated verbatim from ConnectKeyStep (step-level permission block).
const TRUST_ATOMS: { title: string; body: string }[] = [
  {
    title: "What we store",
    body: "Your API key and secret are encrypted with AES-256-GCM envelope encryption before they ever hit the database. The KEK lives in Supabase Vault.",
  },
  {
    title: "What we reject",
    body: "Any key with trading or withdrawal scopes is rejected before we store it. Only Read permissions are allowed, enforced at the database level.",
  },
  {
    title: "Who can decrypt",
    body: "Only the Railway analytics service can decrypt the stored ciphertext to fetch your trade history. The web tier has no decryption path.",
  },
  {
    title: "Security contact",
    body: "Questions? security@quantalyze.com responds within one business day.",
  },
];

interface PanelState {
  id: string;
  exchange: ExchangeId;
  nickname: string;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  showSecret: boolean;
  windowStart: string;
  windowEnd: string;
  stillLive: boolean;
  status: "editing" | "validating" | "validated";
  apiKeyId: string | null;
  errorCode: WizardErrorCode | null;
  confirmingRemove: boolean;
}

function newPanel(): PanelState {
  return {
    id: genId(),
    exchange: "binance",
    nickname: "",
    apiKey: "",
    apiSecret: "",
    passphrase: "",
    showSecret: false,
    windowStart: "",
    windowEnd: "",
    stillLive: false,
    status: "editing",
    apiKeyId: null,
    errorCode: null,
    confirmingRemove: false,
  };
}

interface FieldError {
  start?: string;
  end?: string;
}

/**
 * Live validation. The overlap PREDICATE is the ONE shared spec
 * (`windowsOverlap`, bound to window_overlap_convention.json); `keyWindowsSchema`
 * is the authoritative per-key + order validator and the SERVER re-runs it
 * verbatim (88-04). Only panels that carry a `windowStart` participate — an
 * unfilled panel blocks Continue without spraying "required" noise.
 *
 * Returns per-panel inline errors (by panel index) + the step-level summary
 * lines. Per-key errors (end<start, future) are inline-only; overlap is inline
 * on BOTH panels AND a summary line; non-monotone seq is summary-only.
 */
function computeValidation(panels: PanelState[]): {
  fieldErrors: Record<number, FieldError>;
  summaryLines: string[];
} {
  const fieldErrors: Record<number, FieldError> = {};
  const summaryLines: string[] = [];

  const participants: { panelIdx: number }[] = [];
  const keys: {
    api_key_id?: string;
    window_start: string;
    window_end: string | null;
    seq: number;
  }[] = [];
  panels.forEach((p, i) => {
    if (!p.windowStart) return;
    participants.push({ panelIdx: i });
    keys.push({
      api_key_id: p.apiKeyId ?? undefined,
      window_start: p.windowStart,
      window_end: p.stillLive ? null : p.windowEnd || null,
      // Position-derived seq among the participating windows (1-indexed).
      seq: keys.length + 1,
    });
  });

  const setErr = (panelIdx: number, which: "start" | "end", msg: string) => {
    fieldErrors[panelIdx] = { ...(fieldErrors[panelIdx] ?? {}), [which]: msg };
  };

  const parsed = keyWindowsSchema.safeParse({ keys });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const partIdx =
        typeof issue.path[1] === "number" ? (issue.path[1] as number) : -1;
      const field = issue.path[2];
      const panelIdx = participants[partIdx]?.panelIdx ?? -1;
      // Non-monotone seq is summary-only (classified by PATH, not message).
      if (field === "seq") {
        summaryLines.push(issue.message);
        continue;
      }
      // Overlap (classified by the locked copy) is inline on BOTH panels of the
      // pair AND a summary line — the schema emits it on the later window only,
      // so re-run the shared predicate to find the earlier partner.
      if (issue.message.includes("overlapping")) {
        summaryLines.push(issue.message);
        for (let a = 0; a < partIdx; a++) {
          if (windowsOverlap(keys[a], keys[partIdx])) {
            setErr(participants[a].panelIdx, "start", issue.message);
          }
        }
        if (panelIdx >= 0) setErr(panelIdx, "start", issue.message);
        continue;
      }
      // Per-key inline (end<start / future / malformed date), window fields only.
      if (panelIdx >= 0) {
        if (field === "window_end") setErr(panelIdx, "end", issue.message);
        else if (field === "window_start")
          setErr(panelIdx, "start", issue.message);
        else summaryLines.push(issue.message);
      }
    }
  }

  return { fieldErrors, summaryLines: [...new Set(summaryLines)] };
}

export interface MultiKeyConnectStepProps {
  wizardSessionId: string;
  onSuccess: (result: ConnectKeySuccess) => void;
}

export function MultiKeyConnectStep({
  wizardSessionId,
  onSuccess,
}: MultiKeyConnectStepProps) {
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [panels, setPanels] = useState<PanelState[]>([]);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<WizardErrorCode | null>(
    null,
  );
  const [correlationId] = useState<string>(() => readCorrelationId());

  // Latest-panels ref for reads inside event handlers (validate / continue /
  // add) that must see current state without re-binding callbacks. Synced in an
  // effect (never written during render).
  const panelsRef = useRef(panels);
  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);
  const focusRef = useRef<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  const registerCardRef = useCallback(
    (id: string, el: HTMLButtonElement | null) => {
      cardRefs.current.set(id, el);
    },
    [],
  );

  // Focus the first control of a freshly-added panel (DESIGN-05 focus rule at
  // panel granularity). Guarded by focusRef so it fires only after add.
  useEffect(() => {
    if (focusRef.current) {
      cardRefs.current.get(focusRef.current)?.focus();
      focusRef.current = null;
    }
  });

  const enterMulti = useCallback(() => {
    const p1 = newPanel();
    const p2 = newPanel();
    focusRef.current = p2.id;
    setPanels([p1, p2]);
    setMode("multi");
    setAnnouncement("Key 2 added");
  }, []);

  const addPanel = useCallback(() => {
    const np = newPanel();
    focusRef.current = np.id;
    setAnnouncement(`Key ${panelsRef.current.length + 1} added`);
    setPanels((prev) => [...prev, np]);
  }, []);

  const updatePanel = useCallback(
    (idx: number, patch: Partial<PanelState>) => {
      setPanels((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
      );
    },
    [],
  );

  const move = useCallback((idx: number, dir: -1 | 1) => {
    setPanels((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  }, []);

  const doRemove = useCallback((idx: number) => {
    setAnnouncement(`Key ${idx + 1} removed`);
    setPanels((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const requestRemove = useCallback(
    (idx: number) => {
      const p = panelsRef.current[idx];
      const hasEnteredCreds =
        !!p.apiKey ||
        !!p.apiSecret ||
        !!p.passphrase ||
        p.status !== "editing";
      if (!hasEnteredCreds) {
        doRemove(idx);
        return;
      }
      updatePanel(idx, { confirmingRemove: true });
    },
    [doRemove, updatePanel],
  );

  const cancelRemove = useCallback(
    (idx: number) => updatePanel(idx, { confirmingRemove: false }),
    [updatePanel],
  );

  const validatePanel = useCallback(
    async (idx: number) => {
      const p = panelsRef.current[idx];
      if (p.status === "validating") return;
      const requiresPassphrase =
        EXCHANGES.find((e) => e.id === p.exchange)?.requiresPassphrase ?? false;
      updatePanel(idx, { status: "validating", errorCode: null });
      try {
        const res = await fetch("/api/strategies/composite/add-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            exchange: p.exchange,
            api_key: p.apiKey,
            api_secret: p.apiSecret,
            passphrase: requiresPassphrase ? p.passphrase : null,
            label: p.nickname.trim() || `${p.exchange} key`,
            wizard_session_id: wizardSessionId,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          strategy_id?: string;
          api_key_id?: string;
          code?: string;
        };
        if (!res.ok || !data.ok || !data.strategy_id || !data.api_key_id) {
          const code = (data.code as WizardErrorCode | undefined) ?? "UNKNOWN";
          updatePanel(idx, { status: "editing", errorCode: code });
          return;
        }
        setStrategyId(data.strategy_id);
        updatePanel(idx, {
          status: "validated",
          apiKeyId: data.api_key_id,
          errorCode: null,
          confirmingRemove: false,
        });
      } catch (err) {
        updatePanel(idx, {
          status: "editing",
          errorCode: "KEY_NETWORK_TIMEOUT",
        });
        // Logs only `err`, never credential fields (T-88-18).
        console.error("[wizard:MultiKeyConnectStep] add-key threw:", err);
      }
    },
    [updatePanel, wizardSessionId],
  );

  const { fieldErrors, summaryLines } = useMemo(
    () => computeValidation(panels),
    [panels],
  );

  const allValidated =
    panels.length > 0 &&
    panels.every((p) => p.status === "validated" && !!p.windowStart);
  const hasBlockingError =
    summaryLines.length > 0 || Object.keys(fieldErrors).length > 0;
  const canContinue = allValidated && !hasBlockingError && !continuing;

  const summaryEnvelope =
    summaryLines.length > 0
      ? {
          // Route the summary through buildEnvelope (A4); the human_message
          // (interpolated title) comes from wizardErrors. The bulleted list is
          // the live per-issue field messages from keyWindowsSchema.
          ...buildEnvelope("MULTI_KEY_WINDOWS_INVALID", correlationId, {
            issueCount: summaryLines.length,
          }),
          debug_context: summaryLines,
        }
      : null;

  const continueErrorEnvelope = continueError
    ? buildEnvelope(continueError, correlationId)
    : null;

  const handleContinue = useCallback(async () => {
    const current = panelsRef.current;
    if (continuing || !strategyId) return;
    setContinuing(true);
    setContinueError(null);
    try {
      const keys = current.map((p, i) => ({
        api_key_id: p.apiKeyId,
        window_start: p.windowStart,
        window_end: p.stillLive ? null : p.windowEnd || null,
        seq: i + 1,
      }));
      const res = await fetch("/api/strategies/composite/set-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategy_id: strategyId, keys }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
      };
      if (!res.ok || !data.ok) {
        setContinueError((data.code as WizardErrorCode | undefined) ?? "UNKNOWN");
        setContinuing(false);
        return;
      }
      const first = current[0];
      onSuccess({
        strategyId,
        apiKeyId: first.apiKeyId ?? "",
        exchange: first.exchange,
      });
    } catch (err) {
      setContinueError("KEY_NETWORK_TIMEOUT");
      setContinuing(false);
      console.error("[wizard:MultiKeyConnectStep] set-members threw:", err);
    }
  }, [continuing, strategyId, onSuccess]);

  // ── State A: byte-identical ConnectKeyStep + the ONE ghost affordance ───────
  if (mode === "single") {
    return (
      <ConnectKeyStep
        wizardSessionId={wizardSessionId}
        onSuccess={onSuccess}
        footerSlot={
          <Button
            type="button"
            variant="ghost"
            data-testid="multi-add-key"
            onClick={enterMulti}
          >
            + Add another key window
          </Button>
        }
      />
    );
  }

  // ── State B: ordered KeyPanel list ──────────────────────────────────────────
  return (
    <section aria-labelledby="wizard-connect-key-heading">
      <h2
        id="wizard-connect-key-heading"
        className="font-sans text-h3 font-semibold text-text-primary"
      >
        Connect your exchange
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        Paste a read-only API key. We validate scopes server-side before storing
        anything. Secrets are never persisted to your browser.
      </p>

      {/* Step-level permission block — rendered ONCE, not per key. */}
      <div className="mt-6 rounded-md border border-border bg-page">
        <dl className="divide-y divide-border">
          {TRUST_ATOMS.map((atom) => (
            <div
              key={atom.title}
              className="grid gap-1 px-4 py-3 md:grid-cols-[180px_1fr] md:gap-6"
            >
              <dt className="text-caption font-medium text-text-primary">
                {atom.title}
              </dt>
              <dd className="text-caption text-text-secondary">{atom.body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ol className="mt-8 space-y-6" data-testid="multi-key-list">
        {panels.map((panel, i) => (
          <KeyPanel
            key={panel.id}
            panel={panel}
            index={i}
            total={panels.length}
            fieldError={fieldErrors[i]}
            correlationId={correlationId}
            registerCardRef={registerCardRef}
            onUpdate={updatePanel}
            onValidate={validatePanel}
            onMove={move}
            onRequestRemove={requestRemove}
            onConfirmRemove={doRemove}
            onCancelRemove={cancelRemove}
          />
        ))}
      </ol>

      {summaryEnvelope && (
        <div id="multi-key-validation-summary" className="mt-6" data-testid="multi-key-validation-summary">
          <WizardErrorEnvelope envelope={summaryEnvelope} />
        </div>
      )}

      {continueErrorEnvelope && (
        <div className="mt-6">
          <WizardErrorEnvelope
            envelope={continueErrorEnvelope}
            onRetry={() => setContinueError(null)}
          />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          data-testid="multi-add-key"
          onClick={addPanel}
        >
          + Add another key window
        </Button>
        <Button
          type="button"
          data-testid="multi-continue"
          disabled={!canContinue}
          aria-describedby={
            summaryEnvelope ? "multi-key-validation-summary" : undefined
          }
          onClick={handleContinue}
        >
          Continue
        </Button>
      </div>

      <p className="pt-2 text-caption text-text-muted">
        Don&apos;t have an API key yet?{" "}
        <Link
          href="/strategies/new/wizard?source=csv"
          className="font-medium text-accent underline-offset-4 hover:underline"
          data-testid="wizard-csv-branch-link"
        >
          Upload a CSV track record instead →
        </Link>
      </p>

      <div
        role="status"
        aria-live="polite"
        className="sr-only"
        data-testid="multi-key-announce"
      >
        {announcement}
      </div>
    </section>
  );
}

interface KeyPanelProps {
  panel: PanelState;
  index: number;
  total: number;
  fieldError?: FieldError;
  correlationId: string;
  registerCardRef: (id: string, el: HTMLButtonElement | null) => void;
  onUpdate: (idx: number, patch: Partial<PanelState>) => void;
  onValidate: (idx: number) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
  onRequestRemove: (idx: number) => void;
  onConfirmRemove: (idx: number) => void;
  onCancelRemove: (idx: number) => void;
}

const CONTROL_CLASS =
  "inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md border border-border text-text-secondary transition-colors hover:bg-page disabled:opacity-50 disabled:pointer-events-none";

function KeyPanel({
  panel: p,
  index,
  total,
  fieldError,
  correlationId,
  registerCardRef,
  onUpdate,
  onValidate,
  onMove,
  onRequestRemove,
  onConfirmRemove,
  onCancelRemove,
}: KeyPanelProps) {
  const active = EXCHANGES.find((e) => e.id === p.exchange);
  const requiresPassphrase = active?.requiresPassphrase ?? false;
  const keyLabel = active?.credentialLabels?.key ?? "API Key";
  const secretLabel = active?.credentialLabels?.secret ?? "API Secret";
  const keyPlaceholder =
    active?.credentialPlaceholders?.key ?? "Paste the read-only key";
  const secretPlaceholder =
    active?.credentialPlaceholders?.secret ?? "Paste the secret";
  const secretInputId = `key-${index}-api-secret-input`;
  const windowEndId = `key-${index}-window-end`;

  const errorEnvelope = p.errorCode
    ? buildEnvelope(p.errorCode, correlationId)
    : null;

  const canValidate =
    !!p.apiKey &&
    !!p.apiSecret &&
    (!requiresPassphrase || !!p.passphrase) &&
    !!p.windowStart &&
    p.status !== "validating";

  return (
    <li>
      <fieldset
        data-testid={`key-panel-${index}`}
        data-panel={index + 1}
        className="rounded-md border border-border bg-white px-4 py-3"
      >
        <legend className="font-metric text-micro uppercase tracking-wider tabular-nums text-text-secondary">
          Key {index + 1} / {total}
        </legend>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            aria-label={`Move key ${index + 1} earlier`}
            aria-disabled={index === 0}
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
            data-testid={`key-${index}-move-up`}
            className={CONTROL_CLASS}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move key ${index + 1} later`}
            aria-disabled={index === total - 1}
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
            data-testid={`key-${index}-move-down`}
            className={CONTROL_CLASS}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label={`Remove key ${index + 1}`}
            onClick={() => onRequestRemove(index)}
            data-testid={`key-${index}-remove`}
            className={`${CONTROL_CLASS} px-3`}
          >
            Remove
          </button>
        </div>

        {p.confirmingRemove && (
          <div className="mt-3 rounded-md border border-negative/30 bg-negative/5 px-4 py-3">
            <p className="text-caption text-text-primary">
              Remove Key {index + 1}? The credentials you entered for it will be
              cleared.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-testid={`key-${index}-remove-confirm`}
                onClick={() => onConfirmRemove(index)}
              >
                Remove
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onCancelRemove(index)}
              >
                Keep
              </Button>
            </div>
          </div>
        )}

        {p.status === "validated" ? (
          <div
            className="mt-3 flex flex-wrap items-center gap-2"
            data-testid={`key-${index}-summary`}
          >
            <span className="text-body text-text-primary">{active?.name}</span>
            <span className="text-text-muted">·</span>
            <span className="text-caption text-text-secondary">
              {p.nickname.trim() || `${p.exchange} key`}
            </span>
            <span className="text-text-muted">·</span>
            <span className="font-metric text-caption tabular-nums text-text-secondary">
              {p.windowStart} – {p.stillLive || !p.windowEnd ? "live" : p.windowEnd}
            </span>
            <TrustTierLabel trustTier="api_verified" />
          </div>
        ) : (
          <>
            <fieldset className="mt-3">
              <legend className="text-caption font-medium text-text-primary">
                Exchange
              </legend>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                {EXCHANGES.map((ex, exIdx) => {
                  const isActive = ex.id === p.exchange;
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      ref={
                        exIdx === 0
                          ? (el) => registerCardRef(p.id, el)
                          : undefined
                      }
                      onClick={() =>
                        onUpdate(index, { exchange: ex.id, errorCode: null })
                      }
                      className={`rounded-md border px-4 py-3 text-left transition-colors ${
                        isActive
                          ? "border-accent bg-accent/5"
                          : "border-border bg-white hover:border-accent/50"
                      }`}
                      aria-pressed={isActive}
                      data-testid={`key-${index}-exchange-${ex.id}`}
                    >
                      <p className="text-body font-semibold text-text-primary">
                        {ex.name}
                      </p>
                      <p className="mt-1 text-micro text-text-secondary">
                        {ex.caption}
                      </p>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-5 space-y-5">
              <Input
                label={keyLabel}
                value={p.apiKey}
                onChange={(e) => onUpdate(index, { apiKey: e.target.value })}
                placeholder={keyPlaceholder}
                autoComplete="off"
                data-testid={`key-${index}-api-key`}
              />

              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={secretInputId}
                    className="text-caption font-medium text-text-primary"
                  >
                    {secretLabel}
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdate(index, { showSecret: !p.showSecret })
                    }
                    className="text-micro text-text-muted underline-offset-4 hover:text-text-primary hover:underline"
                  >
                    {p.showSecret ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  id={secretInputId}
                  type={p.showSecret ? "text" : "password"}
                  value={p.apiSecret}
                  onChange={(e) =>
                    onUpdate(index, { apiSecret: e.target.value })
                  }
                  placeholder={secretPlaceholder}
                  autoComplete="off"
                  data-testid={`key-${index}-api-secret`}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-body text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>

              {requiresPassphrase && (
                <div>
                  <Input
                    label="OKX Passphrase"
                    type={p.showSecret ? "text" : "password"}
                    value={p.passphrase}
                    onChange={(e) =>
                      onUpdate(index, { passphrase: e.target.value })
                    }
                    placeholder="Paste the OKX passphrase"
                    autoComplete="off"
                    data-testid={`key-${index}-passphrase`}
                  />
                  <p className="mt-1 text-micro text-text-muted">
                    OKX requires a passphrase in addition to key and secret. You
                    set this when you created the API key on OKX.
                  </p>
                </div>
              )}

              <Input
                label="Key nickname (optional)"
                value={p.nickname}
                onChange={(e) => onUpdate(index, { nickname: e.target.value })}
                placeholder={`e.g. ${p.exchange} · prod`}
                autoComplete="off"
                data-testid={`key-${index}-nickname`}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  type="date"
                  label="Active from"
                  value={p.windowStart}
                  max={TODAY}
                  onChange={(e) =>
                    onUpdate(index, { windowStart: e.target.value })
                  }
                  error={fieldError?.start}
                  data-testid={`key-${index}-window-start`}
                />
                <div>
                  <Input
                    id={windowEndId}
                    type="date"
                    label="Active until"
                    value={p.windowEnd}
                    max={TODAY}
                    disabled={p.stillLive}
                    onChange={(e) =>
                      onUpdate(index, { windowEnd: e.target.value })
                    }
                    error={fieldError?.end}
                    data-testid={`key-${index}-window-end`}
                  />
                  <label className="mt-1 flex items-center gap-2 text-micro text-text-muted">
                    <input
                      type="checkbox"
                      checked={p.stillLive}
                      onChange={(e) =>
                        onUpdate(index, {
                          stillLive: e.target.checked,
                          windowEnd: e.target.checked ? "" : p.windowEnd,
                        })
                      }
                      aria-controls={windowEndId}
                      data-testid={`key-${index}-still-live`}
                    />
                    Still live — no end date
                  </label>
                </div>
              </div>

              <p className="text-micro text-text-muted">
                Each key covers a date range of this strategy&apos;s track
                record. Ranges may not overlap.
              </p>
            </div>
          </>
        )}

        {/* Overlap notes stay visible on collapsed (validated) panels so a
            cross-key error is loud on BOTH offending rows. */}
        {p.status === "validated" && fieldError?.start && (
          <p
            className="mt-2 text-caption text-negative"
            data-testid={`key-${index}-window-error`}
          >
            {fieldError.start}
          </p>
        )}
        {/* Editing panels carry the overlap note on their start-field error via
            the Input `error` prop; mirror it under a stable testid too. */}
        {p.status !== "validated" && fieldError?.start && (
          <p
            className="sr-only"
            data-testid={`key-${index}-window-error`}
          >
            {fieldError.start}
          </p>
        )}

        {errorEnvelope && (
          <div className="mt-3">
            <WizardErrorEnvelope
              envelope={errorEnvelope}
              onRetry={() => onUpdate(index, { errorCode: null })}
            />
          </div>
        )}

        {p.status !== "validated" && (
          <div className="mt-5">
            <Button
              type="button"
              data-testid={`key-${index}-validate`}
              disabled={!canValidate}
              onClick={() => onValidate(index)}
            >
              {p.status === "validating" ? "Validating..." : "Validate & add key"}
            </Button>
          </div>
        )}
      </fieldset>
    </li>
  );
}
