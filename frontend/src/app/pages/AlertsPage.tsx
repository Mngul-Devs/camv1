import { useState } from "react";
import { AlertTriangle, Camera, HardDrive, Wifi, XCircle, CheckCircle, Bell, BellOff } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "sonner";

interface Alert {
  id: string;
  type: "camera" | "disk" | "network" | "api";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
}

const initialAlerts: Alert[] = [
  {
    id: "1", type: "camera", severity: "critical",
    title: "Camera CAM-0034 Offline",
    description: "Exit Gate B has been offline for 18 minutes. No snapshots received.",
    timestamp: "18 minutes ago", resolved: false,
  },
  {
    id: "2", type: "disk", severity: "warning",
    title: "High Disk Usage",
    description: "System disk usage at 68% (247GB / 360GB). Consider cleanup or expansion.",
    timestamp: "23 minutes ago", resolved: false,
  },
  {
    id: "3", type: "network", severity: "warning",
    title: "Slow FTP Upload Detected",
    description: "CAM-0034 upload speed degraded: 2.3MB in 8 seconds.",
    timestamp: "45 minutes ago", resolved: false,
  },
  {
    id: "4", type: "api", severity: "critical",
    title: "API Push Failed",
    description: "Failed to push detection data to Production Client endpoint after 3 retries.",
    timestamp: "1 hour ago", resolved: true, resolvedAt: "45 minutes ago",
  },
  {
    id: "5", type: "camera", severity: "warning",
    title: "Low Detection Rate",
    description: "CAM-0048 detection rate dropped to 62% (normal: 94%).",
    timestamp: "2 hours ago", resolved: false,
  },
];

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);

  const activeAlerts = alerts.filter((a) => !a.resolved);
  const resolvedAlerts = alerts.filter((a) => a.resolved);
  const criticalCount = activeAlerts.filter(a => a.severity === 'critical').length;
  const warningCount = activeAlerts.filter(a => a.severity === 'warning').length;

  const handleResolve = (id: string) => {
    setAlerts(prev =>
      prev.map(a =>
        a.id === id ? { ...a, resolved: true, resolvedAt: "Just now" } : a
      )
    );
    const alert = alerts.find(a => a.id === id);
    toast.success(`"${alert?.title}" resolved`);
  };

  const handleResolveAll = () => {
    setAlerts(prev => prev.map(a => ({ ...a, resolved: true, resolvedAt: "Just now" })));
    toast.success(`Resolved ${activeAlerts.length} alerts`);
  };

  const handleUnresolve = (id: string) => {
    setAlerts(prev =>
      prev.map(a =>
        a.id === id ? { ...a, resolved: false, resolvedAt: undefined } : a
      )
    );
    toast.info("Alert reopened");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">System Alerts</h1>
          <p className="text-sm text-[#9da7b3]">Monitor and manage system alerts and warnings</p>
        </div>
        {activeAlerts.length > 0 && (
          <Button
            onClick={handleResolveAll}
            variant="outline"
            size="sm"
            className="bg-[#1c2128] border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36] gap-2"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Resolve All
          </Button>
        )}
      </div>

      {/* Alert Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={AlertTriangle} label="Active Alerts" value={activeAlerts.length} color="text-[#d29922]" />
        <SummaryCard icon={XCircle} label="Critical" value={criticalCount} color="text-[#f85149]" />
        <SummaryCard icon={AlertTriangle} label="Warnings" value={warningCount} color="text-[#d29922]" />
        <SummaryCard icon={CheckCircle} label="Resolved" value={resolvedAlerts.length} color="text-[#3fb950]" />
      </div>

      {/* Alerts List */}
      <Tabs defaultValue="active" className="space-y-4">
        <TabsList className="bg-[#1c2128] border border-[#2a2f36] p-1">
          <TabsTrigger
            value="active"
            className="data-[state=active]:bg-[#2a2f36] data-[state=active]:text-[#e6edf3] text-[#9da7b3] gap-2"
          >
            <Bell className="w-3.5 h-3.5" />
            Active ({activeAlerts.length})
          </TabsTrigger>
          <TabsTrigger
            value="resolved"
            className="data-[state=active]:bg-[#2a2f36] data-[state=active]:text-[#e6edf3] text-[#9da7b3] gap-2"
          >
            <BellOff className="w-3.5 h-3.5" />
            Resolved ({resolvedAlerts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="space-y-2">
          {activeAlerts.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-5 h-5 text-emerald-400" />
              </div>
              <p className="text-gray-400 mb-1">All clear!</p>
              <p className="text-sm text-gray-600">No active alerts at this time</p>
            </div>
          ) : (
            activeAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onResolve={handleResolve} />
            ))
          )}
        </TabsContent>

        <TabsContent value="resolved" className="space-y-2">
          {resolvedAlerts.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <p>No resolved alerts</p>
            </div>
          ) : (
            resolvedAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onUnresolve={handleUnresolve} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number | string; color: string;
}) {
  return (
    <Card className="bg-[#1c2128] border-[#2a2f36] p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-[#161a1f] ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <div className="text-xl text-[#e6edf3]">{value}</div>
          <div className="text-xs text-[#9da7b3]">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function AlertCard({ alert, onResolve, onUnresolve }: {
  alert: Alert;
  onResolve?: (id: string) => void;
  onUnresolve?: (id: string) => void;
}) {
  const icons = { camera: Camera, disk: HardDrive, network: Wifi, api: XCircle };
  const severityColors = {
    critical: "border-l-[#f85149] bg-[#f85149]/5",
    warning: "border-l-[#d29922] bg-[#d29922]/5",
    info: "border-l-[#58a6ff] bg-[#58a6ff]/5",
  };
  const severityTextColors = {
    critical: "text-[#f85149]", warning: "text-[#d29922]", info: "text-[#58a6ff]",
  };

  const Icon = icons[alert.type];

  return (
    <Card className={`bg-[#1c2128] border-[#2a2f36] border-l-4 ${severityColors[alert.severity]} p-4 transition-all ${
      alert.resolved ? 'opacity-70' : ''
    }`}>
      <div className="flex items-start gap-4">
        <div className={`p-2 rounded-lg bg-[#161a1f] ${severityTextColors[alert.severity]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <div className="flex items-start justify-between mb-1.5">
            <h3 className="text-[#e6edf3] text-sm">{alert.title}</h3>
            {!alert.resolved && onResolve && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onResolve(alert.id)}
                className="bg-[#161a1f] border-[#2a2f36] text-[#e6edf3] hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400 text-xs h-7 gap-1.5 ml-4"
              >
                <CheckCircle className="w-3 h-3" />
                Resolve
              </Button>
            )}
            {alert.resolved && onUnresolve && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onUnresolve(alert.id)}
                className="text-xs text-gray-500 hover:text-white h-7"
              >
                Reopen
              </Button>
            )}
          </div>
          <p className="text-sm text-[#9da7b3] mb-2">{alert.description}</p>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] uppercase tracking-wider ${severityTextColors[alert.severity]}`}>
              {alert.severity}
            </span>
            <span className="text-xs text-[#9da7b3]">{alert.timestamp}</span>
            {alert.resolved && alert.resolvedAt && (
              <span className="text-xs text-[#3fb950] flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Resolved {alert.resolvedAt}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
