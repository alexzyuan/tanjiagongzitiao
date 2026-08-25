import type { Access } from "@salary/domain";
import type { SalaryStore } from "@salary/db";
import { canManageBatch } from "@salary/domain";

export interface ReportRange {
  fromMonth?: string;
  toMonth?: string;
}

export interface ReportMonthlySummary {
  payrollMonth: string;
  gross: number;
  net: number;
  recipients: number;
  sent: number;
  viewed: number;
  confirmed: number;
}

export interface ReportEmployeeSummary {
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  slips: number;
  gross: number;
  net: number;
  sent: number;
  viewed: number;
  confirmed: number;
}

export class ReportService {
  constructor(private readonly store: SalaryStore) {}

  summary(access: Access, payrollMonth?: string, range: ReportRange = {}) {
    if (access.kind === "employee") throw new Error("admin_identity_required");
    const summaries = this.store.listBatchSummaries()
      .filter(batch => batch.state !== "archived" && canManageBatch(access, batch.id))
      .filter(batch =>
        (!payrollMonth || batch.payrollMonth === payrollMonth) &&
        (!range.fromMonth || batch.payrollMonth >= range.fromMonth) &&
        (!range.toMonth || batch.payrollMonth <= range.toMonth),
      );
    const batches = summaries.map((summary) => this.store.getBatch(summary.id));
    const deliveries = batches.flatMap((batch) => this.store.listDeliveries(batch.id));
    const evidence = batches.flatMap((batch) => this.store.listEvidence(batch.id));
    const salaryTotals = batches.flatMap(batch => batch.items).reduce((total, item) => {
      total.gross += numberField(item.fields, ["应发合计", "应发工资", "基本工资"]);
      total.net += numberField(item.fields, ["实发金额", "实发", "到手工资"]);
      total.tax += numberField(item.fields, ["个人所得税", "个税"]);
      total.socialInsurance += numberField(item.fields, ["社保扣款", "社保"]);
      return total;
    }, { gross: 0, net: 0, tax: 0, socialInsurance: 0 });
    const monthly = aggregateMonthly(batches);
    const employees = aggregateEmployees(batches, deliveries);
    return {
      filter: {
        payrollMonth: payrollMonth ?? null,
        fromMonth: range.fromMonth ?? null,
        toMonth: range.toMonth ?? null,
      },
      totals: {
        batches: batches.length,
        recipients: batches.reduce((sum, batch) => sum + batch.total, 0),
        sent: batches.reduce((sum, batch) => sum + batch.sent, 0),
        viewed: batches.reduce((sum, batch) => sum + batch.viewed, 0),
        confirmed: batches.reduce((sum, batch) => sum + batch.confirmed, 0),
        failedDeliveries: deliveries.filter(event => batches.some(batch => batch.id === event.batchId) && event.status === "failed").length,
        evidenceEvents: evidence.filter(event => batches.some(batch => batch.id === event.batchId)).length,
        salaryTotals
      },
      monthly,
      employees,
      batches: batches.map(({ items: _items, ...batch }) => ({
        ...batch,
        deliveryFailures: deliveries.filter(event => event.batchId === batch.id && event.status === "failed").length,
        evidenceEvents: evidence.filter(event => event.batchId === batch.id).length,
      }))
    };
  }

  csv(access: Access, payrollMonth?: string, range: ReportRange = {}): string {
    const report = this.summary(access, payrollMonth, range);
    const headers = ["工资月份", "工资条标题", "状态", "人数", "已发送", "已查看", "已确认", "发送失败", "存证事件"];
    const rows = report.batches.map(batch => [batch.payrollMonth, batch.title, batch.state, batch.total, batch.sent, batch.viewed, batch.confirmed, batch.deliveryFailures, batch.evidenceEvents].map(csvCell).join(","));
    return [headers.join(","), ...rows].join("\n") + "\n";
  }
}

function aggregateMonthly(
  batches: ReturnType<SalaryStore["getBatch"]>[],
): ReportMonthlySummary[] {
  const byMonth = new Map<string, ReportMonthlySummary>();
  for (const batch of batches) {
    const current = byMonth.get(batch.payrollMonth) ?? {
      payrollMonth: batch.payrollMonth,
      gross: 0,
      net: 0,
      recipients: 0,
      sent: 0,
      viewed: 0,
      confirmed: 0,
    };
    current.recipients += batch.total;
    current.sent += batch.sent;
    current.viewed += batch.viewed;
    current.confirmed += batch.confirmed;
    for (const item of batch.items) {
      current.gross += numberField(item.fields, ["应发合计", "应发工资", "基本工资"]);
      current.net += numberField(item.fields, ["实发金额", "实发", "到手工资"]);
    }
    byMonth.set(batch.payrollMonth, current);
  }
  return [...byMonth.values()].sort((left, right) =>
    left.payrollMonth.localeCompare(right.payrollMonth),
  );
}

function aggregateEmployees(
  batches: ReturnType<SalaryStore["getBatch"]>[],
  deliveries: ReturnType<SalaryStore["listDeliveries"]>,
): ReportEmployeeSummary[] {
  const deliveriesByEmployee = new Map<string, ReturnType<SalaryStore["listDeliveries"]>>();
  for (const delivery of deliveries) {
    const key = `${delivery.batchId}:${delivery.employeeUserId}`;
    const current = deliveriesByEmployee.get(key) ?? [];
    current.push(delivery);
    deliveriesByEmployee.set(key, current);
  }
  const byEmployee = new Map<string, ReportEmployeeSummary>();
  for (const batch of batches) {
    for (const item of batch.items) {
      const current = byEmployee.get(item.employeeUserId) ?? {
        employeeUserId: item.employeeUserId,
        employeeName: item.employeeName,
        ...(item.employeeNo ? { employeeNo: item.employeeNo } : {}),
        ...(item.department ? { department: item.department } : {}),
        ...(item.position ? { position: item.position } : {}),
        slips: 0,
        gross: 0,
        net: 0,
        sent: 0,
        viewed: 0,
        confirmed: 0,
      };
      current.slips += 1;
      current.gross += numberField(item.fields, ["应发合计", "应发工资", "基本工资"]);
      current.net += numberField(item.fields, ["实发金额", "实发", "到手工资"]);
      const latestDelivery = deliveriesByEmployee
        .get(`${batch.id}:${item.employeeUserId}`)
        ?.slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1);
      if (latestDelivery?.status === "delivered") current.sent += 1;
      if (item.viewedAt) current.viewed += 1;
      if (item.confirmedAt) current.confirmed += 1;
      byEmployee.set(item.employeeUserId, current);
    }
  }
  return [...byEmployee.values()].sort((left, right) =>
    left.employeeName.localeCompare(right.employeeName),
  );
}

function numberField(fields: Record<string, string | number | null>, keys: string[]): number {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
