"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { RequestCallModal } from "@/app/for-quants/RequestCallModal";
import { WizardChrome, WIZARD_STEPS_CSV } from "./WizardChrome";
import { ConnectKeyStep, type ConnectKeySuccess } from "./steps/ConnectKeyStep";
import { SyncPreviewStep, type SyncPreviewSnapshot } from "./steps/SyncPreviewStep";
import { MetadataStep, type MetadataDraft } from "./steps/MetadataStep";
import { SubmitStep } from "./steps/SubmitStep";
import { CsvUploadStep } from "./steps/CsvUploadStep";
import { CsvPreviewStep } from "./steps/CsvPreviewStep";
import { CsvSubmitStep } from "./steps/CsvSubmitStep";
import { WithdrawalWarningStrip } from "./WithdrawalWarningStrip";
import { WizardIpAllowlistHint } from "./WizardIpAllowlistHint";
import {
  clearWizardState,
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

const STEP_INDEX: Record<WizardStepKey, 1 | 2 | 3 | 4> = {
  connect_key: 1,
  sync_preview: 2,
  metadata: 3,
  submit: 4,
  csv_upload: 1,
  csv_preview: 2,
  csv_submit: 3,
};

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

  // Read localStorage once on mount. Three useState initializers below
  // all consume this same snapshot so we don't re-parse JSON three times.
  //
  // Phase-15 IN-05: this is an SSR-safe lazy ref-init pattern. `useState`
  // with a lazy initializer would also run only once but evaluates BEFORE
  // the first render commits, which on SSR (no window) would fall through
  // to the `null` branch and pin the ref to null forever even after
  // hydration. The `if (typeof window !== "undefined" && ref.current ===
  // null)` form runs at every render but the inner block fires at most
  // once — first-client-render seeds the ref; subsequent renders short-
  // circuit on `current === null` returning false.
  const initialLocalStateRef = useRef<ReturnType<typeof loadWizardState>>(null);
  if (typeof window !== "undefined" && initialLocalStateRef.current === null) {
    initialLocalStateRef.current = loadWizardState();
  }
  const loaded = initialLocalStateRef.current;

  // Phase 15 resume guard: when the user lands on ?source=csv with a stored
  // CSV draft (strategyId === '' sentinel), the API resume-redirect path
  // would otherwise treat the empty-string id as a draft mismatch and snap
  // the user back to sync_preview. Skip that redirect for the CSV branch.
  const isCsvBranch = source === "csv" || loaded?.source === "csv";
  const skipApiResumeRedirect =
    isCsvBranch && (!loaded?.strategyId || loaded.strategyId === "");

  const [wizardSessionId] = useState<string>(
    () => loaded?.wizardSessionId ?? newWizardSessionId(),
  );

  const [step, setStep] = useState<WizardStepKey>(() => {
    if (source === "csv") {
      // Resume to a stored CSV sub-step if it matches the branch; else start
      // at the upload step. The strategyId '' sentinel is allowed here.
      if (
        loaded?.source === "csv" &&
        (loaded.step === "csv_upload" ||
          loaded.step === "csv_preview" ||
          loaded.step === "csv_submit")
      ) {
        return loaded.step;
      }
      return "csv_upload";
    }
    if (!initialDraft) return "connect_key";
    if (!skipApiResumeRedirect && loaded?.strategyId === initialDraft.id) {
      return loaded.step;
    }
    return "sync_preview";
  });

  const [strategyId, setStrategyId] = useState<string | null>(
    initialDraft?.id ?? null,
  );
  const [apiKeyId, setApiKeyId] = useState<string | null>(
    initialDraft?.api_key_id ?? null,
  );

  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(
    () => Boolean(initialDraft) && loaded?.strategyId !== initialDraft?.id,
  );

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
          supportedExchanges: initialDraft.supported_exchanges ?? [],
          leverageRange: initialDraft.leverage_range ?? "",
          aum: initialDraft.aum?.toString() ?? "",
          maxCapacity: initialDraft.max_capacity?.toString() ?? "",
        }
      : null,
  );

  // Phase 21 — savedAt was previously initialized to `Date.now()` in
  // the useState lazy initializer. Lazy initializers RUN on both server
  // (SSR) and client first render, so SSR's Date.now() and client's
  // Date.now() resolve to different timestamps. The value is rendered
  // by WizardChrome as `new Date(savedAt).toLocaleTimeString(...)`, so
  // a minute-boundary or locale-format difference between server and
  // client triggers React #418 hydration mismatch. Now: start at null,
  // backfill via useEffect post-mount so SSR and client first render
  // both see `null` and produce identical "Not saved yet" markup.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (initialDraft) setSavedAt(Date.now());
  }, [initialDraft]);
  const [toastKey, setToastKey] = useState(0);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [requestCallOpen, setRequestCallOpen] = useState(false);
  const wizardStartFiredRef = useRef(false);

  // Phase 15 / CSV-01..CSV-02 — CSV-branch state. The user-typed strategy
  // name is restored from localStorage on resume so it survives tab close.
  // csvFmt + csvPreview are NOT persisted (the parsed file is too large for
  // localStorage) — a resumed CSV draft requires the user to re-upload, but
  // the strategy name is preserved.
  const [csvFmt, setCsvFmt] = useState<CsvFmt | null>(null);
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [csvValidationPassed, setCsvValidationPassed] = useState<boolean>(false);
  const [strategyName, setStrategyName] = useState<string>(
    loaded?.source === "csv" ? (loaded?.strategyName ?? "") : "",
  );

  useEffect(() => {
    if (wizardStartFiredRef.current) return;
    wizardStartFiredRef.current = true;
    trackForQuantsEventClient("wizard_start", {
      wizard_session_id: wizardSessionId,
      resume: Boolean(initialDraft),
    });
  }, [wizardSessionId, initialDraft]);

  useEffect(() => {
    trackForQuantsEventClient(`wizard_step_view_${STEP_INDEX[step]}` as const, {
      wizard_session_id: wizardSessionId,
      step,
    });
  }, [step, wizardSessionId]);

  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_OUT") {
          setSessionExpired(true);
          trackForQuantsEventClient("wizard_error", {
            wizard_session_id: wizardSessionId,
            step,
            code: "SESSION_EXPIRED",
          });
        }
      },
    );
    return () => {
      subscription.unsubscribe();
    };
  }, [wizardSessionId, step]);

  const persistPointer = useCallback(
    (nextStep: WizardStepKey, id: string | null) => {
      if (!id) return;
      saveWizardState({
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
      setStep("submit");
      persistPointer("submit", strategyId);
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
      router.push(`/strategies/${finalStrategyId}?wizard_submitted=1`);
      router.refresh();
    },
    [wizardSessionId, router],
  );

  const handleDeleteDraft = useCallback(async () => {
    if (!strategyId) {
      // No server draft yet; just clear local state.
      clearWizardState();
      setStep("connect_key");
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
      if (!res.ok) {
        console.error("[wizard] delete draft failed:", await res.text());
      }
    } catch (err) {
      console.error("[wizard] delete draft threw:", err);
    } finally {
      clearWizardState();
      setStep("connect_key");
      setStrategyId(null);
      setApiKeyId(null);
      setSyncSnapshot(null);
      setMetadataDraft(null);
      setConfirmDelete(false);
    }
  }, [strategyId, wizardSessionId]);

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
          <div className="mb-4 rounded-md border border-border bg-page px-3 py-2 text-xs text-text-secondary">
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
            <p className="text-sm font-medium text-text-primary">
              We saved your progress.
            </p>
            <p className="mt-1 text-xs text-text-muted">
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
                  // Delete the current draft so the next create-with-key can
                  // land without the unique(user, api_key) trigger blocking.
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

            {step === "submit" && strategyId && syncSnapshot && metadataDraft && (
              <SubmitStep
                strategyId={strategyId}
                wizardSessionId={wizardSessionId}
                snapshot={syncSnapshot}
                metadata={metadataDraft}
                onSubmitted={handleSubmitSuccess}
                onBack={() => {
                  setStep("metadata");
                  persistPointer("metadata", strategyId);
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
                onSuccess={(payload) => {
                  setCsvFmt(payload.fmt);
                  setCsvPreview(payload.preview);
                  setCsvValidationPassed(payload.validationPassed);
                  setStrategyName(payload.strategyName);
                  setStep("csv_preview");
                  saveWizardState({
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
                  saveWizardState({
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
                  setStep("csv_submit");
                  saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_submit",
                    source: "csv",
                    strategyName,
                  });
                  setSavedAt(Date.now());
                  setToastKey((k) => k + 1);
                }}
              />
            )}

            {step === "csv_submit" && csvFmt && csvPreview && (
              <CsvSubmitStep
                wizardSessionId={wizardSessionId}
                fmt={csvFmt}
                strategyName={strategyName}
                preview={csvPreview}
                onBack={() => {
                  setStep("csv_preview");
                  saveWizardState({
                    strategyId: "",
                    wizardSessionId,
                    step: "csv_preview",
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
                  router.push(`/strategies/${finalStrategyId}?wizard_submitted=1`);
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
        <p className="text-sm text-text-secondary">
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

