import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router";
import { Card } from "../components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Button } from "../components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { toast } from "sonner";
import { getAnalytics, ApiAnalytics } from "../../lib/api";

const tooltipStyle = {
  backgroundColor: '#161a1f',
  border: '1px solid #2a2f36',
  borderRadius: '8px',
  color: '#e6edf3',
  fontSize: '12px',
};

function fmtHour(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

export function MetricsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [period, setPeriod] = useState<'1h' | '24h' | '7d' | '30d'>("24h");
  const [data, setData] = useState<ApiAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async (showToast = false) => {
    try {
      const result = await getAnalytics(projectId ? Number(projectId) : undefined, period);
      setData(result);
      if (showToast) toast.success('Metrics refreshed');
    } catch (err) {
      toast.error('Failed to load metrics');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [projectId, period]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    load(true);
  };

  const snapshotTimeline = (data?.snapshot_timeline ?? []).map(p => ({
    ...p,
    time: fmtHour(p.time),
  }));
  const latencyTimeline = (data?.latency_timeline ?? []).map(p => ({
    ...p,
    time: fmtHour(p.time),
  }));
  const summary = data?.summary;
  const skipReasons = data?.skip_reasons ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">Snapshot Metrics</h1>
          <p className="text-sm text-[#9da7b3]">Real pipeline data — detection rates, latency, skip analysis</p>
        </div>
        <div className="flex gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="w-32 bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
              <SelectItem value="1h">Last Hour</SelectItem>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing || loading}
            className="bg-[#1c2128] border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36] h-8 gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Total Snapshots" value={loading ? '—' : String(summary?.total_snapshots ?? 0)} />
        <MetricCard label="Processed" value={loading ? '—' : String(summary?.processed ?? 0)} />
        <MetricCard label="Detection Rate" value={loading ? '—' : `${summary?.detection_rate_pct ?? 0}%`} positive />
        <MetricCard label="Avg Latency" value={loading ? '—' : summary?.avg_latency_ms ? `${summary.avg_latency_ms}ms` : 'N/A'} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Processed vs Skipped */}
        <Card className="bg-[#1c2128] border-[#2a2f36] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#e6edf3] text-sm">Processed vs Skipped</h3>
            <span className="text-[10px] text-gray-500">Per hour</span>
          </div>
          {loading ? <Skeleton /> : (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={snapshotTimeline}>
                  <defs>
                    <linearGradient id="procG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3fb950" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#3fb950" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="skipG" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#d29922" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#d29922" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e2228" />
                  <XAxis dataKey="time" stroke="#9da7b3" style={{ fontSize: '11px' }} />
                  <YAxis stroke="#9da7b3" style={{ fontSize: '11px' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="processed" stroke="#3fb950" fill="url(#procG)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="skipped" stroke="#d29922" fill="url(#skipG)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="flex gap-4 mt-2">
                <div className="flex items-center gap-1.5 text-[10px] text-[#9da7b3]"><div className="w-2 h-2 rounded-full bg-[#3fb950]" /> Processed</div>
                <div className="flex items-center gap-1.5 text-[10px] text-[#9da7b3]"><div className="w-2 h-2 rounded-full bg-[#d29922]" /> Skipped</div>
              </div>
            </>
          )}
        </Card>

        {/* Detection Latency */}
        <Card className="bg-[#1c2128] border-[#2a2f36] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#e6edf3] text-sm">Detection Latency</h3>
            <span className="text-[10px] text-gray-500">ms per hour avg</span>
          </div>
          {loading ? <Skeleton /> : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={latencyTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2228" />
                <XAxis dataKey="time" stroke="#9da7b3" style={{ fontSize: '11px' }} />
                <YAxis stroke="#9da7b3" style={{ fontSize: '11px' }} unit="ms" />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="avg_ms" stroke="#58a6ff" strokeWidth={2} dot={{ fill: '#58a6ff', r: 3 }} name="Avg Latency" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Skip Reason Breakdown */}
        <Card className="bg-[#1c2128] border-[#2a2f36] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#e6edf3] text-sm">Skip Reason Breakdown</h3>
            <span className="text-[10px] text-gray-500">Count in period</span>
          </div>
          {loading ? <Skeleton /> : skipReasons.length === 0 ? (
            <div className="flex items-center justify-center h-[220px] text-[#9da7b3] text-xs">No skip data in this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={skipReasons} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2228" horizontal={false} />
                <XAxis type="number" stroke="#9da7b3" style={{ fontSize: '11px' }} />
                <YAxis type="category" dataKey="reason" stroke="#9da7b3" style={{ fontSize: '10px' }} width={110} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#a371f7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Errors per hour */}
        <Card className="bg-[#1c2128] border-[#2a2f36] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#e6edf3] text-sm">Pipeline Errors</h3>
            <span className="text-[10px] text-gray-500">Per hour</span>
          </div>
          {loading ? <Skeleton /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={snapshotTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e2228" />
                <XAxis dataKey="time" stroke="#9da7b3" style={{ fontSize: '11px' }} />
                <YAxis stroke="#9da7b3" style={{ fontSize: '11px' }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="error" fill="#f85149" radius={[4, 4, 0, 0]} name="Errors" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

      </div>
    </div>
  );
}

function MetricCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <Card className="bg-[#1c2128] border-[#2a2f36] p-4">
      <div className="text-xs text-[#9da7b3] mb-1.5">{label}</div>
      <div className={`text-xl ${positive ? 'text-[#3fb950]' : 'text-[#e6edf3]'}`}>{value}</div>
    </Card>
  );
}

function Skeleton() {
  return <div className="h-[240px] bg-[#111113] rounded animate-pulse" />;
}
