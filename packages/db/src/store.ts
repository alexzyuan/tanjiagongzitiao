import type {
  SalaryBatchState,
  SalaryItemInput,
  SalaryBatchSummary,
  SalarySlipDisplaySettings,
  SalarySlipTemplate,
} from "@salary/domain";

export interface StoredItem extends SalaryItemInput {
  id: string;
  batchId: string;
  viewedAt?: string;
  confirmedAt?: string;
  deliveryStatus?: DeliveryRecord["status"];
}

export interface StoredItemMetadata {
  id: string;
  batchId: string;
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  viewedAt?: string;
  confirmedAt?: string;
}

export interface StoredEmployeeEvidenceSummary {
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  evidenceCount: number;
  latestEvidenceAt?: string;
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

export interface AppSettings {
  employeeVisibilityMonths: 12;
}

export interface SalaryStore {
  createBatch(input: {
    payrollMonth: string;
    title: string;
    createdById: string;
    items: SalaryItemInput[];
    displaySettings?: SalarySlipDisplaySettings;
  }): StoredBatch;
  listBatches(): StoredBatch[];
  listBatchSummaries(): SalaryBatchSummary[];
  listBatchItemMetadata(batchId: string): StoredItemMetadata[];
  listEmployeeEvidenceSummaries(
    batchIds: string[],
  ): StoredEmployeeEvidenceSummary[];
  getBatchSummary(id: string): SalaryBatchSummary;
  getBatch(id: string): StoredBatch;
  deleteBatch(id: string): void;
  updateItemFields(
    batchId: string,
    itemId: string,
    fields: SalaryItemInput["fields"],
  ): StoredItem;
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
  clearItemInteractions(id: string, employeeUserId: string): StoredItem;
  clearBatchInteractions(id: string): StoredBatch;
  getEmployeeItem(id: string, employeeUserId: string): StoredItem;
  recordAudit(input: Omit<AuditRecord, "id" | "createdAt">): AuditRecord;
  listAudits(): AuditRecord[];
  recordDelivery(
    input: Omit<DeliveryRecord, "id" | "createdAt">,
  ): DeliveryRecord;
  listDeliveries(batchId?: string): DeliveryRecord[];
  recordEvidence(
    input: Omit<PaymentEvidenceRecord, "id" | "createdAt">,
  ): PaymentEvidenceRecord;
  listEvidence(batchId?: string): PaymentEvidenceRecord[];
  archiveExpired(cutoffPayrollMonth: string): string[];
  getSettings(): AppSettings;
  setSettings(patch: Partial<AppSettings>): AppSettings;
  createSalaryTemplate(input: {
    name: string;
    settings: SalarySlipDisplaySettings;
  }): SalarySlipTemplate;
  listSalaryTemplates(): SalarySlipTemplate[];
}

export { MemorySalaryStore } from "./memory-store.js";
