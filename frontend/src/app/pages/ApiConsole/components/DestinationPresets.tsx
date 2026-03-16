/**
 * DestinationPresets Modal Component
 * 
 * Modal for managing destination presets with CRUD operations.
 * Allows users to save, edit, and delete webhook destinations.
 */

import { useState } from "react";
import { Plus, Trash2, Edit2, X } from "lucide-react";
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
import type { DestinationPreset } from "../apiConsoleTypes";

interface DestinationPresetsProps {
  isOpen: boolean;
  onClose: () => void;
  presets: DestinationPreset[];
  onAddPreset: (preset: DestinationPreset) => void;
  onUpdatePreset: (preset: DestinationPreset) => void;
  onDeletePreset: (id: string) => void;
}

export function DestinationPresets({
  isOpen,
  onClose,
  presets,
  onAddPreset,
  onUpdatePreset,
  onDeletePreset,
}: DestinationPresetsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<DestinationPreset>>({
    name: "",
    url: "",
    authType: "none",
    authValue: "",
  });

  const handleAdd = () => {
    if (formData.name && formData.url) {
      onAddPreset({
        id: Date.now().toString(),
        name: formData.name,
        url: formData.url,
        authType: formData.authType || "none",
        authValue: formData.authValue || "",
      });
      setFormData({ name: "", url: "", authType: "none", authValue: "" });
    }
  };

  const handleUpdate = () => {
    if (editingId && formData.name && formData.url) {
      onUpdatePreset({
        id: editingId,
        name: formData.name,
        url: formData.url,
        authType: formData.authType || "none",
        authValue: formData.authValue || "",
      });
      setEditingId(null);
      setFormData({ name: "", url: "", authType: "none", authValue: "" });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#161b22] border border-[#2a2f36] rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2f36]">
          <h2 className="text-lg font-semibold text-[#e6edf3]">Destination Presets</h2>
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
              <Label className="text-xs font-semibold text-[#9da7b3]">Name</Label>
              <Input
                value={formData.name || ""}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Production Webhook"
                className="bg-[#161b22] border-[#2a2f36] text-[#e6edf3] text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-[#9da7b3]">URL</Label>
              <Input
                value={formData.url || ""}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://example.com/webhook"
                className="bg-[#161b22] border-[#2a2f36] text-[#e6edf3] text-xs font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-[#9da7b3]">Authentication</Label>
              <Select
                value={formData.authType || "none"}
                onValueChange={(v) => setFormData({ ...formData, authType: v as any })}
              >
                <SelectTrigger className="bg-[#161b22] border-[#2a2f36]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="bearer">Bearer Token</SelectItem>
                  <SelectItem value="apikey">API Key</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.authType !== "none" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-[#9da7b3]">
                  {formData.authType === "bearer" ? "Token" : "API Key"}
                </Label>
                <Input
                  type="password"
                  value={formData.authValue || ""}
                  onChange={(e) => setFormData({ ...formData, authValue: e.target.value })}
                  placeholder={formData.authType === "bearer" ? "Bearer token" : "API key"}
                  className="bg-[#161b22] border-[#2a2f36] text-[#e6edf3] text-xs font-mono"
                />
              </div>
            )}

            <div className="flex gap-2 pt-2">
              {editingId ? (
                <>
                  <Button
                    onClick={handleUpdate}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs"
                  >
                    Update Preset
                  </Button>
                  <Button
                    onClick={() => {
                      setEditingId(null);
                      setFormData({ name: "", url: "", authType: "none", authValue: "" });
                    }}
                    variant="outline"
                    className="flex-1 text-xs text-[#9da7b3] border-[#2a2f36]"
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  onClick={handleAdd}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add Preset
                </Button>
              )}
            </div>
          </div>

          {/* Presets List */}
          <div className="space-y-2">
            {presets.length === 0 ? (
              <p className="text-xs text-[#9da7b3] text-center py-4">No presets yet</p>
            ) : (
              presets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between p-3 bg-[#1c2128] border border-[#2a2f36] rounded"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#e6edf3]">{preset.name}</p>
                    <p className="text-xs text-[#9da7b3] truncate">{preset.url}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => {
                        setEditingId(preset.id);
                        setFormData(preset);
                      }}
                      className="text-[#58a6ff] hover:text-white transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onDeletePreset(preset.id)}
                      className="text-[#6e7681] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
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
