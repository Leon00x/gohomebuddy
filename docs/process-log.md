# 过程记录

每条记录：日期 · 需求/决定 · 影响面 · 状态。新记录追加在顶部。按 AGENTS.md 规则，需求确认后先更新 PRD/本文档，再编码。

---

## 2026-09-13（思考行展开 / 工具栏响应式 / 权限模式接入引擎）

- **用户反馈**：①完成态点击"思考 · 持续了 x 秒"要能展开思考内容；②窄屏下输入框控制条不得竖排，收敛为纯图标；③质问权限模式是否真的生效，要求分档图标（完全访问=橘红盾叹号）+ 向上展开菜单（参考 ZCode）。
- **改动**：
  - 思考行完成态可点击展开/收起思考内容（左线缩进引用块）；工具行本就可展开。
  - 控制条文本包 `ctl-text`，≤920px 时隐藏文字与箭头、只留图标（权限=盾、思考=脑、模型=Cpu），`flex-wrap: nowrap` 禁止竖排。
  - **权限首次接入引擎**：`run.start` 新增 `permissionMode`，sidecar 按档位在 prompt 前注入行为指令（变更前确认/自动编辑/完全访问三套文案），已用临时目录探针验证注入。**如实说明：这是提示词级约束，模型遵守度不保证；pi SDK 无审批钩子，硬拦截（Approval Card）仍是 P0-5 遗留。**
  - 权限触发器与菜单分档图标：询问=Hand、自动编辑=ShieldCheck（绿）、完全访问=ShieldAlert（橘红 warning 色）；菜单项图标+标题+描述+当前勾。
- **状态**：已完成，typecheck/build/smoke 13/13 通过；已重启引擎进程并验证重连。

## 2026-09-13（执行过程细节打磨：动作图标 + 思考行改版）

- **用户反馈**：①执行命令行也要有对应图标，所有动作都应有图标；②"分析"改叫"思考"，完成态显示"思考 · 持续了 x 秒"；思考过程不显示文本段，运行中为一行快速闪动内容（脉冲），参考 ZCode。
- **改动**：ToolCard 状态点改为类型图标（读取=FileText、搜索=Search、编辑=Pencil、命令=Terminal；运行中脉冲、出错红）；ActivityTimeline 思考行改版并移除 think-raw 文本段预览；补上一直缺失的 `dot-pulse` keyframes（活动头运行圆点此前实际未动画）；顺带修复思考行图标文字叠行（tailwind preflight svg:block + 容器 display:block）。
- **状态**：已完成，typecheck/build 通过，HMR 即时生效。

## 2026-09-13（P1 启动：控制栏附件 / Workspace 信息 / Header 运行信息 / Hover 体系）

- **用户确认**：继续实施 commercial-ui-prd.md 已确认的 P1 四项，同时清掉两处 UI 规范违规。
- **实现决定**：
  - 附件按主 PRD F03"文件上下文引用"落地：sidecar 新增 `workspace.files`（列 cwd 相对路径，跳过隐藏与依赖目录，上限 400 条）；Composer 加回形针浮层（搜索 + 勾选），选中文件以可移除标签展示；发送时以"引用工作空间文件"清单并入 prompt，工具按需读取，不整文件塞上下文；不改 `run.start` 协议语义。
  - Workspace 信息放 Header：cwd 名 chip + 浮层（完整路径 / 打开目录 / 复制路径 / 本会话产物，点击即打开）；无产物时如实显示，不放假数据。
  - Hover 反馈体系：会话行 ••• hover 显隐、Tool/Artifact 卡 hover、全局 focus-visible，遵循过渡三档 token。
  - 规范违规清理：Composer 新建工作空间的 `window.prompt` 改浮层内联输入（menu-input-row 模式）；删会话/删工作空间的 `window.confirm` 改应用内 ConfirmDialog（Danger 主按钮，z-40 避开遮罩坑）。
- **影响面**：contracts + sidecar（smoke 增至 13 项）+ Composer/App + styles.css；README/AGENTS 冒烟计数同步为 13。
- **结果（已验证）**：
  - 附件端到端：浮层列出工作空间文件（搜索过滤）、选中出标签、发送后引擎记录的 prompt 含"引用工作空间文件"清单，模型真实执行读取文件并答出内容；发送后标签自动清空。重试/继续沿用消息内原始 prompt（含引用）。
  - Header 工作空间浮层：chip 显示 cwd 名，浮层含完整路径/打开目录/复制路径/本会话产物（空态如实显示），浅深双主题检查通过。
  - ConfirmDialog：删会话/删工作空间均走应用内确认框（Danger 键），配合真实 session.delete 验证生效；Composer 新建工作空间改为浮层内联输入，仓库内 `window.prompt`/`window.confirm` 已清零。
  - Hover/focus 体系：artifact 卡 hover、focus-visible 基线已在（会话行 ••• 、菜单项、tc-row 原有），本轮补 artifact 过渡。
  - typecheck ✓、build ✓、smoke 13/13 ✓；测试会话与测试产物已清理。
- **状态**：已完成。P1 剩余观察项：workspace.files 超过 400 条时的 truncated 提示（当前工作空间规模小，未实测截断分支）。

## 2026-09-13（Codex 式交互回归收尾 + 桥断帧修复）

- **用户需求**：继续上一代理中断的页面实操回归（运行态展开、完成态折叠、回答置底、双主题），并完成其列出的遗留项（文档同步、分包、git 基线）。
- **回归发现并修复**：
  1. **桥断帧（根因级）**：bridge.mjs 按 stdout chunk 切行，大帧（session.open 的会话快照）跨 chunk 时被撕成两段，UI 解析失败静默丢弃 → 历史会话打开发永久挂死。改为跨 chunk 行缓冲后整帧转发，回归通过。
  2. **running 误传**：ActivityTimeline 的 running 原来按会话级传入，运行中所有历史消息的面板都翻成"正在工作"并展开；改为按消息 `runStatus === "running"` 传递。
  3. **跟随滚动缺口**：自动钉底只在消息条数变化时触发，流式增量、工具行、产物卡追加都不跟；改用 ResizeObserver 钉底（用户上滚仍交出控制权）。
  4. **历史投影不同构**：快照把一个 agent 回合拆成多个气泡、产物卡丢失；新增 `projectSnapshotMessages` 合并连续 assistant 段并按实时规则重建产物卡，历史视图与实时视图一致。
  5. **空回复提示**：DeepSeek Flash 偶发返回空内容（引擎无报错），界面补"模型本次返回了空内容"提示。
  6. README 移除过时的"前端分包未完成"（manualChunks 已生效，index 81KB）。
- **事故与恢复（重要）**：诊断探针误在真实数据目录（`~/.office-agent/pi`）调用 `config.setApiKey`，把 DeepSeek Key 覆盖为占位符引发 401；已从用户 `~/.pi/agent/auth.json` 恢复同 Key（0600），真实任务往返验证通过。**教训：任何探针一律使用临时 agentDir（同 smoke）。**
- **验证**：typecheck ✓、build ✓（分包生效）、smoke 12/12 ✓；浏览器实操回归：运行态展开/完成态折叠/回答置底/浅深双主题/历史打开/滚动钉底全部通过。
- **遗留**：DeepSeek Flash 偶发空响应（UI 已如实提示，引擎侧原因待查）；引擎级权限拦截（P0-5）仍未做；Windows/PowerShell 链路未验证。
- **状态**：已完成 git 基线提交，后续开发有 diff 基线。

## 2026-09-13（继续开发：Codex 式执行过程）

- **用户需求**：修复项目巡检发现的问题，并将任务执行交互优化为类似 Codex 的方式；任务结束后折叠执行过程，实际回答写在下方。
- **决定**：页面顺序统一为“用户请求 → 执行过程 → 最终回答 → 产物”。运行中过程展开；正常完成后自动折叠为耗时/步骤摘要；用户主动查看时不强制折叠；失败或停止默认展开。
- **影响面**：任务消息渲染、Activity Timeline 状态、滚动策略、浅/深主题、冒烟测试、过期项目文档与大组件拆分。
- **状态**：执行过程与正式回答顺序已改；Activity Timeline 已拆为独立组件；冒烟恢复 12/12；过期 README/S0/sidecar 文档已同步；前端依赖已分包。双主题页面回归进行中。

## 2026-09-12（过程卡位置调整）

- **用户反馈**：思考/工作状态卡放在实际回答**下面**（此前在上方）。已调整渲染顺序：正文 → 工作过程卡（默认收起）→ 产物卡。PRD 3.2 原则描述同步更新。

## 2026-09-12（真实任务端到端验证）

- **验证通过**：配置持久化的真实 Key 下执行"创建 hello.txt"任务 → 模型真实调用（DeepSeek V4 Flash）→ write 工具成功 → 磁盘文件内容正确 → Artifact 卡（hello.txt · 1 KB · 打开/定位）→ 工作过程卡（已完成 · 3 秒，思考/工具行）→ 权限模式"自动编辑"持久化。Key 持久化（auth.json）同场验证。
- **消息模型重构**：UiMessage 从 text/thinking/tools 三字段改为按时间排序的 activities 数组（thinking/text/tool 交错），支持 ZCode 式的过程穿插展示；StrictMode 下事件应用改为纯函数避免重复。

## 2026-09-12（P0 六项实施完成）

- **Key 持久化**：`config.setApiKey` 现在同时写入 auth.json（pi 原生格式，0600），重启自动加载；UI 文案同步。已完成。
- **P0-1 Activity Timeline**：思考文本块替换为时间线（状态头 `● 工作中·Xs / ✓ 已完成` + 左线活动项：思考行可展开、工具步骤独立行）。已完成。
- **P0-3 全局状态**：顶栏显示 ● 工作中 / ✓ 已完成·耗时 / ✕ 失败 / ■ 已停止。已完成。
- **P0-4 Artifact Card**：write/edit 成功后按路径收集产物（类型图标/大小/[打开][在文件夹中显示]）；sidecar 新增 `os.open`（xdg-open，支持 revealDir）与 `fs.stat`。已完成（真实产物待用户任务验证）。
- **P0-2 Tool Card**：diff 统计（+N -M，从 diff 文本计算）；修复 `tool_execution_update` 字段名（`partialResult`）——此前增量输出丢失。已完成。
- **P0-5 权限模式**：Ask / Auto Edit / Full Access 三档选择器（持久化）。**引擎级拦截未实现**：pi SDK 无审批钩子，需后续调研扩展机制；当前为 UI 与持久化先行。部分完成（范围调整已记录）。
- **微动效**：活动条目淡入（150ms/4px）、细滚动条（5px）、过渡三档 token。已完成。

## 2026-09-12（视觉系统追加）

- **需求**：用户追加 UI 视觉设计系统（22–48 节）：布局收敛（正文 ≤820px、Header ≤52px、Sidebar 232px）、密度分层、色彩比例（中性 90/绿 5/状态 5）、三层 Surface、圆角标尺、过渡三档、表格重做、Timeline 左线风格、Emoji 换 Lucide、敏感操作改应用内 Dialog。已追加进 `commercial-ui-prd.md` 第 22 章。**文档先行完成。**
- **决定**：首批只动 4 个纯视觉点（正文缩窄 / 降 Card 感 / 表格重做 / 层级差），随后接 Activity Timeline（P0-1）。绿色系保留，不学 Zcode 黑白灰。

## 2026-09-12（停止/失败状态补全）

- **用户反馈**：停止任务后界面死胡同——无继续入口、无部分结果、无重试。已实现：停止 → [继续任务][重新开始]；失败 → [重试]（按钮基于消息记录的原始 prompt 重跑）；系统提示词增加"专注当前任务，不浏览无关目录"（修复 Agent 跑去翻技能目录的问题）。已完成。

## 2026-09-12（第二阶段启动）

- **需求**：Agent 商业化体验改造（用户提交完整规格并确认）。核心：Work/Result 分离、Activity Timeline、Tool Call Card、Artifact Card、权限模式 + Approval、微动效。P0 六项，P1/P2 及"不做"清单见 [commercial-ui-prd.md](./commercial-ui-prd.md)。
- **文档动作**：新增 `docs/commercial-ui-prd.md`（含实现映射与里程碑 M1/M2/M3）；prd.md 标记当前阶段。**文档先行完成，开始编码（M1）。**
- **待验证风险**：pi SDK 的工具审批（approval）钩子能力未验证，P0-5 权限/Approval 范围可能调整（若引擎不支持则先落三档模式 UI + 命令类拦截，引擎级审批另立记录）。

---

## 2026-09-12

- **无边框窗口 + 自定义标题栏**：用户要求去掉系统原生边框（对齐 ZCode）。`decorations: false`；顶栏即标题栏（手动 mousedown → start_dragging，双击最大化）；右上角窗口控制按钮（仅 Tauri 内渲染）。踩坑：capabilities 缺失导致窗口命令全部静默失败，已补 `core:default` + 显式窗口权限；`toggle-maximize` 命令名应为下划线。已完成并验证。
- **设置页模型配置重做**：用户反馈原生 select 丑、流程乱。改为分步：① 厂商（自定义下拉）② Key ③ 模型胶囊点选（前 5 个 + 显示全部）；自定义厂商支持拉取 /v1/models。已完成并验证。
- **顶栏模型菜单移除**：模型选择收敛到输入框行；顶栏只留标题/状态/窗口控制。已完成。
- **模型设置同步 bug**：从模型菜单切换后设置弹窗停留旧值（Radix 外部打开不触发 onOpenChange）。改为 useEffect on open 同步。已完成并验证。
- **模型菜单点击失效**：外部点击遮罩（z-30）盖住菜单（z-10）。菜单 z-index 提到 40。已完成并验证。
- **live 会话重命名/删除**：sidecar 新增 `session.rename`（session_info 条目）/`session.delete`（路径守卫 + 卸载文件），UI 启用。已完成并验证。
- **Agent 身份**：用户要求清除 pi 痕迹（模型自我介绍为 pi）。sidecar 经 `DefaultResourceLoader.systemPrompt` 注入 Office Agent 系统提示词（默认中文、不提底层框架）。待新会话验证。
- **友好错误提示**：引擎原始错误映射为中文行动建议（未配 Key/401/429/网络/超时等），覆盖全部错误路径。已完成并验证。
- **S0/S1 回溯**：UI 框架（会话/设置/工具卡片演示/主题）、pi sidecar 接入（stdio JSONL 协议、12 项冒烟）、工作空间分组、分步设置、思考强度滑杆等，详见 `docs/s0-validation.md` 与 git 历史。
