import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Folder,
  Layers2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Square,
  Trash2,
} from "lucide-react";
import { marked } from "marked";
import { kindFromPath, ArtifactCard } from "./components/ArtifactCard";
import { ActivityTimeline } from "./components/ActivityTimeline";
import { StreamingMarkdown } from "./components/StreamingMarkdown";
import type { Artifact, CatalogProvider, ModelProfile, ProtocolEvent, ToolStep } from "@office/contracts";
import { Button } from "./components/Button";
import { Composer, UNGROUPED, type WorkspaceOption } from "./components/Composer";
import { ModelMenu } from "./components/ModelMenu";
import { Settings, type Theme } from "./components/Settings";
import { WindowControls } from "./components/WindowControls";
import { previewClient } from "./lib/preview-client";
import {
  ProtocolClient,
  extractPath,
  THINKING_LEVELS,
  toolKind,
  toolLabel,
  toolOutputText,
  toolTarget,
  type ConnectionStatus,
  type ModelSelection,
  type PermissionMode,
} from "./lib/protocol-client";



export function App() {
  const [mode, setMode] = useState<ConnectionStatus>("connecting");
  const client = useRef(new ProtocolClient());
  const [handshake, setHandshake] = useState<Awaited<ReturnType<typeof client.current.connect>> | null>(null);
  const [providers, setProviders] = useState<CatalogProvider[]>([]);

  const [sessions, setSessions] = useState<UiSession[]>([newBlank()]);
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(() =>
    load("office.workspaces", []),
  );
  const [groups, setGroups] = useState<Record<string, string>>(() =>
    load("office.sessionGroups", {}),
  );
  const [draftGroup, setDraftGroup] = useState<string>(() => load("office.lastGroup", UNGROUPED));
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    load<PermissionMode>("office.permissionMode", "ask"),
  );
  const [showJump, setShowJump] = useState(false);

  const [active, setActive] = useState(""),
    [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [settings, setSettings] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [copied, setCopied] = useState("");
  const [collapsedWs, setCollapsedWs] = useState<string[]>([]);
  const [menu, setMenu] = useState<
    | { kind: "session"; id: string; move?: boolean; newWs?: boolean; rename?: boolean }
    | { kind: "workspace"; id: string; rename?: boolean }
    | null
  >(null);
  const [wsForm, setWsForm] = useState(false);
  const [wsFormName, setWsFormName] = useState("");

  const [theme, setTheme] = useState<Theme>(() => load("office.theme", "light"));
  const [profile] = useState<ModelProfile>(() =>
    load("office.profile", {
      provider: "deepseek",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com",
      modelId: "",
    }),
  );
  const [selection, setSelection] = useState<ModelSelection>(() =>
    load<ModelSelection>("office.selection", {
      providerId: "deepseek",
      providerName: "DeepSeek",
      modelId: "",
    }),
  );
  const [running, setRunning] = useState<string | null>(null);
  // 服务端 runId 与本地流式消息 id 不同源；事件按此映射投影到界面
  const runTargets = useRef(new Map<string, string>());
  const pendingQueue = useRef(new Map<string, string[]>());
  const activeRun = useRef<{ runId: string; sessionId: string } | null>(null);
  const openingSessions = useRef(new Set<string>());
  const controller = useRef<AbortController | null>(null),
    viewport = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    input = useRef<HTMLTextAreaElement>(null);
  const session = sessions.find((s) => s.id === active) ?? sessions[0];

  const refreshSessions = useCallback(async () => {
    if (!client.current.connected) return;
    try {
      const list = (await client.current.request("session.list")) as {
        file: string;
        title: string;
        modified: string;
        messageCount: number;
      }[];
      setSessions((prev) => {
        const kept = prev.filter((s) => s.listed !== false || s.messages.length > 0);
        const byFile = new Map(list.map((s) => [s.file, s]));
        const merged: UiSession[] = [];
        const seen = new Set<string>();
        for (const s of kept) {
          const info = s.file ? byFile.get(s.file) : undefined;
          if (info) seen.add(info.file);
          merged.push({
            ...s,
            title: info?.title ?? s.title,
            modified: info?.modified ?? s.modified,
          });
        }
        for (const info of list) {
          if (seen.has(info.file)) continue;
          merged.push({
            id: info.file,
            file: info.file,
            title: info.title,
            messages: [],
            loaded: false,
            listed: true,
            modified: info.modified,
          });
        }
        // 界面永远保留至少一个可输入的空白会话
        return merged.length ? merged : [newBlank()];
      });
    } catch {
      // 列表刷新失败不打断使用
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hs = await client.current.connect();
        if (cancelled) return;
        setHandshake(hs);
        setMode("live");
        await refreshSessions();
        try {
          setProviders(
            (await client.current.request("config.providers")) as CatalogProvider[],
          );
        } catch {
          // 目录拉取失败不阻塞使用
        }
      } catch {
        if (cancelled) return;
        setMode("preview");
        const stored = load<UiSession[]>("office.sessions", []).map((s) => ({
          ...s,
          listed: true as const,
        }));
        if (stored.length) setSessions(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshSessions]);

  useEffect(() => {
    return client.current.onEvent((event: ProtocolEvent) => {
      const runId = (event.payload as { runId?: string } | undefined)?.runId;
      const messageId = runId ? runTargets.current.get(runId) : undefined;
      // 排队的消息在新一轮 agent 开始时接管事件流
      if (event.type === "agent.start" && runId) {
        const next = pendingQueue.current.get(runId);
        if (next && next.length) {
          const mid = next.shift()!;
          if (next.length === 0) pendingQueue.current.delete(runId);
          runTargets.current.set(runId, mid);
        }
      }
      if (event.type !== "log" && messageId) {
        setSessions((all) =>
          all.map((s) => {
            if (!s.messages.some((m) => m.id === messageId)) return s;
            return { ...s, messages: s.messages.map((m) => applyEvent(m, messageId, event)) };
          }),
        );
      }
      if (event.type === "run.end") {
        if (runId) {
          runTargets.current.delete(runId);
          pendingQueue.current.delete(runId);
          if (activeRun.current?.runId === runId) activeRun.current = null;
        }
        setRunning(null);
        void refreshSessions();
      }
    });
  }, [refreshSessions]);

  useEffect(() => {
    if (mode === "preview") localStorage.setItem("office.sessions", JSON.stringify(sessions));
  }, [sessions, mode]);
  useEffect(() => {
    localStorage.setItem("office.workspaces", JSON.stringify(workspaces));
    localStorage.setItem("office.sessionGroups", JSON.stringify(groups));
    localStorage.setItem("office.lastGroup", JSON.stringify(draftGroup));
    localStorage.setItem("office.permissionMode", JSON.stringify(permissionMode));
  }, [workspaces, groups, draftGroup, permissionMode]);
  useEffect(() => {
    localStorage.setItem("office.theme", JSON.stringify(theme));
    const m = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === "system" ? (m.matches ? "dark" : "light") : theme);
    apply();
    m.addEventListener("change", apply);
    return () => m.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    // 跟随滚动：内容任何变化（流式增量、工具行、产物卡、过程折叠）都把视图钉在底部，
    // 用户上滚后交出控制权。ResizeObserver 覆盖依赖数组抓不到的"同一条消息长高"。
    const el = viewport.current;
    if (!el) return;
    const pin = () => {
      if (follow.current)
        el.scrollTop = session.messages.length ? el.scrollHeight : 0;
    };
    pin();
    const ro = new ResizeObserver(pin);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, session.id, session.messages.length]);
  useEffect(() => () => controller.current?.abort(), []);
  useWindowDrag();

  function create() {
    const blank = newBlank();
    setSessions((all) => [blank, ...all.filter((s) => s.listed !== false || s.messages.length > 0)]);
    setActive(blank.id);
    setDraft("");
    setMenu(null);
    follow.current = true;
    input.current?.focus();
  }

  function update(id: string, fn: (s: UiSession) => UiSession) {
    setSessions((all) => all.map((s) => (s.id === id ? fn(s) : s)));
  }

  function createWorkspace(name: string): string {
    const ws = { id: `ws-${crypto.randomUUID().slice(0, 8)}`, name };
    setWorkspaces((all) => [...all, ws]);
    return ws.id;
  }

  function deleteWorkspace(wsId: string) {
    setWorkspaces((all) => all.filter((w) => w.id !== wsId));
    setGroups((g) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(g)) if (v !== wsId) next[k] = v;
      return next;
    });
    if (draftGroup === wsId) setDraftGroup(UNGROUPED);
  }

  async function openSession(target: UiSession) {
    setActive(target.id);
    setMenu(null);
    follow.current = true;
    if (mode === "live" && target.file && !target.loaded) {
      // 同一会话的打开请求不重复上wire：快速双击会让两个快照请求并发
      if (openingSessions.current.has(target.file)) return;
      openingSessions.current.add(target.file);
      try {
        const snap = (await client.current.request("session.open", { file: target.file })) as {
          messages: {
            role: string;
            text: string;
            thinking?: string;
            tools?: { id: string; toolName: string; args: unknown; output: string; isError: boolean }[];
          }[];
        };
        update(target.id, (s) => ({
          ...s,
          loaded: true,
          messages: projectSnapshotMessages(snap.messages),
        }));
      } catch {
        // 加载失败保留空会话
      } finally {
        openingSessions.current.delete(target.file);
      }
    }
  }

  async function send(override?: string) {
    const raw = override ?? draft;
    if (!raw.trim()) return;
    // 只能在当前正在运行的会话里排队
    if (running && running !== session.id) return;
    const queueing = mode === "live" && running === session.id;
    const text = raw.trim(),
      id = session.id;
    const mid = crypto.randomUUID();
    setDraft("");
    follow.current = true;
    update(id, (s) => ({
      ...s,
      listed: true,
      title: s.messages.length ? s.title : text.slice(0, 24),
      loaded: true,
      messages: [
        ...s.messages,
        { id: crypto.randomUUID(), role: "user", activities: [{ kind: "text" as const, id: crypto.randomUUID(), text }], runStatus: "completed" as const },
        {
          id: mid,
          role: "assistant",
          activities: [],
          runStartedAt: Date.now(),
          runStatus: "running",
          prompt: text,
        },
      ],
    }));
    setActive(id);
    if (mode === "live") {
      if (queueing && activeRun.current) {
        // 排队：立即上屏，当前任务结束后自动继续
        const q = pendingQueue.current.get(activeRun.current.runId) ?? [];
        q.push(mid);
        pendingQueue.current.set(activeRun.current.runId, q);
        try {
          await client.current.request("run.followUp", { prompt: text });
        } catch (err) {
          pendingQueue.current.set(activeRun.current.runId, q.filter((x) => x !== mid));
          update(id, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === mid
                ? { ...m, error: err instanceof Error ? err.message : "排队失败" }
                : m,
            ),
          }));
        }
        return;
      }
      setRunning(id);
      // 新会话在首条消息时落到所选工作空间
      const target = sessions.find((s) => s.id === id);
      if (!target?.file) {
        try {
          const created = (await client.current.request("session.new")) as { file: string };
          update(id, (s) => ({ ...s, file: created.file, id: created.file, listed: true }));
          setActive(created.file);
          if (draftGroup !== UNGROUPED) {
            setGroups((g) => ({ ...g, [created.file]: draftGroup }));
          }
        } catch (err) {
          update(id, (s) => ({
            ...s,
            messages: s.messages.map((m) =>
              m.id === mid
                ? {
                    ...m,
                    error: friendlyError(
                      err instanceof Error ? err.message : "创建会话失败",
                    ),
                    runStatus: "failed",
                  }
                : m,
            ),
          }));
          setRunning(null);
          return;
        }
      }
      try {
        // run.start 的 payload 就是 runId 字符串本身
        const started = await client.current.request("run.start", {
          prompt: text,
          providerId: selection.providerId || undefined,
          modelId: selection.modelId || undefined,
          thinkingLevel: effectiveThinking,
        });
        const runId = typeof started === "string" ? started : (started as { runId?: string })?.runId;
        if (runId) {
          runTargets.current.set(runId, mid);
          activeRun.current = { runId, sessionId: created_file_guard(id) ? id : id };
        }
      } catch (err) {
        update(id, (s) => ({
          ...s,
          messages: s.messages.map((m) =>
            m.id === mid
              ? {
                  ...m,
                  error: friendlyError(
                    err instanceof Error ? err.message : "任务启动失败",
                  ),
                  runStatus: "failed",
                }
              : m,
          ),
        }));
        setRunning(null);
      }
      return;
    }
    // 预览模式
    if (draftGroup !== UNGROUPED) setGroups((g) => ({ ...g, [id]: draftGroup }));
    const abort = new AbortController();
    controller.current = abort;
    setRunning(id);
    const put = (step: ToolStep) =>
      update(id, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id !== mid
            ? m
            : {
                ...m,
                activities: [
                  ...m.activities,
                  { kind: "tool" as const, id: step.id, step },
                ],
              },
        ),
      }));
    try {
      const result = await previewClient.run(text, abort.signal, put);
      update(id, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === mid
            ? {
                ...m,
                activities: [
                  ...m.activities,
                  { kind: "text" as const, id: crypto.randomUUID(), text: result },
                ],
              }
            : m,
        ),
      }));
    } catch {
      update(id, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
          m.id === mid
            ? {
                ...m,
                activities: [
                  ...m.activities.filter((a) => !(a.kind === "tool" && a.step.status === "running")),
                  { kind: "text" as const, id: crypto.randomUUID(), text: "演示已停止。没有文件被修改。" },
                ],
              }
            : m,
        ),
      }));
    } finally {
      setRunning(null);
      controller.current = null;
    }
  }

  function created_file_guard(_id: string) {
    return true;
  }

  async function copy(id: string, text: string) {
    try {
      const html = marked.parse(text) as string;
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      setCopied(id);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  }

  const isLive = mode === "live";
  const visible = sessions.filter(
    (s) => s.listed !== false && s.title.toLowerCase().includes(query.toLowerCase()),
  );
  const wsItems = (wsId: string) => visible.filter((s) => groups[s.id] === wsId);
  const ungrouped = visible.filter((s) => !groups[s.id]);
  const empty = session.messages.length === 0;
  const supportsReasoning = isLive
    ? (providers
        .find((p) => p.id === selection.providerId)
        ?.models.find((m) => m.id === selection.modelId)?.reasoning ?? false)
    : false;
  const effectiveThinking = supportsReasoning ? selection.thinkingLevel ?? "medium" : undefined;

  const composerCommon = {
    draft,
    onDraft: setDraft,
    onSend: () => void send(),
    running: running === session.id,
    onStop: () => {
      if (isLive) void client.current.request("run.cancel").catch(() => {});
      else controller.current?.abort();
    },
    workspaces,
    draftGroup,
    onDraftGroup: setDraftGroup,
    onCreateGroup: createWorkspace,
    permissionMode,
    onPermissionMode: setPermissionMode,
    providers,
    selection,
    onSelectModel: setSelection,
    onOpenSettings: () => setSettings(true),
    supportsReasoning,
    thinkingLevel: effectiveThinking,
    onThinkingLevel: setSelection_Thinking,
  };

  function setSelection_Thinking(v: string) {
    setSelection((s) => ({ ...s, thinkingLevel: v }));
  }

  function sessionRow(s: UiSession, indent?: boolean) {
    const menuOpen = menu?.kind === "session" && menu.id === s.id;
    const grouped = groups[s.id];
    return (
      <div className={"session-row" + (indent ? " indent" : "") + (session.id === s.id ? " active" : "")} key={s.id}>
        <button className="session-main" onClick={() => void openSession(s)}>
          <MessageSquare size={15} />
          <span>{s.title}</span>
          {running === s.id && <i className="live-dot" />}
          {s.modified && <em>{relTime(s.modified)}</em>}
        </button>
        <button
          className="row-menu-btn"
          aria-label="会话操作"
          onClick={(e) => {
            e.stopPropagation();
            setMenu(menuOpen ? null : { kind: "session", id: s.id });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
        {menuOpen && menu?.kind === "session" && (
          <div className="session-menu row-menu">
            {menu.newWs ? (
              <MenuInput
                placeholder="工作空间名称"
                onConfirm={(name) => {
                  const wsId = createWorkspace(name);
                  setGroups((g) => ({ ...g, [s.id]: wsId }));
                  setMenu(null);
                }}
                onCancel={() => setMenu({ kind: "session", id: s.id, move: true })}
              />
            ) : menu.rename ? (
              <MenuInput
                initial={s.title}
                placeholder="会话名称"
                onConfirm={(title) => {
                  update(s.id, (x) => ({ ...x, title }));
                  if (isLive && s.file) {
                    void client.current
                      .request("session.rename", { file: s.file, title })
                      .then(() => refreshSessions())
                      .catch(() => {});
                  }
                  setMenu(null);
                }}
                onCancel={() => setMenu(null)}
              />
            ) : menu.move ? (
              <>
                {grouped && (
                  <button onClick={() => {
                    setGroups((g) => {
                      const next = { ...g };
                      delete next[s.id];
                      return next;
                    });
                    setMenu(null);
                  }}>
                    未分组
                  </button>
                )}
                {workspaces
                  .filter((w) => w.id !== grouped)
                  .map((w) => (
                    <button key={w.id} onClick={() => {
                      setGroups((g) => ({ ...g, [s.id]: w.id }));
                      setMenu(null);
                    }}>
                      {w.name}
                    </button>
                  ))}
                <button onClick={() => setMenu({ kind: "session", id: s.id, newWs: true })}>
                  <Plus size={13} /> 新建工作空间
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setMenu({ kind: "session", id: s.id, rename: true })}>
                  <Pencil size={13} /> 重命名
                </button>
                <button onClick={() => setMenu({ kind: "session", id: s.id, move: true })}>
                  <Folder size={13} /> 移动到工作空间
                </button>
                <button
                  onClick={() => {
                    if (!window.confirm("删除这个会话？")) {
                      setMenu(null);
                      return;
                    }
                    if (isLive && s.file) {
                      void client.current
                        .request("session.delete", { file: s.file })
                        .catch(() => {});
                    }
                    setSessions((all) => {
                      const rest = all.filter((x) => x.id !== s.id);
                      return rest.length ? rest : [newBlank()];
                    });
                    if (active === s.id) setActive("");
                    setMenu(null);
                  }}
                >
                  <Trash2 size={13} /> 删除
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={"app " + (collapsed ? "sidebar-collapsed" : "")}>
      {menu && <div className="menu-overlay" onClick={() => setMenu(null)} />}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Layers2 size={20} />
          </div>
          <span>
            Office<span className="brand-light"> Agent</span>
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="收起侧栏"
            onClick={() => setCollapsed(true)}
          >
            <PanelLeftClose size={17} />
          </Button>
        </div>
        <Button className="new-chat" onClick={create}>
          <Plus size={17} />
          新建会话<span>＋</span>
        </Button>
        <div className="search-box">
          <Search size={15} />
          <input
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="ws-anchor">
          <div className="section-label">
            工作空间
            <button aria-label="新建工作空间" onClick={() => setWsForm(!wsForm)}>
              <Plus size={13} />
            </button>
          </div>
          {wsForm && (
            <>
              <div className="menu-overlay" onClick={() => setWsForm(false)} />
              <div className="session-menu ws-pop">
                <input
                  autoFocus
                  placeholder="工作空间名称"
                  value={wsFormName}
                  onChange={(e) => setWsFormName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && wsFormName.trim()) {
                      createWorkspace(wsFormName.trim());
                      setWsFormName("");
                      setWsForm(false);
                    }
                    if (e.key === "Escape") {
                      setWsFormName("");
                      setWsForm(false);
                    }
                  }}
                />
                <div className="ws-pop-actions">
                  <button
                    className="ws-cancel"
                    onClick={() => {
                      setWsFormName("");
                      setWsForm(false);
                    }}
                  >
                    取消
                  </button>
                  <button
                    className="ws-confirm"
                    disabled={!wsFormName.trim()}
                    onClick={() => {
                      if (wsFormName.trim()) {
                        createWorkspace(wsFormName.trim());
                        setWsFormName("");
                        setWsForm(false);
                      }
                    }}
                  >
                    创建
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        <nav className="session-list">
          {mode === "connecting" && (
            <>
              <div className="session-skeleton">
                <i />
                <i />
              </div>
              <div className="session-skeleton">
                <i />
                <i />
              </div>
            </>
          )}
          {workspaces.map((w) => {
            const items = wsItems(w.id);
            const fold = collapsedWs.includes(w.id);
            const wsMenuOpen = menu?.kind === "workspace" && menu.id === w.id;
            return (
              <div key={w.id}>
                <div className="session-row ws-row">
                  <button
                    className="session-main ws-main"
                    onClick={() =>
                      setCollapsedWs((all) =>
                        all.includes(w.id) ? all.filter((x) => x !== w.id) : [...all, w.id],
                      )
                    }
                  >
                    {fold ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <Folder size={14} />
                    <span>{w.name}</span>
                    <em>{items.length}</em>
                  </button>
                  <button
                    className="row-menu-btn"
                    aria-label="工作空间操作"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu(wsMenuOpen ? null : { kind: "workspace", id: w.id });
                    }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {wsMenuOpen && menu?.kind === "workspace" && (
                    <div className="session-menu row-menu">
                      {menu.rename ? (
                        <MenuInput
                          initial={w.name}
                          placeholder="工作空间名称"
                          onConfirm={(name) => {
                            setWorkspaces((all) =>
                              all.map((x) => (x.id === w.id ? { ...x, name } : x)),
                            );
                            setMenu(null);
                          }}
                          onCancel={() => setMenu(null)}
                        />
                      ) : (
                        <>
                          <button
                            onClick={() => setMenu({ kind: "workspace", id: w.id, rename: true })}
                          >
                            <Pencil size={13} /> 重命名
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`删除工作空间“${w.name}”？会话会回到未分组。`)) {
                                deleteWorkspace(w.id);
                              }
                              setMenu(null);
                            }}
                          >
                            <Trash2 size={13} /> 删除工作空间
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {!fold && items.map((s) => sessionRow(s, true))}
              </div>
            );
          })}

          <div className="section-label in-list">
            会话 <span>{ungrouped.length}</span>
          </div>
          {ungrouped.map((s) => sessionRow(s))}
          {query && !visible.length && <p className="no-results">没有找到相关会话</p>}
        </nav>

        <div className="sidebar-bottom">
          <button className="settings-link" onClick={() => setSettings(true)}>
            <Settings2 size={17} />
            设置
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar" data-tauri-drag-region>
          <div className="topbar-left" data-tauri-drag-region>
            {(() => {
              const last = [...session.messages].reverse().find((x) => x.role === "assistant");
              if (running === session.id) {
                const startedAt = last?.runStartedAt ?? Date.now();
                return (
                  <span className="run-state running">
                    ● 工作中
                    <RunSeconds startedAt={startedAt} />
                  </span>
                );
              }
              if (!last) return null;
              if (last.runStatus === "failed" || last.error)
                return <span className="run-state failed">✕ 失败</span>;
              if (last.runStatus === "stopped")
                return <span className="run-state stopped">■ 已停止</span>;
              if (last.runStatus === "completed")
                return (
                  <span className="run-state done">
                    ✓ 已完成{last.runDurationSec ? ` · ${fmtDuration(last.runDurationSec)}` : ""}
                  </span>
                );
              return null;
            })()}
            {collapsed && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="展开侧栏"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen size={17} />
              </Button>
            )}
            {!empty && <span data-tauri-drag-region>{session.title}</span>}
            <span
              className={"status-dot " + mode}
              title={mode === "live" ? "已连接本地引擎" : mode === "preview" ? "预览模式" : "连接中"}
            />
            {mode === "preview" && <span className="preview-label">预览</span>}
          </div>
          <div className="topbar-drag" data-tauri-drag-region />
          <div className="topbar-right">
            <WindowControls />
          </div>
        </header>

        {empty ? (
          <div className="hero">
            <div className="hero-mark">
              <Layers2 size={30} strokeWidth={1.4} />
            </div>
            <h1>{greeting()}</h1>
            <Composer
              {...composerCommon}
              hero
              showGroupSelector
              placeholder={mode === "connecting" ? "正在连接本地运行时…" : "描述任务，Enter 发送"}
            />
          </div>
        ) : (
          <>
            <div
              ref={viewport}
              className="conversation-scroll"
              onScroll={(e) => {
                const el = e.currentTarget;
                const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                follow.current = dist < 100;
                setShowJump(dist > 240);
              }}
            >
              <div className="messages">
                {session.messages.map((m) => (
                  <article key={m.id} className={"message " + m.role}>
                    {m.role === "user" ? (
                      <>
                        <span className="message-avatar">L</span>
                        <div>
                          <div className="message-label">你</div>
                          <p>{finalAnswer(m)}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="agent-avatar">
                          <Layers2 size={18} />
                        </span>
                        <div className="message-content">
                          <div className="message-label">
                            Office Agent {mode === "preview" ? <span>预览</span> : undefined}
                          </div>
                          {/* running 只属于正在流式的那条消息，否则历史消息的过程面板会全部展开变"工作中" */}
                          <ActivityTimeline
                            msg={m}
                            running={running === session.id && m.runStatus === "running"}
                          />
                          {m.error ? (
                            <div className="run-error">
                              <CircleAlert size={15} />
                              {m.error}
                            </div>
                          ) : null}
                          {!(running === session.id) && finalAnswer(m) ? (
                            <div className="message-md">
                              <StreamingMarkdown content={finalAnswer(m)} streaming={false} />
                            </div>
                          ) : null}
                          {!m.error && !(running === session.id) && m.runStatus === "completed" && !finalAnswer(m) && m.activities.length === 0 ? (
                            <div className="run-error">
                              <CircleAlert size={15} />
                              模型本次返回了空内容，请重发或换个说法。
                            </div>
                          ) : null}
                          {!m.error && finalAnswer(m) && running !== session.id && (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="复制回复"
                              onClick={() => copy(m.id, finalAnswer(m))}
                            >
                              {copied === m.id ? <Check size={14} /> : <Copy size={14} />}
                            </Button>
                          )}
                          {!running && (m.runStatus === "stopped" || m.runStatus === "failed") && m.prompt && (
                            <div className="msg-actions">
                              {m.runStatus === "stopped" && (
                                <button className="act-secondary" onClick={() => void send("继续")}>
                                  <Play size={13} /> 继续任务
                                </button>
                              )}
                              <button className="act-secondary" onClick={() => void send(m.prompt!)}>
                                <RotateCcw size={13} /> 重新开始
                              </button>
                            </div>
                          )}
                          {m.artifacts && m.artifacts.length > 0 && (
                            <div className="artifacts">
                              {m.artifacts.map((a) => (
                                <ArtifactCard
                                  key={a.path + a.kind}
                                  artifact={a}
                                  onOpen={(p) =>
                                    void client.current
                                      .request("os.open", { path: p })
                                      .catch(() => {})
                                  }
                                  onReveal={(p) =>
                                    void client.current
                                      .request("os.open", { path: p, revealDir: true })
                                      .catch(() => {})
                                  }
                                  onStat={async (p) => {
                                    try {
                                      return (await client.current.request("fs.stat", {
                                        path: p,
                                      })) as { sizeKb: number };
                                    } catch {
                                      return null;
                                    }
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            </div>
            <div className="composer-region">
              {running && (
                <div className="run-status">
                  <i className="live-dot" />
                  {isLive ? "Agent 正在工作" : "执行预览中"}
                  {running !== session.id && (
                    <button onClick={() => setActive(running)}>回到运行会话</button>
                  )}
                  <button
                    onClick={() =>
                      isLive
                        ? void client.current.request("run.cancel").catch(() => {})
                        : controller.current?.abort()
                    }
                  >
                    停止
                  </button>
                </div>
              )}
              <Composer
                {...composerCommon}
                showGroupSelector={false}
                placeholder="继续输入…"
              />
            </div>
          </>
        )}

        <Settings
          open={settings}
          onOpenChange={setSettings}
          profile={profile}
          theme={theme}
          setTheme={setTheme}
          isLive={isLive}
          client={client.current}
          providers={providers}
          setProviders={setProviders}
          selection={selection}
          onSelection={setSelection}
          handshake={handshake}
        />
      </main>
    </div>
  );
}

/** 把引擎的原始错误转成用户能直接行动的中文提示。 */
function friendlyError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("no api key") || s.includes("api key found"))
    return "还没有配置 API Key，请到 设置 → 模型 里填写后重试。";
  if (s.includes("401") || s.includes("authentication") || s.includes("invalid api key"))
    return "API Key 无效或已过期，请到 设置 → 模型 里检查。";
  if (s.includes("429") || s.includes("rate limit"))
    return "请求太频繁或额度受限，请稍后再试。";
  if (s.includes("insufficient") || s.includes("balance") || s.includes("quota"))
    return "账户余额或额度不足，请到厂商控制台确认。";
  if (s.includes("fetch failed") || s.includes("network") || s.includes("econnrefused") || s.includes("enotfound"))
    return "网络连接失败，请检查网络或厂商地址是否正确。";
  if (s.includes("timeout") || s.includes("timed out"))
    return "请求超时，请稍后再试。";
  if (s.includes("model") && s.includes("not"))
    return raw;
  return raw;
}

/** 把一条 run 事件投影到正在流式输出的消息上。 */
function closeTrailingThinking(acts: UiActivity[]): void {
  const l = acts[acts.length - 1];
  if (l && l.kind === "thinking" && l.durationSec === undefined)
    acts[acts.length - 1] = {
      ...l,
      durationSec: Math.max(1, Math.round((Date.now() - l.startedAt) / 1000)),
    };
}

function applyEvent(m: UiMessage, messageId: string, event: ProtocolEvent): UiMessage {
  if (m.id !== messageId) return m;
  const p = event.payload as Record<string, unknown>;
  const acts: UiActivity[] = m.activities.map((a) =>
    a.kind === "tool" ? { kind: "tool", id: a.id, step: { ...a.step } } : { ...a },
  );
  const last = () => acts[acts.length - 1];

  switch (event.type) {
    case "thinking.delta": {
      const delta = String(p.delta ?? "");
      if (!delta) return m;
      const l = last();
      if (l && l.kind === "thinking") {
        l.text += delta;
        return { ...m, activities: acts };
      }
      acts.push({ kind: "thinking", id: crypto.randomUUID(), text: delta, startedAt: Date.now() });
      return { ...m, activities: acts };
    }
    case "message.delta": {
      const delta = String(p.delta ?? "");
      if (!delta) return m;
      const l = last();
      if (l && l.kind === "text") {
        l.text += delta;
        return { ...m, activities: acts };
      }
      closeTrailingThinking(acts);
      acts.push({ kind: "text", id: crypto.randomUUID(), text: delta });
      return { ...m, activities: acts };
    }
    case "tool.start": {
      closeTrailingThinking(acts);
      const toolName = String(p.toolName ?? "tool");
      const step: ToolStep = {
        id: String(p.toolId ?? crypto.randomUUID()),
        kind: toolKind(toolName),
        label: toolLabel(toolName),
        target: toolTarget(toolName, p.args),
        output: "",
        status: "running",
        toolName,
        args: p.args,
      };
      acts.push({ kind: "tool", id: step.id, step });
      return { ...m, activities: acts };
    }
    case "tool.update": {
      const toolId = String(p.toolId ?? "");
      for (const a of acts) {
        if (a.kind === "tool" && a.step.id === toolId) {
          a.step = {
            ...a.step,
            output: (a.step.output + toolOutputText(p.partial)).slice(-8000),
          };
        }
      }
      return { ...m, activities: acts };
    }
    case "tool.end": {
      const toolId = String(p.toolId ?? "");
      let artifacts = m.artifacts;
      const acts2 = acts.map((a) => {
        if (a.kind !== "tool" || a.step.id !== toolId) return a;
        const step: ToolStep = {
          ...a.step,
          output: toolOutputText(p.output) || a.step.output,
          status: p.isError ? "error" : "success",
        };
        // 写文件类工具成功 → 产物
        if (step.status === "success" && step.toolName && /^(write|edit)$/i.test(step.toolName)) {
          const path = extractPath(step.args);
          if (path) {
            const entry: Artifact = {
              path,
              name: path.split(/[\\/]/).pop() ?? path,
              kind: kindFromPath(path),
              modified: /edit/i.test(step.toolName),
            };
            artifacts = [...(m.artifacts ?? []).filter((x) => x.path !== path), entry];
          }
        }
        return { ...a, step };
      });
      return { ...m, activities: acts2, artifacts: artifacts ?? m.artifacts };
    }
    case "run.end": {
      const reason = String(p.reason ?? "");
      closeTrailingThinking(acts);
      const closed = acts.map((a) =>
        a.kind === "tool" && a.step.status === "running"
          ? { ...a, step: { ...a.step, status: "cancelled" as const } }
          : a,
      );
      const duration = m.runStartedAt
        ? Math.max(1, Math.round((Date.now() - m.runStartedAt) / 1000))
        : undefined;
      const status: UiMessage["runStatus"] =
        reason === "error" ? "failed" : reason === "aborted" ? "stopped" : "completed";
      return {
        ...m,
        activities: closed,
        runStatus: status,
        runDurationSec: duration,
        ...(reason === "error" ? { error: friendlyError(String(p.error ?? "任务失败")) } : {}),
      };
    }
    default:
      return m;
  }
}

/**
 * 历史快照 → 界面消息。一个 agent 回合（用户消息之后的连续 assistant 段）
 * 合并为一条 UI 消息，与实时视图同构；write/edit 步骤按实时规则重建产物卡。
 */
function projectSnapshotMessages(
  messages: {
    role: string;
    text: string;
    thinking?: string;
    tools?: { id: string; toolName: string; args: unknown; output: string; isError: boolean }[];
  }[],
): UiMessage[] {
  const out: UiMessage[] = [];
  let current: UiMessage | null = null;
  let turnArtifacts: Artifact[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      current = null;
      turnArtifacts = [];
      out.push({
        id: crypto.randomUUID(),
        role: "user",
        activities: [{ kind: "text", id: crypto.randomUUID(), text: m.text }],
        runStatus: "completed",
      });
      continue;
    }
    const acts: UiActivity[] = [];
    if (m.thinking)
      acts.push({ kind: "thinking", id: crypto.randomUUID(), text: m.thinking, startedAt: 0 });
    for (const t of m.tools ?? []) {
      acts.push({
        kind: "tool",
        id: t.id,
        step: {
          id: t.id,
          kind: toolKind(t.toolName),
          label: toolLabel(t.toolName),
          target: toolTarget(t.toolName, t.args),
          output: t.output,
          status: t.isError ? "error" : "success",
          toolName: t.toolName,
          args: t.args,
        },
      });
      if (!t.isError && /^(write|edit)$/i.test(t.toolName)) {
        const path = extractPath(t.args);
        if (path) {
          turnArtifacts = [
            ...turnArtifacts.filter((x) => x.path !== path),
            {
              path,
              name: path.split(/[\\/]/).pop() ?? path,
              kind: kindFromPath(path),
              modified: /edit/i.test(t.toolName),
            },
          ];
        }
      }
    }
    if (m.text) acts.push({ kind: "text", id: crypto.randomUUID(), text: m.text });
    if (!current) {
      current = { id: crypto.randomUUID(), role: "assistant", activities: [], runStatus: "completed" };
      out.push(current);
    }
    current.activities.push(...acts);
    if (turnArtifacts.length) current.artifacts = [...turnArtifacts];
  }
  return out;
}

function load<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function relTime(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}分`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}时`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}天`;
  return `${Math.floor(d / 7)}周`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export type UiActivity =
  | { kind: "thinking"; id: string; text: string; startedAt: number; durationSec?: number }
  | { kind: "text"; id: string; text: string }
  | { kind: "tool"; id: string; step: ToolStep };

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  /** 按发生顺序交错：思考 / 正文片段 / 工具步骤 */
  activities: UiActivity[];
  error?: string;
  /** 触发本条回复的用户文本，用于停止/失败后重试 */
  prompt?: string;
  runStartedAt?: number;
  runStatus?: "running" | "completed" | "failed" | "stopped";
  runDurationSec?: number;
  artifacts?: Artifact[];
}

function finalAnswer(m: UiMessage): string {
  for (let i = m.activities.length - 1; i >= 0; i--) {
    const a = m.activities[i];
    if (a.kind === "text") return a.text;
  }
  return "";
}

function fmtDuration(sec: number | undefined): string {
  if (sec === undefined) return "";
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m} 分 ${r} 秒` : `${m} 分钟`;
}

interface UiSession {
  id: string;
  file?: string;
  title: string;
  messages: UiMessage[];
  loaded: boolean;
  /** false = 尚未发出的草稿会话，不出现在侧栏 */
  listed?: boolean;
  modified?: string;
}

const newBlank = (): UiSession => ({
  id: crypto.randomUUID(),
  title: "新会话",
  messages: [],
  loaded: true,
  listed: false,
});

/** 菜单内联输入：替代系统 prompt，Enter 确认 / Esc 取消。 */
function MenuInput({
  initial,
  placeholder,
  onConfirm,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial ?? "");
  return (
    <div className="menu-input-row">
      <input
        autoFocus
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && v.trim()) onConfirm(v.trim());
          if (e.key === "Escape") onCancel();
        }}
      />
      <button
        className="mi-ok"
        aria-label="确认"
        disabled={!v.trim()}
        onClick={() => v.trim() && onConfirm(v.trim())}
      >
        <Check size={13} />
      </button>
    </div>
  );
}

/**
 * 无边框窗口拖动：不依赖 Tauri 注入的 drag-region 脚本，直接在
 * mousedown 时调用 start_dragging。点击按钮/菜单等控件不触发。
 */
function useWindowDrag() {
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => Promise<void>;
          metadata: { currentWindow: { label: string } };
        };
      }
    ).__TAURI_INTERNALS__;
    const label = internals.metadata.currentWindow.label;
    const interactive = "button, input, textarea, select, .session-menu, .model-menu, .group-menu, .effort-pop, .win-controls, a";
    const onDown = (e: Event) => {
      if ((e as MouseEvent).button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest(interactive)) return;
      if (!target.closest("[data-tauri-drag-region]")) return;
      void internals.invoke("plugin:window|start_dragging", { label }).catch(() => {});
    };
    const bar = document.querySelector<HTMLElement>(".topbar");
    if (!bar) return;
    bar.addEventListener("mousedown", onDown);
    return () => bar.removeEventListener("mousedown", onDown);
  }, []);
}

/** 运行秒表：每秒自增，证明 Agent 还活着。 */
function RunSeconds({ startedAt }: { startedAt: number }) {
  const [s, setS] = useState(() => Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setS(Math.max(0, Math.round((Date.now() - startedAt) / 1000))), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return <span>· {s}s</span>;
}
