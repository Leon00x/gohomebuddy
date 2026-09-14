import {
  ArrowUp,
  BrainCog,
  Check,
  ChevronDown,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
  onChooseWorkspaceFolder,
  providers,
  enabledModels,
  selection,
  onSelectModel,
  onOpenSettings,
  supportsReasoning,
  thinkingLevel,
  onThinkingLevel,
  permissionMode,
  onPermissionMode,
  attachments,
  attachmentThumbs,
  attachmentNames,
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
  onChooseWorkspaceFolder?: () => Promise<string | undefined>;
  providers: CatalogProvider[];
  enabledModels?: Record<string, string[]>;
  selection: ModelSelection;
  onSelectModel: (v: ModelSelection) => void;
  onOpenSettings: () => void;
  supportsReasoning?: boolean;
  thinkingLevel?: string;
  onThinkingLevel?: (v: string) => void;
  permissionMode?: PermissionMode;
  onPermissionMode?: (v: PermissionMode) => void;
  attachments?: string[];
  attachmentThumbs?: Record<string, string>;
  attachmentNames?: Record<string, string>;
  onToggleAttachment?: (path: string) => void;
  onImportFiles?: (files: File[]) => Promise<void> | void;
  importingFiles?: boolean;
  importError?: string;
  onClearImportError?: () => void;
  hero?: boolean;
}) {
  const [groupMenu, setGroupMenu] = useState(false);
  const [thinkingPop, setThinkingPop] = useState(false);
  const [permPop, setPermPop] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
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
      ? "无工作空间"
      : workspaces.find((w) => w.id === draftGroup)?.name ?? "无工作空间";
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
    onDraftGroup(id);
    setGroupMenu(false);
  }

  function toggleAttachment(path: string) {
    onToggleAttachment?.(path);
  }

  const ICON_BY_EXT: Record<string, typeof FileText> = {
    png: FileImage, jpg: FileImage, jpeg: FileImage, gif: FileImage,
    webp: FileImage, bmp: FileImage, svg: FileImage, avif: FileImage,
    zip: FileArchive, rar: FileArchive, "7z": FileArchive, tar: FileArchive, gz: FileArchive,
    csv: FileSpreadsheet, xlsx: FileSpreadsheet, xls: FileSpreadsheet,
    mp4: FileVideo, mov: FileVideo, avi: FileVideo, mkv: FileVideo, webm: FileVideo,
    pdf: FileText,
  };
  function iconFor(path: string): typeof FileText {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return ICON_BY_EXT[ext] ?? FileText;
  }

  function handlePickedFiles(files: FileList | null) {
    if (!files?.length || !onImportFiles) return;
    onImportFiles(Array.from(files));
  }

  /**
   * 自适应收缩：compact 只表示「当前可用宽度放不下完整工具栏」。
   * 判定不看 compact 之后的 DOM，而是在同一父节点里克隆一份完整工具栏
   * （`.composer-toolbar-measure`，绝对定位、不可见）量出所需宽度，
   * 因此进入/退出用的是同一把尺子，不会出现拉宽后卡在图标态的问题。
   */
  const measureFullWidth = useCallback(() => {
    const el = toolbarRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return 0;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.classList.remove("composer-toolbar");
    clone.classList.add("composer-toolbar-measure");
    clone.setAttribute("aria-hidden", "true");
    parent.appendChild(clone);
    // 用自身盒子宽度而不是 scrollWidth：展开的浮层是绝对定位的子节点，
    // 会把 scrollWidth 撑大，导致菜单一开就误判为需要收缩。
    const required = Math.ceil(clone.getBoundingClientRect().width);
    clone.remove();
    return required;
  }, []);

  const checkToolbar = useCallback(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const available = el.clientWidth;
    if (!available) return;
    const required = measureFullWidth();
    if (!required) return;
    // 6px 迟滞：避免临界宽度附近来回闪烁
    const GAP = 6;
    setCompact((prev) => (prev ? available < required + GAP : available < required));
  }, [measureFullWidth]);

  // 依赖项变化（模型名、权限文案、语言等）后重新量一次；这里只触发测量，
  // compact 的取值完全由宽度决定。
  useLayoutEffect(() => {
    checkToolbar();
  });

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    const container = el?.parentElement ?? el;
    if (!el || !container) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        checkToolbar();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [checkToolbar]);

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
      {showGroupSelector && (
        <div className="composer-scope">
          <div className="group-anchor">
            <button
              className="group-select"
              onClick={() => {
                setGroupMenu(!groupMenu);
                setThinkingPop(false);
              }}
              title={groupName}
            >
              <Folder size={14} />
              <span className="ctl-text">{groupName}</span>
              <ChevronDown size={12} className="ctl-chev" />
            </button>
            {groupMenu && (
              <div className="session-menu group-menu">
                <>
                  <button onClick={() => pickGroup(UNGROUPED)}>无工作空间</button>
                  {workspaces.map((w) => (
                    <button key={w.id} onClick={() => pickGroup(w.id)}>
                      {w.name}
                    </button>
                  ))}
                  <button onClick={() => void onChooseWorkspaceFolder?.().then((id) => id && pickGroup(id))}>
                    <Plus size={13} /> 选择其他文件夹
                  </button>
                </>
              </div>
            )}
          </div>
        </div>
      )}
      <div className="composer-input">
      {attachments && attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((path) => {
            const thumb = attachmentThumbs?.[path];
            const Icon = iconFor(path);
            const label = attachmentNames?.[path] ?? path.split("/").pop() ?? path;
            return (
              <span className="attach-chip" key={path} title={path}>
                {thumb ? (
                  <img className="attach-thumb" src={thumb} alt="" />
                ) : (
                  <Icon size={12} />
                )}
                <span>{label}</span>
                <button aria-label={`移除引用 ${path}`} onClick={() => onToggleAttachment?.(path)}>
                  <X size={12} />
                </button>
              </span>
            );
          })}
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
          <div className="group-anchor">
            <button
              className={"group-select attach-btn" + (attachments?.length ? " has-attachments" : "")}
              onClick={() => fileInputRef.current?.click()}
              title="添加附件"
            >
              <Plus size={16} />
              {attachments?.length ? <span className="attach-count">{attachments.length}</span> : null}
            </button>
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
            enabledModels={enabledModels}
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
