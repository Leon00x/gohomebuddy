import {
  PROTOCOL_VERSION,
  type CatalogProvider,
  type HandshakeResult,
  type ProtocolEvent,
  type ProtocolEventType,
  type ProtocolResponse,
  type SessionSnapshot,
  type SessionSummary,
} from "@office/contracts";

export type ConnectionStatus = "connecting" | "live" | "preview";

export type PermissionMode = "ask" | "auto_edit" | "full_access";

export const PERMISSION_MODES: {
  id: PermissionMode;
  short: string;
  label: string;
  desc: string;
}[] = [
  { id: "ask", short: "询问", label: "Ask", desc: "敏感操作前先确认" },
  { id: "auto_edit", short: "自动编辑", label: "Auto Edit", desc: "允许创建与编辑文件，高风险操作仍确认" },
  { id: "full_access", short: "完全访问", label: "Full Access", desc: "自动执行所有本地操作" },
];

type EventListener = (event: ProtocolEvent) => void;

/**
 * Browser-side speaker of the sidecar JSONL protocol. The dev bridge forwards
 * frames over WebSocket one-to-one; a later TauriTransport can reuse this class
 * by swapping only the send/onMessage plumbing.
 */
export class ProtocolClient {
  private ws: WebSocket | null = null;
  private connecting: Promise<HandshakeResult> | null = null;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private listeners = new Set<EventListener>();
  private nextRequestId = 0;
  handshake: HandshakeResult | null = null;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  async connect(url = "ws://127.0.0.1:1421"): Promise<HandshakeResult> {
    // React StrictMode remounts effects; reuse the in-flight attempt instead of
    // opening a second socket (the bridge accepts a single client).
    if (this.connected) return this.handshake!;
    if (this.connecting) return this.connecting;
    this.connecting = this.open(url).finally(() => {
      this.connecting = null;
    });
    this.handshake = await this.connecting;
    return this.handshake;
  }

  private async open(url: string): Promise<HandshakeResult> {
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (msg) => this.onFrame(String(msg.data));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接运行时超时")), 4000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("无法连接本地运行时"));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        reject(new Error("本地运行时拒绝连接"));
      };
    });
    // Once open, a dropped socket resets state and notifies the UI.
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.handshake = null;
      for (const listener of this.listeners) {
        listener({
          protocolVersion: PROTOCOL_VERSION,
          eventId: `closed-${Date.now()}`,
          sequence: 0,
          type: "log",
          payload: { level: "warn", message: "与本地运行时的连接已断开" },
        });
      }
    };
    return (await this.request("handshake")) as HandshakeResult;
  }

  request(method: string, params: Record<string, unknown> = {}, timeoutMs = 45000): Promise<unknown> {
    if (!this.connected) return Promise.reject(new Error("本地运行时未连接"));
    const requestId = `ui-${++this.nextRequestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${method} 超时`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, requestId, method, params }));
    });
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private onFrame(frame: string): void {
    let msg: (ProtocolResponse | ProtocolEvent) & Record<string, unknown>;
    try {
      msg = JSON.parse(frame);
    } catch {
      return;
    }
    if ("requestId" in msg) {
      const entry = this.pending.get(msg.requestId as string);
      if (!entry) return;
      this.pending.delete(msg.requestId as string);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.payload);
      else entry.reject(new Error((msg as ProtocolResponse).error?.message ?? "命令失败"));
      return;
    }
    if ("eventId" in msg) {
      for (const listener of this.listeners) listener(msg as unknown as ProtocolEvent);
    }
  }
}

/** Map a pi tool name to the UI tool-card kind. */
export function toolKind(toolName: string): "search" | "read" | "edit" | "shell" {
  const name = toolName.toLowerCase();
  if (name.includes("read") || name.includes("view")) return "read";
  if (name.includes("grep") || name.includes("find") || name.includes("search") || name.includes("list") || name.includes("glob")) return "search";
  if (name.includes("edit") || name.includes("write")) return "edit";
  return "shell";
}

export function toolLabel(toolName: string): string {
  const kind = toolKind(toolName);
  return kind === "read" ? "读取文件" : kind === "search" ? "搜索文件" : kind === "edit" ? "修改文件" : "执行命令";
}

export function toolTarget(toolName: string, args: unknown): string {
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    for (const key of ["path", "file_path", "filePath", "pattern", "command", "cmd"]) {
      if (typeof a[key] === "string" && a[key]) return String(a[key]);
    }
  }
  return toolName;
}

export function toolOutputText(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    for (const key of ["output", "text", "content", "partial", "delta"]) {
      const value = p[key];
      if (typeof value === "string") return value;
      if (value && typeof value === "object") {
        const nested = toolOutputText(value);
        if (nested) return nested;
      }
    }
    return JSON.stringify(payload, null, 2);
  }
  return String(payload);
}

/** Shared session/model state hooks used by both App and Settings. */
export interface ModelSelection {
  providerId: string;
  providerName: string;
  modelId: string;
  /** pi ThinkingLevel; only meaningful when the model supports reasoning. */
  thinkingLevel?: string;
}

/** 从工具参数中提取文件路径。 */
export function extractPath(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const a = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath"]) {
    if (typeof a[key] === "string" && a[key]) return a[key];
  }
  return undefined;
}

export const THINKING_LEVELS: { id: string; label: string }[] = [
  { id: "off", label: "关闭" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "max", label: "最高" },
];

export type ProvidersResult = CatalogProvider[];
export type SessionListResult = SessionSummary[];
export type SessionOpenResult = SessionSnapshot;
export type RunEventType = ProtocolEventType;
