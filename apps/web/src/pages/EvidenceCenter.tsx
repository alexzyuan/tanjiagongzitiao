import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  type PaymentEvidenceConfirmStatus,
  type PaymentEvidenceDetail,
  type PaymentEvidenceEmployee,
  type PaymentEvidenceEmploymentStatus,
  type PaymentEvidenceFilters,
  type PaymentEvidenceSendStatus,
  type PaymentEvidenceViewStatus,
} from "../api";
import { Icon } from "../icons";
import { errorText } from "../utils/errors";
import { EmptyState } from "../components/EmptyState";
import { Status } from "../components/Status";

const sendStatusOptions: Array<[PaymentEvidenceSendStatus, string]> = [
  ["not_sent", "未发送"],
  ["sent", "已发送"],
  ["failed", "发送失败"],
  ["withdrawn", "已撤回"],
];
const viewStatusOptions: Array<[PaymentEvidenceViewStatus, string]> = [
  ["not_viewed", "未查看"],
  ["viewed", "已查看"],
];
const confirmStatusOptions: Array<[PaymentEvidenceConfirmStatus, string]> = [
  ["not_confirmed", "未确认"],
  ["confirmed", "已确认"],
];

function formatEvidenceDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function evidenceErrorText(reason: unknown): string {
  if (
    reason instanceof Error &&
    reason.message === "salary_evidence_export_empty"
  )
    return "当前筛选条件下暂无可导出的存证明细。";
  return errorText(reason);
}

function queryString(filters: PaymentEvidenceFilters): string {
  const params = new URLSearchParams();
  for (const key of [
    "fromMonth",
    "toMonth",
    "sendStatus",
    "viewStatus",
    "confirmStatus",
  ] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}

function updateFilter<K extends keyof PaymentEvidenceFilters>(
  filters: PaymentEvidenceFilters,
  key: K,
  value: PaymentEvidenceFilters[K] | undefined,
): PaymentEvidenceFilters {
  const next = { ...filters } as Record<string, string>;
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

export function EvidenceCenter({ refreshKey }: { refreshKey: number }) {
  const [employmentStatus, setEmploymentStatus] =
    useState<PaymentEvidenceEmploymentStatus>("active");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [employees, setEmployees] = useState<PaymentEvidenceEmployee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>();
  const [detail, setDetail] = useState<PaymentEvidenceDetail>();
  const [filters, setFilters] = useState<PaymentEvidenceFilters>({});
  const [draftFilters, setDraftFilters] = useState<PaymentEvidenceFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exportFields, setExportFields] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const params = new URLSearchParams({ employmentStatus });
    if (search) params.set("query", search);
    try {
      setEmployees(
        await api<PaymentEvidenceEmployee[]>(
          `/v1/payment-evidence/employees?${params.toString()}`,
        ),
      );
    } catch (reason) {
      setEmployees([]);
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, [employmentStatus, search]);

  useEffect(() => {
    void loadEmployees();
  }, [loadEmployees, refreshKey]);

  const loadDetail = useCallback(
    async (employeeUserId: string, nextFilters: PaymentEvidenceFilters) => {
      setError(undefined);
      setLoading(true);
      try {
        const result = await api<PaymentEvidenceDetail>(
          `/v1/payment-evidence/employees/${encodeURIComponent(employeeUserId)}${queryString(nextFilters)}`,
        );
        setSelectedEmployeeId(employeeUserId);
        setDetail(result);
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const openDetail = (employee: PaymentEvidenceEmployee) => {
    setFilters({});
    setDraftFilters({});
    setShowFilters(false);
    setShowExport(false);
    void loadDetail(employee.employeeUserId, {});
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    setFilters(draftFilters);
    setShowFilters(false);
    if (selectedEmployeeId) void loadDetail(selectedEmployeeId, draftFilters);
  };

  const downloadExport = async () => {
    if (!selectedEmployeeId) return;
    setError(undefined);
    try {
      const response = await fetch("/v1/payment-evidence/export.xlsx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          employeeUserId: selectedEmployeeId,
          fields: exportFields,
          ...filters,
        }),
      });
      if (!response.ok) {
        let code = `http_${response.status}`;
        try {
          const body = (await response.json()) as { code?: unknown };
          if (typeof body.code === "string" && body.code) code = body.code;
        } catch {
          // Keep the HTTP status when an upstream error is not JSON.
        }
        throw new Error(code);
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${detail?.employee.employeeName ?? "发薪存证"}-发薪存证.xlsx`;
      link.click();
      URL.revokeObjectURL(href);
      setShowExport(false);
    } catch (reason) {
      setError(evidenceErrorText(reason));
    }
  };

  const employeeRows = useMemo(
    () => employees.map((employee) => (
      <tr key={employee.employeeUserId}>
        <td>
          <strong>{employee.employeeName}</strong>
          {employee.employeeNo && <span className="evidence-muted">工号 {employee.employeeNo}</span>}
        </td>
        <td>{employee.position ?? "—"}</td>
        <td>{employee.evidenceCount}</td>
        <td>{formatEvidenceDate(employee.latestEvidenceAt)}</td>
        <td>
          <button className="text-button" type="button" onClick={() => openDetail(employee)}>
            查看发薪存证
          </button>
        </td>
      </tr>
    )),
    [employees],
  );

  if (detail && selectedEmployeeId) {
    return (
      <section className="content-section evidence-center">
        <div className="section-header">
          <div>
            <button className="button secondary evidence-back" type="button" onClick={() => {
              setDetail(undefined);
              setSelectedEmployeeId(undefined);
            }}>
              返回存证列表
            </button>
            <h2>{detail.employee.employeeName}的发薪存证</h2>
            <p>{detail.employee.employeeNo ? `工号 ${detail.employee.employeeNo} · ` : ""}{detail.employee.position ?? "未填写职位"}</p>
          </div>
          <span className="security-badge"><Icon name="shield" size={16} /> 加密归档</span>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="evidence-detail-toolbar">
          <span>共 {detail.rows.length} 条发薪记录</span>
          <div>
            <button className="button secondary" type="button" onClick={() => setShowFilters((value) => !value)}>
              筛选
            </button>
            <button className="button primary" type="button" onClick={() => {
              setExportFields(detail.availableFields);
              setShowExport(true);
            }}>
              导出 Excel
            </button>
          </div>
        </div>
        {showFilters && (
          <form className="evidence-filter-panel" onSubmit={applyFilters}>
            <label>发薪月份（起）<input type="month" value={draftFilters.fromMonth ?? ""} onChange={(event) => setDraftFilters((value) => updateFilter(value, "fromMonth", event.target.value || undefined))} /></label>
            <label>发薪月份（止）<input type="month" value={draftFilters.toMonth ?? ""} onChange={(event) => setDraftFilters((value) => updateFilter(value, "toMonth", event.target.value || undefined))} /></label>
            <label>发送状态<select aria-label="发送状态" value={draftFilters.sendStatus ?? ""} onChange={(event) => setDraftFilters((value) => updateFilter(value, "sendStatus", event.target.value ? event.target.value as PaymentEvidenceSendStatus : undefined))}><option value="">全部</option>{sendStatusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>查看状态<select aria-label="查看状态" value={draftFilters.viewStatus ?? ""} onChange={(event) => setDraftFilters((value) => updateFilter(value, "viewStatus", event.target.value ? event.target.value as PaymentEvidenceViewStatus : undefined))}><option value="">全部</option>{viewStatusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label>确认状态<select aria-label="确认状态" value={draftFilters.confirmStatus ?? ""} onChange={(event) => setDraftFilters((value) => updateFilter(value, "confirmStatus", event.target.value ? event.target.value as PaymentEvidenceConfirmStatus : undefined))}><option value="">全部</option>{confirmStatusOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <button className="button primary" type="submit">应用筛选</button>
          </form>
        )}
        <div className="table-card">
          <div className="table-scroll">
            <table>
              <thead><tr><th>发薪月份</th><th>工资条标题</th><th>发薪明细</th><th>发送状态</th><th>查看状态</th><th>确认状态</th><th>确认时间</th><th>确认人</th></tr></thead>
              <tbody>{detail.rows.map((row) => <tr key={row.itemId}>
                <td>{row.payrollMonth}</td>
                <td>{row.title}</td>
                <td><div className="evidence-fields">{Object.entries(row.fields).map(([field, value]) => <span key={field}><b>{field}</b>{String(value ?? "—")}</span>)}</div></td>
                <td><Status state={row.sendStatus} />{row.sentAt && <small>{formatEvidenceDate(row.sentAt)}</small>}{row.withdrawnAt && <small>撤回时间 {formatEvidenceDate(row.withdrawnAt)}</small>}</td>
                <td><Status state={row.viewStatus === "viewed" ? "viewed" : "unread"} /></td>
                <td><Status state={row.confirmStatus === "confirmed" ? "confirmed" : "unconfirmed"} /></td>
                <td>{formatEvidenceDate(row.confirmedAt)}</td>
                <td>{row.confirmedBy ?? "—"}</td>
              </tr>)}</tbody>
            </table>
            {detail.rows.length === 0 && <EmptyState label="暂无符合条件的发薪存证" />}
          </div>
        </div>
        {showExport && (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowExport(false); }}>
            <div className="modal evidence-export-modal" role="dialog" aria-modal="true" aria-labelledby="evidence-export-title">
              <div className="modal-header"><h3 id="evidence-export-title">导出 Excel 存证</h3><button className="icon-button" type="button" aria-label="关闭" onClick={() => setShowExport(false)}>×</button></div>
              <p className="modal-description">固定包含员工信息、月份、发送/查看/确认状态、确认时间和确认人；下方选择工资字段。</p>
              <div className="evidence-field-list">{detail.availableFields.length === 0 ? <span className="evidence-muted">暂无工资字段</span> : detail.availableFields.map((field) => <label key={field}><input type="checkbox" checked={exportFields.includes(field)} onChange={(event) => setExportFields((values) => event.target.checked ? [...values, field] : values.filter((value) => value !== field))} /> {field}</label>)}</div>
              <div className="modal-actions"><button className="button secondary" type="button" onClick={() => setShowExport(false)}>取消</button><button className="button primary" type="button" onClick={() => void downloadExport()}>下载 Excel</button></div>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="content-section evidence-center">
      <div className="section-header">
        <div><h2>发薪存证</h2><p>按员工查看发薪明细、发送状态、查收状态和确认记录。</p></div>
        <span className="security-badge"><Icon name="shield" size={16} /> 加密归档</span>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="evidence-tabs" role="tablist" aria-label="员工状态">
        {(["active", "departed"] as const).map((value) => <button type="button" role="tab" aria-selected={employmentStatus === value} className={employmentStatus === value ? "active" : ""} onClick={() => { setEmploymentStatus(value); setSelectedEmployeeId(undefined); setDetail(undefined); }} key={value}>{value === "active" ? "在职" : "已离职"}</button>)}
      </div>
      <form className="evidence-search" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="evidence-search-input">搜索姓名/工号/职位</label>
        <input id="evidence-search-input" aria-label="搜索姓名/工号/职位" placeholder="搜索姓名/工号/职位" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} />
        <button className="button secondary" type="submit"><Icon name="search" size={16} /> 搜索</button>
      </form>
      <div className="table-card">
        <div className="table-toolbar"><div className="table-title">员工发薪存证</div><span className="toolbar-note">工资金额仅在员工详情和导出操作中按权限读取</span></div>
        <div className="table-scroll"><table><thead><tr><th>员工</th><th>职位</th><th>存证数量</th><th>最近记录</th><th>操作</th></tr></thead><tbody>{employeeRows}</tbody></table>{loading && <div className="loading">加载中…</div>}{!loading && employees.length === 0 && <EmptyState label="暂无发薪存证" />}</div>
      </div>
    </section>
  );
}
