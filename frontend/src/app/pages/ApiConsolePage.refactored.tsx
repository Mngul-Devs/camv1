/**
 * API Console – Refactored Postman-style request/response panel with CamPark-specific
 * outbound push templates.
 *
 * External requests are routed through the Flask proxy at
 * POST /admin/outbound/proxy (SSRF-protected, admin-auth required).
 * Internal paths (starting with /) are fetched directly with session cookies.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getCameras, getZones, type ApiCamera, type ApiZone } from "../../lib/api";
import { useOrganization } from "../contexts/OrganizationContext";

// Import components
import { ApiConsoleHeader } from "./ApiConsole/components/ApiConsoleHeader";
import { TemplatePanel } from "./ApiConsole/components/TemplatePanel";
import { GuidedModePanel } from "./ApiConsole/components/GuidedModePanel";
import { AdvancedModePanel } from "./ApiConsole/components/AdvancedModePanel";
import { HistoryPanel } from "./ApiConsole/components/HistoryPanel";
import { DestinationPresets } from "./ApiConsole/components/DestinationPresets";
import { SiteRoutingConfig } from "./ApiConsole/components/SiteRoutingConfig";
import { DispatchStats } from "./ApiConsole/components/DispatchStats";
import { TemplateWizard } from "./ApiConsole/components/TemplateWizard";

// Import hooks
import { useApiConsoleState } from "./ApiConsole/hooks/useApiConsoleState";
import { useDestinationPresets } from "./ApiConsole/hooks/useDestinationPresets";
import { useSiteRouting } from "./ApiConsole/hooks/useSiteRouting";
import { useScheduler } from "./ApiConsole/hooks/useScheduler";

// Import types and utilities
import type {
  HttpMethod,
  Template,
  ScopeMode,
  DestinationPreset,
  SiteRouteRule,
  GuidedTemplateOptions,
  ProxyResponse,
  SendConfig,
  DispatchRunStat,
  SiteOption,
} from "./ApiConsole/apiConsoleTypes";
import {
  buildResolvedUrl,
  formatSize,
  prettyPrintJson,
  validateJson,
  buildHeaders,
  generateCurl,
  getOnlineCameras,
} from "./ApiConsole/apiConsoleUtils";

// ─── Templates ──────────────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  {
    id: "zone_occupancy",
    name: "Zone Occupancy Push",
    tag: "PUSH",
    tagColor: "text-[#f8c555] border-[#f8c555]/30",
    method: "POST",
    description: "All zones: state, occupancy counts, capacity, last change.",
    build(_, zones) {
      return {
        url: "https://",
        body: {
          event: "zone_occupancy_update",
          source: "CamPark",
          timestamp: new Date().toISOString(),
          zones: zones.map(z => ({
            zone_id: z.zone_id,
            name: z.name ?? z.zone_id,
            camera_id: z.camera_id,
            site: z.site_name,
            state: z.state,
            occupied: z.occupied,
            capacity: z.capacity,
            available: Math.max(0, z.capacity - z.occupied),
            occupancy_pct: z.capacity ? Math.round((z.occupied / z.capacity) * 100) : 0,
            last_change: z.last_change,
          })),
          summary: {
            total_zones: zones.length,
            occupied_zones: zones.filter(z => z.state === "OCCUPIED").length,
            total_spaces: zones.reduce((s, z) => s + z.capacity, 0),
            occupied_spaces: zones.reduce((s, z) => s + z.occupied, 0),
          },
        },
      };
    },
  },
  {
    id: "detection_result",
    name: "YOLO Detection Result",
    tag: "PUSH",
    tagColor: "text-[#f8c555] border-[#f8c555]/30",
    method: "POST",
    description: "Per-camera zone vehicle counts from the latest YOLO inference.",
    build(cameras, zones) {
      return {
        url: "https://",
        body: {
          event: "detection_result",
          source: "CamPark",
          timestamp: new Date().toISOString(),
          cameras: cameras.map(cam => ({
            camera_id: cam.camera_id,
            name: cam.name ?? cam.camera_id,
            site: cam.site_name,
            status: cam.status,
            last_seen: cam.last_seen_at,
            zones: zones
              .filter(z => z.camera_id === cam.camera_id)
              .map(z => ({
                zone_id: z.zone_id,
                name: z.name ?? z.zone_id,
                state: z.state,
                vehicles_detected: z.occupied,
                capacity: z.capacity,
                occupancy_pct: z.capacity
                  ? Math.round((z.occupied / z.capacity) * 100)
                  : 0,
                last_change: z.last_change,
              })),
          })),
        },
      };
    },
  },
  {
    id: "site_summary",
    name: "Site Summary",
    tag: "PUSH",
    tagColor: "text-[#f8c555] border-[#f8c555]/30",
    method: "POST",
    description: "Aggregated availability per site – ideal for display boards.",
    build(cameras, zones) {
      const siteMap: Record<string, { name: string; total: number; occupied: number; cameras: number }> = {};
      zones.forEach(z => {
        if (!siteMap[z.site_name]) siteMap[z.site_name] = { name: z.site_name, total: 0, occupied: 0, cameras: 0 };
        siteMap[z.site_name].total += z.capacity;
        siteMap[z.site_name].occupied += z.occupied;
      });
      cameras.forEach(c => { if (siteMap[c.site_name]) siteMap[c.site_name].cameras++; });
      const sites = Object.values(siteMap).map(s => ({
        ...s,
        available: Math.max(0, s.total - s.occupied),
        occupancy_pct: s.total ? Math.round((s.occupied / s.total) * 100) : 0,
      }));
      return {
        url: "https://",
        body: {
          event: "site_summary",
          source: "CamPark",
          timestamp: new Date().toISOString(),
          sites,
          total_available: sites.reduce((s, x) => s + x.available, 0),
          total_spaces: sites.reduce((s, x) => s + x.total, 0),
        },
      };
    },
  },
  {
    id: "heartbeat",
    name: "Heartbeat",
    tag: "PING",
    tagColor: "text-[#79c0ff] border-[#79c0ff]/30",
    method: "POST",
    description: "Camera health statuses – for uptime monitoring webhooks.",
    build(cameras, zones) {
      return {
        url: "https://",
        body: {
          event: "heartbeat",
          source: "CamPark",
          timestamp: new Date().toISOString(),
          cameras: cameras.map(c => ({
            camera_id: c.camera_id,
            name: c.name ?? c.camera_id,
            site: c.site_name,
            status: c.status,
            last_seen: c.last_seen_at,
            zone_count: zones.filter(z => z.camera_id === c.camera_id).length,
          })),
          summary: {
            total: cameras.length,
            online: cameras.filter(c => c.status === "ONLINE").length,
            stale: cameras.filter(c => c.status === "STALE").length,
            offline: cameras.filter(c => c.status === "OFFLINE").length,
          },
        },
      };
    },
  },
  {
    id: "get_status",
    name: "GET Occupancy Status",
    tag: "GET",
    tagColor: "text-[#3fb950] border-[#3fb950]/30",
    method: "GET",
    description: "Read current zone occupancy from the internal CamPark API.",
    build() { return { url: "/api/v1/sites/{site_id}/status", body: null }; },
  },
  {
    id: "get_cameras",
    name: "GET Camera List",
    tag: "GET",
    tagColor: "text-[#3fb950] border-[#3fb950]/30",
    method: "GET",
    description: "List all registered cameras.",
    build() { return { url: "/admin/cameras.json", body: null }; },
  },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export function ApiConsolePage() {
  const { selectedProject } = useOrganization();

  // Live data
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  const [zones, setZones] = useState<ApiZone[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Use custom hooks for state management
  const consoleState = useApiConsoleState();
  const { presets, addPreset, updatePreset, deletePreset } = useDestinationPresets();
  const { siteRoutes: routes, addRoute, deleteRoute } = useSiteRouting();
  const { scheduleMs, setScheduleMs, scheduleRunning, nextRunAt, startScheduler, stopScheduler } = useScheduler();

  // Guided mode specific state
  const [scopeMode, setScopeMode] = useState<ScopeMode>("project");
  const [selectedSiteId, setSelectedSiteId] = useState<string>("all");
  const [selectedCameraId, setSelectedCameraId] = useState<string>("all");
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [dispatchMode, setDispatchMode] = useState<"single" | "site_routes">("single");
  const [templateOptions, setTemplateOptions] = useState<GuidedTemplateOptions>({
    includeSummary: true,
    includeTimestamp: true,
    onlyOnlineCameras: false,
  });
  const [dispatchStats, setDispatchStats] = useState<DispatchRunStat[]>([]);
  const [showDestinationPresets, setShowDestinationPresets] = useState(false);
  const [showSiteRouting, setShowSiteRouting] = useState(false);

  const scheduleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scheduleBusyRef = useRef(false);

  // ─── Load live data ─────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [camRes, zoneRes] = await Promise.all([
        selectedProject
          ? getCameras({ project_id: Number(selectedProject.id) })
          : getCameras(),
        selectedProject
          ? getZones(Number(selectedProject.id))
          : Promise.resolve({ project_id: 0, project_name: "", zones: [] as ApiZone[] }),
      ]);
      setCameras(camRes.cameras);
      setZones(zoneRes.zones);
    } catch {
      toast.error("Failed to load live data");
    } finally {
      setLoadingData(false);
    }
  }, [selectedProject]);

  useEffect(() => { loadData(); }, [loadData]);

  const siteOptions: SiteOption[] = Array.from(
    new Map(
      zones.map(z => [z.site_id, { id: z.site_id, name: z.site_name }]),
    ).values(),
  );

  const scopedData = (() => {
    if (scopeMode === "by_site" && selectedSiteId !== "all") {
      const siteId = Number(selectedSiteId);
      return {
        cameras: cameras.filter(c => c.site_id === siteId),
        zones: zones.filter(z => z.site_id === siteId),
      };
    }
    if (scopeMode === "by_camera" && selectedCameraId !== "all") {
      return {
        cameras: cameras.filter(c => c.camera_id === selectedCameraId),
        zones: zones.filter(z => z.camera_id === selectedCameraId),
      };
    }
    if (scopeMode === "selected_zones" && selectedZoneIds.length > 0) {
      const selected = new Set(selectedZoneIds);
      const scopedZones = zones.filter(z => selected.has(z.zone_id));
      const scopedCameraIds = new Set(scopedZones.map(z => z.camera_id));
      return {
        cameras: cameras.filter(c => scopedCameraIds.has(c.camera_id)),
        zones: scopedZones,
      };
    }
    if (scopeMode === "all_cameras") {
      return { cameras, zones: zones.filter(z => cameras.some(c => c.camera_id === z.camera_id)) };
    }
    return { cameras, zones };
  })();

  // ─── Apply template ─────────────────────────────────────────────────────

  const applyTemplate = (t: Template) => {
    const { url: tUrl, body } = t.build(scopedData.cameras, scopedData.zones);
    consoleState.setMethod(t.method);
    consoleState.setUrl(tUrl);
    if (body !== null) {
      consoleState.setBodyText(JSON.stringify(body, null, 2));
      consoleState.setBodyMode("json");
      consoleState.setReqTab("body");
    } else {
      consoleState.setBodyMode("none");
      consoleState.setReqTab("params");
    }
    consoleState.setActiveTemplate(t.id);
    consoleState.setResponse(null);
    consoleState.setJsonError("");
  };

  useEffect(() => {
    if (!consoleState.activeTemplate && TEMPLATES.length > 0) {
      consoleState.setActiveTemplate(TEMPLATES[0].id);
    }
  }, [consoleState.activeTemplate, consoleState]);

  const activeTemplateDef = TEMPLATES.find(t => t.id === consoleState.activeTemplate) ?? TEMPLATES[0];

  // ─── Build guided config ────────────────────────────────────────────────

  const applyBodyOptions = (body: object | null): object | null => {
    if (!body || typeof body !== "object") return body;
    const next = { ...(body as Record<string, unknown>) };
    if (!templateOptions.includeSummary && "summary" in next) delete next.summary;
    if (!templateOptions.includeTimestamp && "timestamp" in next) delete next.timestamp;
    return next;
  };

  const buildGuidedConfig = (
    t = activeTemplateDef,
    source = scopedData,
    urlOverride?: string,
  ): SendConfig | null => {
    if (!t) {
      toast.error("Select a template first");
      return null;
    }

    const camerasForTemplate = templateOptions.onlyOnlineCameras
      ? getOnlineCameras(source.cameras)
      : source.cameras;
    const cameraSet = new Set(camerasForTemplate.map(c => c.camera_id));
    const zonesForTemplate = source.zones.filter(z => cameraSet.has(z.camera_id));

    const built = t.build(camerasForTemplate, zonesForTemplate);
    const isInternalTemplate = t.id.startsWith("get_");
    let guidedUrl = urlOverride ?? built.url;

    if (t.id === "get_status") {
      const siteId =
        scopeMode === "by_site" && selectedSiteId !== "all"
          ? Number(selectedSiteId)
          : (zonesForTemplate[0]?.site_id ?? siteOptions[0]?.id);
      if (!siteId) {
        toast.error("Select a site for occupancy status request");
        return null;
      }
      guidedUrl = `/api/v1/sites/${siteId}/status`;
    }

    if (t.id === "get_cameras") {
      const qs = new URLSearchParams();
      if (scopeMode === "by_site" && selectedSiteId !== "all") {
        qs.set("site_id", selectedSiteId);
      } else if (selectedProject?.id) {
        qs.set("project_id", String(selectedProject.id));
      }
      guidedUrl = `/admin/cameras.json${qs.toString() ? `?${qs}` : ""}`;
    }

    if (!isInternalTemplate) {
      const target = (urlOverride ?? consoleState.url).trim();
      if (!target || target === "https://") {
        toast.error("Set destination URL for this push template");
        return null;
      }
      guidedUrl = target;
    }

    const bodyObj = applyBodyOptions(built.body);
    const hasBody = bodyObj !== null && t.method !== "GET" && t.method !== "HEAD";

    return {
      method: t.method,
      url: guidedUrl,
      params: [],
      headers: consoleState.headers,
      authType: consoleState.authType,
      authValue: consoleState.authValue,
      bodyMode: hasBody ? "json" : "none",
      bodyText: hasBody ? JSON.stringify(bodyObj, null, 2) : "",
    };
  };

  // ─── Execute send ───────────────────────────────────────────────────────

  const executeSend = async (config: SendConfig, quiet = false): Promise<ProxyResponse | null> => {
    const trimmedUrl = config.url.trim();
    if (!trimmedUrl || trimmedUrl === "https://") {
      if (!quiet) toast.error("Enter a destination URL");
      return null;
    }
    if (config.bodyMode === "json" && config.bodyText.trim()) {
      try { JSON.parse(config.bodyText); }
      catch {
        if (!quiet) toast.error("Fix JSON errors before sending");
        return null;
      }
    }

    consoleState.setIsSending(true);
    consoleState.setResponse(null);

    const finalUrl = buildResolvedUrl(trimmedUrl, config.params);
    const hMap = buildHeaders(config.headers, config.authType, config.authValue);
    if (config.bodyMode === "json" && !hMap["Content-Type"]) hMap["Content-Type"] = "application/json";

    const isInternal = finalUrl.startsWith("/");
    const t0 = Date.now();

    try {
      let proxyRes: ProxyResponse;

      if (isInternal) {
        const opts: RequestInit = { method: config.method, headers: hMap, credentials: "include" };
        if (config.bodyMode !== "none" && config.bodyText.trim() && config.method !== "GET" && config.method !== "HEAD") {
          opts.body = config.bodyText;
        }
        const raw = await fetch(finalUrl, opts);
        const ms = Date.now() - t0;
        const ct = raw.headers.get("content-type") ?? "";
        const body = await raw.text();
        const resHeaders: Record<string, string> = {};
        raw.headers.forEach((v, k) => { resHeaders[k] = v; });
        proxyRes = {
          status: raw.status,
          status_text: raw.statusText,
          headers: resHeaders,
          body,
          content_type: ct,
          size: new TextEncoder().encode(body).length,
          ms,
          ok: raw.ok,
        };
      } else {
        let outboundBody: object | string | null = null;
        if (config.bodyMode !== "none" && config.bodyText.trim() && config.method !== "GET" && config.method !== "HEAD") {
          outboundBody = config.bodyMode === "json" ? JSON.parse(config.bodyText) : config.bodyText;
        }
        const raw = await fetch("/admin/outbound/proxy", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: config.method, url: finalUrl, headers: hMap, body: outboundBody }),
        });
        const ms = Date.now() - t0;
        if (!raw.ok) {
          const errJson = await raw.json().catch(() => ({})) as { error?: string; detail?: string };
          proxyRes = {
            status: raw.status,
            status_text: errJson.error ?? raw.statusText,
            headers: {},
            body: errJson.detail ?? errJson.error ?? "Proxy error",
            content_type: "text/plain",
            size: 0,
            ms,
            ok: false,
            error: errJson.error,
            detail: errJson.detail,
          };
        } else {
          proxyRes = await raw.json() as ProxyResponse;
          proxyRes.ms = ms;
        }
      }

      consoleState.setResponse(proxyRes);
      consoleState.setResTab(proxyRes.content_type?.includes("json") ? "pretty" : "raw");

      if (!quiet) {
        if (proxyRes.ok || (proxyRes.status >= 200 && proxyRes.status < 300)) {
          toast.success(`${proxyRes.status} ${proxyRes.status_text}`, {
            description: `${proxyRes.ms}ms · ${formatSize(proxyRes.size)}`,
          });
        } else {
          toast.error(`${proxyRes.status} ${proxyRes.status_text || "Error"}`, {
            description: proxyRes.detail ?? proxyRes.error,
          });
        }
      }

      consoleState.addToHistory({
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        method: config.method,
        url: finalUrl,
        status: proxyRes.status,
        ms: proxyRes.ms,
        ok: proxyRes.ok,
      });
      return proxyRes;
    } catch (err) {
      const ms = Date.now() - t0;
      const detail = err instanceof Error ? err.message : String(err);
      consoleState.setResponse({
        status: 0, status_text: "Network Error", headers: {},
        body: detail, content_type: "text/plain", size: 0, ms, ok: false,
      });
      if (!quiet) toast.error("Request failed", { description: detail });
      return null;
    } finally {
      consoleState.setIsSending(false);
    }
  };

  const handleSend = async () => {
    await executeSend({
      method: consoleState.method,
      url: consoleState.url,
      params: consoleState.params,
      headers: consoleState.headers,
      authType: consoleState.authType,
      authValue: consoleState.authValue,
      bodyMode: consoleState.bodyMode,
      bodyText: consoleState.bodyText,
    });
  };

  const handleGuidedSend = async (quiet = false) => {
    if (!activeTemplateDef) return;

    if (dispatchMode === "site_routes" && !activeTemplateDef.id.startsWith("get_")) {
      const siteIds = Array.from(new Set(scopedData.zones.map(z => z.site_id)));
      if (siteIds.length === 0) {
        if (!quiet) toast.error("No site data available for route mapping");
        return;
      }

      let sent = 0;
      let skipped = 0;

      for (const siteId of siteIds) {
        const rule = routes.find(r => r.siteId === siteId);
        const routeTarget = rule ? rule.url : consoleState.url.trim();
        if (!routeTarget || routeTarget === "https://") {
          skipped += 1;
          continue;
        }

        const siteData = {
          cameras: scopedData.cameras.filter(c => c.site_id === siteId),
          zones: scopedData.zones.filter(z => z.site_id === siteId),
        };
        const cfg = buildGuidedConfig(activeTemplateDef, siteData, routeTarget);
        if (!cfg) {
          skipped += 1;
          continue;
        }
        const result = await executeSend(cfg, true);
        const siteLabel = siteOptions.find(s => s.id === siteId)?.name ?? `Site ${siteId}`;
        setDispatchStats(prev => [...prev, {
          label: siteLabel,
          target: routeTarget,
          success: result?.ok ? 1 : 0,
          fail: result?.ok ? 0 : 1,
          lastStatus: result?.status ?? null,
          lastRunAt: Date.now(),
        }]);
        sent += 1;
      }

      if (!quiet) {
        toast.success(`Dispatched ${sent} site payload(s), skipped ${skipped}`);
      }
      return;
    }

    const config = buildGuidedConfig(activeTemplateDef, scopedData);
    if (!config) return;
    consoleState.setMethod(config.method);
    consoleState.setUrl(config.url);
    consoleState.setBodyMode(config.bodyMode);
    consoleState.setBodyText(config.bodyText);
    const result = await executeSend(config, quiet);
    setDispatchStats(prev => [...prev, {
      label: "Single destination",
      target: config.url,
      success: result?.ok ? 1 : 0,
      fail: result?.ok ? 0 : 1,
      lastStatus: result?.status ?? null,
      lastRunAt: Date.now(),
    }]);
  };

  const handleScheduler = useCallback(() => {
    if (scheduleRunning) {
      stopScheduler();
      if (scheduleRef.current) {
        clearInterval(scheduleRef.current);
        scheduleRef.current = null;
      }
      scheduleBusyRef.current = false;
      return;
    }

    const config = buildGuidedConfig(activeTemplateDef, scopedData);
    if (!config) return;
    
    startScheduler(async () => {
      if (scheduleBusyRef.current) return;
      scheduleBusyRef.current = true;
      await handleGuidedSend(true);
      scheduleBusyRef.current = false;
    });
  }, [scheduleRunning, activeTemplateDef, scopedData, buildGuidedConfig, startScheduler, stopScheduler]);

  useEffect(() => {
    return () => {
      if (scheduleRef.current) {
        clearInterval(scheduleRef.current);
      }
    };
  }, []);

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col bg-[#0d1117] text-[#e6edf3] overflow-hidden">
      {/* Header */}
      <ApiConsoleHeader
        method={consoleState.method}
        setMethod={consoleState.setMethod}
        url={consoleState.url}
        setUrl={consoleState.setUrl}
        onSend={consoleState.mode === "guided" ? () => handleGuidedSend(false) : handleSend}
        onRefresh={loadData}
        isSending={consoleState.isSending}
        loadingData={loadingData}
        mode={consoleState.mode}
        setMode={consoleState.setMode}
        showTemplates={consoleState.showTemplates}
        setShowTemplates={consoleState.setShowTemplates}
      />

      {/* Main content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Templates sidebar */}
        {consoleState.showTemplates && (
          <TemplatePanel
            templates={TEMPLATES}
            activeTemplate={consoleState.activeTemplate}
            onSelectTemplate={(id) => {
              const t = TEMPLATES.find(x => x.id === id);
              if (t) applyTemplate(t);
            }}
            cameras={cameras}
            zones={zones}
          />
        )}

        {/* Main content area */}
        <div className="flex-1 flex flex-col min-h-0">
          {consoleState.mode === "guided" ? (
            <GuidedModePanel
              activeTemplate={consoleState.activeTemplate}
              setActiveTemplate={consoleState.setActiveTemplate}
              templates={TEMPLATES}
              scopeMode={scopeMode}
              setScopeMode={setScopeMode}
              selectedSiteId={selectedSiteId}
              setSelectedSiteId={setSelectedSiteId}
              selectedCameraId={selectedCameraId}
              setSelectedCameraId={setSelectedCameraId}
              selectedZoneIds={selectedZoneIds}
              setSelectedZoneIds={setSelectedZoneIds}
              url={consoleState.url}
              setUrl={consoleState.setUrl}
              authType={consoleState.authType}
              setAuthType={consoleState.setAuthType}
              authValue={consoleState.authValue}
              setAuthValue={consoleState.setAuthValue}
              templateOptions={templateOptions}
              setTemplateOptions={setTemplateOptions}
              dispatchMode={dispatchMode}
              setDispatchMode={setDispatchMode}
              scheduleMs={scheduleMs}
              setScheduleMs={setScheduleMs}
              scheduleRunning={scheduleRunning}
              nextRunAt={nextRunAt}
              onStartScheduler={() => handleScheduler()}
              onStopScheduler={() => handleScheduler()}
              onPreview={() => {
                const config = buildGuidedConfig();
                if (config) {
                  consoleState.setMethod(config.method);
                  consoleState.setBodyMode(config.bodyMode);
                  consoleState.setBodyText(config.bodyText);
                }
              }}
              onSend={() => handleGuidedSend(false)}
              onExportConfig={() => {
                const payload = {
                  version: 1,
                  presets,
                  siteRoutes: routes,
                  templateOptions,
                  scheduleMs,
                  dispatchMode,
                };
                navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                toast.success("Console config copied to clipboard");
              }}
              onImportConfig={(text) => {
                try {
                  const parsed = JSON.parse(text);
                  if (Array.isArray(parsed.presets)) {
                    parsed.presets.forEach((p: DestinationPreset) => addPreset(p));
                  }
                  if (Array.isArray(parsed.siteRoutes)) {
                    parsed.siteRoutes.forEach((r: SiteRouteRule) => addRoute(r));
                  }
                  toast.success("Config imported");
                } catch {
                  toast.error("Invalid JSON");
                }
              }}
              cameras={cameras}
              zones={zones}
              siteOptions={siteOptions}
              templateWizard={{}}
              presets={presets}
              presetName=""
              setPresetName={() => {}}
              onSavePreset={() => {}}
              onApplyPreset={() => {}}
              onDeletePreset={deletePreset}
              siteRoutes={routes}
              onAddSiteRoute={addRoute}
              onDeleteSiteRoute={deleteRoute}
              guidedPreview=""
              dispatchStats={dispatchStats}
              onClearStats={() => setDispatchStats([])}
              showImportPanel={false}
              setShowImportPanel={() => {}}
              importConfigText=""
              setImportConfigText={() => {}}
              scopedData={scopedData}
            />
          ) : (
            <AdvancedModePanel
              method={consoleState.method}
              url={consoleState.url}
              params={consoleState.params}
              setParams={consoleState.setParams}
              headers={consoleState.headers}
              setHeaders={consoleState.setHeaders}
              authType={consoleState.authType}
              setAuthType={consoleState.setAuthType}
              authValue={consoleState.authValue}
              setAuthValue={consoleState.setAuthValue}
              bodyMode={consoleState.bodyMode}
              setBodyMode={consoleState.setBodyMode}
              bodyText={consoleState.bodyText}
              setBodyText={consoleState.setBodyText}
              jsonError={consoleState.jsonError}
              reqTab={consoleState.reqTab}
              setReqTab={consoleState.setReqTab}
              response={consoleState.response}
              resTab={consoleState.resTab}
              setResTab={consoleState.setResTab}
              isSending={consoleState.isSending}
              onFormatBody={() => {
                try {
                  consoleState.setBodyText(prettyPrintJson(consoleState.bodyText));
                  consoleState.setJsonError("");
                } catch { /* leave as-is */ }
              }}
            />
          )}
        </div>

        {/* History sidebar */}
        {consoleState.history.length > 0 && (
          <HistoryPanel
            history={consoleState.history}
            onSelectEntry={(url) => consoleState.setUrl(url)}
            onClearHistory={consoleState.clearHistory}
          />
        )}
      </div>

      {/* Modals */}
      <DestinationPresets
        isOpen={showDestinationPresets}
        onClose={() => setShowDestinationPresets(false)}
        presets={presets}
        onAddPreset={addPreset}
        onUpdatePreset={updatePreset}
        onDeletePreset={deletePreset}
      />

      <SiteRoutingConfig
        isOpen={showSiteRouting}
        onClose={() => setShowSiteRouting(false)}
        routes={routes}
        onAddRoute={addRoute}
        onDeleteRoute={deleteRoute}
        sites={siteOptions}
        presets={presets}
      />
    </div>
  );
}
