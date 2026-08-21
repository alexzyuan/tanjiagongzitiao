import type { DingTalkClient } from "@salary/dingtalk";
import type {
  Access,
  SalaryBatchState,
  SalaryFieldValue,
} from "@salary/domain";
import type {
  DeliveryRecord,
  SalaryStore,
  StoredEmployeeEvidenceSummary,
  StoredItem,
  StoredItemMetadata,
} from "@salary/db";
import * as XLSX from "xlsx";
import type { AuditService } from "../audit/service.js";

export type EmploymentStatus = "active" | "departed";
export type SendStatus = "not_sent" | "sent" | "failed" | "withdrawn";
export type ViewStatus = "not_viewed" | "viewed";
export type ConfirmStatus = "not_confirmed" | "confirmed";

export interface EvidenceEmployeeSummary {
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  employmentStatus: EmploymentStatus;
  evidenceCount: number;
  latestEvidenceAt?: string;
}

export interface EvidenceFilters {
  fromMonth?: string;
  toMonth?: string;
  sendStatus?: SendStatus;
  viewStatus?: ViewStatus;
  confirmStatus?: ConfirmStatus;
}

export interface EvidenceExportInput extends EvidenceFilters {
  employeeUserId: string;
  fields: string[];
}

export interface EvidenceRow {
  batchId: string;
  itemId: string;
  payrollMonth: string;
  title: string;
  state: SalaryBatchState;
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  fields: Record<string, SalaryFieldValue>;
  sendStatus: SendStatus;
  sentAt?: string;
  withdrawnAt?: string;
  viewStatus: ViewStatus;
  viewedAt?: string;
  confirmStatus: ConfirmStatus;
  confirmedAt?: string;
  confirmedBy?: string;
}

export interface EvidenceEmployeeDetail {
  employee: EvidenceEmployeeSummary;
  rows: EvidenceRow[];
  availableFields: string[];
}

interface EvidenceCandidate {
  summary: {
    id: string;
    payrollMonth: string;
    title: string;
    state: SalaryBatchState;
  };
  metadata: StoredItemMetadata;
  status: Omit<EvidenceRow, "batchId" | "itemId" | "payrollMonth" | "title" | "state" | "employeeUserId" | "employeeName" | "employeeNo" | "department" | "position" | "fields">;
}

const FIXED_EXPORT_COLUMNS = [
  "员工姓名",
  "工号",
  "职位",
  "工资月份",
  "工资条标题",
  "发送状态",
  "查看状态",
  "确认状态",
  "确认时间",
  "确认人",
] as const;

export class EvidenceService {
  constructor(
    private readonly store: SalaryStore,
    private readonly dingtalk: Pick<DingTalkClient, "listDirectoryUsers">,
    private readonly audit: AuditService,
  ) {}

  async listEmployees(
    access: Access,
    query: { employmentStatus?: EmploymentStatus; query?: string } = {},
  ): Promise<EvidenceEmployeeSummary[]> {
    const summaries = this.visibleBatchSummaries(access);
    const employees = this.store.listEmployeeEvidenceSummaries(
      summaries.map((batch) => batch.id),
    );
    const directoryUsers = await this.dingtalk.listDirectoryUsers();
    const activeUserIds = new Set(directoryUsers.map((user) => user.userId));

    const needle = query.query?.trim().toLocaleLowerCase();
    return employees
      .map((employee) => ({
        ...employeeSummary(
          employee,
          activeUserIds.has(employee.employeeUserId),
        ),
      }))
      .filter((employee) =>
        query.employmentStatus
          ? employee.employmentStatus === query.employmentStatus
          : true,
      )
      .filter((employee) =>
        needle
          ? [employee.employeeName, employee.employeeNo, employee.position]
              .filter(Boolean)
              .some((value) => value!.toLocaleLowerCase().includes(needle))
          : true,
      )
      .sort((left, right) =>
        left.employeeName.localeCompare(right.employeeName),
      );
  }

  async getEmployeeDetail(
    access: Access,
    employeeUserId: string,
    filters: EvidenceFilters = {},
  ): Promise<EvidenceEmployeeDetail> {
    const summaries = this.visibleBatchSummaries(access);
    const directoryUsers = await this.dingtalk.listDirectoryUsers();
    const activeUserIds = new Set(directoryUsers.map((user) => user.userId));
    const candidates: EvidenceCandidate[] = [];
    let employeeMetadata: StoredItemMetadata | undefined;
    let evidenceCount = 0;
    let latestEvidenceAt: string | undefined;

    for (const summary of summaries) {
      const metadata = this.store
        .listBatchItemMetadata(summary.id)
        .find((item) => item.employeeUserId === employeeUserId);
      if (!metadata) continue;
      const evidence = this.store
        .listEvidence(summary.id)
        .filter((event) => event.employeeUserId === employeeUserId);
      const deliveries = this.store
        .listDeliveries(summary.id)
        .filter((delivery) => delivery.employeeUserId === employeeUserId);
      if (evidence.length === 0 && deliveries.length === 0) continue;
      employeeMetadata ??= metadata;
      evidenceCount += 1;
      latestEvidenceAt = latestDate(
        latestEvidenceAt,
        ...evidence.map((event) => event.createdAt),
      );
      const status = evidenceRowStatus(
        metadata,
        deliveries,
        evidence,
      );
      if (!matchesFilters(summary.payrollMonth, status, filters)) continue;
      candidates.push({
        summary: {
          id: summary.id,
          payrollMonth: summary.payrollMonth,
          title: summary.title,
          state: summary.state,
        },
        metadata,
        status,
      });
    }

    if (!employeeMetadata)
      throw new Error("salary_evidence_employee_not_found");

    const rows: EvidenceRow[] = [];
    for (const candidate of candidates) {
      const batch = this.store.getBatch(candidate.summary.id);
      const item = batch.items.find(
        (storedItem) => storedItem.id === candidate.metadata.id,
      );
      if (!item) throw new Error("salary_item_not_found");
      rows.push(toEvidenceRow(candidate.summary, item, candidate.status));
    }
    const availableFields = [
      ...new Set(rows.flatMap((row) => Object.keys(row.fields))),
    ].sort((left, right) => left.localeCompare(right));

    return {
      employee: employeeSummary(
        employeeMetadata,
        activeUserIds.has(employeeUserId),
        evidenceCount,
        latestEvidenceAt,
      ),
      rows,
      availableFields,
    };
  }

  private visibleBatchSummaries(access: Access) {
    const summaries = this.store.listBatchSummaries();
    if (access.kind === "main_admin") return summaries;
    if (access.kind === "sub_admin")
      return summaries.filter(
        (batch) =>
          batch.state !== "archived" && access.batchIds.includes(batch.id),
      );
    throw new Error("salary_admin_required");
  }

  async exportXlsx(
    access: Access,
    input: EvidenceExportInput,
  ): Promise<Buffer> {
    const { employeeUserId, fields: requestedFields, ...filters } = input;
    const fields = [...new Set(requestedFields)];
    const detail = await this.getEmployeeDetail(
      access,
      employeeUserId,
      filters,
    );
    if (detail.rows.length === 0)
      throw new Error("salary_evidence_export_empty");
    for (const field of fields) {
      if (
        FIXED_EXPORT_COLUMNS.includes(
          field as (typeof FIXED_EXPORT_COLUMNS)[number],
        ) ||
        !detail.availableFields.includes(field)
      )
        throw new Error("salary_evidence_export_field_invalid");
    }
    const rows = detail.rows.map((row) => {
      const exportRow: Record<string, string | number | null> = {
        员工姓名: row.employeeName,
        工号: row.employeeNo ?? null,
        职位: row.position ?? null,
        工资月份: row.payrollMonth,
        工资条标题: row.title,
        发送状态: sendStatusLabel(row.sendStatus),
        查看状态: viewStatusLabel(row.viewStatus),
        确认状态: confirmStatusLabel(row.confirmStatus),
        确认时间: row.confirmedAt ?? null,
        确认人: row.confirmedBy ?? null,
      };
      for (const field of fields) exportRow[field] = row.fields[field] ?? null;
      return exportRow;
    });
    const worksheet = XLSX.utils.json_to_sheet(rows, {
      header: [...FIXED_EXPORT_COLUMNS, ...fields],
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "发薪存证");
    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    }) as Buffer;
    this.audit.record({
      correlationId: `payment-evidence.export:${access.userId}:${Date.now()}`,
      actorUserId: access.userId,
      action: "payment_evidence.export",
      targetType: "payment_evidence",
      targetId: employeeUserId,
      outcome: "completed",
      metadata: {
        queryPresent: Boolean(
          filters.fromMonth ||
            filters.toMonth ||
            filters.sendStatus ||
            filters.viewStatus ||
            filters.confirmStatus,
        ),
        fieldCount: fields.length,
        rowCount: rows.length,
      },
    });
    return buffer;
  }
}

function employeeSummary(
  metadata: StoredEmployeeEvidenceSummary | StoredItemMetadata,
  active: boolean,
  evidenceCount = "evidenceCount" in metadata ? metadata.evidenceCount : 0,
  latestEvidenceAt = "latestEvidenceAt" in metadata
    ? metadata.latestEvidenceAt
    : undefined,
): EvidenceEmployeeSummary {
  return {
    employeeUserId: metadata.employeeUserId,
    employeeName: metadata.employeeName,
    ...(metadata.employeeNo ? { employeeNo: metadata.employeeNo } : {}),
    ...(metadata.department ? { department: metadata.department } : {}),
    ...(metadata.position ? { position: metadata.position } : {}),
    employmentStatus: active ? "active" : "departed",
    evidenceCount,
    ...(latestEvidenceAt ? { latestEvidenceAt } : {}),
  };
}

function evidenceRowStatus(
  metadata: StoredItemMetadata,
  deliveries: DeliveryRecord[],
  evidence: Array<{ eventType: string; createdAt: string }> = [],
): EvidenceCandidate["status"] {
  const sortedDeliveries = [...deliveries].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const latestDelivery = sortedDeliveries.at(-1);
  const deliveredAt = sortedDeliveries
    .filter((delivery) => delivery.status === "delivered")
    .at(-1)?.createdAt;
  const sendStatus: SendStatus = !latestDelivery
    ? "not_sent"
    : latestDelivery.status === "delivered"
      ? "sent"
      : latestDelivery.status;
  const withdrawnAt =
    sendStatus === "withdrawn"
      ? latestDate(
          undefined,
          ...sortedDeliveries
            .filter((delivery) => delivery.status === "withdrawn")
            .map((delivery) => delivery.createdAt),
          ...evidence
            .filter((event) => event.eventType === "withdrawn")
            .map((event) => event.createdAt),
        )
      : undefined;
  return {
    sendStatus,
    ...(deliveredAt ? { sentAt: deliveredAt } : {}),
    ...(withdrawnAt ? { withdrawnAt } : {}),
    viewStatus: metadata.viewedAt ? "viewed" : "not_viewed",
    ...(metadata.viewedAt ? { viewedAt: metadata.viewedAt } : {}),
    confirmStatus: metadata.confirmedAt ? "confirmed" : "not_confirmed",
    ...(metadata.confirmedAt ? { confirmedAt: metadata.confirmedAt } : {}),
    ...(metadata.confirmedAt ? { confirmedBy: metadata.employeeUserId } : {}),
  };
}

function matchesFilters(
  payrollMonth: string,
  status: EvidenceCandidate["status"],
  filters: EvidenceFilters,
): boolean {
  if (filters.fromMonth && payrollMonth < filters.fromMonth) return false;
  if (filters.toMonth && payrollMonth > filters.toMonth) return false;
  if (filters.sendStatus && status.sendStatus !== filters.sendStatus)
    return false;
  if (filters.viewStatus && status.viewStatus !== filters.viewStatus)
    return false;
  if (filters.confirmStatus && status.confirmStatus !== filters.confirmStatus)
    return false;
  return true;
}

function toEvidenceRow(
  summary: EvidenceCandidate["summary"],
  item: StoredItem,
  status: EvidenceCandidate["status"],
): EvidenceRow {
  return {
    batchId: summary.id,
    itemId: item.id,
    payrollMonth: summary.payrollMonth,
    title: summary.title,
    state: summary.state,
    employeeUserId: item.employeeUserId,
    employeeName: item.employeeName,
    ...(item.employeeNo ? { employeeNo: item.employeeNo } : {}),
    ...(item.department ? { department: item.department } : {}),
    ...(item.position ? { position: item.position } : {}),
    fields: item.fields,
    ...status,
  };
}

function latestDate(
  current: string | undefined,
  ...candidates: string[]
): string | undefined {
  return [...(current ? [current] : []), ...candidates].sort().at(-1);
}

function sendStatusLabel(status: SendStatus): string {
  return {
    not_sent: "未发送",
    sent: "已发送",
    failed: "发送失败",
    withdrawn: "已撤回",
  }[status];
}

function viewStatusLabel(status: ViewStatus): string {
  return status === "viewed" ? "已查看" : "未查看";
}

function confirmStatusLabel(status: ConfirmStatus): string {
  return status === "confirmed" ? "已确认" : "未确认";
}

export { FIXED_EXPORT_COLUMNS };
