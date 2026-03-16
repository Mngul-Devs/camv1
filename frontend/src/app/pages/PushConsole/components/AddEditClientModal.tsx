/**
 * AddEditClientModal.tsx
 * 4-step modal for adding or editing a push client.
 *
 * Step 1 → Client info (name, description)
 * Step 2 → Endpoint + Auth + Headers (with live headers preview)
 * Step 3 → Payload — what to push (scope, cameras/sites, interval, retries)
 * Step 4 → Review + Save
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  X, Check, ChevronRight, ChevronLeft, AlertTriangle,
  Loader2, Shield, Key, Lock, Wifi, Plus, Trash2, Eye, EyeOff,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { PushClient, AuthType, PushScope, CustomHeader } from "../pushConsoleTypes";
import type { ApiCamera, ApiSite } from "../../../../lib/api";

/** btoa that handles non-Latin1 characters safely */
function safeBtoa(str: string): string {
  try {
    return btoa(unescape(encodeURIComponent(str)));
  } catch {
    return btoa(str.replace(/[^\x00-\xFF]/g, "?"));
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface AddEditClientModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (client: PushClient) => void;
  clientToEdit?: PushClient | null;
  initialStep?: 1 | 2 | 3 | 4;
  cameras: ApiCamera[];
  sites: ApiSite[];
}

type Step = 1 | 2 | 3 | 4;

interface FormState {
  name: string;
  description: string;
  endpoint: string;
  authType: AuthType;
  bearerToken: string;
  apiKeyHeader: string;
  apiKeyValue: string;
  basicUser: string;
  basicPass: string;
  customHeaders: CustomHeader[];
  scope: PushScope;
  selectedCameraIds: string[];
  selectedSiteIds: number[];
  intervalSeconds: number;
  maxRetries: number;
  retryBackoffSeconds: number;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  endpoint: "",
  authType: "bearer",
  bearerToken: "",
  apiKeyHeader: "x-api-key",
  apiKeyValue: "",
  basicUser: "",
  basicPass: "",
  customHeaders: [],
  scope: "project",
  selectedCameraIds: [],
  selectedSiteIds: [],
  intervalSeconds: 30,
  maxRetries: 3,
  retryBackoffSeconds: 5,
};

const STEP_LABELS: Record<Step, string> = {
  1: "Client info",
  2: "Endpoint & auth",
  3: "Payload",
  4: "Review",
};

const AUTH_OPTIONS: { value: AuthType; label: string; icon: React.ReactNode; description: string; headerPreview: string }[] = [
  { value: "bearer", label: "Bearer token", icon: <Shield className="w-3.5 h-3.5" />, description: "JWT or OAuth2 token. Most common for modern REST APIs.", headerPreview: "Authorization: Bearer <token>" },
  { value: "apikey", label: "API key", icon: <Key className="w-3.5 h-3.5" />, description: "Static key in a custom header. Set both the header name and value.", headerPreview: "<header-name>: <value>" },
  { value: "basic", label: "Basic auth", icon: <Lock className="w-3.5 h-3.5" />, description: "Username + password encoded as Base64. Used by legacy systems.", headerPreview: "Authorization: Basic <base64(user:pass)>" },
  { value: "none", label: "No auth", icon: <Wifi className="w-3.5 h-3.5" />, description: "No authentication header. Use only for internal / trusted endpoints.", headerPreview: "(no auth header)" },
];

const SCOPE_OPTIONS: { value: PushScope; label: string; desc: string }[] = [
  { value: "project", label: "Whole project", desc: "All cameras in this project" },
  { value: "site", label: "By site", desc: "Select specific sites" },
  { value: "camera", label: "By camera", desc: "Select specific cameras" },
];

const INTERVAL_PRESETS = [
  { label: "5s", value: 5 },
  { label: "10s", value: 10 },
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
];

function isValidUrl(url: string) {
  return /^https?:\/\/.{3,}/.test(url.trim());
}

function maskSecret(val: string, show: boolean): string {
  if (!val) return "";
  if (show) return val;
  return val.slice(0, 4) + "••••••••" + val.slice(-4);
}

// ─── Header preview builder ───────────────────────────────────────────────────

interface HeaderRow { key: string; value: string; source: "auto" | "auth" | "custom"; enabled: boolean }

function buildHeadersPreview(form: FormState): HeaderRow[] {
  const rows: HeaderRow[] = [];

  rows.push({ key: "Content-Type", value: "application/json", source: "auto", enabled: true });
  rows.push({ key: "User-Agent", value: "CamPark/6.0", source: "auto", enabled: true });

  if (form.authType === "bearer" && form.bearerToken) {
    const preview = form.bearerToken.length > 20
      ? form.bearerToken.slice(0, 12) + "…" + form.bearerToken.slice(-6)
      : form.bearerToken;
    rows.push({ key: "Authorization", value: `Bearer ${preview}`, source: "auth", enabled: true });
  } else if (form.authType === "apikey" && form.apiKeyHeader) {
    const val = form.apiKeyValue
      ? form.apiKeyValue.length > 16 ? form.apiKeyValue.slice(0, 8) + "…" : form.apiKeyValue
      : "<value>";
    rows.push({ key: form.apiKeyHeader || "x-api-key", value: val, source: "auth", enabled: !!form.apiKeyValue });
  } else if (form.authType === "basic" && form.basicUser) {
    const encoded = safeBtoa(`${form.basicUser}:${form.basicPass || ""}`) ;
    const preview = encoded.length > 16 ? encoded.slice(0, 12) + "…" : encoded;
    rows.push({ key: "Authorization", value: `Basic ${preview}`, source: "auth", enabled: true });
  }

  form.customHeaders.filter((h) => h.enabled && h.key).forEach((h) => {
    rows.push({ key: h.key, value: h.value || "<empty>", source: "custom", enabled: h.enabled });
  });

  return rows;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: Step; total: number }) {
  return (
    <div className="flex items-center gap-1 px-6 py-3 border-b border-[#2a2f36] bg-[#0f1115]/60">
      {Array.from({ length: total }, (_, i) => {
        const step = (i + 1) as Step;
        const isDone = step < current;
        const isActive = step === current;
        return (
          <div key={step} className="flex items-center gap-1">
            <div className="flex items-center gap-2">
              <div className={["w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold font-mono transition-all", isDone ? "bg-[#3fb950] text-black" : isActive ? "bg-[#3fb950]/15 text-[#3fb950] border border-[#3fb950]/50" : "bg-[#2a2f36] text-[#6e7681]"].join(" ")}>
                {isDone ? <Check className="w-2.5 h-2.5" /> : step}
              </div>
              <span className={["text-[11px] font-medium transition-colors hidden sm:block", isActive ? "text-[#e6edf3]" : isDone ? "text-[#3fb950]" : "text-[#6e7681]"].join(" ")}>{STEP_LABELS[step]}</span>
            </div>
            {i < total - 1 && <div className={["w-6 h-px mx-1 transition-colors", isDone ? "bg-[#3fb950]/40" : "bg-[#2a2f36]"].join(" ")} />}
          </div>
        );
      })}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6e7681] mb-3">{children}</p>;
}

function RowSummary({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: "green" | "blue" | "yellow" }) {
  const color = accent === "green" ? "text-[#3fb950]" : accent === "blue" ? "text-[#58a6ff]" : accent === "yellow" ? "text-[#d29922]" : "text-[#e6edf3]";
  return (
    <div className="flex items-start justify-between px-4 py-3 gap-4 border-b border-[#2a2f36] last:border-0">
      <span className="text-xs text-[#6e7681] flex-shrink-0 pt-0.5 min-w-[90px]">{label}</span>
      <span className={["text-xs text-right break-all", mono ? "font-mono" : "font-medium", color].join(" ")}>{value}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AddEditClientModal({ open, onClose, onSave, clientToEdit, initialStep = 1, cameras, sites }: AddEditClientModalProps) {
  const isEdit = !!clientToEdit;
  const [step, setStep] = useState<Step>(initialStep);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [testStatus, setTestStatus] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);
  const [camSearch, setCamSearch] = useState("");
  const [siteSearch, setSiteSearch] = useState("");

  // Initialise or reset form when modal opens / clientToEdit changes
  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setTestStatus("idle");
    setTestMessage("");
    setShowSecret(false);
    setCamSearch("");
    setSiteSearch("");
    setStep(initialStep);
    if (clientToEdit) {
      setForm({
        name: clientToEdit.name,
        description: clientToEdit.description,
        endpoint: clientToEdit.endpoint,
        authType: clientToEdit.authType,
        bearerToken: clientToEdit.bearerToken,
        apiKeyHeader: clientToEdit.apiKeyHeader,
        apiKeyValue: clientToEdit.apiKeyValue,
        basicUser: clientToEdit.basicUser,
        basicPass: clientToEdit.basicPass,
        customHeaders: clientToEdit.customHeaders,
        scope: clientToEdit.scope,
        selectedCameraIds: clientToEdit.selectedCameraIds,
        selectedSiteIds: clientToEdit.selectedSiteIds,
        intervalSeconds: clientToEdit.intervalSeconds,
        maxRetries: clientToEdit.maxRetries,
        retryBackoffSeconds: clientToEdit.retryBackoffSeconds,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, clientToEdit, initialStep]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  const patch = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ── Camera / site selection
  const filteredCameras = useMemo(() => {
    const q = camSearch.toLowerCase();
    return cameras.filter((c) => c.camera_id.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q));
  }, [cameras, camSearch]);

  const filteredSites = useMemo(() => {
    const q = siteSearch.toLowerCase();
    return sites.filter((s) => s.name.toLowerCase().includes(q));
  }, [sites, siteSearch]);

  const toggleCamera = (id: string) =>
    patch("selectedCameraIds", form.selectedCameraIds.includes(id)
      ? form.selectedCameraIds.filter((x) => x !== id)
      : [...form.selectedCameraIds, id]);

  const toggleSite = (id: number) =>
    patch("selectedSiteIds", form.selectedSiteIds.includes(id)
      ? form.selectedSiteIds.filter((x) => x !== id)
      : [...form.selectedSiteIds, id]);

  // ── Custom headers CRUD
  const addHeader = () =>
    patch("customHeaders", [...form.customHeaders, { id: `h_${Date.now()}`, key: "", value: "", enabled: true }]);

  const updateHeader = (id: string, field: keyof CustomHeader, value: string | boolean) =>
    patch("customHeaders", form.customHeaders.map((h) => h.id === id ? { ...h, [field]: value } : h));

  const removeHeader = (id: string) =>
    patch("customHeaders", form.customHeaders.filter((h) => h.id !== id));

  // ── Test connection (mock — replace with real proxy call when backend ready)
  const handleTest = useCallback(async () => {
    if (!isValidUrl(form.endpoint)) return;
    setTestStatus("running");
    setTestMessage("Sending test ping…");
    await new Promise((r) => setTimeout(r, 1200));
    const ok = form.endpoint.startsWith("https://");
    setTestStatus(ok ? "ok" : "fail");
    setTestMessage(ok ? "200 OK · ~138ms — endpoint reachable" : "Connection failed — check URL or auth settings");
  }, [form.endpoint]);

  // ── Validation
  const urlValid = isValidUrl(form.endpoint);
  const canNext: Record<Step, boolean> = {
    1: form.name.trim().length >= 2,
    2: urlValid,
    3: form.scope === "project"
      || (form.scope === "camera" && form.selectedCameraIds.length > 0)
      || (form.scope === "site" && form.selectedSiteIds.length > 0),
    4: true,
  };

  // ── Headers preview
  const headersPreview = useMemo(() => buildHeadersPreview(form), [form]);

  // ── Auth info
  const authOption = AUTH_OPTIONS.find((a) => a.value === form.authType)!;

  // ── Save
  const handleSave = useCallback(() => {
    const client: PushClient = {
      id: clientToEdit?.id ?? `cli_${Date.now().toString(36)}`,
      name: form.name.trim(),
      description: form.description.trim(),
      endpoint: form.endpoint.trim(),
      authType: form.authType,
      bearerToken: form.bearerToken,
      apiKeyHeader: form.apiKeyHeader,
      apiKeyValue: form.apiKeyValue,
      basicUser: form.basicUser,
      basicPass: form.basicPass,
      customHeaders: form.customHeaders,
      scope: form.scope,
      selectedCameraIds: form.selectedCameraIds,
      selectedSiteIds: form.selectedSiteIds,
      intervalSeconds: form.intervalSeconds,
      maxRetries: form.maxRetries,
      retryBackoffSeconds: form.retryBackoffSeconds,
      paused: clientToEdit?.paused ?? false,
      createdAt: clientToEdit?.createdAt ?? Date.now(),
      successCount: clientToEdit?.successCount ?? 0,
      errorCount: clientToEdit?.errorCount ?? 0,
      lastSeenAt: clientToEdit?.lastSeenAt ?? null,
      lastStatusCode: clientToEdit?.lastStatusCode ?? null,
      avgLatencyMs: clientToEdit?.avgLatencyMs ?? 0,
    };
    onSave(client);
    setSaved(true);
  }, [form, clientToEdit, onSave]);

  const handleNext = useCallback(() => {
    if (step === 4) { handleSave(); return; }
    setStep((s) => (s + 1) as Step);
  }, [step, handleSave]);

  const handleBack = useCallback(() => {
    if (step === 1) return;
    setStep((s) => (s - 1) as Step);
  }, [step]);

  if (!open) return null;

  // ─── Saved state ───────────────────────────────────────────────────────────
  if (saved) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-[#161b22] border border-[#2a2f36] rounded-xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col items-center gap-4 py-10 px-6 text-center">
            <div className="w-14 h-14 rounded-full bg-[#3fb950]/15 border border-[#3fb950]/30 flex items-center justify-center">
              <Check className="w-7 h-7 text-[#3fb950]" />
            </div>
            <div>
              <p className="text-[#e6edf3] font-semibold text-base">{isEdit ? "Client updated" : "Client added"}</p>
              <p className="font-mono text-xs text-[#9da7b3] mt-1">{form.name} → {form.endpoint.replace(/^https?:\/\/([^/]+).*/, "$1")}</p>
            </div>
            <Button size="sm" className="bg-[#3fb950] hover:bg-[#3fb950]/90 text-black font-semibold mt-2" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main modal ────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#161b22] border border-[#2a2f36] rounded-xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col"
        style={{ maxHeight: "calc(100vh - 48px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2f36]">
          <div>
            <h2 className="text-sm font-semibold text-[#e6edf3]">{isEdit ? `Edit client — ${clientToEdit?.name}` : "Add push client"}</h2>
            <p className="text-[10px] text-[#6e7681] font-mono mt-0.5">Configure endpoint, auth, and payload</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-md flex items-center justify-center text-[#6e7681] hover:text-[#e6edf3] hover:bg-[#2a2f36] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <StepIndicator current={step} total={4} />

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">

          {/* ── STEP 1: Client info */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-xs text-[#9da7b3]">Give this client a name so you can identify it in the dashboard.</p>
              <div className="space-y-1.5">
                <Label className="text-xs text-[#9da7b3]">Client name <span className="text-[#f85149]">*</span></Label>
                <Input
                  autoFocus
                  value={form.name}
                  onChange={(e) => patch("name", e.target.value)}
                  placeholder="e.g. Dashboard Client A, Mobile Backend"
                  className="bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono h-9 placeholder:text-[#6e7681] focus-visible:ring-[#3fb950]/30 focus-visible:border-[#3fb950]/50"
                />
                {form.name.length > 0 && form.name.trim().length < 2 && (
                  <p className="text-[10px] text-[#f85149] font-mono flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> At least 2 characters</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[#9da7b3]">Description <span className="text-[#6e7681] font-normal">(optional)</span></Label>
                <textarea
                  value={form.description}
                  onChange={(e) => patch("description", e.target.value)}
                  placeholder="What does this client receive? E.g. customer-facing parking dashboard"
                  rows={3}
                  className="w-full resize-none rounded-md px-3 py-2 text-xs text-[#e6edf3] font-mono bg-[#0f1115] border border-[#2a2f36] outline-none placeholder:text-[#6e7681] focus:border-[#3fb950]/50"
                />
              </div>
            </div>
          )}

          {/* ── STEP 2: Endpoint, auth, headers */}
          {step === 2 && (
            <div className="space-y-5">
              {/* Endpoint URL */}
              <div className="space-y-1.5">
                <SectionLabel>Destination URL</SectionLabel>
                <Input
                  autoFocus
                  value={form.endpoint}
                  onChange={(e) => { patch("endpoint", e.target.value); setTestStatus("idle"); }}
                  placeholder="https://your-server.com/webhook"
                  className={["bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono h-9 placeholder:text-[#6e7681] focus-visible:ring-[#3fb950]/30 focus-visible:border-[#3fb950]/50", form.endpoint.length > 0 && !urlValid ? "border-[#f85149]/60" : ""].join(" ")}
                />
                {form.endpoint.length > 0 && !urlValid && (
                  <p className="text-[10px] text-[#f85149] font-mono flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Must start with https:// or http://</p>
                )}
              </div>

              {/* Auth */}
              <div className="space-y-3">
                <SectionLabel>Authentication method</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  {AUTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => patch("authType", opt.value)}
                      className={["flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all", form.authType === opt.value ? "bg-[#58a6ff]/10 border-[#58a6ff]/40 text-[#58a6ff]" : "bg-[#0f1115] border-[#2a2f36] text-[#9da7b3] hover:border-[#444c56] hover:text-[#e6edf3]"].join(" ")}
                    >
                      <span className="mt-0.5 flex-shrink-0">{opt.icon}</span>
                      <div>
                        <p className="text-xs font-medium">{opt.label}</p>
                        <p className="text-[10px] mt-0.5 leading-relaxed opacity-70">{opt.description}</p>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Auth fields */}
                {form.authType !== "none" && (
                  <div className="space-y-2 pt-1">
                    {form.authType === "bearer" && (
                      <div className="space-y-1.5">
                        <Label className="text-[10px] text-[#6e7681]">Token</Label>
                        <div className="relative">
                          <Input
                            type={showSecret ? "text" : "password"}
                            value={form.bearerToken}
                            onChange={(e) => patch("bearerToken", e.target.value)}
                            placeholder="eyJhbGciOiJIUzI1NiIs…"
                            className="pr-9 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono h-8 placeholder:text-[#6e7681] focus-visible:ring-[#3fb950]/30 focus-visible:border-[#3fb950]/50"
                          />
                          <button onClick={() => setShowSecret((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6e7681] hover:text-[#9da7b3]">
                            {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <p className="text-[10px] text-[#6e7681] font-mono bg-[#0f1115] border border-[#2a2f36] px-2.5 py-1.5 rounded-md">
                          → <span className="text-[#9da7b3]">Authorization:</span> <span className="text-[#58a6ff]">Bearer</span> {form.bearerToken ? <span className="text-[#3fb950]">{maskSecret(form.bearerToken, false)}</span> : <span className="text-[#6e7681]">&lt;token&gt;</span>}
                        </p>
                      </div>
                    )}
                    {form.authType === "apikey" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-[#6e7681]">Header name</Label>
                            <Input value={form.apiKeyHeader} onChange={(e) => patch("apiKeyHeader", e.target.value)} placeholder="x-api-key" className="bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono h-8 placeholder:text-[#6e7681]" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-[#6e7681]">Value</Label>
                            <div className="relative">
                              <Input type={showSecret ? "text" : "password"} value={form.apiKeyValue} onChange={(e) => patch("apiKeyValue", e.target.value)} placeholder="sk-xxxxxxxxxxxx" className="pr-8 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono h-8 placeholder:text-[#6e7681]" />
                              <button onClick={() => setShowSecret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6e7681] hover:text-[#9da7b3]"><Eye className="w-3 h-3" /></button>
                            </div>
                          </div>
                        </div>
                        <p className="text-[10px] text-[#6e7681] font-mono bg-[#0f1115] border border-[#2a2f36] px-2.5 py-1.5 rounded-md">
                          → <span className="text-[#9da7b3]">{form.apiKeyHeader || "x-api-key"}:</span> <span className="text-[#3fb950]">{form.apiKeyValue ? maskSecret(form.apiKeyValue, false) : "<value>"}</span>
                        </p>
                      </div>
                    )}
                    {form.authType === "basic" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] text-[#6e7681]">Username</Label>
                            <Input value={form.basicUser} onChange={(e) => patch("basicUser", e.target.value)} placeholder="admin" className="bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono h-8 placeholder:text-[#6e7681]" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] text-[#6e7681]">Password</Label>
                            <div className="relative">
                              <Input type={showSecret ? "text" : "password"} value={form.basicPass} onChange={(e) => patch("basicPass", e.target.value)} placeholder="••••••••" className="pr-8 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono h-8 placeholder:text-[#6e7681]" />
                              <button onClick={() => setShowSecret((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#6e7681] hover:text-[#9da7b3]"><Eye className="w-3 h-3" /></button>
                            </div>
                          </div>
                        </div>
                        <p className="text-[10px] text-[#6e7681] font-mono bg-[#0f1115] border border-[#2a2f36] px-2.5 py-1.5 rounded-md">
                          → <span className="text-[#9da7b3]">Authorization:</span> <span className="text-[#58a6ff]">Basic</span> <span className="text-[#3fb950]">{form.basicUser ? safeBtoa(`${form.basicUser}:${form.basicPass}`).slice(0, 16) + "…" : "<base64>"}</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Custom headers */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <SectionLabel>Custom headers</SectionLabel>
                  <button onClick={addHeader} className="flex items-center gap-1 text-[10px] font-mono text-[#58a6ff] hover:text-[#58a6ff]/80 transition-colors">
                    <Plus className="w-3 h-3" /> Add header
                  </button>
                </div>
                {form.customHeaders.length === 0 ? (
                  <p className="text-[10px] text-[#6e7681] font-mono">No custom headers. Click "Add header" to include extra headers like <span className="text-[#9da7b3]">X-Project-ID</span> or <span className="text-[#9da7b3]">X-Region</span>.</p>
                ) : (
                  <div className="space-y-1.5">
                    {form.customHeaders.map((h) => (
                      <div key={h.id} className="flex items-center gap-2">
                        <button
                          onClick={() => updateHeader(h.id, "enabled", !h.enabled)}
                          className={["w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all", h.enabled ? "bg-[#3fb950] border-[#3fb950]" : "border-[#444c56]"].join(" ")}
                        >
                          {h.enabled && <Check className="w-2.5 h-2.5 text-black" />}
                        </button>
                        <Input
                          value={h.key}
                          onChange={(e) => updateHeader(h.id, "key", e.target.value)}
                          placeholder="Header-Name"
                          className="flex-1 h-7 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-[11px] font-mono placeholder:text-[#6e7681]"
                        />
                        <span className="text-[#6e7681] text-xs flex-shrink-0">:</span>
                        <Input
                          value={h.value}
                          onChange={(e) => updateHeader(h.id, "value", e.target.value)}
                          placeholder="value"
                          className="flex-1 h-7 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-[11px] font-mono placeholder:text-[#6e7681]"
                        />
                        <button onClick={() => removeHeader(h.id)} className="text-[#6e7681] hover:text-[#f85149] transition-colors flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Headers preview */}
              <div className="space-y-2">
                <SectionLabel>Request headers preview</SectionLabel>
                <div className="bg-[#0f1115] border border-[#2a2f36] rounded-lg p-3 space-y-1 font-mono text-[11px]">
                  {headersPreview.map((row, i) => (
                    <div key={i} className={["flex gap-2", row.enabled ? "" : "opacity-40"].join(" ")}>
                      <span className={row.source === "auth" ? "text-[#58a6ff]" : row.source === "custom" ? "text-[#d29922]" : "text-[#6e7681]"}>{row.key}:</span>
                      <span className="text-[#9da7b3] truncate">{row.value}</span>
                      <span className="text-[#2a2f36] ml-auto flex-shrink-0">
                        {row.source === "auto" ? "auto" : row.source === "auth" ? "auth" : "custom"}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[#6e7681]">
                  <span className="text-[#58a6ff]">blue</span> = auth header · <span className="text-[#d29922]">yellow</span> = custom · <span className="text-[#6e7681]">grey</span> = auto-added
                </p>
              </div>

              {/* Test connection */}
              <div className="border-t border-[#2a2f36] pt-4 space-y-2">
                <p className="text-xs font-medium text-[#9da7b3]">Test connection</p>
                <button
                  disabled={!urlValid || testStatus === "running"}
                  onClick={handleTest}
                  className={["w-full flex items-center justify-center gap-2 py-2 rounded-lg border text-xs font-medium transition-all", urlValid && testStatus !== "running" ? "border-[#2a2f36] bg-[#0f1115] text-[#9da7b3] hover:text-[#e6edf3] hover:border-[#444c56]" : "border-[#2a2f36] bg-[#0f1115] text-[#6e7681] cursor-not-allowed opacity-50"].join(" ")}
                >
                  {testStatus === "running" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  Send test ping
                </button>
                {testStatus !== "idle" && (
                  <div className={["flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-mono", testStatus === "ok" ? "bg-[#3fb950]/10 border-[#3fb950]/25 text-[#3fb950]" : testStatus === "fail" ? "bg-[#f85149]/10 border-[#f85149]/25 text-[#f85149]" : "bg-[#2a2f36] border-[#2a2f36] text-[#9da7b3]"].join(" ")}>
                    {testStatus === "ok" && <Check className="w-3.5 h-3.5 flex-shrink-0" />}
                    {testStatus === "fail" && <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                    {testStatus === "running" && <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" />}
                    {testMessage}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── STEP 3: Payload — what to push */}
          {step === 3 && (
            <div className="space-y-5">
              {/* Scope */}
              <div>
                <SectionLabel>What to push</SectionLabel>
                <div className="grid grid-cols-3 gap-2">
                  {SCOPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => patch("scope", opt.value)}
                      className={["flex flex-col items-start px-3 py-2.5 rounded-lg border transition-all text-left", form.scope === opt.value ? "bg-[#3fb950]/10 border-[#3fb950]/40 text-[#3fb950]" : "bg-[#0f1115] border-[#2a2f36] text-[#9da7b3] hover:border-[#444c56] hover:text-[#e6edf3]"].join(" ")}
                    >
                      <span className="text-xs font-medium">{opt.label}</span>
                      <span className="text-[10px] mt-0.5 opacity-70">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Camera selection */}
              {form.scope === "camera" && (
                <div className="space-y-2">
                  <Label className="text-xs text-[#9da7b3]">Select cameras</Label>
                  <Input value={camSearch} onChange={(e) => setCamSearch(e.target.value)} placeholder={`Search ${cameras.length} cameras…`} className="h-8 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono placeholder:text-[#6e7681] focus-visible:ring-[#3fb950]/30 focus-visible:border-[#3fb950]/50" />
                  <div className="max-h-32 overflow-y-auto border border-[#2a2f36] rounded-md p-2 bg-[#0f1115]">
                    <div className="flex flex-wrap gap-1.5">
                      {filteredCameras.map((c) => {
                        const sel = form.selectedCameraIds.includes(c.camera_id);
                        return (
                          <button key={c.camera_id} onClick={() => toggleCamera(c.camera_id)} className={["inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border transition-all", sel ? "bg-[#58a6ff]/10 text-[#58a6ff] border-[#58a6ff]/35" : "bg-[#1c2128] text-[#9da7b3] border-[#2a2f36] hover:text-[#e6edf3]"].join(" ")}>
                            <span className={["w-1.5 h-1.5 rounded-full", c.status === "ONLINE" ? "bg-[#3fb950]" : "bg-[#6e7681]"].join(" ")} />
                            {c.camera_id}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {form.selectedCameraIds.length === 0 && <p className="text-[10px] text-[#f85149] font-mono">Select at least one camera</p>}
                </div>
              )}

              {/* Site selection */}
              {form.scope === "site" && (
                <div className="space-y-2">
                  <Label className="text-xs text-[#9da7b3]">Select sites</Label>
                  <Input value={siteSearch} onChange={(e) => setSiteSearch(e.target.value)} placeholder={`Search ${sites.length} sites…`} className="h-8 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono placeholder:text-[#6e7681] focus-visible:ring-[#3fb950]/30 focus-visible:border-[#3fb950]/50" />
                  <div className="max-h-32 overflow-y-auto border border-[#2a2f36] rounded-md p-2 bg-[#0f1115]">
                    <div className="flex flex-col gap-1">
                      {filteredSites.map((s) => {
                        const sel = form.selectedSiteIds.includes(s.id);
                        return (
                          <button key={s.id} onClick={() => toggleSite(s.id)} className={["flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-all text-left", sel ? "bg-[#58a6ff]/10 text-[#58a6ff]" : "text-[#9da7b3] hover:bg-[#1c2128] hover:text-[#e6edf3]"].join(" ")}>
                            <div className={["w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-all", sel ? "bg-[#58a6ff] border-[#58a6ff]" : "border-[#444c56]"].join(" ")}>
                              {sel && <Check className="w-2.5 h-2.5 text-white" />}
                            </div>
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {form.selectedSiteIds.length === 0 && <p className="text-[10px] text-[#f85149] font-mono">Select at least one site</p>}
                </div>
              )}

              {form.scope === "project" && (
                <p className="text-[11px] text-[#6e7681]">All {cameras.length} cameras in this project will be included in every push.</p>
              )}

              {/* Interval */}
              <div className="space-y-2">
                <SectionLabel>Push interval</SectionLabel>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {INTERVAL_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => patch("intervalSeconds", p.value)}
                      className={["px-2.5 py-1 rounded-md text-[11px] font-mono border transition-all", form.intervalSeconds === p.value ? "bg-[#d29922]/10 text-[#d29922] border-[#d29922]/35" : "bg-[#0f1115] text-[#9da7b3] border-[#2a2f36] hover:text-[#e6edf3]"].join(" ")}
                    >{p.label}</button>
                  ))}
                  <div className="flex items-center border border-[#2a2f36] rounded-md overflow-hidden bg-[#0f1115]">
                    <input
                      type="number" min={1} value={form.intervalSeconds}
                      onChange={(e) => patch("intervalSeconds", parseInt(e.target.value) || 30)}
                      className="w-12 px-2 py-1 text-[11px] font-mono text-[#e6edf3] bg-transparent outline-none text-center"
                    />
                    <span className="text-[11px] font-mono text-[#6e7681] px-2 border-l border-[#2a2f36]">sec</span>
                  </div>
                </div>
              </div>

              {/* Retries */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-[#6e7681]">Max retries</Label>
                  <Input type="number" min={0} max={10} value={form.maxRetries} onChange={(e) => patch("maxRetries", parseInt(e.target.value) || 0)} className="h-8 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono focus-visible:ring-[#3fb950]/30" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] text-[#6e7681]">Backoff (seconds)</Label>
                  <Input type="number" min={1} value={form.retryBackoffSeconds} onChange={(e) => patch("retryBackoffSeconds", parseInt(e.target.value) || 1)} className="h-8 bg-[#0f1115] border-[#2a2f36] text-[#e6edf3] text-xs font-mono focus-visible:ring-[#3fb950]/30" />
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 4: Review */}
          {step === 4 && (
            <div className="space-y-4">
              <p className="text-xs text-[#9da7b3]">Review configuration before saving. Push will start immediately after.</p>

              {/* Client info */}
              <div className="border border-[#2a2f36] rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-[#0f1115] border-b border-[#2a2f36]">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6e7681]">Client</span>
                </div>
                <RowSummary label="Name" value={form.name} />
                {form.description && <RowSummary label="Description" value={form.description} />}
              </div>

              {/* Endpoint */}
              <div className="border border-[#2a2f36] rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-[#0f1115] border-b border-[#2a2f36]">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6e7681]">Endpoint & auth</span>
                </div>
                <RowSummary label="URL" value={form.endpoint} mono accent="blue" />
                <RowSummary label="Auth" value={authOption.label} />
                <RowSummary label="Header sent" value={authOption.headerPreview} mono />
                {form.customHeaders.filter((h) => h.enabled && h.key).length > 0 && (
                  <RowSummary
                    label="Custom headers"
                    value={`${form.customHeaders.filter((h) => h.enabled && h.key).length} header(s)`}
                    accent="yellow"
                  />
                )}
              </div>

              {/* Payload */}
              <div className="border border-[#2a2f36] rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-[#0f1115] border-b border-[#2a2f36]">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6e7681]">Payload</span>
                </div>
                <RowSummary label="Scope" value={form.scope === "project" ? "Whole project" : form.scope === "site" ? "By site" : "By camera"} />
                {form.scope === "camera" && <RowSummary label="Cameras" value={`${form.selectedCameraIds.length} selected`} mono />}
                {form.scope === "site" && <RowSummary label="Sites" value={`${form.selectedSiteIds.length} selected`} mono />}
                <RowSummary label="Interval" value={form.intervalSeconds >= 60 ? `${form.intervalSeconds / 60}m` : `${form.intervalSeconds}s`} mono accent="yellow" />
                <RowSummary label="Max retries" value={form.maxRetries.toString()} mono />
              </div>

              <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-[#3fb950]/8 border border-[#3fb950]/20">
                <Check className="w-3.5 h-3.5 text-[#3fb950] mt-0.5 flex-shrink-0" />
                <p className="text-xs text-[#9da7b3]">
                  <span className="text-[#3fb950] font-medium">{form.name}</span> will receive pushes every{" "}
                  <span className="text-[#d29922] font-mono">
                    {form.intervalSeconds >= 60 ? `${form.intervalSeconds / 60}m` : `${form.intervalSeconds}s`}
                  </span> to <span className="text-[#58a6ff] font-mono">{form.endpoint.replace(/^https?:\/\/([^/]+).*/, "$1")}</span>.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#2a2f36] bg-[#0f1115]/40">
          <Button variant="ghost" size="sm" onClick={handleBack} disabled={step === 1} className="text-[#9da7b3] hover:text-[#e6edf3] disabled:opacity-0 h-8 px-3 gap-1.5">
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="text-[#9da7b3] border-[#2a2f36] hover:text-[#e6edf3] hover:border-[#444c56] hover:bg-transparent h-8 px-3">Cancel</Button>
            <Button
              size="sm"
              onClick={handleNext}
              disabled={!canNext[step]}
              className="bg-[#3fb950] hover:bg-[#3fb950]/90 text-black font-semibold h-8 px-4 gap-1.5 disabled:opacity-40"
            >
              {step === 4 ? <><Check className="w-3.5 h-3.5" /> {isEdit ? "Save changes" : "Add client"}</> : <>Next <ChevronRight className="w-3.5 h-3.5" /></>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
