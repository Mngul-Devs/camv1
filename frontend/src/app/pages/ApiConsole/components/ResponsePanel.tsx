/**
 * ResponsePanel Component
 * 
 * Displays HTTP response with tabs for pretty, raw, and headers views.
 * Shows response metadata (status, timing, size).
 */

import { Clock, Copy, Send } from "lucide-react";
import { toast } from "sonner";
import type { ResponsePanelProps } from "../apiConsoleTypes";
import {
  statusBadgeClass,
  formatSize,
  formatTime,
  highlightJson,
  getPrettyResponseBody,
  isJsonResponse,
} from "../apiConsoleUtils";

export function ResponsePanel({
  response,
  resTab,
  setResTab,
  isSending,
  onCopyResponse,
}: ResponsePanelProps) {
  const prettyBody = getPrettyResponseBody(response);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Response tabs nav */}
      <div className="flex items-center justify-between border-b border-[#2a2f36] bg-[#161b22] px-1 shrink-0">
        <div className="flex items-center">
          {(["pretty", "raw", "headers"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setResTab(tab)}
              className={`px-4 py-2.5 text-xs font-medium transition-colors capitalize relative ${
                resTab === tab
                  ? "text-[#e6edf3]"
                  : "text-[#9da7b3] hover:text-[#c9d1d9]"
              }`}
            >
              {tab}
              {resTab === tab && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#58a6ff]" />
              )}
            </button>
          ))}
        </div>

        {response && (
          <div className="flex items-center gap-3 pr-3">
            <span
              className={`text-sm font-mono font-bold ${statusBadgeClass(
                response.status,
              )}`}
            >
              {response.status} {response.status_text}
            </span>
            <span className="flex items-center gap-1 text-xs text-[#9da7b3]">
              <Clock className="w-3 h-3" />
              {formatTime(response.ms)}
            </span>
            <span className="text-xs text-[#9da7b3]">{formatSize(response.size)}</span>
            <button
              onClick={() => {
                navigator.clipboard.writeText(prettyBody);
                toast.success("Response copied to clipboard");
              }}
              className="text-[#9da7b3] hover:text-white transition-colors"
              title="Copy response"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Response body */}
      <div className="flex-1 overflow-auto min-h-0 bg-[#0f1115]">
        {isSending ? (
          <div className="flex items-center justify-center h-full gap-2 text-sm text-[#9da7b3]">
            <div className="w-5 h-5 border-2 border-[#30363d] border-t-[#9da7b3] rounded-full animate-spin" />
            Waiting for response…
          </div>
        ) : !response ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Send className="w-10 h-10 text-[#2a2f36]" />
            <p className="text-sm text-[#9da7b3]">
              Hit{" "}
              <kbd className="px-1.5 py-0.5 bg-[#1c2128] border border-[#2a2f36] rounded text-xs font-mono">
                Send
              </kbd>{" "}
              to see the response
            </p>
            <p className="text-xs text-[#6e7681]">
              Ctrl+Enter from the URL bar for a quick send
            </p>
          </div>
        ) : resTab === "pretty" ? (
          <pre
            className="p-4 text-xs font-mono leading-relaxed text-[#e6edf3] whitespace-pre-wrap"
            dangerouslySetInnerHTML={{
              __html: isJsonResponse(response)
                ? highlightJson(prettyBody)
                : prettyBody
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;"),
            }}
          />
        ) : resTab === "raw" ? (
          <pre className="p-4 text-xs font-mono text-[#e6edf3] whitespace-pre-wrap leading-relaxed">
            {response.body}
          </pre>
        ) : (
          <div className="p-4 space-y-1">
            {Object.entries(response.headers).map(([k, v]) => (
              <div key={k} className="flex gap-3 text-xs font-mono">
                <span className="text-[#79c0ff] shrink-0 min-w-[160px]">{k}:</span>
                <span className="text-[#e6edf3] break-all">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
