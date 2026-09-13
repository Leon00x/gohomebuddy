import { BrainCog, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { UiActivity, UiMessage } from "../App";
import { StreamingMarkdown } from "./StreamingMarkdown";
import { ToolCard } from "./ToolCard";

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "";
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

/** Codex 式过程区：运行中展开，完成后折叠，正式回答由父组件渲染在下方。 */
export function ActivityTimeline({ msg, running }: { msg: UiMessage; running: boolean }) {
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const [now, setNow] = useState(Date.now());
  const failedOrStopped = msg.runStatus === "failed" || msg.runStatus === "stopped" || Boolean(msg.error);
  const expanded = running ? true : expandedOverride ?? failedOrStopped;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const finalTextId = useMemo(
    () => [...msg.activities].reverse().find((activity) => activity.kind === "text")?.id,
    [msg.activities],
  );
  const processActivities = useMemo(
    () => msg.activities.filter((activity) => running || activity.id !== finalTextId),
    [finalTextId, msg.activities, running],
  );
  const meaningfulSteps = processActivities.filter((activity) => activity.kind !== "text").length;
  const duration =
    msg.runDurationSec ??
    (running && msg.runStartedAt ? Math.max(0, Math.round((now - msg.runStartedAt) / 1000)) : undefined);
  const failed = msg.runStatus === "failed" || Boolean(msg.error);
  const stateClass = running ? "running" : failed ? "failed" : msg.runStatus === "stopped" ? "stopped" : "completed";
  const stateLabel = running ? "正在工作" : failed ? "执行失败" : msg.runStatus === "stopped" ? "已停止" : "已工作";

  if (!running && processActivities.length === 0) return null;

  return (
    <section className={`activity ${stateClass}`} aria-label="任务执行过程">
      <button className="activity-head" onClick={() => !running && setExpandedOverride(!expanded)} aria-expanded={expanded}>
        <span className="activity-dot" />
        <span className="activity-state-text">
          {stateLabel}{duration !== undefined ? ` ${formatDuration(duration)}` : ""}
          {!running && meaningfulSteps > 0 ? ` · ${meaningfulSteps} 个步骤` : ""}
        </span>
        <ChevronDown size={13} className={`tc-chev${expanded ? "" : " closed"}`} />
      </button>
      <div className={`activity-collapse${expanded ? " expanded" : ""}`} aria-hidden={!expanded}>
        <div className="activity-items">
          {processActivities.map((activity: UiActivity) => {
            if (activity.kind === "thinking") {
              const live = running && activity.durationSec === undefined;
              return <div className="act-row act-think" key={activity.id}>
                <BrainCog size={13} className={live ? "spin-slow" : undefined} />
                <span>
                  思考{!live && activity.durationSec !== undefined ? ` · 持续了 ${activity.durationSec} 秒` : ""}
                </span>
                {live && activity.text.length > 0 && <span className="think-pulse">{activity.text.slice(-72)}</span>}
              </div>;
            }
            if (activity.kind === "tool") return <ToolCard step={activity.step} key={activity.id} />;
            return <div className="act-text" key={activity.id}>
              <StreamingMarkdown content={activity.text} streaming={running && activity.id === finalTextId} />
              {running && activity.id === finalTextId && <span className="stream-cursor" />}
            </div>;
          })}
        </div>
      </div>
    </section>
  );
}
