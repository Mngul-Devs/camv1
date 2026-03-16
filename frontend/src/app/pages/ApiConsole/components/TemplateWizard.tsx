/**
 * TemplateWizard Component
 * 
 * Template guidance and preview panel.
 * Displays template information, purpose, recommended interval, and tips.
 */

import type { Template } from "../apiConsoleTypes";

const TEMPLATE_INFO: Record<string, { purpose: string; recommendedInterval: string; hints: string[] }> = {
  zone_occupancy: {
    purpose: "Monitor zone occupancy changes in real-time",
    recommendedInterval: "30 seconds",
    hints: [
      "Useful for occupancy-based automation",
      "Includes zone IDs and occupancy counts",
      "Can filter by online cameras only",
    ],
  },
  detection_result: {
    purpose: "Receive detection events (person, vehicle, etc.)",
    recommendedInterval: "Real-time (as events occur)",
    hints: [
      "Triggered by detection events",
      "Includes detection type and confidence",
      "Can include snapshot data",
    ],
  },
  site_summary: {
    purpose: "Get periodic summary of all cameras and zones",
    recommendedInterval: "5-15 minutes",
    hints: [
      "Includes camera status and zone occupancy",
      "Good for periodic health checks",
      "Can include summary statistics",
    ],
  },
  heartbeat: {
    purpose: "Simple keep-alive signal",
    recommendedInterval: "1-5 minutes",
    hints: [
      "Minimal payload for connectivity checks",
      "Useful for monitoring webhook health",
      "Can include timestamp only",
    ],
  },
  get_status: {
    purpose: "Query current system status",
    recommendedInterval: "On-demand",
    hints: [
      "Returns current camera and zone status",
      "No scheduling needed",
      "Useful for manual checks",
    ],
  },
  get_cameras: {
    purpose: "Retrieve list of all cameras",
    recommendedInterval: "On-demand",
    hints: [
      "Returns camera configuration",
      "No scheduling needed",
      "Useful for system discovery",
    ],
  },
};

interface TemplateWizardProps {
  activeTemplate: string | null;
  templates: Template[];
}

export function TemplateWizard({
  activeTemplate,
  templates,
}: TemplateWizardProps) {
  if (!activeTemplate) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-4">
        <p className="text-sm text-[#9da7b3]">Select a template to see guidance</p>
      </div>
    );
  }

  const template = templates.find((t) => t.id === activeTemplate);
  const info = TEMPLATE_INFO[activeTemplate];

  if (!template || !info) {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto p-4 space-y-4">
      {/* Template Name & Tag */}
      <div>
        <h3 className="text-sm font-semibold text-[#e6edf3]">{template.name}</h3>
        <span
          className="inline-block mt-1 px-2 py-1 rounded text-xs font-medium"
          style={{ color: template.tagColor }}
        >
          {template.tag}
        </span>
      </div>

      {/* Description */}
      <div>
        <p className="text-xs text-[#9da7b3]">{template.description}</p>
      </div>

      {/* Purpose */}
      <div className="border-t border-[#2a2f36] pt-3">
        <p className="text-xs font-semibold text-[#e6edf3] mb-1">Purpose</p>
        <p className="text-xs text-[#9da7b3]">{info.purpose}</p>
      </div>

      {/* Recommended Interval */}
      <div className="border-t border-[#2a2f36] pt-3">
        <p className="text-xs font-semibold text-[#e6edf3] mb-1">Recommended Interval</p>
        <p className="text-xs text-[#9da7b3]">{info.recommendedInterval}</p>
      </div>

      {/* Hints */}
      <div className="border-t border-[#2a2f36] pt-3">
        <p className="text-xs font-semibold text-[#e6edf3] mb-2">Tips</p>
        <ul className="space-y-1">
          {info.hints.map((hint, i) => (
            <li key={i} className="text-xs text-[#9da7b3] flex gap-2">
              <span className="text-[#58a6ff]">•</span>
              <span>{hint}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Method & Payload Info */}
      <div className="border-t border-[#2a2f36] pt-3">
        <p className="text-xs font-semibold text-[#e6edf3] mb-1">HTTP Method</p>
        <p className="text-xs font-mono text-[#a5d6ff]">{template.method}</p>
      </div>
    </div>
  );
}
