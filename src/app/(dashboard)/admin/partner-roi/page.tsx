"use client";

import { useEffect, useId, useState, type ChangeEvent } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";

/**
 * /admin/partner-roi
 *
 * Live revenue simulator for cap-intro meetings. Founder types the partner's
 * allocator count in real time; the "Partner revenue / year" headline counts
 * up smoothly so the partner literally sees the number growing.
 *
 * Pure client-side math — no backend, no DB. This page is an artifact we
 * share the URL of during the meeting.
 */
export default function PartnerRoiPage() {
  const [allocators, setAllocators] = useState(50);
  const [managers, setManagers] = useState(200);
  const [avgTicket, setAvgTicket] = useState(5_000_000);
  const [takeRate, setTakeRate] = useState(15);

  // --- Formula -----------------------------------------------------------
  // 30% of allocators are active in any given month.
  // 40% of those get a successful algorithm match (hit rate).
  const introsPerMonth = allocators * 0.3 * 0.4;
  // 1.5% standard mgmt fee on successfully matched allocations,
  // multiplied by the partner's take of that fee.
  const partnerRevenuePerMonth =
    introsPerMonth * avgTicket * 0.015 * (takeRate / 100);
  const partnerRevenuePerYear = partnerRevenuePerMonth * 12;
  // Sanity-check metric: does the partner have enough managers to serve demand?
  const introsPerManagerPerMonth =
    managers > 0 ? introsPerMonth / managers : 0;

  // Smoothly tween the headline number so the partner sees it GROW as they type.
  const animatedYearly = useAnimatedNumber(partnerRevenuePerYear);

  const isZeroState = partnerRevenuePerYear <= 0;

  return (
    <>
      <PageHeader
        title="Partner ROI simulator"
        description="Rough partnership revenue math. Assumes 30% allocator activity, 40% algorithm hit rate, 1.5% mgmt fee on successfully matched allocations."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* --- INPUT CARD --- */}
        <Card padding="md">
          <h2 className="text-base font-semibold text-text-primary">
            Partner inputs
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Type the partner&apos;s real numbers live in the meeting.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4">
            <NumberField
              label="Allocators"
              value={allocators}
              onChange={setAllocators}
              min={0}
              step={1}
            />
            <NumberField
              label="Managers"
              value={managers}
              onChange={setManagers}
              min={0}
              step={1}
              hint="Sanity check only — doesn't feed the formula directly."
            />
            <NumberField
              label="Avg ticket size (USD)"
              value={avgTicket}
              onChange={setAvgTicket}
              min={0}
              step={500_000}
            />
            <NumberField
              label="Partner take rate (%)"
              value={takeRate}
              onChange={setTakeRate}
              min={0}
              max={100}
              step={1}
            />
          </div>
        </Card>

        {/* --- OUTPUT CARD --- */}
        <Card padding="md">
          <h2 className="text-base font-semibold text-text-primary">
            Projected revenue
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Based on the partner&apos;s inputs and our measured assumptions.
          </p>

          <div className="mt-6 space-y-6">
            <OutputRow
              label="Intros / month"
              value={
                <span className="font-metric tabular-nums text-xl text-text-primary">
                  {introsPerMonth.toFixed(1)}
                </span>
              }
            />

            <OutputRow
              label="Partner revenue / month"
              value={
                <span className="font-metric tabular-nums text-xl text-text-primary">
                  {formatDollars(partnerRevenuePerMonth)}
                </span>
              }
            />

            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                Partner revenue / year
              </p>
              {isZeroState ? (
                <p className="mt-2 text-xl text-text-muted">
                  Enter allocator count to see revenue
                </p>
              ) : (
                <p className="mt-2 font-display text-3xl text-accent tabular-nums">
                  {formatDollars(animatedYearly)}
                </p>
              )}
            </div>

            {managers > 0 && introsPerMonth > 0 && (
              <OutputRow
                label="Intros / manager / month"
                value={
                  <span className="font-metric tabular-nums text-base text-text-secondary">
                    {introsPerManagerPerMonth.toFixed(2)}
                  </span>
                }
                hint="Sanity check — is the partner's manager bench deep enough?"
              />
            )}
          </div>
        </Card>
      </div>

      {/* --- FORMULA CARD --- */}
      <Card padding="md" className="mt-6">
        <h2 className="text-base font-semibold text-text-primary">
          How this is calculated
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Every number on this page comes from these three lines. No magic.
        </p>

        <dl className="mt-5 space-y-4 text-sm text-text-secondary">
          <div>
            <dt className="font-medium text-text-primary">Intros / month</dt>
            <dd className="mt-1">
              <span className="font-metric tabular-nums">
                allocators x 30% (active rate) x 40% (algorithm hit rate)
              </span>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-text-primary">
              Partner revenue / month
            </dt>
            <dd className="mt-1">
              <span className="font-metric tabular-nums">
                intros x avg ticket size x 1.5% mgmt fee x your take rate
              </span>
            </dd>
          </div>
          <div>
            <dt className="font-medium text-text-primary">
              Partner revenue / year
            </dt>
            <dd className="mt-1">
              <span className="font-metric tabular-nums">
                partner revenue / month x 12
              </span>
            </dd>
          </div>
        </dl>

        <p className="mt-5 text-sm text-text-secondary">
          Hit rate assumption: 40% &mdash; tracked in real time via{" "}
          <code className="font-metric tabular-nums text-text-primary">
            /admin/match/eval
          </code>{" "}
          once you ship {String.fromCharCode(8805)}10 intros through the queue.
        </p>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
}: NumberFieldProps) {
  const inputId = useId();

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    if (raw === "") {
      onChange(0);
      return;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-text-secondary mb-1"
      >
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 font-metric tabular-nums text-text-primary focus:border-accent focus:outline-none"
      />
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

interface OutputRowProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

function OutputRow({ label, value, hint }: OutputRowProps) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
        {label}
      </p>
      <div className="mt-1">{value}</div>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hooks + helpers
// ---------------------------------------------------------------------------

/**
 * Tween a number toward a target over `durationMs` using requestAnimationFrame.
 * Keeps the headline counting up (or down) smoothly instead of snapping, so
 * the partner sees the revenue grow in real time as they type.
 */
function useAnimatedNumber(target: number, durationMs = 300): number {
  const [display, setDisplay] = useState(target);

  useEffect(() => {
    const start = display;
    const delta = target - start;
    if (delta === 0) return;

    const startTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + delta * eased);
      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
    // Intentionally depend only on target/duration — `display` is the live
    // value we're tweening from, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, durationMs]);

  return display;
}

function formatDollars(value: number): string {
  const rounded = Math.round(value);
  return `$${rounded.toLocaleString()}`;
}
