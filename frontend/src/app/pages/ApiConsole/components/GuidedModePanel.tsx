/**
 * GuidedModePanel Component
 * 
 * Form-based request builder with collapsible sections for advanced options.
 * Provides template selection, scope filtering, destination/auth configuration,
 * and scheduling controls.
 */

import { useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type { GuidedModePanelProps, KV } from "../apiConsoleTypes";
import { createKV } from "../apiConsoleUtils";

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

export function GuidedModePanel({
  activeTemplate,
  setActiveTemplate,
  templates,
  scopeMode,
  setScopeMode,
  selectedSiteId,
  setSelectedSiteId,
  selectedCameraId,
  setSelectedCameraId,
  selectedZoneIds,
  setSelectedZoneIds,
  url,
  setUrl,
  authType,
  setAuthType,
  authValue,
  setAuthValue,
  templateOptions,
  setTemplateOptions,
  dispatchMode,
  setDispatchMode,
  scheduleMs,
  setScheduleMs,
  scheduleRunning,
  nextRunAt,
  onStartScheduler,
  onStopScheduler,
  onPreview,
  onSend,
  onExportConfig,
  onImportConfig,
  cameras,
  zones,
  siteOptions,
}: GuidedModePanelProps) {
  const [expandedSections, setExpandedSections] = useState({
    scheduling: false,
    advanced: false,
    siteRouting: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto">
      <div className="flex-1 p-4 space-y-4">
        {/* Section 1: Template Selection */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-[#9da7b3]">Template</Label>
          <Select value={activeTemplate || ""} onValueChange={setActiveTemplate}>
            <SelectTrigger className="bg-[#0f1115] border-[#2a2f36]">
              <SelectValue placeholder="Select a template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Section 2: Scope & Filtering */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-[#9da7b3]">Scope</Label>
          <Select value={scopeMode} onValueChange={setScopeMode}>
            <SelectTrigger className="bg-[#0f1115] border-[#2a2f36]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">Entire Project</SelectItem>
              <SelectItem value="all_cameras">All Cameras</SelectItem>
              <SelectItem value="by_site">By Site</SelectItem>
              <SelectItem value="by_camera">By Camera</SelectItem>
              <SelectItem value="selected_zones">Selected Zones</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Conditional fields based on scope */}
        {scopeMode === "by_site" && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-[#9da7b3]">Site</Label>
            <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
              <SelectTrigger className="bg-[#0f1115] border-[#2a2f36]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {siteOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id.toString()}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {scopeMode === "by_camera" && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-[#9da7b3]">Camera</Label>
            <Select value={selectedCameraId} onValueChange={setSelectedCameraId}>
              <SelectTrigger className="bg-[#0f1115] border-[#2a2f36]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cameras.map((c) => (
                  <SelectItem key={c.id} value={c.id.toString()}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {scopeMode === "selected_zones" && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-[#9da7b3]">Zones</Label>
            <div className="max-h-40 overflow-auto border border-[#2a2f36] rounded bg-[#0f1115] p-2 space-y-1">
              {zones.map((z) => (
                <label key={z.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedZoneIds.includes(z.id.toString())}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedZoneIds([...selectedZoneIds, z.id.toString()]);
                      } else {
                        setSelectedZoneIds(selectedZoneIds.filter((id) => id !== z.id.toString()));
                      }
                    }}
                    className="w-3.5 h-3.5 accent-emerald-500"
                  />
                  <span className="text-xs text-[#e6edf3]">{z.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Section 3: Destination & Auth */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-[#9da7b3]">Destination URL</Label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhook"
            className="bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold text-[#9da7b3]">Authentication</Label>
          <Select value={authType} onValueChange={setAuthType}>
            <SelectTrigger className="bg-[#0f1115] border-[#2a2f36]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="bearer">Bearer Token</SelectItem>
              <SelectItem value="apikey">API Key</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {authType !== "none" && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-[#9da7b3]">
              {authType === "bearer" ? "Token" : "API Key"}
            </Label>
            <Input
              type="password"
              value={authValue}
              onChange={(e) => setAuthValue(e.target.value)}
              placeholder={authType === "bearer" ? "Bearer token" : "API key"}
              className="bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono"
            />
          </div>
        )}

        {/* Section 4: Scheduling & Dispatch (Collapsible) */}
        <div className="border border-[#2a2f36] rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection("scheduling")}
            className="w-full px-4 py-3 flex items-center justify-between bg-[#161b22] hover:bg-[#1c2128] transition-colors"
          >
            <span className="text-sm font-medium text-[#e6edf3]">Scheduling & Dispatch</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${
                expandedSections.scheduling ? "rotate-180" : ""
              }`}
            />
          </button>
          {expandedSections.scheduling && (
            <div className="px-4 py-3 border-t border-[#2a2f36] space-y-3">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-[#9da7b3]">Interval</Label>
                <Select value={scheduleMs.toString()} onValueChange={(v) => setScheduleMs(parseInt(v))}>
                  <SelectTrigger className="bg-[#0f1115] border-[#2a2f36]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30000">30 seconds</SelectItem>
                    <SelectItem value="60000">1 minute</SelectItem>
                    <SelectItem value="300000">5 minutes</SelectItem>
                    <SelectItem value="900000">15 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs font-semibold text-[#9da7b3]">Dispatch Mode</Label>
                <Select value={dispatchMode} onValueChange={setDispatchMode}>
                  <SelectTrigger className="bg-[#0f1115] border-[#2a2f36]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single Destination</SelectItem>
                    <SelectItem value="site_routes">Site-based Routing</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {scheduleRunning ? (
                <Button
                  onClick={onStopScheduler}
                  variant="outline"
                  className="w-full text-red-400 border-red-400/30 hover:bg-red-500/10"
                >
                  Stop Scheduler
                </Button>
              ) : (
                <Button
                  onClick={onStartScheduler}
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                >
                  Start Scheduler
                </Button>
              )}

              {nextRunAt && (
                <p className="text-xs text-[#9da7b3]">
                  Next run: {new Date(nextRunAt).toLocaleTimeString()}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Section 5: Advanced Options (Collapsible) */}
        <div className="border border-[#2a2f36] rounded-lg overflow-hidden">
          <button
            onClick={() => toggleSection("advanced")}
            className="w-full px-4 py-3 flex items-center justify-between bg-[#161b22] hover:bg-[#1c2128] transition-colors"
          >
            <span className="text-sm font-medium text-[#e6edf3]">Advanced Options</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${
                expandedSections.advanced ? "rotate-180" : ""
              }`}
            />
          </button>
          {expandedSections.advanced && (
            <div className="px-4 py-3 border-t border-[#2a2f36] space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={templateOptions.includeSummary}
                  onChange={(e) =>
                    setTemplateOptions({
                      ...templateOptions,
                      includeSummary: e.target.checked,
                    })
                  }
                  className="w-3.5 h-3.5 accent-emerald-500"
                />
                <span className="text-xs text-[#e6edf3]">Include Summary</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={templateOptions.includeTimestamp}
                  onChange={(e) =>
                    setTemplateOptions({
                      ...templateOptions,
                      includeTimestamp: e.target.checked,
                    })
                  }
                  className="w-3.5 h-3.5 accent-emerald-500"
                />
                <span className="text-xs text-[#e6edf3]">Include Timestamp</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={templateOptions.onlyOnlineCameras}
                  onChange={(e) =>
                    setTemplateOptions({
                      ...templateOptions,
                      onlyOnlineCameras: e.target.checked,
                    })
                  }
                  className="w-3.5 h-3.5 accent-emerald-500"
                />
                <span className="text-xs text-[#e6edf3]">Only Online Cameras</span>
              </label>
            </div>
          )}
        </div>

        {/* Section 6: Actions */}
        <div className="space-y-2 pt-4 border-t border-[#2a2f36]">
          <Button
            onClick={onPreview}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            Preview Payload
          </Button>
          <Button
            onClick={onSend}
            variant="outline"
            className="w-full text-[#58a6ff] border-[#58a6ff]/30"
          >
            Send Now
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={onExportConfig}
              variant="outline"
              className="flex-1 text-xs text-[#9da7b3] border-[#2a2f36]"
            >
              Export
            </Button>
            <Button
              onClick={() => onImportConfig("")}
              variant="outline"
              className="flex-1 text-xs text-[#9da7b3] border-[#2a2f36]"
            >
              Import
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
