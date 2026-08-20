import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import type { DirectoryUser, DingTalkClient } from "@salary/dingtalk";
import { MemorySalaryStore } from "@salary/db";
import { AuditService } from "../src/modules/audit/service.js";
import { EvidenceService } from "../src/modules/reports/evidence.js";
import { buildApp } from "../src/server.js";

class BoundaryStore extends MemorySalaryStore {
  listBatchesCalled = false;
  forbiddenBatchId?: string;

  override listBatches() {
    this.listBatchesCalled = true;
    throw new Error("test_list_batches_must_not_be_called");
  }

  override getBatch(id: string) {
    if (id === this.forbiddenBatchId)
      throw new Error("test_unauthorized_full_batch_read");
    return super.getBatch(id);
  }
}

function createBatch(
  store: BoundaryStore,
  input: {
    employeeUserId: string;
    employeeName: string;
    position: string;
  },
) {
  const batch = store.createBatch({
    payrollMonth: "2026-08",
    title: "存证测试工资条",
    createdById: "admin",
    items: [
      {
        employeeUserId: input.employeeUserId,
        employeeName: input.employeeName,
        employeeNo: `${input.employeeUserId}-001`,
        department: "测试部门",
        position: input.position,
        fields: { 实发金额: 9000 },
      },
    ],
  });
  store.setState(batch.id, "sending");
  store.setState(batch.id, "sent");
  return batch;
}

function directoryClient(users: DirectoryUser[]): DingTalkClient {
  return {
    exchangeAuthCode: async () => ({
      userId: "admin",
      corpId: "corp",
      name: "管理员",
    }),
    sendWorkNotification: async () => ({ taskId: "task" }),
    createTodo: async () => ({ todoId: "todo" }),
    listDirectoryUsers: async () => users,
  };
}

function cookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("test_session_cookie_missing");
  return first.split(";")[0]!;
}

describe("payment evidence service", () => {
  it("lists employee metadata without full batch reads and classifies directory status", async () => {
    const store = new BoundaryStore(Buffer.alloc(32, 7));
    createBatch(store, {
      employeeUserId: "employee-a",
      employeeName: "员工A",
      position: "财务",
    });
    createBatch(store, {
      employeeUserId: "former-a",
      employeeName: "离职员工",
      position: "运营",
    });
    const service = new EvidenceService(
      store,
      directoryClient([
        {
          userId: "employee-a",
          name: "员工A",
          employeeNo: "employee-a-001",
          position: "财务",
          departmentIds: [1],
        },
      ]),
      new AuditService(store),
    );

    const activeAndDeparted = await service.listEmployees({
      kind: "main_admin",
      userId: "admin",
    });
    const finance = await service.listEmployees(
      { kind: "main_admin", userId: "admin" },
      { query: "财务" },
    );

    expect(store.listBatchesCalled).toBe(false);
    expect(activeAndDeparted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeUserId: "employee-a",
          employmentStatus: "active",
        }),
        expect.objectContaining({
          employeeUserId: "former-a",
          employmentStatus: "departed",
        }),
      ]),
    );
    expect(finance.map((employee) => employee.employeeUserId)).toEqual([
      "employee-a",
    ]);
  });

  it("only reads full batches inside a sub-admin's allowed batch scope", async () => {
    const store = new BoundaryStore(Buffer.alloc(32, 8));
    const allowed = createBatch(store, {
      employeeUserId: "employee-a",
      employeeName: "员工A",
      position: "财务",
    });
    const forbidden = createBatch(store, {
      employeeUserId: "employee-a",
      employeeName: "员工A",
      position: "财务",
    });
    store.forbiddenBatchId = forbidden.id;
    const service = new EvidenceService(
      store,
      directoryClient([]),
      new AuditService(store),
    );

    const detail = await service.getEmployeeDetail(
      { kind: "sub_admin", userId: "sub-admin", batchIds: [allowed.id] },
      "employee-a",
      {},
    );

    expect(detail.rows.map((row) => row.batchId)).toEqual([allowed.id]);
  });

  it("serves scoped employee list and detail routes to sub-admins", async () => {
    const { app } = buildApp();
    const main = cookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const allowedDraft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: main },
      payload: {
        payrollMonth: "2026-08",
        title: "可见工资条",
        rows: [{ userId: "employee-a", name: "员工A", 实发金额: 9000 }],
      },
    });
    const allowedBatchId = allowedDraft.json().batchId as string;
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${allowedBatchId}/send`,
      headers: { cookie: main },
      payload: {},
    });
    const hiddenDraft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: main },
      payload: {
        payrollMonth: "2026-07",
        title: "不可见工资条",
        rows: [{ userId: "former-a", name: "离职员工", 实发金额: 8000 }],
      },
    });
    const hiddenBatchId = hiddenDraft.json().batchId as string;
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${hiddenBatchId}/send`,
      headers: { cookie: main },
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: "/v1/sub-admins",
      headers: { cookie: main },
      payload: { userId: "hr-user" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${allowedBatchId}/admins`,
      headers: { cookie: main },
      payload: { userId: "hr-user" },
    });
    const subAdmin = cookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "hr-user", name: "人事管理员" },
      }),
    );

    const list = await app.inject({
      method: "GET",
      url: "/v1/payment-evidence/employees?query=%E5%91%98%E5%B7%A5A",
      headers: { cookie: subAdmin },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([
      expect.objectContaining({
        employeeUserId: "employee-a",
        employmentStatus: "active",
      }),
    ]);

    const detail = await app.inject({
      method: "GET",
      url: "/v1/payment-evidence/employees/employee-a",
      headers: { cookie: subAdmin },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().rows).toEqual([
      expect.objectContaining({ batchId: allowedBatchId }),
    ]);

    const hiddenDetail = await app.inject({
      method: "GET",
      url: "/v1/payment-evidence/employees/former-a",
      headers: { cookie: subAdmin },
    });
    expect(hiddenDetail.statusCode).toBe(404);
    await app.close();
  });

  it("exports fixed evidence columns and only selected salary fields", async () => {
    const { app } = buildApp();
    const main = cookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: main },
      payload: {
        payrollMonth: "2026-08",
        title: "导出测试工资条",
        rows: [
          {
            userId: "employee-a",
            name: "员工A",
            基本工资: 10000,
            实发金额: 9000,
          },
        ],
      },
    });
    const batchId = draft.json().batchId as string;
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie: main },
      payload: {},
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/payment-evidence/export.xlsx",
      headers: { cookie: main },
      payload: {
        employeeUserId: "employee-a",
        fields: ["实发金额"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const workbook = XLSX.read(response.rawPayload, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<string[]>(
      workbook.Sheets["发薪存证"]!,
      { header: 1 },
    );
    expect(rows[0]).toEqual([
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
      "实发金额",
    ]);
    expect(rows[1]).toContain(9000);

    const invalidField = await app.inject({
      method: "POST",
      url: "/v1/payment-evidence/export.xlsx",
      headers: { cookie: main },
      payload: { employeeUserId: "employee-a", fields: ["不存在字段"] },
    });
    expect(invalidField.statusCode).toBe(400);
    await app.close();
  });
});
