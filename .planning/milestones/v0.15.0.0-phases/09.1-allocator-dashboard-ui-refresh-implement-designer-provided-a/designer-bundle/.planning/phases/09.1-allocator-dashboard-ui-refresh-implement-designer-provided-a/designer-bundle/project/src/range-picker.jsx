// Date range picker popover — dual month calendars, presets, Apply/Cancel.
// Uses a fixed "today" (2026-04-22) derived from series length so it stays
// aligned with the mocked data instead of drifting on real clock time.

function CustomRangePicker({ current, onApply, onClose }) {
  // Anchor "today" to app's notion of now. Series is last 180 days inclusive
  // with today at the end of the window.
  const TODAY = React.useMemo(() => {
    const d = new Date(2026, 3, 22); // April 22, 2026
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const EARLIEST = React.useMemo(() => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - 179);
    return d;
  }, [TODAY]);

  const fmt = (d) => {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  };
  const parse = (s) => {
    if (!s) return null;
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const defaultEnd = current?.end ? parse(current.end) : TODAY;
  const defaultStart = current?.start ? parse(current.start) : (() => {
    const d = new Date(TODAY);
    d.setDate(d.getDate() - 89);
    return d;
  })();

  const [start, setStart] = React.useState(defaultStart);
  const [end, setEnd] = React.useState(defaultEnd);
  const [hover, setHover] = React.useState(null);
  const [pickMode, setPickMode] = React.useState("start"); // which endpoint next click sets
  // Left month shown; right month is left+1
  const [viewMonth, setViewMonth] = React.useState(() => {
    const d = new Date(defaultStart);
    d.setDate(1);
    return d;
  });

  const popRef = React.useRef(null);
  React.useEffect(() => {
    const onDoc = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    // Delay so the opening click doesn't immediately close it
    const t = setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
      document.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const clickDay = (d) => {
    if (d < EARLIEST || d > TODAY) return;
    if (pickMode === "start" || (start && end && d < start)) {
      setStart(d);
      setEnd(d);
      setPickMode("end");
    } else {
      if (d < start) { setStart(d); setEnd(start); }
      else setEnd(d);
      setPickMode("start");
    }
  };

  const applyPreset = (days) => {
    const e = new Date(TODAY);
    const s = new Date(TODAY);
    s.setDate(s.getDate() - (days - 1));
    setStart(s); setEnd(e);
    setViewMonth((() => { const v = new Date(s); v.setDate(1); return v; })());
  };
  const applyMTD = () => {
    const s = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    setStart(s); setEnd(TODAY);
    setViewMonth(new Date(s));
  };
  const applyYTD = () => {
    const s = new Date(TODAY.getFullYear(), 0, 1);
    const clamped = s < EARLIEST ? EARLIEST : s;
    setStart(clamped); setEnd(TODAY);
    const v = new Date(clamped); v.setDate(1); setViewMonth(v);
  };

  const monthLabel = (d) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const rangeLabel = `${fmt(start)} → ${fmt(end)}`;
  const dayCount = Math.max(1, Math.round((end - start) / 86400000) + 1);

  return (
    <div
      ref={popRef}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        right: 0,
        zIndex: 40,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.12), 0 2px 6px rgba(15,23,42,0.06)",
        display: "flex",
        fontFamily: "DM Sans, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Presets rail */}
      <div style={{ width: 120, borderRight: "1px solid var(--border)", padding: "12px 0", display: "flex", flexDirection: "column", gap: 2 }}>
        <PresetRow label="Last 7 days" onClick={() => applyPreset(7)} />
        <PresetRow label="Last 14 days" onClick={() => applyPreset(14)} />
        <PresetRow label="Last 30 days" onClick={() => applyPreset(30)} />
        <PresetRow label="Last 60 days" onClick={() => applyPreset(60)} />
        <PresetRow label="Last 90 days" onClick={() => applyPreset(90)} />
        <div style={{ height: 1, background: "var(--border)", margin: "6px 10px" }} />
        <PresetRow label="Month to date" onClick={applyMTD} />
        <PresetRow label="Year to date" onClick={applyYTD} />
        <PresetRow label="Max (180d)" onClick={() => applyPreset(180)} />
      </div>

      {/* Calendar + input area */}
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, minWidth: 520 }}>
        {/* input row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <DateInput
            label="Start"
            value={fmt(start)}
            min={fmt(EARLIEST)}
            max={fmt(end)}
            onChange={(v) => { const d = parse(v); if (d) { setStart(d); const vm = new Date(d); vm.setDate(1); setViewMonth(vm); } }}
          />
          <div style={{ color: "var(--text-muted)", paddingTop: 14 }}>→</div>
          <DateInput
            label="End"
            value={fmt(end)}
            min={fmt(start)}
            max={fmt(TODAY)}
            onChange={(v) => { const d = parse(v); if (d) setEnd(d); }}
          />
          <div style={{ marginLeft: "auto", paddingTop: 14, fontFamily: "Geist Mono", fontSize: 11, color: "var(--text-muted)" }}>
            {dayCount} days
          </div>
        </div>

        {/* Two-month calendar */}
        <div style={{ display: "flex", gap: 20 }}>
          <MonthGrid
            month={viewMonth}
            start={start} end={end} hover={hover}
            earliest={EARLIEST} latest={TODAY}
            onHover={setHover} onPick={clickDay}
            onPrev={() => setViewMonth(addMonths(viewMonth, -1))}
            onNext={null}
            showPrev
            showNext={false}
          />
          <MonthGrid
            month={addMonths(viewMonth, 1)}
            start={start} end={end} hover={hover}
            earliest={EARLIEST} latest={TODAY}
            onHover={setHover} onPick={clickDay}
            onPrev={null}
            onNext={() => setViewMonth(addMonths(viewMonth, 1))}
            showPrev={false}
            showNext
          />
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", marginTop: 2, paddingTop: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "Geist Mono" }}>{rangeLabel}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                padding: "6px 12px", fontSize: 12, fontWeight: 500,
                background: "transparent", color: "var(--text-secondary)",
                border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer",
                fontFamily: "DM Sans, sans-serif",
              }}
            >Cancel</button>
            <button
              onClick={() => onApply({ start: fmt(start), end: fmt(end) })}
              style={{
                padding: "6px 14px", fontSize: 12, fontWeight: 500,
                background: "var(--accent)", color: "#fff",
                border: "1px solid var(--accent)", borderRadius: 6, cursor: "pointer",
                fontFamily: "DM Sans, sans-serif",
              }}
            >Apply range</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetRow({ label, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "6px 14px",
        background: hover ? "var(--accent-10)" : "transparent",
        color: hover ? "var(--accent)" : "var(--text-secondary)",
        border: "none",
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "DM Sans, sans-serif",
      }}
    >{label}</button>
  );
}

function DateInput({ label, value, min, max, onChange }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "6px 8px", fontSize: 12,
          fontFamily: "Geist Mono, monospace",
          border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--surface)", color: "var(--text)",
          width: 140,
        }}
      />
    </label>
  );
}

function MonthGrid({ month, start, end, hover, earliest, latest, onHover, onPick, onPrev, onNext, showPrev, showNext }) {
  const year = month.getFullYear();
  const mIdx = month.getMonth();
  const firstOfMonth = new Date(year, mIdx, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay()); // back to Sunday
  const daysInMonth = new Date(year, mIdx + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }
  const label = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  // Hover preview: if we have a start but not yet confirmed end, show range up to hover
  const previewEnd = hover && start && !sameDay(start, end) ? null : hover;

  return (
    <div style={{ width: 240 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        {showPrev ? (
          <button onClick={onPrev} style={navBtn}>‹</button>
        ) : <div style={{ width: 22 }} />}
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{label}</div>
        {showNext ? (
          <button onClick={onNext} style={navBtn}>›</button>
        ) : <div style={{ width: 22 }} />}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, color: "var(--text-muted)", fontWeight: 500, padding: "4px 0" }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === mIdx;
          const disabled = d < earliest || d > latest;
          const isStart = sameDay(d, start);
          const isEnd = sameDay(d, end);
          const inRange = start && end && d >= start && d <= end;
          return (
            <DayCell
              key={i}
              d={d}
              inMonth={inMonth}
              disabled={disabled}
              isStart={isStart}
              isEnd={isEnd}
              inRange={inRange}
              onHover={onHover}
              onPick={onPick}
            />
          );
        })}
      </div>
    </div>
  );
}

function DayCell({ d, inMonth, disabled, isStart, isEnd, inRange, onHover, onPick }) {
  const [hover, setHover] = React.useState(false);
  const isEdge = isStart || isEnd;
  const bg = isEdge ? "var(--accent)" : inRange ? "var(--accent-10)" : hover && !disabled ? "rgba(15,23,42,0.04)" : "transparent";
  const color = isEdge ? "#fff" : !inMonth || disabled ? "var(--text-muted)" : inRange ? "var(--accent)" : "var(--text)";
  return (
    <button
      disabled={disabled}
      onMouseEnter={() => { setHover(true); onHover(d); }}
      onMouseLeave={() => setHover(false)}
      onClick={() => !disabled && onPick(d)}
      style={{
        padding: "6px 0",
        fontSize: 11.5,
        fontFamily: "Geist Mono, monospace",
        border: "none",
        background: bg,
        color,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
        borderRadius: isEdge ? 4 : 0,
        fontWeight: isEdge ? 600 : 400,
      }}
    >{d.getDate()}</button>
  );
}

const navBtn = {
  width: 22, height: 22,
  border: "none", background: "transparent",
  color: "var(--text-secondary)", cursor: "pointer",
  fontSize: 16, lineHeight: "22px", padding: 0,
  fontFamily: "DM Sans, sans-serif",
};

function addMonths(d, n) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

Object.assign(window, { CustomRangePicker });
