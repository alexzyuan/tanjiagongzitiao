import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, ensureSession, type Batch, type Identity, type ReportSummary, type SalaryItem, type Settings } from "./api";
import { Icon } from "./icons";

type Module = "salary" | "evidence" | "reports" | "permissions" | "settings";

const nav: Array<{ key: Module; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { key: "salary", label: "工资条管理", icon: "wallet" },
  { key: "evidence", label: "发薪存证", icon: "receipt" },
  { key: "reports", label: "报表中心", icon: "chart" },
  { key: "permissions", label: "权限管理", icon: "lock" },
  { key: "settings", label: "系统设置", icon: "settings" }
];

const stateLabel: Record<string, string> = { draft: "草稿", scheduled: "已排期", sending: "发送中", sent: "已发送", partially_failed: "部分失败", withdrawn: "已撤回", archived: "已归档" };

export function App() {
  const impersonatedId = new URLSearchParams(window.location.search).get("as") ?? undefined;
  if (window.location.pathname.startsWith("/employee/")) return <EmployeePage employeeId={impersonatedId} />;
  return <AdminApp impersonatedId={impersonatedId} />;
}

function AdminApp({ impersonatedId }: { impersonatedId: string | undefined }) {
  const [identity, setIdentity] = useState<Identity>();
  const [module, setModule] = useState<Module>("salary");
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    ensureSession(impersonatedId).then(setIdentity).catch(reason => setError(errorText(reason)));
  }, [impersonatedId]);

  if (error) return <FullError message={error} />;
  if (!identity) return <Loading />;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="wallet" size={19} /></span><span>薪资中心</span></div>
      <div className="sidebar-caption">企业内部应用</div>
      <nav className="nav-list" aria-label="功能导航">
        {nav.map(item => <button className={`nav-item ${module === item.key ? "active" : ""}`} key={item.key} onClick={() => setModule(item.key)}><Icon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-footer"><span className="security-dot"><Icon name="shield" size={15} /></span><span>敏感数据加密存储</span></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><div className="eyebrow">企业薪资服务</div><h1>{nav.find(item => item.key === module)?.label}</h1></div><div className="identity"><span className="avatar">{identity.name.slice(0, 1)}</span><span>{identity.name}</span><span className="role">主管理员</span></div></header>
      <div className="page-wrap">
        {module === "salary" && <SalaryManagement onChanged={() => setRefreshKey(value => value + 1)} refreshKey={refreshKey} />}
        {module === "evidence" && <EvidenceCenter refreshKey={refreshKey} />}
        {module === "reports" && <ReportCenter refreshKey={refreshKey} />}
        {module === "permissions" && <PermissionCenter refreshKey={refreshKey} onChanged={() => setRefreshKey(value => value + 1)} />}
        {module === "settings" && <SettingsCenter />}
      </div>
    </main>
  </div>;
}

function SalaryManagement({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<Batch>();
  const [mode, setMode] = useState<"manual" | "import">();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => api<Batch[]>("/v1/salary-batches").then(setBatches).catch(reason => setError(errorText(reason))), []);
  useEffect(() => { load(); }, [load, refreshKey]);

  async function send(batch: Batch, action: "send" | "resend" | "withdraw") {
    setBusy(true); setError(undefined);
    try { await api(`/v1/salary-batches/${batch.id}/${action}`, { method: "POST", body: JSON.stringify({}) }); setMessage(action === "withdraw" ? "工资条已撤回" : "发送任务已提交"); await load(); onChanged(); }
    catch (reason) { setError(errorText(reason)); }
    finally { setBusy(false); }
  }

  return <section className="content-section">
    <div className="section-header"><div><h2>工资条管理</h2><p>导入或手工录入每月工资数据，发送状态和确认状态集中管理。</p></div><div className="header-actions"><button className="button secondary" onClick={() => setMode("import")}><Icon name="upload" size={17} />导入 Excel</button><button className="button primary" onClick={() => setMode("manual")}><Icon name="plus" size={17} />手工录入</button></div></div>
    {message && <div className="notice success"><Icon name="check" size={17} />{message}<button onClick={() => setMessage(undefined)} aria-label="关闭">×</button></div>}
    {error && <div className="notice error">{error}</div>}
    <div className="metric-strip"><Metric label="工资批次" value={batches.length} /><Metric label="本期人数" value={batches[0]?.total ?? 0} /><Metric label="已查看" value={batches.reduce((sum, item) => sum + item.viewed, 0)} /><Metric label="已确认" value={batches.reduce((sum, item) => sum + item.confirmed, 0)} /></div>
    <div className="table-card"><div className="table-toolbar"><div className="table-title">工资表</div><label className="search"><Icon name="search" size={17} /><input placeholder="搜索工资条标题" onChange={event => { const query = event.target.value.trim(); setBatches(value => query ? value.filter(item => item.title.includes(query)) : value); }} /></label><span className="toolbar-note">仅企业管理员可查看归档</span></div>
      <div className="table-scroll"><table><thead><tr><th>所属月份</th><th>工资条标题</th><th>状态</th><th>人数</th><th>已发送</th><th>已查看</th><th>已确认</th><th>操作</th></tr></thead><tbody>{batches.map(batch => <tr key={batch.id} className={selected?.id === batch.id ? "selected-row" : ""} onClick={() => setSelected(batch)}><td className="strong">{batch.payrollMonth}</td><td>{batch.title}</td><td><Status state={batch.state} /></td><td>{batch.total}</td><td>{batch.sent}/{batch.total}</td><td>{batch.viewed}/{batch.total}</td><td>{batch.confirmed}/{batch.total}</td><td><div className="row-actions" onClick={event => event.stopPropagation()}>{(batch.state === "draft" || batch.state === "partially_failed" || batch.state === "withdrawn") && <button className="text-button" disabled={busy} onClick={() => send(batch, batch.state === "draft" ? "send" : "resend")}><Icon name="send" size={15} />{batch.state === "draft" ? "发送" : "重发"}</button>}{batch.state === "sent" && <button className="text-button danger" disabled={busy} onClick={() => send(batch, "withdraw")}><Icon name="withdraw" size={15} />撤回</button>}<button className="text-button" onClick={() => setSelected(batch)}>查看</button></div></td></tr>)}</tbody></table>{batches.length === 0 && <EmptyState label="暂无工资表" />}</div>
    </div>
    {selected && <BatchDetail batch={selected} onClose={() => setSelected(undefined)} />}
    {mode === "manual" && <ManualPanel onClose={() => setMode(undefined)} onCreated={() => { setMode(undefined); load(); onChanged(); }} />}
    {mode === "import" && <ImportPanel onClose={() => setMode(undefined)} onCreated={() => { setMode(undefined); load(); onChanged(); }} />}
  </section>;
}

function BatchDetail({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const [detail, setDetail] = useState<Batch>();
  const [error, setError] = useState<string>();
  useEffect(() => { api<Batch>(`/v1/salary-batches/${batch.id}`).then(setDetail).catch(reason => setError(errorText(reason))); }, [batch.id]);
  return <div className="drawer-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><aside className="drawer"><div className="drawer-header"><div><span className="eyebrow">工资表详情</span><h3>{batch.title}</h3></div><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div>{error && <div className="notice error">{error}</div>}<div className="detail-summary"><span><small>月份</small>{batch.payrollMonth}</span><span><small>发送进度</small>{batch.sent}/{batch.total}</span><span><small>查看确认</small>{batch.viewed}/{batch.confirmed}</span></div><div className="employee-list">{detail?.items?.map(item => <EmployeeRow item={item} key={item.id} />)}</div></aside></div>;
}

function EmployeeRow({ item }: { item: SalaryItem }) {
  const net = item.fields["实发金额"] ?? item.fields["实发"] ?? item.fields["应发合计"];
  return <div className="employee-row"><span className="avatar pale">{item.employeeName.slice(0, 1)}</span><div className="employee-main"><strong>{item.employeeName}</strong><small>{item.employeeNo ?? item.employeeUserId}{item.department ? ` · ${item.department}` : ""}</small></div><span className="employee-net">{typeof net === "number" ? `¥ ${net.toFixed(2)}` : "已加密"}</span><Status state={item.confirmedAt ? "confirmed" : item.viewedAt ? "viewed" : "unread"} /></div>;
}

function ManualPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ payrollMonth: currentMonth(), title: `${currentMonth()} 工资条`, userId: "employee-a", name: "员工A", net: "10000" });
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent) { event.preventDefault(); setError(undefined); try { const result = await api<{ errors: Array<{ message: string }>; batchId?: string }>("/v1/salary-batches", { method: "POST", body: JSON.stringify({ payrollMonth: form.payrollMonth, title: form.title, rows: [{ userId: form.userId, name: form.name, "实发金额": Number(form.net) }] }) }); if (result.errors.length) throw new Error(result.errors.map(item => item.message).join("；")); onCreated(); } catch (reason) { setError(errorText(reason)); } }
  return <Modal title="手工录入工资条" onClose={onClose}><form className="form-grid" onSubmit={submit}><Field label="发薪月份"><input value={form.payrollMonth} onChange={event => setForm({ ...form, payrollMonth: event.target.value })} pattern="\d{4}-\d{2}" required /></Field><Field label="工资条标题"><input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} required /></Field><Field label="钉钉用户 ID"><input value={form.userId} onChange={event => setForm({ ...form, userId: event.target.value })} required /></Field><Field label="员工姓名"><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /></Field><Field label="实发金额"><input type="number" min="0" step="0.01" value={form.net} onChange={event => setForm({ ...form, net: event.target.value })} required /></Field>{error && <div className="notice error span-2">{error}</div>}<FormActions onClose={onClose} /></form></Modal>;
}

function ImportPanel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [title, setTitle] = useState(`${currentMonth()} 工资条`);
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  async function submit(event: FormEvent) { event.preventDefault(); if (!file) { setError("请选择 Excel 文件"); return; } setError(undefined); const form = new FormData(); form.append("payrollMonth", month); form.append("title", title); form.append("file", file); try { const result = await api<{ errors: Array<{ message: string }>; batchId?: string }>("/v1/salary-batches/import", { method: "POST", body: form }); if (result.errors.length) throw new Error(result.errors.map(item => item.message).join("；")); onCreated(); } catch (reason) { setError(errorText(reason)); } }
  return <Modal title="导入 Excel 工资表" onClose={onClose}><form className="form-grid" onSubmit={submit}><Field label="发薪月份"><input value={month} onChange={event => setMonth(event.target.value)} pattern="\d{4}-\d{2}" required /></Field><Field label="工资条标题"><input value={title} onChange={event => setTitle(event.target.value)} required /></Field><Field label="工资表文件" wide><input type="file" accept=".xlsx,.xls,.csv" onChange={event => setFile(event.target.files?.[0])} required /><small className="field-help">首行使用字段名，需包含钉钉用户 ID和员工姓名。</small></Field>{error && <div className="notice error span-2">{error}</div>}<FormActions onClose={onClose} submitLabel="导入并校验" /></form></Modal>;
}

function EvidenceCenter({ refreshKey }: { refreshKey: number }) {
  const [events, setEvents] = useState<Array<{ id: string; batchId: string; employeeUserId: string; eventType: string; fingerprint: string; createdAt: string }>>([]);
  const [error, setError] = useState<string>();
  useEffect(() => { api<typeof events>("/v1/payment-evidence").then(setEvents).catch(reason => setError(errorText(reason))); }, [refreshKey]);
  return <section className="content-section"><div className="section-header"><div><h2>发薪存证</h2><p>记录通知、查看和确认链路，保留可审计的时间戳与指纹。</p></div><span className="security-badge"><Icon name="shield" size={16} />加密归档</span></div>{error && <div className="notice error">{error}</div>}<div className="metric-strip"><Metric label="存证事件" value={events.length} /><Metric label="已通知" value={events.filter(event => event.eventType === "notification_sent").length} /><Metric label="已查看" value={events.filter(event => event.eventType === "viewed").length} /><Metric label="已确认" value={events.filter(event => event.eventType === "confirmed").length} /></div><div className="table-card"><div className="table-toolbar"><div className="table-title">存证流水</div><span className="toolbar-note">敏感工资字段不出现在存证流水中</span></div><div className="table-scroll"><table><thead><tr><th>时间</th><th>工资表</th><th>员工标识</th><th>事件</th><th>指纹</th></tr></thead><tbody>{events.map(event => <tr key={event.id}><td>{formatDate(event.createdAt)}</td><td className="mono">{event.batchId}</td><td>{event.employeeUserId}</td><td><Status state={event.eventType} /></td><td className="mono">{event.fingerprint.slice(0, 18)}…</td></tr>)}</tbody></table>{events.length === 0 && <EmptyState label="暂无存证事件" />}</div></div></section>;
}

function ReportCenter({ refreshKey }: { refreshKey: number }) {
  const [report, setReport] = useState<ReportSummary>();
  const [error, setError] = useState<string>();
  useEffect(() => { api<ReportSummary>("/v1/reports/summary").then(setReport).catch(reason => setError(errorText(reason))); }, [refreshKey]);
  return <section className="content-section"><div className="section-header"><div><h2>报表中心</h2><p>按批次查看发送覆盖、员工查看和确认进度。</p></div><a className="button secondary" href="/v1/reports/summary.csv"><Icon name="download" size={17} />导出 CSV</a></div>{error && <div className="notice error">{error}</div>}<div className="metric-strip report-metrics"><Metric label="工资批次" value={report?.totals.batches ?? 0} /><Metric label="工资条" value={report?.totals.recipients ?? 0} /><Metric label="已发送" value={report?.totals.sent ?? 0} /><Metric label="已查看" value={report?.totals.viewed ?? 0} /><Metric label="已确认" value={report?.totals.confirmed ?? 0} /><Metric label="发送失败" value={report?.totals.failedDeliveries ?? 0} {...(report?.totals.failedDeliveries ? { tone: "warning" as const } : {})} /></div><div className="report-summary-line"><span>应发合计 <strong>¥ {formatMoney(report?.totals.salaryTotals.gross ?? 0)}</strong></span><span>实发合计 <strong>¥ {formatMoney(report?.totals.salaryTotals.net ?? 0)}</strong></span><span>个税合计 <strong>¥ {formatMoney(report?.totals.salaryTotals.tax ?? 0)}</strong></span><span>社保扣款 <strong>¥ {formatMoney(report?.totals.salaryTotals.socialInsurance ?? 0)}</strong></span></div><div className="table-card"><div className="table-toolbar"><div className="table-title">批次明细</div><span className="toolbar-note">统计范围：当前可管理工资表</span></div><div className="table-scroll"><table><thead><tr><th>月份</th><th>标题</th><th>状态</th><th>人数</th><th>已发送</th><th>已查看</th><th>已确认</th><th>失败</th></tr></thead><tbody>{report?.batches.map(batch => <tr key={batch.id}><td className="strong">{batch.payrollMonth}</td><td>{batch.title}</td><td><Status state={batch.state} /></td><td>{batch.total}</td><td>{batch.sent}</td><td>{batch.viewed}</td><td>{batch.confirmed}</td><td>{batch.deliveryFailures || "-"}</td></tr>)}</tbody></table>{!report?.batches.length && <EmptyState label="暂无报表数据" />}</div></div></section>;
}

function PermissionCenter({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [subAdmins, setSubAdmins] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [userId, setUserId] = useState("");
  const [subAdminId, setSubAdminId] = useState("");
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => { Promise.all([api<Batch[]>("/v1/salary-batches"), api<string[]>("/v1/sub-admins")]).then(([value, roles]) => { setBatches(value); setSelectedId(value[0]?.id ?? ""); setSubAdmins(roles); }).catch(reason => setError(errorText(reason))); }, [refreshKey]);
  const selected = batches.find(batch => batch.id === selectedId);
  async function assign(event: FormEvent) { event.preventDefault(); if (!selected || !userId.trim()) return; try { await api(`/v1/salary-batches/${selected.id}/admins`, { method: "POST", body: JSON.stringify({ userId: userId.trim() }) }); setMessage(`已将 ${userId.trim()} 添加为工资表管理员`); setUserId(""); const value = await api<Batch[]>("/v1/salary-batches"); setBatches(value); onChanged(); } catch (reason) { setError(errorText(reason)); } }
  async function removeBatchAdmin(id: string) { if (!selected) return; try { const updated = await api<Batch>(`/v1/salary-batches/${selected.id}/admins/${encodeURIComponent(id)}`, { method: "DELETE" }); setBatches(value => value.map(batch => batch.id === updated.id ? updated : batch)); setMessage(`已移除工资表管理员 ${id}`); onChanged(); } catch (reason) { setError(errorText(reason)); } }
  async function assignSubAdmin(event: FormEvent) { event.preventDefault(); if (!subAdminId.trim()) return; try { const roles = await api<string[]>("/v1/sub-admins", { method: "POST", body: JSON.stringify({ userId: subAdminId.trim() }) }); setSubAdmins(roles); setMessage(`已将 ${subAdminId.trim()} 添加为子管理员`); setSubAdminId(""); onChanged(); } catch (reason) { setError(errorText(reason)); } }
  async function removeSubAdmin(id: string) { try { setSubAdmins(await api<string[]>(`/v1/sub-admins/${encodeURIComponent(id)}`, { method: "DELETE" })); setMessage(`已移除子管理员 ${id}`); onChanged(); } catch (reason) { setError(errorText(reason)); } }
  return <section className="content-section"><div className="section-header"><div><h2>权限管理</h2><p>主管理员默认由企业管理员担任，其他人员按工资表手动授权。</p></div></div>{message && <div className="notice success"><Icon name="check" size={17} />{message}</div>}{error && <div className="notice error">{error}</div>}<div className="permission-grid"><div className="permission-card"><div className="card-kicker">主管理员</div><div className="admin-profile"><span className="avatar blue">管</span><div><strong>企业管理员</strong><small>全部工资表 · 全部历史 · 系统设置</small></div><span className="tag blue-tag">默认</span></div><div className="sub-admin-block"><div className="card-kicker">子管理员</div><form className="assign-row" onSubmit={assignSubAdmin}><input value={subAdminId} onChange={event => setSubAdminId(event.target.value)} placeholder="输入钉钉用户 ID" /><button className="button secondary" type="submit"><Icon name="plus" size={16} />添加</button></form>{subAdmins.length ? <div className="chips">{subAdmins.map(id => <span className="person-chip" key={id}><span className="dot" />{id}<button type="button" className="chip-remove" onClick={() => removeSubAdmin(id)} aria-label={`移除 ${id}`}>×</button></span>)}</div> : <EmptyState label="暂无子管理员" compact />}</div></div><div className="permission-card"><div className="card-kicker">工资表管理员</div><label className="field-label">选择工资表<select value={selectedId} onChange={event => setSelectedId(event.target.value)}><option value="">请选择</option>{batches.map(batch => <option value={batch.id} key={batch.id}>{batch.title}</option>)}</select></label><form className="assign-row" onSubmit={assign}><input value={userId} onChange={event => setUserId(event.target.value)} placeholder="输入钉钉用户 ID" /><button className="button primary" type="submit"><Icon name="plus" size={16} />添加</button></form>{selected?.assignedAdminIds.length ? <div className="chips">{selected.assignedAdminIds.map(id => <span className="person-chip" key={id}><span className="dot" />{id}<button type="button" className="chip-remove" onClick={() => removeBatchAdmin(id)} aria-label={`移除 ${id}`}>×</button></span>)}</div> : <EmptyState label="该工资表暂未添加管理员" compact />}</div></div><div className="info-banner"><Icon name="lock" size={18} /><div><strong>权限边界</strong><span>子管理员仅可发放和管理被添加的工资表；加密归档仅企业管理员可访问。</span></div></div></section>;
}

function SettingsCenter() {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  useEffect(() => { api<Settings>("/v1/settings").then(setSettings).catch(reason => setError(errorText(reason))); }, []);
  async function save() { if (!settings) return; setError(undefined); try { setSettings(await api<Settings>("/v1/settings", { method: "PATCH", body: JSON.stringify(settings) })); setSaved(true); window.setTimeout(() => setSaved(false), 2200); } catch (reason) { setError(errorText(reason)); } }
  if (!settings) return <section className="content-section"><Loading /></section>;
  return <section className="content-section"><div className="section-header"><div><h2>系统设置</h2><p>配置员工查看范围、通知方式和安全策略。</p></div><button className="button primary" onClick={save}><Icon name="check" size={17} />保存设置</button></div>{saved && <div className="notice success"><Icon name="check" size={17} />设置已保存</div>}{error && <div className="notice error">{error}</div>}<div className="settings-stack"><SettingRow title="员工可查看范围" description="员工仅可查看最近 12 个月的工资条，超期批次进入加密归档。"><span className="fixed-value">12 个月</span></SettingRow><SettingRow title="通知方式" description="工资条发布后通知员工。"><select value={settings.notificationMode} onChange={event => setSettings({ ...settings, notificationMode: event.target.value as Settings["notificationMode"] })}><option value="work_notice_with_todo">工作通知 + 待办确认</option><option value="work_notice">仅工作通知</option></select></SettingRow><SettingRow title="密码验证" description="员工进入工资条前增加额外密码验证。"><Toggle checked={settings.passwordVerification} onChange={value => setSettings({ ...settings, passwordVerification: value })} /></SettingRow><SettingRow title="发薪提醒" description="在发薪日前提醒管理员检查工资表。"><Toggle checked={settings.payrollReminder} onChange={value => setSettings({ ...settings, payrollReminder: value })} /></SettingRow><SettingRow title="仅员工展示工资条" description="工资条详情和我的页仅保留工资数据，不展示其他应用内容。"><Toggle checked={settings.employeeOnlyView} onChange={value => setSettings({ ...settings, employeeOnlyView: value })} /></SettingRow></div><div className="log-link"><Icon name="receipt" size={18} /><div><strong>操作日志</strong><span>上传、发送、撤回、导出和设置变更均会记录</span></div><span className="muted">在发薪存证中查看</span></div></section>;
}

function EmployeePage({ employeeId }: { employeeId: string | undefined }) {
  const batchId = window.location.pathname.split("/").filter(Boolean).at(-1);
  const [identity, setIdentity] = useState<Identity>();
  const [payload, setPayload] = useState<{ batch: Batch; item: SalaryItem }>();
  const [error, setError] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { ensureSession(employeeId).then(setIdentity).then(() => batchId ? api<{ batch: Batch; item: SalaryItem }>(`/v1/me/salary-slips/${batchId}`).then(setPayload) : Promise.resolve()).catch(reason => setError(errorText(reason))); }, [batchId, employeeId]);
  async function confirm() { if (!batchId) return; try { await api(`/v1/me/salary-slips/${batchId}/view`, { method: "POST" }); await api(`/v1/me/salary-slips/${batchId}/confirm`, { method: "POST" }); setConfirmed(true); if (payload) setPayload({ ...payload, item: { ...payload.item, confirmedAt: new Date().toISOString(), viewedAt: payload.item.viewedAt ?? new Date().toISOString() } }); } catch (reason) { setError(errorText(reason)); } }
  if (error) return <div className="employee-page"><FullError message={error} /></div>;
  if (!identity || !payload) return <div className="employee-page"><Loading /></div>;
  const fields = Object.entries(payload.item.fields);
  const netKey = fields.find(([key]) => key.includes("实发") || key.includes("到手"));
  return <div className="employee-page"><div className="employee-top"><span className="brand-mark"><Icon name="wallet" size={18} /></span><div><strong>工资条</strong><small>仅本人可见</small></div><span className="employee-security"><Icon name="shield" size={15} />加密</span></div><main className="employee-sheet"><div className="employee-title"><span className="eyebrow">{payload.batch.payrollMonth}</span><h1>{payload.batch.title}</h1><p>{identity.name} · {payload.item.employeeNo ?? payload.item.employeeUserId}</p></div><div className="net-card"><span>实发金额（元）</span><strong>{netKey && typeof netKey[1] === "number" ? netKey[1].toFixed(2) : "--"}</strong><small>工资信息属于个人敏感数据，请妥善保管</small></div><div className="salary-fields">{fields.map(([key, value]) => <div className="salary-field" key={key}><span>{key}</span><strong>{value === null || value === "" ? "-" : typeof value === "number" ? value.toFixed(2) : value}</strong></div>)}</div><button className={`employee-confirm ${confirmed || payload.item.confirmedAt ? "confirmed" : ""}`} onClick={confirm} disabled={Boolean(confirmed || payload.item.confirmedAt)}><Icon name="check" size={19} />{confirmed || payload.item.confirmedAt ? "已确认查看" : "确认已查看"}</button><p className="employee-footnote">本工资条通过企业内部工作通知送达，查看和确认时间将生成存证记录。</p></main></div>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "warning" }) { return <div className={`metric ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong></div>; }
function Status({ state }: { state: string }) { const label = stateLabel[state] ?? state; return <span className={`status status-${state}`}>{state === "confirmed" && <Icon name="check" size={13} />}{label}</span>; }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className="modal-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><div className="modal"><div className="modal-header"><h3>{title}</h3><button className="icon-button" onClick={onClose} aria-label="关闭">×</button></div>{children}</div></div>; }
function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) { return <label className={`field ${wide ? "span-2" : ""}`}><span>{label}</span>{children}</label>; }
function FormActions({ onClose, submitLabel = "创建工资表" }: { onClose: () => void; submitLabel?: string }) { return <div className="form-actions span-2"><button type="button" className="button secondary" onClick={onClose}>取消</button><button type="submit" className="button primary"><Icon name="check" size={16} />{submitLabel}</button></div>; }
function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) { return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div>{children}</div>; }
function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) { return <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><span /></button>; }
function Loading() { return <div className="loading"><span className="spinner" />加载中</div>; }
function EmptyState({ label, compact }: { label: string; compact?: boolean }) { return <div className={`empty ${compact ? "compact" : ""}`}>{label}</div>; }
function FullError({ message }: { message: string }) { return <div className="full-error"><Icon name="shield" size={24} /><strong>页面加载失败</strong><span>{message}</span></div>; }
function currentMonth() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatMoney(value: number) { return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function errorText(reason: unknown) {
  const error = reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "unknown_error");
  console.error("salary_ui_error", error.message);
  return error.message;
}
