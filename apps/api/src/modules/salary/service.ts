import type { DingTalkClient } from "@salary/dingtalk";
import type { Access, SalaryBatchState, SalaryItemInput } from "@salary/domain";
import { canManageBatch, canReadEmployeeItem } from "@salary/domain";
import type { MemorySalaryStore } from "@salary/db";
import type { AuditService } from "../audit/service.js";
import { validateRows } from "./import.js";

export class SalaryService {
  constructor(private readonly store: MemorySalaryStore, private readonly dingtalk: DingTalkClient, private readonly audit: AuditService, private readonly appBaseUrl: string) {}

  createDraft(actorUserId: string, input: { payrollMonth: string; title: string; rows: Record<string, unknown>[] }): { batchId?: string; errors: ReturnType<typeof validateRows>["errors"] } {
    const parsed = validateRows(input.rows);
    if (parsed.errors.length) return { errors: parsed.errors };
    const batch = this.store.createBatch({ payrollMonth: input.payrollMonth, title: input.title, createdById: actorUserId, items: parsed.items });
    this.audit.record({ correlationId: `batch:${batch.id}`, actorUserId, action: "salary_batch.create", targetType: "salary_batch", targetId: batch.id, outcome: "completed", metadata: { rowCount: parsed.items.length } });
    return { batchId: batch.id, errors: [] };
  }

  list(access: Access) {
    const batches = this.store.listBatches();
    if (access.kind === "main_admin") return batches;
    if (access.kind === "batch_admin" || access.kind === "sub_admin") return batches.filter(batch => access.batchIds.includes(batch.id));
    return [];
  }

  getBatch(access: Access, batchId: string) {
    if (!canManageBatch(access, batchId)) throw new Error("salary_batch_access_denied");
    return this.store.getBatch(batchId);
  }

  assignAdmin(actor: Access, batchId: string, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const batch = this.store.assignAdmin(batchId, userId);
    this.audit.record({ correlationId: `batch:${batchId}`, actorUserId: actor.userId, action: "salary_batch.assign_admin", targetType: "salary_batch", targetId: batchId, outcome: "completed", metadata: { userId } });
    return batch;
  }

  async send(actor: Access, batchId: string, scheduledAt?: string) {
    if (!canManageBatch(actor, batchId)) throw new Error("salary_batch_access_denied");
    if (scheduledAt) {
      const batch = this.store.setState(batchId, "scheduled");
      this.audit.record({ correlationId: `batch:${batchId}`, actorUserId: actor.userId, action: "salary_batch.schedule", targetType: "salary_batch", targetId: batchId, outcome: "completed", metadata: { scheduledAt } });
      return { batch, scheduled: true };
    }
    return { batch: await this.deliver(actor.userId, batchId), scheduled: false };
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
    const item = this.store.getEmployeeItem(batchId, access.kind === "employee" ? access.userId : "");
    if (!canReadEmployeeItem(access, item.employeeUserId)) throw new Error("salary_item_access_denied");
    return { batch: this.store.getBatch(batchId), item };
  }

  viewEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee") throw new Error("employee_identity_required");
    const item = this.store.markViewed(batchId, access.userId);
    this.audit.record({ correlationId: `item:${item.id}`, actorUserId: access.userId, action: "salary_item.view", targetType: "salary_item", targetId: item.id, outcome: "completed" });
    return item;
  }

  confirmEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee") throw new Error("employee_identity_required");
    const item = this.store.markConfirmed(batchId, access.userId);
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
        this.store.markSent(batchId, item.employeeUserId);
        this.store.recordDelivery({ batchId, employeeUserId: item.employeeUserId, status: "delivered", taskId: result.taskId });
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
