import {
  ArrowUp,
  BrainCog,
  Check,
  ChevronDown,
  FileText,
  Folder,
  Hand,
  Plus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Shield,
  Square,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { ModelMenu } from "./ModelMenu";
import {
  PERMISSION_MODES,
  THINKING_LEVELS,
  type ModelSelection,
  type PermissionMode,
} from "../lib/protocol-client";
import type { CatalogProvider } from "@office/contracts";

export interface WorkspaceOption {
  id: string;
  name: string;
}

export const UNGROUPED = "__ungrouped__";

const DEFAULT_LEVEL = "medium";

/** 权限模式分档图标（参考 ZCode）：询问=手势、自动编辑=盾勾、完全访问=盾叹号（橘红）。 */
const PERM_ICON: Record<string, typeof Shield> = {
  ask: Hand,
  auto_edit: ShieldCheck,
  full_access: ShieldAlert,
};

/** 思考强度滑杆：档位间平滑滑动，点按或拖拽换挡。 */
function EffortSlider({
  value,
  onChange,
  onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const idx = Math.max(
    0,
    THINKING_LEVELS.findIndex((l) => l.id === value),
  );
  const n = THINKING_LEVELS.length;
  const frac = n > 1 ? idx / (n - 1) : 0;

  function levelFromEvent(e: React.PointerEvent): string {
    const rect = trackRef.current!.getBoundingClientRect();
    const knob = 30;
    const f = Math.min(Math.max((e.clientX - rect.left - knob / 2) / (rect.width - knob), 0), 1);
    return THINKING_LEVELS[Math.round(f * (n - 1))].id;
  }

  return (
    <div
      className={"effort-slider" + (dragging ? " dragging" : "")}
      role="slider"
      tabIndex={0}
      aria-label="思考强度"
      aria-valuemin={1}
      aria-valuemax={n}
      aria-valuenow={idx + 1}
      aria-valuetext={THINKING_LEVELS[idx].label}
      ref={trackRef}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDragging(true);
        onChange(levelFromEvent(e));
      }}
      onPointerMove={(e) => {
        if (dragging) {
          const id = levelFromEvent(e);
          if (id !== value) onChange(id);
        }
      }}
      onPointerUp={() => {
        setDragging(false);
        onCommit();
      }}
      onKeyDown={(e) => {
        const cur = THINKING_LEVELS.findIndex((l) => l.id === value);
        let next = cur;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = Math.max(0, cur - 1);
        if (e.key === "ArrowRight" || e.key === "ArrowUp") next = Math.min(n - 1, cur + 1);
        if (e.key === "Home") next = 0;
        if (e.key === "End") next = n - 1;
        if (next !== cur) {
          e.preventDefault();
          onChange(THINKING_LEVELS[next].id);
          onCommit();
        }
      }}
    >
      {THINKING_LEVELS.map((l, i) => {
        const f = i / (n - 1);
        return (
          <i
            key={l.id}
            className="effort-stop"
            style={{ left: `calc(${f * 100}% - ${f * 30}px + 15px)` }}
          />
        );
      })}
      <span
        className="effort-fill"
        style={{ width: `calc(${frac * 100}% - ${frac * 30}px + 15px)` }}
      />
      <span className="effort-knob" style={{ left: `calc(${frac * 100}% - ${frac * 30}px)` }} />
    </div>
  );
}

/** 会话输入框：hero（空会话居中）与 docked（对话页底部）两种形态共用。 */
export function Composer({
  draft,
  onDraft,
  onSend,
  running,
  onStop,
  placeholder,
  showGroupSelector,
  workspaces,
  draftGroup,
  onDraftGroup,
  onCreateGroup,
  providers,
  selection,
  onSelectModel,
  onOpenSettings,
  supportsReasoning,
  thinkingLevel,
  onThinkingLevel,
  permissionMode,
  onPermissionMode,
  attachments,
  onToggleAttachment,
  onImportFiles,
  importingFiles,
  importError,
  onClearImportError,
  hero,
}: {
  draft: string;
  onDraft: (v: string) => void;
  onSend: () => void;
  running: boolean;
  onStop: () => void;
  placeholder: string;
  showGroupSelector: boolean;
  workspaces: WorkspaceOption[];
  draftGroup: string;
  onDraftGroup: (id: string) => void;
  onCreateGroup: (name: string) => string;
  providers: CatalogProvider[];
  selection: ModelSelection;
  onSelectModel: (v: ModelSelection) => void;
  onOpenSettings: () => void;
  supportsReasoning?: boolean;
  thinkingLevel?: string;
  onThinkingLevel?: (v: string) => void;
  permissionMode?: PermissionMode;
  onPermissionMode?: (v: PermissionMode) => void;
  attachments?: string[];
  onToggleAttachment?: (path: string) => void;
  onImportFiles?: (files: File[]) => Promise<void> | void;
  importingFiles?: boolean;
  importError?: string;
  onClearImportError?: () => void;
  hero?: boolean;
}) {
  const [groupMenu, setGroupMenu] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [thinkingPop, setThinkingPop] = useState(false);
  const [permPop, setPermPop] = useState(false);
  const [attachPop, setAttachPop] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pathInputOpen, setPathInputOpen] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  // 放不下时才收敛为纯图标（模型名除外，始终显示）；能用文字就显示文字
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [draft]);
  const groupName =
    draftGroup === UNGROUPED
      ? "未分组"
      : workspaces.find((w) => w.id === draftGroup)?.name ?? "未分组";
  const currentLevel =
    THINKING_LEVELS.find((l) => l.id === (thinkingLevel ?? DEFAULT_LEVEL)) ??
    THINKING_LEVELS[2];
  const perm = PERMISSION_MODES.find((m) => m.id === (permissionMode ?? "ask")) ?? PERMISSION_MODES[0];
  const modelLabel =
    providers
      .find((p) => p.id === selection.providerId)
      ?.models.find((m) => m.id === selection.modelId)?.name ??
    selection.modelId ??
    "选择模型";

  function pickGroup(id: string) {
    if (id === "__new__") {
      // 内联输入替代系统 prompt（UI 规范）
      setCreatingGroup(true);
      setNewGroupName("");
      return;
    }
    onDraftGroup(id);
    setGroupMenu(false);
  }

  function confirmNewGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    onDraftGroup(onCreateGroup(name));
    setNewGroupName("");
    setCreatingGroup(false);
    setGroupMenu(false);
  }

  async function toggleAttachPop() {
    setAttachPop(!attachPop);
    setGroupMenu(false);
    setThinkingPop(false);
    setPermPop(false);
  }

  function toggleAttachment(path: string) {
    onToggleAttachment?.(path);
  }

  function handlePickedFiles(files: FileList | null) {
    if (!files?.length || !onImportFiles) return;
    onImportFiles(Array.from(files));
    setAttachPop(false);
  }

  /** 按路径直接引用本地文件：引擎在本机以用户权限读取，无需复制内容 */
  function confirmPath() {
    const p = pathDraft.trim();
    if (!p) return;
    if (!attachments?.includes(p)) onToggleAttachment?.(p);
    setPathInputOpen(false);
    setPathDraft("");
    setAttachPop(false);
  }

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const check = () => setCompact(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [providers, selection, workspaces, supportsReasoning]);

  return (
    <div
      className={
        "composer" +
        (hero ? " composer-hero" : "") +
        (compact ? " composer--compact" : "") +
        (dragging ? " composer--dragging" : "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (onImportFiles) handlePickedFiles(e.dataTransfer?.files ?? null);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="attach-file-input"
        onChange={(e) => {
          handlePickedFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {attachments && attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((path) => (
            <span className="attach-chip" key={path} title={path}>
              <FileText size={12} />
              <span>{path}</span>
              <button aria-label={`移除引用 ${path}`} onClick={() => onToggleAttachment?.(path)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {importError ? (
        <div className="composer-attachments">
          <span className="attach-error">
            {importError}
            <button aria-label="关闭提示" onClick={() => onClearImportError?.()}>
              <X size={12} />
            </button>
          </span>
        </div>
      ) : null}
      <textarea
        aria-label="消息"
        rows={hero ? 3 : 2}
        placeholder={placeholder}
        value={draft}
        ref={taRef}
        onChange={(e) => {
          onDraft(e.target.value);
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = Math.min(el.scrollHeight, 200) + "px";
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <div className="composer-toolbar" ref={toolbarRef}>
        <div>
          {showGroupSelector && (
            <div className="group-anchor">
              <button
                className="group-select"
                onClick={() => {
                  setGroupMenu(!groupMenu);
                  setThinkingPop(false);
                  setAttachPop(false);
                }}
              >
                <Folder size={14} />
                <span className="ctl-text">{groupName}</span>
                <ChevronDown size={12} className="ctl-chev" />
              </button>
              {groupMenu && (
                <div className="session-menu group-menu">
                  {creatingGroup ? (
                    <MenuInputRow
                      initial={newGroupName}
                      onChange={setNewGroupName}
                      placeholder="工作空间名称"
                      onConfirm={confirmNewGroup}
                      onCancel={() => {
                        setCreatingGroup(false);
                        setNewGroupName("");
                      }}
                    />
                  ) : (
                    <>
                      <button onClick={() => pickGroup(UNGROUPED)}>未分组</button>
                      {workspaces.map((w) => (
                        <button key={w.id} onClick={() => pickGroup(w.id)}>
                          {w.name}
                        </button>
                      ))}
                      <button onClick={() => pickGroup("__new__")}>
                        <Plus size={13} /> 新建工作空间
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="group-anchor">
            <button
              className={"group-select attach-btn" + (attachments?.length ? " has-attachments" : "")}
              onClick={() => void toggleAttachPop()}
              title="添加附件"
            >
              <Plus size={16} />
              {attachments?.length ? <span className="attach-count">{attachments.length}</span> : null}
            </button>
              {attachPop && (
                <>
                  <div className="menu-overlay" onClick={() => setAttachPop(false)} />
                  <div className="session-menu attach-pop">
                    <button
                      className="attach-import"
                      disabled={importingFiles}
                      title="部分内嵌浏览器不支持弹出系统选择框，可用下方「输入路径添加」"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FileText size={14} />
                      {importingFiles ? "正在导入…" : "选择系统文件…"}
                    </button>
                    {pathInputOpen ? (
                      <div className="menu-input-row">
                        <input
                          autoFocus
                          value={pathDraft}
                          placeholder="输入文件路径，如 /home/you/report.pdf"
                          onChange={(e) => setPathDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && pathDraft.trim()) confirmPath();
                            if (e.key === "Escape") {
                              setPathInputOpen(false);
                              setPathDraft("");
                            }
                          }}
                        />
                        <button
                          className="mi-ok"
                          aria-label="确认"
                          disabled={!pathDraft.trim()}
                          onClick={() => pathDraft.trim() && confirmPath()}
                        >
                          <Check size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="attach-path-btn"
                        onClick={() => {
                          setPathInputOpen(true);
                          setPathDraft("");
                        }}
                      >
                        输入路径添加…
                      </button>
                    )}
              </div>
            </>
          )}
          </div>
        </div>
        <div>
          <div className="group-anchor perm-anchor">
            <button
              className={"group-select perm-" + perm.id}
              onClick={() => {
                setPermPop(!permPop);
                setGroupMenu(false);
                setThinkingPop(false);
                setAttachPop(false);
              }}
              title="Agent 权限模式"
            >
              {(() => {
                const PermIcon = PERM_ICON[perm.id] ?? Shield;
                return <PermIcon size={13} />;
              })()}
              <span className="ctl-text">{perm.short}</span>
            </button>
            {permPop && (
              <>
                <div className="menu-overlay" onClick={() => setPermPop(false)} />
                <div className="session-menu perm-pop">
                  {PERMISSION_MODES.map((m) => {
                    const ModeIcon = PERM_ICON[m.id] ?? Shield;
                    return (
                      <button
                        key={m.id}
                        className={m.id === perm.id ? "current" : ""}
                        onClick={() => {
                          onPermissionMode?.(m.id);
                          setPermPop(false);
                        }}
                      >
                        <ModeIcon size={15} className={"perm-icon perm-" + m.id} />
                        <span className="perm-item">
                          <b>{m.label}</b>
                          <small>{m.desc}</small>
                        </span>
                        {m.id === perm.id && <Check size={14} className="perm-check" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          {supportsReasoning && (
            <div className="group-anchor">
              <button
                className="group-select effort-trigger"
                onClick={() => {
                  setThinkingPop(!thinkingPop);
                  setGroupMenu(false);
                  setAttachPop(false);
                }}
              >
                <BrainCog size={14} />
                <span className="ctl-text">{currentLevel.label}</span>
                <ChevronDown size={12} className="ctl-chev" />
              </button>
              {thinkingPop && (
                <>
                  <div className="menu-overlay" onClick={() => setThinkingPop(false)} />
                  <div className="session-menu effort-pop">
                    <div className="effort-head">
                      <BrainCog size={17} className="effort-bolt" />
                      <span className="effort-level">
                        {currentLevel.label}
                        <ChevronDown size={13} />
                      </span>
                      <button
                        className="effort-reset"
                        aria-label="恢复默认"
                        title="恢复默认"
                        onClick={() => onThinkingLevel?.(DEFAULT_LEVEL)}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                    <div className="effort-model">{modelLabel}</div>
                    <EffortSlider
                      value={currentLevel.id}
                      onChange={(v) => onThinkingLevel?.(v)}
                      onCommit={() => setThinkingPop(false)}
                    />
                  </div>
                </>
              )}
            </div>
          )}
          <ModelMenu
            providers={providers}
            selection={selection}
            onSelect={onSelectModel}
            onOpenSettings={onOpenSettings}
            direction="up"
          />
          <Button
            variant="primary"
            size="icon"
            className="send-button"
            aria-label={running && !draft.trim() ? "停止" : running ? "加入队列" : "发送"}
            disabled={!running && !draft.trim()}
            onClick={() => (running && !draft.trim() ? onStop() : onSend())}
          >
            {running && !draft.trim() ? (
              <Square size={14} fill="currentColor" />
            ) : (
              <ArrowUp size={18} />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 菜单内联输入：替代系统 prompt，Enter 确认 / Esc 取消。 */
function MenuInputRow({
  initial,
  placeholder,
  onConfirm,
  onCancel,
  onChange,
}: {
  initial: string;
  placeholder: string;
  onConfirm: () => void;
  onCancel: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="menu-input-row">
      <input
        autoFocus
        value={initial}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && initial.trim()) onConfirm();
          if (e.key === "Escape") onCancel();
        }}
      />
      <button className="mi-ok" aria-label="确认" disabled={!initial.trim()} onClick={() => initial.trim() && onConfirm()}>
        <Check size={13} />
      </button>
    </div>
  );
}
