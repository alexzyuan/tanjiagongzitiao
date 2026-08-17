import type { DingTalkClient } from "@salary/dingtalk";
import type { DirectoryUser } from "@salary/dingtalk";
import type { Access, SalaryBatchState, SalaryItemInput } from "@salary/domain";
import { canManageBatch, canReadEmployeeItem } from "@salary/domain";
import { fingerprintSalaryPayload, type SalaryStore } from "@salary/db";
import type { AuditService } from "../audit/service.js";
import { previewRows, resolveDirectoryUser, validateRows, type EmployeeMatchStrategy, type ImportPreview, type RawRow } from "./import.js";

const IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;

interface StoredImportPreview {
  actorUserId: string;
  expiresAt: number;
  payrollMonth: string;
  title: string;
  preview: ImportPreview;
  directory: DirectoryUser[];
}

export interface ImportPreviewResult extends ImportPreview {
  previewId: string;
  expiresAt: string;
}

export class SalaryService {
  private readonly importPreviews = new Map<string, StoredImportPreview>();

  constructor(private readonly store: SalaryStore, private readonly dingtalk: DingTalkClient, private readonly audit: AuditService, private readonly appBaseUrl: string) {}

  createDraft(actorUserId: string, input: { payrollMonth: string; title: string; rows: Record<string, unknown>[] }): { batchId?: string; errors: ReturnType<typeof validateRows>["errors"] } {
    const parsed = validateRows(input.rows);
    if (parsed.errors.length) return { errors: parsed.errors };
    const batch = this.store.createBatch({ payrollMonth: input.payrollMonth, title: input.title, createdById: actorUserId, items: parsed.items });
    this.audit.record({ correlationId: `batch:${batch.id}`, actorUserId, action: "salary_batch.create", targetType: "salary_batch", targetId: batch.id, outcome: "completed", metadata: { rowCount: parsed.items.length } });
    return { batchId: batch.id, errors: [] };
  }

  previewImport(actorUserId: string, input: { payrollMonth: string; title: string; strategy: EmployeeMatchStrategy; rows: RawRow[]; directory: DirectoryUser[] }): ImportPreviewResult {
    this.deleteExpiredImportPreviews();
    const preview = previewRows(input.rows, input.directory, input.strategy);
    const previewId = `preview-${crypto.randomUUID()}`;
    const expiresAt = Date.now() + IMPORT_PREVIEW_TTL_MS;
    this.importPreviews.set(previewId, { actorUserId, expiresAt, payrollMonth: input.payrollMonth, title: input.title, preview, directory: input.directory });
    this.audit.record({
      correlationId: previewId,
      actorUserId,
      action: "salary_import.preview",
      targetType: "salary_import_preview",
      targetId: previewId,
      outcome: "completed",
      metadata: { strategy: input.strategy, rows: preview.rows.length, matched: preview.matched, unmatched: preview.unmatched, ambiguous: preview.ambiguous }
    });
    return { ...preview, previewId, expiresAt: new Date(expiresAt).toISOString() };
  }

  commitImport(actorUserId: string, previewId: string, resolutions: Array<{ row: number; userId: string }>): { batchId: string } {
    const stored = this.importPreviewFor(actorUserId, previewId);
    const resolutionsByRow = new Map<number, string>();
    for (const resolution of resolutions) {
      if (!stored.preview.rows.some(row => row.row === resolution.row)) throw new Error("salary_import_resolution_row_invalid");
      if (resolutionsByRow.has(resolution.row)) throw new Error("salary_import_duplicate_resolution");
      resolutionsByRow.set(resolution.row, resolution.userId);
    }

    const selectedUserIds = new Set<string>();
    const rows = stored.preview.rows.map(row => {
      const userId = resolutionsByRow.get(row.row) ?? row.user?.userId;
      if (!userId) throw new Error("salary_import_unresolved_rows");
      const user = stored.directory.find(candidate => candidate.userId === userId);
      if (!user) throw new Error("salary_import_resolution_user_invalid");
      if (selectedUserIds.has(user.userId)) throw new Error("salary_import_duplicate_employee");
      selectedUserIds.add(user.userId);
      return resolveDirectoryUser(row.source, user);
    });
    const result = this.createDraft(actorUserId, { payrollMonth: stored.payrollMonth, title: stored.title, rows });
    if (!result.batchId || result.errors.length) throw new Error("salary_import_commit_validation_failed");
    this.importPreviews.delete(previewId);
    this.audit.record({
      correlationId: `batch:${result.batchId}`,
      actorUserId,
      action: "salary_import.commit",
      targetType: "salary_batch",
      targetId: result.batchId,
      outcome: "completed",
      metadata: { previewId, rowCount: rows.length, manualResolutions: resolutions.length }
    });
    return { batchId: result.batchId };
  }

  searchPreviewDirectory(actorUserId: string, previewId: string, query: string): DirectoryUser[] {
    const stored = this.importPreviewFor(actorUserId, previewId);
    const needle = query.trim().toLowerCase();
    if (!needle) throw new Error("salary_import_directory_query_required");
    return stored.directory.filter(user => [user.userId, user.name, user.employeeNo, user.position].filter(Boolean).some(value => value?.toLowerCase().includes(needle))).slice(0, 50);
  }

  assignSubAdmin(actor: Access, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const subAdmins = this.store.assignSubAdmin(userId);
    this.audit.record({ correlationId: `role:${userId}`, actorUserId: actor.userId, action: "role.sub_admin.add", targetType: "user", targetId: userId, outcome: "completed" });
    return subAdmins;
  }

  listSubAdmins() {
    return this.store.listSubAdmins();
  }

  removeSubAdmin(actor: Access, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const subAdmins = this.store.removeSubAdmin(userId);
    this.audit.record({ correlationId: `role:${userId}`, actorUserId: actor.userId, action: "role.sub_admin.remove", targetType: "user", targetId: userId, outcome: "completed" });
    return subAdmins;
  }

  list(access: Access) {
    const batches = this.store.listBatches();
    if (access.kind === "main_admin") return batches;
    if (access.kind === "batch_admin" || access.kind === "sub_admin") return batches.filter(batch => batch.state !== "archived" && access.batchIds.includes(batch.id));
    return [];
  }

  listEmployeeSlips(access: Access, now = new Date()) {
    if (access.kind !== "employee") throw new Error("employee_identity_required");
    const cutoff = visibleCutoffMonth(now, this.store.getSettings().employeeVisibilityMonths);
    return this.store.listBatches()
      .filter(batch => batch.state !== "archived" && batch.payrollMonth >= cutoff)
      .flatMap(batch => {
        try {
          const item = this.store.getEmployeeItem(batch.id, access.userId);
          return [{ batch: summary(batch), item }];
        } catch (error) {
          if (error instanceof Error && error.message === "salary_item_not_found") return [];
          throw error;
        }
      });
  }

  getBatch(access: Access, batchId: string) {
    if (!canManageBatch(access, batchId)) throw new Error("salary_batch_access_denied");
    const batch = this.store.getBatch(batchId);
    if (batch.state === "archived" && access.kind !== "main_admin") throw new Error("salary_archive_access_denied");
    return batch;
  }

  assignAdmin(actor: Access, batchId: string, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const batch = this.store.assignAdmin(batchId, userId);
    this.audit.record({ correlationId: `batch:${batchId}`, actorUserId: actor.userId, action: "salary_batch.assign_admin", targetType: "salary_batch", targetId: batchId, outcome: "completed", metadata: { userId } });
    return batch;
  }

  removeAdmin(actor: Access, batchId: string, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const batch = this.store.removeAdmin(batchId, userId);
    this.audit.record({ correlationId: `batch:${batchId}`, actorUserId: actor.userId, action: "salary_batch.remove_admin", targetType: "salary_batch", targetId: batchId, outcome: "completed", metadata: { userId } });
    return batch;
  }

  async send(actor: Access, batchId: string, scheduledAt?: string) {
    if (!canManageBatch(actor, batchId)) throw new Error("salary_batch_access_denied");
    if (scheduledAt) {
      const batch = this.store.schedule(batchId, scheduledAt);
      this.audit.record({ correlationId: `batch:${batchId}`, actorUserId: actor.userId, action: "salary_batch.schedule", targetType: "salary_batch", targetId: batchId, outcome: "completed", metadata: { scheduledAt } });
      return { batch, scheduled: true };
    }
    return { batch: await this.deliver(actor.userId, batchId), scheduled: false };
  }

  async processScheduled(actor: Access, now = new Date()) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const processed: string[] = [];
    for (const batchId of this.store.listScheduledDue(now)) {
      await this.deliver(actor.userId, batchId);
      processed.push(batchId);
    }
    return { processedBatchIds: processed };
  }

  async resend(actor: Access, batchId: string) {
    if (!canManageBatch(actor, batchId)) throw new Error("salary_batch_access_denied");
    return { batch: await this.deliver(actor.userId, batchId), scheduled: false };
  }

  withdraw(actor: Access, batchId: string) {
    if (!canManageBatch(actor, batchId)) throw new Error("salary_batch_access_denied");
    const batch = this.store.setState(batchId, "withdrawn");
    this.audit.record({ correlationId: `batch:${batchId}`, actorUserId: actor.userId, action: "salary_batch.withdraw", targetType: "salary_batch", targetId: batchId, outcome: "completed" });
    return batch;
  }

  readEmployeeItem(access: Access, batchId: string) {
    if (access.kind === "employee") {
      const batch = this.store.getBatch(batchId);
      if (batch.state === "archived" || batch.payrollMonth < visibleCutoffMonth(new Date(), this.store.getSettings().employeeVisibilityMonths)) throw new Error("salary_item_archived");
    }
    const item = this.store.getEmployeeItem(batchId, access.kind === "employee" ? access.userId : "");
    if (!canReadEmployeeItem(access, item.employeeUserId)) throw new Error("salary_item_access_denied");
    return { batch: this.store.getBatch(batchId), item };
  }

  viewEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee") throw new Error("employee_identity_required");
    const item = this.store.markViewed(batchId, access.userId);
    this.store.recordEvidence({ batchId, employeeUserId: access.userId, eventType: "viewed", fingerprint: fingerprintSalaryPayload({ batchId, employeeUserId: access.userId, eventType: "viewed" }), metadata: {} });
    this.audit.record({ correlationId: `item:${item.id}`, actorUserId: access.userId, action: "salary_item.view", targetType: "salary_item", targetId: item.id, outcome: "completed" });
    return item;
  }

  confirmEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee") throw new Error("employee_identity_required");
    const item = this.store.markConfirmed(batchId, access.userId);
    this.store.recordEvidence({ batchId, employeeUserId: access.userId, eventType: "confirmed", fingerprint: fingerprintSalaryPayload({ batchId, employeeUserId: access.userId, eventType: "confirmed" }), metadata: {} });
    this.audit.record({ correlationId: `item:${item.id}`, actorUserId: access.userId, action: "salary_item.confirm", targetType: "salary_item", targetId: item.id, outcome: "completed" });
    return item;
  }

  private async deliver(actorUserId: string, batchId: string) {
    const existing = this.store.getBatch(batchId);
    const from: SalaryBatchState = existing.state;
    if (!["draft", "scheduled", "sent", "partially_failed", "withdrawn"].includes(from)) throw new Error(`salary_batch_not_sendable:${from}`);
    this.store.setState(batchId, "sending");
    let failures = 0;
    for (const item of existing.items) {
      try {
        const result = await this.dingtalk.sendWorkNotification({ userId: item.employeeUserId, title: `${existing.payrollMonth}工资条`, body: "请在钉钉内查看工资明细", url: `${this.appBaseUrl}/employee/salary-slips/${batchId}` });
        let todoId: string | undefined;
        if (this.store.getSettings().notificationMode === "work_notice_with_todo") {
          try {
            ({ todoId } = await this.dingtalk.createTodo({ userId: item.employeeUserId, subject: `${existing.payrollMonth}工资条待查看`, url: `${this.appBaseUrl}/employee/salary-slips/${batchId}` }));
          } catch (error) {
            const message = error instanceof Error ? error.message : "todo_creation_failed";
            this.audit.record({ correlationId: `batch:${batchId}`, actorUserId, action: "salary_item.todo", targetType: "salary_item", targetId: item.id, outcome: "failed", metadata: { error: message } });
          }
        }
        this.store.markSent(batchId, item.employeeUserId);
        this.store.recordDelivery({ batchId, employeeUserId: item.employeeUserId, status: "delivered", taskId: result.taskId });
        this.store.recordEvidence({ batchId, employeeUserId: item.employeeUserId, eventType: "notification_sent", fingerprint: fingerprintSalaryPayload({ batchId, employeeUserId: item.employeeUserId, taskId: result.taskId }), metadata: { taskId: result.taskId, todoId } });
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : "notification_failed";
        this.store.recordDelivery({ batchId, employeeUserId: item.employeeUserId, status: "failed", error: message });
        this.audit.record({ correlationId: `batch:${batchId}`, actorUserId, action: "salary_item.send", targetType: "salary_item", targetId: item.id, outcome: "failed", metadata: { error: message } });
      }
    }
    const state: SalaryBatchState = failures === 0 ? "sent" : "partially_failed";
    const batch = this.store.setState(batchId, state);
    this.audit.record({ correlationId: `batch:${batchId}`, actorUserId, action: "salary_batch.send", targetType: "salary_batch", targetId: batchId, outcome: failures === 0 ? "completed" : "failed", metadata: { total: existing.items.length, failures } });
    return batch;
  }

  private importPreviewFor(actorUserId: string, previewId: string): StoredImportPreview {
    this.deleteExpiredImportPreviews();
    const stored = this.importPreviews.get(previewId);
    if (!stored || stored.actorUserId !== actorUserId) throw new Error("salary_import_preview_not_found");
    return stored;
  }

  private deleteExpiredImportPreviews(): void {
    const now = Date.now();
    for (const [previewId, preview] of this.importPreviews) if (preview.expiresAt <= now) this.importPreviews.delete(previewId);
  }
}

function summary(batch: ReturnType<SalaryStore["getBatch"]>) {
  const { items: _items, ...value } = batch;
  return value;
}

function visibleCutoffMonth(now: Date, months: number): string {
  if (!Number.isInteger(months) || months < 1) throw new Error("employee_visibility_months_invalid");
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
