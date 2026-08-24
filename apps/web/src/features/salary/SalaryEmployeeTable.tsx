import { useMemo, useState } from "react";
import type { Batch, SalaryItem } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Status } from "../../components/Status";
import { formatSalaryValue } from "../../format";
import { Icon } from "../../icons";

export type SalaryStatusFilter =
  | "all"
  | "unread"
  | "unconfirmed"
  | "failed";

export function SalaryEmployeeTable({
  batch,
  items,
  statusFilter,
  busy,
  onStatusFilterChange,
  onSendAll,
  onWithdrawAll,
  onSendItem,
  onWithdrawItem,
  onEditItem,
}: {
  batch: Batch;
  items: SalaryItem[];
  statusFilter: SalaryStatusFilter;
  busy: boolean;
  onStatusFilterChange: (filter: SalaryStatusFilter) => void;
  onSendAll: () => void;
  onWithdrawAll: () => void;
  onSendItem: (item: SalaryItem) => void;
  onWithdrawItem: (item: SalaryItem) => void;
  onEditItem: (item: SalaryItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const employees = useMemo(() => {
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
        (statusFilter === "failed" && item.deliveryStatus === "failed");
      return matchesQuery && matchesStatus;
    });
  }, [items, query, statusFilter]);

  function printEvidence() {
    setMoreOpen(false);
    window.print();
  }

  return (
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
            onStatusFilterChange(event.target.value as SalaryStatusFilter)
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
                disabled={batch.state === "withdrawn"}
                onClick={onWithdrawAll}
              >
                全部撤回
              </button>
              <a
                href={`/v1/reports/summary.csv?payrollMonth=${batch.payrollMonth}`}
                onClick={() => setMoreOpen(false)}
              >
                导出 Excel 明细
              </a>
              <button onClick={printEvidence}>导出 PDF 存证</button>
            </div>
          )}
        </div>
        <button className="button secondary employee-toolbar-spacer-action" disabled>
          定时发送
        </button>
        <button className="button primary" disabled={busy} onClick={onSendAll}>
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
                    employees.length && selectedItems.length === employees.length,
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
              const net = item.fields[batch.displaySettings.netAmountField];
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
                    {typeof net === "number" ? formatSalaryValue(net) : "已加密"}
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
                    <div className="salary-row-actions">
                      {item.deliveryStatus === "delivered" && (
                        <button
                          className="text-button danger"
                          disabled={item.canWithdraw !== true || busy}
                          onClick={() => onWithdrawItem(item)}
                        >
                          撤回
                        </button>
                      )}
                      <button
                        className="text-button"
                        disabled={item.canEdit !== true || busy}
                        onClick={() => onEditItem(item)}
                      >
                        编辑
                      </button>
                      {item.deliveryStatus === "withdrawn" ? (
                        <button
                          className="text-button"
                          disabled={item.canSend !== true || busy}
                          onClick={() => onSendItem(item)}
                        >
                          重新发送
                        </button>
                      ) : item.deliveryStatus !== "delivered" ? (
                        <button
                          className="text-button"
                          disabled={item.canSend !== true || busy}
                          onClick={() => onSendItem(item)}
                        >
                          单独发送
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!employees.length && <EmptyState label="当前筛选条件下暂无员工" />}
      </div>
    </div>
  );
}
