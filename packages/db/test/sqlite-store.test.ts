import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const encryptionKey = Buffer.alloc(32, 9);

describe("SQLite salary store", () => {
  it("lists memory item metadata without decrypting salary fields", async () => {
    const { MemorySalaryStore } = await import("../src/store.js");
    const store = new MemorySalaryStore(encryptionKey);
    const batch = store.createBatch({
      payrollMonth: "2026-08",
      title: "元数据查询",
      createdById: "admin-1",
      items: [
        {
          employeeUserId: "employee-1",
          employeeName: "员工一",
          employeeNo: "A001",
          department: "财务",
          position: "会计",
          fields: { 实发金额: 12000 },
        },
      ],
    });

    const metadata = store.listBatchItemMetadata(batch.id);

    expect(metadata).toMatchObject([
      {
        batchId: batch.id,
        employeeUserId: "employee-1",
        employeeName: "员工一",
        employeeNo: "A001",
        department: "财务",
        position: "会计",
      },
    ]);
    expect(metadata[0]).not.toHaveProperty("fields");
    expect(JSON.stringify(metadata)).not.toContain("12000");
  });

  it("lists SQLite item metadata without decrypting salary fields", async () => {
    const implementation = await import("../src/sqlite-store.js");
    const store = new implementation.SqliteSalaryStore(":memory:", encryptionKey);
    const batch = store.createBatch({
      payrollMonth: "2026-08",
      title: "元数据查询",
      createdById: "admin-1",
      items: [
        {
          employeeUserId: "employee-1",
          employeeName: "员工一",
          employeeNo: "A001",
          department: "财务",
          position: "会计",
          fields: { 实发金额: 13000 },
        },
      ],
    });

    const metadata = store.listBatchItemMetadata(batch.id);

    expect(metadata).toMatchObject([
      {
        batchId: batch.id,
        employeeUserId: "employee-1",
        employeeName: "员工一",
        employeeNo: "A001",
        department: "财务",
        position: "会计",
      },
    ]);
    expect(metadata[0]).not.toHaveProperty("fields");
    expect(JSON.stringify(metadata)).not.toContain("13000");
    store.close();
  });

  it("persists encrypted salary data, roles, and settings after reopening", async () => {
    const implementation = await import("../src/sqlite-store.js").catch(() => null);
    expect(implementation).not.toBeNull();
    if (!implementation) return;

    const directory = await mkdtemp(join(tmpdir(), "salary-sqlite-"));
    const databasePath = join(directory, "salary-slip.sqlite");
    try {
      const first = new implementation.SqliteSalaryStore(databasePath, encryptionKey);
      const batch = first.createBatch({
        payrollMonth: "2026-08",
        title: "2026年08月工资条",
        createdById: "admin-1",
        items: [{ employeeUserId: "employee-1", employeeName: "员工一", fields: { 基本工资: 12000 } }],
        displaySettings: {
          netAmountField: "基本工资",
          hideEmptyFields: true,
          confirmationEnabled: false,
          notice: "工资条属于敏感信息，请注意保密",
          greeting: "{name}，工作辛苦啦",
          theme: "default",
          visibleFields: ["基本工资"],
          fieldGroups: [{ id: "income", name: "应发工资", fieldKeys: ["基本工资"] }]
        }
      });
      first.assignSubAdmin("finance-1");
      const template = first.createSalaryTemplate({ name: "常规工资条", settings: batch.displaySettings });
      first.setSettings({ employeeVisibilityMonths: 12 });
      first.close();

      const reopened = new implementation.SqliteSalaryStore(databasePath, encryptionKey);
      expect(reopened.getBatch(batch.id)).toMatchObject({ payrollMonth: "2026-08", title: "2026年08月工资条", createdById: "admin-1" });
      expect(reopened.getBatch(batch.id).displaySettings).toEqual({
        netAmountField: "基本工资",
        hideEmptyFields: true,
        confirmationEnabled: false,
        notice: "工资条属于敏感信息，请注意保密",
        greeting: "{name}，工作辛苦啦",
        theme: "default",
        visibleFields: ["基本工资"],
        fieldGroups: [{ id: "income", name: "应发工资", fieldKeys: ["基本工资"] }]
      });
      expect(reopened.getBatch(batch.id).items[0]?.fields).toEqual({ 基本工资: 12000 });
      const summary = reopened.getBatchSummary(batch.id);
      expect(summary).toMatchObject({ id: batch.id, payrollMonth: "2026-08" });
      expect(summary).not.toHaveProperty("items");
      expect(reopened.listBatchSummaries()[0]).not.toHaveProperty("items");
      expect(reopened.listSubAdmins()).toEqual(["finance-1"]);
      expect(reopened.listSalaryTemplates()).toMatchObject([{ id: template.id, name: "常规工资条", settings: batch.displaySettings }]);
      expect(reopened.getSettings()).toEqual({ employeeVisibilityMonths: 12 });
      reopened.close();

      expect((await readFile(databasePath)).toString("utf8")).not.toContain("12000");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("counts each employee's successful delivery only once", async () => {
    const implementation = await import("../src/sqlite-store.js");
    const directory = await mkdtemp(join(tmpdir(), "salary-sqlite-count-"));
    const databasePath = join(directory, "salary-slip.sqlite");
    try {
      const store = new implementation.SqliteSalaryStore(databasePath, encryptionKey);
      const batch = store.createBatch({
        payrollMonth: "2026-08",
        title: "幂等计数",
        createdById: "admin-1",
        items: [{ employeeUserId: "employee-1", employeeName: "员工一", fields: { 实发金额: 1 } }],
      });
      expect(store.markSent(batch.id, "employee-1").sent).toBe(1);
      store.recordDelivery({ batchId: batch.id, employeeUserId: "employee-1", status: "delivered", taskId: "task-1" });
      expect(store.markSent(batch.id, "employee-1").sent).toBe(1);
      expect(store.getBatch(batch.id).sent).toBe(1);
      store.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
