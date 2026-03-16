/**
 * useApiConsoleState Hook
 * 
 * Main state management hook for the API Console page.
 * Manages request, response, and UI state.
 */

import { useState, useCallback } from "react";
import type {
  HttpMethod,
  ConsoleMode,
  BodyMode,
  AuthType,
  ResponseTab,
  RequestTab,
  KV,
  ProxyResponse,
  HistoryEntry,
  UseApiConsoleStateReturn,
} from "../apiConsoleTypes";
import { createKV } from "../apiConsoleUtils";

const DEFAULT_HEADERS: KV[] = [createKV("Content-Type", "application/json")];

export function useApiConsoleState(): UseApiConsoleStateReturn {
  // ─── Request State ────────────────────────────────────────────────────────

  const [method, setMethod] = useState<HttpMethod>("POST");
  const [url, setUrl] = useState("https://");
  const [params, setParams] = useState<KV[]>([]);
  const [headers, setHeaders] = useState<KV[]>(DEFAULT_HEADERS);
  const [authType, setAuthType] = useState<AuthType>("none");
  const [authValue, setAuthValue] = useState("");
  const [bodyMode, setBodyMode] = useState<BodyMode>("json");
  const [bodyText, setBodyText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [reqTab, setReqTab] = useState<RequestTab>("body");

  // ─── Response State ───────────────────────────────────────────────────────

  const [response, setResponse] = useState<ProxyResponse | null>(null);
  const [resTab, setResTab] = useState<ResponseTab>("pretty");
  const [isSending, setIsSending] = useState(false);

  // ─── UI State ─────────────────────────────────────────────────────────────

  const [mode, setMode] = useState<ConsoleMode>("guided");
  const [showTemplates, setShowTemplates] = useState(true);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ─── Memoized Callbacks ───────────────────────────────────────────────────

  const resetRequest = useCallback(() => {
    setMethod("POST");
    setUrl("https://");
    setParams([]);
    setHeaders(DEFAULT_HEADERS);
    setAuthType("none");
    setAuthValue("");
    setBodyMode("json");
    setBodyText("");
    setJsonError("");
    setReqTab("body");
  }, []);

  const resetResponse = useCallback(() => {
    setResponse(null);
    setResTab("pretty");
  }, []);

  const addToHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => [entry, ...prev].slice(0, 30));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return {
    // Request state
    method,
    setMethod,
    url,
    setUrl,
    params,
    setParams,
    headers,
    setHeaders,
    authType,
    setAuthType,
    authValue,
    setAuthValue,
    bodyMode,
    setBodyMode,
    bodyText,
    setBodyText,
    jsonError,
    setJsonError,
    reqTab,
    setReqTab,

    // Response state
    response,
    setResponse,
    resTab,
    setResTab,
    isSending,
    setIsSending,

    // UI state
    mode,
    setMode,
    showTemplates,
    setShowTemplates,
    activeTemplate,
    setActiveTemplate,
    history,
    setHistory,
  };
}
