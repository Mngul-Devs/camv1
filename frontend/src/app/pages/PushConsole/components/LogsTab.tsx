/**
 * LogsTab.tsx
 * Live push log feed — timestamped entries with status codes and latency.
 */

import { useState } from "react";
import { Check, AlertTriangle, Trash2 } from "lucide-react";
import type { PushLogEntry, LogFilter } from "../pushConsoleTypes";

interface LogsTabProps {
  logs: PushLogEntry[];
  onClear: () => void;
}

function formatTime(ms: number): string {
  return new Date(ms).toTimeString().slice(0, 8);
}

function StatusBadge({ status }: { status: number }) {
  const is2xx = status >= 200 && status < 300;
  const is4xx = status >= 400 && status < 500;
  const is5xx = status >= 500;
  const isTimeout = status === 0;
  const cls = is2xx
    ? "bg-[#3fb950]/10 text-[#3fb950] border-[#3fb950]/25"
    : is4xx
      ? "bg-[#d29922]/10 text-[#d29922] border-[#d29922]/25"
      : is5xx
        ? "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/25"
        : "bg-[#2a2f36] text-[#6e7681] border-[#2a2f36]";
  return (
    <span className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}>
      {isTimeout ? "ERR" : status.toString()}
    </span>
  );
}

function FilterPill({ active, variant, onClick, children }: { active: boolean; variant: "all" | "ok" | "err"; onClick: () => void; children: React.ReactNode }) {
  const activeClass =
    variant === "ok"
      ? "bg-[#3fb950]/10 text-[#3fb950] border-[#3fb950]/35"
      : variant === "err"
        ? "bg-[#f85149]/10 text-[#f85149] border-[#f85149]/35"
        : "bg-[#2a2f36] text-[#e6edf3] border-[#444c56]";
  return (
    <button onClick={onClick} className={["px-3 py-1 rounded-full text-[11px] font-mono border transition-all", active ? activeClass : "bg-[#0f1115] text-[#6e7681] border-[#2a2f36] hover:text-[#9da7b3]"].join(" ")}>
      {children}
    </button>
  );
}

export function LogsTab({ logs, onClear }: LogsTabProps) {
  const [filter, setFilter] = useState<LogFilter>("all");

  const filtered = logs.filter(
    (l) => filter === "all" || (filter === "ok" && l.ok) || (filter === "err" && !l.ok),
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#f85149] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#f85149]" />
          </span>
          <span className="text-xs text-[#9da7b3]">Live feed</span>
          <span className="font-mono text-[10px] text-[#6e7681]">({logs.length} entries)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <FilterPill active={filter === "all"} variant="all" onClick={() => setFilter("all")}>All</FilterPill>
            <FilterPill active={filter === "ok"} variant="ok" onClick={() => setFilter("ok")}>Success</FilterPill>
            <FilterPill active={filter === "err"} variant="err" onClick={() => setFilter("err")}>Errors</FilterPill>
          </div>
          <button onClick={onClear} className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border border-[#2a2f36] text-[#6e7681] hover:text-[#f85149] hover:border-[#f85149]/50 transition-colors">
            <Trash2 className="w-2.5 h-2.5" /> Clear
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#6e7681]">
            <span className="text-2xl">○</span>
            <p className="text-xs font-mono">No log entries yet</p>
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              className={["flex items-start gap-3 bg-[#1c2128] border rounded-lg px-3 py-2.5 transition-colors hover:bg-[#21262d]", entry.ok ? "border-l-2 border-l-[#3fb950] border-[#2a2f36]" : "border-l-2 border-l-[#f85149] border-[#2a2f36]"].join(" ")}
            >
              <span className="font-mono text-[10px] text-[#6e7681] pt-0.5 flex-shrink-0">{formatTime(entry.ts)}</span>
              <StatusBadge status={entry.status} />
              <div className="flex-1 min-w-0">
                {entry.clientName && (
                  <p className="font-mono text-[10px] text-[#58a6ff] mb-0.5">{entry.clientName}</p>
                )}
                <p className="font-mono text-[11px] text-[#9da7b3] truncate">{entry.target}</p>
                <p className="text-[10px] text-[#6e7681] mt-0.5">{entry.detail}</p>
              </div>
              {entry.latencyMs > 0 && <span className="font-mono text-[10px] text-[#6e7681] pt-0.5 flex-shrink-0">{entry.latencyMs}ms</span>}
              <div className="pt-0.5 flex-shrink-0">
                {entry.ok ? <Check className="w-3 h-3 text-[#3fb950]" /> : <AlertTriangle className="w-3 h-3 text-[#f85149]" />}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
