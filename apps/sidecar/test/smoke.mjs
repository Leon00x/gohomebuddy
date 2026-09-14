// S0 smoke: spawn the built sidecar and exercise the protocol end to end.
// Offline-safe: no model API key is used; the run phase expects an auth error,
// which still proves the event pipeline (start -> events -> run.end) works.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import * as os from "node:os";
import * as nodePath from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = nodePath.resolve(new URL("..", import.meta.url).pathname);
const dataDir = await mkdtemp(nodePath.join(os.tmpdir(), "office-agent-smoke-"));
const workspaceDir = nodePath.join(dataDir, "workspace");
const alternateWorkspaceDir = nodePath.join(dataDir, "alternate-workspace");
await mkdir(workspaceDir, { recursive: true });
await mkdir(alternateWorkspaceDir, { recursive: true });
await writeFile(nodePath.join(workspaceDir, "probe-attachment.txt"), "ok");
await writeFile(nodePath.join(alternateWorkspaceDir, "workspace-switch.txt"), "ok");

process.env.PI_OFFLINE = "1";
const agentDir = nodePath.join(dataDir, "pi");
process.env.PI_CODING_AGENT_DIR = agentDir;
const [{ PiRuntime }, { SidecarServer }] = await Promise.all([
  import(nodePath.join(root, "dist", "runtime.js")),
  import(nodePath.join(root, "dist", "server.js")),
]);
const input = new PassThrough();
const output = new PassThrough();
const runtime = new PiRuntime({
  agentDir,
  cwd: workspaceDir,
  emit: (type, runId, payload) => server.emit(type, runId, payload),
});
const server = new SidecarServer(runtime);
server.listen(input, output, false);

const lines = createInterface({ input: output, crlfDelay: Infinity });
const stderr = [];

const pending = new Map();
let nextId = 0;
lines.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    stderr.push(`NON-JSON STDOUT: ${line}`);
    return;
  }
  if (msg.requestId && pending.has(msg.requestId)) {
    pending.get(msg.requestId)(msg);
    pending.delete(msg.requestId);
  }
});

const events = [];
// Tap every protocol line; responses resolve pending requests above,
// event frames (eventId) are kept for pipeline assertions.
const allLines = [];
lines.on("line", (line) => allLines.push(line));

function request(method, params = {}) {
  const requestId = `req-${++nextId}`;
  return new Promise((resolve, reject) => {
    pending.set(requestId, resolve);
    input.write(JSON.stringify({ protocolVersion: 1, requestId, method, params }) + "\n");
    delay(30000).then(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error(`timeout waiting for ${method}`));
      }
    });
  });
}

function drainEvents(afterIndex) {
  return allLines
    .slice(afterIndex)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((m) => m && m.type !== undefined && m.eventId);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  // 1. handshake
  const hs = await request("handshake");
  check("handshake", hs.ok === true && hs.payload?.runtime === "pi", JSON.stringify(hs.payload ?? hs.error));

  // 2. providers include deepseek + zhipu/zai
  const provs = await request("config.providers");
  const ids = (provs.payload ?? []).map((p) => p.id);
  check(
    "config.providers",
    provs.ok && ids.includes("deepseek") && ids.includes("zhipu"),
    `providers=[${ids.join(", ")}]`,
  );
  const deepseek = (provs.payload ?? []).find((p) => p.id === "deepseek");
  check(
    "deepseek preset has baseUrl",
    !!deepseek && !!deepseek.baseUrl,
    deepseek ? `baseUrl=${deepseek.baseUrl} models=${deepseek.models.length}` : "missing",
  );

  // 3.1 模型清单由应用配置：写入一个模型后，该厂商应变为可按模型解析。
  const probeModelId = "smoke-model-1";
  await request("config.custom.save", {
    provider: {
      id: "deepseek",
      name: "DeepSeek",
      baseUrl: deepseek.baseUrl,
      api: "openai-completions",
      models: [{ id: probeModelId, name: probeModelId, reasoning: true, contextWindow: 128000, maxTokens: 8192 }],
    },
  });
  const provs2 = await request("config.providers");
  const ds2 = (provs2.payload ?? []).find((p) => p.id === "deepseek");
  check(
    "app-managed model list is used",
    !!ds2 && ds2.models.some((m) => m.id === probeModelId),
    `models=[${(ds2?.models ?? []).map((m) => m.id).join(", ")}]`,
  );

  // 3. session create + open (listing happens after runs: pi indexes sessions
  //    from their first persisted message, empty files stay unlisted)
  const created = await request("session.new");
  check("session.new", created.ok && !!created.payload?.file, JSON.stringify(created.payload ?? created.error));
  const opened = await request("session.open", { file: created.payload.file });
  check("session.open", opened.ok && Array.isArray(opened.payload?.messages), "empty snapshot ok");

  // 4. run pipeline: dummy key passes local auth checks, the real request 401s,
  //    proving acceptance -> events -> run.end(error) and run-lock release.
  await request("config.setApiKey", { providerId: "deepseek", apiKey: "sk-dummy-smoke-key" });
  const marker = allLines.length;
  const start = await request("run.start", {
    prompt: "ping",
    providerId: "deepseek",
    modelId: probeModelId,
    sessionTitle: "帮我整理 Excel",
  });
  check("run.start accepted", start.ok, JSON.stringify(start.payload ?? start.error));
  const deadline = Date.now() + 60000;
  let runEnd = null;
  while (Date.now() < deadline) {
    runEnd = drainEvents(marker).find((e) => e.type === "run.end");
    if (runEnd) break;
    await delay(500);
  }
  const evTypes = [...new Set(drainEvents(marker).map((e) => e.type))];
  check(
    "run pipeline delivered events",
    !!runEnd,
    `events=[${evTypes.join(", ")}] end=${JSON.stringify(runEnd?.payload ?? null)}`,
  );
  // After run.end the lock must be released: a new run.start gets accepted again.
  const restart = await request("run.start", { prompt: "ping2" });
  check("run lock released after end", restart.ok, JSON.stringify(restart.payload ?? restart.error));
  const secondRunId = typeof restart.payload === "string" ? restart.payload : restart.payload?.runId;
  const deadline2 = Date.now() + 60000;
  let secondEnd = null;
  while (Date.now() < deadline2) {
    secondEnd = drainEvents(marker).find((e) => e.type === "run.end" && e.payload?.runId === secondRunId);
    if (secondEnd) break;
    await delay(500);
  }
  check(
    "second run ends as error (bad key surfaces)",
    secondEnd?.payload?.reason === "error",
    JSON.stringify(secondEnd?.payload ?? null),
  );

  // 5. cancel on idle run must fail cleanly
  const idleCancel = await request("run.cancel");
  check("run.cancel without run rejected", idleCancel.ok === false && idleCancel.error?.code === "no_active_run", JSON.stringify(idleCancel.error ?? {}));

  // 6. session listing now sees the persisted sessions
  const list = await request("session.list");
  check("session.list after runs", list.ok && list.payload.length >= 1, `${list.payload?.length} sessions, first title: ${list.payload?.[0]?.title?.slice(0, 24)}`);

  // 6.1 会话标题来自 UI 显式传入的 sessionTitle，而不是被权限指令污染的 firstMessage
  check(
    "session title from sessionTitle param",
    list.payload?.some((s) => s.title === "帮我整理 Excel"),
    `titles=[${(list.payload ?? []).map((s) => s.title).join(" | ")}]`,
  );

  // 7. 当前会话切换 Workspace 后，文件能力随新的 cwd 切换。
  const switched = await request("session.setCwd", { cwd: alternateWorkspaceDir });
  const switchedFiles = await request("workspace.files");
  check(
    "session.setCwd switches workspace",
    switched.ok && (switchedFiles.payload?.files ?? []).some((f) => f.path === "workspace-switch.txt"),
    JSON.stringify(switchedFiles.payload ?? switched.error),
  );

  // 8. workspace.files lists workspace files for the attachment picker
  const wsFiles = await request("workspace.files");
  check(
    "workspace.files lists workspace",
    wsFiles.ok && (wsFiles.payload?.files ?? []).some((f) => f.path === "workspace-switch.txt"),
    JSON.stringify(wsFiles.payload?.files ?? wsFiles.error),
  );

  // 9. fs.import 落盘用户系统文件到工作空间
  const imported = await request("fs.import", {
    name: "截图 说明.png",
    dataBase64: Buffer.from("fake-image-bytes").toString("base64"),
  });
  check(
    "fs.import stores attachment",
    imported.ok && imported.payload?.path?.startsWith(".attachments/") && imported.payload.path.endsWith(".png"),
    JSON.stringify(imported.payload ?? imported.error),
  );

  // 9. unknown method + protocol version guard
  const unknown = await request("nope.nope");
  check("unknown method rejected", unknown.ok === false && unknown.error?.code === "unknown_method");
} catch (err) {
  check("smoke aborted", false, err.message);
} finally {
  input.end();
  runtime.dispose();
  await rm(dataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (stderr.length) console.log(`stderr tail:\n${stderr.slice(-8).join("\n")}`);
process.exit(failed.length ? 1 : 0);
