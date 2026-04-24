"use client";

import { useEffect, useState } from "react";
import { QA_MODE } from "@/lib/qa-mode";

/**
 * Phase 09.1 Plan 11 / D-19 — QA-only Tweaks panel.
 *
 * Visibility is gated on the module-scope `QA_MODE` constant from
 * `@/lib/qa-mode` so the gate is testable via `vi.mock("@/lib/qa-mode")`
 * with no `vi.stubEnv` calls. In production the constant is `false` and
 * the component returns `null` before any DOM is rendered.
 *
 * The designer-bundle's cross-window prototype bridge is intentionally
 * stripped per D-19; persistence happens in `localStorage` only. Other
 * presentation knobs (density, accentIntensity, displayFont, chartStyle,
 * showBench, showOutcomes) are wired here as state but the consumers
 * mounting them onto the DOM is a polish follow-up. `bridgeVariant` is
 * the most user-visible knob and flows through `onChange`.
 */

export type TweakState = {
  density: "compact" | "comfortable" | "spacious";
  accentIntensity: "muted" | "default" | "loud";
  displayFont: "sans" | "serif";
  bridgeVariant: "subtle" | "card" | "full";
  chartStyle: "line" | "area";
  showOutcomes: boolean;
  showBench: boolean;
};

const TWEAK_DEFAULTS: TweakState = {
  density: "comfortable",
  accentIntensity: "muted",
  displayFont: "serif",
  bridgeVariant: "full",
  chartStyle: "area",
  showOutcomes: true,
  showBench: true,
};

const STORAGE_KEY = "allocations.tweaks";

function loadTweaks(): TweakState {
  if (typeof window === "undefined") return TWEAK_DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return TWEAK_DEFAULTS;
    const parsed = JSON.parse(raw);
    // Tolerate missing keys: if a user persisted state from an earlier
    // shape with fewer knobs, fill the gaps with TWEAK_DEFAULTS.
    return { ...TWEAK_DEFAULTS, ...parsed };
  } catch {
    // Malformed JSON / Safari private-mode quota / SecurityError —
    // fall back to defaults; never let this take the dashboard down.
    return TWEAK_DEFAULTS;
  }
}

type Props = {
  onChange?: (state: TweakState) => void;
};

// density, accentIntensity, displayFont, chartStyle, showBench, showOutcomes —
// wired as polish follow-up. `bridgeVariant` is propagated via `onChange`.
export function Tweaks({ onChange }: Props) {
  // V3 accepted — QA-mode gate via module-scope constant. Test seam:
  // `vi.mock("@/lib/qa-mode", () => ({ QA_MODE: true }))` flips this to
  // truthy without touching `process.env`.
  if (!QA_MODE) return null;

  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<TweakState>(TWEAK_DEFAULTS);

  // Hydrate from localStorage post-mount (avoids SSR mismatch).
  useEffect(() => {
    setState(loadTweaks());
  }, []);

  // Persist + notify on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Safari private-mode / quota — non-fatal.
    }
    onChange?.(state);
  }, [state, onChange]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Open tweaks panel"
        className="fixed bottom-4 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white shadow-lg"
      >
        ⚙
      </button>
      {isOpen && (
        <div
          role="dialog"
          aria-label="Tweaks"
          className="fixed bottom-16 right-4 z-50 w-[300px] rounded-lg border border-border bg-surface p-4 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Tweaks</div>
            <button
              type="button"
              aria-label="Close tweaks"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </div>

          <TweakSelect
            label="Density"
            value={state.density}
            options={["compact", "comfortable", "spacious"]}
            onChange={(v) =>
              setState((s) => ({ ...s, density: v as TweakState["density"] }))
            }
          />
          <TweakSelect
            label="Accent"
            value={state.accentIntensity}
            options={["muted", "default", "loud"]}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                accentIntensity: v as TweakState["accentIntensity"],
              }))
            }
          />
          <TweakSelect
            label="Font"
            value={state.displayFont}
            options={["sans", "serif"]}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                displayFont: v as TweakState["displayFont"],
              }))
            }
          />
          <TweakSelect
            label="Bridge"
            value={state.bridgeVariant}
            options={["subtle", "card", "full"]}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                bridgeVariant: v as TweakState["bridgeVariant"],
              }))
            }
          />
          <TweakSelect
            label="Chart"
            value={state.chartStyle}
            options={["line", "area"]}
            onChange={(v) =>
              setState((s) => ({
                ...s,
                chartStyle: v as TweakState["chartStyle"],
              }))
            }
          />
          <TweakToggle
            label="Show benchmark"
            checked={state.showBench}
            onChange={(v) => setState((s) => ({ ...s, showBench: v }))}
          />
          <TweakToggle
            label="Show outcomes"
            checked={state.showOutcomes}
            onChange={(v) => setState((s) => ({ ...s, showOutcomes: v }))}
          />

          <button
            type="button"
            onClick={() => setState(TWEAK_DEFAULTS)}
            className="mt-3 text-xs text-accent hover:underline"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </>
  );
}

function TweakSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="my-2 flex items-center justify-between text-xs">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border px-1 py-0.5"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function TweakToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="my-2 flex items-center justify-between text-xs">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
