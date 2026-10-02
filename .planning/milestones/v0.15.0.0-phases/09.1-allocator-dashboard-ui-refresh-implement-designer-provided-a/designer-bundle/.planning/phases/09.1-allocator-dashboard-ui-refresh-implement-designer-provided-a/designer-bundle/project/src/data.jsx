// ---------------------------------------------------------------------------
// Fake-but-plausible allocator data. Figures are illustrative only.
// ---------------------------------------------------------------------------

const KPIS = {
  aum:           { label: "AUM",              value: 48_726_410, kind: "currency" },
  mtd:           { label: "MTD TWR",          value: 0.0217,     kind: "percent"  },
  ytd:           { label: "YTD TWR",          value: 0.1432,     kind: "percent"  },
  sharpe:        { label: "Portfolio Sharpe", value: 1.84,       kind: "number"   },
  maxDD:         { label: "Max DD (12m)",     value: -0.0683,    kind: "percent"  },
  corr:          { label: "Avg ρ",            value: 0.22,       kind: "corr"     },
  vol:           { label: "Ann. Vol",         value: 0.094,      kind: "percent"  },
  alpha:         { label: "α vs BTC",         value: 0.047,      kind: "percent"  },
};

// Equity curve — 180 days of daily points. Two series: portfolio + BTC benchmark.
function buildEquity() {
  const days = 180;
  const start = 1.0;
  const portfolio = [];
  const bench = [];
  let p = start, b = start;
  // deterministic pseudo-random
  let seed = 42;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < days; i++) {
    // portfolio: muted, lower vol, positive drift
    const pr = (rand() - 0.46) * 0.014 + 0.0008;
    p = p * (1 + pr);
    // benchmark (BTC): higher vol
    const br = (rand() - 0.485) * 0.032 + 0.0006;
    b = b * (1 + br);
    portfolio.push(p);
    bench.push(b);
  }
  return { portfolio, bench };
}
const EQUITY = buildEquity();

// Intraday hourly series — 7 days × 24 hours = 168 hourly points for portfolio + bench.
// Used for 1D and 1W timeframes.
function buildIntraday() {
  const hours = 168;
  const start = 1.0;
  const portfolio = [];
  const bench = [];
  let p = start, b = start;
  let seed = 4242;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < hours; i++) {
    const pr = (rand() - 0.49) * 0.0024 + 0.00008;
    p = p * (1 + pr);
    const br = (rand() - 0.495) * 0.0058 + 0.00005;
    b = b * (1 + br);
    portfolio.push(p);
    bench.push(b);
  }
  return { portfolio, bench };
}
const EQUITY_HOURLY = buildIntraday();

// Per-holding hourly series — 168 hourly points. Deterministic per id.
function buildHoldingHourly(seed, days, vol, drift) {
  let s = seed * 7 + 13;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const n = days * 24;
  const out = [];
  let v = 1.0;
  for (let i = 0; i < n; i++) {
    const r = (rand() - 0.49) * vol * 0.25 + drift * 0.04;
    v = v * (1 + r);
    out.push(v);
  }
  return out;
}

// Per-holding equity series — 180 days, deterministic from id + sharpe + dd characteristics
function buildHoldingSeries(seed, days, vol, drift, ddEvent) {
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const out = [];
  let v = 1;
  for (let i = 0; i < days; i++) {
    let r = (rand() - 0.5) * vol * 2 + drift;
    // inject drawdown event if present
    if (ddEvent && i >= ddEvent.start && i < ddEvent.start + ddEvent.len) {
      r -= ddEvent.mag;
    }
    v = v * (1 + r);
    out.push(v);
  }
  return out;
}

const HOLDING_COLORS = [
  "#D97757", "#3E7B8F", "#8B6DB5", "#C48A3E", "#5B9B7E",
  "#B54A6B", "#4A7FB8", "#7A8F3E",
];

const HOLDINGS = [
  {
    id: "h_001",
    strategy: "Helios Perp Basis",
    manager: "Helios Capital",
    tag: "Market Neutral",
    alloc: 9_400_000,
    weight: 0.193,
    mtd: 0.0132,
    sharpe: 2.14,
    dd: -0.018,
    age: 412,
    status: "ok",
  },
  {
    id: "h_002",
    strategy: "Northwind BTC-Momentum",
    manager: "Northwind Systematic",
    tag: "Trend",
    alloc: 8_150_000,
    weight: 0.167,
    mtd: 0.0387,
    sharpe: 1.72,
    dd: -0.054,
    age: 298,
    status: "ok",
  },
  {
    id: "h_003",
    strategy: "Atlas ETH Vol Premium",
    manager: "Atlas Derivatives",
    tag: "Vol Sell",
    alloc: 6_720_000,
    weight: 0.138,
    mtd: -0.0041,
    sharpe: 1.31,
    dd: -0.032,
    age: 224,
    status: "watch",
  },
  {
    id: "h_004",
    strategy: "Kepler Cross-Exchange Arb",
    manager: "Kepler Research",
    tag: "Stat-Arb",
    alloc: 6_100_000,
    weight: 0.125,
    mtd: 0.0094,
    sharpe: 2.41,
    dd: -0.011,
    age: 511,
    status: "ok",
  },
  {
    id: "h_005",
    strategy: "Meridian Funding Harvest",
    manager: "Meridian Quant",
    tag: "Carry",
    alloc: 5_380_000,
    weight: 0.110,
    mtd: -0.0214,
    sharpe: 0.68,
    dd: -0.091,
    age: 173,
    status: "underperform",
    bridgeCandidate: true,
  },
  {
    id: "h_006",
    strategy: "Orion Mean-Reversion",
    manager: "Orion Labs",
    tag: "Mean-Rev",
    alloc: 4_900_000,
    weight: 0.101,
    mtd: 0.0176,
    sharpe: 1.58,
    dd: -0.029,
    age: 342,
    status: "ok",
  },
  {
    id: "h_007",
    strategy: "Vantage SOL-Alt Basket",
    manager: "Vantage Digital",
    tag: "Directional",
    alloc: 4_210_000,
    weight: 0.086,
    mtd: 0.0421,
    sharpe: 1.19,
    dd: -0.074,
    age: 118,
    status: "ok",
  },
  {
    id: "h_008",
    strategy: "Cygnus L/S Factor",
    manager: "Cygnus Advisors",
    tag: "Factor",
    alloc: 3_866_000,
    weight: 0.079,
    mtd: 0.0081,
    sharpe: 1.46,
    dd: -0.025,
    age: 389,
    status: "ok",
  },
];

// Attach deterministic per-holding series + a palette color
HOLDINGS.forEach((h, idx) => {
  // seed from id so series are stable
  const seed = h.id.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 233280 + 1;
  // Derive vol / drift from sharpe + dd
  const vol = 0.006 + Math.max(0, 0.1 - Math.abs(h.dd)) * 0.02 + (h.tag === "Trend" || h.tag === "Directional" ? 0.006 : 0);
  const drift = (h.sharpe * 0.00035) + (h.mtd / 30);
  // Underperformers get a realized drawdown event
  const ddEvent = h.status === "underperform"
    ? { start: 95, len: 30, mag: 0.004 }
    : h.status === "watch"
      ? { start: 120, len: 15, mag: 0.002 }
      : null;
  h.series = buildHoldingSeries(seed, 180, vol, drift, ddEvent);
  h.seriesHourly = buildHoldingHourly(seed, 7, vol, drift);
  h.color = HOLDING_COLORS[idx % HOLDING_COLORS.length];
});

// Bridge recommendation (replacement candidates for Meridian Funding Harvest)
const BRIDGE = {
  underperformer: {
    id: "h_005",
    strategy: "Meridian Funding Harvest",
    manager: "Meridian Quant",
    mtd: -0.0214,
    d90: -0.038,
    maxDD: -0.091,
    sharpe90: 0.58,
    // Structured breaches — each has the gate, current value, and the metric key
    // so we can show apples-to-apples improvement per candidate.
    breaches: [
      { key: "maxDD", label: "Max drawdown", gateLabel: "≤ 7.5%", currentLabel: "9.1%", current: -0.091, gate: -0.075, format: "pctMag" },
      { key: "sharpe90", label: "Sharpe (90d)", gateLabel: "≥ 0.75", currentLabel: "0.58", current: 0.58, gate: 0.75, format: "num2" },
    ],
  },
  mandate: {
    name: "Crypto Carry Sleeve",
    targetSize: 5_000_000,
    sizeRange: [3_000_000, 7_000_000],
    style: "Carry / Funding",
    constraints: ["Max DD ≤ 7.5%", "Sharpe (90d) ≥ 0.75", "Min AUM $15M", "Exchange-verified"],
  },
  candidates: [
    {
      id: "s_a1",
      strategy: "Cirrus Perp Funding",
      manager: "Cirrus Systematic",
      tag: "Carry",
      sharpe: 1.93, sharpe90: 1.93,
      mtd: 0.0241,
      fit: 0.91,
      dd: -0.023, maxDD: -0.023,
      aum: 34_200_000,
      verified: true,
      potentialAllocation: 5_000_000,
      mandateFit: { liquidity: 1.0, style: 0.88, risk: 0.95 },
      reason: "Same style (carry) with tighter risk discipline. Passes all mandate gates.",
    },
    {
      id: "s_a2",
      strategy: "Aster Funding-Skew",
      manager: "Aster Capital",
      tag: "Carry",
      sharpe: 1.71, sharpe90: 1.71,
      mtd: 0.0208,
      fit: 0.84,
      dd: -0.031, maxDD: -0.031,
      aum: 21_800_000,
      verified: true,
      potentialAllocation: 4_500_000,
      mandateFit: { liquidity: 0.82, style: 0.90, risk: 0.80 },
      reason: "Adjacent style. Slightly tighter correlation to existing book.",
    },
    {
      id: "s_a3",
      strategy: "Polaris Basis + Term",
      manager: "Polaris Markets",
      tag: "Carry / Basis",
      sharpe: 1.68, sharpe90: 1.68,
      mtd: 0.0184,
      fit: 0.79,
      dd: -0.028, maxDD: -0.028,
      aum: 18_100_000,
      verified: true,
      potentialAllocation: 3_500_000,
      mandateFit: { liquidity: 0.74, style: 0.85, risk: 0.78 },
      reason: "Mixes funding with term structure — modest diversifier.",
    },
  ],
};

// Previously-recorded outcomes
const OUTCOMES = [
  {
    id: "o_001",
    from: "Tide Basis Neutral",
    to: "Helios Perp Basis",
    recordedOn: "2026-01-18",
    delta30: 0.0184,
    delta90: 0.0412,
    delta180: 0.0673,
    status: "complete",
    size: 6_000_000,
  },
  {
    id: "o_002",
    from: "Perigee Vol Harvest",
    to: "Atlas ETH Vol Premium",
    recordedOn: "2026-02-04",
    delta30: 0.0071,
    delta90: 0.0095,
    delta180: null,
    status: "partial",
    size: 4_500_000,
  },
  {
    id: "o_003",
    from: "Boreas Mean-Rev",
    to: "Orion Mean-Reversion",
    recordedOn: "2026-03-22",
    delta30: -0.0038,
    delta90: null,
    delta180: null,
    status: "early",
    size: 3_200_000,
  },
  {
    id: "o_004",
    from: "Stratus Alt Basket",
    to: "Vantage SOL-Alt Basket",
    recordedOn: "2026-04-02",
    delta30: null,
    delta90: null,
    delta180: null,
    status: "pending",
    size: 2_800_000,
  },
];

const TAG_COLOR = {
  "Market Neutral": "#1B6B5A",
  "Trend":          "#5B21B6",
  "Vol Sell":       "#B45309",
  "Stat-Arb":       "#0F766E",
  "Carry":          "#1D4ED8",
  "Carry / Basis":  "#1D4ED8",
  "Mean-Rev":       "#7C2D12",
  "Directional":    "#9A3412",
  "Factor":         "#334155",
};

// Correlation matrix — deterministic pairwise ρ between holdings
function buildCorr() {
  const out = {};
  HOLDINGS.forEach((a, i) => {
    out[a.id] = {};
    HOLDINGS.forEach((b, j) => {
      if (i === j) { out[a.id][b.id] = 1; return; }
      // seed from id pair
      const pair = a.id < b.id ? a.id + b.id : b.id + a.id;
      let s = pair.split("").reduce((x, c) => x * 31 + c.charCodeAt(0), 7) % 233280 + 1;
      const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
      // Same tag → higher ρ, Trend/Directional more cross-correlated
      const sameTag = a.tag === b.tag ? 0.35 : 0;
      const directional = (/Trend|Directional|Vol|Mean/.test(a.tag) && /Trend|Directional|Vol|Mean/.test(b.tag)) ? 0.15 : 0;
      const base = (rand() - 0.4) * 0.6;
      let rho = base + sameTag + directional;
      rho = Math.max(-0.6, Math.min(0.95, rho));
      out[a.id][b.id] = parseFloat(rho.toFixed(2));
    });
  });
  return out;
}
const CORR = buildCorr();

// Funding rates — recent 8h funding across venues for top perps
const FUNDING = [
  { venue: "Binance",  asset: "BTC",  rate:  0.0082,  trend: [0.006, 0.009, 0.011, 0.0082], notional: 420e6 },
  { venue: "Binance",  asset: "ETH",  rate:  0.0054,  trend: [0.004, 0.006, 0.007, 0.0054], notional: 210e6 },
  { venue: "Binance",  asset: "SOL",  rate:  0.0134,  trend: [0.008, 0.011, 0.015, 0.0134], notional: 78e6 },
  { venue: "Bybit",    asset: "BTC",  rate:  0.0069,  trend: [0.005, 0.007, 0.009, 0.0069], notional: 180e6 },
  { venue: "Bybit",    asset: "ETH",  rate:  0.0041,  trend: [0.003, 0.005, 0.005, 0.0041], notional: 92e6 },
  { venue: "OKX",      asset: "BTC",  rate:  0.0091,  trend: [0.007, 0.010, 0.011, 0.0091], notional: 145e6 },
  { venue: "OKX",      asset: "ETH",  rate: -0.0012,  trend: [0.002, 0.001, -0.002, -0.0012], notional: 64e6 },
  { venue: "Deribit",  asset: "BTC",  rate:  0.0048,  trend: [0.004, 0.005, 0.005, 0.0048], notional: 52e6 },
  { venue: "Hyperliquid", asset: "BTC", rate: 0.0103, trend: [0.008, 0.010, 0.012, 0.0103], notional: 88e6 },
  { venue: "Hyperliquid", asset: "SOL", rate: 0.0167, trend: [0.011, 0.014, 0.018, 0.0167], notional: 24e6 },
];

// Flows ledger — recent subs / redemptions / transfers
const FLOWS = [
  { id: "f_001", date: "2026-04-19", kind: "subscription", entity: "Meridian Pension",   amount: 2_500_000, strategy: "Helios Perp Basis", status: "settled" },
  { id: "f_002", date: "2026-04-18", kind: "redemption",   entity: "Family Office A",    amount: -1_200_000, strategy: "Meridian Funding Harvest", status: "pending" },
  { id: "f_003", date: "2026-04-17", kind: "transfer",     entity: "Internal rebalance", amount: 3_800_000, strategy: "Kepler Cross-Exchange Arb", status: "settled" },
  { id: "f_004", date: "2026-04-15", kind: "subscription", entity: "Endowment Trust",    amount: 5_000_000, strategy: "Northwind BTC-Momentum", status: "settled" },
  { id: "f_005", date: "2026-04-12", kind: "redemption",   entity: "High-net-worth #441",amount: -850_000,   strategy: "Atlas ETH Vol Premium", status: "settled" },
  { id: "f_006", date: "2026-04-08", kind: "subscription", entity: "Sovereign Partner",  amount: 4_200_000, strategy: "Helios Perp Basis", status: "settled" },
  { id: "f_007", date: "2026-04-04", kind: "transfer",     entity: "Internal rebalance", amount: -1_500_000, strategy: "Orion Mean-Reversion", status: "settled" },
];

// Activity feed — recent mandate events, risk alerts, allocator actions
const ACTIVITY = [
  { id: "a_001", ts: "2026-04-21 09:14", kind: "breach",   title: "Meridian Funding Harvest tripped Sharpe gate",    meta: "Sharpe 0.68 · gate 0.75", severity: "high" },
  { id: "a_002", ts: "2026-04-20 16:42", kind: "bridge",   title: "Bridge surfaced 4 replacement candidates",        meta: "Carry / Basis · Sharpe > 1.6", severity: "info" },
  { id: "a_003", ts: "2026-04-19 11:08", kind: "flow",     title: "Subscription settled · Meridian Pension",         meta: "$2.5M → Helios Perp Basis", severity: "info" },
  { id: "a_004", ts: "2026-04-18 08:33", kind: "watch",    title: "Atlas ETH Vol flagged — DD near gate",            meta: "DD 3.2% · gate 4.0%", severity: "med" },
  { id: "a_005", ts: "2026-04-17 14:20", kind: "outcome",  title: "Outcome recorded · Tide → Helios",                 meta: "+6.7% at 180d", severity: "info" },
  { id: "a_006", ts: "2026-04-15 10:02", kind: "flow",     title: "Subscription settled · Endowment Trust",          meta: "$5.0M → Northwind BTC-Momentum", severity: "info" },
  { id: "a_007", ts: "2026-04-14 13:45", kind: "note",     title: "IC memo circulated · Q1 review",                   meta: "12 attendees · 4 action items", severity: "info" },
];

Object.assign(window, { KPIS, EQUITY, EQUITY_HOURLY, HOLDINGS, BRIDGE, OUTCOMES, TAG_COLOR, CORR, FUNDING, FLOWS, ACTIVITY });
