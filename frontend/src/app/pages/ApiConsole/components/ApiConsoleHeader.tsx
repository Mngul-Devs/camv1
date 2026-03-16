/**
 * ApiConsoleHeader Component
 * 
 * Top bar with URL input, method selector, send button, and mode toggle.
 * Provides quick access to essential controls.
 */

import { Send, Copy, RefreshCw, Layers, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { toast } from "sonner";
import type { ApiConsoleHeaderProps, HttpMethod } from "../apiConsoleTypes";
import { methodColorClass, generateCurl, buildResolvedUrl } from "../apiConsoleUtils";

const HTTP_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export function ApiConsoleHeader({
  method,
  setMethod,
  url,
  setUrl,
  onSend,
  onRefresh,
  isSending,
  loadingData,
  mode,
  setMode,
  showTemplates,
  setShowTemplates,
}: ApiConsoleHeaderProps) {
  const urlRef = useRef<HTMLInputElement>(null);

  const handleUrlKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      onSend();
    }
  };

  const handleCopyCurl = () => {
    const config = {
      method,
      url,
      params: [],
      headers: [],
      authType: "none" as const,
      authValue: "",
      bodyMode: "none" as const,
      bodyText: "",
    };
    const resolvedUrl = buildResolvedUrl(url, []);
    const curl = generateCurl(config, resolvedUrl);
    navigator.clipboard.writeText(curl);
    toast.success("cURL command copied to clipboard");
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[#2a2f36] bg-[#161b22] shrink-0">
      {/* Templates toggle */}
      <button
        onClick={() => setShowTemplates(!showTemplates)}
        title="Toggle template panel"
        className={`p-1.5 rounded transition-colors ${
          showTemplates
            ? "text-emerald-400 bg-emerald-500/10"
            : "text-[#9da7b3] hover:text-white"
        }`}
      >
        <Layers className="w-4 h-4" />
      </button>

      {/* Mode toggle */}
      <div className="flex items-center border border-[#2a2f36] rounded-md overflow-hidden">
        <button
          onClick={() => setMode("guided")}
          className={`px-2.5 h-8 text-xs font-medium transition-colors ${
            mode === "guided"
              ? "bg-emerald-700/40 text-emerald-300"
              : "bg-transparent text-[#9da7b3] hover:text-white"
          }`}
        >
          Guided
        </button>
        <button
          onClick={() => setMode("advanced")}
          className={`px-2.5 h-8 text-xs font-medium transition-colors ${
            mode === "advanced"
              ? "bg-[#2a2f36] text-white"
              : "bg-transparent text-[#9da7b3] hover:text-white"
          }`}
        >
          Advanced
        </button>
      </div>

      {/* Method selector */}
      <Select value={method} onValueChange={(v) => setMethod(v as HttpMethod)}>
        <SelectTrigger
          className={`w-[108px] h-9 bg-[#1c2128] border-[#2a2f36] font-mono font-bold text-sm shrink-0 ${methodColorClass(method)}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-[#161b22] border-[#2a2f36]">
          {HTTP_METHODS.map((m) => (
            <SelectItem
              key={m}
              value={m}
              className={`font-mono font-bold ${methodColorClass(m)} focus:bg-[#2a2f36] focus:text-white`}
            >
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* URL input */}
      <div className="flex-1 relative">
        <Input
          ref={urlRef}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleUrlKeyDown}
          placeholder="https://client.example.com/webhook  or  /api/v1/status"
          className="font-mono text-sm h-9 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] pr-8 focus-visible:ring-[#58a6ff] focus-visible:ring-1 focus-visible:ring-offset-0"
        />
        {url.length > 4 && (
          <button
            onClick={() => {
              setUrl("");
              urlRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6e7681] hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Copy as cURL */}
      <button
        onClick={handleCopyCurl}
        title="Copy as cURL"
        className="p-2 text-[#9da7b3] hover:text-white transition-colors"
      >
        <Copy className="w-4 h-4" />
      </button>

      {/* Send button */}
      <Button
        onClick={onSend}
        disabled={isSending}
        className="h-9 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm gap-2 shrink-0"
      >
        {isSending ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Sending
          </>
        ) : (
          <>
            <Send className="w-4 h-4" />
            Send
          </>
        )}
      </Button>

      {/* Refresh data */}
      <button
        onClick={onRefresh}
        disabled={loadingData}
        title="Refresh live data for templates"
        className="p-2 text-[#9da7b3] hover:text-white transition-colors disabled:opacity-50"
      >
        <RefreshCw className={`w-4 h-4 ${loadingData ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
