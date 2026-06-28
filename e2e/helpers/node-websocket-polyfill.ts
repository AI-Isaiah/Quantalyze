// realtime-js 2.101 (pulled in by @supabase/supabase-js) eagerly builds a
// realtime client inside createClient(), and its WebSocketFactory throws
// "Node.js <ver> detected without native WebSocket support" when the runtime is
// Node < 22 with no global WebSocket. CI runs the Playwright e2e workers on
// Node 20, so every seed/cleanup helper that constructs a Supabase client died
// before issuing a single query (the failure was masked for a long time because
// the upstream seed step crashed first). The e2e flow never opens a realtime
// channel; point the global at the `ws` impl that ships as a direct dependency
// of @supabase/realtime-js. Guarded so it stays a no-op on Node 22+, browsers,
// and a future CI Node bump.
//
// Import this module for its SIDE EFFECT (`import "./node-websocket-polyfill"`)
// before any createClient() call — the module-level statement runs at import
// time, ahead of the helper functions that build the client.
import { WebSocket as WsWebSocket } from "ws";

if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = WsWebSocket;
}
