/**
 * PushConsolePage.tsx
 * Multi-client push management — wired to real backend.
 * Route: /app/project/:projectId/push-console
 *
 * Tab flow:
 *   Clients   → Add / Edit / Delete / Test / Pause push clients
 *   Analytics → Per-client delivery stats and aggregate overview
 *   Logs      → Per-client tagged push log feed
 */

import { useState, useCallback, useEffect } from "react";
import { ClientsTab } from "./components/ClientsTab";
import { AnalyticsTab } from "./components/AnalyticsTab";
import { LogsTab } from "./components/LogsTab";
import type { PushClient, PushLogEntry } from "./pushConsoleTypes";
import { useOrganization } from "../../contexts/OrganizationContext";
import { getCameras, type ApiCamera, type ApiSite } from "../../../lib/api";

const CLIENTS_STORAGE_KEY = "pushclients_v1";

// ─── Tab button ───────────────────────────────────────────────────────────────

type TabId = "clients" | "analytics" | "logs";

function TabButton({ active, onClick, badge, children }: { active: boolean; onClick: () => void; badge?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={["flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap", active ? "text-[#e6edf3] border-[#3fb950]" : "text-[#9da7b3] border-transparent hover:text-[#e6edf3]"].join(" ")}
    >
      {children}
      {badge && (
        <span className={["font-mono text-[10px] px-1.5 py-0.5 rounded-full", active ? "bg-[#3fb950]/15 text-[#3fb950]" : "bg-[#2a2f36] text-[#6e7681]"].join(" ")}>
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PushConsolePage() {
  const { selectedProject } = useOrganization();
  const [activeTab, setActiveTab] = useState<TabId>("clients");

  // ── Real cameras from API
  const [cameras, setCameras] = useState<ApiCamera[]>([]);
  useEffect(() => {
    if (!selectedProject) { setCameras([]); return; }
    getCameras({ project_id: Number(selectedProject.id) })
      .then((r) => setCameras(r.cameras))
      .catch(() => setCameras([]));
  }, [selectedProject?.id]);

  // ── Sites derived from selectedProject (already loaded in context)
  const sites: ApiSite[] = (selectedProject?.sites ?? []).map((s) => ({
    id: Number(s.id),
    name: s.name,
    location: s.address || null,
    latitude: s.lat,
    longitude: s.lng,
    city: s.city || null,
    camera_count: s.cameras,
  }));

  // ── Push clients — persisted in localStorage (backend persistence deferred)
  const [clients, setClients] = useState<PushClient[]>(() => {
    try {
      const stored = localStorage.getItem(CLIENTS_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as PushClient[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(clients));
  }, [clients]);

  // ── Logs — session only (not persisted)
  const [logs, setLogs] = useState<PushLogEntry[]>([]);

  // ── Client CRUD
  const handleAddClient = useCallback((client: PushClient) => {
    setClients((prev) => [...prev, client]);
  }, []);

  const handleUpdateClient = useCallback((updated: PushClient) => {
    setClients((prev) => prev.map((c) => c.id === updated.id ? updated : c));
  }, []);

  const handleDeleteClient = useCallback((id: string) => {
    setClients((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const handleTogglePause = useCallback((id: string) => {
    setClients((prev) => prev.map((c) => c.id === id ? { ...c, paused: !c.paused } : c));
  }, []);

  // ── Test push — calls real outbound proxy
  const handleTestClient = useCallback(async (client: PushClient): Promise<PushLogEntry> => {
    const payload = {
      event: "push_console_test",
      source: "campark_v6",
      timestamp: new Date().toISOString(),
      scope: client.scope,
      project_id: selectedProject?.id ?? null,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "CamPark/6.0",
    };
    if (client.authType === "bearer" && client.bearerToken) {
      headers["Authorization"] = `Bearer ${client.bearerToken}`;
    } else if (client.authType === "apikey" && client.apiKeyHeader && client.apiKeyValue) {
      headers[client.apiKeyHeader] = client.apiKeyValue;
    } else if (client.authType === "basic" && client.basicUser) {
      try {
        headers["Authorization"] = `Basic ${btoa(`${client.basicUser}:${client.basicPass}`)}`;
      } catch {
        headers["Authorization"] = `Basic ${btoa(unescape(encodeURIComponent(`${client.basicUser}:${client.basicPass}`)))}`;
      }
    }
    client.customHeaders.filter((h) => h.enabled && h.key).forEach((h) => {
      headers[h.key] = h.value;
    });

    const start = Date.now();
    try {
      const res = await fetch("/admin/outbound/proxy", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "POST",
          url: client.endpoint,
          headers,
          body: JSON.stringify(payload),
        }),
      });
      const data = await res.json();
      const latencyMs = data.ms ?? (Date.now() - start);
      const ok = data.ok === true;

      const entry: PushLogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        clientId: client.id,
        clientName: client.name,
        status: data.status ?? (ok ? 200 : 500),
        target: client.endpoint,
        detail: ok
          ? `test ping · ${client.scope} scope · ${latencyMs}ms`
          : `test failed — ${data.status_text ?? "check endpoint or auth"}`,
        ok,
        latencyMs,
      };
      setLogs((prev) => [entry, ...prev].slice(0, 200));
      if (ok) {
        setClients((prev) => prev.map((c) =>
          c.id === client.id
            ? { ...c, successCount: c.successCount + 1, lastSeenAt: Date.now(), lastStatusCode: entry.status, avgLatencyMs: Math.round((c.avgLatencyMs * c.successCount + latencyMs) / (c.successCount + 1)) }
            : c
        ));
      } else {
        setClients((prev) => prev.map((c) =>
          c.id === client.id ? { ...c, errorCount: c.errorCount + 1, lastStatusCode: entry.status } : c
        ));
      }
      return entry;
    } catch (err) {
      const latencyMs = Date.now() - start;
      const entry: PushLogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        clientId: client.id,
        clientName: client.name,
        status: 0,
        target: client.endpoint,
        detail: `network error — ${err instanceof Error ? err.message : "unknown"}`,
        ok: false,
        latencyMs,
      };
      setLogs((prev) => [entry, ...prev].slice(0, 200));
      setClients((prev) => prev.map((c) =>
        c.id === client.id ? { ...c, errorCount: c.errorCount + 1, lastStatusCode: 0 } : c
      ));
      return entry;
    }
  }, [selectedProject?.id]);

  const handleClearLogs = useCallback(() => setLogs([]), []);

  const activeCount = clients.filter((c) => !c.paused).length;

  return (
    <div className="flex flex-col h-full bg-[#0f1115]">

      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2f36] bg-[#161b22] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-[#3fb950]/15 border border-[#3fb950]/30 flex items-center justify-center">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3fb950] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#3fb950]" />
            </span>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[#e6edf3]">Push Console</h1>
            <p className="text-[11px] text-[#6e7681] font-mono">v6 · multi-client webhook management</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono text-[#6e7681]">
            <span><span className="text-[#e6edf3]">{clients.length}</span> clients</span>
            <span className="w-px h-3 bg-[#2a2f36]" />
            <span><span className="text-[#3fb950]">{activeCount}</span> active</span>
            {cameras.length > 0 && (
              <>
                <span className="w-px h-3 bg-[#2a2f36]" />
                <span><span className="text-[#e6edf3]">{cameras.length}</span> cameras</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#3fb950]/10 border border-[#3fb950]/30">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse" />
            <span className="text-[11px] font-mono font-medium text-[#3fb950]">Operational</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-[#2a2f36] bg-[#161b22] px-6 flex-shrink-0 overflow-x-auto">
        <TabButton active={activeTab === "clients"} onClick={() => setActiveTab("clients")} badge={clients.length.toString()}>
          Clients
        </TabButton>
        <TabButton active={activeTab === "analytics"} onClick={() => setActiveTab("analytics")}>
          Analytics
        </TabButton>
        <TabButton active={activeTab === "logs"} onClick={() => setActiveTab("logs")} badge={logs.length > 0 ? logs.length.toString() : undefined}>
          Logs
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "clients" && (
          <ClientsTab
            clients={clients}
            cameras={cameras}
            sites={sites}
            onAddClient={handleAddClient}
            onUpdateClient={handleUpdateClient}
            onDeleteClient={handleDeleteClient}
            onTogglePause={handleTogglePause}
            onTestClient={handleTestClient}
          />
        )}
        {activeTab === "analytics" && (
          <AnalyticsTab clients={clients} />
        )}
        {activeTab === "logs" && (
          <LogsTab logs={logs} onClear={handleClearLogs} />
        )}
      </div>
    </div>
  );
}
