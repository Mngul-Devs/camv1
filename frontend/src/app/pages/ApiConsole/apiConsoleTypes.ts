/**
 * API Console - Type Definitions
 * 
 * Centralized TypeScript interfaces and types for the API Console page.
 * Ensures type safety across all components and hooks.
 */

import type { ApiCamera, ApiZone } from "../../../lib/api";

// ─── HTTP & Request Types ───────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export type ConsoleMode = "guided" | "advanced";

export type ScopeMode = "project" | "all_cameras" | "by_site" | "by_camera" | "selected_zones";

export type BodyMode = "json" | "raw" | "none";

export type AuthType = "none" | "bearer" | "apikey";

export type ResponseTab = "pretty" | "raw" | "headers";

export type RequestTab = "body" | "headers" | "params" | "auth";

export type DispatchMode = "single" | "site_routes";

// ─── Key-Value Pair ────────────────────────────────────────────────────────

export interface KV {
  key: string;
  value: string;
  enabled: boolean;
}

// ─── Request Configuration ─────────────────────────────────────────────────

export interface SendConfig {
  method: HttpMethod;
  url: string;
  params: KV[];
  headers: KV[];
  authType: AuthType;
  authValue: string;
  bodyMode: BodyMode;
  bodyText: string;
}

// ─── Response ──────────────────────────────────────────────────────────────

export interface ProxyResponse {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  content_type: string;
  size: number;
  ms: number;
  ok: boolean;
  error?: string;
  detail?: string;
}

// ─── History ──────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  ts: string;
  method: string;
  url: string;
  status: number | null;
  ms: number;
  ok: boolean;
}

// ─── Templates ────────────────────────────────────────────────────────────

export interface Template {
  id: string;
  name: string;
  tag: string;
  tagColor: string;
  method: HttpMethod;
  description: string;
  build: (cameras: ApiCamera[], zones: ApiZone[]) => { url: string; body: object | null };
}

export interface TemplateWizardInfo {
  purpose: string;
  recommendedInterval: string;
  hints: string[];
}

// ─── Destination Presets ──────────────────────────────────────────────────

export interface DestinationPreset {
  id: string;
  name: string;
  url: string;
  authType: AuthType;
  authValue: string;
}

// ─── Site Routing ─────────────────────────────────────────────────────────

export interface SiteRouteRule {
  id: string;
  siteId: number;
  presetId: string;
  url: string;
}

export interface SiteOption {
  id: number;
  name: string;
}

// ─── Guided Mode Options ──────────────────────────────────────────────────

export interface GuidedTemplateOptions {
  includeSummary: boolean;
  includeTimestamp: boolean;
  onlyOnlineCameras: boolean;
}

// ─── Dispatch Statistics ──────────────────────────────────────────────────

export interface DispatchRunStat {
  label: string;
  target: string;
  success: number;
  fail: number;
  lastStatus: number | null;
  lastRunAt: number | null;
}

// ─── Scoped Data ──────────────────────────────────────────────────────────

export interface ScopedData {
  cameras: ApiCamera[];
  zones: ApiZone[];
}

// ─── Import/Export Configuration ──────────────────────────────────────────

export interface ExportedConfig {
  version: number;
  presets: DestinationPreset[];
  siteRoutes: SiteRouteRule[];
  templateOptions: GuidedTemplateOptions;
  scheduleMs: number;
  dispatchMode: DispatchMode;
}

// ─── Component Props ──────────────────────────────────────────────────────

export interface ApiConsoleHeaderProps {
  method: HttpMethod;
  setMethod: (method: HttpMethod) => void;
  url: string;
  setUrl: (url: string) => void;
  onSend: () => void;
  onRefresh: () => void;
  isSending: boolean;
  loadingData: boolean;
  mode: ConsoleMode;
  setMode: (mode: ConsoleMode) => void;
  showTemplates: boolean;
  setShowTemplates: (show: boolean) => void;
}

export interface TemplatePanelProps {
  templates: Template[];
  activeTemplate: string | null;
  onSelectTemplate: (id: string) => void;
  cameras: ApiCamera[];
  zones: ApiZone[];
}

export interface GuidedModePanelProps {
  // Template state
  activeTemplate: string | null;
  setActiveTemplate: (id: string) => void;
  templates: Template[];
  templateWizard: Record<string, TemplateWizardInfo>;

  // Scope state
  scopeMode: ScopeMode;
  setScopeMode: (mode: ScopeMode) => void;
  selectedSiteId: string;
  setSelectedSiteId: (id: string) => void;
  selectedCameraId: string;
  setSelectedCameraId: (id: string) => void;
  selectedZoneIds: string[];
  setSelectedZoneIds: (ids: string[]) => void;

  // Destination state
  url: string;
  setUrl: (url: string) => void;
  authType: AuthType;
  setAuthType: (type: AuthType) => void;
  authValue: string;
  setAuthValue: (value: string) => void;
  presets: DestinationPreset[];
  presetName: string;
  setPresetName: (name: string) => void;
  onSavePreset: () => void;
  onApplyPreset: (id: string) => void;
  onDeletePreset: (id: string) => void;

  // Scheduling state
  scheduleMs: number;
  setScheduleMs: (ms: number) => void;
  scheduleRunning: boolean;
  nextRunAt: number | null;
  onStartScheduler: () => void;
  onStopScheduler: () => void;

  // Dispatch state
  dispatchMode: DispatchMode;
  setDispatchMode: (mode: DispatchMode) => void;
  siteRoutes: SiteRouteRule[];
  onAddSiteRoute: (rule: SiteRouteRule) => void;
  onDeleteSiteRoute: (id: string) => void;

  // Template options
  templateOptions: GuidedTemplateOptions;
  setTemplateOptions: (options: GuidedTemplateOptions) => void;

  // Actions
  onPreview: () => void;
  onSend: () => void;
  onExportConfig: () => void;
  onImportConfig: (text: string) => void;

  // Data
  cameras: ApiCamera[];
  zones: ApiZone[];
  siteOptions: SiteOption[];
  scopedData: ScopedData;

  // UI state
  guidedPreview: string;
  dispatchStats: Record<string, DispatchRunStat>;
  onClearStats: () => void;
  showImportPanel: boolean;
  setShowImportPanel: (show: boolean) => void;
  importConfigText: string;
  setImportConfigText: (text: string) => void;
}

export interface AdvancedModePanelProps {
  // Request state
  method: HttpMethod;
  url: string;
  params: KV[];
  setParams: (params: KV[]) => void;
  headers: KV[];
  setHeaders: (headers: KV[]) => void;
  authType: AuthType;
  setAuthType: (type: AuthType) => void;
  authValue: string;
  setAuthValue: (value: string) => void;
  bodyMode: BodyMode;
  setBodyMode: (mode: BodyMode) => void;
  bodyText: string;
  setBodyText: (text: string) => void;
  jsonError: string;
  reqTab: RequestTab;
  setReqTab: (tab: RequestTab) => void;

  // Response state
  response: ProxyResponse | null;
  resTab: ResponseTab;
  setResTab: (tab: ResponseTab) => void;
  isSending: boolean;

  // Actions
  onSend: () => void;
  onCopyCurl: () => void;
  onFormatBody: () => void;
}

export interface ResponsePanelProps {
  response: ProxyResponse | null;
  resTab: ResponseTab;
  setResTab: (tab: ResponseTab) => void;
  isSending: boolean;
  onCopyResponse: () => void;
}

export interface HistoryPanelProps {
  history: HistoryEntry[];
  onSelectEntry: (url: string) => void;
  onClearHistory: () => void;
}

export interface RequestEditorProps {
  method: HttpMethod;
  params: KV[];
  setParams: (params: KV[]) => void;
  headers: KV[];
  setHeaders: (headers: KV[]) => void;
  authType: AuthType;
  setAuthType: (type: AuthType) => void;
  authValue: string;
  setAuthValue: (value: string) => void;
  bodyMode: BodyMode;
  setBodyMode: (mode: BodyMode) => void;
  bodyText: string;
  setBodyText: (text: string) => void;
  jsonError: string;
  reqTab: RequestTab;
  setReqTab: (tab: RequestTab) => void;
  onFormatBody: () => void;
}

export interface DestinationPresetsProps {
  presets: DestinationPreset[];
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export interface SiteRoutingConfigProps {
  siteRoutes: SiteRouteRule[];
  siteOptions: SiteOption[];
  presets: DestinationPreset[];
  onAddRoute: (rule: SiteRouteRule) => void;
  onDeleteRoute: (id: string) => void;
  onClose: () => void;
}

export interface DispatchStatsProps {
  stats: Record<string, DispatchRunStat>;
  onClear: () => void;
}

export interface TemplateWizardProps {
  template: Template;
  wizardInfo: TemplateWizardInfo;
}

// ─── Hook Return Types ────────────────────────────────────────────────────

export interface UseApiConsoleStateReturn {
  // Request state
  method: HttpMethod;
  setMethod: (method: HttpMethod) => void;
  url: string;
  setUrl: (url: string) => void;
  params: KV[];
  setParams: (params: KV[]) => void;
  headers: KV[];
  setHeaders: (headers: KV[]) => void;
  authType: AuthType;
  setAuthType: (type: AuthType) => void;
  authValue: string;
  setAuthValue: (value: string) => void;
  bodyMode: BodyMode;
  setBodyMode: (mode: BodyMode) => void;
  bodyText: string;
  setBodyText: (text: string) => void;
  jsonError: string;
  setJsonError: (error: string) => void;
  reqTab: RequestTab;
  setReqTab: (tab: RequestTab) => void;

  // Response state
  response: ProxyResponse | null;
  setResponse: (response: ProxyResponse | null) => void;
  resTab: ResponseTab;
  setResTab: (tab: ResponseTab) => void;
  isSending: boolean;
  setIsSending: (sending: boolean) => void;

  // UI state
  mode: ConsoleMode;
  setMode: (mode: ConsoleMode) => void;
  showTemplates: boolean;
  setShowTemplates: (show: boolean) => void;
  activeTemplate: string | null;
  setActiveTemplate: (id: string | null) => void;
  history: HistoryEntry[];
  setHistory: (history: HistoryEntry[]) => void;
}

export interface UseSchedulerReturn {
  scheduleMs: number;
  setScheduleMs: (ms: number) => void;
  scheduleRunning: boolean;
  nextRunAt: number | null;
  startScheduler: (callback: () => Promise<void>) => void;
  stopScheduler: () => void;
}

export interface UseDestinationPresetsReturn {
  presets: DestinationPreset[];
  addPreset: (preset: DestinationPreset) => void;
  deletePreset: (id: string) => void;
  updatePreset: (id: string, preset: Partial<DestinationPreset>) => void;
  getPreset: (id: string) => DestinationPreset | undefined;
}

export interface UseSiteRoutingReturn {
  siteRoutes: SiteRouteRule[];
  addRoute: (rule: SiteRouteRule) => void;
  deleteRoute: (id: string) => void;
  updateRoute: (id: string, rule: Partial<SiteRouteRule>) => void;
  getRoute: (siteId: number) => SiteRouteRule | undefined;
  resolveRouteUrl: (rule: SiteRouteRule, presets: DestinationPreset[]) => string;
}

// ─── Utility Function Types ───────────────────────────────────────────────

export interface HighlightJsonOptions {
  indent?: number;
  maxLength?: number;
}

export interface FormatSizeOptions {
  decimals?: number;
}

export interface BuildResolvedUrlOptions {
  includeParams?: boolean;
}

export interface BuildGuidedConfigOptions {
  urlOverride?: string;
  filterOnlineOnly?: boolean;
}

export interface ExecuteSendOptions {
  quiet?: boolean;
  timeout?: number;
  retries?: number;
}
