export type ProviderKind = "deepseek" | "glm" | "custom";
export interface ModelProfile {
  provider: ProviderKind;
  name: string;
  baseUrl: string;
  modelId: string;
}
export type ToolStatus = "running" | "success" | "error" | "cancelled";
export interface ToolStep {
  id: string;
  kind: "search" | "read" | "edit" | "shell";
  label: string;
  target: string;
  output: string;
  status: ToolStatus;
  /** 原始工具名与参数，用于卡片详情展示 */
  toolName?: string;
  args?: unknown;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools?: ToolStep[];
}
export interface Session {
  id: string;
  title: string;
  messages: Message[];
}
/** UI depends on this boundary, not on pi SDK. Production implementation follows later. */
export interface AgentClient {
  readonly mode: "preview" | "live";
  run(
    prompt: string,
    signal: AbortSignal,
    onStep: (step: ToolStep) => void,
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Sidecar protocol (stdio JSONL, one JSON object per LF-terminated line).
// Commands flow UI -> sidecar; runtime events flow sidecar -> UI.
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = 1;

export interface ProtocolCommand {
  protocolVersion: number;
  requestId: string;
  method: ProtocolMethodName;
  params: Record<string, unknown>;
}

export interface ProtocolEvent {
  protocolVersion: number;
  eventId: string;
  sequence: number;
  runId?: string;
  type: ProtocolEventType;
  payload: unknown;
}

/** Reply to a command on the same line-oriented channel; errors carry a stable code. */
export interface ProtocolResponse {
  protocolVersion: number;
  requestId: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: ProtocolErrorCode; message: string };
}

export type ProtocolErrorCode =
  | "protocol_version_mismatch"
  | "unknown_method"
  | "invalid_params"
  | "run_already_active"
  | "no_active_run"
  | "runtime_error";

export type ProtocolMethodName =
  | "handshake"
  | "config.providers"
  | "config.setApiKey"
  | "config.custom.save"
  | "session.list"
  | "session.new"
  | "session.open"
  | "session.rename"
  | "session.delete"
  | "run.start"
  | "run.followUp"
  | "run.cancel"
  | "config.remoteModels"
  | "os.open"
  | "fs.stat"
  | "workspace.files";

export type ProtocolEventType =
  | "run.started"
  | "message.delta"
  | "thinking.delta"
  | "tool.start"
  | "tool.update"
  | "tool.end"
  | "turn.end"
  | "agent.start"
  | "run.end"
  | "log";

export interface HandshakeResult {
  protocolVersion: number;
  runtime: "pi";
  piVersion: string;
  node: string;
  pid: number;
  agentDir: string;
  cwd: string;
}

export interface CatalogModel {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
}

export interface CatalogProvider {
  id: string;
  name: string;
  /** "custom" providers come from our managed models.json. */
  origin: "builtin" | "custom";
  baseUrl?: string;
  auth: "ready" | "missing";
  models: CatalogModel[];
}

export interface SessionSummary {
  file: string;
  id: string;
  title: string;
  modified: string;
  messageCount: number;
}

export type SnapshotToolCall = {
  id: string;
  toolName: string;
  args: unknown;
  output: string;
  isError: boolean;
};

export interface SnapshotMessage {
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  tools?: SnapshotToolCall[];
}

export interface SessionSnapshot {
  file: string;
  id: string;
  messages: SnapshotMessage[];
}

export interface Artifact {
  path: string;
  name: string;
  kind: "sheet" | "doc" | "slides" | "pdf" | "image" | "markdown" | "text" | "code" | "other";
  sizeKb?: number;
  modified?: boolean;
}

/** workspace.files：工作空间内可选为上下文引用的文件（相对 cwd，正斜杠）。 */
export interface WorkspaceFileEntry {
  path: string;
}

export interface WorkspaceFilesResult {
  cwd: string;
  files: WorkspaceFileEntry[];
  /** 超过单次列出上限时为 true，UI 应提示改用搜索缩小范围。 */
  truncated: boolean;
}

export interface RunStartParams {
  prompt: string;
  providerId?: string;
  modelId?: string;
  /** pi ThinkingLevel: off | minimal | low | medium | high | xhigh | max */
  thinkingLevel?: string;
  /** ask | auto_edit | full_access；引擎按档位注入相应权限指令 */
  permissionMode?: string;
}

export type RunEndReason = "completed" | "aborted" | "error";

export interface RunEndPayload {
  runId: string;
  reason: RunEndReason;
  error?: string;
}
