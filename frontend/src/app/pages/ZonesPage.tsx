import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  LayoutGrid,
  List,
  MapPin,
  Pencil,
  Search,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useOrganization } from "../contexts/OrganizationContext";
import { getCameras, getZones, type ApiCamera, type ApiZone } from "../../lib/api";
import { ZoneEditorCanvas } from "../components/ZoneEditorCanvas";

type ZoneState = "FREE" | "FULL" | "PARTIAL" | "UNKNOWN";
type CameraStatus = "ONLINE" | "STALE" | "OFFLINE" | "UNKNOWN";
type ViewMode = "tiles" | "list";
type View = "list" | "editor";

type UiSite = {
  id: number;
  name: string;
  location: string;
};

type UiCamera = {
  id: string;
  name: string;
  siteId: number;
  status: CameraStatus;
  zoneCount: number;
};

type UiZone = {
  id: string;
  cameraId: string;
  siteId: number;
  state: ZoneState;
  occupied: number;
  capacity: number;
  lastChange: number | null;
};

function cn(...c: (string | undefined | false | null)[]) {
  return c.filter(Boolean).join(" ");
}

function SearchInput({ className, ...p }: ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-7 rounded-md border border-[#2a2f36] bg-[#0f1115] px-2.5 py-1",
        "text-[11px] text-[#e6edf3] placeholder:text-[#484f58] outline-none",
        "focus:border-[#3fb950]/40 transition-colors",
        className,
      )}
      {...p}
    />
  );
}

const STATE_CFG = {
  FREE:    { label: "FREE",    dot: "bg-[#3fb950]", badge: "text-[#3fb950] bg-[#3fb950]/10 border-[#3fb950]/25", border: "border-[#3fb950]/30", bg: "bg-[#3fb950]/[0.04]" },
  FULL:    { label: "FULL",    dot: "bg-[#f85149]", badge: "text-[#f85149] bg-[#f85149]/10 border-[#f85149]/25", border: "border-[#f85149]/30", bg: "bg-[#f85149]/[0.04]" },
  PARTIAL: { label: "PARTIAL", dot: "bg-[#d29922]", badge: "text-[#d29922] bg-[#d29922]/10 border-[#d29922]/25", border: "border-[#d29922]/30", bg: "bg-[#d29922]/[0.04]" },
  UNKNOWN: { label: "UNKNOWN", dot: "bg-[#6e7681]", badge: "text-[#6e7681] bg-transparent border-[#2a2f36]",     border: "border-[#2a2f36]",    bg: "bg-transparent" },
} as const;

const CAM_STATUS_CFG: Record<CameraStatus, { dot: string; label: string }> = {
  ONLINE:  { dot: "bg-[#3fb950]",    label: "Online" },
  STALE:   { dot: "bg-[#d29922]",    label: "Stale" },
  OFFLINE: { dot: "bg-[#f85149]/80", label: "Offline" },
  UNKNOWN: { dot: "bg-[#6e7681]",    label: "Unknown" },
};

function normalizeZoneState(zone: ApiZone, cameraStatus?: CameraStatus): ZoneState {
  if (cameraStatus && cameraStatus !== "ONLINE") return "UNKNOWN";
  const s = String(zone.state ?? "FREE").toUpperCase();
  if (s === "OCCUPIED" || s === "FULL") return "FULL";
  if (s === "PARTIAL") return "PARTIAL";
  if (s === "FREE") return "FREE";
  return "UNKNOWN";
}

function parseLastChange(value: string | null): number | null {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? null : ts;
}

function relTime(ms: number | null): string {
  if (!ms) return "--";
  const d = Date.now() - ms;
  if (d < 5000) return "just now";
  if (d < 60000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  return `${Math.floor(d / 3600000)}h ago`;
}

function fmtTs(ms: number | null): string {
  if (!ms) return "--";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function StateBadge({ state }: { state: ZoneState }) {
  const c = STATE_CFG[state];
  return (
    <span className={cn("font-mono text-[10px] px-1.5 py-0.5 rounded border font-semibold tracking-wider", c.badge)}>
      {c.label}
    </span>
  );
}

function SitesPanel({
  sites,
  selectedId,
  onSelect,
  cameras,
}: {
  sites: UiSite[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  cameras: UiCamera[];
}) {
  return (
    <div className="flex flex-col w-[200px] shrink-0 border-r border-[#2a2f36] bg-[#161b22] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#2a2f36]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6e7681]">Sites</p>
        <p className="text-[11px] text-[#484f58] mt-0.5">
          {sites.length} site{sites.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {sites.map((site) => {
          const siteCameras = cameras.filter((c) => c.siteId === site.id);
          const camCount = siteCameras.length;
          const onlineCount = siteCameras.filter((c) => c.status === "ONLINE").length;
          const isSelected = selectedId === site.id;

          return (
            <button
              key={site.id}
              onClick={() => onSelect(site.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-all border-l-2",
                isSelected
                  ? "bg-[#1c2128] border-l-[#58a6ff] text-[#e6edf3]"
                  : "border-l-transparent text-[#9da7b3] hover:bg-[#1c2128]/50 hover:text-[#e6edf3]",
              )}
            >
              <div className={cn("mt-0.5 w-6 h-6 rounded-md flex items-center justify-center shrink-0", isSelected ? "bg-[#58a6ff]/15" : "bg-[#1c2128]")}>
                <MapPin className={cn("w-3 h-3", isSelected ? "text-[#58a6ff]" : "text-[#6e7681]")} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium truncate leading-tight">{site.name}</p>
                <p className="text-[10px] text-[#6e7681] mt-0.5">{site.location}</p>
                <p className="text-[10px] font-mono mt-1">
                  <span className={onlineCount === camCount ? "text-[#3fb950]" : "text-[#d29922]"}>{onlineCount}</span>
                  <span className="text-[#484f58]">/{camCount} cam{camCount !== 1 ? "s" : ""}</span>
                </p>
              </div>
              {isSelected && <ChevronRight className="w-3 h-3 text-[#6e7681] ml-auto mt-1 shrink-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CamerasPanel({
  cameras,
  selectedSite,
  selectedId,
  onSelect,
  zonesByCamera,
}: {
  cameras: UiCamera[];
  selectedSite: UiSite | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  zonesByCamera: Map<string, UiZone[]>;
}) {
  if (!selectedSite) {
    return (
      <div className="flex flex-col w-[220px] shrink-0 border-r border-[#2a2f36] bg-[#161b22] items-center justify-center gap-2 text-center px-6">
        <Video className="w-8 h-8 text-[#2a2f36]" />
        <p className="text-xs text-[#484f58]">Select a site to see cameras</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[220px] shrink-0 border-r border-[#2a2f36] bg-[#161b22] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#2a2f36]">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6e7681]">Cameras</p>
        <p className="text-xs font-medium text-[#9da7b3] mt-0.5 truncate">{selectedSite.name}</p>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {cameras.map((cam) => {
          const zones = zonesByCamera.get(cam.id) ?? [];
          const free = zones.filter((z) => z.state === "FREE").length;
          const full = zones.filter((z) => z.state === "FULL" || z.state === "PARTIAL").length;
          const unknown = zones.filter((z) => z.state === "UNKNOWN").length;
          const pct = zones.length > 0 ? full / zones.length : 0;
          const isSelected = selectedId === cam.id;
          const sc = CAM_STATUS_CFG[cam.status];

          return (
            <button
              key={cam.id}
              onClick={() => onSelect(cam.id)}
              className={cn(
                "w-full text-left px-3 py-3 flex flex-col gap-2 transition-all border-l-2",
                isSelected
                  ? "bg-[#1c2128] border-l-[#58a6ff]"
                  : "border-l-transparent hover:bg-[#1c2128]/50",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full shrink-0", sc.dot)} />
                  <span className={cn("font-mono font-semibold text-xs", isSelected ? "text-[#58a6ff]" : "text-[#e6edf3]")}>
                    {cam.name}
                  </span>
                </div>
                {isSelected && <ChevronRight className="w-3 h-3 text-[#6e7681] shrink-0" />}
              </div>

              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-[#3fb950]">{free}F</span>
                <span className="text-[#f85149]">{full}O</span>
                {unknown > 0 && <span className="text-[#6e7681]">{unknown}?</span>}
                <span className="text-[#484f58] ml-auto">{cam.zoneCount} zones</span>
              </div>

              <div className="h-1 bg-[#2a2f36] rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", pct > 0.8 ? "bg-[#f85149]" : pct > 0.5 ? "bg-[#d29922]" : "bg-[#3fb950]")}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ZoneTile({ zone, onEdit }: { zone: UiZone; onEdit: (z: UiZone) => void }) {
  const c = STATE_CFG[zone.state];
  return (
    <div className={cn("group rounded-lg border p-3 flex flex-col gap-2.5 transition-all hover:brightness-110", c.bg, c.border)}>
      <div className="flex items-center justify-between">
        <span className="font-mono font-bold text-sm text-[#e6edf3]">{zone.id}</span>
        <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", c.dot)} />
      </div>

      <StateBadge state={zone.state} />

      <div className="flex items-center justify-between mt-auto">
        <span className="font-mono text-[10px] text-[#6e7681]">
          <span className={zone.occupied > 0 ? "text-[#f85149]" : "text-[#3fb950]"}>{zone.occupied}</span>
          <span className="text-[#484f58]">/{zone.capacity}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#484f58]">{relTime(zone.lastChange)}</span>
          <button
            onClick={() => onEdit(zone)}
            title="Open Zone Editor"
            className="w-5 h-5 rounded flex items-center justify-center text-[#484f58] opacity-0 group-hover:opacity-100 hover:text-[#e6edf3] hover:bg-[#2a2f36] transition-all"
          >
            <Pencil className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

type SortField = "id" | "state" | "occ" | "time";

function ZoneList({ zones, onEdit }: { zones: UiZone[]; onEdit: (z: UiZone) => void }) {
  const [sortBy, setSortBy] = useState<SortField>("id");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggle = (f: SortField) => {
    if (sortBy === f) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(f); setSortDir("asc"); }
  };

  const sorted = useMemo(() => [...zones].sort((a, b) => {
    let v = 0;
    if (sortBy === "id") v = a.id.localeCompare(b.id, undefined, { numeric: true });
    if (sortBy === "state") v = a.state.localeCompare(b.state);
    if (sortBy === "occ") v = a.occupied - b.occupied;
    if (sortBy === "time") v = (a.lastChange ?? 0) - (b.lastChange ?? 0);
    return sortDir === "asc" ? v : -v;
  }), [zones, sortBy, sortDir]);

  function ColH({ field, label }: { field: SortField; label: string }) {
    const active = sortBy === field;
    const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return (
      <th className="px-4 py-2.5 text-left">
        <button
          onClick={() => toggle(field)}
          className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[#6e7681] hover:text-[#9da7b3] transition-colors"
        >
          {label}
          <Icon className={cn("w-3 h-3", active ? "opacity-70" : "opacity-30")} />
        </button>
      </th>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-[#2a2f36] bg-[#0f1115] sticky top-0 z-10">
          <ColH field="id" label="Zone ID" />
          <ColH field="state" label="State" />
          <ColH field="occ" label="Occ / Cap" />
          <ColH field="time" label="Last Change" />
          <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-[#6e7681]">Action</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#2a2f36]">
        {sorted.map((zone) => (
          <tr key={zone.id} className="hover:bg-[#1c2128]/50 transition-colors group">
            <td className="px-4 py-3">
              <span className="font-mono font-semibold text-[#e6edf3]">{zone.id}</span>
            </td>
            <td className="px-4 py-3">
              <StateBadge state={zone.state} />
            </td>
            <td className="px-4 py-3 font-mono text-[11px]">
              <span className={zone.occupied > 0 ? "text-[#f85149]" : "text-[#3fb950]"}>{zone.occupied}</span>
              <span className="text-[#484f58]"> / {zone.capacity}</span>
            </td>
            <td className="px-4 py-3 font-mono text-[11px] text-[#6e7681]">
              {fmtTs(zone.lastChange)}
            </td>
            <td className="px-4 py-3">
              <button
                onClick={() => onEdit(zone)}
                title="Open Zone Editor"
                className="w-6 h-6 rounded flex items-center justify-center border border-transparent text-[#484f58] group-hover:border-[#2a2f36] group-hover:text-[#6e7681] hover:!text-[#e6edf3] hover:!border-[#444c56] hover:bg-[#2a2f36] transition-all"
              >
                <Pencil className="w-3 h-3" />
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ZonesPanel({
  camera,
  site,
  zones,
  isLoading,
  onEdit,
  onOpenEditor,
}: {
  camera: UiCamera | undefined;
  site: UiSite | undefined;
  zones: UiZone[];
  isLoading: boolean;
  onEdit: (z: UiZone) => void;
  onOpenEditor: () => void;
}) {
  const [view, setView] = useState<ViewMode>("tiles");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ZoneState | "ALL">("ALL");

  const filtered = useMemo(() => zones.filter((z) => {
    if (filter !== "ALL" && z.state !== filter) return false;
    if (search && !z.id.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [zones, filter, search]);

  const free = zones.filter((z) => z.state === "FREE").length;
  const fullOnly = zones.filter((z) => z.state === "FULL").length;
  const partial = zones.filter((z) => z.state === "PARTIAL").length;
  const occupied = fullOnly + partial;
  const unknown = zones.filter((z) => z.state === "UNKNOWN").length;
  const pct = zones.length > 0 ? Math.round((occupied / zones.length) * 100) : 0;

  if (!camera || !site) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-8 bg-[#0f1115]">
        <div className="w-14 h-14 rounded-xl bg-[#161b22] border border-[#2a2f36] flex items-center justify-center">
          <LayoutGrid className="w-7 h-7 text-[#2a2f36]" />
        </div>
        <div>
          <p className="text-sm font-medium text-[#9da7b3]">No camera selected</p>
          <p className="text-xs text-[#484f58] mt-1">Pick a site, then a camera to view its zones.</p>
        </div>
      </div>
    );
  }

  const sc = CAM_STATUS_CFG[camera.status];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0f1115]">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2a2f36] bg-[#161b22] shrink-0">
        <div className="flex items-center gap-2 text-xs text-[#6e7681] min-w-0">
          <span className="text-[#484f58]">{site.location}</span>
          <ChevronRight className="w-3 h-3 shrink-0 text-[#484f58]" />
          <span className="text-[#484f58]">{site.name}</span>
          <ChevronRight className="w-3 h-3 shrink-0 text-[#484f58]" />
          <div className="flex items-center gap-1.5">
            <span className={cn("w-2 h-2 rounded-full shrink-0", sc.dot)} />
            <span className="font-mono font-semibold text-[#e6edf3]">{camera.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onOpenEditor}
            className="px-2 py-1 rounded border border-[#2a2f36] text-[10px] font-mono text-[#9da7b3] hover:text-[#e6edf3] hover:border-[#444c56] hover:bg-[#1c2128] transition-colors"
          >
            Open Editor
          </button>
          <div className="flex items-center border border-[#2a2f36] rounded-md overflow-hidden">
            <button
              onClick={() => setView("tiles")}
              title="Tile view"
              className={cn("w-7 h-7 flex items-center justify-center transition-colors", view === "tiles" ? "bg-[#2a2f36] text-[#e6edf3]" : "text-[#6e7681] hover:text-[#9da7b3]")}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              title="List view"
              className={cn("w-7 h-7 flex items-center justify-center transition-colors", view === "list" ? "bg-[#2a2f36] text-[#e6edf3]" : "text-[#6e7681] hover:text-[#9da7b3]")}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 px-5 py-3 border-b border-[#2a2f36] bg-[#161b22]/60 shrink-0 overflow-x-auto">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#3fb950] shrink-0" />
          <span className="text-xs text-[#6e7681]">Free</span>
          <span className="font-mono font-semibold text-[#3fb950]">{free}</span>
        </div>
        <div className="w-px h-4 bg-[#2a2f36]" />
        <div className="flex items-center gap-2">
          <XCircle className="w-3.5 h-3.5 text-[#f85149] shrink-0" />
          <span className="text-xs text-[#6e7681]">Occupied</span>
          <span className="font-mono font-semibold text-[#f85149]">{occupied}</span>
        </div>
        <div className="w-px h-4 bg-[#2a2f36]" />
        <div className="flex items-center gap-2">
          <HelpCircle className="w-3.5 h-3.5 text-[#6e7681] shrink-0" />
          <span className="text-xs text-[#6e7681]">Unknown</span>
          <span className="font-mono font-semibold text-[#6e7681]">{unknown}</span>
        </div>
        <div className="w-px h-4 bg-[#2a2f36]" />
        <div className="flex items-center gap-2 ml-1">
          <div className="w-24 h-1.5 bg-[#2a2f36] rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", pct > 80 ? "bg-[#f85149]" : pct > 50 ? "bg-[#d29922]" : "bg-[#3fb950]")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-[#9da7b3]">{pct}% full</span>
        </div>
        <div className="ml-auto font-mono text-[10px] text-[#484f58] shrink-0">
          {zones.length} zone{zones.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[#2a2f36] bg-[#161b22] shrink-0 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#484f58]" />
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter zones..."
            className="pl-6 w-36"
          />
        </div>

        <div className="flex items-center gap-1">
          {(["ALL", "FREE", "FULL", "UNKNOWN"] as const).map((f) => {
            const count = f === "ALL" ? zones.length : zones.filter((z) => z.state === f).length;
            const isActive = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "h-6 px-2.5 rounded-full text-[10px] font-medium border transition-all",
                  isActive
                    ? f === "ALL" ? "bg-[#2a2f36] border-[#444c56] text-[#e6edf3]"
                    : f === "FREE" ? "bg-[#3fb950]/15 border-[#3fb950]/40 text-[#3fb950]"
                    : f === "FULL" ? "bg-[#f85149]/15 border-[#f85149]/40 text-[#f85149]"
                    : "bg-[#6e7681]/15 border-[#6e7681]/40 text-[#6e7681]"
                    : "border-transparent bg-transparent text-[#484f58] hover:text-[#6e7681]",
                )}
              >
                {f} <span className="ml-0.5 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>

        {(search || filter !== "ALL") && (
          <span className="text-[10px] font-mono text-[#484f58] ml-1">
            {filtered.length} / {zones.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-[#484f58]">
            <p className="text-sm">Loading zones...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-[#484f58]">
            <p className="text-sm">No zones match filters</p>
            <button
              onClick={() => { setSearch(""); setFilter("ALL"); }}
              className="text-xs text-[#6e7681] underline underline-offset-2 hover:text-[#9da7b3]"
            >
              Clear filters
            </button>
          </div>
        ) : view === "tiles" ? (
          <div className="p-5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2.5">
            {filtered.map((z) => <ZoneTile key={z.id} zone={z} onEdit={onEdit} />)}
          </div>
        ) : (
          <ZoneList zones={filtered} onEdit={onEdit} />
        )}
      </div>
    </div>
  );
}

export function ZonesPage() {
  const { selectedProject, reload: reloadContext } = useOrganization();
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedProject) {
      setCameras([]);
      setZones([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [camRes, zoneRes] = await Promise.all([
        getCameras({ project_id: Number(selectedProject.id) }),
        getZones(Number(selectedProject.id)),
      ]);
      setCameras(camRes.cameras);
      setZones(zoneRes.zones);
    } catch (err: unknown) {
      toast.error(`Failed to load zones: ${err instanceof Error ? err.message : String(err)}`);
      setCameras([]);
      setZones([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedProject]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sites = useMemo<UiSite[]>(() => {
    if (selectedProject?.sites?.length) {
      return selectedProject.sites.map((s) => ({
        id: Number(s.id),
        name: s.name,
        location: s.city || s.address || s.name,
      }));
    }
    const unique = new Map<number, UiSite>();
    cameras.forEach((c) => {
      if (!unique.has(c.site_id)) {
        unique.set(c.site_id, { id: c.site_id, name: c.site_name, location: c.site_name });
      }
    });
    return Array.from(unique.values());
  }, [selectedProject?.sites, cameras]);

  const cameraById = useMemo(() => {
    const map = new Map<string, ApiCamera>();
    cameras.forEach((c) => map.set(c.camera_id, c));
    return map;
  }, [cameras]);

  const zonesUi = useMemo<UiZone[]>(() => {
    return zones.map((z) => {
      const cam = cameraById.get(z.camera_id);
      return {
        id: z.zone_id,
        cameraId: z.camera_id,
        siteId: z.site_id,
        state: normalizeZoneState(z, (cam?.status as CameraStatus) ?? "UNKNOWN"),
        occupied: z.occupied ?? 0,
        capacity: z.capacity ?? 1,
        lastChange: parseLastChange(z.last_change),
      };
    });
  }, [zones, cameraById]);

  const zonesByCamera = useMemo(() => {
    const map = new Map<string, UiZone[]>();
    zonesUi.forEach((z) => {
      if (!map.has(z.cameraId)) map.set(z.cameraId, []);
      map.get(z.cameraId)!.push(z);
    });
    return map;
  }, [zonesUi]);

  const cameraList = useMemo<UiCamera[]>(() => {
    return cameras.map((c) => ({
      id: c.camera_id,
      name: c.name ?? c.camera_id,
      siteId: c.site_id,
      status: (c.status as CameraStatus) ?? "UNKNOWN",
      zoneCount: zonesByCamera.get(c.camera_id)?.length ?? 0,
    }));
  }, [cameras, zonesByCamera]);

  useEffect(() => {
    if (!sites.length) {
      setSelectedSiteId(null);
      setSelectedCameraId(null);
      return;
    }
    if (!selectedSiteId || !sites.some((s) => s.id === selectedSiteId)) {
      setSelectedSiteId(sites[0].id);
    }
  }, [sites, selectedSiteId]);

  useEffect(() => {
    if (!selectedSiteId) {
      setSelectedCameraId(null);
      return;
    }
    const siteCameras = cameraList.filter((c) => c.siteId === selectedSiteId);
    if (!siteCameras.length) {
      setSelectedCameraId(null);
      return;
    }
    if (!selectedCameraId || !siteCameras.some((c) => c.id === selectedCameraId)) {
      setSelectedCameraId(siteCameras[0].id);
    }
  }, [selectedSiteId, selectedCameraId, cameraList]);

  const selectedSite = sites.find((s) => s.id === selectedSiteId);
  const selectedCamera = cameraList.find((c) => c.id === selectedCameraId);
  const siteCameras = selectedSiteId ? cameraList.filter((c) => c.siteId === selectedSiteId) : [];
  const cameraZones = selectedCameraId ? (zonesByCamera.get(selectedCameraId) ?? []) : [];

  const openEditor = (cameraId?: string) => {
    const id = cameraId || selectedCameraId;
    if (id) {
      setSelectedCameraId(id);
      setView("editor");
    }
  };

  const closeEditor = () => {
    setView("list");
    setTimeout(() => {
      loadData();
      reloadContext();
    }, 300);
  };

  if (view === "editor") {
    return (
      <ZoneEditorCanvas
        cameraId={selectedCameraId ?? ""}
        cameras={cameraList.map((c) => ({ camera_id: c.id, name: c.name }))}
        onCameraChange={(id) => setSelectedCameraId(id)}
        onClose={closeEditor}
      />
    );
  }

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0f1115] text-[#6e7681]">
        <p className="text-sm">No project selected</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0f1115] text-[#e6edf3]">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#2a2f36] bg-[#161b22] shrink-0">
        <div className="w-7 h-7 rounded-lg bg-[#58a6ff]/10 border border-[#58a6ff]/20 flex items-center justify-center">
          <LayoutGrid className="w-3.5 h-3.5 text-[#58a6ff]" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-[#e6edf3]">Zones Monitor</h1>
        </div>

        <div className="ml-auto text-[10px] font-mono text-[#484f58]">
          Auto-generated by Zone Editor - read-only
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <SitesPanel
          sites={sites}
          selectedId={selectedSiteId}
          onSelect={(id) => { setSelectedSiteId(id); setSelectedCameraId(null); }}
          cameras={cameraList}
        />
        <CamerasPanel
          cameras={siteCameras}
          selectedSite={selectedSite}
          selectedId={selectedCameraId}
          onSelect={setSelectedCameraId}
          zonesByCamera={zonesByCamera}
        />
        <ZonesPanel
          camera={selectedCamera}
          site={selectedSite}
          zones={cameraZones}
          isLoading={isLoading}
          onEdit={(z) => openEditor(z.cameraId)}
          onOpenEditor={() => openEditor(selectedCamera?.id)}
        />
      </div>
    </div>
  );
}
