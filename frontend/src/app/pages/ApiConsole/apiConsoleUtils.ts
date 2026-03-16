/**
 * API Console - Utility Functions
 * 
 * Helper functions for formatting, validation, and data transformation.
 */

import type { KV, HttpMethod, ProxyResponse, SendConfig, SiteRouteRule, DestinationPreset } from "./apiConsoleTypes";

// ─── Formatting ────────────────────────────────────────────────────────────

/**
 * Format bytes to human-readable size string
 * @param bytes - Number of bytes
 * @returns Formatted size string (e.g., "1.5 KB", "2.3 MB")
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Format milliseconds to human-readable time string
 * @param ms - Milliseconds
 * @returns Formatted time string (e.g., "1.2s", "500ms")
 */
export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Format date to locale time string
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Formatted time string (e.g., "14:30:45")
 */
export function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "Invalid time";
  }
}

// ─── JSON Highlighting ────────────────────────────────────────────────────

/**
 * Minimal JSON syntax highlighter using HTML spans
 * Generates safe HTML with color-coded JSON elements
 * 
 * @param json - JSON string to highlight
 * @returns HTML string with span elements for syntax highlighting
 */
export function highlightJson(json: string): string {
  // Escape HTML special characters
  const safe = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Apply syntax highlighting
  return safe.replace(
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = "text-[#a8d5a2]"; // number (green)

      if (/^"/.test(match)) {
        // String or key
        cls = /:$/.test(match) ? "text-[#79c0ff]" : "text-[#a5d6ff]"; // key (blue) vs string (light blue)
      } else if (/true|false/.test(match)) {
        // Boolean
        cls = "text-[#f8c555]"; // yellow
      } else if (/null/.test(match)) {
        // Null
        cls = "text-[#9da7b3]"; // gray
      }

      return `<span class="${cls}">${match}</span>`;
    },
  );
}

/**
 * Pretty-print JSON string with indentation
 * @param json - JSON string
 * @param indent - Number of spaces for indentation (default: 2)
 * @returns Formatted JSON string or original if invalid
 */
export function prettyPrintJson(json: string, indent = 2): string {
  try {
    return JSON.stringify(JSON.parse(json), null, indent);
  } catch {
    return json;
  }
}

/**
 * Validate JSON string
 * @param json - JSON string to validate
 * @returns Error message if invalid, empty string if valid
 */
export function validateJson(json: string): string {
  if (!json.trim()) return "";
  try {
    JSON.parse(json);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid JSON";
  }
}

// ─── Status & Color Utilities ──────────────────────────────────────────────

/**
 * Get Tailwind color class for HTTP status code
 * @param status - HTTP status code
 * @returns Tailwind color class string
 */
export function statusBadgeClass(status: number | null): string {
  if (!status) return "text-[#9da7b3]"; // gray
  if (status >= 200 && status < 300) return "text-[#3fb950]"; // green (success)
  if (status >= 300 && status < 400) return "text-[#79c0ff]"; // blue (redirect)
  if (status >= 400 && status < 500) return "text-[#f85149]"; // red (client error)
  return "text-[#d29922]"; // orange (server error)
}

/**
 * Get HTTP method color class
 * @param method - HTTP method
 * @returns Tailwind color class string
 */
export function methodColorClass(method: HttpMethod): string {
  const colors: Record<HttpMethod, string> = {
    GET: "text-[#3fb950]", // green
    POST: "text-[#f8c555]", // yellow
    PUT: "text-[#79c0ff]", // blue
    PATCH: "text-[#d2a8ff]", // purple
    DELETE: "text-[#f85149]", // red
    HEAD: "text-[#9da7b3]", // gray
  };
  return colors[method] || "text-[#9da7b3]";
}

/**
 * Get HTTP method badge class (with border)
 * @param method - HTTP method
 * @returns Tailwind class string
 */
export function methodBadgeClass(method: HttpMethod): string {
  const classes: Record<HttpMethod, string> = {
    GET: "text-[#3fb950] border-[#3fb950]/30",
    POST: "text-[#f8c555] border-[#f8c555]/30",
    PUT: "text-[#79c0ff] border-[#79c0ff]/30",
    PATCH: "text-[#d2a8ff] border-[#d2a8ff]/30",
    DELETE: "text-[#f85149] border-[#f85149]/30",
    HEAD: "text-[#9da7b3] border-[#9da7b3]/30",
  };
  return classes[method] || "text-[#9da7b3] border-[#9da7b3]/30";
}

// ─── URL & Query Parameter Utilities ───────────────────────────────────────

/**
 * Build URL with query parameters
 * @param baseUrl - Base URL
 * @param params - Array of KV pairs
 * @returns Complete URL with query string
 */
export function buildResolvedUrl(baseUrl: string, params: KV[]): string {
  const enabled = params.filter((p) => p.enabled && p.key.trim());
  if (!enabled.length) return baseUrl;

  const qs = new URLSearchParams(enabled.map((p) => [p.key, p.value])).toString();
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${qs}`;
}

/**
 * Parse URL to extract base and query parameters
 * @param url - Full URL
 * @returns Object with baseUrl and params
 */
export function parseUrl(url: string): { baseUrl: string; params: KV[] } {
  try {
    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    const params: KV[] = Array.from(urlObj.searchParams.entries()).map(([key, value]) => ({
      key,
      value,
      enabled: true,
    }));
    return { baseUrl, params };
  } catch {
    return { baseUrl: url, params: [] };
  }
}

/**
 * Validate URL format
 * @param url - URL string
 * @returns Error message if invalid, empty string if valid
 */
export function validateUrl(url: string): string {
  if (!url.trim()) return "URL is required";
  if (url.startsWith("/")) return ""; // Internal path is valid
  try {
    new URL(url);
    return "";
  } catch {
    return "Invalid URL format";
  }
}

// ─── KV Utilities ─────────────────────────────────────────────────────────

/**
 * Create a new KV pair
 * @param key - Key string
 * @param value - Value string
 * @param enabled - Whether the pair is enabled
 * @returns KV object
 */
export function createKV(key = "", value = "", enabled = true): KV {
  return { key, value, enabled };
}

/**
 * Filter enabled KV pairs
 * @param rows - Array of KV pairs
 * @returns Array of enabled KV pairs
 */
export function getEnabledKV(rows: KV[]): KV[] {
  return rows.filter((r) => r.enabled && r.key.trim());
}

/**
 * Convert KV array to object
 * @param rows - Array of KV pairs
 * @returns Object with key-value pairs
 */
export function kvToObject(rows: KV[]): Record<string, string> {
  const obj: Record<string, string> = {};
  getEnabledKV(rows).forEach((r) => {
    obj[r.key] = r.value;
  });
  return obj;
}

/**
 * Convert object to KV array
 * @param obj - Object with key-value pairs
 * @returns Array of KV pairs
 */
export function objectToKV(obj: Record<string, string>): KV[] {
  return Object.entries(obj).map(([key, value]) => createKV(key, value, true));
}

// ─── Request Building ──────────────────────────────────────────────────────

/**
 * Build request headers object from KV array
 * @param headers - Array of KV pairs
 * @param authType - Authentication type
 * @param authValue - Authentication value
 * @returns Headers object
 */
export function buildHeaders(
  headers: KV[],
  authType: "none" | "bearer" | "apikey",
  authValue: string,
): Record<string, string> {
  const hMap = kvToObject(headers);

  if (authType === "bearer" && authValue.trim()) {
    hMap["Authorization"] = `Bearer ${authValue.trim()}`;
  } else if (authType === "apikey" && authValue.trim()) {
    hMap["X-API-Key"] = authValue.trim();
  }

  return hMap;
}

/**
 * Generate cURL command from request config
 * @param config - SendConfig object
 * @param resolvedUrl - Full URL with query parameters
 * @returns cURL command string
 */
export function generateCurl(config: SendConfig, resolvedUrl: string): string {
  const headers = buildHeaders(config.headers, config.authType, config.authValue);
  const hStr = Object.entries(headers)
    .map(([k, v]) => `-H "${k}: ${v}"`)
    .join(" \\\n     ");

  const bStr =
    config.bodyText.trim() && config.bodyMode !== "none"
      ? ` \\\n  -d '${config.bodyText.replace(/'/g, "'\\''")}'`
      : "";

  return `curl -X ${config.method} "${resolvedUrl}" \\\n     ${hStr}${bStr}`.trim();
}

// ─── Site Routing ─────────────────────────────────────────────────────────

/**
 * Resolve site route target URL
 * @param route - SiteRouteRule
 * @param presets - Array of destination presets
 * @returns Resolved URL string
 */
export function resolveRouteTargetUrl(route: SiteRouteRule, presets: DestinationPreset[]): string {
  if (route.url.trim()) return route.url.trim();
  const preset = presets.find((p) => p.id === route.presetId);
  return preset?.url?.trim() ?? "";
}

/**
 * Validate site route configuration
 * @param route - SiteRouteRule
 * @param presets - Array of destination presets
 * @returns Error message if invalid, empty string if valid
 */
export function validateSiteRoute(route: SiteRouteRule, presets: DestinationPreset[]): string {
  const targetUrl = resolveRouteTargetUrl(route, presets);
  if (!targetUrl) return "Route must have a URL or preset";
  return validateUrl(targetUrl);
}

// ─── Response Processing ──────────────────────────────────────────────────

/**
 * Extract pretty-printed response body
 * @param response - ProxyResponse object
 * @returns Formatted response body string
 */
export function getPrettyResponseBody(response: ProxyResponse | null): string {
  if (!response?.body) return "";

  if (response.content_type?.includes("json")) {
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      // Fall through to return raw body
    }
  }

  return response.body;
}

/**
 * Check if response is JSON
 * @param response - ProxyResponse object
 * @returns True if response is JSON
 */
export function isJsonResponse(response: ProxyResponse | null): boolean {
  return response?.content_type?.includes("json") ?? false;
}

/**
 * Get response status text with emoji
 * @param status - HTTP status code
 * @returns Status text with emoji
 */
export function getStatusEmoji(status: number | null): string {
  if (!status) return "❌";
  if (status >= 200 && status < 300) return "✅";
  if (status >= 300 && status < 400) return "↪️";
  if (status >= 400 && status < 500) return "⚠️";
  return "🔥";
}

// ─── Data Filtering ───────────────────────────────────────────────────────

/**
 * Filter cameras by online status
 * @param cameras - Array of cameras
 * @returns Array of online cameras
 */
export function getOnlineCameras(cameras: any[]): any[] {
  return cameras.filter((c) => c.status === "ONLINE");
}

/**
 * Count cameras by status
 * @param cameras - Array of cameras
 * @returns Object with status counts
 */
export function countCamerasByStatus(cameras: any[]): Record<string, number> {
  return {
    online: cameras.filter((c) => c.status === "ONLINE").length,
    stale: cameras.filter((c) => c.status === "STALE").length,
    offline: cameras.filter((c) => c.status === "OFFLINE").length,
  };
}

/**
 * Count zones by occupancy
 * @param zones - Array of zones
 * @returns Object with occupancy counts
 */
export function countZonesByOccupancy(zones: any[]): Record<string, number> {
  return {
    occupied: zones.filter((z) => z.state === "OCCUPIED").length,
    available: zones.filter((z) => z.state !== "OCCUPIED").length,
    total: zones.length,
  };
}

// ─── Validation ────────────────────────────────────────────────────────────

/**
 * Validate send configuration
 * @param config - SendConfig object
 * @returns Error message if invalid, empty string if valid
 */
export function validateSendConfig(config: SendConfig): string {
  const urlError = validateUrl(config.url);
  if (urlError) return urlError;

  if (config.bodyMode === "json" && config.bodyText.trim()) {
    const jsonError = validateJson(config.bodyText);
    if (jsonError) return `Invalid JSON: ${jsonError}`;
  }

  return "";
}

/**
 * Check if config has required fields
 * @param config - SendConfig object
 * @returns True if all required fields are present
 */
export function isConfigComplete(config: SendConfig): boolean {
  return config.url.trim() !== "" && config.url !== "https://";
}

// ─── Clipboard ────────────────────────────────────────────────────────────

/**
 * Copy text to clipboard
 * @param text - Text to copy
 * @returns Promise that resolves when copy is complete
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

// ─── Storage ──────────────────────────────────────────────────────────────

/**
 * Safely parse JSON from localStorage
 * @param key - Storage key
 * @param defaultValue - Default value if parsing fails
 * @returns Parsed value or default
 */
export function getFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Safely save JSON to localStorage
 * @param key - Storage key
 * @param value - Value to save
 */
export function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Silently fail if storage is full or unavailable
  }
}

// ─── Debounce & Throttle ──────────────────────────────────────────────────

/**
 * Debounce function calls
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return ((...args: any[]) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

/**
 * Throttle function calls
 * @param fn - Function to throttle
 * @param delay - Delay in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let lastCall = 0;

  return ((...args: any[]) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      fn(...args);
    }
  }) as T;
}
