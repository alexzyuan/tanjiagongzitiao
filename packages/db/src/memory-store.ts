import { randomUUID } from "node:crypto";
import type {
  SalaryBatchState,
  SalaryBatchSummary,
  SalaryItemInput,
  SalarySlipDisplaySettings,
  SalarySlipTemplate,
} from "@salary/domain";
import {
  assertTransition,
  defaultSalarySlipDisplaySettings,
} from "@salary/domain";
import {
  decryptSalaryPayload,
  encryptSalaryPayload,
  type EncryptedPayload,
} from "./crypto.js";
import type {
  AppSettings,
  AuditRecord,
  DeliveryRecord,
  PaymentEvidenceRecord,
  SalaryStore,
  StoredBatch,
  StoredEmployeeEvidenceData,
  StoredEmployeeEvidenceSummary,
  StoredItem,
  StoredItemMetadata,
} from "./store.js";

interface StoredEncryptedItem extends Omit<StoredItem, "fields"> {
  encryptedFields: EncryptedPayload;
}

interface StoredEncryptedBatch extends Omit<StoredBatch, "items"> {
  items: StoredEncryptedItem[];
}

export class MemorySalaryStore implements SalaryStore {
  private readonly batches = new Map<string, StoredEncryptedBatch>();
  private readonly audits: AuditRecord[] = [];
  private readonly deliveries: DeliveryRecord[] = [];
  private readonly evidence: PaymentEvidenceRecord[] = [];
  private readonly subAdminIds = new Set<string>();
  private readonly salaryTemplates: SalarySlipTemplate[] = [];
  private readonly settings: AppSettings = {
    employeeVisibilityMonths: 12,
  };

  constructor(private readonly encryptionKey: Buffer) {
    if (encryptionKey.length !== 32)
      throw new Error("salary_encryption_key_must_be_32_bytes");
  }

  createBatch(input: {
    payrollMonth: string;
    title: string;
    createdById: string;
    items: SalaryItemInput[];
    displaySettings?: SalarySlipDisplaySettings;
  }): StoredBatch {
    const id = `batch-${randomUUID()}`;
    const batch: StoredEncryptedBatch = {
      id,
      payrollMonth: input.payrollMonth,
      title: input.title,
      state: "draft",
      total: input.items.length,
      sent: 0,
      viewed: 0,
      confirmed: 0,
      assignedAdminIds: [],
      createdById: input.createdById,
      displaySettings: {
        ...defaultSalarySlipDisplaySettings,
        ...input.displaySettings,
      },
      items: input.items.map((item) => {
        const { fields, ...metadata } = item;
        return {
          ...metadata,
          id: randomUUID(),
          batchId: id,
          encryptedFields: encryptSalaryPayload(fields, this.encryptionKey),
        };
      }),
      createdAt: new Date().toISOString(),
    };
    this.batches.set(id, batch);
    return this.publicBatch(batch);
  }

  listBatches(): StoredBatch[] {
    return [...this.batches.values()].map((batch) => this.publicBatch(batch));
  }

  listBatchSummaries(): SalaryBatchSummary[] {
    return [...this.batches.values()].map(({ items: _items, ...batch }) =>
      structuredClone(batch),
    );
  }

  listBatchItemMetadata(batchId: string): StoredItemMetadata[] {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`salary_batch_not_found:${batchId}`);
    return batch.items.map((item) => {
      const metadata: StoredItemMetadata = {
        id: item.id,
        batchId: item.batchId,
        employeeUserId: item.employeeUserId,
        employeeName: item.employeeName,
        ...(item.employeeNo ? { employeeNo: item.employeeNo } : {}),
        ...(item.department ? { department: item.department } : {}),
        ...(item.position ? { position: item.position } : {}),
        ...(item.viewedAt ? { viewedAt: item.viewedAt } : {}),
        ...(item.confirmedAt ? { confirmedAt: item.confirmedAt } : {}),
      };
      return structuredClone(metadata);
    });
  }

  listEmployeeEvidenceSummaries(
    batchIds: string[],
  ): StoredEmployeeEvidenceSummary[] {
    const allowedBatchIds = new Set(batchIds);
    const activeItemKeys = new Set(
      [...this.deliveries, ...this.evidence].map(
        (event) => `${event.batchId}:${event.employeeUserId}`,
      ),
    );
    const employees = new Map<string, StoredEmployeeEvidenceSummary>();
    for (const batchId of allowedBatchIds) {
      const batch = this.batches.get(batchId);
      if (!batch) throw new Error(`salary_batch_not_found:${batchId}`);
      for (const item of batch.items) {
        if (!activeItemKeys.has(`${batchId}:${item.employeeUserId}`)) continue;
        const previous = employees.get(item.employeeUserId);
        employees.set(item.employeeUserId, {
          ...(previous ?? {
            employeeUserId: item.employeeUserId,
            employeeName: item.employeeName,
            ...(item.employeeNo ? { employeeNo: item.employeeNo } : {}),
            ...(item.department ? { department: item.department } : {}),
            ...(item.position ? { position: item.position } : {}),
            evidenceCount: 0,
          }),
          evidenceCount: (previous?.evidenceCount ?? 0) + 1,
        });
      }
    }
    for (const event of this.evidence) {
      if (!allowedBatchIds.has(event.batchId)) continue;
      const employee = employees.get(event.employeeUserId);
      if (!employee) continue;
      const latestEvidenceAt = latestTimestamp(
        employee.latestEvidenceAt,
        event.createdAt,
      );
      if (latestEvidenceAt) employee.latestEvidenceAt = latestEvidenceAt;
    }
    return structuredClone([...employees.values()]);
  }

  listEmployeeEvidenceData(
    batchIds: string[],
    employeeUserId: string,
  ): StoredEmployeeEvidenceData[] {
    const result: StoredEmployeeEvidenceData[] = [];
    for (const batchId of batchIds) {
      const batch = this.batches.get(batchId);
      if (!batch) throw new Error(`salary_batch_not_found:${batchId}`);
      const item = batch.items.find(
        (candidate) => candidate.employeeUserId === employeeUserId,
      );
      if (!item) continue;
      const deliveries = this.deliveries.filter(
        (delivery) =>
          delivery.batchId === batchId &&
          delivery.employeeUserId === employeeUserId,
      );
      const evidence = this.evidence.filter(
        (event) =>
          event.batchId === batchId &&
          event.employeeUserId === employeeUserId,
      );
      if (deliveries.length === 0 && evidence.length === 0) continue;
      result.push({
        batchId,
        item: this.itemMetadata(item),
        deliveries,
        evidence,
      });
    }
    return structuredClone(result);
  }

  getBatchSummary(id: string): SalaryBatchSummary {
    const batch = this.batches.get(id);
    if (!batch) throw new Error(`salary_batch_not_found:${id}`);
    const { items: _items, ...summary } = batch;
    return structuredClone(summary);
  }

  getBatch(id: string): StoredBatch {
    const batch = this.batches.get(id);
    if (!batch) throw new Error(`salary_batch_not_found:${id}`);
    return this.publicBatch(batch);
  }

  deleteBatch(id: string): void {
    if (!this.batches.delete(id))
      throw new Error(`salary_batch_not_found:${id}`);
    for (let index = this.deliveries.length - 1; index >= 0; index -= 1)
      if (this.deliveries[index]?.batchId === id) this.deliveries.splice(index, 1);
    for (let index = this.evidence.length - 1; index >= 0; index -= 1)
      if (this.evidence[index]?.batchId === id) this.evidence.splice(index, 1);
  }

  updateItemFields(
    batchId: string,
    itemId: string,
    fields: SalaryItemInput["fields"],
  ): StoredItem {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`salary_batch_not_found:${batchId}`);
    const item = batch.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("salary_item_not_found");
    item.encryptedFields = encryptSalaryPayload(fields, this.encryptionKey);
    return this.publicItem(item);
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
      .filter(
        (batch) =>
          batch.state === "scheduled" &&
          batch.scheduledAt &&
          new Date(batch.scheduledAt).getTime() <= now.getTime(),
      )
      .map((batch) => batch.id);
  }

  assignAdmin(id: string, userId: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    if (!current.assignedAdminIds.includes(userId))
      current.assignedAdminIds.push(userId);
    return this.publicBatch(current);
  }

  removeAdmin(id: string, userId: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    if (!current.assignedAdminIds.includes(userId))
      throw new Error("salary_batch_admin_not_found");
    current.assignedAdminIds = current.assignedAdminIds.filter(
      (candidate) => candidate !== userId,
    );
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

  listSubAdmins(): string[] {
    return [...this.subAdminIds].sort();
  }

  markSent(id: string, employeeUserId: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(
      (candidate) => candidate.employeeUserId === employeeUserId,
    );
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    const alreadyDelivered = this.deliveries.some(
      (delivery) =>
        delivery.batchId === id &&
        delivery.employeeUserId === employeeUserId &&
        delivery.status === "delivered",
    );
    current.sent = Math.min(
      current.total,
      current.sent + (alreadyDelivered ? 0 : 1),
    );
    return this.publicBatch(current);
  }

  markViewed(id: string, employeeUserId: string): StoredItem {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(
      (candidate) => candidate.employeeUserId === employeeUserId,
    );
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (!item.viewedAt) {
      item.viewedAt = new Date().toISOString();
      current.viewed += 1;
    }
    return this.publicItem(item);
  }

  markConfirmed(id: string, employeeUserId: string): StoredItem {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(
      (candidate) => candidate.employeeUserId === employeeUserId,
    );
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (!item.confirmedAt) {
      item.confirmedAt = new Date().toISOString();
      current.confirmed += 1;
    }
    return this.publicItem(item);
  }

  clearItemInteractions(id: string, employeeUserId: string): StoredItem {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    const item = current.items.find(
      (candidate) => candidate.employeeUserId === employeeUserId,
    );
    if (!item) throw new Error(`salary_item_not_found:${employeeUserId}`);
    if (item.viewedAt) {
      delete item.viewedAt;
      current.viewed = Math.max(0, current.viewed - 1);
    }
    if (item.confirmedAt) {
      delete item.confirmedAt;
      current.confirmed = Math.max(0, current.confirmed - 1);
    }
    return this.publicItem(item);
  }

  clearBatchInteractions(id: string): StoredBatch {
    const current = this.batches.get(id);
    if (!current) throw new Error(`salary_batch_not_found:${id}`);
    for (const item of current.items) {
      delete item.viewedAt;
      delete item.confirmedAt;
    }
    current.viewed = 0;
    current.confirmed = 0;
    return this.publicBatch(current);
  }

  getEmployeeItem(
    id: string,
    employeeUserId: string,
    options: { includeArchived?: boolean } = {},
  ): StoredItem {
    const batch = this.batches.get(id);
    if (!batch) throw new Error(`salary_batch_not_found:${id}`);
    if (batch.state === "archived" && !options.includeArchived)
      throw new Error("salary_item_archived");
    const item = batch.items.find(
      (candidate) => candidate.employeeUserId === employeeUserId,
    );
    if (!item) throw new Error("salary_item_not_found");
    return this.publicItem(item);
  }

  recordAudit(input: Omit<AuditRecord, "id" | "createdAt">): AuditRecord {
    const record = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.audits.push(record);
    return structuredClone(record);
  }

  listAudits(): AuditRecord[] {
    return structuredClone(this.audits);
  }

  recordDelivery(
    input: Omit<DeliveryRecord, "id" | "createdAt">,
  ): DeliveryRecord {
    const record = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.deliveries.push(record);
    return structuredClone(record);
  }

  listDeliveries(batchId?: string): DeliveryRecord[] {
    return structuredClone(
      batchId
        ? this.deliveries.filter((event) => event.batchId === batchId)
        : this.deliveries,
    );
  }

  recordEvidence(
    input: Omit<PaymentEvidenceRecord, "id" | "createdAt">,
  ): PaymentEvidenceRecord {
    const record = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.evidence.push(record);
    return structuredClone(record);
  }

  listEvidence(batchId?: string): PaymentEvidenceRecord[] {
    return structuredClone(
      batchId
        ? this.evidence.filter((event) => event.batchId === batchId)
        : this.evidence,
    );
  }

  archiveExpired(cutoffPayrollMonth: string): string[] {
    const archived: string[] = [];
    for (const batch of this.batches.values()) {
      if (
        batch.payrollMonth >= cutoffPayrollMonth ||
        !["sent", "partially_failed", "withdrawn"].includes(batch.state)
      )
        continue;
      assertTransition(batch.state, "archived");
      batch.state = "archived";
      batch.archivedAt = new Date().toISOString();
      archived.push(batch.id);
    }
    return archived;
  }

  getSettings(): AppSettings {
    return structuredClone(this.settings);
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    Object.assign(this.settings, patch);
    return this.getSettings();
  }

  createSalaryTemplate(input: {
    name: string;
    settings: SalarySlipDisplaySettings;
  }): SalarySlipTemplate {
    const template = {
      id: randomUUID(),
      name: input.name,
      settings: structuredClone(input.settings),
      createdAt: new Date().toISOString(),
    };
    this.salaryTemplates.push(template);
    return structuredClone(template);
  }

  listSalaryTemplates(): SalarySlipTemplate[] {
    return structuredClone(this.salaryTemplates);
  }

  private publicBatch(batch: StoredEncryptedBatch): StoredBatch {
    return {
      ...structuredClone(batch),
      items: batch.items.map((item) => this.publicItem(item)),
    };
  }

  private publicItem(item: StoredEncryptedItem): StoredItem {
    const { encryptedFields, ...metadata } = item;
    return {
      ...structuredClone(metadata),
      fields: decryptSalaryPayload(
        encryptedFields,
        this.encryptionKey,
      ) as StoredItem["fields"],
    };
  }

  private itemMetadata(item: StoredEncryptedItem): StoredItemMetadata {
    return {
      id: item.id,
      batchId: item.batchId,
      employeeUserId: item.employeeUserId,
      employeeName: item.employeeName,
      ...(item.employeeNo ? { employeeNo: item.employeeNo } : {}),
      ...(item.department ? { department: item.department } : {}),
      ...(item.position ? { position: item.position } : {}),
      ...(item.viewedAt ? { viewedAt: item.viewedAt } : {}),
      ...(item.confirmedAt ? { confirmedAt: item.confirmedAt } : {}),
    };
  }
}

function latestTimestamp(current: string | undefined, candidate: string): string {
  return current && current > candidate ? current : candidate;
}
