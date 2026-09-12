// Starts both dev processes (vite UI + sidecar bridge) and tears them down together.
// Child processes are launched as plain node entries (no npm/shell) so this works
// in environments where PATH shims are unreliable.
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";

const root = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), "../../..");

function nodeBin() {
  return process.env.OFFICE_NODE ?? process.execPath;
}

const tsc = nodePath.join(root, "node_modules/typescript/bin/tsc");
const vite = nodePath.join(root, "node_modules/vite/bin/vite.js");
const bridge = nodePath.join(root, "apps/desktop/scripts/bridge.mjs");
for (const file of [tsc, vite, bridge]) {
  if (!existsSync(file)) {
    console.error(`[start] 缺少 ${file}，请先 npm install`);
    process.exit(1);
  }
}

// Build contracts + sidecar up front; the UI and bridge consume the artifacts.
for (const project of ["packages/contracts", "apps/sidecar"]) {
  const build = spawnSync(nodeBin(), [tsc, "-p", nodePath.join(root, project, "tsconfig.json")], {
    stdio: "inherit",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const children = [];
function start(name, args, cwd) {
  const child = spawn(nodeBin(), args, { cwd, stdio: "inherit" });
  child.on("exit", (code) => {
    console.log(`[start] ${name} 退出 code=${code}`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(code), 400);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("bridge", [bridge], root);
start("vite", [vite, "--host", "127.0.0.1"], nodePath.join(root, "apps/desktop"));
