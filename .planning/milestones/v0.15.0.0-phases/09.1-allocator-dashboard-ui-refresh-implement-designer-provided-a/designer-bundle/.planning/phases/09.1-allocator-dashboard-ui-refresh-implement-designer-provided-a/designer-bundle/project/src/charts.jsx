// ---------------------------------------------------------------------------
// Charts: Equity curve, sparklines, mini bars
// ---------------------------------------------------------------------------

function EquityChart({ portfolio, bench, style = "area", height = 260, showBench = true, overlays = [] }) {
  const wrapRef = React.useRef(null);
  const [w, setW] = React.useState(800);
  const [hover, setHover] = React.useState(null); // {x, i}

  React.useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => {
      setW(Math.max(400, Math.floor(e[0].contentRect.width)));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const pad = { t: 20, r: 48, b: 28, l: 8 };
  const h = height;
  const chartW = w - pad.l - pad.r;
  const chartH = h - pad.t - pad.b;

  const n = portfolio.length;
  const all = [
    ...portfolio,
    ...(showBench ? bench : []),
    ...overlays.flatMap((o) => o.series || []),
  ];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = max - min || 1;

  const x = (i) => pad.l + (i / (n - 1)) * chartW;
  const y = (v) => pad.t + (1 - (v - min) / range) * chartH;

  const toPath = (arr) => arr.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const toArea = (arr) => toPath(arr) + ` L${x(n - 1).toFixed(2)},${(pad.t + chartH).toFixed(2)} L${x(0).toFixed(2)},${(pad.t + chartH).toFixed(2)} Z`;

  // Gridlines: 4 horizontal
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const yy = pad.t + t * chartH;
    const v = max - t * range;
    return { y: yy, v };
  });

  // X axis: smart tick density based on visible range
  const today = new Date();
  const daySpanMs = 86400000;
  function buildTicks(n) {
    const ticks = [];
    const firstDate = new Date(today.getTime() - (n - 1) * daySpanMs);
    // Long range: month ticks centered on each month's visible mid-point
    if (n > 90) {
      // Find each calendar month that intersects the window
      const start = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 1);
      const cursor = new Date(start);
      while (cursor <= end) {
        const mStart = new Date(cursor);
        const mEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        // Clip to visible window
        const visStart = mStart < firstDate ? firstDate : mStart;
        const visEnd = mEnd > today ? today : mEnd;
        const visDays = (visEnd.getTime() - visStart.getTime()) / daySpanMs;
        // Drop months with too little visible range (edges)
        if (visDays < 7) { cursor.setMonth(cursor.getMonth() + 1); continue; }
        const midMs = (visStart.getTime() + visEnd.getTime()) / 2;
        const idx = Math.round((midMs - firstDate.getTime()) / daySpanMs);
        if (idx >= 0 && idx < n) {
          ticks.push({
            i: idx,
            label: cursor.toLocaleDateString("en-US", { month: "short" }),
          });
        }
        cursor.setMonth(cursor.getMonth() + 1);
      }
      return ticks;
    }
    // Short range: evenly-spaced "MMM D" ticks
    const target = 7;
    const step = Math.max(1, Math.round(n / target));
    for (let i = n - 1; i >= 0; i -= step) {
      const d = new Date(today.getTime() - (n - 1 - i) * daySpanMs);
      ticks.push({ i, label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) });
    }
    return ticks.reverse();
  }
  // Month-boundary minor ticks (last day of each month within window)
  const minorTicks = React.useMemo(() => {
    const out = [];
    const firstDate = new Date(today.getTime() - (n - 1) * daySpanMs);
    // Start at end of first visible month; advance by moving to next month's last day
    let cursor = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0);
    let guard = 0;
    while (cursor <= today && guard++ < 200) {
      const idx = Math.round((cursor.getTime() - firstDate.getTime()) / daySpanMs);
      if (idx > 0 && idx < n - 1) out.push(idx);
      // next month's last day = (year, month+2, 0)
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 2, 0);
    }
    return out;
  }, [n]);

  const monthTicks = buildTicks(n);

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - pad.l) / chartW) * (n - 1));
    if (i >= 0 && i < n) setHover({ i, px });
  }

  const portLast = portfolio[n - 1];
  const benchLast = bench[n - 1];
  const portFirst = portfolio[0];
  const benchFirst = bench[0];
  const portRet = (portLast / portFirst - 1);
  const benchRet = (benchLast / benchFirst - 1);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <svg
        width={w}
        height={h}
        style={{ display: "block", cursor: "crosshair" }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines */}
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={pad.l} x2={w - pad.r} y1={g.y} y2={g.y} stroke="#EEF1F4" strokeWidth="1" />
            <text x={w - pad.r + 6} y={g.y + 3} fontSize="10.5" fill="var(--text-muted)" fontFamily="Geist Mono" style={{ fontVariantNumeric: "tabular-nums" }}>
              {((g.v - 1) * 100).toFixed(1)}%
            </text>
          </g>
        ))}
        {/* x ticks */}
        {monthTicks.map((t, i) => (
          <text key={i} x={x(t.i)} y={h - 10} fontSize="10.5" fill="var(--text-muted)" fontFamily="DM Sans" textAnchor="middle">{t.label}</text>
        ))}

        {/* minor month-boundary ticks */}
        {minorTicks.map((mi) => (
          <line key={mi} x1={x(mi)} x2={x(mi)} y1={pad.t + chartH} y2={pad.t + chartH + 4} stroke="var(--border)" strokeWidth="1" />
        ))}
        <line x1={pad.l} x2={w - pad.r} y1={pad.t + chartH} y2={pad.t + chartH} stroke="var(--border)" strokeWidth="1" />

        {/* benchmark */}
        {showBench && (
          <path d={toPath(bench)} fill="none" stroke="var(--chart-benchmark)" strokeWidth="1.25" strokeDasharray="3 3" />
        )}

        {/* holding overlays */}
        {overlays.map((o) => (
          <path key={o.id} d={toPath(o.series)} fill="none" stroke={o.color} strokeWidth="1.25" strokeOpacity="0.85" />
        ))}

        {/* portfolio */}
        {style === "area" && (
          <>
            <defs>
              <linearGradient id="pgrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#1B6B5A" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#1B6B5A" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={toArea(portfolio)} fill="url(#pgrad)" />
          </>
        )}
        <path d={toPath(portfolio)} fill="none" stroke="var(--chart-strategy)" strokeWidth="1.75" />

        {/* hover line */}
        {hover && (
          <g>
            <line x1={x(hover.i)} x2={x(hover.i)} y1={pad.t} y2={pad.t + chartH} stroke="#94A3B8" strokeWidth="1" strokeDasharray="2 2" />
            <circle cx={x(hover.i)} cy={y(portfolio[hover.i])} r="3.5" fill="var(--chart-strategy)" stroke="#fff" strokeWidth="1.5" />
            {showBench && <circle cx={x(hover.i)} cy={y(bench[hover.i])} r="3" fill="var(--chart-benchmark)" stroke="#fff" strokeWidth="1.5" />}
            {overlays.map((o) => (
              <circle key={o.id} cx={x(hover.i)} cy={y(o.series[hover.i])} r="2.5" fill={o.color} stroke="#fff" strokeWidth="1.25" />
            ))}
          </g>
        )}

        {/* end-of-series labels */}
        <circle cx={x(n - 1)} cy={y(portLast)} r="3" fill="var(--chart-strategy)" />
      </svg>

      {hover && (() => {
        const i = hover.i;
        const d = new Date(today.getTime() - (n - 1 - i) * 86400000);
        const pr = portfolio[i] / portFirst - 1;
        const br = bench[i] / benchFirst - 1;
        const left = Math.min(Math.max(x(i) + 10, 8), w - 220);
        return (
          <div style={{
            position: "absolute", top: 8, left,
            background: "#fff", border: "1px solid var(--border)", borderRadius: 6,
            padding: "8px 10px", fontSize: 12, boxShadow: "var(--shadow-pop)", pointerEvents: "none",
            minWidth: 190,
          }}>
            <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4, fontFamily: "Geist Mono" }}>
              {d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 2, background: "var(--chart-strategy)" }} />
                Portfolio
              </span>
              <span className="font-mono tnum" style={{ color: pr >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 500 }}>
                {pr >= 0 ? "+" : ""}{(pr * 100).toFixed(2)}%
              </span>
            </div>
            {showBench && (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 2, background: "var(--chart-benchmark)", borderTop: "1px dashed var(--chart-benchmark)" }} />
                  BTC
                </span>
                <span className="font-mono tnum" style={{ color: br >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 500 }}>
                  {br >= 0 ? "+" : ""}{(br * 100).toFixed(2)}%
                </span>
              </div>
            )}
            {overlays.map((o) => {
              const or = o.series[i] / o.series[0] - 1;
              return (
                <div key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <span style={{ width: 8, height: 2, background: o.color, flexShrink: 0 }} />
                    {o.label}
                  </span>
                  <span className="font-mono tnum" style={{ color: or >= 0 ? "var(--positive)" : "var(--negative)", fontWeight: 500, fontSize: 11.5 }}>
                    {or >= 0 ? "+" : ""}{(or * 100).toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — tiny inline chart
// ---------------------------------------------------------------------------
function Sparkline({ series, color = "var(--chart-strategy)", w = 80, h = 24 }) {
  if (!series || !series.length) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const n = series.length;
  const x = (i) => (i / (n - 1)) * (w - 2) + 1;
  const y = (v) => h - ((v - min) / range) * (h - 4) - 2;
  const d = series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.25" />
    </svg>
  );
}

// Deterministic sparkline series
function sparkSeries(seed, n = 20, trend = 0) {
  let s = seed;
  const out = [];
  let v = 1;
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280;
    const r = s / 233280;
    v += (r - 0.5) * 0.04 + trend / n;
    out.push(v);
  }
  return out;
}

Object.assign(window, { EquityChart, Sparkline, sparkSeries });
