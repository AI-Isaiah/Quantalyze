// ---------------------------------------------------------------------------
// WidgetGrid — 4-column grid with drag-to-reorder + snap-resize (1/4, 2/4, 3/4, 4/4)
// Each widget provides its own render; the grid wraps it with a chrome bar
// (drag handle · remove · size stepper) and handles layout.
// ---------------------------------------------------------------------------

function WidgetGrid({ layout, onMove, onRemove, onResize, renderWidget }) {
  const [dragKey, setDragKey] = React.useState(null);
  const [dragOverKey, setDragOverKey] = React.useState(null);
  const [resize, setResize] = React.useState(null); // { k, startW, previewW, colWidth, gap, left }
  const gridRef = React.useRef(null);

  React.useEffect(() => {
    if (!resize) return;
    const onMove = (e) => {
      const { colWidth, gap, left } = resize;
      const widthPx = Math.max(0, e.clientX - left);
      let best = 1, bestDiff = Infinity;
      for (let n = 1; n <= 4; n++) {
        const target = n * colWidth + (n - 1) * gap;
        const diff = Math.abs(target - widthPx);
        if (diff < bestDiff) { bestDiff = diff; best = n; }
      }
      setResize((p) => p ? { ...p, previewW: best } : p);
    };
    const onUp = () => {
      setResize((p) => {
        if (p && p.previewW !== p.startW) onResize(p.k, p.previewW);
        return null;
      });
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resize, onResize]);

  const startResize = (k, startW, e, cellEl) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    const cs = window.getComputedStyle(grid);
    const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;
    const colWidth = (gridRect.width - gap * 3) / 4;
    const cellRect = cellEl.getBoundingClientRect();
    setResize({ k, startW, previewW: startW, colWidth, gap, left: cellRect.left });
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <div ref={gridRef} style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      gap: 10,
      marginTop: 10,
    }} className="widget-grid">
      {layout.map(({ k, w }) => {
        const isResizing = resize && resize.k === k;
        const displayW = isResizing ? resize.previewW : w;
        return (
        <div
          key={k}
          draggable={!isResizing}
          onDragStart={(e) => {
            if (resize) { e.preventDefault(); return; }
            setDragKey(k);
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", k); } catch(_) {}
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (dragKey && dragKey !== k) setDragOverKey(k);
          }}
          onDragLeave={() => {
            if (dragOverKey === k) setDragOverKey(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragKey && dragKey !== k) onMove(dragKey, k);
            setDragKey(null);
            setDragOverKey(null);
          }}
          onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
          style={{
            gridColumn: `span ${displayW}`,
            minWidth: 0,
            opacity: dragKey === k ? 0.4 : 1,
            transition: isResizing ? "none" : "opacity 120ms, grid-column 160ms ease-out",
            position: "relative",
          }}
          className="widget-cell"
        >
          {dragOverKey === k && dragKey !== k && (
            <div style={{
              position: "absolute", left: -5, top: 0, bottom: 0, width: 2,
              background: "var(--accent)", borderRadius: 2, zIndex: 4,
              boxShadow: "0 0 8px rgba(27,107,90,0.4)",
            }} />
          )}
          <WidgetChrome
            k={k}
            w={displayW}
            onRemove={() => onRemove(k)}
            onResize={(nw) => onResize(k, nw)}
          >
            {renderWidget(k)}
          </WidgetChrome>
          {/* Right-edge drag-to-resize handle */}
          <div
            onPointerDown={(e) => startResize(k, w, e, e.currentTarget.parentElement)}
            className="widget-resize-handle"
            title="Drag to resize · snaps to ¼ / ½ / ¾ / full"
            style={{
              position: "absolute", top: 0, bottom: 0, right: -5, width: 10,
              cursor: "col-resize", zIndex: 6,
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: isResizing ? 1 : 0, transition: "opacity 150ms",
            }}
          >
            <div style={{
              width: 3, height: 36, borderRadius: 2,
              background: isResizing ? "var(--accent)" : "var(--border)",
              boxShadow: isResizing ? "0 0 8px rgba(27,107,90,0.4)" : "none",
              transition: "background 120ms",
            }} />
          </div>
          {/* Snap guideline during resize */}
          {isResizing && (
            <div style={{
              position: "absolute", top: -4, bottom: -4, right: -6,
              width: 2, background: "var(--accent)", borderRadius: 2,
              boxShadow: "0 0 10px rgba(27,107,90,0.45)",
              pointerEvents: "none", zIndex: 5,
            }} />
          )}
        </div>
        );
      })}
      <style>{`
        .widget-cell:hover .widget-chrome,
        .widget-cell:hover .widget-resize-handle { opacity: 1; }
        .widget-resize-handle:hover > div { background: var(--accent) !important; }
        @media (max-width: 980px) {
          .widget-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .widget-cell { grid-column: span 2 !important; }
          .widget-resize-handle { display: none !important; }
        }
        @media (max-width: 640px) {
          .widget-grid { grid-template-columns: 1fr !important; }
          .widget-cell { grid-column: span 1 !important; }
        }
      `}</style>
    </div>
  );
}

function WidgetChrome({ k, w, children, onRemove, onResize }) {
  return (
    <div style={{ position: "relative", height: "100%" }} className="widget-wrap">
      {/* Hover chrome — only visible on widget hover */}
      <div
        className="widget-chrome"
        style={{
          position: "absolute", top: 6, right: 6, zIndex: 5,
          display: "flex", gap: 4, alignItems: "center",
          opacity: 0, transition: "opacity 150ms",
          pointerEvents: "auto",
        }}
      >
        <SizeStepper w={w} onResize={onResize} />
        <ChromeBtn title="Drag to reorder" cursor="grab">
          <Icon.drag size={12} />
        </ChromeBtn>
        <ChromeBtn title="Remove widget" onClick={onRemove}>
          <Icon.close size={11} />
        </ChromeBtn>
      </div>
      {children}
    </div>
  );
}

function SizeStepper({ w, onResize }) {
  return (
    <div style={{
      display: "inline-flex", gap: 0, padding: 2,
      background: "#fff", border: "1px solid var(--border)", borderRadius: 4,
      boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
    }}>
      {[1, 2, 3, 4].map(n => (
        <button
          key={n}
          onClick={() => onResize(n)}
          title={`${n}/4 width`}
          style={{
            width: 16, height: 16, padding: 0,
            border: "none", borderRadius: 2,
            background: w === n ? "var(--accent)" : "transparent",
            color: w === n ? "#fff" : "var(--text-muted)",
            fontSize: 9.5, fontWeight: 600, cursor: "pointer",
            fontFamily: "Geist Mono",
            transition: "all 120ms",
          }}
        >{n}</button>
      ))}
    </div>
  );
}

function ChromeBtn({ children, onClick, title, cursor = "pointer" }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 22, height: 22, padding: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "#fff", border: "1px solid var(--border)", borderRadius: 4,
        color: "var(--text-muted)", cursor,
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </button>
  );
}

// Widget picker — shows available widgets to add
function WidgetPicker({ catalog, layout, onAdd, onClose }) {
  const inUse = new Set(layout.map(x => x.k));
  const available = Object.entries(catalog).filter(([k, v]) => !inUse.has(k));
  const inUseEntries = Object.entries(catalog).filter(([k, v]) => inUse.has(k));

  React.useEffect(() => {
    const onClick = (e) => {
      if (!e.target.closest(".widget-picker")) onClose();
    };
    const t = setTimeout(() => document.addEventListener("click", onClick), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", onClick); };
  }, [onClose]);

  return (
    <div className="widget-picker" style={{
      position: "absolute", top: "calc(100% + 6px)", right: 0,
      width: 320, maxHeight: 420, overflowY: "auto",
      background: "#fff", border: "1px solid var(--border)",
      borderRadius: 8, boxShadow: "var(--shadow-pop)",
      zIndex: 40,
    }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Add widget</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{available.length} available</div>
      </div>
      {available.length === 0 && (
        <div style={{ padding: "16px 12px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
          All widgets are on your dashboard.
        </div>
      )}
      {available.map(([k, v]) => (
        <button
          key={k}
          disabled={v.unavailable}
          onClick={() => !v.unavailable && onAdd(k)}
          style={{
            width: "100%", padding: "10px 12px",
            background: "transparent", border: "none",
            borderBottom: "1px solid var(--border)",
            textAlign: "left", cursor: v.unavailable ? "not-allowed" : "pointer",
            display: "flex", alignItems: "flex-start", gap: 10,
            opacity: v.unavailable ? 0.55 : 1,
            transition: "background 120ms",
          }}
          onMouseEnter={(e) => { if (!v.unavailable) e.currentTarget.style.background = "var(--accent-10)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <div style={{
            width: 24, height: 24, borderRadius: 4,
            background: "var(--accent-10)", color: "var(--accent)",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            marginTop: 2,
          }}>
            <Icon.plus size={12} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
              {v.name}
              {v.unavailable && (
                <span style={{ fontSize: 9.5, padding: "1px 5px", background: "var(--border)", color: "var(--text-muted)", borderRadius: 3, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>soon</span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{v.desc}</div>
          </div>
        </button>
      ))}
      {inUseEntries.length > 0 && (
        <>
          <div style={{ padding: "10px 12px 4px", fontSize: 10, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", borderTop: "1px solid var(--border)", background: "#FAFBFC" }}>
            On your dashboard
          </div>
          {inUseEntries.map(([k, v]) => (
            <div key={k} style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 8, background: "#FAFBFC" }}>
              <Icon.check size={11} />
              <span>{v.name}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

Object.assign(window, { WidgetGrid, WidgetPicker });
