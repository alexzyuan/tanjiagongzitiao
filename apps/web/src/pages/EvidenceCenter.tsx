import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "../icons";
import { formatDate } from "../utils/ui";
import { errorText } from "../utils/errors";
import { EmptyState } from "../components/EmptyState";
import { Metric } from "../components/Metric";
import { Status } from "../components/Status";

export function EvidenceCenter({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<
    Array<{
      id: string;
      batchId: string;
      employeeUserId: string;
      eventType: string;
      fingerprint: string;
      createdAt: string;
    }>
  >([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<typeof events>("/v1/payment-evidence")
      .then(setEvents)
      .catch((reason) => setError(errorText(reason)));
  }, [refreshKey]);
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <h2>发薪存证</h2>
          <p>记录通知、查看和确认链路，保留可审计的时间戳与指纹。</p>
        </div>
        <span className="security-badge">
          <Icon name="shield" size={16} />
          加密归档
        </span>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="metric-strip">
        <Metric label="存证事件" value={events.length} />
        <Metric
          label="已通知"
          value={
            events.filter((event) => event.eventType === "notification_sent")
              .length
          }
        />
        <Metric
          label="已查看"
          value={events.filter((event) => event.eventType === "viewed").length}
        />
        <Metric
          label="已确认"
          value={
            events.filter((event) => event.eventType === "confirmed").length
          }
        />
      </div>
      <div className="table-card">
        <div className="table-toolbar">
          <div className="table-title">存证流水</div>
          <span className="toolbar-note">敏感工资字段不出现在存证流水中</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>工资表</th>
                <th>员工标识</th>
                <th>事件</th>
                <th>指纹</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.createdAt)}</td>
                  <td className="mono">{event.batchId}</td>
                  <td>{event.employeeUserId}</td>
                  <td>
                    <Status state={event.eventType} />
                  </td>
                  <td className="mono">{event.fingerprint.slice(0, 18)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && <EmptyState label="暂无存证事件" />}
        </div>
      </div>
    </section>
  );
}
