export interface TileConfig {
  i: string;           // unique tile instance ID (e.g. "equity-curve-1")
  widgetId: string;    // widget type ID (e.g. "equity-curve")
  x: number;           // grid column position (0-11)
  y: number;           // grid row position
  w: number;           // width in grid columns (3, 4, 6, or 12)
  h: number;           // height in grid rows
  config?: Record<string, unknown>;
}

export interface DashboardConfig {
  tiles: TileConfig[];
  timeframe: string;
}

export interface WidgetMeta {
  id: string;
  name: string;
  category: "performance" | "risk" | "allocation" | "attribution" | "positions" | "monitoring" | "intelligence" | "meta";
  icon: string;        // Unicode icon
  defaultW: number;    // default width in grid columns
  defaultH: number;    // default height in grid rows
  description: string;
  status: "ready" | "todo"; // "todo" = needs new endpoint, shows placeholder
}

export interface WidgetProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;           // MyAllocationDashboardPayload — use 'any' to avoid circular deps, cast in widget
  timeframe: string;
  width: number;
  height: number;
}
