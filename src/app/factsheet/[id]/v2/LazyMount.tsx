"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Defers mounting until the placeholder enters the viewport. Saves the
 * initial chart-engine boot for off-screen panels (signatures + cross-
 * signatures + allocator section) which would otherwise build 8-16 SVGs
 * eagerly on first paint.
 *
 * Reserves the placeholder height via `style.minHeight` so the page layout
 * doesn't jump as content arrives. Once mounted, the LazyMount becomes
 * permanent — we don't re-tear-down to avoid the cascade of expensive
 * recomputes that pan/zoom would trigger.
 */
export function LazyMount({
  minHeight = 400,
  rootMargin = "400px",
  children,
}: {
  minHeight?: number;
  rootMargin?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // IntersectionObserver subscription — setState fires from the observer
  // callback (external system event), which is the documented exception to
  // the "no setState in effects" rule.
  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el) return;
    // SSR / no-IntersectionObserver fallback: mount immediately so the page
    // remains functional. We trade the perf win for correctness.
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      return;
    }
    const obs = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setMounted(true);
            obs.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [mounted, rootMargin]);

  return (
    <div ref={ref} style={mounted ? undefined : { minHeight }}>
      {mounted ? children : null}
    </div>
  );
}
