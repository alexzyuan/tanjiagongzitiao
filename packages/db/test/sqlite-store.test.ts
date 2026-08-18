import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const encryptionKey = Buffer.alloc(32, 9);

describe("SQLite salary store", () => {
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
          feedbackEnabled: true,
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
      first.setSettings({ passwordVerification: true });
      first.close();

      const reopened = new implementation.SqliteSalaryStore(databasePath, encryptionKey);
      expect(reopened.getBatch(batch.id)).toMatchObject({ payrollMonth: "2026-08", title: "2026年08月工资条", createdById: "admin-1" });
      expect(reopened.getBatch(batch.id).displaySettings).toEqual({
        netAmountField: "基本工资",
        hideEmptyFields: true,
        feedbackEnabled: true,
        confirmationEnabled: false,
        notice: "工资条属于敏感信息，请注意保密",
        greeting: "{name}，工作辛苦啦",
        theme: "default",
        visibleFields: ["基本工资"],
        fieldGroups: [{ id: "income", name: "应发工资", fieldKeys: ["基本工资"] }]
      });
      expect(reopened.getBatch(batch.id).items[0]?.fields).toEqual({ 基本工资: 12000 });
      expect(reopened.listSubAdmins()).toEqual(["finance-1"]);
      expect(reopened.listSalaryTemplates()).toMatchObject([{ id: template.id, name: "常规工资条", settings: batch.displaySettings }]);
      expect(reopened.getSettings().passwordVerification).toBe(true);
      reopened.close();

      expect((await readFile(databasePath)).toString("utf8")).not.toContain("12000");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
