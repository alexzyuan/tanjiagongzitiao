import { useEffect, useMemo, useState } from "react";
import { api, type ReportSummary } from "../api";
import { Icon } from "../icons";
import { formatMoney } from "../utils/ui";
import { errorText } from "../utils/errors";
import { EmptyState } from "../components/EmptyState";
import { Status } from "../components/Status";

export function ReportCenter({ refreshKey }: { refreshKey: number }) {
  const [report, setReport] = useState<ReportSummary>();
  const [appliedFromMonth, setAppliedFromMonth] = useState("");
  const [appliedToMonth, setAppliedToMonth] = useState("");
  const [fromMonth, setFromMonth] = useState("");
  const [toMonth, setToMonth] = useState("");
  const [scopeOpen, setScopeOpen] = useState(false);
  const [error, setError] = useState<string>();

  const reportQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedFromMonth) params.set("fromMonth", appliedFromMonth);
    if (appliedToMonth) params.set("toMonth", appliedToMonth);
    const value = params.toString();
    return value ? `?${value}` : "";
  }, [appliedFromMonth, appliedToMonth]);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    api<ReportSummary>(`/v1/reports/summary${reportQuery}`)
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, reportQuery]);

  const csvHref = `/v1/reports/summary.csv${reportQuery}`;
  const employeeCsvHref = `/v1/reports/employees.csv${reportQuery}`;
  const monthly = report?.monthly ?? [];
  const employees = report?.employees ?? [];

  const applyScope = () => {
    if (fromMonth && toMonth && fromMonth > toMonth) {
      setError("统计起始月份不能晚于结束月份");
      return;
    }
    setError(undefined);
    setAppliedFromMonth(fromMonth);
    setAppliedToMonth(toMonth);
    setScopeOpen(false);
  };

  return (
    <section className="content-section report-center">
      <div className="section-header report-header">
        <div>
          <h2>报表中心</h2>
          <p>按统计月份查看人力成本和员工薪资汇总。</p>
        </div>
        <div className="report-scope-controls">
          <label>
            <span>统计起始月份</span>
            <input
              aria-label="统计起始月份"
              type="month"
              value={fromMonth}
              onChange={(event) => setFromMonth(event.target.value)}
            />
          </label>
          <span className="report-range-separator">至</span>
          <label>
            <span>统计结束月份</span>
            <input
              aria-label="统计结束月份"
              type="month"
              value={toMonth}
              onChange={(event) => setToMonth(event.target.value)}
            />
          </label>
          <button
            className="button secondary"
            type="button"
            aria-expanded={scopeOpen}
            onClick={() => setScopeOpen((value) => !value)}
          >
            <Icon name="settings" size={16} />
            统计范围设置
          </button>
        </div>
      </div>
      {scopeOpen && (
        <div className="report-scope-note notice" role="status">
          <Icon name="shield" size={16} />
          统计范围仅包含当前登录管理员有权查看的、未归档工资批次。
          <div className="report-scope-note-actions">
            <button
              className="button primary small"
              type="button"
              onClick={applyScope}
            >
              应用统计范围
            </button>
            <button
              className="button secondary small"
              type="button"
              onClick={() => {
                setFromMonth("");
                setToMonth("");
                setAppliedFromMonth("");
                setAppliedToMonth("");
                setScopeOpen(false);
              }}
            >
              清除范围
            </button>
            <button type="button" onClick={() => setScopeOpen(false)} aria-label="关闭统计范围说明">×</button>
          </div>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}

      <section className="report-panel" aria-labelledby="report-cost-title">
        <div className="report-panel-header">
          <div className="report-panel-title">
            <span className="report-panel-icon"><Icon name="chart" size={16} /></span>
            <h3 id="report-cost-title">人力成本汇总</h3>
          </div>
          <div className="report-panel-actions">
            <a className="text-button" href={csvHref}><Icon name="download" size={16} />下载表格</a>
            <a className="text-button" href="#report-employee-summary">查看详情</a>
          </div>
        </div>
        <MonthlyChart monthly={monthly} />
      </section>

      <div className="report-summary-line">
        <span>应发合计<strong>¥ {formatMoney(report?.totals.salaryTotals.gross ?? 0)}</strong></span>
        <span>实发合计<strong>¥ {formatMoney(report?.totals.salaryTotals.net ?? 0)}</strong></span>
        <span>个税合计<strong>¥ {formatMoney(report?.totals.salaryTotals.tax ?? 0)}</strong></span>
        <span>社保扣款<strong>¥ {formatMoney(report?.totals.salaryTotals.socialInsurance ?? 0)}</strong></span>
      </div>

      <section className="report-panel" id="report-employee-summary" aria-labelledby="report-employee-title">
        <div className="report-panel-header">
          <div className="report-panel-title">
            <span className="report-panel-icon"><Icon name="users" size={16} /></span>
            <h3 id="report-employee-title">员工薪资汇总</h3>
          </div>
          <div className="report-panel-actions">
            <a className="text-button" href={employeeCsvHref}><Icon name="download" size={16} />下载表格</a>
            <a className="text-button" href="#report-batch-details">查看详情</a>
          </div>
        </div>
        <div className="table-scroll report-table-scroll">
          <table className="report-employee-table">
            <thead>
              <tr>
                <th>员工</th><th>工号</th><th>部门</th><th>职位</th><th>工资条数</th><th>实发合计</th><th>已发送</th><th>已查看</th><th>已确认</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => (
                <tr key={employee.employeeUserId}>
                  <td className="strong">{employee.employeeName}</td>
                  <td>{employee.employeeNo ?? "—"}</td>
                  <td>{employee.department ?? "—"}</td>
                  <td>{employee.position ?? "—"}</td>
                  <td>{employee.slips}</td>
                  <td className="money-cell">¥ {formatMoney(employee.net)}</td>
                  <td>{employee.sent}</td>
                  <td>{employee.viewed}</td>
                  <td>{employee.confirmed}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!employees.length && <EmptyState label="暂无员工薪资汇总" />}
        </div>
      </section>

      <section className="report-panel" id="report-batch-details" aria-labelledby="report-batch-title">
        <div className="report-panel-header">
          <div className="report-panel-title"><h3 id="report-batch-title">批次明细</h3></div>
          <span className="toolbar-note">统计范围：当前可管理工资表</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>月份</th><th>标题</th><th>状态</th><th>人数</th><th>已发送</th><th>已查看</th><th>已确认</th><th>失败</th></tr>
            </thead>
            <tbody>
              {report?.batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="strong">{batch.payrollMonth}</td>
                  <td>{batch.title}</td>
                  <td><Status state={batch.state} /></td>
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
      </section>
    </section>
  );
}

function MonthlyChart({ monthly }: { monthly: ReportSummary["monthly"] }) {
  if (!monthly.length) return <EmptyState label="暂无人力成本数据" />;
  const maxNet = Math.max(...monthly.map((month) => month.net), 1);
  const maxRecipients = Math.max(...monthly.map((month) => month.recipients), 1);
  const pointFor = (index: number, value: number) => ({
    x: ((index + 0.5) / monthly.length) * 100,
    y: Math.min(92, Math.max(8, 100 - (value / maxRecipients) * 84 - 8)),
  });
  const points = monthly.map((month, index) => {
    const { x, y } = pointFor(index, month.recipients);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="report-chart" aria-label="按月实发金额和工资条人数趋势">
      <div className="report-chart-plot">
        {[0, 1, 2, 3].map((line) => <span className="report-chart-gridline" style={{ top: `${line * 28}%` }} key={line} />)}
        <div className="report-chart-bars">
          {monthly.map((month) => (
            <div className="report-chart-column" key={month.payrollMonth}>
              <span className="report-chart-bar" style={{ height: `${Math.max((month.net / maxNet) * 84, 3)}%` }} title={`实发金额 ¥ ${formatMoney(month.net)}`} />
            </div>
          ))}
        </div>
        <svg className="report-chart-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="report-chart-points" aria-hidden="true">
          {monthly.map((month, index) => {
            const { x, y } = pointFor(index, month.recipients);
            return (
              <span
                className="report-chart-point"
                key={month.payrollMonth}
                style={{ left: `${x}%`, top: `${y}%` }}
              />
            );
          })}
        </div>
      </div>
      <div className="report-chart-axis">
        {monthly.map((month) => <span key={month.payrollMonth}>{month.payrollMonth.slice(5)}月</span>)}
      </div>
      <div className="report-chart-legend">
        <span><i className="report-legend-bar" />实发金额</span>
        <span><i className="report-legend-line" />发薪人数</span>
      </div>
    </div>
  );
}
