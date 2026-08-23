import type { FormEvent } from "react";
import type { EmployeeMatchStrategy } from "../../../api";
import { Field } from "../../../components/Field";

export function ImportUploadStep({
  month,
  title,
  strategy,
  busy,
  error,
  onMonthChange,
  onTitleChange,
  onStrategyChange,
  onFileChange,
  onSubmit,
  onClose,
}: {
  month: string;
  title: string;
  strategy: EmployeeMatchStrategy;
  busy: boolean;
  error?: string;
  onMonthChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onStrategyChange: (value: EmployeeMatchStrategy) => void;
  onFileChange: (file: File | undefined) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <form className="wizard-panel wizard-upload" onSubmit={onSubmit}>
      <h3>导入 Excel 工资表</h3>
      <p>上传后只创建限时预览，不会生成工资条或发送通知。</p>
      <div className="form-grid">
        <Field label="发薪月份">
          <input
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
            pattern="\d{4}-\d{2}"
            required
          />
        </Field>
        <Field label="工资条标题">
          <input
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            required
          />
        </Field>
        <Field label="匹配企业人员">
          <select
            value={strategy}
            onChange={(event) =>
              onStrategyChange(event.target.value as EmployeeMatchStrategy)
            }
          >
            <option value="name">按姓名匹配</option>
            <option value="employeeNo">按工号匹配</option>
            <option value="userId">按钉钉用户 ID 匹配</option>
          </select>
        </Field>
        <Field label="工资表文件">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => onFileChange(event.target.files?.[0])}
            required
          />
        </Field>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="wizard-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          取消
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? "正在读取" : "下一步"}
        </button>
      </div>
    </form>
  );
}
