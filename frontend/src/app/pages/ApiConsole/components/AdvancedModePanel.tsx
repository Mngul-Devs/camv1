/**
 * AdvancedModePanel Component
 * 
 * Wrapper component that combines RequestEditor and ResponsePanel in a split view.
 * Provides Postman-style request building and response inspection.
 */

import type { AdvancedModePanelProps } from "../apiConsoleTypes";
import { RequestEditor } from "./RequestEditor";
import { ResponsePanel } from "./ResponsePanel";

export function AdvancedModePanel({
  method,
  url,
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
  reqTab,
  setReqTab,
  response,
  resTab,
  setResTab,
  isSending,
  onFormatBody,
}: AdvancedModePanelProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Request Editor - 42% height */}
      <div style={{ height: "42%" }} className="flex flex-col min-h-0 border-b border-[#2a2f36]">
        <RequestEditor
          method={method}
          params={params}
          setParams={setParams}
          headers={headers}
          setHeaders={setHeaders}
          authType={authType}
          setAuthType={setAuthType}
          authValue={authValue}
          setAuthValue={setAuthValue}
          bodyMode={bodyMode}
          setBodyMode={setBodyMode}
          bodyText={bodyText}
          setBodyText={setBodyText}
          jsonError={jsonError}
          reqTab={reqTab}
          setReqTab={setReqTab}
          onFormatBody={onFormatBody}
        />
      </div>

      {/* Response Panel - flex-1 height */}
      <ResponsePanel
        response={response}
        resTab={resTab}
        setResTab={setResTab}
        isSending={isSending}
        onCopyResponse={() => {
          if (response?.body) {
            navigator.clipboard.writeText(response.body);
          }
        }}
      />
    </div>
  );
}
