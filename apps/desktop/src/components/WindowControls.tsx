import { Minus, Square, X } from "lucide-react";

/** 仅在 Tauri 窗口内渲染窗口控制按钮；浏览器开发时自动隐藏。 */
export function WindowControls() {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<void>;
        metadata: { currentWindow: { label: string } };
      };
    }
  ).__TAURI_INTERNALS__;
  if (!internals) return null;
  const label = internals.metadata.currentWindow.label;
  const call = (action: string) =>
    void internals.invoke(`plugin:window|${action}`, { label }).catch(() => {});

  return (
    <div className="win-controls">
      <button aria-label="最小化" onClick={() => call("minimize")}>
        <Minus size={14} />
      </button>
      <button aria-label="最大化" onClick={() => call("toggle_maximize")}>
        <Square size={11} />
      </button>
      <button aria-label="关闭" className="wc-close" onClick={() => call("close")}>
        <X size={14} />
      </button>
    </div>
  );
}
