import type { Access } from "@salary/domain";
import type { SalaryStore } from "@salary/db";
import { canManageBatch } from "@salary/domain";

export class ReportService {
  constructor(private readonly store: SalaryStore) {}

  summary(access: Access, payrollMonth?: string) {
    if (access.kind === "employee") throw new Error("admin_identity_required");
    const batches = this.store.listBatches()
      .filter(batch => batch.state !== "archived" && canManageBatch(access, batch.id))
      .filter(batch => !payrollMonth || batch.payrollMonth === payrollMonth);
    const deliveries = this.store.listDeliveries();
    const evidence = this.store.listEvidence();
    const salaryTotals = batches.flatMap(batch => batch.items).reduce((total, item) => {
      total.gross += numberField(item.fields, ["应发合计", "应发工资", "基本工资"]);
      total.net += numberField(item.fields, ["实发金额", "实发", "到手工资"]);
      total.tax += numberField(item.fields, ["个人所得税", "个税"]);
      total.socialInsurance += numberField(item.fields, ["社保扣款", "社保"]);
      return total;
    }, { gross: 0, net: 0, tax: 0, socialInsurance: 0 });
    return {
      filter: { payrollMonth: payrollMonth ?? null },
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
      batches: batches.map(batch => ({ ...batch, deliveryFailures: deliveries.filter(event => event.batchId === batch.id && event.status === "failed").length, evidenceEvents: evidence.filter(event => event.batchId === batch.id).length }))
    };
  }

  csv(access: Access, payrollMonth?: string): string {
    const report = this.summary(access, payrollMonth);
    const headers = ["工资月份", "工资条标题", "状态", "人数", "已发送", "已查看", "已确认", "发送失败", "存证事件"];
    const rows = report.batches.map(batch => [batch.payrollMonth, batch.title, batch.state, batch.total, batch.sent, batch.viewed, batch.confirmed, batch.deliveryFailures, batch.evidenceEvents].map(csvCell).join(","));
    return [headers.join(","), ...rows].join("\n") + "\n";
  }
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
