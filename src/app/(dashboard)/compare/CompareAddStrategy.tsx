"use client";

/**
 * Phase 197 plan 04 (ROUTE-05, D-04) — the "Add strategy" search on /compare.
 *
 * Reads the same catalogue the allocations browse drawer reads
 * (`GET /api/strategies/browse`: allocator auth, per-user rate limit, names run
 * through `displayStrategyName`). The route also returns the caller's own
 * non-published rows; /compare reads through `withPublishedOnly`, so those are
 * dropped here rather than offered as a column that would never render.
 *
 * States (UI-SPEC Interaction contract 5): the query opens from 2 characters and is
 * debounced 250ms (DESIGN.md medium motion); the catalogue is fetched once per mount;
 * the listbox shows "Searching…", a no-match line, or an inline role="alert" failure
 * with "Try again" (the browse drawer's inline idiom, U-12). No animation.
 *
 * Navigation is `router.push(compareHref(...))` only: the path is fixed and ids
 * are encoded in `compareHref`, so no URL from data ever reaches the router.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { compareHref } from "@/lib/compare-href";
import type { StrategyBrowseRow } from "../allocations/components/StrategyBrowseDrawer";
import type { BrowseResponse } from "@/app/api/strategies/browse/route";

const MIN_QUERY_LENGTH = 2;
const MAX_OPTIONS = 8;
const DEBOUNCE_MS = 250;

export interface CompareAddStrategyProps {
  /** Ids the page renders now (strategy ids and holding refs), in display order. */
  currentIds: readonly string[];
  /** Test seam, the drawer's idiom. Defaults to fetching the browse route. */
  fetchStrategies?: () => Promise<Catalogue>;
}

/**
 * The browse route cuts its alphabetical read at `limit` rows and sets `hasMore`
 * when it did. A search over a cut catalogue cannot claim "no match".
 */
export interface Catalogue {
  rows: StrategyBrowseRow[];
  hasMore: boolean;
  limit: number;
}

async function fetchBrowse(): Promise<Catalogue> {
  const res = await fetch("/api/strategies/browse");
  if (!res.ok) throw new Error(`Failed to load strategies (${res.status})`);
  const json = (await res.json()) as Partial<BrowseResponse>;
  // A 200 without a `strategies` array is a broken response, not an empty
  // catalogue: it must reach the error state, never read as "no match".
  if (!Array.isArray(json.strategies)) {
    throw new Error("Browse response has no strategies array");
  }
  return {
    rows: json.strategies,
    hasMore: json.has_more === true,
    limit: json.limit ?? json.strategies.length,
  };
}

type Load = "idle" | "loading" | "ready" | "error";

export function CompareAddStrategy({
  currentIds,
  fetchStrategies = fetchBrowse,
}: CompareAddStrategyProps) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // `query` is what the field shows; `settled` is the value the listbox answers,
  // updated 250ms after the last keystroke.
  const [query, setQuery] = useState("");
  const [settled, setSettled] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const rows = catalogue?.rows ?? null;
  const [load, setLoad] = useState<Load>("idle");

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function runFetch() {
    setLoad("loading");
    fetchStrategies()
      .then((r) => {
        if (unmountedRef.current) return;
        setCatalogue(r);
        setLoad("ready");
      })
      .catch((e: unknown) => {
        if (unmountedRef.current) return;
        console.error("[CompareAddStrategy] catalogue load failed", e);
        setLoad("error");
      });
  }

  function onChange(value: string) {
    setQuery(value);
    setDismissed(false);
    setActiveIndex(-1);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSettled(value);
      // Once per mount: only an untouched catalogue is fetched; a retry is explicit.
      if (value.trim().length >= MIN_QUERY_LENGTH && load === "idle") runFetch();
    }, DEBOUNCE_MS);
  }

  const trimmed = settled.trim();
  const open = trimmed.length >= MIN_QUERY_LENGTH && !dismissed;

  const options = useMemo(() => {
    if (!open || rows === null) return [];
    const q = trimmed.toLowerCase();
    return rows
      .filter((r) => !(r.isOwn === true && r.status !== "published"))
      .filter((r) => !currentIds.includes(r.id))
      .filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.codename ?? "").toLowerCase().includes(q),
      )
      .slice(0, MAX_OPTIONS);
  }, [rows, open, trimmed, currentIds]);

  const optionId = (i: number) => `${listboxId}-opt-${i}`;

  function choose(id: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    router.push(compareHref([...currentIds, id]));
    setQuery("");
    setSettled("");
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setDismissed(true);
      return;
    }
    if (options.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      choose(options[activeIndex].id);
    }
  }

  const showOptions = open && load === "ready" && options.length > 0;

  return (
    <div className="relative mb-6 w-full max-w-96">
      <Input
        ref={inputRef}
        label="Add strategy"
        role="combobox"
        aria-expanded={showOptions}
        aria-controls={showOptions ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          showOptions && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        placeholder="Search published strategies by name"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-md border border-border bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          {load === "loading" && (
            <p role="status" className="px-3 py-2 text-caption text-text-muted">
              Searching…
            </p>
          )}
          {load === "error" && (
            <div className="px-3 py-2">
              <p role="alert" className="text-caption text-negative">
                Search is not available right now.
              </p>
              <button
                type="button"
                onClick={runFetch}
                className="mt-1 text-caption text-text-muted underline hover:text-text-primary"
              >
                Try again
              </button>
            </div>
          )}
          {load === "ready" && options.length === 0 && (
            <p className="px-3 py-2 text-caption text-text-muted">
              {catalogue?.hasMore
                ? `No match in the first ${catalogue.limit} strategies. Select it in Discovery and compare from there.`
                : `No published strategy matches "${settled.trim()}".`}
            </p>
          )}
          {showOptions && (
            <ul id={listboxId} role="listbox" aria-label="Published strategies">
              {options.map((r, i) => (
                <li
                  key={r.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === activeIndex}
                  onClick={() => choose(r.id)}
                  className={`min-h-11 cursor-pointer px-3 py-2 ${
                    i === activeIndex ? "bg-page" : ""
                  }`}
                >
                  <div className="text-body text-text-primary">{r.name}</div>
                  <div className="text-caption text-text-muted">
                    {r.strategy_types.join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
