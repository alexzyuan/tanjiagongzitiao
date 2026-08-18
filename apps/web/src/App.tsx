import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  api,
  ensureSession,
  type Batch,
  type DirectoryUser,
  type EmployeeMatchStrategy,
  type Identity,
  type ReportSummary,
  type SalaryImportPreview,
  type SalaryItem,
  type SalarySlipDisplaySettings,
  type SalarySlipFieldGroup,
  type SalarySlipTemplate,
  type Settings,
} from "./api";
import { Icon } from "./icons";

type Module = "salary" | "evidence" | "reports" | "permissions" | "settings";

const nav: Array<{
  key: Module;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
}> = [
  { key: "salary", label: "工资条管理", icon: "wallet" },
  { key: "evidence", label: "发薪存证", icon: "receipt" },
  { key: "reports", label: "报表中心", icon: "chart" },
  { key: "permissions", label: "权限管理", icon: "lock" },
  { key: "settings", label: "系统设置", icon: "settings" },
];

const stateLabel: Record<string, string> = {
  draft: "未发送",
  scheduled: "已排期",
  sending: "发送中",
  sent: "已发送",
  partially_failed: "部分失败",
  withdrawn: "已撤回",
  archived: "已归档",
  viewed: "已查看",
  unread: "未查看",
  confirmed: "已确认",
  unconfirmed: "未确认",
  在职: "在职",
};

export function App() {
  const impersonatedId =
    new URLSearchParams(window.location.search).get("as") ?? undefined;
  if (window.location.pathname === "/employee/salary-slips")
    return (
      <EmployeeViewport>
        <EmployeeHome employeeId={impersonatedId} />
      </EmployeeViewport>
    );
  if (window.location.pathname.startsWith("/employee/"))
    return (
      <EmployeeViewport>
        <EmployeePage employeeId={impersonatedId} />
      </EmployeeViewport>
    );
  return <AdminApp impersonatedId={impersonatedId} />;
}

function EmployeeViewport({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 700);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 700);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  if (!isMobile)
    return (
      <main className="employee-desktop-notice">请在手机钉钉中查看工资条</main>
    );
  return <>{children}</>;
}

function AdminApp({ impersonatedId }: { impersonatedId: string | undefined }) {
  const [identity, setIdentity] = useState<Identity>();
  const [module, setModule] = useState<Module>("salary");
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    ensureSession(impersonatedId)
      .then(setIdentity)
      .catch((reason) => setError(errorText(reason)));
  }, [impersonatedId]);
  useEffect(() => {
    const openPermissions = () => setModule("permissions");
    const openSettings = () => setModule("settings");
    window.addEventListener("salary-open-permissions", openPermissions);
    window.addEventListener("salary-open-settings", openSettings);
    return () => {
      window.removeEventListener("salary-open-permissions", openPermissions);
      window.removeEventListener("salary-open-settings", openSettings);
    };
  }, []);

  if (error) return <FullError message={error} />;
  if (!identity) return <Loading />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="wallet" size={19} />
          </span>
          <span>薪资中心</span>
        </div>
        <div className="sidebar-caption">企业内部应用</div>
        <nav className="nav-list" aria-label="功能导航">
          {nav.map((item) => (
            <button
              className={`nav-item ${module === item.key ? "active" : ""}`}
              key={item.key}
              onClick={() => setModule(item.key)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="security-dot">
            <Icon name="shield" size={15} />
          </span>
          <span>敏感数据加密存储</span>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">企业薪资服务</div>
            <h1>{nav.find((item) => item.key === module)?.label}</h1>
          </div>
          <div className="identity">
            <span className="avatar">{identity.name.slice(0, 1)}</span>
            <span>{identity.name}</span>
            <span className="role">主管理员</span>
          </div>
        </header>
        <div className="page-wrap">
          {module === "salary" && (
            <SalaryManagement
              onChanged={() => setRefreshKey((value) => value + 1)}
              refreshKey={refreshKey}
            />
          )}
          {module === "evidence" && <EvidenceCenter refreshKey={refreshKey} />}
          {module === "reports" && <ReportCenter refreshKey={refreshKey} />}
          {module === "permissions" && (
            <PermissionCenter
              refreshKey={refreshKey}
              onChanged={() => setRefreshKey((value) => value + 1)}
            />
          )}
          {module === "settings" && <SettingsCenter />}
        </div>
      </main>
    </div>
  );
}

export function SalaryManagement({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [month, setMonth] = useState(currentMonth());
  const [monthOpen, setMonthOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "unread" | "unconfirmed" | "failed"
  >("all");
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const [detailBatchId, setDetailBatchId] = useState<string>();
  const [detail, setDetail] = useState<Batch>();
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mode, setMode] = useState<"manual" | "import">();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
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
  const loadDetail = useCallback(async (batchId: string) => {
    const next = await api<Batch>(`/v1/salary-batches/${batchId}`);
    setDetail(next);
  }, []);
  useEffect(() => {
    setActiveBatchId((current) =>
      monthBatches.some((batch) => batch.id === current)
        ? current
        : monthBatches[0]?.id,
    );
    setSelectedItems([]);
  }, [monthBatches]);
  useEffect(() => {
    if (!activeBatch) {
      setDetail(undefined);
      return;
    }
    loadDetail(activeBatch.id)
      .catch((reason) => setError(errorText(reason)));
  }, [activeBatch?.id, loadDetail]);
  const employees = useMemo(() => {
    const items = detail?.items ?? [];
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        !needle ||
        [item.employeeName, item.employeeNo, item.department, item.position]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(needle));
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "unread" && !item.viewedAt) ||
        (statusFilter === "unconfirmed" && !item.confirmedAt) ||
        (statusFilter === "failed" &&
          activeBatch?.state === "partially_failed");
      return matchesQuery && matchesStatus;
    });
  }, [activeBatch?.state, detail?.items, query, statusFilter]);
  const unread = (detail?.items ?? []).filter((item) => !item.viewedAt).length;
  const unconfirmed = (detail?.items ?? []).filter(
    (item) => !item.confirmedAt,
  ).length;

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

  function shiftMonth(delta: number) {
    const [yearText = "0", valueText = "1"] = month.split("-");
    const year = Number(yearText);
    const value = Number(valueText);
    const next = new Date(year, value - 1 + delta, 1);
    setMonth(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`,
    );
    setMonthOpen(false);
  }

  function printEvidence() {
    setMoreOpen(false);
    window.print();
  }

  return (
    <section className="salary-workspace">
      <div className="salary-heading">
        <button className="back-button" onClick={() => window.history.back()}>
          ‹ <span>返回</span>
        </button>
        <h2>
          {month.replace("-", "年")}月工资条{" "}
          <small>{month.replace("-", "/")}</small>
        </h2>
        <span className="security-badge">
          <Icon name="shield" size={14} />
          敏感数据加密
        </span>
      </div>
      <div className="salary-alert">
        <span>📣</span>
        <strong>
          导入数据异常：{activeBatch?.state === "partially_failed" ? 1 : 0}
        </strong>
        <button
          className="link-button"
          onClick={() => setStatusFilter("failed")}
        >
          前往处理 ›
        </button>
        <span className="alert-divider" />
        <span>
          未查看：<strong>{unread}</strong>
        </span>
        <button
          className="link-button"
          onClick={() => setStatusFilter("unread")}
        >
          查看未读员工
        </button>
        <span>
          未确认：<strong>{unconfirmed}</strong>
        </span>
        <button
          className="link-button"
          onClick={() => setStatusFilter("unconfirmed")}
        >
          查看未确认员工
        </button>
        <div className="manager-card">
          <span className="avatar blue">管</span>
          <span>
            管理员：<strong>企业管理员</strong>
          </span>
          <button
            className="icon-button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("salary-open-permissions"))
            }
          >
            ›
          </button>
        </div>
      </div>
      <div className="salary-controls">
        <button className="button primary" onClick={() => setMode("import")}>
          <Icon name="plus" size={17} />
          上传工资表
        </button>
        <button className="self-send-tip" onClick={() => setMode("manual")}>
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
                        setMonth(candidate);
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
      <div className="salary-overview">
        <div className="overview-title">
          <strong>
            {activeBatch?.title ?? `${month.replace("-", "年")}月工资条`}
          </strong>
          <span>
            {activeBatch ? <Status state={activeBatch.state} /> : "暂无工资表"}
          </span>
        </div>
        <div className="overview-stat">
          <span>已发送</span>
          <strong>
            {activeBatch?.sent ?? 0}/{activeBatch?.total ?? 0}
          </strong>
        </div>
        <div className="overview-stat">
          <span>已查看</span>
          <strong>{activeBatch?.viewed ?? 0}</strong>
        </div>
        <div className="overview-stat">
          <span>已确认</span>
          <strong>{activeBatch?.confirmed ?? 0}</strong>
        </div>
        <div className="overview-actions">
          <button
            className="text-button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("salary-open-settings"))
            }
          >
            设置
          </button>
          <button className="text-button muted" disabled>
            删除
          </button>
          <button
            className="button secondary"
            onClick={() => activeBatch && setDetailBatchId(activeBatch.id)}
          >
            查看发送
          </button>
        </div>
      </div>
      <div className="employee-table-card">
        <div className="employee-toolbar">
          <label className="search">
            <Icon name="search" size={17} />
            <input
              value={query}
              placeholder="搜索姓名/工号/职位"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value as typeof statusFilter)
            }
          >
            <option value="all">筛选</option>
            <option value="unread">未查看</option>
            <option value="unconfirmed">未确认</option>
            <option value="failed">发送失败</option>
          </select>
          <div className="more-wrap">
            <button
              className="button secondary"
              onClick={() => setMoreOpen((value) => !value)}
            >
              更多⌄
            </button>
            {moreOpen && (
              <div className="more-menu">
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    window.dispatchEvent(
                      new CustomEvent("salary-open-settings"),
                    );
                  }}
                >
                  设置工资条
                </button>
                <button
                  disabled={!activeBatch || activeBatch.state === "withdrawn"}
                  onClick={() => void sendActive("withdraw")}
                >
                  全部撤回
                </button>
                <a
                  href={
                    activeBatch
                      ? `/v1/reports/summary.csv?payrollMonth=${activeBatch.payrollMonth}`
                      : "/v1/reports/summary.csv"
                  }
                  onClick={() => setMoreOpen(false)}
                >
                  导出 Excel 明细
                </a>
                <button onClick={printEvidence}>导出 PDF 存证</button>
              </div>
            )}
          </div>
          <button className="button secondary" disabled>
            定时发送
          </button>
          <button
            className="button primary"
            disabled={!activeBatch || busy}
            onClick={() =>
              void sendActive(
                activeBatch?.state === "draft" ? "send" : "resend",
              )
            }
          >
            <Icon name="send" size={15} />
            全部发送
          </button>
        </div>
        <div className="table-scroll salary-employee-scroll">
          <table className="salary-employee-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="全选员工"
                    checked={Boolean(
                      employees.length &&
                      selectedItems.length === employees.length,
                    )}
                    onChange={(event) =>
                      setSelectedItems(
                        event.target.checked
                          ? employees.map((item) => item.id)
                          : [],
                      )
                    }
                  />
                </th>
                <th>姓名</th>
                <th>员工状态</th>
                <th>实发工资</th>
                <th>发送状态</th>
                <th>查看状态</th>
                <th>确认状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((item) => {
                const net = activeBatch
                  ? item.fields[activeBatch.displaySettings.netAmountField]
                  : undefined;
                return (
                  <tr key={item.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择${item.employeeName}`}
                        checked={selectedItems.includes(item.id)}
                        onChange={(event) =>
                          setSelectedItems((value) =>
                            event.target.checked
                              ? [...value, item.id]
                              : value.filter((id) => id !== item.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="employee-cell">
                        <span className="avatar blue">
                          {item.employeeName.slice(0, 1)}
                        </span>
                        <span>
                          <strong>{item.employeeName}</strong>
                          <small>
                            {item.department ??
                              item.position ??
                              item.employeeNo ??
                              "员工"}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>
                      <Status state="在职" />
                    </td>
                    <td className="money-cell">
                      {typeof net === "number"
                        ? formatSalaryValue(net)
                        : "已加密"}
                    </td>
                    <td>
                      <Status
                        state={
                          item.deliveryStatus === "delivered"
                            ? "sent"
                            : item.deliveryStatus === "failed"
                              ? "failed"
                              : item.deliveryStatus === "withdrawn"
                                ? "withdrawn"
                                : "draft"
                        }
                      />
                    </td>
                    <td>
                      <Status state={item.viewedAt ? "viewed" : "unread"} />
                    </td>
                    <td>
                      <Status
                        state={item.confirmedAt ? "confirmed" : "unconfirmed"}
                      />
                    </td>
                    <td>
                      {item.deliveryStatus === "delivered" ? (
                        <button
                          className="text-button danger"
                          disabled={!activeBatch || busy}
                          onClick={() =>
                            activeBatch &&
                            void withdrawIndividual(activeBatch, item)
                          }
                        >
                          撤回
                        </button>
                      ) : (
                        <button
                          className="text-button"
                          disabled={!activeBatch || busy}
                          onClick={() =>
                            activeBatch && void sendIndividual(activeBatch, item)
                          }
                        >
                          单独发送
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!employees.length && (
            <EmptyState
              label={
                activeBatch ? "当前筛选条件下暂无员工" : "当前月份暂无工资表"
              }
            />
          )}
        </div>
      </div>
      {detailBatch && (
        <BatchDetail
          batch={detailBatch}
          onClose={() => setDetailBatchId(undefined)}
        />
      )}
      {mode === "manual" && (
        <ManualPanel
          onClose={() => setMode(undefined)}
          onCreated={() => {
            setMode(undefined);
            load();
            onChanged();
          }}
        />
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

function BatchDetail({
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

function ManualPanel({
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

function ImportPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const unresolved =
    preview?.rows.filter(
      (row) => row.status !== "matched" && !resolutions[row.row],
    ) ?? [];
  async function submit(event: FormEvent) {
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
      setPreview(
        await api<SalaryImportPreview>("/v1/salary-batches/import/preview", {
          method: "POST",
          body: form,
        }),
      );
      setResolutions({});
      setActiveRow(undefined);
      setDirectoryResults([]);
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
  async function commit() {
    if (!preview || unresolved.length) return;
    setBusy(true);
    setError(undefined);
    try {
      await api<{ batchId: string }>("/v1/salary-batches/import/commit", {
        method: "POST",
        body: JSON.stringify({
          previewId: preview.previewId,
          resolutions: Object.entries(resolutions).map(([row, user]) => ({
            row: Number(row),
            userId: user.userId,
          })),
        }),
      });
      onCreated();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  function selectUser(row: number, user: DirectoryUser) {
    setResolutions((value) => ({ ...value, [row]: user }));
    setActiveRow(undefined);
    setDirectoryResults([]);
    setDirectoryQuery("");
  }
  if (preview)
    return (
      <Modal title="核对企业通讯录匹配" onClose={onClose}>
        <div className="import-preview">
          <div className="import-summary">
            <span>
              已匹配 <strong>{preview.matched}</strong>
            </span>
            <span>
              待处理 <strong>{preview.unmatched + preview.ambiguous}</strong>
            </span>
            {preview.ignoredSummaryRows > 0 && (
              <span>
                已忽略汇总行 <strong>{preview.ignoredSummaryRows}</strong>
              </span>
            )}
            <small>
              预览在{" "}
              {new Date(preview.expiresAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              失效，确认后才会创建工资表。
            </small>
          </div>
          <div className="import-match-list">
            {preview.rows.map((row) => {
              const resolution = resolutions[row.row];
              return (
                <div className={`import-match-row ${row.status}`} key={row.row}>
                  <div>
                    <strong>第 {row.row} 行</strong>
                    <span>{row.value || "未提供匹配字段"}</span>
                  </div>
                  {row.status === "matched" && row.user ? (
                    <span className="match-success">
                      已匹配：{directoryLabel(row.user)}
                    </span>
                  ) : resolution ? (
                    <span className="match-success">
                      已选择：{directoryLabel(resolution)}
                    </span>
                  ) : (
                    <div className="match-actions">
                      {row.candidates.map((user) => (
                        <button
                          type="button"
                          className="text-button"
                          key={user.userId}
                          onClick={() => selectUser(row.row, user)}
                        >
                          {directoryLabel(user)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          setActiveRow(row.row);
                          setDirectoryResults([]);
                        }}
                      >
                        选择人员
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
                  type="button"
                  className="directory-result"
                  key={user.userId}
                  onClick={() => selectUser(activeRow, user)}
                >
                  {directoryLabel(user)}
                </button>
              ))}
            </div>
          )}
          {error && <div className="notice error">{error}</div>}
          <div className="form-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setPreview(undefined);
                setError(undefined);
              }}
            >
              重新上传
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy || unresolved.length > 0}
              onClick={() => void commit()}
            >
              <Icon name="check" size={16} />
              创建工资条
            </button>
          </div>
        </div>
      </Modal>
    );
  return (
    <Modal title="导入 Excel 工资表" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
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
        <Field label="匹配企业人员" wide>
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
          <small className="field-help">
            姓名同名时必须人工选择；使用工号或钉钉用户 ID 可避免重名。
          </small>
        </Field>
        <Field label="工资表文件" wide>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(event) => setFile(event.target.files?.[0])}
            required
          />
          <small className="field-help">
            首行需包含所选匹配字段和至少一个薪资字段。导入前会读取企业通讯录并核对人员。
          </small>
        </Field>
        {error && <div className="notice error span-2">{error}</div>}
        <FormActions
          onClose={onClose}
          submitLabel={busy ? "正在核对通讯录" : "导入并核对"}
        />
      </form>
    </Modal>
  );
}

function ImportWizard({
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
    feedbackEnabled: true,
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
                <span>员工反馈</span>
                <button
                  type="button"
                  className={`toggle ${settings.feedbackEnabled ? "on" : ""}`}
                  onClick={() =>
                    setSettings((value) => ({
                      ...value,
                      feedbackEnabled: !value.feedbackEnabled,
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

function directoryLabel(user: DirectoryUser) {
  return [
    user.name,
    user.employeeNo ? `工号 ${user.employeeNo}` : undefined,
    user.userId,
  ]
    .filter(Boolean)
    .join(" · ");
}

function EvidenceCenter({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<
    Array<{
      id: string;
      batchId: string;
      employeeUserId: string;
      eventType: string;
      fingerprint: string;
      createdAt: string;
    }>
  >([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<typeof events>("/v1/payment-evidence")
      .then(setEvents)
      .catch((reason) => setError(errorText(reason)));
  }, [refreshKey]);
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <h2>发薪存证</h2>
          <p>记录通知、查看和确认链路，保留可审计的时间戳与指纹。</p>
        </div>
        <span className="security-badge">
          <Icon name="shield" size={16} />
          加密归档
        </span>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="metric-strip">
        <Metric label="存证事件" value={events.length} />
        <Metric
          label="已通知"
          value={
            events.filter((event) => event.eventType === "notification_sent")
              .length
          }
        />
        <Metric
          label="已查看"
          value={events.filter((event) => event.eventType === "viewed").length}
        />
        <Metric
          label="已确认"
          value={
            events.filter((event) => event.eventType === "confirmed").length
          }
        />
      </div>
      <div className="table-card">
        <div className="table-toolbar">
          <div className="table-title">存证流水</div>
          <span className="toolbar-note">敏感工资字段不出现在存证流水中</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>工资表</th>
                <th>员工标识</th>
                <th>事件</th>
                <th>指纹</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{formatDate(event.createdAt)}</td>
                  <td className="mono">{event.batchId}</td>
                  <td>{event.employeeUserId}</td>
                  <td>
                    <Status state={event.eventType} />
                  </td>
                  <td className="mono">{event.fingerprint.slice(0, 18)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && <EmptyState label="暂无存证事件" />}
        </div>
      </div>
    </section>
  );
}

function ReportCenter({ refreshKey }: { refreshKey: number }) {
  const [report, setReport] = useState<ReportSummary>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api<ReportSummary>("/v1/reports/summary")
      .then(setReport)
      .catch((reason) => setError(errorText(reason)));
  }, [refreshKey]);
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <h2>报表中心</h2>
          <p>按批次查看发送覆盖、员工查看和确认进度。</p>
        </div>
        <a className="button secondary" href="/v1/reports/summary.csv">
          <Icon name="download" size={17} />
          导出 CSV
        </a>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="metric-strip report-metrics">
        <Metric label="工资批次" value={report?.totals.batches ?? 0} />
        <Metric label="工资条" value={report?.totals.recipients ?? 0} />
        <Metric label="已发送" value={report?.totals.sent ?? 0} />
        <Metric label="已查看" value={report?.totals.viewed ?? 0} />
        <Metric label="已确认" value={report?.totals.confirmed ?? 0} />
        <Metric
          label="发送失败"
          value={report?.totals.failedDeliveries ?? 0}
          {...(report?.totals.failedDeliveries
            ? { tone: "warning" as const }
            : {})}
        />
      </div>
      <div className="report-summary-line">
        <span>
          应发合计{" "}
          <strong>
            ¥ {formatMoney(report?.totals.salaryTotals.gross ?? 0)}
          </strong>
        </span>
        <span>
          实发合计{" "}
          <strong>¥ {formatMoney(report?.totals.salaryTotals.net ?? 0)}</strong>
        </span>
        <span>
          个税合计{" "}
          <strong>¥ {formatMoney(report?.totals.salaryTotals.tax ?? 0)}</strong>
        </span>
        <span>
          社保扣款{" "}
          <strong>
            ¥ {formatMoney(report?.totals.salaryTotals.socialInsurance ?? 0)}
          </strong>
        </span>
      </div>
      <div className="table-card">
        <div className="table-toolbar">
          <div className="table-title">批次明细</div>
          <span className="toolbar-note">统计范围：当前可管理工资表</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>月份</th>
                <th>标题</th>
                <th>状态</th>
                <th>人数</th>
                <th>已发送</th>
                <th>已查看</th>
                <th>已确认</th>
                <th>失败</th>
              </tr>
            </thead>
            <tbody>
              {report?.batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="strong">{batch.payrollMonth}</td>
                  <td>{batch.title}</td>
                  <td>
                    <Status state={batch.state} />
                  </td>
                  <td>{batch.total}</td>
                  <td>{batch.sent}</td>
                  <td>{batch.viewed}</td>
                  <td>{batch.confirmed}</td>
                  <td>{batch.deliveryFailures || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!report?.batches.length && <EmptyState label="暂无报表数据" />}
        </div>
      </div>
    </section>
  );
}

function PermissionCenter({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [subAdmins, setSubAdmins] = useState<string[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [userId, setUserId] = useState("");
  const [subAdminPickerOpen, setSubAdminPickerOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    Promise.all([
      api<Batch[]>("/v1/salary-batches"),
      api<string[]>("/v1/sub-admins"),
      api<DirectoryUser[]>("/v1/directory/users"),
    ])
      .then(([value, roles, users]) => {
        setBatches(value);
        setSelectedId(value[0]?.id ?? "");
        setSubAdmins(roles);
        setDirectory(users);
      })
      .catch((reason) => setError(errorText(reason)));
  }, [refreshKey]);
  const selected = batches.find((batch) => batch.id === selectedId);
  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!selected || !userId.trim()) return;
    try {
      await api(`/v1/salary-batches/${selected.id}/admins`, {
        method: "POST",
        body: JSON.stringify({ userId: userId.trim() }),
      });
      setMessage(`已将 ${userId.trim()} 添加为工资表管理员`);
      setUserId("");
      const value = await api<Batch[]>("/v1/salary-batches");
      setBatches(value);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  async function removeBatchAdmin(id: string) {
    if (!selected) return;
    try {
      const updated = await api<Batch>(
        `/v1/salary-batches/${selected.id}/admins/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      setBatches((value) =>
        value.map((batch) => (batch.id === updated.id ? updated : batch)),
      );
      setMessage(`已移除工资表管理员 ${id}`);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  const directoryById = new Map(
    directory.map((entry) => [entry.userId, entry]),
  );
  async function assignSubAdmin(user: DirectoryUser) {
    try {
      const roles = await api<string[]>("/v1/sub-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.userId }),
      });
      setSubAdmins(roles);
      setMessage(`已将 ${user.name} 添加为子管理员`);
      setSubAdminPickerOpen(false);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  async function removeSubAdmin(id: string) {
    try {
      setSubAdmins(
        await api<string[]>(`/v1/sub-admins/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      );
      setMessage(`已移除子管理员 ${id}`);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <h2>权限管理</h2>
          <p>主管理员默认由企业管理员担任，其他人员按工资表手动授权。</p>
        </div>
      </div>
      {message && (
        <div className="notice success">
          <Icon name="check" size={17} />
          {message}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <div className="permission-grid">
        <div className="permission-card">
          <div className="card-kicker">主管理员</div>
          <div className="admin-profile">
            <span className="avatar blue">管</span>
            <div>
              <strong>企业管理员</strong>
              <small>全部工资表 · 全部历史 · 系统设置</small>
            </div>
            <span className="tag blue-tag">默认</span>
          </div>
          <div className="sub-admin-block">
            <div className="card-kicker">子管理员</div>
            <div className="assign-row">
              <button
                className="directory-picker-trigger"
                type="button"
                onClick={() => setSubAdminPickerOpen(true)}
              >
                <Icon name="users" size={18} />
                从企业通讯录选择人员
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setSubAdminPickerOpen(true)}
              >
                <Icon name="plus" size={16} />
                添加
              </button>
            </div>
            {subAdmins.length ? (
              <div className="chips">
                {subAdmins.map((id) => (
                  <span className="person-chip" key={id}>
                    <span className="dot" />
                    {directoryById.get(id)?.name ?? id}
                    <button
                      type="button"
                      className="chip-remove"
                      onClick={() => removeSubAdmin(id)}
                      aria-label={`移除 ${id}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState label="暂无子管理员" compact />
            )}
          </div>
        </div>
        <div className="permission-card">
          <div className="card-kicker">工资表管理员</div>
          <label className="field-label">
            选择工资表
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">请选择</option>
              {batches.map((batch) => (
                <option value={batch.id} key={batch.id}>
                  {batch.title}
                </option>
              ))}
            </select>
          </label>
          <form className="assign-row" onSubmit={assign}>
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="输入钉钉用户 ID"
            />
            <button className="button primary" type="submit">
              <Icon name="plus" size={16} />
              添加
            </button>
          </form>
          {selected?.assignedAdminIds.length ? (
            <div className="chips">
              {selected.assignedAdminIds.map((id) => (
                <span className="person-chip" key={id}>
                  <span className="dot" />
                  {id}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeBatchAdmin(id)}
                    aria-label={`移除 ${id}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <EmptyState label="该工资表暂未添加管理员" compact />
          )}
        </div>
      </div>
      <div className="info-banner">
        <Icon name="lock" size={18} />
        <div>
          <strong>权限边界</strong>
          <span>
            子管理员仅可发放和管理被添加的工资表；加密归档仅企业管理员可访问。
          </span>
        </div>
      </div>
      {subAdminPickerOpen && (
        <DirectoryPicker
          excludedUserIds={subAdmins}
          onClose={() => setSubAdminPickerOpen(false)}
          onPick={(person) => void assignSubAdmin(person)}
        />
      )}
    </section>
  );
}

function DirectoryPicker({
  excludedUserIds,
  onClose,
  onPick,
}: {
  excludedUserIds: string[];
  onClose: () => void;
  onPick: (user: DirectoryUser) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<DirectoryUser>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const search = useCallback(async (value: string) => {
    setLoading(true);
    setError(undefined);
    try {
      setResults(
        await api<DirectoryUser[]>(
          `/v1/directory/users?query=${encodeURIComponent(value)}`,
        ),
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void search("");
  }, [search]);
  const people = results.filter(
    (person) => !excludedUserIds.includes(person.userId),
  );
  return (
    <Modal title="请选择人员" onClose={onClose} wide>
      <div className="directory-picker">
        <div className="directory-picker-list">
          <label className="search">
            <Icon name="search" size={17} />
            <input
              autoFocus
              value={query}
              placeholder="搜索姓名、工号或职位"
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                void search(value);
              }}
            />
          </label>
          {loading && <p className="muted">正在查询企业通讯录…</p>}
          {error && <div className="notice error">{error}</div>}
          {!loading &&
            !error &&
            people.map((person) => (
              <button
                type="button"
                className={`directory-person ${selected?.userId === person.userId ? "selected" : ""}`}
                key={person.userId}
                onClick={() => setSelected(person)}
              >
                <span className="avatar blue">{person.name.slice(0, 1)}</span>
                <span>
                  <strong>{person.name}</strong>
                  <small>
                    {person.position ?? "企业成员"}
                    {person.employeeNo ? ` · ${person.employeeNo}` : ""}
                  </small>
                </span>
              </button>
            ))}
          {!loading && !error && !people.length && (
            <EmptyState label="未找到可添加的企业成员" compact />
          )}
        </div>
        <div className="directory-picker-selected">
          <strong>已选人员</strong>
          {selected ? (
            <div className="selected-person">
              <span className="avatar blue">{selected.name.slice(0, 1)}</span>
              <span>
                <b>{selected.name}</b>
                <small>
                  {selected.position ?? selected.employeeNo ?? "企业成员"}
                </small>
              </span>
            </div>
          ) : (
            <p className="muted">请选择一位企业成员</p>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button className="button secondary" type="button" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          type="button"
          disabled={!selected}
          onClick={() => selected && onPick(selected)}
        >
          确定添加
        </button>
      </div>
    </Modal>
  );
}

function SettingsCenter() {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<Settings>("/v1/settings")
      .then(setSettings)
      .catch((reason) => setError(errorText(reason)));
  }, []);
  async function save() {
    if (!settings) return;
    setError(undefined);
    try {
      setSettings(
        await api<Settings>("/v1/settings", {
          method: "PATCH",
          body: JSON.stringify(settings),
        }),
      );
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  if (!settings)
    return (
      <section className="content-section">
        <Loading />
      </section>
    );
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <h2>系统设置</h2>
          <p>配置员工查看范围、通知方式和安全策略。</p>
        </div>
        <button className="button primary" onClick={save}>
          <Icon name="check" size={17} />
          保存设置
        </button>
      </div>
      {saved && (
        <div className="notice success">
          <Icon name="check" size={17} />
          设置已保存
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <div className="settings-stack">
        <SettingRow
          title="员工可查看范围"
          description="员工仅可查看最近 12 个月的工资条，超期批次进入加密归档。"
        >
          <span className="fixed-value">12 个月</span>
        </SettingRow>
        <SettingRow
          title="通知方式"
          description="工资条将通过钉钉工作通知发送给员工。"
        >
          <span className="fixed-value">钉钉工作通知</span>
        </SettingRow>
        <SettingRow
          title="查看与确认待办"
          description="待办需要员工 OAuth 授权和定时调度后才能创建；当前未启用，避免出现未实际发送的提醒。"
        >
          <span className="fixed-value">待授权</span>
        </SettingRow>
        <SettingRow
          title="密码验证"
          description="员工进入工资条前增加额外密码验证。"
        >
          <Toggle
            checked={settings.passwordVerification}
            onChange={(value) =>
              setSettings({ ...settings, passwordVerification: value })
            }
          />
        </SettingRow>
        <SettingRow
          title="发薪提醒"
          description="在发薪日前提醒管理员检查工资表。"
        >
          <Toggle
            checked={settings.payrollReminder}
            onChange={(value) =>
              setSettings({ ...settings, payrollReminder: value })
            }
          />
        </SettingRow>
        <SettingRow
          title="仅员工展示工资条"
          description="工资条详情和我的页仅保留工资数据，不展示其他应用内容。"
        >
          <Toggle
            checked={settings.employeeOnlyView}
            onChange={(value) =>
              setSettings({ ...settings, employeeOnlyView: value })
            }
          />
        </SettingRow>
      </div>
      <div className="log-link">
        <Icon name="receipt" size={18} />
        <div>
          <strong>操作日志</strong>
          <span>上传、发送、撤回、导出和设置变更均会记录</span>
        </div>
        <span className="muted">在发薪存证中查看</span>
      </div>
    </section>
  );
}

function EmployeeHome({ employeeId }: { employeeId: string | undefined }) {
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
        <FullError message={error} />
      </div>
    );
  if (!identity || !month)
    return (
      <div className="employee-page">
        <Loading />
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

function EmployeePage({ employeeId }: { employeeId: string | undefined }) {
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
        <FullError message={error} />
      </div>
    );
  if (!identity || !payload)
    return (
      <div className="employee-page">
        <Loading />
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
        <button
          className={`employee-confirm ${confirmed || payload.item.confirmedAt ? "confirmed" : ""}`}
          onClick={confirm}
          disabled={Boolean(confirmed || payload.item.confirmedAt)}
        >
          <Icon name="check" size={19} />
          {confirmed || payload.item.confirmedAt ? "已确认查看" : "确认已查看"}
        </button>
        <p className="employee-footnote">
          本工资条通过企业内部工作通知送达，查看和确认时间将生成存证记录。
        </p>
      </main>
    </div>
  );
}

function SalarySlipPreview({
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
  const visibleFields = fields.filter((field) =>
    settings.visibleFields.includes(field),
  );
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

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning";
}) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Status({ state }: { state: string }) {
  const label = stateLabel[state] ?? state;
  return (
    <span className={`status status-${state}`}>
      {state === "confirmed" && <Icon name="check" size={13} />}
      {label}
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <div className={`modal ${wide ? "modal-wide" : ""}`}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? "span-2" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function FormActions({
  onClose,
  submitLabel = "创建工资表",
}: {
  onClose: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="form-actions span-2">
      <button type="button" className="button secondary" onClick={onClose}>
        取消
      </button>
      <button type="submit" className="button primary">
        <Icon name="check" size={16} />
        {submitLabel}
      </button>
    </div>
  );
}
function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {children}
    </div>
  );
}
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
function Loading() {
  return (
    <div className="loading">
      <span className="spinner" />
      加载中
    </div>
  );
}
function EmptyState({ label, compact }: { label: string; compact?: boolean }) {
  return <div className={`empty ${compact ? "compact" : ""}`}>{label}</div>;
}
function FullError({ message }: { message: string }) {
  return (
    <div className="full-error">
      <Icon name="shield" size={24} />
      <strong>页面加载失败</strong>
      <span>{message}</span>
    </div>
  );
}
function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
function formatMoney(value: number) {
  return formatSalaryValue(value, true);
}
export function formatSalaryValue(
  value: string | number | null | undefined,
  grouping = false,
): string {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value !== "number") return String(value);
  const rounded =
    (Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100) *
    Math.sign(value || 1);
  return grouping
    ? rounded.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : rounded.toFixed(2);
}
function defaultFieldGroups(fields: string[]): SalarySlipFieldGroup[] {
  const group = (id: string, name: string, matcher: RegExp) => ({
    id,
    name,
    fieldKeys: fields.filter((field) => matcher.test(field)),
  });
  const groups = [
    group("attendance", "出勤情况", /(出勤|请假|迟到|早退)/),
    group("income", "应发工资", /(工资|补贴|绩效|业绩|提成|应发)/),
    group("deduction", "代扣款项", /(扣款|个税|所得税|社保|养老|失业|医保)/),
  ];
  const grouped = new Set(groups.flatMap((item) => item.fieldKeys));
  const other = fields.filter((field) => !grouped.has(field));
  return other.length
    ? [...groups, { id: "other", name: "其他", fieldKeys: other }]
    : groups;
}
function errorText(reason: unknown) {
  const error =
    reason instanceof Error
      ? reason
      : new Error(typeof reason === "string" ? reason : "unknown_error");
  console.error("salary_ui_error", error.message);
  return error.message;
}
