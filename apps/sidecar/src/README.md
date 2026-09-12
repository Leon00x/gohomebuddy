# Sidecar：pi 运行时宿主

Node 进程，承载 pi-coding-agent SDK，通过 stdin/stdout 的 LF 分隔 JSONL 与宿主（Tauri 或开发桥）通信。协议命令与事件类型定义在 `@office/contracts`。

## 运行

```sh
npm run build          # tsc 编译到 dist/
node dist/index.js --agent-dir <应用数据目录/pi> --cwd <工作目录>
```

- `--agent-dir`：pi 全部默认路径（会话、auth.json、models.json、settings）的隔离根，通过 `PI_CODING_AGENT_DIR` 环境变量生效，不会触碰用户的 `~/.pi`。
- `--cwd`：会话归属的工作目录。
- stdout 只输出协议消息；诊断日志走 stderr 并镜像为 `log` 事件。

## 命令（MVP）

`handshake` · `config.providers` · `config.setApiKey`（运行时注入，同时写应用隔离目录的 auth.json，权限 0600）· `config.custom.save`（写隔离目录下的 models.json）· `session.list/new/open/rename/delete` · `run.start/followUp/cancel` · `os.open` · `fs.stat`。

要点：

- 命令响应只表示接受/拒绝；任务结果通过 `run.*` 事件送达，事件带 `runId` 与单调 `sequence`。
- 单活跃 run；运行中拒绝会话切换与配置变更。
- pi 把请求失败表示为 `stopReason: "error"` 的终止消息，适配器转换为 `run.end{reason:"error"}`。
- DeepSeek / 智谱 GLM / Z.AI 是 pi 内置 provider；自定义 OpenAI 兼容端点经 `config.custom.save` 写入 models.json。

## 验证

`npm run smoke`（仓库根）启动编译产物并跑 12 项协议冒烟，全程不需要真实 API Key：用占位 Key 触发真实请求，以 401 验证事件管道、错误传播与 run 锁释放。真实模型的流式与工具往返（A02）仍需有效 Key 后执行并记录。
