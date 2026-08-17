import type { DingTalkClient } from "@salary/dingtalk";
import type { Access, SalaryBatchState, SalaryItemInput } from "@salary/domain";
import { canManageBatch, canReadEmployeeItem } from "@salary/domain";
import { fingerprintSalaryPayload, type SalaryStore } from "@salary/db";
import type { AuditService } from "../audit/service.js";
import { validateRows } from "./import.js";

export class SalaryService {
  constructor(private readonly store: SalaryStore, private readonly dingtalk: DingTalkClient, private readonly audit: AuditService, private readonly appBaseUrl: string) {}

  createDraft(actorUserId: string, input: { payrollMonth: string; title: string; rows: Record<string, unknown>[] }): { batchId?: string; errors: ReturnType<typeof validateRows>["errors"] } {
    const parsed = validateRows(input.rows);
    if (parsed.errors.length) return { errors: parsed.errors };
    const batch = this.store.createBatch({ payrollMonth: input.payrollMonth, title: input.title, createdById: actorUserId, items: parsed.items });
    this.audit.record({ correlationId: `batch:${batch.id}`, actorUserId, action: "salary_batch.create", targetType: "salary_batch", targetId: batch.id, outcome: "completed", metadata: { rowCount: parsed.items.length } });
    return { batchId: batch.id, errors: [] };
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
