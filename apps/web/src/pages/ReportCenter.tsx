import { useEffect, useState } from "react";
import { api, type ReportSummary } from "../api";
import { Icon } from "../icons";
import { formatMoney } from "../utils/ui";
import { errorText } from "../utils/errors";
import { EmptyState } from "../components/EmptyState";
import { Metric } from "../components/Metric";
import { Status } from "../components/Status";

export function ReportCenter({ refreshKey }: { refreshKey: number }) {
  const [report, setReport] = useState<ReportSummary>();
  const [payrollMonth, setPayrollMonth] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => {
    const query = payrollMonth
      ? `?payrollMonth=${encodeURIComponent(payrollMonth)}`
      : "";
    api<ReportSummary>(`/v1/reports/summary${query}`)
      .then(setReport)
      .catch((reason) => setError(errorText(reason)));
  }, [payrollMonth, refreshKey]);
  const months = [...new Set(report?.batches.map((batch) => batch.payrollMonth) ?? [])];
  const csvHref = payrollMonth
    ? `/v1/reports/summary.csv?payrollMonth=${encodeURIComponent(payrollMonth)}`
    : "/v1/reports/summary.csv";
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <h2>报表中心</h2>
          <p>按批次查看发送覆盖、员工查看和确认进度。</p>
        </div>
        <div className="header-actions">
          <label className="field-label">
            发薪月份
            <select value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)}>
              <option value="">全部月份</option>
              {months.map((month) => <option key={month} value={month}>{month}</option>)}
            </select>
          </label>
          <a className="button secondary" href={csvHref}>
            <Icon name="download" size={17} />
            导出 CSV
          </a>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="metric-strip report-metrics">
        <Metric label="工资批次" value={report?.totals.batches ?? 0} />
        <Metric label="工资条" value={report?.totals.recipients ?? 0} />
        <Metric label="已发送" value={report?.totals.sent ?? 0} />
        <Metric label="已查看" value={report?.totals.viewed ?? 0} />
        <Metric label="已确认" value={report?.totals.confirmed ?? 0} />
        <Metric
          label="发送失败"
          value={report?.totals.failedDeliveries ?? 0}
          {...(report?.totals.failedDeliveries
            ? { tone: "warning" as const }
            : {})}
        />
      </div>
      <div className="report-summary-line">
        <span>
          应发合计{" "}
          <strong>
            ¥ {formatMoney(report?.totals.salaryTotals.gross ?? 0)}
          </strong>
        </span>
        <span>
          实发合计{" "}
          <strong>¥ {formatMoney(report?.totals.salaryTotals.net ?? 0)}</strong>
        </span>
        <span>
          个税合计{" "}
          <strong>¥ {formatMoney(report?.totals.salaryTotals.tax ?? 0)}</strong>
        </span>
        <span>
          社保扣款{" "}
          <strong>
            ¥ {formatMoney(report?.totals.salaryTotals.socialInsurance ?? 0)}
          </strong>
        </span>
      </div>
      <div className="table-card">
        <div className="table-toolbar">
          <div className="table-title">批次明细</div>
          <span className="toolbar-note">统计范围：当前可管理工资表</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>月份</th>
                <th>标题</th>
                <th>状态</th>
                <th>人数</th>
                <th>已发送</th>
                <th>已查看</th>
                <th>已确认</th>
                <th>失败</th>
              </tr>
            </thead>
            <tbody>
              {report?.batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="strong">{batch.payrollMonth}</td>
                  <td>{batch.title}</td>
                  <td>
                    <Status state={batch.state} />
                  </td>
                  <td>{batch.total}</td>
                  <td>{batch.sent}</td>
                  <td>{batch.viewed}</td>
                  <td>{batch.confirmed}</td>
                  <td>{batch.deliveryFailures || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!report?.batches.length && <EmptyState label="暂无报表数据" />}
        </div>
      </div>
    </section>
  );
}
