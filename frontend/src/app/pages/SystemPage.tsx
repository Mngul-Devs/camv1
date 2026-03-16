import { useState, useEffect, useCallback } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { RefreshCw, Cpu, MemoryStick, HardDrive, Cloud } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import { toast } from "sonner";
import { getSystemMetrics, ApiSystemMetrics, ApiSystemMetricsSample } from "../../lib/api";

const tooltipStyle = {
  backgroundColor: '#161a1f',
  border: '1px solid #2a2f36',
  borderRadius: '8px',
  color: '#e6edf3',
  fontSize: '12px',
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

function GaugeCard({
  icon: Icon,
  label,
  pct,
  detail,
  color,
}: {
  icon: React.ElementType;
  label: string;
  pct: number | null;
  detail: string;
  color: string;
}) {
  const filled = pct ?? 0;
  const isWarn = filled >= 80;
  const barColor = isWarn ? '#f85149' : color;

  return (
    <Card className="bg-[#1c2128] border-[#2a2f36] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-[#9da7b3]" />
          <span className="text-sm text-[#e6edf3]">{label}</span>
        </div>
        <span className={`text-lg font-semibold ${isWarn ? 'text-[#f85149]' : 'text-[#e6edf3]'}`}>
          {pct !== null ? `${pct.toFixed(1)}%` : '—'}
        </span>
      </div>
      <div className="w-full h-2 bg-[#1e2228] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(filled, 100)}%`, backgroundColor: barColor }}
        />
      </div>
      <p className="text-[11px] text-[#9da7b3]">{detail}</p>
    </Card>
  );
}

function TrendChart({
  title,
  data,
  dataKeys,
  loading,
}: {
  title: string;
  data: { time: string; [k: string]: number | string }[];
  dataKeys: { key: string; color: string; label: string }[];
  loading: boolean;
}) {
  return (
    <Card className="bg-[#1c2128] border-[#2a2f36] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[#e6edf3] text-sm">{title}</h3>
        <span className="text-[10px] text-gray-500">24h trend (5-min samples)</span>
      </div>
      {loading ? (
        <div className="h-[200px] bg-[#111113] rounded animate-pulse" />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data}>
              <defs>
                {dataKeys.map(({ key, color }) => (
                  <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e2228" />
              <XAxis dataKey="time" stroke="#9da7b3" style={{ fontSize: '10px' }} tickCount={6} />
              <YAxis stroke="#9da7b3" style={{ fontSize: '10px' }} unit="%" domain={[0, 100]} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}%`]} />
              {dataKeys.map(({ key, color, label }) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  fill={`url(#grad-${key})`}
                  strokeWidth={1.5}
                  dot={false}
                  name={label}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2">
            {dataKeys.map(({ key, color, label }) => (
              <div key={key} className="flex items-center gap-1.5 text-[10px] text-[#9da7b3]">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                {label}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function SystemPage() {
  const [metrics, setMetrics] = useState<ApiSystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const load = useCallback(async (showToast = false) => {
    try {
      const result = await getSystemMetrics();
      setMetrics(result);
      if (showToast) toast.success('Metrics refreshed');
    } catch {
      toast.error('Failed to load system metrics');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    load(true);
  };

  const cur = metrics?.current ?? null;
  const trend = (metrics?.trend ?? []).map((s: ApiSystemMetricsSample) => ({
    time: fmtTime(s.ts),
    cpu_pct: s.cpu_pct,
    ram_pct: s.ram_pct,
    vm_disk_pct: s.vm_disk_pct,
    data_disk_pct: s.data_disk_pct ?? 0,
  }));

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">System Monitor</h1>
          <p className="text-sm text-[#9da7b3]">VM resource usage — refreshes every 30 seconds</p>
        </div>
        <Button
          variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing || loading}
          className="bg-[#1c2128] border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36] h-8 gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Gauge cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <GaugeCard
          icon={Cpu}
          label="CPU"
          pct={cur?.cpu_pct ?? null}
          detail={cur ? `${cur.cpu_pct.toFixed(1)}% utilisation` : 'No data yet'}
          color="#58a6ff"
        />
        <GaugeCard
          icon={MemoryStick}
          label="RAM"
          pct={cur?.ram_pct ?? null}
          detail={cur ? `${cur.ram_used_gb} GB / ${cur.ram_total_gb} GB` : 'No data yet'}
          color="#3fb950"
        />
        <GaugeCard
          icon={HardDrive}
          label="VM Disk (/)"
          pct={cur?.vm_disk_pct ?? null}
          detail={cur ? `${cur.vm_disk_free_gb} GB free of ${cur.vm_disk_total_gb} GB` : 'No data yet'}
          color="#a371f7"
        />
        <GaugeCard
          icon={HardDrive}
          label="Data Disk (/data)"
          pct={cur?.data_disk_pct ?? null}
          detail={
            cur?.data_disk_total_gb
              ? `${cur.data_disk_free_gb} GB free of ${cur.data_disk_total_gb} GB`
              : 'Mounted at /data (shared with root)'
          }
          color="#d29922"
        />
      </div>

      {/* GCS bucket + summary row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-[#1c2128] border-[#2a2f36] p-4 flex items-center gap-3">
          <Cloud className="w-5 h-5 text-[#9da7b3] shrink-0" />
          <div>
            <div className="text-xs text-[#9da7b3] mb-0.5">GCS Bucket</div>
            <div className="text-sm text-[#e6edf3]">
              {metrics === null && loading
                ? '—'
                : metrics?.gcs_bucket_gb !== null
                  ? `${metrics!.gcs_bucket_gb} GB`
                  : 'Not configured'}
            </div>
          </div>
        </Card>
        <Card className="bg-[#1c2128] border-[#2a2f36] p-4 flex items-center gap-3">
          <Cpu className="w-5 h-5 text-[#9da7b3] shrink-0" />
          <div>
            <div className="text-xs text-[#9da7b3] mb-0.5">Trend Samples</div>
            <div className="text-sm text-[#e6edf3]">
              {metrics ? `${metrics.trend.length} / 288 (5-min)` : '—'}
            </div>
          </div>
        </Card>
        <Card className="bg-[#1c2128] border-[#2a2f36] p-4 flex items-center gap-3">
          <MemoryStick className="w-5 h-5 text-[#9da7b3] shrink-0" />
          <div>
            <div className="text-xs text-[#9da7b3] mb-0.5">RAM Total</div>
            <div className="text-sm text-[#e6edf3]">
              {cur ? `${cur.ram_total_gb} GB` : '—'}
            </div>
          </div>
        </Card>
      </div>

      {/* Trend charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TrendChart
          title="CPU & RAM Trend"
          data={trend}
          dataKeys={[
            { key: 'cpu_pct', color: '#58a6ff', label: 'CPU %' },
            { key: 'ram_pct', color: '#3fb950', label: 'RAM %' },
          ]}
          loading={loading}
        />
        <TrendChart
          title="Disk Usage Trend"
          data={trend}
          dataKeys={[
            { key: 'vm_disk_pct', color: '#a371f7', label: 'VM Disk %' },
            { key: 'data_disk_pct', color: '#d29922', label: '/data Disk %' },
          ]}
          loading={loading}
        />
      </div>
    </div>
  );
}
