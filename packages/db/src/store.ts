import { randomUUID } from "node:crypto";
import type { SalaryBatchState, SalaryItemInput, SalaryBatchSummary } from "@salary/domain";
import { assertTransition } from "@salary/domain";
import { decryptSalaryPayload, encryptSalaryPayload, type EncryptedPayload } from "./crypto.js";

export interface StoredItem extends SalaryItemInput {
  id: string;
  batchId: string;
  viewedAt?: string;
  confirmedAt?: string;
}

interface StoredEncryptedItem extends Omit<StoredItem, "fields"> {
  encryptedFields: EncryptedPayload;
}

export interface AuditRecord {
  id: string;
  correlationId: string;
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: "accepted" | "completed" | "denied" | "failed";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DeliveryRecord {
  id: string;
  batchId: string;
  employeeUserId: string;
  status: "delivered" | "failed" | "withdrawn";
  taskId?: string;
  error?: string;
  createdAt: string;
}

export interface PaymentEvidenceRecord {
  id: string;
  batchId: string;
  employeeUserId: string;
  eventType: "notification_sent" | "viewed" | "confirmed" | "withdrawn";
  fingerprint: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface StoredBatch extends SalaryBatchSummary {
  items: StoredItem[];
  createdAt: string;
  scheduledAt?: string;
  archivedAt?: string;
}

interface StoredEncryptedBatch extends Omit<StoredBatch, "items"> {
  items: StoredEncryptedItem[];
}

export interface AppSettings {
  employeeVisibilityMonths: 12;
  passwordVerification: boolean;
  notificationMode: "work_notice" | "work_notice_with_todo";
  payrollReminder: boolean;
  employeeOnlyView: boolean;
}

export interface SalaryStore {
  createBatch(input: { payrollMonth: string; title: string; createdById: string; items: SalaryItemInput[] }): StoredBatch;
  listBatches(): StoredBatch[];
  getBatch(id: string): StoredBatch;
  setState(id: string, state: SalaryBatchState): StoredBatch;
  schedule(id: string, scheduledAt: string): StoredBatch;
  listScheduledDue(now?: Date): string[];
  assignAdmin(id: string, userId: string): StoredBatch;
  removeAdmin(id: string, userId: string): StoredBatch;
  assignSubAdmin(userId: string): string[];
  removeSubAdmin(userId: string): string[];
  listSubAdmins(): string[];
  markSent(id: string, employeeUserId: string): StoredBatch;
  markViewed(id: string, employeeUserId: string): StoredItem;
  markConfirmed(id: string, employeeUserId: string): StoredItem;
  getEmployeeItem(id: string, employeeUserId: string): StoredItem;
  recordAudit(input: Omit<AuditRecord, "id" | "createdAt">): AuditRecord;
  listAudits(): AuditRecord[];
  recordDelivery(input: Omit<DeliveryRecord, "id" | "createdAt">): DeliveryRecord;
  listDeliveries(batchId?: string): DeliveryRecord[];
  recordEvidence(input: Omit<PaymentEvidenceRecord, "id" | "createdAt">): PaymentEvidenceRecord;
  listEvidence(batchId?: string): PaymentEvidenceRecord[];
  archiveExpired(cutoffPayrollMonth: string): string[];
  getSettings(): AppSettings;
  setSettings(patch: Partial<AppSettings>): AppSettings;
}

export class MemorySalaryStore implements SalaryStore {
  private readonly batches = new Map<string, StoredEncryptedBatch>();
  private readonly audits: AuditRecord[] = [];
  private readonly deliveries: DeliveryRecord[] = [];
  private readonly evidence: PaymentEvidenceRecord[] = [];
  private readonly subAdminIds = new Set<string>();
  private readonly settings: AppSettings = {
    employeeVisibilityMonths: 12,
    passwordVerification: false,
    notificationMode: "work_notice_with_todo",
    payrollReminder: false,
    employeeOnlyView: false
  };

  constructor(private readonly encryptionKey: Buffer) {
    if (encryptionKey.length !== 32) throw new Error("salary_encryption_key_must_be_32_bytes");
  }

  createBatch(input: { payrollMonth: string; title: string; createdById: string; items: SalaryItemInput[] }): StoredBatch {
    const id = `batch-${randomUUID()}`;
    const batch: StoredEncryptedBatch = {
      id, payrollMonth: input.payrollMonth, title: input.title, state: "draft", total: input.items.length,
      sent: 0, viewed: 0, confirmed: 0, assignedAdminIds: [], createdById: input.createdById,
      items: input.items.map(item => {
        const { fields, ...metadata } = item;
        return { ...metadata, id: randomUUID(), batchId: id, encryptedFields: encryptSalaryPayload(fields, this.encryptionKey) };
      }), createdAt: new Date().toISOString()
    };
    this.batches.set(id, batch);
    return this.publicBatch(batch);
  }

  listBatches(): StoredBatch[] { return [...this.batches.values()].map(batch => this.publicBatch(batch)); }

  getBatch(id: string): StoredBatch {
    const batch = this.batches.get(id);
    if (!batch) throw new Error(`salary_batch_not_found:${id}`);
    return this.publicBatch(batch);
  }

  setState(id: string, state: SalaryBatchState): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    assertTransition(current.state, state);
    current.state = state;
    if (state === "archived") current.archivedAt = new Date().toISOString();
    return this.publicBatch(current);
  }

  schedule(id: string, scheduledAt: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    assertTransition(current.state, "scheduled");
    current.state = "scheduled";
    current.scheduledAt = scheduledAt;
    return this.publicBatch(current);
  }

  listScheduledDue(now = new Date()): string[] {
    return [...this.batches.values()]
      .filter(batch => batch.state === "scheduled" && batch.scheduledAt && new Date(batch.scheduledAt).getTime() <= now.getTime())
      .map(batch => batch.id);
  }

  assignAdmin(id: string, userId: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    if (!current.assignedAdminIds.includes(userId)) current.assignedAdminIds.push(userId);
    return this.publicBatch(current);
  }

  removeAdmin(id: string, userId: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    if (!current.assignedAdminIds.includes(userId)) throw new Error("salary_batch_admin_not_found");
    current.assignedAdminIds = current.assignedAdminIds.filter(candidate => candidate !== userId);
    return this.publicBatch(current);
  }

  assignSubAdmin(userId: string): string[] {
    if (!userId.trim()) throw new Error("sub_admin_user_id_required");
    this.subAdminIds.add(userId);
    return this.listSubAdmins();
  }
  removeSubAdmin(userId: string): string[] {
    this.subAdminIds.delete(userId);
    return this.listSubAdmins();
  }
  listSubAdmins(): string[] { return [...this.subAdminIds].sort(); }

  markSent(id: string, employeeUserId: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(candidate => candidate.employeeUserId === employeeUserId);
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (!item.viewedAt && !item.confirmedAt) current.sent += 1;
    return this.publicBatch(current);
  }

  markViewed(id: string, employeeUserId: string): StoredItem {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(candidate => candidate.employeeUserId === employeeUserId);
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (!item.viewedAt) { item.viewedAt = new Date().toISOString(); current.viewed += 1; }
    return this.publicItem(item);
  }

  markConfirmed(id: string, employeeUserId: string): StoredItem {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(candidate => candidate.employeeUserId === employeeUserId);
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (!item.confirmedAt) { item.confirmedAt = new Date().toISOString(); current.confirmed += 1; }
    return this.publicItem(item);
  }

  getEmployeeItem(id: string, employeeUserId: string): StoredItem {
    const batch = this.batches.get(id);
    if (!batch) throw new Error(`salary_batch_not_found:${id}`);
    if (batch.state === "archived") throw new Error("salary_item_archived");
    const item = batch.items.find(candidate => candidate.employeeUserId === employeeUserId);
    if (!item) throw new Error("salary_item_not_found");
    return this.publicItem(item);
  }

  recordAudit(input: Omit<AuditRecord, "id" | "createdAt">): AuditRecord {
    const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.audits.push(record);
    return structuredClone(record);
  }

  listAudits(): AuditRecord[] { return structuredClone(this.audits); }
  recordDelivery(input: Omit<DeliveryRecord, "id" | "createdAt">): DeliveryRecord {
    const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.deliveries.push(record);
    return structuredClone(record);
  }
  listDeliveries(batchId?: string): DeliveryRecord[] {
    return structuredClone(batchId ? this.deliveries.filter(event => event.batchId === batchId) : this.deliveries);
  }
  recordEvidence(input: Omit<PaymentEvidenceRecord, "id" | "createdAt">): PaymentEvidenceRecord {
    const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.evidence.push(record);
    return structuredClone(record);
  }
  listEvidence(batchId?: string): PaymentEvidenceRecord[] {
    return structuredClone(batchId ? this.evidence.filter(event => event.batchId === batchId) : this.evidence);
  }
  archiveExpired(cutoffPayrollMonth: string): string[] {
    const archived: string[] = [];
    for (const batch of this.batches.values()) {
      if (batch.payrollMonth >= cutoffPayrollMonth || !["sent", "partially_failed", "withdrawn"].includes(batch.state)) continue;
      assertTransition(batch.state, "archived");
      batch.state = "archived";
      batch.archivedAt = new Date().toISOString();
      archived.push(batch.id);
    }
    return archived;
  }
  getSettings(): AppSettings { return structuredClone(this.settings); }
  setSettings(patch: Partial<AppSettings>): AppSettings { Object.assign(this.settings, patch); return this.getSettings(); }

  private publicBatch(batch: StoredEncryptedBatch): StoredBatch {
    return { ...structuredClone(batch), items: batch.items.map(item => this.publicItem(item)) };
  }

  private publicItem(item: StoredEncryptedItem): StoredItem {
    const { encryptedFields, ...metadata } = item;
    return { ...structuredClone(metadata), fields: decryptSalaryPayload(encryptedFields, this.encryptionKey) as StoredItem["fields"] };
  }
}
