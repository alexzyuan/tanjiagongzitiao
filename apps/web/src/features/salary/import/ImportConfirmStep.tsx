import type { Dispatch, SetStateAction } from "react";
import type {
  SalaryImportPreview,
  SalarySlipDisplaySettings,
  SalarySlipTemplate,
} from "../../../api";
import { Field } from "../../../components/Field";
import { SalarySlipPreview } from "../SalarySlipPreview";
import { salaryMonthOptions } from "../../../utils/ui";

export function ImportConfirmStep({
  month,
  title,
  preview,
  settings,
  salaryFields,
  templates,
  busy,
  error,
  settingsMessage,
  setSettings,
  onMonthChange,
  onSaveTemplate,
  onBack,
  onComplete,
}: {
  month: string;
  title: string;
  preview: SalaryImportPreview;
  settings: SalarySlipDisplaySettings;
  salaryFields: string[];
  templates: SalarySlipTemplate[];
  busy: boolean;
  error: string | undefined;
  settingsMessage: string | undefined;
  setSettings: Dispatch<SetStateAction<SalarySlipDisplaySettings>>;
  onMonthChange: (value: string) => void;
  onSaveTemplate: () => void;
  onBack: () => void;
  onComplete: () => void;
}) {
  const months = salaryMonthOptions(month);
  return (
    <div className="wizard-panel import-settings-grid">
      <div>
        <h3>设置工资条</h3>
        <p>此配置随本次工资表保存，并用于员工在钉钉中查看的详情。</p>
        {settingsMessage && (
          <div className="notice success">{settingsMessage}</div>
        )}
        <div className="settings-form">
          <Field label="发薪月份">
            <select
              aria-label="发薪月份"
              value={month}
              onChange={(event) => onMonthChange(event.target.value)}
              required
            >
              {months.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="工资条标题">
            <input value={title} readOnly aria-readonly="true" />
          </Field>
          <Field label="保存的模板" wide>
            <div className="template-actions">
              <select
                defaultValue=""
                onChange={(event) => {
                  const template = templates.find(
                    (item) => item.id === event.target.value,
                  );
                  if (template) setSettings(template.settings);
                }}
              >
                <option value="">选择并应用模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={onSaveTemplate}
              >
                保存为模板
              </button>
            </div>
          </Field>
          <Field label="实发金额字段">
            <select
              value={settings.netAmountField}
              onChange={(event) =>
                setSettings((value) => ({
                  ...value,
                  netAmountField: event.target.value,
                }))
              }
            >
              <option value="">请选择</option>
              {salaryFields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
          </Field>
          <Field label="显示薪资项" wide>
            <div className="salary-field-picker">
              {salaryFields.map((field) => (
                <label key={field}>
                  <input
                    type="checkbox"
                    checked={settings.visibleFields.includes(field)}
                    onChange={(event) =>
                      setSettings((value) => ({
                        ...value,
                        visibleFields: event.target.checked
                          ? [...value.visibleFields, field]
                          : value.visibleFields.filter((item) => item !== field),
                      }))
                    }
                  />
                  {field}
                </label>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  const field = window.prompt("新增薪资项名称");
                  if (field?.trim())
                    setSettings((value) => ({
                      ...value,
                      visibleFields: [...value.visibleFields, field.trim()],
                    }));
                }}
              >
                ＋ 添加薪资项
              </button>
            </div>
          </Field>
          <Field label="分组模板" wide>
            <div className="salary-groups">
              {settings.fieldGroups.map((group) => (
                <div className="salary-group" key={group.id}>
                  <b>{group.name}</b>
                  <span>
                    {group.fieldKeys
                      .filter((field) => settings.visibleFields.includes(field))
                      .join("、") || "暂无字段"}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() =>
                      setSettings((value) => ({
                        ...value,
                        fieldGroups: value.fieldGroups.filter(
                          (item) => item.id !== group.id,
                        ),
                      }))
                    }
                  >
                    删除
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  const name = window.prompt("分组名称");
                  if (name?.trim())
                    setSettings((value) => ({
                      ...value,
                      fieldGroups: [
                        ...value.fieldGroups,
                        {
                          id: `group-${Date.now()}`,
                          name: name.trim(),
                          fieldKeys: value.visibleFields,
                        },
                      ],
                    }));
                }}
              >
                ＋ 新建分组
              </button>
            </div>
          </Field>
          <Field label="温馨提示">
            <textarea
              value={settings.notice}
              maxLength={500}
              onChange={(event) =>
                setSettings((value) => ({
                  ...value,
                  notice: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="员工关怀">
            <input
              value={settings.greeting}
              maxLength={200}
              onChange={(event) =>
                setSettings((value) => ({
                  ...value,
                  greeting: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="预览主题">
            <select
              value={settings.theme}
              onChange={(event) =>
                setSettings((value) => ({
                  ...value,
                  theme: event.target.value as SalarySlipDisplaySettings["theme"],
                }))
              }
            >
              <option value="default">默认背景</option>
              <option value="technology">科技创新</option>
              <option value="night">数智未来</option>
              <option value="gold">日进斗金</option>
              <option value="lotus">荷包满满</option>
            </select>
          </Field>
          <div className="toggle-row">
            <span>空值字段隐藏</span>
            <button
              type="button"
              className={`toggle ${settings.hideEmptyFields ? "on" : ""}`}
              onClick={() =>
                setSettings((value) => ({
                  ...value,
                  hideEmptyFields: !value.hideEmptyFields,
                }))
              }
            >
              <span />
            </button>
          </div>
          <div className="toggle-row">
            <span>确认无误</span>
            <button
              type="button"
              className={`toggle ${settings.confirmationEnabled ? "on" : ""}`}
              onClick={() =>
                setSettings((value) => ({
                  ...value,
                  confirmationEnabled: !value.confirmationEnabled,
                }))
              }
            >
              <span />
            </button>
          </div>
        </div>
      </div>
      <SalarySlipPreview
        title={title}
        settings={settings}
        fields={salaryFields}
        sample={
          preview.sourceRows.find((row) => row.kind === "employee")?.source ?? {}
        }
      />
      {error && <div className="notice error">{error}</div>}
      <div className="wizard-actions">
        <button className="button secondary" type="button" onClick={onBack}>
          上一步
        </button>
        <button
          className="button primary"
          type="button"
          disabled={busy || !settings.netAmountField}
          onClick={onComplete}
        >
          {busy ? "正在创建" : "完成并进入发送管理"}
        </button>
      </div>
    </div>
  );
}
