import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { api, type Batch, type SalaryItem } from "../api";
import { Icon } from "../icons";
import { currentMonth } from "../utils/ui";
import { errorText } from "../utils/errors";
import { Field } from "../components/Field";
import { FormActions } from "../components/FormActions";
import { Modal } from "../components/Modal";
import { ImportWizard } from "../features/salary/ImportWizard";
import { SalaryBatchOverview } from "../features/salary/SalaryBatchOverview";
import {
  SalaryEmployeeTable,
  type SalaryStatusFilter,
} from "../features/salary/SalaryEmployeeTable";

export function SalaryManagement({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [statusFilter, setStatusFilter] = useState<SalaryStatusFilter>("all");
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const [detailBatchId, setDetailBatchId] = useState<string>();
  const [detail, setDetail] = useState<Batch>();
  const [editingItem, setEditingItem] = useState<SalaryItem>();
  const [deleteCandidate, setDeleteCandidate] = useState<Batch>();
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<"import">();
  const [busy, setBusy] = useState(false);
  const [, setMessage] = useState<string>();
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
  const selectedBatch = detailBatch ?? activeBatch;

  const loadDetail = useCallback(async (batchId: string) => {
    const next = await api<Batch>(`/v1/salary-batches/${batchId}`);
    setDetail(next);
    return next;
  }, []);

  useEffect(() => {
    setActiveBatchId((current) =>
      monthBatches.some((batch) => batch.id === current)
        ? current
        : monthBatches[0]?.id,
    );
  }, [monthBatches]);

  useEffect(() => {
    if (!detailBatchId) {
      setDetail(undefined);
      return;
    }
    loadDetail(detailBatchId).catch((reason) => setError(errorText(reason)));
  }, [detailBatchId, loadDetail]);

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

  async function deleteBatch(batch: Batch) {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/v1/salary-batches/${batch.id}`, { method: "DELETE" });
      if (detailBatchId === batch.id) setDetailBatchId(undefined);
      setDeleteCandidate(undefined);
      setMessage("工资条已删除");
      await load();
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(item: SalaryItem) {
    if (item.canEdit !== true) return;
    setEditingItem(item);
    setEditFields(
      Object.fromEntries(
        Object.entries(item.fields).map(([key, value]) => [
          key,
          value === null || value === undefined ? "" : String(value),
        ]),
      ),
    );
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingItem || !selectedBatch) return;
    setBusy(true);
    setError(undefined);
    try {
      const fields = Object.fromEntries(
        Object.entries(editFields).map(([key, value]) => {
          const original = editingItem.fields[key];
          if (typeof original === "number") {
            const numeric = Number(value);
            return [key, Number.isFinite(numeric) ? numeric : value];
          }
          return [key, value];
        }),
      );
      const updated = await api<Batch>(
        `/v1/salary-batches/${selectedBatch.id}/items/${editingItem.id}`,
        { method: "PATCH", body: JSON.stringify({ fields }) },
      );
      setDetail(updated);
      setEditingItem(undefined);
      setMessage(`${editingItem.employeeName} 的工资字段已更新`);
      await load();
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="salary-workspace">
      <div className="salary-heading">
        {detailBatchId && (
          <button
            className="back-button"
            aria-label="返回"
            onClick={() => setDetailBatchId(undefined)}
          >
            ‹ <span>返回</span>
          </button>
        )}
        <h2>
          {detailBatch
            ? detailBatch.title
            : `${month.replace("-", "年")}月工资条`} {" "}
          <small>
            {detailBatch
              ? detailBatch.payrollMonth.replace("-", "/")
              : month.replace("-", "/")}
          </small>
        </h2>
        <span className="security-badge">
          <Icon name="shield" size={14} />
          敏感数据加密
        </span>
      </div>
      {!detailBatchId ? (
        <SalaryBatchOverview
          month={month}
          batches={monthBatches}
          busy={busy}
          onMonthChange={setMonth}
          onOpenImport={() => setMode("import")}
          onDelete={(batch) => {
            setError(undefined);
            setDeleteCandidate(batch);
          }}
          onOpenBatch={(batch) => {
            setActiveBatchId(batch.id);
            setDetailBatchId(batch.id);
          }}
        />
      ) : selectedBatch ? (
        <SalaryEmployeeTable
          batch={selectedBatch}
          items={detail?.items ?? []}
          statusFilter={statusFilter}
          busy={busy}
          onStatusFilterChange={setStatusFilter}
          onSendAll={() =>
            void sendActive(selectedBatch.state === "draft" ? "send" : "resend")
          }
          onWithdrawAll={() => void sendActive("withdraw")}
          onSendItem={(item) => void sendIndividual(selectedBatch, item)}
          onWithdrawItem={(item) => void withdrawIndividual(selectedBatch, item)}
          onEditItem={startEdit}
        />
      ) : null}
      {editingItem && (
        <Modal
          title={`编辑 ${editingItem.employeeName} 的工资条`}
          onClose={() => setEditingItem(undefined)}
        >
          <form className="form-grid" onSubmit={(event) => void saveEdit(event)}>
            {Object.keys(editFields).map((field) => (
              <Field label={field} key={field}>
                <input
                  aria-label={field}
                  value={editFields[field] ?? ""}
                  onChange={(event) =>
                    setEditFields((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                />
              </Field>
            ))}
            <FormActions
              onClose={() => setEditingItem(undefined)}
              submitLabel="保存并关闭"
            />
          </form>
        </Modal>
      )}
      {deleteCandidate && (
        <Modal
          title="确认删除工资条"
          onClose={() => {
            if (!busy) setDeleteCandidate(undefined);
          }}
        >
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void deleteBatch(deleteCandidate);
            }}
          >
            <p className="span-2">确定删除 {deleteCandidate.title} 吗？</p>
            {error && <div className="notice error span-2">{error}</div>}
            <div className="form-actions span-2">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setDeleteCandidate(undefined)}
              >
                取消
              </button>
              <button type="submit" className="button primary" disabled={busy}>
                确认删除
              </button>
            </div>
          </form>
        </Modal>
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
