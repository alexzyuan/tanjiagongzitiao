import { randomUUID } from "node:crypto";
import type { SalaryBatchState, SalaryItemInput, SalaryBatchSummary } from "@salary/domain";
import { assertTransition } from "@salary/domain";

export interface StoredItem extends SalaryItemInput {
  id: string;
  batchId: string;
  viewedAt?: string;
  confirmedAt?: string;
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

export interface StoredBatch extends SalaryBatchSummary {
  items: StoredItem[];
  createdAt: string;
  scheduledAt?: string;
  archivedAt?: string;
}

export interface AppSettings {
  employeeVisibilityMonths: 12;
  passwordVerification: boolean;
  notificationMode: "work_notice" | "work_notice_with_todo";
  payrollReminder: boolean;
  employeeOnlyView: boolean;
}

export class MemorySalaryStore {
  private readonly batches = new Map<string, StoredBatch>();
  private readonly audits: AuditRecord[] = [];
  private readonly settings: AppSettings = {
    employeeVisibilityMonths: 12,
    passwordVerification: false,
    notificationMode: "work_notice_with_todo",
    payrollReminder: false,
    employeeOnlyView: false
  };

  createBatch(input: { payrollMonth: string; title: string; createdById: string; items: SalaryItemInput[] }): StoredBatch {
    const id = `batch-${randomUUID()}`;
    const batch: StoredBatch = {
      id, payrollMonth: input.payrollMonth, title: input.title, state: "draft", total: input.items.length,
      sent: 0, viewed: 0, confirmed: 0, assignedAdminIds: [], createdById: input.createdById,
      items: input.items.map(item => ({ ...item, id: randomUUID(), batchId: id })), createdAt: new Date().toISOString()
    };
    this.batches.set(id, batch);
    return structuredClone(batch);
  }

  listBatches(): StoredBatch[] { return [...this.batches.values()].map(batch => structuredClone(batch)); }

  getBatch(id: string): StoredBatch {
    const batch = this.batches.get(id);
    if (!batch) throw new Error(`salary_batch_not_found:${id}`);
    return structuredClone(batch);
  }

  setState(id: string, state: SalaryBatchState): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    assertTransition(current.state, state);
    current.state = state;
    if (state === "archived") current.archivedAt = new Date().toISOString();
    return structuredClone(current);
  }

  assignAdmin(id: string, userId: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    if (!current.assignedAdminIds.includes(userId)) current.assignedAdminIds.push(userId);
    return structuredClone(current);
  }

  markSent(id: string, employeeUserId: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(candidate => candidate.employeeUserId === employeeUserId);
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (!item.viewedAt && !item.confirmedAt) current.sent += 1;
    return structuredClone(current);
  }

  markViewed(id: string, employeeUserId: string): StoredItem {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(candidate => candidate.employeeUserId === employeeUserId);
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (!item.viewedAt) { item.viewedAt = new Date().toISOString(); current.viewed += 1; }
    return structuredClone(item);
  }

  markConfirmed(id: string, employeeUserId: string): StoredItem {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(candidate => candidate.employeeUserId === employeeUserId);
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (!item.confirmedAt) { item.confirmedAt = new Date().toISOString(); current.confirmed += 1; }
    return structuredClone(item);
  }

  getEmployeeItem(id: string, employeeUserId: string): StoredItem {
    const batch = this.getBatch(id);
    if (batch.state === "archived") throw new Error("salary_item_archived");
    const item = batch.items.find(candidate => candidate.employeeUserId === employeeUserId);
    if (!item) throw new Error("salary_item_not_found");
    return item;
  }

  recordAudit(input: Omit<AuditRecord, "id" | "createdAt">): AuditRecord {
    const record = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.audits.push(record);
    return structuredClone(record);
  }

  listAudits(): AuditRecord[] { return structuredClone(this.audits); }
  getSettings(): AppSettings { return structuredClone(this.settings); }
  setSettings(patch: Partial<AppSettings>): AppSettings { Object.assign(this.settings, patch); return this.getSettings(); }
}
