import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";
import { previewRows } from "../src/modules/salary/import.js";

async function cookieFor(app: ReturnType<typeof buildApp>["app"]) {
  const response = await app.inject({ method: "POST", url: "/v1/auth/dev" });
  return response.headers["set-cookie"]?.split(";")[0];
}

describe("salary draft routes", () => {
  it("returns row-level errors and keeps invalid imports unsendable", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor(app);
    const response = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie }, payload: { payrollMonth: "2026-08", title: "2026年08月工资条", rows: [{ name: "没有ID" }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().batchId).toBeUndefined();
    expect(response.json().errors[0].code).toBe("employee_not_found");
    await app.close();
  });

  it("creates a valid draft", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor(app);
    const response = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie }, payload: { payrollMonth: "2026-08", title: "2026年08月工资条", rows: [{ userId: "employee-a", name: "员工A", 基本工资: 12000 }] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().batchId).toMatch(/^batch-/);
    await app.close();
  });

  it("accepts the official workbook header casing", async () => {
    const { app } = buildApp();
    const cookie = await cookieFor(app);
    const row = { 姓名: "徐智远", 基本工资: "10000", 实发金额: "8888", ["员工UserID"]: "024662116226579969999" };
    const response = await app.inject({ method: "POST", url: "/v1/salary-batches", headers: { cookie }, payload: { payrollMonth: "2026-08", title: "2026年08月工资条", rows: [row] } });
    expect(response.statusCode).toBe(200);
    expect(response.json().batchId).toMatch(/^batch-/);
    expect(response.json().errors).toEqual([]);
    await app.close();
  });
});

describe("directory matching", () => {
  const directory = [
    { userId: "employee-a", name: "陈雯婷", employeeNo: "A001", departmentIds: [1] },
    { userId: "employee-b", name: "陈雯婷", employeeNo: "B001", departmentIds: [2] },
    { userId: "employee-c", name: "林梵", employeeNo: "C001", departmentIds: [1] }
  ];

  it("keeps ambiguous names unresolved instead of selecting an employee", () => {
    const preview = previewRows([{ 姓名: "陈雯婷", 实发工资: 8000 }, { 姓名: "林梵", 实发工资: 9000 }, { 姓名: "不存在", 实发工资: 7000 }], directory, "name");

    expect(preview.rows.map(row => ({ row: row.row, status: row.status, userId: row.user?.userId, candidateIds: row.candidates.map(candidate => candidate.userId) }))).toEqual([
      { row: 2, status: "ambiguous", userId: undefined, candidateIds: ["employee-a", "employee-b"] },
      { row: 3, status: "matched", userId: "employee-c", candidateIds: ["employee-c"] },
      { row: 4, status: "unmatched", userId: undefined, candidateIds: [] }
    ]);
  });

  it("matches employee number and UserID exactly", () => {
    expect(previewRows([{ 工号: "C001", 姓名: "任意", 实发工资: 9000 }], directory, "employeeNo").rows[0]?.user?.userId).toBe("employee-c");
    expect(previewRows([{ 员工UserID: "employee-a", 姓名: "任意", 实发工资: 9000 }], directory, "userId").rows[0]?.user?.userId).toBe("employee-a");
  });
});

describe("directory matched import workflow", () => {
  const directory = [
    { userId: "employee-a", name: "员工A", employeeNo: "A001", departmentIds: [1] },
    { userId: "employee-b", name: "员工B", employeeNo: "B001", departmentIds: [1] }
  ];

  it("does not create a draft until every ambiguous or unmatched row is resolved", async () => {
    const { app, salary } = buildApp();
    const preview = salary.previewImport("dev-admin", {
      payrollMonth: "2026-08",
      title: "2026年08月工资条",
      strategy: "name",
      rows: [{ 姓名: "员工A", 实发工资: 10000 }, { 姓名: "不存在", 实发工资: 8000 }],
      directory
    });

    expect(preview.matched).toBe(1);
    expect(preview.unmatched).toBe(1);
    expect(salary.list({ kind: "main_admin", userId: "dev-admin" })).toEqual([]);
    expect(() => salary.commitImport("dev-admin", preview.previewId, [])).toThrow("salary_import_unresolved_rows");
    expect(salary.list({ kind: "main_admin", userId: "dev-admin" })).toEqual([]);
    await app.close();
  });

  it("commits only a directory-validated manual resolution", async () => {
    const { app, salary } = buildApp();
    const preview = salary.previewImport("dev-admin", {
      payrollMonth: "2026-08",
      title: "2026年08月工资条",
      strategy: "name",
      rows: [{ 姓名: "员工A", 实发工资: 10000 }, { 姓名: "未匹配", 实发工资: 8000 }],
      directory
    });

    expect(() => salary.commitImport("dev-admin", preview.previewId, [{ row: 3, userId: "outside-directory" }])).toThrow("salary_import_resolution_user_invalid");
    const result = salary.commitImport("dev-admin", preview.previewId, [{ row: 3, userId: "employee-b" }]);
    expect(result.batchId).toMatch(/^batch-/);
    const batch = salary.getBatch({ kind: "main_admin", userId: "dev-admin" }, result.batchId ?? "");
    expect(batch.items.map(item => ({ userId: item.employeeUserId, name: item.employeeName })).sort((left, right) => left.userId.localeCompare(right.userId))).toEqual([
      { userId: "employee-a", name: "员工A" },
      { userId: "employee-b", name: "员工B" }
    ]);
    await app.close();
  });
});
