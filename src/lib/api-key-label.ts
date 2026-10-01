/**
 * DSRC-02 — exchange display-name lookup for the Data-sources row labels.
 *
 * Copied locally from the SyncBadge recipe (SyncBadge.tsx:21-35): a lower-cased
 * lookup with `?? exchange` fallback. The shared `EXCHANGE_DISPLAY`
 * (closed-sets.ts) carries identical values but is typed
 * `Record<SupportedExchange, string>` — a CLOSED key union — so it cannot be
 * indexed by the arbitrary `string` exchange code without a cast that defeats
 * its narrowing; the open-keyed `?? fallback` recipe stays local, matching the
 * existing local copies in SyncBadge + VerificationForm + AllocatorSyncStatus
 * rather than introducing a cast.
 *
 * Phase 167.1.2 plan 04 moved this block here, byte for byte, out of
 * ScenarioComposer.tsx, where it was private. The key cards' duplicate note
 * (accountShareNote, src/lib/account-share-note.ts) names the holder key with
 * the same label the Scenario data-source rows show, so the label now has two
 * readers and one definition. Importing it from the 7000-line client component
 * would have pulled that whole module into both key cards.
 */
const EXCHANGE_LABELS: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
  // 167.1.2 REVIEW IN-03: the duplicate note names a holder on every venue that
  // reports an account id, so every venue needs its display name here (the
  // values EXCHANGE_DISPLAY carries). Without them the note read "deribit — …".
  deribit: "Deribit",
  sfox: "sFOX",
  mt5: "MT5",
};

/**
 * DSRC-02 — resolve a connected exchange api_key to its row label
 * `{Exchange} — {nickname}`, falling back to `{Exchange} — ••••{id.slice(-4)}`
 * when the key has no nickname. The masked tail never reveals the full id and
 * never any secret/ciphertext (T-37-03-01). Returns the structured parts so the
 * caller can render the masked tail in font-mono per UI-SPEC.
 */
export function dataSourceLabel(k: { exchange: string; label: string; id: string }): {
  exchange: string;
  /** nickname when present, else null (caller renders the masked tail). */
  nickname: string | null;
  /** masked id tail (last 4) — only meaningful when nickname is null. */
  maskedTail: string;
} {
  const exchange = EXCHANGE_LABELS[k.exchange.toLowerCase()] ?? k.exchange;
  const nick = k.label?.trim();
  return {
    exchange,
    nickname: nick ? nick : null,
    maskedTail: `••••${k.id.slice(-4)}`,
  };
}

/**
 * Phase 169.4-01 (SC2) — the ONE key-label rule: api_key_id → the key's
 * display name `${Exchange} — ${nickname ?? ••••tail}`, built from
 * `dataSourceLabel`. The Scenario composer names its per-key units this way
 * (its local `apiKeyLabelById` memo, which 169.4-08 switches to this helper),
 * and the Allocations Risk tab names its per-key correlation and decomposition
 * rows this way, so one account carries one name on both tabs. A raw key id is
 * never a value (T-169-26).
 */
export function apiKeyLabelById(
  apiKeys: ReadonlyArray<{ id: string; exchange: string; label: string }>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of apiKeys) {
    const { exchange, nickname, maskedTail } = dataSourceLabel(k);
    m.set(k.id, `${exchange} — ${nickname ?? maskedTail}`);
  }
  return m;
}
