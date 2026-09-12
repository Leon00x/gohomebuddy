# S0 技术验证记录

日期：2026-09-12 · 环境：Ubuntu（开发机），Node 22.22.3 · 执行人：编码代理

## 已锁定

| 项 | 结果 |
| --- | --- |
| pi 包名与版本 | `@earendil-works/pi-coding-agent` 精确锁定 `0.85.1`（npm latest；存在 legacy-node20 = 0.74.2 标签，不采用） |
| Node | 22.22.3 可运行 pi 0.85.1，ESM 正常 |
| 目录隔离 | 官方环境变量 `PI_CODING_AGENT_DIR` 将 pi 全部默认路径（sessions、auth.json、models.json、settings）重定向到应用目录，无需复制内部 slug 逻辑 |
| DeepSeek | 内置 provider `deepseek`，目录含 deepseek-v4-flash / deepseek-v4-pro / deepseek-flash |
| 智谱 GLM | 内置 provider `zhipu`（通用）、`zai`（国际）、`zai-coding-cn`（ Coding Plan CN），glm-5 系列在目录中 |
| 会话存储 | `SessionManager.create/open/listAll`；会话按 cwd slug 分目录；空会话（尚无消息）不进入 listAll 索引 |
| 错误传播 | 模型请求失败**不抛异常**：`prompt()` 正常 resolve，终止 assistant 消息带 `stopReason:"error"` 与 `errorMessage`；适配器已转换为 `run.end{reason:"error"}` |
| 密钥注入 | `ModelRuntime.setRuntimeApiKey(providerId, key)` 内存生效不落盘，符合"密钥不落普通配置"边界 |

## 冒烟结果（`npm run smoke`，12/12 通过）

握手、provider 目录、DeepSeek 目录、session new/open/list、run 接受、事件管道（turn.end + run.end）、run 锁释放、二次 run 错误传播（占位 Key 触发真实 401）、空闲 cancel 拒绝、未知方法拒绝。

## 冒烟中发现并修复的问题

1. `SessionManager.listAll(cwd)` 的参数是 sessionDir 不是 cwd —— 空参调用即可（env 已重定向）。
2. 子进程 spawn ENOENT 的真实原因是 cwd 目录不存在，与 PATH 无关。
3. 错误终止必须显式检查 `stopReason`，否则失败任务会被误报为 completed。

## 未执行（阻塞项，非缺陷）

- **A02 三厂商真实流式与工具往返**：无有效 API Key，冒烟仅验证到 401 错误路径；需要 DeepSeek、智谱、一个自定义兼容端点的真实 Key。
- **流式文本/思考/工具事件的实际帧**：`message_update`（text_delta / thinking_delta）与 `tool_execution_*` 的字段形状按官方文档实现并做了防御式映射，需真实运行确认。
- **Windows / PowerShell / 打包**：按架构文档属 S3，未开始。

## 2026-09-13 状态回填

- 浏览器开发链路、live 协议客户端、流式消息、工具事件、模型配置、会话管理和真实 DeepSeek 文件写入已经完成。
- Linux Tauri 无边框窗口与 deb 已生成；Windows / PowerShell 仍未验证。
- DeepSeek 已完成真实端到端任务；智谱与自定义兼容端点仍待有效凭证验证。
- Key 当前写入应用隔离认证文件并使用 0600 权限，系统凭证库存储尚未实现。
- 权限三档已具备 UI 与持久化，引擎级拦截和 Approval Card 尚未实现。
- 2026-09-13 冒烟已恢复为 12/12：改用可注入流的同进程 JSONL 协议测试，规避受限环境对子进程 stdin 的提前关闭；同时补充离线环境、确定性 Node 路径，并确保应用数据目录在加载引擎模块之前生效。

## 下一步

1. 完成 Codex 式过程折叠与正式回答置底的双主题回归。
2. 继续拆分主页面与样式。
3. 设计并验证引擎级权限拦截，再决定 Approval Card 的实现范围。
