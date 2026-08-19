import { useEffect, useState } from "react";
import { api, type Batch, type SalaryItem } from "../../api";
import { formatSalaryValue } from "../../format";
import { errorText } from "../../utils/errors";
import { Status } from "../../components/Status";

export function BatchDetail({
  batch,
  onClose,
}: {
  batch: Batch;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Batch>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<Batch>(`/v1/salary-batches/${batch.id}`)
      .then(setDetail)
      .catch((reason) => setError(errorText(reason)));
  }, [batch.id]);
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside className="drawer">
        <div className="drawer-header">
          <div>
            <span className="eyebrow">工资表详情</span>
            <h3>{batch.title}</h3>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="detail-summary">
          <span>
            <small>月份</small>
            {batch.payrollMonth}
          </span>
          <span>
            <small>发送进度</small>
            {batch.sent}/{batch.total}
          </span>
          <span>
            <small>查看确认</small>
            {batch.viewed}/{batch.confirmed}
          </span>
        </div>
        <div className="employee-list">
          {detail?.items?.map((item) => (
            <EmployeeRow item={item} batch={batch} key={item.id} />
          ))}
        </div>
      </aside>
    </div>
  );
}

function EmployeeRow({ item, batch }: { item: SalaryItem; batch: Batch }) {
  const net = item.fields[batch.displaySettings.netAmountField];
  return (
    <div className="employee-row">
      <span className="avatar pale">{item.employeeName.slice(0, 1)}</span>
      <div className="employee-main">
        <strong>{item.employeeName}</strong>
        <small>
          {item.employeeNo ?? item.employeeUserId}
          {item.department ? ` · ${item.department}` : ""}
        </small>
      </div>
      <span className="employee-net">
        {typeof net === "number" ? `¥ ${formatSalaryValue(net)}` : "已加密"}
      </span>
      <Status
        state={
          item.confirmedAt ? "confirmed" : item.viewedAt ? "viewed" : "unread"
        }
      />
    </div>
  );
}
