# Agent 商业化体验改造 PRD（第二阶段）

版本：v1.0 · 日期：2026-09-12 · 状态：已确认，实施中
上游需求：用户提供《Office Agent UI / 交互商业化优化需求》

## 1. 背景与目标

基础桌面 UI 已完成（会话/工作空间/模型选择/对话/思考展示/文件与命令执行）。本阶段不重构视觉风格，而是把产品从「AI Chat + 本地工具」升级为「有明确工作过程、状态反馈和产物管理的 Desktop Agent」。

核心目标：

1. 用户始终知道 Agent 正在做什么、做到哪一步
2. 用户能看到 Agent 对文件/系统执行了哪些操作
3. 「工作过程」与「最终结果」明确分离
4. 高风险操作具备权限状态与确认机制
5. 工作过程有自然、持续的微动效反馈
6. 达到可正式发布的商业桌面软件体验

## 2. 设计原则

- **不展示原始 CoT**：内部思考转换为用户可读的状态描述（"正在分析任务"、"正在读取 Sales.xlsx"）。
- **Work 与 Result 分离**：一次任务 = User Request → Agent Work → Final Result → Artifact。参考 Codex：运行时过程展开并持续更新，结束后收成一行可展开摘要，正式回答固定显示在其下方。
- 保持现有浅色极简语言（浅绿品牌色、白底、轻边框），提高工作区信息密度，不做 IDE 风。

## 3. 需求清单

### P0（本轮必做）

| 编号 | 需求 | 要点 |
| --- | --- | --- |
| P0-1 | Activity Timeline | 每步行为独立呈现；运行时展开，正常完成后自动折叠为“已工作 X 秒 · N 个步骤”，用户可再次展开；失败/停止默认展开 |
| P0-2 | Tool Call Card | 统一卡片：类型图标（搜索/读取/编辑/创建/命令/Web/Skill/SubAgent）+ 摘要（路径/关键词/命令）+ 状态；编辑显示 +N -M；命令显示 Exit Code 与耗时；点击展开详情 |
| P0-3 | 全局运行状态 | 顶部状态：● 工作中·耗时 / ✓ 已完成·耗时 / ✕ 失败 / ■ 已停止；失败提供查看原因与重试 |
| P0-4 | Artifact Card | 生成/修改文件后展示产物卡：文件图标、类型、大小；[打开] [在文件夹中显示]；修改类显示 +N -M 与 [查看修改] |
| P0-5 | 权限模式 + Approval Card | Ask / Auto Edit / Full Access 三档；敏感操作出 Approval Card（[拒绝][允许]），全局状态变"等待确认" |
| P0-6 | 微动效 | 活动条目淡入（150-200ms, translateY 4→0）；运行中 pulse；完成 ✓；不抢滚动，用户上滚时显示"↓ 查看最新进度" |

### P1（随后）

- 输入框 Agent Control Bar（附件 / Workspace / 权限模式 / 模型 / 发送）
- Workspace 信息强化（路径、最近文件、打开目录）
- 顶部 Header 增加运行信息（Workspace 名 + 状态）
- Hover 反馈体系（Tool/Artifact/会话行的快捷操作；四态齐全）

### P2

- 会话状态标记（Running/Completed/Failed）
- 错误自动恢复展示（↳ 正在尝试修复）

### 本轮不做

文件资源管理器、Git UI、IDE 编辑器、多 Agent 拓扑、Workflow Designer、大型动画、自定义主题。

## 4. 实现映射（基于当前架构）

| 需求 | 数据来源 | 改动面 |
| --- | --- | --- |
| Activity Timeline | 现有 run 事件流（thinking/tool.*/turn/agent）重投影 | App.tsx 消息模型重构（引入 Activity 列表）；ThinkingProcess → Timeline 组件 |
| Tool Call Card | tool.start/update/end（已带 toolName/args/output） | ToolCard v2 增强：类型图标映射、耗时、diff 统计 |
| 全局状态 | run 生命周期 + 计时器 | App 顶栏状态区 + 消息流首尾状态条 |
| Artifact Card | write/edit/命令类工具成功后，从 args/output 提取路径；sidecar 新增 `os.openPath`/`os.stat` | contracts 类型 + ArtifactCard 组件 + sidecar 命令 |
| 权限/Approval | 待验证 pi SDK 审批钩子；若引擎不支持，先落 UI 三档模式（Auto Edit/Full Access 影响后续接入，Ask 先覆盖命令类工具） | contracts + sidecar + ApprovalCard |
| 微动效 | 纯 CSS | styles.css |

## 5. 验收标准

典型任务"分析这个 Excel，找出销售下降地区并生成报告"全过程可见：

- 工作状态带耗时（● 工作中·12秒 → ✓ 已完成·18秒）
- 每个工具步骤独立可见（读取/分析/创建）
- 失败可见原因与重试入口
- 敏感操作有确认卡片，全局状态变"等待确认"
- 最终产物以 Artifact Card 呈现，可直接打开/定位
- 正常完成后过程自动折叠，正式回答位于过程下方；用户主动查看详情时不强制折叠
- 全程不暴露原始思考文本

## 6. 里程碑

1. M1：Activity Timeline + 全局状态 + 微动效（纯前端重投影）
2. M2：Tool Call Card 增强 + Artifact Card（含 sidecar os 命令）
3. M3：权限模式 + Approval（视 pi 审批能力验证结果调整范围）

---

# 22. UI 视觉设计系统（用户追加，已确认）

定位：增加层级、密度、细节和状态感；不做复杂化。目标气质 = Linear 精致度 + Claude Desktop 简洁 + Zcode 工作过程感 + Office 文件生产力。关键词：Clean / Compact / Calm / Professional / Agentic / Desktop-native。

## 22.1 布局与密度

- 三层结构不变：Sidebar / Header / Conversation + Composer。
- Sidebar 230–240px；Header ≤ 52px；正文与 Composer 内容最大宽 760–900px；主区左右留白 32–48px。窗口可以宽，内容不无限变宽。
- 密度分层：Sidebar 高密度、Activity 中高、最终回答中、Composer 低。Tool 行为单行紧凑（`📄 读取 Sales.xlsx ✓ 320ms`），点击才展开。

## 22.2 色彩与层级

- 比例：中性灰白 90% / 品牌绿 5% / 状态色 5%。绿色只用于：当前选中、Send、Running、品牌图标、Primary Action。
- 色彩角色：Primary / Background / Surface / Surface Hover / Border / Border Strong / Text Primary-Secondary-Tertiary / Success / Warning / Danger。
- 三层 Surface：Sidebar 微弱灰绿 → Main 近白 → Elevated（Composer/弹层）带轻阴影；不靠大量边框分层。
- 阴影只用于浮动元素（Composer/下拉/菜单/对话框），`0 4px 16px rgba(0,0,0,0.06)` 级别。

## 22.3 文字与字体

- 层级：用户消息 15–16px Medium；助手回答 14–15px / 1.6；工具活动 13px；元数据 11–12px Tertiary。
- 字体：Inter, "Segoe UI", "Microsoft YaHei", system-ui；代码用 JetBrains Mono / Cascadia / monospace；等宽不用于普通文本。
- Agent 回复头（◇ Office Agent）压缩到 24–28px 高，不抢内容焦点。

## 22.4 形状 / 边框 / 圆角 / 过渡

- 圆角标尺：4 小控件 / 6 按钮与菜单项 / 8 Tool Card / 10 Card / 12 Composer / 14 Dialog；禁止 5/7/9/13/16 随意值。
- 边框：大区域不加边框；Card 1px 微边框；Selected 用背景 tint（强调手段最多同时 2 个）。
- Timeline 类列表用左侧细线 + 状态点，不用每项一个矩形框。
- 过渡三档：Fast 120ms / Normal 180ms / Slow 240ms，全局统一。
- 滚动条 4–6px 低对比，Hover 增强。

## 22.5 组件规范

- Sidebar：WORKSPACE 区标签 + 会话行（hover 出 •••）；选中态最多 2 种强调手段。
- Composer：默认高 96–112px，最高 220px；距窗口底部 16–24px 浮动感；内容宽与正文对齐。
- 按钮三类：Primary（品牌色，少用）/ Secondary（浅底描边）/ Ghost（hover 显底）。
- 图标：Lucide 统一（禁 Emoji 上正式 UI），工具图标 16px / 容器 20–24px，轻微 tint 区分。
- 首屏加载用 Skeleton；空状态保持简单（不做大量推荐卡）。
- 敏感操作用应用内 Dialog（Danger 主按钮），禁止浏览器 alert/confirm。
- 纯图标按钮必须有 Tooltip（400–600ms 延迟）。

## 22.6 首批四个纯视觉点（用户点名优先）

1. 正文内容缩窄（max-width ≈ 820px）
2. 降低大 Card 感（Tool 行单行紧凑 + Timeline 左线风格）
3. 默认 HTML 表格重做（表头轻灰底、仅横向分隔线、行高 32–36px）
4. 提升 Sidebar / Header / 正文层级差（Header ≤52px、Sidebar 232px、背景分层）
