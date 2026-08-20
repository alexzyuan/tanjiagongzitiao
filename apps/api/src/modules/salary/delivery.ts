import type { DingTalkClient } from "@salary/dingtalk";
import type { Access, SalaryBatchState } from "@salary/domain";
import { canManageBatch } from "@salary/domain";
import {
  fingerprintSalaryPayload,
  type DeliveryRecord,
  type SalaryStore,
} from "@salary/db";
import type { AuditService } from "../audit/service.js";

export class SalaryDeliveryService {
  private readonly inFlightItemSends = new Set<string>();

  constructor(
    private readonly store: SalaryStore,
    private readonly dingtalk: DingTalkClient,
    private readonly audit: AuditService,
    private readonly appBaseUrl: string,
  ) {}

  isItemSendInFlight(batchId: string, employeeUserId: string) {
    return this.inFlightItemSends.has(`${batchId}:${employeeUserId}`);
  }

  hasBatchSendInFlight(batchId: string) {
    const prefix = `${batchId}:`;
    return [...this.inFlightItemSends].some((key) => key.startsWith(prefix));
  }

  async send(actor: Access, batchId: string, scheduledAt?: string) {
    if (!canManageBatch(actor, batchId))
      throw new Error("salary_batch_access_denied");
    if (scheduledAt) {
      const batch = this.store.schedule(batchId, scheduledAt);
      this.audit.record({
        correlationId: `batch:${batchId}`,
        actorUserId: actor.userId,
        action: "salary_batch.schedule",
        targetType: "salary_batch",
        targetId: batchId,
        outcome: "completed",
        metadata: { scheduledAt },
      });
      return { batch, scheduled: true };
    }
    return {
      batch: await this.deliver(actor.userId, batchId),
      scheduled: false,
    };
  }

  async sendItem(actor: Access, batchId: string, itemId: string) {
    if (!canManageBatch(actor, batchId))
      throw new Error("salary_batch_access_denied");
    const batch = this.store.getBatch(batchId);
    const item = batch.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("salary_item_not_found");
    if (["archived", "sending"].includes(batch.state))
      throw new Error(`salary_item_not_sendable:${batch.state}`);
    const latestDelivery = this.store
      .listDeliveries(batchId)
      .filter((delivery) => delivery.employeeUserId === item.employeeUserId)
      .at(-1);
    if (latestDelivery?.status === "delivered")
      throw new Error("salary_item_already_sent");
    const sendKey = `${batchId}:${item.employeeUserId}`;
    if (this.inFlightItemSends.has(sendKey))
      throw new Error("salary_item_send_in_progress");
    this.inFlightItemSends.add(sendKey);
    try {
      const result = await this.dingtalk.sendWorkNotification({
        userId: item.employeeUserId,
        title: `${batch.payrollMonth}工资条`,
        body: "请在钉钉内查看工资明细",
        url: `${this.appBaseUrl}/employee/salary-slips/${batchId}`,
      });
      this.store.markSent(batchId, item.employeeUserId);
      this.store.recordDelivery({
        batchId,
        employeeUserId: item.employeeUserId,
        status: "delivered",
        taskId: result.taskId,
      });
      this.store.recordEvidence({
        batchId,
        employeeUserId: item.employeeUserId,
        eventType: "notification_sent",
        fingerprint: salarySlipFingerprint(batch, item),
        metadata: { taskId: result.taskId },
      });
      const updated = this.store.getBatch(batchId);
      const deliveredEmployees = new Set(
        this.store
          .listDeliveries(batchId)
          .filter((delivery) => delivery.status === "delivered")
          .map((delivery) => delivery.employeeUserId),
      );
      let finalBatch = updated;
      if (
        deliveredEmployees.size === updated.total &&
        updated.state !== "sent"
      ) {
        this.store.setState(batchId, "sending");
        finalBatch = this.store.setState(batchId, "sent");
      }
      this.audit.record({
        correlationId: `item:${item.id}`,
        actorUserId: actor.userId,
        action: "salary_item.send",
        targetType: "salary_item",
        targetId: item.id,
        outcome: "completed",
        metadata: { taskId: result.taskId },
      });
      return {
        batch: this.withDeliveryStatus(finalBatch),
        itemId: item.id,
        sent: true,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "notification_failed";
      this.store.recordDelivery({
        batchId,
        employeeUserId: item.employeeUserId,
        status: "failed",
        error: message,
      });
      this.audit.record({
        correlationId: `item:${item.id}`,
        actorUserId: actor.userId,
        action: "salary_item.send",
        targetType: "salary_item",
        targetId: item.id,
        outcome: "failed",
        metadata: { error: message },
      });
      throw error;
    } finally {
      this.inFlightItemSends.delete(sendKey);
    }
  }

  withdrawItem(actor: Access, batchId: string, itemId: string) {
    if (!canManageBatch(actor, batchId))
      throw new Error("salary_batch_access_denied");
    const batch = this.store.getBatch(batchId);
    const item = batch.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("salary_item_not_found");
    const delivery = this.store
      .listDeliveries(batchId)
      .filter((candidate) => candidate.employeeUserId === item.employeeUserId)
      .at(-1);
    if (!delivery || delivery.status !== "delivered")
      throw new Error("salary_item_not_withdrawable");
    this.store.recordDelivery({
      batchId,
      employeeUserId: item.employeeUserId,
      status: "withdrawn",
      ...(delivery.taskId ? { taskId: delivery.taskId } : {}),
    });
    this.store.recordEvidence({
      batchId,
      employeeUserId: item.employeeUserId,
      eventType: "withdrawn",
      fingerprint: salarySlipFingerprint(batch, item),
      metadata: delivery.taskId ? { taskId: delivery.taskId } : {},
    });
    this.audit.record({
      correlationId: `item:${item.id}`,
      actorUserId: actor.userId,
      action: "salary_item.withdraw",
      targetType: "salary_item",
      targetId: item.id,
      outcome: "completed",
      metadata: { taskId: delivery.taskId },
    });
    return this.withDeliveryStatus(this.store.getBatch(batchId));
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
    if (!canManageBatch(actor, batchId))
      throw new Error("salary_batch_access_denied");
    return {
      batch: await this.deliver(actor.userId, batchId, "retry"),
      scheduled: false,
    };
  }

  withdraw(actor: Access, batchId: string) {
    if (!canManageBatch(actor, batchId))
      throw new Error("salary_batch_access_denied");
    const batch = this.store.setState(batchId, "withdrawn");
    this.audit.record({
      correlationId: `batch:${batchId}`,
      actorUserId: actor.userId,
      action: "salary_batch.withdraw",
      targetType: "salary_batch",
      targetId: batchId,
      outcome: "completed",
    });
    return batch;
  }

  withDeliveryStatus(batch: ReturnType<SalaryStore["getBatch"]>) {
    const latestByEmployee = new Map<
      string,
      ReturnType<SalaryStore["listDeliveries"]>[number]
    >();
    for (const delivery of this.store.listDeliveries(batch.id))
      latestByEmployee.set(delivery.employeeUserId, delivery);
    return {
      ...batch,
      items: batch.items.map((item) => {
        const delivery = latestByEmployee.get(item.employeeUserId);
        return delivery ? { ...item, deliveryStatus: delivery.status } : item;
      }),
    };
  }

  private async deliver(
    actorUserId: string,
    batchId: string,
    mode: "initial" | "retry" = "initial",
  ) {
    const existing = this.store.getBatch(batchId);
    const from: SalaryBatchState = existing.state;
    if (!["draft", "scheduled", "sent", "partially_failed"].includes(from))
      throw new Error(`salary_batch_not_sendable:${from}`);
    const latestByEmployee = new Map<string, DeliveryRecord>();
    for (const delivery of this.store.listDeliveries(batchId))
      latestByEmployee.set(delivery.employeeUserId, delivery);
    const targets = existing.items.filter((item) => {
      const latest = latestByEmployee.get(item.employeeUserId);
      if (latest?.status === "delivered" || latest?.status === "withdrawn")
        return false;
      return mode === "initial" || latest?.status === "failed";
    });
    if (targets.length === 0) return this.withDeliveryStatus(existing);
    this.store.setState(batchId, "sending");
    let failures = 0;
    for (const item of targets) {
      try {
        const result = await this.dingtalk.sendWorkNotification({
          userId: item.employeeUserId,
          title: `${existing.payrollMonth}工资条`,
          body: "请在钉钉内查看工资明细",
          url: `${this.appBaseUrl}/employee/salary-slips/${batchId}`,
        });
        this.store.markSent(batchId, item.employeeUserId);
        this.store.recordDelivery({
          batchId,
          employeeUserId: item.employeeUserId,
          status: "delivered",
          taskId: result.taskId,
        });
        this.store.recordEvidence({
          batchId,
          employeeUserId: item.employeeUserId,
          eventType: "notification_sent",
          fingerprint: salarySlipFingerprint(existing, item),
          metadata: { taskId: result.taskId },
        });
      } catch (error) {
        failures += 1;
        const message =
          error instanceof Error ? error.message : "notification_failed";
        this.store.recordDelivery({
          batchId,
          employeeUserId: item.employeeUserId,
          status: "failed",
          error: message,
        });
        this.audit.record({
          correlationId: `batch:${batchId}`,
          actorUserId,
          action: "salary_item.send",
          targetType: "salary_item",
          targetId: item.id,
          outcome: "failed",
          metadata: { error: message },
        });
      }
    }
    const finalDeliveries = new Map<string, DeliveryRecord>();
    for (const delivery of this.store.listDeliveries(batchId))
      finalDeliveries.set(delivery.employeeUserId, delivery);
    const allRecipientsSettled = existing.items.every((item) => {
      const delivery = finalDeliveries.get(item.employeeUserId);
      return (
        delivery?.status === "delivered" || delivery?.status === "withdrawn"
      );
    });
    const state: SalaryBatchState =
      failures === 0 && allRecipientsSettled ? "sent" : "partially_failed";
    const batch = this.store.setState(batchId, state);
    this.audit.record({
      correlationId: `batch:${batchId}`,
      actorUserId,
      action: "salary_batch.send",
      targetType: "salary_batch",
      targetId: batchId,
      outcome: failures === 0 ? "completed" : "failed",
      metadata: { total: existing.items.length, failures },
    });
    return batch;
  }
}

function salarySlipFingerprint(
  batch: ReturnType<SalaryStore["getBatch"]>,
  item: ReturnType<SalaryStore["getEmployeeItem"]>,
) {
  return fingerprintSalaryPayload({
    schemaVersion: "salary-slip-v1",
    batchId: batch.id,
    payrollMonth: batch.payrollMonth,
    employeeUserId: item.employeeUserId,
    fields: item.fields,
    displaySettings: batch.displaySettings,
  });
}
