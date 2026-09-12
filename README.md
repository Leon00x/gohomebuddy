# Office Agent

桌面个人 Agent。当前状态：**浏览器开发版已全链路可用**——界面已连接真实本地引擎，可配置厂商、保存 Key、进行真实对话并执行文件与命令工具。

## 启动

```sh
npm install
npm run start     # 一条命令拉起 界面(1420) + dev bridge + pi sidecar
```

浏览器打开 http://127.0.0.1:1420，在“设置”里选择厂商和模型、填入 API Key，即可开始真实对话。Key 保存到应用隔离目录的引擎认证文件，文件权限为 0600；尚未接入系统凭证库。Agent 的工作目录是 `~/office-agent-workspace`（可用环境变量 `OFFICE_WORKSPACE` 覆盖）。

```sh
npm run dev       # 仅启动界面（无运行时自动降级为预览演示模式）
npm run smoke     # sidecar 协议冒烟（13 项，无需 API Key）
npm run build     # 类型检查 + 生产构建
npm run desktop   # Tauri 开发窗口（需要 Rust；当前仍是开发容器）
```

开发需要 Node 22；最终用户免装 Node 属于后续打包工作。

## 当前可用

**真实 Agent 链路**

- UI → WebSocket 桥 → sidecar（stdio JSONL）→ 本地 Agent 引擎。
- 模型选择：模型菜单显示友好模型名、按供应商分组；思考强度滑杆（关闭/低/中/高/最高，仅推理模型显示）。
- Codex 式执行过程：运行时展开并持续更新，正常完成后折叠为耗时/步骤摘要，正式回答显示在下方。
- 流式回复（稳定前缀缓存）、工具卡片（状态点/参数/结果）、运行中排队、停止、错误展示。
- 代码块语言标签与复制、回复富文本复制、输入框自适应高度、回到底部。
- 会话：引擎持久化（应用隔离目录 `~/.office-agent/pi`），工作空间分组、会话移动、重命名和删除。
- 模型配置：DeepSeek / 智谱 GLM / Z.AI / Z.ai Coding 内置目录 + 自定义 OpenAI 兼容端点；Key 可跨重启使用。

**界面**

- Linear 风格布局、深浅主题、关键动效、减弱动态效果支持。
- 未连接运行时时自动降级为界面预览模式（演示工具卡片交互）。

**尚未完成**

- 系统凭证存储；当前 Key 位于应用隔离认证文件中。
- 智谱和自定义端点的真实流式/工具往返验收。
- 引擎级权限拦截与操作确认；当前三档权限模式只有 UI 和持久化。
- 自动会话标题、代码高亮、Windows 安装与 PowerShell 验证。

## 结构

- `apps/desktop`：React UI + `scripts/bridge.mjs`（WS↔stdio 桥）+ `scripts/start.mjs`（一键启动）。
- `apps/sidecar`：本地引擎宿主，协议见 `packages/contracts`，冒烟见 `test/smoke.mjs`。
- `packages/contracts`：协议命令与事件类型（编译到 dist）。
- `docs`：PRD、MVP 范围、架构、S0 验证记录。

前端和日志不保存或回显 API Key；sidecar 当前写入应用隔离认证文件，桌面版后续迁移到系统凭证库。
