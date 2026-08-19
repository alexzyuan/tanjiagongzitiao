import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Batch, type SalaryItem } from "../api";
import { Icon } from "../icons";
import { formatSalaryValue } from "../format";
import { currentMonth } from "../utils/ui";
import { errorText } from "../utils/errors";
import { EmptyState } from "../components/EmptyState";
import { Status } from "../components/Status";
import { BatchDetail } from "../features/salary/BatchDetail";
import { ImportWizard } from "../features/salary/ImportWizard";
import { ManualPanel } from "../features/salary/ManualPanel";

export function SalaryManagement({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [monthOpen, setMonthOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "unread" | "unconfirmed" | "failed"
  >("all");
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const [detailBatchId, setDetailBatchId] = useState<string>();
  const [detail, setDetail] = useState<Batch>();
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mode, setMode] = useState<"manual" | "import">();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useCallback(
    () =>
      api<Batch[]>("/v1/salary-batches")
        .then(setBatches)
        .catch((reason) => setError(errorText(reason))),
    [],
  );
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  const monthBatches = useMemo(
    () => batches.filter((batch) => batch.payrollMonth === month),
    [batches, month],
  );
  const activeBatch =
    monthBatches.find((batch) => batch.id === activeBatchId) ?? monthBatches[0];
  const detailBatch = detailBatchId
    ? batches.find((batch) => batch.id === detailBatchId)
    : undefined;
  const loadDetail = useCallback(async (batchId: string) => {
    const next = await api<Batch>(`/v1/salary-batches/${batchId}`);
    setDetail(next);
  }, []);
  useEffect(() => {
    setActiveBatchId((current) =>
      monthBatches.some((batch) => batch.id === current)
        ? current
        : monthBatches[0]?.id,
    );
    setSelectedItems([]);
  }, [monthBatches]);
  useEffect(() => {
    if (!activeBatch) {
      setDetail(undefined);
      return;
    }
    loadDetail(activeBatch.id)
      .catch((reason) => setError(errorText(reason)));
  }, [activeBatch?.id, loadDetail]);
  const employees = useMemo(() => {
    const items = detail?.items ?? [];
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        !needle ||
        [item.employeeName, item.employeeNo, item.department, item.position]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(needle));
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "unread" && !item.viewedAt) ||
        (statusFilter === "unconfirmed" && !item.confirmedAt) ||
        (statusFilter === "failed" &&
          activeBatch?.state === "partially_failed");
      return matchesQuery && matchesStatus;
    });
  }, [activeBatch?.state, detail?.items, query, statusFilter]);
  const unread = (detail?.items ?? []).filter((item) => !item.viewedAt).length;
  const unconfirmed = (detail?.items ?? []).filter(
    (item) => !item.confirmedAt,
  ).length;

  async function send(batch: Batch, action: "send" | "resend" | "withdraw") {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/v1/salary-batches/${batch.id}/${action}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(action === "withdraw" ? "工资条已撤回" : "发送任务已提交");
      await load();
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function sendActive(action: "send" | "resend" | "withdraw") {
    if (!activeBatch) return;
    const label =
      action === "withdraw"
        ? "撤回"
        : action === "resend"
          ? "重新发送"
          : "发送";
    if (!window.confirm(`确定${label} ${activeBatch.title} 吗？`)) return;
    await send(activeBatch, action);
  }

  async function sendIndividual(batch: Batch, item: SalaryItem) {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/v1/salary-batches/${batch.id}/items/${item.id}/send`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(`已向 ${item.employeeName} 发送钉钉工作通知`);
      await load();
      await loadDetail(batch.id);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function withdrawIndividual(batch: Batch, item: SalaryItem) {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/v1/salary-batches/${batch.id}/items/${item.id}/withdraw`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(`已撤回 ${item.employeeName} 的工资条`);
      await load();
      await loadDetail(batch.id);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  function shiftMonth(delta: number) {
    const [yearText = "0", valueText = "1"] = month.split("-");
    const year = Number(yearText);
    const value = Number(valueText);
    const next = new Date(year, value - 1 + delta, 1);
    setMonth(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`,
    );
    setMonthOpen(false);
  }

  function printEvidence() {
    setMoreOpen(false);
    window.print();
  }

  return (
    <section className="salary-workspace">
      <div className="salary-heading">
        <button className="back-button" onClick={() => window.history.back()}>
          ‹ <span>返回</span>
        </button>
        <h2>
          {month.replace("-", "年")}月工资条{" "}
          <small>{month.replace("-", "/")}</small>
        </h2>
        <span className="security-badge">
          <Icon name="shield" size={14} />
          敏感数据加密
        </span>
      </div>
      <div className="salary-alert">
        <span>📣</span>
        <strong>
          导入数据异常：{activeBatch?.state === "partially_failed" ? 1 : 0}
        </strong>
        <button
          className="link-button"
          onClick={() => setStatusFilter("failed")}
        >
          前往处理 ›
        </button>
        <span className="alert-divider" />
        <span>
          未查看：<strong>{unread}</strong>
        </span>
        <button
          className="link-button"
          onClick={() => setStatusFilter("unread")}
        >
          查看未读员工
        </button>
        <span>
          未确认：<strong>{unconfirmed}</strong>
        </span>
        <button
          className="link-button"
          onClick={() => setStatusFilter("unconfirmed")}
        >
          查看未确认员工
        </button>
        <div className="manager-card">
          <span className="avatar blue">管</span>
          <span>
            管理员：<strong>企业管理员</strong>
          </span>
          <button
            className="icon-button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("salary-open-permissions"))
            }
          >
            ›
          </button>
        </div>
      </div>
      <div className="salary-controls">
        <button className="button primary" onClick={() => setMode("import")}>
          <Icon name="plus" size={17} />
          上传工资表
        </button>
        <button className="self-send-tip" onClick={() => setMode("manual")}>
          <strong>自己手发一条试试</strong>
          <span>感受上传、发送全流程</span>
          <Icon name="send" size={17} />
        </button>
        <div className="month-picker-wrap">
          <button
            className="month-picker"
            onClick={() => setMonthOpen((value) => !value)}
          >
            ‹ <strong>{month.replace("-", "年")}月</strong> ›
          </button>
          {monthOpen && (
            <div className="month-panel">
              <div className="month-panel-head">
                <button onClick={() => shiftMonth(-12)}>«</button>
                <strong>{month.slice(0, 4)}</strong>
                <button onClick={() => shiftMonth(12)}>»</button>
              </div>
              <div className="month-grid">
                {Array.from({ length: 12 }, (_, index) => {
                  const candidate = `${month.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`;
                  return (
                    <button
                      className={candidate === month ? "active" : ""}
                      key={candidate}
                      onClick={() => {
                        setMonth(candidate);
                        setMonthOpen(false);
                      }}
                    >
                      {index + 1}月
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="salary-overview">
        <div className="overview-title">
          <strong>
            {activeBatch?.title ?? `${month.replace("-", "年")}月工资条`}
          </strong>
          <span>
            {activeBatch ? <Status state={activeBatch.state} /> : "暂无工资表"}
          </span>
        </div>
        <div className="overview-stat">
          <span>已发送</span>
          <strong>
            {activeBatch?.sent ?? 0}/{activeBatch?.total ?? 0}
          </strong>
        </div>
        <div className="overview-stat">
          <span>已查看</span>
          <strong>{activeBatch?.viewed ?? 0}</strong>
        </div>
        <div className="overview-stat">
          <span>已确认</span>
          <strong>{activeBatch?.confirmed ?? 0}</strong>
        </div>
        <div className="overview-actions">
          <button
            className="text-button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("salary-open-settings"))
            }
          >
            设置
          </button>
          <button className="text-button muted" disabled>
            删除
          </button>
          <button
            className="button secondary"
            onClick={() => activeBatch && setDetailBatchId(activeBatch.id)}
          >
            查看发送
          </button>
        </div>
      </div>
      <div className="employee-table-card">
        <div className="employee-toolbar">
          <label className="search">
            <Icon name="search" size={17} />
            <input
              value={query}
              placeholder="搜索姓名/工号/职位"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as typeof statusFilter)
            }
          >
            <option value="all">筛选</option>
            <option value="unread">未查看</option>
            <option value="unconfirmed">未确认</option>
            <option value="failed">发送失败</option>
          </select>
          <div className="more-wrap">
            <button
              className="button secondary"
              onClick={() => setMoreOpen((value) => !value)}
            >
              更多⌄
            </button>
            {moreOpen && (
              <div className="more-menu">
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    window.dispatchEvent(
                      new CustomEvent("salary-open-settings"),
                    );
                  }}
                >
                  设置工资条
                </button>
                <button
                  disabled={!activeBatch || activeBatch.state === "withdrawn"}
                  onClick={() => void sendActive("withdraw")}
                >
                  全部撤回
                </button>
                <a
                  href={
                    activeBatch
                      ? `/v1/reports/summary.csv?payrollMonth=${activeBatch.payrollMonth}`
                      : "/v1/reports/summary.csv"
                  }
                  onClick={() => setMoreOpen(false)}
                >
                  导出 Excel 明细
                </a>
                <button onClick={printEvidence}>导出 PDF 存证</button>
              </div>
            )}
          </div>
          <button className="button secondary" disabled>
            定时发送
          </button>
          <button
            className="button primary"
            disabled={!activeBatch || busy}
            onClick={() =>
              void sendActive(
                activeBatch?.state === "draft" ? "send" : "resend",
              )
            }
          >
            <Icon name="send" size={15} />
            全部发送
          </button>
        </div>
        <div className="table-scroll salary-employee-scroll">
          <table className="salary-employee-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="全选员工"
                    checked={Boolean(
                      employees.length &&
                      selectedItems.length === employees.length,
                    )}
                    onChange={(event) =>
                      setSelectedItems(
                        event.target.checked
                          ? employees.map((item) => item.id)
                          : [],
                      )
                    }
                  />
                </th>
                <th>姓名</th>
                <th>员工状态</th>
                <th>实发工资</th>
                <th>发送状态</th>
                <th>查看状态</th>
                <th>确认状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((item) => {
                const net = activeBatch
                  ? item.fields[activeBatch.displaySettings.netAmountField]
                  : undefined;
                return (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择${item.employeeName}`}
                        checked={selectedItems.includes(item.id)}
                        onChange={(event) =>
                          setSelectedItems((value) =>
                            event.target.checked
                              ? [...value, item.id]
                              : value.filter((id) => id !== item.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="employee-cell">
                        <span className="avatar blue">
                          {item.employeeName.slice(0, 1)}
                        </span>
                        <span>
                          <strong>{item.employeeName}</strong>
                          <small>
                            {item.department ??
                              item.position ??
                              item.employeeNo ??
                              "员工"}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <Status state="在职" />
                    </td>
                    <td className="money-cell">
                      {typeof net === "number"
                        ? formatSalaryValue(net)
                        : "已加密"}
                    </td>
                    <td>
                      <Status
                        state={
                          item.deliveryStatus === "delivered"
                            ? "sent"
                            : item.deliveryStatus === "failed"
                              ? "failed"
                              : item.deliveryStatus === "withdrawn"
                                ? "withdrawn"
                                : "draft"
                        }
                      />
                    </td>
                    <td>
                      <Status state={item.viewedAt ? "viewed" : "unread"} />
                    </td>
                    <td>
                      <Status
                        state={item.confirmedAt ? "confirmed" : "unconfirmed"}
                      />
                    </td>
                    <td>
                      {item.deliveryStatus === "delivered" ? (
                        <button
                          className="text-button danger"
                          disabled={!activeBatch || busy}
                          onClick={() =>
                            activeBatch &&
                            void withdrawIndividual(activeBatch, item)
                          }
                        >
                          撤回
                        </button>
                      ) : (
                        <button
                          className="text-button"
                          disabled={!activeBatch || busy}
                          onClick={() =>
                            activeBatch && void sendIndividual(activeBatch, item)
                          }
                        >
                          单独发送
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!employees.length && (
            <EmptyState
              label={
                activeBatch ? "当前筛选条件下暂无员工" : "当前月份暂无工资表"
              }
            />
          )}
        </div>
      </div>
      {detailBatch && (
        <BatchDetail
          batch={detailBatch}
          onClose={() => setDetailBatchId(undefined)}
        />
      )}
      {mode === "manual" && (
        <ManualPanel
          onClose={() => setMode(undefined)}
          onCreated={() => {
            setMode(undefined);
            load();
            onChanged();
          }}
        />
      )}
      {mode === "import" && (
        <ImportWizard
          onClose={() => setMode(undefined)}
          onCreated={async (batchId) => {
            setMode(undefined);
            await load();
            setActiveBatchId(batchId);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
