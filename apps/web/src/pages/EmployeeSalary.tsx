import { useEffect, useState } from "react";
import { api, ensureSession, type Batch, type Identity, type SalaryItem, type SalarySlipDisplaySettings } from "../api";
import { Icon } from "../icons";
import { formatSalaryValue } from "../format";

function EmployeeLoading() {
  return <div className="loading"><span className="spinner" />加载中</div>;
}
function EmployeeFullError({ message }: { message: string }) {
  return <div className="full-error"><Icon name="shield" size={24} /><strong>页面加载失败</strong><span>{message}</span></div>;
}
function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "unknown_error";
}
export function EmployeeHome({ employeeId }: { employeeId: string | undefined }) {
  const [identity, setIdentity] = useState<Identity>();
  const [slips, setSlips] = useState<Array<{ batch: Batch; item: SalaryItem }>>(
    [],
  );
  const [month, setMonth] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    ensureSession(employeeId)
      .then(setIdentity)
      .then(() =>
        api<Array<{ batch: Batch; item: SalaryItem }>>("/v1/me/salary-slips"),
      )
      .then((value) => {
        setSlips(value);
        setMonth(value[0]?.batch.payrollMonth);
      })
      .catch((reason) => setError(errorText(reason)));
  }, [employeeId]);
  if (error)
    return (
      <div className="employee-page">
        <EmployeeFullError message={error} />
      </div>
    );
  if (!identity || !month)
    return (
      <div className="employee-page">
        <EmployeeLoading />
      </div>
    );
  const monthSlips = slips.filter(
    (entry) => entry.batch.payrollMonth === month,
  );
  const total = monthSlips.reduce((sum, entry) => {
    const value = entry.item.fields[entry.batch.displaySettings.netAmountField];
    return sum + (typeof value === "number" ? value : 0);
  }, 0);
  const months = [...new Set(slips.map((entry) => entry.batch.payrollMonth))];
  return (
    <div className="employee-page employee-mobile-shell">
      <div className="employee-mobile-nav">
        <span>‹</span>
        <strong>我的</strong>
        <span>中文</span>
      </div>
      <main className="employee-home">
        <select
          className="employee-month-select"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        >
          {months.map((value) => (
            <option key={value} value={value}>
              {value.replace("-", ".")}
            </option>
          ))}
        </select>
        <section className="employee-total">
          <small>{identity.name}</small>
          <strong>{formatSalaryValue(total)}</strong>
          <span>实发金额总和</span>
        </section>
        <section className="employee-slip-list">
          {monthSlips.map(({ batch, item }) => {
            const net = item.fields[batch.displaySettings.netAmountField];
            return (
              <button
                className="employee-slip-card"
                type="button"
                key={batch.id}
                onClick={() =>
                  window.location.assign(`/employee/salary-slips/${batch.id}`)
                }
              >
                <span>
                  <b>{batch.title}</b>
                  <small>
                    明细 <i>›</i>
                  </small>
                </span>
                <strong>
                  {typeof net === "number" ? formatSalaryValue(net) : "--"}
                </strong>
                <em>{batch.displaySettings.netAmountField}</em>
              </button>
            );
          })}
        </section>
      </main>
      <nav className="employee-bottom-nav">
        <span>
          ▣<b>工资条</b>
        </span>
        <span>
          ◇<b>发现</b>
        </span>
        <span className="active">
          ♟<b>我的</b>
        </span>
      </nav>
    </div>
  );
}

export function EmployeePage({ employeeId }: { employeeId: string | undefined }) {
  const batchId = window.location.pathname.split("/").filter(Boolean).at(-1);
  const [identity, setIdentity] = useState<Identity>();
  const [payload, setPayload] = useState<{ batch: Batch; item: SalaryItem }>();
  const [error, setError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    ensureSession(employeeId)
      .then(setIdentity)
      .then(() =>
        batchId
          ? api<{ batch: Batch; item: SalaryItem }>(
              `/v1/me/salary-slips/${batchId}`,
            ).then(setPayload)
          : Promise.resolve(),
      )
      .catch((reason) => setError(errorText(reason)));
  }, [batchId, employeeId]);
  useEffect(() => {
    if (!payload || !batchId || payload.item.viewedAt) return;
    api(`/v1/me/salary-slips/${batchId}/view`, { method: "POST" })
      .then(() =>
        setPayload((value) =>
          value
            ? {
                ...value,
                item: { ...value.item, viewedAt: new Date().toISOString() },
              }
            : value,
        ),
      )
      .catch((reason) => setError(errorText(reason)));
  }, [batchId, payload]);
  async function confirm() {
    if (!batchId) return;
    try {
      await api(`/v1/me/salary-slips/${batchId}/view`, { method: "POST" });
      await api(`/v1/me/salary-slips/${batchId}/confirm`, { method: "POST" });
      setConfirmed(true);
      if (payload)
        setPayload({
          ...payload,
          item: {
            ...payload.item,
            confirmedAt: new Date().toISOString(),
            viewedAt: payload.item.viewedAt ?? new Date().toISOString(),
          },
        });
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  if (error)
    return (
      <div className="employee-page">
        <EmployeeFullError message={error} />
      </div>
    );
  if (!identity || !payload)
    return (
      <div className="employee-page">
        <EmployeeLoading />
      </div>
    );
  const allFields = Object.entries(payload.item.fields);
  const settings = payload.batch.displaySettings;
  const netValue = payload.item.fields[settings.netAmountField];
  const visible = settings.visibleFields.length
    ? settings.visibleFields
    : allFields.map(([key]) => key);
  const fields = allFields.filter(
    ([key, value]) =>
      key !== settings.netAmountField &&
      visible.includes(key) &&
      (!settings.hideEmptyFields ||
        (value !== null && value !== "" && value !== 0)),
  );
  const fieldByKey = new Map(fields);
  const groupedKeys = new Set(
    settings.fieldGroups.flatMap((group) => group.fieldKeys),
  );
  const renderField = ([key, value]: [string, string | number | null]) => (
    <div className="salary-field" key={key}>
      <span>{key}</span>
      <strong>{formatSalaryValue(value)}</strong>
    </div>
  );
  return (
    <div className="employee-page">
      <div className="employee-top">
        <span className="brand-mark">
          <Icon name="wallet" size={18} />
        </span>
        <div>
          <strong>工资条</strong>
          <small>仅本人可见</small>
        </div>
        <span className="employee-security">
          <Icon name="shield" size={15} />
          加密
        </span>
      </div>
      <main className="employee-sheet">
        <div className="employee-title">
          <span className="eyebrow">{payload.batch.payrollMonth}</span>
          <h1>{payload.batch.title}</h1>
          <p>
            {identity.name} ·{" "}
            {payload.item.employeeNo ?? payload.item.employeeUserId}
          </p>
        </div>
        <div className="net-card">
          <span>实发金额（元）</span>
          <strong>
            {typeof netValue === "number" ? formatSalaryValue(netValue) : "--"}
          </strong>
          <small>工资信息属于个人敏感数据，请妥善保管</small>
        </div>
        <div className="salary-fields">
          {settings.fieldGroups.map((group) => {
            const groupFields = group.fieldKeys.flatMap((key) => {
              const value = fieldByKey.get(key);
              return value === undefined
                ? []
                : [[key, value] as [string, string | number | null]];
            });
            return groupFields.length ? (
              <section className="salary-field-group" key={group.id}>
                <h2>{group.name}</h2>
                {groupFields.map(renderField)}
              </section>
            ) : null;
          })}
          {fields.filter(([key]) => !groupedKeys.has(key)).map(renderField)}
        </div>
        {settings.confirmationEnabled && (
          <button
            className={`employee-confirm ${confirmed || payload.item.confirmedAt ? "confirmed" : ""}`}
            onClick={confirm}
            disabled={Boolean(confirmed || payload.item.confirmedAt)}
          >
            <Icon name="check" size={19} />
            {confirmed || payload.item.confirmedAt ? "已确认查看" : "确认已查看"}
          </button>
        )}
        <p className="employee-footnote">
          本工资条通过企业内部工作通知送达，
          {settings.confirmationEnabled
            ? "查看和确认时间将生成存证记录。"
            : "查看时间将生成存证记录。"}
        </p>
      </main>
    </div>
  );
}

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
  const groupedKeys = new Set(
    settings.fieldGroups.flatMap((group) => group.fieldKeys),
  );
  const renderField = (field: string) => (
    <div className="salary-preview-field" key={field}>
      <span>{field}</span>
      <strong>
        {formatSalaryValue(sample[field] as string | number | null | undefined)}
      </strong>
    </div>
  );
  return (
    <aside
      className={`salary-slip-preview theme-${settings.theme}`}
      aria-label="工资条预览"
    >
      <strong>{title}</strong>
      <span>{settings.greeting.replace("{name}", "员工")}</span>
      <b>
        {formatSalaryValue(
          sample[settings.netAmountField] as string | number | null | undefined,
        )}
      </b>
      <small>{settings.netAmountField || "实发金额"}</small>
      <div className="salary-preview-scroll">
        {settings.notice && (
          <p>
            <strong>温馨提示</strong>
            {settings.notice}
          </p>
        )}
        {settings.fieldGroups.map((group) => {
          const groupFields = group.fieldKeys.filter((field) =>
            visibleFields.includes(field),
          );
          return groupFields.length ? (
            <section key={group.id}>
              <h4>{group.name}</h4>
              {groupFields.map(renderField)}
            </section>
          ) : null;
        })}
        {visibleFields
          .filter((field) => !groupedKeys.has(field))
          .map(renderField)}
      </div>
    </aside>
  );
}
