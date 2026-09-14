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

const SYSTEM_PROMPT = `你是 GoHomeBuddy（中文名：下班搭子），运行在用户桌面上的个人智能助手。

- 始终用用户使用的语言回复（默认中文）。
- 你可以读取和修改用户工作目录中的文件、执行命令、搜索内容；做重要改动前先用一句话说明你要做什么。
- 专注当前任务：不要浏览或读取与任务无关的目录（如技能目录、系统配置、工作目录之外的位置）。
- 多步任务连续执行，不要每一步都停下来询问；遇到报错先自行修复再继续。
- 回答简洁直接，少说客套话；代码块标注语言；列出文件时给出相对路径。
- 不主动提及你底层使用的框架、引擎或模型名称，你的名字是 GoHomeBuddy（下班搭子）。`;

/** Built-in providers surfaced in the settings UI; everything else stays reachable via custom models.json. */
/**
 * 厂商预设：只提供名称 / Base URL / 协议，不再自带模型清单。
 * 所有模型都由「检测模型」或手动输入得到，并写入应用管理的模型配置。
 */
const CURATED_PROVIDERS: { id: string; name: string; baseUrl: string; api: string }[] = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" },
  { id: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", api: "openai-completions" },
  { id: "zai", name: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4", api: "openai-completions" },
  { id: "zai-coding-cn", name: "Z.ai Coding (CN)", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", api: "openai-completions" },
];

export type RuntimeEmitter = (type: string, runId: string | undefined, payload: unknown) => void;

export class PiRuntime {
  private readonly agentDir: string;
  private cwd: string;
  private readonly defaultCwd: string;
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
    this.defaultCwd = options.cwd;
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
    const appManaged = await this.readCustomProviders();
    // 预设不再读引擎内置目录：模型清单只来自应用管理的配置。
    for (const curated of CURATED_PROVIDERS) {
      const entry = appManaged.find((p) => String(p.id) === curated.id);
      const rawModels = Array.isArray(entry?.models) ? (entry!.models as Record<string, unknown>[]) : [];
      const models = rawModels.map((m) => toCatalogModel(m, str(m.id)));
      providers.push({
        id: curated.id,
        name: typeof entry?.name === "string" && entry.name ? entry.name : curated.name,
        origin: "builtin",
        baseUrl: typeof entry?.baseUrl === "string" && entry.baseUrl ? entry.baseUrl : curated.baseUrl,
        auth:
          models.length > 0 &&
          (models.some((m) => available.has(`${curated.id}:${m.id}`)) || available.has(`${curated.id}:*`))
            ? "ready"
            : "missing",
        models,
      });
    }
    for (const custom of appManaged) {
      if (CURATED_PROVIDERS.some((p) => p.id === String(custom.id))) continue;
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
          title: str(item.name) || sanitizeFallbackTitle(str(item.firstMessage)) || "未命名会话",
          modified: modified || new Date(0).toISOString(),
          messageCount: num(item.messageCount) ?? 0,
        } satisfies SessionSummary;
      })
      .filter((s): s is SessionSummary => s !== null)
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  async newSession(cwd?: string): Promise<{ file: string; id: string; cwd: string }> {
    if (cwd) this.cwd = nodePath.resolve(cwd);
    await this.replaceSession(await SessionManager.create(this.cwd));
    return { file: this.sessionFilePath ?? "", id: this.session?.sessionId ?? "", cwd: this.cwd };
  }

  async openSession(file: string, cwd?: string): Promise<SessionSnapshot> {
    if (cwd) this.cwd = nodePath.resolve(cwd);
    await this.replaceSession(await SessionManager.open(file));
    return this.snapshot();
  }

  async setSessionCwd(cwd?: string): Promise<void> {
    if (this.busy) throw Object.assign(new Error("运行中不能切换工作空间"), { code: "run_already_active" });
    this.cwd = cwd ? nodePath.resolve(cwd) : this.defaultCwd;
    if (this.session) {
      const manager = this.session.sessionManager;
      await this.replaceSession(manager);
    }
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
        const usage = (m as { usage?: { totalTokens?: number } }).usage;
        messages.push({
          role: "assistant",
          text: extractText(m.content),
          thinking: extractThinking(blocks),
          tools: tools.length ? tools : undefined,
          tokens: num(usage?.totalTokens),
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
    permissionMode?: string;
    sessionTitle?: string;
  }): Promise<string> {
    if (this.busy) throw Object.assign(new Error("已有任务在运行"), { code: "run_already_active" });
    if (!this.session) await this.newSession();
    const session = this.session!;
    // 标题只在会话尚无消息时写入一次；手动重命名走 renameSession，优先级更高。
    if (params.sessionTitle && (session.messages as unknown[]).length === 0) {
      try {
        session.sessionManager.appendSessionInfo(params.sessionTitle);
      } catch {
        // 标题写入失败不应阻断任务
      }
    }
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
    // 本次 run 的 token 用量：统计 prompt 之后新增消息的 usage 汇总
    const msgCountBefore = (session.messages as unknown[]).length;
    const finish = (reason: RunEndReason, error?: string) => {
      if (this.activeRunId !== runId) return;
      this.activeRunId = null;
      let tokens: RunEndPayload["tokens"];
      try {
        const added = (session.messages as unknown[]).slice(msgCountBefore);
        const t = { input: 0, output: 0, total: 0 };
        for (const m of added) {
          const u = (m as { usage?: { input?: number; output?: number; totalTokens?: number } }).usage;
          if (u) {
            t.input += u.input ?? 0;
            t.output += u.output ?? 0;
            t.total += u.totalTokens ?? 0;
          }
        }
        if (t.total > 0) tokens = t;
      } catch {
        // 用量统计失败不影响任务结果
      }
      const payload: RunEndPayload = { runId, reason, ...(tokens ? { tokens } : {}), ...(error ? { error } : {}) };
      this.emit("run.end", runId, payload);
    };
    void session
      .prompt(this.withPermissionDirective(params.permissionMode, params.prompt))
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

  /**
   * 导入用户系统文件：base64 内容落到工作空间 .attachments/ 下（文件名净化、
   * 50MB 上限），返回工作空间相对路径，供引擎按路径读取。
   */
  async importFile(name: string, dataBase64: string): Promise<{ path: string; name: string }> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const clean =
      nodePath
        .basename(name)
        .replace(/[^\p{L}\p{N}._-]+/gu, "_")
        .slice(0, 120) || "file";
    const buf = Buffer.from(dataBase64, "base64");
    if (buf.length === 0) throw new Error("附件内容为空");
    if (buf.length > 50 * 1024 * 1024) throw new Error("附件超过 50MB 上限");
    const dir = nodePath.join(this.cwd, ".attachments");
    await mkdir(dir, { recursive: true });
    // 重名自动加序号，保持文件名干净（展示直接用原名）
    const ext = nodePath.extname(clean);
    const base = clean.slice(0, clean.length - ext.length) || "file";
    let fileName = clean;
    let i = 1;
    while (
      await import("node:fs/promises")
        .then((m) => m.stat(nodePath.join(dir, fileName)))
        .then(() => true)
        .catch(() => false)
    ) {
      fileName = `${base}-${i++}${ext}`;
    }
    await writeFile(nodePath.join(dir, fileName), buf);
    return {
      path: nodePath.relative(this.cwd, nodePath.join(dir, fileName)).split(nodePath.sep).join("/"),
      name: clean,
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
  async fetchRemoteModels(baseUrl: string, apiKey: string, providerId?: string): Promise<string[]> {
    // 已配置过的厂商允许复用本机密钥重新检测，不必重输 Key。
    let token = apiKey.trim();
    if (!token && providerId) {
      try {
        const authPath = nodePath.join(this.agentDir, "auth.json");
        const data = JSON.parse(await readFile(authPath, "utf8")) as Record<string, { key?: string }>;
        token = data[providerId]?.key ?? "";
      } catch {
        token = "";
      }
    }
    const url = baseUrl.replace(/\/+$/, "") + "/models";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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

  /** 按权限档位生成注入 prompt 的行为指令（提示词级约束；引擎尚无硬审批钩子）。 */
  private withPermissionDirective(mode: string | undefined, prompt: string): string {
    const directives: Record<string, string> = {
      ask: "[权限模式：变更前确认] 只能直接执行读取、查看、搜索类操作；创建、修改、删除文件和执行任何命令前，必须先说明具体操作内容并等待用户回复确认，未经确认不得执行。",
      auto_edit:
        "[权限模式：自动编辑] 可以直接创建和修改工作空间内的文件；执行命令前先用一句话说明要做什么；不得删除文件或执行与任务无关的命令。",
      full_access:
        "[权限模式：完全访问] 直接执行完成任务所需的全部本地操作，无需逐步确认；保持操作与任务相关，不做破坏性清理。",
    };
    const directive = mode ? directives[mode] : undefined;
    return directive ? `${directive}\n\n${prompt}` : prompt;
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
    // 能力元数据由模型配置提供；缺省即未知，界面按不支持处理。
    ...(Array.isArray(raw.thinkingLevels)
      ? { thinkingLevels: raw.thinkingLevels.map((x) => str(x)).filter(Boolean) }
      : {}),
    ...(typeof raw.multimodal === "boolean" ? { multimodal: raw.multimodal } : {}),
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

/**
 * 旧会话没有显式标题时用 firstMessage 兜底，但历史数据里可能混入
 * `[权限模式：…]` 这类内部指令前缀，这里先剥离再截断。
 */
function sanitizeFallbackTitle(raw: string): string {
  // 只剥离已知的内部指令整行（历史数据形如 `[权限模式：…] <说明>`），
  // 不碰用户自己以方括号开头的正常提问。
  const withoutDirective = raw.replace(/^\s*\[权限模式：[^\n]*\n?/, "");
  // 附件引用块拼在 Prompt 末尾，同样属于内部上下文，从出现处截断。
  const cut = withoutDirective.indexOf("[引用工作空间文件");
  const withoutRefs = cut >= 0 ? withoutDirective.slice(0, cut) : withoutDirective;
  return withoutRefs.replace(/\s+/g, " ").trim().slice(0, 40);
}
