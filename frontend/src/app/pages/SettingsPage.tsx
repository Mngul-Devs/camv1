import { useState, useEffect } from "react";
import { Save, RotateCcw, Info } from "lucide-react";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { toast } from "sonner";
import { getSystemSettings, saveSystemSettings } from "../../lib/api";

export function SettingsPage() {
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // ── Writable settings (stored in DB, editable via API) ────────────────────
  const [operatingStart, setOperatingStart] = useState("06:00");
  const [operatingEnd, setOperatingEnd] = useState("22:00");
  const [sceneDiffThreshold, setSceneDiffThreshold] = useState("6.0");

  useEffect(() => {
    getSystemSettings().then(s => {
      setOperatingStart(s.operating_hours_start ?? "06:00");
      setOperatingEnd(s.operating_hours_end ?? "22:00");
      setSceneDiffThreshold(String(s.scene_diff_threshold ?? 6.0));
    }).catch(() => { /* backend not reachable */ });
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveSystemSettings({
        operating_hours_start: operatingStart,
        operating_hours_end: operatingEnd,
        scene_diff_threshold: parseFloat(sceneDiffThreshold),
      });
      setHasChanges(false);
      toast.success('Settings saved successfully', { description: 'Detection configuration applied — no restart needed.' });
    } catch {
      toast.error('Failed to save settings', { description: 'Check that the backend is reachable' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setOperatingStart("06:00");
    setOperatingEnd("22:00");
    setSceneDiffThreshold("6.0");
    setHasChanges(false);
    toast.info('Settings reset to defaults');
  };

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">Settings</h1>
          <p className="text-sm text-[#9da7b3]">Configure detection parameters. Changes apply immediately.</p>
        </div>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="text-xs text-yellow-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              Unsaved changes
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="bg-[#1c2128] border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36] gap-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 disabled:opacity-50"
          >
            {isSaving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Detection Configuration — stored in DB, editable */}
      <Card className="bg-[#1c2128] border-[#2a2f36] p-6">
        <h3 className="text-[#e6edf3] text-sm mb-1">Detection Configuration</h3>
        <p className="text-xs text-[#9da7b3] mb-5">Persisted in the database. The worker re-reads these each cycle — no restart needed.</p>
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-[#9da7b3]">Operating Hours Start</Label>
              <Input
                type="time"
                value={operatingStart}
                onChange={(e) => { setOperatingStart(e.target.value); setHasChanges(true); }}
                className="bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] h-9"
              />
              <p className="text-xs text-[#9da7b3]">Worker ignores snapshots before this time</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-[#9da7b3]">Operating Hours End</Label>
              <Input
                type="time"
                value={operatingEnd}
                onChange={(e) => { setOperatingEnd(e.target.value); setHasChanges(true); }}
                className="bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] h-9"
              />
              <p className="text-xs text-[#9da7b3]">Worker ignores snapshots after this time</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-[#9da7b3]">Scene Diff Threshold</Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              value={sceneDiffThreshold}
              onChange={(e) => { setSceneDiffThreshold(e.target.value); setHasChanges(true); }}
              className="bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] h-9 max-w-[160px]"
            />
            <p className="text-xs text-[#9da7b3]">Mean pixel delta (0–255) required to trigger inference. Set ≤ 0 to disable.</p>
          </div>
        </div>
      </Card>

      {/* Environment Configuration — read-only reference */}
      <Card className="bg-[#1c2128] border-[#2a2f36] p-6">
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-[#e6edf3] text-sm">Environment Configuration</h3>
          <Info className="w-3.5 h-3.5 text-[#9da7b3]" />
        </div>
        <p className="text-xs text-[#9da7b3] mb-5">These settings are controlled via environment variables in docker-compose.yml. Changing them requires a container restart.</p>
        <div className="divide-y divide-[#2a2f36]">
          {[
            { label: "YOLO Enabled", key: "YOLO_ENABLED", desc: "Enable/disable YOLO vehicle detection" },
            { label: "YOLO Confidence", key: "YOLO_CONFIDENCE", desc: "Minimum confidence for detections (default 0.50)" },
            { label: "Zone Classifier Mode", key: "ZONECLS_MODE", desc: "placeholder (dev) or onnx (prod)" },
            { label: "Stale Seconds", key: "STALE_SECONDS", desc: "Time before camera is marked STALE (default 150)" },
            { label: "Offline Seconds", key: "OFFLINE_SECONDS", desc: "Time before camera is marked OFFLINE (default 300)" },
            { label: "Telegram Alerts", key: "TELEGRAM_BOT_TOKEN", desc: "Set bot token + chat ID to enable health alerts" },
            { label: "API Key Required", key: "REQUIRE_API_KEY", desc: "Require X-API-Key header for /api/v1/* routes" },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between py-3">
              <div>
                <span className="text-sm text-[#e6edf3]">{item.label}</span>
                <p className="text-xs text-[#9da7b3] mt-0.5">{item.desc}</p>
              </div>
              <code className="text-xs text-[#58a6ff] bg-[#0f1115] px-2 py-1 rounded">{item.key}</code>
            </div>
          ))}
        </div>
      </Card>

      {/* Sticky save bar */}
      {hasChanges && (
        <div className="fixed bottom-0 left-14 right-0 bg-[#0f1115]/95 backdrop-blur-sm border-t border-[#2a2f36] px-6 py-3 flex items-center justify-end gap-3 z-30">
          <span className="text-sm text-gray-400 mr-auto">You have unsaved changes</span>
          <Button variant="ghost" onClick={handleReset} className="text-gray-400 hover:text-white">
            Discard
          </Button>
          <Button onClick={handleSave} disabled={isSaving} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      )}
    </div>
  );
}
