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
  return store.createBatch({
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
  });
});
