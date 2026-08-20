import type { DingTalkClient } from "@salary/dingtalk";
import type { DirectoryUser } from "@salary/dingtalk";
import type { Access, SalarySlipDisplaySettings } from "@salary/domain";
import { canManageBatch } from "@salary/domain";
import type { SalaryStore } from "@salary/db";
import type { AuditService } from "../audit/service.js";
import { SalaryDeliveryService } from "./delivery.js";
import { SalaryEmployeeService } from "./employee.js";
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
  private readonly delivery: SalaryDeliveryService;
  private readonly employee: SalaryEmployeeService;

  constructor(
    private readonly store: SalaryStore,
    private readonly dingtalk: DingTalkClient,
    private readonly audit: AuditService,
    private readonly appBaseUrl: string,
  ) {
    this.delivery = new SalaryDeliveryService(
      store,
      dingtalk,
      audit,
      appBaseUrl,
    );
    this.employee = new SalaryEmployeeService(store, audit);
  }

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
    return this.employee.listEmployeeSlips(access, now);
  }

  getBatch(access: Access, batchId: string) {
    if (!canManageBatch(access, batchId))
      throw new Error("salary_batch_access_denied");
    const batch = this.store.getBatch(batchId);
    if (batch.state === "archived" && access.kind !== "main_admin")
      throw new Error("salary_archive_access_denied");
    return this.delivery.withDeliveryStatus(batch);
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
    return this.delivery.send(actor, batchId, scheduledAt);
  }

  async sendItem(actor: Access, batchId: string, itemId: string) {
    return this.delivery.sendItem(actor, batchId, itemId);
  }

  withdrawItem(actor: Access, batchId: string, itemId: string) {
    return this.delivery.withdrawItem(actor, batchId, itemId);
  }

  async processScheduled(actor: Access, now = new Date()) {
    return this.delivery.processScheduled(actor, now);
  }

  async resend(actor: Access, batchId: string) {
    return this.delivery.resend(actor, batchId);
  }

  withdraw(actor: Access, batchId: string) {
    return this.delivery.withdraw(actor, batchId);
  }

  readEmployeeItem(access: Access, batchId: string) {
    return this.employee.readEmployeeItem(access, batchId);
  }

  viewEmployeeItem(access: Access, batchId: string) {
    return this.employee.viewEmployeeItem(access, batchId);
  }

  confirmEmployeeItem(access: Access, batchId: string) {
    return this.employee.confirmEmployeeItem(access, batchId);
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
