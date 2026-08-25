import { describe, expect, it } from "vitest";
import { MockDingTalkClient } from "@salary/dingtalk";
import { MemorySalaryStore } from "@salary/db";
import { AuditService } from "../src/modules/audit/service.js";
import { ReportService } from "../src/modules/reports/service.js";
import { SalaryService } from "../src/modules/salary/service.js";

class BoundaryStore extends MemorySalaryStore {
  blockAllFullReads = false;
  forbiddenBatchId?: string;

  override listBatches() {
    throw new Error("test_list_batches_must_not_be_called");
  }

  override getBatch(id: string) {
    if (this.blockAllFullReads || id === this.forbiddenBatchId)
      throw new Error("test_unauthorized_full_batch_read");
    return super.getBatch(id);
  }
}

function createBatch(store: BoundaryStore, employeeUserId: string) {
  const batch = store.createBatch({
    payrollMonth: "2026-08",
    title: "最小读取测试",
    createdById: "admin",
    items: [
      {
        employeeUserId,
        employeeName: employeeUserId,
        fields: { 实发金额: 9000 },
      },
    ],
    displaySettings: {
      netAmountField: "实发金额",
      visibleFields: ["实发金额"],
      confirmationEnabled: true,
      hideEmptyFields: true,
      notice: "",
      greeting: "{name}",
      theme: "default",
      fieldGroups: [],
    },
  });
  store.markSent(batch.id, employeeUserId);
  store.recordDelivery({
    batchId: batch.id,
    employeeUserId,
    status: "delivered",
    taskId: `task-${employeeUserId}`,
  });
  return batch;
}

describe("minimal sensitive salary reads", () => {
  it("employee salary paths do not call listBatches or getBatch", () => {
    const store = new BoundaryStore(Buffer.alloc(32, 7));
    const batch = createBatch(store, "employee-a");
    store.blockAllFullReads = true;
    const salary = new SalaryService(
      store,
      new MockDingTalkClient(),
      new AuditService(store),
      "http://localhost:3000",
    );

    const slips = salary.listEmployeeSlips({
      kind: "employee",
      userId: "employee-a",
    });

    expect(slips).toHaveLength(1);
    expect(slips[0]?.item.employeeUserId).toBe("employee-a");
    expect(
      salary.readEmployeeItem(
        { kind: "employee", userId: "employee-a" },
        batch.id,
      ).item.employeeUserId,
    ).toBe("employee-a");
    expect(
      salary.viewEmployeeItem(
        { kind: "employee", userId: "employee-a" },
        batch.id,
      ).employeeUserId,
    ).toBe("employee-a");
    expect(
      salary.confirmEmployeeItem(
        { kind: "employee", userId: "employee-a" },
        batch.id,
      ).employeeUserId,
    ).toBe("employee-a");
  });

  it("report only calls getBatch for authorized summaries", () => {
    const store = new BoundaryStore(Buffer.alloc(32, 8));
    const allowed = createBatch(store, "employee-a");
    const forbidden = createBatch(store, "employee-b");
    store.forbiddenBatchId = forbidden.id;
    const reports = new ReportService(store);

    const report = reports.summary(
      { kind: "sub_admin", userId: "sub-admin", batchIds: [allowed.id] },
    );

    expect(report.batches.map((batch) => batch.id)).toEqual([allowed.id]);
    expect(report.monthly).toEqual([
      expect.objectContaining({
        payrollMonth: "2026-08",
        recipients: 1,
        sent: 1,
      }),
    ]);
    expect(report.employees).toEqual([
      expect.objectContaining({
        employeeUserId: "employee-a",
        employeeName: "employee-a",
        slips: 1,
        net: 9000,
        sent: 1,
      }),
    ]);
  });

  it("keeps an employee counted as sent after the latest delivery is withdrawn", () => {
    const store = new BoundaryStore(Buffer.alloc(32, 9));
    const batch = createBatch(store, "employee-a");
    store.recordDelivery({
      batchId: batch.id,
      employeeUserId: "employee-a",
      status: "withdrawn",
      taskId: "task-employee-a",
    });

    const report = new ReportService(store).summary({ kind: "main_admin", userId: "admin" });

    expect(report.monthly[0]?.sent).toBe(1);
    expect(report.employees[0]?.sent).toBe(1);
  });

  it("exports employee summary rows separately from batch summary rows", () => {
    const store = new BoundaryStore(Buffer.alloc(32, 10));
    const batch = createBatch(store, "employee-a");
    const csv = new ReportService(store).employeeCsv({ kind: "main_admin", userId: "admin" });

    expect(csv).toContain("员工,工号,部门,职位,工资条数,应发合计,实发合计,已发送,已查看,已确认");
    expect(csv).toContain("employee-a,,,,1,0,9000,1,0,0");
    expect(csv).not.toContain(batch.title);
  });

  it("neutralizes spreadsheet formula prefixes in employee CSV text fields", () => {
    const store = new BoundaryStore(Buffer.alloc(32, 11));
    store.createBatch({
      payrollMonth: "2026-08",
      title: "公式注入测试",
      createdById: "admin",
      items: [{
        employeeUserId: "=employee-id",
        employeeName: "=2+3",
        employeeNo: "+001",
        department: "-finance",
        position: "@manager",
        fields: { 实发金额: 1000 },
      }],
      displaySettings: {
        netAmountField: "实发金额",
        visibleFields: ["实发金额"],
        confirmationEnabled: true,
        hideEmptyFields: true,
        notice: "",
        greeting: "{name}",
        theme: "default",
        fieldGroups: [],
      },
    });

    const csv = new ReportService(store).employeeCsv({ kind: "main_admin", userId: "admin" });

    expect(csv).toContain("'=2+3,'+001,'-finance,'@manager");
    expect(csv).not.toContain("=2+3,+001,-finance,@manager");
  });
});
