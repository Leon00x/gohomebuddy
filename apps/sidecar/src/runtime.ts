import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  PROTOCOL_VERSION,
  type CatalogModel,
  type CatalogProvider,
  type RunEndPayload,
  type RunEndReason,
  type SessionSnapshot,
  type SessionSummary,
  type SnapshotMessage,
  type SnapshotToolCall,
} from "@office/contracts";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import * as nodePath from "node:path";

const SYSTEM_PROMPT = `你是 Office Agent，运行在用户桌面上的个人智能助手。

- 始终用用户使用的语言回复（默认中文）。
- 你可以读取和修改用户工作目录中的文件、执行命令、搜索内容；做重要改动前先用一句话说明你要做什么。
- 专注当前任务：不要浏览或读取与任务无关的目录（如技能目录、系统配置、工作目录之外的位置）。
- 多步任务连续执行，不要每一步都停下来询问；遇到报错先自行修复再继续。
- 回答简洁直接，少说客套话；代码块标注语言；列出文件时给出相对路径。
- 不主动提及你底层使用的框架、引擎或模型名称，你的名字是 Office Agent。`;

/** Built-in providers surfaced in the settings UI; everything else stays reachable via custom models.json. */
const CURATED_PROVIDERS: { id: string; name: string }[] = [
  { id: "deepseek", name: "DeepSeek" },
  { id: "zhipu", name: "智谱 GLM" },
  { id: "zai", name: "Z.AI" },
  { id: "zai-coding-cn", name: "Z.ai Coding (CN)" },
];

export type RuntimeEmitter = (type: string, runId: string | undefined, payload: unknown) => void;

export class PiRuntime {
  private readonly agentDir: string;
  private readonly cwd: string;
  private readonly emit: RuntimeEmitter;
  private modelRuntime: ModelRuntime | null = null;
  private session: AgentSession | null = null;
  private sessionFilePath: string | null = null;
  private activeRunId: string | null = null;
  private cancelRequested = false;
  private unsubscribe: (() => void) | null = null;

  constructor(options: { agentDir: string; cwd: string; emit: RuntimeEmitter }) {
    this.agentDir = options.agentDir;
    this.cwd = options.cwd;
    this.emit = options.emit;
  }

  get busy(): boolean {
    return this.activeRunId !== null;
  }

  async ensureModelRuntime(): Promise<ModelRuntime> {
    if (!this.modelRuntime) {
      this.modelRuntime = await ModelRuntime.create({
        authPath: nodePath.join(this.agentDir, "auth.json"),
        modelsPath: nodePath.join(this.agentDir, "models.json"),
      });
    }
    return this.modelRuntime;
  }

  async handshake(): Promise<Record<string, unknown>> {
    await this.ensureModelRuntime();
    return {
      protocolVersion: PROTOCOL_VERSION,
      runtime: "pi",
      piVersion: "0.85.1",
      node: process.version,
      pid: process.pid,
      agentDir: this.agentDir,
      cwd: this.cwd,
    };
  }

  async listProviders(): Promise<CatalogProvider[]> {
    const rt = await this.ensureModelRuntime();
    const available = new Set(await this.availableModelKeys(rt));
    const providers: CatalogProvider[] = [];
    for (const curated of CURATED_PROVIDERS) {
      providers.push(await this.describeProvider(rt, curated.id, curated.name, "builtin", available));
    }
    for (const custom of await this.readCustomProviders()) {
      const rawModels = Array.isArray(custom.models) ? (custom.models as Record<string, unknown>[]) : [];
      const models = rawModels.map((m) => toCatalogModel(m, str(m.id)));
      providers.push({
        id: String(custom.id),
        name: typeof custom.name === "string" ? custom.name : String(custom.id),
        origin: "custom",
        baseUrl: typeof custom.baseUrl === "string" ? custom.baseUrl : undefined,
        auth: "missing",
        models,
      });
    }
    return providers;
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    const rt = await this.ensureModelRuntime();
    await rt.setRuntimeApiKey(providerId, apiKey);
    // 持久化到 pi auth.json（应用隔离目录内，权限 0600），重启后自动加载
    await mkdir(this.agentDir, { recursive: true });
    const authPath = nodePath.join(this.agentDir, "auth.json");
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(await readFile(authPath, "utf8")) as Record<string, unknown>;
    } catch {
      // 首次写入
    }
    data[providerId] = { type: "api_key", key: apiKey };
    await writeFile(authPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  async saveCustomProvider(entry: Record<string, unknown>): Promise<void> {
    if (this.busy) throw Object.assign(new Error("运行中的任务不接受配置变更"), { code: "run_already_active" });
    const all = await this.readCustomProviders();
    const id = String(entry.id);
    const rest = all.filter((p) => p.id !== id);
    rest.push(entry);
    await mkdir(this.agentDir, { recursive: true });
    await writeFile(
      nodePath.join(this.agentDir, "models.json"),
      JSON.stringify({ providers: Object.fromEntries(rest.map((p) => [p.id, p])), }, null, 2),
      "utf8",
    );
    // Drop the cached catalog so the next run.start resolves the new entry.
    this.modelRuntime = null;
    await this.ensureModelRuntime();
  }

  async listSessions(): Promise<SessionSummary[]> {
    const listed = (await SessionManager.listAll()) as unknown[];
    return listed
      .map((raw) => {
        const item = raw as Record<string, unknown>;
        const file = str(item.path ?? item.file);
        if (!file) return null;
        const modified = item.modified instanceof Date ? item.modified.toISOString() : str(item.modified);
        return {
          file,
          id: str(item.id) || file,
          title: str(item.name) || str(item.firstMessage).slice(0, 40) || "未命名会话",
          modified: modified || new Date(0).toISOString(),
          messageCount: num(item.messageCount) ?? 0,
        } satisfies SessionSummary;
      })
      .filter((s): s is SessionSummary => s !== null)
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  async newSession(): Promise<{ file: string; id: string }> {
    await this.replaceSession(await SessionManager.create(this.cwd));
    return { file: this.sessionFilePath ?? "", id: this.session?.sessionId ?? "" };
  }

  async openSession(file: string): Promise<SessionSnapshot> {
    await this.replaceSession(await SessionManager.open(file));
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    const messages: SnapshotMessage[] = [];
    for (const raw of this.session?.messages ?? []) {
      const m = raw as unknown as Record<string, unknown>;
      const role = str(m.role);
      if (role === "user") {
        messages.push({ role: "user", text: extractText(m.content) });
      } else if (role === "assistant") {
        const blocks = Array.isArray(m.content) ? m.content : [];
        const tools: SnapshotToolCall[] = [];
        for (const block of blocks as Record<string, unknown>[]) {
          if (block?.type === "toolCall" || block?.type === "tool_call" || block?.type === "toolUse") {
            tools.push({
              id: str(block.id) || crypto.randomUUID(),
              toolName: str(block.name ?? block.toolName) || "tool",
              args: block.arguments ?? block.args ?? block.input ?? null,
              output: "",
              isError: false,
            });
          }
        }
        messages.push({
          role: "assistant",
          text: extractText(m.content),
          thinking: extractThinking(blocks),
          tools: tools.length ? tools : undefined,
        });
      } else if (role === "toolResult" || role === "tool_result") {
        const toolCallId = str(m.toolCallId ?? m.tool_call_id);
        const text = extractText(m.content ?? m.output ?? m.result);
        const isError = Boolean(m.isError ?? m.is_error);
        for (const msg of messages) {
          for (const tool of msg.tools ?? []) {
            if (tool.id === toolCallId) {
              tool.output = text;
              tool.isError = isError;
            }
          }
        }
      }
    }
    return {
      file: this.sessionFilePath ?? "",
      id: this.session?.sessionId ?? "",
      messages,
    };
  }

  async startRun(params: {
    prompt: string;
    providerId?: string;
    modelId?: string;
    thinkingLevel?: string;
  }): Promise<string> {
    if (this.busy) throw Object.assign(new Error("已有任务在运行"), { code: "run_already_active" });
    if (!this.session) await this.newSession();
    const session = this.session!;
    const rt = await this.ensureModelRuntime();
    if (params.providerId && params.modelId) {
      const model = rt.getModel(params.providerId, params.modelId);
      if (!model) throw new Error(`未找到模型 ${params.providerId}/${params.modelId}`);
      if (session.model?.id !== model.id) await session.setModel(model);
    }
    if (params.thinkingLevel) {
      // 非 reasoning 模型上 pi 会拒绝，这里吞掉异常保持任务可跑
      try {
        session.setThinkingLevel(params.thinkingLevel as never);
      } catch {
        // 模型不支持思考强度时忽略
      }
    }
    const runId = crypto.randomUUID();
    this.activeRunId = runId;
    this.cancelRequested = false;
    this.unsubscribe?.();
    this.unsubscribe = session.subscribe((event) => this.onSessionEvent(runId, event as Record<string, unknown>));
    const finish = (reason: RunEndReason, error?: string) => {
      if (this.activeRunId !== runId) return;
      this.activeRunId = null;
      const payload: RunEndPayload = { runId, reason, ...(error ? { error } : {}) };
      this.emit("run.end", runId, payload);
    };
    void session
      .prompt(params.prompt)
      .then(() => {
        if (this.cancelRequested) return finish("aborted");
        // pi reports request failures as a terminal assistant message with
        // stopReason "error" instead of rejecting prompt().
        const messages = session.messages;
        const last = messages[messages.length - 1] as unknown as Record<string, unknown> | undefined;
        if (last && last.stopReason === "error") {
          finish("error", str(last.errorMessage) || "模型请求失败");
          return;
        }
        finish("completed");
      })
      .catch((err: unknown) =>
        finish(this.cancelRequested ? "aborted" : "error", err instanceof Error ? err.message : String(err)),
      );
    return runId;
  }

  /** 用系统默认方式打开文件或目录。 */
  async openPath(path: string, revealDir: boolean): Promise<void> {
    const target = nodePath.resolve(path);
    const open = revealDir
      ? spawn("xdg-open", [nodePath.dirname(target)], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [target], { detached: true, stdio: "ignore" });
    open.unref();
  }

  async statFile(path: string): Promise<{ sizeKb: number; modified: string }> {
    const { stat } = await import("node:fs/promises");
    const s = await stat(nodePath.resolve(path));
    return {
      sizeKb: Math.max(1, Math.round(s.size / 1024)),
      modified: s.mtime.toISOString(),
    };
  }

  /** 重命名会话（写入 session_info 条目，pi 列表以它为准）。 */
  async renameSession(file: string, title: string): Promise<void> {
    if (this.busy) throw Object.assign(new Error("运行中不能重命名会话"), { code: "run_already_active" });
    if (this.session && this.sessionFilePath === file) {
      this.session.sessionManager.appendSessionInfo(title);
    } else {
      SessionManager.open(file).appendSessionInfo(title);
    }
  }

  /**
   * 列出工作空间内可作为上下文引用的文件：相对 cwd、正斜杠、
   * 跳过隐藏条目与依赖/产物目录；超过上限置 truncated。
   */
  async listWorkspaceFiles(limit = 400): Promise<{
    cwd: string;
    files: { path: string }[];
    truncated: boolean;
  }> {
    const { readdir } = await import("node:fs/promises");
    const SKIP_DIRS = new Set([
      "node_modules", ".git", "dist", "build", "out", "target",
      ".next", ".venv", "venv", "__pycache__", ".cache", "coverage",
    ]);
    const files: { path: string }[] = [];
    let truncated = false;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (truncated || depth > 4) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= limit) {
          truncated = true;
          return;
        }
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(nodePath.join(dir, entry.name), depth + 1);
        } else if (entry.isFile()) {
          files.push({
            path: nodePath.relative(this.cwd, nodePath.join(dir, entry.name)).split(nodePath.sep).join("/"),
          });
        }
      }
    };
    await walk(this.cwd, 0);
    files.sort((a, b) => a.path.localeCompare(b.path));
    return { cwd: this.cwd, files, truncated };
  }

  /** 删除会话：仅允许删除应用会话目录内的文件。 */
  async deleteSession(file: string): Promise<void> {
    if (this.busy) throw Object.assign(new Error("运行中不能删除会话"), { code: "run_already_active" });
    const resolved = nodePath.resolve(file);
    const sessionsRoot = nodePath.join(this.agentDir, "sessions") + nodePath.sep;
    if (!resolved.startsWith(sessionsRoot)) throw new Error("路径不在会话目录内");
    if (this.session && this.sessionFilePath === resolved) {
      this.session.dispose();
      this.session = null;
      this.sessionFilePath = null;
    }
    await unlink(resolved);
  }

  /** 任务运行中排队下一条消息，当前任务结束后自动继续。 */
  async followUp(prompt: string): Promise<void> {
    if (!this.session || !this.activeRunId)
      throw Object.assign(new Error("没有正在运行的任务"), { code: "no_active_run" });
    await this.session.followUp(prompt);
  }

  /** 用 Key 调 OpenAI 兼容的 /models 接口拉取模型列表。 */
  async fetchRemoteModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const url = baseUrl.replace(/\/+$/, "") + "/models";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(`获取模型列表失败 (HTTP ${res.status})`);
    const data = (await res.json()) as { data?: { id?: string }[] };
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((x): x is string => typeof x === "string" && !!x);
  }

  async cancelRun(): Promise<void> {
    if (!this.activeRunId) throw Object.assign(new Error("没有正在运行的任务"), { code: "no_active_run" });
    this.cancelRequested = true;
    await this.session?.abort();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.session?.dispose();
    this.session = null;
    this.modelRuntime = null;
  }

  private onSessionEvent(runId: string, event: Record<string, unknown>): void {
    if (this.activeRunId !== runId) return;
    const type = str(event.type);
    if (type === "message_update") {
      const inner = event.assistantMessageEvent as Record<string, unknown> | undefined;
      const kind = str(inner?.type);
      if (kind === "text_delta") this.emit("message.delta", runId, { runId, delta: str(inner?.delta) });
      if (kind === "thinking_delta") this.emit("thinking.delta", runId, { runId, delta: str(inner?.delta) });
      return;
    }
    if (type === "tool_execution_start") {
      this.emit("tool.start", runId, {
        runId,
        toolId: str(event.toolId ?? event.toolCallId ?? event.callId) || crypto.randomUUID(),
        toolName: str(event.toolName ?? event.name) || "tool",
        args: event.args ?? event.input ?? null,
      });
      return;
    }
    if (type === "tool_execution_update") {
      this.emit("tool.update", runId, {
        runId,
        toolId: str(event.toolId ?? event.toolCallId ?? event.callId),
        partial: event.partialResult ?? event.partial ?? event.delta ?? null,
      });
      return;
    }
    if (type === "tool_execution_end") {
      this.emit("tool.end", runId, {
        runId,
        toolId: str(event.toolId ?? event.toolCallId ?? event.callId),
        isError: Boolean(event.isError),
        output: event.output ?? event.result ?? null,
      });
      return;
    }
    if (type === "turn_end") {
      this.emit("turn.end", runId, { runId });
    }
    if (type === "agent_start") {
      this.emit("agent.start", runId, { runId });
    }
  }

  private async replaceSession(manager: SessionManager): Promise<void> {
    if (this.busy) throw Object.assign(new Error("运行中不能切换会话"), { code: "run_already_active" });
    this.unsubscribe?.();
    this.session?.dispose();
    const loader = new DefaultResourceLoader({
      cwd: this.cwd,
      agentDir: this.agentDir,
      systemPrompt: SYSTEM_PROMPT,
    });
    await loader.reload();
    const { session } = await createAgentSession({
      sessionManager: manager,
      modelRuntime: await this.ensureModelRuntime(),
      cwd: this.cwd,
      agentDir: this.agentDir,
      resourceLoader: loader,
    });
    this.session = session;
    this.sessionFilePath = session.sessionFile ?? null;
  }

  private async availableModelKeys(rt: ModelRuntime): Promise<Set<string>> {
    const getAvailable = (rt as unknown as { getAvailable?: () => Promise<unknown[]> }).getAvailable;
    const keys = new Set<string>();
    if (typeof getAvailable !== "function") return keys;
    try {
      for (const item of (await getAvailable.call(rt)) as Record<string, unknown>[]) {
        const provider = item?.provider;
        const providerId = typeof provider === "string" ? provider : str((provider as Record<string, unknown>)?.id);
        if (providerId && item?.id) keys.add(`${providerId}:${str(item.id)}`);
        if (providerId) keys.add(`${providerId}:*`);
      }
    } catch {
      // Availability probing is best-effort for the settings UI.
    }
    return keys;
  }

  private async describeProvider(
    rt: ModelRuntime,
    id: string,
    name: string,
    origin: CatalogProvider["origin"],
    available: Set<string>,
  ): Promise<CatalogProvider> {
    const raw = rt.getModels(id) as unknown as Record<string, unknown>[];
    const models = raw.map((m) => toCatalogModel(m, str(m.id)));
    const auth = models.some((m) => available.has(`${id}:${m.id}`)) || available.has(`${id}:*`) ? "ready" : "missing";
    return { id, name, origin, auth, models };
  }

  private async readCustomProviders(): Promise<Record<string, unknown>[]> {
    try {
      const raw = await readFile(nodePath.join(this.agentDir, "models.json"), "utf8");
      const parsed = JSON.parse(raw) as { providers?: Record<string, Record<string, unknown>> };
      return Object.entries(parsed.providers ?? {}).map(([id, cfg]) => ({ id, ...cfg }));
    } catch {
      return [];
    }
  }
}

function toCatalogModel(raw: Record<string, unknown>, fallbackId: string): CatalogModel {
  return {
    id: str(raw.id) || fallbackId,
    name: str(raw.name) || str(raw.id) || fallbackId,
    reasoning: Boolean(raw.reasoning),
    contextWindow: num(raw.contextWindow) ?? 0,
    maxTokens: num(raw.maxTokens) ?? 0,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const b = block as Record<string, unknown>;
      return b?.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .filter(Boolean)
    .join("");
}

function extractThinking(blocks: unknown[]): string | undefined {
  const text = blocks
    .map((block) => {
      const b = block as Record<string, unknown>;
      return (b?.type === "thinking" || b?.type === "reasoning") && typeof b.thinking === "string"
        ? b.thinking
        : typeof b?.text === "string" && (b?.type === "thinking" || b?.type === "reasoning")
          ? b.text
          : "";
    })
    .filter(Boolean)
    .join("");
  return text || undefined;
}
