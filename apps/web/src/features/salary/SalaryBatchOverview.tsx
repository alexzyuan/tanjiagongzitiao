import { useState } from "react";
import type { Batch } from "../../api";
import { EmptyState } from "../../components/EmptyState";
import { Status } from "../../components/Status";
import { Icon } from "../../icons";

export function SalaryBatchOverview({
  month,
  batches,
  busy,
  onMonthChange,
  onOpenImport,
  onOpenManual,
  onDelete,
  onOpenBatch,
}: {
  month: string;
  batches: Batch[];
  busy: boolean;
  onMonthChange: (month: string) => void;
  onOpenImport: () => void;
  onOpenManual: () => void;
  onDelete: (batch: Batch) => void;
  onOpenBatch: (batch: Batch) => void;
}) {
  const [monthOpen, setMonthOpen] = useState(false);

  function shiftMonth(delta: number) {
    const [yearText = "0", valueText = "1"] = month.split("-");
    const year = Number(yearText);
    const value = Number(valueText);
    const next = new Date(year, value - 1 + delta, 1);
    onMonthChange(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`,
    );
    setMonthOpen(false);
  }

  return (
    <>
      <div className="salary-controls">
        <button className="button primary" onClick={onOpenImport}>
          <Icon name="plus" size={17} />
          上传工资表
        </button>
        <button className="self-send-tip" onClick={onOpenManual}>
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
                        onMonthChange(candidate);
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
      <div className="salary-batch-list">
        {batches.map((batch) => {
          const allSent = batch.total > 0 && batch.sent >= batch.total;
          const canDelete = batch.canDelete === true;
          return (
            <article className="salary-overview" key={batch.id}>
              <div className="overview-title">
                <strong>{batch.title}</strong>
                <span>
                  <Status state={batch.state} />
                </span>
              </div>
              <div className="overview-stat">
                <span>已发送</span>
                <strong>
                  {batch.sent}/{batch.total}
                </strong>
              </div>
              <div className="overview-stat">
                <span>已撤回</span>
                <strong>{batch.withdrawn ?? 0}</strong>
              </div>
              <div className="overview-stat">
                <span>已查看</span>
                <strong>{batch.viewed}</strong>
              </div>
              <div className="overview-stat">
                <span>已确认</span>
                <strong>{batch.confirmed}</strong>
              </div>
              <div className="overview-actions">
                <button
                  className={
                    canDelete && !busy ? "text-button" : "text-button muted"
                  }
                  disabled={!canDelete || busy}
                  title={canDelete ? undefined : "需撤回所有工资条后，才能删除"}
                  onClick={() => onDelete(batch)}
                >
                  删除
                </button>
                <button
                  className="button secondary"
                  onClick={() => onOpenBatch(batch)}
                >
                  {allSent ? "查看发送" : "前往发送"}
                </button>
              </div>
            </article>
          );
        })}
        {!batches.length && <EmptyState label="当前月份暂无工资表" />}
      </div>
    </>
  );
}
