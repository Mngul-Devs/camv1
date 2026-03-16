/**
 * ClientsTab.tsx
 * Full CRUD management for push clients.
 * Lists all clients with: Add, Edit, Test, Pause/Resume, Delete.
 */

import { useState } from "react";
import { Plus, Search, Pencil, Trash2, Pause, Play, Send, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { AddEditClientModal } from "./AddEditClientModal";
import type { PushClient, PushLogEntry } from "../pushConsoleTypes";
import type { ApiCamera, ApiSite } from "../../../../lib/api";

interface ClientsTabProps {
  clients: PushClient[];
  cameras: ApiCamera[];
  sites: ApiSite[];
  onAddClient: (client: PushClient) => void;
  onUpdateClient: (client: PushClient) => void;
  onDeleteClient: (id: string) => void;
  onTogglePause: (id: string) => void;
  onTestClient: (client: PushClient) => Promise<PushLogEntry>;
}

function relativeTime(ms: number | null): string {
  if (ms === null) return "never";
  const diff = Date.now() - ms;
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function healthDot(client: PushClient): string {
  if (client.paused) return "bg-[#6e7681]";
  const total = client.successCount + client.errorCount;
  if (total === 0) return "bg-[#6e7681]";
  const rate = client.errorCount / total;
  if (rate < 0.02) return "bg-[#3fb950]";
  if (rate < 0.1) return "bg-[#d29922]";
  return "bg-[#f85149]";
}

function AuthBadge({ type }: { type: PushClient["authType"] }) {
  const map = {
    bearer: "bg-[#58a6ff]/10 text-[#58a6ff] border-[#58a6ff]/25",
    apikey: "bg-[#d29922]/10 text-[#d29922] border-[#d29922]/25",
    basic:  "bg-[#bc8cff]/10 text-[#bc8cff] border-[#bc8cff]/25",
    none:   "bg-[#2a2f36] text-[#6e7681] border-[#2a2f36]",
  };
  const label = { bearer: "Bearer", apikey: "API Key", basic: "Basic", none: "None" };
  return (
    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${map[type]}`}>{label[type]}</span>
  );
}

function ScopeBadge({ scope }: { scope: PushClient["scope"] }) {
  const map = {
    project: "bg-[#3fb950]/10 text-[#3fb950] border-[#3fb950]/25",
    site:    "bg-[#58a6ff]/10 text-[#58a6ff] border-[#58a6ff]/25",
    camera:  "bg-[#d29922]/10 text-[#d29922] border-[#d29922]/25",
  };
  const label = { project: "Project", site: "Site", camera: "Camera" };
  return (
    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded border ${map[scope]}`}>{label[scope]}</span>
  );
}

function TestResultBadge({ status }: { status: "ok" | "fail" | null }) {
  if (!status) return null;
  return status === "ok"
    ? <span className="font-mono text-[10px] text-[#3fb950] animate-pulse">✓ 200</span>
    : <span className="font-mono text-[10px] text-[#f85149]">✗ ERR</span>;
}

interface RowProps {
  client: PushClient;
  onEdit: (c: PushClient) => void;
  onDelete: (id: string) => void;
  onTogglePause: (id: string) => void;
  onTest: (c: PushClient) => void;
  testingId: string | null;
  testResults: Record<string, "ok" | "fail">;
}

function ClientRow({ client, onEdit, onDelete, onTogglePause, onTest, testingId, testResults }: RowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isTesting = testingId === client.id;
  const testResult = testResults[client.id] ?? null;

  return (
    <tr className={["transition-colors", client.paused ? "opacity-60" : "hover:bg-[#1c2128]/50"].join(" ")}>
      {/* Name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${healthDot(client)}`} />
          <div className="min-w-0">
            <p className="font-medium text-[#e6edf3] text-xs truncate max-w-[140px]">{client.name}</p>
            {client.description && (
              <p className="text-[10px] text-[#6e7681] truncate max-w-[140px] mt-0.5">{client.description}</p>
            )}
          </div>
          {client.paused && <span className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-[#2a2f36] text-[#6e7681] border border-[#2a2f36] flex-shrink-0">PAUSED</span>}
        </div>
      </td>

      {/* Endpoint */}
      <td className="px-4 py-3">
        <p className="font-mono text-[11px] text-[#9da7b3] truncate max-w-[160px]">
          {client.endpoint.replace(/^https?:\/\//, "")}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={["font-mono text-[9px] px-1 py-0.5 rounded border", client.endpoint.startsWith("https") ? "text-[#3fb950] border-[#3fb950]/25 bg-[#3fb950]/10" : "text-[#d29922] border-[#d29922]/25 bg-[#d29922]/10"].join(" ")}>
            {client.endpoint.startsWith("https") ? "HTTPS" : "HTTP"}
          </span>
          <AuthBadge type={client.authType} />
        </div>
      </td>

      {/* What to push */}
      <td className="px-4 py-3">
        <ScopeBadge scope={client.scope} />
        <p className="text-[10px] text-[#6e7681] mt-1 font-mono">
          {client.scope === "camera" ? `${client.selectedCameraIds.length} cams` : client.scope === "site" ? `${client.selectedSiteIds.length} sites` : "all cameras"}
        </p>
      </td>

      {/* Interval */}
      <td className="px-4 py-3">
        <span className="font-mono text-[11px] text-[#d29922]">
          {client.intervalSeconds >= 60 ? `${client.intervalSeconds / 60}m` : `${client.intervalSeconds}s`}
        </span>
      </td>

      {/* Analytics */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-[#3fb950]">{client.successCount.toLocaleString()}</span>
          <span className="font-mono text-[11px] text-[#6e7681]">/</span>
          <span className="font-mono text-[11px] text-[#f85149]">{client.errorCount}</span>
        </div>
        <p className="text-[10px] text-[#6e7681] font-mono mt-0.5">{relativeTime(client.lastSeenAt)}</p>
      </td>

      {/* Actions */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          {/* Test */}
          <button
            onClick={() => onTest(client)}
            disabled={isTesting}
            title="Send test push"
            className="w-7 h-7 rounded flex items-center justify-center border border-[#2a2f36] text-[#6e7681] hover:text-[#58a6ff] hover:border-[#58a6ff]/40 hover:bg-[#58a6ff]/5 transition-all disabled:opacity-40"
          >
            {isTesting ? (
              <span className="w-3 h-3 border border-[#58a6ff]/40 border-t-[#58a6ff] rounded-full animate-spin" />
            ) : (
              <Send className="w-3 h-3" />
            )}
          </button>

          {testResult && <TestResultBadge status={testResult} />}

          {/* Edit */}
          <button
            onClick={() => onEdit(client)}
            title="Edit client"
            className="w-7 h-7 rounded flex items-center justify-center border border-[#2a2f36] text-[#6e7681] hover:text-[#e6edf3] hover:border-[#444c56] transition-all"
          >
            <Pencil className="w-3 h-3" />
          </button>

          {/* Pause / Resume */}
          <button
            onClick={() => onTogglePause(client.id)}
            title={client.paused ? "Resume" : "Pause"}
            className="w-7 h-7 rounded flex items-center justify-center border border-[#2a2f36] text-[#6e7681] hover:text-[#d29922] hover:border-[#d29922]/40 hover:bg-[#d29922]/5 transition-all"
          >
            {client.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          </button>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button onClick={() => onDelete(client.id)} className="px-2 py-1 rounded text-[10px] font-mono font-semibold bg-[#f85149]/15 text-[#f85149] border border-[#f85149]/30 hover:bg-[#f85149]/25 transition-all">
                Confirm
              </button>
              <button onClick={() => setConfirmDelete(false)} className="px-1.5 py-1 rounded text-[10px] font-mono text-[#6e7681] border border-[#2a2f36] hover:text-[#9da7b3] transition-all">
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete client"
              className="w-7 h-7 rounded flex items-center justify-center border border-[#2a2f36] text-[#6e7681] hover:text-[#f85149] hover:border-[#f85149]/40 hover:bg-[#f85149]/5 transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ClientsTab({ clients, cameras, sites, onAddClient, onUpdateClient, onDeleteClient, onTogglePause, onTestClient }: ClientsTabProps) {
  const [search, setSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingClient, setEditingClient] = useState<PushClient | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, "ok" | "fail">>({});
  const [sortBy, setSortBy] = useState<"name" | "lastSeen" | "errors">("lastSeen");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleEdit = (client: PushClient) => {
    setEditingClient(client);
    setShowModal(true);
  };

  const handleSave = (client: PushClient) => {
    if (editingClient) {
      onUpdateClient(client);
    } else {
      onAddClient(client);
    }
    setShowModal(false);
    setEditingClient(null);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingClient(null);
  };

  const handleTest = async (client: PushClient) => {
    setTestingId(client.id);
    try {
      const result = await onTestClient(client);
      setTestResults((prev) => ({ ...prev, [client.id]: result.ok ? "ok" : "fail" }));
      setTimeout(() => setTestResults((prev) => { const n = { ...prev }; delete n[client.id]; return n; }), 4000);
    } finally {
      setTestingId(null);
    }
  };

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortBy(field); setSortDir("desc"); }
  };

  const filtered = clients
    .filter((c) => c.name.toLowerCase().includes(search.toLowerCase()) || c.endpoint.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let val = 0;
      if (sortBy === "name") val = a.name.localeCompare(b.name);
      else if (sortBy === "lastSeen") val = (a.lastSeenAt ?? 0) - (b.lastSeenAt ?? 0);
      else if (sortBy === "errors") val = a.errorCount - b.errorCount;
      return sortDir === "asc" ? val : -val;
    });

  function SortIcon({ field }: { field: typeof sortBy }) {
    if (sortBy !== field) return null;
    return sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6e7681]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients or endpoints…"
            className="pl-8 h-8 bg-[#1c2128] border-[#2a2f36] text-[#e6edf3] text-xs font-mono placeholder:text-[#6e7681] focus-visible:ring-[#3fb950]/30 focus-visible:border-[#3fb950]/50"
          />
        </div>
        <Button
          size="sm"
          onClick={() => { setEditingClient(null); setShowModal(true); }}
          className="bg-[#3fb950] hover:bg-[#3fb950]/90 text-black font-semibold h-8 text-xs gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> Add client
        </Button>
      </div>

      {/* Table */}
      <div className="border border-[#2a2f36] rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[#6e7681]">
            <div className="w-10 h-10 rounded-lg bg-[#1c2128] border border-[#2a2f36] flex items-center justify-center">
              <Plus className="w-5 h-5" />
            </div>
            <div className="text-center">
              <p className="text-sm text-[#9da7b3] font-medium">{search ? "No clients match" : "No clients yet"}</p>
              <p className="text-xs text-[#6e7681] mt-1">{search ? "Try a different search" : "Add your first push client to start delivering parking data"}</p>
            </div>
            {!search && (
              <Button size="sm" onClick={() => setShowModal(true)} className="bg-[#3fb950] hover:bg-[#3fb950]/90 text-black font-semibold h-8 text-xs gap-1.5 mt-1">
                <Plus className="w-3.5 h-3.5" /> Add first client
              </Button>
            )}
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2a2f36] bg-[#0f1115]">
                <th className="px-4 py-2.5 text-left">
                  <button onClick={() => toggleSort("name")} className="text-[10px] font-semibold uppercase tracking-wide text-[#6e7681] hover:text-[#9da7b3] transition-colors">
                    Client <SortIcon field="name" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#6e7681]">Endpoint</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#6e7681]">What to push</th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#6e7681]">Interval</th>
                <th className="px-4 py-2.5 text-left">
                  <button onClick={() => toggleSort("lastSeen")} className="text-[10px] font-semibold uppercase tracking-wide text-[#6e7681] hover:text-[#9da7b3] transition-colors">
                    OK / Err <SortIcon field="lastSeen" />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#6e7681]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2f36]">
              {filtered.map((client) => (
                <ClientRow
                  key={client.id}
                  client={client}
                  onEdit={handleEdit}
                  onDelete={onDeleteClient}
                  onTogglePause={onTogglePause}
                  onTest={handleTest}
                  testingId={testingId}
                  testResults={testResults}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Summary footer */}
      {filtered.length > 0 && (
        <p className="text-[10px] text-[#6e7681] font-mono">
          {filtered.length} client{filtered.length !== 1 ? "s" : ""} ·{" "}
          {clients.filter((c) => !c.paused).length} active ·{" "}
          {clients.filter((c) => c.paused).length} paused
        </p>
      )}

      <AddEditClientModal
        open={showModal}
        onClose={handleCloseModal}
        onSave={handleSave}
        clientToEdit={editingClient}
        cameras={cameras}
        sites={sites}
      />
    </div>
  );
}
