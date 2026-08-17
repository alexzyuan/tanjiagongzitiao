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
        items: [{ employeeUserId: "employee-1", employeeName: "员工一", fields: { 基本工资: 12000 } }]
      });
      first.assignSubAdmin("finance-1");
      first.setSettings({ passwordVerification: true });
      first.close();

      const reopened = new implementation.SqliteSalaryStore(databasePath, encryptionKey);
      expect(reopened.getBatch(batch.id)).toMatchObject({ payrollMonth: "2026-08", title: "2026年08月工资条", createdById: "admin-1" });
      expect(reopened.getBatch(batch.id).items[0]?.fields).toEqual({ 基本工资: 12000 });
      expect(reopened.listSubAdmins()).toEqual(["finance-1"]);
      expect(reopened.getSettings().passwordVerification).toBe(true);
      reopened.close();

      expect((await readFile(databasePath)).toString("utf8")).not.toContain("12000");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
