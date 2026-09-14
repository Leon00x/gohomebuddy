import * as nodePath from "node:path";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveDir(value: string | undefined, fallback: string): string {
  const raw = value && value.trim() ? value : fallback;
  return nodePath.resolve(raw.startsWith("~") ? raw.replace("~", process.env.HOME ?? "") : raw);
}

// 延迟加载引擎：必须先把 PI_CODING_AGENT_DIR 固定好，某些依赖在模块初始化时
// 就解析全局路径。入口不能使用顶层 await——SEA/esbuild 的 CJS 产物不支持。
async function main(): Promise<void> {
  process.env.PI_CODING_AGENT_DIR = resolveDir(
    arg("--agent-dir"),
    nodePath.join(process.env.HOME ?? "", ".office-agent", "pi"),
  );
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const cwd = resolveDir(arg("--cwd"), process.cwd());

  const [{ PiRuntime }, { SidecarServer }] = await Promise.all([
    import("./runtime.js"),
    import("./server.js"),
  ]);

  const runtime = new PiRuntime({
    agentDir,
    cwd,
    emit: (type, runId, payload) => server.emit(type, runId, payload),
  });
  const server = new SidecarServer(runtime);

  process.on("uncaughtException", (err) => {
    server.log("error", `未捕获异常: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  });
  process.on("unhandledRejection", (reason) => {
    server.log("error", `未处理的 Promise 拒绝: ${reason instanceof Error ? reason.message : String(reason)}`);
  });

  server.listen();
  void runtime
    .handshake()
    .then(() => server.log("info", `sidecar 就绪 path=${agentDir} cwd=${cwd}`))
    .catch((err) => server.log("error", `初始化失败: ${err instanceof Error ? err.message : String(err)}`));
}

void main().catch((err) => {
  process.stderr.write(`启动失败: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
