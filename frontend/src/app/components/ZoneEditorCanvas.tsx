/**
 * ZoneEditorCanvas — native React canvas zone editor.
 * Full port of the Konva-based zone_editor.html Flask template.
 * No iframe — zero CSS bleed, works fully offline with the local API.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { getZoneEditorRaw, bulkSaveZones, deleteAllZones } from '../../lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────
type Pt = { x: number; y: number };

interface LaneArea {
  uuid: string;
  pts: Pt[][];   // [rows+1][cols+1] normalized 0..1
  quad: Pt[];    // [TL, TR, BR, BL] normalized — for unsplit rendering
  prefix: string;
  start: number;
  cols: number;  // 0 = unsplit
  rows: number;
  dir: 'inc' | 'dec';
  gapPct: number;
  ci: number;
}

type Mode = 'idle' | 'draw' | 'edit';

// ── Palette ───────────────────────────────────────────────────────────────────
const PAL = [
  { fill: 'rgba(59,130,246,0.18)',  stroke: '#3b82f6' },
  { fill: 'rgba(34,197,94,0.18)',   stroke: '#22c55e' },
  { fill: 'rgba(234,179,8,0.18)',   stroke: '#eab308' },
  { fill: 'rgba(168,85,247,0.18)',  stroke: '#a855f7' },
  { fill: 'rgba(236,72,153,0.18)',  stroke: '#ec4899' },
  { fill: 'rgba(249,115,22,0.18)',  stroke: '#f97316' },
  { fill: 'rgba(20,184,166,0.18)',  stroke: '#14b8a6' },
  { fill: 'rgba(239,68,68,0.18)',   stroke: '#ef4444' },
];

// ── Geometry helpers ──────────────────────────────────────────────────────────
function ptDist(a: Pt, b: Pt) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function clampNorm(p: Pt): Pt { return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }; }
function centroidOf(pts: Pt[]): Pt {
  return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
}

function orderQuad(pts: Pt[]): Pt[] {
  const c = centroidOf(pts);
  const s = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  let mi = 0, mv = s[0].x + s[0].y;
  for (let i = 1; i < 4; i++) { const v = s[i].x + s[i].y; if (v < mv) { mv = v; mi = i; } }
  let o: Pt[] = [];
  for (let i = 0; i < 4; i++) o.push(s[(mi + i) % 4]);
  const ax = o[1].x - o[0].x, ay = o[1].y - o[0].y, bx = o[2].x - o[1].x, by = o[2].y - o[1].y;
  if ((ax * by - ay * bx) < 0) o.reverse();
  let mi2 = 0, mv2 = o[0].x + o[0].y;
  for (let i = 1; i < 4; i++) { const v = o[i].x + o[i].y; if (v < mv2) { mv2 = v; mi2 = i; } }
  const r: Pt[] = [];
  for (let i = 0; i < 4; i++) r.push(o[(mi2 + i) % 4]);
  return r;
}

function buildGrid(quad: Pt[], cols: number, rows: number): Pt[][] {
  const [TL, TR, BR, BL] = quad;
  const grid: Pt[][] = [];
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    const row: Pt[] = [];
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      row.push({
        x: TL.x * (1 - u) * (1 - v) + TR.x * u * (1 - v) + BR.x * u * v + BL.x * (1 - u) * v,
        y: TL.y * (1 - u) * (1 - v) + TR.y * u * (1 - v) + BR.y * u * v + BL.y * (1 - u) * v,
      });
    }
    grid.push(row);
  }
  return grid;
}

function nextStartFor(lanes: LaneArea[], prefix: string): number {
  let max = 0;
  lanes.forEach(la => {
    if (la.prefix === prefix && la.cols > 0 && la.rows > 0)
      max = Math.max(max, la.start + la.cols * la.rows - 1);
  });
  return max + 1;
}

function makeLabels(la: LaneArea): string[] {
  const total = la.cols * la.rows;
  const arr: string[] = [];
  for (let i = 0; i < total; i++) {
    const n = la.dir === 'dec' ? la.start + total - 1 - i : la.start + i;
    arr.push(la.prefix + String(n).padStart(2, '0'));
  }
  return arr;
}

function mkUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── Canvas drawing ────────────────────────────────────────────────────────────
const DOT_R = 7, HIT_DOT = 14, HIT_CORNER = 18, DRAG_GAIN = 0.45;

function toScreen(p: Pt, sw: number, sh: number): Pt { return { x: p.x * sw, y: p.y * sh }; }
function toNorm(sx: number, sy: number, sw: number, sh: number): Pt { return { x: sx / sw, y: sy / sh }; }
function dotScreen(la: LaneArea, r: number, c: number, sw: number, sh: number): Pt { return toScreen(la.pts[r][c], sw, sh); }
function cellCornersNorm(la: LaneArea, r: number, c: number): Pt[] {
  return [la.pts[r][c], la.pts[r][c + 1], la.pts[r + 1][c + 1], la.pts[r + 1][c]];
}
function isOuter(la: LaneArea, r: number, c: number): boolean {
  return r === 0 || r === la.rows || c === 0 || c === la.cols;
}

function hitTestDot(
  pos: Pt, lanes: LaneArea[], sw: number, sh: number
): { laneId: string; row: number; col: number } | null {
  for (const la of [...lanes].reverse()) {
    if (!la.pts || la.cols < 1) continue;
    for (let r = 0; r <= la.rows; r++) {
      for (let c = 0; c <= la.cols; c++) {
        const sp = dotScreen(la, r, c, sw, sh);
        const radius = isOuter(la, r, c) ? HIT_CORNER : HIT_DOT;
        if (ptDist(pos, sp) < radius) return { laneId: la.uuid, row: r, col: c };
      }
    }
  }
  return null;
}

function renderCanvas(
  ctx: CanvasRenderingContext2D,
  sw: number, sh: number,
  bg: HTMLImageElement | null,
  lanes: LaneArea[],
  mode: Mode,
  drawPts: Pt[],
  selectedId: string | null,
  activeDot: { laneId: string; row: number; col: number } | null,
) {
  ctx.clearRect(0, 0, sw, sh);
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, sw, sh);

  if (bg) {
    ctx.drawImage(bg, 0, 0, sw, sh);
  } else {
    ctx.fillStyle = '#4b5563';
    ctx.font = '15px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No snapshot — upload via FTP first', sw / 2, sh / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // Draw mode preview
  if (mode === 'draw' && drawPts.length > 0) {
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2;
    for (let i = 1; i < drawPts.length; i++) {
      ctx.beginPath();
      ctx.moveTo(drawPts[i - 1].x, drawPts[i - 1].y);
      ctx.lineTo(drawPts[i].x, drawPts[i].y);
      ctx.stroke();
    }
    if (drawPts.length >= 3) {
      const last = drawPts[drawPts.length - 1], first = drawPts[0];
      ctx.strokeStyle = 'rgba(249,115,22,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(first.x, first.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    drawPts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = i === 0 ? '#f97316' : '#fff';
      ctx.fill();
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  // Draw lanes
  lanes.forEach(la => {
    const isSel = selectedId === la.uuid;
    const pal = PAL[la.ci % PAL.length];
    const hasSplit = la.cols > 0 && la.rows > 0;

    if (hasSplit) {
      const g = la.gapPct / 100;

      // Cell fills
      for (let r = 0; r < la.rows; r++) {
        for (let c = 0; c < la.cols; c++) {
          const [TL, TR, BR, BL] = cellCornersNorm(la, r, c);
          const cx = (TL.x + TR.x + BR.x + BL.x) / 4;
          const cy = (TL.y + TR.y + BR.y + BL.y) / 4;
          const shrink = (pt: Pt) => ({ x: pt.x + (cx - pt.x) * g, y: pt.y + (cy - pt.y) * g });
          const corners = [TL, TR, BR, BL].map(shrink).map(p => toScreen(p, sw, sh));
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          for (let k = 1; k < corners.length; k++) ctx.lineTo(corners[k].x, corners[k].y);
          ctx.closePath();
          ctx.fillStyle = isSel ? pal.fill.replace('0.18', '0.28') : pal.fill;
          ctx.fill();
          ctx.strokeStyle = isSel ? '#fff' : pal.stroke;
          ctx.lineWidth = isSel ? 1.8 : 1.3;
          ctx.setLineDash([]);
          ctx.stroke();
        }
      }

      // Grid lines — horizontal
      for (let r = 0; r <= la.rows; r++) {
        for (let c = 0; c < la.cols; c++) {
          const a = dotScreen(la, r, c, sw, sh);
          const b = dotScreen(la, r, c + 1, sw, sh);
          const outer = r === 0 || r === la.rows;
          ctx.strokeStyle = isSel ? (outer ? '#fff' : 'rgba(255,255,255,0.6)') : pal.stroke;
          ctx.lineWidth = outer ? (isSel ? 2.2 : 1.8) : (isSel ? 1.4 : 1.0);
          ctx.setLineDash(outer ? [] : [4, 3]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      // Grid lines — vertical
      for (let c = 0; c <= la.cols; c++) {
        for (let r = 0; r < la.rows; r++) {
          const a = dotScreen(la, r, c, sw, sh);
          const b = dotScreen(la, r + 1, c, sw, sh);
          const outer = c === 0 || c === la.cols;
          ctx.strokeStyle = isSel ? (outer ? '#fff' : 'rgba(255,255,255,0.6)') : pal.stroke;
          ctx.lineWidth = outer ? (isSel ? 2.2 : 1.8) : (isSel ? 1.4 : 1.0);
          ctx.setLineDash(outer ? [] : [4, 3]);
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      // Anchor dots
      for (let r = 0; r <= la.rows; r++) {
        for (let c = 0; c <= la.cols; c++) {
          const sp = dotScreen(la, r, c, sw, sh);
          const isAct = activeDot && activeDot.laneId === la.uuid && activeDot.row === r && activeDot.col === c;
          const outer2 = isOuter(la, r, c);
          if (isAct) {
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, DOT_R + 6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(249,115,22,0.25)';
            ctx.fill();
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, isAct ? DOT_R + 2 : (outer2 ? DOT_R : DOT_R - 1), 0, Math.PI * 2);
          ctx.fillStyle = isAct ? '#f97316' : (outer2 ? '#fff' : 'rgba(255,255,255,0.75)');
          ctx.fill();
          ctx.strokeStyle = isAct ? '#fff' : pal.stroke;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Labels
      const lbls = makeLabels(la);
      let idx = 0;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < la.rows; r++) {
        for (let c = 0; c < la.cols; c++) {
          const corners = cellCornersNorm(la, r, c);
          const cp = toScreen({
            x: corners.reduce((s, p) => s + p.x, 0) / 4,
            y: corners.reduce((s, p) => s + p.y, 0) / 4,
          }, sw, sh);
          const fs = Math.max(9, Math.min(13, sw / 90));
          ctx.font = `bold ${fs}px -apple-system, system-ui, sans-serif`;
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 3;
          ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
          ctx.fillStyle = '#fff';
          ctx.fillText(lbls[idx++] || '', cp.x, cp.y);
          ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        }
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    } else {
      // Unsplit lane — dashed outline
      const qpx = la.quad.map(p => toScreen(p, sw, sh));
      ctx.beginPath();
      ctx.moveTo(qpx[0].x, qpx[0].y);
      for (let i = 1; i < qpx.length; i++) ctx.lineTo(qpx[i].x, qpx[i].y);
      ctx.closePath();
      ctx.fillStyle = isSel ? 'rgba(249,115,22,0.14)' : 'rgba(249,115,22,0.06)';
      ctx.fill();
      ctx.strokeStyle = isSel ? '#f97316' : 'rgba(249,115,22,0.45)';
      ctx.lineWidth = isSel ? 2 : 1.2;
      ctx.setLineDash([8, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      const cx2 = qpx.reduce((s, p) => s + p.x, 0) / 4;
      const cy2 = qpx.reduce((s, p) => s + p.y, 0) / 4;
      ctx.font = '11px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(249,115,22,0.85)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('[Set spaces & split]', cx2, cy2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  });
}

function buildSavePayload(lanes: LaneArea[]) {
  const payload: Array<{ zone_id: string; name: string; capacity_units: number; polygon_json: string }> = [];
  lanes.forEach(la => {
    if (la.cols < 1 || la.rows < 1) return;
    const lbls = makeLabels(la);
    let idx = 0;
    const meta = JSON.stringify({ pts: la.pts, cols: la.cols, rows: la.rows, start: la.start, dir: la.dir, gapPct: la.gapPct, prefix: la.prefix, ci: la.ci });
    for (let r = 0; r < la.rows; r++) {
      for (let c = 0; c < la.cols; c++) {
        const corners = cellCornersNorm(la, r, c);
        const pts4 = corners.map(p => [+(p.x * 100).toFixed(4), +(p.y * 100).toFixed(4)]);
        const lbl = lbls[idx++] || `Z${idx}`;
        payload.push({ zone_id: lbl, name: r === 0 && c === 0 ? '__campark_meta__' + meta : lbl, capacity_units: 1, polygon_json: JSON.stringify(pts4) });
      }
    }
  });
  return payload;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ZoneEditorCanvas({
  cameraId,
  cameras,
  onCameraChange,
  onClose,
}: {
  cameraId: string;
  cameras: Array<{ camera_id: string; name: string | null }>;
  onCameraChange: (id: string) => void;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLImageElement | null>(null);

  // Mutable drawing state (in refs to avoid stale closures in event handlers)
  const lanesRef = useRef<LaneArea[]>([]);
  const modeRef = useRef<Mode>('idle');
  const drawPtsRef = useRef<Pt[]>([]);
  const selectedIdRef = useRef<string | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const activeDotRef = useRef<{ laneId: string; row: number; col: number } | null>(null);
  const dragRef = useRef<{ laneId: string; row: number; col: number; origPt: Pt; sx: number; sy: number } | null>(null);
  const palIdxRef = useRef(0);
  const swRef = useRef(800);
  const shRef = useRef(450);

  // React state for sidebar rendering
  const [sw, setSw] = useState(800);
  const [sh, setSh] = useState(450);
  const [cols, setCols] = useState(5);
  const [rows, setRows] = useState(1);
  const [prefix, setPrefix] = useState('A');
  const [gapPct, setGapPct] = useState(2);
  const [direction, setDirection] = useState<'inc' | 'dec'>('inc');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [laneList, setLaneList] = useState<LaneArea[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawCount, setDrawCount] = useState(0);
  const [footerText, setFooterText] = useState('Click Draw Lane then click 4 corner points to outline the parking lane.');
  const [saving, setSaving] = useState(false);

  // ── Imperative redraw ─────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderCanvas(ctx, swRef.current, shRef.current, bgRef.current, lanesRef.current, modeRef.current, drawPtsRef.current, selectedIdRef.current, activeDotRef.current);
  }, []);

  const syncSidebar = useCallback(() => {
    setLaneList([...lanesRef.current]);
    setSelectedId(selectedIdRef.current);
  }, []);

  // ── Canvas pos ────────────────────────────────────────────────────────────
  function getPos(e: React.MouseEvent): Pt {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (swRef.current / rect.width),
      y: (e.clientY - rect.top) * (shRef.current / rect.height),
    };
  }

  // ── Load background ───────────────────────────────────────────────────────
  const loadBg = useCallback(async (camId: string) => {
    const container = containerRef.current;
    if (!container) return;
    bgRef.current = null;
    let imgW = 1280, imgH = 720;
    try {
      const res = await fetch(`/api/v1/cameras/${encodeURIComponent(camId)}/snapshot-latest`, { credentials: 'include' });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve, reject) => {
          const img = new window.Image();
          img.onload = () => { imgW = img.naturalWidth; imgH = img.naturalHeight; bgRef.current = img; resolve(); };
          img.onerror = reject;
          img.src = url;
        });
      }
    } catch (_) { /* no snapshot */ }
    const mW = Math.max(container.clientWidth - 4, 400);
    const mH = Math.max(container.clientHeight - 4, 300);
    const sc = Math.min(mW / imgW, mH / imgH, 1);
    const nw = Math.round(imgW * sc);
    const nh = Math.round(imgH * sc);
    swRef.current = nw; shRef.current = nh;
    setSw(nw); setSh(nh);
    redraw();
  }, [redraw]);

  // ── Load existing zones ───────────────────────────────────────────────────
  const loadExisting = useCallback(async (camId: string) => {
    try {
      const d = await getZoneEditorRaw(camId);
      if (!d.zones?.length) return;
      const metaByPrefix: Record<string, LaneArea> = {};
      const regularZones: typeof d.zones = [];

      d.zones.forEach((z: { zone_id: string; name?: string; polygon_json?: string }) => {
        const nameStr = z.name ?? '';
        if (nameStr.startsWith('__campark_meta__')) {
          try {
            const la: LaneArea & { dividersU?: number[]; dividersV?: number[] } = JSON.parse(nameStr.slice('__campark_meta__'.length));
            la.uuid = mkUuid();
            la.ci = ((la.ci ?? palIdxRef.current) % PAL.length);
            palIdxRef.current++;
            if (Array.isArray(la.pts) && la.pts.length >= 2) {
              const maxV = Math.max(...la.pts.flatMap(row => row.flatMap(p => [p.x, p.y])));
              if (maxV > 1) la.pts = la.pts.map(row => row.map(p => ({ x: p.x / 100, y: p.y / 100 })));
              la.pts = la.pts.map(row => row.map(clampNorm));
              la.quad = [la.pts[0][0], la.pts[0][la.cols], la.pts[la.rows][la.cols], la.pts[la.rows][0]];
            } else if (Array.isArray(la.quad)) {
              const maxC = Math.max(...la.quad.flatMap(p => [p.x, p.y]));
              if (maxC > 1) la.quad = la.quad.map(p => ({ x: p.x / 100, y: p.y / 100 }));
              la.quad = orderQuad(la.quad.map(clampNorm));
              const dU = la.dividersU?.length ? la.dividersU : Array.from({ length: la.cols + 1 }, (_, i) => i / la.cols);
              const dV = la.dividersV?.length ? la.dividersV : Array.from({ length: la.rows + 1 }, (_, i) => i / la.rows);
              const [TL, TR, BR, BL] = la.quad;
              la.pts = dV.map(v => dU.map(u => clampNorm({
                x: TL.x * (1 - u) * (1 - v) + TR.x * u * (1 - v) + BR.x * u * v + BL.x * (1 - u) * v,
                y: TL.y * (1 - u) * (1 - v) + TR.y * u * (1 - v) + BR.y * u * v + BL.y * (1 - u) * v,
              })));
            } else { return; }
            metaByPrefix[la.prefix] = la;
          } catch (e) { console.warn('meta parse failed', e); }
          return;
        }
        regularZones.push(z);
      });

      Object.values(metaByPrefix).forEach(la => lanesRef.current.push(la));

      // Fallback: zones without metadata
      const covered = new Set(Object.keys(metaByPrefix));
      const legacy = regularZones.filter(z => {
        const m = z.zone_id?.match(/^([A-Za-z]+)(\d+)$/);
        return m && !covered.has(m[1]);
      });
      if (legacy.length) {
        const byPrefix: Record<string, Array<{ num: number; pts: Pt[] }>> = {};
        legacy.forEach(z => {
          const m = z.zone_id?.match(/^([A-Za-z]+)(\d+)$/);
          if (!m) return;
          let poly: number[][] = [];
          try { poly = JSON.parse(z.polygon_json ?? '[]'); } catch (_) { return; }
          if (poly.length < 4) return;
          const maxVal = Math.max(...poly.flat());
          const norm = maxVal > 1 ? 100 : 1;
          const ptq = orderQuad(poly.map(p => clampNorm({ x: p[0] / norm, y: p[1] / norm })));
          if (!byPrefix[m[1]]) byPrefix[m[1]] = [];
          byPrefix[m[1]].push({ num: parseInt(m[2]), pts: ptq });
        });
        Object.entries(byPrefix).forEach(([pfx, zs]) => {
          zs.sort((a, b) => a.num - b.num);
          const n = zs.length;
          const quad = orderQuad([clampNorm(zs[0].pts[0]), clampNorm(zs[n - 1].pts[1]), clampNorm(zs[n - 1].pts[2]), clampNorm(zs[0].pts[3])]);
          lanesRef.current.push({ uuid: mkUuid(), pts: buildGrid(quad, n, 1), quad, prefix: pfx, start: 1, cols: n, rows: 1, dir: 'inc', gapPct: 0, ci: palIdxRef.current++ % PAL.length });
        });
      }
      syncSidebar(); redraw();
    } catch (e) { console.warn('loadExisting failed', e); }
  }, [redraw, syncSidebar]);

  // ── Init on camera change ─────────────────────────────────────────────────
  useEffect(() => {
    lanesRef.current = [];
    modeRef.current = 'idle';
    drawPtsRef.current = [];
    selectedIdRef.current = null;
    pendingIdRef.current = null;
    activeDotRef.current = null;
    dragRef.current = null;
    palIdxRef.current = 0;
    bgRef.current = null;
    setIsDrawing(false); setDrawCount(0); setSplitEnabled(false);
    setFooterText('Click Draw Lane then click 4 corner points to outline the parking lane.');
    syncSidebar();
    const frame = requestAnimationFrame(async () => {
      await loadBg(cameraId);
      await loadExisting(cameraId);
    });
    return () => cancelAnimationFrame(frame);
  }, [cameraId, loadBg, loadExisting, syncSidebar]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedIdRef.current) return;
        lanesRef.current = lanesRef.current.filter(l => l.uuid !== selectedIdRef.current);
        if (pendingIdRef.current === selectedIdRef.current) { pendingIdRef.current = null; setSplitEnabled(false); }
        selectedIdRef.current = null; activeDotRef.current = null;
        redraw(); syncSidebar();
      }
      if (e.key === 'Escape') {
        if (modeRef.current === 'draw') {
          modeRef.current = 'idle'; drawPtsRef.current = [];
          setIsDrawing(false); setDrawCount(0);
          setFooterText('Click Draw Lane then click 4 corner points to outline the parking lane.');
          redraw();
        } else {
          activeDotRef.current = null; selectedIdRef.current = null;
          redraw(); syncSidebar();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [redraw, syncSidebar]);

  // ── Mouse events ──────────────────────────────────────────────────────────
  function onMouseDown(e: React.MouseEvent) {
    const pos = getPos(e);

    if (modeRef.current === 'draw') {
      drawPtsRef.current.push(pos);
      const cnt = drawPtsRef.current.length;
      setDrawCount(cnt);
      if (cnt === 4) {
        const quad = orderQuad(drawPtsRef.current.map(p => toNorm(p.x, p.y, swRef.current, shRef.current)));
        const id = mkUuid();
        const ci = palIdxRef.current++ % PAL.length;
        lanesRef.current.push({ uuid: id, pts: buildGrid(quad, 1, 1), quad, prefix: prefix, start: 1, cols: 0, rows: 0, dir: direction, gapPct: gapPct, ci });
        pendingIdRef.current = id; selectedIdRef.current = id;
        modeRef.current = 'edit'; drawPtsRef.current = [];
        setIsDrawing(false); setDrawCount(0); setSplitEnabled(true);
        setFooterText('Lane drawn — set spaces/rows and click Split.');
        toast.success('Lane drawn — set spaces/rows and click Split.');
        syncSidebar();
      }
      redraw();
      return;
    }

    if (activeDotRef.current) {
      const la = lanesRef.current.find(l => l.uuid === activeDotRef.current!.laneId);
      if (la) la.pts[activeDotRef.current.row][activeDotRef.current.col] = clampNorm(toNorm(pos.x, pos.y, swRef.current, shRef.current));
      activeDotRef.current = null; dragRef.current = null;
      redraw(); syncSidebar();
      return;
    }

    const hit = hitTestDot(pos, lanesRef.current, swRef.current, shRef.current);
    if (hit) {
      selectedIdRef.current = hit.laneId; activeDotRef.current = hit;
      const la = lanesRef.current.find(l => l.uuid === hit.laneId);
      if (la) dragRef.current = { laneId: hit.laneId, row: hit.row, col: hit.col, origPt: { ...la.pts[hit.row][hit.col] }, sx: pos.x, sy: pos.y };
      setFooterText('Dot selected — drag it or click where you want it. Press Esc to cancel.');
      redraw(); syncSidebar();
      return;
    }

    activeDotRef.current = null; dragRef.current = null; selectedIdRef.current = null;
    redraw(); syncSidebar();
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const pos = getPos(e);
    const la = lanesRef.current.find(l => l.uuid === dragRef.current!.laneId);
    if (la) {
      const dx = (pos.x - dragRef.current.sx) / swRef.current * DRAG_GAIN;
      const dy = (pos.y - dragRef.current.sy) / shRef.current * DRAG_GAIN;
      la.pts[dragRef.current.row][dragRef.current.col] = clampNorm({ x: dragRef.current.origPt.x + dx, y: dragRef.current.origPt.y + dy });
      redraw();
    }
  }

  function onMouseUp() {
    if (dragRef.current) {
      dragRef.current = null; activeDotRef.current = null;
      syncSidebar();
      setFooterText('Click Draw Lane then click 4 corner points to outline the parking lane.');
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const startDraw = () => {
    if (modeRef.current === 'draw') return;
    modeRef.current = 'draw'; drawPtsRef.current = [];
    activeDotRef.current = null; selectedIdRef.current = null;
    setIsDrawing(true); setDrawCount(0);
    setFooterText('DRAW MODE — click 4 corner points of the lane boundary');
    redraw(); syncSidebar();
  };

  const cancelDraw = () => {
    modeRef.current = 'idle'; drawPtsRef.current = [];
    setIsDrawing(false); setDrawCount(0);
    setFooterText('Click Draw Lane then click 4 corner points to outline the parking lane.');
    redraw();
  };

  const deleteSelected = () => {
    if (!selectedIdRef.current) { toast.error('Select a lane first'); return; }
    lanesRef.current = lanesRef.current.filter(l => l.uuid !== selectedIdRef.current);
    if (pendingIdRef.current === selectedIdRef.current) { pendingIdRef.current = null; setSplitEnabled(false); }
    selectedIdRef.current = null; activeDotRef.current = null;
    redraw(); syncSidebar();
  };

  const splitLane = () => {
    if (!pendingIdRef.current) { toast.error('Draw a lane first'); return; }
    const la = lanesRef.current.find(l => l.uuid === pendingIdRef.current);
    if (!la) return;
    const nc = Math.max(1, cols), nr = Math.max(1, rows);
    const pfx = (prefix || 'A').trim() || 'A';
    la.cols = nc; la.rows = nr; la.prefix = pfx;
    la.start = nextStartFor(lanesRef.current.filter(l => l.uuid !== pendingIdRef.current), pfx);
    la.dir = direction; la.gapPct = gapPct;
    la.pts = buildGrid(la.quad, nc, nr);
    pendingIdRef.current = null; selectedIdRef.current = la.uuid;
    setSplitEnabled(false);
    const total = nc * nr, lbls = makeLabels(la);
    toast.success(`Generated ${total} spaces (${lbls[0]}–${lbls[total - 1]}). Click any dot to fine-tune.`);
    redraw(); syncSidebar();
    setFooterText('Click any dot to fine-tune. Use Save when done.');
  };

  const saveAll = async () => {
    const payload = buildSavePayload(lanesRef.current);
    if (!payload.length) { toast.error('No spaces to save'); return; }
    setSaving(true);
    try {
      const result = await bulkSaveZones(cameraId, payload, false);
      toast.success(`Saved ${result.saved} zones ✓`);
    } catch (e: unknown) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  const clearAll = async () => {
    if (!confirm(`Delete ALL saved zones for camera ${cameraId}? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteAllZones(cameraId);
      lanesRef.current = []; selectedIdRef.current = null; pendingIdRef.current = null; activeDotRef.current = null;
      setSplitEnabled(false); redraw(); syncSidebar();
      toast.success('All zones deleted');
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  const replaceAll = async () => {
    const payload = buildSavePayload(lanesRef.current);
    if (!confirm(`Replace all zones for ${cameraId} with ${payload.length} spaces?`)) return;
    setSaving(true);
    try {
      await deleteAllZones(cameraId);
      if (payload.length) {
        const result = await bulkSaveZones(cameraId, payload, false);
        toast.success(`Replaced and saved ${result.saved} zones ✓`);
      } else { toast.success('All zones cleared'); }
      lanesRef.current = []; selectedIdRef.current = null; pendingIdRef.current = null;
      activeDotRef.current = null; setSplitEnabled(false); redraw(); syncSidebar();
      await loadExisting(cameraId);
    } catch (e: unknown) {
      toast.error(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setSaving(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const totalSpaces = laneList.reduce((s, l) => s + Math.max(0, l.cols * l.rows), 0);

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col bg-[#0c0e12] overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-[#0c0e12] border-b border-[#1e2228]">
        <button onClick={onClose} className="flex items-center gap-1.5 h-8 px-3 text-sm text-[#9da7b3] hover:text-white hover:bg-[#1e2228] rounded-md transition-colors">
          <X className="w-4 h-4" /> Back to zones
        </button>
        <span className="text-[#30363d]">|</span>
        <select
          value={cameraId}
          onChange={e => onCameraChange(e.target.value)}
          className="bg-[#161b22] border border-[#30363d] text-[#e6edf3] h-8 px-2 text-sm rounded-md focus:outline-none focus:border-blue-500"
        >
          {cameras.map(c => <option key={c.camera_id} value={c.camera_id}>{c.name ?? c.camera_id}</option>)}
        </select>
      </div>

      {/* Main layout: canvas left, sidebar right */}
      <div className="flex-1 grid grid-cols-[1fr_300px] gap-3 p-3 min-h-0 overflow-hidden">

        {/* Canvas panel */}
        <div className="flex flex-col bg-[#1c2128] border border-[#2a2f36] rounded-lg overflow-hidden min-h-0">
          {/* Canvas toolbar */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#2a2f36]">
            <span className="text-xs font-semibold text-[#9da7b3] mr-auto">Camera: {cameraId}</span>
            {isDrawing ? (
              <button
                className="px-3 py-1.5 text-xs border border-orange-500 rounded bg-orange-500 text-white"
                onClick={cancelDraw}
              >
                ✕ Cancel ({drawCount}/4)
              </button>
            ) : (
              <button
                className="px-3 py-1.5 text-xs border border-[#30363d] rounded bg-[#1c2128] text-[#e6edf3] hover:border-orange-500 hover:text-orange-400 transition-colors"
                onClick={startDraw}
              >
                ■ Draw Lane
              </button>
            )}
            <button
              className="px-3 py-1.5 text-xs border border-[#30363d] rounded bg-[#1c2128] text-[#e6edf3] hover:border-red-500 hover:text-red-400 transition-colors"
              onClick={deleteSelected}
            >
              🗑 Delete Lane
            </button>
          </div>

          {/* Canvas body */}
          <div ref={containerRef} className="flex-1 flex items-center justify-center bg-[#111827] overflow-hidden min-h-0">
            <canvas
              ref={canvasRef}
              width={sw}
              height={sh}
              style={{ cursor: isDrawing ? 'crosshair' : 'default', maxWidth: '100%', maxHeight: '100%', display: 'block' }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            />
          </div>

          {/* Footer */}
          <div className={`shrink-0 px-3 py-1.5 text-xs border-t border-[#2a2f36] min-h-[26px] ${isDrawing ? 'text-orange-400 font-semibold' : 'text-[#9da7b3]'}`}>
            {footerText}
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-3 overflow-y-auto min-h-0 pr-0.5">

          {/* Step 1 — Draw */}
          <div className={`bg-[#1c2128] border rounded-lg p-4 ${isDrawing ? 'border-orange-500/60' : 'border-[#2a2f36]'}`}>
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#2a2f36]">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${isDrawing ? 'bg-orange-500' : 'bg-blue-500'}`}>1</span>
              <span className="text-sm font-semibold text-[#e6edf3]">Draw Lane Area</span>
            </div>
            {isDrawing && (
              <div className="mb-2 px-2 py-1.5 bg-orange-500/10 border border-orange-500/30 rounded text-xs text-orange-400 font-semibold">
                {drawCount} / 4 points{drawCount > 0 ? ' — click next corner' : ''}
              </div>
            )}
            <p className="text-xs text-[#9da7b3] leading-relaxed">
              Click <b className="text-[#c9d1d9]">Draw Lane</b>, then click the <b className="text-[#c9d1d9]">4 corners</b> of the parking lane (any order — auto-ordered TL→TR→BR→BL). Supports any trapezoid shape.
            </p>
          </div>

          {/* Step 2 — Split */}
          <div className={`bg-[#1c2128] border rounded-lg p-4 ${splitEnabled ? 'border-orange-500/60' : 'border-[#2a2f36]'}`}>
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#2a2f36]">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${splitEnabled ? 'bg-orange-500' : 'bg-blue-500'}`}>2</span>
              <span className="text-sm font-semibold text-[#e6edf3]">Split into Spaces</span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              {[
                { label: 'Spaces (Cols)', value: cols, setter: setCols, type: 'number', min: 1, max: 50 },
                { label: 'Rows',          value: rows, setter: setRows, type: 'number', min: 1, max: 10 },
                { label: 'Prefix',        value: prefix, setter: setPrefix, type: 'text', maxLength: 3 },
                { label: 'Gap %',         value: gapPct, setter: setGapPct, type: 'number', min: 0, max: 20 },
              ].map(({ label, value, setter, ...rest }) => (
                <div key={label}>
                  <label className="block text-[10px] text-[#9da7b3] mb-1 uppercase tracking-wider">{label}</label>
                  <input
                    {...rest}
                    value={value}
                    onChange={e => (setter as (v: number | string) => void)(rest.type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="w-full px-2 py-1.5 bg-[#0f1115] border border-[#2a2f36] rounded text-[#e6edf3] text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="mb-3">
              <label className="block text-[10px] text-[#9da7b3] mb-1 uppercase tracking-wider">Direction</label>
              <select
                value={direction}
                onChange={e => setDirection(e.target.value as 'inc' | 'dec')}
                className="w-full px-2 py-1.5 bg-[#0f1115] border border-[#2a2f36] rounded text-[#e6edf3] text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="inc">Increasing (A01→)</option>
                <option value="dec">Decreasing (→A01)</option>
              </select>
            </div>
            <button
              className={`w-full py-2 rounded text-sm font-semibold transition-colors ${splitEnabled ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-orange-500/20 text-orange-400/40 cursor-not-allowed'}`}
              onClick={splitLane}
              disabled={!splitEnabled}
            >
              Split into Spaces
            </button>
            <p className="mt-2 text-xs text-[#9da7b3] leading-relaxed">
              After splitting, <b className="text-[#c9d1d9]">click any yellow dot</b> to select it, then <b className="text-[#c9d1d9]">drag</b> or <b className="text-[#c9d1d9]">click</b> where you want it. Each dot moves independently.
            </p>
          </div>

          {/* Step 3 — Fine-Tune */}
          <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#2a2f36]">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 bg-blue-500">3</span>
              <span className="text-sm font-semibold text-[#e6edf3]">Fine-Tune & Review</span>
            </div>
            <div className="text-xs text-[#9da7b3] mb-3">
              Lanes: <span className="text-[#58a6ff] font-semibold">{laneList.length}</span>
              {' · '}
              Spaces: <span className="text-[#58a6ff] font-semibold">{totalSpaces}</span>
            </div>
            <div className="max-h-[180px] overflow-y-auto space-y-1 mb-2">
              {laneList.length === 0 ? (
                <p className="text-xs text-[#9da7b3]">No lanes yet.</p>
              ) : laneList.map(la => {
                const isSel = selectedId === la.uuid;
                const total = la.cols * la.rows;
                const lbls = total > 0 ? makeLabels(la) : [];
                const range = lbls.length ? ` ${lbls[0]}–${lbls[lbls.length - 1]}` : '';
                return (
                  <div
                    key={la.uuid}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer text-xs transition-colors border ${isSel ? 'bg-blue-500/10 border-blue-500/30' : 'bg-[#0f1115] border-transparent hover:bg-[#2a2f36]'}`}
                    onClick={() => { selectedIdRef.current = la.uuid; activeDotRef.current = null; redraw(); syncSidebar(); }}
                  >
                    <div>
                      <span className="font-semibold text-[#e6edf3]">{la.prefix} Lane</span>
                      <span className="text-[#9da7b3] ml-1">{total ? `${total} spaces${range}` : 'unsplit'}</span>
                    </div>
                    <button
                      className="text-red-400 hover:text-red-300 ml-2 leading-none text-base"
                      onClick={ev => {
                        ev.stopPropagation();
                        lanesRef.current = lanesRef.current.filter(l => l.uuid !== la.uuid);
                        if (pendingIdRef.current === la.uuid) { pendingIdRef.current = null; setSplitEnabled(false); }
                        if (selectedIdRef.current === la.uuid) { selectedIdRef.current = null; activeDotRef.current = null; }
                        redraw(); syncSidebar();
                      }}
                    >×</button>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-[#9da7b3] leading-relaxed">
              Every intersection is an independent <b className="text-[#c9d1d9]">yellow dot</b>. Drag any dot to reposition it — only the edges connected to that dot move.
            </p>
          </div>

          {/* Save */}
          <div className="bg-[#1c2128] border border-[#2a2f36] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#2a2f36]">
              <span className="text-sm font-semibold text-[#e6edf3]">💾 Save</span>
            </div>
            <div className="space-y-2">
              <button disabled={saving} onClick={saveAll} className="w-full py-2 rounded text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors disabled:opacity-40">
                {saving ? 'Saving…' : 'Save All Zones'}
              </button>
              <button disabled={saving} onClick={clearAll} className="w-full py-2 rounded text-sm font-semibold bg-red-500/80 hover:bg-red-600 text-white transition-colors disabled:opacity-40">
                Clear All
              </button>
              <button disabled={saving} onClick={replaceAll} className="w-full py-2 rounded text-sm font-semibold bg-[#2a2f36] hover:bg-[#363c44] text-[#e6edf3] transition-colors disabled:opacity-40">
                Replace All (Clear + Save)
              </button>
            </div>
            <p className="mt-2 text-xs text-[#9da7b3] leading-relaxed">
              <b className="text-[#c9d1d9]">Save All</b> adds/updates zones. <b className="text-[#c9d1d9]">Clear All</b> deletes server zones only. <b className="text-[#c9d1d9]">Replace All</b> deletes existing then saves current canvas.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
