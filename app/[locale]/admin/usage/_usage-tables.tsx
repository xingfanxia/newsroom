import { AdminSectionHeader } from "@/components/admin/section-header";
import { AdminTableFrame } from "@/components/admin/table-frame";
import type { UsageDashboardSummary } from "@/lib/api/usage-summary";
import {
  formatUsageCount,
  formatUsageModelLabel,
  formatUsageTaskModels,
  formatUsageTokens,
  usageTaskTone,
} from "@/lib/llm/usage-display";

type UsageTaskRows = UsageDashboardSummary["byTask"];
type UsageModelRows = UsageDashboardSummary["byModel"];
type UsageRecentRows = UsageDashboardSummary["recentCalls"];

export function UsageBreakdownTables({
  byTask,
  byModel,
  recent,
  zh,
  timeLocale,
}: {
  byTask: UsageTaskRows;
  byModel: UsageModelRows;
  recent: UsageRecentRows;
  zh: boolean;
  timeLocale: "zh-CN" | "en-US";
}) {
  return (
    <div
      style={{
        marginTop: 18,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 18,
      }}
    >
      <CostByTaskTable byTask={byTask} zh={zh} />
      <div>
        <CostByModelTable byModel={byModel} zh={zh} />
        <RecentCallsTable recent={recent} zh={zh} timeLocale={timeLocale} />
      </div>
    </div>
  );
}

function CostByTaskTable({
  byTask,
  zh,
}: {
  byTask: UsageTaskRows;
  zh: boolean;
}) {
  const totalTaskCost = byTask.reduce((a, t) => a + t.costUsd, 0) || 1;

  return (
    <div>
      <AdminSectionHeader
        title={zh ? "按任务花费" : "cost by task"}
        meta={`$${byTask.reduce((a, t) => a + t.costUsd, 0).toFixed(2)}`}
        extraStyle={{ margin: "0 0 8px" }}
      />
      <AdminTableFrame>
        <table className="dt">
          <thead>
            <tr>
              <th>{zh ? "任务" : "task"}</th>
              <th>{zh ? "模型" : "model"}</th>
              <th className="right">{zh ? "次数" : "calls"}</th>
              <th className="right">{zh ? "输入" : "input"}</th>
              <th className="right">{zh ? "输出" : "output"}</th>
              <th className="right">{zh ? "花费" : "cost"}</th>
              <th className="right">{zh ? "占比" : "share"}</th>
            </tr>
          </thead>
          <tbody>
            {byTask.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 20 }}>
                  {zh ? "窗口内无活动" : "no activity in window"}
                </td>
              </tr>
            ) : (
              byTask.map((t) => {
                const share = (t.costUsd / totalTaskCost) * 100;
                return (
                  <tr key={t.task ?? "untagged"}>
                    <td
                      style={{
                        color: "var(--fg-0)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {t.task ?? "untagged"}
                    </td>
                    <td
                      className="muted"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        maxWidth: 180,
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {formatUsageTaskModels(t.models)}
                    </td>
                    <td className="right">{formatUsageCount(t.calls)}</td>
                    <td className="right">
                      <span className="muted">
                        {formatUsageTokens(t.inputTokens)}
                      </span>
                    </td>
                    <td className="right">
                      <span className="muted">
                        {formatUsageTokens(t.outputTokens)}
                      </span>
                    </td>
                    <td
                      className="right"
                      style={{ color: "var(--accent-orange)" }}
                    >
                      ${t.costUsd.toFixed(2)}
                    </td>
                    <td className="right">
                      <div className="hbar">
                        <div className="track">
                          <div
                            className="fill"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                        <span className="num">{share.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableFrame>
    </div>
  );
}

function CostByModelTable({
  byModel,
  zh,
}: {
  byModel: UsageModelRows;
  zh: boolean;
}) {
  return (
    <>
      <AdminSectionHeader
        title={zh ? "按模型花费" : "cost by model"}
        extraStyle={{ margin: "0 0 8px" }}
      />
      <AdminTableFrame style={{ marginBottom: 18 }}>
        <table className="dt">
          <thead>
            <tr>
              <th>{zh ? "模型" : "model"}</th>
              <th>{zh ? "供应商" : "provider"}</th>
              <th className="right">{zh ? "次数" : "calls"}</th>
              <th className="right">{zh ? "花费" : "cost"}</th>
            </tr>
          </thead>
          <tbody>
            {byModel.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted" style={{ padding: 20 }}>
                  {zh ? "窗口内无活动" : "no activity in window"}
                </td>
              </tr>
            ) : (
              byModel.map((m) => (
                <tr key={`${m.provider}/${m.model}`}>
                  <td
                    style={{
                      color: "var(--fg-0)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                    }}
                  >
                    {m.model}
                  </td>
                  <td>
                    <span className="muted">{m.provider}</span>
                  </td>
                  <td className="right">{formatUsageCount(m.calls)}</td>
                  <td
                    className="right"
                    style={{ color: "var(--accent-orange)" }}
                  >
                    ${m.costUsd.toFixed(2)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </AdminTableFrame>
    </>
  );
}

function RecentCallsTable({
  recent,
  zh,
  timeLocale,
}: {
  recent: UsageRecentRows;
  zh: boolean;
  timeLocale: "zh-CN" | "en-US";
}) {
  const timeFmt = new Intl.DateTimeFormat(timeLocale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <>
      <AdminSectionHeader
        title={zh ? "最近调用" : "recent calls"}
        meta={`${recent.length}`}
        extraStyle={{ margin: "0 0 8px" }}
      />
      <AdminTableFrame style={{ maxHeight: 360, overflow: "auto" }}>
        <table className="dt">
          <thead>
            <tr>
              <th>{zh ? "时间" : "time"}</th>
              <th>{zh ? "任务" : "task"}</th>
              <th>{zh ? "模型" : "model"}</th>
              <th className="right">in</th>
              <th className="right">out</th>
              <th className="right">dur</th>
              <th className="right">{zh ? "花费" : "cost"}</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted" style={{ padding: 20 }}>
                  {zh ? "无调用记录" : "no calls recorded yet"}
                </td>
              </tr>
            ) : (
              recent.map((c) => (
                <tr key={c.id}>
                  <td className="muted" style={{ fontSize: 10.5 }}>
                    {timeFmt.format(c.createdAt)}
                  </td>
                  <td>
                    <span className={`pill-s ${usageTaskTone(c.task)}`}>
                      {c.task ?? "—"}
                    </span>
                  </td>
                  <td
                    className="muted"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      maxWidth: 150,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {formatUsageModelLabel(c)}
                  </td>
                  <td className="right">
                    <span className="muted">
                      {formatUsageTokens(c.inputTokens)}
                    </span>
                  </td>
                  <td className="right">
                    <span className="muted">
                      {formatUsageTokens(c.outputTokens)}
                    </span>
                  </td>
                  <td className="right">
                    <span className="muted">
                      {c.durationMs
                        ? `${(c.durationMs / 1000).toFixed(1)}s`
                        : "—"}
                    </span>
                  </td>
                  <td
                    className="right"
                    style={{ color: "var(--accent-orange)" }}
                  >
                    {c.costUsd !== null ? `$${c.costUsd.toFixed(4)}` : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </AdminTableFrame>
    </>
  );
}
