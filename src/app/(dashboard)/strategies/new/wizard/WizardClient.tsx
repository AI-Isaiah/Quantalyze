"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { RequestCallModal } from "@/app/(marketing)/for-quants/RequestCallModal";
import { WizardChrome, WIZARD_STEPS_CSV } from "./WizardChrome";
import { ConnectKeyStep, type ConnectKeySuccess } from "./steps/ConnectKeyStep";
import { SyncPreviewStep, type SyncPreviewSnapshot } from "./steps/SyncPreviewStep";
import { MetadataStep, type MetadataDraft } from "./steps/MetadataStep";
import { canonicalizeExchangeList } from "@/lib/constants";
import { SubmitStep } from "./steps/SubmitStep";
import { ReviewStep } from "./steps/ReviewStep";
import { CsvUploadStep } from "./steps/CsvUploadStep";
import { CsvPreviewStep } from "./steps/CsvPreviewStep";
import { CsvSubmitStep } from "./steps/CsvSubmitStep";
import { WithdrawalWarningStrip } from "./WithdrawalWarningStrip";
import { WizardIpAllowlistHint } from "./WizardIpAllowlistHint";
import {
  clearWizardState,
  deriveWizardResumeOverrides,
  loadWizardState,
  newWizardSessionId,
  saveWizardState,
  type WizardStepKey,
} from "@/lib/wizard/localStorage";
import { trackForQuantsEventClient } from "@/lib/for-quants-analytics";
import type { CtaLocation } from "@/lib/analytics";

/**
 * WizardClient owns the 4-step state machine for /strategies/new/wizard.
 * Source of truth is the server-side `strategies` row; localStorage
 * only stores a pointer so a tab close/reopen can resume.
 */

interface InitialDraft {
  id: string;
  name: string | null;
  description: string | null;
  category_id: string | null;
  strategy_types: string[] | null;
  subtypes: string[] | null;
  markets: string[] | null;
  supported_exchanges: string[] | null;
  leverage_range: string | null;
  aum: number | null;
  max_capacity: number | null;
  api_key_id: string | null;
}

interface WizardClientProps {
  /** Initial draft row from the server (null when no draft exists yet). */
  initialDraft: InitialDraft | null;
}

const STEP_INDEX: Record<WizardStepKey, 1 | 2 | 3 | 4 | 5> = {
  connect_key: 1,
  sync_preview: 2,
  metadata: 3,
  // Phase 53 / APPLY-02: the read-only Review & confirm recap takes ordinal
  // 4 on both branches; Submit shifts 4 → 5 to match. Pure step-indexing /
  // telemetry-ordinal change — the transition logic, autosave, and the
  // finalize POST contract are unchanged.
  review: 4,
  submit: 5,
  csv_upload: 1,
  csv_preview: 2,
  // QA report 2026-05-21 ISSUE-010: CSV branch had 4 steps
  // (Upload → Preview → Profile → Submit). Phase 53 inserts csv_review at
  // ordinal 4 and csv_submit shifts 4 → 5 to match.
  csv_metadata: 3,
  csv_review: 4,
  csv_submit: 5,
};

/**
 * Phase 15 fix: debounce window for the CSV strategy-name autosave (below).
 * Named to match the same-directory `*_MS` timing-constant convention
 * (SyncPreviewStep.tsx: SLOW_HINT_MS, POLL_BACKOFF_MS, …). The autosave test
 * waits 500 ms — comfortably past this window — so keep them consistent.
 */
const NAME_AUTOSAVE_DEBOUNCE_MS = 400;

/** Phase 15 / CSV-01..CSV-02 — preview shape returned by /api/strategies/csv-validate. */
type CsvFmt = "daily_returns" | "daily_nav" | "trades";
interface CsvPreview {
  row_count: number;
  date_range: [string, string];
  columns_detected: string[];
  first_rows: Record<string, unknown>[];
  last_rows: Record<string, unknown>[];
}

export function WizardClient({ initialDraft }: WizardClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Phase 15: ?source=csv branch detection. Default 'api' for back-compat.
  // The query param is read once at mount; tab navigation changes are not
  // supported (the wizard expects a fresh page load on branch switch).
  const source: "api" | "csv" =
    searchParams.get("source") === "csv" ? "csv" : "api";

  // Hydration safety (fix for React #418 on `?source=csv`):
  //
  // localStorage is browser-only. Reading it during render produces a
  // different value on SSR (no window) vs the first client render
  // (window present), and any useState initializer that consumes the
  // result then renders different DOM on the two passes — React aborts
  // hydration and unmounts the tree (the user-visible symptom was the
  // CSV upload form vanishing). The previous `useRef` + conditional
  // assignment pattern hit the same trap.
  //
  // The fix: every useState below initializes from SSR-deterministic
  // inputs (`source`, `initialDraft`) only. The single `useEffect` at
  // the top of the body reads localStorage once after mount and applies
  // any resume overrides via setState, producing one extra paint for
  // resume scenarios. The first-paint markup is identical on SSR and
  // CSR, so React #418 cannot fire.
  const [wizardSessionId, setWizardSessionId] = useState<string>(() =>
    newWizardSessionId(),
  );

  const [step, setStep] = useState<WizardStepKey>(() => {
    if (source === "csv") return "csv_upload";
    if (!initialDraft) return "connect_key";
    return "sync_preview";
  });

  const [strategyId, setStrategyId] = useState<string | null>(
    initialDraft?.id ?? null,
  );
  const [apiKeyId, setApiKeyId] = useState<string | null>(
    initialDraft?.api_key_id ?? null,
  );

  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState<boolean>(false);

  const [syncSnapshot, setSyncSnapshot] = useState<SyncPreviewSnapshot | null>(
    null,
  );
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft | null>(
    initialDraft
      ? {
          name: initialDraft.name ?? null,
          description: initialDraft.description ?? "",
          categoryId: initialDraft.category_id ?? null,
          strategyTypes: initialDraft.strategy_types ?? [],
          subtypes: initialDraft.subtypes ?? [],
          markets: initialDraft.markets ?? [],
          // QA report 2026-05-21 ISSUE-004: create_wizard_strategy seeds
          // strategies.supported_exchanges from api_keys.exchange in
          // lowercase ('bybit'/'okx'/'binance' for check-constraint
          // compliance), but the MetadataStep chip group uses
          // case-sensitive .includes() against EXCHANGES (canonical
          // 'Bybit'/'OKX'/'Binance'). Without normalization the chip
          // appears unselected on resume, the user clicks it, and the
          // array grows to ['bybit', 'Bybit'] — persisted verbatim into
          // strategies.supported_exchanges and surfaced as duplicated
          // copy on the review and admin views.
          supportedExchanges: canonicalizeExchangeList(
            initialDraft.supported_exchanges ?? [],
          ),
          leverageRange: initialDraft.leverage_range ?? "",
          aum: initialDraft.aum?.toString() ?? "",
          maxCapacity: initialDraft.max_capacity?.toString() ?? "",
        }
      : null,
  );

  // savedAt must initialize to null synchronously: the value is rendered
  // by WizardChrome as `new Date(savedAt).toLocaleTimeString(...)`, so a
  // useState lazy initializer that calls Date.now() would resolve to
  // different timestamps on SSR vs client first render and a minute-
  // boundary or locale-format difference would trip React hydration
  // mismatch. Backfill via the hydration effect below instead.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [toastKey, setToastKey] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [requestCallOpen, setRequestCallOpen] = useState(false);
  const wizardStartFiredRef = useRef(false);

  // Phase 15 / CSV-01..CSV-02 — CSV-branch state. The user-typed strategy
  // name is restored from localStorage on resume so it survives tab close.
  // csvFmt + csvPreview are NOT persisted (the parsed file is too large for
  // localStorage) — a resumed CSV draft requires the user to re-upload, but
  // the strategy name is preserved (applied via the hydration effect below).
  const [csvFmt, setCsvFmt] = useState<CsvFmt | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  // Phase 19.1 — parsed daily-return rows from the csv-validate envelope.
  // Held in component state (NOT persisted to localStorage — same reason
  // csvPreview isn't persisted: too large + resume requires re-upload).
  // Forwarded to CsvSubmitStep so the csv-finalize POST body includes
  // `daily_returns_series` for fmt=daily_returns/daily_nav. Without this
  // wiring the route rejects with CSV_INVALID_FORMAT "received 0 rows".
  const [csvDailyReturnsSeries, setCsvDailyReturnsSeries] = useState<
    { date: string; daily_return: number }[] | undefined
  >(undefined);
  const [csvValidationPassed, setCsvValidationPassed] = useState<boolean>(false);
  const [strategyName, setStrategyName] = useState<string>("");
  // QA report 2026-05-21 ISSUE-010: classification metadata captured on
  // the new csv_metadata step. Reused MetadataStep shape — same fields as
  // the API branch's metadataDraft, but populated by the CSV-only user
  // typing instead of detection from synced trades.
  const [csvMetadataDraft, setCsvMetadataDraft] = useState<MetadataDraft | null>(null);

  // Single post-mount localStorage read. Computes resume overrides from
  // the LS payload (if any) and applies them via setState. `hydrated`
  // gates the wizard_start telemetry so the funnel id reflects the
  // resumed wizardSessionId, not the throwaway one from useState init.
  //
  // P473: loadWizardState is async (HMAC verify). Wrap in an inner async
  // IIFE so the useEffect signature stays sync.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadWizardState();
      if (cancelled) return;
      const overrides = deriveWizardResumeOverrides(
        loaded,
        source,
        initialDraft?.id ?? null,
      );
      if (overrides.wizardSessionId) {
        setWizardSessionId(overrides.wizardSessionId);
      }
      if (overrides.step) {
        setStep(overrides.step);
      }
      if (overrides.strategyName !== undefined) {
        setStrategyName(overrides.strategyName);
      }
      if (overrides.showResumeBanner) {
        setShowResumeBanner(true);
      }
      if (initialDraft) {
        setSavedAt(Date.now());
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount. `source` and `initialDraft` come from props/URL
    // and are stable for the lifetime of this component instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (wizardStartFiredRef.current) return;
    wizardStartFiredRef.current = true;
    trackForQuantsEventClient("wizard_start", {
      wizard_session_id: wizardSessionId,
      resume: Boolean(initialDraft),
    });
  }, [hydrated, wizardSessionId, initialDraft]);

  useEffect(() => {
    // Gate on `hydrated` so resumed sessions don't double-fire: without
    // this gate, mount fires step_view with the throwaway wizardSessionId,
    // then the LS-hydration effect updates wizardSessionId (and possibly
    // step), retriggering this effect under the resumed identity. The
    // funnel would see two step_view_N events per resume.
    if (!hydrated) return;
    trackForQuantsEventClient(`wizard_step_view_${STEP_INDEX[step]}` as const, {
      wizard_session_id: wizardSessionId,
      step,
    });
  }, [hydrated, step, wizardSessionId]);

  // F6 (H-0187/M-0238): read `step` through a ref inside the auth listener so
  // the subscription does NOT tear down + re-subscribe on every step
  // transition. The previous `[wizardSessionId, step]` deps churned the
  // supabase-js auth channel on each step, leaving a teardown→resubscribe
  // window in which a token-refresh SIGNED_OUT could fire unheard (the wizard
  // then 401s on finalize and misreports it as KEY_NETWORK_TIMEOUT). The
  // listener now mounts once per wizard_session_id; telemetry still reports the
  // live step via the ref.
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_OUT") {
          setSessionExpired(true);
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step: stepRef.current,
            code: "SESSION_EXPIRED",
          });
        }
      },
    );
    return () => {
      subscription.unsubscribe();
    };
  }, [wizardSessionId]);

  // NEW-C14-11: bfcache restore guard. After the user clicks Submit and the
  // browser navigates away, bfcache may restore the final step with the
  // Submit button still live and localStorage cleared. Re-clicking Submit
  // re-POSTs finalize → CSV path mints a duplicate (NEW-C14-01); API path
  // hits the confusing 22023→403. On bfcache restore, re-run loadWizardState:
  // if no draft pointer is found redirect to /strategies (the submitted
  // strategy is there with its pending badge).
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (!event.persisted) return;
      // Fire-and-forget: check LS for a draft pointer. If absent, the wizard
      // was finalized — route to /strategies to prevent re-submit.
      // FINDING-5: wrap in try/catch so a loadWizardState exception (localStorage
      // access denied in strict browser policy, JSON parse error on corrupted
      // value) doesn't silently swallow and leave the Submit button active.
      // Fail-safe: redirect on throw to prevent the duplicate-submit the guard
      // was added to prevent.
      void (async () => {
        try {
          const loaded = await loadWizardState();
          if (!loaded?.strategyId && !loaded?.wizardSessionId) {
            router.push("/strategies");
          }
        } catch (err) {
          console.error("[wizard] bfcache restore loadWizardState threw:", err);
          // Fail safe: redirect to prevent re-submit of an already-finalized wizard.
          router.push("/strategies");
        }
      })();
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [router]);

  // Phase 15 fix (2026-05-27): autosave the CSV strategy name as the user
  // types so a tab refresh/close BEFORE "Validate and continue" doesn't drop
  // it. Pre-fix the name only reached localStorage inside the csv_upload
  // onSuccess handler (after a successful validate), so a user who typed a
  // name and refreshed lost it — Phase 15 VERIFICATION item #4 ("strategyName
  // pre-populated on refresh"), confirmed failing by /qa. The restore path
  // (deriveWizardResumeOverrides → setStrategyName → CsvUploadStep
  // initialStrategyName backfill) already worked; the gap was purely that
  // nothing was ever saved. Debounced (400ms) to coalesce keystrokes into one
  // signed-envelope write; gated on `hydrated` so the post-mount restore paint
  // doesn't fire a redundant echo write. Updates savedAt (the persistent
  // "Draft saved · HH:MM" label) but intentionally does NOT tick the toast —
  // a "Progress saved" popup on every typing pause would be noise.
  useEffect(() => {
    if (source !== "csv" || step !== "csv_upload" || !hydrated) return;
    if (strategyName.trim().length === 0) return;
    const timer = setTimeout(() => {
      void saveWizardState({
        // "" sentinel: the CSV branch has no server draft until submit —
        // same value the other CSV saveWizardState calls below use.
        strategyId: "",
        wizardSessionId,
        step: "csv_upload",
        source: "csv",
        strategyName,
      });
      setSavedAt(Date.now());
    }, NAME_AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, step, hydrated, strategyName, wizardSessionId]);

  const persistPointer = useCallback(
    (nextStep: WizardStepKey, id: string | null) => {
      if (!id) return;
      // P473: saveWizardState is async (HMAC sign). Fire-and-forget —
      // the optimistic setSavedAt below + the server-side draft as the
      // source of truth mean we don't need to block on persistence.
      void saveWizardState({
        strategyId: id,
        wizardSessionId,
        step: nextStep,
      });
      setSavedAt(Date.now());
      setToastKey((k) => k + 1);
    },
    [wizardSessionId],
  );

  const handleConnectSuccess = useCallback(
    (result: ConnectKeySuccess) => {
      setStrategyId(result.strategyId);
      setApiKeyId(result.apiKeyId);
      setStep("sync_preview");
      persistPointer("sync_preview", result.strategyId);
      trackForQuantsEventClient("wizard_step_complete_1", {
        wizard_session_id: wizardSessionId,
        strategy_id: result.strategyId,
        exchange: result.exchange,
      });
    },
    [wizardSessionId, persistPointer],
  );

  const handleSyncComplete = useCallback(
    (snapshot: SyncPreviewSnapshot) => {
      setSyncSnapshot(snapshot);
      setStep("metadata");
      persistPointer("metadata", strategyId);
      trackForQuantsEventClient("wizard_step_complete_2", {
        wizard_session_id: wizardSessionId,
        strategy_id: strategyId ?? undefined,
        trade_count: snapshot.tradeCount,
      });
    },
    [strategyId, wizardSessionId, persistPointer],
  );

  const handleMetadataComplete = useCallback(
    (draft: MetadataDraft) => {
      setMetadataDraft(draft);
      // Phase 53 / APPLY-02: metadata now advances to the read-only review
      // recap (not straight to submit). The review step's "Create strategy"
      // CTA advances to submit, where the unchanged finalize POST fires.
      setStep("review");
      persistPointer("review", strategyId);
      trackForQuantsEventClient("wizard_step_complete_3", {
        wizard_session_id: wizardSessionId,
        strategy_id: strategyId ?? undefined,
      });
    },
    [strategyId, wizardSessionId, persistPointer],
  );

  const handleSubmitSuccess = useCallback(
    (finalStrategyId: string) => {
      trackForQuantsEventClient("wizard_submit_success", {
        wizard_session_id: wizardSessionId,
        strategy_id: finalStrategyId,
      });
      clearWizardState();
      // Wizard finalize sets status='pending_review'. The public detail
      // page at /strategy/[id] filters status='published' (queries.ts:255)
      // so newly-submitted strategies 404 there. The list at /strategies
      // is what the user actually wants — their just-submitted strategy
      // appears in "My Strategies" with its pending badge. The
      // ?wizard_submitted=1 query param is reserved for a future success
      // toast on that page; harmless if unconsumed.
      void finalStrategyId;
      router.push(`/strategies?wizard_submitted=1`);
      router.refresh();
    },
    [wizardSessionId, router],
  );

  const handleDeleteDraft = useCallback(async () => {
    if (!strategyId) {
      // No server draft yet; just clear local state.
      clearWizardState();
      // NEW-C14-08: regenerate wizardSessionId on clear so the stale
      // idempotency key is never reused (feeds NEW-C14-01 duplicate-submit).
      setWizardSessionId(newWizardSessionId());
      // NEW-C14-08: route CSV branch back to csv_upload, not connect_key
      // (connect_key matches no CSV render case → blank body, reload-only recovery).
      setStep(source === "csv" ? "csv_upload" : "connect_key");
      setStrategyId(null);
      setApiKeyId(null);
      setSyncSnapshot(null);
      setMetadataDraft(null);
      setConfirmDelete(false);
      return;
    }

    trackForQuantsEventClient("wizard_delete_draft", {
      wizard_session_id: wizardSessionId,
      strategy_id: strategyId,
    });

    try {
      const res = await fetch(`/api/strategies/draft/${strategyId}`, {
        method: "DELETE",
      });
      // NEW-C14-08: only reset state on confirmed delete (2xx) or
      // confirmed-never-existed (404). On other errors, leave state intact
      // so the user can retry — the finally block previously reset
      // unconditionally, discarding the pointer to the real server draft.
      if (res.ok || res.status === 404) {
        // 404 after finalize: draft is finalized, route to /strategies.
        if (res.status === 404 && source !== "csv") {
          // A 404 after the wizard was previously on submit step means the
          // draft was finalized in another tab — redirect to the list page.
          clearWizardState();
          setConfirmDelete(false);
          router.push("/strategies");
          return;
        }
        clearWizardState();
        // NEW-C14-08: regenerate wizardSessionId on confirmed delete.
        setWizardSessionId(newWizardSessionId());
        setStep(source === "csv" ? "csv_upload" : "connect_key");
        setStrategyId(null);
        setApiKeyId(null);
        setSyncSnapshot(null);
        setMetadataDraft(null);
        setConfirmDelete(false);
      } else {
        console.error("[wizard] delete draft failed:", res.status, await res.text().catch(() => ""));
        setConfirmDelete(false);
      }
    } catch (err) {
      console.error("[wizard] delete draft threw:", err);
      setConfirmDelete(false);
    }
  }, [strategyId, wizardSessionId, source, router]);

  const handleResume = useCallback(() => {
    if (!initialDraft) return;
    setShowResumeBanner(false);
    // Honor the server-side draft; jump to sync_preview because the key
    // is already there but the sync status may be stale.
    setStep("sync_preview");
    persistPointer("sync_preview", initialDraft.id);
    trackForQuantsEventClient("wizard_resume", {
      wizard_session_id: wizardSessionId,
      strategy_id: initialDraft.id,
    });
  }, [initialDraft, persistPointer, wizardSessionId]);

  const handleStartFresh = useCallback(async () => {
    setShowResumeBanner(false);
    await handleDeleteDraft();
  }, [handleDeleteDraft]);

  const requestCallLocation: CtaLocation =
    `wizard_step_${STEP_INDEX[step]}` as CtaLocation;

  const handleOpenRequestCall = useCallback(() => {
    setRequestCallOpen(true);
    trackForQuantsEventClient("wizard_request_call_click", {
      wizard_session_id: wizardSessionId,
      step,
    });
  }, [wizardSessionId, step]);

  const wizardContext = useMemo(
    () => ({
      draft_strategy_id: strategyId,
      step,
      wizard_session_id: wizardSessionId,
    }),
    [strategyId, step, wizardSessionId],
  );

  return (
    <>
      <WizardChrome
        currentStep={step}
        savedAt={savedAt}
        canDelete={Boolean(strategyId)}
        onDeleteDraft={() => setConfirmDelete(true)}
        onRequestCall={handleOpenRequestCall}
        toastKey={toastKey}
        steps={source === "csv" ? WIZARD_STEPS_CSV : undefined}
        source={source}
      >
        {sessionExpired && (
          <div className="mb-4 rounded-md border border-border bg-page px-3 py-2 text-caption text-text-secondary">
            Your session expired. Your draft is saved.{" "}
            <a
              href="/login?next=/strategies/new/wizard"
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              Sign in again
            </a>{" "}
            to continue.
          </div>
        )}

        {showResumeBanner && initialDraft && (
          <div className="mb-4 rounded-md border border-border bg-white px-4 py-3">
            <p className="text-body font-medium text-text-primary">
              We saved your progress.
            </p>
            <p className="mt-1 text-caption text-text-muted">
              {source === "csv"
                ? "A CSV upload draft from an earlier session is ready. Re-select the file and continue."
                : "A draft from an earlier session is ready. Secrets are never stored in your browser, so you will need to paste your API secret again."}
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleResume} data-testid="wizard-resume">
                Resume draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleStartFresh}
                data-testid="wizard-start-fresh"
              >
                Start fresh
              </Button>
            </div>
          </div>
        )}

        {/* Phase 11 / S5 + S7 — persistent safety strips visible across all
            wizard steps. Mounted in the parent layout (NOT per-step) so the
            warnings cannot drift out of any single step's render path. Two
            single-purpose components rendered adjacently per CONTEXT D-07
            and D-08 — DO NOT merge into a 2-line strip.

            Phase 15 follow-up: both strips are API-path specific (READ ONLY
            key requirement, exchange IP allowlist). The CSV branch has no
            API key + no exchange linkage, so neither strip applies — hide
            both when source === "csv". */}
        {source === "api" && (
          <div className="mb-4">
            <WithdrawalWarningStrip />
            <WizardIpAllowlistHint />
          </div>
        )}

        {source === "api" ? (
          <>
            {step === "connect_key" && (
              <ConnectKeyStep
                wizardSessionId={wizardSessionId}
                onSuccess={handleConnectSuccess}
              />
            )}

            {step === "sync_preview" && strategyId && (
              <SyncPreviewStep
                strategyId={strategyId}
                apiKeyId={apiKeyId}
                wizardSessionId={wizardSessionId}
                onComplete={handleSyncComplete}
                onTryAnotherKey={() => {
                  setStep("connect_key");
                  // Regenerate the idempotency token OPTIMISTICALLY (before the
                  // fire-and-forget delete) so the next create-with-key always
                  // carries a FRESH session and mints a new draft for the new
                  // key. handleDeleteDraft also regenerates it, but only on a
                  // confirmed 2xx/404 (NEW-C14-08) — if the DELETE fails, the old
                  // session id would otherwise persist and the F6 fence would
                  // silently replay the OLD draft + OLD key on resubmit
                  // (red-team LOW-2). Regenerating here closes that window; the
                  // orphaned old draft is reaped by the cleanup-wizard-drafts cron.
                  setWizardSessionId(newWizardSessionId());
                  void handleDeleteDraft();
                  trackForQuantsEventClient("wizard_try_different_key", {
                    wizard_session_id: wizardSessionId,
                  });
                }}
              />
            )}

            {step === "metadata" && strategyId && syncSnapshot && (
              <MetadataStep
                strategyId={strategyId}
                wizardSessionId={wizardSessionId}
                initial={metadataDraft}
                detectedMarkets={syncSnapshot.detectedMarkets}
                detectedExchange={syncSnapshot.exchange}
                onComplete={handleMetadataComplete}
                onBack={() => {
                  setStep("sync_preview");
                  persistPointer("sync_preview", strategyId);
                }}
              />
            )}

            {step === "review" && strategyId && syncSnapshot && metadataDraft && (
              // Phase 53 / APPLY-02 — read-only recap before finalize. Mirrors
              // the submit branch's render guard (deps must exist). Continue
              // advances to submit (where the unchanged POST fires); Edit/Back
              // return to metadata via the existing seam (autosave preserves
              // the draft). No data collection here.
              <ReviewStep
                branch="api"
                strategyName={metadataDraft.name ?? ""}
                metadata={metadataDraft}
                onContinue={() => {
                  setStep("submit");
                  persistPointer("submit", strategyId);
                }}
                onBack={() => {
                  setStep("metadata");
                  persistPointer("metadata", strategyId);
                }}
                onEdit={(owningStep) => {
                  setStep(owningStep);
                  persistPointer(owningStep, strategyId);
                }}
              />
            )}

            {step === "submit" && strategyId && syncSnapshot && metadataDraft && (
              <SubmitStep
                strategyId={strategyId}
                wizardSessionId={wizardSessionId}
                snapshot={syncSnapshot}
                metadata={metadataDraft}
                onSubmitted={handleSubmitSuccess}
                onBack={() => {
                  // Phase 53 / APPLY-02 — Back from submit returns to the
                  // review recap (the step that now precedes submit).
                  setStep("review");
                  persistPointer("review", strategyId);
                }}
              />
            )}
          </>
        ) : (
          // Phase 15 / CSV-01..CSV-02 — ?source=csv branch.
          //
          // CRITICAL (cross-AI revision 2026-04-30 INFO #9): every
          // saveWizardState call below MUST persist BOTH `source: "csv"` AND
          // `strategyName` (the current value). Missing `source: "csv"`
          // defeats the resume guard above (which treats undefined as 'api'
          // for back-compat). Missing `strategyName` makes back-navigation
          // forget the user's typed name. Reviewer should diff the entire
          // CSV branch in one read and confirm: (a) all 4 saveWizardState
          // calls have BOTH discriminator fields, (b) strategyName flows
          // through the 3 step props, (c) the wrapping conditional balanced.
          <>
            {step === "csv_upload" && (
              <CsvUploadStep
                wizardSessionId={wizardSessionId}
                initialStrategyName={strategyName}
                // Phase 15 fix: keep WizardClient's strategyName in sync with
                // every keystroke so the debounced autosave effect above can
                // persist it. The CsvUploadStep clobber-guard (only backfill
                // when its local value is "") prevents the resulting
                // initialStrategyName echo from overwriting in-progress typing.
                onNameChange={setStrategyName}
                onSuccess={(payload) => {
                  setCsvFmt(payload.fmt);
                  setCsvPreview(payload.preview);
                  // Phase 19.1 — capture daily-return rows so CsvSubmitStep
                  // can thread them into the csv-finalize POST body.
                  setCsvDailyReturnsSeries(payload.dailyReturnsSeries);
                  setCsvValidationPassed(payload.validationPassed);
                  setStrategyName(payload.strategyName);
                  setStep("csv_preview");
                  // P473: async HMAC envelope — fire-and-forget.
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_preview",
                    source: "csv",
                    strategyName: payload.strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
              />
            )}

            {step === "csv_preview" && csvFmt && csvPreview && (
              <CsvPreviewStep
                preview={csvPreview}
                fmt={csvFmt}
                strategyName={strategyName}
                validationPassed={csvValidationPassed}
                onBack={() => {
                  setStep("csv_upload");
                  // P473: async HMAC envelope — fire-and-forget.
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_upload",
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
                onContinue={() => {
                  setStep("csv_metadata");
                  // P473: async HMAC envelope — fire-and-forget.
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_metadata",
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
              />
            )}

            {step === "csv_metadata" && csvFmt && csvPreview && (
              // QA report 2026-05-21 ISSUE-010 — CSV strategies were
              // persisting with category_id=null + empty arrays, breaking
              // discovery. Reuses the API-branch MetadataStep with
              // detectedMarkets=[] (no synced trades on the CSV path)
              // and detectedExchange=null (CSV has no broker linkage).
              <MetadataStep
                strategyId=""
                wizardSessionId={wizardSessionId}
                initial={csvMetadataDraft}
                detectedMarkets={[]}
                detectedExchange={null}
                onComplete={(draft) => {
                  setCsvMetadataDraft(draft);
                  // Phase 53 / APPLY-02: advance to the read-only review recap
                  // (not straight to submit). Mirrors the API metadata→review
                  // re-point; autosave + the csv-finalize POST are unchanged.
                  setStep("csv_review");
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_review",
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
                onBack={() => {
                  setStep("csv_preview");
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_preview",
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
              />
            )}

            {step === "csv_review" && csvFmt && csvPreview && csvMetadataDraft && (
              // Phase 53 / APPLY-02 — CSV read-only recap before finalize.
              // Same render-guard deps as csv_submit. Continue advances to
              // csv_submit (where the unchanged csv-finalize POST fires);
              // Edit returns to the owning step via the existing autosave
              // seam. The CSV metric values are the REAL parsed numbers.
              <ReviewStep
                branch="csv"
                strategyName={strategyName}
                csv={{
                  fmt: csvFmt,
                  rowCount: csvPreview.row_count,
                  dateRange: csvPreview.date_range,
                  columnsDetected: csvPreview.columns_detected,
                }}
                metadata={csvMetadataDraft}
                onContinue={() => {
                  setStep("csv_submit");
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_submit",
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
                onBack={() => {
                  setStep("csv_metadata");
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_metadata",
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
                onEdit={(owningStep) => {
                  setStep(owningStep);
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: owningStep,
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
              />
            )}

            {step === "csv_submit" && csvFmt && csvPreview && csvMetadataDraft && (
              <CsvSubmitStep
                wizardSessionId={wizardSessionId}
                fmt={csvFmt}
                strategyName={strategyName}
                preview={csvPreview}
                dailyReturnsSeries={csvDailyReturnsSeries}
                metadata={csvMetadataDraft}
                onBack={() => {
                  // Phase 53 / APPLY-02 — Back from csv_submit returns to the
                  // review recap (the step that now precedes csv_submit).
                  setStep("csv_review");
                  // P473: async HMAC envelope — fire-and-forget.
                  void saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_review",
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
                onSubmitted={(finalStrategyId) => {
                  trackForQuantsEventClient("wizard_submit_success", {
                    wizard_session_id: wizardSessionId,
                    strategy_id: finalStrategyId,
                  });
                  clearWizardState();
                  // Same reasoning as handleSubmitSuccess above: pending_review
                  // strategies aren't visible at /strategy/[id]; the list
                  // page at /strategies is the right landing surface.
                  router.push(`/strategies?wizard_submitted=1`);
                  router.refresh();
                }}
              />
            )}
          </>
        )}
      </WizardChrome>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this draft?"
      >
        <p className="text-body text-text-secondary">
          Your draft and its linked API key will be removed. You will start over
          from step 1.
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteDraft}>
            Delete draft
          </Button>
        </div>
      </Modal>

      <RequestCallModal
        open={requestCallOpen}
        onClose={() => setRequestCallOpen(false)}
        ctaLocation={requestCallLocation}
        wizardContext={wizardContext}
      />
    </>
  );
}

