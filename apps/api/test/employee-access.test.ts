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

describe("employee salary access", () => {
  it("only exposes the signed-in employee's own current salary slip", async () => {
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
        title: "2026年08月工资条",
        rows: [
          { userId: "employee-a", name: "员工A", 基本工资: 12000 },
          { userId: "employee-b", name: "员工B", 基本工资: 9000 },
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
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });

    const employee = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-a", name: "员工A" },
      }),
    );
    const list = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: employee },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].item.employeeUserId).toBe("employee-a");
    expect(list.json()[0].item.fields.基本工资).toBe(12000);
    expect(list.json()[0].batch.displaySettings.netAmountField).toBe(
      "基本工资",
    );

    const secondDraft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
      payload: {
        payrollMonth: "2026-08",
        title: "仅员工B工资条",
        rows: [{ userId: "employee-b", name: "员工B", 基本工资: 8000 }],
      },
    });
    expect(secondDraft.statusCode).toBe(200);
    const listWithAnotherEmployeesBatch = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: employee },
    });
    expect(listWithAnotherEmployeesBatch.statusCode).toBe(200);
    expect(listWithAnotherEmployeesBatch.json()).toHaveLength(1);

    const other = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-b", name: "员工B" },
      }),
    );
    const ownDetail = await app.inject({
      method: "GET",
      url: `/v1/me/salary-slips/${batchId}`,
      headers: { cookie: other },
    });
    expect(ownDetail.statusCode).toBe(200);
    expect(ownDetail.json().item.employeeUserId).toBe("employee-b");
    expect(ownDetail.json().batch.items).toBeUndefined();
    expect(JSON.stringify(ownDetail.json())).not.toContain("employee-a");
    expect(JSON.stringify(ownDetail.json())).not.toContain("12000");
    await app.close();
  });

  it("filters hidden salary fields in employee list and detail responses", async () => {
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
        title: "字段白名单工资条",
        rows: [
          {
            userId: "employee-a",
            name: "员工A",
            基本工资: 9000,
            内部备注: "不应返回",
            公司成本: 15000,
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
    const employee = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-a", name: "员工A" },
      }),
    );

    const list = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: employee },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0].item.fields).toEqual({ 基本工资: 9000 });
    expect(JSON.stringify(list.json())).not.toContain("内部备注");
    expect(JSON.stringify(list.json())).not.toContain("公司成本");

    const detail = await app.inject({
      method: "GET",
      url: `/v1/me/salary-slips/${batchId}`,
      headers: { cookie: employee },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().item.fields).toEqual({ 基本工资: 9000 });
    expect(JSON.stringify(detail.json())).not.toContain("内部备注");
    expect(JSON.stringify(detail.json())).not.toContain("公司成本");

    const viewed = await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batchId}/view`,
      headers: { cookie: employee },
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().fields).toEqual({ 基本工资: 9000 });
    expect(JSON.stringify(viewed.json())).not.toContain("内部备注");
    expect(JSON.stringify(viewed.json())).not.toContain("公司成本");

    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batchId}/confirm`,
      headers: { cookie: employee },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().fields).toEqual({ 基本工资: 9000 });
    expect(JSON.stringify(confirmed.json())).not.toContain("内部备注");
    expect(JSON.stringify(confirmed.json())).not.toContain("公司成本");
    await app.close();
  });

  it("keeps all own salary fields when visibleFields is empty", async () => {
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
        title: "全部字段工资条",
        rows: [
          {
            userId: "employee-a",
            name: "员工A",
            基本工资: 9000,
            内部备注: "保留语义",
            公司成本: 15000,
          },
        ],
      },
    });
    const batchId = draft.json().batchId as string;
    const employee = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-a", name: "员工A" },
      }),
    );

    const list = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: employee },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0].item.fields).toEqual({
      基本工资: 9000,
      内部备注: "保留语义",
      公司成本: 15000,
    });

    const detail = await app.inject({
      method: "GET",
      url: `/v1/me/salary-slips/${batchId}`,
      headers: { cookie: employee },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().item.fields).toEqual({
      基本工资: 9000,
      内部备注: "保留语义",
      公司成本: 15000,
    });
    await app.close();
  });

  it("rejects confirmation when the batch disables confirmation", async () => {
    const { app } = buildApp();
    const admin = sessionCookie(await app.inject({ method: "POST", url: "/v1/auth/dev" }));
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie: admin },
      payload: {
        payrollMonth: "2026-08",
        title: "关闭确认的工资条",
        rows: [{ userId: "employee-a", name: "员工A", 基本工资: 9000 }],
        displaySettings: {
          netAmountField: "基本工资",
          hideEmptyFields: true,
          confirmationEnabled: false,
          notice: "",
          greeting: "{name}",
          theme: "default",
          visibleFields: ["基本工资"],
          fieldGroups: [],
        },
      },
    });
    const batchId = draft.json().batchId as string;
    await app.inject({ method: "POST", url: `/v1/salary-batches/${batchId}/send`, headers: { cookie: admin }, payload: {} });
    const employee = sessionCookie(await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { userId: "employee-a", name: "员工A" } }));
    const response = await app.inject({ method: "POST", url: `/v1/me/salary-slips/${batchId}/confirm`, headers: { cookie: employee } });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("salary_confirmation_disabled");
    await app.close();
  });

  it("revokes employee access after a batch is withdrawn", async () => {
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
        title: "批次撤回工资条",
        rows: [{ userId: "employee-a", name: "员工A", 基本工资: 9000 }],
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
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    const employee = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-a", name: "员工A" },
      }),
    );

    const viewed = await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batchId}/view`,
      headers: { cookie: employee },
    });
    expect(viewed.statusCode).toBe(200);
    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batchId}/confirm`,
      headers: { cookie: employee },
    });
    expect(confirmed.statusCode).toBe(200);

    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/withdraw`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(withdraw.statusCode).toBe(200);

    const list = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: employee },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);

    for (const request of [
      { method: "GET", url: `/v1/me/salary-slips/${batchId}` },
      { method: "POST", url: `/v1/me/salary-slips/${batchId}/view` },
      { method: "POST", url: `/v1/me/salary-slips/${batchId}/confirm` },
    ] as const) {
      const response = await app.inject({ ...request, headers: { cookie: employee } });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("salary_item_withdrawn");
    }

    const adminDetail = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: admin },
    });
    expect(adminDetail.statusCode).toBe(200);
    expect(adminDetail.json().state).toBe("withdrawn");
    expect(adminDetail.json().viewed).toBe(0);
    expect(adminDetail.json().confirmed).toBe(0);
    expect(adminDetail.json().items[0].viewedAt).toBeUndefined();
    expect(adminDetail.json().items[0].confirmedAt).toBeUndefined();
    await app.close();
  });

  it("clears employee view state after item withdrawal and requires reconfirmation", async () => {
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
        title: "撤回后重新确认",
        rows: [{ userId: "employee-a", name: "员工A", 基本工资: 9000 }],
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
    const batch = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: admin },
    });
    const itemId = batch.json().items[0].id as string;
    const employee = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-a", name: "员工A" },
      }),
    );
    await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie: admin },
      payload: {},
    });

    const viewed = await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batchId}/view`,
      headers: { cookie: employee },
    });
    expect(viewed.statusCode).toBe(200);
    expect(viewed.json().viewedAt).toEqual(expect.any(String));
    expect(viewed.json().confirmedAt).toBeUndefined();
    const confirmed = await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batchId}/confirm`,
      headers: { cookie: employee },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().confirmedAt).toEqual(expect.any(String));

    const withdrawn = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/items/${itemId}/withdraw`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(withdrawn.statusCode).toBe(200);

    const afterWithdraw = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: admin },
    });
    expect(afterWithdraw.json().viewed).toBe(0);
    expect(afterWithdraw.json().confirmed).toBe(0);
    expect(afterWithdraw.json().items[0].viewedAt).toBeUndefined();
    expect(afterWithdraw.json().items[0].confirmedAt).toBeUndefined();

    const resent = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/items/${itemId}/send`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(resent.statusCode).toBe(200);
    const reopened = await app.inject({
      method: "GET",
      url: `/v1/me/salary-slips/${batchId}`,
      headers: { cookie: employee },
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().item.viewedAt).toBeUndefined();
    expect(reopened.json().item.confirmedAt).toBeUndefined();

    const viewedAgain = await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batchId}/view`,
      headers: { cookie: employee },
    });
    expect(viewedAgain.statusCode).toBe(200);
    expect(viewedAgain.json().viewedAt).toEqual(expect.any(String));
    expect(viewedAgain.json().confirmedAt).toBeUndefined();
    const confirmedAgain = await app.inject({
      method: "POST",
      url: `/v1/me/salary-slips/${batchId}/confirm`,
      headers: { cookie: employee },
    });
    expect(confirmedAgain.statusCode).toBe(200);
    expect(confirmedAgain.json().confirmedAt).toEqual(expect.any(String));
    await app.close();
  });

  it("revokes only the withdrawn employee's access", async () => {
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
        title: "单员工撤回工资条",
        rows: [
          { userId: "employee-a", name: "员工A", 基本工资: 9000 },
          { userId: "employee-b", name: "员工B", 基本工资: 8000 },
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
    const batch = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batchId}`,
      headers: { cookie: admin },
    });
    const employeeAItemId = batch
      .json()
      .items.find((item: { employeeUserId: string }) => item.employeeUserId === "employee-a")
      .id as string;
    const employeeA = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-a", name: "员工A" },
      }),
    );
    const employeeB = sessionCookie(
      await app.inject({
        method: "POST",
        url: "/v1/auth/dev",
        payload: { userId: "employee-b", name: "员工B" },
      }),
    );

    const withdraw = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/items/${employeeAItemId}/withdraw`,
      headers: { cookie: admin },
      payload: {},
    });
    expect(withdraw.statusCode).toBe(200);

    const withdrawnList = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: employeeA },
    });
    expect(withdrawnList.statusCode).toBe(200);
    expect(withdrawnList.json()).toEqual([]);
    for (const request of [
      { method: "GET", url: `/v1/me/salary-slips/${batchId}` },
      { method: "POST", url: `/v1/me/salary-slips/${batchId}/view` },
      { method: "POST", url: `/v1/me/salary-slips/${batchId}/confirm` },
    ] as const) {
      const response = await app.inject({ ...request, headers: { cookie: employeeA } });
      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("salary_item_withdrawn");
    }

    const retainedList = await app.inject({
      method: "GET",
      url: "/v1/me/salary-slips",
      headers: { cookie: employeeB },
    });
    expect(retainedList.statusCode).toBe(200);
    expect(retainedList.json()).toHaveLength(1);
    const retainedDetail = await app.inject({
      method: "GET",
      url: `/v1/me/salary-slips/${batchId}`,
      headers: { cookie: employeeB },
    });
    expect(retainedDetail.statusCode).toBe(200);
    expect(retainedDetail.json().item.employeeUserId).toBe("employee-b");
    await app.close();
  });
});
