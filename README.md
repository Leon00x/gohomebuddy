# GoHomeBuddy（下班搭子）

**Get work done. Go home earlier.**

桌面个人 Agent：配置自己的模型，选一个本地目录，用自然语言让它读写文件、执行命令、搜索内容；工作过程透明可见，产物一键打开。当前状态：**浏览器开发版已全链路可用**——界面连接真实本地引擎，可配置厂商、保存 Key、进行真实对话并执行文件与命令工具。

## 快速开始

```sh
npm install
npm run start     # 一键启动：界面(1420) + dev 桥(1421) + 本地引擎 sidecar
```

浏览器打开 http://127.0.0.1:1420，在"设置"里选择厂商和模型、填入 API Key 即可开始。Key 保存到应用隔离目录的引擎认证文件（0600 权限），跨重启可用；系统凭证库是后续项。Agent 的工作目录是 `~/office-agent-workspace`（可用环境变量 `OFFICE_WORKSPACE` 覆盖）。

## 常用命令与开发测试流程

```sh
npm run start     # 一键启动：vite(1420) + dev 桥 + 本地引擎 sidecar（开发用）
npm run dev       # 仅启动界面（无引擎时自动降级为预览演示模式）
npm run typecheck # TypeScript 类型检查
npm run build     # 类型检查 + 生产构建（contracts → desktop，含分包）
npm run smoke     # sidecar 协议冒烟（14 项，无需 API Key）
npm run desktop   # Tauri 开发窗口（需要 Rust）
```

开发流程约定见 [AGENTS.md](./AGENTS.md)：需求先更新 `docs/prd.md` 与 `docs/process-log.md` 再编码；提交前自检 = typecheck + build 通过、协议变更跑 smoke、浏览器实际操作回归（连接、发送、设置、工作空间、浅深双主题）。

桌面构建（Linux deb；Windows 打包未验证）：

```sh
OFFICE_AGENT_ROOT=$PWD npm run tauri -w @office/desktop -- build
```

## 当前可用

**真实 Agent 链路**

- UI → WebSocket 桥 → sidecar（stdio JSONL）→ 本地引擎。
- Codex 式执行过程：运行时过程面板展开并持续更新，正常完成后折叠为耗时/步骤摘要，正式回答显示在下方；思考行可点击展开内容。
- 模型选择：友好模型名、按供应商分组；思考强度滑杆（仅推理模型显示）。
- 文件上下文引用：输入框 + 号选择工作空间文件，发送时按需读取。
- 权限模式三档（变更前确认 / 自动编辑 / 完全访问）：档位随任务注入引擎行为指令（提示词级约束；硬性审批拦截待引擎扩展机制调研）。
- 产物卡片：write/edit 后展示文件卡，打开/在文件夹中显示；工具行有类型图标、可展开参数与结果。
- 会话：引擎持久化（应用隔离目录 `~/.office-agent/pi`）、工作空间分组、重命名、删除（应用内确认框）。
- 模型配置：DeepSeek / 智谱 GLM / Z.AI / Z.ai Coding 内置目录 + 自定义 OpenAI 兼容端点；Key 可跨重启使用。

**界面**

- 灰绿桌面视觉、浅/深/跟随系统主题、关键动效、减弱动态效果支持。
- 未连接运行时时自动降级为界面预览模式（演示工具卡片交互）。

**尚未完成**

- 系统凭证存储；当前 Key 位于应用隔离认证文件中。
- 智谱和自定义端点的真实流式/工具往返验收。
- 权限模式的硬性审批拦截（Approval Card）；当前为提示词级约束。
- 自动会话标题、代码高亮、Windows 安装与 PowerShell 验证。

## 结构

- `apps/desktop`：React UI + `scripts/bridge.mjs`（WS↔stdio 桥，按换行整帧转发）+ `scripts/start.mjs`（一键启动）+ `src-tauri`（桌面壳）。
- `apps/sidecar`：本地引擎宿主（pi-coding-agent SDK 宿主），协议见 `packages/contracts`，冒烟见 `test/smoke.mjs`。
- `packages/contracts`：协议命令与事件类型（编译到 dist）。
- `docs`：产品需求、范围、架构、验证记录与过程流水，索引见 [docs/README.md](./docs/README.md)。

前端和日志不保存或回显 API Key；Key 写入应用隔离认证文件，桌面版后续迁移到系统凭证库。
