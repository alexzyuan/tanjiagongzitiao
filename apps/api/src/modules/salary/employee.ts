import type {
  Access,
  SalaryBatchSummary,
  SalarySlipDisplaySettings,
} from "@salary/domain";
import { fingerprintSalaryPayload, type SalaryStore } from "@salary/db";
import type { AuditService } from "../audit/service.js";

export class SalaryEmployeeService {
  constructor(
    private readonly store: SalaryStore,
    private readonly audit: AuditService,
  ) {}

  listEmployeeSlips(access: Access, now = new Date()) {
    if (access.kind !== "employee")
      throw new Error("employee_identity_required");
    return this.store.listBatchSummaries().flatMap((summary) => {
      try {
        const employeeSlip = this.employeeAccessibleSlip(
          summary.id,
          access.userId,
          now,
          summary,
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

  readEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee")
      throw new Error("employee_identity_required");
    const employeeSlip = this.employeeAccessibleSlip(batchId, access.userId);
    return employeeSlipResponse(employeeSlip.batch, employeeSlip.item);
  }

  viewEmployeeItem(access: Access, batchId: string) {
    if (access.kind !== "employee")
      throw new Error("employee_identity_required");
    const employeeSlip = this.employeeAccessibleSlip(batchId, access.userId);
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
    const employeeSlip = this.employeeAccessibleSlip(batchId, access.userId);
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

  private employeeAccessibleSlip(
    batchId: string,
    employeeUserId: string,
    now = new Date(),
    batchSummary?: SalaryBatchSummary,
  ) {
    const batch = batchSummary ?? this.store.getBatchSummary(batchId);
    if (
      batch.state === "archived" ||
      batch.payrollMonth <
        visibleCutoffMonth(
          now,
          this.store.getSettings().employeeVisibilityMonths,
        )
    )
      throw new Error("salary_item_archived");
    if (batch.state === "withdrawn") throw new Error("salary_item_withdrawn");
    const item = this.store.getEmployeeItem(batchId, employeeUserId);
    const latestDelivery = this.store
      .listDeliveries(batchId)
      .filter((delivery) => delivery.employeeUserId === employeeUserId)
      .at(-1);
    if (latestDelivery?.status === "withdrawn")
      throw new Error("salary_item_withdrawn");
    return { batch, item };
  }
}

function employeeSlipResponse(
  batch: SalaryBatchSummary,
  item: ReturnType<SalaryStore["getEmployeeItem"]>,
) {
  return { batch, item: employeeVisibleItem(item, batch.displaySettings) };
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
  batch: SalaryBatchSummary,
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
