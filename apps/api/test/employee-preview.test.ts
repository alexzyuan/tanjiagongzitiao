import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

function sessionCookie(response: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const value = response.headers["set-cookie"];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) throw new Error("test_session_cookie_missing");
  return first.split(";")[0];
}

describe("admin employee preview", () => {
  it("returns only the selected employee's visible fields without recording employee activity", async () => {
    const { app, store } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
      payload: {
        payrollMonth: "2026-08",
        title: "管理员预览工资条",
        rows: [
          {
            userId: "employee-a",
            name: "员工A",
            基本工资: 9000,
            内部备注: "仅管理员可见",
          },
          {
            userId: "employee-b",
            name: "员工B",
            基本工资: 8000,
            内部备注: "员工B数据",
          },
        ],
        displaySettings: {
          netAmountField: "基本工资",
          hideEmptyFields: true,
          confirmationEnabled: true,
          notice: "",
          greeting: "{name}",
          theme: "default",
          visibleFields: ["基本工资"],
          fieldGroups: [],
        },
      },
    });
    const batchId = draft.json().batchId as string;
    const detail = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: admin },
    });
    const itemId = detail.json().items.find(
      (item: { employeeUserId: string }) => item.employeeUserId === "employee-a",
    ).id as string;

    const preview = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}/items/${itemId}/employee-preview`,
      headers: { cookie: admin },
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json().batch.items).toBeUndefined();
    expect(preview.json().item.employeeUserId).toBe("employee-a");
    expect(preview.json().item.fields).toEqual({ 基本工资: 9000 });
    expect(JSON.stringify(preview.json())).not.toContain("employee-b");
    expect(JSON.stringify(preview.json())).not.toContain("内部备注");
    expect(preview.json().item.viewedAt).toBeUndefined();
    expect(preview.json().item.confirmedAt).toBeUndefined();
    expect(store.listEvidence()).toEqual([]);
    expect(store.listAudits().some((audit) => audit.action === "salary_item.preview")).toBe(true);

    const employee = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-a", name: "员工A" },
      }),
    );
    const denied = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}/items/${itemId}/employee-preview`,
      headers: { cookie: employee },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("salary_batch_access_denied");
    await app.close();
  });

  it("keeps the mobile employee endpoint scoped to the signed-in admin identity", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
      payload: {
        payrollMonth: "2026-08",
        title: "只属于员工A的工资条",
        rows: [{ userId: "employee-a", name: "员工A", 实发金额: 9000 }],
      },
    });
    const batchId = draft.json().batchId as string;
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });

    const ownMobileList = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: admin },
    });
    expect(ownMobileList.statusCode).toBe(200);
    expect(ownMobileList.json()).toEqual([]);
    await app.close();
  });

  it("returns an administrator's own slip but never another employee's slip", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(
      await app.inject({ method: "POST", url: "/v1/auth/dev" }),
    );
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
      payload: {
        payrollMonth: "2026-08",
        title: "管理员本人和其他员工",
        rows: [
          { userId: "dev-admin", name: "企业管理员", 实发金额: 12000 },
          { userId: "employee-a", name: "员工A", 实发金额: 9000 },
        ],
      },
    });
    const batchId = draft.json().batchId as string;
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });

    const ownMobileList = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: admin },
    });
    expect(ownMobileList.statusCode).toBe(200);
    expect(ownMobileList.json()).toHaveLength(1);
    expect(ownMobileList.json()[0].item.employeeUserId).toBe("dev-admin");
    expect(JSON.stringify(ownMobileList.json())).not.toContain("employee-a");
    await app.close();
  });
});
