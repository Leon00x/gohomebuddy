# 过程记录

每条记录：日期 · 需求/决定 · 影响面 · 状态。新记录追加在顶部。按 AGENTS.md 规则，需求确认后先更新 PRD/本文档，再编码。

---

## 2026-09-14（模型体系统一接管：sidecar 落地）

- **需求（已确认）**：不要内置厂商模型清单，模型配置由应用统一接管。
- **实现**：
  - `CURATED_PROVIDERS` 改为只携带名称 / Base URL / 协议（DeepSeek `https://api.deepseek.com/v1`、智谱 `https://open.bigmodel.cn/api/paas/v4`、Z.AI `https://api.z.ai/api/paas/v4`、Z.ai Coding `https://open.bigmodel.cn/api/coding/paas/v4`），不再自带模型。
  - `listProviders()` 不再调用引擎内置目录：预设厂商的模型清单改读应用管理的模型配置（`models.json`），没有配置就是 0 个模型、auth 为 missing；自定义厂商沿用同一份配置，且跳过与预设同 id 的重复项。
  - `toCatalogModel()` 透传能力元数据：`reasoning`、`thinkingLevels`、`multimodal`、`contextWindow`、`maxTokens`；缺省即未知，界面按不支持处理。
- **冒烟**：新增两项断言（预设要有 baseUrl、写入模型后 `config.providers` 能列出该模型），改用应用配置里的模型 id 跑 run，17/17 通过。
- **影响**：既有用户的厂商需要重新「检测模型」一次才会出现在模型选择器里（之前依赖引擎目录）。
- **状态**：sidecar 部分完成；界面（设置页重做、按能力限制控件、上下文圆环）未开始。

## 2026-09-14（模型体系重构方案确认：接管模型配置 + 能力元数据 + 上下文圆环）

- **用户需求**：① 不要内置厂商模型清单；② 模型要区分「是否支持思考 / 思考等级」「是否支持多模态」，输入区按能力做限制；③ 输入框加圆环显示已用 / 未用上下文。
- **决定（已确认）**：
  1. 模型配置彻底由应用接管——厂商预设只保留名称 / Base URL / 协议，所有厂商的模型清单均由「检测模型」或手动输入产生，并写入引擎模型配置文件；引擎内置目录不再参与解析（统一走现在自定义厂商那条路）。
  2. 模型条目增加能力元数据：`reasoning`（是否支持思考）、`thinkingLevels`（可用档位）、`multimodal`（是否支持图片输入）；未知即标记未知，不假装支持。
  3. 输入区按当前模型能力限制控件：不支持思考 → 隐藏思考等级；不支持多模态 → 禁用图片附件并给出原因。
  4. 输入区新增上下文圆环：显示已用 / 未用上下文与百分比，数据取引擎 token 用量 + 模型上下文窗口；窗口未知时不显示。
- **影响面（待实施）**：`packages/contracts`（CatalogModel 增能力字段）、`apps/sidecar`（自定义厂商模型写入 + 能力透传 + 上下文窗口）、`apps/desktop`（Composer 圆环与能力限制、Settings 模型管理重做）、`styles.css`。
- **状态**：设计已确认并入库，实施未开始（上一轮先纠正了「添加模型」动作语义与内置模型来源问题）。

## 2026-09-14（已配置模型：按供应商折叠 + 编辑/删除/添加）

- **用户需求**：已配置的模型全部列出来，按供应商分类；点击展开；展开后对已配置模型可编辑、删除；末尾提供添加功能。
- **决定**：`已配置` 区改为折叠列表——每行一个供应商（图标 + 名称 + 模型数量 + 箭头），点击展开；展开区逐条列出该厂商启用的模型（名称 + 「编辑」「删除」），末尾为「添加模型」。启用模型取自 `office.enabledModels`，未设置时默认取该厂商前 4 个；「删除」从启用列表移除，「编辑」「添加模型」把该厂商载入下方表单继续配置。
- **影响面**：`apps/desktop/src/components/Settings.tsx`、`apps/desktop/src/styles.css`、`docs/prd.md` F06。
- **状态**：已完成（待页面复查）。

## 2026-09-14（模型配置交互修正：去重复胶囊、加检测按钮、检测失败手输）

- **用户反馈**：① 已配置要直接列出来；② 「可添加配置」胶囊与厂商下拉框重复，保留下拉框；③ Key 下面加一个明确的「检测模型」按钮；④ 检测到就让用户选、检测不到就让用户手输。
- **决定**：删除「可添加配置」胶囊区（只保留原厂商下拉框），模块标题改名「添加配置」；Key 输入框下方的失焦自动检测改为显式「检测模型 / 重新检测模型」按钮（未填 Key 时禁用）；检测有结果时展示 4 个胶囊 + 「其他 N 个」下拉并支持多选，检测无结果时（`detected && pillModels.length === 0`）展示手动填写模型 ID 的输入框。
- **影响面**：`apps/desktop/src/components/Settings.tsx`、`apps/desktop/src/styles.css`、`docs/prd.md` F06。
- **实测（真实引擎）**：模型页显示「已配置 → DeepSeek 3 个可选」「添加配置 → 1 选择厂商 / 2 填入 API Key / 检测模型按钮（未填 Key 时 disabled）/ 3 选择模型 3 个胶囊」；`provider-chip` 数量为 0；首屏输入区模型按钮直接显示「DeepSeek V4 Flash」。
- **状态**：已完成。

## 2026-09-14（修复：输入区默认没有文字）

- **用户反馈**：一打开应用，输入区默认「都没有文字」，选中模型后文字才出现。
- **根因**：模型按钮文案写成 `catalogModel?.name ?? selection.modelId ?? "选择模型"`，而 `selection.modelId` 是空字符串时 `??` 不兜底，于是按钮渲染成空；且应用启动时不会自动选默认模型，所以首屏模型位一直是空白。
- **决定**：文案改用 `||` 串联；启动拉取厂商目录后，若尚未选模型则自动选中第一个「已配置且模型非空」的厂商的首个模型。
- **影响面**：`apps/desktop/src/components/ModelMenu.tsx`、`apps/desktop/src/App.tsx`。
- **实测**：默认首屏工具栏显示「询问 / 中 / DeepSeek V4 Flash」三段文字，模型按钮宽 96px；无需先选模型。
- **状态**：已完成。

## 2026-09-14（回归修复 + 模型配置重构：issue 反馈 1–6）

- **用户反馈**：① 宽屏下工具栏什么都不显示、选了模型才出现；② 模型/权限浮层被覆盖；③ 窗口缩不小、文字不隐藏；④ 未配置的模型不该可选；⑤ 设置里要分「已配置 / 可添加配置」；⑥ 配置流程：选厂商 → 填 Key → 检测模型 → 显示 4 个可多选、其余进下拉。
- **根因（①②）**：
  1. 工具栏测量误用 `scrollWidth`，展开的浮层是绝对定位子节点会把宽度撑大，导致一开菜单就判定「放不下」→ 收缩；关掉菜单（如选完模型）再测又变宽 → 恢复文字，正好对应「选了模型才显示」。改为量克隆节点自身的盒子宽度 `getBoundingClientRect().width`。
  2. 双层改造时给 `.composer-input` 加了 `overflow: hidden`，把向上/向下展开的模型与权限浮层裁掉了。移除该属性。
- **③**：窗口 `minWidth` 960 → 760；PRD 最小窗口同步为 760×640。
- **④**：`ModelMenu` 只列 `auth === "ready"` 的供应商；若某厂商设置了启用模型，则只列这些模型；无任何已配置项时给出空态文案。
- **⑤⑥**：设置「模型」页顶部新增「已配置」（已就绪厂商 + 模型数量）与「可添加配置」（未配置厂商 + 自定义厂商胶囊）两个模块；Key 输入框失焦后自动跑一次检测（自定义厂商拉远端 `/models`，内置厂商刷新目录）；模型改为 4 个胶囊多选 + 「其他 N 个」下拉，选择结果保存到 `office.enabledModels` 并用于过滤模型菜单。
- **影响面**：`apps/desktop/src/components/{Composer,ModelMenu,Settings}.tsx`、`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`、`apps/desktop/src-tauri/tauri.conf.json`、`docs/prd.md`。
- **实测**：权限浮层 260×175 正常展开、`.composer-input` overflow 恢复 `visible`、菜单展开时工具栏不再误收缩；`npm run typecheck` 通过。
- **状态**：已完成。

## 2026-09-14（Issue #4：Composer 工具栏响应式收缩）

- **用户需求**：实现 GitHub #4。
- **根因**：原实现用 `el.scrollWidth > el.clientWidth` 判断，而 compact 会改变同一元素的宽度需求，形成反馈环；窗口变宽后判据仍基于“已经收缩的 DOM”，只能靠模型/权限等状态变化触发的 effect 重跑才偶然恢复。
- **决定**：改为独立测量——每次判定时把 `.composer-toolbar` 克隆一份，去掉 `composer-toolbar` 类并挂 `.composer-toolbar-measure`（绝对定位、不可见、`width: max-content`，内部 `.ctl-text/.ctl-chev` 强制展开），在同一父节点内量出「完整工具栏所需宽度」，再与当前 `clientWidth` 比较：`compact = available < required`，退出时加 6px 迟滞。ResizeObserver 改为观察工具栏的父容器（输入框），并用 rAF 合并；依赖数组触发的 `useLayoutEffect` 只负责重新测量，不再决定 compact 取值。
- **影响面**：`apps/desktop/src/components/Composer.tsx`、`apps/desktop/src/styles.css`、`docs/prd.md` F03。
- **实测（viewport 宽度扫描）**：1280px → 可用 736px，不收缩、权限文字显示；900/700px → 可用 552/352px，完整工具栏仍放得下，保持文字；420/360/300px → 可用 72/16/16px，进入收缩，权限文字 `display: none`、模型名保持可见；再回到 1280px → 自动恢复文字，无需任何点击。
- **状态**：已完成。

## 2026-09-14（默认用户名 Leon）

- **用户需求**：默认用户名改为 `Leon`。
- **决定**：`office.userProfile` 缺失或名字为空时统一回落为 `Leon`（含历史空值迁移），并在 PRD F08 补记「个人资料」需求（此前只写了过程记录）。
- **影响面**：`apps/desktop/src/App.tsx`（资料读取默认值）、`docs/prd.md` F08。
- **状态**：已完成。

## 2026-09-14（头像比例修复 + 用户资料设置）

- **用户需求**：① 会话里的 Agent 图标被压扁、比例不对，同时整理整体布局细节；② 设置里增加用户名与头像，左下角常驻显示用户头像。
- **根因（①）**：`.agent-avatar` 容器是 22×22，但内部 `.otter-img` 固定 26×26，作为 grid 子项被横向压到 22px、高度仍 26px，`object-fit` 默认 `fill`，于是纵向拉伸；同一条消息里用户头像是 26×26 圆形，两者尺寸也不一致。
- **决定**：
  - 头像统一为 26×26 圆形：`.agent-avatar` 与 `.message-avatar` 同尺寸，图片改为 `width/height: 100%` + `object-fit: contain`，删除无用的 `.agent-avatar svg` 规则。
  - 设置新增「个人资料」页：用户名输入 + 头像选择（本地图片经 canvas 等比缩放到 128px 后以 data URL 存 `office.userProfile`），支持移除头像。
  - 侧边栏左下角改为用户条目：头像 + 用户名，点击打开设置，右侧保留齿轮入口；消息列表里用户气泡头像同步使用该头像，未设置时回落为首字母。
- **影响面**：`apps/desktop/src/App.tsx`、`apps/desktop/src/components/Settings.tsx`、`apps/desktop/src/styles.css`。
- **实现与实测**：
  - 头像：`.agent-avatar` 与 `.message-avatar` 统一 26×26 圆形，图片 `width/height: 100%` + `object-fit: contain`，删除失效的 `.agent-avatar svg` 规则。实测修复前图片为 22×26（横向被压），修复后容器与图片均为 26×26。
  - 个人资料：设置新增「个人资料」页（用户名输入 + 头像选择/移除），图片经 canvas 等比缩放到 128px 后以 data URL 存入 `office.userProfile`；未设头像时回落为用户名首字母，用户名为空时显示用户图标。
  - 左下角改为用户条目（头像 + 用户名 + 齿轮），点击进入设置；消息列表里用户气泡头像与显示名同步使用该资料。
  - 实测：「个人资料」页用户名占位「你的名字」、头像预览 44×44、含隐藏 file input 与「选择图片」；把用户名改为 `Leon` 后，左下角头像显示 `L`、名称同步为 `Leon`。
  - `npm run typecheck` 通过。
- **状态**：已完成。

## 2026-09-14（主界面问候语按时段改写）

- **用户需求**：按指定时段替换主界面问候语：07:00–12:00「早上好，来杯 Coffee 再开干？」、12:00–14:00「中午啦，休息会吧」、14:00–17:30「下午好，要出去溜达一圈吗？」、17:30–18:30「准备，收拾好包～」、18:30–06:00「晚上好，有工作交给我吧，别卷了～」。
- **决定**：`greeting()` 改为按分钟粒度判定，覆盖 06:00–12:00 / 12:00–14:00 / 14:00–17:30 / 17:30–18:30 / 18:30–次日 06:00 五档；用户未指明 06:00–07:00，归入早间文案以消除空档。
- **影响面**：`apps/desktop/src/App.tsx`（`greeting()`）、`docs/prd.md` F03（补记问候语时段表）。
- **状态**：已完成。

## 2026-09-14（工作空间可展开、标签行收敛、行高对齐）

- **用户需求**：① 管理标签每行只留图标 + 标签名，放在同一排；② 工作空间支持展开查看其下的会话；③ 工作空间行与会话行高度接近。
- **决定**：
  - 工作空间行左侧加独立折叠箭头（默认全部展开，存 `collapsedWs`），展开后缩进显示归属该空间的会话；“所有”视图下平铺列表只列出无空间的会话，标签视图仍平铺展示全部匹配结果。
  - 标签管理行改为 [标签图标 + 名称] 单排布局，重命名/常用/删除三个按钮改为 hover 或键盘聚焦时显现（已设常用的星标常显）。
  - `.session-main` 统一 `min-height: 36px`，`.ws-main` 字号与会话行对齐为 13.5px，保证两类行等高。
- **影响面**：`apps/desktop/src/App.tsx`（折叠状态、展开渲染、标签行、清理重复的 `workspacePickerError` 节点）、`apps/desktop/src/styles.css`。
- **实现与实测**：工作空间行左侧新增独立折叠箭头（默认展开，`collapsedWs` 记折叠项），“所有”视图下缩进展示该空间的会话、平铺列表只留无空间会话；标签管理行改为 `[标签图标][名称][操作]` 单排，操作按钮默认 `opacity: 0`，hover / 键盘聚焦显现（已常用星标常显）；`.session-main` 统一 `min-height: 36px`、`.ws-main` 字号对齐 13.5px；顺带删掉重复渲染的 `workspacePickerError` 节点。
  - 实测：会话行 `min-height: 36px`；标签行结构为 `svg + span + 3×button`，行高 34px，三个操作按钮默认 `opacity: 0`；`npm run typecheck`、`git diff --check` 通过。
  - 工作空间展开效果依赖本机已存在的工作空间数据（预览实例无法调起文件夹选择器创建），需在桌面端确认。
- **状态**：已完成。

## 2026-09-14（Composer 双层结构改造，对齐参考样式）

- **用户需求**：按参考图继续模仿输入区样式。
- **参考图结构（脚本解析 1771×816 PNG 得出）**：页面白底 → 外层浅灰圆角容器 → 容器左上角一个无边框的工作空间条（文件夹图标 + 名称 + 箭头）→ 容器内嵌白色圆角输入框（占位文案 + 工具栏）→ 容器下方一排建议胶囊。
- **决定**：Composer 改为双层结构——`.composer` 作为浅灰外壳（`var(--soft)`、圆角 18px、内边距 8px），新增 `.composer-input` 内层白色输入框（`var(--surface)`、1px `var(--line)`、圆角 14px），工作空间选择器 `.composer-scope` 放在外壳左下、输入框之上，改为无边框无底色的裸文本条（hover 才出底色），聚焦态边框移到内层输入框；深色主题外壳单独取值 `#1e2521`。
- **影响面**：`apps/desktop/src/components/Composer.tsx`（新增内层容器）、`apps/desktop/src/styles.css`。
- **实测**：外壳 720×185 / 圆角 18px / 内边距 8px / 背景 rgb(237,243,237)；内层 702×131 / 白底 / 1px rgb(230,233,226) / 圆角 14px；工作空间条 114×26 / 无边框无底色 / 位于输入框上方。`npm run typecheck` 通过。
- **状态**：已完成。

## 2026-09-14（工作空间入口与选择器位置调整）

- **用户反馈**：① 点工作空间后不该在它旁边出现“新建会话”按钮，而应直接进入新建会话页并默认选中该空间；② 空间/无空间选择器应放到输入框左上角。
- **决定**：工作空间行点击行为改为 `create(workspaceId)`，直接进入该空间的新会话页；移除 section 头部的“新建会话”按钮与 `scope.kind === "workspace"` 过滤分支，Workspace 行的选中态改由当前草稿绑定的空间（`draftGroup`）驱动。Composer 的工作空间选择器从底部工具栏移到输入框左上角（新增 `.composer-scope`，菜单改为向下展开），并在 compact 模式下保持文字可见。
- **影响面**：`apps/desktop/src/App.tsx`、`apps/desktop/src/components/Composer.tsx`、`apps/desktop/src/styles.css`；PRD F01/F02 同步。
- **实现与实测**：工作空间行点击直接 `create(wsId)` 进入新会话页，选中态由 `draftGroup` 驱动；移除 section 头部“新建会话”按钮与 workspace 过滤分支。选择器迁到 `.composer-scope`（输入框内左上角），改为胶囊样式：26px 高、`border-radius: 999px`、1px `var(--line)` 描边、`var(--bg)` 底、文件夹图标取 `var(--accent)`，菜单向下展开；compact 模式仍显示文字。
  - 实测：胶囊 113×26、圆角 999px、距输入框左 13px / 上 11px、图标色 rgb(61,101,81)；侧栏工作空间区只剩“添加工作空间”按钮。
- **状态**：已完成。

## 2026-09-14（侧栏宽度 / 行菜单留白 / 会话右键菜单）

- **用户需求**：① 侧边栏再宽一点，“…”按钮与滚动条之间留出距离；② 会话支持右键菜单。
- **决定**：侧栏由 232px 调整为 264px（仍在视觉规范 240–272px 区间）；会话列表右侧增加内边距，行菜单按钮外边距同步加大，避免“…”贴着滚动条。右键菜单复用现有会话菜单，新增浮层定位（`position: fixed` 跟随指针、越界钳制），左键“…”仍保持贴行展开；工作空间行同样支持右键。
- **影响面**：`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`、`docs/commercial-ui-prd.md`。
- **实现与页面实测**：侧栏 232px → 264px（横向内边距 12px → 14px）；`.session-list` 右侧内边距 6px、行菜单按钮 `margin-right` 4px → 6px；右键会话/工作空间行调用 `contextMenuPoint()` 在视口内钳制坐标，菜单以 `row-menu-floating`（`position: fixed`）跟随指针展开，左键“…”仍保持贴行绝对定位。
  - 实测：侧栏宽 264px；列表 `padding-right: 6px`；右键会话后菜单 `position: fixed` 出现在指针处（128, 346），四行均为 36px；点“…”仍是 `position: absolute; right: 6px`。
  - 回归方式：为避免占用桌面端单客户端桥，验证时先停桌面版、在 1422 端口跑独立预览，验证完再重启桌面版。
- **状态**：已完成。

## 2026-09-14（交互调整：新建会话不再强制选工作空间）

- **用户反馈**：点“新建会话”要先选工作空间才能进主页，步骤多余；希望直接进主页，在输入框里选工作空间。
- **决定**：撤销 #5 落地时加的“全局新建会话选择弹窗”。点“新建会话”立即创建空会话并进入主页；工作空间选择收敛到输入框的工作空间选择器（已有 Workspace / 选择其他文件夹… / 无工作空间）。当前处于某 Workspace 筛选时，新建会话默认预选该 Workspace；文件夹选择失败的错误提示改回侧边栏工作空间区显示。
- **影响面**：`apps/desktop/src/App.tsx`（移除弹窗与 `newSessionOpen` 状态、按钮行为与错误提示位置）；PRD F01 同步。
- **补充修复**：点“新建会话”后立即进入空会话（不再弹窗）；按钮上的重复加号（领先图标 + 尾随全角 `＋`）已删除；旧会话兜底标题同时剥离触发 Prompt 里的 `[引用工作空间文件…]` 引用块。
- **页面回归**：新建会话按钮只剩一个图标 + “新建会话”；点击直接进主页，输入框保留工作空间选择器；发送后会话标题取原始输入（实测「回归：新建会话标题来源」）。
- **标题兜底实测**：把「权限指令 + 用户问题 + 附件引用块」混合的脏 Prompt 交给引擎，`session.list` 返回标题「读一下这个文件」，两段内部上下文都被剥离。
- **状态**：已完成。

## 2026-09-14（Issue #3 会话标题解耦 + Issue #1 Windows 无控制台）

- **用户需求**：实现 GitHub #3 与 #1。
- **决定（#3）**：标题只由 Desktop 基于用户原始输入生成并显式写入会话元数据，不再依赖引擎 `firstMessage` 推断；`run.start` 增加 `sessionTitle` 参数，仅在会话尚无消息时写入 `appendSessionInfo`。旧会话保留 `firstMessage` 兜底，但先剥离 `[权限模式：…]` 等内部指令前缀；手动重命名优先级最高，后续对话不再改写标题。
- **决定（#1）**：Windows 下用 `CREATE_NO_WINDOW` 创建引擎子进程，保持 stdin/stdout 管道不变；引擎 stderr 改为 pipe 并落盘到 `~/.office-agent/logs/engine.log`（超过 2MB 截断重写），既避免无控制台环境下句柄失效，也让日志可查。
- **影响面**：contracts（`RunStartParams.sessionTitle`）、sidecar（标题写入 + 兜底清洗）、Desktop（标题生成与传递）、Tauri 主进程（进程创建标志与 stderr 落盘）。
- **实现与验证**：
  - #3：`run.start` 新增 `sessionTitle`；引擎仅在会话尚无消息时 `appendSessionInfo` 写入。Desktop 用 `createSessionTitle()` 基于原始输入生成（中文 24 字 / 英文 56 字符、压缩空白、超长省略），重试与继续不重新生成。`firstMessage` 兜底先剥离 `[权限模式：…]` 整行，且不误伤用户自己以方括号开头的提问。
  - #3 实测（临时数据目录 + 真实模型两次极短调用）：显式 `sessionTitle` 会话标题为「帮我把这个 Excel 整理一下」；未传 `sessionTitle` 的会话兜底标题为「第二个会话的原始问题」，权限文本已被剥掉。
  - #3 冒烟新增校验 `session title from sessionTitle param`，冒烟 16/16 通过。
  - #1：Windows 下 `command.as_std_mut().creation_flags(CREATE_NO_WINDOW)`；引擎 stderr 由 `inherit` 改为 pipe，逐行写入 `~/.office-agent/logs/engine.log`（追加，超 2MB 截断重写）并同时打到终端。
- **状态**：已完成（#1 的 Windows 无窗口行为需在 Windows 安装包上验收）。

## 2026-09-14（排查：选工作空间后发消息卡住）

- **用户反馈**：选择工作空间后发送消息，界面停在工作中不动。
- **排查**：
  1. 源码版 sidecar 用临时数据目录复现同一路径：`session.new {cwd}` → `run.start` 1.9s 正常 `run.end`；随后 `session.setCwd` → `run.start` 1.2s 正常 `run.end`。协议链路无问题。
  2. 发现桌面版实际运行的是 `target/debug/gohomebuddy-engine`，该二进制为 11:02 构建，`grep` 确认不含 `fs.import` / `session.setCwd`，也不认 `session.new` 的 `cwd`——本轮 sidecar 改动根本没进桌面版。
  3. 期间前端多次 HMR 更新（改动含 hooks 顺序变化），残留的运行态也会让界面停在“工作中”。
- **处理**：`npm run engine` 重新编译随包引擎（校验 `session.setCwd`/`fs.import` 已在内），杀掉旧开发进程后用 detached 方式重启桌面版，`target/debug/gohomebuddy-engine` 更新为 15:15 新二进制。
- **结论/教训**：改 `apps/sidecar` 后必须跑 `npm run engine`；桌面 dev 只会在启动时复制 externalBin，不重编引擎。改前端 hooks 后如出现状态错乱，重启应用而不是依赖 HMR。
- **状态**：已完成。

## 2026-09-14（回归修复：会话菜单图标与文字换行）

- **用户反馈**：会话右键菜单、“选择其他文件夹”等浮层里，图标和文字各占一行，行高被撑到 51px。
- **根因**：`.session-menu button` 只设了 `width/padding`，没有建立 flex 布局；Tailwind preflight 把 `svg` 设为 `display: block`，图标因此独占一行。权限菜单单独设了 flex 所以不受影响——项目里已有同类注释（`.act-row.act-think`）。
- **决定**：`.session-menu button` 统一改为 flex 行布局（`align-items: center` + `gap`），并把标签项的名称包成 `span` 以便勾选图标靠右；权限菜单的 flex-start 覆盖保持不变。
- **影响面**：`apps/desktop/src/App.tsx`、`apps/desktop/src/styles.css`；会话菜单、工作空间菜单、标签选择、移动会话子菜单。
- **实现与验证**：`.session-menu button` 改为 `display: flex; align-items: center; gap: 7px`，行高由 51px 回到 36px；标签项名称包 `span` 使勾选图标靠右；补 `.current` 选中态。同时用高权重选择器还原 `.mi-ok`（26px）与 `.ws-pop-file`（block）以免被新规则误伤。
- **页面实测**：会话菜单四行均为 flex/36px；内联重命名行的确认键 26px、行高 41px；“移动到工作空间 → 选择其他文件夹”行高 36px。`npm run typecheck`、`npm run build` 通过。
- **状态**：已完成。

## 2026-09-14（Issue #5 回归修复：Workspace 与会话解耦、标签管理可用）

- **用户反馈**：Workspace 文件夹折叠会连带折叠其下会话；“管理标签”打开后无法创建标签。
- **决定**：Workspace 区只展示目录入口并负责筛选，Session 区独立展示当前筛选结果，不再把 Session 作为 Workspace 的树形子节点。标签管理改为独立应用内浮层，提供可聚焦的新建输入、明确的创建按钮及空态。
- **影响面**：侧边栏信息架构、Workspace 选中态、标签管理浮层、键盘与浅深主题交互。
- **实现与验证**：
  - Workspace 行不再承载会话，取消折叠控件与折叠状态；点击 Workspace 只切换下方会话区的筛选范围，会话列表始终平铺展示。
  - 标签管理改为居中对话框（`app-dialog`），含独立新建表单与空态文案；按钮与 Enter 两条创建路径均在页面实测通过，测试标签已清理。
  - 补上“未分类”分组折叠、Workspace 内直接新建会话入口、全局新建会话的工作空间选择界面（已有 Workspace / 选择其他文件夹 / 无工作空间），Workspace 行增加选中态与路径悬停提示。
  - `npm run typecheck`、`npm run build`、`npm run smoke`（15/15）通过。
- **状态**：已完成。

## 2026-09-14（Issue #5：Workspace / Session / Tag 模型）

- **用户需求**：实现 GitHub #5，明确 Workspace（本地文件夹/项目）、Session（一次任务）与 Tag（会话分类）的职责，并完善全局与工作空间内的新建会话流程。
- **决定**：Workspace 必须绑定 `folderPath`，Session 最多关联一个 Workspace，Tag 不参与 cwd 或权限决策；全局新建显式选择 Workspace、新目录或无工作空间，避免自动误绑目录。会话筛选固定保留“所有 / 标签”，最多三个用户设置的常用 Tag。
- **影响面**：产品数据模型与持久化、协议/sidecar 的 Session cwd、侧边栏及新建会话交互、Tag 管理、浅深主题和浏览器回归。
- **实现与验证**：
  - Workspace 使用桌面端原生文件夹选择器，保存展示名与绝对路径；旧的无路径“分组”不会迁移为 Workspace。
  - `session.new/open/setCwd` 支持按 Workspace 路径创建、恢复与移动会话，侧边栏移动当前会话时同步重建本地引擎运行上下文；无 Workspace 回到运行时默认目录。
  - 全局输入框可选择已有 Workspace、其他文件夹或无工作空间；选中 Workspace 后新建会话默认归属该 Workspace。
  - 标签支持创建、重命名、删除、会话多选关联、按标签分组视图以及最多三个固定常用入口。
  - `npm run typecheck`、`npm run build`、`npm run smoke`（15/15，含 `session.setCwd` 切换真实目录）与 `cargo check` 通过；浏览器加载本地 UI，确认无 Workspace 会话明确显示“无工作空间”。
- **状态**：已完成。

## 2026-09-14（附件二连：系统文件选择 + 拖拽导入；任务统计：tokens + 执行时间）

- **用户需求**：①+ 号点击弹出系统文件选择器（可选系统任意文件）；②对话框整体支持拖拽文件/图片导入；③任务完成后在输出卡下方展示消耗 tokens（K 单位、1 位小数）与执行时间。
- **决定**：
  - 系统文件经原生 picker（`<input type=file>`，Tauri/浏览器通用）读取内容，走新增 sidecar 命令 `fs.import`（base64 → 工作空间 `.attachments/`，50MB 上限、文件名净化）落盘，引用标签记工作空间相对路径——引擎按路径读取，与现有附件机制同构。Tauri 窗口 `dragDropEnabled: false` 放行 HTML5 drop，浏览器/Tauri 统一一条导入代码路径。
  - tokens 数据源为 pi 会话消息的 `usage.totalTokens`（实测 DeepSeek 会话已含）；`run.end` payload 增加 `tokens{input,output,total}`（按本次 run 新增消息切片统计）；`session.open` 快照 assistant 消息补 `tokens` 供历史回看。
  - UI：回答下方新增统计行「消耗 X.XK tokens · 执行 X」，+ 菜单顶部新增「选择系统文件…」，composer 为拖拽落区（dragover 高亮）。
- **影响面**：contracts、sidecar（smoke 增至 14 项）、Composer/App、styles.css。
- **结果（已完成）**：smoke 14/14（新增 fs.import：中文/空格文件名净化、.attachments/ 落盘验证）；typecheck/build 通过。fs.import 探针验证通过；tokens 统计行为 run.end 切片汇总，首次真实任务后即可在回答下方看到「消耗 X.XK tokens · 执行 X」。系统文件 picker 与拖拽为交互特性，待用户页面实测。

## 2026-09-14（引擎随包分发：安装包自包含，用户确认）

- **用户需求**：安装包"打包在一起"——用户机器无需 Node、无需仓库即可运行完整 Agent 链路（M10 桌面交付核心）。
- **方案（已确认）**：
  1. 引擎单文件化：esbuild 将 sidecar（含 pi SDK 及全部依赖）打成单 bundle，Node 22 SEA（Single Executable Application）封装为独立可执行文件 `gohomebuddy-engine`；pi 以 npm 依赖锁定版本，不进仓库、不 fork。
  2. Tauri 随包：`externalBin` 按 target triple 携带引擎二进制；`main.rs` 重写——启动 spawn 随包引擎，Rust 内实现 stdio↔WebSocket 桥（127.0.0.1:1421，协议/前端零改动），替换现依赖开发机路径与系统 Node 的 node 桥；修复启动 panic。
  3. CI：矩阵各平台自建引擎二进制（SEA 不支持跨平台）后再打安装包。
- **已知代价**：安装包体积从 ~3MB 涨到 50MB+（Node runtime 占大头）；pi 依赖树如有原生扩展需额外随包（风险验证第一步确认）。
- **结果（已完成，全平台验证）**：
  - SEA 方案否决：pi 的 config.js 在初始化时读 `import.meta.url`，SEA 的 CJS 环境下为 undefined，启动即崩；esbuild CJS/ESM 两种产物分别卡在 import.meta 与依赖树 CJS require。改走 **pi 官方支持的 Bun `--compile` 单二进制**路径（源码内置 isBunBinary 适配），91MB，协议探针全绿（handshake/依赖目录/工作空间文件/任务事件流）。
  - Tauri 壳：externalBin 按 triple 随包引擎；main.rs 重写为 spawn 随包引擎 + Rust stdio↔WS 桥（127.0.0.1:1421，单客户端守卫、新连接顶替旧连接），去除开发机路径依赖与启动 panic；bundle.icon 补齐。
  - CI：矩阵各平台 setup-bun 1.4.2 交叉编译对应引擎（bun-windows-x64 / bun-darwin-arm64 / bun-darwin-x64 / bun-linux-x64）后打安装包；全平台 run 34801876501 四 job 全绿。
  - 产物体积：deb 41MB / msi 43MB / dmg 31–34MB。
- **遗留**：干净机器（无 Node、无仓库）安装实测；引擎工作目录/数据目录在打包环境下的首次启动引导；第三方许可声明（pi 及依赖）。

## 2026-09-13（v0.1.0 开发预览 Release）

- **用户反馈**：GitHub 上看不到任何 Release。原因：此前流水线只上传 run artifact，没有发布逻辑。
- **改动**：build.yml 增加 `release` 作业（`v*` 标签触发时汇总四平台安装包并创建 GitHub Release）；首版 `v0.1.0` 标签已发布。
- **踩坑**：download-artifact 合并落盘时保留了 artifact 内的子目录（deb/、msi/、dmg/），softprops 的单层 glob `dist/*` 匹配不到文件，作业却仍以成功退出，产生了一个空 Release——已改 `dist/**` 递归匹配并加产物清单步骤；本次 v0.1.0 的安装包由本地从 run artifact 下载后用 `gh release upload` 补挂（零 CI 消耗），后续标签走修复后的自动发布。
- **结果**：Release v0.1.0（开发预览）含 amd64.deb / x64_en-US.msi / aarch64.dmg / x64.dmg 四个安装包（2.9–4.6MB，含水獭图标）。

## 2026-09-13（品牌图标：aitoys 水獭 logo）

- **用户需求**：使用本地 aitoys 项目的水獭 logo 作为产品图标。
- **改动**：源图取 aitoys web 的 apple-icon.png（180×180，透明底），lanczos 放大到 1024 后用 `tauri icon` 重新生成全套打包图标（ico/icns/各尺寸 png/Windows Store/Android）；UI 三处品牌位（侧栏品牌、hero、消息头像）由 Lucide 占位图标换为水獭图（`src/assets/otter.png`，透明底适配双主题）。新增 `vite-env.d.ts` 补 Vite 资源类型。
- **状态**：已完成，typecheck/build 通过。

## 2026-09-13（GitHub Actions 构建流水线）

- **用户需求**：CI 需能构建 Linux(Ubuntu)、Windows、macOS（ARM 与 Intel 分别打包）。
- **决定**：新增 `.github/workflows/build.yml`。成本策略（私有仓库 macOS 10x/Windows 2x 计费倍率）：推 main/PR 只构建 Linux 做持续验证；`workflow_dispatch`（targets=all）或推 `v*` 标签触发全平台矩阵——ubuntu-22.04(deb)、windows-latest(msi)、macos-14(aarch64 dmg)、macos-13(x86_64 dmg)。Rust 缓存加速；`OFFICE_AGENT_ROOT` 编译期注入与本地一致；产物按平台上传 artifact。
- **状态**：全平台验证通过（run 34759401228 四个 job 全绿）。过程中修复两处：①CI 产物 glob 未命中，改为矩阵显式 target triple 的确定性路径 + 产物清单诊断步骤；②Windows 打包报 `Couldn't find a .ico icon`——tauri.conf.json 缺 `bundle.icon`（本地只打 deb 未暴露），已补图标数组。另将 Intel 目标从排队严重的 macos-13 挪到 macos-14 交叉编译 x86_64-apple-darwin。产物：deb/msi/dmg(ARM+Intel) 各约 2.6–2.9MB，在 Actions run 页面以 artifact 下载；发布到 GitHub Releases 待签名策略确定后另立记录。
- **成本提示**：私有仓库 macOS 计费 10x、Windows 2x；日常推 main 只跑 Linux，全平台仅在手动触发（targets=all）或打 `v*` 标签时运行。

## 2026-09-13（文档整理 + 建立私有远端仓库）

- **用户需求**：总结整理文档与代码说明（需求/开发测试流程/构建），去除冗余和冲突；在 GitHub 创建私有仓库并推送。
- **整理内容**：
  - `docs/README.md` 重写为文档索引（各文档用途+状态、阅读顺序、更名说明）。
  - `agent-interaction.md` §2 思考展示由旧的"折叠块"交互更新为现行实现（思考行/运行中单行脉冲/完成态可点击展开），消除与代码的冲突。
  - 根 README 重构：产品简介 → 快速开始 → 常用命令与开发测试流程（typecheck/build/smoke + 提交自检约定）→ 桌面构建 → 当前可用/尚未完成 → 结构与文档索引；对外表述统一"本地引擎"。
  - AGENTS.md 项目概要补充产品名。内部技术文档（mvp-scope/technical-architecture/s0-validation）保留 pi 选型描述，属内部工程文档。
- **状态**：已完成；随后创建 GitHub 私有仓库并推送。

## 2026-09-13（产品更名 GoHomeBuddy + 控制条自适应修正）

- **用户反馈**：①控制条能显示文字时就显示文字，只在放不下时收敛为图标，且模型名任何时候都显示；②产品更名 **GoHomeBuddy**（中文名：下班搭子），标语 "Get work done. Go home earlier."。
- **改动**：
  - 控制条自适应改为 JS 测量溢出（ResizeObserver + scrollWidth 比较）驱动 `composer--compact` 类：默认全文字，放不下才藏非模型文字；模型名常显、超宽省略。移除此前的 ≤920px 媒体查询与模型 Cpu 图标方案。
  - 更名落地：侧栏品牌、回答标签、设置关于、窗口/页面标题、tauri productName、sidecar 系统提示词（自称 GoHomeBuddy/下班搭子）、README；hero 问候语下新增标语行。包名（@office/*）与 identifier 暂不动，属内部标识。
- **状态**：已完成，typecheck/build 通过。

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
