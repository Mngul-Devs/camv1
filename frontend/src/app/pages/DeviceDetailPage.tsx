import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Camera,
  CheckCircle,
  SkipForward,
  AlertCircle,
  RefreshCw,
  Grid3X3,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  getCameras,
  getCameraActivity,
  getCameraHealth,
  getZoneEvents,
  type ApiCamera,
  type ApiCameraActivity,
  type ApiCameraHealthEvent,
  type ApiZoneEvent,
} from "../../lib/api";

const API_BASE = "/api/v1";

type HealthStatus = "ONLINE" | "STALE" | "OFFLINE" | "UNKNOWN";

function getStatusBadge(status: string) {
  const s = status.toUpperCase();
  if (s === "ONLINE") return (
    <Badge className="bg-[#3fb950]/10 text-[#3fb950] border-[#3fb950]/30 gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" /> ONLINE
    </Badge>
  );
  if (s === "STALE") return (
    <Badge className="bg-[#d29922]/10 text-[#d29922] border-[#d29922]/30 gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#d29922]" /> STALE
    </Badge>
  );
  if (s === "OFFLINE") return (
    <Badge className="bg-[#9da7b3]/10 text-[#9da7b3] border-[#9da7b3]/30 gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#9da7b3]" /> OFFLINE
    </Badge>
  );
  return (
    <Badge className="bg-[#8b949e]/10 text-[#8b949e] border-[#8b949e]/30 gap-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-[#8b949e]" /> UNKNOWN
    </Badge>
  );
}

function PasswordCell({ value }: { value: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="flex items-center gap-1.5 font-mono">
      {show ? value : '••••••••'}
      <button
        onClick={() => setShow(s => !s)}
        className="text-[10px] text-[#58a6ff] hover:text-white transition-colors leading-none"
      >
        {show ? 'hide' : 'show'}
      </button>
    </span>
  );
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export function DeviceDetailPage() {
  const { deviceId, projectId } = useParams<{ deviceId: string; projectId: string }>();
  const navigate = useNavigate();

  const [camera, setCamera] = useState<ApiCamera | null>(null);
  const [activity, setActivity] = useState<ApiCameraActivity | null>(null);
  const [healthEvents, setHealthEvents] = useState<ApiCameraHealthEvent[]>([]);
  const [zoneEvents, setZoneEvents] = useState<ApiZoneEvent[]>([]);
  const [zoneEventsTotal, setZoneEventsTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [snapshotFilter, setSnapshotFilter] = useState("all");
  const [snapshotPage, setSnapshotPage] = useState(1);
  const [zoneEventsPage, setZoneEventsPage] = useState(1);
  const [snapshotImgError, setSnapshotImgError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const SNAP_LIMIT = 15;
  const ZE_LIMIT = 10;

  const loadData = useCallback(async () => {
    if (!deviceId) return;
    try {
      const [camsRes, actRes, healthRes, zeRes] = await Promise.all([
        getCameras(),
        getCameraActivity(deviceId, {
          page: snapshotPage,
          limit: SNAP_LIMIT,
          decision: snapshotFilter === "all" ? undefined : snapshotFilter,
        }),
        getCameraHealth(deviceId),
        getZoneEvents({ camera_id: deviceId, page: zoneEventsPage, limit: ZE_LIMIT }),
      ]);
      const cam = camsRes.cameras.find(c => c.camera_id === deviceId) ?? null;
      setCamera(cam);
      setActivity(actRes);
      setHealthEvents(healthRes.events ?? []);
      setZoneEvents(zeRes.events ?? []);
      setZoneEventsTotal(zeRes.total ?? 0);
    } catch {
      // API may 404 for non-existent camera
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [deviceId, snapshotPage, snapshotFilter, zoneEventsPage]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = () => {
    setRefreshing(true);
    setSnapshotImgError(false);
    loadData();
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[#9da7b3]" />
      </div>
    );
  }

  if (!camera) {
    return (
      <div className="p-6">
        <div className="text-center py-20">
          <Camera className="w-10 h-10 text-[#9da7b3] mx-auto mb-3" />
          <p className="text-[#9da7b3] text-lg mb-4">Camera "{deviceId}" not found</p>
          <Button
            variant="outline"
            onClick={() => navigate(`/app/project/${projectId}/devices`)}
            className="border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36]"
          >
            Back to Devices
          </Button>
        </div>
      </div>
    );
  }

  const stats = activity?.stats ?? { snapshots_today: 0, processed_today: 0, skipped_today: 0, detections_today: 0 };
  const snapshots = activity?.snapshots ?? [];
  const totalSnapshots = activity?.total ?? 0;
  const totalSnapshotPages = Math.max(1, Math.ceil(totalSnapshots / SNAP_LIMIT));
  const totalZonePages = Math.max(1, Math.ceil(zoneEventsTotal / ZE_LIMIT));

  const snapshotUrl = `${API_BASE}/cameras/${encodeURIComponent(camera.camera_id)}/snapshot-latest`;

  const statCards = [
    { icon: <Camera className="w-5 h-5" />, iconBg: "bg-blue-500/10", iconColor: "text-blue-400", value: stats.snapshots_today, label: "Snapshots Today" },
    { icon: <CheckCircle className="w-5 h-5" />, iconBg: "bg-emerald-500/10", iconColor: "text-emerald-400", value: stats.processed_today, label: "Processed" },
    { icon: <SkipForward className="w-5 h-5" />, iconBg: "bg-amber-500/10", iconColor: "text-amber-400", value: stats.skipped_today, label: "Skipped" },
    { icon: <AlertCircle className="w-5 h-5" />, iconBg: "bg-red-500/10", iconColor: "text-red-400", value: stats.detections_today, label: "Detections Today" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#9da7b3]">
        <button onClick={() => navigate(`/app/project/${projectId}/dashboard`)} className="hover:text-[#e6edf3] transition-colors">Dashboard</button>
        <span>/</span>
        <button onClick={() => navigate(`/app/project/${projectId}/devices`)} className="hover:text-[#e6edf3] transition-colors">Devices</button>
        <span>/</span>
        <span className="text-[#e6edf3]">{camera.name ?? camera.camera_id}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">{camera.name ?? camera.camera_id}</h1>
          <p className="text-sm text-[#9da7b3]">
            {camera.camera_id} · {camera.brand?.toUpperCase()} · {camera.ingest_protocol ?? "FTP"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {getStatusBadge(camera.status)}
          <Button
            variant="outline"
            className="border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36] gap-2"
            onClick={() => navigate(`/app/project/${projectId}/zones`)}
          >
            <Grid3X3 className="w-4 h-4" />
            Zone Editor
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-[#9da7b3] hover:text-[#e6edf3]"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((card, i) => (
          <div key={i} className="bg-[#1c2128] border border-[#2a2f36] rounded-lg p-4">
            <div className={`w-10 h-10 rounded-lg ${card.iconBg} flex items-center justify-center mb-3 ${card.iconColor}`}>
              {card.icon}
            </div>
            <div className="text-2xl text-[#e6edf3] mb-1">{card.value}</div>
            <div className="text-sm text-[#9da7b3]">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - 2/3 */}
        <div className="lg:col-span-2 space-y-6">
          {/* Snapshot Records */}
          <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg">
            <div className="flex items-center justify-between p-4 border-b border-[#2a2f36]">
              <h2 className="text-[#e6edf3] text-sm">Snapshot Records</h2>
              <div className="flex items-center gap-2">
                <Select value={snapshotFilter} onValueChange={(v) => { setSnapshotFilter(v); setSnapshotPage(1); }}>
                  <SelectTrigger className="w-[110px] bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
                    <SelectItem value="all" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">All</SelectItem>
                    <SelectItem value="processed" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Processed</SelectItem>
                    <SelectItem value="skipped" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Skipped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-[#2a2f36] hover:bg-transparent">
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Received</TableHead>
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Status</TableHead>
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Reason</TableHead>
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Vehicles</TableHead>
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Detections</TableHead>
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Image</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6 text-[#9da7b3] text-sm">
                      No snapshots found
                    </TableCell>
                  </TableRow>
                ) : (
                  snapshots.map((snap) => (
                    <TableRow key={snap.id} className="border-[#2a2f36] hover:bg-[#161a1f]">
                      <TableCell className="text-[#e6edf3] text-sm font-mono">{formatTime(snap.received_at)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-xs ${
                            snap.decision === "processed"
                              ? "text-[#3fb950] border-[#3fb950]/30"
                              : "text-[#d29922] border-[#d29922]/30"
                          }`}
                        >
                          {snap.decision ?? "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[#9da7b3] text-sm">{snap.skip_reason || "—"}</TableCell>
                      <TableCell className="text-[#e6edf3] text-sm">{snap.vehicle_count ?? 0}</TableCell>
                      <TableCell className="text-[#e6edf3] text-sm">{snap.detection_count}</TableCell>
                      <TableCell>
                        {snap.has_image ? (
                          <ImageIcon className="w-4 h-4 text-[#58a6ff]" />
                        ) : (
                          <span className="text-[#9da7b3] text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#2a2f36]">
              <span className="text-xs text-[#9da7b3]">{totalSnapshots} total</span>
              <div className="flex items-center gap-2 text-sm text-[#9da7b3]">
                <button
                  onClick={() => setSnapshotPage(Math.max(1, snapshotPage - 1))}
                  disabled={snapshotPage <= 1}
                  className="hover:text-[#e6edf3] transition-colors disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-[#e6edf3]">
                  {snapshotPage} / {totalSnapshotPages}
                </span>
                <button
                  onClick={() => setSnapshotPage(Math.min(totalSnapshotPages, snapshotPage + 1))}
                  disabled={snapshotPage >= totalSnapshotPages}
                  className="hover:text-[#e6edf3] transition-colors disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>

          {/* Zone Events */}
          <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg">
            <div className="flex items-center justify-between p-4 border-b border-[#2a2f36]">
              <h2 className="text-[#e6edf3] text-sm">Zone Events</h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="border-[#2a2f36] hover:bg-transparent">
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Time</TableHead>
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Type</TableHead>
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Zone</TableHead>
                  <TableHead className="text-[#9da7b3] text-xs uppercase">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zoneEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-[#9da7b3] text-sm">
                      No zone events
                    </TableCell>
                  </TableRow>
                ) : (
                  zoneEvents.map((event) => (
                    <TableRow key={event.id} className="border-[#2a2f36] hover:bg-[#161a1f]">
                      <TableCell className="text-[#e6edf3] text-sm font-mono">{formatDateTime(event.triggered_at)}</TableCell>
                      <TableCell className="text-[#9da7b3] text-sm">{event.event_type}</TableCell>
                      <TableCell className="text-[#e6edf3] text-sm">{event.zone_name ?? event.zone_id}</TableCell>
                      <TableCell className="text-[#9da7b3] text-sm">
                        {event.old_state && event.new_state
                          ? `${event.old_state} → ${event.new_state}`
                          : event.new_state ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#2a2f36]">
              <span className="text-xs text-[#9da7b3]">{zoneEventsTotal} events</span>
              <div className="flex items-center gap-2 text-sm text-[#9da7b3]">
                <button
                  onClick={() => setZoneEventsPage(Math.max(1, zoneEventsPage - 1))}
                  disabled={zoneEventsPage <= 1}
                  className="hover:text-[#e6edf3] transition-colors disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-[#e6edf3]">{zoneEventsPage} / {totalZonePages}</span>
                <button
                  onClick={() => setZoneEventsPage(Math.min(totalZonePages, zoneEventsPage + 1))}
                  disabled={zoneEventsPage >= totalZonePages}
                  className="hover:text-[#e6edf3] transition-colors disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right column - 1/3 */}
        <div className="space-y-6">
          {/* Latest Snapshot */}
          <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg">
            <div className="p-4 border-b border-[#2a2f36]">
              <h2 className="text-[#e6edf3] text-sm">Latest Snapshot</h2>
            </div>
            <div className="p-4">
              {snapshotImgError ? (
                <div className="w-full aspect-video bg-[#0f1115] rounded-lg flex items-center justify-center border border-[#2a2f36]">
                  <div className="text-center">
                    <ImageIcon className="w-8 h-8 text-[#9da7b3] mx-auto mb-2" />
                    <p className="text-sm text-[#9da7b3]">No snapshot available</p>
                  </div>
                </div>
              ) : (
                <img
                  src={snapshotUrl}
                  alt={`Latest ${camera.camera_id}`}
                  className="w-full rounded-lg border border-[#2a2f36]"
                  onError={() => setSnapshotImgError(true)}
                />
              )}
            </div>
          </div>

          {/* Device Info */}
          <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg">
            <div className="p-4 border-b border-[#2a2f36]">
              <h2 className="text-[#e6edf3] text-sm">Device Info</h2>
            </div>
            <div className="divide-y divide-[#2a2f36]">
              {[
                { label: "Camera ID",    value: camera.camera_id, mono: true },
                { label: "Site",         value: camera.site_name },
                { label: "Brand",        value: camera.brand?.toUpperCase() ?? "—" },
                { label: "Protocol",     value: camera.ingest_protocol?.toUpperCase() ?? "FTP", highlight: true },
                { label: "Status",       value: camera.status },
                { label: "Last Seen",    value: camera.last_seen_at ? formatDateTime(camera.last_seen_at) : "—" },
                { label: "FTP Username", value: camera.ftp_username ?? "—", mono: true },
                { label: "FTP Password", value: camera.ftp_password ?? "—", mono: true, sensitive: true },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-[#9da7b3]">{row.label}</span>
                  <span className={`text-sm ${
                    row.highlight ? "text-[#58a6ff]" :
                    row.mono ? "font-mono text-[#e6edf3]" :
                    "text-[#e6edf3]"
                  }`}>
                    {row.sensitive && row.value !== "—" ? (
                      <PasswordCell value={row.value} />
                    ) : row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Health History */}
          <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg">
            <div className="p-4 border-b border-[#2a2f36]">
              <h2 className="text-[#e6edf3] text-sm">Health History</h2>
            </div>
            <div className="p-4">
              {healthEvents.length === 0 ? (
                <p className="text-sm text-[#9da7b3]">No health transitions recorded</p>
              ) : (
                <div className="space-y-2">
                  {healthEvents.map((entry, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-[#9da7b3] font-mono text-xs">{formatDateTime(entry.triggered_at)}</span>
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          entry.health_status === "ONLINE"
                            ? "text-[#3fb950] border-[#3fb950]/30"
                            : entry.health_status === "STALE"
                            ? "text-[#d29922] border-[#d29922]/30"
                            : "text-[#9da7b3] border-[#9da7b3]/30"
                        }`}
                      >
                        {entry.health_status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
