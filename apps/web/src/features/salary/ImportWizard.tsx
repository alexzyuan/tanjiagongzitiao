import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type DirectoryUser, type EmployeeMatchStrategy, type SalaryImportPreview, type SalarySlipDisplaySettings, type SalarySlipFieldGroup, type SalarySlipTemplate } from "../../api";
import { Icon } from "../../icons";
import { formatSalaryValue } from "../../format";
import { currentMonth, defaultFieldGroups, directoryLabel } from "../../utils/ui";
import { errorText } from "../../utils/errors";
import { Field } from "../../components/Field";
import { SalarySlipPreview } from "./SalarySlipPreview";

export function ImportWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (batchId: string) => Promise<void>;
}) {
  const [step, setStep] = useState<"upload" | "preview" | "settings">("upload");
  const [month, setMonth] = useState(currentMonth());
  const [title, setTitle] = useState(`${currentMonth()} 工资条`);
  const [file, setFile] = useState<File>();
  const [strategy, setStrategy] = useState<EmployeeMatchStrategy>("name");
  const [preview, setPreview] = useState<SalaryImportPreview>();
  const [resolutions, setResolutions] = useState<Record<number, DirectoryUser>>(
    {},
  );
  const [activeRow, setActiveRow] = useState<number>();
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryResults, setDirectoryResults] = useState<DirectoryUser[]>([]);
  const [settings, setSettings] = useState<SalarySlipDisplaySettings>({
    netAmountField: "",
    hideEmptyFields: true,
    confirmationEnabled: false,
    notice: "工资条属于敏感信息，请注意保密",
    greeting: "{name}，工作辛苦啦",
    theme: "default",
    visibleFields: [],
    fieldGroups: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [settingsMessage, setSettingsMessage] = useState<string>();
  const [templates, setTemplates] = useState<SalarySlipTemplate[]>([]);
  const unresolved =
    preview?.rows.filter(
      (row) => row.status !== "matched" && !resolutions[row.row],
    ) ?? [];
  const employeeFields = useMemo(
    () =>
      preview?.sourceRows.find((row) => row.kind === "employee")
        ? Object.keys(
            preview.sourceRows.find((row) => row.kind === "employee")!.source,
          )
        : [],
    [preview],
  );
  const salaryFields = useMemo(
    () =>
      employeeFields.filter(
        (field) =>
          !/(姓名|name|工号|employee.?no|user.?id|用户.?id|部门|职位)/i.test(
            field,
          ),
      ),
    [employeeFields],
  );
  useEffect(() => {
    if (step === "settings")
      api<SalarySlipTemplate[]>("/v1/salary-slip-templates")
        .then(setTemplates)
        .catch((reason) => setError(errorText(reason)));
  }, [step]);

  async function previewWorkbook(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("请选择 Excel 文件");
      return;
    }
    setBusy(true);
    setError(undefined);
    const form = new FormData();
    form.append("payrollMonth", month);
    form.append("title", title);
    form.append("matchStrategy", strategy);
    form.append("file", file);
    try {
      const value = await api<SalaryImportPreview>(
        "/v1/salary-batches/import/preview",
        { method: "POST", body: form },
      );
      const fields = Object.keys(
        value.sourceRows.find((row) => row.kind === "employee")?.source ?? {},
      ).filter(
        (field) =>
          !/(姓名|name|工号|employee.?no|user.?id|用户.?id|部门|职位)/i.test(
            field,
          ),
      );
      setPreview(value);
      setResolutions({});
      setSettings((current) => ({
        ...current,
        netAmountField:
          fields.find((field) => /实发/.test(field)) ?? current.netAmountField,
        visibleFields: fields,
        fieldGroups: defaultFieldGroups(fields),
      }));
      setStep("preview");
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function searchDirectory() {
    if (!preview || !activeRow || !directoryQuery.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      setDirectoryResults(
        await api<DirectoryUser[]>(
          `/v1/salary-batches/import/previews/${encodeURIComponent(preview.previewId)}/users?query=${encodeURIComponent(directoryQuery.trim())}`,
        ),
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!preview || !settings.netAmountField || unresolved.length) return;
    if (!settings.visibleFields.length) {
      setError("至少选择一个显示薪资项");
      return;
    }
    if (!settings.visibleFields.includes(settings.netAmountField)) {
      setError("实发金额字段必须包含在显示薪资项中");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<{ batchId: string }>(
        "/v1/salary-batches/import/commit",
        {
          method: "POST",
          body: JSON.stringify({
            previewId: preview.previewId,
            resolutions: Object.entries(resolutions).map(([row, user]) => ({
              row: Number(row),
              userId: user.userId,
            })),
            displaySettings: settings,
          }),
        },
      );
      await onCreated(result.batchId);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    const name = window.prompt("模板名称");
    if (!name?.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const template = await api<SalarySlipTemplate>(
        "/v1/salary-slip-templates",
        {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), settings }),
        },
      );
      setTemplates((current) => [template, ...current]);
      setSettingsMessage(`模板“${template.name}”已保存`);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  function selectUser(row: number, user: DirectoryUser) {
    setResolutions((value) => ({ ...value, [row]: user }));
    setActiveRow(undefined);
    setDirectoryQuery("");
    setDirectoryResults([]);
  }

  const steps = [
    { key: "upload", label: "上传Excel工资表" },
    { key: "preview", label: "预览表格数据" },
    { key: "settings", label: "设置工资条" },
  ] as const;
  return (
    <section className="import-wizard">
      <header className="import-wizard-header">
        <button className="back-button" onClick={onClose}>
          ‹ <span>返回</span>
        </button>
        <h2>上传工资表</h2>
        <span className="security-badge">
          <Icon name="shield" size={14} />
          敏感数据加密
        </span>
      </header>
      <div className="wizard-stepper">
        {steps.map((item, index) => (
          <div
            className={`wizard-step ${step === item.key ? "active" : ""} ${steps.findIndex((value) => value.key === step) > index ? "done" : ""}`}
            key={item.key}
          >
            <span>
              {steps.findIndex((value) => value.key === step) > index
                ? "✓"
                : index + 1}
            </span>
            <strong>{item.label}</strong>
          </div>
        ))}
      </div>
      {step === "upload" && (
        <form className="wizard-panel wizard-upload" onSubmit={previewWorkbook}>
          <h3>导入 Excel 工资表</h3>
          <p>上传后只创建限时预览，不会生成工资条或发送通知。</p>
          <div className="form-grid">
            <Field label="发薪月份">
              <input
                value={month}
                onChange={(event) => setMonth(event.target.value)}
                pattern="\d{4}-\d{2}"
                required
              />
            </Field>
            <Field label="工资条标题">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </Field>
            <Field label="匹配企业人员">
              <select
                value={strategy}
                onChange={(event) =>
                  setStrategy(event.target.value as EmployeeMatchStrategy)
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
                onChange={(event) => setFile(event.target.files?.[0])}
                required
              />
            </Field>
          </div>
          {error && <div className="notice error">{error}</div>}
          <div className="wizard-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              取消
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? "正在读取" : "下一步"}
            </button>
          </div>
        </form>
      )}
      {step === "preview" && preview && (
        <div className="wizard-panel">
          <div className="wizard-panel-title">
            <div>
              <h3>预览表格数据</h3>
              <p>汇总行不会导入；异常人员需匹配到企业通讯录后才能进入设置。</p>
            </div>
            <span className="preview-count">
              已匹配 {preview.matched} · 待处理 {unresolved.length}
            </span>
          </div>
          <div className="source-preview-scroll">
            <table className="source-preview-table">
              <thead>
                <tr>
                  <th>行</th>
                  <th>状态</th>
                  {employeeFields.map((field) => (
                    <th key={field}>{field}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sourceRows.map((row) => (
                  <tr
                    className={row.kind === "summary" ? "ignored-summary" : ""}
                    key={row.row}
                  >
                    <td>{row.row}</td>
                    <td>
                      {row.kind === "summary"
                        ? "汇总行，不导入"
                        : preview.rows.find((item) => item.row === row.row)
                              ?.status === "matched"
                          ? "已匹配"
                          : "待处理"}
                    </td>
                    {employeeFields.map((field) => (
                      <td key={field}>
                        {formatSalaryValue(
                          row.source[field] as
                            string | number | null | undefined,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unresolved.length > 0 && (
            <div className="import-match-list">
              {unresolved.map((row) => (
                <div className="import-match-row" key={row.row}>
                  <div>
                    <strong>第 {row.row} 行</strong>
                    <span>{row.value ?? "未提供匹配字段"}</span>
                  </div>
                  {row.candidates.length ? (
                    <div className="match-actions">
                      {row.candidates.map((user) => (
                        <button
                          className="text-button"
                          type="button"
                          key={user.userId}
                          onClick={() => selectUser(row.row, user)}
                        >
                          {directoryLabel(user)}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => {
                        setActiveRow(row.row);
                        setDirectoryResults([]);
                      }}
                    >
                      选择人员
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {activeRow && (
            <div className="directory-search">
              <strong>为第 {activeRow} 行选择企业人员</strong>
              <div>
                <input
                  autoFocus
                  value={directoryQuery}
                  onChange={(event) => setDirectoryQuery(event.target.value)}
                  placeholder="姓名、工号或钉钉用户 ID"
                />
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy || !directoryQuery.trim()}
                  onClick={() => void searchDirectory()}
                >
                  搜索
                </button>
              </div>
              {directoryResults.map((user) => (
                <button
                  className="directory-result"
                  type="button"
                  key={user.userId}
                  onClick={() => selectUser(activeRow, user)}
                >
                  {directoryLabel(user)}
                </button>
              ))}
            </div>
          )}
          {error && <div className="notice error">{error}</div>}
          <div className="wizard-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => setStep("upload")}
            >
              重新上传
            </button>
            <button
              className="button primary"
              type="button"
              disabled={unresolved.length > 0}
              onClick={() => setStep("settings")}
            >
              下一步
            </button>
          </div>
        </div>
      )}
      {step === "settings" && preview && (
        <div className="wizard-panel import-settings-grid">
          <div>
            <h3>设置工资条</h3>
            <p>此配置随本次工资表保存，并用于员工在钉钉中查看的详情。</p>
            {settingsMessage && (
              <div className="notice success">{settingsMessage}</div>
            )}
            <div className="settings-form">
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
                    onClick={() => void saveTemplate()}
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
                              : value.visibleFields.filter(
                                  (item) => item !== field,
                                ),
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
                          .filter((field) =>
                            settings.visibleFields.includes(field),
                          )
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
                      theme: event.target
                        .value as SalarySlipDisplaySettings["theme"],
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
              preview.sourceRows.find((row) => row.kind === "employee")
                ?.source ?? {}
            }
          />
          {error && <div className="notice error">{error}</div>}
          <div className="wizard-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => setStep("preview")}
            >
              上一步
            </button>
            <button
              className="button primary"
              type="button"
              disabled={busy || !settings.netAmountField}
              onClick={() => void complete()}
            >
              {busy ? "正在创建" : "完成并进入发送管理"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
