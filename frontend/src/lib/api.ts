/**
 * CamPark API client
 * All fetch calls go through Vite's dev proxy → http://localhost:8000
 * In production this file should read VITE_API_BASE from env.
 */

const BASE = import.meta.env.VITE_API_BASE ?? '';

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiSite {
  id: number;
  name: string;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  camera_count: number;
}

export interface ApiProject {
  id: number;
  name: string;
  sites: ApiSite[];
  camera_count: number;
  zone_count: number;
  created_at: string | null;
}

export interface ApiCamera {
  camera_id: string;
  name: string | null;
  project_id: number;
  site_id: number;
  site_name: string;
  brand: string | null;
  model: string | null;
  ingest_protocol: string;
  status: 'ONLINE' | 'STALE' | 'OFFLINE' | 'UNKNOWN';
  last_seen_at: string | null;
  ftp_pending: number | null;
  ftp_username: string | null;
  ftp_password: string | null;
}

export interface ApiZone {
  zone_id: string;
  name: string | null;
  camera_id: string;
  site_id: number;
  site_name: string;
  state: 'FREE' | 'OCCUPIED';
  occupied: number;
  capacity: number;
  last_change: string | null;
}

export interface ApiSystemSettings {
  operating_hours_start: string;
  operating_hours_end: string;
  scene_diff_threshold: string;
}

export interface ApiSnapshotDecision {
  id: number;
  camera_id: string;
  snapshot_id: number | null;
  incoming_file_path: string | null;
  decision_status: string;
  skip_reason: string | null;
  scene_diff_value: number | null;
  yolo_total_objects: number | null;
  yolo_vehicle_objects: number | null;
  error_message: string | null;
  created_at: string;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username: string, password: string): Promise<boolean> {
  const body = new URLSearchParams({ username, password });
  const res = await fetch(BASE + '/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'follow',
  });
  // Flask redirects to admin dashboard on success. If the final URL still contains
  // '/login', authentication failed.
  return res.ok && !res.url.includes('/login');
}

export async function logout(): Promise<void> {
  await fetch(BASE + '/logout', { credentials: 'include', redirect: 'follow' });
}

/** Returns true if the current session is authenticated. */
export async function checkAuth(): Promise<boolean> {
  const res = await fetch(BASE + '/admin/cameras.json', {
    credentials: 'include',
    redirect: 'manual',
  });
  // 0 = opaque redirect (redirected to /login), 200 = authenticated
  return res.status === 200;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function getProjects(): Promise<{ projects: ApiProject[] }> {
  return req('/admin/projects.json');
}

export async function apiCreateProject(project_name: string, site_name?: string): Promise<{
  project: { id: number; name: string };
  site: { id: number; name: string };
}> {
  return req('/admin/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_name, site_name: site_name ?? `${project_name}_SITE_01`, create_client: false }),
  });
}

export async function apiUpdateProject(projectId: number, payload: { name?: string }): Promise<void> {
  await req(`/admin/projects/${projectId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function apiDeleteProject(projectId: number): Promise<void> {
  await req(`/admin/projects/${projectId}`, { method: 'DELETE' });
}

// ─── Cameras ──────────────────────────────────────────────────────────────────

export async function getCameras(params?: {
  project_id?: number;
  site_id?: number;
}): Promise<{ cameras: ApiCamera[] }> {
  const qs = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return req(`/admin/cameras.json${qs}`);
}

export async function createCamera(payload: {
  camera_id: string;
  name?: string;
  site_id: number;
  brand?: string;
  model?: string;
  ingest_protocol?: string;
  ftp_username?: string;
  ftp_password?: string;
}): Promise<{ camera_id: string; ftp_username?: string; ingest_path?: string }> {
  return req('/admin/cameras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteCamera(cameraId: string): Promise<void> {
  await req(`/admin/cameras/${cameraId}`, { method: 'DELETE' });
}

export async function reassignCameraToSite(cameraId: string, siteId: number | null): Promise<{ camera_id: string; site_id: number }> {
  return req(`/admin/cameras/${encodeURIComponent(cameraId)}/site`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ site_id: siteId }),
  });
}

// ─── Sites ────────────────────────────────────────────────────────────────────

export async function createSite(payload: {
  project_id: number;
  name: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  city?: string;
}): Promise<{ site: ApiSite }> {
  return req('/admin/sites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateSite(siteId: number, payload: {
  name?: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  city?: string;
}): Promise<{ site: ApiSite }> {
  return req(`/admin/sites/${siteId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteSite(siteId: number): Promise<{ deleted: boolean; cameras_unassigned: number }> {
  return req(`/admin/sites/${siteId}`, { method: 'DELETE' });
}

// ─── Zones ────────────────────────────────────────────────────────────────────

export interface ZoneAdminEntry {
  zone_id: string;
  name: string | null;
  camera_id: string;
  polygon_json: string | null;
  state: 'FREE' | 'PARTIAL' | 'FULL';
  occupied: number;
  capacity: number;
  last_change: string | null;
}

export async function getZones(projectId: number): Promise<{
  project_id: number;
  project_name: string;
  zones: ApiZone[];
}> {
  return req(`/admin/projects/${projectId}/zones.json`);
}

export async function getZonesAdmin(params?: {
  project_id?: number;
  site_id?: number;
  camera_id?: string;
}): Promise<{ zones: ZoneAdminEntry[]; summary: { free: number; partial: number; full: number; total_capacity: number; total_occupied: number } }> {
  const qs = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return req(`/admin/zones.json${qs}`);
}

export async function createOrUpdateZone(payload: {
  camera_id: string;
  zone_id: string;
  polygon_json: string;
  name?: string;
  capacity_units?: number;
}): Promise<{ status: string }> {
  return req('/admin/zones', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteZone(camera_id: string, zone_id: string): Promise<void> {
  await req('/admin/zones/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_id, zone_id }),
  });
}

// ─── Zone Editor helpers ───────────────────────────────────────────────────────────────────────────────

export async function getZoneEditorRaw(cameraId: string): Promise<{
  zones: Array<{ zone_id: string; name?: string; camera_id?: string; polygon_json?: string; capacity?: number }>;
}> {
  return req(`/admin/zones/editor-raw.json?camera_id=${encodeURIComponent(cameraId)}`);
}

export async function bulkSaveZones(
  cameraId: string,
  zones: Array<{ zone_id: string; name: string; capacity_units: number; polygon_json: string }>,
  clearExisting: boolean,
): Promise<{ status: string; saved: number }> {
  return req('/admin/zones/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_id: cameraId, zones, clear_existing: clearExisting }),
  });
}

export async function deleteAllZones(cameraId: string): Promise<void> {
  await req('/admin/zones/delete-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ camera_id: cameraId }),
  });
}

// ─── System Settings ──────────────────────────────────────────────────────────

export async function getSystemSettings(): Promise<ApiSystemSettings> {
  return req('/admin/system/settings.json');
}

export async function saveSystemSettings(settings: Partial<ApiSystemSettings>): Promise<void> {
  await req('/admin/system/settings.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

// ─── Logs / Decisions ─────────────────────────────────────────────────────────

export async function getSnapshotDecisions(params?: {
  camera_id?: string;
  decision_status?: string;
  page?: number;
  limit?: number;
}): Promise<{ decisions: ApiSnapshotDecision[]; total: number; page: number }> {
  const qs = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return req(`/admin/snapshot-decisions.json${qs}`);
}

// ─── Camera Activity (per-camera detail) ─────────────────────────────────────

export interface ApiCameraActivity {
  camera_id: string;
  page: number;
  limit: number;
  total: number;
  snapshots: {
    id: number;
    received_at: string | null;
    processed_at: string | null;
    decision: string | null;
    skip_reason: string | null;
    vehicle_count: number | null;
    detection_count: number;
    has_image: boolean;
  }[];
  stats: {
    snapshots_today: number;
    processed_today: number;
    skipped_today: number;
    detections_today: number;
  };
}

export async function getCameraActivity(cameraId: string, params?: {
  page?: number;
  limit?: number;
  decision?: string;
}): Promise<ApiCameraActivity> {
  const qs = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return req(`/api/admin/cameras/${encodeURIComponent(cameraId)}/activity.json${qs}`);
}

export interface ApiCameraHealthEvent {
  health_status: string;
  triggered_at: string | null;
}

export async function getCameraHealth(cameraId: string): Promise<{
  camera_id: string;
  events: ApiCameraHealthEvent[];
}> {
  return req(`/api/admin/cameras/${encodeURIComponent(cameraId)}/health.json`);
}

// ─── Zone Events ──────────────────────────────────────────────────────────────

export interface ApiZoneEvent {
  id: number;
  zone_id: string;
  zone_name: string | null;
  camera_id: string;
  event_type: string;
  old_state: string | null;
  new_state: string | null;
  triggered_at: string | null;
}

export async function getZoneEvents(params?: {
  camera_id?: string;
  page?: number;
  limit?: number;
}): Promise<{ events: ApiZoneEvent[]; total: number }> {
  const qs = params
    ? '?' + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : '';
  return req(`/admin/events.json${qs}`);
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface ApiUser {
  id: number;
  username: string;
  role: 'admin' | 'supervisor' | 'viewer';
  status: 'active' | 'disabled';
  last_login_at: string | null;
  created_at: string | null;
}

export async function getUsers(): Promise<{ users: ApiUser[] }> {
  return req('/api/admin/users.json');
}

export async function createUser(payload: {
  username: string;
  password: string;
  role: string;
}): Promise<ApiUser> {
  return req('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateUser(userId: number, payload: {
  role?: string;
  status?: string;
  password?: string;
}): Promise<void> {
  await req(`/api/admin/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteUser(userId: number): Promise<void> {
  await req(`/api/admin/users/${userId}`, { method: 'DELETE' });
}

// ─── FTP Sync ─────────────────────────────────────────────────────────────────

export async function triggerFtpSync(): Promise<void> {
  await req('/admin/ftp-sync', { method: 'POST' });
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface ApiAnalyticsSummary {
  total_snapshots: number;
  processed: number;
  skipped: number;
  errors: number;
  detection_rate_pct: number;
  avg_latency_ms: number | null;
}

export interface ApiAnalyticsTimelinePoint {
  time: string;
  processed: number;
  skipped: number;
  error: number;
  total: number;
}

export interface ApiAnalyticsLatencyPoint {
  time: string;
  avg_ms: number;
}

export interface ApiAnalyticsSkipReason {
  reason: string;
  count: number;
}

export interface ApiAnalytics {
  period: string;
  project_id: number | null;
  summary: ApiAnalyticsSummary;
  snapshot_timeline: ApiAnalyticsTimelinePoint[];
  skip_reasons: ApiAnalyticsSkipReason[];
  latency_timeline: ApiAnalyticsLatencyPoint[];
}

export async function getAnalytics(
  projectId?: number,
  period: '1h' | '24h' | '7d' | '30d' = '24h'
): Promise<ApiAnalytics> {
  const params = new URLSearchParams({ period });
  if (projectId !== undefined) params.set('project_id', String(projectId));
  return req(`/admin/api/analytics?${params}`);
}

// ─── System Metrics ───────────────────────────────────────────────────────────

export interface ApiSystemMetricsSample {
  ts: string;
  cpu_pct: number;
  ram_pct: number;
  ram_used_gb: number;
  ram_total_gb: number;
  vm_disk_pct: number;
  vm_disk_free_gb: number;
  vm_disk_total_gb: number;
  data_disk_pct: number | null;
  data_disk_free_gb: number | null;
  data_disk_total_gb: number | null;
}

export interface ApiSystemMetrics {
  current: ApiSystemMetricsSample | null;
  trend: ApiSystemMetricsSample[];
  gcs_bucket_bytes: number | null;
  gcs_bucket_gb: number | null;
}

export async function getSystemMetrics(): Promise<ApiSystemMetrics> {
  return req('/admin/api/system-metrics');
}
