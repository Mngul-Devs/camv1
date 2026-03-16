import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import {
  Search,
  Plus,
  Camera,
  Pencil,
  X,
  ChevronDown,
} from "lucide-react";
import { Input } from "../components/ui/input";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "../components/ui/sheet";
import { Label } from "../components/ui/label";
import { toast } from "sonner";
import { useOrganization } from "../contexts/OrganizationContext";
import {
  getCameras,
  createCamera as apiCreateCamera,
  deleteCamera as apiDeleteCamera,
  type ApiCamera,
} from "../../lib/api";

export type DeviceBrand = "dahua" | "vigi";
export type DeviceProtocol = "FTP" | "LAPI_WS";
export type DeviceStatus = "online" | "stale" | "offline" | "unknown";

export interface Device {
  id: string;
  cameraId: string;
  name: string;
  site: string;
  brand: DeviceBrand;
  protocol: DeviceProtocol;
  status: DeviceStatus;
  lastSeen: string | null;
  zones: number;
  ftpUsername: string;
  snapshotsToday: number;
  processed: number;
  skipped: number;
  detectionsToday: number;
  snapshotsPerHour: number;
  lastInference: string | null;
  zoneStates: { name: string; state: "FREE" | "OCCUPIED" }[];
  healthHistory: { time: string; status: string }[];
  ftpPending?: number;
}

function mapCamera(cam: ApiCamera): Device {
  const statusMap: Record<string, DeviceStatus> = {
    ONLINE: 'online',
    STALE: 'stale',
    OFFLINE: 'offline',
    UNKNOWN: 'unknown',
  };
  return {
    id: cam.camera_id,
    cameraId: cam.camera_id,
    name: cam.name ?? cam.camera_id,
    site: cam.site_name === "__unassigned__" ? "(Unassigned)" : cam.site_name,
    brand: (['dahua', 'vigi'].includes(cam.brand) ? cam.brand : 'dahua') as DeviceBrand,
    protocol: (cam.ingest_protocol?.toUpperCase() === 'FTP' ? 'FTP' : 'LAPI_WS') as DeviceProtocol,
    status: statusMap[cam.status] ?? 'unknown',
    lastSeen: cam.last_seen_at ?? null,
    zones: 0,
    ftpUsername: cam.camera_id,
    snapshotsToday: 0,
    processed: 0,
    skipped: 0,
    detectionsToday: 0,
    snapshotsPerHour: 0,
    lastInference: null,
    zoneStates: [],
    healthHistory: [],
    ftpPending: cam.ftp_pending ?? 0,
  };
}



export function DevicesPage() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { selectedProject } = useOrganization();
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Add camera form state
  const [newCameraId, setNewCameraId] = useState("");
  const [newCameraName, setNewCameraName] = useState("");
  const [newCameraSite, setNewCameraSite] = useState("");
  const [newCameraSiteId, setNewCameraSiteId] = useState<number | null>(null);
  const [newCameraBrand, setNewCameraBrand] = useState<DeviceBrand | "">("");
  const [newCameraProtocol, setNewCameraProtocol] = useState<DeviceProtocol | "">("");
  const [newFtpUsername, setNewFtpUsername] = useState("");
  const [newFtpPassword, setNewFtpPassword] = useState("");

  // Sites available in the currently selected project (for the create-camera form)
  const contextSites = selectedProject?.sites ?? [];
  // Unique site names from loaded devices (for the filter dropdown)
  const allSites = [...new Set(devices.map(d => d.site))];

  const loadDevices = useCallback(async () => {
    if (!selectedProject) { setDevices([]); setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const { cameras } = await getCameras({ project_id: Number(selectedProject.id) });
      setDevices(cameras.map(mapCamera));
    } catch {
      setDevices([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject?.id]);

  useEffect(() => { loadDevices(); }, [loadDevices]);

  const filteredDevices = devices.filter((d) => {
    const matchesSearch =
      !searchQuery ||
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.cameraId.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSite = siteFilter === "all" || d.site === siteFilter;
    const matchesStatus = statusFilter === "all" || d.status === statusFilter;
    return matchesSearch && matchesSite && matchesStatus;
  });

  const onlineCount = devices.filter((d) => d.status === "online").length;
  const staleCount = devices.filter((d) => d.status === "stale").length;
  const offlineCount = devices.filter((d) => d.status === "offline").length;

  const resetForm = () => {
    setNewCameraId("");
    setNewCameraName("");
    setNewCameraSite("");
    setNewCameraSiteId(null);
    setNewCameraBrand("");
    setNewCameraProtocol("");
    setNewFtpUsername("");
    setNewFtpPassword("");
  };

  const handleCreateCamera = async () => {
    if (!newCameraId || !newCameraSiteId || !newCameraBrand || !newCameraProtocol) {
      toast.error("Please fill in all required fields");
      return;
    }
    try {
      await apiCreateCamera({
        camera_id: newCameraId,
        name: newCameraName || newCameraId,
        site_id: newCameraSiteId,
        brand: newCameraBrand,
        ingest_protocol: newCameraProtocol,
        ftp_username: newFtpUsername || newCameraId,
        ftp_password: newFtpPassword || undefined,
      });
      toast.success(`Camera ${newCameraId} added successfully`);
      resetForm();
      setSheetOpen(false);
      loadDevices();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to create camera: ${msg}`);
    }
  };

  const handleDeleteCamera = async (cameraId: string, name: string) => {
    if (!confirm(`Delete camera "${name}"? This cannot be undone.`)) return;
    try {
      await apiDeleteCamera(cameraId);
      toast.success(`Camera ${name} deleted`);
      loadDevices();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Delete failed: ${msg}`);
    }
  };

  const getStatusConfig = (status: DeviceStatus) => {
    switch (status) {
      case "online":
        return { bg: "bg-[#3fb950]", text: "text-[#3fb950]", label: "ONLINE" };
      case "stale":
        return { bg: "bg-[#d29922]", text: "text-[#d29922]", label: "STALE" };
      case "offline":
        return { bg: "bg-[#9da7b3]", text: "text-[#9da7b3]", label: "OFFLINE" };
      case "unknown":
        return { bg: "bg-[#8b949e]", text: "text-[#8b949e]", label: "UNKNOWN" };
    }
  };

  const getBrandLabel = (brand: DeviceBrand) => {
    switch (brand) {
      case "dahua":
        return "DAHUA";
      case "vigi":
        return "VIGI";
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">Device Management</h1>
          <p className="text-sm text-[#9da7b3]">
            Manage cameras across all sites.
          </p>
        </div>
        <Button
          onClick={() => setSheetOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Camera
        </Button>
      </div>

      {/* Filters */}
      <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg p-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9da7b3]" />
            <Input
              placeholder="Search cameras..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-[#111113] border-[#2a2f36] text-[#e6edf3] placeholder:text-[#9da7b3] h-9"
            />
          </div>

          {/* Site filter */}
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger className="w-[160px] bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-9">
              <SelectValue placeholder="All Sites" />
            </SelectTrigger>
            <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
              <SelectItem value="all" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">All Sites</SelectItem>
              {allSites.map((site) => (
                <SelectItem key={site} value={site} className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">
                  {site}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status tabs */}
          <div className="flex items-center gap-1 ml-2">
            {[
              { key: "all", label: "All" },
              { key: "online", label: "Online" },
              { key: "stale", label: "Stale" },
              { key: "offline", label: "Offline" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  statusFilter === tab.key
                    ? "bg-emerald-600 text-white"
                    : "text-[#9da7b3] hover:text-[#e6edf3] hover:bg-[#2a2f36]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-[#2a2f36] hover:bg-transparent">
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Device Name</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Site</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Protocol</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Last Seen</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Zones</TableHead>
              <TableHead className="text-[#9da7b3] text-xs uppercase tracking-wider">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
{isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-[#9da7b3]">
                  Loading cameras...
                </TableCell>
              </TableRow>
            ) : filteredDevices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-[#9da7b3]">
                  No devices found
                </TableCell>
              </TableRow>
            ) : (
              filteredDevices.map((device) => {
                const statusConfig = getStatusConfig(device.status);
                return (
                  <TableRow
                    key={device.id}
                    className="border-[#2a2f36] hover:bg-[#161a1f] transition-colors cursor-pointer"
                    onClick={() => navigate(`/app/project/${projectId}/devices/${device.id}`)}
                  >
                    <TableCell className="py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-[#2a2f36] flex items-center justify-center">
                          <Camera className="w-4 h-4 text-[#9da7b3]" />
                        </div>
                        <div>
                          <div className="text-[#e6edf3] text-sm">{device.name}</div>
                          <div className="text-[#9da7b3] text-xs">{getBrandLabel(device.brand)}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={`text-xs border-[#2a2f36] ${statusConfig.text}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${statusConfig.bg} mr-1.5`} />
                        {statusConfig.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 text-[#9da7b3] text-sm">
                      {device.site}
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="text-[#58a6ff] text-sm font-mono">
                        {device.protocol}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-[#9da7b3] text-sm">
                      {device.lastSeen || "—"}
                    </TableCell>
                    <TableCell className="py-3 text-[#e6edf3] text-sm">
                      {device.zones}
                    </TableCell>
                    <TableCell className="py-3">
<div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-[#9da7b3] hover:text-[#e6edf3]"
                          onClick={() => navigate(`/app/project/${projectId}/devices/${device.id}`)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-red-400 hover:text-red-300"
                          onClick={() => handleDeleteCamera(device.cameraId, device.name)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Device count */}
      <div className="text-sm text-[#9da7b3]">
        {filteredDevices.length} device{filteredDevices.length !== 1 ? "s" : ""}
      </div>

      {/* Add Camera Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="bg-[#161a1f] border-[#2a2f36] w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="pb-4">
            <SheetTitle className="text-[#e6edf3] text-lg">Add New Camera</SheetTitle>
            <SheetDescription className="text-[#9da7b3]">
              Register a new camera device to your project.
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 space-y-5">
            {/* Camera ID & Name */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[#e6edf3] text-sm">
                  Camera ID <span className="text-red-400">*</span>
                </Label>
                <Input
                  value={newCameraId}
                  onChange={(e) => setNewCameraId(e.target.value)}
                  placeholder="Enter camera ID"
                  className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] placeholder:text-[#9da7b3]"
                />
                <p className="text-xs text-[#9da7b3]">e.g. CAM003</p>
              </div>
              <div className="space-y-2">
                <Label className="text-[#e6edf3] text-sm">Camera Name</Label>
                <Input
                  value={newCameraName}
                  onChange={(e) => setNewCameraName(e.target.value)}
                  placeholder="Enter camera name"
                  className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] placeholder:text-[#9da7b3]"
                />
              </div>
            </div>

            {/* Site & Brand */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[#e6edf3] text-sm">
                  Site <span className="text-red-400">*</span>
                </Label>
<Select
                    value={newCameraSite}
                    onValueChange={(v) => {
                      const site = contextSites.find(s => s.name === v);
                      setNewCameraSite(v);
                      setNewCameraSiteId(site ? Number(site.id) : null);
                    }}
                  >
                    <SelectTrigger className="bg-[#111113] border-[#2a2f36] text-[#e6edf3]">
                      <SelectValue placeholder="Select a site..." />
                    </SelectTrigger>
                    <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
                      {contextSites.length === 0 && (
                        <SelectItem value="__none" disabled className="text-[#9da7b3]">No sites available</SelectItem>
                      )}
                      {contextSites.map((site) => (
                        <SelectItem key={site.id} value={site.name} className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">
                          {site.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[#e6edf3] text-sm">
                  Brand <span className="text-red-400">*</span>
                </Label>
                <Select value={newCameraBrand} onValueChange={(v) => setNewCameraBrand(v as DeviceBrand)}>
                  <SelectTrigger className="bg-[#111113] border-[#2a2f36] text-[#e6edf3]">
                    <SelectValue placeholder="Select brand..." />
                  </SelectTrigger>
                  <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
                    <SelectItem value="dahua" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">Dahua</SelectItem>
                    <SelectItem value="vigi" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">ViGi (TP-Link)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Protocol */}
            <div className="space-y-2">
              <Label className="text-[#e6edf3] text-sm">
                Protocol <span className="text-red-400">*</span>
              </Label>
              <Select value={newCameraProtocol} onValueChange={(v) => setNewCameraProtocol(v as DeviceProtocol)}>
                <SelectTrigger className="bg-[#111113] border-[#2a2f36] text-[#e6edf3]">
                  <SelectValue placeholder="Select protocol..." />
                </SelectTrigger>
                <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
                  <SelectItem value="FTP" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">FTP</SelectItem>
                  <SelectItem value="LAPI_WS" className="text-[#e6edf3] focus:bg-[#2a2f36] focus:text-[#e6edf3]">LAPI_WS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* FTP Credentials */}
            <div className="space-y-2">
              <Label className="text-[#e6edf3] text-sm">
                FTP Username <span className="text-red-400">*</span>
              </Label>
              <Input
                value={newFtpUsername}
                onChange={(e) => setNewFtpUsername(e.target.value)}
                placeholder="Enter FTP username"
                className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] placeholder:text-[#9da7b3]"
              />
              <p className="text-xs text-[#9da7b3]">e.g. cam003</p>
            </div>

            <div className="space-y-2">
              <Label className="text-[#e6edf3] text-sm">FTP Password</Label>
              <Input
                type="password"
                value={newFtpPassword}
                onChange={(e) => setNewFtpPassword(e.target.value)}
                placeholder="Enter FTP password"
                className="bg-[#111113] border-[#2a2f36] text-[#e6edf3] placeholder:text-[#9da7b3]"
              />
              <p className="text-xs text-[#9da7b3]">Leave blank to auto-generate</p>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 px-4 pb-4 flex items-center justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                resetForm();
                setSheetOpen(false);
              }}
              className="bg-transparent border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateCamera}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Camera
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
