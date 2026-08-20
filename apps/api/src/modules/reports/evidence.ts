import type { DingTalkClient } from "@salary/dingtalk";
import type {
  Access,
  SalaryBatchState,
  SalaryFieldValue,
} from "@salary/domain";
import type {
  DeliveryRecord,
  SalaryStore,
  StoredBatch,
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
    const summaries = this.visibleBatchSummaries(access).filter(
      (batch) => batch.state !== "draft",
    );
    const directoryUsers = await this.dingtalk.listDirectoryUsers();
    const activeUserIds = new Set(directoryUsers.map((user) => user.userId));
    const employees = new Map<
      string,
      {
        metadata: StoredItemMetadata;
        evidenceCount: number;
        latestEvidenceAt?: string;
      }
    >();

    for (const summary of summaries) {
      const evidence = this.store.listEvidence(summary.id);
      for (const metadata of this.store.listBatchItemMetadata(summary.id)) {
        const previous = employees.get(metadata.employeeUserId);
        const latestEvidenceAt = latestDate(
          previous?.latestEvidenceAt,
          ...evidence
            .filter(
              (event) => event.employeeUserId === metadata.employeeUserId,
            )
            .map((event) => event.createdAt),
        );
        employees.set(metadata.employeeUserId, {
          metadata: previous?.metadata ?? metadata,
          evidenceCount: (previous?.evidenceCount ?? 0) + 1,
          ...(latestEvidenceAt ? { latestEvidenceAt } : {}),
        });
      }
    }

    const needle = query.query?.trim().toLocaleLowerCase();
    return [...employees.values()]
      .map(({ metadata, evidenceCount, latestEvidenceAt }) => ({
        ...employeeSummary(
          metadata,
          activeUserIds.has(metadata.employeeUserId),
          evidenceCount,
          latestEvidenceAt,
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
    const summaries = this.visibleBatchSummaries(access).filter(
      (batch) => batch.state !== "draft",
    );
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
      employeeMetadata ??= metadata;
      evidenceCount += 1;
      const evidence = this.store
        .listEvidence(summary.id)
        .filter((event) => event.employeeUserId === employeeUserId);
      latestEvidenceAt = latestDate(
        latestEvidenceAt,
        ...evidence.map((event) => event.createdAt),
      );
      const status = evidenceRowStatus(
        metadata,
        this.store
          .listDeliveries(summary.id)
          .filter((delivery) => delivery.employeeUserId === employeeUserId),
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

  exportXlsx(_access: Access, _input: EvidenceExportInput): Buffer {
    void this.audit;
    throw new Error("payment_evidence_export_not_implemented");
  }
}

function employeeSummary(
  metadata: StoredItemMetadata,
  active: boolean,
  evidenceCount: number,
  latestEvidenceAt: string | undefined,
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
  return {
    sendStatus,
    ...(deliveredAt ? { sentAt: deliveredAt } : {}),
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

export { FIXED_EXPORT_COLUMNS };
