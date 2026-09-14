import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  SlidersHorizontal,
  Palette,
  Server,
  Eye,
  EyeOff,
  Check,
  LoaderCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  User,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CatalogProvider, ModelProfile } from "@office/contracts";
import { Button } from "./Button";
import type { ModelSelection, ProtocolClient } from "../lib/protocol-client";

export type Theme = "light" | "dark" | "system";

/** 用户资料：仅本地保存，头像以 128px 等比缩放后的 data URL 存储。 */
export interface UserProfile {
  name: string;
  avatar?: string;
}

async function readAvatarFile(file: File, size = 128): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("图片解析失败"));
    el.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  const scale = Math.max(size / image.width, size / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/png");
}

const CUSTOM_NEW = "__custom__";

function providerHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

export function Settings({
  open,
  onOpenChange,
  profile,
  theme,
  setTheme,
  isLive,
  client,
  providers,
  setProviders,
  selection,
  onSelection,
  handshake,
  userProfile,
  onUserProfile,
  enabledModels,
  onEnabledModels,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  profile: ModelProfile;
  theme: Theme;
  setTheme: (v: Theme) => void;
  isLive: boolean;
  client: ProtocolClient;
  providers: CatalogProvider[];
  setProviders: (p: CatalogProvider[]) => void;
  selection: ModelSelection;
  onSelection: (v: ModelSelection) => void;
  handshake: { runtime: string; piVersion: string; node: string; agentDir: string; cwd: string } | null;
  userProfile: UserProfile;
  onUserProfile: (v: UserProfile) => void;
  enabledModels: Record<string, string[]>;
  onEnabledModels: (v: Record<string, string[]>) => void;
}) {
  const [tab, setTab] = useState("models");
  const avatarInput = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [draftProvider, setDraftProvider] = useState(selection.providerId);
  const [draftModel, setDraftModel] = useState(selection.modelId);
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [customName, setCustomName] = useState("");
  const [customBase, setCustomBase] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  /** 是否已点过「检测模型」——用于在检测无结果时改为手动输入 */
  const [detected, setDetected] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState("");

  const isCustomDraft = draftProvider === CUSTOM_NEW;
  const provider = providers.find((p) => p.id === draftProvider);
  const pillModels: { id: string; name: string; reasoning: boolean }[] = isCustomDraft
    ? remoteModels.map((id) => ({ id, name: id, reasoning: false }))
    : (provider?.models ?? []);
  const currentModel = isCustomDraft ? customModel : draftModel;
  function pickModel(id: string) {
    if (isCustomDraft) setCustomModel(id);
    else setDraftModel(id);
    setSaved(false);
  }

  async function refreshProviders() {
    try {
      setProviders((await client.request("config.providers")) as CatalogProvider[]);
    } catch {
      // 目录拉取失败时保留旧列表
    }
  }

  async function fetchModels() {
    if (!customBase) {
      setError("先填写 API 地址再获取模型列表");
      return;
    }
    setFetching(true);
    setError("");
    try {
      setRemoteModels(
        (await client.request("config.remoteModels", {
          baseUrl: customBase,
          apiKey: key,
          providerId: isCustomDraft ? undefined : draftProvider,
        })) as string[],
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "获取模型列表失败");
    } finally {
      setFetching(false);
    }
  }

  async function save() {
    setError("");
    setSaving(true);
    try {
      if (isCustomDraft) {
        if (!customBase || !customModel) {
          setError("自定义厂商需要填写 API 地址和模型 ID");
          setSaving(false);
          return;
        }
        const id =
          "custom-" +
          (customName || customModel || "provider").replace(/\W+/g, "-").toLowerCase().slice(0, 24);
        await client.request("config.custom.save", {
          provider: {
            id,
            name: customName || "自定义厂商",
            baseUrl: customBase,
            api: "openai-completions",
            models: [{ id: customModel, name: customModel }],
          },
        });
        if (key) await client.request("config.setApiKey", { providerId: id, apiKey: key });
        await refreshProviders();
        onSelection({
          providerId: id,
          providerName: customName || "自定义厂商",
          modelId: customModel,
          thinkingLevel: selection.thinkingLevel,
        });
        setDraftProvider(id);
      } else {
        if (key) await client.request("config.setApiKey", { providerId: draftProvider, apiKey: key });
        await refreshProviders();
        onSelection({
          providerId: draftProvider,
          providerName: provider?.name ?? draftProvider,
          modelId: draftModel,
          thinkingLevel: selection.thinkingLevel,
        });
      }
      const savedId = isCustomDraft ? undefined : draftProvider;
      if (savedId && selectedModels.length) {
        onEnabledModels({ ...enabledModels, [savedId]: selectedModels });
      }
      setKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  /**
   * 填完 Key 后跑一次模型检测：自定义厂商拉远端 /models 列表，
   * 内置厂商刷新目录（拿到该厂商已知模型）。
   */
  async function detectModels() {
    setError("");
    setDetected(true);
    // 已配置过的厂商可用本机已存密钥重新检测，不必重输 Key。
    const canUseStoredKey = !isCustomDraft && provider?.auth === "ready";
    if (!key.trim() && !canUseStoredKey) {
      setError("先填入 API Key 再检测模型");
      return;
    }
    if (isCustomDraft) {
      if (!customBase) {
        setError("先填写 API 地址，再检测模型");
        return;
      }
      await fetchModels();
      return;
    }
    const baseUrl = provider?.baseUrl;
    if (!baseUrl) {
      setError("该厂商缺少 API 地址，无法检测模型");
      return;
    }
    setFetching(true);
    try {
      const ids = (await client.request("config.remoteModels", {
        baseUrl,
        apiKey: key,
        providerId: draftProvider,
      })) as string[];
      if (!ids.length) {
        setError("没有检测到模型，可手动填写模型 ID");
        return;
      }
      // 写回应用管理的模型配置，之后该厂商的模型就能被选用。
      await client.request("config.custom.save", {
        provider: {
          id: draftProvider,
          name: provider?.name ?? draftProvider,
          baseUrl,
          api: "openai-completions",
          models: ids.map((id) => ({ id, name: id })),
        },
      });
      await refreshProviders();
      setSelectedModels(ids.slice(0, 4));
    } catch (err) {
      setError(err instanceof Error ? err.message : "检测模型失败");
    } finally {
      setFetching(false);
    }
  }

  function toggleModel(id: string) {
    setSelectedModels((all) => (all.includes(id) ? all.filter((x) => x !== id) : [...all, id]));
    setSaved(false);
  }

  // 每次打开弹窗都同步当前选中值（从模型菜单切换后设置页要保持一致）
  useEffect(() => {
    if (open) {
      setDraftProvider(selection.providerId);
      setDraftModel(selection.modelId);
      setSaved(false);
      setError("");
      setKey("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setKey("");
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-dialog">
          <div className="settings-nav">
            <div className="settings-heading">
              <SlidersHorizontal size={17} /> 设置
            </div>
            {[
              ["models", Server, "模型"],
              ["profile", User, "个人资料"],
              ["appearance", Palette, "外观"],
              ["runtime", Server, "运行环境"],
            ].map(([id, Icon, label]) => {
              const ItemIcon = Icon as typeof Server;
              return (
                <button
                  key={id as string}
                  className={tab === id ? "selected" : ""}
                  onClick={() => setTab(id as string)}
                >
                  <ItemIcon size={16} />
                  {label as string}
                </button>
              );
            })}
            <div className="settings-version">
              GoHomeBuddy
              <br />下班搭子 · 0.1.0
            </div>
          </div>
          <div className="settings-body">
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="close-dialog"
                aria-label="关闭设置"
              >
                <X size={18} />
              </Button>
            </Dialog.Close>
            <Dialog.Title>
              {tab === "models"
                ? "模型"
                : tab === "appearance"
                  ? "让这里更像你的工作空间"
                  : "运行环境"}
            </Dialog.Title>
            <Dialog.Description>
              {tab === "models"
                ? isLive
                  ? "选择厂商与模型，填入 Key 即可使用。Key 仅保存在本机。"
                  : "当前是界面预览。启动本地引擎后即可配置模型。"
                : tab === "appearance"
                  ? "选择适合你的明暗风格。"
                  : "查看当前引擎的接入状态。"}
            </Dialog.Description>
            {tab === "models" ? (
              isLive ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  <div className="model-section">
                    <div className="model-section-title">已配置</div>
                    {providers.filter((p) => p.auth === "ready").length === 0 && (
                      <p className="model-section-empty">还没有已配置的模型，从下面选一个厂商添加。</p>
                    )}
                    {providers
                      .filter((p) => p.auth === "ready")
                      .map((p) => {
                        const expanded = expandedProvider === p.id;
                        const enabled = enabledModels[p.id] ?? p.models.slice(0, 4).map((m) => m.id);
                        const loadIntoForm = () => {
                          setDraftProvider(p.id);
                          setDraftModel(
                            selection.providerId === p.id ? selection.modelId : p.models[0]?.id ?? "",
                          );
                          setSelectedModels(enabled);
                          setRemoteModels([]);
                          setSaved(false);
                          setError("");
                        };
                        return (
                          <div className="configured-group" key={p.id}>
                            <button
                              type="button"
                              className="configured-row"
                              aria-expanded={expanded}
                              onClick={() => setExpandedProvider(expanded ? "" : p.id)}
                            >
                              <i
                                className="p-dot"
                                style={{ background: `hsl(${providerHue(p.id)} 42% 46%)` }}
                              >
                                {p.name.slice(0, 1)}
                              </i>
                              <span>{p.name}</span>
                              <small>{enabled.length} 个模型</small>
                              {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                            {expanded && (
                              <div className="configured-models">
                                {enabled.map((id) => (
                                  <div className="configured-model" key={id}>
                                    <span title={id}>{p.models.find((m) => m.id === id)?.name ?? id}</span>
                                    <button type="button" onClick={loadIntoForm}>
                                      编辑
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        onEnabledModels({
                                          ...enabledModels,
                                          [p.id]: enabled.filter((x) => x !== id),
                                        })
                                      }
                                    >
                                      删除
                                    </button>
                                  </div>
                                ))}
                                <button type="button" className="configured-add" onClick={loadIntoForm}>
                                  <Plus size={12} /> 添加模型
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                    <div className="model-section-title split">添加配置</div>
                  </div>

                  <div className="step-label">
                    <i>1</i> 选择厂商
                  </div>
                  <div className="provider-anchor">
                    <button
                      type="button"
                      className="provider-select"
                      onClick={() => setProviderOpen(!providerOpen)}
                    >
                      {provider && !isCustomDraft ? (
                        <>
                          <i
                            className="p-dot"
                            style={{ background: `hsl(${providerHue(provider.id)} 42% 46%)` }}
                          >
                            {provider.name.slice(0, 1)}
                          </i>
                          {provider.name}
                          <i className={"auth-dot " + provider.auth} />
                        </>
                      ) : isCustomDraft ? (
                        <>
                          <i className="p-dot" style={{ background: "var(--muted)" }}>
                            ＋
                          </i>
                          添加自定义厂商
                        </>
                      ) : (
                        <span className="ph">选择厂商</span>
                      )}
                      <ChevronDown size={13} />
                    </button>
                    {providerOpen && (
                      <>
                        <div
                          className="menu-overlay"
                          onClick={() => setProviderOpen(false)}
                        />
                        <div className="session-menu provider-menu">
                          {providers.map((p) => (
                            <button
                              type="button"
                              key={p.id}
                              className={draftProvider === p.id ? "current" : ""}
                              onClick={() => {
                                setDraftProvider(p.id);
                                setDraftModel(p.models[0]?.id ?? "");
                                setShowAll(false);
                                setSaved(false);
                                setError("");
                                setProviderOpen(false);
                              }}
                            >
                              <i
                                className="p-dot"
                                style={{ background: `hsl(${providerHue(p.id)} 42% 46%)` }}
                              >
                                {p.name.slice(0, 1)}
                              </i>
                              {p.name}
                              <i className={"auth-dot " + p.auth} />
                            </button>
                          ))}
                          <button
                            type="button"
                            className={isCustomDraft ? "current" : ""}
                            onClick={() => {
                              setDraftProvider(CUSTOM_NEW);
                              setSaved(false);
                              setError("");
                              setProviderOpen(false);
                            }}
                          >
                            <i className="p-dot" style={{ background: "var(--muted)" }}>
                              <Plus size={11} />
                            </i>
                            添加自定义厂商
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="step-label">
                    <i>2</i> 填入 API Key
                  </div>
                  <div className="key-input">
                    <input
                      autoComplete="off"
                      type={show ? "text" : "password"}
                      value={key}
                      placeholder={
                        provider?.auth === "ready" ? "已配置，可更新" : "输入你的 API Key"
                      }
                      onChange={(e) => setKey(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={show ? "隐藏密钥" : "显示密钥"}
                      onClick={() => setShow(!show)}
                    >
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="fetch-models"
                    onClick={() => void detectModels()}
                    disabled={fetching || (!key.trim() && provider?.auth !== "ready")}
                    title={!key.trim() ? "先填入 API Key" : undefined}
                  >
                    {fetching ? <LoaderCircle size={13} className="spin" /> : <ChevronDown size={13} />}
                    {pillModels.length ? "重新检测模型" : "检测模型"}
                  </button>

                  {isCustomDraft && (
                    <>
                      <div className="step-label">
                        <i>3</i> 厂商信息
                      </div>
                      <input
                        className="inline-field"
                        value={customName}
                        placeholder="名称，例如：本地网关"
                        onChange={(e) => setCustomName(e.target.value)}
                      />
                      <input
                        className="inline-field"
                        required
                        type="url"
                        value={customBase}
                        placeholder="API 地址（OpenAI 兼容），如 https://api.example.com/v1"
                        onChange={(e) => setCustomBase(e.target.value)}
                      />
                      <button
                        type="button"
                        className="fetch-models"
                        onClick={() => void fetchModels()}
                        disabled={fetching || !customBase || !key}
                        title={!key ? "先填入 API Key" : undefined}
                      >
                        {fetching ? (
                          <LoaderCircle size={13} className="spin" />
                        ) : (
                          <ChevronDown size={13} />
                        )}
                        {remoteModels.length
                          ? "重新检测模型"
                          : "检测模型（需要已填 Key）"}
                      </button>
                      {remoteModels.length > 0 && (
                        <div className="step-label">
                          <i>4</i> 选择模型
                        </div>
                      )}
                    </>
                  )}

                  {provider && !isCustomDraft && (
                    <div className="step-label">
                      <i>3</i> 选择模型
                    </div>
                  )}
                  {((provider && !isCustomDraft) || remoteModels.length > 0) && (
                    <div className="model-pills">
                      {(showAll ? pillModels : pillModels.slice(0, 4)).map((m) => {
                        const multi = !isCustomDraft;
                        const active = multi ? selectedModels.includes(m.id) : currentModel === m.id;
                        return (
                          <button
                            type="button"
                            key={m.id}
                            className={"model-pill" + (active ? " selected" : "")}
                            onClick={() => {
                              if (multi) {
                                toggleModel(m.id);
                                if (!selectedModels.includes(m.id)) pickModel(m.id);
                              } else {
                                pickModel(m.id);
                              }
                            }}
                          >
                            <span>{m.name}</span>
                            {m.reasoning ? <i>思考</i> : null}
                          </button>
                        );
                      })}
                      {pillModels.length > 4 && (
                        <div className="group-anchor">
                          <button
                            type="button"
                            className="show-all"
                            onClick={() => setMoreOpen(!moreOpen)}
                          >
                            其他 {pillModels.length - 4} 个 <ChevronDown size={12} />
                          </button>
                          {moreOpen && (
                            <>
                              <div className="menu-overlay" onClick={() => setMoreOpen(false)} />
                              <div className="session-menu model-more">
                                {pillModels.slice(4).map((m) => (
                                  <button
                                    type="button"
                                    key={m.id}
                                    className={selectedModels.includes(m.id) ? "current" : ""}
                                    onClick={() => {
                                      toggleModel(m.id);
                                      pickModel(m.id);
                                    }}
                                  >
                                    <span>{m.name}</span>
                                    {selectedModels.includes(m.id) && <Check size={13} />}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* 检测不到模型时退化为手动输入模型 ID */}
                  {!isCustomDraft && pillModels.length === 0 && detected && (
                    <input
                      className="inline-field"
                      value={draftModel}
                      placeholder="没检测到模型，手动填写模型 ID"
                      onChange={(e) => setDraftModel(e.target.value)}
                    />
                  )}
                  {isCustomDraft && remoteModels.length === 0 && (
                    <input
                      className="inline-field"
                      value={customModel}
                      placeholder={detected ? "没检测到模型，手动填写模型 ID" : "或手动填写模型 ID"}
                      onChange={(e) => setCustomModel(e.target.value)}
                    />
                  )}

                  {error && <div className="run-error">{error}</div>}
                  <div className="notice">
                    Key 保存在本机应用数据目录（仅当前用户可读），注入引擎使用；不会上传或回显。
                  </div>
                  <div className="settings-actions">
                    <span>
                      {saved ? (
                        <>
                          <Check size={14} /> 已连接
                        </>
                      ) : null}
                    </span>
                    <Button type="submit" variant="primary" disabled={saving}>
                      {saving ? <LoaderCircle size={15} className="spin" /> : null}
                      保存并使用
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="runtime-info">
                  <Server size={30} />
                  <h3>引擎未连接</h3>
                  <p>
                    当前是界面预览模式。运行 npm run start 启动本地引擎后，这里可以配置模型。
                  </p>
                </div>
              )
            ) : tab === "profile" ? (
              <div className="profile-panel">
                <label className="profile-field">
                  <span>用户名</span>
                  <input
                    value={userProfile.name}
                    placeholder="你的名字"
                    onChange={(e) => onUserProfile({ ...userProfile, name: e.target.value })}
                  />
                </label>
                <div className="profile-field">
                  <span>头像</span>
                  <div className="profile-avatar-row">
                    <span className="user-avatar">
                      {userProfile.avatar ? (
                        <img src={userProfile.avatar} alt="" />
                      ) : userProfile.name.trim() ? (
                        userProfile.name.trim()[0].toUpperCase()
                      ) : (
                        <User size={16} />
                      )}
                    </span>
                    <input
                      ref={avatarInput}
                      type="file"
                      accept="image/*"
                      className="attach-file-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        setAvatarError("");
                        void readAvatarFile(file)
                          .then((dataUrl) => onUserProfile({ ...userProfile, avatar: dataUrl }))
                          .catch((err) => setAvatarError(err instanceof Error ? err.message : "头像设置失败"));
                      }}
                    />
                    <button className="ghost-action" onClick={() => avatarInput.current?.click()}>
                      选择图片
                    </button>
                    {userProfile.avatar && (
                      <button
                        className="ghost-action"
                        onClick={() => onUserProfile({ ...userProfile, avatar: undefined })}
                      >
                        移除
                      </button>
                    )}
                  </div>
                  {avatarError && <p className="profile-error">{avatarError}</p>}
                </div>
              </div>
            ) : tab === "appearance" ? (
              <div className="theme-options">
                {(["light", "dark", "system"] as Theme[]).map((t, i) => (
                  <button
                    key={t}
                    className={theme === t ? "active" : ""}
                    onClick={() => setTheme(t)}
                  >
                    <div className={"theme-preview " + t}>
                      <i />
                      <span />
                    </div>
                    {["浅色", "深色", "跟随系统"][i]}
                    {theme === t && <Check size={14} />}
                  </button>
                ))}
                <p>动效自动遵循系统的“减弱动态效果”设置。</p>
              </div>
            ) : (
              <div className="runtime-info">
                <Server size={30} />
                <h3>{isLive ? "引擎已连接" : "界面已就绪"}</h3>
                <p>
                  {isLive
                    ? `本地引擎运行中 · Node ${handshake?.node ?? ""}`
                    : "当前使用独立的预览适配器，模型与文件访问未连接。"}
                </p>
                <div>
                  <span>Agent 引擎</span>
                  <b>{isLive ? "已连接" : "待接入"}</b>
                </div>
                <div>
                  <span>工作目录</span>
                  <b>{isLive ? handshake?.cwd ?? "-" : "-"}</b>
                </div>
                <div>
                  <span>密钥存储</span>
                  <b>{isLive ? "引擎内存" : "待接入"}</b>
                </div>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
