/**
 * SiteRoutingConfig Modal Component
 * 
 * Modal for configuring per-site routing rules.
 * Allows users to map sites to destination presets.
 */

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type { SiteRouteRule, DestinationPreset, SiteOption } from "../apiConsoleTypes";

interface SiteRoutingConfigProps {
  isOpen: boolean;
  onClose: () => void;
  routes: SiteRouteRule[];
  onAddRoute: (rule: SiteRouteRule) => void;
  onDeleteRoute: (id: string) => void;
  sites: SiteOption[];
  presets: DestinationPreset[];
}

export function SiteRoutingConfig({
  isOpen,
  onClose,
  routes,
  onAddRoute,
  onDeleteRoute,
  sites,
  presets,
}: SiteRoutingConfigProps) {
  const [formData, setFormData] = useState({
    siteId: "",
    presetId: "",
  });

  const handleAdd = () => {
    if (formData.siteId && formData.presetId) {
      const preset = presets.find((p) => p.id === formData.presetId);
      if (preset) {
        onAddRoute({
          id: Date.now().toString(),
          siteId: parseInt(formData.siteId),
          presetId: formData.presetId,
          url: preset.url,
        });
        setFormData({ siteId: "", presetId: "" });
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#161b22] border border-[#2a2f36] rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2f36]">
          <h2 className="text-lg font-semibold text-[#e6edf3]">Site Routing Configuration</h2>
          <button
            onClick={onClose}
            className="text-[#9da7b3] hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Form */}
          <div className="border border-[#2a2f36] rounded-lg p-4 space-y-3 bg-[#0f1115]">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-[#9da7b3]">Site</Label>
              <Select value={formData.siteId} onValueChange={(v) => setFormData({ ...formData, siteId: v })}>
                <SelectTrigger className="bg-[#161b22] border-[#2a2f36]">
                  <SelectValue placeholder="Select a site" />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((s) => (
                    <SelectItem key={s.id} value={s.id.toString()}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-[#9da7b3]">Destination Preset</Label>
              <Select value={formData.presetId} onValueChange={(v) => setFormData({ ...formData, presetId: v })}>
                <SelectTrigger className="bg-[#161b22] border-[#2a2f36]">
                  <SelectValue placeholder="Select a preset" />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleAdd}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-xs"
            >
              <Plus className="w-3 h-3 mr-1" /> Add Route
            </Button>
          </div>

          {/* Routes List */}
          <div className="space-y-2">
            {routes.length === 0 ? (
              <p className="text-xs text-[#9da7b3] text-center py-4">No routes configured</p>
            ) : (
              routes.map((route) => {
                const site = sites.find((s) => s.id === route.siteId);
                const preset = presets.find((p) => p.id === route.presetId);
                return (
                  <div
                    key={route.id}
                    className="flex items-center justify-between p-3 bg-[#1c2128] border border-[#2a2f36] rounded"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[#e6edf3]">
                        {site?.name} → {preset?.name}
                      </p>
                      <p className="text-xs text-[#9da7b3] truncate">{route.url}</p>
                    </div>
                    <button
                      onClick={() => onDeleteRoute(route.id)}
                      className="text-[#6e7681] hover:text-red-400 transition-colors ml-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2a2f36] flex justify-end">
          <Button
            onClick={onClose}
            variant="outline"
            className="text-[#9da7b3] border-[#2a2f36]"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
