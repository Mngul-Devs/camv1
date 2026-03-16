import { useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router";
import {
  LayoutDashboard,
  MapPin,
  Camera,
  Grid3X3,
  BarChart3,
  FileText,
  Send,
  Bell,
  Settings,
  Users,
  Server,
} from "lucide-react";
import { cn } from "../ui/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

export function MotherSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useParams<{ projectId: string }>();
  const base = `/app/project/${projectId}`;

  const navItems = [
    { icon: LayoutDashboard, label: "Dashboard", path: `${base}/dashboard`, badge: null },
    { icon: MapPin, label: "Sites", path: `${base}/sites`, badge: null },
    { icon: Camera, label: "Devices", path: `${base}/devices`, badge: null },
    { icon: Grid3X3, label: "Zones", path: `${base}/zones`, badge: null },
    { icon: BarChart3, label: "Metrics", path: `${base}/metrics`, badge: null },
    { icon: FileText, label: "Logs", path: `${base}/logs`, badge: null },
    { icon: Send, label: "Push Console", path: `${base}/push-console`, badge: null },
    { icon: Bell, label: "Alerts", path: `${base}/alerts`, badge: null },
    { icon: Users, label: "Users", path: `${base}/users`, badge: null },
    { icon: Settings, label: "Settings", path: `${base}/settings`, badge: null },
  ];

  return (
    <TooltipProvider delayDuration={0}>
      <div className="fixed left-0 top-12 bottom-0 z-40 w-14 bg-[#0c0e12] border-r border-[#1e2228] flex flex-col">
        <div className="flex flex-col gap-0.5 p-2 flex-1">
          {navItems.slice(0, -1).map((item) => {
            const Icon = item.icon;
            const isActive = item.path === "/app"
              ? location.pathname === "/app"
              : location.pathname.startsWith(item.path);

            return (
              <Tooltip key={item.path}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => navigate(item.path)}
                    className={cn(
                      "relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-150 group mx-auto",
                      isActive
                        ? "bg-[#1e2228] text-emerald-400"
                        : "text-gray-500 hover:bg-[#1e2228] hover:text-gray-300"
                    )}
                  >
                    {isActive && (
                      <div className="absolute left-[-9px] w-[3px] h-5 bg-emerald-400 rounded-r-full" />
                    )}
                    <Icon className="w-[18px] h-[18px]" />
                    {item.badge && (
                      <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-[9px] text-white flex items-center justify-center">
                        {item.badge}
                      </span>
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="right"
                  className="bg-[#1e2228] border-[#2a2f36] text-white text-xs"
                >
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* System Monitor — global, not project-scoped */}
        <div className="border-t border-[#1e2228] pt-1 mt-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate('/app/system')}
                className={cn(
                  "relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-150 mx-auto",
                  location.pathname === '/app/system'
                    ? "bg-[#1e2228] text-emerald-400"
                    : "text-gray-500 hover:bg-[#1e2228] hover:text-gray-300"
                )}
              >
                {location.pathname === '/app/system' && (
                  <div className="absolute left-[-9px] w-[3px] h-5 bg-emerald-400 rounded-r-full" />
                )}
                <Server className="w-[18px] h-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="bg-[#1e2228] border-[#2a2f36] text-white text-xs">
              System Monitor
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Settings at bottom */}
        <div className="p-2 border-t border-[#1e2228]">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate(`${base}/settings`)}
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-150 mx-auto",
                  location.pathname === `${base}/settings`
                    ? "bg-[#1e2228] text-emerald-400"
                    : "text-gray-500 hover:bg-[#1e2228] hover:text-gray-300"
                )}
              >
                <Settings className="w-[18px] h-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="bg-[#1e2228] border-[#2a2f36] text-white text-xs"
            >
              Settings
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}
