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
          feedbackEnabled: false,
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
    await app.close();
  });
});
