import {
  PROTOCOL_VERSION,
  type ProtocolCommand,
  type ProtocolErrorCode,
  type ProtocolEvent,
  type ProtocolResponse,
} from "@office/contracts";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { PiRuntime } from "./runtime.js";

export type CommandHandler = (params: Record<string, unknown>) => Promise<unknown>;

/**
 * Line-framed JSON protocol over stdio: commands in on stdin, responses and
 * ordered events out on stdout. Anything not protocol output goes to stderr.
 */
export class SidecarServer {
  private readonly runtime: PiRuntime;
  private readonly handlers = new Map<string, CommandHandler>();
  private sequence = 0;
  private output: Writable = process.stdout;

  constructor(runtime: PiRuntime) {
    this.runtime = runtime;
    this.handlers.set("handshake", () => this.runtime.handshake());
    this.handlers.set("config.providers", () => this.runtime.listProviders());
    this.handlers.set("config.setApiKey", (p) =>
      this.runtime.setApiKey(requiredString(p, "providerId"), requiredString(p, "apiKey")),
    );
    this.handlers.set("config.custom.save", (p) =>
      this.runtime.saveCustomProvider(record(p.provider, "provider")),
    );
    this.handlers.set("session.list", () => this.runtime.listSessions());
    this.handlers.set("session.new", (p) => this.runtime.newSession(optionalString(p, "cwd")));
    this.handlers.set("session.open", (p) => this.runtime.openSession(requiredString(p, "file"), optionalString(p, "cwd")));
    this.handlers.set("session.setCwd", (p) => this.runtime.setSessionCwd(optionalString(p, "cwd")));
    this.handlers.set("session.rename", (p) =>
      this.runtime.renameSession(requiredString(p, "file"), requiredString(p, "title")),
    );
    this.handlers.set("session.delete", (p) => this.runtime.deleteSession(requiredString(p, "file")));
    this.handlers.set("run.start", (p) =>
      this.runtime.startRun({
        prompt: requiredString(p, "prompt"),
        providerId: optionalString(p, "providerId"),
        modelId: optionalString(p, "modelId"),
        thinkingLevel: optionalString(p, "thinkingLevel"),
        permissionMode: optionalString(p, "permissionMode"),
        sessionTitle: optionalString(p, "sessionTitle"),
      }),
    );
    this.handlers.set("run.followUp", (p) =>
      this.runtime.followUp(requiredString(p, "prompt")),
    );
    this.handlers.set("config.remoteModels", (p) =>
      this.runtime.fetchRemoteModels(
        requiredString(p, "baseUrl"),
        typeof p.apiKey === "string" ? p.apiKey : "",
        optionalString(p, "providerId"),
      ),
    );
    this.handlers.set("os.open", (p) =>
      this.runtime.openPath(requiredString(p, "path"), Boolean(p.revealDir)),
    );
    this.handlers.set("fs.stat", async (p) => this.runtime.statFile(requiredString(p, "path")));
    this.handlers.set("fs.import", (p) =>
      this.runtime.importFile(requiredString(p, "name"), requiredString(p, "dataBase64")),
    );
    this.handlers.set("workspace.files", () => this.runtime.listWorkspaceFiles());
    this.handlers.set("run.cancel", () => this.runtime.cancelRun());
  }

  listen(input: Readable = process.stdin, output: Writable = process.stdout, exitOnClose = true): void {
    this.output = output;
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      void this.handleLine(trimmed);
    });
    lines.on("close", () => {
      this.runtime.dispose();
      if (exitOnClose) process.exit(0);
    });
  }

  private async handleLine(line: string): Promise<void> {
    let command: ProtocolCommand;
    try {
      command = JSON.parse(line) as ProtocolCommand;
    } catch {
      this.log("warn", `丢弃无法解析的输入行（长度 ${line.length}）`);
      return;
    }
    const respond = (response: ProtocolResponse) => this.write(response);
    if (command.protocolVersion !== PROTOCOL_VERSION) {
      respond(this.failure(command.requestId, "protocol_version_mismatch", `协议版本不支持: ${command.protocolVersion}`));
      return;
    }
    const handler = this.handlers.get(command.method);
    if (!handler) {
      respond(this.failure(command.requestId, "unknown_method", `未知命令: ${command.method}`));
      return;
    }
    if (typeof command.requestId !== "string" || !command.requestId) {
      this.log("warn", "丢弃缺少 requestId 的命令");
      return;
    }
    try {
      const payload = await handler(command.params ?? {});
      // Commands acknowledge acceptance; async outcomes arrive as events.
      respond({ protocolVersion: PROTOCOL_VERSION, requestId: command.requestId, ok: true, payload });
    } catch (err) {
      const code = (err as { code?: ProtocolErrorCode }).code ?? "runtime_error";
      respond(
        this.failure(
          command.requestId,
          code,
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  }

  private failure(requestId: string, code: ProtocolErrorCode, message: string): ProtocolResponse {
    return { protocolVersion: PROTOCOL_VERSION, requestId, ok: false, error: { code, message } };
  }

  emit(type: string, runId: string | undefined, payload: unknown): void {
    const event: ProtocolEvent = {
      protocolVersion: PROTOCOL_VERSION,
      eventId: crypto.randomUUID(),
      sequence: ++this.sequence,
      ...(runId ? { runId } : {}),
      type: type as ProtocolEvent["type"],
      payload,
    };
    this.write(event);
  }

  log(level: "info" | "warn" | "error", message: string): void {
    // Diagnostics never touch stdout; the UI mirrors them through the `log` event.
    process.stderr.write(`[${level}] ${message}\n`);
    this.emit("log", undefined, { level, message });
  }

  private write(message: unknown): void {
    this.output.write(JSON.stringify(message) + "\n");
  }
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value) throw new Error(`参数 ${key} 必须是非空字符串`);
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value ? value : undefined;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`参数 ${name} 必须是对象`);
  }
  return value as Record<string, unknown>;
}
