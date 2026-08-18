import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server.js";

describe("salary delivery", () => {
  it("sends a valid draft and records per-recipient delivery", async () => {
    const { app, store } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie },
      payload: {
        payrollMonth: "2026-08",
        title: "2026年08月工资条",
        rows: [{ userId: "employee-a", name: "员工A", 基本工资: 12000 }],
      },
    });
    const batchId = draft.json().batchId as string;
    const send = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie },
      payload: {},
    });
    expect(send.json().batch.state).toBe("sent");
    expect(store.listDeliveries(batchId)).toHaveLength(1);
    await app.close();
  });

  it("sends one selected employee through the same audited delivery path", async () => {
    const { app, store } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie },
      payload: {
        payrollMonth: "2026-08",
        title: "2026年08月工资条",
        rows: [
          { userId: "employee-a", name: "员工A", 实发金额: 10000 },
          { userId: "employee-b", name: "员工B", 实发金额: 9000 },
        ],
      },
    });
    const batch = (
      await app.inject({
        method: "GET",
        url: `/v1/salary-batches/${draft.json().batchId}`,
        headers: { cookie },
      })
    ).json();
    const itemId = batch.items[0].id as string;
    const send = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batch.id}/items/${itemId}/send`,
      headers: { cookie },
      payload: {},
    });
    expect(send.statusCode).toBe(200);
    expect(store.listDeliveries(batch.id)).toHaveLength(1);
    expect(store.listDeliveries(batch.id)[0]?.employeeUserId).toBe(
      batch.items[0].employeeUserId,
    );
    const refreshed = await app.inject({
      method: "GET",
      url: `/v1/salary-batches/${batch.id}`,
      headers: { cookie },
    });
    const refreshedItem = refreshed
      .json()
      .items.find((item: { id: string }) => item.id === itemId);
    expect(refreshedItem.deliveryStatus).toBe("delivered");
    await app.close();
  });

  it("lists enterprise directory users and only assigns an existing directory user as a sub-admin", async () => {
    const { app } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];

    const directory = await app.inject({
      method: "GET",
      url: "/v1/directory/users?query=%E5%91%98%E5%B7%A5A",
      headers: { cookie },
    });
    expect(directory.statusCode).toBe(200);
    expect(directory.json()).toMatchObject([
      { userId: "employee-a", name: "员工A" },
    ]);

    const assigned = await app.inject({
      method: "POST",
      url: "/v1/sub-admins",
      headers: { cookie },
      payload: { userId: "employee-a" },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json()).toEqual(["employee-a"]);

    const rejected = await app.inject({
      method: "POST",
      url: "/v1/sub-admins",
      headers: { cookie },
      payload: { userId: "not-in-directory" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().code).toBe("directory_user_not_found");
    await app.close();
  });

  it("persists a reusable salary slip template", async () => {
    const { app } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const settings = {
      netAmountField: "实发工资",
      hideEmptyFields: true,
      feedbackEnabled: false,
      confirmationEnabled: true,
      notice: "保密",
      greeting: "{name}，辛苦了",
      theme: "default",
      visibleFields: ["基本工资"],
      fieldGroups: [
        { id: "income", name: "应发工资", fieldKeys: ["基本工资"] },
      ],
    };
    const created = await app.inject({
      method: "POST",
      url: "/v1/salary-slip-templates",
      headers: { cookie },
      payload: { name: "常规工资条", settings },
    });
    expect(created.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/salary-slip-templates",
          headers: { cookie },
        })
      ).json(),
    ).toMatchObject([{ name: "常规工资条", settings }]);
    await app.close();
  });

  it("holds a scheduled batch until the scheduled worker pass", async () => {
    const { app, salary } = buildApp();
    const auth = await app.inject({ method: "POST", url: "/v1/auth/dev" });
    const cookie = auth.headers["set-cookie"]?.split(";")[0];
    const draft = await app.inject({
      method: "POST",
      url: "/v1/salary-batches",
      headers: { cookie },
      payload: {
        payrollMonth: "2026-09",
        title: "2026年09月工资条",
        rows: [{ userId: "employee-a", name: "员工A", 实发金额: 1 }],
      },
    });
    const batchId = draft.json().batchId as string;
    const scheduled = await app.inject({
      method: "POST",
      url: `/v1/salary-batches/${batchId}/send`,
      headers: { cookie },
      payload: { scheduledAt: "2026-09-01T10:00:00.000Z" },
    });
    expect(scheduled.json().batch.state).toBe("scheduled");
    const beforeDue = await app.inject({
      method: "POST",
      url: "/v1/admin/scheduled/run",
      headers: { cookie },
    });
    expect(beforeDue.json().processedBatchIds).toEqual([]);
    const afterDue = await salary.processScheduled(
      { kind: "main_admin", userId: "dev-admin" },
      new Date("2026-09-01T10:01:00.000Z"),
    );
    expect(afterDue.processedBatchIds).toEqual([batchId]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/salary-batches/${batchId}`,
          headers: { cookie },
        })
      ).json().state,
    ).toBe("sent");
    await app.close();
  });
});
