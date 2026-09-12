import { Check, ChevronDown, CircleAlert, LoaderCircle, Square } from "lucide-react";
import { useMemo, useState } from "react";
import type { ToolStep } from "@office/contracts";

const ARG_LABELS: Record<string, string> = {
  path: "路径",
  file_path: "文件路径",
  filePath: "文件路径",
  cmd_path: "执行目录",
  cwd: "工作目录",
  command: "命令",
  pattern: "匹配模式",
  query: "查询",
  content: "内容",
  old_string: "原文",
  new_string: "新内容",
  old_text: "原文",
  new_text: "新内容",
  url: "地址",
  description: "说明",
  overwrite: "覆盖",
  limit: "数量",
};

const STATUS_LABEL: Record<ToolStep["status"], string> = {
  running: "运行中",
  success: "完成",
  error: "出错",
  cancelled: "已停止",
};

function argEntries(args: unknown): { key: string; value: string; long: boolean }[] {
  if (args == null) return [];
  let obj = args;
  if (typeof args === "string") {
    try {
      obj = JSON.parse(args);
    } catch {
      return [{ key: "参数", value: args, long: args.length > 60 }];
    }
  }
  if (typeof obj !== "object" || obj === null) {
    return [{ key: "参数", value: String(obj), long: String(obj).length > 60 }];
  }
  return Object.entries(obj as Record<string, unknown>).map(([k, v]) => {
    let value: string;
    if (v === null) value = "null";
    else if (typeof v === "boolean") value = v ? "是" : "否";
    else if (typeof v === "object") value = JSON.stringify(v, null, 2);
    else value = String(v);
    if (value.length > 300) value = value.slice(0, 300) + "…";
    return { key: ARG_LABELS[k] ?? k, value, long: value.length > 60 };
  });
}

function diffStats(text: string): { added: number; removed: number } | null {
  if (!/^(\+\+\+|@@|diff )/m.test(text)) return null;
  let added = 0;
  let removed = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return added + removed > 0 ? { added, removed } : null;
}

export function ToolCard({ step }: { step: ToolStep }) {
  const [collapsed, setCollapsed] = useState(true);
  const entries = argEntries(step.args);
  const diff = useMemo(() => diffStats(step.output), [step.output]);
  const output = step.output.length > 2000 ? step.output.slice(0, 2000) + "\n…" : step.output;
  const inlineOutput = output.length <= 120 && !output.includes("\n");

  return (
    <div className={"tool-card2 status-" + step.status}>
      <button className="tc-row" onClick={() => setCollapsed(!collapsed)}>
        <span className="tc-dot">
          {step.status === "running" && <i className="tc-pulse" />}
        </span>
        <span className="tc-label">{step.label}</span>
        <code className="tc-target">{step.target}</code>
        {diff && (
          <span className="tc-diff">
            <em className="add">+{diff.added}</em>
            <em className="del">-{diff.removed}</em>
          </span>
        )}
        <span className="tc-status">{STATUS_LABEL[step.status]}</span>
        {step.status === "running" ? (
          <LoaderCircle size={13} className="spin" />
        ) : step.status === "success" ? (
          <Check size={13} />
        ) : step.status === "error" ? (
          <CircleAlert size={13} />
        ) : (
          <Square size={11} />
        )}
        <ChevronDown size={13} className={"tc-chev" + (collapsed ? " closed" : "")} />
      </button>
      {!collapsed && (
        <div className="tc-body">
          {entries.length > 0 && (
            <div className="tc-block">
              <div className="tc-block-label">参数</div>
              {entries.map((e, i) => (
                <div className="tc-arg" key={i}>
                  <span>{e.key}</span>
                  <code className={e.long ? "block" : ""}>{e.value}</code>
                </div>
              ))}
            </div>
          )}
          {output.trim() && (
            <div className="tc-block">
              <div className="tc-block-label">结果</div>
              {inlineOutput ? (
                <div className="tc-output-inline">{output}</div>
              ) : (
                <pre className="tc-output">{output}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
