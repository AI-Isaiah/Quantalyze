/**
 * Demo peer cohort for the Peer Percentile panel. 20 synthesized peer
 * strategies with deterministic distributions — the panel is clearly
 * tagged "demo cohort" in the UI so a reader knows these aren't real
 * platform peers. Production should replace this with a query against
 * the platform's strategy DB.
 *
 * Random seed is fixed at 42 so the cohort is identical across
 * regenerations — same percentile rank for the same strategy each load.
 */

export type PeerCohortEntry = {
  sharpe: number;
  sortino: number;
  max_dd: number;
};

export type PeerPercentileSummary = {
  cohort: PeerCohortEntry[];
  sharpe: number; // 0..100 where higher is better
  sortino: number;
  max_dd: number; // less negative = better → higher percentile
};

const PEER_RNG_SEED = 42;

// Mulberry32 — small deterministic PRNG; matches snapshot semantics across builds.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller for normal(μ, σ).
function makeNormal(rand: () => number): (mu: number, sigma: number) => number {
  return (mu, sigma) => {
    const u1 = Math.max(rand(), 1e-9);
    const u2 = rand();
    return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

// Crude beta(α, β) via two gammas via Marsaglia-Tsang. Good enough for a demo cohort.
function makeBeta(rand: () => number): (alpha: number, beta: number) => number {
  const gamma = (k: number): number => {
    if (k < 1) return gamma(k + 1) * Math.pow(rand(), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    while (true) {
      let x: number;
      let v: number;
      do {
        const u1 = Math.max(rand(), 1e-9);
        const u2 = rand();
        x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = rand();
      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  };
  return (alpha, beta) => {
    const x = gamma(alpha);
    const y = gamma(beta);
    return x / (x + y);
  };
}

let _peers: PeerCohortEntry[] | null = null;

export function getPeerCohort(): PeerCohortEntry[] {
  if (_peers) return _peers;
  const rand = mulberry32(PEER_RNG_SEED);
  const normal = makeNormal(rand);
  const beta = makeBeta(rand);
  const peers: PeerCohortEntry[] = [];
  for (let i = 0; i < 20; i++) {
    const sh = clamp(normal(0.85, 0.55), -0.3, 2.5);
    const so = clamp(sh * (1.15 + rand() * 0.8), -0.4, 4);
    const dd = -clamp(beta(1.5, 4) * 0.55, 0.05, 0.5);
    peers.push({ sharpe: sh, sortino: so, max_dd: dd });
  }
  _peers = peers;
  return peers;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Percentile rank: % of cohort whose value is ≤ ours. Higher = better. */
function percentileRank(my: number, vals: number[]): number {
  if (vals.length === 0) return 0;
  return (100 * vals.filter(v => v <= my).length) / vals.length;
}

export function computePeerPercentile(stratSharpe: number, stratSortino: number, stratMaxDd: number): PeerPercentileSummary {
  const cohort = getPeerCohort();
  return {
    cohort,
    sharpe: percentileRank(stratSharpe, cohort.map(p => p.sharpe)),
    sortino: percentileRank(stratSortino, cohort.map(p => p.sortino)),
    // For max_dd, less negative = better, so higher max_dd value → higher percentile.
    max_dd: percentileRank(stratMaxDd, cohort.map(p => p.max_dd)),
  };
}
