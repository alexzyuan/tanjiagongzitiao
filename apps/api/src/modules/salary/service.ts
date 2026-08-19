import type { DingTalkClient } from "@salary/dingtalk";
import type { DirectoryUser } from "@salary/dingtalk";
import type {
  Access,
  SalaryBatchState,
  SalaryItemInput,
  SalarySlipDisplaySettings,
} from "@salary/domain";
import { canManageBatch } from "@salary/domain";
import {
  fingerprintSalaryPayload,
  type DeliveryRecord,
  type SalaryStore,
} from "@salary/db";
import type { AuditService } from "../audit/service.js";
import {
  previewRows,
  resolveDirectoryUser,
  validateRows,
  type EmployeeMatchStrategy,
  type ImportPreview,
  type RawRow,
} from "./import.js";

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
  private readonly inFlightItemSends = new Set<string>();

  constructor(
    private readonly store: SalaryStore,
    private readonly dingtalk: DingTalkClient,
    private readonly audit: AuditService,
    private readonly appBaseUrl: string,
  ) {}

  createDraft(
    actorUserId: string,
    input: {
      payrollMonth: string;
      title: string;
      rows: Record<string, unknown>[];
      displaySettings?: SalarySlipDisplaySettings;
    },
  ): { batchId?: string; errors: ReturnType<typeof validateRows>["errors"] } {
    if (input.displaySettings) validateDisplaySettings(input.displaySettings);
    const parsed = validateRows(input.rows);
    if (parsed.errors.length) return { errors: parsed.errors };
    const batch = this.store.createBatch({
      payrollMonth: input.payrollMonth,
      title: input.title,
      createdById: actorUserId,
      items: parsed.items,
      ...(input.displaySettings
        ? { displaySettings: input.displaySettings }
        : {}),
    });
    this.audit.record({
      correlationId: `batch:${batch.id}`,
      actorUserId,
      action: "salary_batch.create",
      targetType: "salary_batch",
      targetId: batch.id,
      outcome: "completed",
      metadata: { rowCount: parsed.items.length },
    });
    return { batchId: batch.id, errors: [] };
  }

  previewImport(
    actorUserId: string,
    input: {
      payrollMonth: string;
      title: string;
      strategy: EmployeeMatchStrategy;
      rows: RawRow[];
      directory: DirectoryUser[];
    },
  ): ImportPreviewResult {
    this.deleteExpiredImportPreviews();
    const preview = previewRows(input.rows, input.directory, input.strategy);
    const previewId = `preview-${crypto.randomUUID()}`;
    const expiresAt = Date.now() + IMPORT_PREVIEW_TTL_MS;
    this.importPreviews.set(previewId, {
      actorUserId,
      expiresAt,
      payrollMonth: input.payrollMonth,
      title: input.title,
      preview,
      directory: input.directory,
    });
    this.audit.record({
      correlationId: previewId,
      actorUserId,
      action: "salary_import.preview",
      targetType: "salary_import_preview",
      targetId: previewId,
      outcome: "completed",
      metadata: {
        strategy: input.strategy,
        parsedRows: preview.sourceRows.length,
        ignoredSummaryRows: preview.ignoredSummaryRows,
        matchedRows: preview.matched,
        unmatchedRows: preview.unmatched,
        ambiguousRows: preview.ambiguous,
      },
    });
    return {
      ...preview,
      previewId,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  commitImport(
    actorUserId: string,
    previewId: string,
    resolutions: Array<{ row: number; userId: string }>,
    displaySettings?: SalarySlipDisplaySettings,
  ): { batchId: string } {
    const stored = this.importPreviewFor(actorUserId, previewId);
    const resolutionsByRow = new Map<number, string>();
    for (const resolution of resolutions) {
      if (!stored.preview.rows.some((row) => row.row === resolution.row))
        throw new Error("salary_import_resolution_row_invalid");
      if (resolutionsByRow.has(resolution.row))
        throw new Error("salary_import_duplicate_resolution");
      resolutionsByRow.set(resolution.row, resolution.userId);
    }

    const selectedUserIds = new Set<string>();
    const rows = stored.preview.rows.map((row) => {
      const userId = resolutionsByRow.get(row.row) ?? row.user?.userId;
      if (!userId) throw new Error("salary_import_unresolved_rows");
      const user = stored.directory.find(
        (candidate) => candidate.userId === userId,
      );
      if (!user) throw new Error("salary_import_resolution_user_invalid");
      if (selectedUserIds.has(user.userId))
        throw new Error("salary_import_duplicate_employee");
      selectedUserIds.add(user.userId);
      return resolveDirectoryUser(row.source, user);
    });
    const result = this.createDraft(actorUserId, {
      payrollMonth: stored.payrollMonth,
      title: stored.title,
      rows,
      ...(displaySettings ? { displaySettings } : {}),
    });
    if (!result.batchId || result.errors.length)
      throw new Error("salary_import_commit_validation_failed");
    this.importPreviews.delete(previewId);
    this.audit.record({
      correlationId: `batch:${result.batchId}`,
      actorUserId,
      action: "salary_import.commit",
      targetType: "salary_batch",
      targetId: result.batchId,
      outcome: "completed",
      metadata: {
        previewId,
        parsedRows: stored.preview.sourceRows.length,
        ignoredSummaryRows: stored.preview.ignoredSummaryRows,
        matchedRows: stored.preview.matched,
        manualResolutions: resolutions.length,
      },
    });
    return { batchId: result.batchId };
  }

  searchPreviewDirectory(
    actorUserId: string,
    previewId: string,
    query: string,
  ): DirectoryUser[] {
    const stored = this.importPreviewFor(actorUserId, previewId);
    const needle = query.trim().toLowerCase();
    if (!needle) throw new Error("salary_import_directory_query_required");
    return stored.directory
      .filter((user) =>
        [user.userId, user.name, user.employeeNo, user.position]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(needle)),
      )
      .slice(0, 50);
  }

  async listDirectoryUsers(
    actor: Access,
    query?: string,
  ): Promise<DirectoryUser[]> {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const users = await this.dingtalk.listDirectoryUsers();
    const needle = query?.trim().toLowerCase();
    const filtered = needle
      ? users.filter((candidate) =>
          [
            candidate.userId,
            candidate.name,
            candidate.employeeNo,
            candidate.position,
          ]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(needle)),
        )
      : users;
    this.audit.record({
      correlationId: `directory:${actor.userId}`,
      actorUserId: actor.userId,
      action: "directory.users.list",
      targetType: "directory",
      targetId: "enterprise",
      outcome: "completed",
      metadata: { queryPresent: Boolean(needle), resultCount: filtered.length },
    });
    return filtered.slice(0, 100);
  }

  async assignSubAdmin(actor: Access, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const directoryUser = (await this.dingtalk.listDirectoryUsers()).find(
      (candidate) => candidate.userId === userId,
    );
    if (!directoryUser) throw new Error("directory_user_not_found");
    const subAdmins = this.store.assignSubAdmin(userId);
    this.audit.record({
      correlationId: `role:${userId}`,
      actorUserId: actor.userId,
      action: "role.sub_admin.add",
      targetType: "user",
      targetId: userId,
      outcome: "completed",
      metadata: { name: directoryUser.name },
    });
    return subAdmins;
  }

  listSubAdmins() {
    return this.store.listSubAdmins();
  }

  createTemplate(
    actor: Access,
    input: { name: string; settings: SalarySlipDisplaySettings },
  ) {
    if (actor.kind !== "main_admin") throw new Error("salary_admin_required");
    validateDisplaySettings(input.settings);
    const template = this.store.createSalaryTemplate(input);
    this.audit.record({
      correlationId: `template:${template.id}`,
      actorUserId: actor.userId,
      action: "salary_template.create",
      targetType: "salary_template",
      targetId: template.id,
      outcome: "completed",
      metadata: {
        name: template.name,
        fields: template.settings.visibleFields.length,
      },
    });
    return template;
  }

  listTemplates() {
    return this.store.listSalaryTemplates();
  }

  removeSubAdmin(actor: Access, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const subAdmins = this.store.removeSubAdmin(userId);
    this.audit.record({
      correlationId: `role:${userId}`,
      actorUserId: actor.userId,
      action: "role.sub_admin.remove",
      targetType: "user",
      targetId: userId,
      outcome: "completed",
    });
    return subAdmins;
  }

  list(access: Access) {
    const batches = this.store.listBatchSummaries();
    if (access.kind === "main_admin") return batches;
    if (access.kind === "batch_admin" || access.kind === "sub_admin")
      return batches.filter(
        (batch) =>
          batch.state !== "archived" && access.batchIds.includes(batch.id),
      );
    return [];
  }

  listEmployeeSlips(access: Access, now = new Date()) {
    if (access.kind !== "employee")
      throw new Error("employee_identity_required");
    return this.store
      .listBatches()
      .flatMap((batch) => {
        try {
          const employeeSlip = this.employeeAccessibleSlip(
            batch.id,
            access.userId,
            now,
          );
          return [employeeSlipResponse(employeeSlip.batch, employeeSlip.item)];
        } catch (error) {
          if (
            error instanceof Error &&
            [
              "salary_item_not_found",
              "salary_item_archived",
              "salary_item_withdrawn",
            ].some((code) => error.message.startsWith(code))
          )
            return [];
          throw error;
        }
      });
  }

  getBatch(access: Access, batchId: string) {
    if (!canManageBatch(access, batchId))
      throw new Error("salary_batch_access_denied");
    const batch = this.store.getBatch(batchId);
    if (batch.state === "archived" && access.kind !== "main_admin")
      throw new Error("salary_archive_access_denied");
    return this.withDeliveryStatus(batch);
  }

  assignAdmin(actor: Access, batchId: string, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const batch = this.store.assignAdmin(batchId, userId);
    this.audit.record({
      correlationId: `batch:${batchId}`,
      actorUserId: actor.userId,
      action: "salary_batch.assign_admin",
      targetType: "salary_batch",
      targetId: batchId,
      outcome: "completed",
      metadata: { userId },
    });
    return batch;
  }

  removeAdmin(actor: Access, batchId: string, userId: string) {
    if (actor.kind !== "main_admin") throw new Error("main_admin_required");
    const batch = this.store.removeAdmin(batchId, userId);
    this.audit.record({
      correlationId: `batch:${batchId}`,
      actorUserId: actor.userId,
      action: "salary_batch.remove_admin",
      targetType: "salary_batch",
      targetId: batchId,
      outcome: "completed",
      metadata: { userId },
    });
    return batch;
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
    const alreadyDelivered = this.store
      .listDeliveries(batchId)
      .some(
        (delivery) =>
          delivery.employeeUserId === item.employeeUserId &&
          delivery.status === "delivered",
      );
    if (alreadyDelivered) throw new Error("salary_item_already_sent");
    const latestDelivery = this.store
      .listDeliveries(batchId)
      .filter((delivery) => delivery.employeeUserId === item.employeeUserId)
      .at(-1);
    if (latestDelivery?.status === "withdrawn")
      throw new Error("salary_item_withdrawn");
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
      const deliveredCount = deliveredEmployees.size;
      let finalBatch = updated;
      if (deliveredCount === updated.total && updated.state !== "sent") {
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

  readEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee")
      throw new Error("employee_identity_required");
    const employeeSlip = this.employeeAccessibleSlip(
      batchId,
      access.userId,
    );
    return employeeSlipResponse(employeeSlip.batch, employeeSlip.item);
  }

  viewEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee")
      throw new Error("employee_identity_required");
    const employeeSlip = this.employeeAccessibleSlip(
      batchId,
      access.userId,
    );
    const item = this.store.markViewed(batchId, access.userId);
    this.store.recordEvidence({
      batchId,
      employeeUserId: access.userId,
      eventType: "viewed",
      fingerprint: salarySlipFingerprint(employeeSlip.batch, item),
      metadata: {},
    });
    this.audit.record({
      correlationId: `item:${item.id}`,
      actorUserId: access.userId,
      action: "salary_item.view",
      targetType: "salary_item",
      targetId: item.id,
      outcome: "completed",
    });
    return employeeVisibleItem(item, employeeSlip.batch.displaySettings);
  }

  confirmEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee")
      throw new Error("employee_identity_required");
    const employeeSlip = this.employeeAccessibleSlip(
      batchId,
      access.userId,
    );
    if (!employeeSlip.batch.displaySettings.confirmationEnabled)
      throw new Error("salary_confirmation_disabled");
    const item = this.store.markConfirmed(batchId, access.userId);
    this.store.recordEvidence({
      batchId,
      employeeUserId: access.userId,
      eventType: "confirmed",
      fingerprint: salarySlipFingerprint(employeeSlip.batch, item),
      metadata: {},
    });
    this.audit.record({
      correlationId: `item:${item.id}`,
      actorUserId: access.userId,
      action: "salary_item.confirm",
      targetType: "salary_item",
      targetId: item.id,
      outcome: "completed",
    });
    return employeeVisibleItem(item, employeeSlip.batch.displaySettings);
  }

  private async deliver(
    actorUserId: string,
    batchId: string,
    mode: "initial" | "retry" = "initial",
  ) {
    const existing = this.store.getBatch(batchId);
    const from: SalaryBatchState = existing.state;
    if (
      !["draft", "scheduled", "sent", "partially_failed"].includes(from)
    )
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
      return delivery?.status === "delivered" || delivery?.status === "withdrawn";
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

  private importPreviewFor(
    actorUserId: string,
    previewId: string,
  ): StoredImportPreview {
    this.deleteExpiredImportPreviews();
    const stored = this.importPreviews.get(previewId);
    if (!stored || stored.actorUserId !== actorUserId)
      throw new Error("salary_import_preview_not_found");
    return stored;
  }

  private withDeliveryStatus(batch: ReturnType<SalaryStore["getBatch"]>) {
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

  private employeeAccessibleSlip(
    batchId: string,
    employeeUserId: string,
    now = new Date(),
  ) {
    const batch = this.store.getBatch(batchId);
    if (
      batch.state === "archived" ||
      batch.payrollMonth <
        visibleCutoffMonth(
          now,
          this.store.getSettings().employeeVisibilityMonths,
        )
    )
      throw new Error("salary_item_archived");
    if (batch.state === "withdrawn")
      throw new Error("salary_item_withdrawn");
    const item = this.store.getEmployeeItem(batchId, employeeUserId);
    const latestDelivery = this.store
      .listDeliveries(batchId)
      .filter((delivery) => delivery.employeeUserId === employeeUserId)
      .at(-1);
    if (latestDelivery?.status === "withdrawn")
      throw new Error("salary_item_withdrawn");
    return { batch, item };
  }

  private deleteExpiredImportPreviews(): void {
    const now = Date.now();
    for (const [previewId, preview] of this.importPreviews)
      if (preview.expiresAt <= now) this.importPreviews.delete(previewId);
  }
}

function validateDisplaySettings(settings: SalarySlipDisplaySettings): void {
  if (settings.visibleFields.length === 0)
    throw new Error("salary_visible_fields_required");
  if (!settings.visibleFields.includes(settings.netAmountField))
    throw new Error("salary_net_amount_field_must_be_visible");
}

function employeeSlipResponse(
  batch: ReturnType<SalaryStore["getBatch"]>,
  item: ReturnType<SalaryStore["getEmployeeItem"]>,
) {
  return {
    batch: employeeBatchSummary(batch),
    item: employeeVisibleItem(item, batch.displaySettings),
  };
}

function employeeBatchSummary(batch: ReturnType<SalaryStore["getBatch"]>) {
  const { items: _items, ...value } = batch;
  return value;
}

function employeeVisibleItem(
  item: ReturnType<SalaryStore["getEmployeeItem"]>,
  settings: SalarySlipDisplaySettings,
) {
  const fields =
    settings.visibleFields.length === 0
      ? item.fields
      : Object.fromEntries(
          Object.entries(item.fields).filter(([key]) =>
            settings.visibleFields.includes(key),
          ),
        );
  return { ...item, fields };
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

function visibleCutoffMonth(now: Date, months: number): string {
  if (!Number.isInteger(months) || months < 1)
    throw new Error("employee_visibility_months_invalid");
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
  );
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
