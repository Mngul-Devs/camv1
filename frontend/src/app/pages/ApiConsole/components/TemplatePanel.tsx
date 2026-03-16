/**
 * TemplatePanel Component
 * 
 * Left sidebar showing available templates with live data statistics.
 * Displays template cards with descriptions and tags.
 */

import { Badge } from "../../../components/ui/badge";
import type { TemplatePanelProps } from "../apiConsoleTypes";
import { countCamerasByStatus, countZonesByOccupancy } from "../apiConsoleUtils";

export function TemplatePanel({
  templates,
  activeTemplate,
  onSelectTemplate,
  cameras,
  zones,
}: TemplatePanelProps) {
  const cameraStats = countCamerasByStatus(cameras);
  const zoneStats = countZonesByOccupancy(zones);

  return (
    <div className="w-[245px] border-r border-[#2a2f36] flex flex-col shrink-0 bg-[#161b22]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#2a2f36]">
        <p className="text-[10px] text-[#9da7b3] uppercase tracking-widest">Templates</p>
      </div>

      {/* Template list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {templates.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelectTemplate(t.id)}
            className={`w-full text-left px-3 py-2.5 rounded transition-all border ${
              activeTemplate === t.id
                ? "bg-emerald-900/25 border-emerald-500/40"
                : "bg-transparent border-transparent hover:bg-[#1c2128] hover:border-[#2a2f36]"
            }`}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <Badge
                variant="outline"
                className={`text-[9px] px-1.5 py-0 font-mono shrink-0 ${t.tagColor}`}
              >
                {t.tag}
              </Badge>
              <span className="text-[11px] text-[#e6edf3] leading-tight truncate">
                {t.name}
              </span>
            </div>
            <p className="text-[10px] text-[#6e7681] leading-tight">{t.description}</p>
          </button>
        ))}
      </div>

      {/* Live data stats */}
      <div className="border-t border-[#2a2f36] px-3 py-3 space-y-1.5 shrink-0">
        <p className="text-[10px] text-[#9da7b3] uppercase tracking-widest mb-1">
          Live Data
        </p>
        {(
          [
            ["Cameras", cameras.length, "text-[#e6edf3]"],
            ["Zones", zones.length, "text-[#e6edf3]"],
            ["Online", cameraStats.online, "text-[#3fb950]"],
            [
              "Occupied",
              `${zoneStats.occupied}/${zoneStats.total}`,
              "text-[#d29922]",
            ],
          ] as [string, string | number, string][]
        ).map(([label, val, cls]) => (
          <div key={label} className="flex justify-between text-[11px]">
            <span className="text-[#6e7681]">{label}</span>
            <span className={cls}>{val}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
