import { Check, ChevronDown, Cpu, Settings2 } from "lucide-react";
import { useState } from "react";
import type { CatalogProvider } from "@office/contracts";
import type { ModelSelection } from "../lib/protocol-client";

function providerHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** 模型选择芯片：显示友好模型名，点开按供应商分组的小菜单。 */
export function ModelMenu({
  providers,
  selection,
  onSelect,
  onOpenSettings,
  direction = "up",
  align = "right",
}: {
  providers: CatalogProvider[];
  selection: ModelSelection;
  onSelect: (v: ModelSelection) => void;
  onOpenSettings: () => void;
  direction?: "up" | "down";
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const catalogModel = providers
    .find((p) => p.id === selection.providerId)
    ?.models.find((m) => m.id === selection.modelId);
  const label = catalogModel?.name ?? selection.modelId ?? "选择模型";

  function pick(providerId: string, providerName: string, modelId: string) {
    onSelect({ providerId, providerName, modelId, thinkingLevel: selection.thinkingLevel });
    setOpen(false);
  }

  return (
    <div className="group-anchor">
      <button
        className="composer-model"
        onClick={() => setOpen(!open)}
        aria-label="选择模型"
      >
        <Cpu size={14} className="model-icon-narrow" />
        <span className="ctl-text">{label}</span>
        <ChevronDown size={12} className="ctl-chev" />
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div
            className={
              "session-menu model-menu " +
              (direction === "up" ? "open-up " : "open-down ") +
              (align === "left" ? "align-left" : "")
            }
          >
            <div className="mm-head">
              <span>模型</span>
              <button
                onClick={() => {
                  setOpen(false);
                  onOpenSettings();
                }}
              >
                <Settings2 size={13} />
                管理
              </button>
            </div>
            <div className="mm-list">
              {providers.map((p) => (
                <div key={p.id} className="mm-group">
                  <div className="mm-provider">
                    <i
                      className="p-dot"
                      style={{
                        background: `hsl(${providerHue(p.id)} 42% 46%)`,
                      }}
                    >
                      {p.name.slice(0, 1)}
                    </i>
                    {p.name}
                  </div>
                  {p.models.map((m) => {
                    const current = selection.providerId === p.id && selection.modelId === m.id;
                    return (
                      <button
                        key={m.id}
                        className={"mm-model" + (current ? " current" : "")}
                        onClick={() => pick(p.id, p.name, m.id)}
                      >
                        <span>{m.name}</span>
                        {current && <Check size={13} />}
                      </button>
                    );
                  })}
                </div>
              ))}
              {!providers.length && (
                <p className="mm-empty">正在获取可用模型…</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
