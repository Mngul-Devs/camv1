/**
 * RequestEditor Component
 * 
 * Tabbed interface for editing request body, headers, params, and auth.
 * Includes JSON validation and formatting.
 */

import { Plus, Trash2 } from "lucide-react";
import { Label } from "../../../components/ui/label";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";
import type { RequestEditorProps, KV } from "../apiConsoleTypes";
import { createKV, validateJson } from "../apiConsoleUtils";

/**
 * KV Table Component - Reusable table for key-value pairs
 */
function KVTable({
  rows,
  onChange,
  placeholder = ["Key", "Value"],
}: {
  rows: KV[];
  onChange: (rows: KV[]) => void;
  placeholder?: [string, string];
}) {
  const update = (i: number, patch: Partial<KV>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, j) => j !== i));
  const add = () => onChange([...rows, createKV()]);

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(i, { enabled: e.target.checked })}
            className="w-3.5 h-3.5 accent-emerald-500 flex-shrink-0 cursor-pointer"
          />
          <input
            value={r.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={placeholder[0]}
            className="flex-1 h-8 px-2 bg-[#0f1115] border border-[#2a2f36] rounded text-[#e6edf3] text-xs font-mono focus:border-[#58a6ff] focus:outline-none transition-colors"
          />
          <input
            value={r.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder={placeholder[1]}
            className="flex-1 h-8 px-2 bg-[#0f1115] border border-[#2a2f36] rounded text-[#e6edf3] text-xs font-mono focus:border-[#58a6ff] focus:outline-none transition-colors"
          />
          <button
            onClick={() => remove(i)}
            className="text-[#6e7681] hover:text-red-400 transition-colors flex-shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 text-xs text-[#58a6ff] hover:text-white transition-colors mt-1"
      >
        <Plus className="w-3 h-3" /> Add row
      </button>
    </div>
  );
}

export function RequestEditor({
  method,
  params,
  setParams,
  headers,
  setHeaders,
  authType,
  setAuthType,
  authValue,
  setAuthValue,
  bodyMode,
  setBodyMode,
  bodyText,
  setBodyText,
  jsonError,
  reqTab,
  setReqTab,
  onFormatBody,
}: RequestEditorProps) {
  const handleBodyChange = (v: string) => {
    setBodyText(v);
    if (bodyMode === "json" && v.trim()) {
      const error = validateJson(v);
      // Note: jsonError state is managed by parent component
    }
  };

  const activeHeaderCount = headers.filter((h) => h.enabled && h.key.trim()).length;

  return (
    <>
      {/* Request tabs nav */}
      <div className="flex items-center border-b border-[#2a2f36] bg-[#161b22] px-1 shrink-0">
        {(["body", "headers", "params", "auth"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setReqTab(tab)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors capitalize relative ${
              reqTab === tab
                ? "text-[#e6edf3]"
                : "text-[#9da7b3] hover:text-[#c9d1d9]"
            }`}
          >
            {tab}
            {tab === "body" && bodyMode !== "none" && bodyText.trim() && (
              <span className="ml-1.5 w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block align-middle" />
            )}
            {tab === "headers" && activeHeaderCount > 0 && (
              <span className="ml-1 text-[10px] text-[#58a6ff]">{activeHeaderCount}</span>
            )}
            {reqTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
            )}
          </button>
        ))}
      </div>

      {/* Request tab content */}
      <div className="flex flex-col min-h-0 border-b border-[#2a2f36]" style={{ height: "42%" }}>
        <div className="flex-1 p-3 overflow-auto min-h-0">
          {reqTab === "body" && (
            <div className="h-full flex flex-col gap-2">
              <div className="flex items-center gap-4 shrink-0">
                {(["json", "raw", "none"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={bodyMode === m}
                      onChange={() => setBodyMode(m)}
                      className="accent-emerald-500"
                    />
                    <span className="text-xs text-[#9da7b3]">
                      {m === "json" ? "JSON" : m === "raw" ? "Raw" : "None"}
                    </span>
                  </label>
                ))}
                {bodyMode === "json" && bodyText.trim() && (
                  <button
                    onClick={onFormatBody}
                    className="text-xs text-[#58a6ff] hover:text-white ml-auto transition-colors"
                  >
                    Beautify
                  </button>
                )}
              </div>

              {bodyMode !== "none" ? (
                <div className="flex-1 relative min-h-0">
                  <textarea
                    value={bodyText}
                    onChange={(e) => handleBodyChange(e.target.value)}
                    spellCheck={false}
                    placeholder={
                      bodyMode === "json"
                        ? '{\n  "key": "value"\n}'
                        : "Request body"
                    }
                    className="absolute inset-0 w-full h-full resize-none bg-[#0f1115] border border-[#2a2f36] rounded p-3 font-mono text-xs text-[#e6edf3] focus:outline-none focus:border-[#58a6ff] leading-relaxed placeholder:text-[#3a3f46] transition-colors"
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-[#6e7681]">
                  No body attached to this request.
                </div>
              )}

              {jsonError && (
                <p className="text-[11px] text-red-400 font-mono shrink-0">
                  ⚠ {jsonError}
                </p>
              )}
            </div>
          )}

          {reqTab === "headers" && (
            <KVTable
              rows={headers}
              onChange={setHeaders}
              placeholder={["Header name", "Value"]}
            />
          )}

          {reqTab === "params" && (
            <KVTable
              rows={params}
              onChange={setParams}
              placeholder={["Parameter", "Value"]}
            />
          )}

          {reqTab === "auth" && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                {(["none", "bearer", "apikey"] as const).map((a) => (
                  <label key={a} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      checked={authType === a}
                      onChange={() => setAuthType(a)}
                      className="accent-emerald-500"
                    />
                    <span className="text-xs text-[#9da7b3]">
                      {a === "none"
                        ? "None"
                        : a === "bearer"
                          ? "Bearer Token"
                          : "API Key"}
                    </span>
                  </label>
                ))}
              </div>
              {authType !== "none" && (
                <div>
                  <Label className="text-xs text-[#9da7b3] mb-1.5 block">
                    {authType === "bearer"
                      ? "Token - sent as Authorization: Bearer <token>"
                      : "Key - sent as X-API-Key: <key>"}
                  </Label>
                  <Input
                    type="password"
                    value={authValue}
                    onChange={(e) => setAuthValue(e.target.value)}
                    placeholder={
                      authType === "bearer" ? "eyJ..." : "campark_live_..."
                    }
                    className="font-mono text-sm h-9 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] max-w-md focus-visible:ring-[#58a6ff]"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
