# Office Agent 产品与技术文档

版本：v0.1 · 日期：2026-09-11 · 状态：供实施的需求基线，尚未完成开发验证。

项目暂称 Office Agent；仓库目录名为 gohomeagent。最终名称不影响当前设计。

本轮最新需求优先：MVP 是一个有设计品质的桌面 Agent，提供会话、模型配置、pi 基础编程与本地执行能力。知识库、Memory、Todo、邮件、日历、项目和 KPI 是后续方向，不是本轮交付项。

| 文档 | 用途 |
| --- | --- |
| [产品需求 PRD](./prd.md) | 用户、页面、功能、视觉动效、用户流程与验收要求 |
| [Agent 执行过程交互](./agent-interaction.md) | 思考、工具卡片、修改 diff、执行状态、上下文和动效细则 |
| [MVP 范围与验收](./mvp-scope.md) | 明确必做、不做、兼容边界、发布门槛 |
| [技术选型与架构](./technical-architecture.md) | 技术决策、模块边界、存储、打包和后续演进 |
| [S0 技术验证记录](./s0-validation.md) | 已锁定版本、冒烟结果、未执行阻塞项 |
| [过程记录](./process-log.md) | 需求落地过程流水（新记录在顶部） |
| [商业化体验 PRD](./commercial-ui-prd.md) | 第二阶段：Activity Timeline/Tool Card/Artifact/权限 |

阅读顺序：先看 MVP 范围，再读 PRD，最后读技术架构。

这些文件描述目标与实施方案，不表示已经实现。版本号、模型目录、pi API 和打包细节需要在第一阶段验证后锁定；不得把实时联网调用或 Windows 打包标成已通过。
