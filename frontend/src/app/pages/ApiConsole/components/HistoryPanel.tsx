/**
 * HistoryPanel Component
 * 
 * Right sidebar showing request history with status indicators.
 * Allows quick access to previous requests.
 */

import { CheckCircle2, XCircle } from "lucide-react";
import type { HistoryPanelProps, HttpMethod } from "../apiConsoleTypes";
import { methodColorClass, statusBadgeClass, formatTime } from "../apiConsoleUtils";

export function HistoryPanel({
  history,
  onSelectEntry,
  onClearHistory,
}: HistoryPanelProps) {
  if (history.length === 0) return null;

  return (
    <div className="w-[200px] border-l border-[#2a2f36] bg-[#161b22] flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2f36]">
        <p className="text-[10px] text-[#9da7b3] uppercase tracking-widest">
          History
        </p>
        <button
          onClick={onClearHistory}
          className="text-[10px] text-[#6e7681] hover:text-red-400 transition-colors"
        >
          Clear
        </button>
      </div>

      {/* History list */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#2a2f36]">
        {history.map((h) => (
          <button
            key={h.id}
            onClick={() => onSelectEntry(h.url)}
            className="w-full text-left px-3 py-2 hover:bg-[#1c2128] transition-colors"
            title={h.url}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              {h.ok ? (
                <CheckCircle2 className="w-3 h-3 text-[#3fb950] flex-shrink-0" />
              ) : (
                <XCircle className="w-3 h-3 text-[#f85149] flex-shrink-0" />
              )}
              <span
                className={`text-[10px] font-mono font-bold ${methodColorClass(
                  h.method as HttpMethod,
                )}`}
              >
                {h.method}
              </span>
              <span
                className={`text-[10px] font-mono font-bold ml-auto ${statusBadgeClass(
                  h.status,
                )}`}
              >
                {h.status ?? "ERR"}
              </span>
            </div>
            <p className="text-[10px] text-[#9da7b3] truncate">{h.url}</p>
            <p className="text-[10px] text-[#6e7681]">{formatTime(h.ms)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
