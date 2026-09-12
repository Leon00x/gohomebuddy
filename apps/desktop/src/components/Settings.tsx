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
  Plus,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { CatalogProvider, ModelProfile } from "@office/contracts";
import { Button } from "./Button";
import type { ModelSelection, ProtocolClient } from "../lib/protocol-client";

export type Theme = "light" | "dark" | "system";

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
}) {
  const [tab, setTab] = useState("models");
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
    if (!customBase || !key) {
      setError("先填写 API 地址和 API Key 再获取模型列表");
      return;
    }
    setFetching(true);
    setError("");
    try {
      setRemoteModels(
        (await client.request("config.remoteModels", {
          baseUrl: customBase,
          apiKey: key,
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
      setKey("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
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
              Office Agent
              <br />0.1.0
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
                      {(showAll ? pillModels : pillModels.slice(0, 5)).map((m) => (
                        <button
                          type="button"
                          key={m.id}
                          className={"model-pill" + (currentModel === m.id ? " selected" : "")}
                          onClick={() => pickModel(m.id)}
                        >
                          <span>{m.name}</span>
                          {m.reasoning ? <i>思考</i> : null}
                        </button>
                      ))}
                      {pillModels.length > 5 && (
                        <button
                          type="button"
                          className="show-all"
                          onClick={() => setShowAll(!showAll)}
                        >
                          {showAll ? "收起" : `显示全部 ${pillModels.length} 个`}
                        </button>
                      )}
                    </div>
                  )}
                  {isCustomDraft && remoteModels.length === 0 && (
                    <input
                      className="inline-field"
                      value={customModel}
                      placeholder="或手动填写模型 ID"
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
