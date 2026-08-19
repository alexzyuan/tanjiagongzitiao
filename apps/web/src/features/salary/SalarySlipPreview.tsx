import type { SalarySlipDisplaySettings } from "../../api";
import { formatSalaryValue } from "../../format";

export function SalarySlipPreview({
  title,
  settings,
  fields,
  sample,
}: {
  title: string;
  settings: SalarySlipDisplaySettings;
  fields: string[];
  sample: Record<string, unknown>;
}) {
  const visibleFields = settings.visibleFields.length
    ? fields.filter((field) => settings.visibleFields.includes(field))
    : fields;
  const groupedKeys = new Set(settings.fieldGroups.flatMap((group) => group.fieldKeys));
  const renderField = (field: string) => (
    <div className="salary-preview-field" key={field}>
      <span>{field}</span>
      <strong>{formatSalaryValue(sample[field] as string | number | null | undefined)}</strong>
    </div>
  );
  return (
    <aside className={`salary-slip-preview theme-${settings.theme}`} aria-label="工资条预览">
      <strong>{title}</strong>
      <span>{settings.greeting.replace("{name}", "员工")}</span>
      <b>{formatSalaryValue(sample[settings.netAmountField] as string | number | null | undefined)}</b>
      <small>{settings.netAmountField || "实发金额"}</small>
      <div className="salary-preview-scroll">
        {settings.notice && <p><strong>温馨提示</strong>{settings.notice}</p>}
        {settings.fieldGroups.map((group) => {
          const groupFields = group.fieldKeys.filter((field) => visibleFields.includes(field));
          return groupFields.length ? <section key={group.id}><h4>{group.name}</h4>{groupFields.map(renderField)}</section> : null;
        })}
        {visibleFields.filter((field) => !groupedKeys.has(field)).map(renderField)}
      </div>
    </aside>
  );
}
