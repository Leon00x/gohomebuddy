# GoHomeBuddy（下班搭子）产品与技术文档

更新：2026-09-13 · 产品名已由 Office Agent 更名 **GoHomeBuddy**（中文名：下班搭子），标语 "Get work done. Go home earlier."。历史文档中的 "Office Agent" 均指本产品。

产品一句话：有设计品质的桌面个人 Agent——会话、模型配置、本地文件与命令执行；知识库、Memory、Todo、邮件日历等是后续方向，不是本轮交付。

| 文档 | 用途 | 状态 |
| --- | --- | --- |
| [产品需求 PRD](./prd.md) | 用户、页面、功能、视觉动效与验收要求 | 基线；第二阶段 P0 已完成，P1 实施中 |
| [MVP 范围与验收](./mvp-scope.md) | 必做/不做、兼容边界、验收场景、发布门槛 | 基线 |
| [Agent 执行过程交互](./agent-interaction.md) | 执行过程/思考行/工具卡片/停止异常细则 | 已按 Codex 式交互更新 |
| [商业化体验 PRD](./commercial-ui-prd.md) | 第二阶段：Activity Timeline、工具/产物卡、权限模式、UI 视觉系统 | P0 完成，P1 完成，P2 未开始 |
| [技术选型与架构](./technical-architecture.md) | 技术决策、模块边界、存储、打包与演进 | 拟采用方案，随实施回填 |
| [S0 技术验证记录](./s0-validation.md) | 引擎版本、目录隔离、错误传播等已锁定事实 | 记录性文档 |
| [过程记录](./process-log.md) | 需求落地过程流水（新记录在顶部） | 持续追加 |

阅读顺序：MVP 范围 → PRD → 技术架构；日常开发守则见仓库根 [AGENTS.md](../AGENTS.md)（文档先行硬规则、常用命令、已知坑、提交前自检）。

这些文件描述目标与实施方案，不代表全部已实现。厂商真实验收（智谱/自定义端点）、Windows 打包等未完成项以 PRD「尚未完成」清单和过程记录为准。
