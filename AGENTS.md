# AGENTS.md — 编码代理工作规范

本文件是所有编码代理在本仓库工作时的必读规范。

## 工作流硬规则（最高优先级）

**需求必须先走文档，再动代码：**

1. 与用户讨论需求，直到确认。
2. 确认后，**先更新 `docs/prd.md`**（涉及范围/边界变化时同步 `docs/mvp-scope.md`），并在 `docs/process-log.md` 追加一条过程记录（日期、需求、决定、影响面）。
3. 文档更新完成后才允许开始编码。
4. 禁止在未更新文档的情况下自行扩大功能范围；发现文档与代码不一致时，先修文档。

## 项目概要

产品名 **GoHomeBuddy**（中文名：下班搭子，标语 "Get work done. Go home earlier."）：基于 pi-coding-agent 的桌面个人 Agent（Tauri 2 + React + TypeScript + Node sidecar）。
产品形态与边界见 `docs/prd.md`、`docs/mvp-scope.md`；架构决策见 `docs/technical-architecture.md`；技术验证记录见 `docs/s0-validation.md`。

## 常用命令

```sh
npm run start     # 一键启动：vite(1420) + bridge + sidecar
npm run dev       # 仅 vite（无引擎时自动预览模式）
npm run smoke     # sidecar 协议冒烟（14 项，无需 API Key）
npm run build     # 类型检查 + 生产构建
OFFICE_AGENT_ROOT=$PWD npm run tauri -w @office/desktop -- build   # 打包 deb
```

## 架构边界

- 分层：UI → 桥（dev: WebSocket / 打包: 待接 Tauri IPC）→ sidecar（stdio JSONL）→ pi 引擎。
- 协议命令/事件类型只在 `packages/contracts` 定义，改协议先改这里，UI 与 sidecar 同步更新。
- UI 不直接 import pi；pi 细节全部封在 `apps/sidecar`。
- 单活跃 run；命令响应只表示接受/拒绝，结果靠事件（带 runId）送达。
- API Key 保存在应用隔离认证文件（`~/.office-agent/pi/auth.json`，0600），后续迁移系统凭证库；用户数据在 `~/.office-agent/pi` 与 `~/office-agent-workspace`。

## UI 规范（用户明确要求）

- 界面不放无意义文案（欢迎语、宣传语、脚注指导等一律不加）。
- 禁止 `window.prompt/alert`；创建/重命名类输入用浮层内联表单（参考 ws-pop / menu-input-row 模式）。
- 模型显示友好名（如 "DeepSeek V4 Flash"），不拼 provider 前缀。
- 设置页避免原生 `<select>` 堆砌，用自定义下拉/胶囊点选。
- UI 与文档中不出现 pi 字样，对外统一称"本地引擎"。
- 动效遵循系统减弱动态效果设置；改动需过浅色/深色双主题检查。

## 已知坑（改代码前先看）

- Tauri 窗口命令必须在 `src-tauri/capabilities/main.json` 显式授权（`core:window:default` 不含 minimize/close/start-dragging）；命令名为下划线（`toggle_maximize`）。
- 桥是单客户端：应用界面连上后，其他 WS 客户端会被 4000 拒绝（测试时勿误判为故障）。
- sidecar 通过 `PI_CODING_AGENT_DIR` 隔离数据目录；打包二进制的仓库根路径编译期由 `OFFICE_AGENT_ROOT` 固化。
- 子进程 spawn ENOENT 先查 cwd 是否存在。
- 新增 UI 浮层注意 z-index：遮罩 30，浮层需 40+，否则菜单会被遮罩吞掉点击。

## 提交前自检

- `npm run typecheck` 与 `npm run build` 通过。
- 涉及 sidecar 协议时跑 `npm run smoke`。
- 浏览器实际操作回归（连接、发送、设置、工作空间），不凭类型检查断言正确。
