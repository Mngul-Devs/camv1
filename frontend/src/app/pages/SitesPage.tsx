import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router";
import { Camera, Plus, RefreshCw, Pencil, Trash2, MapPin, AlertCircle } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { toast } from "sonner";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useOrganization, type SiteLocation } from "../contexts/OrganizationContext";
import {
  getCameras, getZonesAdmin, createSite, updateSite, deleteSite, reassignCameraToSite,
  type ApiCamera, type ZoneAdminEntry,
} from "../../lib/api";
import { SiteMap } from "../components/SiteMap";

const UNASSIGNED = "__unassigned__";

// ─── Coordinate picker (mini map) ────────────────────────────────────────────

interface CoordPickerProps {
  lat: number | "";
  lng: number | "";
  onChange: (lat: number, lng: number) => void;
}

function CoordPicker({ lat, lng, onChange }: CoordPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const initLng = typeof lng === "number" ? lng : 35.0;
    const initLat = typeof lat === "number" ? lat : 31.5;
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: [initLng, initLat],
      zoom: typeof lat === "number" ? 14 : 8,
    });
    mapRef.current = m;
    if (typeof lat === "number" && typeof lng === "number") {
      markerRef.current = new maplibregl.Marker({ draggable: true, color: "#10b981" })
        .setLngLat([lng, lat])
        .addTo(m);
      markerRef.current.on("dragend", () => {
        const pos = markerRef.current!.getLngLat();
        onChange(Math.round(pos.lat * 1e6) / 1e6, Math.round(pos.lng * 1e6) / 1e6);
      });
    }
    m.on("click", (e) => {
      const { lng: clickLng, lat: clickLat } = e.lngLat;
      const rLat = Math.round(clickLat * 1e6) / 1e6;
      const rLng = Math.round(clickLng * 1e6) / 1e6;
      if (!markerRef.current) {
        markerRef.current = new maplibregl.Marker({ draggable: true, color: "#10b981" })
          .setLngLat([rLng, rLat])
          .addTo(m);
        markerRef.current.on("dragend", () => {
          const pos = markerRef.current!.getLngLat();
          onChange(Math.round(pos.lat * 1e6) / 1e6, Math.round(pos.lng * 1e6) / 1e6);
        });
      } else {
        markerRef.current.setLngLat([rLng, rLat]);
      }
      onChange(rLat, rLng);
    });
    return () => { m.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync marker when parent updates lat/lng (e.g. from manual input)
  useEffect(() => {
    if (!mapRef.current || typeof lat !== "number" || typeof lng !== "number") return;
    if (markerRef.current) {
      markerRef.current.setLngLat([lng, lat]);
    } else {
      markerRef.current = new maplibregl.Marker({ draggable: true, color: "#10b981" })
        .setLngLat([lng, lat])
        .addTo(mapRef.current);
      markerRef.current.on("dragend", () => {
        const pos = markerRef.current!.getLngLat();
        onChange(Math.round(pos.lat * 1e6) / 1e6, Math.round(pos.lng * 1e6) / 1e6);
      });
    }
    mapRef.current.flyTo({ center: [lng, lat], zoom: 14, duration: 400 });
  }, [lat, lng, onChange]);

  return <div ref={containerRef} className="w-full h-44 rounded-md overflow-hidden" />;
}

// ─── Site form dialog (create / edit) ────────────────────────────────────────

interface SiteFormDialogProps {
  mode: "create" | "edit";
  projectId: number;
  site?: SiteLocation;
  onClose: () => void;
  onSuccess: () => void;
}

interface GeoSuggestion {
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    country?: string;
  };
}

function SiteFormDialog({ mode, projectId, site, onClose, onSuccess }: SiteFormDialogProps) {
  const [name, setName] = useState(site?.name ?? "");
  const [city, setCity] = useState(site?.city ?? "");
  const [location, setLocation] = useState(site?.address ?? "");
  const [lat, setLat] = useState<number | "">(typeof site?.lat === "number" ? site.lat : "");
  const [lng, setLng] = useState<number | "">(typeof site?.lng === "number" ? site.lng : "");
  const [coordMode, setCoordMode] = useState<"map" | "manual">("map");
  const [loading, setLoading] = useState(false);

  // Geocoding state
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressBoxRef = useRef<HTMLDivElement>(null);

  const handleCoordChange = useCallback((newLat: number, newLng: number) => {
    setLat(newLat);
    setLng(newLng);
  }, []);

  // Debounced geocode via Nominatim (OpenStreetMap) — no API key required
  function handleAddressInput(value: string) {
    setLocation(value);
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 3) { setShowSuggestions(false); return; }
    debounceRef.current = setTimeout(async () => {
      setGeoLoading(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(value)}&format=json&limit=6&addressdetails=1`,
          { headers: { "Accept-Language": "en" } }
        );
        const data: GeoSuggestion[] = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch {
        // silently ignore
      } finally {
        setGeoLoading(false);
      }
    }, 400);
  }

  function handleSelectSuggestion(s: GeoSuggestion) {
    const rLat = Math.round(parseFloat(s.lat) * 1e6) / 1e6;
    const rLng = Math.round(parseFloat(s.lon) * 1e6) / 1e6;
    const extractedCity = s.address?.city || s.address?.town || s.address?.village || s.address?.municipality || s.address?.county || "";
    setLocation(s.display_name);
    if (extractedCity && !city) setCity(extractedCity);
    setLat(rLat);
    setLng(rLng);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  // Close suggestions on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (addressBoxRef.current && !addressBoxRef.current.contains(e.target as Node))
        setShowSuggestions(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { toast.error("Site name is required"); return; }
    setLoading(true);
    try {
      const payload = {
        project_id: projectId,
        name: name.trim(),
        city: city.trim() || undefined,
        location: location.trim() || undefined,
        latitude: typeof lat === "number" ? lat : undefined,
        longitude: typeof lng === "number" ? lng : undefined,
      };
      if (mode === "create") {
        await createSite(payload);
        toast.success("Site created");
      } else {
        await updateSite(Number(site!.id), payload);
        toast.success("Site updated");
      }
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save site");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#161b22] border-[#2a2f36] text-[#e6edf3] max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Site" : "Edit Site"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Site Name */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-[#9da7b3]">Site Name *</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Main Lot"
              className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-8 text-sm"
            />
          </div>

          {/* City */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-[#9da7b3]">City</Label>
            <Input
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="e.g. Shah Alam"
              className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-8 text-sm"
            />
          </div>

          {/* Address search with autocomplete */}
          <div className="flex flex-col gap-1.5" ref={addressBoxRef}>
            <Label className="text-xs text-[#9da7b3]">
              Address / Search
              {geoLoading && <span className="ml-1.5 text-[#9da7b3] animate-pulse">searching…</span>}
            </Label>
            <div className="relative">
              <Input
                value={location}
                onChange={e => handleAddressInput(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="Type an address to search and pin on map…"
                className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-8 text-sm"
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-50 top-full mt-1 left-0 right-0 bg-[#1c2128] border border-[#2a2f36] rounded-md shadow-xl max-h-52 overflow-y-auto">
                  {suggestions.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-2 text-xs text-[#e6edf3] hover:bg-[#2a2f36] transition-colors flex items-start gap-2"
                        onMouseDown={() => handleSelectSuggestion(s)}
                      >
                        <MapPin className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{s.display_name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {typeof lat === "number" && typeof lng === "number" && (
              <p className="text-[10px] text-emerald-400">✓ Pinned at {lat}, {lng}</p>
            )}
          </div>

          {/* Coord fine-tune tabs */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-[#9da7b3]">Fine-tune Coordinates</Label>
              <div className="flex gap-1 ml-auto">
                {(["map", "manual"] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCoordMode(m)}
                    className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                      coordMode === m
                        ? "bg-emerald-600 text-white"
                        : "bg-[#1c2128] text-[#9da7b3] hover:text-[#e6edf3]"
                    }`}
                  >
                    {m === "map" ? "Click on map" : "Enter manually"}
                  </button>
                ))}
              </div>
            </div>
            {coordMode === "map" ? (
              <CoordPicker lat={lat} lng={lng} onChange={handleCoordChange} />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-[#9da7b3]">Latitude</Label>
                  <Input
                    type="number" step="any" value={lat}
                    onChange={e => setLat(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    placeholder="3.085087"
                    className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-8 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] text-[#9da7b3]">Longitude</Label>
                  <Input
                    type="number" step="any" value={lng}
                    onChange={e => setLng(e.target.value === "" ? "" : parseFloat(e.target.value))}
                    placeholder="101.513452"
                    className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-8 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" className="border-[#2a2f36] text-[#9da7b3]"
              onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={loading}>
              {loading ? "Saving…" : mode === "create" ? "Create Site" : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirmation dialog ───────────────────────────────────────────────

interface DeleteSiteDialogProps {
  site: SiteLocation;
  cameraCount: number;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function DeleteSiteDialog({ site, cameraCount, loading, onClose, onConfirm }: DeleteSiteDialogProps) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-[#161b22] border-[#2a2f36] text-[#e6edf3] max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete Site</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-1">
          <p className="text-sm text-[#9da7b3]">
            Are you sure you want to delete <span className="text-[#e6edf3] font-medium">{site.name}</span>?
          </p>
          {cameraCount > 0 && (
            <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/40 rounded-md p-3">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                {cameraCount} camera{cameraCount !== 1 ? "s" : ""} will be moved to{" "}
                <span className="font-medium">Unassigned</span>.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="border-[#2a2f36] text-[#9da7b3]"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Deleting…" : "Delete Site"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Camera card with snapshot + zone overlay ─────────────────────────────────

interface CameraCardProps {
  camera: ApiCamera;
  zones: ZoneAdminEntry[];
  showReassign?: boolean;
  availableSites?: SiteLocation[];
  onReassign?: () => void;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const STATUS_DOT: Record<string, string> = {
  ONLINE: "bg-emerald-400",
  STALE: "bg-yellow-400",
  OFFLINE: "bg-red-400",
  UNKNOWN: "bg-gray-500",
};

function CameraCard({ camera, zones, showReassign = false, availableSites = [], onReassign }: CameraCardProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const drawZones = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !imgLoaded) return;
    canvas.width = img.clientWidth;
    canvas.height = img.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const zone of zones) {
      if (!zone.polygon_json) continue;
      let pts: [number, number][];
      try { pts = JSON.parse(zone.polygon_json); } catch { continue; }
      if (!pts || pts.length < 3) continue;
      const isOccupied = zone.state === "FULL" || zone.state === "PARTIAL";
      ctx.beginPath();
      ctx.moveTo((pts[0][0] / 100) * canvas.width, (pts[0][1] / 100) * canvas.height);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo((pts[i][0] / 100) * canvas.width, (pts[i][1] / 100) * canvas.height);
      }
      ctx.closePath();
      ctx.fillStyle = isOccupied ? "rgba(239,68,68,0.22)" : "rgba(34,197,94,0.18)";
      ctx.strokeStyle = isOccupied ? "#ef4444" : "#22c55e";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
  }, [zones, imgLoaded]);

  useEffect(() => { drawZones(); }, [drawZones]);
  useEffect(() => {
    window.addEventListener("resize", drawZones);
    return () => window.removeEventListener("resize", drawZones);
  }, [drawZones]);

  const totalAvailable = zones.reduce((s, z) => s + Math.max(0, z.capacity - z.occupied), 0);
  const totalOccupied = zones.reduce((s, z) => s + z.occupied, 0);
  const imgSrc = `/api/v1/cameras/${encodeURIComponent(camera.camera_id)}/snapshot-latest`;

  return (
    <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg overflow-hidden flex flex-col">
      <div className="relative bg-[#111113] aspect-video">
        {!imgError ? (
          <>
            <img
              ref={imgRef}
              src={imgSrc}
              alt={camera.name ?? camera.camera_id}
              className="w-full h-full object-cover"
              onLoad={() => { setImgLoaded(true); drawZones(); }}
              onError={() => setImgError(true)}
            />
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600">
            <Camera className="w-8 h-8" />
            <span className="text-xs">No snapshot</span>
          </div>
        )}
        <div className="absolute top-1.5 right-1.5">
          <span className={`inline-block w-2 h-2 rounded-full shadow ${STATUS_DOT[camera.status] ?? STATUS_DOT.UNKNOWN}`} />
        </div>
      </div>
      <div className="px-3 py-2 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-xs text-[#e6edf3] truncate font-medium">{camera.name ?? camera.camera_id}</span>
          <span className="text-[10px] text-[#9da7b3] shrink-0">{relativeTime(camera.last_seen_at)}</span>
        </div>
        <div className="text-[10px] text-[#9da7b3] truncate">
          {camera.site_name === UNASSIGNED ? "(Unassigned)" : camera.site_name}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className="flex items-center gap-1 text-[11px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            {totalAvailable} available
          </span>
          <span className="flex items-center gap-1 text-[11px] text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
            {totalOccupied} occupied
          </span>
        </div>
        {showReassign && availableSites.length > 0 && (
          <Select
            onValueChange={async (val) => {
              try {
                await reassignCameraToSite(camera.camera_id, val === "__null__" ? null : Number(val));
                toast.success("Camera reassigned");
                onReassign?.();
              } catch {
                toast.error("Failed to reassign camera");
              }
            }}
          >
            <SelectTrigger className="h-6 text-[11px] mt-1 bg-[#111113] border-dashed border-[#2a2f36] text-[#9da7b3]">
              <SelectValue placeholder="Assign to site…" />
            </SelectTrigger>
            <SelectContent className="bg-[#1c2128] border-[#2a2f36] text-[#e6edf3]">
              {availableSites.map(s => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

// ─── Main Sites Page ──────────────────────────────────────────────────────────

export function SitesPage() {
  const { selectedProject, reload } = useOrganization();
  const [searchParams] = useSearchParams();
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [zones, setZones] = useState<ZoneAdminEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // dialogs
  const [showAddSite, setShowAddSite] = useState(false);
  const [editingSite, setEditingSite] = useState<SiteLocation | null>(null);
  const [deletingSite, setDeletingSite] = useState<SiteLocation | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // sidebar selection: "__ALL__" | "__UNASSIGNED__" | "<site id>"
  const [selectedSiteId, setSelectedSiteId] = useState<string>("__ALL__");

  const flyToRef = useRef<((lng: number, lat: number) => void) | undefined>(undefined);

  const allContextSites: SiteLocation[] = selectedProject?.sites ?? [];
  const normalSites = allContextSites.filter(s => s.name !== UNASSIGNED);
  const unassignedSiteCtx = allContextSites.find(s => s.name === UNASSIGNED);

  // Reset selection when project changes; honour ?site=<id> param
  useEffect(() => {
    const siteParam = searchParams.get("site");
    setSelectedSiteId(siteParam ?? "__ALL__");
  }, [selectedProject?.id, searchParams]);

  const fetchData = useCallback(() => {
    if (!selectedProject) { setCameras([]); setZones([]); return; }
    setIsLoading(true);
    Promise.all([
      getCameras({ project_id: Number(selectedProject.id) }),
      getZonesAdmin({ project_id: Number(selectedProject.id) }),
    ]).then(([camRes, zoneRes]) => {
      setCameras(camRes.cameras);
      setZones(zoneRes.zones);
    }).catch(() => {
      setCameras([]);
      setZones([]);
    }).finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSiteSelect = useCallback((siteId: string) => {
    setSelectedSiteId(siteId);
    if (siteId !== "__ALL__" && siteId !== "__UNASSIGNED__") {
      const site = normalSites.find(s => s.id === siteId);
      if (site && typeof site.lat === "number" && typeof site.lng === "number") {
        flyToRef.current?.(site.lng, site.lat);
      }
    }
  }, [normalSites]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingSite) return;
    setDeleteLoading(true);
    try {
      await deleteSite(Number(deletingSite.id));
      toast.success("Site deleted");
      setDeletingSite(null);
      if (selectedSiteId === deletingSite.id) setSelectedSiteId("__ALL__");
      await reload();
      fetchData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete site");
    } finally {
      setDeleteLoading(false);
    }
  }, [deletingSite, selectedSiteId, reload, fetchData]);

  // Compute visible cameras
  const visibleCameras = (() => {
    if (selectedSiteId === "__ALL__") return cameras.filter(c => c.site_name !== UNASSIGNED || !unassignedSiteCtx);
    if (selectedSiteId === "__UNASSIGNED__") {
      const unassignedId = unassignedSiteCtx?.id;
      return unassignedId ? cameras.filter(c => String(c.site_id) === unassignedId) : [];
    }
    return cameras.filter(c => String(c.site_id) === selectedSiteId);
  })();

  const unassignedCameras = unassignedSiteCtx
    ? cameras.filter(c => String(c.site_id) === unassignedSiteCtx.id)
    : [];

  // Stats (exclude unassigned from normal counts)
  const normalCameras = cameras.filter(c => c.site_name !== UNASSIGNED);
  const totalAvailable = zones.reduce((s, z) => s + Math.max(0, z.capacity - z.occupied), 0);
  const totalOccupied = zones.reduce((s, z) => s + z.occupied, 0);
  const onlineCount = normalCameras.filter(c => c.status === "ONLINE").length;

  const showReassignInGrid = selectedSiteId === "__UNASSIGNED__";

  return (
    <div className="p-5 flex flex-col gap-4 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg text-[#e6edf3]">Sites</h1>
          <p className="text-xs text-[#9da7b3]">Monitor parking sites and camera locations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="bg-[#111113] border-[#2a2f36] text-[#9da7b3] hover:text-[#e6edf3] h-8 w-8 p-0"
            onClick={fetchData}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 h-8 text-xs"
            onClick={() => setShowAddSite(true)}
          >
            <Plus className="w-3.5 h-3.5" /> Add Site
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <StatCard label="Total Sites" value={normalSites.length} />
        <StatCard label="Cameras Online" value={`${onlineCount}/${normalCameras.length}`} color="text-emerald-400" />
        <StatCard label="Available Spots" value={totalAvailable} color="text-emerald-400" />
        <StatCard label="Occupied Spots" value={totalOccupied} color="text-red-400" />
      </div>

      {/* Map + sidebar + camera grid */}
      <div className="flex gap-4 flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="w-52 shrink-0 flex flex-col gap-1.5 overflow-y-auto">
          {/* All Sites button */}
          <button
            onClick={() => handleSiteSelect("__ALL__")}
            className={`w-full text-left rounded-md px-3 py-2 border transition-all text-xs font-medium ${
              selectedSiteId === "__ALL__"
                ? "bg-[#1c2128] border-emerald-500/50 text-[#e6edf3]"
                : "bg-[#111113] border-[#2a2f36] hover:border-[#3a3f46] text-[#9da7b3]"
            }`}
          >
            All Sites
          </button>

          {normalSites.length === 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-gray-600 px-1 pt-1">
              <MapPin className="w-3 h-3" /> No sites yet
            </div>
          )}

          {normalSites.map(site => {
            const siteCams = cameras.filter(c => String(c.site_id) === site.id);
            const siteOnline = siteCams.filter(c => c.status === "ONLINE").length;
            const isSelected = selectedSiteId === site.id;
            return (
              <div
                key={site.id}
                className={`group relative rounded-md border transition-all ${
                  isSelected
                    ? "bg-[#1c2128] border-emerald-500/50"
                    : "bg-[#111113] border-[#2a2f36] hover:border-[#3a3f46]"
                }`}
              >
                <button
                  onClick={() => handleSiteSelect(site.id)}
                  className="w-full text-left px-3 py-2.5 pr-14"
                >
                  <div className="text-xs text-[#e6edf3] truncate font-medium">{site.name}</div>
                  <div className="text-[10px] text-[#9da7b3] mt-0.5 truncate">{site.address || "—"}</div>
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${siteOnline > 0 ? "bg-emerald-400" : "bg-gray-600"}`} />
                    <span className="text-[10px] text-[#9da7b3]">{siteOnline}/{siteCams.length} online</span>
                  </div>
                </button>
                {/* Edit / Delete icons */}
                <div className="absolute right-1.5 top-2 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    className="p-1 rounded hover:bg-[#2a2f36] text-[#9da7b3] hover:text-[#e6edf3]"
                    onClick={e => { e.stopPropagation(); setEditingSite(site); }}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    className="p-1 rounded hover:bg-red-900/30 text-[#9da7b3] hover:text-red-400"
                    onClick={e => { e.stopPropagation(); setDeletingSite(site); }}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Unassigned section */}
          {unassignedCameras.length > 0 && (
            <button
              onClick={() => handleSiteSelect("__UNASSIGNED__")}
              className={`w-full text-left rounded-md px-3 py-2 border transition-all text-xs mt-1 ${
                selectedSiteId === "__UNASSIGNED__"
                  ? "bg-[#1c2128] border-amber-500/50 text-[#e6edf3]"
                  : "bg-[#111113] border-[#2a2f36] hover:border-[#3a3f46] text-[#9da7b3]"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 text-amber-400" />
                Unassigned ({unassignedCameras.length})
              </span>
            </button>
          )}
        </div>

        {/* Right: map (top) + camera grid (bottom) */}
        <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* Map */}
          <div className="h-52 shrink-0 rounded-lg overflow-hidden border border-[#2a2f36]">
            <SiteMap
              sites={normalSites}
              selectedSiteId={selectedSiteId !== "__ALL__" && selectedSiteId !== "__UNASSIGNED__" ? selectedSiteId : null}
              onSiteSelect={handleSiteSelect}
              onSiteClick={() => {}}
              flyToRef={flyToRef}
            />
          </div>

          {/* Camera grid */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-[#9da7b3] text-sm">Loading…</div>
            ) : visibleCameras.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-600">
                <Camera className="w-8 h-8" />
                <span className="text-sm">
                  {selectedSiteId === "__UNASSIGNED__" ? "No unassigned cameras" : "No cameras in this site"}
                </span>
              </div>
            ) : (
              <>
                {showReassignInGrid && (
                  <p className="text-[11px] text-amber-400 mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    These cameras are unassigned. Use the dropdown to move them to a site.
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 pb-4">
                  {visibleCameras.map(cam => (
                    <CameraCard
                      key={cam.camera_id}
                      camera={cam}
                      zones={zones.filter(z => z.camera_id === cam.camera_id)}
                      showReassign={showReassignInGrid}
                      availableSites={normalSites}
                      onReassign={async () => { await reload(); fetchData(); }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {showAddSite && selectedProject && (
        <SiteFormDialog
          mode="create"
          projectId={Number(selectedProject.id)}
          onClose={() => setShowAddSite(false)}
          onSuccess={async () => { setShowAddSite(false); await reload(); fetchData(); }}
        />
      )}
      {editingSite && selectedProject && (
        <SiteFormDialog
          mode="edit"
          projectId={Number(selectedProject.id)}
          site={editingSite}
          onClose={() => setEditingSite(null)}
          onSuccess={async () => { setEditingSite(null); await reload(); fetchData(); }}
        />
      )}
      {deletingSite && (
        <DeleteSiteDialog
          site={deletingSite}
          cameraCount={cameras.filter(c => String(c.site_id) === deletingSite.id).length}
          loading={deleteLoading}
          onClose={() => setDeletingSite(null)}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg p-3">
      <div className="text-[10px] text-[#9da7b3] uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-light ${color ?? "text-[#e6edf3]"}`}>{value}</div>
    </div>
  );
}


