/**
 * PushConsole — Type Definitions (v2)
 * Redesigned for multi-client push management.
 */

export type AuthType = "bearer" | "apikey" | "basic" | "none";
export type PushScope = "project" | "site" | "camera";
export type TestStatus = "idle" | "running" | "ok" | "fail";
export type LogFilter = "all" | "ok" | "err";

// ─── Custom header entry ──────────────────────────────────────────────────────

export interface CustomHeader {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

// ─── Client ───────────────────────────────────────────────────────────────────
// A "client" is one external server/endpoint that receives push notifications.
// Each client has its own endpoint, auth config, payload scope, and schedule.

export interface PushClient {
  id: string;
  name: string;
  description: string;

  // ── Endpoint
  endpoint: string;

  // ── Auth (one of: bearer / apikey / basic / none)
  authType: AuthType;
  bearerToken: string;       // AuthType="bearer"  → Authorization: Bearer <token>
  apiKeyHeader: string;      // AuthType="apikey"  → <header>: <value>
  apiKeyValue: string;
  basicUser: string;         // AuthType="basic"   → Authorization: Basic base64(user:pass)
  basicPass: string;

  // ── Custom headers (beyond auth — e.g. X-Project-ID, X-Region)
  customHeaders: CustomHeader[];

  // ── What to push
  scope: PushScope;
  selectedCameraIds: string[];
  selectedSiteIds: number[];

  // ── When to push
  intervalSeconds: number;
  maxRetries: number;
  retryBackoffSeconds: number;

  // ── State
  paused: boolean;
  createdAt: number;

  // ── Live analytics (accumulated)
  successCount: number;
  errorCount: number;
  lastSeenAt: number | null;   // unix ms of last successful push
  lastStatusCode: number | null;
  avgLatencyMs: number;
}

// ─── Log entry ────────────────────────────────────────────────────────────────

export interface PushLogEntry {
  id: string;
  ts: number;           // unix ms
  clientId?: string;
  clientName?: string;
  status: number;       // HTTP status code (0 = timeout/network error)
  target: string;       // endpoint URL
  detail: string;       // human-readable detail
  ok: boolean;
  latencyMs: number;
}

// ─── Session stats ────────────────────────────────────────────────────────────

export interface SessionStats {
  sent: number;
  errors: number;
  avgMs: number;
  rateCurrent: number;
  rateLimit: number;
  rateResetIn: number;
}
