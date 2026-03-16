import { useState, useEffect, useRef } from "react";
import { Search, Pause, Play, Download, Trash2 } from "lucide-react";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ScrollArea } from "../components/ui/scroll-area";
import { toast } from "sonner";

interface LogEntry {
  id: string;
  timestamp: string;
  level: "INFO" | "WARN" | "ERROR" | "SUCCESS";
  source: string;
  message: string;
}

const initialLogs: LogEntry[] = [
  { id: "1", timestamp: "2026-03-09 14:23:45", level: "INFO", source: "FTP", message: "Snapshot received from CAM-0001 (Entrance Gate A)" },
  { id: "2", timestamp: "2026-03-09 14:23:46", level: "SUCCESS", source: "YOLO", message: "Detection completed: 12 vehicles detected in 156ms" },
  { id: "3", timestamp: "2026-03-09 14:23:47", level: "INFO", source: "API", message: "Pushed detection data to client endpoint: https://api.client.com/webhook" },
  { id: "4", timestamp: "2026-03-09 14:23:50", level: "WARN", source: "FTP", message: "Slow upload detected from CAM-0034 (2.3MB in 8s)" },
  { id: "5", timestamp: "2026-03-09 14:23:52", level: "INFO", source: "FTP", message: "Snapshot received from CAM-0002 (Parking Level 1 North)" },
  { id: "6", timestamp: "2026-03-09 14:23:55", level: "ERROR", source: "FTP", message: "Connection timeout for CAM-0034 after 30s" },
  { id: "7", timestamp: "2026-03-09 14:23:58", level: "SUCCESS", source: "YOLO", message: "Detection completed: 8 vehicles detected in 142ms" },
  { id: "8", timestamp: "2026-03-09 14:24:01", level: "INFO", source: "SYSTEM", message: "Disk usage: 247GB / 360GB (68%)" },
  { id: "9", timestamp: "2026-03-09 14:24:03", level: "WARN", source: "SYSTEM", message: "Queue backlog increasing: 23 pending snapshots" },
  { id: "10", timestamp: "2026-03-09 14:24:06", level: "INFO", source: "FTP", message: "Snapshot received from CAM-0035 (Mall Entrance West)" },
  { id: "11", timestamp: "2026-03-09 14:24:08", level: "SUCCESS", source: "YOLO", message: "Detection completed: 15 vehicles detected in 163ms" },
  { id: "12", timestamp: "2026-03-09 14:24:12", level: "ERROR", source: "API", message: "Failed to push data to client endpoint: Connection refused" },
  { id: "13", timestamp: "2026-03-09 14:24:15", level: "INFO", source: "API", message: "Retrying failed request (attempt 1/3)" },
  { id: "14", timestamp: "2026-03-09 14:24:18", level: "SUCCESS", source: "API", message: "Successfully pushed data on retry" },
];

const streamMessages = [
  { level: "INFO" as const, source: "FTP", message: "Snapshot received from CAM-0003 (Parking Level 1 South)" },
  { level: "SUCCESS" as const, source: "YOLO", message: "Detection completed: 9 vehicles detected in 148ms" },
  { level: "INFO" as const, source: "API", message: "Pushed detection data successfully" },
  { level: "INFO" as const, source: "FTP", message: "Snapshot received from CAM-0001 (Entrance Gate A)" },
  { level: "WARN" as const, source: "SYSTEM", message: "Memory usage at 72%" },
  { level: "SUCCESS" as const, source: "YOLO", message: "Detection completed: 11 vehicles detected in 134ms" },
  { level: "INFO" as const, source: "FTP", message: "Snapshot received from CAM-0035 (Mall Entrance West)" },
  { level: "ERROR" as const, source: "FTP", message: "Timeout waiting for CAM-0034 response" },
];

export function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [isPaused, setIsPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamIndex = useRef(0);

  // Simulate live log streaming
  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      const msg = streamMessages[streamIndex.current % streamMessages.length];
      const now = new Date();
      const timestamp = now.toISOString().replace('T', ' ').slice(0, 19);
      const newLog: LogEntry = {
        id: `stream-${Date.now()}`,
        timestamp,
        ...msg,
      };
      setLogs(prev => [...prev.slice(-100), newLog]); // Keep last 100 logs
      streamIndex.current++;
    }, 2500);

    return () => clearInterval(interval);
  }, [isPaused]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!isPaused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isPaused]);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         log.source.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLevel = levelFilter === "all" || log.level === levelFilter;
    return matchesSearch && matchesLevel;
  });

  const handleExport = () => {
    const content = filteredLogs.map(l => `[${l.timestamp}] ${l.level.padEnd(7)} ${l.source.padEnd(8)} ${l.message}`).join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Logs exported', { description: `${filteredLogs.length} entries exported` });
  };

  const handleClear = () => {
    setLogs([]);
    toast.info('Logs cleared');
  };

  const levelCounts = {
    INFO: logs.filter(l => l.level === "INFO").length,
    SUCCESS: logs.filter(l => l.level === "SUCCESS").length,
    WARN: logs.filter(l => l.level === "WARN").length,
    ERROR: logs.filter(l => l.level === "ERROR").length,
  };

  return (
    <div className="p-6 space-y-4 h-[calc(100vh-48px)] flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl text-[#e6edf3] mb-1">System Logs</h1>
          <p className="text-sm text-[#9da7b3]">
            Real-time system event monitoring
            {!isPaused && (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Streaming
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setIsPaused(!isPaused); toast.info(isPaused ? 'Resumed streaming' : 'Paused streaming'); }}
          className={`bg-[#1c2128] border-[#2a2f36] hover:bg-[#2a2f36] h-8 gap-1.5 ${
            isPaused ? 'text-yellow-400 border-yellow-500/30' : 'text-[#e6edf3]'
          }`}
        >
          {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          {isPaused ? "Resume" : "Pause"}
        </Button>

        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger className="w-28 bg-[#111113] border-[#2a2f36] text-[#e6edf3] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#161a1f] border-[#2a2f36]">
            <SelectItem value="all">All Levels</SelectItem>
            <SelectItem value="INFO">INFO ({levelCounts.INFO})</SelectItem>
            <SelectItem value="SUCCESS">SUCCESS ({levelCounts.SUCCESS})</SelectItem>
            <SelectItem value="WARN">WARN ({levelCounts.WARN})</SelectItem>
            <SelectItem value="ERROR">ERROR ({levelCounts.ERROR})</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex-1 max-w-sm relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9da7b3]" />
          <Input
            placeholder="Filter logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 bg-[#111113] border-[#2a2f36] text-[#e6edf3] placeholder:text-[#9da7b3] h-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5 ml-auto">
          <Button
            variant="outline" size="sm" onClick={handleClear}
            className="bg-[#1c2128] border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36] h-8 gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </Button>
          <Button
            variant="outline" size="sm" onClick={handleExport}
            className="bg-[#1c2128] border-[#2a2f36] text-[#e6edf3] hover:bg-[#2a2f36] h-8 gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Log Viewer */}
      <Card className="bg-[#0f1115] border-[#2a2f36] flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className="h-full overflow-auto font-mono text-xs"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600">
              {searchTerm || levelFilter !== 'all' ? 'No matching logs' : 'No logs yet'}
            </div>
          ) : (
            filteredLogs.map((log) => <LogLine key={log.id} log={log} />)
          )}
        </div>
      </Card>

      <div className="flex items-center justify-between text-xs text-[#9da7b3] shrink-0">
        <span>{filteredLogs.length} entries shown</span>
        <span>{logs.length} total entries</span>
      </div>
    </div>
  );
}

function LogLine({ log }: { log: LogEntry }) {
  const levelColors = {
    INFO: "text-[#9da7b3]",
    SUCCESS: "text-[#3fb950]",
    WARN: "text-[#d29922]",
    ERROR: "text-[#f85149]",
  };

  const levelBg = {
    INFO: "",
    SUCCESS: "",
    WARN: "bg-[#d29922]/5",
    ERROR: "bg-[#f85149]/5",
  };

  return (
    <div className={`flex gap-3 px-4 py-1.5 hover:bg-[#1c2128]/50 border-b border-[#1e2228]/50 ${levelBg[log.level]}`}>
      <span className="text-[#9da7b3] shrink-0 opacity-60">{log.timestamp}</span>
      <span className={`${levelColors[log.level]} w-16 shrink-0`}>
        {log.level}
      </span>
      <span className="text-[#58a6ff] w-16 shrink-0">{log.source}</span>
      <span className="text-[#e6edf3] flex-1">{log.message}</span>
    </div>
  );
}
