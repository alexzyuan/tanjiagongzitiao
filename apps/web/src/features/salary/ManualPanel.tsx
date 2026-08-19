import { useState, type FormEvent } from "react";
import { api } from "../../api";
import { currentMonth } from "../../utils/ui";
import { errorText } from "../../utils/errors";
import { Field } from "../../components/Field";
import { FormActions } from "../../components/FormActions";
import { Modal } from "../../components/Modal";

export function ManualPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    payrollMonth: currentMonth(),
    title: `${currentMonth()} 工资条`,
    userId: "employee-a",
    name: "员工A",
    net: "10000",
  });
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      const result = await api<{
        errors: Array<{ message: string }>;
        batchId?: string;
      }>("/v1/salary-batches", {
        method: "POST",
        body: JSON.stringify({
          payrollMonth: form.payrollMonth,
          title: form.title,
          rows: [
            {
              userId: form.userId,
              name: form.name,
              实发金额: Number(form.net),
            },
          ],
        }),
      });
      if (result.errors.length)
        throw new Error(result.errors.map((item) => item.message).join("；"));
      onCreated();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  return (
    <Modal title="手工录入工资条" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <Field label="发薪月份">
          <input
            value={form.payrollMonth}
            onChange={(event) =>
              setForm({ ...form, payrollMonth: event.target.value })
            }
            pattern="\d{4}-\d{2}"
            required
          />
        </Field>
        <Field label="工资条标题">
          <input
            value={form.title}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            required
          />
        </Field>
        <Field label="钉钉用户 ID">
          <input
            value={form.userId}
            onChange={(event) =>
              setForm({ ...form, userId: event.target.value })
            }
            required
          />
        </Field>
        <Field label="员工姓名">
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
          />
        </Field>
        <Field label="实发金额">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.net}
            onChange={(event) => setForm({ ...form, net: event.target.value })}
            required
          />
        </Field>
        {error && <div className="notice error span-2">{error}</div>}
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}
