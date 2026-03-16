import { useState, useEffect, useId } from "react";
import { useNavigate } from "react-router";
import {
  Activity, HardDrive, Network, Zap,
  Camera, MapPin, ArrowUpRight, RefreshCw, Grid3X3
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { useOrganization } from "../contexts/OrganizationContext";
import {
  AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { toast } from "sonner";
import { SiteMap } from "../components/SiteMap";

const generateMetricsData = () => [
  { time: "00:00", snapshots: 45 + Math.floor(Math.random() * 10), processing: 42 + Math.floor(Math.random() * 8) },
  { time: "04:00", snapshots: 38 + Math.floor(Math.random() * 10), processing: 36 + Math.floor(Math.random() * 8) },
  { time: "08:00", snapshots: 120 + Math.floor(Math.random() * 20), processing: 115 + Math.floor(Math.random() * 15) },
  { time: "12:00", snapshots: 95 + Math.floor(Math.random() * 15), processing: 92 + Math.floor(Math.random() * 12) },
  { time: "16:00", snapshots: 85 + Math.floor(Math.random() * 12), processing: 83 + Math.floor(Math.random() * 10) },
  { time: "20:00", snapshots: 65 + Math.floor(Math.random() * 10), processing: 63 + Math.floor(Math.random() * 8) },
  { time: "Now", snapshots: 72 + Math.floor(Math.random() * 15), processing: 70 + Math.floor(Math.random() * 12) },
];

export function DashboardPage() {
  const navigate = useNavigate();
  const { selectedProject } = useOrganization();
  const [metricsData, setMetricsData] = useState(generateMetricsData());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [liveSnapshotRate, setLiveSnapshotRate] = useState(87);
  const chartId = useId();

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveSnapshotRate(prev => {
        const change = Math.floor(Math.random() * 5) - 2;
        return Math.max(70, Math.min(110, prev + change));
      });
    }, 3000);
    return () => clearInterval(interval);
    // setLiveSnapshotRate is a stable dispatcher — intentionally omitted
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await new Promise(r => setTimeout(r, 800));
    setMetricsData(generateMetricsData());
    setIsRefreshing(false);
    toast.success('Dashboard refreshed');
  };

  if (!selectedProject) return null;

  const sites = selectedProject.sites || [];
  const totalCameras = sites.reduce((s, site) => s + site.cameras, 0);
  const totalOnline = sites.reduce((s, site) => s + site.camerasOnline, 0);
  const totalStale = sites.reduce((s, site) => s + site.camerasStale, 0);
  const totalOffline = sites.reduce((s, site) => s + site.camerasOffline, 0);

  const quickStats = [
    { label: "Sites", value: String(selectedProject.sitesCount), icon: MapPin, color: "text-blue-400", bgColor: "bg-blue-500/10" },
    {
      label: "Cameras", value: `${totalCameras}`, icon: Camera, color: "text-emerald-400", bgColor: "bg-emerald-500/10",
      subtitle: `${totalOnline} online \u00b7 ${totalStale} stale \u00b7 ${totalOffline} offline`
    },
    {
      label: "Zones", value: String(selectedProject.zonesCount), icon: Grid3X3, color: "text-amber-400", bgColor: "bg-amber-500/10",
      subtitle: `${selectedProject.zonesFree} free \u00b7 ${selectedProject.zonesOccupied} occupied`
    },
    {
      label: "Events (24h)", value: String(selectedProject.eventsLast24h), icon: Zap, color: "text-purple-400", bgColor: "bg-purple-500/10",
      subtitle: `${Math.round(selectedProject.eventsLast24h / 24)} in last hour`
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">Dashboard</h1>
          <p className="text-sm text-[#9da7b3]">
            Overview of all sites, devices, and parking occupancy.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-1.5 text-xs text-gray-500">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="bg-[#1c2128] border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36] gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {quickStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="bg-[#1c2128] border-[#2a2f36] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                  <Icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <ArrowUpRight className="w-3 h-3 text-gray-600" />
              </div>
              <div className="text-2xl text-[#e6edf3] mb-0.5">{stat.value}</div>
              <div className="text-xs text-[#9da7b3]">{stat.label}</div>
              {stat.subtitle && (
                <div className="text-[10px] text-gray-600 mt-1">{stat.subtitle}</div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Map Section */}
      <Card className="bg-[#1c2128] border-[#2a2f36] overflow-hidden">
        <div className="h-[400px]">
          <SiteMap
            sites={sites}
            onViewInSites={(site) => navigate(`/app/project/${selectedProject!.id}/sites?site=${site.id}`)}
          />
        </div>
      </Card>

      {/* Fleet Health by Site */}
      <Card className="bg-[#1c2128] border-[#2a2f36]">
        <div className="p-4 border-b border-[#2a2f36] flex items-center justify-between">
          <h3 className="text-[#e6edf3] text-sm">Fleet Health by Site</h3>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>{totalCameras} cameras</span>
            <span>{totalOnline} online</span>
            <span>{totalStale} stale</span>
            <span>{totalOffline} offline</span>
            <button onClick={handleRefresh} className="p-1 hover:text-white transition-colors">
              <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="divide-y divide-[#2a2f36]">
          {sites.map((site) => {
            const healthPercent = site.cameras > 0 ? Math.round((site.camerasOnline / site.cameras) * 100) : 0;
            const healthColor = healthPercent >= 80 ? '#10b981' : healthPercent >= 50 ? '#f59e0b' : '#ef4444';
            return (
              <div
                key={site.id}
                className="p-4 flex items-center gap-4 hover:bg-[#161a1f] transition-colors cursor-pointer"
                onClick={() => navigate(`/app/project/${selectedProject!.id}/sites?site=${site.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-[#e6edf3]">{site.name}</span>
                    <span className="text-[10px] text-gray-600">{site.address}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-[#1e2228] rounded-full overflow-hidden max-w-48">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${healthPercent}%`, backgroundColor: healthColor }}
                      />
                    </div>
                    <span className="text-xs" style={{ color: healthColor }}>{healthPercent}%</span>
                  </div>
                </div>
                <div className="text-xs text-gray-500 shrink-0">
                  {site.camerasOnline}/{site.cameras} cameras
                </div>
              </div>
            );
          })}
          {sites.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              No sites configured for this project
            </div>
          )}
        </div>
      </Card>

      {/* Charts + Metrics Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Snapshot chart */}
        <Card className="bg-[#1c2128] border-[#2a2f36] p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#e6edf3] text-sm">Snapshot Processing Rate</h3>
            <span className="text-xs text-[#9da7b3]">Last 24 hours</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={metricsData}>
              <defs>
                <linearGradient id={`${chartId}-snapGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#58a6ff" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#58a6ff" stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`${chartId}-procGrad`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3fb950" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2228" />
              <XAxis dataKey="time" stroke="#9da7b3" style={{ fontSize: '11px' }} />
              <YAxis stroke="#9da7b3" style={{ fontSize: '11px' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#161a1f',
                  border: '1px solid #2a2f36',
                  borderRadius: '8px',
                  color: '#e6edf3',
                  fontSize: '12px',
                }}
              />
              <Area key="area-snapshots" type="monotone" dataKey="snapshots" stroke="#58a6ff" strokeWidth={2} fill={`url(#${chartId}-snapGrad)`} dot={false} />
              <Area key="area-processing" type="monotone" dataKey="processing" stroke="#3fb950" strokeWidth={2} fill={`url(#${chartId}-procGrad)`} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-3">
            <div className="flex items-center gap-2 text-xs text-[#9da7b3]">
              <div className="w-2 h-2 rounded-full bg-[#58a6ff]" />
              Snapshots
            </div>
            <div className="flex items-center gap-2 text-xs text-[#9da7b3]">
              <div className="w-2 h-2 rounded-full bg-[#3fb950]" />
              Processed
            </div>
          </div>
        </Card>

        {/* Key Metrics sidebar */}
        <div className="space-y-3">
          <MetricCard
            icon={Activity}
            label="Snapshot Rate"
            value={`${liveSnapshotRate}/min`}
            trend="+12%"
            trendPositive
            iconColor="text-[#3fb950]"
            live
          />
          <MetricCard
            icon={HardDrive}
            label="Disk Usage"
            value={`${selectedProject.diskUsedGB} GB`}
            subtitle="Project storage"
            iconColor="text-[#58a6ff]"
          />
          <MetricCard
            icon={Network}
            label="Network Ingestion"
            value="12.4 MB/s"
            trend="+5%"
            trendPositive
            iconColor="text-[#a371f7]"
          />
        </div>
      </div>

      {/* Recent Alerts */}
      <Card className="bg-[#1c2128] border-[#2a2f36]">
        <div className="p-4 border-b border-[#2a2f36] flex items-center justify-between">
          <h3 className="text-[#e6edf3] text-sm">Recent Alerts</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/app/alerts')}
            className="text-xs text-[#58a6ff] hover:text-[#58a6ff] hover:bg-[#58a6ff]/10"
          >
            View all
            <ArrowUpRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
        <div className="divide-y divide-[#2a2f36]">
          {[
            { severity: "warning" as const, message: "Camera CAM-0034 offline for 12 minutes", time: "8 minutes ago", source: "Downtown Zone A" },
            { severity: "warning" as const, message: "High disk usage: 68% capacity reached", time: "23 minutes ago", source: "System" },
            { severity: "error" as const, message: "FTP upload failed for Site B - Camera 7", time: "1 hour ago", source: "Shopping Mall" },
          ].map((alert) => (
            <AlertItem key={`${alert.source}-${alert.time}`} {...alert} />
          ))}
        </div>
      </Card>

    </div>
  );
}

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  subtitle?: string;
  trend?: string;
  trendPositive?: boolean;
  iconColor: string;
  live?: boolean;
}

function MetricCard({ icon: Icon, label, value, subtitle, trend, trendPositive, iconColor, live }: MetricCardProps) {
  return (
    <Card className="bg-[#1c2128] border-[#2a2f36] p-4">
      <div className="flex items-start justify-between mb-2">
        <div className={`p-2 rounded-lg bg-[#161a1f] ${iconColor}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex items-center gap-2">
          {live && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE
            </span>
          )}
          {trend && (
            <span className={`text-xs ${trendPositive ? 'text-[#3fb950]' : 'text-[#9da7b3]'}`}>
              {trend}
            </span>
          )}
        </div>
      </div>
      <div className="text-xl text-[#e6edf3] mb-0.5">{value}</div>
      <div className="text-xs text-[#9da7b3]">{subtitle || label}</div>
    </Card>
  );
}

function AlertItem({ severity, message, time, source }: { severity: "warning" | "error"; message: string; time: string; source: string }) {
  const colors = {
    warning: "bg-[#d29922]",
    error: "bg-[#f85149]",
  };

  return (
    <div className="p-4 flex items-start gap-3 hover:bg-[#161a1f] transition-colors cursor-pointer">
      <div className={`w-2 h-2 rounded-full mt-1.5 ${colors[severity]}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#e6edf3]">{message}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-[#9da7b3]">{time}</span>
          <span className="text-xs text-[#9da7b3]">{source}</span>
        </div>
      </div>
    </div>
  );
}