/**
 * DispatchStats Component
 * 
 * Displays run summary with statistics and visual feedback.
 * Shows total runs, success/failure counts, and per-target statistics.
 */

import { CheckCircle2, XCircle, Clock } from "lucide-react";
import type { DispatchRunStat } from "../apiConsoleTypes";
import { formatTimestamp } from "../apiConsoleUtils";

interface DispatchStatsProps {
  stats: DispatchRunStat[];
  isRunning: boolean;
}

export function DispatchStats({
  stats,
  isRunning,
}: DispatchStatsProps) {
  if (!stats || stats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
        <Clock className="w-10 h-10 text-[#2a2f36]" />
        <p className="text-sm text-[#9da7b3]">No dispatch runs yet</p>
      </div>
    );
  }

  const totalSuccess = stats.reduce((sum, s) => sum + s.success, 0);
  const totalFail = stats.reduce((sum, s) => sum + s.fail, 0);
  const totalRuns = totalSuccess + totalFail;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto">
      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-2 p-4 border-b border-[#2a2f36] shrink-0">
        <div className="bg-[#1c2128] border border-[#2a2f36] rounded p-3 text-center">
          <p className="text-xs text-[#9da7b3]">Total Runs</p>
          <p className="text-lg font-bold text-[#e6edf3]">{totalRuns}</p>
        </div>
        <div className="bg-[#1c2128] border border-[#2a2f36] rounded p-3 text-center">
          <p className="text-xs text-[#9da7b3]">Success</p>
          <p className="text-lg font-bold text-emerald-400">{totalSuccess}</p>
        </div>
        <div className="bg-[#1c2128] border border-[#2a2f36] rounded p-3 text-center">
          <p className="text-xs text-[#9da7b3]">Failed</p>
          <p className="text-lg font-bold text-red-400">{totalFail}</p>
        </div>
      </div>

      {/* Per-Target Stats */}
      <div className="flex-1 overflow-auto p-4 space-y-2">
        {stats.map((stat) => (
          <div
            key={stat.target}
            className="bg-[#1c2128] border border-[#2a2f36] rounded p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-[#e6edf3]">{stat.label}</p>
              <p className="text-xs text-[#9da7b3]">{stat.target}</p>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-[#0f1115] rounded overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{
                    width: `${
                      stat.success + stat.fail > 0
                        ? (stat.success / (stat.success + stat.fail)) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              <span className="text-xs text-emerald-400 font-medium">
                {stat.success}/{stat.success + stat.fail}
              </span>
            </div>

            {stat.lastStatus && (
              <div className="flex items-center gap-2 text-xs">
                {stat.lastStatus >= 200 && stat.lastStatus < 300 ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-400" />
                )}
                <span className="text-[#9da7b3]">
                  Last: {stat.lastStatus} at{" "}
                  {stat.lastRunAt ? formatTimestamp(stat.lastRunAt) : "—"}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {isRunning && (
        <div className="px-4 py-3 border-t border-[#2a2f36] bg-[#161b22] text-xs text-[#9da7b3] flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          Scheduler running...
        </div>
      )}
    </div>
  );
}
