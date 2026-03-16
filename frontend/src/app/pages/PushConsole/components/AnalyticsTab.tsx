/**
 * AnalyticsTab.tsx
 * Real delivery analytics — per-client stats and aggregate overview.
 */

import type { PushClient } from "../pushConsoleTypes";

interface AnalyticsTabProps {
  clients: PushClient[];
}

function relativeTime(ms: number | null): string {
  if (ms === null) return "never";
  const diff = Date.now() - ms;
  if (diff < 5000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function SuccessRateBadge({ ok, err }: { ok: number; err: number }) {
  const total = ok + err;
  if (total === 0) return <span className="font-mono text-[11px] text-[#6e7681]">—</span>;
  const rate = (ok / total) * 100;
  const color = rate >= 98 ? "text-[#3fb950]" : rate >= 90 ? "text-[#d29922]" : "text-[#f85149]";
  return <span className={`font-mono text-[11px] font-medium ${color}`}>{rate.toFixed(1)}%</span>;
}

function MiniBar({ ok, err }: { ok: number; err: number }) {
  const total = ok + err;
  if (total === 0) return <div className="w-20 h-1.5 bg-[#2a2f36] rounded-full" />;
  const okPct = (ok / total) * 100;
  return (
    <div className="w-20 h-1.5 bg-[#2a2f36] rounded-full overflow-hidden">
      <div className="h-full bg-[#3fb950] rounded-full" style={{ width: `${okPct}%` }} />
    </div>
  );
}

function StatCard({ label, value, sub, green, red, yellow }: { label: string; value: string; sub?: string; green?: boolean; red?: boolean; yellow?: boolean }) {
  const color = green ? "text-[#3fb950]" : red ? "text-[#f85149]" : yellow ? "text-[#d29922]" : "text-[#e6edf3]";
  return (
    <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg p-4">
      <p className="text-[10px] text-[#6e7681] uppercase tracking-wide">{label}</p>
      <p className={`font-mono text-2xl font-medium mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-[#6e7681] font-mono mt-1">{sub}</p>}
    </div>
  );
}

export function AnalyticsTab({ clients }: AnalyticsTabProps) {
  const totalSuccess = clients.reduce((s, c) => s + c.successCount, 0);
  const totalErrors = clients.reduce((s, c) => s + c.errorCount, 0);
  const totalPushes = totalSuccess + totalErrors;
  const overallRate = totalPushes > 0 ? ((totalSuccess / totalPushes) * 100).toFixed(1) : "—";
  const activeClients = clients.filter((c) => !c.paused).length;
  const avgLatency = clients.filter((c) => c.avgLatencyMs > 0).length > 0
    ? Math.round(clients.filter((c) => c.avgLatencyMs > 0).reduce((s, c) => s + c.avgLatencyMs, 0) / clients.filter((c) => c.avgLatencyMs > 0).length)
    : 0;

  const sorted = [...clients].sort((a, b) => (b.successCount + b.errorCount) - (a.successCount + a.errorCount));

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active clients" value={activeClients.toString()} sub={`${clients.length} total`} />
        <StatCard label="Overall success" value={`${overallRate}%`} green={parseFloat(overallRate) >= 98} yellow={parseFloat(overallRate) >= 90 && parseFloat(overallRate) < 98} red={parseFloat(overallRate) < 90} />
        <StatCard label="Total pushes" value={totalPushes.toLocaleString()} sub={`${totalSuccess.toLocaleString()} ok`} />
        <StatCard label="Total errors" value={totalErrors.toLocaleString()} sub={avgLatency > 0 ? `avg ${avgLatency}ms` : undefined} red={totalErrors > 0} />
      </div>

      {/* Per-client breakdown */}
      <div>
        <h3 className="text-xs font-semibold text-[#e6edf3] mb-3">Per-client breakdown</h3>

        {clients.length === 0 ? (
          <div className="border border-[#2a2f36] rounded-lg py-12 text-center">
            <p className="text-sm text-[#9da7b3] font-medium">No clients yet</p>
            <p className="text-xs text-[#6e7681] mt-1">Add clients from the Clients tab to see analytics here</p>
          </div>
        ) : (
          <div className="border border-[#2a2f36] rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#2a2f36] bg-[#0f1115]">
                  {["Client", "Endpoint", "Success rate", "Ok / Err", "Avg latency", "Last push", "Status"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[#6e7681]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2f36]">
                {sorted.map((client) => (
                  <tr key={client.id} className={["transition-colors", client.paused ? "opacity-50" : "hover:bg-[#1c2128]/50"].join(" ")}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#e6edf3] truncate max-w-[120px]">{client.name}</p>
                      {client.paused && <span className="font-mono text-[9px] text-[#6e7681]">PAUSED</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono text-[11px] text-[#9da7b3] truncate max-w-[150px]">
                        {client.endpoint.replace(/^https?:\/\/([^/]+).*/, "$1")}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <SuccessRateBadge ok={client.successCount} err={client.errorCount} />
                        <MiniBar ok={client.successCount} err={client.errorCount} />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-[#3fb950]">{client.successCount.toLocaleString()}</span>
                        <span className="text-[#6e7681]">/</span>
                        <span className="font-mono text-[11px] text-[#f85149]">{client.errorCount}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[11px] text-[#e6edf3]">
                        {client.avgLatencyMs > 0 ? `${client.avgLatencyMs}ms` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[10px] text-[#6e7681]">{relativeTime(client.lastSeenAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        if (client.paused) return <span className="font-mono text-[10px] text-[#6e7681]">Paused</span>;
                        const total = client.successCount + client.errorCount;
                        if (total === 0) return <span className="font-mono text-[10px] text-[#6e7681]">New</span>;
                        const rate = client.errorCount / total;
                        if (rate < 0.02) return <span className="font-mono text-[10px] text-[#3fb950]">● Healthy</span>;
                        if (rate < 0.1) return <span className="font-mono text-[10px] text-[#d29922]">● Degraded</span>;
                        return <span className="font-mono text-[10px] text-[#f85149]">● Failing</span>;
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Volume by scope */}
      {clients.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-[#e6edf3] mb-3">Scope distribution</h3>
          <div className="grid grid-cols-3 gap-3">
            {(["project", "site", "camera"] as const).map((scope) => {
              const count = clients.filter((c) => c.scope === scope).length;
              const pct = clients.length > 0 ? Math.round((count / clients.length) * 100) : 0;
              const label = { project: "Project", site: "By site", camera: "By camera" }[scope];
              const color = { project: "bg-[#3fb950]", site: "bg-[#58a6ff]", camera: "bg-[#d29922]" }[scope];
              const textColor = { project: "text-[#3fb950]", site: "text-[#58a6ff]", camera: "text-[#d29922]" }[scope];
              return (
                <div key={scope} className="bg-[#1c2128] border border-[#2a2f36] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-[#6e7681] uppercase tracking-wide">{label}</span>
                    <span className={`font-mono text-xs font-medium ${textColor}`}>{count}</span>
                  </div>
                  <div className="h-1 bg-[#2a2f36] rounded-full overflow-hidden">
                    <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="font-mono text-[10px] text-[#6e7681] mt-1">{pct}% of clients</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
