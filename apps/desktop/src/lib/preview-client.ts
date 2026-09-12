import type { AgentClient, ToolStep } from "@office/contracts";
const steps: ToolStep[] = [
  {
    id: "search",
    kind: "search",
    label: "搜索文件",
    target: "src/",
    output: "界面演示数据\nsrc/app.ts\nsrc/utils.ts\n没有访问本地文件。",
    status: "success",
  },
  {
    id: "read",
    kind: "read",
    label: "读取文件",
    target: "src/utils.ts",
    output:
      "// 示例内容，不来自你的项目\nexport const sum = (a: number, b: number) => a + b;",
    status: "success",
  },
  {
    id: "shell",
    kind: "shell",
    label: "执行命令",
    target: "npm test",
    output: "这是工具输出布局演示。\n没有实际执行命令。",
    status: "success",
  },
];
export const previewClient: AgentClient = {
  mode: "preview",
  async run(_prompt, signal, onStep) {
    for (const step of steps) {
      signal.throwIfAborted();
      onStep({ ...step, status: "running" });
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 850);
        signal.addEventListener("abort", abort, { once: true });
      });
      signal.throwIfAborted();
      onStep(step);
    }
    return "执行过程预览已完成。你可以展开上方的工具卡片，查看参数和输出布局。\n\n这次没有调用模型、读取文件或执行命令。启动本地引擎后即可进行真实对话。";
  },
};
