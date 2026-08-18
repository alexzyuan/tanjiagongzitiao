import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SalaryBatchState, SalaryItemInput, SalarySlipDisplaySettings } from "@salary/domain";
import { assertTransition, defaultSalarySlipDisplaySettings } from "@salary/domain";
import { decryptSalaryPayload, encryptSalaryPayload, type EncryptedPayload } from "./crypto.js";
import type { AppSettings, AuditRecord, DeliveryRecord, PaymentEvidenceRecord, SalaryStore, StoredBatch, StoredItem } from "./store.js";

const defaults: AppSettings = {
  employeeVisibilityMonths: 12,
  passwordVerification: false,
  notificationMode: "work_notice_with_todo",
  payrollReminder: false,
  employeeOnlyView: false
};

type BatchRow = {
  id: string; payroll_month: string; title: string; state: SalaryBatchState; total: number; sent: number; viewed: number; confirmed: number;
  assigned_admin_ids: string; created_by_id: string; display_settings: string; created_at: string; scheduled_at: string | null; archived_at: string | null;
};
type ItemRow = {
  id: string; batch_id: string; employee_user_id: string; employee_name: string; employee_no: string | null; department: string | null; position: string | null;
  fields_ciphertext: Buffer; fields_iv: Buffer; fields_auth_tag: Buffer; viewed_at: string | null; confirmed_at: string | null;
};

export class SqliteSalaryStore implements SalaryStore {
  private readonly db: Database.Database;

  constructor(databasePath: string, private readonly encryptionKey: Buffer) {
    if (encryptionKey.length !== 32) throw new Error("salary_encryption_key_must_be_32_bytes");
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.migrate();
  }

  close(): void { this.db.close(); }

  createBatch(input: { payrollMonth: string; title: string; createdById: string; items: SalaryItemInput[]; displaySettings?: SalarySlipDisplaySettings }): StoredBatch {
    const id = `batch-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO salary_batches (id, payroll_month, title, state, total, sent, viewed, confirmed, assigned_admin_ids, created_by_id, display_settings, created_at) VALUES (?, ?, ?, 'draft', ?, 0, 0, 0, '[]', ?, ?, ?)")
        .run(id, input.payrollMonth, input.title, input.items.length, input.createdById, JSON.stringify({ ...defaultSalarySlipDisplaySettings, ...input.displaySettings }), createdAt);
      const insert = this.db.prepare("INSERT INTO salary_items (id, batch_id, employee_user_id, employee_name, employee_no, department, position, fields_ciphertext, fields_iv, fields_auth_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      for (const item of input.items) {
        const encrypted = encryptSalaryPayload(item.fields, this.encryptionKey);
        insert.run(randomUUID(), id, item.employeeUserId, item.employeeName, item.employeeNo ?? null, item.department ?? null, item.position ?? null, encrypted.ciphertext, encrypted.iv, encrypted.authTag);
      }
    })();
    return this.getBatch(id);
  }

  listBatches(): StoredBatch[] { return (this.db.prepare("SELECT * FROM salary_batches ORDER BY payroll_month DESC, created_at DESC").all() as BatchRow[]).map(row => this.toBatch(row)); }
  getBatch(id: string): StoredBatch { return this.toBatch(this.batchRow(id)); }

  setState(id: string, state: SalaryBatchState): StoredBatch {
    const current = this.batchRow(id);
    assertTransition(current.state, state);
    this.db.prepare("UPDATE salary_batches SET state = ?, archived_at = CASE WHEN ? = 'archived' THEN ? ELSE archived_at END WHERE id = ?")
      .run(state, state, new Date().toISOString(), id);
    return this.getBatch(id);
  }

  schedule(id: string, scheduledAt: string): StoredBatch {
    const current = this.batchRow(id); assertTransition(current.state, "scheduled");
    this.db.prepare("UPDATE salary_batches SET state = 'scheduled', scheduled_at = ? WHERE id = ?").run(scheduledAt, id);
    return this.getBatch(id);
  }

  listScheduledDue(now = new Date()): string[] { return (this.db.prepare("SELECT id FROM salary_batches WHERE state = 'scheduled' AND scheduled_at <= ?").all(now.toISOString()) as { id: string }[]).map(row => row.id); }

  assignAdmin(id: string, userId: string): StoredBatch {
    const batch = this.batchRow(id); const ids = this.adminIds(batch);
    if (!ids.includes(userId)) this.db.prepare("UPDATE salary_batches SET assigned_admin_ids = ? WHERE id = ?").run(JSON.stringify([...ids, userId]), id);
    return this.getBatch(id);
  }

  removeAdmin(id: string, userId: string): StoredBatch {
    const batch = this.batchRow(id); const ids = this.adminIds(batch);
    if (!ids.includes(userId)) throw new Error("salary_batch_admin_not_found");
    this.db.prepare("UPDATE salary_batches SET assigned_admin_ids = ? WHERE id = ?").run(JSON.stringify(ids.filter(candidate => candidate !== userId)), id);
    return this.getBatch(id);
  }

  assignSubAdmin(userId: string): string[] { if (!userId.trim()) throw new Error("sub_admin_user_id_required"); this.db.prepare("INSERT OR IGNORE INTO salary_sub_admins (user_id) VALUES (?)").run(userId); return this.listSubAdmins(); }
  removeSubAdmin(userId: string): string[] { this.db.prepare("DELETE FROM salary_sub_admins WHERE user_id = ?").run(userId); return this.listSubAdmins(); }
  listSubAdmins(): string[] { return (this.db.prepare("SELECT user_id FROM salary_sub_admins ORDER BY user_id").all() as { user_id: string }[]).map(row => row.user_id); }

  markSent(id: string, employeeUserId: string): StoredBatch {
    this.db.transaction(() => { this.itemRow(id, employeeUserId); this.db.prepare("UPDATE salary_batches SET sent = sent + 1 WHERE id = ?").run(id); })();
    return this.getBatch(id);
  }

  markViewed(id: string, employeeUserId: string): StoredItem { return this.markInteraction(id, employeeUserId, "viewed"); }
  markConfirmed(id: string, employeeUserId: string): StoredItem { return this.markInteraction(id, employeeUserId, "confirmed"); }

  getEmployeeItem(id: string, employeeUserId: string): StoredItem {
    const batch = this.batchRow(id); if (batch.state === "archived") throw new Error("salary_item_archived");
    return this.toItem(this.itemRow(id, employeeUserId));
  }

  recordAudit(input: Omit<AuditRecord, "id" | "createdAt">): AuditRecord {
    const record: AuditRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.db.prepare("INSERT INTO salary_audits (id, correlation_id, actor_user_id, action, target_type, target_id, outcome, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(record.id, record.correlationId, record.actorUserId ?? null, record.action, record.targetType, record.targetId, record.outcome, JSON.stringify(record.metadata), record.createdAt);
    return record;
  }
  listAudits(): AuditRecord[] { return (this.db.prepare("SELECT * FROM salary_audits ORDER BY created_at").all() as any[]).map(row => ({ id: row.id, correlationId: row.correlation_id, actorUserId: row.actor_user_id ?? undefined, action: row.action, targetType: row.target_type, targetId: row.target_id, outcome: row.outcome, metadata: JSON.parse(row.metadata), createdAt: row.created_at })); }

  recordDelivery(input: Omit<DeliveryRecord, "id" | "createdAt">): DeliveryRecord { return this.recordEvent("salary_deliveries", input); }
  listDeliveries(batchId?: string): DeliveryRecord[] { return this.listEvents("salary_deliveries", batchId); }
  recordEvidence(input: Omit<PaymentEvidenceRecord, "id" | "createdAt">): PaymentEvidenceRecord { return this.recordEvent("salary_evidence", input); }
  listEvidence(batchId?: string): PaymentEvidenceRecord[] { return this.listEvents("salary_evidence", batchId) as PaymentEvidenceRecord[]; }

  archiveExpired(cutoffPayrollMonth: string): string[] {
    const eligible = this.db.prepare("SELECT id, state FROM salary_batches WHERE payroll_month < ? AND state IN ('sent', 'partially_failed', 'withdrawn')").all(cutoffPayrollMonth) as Pick<BatchRow, "id" | "state">[];
    this.db.transaction(() => { for (const batch of eligible) { assertTransition(batch.state, "archived"); this.db.prepare("UPDATE salary_batches SET state = 'archived', archived_at = ? WHERE id = ?").run(new Date().toISOString(), batch.id); } })();
    return eligible.map(batch => batch.id);
  }

  getSettings(): AppSettings { const row = this.db.prepare("SELECT value FROM salary_settings WHERE id = 'default'").get() as { value: string } | undefined; return { ...defaults, ...(row ? JSON.parse(row.value) : {}) }; }
  setSettings(patch: Partial<AppSettings>): AppSettings { const settings = { ...this.getSettings(), ...patch }; this.db.prepare("INSERT INTO salary_settings (id, value) VALUES ('default', ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value").run(JSON.stringify(settings)); return settings; }

  private markInteraction(batchId: string, employeeUserId: string, kind: "viewed" | "confirmed"): StoredItem {
    const row = this.itemRow(batchId, employeeUserId); const column = kind === "viewed" ? "viewed_at" : "confirmed_at";
    if (!row[column]) this.db.transaction(() => { this.db.prepare(`UPDATE salary_items SET ${column} = ? WHERE id = ?`).run(new Date().toISOString(), row.id); this.db.prepare(`UPDATE salary_batches SET ${kind} = ${kind} + 1 WHERE id = ?`).run(batchId); })();
    return this.toItem(this.itemRow(batchId, employeeUserId));
  }

  private batchRow(id: string): BatchRow { const row = this.db.prepare("SELECT * FROM salary_batches WHERE id = ?").get(id) as BatchRow | undefined; if (!row) throw new Error(`salary_batch_not_found:${id}`); return row; }
  private itemRow(batchId: string, employeeUserId: string): ItemRow { const row = this.db.prepare("SELECT * FROM salary_items WHERE batch_id = ? AND employee_user_id = ?").get(batchId, employeeUserId) as ItemRow | undefined; if (!row) throw new Error(`salary_item_not_found:${employeeUserId}`); return row; }
  private adminIds(batch: BatchRow): string[] { return JSON.parse(batch.assigned_admin_ids) as string[]; }
  private toBatch(row: BatchRow): StoredBatch { return { id: row.id, payrollMonth: row.payroll_month, title: row.title, state: row.state, total: row.total, sent: row.sent, viewed: row.viewed, confirmed: row.confirmed, assignedAdminIds: this.adminIds(row), createdById: row.created_by_id, displaySettings: { ...defaultSalarySlipDisplaySettings, ...JSON.parse(row.display_settings || "{}") }, createdAt: row.created_at, ...(row.scheduled_at ? { scheduledAt: row.scheduled_at } : {}), ...(row.archived_at ? { archivedAt: row.archived_at } : {}), items: (this.db.prepare("SELECT * FROM salary_items WHERE batch_id = ? ORDER BY id").all(row.id) as ItemRow[]).map(item => this.toItem(item)) }; }
  private toItem(row: ItemRow): StoredItem { const encrypted: EncryptedPayload = { ciphertext: row.fields_ciphertext, iv: row.fields_iv, authTag: row.fields_auth_tag }; return { id: row.id, batchId: row.batch_id, employeeUserId: row.employee_user_id, employeeName: row.employee_name, ...(row.employee_no ? { employeeNo: row.employee_no } : {}), ...(row.department ? { department: row.department } : {}), ...(row.position ? { position: row.position } : {}), ...(row.viewed_at ? { viewedAt: row.viewed_at } : {}), ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}), fields: decryptSalaryPayload(encrypted, this.encryptionKey) as StoredItem["fields"] }; }

  private recordEvent(table: "salary_deliveries" | "salary_evidence", input: any): any { const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }; if (table === "salary_deliveries") this.db.prepare("INSERT INTO salary_deliveries (id, batch_id, employee_user_id, status, task_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.id, record.batchId, record.employeeUserId, record.status, record.taskId ?? null, record.error ?? null, record.createdAt); else this.db.prepare("INSERT INTO salary_evidence (id, batch_id, employee_user_id, event_type, fingerprint, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(record.id, record.batchId, record.employeeUserId, record.eventType, record.fingerprint, JSON.stringify(record.metadata), record.createdAt); return record; }
  private listEvents(table: "salary_deliveries" | "salary_evidence", batchId?: string): any[] { const rows = this.db.prepare(`SELECT * FROM ${table}${batchId ? " WHERE batch_id = ?" : ""} ORDER BY created_at`).all(...(batchId ? [batchId] : [])) as any[]; return rows.map(row => table === "salary_deliveries" ? ({ id: row.id, batchId: row.batch_id, employeeUserId: row.employee_user_id, status: row.status, taskId: row.task_id ?? undefined, error: row.error ?? undefined, createdAt: row.created_at }) : ({ id: row.id, batchId: row.batch_id, employeeUserId: row.employee_user_id, eventType: row.event_type, fingerprint: row.fingerprint, metadata: JSON.parse(row.metadata), createdAt: row.created_at })); }

  private migrate(): void { this.db.exec(`
    CREATE TABLE IF NOT EXISTS salary_batches (id TEXT PRIMARY KEY, payroll_month TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL, total INTEGER NOT NULL, sent INTEGER NOT NULL, viewed INTEGER NOT NULL, confirmed INTEGER NOT NULL, assigned_admin_ids TEXT NOT NULL, created_by_id TEXT NOT NULL, display_settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, scheduled_at TEXT, archived_at TEXT);
    CREATE TABLE IF NOT EXISTS salary_items (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES salary_batches(id), employee_user_id TEXT NOT NULL, employee_name TEXT NOT NULL, employee_no TEXT, department TEXT, position TEXT, fields_ciphertext BLOB NOT NULL, fields_iv BLOB NOT NULL, fields_auth_tag BLOB NOT NULL, viewed_at TEXT, confirmed_at TEXT, UNIQUE(batch_id, employee_user_id));
    CREATE TABLE IF NOT EXISTS salary_sub_admins (user_id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS salary_settings (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS salary_audits (id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL, actor_user_id TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, outcome TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS salary_deliveries (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES salary_batches(id), employee_user_id TEXT NOT NULL, status TEXT NOT NULL, task_id TEXT, error TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS salary_evidence (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES salary_batches(id), employee_user_id TEXT NOT NULL, event_type TEXT NOT NULL, fingerprint TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS salary_batches_month_idx ON salary_batches(payroll_month);
    CREATE INDEX IF NOT EXISTS salary_items_employee_idx ON salary_items(employee_user_id);
  `);
    const columns = this.db.prepare("PRAGMA table_info(salary_batches)").all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === "display_settings")) {
      this.db.exec("ALTER TABLE salary_batches ADD COLUMN display_settings TEXT NOT NULL DEFAULT '{}'");
    }
  }
}
