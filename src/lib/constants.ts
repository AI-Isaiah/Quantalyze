export const STRATEGY_TYPES = [
  "Directional",
  "Bidirectional",
  "Market Neutral",
  "Delta Neutral",
  "Arbitrage",
  "Other",
] as const;

export const SUBTYPES = [
  "Trend Following",
  "Momentum",
  "Breakout",
  "Mean Reversion",
  "Statistical Arbitrage",
  "Market Making",
  "Basis Trading",
  "Funding Rate",
] as const;

export const MARKETS = ["Futures", "Spot"] as const;

export const EXCHANGES = ["Binance", "OKX", "Bybit"] as const;

export const CHART_COLORS = {
  strategy: "#0D9488",
  benchmark: "#94A3B8",
  positive: "#059669",
  negative: "#DC2626",
  accent2: "#6366F1",
  grid: "#F1F5F9",
  axis: "#E2E8F0",
  text: "#64748B",
} as const;

export const DISCOVERY_CATEGORIES = [
  { slug: "crypto-sma", name: "Crypto SMA", description: "Separately Managed Accounts for crypto quantitative strategies. Verified performance from exchange APIs." },
  { slug: "cfd", name: "CFD", description: "Contract-for-difference strategies across major crypto pairs." },
  { slug: "emerging-crypto", name: "Emerging Crypto", description: "Early-stage strategies on newer tokens and protocols." },
  { slug: "crypto-decks", name: "Crypto Decks", description: "Curated bundles of crypto strategies for diversified allocation." },
  { slug: "tradfi-decks", name: "TradFi Decks", description: "Traditional finance strategy bundles bridging TradFi and crypto." },
] as const;
