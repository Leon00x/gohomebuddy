// Dev bridge: pipes the sidecar's stdio JSONL protocol to WebSocket frames so
// the browser UI can talk to real pi during development. Production uses the
// Tauri IPC transport instead of this process.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import * as http from "node:http";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PORT = 1421;
const here = nodePath.dirname(fileURLToPath(import.meta.url));
const sidecarEntry = nodePath.resolve(here, "../../sidecar/dist/index.js");
const agentDir = process.env.OFFICE_AGENT_DIR ?? nodePath.join(process.env.HOME ?? "", ".office-agent", "pi");
const workspace = process.env.OFFICE_WORKSPACE ?? nodePath.join(process.env.HOME ?? "", "office-agent-workspace");

mkdirSync(agentDir, { recursive: true });
mkdirSync(workspace, { recursive: true });

function nodeBin() {
  return process.env.OFFICE_NODE ?? process.execPath;
}

let sidecar = null;

function log(line) {
  process.stderr.write(`[bridge] ${line}\n`);
}

function ensureSidecar() {
  if (sidecar && sidecar.exitCode === null) return sidecar;
  log(`启动 sidecar: agentDir=${agentDir} cwd=${workspace}`);
  sidecar = spawn(nodeBin(), [sidecarEntry, "--agent-dir", agentDir, "--cwd", workspace], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  sidecar.stderr.on("data", (d) => process.stderr.write(`[sidecar] ${d}`));
  sidecar.on("exit", (code) => log(`sidecar 退出 code=${code}`));
  return sidecar;
}

const server = http.createServer((_req, res) => {
  res.writeHead(426);
  res.end("WebSocket only");
});
const wss = new WebSocketServer({ server });

let activeSocket = null;

wss.on("connection", (ws) => {
  if (activeSocket && activeSocket.readyState === 1) {
    log("已有客户端连接，拒绝新连接");
    ws.close(4000, "another client is connected");
    return;
  }
  activeSocket = ws;
  // 心跳：客户端失联（无 close 帧）时及时清位，避免幽灵连接占坑
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    try {
      ws.ping();
    } catch {}
  }, 10000);
  ws.on("close", () => clearInterval(heartbeat));
  ws.on("error", () => clearInterval(heartbeat));
  const proc = ensureSidecar();
  log("客户端已连接");
  // stdout 帧必须按换行重组后整帧转发：大帧（如 session.open 的会话快照）
  // 会跨 chunk 到达，直接按 chunk 切行会把一帧撕成两段，UI 解析失败即永久丢响应。
  let stdoutBuf = "";
  const onSidecarData = (buf) => {
    stdoutBuf += buf.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line) ws.send(line);
    }
  };
  proc.stdout.on("data", onSidecarData);
  ws.on("message", (data) => {
    const text = data.toString();
    try {
      const parsed = JSON.parse(text);
      log(`-> ${parsed.method} req=${parsed.requestId}`);
    } catch {}
    if (proc.stdin.writable) proc.stdin.write(text.replace(/\n/g, "") + "\n");
  });
  const onWsSendLog = (buf) => {};
  const origSend = ws.send.bind(ws);
  ws.send = (frame) => {
    try {
      const parsed = JSON.parse(frame);
      if (parsed.requestId) {
        log(`<- resp req=${parsed.requestId} ok=${parsed.ok} err=${parsed.error ? parsed.error.message : ""}`);
      } else if (parsed.eventId) {
        log(`<- evt ${parsed.type} run=${parsed.runId ?? "-"}`);
      }
    } catch {}
    origSend(frame);
  };
  const cleanup = () => {
    proc.stdout.off("data", onSidecarData);
    if (activeSocket === ws) activeSocket = null;
    log("客户端断开");
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

server.listen(PORT, "127.0.0.1", () => {
  log(`dev bridge 就绪 ws://127.0.0.1:${PORT}`);
  log(`agentDir=${agentDir}`);
  log(`workspace=${workspace}`);
});
