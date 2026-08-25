import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  api,
  type DirectoryUser,
  type EmployeeMatchStrategy,
  type SalaryImportPreview,
  type SalarySlipDisplaySettings,
  type SalarySlipTemplate,
} from "../../api";
import { Icon } from "../../icons";
import { currentMonth, defaultFieldGroups } from "../../utils/ui";
import { errorText } from "../../utils/errors";
import { ImportUploadStep } from "./import/ImportUploadStep";
import { ImportMatchStep } from "./import/ImportMatchStep";
import { ImportConfirmStep } from "./import/ImportConfirmStep";

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
    confirmationEnabled: true,
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
        <ImportUploadStep
          month={month}
          title={title}
          strategy={strategy}
          busy={busy}
          error={error}
          onMonthChange={setMonth}
          onTitleChange={setTitle}
          onStrategyChange={setStrategy}
          onFileChange={setFile}
          onSubmit={(event) => void previewWorkbook(event)}
          onClose={onClose}
        />
      )}
      {step === "preview" && preview && (
        <ImportMatchStep
          preview={preview}
          employeeFields={employeeFields}
          unresolved={unresolved}
          activeRow={activeRow}
          directoryQuery={directoryQuery}
          directoryResults={directoryResults}
          busy={busy}
          error={error}
          onBack={() => setStep("upload")}
          onNext={() => setStep("settings")}
          onOpenDirectory={(row) => {
            setActiveRow(row);
            setDirectoryResults([]);
          }}
          onDirectoryQueryChange={setDirectoryQuery}
          onSearchDirectory={() => void searchDirectory()}
          onSelectUser={selectUser}
        />
      )}
      {step === "settings" && preview && (
        <ImportConfirmStep
          title={title}
          preview={preview}
          settings={settings}
          salaryFields={salaryFields}
          templates={templates}
          busy={busy}
          error={error}
          settingsMessage={settingsMessage}
          setSettings={setSettings}
          onSaveTemplate={() => void saveTemplate()}
          onBack={() => setStep("preview")}
          onComplete={() => void complete()}
        />
      )}
    </section>
  );
}
